/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Dev-only screenshot/test harness — mock of @forge/bridge.
 * Aliased in place of "@forge/bridge" by each app's webpack.screenshot.js.
 * Renders the real React UIs standalone (outside Jira) with canned data so
 * Playwright can capture marketing screenshots. Not deployed. Safe to delete.
 *
 * Scenario is read from window.__SHOT__ at call time; theme from window.__THEME__.
 *   admin            -> admin-panel global page (all tabs)
 *   cfg-validator    -> config-ui validator form
 *   cfg-condition    -> config-ui condition form
 *   cfg-semantic     -> config-ui semantic post-function
 *   cfg-static       -> config-ui static post-function (CodeMirror)
 *   view-active      -> config-view rule summary (active) + logs
 *   view-disabled    -> config-view rule summary (disabled) + logs
 */

const ACCT = "557058:11111111-1111-1111-1111-111111111111";
const SITE = "https://your-site.atlassian.net";

function shot() {
  return (typeof window !== "undefined" && window.__SHOT__) || "admin";
}
function theme() {
  return (typeof window !== "undefined" && window.__THEME__) || "light";
}
function applyTheme() {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-color-mode", theme());
  }
}
if (typeof document !== "undefined") {
  // Apply immediately so first paint is themed even before view.theme.enable() runs.
  applyTheme();
}

/* ----------------------------- shared field list ----------------------------- */
const FIELDS = {
  success: true,
  fields: [
    { id: "summary", name: "Summary", type: "System (Text)", custom: false, schema: { type: "string", system: "summary" } },
    { id: "description", name: "Description", type: "System (Rich Text)", custom: false, schema: { type: "string", system: "description" } },
    { id: "environment", name: "Environment", type: "System (Rich Text)", custom: false, schema: { type: "string", system: "environment" } },
    { id: "priority", name: "Priority", type: "System (Priority)", custom: false, schema: { type: "priority", system: "priority" } },
    { id: "labels", name: "Labels", type: "System (Labels)", custom: false, schema: { type: "array", items: "string", system: "labels" } },
    { id: "assignee", name: "Assignee", type: "System (User)", custom: false, schema: { type: "user", system: "assignee" } },
    { id: "duedate", name: "Due date", type: "System (Date)", custom: false, schema: { type: "date", system: "duedate" } },
    { id: "status", name: "Status", type: "System (Status)", custom: false, schema: { type: "status", system: "status" } },
    { id: "customfield_10001", name: "Acceptance Criteria", type: "Text (multi-line)", custom: true, schema: { type: "string", custom: "com.atlassian.jira.plugin.system.customfieldtypes:textarea", customId: 10001 } },
    { id: "customfield_10002", name: "Story Points", type: "Number", custom: true, schema: { type: "number", custom: "com.atlassian.jira.plugin.system.customfieldtypes:float", customId: 10002 } },
    { id: "customfield_10003", name: "Team", type: "Select List (single)", custom: true, schema: { type: "option", custom: "com.atlassian.jira.plugin.system.customfieldtypes:select", customId: 10003 } },
    { id: "customfield_10004", name: "Root Cause", type: "Text (single line)", custom: true, schema: { type: "string", custom: "com.atlassian.jira.plugin.system.customfieldtypes:textfield", customId: 10004 } },
    { id: "customfield_10042", name: "Risk Level", type: "Select List (single)", custom: true, schema: { type: "option", custom: "com.atlassian.jira.plugin.system.customfieldtypes:select", customId: 10042 } },
  ],
};

