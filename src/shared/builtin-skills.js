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
 *
 * Content discipline:
 * - Examples use ONLY real sandbox api.* methods — every sandbox claim (which
 *   methods exist, their signatures) must agree with the single source of truth,
 *   src/shared/sandbox-api-spec.js. Never deny a method that spec lists.
 * - Where the full Jira REST API can do more (comments, links, worklogs,
 *   sprint moves), skills state the REST fact AND teach the honest sandbox
 *   fallback explicitly. Never pretend an unavailable operation exists.
 * - Keep each skill compact (~2-4 KB of content): all injected skills share
 *   a 24,576-char prompt budget and an oversized skill drops itself plus
 *   everything after it.
 * - Tags are auto-match keywords: prefer single concrete lowercase words that
 *   users actually type in step prompts (the matcher requires EVERY token of
 *   a multi-word tag to be present in the prompt).
 */

export const SKILL_SEED_VERSION = 4;

export const BUILTIN_SKILLS = [
  {
    id: "builtin_skill_adf",
    name: "ADF Authoring",
    category: "ADF & Formatting",
    description: "Writing or appending rich text (description, environment, textarea custom fields) — paragraphs, headings, lists, tables, links, mentions, panels.",
    tags: ["adf", "description", "rich-text", "format", "table", "link", "mention", "panel", "append"],
    operationTypes: ["rest_api_internal"],
    instructions: `Rich-text fields (description, environment, custom textarea fields) accept ONLY Atlassian Document Format (ADF) — a plain string is rejected with a 400. The document root is { type: "doc", version: 1, content: [...] } and version MUST be exactly 1.
- There is no append endpoint — updateIssue replaces the whole field. To append: api.getIssue first, push nodes into existing.content, then write the entire document back.
- Every text node lives inside a block node (paragraph, heading, listItem, tableCell...). A bare { type: "text" } at the document root is invalid.
- Marks decorate TEXT nodes only — strong, em, code, underline, link ({ type: "link", attrs: { href: "https://..." } }). Putting marks on a block node is a 400.
- Markdown is NOT rendered inside text nodes: "**bold**" stays literal asterisks. Use marks: [{ type: "strong" }] instead.
- Lists: bulletList/orderedList contain listItem nodes whose content is BLOCK nodes — wrap list text in a paragraph inside each listItem.
- Headings: { type: "heading", attrs: { level: 2 }, content: [text nodes] } — level must be 1-6, anything else is a 400.
- Code: { type: "codeBlock", attrs: { language: "javascript" }, content: [{ type: "text", text: "..." }] } — an unknown language renders plain, no error.
- Tables: table > tableRow > tableHeader/tableCell > paragraph > text. Every cell needs a paragraph wrapper.
- Callouts: { type: "panel", attrs: { panelType: "info" }, content: [paragraphs] } — panelType: info | note | warning | error | success.
- Mentions: { type: "mention", attrs: { id: "<accountId>", text: "@Display Name" } } — id MUST be an accountId; a display name as id silently drops the mention.
- Line break inside a paragraph: { type: "hardBreak" }. Horizontal divider between blocks: { type: "rule" }.
- Never emit an empty paragraph without a content array — it renders inconsistently.
- Keep documents small (a handful of nodes); deeply nested structures risk rejection.
- To READ rich text, walk the tree: text nodes carry .text, hardBreak means a newline, paragraphs separate with blank lines (the adfToText pattern in the API reference).`,
    examples: `// Append a warning panel + checklist to the description, preserving existing content
const issue = await api.getIssue(api.context.issueKey);
const doc = issue.fields.description || { type: "doc", version: 1, content: [] };
doc.content.push({
  type: "panel", attrs: { panelType: "warning" },
  content: [{ type: "paragraph", content: [
    { type: "text", text: "Linked build failed — see " },
    { type: "text", text: "CI run", marks: [{ type: "link", attrs: { href: "https://ci.example.com/run/42" } }] }
  ] }]
});
doc.content.push({
  type: "bulletList", content: [
    { type: "listItem", content: [{ type: "paragraph", content: [
      { type: "text", text: "Retry the pipeline", marks: [{ type: "strong" }] }
    ] }] },
    { type: "listItem", content: [{ type: "paragraph", content: [
      { type: "text", text: "Then re-run this transition" }
    ] }] }
  ]
});
await api.updateIssue(api.context.issueKey, { description: doc });
api.log("Appended panel + checklist to description");`,
  },
  {
    id: "builtin_skill_jql",
    name: "JQL Search Patterns",
    category: "Jira API",
    description: "Searching issues with JQL — finding duplicates, related work, recent activity; injection-safe quoting, accountId-only user clauses, and the 20-result sandbox cap.",
    tags: ["jql", "search", "query", "find", "duplicate", "filter", "pagination", "related"],
    operationTypes: ["work_item_query"],
    instructions: `api.searchJql(jql) returns { issues, nextPageToken? } with AT MOST 20 issues and NO total count — use results.issues.length. nextPageToken (when present) only signals that more pages exist; the sandbox cannot paginate further, so api.log that completeness is limited when it matters. (The full REST API paginates POST /rest/api/3/search/jql via nextPageToken and counts via POST /rest/api/3/search/approximate-count — neither loop is reachable from here.)
- Returned issues include ONLY summary, status, issuetype, priority, assignee — call api.getIssue(hit.key) for any other field on a hit (one extra call per hit; mind the budget).
- Always bound the query: scope to the current project unless told otherwise — api.context.issueKey.split("-")[0]. Unbounded queries (no project/assignee clause) can be rejected by the search endpoint.
- NEVER concatenate raw user or field text into JQL — a value like 'x OR project = SECRET' injects clauses. Quote and escape, backslashes first, then quotes:
  const jqlQuote = (s) => '"' + String(s).replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"') + '"';
- Users in JQL: accountId or currentUser() only — username/userkey no longer exist. assignee = "5b10ac8d..." (quoted); assignee IS EMPTY finds unassigned.
- Exclude the current issue from duplicate searches: AND key != \${api.context.issueKey}.
- Validate issue keys before building key IN (...) lists: /^[A-Z][A-Z0-9_]+-\\d+$/ per key.
- Quote multi-word values: status = "In Progress". ~ matches text in one field (summary ~ "login"); text ~ "..." searches across text fields.
- Dates: relative (-1d, -7d, -30d), functions (currentUser(), startOfDay(), endOfWeek()), or quoted ISO values: updated >= "2026-01-01".
- Append ORDER BY (e.g. ORDER BY updated DESC) so results are deterministic across runs.
- 400 means the JQL itself could not be parsed — log the full error message; it usually pinpoints the bad clause.`,
    examples: `// Find likely duplicates of this issue in the same project (injection-safe)
const issue = await api.getIssue(api.context.issueKey);
const projectKey = api.context.issueKey.split("-")[0];
const jqlQuote = (s) => '"' + String(s).replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\"') + '"';
const results = await api.searchJql(
  \`project = \${projectKey} AND summary ~ \${jqlQuote(issue.fields.summary)} AND key != \${api.context.issueKey} ORDER BY updated DESC\`
);
api.log(\`Found \${results.issues.length} potential duplicates\` + (results.nextPageToken ? " (more exist beyond the 20-result cap)" : ""));
return results.issues.map(i => ({ key: i.key, summary: i.fields.summary, status: i.fields.status.name }));`,
  },
  {
    id: "builtin_skill_custom_fields",
    name: "Custom Field Write Formats",
    category: "Fields & Data",
    description: "Reading or updating custom fields (customfield_XXXXX) — selects, users, dates, datetimes, numbers, cascading selects, and verifying that writes actually stuck.",
    tags: ["custom-field", "customfield", "select", "field", "update", "format", "editmeta", "number", "date"],
    operationTypes: ["rest_api_internal"],
    instructions: `Custom field write formats depend on the field TYPE, not its name — a wrong value SHAPE is the most common 400. Jira's error body names the offender: { errors: { customfield_10050: "..." } } — read err.message, it usually says which field and why.
- Single select / radio: { customfield_X: { value: "Option Name" } } — a plain string is a 400; the option must exist exactly (case-sensitive).
- Multi select / checkboxes: [{ value: "A" }, { value: "B" }] — overwrites the whole list; read-modify-write to add one.
- User picker: { accountId: "..." } — never displayName or email. Multi-user: [{ accountId: "..." }].
- Group picker: { name: "group-name" } — group NAME only, never an id.
- Date: "YYYY-MM-DD" exactly — never a datetime, never a Date object. Datetime: "2025-12-31T15:00:00.000+0000" — timezone offset REQUIRED (convert from toISOString() with .replace("Z", "+0000")).
- Number: a JSON number (42), never a string ("42").
- Cascading select: { value: "Parent", child: { value: "Child" } }.
- Rich-text custom fields (textarea type) take an ADF document, never a plain string.
- URL fields: a plain "https://..." string. Version pickers: { id: "10000" } (single) or [{ id: "10000" }] (multi-version) — sending an array to a single-version field is a 400.
- READING: custom selects expose .value; system selects (priority, status) expose .name; unset fields are null — always null-guard.
- customfield_XXXXX ids are instance-specific — the same logical field has a different id on another Jira site. Use the field configured for this step; never copy an id from generic documentation.
- Sprint and other Agile-managed fields are NOT writable via api.updateIssue — explain in a code comment instead of attempting (see the Agile skill).
- null clears any field. When a write keeps failing, api.getIssue first and mirror the exact shape of the current value.
- Writes can be silently transformed (datetime normalization, option objects echoed back as { value, id }) or re-changed by other automation — for critical writes, re-read after updating and compare.`,
    examples: `// Set select + number + date custom fields in ONE update, with diagnosable failure
const key = api.context.issueKey;
try {
  await api.updateIssue(key, {
    customfield_10050: { value: "Approved" }, // single select: object, not a string
    customfield_10061: 8,                     // number: JSON number, not "8"
    customfield_10052: "2026-07-01"           // date: strictly YYYY-MM-DD
  });
  api.log("Updated 3 custom fields on " + key);
} catch (err) {
  api.log("Field update failed (check option spelling / value shapes): " + err.message);
  return { updated: false };
}
// Verify the select stuck (writes can be transformed or reverted by other automation)
const after = await api.getIssue(key);
const v = after.fields.customfield_10050;
api.log("customfield_10050 is now:", v ? v.value : null);
return { updated: true };`,
  },
  {
    id: "builtin_skill_chaining",
    name: "Multi-Step Chaining",
    category: "Workflow Patterns",
    description: "Passing data between chained steps — result variables, null-guarding prior results, returning small truncation-safe payloads, and budgeting the shared ~22s window.",
    tags: ["chain", "step", "variable", "pass", "result", "multi-step", "prior"],
    operationTypes: ["work_item_query", "rest_api_internal"],
    instructions: `Steps run in order; each step's return value is stored under its Result Variable name and later steps receive those variables directly in scope.
- Reference a prior variable by its plain name (searchResults.issues...) — never re-fetch what a prior step already returned; every extra call spends the shared budget.
- The WHOLE chain shares one ~22s execution budget. Keep each step to 1-3 API calls; put the expensive search/fetch early so later steps work from memory.
- Always null-guard chained data: a prior step may have returned null, [], or a partial object after a caught error. Open with: if (!searchResults || !searchResults.issues || searchResults.issues.length === 0) { api.log("nothing to do"); return null; }
- Return ONLY what the next step needs — keys, ids, small plain objects. Step results are size-capped; returning 20 full issue objects can truncate and corrupt the handoff. Shrink early: results.issues.map(i => ({ key: i.key, status: i.fields.status.name })).
- Prefer a plan/execute split: one step computes a plan (a list of { key, fields } changes), the next applies it. Plans are easy to inspect in test runs and easy to fix.
- Design steps idempotently: re-running the chain must not double-append text or re-add labels. Check before writing (does the label already exist? does the marker text already appear in the description?).
- api.log the value you return so test runs show the exact handoff shape the next step will receive.`,
    examples: `// Step 2 of a chain: act on step 1's "searchResults" without re-fetching
if (!searchResults || !searchResults.issues || searchResults.issues.length === 0) {
  api.log("No results from step 1 — nothing to do");
  return null;
}
// Pass forward ONLY what step 3 needs (small, truncation-safe plan)
const plan = searchResults.issues
  .filter(i => i.fields.status.name !== "Done")
  .map(i => ({ key: i.key, addLabel: "stale" }));
api.log("Step 2 plan (" + plan.length + " issues):", plan);
return plan;`,
  },
  {
    id: "builtin_skill_resilience",
    name: "Resilient Execution",
    category: "Workflow Patterns",
    description: "Making steps robust — retry only transient failures, deadline guards inside the ~22s budget, per-item error collection, and diagnosable summary logs.",
    tags: ["retry", "backoff", "error", "timeout", "resilience", "fail", "log", "robust"],
    operationTypes: ["rest_api_internal", "rest_api_external", "work_item_query"],
    instructions: `Post-functions run AFTER the transition succeeds — an error never blocks the workflow, so the goal is diagnosability and partial success, not crashing early.
- Wrap each independent operation in its own try/catch; api.log the failure and continue. Inside loops, collect failures as { key, error } instead of throwing.
- Retry ONLY transient failures: 429 (rate limit) and 5xx. NEVER retry other 4xx — 400/403/404 mean the request itself is wrong (bad value shape, no permission, missing issue); retrying repeats the same failure and burns budget.
- Retry recipe: max 3 attempts, exponential delay (1s base, doubled each attempt, capped well under the ~22s total chain budget). Skip retries entirely in long chains where later steps need the remaining time.
- Jira rate-limits writes to a single issue (roughly 20 writes per 2 seconds) — when touching the same issue repeatedly, coalesce ALL field changes into ONE api.updateIssue call instead of several sequential ones.
- Deadline-guard loops: const deadline = Date.now() + 15000; check Date.now() < deadline BEFORE each write; on breach stop cleanly and log which keys remain — far better than being killed mid-write with no report.
- Jira error bodies carry two shapes: errorMessages: ["human sentence"] and errors: { fieldId: "why" } — err.message surfaces them; log it in full, it usually names the offending field.
- End every multi-item step with one summary line: counts of ok / failed / skipped plus the failed keys, and return that object for chained steps.`,
    examples: `// Update many issues: per-item try/catch, deadline guard, summary log
const projectKey = api.context.issueKey.split("-")[0];
const results = await api.searchJql(\`project = \${projectKey} AND labels = "needs-triage"\`);
const deadline = Date.now() + 15000; // headroom inside the ~22s chain budget
let ok = 0; const failed = []; const remaining = [];
for (const hit of results.issues) {
  if (Date.now() >= deadline) { remaining.push(hit.key); continue; }
  try {
    // search hits only carry summary/status/issuetype/priority/assignee — fetch labels
    const full = await api.getIssue(hit.key);
    const labels = Array.from(new Set([...(full.fields.labels || []).filter(l => l !== "needs-triage"), "triaged"]));
    await api.updateIssue(hit.key, { labels });
    ok++;
  } catch (err) {
    failed.push({ key: hit.key, error: err.message });
    api.log("Failed on " + hit.key + ": " + err.message);
  }
}
api.log(\`Done: \${ok} ok, \${failed.length} failed, \${remaining.length} skipped on deadline\`, { failed, remaining });
return { ok, failed, remaining };`,
  },
  {
    id: "builtin_skill_sandbox_limits",
    name: "Sandbox API — What's Available & the Real Limits",
    category: "Jira API",
    description: "The sandbox exposes a RICH api.* surface (comments, links, worklogs, sub-tasks, sprints, watchers, and more). This covers what IS available and the few operations that genuinely are not — so you use the real method, not a workaround.",
    tags: ["limit", "sandbox", "comment", "link", "sprint", "create", "worklog", "watcher", "api", "unsupported"],
    operationTypes: ["rest_api_internal", "confluence_api", "rest_api_external"],
    instructions: `The sandbox api.* surface is RICH — NOT limited to a handful of read methods. Beyond api.getIssue / updateIssue / searchJql / transitionIssue / log / context, first-class WRITE methods exist and should be used DIRECTLY: api.addComment, api.createIssue, api.cloneIssue, api.createIssueLink, api.addWorklog, api.moveToSprint / api.moveToBacklog, api.addWatcher / api.removeWatcher, api.addVote, api.setAssignee, api.addLabels / api.removeLabels, api.editIssue, api.forceStatus, api.transitionByName / transitionSubtasks / transitionParent, api.setProperty / getProperty, api.addRemoteLink, api.sendNotification, api.rankIssue, api.createVersion / createComponent. The authoritative, always-current list is the API Reference panel (derived from src/shared/sandbox-api-spec.js) — consult it rather than guessing. Do NOT reach for a description-append or a marker-label WORKAROUND when a real method exists (e.g. call api.addComment("your text") — which posts on the CURRENT issue; never "append to the description because comments aren't supported"). Note addComment takes NO issueKey — it always targets the issue the post-function runs on.
What is genuinely NOT available, and the honest fallback:
- Deleting an issue — no api.deleteIssue. Transition it to a closed/cancelled status instead, or log the intent.
- Uploading a file attachment — not writable from the sandbox. Log the intent; attachment READING (vision/doc) happens via the validator/PF field path, not here.
- Raw fetch / arbitrary HTTP / arbitrary REST endpoints — not exposed. Use the typed api.* methods; if an operation truly has no method, say so plainly and api.log it.
Discipline:
1. Prefer the real typed method — check the API Reference panel first.
2. Make writes idempotent (check for an existing marker / link / comment before adding again) since a transition can fire more than once.
3. For a genuinely-unavailable operation, emit a clearly-marked comment naming the REST endpoint a full implementation would need, and api.log the limitation so it surfaces in test runs.
Also: test runs are dry runs (reads real, writes logged not executed), and the whole chain shares a ~22s budget.`,
    examples: `// User asked: "comment on the issue when a duplicate is found"
// api.addComment IS a real method — use it directly, no description-append workaround.
const issue = await api.getIssue(api.context.issueKey);
const results = await api.searchJql(\`project = \${api.context.issueKey.split("-")[0]} AND summary ~ "\${(issue.fields.summary || "").replace(/"/g, " ")}" AND key != \${api.context.issueKey}\`);
if (results.issues && results.issues.length > 0) {
  await api.addComment("Possible duplicate of " + results.issues[0].key + " — please review before proceeding.");
  api.log("Added duplicate-review comment referencing " + results.issues[0].key + ".");
}`,
  },
  {
    id: "builtin_skill_transitions",
    name: "Transition & Status Change Discipline",
    category: "Workflow Patterns",
    description: "Moving issues to another status — transition ids vs status names, idempotent pre-checks, post-transition verification, and the resolution-on-close caveat.",
    tags: ["transition", "status", "move", "close", "resolve", "reopen", "done", "escalate"],
    operationTypes: ["rest_api_internal"],
    instructions: `Status is READ-ONLY through api.updateIssue — { status: ... } never works. The only way to change status is api.transitionIssue(issueKey, transitionId).
- transitionId is a TRANSITION id (a number as a string, e.g. "31"), NOT a status id and NOT a status name. Transition ids are workflow-specific: the "Done" transition has different ids in different workflows.
- The sandbox CANNOT look up transitions. The full REST API discovers them via GET /rest/api/3/issue/{key}/transitions (returns only the transitions valid from the current status, each { id, name, to }) — unavailable here. If the user gave a name ("close it"), ask for the numeric id in a code comment; admins find it in the workflow editor (Text mode) or via that endpoint.
- A transition only succeeds from a status where it is defined — calling it from the wrong status errors. Make it idempotent: read status first and skip when the issue is already in the target status.
- Verify after transitioning: re-read with api.getIssue and api.log the new status.name. Workflow conditions and validators can still reject a transition even with a correct id.
- Resolution is normally settable only on a transition screen (REST: POST .../transitions with fields.resolution). api.transitionIssue cannot pass fields — if the target transition requires a resolution, a validator may reject the call; otherwise it succeeds with the resolution left EMPTY unless a workflow post-function sets one. Verify and log the resolution after closing issues.
- Do not chain several transitions in one step to "walk" an issue through the workflow — each hop can be blocked by conditions; do one hop and verify.
- This post-function runs AFTER its own transition completed — transitioning the CURRENT issue again means a second hop. Usually the intent is to transition OTHER issues: subtasks, linked issues, duplicates.`,
    examples: `// Close duplicate-linked issues (transition id "31" supplied by the user),
// idempotently and with post-verification.
const TARGET_TRANSITION_ID = "31"; // from the workflow editor — ids are workflow-specific
const TARGET_STATUS = "Done";
const issue = await api.getIssue(api.context.issueKey);
for (const link of issue.fields.issuelinks || []) {
  if (!link.type || link.type.name !== "Duplicate") continue;
  const other = link.outwardIssue || link.inwardIssue; // exactly one side is present
  if (!other) continue;
  const dup = await api.getIssue(other.key);
  if (dup.fields.status.name === TARGET_STATUS) { api.log(other.key + " already " + TARGET_STATUS); continue; }
  try {
    await api.transitionIssue(other.key, TARGET_TRANSITION_ID);
    const after = await api.getIssue(other.key);
    api.log(other.key + " is now: " + after.fields.status.name);
  } catch (err) {
    api.log("Transition failed on " + other.key + " (wrong id for this workflow, or blocked by a condition): " + err.message);
  }
}`,
  },
  {
    id: "builtin_skill_users",
    name: "User Fields: accountId-Only Handling",
    category: "Fields & Data",
    description: "Assigning issues and writing user fields — accountId-only rules, nullable assignee guards, unassigning, and where to source accountIds inside the sandbox.",
    tags: ["assignee", "assign", "reporter", "user", "accountid", "unassign", "owner"],
    operationTypes: ["rest_api_internal", "work_item_query"],
    instructions: `accountId is the ONLY valid user identifier in Jira Cloud — in field writes, JQL, and mentions. username, userkey, and email-as-identifier are dead (privacy changes).
- Write shape everywhere: { assignee: { accountId: "5b10ac8d..." } }. User-type custom fields are identical; multi-user pickers take [{ accountId: "..." }, ...]. Never { name: ... }, never a display name.
- Unassign with { assignee: null }.
- assignee is NULLABLE — always guard: issue.fields.assignee && issue.fields.assignee.accountId. reporter is normally present but guard anyway.
- emailAddress may be ABSENT from user objects (privacy settings) — never key logic on email.
- The sandbox cannot search the user directory (REST would use GET /rest/api/3/user/search, and GET /rest/api/3/user/assignable/search to confirm assignability in a project). Source accountIds from data already in reach:
  - people on the current issue: issue.fields.reporter.accountId, issue.fields.assignee (nullable)
  - comment authors: issue.fields.comment.comments[].author.accountId
  - assignees of related issues found via api.searchJql (search hits include assignee)
  - a fixed accountId the user pasted into the step prompt or configuration.
- If an accountId is not assignable in the project, the write fails with a 400 — catch it, log it, and do not retry the same value.
- JQL by user: assignee = "5b10ac8d..." (quoted accountId) or assignee = currentUser(); assignee IS EMPTY finds unassigned issues.
- Copy a user between fields by passing the accountId through: { customfield_10070: { accountId: issue.fields.assignee.accountId } }.
- Mentions in ADF also need the accountId in attrs.id — a display name there silently drops the mention.`,
    examples: `// Assign the issue to its reporter when unassigned (idempotent, diagnosable)
const issue = await api.getIssue(api.context.issueKey);
const reporterId = issue.fields.reporter && issue.fields.reporter.accountId;
if (!reporterId) { api.log("No reporter accountId available — skipping"); return null; }
if (issue.fields.assignee) {
  api.log("Already assigned to " + issue.fields.assignee.displayName + " — no change");
  return { changed: false };
}
try {
  await api.updateIssue(api.context.issueKey, { assignee: { accountId: reporterId } });
  api.log("Assigned " + api.context.issueKey + " to reporter " + issue.fields.reporter.displayName);
  return { changed: true, assignee: reporterId };
} catch (err) {
  api.log("Assign failed (is the reporter assignable in this project?): " + err.message);
  return { changed: false, error: err.message };
}`,
  },
  {
    id: "builtin_skill_array_fields",
    name: "Labels, Components & Versions: Read-Modify-Write",
    category: "Fields & Data",
    description: "Adding or removing one label/component/version without wiping the rest — updateIssue overwrites whole arrays, so always read-modify-write, deduplicate, and skip no-op writes.",
    tags: ["label", "labels", "component", "components", "fixversion", "version", "tag", "append", "remove"],
    operationTypes: ["rest_api_internal"],
    instructions: `api.updateIssue SETS array fields — { labels: [...] } replaces the ENTIRE list. (The REST update-verb form, PUT /rest/api/3/issue/{key} with { update: { labels: [{ add: "x" }] } }, appends atomically — but the sandbox only sets fields.) Therefore: read-modify-write, every time.
1. const issue = await api.getIssue(key)
2. derive the new array from the current one
3. write the full array back in ONE updateIssue call.
- Labels: an array of plain strings. Labels cannot contain spaces — use hyphens ("needs-review"). Deduplicate with a Set before writing; keep your own marker labels lowercase and consistent, comparisons are exact.
- Components: [{ id: "10001" }] or [{ name: "Backend" }]. The component must already exist in the project — an unknown name is a 400 (components are not auto-created). When writing back fetched components, map to bare ids: issue.fields.components.map(c => ({ id: c.id })).
- fixVersions / versions: same pattern — [{ id: "..." }] or [{ name: "..." }]; the version must exist in the project.
- Multi-select custom fields behave identically: [{ value: "A" }, { value: "B" }] overwrites all options.
- Removal = write the filtered array: labels.filter(l => l !== "obsolete").
- api.searchJql hits do NOT include labels/components — api.getIssue(hit.key) before modifying those on a search result.
- Idempotency: check membership first and skip the update entirely when nothing changes — saves budget and avoids pointless notifications and history entries.`,
    examples: `// Add "triaged", remove "needs-triage", preserve everything else — one write, idempotent
const key = api.context.issueKey;
const issue = await api.getIssue(key);
const current = issue.fields.labels || [];
const next = Array.from(new Set([...current.filter(l => l !== "needs-triage"), "triaged"]));
const changed = next.length !== current.length || next.some(l => !current.includes(l));
if (!changed) { api.log("Labels already correct: " + current.join(", ")); return current; }
await api.updateIssue(key, { labels: next });
api.log("Labels: [" + current.join(", ") + "] -> [" + next.join(", ") + "]");

// Add a component without dropping existing ones (the component must exist in the project)
const comps = (issue.fields.components || []).map(c => ({ id: c.id }));
if (!(issue.fields.components || []).some(c => c.name === "Backend")) {
  await api.updateIssue(key, { components: [...comps, { name: "Backend" }] });
  api.log("Added component Backend");
}
return next;`,
  },
  {
    id: "builtin_skill_dates",
    name: "Due Dates & Date Math",
    category: "Fields & Data",
    description: "Setting due dates and date/datetime custom fields — strict YYYY-MM-DD formatting, +0000 offsets for datetimes, safe date arithmetic, and overdue checks.",
    tags: ["duedate", "date", "deadline", "days", "overdue", "schedule", "datetime", "due"],
    operationTypes: ["rest_api_internal", "work_item_query"],
    instructions: `Date-only fields (duedate, custom date pickers) take STRICTLY "YYYY-MM-DD" — never a datetime, never a Date object, never a timestamp number. Datetime custom fields take "2025-12-31T15:00:00.000+0000" — the timezone OFFSET is required; convert from toISOString() with .replace("Z", "+0000").
- Format a Date safely (months/days zero-padded):
  const fmt = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
- Date math: const d = new Date(); d.setDate(d.getDate() + 14); — setDate handles month and year rollover automatically.
- Reading: issue.fields.duedate is "YYYY-MM-DD" or null — always null-guard. created/updated are full timestamps ("2025-01-15T10:30:00.000+0000") — new Date(value) parses them.
- Comparing date-only strings: lexicographic comparison works for YYYY-MM-DD ("2026-01-05" < "2026-02-01") — overdue checks need no parsing, compare against today's formatted string.
- JQL date filters: relative (-7d, -30d), functions (startOfDay(), endOfWeek()), or quoted values: duedate <= "2026-06-30". duedate IS EMPTY finds unscheduled issues.
- Writing a date-only string to a DATETIME-type custom field (or vice versa) can fail with a 400 — when unsure of the field type, read the current value first and mirror its shape.
- Jira may normalize what you wrote (a datetime field stores midnight + offset for a date-looking value) — when verifying a write, re-read and normalize before comparing.`,
    examples: `// Set due date 14 days from now (roll weekend landings forward to Monday)
const fmt = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const due = new Date();
due.setDate(due.getDate() + 14);
if (due.getDay() === 6) due.setDate(due.getDate() + 2); // Saturday -> Monday
if (due.getDay() === 0) due.setDate(due.getDate() + 1); // Sunday -> Monday
await api.updateIssue(api.context.issueKey, { duedate: fmt(due) });
api.log("Due date set to " + fmt(due));

// Overdue check without parsing: YYYY-MM-DD compares lexicographically
const issue = await api.getIssue(api.context.issueKey);
const today = fmt(new Date());
if (issue.fields.duedate && issue.fields.duedate < today) {
  api.log("OVERDUE since " + issue.fields.duedate);
}
return issue.fields.duedate;`,
  },
  {
    id: "builtin_skill_branching",
    name: "Branching on Status, Type & Priority",
    category: "Workflow Patterns",
    description: "Conditional steps that act only for certain issue types, statuses, or priorities — guard-first structure, name normalization, subtask detection, and logged skip reasons.",
    tags: ["branch", "issuetype", "bug", "story", "task", "priority", "check", "skip", "only"],
    operationTypes: ["rest_api_internal", "work_item_query"],
    instructions: `Static post-functions run on EVERY execution of their transition — branching logic decides when to act. Structure every conditional step guard-first:
1. fetch the issue, 2. test the conditions, 3. early-return with an api.log explaining WHY it skipped, 4. only then do the work.
- Branch on names, normalized: issue.fields.issuetype.name.toLowerCase() === "bug"; status via issue.fields.status.name; priority via issue.fields.priority (null-guard it — some configs omit priority). Display names are instance-specific — log the actual value on a mismatch so the user can correct the spelling.
- Never branch on status/issuetype IDS copied from documentation — ids differ per instance and per workflow.
- Subtask detection: issue.fields.issuetype.subtask === true (a boolean carried on every issuetype object). Do NOT infer from fields.parent — since Jira's parent-field unification it is ALSO set for issues under an epic and for all child issues in team-managed projects.
- Combine guards with early returns rather than nesting: if (issue.fields.issuetype.name !== "Bug") { api.log("Not a Bug — skipping"); return null; }
- A skipped run should return a small marker (null or { skipped: true, reason }) so chained steps can null-guard and test runs read clearly.
- For multi-way branches (a different action per priority), prefer an object map over if/else ladders: const action = ({ Highest: "escalated", High: "review-soon" })[priorityName];
- Post-function errors never block the workflow — a wrong branch fails silently in production. api.log every decision so execution logs reconstruct the exact path taken.`,
    examples: `// Escalate only high-priority bugs; log the skip reason otherwise
const issue = await api.getIssue(api.context.issueKey);
const type = issue.fields.issuetype.name.toLowerCase();
const prio = issue.fields.priority ? issue.fields.priority.name : null;
if (type !== "bug") { api.log("Skip: issuetype is '" + issue.fields.issuetype.name + "', not Bug"); return { skipped: true }; }
if (prio !== "Highest" && prio !== "High") { api.log("Skip: priority is '" + prio + "'"); return { skipped: true }; }
if (issue.fields.issuetype.subtask) { api.log("Skip: subtasks are escalated via their parent"); return { skipped: true }; }
const labels = Array.from(new Set([...(issue.fields.labels || []), "escalated"]));
await api.updateIssue(api.context.issueKey, { labels });
api.log("Escalated " + api.context.issueKey + " (" + prio + " " + type + ")");
return { skipped: false, priority: prio };`,
  },
  {
    id: "builtin_skill_hierarchy",
    name: "Parent & Subtask Patterns",
    category: "Workflow Patterns",
    description: "Working across the issue hierarchy — reading parent/subtasks, JQL for children, roll-up checks (all subtasks done), and copying fields between levels.",
    tags: ["subtask", "subtasks", "parent", "child", "children", "rollup", "hierarchy", "sibling"],
    operationTypes: ["work_item_query", "rest_api_internal"],
    instructions: `One level of hierarchy is readable directly from the issue object — no search needed:
- issue.fields.parent = { key } on subtasks — but ALSO on issues under an epic (and on every child issue in team-managed projects). To know whether THIS issue is a true subtask, check issue.fields.issuetype.subtask === true before treating fields.parent as a subtask parent.
- issue.fields.subtasks = [{ key, fields: { summary, status, ... } }] — lists only true subtasks (never epic children), and the embedded fields already include status, so roll-up checks (are all children done?) need NO extra fetches.
- For child fields NOT embedded (labels, description, custom fields), api.getIssue(subtask.key) each child — sequentially, and mind the ~22s budget when there are many.
- JQL alternative (also reaches non-subtask children in newer hierarchies): parent = PROJ-123 finds an issue's children; remember api.searchJql returns at most 20.
- Roll-up from a just-transitioned subtask: getIssue(me) -> me.fields.parent.key -> getIssue(parent) -> inspect parent.fields.subtasks. Your own subtask already shows its NEW status there, because post-functions run after the transition completes.
- Workflows differ per issue type — compare against an explicit done-status list instead of assuming one name: const DONE = ["Done", "Closed", "Resolved"]; DONE.includes(st.fields.status.name).
- Transitioning the parent needs a transition id valid in the PARENT's workflow (often different from the subtask's) — it must come from the user; verify by re-reading the parent afterwards.
- Copying fields down to subtasks: read the parent once, then one coalesced updateIssue per child, sequentially.`,
    examples: `// From a just-completed subtask: when ALL siblings are done, flag the parent
const DONE_STATUSES = ["Done", "Closed", "Resolved"];
const me = await api.getIssue(api.context.issueKey);
// issuetype.subtask gate matters: fields.parent is also set for epic children,
// whose "parent" has no subtasks — without the gate this would false-positive.
if (!me.fields.issuetype.subtask || !me.fields.parent) { api.log("Not a subtask — skipping"); return null; }
const parent = await api.getIssue(me.fields.parent.key);
const subs = parent.fields.subtasks || [];
if (subs.length === 0) { api.log("Parent " + parent.key + " reports no subtasks — nothing to roll up"); return { parentReady: false }; }
const open = subs.filter(st => !DONE_STATUSES.includes(st.fields.status.name));
if (open.length > 0) {
  api.log("Parent " + parent.key + " still has " + open.length + " open subtask(s): " + open.map(s => s.key).join(", "));
  return { parentReady: false };
}
api.log("All " + subs.length + " subtasks of " + parent.key + " are done");
// Flag the parent (transitioning it instead would need the PARENT workflow's transition id from the user)
const labels = Array.from(new Set([...(parent.fields.labels || []), "subtasks-complete"]));
await api.updateIssue(parent.key, { labels });
return { parentReady: true, parent: parent.key };`,
  },
  {
    id: "builtin_skill_bulk",
    name: "Bulk Update Hygiene",
    category: "Workflow Patterns",
    description: "Updating many issues from one step — sequential writes, deadline guards inside the ~22s budget, one coalesced update per issue, and honest reporting of work left undone.",
    tags: ["bulk", "batch", "many", "mass", "sequential", "several", "multiple"],
    operationTypes: ["work_item_query", "rest_api_internal"],
    instructions: `api.searchJql caps results at 20 — that is the natural upper bound for one bulk pass, and roughly what the ~22s chain budget can absorb anyway.
- Write SEQUENTIALLY (for...of with await), never Promise.all on writes: parallel writes trip Jira's burst and per-issue rate limits and make partial failures unreadable. Parallelizing independent READS is fine.
- ONE updateIssue per issue: coalesce every field change for an issue into a single fields object. Several sequential PUTs to one issue are slower and rate-limit-prone (roughly 20 writes per issue per 2 seconds).
- Deadline-guard the loop: const deadline = Date.now() + 15000; check before each write; when breached, stop cleanly and log the unprocessed keys — being killed mid-write loses the whole report.
- Track and return { ok, failed: [{ key, error }], remaining: [keys] } so test runs and chained steps see exactly what happened.
- Per-item try/catch — one bad issue must not abort the rest.
- Search hits only carry summary/status/issuetype/priority/assignee. When the update needs current values of other fields (labels etc.), budget one api.getIssue per hit too — that roughly halves how many issues fit in the window.
- If more than 20 issues match (results.nextPageToken is present), say so in the logs. The full REST API would paginate POST /rest/api/3/search/jql and use true bulk endpoints (e.g. POST /rest/api/3/bulk/issues/transition) — the honest sandbox pattern is one bounded pass per execution.
- Make the pass idempotent (skip already-updated issues via a marker label or a value check) so repeated transitions converge instead of duplicating work.`,
    examples: `// One bounded, deadline-guarded bulk pass: flag stale In Progress issues
const projectKey = api.context.issueKey.split("-")[0];
const results = await api.searchJql(
  \`project = \${projectKey} AND status = "In Progress" AND updated <= -14d ORDER BY updated ASC\`
);
if (results.issues.length === 0) { api.log("Nothing stale"); return { ok: 0, failed: [], remaining: [] }; }
const deadline = Date.now() + 15000;
let ok = 0; const failed = []; const remaining = [];
for (const hit of results.issues) {
  if (Date.now() >= deadline) { remaining.push(hit.key); continue; }
  try {
    const full = await api.getIssue(hit.key); // search hits don't include labels
    if ((full.fields.labels || []).includes("stale")) continue; // idempotent: already flagged
    const labels = [...(full.fields.labels || []), "stale"];
    await api.updateIssue(hit.key, { labels }); // one coalesced write per issue
    ok++;
  } catch (err) { failed.push({ key: hit.key, error: err.message }); }
}
if (results.nextPageToken) api.log("More than 20 issues matched — only the first 20 were processed this run.");
api.log(\`Bulk pass: \${ok} updated, \${failed.length} failed, \${remaining.length} deferred\`, { failed, remaining });
return { ok, failed, remaining };`,
  },
  {
    id: "builtin_skill_agile_fields",
    name: "Agile Fields: Sprint, Epic, Rank & Story Points",
    category: "Fields & Data",
    description: "What is and is not writable on agile boards — sprint moves (api.moveToSprint/moveToBacklog) and rank (api.rankIssue) ARE available; story points are a plain number field; epic re-parenting is the honest limit.",
    tags: ["sprint", "epic", "rank", "backlog", "board", "agile", "story-points", "points", "estimate"],
    operationTypes: ["rest_api_internal", "work_item_query"],
    instructions: `Agile-managed fields are the most common silent failure in generated code. Ground truth:
- Sprint is NOT writable via api.updateIssue (the field is read-only), BUT sprint membership IS manageable from the sandbox: api.moveToSprint(sprintId) and api.moveToBacklog() call the Agile API for you. READING is fine too: the sprint custom field is an array (entries expose name and state).
- Rank is Lexorank — NEVER write the Rank custom field directly, but api.rankIssue(relativeToKey, opts?) performs the Lexorank reorder for you (it calls PUT /rest/agile/1.0/issue/rank internally). Use it instead of a field write.
- Epic membership / re-parenting differs between company-managed and team-managed projects and is not reliably writable here — reading issue.fields.parent is safe; treat re-parenting as unavailable.
- Story points ARE writable: it is an ordinary custom NUMBER field (commonly customfield_10016, but the id is instance-specific — use the field configured for this step). Write a JSON number: { customfield_10016: 5 } — never "5".
- JQL CAN filter agile concepts even where writes cannot change them: sprint in openSprints(), sprint is EMPTY, "Epic Link" = PROJ-100 (company-managed) or parent = PROJ-100 (newer hierarchy).
Sprint moves (api.moveToSprint/moveToBacklog) and re-ranking (api.rankIssue) ARE available — use them directly. The genuine limit is EPIC re-parenting (differs by project type): do the writable part, add a comment naming the endpoint a full implementation would need, and api.log the intended change so a human or external automation can act on it.`,
    examples: `// Asked: "move this to the active sprint and set story points to 5"
const key = api.context.issueKey;
const issue = await api.getIssue(key);
// Story points: an ordinary number custom field — writable (JSON number, never a string)
await api.updateIssue(key, { customfield_10016: 5 });
api.log("Story points set to 5");
// Sprint move: NOT possible via updateIssue — would need the Jira Agile API:
//   POST /rest/agile/1.0/sprint/{sprintId}/issue  (unavailable in this sandbox)
const sprints = issue.fields.customfield_10020; // sprint field: read-only array here, id is instance-specific
api.log("Current sprint field value:", sprints || "none");
const labels = Array.from(new Set([...(issue.fields.labels || []), "sprint-move-requested"]));
await api.updateIssue(key, { labels });
api.log("NOTE: sandbox cannot move issues between sprints — flagged with 'sprint-move-requested' instead.");
return { storyPoints: 5, sprintMoved: false };`,
  },
];
