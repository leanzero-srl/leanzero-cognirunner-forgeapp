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
// Issue references are named tool arguments, not the sandbox's overloaded
// positional arguments. Accept Jira keys (case preserved) or numeric ID strings.
export const ISSUE_REFERENCE_SCHEMA = Object.freeze({ type: "string", pattern: "^(?:[A-Za-z][A-Za-z0-9_]*-[0-9]+|[0-9]+)$" });
const KEY = { ...ISSUE_REFERENCE_SCHEMA, description: "Issue key, e.g. PROJ-123, or numeric issue ID as a string. Omit to use the current issue." };

const JIRA_AGENT_ACTIONS = [
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
      parentKey: { ...ISSUE_REFERENCE_SCHEMA, description: "Parent issue key or numeric issue ID string for sub-tasks / child issues" },
      labels: { type: "array", items: { type: "string" } }, priority: { type: "string", description: "Priority name" },
    }, ["projectKey", "issueType", "summary"]),
  },
  {
    id: "link_issues", kind: "write", label: "Link issues",
    description: "Create an issue link from the issue to another issue (link type name e.g. Relates, Blocks, Duplicate).",
    parameters: P({ issueKey: KEY, otherIssueKey: { ...ISSUE_REFERENCE_SCHEMA }, linkType: { type: "string", description: "Link type name, default Relates" } }, ["otherIssueKey"]),
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

/**
 * NAMESPACES. Every action belongs to exactly one namespace and `agent-runner.js`
 * delegates by namespace — it must never grow a switch over ids from another
 * namespace. `jira` is executed inline by the runner through the sandbox api;
 * every other namespace is executed by its own module (`src/git-actions.js` here;
 * confluence / web / ledger land later and are RESERVED, deliberately empty, so
 * that the gate, the admin checklist and the REST validator already know their
 * flags before the first action exists).
 */
export const AGENT_ACTION_NAMESPACES = Object.freeze({
  jira: Object.freeze({ label: "Jira", requiresCapability: null, requiresProduct: "jira", executor: "agent-runner", reserved: false }),
  git: Object.freeze({ label: "Git", requiresCapability: "git", requiresProduct: null, executor: "git-actions", reserved: false }),
  confluence: Object.freeze({ label: "Confluence", requiresCapability: null, requiresProduct: "confluence", executor: "confluence-actions", reserved: true }),
  web: Object.freeze({ label: "Web", requiresCapability: "web", requiresProduct: null, executor: "web-search-tool", reserved: true }),
  ledger: Object.freeze({ label: "Agent ledger", requiresCapability: null, requiresProduct: null, executor: "va-ledger", reserved: true }),
});
export const AGENT_ACTION_NAMESPACE_IDS = Object.keys(AGENT_ACTION_NAMESPACES);

const REPO = { type: "string", description: "Repository as owner/name (GitHub) or workspace/slug (Bitbucket). Must be one of the repositories the connection allows." };
const PRNUM = { type: "integer", description: "Pull request number" };
const BRANCH = { type: "string", description: "Branch name" };

/**
 * GIT namespace. Every id here carries `requiresCapability:"git"` (the Coder
 * capability, answered by agentCapability() in src/shared/edition.js) and is
 * executed by src/git-actions.js against the connection's allow-listed repos.
 *
 * `confirm`   = a write to somebody's repository. Headless surfaces (listeners,
 *               scheduled jobs, webhooks) may only hold it when an ADMIN saved
 *               the rule — there is no human in the loop to confirm at run time.
 * `dangerous` = it approves code, blocks a merge, or ships to an environment.
 *               An EXTERNALLY triggered run never holds one, whatever was saved.
 */
const GIT_AGENT_ACTIONS = [
  {
    id: "create_repo", namespace: "git", kind: "write", label: "Create a repository", requiresCapability: "git", confirm: true,
    description: "Create a new repository on the connected Git provider.",
    parameters: P({ name: { type: "string" }, org: { type: "string", description: "Organisation / workspace; omit for the connection's own account" }, private: { type: "boolean", description: "Default true" }, description: { type: "string" } }, ["name"]),
  },
  {
    id: "create_branch", namespace: "git", kind: "write", label: "Create a branch", requiresCapability: "git", confirm: true,
    description: "Create a branch in a repository, from another branch (default: the repository's default branch).",
    parameters: P({ repo: REPO, branch: BRANCH, fromBranch: { ...BRANCH, description: "Base branch; omit for the default branch" } }, ["repo", "branch"]),
  },
  {
    id: "commit_files", namespace: "git", kind: "write", label: "Commit files", requiresCapability: "git", confirm: true,
    description: "Commit one or more whole files to a branch in a single commit. Send the FULL new content of each file, not a diff. At most 20 files and 200 KB in total.",
    parameters: P({
      repo: REPO, branch: BRANCH, message: { type: "string", description: "Commit message" },
      files: { type: "array", description: "Files to write", items: P({ path: { type: "string" }, content: { type: "string" } }, ["path", "content"]) },
    }, ["repo", "branch", "message", "files"]),
  },
  {
    id: "open_pull_request", namespace: "git", kind: "write", label: "Open a pull request", requiresCapability: "git", confirm: true,
    description: "Open a pull request from a source branch into a target branch (default: the repository's default branch).",
    parameters: P({ repo: REPO, title: { type: "string" }, body: { type: "string", description: "Description, plain text or markdown" }, sourceBranch: BRANCH, targetBranch: { ...BRANCH, description: "Omit for the default branch" }, draft: { type: "boolean" } }, ["repo", "title", "sourceBranch"]),
  },
  {
    id: "get_pull_request", namespace: "git", kind: "read", label: "Read a pull request", requiresCapability: "git",
    description: "Fetch a pull request: title, state, branches, head commit, author, draft flag.",
    parameters: P({ repo: REPO, number: PRNUM }, ["repo", "number"]),
  },
  {
    id: "add_pr_comment", namespace: "git", kind: "write", label: "Comment on a pull request", requiresCapability: "git", confirm: true,
    description: "Post a comment on a pull request. Give path and line for an inline comment on the diff; omit both for a general comment.",
    parameters: P({ repo: REPO, number: PRNUM, body: { type: "string" }, path: { type: "string", description: "File path for an inline comment" }, line: { type: "integer", description: "Line number for an inline comment" } }, ["repo", "number", "body"]),
  },
  {
    id: "approve_pull_request", namespace: "git", kind: "write", label: "Approve a pull request", requiresCapability: "git", confirm: true, dangerous: true,
    description: "Approve a pull request as the connected Git account.",
    parameters: P({ repo: REPO, number: PRNUM, body: { type: "string" } }, ["repo", "number"]),
  },
  {
    id: "request_changes", namespace: "git", kind: "write", label: "Request changes on a pull request", requiresCapability: "git", confirm: true, dangerous: true,
    description: "Request changes on a pull request, blocking its merge. A reason is required.",
    parameters: P({ repo: REPO, number: PRNUM, body: { type: "string", description: "Why changes are required" } }, ["repo", "number", "body"]),
  },
  {
    id: "get_build_state", namespace: "git", kind: "read", label: "Read build status", requiresCapability: "git",
    description: "Read the build / check status of a commit or branch.",
    parameters: P({ repo: REPO, ref: { type: "string", description: "Commit sha or branch name" } }, ["repo", "ref"]),
  },
  {
    id: "trigger_deploy", namespace: "git", kind: "write", label: "Trigger a deployment", requiresCapability: "git", confirm: true, dangerous: true,
    description: "Trigger a deployment pipeline / workflow on a ref.",
    parameters: P({ repo: REPO, workflow: { type: "string", description: "Workflow file name or pipeline id" }, ref: { type: "string", description: "Branch or tag to deploy" }, inputs: { type: "object", description: "Workflow inputs", additionalProperties: true } }, ["repo", "workflow", "ref"]),
  },
  {
    id: "get_deploy_status", namespace: "git", kind: "read", label: "Read deployment status", requiresCapability: "git",
    description: "Read the most recent deployment / workflow runs for a repository.",
    parameters: P({ repo: REPO, workflow: { type: "string" }, branch: BRANCH }, ["repo"]),
  },
];

export const AGENT_ACTIONS = [...JIRA_AGENT_ACTIONS, ...GIT_AGENT_ACTIONS];

/** The namespace an action belongs to. `finish` is control and belongs to none. */
export const agentActionNamespace = (a) => (a && a.namespace) || (a && a.kind === "control" ? "control" : "jira");

export const AGENT_ACTION_IDS = AGENT_ACTIONS.map((a) => a.id);
const BY_ID = new Map(AGENT_ACTIONS.map((a) => [a.id, a]));
export const getAgentAction = (id) => BY_ID.get(id) || null;
export const DEFAULT_AGENT_ACTIONS = ["get_issue", "search_issues", "add_comment"];
export const MAX_AGENT_ROUNDS = 8;
export const DEFAULT_AGENT_ROUNDS = 5;

/**
 * THE ONE GATE over allowed action ids. Keeps only known, non-control ids
 * (`finish` is implicit) and then applies the capability / product / confirm /
 * dangerous flags.
 *
 * ARITY MATTERS — read this before changing a call site:
 *   normalizeAllowedActions(ids)        → returns an ARRAY of ids (unchanged shape,
 *                                         every pre-1.4 caller keeps working), evaluated
 *                                         against the MOST RESTRICTIVE context: no
 *                                         capability, no products beyond Jira, headless,
 *                                         not admin-saved. For the 13 Jira actions that is
 *                                         byte-identical to the pre-1.4 behaviour; a `git`
 *                                         id is dropped. Defaulting to the permissive
 *                                         context would make "forgot to pass the context"
 *                                         the way past every gate.
 *   normalizeAllowedActions(ids, opts)  → returns { allowed: string[], refused: [{id,reason}] }.
 *
 * opts = { capability, products, triggerSource, savedByRole }
 *   capability    — `agentCapability()`'s result ({enabled, reason}), or true/false, or a
 *                   map of capability id → that. Off ⇒ every id requiring it is refused.
 *   products      — array of product ids present on the site, e.g. ["jira","confluence"].
 *                   Defaults to ["jira"]. Missing product ⇒ refused.
 *   triggerSource — "external" (a webhook or any inbound event we did not originate)
 *                   NEVER keeps a `dangerous` action, whatever was saved.
 *   savedByRole   — "admin" when an admin saved the rule. A `confirm` action on a headless
 *                   surface is kept only for an admin-saved rule; anything else is refused.
 *                   Omitted ⇒ treated as NOT admin.
 *
 * Save time refuses LOUDLY on a non-empty `refused` (the caller renders the reason);
 * run time drops the refused ids so a permission change is not an outage.
 */
const capabilityEnabled = (capability, needed) => {
  if (!needed) return { ok: true };
  if (capability === true) return { ok: true };
  if (capability == null || capability === false) return { ok: false, reason: `capability-off:${needed}` };
  if (typeof capability === "object") {
    const row = Object.prototype.hasOwnProperty.call(capability, needed) ? capability[needed] : capability;
    if (row === true) return { ok: true };
    if (row && typeof row === "object" && row.enabled === true) return { ok: true };
    const reason = row && typeof row === "object" && row.reason ? String(row.reason) : `capability-off:${needed}`;
    return { ok: false, reason };
  }
  return { ok: false, reason: `capability-off:${needed}` };
};

const gateActions = (ids, opts) => {
  const { capability = null, products = ["jira"], triggerSource = null, savedByRole = null } = opts || {};
  const productList = (Array.isArray(products) ? products : ["jira"]).map((p) => String(p).toLowerCase());
  const external = String(triggerSource || "") === "external";
  const admin = String(savedByRole || "") === "admin";
  const allowed = [];
  const refused = [];
  const seen = new Set();
  for (const raw of Array.isArray(ids) ? ids : []) {
    const a = BY_ID.get(String(raw));
    if (!a || a.kind === "control" || seen.has(a.id)) continue;
    seen.add(a.id);
    const ns = AGENT_ACTION_NAMESPACES[agentActionNamespace(a)] || {};
    const needsCapability = a.requiresCapability || ns.requiresCapability || null;
    const cap = capabilityEnabled(capability, needsCapability);
    if (!cap.ok) { refused.push({ id: a.id, reason: cap.reason }); continue; }
    const needsProduct = a.requiresProduct || ns.requiresProduct || null;
    if (needsProduct && !productList.includes(String(needsProduct).toLowerCase())) { refused.push({ id: a.id, reason: `missing-product:${needsProduct}` }); continue; }
    if (a.dangerous && external) { refused.push({ id: a.id, reason: "external-trigger" }); continue; }
    if (a.confirm && !admin) { refused.push({ id: a.id, reason: "needs-admin" }); continue; }
    allowed.push(a.id);
  }
  return { allowed, refused };
};

export const normalizeAllowedActions = (ids, opts) =>
  (opts === undefined ? gateActions(ids, undefined).allowed : gateActions(ids, opts));

/** OpenAI-shape tool definitions for the allowed ids (+ finish). Same gate, same opts. */
export const toolDefinitionsFor = (ids, opts) => {
  const chosen = opts === undefined ? normalizeAllowedActions(ids) : gateActions(ids, opts).allowed;
  const rows = AGENT_ACTIONS.filter((a) => a.always || chosen.includes(a.id));
  return rows.map((a) => ({ type: "function", function: { name: a.id, description: a.description, parameters: a.parameters } }));
};

export const hasWriteActions = (ids, opts) => {
  const chosen = opts === undefined ? normalizeAllowedActions(ids) : gateActions(ids, opts).allowed;
  return chosen.some((id) => (BY_ID.get(id) || {}).kind === "write");
};

// Providers may ignore schema patterns or serialize an issue object into a string.
// Validate before dispatch so neither shape can become a Jira path or fall back
// to the current issue. Missing optional references alone mean "not supplied".
export const normalizeAgentIssueReferences = (action, args) => {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error(`${action.id}: tool arguments must be a JSON object`);
  const normalized = { ...args };
  for (const [name, schema] of Object.entries(action.parameters.properties)) {
    if (schema.pattern !== ISSUE_REFERENCE_SCHEMA.pattern) continue;
    const value = args[name];
    if (value === undefined && !action.parameters.required.includes(name)) continue;
    if (typeof value !== "string" || !(new RegExp(schema.pattern)).test(value.trim())) {
      throw new Error(`${action.id}: ${name} must be an issue key like "PROJ-123" or a numeric issue ID string; pass the key, not an issue object.`);
    }
    normalized[name] = value.trim();
  }
  return normalized;
};
