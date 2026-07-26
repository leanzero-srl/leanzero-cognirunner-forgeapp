/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Frontier #2 — ASYNC-FLOOD / runtime memory auto-capture (REQUIRES admin autoCapture ON).
// Drives static-PF step FAILURES so the opt-in auto-capture path fires (index.js
// dispatchPostFunction failure hook): a NON-transient, NOVEL errorSig queues a
// `memory_distill` async task; a KNOWN errorSig reinforces in-place with NO AI call and
// NO queue; a TRANSIENT failure (429/5xx/timeout) is SKIPPED entirely (F13). PFs never
// block the transition (post-function), so the side effect is in `forge logs`, not HTTP.
//
// Three scenarios (each FLOOD-* rule fires ONCE per FRESH issue to dodge the per-issue PF
// brake + 5s dedup so the step actually executes):
//   A DISTINCT : 5 rules, 5 distinct non-transient errors -> expect ~5 distinct novel
//                errorSigs -> ~5 `executing memory_distill` lines in forge logs.
//   C TRANSIENT: 1 rule throwing a 503/gateway-timeout string -> isTransientStepError ->
//                expect NO distill queued for it (F13 control).
//   B REINFORCE: after the A-distills drain (their errorSigs now exist as memories),
//                re-fire 2 of the A rules on fresh issues -> expect reinforce (silent,
//                NO new distill). Observed as the ABSENCE of fresh distill executions.
//
// Observability: forge-logs only. `pf_memories` is admin-resolver-gated (getMemories) with
// NO REST path, so memory CONTENT / reinforcement counts can't be black-box read — a
// documented limitation. The script prints the exact grep + the timestamps to correlate.
// NOTE: this WRITES real memories (source:"test") to the instance — owner may clear later.
//
//   node scripts/async-flood.mjs            (CLEAN=1 removes the FLOOD-* transitions after)

import { loadState, writeResult } from "../lib/state.mjs";
import { readWorkflow, updateWorkflow, attachSelfLoopRules } from "../lib/workflow.mjs";
import { post, getTransitions, doTransition, sleep } from "../lib/jira.mjs";

const CLEAN = process.env.CLEAN === "1";
const DRAIN_MS = parseInt(process.env.FLOOD_DRAIN_MS || "75000", 10);

const s = loadState();
const hub = s.hubStatusRef;
const wfName = s.workflowName;
if (!hub || !wfName) { console.error("testbed missing hub / workflow"); process.exit(2); }

// --- Deliberate-failure step bodies. Each must fail with a DISTINCT non-transient error. ---
const K = "api.context.issueKey";
const FAILS = {
  "FLOOD-badfield": `await api.updateIssue(${K}, { "customfield_999999": "x" });`,                 // Jira 400: unknown field
  "FLOOD-badtransition": `await api.transitionIssue(${K}, "888888");`,                              // invalid transition id
  "FLOOD-typeerror": `const o = null; api.log("v=" + o.deep.value);`,                               // TypeError (null deref)
  "FLOOD-badjql": `await api.searchJql("project = AND ORDER zzz (((");`,                            // JQL parse 400
  "FLOOD-referror": `await api.log("pre"); boomUndefinedHelper(123);`,                              // ReferenceError
};
const TRANSIENT_RULE = "FLOOD-transient";
const TRANSIENT_CODE = `throw new Error("Upstream returned 503 Service Unavailable (gateway timeout)");`; // F13 skip

const staticCfg = (name, code) => ({ name, type: "static", config: { type: "postfunction-static", functions: [{ name, code, variableName: "step1" }] } });

async function removeFloodTransitions() {
  const { top, wf } = await readWorkflow(wfName);
  const before = wf.transitions.length;
  wf.transitions = wf.transitions.filter((t) => !/^FLOOD-/.test(String(t.name || "")));
  if (wf.transitions.length !== before) await updateWorkflow(top, wf);
  return before - wf.transitions.length;
}

async function freshIssue(tag) {
  const r = await post("/rest/api/3/issue", { fields: {
    project: { key: s.projectKey }, issuetype: { id: s.primaryIssueType.id },
    summary: `FLOOD ${tag} ${Date.now()}`, labels: ["cogtest-harness", "async-flood"],
  } });
  return r.key;
}

