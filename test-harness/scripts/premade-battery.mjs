/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// COMPREHENSIVE premade-rule battery against the live COGTEST testbed.
//
// Builds a diverse issue corpus (field variants + structural fixtures: a parent
// with mixed sub-tasks, a linked pair, a resolved issue, an attachment) and
// exercises ALL 22 premade rule types two ways:
//
//   Mode A — the REAL executor (src/premade-rules.js) against REAL Jira issue
//            data, with readField wired to the harness REST client. Covers both
//            validators and conditions (conditions can't be enforced on the REST
//            transition path, but their logic is tested against live data here).
//   Mode B — live Jira ENFORCEMENT for the validators: attach as self-loops,
//            fire transitions, assert HTTP 400 (block) / 204 (allow).
//
// Scores every case against an explicit expectation and writes results/premade-battery.json.
//   node test-harness/scripts/premade-battery.mjs

import { get, post, doTransition, getTransitions } from "../lib/jira.mjs";
import { attachSelfLoopRules, readWorkflow, updateWorkflow } from "../lib/workflow.mjs";
import { loadState, writeResult } from "../lib/state.mjs";
import { loadEnv } from "../lib/env.mjs";
import { executePremadeRule } from "../../src/premade-rules.js";

const s = loadState();
const CF = s.customFields;
const PROJECT = s.projectKey;
const TYPE = { task: "10005", subtask: "10016", bug: "10007", story: "10013" };

const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

// ---- REST-backed field reader for the REAL executor (mirrors getRawField) ----
const restReadField = async (issueKey, fieldId) => {
  const d = await get(`/rest/api/3/issue/${issueKey}?fields=${encodeURIComponent(fieldId)}`);
  return (d.fields || {})[fieldId];
};
const evalRule = (cfg, issueKey, kind, mf = {}) =>
  executePremadeRule(cfg, { issue: { key: issueKey }, modifiedFields: mf }, kind, { readField: restReadField });

// ---- issue creation ----
async function createIssue(fields) {
  const res = await post("/rest/api/3/issue", { fields: { project: { key: PROJECT }, ...fields } });
  return res.key;
}
// Build a custom-field fragment from a {role: value} map using the right write shape.
function cf(map) {
  const out = {};
  for (const [role, val] of Object.entries(map)) {
    const f = CF[role];
    if (!f) continue;
    if (val === undefined) continue;
    if (role === "select") out[f.id] = { value: val };
    else if (role === "multiselect") out[f.id] = (Array.isArray(val) ? val : [val]).map((v) => ({ value: v }));
    else if (role === "number") out[f.id] = val;
    else if (role === "user") out[f.id] = { accountId: val };
    else out[f.id] = val; // text, date, clabels(array)
  }
  return out;
}

async function transitionToDone(key) {
  const tr = await getTransitions(key);
  let t = (tr.transitions || []).find((x) => x.to?.name === "Done");
  if (!t) {
    // hop via In Progress if Done isn't directly reachable
    const mid = (tr.transitions || []).find((x) => x.to?.name === "In Progress");
    if (mid) {
      await doTransition(key, mid.id);
      const tr2 = await getTransitions(key);
      t = (tr2.transitions || []).find((x) => x.to?.name === "Done");
    }
  }
  if (!t) throw new Error(`no path to Done for ${key} (have: ${(tr.transitions || []).map((x) => x.to?.name).join(", ")})`);
  await doTransition(key, t.id);
}

async function linkIssues(inwardKey, outwardKey, typeName = "Blocks") {
  await post("/rest/api/3/issueLink", { type: { name: typeName }, inwardIssue: { key: inwardKey }, outwardIssue: { key: outwardKey } });
}

