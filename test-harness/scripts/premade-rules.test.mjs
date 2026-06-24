/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * OFFLINE unit test for the premade-rule EXECUTOR (src/premade-rules.js).
 *
 * Exercises every available validator (11) and condition (11) plus the edge cases
 * where bugs hide: fail-OPEN on error, CREATE (no issue), array .some/.every
 * semantics, numeric/date-aware comparison, ADF flattening, and the validator-block
 * vs condition-hide result shapes. The field reader is INJECTED (opts.readField), so
 * this runs with no Jira and no @forge/api calls.
 *
 *   node test-harness/scripts/premade-rules.test.mjs    # exits 1 on any failure
 */
import { executePremadeRule } from "../../src/premade-rules.js";

let passed = 0;
const failures = [];

// store: { fieldId -> persisted value }. mf: modifiedFields (screen values).
const runV = (cfg, { mf = {}, issueKey = "T-1", store = {} } = {}) =>
  executePremadeRule(cfg, { issue: { key: issueKey }, modifiedFields: mf }, "validator", {
    readField: async (_k, f) => store[f],
  });
const runC = (cfg, { issueKey = "T-1", store = {} } = {}) =>
  executePremadeRule(cfg, { issue: { key: issueKey } }, "condition", {
    readField: async (_k, f) => store[f],
  });

// expect: { result: bool, hasMsg?: bool }
async function check(name, promise, expect) {
  try {
    const out = await promise;
    const okResult = out?.result === expect.result;
    const okMsg = expect.hasMsg === undefined
      ? true
      : (expect.hasMsg ? typeof out?.errorMessage === "string" && out.errorMessage.length > 0 : out?.errorMessage === undefined);
    if (okResult && okMsg) {
      passed++;
    } else {
      failures.push(`${name}: expected ${JSON.stringify(expect)}, got ${JSON.stringify(out)}`);
    }
  } catch (e) {
    failures.push(`${name}: THREW ${e.message}`);
  }
}

