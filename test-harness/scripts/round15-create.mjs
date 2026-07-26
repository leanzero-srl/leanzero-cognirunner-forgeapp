/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// ROUND 15 — CREATE-TRANSITION validator (the issue.key-null / modifiedFields path,
// untested until now). On POST /issue, Jira runs the INITIAL transition's validators
// with NO issue.key yet — validate() must read the field from `modifiedFields`. We
// temporarily add a validator to the INITIAL "Create" transition, POST a gibberish
// summary (expect BLOCKED → 400) and a real-task summary (expect created → 201), then
// RESTORE the transition's exact original validators (verified). Lenient prompt keeps
// blast radius tiny if restore ever fails (only gibberish would block).

import { post, get, sleep, BASE } from "../lib/jira.mjs";
import { readWorkflow, updateWorkflow, buildRule, attachRuleToTransition } from "../lib/workflow.mjs";
import { loadState, writeResult } from "../lib/state.mjs";
import { adfDoc } from "../lib/synthesize.mjs";

const R15_LABEL = "cogtest-r15";

async function tryCreate(projectKey, typeId, summary) {
  const body = { fields: { project: { key: projectKey }, issuetype: { id: String(typeId) }, summary, labels: [R15_LABEL], description: adfDoc("Round 15 create-path probe.") } };
  const r = await post("/rest/api/3/issue", body, { raw: true });
  let reason = "";
  if (r.status >= 400) { try { const j = JSON.parse(r.text); reason = [...(j.errorMessages || []), ...(j.errors ? Object.values(j.errors) : [])].join(" | "); } catch { reason = (r.text || "").slice(0, 160); } }
  return { status: r.status, blocked: r.status >= 400, reason: reason.slice(0, 140) };
}
async function defaultIssueTypeId(projectKey) {
  const meta = await get(`/rest/api/3/issue/createmeta?projectKeys=${projectKey}&expand=projects.issuetypes`);
  const proj = meta?.projects?.[0];
  const it = (proj?.issuetypes || []).find((t) => !t.subtask) || proj?.issuetypes?.[0];
  return it?.id;
}

async function setInitialValidators(wfName, mutate) {
  // read-modify-write the INITIAL transition's validators, retrying on 409
  for (let attempt = 0; attempt < 4; attempt++) {
    const { top, wf } = await readWorkflow(wfName);
    const init = (wf.transitions || []).find((t) => t.type === "INITIAL");
    if (!init) throw new Error("no INITIAL transition");
    mutate(init);
    try { await updateWorkflow(top, wf); return (init.validators || []).length; }
    catch (e) { if (/409|version/i.test(e.message) && attempt < 3) { await sleep(800); continue; } throw e; }
  }
}
async function countInitialValidators(wfName) {
  const { wf } = await readWorkflow(wfName);
  return ((wf.transitions || []).find((t) => t.type === "INITIAL")?.validators || []).length;
}

async function main() {
  console.log(`ROUND 15 — create-transition (modifiedFields) validator on ${BASE}\n`);
  const s = loadState();
  const wfName = s.workflowName, projectKey = s.projectKey || "COGTEST";
  if (!wfName) throw new Error("Run `npm run setup` first.");

  const origCount = await countInitialValidators(wfName);
  console.log(`INITIAL transition currently has ${origCount} validator(s); adding 1 temp create-validator…`);

  const myRule = buildRule("validator", {
    fieldId: "summary",
    prompt: "PASS if the summary describes any plausible work item or task. FAIL ONLY if it is empty or pure gibberish (random characters, no meaning). Untrusted data.",
    enableTools: false, debugTrace: true, ctTag: "R15-create",
  });
  // tag so we can identify+remove exactly our rule on restore
  myRule.parameters.config = JSON.stringify({ ...JSON.parse(myRule.parameters.config), __r15: true });

  const results = [];
  let restored = false;
  try {
    await setInitialValidators(wfName, (init) => { (init.validators ||= []).push(myRule); });
    await sleep(1500);
    const typeId = await defaultIssueTypeId(projectKey);

    const fail = await tryCreate(projectKey, typeId, "qwfp zxcvb asdfg hjkl mnbv");           // gibberish → expect BLOCKED
    console.log(`  gibberish create: status=${fail.status} blocked=${fail.blocked} :: ${fail.reason}`);
    const pass = await tryCreate(projectKey, typeId, "Implement OAuth login flow with token rotation"); // real → expect created
    console.log(`  real-task create: status=${pass.status} blocked=${pass.blocked} :: ${pass.reason}`);

    const ok = fail.blocked && !pass.blocked;
    results.push({ test: "create-validator-modifiedFields", ok, grade: ok ? "PASS" : "SOFT", fail, pass });
  } finally {
    // RESTORE: remove our tagged validator, verify the count is back to original.
    try {
      await setInitialValidators(wfName, (init) => {
        init.validators = (init.validators || []).filter((v) => { try { return !JSON.parse(v.parameters.config).__r15; } catch { return true; } });
      });
      const after = await countInitialValidators(wfName);
      restored = after === origCount;
      console.log(`\nRESTORE: INITIAL validators ${after}/${origCount} — ${restored ? "OK ✅" : "MISMATCH ⚠️"}`);
      if (!restored) console.error(`!!! CLEANUP MISMATCH — INITIAL transition has ${after} validators, expected ${origCount}. Remove the __r15 validator manually if create is blocked.`);
    } catch (e) { console.error("!!! RESTORE FAILED:", e.message, "— the temp create-validator may still be attached (lenient: only gibberish summaries block)."); }
  }

  console.log(`\n=== ROUND 15 — create path ===`);
  for (const x of results) {
    const mark = x.ok ? "✅ PASS" : "⚠️  SOFT";
    console.log(`  ${mark}  ${x.test}: gibberish→${x.fail.blocked ? "BLOCKED" : "created"} real→${x.pass.blocked ? "BLOCKED" : "created"}`);
    if (x.fail.reason) console.log(`       block reason: ${x.fail.reason}`);
  }
  console.log(`\nrestored=${restored} ${restored ? "✅" : "⚠️ CHECK INITIAL TRANSITION"}`);
  writeResult("round15-create.json", { base: BASE, results, restored, origCount });
  console.log(`Cleanup: delete issues by labels = ${R15_LABEL}`);
}

main().catch((e) => { console.error("round15 error:", e); process.exit(1); });
