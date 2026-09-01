/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Client for CogniRunner's Rules REST API (the `rules-api` web trigger) — used by the
// listeners / scheduled-jobs live E2E scripts. Env (test-harness/.env):
//   RULES_API_URL   the web-trigger URL (discovered via the dev test-state hook when absent)
//   RULES_API_TOKEN a bearer token (minted via the dev test-state hook when absent)
//   TESTSTATE_URL + HARNESS_SECRET  the dev-only harness-test-state web trigger + its bearer
import { loadEnv } from "./env.mjs";

const env = loadEnv();

const call = async (url, opts = {}) => {
  const res = await fetch(url, opts);
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  return { status: res.status, ok: res.ok, body };
};

/** Dev test-state hook (Bearer HARNESS_SECRET). */
export const testState = {
  url: () => env.TESTSTATE_URL,
  get: async (what, extra = "") => call(`${env.TESTSTATE_URL}?what=${what}${extra}`, { headers: { Authorization: `Bearer ${env.HARNESS_SECRET}` } }),
  post: async (body) => call(env.TESTSTATE_URL, { method: "POST", headers: { Authorization: `Bearer ${env.HARNESS_SECRET}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }),
};

let _url = env.RULES_API_URL || null;
let _token = env.RULES_API_TOKEN || null;

/** Resolve URL + token (mint through the dev hook when not configured). */
export const ensureRulesApi = async () => {
  if (!_url) {
    if (!env.TESTSTATE_URL || !env.HARNESS_SECRET) throw new Error("Set RULES_API_URL+RULES_API_TOKEN, or TESTSTATE_URL+HARNESS_SECRET so they can be discovered/minted.");
    const r = await testState.get("rulesApiUrl");
    if (!r.ok || !r.body || !r.body.url) throw new Error(`Could not discover the rules-api URL via the test hook: ${r.status} ${JSON.stringify(r.body)}`);
    _url = r.body.url;
  }
  if (!_token) {
    const r = await testState.post({ action: "mintApiToken", name: `harness ${new Date().toISOString()}` });
    if (!r.ok || !r.body || !r.body.token) throw new Error(`Could not mint an API token via the test hook: ${r.status} ${JSON.stringify(r.body)}`);
    _token = r.body.token;
  }
  return { url: _url, token: _token };
};

export const api = async (method, query, body) => {
  const { url, token } = await ensureRulesApi();
  const qs = Object.entries(query || {}).filter(([, v]) => v != null).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
  return call(`${url}?${qs}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
};

export const rulesApi = {
  whoami: () => api("GET", { resource: "whoami" }),
  events: () => api("GET", { resource: "events" }),
  actions: () => api("GET", { resource: "actions" }),
  listeners: {
    list: () => api("GET", { resource: "listeners" }),
    get: (id) => api("GET", { resource: "listeners", id }),
    create: (body) => api("POST", { resource: "listeners" }, body),
    update: (id, body) => api("PUT", { resource: "listeners", id }, body),
    remove: (id) => api("DELETE", { resource: "listeners", id }),
    enable: (id) => api("POST", { resource: "listeners", id, action: "enable" }),
    disable: (id) => api("POST", { resource: "listeners", id, action: "disable" }),
    test: (id, body) => api("POST", { resource: "listeners", id, action: "test" }, body || {}),
  },
  jobs: {
    list: () => api("GET", { resource: "jobs" }),
    get: (id) => api("GET", { resource: "jobs", id }),
    create: (body) => api("POST", { resource: "jobs" }, body),
    update: (id, body) => api("PUT", { resource: "jobs", id }, body),
    remove: (id) => api("DELETE", { resource: "jobs", id }),
    enable: (id) => api("POST", { resource: "jobs", id, action: "enable" }),
    disable: (id) => api("POST", { resource: "jobs", id, action: "disable" }),
    run: (id) => api("POST", { resource: "jobs", id, action: "run" }),
    preview: (id, body) => api("POST", { resource: "jobs", id, action: "preview" }, body || {}),
  },
  task: (id) => api("GET", { resource: "tasks", id }),
  logs: (ruleId) => api("GET", { resource: "logs", ruleId }),
  sample: (eventType) => api("GET", { resource: "samples", eventType }),
};

/** Poll a queued task until done/error (default 3s × 60). */
export const waitForTask = async (taskId, { intervalMs = 3000, tries = 60 } = {}) => {
  for (let i = 0; i < tries; i++) {
    const r = await rulesApi.task(taskId);
    if (r.body && (r.body.status === "done" || r.body.status === "error")) return r.body;
    await new Promise((res) => setTimeout(res, intervalMs));
  }
  return { status: "timeout" };
};

/** Poll the logs of a rule until `predicate(logs)` holds (default 5s × 48 = 4 min). */
export const waitForLogs = async (ruleId, predicate, { intervalMs = 5000, tries = 48 } = {}) => {
  let last = [];
  for (let i = 0; i < tries; i++) {
    const r = await rulesApi.logs(ruleId);
    last = (r.body && r.body.logs) || [];
    if (predicate(last)) return { ok: true, logs: last };
    await new Promise((res) => setTimeout(res, intervalMs));
  }
  return { ok: false, logs: last };
};