/* ----------------------------- admin: rule configs --------------------------- */
const ADMIN_CONFIGS = {
  success: true,
  removedCount: 0,
  configs: [
    {
      id: "cr::Software Dev Workflow::21::a1b2c3", type: "validator", fieldId: "description",
      prompt: "Block this transition unless the Description contains clear, testable acceptance criteria and a rollback plan.",
      workflow: { workflowId: "wf-software-dev-001", workflowName: "Software Dev Workflow", projectId: "10001", transitionId: "21", transitionFromName: "In Progress", transitionToName: "In Review", siteUrl: SITE },
      instanced: true, createdBy: ACCT, createdAt: "2026-05-01T09:12:00.000Z", updatedAt: "2026-06-15T14:30:00.000Z", disabled: false,
    },
    {
      id: "cr::Bug Triage::31::d4e5f6", type: "condition", fieldId: "priority",
      prompt: "Only allow moving to 'Critical' when the issue text describes production impact affecting multiple customers.",
      workflow: { workflowId: "wf-bug-triage-002", workflowName: "Bug Triage", projectId: "10002", transitionId: "31", transitionFromName: "Open", transitionToName: "Escalated", siteUrl: SITE },
      instanced: true, createdBy: "557058:22222222-2222-2222-2222-222222222222", createdAt: "2026-04-20T08:00:00.000Z", updatedAt: "2026-06-10T11:05:00.000Z", disabled: false,
    },
    {
      id: "cr::Release Workflow::41::a7b8c9", type: "postfunction-semantic", fieldId: "description", prompt: "",
      conditionPrompt: "If the release notes mention a breaking change…",
      actionPrompt: "…set the 'Risk Level' field to 'High' and summarize the breaking change.",
      actionFieldId: "customfield_10042", functions: [],
      workflow: { workflowId: "wf-release-003", workflowName: "Release Workflow", projectId: "10003", transitionId: "41", transitionFromName: "Staging", transitionToName: "Production", siteUrl: SITE },
      instanced: true, disabled: false, createdBy: ACCT, createdAt: "2026-05-12T10:00:00.000Z", updatedAt: "2026-06-16T09:45:00.000Z",
    },
    {
      id: "cr::Onboarding::51::e1f2a3", type: "postfunction-static", fieldId: "", prompt: "",
      conditionPrompt: "When an issue enters 'Provisioning', create the standard onboarding sub-tasks.", actionPrompt: "",
      actionFieldId: "customfield_10055",
      functions: [{ id: "fn1", name: "Create onboarding subtasks", operationType: "rest_api_internal", variableName: "result" }],
      workflow: { workflowId: "wf-onboarding-004", workflowName: "Onboarding", projectId: "10004", transitionId: "51", transitionFromName: "Approved", transitionToName: "Provisioning", siteUrl: SITE },
      instanced: true, disabled: false, createdBy: "557058:22222222-2222-2222-2222-222222222222", createdAt: "2026-03-30T07:30:00.000Z", updatedAt: "2026-06-01T16:20:00.000Z",
    },
    {
      id: "cr::Legacy QA::61::f4a5b6", type: "validator", fieldId: "summary",
      prompt: "Reject transitions to Done when the Summary still contains 'TODO' or 'WIP'.",
      workflow: { workflowId: "wf-legacy-qa-005", workflowName: "Legacy QA", projectId: "10005", transitionId: "61", transitionFromName: "Testing", transitionToName: "Done", siteUrl: SITE },
      instanced: false, createdBy: ACCT, createdAt: "2026-02-15T12:00:00.000Z", updatedAt: "2026-05-20T13:10:00.000Z", disabled: true,
    },
    {
      // Premade (registry shape: premadeRuleType, no detail fields) — exercises the
      // premadeRuleType||ruleType generalization + label-only facts.
      id: "cr::Compliance::71::b2c3d4", type: "condition", ruleKind: "premade", premadeRuleType: "field-required", fieldId: "customfield_10099",
      workflow: { workflowId: "wf-compliance-006", workflowName: "Compliance", projectId: "10006", transitionId: "71", transitionFromName: "Draft", transitionToName: "Submitted", siteUrl: SITE },
      instanced: true, createdBy: ACCT, createdAt: "2026-05-05T09:00:00.000Z", updatedAt: "2026-06-14T10:00:00.000Z", disabled: false,
    },
    {
      // Offloaded static PF (functions:[] + name-only functionsMeta) — exercises the
      // functionsMeta-is-name-only path.
      id: "cr::Incident::81::c3d4e5", type: "postfunction-static", fieldId: "", prompt: "", functions: [],
      functionsMeta: [{ id: "s1", name: "Escalate priority to High", operationType: "rest_api_internal", variableName: "r1" }, { id: "s2", name: "Add on-call watcher", operationType: "rest_api_internal", variableName: "r2" }],
      workflow: { workflowId: "wf-incident-007", workflowName: "Incident Response", projectId: "10007", transitionId: "81", transitionFromName: "Triaged", transitionToName: "Mitigating", siteUrl: SITE },
      instanced: true, createdBy: ACCT, createdAt: "2026-05-18T09:00:00.000Z", updatedAt: "2026-06-17T10:00:00.000Z", disabled: false,
    },
  ],
};

/* ----------------------------- admin: logs ----------------------------------- */
const ADMIN_LOGS = {
  success: true,
  logs: [
    {
      id: "1718200000001abcd", type: "validation", issueKey: "SDW-142", fieldId: "description",
      isValid: true, decision: null,
      reason: "Acceptance criteria are clear and testable; a rollback plan is present. Transition allowed.",
      executionTimeMs: 4120, aiTimeMs: 3980, tokens: 1840, mode: "agentic", modelUsed: "claude-haiku-4-5-20251001",
      toolMeta: { toolsUsed: true, toolRounds: 2, queries: ['project = SDW AND status changed to "In Review" ORDER BY updated DESC', "issuetype = Bug AND labels = regression AND created >= -14d"], totalResults: 17 },
      ruleId: "cr::Software Dev Workflow::21::a1b2c3", ruleName: "Software Dev Workflow / In Progress → In Review",
      ruleWorkflow: { workflowId: "wf-software-dev-001", transitionFromName: "In Progress", transitionToName: "In Review", siteUrl: SITE },
      timestamp: "2026-06-17T15:42:11.000Z",
    },
    {
      id: "1718200000002efgh", type: "validation", issueKey: "BUG-87", fieldId: "priority",
      isValid: false, decision: null,
      reason: "No evidence of multi-customer production impact in the issue text; cannot justify Critical. Transition blocked.",
      executionTimeMs: 2650, aiTimeMs: 2510, tokens: 920, mode: "standard",
      ruleId: "cr::Bug Triage::31::d4e5f6", ruleName: "Bug Triage / Open → Escalated",
      ruleWorkflow: { workflowId: "wf-bug-triage-002", transitionFromName: "Open", transitionToName: "Escalated", siteUrl: SITE },
      source: "runtime", transientError: true, flags: ["transientError"],
      timestamp: "2026-06-17T14:05:33.000Z",
    },
    {
      id: "1718200000003ijkl", type: "postfunction-semantic", issueKey: "REL-301", fieldId: "customfield_10042",
      isValid: false, decision: "SKIP",
      reason: "Release notes describe no breaking change; Risk Level left unchanged.",
      executionTimeMs: 5300, aiTimeMs: 5100, tokens: 1320, queueDelayMs: 8400,
      source: "async", simulated: true, flags: ["simulated"],
      ruleId: "cr::Release Workflow::41::a7b8c9", ruleName: "Release Workflow / Staging → Production",
      ruleWorkflow: { workflowId: "wf-release-003", transitionFromName: "Staging", transitionToName: "Production", siteUrl: SITE },
      timestamp: "2026-06-17T11:20:00.000Z",
    },
    {
      id: "1718200000004mnop", type: "postfunction-static", issueKey: "ONB-55", fieldId: "customfield_10055",
      isValid: true, decision: "UPDATE",
      reason: "Created 4 standard onboarding sub-tasks and set provisioning owner.",
      executionTimeMs: 3100, aiTimeMs: 0, tokens: 0,
      source: "runtime", flags: ["capped"],
      ruleId: "cr::Onboarding::51::e1f2a3", ruleName: "Onboarding / Approved → Provisioning",
      ruleWorkflow: { workflowId: "wf-onboarding-004", transitionFromName: "Approved", transitionToName: "Provisioning", siteUrl: SITE },
      timestamp: "2026-06-16T09:00:00.000Z",
    },
  ],
};

