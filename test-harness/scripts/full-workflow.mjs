/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// REALISTIC FULL-WORKFLOW rule set: ~2 of every premade rule type (with parameter
// variations) + recipe post-functions, named like a real software-delivery
// workflow, attached to COGTEST and LEFT IN PLACE (not deleted) so they can be
// inspected in the Jira workflow editor and their execution logs reviewed.
//
// It then FIRES the validators (pass + block issues) and the post-functions to
// generate real execution logs, and CONSTANTLY polls forge logs — reporting what
// fired, what blocked, what each rule logged, and any anomalies.
//
// Conditions are attached + visible but NOT exercised: Jira evaluates app
// conditions only in the UI, never on the REST transition path (confirmed — the
// function isn't even invoked), so they produce no REST-side execution logs.
//
//   node test-harness/scripts/full-workflow.mjs            # attach + fire + monitor (keeps rules)
//   node test-harness/scripts/full-workflow.mjs --attach-only   # just (re)attach, no firing
//
// Re-runnable: removes prior WF- transitions first so it doesn't duplicate, but
// leaves the freshly-attached set in place when it finishes.

import { post, doTransition, getTransitions } from "../lib/jira.mjs";
import { attachSelfLoopRules, readWorkflow, updateWorkflow } from "../lib/workflow.mjs";
import { loadState, writeResult } from "../lib/state.mjs";
import { pollForgeLogs, scanForSignals } from "../lib/forge-logs.mjs";

const s = loadState();
const CF = s.customFields;
const TYPE = { task: "10005", subtask: "10016", bug: "10007", story: "10013" };
const ATTACH_ONLY = process.argv.includes("--attach-only");
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const pm = (ruleType, extra = {}) => ({ ruleKind: "premade", ruleType, ...extra });
const F = { text: CF.text.id, num: CF.number.id, date: CF.date.id, sel: CF.select.id, user: CF.user.id };

