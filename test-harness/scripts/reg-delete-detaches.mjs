/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// REGRESSION GUARD — finding F-DEL: "removing" a rule only deleted its registry row.
// The rule stayed attached to the transition and kept executing, with no UI left to
// disable it. Deleting a rule has to mean the rule STOPS RUNNING.
//
// Proves the whole chain against real Jira, with no AI in the loop (a deterministic
// premade `field-regex` validator, so pass/fail is fully controllable):
//
//   1. attach a validator to a fresh self-loop transition
//   2. prove it BLOCKS the transition over REST
//   3. register it so it has a registry row (the admin table's view of it)
//   4. delete it with detach:true
//   5. assert: registry row gone, rule gone from the transition, transition NOW PASSES
//
// Step 5 is the point. A test that only checked the registry row would have passed
// against the old broken code.
//
// Env: TESTSTATE_URL, HARNESS_SECRET (+ the usual .env Jira credentials).
// Run: node scripts/reg-delete-detaches.mjs

import { doTransition, searchJql } from "../lib/jira.mjs";
import { readWorkflow, updateWorkflow, makeSelfLoop, buildRule, attachRuleToTransition, removeTransitionsByName, APP_ID } from "../lib/workflow.mjs";
import { loadState } from "../lib/state.mjs";

const URL = process.env.TESTSTATE_URL;
const SECRET = process.env.HARNESS_SECRET;
const T_NAME = "REG-delete-detaches";
const T_ID = 9770;
const TOKEN = "DELPASS";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const die = (m) => { console.error("ABORT:", m); process.exit(2); };

if (!URL || !SECRET) die("Set TESTSTATE_URL + HARNESS_SECRET.");

const hook = async (body) => {
  const r = await fetch(URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + SECRET },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch { /* non-JSON error body */ }
  return { status: r.status, j, t };
};
const registry = async () => {
  const r = await fetch(URL + "?what=registry", { headers: { Authorization: "Bearer " + SECRET } });
  return (JSON.parse(await r.text()).registry) || [];
};

/** Is our rule still attached to the named transition? */
const ruleOnTransition = async (workflowName, transitionId, instanceId) => {
  const { wf } = await readWorkflow(workflowName);
  const t = (wf.transitions || []).find((x) => String(x.id) === String(transitionId));
  if (!t) return { transitionExists: false, attached: false };
  const rules = [...(t.validators || []), ...(t.actions || [])];
  return {
    transitionExists: true,
    attached: rules.some((r) => String(r?.parameters?.id) === String(instanceId)),
    cogniCount: rules.filter((r) => String(r?.parameters?.key || "").includes(APP_ID)).length,
  };
};

const cleanup = async (workflowName) => {
  try {
    const { top, wf } = await readWorkflow(workflowName);
    if (removeTransitionsByName(wf, [T_NAME]) > 0) await updateWorkflow(top, wf);
  } catch (e) { console.log("cleanup warning:", e.message.slice(0, 120)); }
};