/* ----------------------------- admin: BYOK / settings ------------------------ */
const PROVIDER_LIST = [
  { key: "openai", label: "OpenAI", hasDefaultUrl: true },
  { key: "azure", label: "Azure OpenAI", hasDefaultUrl: false },
  { key: "openrouter", label: "OpenRouter", hasDefaultUrl: true },
  { key: "anthropic", label: "Anthropic", hasDefaultUrl: true },
  { key: "lmstudio", label: "LM Studio", hasDefaultUrl: false },
  { key: "atlassian", label: "Atlassian (Forge LLM)", hasDefaultUrl: false },
  { key: "bedrock", label: "AWS Bedrock", hasDefaultUrl: false },
];

/* ----------------------------- admin: permissions / docs --------------------- */
const ADMINS = {
  success: true,
  admins: [
    { accountId: ACCT, displayName: "Mihai Perdum", avatarUrl: "https://secure.gravatar.com/avatar/aaa?d=identicon&s=48", role: "admin", scope: "all" },
    { accountId: "557058:22222222-2222-2222-2222-222222222222", displayName: "Dana Editor", avatarUrl: "https://secure.gravatar.com/avatar/bbb?d=identicon&s=48", role: "editor", scope: "all" },
    { accountId: "557058:33333333-3333-3333-3333-333333333333", displayName: "Sam Viewer", avatarUrl: "https://secure.gravatar.com/avatar/ccc?d=identicon&s=48", role: "viewer", scope: "own" },
    { accountId: "557058:44444444-4444-4444-4444-444444444444", displayName: "Priya Editor", avatarUrl: null, role: "editor", scope: "own" },
  ],
};
const DOCS = {
  success: true,
  docs: [
    { id: "doc-builtin-jira-fields", title: "Jira Field Reference", category: "Field Mappings", contentLength: 8423, createdBy: null, createdAt: "2026-01-10T00:00:00.000Z", builtin: true },
    { id: "doc-api-spec-001", title: "Internal Orders API v2", category: "API Documentation", contentLength: 15670, createdBy: ACCT, createdAt: "2026-04-02T09:00:00.000Z" },
    { id: "doc-rules-001", title: "Escalation Business Rules", category: "Business Rules", contentLength: 3120, createdBy: null, createdAt: "2026-05-18T13:30:00.000Z" },
    { id: "doc-schema-001", title: "Webhook Payload Schema", category: "JSON Schemas", contentLength: 2048, createdBy: ACCT, createdAt: "2026-06-01T10:15:00.000Z" },
  ],
};

