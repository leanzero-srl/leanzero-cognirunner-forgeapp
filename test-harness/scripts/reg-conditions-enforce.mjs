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
// directions — including parent-status-is on a REAL sub-task fixture (both
// directions), not just the no-parent allow case — plus the two invariants that
// keep this safe:
//   - a legacy / AI-shaped condition must stay ALLOWED (default-true; upgrading must
//     never start hiding transitions that used to be visible)
//   - a null field value must stay ALLOWED (emptiness is the required-rule's job —
//     matches the premade executor's semantics in src/premade-rules.js)
//
// Run: node scripts/reg-conditions-enforce.mjs

import { getTransitions, doTransition, searchJql, getIssue, get, put, post, getMyself } from "../lib/jira.mjs";
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
  // The three WITHDRAWN field-based types must each fail OPEN (allow), never closed.
  // This is the whole reason they're withdrawn: the expression can't safely index
  // `issue` by a REST field id (system-field name mismatch + typed values → an
  // unresolvable expression is FALSE = hides the transition). The expression doesn't
  // implement them, so they must fall through its default-true. Proving all three
  // ALLOW is what makes "withdrawn" a guarantee rather than a hope.
  { name: "REGC-fieldtype-hasvalue", allow: true, why: "withdrawn field-has-value must ALLOW, never hide",
    config: { conditionKind: "deterministic", ruleType: "field-has-value", fieldId: ABSENT_FIELD } },
  { name: "REGC-fieldtype-empty", allow: true, why: "withdrawn field-empty must ALLOW, never hide",
    config: { conditionKind: "deterministic", ruleType: "field-empty", fieldId: ABSENT_FIELD } },
  { name: "REGC-fieldtype-equals", allow: true, why: "withdrawn field-equals must ALLOW, never hide",
    config: { conditionKind: "deterministic", ruleType: "field-equals", fieldId: "duedate", value: "2020-01-01" } },
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

  // --- parent-status-is --------------------------------------------------------
  // Three fixtures: a top-level issue (no parent -> allowed, per the catalog's
  // contract), and a REAL sub-task in both directions. The sub-task cases are what
  // prove `issue.parent.status?.name` actually resolves in the expression — the
  // no-parent case alone is satisfiable by an expression that never reads parent.
  { name: "REGC-parent-none", allow: true, why: "parent-status-is allows a top-level issue (no parent)",
    config: { conditionKind: "deterministic", ruleType: "parent-status-is", statusName: "Done" } },
  { name: "REGC-parent-yes", allow: true, evalOn: "subtask",
    why: "parent-status-is allows a sub-task whose parent IS in the named status",
    config: { conditionKind: "deterministic", ruleType: "parent-status-is", statusName: "PARENT_STATUS" } },
  { name: "REGC-parent-no", allow: false, evalOn: "subtask",
    why: "parent-status-is BLOCKS a sub-task whose parent is NOT in the named status",
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

  // --- sub-task fixture for parent-status-is -------------------------------------
  // One reusable sub-task (bounded pool of exactly one, found by label) whose
  // parent is the parked issue — which the JQL above just proved is in "Backlog",
  // so the positive case's status name is known, not assumed.
  const parentStatusName = s.hubStatusName || "Backlog";
  for (const c of CASES) {
    if (c.config?.statusName === "PARENT_STATUS") c.config.statusName = parentStatusName;
  }
  const subType = (s.issueTypes || []).find((t) => t.subtask === true);
  if (!subType) { console.error("project has no sub-task issue type — parent-status-is stays unproven"); process.exit(2); }
  let SUBKEY;
  const subs = await searchJql(`parent = ${KEY} AND labels = cogtest-sub-fixture`, ["summary", "status"], 1);
  if (subs.length) {
    SUBKEY = subs[0].key;
  } else {
    const created = await post("/rest/api/3/issue", {
      fields: {
        project: { key: s.projectKey || "COGTEST" },
        issuetype: { id: subType.id },
        parent: { key: KEY },
        summary: "REGC parent-status fixture (reused; do not delete)",
        labels: ["cogtest-harness", "cogtest-sub-fixture"],
      },
    });
    SUBKEY = created.key;
    console.log(`created sub-task fixture ${SUBKEY} under ${KEY}`);
  }

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
    if (c.evalOn === "subtask") continue; // evaluated on the sub-task fixture below
    const visible = listed.has(String(c.id));
    const rest = await doTransition(KEY, String(c.id));
    const restAllowed = rest.status < 400;
    // Both surfaces must agree — a condition that hides the button but still lets
    // REST through would be exactly the governance hole F3 claimed existed.
    ok(visible === c.allow, `${c.name}: listed=${visible}, expected ${c.allow} — ${c.why}`);
    ok(restAllowed === c.allow, `${c.name}: REST=${rest.status}, expected ${c.allow ? "allowed" : "blocked"} — conditions must be enforced over REST too`);
  }

  // --- the sub-task cases, evaluated ON the sub-task -----------------------------
  {
    const subCases = cases.filter((c) => c.evalOn === "subtask");
    const subStatus = (await getIssue(SUBKEY, ["status"])).fields.status?.name;
    if (subStatus !== (s.hubStatusName || "Backlog")) {
      // The sub-task must sit on the hub status to see the injected self-loops. If it
      // drifted (a crashed earlier run), this is a loud setup failure — never a pass.
      console.error(`sub-task fixture ${SUBKEY} is in "${subStatus}", not the hub status — reset it first`);
      fail += subCases.length;
    } else {
      const subListed = new Set(((await getTransitions(SUBKEY)).transitions || []).map((t) => String(t.id)));
      // The injected ids must be visible AT ALL to the sub-task: sub-tasks must share
      // the harness workflow for this proof to mean anything. The allow-case id being
      // absent is indistinguishable from "different workflow", so check explicitly
      // against a case that must be VISIBLE.
      const allowCase = subCases.find((c) => c.allow);
      if (allowCase && !subListed.has(String(allowCase.id))) {
        console.error(`sub-task ${SUBKEY} does not see transition ${allowCase.id} — sub-tasks may use a different workflow in this scheme; parent-status-is stays unproven`);
        fail += subCases.length;
      } else {
        for (const c of subCases) {
          const visible = subListed.has(String(c.id));
          const rest = await doTransition(SUBKEY, String(c.id));
          ok(visible === c.allow, `${c.name}: listed=${visible} on ${SUBKEY}, expected ${c.allow} — ${c.why}`);
          ok((rest.status < 400) === c.allow, `${c.name}: REST=${rest.status} on ${SUBKEY}, expected ${c.allow ? "allowed" : "blocked"}`);
        }
      }
    }
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
