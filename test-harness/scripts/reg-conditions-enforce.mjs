/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// REGRESSION GUARD — conditions actually gate transitions again.
//
// Background: the condition module shipped with `expression: "true"` (plus a
// `function: validate` key that is not part of the Forge condition schema at all and
// was silently ignored). So conditions passed unconditionally, on every surface, since
// the first commit. Finding F3 mis-attributed that to "Jira doesn't evaluate Forge
// conditions on the REST path" — this suite disproves that: the blocking cases below
// are rejected over REST with a 4xx.
//
// A Forge condition is a Jira EXPRESSION, which has no network and no app storage, so
// an AI-powered condition is impossible. What IS possible is the deterministic
// (non-AI) rule types, driven by the saved config — which arrives under `config`.
//
// Covers every deterministic rule type the manifest expression implements, in both
// directions, plus the two invariants that keep this safe:
//   - a legacy / AI-shaped condition must stay ALLOWED (default-true; upgrading must
//     never start hiding transitions that used to be visible)
//   - a null field value must stay ALLOWED (emptiness is the required-rule's job —
//     matches the premade executor's semantics in src/premade-rules.js)
//
// Run: node scripts/reg-conditions-enforce.mjs

import { getTransitions, doTransition, searchJql, getIssue } from "../lib/jira.mjs";
import { readWorkflow, updateWorkflow, makeSelfLoop, buildRule, attachRuleToTransition, removeTransitionsByName } from "../lib/workflow.mjs";
import { loadState } from "../lib/state.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const NEVER_MATCHES = "^ZZZ_NEVER_MATCHES_ZZZ$";
const ABSENT_FIELD = "customfield_99999999"; // guaranteed not on the issue

const CASES = [
  // --- the no-regression invariants -------------------------------------------
  { name: "REGC-legacy-ai", allow: true, why: "a legacy AI-shaped condition must stay allowed",
    config: { type: "condition", fieldId: "summary", prompt: "some AI prompt" } },
  { name: "REGC-nullfield", allow: true, why: "a null field value must not block (emptiness is the required-rule's job)",
    config: { conditionKind: "deterministic", ruleType: "field-regex", fieldId: ABSENT_FIELD, regex: NEVER_MATCHES } },
  { name: "REGC-nofield", allow: true, why: "a deterministic config with no fieldId must fall through to allow",
    config: { conditionKind: "deterministic", ruleType: "field-regex", regex: NEVER_MATCHES } },
  { name: "REGC-unknowntype", allow: true, why: "an unrecognised ruleType must fall through to allow",
    config: { conditionKind: "deterministic", ruleType: "not-a-real-rule", fieldId: "summary" } },

  // --- field-has-value ----------------------------------------------------------
  { name: "REGC-has-yes", allow: true, why: "field-has-value allows when the field is set",
    config: { conditionKind: "deterministic", ruleType: "field-has-value", fieldId: "summary" } },
  { name: "REGC-has-no", allow: false, why: "field-has-value BLOCKS when the field is absent",
    config: { conditionKind: "deterministic", ruleType: "field-has-value", fieldId: ABSENT_FIELD } },

  // --- field-regex --------------------------------------------------------------
  { name: "REGC-re-yes", allow: true, why: "field-regex allows on a match",
    config: { conditionKind: "deterministic", ruleType: "field-regex", fieldId: "summary", regex: "." } },
  { name: "REGC-re-no", allow: false, why: "field-regex BLOCKS on no match",
    config: { conditionKind: "deterministic", ruleType: "field-regex", fieldId: "summary", regex: NEVER_MATCHES } },

  // --- text-length --------------------------------------------------------------
  { name: "REGC-len-yes", allow: true, why: "text-length allows inside the bounds",
    config: { conditionKind: "deterministic", ruleType: "text-length", fieldId: "summary", minLength: 1 } },
  { name: "REGC-len-min", allow: false, why: "text-length BLOCKS below minLength",
    config: { conditionKind: "deterministic", ruleType: "text-length", fieldId: "summary", minLength: 100000 } },
  { name: "REGC-len-max", allow: false, why: "text-length BLOCKS above maxLength",
    config: { conditionKind: "deterministic", ruleType: "text-length", fieldId: "summary", maxLength: 0 } },

  // --- allowed-values -----------------------------------------------------------
  { name: "REGC-allow-no", allow: false, why: "allowed-values BLOCKS a value not in the list",
    config: { conditionKind: "deterministic", ruleType: "allowed-values", fieldId: "summary", allowedList: ["not-the-summary"] } },
];

const cleanup = async (workflowName) => {
  const { top, wf } = await readWorkflow(workflowName);
  if (removeTransitionsByName(wf, CASES.map((c) => c.name).concat(["REGC-allow-yes"])) > 0) await updateWorkflow(top, wf);
};

async function main() {
  const s = loadState();
  const workflowName = s.workflowName;
  if (!workflowName || !s.hubStatusRef) { console.error("results/testbed.json missing workflowName/hubStatusRef"); process.exit(2); }

  const issues = await searchJql(`project = ${s.projectKey || "COGTEST"} AND labels = cogtest-harness AND status = "Backlog" ORDER BY created ASC`, ["summary"], 1);
  if (!issues.length) { console.error("no harness issue parked on the hub status"); process.exit(2); }
  const KEY = issues[0].key;
  const summary = (await getIssue(KEY, ["summary"])).fields.summary;

  // The positive allowed-values case needs the issue's real summary in the list.
  const cases = CASES.concat([{
    name: "REGC-allow-yes", allow: true, why: "allowed-values allows a value in the list",
    config: { conditionKind: "deterministic", ruleType: "allowed-values", fieldId: "summary", allowedList: [summary, "other"] },
  }]);

  await cleanup(workflowName);
  {
    const { top, wf } = await readWorkflow(workflowName);
    // Allocate ids from what's actually free. This workflow carries hundreds of
    // transitions from other harnesses, so any fixed range eventually collides
    // ("Transition IDs must be unique within a workflow").
    const taken = new Set((wf.transitions || []).map((t) => String(t.id)));
    let next = 9700;
    for (const c of cases) {
      while (taken.has(String(next))) next++;
      c.id = next;
      taken.add(String(next));
      const t = makeSelfLoop(s.hubStatusRef, c.name, c.id);
      attachRuleToTransition(t, "condition", buildRule("condition", { id: `regc-${c.id}`, type: "condition", ...c.config }));
      wf.transitions.push(t);
    }
    await updateWorkflow(top, wf);
  }
  console.log(`testing ${cases.length} conditions on ${KEY} (summary: ${JSON.stringify(summary)})\n`);
  await new Promise((r) => setTimeout(r, 4000)); // workflow read settles

  const listed = new Set(((await getTransitions(KEY)).transitions || []).map((t) => String(t.id)));

  for (const c of cases) {
    const visible = listed.has(String(c.id));
    const rest = await doTransition(KEY, String(c.id));
    const restAllowed = rest.status < 400;
    // Both surfaces must agree — a condition that hides the button but still lets
    // REST through would be exactly the governance hole F3 claimed existed.
    ok(visible === c.allow, `${c.name}: listed=${visible}, expected ${c.allow} — ${c.why}`);
    ok(restAllowed === c.allow, `${c.name}: REST=${rest.status}, expected ${c.allow ? "allowed" : "blocked"} — conditions must be enforced over REST too`);
  }

  await cleanup(workflowName);
  console.log(`\nreg-conditions-enforce: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => {
  console.error("ERROR:", e.message);
  try { await cleanup(loadState().workflowName); } catch { /* best effort */ }
  process.exit(1);
});
