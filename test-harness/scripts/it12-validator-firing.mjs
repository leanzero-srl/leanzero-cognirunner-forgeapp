/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Verify a VALIDATOR imported via commitImport actually FIRES on a real transition, and
// audit its execution logs. Uses a deterministic zero-AI premade `field-regex` validator
// (blocks unless Summary matches a token) so pass/fail is fully controllable. Also probes
// whether a CONDITION is enforced via REST (expected: no — conditions gate UI visibility).
// Env: TESTSTATE_URL, HARNESS_SECRET.
import { get, put, del, doTransition, searchJql, sleep } from "../lib/jira.mjs";
import { readWorkflow, makeSelfLoop, updateWorkflow } from "../lib/workflow.mjs";
import { loadState } from "../lib/state.mjs";

const URL = process.env.TESTSTATE_URL, S = process.env.HARNESS_SECRET;
const V_TID = 9760, C_TID = 9761, TOKEN = "PASSTOKEN";
const die = (m) => { console.error("FAIL:", m); process.exit(1); };
if (!URL || !S) die("Set TESTSTATE_URL + HARNESS_SECRET.");
const hook = async (b, m = "POST") => { const r = await fetch(URL, { method: m, headers: { "Content-Type": "application/json", Authorization: "Bearer " + S }, body: m === "POST" ? JSON.stringify(b) : undefined }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { status: r.status, j, t }; };
const execlogs = async () => { const r = await fetch(URL + "?what=execlogs", { headers: { Authorization: "Bearer " + S } }); return (JSON.parse(await r.text()).logs) || []; };

async function main() {
  const s = loadState();
  // 1. Add two fresh self-loop transitions (validator + condition targets).
  let { top, wf } = await readWorkflow(s.workflowName);
  wf.transitions = (wf.transitions || []).filter((t) => ![V_TID, C_TID].includes(Number(t.id)));
  wf.transitions.push(makeSelfLoop(s.hubStatusRef, "IT12 validator fire", V_TID));
  wf.transitions.push(makeSelfLoop(s.hubStatusRef, "IT12 condition fire", C_TID));
  await updateWorkflow(top, wf); await sleep(1500);

  // 2. Import a deterministic field-regex VALIDATOR (blocks unless Summary matches TOKEN).
  const vr = { type: "validator", ruleKind: "premade", ruleType: "field-regex", premadeRuleType: "field-regex", fieldName: "Summary", fieldType: "string", regex: TOKEN, errorMessage: "Summary must contain " + TOKEN + "." };
  const vc = await hook({ action: "commit", rule: vr, targetWorkflowName: s.workflowName, targetTransitionId: String(V_TID) });
  if (!vc.j?.success) die("validator commit failed: " + JSON.stringify(vc.j || vc.t));
  console.log("✓ validator imported:", vc.j.ruleId);

  // 3. Two Backlog issues: one whose Summary PASSES the regex, one that FAILS.
  const issues = await searchJql(`project = ${s.projectKey} AND status = "${s.hubStatusName}"`, ["summary"], 4);
  if (issues.length < 2) die("need 2 backlog issues");
  const passKey = issues[0].key, failKey = issues[1].key;
  const origPass = issues[0].fields.summary, origFail = issues[1].fields.summary;
  await put(`/rest/api/3/issue/${passKey}`, { fields: { summary: `Ready ${TOKEN} to ship` } });
  await put(`/rest/api/3/issue/${failKey}`, { fields: { summary: `not ready to ship` } });
  await sleep(2500); // let the field update settle / reindex

  // 4. Drive both through the validator transition.
  console.log(`Driving PASS issue ${passKey} (summary has ${TOKEN})...`);
  const passRes = await doTransition(passKey, V_TID);
  console.log(`Driving FAIL issue ${failKey} (summary lacks ${TOKEN})...`);
  const failRes = await doTransition(failKey, V_TID);
  console.log(`  REST transition status — PASS issue: ${passRes.status}, FAIL issue: ${failRes.status}`);
  const restEnforced = passRes.status < 400 && failRes.status >= 400;
  console.log(restEnforced ? "  ✓ validator ENFORCED via REST (pass allowed, fail blocked)" : "  ⚠ validator not blocking via REST (both went through) — check logs for the recorded verdict");

  // 5. Audit the validator execution logs for both issues.
  await sleep(3000);
  const logs = await execlogs();
  const vlogs = logs.filter((l) => l.mode === "premade" && (l.issueKey === passKey || l.issueKey === failKey)).slice(0, 6);
  console.log("\n=== VALIDATOR EXECUTION LOGS ===");
  for (const l of vlogs) console.log(`  ${l.issueKey}: type=${l.type} ruleKind=${l.ruleKind} premadeType=${l.premadeRuleType} isValid=${l.isValid} reason="${(l.reason || "").slice(0, 70)}" source=${l.source} ${l.executionTimeMs}ms`);
  const passLog = vlogs.find((l) => l.issueKey === passKey);
  const failLog = vlogs.find((l) => l.issueKey === failKey);
  const logsCorrect = passLog?.isValid === true && failLog?.isValid === false;
  console.log(logsCorrect ? "  ✓ logs CORRECT: pass isValid=true, fail isValid=false" : "  ✗ logs WRONG or missing (pass should be true, fail false)");

  // 6. CONDITION probe — import a condition + drive a transition; report enforcement honestly.
  const cr = { type: "condition", ruleKind: "premade", ruleType: "field-has-value", premadeRuleType: "field-has-value", fieldName: "Summary", fieldType: "string" };
  const cc = await hook({ action: "commit", rule: cr, targetWorkflowName: s.workflowName, targetTransitionId: String(C_TID) });
  console.log("\n✓ condition imported:", cc.j?.ruleId, "| status:", cc.j?.status);
  const condRes = await doTransition(passKey, C_TID);
  console.log(`  condition transition status: ${condRes.status} — conditions gate UI VISIBILITY, so REST transitions bypass them (expected: not enforced via REST).`);

  // 7. Cleanup: remove transitions, restore summaries.
  ({ top, wf } = await readWorkflow(s.workflowName));
  wf.transitions = (wf.transitions || []).filter((t) => ![V_TID, C_TID].includes(Number(t.id)));
  await updateWorkflow(top, wf);
  await put(`/rest/api/3/issue/${passKey}`, { fields: { summary: origPass } }).catch(() => {});
  await put(`/rest/api/3/issue/${failKey}`, { fields: { summary: origFail } }).catch(() => {});
  console.log("✓ cleaned up (transitions removed, summaries restored)");

  console.log(logsCorrect ? "\n✅ VALIDATOR FIRING VERIFIED (logs correct)" : "\n❌ validator firing NOT verified");
  process.exit(logsCorrect ? 0 : 1);
}
main().catch((e) => die(e.message));
