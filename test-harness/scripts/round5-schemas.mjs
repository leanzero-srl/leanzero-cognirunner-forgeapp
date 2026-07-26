/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// ROUND 5 — HARD OUTPUT SCHEMAS. The canonical rounds covered text/number/select/
// radio/multiselect/date. This pushes the schemas most likely to expose clamping /
// coercion edges on a weak model:
//   • cascading select  (Platform > {iOS|Android|Web})  — parent>child shape
//   • datetime + timezone                               — ISO-with-offset
//   • userpicker        (resolve a NAME to an accountId)
//   • url
//   • checkboxes        (subset of {A11y,Perf,Docs,Tests})
//   • multi-step STATIC PF (step2 references ${step1}) — inter-step variable passing
// The backend only WRITES a value that passes validateValueAgainstField, so a
// successful, type-VALID write proves the clamp/coercion held. We read the field
// back and validate per type. Transitions named R5-*; issues labelled cogtest-r5.

import { post, get, getIssue, doTransition, sleep, BASE, getMyself } from "../lib/jira.mjs";
import { readWorkflow, updateWorkflow, makeSelfLoop, buildRule, attachRuleToTransition } from "../lib/workflow.mjs";
import { loadState, writeResult } from "../lib/state.mjs";
import { adfDoc } from "../lib/synthesize.mjs";

const R5_LABEL = "cogtest-r5";
const CASC_KIDS = ["iOS", "Android", "Web"];
const CHK_OPTS = ["A11y", "Perf", "Docs", "Tests"];

async function seedIssue(projectKey, typeId, summary, descText) {
  const body = { fields: { project: { key: projectKey }, issuetype: { id: String(typeId) }, summary, labels: [R5_LABEL], description: adfDoc(descText) } };
  return (await post("/rest/api/3/issue", body)).key;
}
async function defaultIssueTypeId(projectKey) {
  const meta = await get(`/rest/api/3/issue/createmeta?projectKeys=${projectKey}&expand=projects.issuetypes`);
  const proj = meta?.projects?.[0];
  const it = (proj?.issuetypes || []).find((t) => !t.subtask) || proj?.issuetypes?.[0];
  return it?.id;
}
async function readTrace(key) { try { const r = await get(`/rest/api/3/issue/${key}/properties/cogni-debug`, { raw: true }); if (r.status >= 400) return null; return JSON.parse(r.text).value; } catch { return null; } }

// per-type validity of the WRITTEN field value
function validate(role, v) {
  if (v == null) return { ok: false, why: "not written (null)" };
  switch (role) {
    case "cascading": {
      const parent = v.value, child = v.child?.value;
      if (parent !== "Platform") return { ok: false, why: `parent=${parent}` };
      if (child && !CASC_KIDS.includes(child)) return { ok: false, why: `child=${child} not in ${CASC_KIDS}` };
      return { ok: true, why: `Platform${child ? " > " + child : ""}` };
    }
    case "datetime": {
      const s = String(v); const d = Date.parse(s);
      const hasTime = /T\d\d:\d\d/.test(s);
      if (isNaN(d)) return { ok: false, why: `unparseable "${s}"` };
      if (!hasTime) return { ok: false, why: `no time component "${s}"` };
      return { ok: true, why: s };
    }
    case "user": {
      const id = v.accountId || (Array.isArray(v) && v[0]?.accountId);
      return id ? { ok: true, why: `accountId ${String(id).slice(0, 10)}…` } : { ok: false, why: "no accountId (ambiguous → SKIP is acceptable)" };
    }
    case "url": {
      const s = String(v); return /^https?:\/\//i.test(s) ? { ok: true, why: s } : { ok: false, why: `not a URL "${s}"` };
    }
    case "checkboxes": {
      const arr = Array.isArray(v) ? v.map((o) => o.value) : [];
      if (!arr.length) return { ok: false, why: "empty" };
      const bad = arr.filter((x) => !CHK_OPTS.includes(x));
      return bad.length ? { ok: false, why: `invalid opts ${bad}` } : { ok: true, why: arr.join(",") };
    }
    case "text": { // multi-step static writes here
      const s = String(v); return /multistep:/.test(s) ? { ok: true, why: s.slice(0, 60) } : { ok: false, why: `unexpected "${s.slice(0, 60)}"` };
    }
    default: return { ok: false, why: "no validator" };
  }
}

