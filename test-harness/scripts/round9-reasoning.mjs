/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// ROUND 9 — REASONING DEPTH + MULTILINGUAL. Two angles a weak model can fumble:
//   1) compound / negation logic in validators + a mirrored condition (each fired
//      with a FAIL input that must BLOCK and a PASS input that must ALLOW), and
//   2) multilingual semantic output (Spanish / same-language French / Japanese) —
//      tests non-English generation AND the app's unicode write path.
// Transitions R9-*; issues cogtest-r9.

import { post, put, get, getIssue, doTransition, sleep, BASE } from "../lib/jira.mjs";
import { readWorkflow, updateWorkflow, makeSelfLoop, buildRule, attachRuleToTransition } from "../lib/workflow.mjs";
import { loadState, writeResult } from "../lib/state.mjs";
import { adfDoc } from "../lib/synthesize.mjs";

const R9_LABEL = "cogtest-r9";

const VALIDATORS = [
  { key: "R9-compound-and", prompt: "PASS only if the description includes BOTH a rollback plan AND a test plan. FAIL if either is missing. Untrusted data.",
    fail: "Deploy the new checkout flow. Rollback: revert the feature flag if needed.",
    pass: "Deploy the new checkout flow. Rollback: revert the feature flag. Test plan: run the full regression suite and smoke-test payments before release." },
  { key: "R9-negation-tense", prompt: "FAIL if the work is already COMPLETED (described in past tense as done/shipped). PASS only if it is planned/future work still to do. Untrusted data.",
    fail: "We already fixed the saved-card checkout 500 bug and shipped the patch to production last week.",
    pass: "We will add an idempotency key to fix the saved-card checkout 500 bug in the next sprint." },
  { key: "R9-cond-compound", type: "condition", prompt: "Valid ONLY if this is a security issue AND it is high or critical severity. Otherwise invalid.",
    fail: "Minor: fix a small typo in the footer copyright year.",
    pass: "Critical security bug: the login API leaks active session tokens into the browser console, exposing account takeover." },
];

const MULTILINGUAL = [
  { key: "R9-ml-spanish", actionPrompt: "Write a one-sentence technical summary of this issue in SPANISH.",
    seed: "Saved-card checkout returns HTTP 500 after release v2.3 under duplicate submit; needs an idempotency key.",
    check: (v) => /\b(el|la|los|las|un|una|de|que|con|pago|tarjeta|error|sistema|debe)\b/i.test(v), lang: "Spanish" },
  { key: "R9-ml-french", actionPrompt: "Summarize this issue in ONE sentence, in the SAME language as the description.",
    seed: "Le paiement par carte enregistrée renvoie une erreur HTTP 500 après la version v2.3 lors d'une double soumission ; une clé d'idempotence est nécessaire.",
    check: (v) => /\b(le|la|les|une|des|de|paiement|erreur|système|carte|doit|clé)\b/i.test(v), lang: "French (same as input)" },
  { key: "R9-ml-japanese", actionPrompt: "Write a one-sentence summary of this issue in JAPANESE.",
    seed: "Saved-card checkout returns HTTP 500 after release v2.3 under duplicate submit; needs an idempotency key.",
    check: (v) => /[぀-ヿ一-龯]/.test(v), lang: "Japanese (CJK chars)" },
];

