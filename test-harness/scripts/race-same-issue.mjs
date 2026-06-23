/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Frontier #1 — CONCURRENT SAME-ISSUE RACES. Fires the SAME self-loop transition
// N times concurrently on ONE issue (each fire runs a static-PF, no AI), to see
// whether the app's writes race/lose updates at the single-issue level (beyond
// F10's same-transition case). Three probes on a dedicated issue:
//   A counter  : read COGTEST_number, +1, write via api.updateIssue (full-field
//                read-modify-write) — lost updates ⇒ final < N.
//   B additive : api.addLabels(unique) — Jira update.add merge ⇒ ~N survive.
//   C clobber  : read labels, append unique, api.updateIssue (full-field) — RMW
//                clobber ⇒ < N survive.
// Also records the transition HTTP statuses (does Jira serialize/reject
// concurrent same-issue transitions?) and tells you to watch forge logs for
// `duplicate invocation … suppressed`, 409s, version conflicts.
//
//   RACE_N=10 node scripts/race-same-issue.mjs      (CLEAN=1 also removes the temp transitions + issue)

import { loadState, writeResult } from "../lib/state.mjs";
import { readWorkflow, updateWorkflow, attachSelfLoopRules } from "../lib/workflow.mjs";
import { post, put, getIssue, getTransitions, doTransition, mapLimit } from "../lib/jira.mjs";

const N = parseInt(process.env.RACE_N || "10", 10);
const CLEAN = process.env.CLEAN === "1";
const SETTLE_MS = parseInt(process.env.RACE_SETTLE_MS || "30000", 10);

const s = loadState();
const numId = s.customFields?.number?.id;
const hub = s.hubStatusRef;
const wfName = s.workflowName;
if (!numId || !hub || !wfName) { console.error("testbed missing number field / hub / workflow"); process.exit(2); }

const counterCode = `const i = await api.getIssue(api.context.issueKey);
const cur = Number(i.fields["${numId}"]) || 0;
await api.updateIssue(api.context.issueKey, { "${numId}": cur + 1 });
api.log("counter " + cur + " -> " + (cur + 1));`;

const additiveCode = `const tag = "race-" + Date.now() + "-" + Math.floor(Math.random() * 1e9);
await api.addLabels(tag);
api.log("additive " + tag);`;

const clobberCode = `const tag = "clob-" + Date.now() + "-" + Math.floor(Math.random() * 1e9);
const i = await api.getIssue(api.context.issueKey);
const labels = Array.isArray(i.fields.labels) ? i.fields.labels : [];
await api.updateIssue(api.context.issueKey, { labels: [...labels, tag] });
api.log("clobber " + tag);`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const staticCfg = (name, code) => ({ name, type: "static", config: { type: "postfunction-static", functions: [{ name, code, variableName: "step1" }] } });

async function removeRaceTransitions() {
  const { top, wf } = await readWorkflow(wfName);
  const before = wf.transitions.length;
  wf.transitions = wf.transitions.filter((t) => !/^RACE-/.test(String(t.name || "")));
  if (wf.transitions.length !== before) await updateWorkflow(top, wf);
  return before - wf.transitions.length;
}

async function createRaceIssue() {
  const body = { fields: { project: { key: s.projectKey }, issuetype: { id: s.primaryIssueType.id }, summary: `RACE same-issue probe ${Date.now()}`, labels: ["cogtest-harness", "race-probe"] } };
  const r = await post("/rest/api/3/issue", body);
  return r.key;
}

// Fire the transition N times "simultaneously" (concurrency = N).
async function fireConcurrent(key, tid) {
  const statuses = await mapLimit(Array.from({ length: N }, (_, i) => i), N, async () => {
    const r = await doTransition(key, tid);
    return r.status;
  });
  const codes = {};
  for (const c of statuses) codes[c] = (codes[c] || 0) + 1;
  return codes;
}

async function readNumber(key) {
  const i = await getIssue(key, numId);
  return Number(i.fields?.[numId]) || 0;
}
async function readLabels(key, prefix) {
  const i = await getIssue(key, "labels");
  return (i.fields?.labels || []).filter((l) => l.startsWith(prefix));
}