async function main() {
  console.log(`ROUND 5 — hard output schemas on ${BASE}\n`);
  const s = loadState();
  const cf = s.customFields || {};
  const fid = (k) => cf[k]?.id || cf[k];
  const wfName = s.workflowName, hubRef = s.hubStatusRef, projectKey = s.projectKey || "COGTEST";
  if (!wfName || !hubRef) throw new Error("Run `npm run setup` first.");

  const me = await getMyself().catch(() => null);
  const myName = me?.displayName || "the project lead";

  // Multi-step static: step1 computes a token, step2 references ${step1} and writes it.
  const textF = fid("text");
  const step1Code = `const issue = await api.getIssue(api.context.issueKey);\nconst n = String(issue.fields.summary || "").split(/\\s+/).filter(Boolean).length;\nreturn "w" + n;`;
  const step2Code = `await api.updateIssue(api.context.issueKey, { "${textF}": "multistep:\${step1}" });\nreturn "wrote \${step1}";`;

  const rules = [
    { key: "R5-cascading", role: "cascading", readField: fid("cascading"), type: "semantic",
      config: { type: "postfunction-semantic", fieldId: "description", conditionPrompt: "Run every time", actionPrompt: `Classify the platform this issue affects. Return EXACTLY "Platform > X" where X is one of: ${CASC_KIDS.join(", ")}.`, actionFieldId: fid("cascading") } },
    { key: "R5-datetime", role: "datetime", readField: fid("datetime"), type: "semantic",
      config: { type: "postfunction-semantic", fieldId: "description", conditionPrompt: "Run every time", actionPrompt: "Propose a follow-up review timestamp about 2 business days from 2026-06-17, as an ISO-8601 datetime WITH a timezone offset (e.g. 2026-06-19T15:00:00.000+0000).", actionFieldId: fid("datetime") } },
    { key: "R5-user", role: "user", readField: fid("user"), type: "semantic",
      config: { type: "postfunction-semantic", fieldId: "description", conditionPrompt: "Run every time", actionPrompt: `Assign this issue to the owner named in the description. Return ONLY that person's exact full display name.`, actionFieldId: fid("user") } },
    { key: "R5-url", role: "url", readField: fid("url"), type: "semantic",
      config: { type: "postfunction-semantic", fieldId: "description", conditionPrompt: "Run every time", actionPrompt: "Return the single most relevant official documentation URL for the main technology in this issue (a real https URL).", actionFieldId: fid("url") } },
    { key: "R5-checkboxes", role: "checkboxes", readField: fid("checkboxes"), type: "semantic",
      config: { type: "postfunction-semantic", fieldId: "description", conditionPrompt: "Run every time", actionPrompt: `Tag the applicable concerns. Choose any of EXACTLY: ${CHK_OPTS.join(", ")}.`, actionFieldId: fid("checkboxes") } },
    { key: "R5-multistep", role: "text", readField: textF, type: "static",
      config: { type: "postfunction-static", functions: [
        { name: "count", code: step1Code, variableName: "step1" },
        { name: "write", code: step2Code, variableName: "step2" },
      ] } },
  ].map((r) => { r.config.debugTrace = true; return r; });

  console.log("Attaching R5- self-loops…");
  const attached = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const { top, wf } = await readWorkflow(wfName);
    const existing = new Set((wf.transitions || []).map((t) => String(t.id)));
    wf.transitions = (wf.transitions || []).filter((t) => !String(t.name || "").startsWith("R5-"));
    let idNum = 9800; attached.length = 0;
    for (const r of rules) {
      while (existing.has(String(idNum))) idNum++; existing.add(String(idNum));
      try { const built = buildRule(r.type, r.config); const t = makeSelfLoop(hubRef, r.key, idNum); attachRuleToTransition(t, r.type, built); wf.transitions.push(t); attached.push({ r, tid: String(idNum) }); }
      catch (e) { attached.push({ r, error: e.message.slice(0, 100) }); }
      idNum++;
    }
    try { await updateWorkflow(top, wf); break; } catch (e) { if (attempt === 0 && /409|version/i.test(e.message)) continue; throw e; }
  }
  console.log(`Attached ${attached.filter((a) => a.tid).length}/${rules.length}.`);

  const typeId = await defaultIssueTypeId(projectKey);
  const desc = `Mobile checkout crashes on the Web and iOS clients after release v2.3 — saved-card payments intermittently 500. Owner: ${myName}. Needs accessibility review, performance profiling, and regression tests. Tech stack: React on the frontend.`;

  const results = [];
  for (const a of attached.filter((x) => x.tid)) {
    const r = a.r;
    try {
      const key = await seedIssue(projectKey, typeId, "R5 " + r.role + " probe", desc);
      await sleep(400);
      const res = await doTransition(key, a.tid);
      // Semantic PFs on LM Studio QUEUE async (heavy/slow-provider route), so the
      // write lands seconds-to-minutes later — POLL the field + trace until it
      // appears or the job reports a terminal reason. Static PFs run inline (caught
      // on the first poll).
      let written = null, trace = null;
      const deadline = Date.now() + 120000;
      while (Date.now() < deadline) {
        await sleep(4000);
        const iss = await getIssue(key, `${r.readField},updated`);
        written = iss?.fields?.[r.readField] ?? null;
        if (written != null) break;
        trace = await readTrace(key);
        if (trace && (trace.reason || trace.decision)) break; // ran (maybe SKIP/no-write)
      }
      const issue = await getIssue(key, `${r.readField},updated`);
      written = issue?.fields?.[r.readField] ?? written;
      trace = (await readTrace(key)) || trace;
      const v = validate(r.role, written);
      const grade = res.status >= 500 ? "HARD" : (v.ok ? "PASS" : "SOFT");
      results.push({ key: r.key, role: r.role, issue, http: res.status, ok: v.ok, why: v.why, grade, model: trace?.modelUsed || null, reason: (trace?.reason || "").slice(0, 120) });
    } catch (e) { results.push({ key: r.key, role: r.role, error: e.message.slice(0, 140), ok: false, grade: "HARD" }); }
  }

  console.log(`\n=== ROUND 5 — hard output schema results ===`);
  for (const x of results) {
    const mark = x.ok ? "✅ PASS" : (x.grade === "HARD" ? "❌ HARD" : "⚠️  SOFT");
    console.log(`  ${mark}  ${x.key.padEnd(14)} ${x.error ? "ERROR " + x.error : x.why}  ${x.model ? "(" + x.model + ")" : ""}`);
  }
  const pass = results.filter((x) => x.ok).length;
  const hard = results.filter((x) => x.grade === "HARD").length;
  console.log(`\n${pass}/${results.length} valid writes · ${hard} HARD (system) ${hard ? "⚠️" : "✅"}`);
  writeResult("round5-schemas.json", { base: BASE, results, pass, hard });
  console.log(`Cleanup: CLEAN=1 npm run audit  +  delete issues by  labels = ${R5_LABEL}`);
}

main().catch((e) => { console.error("round5 error:", e); process.exit(1); });
