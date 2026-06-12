/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * Jira REST API v3 endpoints available from Forge.
 * Each entry includes method, path, description, parameters, body template, and notes.
 *
 * SINGLE SOURCE OF TRUTH — consumed by:
 *   - the Custom UI endpoint picker (static/config-ui + static/admin-panel, via re-export shim)
 *   - the backend AI prompts (suggestEndpoint + generatePostFunctionCode via buildEndpointPromptBlock)
 *
 * Keep dependency-free so it bundles into both the Forge backend and the frontends.
 */

const JIRA_ENDPOINTS = [
  // === Issues ===
  { category: "Issues", method: "GET", path: "/rest/api/3/issue/{issueIdOrKey}",
    description: "Get issue details",
    params: "?fields=summary,status,assignee&expand=renderedFields,changelog",
    body: null,
    notes: "Use fields param to limit response size. expand=renderedFields gives HTML versions of rich text." },

  { category: "Issues", method: "PUT", path: "/rest/api/3/issue/{issueIdOrKey}",
    description: "Update issue fields",
    params: null,
    body: '{\n  "fields": {\n    "summary": "Updated summary",\n    "priority": { "name": "High" },\n    "labels": ["bug", "reviewed"],\n    "assignee": { "accountId": "user-account-id" }\n  }\n}',
    notes: "Use 'update' instead of 'fields' for add/remove operations (e.g., adding a label without replacing all). Cannot mix same field in both." },

  { category: "Issues", method: "PUT", path: "/rest/api/3/issue/{issueIdOrKey}",
    description: "Update issue with add/remove operations",
    params: null,
    body: '{\n  "update": {\n    "labels": [{ "add": "new-label" }],\n    "components": [{ "add": { "name": "Backend" } }]\n  }\n}',
    notes: "update.add/remove/set lets you modify array fields without fetching current state first." },

  { category: "Issues", method: "PUT", path: "/rest/api/3/issue/{issueIdOrKey}",
    description: "Update description (ADF format)",
    params: null,
    body: '{\n  "fields": {\n    "description": {\n      "type": "doc",\n      "version": 1,\n      "content": [\n        {\n          "type": "paragraph",\n          "content": [\n            { "type": "text", "text": "New description text" }\n          ]\n        }\n      ]\n    }\n  }\n}',
    notes: "Description requires ADF (Atlassian Document Format). Plain strings will fail with 400." },

  { category: "Issues", method: "POST", path: "/rest/api/3/issue",
    description: "Create a new issue",
    params: null,
    body: '{\n  "fields": {\n    "project": { "key": "PROJ" },\n    "summary": "New issue title",\n    "issuetype": { "name": "Task" },\n    "description": {\n      "type": "doc",\n      "version": 1,\n      "content": [\n        {\n          "type": "paragraph",\n          "content": [{ "type": "text", "text": "Issue description" }]\n        }\n      ]\n    },\n    "priority": { "name": "Medium" },\n    "assignee": { "accountId": "user-id" }\n  }\n}',
    notes: "project, summary, and issuetype are required. Returns {id, key, self}." },

  { category: "Issues", method: "POST", path: "/rest/api/3/issue",
    description: "Create a subtask",
    params: null,
    body: '{\n  "fields": {\n    "project": { "key": "PROJ" },\n    "parent": { "key": "PROJ-123" },\n    "summary": "Subtask title",\n    "issuetype": { "name": "Sub-task" }\n  }\n}',
    notes: "Subtasks need parent field. Issue type must be a subtask type." },

  { category: "Issues", method: "DELETE", path: "/rest/api/3/issue/{issueIdOrKey}",
    description: "Delete an issue",
    params: "?deleteSubtasks=true",
    body: null,
    notes: "Set deleteSubtasks=true if the issue has subtasks, otherwise 400." },

  { category: "Issues", method: "POST", path: "/rest/api/3/issue/bulk",
    description: "Create multiple issues in bulk",
    params: null,
    body: '{\n  "issueUpdates": [\n    {\n      "fields": {\n        "project": { "key": "PROJ" },\n        "summary": "Bulk issue 1",\n        "issuetype": { "name": "Task" }\n      }\n    },\n    {\n      "fields": {\n        "project": { "key": "PROJ" },\n        "summary": "Bulk issue 2",\n        "issuetype": { "name": "Task" }\n      }\n    }\n  ]\n}',
    notes: "Creates up to 50 issues per call. Returns array of {id, key} per issue." },

  // === Search ===
  // NOTE: the legacy POST /rest/api/3/search endpoint was shut down on 2025-10-31.
  // All JQL search goes through /rest/api/3/search/jql, which paginates with
  // nextPageToken and does NOT return a total count.
  { category: "Search", method: "POST", path: "/rest/api/3/search/jql",
    description: "Search issues by JQL",
    params: null,
    body: '{\n  "jql": "project = PROJ AND status = \\"To Do\\"",\n  "maxResults": 20,\n  "fields": ["summary", "status", "assignee", "priority"]\n}',
    notes: "Returns {issues: [...], nextPageToken?}. No total count — use issues.length; pass nextPageToken to get the next page. Max 100 results per call." },

  { category: "Search", method: "POST", path: "/rest/api/3/search/jql",
    description: "Search by assignee",
    params: null,
    body: '{\n  "jql": "assignee = \\"user-account-id\\" AND status != Done ORDER BY updated DESC",\n  "maxResults": 50,\n  "fields": ["summary", "status", "priority"]\n}',
    notes: "Use accountId (not username) for user references. ORDER BY supported." },

  { category: "Search", method: "POST", path: "/rest/api/3/search/jql",
    description: "Search by date range",
    params: null,
    body: '{\n  "jql": "project = PROJ AND created >= -7d ORDER BY created DESC",\n  "maxResults": 50,\n  "fields": ["summary", "status", "created"]\n}',
    notes: "Relative dates: -1d (yesterday), -7d (last week), startOfDay(), endOfWeek()." },

  { category: "Search", method: "POST", path: "/rest/api/3/search/jql",
    description: "Search by text content",
    params: null,
    body: '{\n  "jql": "project = PROJ AND text ~ \\"login error\\"",\n  "maxResults": 20,\n  "fields": ["summary", "status"]\n}',
    notes: "text ~ searches summary + description. Use summary ~ for summary only." },

  { category: "Search", method: "POST", path: "/rest/api/3/search/approximate-count",
    description: "Get approximate count of matching issues",
    params: null,
    body: '{\n  "jql": "project = PROJ AND status = \\"To Do\\""\n}',
    notes: "Returns {count: N}. Faster than full search when you only need the count." },

  // === Transitions ===
  { category: "Transitions", method: "GET", path: "/rest/api/3/issue/{issueIdOrKey}/transitions",
    description: "List available transitions for an issue",
    params: null,
    body: null,
    notes: "Returns {transitions: [{id, name, to: {name, id}}]}. Must call this first to get valid transition IDs." },

  { category: "Transitions", method: "POST", path: "/rest/api/3/issue/{issueIdOrKey}/transitions",
    description: "Execute a workflow transition",
    params: null,
    body: '{\n  "transition": { "id": "21" },\n  "fields": {\n    "resolution": { "name": "Done" }\n  },\n  "update": {\n    "comment": [{\n      "add": {\n        "body": {\n          "type": "doc",\n          "version": 1,\n          "content": [{\n            "type": "paragraph",\n            "content": [{ "type": "text", "text": "Transitioning via automation" }]\n          }]\n        }\n      }\n    }]\n  }\n}',
    notes: "Transition ID comes from GET transitions. Some transitions require fields (e.g., resolution). Comment is optional." },

  // === Comments ===
  { category: "Comments", method: "GET", path: "/rest/api/3/issue/{issueIdOrKey}/comment",
    description: "Get all comments on an issue",
    params: null,
    body: null,
    notes: "Returns {comments: [{id, author, body (ADF), created}]}." },

  { category: "Comments", method: "POST", path: "/rest/api/3/issue/{issueIdOrKey}/comment",
    description: "Add a comment to an issue",
    params: null,
    body: '{\n  "body": {\n    "type": "doc",\n    "version": 1,\n    "content": [\n      {\n        "type": "paragraph",\n        "content": [\n          { "type": "text", "text": "This is a comment" }\n        ]\n      }\n    ]\n  }\n}',
    notes: "Body must be ADF format. Returns the created comment with id and author." },

  { category: "Comments", method: "POST", path: "/rest/api/3/issue/{issueIdOrKey}/comment",
    description: "Add a comment with bold/links",
    params: null,
    body: '{\n  "body": {\n    "type": "doc",\n    "version": 1,\n    "content": [\n      {\n        "type": "paragraph",\n        "content": [\n          { "type": "text", "text": "Bold text", "marks": [{ "type": "strong" }] },\n          { "type": "text", "text": " and " },\n          { "type": "text", "text": "a link", "marks": [{ "type": "link", "attrs": { "href": "https://example.com" } }] }\n        ]\n      }\n    ]\n  }\n}',
    notes: "ADF marks: strong (bold), em (italic), code, link (with attrs.href), underline." },

  { category: "Comments", method: "PUT", path: "/rest/api/3/issue/{issueIdOrKey}/comment/{commentId}",
    description: "Update an existing comment",
    params: null,
    body: '{\n  "body": {\n    "type": "doc",\n    "version": 1,\n    "content": [\n      {\n        "type": "paragraph",\n        "content": [{ "type": "text", "text": "Updated comment text" }]\n      }\n    ]\n  }\n}',
    notes: "Need the commentId from GET comments. Replaces entire body." },

  { category: "Comments", method: "DELETE", path: "/rest/api/3/issue/{issueIdOrKey}/comment/{commentId}",
    description: "Delete a comment",
    params: null,
    body: null,
    notes: "Returns 204 No Content. Permanent deletion." },

  // === Issue Links ===
  { category: "Links", method: "POST", path: "/rest/api/3/issueLink",
    description: "Link two issues together",
    params: null,
    body: '{\n  "type": { "name": "Blocks" },\n  "outwardIssue": { "key": "PROJ-1" },\n  "inwardIssue": { "key": "PROJ-2" }\n}',
    notes: 'Link types: Blocks, Cloners, Duplicate, Relates. Outward "blocks" inward. Returns 201.' },

  { category: "Links", method: "POST", path: "/rest/api/3/issueLink",
    description: "Mark issue as duplicate",
    params: null,
    body: '{\n  "type": { "name": "Duplicate" },\n  "outwardIssue": { "key": "PROJ-1" },\n  "inwardIssue": { "key": "PROJ-2" }\n}',
    notes: "PROJ-1 duplicates PROJ-2. The inward issue is the 'original'." },

  { category: "Links", method: "DELETE", path: "/rest/api/3/issueLink/{issueLinkId}",
    description: "Remove a link between issues",
    params: null,
    body: null,
    notes: "Get linkId from issue.fields.issuelinks[].id. Returns 204." },

  { category: "Links", method: "POST", path: "/rest/api/3/issue/{issueIdOrKey}/remotelink",
    description: "Add an external link (URL)",
    params: null,
    body: '{\n  "object": {\n    "url": "https://github.com/org/repo/pull/42",\n    "title": "Pull Request #42",\n    "icon": {\n      "url16x16": "https://github.com/favicon.ico"\n    }\n  }\n}',
    notes: "Links to external systems (GitHub, Confluence, etc.). Icon is optional." },

  // === Worklogs ===
  { category: "Worklogs", method: "POST", path: "/rest/api/3/issue/{issueIdOrKey}/worklog",
    description: "Log work time on an issue",
    params: null,
    body: '{\n  "timeSpent": "2h 30m",\n  "started": "2025-04-12T09:00:00.000+0000",\n  "comment": {\n    "type": "doc",\n    "version": 1,\n    "content": [{\n      "type": "paragraph",\n      "content": [{ "type": "text", "text": "Worked on implementation" }]\n    }]\n  }\n}',
    notes: "timeSpent: '2h', '30m', '1d'. Alternative: timeSpentSeconds (integer). Comment is ADF and optional." },

  { category: "Worklogs", method: "GET", path: "/rest/api/3/issue/{issueIdOrKey}/worklog",
    description: "Get all worklogs for an issue",
    params: null,
    body: null,
    notes: "Returns {worklogs: [{id, author, timeSpent, started, comment}]}." },

  // === Watchers ===
  { category: "Watchers", method: "GET", path: "/rest/api/3/issue/{issueIdOrKey}/watchers",
    description: "Get watchers of an issue",
    params: null,
    body: null,
    notes: "Returns {watchCount, watchers: [{accountId, displayName}]}." },

  { category: "Watchers", method: "POST", path: "/rest/api/3/issue/{issueIdOrKey}/watchers",
    description: "Add a watcher to an issue",
    params: null,
    body: '"5f1234567890abcdef"',
    notes: "Body is just a quoted accountId string (not JSON object). Returns 204." },

  // === Issue Properties ===
  { category: "Properties", method: "GET", path: "/rest/api/3/issue/{issueIdOrKey}/properties",
    description: "List all properties on an issue",
    params: null,
    body: null,
    notes: "Returns {keys: [{key, self}]}. Properties store app-specific metadata on issues." },

  { category: "Properties", method: "PUT", path: "/rest/api/3/issue/{issueIdOrKey}/properties/{propertyKey}",
    description: "Set a property on an issue",
    params: null,
    body: '{\n  "processed": true,\n  "processedAt": "2025-04-12T10:00:00Z",\n  "syncId": "sync-abc-123"\n}',
    notes: "Store any JSON. Great for tracking automation state. Property key max 255 chars." },

  { category: "Properties", method: "DELETE", path: "/rest/api/3/issue/{issueIdOrKey}/properties/{propertyKey}",
    description: "Delete a property from an issue",
    params: null,
    body: null,
    notes: "Returns 204. Property is permanently removed." },

  // === Users ===
  { category: "Users", method: "GET", path: "/rest/api/3/myself",
    description: "Get current authenticated user",
    params: null,
    body: null,
    notes: "Returns {accountId, displayName, emailAddress, avatarUrls}." },

  { category: "Users", method: "GET", path: "/rest/api/3/user/search",
    description: "Search for users by name or email",
    params: "?query=john&maxResults=10",
    body: null,
    notes: "Returns array of {accountId, displayName, avatarUrls}." },

  // === Projects ===
  { category: "Projects", method: "GET", path: "/rest/api/3/project",
    description: "List all accessible projects",
    params: "?expand=description,lead",
    body: null,
    notes: "Returns array of {id, key, name, projectTypeKey}." },

  { category: "Projects", method: "GET", path: "/rest/api/3/project/{projectIdOrKey}",
    description: "Get project details",
    params: "?expand=description,lead,issueTypes",
    body: null,
    notes: "Returns full project with components, versions, issue types." },

  // === Fields ===
  { category: "Fields", method: "GET", path: "/rest/api/3/field",
    description: "List all fields in Jira",
    params: null,
    body: null,
    notes: "Returns array of {id, name, custom, schema}. Custom fields have id like customfield_10001." },

  { category: "Fields", method: "GET", path: "/rest/api/3/field/{fieldId}/option",
    description: "Get options for a select field",
    params: null,
    body: null,
    notes: "Works for select, multi-select, radio, checkbox field types." },

  // === Filters ===
  { category: "Filters", method: "POST", path: "/rest/api/3/filter",
    description: "Create a saved filter",
    params: null,
    body: '{\n  "name": "My automation filter",\n  "jql": "project = PROJ AND status = \\"In Progress\\"",\n  "description": "Created by CogniRunner"\n}',
    notes: "Returns {id, name, jql, owner}. Useful for creating reusable queries." },

  { category: "Filters", method: "GET", path: "/rest/api/3/filter/search",
    description: "Search for saved filters",
    params: "?filterName=automation&expand=jql",
    body: null,
    notes: "Returns {values: [{id, name, jql}]}." },
];

