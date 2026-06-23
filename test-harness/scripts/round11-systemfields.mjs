/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// ROUND 11 — SYSTEM-FIELD semantic writes. Round 5 covered CUSTOM fields; this targets
// JIRA SYSTEM fields, which take different write shapes + validation:
//   • priority (system option, closed set Highest..Lowest)
//   • labels   (system array of kebab strings)
//   • summary  (system single-line text — overwrite)
// Heavy → queued async, so poll. Transitions R11-*; issues cogtest-r11.

import { post, get, getIssue, doTransition, sleep, BASE } from "../lib/jira.mjs";
import { readWorkflow, updateWorkflow, makeSelfLoop, buildRule, attachRuleToTransition } from "../lib/workflow.mjs";
import { loadState, writeResult } from "../lib/state.mjs";
import { adfDoc } from "../lib/synthesize.mjs";

const R11_LABEL = "cogtest-r11";
const PRIORITIES = ["Highest", "High", "Medium", "Low", "Lowest"];
const INCIDENT = "Critical: saved-card checkout returns HTTP 500 after release v2.3; ~3% of payments fail, revenue-impacting. Needs an idempotency key + regression test urgently.";

async function seedIssue(projectKey, typeId, summary, descText) {
  const body = { fields: { project: { key: projectKey }, issuetype: { id: String(typeId) }, summary, labels: [R11_LABEL], description: adfDoc(descText) } };
  return (await post("/rest/api/3/issue", body)).key;
}
async function defaultIssueTypeId(projectKey) {
  const meta = await get(`/rest/api/3/issue/createmeta?projectKeys=${projectKey}&expand=projects.issuetypes`);
  const proj = meta?.projects?.[0];
  const it = (proj?.issuetypes || []).find((t) => !t.subtask) || proj?.issuetypes?.[0];
  return it?.id;
}
async function readTrace(key) { try { const r = await get(`/rest/api/3/issue/${key}/properties/cogni-debug`, { raw: true }); if (r.status >= 400) return null; return JSON.parse(r.text).value; } catch { return null; } }

function validate(role, issue, seedSummary) {
  const f = issue?.fields || {};
  switch (role) {
    case "priority": { const n = f.priority?.name; return n && PRIORITIES.includes(n) ? { ok: true, why: n } : { ok: false, why: `priority=${n}` }; }
    case "labels": { const l = (f.labels || []).filter((x) => x !== R11_LABEL); return l.length ? { ok: true, why: l.join(",") } : { ok: false, why: "no new labels" }; }
    case "summary": { const sm = f.summary || ""; return (sm && sm !== seedSummary) ? { ok: true, why: sm.slice(0, 60) } : { ok: false, why: `unchanged "${sm.slice(0,40)}"` }; }
    default: return { ok: false, why: "?" };
  }
}

async function main() {
  console.log(`ROUND 11 — system-field semantic writes on ${BASE}\n`);
  const s = loadState();
  const wfName = s.workflowName, hubRef = s.hubStatusRef, projectKey = s.projectKey || "COGTEST";
  if (!wfName || !hubRef) throw new Error("Run `npm run setup` first.");

  const rules = [
    { key: "R11-priority", role: "priority", readField: "priority",
      config: { type: "postfunction-semantic", fieldId: "description", conditionPrompt: "Run every time", actionPrompt: `Set the priority based on the severity and business impact described. Choose EXACTLY one of: ${PRIORITIES.join(", ")}.`, actionFieldId: "priority" } },
    { key: "R11-labels", role: "labels", readField: "labels",
      config: { type: "postfunction-semantic", fieldId: "description", conditionPrompt: "Run every time", actionPrompt: "Add 2-4 concise lowercase kebab-case labels that classify this issue (e.g. payments, regression).", actionFieldId: "labels" } },
    { key: "R11-summary", role: "summary", readField: "summary",
      config: { type: "postfunction-semantic", fieldId: "description", conditionPrompt: "Run every time", actionPrompt: "Rewrite the summary as a clear, concise one-line engineering title (under 80 chars).", actionFieldId: "summary" } },
  ].map((r) => { r.config.debugTrace = true; return r; });

  console.log("Attaching R11- self-loops…");
  const attached = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const { top, wf } = await readWorkflow(wfName);
    const existing = new Set((wf.transitions || []).map((t) => String(t.id)));
    wf.transitions = (wf.transitions || []).filter((t) => !String(t.name || "").startsWith("R11-"));
    let idNum = 9930; attached.length = 0;
    for (const r of rules) {
      while (existing.has(String(idNum))) idNum++; existing.add(String(idNum));
      try { const built = buildRule("semantic", r.config); const t = makeSelfLoop(hubRef, r.key, idNum); attachRuleToTransition(t, "semantic", built); wf.transitions.push(t); attached.push({ r, tid: String(idNum) }); }
      catch (e) { attached.push({ r, error: e.message.slice(0, 100) }); }
      idNum++;
    }
    try { await updateWorkflow(top, wf); break; } catch (e) { if (attempt === 0 && /409|version/i.test(e.message)) continue; throw e; }
  }
  console.log(`Attached ${attached.filter((a) => a.tid).length}/${rules.length}.`);

  const typeId = await defaultIssueTypeId(projectKey);
  const results = [];
  for (const a of attached.filter((x) => x.tid)) {
    const r = a.r;
    try {
      const seedSummary = "R11 " + r.role + " probe";
      const key = await seedIssue(projectKey, typeId, seedSummary, INCIDENT);
      await sleep(400);
      const res = await doTransition(key, a.tid);
      let issue = null, v = { ok: false, why: "not written" };
      const deadline = Date.now() + 120000;
      while (Date.now() < deadline) {
        await sleep(4000);
        issue = await getIssue(key, `${r.readField},updated`);
        v = validate(r.role, issue, seedSummary);
        if (v.ok) break;
        const t = await readTrace(key);
        if (t && /skip|fail|invalid|refus/i.test(JSON.stringify(t))) break;
      }
      const trace = await readTrace(key);
      const grade = res.status >= 500 ? "HARD" : (v.ok ? "PASS" : "SOFT");
      results.push({ key: r.key, role: r.role, ok: v.ok, why: v.why, http: res.status, grade, model: trace?.modelUsed || null, reason: (trace?.reason || "").slice(0, 120) });
    } catch (e) { results.push({ key: r.key, role: r.role, error: e.message.slice(0, 140), ok: false, grade: "HARD" }); }
  }

  console.log(`\n=== ROUND 11 — system-field writes ===`);
  for (const x of results) {
    const mark = x.ok ? "✅ PASS" : (x.grade === "HARD" ? "❌ HARD" : "⚠️  SOFT");
    console.log(`  ${mark}  ${x.key.padEnd(14)} ${x.error ? "ERROR " + x.error : x.why}  ${x.reason ? "(" + x.reason + ")" : ""}`);
  }
  const pass = results.filter((x) => x.ok).length;
  const hard = results.filter((x) => x.grade === "HARD").length;
  console.log(`\n${pass}/${results.length} valid writes · ${hard} HARD ${hard ? "⚠️" : "✅"}`);
  writeResult("round11-systemfields.json", { base: BASE, results, pass, hard });
  console.log(`Cleanup: CLEAN=1 npm run audit  +  delete issues by  labels = ${R11_LABEL}`);
}

main().catch((e) => { console.error("round11 error:", e); process.exit(1); });
