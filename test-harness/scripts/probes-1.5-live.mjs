/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * FRAME-1.5 §5 platform probes P1–P4, driven live against the dev-gated
 * `harness-test-state` web trigger (src/test-hook.js). Read-only on the app: every
 * lever already exists in the tree; this file only calls them and prints the evidence.
 *
 *   P1  probeJsmComment          — the JSM audience contradiction (internal vs public)
 *   P2  probeConfluenceInstalled — the not-installed answer's SHAPE, per environment
 *   P3  probeConfluenceFromConsumer — requestConfluence from the standard + long consumer
 *   P4  probeServicedeskFromConsumer — servicedeskapi from the LONG consumer
 *
 * Usage (from test-harness/):
 *   node scripts/probes-1.5-live.mjs --probe=P1 --issue=JT-15
 *   node scripts/probes-1.5-live.mjs --probe=P2 --env=dev
 *   node scripts/probes-1.5-live.mjs --probe=P2 --env=staging
 *   node scripts/probes-1.5-live.mjs --probe=P3 --env=staging
 *   node scripts/probes-1.5-live.mjs --probe=P4 --env=dev
 *
 * Env: TESTSTATE_URL + HARNESS_SECRET from .env for `dev`; STAGING_TESTSTATE_URL for
 * `staging` (mint it with `forge webtrigger create -f harness-test-state -e staging`).
 * NOTHING secret is ever printed — not the URL, not the Bearer, not a comment body.
 */

import { loadEnv, requireEnv } from "../lib/env.mjs";

const env = loadEnv();
const arg = (n, d) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};

const SECRET = requireEnv("HARNESS_SECRET");
const URLS = { dev: env.TESTSTATE_URL, staging: env.STAGING_TESTSTATE_URL };
const die = (m) => { console.error("PROBE FAIL:", m); process.exit(1); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function hook(envName, body, method = "POST") {
  const url = URLS[envName];
  if (!url) die(`no web-trigger URL for environment "${envName}" (set ${envName === "dev" ? "TESTSTATE_URL" : "STAGING_TESTSTATE_URL"})`);
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + SECRET },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* non-JSON */ }
  // A 404 here is the hook's own refusal shape (secret rotated without a redeploy).
  return { status: res.status, json, raw: json ? null : text.slice(0, 200) };
}

async function reachable(envName) {
  const ping = await hook(envName, null, "GET");
  if (ping.status !== 200) die(`${envName}: web trigger not reachable / secret rejected (GET → ${ping.status}). Rotating HARNESS_SECRET needs a redeploy of that environment.`);
  console.log(`✓ ${envName}: web trigger reachable, secret accepted`);
}

// ───────────────────────── P1 ─────────────────────────
async function p1(envName, issueKey) {
  if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(issueKey)) die("--issue=<JSM request key> required for P1");
  console.log(`\nP1 — JSM audience on ${issueKey} (${envName})`);
  const rows = [];
  for (const mode of ["internal", "public"]) {
    const r = await hook(envName, { action: "probeJsmComment", issueKey, mode });
    if (r.status !== 200) die(`P1 ${mode}: hook ${r.status}`);
    const o = r.json;
    rows.push(o);
    console.log(`  ${mode.padEnd(8)} post=${o.postStatus} read=${o.readStatus} jsdPublic=${o.jsdPublic} property=${o.propertyStatus} echo=${JSON.stringify(o.propertyEcho)} delete=${o.deleteStatus} errorClass=${o.errorClass}`);
    console.log(`           jsd comment keys: ${(o.keys || []).join(",")}`);
  }
  return rows;
}

// ───────────────────────── P2 ─────────────────────────
async function p2(envName) {
  console.log(`\nP2 — Confluence install probe (${envName})`);
  const r = await hook(envName, { action: "probeConfluenceInstalled" });
  if (r.status !== 200) die(`P2: hook ${r.status}`);
  const o = r.json;
  console.log(`  installed=${o.installed} status=${o.status} code=${o.code} bodyKeys=[${(o.bodyKeys || []).join(",")}] probePath=${o.probePath} errorClass=${o.errorClass || "-"}`);
  return o;
}

// ──────────────────────── P3 / P4 ────────────────────────
async function consumerProbe(envName, action, kind, long, timeoutMs = 180000) {
  const r = await hook(envName, { action, long });
  if (r.status !== 200 || !r.json || !r.json.id) die(`${action}: enqueue failed (${r.status} ${JSON.stringify(r.json)})`);
  const { id, queue } = r.json;
  console.log(`  enqueued id=${id} kind=${kind} queue=${queue} — polling ≤${timeoutMs / 1000}s`);
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const rd = await hook(envName, { action: "readHarnessProbe", id, kind });
    if (rd.status === 200 && rd.json && rd.json.value) {
      console.log(`  → ${JSON.stringify(rd.json.value)}  (after ${Math.round((Date.now() - started) / 1000)}s)`);
      return rd.json.value;
    }
    await sleep(5000);
  }
  console.log(`  → NO ROW after ${timeoutMs / 1000}s — the consumer did not write (check forge logs -e ${envName})`);
  return null;
}

async function main() {
  const probe = String(arg("probe", "all")).toUpperCase();
  const envName = arg("env", "dev");
  const issueKey = arg("issue", "");
  await reachable(envName);
  if (probe === "P1" || probe === "ALL") await p1(envName, issueKey);
  if (probe === "P2" || probe === "ALL") await p2(envName);
  if (probe === "P3" || probe === "ALL") {
    console.log(`\nP3 — requestConfluence FROM THE CONSUMER (${envName})`);
    for (const long of [false, true]) {
      console.log(` ${long ? "long" : "standard"} queue:`);
      await consumerProbe(envName, "probeConfluenceFromConsumer", "confluence", long);
    }
  }
  if (probe === "P4" || probe === "ALL") {
    console.log(`\nP4 — servicedeskapi FROM THE LONG CONSUMER (${envName})`);
    await consumerProbe(envName, "probeServicedeskFromConsumer", "servicedesk", true);
  }
}

main().catch((e) => die(String((e && e.message) || e)));
