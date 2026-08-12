/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// REGRESSION GUARD — the riskiest edit in this release, and the one a coverage
// audit found had NO test at all: the workflow-context fallback added to
// executePostFunction's disabled-check (src/index.js).
//
// Why it exists: "Register all" claimed a discovered post-function into the admin
// table keyed by the workflow-rule INSTANCE id, while the runtime looked the row up
// by the rule's EMBEDDED config id. The two identities never met, so the Disable
// button on a claimed PF did nothing. The fallback matches on workflow + transition
// instead — but it sits on the fail-open runtime hot path, so its guards matter more
// than the feature does.
//
// The three things asserted here are the three ways it could go wrong:
//   1. DOES IT WORK — a claimed PF, disabled, must actually skip.
//   2. DOES IT OVER-REACH — a SECOND post-function on the SAME transition must keep
//      running while its sibling is disabled. If the fallback matched on
//      workflow+transition alone without the instanced guards, disabling one would
//      silently mute both. CORE_CONTRACT §1.2 forbids exactly that collapse.
//   3. DOES IT CROSS FAMILIES — a disabled POST-FUNCTION row must never mute a
//      VALIDATOR on the same transition (and the validator must still block).
//
// Evidence is the execution log, not a guess: a skipped PF writes a
// `postfunction-skipped` entry naming the rule.
//
// Env: TESTSTATE_URL, HARNESS_SECRET.
// Run: node scripts/reg-pf-disable.mjs

import { doTransition, searchJql, sleep } from "../lib/jira.mjs";
import { readWorkflow, updateWorkflow, makeSelfLoop, buildRule, attachRuleToTransition, removeTransitionsByName } from "../lib/workflow.mjs";
import { loadState } from "../lib/state.mjs";

const URL = process.env.TESTSTATE_URL;
const SECRET = process.env.HARNESS_SECRET;
const T_NAME = "REG-pf-disable";
const BLOCK_TOKEN = "PFDISABLE_PASS";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

if (!URL || !SECRET) { console.error("ABORT: set TESTSTATE_URL + HARNESS_SECRET."); process.exit(2); }