/* ----------------------------- config-ui: contexts --------------------------- */
const CFG_VALIDATOR = {
  id: "validator::Software Simplified Workflow::21::i-aa11bb",
  workflow: { workflowId: "wf-software-simplified-12345", workflowName: "Software Simplified Workflow", transitionId: "21" },
  fieldId: "description",
  prompt: "The description must include clear steps to reproduce, the expected behavior, and the actual behavior. Reject vague one-line descriptions.",
  enableTools: null, selectedDocIds: [],
};
const CFG_CONDITION = {
  id: "condition::Software Simplified Workflow::31::i-cc22dd",
  workflow: { workflowId: "wf-software-simplified-12345", workflowName: "Software Simplified Workflow", transitionId: "31" },
  fieldId: "customfield_10001",
  prompt: "Only show this transition if the Acceptance Criteria field is filled in with at least one testable, measurable criterion.",
  enableTools: false, selectedDocIds: [],
};
// Premade (non-AI) condition using a REST-backed picker (issue types) — hydrates the
// PremadeRuleForm straight into premade mode so the picker + getRuleLists path renders.
const CFG_PREMADE_COND = {
  id: "condition::Software Simplified Workflow::31::i-premade",
  workflow: { workflowId: "wf-software-simplified-12345", workflowName: "Software Simplified Workflow", transitionId: "31" },
  ruleKind: "premade", ruleType: "issue-type-is", issueTypeName: "",
};
const CFG_SEMANTIC = {
  id: "postfunction-semantic::Software Simplified Workflow::21::i-d4e5f6",
  type: "postfunction-semantic",
  workflow: { workflowId: "wf-software-simplified-12345", workflowName: "Software Simplified Workflow", transitionId: "21" },
  fieldId: "description",
  conditionPrompt: "Run when the description mentions a customer-facing bug, regression, or production incident.",
  actionPrompt: "Write a concise 2-3 bullet executive summary of the issue, highlighting customer impact and the next action. Keep it under 60 words.",
  actionFieldId: "customfield_10001", crossCheckClaims: true, selectedDocIds: [],
};
const STATIC_CODE_1 = [
  "// Find all issues in this project with a similar summary",
  "const issue = await api.getIssue(api.context.issueKey);",
  'const project = api.context.issueKey.split("-")[0];',
  'const summary = (issue.fields.summary || "").replace(/"/g, \'\\\\"\');',
  "const results = await api.searchJql(",
  '  `project = "${project}" AND summary ~ "${summary}" AND key != "${issue.key}"`',
  ");",
  'api.log("Found " + (results.issues?.length || 0) + " possible duplicates");',
  "return results.issues || [];",
].join("\n");
const STATIC_CODE_2 = [
  "// Post a comment linking each duplicate found in step 1",
  "if (!duplicates || duplicates.length === 0) {",
  '  api.log("No duplicates — skipping comment");',
  "  return { skipped: true };",
  "}",
  'const links = duplicates.map(d => "• " + d.key + " — " + d.fields.summary).join("\\n");',
  "await withRetry(async () => {",
  "  await api.addComment(api.context.issueKey,",
  '    "Possible duplicates detected:\\n" + links);',
  "});",
  "return { commented: true, count: duplicates.length };",
].join("\n");
const STATIC_CODE_3 = [
  "const issue = await api.getIssue(api.context.issueKey);",
  'api.log("Issue: " + issue.key + " | Status: " + issue.fields.status.name + " | duplicates linked: " + (comment?.count || 0));',
].join("\n");
const CFG_STATIC = {
  id: "postfunction-static::Software Simplified Workflow::11::i-a1b2c3",
  type: "postfunction-static",
  workflow: { workflowId: "wf-software-simplified-12345", workflowName: "Software Simplified Workflow", transitionId: "11" },
  runAsync: false,
  functions: [
    { id: "func_1", name: "Find duplicate issues", conditionPrompt: "", operationType: "work_item_query", operationPrompt: "Find all issues in this project with a summary similar to the current issue, excluding the current one.", endpoint: "", method: "GET", variableName: "duplicates", includeBackoff: false, code: STATIC_CODE_1, generationMeta: { appliedDocs: [{ id: "builtin_doc_jql", title: "JQL Cheat Sheet" }], appliedSkills: [{ id: "skill_dup", name: "Duplicate Finder", auto: true }], appliedMemories: 2, truncatedDocs: [] } },
    { id: "func_2", name: "Comment with links", conditionPrompt: "", operationType: "rest_api_internal", operationPrompt: "If duplicates were found, add a comment to the current issue linking to each duplicate by key.", endpoint: "/rest/api/3/issue/{issueIdOrKey}/comment", method: "POST", requestBody: '{\n  "body": { "type": "doc", "version": 1, "content": [] }\n}', variableName: "comment", includeBackoff: true, code: STATIC_CODE_2, generationMeta: null },
    { id: "func_3", name: "Log outcome", conditionPrompt: "", operationType: "log_function", operationPrompt: "Log the final status and how many duplicates were linked.", endpoint: "", method: "GET", variableName: "result3", includeBackoff: false, code: STATIC_CODE_3, generationMeta: null },
  ],
};

/* ----------------------------- config-view: logs ----------------------------- */
const VIEW_LOGS = {
  success: true,
  logs: [
    { id: "log-3", type: "validator", fieldId: "summary", isValid: false, issueKey: "PROJ-512", executionTimeMs: 5230, timestamp: "2026-06-18T10:02:47.000Z", reason: "Likely duplicate of PROJ-118. Both describe the same OAuth token-refresh failure on the mobile client; the AI cross-checked open and recently-resolved issues before flagging.", recommendation: "Link PROJ-512 to PROJ-118 as a duplicate, or clarify how the scope differs before proceeding.", toolMeta: { toolsUsed: true, toolRounds: 3, totalResults: 7, queries: ['project = PROJ AND text ~ "OAuth token refresh" ORDER BY created DESC', 'project = PROJ AND summary ~ "token refresh failure" AND status != Done', "project = PROJ AND text ~ \"mobile OAuth\" AND resolved >= -30d"] }, trace: ["Round 1: searched open issues for 'OAuth token refresh' — 4 candidates", "Round 2: narrowed by component=mobile-auth — 2 strong matches", "Round 3: compared PROJ-118 description (cosine 0.91) — duplicate threshold exceeded", "ERROR: JQL round 2 timed out once, retried successfully", "Decision: FAIL — duplicate of PROJ-118"], aiTimeMs: 4980, tokens: 7320, docCount: 0 },
    { id: "log-1", type: "validator", fieldId: "summary", isValid: true, issueKey: "PROJ-481", executionTimeMs: 842, timestamp: "2026-06-18T09:14:22.000Z", reason: "Summary clearly describes customer impact (checkout latency) and includes a rollback plan referencing the prior release tag.", aiTimeMs: 612, tokens: 1840 },
    { id: "log-2", type: "validator", fieldId: "summary", isValid: false, issueKey: "PROJ-479", executionTimeMs: 760, timestamp: "2026-06-18T08:51:03.000Z", reason: "Summary does not state any rollback plan and the customer impact is left ambiguous ('some users affected').", recommendation: "Add an explicit rollback step and quantify the affected user segment before transitioning to Done.", aiTimeMs: 540, tokens: 1620 },
  ],
};
const VIEW_VALIDATOR_CONFIG = {
  id: "validator::cfg-abc123", type: "validator", fieldId: "summary",
  prompt: "Reject the transition unless the Summary clearly states the customer impact and a rollback plan.",
  enableTools: true,
};

