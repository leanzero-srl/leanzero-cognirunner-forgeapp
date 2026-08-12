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

import { getTransitions, doTransition, searchJql, getIssue, get, put, getMyself } from "../lib/jira.mjs";
import { readWorkflow, updateWorkflow, makeSelfLoop, buildRule, attachRuleToTransition, removeTransitionsByName } from "../lib/workflow.mjs";
import { loadState } from "../lib/state.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const ABSENT_FIELD = "customfield_99999999"; // guaranteed not on the issue

// Written against the harness's parked issue: a Task, priority Medium, unresolved,
// assigned to and reported by the harness account, no parent, summary set.
const CASES = [
  // --- the no-regression invariants -------------------------------------------
  { name: "REGC-legacy-ai", allow: true, why: "a legacy AI-shaped condition must stay allowed",
    config: { type: "condition", fieldId: "summary", prompt: "some AI prompt" } },
  { name: "REGC-unknowntype", allow: true, why: "an unrecognised ruleType must fall through to allow",
    config: { conditionKind: "deterministic", ruleType: "not-a-real-rule", fieldId: "summary" } },
  { name: "REGC-fieldtype-pending", allow: true, why: "a field-based type (not implemented in the expression) must ALLOW, never hide",
    config: { conditionKind: "deterministic", ruleType: "field-has-value", fieldId: ABSENT_FIELD } },
  // The disabled flag has to reach Jira somehow — the expression can't read app
  // storage, so disableRule writes it into the workflow rule's embedded config.
  { name: "REGC-disabled-allows", allow: true, why: "a rule marked disabled in its embedded config must ALLOW",
    config: { conditionKind: "deterministic", ruleType: "issue-type-is", issueTypeName: "Epic", disabled: true } },

  // --- issue-type-is -------------------------------------------------------------
  { name: "REGC-type-yes", allow: true, why: "issue-type-is allows on the matching type",
    config: { conditionKind: "deterministic", ruleType: "issue-type-is", issueTypeName: "Task" } },
  { name: "REGC-type-no", allow: false, why: "issue-type-is BLOCKS on a different type",
    config: { conditionKind: "deterministic", ruleType: "issue-type-is", issueTypeName: "Epic" } },
  { name: "REGC-type-nullparam", allow: true, why: "issue-type-is with no type chosen must allow",
    config: { conditionKind: "deterministic", ruleType: "issue-type-is" } },

  // --- resolution ----------------------------------------------------------------
  { name: "REGC-resolved-no", allow: false, why: "issue-is-resolved BLOCKS an unresolved issue",
    config: { conditionKind: "deterministic", ruleType: "issue-is-resolved" } },
  { name: "REGC-resis-no", allow: false, why: "resolution-is BLOCKS when there is no resolution",
    config: { conditionKind: "deterministic", ruleType: "resolution-is", resolutionName: "Done" } },
  { name: "REGC-resis-nullparam", allow: true, why: "resolution-is with no resolution chosen must allow",
    config: { conditionKind: "deterministic", ruleType: "resolution-is" } },

  // --- priority-is ---------------------------------------------------------------
  { name: "REGC-prio-yes", allow: true, why: "priority-is allows on the matching priority",
    config: { conditionKind: "deterministic", ruleType: "priority-is", priorityName: "Medium" } },
  { name: "REGC-prio-no", allow: false, why: "priority-is BLOCKS on a different priority",
    config: { conditionKind: "deterministic", ruleType: "priority-is", priorityName: "Highest" } },

  // --- parent-status-is (top-level issue -> allowed, per the catalog's contract) --
  { name: "REGC-parent-none", allow: true, why: "parent-status-is allows a top-level issue (no parent)",
    config: { conditionKind: "deterministic", ruleType: "parent-status-is", statusName: "Done" } },

  // --- acting-user rules. BOTH directions matter: an expression that dropped the
  //     accountId comparison entirely would pass an allow-only suite while letting
  //     every user through the rule whose entire job is to restrict to one.
  { name: "REGC-assignee-yes", allow: true, why: "current-user-is-assignee allows when the caller IS the assignee",
    config: { conditionKind: "deterministic", ruleType: "current-user-is-assignee" } },
  { name: "REGC-reporter-yes", allow: true, why: "current-user-is-reporter allows when the caller IS the reporter",
    config: { conditionKind: "deterministic", ruleType: "current-user-is-reporter" } },
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
  const summary = (await getIssue(KEY, ["summary"])).fields.summary;

  // The acting-user rules need BOTH directions, and the negative one has to be a
  // DIFFERENT accountId — not merely an unassigned issue. An expression that
  // dropped the accountId comparison (`issue.assignee != null && user != null`)
  // would sail through an allow-only suite while letting every user past the rule
  // whose entire purpose is to restrict to one person.
  const me = (await getMyself()).accountId;
  const assignable = await get(`/rest/api/3/user/assignable/search?project=${s.projectKey || "COGTEST"}&maxResults=20`);
  const other = (assignable || []).find((u) => u.accountId && u.accountId !== me);
  const originalAssignee = (await getIssue(KEY, ["assignee"])).fields.assignee?.accountId ?? null;

  const cases = CASES.slice();
  if (other) {
    cases.push({
      name: "REGC-assignee-other", allow: false,
      why: `current-user-is-assignee must BLOCK when the assignee is someone else (${other.displayName})`,
      config: { conditionKind: "deterministic", ruleType: "current-user-is-assignee" },
      assignTo: other.accountId,
    });
  } else {
    console.log("! no second assignable user — the accountId comparison itself stays UNPROVEN this run");
  }

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
    if (c.assignTo) continue; // handled below, after the assignee swap
    const visible = listed.has(String(c.id));
    const rest = await doTransition(KEY, String(c.id));
    const restAllowed = rest.status < 400;
    // Both surfaces must agree — a condition that hides the button but still lets
    // REST through would be exactly the governance hole F3 claimed existed.
    ok(visible === c.allow, `${c.name}: listed=${visible}, expected ${c.allow} — ${c.why}`);
    ok(restAllowed === c.allow, `${c.name}: REST=${rest.status}, expected ${c.allow ? "allowed" : "blocked"} — conditions must be enforced over REST too`);
  }

  // Re-evaluate the acting-user negative with the issue assigned to someone else.
  const swapped = cases.filter((c) => c.assignTo);
  if (swapped.length) {
    // The positive case must have been allowed while the issue WAS mine, or both
    // directions could be satisfied by a constant.
    ok(listed.has(String(cases.find((c) => c.name === "REGC-assignee-yes").id)),
      "the positive assignee case must be allowed BEFORE the swap (guards against a constant-false expression)");
    try {
      await put(`/rest/api/3/issue/${KEY}`, { fields: { assignee: { accountId: swapped[0].assignTo } } });
      await new Promise((r) => setTimeout(r, 2500));
      const listed2 = new Set(((await getTransitions(KEY)).transitions || []).map((t) => String(t.id)));
      for (const c of swapped) {
        const visible = listed2.has(String(c.id));
        const rest = await doTransition(KEY, String(c.id));
        ok(visible === c.allow, `${c.name}: listed=${visible}, expected ${c.allow} — ${c.why}`);
        ok((rest.status < 400) === c.allow, `${c.name}: REST=${rest.status}, expected ${c.allow ? "allowed" : "blocked"}`);
      }
    } finally {
      try {
        await put(`/rest/api/3/issue/${KEY}`, { fields: { assignee: originalAssignee ? { accountId: originalAssignee } : null } });
      } catch (e) { console.log("assignee restore warning:", e.message.slice(0, 100)); }
    }
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
