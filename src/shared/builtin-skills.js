/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * Builtin starter skills seeded into the skill repository on first use.
 * Bump SKILL_SEED_VERSION when adding/changing entries — the seeder upserts
 * by stable id, so edits ship to existing installations on the next version.
 *
 * Categories must stay within the fixed taxonomy used by the UI badges:
 * "Jira API", "External / Webhooks", "Fields & Data", "ADF & Formatting",
 * "Workflow Patterns", "Other".
 */

export const SKILL_SEED_VERSION = 1;

export const BUILTIN_SKILLS = [
  {
    id: "builtin_skill_adf",
    name: "ADF Authoring",
    category: "ADF & Formatting",
    description: "Writing or appending rich text (description, environment) — paragraphs, headings, lists, tables, links, mentions.",
    tags: ["adf", "description", "rich-text", "format", "table", "link", "mention", "panel", "append"],
    operationTypes: ["rest_api_internal"],
    instructions: `Rich-text fields (description, environment, custom textarea fields) only accept Atlassian Document Format (ADF) — never plain strings.
- Always preserve existing content when appending: fetch the issue, push nodes into \`existing.content\`, then update.
- Every text node lives inside a block node (paragraph, heading, listItem...). A bare { type: "text" } at the document root is invalid.
- Marks decorate text nodes: strong, em, code, underline, link (with attrs.href).
- Tables: table > tableRow > tableHeader/tableCell > paragraph > text. Every cell needs a paragraph wrapper.
- Mentions need the user's accountId: { type: "mention", attrs: { id: "<accountId>", text: "@Name" } }.
- Info/warning callouts: { type: "panel", attrs: { panelType: "info" }, content: [paragraph...] } (panelType: info | note | warning | error | success).
- Keep documents small — a handful of nodes. Do not generate deeply nested structures.`,
    examples: `// Append a warning panel with a link to the description
const issue = await api.getIssue(api.context.issueKey);
const doc = issue.fields.description || { type: "doc", version: 1, content: [] };
doc.content.push({
  type: "panel", attrs: { panelType: "warning" },
  content: [{ type: "paragraph", content: [
    { type: "text", text: "Linked build failed — see " },
    { type: "text", text: "CI run", marks: [{ type: "link", attrs: { href: "https://ci.example.com/run/42" } }] }
  ] }]
});
await api.updateIssue(api.context.issueKey, { description: doc });`,
  },
  {
    id: "builtin_skill_jql",
    name: "JQL Search Patterns",
    category: "Jira API",
    description: "Searching issues with JQL — finding duplicates, related work, recent activity, or anything matched by a query.",
    tags: ["jql", "search", "query", "find", "duplicate", "filter", "pagination", "related"],
    operationTypes: ["work_item_query"],
    instructions: `api.searchJql returns at most 20 issues and NO total count — use results.issues.length; results.nextPageToken (when present) signals more pages exist, but the sandbox cannot paginate further, so say so in a comment when completeness matters.
- Always scope to the current project unless told otherwise: derive it with api.context.issueKey.split("-")[0].
- Escape double quotes inside ~ text searches: value.replace(/"/g, '\\\\"').
- Exclude the current issue from duplicate searches: AND key != \${api.context.issueKey}.
- Quote multi-word values: status = "In Progress".
- Relative dates: -1d, -7d, -30d; functions: currentUser(), startOfDay(), endOfWeek().
- Returned issues only include summary, status, issuetype, priority, assignee by default — call api.getIssue(key) when you need other fields from a hit.`,
    examples: `// Find likely duplicates of this issue in the same project
const issue = await api.getIssue(api.context.issueKey);
const projectKey = api.context.issueKey.split("-")[0];
const safe = issue.fields.summary.replace(/"/g, '\\\\"');
const results = await api.searchJql(
  \`project = \${projectKey} AND summary ~ "\${safe}" AND key != \${api.context.issueKey}\`
);
api.log(\`Found \${results.issues.length} potential duplicates\` + (results.nextPageToken ? " (more exist)" : ""));
return results.issues.map(i => ({ key: i.key, summary: i.fields.summary }));`,
  },
  {
    id: "builtin_skill_custom_fields",
    name: "Custom Field Write Formats",
    category: "Fields & Data",
    description: "Reading or updating custom fields (customfield_XXXXX) — selects, users, dates, numbers, cascading selects.",
    tags: ["custom-field", "customfield", "select", "field", "update", "format", "editmeta", "number", "date"],
    operationTypes: ["rest_api_internal"],
    instructions: `Custom field write formats depend on the field TYPE, not the field name. The most common 400 error cause is a wrong value shape.
- Single select / radio: { customfield_X: { value: "Option Name" } } — the option must exist exactly (case-sensitive).
- Multi select / checkboxes: { customfield_X: [{ value: "A" }, { value: "B" }] } — overwrites the whole list.
- User picker: { customfield_X: { accountId: "..." } } — never displayName or email.
- Group picker: { customfield_X: { name: "group-name" } } — name only, never an id.
- Date: "YYYY-MM-DD" exactly; datetime: "2025-12-31T15:00:00.000+0000" with timezone offset.
- Number: a JSON number (42), never a string ("42").
- Cascading select: { customfield_X: { value: "Parent", child: { value: "Child" } } }.
- Sprint and other Agile fields are NOT writable through api.updateIssue — add a comment in the code explaining this instead of attempting it.
- When a field write keeps failing, read the current value first with api.getIssue and mirror its shape; null clears a field.`,
    examples: `// Set a single-select custom field, guarding against missing option errors
try {
  await api.updateIssue(api.context.issueKey, { customfield_10050: { value: "Approved" } });
  api.log("Set customfield_10050 to Approved");
} catch (err) {
  api.log("Failed to set field (does the option 'Approved' exist?): " + err.message);
}`,
  },
  {
    id: "builtin_skill_chaining",
    name: "Multi-Step Chaining",
    category: "Workflow Patterns",
    description: "Passing data between chained steps — using a prior step's result variable instead of re-fetching.",
    tags: ["chain", "step", "variable", "pass", "result", "multi-step", "prior"],
    operationTypes: ["work_item_query", "rest_api_internal"],
    instructions: `Steps run in order and each step's return value is stored under its Result Variable name. Later steps receive those variables directly in scope.
- Reference a prior variable by its plain name (searchResults.issues...) — never re-fetch data a prior step already returned.
- Always null-guard chained data: a prior step may have returned [] or null on failure.
- Return ONLY what the next step needs (keys, ids, small objects). Step results are size-capped; returning whole issue objects for 20 issues can hit the cap and truncate.
- The whole chain shares one ~22s execution budget — keep per-step API calls minimal (1-3 calls per step).`,
    examples: `// Step 2: comment-friendly summary from step 1's "searchResults"
if (!searchResults || !searchResults.issues || searchResults.issues.length === 0) {
  api.log("No results from step 1 — nothing to do");
  return null;
}
const keys = searchResults.issues.map(i => i.key);
api.log("Processing " + keys.length + " issues from step 1: " + keys.join(", "));
return keys;`,
  },
  {
    id: "builtin_skill_resilience",
    name: "Resilient Execution",
    category: "Workflow Patterns",
    description: "Making steps robust — retries with backoff, graceful partial failure, and diagnosable logs.",
    tags: ["retry", "backoff", "error", "timeout", "resilience", "fail", "log", "robust"],
    operationTypes: ["rest_api_internal", "rest_api_external", "work_item_query"],
    instructions: `Post-functions run after the transition and their errors never block the workflow — so the goal is diagnosability and partial success, not crashing early.
- Wrap each independent operation in its own try/catch; log the failure with api.log and continue with the rest.
- api.log every decision point (what was found, what will be written) — logs are the only window into production runs.
- Retries: only for transient failures (429/5xx), max 3 attempts, exponential delay capped well under the ~22s total budget. Skip retries entirely in multi-step chains where later steps need the remaining time.
- When updating many issues from a search, process sequentially and count successes/failures, then log a summary line.`,
    examples: `// Update several issues, surviving individual failures
const results = await api.searchJql('project = ' + api.context.issueKey.split('-')[0] + ' AND labels = "needs-triage"');
let ok = 0, failed = 0;
for (const hit of results.issues) {
  try {
    await api.updateIssue(hit.key, { labels: ["triaged"] });
    ok++;
  } catch (err) {
    failed++;
    api.log("Failed on " + hit.key + ": " + err.message);
  }
}
api.log(\`Done: \${ok} updated, \${failed} failed\`);
return { ok, failed };`,
  },
  {
    id: "builtin_skill_sandbox_limits",
    name: "Sandbox Limits & Honest Fallbacks",
    category: "Jira API",
    description: "Requests that need comments, issue links, worklogs, sprints, or issue creation — operations outside the sandbox API.",
    tags: ["limit", "sandbox", "comment", "link", "sprint", "create", "worklog", "unsupported", "cannot"],
    operationTypes: ["rest_api_internal", "confluence_api", "rest_api_external"],
    instructions: `The sandbox exposes EXACTLY five methods: getIssue, updateIssue, searchJql, transitionIssue, log (plus api.context). There is no addComment, createIssue, linkIssues, logWork, moveToSprint, or raw fetch — inventing a method throws at runtime.
When the user's request needs an unavailable operation:
1. Implement the parts that ARE possible with the five methods.
2. For the unavailable part, emit a clearly-marked code comment stating what cannot be done in the sandbox and which Jira REST endpoint a full implementation would need.
3. Where a reasonable substitute exists, offer it: e.g. instead of adding a comment, append a paragraph to the description (ADF); instead of creating a subtask, add a "needs-subtask" label and log the intended summary.
Never silently skip the unavailable part — always log it with api.log so the user sees it in test runs.`,
    examples: `// User asked: "comment on the issue when a duplicate is found"
// Sandbox cannot add comments (would need POST /rest/api/3/issue/{key}/comment).
// Substitute: append to the description and log the limitation.
const issue = await api.getIssue(api.context.issueKey);
const doc = issue.fields.description || { type: "doc", version: 1, content: [] };
doc.content.push({ type: "paragraph", content: [
  { type: "text", text: "Possible duplicate detected by automation.", marks: [{ type: "strong" }] }
] });
await api.updateIssue(api.context.issueKey, { description: doc });
api.log("NOTE: sandbox cannot add comments — appended to description instead.");`,
  },
];