/* ----------------------------- active jobs drain timeline -------------------- */
// Each getAsyncJobs() call advances one tick so the queue visibly drains during
// a recording (poll fires ~every 3.5s while active). Fresh on each page load.
let _jobTick = 0;
const JOB_META = {
  j1: { taskType: "codegen", ruleName: "Generate onboarding code", issueKey: "DEMO-101", provider: "anthropic" },
  j2: { taskType: "review", ruleName: "AI review · Release Workflow", issueKey: "DEMO-102", provider: "anthropic" },
  j3: { taskType: "postfunction", ruleName: "Link related issues", issueKey: "DEMO-103", provider: "openai" },
  j4: { taskType: "review", ruleName: "AI review · Bug Triage", issueKey: "DEMO-104", provider: "anthropic" },
  j5: { taskType: "codegen", ruleName: "Generate audit summary", issueKey: "DEMO-105", provider: "openai" },
  j6: { taskType: "memory_distill", ruleName: "Distill memory", issueKey: "DEMO-106", provider: "anthropic" },
  j7: { taskType: "skilldistill", ruleName: "Distill skill", issueKey: "DEMO-107", provider: "anthropic" },
};
const JOB_SCHEDULE = [
  { running: ["j1", "j2"], queued: ["j3", "j4", "j5", "j6", "j7"], done: [] },
  { running: ["j2", "j3", "j4"], queued: ["j5", "j6", "j7"], done: ["j1"] },
  { running: ["j4", "j5", "j6"], queued: ["j7"], done: ["j1", "j2", "j3"] },
  { running: ["j6", "j7"], queued: [], done: ["j1", "j2", "j3", "j4", "j5"] },
  { running: ["j7"], queued: [], done: ["j1", "j2", "j3", "j4", "j5", "j6"] },
  { running: [], queued: [], done: ["j1", "j2", "j3", "j4", "j5", "j6", "j7"] },
];
function buildJobs() {
  const now = Date.now();
  const stage = JOB_SCHEDULE[Math.min(_jobTick, JOB_SCHEDULE.length - 1)];
  _jobTick++;
  const mk = (id, status, extra) => ({ taskId: id, status, ...JOB_META[id], ...extra });
  return {
    success: true,
    jobs: {
      running: stage.running.map((id, i) => mk(id, "running", { startedAt: new Date(now - (3 + i * 3) * 1000).toISOString() })),
      queued: stage.queued.map((id, i) => mk(id, "queued", { enqueuedAt: new Date(now - (1 + i) * 1000).toISOString() })),
      recent: stage.done.map((id) => mk(id, "done", { durationMs: 9000 + (id.charCodeAt(1) % 5) * 1200 })),
    },
  };
}

/* ----------------------------- Add Rule wizard data -------------------------- */
const PROJECTS = { success: true, projects: [
  { id: "10001", key: "DEMO", name: "Demo Project", avatarUrl: null },
  { id: "10002", key: "PLAT", name: "Platform", avatarUrl: null },
  { id: "10003", key: "REL", name: "Release Management", avatarUrl: null },
] };
const WORKFLOWS = { success: true, workflows: [
  { id: "wf-1", name: "Software Simplified Workflow", transitionCount: 4 },
  { id: "wf-2", name: "Bug Triage Workflow", transitionCount: 3 },
] };
const TRANSITIONS = { success: true, transitions: [
  { id: "11", name: "Start Progress", fromName: "To Do", toName: "In Progress", type: "global", hasCogniValidator: false, hasCogniCondition: false, hasCogniPostFunction: false },
  { id: "21", name: "Submit for Review", fromName: "In Progress", toName: "In Review", type: "global", hasCogniValidator: false, hasCogniCondition: false, hasCogniPostFunction: false },
  { id: "31", name: "Mark Done", fromName: "In Review", toName: "Done", type: "global", hasCogniValidator: false, hasCogniCondition: false, hasCogniPostFunction: false },
] };
const WIZARD_FIELDS = { success: true, fields: [
  { id: "summary", name: "Summary" }, { id: "description", name: "Description" },
  { id: "customfield_10001", name: "Acceptance Criteria" }, { id: "priority", name: "Priority" },
] };

/* ----------------------------- LM Studio (real local models) ----------------- */
const LM_URL = "https://worksmacstudio.tailfc4700.ts.net/lmstudio";
const LM_MODELS = [
  { id: "qwen/qwen3.6-35b-a3b", state: "loaded", quantization: "6bit", max_context_length: 262144, vision: true, toolUse: true },
  { id: "qwen3.6-35b-a3b-mtp-holo3-qwopus-qx86-hi-mlx", state: "loaded", quantization: "8bit", max_context_length: 262144, vision: true, toolUse: true },
  { id: "qwopus3.6-35b-a3b-v1-mtp", state: "loaded", quantization: "Q8_0", max_context_length: 262144, vision: true, toolUse: true },
  { id: "gabee-nightmedia-qwen3.5-9b-omnicoder-claude-polaris-text-dwq4-mlx", state: "not-loaded", quantization: "4bit", max_context_length: 262144, vision: false, toolUse: true },
  { id: "mihai-nightmedia-qwen3.5-omnicoder-claude-9b", state: "not-loaded", quantization: "4bit", max_context_length: 262144, vision: false, toolUse: true },
  { id: "qwen/qwen3.6-27b", state: "not-loaded", quantization: "8bit", max_context_length: 262144, vision: true, toolUse: true },
];
const LM_WEIGHT_MODELS = [
  { wkey: "qwen/qwen3.6-35b-a3b", id: "qwen/qwen3.6-35b-a3b", quant: "6bit", ctx: 262144 },
  { wkey: "qwen3.6-35b-a3b-mtp-holo3-qwopus-qx86-hi-mlx", id: "qwen3.6-35b-a3b-mtp-holo3-qwopus-qx86-hi-mlx", quant: "8bit", ctx: 262144 },
  { wkey: "qwopus3.6-35b-a3b-v1-mtp", id: "qwopus3.6-35b-a3b-v1-mtp", quant: "Q8_0", ctx: 262144 },
];

