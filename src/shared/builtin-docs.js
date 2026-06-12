/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * Curated builtin documents seeded into the Documentation Library on first use.
 * Bump DOC_SEED_VERSION when adding/changing entries — the seeder upserts by
 * stable id. Builtin docs are exempt from the MAX_DOCS eviction and flip to
 * disabled (not deleted) when removed, so a reseed never resurrects them.
 *
 * The field matrix and rules derive from the sandbox API spec so they can
 * never drift from the prompt/editor documentation.
 */

import { FIELD_TYPE_TABLE, SANDBOX_RULES, JQL_REFERENCE } from "./sandbox-api-spec.js";

export const DOC_SEED_VERSION = 1;

const fieldMatrix = FIELD_TYPE_TABLE.map(
  (r) => `${r.fieldType}\n  read:  ${r.read.replace(/`/g, "")}\n  write: ${r.write.replace(/`/g, "")}`,
).join("\n\n");

const jqlQuickRef = JQL_REFERENCE.map((r) => `${r.code}\n  ${r.doc}`).join("\n\n");

export const BUILTIN_DOCS = [
  {
    id: "builtin_doc_adf",
    title: "ADF Cookbook (Built-in)",
    category: "API Documentation",
    content: `Atlassian Document Format (ADF) — required for description, environment, comments, and custom textarea fields. Plain strings fail with 400.

ROOT DOCUMENT
{ "type": "doc", "version": 1, "content": [ ...block nodes... ] }

BLOCK NODES
Paragraph: { "type": "paragraph", "content": [{ "type": "text", "text": "Hello" }] }
Heading:   { "type": "heading", "attrs": { "level": 2 }, "content": [{ "type": "text", "text": "Title" }] }
Bullets:   { "type": "bulletList", "content": [{ "type": "listItem", "content": [paragraph] }] }
Numbered:  { "type": "orderedList", "content": [{ "type": "listItem", "content": [paragraph] }] }
Code:      { "type": "codeBlock", "attrs": { "language": "javascript" }, "content": [{ "type": "text", "text": "const x = 1;" }] }
Panel:     { "type": "panel", "attrs": { "panelType": "info" }, "content": [paragraph] }  (info|note|warning|error|success)
Quote:     { "type": "blockquote", "content": [paragraph] }
Rule:      { "type": "rule" }

TABLES
table > tableRow > tableHeader/tableCell > paragraph > text. Every cell wraps a paragraph:
{ "type": "table", "content": [
  { "type": "tableRow", "content": [
    { "type": "tableHeader", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Col" }] }] }
  ] }
] }

INLINE MARKS (on text nodes)
Bold:      "marks": [{ "type": "strong" }]
Italic:    "marks": [{ "type": "em" }]
Code:      "marks": [{ "type": "code" }]
Underline: "marks": [{ "type": "underline" }]
Link:      "marks": [{ "type": "link", "attrs": { "href": "https://..." } }]

INLINE NODES
Mention:   { "type": "mention", "attrs": { "id": "<accountId>", "text": "@Name" } }
Emoji:     { "type": "emoji", "attrs": { "shortName": ":white_check_mark:" } }
Date:      { "type": "date", "attrs": { "timestamp": "1735689600000" } }

GOLDEN RULES
- Every text node must live inside a block node — never at the document root.
- Appending: fetch the existing field value, push onto its .content array, write it back.
- Extracting plain text: walk the tree, collect node.text from "text" nodes.`,
  },
  {
    id: "builtin_doc_jql",
    title: "JQL Reference (Built-in)",
    category: "API Documentation",
    content: `JQL (Jira Query Language) quick reference for searches.

OPERATORS
=  !=  ~ (contains)  !~  >  <  >=  <=  IN  NOT IN  IS EMPTY  IS NOT EMPTY  WAS  CHANGED

FUNCTIONS
currentUser()  startOfDay()  endOfDay()  startOfWeek()  endOfWeek()  startOfMonth()  now()

COMMON PATTERNS
${jqlQuickRef}

GOTCHAS
- Quote multi-word values: status = "In Progress".
- Escape double quotes in search text: summary ~ "login \\"error\\"".
- Use accountId for user comparisons, never display names: assignee = "5f8a...".
- Labels are exact-match: labels = "needs-review" (labels never contain spaces).
- Search results from the current /search/jql endpoint have NO total count and paginate with nextPageToken.
- ORDER BY goes last: ... ORDER BY created DESC.
- Date arithmetic: created >= -7d, duedate <= endOfWeek().`,
  },
  {
    id: "builtin_doc_field_formats",
    title: "Field Format Matrix (Built-in)",
    category: "Field Mappings",
    content: `How to read and write every common Jira field type via the REST API / sandbox.

${fieldMatrix}

NOTES
- A wrong value SHAPE is the most common cause of 400 errors on update.
- Option values for selects are case-sensitive and must already exist on the field.
- null clears most fields.
- When unsure, read the field's current value first and mirror its shape.`,
  },
  {
    id: "builtin_doc_sandbox",
    title: "Sandbox Limits & Gotchas (Built-in)",
    category: "Business Rules",
    content: `The static post-function sandbox: what runs, what doesn't.

API SURFACE — exactly five methods plus context:
api.getIssue(key), api.updateIssue(key, fields), api.searchJql(jql), api.transitionIssue(key, id), api.log(...args), api.context.issueKey
There is NO addComment, createIssue, linkIssues, logWork, sprint operations, or raw fetch. Calling an invented method throws at runtime.

EXECUTION
- Runs AFTER the workflow transition succeeds; errors never block the transition.
- Whole chain shares a ~22 second budget; each step gets a slice. Keep API calls per step minimal.
- Steps run in order; a step's return value is available to later steps under its Result Variable name.
- Test runs are always dry-run: reads hit real Jira data, writes (updateIssue / transitionIssue) are logged but not executed.

RULES THAT PREVENT RUNTIME FAILURES
${SANDBOX_RULES.map((r) => `- ${r.replace(/`/g, "")}`).join("\n")}

SEARCH
- searchJql returns at most 20 issues with summary, status, issuetype, priority, assignee.
- No total count — use issues.length; nextPageToken only signals that more pages exist.`,
  },
];
