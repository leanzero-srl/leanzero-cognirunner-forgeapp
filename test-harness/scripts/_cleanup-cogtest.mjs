/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
// Targeted COGTEST debris cleanup (disposable test project): strips every CogniRunner
// rule from the COGTEST workflow's transitions AND bulk-deletes all COGTEST issues —
// WITHOUT deleting the project, custom fields, screens, or workflow structure, so the
// overnight battery can keep using it. Guarded by CONFIRM=1.

import { get, post, del, mapLimit } from "../lib/jira.mjs";
import { readWorkflow, updateWorkflow, APP_ID } from "../lib/workflow.mjs";

const WF_NAME = "Software Simplified Workflow for Project COGTEST";
const PROJECT = "COGTEST";

if (process.env.CONFIRM !== "1") {
  console.log("Refusing without confirmation. Re-run with:  CONFIRM=1 node scripts/_cleanup-cogtest.mjs");
  process.exit(2);
}

const isCogni = (rule) => String(rule?.parameters?.key || rule?.ruleKey || "").includes(APP_ID);

// Recursively strip CogniRunner condition rules from a (possibly nested) conditions node.
const stripConditions = (node) => {
  if (!node) return node;
  if (Array.isArray(node)) return node.filter((c) => !isCogni(c)).map(stripConditions);
  if (Array.isArray(node.conditions)) return { ...node, conditions: node.conditions.filter((c) => !isCogni(c)).map(stripConditions) };
  return node;
};

// ---- 1. Strip CogniRunner rules from the COGTEST workflow ----
console.log(`Reading workflow "${WF_NAME}"…`);
let removed = 0;
try {
  const { top, wf } = await readWorkflow(WF_NAME);
  for (const t of (wf.transitions || [])) {
    if (Array.isArray(t.validators)) { const before = t.validators.length; t.validators = t.validators.filter((r) => !isCogni(r)); removed += before - t.validators.length; }
    if (Array.isArray(t.actions)) { const before = t.actions.length; t.actions = t.actions.filter((r) => !isCogni(r)); removed += before - t.actions.length; }
    if (t.conditions) t.conditions = stripConditions(t.conditions);
  }
  if (removed > 0) {
    const status = await updateWorkflow(top, wf);
    console.log(`  Stripped ${removed} CogniRunner rule(s) from the workflow (update HTTP ${status}).`);
  } else {
    console.log("  No CogniRunner rules found on the workflow.");
  }
} catch (e) {
  console.log(`  Workflow strip skipped/failed: ${e.message.slice(0, 200)}`);
}

// ---- 2. Bulk-delete all COGTEST issues (paginate via nextPageToken) ----
console.log(`\nCollecting all ${PROJECT} issue keys…`);
const keys = [];
let nextPageToken;
for (;;) {
  const body = { jql: `project = ${PROJECT} ORDER BY created ASC`, maxResults: 100, fields: ["key"] };
  if (nextPageToken) body.nextPageToken = nextPageToken;
  const page = await post("/rest/api/3/search/jql", body);
  for (const i of (page.issues || [])) keys.push(i.key);
  if (page.isLast || !page.nextPageToken) break;
  nextPageToken = page.nextPageToken;
  if (keys.length % 500 === 0) console.log(`  …collected ${keys.length}`);
}
console.log(`  Total issues to delete: ${keys.length}`);

let deleted = 0, failed = 0;
// Delete children-safe: deleteSubtasks=true. Concurrency bounded; jira.mjs retries 429/5xx.
await mapLimit(keys, 12, async (key) => {
  try { await del(`/rest/api/3/issue/${key}?deleteSubtasks=true`); deleted++; }
  catch (e) {
    // 404 = already gone (parent deleted its subtask). Treat as deleted.
    if (e.status === 404) { deleted++; } else { failed++; if (failed <= 10) console.log(`  delete ${key} failed: ${String(e.message).slice(0, 80)}`); }
  }
  if (deleted % 200 === 0 && deleted) console.log(`  …deleted ${deleted}/${keys.length}`);
});

console.log(`\n=== COGTEST cleanup done ===`);
console.log(`  rules stripped: ${removed}`);
console.log(`  issues deleted: ${deleted}${failed ? `  (failed: ${failed})` : ""}`);
