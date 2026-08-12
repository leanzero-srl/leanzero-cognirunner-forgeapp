/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// DIAGNOSTIC PROBE — settles two questions that finding F3 got wrong for months.
//
//  Q1. Does the configuration saved by the condition's Custom UI actually reach the
//      Jira expression as a PARSED OBJECT under `config`? Atlassian's docs say the
//      config is "available under the config context variable", but the Custom UI
//      returns it as a stringified JSON, so it might arrive as a string — in which
//      case config.<field> is undefined and no config-driven condition can work.
//
//  Q2. Does Jira enforce conditions on the REST transition path at all? F3 concluded
//      "conditions gate UI visibility, not REST", but that was never tested: the
//      app's expression was the literal `true`, so it passed everywhere and proved
//      nothing. This repeats the claim in ~16 places across the docs.
//
// Method: three conditions on three fresh self-loop transitions, differing ONLY in
// their saved config. The deployed expression is
//     config == null || config.conditionKind != "deterministic" ? true
//                                                              : (config.probe == "block" ? false : true)
// so:
//   legacy  (AI-shaped config, no conditionKind) -> expect AVAILABLE  (no regression)
//   allow   (deterministic, probe=allow)         -> expect AVAILABLE
//   block   (deterministic, probe=block)         -> expect HIDDEN + REST-rejected
//
// "block" being hidden proves BOTH: config arrives parsed AND conditions are
// enforced. If all three are available, config does not arrive parsed (or
// conditions are not enforced) — and the default-true guard means nothing broke.
//
// Read-only w.r.t. app state; creates and removes its own transitions.
// Run: node scripts/_probe-condition-config.mjs

import { getTransitions, doTransition, searchJql } from "../lib/jira.mjs";
import { readWorkflow, updateWorkflow, makeSelfLoop, buildRule, attachRuleToTransition, removeTransitionsByName } from "../lib/workflow.mjs";
import { loadState } from "../lib/state.mjs";

// The issue under test has a summary; these cases are written against that.
const CASES = [
  { name: "PROBE-cond-legacy", id: 9781, expect: "available", config: { id: "probe-legacy", type: "condition", fieldId: "summary", prompt: "anything" } },
  { name: "PROBE-cond-allow", id: 9782, expect: "available", config: { id: "probe-allow", type: "condition", conditionKind: "deterministic", probe: "allow" } },
  { name: "PROBE-cond-block", id: 9783, expect: "hidden", config: { id: "probe-block", type: "condition", conditionKind: "deterministic", probe: "block" } },
  // --- capability probes: which expression constructs actually work? ---
  // dynamic (computed) field access — the make-or-break one for a config-driven rule
  { name: "PROBE-cond-dyn-ok", id: 9784, expect: "available", config: { id: "p-dyn1", type: "condition", conditionKind: "deterministic", probe: "dyn", fieldId: "summary" } },
  { name: "PROBE-cond-dyn-no", id: 9785, expect: "hidden", config: { id: "p-dyn2", type: "condition", conditionKind: "deterministic", probe: "dyn", fieldId: "customfield_99999999" } },
  { name: "PROBE-cond-regex-ok", id: 9786, expect: "available", config: { id: "p-re1", type: "condition", conditionKind: "deterministic", probe: "regex", regex: "." } },
  { name: "PROBE-cond-regex-no", id: 9787, expect: "hidden", config: { id: "p-re2", type: "condition", conditionKind: "deterministic", probe: "regex", regex: "^ZZZ_NO_MATCH_ZZZ$" } },
  { name: "PROBE-cond-len-ok", id: 9788, expect: "available", config: { id: "p-len1", type: "condition", conditionKind: "deterministic", probe: "len", min: 1 } },
  { name: "PROBE-cond-len-no", id: 9789, expect: "hidden", config: { id: "p-len2", type: "condition", conditionKind: "deterministic", probe: "len", min: 100000 } },
  { name: "PROBE-cond-inc-no", id: 9790, expect: "hidden", config: { id: "p-inc2", type: "condition", conditionKind: "deterministic", probe: "inc", allowed: ["definitely-not-the-summary"] } },
];

const cleanup = async (workflowName) => {
  const { top, wf } = await readWorkflow(workflowName);
  if (removeTransitionsByName(wf, CASES.map((c) => c.name)) > 0) await updateWorkflow(top, wf);
};

async function main() {
  const s = loadState();
  const workflowName = s.workflowName;
  if (!workflowName || !s.hubStatusRef) { console.error("results/testbed.json missing workflowName/hubStatusRef"); process.exit(2); }

  const issues = await searchJql(`project = ${s.projectKey || "COGTEST"} AND labels = cogtest-harness AND status = "Backlog" ORDER BY created ASC`, ["summary"], 1);
  if (!issues.length) { console.error("no harness issue parked on the hub status"); process.exit(2); }
  const KEY = issues[0].key;

  await cleanup(workflowName);

  {
    const { top, wf } = await readWorkflow(workflowName);
    for (const c of CASES) {
      const t = makeSelfLoop(s.hubStatusRef, c.name, c.id);
      attachRuleToTransition(t, "condition", buildRule("condition", c.config));
      wf.transitions.push(t);
    }
    await updateWorkflow(top, wf);
  }
  console.log(`attached ${CASES.length} probe conditions to "${workflowName}"; testing on ${KEY}\n`);

  // Jira caches workflow reads briefly after an update.
  await new Promise((r) => setTimeout(r, 4000));

  const avail = await getTransitions(KEY);
  const availableIds = new Set((avail.transitions || []).map((t) => String(t.id)));

  let allAsExpected = true;
  for (const c of CASES) {
    const visible = availableIds.has(String(c.id));
    const rest = await doTransition(KEY, String(c.id));
    const got = visible ? "available" : "hidden";
    const match = got === c.expect;
    if (!match) allAsExpected = false;
    console.log(`${match ? "  " : "!!"} ${c.name.padEnd(20)} listed=${String(visible).padEnd(5)} REST=${String(rest.status).padEnd(3)} expected=${c.expect}`);
  }

  console.log("\n--- verdict ---");
  const blockCase = CASES.find((c) => c.expect === "hidden");
  const blockVisible = availableIds.has(String(blockCase.id));
  if (!blockVisible) {
    console.log("Q1: YES — `config` reaches the Jira expression as a PARSED OBJECT.");
    console.log("Q2: Conditions ARE enforced (the blocked transition is not offered).");
    console.log("=> Config-driven deterministic conditions are viable.");
  } else {
    console.log("Q1/Q2: the blocking condition did NOT hide the transition.");
    console.log("=> Either `config` does not arrive parsed, or conditions are not enforced here.");
    console.log("   Nothing regressed: the default-true guard means unrecognised configs behave exactly as before.");
  }
  console.log(`legacy/AI-shaped condition stayed available: ${availableIds.has(String(CASES[0].id))} (must be true — no regression)`);

  await cleanup(workflowName);
  process.exit(allAsExpected ? 0 : 1);
}

main().catch(async (e) => {
  console.error("ERROR:", e.message);
  try { await cleanup(loadState().workflowName); } catch { /* best effort */ }
  process.exit(1);
});
