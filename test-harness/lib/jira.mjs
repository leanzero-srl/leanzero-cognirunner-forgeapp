/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Low-level Jira Cloud REST client: basic auth, retry/backoff honoring
// Retry-After, JSON helpers, and a small concurrency limiter. The API token
// is never logged.

import { requireEnv, loadEnv } from "./env.mjs";

loadEnv();
const BASE = requireEnv("JIRA_BASE_URL").replace(/\/+$/, "");
const EMAIL = requireEnv("JIRA_ADMIN_EMAIL");
const TOKEN = requireEnv("JIRA_API_TOKEN");
const AUTH = "Basic " + Buffer.from(`${EMAIL}:${TOKEN}`).toString("base64");

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Throttle instrumentation — the client transparently retries 429/5xx, so the
// raw counts here are how a caller detects rate-limiting that callers otherwise
// never see. Reset around a measured window with resetStats().
export const stats = { requests: 0, status429: 0, status5xx: 0, retries: 0, retryAfterMsTotal: 0 };
export function resetStats() { stats.requests = 0; stats.status429 = 0; stats.status5xx = 0; stats.retries = 0; stats.retryAfterMsTotal = 0; }

const MAX_RETRIES = 6;
let VERBOSE = process.env.HARNESS_VERBOSE === "1";
export function setVerbose(v) {
  VERBOSE = v;
}

function logLine(method, path, status, note) {
  if (!VERBOSE && status < 400) return;
  const tag = status >= 400 ? "!!" : "ok";
  console.log(`[jira ${tag}] ${method} ${path} -> ${status}${note ? " " + note : ""}`);
}

/**
 * Core request. Returns parsed JSON (or null for 204). Throws JiraError on
 * non-2xx after retries. Set opts.raw=true to get { status, headers, text }.
 */
export async function request(method, path, opts = {}) {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const headers = {
    Authorization: AUTH,
    Accept: "application/json",
    ...(opts.headers || {}),
  };
  let body = opts.body;
  if (body !== undefined && typeof body !== "string") {
    headers["Content-Type"] = headers["Content-Type"] || "application/json";
    body = JSON.stringify(body);
  }

  let attempt = 0;
  for (;;) {
    attempt++;
    let res;
    try {
      res = await fetch(url, { method, headers, body });
    } catch (err) {
      if (attempt > MAX_RETRIES) throw err;
      const wait = Math.min(30000, 500 * 2 ** (attempt - 1));
      logLine(method, path, 0, `network err, retry in ${wait}ms`);
      await sleep(wait);
      continue;
    }

    stats.requests++;
    if (res.status === 429) stats.status429++;
    else if (res.status >= 500) stats.status5xx++;

    // Rate limit / transient server errors -> backoff & retry
    if ((res.status === 429 || res.status >= 500) && attempt <= MAX_RETRIES) {
      stats.retries++;
      const ra = parseInt(res.headers.get("Retry-After") || "", 10);
      stats.retryAfterMsTotal += Number.isFinite(ra) ? ra * 1000 : 0;
      const wait = Number.isFinite(ra)
        ? ra * 1000
        : Math.min(30000, 500 * 2 ** (attempt - 1));
      logLine(method, path, res.status, `retry in ${wait}ms (attempt ${attempt})`);
      await sleep(wait);
      continue;
    }

    const text = await res.text();
    logLine(method, path, res.status);

    if (opts.raw) {
      return { status: res.status, headers: res.headers, text };
    }

    if (res.status === 204 || text.length === 0) {
      if (res.ok) return null;
    }

    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { _raw: text };
    }

    if (!res.ok) {
      const err = new Error(
        `Jira ${method} ${path} failed ${res.status}: ${text.slice(0, 600)}`
      );
      err.status = res.status;
      err.body = json;
      throw err;
    }
    return json;
  }
}

export const get = (path, opts) => request("GET", path, opts);
export const post = (path, body, opts) => request("POST", path, { ...opts, body });
export const put = (path, body, opts) => request("PUT", path, { ...opts, body });
export const del = (path, opts) => request("DELETE", path, opts);

/** Simple promise concurrency limiter. */
export function pLimit(concurrency) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= concurrency || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve, reject).finally(() => {
      active--;
      next();
    });
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
}

/** Run items through worker with bounded concurrency; collects results in order. */
export async function mapLimit(items, concurrency, worker) {
  const limit = pLimit(concurrency);
  return Promise.all(items.map((item, i) => limit(() => worker(item, i))));
}

// ---- Common domain helpers (used across scripts) ----

export const getMyself = () => get("/rest/api/3/myself");

export const getServerInfo = () => get("/rest/api/3/serverInfo");

export const getIssue = (key, fields) =>
  get(`/rest/api/3/issue/${key}${fields ? `?fields=${fields}` : ""}`);

export const getTransitions = (key) =>
  get(`/rest/api/3/issue/${key}/transitions?expand=transitions.fields`);

/** Returns { status, text } of the transition attempt (does not throw on 4xx). */
export async function doTransition(key, transitionId, fields) {
  const body = { transition: { id: String(transitionId) } };
  if (fields) body.fields = fields;
  const res = await request("POST", `/rest/api/3/issue/${key}/transitions`, {
    body,
    raw: true,
  });
  return { status: res.status, text: res.text };
}

export async function searchJql(jql, fields = ["summary", "status"], maxResults = 100) {
  const out = [];
  let nextPageToken;
  do {
    const body = { jql, fields, maxResults };
    if (nextPageToken) body.nextPageToken = nextPageToken;
    const page = await post("/rest/api/3/search/jql", body);
    out.push(...(page.issues || []));
    nextPageToken = page.nextPageToken;
  } while (nextPageToken && out.length < 2000);
  return out;
}

export { BASE, EMAIL };
