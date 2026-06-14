/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Bulk-transition stress test — the realistic "a user bulk-modifies many issues
// and fires many validators / post-functions at once" scenario. Fires a chosen
// rule's transition across the whole BULK-* pool at high concurrency and
// measures throughput, HTTP status distribution, rate-limiting (429), AI errors,
// and whether every rule still fired correctly (PF mutation success rate).
//
// Concurrent individual transitions are the engine (controllable + observable);
// this is what bulk-edit / automation / external integrations effectively do.

import { doTransition, getIssue, mapLimit, sleep } from "../lib/jira.mjs";
import { buildRules } from "../fixtures/rules.mjs";
import { loadState, writeResult } from "../lib/state.mjs";

const CONCURRENCY = parseInt(process.env.BULK_CONCURRENCY || "12", 10);

function percentiles(arr) {
  if (!arr.length) return { p50: 0, p90: 0, p99: 0, max: 0 };
  const s = [...arr].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  return { p50: at(50), p90: at(90), p99: at(99), max: s[s.length - 1] };
}

async function fireBulk(label, transitionId, keys) {
  const statusCounts = {};
  const lats = [];
  let aiErrors = 0;
  const t0 = Date.now();
  const rows = await mapLimit(keys, CONCURRENCY, async (key) => {
    const a = Date.now();
    const r = await doTransition(key, transitionId);
    const ms = Date.now() - a;
    lats.push(ms);
    statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
    if (/ai\s*(service\s*)?error|timed out|timeout/i.test(r.text || "")) aiErrors++;
    return { key, status: r.status, ms };
  });
  const wall = Date.now() - t0;
  const p = percentiles(lats);
  const summary = {
    label, transitionId, count: keys.length, concurrency: CONCURRENCY,
    wallMs: wall, throughputPerSec: +(keys.length / (wall / 1000)).toFixed(2),
    statusCounts, aiErrors, latency: p,
  };
  console.log(`\n[${label}] ${keys.length} issues @concurrency ${CONCURRENCY}`);
  console.log(`  wall ${wall}ms · ${summary.throughputPerSec}/s · status ${JSON.stringify(statusCounts)} · aiErrors ${aiErrors}`);
  console.log(`  latency p50/p90/p99/max = ${p.p50}/${p.p90}/${p.p99}/${p.max} ms`);
  return { summary, rows };
}

async function verifyMutations(label, keys, field, predicate, waitMs = 30000) {
  await sleep(Math.min(waitMs, 8000));
  let ok = 0;
  const missing = [];
  // poll: re-check missing ones a few times (PFs may run async)
  let pending = [...keys];
  const deadline = Date.now() + waitMs;
  do {
    const still = [];
    await mapLimit(pending, CONCURRENCY, async (key) => {
      const iss = await getIssue(key, field);
      if (predicate(iss)) ok++;
      else still.push(key);
    });
    pending = still;
    if (pending.length === 0) break;
    await sleep(4000);
  } while (Date.now() < deadline);
  missing.push(...pending);
  console.log(`  [${label}] mutation success ${ok}/${keys.length}${missing.length ? ` (missing ${missing.length}: ${missing.slice(0, 6).join(",")}${missing.length > 6 ? "…" : ""})` : ""}`);
  return { ok, total: keys.length, missing };
}

async function main() {
  const state = loadState();
  if (!state.ruleTransitions || !state.issues) throw new Error("Run attach-rules + seed-issues first.");
  buildRules(state); // validate state shape
  const tx = state.ruleTransitions;

  const bulkKeys = Object.entries(state.issues)
    .filter(([, v]) => v.cls === "bulk")
    .map(([, v]) => v.key);
  if (bulkKeys.length === 0) throw new Error("No BULK-* issues seeded. Re-run seed-issues.");
  console.log(`Bulk pool: ${bulkKeys.length} issues.`);

  const report = { pool: bulkKeys.length, phases: [] };

  // Phase 1 — bulk VALIDATOR (1 AI call per issue; summaries are valid → expect 204)
  const v = await fireBulk("validator V-hardened", tx["V-hardened"].transitionId, bulkKeys);
  report.phases.push(v.summary);

  // Phase 2 — bulk STATIC PF (no AI; fast) — stresses PF execution + KVS under load
  const st = await fireBulk("static PF T1-tag", tx["T1-tag"].transitionId, bulkKeys);
  const stMut = await verifyMutations("static PF", bulkKeys, "labels",
    (iss) => (iss.fields.labels || []).includes("cogni-tagged"), 40000);
  report.phases.push({ ...st.summary, mutation: stMut });

  // Phase 3 — bulk SEMANTIC PF (1 AI call per issue; writes a field) — stresses the
  // async AI queue + provider rate limits under a flood.
  const sem = await fireBulk("semantic PF S1-text", tx["S1-text"].transitionId, bulkKeys);
  const textId = state.customFields.text.id;
  const semMut = await verifyMutations("semantic PF", bulkKeys, `${textId},updated`,
    (iss) => {
      const v2 = iss.fields[textId];
      const s = typeof v2 === "string" ? v2 : "";
      // S1 overwrites COGTEST_Text (seeded "bulk-N") with an AI summary
      return !!s && !/^bulk-\d+$/.test(s);
    }, 90000);
  report.phases.push({ ...sem.summary, mutation: semMut });

  writeResult("bulk-results.json", report);
  console.log("\n=== Bulk summary ===");
  for (const ph of report.phases) {
    const m = ph.mutation ? ` · mutated ${ph.mutation.ok}/${ph.mutation.total}` : "";
    console.log(`  ${ph.label}: ${ph.throughputPerSec}/s, status ${JSON.stringify(ph.statusCounts)}, aiErrors ${ph.aiErrors}${m}`);
  }
  console.log("Results -> results/bulk-results.json");
}

main().catch((e) => {
  console.error("BULK FAILED:", e.message);
  if (e.body) console.error(JSON.stringify(e.body, null, 2));
  process.exit(1);
});