export const ENDPOINT_CATEGORIES = [...new Set(JIRA_ENDPOINTS.map((e) => e.category))];

/**
 * Compact endpoint catalog block for AI prompts.
 * Lines grouped by category: "METHOD path — description (notes)".
 * With includeBodies, each endpoint with a body template gets it appended in a
 * fenced json block (used by suggestEndpoint; codegen omits bodies for size).
 * Hard-trims at maxBytes with a truncation marker.
 */
export const buildEndpointPromptBlock = ({ categories, maxBytes = 6144, includeBodies = false } = {}) => {
  const wanted = categories ? new Set(categories) : null;
  const parts = [];
  for (const cat of ENDPOINT_CATEGORIES) {
    if (wanted && !wanted.has(cat)) continue;
    const entries = JIRA_ENDPOINTS.filter((e) => e.category === cat);
    if (!entries.length) continue;
    const lines = entries.map((e) => {
      let line = `- ${e.method} ${e.path}${e.params ? e.params : ""} — ${e.description}${e.notes ? ` (${e.notes})` : ""}`;
      if (includeBodies && e.body) {
        line += `\n  Body template:\n\`\`\`json\n${e.body}\n\`\`\``;
      }
      return line;
    });
    parts.push(`${cat.toUpperCase()}:\n${lines.join("\n")}`);
  }
  let block = parts.join("\n\n");
  if (block.length > maxBytes) {
    block = `${block.slice(0, maxBytes)}\n…[endpoint list truncated]`;
  }
  return block;
};

export default JIRA_ENDPOINTS;