/* ----------------------------- context router -------------------------------- */
function getContext() {
  const s = shot();
  const baseExt = { workflowId: "wf-software-simplified-12345", workflowName: "Software Simplified Workflow", scopedProjectId: "10001" };
  if (s === "cfg-validator")
    return { accountId: ACCT, siteUrl: SITE, license: { active: true, type: "PAID" }, extension: { ...baseExt, type: "jira:workflowValidator", key: "ai-text-field-validator", entryPoint: "edit", transitionContext: { id: "21", from: { id: "3", name: "In Progress" }, to: { id: "4", name: "In Review" } }, validatorConfig: JSON.stringify(CFG_VALIDATOR) } };
  if (s === "cfg-condition")
    return { accountId: ACCT, siteUrl: SITE, license: { active: true, type: "PAID" }, extension: { ...baseExt, type: "jira:workflowCondition", key: "ai-text-field-condition", transitionContext: { id: "31", from: { id: "4", name: "In Review" }, to: { id: "5", name: "Done" } }, conditionConfig: JSON.stringify(CFG_CONDITION) } };
  if (s === "cfg-premade")
    return { accountId: ACCT, siteUrl: SITE, license: { active: true, type: "PAID" }, extension: { ...baseExt, type: "jira:workflowCondition", key: "ai-text-field-condition", transitionContext: { id: "31", from: { id: "4", name: "In Review" }, to: { id: "5", name: "Done" } }, conditionConfig: JSON.stringify(CFG_PREMADE_COND) } };
  if (s === "cfg-semantic")
    return { accountId: ACCT, siteUrl: SITE, license: { active: true, type: "PAID" }, extension: { ...baseExt, type: "jira:workflowPostFunction", key: "ai-semantic-post-function", transitionContext: { id: "21", from: { id: "3", name: "In Progress" }, to: { id: "4", name: "In Review" } }, postFunctionConfig: JSON.stringify(CFG_SEMANTIC) } };
  if (s === "cfg-static")
    return { accountId: ACCT, siteUrl: SITE, license: { active: true, type: "PAID" }, extension: { ...baseExt, type: "jira:workflowPostFunction", key: "ai-static-post-function", transitionContext: { id: "11", from: { id: "1", name: "To Do" }, to: { id: "3", name: "In Progress" } }, postFunctionConfig: JSON.stringify(CFG_STATIC) } };
  if (s === "view-active" || s === "view-disabled")
    return { accountId: ACCT, siteUrl: SITE, license: { active: true }, extension: { ...baseExt, type: "jira:workflowValidator", key: "cognirunner-validator", entryPoint: "view", transitionContext: { id: "21", from: { name: "In Progress" }, to: { name: "Done" } }, validatorConfig: VIEW_VALIDATOR_CONFIG } };
  // default: admin global page (auto-admin via jira:adminPage)
  return { extension: { type: "jira:adminPage", key: "cognirunner-admin-page" }, license: { active: true, isActive: true }, siteUrl: SITE, accountId: ACCT, cloudId: "00000000-aaaa-bbbb-cccc-000000000000", localId: "mock-local-id", theme: { colorMode: theme() }, locale: "en-US" };
}

