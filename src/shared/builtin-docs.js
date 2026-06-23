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
 * Content covers Jira Cloud REST v3 reality (payload shapes, error semantics,
 * rate limits) AND the static-PF sandbox surface. Wherever REST can do more
 * than the sandbox (comments, links, worklogs, sprints), the doc states the
 * REST fact and the honest sandbox fallback explicitly.
 *
 * The field matrix, JQL quick reference, and rules derive from the sandbox API
 * spec so they can never drift from the prompt/editor documentation.
 */

import { FIELD_TYPE_TABLE, SANDBOX_RULES, JQL_REFERENCE } from "./sandbox-api-spec.js";

export const DOC_SEED_VERSION = 2;

const fieldMatrix = FIELD_TYPE_TABLE.map(
  (r) => `${r.fieldType}\n  read:  ${r.read.replace(/`/g, "")}\n  write: ${r.write.replace(/`/g, "")}`,
).join("\n\n");

const jqlQuickRef = JQL_REFERENCE.map((r) => `${r.code}\n  ${r.doc}`).join("\n\n");

export const BUILTIN_DOCS = [
  {
    id: "builtin_doc_adf",
    title: "ADF Cookbook (Built-in)",
    category: "API Documentation",
    content: `Atlassian Document Format (ADF) — the required wire format for description, environment, comment bodies, worklog comments, and custom textarea fields on /rest/api/3. A plain string in these fields fails with a 400 (ADF schema mismatch). "version" MUST be exactly 1 — any other value is rejected with 400.

READING ADF
- getIssue returns description as an ALREADY-PARSED ADF object (a JSON tree, not a string — never JSON.parse it).
- REST only: GET /rest/api/3/issue/{key}?expand=renderedFields returns server-rendered HTML of ADF fields (renderedFields.description = "<p>...</p>") when readable text is needed without walking the tree.

ROOT DOCUMENT
{ "type": "doc", "version": 1, "content": [ ...block nodes... ] }

BLOCK NODES
Paragraph: { "type": "paragraph", "content": [{ "type": "text", "text": "Hello" }] }
Heading:   { "type": "heading", "attrs": { "level": 2 }, "content": [{ "type": "text", "text": "Title" }] }  — level must be 1-6; anything else is a 400
Bullets:   { "type": "bulletList", "content": [{ "type": "listItem", "content": [paragraph] }] }
Numbered:  { "type": "orderedList", "content": [{ "type": "listItem", "content": [paragraph] }] }
Code:      { "type": "codeBlock", "attrs": { "language": "javascript" }, "content": [{ "type": "text", "text": "const x = 1;" }] }  — unknown language renders plain, no error
Panel:     { "type": "panel", "attrs": { "panelType": "info" }, "content": [paragraph] }  (info|note|warning|error|success)
Quote:     { "type": "blockquote", "content": [paragraph] }
Rule:      { "type": "rule" }
List items contain BLOCK nodes — text inside a listItem must be wrapped in a paragraph, never placed directly.

TABLES
table > tableRow > tableHeader/tableCell > paragraph > text. Every cell wraps a paragraph:
{ "type": "table", "content": [
  { "type": "tableRow", "content": [
    { "type": "tableHeader", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Col" }] }] }
  ] }
] }
Tables are reliable in description fields but less reliable inside comment bodies — prefer paragraphs and lists in comments.

INLINE MARKS (live on text nodes ONLY — marks on any non-text node are rejected with 400)
Bold:      "marks": [{ "type": "strong" }]
Italic:    "marks": [{ "type": "em" }]
Code:      "marks": [{ "type": "code" }]
Underline: "marks": [{ "type": "underline" }]
Link:      "marks": [{ "type": "link", "attrs": { "href": "https://..." } }]
Markdown syntax inside a text node is NOT rendered — "**bold**" stays literal asterisks. Use marks.

INLINE NODES
Mention:   { "type": "mention", "attrs": { "id": "<accountId>", "text": "@Name" } } — id MUST be an accountId; a display name in id silently drops the mention.
Emoji:     { "type": "emoji", "attrs": { "shortName": ":white_check_mark:" } }
Date:      { "type": "date", "attrs": { "timestamp": "1735689600000" } }
HardBreak: { "type": "hardBreak" } — line break inside a paragraph.

FAILURE MODES (the usual 400 causes)
- Missing or wrong "version" (must be exactly 1).
- A plain string where an ADF object is required.
- "marks" placed on a non-text node.
- Heading level outside 1-6.
- Empty paragraphs without a "content" array render inconsistently — give every paragraph content or omit it.
- Nesting deeper than roughly 50 levels.

WRITING AND APPENDING
There is no patch endpoint for ADF — every write replaces the WHOLE field. To append: fetch the current value, push new block nodes onto its .content array, write the whole document back. Start from { "type": "doc", "version": 1, "content": [] } when the field is null.

EXTRACTING PLAIN TEXT
function adfToText(node) {
  if (!node) return "";
  if (node.type === "text") return node.text || "";
  if (node.content) return node.content.map(adfToText).join(node.type === "paragraph" ? "\\n" : "");
  return "";
}
For more fidelity, also emit a newline for hardBreak nodes and a blank line after paragraphs/headings.

GOLDEN RULES
- Every text node must live inside a block node — never at the document root.
- Build documents bottom-up: text node, then paragraph, then doc.
- When a target rich-text field already has content, append — do not overwrite unless asked.`,
  },
  {
    id: "builtin_doc_jql",
    title: "JQL Reference (Built-in)",
    category: "API Documentation",
    content: `JQL (Jira Query Language) reference for building correct, safe queries.

OPERATORS
=  !=  ~ (contains)  !~  >  <  >=  <=  IN  NOT IN  IS EMPTY  IS NOT EMPTY  WAS  CHANGED

FUNCTIONS
currentUser()  startOfDay()  endOfDay()  startOfWeek()  endOfWeek()  startOfMonth()  now()

COMMON PATTERNS
${jqlQuickRef}

IDENTITY RULES
- username and userkey are GONE from JQL (privacy changes). Compare users only by accountId or functions: assignee = "5b10ac8d82e05b22cc7d4ef5", assignee = currentUser().
- Display names and emails in user clauses fail or match nothing.

INJECTION-SAFE CONSTRUCTION
Never concatenate raw user input into JQL — a value like: x OR project = SECRET injects a clause. Quote and escape every dynamic value (backslashes first, then quotes):
function jqlQuote(v) {
  return '"' + String(v).replace(/\\\\/g, "\\\\\\\\").replace(/"/g, '\\\\"') + '"';
}
- Free-text matching: use the text operator with a quoted literal: text ~ "quoted literal".
- key IN (...) lists: validate each key against /^[A-Z][A-Z0-9_]+-\\d+$/ before joining.
- Safe dynamic query example (no string holes):
const jql = "project = " + projectKey + " AND summary ~ " + jqlQuote(summaryText) + " AND key != " + issue.key;
(projectKey/issue.key are safe ONLY because they come from api.context / validated key patterns — anything user-typed goes through jqlQuote or the key regex.)

DATES
- Relative: created >= -7d, duedate <= endOfWeek().
- Quoted date literals: updated >= "2026-01-01" or updated >= "2026-01-01 00:00" (also "yyyy/MM/dd"). ISO-8601 timestamps with the 'T' separator or 'Z' suffix (e.g. "2026-01-01T00:00:00.000Z") are REJECTED by the JQL parser with a 400.

BOUNDED QUERIES AND COUNTS
The current search endpoints reject unbounded queries — always include a narrowing clause (project, assignee, key list). A 400 means the JQL cannot be parsed; the error body usually pinpoints the offending clause.
Counting matches: POST /rest/api/3/search/approximate-count with body { "jql": "project = HSP" } → { "count": 153 } (bounded JQL required) — search responses themselves carry no total.

GOTCHAS
- Quote multi-word values: status = "In Progress".
- Escape double quotes in search text: summary ~ "login \\"error\\"".
- Labels are exact-match and never contain spaces: labels = "needs-review".
- ORDER BY goes last, and adding one (e.g. ORDER BY created DESC) makes paging and processing order deterministic.
- Fetching many KNOWN issues: one search with key IN ("PROJ-1", "PROJ-2") beats N individual issue fetches.
- Results from /search/jql have NO total count and paginate with nextPageToken.
- Idempotent creation guard: bake a unique label (e.g. idem-<key>) into created issues, then search labels = "idem-<key>" before creating again.

SANDBOX NOTE
api.searchJql(jql) returns at most 20 issues (with only summary, status, issuetype, priority, assignee), no total count, and a nextPageToken that only signals more pages exist — the sandbox cannot fetch further pages, so narrow the JQL instead of paginating.`,
  },
  {
    id: "builtin_doc_field_formats",
    title: "Field Format Matrix (Built-in)",
    category: "Field Mappings",
    content: `How to read and write every common Jira field type via the REST API / sandbox.

${fieldMatrix}

CUSTOM FIELD IDS
- NEVER hardcode customfield_XXXXX ids across instances — the same logical field has a different id per site (customfield_10015 on one site is customfield_10234 on another).
- REST integrations resolve ids at runtime: GET /rest/api/3/field lists every field with name, custom flag, and schema.type; GET /rest/api/3/field/search is the paginated variant.
- In the sandbox the field id comes from the user/config. When unsure of a value shape, read the issue first and mirror the existing value's shape.

SELECT-LIKE FIELDS
- Read custom selects at field.value; system fields (priority, status, resolution) expose field.name.
- Writing a plain string to a single-select or radio field fails with 400 — it must be { "value": "Yes" }.
- Option values are case-sensitive and must already exist on the field.

NUMBERS, DATES, USERS
- Number fields take a bare JSON number (10, never "10").
- Date fields take strictly "YYYY-MM-DD"; datetime custom fields require a numeric offset: "2025-12-31T15:00:00.000+0000".
- User fields take { "accountId": "..." } — never displayName or email.

APPEND SEMANTICS (fields vs update — REST only)
PUT /rest/api/3/issue/{key} accepts two sections: "fields" (plain set) and "update" (verb operations add/remove/set). A field may appear in ONE of them, not both — 400 "field conflict" otherwise. "update" appends to multi-value fields without read-modify-write:
{ "update": { "labels": [{ "add": "urgent" }, { "remove": "low-priority" }], "components": [{ "add": { "id": "10002" } }] } }
SANDBOX FALLBACK: api.updateIssue performs plain field sets only — to append a label, read issue.fields.labels, push the new label, and write the whole array back.

WRITE FLAGS (REST only)
- ?notifyUsers=false — without it every programmatic update emails all watchers (a 100-issue batch = 100 emails per watcher) — requires project-admin permission; callers without it get a 403 (retry without the flag).
- ?overrideScreenSecurity=true — without it, writing a field that exists on the issue type but is NOT on the edit screen fails with 400 "Field 'customfield_XXXXX' cannot be set". Requires admin-level auth.
- Success on PUT is 204 No Content — there is no response body to parse.

POST-WRITE VERIFICATION
A 204 does not guarantee the value stuck. An automation rule or workflow post-function may immediately re-change the field; some fields are effectively read-only in context; Jira normalizes formats (you wrote "2026-05-01" and a datetime-type field stored "2026-05-01T00:00:00.000+0000"); select fields echo back { self, value, id } objects, not the string sent. Re-read the written fields afterwards and compare expected vs actual, normalizing before the diff.

GENERAL
- A wrong value SHAPE is the most common cause of 400 errors on update.
- Build the fields payload config-driven: include only keys whose new value !== undefined.
- null clears most fields.
- Coalesce all changes to one issue into a single update call — never several sequential writes.`,
  },
  {
    id: "builtin_doc_sandbox",
    title: "Sandbox Limits & Gotchas (Built-in)",
    category: "Business Rules",
    content: `The static post-function sandbox: what runs, what doesn't.

API SURFACE — exactly five methods plus context:
api.getIssue(key), api.updateIssue(key, fields), api.searchJql(jql), api.transitionIssue(key, id), api.log(...args), api.context.issueKey
There is NO addComment, createIssue, linkIssues, logWork, sprint operations, or raw fetch. Calling an invented method throws at runtime.

SIGNATURES AND RETURNS
- api.getIssue(issueKey) → full issue object (issue.key; issue.fields.summary, .description as ADF, .status.name, .assignee?.accountId, .labels, .components, .fixVersions, .duedate, .resolution, .comment.comments, .issuelinks, .subtasks, .parent?.key, customfield_XXXXX...).
- api.updateIssue(issueKey, fieldsObject) → { success: true }. Plain field sets only — no add/remove verbs.
- api.searchJql(jqlQuery) → { issues: [...], nextPageToken?: string }. At most 20 results.
- api.transitionIssue(issueKey, transitionId) → { success: true }. transitionId is a number as a string; transitions CANNOT be looked up in the sandbox — if the user gives a transition name, the code must explain that the numeric id is required.
- api.log(...args) → void. Objects are JSON-serialized; output shows in test results and execution logs.
- api.context → { issueKey: string } only.

MISSING CAPABILITIES — HONEST FALLBACKS
- Comments: cannot be posted. Existing comments are readable at issue.fields.comment.comments. Surface information via api.log() or by appending an ADF paragraph to the description.
- Issue links: readable at issue.fields.issuelinks; cannot be created or deleted. Report intended links in the return value.
- Worklogs: cannot be written.
- Sprint / rank / board operations: the Jira Agile API is unreachable; the Sprint field is read-only here.
- Creating or deleting issues: not possible.
- No fetch, no require, no file I/O, no browser APIs.

EXECUTION
- Runs AFTER the workflow transition succeeds; errors never block the transition.
- Whole chain shares a ~22 second budget; each step gets a slice. Keep API calls per step minimal.
- Steps run in order; a step's return value is available to later steps under its Result Variable name.
- Test runs are always dry-run: reads hit real Jira data, writes (updateIssue / transitionIssue) are logged but not executed.

TIME-BUDGET GUARD (use in any loop over search results — each step is hard-capped at ~15s of the ~22s chain budget)
const deadline = Date.now() + 15000;
for (const item of results.issues) {
  if (Date.now() > deadline) { api.log("Time budget reached, stopping early"); break; }
  // ...work...
}

LOOP HYGIENE
- Coalesce every field change for one issue into ONE updateIssue call.
- Never run writes to the same issue in parallel; parallelize only independent reads.
- Collect per-item failures ({ issueKey, error }) and continue — do not throw from inside a batch.
- Truncate long strings before logging or returning (e.g. summary.slice(0, 80)).

RULES THAT PREVENT RUNTIME FAILURES
${SANDBOX_RULES.map((r) => `- ${r.replace(/`/g, "")}`).join("\n")}

SEARCH
- searchJql returns at most 20 issues with summary, status, issuetype, priority, assignee.
- No total count — use issues.length; nextPageToken only signals that more pages exist (further pages cannot be fetched here — narrow the JQL instead).`,
  },
  {
    id: "builtin_doc_search",
    title: "Search & Pagination Semantics (Built-in)",
    category: "API Documentation",
    content: `Modern Jira Cloud search and the three coexisting pagination styles.

THE MODERN SEARCH ENDPOINT
- The old /rest/api/3/search endpoint (both GET and POST) was REMOVED and returns HTTP 410. Use POST /rest/api/3/search/jql.
- Body: { "jql": "project = PROJ AND status != Done", "fields": ["summary", "status"], "maxResults": 100, "nextPageToken": null }
- Pagination is CURSOR-based via nextPageToken — NOT startAt. Code that sends startAt silently gets only the first page.
- maxResults above ~100 is silently capped when fields are requested (up to 5000 only when requesting id/key alone) — treat 100 as the per-page cap.
- Response: { "issues": [...], "nextPageToken": "..." } — nextPageToken is absent/null on the last page. There is NO reliable total.
- Unbounded JQL (no project/assignee-style clause) is rejected; 400 = JQL cannot be parsed.
- Other body params: fieldsByKeys (bool, default false), expand ("names,schema,renderedFields,transitions,changelog"), properties (max 5 issue properties), reconcileIssues (max 50 issue ids — forces read-after-write consistency on the eventually-consistent search index). failFast exists only on the GET variant as a query parameter — it is NOT a POST body param.

PAGINATE-ALL PATTERN
let token = null;
do {
  const body = { jql: "project = PROJ AND updated >= -30d", fields: ["summary", "status"], maxResults: 100 };
  if (token) body.nextPageToken = token;
  const page = await postSearchJql(body); // POST /rest/api/3/search/jql
  // ...consume page.issues...
  token = page.nextPageToken || null;
} while (token);

COUNTS
Search responses have no total. Use POST /rest/api/3/search/approximate-count with body { "jql": "project = HSP" } → { "count": 153 }. The response key is "count". The JQL must be bounded.

BULK FETCH BY KEYS
POST /rest/api/3/issue/bulkfetch body { "issueIdsOrKeys": ["PROJ-1", "PROJ-2"], "fields": ["summary"] } → { "issues": [...] }; max 100 keys per request. Use bulkfetch when you HAVE keys, /search/jql when you have a query — both beat N single GETs.

SINGLE ISSUE READS
GET /rest/api/3/issue/{issueIdOrKey}?fields=summary,status,customfield_10015 — always pass fields= (smaller payloads, faster responses). expand= comma list: transitions, changelog, renderedFields, names, schema, operations, editmeta, versionedRepresentations. renderedFields returns HTML renderings of ADF fields; names maps field ids to display names; schema gives per-field type info. Prefer ONE GET with several expands over separate calls. 404 means the issue does not exist OR is not visible to the caller — indistinguishable.

THREE PAGINATION STYLES — know which an endpoint uses
1. Cursor (nextPageToken): most notably POST/GET /rest/api/3/search/jql (other v3 endpoints use it too, e.g. /workflow/{id}/projectUsages). Loop until the token is absent; no total available.
2. Offset (startAt/maxResults; response includes total and often isLast): nearly everything else — /project/search, /workflows/search, /issue/{key}/changelog, /group/member, agile /board/{id}/issue, scheme endpoints. Common caps: 50 default / 100 max. The array key VARIES: "values" (admin/config endpoints, changelog), "issues", "comments", "users" — never assume "values".
3. Plain arrays with no pagination: /field, /priority, /resolution, /issue/{key}/remotelink, project components/versions lists.

CHANGELOG
GET /rest/api/3/issue/{key}/changelog → { "values": [{ "id", "author": { "accountId", "displayName" }, "created", "items": [{ "field", "fieldId", "fieldtype", "from", "to", "fromString", "toString" }] }] }
- from/to hold raw ids (status id, accountId — null when unset); fromString/toString hold display values.
- expand=changelog on GET /issue inlines it as changelog.histories (the key is "histories").
- Status-change detection: items where field === "status"; compare fromString/toString.

SANDBOX NOTE
api.searchJql(jql) wraps POST /rest/api/3/search/jql: max 20 results carrying only summary, status, issuetype, priority, assignee; no total (use issues.length); the nextPageToken cannot be passed back — narrow the JQL (project clause, date window, ORDER BY) instead of paginating.`,
  },
  {
    id: "builtin_doc_errors",
    title: "REST Error Decoding & Rate Limits (Built-in)",
    category: "API Documentation",
    content: `How to read Jira Cloud REST errors and survive rate limits.

ERROR ENVELOPE
Two JSON shapes, often both present:
- "errorMessages": ["human sentence"] — general failures.
- "errors": { "fieldName": "field-specific message" } — keyed by the offending field, e.g. { "errors": { "customfield_10015": "Field 'customfield_10015' cannot be set. It is not on the appropriate screen, or unknown." } }
Some 5xx responses return plain HTML, not JSON — parse defensively: try response.json(), fall back to response.text().
Unified extraction:
const msg = payload?.errorMessages?.[0] ?? Object.values(payload?.errors ?? {})[0] ?? text.slice(0, 200);

SUCCESS CODES FIRST
201 = created (issue, comment, link). 204 No Content = success for most PUT/DELETE/transition/vote calls — there is NO body; calling .json() on a 204 throws. Always check status before parsing.

STATUS DECODING
400 — invalid field value/format, missing required field, invalid ADF (wrong version, marks on non-text, bad heading level), unparseable JQL, "field conflict" (same field in both the fields and update sections), or field-not-on-screen ("cannot be set" — add the field to the screen or use ?overrideScreenSecurity=true, which needs admin-level auth). Fix the payload; never retry as-is.
401 — token missing/expired/revoked. Refresh credentials and retry once.
403 — missing scope or project permission. Log and skip — retrying cannot succeed.
404 — resource does not exist OR is invisible to the caller (private project, security level). Indistinguishable.
409 — stale version, duplicate unique value, or a concurrent workflow update in progress. Re-read and retry.
410 — endpoint removed (notably the old /rest/api/3/search). Migrate the call; do not retry.
413 — per-issue entity limit breached (comments/attachments) or oversized body.
429 — rate limited (see below).
5xx — Atlassian-side transient (includes circuit-breaker errors). Retry with backoff.

RETRY POLICY
Honor Retry-After first. Otherwise exponential backoff: base 1-2s, x2 per attempt, cap 30s, jitter multiplier 0.7-1.3, max 4 attempts. Retry ONLY 429 and 5xx. Never retry other 4xx — they indicate a payload bug; fix the request instead.

RATE LIMITS (points model)
Each request costs 1 base point + 1 point per object returned on reads (a single-issue GET = 2 points; identity reads cost 1 + 2 per user); ALL writes cost exactly 1 point. Default global pool: 65,000 points/hour (tenant tiers raise it, capped at 500k).
Three distinct 429 regimes, distinguished by the RateLimit-Reason header:
- jira-per-issue-on-write — per-issue write caps: 20 writes/2s and 100 writes/30s to ONE issue. Add ~250ms between writes to the same issue.
- jira-burst-based — per-second method caps: GET/POST 100/s, PUT/DELETE 50/s.
- jira-quota-global-based / jira-quota-tenant-based — hourly points exhausted; wait for the window reset.
Headers: Beta-RateLimit-Policy: "global-app-quota";q=65000;w=3600 (q=quota, w=window seconds); Beta-RateLimit: "global-app-quota";r=11000;t=600 (r=remaining, t=seconds to reset); X-RateLimit-NearLimit: true is a proactive slow-down signal. 429 responses carry a Retry-After header in seconds.

WRITE-PACING RECIPE
Chunks of 10 issues, ~4 writes/second (250ms intra-chunk sleep), 2s pause between chunks; abort if more than 5% of requests come back 429. Coalesce all field changes for one issue into ONE PUT. Always pass fields= (smaller payloads, faster responses) and bundle expands into one GET — fewer requests means fewer rate-limit points.

SANDBOX NOTE
Errors thrown by api.* calls surface in test results and execution logs — wrap risky operations in try/catch and api.log() the message. Keep retries minimal (the whole chain shares ~22 seconds), retry only transient failures, and never retry a 400-class error: fix the payload shape instead.`,
  },
  {
    id: "builtin_doc_transitions",
    title: "Transitions & Resolutions (Built-in)",
    category: "API Documentation",
    content: `Moving issues through workflows. Status is NOT a writable field — writing fields.status via an update fails. Transitions are the only way.

DISCOVERY (REST)
GET /rest/api/3/issue/{key}/transitions → { "transitions": [{ "id": "31", "name": "Done", "to": { ...status... } }] }
- Returns ONLY transitions valid from the issue's current status for the calling user (conditions applied).
- Transition ids are workflow-specific strings. NEVER hardcode them across projects — match by transition name or by to.name, then use the discovered id.
- Transition ids can change when a workflow is edited or replaced — never treat them as stable foreign keys.
- GET /rest/api/3/issue/{key}?expand=transitions inlines the same list with the issue — one read instead of two.

EXECUTION (REST)
POST /rest/api/3/issue/{key}/transitions body { "transition": { "id": "31" } } → 204 No Content (empty body — do not parse JSON).

FIELDS DURING A TRANSITION
Only fields present on that transition's screen can be set in the same call:
{ "transition": { "id": "5" }, "fields": { "resolution": { "name": "Done" } } }
Resolution is the canonical case — it is typically settable ONLY during a transition, not via a normal update.
Adding a comment during a transition uses the update-verb form:
{ "transition": { "id": "5" }, "update": { "comment": [{ "add": { "body": { ...ADF doc... } } }] } }
Do not put a raw ADF doc under fields.comment — that form is unreliable.

RESOLUTIONS
GET /rest/api/3/resolution → [{ "id": "10000", "name": "Done" }, { "id": "10001", "name": "Won't Do" }]

WORKFLOW DEFINITIONS (admin reads)
GET /rest/api/3/workflows/search?expand=values.transitions — each transition: { id, name, type: "INITIAL" | "GLOBAL" | "DIRECTED", links: [{ fromStatusReference, toStatusReference }], toStatusReference, validators[], conditions, actions[] }. Types (UPPERCASE): INITIAL (create), DIRECTED (specific from->to), GLOBAL (from any status). Statuses are referenced by statusReference ids in links[]/toStatusReference — there are NO bare from/to status-id props. The search is fuzzy/partial-match — filter by exact workflow name in code.

BULK TRANSITIONS
POST /rest/api/3/bulk/issues/transition exists for mass moves; long-running bulk tasks are polled via GET /rest/api/3/bulk/queue/{taskId} → { "status", "progressPercent", "totalIssueCount", "processedAccessibleIssues": [ids], "failedAccessibleIssues": [ids] }. Payload shapes vary across API revisions — when reliability matters, chunked per-issue transition POSTs with pacing are the safe pattern.

SANDBOX REALITY
- api.transitionIssue(issueKey, transitionId) is the ONLY transition operation. transitionId is a number as a string (e.g. "31").
- Transitions CANNOT be looked up in the sandbox — there is no list-transitions call. If the user provides a transition name, generate code with a clearly named constant and a comment explaining the numeric id must come from the workflow editor.
- Fields cannot be set during a sandbox transition. Set writable fields with api.updateIssue BEFORE transitioning; resolution usually cannot be set that way (transition-screen-only) — tell the user when their request needs it.
- Post-functions run AFTER the original transition succeeds; a failed api.transitionIssue never rolls back the user's transition.`,
  },
  {
    id: "builtin_doc_users",
    title: "Users, accountId & Permissions (Built-in)",
    category: "API Documentation",
    content: `Jira Cloud identity discipline: accountId is the ONLY valid user identifier — in REST params, JQL, field writes, and ADF mentions. username and userKey are dead everywhere.

USER LOOKUP (REST)
- GET /rest/api/3/user?accountId=... (accountId required; expand=groups,applicationRoles) → { "accountId", "accountType": "atlassian", "active", "displayName", "emailAddress", "timeZone", "avatarUrls" }.
- emailAddress may be ABSENT due to user privacy settings — never key logic on email.
- GET /rest/api/3/user/search?query=... matches display name/email; requires Browse users permission (403 otherwise). GET /rest/api/3/users/search (plural) is the simple list variant; GET /rest/api/3/user/search/query takes structured queries.
- GET /rest/api/3/user/picker?query=... for autocomplete; GET /rest/api/3/groupuserpicker searches users and groups together.
- Bulk: GET /rest/api/3/user/bulk?accountId=...&accountId=... (repeated query param, paginated values[]).
- GET /rest/api/3/myself → the current auth identity; the canonical auth smoke test.
- In changelogs, user-field changes (e.g. assignee) carry accountIds in from/to and display names in fromString/toString.

ASSIGNABILITY IS NOT EXISTENCE
A user existing does not mean they can be assigned. GET /rest/api/3/user/assignable/search?projectKey=PROJ&query=... returns only users assignable in that project — check it before writing assignee to avoid a 400.

WRITING USER FIELDS
{ "assignee": { "accountId": "5b10ac8d82e05b22cc7d4ef5" } } — same shape for reporter and user-picker custom fields. null unassigns. ADF mentions take the accountId in attrs.id; a display name there silently drops the mention.

GROUPS
- GET /rest/api/3/group/member?groupname=X → paginated values[].
- Add member: POST /rest/api/3/group/user?groupname=X with body { "accountId": "..." }. Remove: DELETE /rest/api/3/group/user?groupname=X&accountId=<accountId>.

PERMISSION CHECKS
GET /rest/api/3/mypermissions?permissions=BROWSE_PROJECTS,CREATE_ISSUES — the permissions= list is REQUIRED; names are SCREAMING_SNAKE (BROWSE_PROJECTS, CREATE_ISSUES, ...). Each returned permission entry carries its own boolean flag — check the per-permission entry, not just HTTP 200. POST /rest/api/3/permissions/check evaluates permissions for another user.

VOTES AND WATCHERS (brief)
- Votes: POST /rest/api/3/issue/{key}/votes adds the CALLER's own vote (204, no body); DELETE removes it. Voting on behalf of others is impossible.
- Watchers: GET /rest/api/3/issue/{key}/watchers → { "isWatching", "watchCount", "watchers": [...] }. Add: POST with the bare JSON-quoted accountId string as the body ("5b10ac8d82e05b22cc7d4ef5" including quotes). Remove: DELETE with ?accountId=... as a query param.

SANDBOX REALITY
User-directory endpoints are unreachable from the sandbox. Obtain accountIds from issue data instead: issue.fields.assignee?.accountId (assignee can be null — always guard), issue.fields.reporter.accountId, comment authors at issue.fields.comment.comments[].author, and searchJql results' assignee. Write user fields as { accountId: "..." } — never displayName or emailAddress.`,
  },
  {
    id: "builtin_doc_agile",
    title: "Agile Fields: Sprint, Story Points, Rank (Built-in)",
    category: "Field Mappings",
    content: `Agile (Jira Software) data lives partly in custom fields and partly behind a separate API. Knowing which is which prevents impossible writes.

THE AGILE API IS SEPARATE
Agile endpoints live under /rest/agile/1.0/ (NOT /rest/api/3) and use OFFSET pagination (startAt + maxResults + total in the response) — not nextPageToken. Mixing the two styles is a silent bug: nextPageToken does nothing on agile endpoints, and startAt does nothing on /rest/api/3/search/jql. Forge scopes differ too: read:board-scope:jira-software for board reads, write:issue:jira-software for ranking.

SPRINT
- Reads as an ARRAY on a custom field (the field id is instance-specific).
- NOT writable via PUT /rest/api/3/issue or api.updateIssue — sprint membership is managed through the Jira Agile API, not a field write. In the sandbox the Sprint field is strictly read-only; tell the user when a request needs sprint moves.

STORY POINTS
- A number custom field — commonly customfield_10016, but the id is instance-specific; resolve it by name via GET /rest/api/3/field before writing.
- Write a bare JSON number: { "customfield_10016": 5 } — never the string "5".

START DATE
- A date custom field (commonly customfield_10015, instance-specific). Write strictly "YYYY-MM-DD" — never a datetime.

RANK (Lexorank)
- NEVER write the Rank custom field directly — ranking goes through the Agile API:
PUT /rest/agile/1.0/issue/rank body { "issues": ["PROJ-5", "PROJ-6"], "rankBeforeIssue": "PROJ-1" } (or "rankAfterIssue": "PROJ-9" — exactly ONE anchor).
- Unreachable from the sandbox.

RESOLVING AGILE FIELD IDS
Sprint, story points, and start date are ordinary custom fields with per-instance ids. REST integrations resolve them by name via GET /rest/api/3/field (entries carry name, custom flag, schema.type) or map ids to display names with expand=names on GET /issue. Never copy a customfield id from one site to another.

BOARD ISSUES (offset pagination)
GET /rest/agile/1.0/board/{boardId}/issue?startAt=0&maxResults=100&fields=summary,status → { "issues": [...], "total" }.
let startAt = 0, total = Infinity;
const all = [];
while (all.length < total) {
  const page = await getBoardIssues(boardId, startAt, 100); // GET .../board/{id}/issue
  all.push(...page.issues);
  total = page.total;
  startAt += 100;
  if (page.issues.length === 0) break;
}

PARENT AND HIERARCHY
- issue.fields.parent?.key gives the parent (undefined when none); issue.fields.subtasks lists subtask keys plus summary/status.
- Epic-link write shapes differ by instance and project type (company-managed reports style "classic" vs team-managed in /rest/api/3/project/search results) and are not covered here — verify on the target instance before generating epic writes.

SANDBOX REALITY
Only the five api methods exist — the Agile API cannot be called. Possible: read sprint / story points / parent via api.getIssue; write story points and date fields via api.updateIssue with the shapes above. Impossible: sprint moves, ranking, board operations — say so plainly instead of inventing calls.`,
  },
  {
    id: "builtin_doc_collab",
    title: "Comments, Issue Links & Worklogs (Built-in)",
    category: "API Documentation",
    content: `REST payloads for the collaboration sub-resources — plus what the sandbox can honestly do instead.

COMMENTS (REST)
- Create: POST /rest/api/3/issue/{key}/comment body { "body": { ...ADF doc... } } → 201 with { "id", "author": { "accountId", "displayName" }, "body", "created" }. The body is ALWAYS an ADF document — never a plain string.
- Restrict visibility: add { "visibility": { "type": "group" | "role", "value": "<group or role name>" } }.
- List: GET same path → paginated { "comments": [...], "startAt", "maxResults", "total" }. Edit: PUT .../comment/{id}. Delete: DELETE .../comment/{id}. Cross-issue: POST /rest/api/3/comment/list with body { "ids": [10001, 10002] }.
- 413 = per-issue comment limit reached.
- Comment properties (app metadata invisible in the UI): PUT/GET/DELETE /rest/api/3/comment/{commentId}/properties/{propertyKey} with arbitrary JSON, e.g. { "processed_by_app": true, "sync_id": "sync-abc-123" }.
- Dedup guard before bot comments: read the most recent comment(s) and skip when an own marker string was posted within 24h.
- Timestamps look like "2024-01-01T12:00:00.000+0000".
SANDBOX FALLBACK: There is NO api.addComment. Comments are read-only at issue.fields.comment.comments ([{ body: ADF, author, created }]). To surface information, api.log() it or append an ADF paragraph to the description.

ISSUE LINKS (REST)
- Create: POST /rest/api/3/issueLink body { "type": { "name": "Blocks" }, "inwardIssue": { "key": "A" }, "outwardIssue": { "key": "B" } } → 201 with an EMPTY body — the API returns nothing on link creation; to get the link id, re-read either issue with ?fields=issuelinks (the same lookup the delete flow below uses).
- Direction is counter-intuitive — the link reads: inwardIssue <outward-description> outwardIssue. For "A blocks B": inwardIssue = A (the blocker), outwardIssue = B (the blocked issue). Verify the direction once in the target UI after the first link — it is the most common linking bug.
- Reading issue X's fields.issuelinks: each entry has type { name, inward: "is blocked by", outward: "blocks" } plus EXACTLY ONE of inwardIssue/outwardIssue (the other party). inwardIssue present → that issue does the action TO X (it blocks X — predecessor). outwardIssue present → X does the action to it (X blocks it — successor). Always filter by link.type?.name — issuelinks mixes all link types.
- Delete needs the numeric link id: GET /rest/api/3/issue/{key}?fields=issuelinks, find the entry matching type + other key (check both directions), then DELETE /rest/api/3/issueLink/{linkId} → 204, empty body.
- Default link types (name / inward / outward): Blocks / is blocked by / blocks; Cloners / is cloned by / clones; Duplicate / is duplicated by / duplicates; Relates / relates to / relates to.
- Remote (web) links: POST /rest/api/3/issue/{key}/remotelink body { "object": { "url": "https://...", "title": "Display title" } } — object.url and object.title required; optional icon is { "icon": { "url16x16": "..." } } (the Icon schema has url16x16/title/link — no "url" property). List: GET same path (plain array). Delete: DELETE .../remotelink/{linkId}.
SANDBOX FALLBACK: There is NO api.linkIssues. Links are readable via api.getIssue at issue.fields.issuelinks; creating or deleting them is impossible — report intended links via api.log() or the step's return value.

WORKLOGS (REST)
- Create: POST /rest/api/3/issue/{key}/worklog. Time spent: EITHER "timeSpentSeconds": 3600 (integer seconds) OR "timeSpent": "2h 30m" (duration string) — provide one. "started": "2023-10-27T10:00:00.000+0000" — Jira timestamp with a numeric offset, NOT a bare ISO "Z". "comment" is an ADF doc.
- Read: GET same path returns the worklog entries: { "id", "author": { "accountId", "displayName" }, "timeSpentSeconds", "started", "comment": ADF }.
- Move between issues: POST /rest/api/3/issue/{key}/worklog/move body { "ids": [10101], "issueIdOrKey": "PROJ-456" } — an ARRAY of integer worklog ids plus the destination (experimental; max 5000 ids; moved worklogs trigger no notifications and write no history).
- Worklog properties: PUT/GET/DELETE /rest/api/3/issue/{key}/worklog/{worklogId}/properties/{propertyKey}.
- 400 = malformed time format. Time tracking must be enabled instance-wide: GET /rest/api/3/configuration → timeTrackingEnabled plus timeTrackingConfiguration { defaultUnit, timeFormat, workingDaysPerWeek: 5.0, workingHoursPerDay: 8.0 } — these settings change how "1d" parses.
SANDBOX FALLBACK: There is NO api.logWork — worklogs cannot be written from the sandbox; tell the user instead of inventing a method.

ISSUE PROPERTIES (hidden state for automations)
Arbitrary JSON on an issue, invisible in the UI — ideal for processed-flags and sync ids instead of polluting visible fields: GET /rest/api/3/issue/{key}/properties (list keys); GET/PUT/DELETE /rest/api/3/issue/{key}/properties/{propertyKey} (PUT body = the raw JSON value). Bulk: POST /rest/api/3/issue/properties/multi body { "issues": [{ "issueID": 10001, "properties": { "external-id": "ext-999", "status": "synced" } }] } (issueID is numeric; up to 10 properties per issue, up to 100 issues per request; the call is async — Jira returns a task to poll). Unreachable from the sandbox.`,
  },
];