async function main() {
  const s = loadState();
  const workflowName = s.workflowName;
  if (!workflowName || !s.hubStatusRef) die("results/testbed.json missing workflowName/hubStatusRef — run setup-testbed first.");

  // A parked issue on the hub status, so the self-loop is available to it.
  const issues = await searchJql(`project = ${s.projectKey || "COGTEST"} AND labels = cogtest-harness AND status = "Backlog" ORDER BY created ASC`, ["summary"], 1);
  if (!issues.length) die("no harness issue parked on the hub status");
  const KEY = issues[0].key;

  await cleanup(workflowName); // idempotent re-run

  // --- 1. attach a deterministic (zero-AI) blocking validator -------------------
  const ruleConfigId = `regdel::${workflowName}::${T_ID}::i-${Math.random().toString(36).slice(2, 8).padEnd(6, "0")}`;
  // Key names matter: the executor reads cfg.regex (NOT cfg.pattern) and dispatches
  // on ruleKind === "premade" && ruleType. Shape mirrors it12-validator-firing.mjs.
  const config = {
    id: ruleConfigId,
    type: "validator",
    ruleKind: "premade",
    ruleType: "field-regex",
    premadeRuleType: "field-regex",
    fieldId: "summary",
    fieldName: "Summary",
    fieldType: "string",
    regex: TOKEN,
    errorMessage: "Summary must contain " + TOKEN + ".",
    workflow: { workflowName, transitionId: String(T_ID) },
  };
  let instanceId;
  {
    const { top, wf } = await readWorkflow(workflowName);
    const t = makeSelfLoop(s.hubStatusRef, T_NAME, T_ID);
    const rule = buildRule("validator", config);
    instanceId = rule.parameters.id;
    attachRuleToTransition(t, "validator", rule);
    wf.transitions.push(t);
    await updateWorkflow(top, wf);
  }
  console.log(`attached ${T_NAME} (transition ${T_ID}, instance ${instanceId})`);

  // --- 2. it must BLOCK (the issue's summary does not contain the token) --------
  {
    const before = await doTransition(KEY, String(T_ID));
    ok(before.status >= 400, `validator must BLOCK the transition before deletion (got HTTP ${before.status})`);
  }

  // --- 3. register it, the way "Scan → Register all" does ----------------------
  {
    const r = await hook({
      action: "registerRules",
      rules: [{
        instanceId,
        embeddedId: ruleConfigId,
        type: "validator",
        fieldId: "summary",
        workflowName,
        transitionId: String(T_ID),
        transitionName: T_NAME,
        transitionFromName: "Backlog",
        transitionToName: "Backlog",
      }],
    });
    ok(r.status === 200 && r.j?.success, `registerRules should succeed (got ${r.status} ${r.t.slice(0, 160)})`);
    const reg = await registry();
    const row = reg.find((c) => String(c.id) === ruleConfigId);
    ok(!!row, "a registry row keyed by the rule's EMBEDDED id must exist (not the instance UUID)");
    ok(row?.ruleInstanceId === instanceId, "the row must record ruleInstanceId so deletion can match exactly");
    // "Not attributed" is the invariant — the stored form may OMIT createdBy (the
    // registry slims null fields out) or hold null; both mean ownerless everywhere
    // that reads it (filterConfigsForUser, the ownership repair, the UI all test
    // truthiness). Asserting exactly === null would pin the storage shape, not the rule.
    ok(!row?.createdBy, "a claimed rule must NOT be attributed to whoever claimed it (createdBy absent or null)");
    ok(row?.workflow?.transitionName === T_NAME, "transition NAME must be stored as the name");
    ok(row?.workflow?.transitionToName === "Backlog", "transition destination STATUS must not be the transition name");
  }

  // --- 4. delete with detach --------------------------------------------------
  {
    const r = await hook({ action: "removeRules", ids: [ruleConfigId], detach: true });
    ok(r.status === 200 && r.j?.success, `removeRules should succeed (got ${r.status} ${r.t.slice(0, 200)})`);
    const res = (r.j?.results || [])[0];
    ok(res?.ok === true, `the row must be reported removed (got ${JSON.stringify(res)})`);
    ok(res?.detached === true, `the rule must be reported DETACHED from the workflow (got ${JSON.stringify(res)})`);
  }

  // --- 5. the assertions that matter -------------------------------------------
  {
    const reg = await registry();
    ok(!reg.some((c) => String(c.id) === ruleConfigId), "registry row must be gone");

    const state = await ruleOnTransition(workflowName, T_ID, instanceId);
    ok(state.transitionExists, "the transition itself must survive — we delete rules, not transitions");
    ok(state.attached === false, "THE RULE MUST BE GONE FROM THE JIRA TRANSITION (this is the whole point)");

    const after = await doTransition(KEY, String(T_ID));
    ok(after.status < 400, `the previously-blocked transition must now succeed (got HTTP ${after.status})`);
  }

  await cleanup(workflowName);
  console.log(`\nreg-delete-detaches: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => {
  console.error("ERROR:", e.message);
  try { await cleanup(loadState().workflowName); } catch { /* best effort */ }
  process.exit(1);
});