// =========================================================== the realistic rule set
// Each: { name (realistic), kind, config }. Validators carry a `probe` {pass, block}
// describing how to make an issue pass/block (used to generate execution logs).
export function ruleSet() {
  const V = [
    // field-required ×2
    { name: "WF-Gate: Summary is required", config: pm("field-required", { fieldId: "summary", fieldName: "Summary" }), probe: { passSummary: "has a summary", blockField: null } },
    { name: "WF-Gate: Details field is required", config: pm("field-required", { fieldId: F.text, fieldName: "Details" }), probe: { setText: "filled in", blockText: "" } },
    // field-comparison ×2
    { name: "WF-Gate: Story points at least 1", config: pm("field-comparison", { fieldId: F.num, fieldName: "Points", op: "gte", compareValue: "1" }), probe: { setNum: 3, blockNum: 0 } },
    { name: "WF-Gate: Story points at most 13", config: pm("field-comparison", { fieldId: F.num, fieldName: "Points", op: "lte", compareValue: "13" }), probe: { setNum: 8, blockNum: 21 } },
    // field-regex ×2
    { name: "WF-Gate: Summary cites a ticket (OK-NNN)", config: pm("field-regex", { fieldId: "summary", fieldName: "Summary", regex: "^OK-\\d+" }), probe: { passSummary: "OK-123 do the thing", blockSummary: "no ref here" } },
    { name: "WF-Gate: Details look like an email", config: pm("field-regex", { fieldId: F.text, fieldName: "Details", regex: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$" }), probe: { setText: "user@example.com", blockText: "not an email" } },
    // allowed-values ×2
    { name: "WF-Gate: Severity is Low/Medium/High", config: pm("allowed-values", { fieldId: F.sel, fieldName: "Severity", allowedValues: "Low, Medium, High" }), probe: { setSel: "High", blockSel: "Security" } },
    { name: "WF-Gate: Labels from approved set", config: pm("allowed-values", { fieldId: "labels", fieldName: "Labels", allowedValues: "triaged, ready, blocked" }), probe: { setLabels: ["ready"], blockLabels: ["random"] } },
    // text-length ×2
    { name: "WF-Gate: Summary at least 10 chars", config: pm("text-length", { fieldId: "summary", fieldName: "Summary", min: 10 }), probe: { passSummary: "this is long enough", blockSummary: "short" } },
    { name: "WF-Gate: Details at most 80 chars", config: pm("text-length", { fieldId: F.text, fieldName: "Details", max: 80 }), probe: { setText: "concise", blockText: "x".repeat(120) } },
    // date-relative ×2
    { name: "WF-Gate: Due date in the future", config: pm("date-relative", { fieldId: F.date, fieldName: "Due", mode: "future" }), probe: { setDate: inDays(30), blockDate: "2000-01-01" } },
    { name: "WF-Gate: Due date within 30 days", config: pm("date-relative", { fieldId: F.date, fieldName: "Due", mode: "within", days: 30 }), probe: { setDate: inDays(10), blockDate: inDays(120) } },
    // sub-tasks-resolved ×2
    { name: "WF-QA: All sub-tasks resolved", config: pm("sub-tasks-resolved"), probe: { struct: "subtasks" } },
    { name: "WF-QA: Sub-tasks resolved (custom message)", config: pm("sub-tasks-resolved", { errorMessage: "Close every sub-task before you ship this." }), probe: { struct: "subtasks" } },
    // attachment-required ×2
    { name: "WF-QA: Attachment required", config: pm("attachment-required"), probe: { struct: "attachment" } },
    { name: "WF-QA: Evidence attached (custom message)", config: pm("attachment-required", { errorMessage: "Attach test evidence first." }), probe: { struct: "attachment" } },
    // comment-required ×2 (screen-only — exercised via a transition with/without a comment)
    { name: "WF-Gate: Comment required on this move", config: pm("comment-required"), probe: { comment: true } },
    { name: "WF-Gate: Comment required (custom message)", config: pm("comment-required", { errorMessage: "Leave a note explaining this transition." }), probe: { comment: true } },
    // field-cardinality ×2
    { name: "WF-Gate: At least one label", config: pm("field-cardinality", { fieldId: "labels", fieldName: "Labels", min: 1 }), probe: { setLabels: ["x"], blockLabels: [] } },
    { name: "WF-Gate: At most three labels", config: pm("field-cardinality", { fieldId: "labels", fieldName: "Labels", max: 3 }), probe: { setLabels: ["a", "b"], blockLabels: ["a", "b", "c", "d"] } },
  ].map((r) => ({ ...r, kind: "validator" }));

  // Conditions ×2 each (attached + visible; UI-only — no REST logs). Realistic names.
  const C = [
    { name: "WF-Show: when Details present", config: pm("field-has-value", { fieldId: F.text }) },
    { name: "WF-Show: when Severity present", config: pm("field-has-value", { fieldId: F.sel }) },
    { name: "WF-Show: when Details empty", config: pm("field-empty", { fieldId: F.text }) },
    { name: "WF-Show: when no assignee", config: pm("field-empty", { fieldId: "assignee" }) },
    { name: "WF-Show: only High severity", config: pm("field-equals", { fieldId: F.sel, value: "High" }) },
    { name: "WF-Show: only Security severity", config: pm("field-equals", { fieldId: F.sel, value: "Security" }) },
    { name: "WF-Show: only Bugs", config: pm("issue-type-is", { issueTypeName: "Bug" }) },
    { name: "WF-Show: only Stories", config: pm("issue-type-is", { issueTypeName: "Story" }) },
    { name: "WF-Show: when has attachments", config: pm("has-attachments") },
    { name: "WF-Show: when resolved", config: pm("issue-is-resolved") },
    { name: "WF-Show: when all sub-tasks done", config: pm("sub-tasks-all-resolved") },
    { name: "WF-Show: when parent in Backlog", config: pm("parent-status-is", { statusName: "Backlog" }) },
    { name: "WF-Show: when parent Done", config: pm("parent-status-is", { statusName: "Done" }) },
    { name: "WF-Show: when resolution is Done", config: pm("resolution-is", { resolutionName: "Done" }) },
    { name: "WF-Show: when priority Highest", config: pm("priority-is", { priorityName: "Highest" }) },
    { name: "WF-Show: when priority Low", config: pm("priority-is", { priorityName: "Low" }) },
    { name: "WF-Show: when linked issues resolved", config: pm("linked-issue-resolved") },
    { name: "WF-Show: when blocking links resolved", config: pm("linked-issue-resolved", { linkTypeName: "Blocks" }) },
    { name: "WF-Show: only to the assignee", config: pm("current-user-is-assignee") },
    { name: "WF-Show: only to the reporter", config: pm("current-user-is-reporter") },
    { name: "WF-Show: only to the Approver (user field)", config: pm("user-in-field", { fieldId: F.user }) },
    { name: "WF-Show: only to jira-administrators", config: pm("user-in-group", { groupName: "jira-administrators" }) },
  ].map((r) => ({ ...r, kind: "condition" }));

  // Recipe post-functions (no-AI). Use writable on-screen targets only.
  const P = [
    { name: "WF-Auto: stamp Details = processed", kind: "static", recipe: "set_field", params: { target: F.text, value: "processed by workflow", valueShape: "plain" } },
    { name: "WF-Auto: copy Summary into Details", kind: "static", recipe: "copy_field", params: { source: "summary", target: F.text, onlyIfEmpty: "always" } },
    { name: "WF-Auto: append an audit line to Details", kind: "static", recipe: "append_to_text", params: { target: F.text, text: "[audit] moved through WF" } },
    { name: "WF-Auto: add a 'triaged' label", kind: "static", recipe: "add_remove_labels", params: { add: "triaged", remove: "" } },
  ];
  return { V, C, P };
}

async function buildRecipeConfigs(P) {
  const { getRecipeByKey } = await import("../../src/shared/builtin-recipes.js");
  return P.map((p) => {
    const r = getRecipeByKey(p.recipe);
    return { name: p.name, kind: "static", recipe: p.recipe, config: { type: "postfunction-static", functions: [{ name: p.recipe, code: r.build(p.params), variableName: "step1" }], debugTrace: true } };
  });
}

// =========================================================== issue helpers
async function mkIssue(fields) {
  const res = await post("/rest/api/3/issue", { fields: { project: { key: s.projectKey }, issuetype: { id: TYPE.task }, ...fields } });
  return res.key;
}
function cfFields(map) {
  const out = {};
  for (const [role, val] of Object.entries(map)) {
    if (val === undefined) continue;
    if (role === "summary" || role === "labels") { out[role] = val; continue; }
    const f = CF[role]; if (!f) continue;
    if (role === "select") out[f.id] = { value: val };
    else if (role === "number") out[f.id] = val;
    else out[f.id] = val;
  }
  return out;
}
async function transitionToDone(key) {
  const tr = await getTransitions(key);
  const t = (tr.transitions || []).find((x) => x.to?.name === "Done");
  if (t) await doTransition(key, t.id);
}
async function fire(key, transitionName, fields) {
  const tr = await getTransitions(key);
  const t = (tr.transitions || []).find((x) => x.name === transitionName);
  if (!t) return { status: "NA" };
  return doTransition(key, t.id, fields);
}

// =========================================================== forge-log monitor
function logSnapshot(sinceMin, label) {
  const out = pollForgeLogs(["--since", `${sinceMin}m`]);
  const lines = (out && out.lines) ? out.lines : [];
  const premade = lines.filter((l) => /cognirunner:premade/.test(l));
  const pfResults = lines.filter((l) => /Static PF result:/.test(l));
  const signals = scanForSignals(lines) || [];
  console.log(`\n--- forge logs [${label}] : ${lines.length} lines, ${premade.length} premade traces, ${pfResults.length} PF results, ${signals.length} signal(s) ---`);
  // Summarize premade validator traces (block vs allow)
  const blocked = premade.filter((l) => /"blocked":true/.test(l)).length;
  const allowed = premade.filter((l) => /"blocked":false/.test(l)).length;
  if (premade.length) console.log(`   premade: ${allowed} allow, ${blocked} block`);
  if (signals.length) { console.log("   ⚠ SIGNALS:"); for (const sg of signals.slice(0, 8)) console.log("     " + (typeof sg === "string" ? sg : JSON.stringify(sg)).slice(0, 200)); }
  return { lines: lines.length, premade: premade.length, pfResults: pfResults.length, blocked, allowed, signals: signals.length };
}

// =========================================================== main
async function main() {
  if (!s.workflowName) throw new Error("Run setup-testbed.mjs first.");
  const { V, C, P } = ruleSet();
  const recipes = await buildRecipeConfigs(P);
  const allSpecs = [
    ...V.map((r) => ({ name: r.name, type: "validator", config: r.config })),
    ...C.map((r) => ({ name: r.name, type: "condition", config: r.config })),
    ...recipes.map((r) => ({ name: r.name, type: "static", config: r.config })),
  ];
  console.log(`Rule set: ${V.length} validators, ${C.length} conditions, ${recipes.length} post-functions = ${allSpecs.length} rules.`);

  // Idempotent: drop prior WF- transitions, then attach the fresh set (KEPT after run).
  {
    const { top, wf } = await readWorkflow(s.workflowName);
    const before = wf.transitions.length;
    wf.transitions = wf.transitions.filter((t) => !String(t.name || "").startsWith("WF-"));
    if (wf.transitions.length !== before) { await updateWorkflow(top, wf); console.log(`Removed ${before - wf.transitions.length} prior WF- transition(s).`); }
  }
  console.log("Attaching full workflow rule set (kept in place after the run)...");
  const attached = await attachSelfLoopRules(s.workflowName, s.hubStatusRef, allSpecs, 9501);
  console.log(`Attached ${attached.length} rules to "${s.workflowName}" (hub status). Visible in the Jira workflow editor as WF-* transitions.`);

  if (ATTACH_ONLY) { console.log("--attach-only: skipping firing."); writeResult("full-workflow", { at: new Date().toISOString(), attached: attached.length, fired: false }); return; }

  console.log("\nSeeding issues + firing validators to generate execution logs...");
  let fired = 0, asserted = 0, mism = 0;
  const mismatches = [];

  // Fire each validator on a PASS issue and a BLOCK issue.
  for (const r of V) {
    const p = r.probe || {};
    let passKey, blockKey, passFields, blockFields;
    if (p.struct === "subtasks") {
      const pa = await mkIssue({ summary: "WF parent all done" }); const sd = await mkIssue({ issuetype: { id: TYPE.subtask }, parent: { key: pa }, summary: "done sub" }); await transitionToDone(sd); passKey = pa;
      const pm2 = await mkIssue({ summary: "WF parent mixed" }); await mkIssue({ issuetype: { id: TYPE.subtask }, parent: { key: pm2 }, summary: "open sub" }); blockKey = pm2;
    } else if (p.struct === "attachment") {
      passKey = null; blockKey = await mkIssue({ summary: "WF no attachment" }); // pass needs multipart (covered offline) — fire block only
    } else if (p.comment) {
      passKey = null; blockKey = await mkIssue({ summary: "WF no comment on move" }); // no comment supplied → block
    } else {
      // field-based: craft summaries/fields
      const pf = {}, bf = {};
      if (p.passSummary !== undefined) pf.summary = p.passSummary; if (p.blockSummary !== undefined) bf.summary = p.blockSummary;
      if (p.setText !== undefined) pf.text = p.setText; if (p.blockText !== undefined) bf.text = p.blockText;
      if (p.setNum !== undefined) pf.number = p.setNum; if (p.blockNum !== undefined) bf.number = p.blockNum;
      if (p.setSel !== undefined) pf.select = p.setSel; if (p.blockSel !== undefined) bf.select = p.blockSel;
      if (p.setDate !== undefined) pf.date = p.setDate; if (p.blockDate !== undefined) bf.date = p.blockDate;
      if (p.setLabels !== undefined) pf.labels = p.setLabels; if (p.blockLabels !== undefined) bf.labels = p.blockLabels;
      if (!pf.summary) pf.summary = "WF pass " + r.config.ruleType; if (!bf.summary) bf.summary = "WF block " + r.config.ruleType;
      passKey = await mkIssue(cfFields(pf)); blockKey = await mkIssue(cfFields(bf));
    }
    // Fire (pass then block). Some rules (field-required on a field that can't be empty at create) may not block — that's expected & logged.
    for (const [key, expect, fields] of [[passKey, "allow", passFields], [blockKey, "block", blockFields]]) {
      if (!key) continue;
      const res = await fire(key, r.name, fields ? { fields } : undefined);
      if (res.status === "NA") continue;
      fired++;
      const blocked = res.status >= 400;
      const ok = (expect === "block") === blocked;
      if (ok) asserted++; else { mism++; mismatches.push(`${r.name} [${expect}] ${key}: got ${blocked ? "block" : "allow"} (HTTP ${res.status})`); }
    }
  }
  console.log(`Fired ${fired} validator transitions (${asserted} matched expectation, ${mism} mismatched).`);

  // Fire each post-function on a seeded issue.
  console.log("\nFiring post-functions (recipes)...");
  for (const r of recipes) {
    const key = await mkIssue({ summary: "WF pf seed", ...cfFields({ text: "seed" }) });
    const res = await fire(key, r.name);
    if (res.status !== "NA") fired++;
    console.log(`  ${r.name} on ${key}: transition HTTP ${res.status}`);
  }

  // Let async PFs + logs settle, then snapshot forge logs.
  console.log("\nSettling 6s for async post-functions + log propagation...");
  await new Promise((rr) => setTimeout(rr, 6000));
  const snap = logSnapshot(10, "post-run");

  // verdict
  console.log("\n===== FULL WORKFLOW RUN =====");
  console.log(`Rules attached & KEPT: ${attached.length} (validators ${V.length}, conditions ${C.length}, PFs ${recipes.length})`);
  console.log(`Validator transitions fired: ${fired}; enforcement matched: ${asserted}, mismatched: ${mism}`);
  if (mismatches.length) { console.log("Enforcement mismatches (investigate in forge logs):"); for (const m of mismatches) console.log("  - " + m); }
  console.log(`Forge logs: ${snap.premade} premade traces (${snap.allowed} allow / ${snap.blocked} block), ${snap.pfResults} PF results, ${snap.signals} error signal(s).`);
  console.log("Conditions are attached + visible but produce NO REST logs (Jira evaluates app conditions UI-only).");
  writeResult("full-workflow", { at: new Date().toISOString(), attached: attached.length, counts: { V: V.length, C: C.length, P: recipes.length }, fired, asserted, mism, mismatches, snapshot: snap });
  console.log("\nReport -> results/full-workflow. Rules left in place for inspection in the Jira workflow editor + admin panel execution logs.");
}

// Run only when invoked directly (so other scripts can import ruleSet()).
if (process.argv[1] && process.argv[1].endsWith("full-workflow.mjs")) {
  main().catch((e) => { console.error("FULL WORKFLOW FAILED:", e.message); if (e.body) console.error(JSON.stringify(e.body, null, 2)); process.exit(1); });
}
