/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * SINGLE SOURCE OF TRUTH for the actions an AI-agent Listener / Scheduled Job may
 * take. Each action is one tool the model can call; the backend (src/agent-runner.js)
 * maps it onto the sandbox api.* surface (same simulation mode, kill switch and
 * change ledger as code steps). The admin UI renders this list as the
 * "Allowed actions" checklist, and the REST API validates `agent.allowedActions`
 * against it. Dependency-free — bundles into backend and frontends.
 *
 * kind "read" actions never write to Jira; "write" actions do. `finish` is always
 * available and ends the run with a summary.
 */

const P = (properties, required) => ({ type: "object", properties, required, additionalProperties: false });
const KEY = { type: "string", description: "Issue key, e.g. PROJ-123. Omit to use the current issue." };

export const AGENT_ACTIONS = [
  {
    id: "get_issue", kind: "read", label: "Read an issue",
    description: "Fetch an issue (summary, status, type, priority, people, labels, description text, last comments, non-empty custom fields).",
    parameters: P({ issueKey: KEY }, []),
  },
  {
    id: "search_issues", kind: "read", label: "Search issues (JQL)",
    description: "Run a JQL search. Returns up to maxResults (≤50) issues with key, summary, status, type, priority, assignee, updated.",
    parameters: P({ jql: { type: "string", description: "JQL query" }, maxResults: { type: "integer", description: "1-50, default 20" } }, ["jql"]),
  },
  {
    id: "add_comment", kind: "write", label: "Add a comment",
    description: "Post a comment on an issue. Plain text; paragraphs separated by blank lines.",
    parameters: P({ issueKey: KEY, text: { type: "string", description: "Comment text" }, internal: { type: "boolean", description: "JSM: true = internal note (not visible to customers)" } }, ["text"]),
  },
  {
    id: "update_fields", kind: "write", label: "Update fields",
    description: "Set one or more fields on an issue. Use Jira REST field formats: { summary: 'x' }, { priority: { name: 'High' } }, { duedate: 'YYYY-MM-DD' }, { customfield_10010: 'value' }, { assignee: { accountId: '...' } }.",
    parameters: P({ issueKey: KEY, fields: { type: "object", description: "Field id → value map in Jira REST format", additionalProperties: true } }, ["fields"]),
  },
  {
    id: "add_labels", kind: "write", label: "Add labels",
    description: "Add labels to an issue (existing labels are kept).",
    parameters: P({ issueKey: KEY, labels: { type: "array", items: { type: "string" }, description: "Labels to add (no spaces)" } }, ["labels"]),
  },
  {
    id: "remove_labels", kind: "write", label: "Remove labels",
    description: "Remove labels from an issue.",
    parameters: P({ issueKey: KEY, labels: { type: "array", items: { type: "string" } } }, ["labels"]),
  },
  {
    id: "set_assignee", kind: "write", label: "Assign / unassign",
    description: "Assign an issue to a user by accountId, or unassign it.",
    parameters: P({ issueKey: KEY, accountId: { type: "string", description: "Atlassian accountId, or 'unassigned'" } }, ["accountId"]),
  },
  {
    id: "transition_issue", kind: "write", label: "Transition (by name)",
    description: "Move an issue through a workflow transition by its name (e.g. 'Done', 'Start progress'). Optionally set the resolution.",
    parameters: P({ issueKey: KEY, transitionName: { type: "string" }, resolution: { type: "string", description: "Resolution name, when the transition screen requires one" } }, ["transitionName"]),
  },
  {
    id: "create_issue", kind: "write", label: "Create an issue",
    description: "Create a new issue (or sub-task when parentKey is given).",
    parameters: P({
      projectKey: { type: "string" }, issueType: { type: "string", description: "Issue type name, e.g. Task, Bug, Sub-task" },
      summary: { type: "string" }, description: { type: "string", description: "Plain-text description" },
      parentKey: { type: "string", description: "Parent issue key for sub-tasks / child issues" },
      labels: { type: "array", items: { type: "string" } }, priority: { type: "string", description: "Priority name" },
    }, ["projectKey", "issueType", "summary"]),
  },
  {
    id: "link_issues", kind: "write", label: "Link issues",
    description: "Create an issue link from the issue to another issue (link type name e.g. Relates, Blocks, Duplicate).",
    parameters: P({ issueKey: KEY, otherIssueKey: { type: "string" }, linkType: { type: "string", description: "Link type name, default Relates" } }, ["otherIssueKey"]),
  },
  {
    id: "add_watcher", kind: "write", label: "Add a watcher",
    description: "Add a user (accountId) as a watcher of an issue.",
    parameters: P({ issueKey: KEY, accountId: { type: "string" } }, ["accountId"]),
  },
  {
    id: "send_notification", kind: "write", label: "Send a notification email",
    description: "Send a Jira notification email about an issue to its assignee/reporter/watchers.",
    parameters: P({ issueKey: KEY, subject: { type: "string" }, body: { type: "string" }, toAssignee: { type: "boolean" }, toReporter: { type: "boolean" }, toWatchers: { type: "boolean" } }, ["subject", "body"]),
  },
  {
    id: "add_worklog", kind: "write", label: "Log work",
    description: "Log time on an issue.",
    parameters: P({ issueKey: KEY, timeSpentSeconds: { type: "integer" }, comment: { type: "string" } }, ["timeSpentSeconds"]),
  },
  {
    id: "finish", kind: "control", label: "Finish", always: true,
    description: "End the run. Always call this when the task is complete or there is nothing to do. Summarise what was done in one to three sentences.",
    parameters: P({ summary: { type: "string" }, outcome: { type: "string", enum: ["done", "nothing_to_do", "failed"] } }, ["summary", "outcome"]),
  },
];

export const AGENT_ACTION_IDS = AGENT_ACTIONS.map((a) => a.id);
const BY_ID = new Map(AGENT_ACTIONS.map((a) => [a.id, a]));
export const getAgentAction = (id) => BY_ID.get(id) || null;
export const DEFAULT_AGENT_ACTIONS = ["get_issue", "search_issues", "add_comment"];
export const MAX_AGENT_ROUNDS = 8;
export const DEFAULT_AGENT_ROUNDS = 5;

/** Keep only known, non-control ids (finish is implicit). */
export const normalizeAllowedActions = (ids) => {
  const out = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    const a = BY_ID.get(String(id));
    if (a && a.kind !== "control" && !out.includes(a.id)) out.push(a.id);
  }
  return out;
};

/** OpenAI-shape tool definitions for the allowed ids (+ finish). */
export const toolDefinitionsFor = (ids) => {
  const chosen = normalizeAllowedActions(ids);
  const rows = AGENT_ACTIONS.filter((a) => a.always || chosen.includes(a.id));
  return rows.map((a) => ({ type: "function", function: { name: a.id, description: a.description, parameters: a.parameters } }));
};

export const hasWriteActions = (ids) => normalizeAllowedActions(ids).some((id) => (BY_ID.get(id) || {}).kind === "write");
