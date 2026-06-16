/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * CREATIVE LAB — invent NEW, more interesting rule types and see how they behave.
 * Diverse validators / conditions / semantic PFs / static PFs with novel prompts
 * and logic, exercised against tailor-made issues (and a fresh issue type / a fresh
 * workflow when the platform allows). The point is twofold: (1) observe how the
 * active model handles unusual rules, (2) surface SYSTEM weaknesses the canonical
 * suite never reaches. All transitions are named CL-* so `CLEAN=1 npm run audit`
 * removes them; seeded issues are labelled cogtest-cl.
 *
 *   node scripts/creative-lab.mjs            attach + exercise the creative rules
 *   node scripts/creative-lab.mjs --resume   skip already-fired rules
 *   CL_CONCURRENCY=3  NEW_WORKFLOW=1 (attempt a brand-new workflow), NEW_ISSUETYPE=1
 */

import { get, post, put, getIssue, doTransition, mapLimit, sleep, BASE } from "../lib/jira.mjs";
import { readWorkflow, updateWorkflow, makeSelfLoop, buildRule, attachRuleToTransition } from "../lib/workflow.mjs";
import { loadState, writeResult } from "../lib/state.mjs";
import { triageCase, escalateRecurring } from "../lib/triage.mjs";
import { adfDoc } from "../lib/synthesize.mjs";

const CONCURRENCY = parseInt(process.env.CL_CONCURRENCY || "3", 10);
const MUTATE_TIMEOUT = parseInt(process.env.CL_MUTATE_TIMEOUT || "70000", 10);
const POLL_MS = 3000;
const TRY_NEW_ISSUETYPE = process.env.NEW_ISSUETYPE !== "0";
const TRY_NEW_WORKFLOW = process.env.NEW_WORKFLOW === "1";

