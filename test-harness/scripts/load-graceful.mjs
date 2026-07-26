/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Frontier #5 — GRACEFUL DEGRADATION under sustained AI load. Fires the hardened
// validator self-loop on a pool of VALID-content issues (unique genuine task
// summaries that PASS the validator) at high concurrency, so AI throttle (429
// from the provider) actually builds. The point: under throttle the validator
// must FAIL OPEN (transition ALLOWED, HTTP 204) rather than hard-fail — i.e.
// degrade (slow) not collapse. Hard failures (5xx / unexpected) must be ~0, and
// genuine content must not be wrongly BLOCKED.
//
//   LOAD_N=150 LOAD_CONC=60 node scripts/load-graceful.mjs   (CLEAN=1 deletes the temp issues)

import { post, doTransition, getTransitions, mapLimit, searchJql, resetStats, stats } from "../lib/jira.mjs";
import { loadState, writeResult } from "../lib/state.mjs";

const N = parseInt(process.env.LOAD_N || "150", 10);
const CONC = parseInt(process.env.LOAD_CONC || "60", 10);
const CLEAN = process.env.CLEAN === "1";

const VERBS = ["pagination", "rate limiting", "caching", "input validation", "audit logging", "retry/backoff", "bulk import", "CSV export", "webhook delivery", "SSO login", "soft delete", "search indexing"];
const MODULES = ["reports", "billing", "users", "projects", "notifications", "search", "attachments", "dashboards", "settings", "api-gateway", "scheduler", "inbox"];
// Unique, GENUINE task summaries — pass the hardened "is this a real task" validator.
const summaryFor = (i) => `Implement ${VERBS[i % VERBS.length]} for the ${MODULES[(i * 7) % MODULES.length]} module (item ${i})`;

async function createIssue(s, summary) {
  const r = await post("/rest/api/3/issue", { fields: { project: { key: s.projectKey }, issuetype: { id: s.primaryIssueType.id }, summary, labels: ["cogtest-harness", "load-graceful"] } });
  return r.key;
}

async function main() {
  const s = loadState();
  const vt = s.ruleTransitions?.["V-hardened"];
  if (!vt) throw new Error("V-hardened transition not in testbed");
  const tid = vt.transitionId;
  console.log(`=== Frontier #5: graceful degradation — V-hardened (${tid}) on ${N} valid issues @ concurrency ${CONC} ===\n`);

  console.log(`Creating ${N} valid-content issues…`);
  const keys = await mapLimit(Array.from({ length: N }, (_, i) => i), 12, async (i) => createIssue(s, summaryFor(i)));
  console.log(`Created ${keys.length}. Firing the hardened validator at concurrency ${CONC} (AI per fire)…\n`);

  // Confirm the self-loop is available on a fresh issue (it's on the hub/initial status).
  const tr = await getTransitions(keys[0]);
  if (!(tr.transitions || []).some((t) => String(t.id) === String(tid))) console.log(`  ⚠ transition ${tid} not available on ${keys[0]} — issues may not be on the hub status.`);

  resetStats();
  const codes = {};
  const lat = [];
  const t0 = Date.now();
  await mapLimit(keys, CONC, async (key) => {
    const a = Date.now();
    const r = await doTransition(key, tid);
    lat.push(Date.now() - a);
    codes[r.status] = (codes[r.status] || 0) + 1;
  });
  const wall = Date.now() - t0;
  lat.sort((x, y) => x - y);
  const pct = (p) => lat[Math.min(lat.length - 1, Math.floor(lat.length * p))] || 0;

  const allowed = codes[204] || 0;
  const blocked = codes[400] || 0;
  const hardFail = Object.entries(codes).filter(([c]) => Number(c) >= 500 || (Number(c) >= 401 && Number(c) !== 400)).reduce((n, [, v]) => n + v, 0);
  const summary = {
    N, concurrency: CONC, wallMs: wall, throughputPerSec: +(keys.length / (wall / 1000)).toFixed(2),
    httpCodes: codes, allowed, blocked, hardFail,
    jiraStats: { requests: stats.requests, status429: stats.status429, status5xx: stats.status5xx, retries: stats.retries },
    latencyMs: { p50: pct(0.5), p90: pct(0.9), p99: pct(0.99), max: lat[lat.length - 1] || 0 },
  };
  writeResult("load-graceful.json", summary);

  console.log(`=== result ===`);
  console.log(`  ${keys.length} validator fires in ${(wall / 1000).toFixed(1)}s (${summary.throughputPerSec}/s)`);
  console.log(`  HTTP codes: ${JSON.stringify(codes)}`);
  console.log(`  allowed (204, incl. fail-open): ${allowed} | blocked (400): ${blocked} | HARD FAIL (5xx/4xx-other): ${hardFail}`);
  console.log(`  Jira-layer 429: ${stats.status429} | 5xx: ${stats.status5xx} | client retries: ${stats.retries}`);
  console.log(`  latency p50/p90/p99/max: ${pct(0.5)}/${pct(0.9)}/${pct(0.99)}/${lat[lat.length - 1]} ms`);
  console.log(hardFail === 0
    ? "\nGRACEFUL ✅ — zero hard failures; AI throttle (if any) absorbed by fail-open/retry."
    : `\n⚠ ${hardFail} hard failure(s) — inspect; graceful degradation NOT total.`);
  console.log("(grep forge logs during/after for: 'temporarily unavailable (429)', 'fail-open', 'retry', validator reasons to see how many fires throttled.)");

  if (CLEAN) {
    const rows = await searchJql('project=COGTEST AND labels="load-graceful"', ["summary"], 500);
    for (const r of rows) { try { await post(`/rest/api/3/issue/${r.key}/delete`, {}); } catch { /* */ } }
    console.log(`\nCLEAN: deleted ${rows.length} temp issue(s).`);
  } else {
    console.log("\nRun CLEAN=1 … to delete the temp issues.");
  }
}

main().catch((e) => { console.error("LOAD FAILED:", e.message); if (e.body) console.error(JSON.stringify(e.body).slice(0, 400)); process.exit(1); });
