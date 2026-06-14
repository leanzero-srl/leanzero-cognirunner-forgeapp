/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * SINGLE SOURCE OF TRUTH for the static post-function sandbox API surface.
 *
 * This file is imported by BOTH bundles:
 *   - the Forge backend (src/index.js) — builds the AI code-generation system prompt
 *   - the Custom UI apps (static/config-ui, static/admin-panel) — builds the
 *     CodeMirror completions, hover docs, lint rules, and the API Reference panel
 *
 * It MUST stay dependency-free (no @forge/*, no react, no node built-ins) so it
 * can bundle anywhere. If you change the sandbox API in createApi() (src/index.js),
 * change it HERE — every other surface derives from this file.
 */

// === Sandbox API methods =====================================================
// `promptDoc` blocks are the verbatim markdown injected into the AI system
// prompt. `summary`/`detail`/`info` feed the editor completions and hover docs.

export const SANDBOX_API_METHODS = [
  {
    name: "getIssue",
    signature: "api.getIssue(issueKey)",
    returns: "issue object",
    summary: "Fetches a Jira issue by key. Returns full issue with fields (summary, status, priority, etc.)",
    detail: "(issueKey) → issue object",
    example: 'const issue = await api.getIssue(api.context.issueKey);',
    promptDoc: `### api.getIssue(issueKey) → Object
Fetches a Jira issue via REST API v3. Returns the full issue object:
\`\`\`javascript
const issue = await api.getIssue("PROJ-123");
// issue.key = "PROJ-123"
// issue.fields.summary = "Issue title"
// issue.fields.description = { type: "doc", version: 1, content: [...] } // ADF format
// issue.fields.status = { name: "To Do", id: "10000" }
// issue.fields.issuetype = { name: "Bug", id: "10001" }
// issue.fields.priority = { name: "High", id: "1" }
// issue.fields.assignee = { displayName: "John", accountId: "5f..." } or null
// issue.fields.reporter = { displayName: "Jane", accountId: "5f..." }
// issue.fields.labels = ["backend", "urgent"]
// issue.fields.components = [{ name: "API", id: "10000" }]
// issue.fields.fixVersions = [{ name: "1.0", id: "10000" }]
// issue.fields.duedate = "2025-03-15" or null
// issue.fields.created = "2025-01-15T10:30:00.000+0000"
// issue.fields.updated = "2025-01-16T14:20:00.000+0000"
// issue.fields.resolution = { name: "Done" } or null
// issue.fields.customfield_XXXXX = varies by type
// issue.fields.issuelinks = [{ type: { name: "Blocks" }, outwardIssue: { key: "PROJ-456" } }]
// issue.fields.subtasks = [{ key: "PROJ-124", fields: { summary: "...", status: {...} } }]
// issue.fields.parent = { key: "PROJ-100" } or undefined
// issue.fields.comment = { comments: [{ body: {ADF}, author: {...}, created: "..." }] }
\`\`\``,
  },
  {
    name: "updateIssue",
    signature: "api.updateIssue(issueKey, fields)",
    returns: "{ success: true }",
    summary: "Updates fields on an issue. Use field IDs as keys. ADF required for description.",
    detail: "(issueKey, fields) → { success }",
    example: 'await api.updateIssue(api.context.issueKey, { priority: { name: "High" } });',
    promptDoc: `### api.updateIssue(issueKey, fieldsObject) → { success: true }
Updates fields via PUT /rest/api/3/issue/{key}. Field value formats:

**Text fields:** \`{ summary: "New title" }\`
**Date fields:** \`{ duedate: "2025-12-31" }\` (ISO format, date only)
**Select/Priority:** \`{ priority: { name: "High" } }\` or \`{ priority: { id: "1" } }\`
**User fields:** \`{ assignee: { accountId: "5f..." } }\` — use accountId, never username
**Labels (overwrite):** \`{ labels: ["bug", "reviewed"] }\`
**Components:** \`{ components: [{ id: "10001" }] }\`
**Fix versions:** \`{ fixVersions: [{ id: "10000" }] }\`
**Custom fields:** \`{ customfield_10050: "value" }\` — format depends on field type

**ADF fields (description, environment):** Must use Atlassian Document Format:
\`\`\`javascript
// Simple paragraph
{ description: { type: "doc", version: 1, content: [
  { type: "paragraph", content: [{ type: "text", text: "Plain text" }] }
] } }

// Bold text
{ description: { type: "doc", version: 1, content: [
  { type: "paragraph", content: [
    { type: "text", text: "Bold text", marks: [{ type: "strong" }] }
  ] }
] } }

// Multiple paragraphs
{ description: { type: "doc", version: 1, content: [
  { type: "paragraph", content: [{ type: "text", text: "First paragraph" }] },
  { type: "paragraph", content: [{ type: "text", text: "Second paragraph" }] }
] } }

// Bullet list
{ description: { type: "doc", version: 1, content: [
  { type: "bulletList", content: [
    { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Item 1" }] }] },
    { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Item 2" }] }] }
  ] }
] } }

// Heading
{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Section Title" }] }

// Code block
{ type: "codeBlock", attrs: { language: "javascript" }, content: [{ type: "text", text: "const x = 1;" }] }
\`\`\``,
  },
  {
    name: "searchJql",
    signature: "api.searchJql(jql)",
    returns: "{ issues: [...], nextPageToken? }",
    summary: "Searches Jira issues using JQL. Returns up to 20 results. No total count — use issues.length; nextPageToken signals more pages.",
    detail: "(jql) → { issues, nextPageToken? }",
    example: "const results = await api.searchJql('project = PROJ AND created >= -7d');",
    promptDoc: `### api.searchJql(jqlQuery) → { issues: [...], nextPageToken?: string }
Searches via POST /rest/api/3/search/jql (the legacy /rest/api/3/search endpoint was shut down on 2025-10-31). Returns up to 20 results. The response does NOT include a "total" count — use issues.length to know how many came back, and nextPageToken if more pages exist.

**JQL operators:** \`=\`, \`!=\`, \`~\` (contains), \`!~\`, \`IN\`, \`NOT IN\`, \`>\`, \`<\`, \`>=\`, \`<=\`, \`IS EMPTY\`, \`IS NOT EMPTY\`
**JQL functions:** \`currentUser()\`, \`startOfDay()\`, \`endOfDay()\`, \`startOfWeek()\`

\`\`\`javascript
// Find issues by text
const results = await api.searchJql('project = PROJ AND summary ~ "login error"');

// Find issues by status
const results = await api.searchJql('project = PROJ AND status = "In Progress"');

// Find assigned to current issue's assignee
const issue = await api.getIssue(api.context.issueKey);
if (issue.fields.assignee) {
  const results = await api.searchJql(\`assignee = "\${issue.fields.assignee.accountId}"\`);
}

// Find recent issues
const results = await api.searchJql('project = PROJ AND created >= -7d ORDER BY created DESC');

// Find by label
const results = await api.searchJql('project = PROJ AND labels = "critical"');

// Result shape:
// results.issues[0].key = "PROJ-1"
// results.issues[0].fields.summary = "Issue title"
// results.issues[0].fields.status.name = "To Do"
// results.nextPageToken = "..." (present only when more pages exist)
// NOTE: there is NO results.total — use results.issues.length
\`\`\``,
  },
  {
    name: "transitionIssue",
    signature: "api.transitionIssue(issueKey, transitionId)",
    returns: "{ success: true }",
    summary: "Moves an issue to a different status using the transition ID (a number as string). Transition IDs cannot be looked up in the sandbox.",
    detail: "(issueKey, transitionId) → { success }",
    example: 'await api.transitionIssue(api.context.issueKey, "31");',
    promptDoc: `### api.transitionIssue(issueKey, transitionId) → { success: true }
Executes a workflow transition. The transitionId is a number (as string).
**Note:** You cannot look up transitions in the sandbox. If the user provides a transition name, include a comment explaining they need the numeric ID.`,
  },
  {
    name: "createVersion",
    signature: "api.createVersion(name, extra?)",
    returns: "{ id, name }",
    summary: "Creates a fix/affects version in the current issue's project. Use the returned id to set fixVersions via api.updateIssue.",
    detail: "(name, extra?) → { id, name }",
    example: 'const v = await api.createVersion("2.4.0"); await api.updateIssue(api.context.issueKey, { fixVersions: [{ id: v.id }] });',
    promptDoc: `### api.createVersion(name, extra?) → { id, name }
Creates a project version (fix/affects version). \`extra\` may include \`description\`, \`released\`, \`releaseDate\`. Then reference it via \`api.updateIssue(key, { fixVersions: [{ id: v.id }] })\`.`,
  },
  {
    name: "createComponent",
    signature: "api.createComponent(name, extra?)",
    returns: "{ id, name }",
    summary: "Creates a component in the current issue's project.",
    detail: "(name, extra?) → { id, name }",
    example: 'const c = await api.createComponent("Payments"); await api.updateIssue(api.context.issueKey, { components: [{ id: c.id }] });',
    promptDoc: `### api.createComponent(name, extra?) → { id, name }
Creates a project component. \`extra\` may include \`description\`, \`leadAccountId\`, \`assigneeType\`. Reference via \`api.updateIssue(key, { components: [{ id: c.id }] })\`.`,
  },
  {
    name: "createIssue",
    signature: "api.createIssue(fields)",
    returns: "{ key }",
    summary: "Creates a new issue. `fields` must include project, issuetype and summary.",
    detail: "(fields) → { key }",
    example: 'const child = await api.createIssue({ project: { key: "PROJ" }, issuetype: { name: "Task" }, summary: "Follow-up" });',
    promptDoc: `### api.createIssue(fields) → { key }
Creates an issue. \`fields\` must include \`project\`, \`issuetype\`, \`summary\` (ADF for description). For sub-tasks add \`parent: { key }\` and a sub-task issue type.`,
  },
  {
    name: "cloneIssue",
    signature: "api.cloneIssue(overrides?)",
    returns: "{ key }",
    summary: "Clones the current issue (copies project, type, summary, description). Pass overrides to change fields on the clone.",
    detail: "(overrides?) → { key }",
    example: 'const dup = await api.cloneIssue({ summary: "Backport: same bug on 2.3" });',
    promptDoc: `### api.cloneIssue(overrides?) → { key }
Creates a copy of the current issue. \`overrides\` is merged over the copied fields (e.g. \`{ summary, assignee, labels }\`).`,
  },
  {
    name: "forceStatus",
    signature: "api.forceStatus(targetStatusName, opts?)",
    returns: "{ success, target, tempTransition }",
    summary: "Emergency status change: adds a TEMP transition to the target status, fires it, then removes it. The target status must already exist in the workflow. Needs manage:jira-configuration.",
    detail: "(targetStatusName, opts?) → { success, target }",
    example: 'await api.forceStatus("Done");',
    promptDoc: `### api.forceStatus(targetStatusName, opts?) → { success, target }
Forces the current issue into a status even when no normal transition path exists, by creating a temporary global transition, executing it, then removing it. The target status must already be part of the issue's workflow. \`opts.workflowName\` overrides the workflow (otherwise taken from the rule config). HEAVY: performs two workflow updates — use sparingly.`,
  },
  {
    name: "transitionByName",
    signature: "api.transitionByName(issueKey, name, extra?)",
    returns: "{ success: true }",
    summary: "Resolves a transition by NAME on the issue and executes it (no numeric id needed). extra = { fields, update }.",
    detail: "(issueKey, name, extra?) → { success }",
    example: 'await api.transitionByName(api.context.issueKey, "Done", { fields: { resolution: { name: "Done" } } });',
    promptDoc: "### api.transitionByName(issueKey, name, extra?) → { success }\nLooks up the transition by name on the issue, then runs it. `extra.fields`/`extra.update` set resolution, add a comment, etc. in the same call.",
  },
  {
    name: "transitionSubtasks",
    signature: "api.transitionSubtasks(name)",
    returns: "{ moved, total }",
    summary: "Transitions every sub-task of the current issue by transition name (ScriptRunner 'Transition sub-tasks').",
    detail: "(name) → { moved, total }",
    example: 'await api.transitionSubtasks("Done");',
    promptDoc: "### api.transitionSubtasks(name) → { moved, total }\nRuns the named transition on each sub-task of the current issue.",
  },
  {
    name: "transitionParent",
    signature: "api.transitionParent(name)",
    returns: "{ moved, parent }",
    summary: "Transitions the parent of the current issue by transition name (ScriptRunner 'Transition parent').",
    detail: "(name) → { moved, parent }",
    example: 'await api.transitionParent("In Progress");',
    promptDoc: "### api.transitionParent(name) → { moved, parent }\nRuns the named transition on the current issue's parent (no-op if it has none).",
  },
  {
    name: "addComment",
    signature: "api.addComment(body, opts?)",
    returns: "{ id }",
    summary: "Adds a comment. body may be a plain string (auto-converted to ADF) or an ADF doc. opts.visibility restricts it to a role/group.",
    detail: "(body, opts?) → { id }",
    example: 'await api.addComment("Auto-triaged: likely a session race.");',
    promptDoc: "### api.addComment(body, opts?) → { id }\nAdds a comment to the current issue. `body` string is converted to ADF. `opts.visibility = { type: 'role'|'group', value }` restricts visibility.",
  },
  {
    name: "setAssignee",
    signature: "api.setAssignee(accountId)",
    returns: "{ success: true }",
    summary: 'Sets the assignee by accountId. Pass "unassigned" to clear, "-1" for project default.',
    detail: "(accountId) → { success }",
    example: 'await api.setAssignee("712020:...");',
    promptDoc: '### api.setAssignee(accountId) → { success }\nSets the assignee. `"unassigned"` clears it; `"-1"` uses the project default.',
  },
  {
    name: "addWorklog",
    signature: "api.addWorklog(timeSpentSeconds, comment?)",
    returns: "{ id }",
    summary: "Logs work on the current issue. comment may be a string (ADF-converted) or ADF.",
    detail: "(timeSpentSeconds, comment?) → { id }",
    example: 'await api.addWorklog(3600, "Investigated logs");',
    promptDoc: "### api.addWorklog(timeSpentSeconds, comment?) → { id }\nLogs work (in seconds) on the current issue, started now.",
  },
  {
    name: "createIssueLink",
    signature: "api.createIssueLink(outwardKey, typeName?)",
    returns: "{ success: true }",
    summary: "Links the current issue (inward) to outwardKey using a link type name (default 'Relates').",
    detail: "(outwardKey, typeName?) → { success }",
    example: 'await api.createIssueLink("PROJ-42", "Blocks");',
    promptDoc: "### api.createIssueLink(outwardKey, typeName?) → { success }\nCreates an issue link from the current issue to `outwardKey`. Type names: Relates, Blocks, Duplicate, Cloners, etc.",
  },
  {
    name: "addWatcher",
    signature: "api.addWatcher(accountId)",
    returns: "{ success: true }",
    summary: "Adds a watcher by accountId to the current issue.",
    detail: "(accountId) → { success }",
    example: 'await api.addWatcher("712020:...");',
    promptDoc: "### api.addWatcher(accountId) → { success }\nAdds a watcher. (Use api.removeWatcher(accountId) to remove.)",
  },
  {
    name: "removeWatcher",
    signature: "api.removeWatcher(accountId)",
    returns: "{ success: true }",
    summary: "Removes a watcher by accountId from the current issue.",
    detail: "(accountId) → { success }",
    example: 'await api.removeWatcher("712020:...");',
    promptDoc: "### api.removeWatcher(accountId) → { success }\nRemoves a watcher from the current issue.",
  },
  {
    name: "addVote",
    signature: "api.addVote()",
    returns: "{ success: true }",
    summary: "Adds a vote (as the app actor) to the current issue.",
    detail: "() → { success }",
    example: "await api.addVote();",
    promptDoc: "### api.addVote() → { success }\nVotes for the current issue.",
  },
  {
    name: "setProperty",
    signature: "api.setProperty(propKey, value)",
    returns: "{ success: true }",
    summary: "Sets an issue entity property (arbitrary JSON, ≤32KB) under propKey.",
    detail: "(propKey, value) → { success }",
    example: 'await api.setProperty("cogni-scratch", { triaged: true });',
    promptDoc: "### api.setProperty(propKey, value) → { success }\nStores arbitrary JSON as an issue entity property. Read it back with api.getProperty(propKey).",
  },
  {
    name: "getProperty",
    signature: "api.getProperty(propKey)",
    returns: "the stored value, or null",
    summary: "Reads an issue entity property (null if absent).",
    detail: "(propKey) → value | null",
    example: 'const v = await api.getProperty("cogni-scratch");',
    promptDoc: "### api.getProperty(propKey) → value | null\nReads an issue entity property previously set with api.setProperty.",
  },
  {
    name: "addRemoteLink",
    signature: "api.addRemoteLink(url, title?)",
    returns: "{ id }",
    summary: "Adds a remote/web link to the current issue.",
    detail: "(url, title?) → { id }",
    example: 'await api.addRemoteLink("https://status.example.com/incident/42", "Incident 42");',
    promptDoc: "### api.addRemoteLink(url, title?) → { id }\nAttaches an external web link to the current issue.",
  },
  {
    name: "sendNotification",
    signature: "api.sendNotification(subject, textBody, to?)",
    returns: "{ success: true }",
    summary: "Sends an email notification about the current issue. to defaults to { assignee, reporter }.",
    detail: "(subject, textBody, to?) → { success }",
    example: 'await api.sendNotification("Action needed", "Please review.", { assignee: true, watchers: true });',
    promptDoc: "### api.sendNotification(subject, textBody, to?) → { success }\nEmails about the current issue. `to` = { reporter, assignee, watchers, voters } booleans, or { users:[{accountId}] }.",
  },
  {
    name: "log",
    signature: "api.log(...args)",
    returns: "void",
    summary: "Logs a debug message. Objects are JSON-serialized. Visible in test results and execution logs.",
    detail: "(...args) → void",
    example: 'api.log("Processing issue:", api.context.issueKey);',
    promptDoc: `### api.log(...args) → void
Logs debug messages. Accepts multiple arguments, objects are JSON-serialized.
\`\`\`javascript
api.log("Processing issue:", api.context.issueKey);
api.log("Issue data:", { key: issue.key, status: issue.fields.status.name });
\`\`\``,
  },
  {
    name: "context",
    signature: "api.context",
    returns: "{ issueKey: string }",
    summary: "The current issue being transitioned. api.context.issueKey = 'PROJ-123'",
    detail: "{ issueKey }",
    example: "const key = api.context.issueKey;",
    promptDoc: `### api.context → { issueKey: string }
The current issue being transitioned. Always available.`,
  },
];

// The only members generated code may use on `api`. Used by the editor lint
// rule AND by the prompt guard line — keep in lockstep with createApi().
export const KNOWN_API_MEMBERS = [
  "getIssue",
  "updateIssue",
  "searchJql",
  "transitionIssue",
  "log",
  "context",
];

export const getApiMethodNames = () =>
  SANDBOX_API_METHODS.filter((m) => m.name !== "context").map((m) => m.name);

// The lead guard paragraph (verbatim from the system prompt).
export const API_USAGE_GUARD = `You must ONLY use these methods on the \`api\` object: \`getIssue\`, \`updateIssue\`, \`searchJql\`, \`transitionIssue\`, \`log\`, and the \`api.context\` accessor. Never invent other methods (\`api.deleteIssue\`, \`api.addComment\`, \`api.batch\`, etc. do NOT exist and will throw at runtime).`;

// === Field type reference ====================================================
// One row per Jira field type: how to read it, how to write it. Renders both
// the system-prompt table and the UI "Field Update Formats" reference.

export const FIELD_TYPE_TABLE = [
  { fieldType: "Summary", read: "`issue.fields.summary` (string)", write: '`{ summary: "text" }`' },
  { fieldType: "Description", read: "`issue.fields.description` (ADF object)", write: "`{ description: {ADF} }`" },
  { fieldType: "Status", read: "`issue.fields.status.name` (read-only)", write: "Use `transitionIssue()` instead" },
  { fieldType: "Priority", read: "`issue.fields.priority.name`", write: '`{ priority: { name: "High" } }`' },
  { fieldType: "Assignee", read: "`issue.fields.assignee?.accountId`", write: '`{ assignee: { accountId: "..." } }`' },
  { fieldType: "Labels", read: "`issue.fields.labels` (string[])", write: '`{ labels: ["a","b"] }` (overwrites all)' },
  { fieldType: "Components", read: "`issue.fields.components` ({name,id}[])", write: '`{ components: [{ id: "..." }] }`' },
  { fieldType: "Due date", read: '`issue.fields.duedate` ("YYYY-MM-DD")', write: '`{ duedate: "2025-12-31" }` — strictly YYYY-MM-DD, never a datetime' },
  { fieldType: "Custom text", read: "`issue.fields.customfield_XXXXX`", write: '`{ customfield_XXXXX: "value" }`' },
  { fieldType: "Custom select", read: "`issue.fields.customfield_XXXXX.value`", write: '`{ customfield_XXXXX: { value: "Option" } }`' },
  { fieldType: "Custom multi-select", read: "`.customfield_XXXXX[].value`", write: '`{ customfield_XXXXX: [{ value: "A" }, { value: "B" }] }`' },
  { fieldType: "Custom user", read: "`.customfield_XXXXX.accountId`", write: '`{ customfield_XXXXX: { accountId: "..." } }`' },
  { fieldType: "Cascading select", read: "`.customfield_XXXXX.value` + `.customfield_XXXXX.child.value`", write: '`{ customfield_XXXXX: { value: "Parent", child: { value: "Child" } } }`' },
  { fieldType: "Group picker", read: "`.customfield_XXXXX.name`", write: '`{ customfield_XXXXX: { name: "group-name" } }` — group NAME only, never an id' },
  { fieldType: "Custom date", read: '`"YYYY-MM-DD"` string', write: '`{ customfield_XXXXX: "2025-12-31" }` — strictly YYYY-MM-DD' },
  { fieldType: "Custom datetime", read: "ISO string", write: '`{ customfield_XXXXX: "2025-12-31T15:00:00.000+0000" }` — timezone offset REQUIRED' },
  { fieldType: "Custom number", read: "`issue.fields.customfield_XXXXX` (number)", write: "`{ customfield_XXXXX: 42 }` — a JSON number, never a string" },
  { fieldType: "Sprint", read: "`.customfield_XXXXX` (array, read-only here)", write: "NOT writable via updateIssue — needs the Jira Agile API (unavailable in this sandbox); tell the user" },
];

// Write-format hints keyed by the custom-field type short key
// (field.schema.custom.split(":").pop() — same key formatField() uses).
// Powers the dynamic custom-field completions in the editor.
export const WRITE_FORMATS_BY_CUSTOM_TYPE = {
  textfield: '"plain text"',
  textarea: 'ADF document — { type: "doc", version: 1, content: [...] }',
  select: '{ value: "Option Name" }',
  multiselect: '[{ value: "A" }, { value: "B" }]',
  radiobuttons: '{ value: "Option Name" }',
  multicheckboxes: '[{ value: "A" }]',
  userpicker: '{ accountId: "5f..." } — never username',
  multiuserpicker: '[{ accountId: "5f..." }]',
  grouppicker: '{ name: "group-name" } — name only, never an id',
  multigrouppicker: '[{ name: "group-name" }]',
  datepicker: '"YYYY-MM-DD" — date only, never a datetime',
  datetime: '"2025-12-31T15:00:00.000+0000" — timezone offset required',
  float: "42 — a JSON number, never a string",
  labels: '["a", "b"] — labels cannot contain spaces',
  url: '"https://..."',
  version: '{ id: "10000" }',
  multiversion: '[{ id: "10000" }]',
  cascadingselect: '{ value: "Parent", child: { value: "Child" } }',
  project: '{ key: "PROJ" }',
};

// Write-format hints for common system fields, keyed by field id.
export const WRITE_FORMATS_BY_SYSTEM_FIELD = {
  summary: '"text string"',
  description: 'ADF document — { type: "doc", version: 1, content: [...] }',
  environment: "ADF document",
  priority: '{ name: "High" } or { id: "1" }',
  assignee: '{ accountId: "5f..." } — never username',
  reporter: '{ accountId: "5f..." }',
  labels: '["bug", "reviewed"] — overwrites all labels, no spaces',
  components: '[{ id: "10001" }] or [{ name: "Backend" }]',
  fixVersions: '[{ id: "10000" }]',
  versions: '[{ id: "10000" }]',
  duedate: '"2025-12-31" — ISO date, no time',
};

// === Static issue-field completions (editor) ================================

export const ISSUE_FIELD_COMPLETIONS = [
  { label: "issue.fields.summary", type: "property", detail: "string" },
  { label: "issue.fields.description", type: "property", detail: "ADF object" },
  { label: "issue.fields.status", type: "property", detail: "{ name, id }" },
  { label: "issue.fields.status.name", type: "property", detail: "string" },
  { label: "issue.fields.priority", type: "property", detail: "{ name, id }" },
  { label: "issue.fields.priority.name", type: "property", detail: "string" },
  { label: "issue.fields.assignee", type: "property", detail: "{ displayName, accountId } | null" },
  { label: "issue.fields.reporter", type: "property", detail: "{ displayName, accountId }" },
  { label: "issue.fields.labels", type: "property", detail: "string[]" },
  { label: "issue.fields.components", type: "property", detail: "{ name, id }[]" },
  { label: "issue.fields.issuetype", type: "property", detail: "{ name, id }" },
  { label: "issue.fields.issuetype.name", type: "property", detail: "string" },
  { label: "issue.fields.duedate", type: "property", detail: "string | null (YYYY-MM-DD)" },
  { label: "issue.fields.created", type: "property", detail: "string (ISO 8601)" },
  { label: "issue.fields.updated", type: "property", detail: "string (ISO 8601)" },
  { label: "issue.fields.resolution", type: "property", detail: "{ name } | null" },
  { label: "issue.fields.parent", type: "property", detail: "{ key } | undefined" },
  { label: "issue.fields.subtasks", type: "property", detail: "{ key, fields }[]" },
  { label: "issue.fields.issuelinks", type: "property", detail: "{ type, outwardIssue, inwardIssue }[]" },
  { label: "issue.fields.fixVersions", type: "property", detail: "{ name, id }[]" },
  { label: "issue.fields.comment", type: "property", detail: "{ comments: [...] }" },
];

// === JQL quick reference (UI panel) =========================================

export const JQL_REFERENCE = [
  { code: "project = PROJ", doc: "Filter by project key" },
  { code: 'status = "To Do"', doc: "Exact status match (quote multi-word)" },
  { code: 'summary ~ "keyword"', doc: "Contains text in summary" },
  { code: 'text ~ "search"', doc: "Full-text search across all fields" },
  { code: "created >= -7d", doc: "Relative dates: -1d, -7d, -30d, startOfDay(), endOfWeek()" },
  { code: "assignee = currentUser()", doc: "Issues assigned to current user" },
  { code: 'labels IN ("bug","urgent")', doc: "Multiple value match" },
  { code: "ORDER BY updated DESC", doc: "Sort results (append to any JQL)" },
];

// === Prompt sections (verbatim) ==============================================

export const ADF_EXTRACT_SECTION = `## EXTRACTING TEXT FROM ADF DESCRIPTION
ADF is a nested tree. To get plain text from a description:
\`\`\`javascript
function adfToText(node) {
  if (!node) return "";
  if (node.type === "text") return node.text || "";
  if (node.content) return node.content.map(adfToText).join(node.type === "paragraph" ? "\\n" : "");
  return "";
}
const plainText = adfToText(issue.fields.description);
\`\`\``;

export const COMMON_PATTERNS = [
  {
    title: "Append to description (preserve existing content)",
    code: `const issue = await api.getIssue(api.context.issueKey);
const existing = issue.fields.description || { type: "doc", version: 1, content: [] };
existing.content.push(
  { type: "paragraph", content: [{ type: "text", text: "Appended text" }] }
);
await api.updateIssue(api.context.issueKey, { description: existing });`,
  },
  {
    title: "Copy field from parent to subtask",
    code: `const issue = await api.getIssue(api.context.issueKey);
if (issue.fields.parent) {
  const parent = await api.getIssue(issue.fields.parent.key);
  await api.updateIssue(api.context.issueKey, { priority: parent.fields.priority });
}`,
  },
  {
    title: "Find and link duplicates",
    code: `const issue = await api.getIssue(api.context.issueKey);
const projectKey = api.context.issueKey.split("-")[0];
const results = await api.searchJql(
  \`project = \${projectKey} AND summary ~ "\${issue.fields.summary.replace(/"/g, '\\\\"')}" AND key != \${api.context.issueKey}\`
);
api.log(\`Found \${results.issues.length} potential duplicates\`);
return results.issues.map(i => ({ key: i.key, summary: i.fields.summary }));`,
  },
];

export const SANDBOX_RULES = [
  "Write ONLY the function body. No `function` wrapper, no `export`, no `import`.",
  "Use `async/await` for all API calls.",
  "Wrap risky operations in try/catch. Log errors with `api.log()`.",
  "Log meaningful status messages so the user can verify behavior.",
  "Use `return` to pass results to the next step in the chain.",
  "Runtime: Node.js 22 (Forge). No browser APIs, no `require`, no file I/O.",
  "Post-functions run AFTER transition succeeds. Errors don't block the workflow.",
  "Never write unbounded loops (`while(true)`, `for(;;)`). A synchronous infinite loop cannot be interrupted, hits the function timeout, and may be retried — always give every loop a clear exit condition and bound its iterations.",
  "Never hardcode issue keys — use `api.context.issueKey` for the current issue.",
  "For description/comment fields, always use ADF format (never plain strings).",
  "When searching by text, escape quotes in the search string.",
  "Use `accountId` for user references, never `username` or `emailAddress`.",
  'Labels must not contain spaces — use hyphens ("needs-review", not "needs review").',
];

// === Editor snippets =========================================================
// Inserted by the editor's snippet completions. `insert` may contain
// CodeMirror snippet placeholders (#{n:label}).

export const SNIPPETS = [
  {
    name: "adfdoc",
    label: "ADF document",
    info: "Root ADF document structure",
    insert: '{ type: "doc", version: 1, content: [#{1}] }',
  },
  {
    name: "adfparagraph",
    label: "ADF paragraph",
    info: "ADF paragraph with text content",
    insert: '{ type: "paragraph", content: [{ type: "text", text: "#{1:text}" }] }',
  },
  {
    name: "adfbulletlist",
    label: "ADF bullet list",
    info: "ADF bullet list with one item",
    insert: '{ type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "#{1:item}" }] }] }] }',
  },
  {
    name: "adfheading",
    label: "ADF heading",
    info: "ADF heading (level 2)",
    insert: '{ type: "heading", attrs: { level: #{1:2} }, content: [{ type: "text", text: "#{2:Section Title}" }] }',
  },
  {
    name: "adftotext",
    label: "adfToText helper",
    info: "Extract plain text from an ADF document tree",
    insert: `function adfToText(node) {
  if (!node) return "";
  if (node.type === "text") return node.text || "";
  if (node.content) return node.content.map(adfToText).join(node.type === "paragraph" ? "\\n" : "");
  return "";
}
const plainText = adfToText(#{1:issue.fields.description});`,
  },
  {
    name: "withretry",
    label: "Backoff retry wrapper",
    info: "Exponential backoff with jitter (3 retries, 1s base, 8s max)",
    insert: `async function withRetry(fn, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
      const jitter = Math.random() * delay * 0.3;
      await new Promise(r => setTimeout(r, delay + jitter));
      api.log("Retry " + (attempt + 1) + "/" + maxRetries + ": " + err.message);
    }
  }
}
const result = await withRetry(async () => #{1:fn});`,
  },
];

// === System prompt builder ===================================================

const fieldTypeTableMarkdown = () => {
  const rows = FIELD_TYPE_TABLE.map(
    (r) => `| ${r.fieldType} | ${r.read} | ${r.write} |`,
  ).join("\n");
  return `| Jira Field Type | Read (from getIssue) | Write (to updateIssue) |
|---|---|---|
${rows}`;
};

const commonPatternsMarkdown = () =>
  COMMON_PATTERNS.map(
    (p) => `**${p.title}:**
\`\`\`javascript
${p.code}
\`\`\``,
  ).join("\n\n");

/**
 * Builds the static portion of the code-generation system prompt that
 * documents the sandbox API. The resolver appends its dynamic tail
 * (backoff/operationType/priorSteps hints) and any fenced context blocks.
 */
export const buildSystemPromptApiSection = () => `${API_USAGE_GUARD}

## SANDBOX API REFERENCE

The code receives an \`api\` object. All methods are async.

${SANDBOX_API_METHODS.map((m) => m.promptDoc).join("\n\n")}

## FIELD TYPE REFERENCE

${fieldTypeTableMarkdown()}

${ADF_EXTRACT_SECTION}

## COMMON PATTERNS

${commonPatternsMarkdown()}

## RULES
${SANDBOX_RULES.map((r) => `- ${r}`).join("\n")}`;
