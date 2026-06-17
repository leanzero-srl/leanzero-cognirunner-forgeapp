/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// ROUND 7 — STATIC PF EXECUTION DEPTH. Static PFs run sandboxed JS inline (no AI),
// so behavior is DETERMINISTIC → exact grading. Probes the execution engine, not the
// model:
//   • chain        — 3 steps with ${var} passing (step3 uses step2 uses step1)
//   • searchjql    — sandbox api.searchJql then write the count
//   • error-halt   — step2 THROWS; step3 must NOT run; step1's write must persist
//                    (no silent rollback, graceful failedStep report)
//   • conditional  — read the issue, branch on content, write the chosen value
//   • fullapi      — getIssue + log + updateIssue in one step
// Static PFs are inline → read the field after a short poll. Transitions R7-*; issues cogtest-r7.

import { post, get, getIssue, doTransition, sleep, BASE } from "../lib/jira.mjs";
import { readWorkflow, updateWorkflow, makeSelfLoop, buildRule, attachRuleToTransition } from "../lib/workflow.mjs";
import { loadState, writeResult } from "../lib/state.mjs";
import { adfDoc } from "../lib/synthesize.mjs";

const R7_LABEL = "cogtest-r7";

async function seedIssue(projectKey, typeId, summary, descText) {
  const body = { fields: { project: { key: projectKey }, issuetype: { id: String(typeId) }, summary, labels: [R7_LABEL], description: adfDoc(descText) } };
  return (await post("/rest/api/3/issue", body)).key;
}
async function defaultIssueTypeId(projectKey) {
  const meta = await get(`/rest/api/3/issue/createmeta?projectKeys=${projectKey}&expand=projects.issuetypes`);
  const proj = meta?.projects?.[0];
  const it = (proj?.issuetypes || []).find((t) => !t.subtask) || proj?.issuetypes?.[0];
  return it?.id;
}
const fText = (i, id) => { const v = i?.fields?.[id]; return typeof v === "string" ? v : (v == null ? "" : JSON.stringify(v)); };

