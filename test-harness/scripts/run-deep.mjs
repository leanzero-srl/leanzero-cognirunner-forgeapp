/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Deepened, GRADED runner for the canonical suite. Same case grid as
// run-transitions.mjs, but every case is scored PASS/SOFT/HARD (lib/grade.mjs)
// and triaged system-vs-model (lib/triage.mjs) using the cogni-debug trace read
// for EVERY case (not just tool/doc rules) and the full untruncated reason. Built
// for the weak-LM-Studio forcing-function loop: SOFT-FAIL absorbs model roughness,
// HARD-FAIL + Bucket A is the to-fix worklist. legacyCorrect preserves the
// 766–770/782 baseline.
//
// Incremental + resumable: each case is appended to results/deep-run.jsonl.
//   node scripts/run-deep.mjs                  full fresh run
//   node scripts/run-deep.mjs --resume         skip already-recorded cases
//   node scripts/run-deep.mjs --study=semantic re-run one study (e.g. after a fix)
//   node scripts/run-deep.mjs --rules=S2-select,V-pii   re-run specific rules
//   DEEP_CONCURRENCY=6  RUN_MAX_PER_CLASS=3 (cap), SMOKE=1 (one case/rule)

import { get, getIssue, getTransitions, doTransition, mapLimit, sleep } from "../lib/jira.mjs";
import { buildRules } from "../fixtures/rules.mjs";
import { loadState, RESULTS_DIR, ensureResults } from "../lib/state.mjs";
import { gradeValidator, gradeSemantic, gradeStatic } from "../lib/grade.mjs";
import { triageCase, escalateRecurring } from "../lib/triage.mjs";
import { readFileSync, existsSync, appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CONCURRENCY = parseInt(process.env.DEEP_CONCURRENCY || "4", 10);
const MAX_PER_CLASS = parseInt(process.env.RUN_MAX_PER_CLASS || "0", 10);
const POLL_MS = 3000;
const MUTATE_TIMEOUT = parseInt(process.env.DEEP_MUTATE_TIMEOUT || "60000", 10);
const SKIP_WAIT = 18000;
const JSONL = join(RESULTS_DIR, "deep-run.jsonl");

const argv = process.argv.slice(2);
const arg = (name) => { const a = argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.split("=")[1] : null; };
const RESUME = argv.includes("--resume");
const FORCE = argv.includes("--force");
const FILTER_RULES = (arg("rules") || "").split(",").map((s) => s.trim()).filter(Boolean);
const FILTER_STUDY = arg("study");
const FILTERED = FILTER_RULES.length > 0 || !!FILTER_STUDY;

function parseReason(text) {
  try {
    const j = JSON.parse(text || "{}");
    const msgs = j.errorMessages || [];
    const errs = j.errors ? Object.values(j.errors) : [];
    return [...msgs, ...errs].join(" | ");
  } catch { return text || ""; }
}
function extractAdfText(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  let out = "";
  const walk = (n) => { if (!n) return; if (n.type === "text" && n.text) out += n.text; for (const c of n.content || []) walk(c); };
  walk(v);
  return out;
}
function extractWritten(after, fieldId) {
  const v = after?.fields?.[fieldId];
  if (v == null) return {};
  if (typeof v === "number") return { writtenNumber: v, writtenValue: v };
  if (typeof v === "string") return { writtenText: v, writtenValue: v };
  if (Array.isArray(v)) { const names = v.map((o) => o?.value || o?.name).filter(Boolean); return { writtenName: names[0], writtenValue: names.join(",") }; }
  if (v.value || v.name) return { writtenName: v.value || v.name, writtenValue: v.value || v.name };
  const txt = extractAdfText(v);
  return { writtenText: txt, writtenValue: txt };
}
function pfFields(state) {
  const ids = Object.values(state.customFields).map((f) => f.id);
  return ["labels", "updated", "comment", "subtasks", "issuelinks", "attachment", ...ids].join(",");
}
async function readTrace(key) {
  try {
    const r = await get(`/rest/api/3/issue/${key}/properties/cogni-debug`, { raw: true });
    if (r.status >= 400) return null;
    return JSON.parse(r.text).value;
  } catch { return null; }
}

// ---- per-case observe + grade + triage ------------------------------------

async function deepValidator(rule, tid, issue) {
  const res = await doTransition(issue.key, tid);
  const actual = res.status >= 400 ? "BLOCKED" : "ALLOWED";
  const expected = rule.expect(issue);
  const reason = res.status >= 400 ? parseReason(res.text) : "";
  await sleep(250);
  const trace = await readTrace(issue.key);
  const obs = { actual, expected, reason: reason || trace?.reason || "", fieldValue: trace?.fieldValue || "", cogniDebug: trace };
  const g = gradeValidator(rule, obs);
  const t = triageCase({ type: "validator", http: res.status, reason: obs.reason, cogniDebug: trace, grade: g.grade, gradeAxes: { reasonAxis: g.axes.reason, ...(g.axes.tool ? { toolAxis: g.axes.tool } : {}) } });
  return { kind: "validator", http: res.status, actual, expected, reason: obs.reason.slice(0, 400), grade: g.grade, axes: g.axes, legacyCorrect: g.legacyCorrect, modelUsed: trace?.modelUsed || null, toolMeta: trace?.toolMeta || null, triage: t };
}

async function deepCondition(rule, tid, issue) {
  const tr = await getTransitions(issue.key);
  const visible = (tr.transitions || []).some((t) => String(t.id) === String(tid));
  const actual = visible ? "VISIBLE" : "HIDDEN";
  const expected = rule.expect(issue);
  const correct = actual === expected;
  // F3: conditions are not enforced on the REST path, so a miss here is expected.
  const expectedMiss = correct ? null : { fId: "F3", note: "conditions are not enforced on the REST transition path (platform behavior)" };
  const grade = correct ? "PASS" : "HARD";
  const t = triageCase({ type: "condition", http: 200, reason: "", grade, expectedMiss });
  return { kind: "condition", http: 200, actual, expected, reason: "", grade, legacyCorrect: correct, triage: t };
}

async function deepPf(rule, tid, issue, state, fields) {
  const before = await getIssue(issue.key, fields);
  const res = await doTransition(issue.key, tid);
  let after = before, a = { pass: false, detail: "" };
  if (rule.expectPf === "MUTATED") {
    const deadline = Date.now() + MUTATE_TIMEOUT;
    do { await sleep(POLL_MS); after = await getIssue(issue.key, fields); a = rule.assert(state, before, after); if (a.pass) break; } while (Date.now() < deadline);
  } else {
    await sleep(SKIP_WAIT); after = await getIssue(issue.key, fields); a = rule.assert(state, before, after);
  }
  const trace = await readTrace(issue.key);

  let g;
  if (rule.type === "static") {
    const fieldId = rule.targetField;
    const w = fieldId ? extractWritten(after, fieldId) : {};
    g = gradeStatic(rule, { writtenValue: w.writtenValue, legacyPass: a.pass });
  } else {
    const fieldId = rule.config?.actionFieldId;
    const w = fieldId ? extractWritten(after, fieldId) : {};
    g = gradeSemantic(rule, {
      mutated: a.pass || (w.writtenValue != null && w.writtenValue !== ""),
      writtenName: w.writtenName, writtenText: w.writtenText, writtenNumber: w.writtenNumber,
      sourceText: "", legacyPass: a.pass,
    });
  }
  const writtenStr = g && (rule.type === "static" ? (rule.targetField ? JSON.stringify(extractWritten(after, rule.targetField).writtenValue) : "") : (rule.config?.actionFieldId ? JSON.stringify(extractWritten(after, rule.config.actionFieldId).writtenValue) : ""));
  const t = triageCase({ type: rule.type, http: res.status, reason: a.detail, writtenValue: writtenStr, cogniDebug: trace, grade: g.grade, gradeAxes: { schemaViolation: g.schemaViolation, valueAxis: g.axes.value } });
  return { kind: "pf", http: res.status, expected: rule.expectPf, reason: (a.detail || "").slice(0, 300), grade: g.grade, axes: g.axes, schemaViolation: g.schemaViolation, legacyCorrect: g.legacyCorrect, modelUsed: trace?.modelUsed || null, triage: t };
}

async function deepCase(c, state, fields) {
  const base = { caseId: `${c.rule.key}__${c.issueId}`, ruleKey: c.rule.key, ruleName: c.rule.name, type: c.rule.type, study: c.rule.study, issueId: c.issueId, issueKey: c.issue.key, cls: c.issue.cls, at: Date.now() };
  try {
    let r;
    if (c.rule.type === "validator") r = await deepValidator(c.rule, c.tid, c.issue);
    else if (c.rule.type === "condition") r = await deepCondition(c.rule, c.tid, c.issue);
    else r = await deepPf(c.rule, c.tid, c.issue, state, fields);
    return { ...base, ...r };
  } catch (e) {
    const t = triageCase({ type: c.rule.type, http: 0, reason: e.message, grade: "HARD" });
    return { ...base, kind: "error", grade: "HARD", legacyCorrect: false, error: e.message.slice(0, 200), triage: t };
  }
}

async function twoPhaseGate(rule, tid, state) {
  const story = state.issues?.["GATE-STORY"]; const bug4 = state.issues?.["GATE-BUG-4"];
  if (!story) return [];
  const out = [];
  if (bug4) { const tr0 = await getTransitions(bug4.key); const reopen = (tr0.transitions || []).find((t) => /backlog|to do|open|in progress/i.test(t.name)); if (reopen) { await doTransition(bug4.key, reopen.id); await sleep(4000); } }
  const p1 = await doTransition(story.key, tid);
  await sleep(250); const tr1 = await readTrace(story.key);
  out.push({ caseId: `${rule.key}__GATE-STORY__open`, ruleKey: rule.key, ruleName: rule.name, type: "validator", study: "agentic", issueId: "GATE-STORY", issueKey: story.key, cls: "agentic-gate", kind: "validator", phase: "open-bug", expected: "BLOCKED", actual: p1.status >= 400 ? "BLOCKED" : "ALLOWED", http: p1.status, reason: p1.status >= 400 ? parseReason(p1.text).slice(0, 300) : "", grade: p1.status >= 400 ? "PASS" : "HARD", legacyCorrect: p1.status >= 400, toolMeta: tr1?.toolMeta || null, at: Date.now(), triage: triageCase({ type: "validator", http: p1.status, reason: p1.status >= 400 ? parseReason(p1.text) : "", cogniDebug: tr1, grade: p1.status >= 400 ? "PASS" : "HARD" }) });
  if (bug4) {
    const tr = await getTransitions(bug4.key); const done = (tr.transitions || []).find((t) => /done/i.test(t.name)); if (done) await doTransition(bug4.key, done.id); await sleep(4000);
    const p2 = await doTransition(story.key, tid); await sleep(250); const tr2 = await readTrace(story.key);
    out.push({ caseId: `${rule.key}__GATE-STORY__closed`, ruleKey: rule.key, ruleName: rule.name, type: "validator", study: "agentic", issueId: "GATE-STORY", issueKey: story.key, cls: "agentic-gate", kind: "validator", phase: "bug-closed", expected: "ALLOWED", actual: p2.status >= 400 ? "BLOCKED" : "ALLOWED", http: p2.status, reason: p2.status >= 400 ? parseReason(p2.text).slice(0, 300) : "", grade: p2.status < 400 ? "PASS" : "HARD", legacyCorrect: p2.status < 400, toolMeta: tr2?.toolMeta || null, at: Date.now(), triage: triageCase({ type: "validator", http: p2.status, reason: p2.status >= 400 ? parseReason(p2.text) : "", cogniDebug: tr2, grade: p2.status < 400 ? "PASS" : "HARD" }) });
  }
  return out;
}

function loadDone() {
  if (!existsSync(JSONL)) return new Set();
  const done = new Set();
  for (const line of readFileSync(JSONL, "utf8").split("\n")) { if (!line.trim()) continue; try { const o = JSON.parse(line); if (o.caseId) done.add(o.caseId); } catch {} }
  return done;
}

async function main() {
  ensureResults();
  const state = loadState();
  if (!state.ruleTransitions || !state.issues) throw new Error("Run attach-rules + seed-issues first.");
  const rules = buildRules(state).filter((r) => {
    if (FILTER_RULES.length && !FILTER_RULES.includes(r.key)) return false;
    if (FILTER_STUDY && r.study !== FILTER_STUDY) return false;
    return true;
  });
  const fields = pfFields(state);

  // Fresh run (no resume, no filter) truncates the jsonl; resume/filter append.
  if (!RESUME && !FILTERED) writeFileSync(JSONL, "");
  const done = (RESUME && !FILTERED) ? loadDone() : new Set();

  const byCls = {};
  for (const [id, info] of Object.entries(state.issues)) (byCls[info.cls] ||= []).push({ id, key: info.key, cls: info.cls });

  const cases = [];
  for (const rule of rules) {
    const tinfo = state.ruleTransitions[rule.key];
    if (!tinfo) { console.log(`  no transition for ${rule.key}, skipping`); continue; }
    if (rule.twoPhaseGate) continue;
    for (const cls of rule.appliesTo || []) {
      let pool = byCls[cls] || [];
      if (MAX_PER_CLASS > 0) pool = pool.slice(0, MAX_PER_CLASS);
      for (const issue of pool) {
        const caseId = `${rule.key}__${issue.id}`;
        if (done.has(caseId) && !FORCE) continue;
        cases.push({ rule, tid: tinfo.transitionId, issueId: issue.id, issue });
      }
    }
  }
  let runCases = cases;
  if (process.env.SMOKE === "1") { const seen = new Set(); runCases = cases.filter((c) => (seen.has(c.rule.key) ? false : seen.add(c.rule.key))); }
  console.log(`Deep run: ${runCases.length} case(s) across ${rules.length} rule(s) @ concurrency ${CONCURRENCY}${RESUME ? " (resume)" : ""}${FILTERED ? " (filtered)" : ""}.`);

  const results = [];
  let nDone = 0;
  await mapLimit(runCases, CONCURRENCY, async (c) => {
    const r = await deepCase(c, state, fields);
    appendFileSync(JSONL, JSON.stringify(r) + "\n");
    results.push(r);
    nDone++;
    if (process.env.SMOKE === "1" || nDone % 15 === 0 || nDone === runCases.length) {
      const tg = r.triage ? ` [${r.triage.bucket}:${r.triage.signal}]` : "";
      console.log(`  ${nDone}/${runCases.length} ${r.ruleKey} ${r.issueId}: ${r.grade}${tg}${r.reason ? " :: " + r.reason.slice(0, 70) : ""}`);
    }
    return r;
  });

  const gateRule = rules.find((r) => r.twoPhaseGate);
  if (gateRule && state.ruleTransitions[gateRule.key]) {
    console.log("Running two-phase agentic gate...");
    const g = await twoPhaseGate(gateRule, state.ruleTransitions[gateRule.key].transitionId, state);
    for (const r of g) { appendFileSync(JSONL, JSON.stringify(r) + "\n"); results.push(r); }
  }

  const promoted = escalateRecurring(results);
  if (promoted) console.log(`Escalated ${promoted} recurring parse-flavored case(s) to Bucket A.`);

  // Summary
  const byStudy = {};
  const buckets = { A: 0, B: 0, C: 0 };
  let legacy = 0;
  for (const r of results) {
    const s = (byStudy[r.study] ||= { pass: 0, soft: 0, hard: 0, total: 0 });
    s.total++;
    if (r.grade === "PASS") s.pass++; else if (r.grade === "SOFT") s.soft++; else s.hard++;
    if (r.legacyCorrect) legacy++;
    if (r.triage) buckets[r.triage.bucket] = (buckets[r.triage.bucket] || 0) + 1;
  }
  console.log(`\n=== Summary by study (PASS / SOFT / HARD) ===`);
  for (const [study, s] of Object.entries(byStudy)) console.log(`  ${study.padEnd(12)} ${s.pass}/${s.soft}/${s.hard}  (n=${s.total})`);
  console.log(`\nlegacyCorrect (old binary baseline): ${legacy}/${results.length}`);
  console.log(`Triage: A(system)=${buckets.A}  B(model)=${buckets.B}  C(expected)=${buckets.C}`);
  const sys = results.filter((r) => r.triage?.bucket === "A");
  if (sys.length) {
    const bySig = {};
    for (const r of sys) (bySig[r.triage.signal] ||= []).push(r);
    console.log(`\n=== System-bug worklist (Bucket A → src/index.js) ===`);
    for (const [sig, rs] of Object.entries(bySig)) {
      console.log(`  ${rs.length}× ${sig} → ${rs[0].triage.hardeningTarget || "(forge logs)"}`);
      console.log(`      e.g. ${rs[0].ruleKey} ${rs[0].issueId || ""}: ${(rs[0].reason || rs[0].error || "").slice(0, 110)}`);
    }
  }
  console.log(`\nAppended ${results.length} case(s) to results/deep-run.jsonl`);
}

main().catch((e) => { console.error("DEEP RUN FAILED:", e.message); if (e.body) console.error(JSON.stringify(e.body).slice(0, 400)); process.exit(1); });
