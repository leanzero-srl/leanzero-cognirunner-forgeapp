/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// AT-SCALE premade-rule run — the deterministic analogue of the ~782-case AI
// barrage. Fires each field-based premade VALIDATOR across a large sample of real
// COGTEST issues and asserts that LIVE Jira enforcement (block/allow) matches the
// executor's INDEPENDENT prediction (run offline over the same issue's real
// fields). Agreement across hundreds of (rule × issue) pairs proves correctness at
// scale with a real oracle; any disagreement is a genuine bug surfaced with detail.
// Conditions are also evaluated by the executor over every issue (coverage +
// block/allow distribution) — they can't be enforced live (UI-only on REST).
//
//   node test-harness/scripts/premade-scale.mjs [--issues=50]
//
// Uses the SAME rule configs as full-workflow.mjs (imported) so the attached rule
// and the predicted rule never drift.

import { get, getTransitions, doTransition, searchJql, mapLimit } from "../lib/jira.mjs";
import { attachSelfLoopRules, readWorkflow, updateWorkflow } from "../lib/workflow.mjs";
import { loadState, writeResult } from "../lib/state.mjs";
import { executePremadeRule } from "../../src/premade-rules.js";
import { ruleSet } from "./full-workflow.mjs";

const s = loadState();
const argN = (process.argv.find((a) => a.startsWith("--issues=")) || "").split("=")[1];
const N_ISSUES = parseInt(argN || "50", 10);

const { V, C } = ruleSet();
// Field-based validators only (structural ones — sub-tasks/attachment/comment —
// need bespoke issue states, not a random corpus). These predict + fire cleanly.
const validators = V.filter((r) => !r.probe?.struct && !r.probe?.comment);
const conditions = C; // all conditions get executor coverage over the corpus

async function main() {
  if (!s.workflowName) throw new Error("Run setup-testbed.mjs first.");

  // 1. Attach the validator set as SCALE- self-loops (idempotent; same configs as full-workflow).
  {
    const { top, wf } = await readWorkflow(s.workflowName);
    const before = wf.transitions.length;
    wf.transitions = wf.transitions.filter((t) => !String(t.name || "").startsWith("SCALE-"));
    if (wf.transitions.length !== before) await updateWorkflow(top, wf);
  }
  const specs = validators.map((r, i) => ({ name: `SCALE-${i}`, type: "validator", config: r.config, _rule: r }));
  await attachSelfLoopRules(s.workflowName, s.hubStatusRef, specs, 9601);
  console.log(`Attached ${specs.length} field-based validators as SCALE- transitions.`);

  // 2. Sample real issues that are in the hub status (so the self-loops are available).
  const res = await searchJql(
    `project = ${s.projectKey} AND status = "${s.hubStatusName}" ORDER BY created DESC`,
    ["summary"], N_ISSUES,
  );
  const issues = (res.issues || res || []).slice(0, N_ISSUES).map((x) => x.key);
  if (issues.length < 5) throw new Error(`only ${issues.length} issues in status "${s.hubStatusName}" — need more; create some first.`);
  console.log(`Sampled ${issues.length} real issues in "${s.hubStatusName}".`);

  // 3. Build the name->transitionId map once (self-loop ids are workflow-global).
  const tr0 = await getTransitions(issues[0]);
  const idByName = {};
  for (const t of tr0.transitions || []) if (String(t.name).startsWith("SCALE-")) idByName[t.name] = t.id;

  // 4. The matrix. Per issue: fetch all fields ONCE (cache), predict every validator
  //    from the cache, fire it live, and compare. mapLimit bounds REST concurrency.
  let live = 0, agree = 0, disagree = 0, predBlock = 0, predAllow = 0, execErr = 0;
  const disagreements = [];
  let condEvals = 0, condShow = 0, condHide = 0, condErr = 0;

  await mapLimit(issues, 4, async (key) => {
    let fields = {};
    try { fields = (await get(`/rest/api/3/issue/${key}?fields=*all`)).fields || {}; } catch { /* leave empty */ }
    const readField = async (_k, fid) => fields[fid];
    const tr = await getTransitions(key);
    const present = new Set((tr.transitions || []).map((t) => t.name));

    // VALIDATORS — predict (offline executor over cached fields) + fire (live) + compare.
    for (const spec of specs) {
      const tid = idByName[spec.name];
      if (!tid || !present.has(spec.name)) continue;
      let predicted;
      try {
        const out = await executePremadeRule(spec.config, { issue: { key }, modifiedFields: {} }, "validator", { readField });
        predicted = out?.result === false; // true = predicted BLOCK
      } catch { execErr++; continue; }
      if (predicted) predBlock++; else predAllow++;
      const r = await doTransition(key, tid);
      const blockedLive = r.status >= 400;
      live++;
      if (blockedLive === predicted) agree++;
      else { disagree++; if (disagreements.length < 25) disagreements.push(`${spec._rule.name} @ ${key}: predicted ${predicted ? "BLOCK" : "ALLOW"}, live ${blockedLive ? "BLOCK" : "ALLOW"} (HTTP ${r.status})`); }
    }

    // CONDITIONS — executor coverage over real data (no live enforcement possible).
    for (const c of conditions) {
      try {
        const out = await executePremadeRule(c.config, { issue: { key } }, "condition", { readField });
        condEvals++; if (out?.result === false) condHide++; else condShow++;
      } catch { condErr++; }
    }
  });

  // 5. Report
  console.log("\n===== PREMADE AT-SCALE RUN =====");
  console.log(`Issues sampled:            ${issues.length}`);
  console.log(`Validators × issues (LIVE, oracle = executor-vs-Jira):`);
  console.log(`  live (rule×issue) pairs: ${live}`);
  console.log(`  AGREE (correct):         ${agree}`);
  console.log(`  DISAGREE (bugs):         ${disagree}`);
  console.log(`  executor errors:         ${execErr}`);
  console.log(`  predicted block/allow:   ${predBlock} / ${predAllow}`);
  console.log(`Conditions × issues (executor coverage):`);
  console.log(`  evaluations:             ${condEvals}  (show ${condShow} / hide ${condHide}, errors ${condErr})`);
  const totalChecks = live + condEvals;
  console.log(`\nTOTAL checks this run:     ${totalChecks}  (${live} live-enforced + ${condEvals} executor-evaluated)`);
  if (disagreements.length) { console.log("\nDISAGREEMENTS (executor vs live — investigate):"); for (const d of disagreements) console.log("  - " + d); }
  else console.log("\nNo executor-vs-live disagreements — premade validators enforce exactly as the executor predicts, at scale.");

  writeResult("premade-scale", { at: new Date().toISOString(), issues: issues.length, validators: specs.length, live, agree, disagree, predBlock, predAllow, execErr, condEvals, condShow, condHide, condErr, totalChecks, disagreements });
  console.log("\nReport -> results/premade-scale. SCALE- transitions left attached.");
  if (disagree > 0 || execErr > 0 || condErr > 0) process.exit(1);
}

main().catch((e) => { console.error("SCALE RUN FAILED:", e.message); if (e.body) console.error(JSON.stringify(e.body, null, 2)); process.exit(1); });