/* ----------------------------- invoke router --------------------------------- */
function invoke(name, payload) {
  const s = shot();
  const isAdmin = s === "admin";
  // Error-state testing: window.__FAIL__ = ["getSkills", ...] makes those resolvers
  // reject, so components take their catch → loadError path. Set via capture.mjs.
  if (typeof window !== "undefined" && Array.isArray(window.__FAIL__) && window.__FAIL__.includes(name)) {
    return Promise.reject(new Error("Simulated network failure (harness __FAIL__)"));
  }
  switch (name) {
    case "checkLicense": return Promise.resolve({ isActive: true });
    case "checkIsAdmin": return Promise.resolve({ success: true, isAdmin: true, role: "admin", scope: "all", accountId: ACCT });
    case "checkProviderHealth": return Promise.resolve({ success: true, ok: true, provider: "anthropic", providerLabel: "Anthropic", model: "claude-haiku-4-5-20251001" });
    case "getConfigs": return Promise.resolve(ADMIN_CONFIGS);
    case "getLogs": return Promise.resolve(isAdmin ? ADMIN_LOGS : VIEW_LOGS);
    case "getRuleStatus": return Promise.resolve({ found: true, disabled: s === "view-disabled", registryId: "validator::cfg-abc123" });
    case "explainRule": {
      // Render the degraded note for the premade-condition row so both states show.
      if (payload && payload.kind === "premade-condition") return Promise.resolve({ success: true, degraded: true, reason: "lmstudio" });
      const byKind = {
        "premade-validator": "This rule requires the selected field to be filled in before the transition is allowed.",
        "semantic-pf": "After the transition, this rule uses AI to detect breaking changes and set the Risk Level field to High.",
        "static-pf": "After the transition, this rule runs saved steps: it escalates the priority to High and adds an on-call watcher.",
        "condition": "This rule only shows the transition when the issue text describes production impact affecting multiple customers.",
      };
      return Promise.resolve({ success: true, explanation: (payload && byKind[payload.kind]) || "This rule blocks the transition unless the Summary field clearly states the customer impact and a rollback plan." });
    }
    case "getAsyncJobs": return Promise.resolve(buildJobs());
    case "getFields": return Promise.resolve(FIELDS);
    case "getRuleLists": return Promise.resolve({ success: true, lists: { issuetypes: [{ value: "Bug", label: "Bug" }, { value: "Task", label: "Task" }], statuses: [{ value: "Done", label: "Done" }], priorities: [{ value: "High", label: "High" }] } });
    case "getAiUsage": return Promise.resolve({ success: true, usage: { month: { key: "2026-07", calls: 1284, prompt: 512000, completion: 148000, total: 660000, byProvider: { anthropic: { calls: 720, total: 410000 }, openai: { calls: 402, total: 180000 }, atlassian: { calls: 162, total: 70000 } } }, today: { key: "2026-07-08", calls: 96, total: 48200 }, history: [{ key: "2026-06", calls: 3140, total: 1620000 }] } });
    case "resetAiUsage": return Promise.resolve({ success: true });
    case "commitImport": return Promise.resolve({ success: true, status: "committed", ruleId: "imported-1" });
    case "exportRules": return Promise.resolve({ success: true, envelope: { schemaVersion: 1, kind: "cognirunner-rules-export", ruleCount: (args && args.ids || []).length, rules: [] }, skipped: [] });
    case "previewImport": return Promise.resolve({ success: true, ruleCount: 3, plan: [
      { type: "postfunction-semantic", ruleName: "Set Risk Level from release notes", status: "ready", fieldId: "customfield_10042", notes: [] },
      { type: "validator", ruleName: "Require reproduction steps", status: "needs-rebind", unresolved: ["field"], notes: ['Field "Steps to Reproduce" not found on this site — pick a target field.'] },
      { type: "postfunction-static", ruleName: "Link duplicates", status: "ready", notes: ["1 attached doc not on this site — dropped: Internal Orders API v2"] },
    ] });
    case "buildRule": return Promise.resolve({ success: true, built: { ruleType: "field-required", fieldId: "description", fieldName: "Description" }, explanation: "Blocks the transition unless the Description field has a value.", unresolved: [] });
    case "listProjects": return Promise.resolve(PROJECTS);
    case "getProjectWorkflows": return Promise.resolve(WORKFLOWS);
    case "getWorkflowTransitions": return Promise.resolve(TRANSITIONS);
    case "registerConfig": return Promise.resolve({ success: true });
    case "registerPostFunction": return Promise.resolve({ success: true, codeKey: "pf_code:demo:hash" });
    case "injectWorkflowRule": return Promise.resolve({ success: true });
    case "discoverWorkflowRules": return Promise.resolve({ success: true, rules: [] });
    case "testValidation": return Promise.resolve({ success: true, isValid: true, reason: "The description includes clear steps to reproduce, the expected behavior, and the actual behavior. It meets the rule.", fieldId: "description", fieldValue: "Steps to reproduce:\n1. Open checkout\n2. Apply a coupon\nExpected: discount applied. Actual: 500 error.", issueKey: "DEMO-123", mode: "standard", executionTimeMs: 1840, logs: ["Reading field: description", "Running AI validation…", "Result: PASS"], toolInfo: null });
    case "testSemanticPostFunction": return Promise.resolve({ success: true, decision: "UPDATE", reason: "The description describes a customer-facing checkout regression — writing an executive summary.", proposedValue: "• Checkout fails when a coupon is applied (500 error)\n• Customer impact: all coupon users blocked\n• Next: hotfix the coupon service", targetFieldId: "customfield_10001", executionTimeMs: 2100 });
    case "testPostFunction": return Promise.resolve({ success: true, isValid: true, mode: "live", issueKey: "PROJ-42", logs: ["getIssue(\"PROJ-42\") — OK (Payment retry fails)", "searchJql — returned 3 issues", "updateIssue — DRY RUN", "addComment — DRY RUN"], changes: [
      { action: "updateIssue", key: "PROJ-42", fields: { priority: { name: "High" }, labels: ["escalated"] } },
      { action: "addComment", key: "PROJ-42" },
      { action: "transitionIssue", key: "PROJ-42", transitionId: "31" },
      { action: "setAssignee", key: "PROJ-42", accountId: "5f00aa" },
    ], result: { commented: true, count: 3 }, executionTimeMs: 1600 });
    case "narrateDryRun": return Promise.resolve({ success: true, summary: "This step raises PROJ-42 to High priority, tags it \"escalated\", posts a comment, moves it to the next status, and assigns it to a teammate.", verify: ["Confirm \"High\" is the intended priority", "Check the comment wording is customer-safe", "Make sure transition 31 is the right next status"] });
    case "getProvider": return Promise.resolve({ success: true, provider: "anthropic", baseUrl: "https://api.anthropic.com", providers: PROVIDER_LIST, bedrockAck: false });
    case "getOpenAIKey":
      // First-run no-key state (window.__NOKEY__): a BYOK provider with no key stored →
      // hasKey:false (matches the real getOpenAIKey shape). Exercises the provider-warning.
      if (typeof window !== "undefined" && window.__NOKEY__) return Promise.resolve({ success: true, provider: "anthropic", baseUrl: "https://api.anthropic.com", hasKey: false, isByok: false });
      if (payload && payload.provider === "lmstudio") return Promise.resolve({ success: true, provider: "lmstudio", baseUrl: LM_URL, hasKey: false, hasToken: true, isByok: true });
      return Promise.resolve(isAdmin ? { success: true, provider: "anthropic", baseUrl: "https://api.anthropic.com", hasKey: true, isByok: true } : { success: true, isByok: false });
    case "getOpenAIModels":
      if (payload && payload.provider === "lmstudio") return Promise.resolve({ success: true, isByok: true, models: LM_MODELS.map((m) => m.id), modelDetails: LM_MODELS });
      return Promise.resolve({ success: true, isByok: true, models: ["claude-haiku-4-5-20251001", "claude-sonnet-4-6-20260101", "claude-opus-4-1-20250805", "claude-3-7-sonnet-20250219"] });
    case "getOpenAIModelFromKVS": return Promise.resolve(payload && payload.provider === "lmstudio" ? { success: true, model: "qwen/qwen3.6-27b", isByok: true } : { success: true, model: "claude-haiku-4-5-20251001", isByok: true });
    case "pingLmStudio": return Promise.resolve({ success: true, ok: true, authOk: true, modelCount: LM_MODELS.length, message: `Connected — ${LM_MODELS.length} model(s) available` });
    case "loadLmStudioModel": return Promise.resolve({ success: true });
    case "getLmStudioMcps": return Promise.resolve({ success: true, enabled: { context7: true, webSearch: true, docReader: true, docWriter: false, localContext7: false, localWebSearch: false, localDocReader: false }, supported: [{ key: "context7", label: "context7", tools: ["resolve-library-id", "query-docs"] }, { key: "webSearch", label: "web-search", tools: ["get-web-search-summaries", "full-web-search", "get-single-web-page-content", "get-pdf-content"] }, { key: "docReader", label: "doc-reader", tools: ["read-doc"] }] });
    case "getDocProcessorRemote": return Promise.resolve({ success: true, url: "", hasBearer: false });
    case "getWebSearchRemote": return Promise.resolve({ success: true, url: "", hasBearer: false, hasSerperKey: false, hasGithubToken: false });
    case "getContext7Remote": return Promise.resolve({ success: true, url: "https://mcp.context7.com/mcp", hasApiKey: false, isDefault: true });
    case "getLmStudioConcurrency": return Promise.resolve({ success: true, limit: 0 });
    case "getLmStudioPool": return Promise.resolve({ success: true, enabled: true });
    case "getLmStudioWeights": return Promise.resolve({ success: true, weights: { "qwen/qwen3.6-35b-a3b": "3" }, models: LM_WEIGHT_MODELS });
    case "getAppAdmins": return Promise.resolve(ADMINS);
    case "searchUsers": return Promise.resolve({ success: true, users: [{ accountId: "557058:55555555-5555-5555-5555-555555555555", displayName: "Alex Newman", avatarUrl: "https://secure.gravatar.com/avatar/ddd?d=identicon&s=24" }, { accountId: "557058:66666666-6666-6666-6666-666666666666", displayName: "Jordan Lee", avatarUrl: null }] });
    case "getContextDocs": return Promise.resolve(DOCS);
    case "getContextDocContent": return Promise.resolve({ success: true, doc: { content: '{\n  "orders": { "GET /v2/orders": "List orders" }\n}' } });
    case "getKnowledgeCounts": return Promise.resolve({ success: true, docs: 4, skills: 6, memories: 12 });
    case "getSkills": return Promise.resolve({ success: true, skills: [
      { id: "sk1", name: "Create a linked issue", category: "Jira API", builtin: true, description: "Create and link a sub-task or related issue via the REST API." },
      { id: "sk2", name: "Find duplicates by summary", category: "Workflow Patterns", builtin: true, description: "Search the project with JQL for issues with a similar summary." },
      { id: "sk3", name: "Build an ADF comment", category: "ADF & Formatting", builtin: true, description: "Construct a valid Atlassian Document Format comment body." },
      { id: "sk4", name: "Read a custom field safely", category: "Fields & Data", builtin: true, description: "Read a custom field by id, handling missing or null values." },
      { id: "sk5", name: "Post to an external webhook", category: "External / Webhooks", builtin: false, description: "Notify an external service on a transition." },
      { id: "sk6", name: "Summarize a description", category: "Other", builtin: false, description: "Condense a long description into a short, structured summary." },
    ] });
    case "getMemories": return Promise.resolve({ success: true, memories: [
      { id: "m1", content: "This instance stores the team in customfield_10003 (Team), not Components.", source: "learned", createdAt: "2026-06-14T10:00:00Z" },
      { id: "m2", content: "Release Notes is customfield_10042 and accepts plain text.", source: "learned", createdAt: "2026-06-12T09:00:00Z" },
      { id: "m3", content: "Transitions to Done require a non-empty resolution.", source: "user", createdAt: "2026-06-10T08:00:00Z" },
      { id: "m4", content: "The Risk Level field options are Low, Medium, High, Critical.", source: "learned", createdAt: "2026-06-09T08:00:00Z" },
      { id: "m5", content: "Bugs use the 'Software Simplified Workflow'.", source: "user", createdAt: "2026-06-08T08:00:00Z" },
    ] });
    case "generatePostFunctionCode": return Promise.resolve({ success: true, code: STATIC_CODE_1, meta: { appliedDocs: [{ id: "builtin_doc_jql", title: "JQL Cheat Sheet" }], appliedSkills: [], appliedMemories: 1, truncatedDocs: [] } });
    case "searchIssues": return Promise.resolve({ success: true, issues: [{ key: "PROJ-481", fields: { summary: "Checkout latency spike on mobile", status: { name: "In Progress" }, issuetype: { name: "Bug" } } }] });
    case "validateIssue": return Promise.resolve({ success: true, valid: true, summary: "Checkout latency spike on mobile", status: "In Progress", type: "Bug" });
    default: return Promise.resolve({ success: true });
  }
}

const view = {
  getContext: async () => getContext(),
  theme: { enable: async () => { applyTheme(); } },
};
const router = { open: () => {}, navigate: () => {} };
const requestJira = async () => ({ ok: true, json: async () => ({}) });

export { invoke, view, router, requestJira };
export default { invoke, view, router, requestJira };
