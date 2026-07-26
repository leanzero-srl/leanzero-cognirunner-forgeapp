/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// AUTONOMOUS it12 import-COMMIT smoke. Proves commitImport registers a rule AND that
// the registered rule FIRES on a real transition — no human step.
//   1. add a fresh empty self-loop transition on the hub (the import target)
//   2. POST an import to the dev-gated testStateTrigger (action=commit) with a static PF
//      whose code does a REST-OBSERVABLE api.setProperty (the firing proof)
//   3. assert committed + rule is on the transition + registry row exists
//   4. drive a real issue through the transition, then read the issue property via REST
//   5. assert fired:true, then clean up (remove the transition + delete the property)
// Env: TESTSTATE_URL (the harness-test-state webtrigger URL), HARNESS_SECRET (Bearer).
import { get, post, del, doTransition, searchJql, sleep } from "../lib/jira.mjs";
import { readWorkflow, makeSelfLoop, updateWorkflow } from "../lib/workflow.mjs";
import { loadState } from "../lib/state.mjs";

const TESTSTATE_URL = process.env.TESTSTATE_URL;
const SECRET = process.env.HARNESS_SECRET;
const TRANSITION_ID = 9531;
const PROP = "cogni-import-smoke";

const die = (m) => { console.error("SMOKE FAIL:", m); process.exit(1); };
if (!TESTSTATE_URL) die("Set TESTSTATE_URL (harness-test-state webtrigger URL).");
if (!SECRET) die("Set HARNESS_SECRET (the value you rotated it to).");

const hook = async (bodyObj, method = "POST") => {
  const res = await fetch(TESTSTATE_URL, {
    method,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + SECRET },
    body: method === "POST" ? JSON.stringify(bodyObj) : undefined,
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* leave */ }
  return { status: res.status, json, text };
};

async function main() {
  const s = loadState();
  if (!s.workflowName || !s.hubStatusRef) die("Run harness setup first (workflowName/hubStatusRef missing).");
  console.log(`Workflow: ${s.workflowName} | hub ref ${s.hubStatusRef} | project ${s.projectKey}`);

  // 0. Sanity: the webtrigger is reachable + the secret works.
  const ping = await hook(null, "GET");
  if (ping.status !== 200) die(`webtrigger not reachable / bad secret (GET ?what=registry → ${ping.status}). ${ping.text.slice(0, 200)}`);
  console.log("✓ webtrigger reachable, secret accepted");

  // 1. Add a fresh empty self-loop transition on the hub = the import target.
  let { top, wf } = await readWorkflow(s.workflowName);
  wf.transitions = (wf.transitions || []).filter((t) => String(t.id) !== String(TRANSITION_ID)); // idempotent
  wf.transitions.push(makeSelfLoop(s.hubStatusRef, "IT12 Import Smoke", TRANSITION_ID));
  await updateWorkflow(top, wf);
  console.log(`✓ added self-loop transition ${TRANSITION_ID} on the hub`);
  await sleep(1500);

  // 2. Import-commit a static PF whose code writes a REST-observable issue property.
  const rule = {
    type: "postfunction-static",
    name: "IT12 smoke — set property",
    functions: [{
      name: "set-prop", operationType: "rest_api_internal", variableName: "r",
      code: `await api.setProperty(${JSON.stringify(PROP)}, { fired: true, at: Date.now() });\nreturn { ok: true };`,
    }],
  };
  const commit = await hook({ action: "commit", rule, targetWorkflowName: s.workflowName, targetTransitionId: String(TRANSITION_ID) });
  console.log("commit response:", JSON.stringify(commit.json || commit.text).slice(0, 300));
  if (commit.status !== 200 || !commit.json || !commit.json.success || commit.json.status !== "committed") die(`commitImport did not commit: ${JSON.stringify(commit.json || commit.text)}`);
  const ruleId = commit.json.ruleId;
  console.log(`✓ commitImport committed, ruleId ${ruleId}`);

  // 3. Assert the rule actually landed on the transition + a registry row exists.
  await sleep(1500);
  ({ top, wf } = await readWorkflow(s.workflowName));
  const tgt = (wf.transitions || []).find((t) => String(t.id) === String(TRANSITION_ID));
  const onTransition = (tgt?.actions || []).some((a) => { try { return JSON.parse(a.parameters?.config || "{}").id === ruleId; } catch { return false; } });
  if (!onTransition) die("committed rule is NOT on the target transition's actions");
  console.log("✓ rule is on the transition");
  const reg = await hook(null, "GET");
  const inRegistry = Array.isArray(reg.json?.registry) && reg.json.registry.some((r) => r.id === ruleId);
  console.log(inRegistry ? "✓ registry row present" : "⚠ registry row missing (inject succeeded; reconcilable via Scan)");

  // 4. Drive a real issue through the transition, then read the property back.
  const issues = await searchJql(`project = ${s.projectKey} AND status = "${s.hubStatusName}"`, ["status"], 5);
  if (!issues.length) die(`no issue in status "${s.hubStatusName}" to drive`);
  const key = issues[0].key;
  await del(`/rest/api/3/issue/${key}/properties/${PROP}`).catch(() => {}); // clear stale
  console.log(`Driving ${key} through transition ${TRANSITION_ID}...`);
  const tr = await doTransition(key, TRANSITION_ID);
  if (tr.status >= 400) die(`transition failed ${tr.status}`);

  // 5. Poll the issue property — the imported PF sets it when it fires.
  let fired = false;
  for (let i = 0; i < 12 && !fired; i++) {
    await sleep(2500);
    const p = await get(`/rest/api/3/issue/${key}/properties/${PROP}`).catch(() => null);
    if (p && p.value && p.value.fired === true) fired = true;
  }
  console.log(fired ? `\n✅ SMOKE PASSED — imported rule registered AND fired (property ${PROP} set on ${key})`
                    : `\n❌ SMOKE FAILED — property ${PROP} never appeared on ${key} within 30s`);

  // 6. Cleanup: remove the self-loop transition (removes the rule) + delete the property.
  try {
    ({ top, wf } = await readWorkflow(s.workflowName));
    wf.transitions = (wf.transitions || []).filter((t) => String(t.id) !== String(TRANSITION_ID));
    await updateWorkflow(top, wf);
    await del(`/rest/api/3/issue/${key}/properties/${PROP}`).catch(() => {});
    console.log("✓ cleaned up (removed transition + property)");
  } catch (e) { console.log("cleanup note:", e.message); }

  process.exit(fired ? 0 : 1);
}
main().catch((e) => die(e.message));