// Fire a FLOOD rule on a brand-new issue so it actually executes (no brake/dedup).
async function fireOnFresh(name, tid) {
  const key = await freshIssue(name);
  await sleep(1200); // let the self-loop register on the fresh issue
  const tr = await getTransitions(key);
  if (!(tr.transitions || []).some((t) => String(t.id) === String(tid))) {
    return { name, key, fired: false, note: "transition not available on fresh issue" };
  }
  const ts = new Date().toISOString();
  const r = await doTransition(key, tid);
  return { name, key, fired: true, http: r.status, at: ts };
}

async function main() {
  console.log("=== Frontier #2: async-flood / runtime memory auto-capture (autoCapture must be ON) ===\n");
  await removeFloodTransitions();

  const specs = [...Object.entries(FAILS).map(([n, c]) => staticCfg(n, c)), staticCfg(TRANSIENT_RULE, TRANSIENT_CODE)];
  const attached = await attachSelfLoopRules(wfName, hub, specs, 9720);
  const tid = Object.fromEntries(attached.map((a) => [a.name, a.transitionId]));
  console.log(`attached: ${attached.map((a) => `${a.name}=${a.transitionId}`).join(", ")}\n`);

  const out = { startedAt: new Date().toISOString(), fired: { distinct: [], transient: null, reinforce: [] } };

  // --- A: DISTINCT non-transient failures (novel errorSigs -> distill tasks) ---
  console.log("A DISTINCT — firing 5 distinct-failing PFs (each on a fresh issue):");
  for (const name of Object.keys(FAILS)) {
    const r = await fireOnFresh(name, tid[name]);
    out.fired.distinct.push(r);
    console.log(`   ${name}: issue ${r.key} HTTP ${r.http ?? "-"} ${r.fired ? "(fired)" : "(" + r.note + ")"}`);
    await sleep(800);
  }

  // --- C: TRANSIENT failure (F13 — must NOT distill) ---
  console.log("\nC TRANSIENT — firing a 503/gateway-timeout failure (expect NO distill, F13):");
  out.fired.transient = await fireOnFresh(TRANSIENT_RULE, tid[TRANSIENT_RULE]);
  console.log(`   ${TRANSIENT_RULE}: issue ${out.fired.transient.key} HTTP ${out.fired.transient.http ?? "-"}`);

  // --- drain the queue so A's distills persist their errorSigs ---
  console.log(`\nDraining the async queue for ${DRAIN_MS / 1000}s (memory_distill consumer, 1h TTL tasks)…`);
  await sleep(DRAIN_MS);

  // --- B: REINFORCE (known errorSig -> reinforce in-place, NO new distill) ---
  console.log("\nB REINFORCE — re-firing 2 of the A rules on fresh issues (expect reinforce, NO new distill):");
  for (const name of ["FLOOD-badfield", "FLOOD-typeerror"]) {
    const r = await fireOnFresh(name, tid[name]);
    out.fired.reinforce.push(r);
    console.log(`   ${name} (repeat): issue ${r.key} HTTP ${r.http ?? "-"} at ${r.at}`);
    await sleep(800);
  }
  out.finishedAt = new Date().toISOString();
  writeResult("async-flood.json", out);

  console.log("\n=== how to assess (forge logs) ===");
  console.log("  A: ~5 distinct  'Async handler: executing memory_distill (memdistill_…)'  lines (novel sigs queued).");
  console.log("  C: the transient fire must produce NO memory_distill for its issue (F13 skip — non-transient gate).");
  console.log("  B: the repeat fires must NOT add NEW distill executions (reinforce is silent + queue-free in index.js).");
  console.log("  Grep:  forge logs | grep -E 'executing memory_distill|memory_distill.*completed|Memory auto-capture'");
  console.log(`  Window: ${out.startedAt} … ${out.finishedAt}`);
  console.log("  (pf_memories content/reinforcement counts are admin-resolver-only — not black-box readable.)");

  if (CLEAN) {
    const removed = await removeFloodTransitions();
    console.log(`\nCLEAN: removed ${removed} FLOOD-* transition(s). (temp issues left; harness token lacks delete perm.)`);
  } else {
    console.log("\nRun CLEAN=1 to remove the FLOOD-* transitions afterwards.");
  }
}

main().catch((e) => { console.error("ASYNC-FLOOD FAILED:", e.message); if (e.body) console.error(JSON.stringify(e.body).slice(0, 400)); process.exit(1); });