const ADF = (text) => ({ type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

async function main() {
  // ---- VALIDATORS: block = {result:false, hasMsg:true}; pass = {result:true} ----

  // field-required
  await check("field-required empty → block", runV({ ruleType: "field-required", fieldId: "summary", fieldName: "Summary" }, { mf: { summary: "" } }), { result: false, hasMsg: true });
  await check("field-required set → pass", runV({ ruleType: "field-required", fieldId: "summary" }, { mf: { summary: "hi" } }), { result: true });
  await check("field-required empty array → block", runV({ ruleType: "field-required", fieldId: "labels" }, { mf: { labels: [] } }), { result: false });
  await check("field-required ADF empty → block", runV({ ruleType: "field-required", fieldId: "description" }, { mf: { description: ADF("") } }), { result: false });

  // field-changed
  await check("field-changed present+nonempty → pass", runV({ ruleType: "field-changed", fieldId: "assignee" }, { mf: { assignee: { accountId: "x" } } }), { result: true });
  await check("field-changed absent → block", runV({ ruleType: "field-changed", fieldId: "assignee" }, { mf: {} }), { result: false });
  await check("field-changed cleared → block", runV({ ruleType: "field-changed", fieldId: "assignee" }, { mf: { assignee: null } }), { result: false });

  // field-comparison
  await check("comparison gte numeric pass", runV({ ruleType: "field-comparison", fieldId: "cf", op: "gte", compareValue: "5" }, { mf: { cf: "10" } }), { result: true });
  await check("comparison gte numeric block", runV({ ruleType: "field-comparison", fieldId: "cf", op: "gte", compareValue: "5" }, { mf: { cf: "3" } }), { result: false });
  await check("comparison eq text pass", runV({ ruleType: "field-comparison", fieldId: "cf", op: "eq", compareValue: "Done" }, { mf: { cf: "done" } }), { result: true });
  await check("comparison ne pass", runV({ ruleType: "field-comparison", fieldId: "cf", op: "ne", compareValue: "Done" }, { mf: { cf: "Open" } }), { result: true });
  await check("comparison contains pass", runV({ ruleType: "field-comparison", fieldId: "cf", op: "contains", compareValue: "bug" }, { mf: { cf: "a Bug here" } }), { result: true });
  await check("comparison date gt pass", runV({ ruleType: "field-comparison", fieldId: "due", op: "gt", compareValue: "2020-01-01" }, { mf: { due: "2099-01-01" } }), { result: true });
  await check("comparison non-orderable text fail-open", runV({ ruleType: "field-comparison", fieldId: "cf", op: "gt", compareValue: "abc" }, { mf: { cf: "xyz" } }), { result: true });
  await check("comparison empty value → pass (not its job)", runV({ ruleType: "field-comparison", fieldId: "cf", op: "eq", compareValue: "x" }, { mf: { cf: "" } }), { result: true });

  // field-regex
  await check("regex match pass", runV({ ruleType: "field-regex", fieldId: "cf", regex: "^[A-Z]{2,4}-\\d+$" }, { mf: { cf: "ABC-123" } }), { result: true });
  await check("regex no-match block", runV({ ruleType: "field-regex", fieldId: "cf", regex: "^[A-Z]{2,4}-\\d+$" }, { mf: { cf: "nope" } }), { result: false });
  await check("regex bad pattern fail-open", runV({ ruleType: "field-regex", fieldId: "cf", regex: "([" }, { mf: { cf: "x" } }), { result: true });

  // allowed-values
  await check("allowed scalar in list pass", runV({ ruleType: "allowed-values", fieldId: "cf", allowedValues: "A, B, C" }, { mf: { cf: "b" } }), { result: true });
  await check("allowed scalar not in list block", runV({ ruleType: "allowed-values", fieldId: "cf", allowedValues: "A, B" }, { mf: { cf: "Z" } }), { result: false });
  await check("allowed array all-in pass (.every)", runV({ ruleType: "allowed-values", fieldId: "labels", allowedValues: "a, b, c" }, { mf: { labels: ["a", "c"] } }), { result: true });
  await check("allowed array one-out block (.every)", runV({ ruleType: "allowed-values", fieldId: "labels", allowedValues: "a, b" }, { mf: { labels: ["a", "z"] } }), { result: false });

  // text-length (ADF-aware)
  await check("text-length within pass", runV({ ruleType: "text-length", fieldId: "cf", min: 3, max: 10 }, { mf: { cf: "hello" } }), { result: true });
  await check("text-length too short block", runV({ ruleType: "text-length", fieldId: "cf", min: 5 }, { mf: { cf: "hi" } }), { result: false });
  await check("text-length too long block", runV({ ruleType: "text-length", fieldId: "cf", max: 3 }, { mf: { cf: "toolong" } }), { result: false });
  await check("text-length ADF flatten pass", runV({ ruleType: "text-length", fieldId: "description", min: 3 }, { mf: { description: ADF("plenty of text") } }), { result: true });

  // date-relative
  await check("date future pass", runV({ ruleType: "date-relative", fieldId: "due", mode: "future" }, { mf: { due: "2099-01-01" } }), { result: true });
  await check("date future block (past)", runV({ ruleType: "date-relative", fieldId: "due", mode: "future" }, { mf: { due: "2000-01-01" } }), { result: false });
  await check("date within N pass", runV({ ruleType: "date-relative", fieldId: "due", mode: "within", days: 5 }, { mf: { due: inDays(2) } }), { result: true });
  await check("date within N block (too far)", runV({ ruleType: "date-relative", fieldId: "due", mode: "within", days: 5 }, { mf: { due: inDays(40) } }), { result: false });

  // sub-tasks-resolved (issue-level, persisted via reader)
  await check("subtasks all done pass", runV({ ruleType: "sub-tasks-resolved" }, { store: { subtasks: [{ fields: { status: { statusCategory: { key: "done" } } } }] } }), { result: true });
  await check("subtasks one open block", runV({ ruleType: "sub-tasks-resolved" }, { store: { subtasks: [{ fields: { status: { statusCategory: { key: "indeterminate" } } } }] } }), { result: false });
  await check("subtasks none → pass", runV({ ruleType: "sub-tasks-resolved" }, { store: { subtasks: [] } }), { result: true });
  await check("subtasks on CREATE → pass", runV({ ruleType: "sub-tasks-resolved" }, { issueKey: null }), { result: true });

  // attachment-required
  await check("attachment present pass", runV({ ruleType: "attachment-required" }, { store: { attachment: [{ id: "1" }] } }), { result: true });
  await check("attachment absent block", runV({ ruleType: "attachment-required" }, { store: { attachment: [] } }), { result: false });

  // comment-required (reads modifiedFields.comment)
  await check("comment ADF present pass", runV({ ruleType: "comment-required" }, { mf: { comment: ADF("looks good") } }), { result: true });
  await check("comment string present pass", runV({ ruleType: "comment-required" }, { mf: { comment: "ok" } }), { result: true });
  await check("comment missing block", runV({ ruleType: "comment-required" }, { mf: {} }), { result: false });

  // field-cardinality
  await check("cardinality min pass", runV({ ruleType: "field-cardinality", fieldId: "comp", min: 1 }, { mf: { comp: [{ id: "1" }, { id: "2" }] } }), { result: true });
  await check("cardinality min block", runV({ ruleType: "field-cardinality", fieldId: "comp", min: 2 }, { mf: { comp: [{ id: "1" }] } }), { result: false });
  await check("cardinality max block", runV({ ruleType: "field-cardinality", fieldId: "comp", max: 1 }, { mf: { comp: [{ id: "1" }, { id: "2" }] } }), { result: false });

  // validator fail-OPEN when the reader throws
  await check("validator reader throws → fail-open pass",
    executePremadeRule({ ruleType: "field-required", fieldId: "cf" }, { issue: { key: "T-1" }, modifiedFields: {} }, "validator", { readField: async () => { throw new Error("boom"); } }),
    { result: true });

  // ---- CONDITIONS: show = {result:true}; hide = {result:false, no errorMessage} ----

  await check("field-has-value set → show", runC({ ruleType: "field-has-value", fieldId: "cf" }, { store: { cf: "x" } }), { result: true, hasMsg: false });
  await check("field-has-value empty → hide", runC({ ruleType: "field-has-value", fieldId: "cf" }, { store: { cf: "" } }), { result: false, hasMsg: false });
  await check("field-empty empty → show", runC({ ruleType: "field-empty", fieldId: "cf" }, { store: { cf: null } }), { result: true });
  await check("field-empty set → hide", runC({ ruleType: "field-empty", fieldId: "cf" }, { store: { cf: "x" } }), { result: false });
  await check("field-equals option match → show", runC({ ruleType: "field-equals", fieldId: "cf", value: "high" }, { store: { cf: { value: "High" } } }), { result: true });
  await check("field-equals mismatch → hide", runC({ ruleType: "field-equals", fieldId: "cf", value: "low" }, { store: { cf: { value: "High" } } }), { result: false });
  await check("issue-type-is match → show", runC({ ruleType: "issue-type-is", issueTypeName: "Bug" }, { store: { issuetype: { name: "bug" } } }), { result: true });
  await check("issue-type-is mismatch → hide", runC({ ruleType: "issue-type-is", issueTypeName: "Task" }, { store: { issuetype: { name: "Bug" } } }), { result: false });
  await check("has-attachments yes → show", runC({ ruleType: "has-attachments" }, { store: { attachment: [{ id: "1" }] } }), { result: true });
  await check("has-attachments no → hide", runC({ ruleType: "has-attachments" }, { store: { attachment: [] } }), { result: false });
  await check("issue-is-resolved yes → show", runC({ ruleType: "issue-is-resolved" }, { store: { resolution: { name: "Done" } } }), { result: true });
  await check("issue-is-resolved no → hide", runC({ ruleType: "issue-is-resolved" }, { store: { resolution: null } }), { result: false });
  await check("subtasks-all-resolved all done → show", runC({ ruleType: "sub-tasks-all-resolved" }, { store: { subtasks: [{ fields: { status: { statusCategory: { key: "done" } } } }] } }), { result: true });
  await check("subtasks-all-resolved none → show (vacuous)", runC({ ruleType: "sub-tasks-all-resolved" }, { store: { subtasks: [] } }), { result: true });
  await check("subtasks-all-resolved one open → hide", runC({ ruleType: "sub-tasks-all-resolved" }, { store: { subtasks: [{ fields: { status: { statusCategory: { key: "new" } } } }] } }), { result: false });
  await check("parent-status-is match → show", runC({ ruleType: "parent-status-is", statusName: "In Progress" }, { store: { parent: { fields: { status: { name: "in progress" } } } } }), { result: true });
  await check("parent-status-is no parent → show", runC({ ruleType: "parent-status-is", statusName: "Done" }, { store: { parent: null } }), { result: true });
  await check("resolution-is match → show", runC({ ruleType: "resolution-is", resolutionName: "Fixed" }, { store: { resolution: { name: "fixed" } } }), { result: true });
  await check("priority-is match → show", runC({ ruleType: "priority-is", priorityName: "Highest" }, { store: { priority: { name: "highest" } } }), { result: true });
  await check("priority-is mismatch → hide", runC({ ruleType: "priority-is", priorityName: "Low" }, { store: { priority: { name: "Highest" } } }), { result: false });
  await check("linked-issue-resolved all done any-type → show", runC({ ruleType: "linked-issue-resolved" }, { store: { issuelinks: [{ type: { name: "Blocks" }, outwardIssue: { fields: { status: { statusCategory: { key: "done" } } } } }] } }), { result: true });
  await check("linked-issue-resolved one open → hide", runC({ ruleType: "linked-issue-resolved" }, { store: { issuelinks: [{ type: { name: "Blocks" }, inwardIssue: { fields: { status: { statusCategory: { key: "new" } } } } }] } }), { result: false });
  await check("linked-issue-resolved type filter (no match) → show", runC({ ruleType: "linked-issue-resolved", linkTypeName: "Cloners" }, { store: { issuelinks: [{ type: { name: "Blocks" }, inwardIssue: { fields: { status: { statusCategory: { key: "new" } } } } }] } }), { result: true });
  await check("condition on CREATE → show", runC({ ruleType: "field-has-value", fieldId: "cf" }, { issueKey: null }), { result: true });
  await check("condition reader throws → fail-open show",
    executePremadeRule({ ruleType: "field-has-value", fieldId: "cf" }, { issue: { key: "T-1" } }, "condition", { readField: async () => { throw new Error("boom"); } }),
    { result: true });
  await check("unknown/unavailable ruleType (condition) → show", runC({ ruleType: "user-in-group", groupName: "x" }), { result: true });

  // ---- report ----
  const total = passed + failures.length;
  if (failures.length) {
    console.error(`\n✗ premade-rules executor: ${passed}/${total} passed, ${failures.length} FAILED:`);
    for (const f of failures) console.error("  - " + f);
    process.exit(1);
  }
  console.log(`✓ premade-rules executor: ${passed}/${total} assertions passed.`);
}

main();
