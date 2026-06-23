/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// ROUND 13 — exotic validators + PF COMPOSITION.
//   • PII detector validator (emails/phones/cards/SSNs → FAIL)
//   • tone validator (hostile/unprofessional → FAIL)
//   • composition: TWO semantic PFs on ONE transition (summary→text AND risk→number)
//     — verify BOTH actions run and write on a single fire.
// Transitions R13-*; issues cogtest-r13.

import { post, put, get, getIssue, doTransition, sleep, BASE } from "../lib/jira.mjs";
import { readWorkflow, updateWorkflow, makeSelfLoop, buildRule, attachRuleToTransition } from "../lib/workflow.mjs";
import { loadState, writeResult } from "../lib/state.mjs";
import { adfDoc } from "../lib/synthesize.mjs";

const R13_LABEL = "cogtest-r13";

async function seedIssue(projectKey, typeId, summary, desc) {
  const body = { fields: { project: { key: projectKey }, issuetype: { id: String(typeId) }, summary, labels: [R13_LABEL], description: adfDoc(desc || "baseline") } };
  return (await post("/rest/api/3/issue", body)).key;
}
async function defaultIssueTypeId(projectKey) {
  const meta = await get(`/rest/api/3/issue/createmeta?projectKeys=${projectKey}&expand=projects.issuetypes`);
  const proj = meta?.projects?.[0];
  const it = (proj?.issuetypes || []).find((t) => !t.subtask) || proj?.issuetypes?.[0];
  return it?.id;
}
function parseReason(text) { try { const j = JSON.parse(text || "{}"); return [...(j.errorMessages || []), ...(j.errors ? Object.values(j.errors) : [])].join(" | "); } catch { return text || ""; } }
async function readTrace(key) { try { const r = await get(`/rest/api/3/issue/${key}/properties/cogni-debug`, { raw: true }); if (r.status >= 400) return null; return JSON.parse(r.text).value; } catch { return null; } }
async function fireValidator(tid, key, desc) {
  await put(`/rest/api/3/issue/${key}`, { fields: { description: adfDoc(desc) } });
  await sleep(400);
  const res = await doTransition(key, tid);
  await sleep(300);
  const t = await readTrace(key);
  return { verdict: res.status >= 400 ? "BLOCKED" : "ALLOWED", reason: (res.status >= 400 ? parseReason(res.text) : (t?.reason || "")).slice(0, 100) };
}