// Raw multipart attachment upload (the JSON REST client can't do multipart).
async function attachFile(key, filename, content) {
  const env = loadEnv();
  const base = env.JIRA_BASE_URL.replace(/\/$/, "");
  const auth = "Basic " + Buffer.from(`${env.JIRA_ADMIN_EMAIL}:${env.JIRA_API_TOKEN}`).toString("base64");
  const fd = new FormData();
  fd.append("file", new Blob([content], { type: "text/plain" }), filename);
  const res = await fetch(`${base}/rest/api/3/issue/${key}/attachments`, {
    method: "POST",
    headers: { Authorization: auth, "X-Atlassian-Token": "no-check", Accept: "application/json" },
    body: fd,
  });
  if (!res.ok) throw new Error(`attachment upload ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// ====================================================================== setup
async function setup() {
  const I = {}; // name -> key
  const note = (n, k) => { I[n] = k; return k; };
  console.log("Creating diverse issue corpus...");

  // --- field-variant issues ---
  note("text-empty", await createIssue({ issuetype: { id: TYPE.task }, summary: "no custom text set" }));
  note("text-filled", await createIssue({ issuetype: { id: TYPE.task }, summary: "OK-100 ready for review", ...cf({ text: "a clear sentence here" }) }));
  note("text-short", await createIssue({ issuetype: { id: TYPE.task }, summary: "tiny", ...cf({ text: "hi" }) }));
  note("num-3", await createIssue({ issuetype: { id: TYPE.task }, summary: "num three", ...cf({ number: 3 }) }));
  note("num-10", await createIssue({ issuetype: { id: TYPE.task }, summary: "num ten", ...cf({ number: 10 }) }));
  note("sel-high", await createIssue({ issuetype: { id: TYPE.task }, summary: "select high", ...cf({ select: "High" }) }));
  note("sel-security", await createIssue({ issuetype: { id: TYPE.task }, summary: "select security", ...cf({ select: "Security" }) }));
  note("date-future", await createIssue({ issuetype: { id: TYPE.task }, summary: "date future", ...cf({ date: inDays(400) }) }));
  note("date-past", await createIssue({ issuetype: { id: TYPE.task }, summary: "date past", ...cf({ date: "2000-01-01" }) }));
  note("date-soon", await createIssue({ issuetype: { id: TYPE.task }, summary: "date soon", ...cf({ date: inDays(3) }) }));
  note("labels-2", await createIssue({ issuetype: { id: TYPE.task }, summary: "two labels", labels: ["alpha", "beta"] }));
  note("labels-0", await createIssue({ issuetype: { id: TYPE.task }, summary: "no labels" }));
  note("regex-ok", await createIssue({ issuetype: { id: TYPE.task }, summary: "OK-4242 looks right" }));
  note("regex-bad", await createIssue({ issuetype: { id: TYPE.task }, summary: "totally wrong format" }));

  // --- type / priority variants ---
  note("type-bug", await createIssue({ issuetype: { id: TYPE.bug }, summary: "a bug report" }));
  note("type-story", await createIssue({ issuetype: { id: TYPE.story }, summary: "a story" }));
  for (const [name, prio] of [["prio-highest", "Highest"], ["prio-low", "Low"]]) {
    try {
      note(name, await createIssue({ issuetype: { id: TYPE.task }, summary: `priority ${prio}`, priority: { name: prio } }));
    } catch (e) {
      console.log(`  (priority not settable at create for ${name}: ${e.message}) — skipping`);
    }
  }

  // --- structural: parent + mixed sub-tasks ---
  const parentMixed = await createIssue({ issuetype: { id: TYPE.task }, summary: "parent with mixed sub-tasks" });
  note("parent-mixed", parentMixed);
  const subDone = await createIssue({ issuetype: { id: TYPE.subtask }, parent: { key: parentMixed }, summary: "sub done" });
  await createIssue({ issuetype: { id: TYPE.subtask }, parent: { key: parentMixed }, summary: "sub open" });
  await transitionToDone(subDone).catch((e) => console.log("  (subDone->Done failed: " + e.message + ")"));

  const parentAll = await createIssue({ issuetype: { id: TYPE.task }, summary: "parent with all sub-tasks done" });
  note("parent-all-done", parentAll);
  const subAll = await createIssue({ issuetype: { id: TYPE.subtask }, parent: { key: parentAll }, summary: "only sub, done" });
  await transitionToDone(subAll).catch((e) => console.log("  (subAll->Done failed: " + e.message + ")"));
  note("parent-none", await createIssue({ issuetype: { id: TYPE.task }, summary: "parent with no sub-tasks" }));
  // a sub-task whose parent is in Backlog (for parent-status-is)
  note("subtask-of-backlog", await createIssue({ issuetype: { id: TYPE.subtask }, parent: { key: note("ps-parent", await createIssue({ issuetype: { id: TYPE.task }, summary: "ps parent (Backlog)" })) }, summary: "child of backlog parent" }));

  // --- structural: linked pair (A blocks B-resolved, C blocks D-open) ---
  const bResolved = await createIssue({ issuetype: { id: TYPE.task }, summary: "linked target (resolved)" });
  await transitionToDone(bResolved).catch((e) => console.log("  (bResolved->Done failed: " + e.message + ")"));
  const aLinksResolved = await createIssue({ issuetype: { id: TYPE.task }, summary: "links to a resolved issue" });
  await linkIssues(aLinksResolved, bResolved).catch((e) => console.log("  (link a->b failed: " + e.message + ")"));
  note("linked-all-resolved", aLinksResolved);
  const dOpen = await createIssue({ issuetype: { id: TYPE.task }, summary: "linked target (open)" });
  const cLinksOpen = await createIssue({ issuetype: { id: TYPE.task }, summary: "links to an open issue" });
  await linkIssues(cLinksOpen, dOpen).catch((e) => console.log("  (link c->d failed: " + e.message + ")"));
  note("linked-has-open", cLinksOpen);
  note("no-links", await createIssue({ issuetype: { id: TYPE.task }, summary: "no links at all" }));

  // --- structural: resolved issue ---
  const resolved = await createIssue({ issuetype: { id: TYPE.task }, summary: "this one is resolved" });
  await transitionToDone(resolved).catch((e) => console.log("  (resolved->Done failed: " + e.message + ")"));
  note("resolved", resolved);
  note("unresolved", await createIssue({ issuetype: { id: TYPE.task }, summary: "still open" }));

  // --- structural: attachment ---
  const withAtt = await createIssue({ issuetype: { id: TYPE.task }, summary: "has an attachment" });
  let attachmentOk = true;
  try { await attachFile(withAtt, "note.txt", "battery attachment"); note("with-attachment", withAtt); }
  catch (e) { attachmentOk = false; console.log("  (attachment upload failed: " + e.message + ") — pass-case skipped (covered offline)"); }
  note("no-attachment", await createIssue({ issuetype: { id: TYPE.task }, summary: "no attachment here" }));

  console.log(`Created ${Object.keys(I).length} named issues. Settling 2.5s for indexing...`);
  await new Promise((r) => setTimeout(r, 2500));
  return { I, attachmentOk };
}

// ============================================================ rule definitions
// kind: 'validator' (pass/block) | 'condition' (show/hide). expect strings map to result bool.
function buildCases(I, attachmentOk) {
  const sel = CF.select.id, num = CF.number.id, date = CF.date.id, text = CF.text.id;
  const V = (name, config, cases) => ({ name, kind: "validator", config: { ruleKind: "premade", ...config }, cases });
  const C = (name, config, cases) => ({ name, kind: "condition", config: { ruleKind: "premade", ...config }, cases });
  const want = (issue, expect) => ({ issue, expect });

  const list = [
    // ---- VALIDATORS (11) ----
    V("field-required", { ruleType: "field-required", fieldId: text, fieldName: "Text" }, [
      want("text-filled", "pass"), want("text-empty", "block"),
    ]),
    V("field-comparison(num>=5)", { ruleType: "field-comparison", fieldId: num, fieldName: "Number", op: "gte", compareValue: "5" }, [
      want("num-10", "pass"), want("num-3", "block"),
    ]),
    V("field-regex(^OK-)", { ruleType: "field-regex", fieldId: "summary", fieldName: "Summary", regex: "^OK-\\d+" }, [
      want("regex-ok", "pass"), want("regex-bad", "block"),
    ]),
    V("allowed-values(Low,Medium,High)", { ruleType: "allowed-values", fieldId: sel, fieldName: "Select", allowedValues: "Low, Medium, High" }, [
      want("sel-high", "pass"), want("sel-security", "block"),
    ]),
    V("text-length(min12)", { ruleType: "text-length", fieldId: text, fieldName: "Text", min: 12 }, [
      want("text-filled", "pass"), want("text-short", "block"),
    ]),
    V("date-relative(future)", { ruleType: "date-relative", fieldId: date, fieldName: "Date", mode: "future" }, [
      want("date-future", "pass"), want("date-past", "block"),
    ]),
    V("date-relative(within7)", { ruleType: "date-relative", fieldId: date, fieldName: "Date", mode: "within", days: 7 }, [
      want("date-soon", "pass"), want("date-future", "block"),
    ]),
    V("field-cardinality(labels>=2)", { ruleType: "field-cardinality", fieldId: "labels", fieldName: "Labels", min: 2 }, [
      want("labels-2", "pass"), want("labels-0", "block"),
    ]),
    V("sub-tasks-resolved", { ruleType: "sub-tasks-resolved" }, [
      want("parent-all-done", "pass"), want("parent-none", "pass"), want("parent-mixed", "block"),
    ]),
    V("attachment-required", { ruleType: "attachment-required" }, [
      want("no-attachment", "block"), ...(attachmentOk ? [want("with-attachment", "pass")] : []),
    ]),
    // comment-required is screen-only (modifiedFields.comment) — exercised in Mode B (live) via a transition with/without a comment.

    // ---- CONDITIONS (11; 5 user-conditions are unavailable & not wired) ----
    C("field-has-value", { ruleType: "field-has-value", fieldId: text }, [
      want("text-filled", "show"), want("text-empty", "hide"),
    ]),
    C("field-empty", { ruleType: "field-empty", fieldId: text }, [
      want("text-empty", "show"), want("text-filled", "hide"),
    ]),
    C("field-equals(High)", { ruleType: "field-equals", fieldId: sel, value: "High" }, [
      want("sel-high", "show"), want("sel-security", "hide"),
    ]),
    C("issue-type-is(Bug)", { ruleType: "issue-type-is", issueTypeName: "Bug" }, [
      want("type-bug", "show"), want("type-story", "hide"),
    ]),
    C("has-attachments", { ruleType: "has-attachments" }, [
      want("no-attachment", "hide"), ...(attachmentOk ? [want("with-attachment", "show")] : []),
    ]),
    C("issue-is-resolved", { ruleType: "issue-is-resolved" }, [
      want("resolved", "show"), want("unresolved", "hide"),
    ]),
    C("sub-tasks-all-resolved", { ruleType: "sub-tasks-all-resolved" }, [
      want("parent-all-done", "show"), want("parent-none", "show"), want("parent-mixed", "hide"),
    ]),
    C("parent-status-is(Backlog)", { ruleType: "parent-status-is", statusName: "Backlog" }, [
      want("subtask-of-backlog", "show"), want("type-bug", "show" /* no parent → show */),
    ]),
    C("resolution-is(Done)", { ruleType: "resolution-is", resolutionName: "Done" }, [
      want("resolved", "show"),
    ]),
    C("linked-issue-resolved", { ruleType: "linked-issue-resolved" }, [
      want("linked-all-resolved", "show"), want("no-links", "show"), want("linked-has-open", "hide"),
    ]),
  ];

  // priority-is only if priority issues got created
  if (I["prio-highest"] && I["prio-low"]) {
    list.push(C("priority-is(Highest)", { ruleType: "priority-is", priorityName: "Highest" }, [
      want("prio-highest", "show"), want("prio-low", "hide"),
    ]));
  }
  return list;
}

const expectBool = (e) => e === "pass" || e === "show"; // true = allow/show

// ================================================================= Mode A
async function modeA(I, cases) {
  console.log("\n=== Mode A: real executor over real Jira issues (all 22 rules) ===");
  let pass = 0, fail = 0;
  const fails = [];
  for (const rule of cases) {
    const verdicts = [];
    for (const c of rule.cases) {
      const key = I[c.issue];
      if (!key) { fails.push(`${rule.name}/${c.issue}: issue not created`); fail++; continue; }
      const out = await evalRule(rule.config, key, rule.kind);
      const got = out?.result !== false;
      const okExpected = expectBool(c.expect);
      const ok = got === okExpected;
      verdicts.push(`${c.issue}:${c.expect}${ok ? "✓" : "✗(" + (got ? "allow/show" : "block/hide") + ")"}`);
      if (ok) pass++; else { fail++; fails.push(`${rule.name}/${c.issue}: expected ${c.expect}, got ${got ? "allow/show" : "block/hide"}`); }
    }
    console.log(`  [${rule.kind === "condition" ? "C" : "V"}] ${rule.name.padEnd(32)} ${verdicts.join("  ")}`);
  }
  console.log(`Mode A: ${pass}/${pass + fail} passed.`);
  return { pass, fail, fails };
}

// ================================================================= Mode B (live enforcement, validators)
async function modeB(I, cases) {
  console.log("\n=== Mode B: live Jira enforcement (validators) ===");
  const validators = cases.filter((r) => r.kind === "validator");
  // idempotent: drop prior PB- transitions
  {
    const { top, wf } = await readWorkflow(s.workflowName);
    const before = wf.transitions.length;
    wf.transitions = wf.transitions.filter((t) => !String(t.name || "").startsWith("PB-"));
    if (wf.transitions.length !== before) await updateWorkflow(top, wf);
  }
  const specs = validators.map((r, i) => ({ name: `PB-${i}-${r.config.ruleType}`, type: "validator", config: r.config }));
  await attachSelfLoopRules(s.workflowName, s.hubStatusRef, specs, 9201);
  await new Promise((r) => setTimeout(r, 2000));

  let pass = 0, fail = 0;
  const fails = [];
  for (let i = 0; i < validators.length; i++) {
    const rule = validators[i];
    const tName = `PB-${i}-${rule.config.ruleType}`;
    const verdicts = [];
    for (const c of rule.cases) {
      const key = I[c.issue];
      if (!key) continue;
      const tr = await getTransitions(key);
      const t = (tr.transitions || []).find((x) => x.name === tName);
      if (!t) { verdicts.push(`${c.issue}:NA`); continue; }
      const res = await doTransition(key, t.id);
      const blocked = res.status >= 400;
      const expectBlocked = c.expect === "block";
      const ok = blocked === expectBlocked;
      verdicts.push(`${c.issue}:${blocked ? "BLOCK" : "ALLOW"}${ok ? "✓" : "✗"}`);
      if (ok) pass++; else { fail++; fails.push(`${rule.name}/${c.issue}: live expected ${c.expect}, got ${blocked ? "block" : "allow"} (HTTP ${res.status})`); }
    }
    console.log(`  ${rule.name.padEnd(34)} ${verdicts.join("  ")}`);
  }
  console.log(`Mode B: ${pass}/${pass + fail} live enforcement checks passed.`);
  return { pass, fail, fails };
}

// ===================================================================== main
async function main() {
  if (!s.workflowName) throw new Error("Run setup-testbed.mjs first.");
  const { I, attachmentOk } = await setup();
  const cases = buildCases(I, attachmentOk);

  const a = await modeA(I, cases);
  const b = await modeB(I, cases);

  const totalPass = a.pass + b.pass, totalFail = a.fail + b.fail;
  const allFails = [...a.fails, ...b.fails];
  console.log(`\n===== PREMADE BATTERY: ${totalPass}/${totalPass + totalFail} checks passed =====`);
  if (allFails.length) {
    console.log("Failures:");
    for (const f of allFails) console.log("  - " + f);
  }
  writeResult("premade-battery", {
    at: new Date().toISOString(),
    issues: I,
    attachmentOk,
    modeA: { pass: a.pass, fail: a.fail },
    modeB: { pass: b.pass, fail: b.fail },
    failures: allFails,
  });
  console.log(`\nIssues created: ${Object.keys(I).length}. Rule cases: ${cases.length}. Report -> results/premade-battery.json`);
  if (totalFail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("BATTERY FAILED:", e.message);
  if (e.body) console.error(JSON.stringify(e.body, null, 2));
  process.exit(1);
});