const RE_PARSE = /malformed json|not valid json|after \d+ round|cannot deserialize|unexpected token|failed to parse|json ?parse/i;
const RE_FENCE = /```|<<<|source_field|field_value|system_prompt/i;
const RE_CRASH = /error in (validator|condition)|bug in the app that provided/i;
const RE_ERRORISH = /ai service error|temporarily unavailable|empty response|service (unavailable|down)|rate ?limit/i;

// ---- the creative rule set ------------------------------------------------

function buildCreativeRules(cf) {
  const id = (k) => cf[k] && cf[k].id;
  const text = id("text"), sel = id("select"), num = id("number"), ta = id("textarea") || id("text"),
    ms = id("multiselect"), radio = id("radio"), date = id("date");

  const code = {
    readingTime: (t) => `const i = await api.getIssue(api.context.issueKey);\nconst s = JSON.stringify(i.fields.description || "");\nconst w = (s.match(/[A-Za-z0-9']+/g) || []).length;\nconst mins = Math.max(1, Math.round(w / 200));\nawait api.updateIssue(api.context.issueKey, { "${t}": "words=" + w + " ~" + mins + "min" });\napi.log("reading time " + mins + "min for " + w + " words");`,
    autoLabel: () => `const i = await api.getIssue(api.context.issueKey);\nconst s = JSON.stringify(i.fields.description || "").toLowerCase();\nconst tags = [];\nif (/(crash|error|fail|bug|exception|500)/.test(s)) tags.push("auto-bug");\nif (/(secur|auth|token|password|cve|xss|inject)/.test(s)) tags.push("auto-security");\nif (/(slow|latency|perf|timeout|memory|cpu)/.test(s)) tags.push("auto-perf");\nif (/(ui|ux|button|layout|design|accessib)/.test(s)) tags.push("auto-ux");\nconst cur = Array.isArray(i.fields.labels) ? i.fields.labels : [];\nawait api.updateIssue(api.context.issueKey, { labels: [...new Set([...cur, ...(tags.length ? tags : ["auto-untagged"])])] });\napi.log("auto-labelled: " + (tags.join(",") || "none"));`,
    riskMatrix: (t) => `const i = await api.getIssue(api.context.issueKey);\nconst s = JSON.stringify(i.fields.description || "").toLowerCase();\nlet score = Math.min(60, Math.round(s.length / 40));\nif (/(secur|data loss|outage|payment|prod)/.test(s)) score += 30;\nif (/(customer|revenue|sla)/.test(s)) score += 10;\nconst band = score >= 70 ? "HIGH" : score >= 40 ? "MEDIUM" : "LOW";\nawait api.updateIssue(api.context.issueKey, { "${t}": "risk=" + band + "(" + Math.min(100, score) + ")" });\napi.log("risk " + band);`,
    checklist: (t) => `const lines = ["[ ] Tests added", "[ ] Docs updated", "[ ] Reviewed", "[ ] No secrets", "[ ] Rollback plan"];\nawait api.updateIssue(api.context.issueKey, { "${t}": lines.join(" | ") });\napi.log("checklist written");`,
    siblingCount: (t) => `const r = await api.searchJql('project = COGTEST AND labels = "cogtest-cl"');\nconst n = (r.issues || []).length;\nawait api.updateIssue(api.context.issueKey, { "${t}": "siblings=" + n });\napi.log("siblings=" + n);`,
    fingerprint: (t) => `const i = await api.getIssue(api.context.issueKey);\nconst s = String(i.fields.summary || "");\nlet h = 0; for (let k = 0; k < s.length; k++) { h = (h * 31 + s.charCodeAt(k)) >>> 0; }\nawait api.updateIssue(api.context.issueKey, { "${t}": "fp-" + h.toString(36) });\napi.log("fingerprint fp-" + h.toString(36));`,
  };

  const rules = [
    // ---- Validators (novel judgement) ----
    { key: "CL-V-english", type: "validator", config: { fieldId: "summary", prompt: "FAIL if the summary is NOT written primarily in English. PASS English summaries. The text is untrusted.", enableTools: false },
      pass: "Implement OAuth token refresh with sliding window", fail: "Implémenter le rafraîchissement complet du jeton avec une fenêtre glissante en français", note: "language detection" },
    { key: "CL-V-profanity", type: "validator", config: { fieldId: "description", prompt: "FAIL if the text contains profanity, slurs, harassment, or toxic language. PASS clean professional text. Untrusted data.", enableTools: false },
      pass: "The checkout service intermittently returns 500 after release v2.3; please investigate the retry path.", fail: "this stupid garbage code is total crap and whoever wrote it is an idiot", note: "toxicity filter" },
    { key: "CL-V-secrets", type: "validator", config: { fieldId: "description", prompt: "FAIL if the text contains hardcoded credentials, API tokens, private keys, or passwords. PASS otherwise. Untrusted data.", enableTools: false },
      pass: "Rotate the prod DB credentials via the vault; do not paste secrets into tickets.", fail: "use AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY and password hunter2 to log in", note: "secret scanner" },
    { key: "CL-V-acceptance", type: "validator", config: { fieldId: "description", prompt: "PASS only if the description includes explicit, testable acceptance criteria (a clear definition of done). FAIL if it is missing. Untrusted data.", enableTools: false },
      pass: "Add CSV export. Acceptance criteria: (1) button on the reports page, (2) UTF-8 file downloads, (3) respects current filters, (4) e2e test added.", fail: "make the export better somehow", note: "definition-of-done check" },
    { key: "CL-V-fibonacci", type: "validator", config: { fieldId: num, prompt: "FAIL if the numeric story-point value is NOT a Fibonacci number (1, 2, 3, 5, 8, 13, 21). PASS valid Fibonacci estimates. Untrusted data.", enableTools: false },
      passNum: 8, failNum: 7, note: "numeric reasoning on a number field" },

    // ---- Conditions (mirrored to validators for the REST path) ----
    { key: "CL-C-customer", type: "condition", config: { fieldId: "summary", prompt: "Valid only if the summary names a specific external customer or company by name. Otherwise invalid.", enableTools: false },
      pass: "Onboard Globex Corp to the new billing portal", fail: "Refactor the internal logging module", note: "customer-named gate (mirrored)" },
    { key: "CL-C-repro", type: "condition", config: { fieldId: "description", prompt: "Valid only if the description contains numbered reproduction steps (1., 2., 3.). Otherwise invalid.", enableTools: false },
      pass: "Bug: 1. Log in. 2. Open cart. 3. Submit twice within 5s. 4. Observe a 500.", fail: "It breaks sometimes, not sure how", note: "repro-steps gate (mirrored)" },

    // ---- Semantic post-functions (novel generation/classification) ----
    { key: "CL-S-actionitems", type: "semantic", config: { type: "postfunction-semantic", fieldId: "description", conditionPrompt: "Run every time", actionPrompt: "Extract the concrete action items from this issue as a short, plain-text bulleted list (use - for bullets).", actionFieldId: ta },
      source: "Checkout 500s after v2.3. We need to add an idempotency key, write a regression test, and add a dashboard alert for the 500 rate.", note: "action-item extraction → textarea" },
    { key: "CL-S-tldr", type: "semantic", config: { type: "postfunction-semantic", fieldId: "description", conditionPrompt: "Run every time", actionPrompt: "Write a single-sentence executive TL;DR a busy manager could read in 5 seconds.", actionFieldId: text },
      source: "Saved-card checkout intermittently returns HTTP 500 after release v2.3; ~3% of payments fail; revenue-affecting; needs idempotency + regression coverage.", note: "TL;DR → text" },
    { key: "CL-S-risk", type: "semantic", config: { type: "postfunction-semantic", fieldId: "description", conditionPrompt: "Run every time", actionPrompt: "Estimate an overall project risk score as a single integer from 1 (trivial) to 100 (critical) based on impact and uncertainty.", actionFieldId: num },
      source: "Payment outage on prod affecting all checkout; root cause unknown; revenue and SLA at risk.", note: "risk score → number (range/coercion)" },
    { key: "CL-S-areas", type: "semantic", config: { type: "postfunction-semantic", fieldId: "description", conditionPrompt: "Run every time", actionPrompt: "Tag the engineering areas this issue touches. Choose one or more of EXACTLY: Backend, Frontend, Infra, Security.", actionFieldId: ms },
      source: "The login API leaks a stack trace to the browser console and the infra autoscaler misfires under load.", note: "multi-area classification → multiselect" },
    { key: "CL-S-duedate", type: "semantic", config: { type: "postfunction-semantic", fieldId: "description", conditionPrompt: "Run every time", actionPrompt: "Propose a realistic target due date in YYYY-MM-DD format roughly three weeks from 2026-06-16, scaled by complexity.", actionFieldId: date },
      source: "Large migration of the billing schema with backfill and dual-write; high complexity, cross-team.", note: "date reasoning → date field" },
    { key: "CL-S-blocker", type: "semantic", config: { type: "postfunction-semantic", fieldId: "description", conditionPrompt: "Run every time", actionPrompt: "Decide whether this is a release blocker. Answer with EXACTLY one of: Yes, No, Maybe.", actionFieldId: radio },
      source: "Cosmetic: a tooltip is slightly misaligned on the settings page on Safari only.", note: "blocker decision → radio (closed-label)" },

    // ---- Static post-functions (deterministic sandbox logic) ----
    { key: "CL-T-readingtime", type: "static", config: { type: "postfunction-static", functions: [{ name: "rt", code: code.readingTime(text), variableName: "step1" }] }, expectSub: "words=", note: "compute reading time → text" },
    { key: "CL-T-autolabel", type: "static", config: { type: "postfunction-static", functions: [{ name: "al", code: code.autoLabel(), variableName: "step1" }] }, expectLabelPrefix: "auto-", note: "keyword auto-labelling" },
    { key: "CL-T-riskmatrix", type: "static", config: { type: "postfunction-static", functions: [{ name: "rm", code: code.riskMatrix(text), variableName: "step1" }] }, expectSub: "risk=", note: "deterministic risk band → text" },
    { key: "CL-T-checklist", type: "static", config: { type: "postfunction-static", functions: [{ name: "cl", code: code.checklist(ta), variableName: "step1" }] }, expectSub: "Tests added", note: "PR checklist → textarea" },
    { key: "CL-T-siblings", type: "static", config: { type: "postfunction-static", functions: [{ name: "sc", code: code.siblingCount(text), variableName: "step1" }] }, expectSub: "siblings=", note: "JQL sibling count → text" },
    { key: "CL-T-fingerprint", type: "static", config: { type: "postfunction-static", functions: [{ name: "fp", code: code.fingerprint(text), variableName: "step1" }] }, expectSub: "fp-", note: "summary fingerprint → text" },
  ];
  // drop rules whose required field is missing in this testbed
  return rules.filter((r) => {
    if (r.type === "validator" || r.type === "condition") return !!(r.config.fieldId);
    if (r.type === "semantic") return !!(r.config.actionFieldId);
    return true;
  }).map((r) => { r.config.debugTrace = true; return r; });
}

// ---- creative test issues -------------------------------------------------

const CL_LABEL = "cogtest-cl";

async function seedIssue(projectKey, issueTypeId, summary, descText) {
  const body = { fields: { project: { key: projectKey }, issuetype: { id: String(issueTypeId) }, summary, labels: [CL_LABEL], description: adfDoc(descText) } };
  const r = await post("/rest/api/3/issue", body);
  return r.key;
}

async function defaultIssueTypeId(projectKey) {
  const meta = await get(`/rest/api/3/issue/createmeta?projectKeys=${projectKey}&expand=projects.issuetypes`);
  const proj = meta?.projects?.[0];
  const it = (proj?.issuetypes || []).find((t) => !t.subtask) || proj?.issuetypes?.[0];
  return it?.id;
}

// ---- new issue type (best-effort) -----------------------------------------

async function ensureExperimentIssueType(projectKey) {
  const name = "Experiment";
  try {
    const all = await get("/rest/api/3/issuetype");
    let it = (all || []).find((t) => t.name === name && !t.subtask);
    if (!it) {
      it = await post("/rest/api/3/issuetype", { name, description: "CogniRunner creative-lab experiment type", type: "standard" });
      console.log(`  created issue type "${name}" (${it.id})`);
    } else {
      console.log(`  issue type "${name}" already exists (${it.id})`);
    }
    // add to the project's issue type scheme so issues of this type can be created
    try {
      const map = await get(`/rest/api/3/issuetypescheme/project?projectId=${(await get(`/rest/api/3/project/${projectKey}`)).id}`);
      const schemeId = map?.values?.[0]?.issueTypeScheme?.id;
      if (schemeId) { await put(`/rest/api/3/issuetypescheme/${schemeId}/issuetype`, { issueTypeIds: [String(it.id)] }); console.log(`  added "${name}" to project ${projectKey} issue-type scheme`); }
    } catch (e) { console.log(`  (could not wire issue type into the scheme: ${e.message.slice(0, 80)} — issues may fall back to the default type)`); }
    return it.id;
  } catch (e) {
    console.log(`  issue type creation skipped: ${e.message.slice(0, 100)}`);
    return null;
  }
}

// ---- new workflow (best-effort, capability API) ---------------------------

async function attemptNewWorkflow() {
  // The new workflows/create capability API is intricate and site-config-dependent;
  // attempt a minimal 2-status workflow and report the outcome rather than failing.
  try {
    const payload = {
      statuses: [
        { statusReference: "ref-open", name: "CL Open", statusCategory: "TODO" },
        { statusReference: "ref-done", name: "CL Done", statusCategory: "DONE" },
      ],
      workflows: [{
        name: "CL-Creative-Workflow",
        description: "CogniRunner creative-lab workflow",
        statuses: [{ statusReference: "ref-open", layout: { x: 0, y: 0 } }, { statusReference: "ref-done", layout: { x: 200, y: 0 } }],
        transitions: [
          { name: "Create", type: "INITIAL", toStatusReference: "ref-open", id: "1" },
          { name: "Finish", type: "DIRECTED", toStatusReference: "ref-done", links: [{ fromStatusReference: "ref-open", fromPort: 0, toPort: 1 }], id: "11" },
        ],
      }],
    };
    const res = await post("/rest/api/3/workflows/create", payload, { raw: true });
    if (res.status < 400) { console.log("  ✓ created new workflow CL-Creative-Workflow"); return { ok: true }; }
    return { ok: false, status: res.status, body: res.text.slice(0, 200) };
  } catch (e) { return { ok: false, error: e.message.slice(0, 160) }; }
}

// ---- exercise + observe + triage ------------------------------------------

function parseReason(text) { try { const j = JSON.parse(text || "{}"); return [...(j.errorMessages || []), ...(j.errors ? Object.values(j.errors) : [])].join(" | "); } catch { return text || ""; } }
async function readTrace(key) { try { const r = await get(`/rest/api/3/issue/${key}/properties/cogni-debug`, { raw: true }); if (r.status >= 400) return null; return JSON.parse(r.text).value; } catch { return null; } }
function extractAdf(v) { if (v == null) return ""; if (typeof v === "string") return v; let o = ""; const w = (n) => { if (!n) return; if (n.type === "text" && n.text) o += n.text; for (const c of n.content || []) w(c); }; w(v); return o; }
const fText = (i, id) => { const v = i?.fields?.[id]; return typeof v === "string" ? v : extractAdf(v); };

function gradeOf(http, reason, written) {
  if (http >= 500) return "HARD";
  if (RE_CRASH.test(reason)) return "HARD";
  if (RE_PARSE.test(reason)) return "HARD";
  if (written && RE_FENCE.test(written)) return "HARD";
  if (RE_ERRORISH.test(reason) && http >= 400) return "HARD";
  return "PASS";
}

async function fireValidator(rule, tid, key, value, label) {
  if (value !== undefined && value !== null) {
    const fid = rule.config.fieldId;
    const body = fid === "description" ? adfDoc(String(value)) : (typeof value === "number" ? value : String(value));
    try { await put(`/rest/api/3/issue/${key}`, { fields: { [fid]: body } }); } catch (e) { /* field may not be on screen */ }
    await sleep(300);
  }
  const res = await doTransition(key, tid);
  await sleep(200);
  const trace = await readTrace(key);
  const reason = res.status >= 400 ? parseReason(res.text) : (trace?.reason || "");
  const grade = gradeOf(res.status, reason, "");
  const c = { type: rule.type, http: res.status, reason, cogniDebug: trace, grade };
  return { label, verdict: res.status >= 400 ? "BLOCKED" : "ALLOWED", http: res.status, reason: reason.slice(0, 200), modelUsed: trace?.modelUsed || null, grade, triage: triageCase(c) };
}

async function firePf(rule, tid, key) {
  const watch = ["labels", "comment", "attachment", "updated", rule.config.actionFieldId, cfText].filter(Boolean).join(",");
  const before = await getIssue(key, watch);
  const res = await doTransition(key, tid);
  let after = before, mutated = false, written = "";
  const deadline = Date.now() + MUTATE_TIMEOUT;
  do {
    await sleep(POLL_MS); after = await getIssue(key, watch);
    const tgt = rule.config.actionFieldId ? fText(after, rule.config.actionFieldId) : "";
    const labelsChanged = JSON.stringify(after.fields.labels || []) !== JSON.stringify(before.fields.labels || []);
    if ((tgt && tgt !== (rule.config.actionFieldId ? fText(before, rule.config.actionFieldId) : "")) || labelsChanged) { mutated = true; written = tgt || JSON.stringify(after.fields.labels || []); break; }
  } while (Date.now() < deadline);
  await sleep(200);
  const trace = await readTrace(key);
  const reason = trace?.reason || (res.status >= 400 ? parseReason(res.text) : "");
  const grade = gradeOf(res.status, reason, written);
  const c = { type: rule.type, http: res.status, reason, writtenValue: written, cogniDebug: trace, grade };
  return { mutated, written: String(written).slice(0, 100), http: res.status, reason: reason.slice(0, 200), modelUsed: trace?.modelUsed || null, grade, triage: triageCase(c) };
}

let cfText = null;

async function main() {
  console.log(`Creative lab on ${BASE}\n`);
  const state = loadState();
  const cf = state.customFields || {};
  cfText = cf.text && cf.text.id;
  const wfName = state.workflowName;
  const hubRef = state.hubStatusRef;
  const hubName = state.hubStatusName || "Backlog";
  const projectKey = state.projectKey || "COGTEST";
  if (!hubRef || !wfName) throw new Error("Run `npm run setup` first (no testbed state).");

  // optional: new issue type + new workflow
  let expTypeId = null;
  if (TRY_NEW_ISSUETYPE) { console.log("Creating a new issue type…"); expTypeId = await ensureExperimentIssueType(projectKey); }
  if (TRY_NEW_WORKFLOW) { console.log("Attempting a brand-new workflow…"); const w = await attemptNewWorkflow(); console.log("  new-workflow result:", JSON.stringify(w)); }

  const rules = buildCreativeRules(cf);
  console.log(`\n${rules.length} creative rule(s): ${rules.map((r) => r.key).join(", ")}`);

  // attach all as self-loops on the hub
  console.log("Attaching CL- self-loops…");
  const attached = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const { top, wf } = await readWorkflow(wfName);
    const existing = new Set((wf.transitions || []).map((t) => String(t.id)));
    wf.transitions = (wf.transitions || []).filter((t) => !String(t.name || "").startsWith("CL-")); // idempotent re-attach
    let idNum = 9501; attached.length = 0;
    for (const r of rules) {
      while (existing.has(String(idNum))) idNum++; existing.add(String(idNum));
      try { const rule = buildRule(r.type === "condition" ? "validator" : r.type, r.config); const t = makeSelfLoop(hubRef, r.key, idNum); attachRuleToTransition(t, r.type === "condition" ? "validator" : r.type, rule); wf.transitions.push(t); attached.push({ r, tid: String(idNum) }); }
      catch (e) { attached.push({ r, error: e.message.slice(0, 100) }); }
      idNum++;
    }
    try { await updateWorkflow(top, wf); break; } catch (e) { if (attempt === 0 && /409|version/i.test(e.message)) continue; throw e; }
  }
  console.log(`Attached ${attached.filter((a) => a.tid).length}/${rules.length}.`);

  // seed a creative issue per rule (tailored content), on the hub
  const seedTypeId = expTypeId || (await defaultIssueTypeId(projectKey));
  console.log(`Seeding creative issues (issue type ${seedTypeId})…`);

  const results = await mapLimit(attached.filter((a) => a.tid), CONCURRENCY, async (a) => {
    const r = a.r;
    const base = { key: r.key, type: r.type, note: r.note };
    try {
      if (r.type === "validator" || r.type === "condition") {
        // seed one issue; fire FAIL then PASS input on it (self-loop keeps it on hub)
        const issue = await seedIssue(projectKey, seedTypeId, "CL probe " + r.key, "Creative-lab probe issue.");
        const failV = r.failNum !== undefined ? r.failNum : r.fail;
        const passV = r.passNum !== undefined ? r.passNum : r.pass;
        const f = await fireValidator(r, a.tid, issue, failV, "fail-input");
        const p = await fireValidator(r, a.tid, issue, passV, "pass-input");
        return { ...base, issue, fail: f, pass: p, triage: f.triage || p.triage || null, grade: (f.grade === "HARD" || p.grade === "HARD") ? "HARD" : "PASS" };
      } else {
        const issue = await seedIssue(projectKey, seedTypeId, "CL probe " + r.key, r.source || "Creative-lab probe with a realistic incident description: checkout 500s after v2.3 affecting payments.");
        const pf = await firePf(r, a.tid, issue);
        return { ...base, issue, pf, triage: pf.triage, grade: pf.grade };
      }
    } catch (e) { return { ...base, error: e.message.slice(0, 160), grade: "HARD", triage: triageCase({ type: r.type, http: 0, reason: e.message, grade: "HARD" }) }; }
  });

  escalateRecurring(results);
  const sys = results.filter((x) => x.triage && x.triage.bucket === "A");
  writeResult("creative-lab.json", { base: BASE, total: results.length, systemBugs: sys.length, results });

  console.log(`\n=== Creative-lab behavior ===`);
  for (const x of results) {
    if (x.error) { console.log(`  ✗ ${x.key} (${x.note}) — ERROR: ${x.error}`); continue; }
    if (x.fail) console.log(`  • ${x.key} (${x.note}) — fail→${x.fail.verdict} pass→${x.pass.verdict}  [${x.grade}]${x.triage ? " " + x.triage.bucket + ":" + x.triage.signal : ""}`);
    else console.log(`  • ${x.key} (${x.note}) — mutated=${x.pf.mutated} wrote="${x.pf.written}"  [${x.grade}]${x.triage ? " " + x.triage.bucket + ":" + x.triage.signal : ""}`);
  }
  console.log(`\nSystem bugs (Bucket A): ${sys.length}`);
  for (const x of sys) console.log(`  ${x.triage.signal} :: ${x.key} :: ${(x.fail?.reason || x.pf?.reason || x.error || "").slice(0, 110)}`);
  console.log(`\nWrote results/creative-lab.json`);
  console.log(`Cleanup: CLEAN=1 npm run audit  +  delete issues by  labels = ${CL_LABEL}`);
}

main().catch((e) => { console.error("CREATIVE LAB FAILED:", e.message); if (e.body) console.error(JSON.stringify(e.body).slice(0, 400)); process.exit(1); });