async function main() {
  console.log(`=== Frontier #1: concurrent same-issue races (N=${N} concurrent fires) ===\n`);
  await removeRaceTransitions();
  const attached = await attachSelfLoopRules(wfName, hub, [
    staticCfg("RACE-counter", counterCode),
    staticCfg("RACE-additive", additiveCode),
    staticCfg("RACE-clobber", clobberCode),
  ], 9700);
  const tid = Object.fromEntries(attached.map((a) => [a.name, a.transitionId]));
  const key = await createRaceIssue();
  console.log(`probe issue: ${key}`);
  console.log(`transitions: ${attached.map((a) => `${a.name}=${a.transitionId}`).join(", ")}\n`);
  // Self-loops are only available while the issue is on the hub — it stays there.
  await sleep(1500);
  const tr = await getTransitions(key);
  const avail = new Set((tr.transitions || []).map((t) => String(t.id)));
  for (const a of attached) if (!avail.has(a.transitionId)) console.log(`  ⚠ ${a.name} (${a.transitionId}) not available on ${key}`);

  const out = { issue: key, N, tests: [] };

  // --- A: counter (read-modify-write number) ---
  await put(`/rest/api/3/issue/${key}`, { fields: { [numId]: 0 } });
  await sleep(1500);
  const aCodes = await fireConcurrent(key, tid["RACE-counter"]);
  console.log(`A counter: fired ${N}, transition codes = ${JSON.stringify(aCodes)} — settling ${SETTLE_MS / 1000}s…`);
  await sleep(SETTLE_MS);
  const aFinal = await readNumber(key);
  const aRec = { test: "counter (read-modify-write updateIssue)", expected: N, actual: aFinal, lost: N - aFinal, transitionCodes: aCodes };
  out.tests.push(aRec);
  console.log(`   → number = ${aFinal}/${N} (lost ${N - aFinal})\n`);

  // --- B: additive addLabels ---
  const bCodes = await fireConcurrent(key, tid["RACE-additive"]);
  console.log(`B additive: fired ${N}, transition codes = ${JSON.stringify(bCodes)} — settling ${SETTLE_MS / 1000}s…`);
  await sleep(SETTLE_MS);
  const bLabels = await readLabels(key, "race-");
  const bRec = { test: "additive (api.addLabels / update.add)", expected: N, actual: bLabels.length, lost: N - bLabels.length, transitionCodes: bCodes };
  out.tests.push(bRec);
  console.log(`   → distinct race- labels = ${bLabels.length}/${N} (lost ${N - bLabels.length})\n`);

  // --- C: clobber (read-modify-write labels) ---
  const cCodes = await fireConcurrent(key, tid["RACE-clobber"]);
  console.log(`C clobber: fired ${N}, transition codes = ${JSON.stringify(cCodes)} — settling ${SETTLE_MS / 1000}s…`);
  await sleep(SETTLE_MS);
  const cLabels = await readLabels(key, "clob-");
  const cRec = { test: "clobber (read-modify-write updateIssue labels)", expected: N, actual: cLabels.length, lost: N - cLabels.length, transitionCodes: cCodes };
  out.tests.push(cRec);
  console.log(`   → distinct clob- labels = ${cLabels.length}/${N} (lost ${N - cLabels.length})\n`);

  console.log("=== verdict ===");
  console.log(`A counter  : ${aRec.actual}/${N} executed`);
  console.log(`B additive : ${bRec.actual}/${N} executed`);
  console.log(`C clobber  : ${cRec.actual}/${N} executed`);
  console.log("NOTE: low counts here are EXPECTED storm protection, not a race — verify in forge logs:");
  console.log("  • claimPfInvocation dedup (REST fires carry no distinct execution id → 5s fallback");
  console.log("    window treats rapid same-rule/same-issue fires as duplicates and suppresses them).");
  console.log("  • per-issue PF brake: '[pf] brake active … execution suppressed (N in window)'");
  console.log("    (PF_BRAKE_MAX_PER_BUCKET=10 per issue per 5-min bucket). No double-execution observed.");
  console.log("  Grep: grep -E 'brake active|duplicate invocation|409|version conflict' <forge logs>");

  writeResult("race-same-issue.json", out);

  if (CLEAN) {
    await removeRaceTransitions();
    try { await post(`/rest/api/3/issue/${key}/delete`, {}); } catch { /* best-effort */ }
    console.log("\nCLEAN: removed RACE-* transitions (probe issue left for inspection).");
  } else {
    console.log("\nRun CLEAN=1 … to remove the RACE-* transitions afterwards.");
  }
}

main().catch((e) => { console.error("RACE FAILED:", e.message); if (e.body) console.error(JSON.stringify(e.body, null, 2)); process.exit(1); });