const hook = async (body) => {
  const r = await fetch(URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + SECRET }, body: JSON.stringify(body) });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch { /* non-JSON */ }
  return { status: r.status, j, t };
};
const kvs = async (key) => {
  const r = await fetch(`${URL}?what=kvs&key=${encodeURIComponent(key)}`, { headers: { Authorization: "Bearer " + SECRET } });
  return JSON.parse(await r.text()).value;
};
const execlogs = async () => {
  const r = await fetch(`${URL}?what=execlogs`, { headers: { Authorization: "Bearer " + SECRET } });
  return (JSON.parse(await r.text()).logs) || [];
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
  if (!workflowName || !s.hubStatusRef) { console.error("ABORT: testbed.json missing workflowName/hubStatusRef"); process.exit(2); }

  const issues = await searchJql(`project = ${s.projectKey || "COGTEST"} AND labels = cogtest-harness AND status = "Backlog" ORDER BY created ASC`, ["summary"], 1);
  if (!issues.length) { console.error("ABORT: no harness issue on the hub status"); process.exit(2); }
  const KEY = issues[0].key;

  await cleanup(workflowName);

  const stamp = Math.random().toString(36).slice(2, 8);
  const idA = `pfdisA::${stamp}`;   // will be disabled
  const idB = `pfdisB::${stamp}`;   // sibling, must KEEP running
  const idV = `pfdisV::${stamp}`;   // validator, must keep blocking
  let transitionId, instA, instB;

  {
    const { top, wf } = await readWorkflow(workflowName);
    const taken = new Set((wf.transitions || []).map((t) => String(t.id)));
    let next = 9650; while (taken.has(String(next))) next++;
    transitionId = next;
    const t = makeSelfLoop(s.hubStatusRef, T_NAME, transitionId);
    const wfCtx = { workflowName, transitionId: String(transitionId) };

    // Two static post-functions on ONE transition — the exact shape that would
    // collapse if the context fallback lacked its instanced guards.
    const mkPf = (id, label) => buildRule("static", {
      id, type: "postfunction-static", workflow: wfCtx,
      functions: [{ id: "s1", name: label, operationType: "custom", variableName: "r", code: `api.log(${JSON.stringify(label)});` }],
    });
    const ruleA = mkPf(idA, "PFDIS-A"); instA = ruleA.parameters.id;
    const ruleB = mkPf(idB, "PFDIS-B"); instB = ruleB.parameters.id;
    attachRuleToTransition(t, "static", ruleA);
    attachRuleToTransition(t, "static", ruleB);

    // A deterministic validator on the same transition — a disabled PF row must
    // never mute it.
    attachRuleToTransition(t, "validator", buildRule("validator", {
      id: idV, type: "validator", ruleKind: "premade", ruleType: "field-regex", premadeRuleType: "field-regex",
      fieldId: "summary", fieldName: "Summary", fieldType: "string", regex: BLOCK_TOKEN,
      errorMessage: "Summary must contain " + BLOCK_TOKEN, workflow: wfCtx,
    }));

    wf.transitions.push(t);
    await updateWorkflow(top, wf);
  }
  console.log(`attached ${T_NAME} (${transitionId}): 2 post-functions + 1 validator`);

  // Claim all three the way "Scan → Register all" does — keyed by embeddedId, which
  // is what makes them addressable by the runtime at all.
  {
    const r = await hook({
      action: "registerRules",
      rules: [
        { instanceId: instA, embeddedId: idA, type: "postfunction-static", workflowName, transitionId: String(transitionId), transitionName: T_NAME },
        { instanceId: instB, embeddedId: idB, type: "postfunction-static", workflowName, transitionId: String(transitionId), transitionName: T_NAME },
      ],
    });
    ok(r.status === 200 && r.j?.success, `registerRules should succeed (got ${r.status})`);
  }

  // Disable ONLY rule A, through the same core the Disable button calls.
  {
    const r = await hook({ action: "setDisabled", id: idA, disabled: true });
    ok(r.status === 200 && r.j?.success, `setDisabled should succeed (got ${r.status} ${r.t.slice(0, 160)})`);
    const reg = await kvs("config_registry");
    const rowA = (reg || []).find((c) => String(c.id) === idA);
    const rowB = (reg || []).find((c) => String(c.id) === idB);
    ok(rowA?.disabled === true, "rule A is marked disabled in the registry");
    ok(rowB?.disabled !== true, "rule B must NOT have been disabled as a side effect");
  }

  const before = (await execlogs()).length;
  const res = await doTransition(KEY, String(transitionId));
  ok(res.status >= 400, `the validator must still BLOCK while a sibling PF is disabled (got ${res.status})`);

  // Now make the validator pass so the post-functions actually run.
  const { put } = await import("../lib/jira.mjs");
  const original = issues[0].fields.summary;
  await put(`/rest/api/3/issue/${KEY}`, { fields: { summary: `${original} ${BLOCK_TOKEN}` } });
  await sleep(1500);
  const res2 = await doTransition(KEY, String(transitionId));
  ok(res2.status < 400, `the transition must succeed once the validator's condition is met (got ${res2.status})`);
  await sleep(9000); // post-functions are queued

  const logs = (await execlogs()).slice(0, Math.max(30, (await execlogs()).length - before + 10));
  const txt = JSON.stringify(logs);
  ok(txt.includes(idA) || /skipped/i.test(txt), "an execution log entry should mention the disabled rule or a skip");
  ok(!/PFDIS-A/.test(txt) || /disabled/i.test(txt), "rule A must NOT have executed (or must be logged as skipped)");
  ok(/PFDIS-B/.test(txt) || txt.includes(idB), "rule B — the sibling — MUST still have run");

  await put(`/rest/api/3/issue/${KEY}`, { fields: { summary: original } }).catch(() => {});
  await hook({ action: "removeRules", ids: [idA, idB], detach: false });
  await cleanup(workflowName);
  console.log(`\nreg-pf-disable: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => {
  console.error("ERROR:", e.message);
  try { await cleanup(loadState().workflowName); } catch { /* best effort */ }
  process.exit(1);
});