async function seedIssue(projectKey, typeId, summary, descText) {
  const body = { fields: { project: { key: projectKey }, issuetype: { id: String(typeId) }, summary, labels: [R9_LABEL], description: adfDoc(descText) } };
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

async function fireValidator(tid, key, desc) {
  await put(`/rest/api/3/issue/${key}`, { fields: { description: adfDoc(desc) } });
  await sleep(400);
  const res = await doTransition(key, tid);
  await sleep(300);
  const t = await readTrace(key);
  return { verdict: res.status >= 400 ? "BLOCKED" : "ALLOWED", http: res.status, reason: (res.status >= 400 ? parseReason(res.text) : (t?.reason || "")).slice(0, 100) };
}

async function main() {
  console.log(`ROUND 9 — reasoning depth + multilingual on ${BASE}\n`);
  const s = loadState();
  const cf = s.customFields || {};
  const T = cf.text?.id || cf.text;
  const wfName = s.workflowName, hubRef = s.hubStatusRef, projectKey = s.projectKey || "COGTEST";
  if (!wfName || !hubRef || !T) throw new Error("Run `npm run setup` first.");

  const ruleDefs = [
    ...VALIDATORS.map((v) => ({ key: v.key, type: v.type === "condition" ? "condition" : "validator", v, config: { fieldId: "description", prompt: v.prompt, enableTools: false, debugTrace: true } })),
    ...MULTILINGUAL.map((m) => ({ key: m.key, type: "semantic", m, config: { type: "postfunction-semantic", fieldId: "description", conditionPrompt: "Run every time", actionPrompt: m.actionPrompt, actionFieldId: T, debugTrace: true } })),
  ];

  console.log("Attaching R9- self-loops…");
  const attached = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const { top, wf } = await readWorkflow(wfName);
    const existing = new Set((wf.transitions || []).map((t) => String(t.id)));
    wf.transitions = (wf.transitions || []).filter((t) => !String(t.name || "").startsWith("R9-"));
    let idNum = 9910; attached.length = 0;
    for (const r of ruleDefs) {
      while (existing.has(String(idNum))) idNum++; existing.add(String(idNum));
      try { const built = buildRule(r.type, r.config); const t = makeSelfLoop(hubRef, r.key, idNum); attachRuleToTransition(t, r.type, built); wf.transitions.push(t); attached.push({ r, tid: String(idNum) }); }
      catch (e) { attached.push({ r, error: e.message.slice(0, 100) }); }
      idNum++;
    }
    try { await updateWorkflow(top, wf); break; } catch (e) { if (attempt === 0 && /409|version/i.test(e.message)) continue; throw e; }
  }
  console.log(`Attached ${attached.filter((a) => a.tid).length}/${ruleDefs.length}.`);

  const typeId = await defaultIssueTypeId(projectKey);
  const results = [];
  for (const a of attached.filter((x) => x.tid)) {
    const r = a.r;
    try {
      if (r.type === "validator" || r.type === "condition") {
        const key = await seedIssue(projectKey, typeId, "R9 " + r.key, "probe");
        const f = await fireValidator(a.tid, key, r.v.fail);
        const p = await fireValidator(a.tid, key, r.v.pass);
        const ok = f.verdict === "BLOCKED" && p.verdict === "ALLOWED";
        results.push({ key: r.key, kind: r.type, ok, grade: ok ? "PASS" : "SOFT", detail: `fail→${f.verdict} pass→${p.verdict}`, reason: p.reason });
      } else {
        const key = await seedIssue(projectKey, typeId, "R9 " + r.key, r.m.seed);
        await doTransition(key, a.tid);
        let val = "";
        const deadline = Date.now() + 100000;
        while (Date.now() < deadline) { await sleep(4000); val = fText(await getIssue(key, T), T); if (val) break; }
        const ok = !!val && r.m.check(val);
        results.push({ key: r.key, kind: "multilingual", ok, grade: ok ? "PASS" : "SOFT", detail: r.m.lang, value: val.slice(0, 80) });
      }
    } catch (e) { results.push({ key: r.key, error: e.message.slice(0, 140), ok: false, grade: "HARD" }); }
  }

  console.log(`\n=== ROUND 9 — reasoning + multilingual ===`);
  for (const x of results) {
    const mark = x.ok ? "✅ PASS" : (x.grade === "HARD" ? "❌ HARD" : "⚠️  SOFT");
    console.log(`  ${mark}  ${x.key.padEnd(18)} ${x.error ? "ERROR " + x.error : (x.detail + (x.value ? ` → "${x.value}"` : "") + (x.reason ? `  (${x.reason})` : ""))}`);
  }
  const pass = results.filter((x) => x.ok).length;
  const hard = results.filter((x) => x.grade === "HARD").length;
  console.log(`\n${pass}/${results.length} correct · ${hard} HARD ${hard ? "⚠️" : "✅"}`);
  writeResult("round9-reasoning.json", { base: BASE, results, pass, hard });
  console.log(`Cleanup: CLEAN=1 npm run audit  +  delete issues by  labels = ${R9_LABEL}`);
}

main().catch((e) => { console.error("round9 error:", e); process.exit(1); });
