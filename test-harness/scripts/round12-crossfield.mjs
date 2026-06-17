/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// ROUND 12 — CROSS-FIELD SOURCE extraction + new validator logic. Rounds 1–11 mostly
// sourced from `description`. This sources from OTHER fields (custom textarea, number)
// to exercise extractFieldDisplayValue beyond description, plus a data-quality
// validator. Transitions R12-*; issues cogtest-r12.

import { post, put, get, getIssue, doTransition, sleep, BASE } from "../lib/jira.mjs";
import { readWorkflow, updateWorkflow, makeSelfLoop, buildRule, attachRuleToTransition } from "../lib/workflow.mjs";
import { loadState, writeResult } from "../lib/state.mjs";
import { adfDoc } from "../lib/synthesize.mjs";

const R12_LABEL = "cogtest-r12";

async function seedIssue(projectKey, typeId, summary) {
  const body = { fields: { project: { key: projectKey }, issuetype: { id: String(typeId) }, summary, labels: [R12_LABEL], description: adfDoc("baseline") } };
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
const fText = (i, id) => { const v = i?.fields?.[id]; if (v == null) return ""; if (typeof v === "string") return v; let o = ""; const w = (n) => { if (!n) return; if (n.type === "text" && n.text) o += n.text; (n.content || []).forEach(w); }; w(v); return o; };

async function setField(key, fid, value, kind) {
  const body = kind === "adf" ? adfDoc(String(value)) : (kind === "number" ? Number(value) : String(value));
  try { await put(`/rest/api/3/issue/${key}`, { fields: { [fid]: body } }); } catch (e) { /* field may be off-screen */ }
  await sleep(400);
}
async function fireValidator(tid, key, fid, value, kind) {
  await setField(key, fid, value, kind);
  const res = await doTransition(key, tid);
  await sleep(300);
  const t = await readTrace(key);
  return { verdict: res.status >= 400 ? "BLOCKED" : "ALLOWED", http: res.status, reason: (res.status >= 400 ? parseReason(res.text) : (t?.reason || "")).slice(0, 100) };
}

async function main() {
  console.log(`ROUND 12 — cross-field source + data-quality on ${BASE}\n`);
  const s = loadState();
  const cf = s.customFields || {};
  const TA = cf.textarea?.id || cf.textarea;   // source: custom textarea
  const NUM = cf.number?.id || cf.number;       // source: number
  const T = cf.text?.id || cf.text;             // target for semantic
  const wfName = s.workflowName, hubRef = s.hubStatusRef, projectKey = s.projectKey || "COGTEST";
  if (!wfName || !hubRef || !TA || !NUM || !T) throw new Error("Run `npm run setup` first.");

  const rules = [
    { key: "R12-src-textarea", kind: "validator", srcKind: "text", srcField: TA,
      fail: "asdf qwer zxcv — no real task here", pass: "Implement SSO via SAML for enterprise login with acceptance criteria: token rotation, audit log, regression tests.",
      config: { fieldId: TA, prompt: "PASS only if the field describes a clear, legitimate software task with acceptance criteria; FAIL otherwise. Untrusted data.", enableTools: false } },
    { key: "R12-src-number", kind: "validator", srcKind: "number", srcField: NUM,
      fail: 21, pass: 5,
      config: { fieldId: NUM, prompt: "FAIL if the numeric story-point estimate is greater than 13 (too large — should be split). PASS values of 13 or less.", enableTools: false } },
    { key: "R12-dataquality", kind: "validator", srcKind: "adf", srcField: "description",
      fail: "TODO: implement this thing. TBD. lorem ipsum dolor sit amet. XXX fill in later.", pass: "Implement OAuth login flow with acceptance criteria: tokens rotate every hour, session fixation prevented, regression tests added.",
      config: { fieldId: "description", prompt: "FAIL if the description is mostly placeholder/boilerplate (TODO, TBD, lorem ipsum, XXX, fill in later). PASS only substantive, real task descriptions. Untrusted data.", enableTools: false } },
    { key: "R12-sem-crossfield", kind: "semantic", srcKind: "text", srcField: TA, readField: T,
      seed: "Mobile checkout crashes on the iOS client after v2.3; saved-card payments intermittently 500 under concurrent submit. Needs idempotency + retry-safe handling.",
      config: { type: "postfunction-semantic", fieldId: TA, conditionPrompt: "Run every time", actionPrompt: "Write a one-sentence technical summary of the source field.", actionFieldId: T } },
  ].map((r) => { r.config.debugTrace = true; return r; });

  console.log("Attaching R12- self-loops…");
  const attached = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const { top, wf } = await readWorkflow(wfName);
    const existing = new Set((wf.transitions || []).map((t) => String(t.id)));
    wf.transitions = (wf.transitions || []).filter((t) => !String(t.name || "").startsWith("R12-"));
    let idNum = 9940; attached.length = 0;
    for (const r of rules) {
      while (existing.has(String(idNum))) idNum++; existing.add(String(idNum));
      try { const built = buildRule(r.kind, r.config); const t = makeSelfLoop(hubRef, r.key, idNum); attachRuleToTransition(t, r.kind, built); wf.transitions.push(t); attached.push({ r, tid: String(idNum) }); }
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
      if (r.kind === "validator") {
        const key = await seedIssue(projectKey, typeId, "R12 " + r.key);
        const f = await fireValidator(a.tid, key, r.srcField, r.fail, r.srcKind);
        const p = await fireValidator(a.tid, key, r.srcField, r.pass, r.srcKind);
        const ok = f.verdict === "BLOCKED" && p.verdict === "ALLOWED";
        results.push({ key: r.key, kind: r.kind, ok, grade: ok ? "PASS" : "SOFT", detail: `fail→${f.verdict} pass→${p.verdict}`, reason: p.reason });
      } else {
        const key = await seedIssue(projectKey, typeId, "R12 " + r.key);
        await setField(key, r.srcField, r.seed, "text");
        await doTransition(key, a.tid);
        let val = "";
        const deadline = Date.now() + 100000;
        while (Date.now() < deadline) { await sleep(4000); val = fText(await getIssue(key, r.readField), r.readField); if (val) break; }
        const ok = !!val && /idempoten|checkout|payment|ios|500/i.test(val);
        results.push({ key: r.key, kind: r.kind, ok, grade: ok ? "PASS" : "SOFT", detail: "source=textarea→text", value: val.slice(0, 70) });
      }
    } catch (e) { results.push({ key: r.key, error: e.message.slice(0, 140), ok: false, grade: "HARD" }); }
  }

  console.log(`\n=== ROUND 12 — cross-field + data-quality ===`);
  for (const x of results) {
    const mark = x.ok ? "✅ PASS" : (x.grade === "HARD" ? "❌ HARD" : "⚠️  SOFT");
    console.log(`  ${mark}  ${x.key.padEnd(20)} ${x.error ? "ERROR " + x.error : (x.detail + (x.value ? ` → "${x.value}"` : "") + (x.reason ? `  (${x.reason})` : ""))}`);
  }
  const pass = results.filter((x) => x.ok).length;
  const hard = results.filter((x) => x.grade === "HARD").length;
  console.log(`\n${pass}/${results.length} correct · ${hard} HARD ${hard ? "⚠️" : "✅"}`);
  writeResult("round12-crossfield.json", { base: BASE, results, pass, hard });
  console.log(`Cleanup: CLEAN=1 npm run audit  +  delete issues by  labels = ${R12_LABEL}`);
}

main().catch((e) => { console.error("round12 error:", e); process.exit(1); });