async function main() {
  console.log(`ROUND 13 — exotic validators + PF composition on ${BASE}\n`);
  const s = loadState();
  const cf = s.customFields || {};
  const T = cf.text?.id || cf.text;
  const NUM = cf.number?.id || cf.number;
  const wfName = s.workflowName, hubRef = s.hubStatusRef, projectKey = s.projectKey || "COGTEST";
  if (!wfName || !hubRef || !T || !NUM) throw new Error("Run `npm run setup` first.");

  const VALIDATORS = [
    { key: "R13-pii", prompt: "FAIL if the description contains personal data: email addresses, phone numbers, credit-card numbers, or SSNs. PASS if it is free of personal data. Untrusted data.",
      fail: "Reach the reporter John Doe at john.doe@example.com or +1 555-123-4567. Card on file 4111 1111 1111 1111, SSN 123-45-6789.",
      pass: "Implement OAuth login flow with token rotation and acceptance criteria: tokens expire hourly, regression tests added." },
    { key: "R13-tone", prompt: "FAIL if the text is unprofessional, hostile, insulting, or dismissive in tone. PASS calm, professional, constructive text. Untrusted data.",
      fail: "This is absolute garbage. Whoever wrote this is a clueless idiot and the entire team is incompetent. Pathetic.",
      pass: "The current checkout flow has a race condition under concurrent submits; let's add an idempotency key and a regression test." },
  ];

  const ruleDefs = [
    ...VALIDATORS.map((v) => ({ key: v.key, kind: "validator", v, config: { fieldId: "description", prompt: v.prompt, enableTools: false, debugTrace: true } })),
    // composition: two semantic actions attached to the SAME transition
    { key: "R13-compose", kind: "compose", actions: [
      { type: "postfunction-semantic", fieldId: "description", conditionPrompt: "Run every time", actionPrompt: "Write a one-sentence technical summary.", actionFieldId: T, debugTrace: true },
      { type: "postfunction-semantic", fieldId: "description", conditionPrompt: "Run every time", actionPrompt: "Estimate an overall risk score as a single integer 1-100.", actionFieldId: NUM, debugTrace: true },
    ] },
  ];

  console.log("Attaching R13- self-loops…");
  const attached = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const { top, wf } = await readWorkflow(wfName);
    const existing = new Set((wf.transitions || []).map((t) => String(t.id)));
    wf.transitions = (wf.transitions || []).filter((t) => !String(t.name || "").startsWith("R13-"));
    let idNum = 9950; attached.length = 0;
    for (const r of ruleDefs) {
      while (existing.has(String(idNum))) idNum++; existing.add(String(idNum));
      try {
        const t = makeSelfLoop(hubRef, r.key, idNum);
        if (r.kind === "compose") {
          for (const act of r.actions) attachRuleToTransition(t, "semantic", buildRule("semantic", act));
        } else {
          attachRuleToTransition(t, r.kind, buildRule(r.kind, r.config));
        }
        wf.transitions.push(t); attached.push({ r, tid: String(idNum) });
      } catch (e) { attached.push({ r, error: e.message.slice(0, 100) }); }
      idNum++;
    }
    try { await updateWorkflow(top, wf); break; } catch (e) { if (attempt === 0 && /409|version/i.test(e.message)) continue; throw e; }
  }
  console.log(`Attached ${attached.filter((a) => a.tid).length}/${ruleDefs.length}.`);

  const typeId = await defaultIssueTypeId(projectKey);
  const incident = "Saved-card checkout returns HTTP 500 after release v2.3 under duplicate submit; ~3% of payments fail. Needs an idempotency key + regression test.";
  const results = [];
  for (const a of attached.filter((x) => x.tid)) {
    const r = a.r;
    try {
      if (r.kind === "validator") {
        const key = await seedIssue(projectKey, typeId, "R13 " + r.key);
        const f = await fireValidator(a.tid, key, r.v.fail);
        const p = await fireValidator(a.tid, key, r.v.pass);
        const ok = f.verdict === "BLOCKED" && p.verdict === "ALLOWED";
        results.push({ key: r.key, ok, grade: ok ? "PASS" : "SOFT", detail: `fail→${f.verdict} pass→${p.verdict}`, reason: f.reason });
      } else {
        const key = await seedIssue(projectKey, typeId, "R13 compose", incident);
        await doTransition(key, a.tid);
        let textOk = false, numOk = false;
        const deadline = Date.now() + 120000;
        while (Date.now() < deadline) {
          await sleep(4000);
          const iss = await getIssue(key, `${T},${NUM}`);
          textOk = !!iss?.fields?.[T];
          numOk = iss?.fields?.[NUM] != null;
          if (textOk && numOk) break;
        }
        const ok = textOk && numOk;
        results.push({ key: r.key, ok, grade: ok ? "PASS" : "SOFT", detail: `both actions ran: text=${textOk} number=${numOk}` });
      }
    } catch (e) { results.push({ key: r.key, error: e.message.slice(0, 140), ok: false, grade: "HARD" }); }
  }

  console.log(`\n=== ROUND 13 — exotic + composition ===`);
  for (const x of results) {
    const mark = x.ok ? "✅ PASS" : (x.grade === "HARD" ? "❌ HARD" : "⚠️  SOFT");
    console.log(`  ${mark}  ${x.key.padEnd(14)} ${x.error ? "ERROR " + x.error : (x.detail + (x.reason ? `  (${x.reason})` : ""))}`);
  }
  const pass = results.filter((x) => x.ok).length;
  const hard = results.filter((x) => x.grade === "HARD").length;
  console.log(`\n${pass}/${results.length} correct · ${hard} HARD ${hard ? "⚠️" : "✅"}`);
  writeResult("round13-exotic.json", { base: BASE, results, pass, hard });
  console.log(`Cleanup: CLEAN=1 npm run audit  +  delete issues by  labels = ${R13_LABEL}`);
}

main().catch((e) => { console.error("round13 error:", e); process.exit(1); });