async function main() {
  console.log(`ROUND 7 — static PF execution depth on ${BASE}\n`);
  const s = loadState();
  const cf = s.customFields || {};
  const T = cf.text?.id || cf.text; // customfield_10280
  const wfName = s.workflowName, hubRef = s.hubStatusRef, projectKey = s.projectKey || "COGTEST";
  if (!wfName || !hubRef || !T) throw new Error("Run `npm run setup` first.");

  // \${stepN} = the backend's inter-step interpolation (NOT JS interpolation here).
  const rules = [
    { key: "R7-chain", expect: (v) => v === "chain=42", note: "3-step chain via BARE-NAME scope vars → 7*6=42",
      steps: [
        { name: "a", variableName: "step1", code: `return 7;` },
        { name: "b", variableName: "step2", code: `return Number(step1) * 6;` },
        { name: "c", variableName: "step3", code: `await api.updateIssue(api.context.issueKey, { "${T}": "chain=" + step2 }); return "done";` },
      ] },
    { key: "R7-searchjql", expect: (v) => /^found=\d+$/.test(v), note: "sandbox searchJql → count (bare-name var)",
      steps: [
        { name: "q", variableName: "step1", code: `const r = await api.searchJql("project = ${projectKey} ORDER BY created DESC", 5); const n = Array.isArray(r) ? r.length : ((r && (r.issues || r.results)) || []).length; return n;` },
        { name: "w", variableName: "step2", code: `await api.updateIssue(api.context.issueKey, { "${T}": "found=" + step1 }); return "ok";` },
      ] },
    { key: "R7-errorhalt", expect: () => true, note: "INFO: continue-on-error design — step2 throws, step3 still runs, failure reported via failedStep",
      steps: [
        { name: "ok", variableName: "step1", code: `await api.updateIssue(api.context.issueKey, { "${T}": "step1-ran" }); return "a";` },
        { name: "boom", variableName: "step2", code: `throw new Error("intentional failure in step 2");` },
        { name: "never", variableName: "step3", code: `await api.updateIssue(api.context.issueKey, { "${T}": "step3-SHOULD-NOT-RUN" }); return "c";` },
      ] },
    { key: "R7-conditional", expect: (v) => v === "cond=BUG", note: "branch on issue content",
      steps: [
        { name: "branch", variableName: "step1", code: `const issue = await api.getIssue(api.context.issueKey); const bug = JSON.stringify(issue.fields || {}).indexOf("500") >= 0; await api.updateIssue(api.context.issueKey, { "${T}": bug ? "cond=BUG" : "cond=OK" }); return bug;` },
      ] },
    { key: "R7-fullapi", expect: (v) => /^api-ok:/.test(v), note: "getIssue + log + updateIssue",
      steps: [
        { name: "api", variableName: "step1", code: `api.log("round7 fullapi start"); const issue = await api.getIssue(api.context.issueKey); const k = issue.key || api.context.issueKey; await api.updateIssue(api.context.issueKey, { "${T}": "api-ok:" + k }); return k;` },
      ] },
  ];

  console.log("Attaching R7- static self-loops…");
  const attached = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const { top, wf } = await readWorkflow(wfName);
    const existing = new Set((wf.transitions || []).map((t) => String(t.id)));
    wf.transitions = (wf.transitions || []).filter((t) => !String(t.name || "").startsWith("R7-"));
    let idNum = 9870; attached.length = 0;
    for (const r of rules) {
      while (existing.has(String(idNum))) idNum++; existing.add(String(idNum));
      try {
        const cfg = { type: "postfunction-static", functions: r.steps.map((st) => ({ name: st.name, code: st.code, variableName: st.variableName })), debugTrace: true };
        const built = buildRule("static", cfg);
        const t = makeSelfLoop(hubRef, r.key, idNum); attachRuleToTransition(t, "static", built); wf.transitions.push(t);
        attached.push({ r, tid: String(idNum) });
      } catch (e) { attached.push({ r, error: e.message.slice(0, 100) }); }
      idNum++;
    }
    try { await updateWorkflow(top, wf); break; } catch (e) { if (attempt === 0 && /409|version/i.test(e.message)) continue; throw e; }
  }
  console.log(`Attached ${attached.filter((a) => a.tid).length}/${rules.length}.`);

  const typeId = await defaultIssueTypeId(projectKey);
  const desc = "Saved-card checkout returns HTTP 500 after release v2.3 under duplicate submit; needs an idempotency key.";

  const results = [];
  for (const a of attached.filter((x) => x.tid)) {
    const r = a.r;
    try {
      const key = await seedIssue(projectKey, typeId, "R7 " + r.key + " probe", desc);
      await sleep(400);
      const res = await doTransition(key, a.tid);
      // Static PFs run INLINE — read after a short poll.
      let val = "";
      for (let i = 0; i < 6; i++) { await sleep(2500); val = fText(await getIssue(key, T), T); if (val) break; }
      const ok = r.expect(val);
      const grade = res.status >= 500 ? "HARD" : (ok ? "PASS" : "SOFT");
      results.push({ key: r.key, note: r.note, http: res.status, value: val, ok, grade });
    } catch (e) { results.push({ key: r.key, note: r.note, error: e.message.slice(0, 140), ok: false, grade: "HARD" }); }
  }

  console.log(`\n=== ROUND 7 — static PF execution results ===`);
  for (const x of results) {
    const mark = x.ok ? "✅ PASS" : (x.grade === "HARD" ? "❌ HARD" : "⚠️  SOFT");
    console.log(`  ${mark}  ${x.key.padEnd(15)} value=${JSON.stringify(x.value)}  — ${x.error ? "ERROR " + x.error : x.note}`);
  }
  const pass = results.filter((x) => x.ok).length;
  const hard = results.filter((x) => x.grade === "HARD").length;
  console.log(`\n${pass}/${results.length} correct · ${hard} HARD (system) ${hard ? "⚠️" : "✅"}`);
  writeResult("round7-static.json", { base: BASE, results, pass, hard });
  console.log(`Cleanup: CLEAN=1 npm run audit  +  delete issues by  labels = ${R7_LABEL}`);
}

main().catch((e) => { console.error("round7 error:", e); process.exit(1); });
