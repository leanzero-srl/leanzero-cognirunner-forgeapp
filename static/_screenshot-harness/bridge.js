/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
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
 *   view-premade-git -> config-view read-only summary of a saved GIT premade rule (F-380)
 */

/* F-085: the edition facts below come from the ONE home for them. A harness that
   re-states the frontier ids or invents feature ids stops being able to catch a
   drift between the app and src/shared/edition.js — it just agrees with itself. */
import { FORGE_LLM_FRONTIER, FORGE_LLM_DEFAULT, ADVANCED_FEATURES } from "../../src/shared/edition.js";
/* F-090: the allowance block the mock serves is COMPUTED by the same function the
   backend calls (forgeLlmAllowanceStatus), from the same seat->dollars rule
   (allowanceUsdForSeats). It used to be hand-written, and it hand-wrote `pct: 46`
   for a field that is a 0-1 FRACTION — so the harness happily photographed a meter
   that reads 0% on every real tenant. A derived payload cannot have a wrong shape. */
import { emptyState, monthKey, allowanceUsdForSeats, forgeLlmAllowanceStatus } from "../../src/shared/usage-meter.js";
/* F-175: the memory caps and the cap REFUSAL SENTENCE come from the ONE home for them
   (src/shared/registry-limits.js), exactly as the addMemory resolver does. The mock used
   to hand-type its own near-miss of that sentence ("...prune in the Memories tab.") — so
   the Memories tabs, which render this `error` verbatim, were photographed and asserted
   against words no tenant ever sees. A retyped cap number or sentence is the N-copies
   defect this file's other imports exist to prevent.
   F-182: an earlier revision of this note quoted the backend as offering "archive or
   delete" as the way to make room. That was true of neither the sentence nor the policy:
   the app evicts ONLY non-archived auto-captured rows, so an archived memory keeps its
   slot and still counts toward the cap. Archiving takes a memory out of prompts; it does
   not reclaim capacity, and DELETING is the only thing that does. The sentence this mock
   now serves is imported, not quoted, so it cannot drift from that policy again. */
/* F-189: the byte guard, the PLATFORM ceiling and the over-platform refusal sentence come
   from the same one home as the cap sentence above. memoryPlatformCapMessage() interpolates
   the deficit AND the platform number, so a hand-typed copy here would photograph a limit
   no tenant has — the exact defect the import above exists to prevent. */
import { MAX_MEMORIES, memoryCapRefusalMessage, MEMORY_MAX_SERIALIZED_BYTES, MEMORY_PLATFORM_MAX_SERIALIZED_BYTES, memoryPlatformCapMessage } from "../../src/shared/registry-limits.js";

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
  // Registry pressure — the Rules tab's usage meter (shape = registryPressure()
  // in src/shared/registry-limits.js: measured against the REAL 240KiB capacity,
  // refusal point exposed separately).
  registry: { count: 30, bytes: 58240, max: 500, maxBytes: 245760, refuseAtBytes: 200000, rowPct: 0.094, bytePct: 0.237, pct: 0.237, level: "ok", refusing: false },
  configs: [
    {
      id: "cr::Software Dev Workflow::21::a1b2c3", type: "validator", fieldId: "description",
      prompt: "Block this transition unless the Description contains clear, testable acceptance criteria and a rollback plan.",
      workflow: { workflowId: "wf-software-dev-001", workflowName: "Software Dev Workflow", projectId: "10001", transitionId: "21", transitionFromName: "In Progress", transitionToName: "In Review", siteUrl: SITE },
      instanced: true, createdBy: ACCT, createdByName: "Mihai Perdum", createdAt: "2026-05-01T09:12:00.000Z", updatedAt: "2026-06-15T14:30:00.000Z", disabled: false,
    },
    {
      // A shipped FIELD-BASED deterministic condition (custom field, exprKind-resolved).
      id: "cr::Bug Triage::31::d4e5f6", type: "condition", ruleKind: "premade", premadeRuleType: "field-equals",
      fieldId: "customfield_10031", fieldName: "Severity", exprProp: "customfield_10031", exprKind: "opt", value: "Critical",
      workflow: { workflowId: "wf-bug-triage-002", workflowName: "Bug Triage", projectId: "10002", transitionId: "31", transitionFromName: "Open", transitionToName: "Escalated", siteUrl: SITE },
      instanced: true, createdBy: "557058:22222222-2222-2222-2222-222222222222", createdByName: "Dana Kovacs", createdAt: "2026-04-20T08:00:00.000Z", updatedAt: "2026-06-10T11:05:00.000Z", disabled: false,
    },
    {
      // REST-attached, then claimed by Scan → Register all: UNOWNED (claiming is
      // not authoring) — renders the Owner column's "Unowned" chip.
      id: "provision-dod-check-v2", type: "validator", fieldId: "summary",
      prompt: "Definition-of-done gate provisioned over the REST API for every team workflow.",
      workflow: { workflowId: "wf-platform-008", workflowName: "Platform Intake", projectId: "10008", transitionId: "91", transitionFromName: "Ready", transitionToName: "In Delivery", siteUrl: SITE },
      instanced: true, discovered: true, claimedBy: "557058:33333333-3333-3333-3333-333333333333", claimedByName: "Priya Raman", createdAt: "2026-06-02T08:00:00.000Z", updatedAt: "2026-06-18T09:00:00.000Z", disabled: false,
    },
    {
      id: "cr::Release Workflow::41::a7b8c9", type: "postfunction-semantic", fieldId: "description", prompt: "",
      conditionPrompt: "If the release notes mention a breaking change…",
      actionPrompt: "…set the 'Risk Level' field to 'High' and summarize the breaking change.",
      actionFieldId: "customfield_10042", functions: [],
      workflow: { workflowId: "wf-release-003", workflowName: "Release Workflow", projectId: "10003", transitionId: "41", transitionFromName: "Staging", transitionToName: "Production", siteUrl: SITE },
      instanced: true, disabled: false, createdBy: ACCT, createdAt: Date.parse("2026-05-12T10:00:00.000Z"), updatedAt: Date.parse("2026-06-16T09:45:00.000Z"),
    },
    {
      id: "cr::Onboarding::51::e1f2a3", type: "postfunction-static", fieldId: "", prompt: "",
      conditionPrompt: "When an issue enters 'Provisioning', create the standard onboarding sub-tasks.", actionPrompt: "",
      actionFieldId: "customfield_10055",
      functions: [{ id: "fn1", name: "Create onboarding subtasks", operationType: "rest_api_internal", variableName: "result" }],
      workflow: { workflowId: "wf-onboarding-004", workflowName: "Onboarding", projectId: "10004", transitionId: "51", transitionFromName: "Approved", transitionToName: "Provisioning", siteUrl: SITE },
      instanced: true, disabled: false, createdBy: "557058:22222222-2222-2222-2222-222222222222", createdByName: "Dana Kovacs", createdAt: "2026-03-30T07:30:00.000Z", updatedAt: "2026-06-01T16:20:00.000Z",
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
      instanced: true, createdBy: ACCT, createdAt: Date.parse("2026-05-18T09:00:00.000Z"), updatedAt: Date.parse("2026-06-17T10:00:00.000Z"), disabled: false,
    },
    // --- Bulk filler so the table has MORE THAN ONE PAGE ---------------------
    // Pagination, newest-first ordering and the sticky header are only meaningful
    // above the page size; 8 hand-written rules could never exercise them. These
    // carry DESCENDING updatedAt with a deliberate SHUFFLE in the source array, so
    // a test that reads the rendered order is checking the sort, not the fixture.
    ...(() => {
      const rows = [];
      for (let i = 1; i <= 22; i++) {
        const day = String(i).padStart(2, "0");
        rows.push({
          id: `cr::Bulk Workflow::9${day}::bulk${day}`, type: i % 3 === 0 ? "condition" : "validator",
          fieldId: "summary",
          prompt: `Bulk seeded rule ${i} — checks the Summary before leaving Backlog.`,
          workflow: { workflowId: `wf-bulk-${day}`, workflowName: `Bulk Workflow ${i}`, projectId: "10009", transitionId: `9${day}`, transitionFromName: "Backlog", transitionToName: "Selected", siteUrl: SITE },
          instanced: true, disabled: false,
          createdBy: ACCT, createdByName: "Mihai Perdum",
          // EPOCH-MS NUMBERS, deliberately — this is what slimRegistryRow actually
          // persists (ISO strings are halved to numbers to fit 500 rows under the
          // KVS cap). The hand-written rules above keep ISO strings, so the fixture
          // carries BOTH shapes and any reader that handles only one is caught here
          // rather than on the live site.
          createdAt: Date.parse(`2026-01-${day}T08:00:00.000Z`),
          // 2026-02-01 .. 2026-02-22 — all OLDER than every hand-written rule above,
          // so the hand-written ones must occupy page 1.
          updatedAt: Date.parse(`2026-02-${day}T08:00:00.000Z`),
        });
      }
      // Shuffle deterministically (odd indices first) so source order != sorted order.
      return [...rows.filter((_, i) => i % 2 === 1), ...rows.filter((_, i) => i % 2 === 0)];
    })(),
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
// F-350 — a premade VALIDATOR opened in premade mode with NO ruleType yet, so the
// journey picks a git rule ("PR merged") itself and drives the whole group from empty:
// connection → repository (narrowed to that connection's allow-list) → prMatch → strict.
// A validator, not a condition: the `git` param GROUP only exists on the validator half
// of the catalogue (conditions carry a single `repo` picker instead).
const CFG_PREMADE_GIT = {
  id: "validator::Software Simplified Workflow::21::i-premade-git",
  workflow: { workflowId: "wf-software-simplified-12345", workflowName: "Software Simplified Workflow", transitionId: "21" },
  ruleKind: "premade", ruleType: "",
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
// F-157 — the fix mock must return code that DIFFERS from the step's current code. A real
// landed fix always changes the source, which is what makes `learnedFrom` diverge after an
// Undo; returning STATIC_CODE_1 unchanged made that whole branch unreachable in the harness.
const STATIC_CODE_FIXED = STATIC_CODE_1.replace(
  'api.log("Found "',
  'if (!results || !results.issues) return [];\napi.log("Found "',
);
// F-158 — a SECOND fix must land DIFFERENT code again, or the first memory's
// `learnedFrom` fingerprint still matches what is on screen and the outside-card note
// (which is where the badge belongs once it is not this fix's) can never appear.
const STATIC_CODE_FIXED_2 = STATIC_CODE_FIXED.replace(
  "return results.issues || [];",
  "return (results.issues || []).slice(0, 50);",
);
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

/* ----------------------------- editions (1.3) -------------------------------- */
/* Default shot state is the Coder (advanced) edition. Set window.__STANDARD__ = true
   before the app mounts to flip EVERY edition surface to Standard: the chip, the
   locked Sonnet/Opus rows, the upgrade copy and the agent-model lock. */
/* Third scenario (F-106): window.__UNLICENSED__ = true models a LIVE INSTALL WITH NO
   LICENSE OBJECT — `context.license` is absent and checkLicense answers
   { isActive: null, edition: "standard", source: "none" }. This is the shape a
   development / unlisted install actually returns (proven on dev), and it is the
   case that used to render NO chip at all because every surface gated the chip on
   `licenseActive !== null`. Capability-wise an unlicensed tenant IS Standard, so it
   folds into isStandardEd() for the model lists, the locks and the allowance — only
   the license SIGNAL (isActive/source) differs. */
const isUnlicensedEd = () => typeof window !== "undefined" && !!window.__UNLICENSED__;
const isStandardEd = () => typeof window !== "undefined" && (!!window.__STANDARD__ || !!window.__UNLICENSED__);

/* The Coder tenant this harness photographs: 100 seats -> $200 allowance (the seat
   rule in usage-meter.js), $92.40 of Forge LLM spend this month -> 46% used, "ok".
   Only these two numbers are chosen here; the SHAPE and the maths are the app's. */
const MOCK_SEATS = 100;
const MOCK_FORGE_EST_USD = 92.4;
function mockAllowance() {
  const now = Date.now();
  const st = emptyState();
  st.month.key = monthKey(now);
  st.month.forgeLlm.estUsd = MOCK_FORGE_EST_USD;
  return forgeLlmAllowanceStatus(st, allowanceUsdForSeats(MOCK_SEATS), now);
}
const edName = () => (isStandardEd() ? "standard" : "advanced");
const FORGE_FRONTIER = FORGE_LLM_FRONTIER;
const FORGE_HAIKU = FORGE_LLM_DEFAULT;
const mockLicenseCtx = () => (isUnlicensedEd()
  ? null // no license property at all — resolveEdition() answers active:null, source:"none"
  : isStandardEd()
    ? { active: true, isActive: true, capabilitySet: "capabilityStandard", state: "standard", type: "PAID" }
    : { active: true, isActive: true, capabilitySet: "capabilityAdvanced", state: "advanced", type: "PAID" });

/* ----------------------------- context router -------------------------------- */
function getContext() {
  const s = shot();
  const baseExt = { workflowId: "wf-software-simplified-12345", workflowName: "Software Simplified Workflow", scopedProjectId: "10001" };
  if (s === "cfg-validator")
    return { accountId: ACCT, siteUrl: SITE, license: mockLicenseCtx(), extension: { ...baseExt, type: "jira:workflowValidator", key: "ai-text-field-validator", entryPoint: "edit", transitionContext: { id: "21", from: { id: "3", name: "In Progress" }, to: { id: "4", name: "In Review" } }, validatorConfig: JSON.stringify(CFG_VALIDATOR) } };
  if (s === "cfg-condition")
    return { accountId: ACCT, siteUrl: SITE, license: mockLicenseCtx(), extension: { ...baseExt, type: "jira:workflowCondition", key: "ai-text-field-condition", transitionContext: { id: "31", from: { id: "4", name: "In Review" }, to: { id: "5", name: "Done" } }, conditionConfig: JSON.stringify(CFG_CONDITION) } };
  if (s === "cfg-premade")
    return { accountId: ACCT, siteUrl: SITE, license: mockLicenseCtx(), extension: { ...baseExt, type: "jira:workflowCondition", key: "ai-text-field-condition", transitionContext: { id: "31", from: { id: "4", name: "In Review" }, to: { id: "5", name: "Done" } }, conditionConfig: JSON.stringify(CFG_PREMADE_COND) } };
  if (s === "cfg-premade-git")
    return { accountId: ACCT, siteUrl: SITE, license: mockLicenseCtx(), extension: { ...baseExt, type: "jira:workflowValidator", key: "ai-text-field-validator", entryPoint: "edit", transitionContext: { id: "21", from: { id: "3", name: "In Progress" }, to: { id: "4", name: "In Review" } }, validatorConfig: JSON.stringify(CFG_PREMADE_GIT) } };
  if (s === "cfg-semantic")
    return { accountId: ACCT, siteUrl: SITE, license: mockLicenseCtx(), extension: { ...baseExt, type: "jira:workflowPostFunction", key: "ai-semantic-post-function", transitionContext: { id: "21", from: { id: "3", name: "In Progress" }, to: { id: "4", name: "In Review" } }, postFunctionConfig: JSON.stringify(CFG_SEMANTIC) } };
  if (s === "cfg-managed") {
    // A MANAGED semantic flavor (comment/subtask/generate-doc/research/research-doc/link). The
    // flavor type is chosen via window.__MANAGED__. The config-ui workflow editor is READ-ONLY for
    // these — it shows an "edit this in the admin panel" notice (they are configured in AddRuleWizard).
    const mt = (typeof window !== "undefined" && window.__MANAGED__) || "postfunction-comment";
    const managedCfg = {
      id: "postfunction-managed::Software Simplified Workflow::21::i-mng", type: mt,
      workflow: { workflowId: "wf-software-simplified-12345", workflowName: "Software Simplified Workflow", transitionId: "21" },
      fieldId: "description",
      commentPrompt: "Post a friendly status update summarizing what changed and the next step.",
      docTitlePrompt: "A concise title for the generated document", docFormat: "markdown",
      researchQuery: "Latest known issues for the components mentioned in this ticket",
    };
    return { accountId: ACCT, siteUrl: SITE, license: mockLicenseCtx(), extension: { ...baseExt, type: "jira:workflowPostFunction", key: "ai-semantic-post-function", transitionContext: { id: "21", from: { id: "3", name: "In Progress" }, to: { id: "4", name: "In Review" } }, postFunctionConfig: JSON.stringify(managedCfg) } };
  }
  if (s === "cfg-static") {
    // F-133 — window.__STEP_NO_CODE__ blanks step 1's code + provenance so the harness can
    // drive a FIRST generate (no code yet), where the local template fallback is legitimate.
    const staticCfg = (typeof window !== "undefined" && window.__STEP_NO_CODE__)
      ? { ...CFG_STATIC, functions: CFG_STATIC.functions.map((f, i) => (i === 0 ? { ...f, code: "", generationMeta: null } : f)) }
      : CFG_STATIC;
    return { accountId: ACCT, siteUrl: SITE, license: mockLicenseCtx(), extension: { ...baseExt, type: "jira:workflowPostFunction", key: "ai-static-post-function", transitionContext: { id: "11", from: { id: "1", name: "To Do" }, to: { id: "3", name: "In Progress" } }, postFunctionConfig: JSON.stringify(staticCfg) } };
  }
  if (s === "view-static-offloaded")
    // An OFFLOADED static PF (config >24KB → code moved to pf_code): functions:[] + name-only functionsMeta.
    // config-view must render the step NAMES from functionsMeta (never the full details). E11 path.
    return { accountId: ACCT, siteUrl: SITE, license: mockLicenseCtx(), extension: { ...baseExt, type: "jira:workflowPostFunction", key: "ai-static-post-function", entryPoint: "view", transitionContext: { id: "81", from: { name: "Triaged" }, to: { name: "Mitigating" } }, postFunctionConfig: JSON.stringify({ id: "postfunction-static::Incident::81::i-offload", type: "postfunction-static", fieldId: "", functions: [], functionsMeta: [{ id: "s1", name: "Escalate priority to High", operationType: "rest_api_internal", variableName: "r1" }, { id: "s2", name: "Add on-call watcher", operationType: "rest_api_internal", variableName: "r2" }], workflow: { workflowId: "wf-incident-007", workflowName: "Incident Response", transitionId: "81", siteUrl: SITE } }) } };
  if (s === "view-premade-git")
    /* F-380 - a SAVED git premade rule opened in the READ-ONLY view. The whole point of the
       arm is the connection row: config-view has no picker, so if it cannot resolve `gc_1`
       to "Acme engineering" nobody on that screen ever can. The config stores the id, the
       editor-floor getRuleLists rows carry the label, and the fixture keeps them in the two
       places they really live. */
    return { accountId: ACCT, siteUrl: SITE, license: mockLicenseCtx(), extension: { ...baseExt, type: "jira:workflowValidator", key: "cognirunner-validator", entryPoint: "view", transitionContext: { id: "21", from: { name: "In Progress" }, to: { name: "Done" } }, validatorConfig: { ...CFG_PREMADE_GIT, type: "validator", ruleType: "git-pr-merged", connectionId: "gc_1", repo: "acme/web", prMatch: "both", strict: true } } };
  if (s === "view-active" || s === "view-disabled")
    return { accountId: ACCT, siteUrl: SITE, license: mockLicenseCtx(), extension: { ...baseExt, type: "jira:workflowValidator", key: "cognirunner-validator", entryPoint: "view", transitionContext: { id: "21", from: { name: "In Progress" }, to: { name: "Done" } }, validatorConfig: VIEW_VALIDATOR_CONFIG } };
  if (s.startsWith("issue-glance")) {
    /* F-294 - the issue-glance BUNDLE backs TWO manifest modules off one resource:
         jira:issueContext  cognirunner-issue-glance  (the activity glance)
         jira:issuePanel    coder-panel               (the 1.4 placeholder)
       window.__MODULE_KEY__ = "coder-panel" mounts it as the panel. The mock now also
       carries the fields the REAL bridge carries and this mock previously did not:
       a TOP-LEVEL `moduleKey` (the documented FullContext field - @forge/bridge
       types.d.ts) and a `localId` ARI. Without them the mock could not have caught a
       reader that looked in the wrong place, because it only ever set extension.key. */
    const mk = (typeof window !== "undefined" && window.__MODULE_KEY__) || "cognirunner-issue-glance";
    const isPanel = mk === "coder-panel";
    return {
      accountId: ACCT, siteUrl: SITE, license: mockLicenseCtx(), theme: { colorMode: theme() },
      moduleKey: mk,
      localId: `ari:cloud:ecosystem::extension/36415848-6868-4697-9554-3c3ad87b8da9/env-dev/static/${mk}`,
      extension: {
        type: isPanel ? "jira:issuePanel" : "jira:issueContext",
        key: mk,
        issue: { id: "10042", key: "DEMO-42" },
        project: { id: "10000", key: "DEMO" },
      },
    };
  }
  // default: the admin page, reached as a real admin.
  // F-200 / F-213 — `__NOT_ADMIN__` switches the MODULE as well as checkIsAdmin, and still
  // should: `jira:globalPage` (cognirunner-global-page) is the entry point a non-admin
  // genuinely reaches the app through, so pairing the two is what makes the editor scenario
  // honest rather than a half-state no tenant is in. (It was once also NECESSARY, because
  // App.js auto-admined on `jira:adminPage` and no resolver answer could produce
  // `isAdmin: false` under that module. F-213 deleted that override — admin-ness is the
  // role resolver's answer on both modules — so the module switch is now fidelity, not a
  // workaround.)
  // F-213 - `__DEMOTED_ADMIN__` is the OTHER half of the pair: the module IS
  // `jira:adminPage` (so Jira's own admin permission was enforced to get here) while
  // `checkIsAdmin` answers editor/mine, which an app-level role demotion really does
  // produce. It no longer models an OVERRIDE - App.js does not derive admin-ness from the
  // module any more, because `requireAdmin` in src/index.js is the only authority and a
  // frontend that disagrees paints controls the backend refuses (that WAS F-210). What the
  // flag now proves is the pair of things F-213 asks for: editor permissions survive on
  // jira:adminPage, AND that module (alone) earns the slate `.role-note` explaining the
  // bare page. __NOT_ADMIN__ cannot test either, because it switches the module away -
  // which is exactly what makes it the control for the note.
  // F-219 — a viewer reaches the app the same way an editor does: jira:globalPage.
  // F-234 — `__NO_ROSTER__` reaches the app the same way an editor or a viewer does:
  // jira:globalPage. A user with no CogniRunner role could not be on jira:adminPage.
  const notAdmin = typeof window !== "undefined" && (!!window.__NOT_ADMIN__ || !!window.__VIEWER__ || !!window.__NO_ROSTER__);
  return { extension: notAdmin ? { type: "jira:globalPage", key: "cognirunner-global-page" } : { type: "jira:adminPage", key: "cognirunner-admin-page" }, license: mockLicenseCtx(), siteUrl: SITE, accountId: ACCT, cloudId: "00000000-aaaa-bbbb-cccc-000000000000", localId: "mock-local-id", theme: { colorMode: theme() }, locale: "en-US" };
}


/* ----------------------------- admin: listeners + scheduled jobs + API tokens ---- */
const LISTENER_ROWS = [
  { id: "lst_a1", name: "Escalate customer complaints", enabled: true, events: ["avi:jira:commented:issue", "avi:jira:mentioned:comment"], projectKeys: ["PROJ"], mode: "agent", hasAiCondition: true, simulationMode: false, createdBy: ACCT, updatedAt: "2026-08-30T10:00:00.000Z", stats: { runCount: 14, errorCount: 0, lastRunAt: "2026-09-01T08:12:00.000Z", lastStatus: "ok", lastIssueKey: "PROJ-42" } },
  { id: "lst_b2", name: "Label new bugs for triage", enabled: true, events: ["avi:jira:created:issue"], projectKeys: [], mode: "script", hasAiCondition: false, simulationMode: true, createdBy: ACCT, updatedAt: "2026-08-28T10:00:00.000Z", stats: { runCount: 3, errorCount: 1, lastRunAt: "2026-08-31T18:40:00.000Z", lastStatus: "error", lastError: "updateIssue failed: 400 — labels: The label 'needs triage' contains spaces" } },
  { id: "lst_c3", name: "Version released → announce", enabled: false, events: ["avi:jira:released:version", "avi:jira:created:version", "avi:jira:updated:version", "avi:jira:deleted:version"], projectKeys: ["PROJ", "OPS"], mode: "script", hasAiCondition: false, simulationMode: false, createdBy: "other", updatedAt: "2026-08-20T10:00:00.000Z", stats: { runCount: 0 } },
];
const LISTENER_FULL = {
  lst_a1: { id: "lst_a1", name: "Escalate customer complaints", description: "Customer-facing comments that read like complaints get escalated.", enabled: true, events: ["avi:jira:commented:issue", "avi:jira:mentioned:comment"], filters: { projectKeys: ["PROJ"], issueTypes: ["Bug", "Support"], jql: "", changedFields: [], commentPattern: "" }, ignoreSelf: true, aiCondition: "the comment is a customer complaint or asks for an escalation", mode: "agent", functions: [], agent: { instructions: "Add the label 'escalate', set priority to Highest if it is lower, and reply with a short polite acknowledgement.", allowedActions: ["get_issue", "add_comment", "add_labels", "update_fields"], maxRounds: 5 }, simulationMode: false, suppressNotifications: false, createdBy: ACCT, createdAt: "2026-08-30T10:00:00.000Z", updatedAt: "2026-08-30T10:00:00.000Z", stats: LISTENER_ROWS[0].stats },
  lst_b2: { id: "lst_b2", name: "Label new bugs for triage", description: "", enabled: true, events: ["avi:jira:created:issue"], filters: { projectKeys: [], issueTypes: ["Bug"], jql: "", changedFields: [], commentPattern: "" }, ignoreSelf: true, aiCondition: "", mode: "script", functions: [{ id: "fn-1", name: "Add triage label", operationType: "work_item_query", operationPrompt: "Add the label needs-triage to the new bug", variableName: "result1", code: "await api.addLabels(\"needs-triage\");\nreturn { success: true };", includeBackoff: false, method: "GET", endpoint: "", conditionPrompt: "" }], agent: { instructions: "", allowedActions: ["get_issue", "search_issues", "add_comment"], maxRounds: 5 }, simulationMode: true, suppressNotifications: false, createdBy: ACCT, createdAt: "2026-08-28T10:00:00.000Z", updatedAt: "2026-08-28T10:00:00.000Z", stats: LISTENER_ROWS[1].stats },
};
const JOB_ROWS = [
  { id: "job_a1", name: "Nudge stale In Progress issues", enabled: true, schedule: { cron: "0 9 * * 1-5", timeZone: "Europe/Zurich" }, scoped: true, mode: "agent", simulationMode: false, createdBy: ACCT, updatedAt: "2026-08-30T10:00:00.000Z", stats: { runCount: 22, errorCount: 0, lastRunAt: "2026-09-01T07:00:00.000Z", lastStatus: "ok", nextRunAt: "2026-09-02T07:00:00.000Z" } },
  { id: "job_b2", name: "Weekly release digest", enabled: false, schedule: { cron: "0 17 * * 5", timeZone: "UTC" }, scoped: false, mode: "script", simulationMode: false, createdBy: ACCT, updatedAt: "2026-08-20T10:00:00.000Z", stats: { runCount: 4, errorCount: 0, lastRunAt: "2026-08-29T17:00:00.000Z", lastStatus: "ok", nextRunAt: null } },
];
const JOB_FULL = {
  job_a1: { id: "job_a1", name: "Nudge stale In Progress issues", description: "", enabled: true, schedule: { cron: "0 9 * * 1-5", timeZone: "Europe/Zurich" }, scope: { jql: "project = PROJ AND status = \"In Progress\" AND updated <= -7d", maxIssues: 25 }, mode: "agent", functions: [], agent: { instructions: "Ask the assignee for a status update in a short comment and add the label 'stale'. Skip issues that already carry the label.", allowedActions: ["get_issue", "add_comment", "add_labels"], maxRounds: 4 }, simulationMode: false, suppressNotifications: false, createdBy: ACCT, createdAt: "2026-08-30T10:00:00.000Z", updatedAt: "2026-08-30T10:00:00.000Z", stats: JOB_ROWS[0].stats },
  job_b2: { id: "job_b2", name: "Weekly release digest", description: "", enabled: false, schedule: { cron: "0 17 * * 5", timeZone: "UTC" }, scope: null, mode: "script", functions: [{ id: "fn-1", name: "Digest", operationType: "work_item_query", operationPrompt: "Find issues resolved this week and post a digest comment on PROJ-1", variableName: "result1", code: "const r = await api.searchJql(\"resolved >= startOfWeek()\");\nawait api.forIssue(\"PROJ-1\").addComment(`${r.issues.length} issues resolved this week`);\nreturn r.issues.length;", includeBackoff: false, method: "GET", endpoint: "", conditionPrompt: "" }], agent: { instructions: "", allowedActions: ["get_issue", "search_issues", "add_comment"], maxRounds: 5 }, simulationMode: false, suppressNotifications: false, createdBy: ACCT, createdAt: "2026-08-20T10:00:00.000Z", updatedAt: "2026-08-20T10:00:00.000Z", stats: JOB_ROWS[1].stats },
};
const LISTENER_TEST_RESULT = { type: "listener", source: "test", isValid: true, reason: "Ran 1 step(s), 1 change(s)", executionTimeMs: 812, eventType: "avi:jira:created:issue", eventUsed: "synthetic", gate: null, changes: [{ action: "addLabels", key: "PROJ-42", simulated: true }], logs: ["Starting 1 step(s) for PROJ-42", "\"Add triage label\": [SIMULATION] editIssue(\"PROJ-42\", update {\"labels\":[{\"add\":\"needs-triage\"}]})", "\"Add triage label\": Completed in 310ms", "Finished: 1/1 step(s) succeeded in 812ms, 1 change(s) made"] };
const API_TOKENS = { success: true, url: "https://a1b2c3.hello.atlassian-dev.net/x1/demo-rules-api", tokens: [{ id: "tok_1", name: "CI pipeline", prefix: "cgr_0a1b2c", createdAt: "2026-08-20T10:00:00.000Z", createdBy: ACCT, lastUsedAt: "2026-09-01T06:00:00.000Z", revokedAt: null }] };

/* ----------------------------- MARKETING dataset (admin-* scenarios) --------------
 * The `admin` scenario above is pinned by listeners-jobs.test.mjs (row counts, badge
 * counts, project names) — do NOT grow it. Marketing shots use window.__SHOT__ =
 * "admin-<anything>" and get this richer, realistic dataset instead (5 listeners,
 * 4 jobs, 2 tokens, listener/job execution logs, a completed run report).
 * Shapes mirror src/listeners.js toIndexRow/normalizeListener, src/scheduled-jobs.js
 * toIndexRow/normalizeJob/runJob, src/rules-api.js publicRow and the storeLog entries. */
const fpOf = (s) => { const str = String(s || ""); let h = 0; for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0; return `${str.length}:${h}`; };
const mkStep = (id, name, prompt, code, meta) => ({ id, name, conditionPrompt: "", operationType: "work_item_query", operationPrompt: prompt, endpoint: "", method: "GET", variableName: "result1", code, includeBackoff: false, testedFingerprint: fpOf(code), generationMeta: meta || { appliedDocs: [{ id: "builtin_doc_field_matrix", title: "Field Types & Update Shapes" }], appliedSkills: [{ id: "sk_fields_data", name: "Fields & Data", auto: true }], appliedMemories: 2, truncatedDocs: [] } });
const MKT_PROJECTS = { success: true, projects: [
  { id: "10100", key: "TPP", name: "Team Payments Platform", avatarUrl: null },
  { id: "10101", key: "OPS", name: "Operations", avatarUrl: null },
  { id: "10102", key: "CS", name: "Customer Success", avatarUrl: null },
  { id: "10103", key: "INF", name: "Infrastructure", avatarUrl: null },
] };
const TRIAGE_CODE = `// Flag the vague story and ask the reporter for acceptance criteria
const issue = await api.getIssue(api.context.issueKey);
const reporter = issue.fields.reporter ? issue.fields.reporter.displayName : "there";

await api.addLabels("needs-refinement");
await api.addComment(
  \`Hi \${reporter} — this story needs acceptance criteria before it can be planned. \` +
  "Please add Given / When / Then scenarios and the user outcome."
);
api.log(\`Flagged \${issue.key} for refinement\`);
return { flagged: issue.key };`;
const P1_CODE = `// Raise priority and page the on-call owner
const issue = await api.getIssue(api.context.issueKey);
if (issue.fields.priority && issue.fields.priority.name !== "Highest") {
  await api.updateIssue(issue.key, { priority: { name: "Highest" } });
}
await api.addLabels("p1-escalated");
await api.addWatcher("5f8a2c1e0b3d4e001c9a7b21"); // on-call lead
await api.addComment("Escalated to P1 by CogniRunner — on-call lead added as watcher.");
return { escalated: issue.key };`;
const ATTACH_CODE = `// Tell the assignee a file landed on their ticket
const ev = api.context.event;
const issue = await api.getIssue(ev.issue.key);
const who = issue.fields.assignee;
if (!who) return { skipped: "unassigned" };
await api.addComment(\`[~accountid:\${who.accountId}] a new attachment was added: \${ev.attachment.filename}\`);
return { notified: who.displayName };`;
const SPRINT_CODE = `// Create the kickoff checklist task in the sprint's board project
const sprint = api.context.event.sprint;
await api.createIssue({
  project: { key: "TPP" }, issuetype: { name: "Task" },
  summary: \`Sprint kickoff checklist — \${sprint.name}\`,
  description: "Confirm sprint goal, capacity, dependencies and the demo slot.",
});
return { sprint: sprint.name };`;
const UNASSIGNED_CODE = `// Nudge triage on tickets nobody picked up
const issue = await api.getIssue(api.context.issueKey);
const ageDays = Math.floor((Date.now() - new Date(issue.fields.created)) / 86400000);

await api.addComment(
  \`This ticket has been unassigned for \${ageDays} days. \` +
  "Triage owner: please assign it or move it to the backlog."
);
await api.addLabels("unassigned-alert");
return { key: issue.key, ageDays };`;
const HYGIENE_CODE = `// Normalise the many spellings of "needs triage" to one label
const issue = await api.getIssue(api.context.issueKey);
const bad = (issue.fields.labels || []).filter((l) => /needs[ _-]?triage/i.test(l) && l !== "needs-triage");
if (!bad.length) return { skipped: true };
await api.editIssue(issue.key, { labels: [...bad.map((l) => ({ remove: l })), { add: "needs-triage" }] });
return { key: issue.key, replaced: bad };`;
const DIGEST_CODE = `// Post the release-readiness report on the release epic
const r = await api.searchJql('project = TPP AND fixVersion = earliestUnreleasedVersion() AND status != Done');
const open = r.issues.map((i) => \`• \${i.key} — \${i.fields.summary} (\${i.fields.status.name})\`).join("\\n");
await api.forIssue("TPP-1").addComment(\`Release readiness — \${r.issues.length} item(s) still open:\\n\${open}\`);
return { open: r.issues.length };`;

const MKT_LISTENERS = [
  { id: "lst_triage", name: "Auto-triage vague stories", description: "New stories without acceptance criteria get flagged and the reporter is asked to refine.", enabled: true, events: ["avi:jira:created:issue"], filters: { projectKeys: ["TPP"], issueTypes: ["Story"], jql: "", changedFields: [], commentPattern: "" }, ignoreSelf: true, aiCondition: "the story is vague — no acceptance criteria, no user outcome, or fewer than two sentences of description", mode: "script", functions: [mkStep("fn-triage-1", "Label and ask for acceptance criteria", "Add the label needs-refinement and post a comment asking the reporter for Given/When/Then acceptance criteria", TRIAGE_CODE, { appliedDocs: [{ id: "builtin_doc_adf", title: "ADF Cookbook" }, { id: "builtin_doc_field_matrix", title: "Field Types & Update Shapes" }], appliedSkills: [{ id: "sk_fields_data", name: "Fields & Data", auto: true }], appliedMemories: 3, truncatedDocs: [] })], agent: { instructions: "", allowedActions: ["get_issue", "search_issues", "add_comment"], maxRounds: 5 }, simulationMode: false, suppressNotifications: false, createdBy: ACCT, createdAt: "2026-08-12T09:10:00.000Z", updatedAt: "2026-09-05T14:22:00.000Z", stats: { runCount: 128, errorCount: 2, lastRunAt: "2026-09-07T07:42:00.000Z", lastStatus: "ok", lastError: null, lastIssueKey: "TPP-1187" } },
  { id: "lst_p1", name: "Escalate P1 comments", description: "", enabled: true, events: ["avi:jira:commented:issue", "avi:jira:mentioned:comment"], filters: { projectKeys: ["OPS"], issueTypes: [], jql: "priority != Highest", changedFields: [], commentPattern: "urgent|outage|sev ?1|escalat" }, ignoreSelf: true, aiCondition: "", mode: "script", functions: [mkStep("fn-p1-1", "Raise priority and page on-call", "Set priority to Highest, add the label p1-escalated, add the on-call lead as watcher and acknowledge in a comment", P1_CODE)], agent: { instructions: "", allowedActions: ["get_issue", "search_issues", "add_comment"], maxRounds: 5 }, simulationMode: false, suppressNotifications: false, createdBy: ACCT, createdAt: "2026-08-18T11:00:00.000Z", updatedAt: "2026-09-04T09:05:00.000Z", stats: { runCount: 19, errorCount: 1, lastRunAt: "2026-09-07T05:18:00.000Z", lastStatus: "ok", lastError: null, lastIssueKey: "OPS-433" } },
  { id: "lst_concierge", name: "Customer complaint concierge", description: "Reads customer comments and reacts like a support lead would.", enabled: true, events: ["avi:jira:commented:issue"], filters: { projectKeys: ["CS"], issueTypes: [], jql: "", changedFields: [], commentPattern: "" }, ignoreSelf: true, aiCondition: "the comment is a customer complaint, a churn threat, or asks for an escalation", mode: "agent", functions: [], agent: { instructions: "Read the comment and the ticket. If the customer is complaining or threatening to churn: set priority to High (Highest if they mention a deadline or money), add the label customer-escalation, and reply with a short, warm acknowledgement that names a next step. Never promise a fix date. If the ticket is already Highest, only reply.", allowedActions: ["get_issue", "search_issues", "add_comment", "add_labels", "update_fields"], maxRounds: 4 }, simulationMode: false, suppressNotifications: false, createdBy: ACCT, createdAt: "2026-08-25T08:30:00.000Z", updatedAt: "2026-09-03T16:40:00.000Z", stats: { runCount: 44, errorCount: 0, lastRunAt: "2026-09-07T08:01:00.000Z", lastStatus: "ok", lastError: null, lastIssueKey: "CS-2210" } },
  { id: "lst_attach", name: "Notify on attachment", description: "", enabled: true, events: ["avi:jira:created:attachment"], filters: { projectKeys: ["TPP", "OPS"], issueTypes: [], jql: "", changedFields: [], commentPattern: "" }, ignoreSelf: true, aiCondition: "", mode: "script", functions: [mkStep("fn-att-1", "Mention the assignee", "Comment on the issue mentioning the assignee with the attachment file name", ATTACH_CODE)], agent: { instructions: "", allowedActions: ["get_issue", "search_issues", "add_comment"], maxRounds: 5 }, simulationMode: true, suppressNotifications: true, createdBy: ACCT, createdAt: "2026-09-01T10:00:00.000Z", updatedAt: "2026-09-02T10:15:00.000Z", stats: { runCount: 61, errorCount: 0, lastRunAt: "2026-09-06T16:05:00.000Z", lastStatus: "ok", lastError: null, lastIssueKey: "OPS-402" } },
  { id: "lst_sprint", name: "Sprint kickoff checklist", description: "", enabled: false, events: ["avi:jira-software:started:sprint", "avi:jira-software:closed:sprint"], filters: { projectKeys: [], issueTypes: [], jql: "", changedFields: [], commentPattern: "" }, ignoreSelf: true, aiCondition: "", mode: "script", functions: [mkStep("fn-spr-1", "Create the checklist task", "Create a kickoff checklist task in TPP named after the sprint", SPRINT_CODE)], agent: { instructions: "", allowedActions: ["get_issue", "search_issues", "add_comment"], maxRounds: 5 }, simulationMode: false, suppressNotifications: false, createdBy: "557058:22222222-2222-2222-2222-222222222222", createdAt: "2026-07-14T09:00:00.000Z", updatedAt: "2026-08-21T09:00:00.000Z", stats: { runCount: 6, errorCount: 0, lastRunAt: "2026-08-21T09:00:00.000Z", lastStatus: "ok", lastError: null, lastIssueKey: null } },
];
const mktListenerRow = (l) => ({ id: l.id, name: l.name, enabled: l.enabled !== false, events: l.events, projectKeys: l.filters.projectKeys, mode: l.mode, hasAiCondition: Boolean(l.aiCondition), simulationMode: l.simulationMode === true, createdBy: l.createdBy, createdAt: l.createdAt, updatedAt: l.updatedAt, stats: l.stats });

const MKT_JOBS = [
  { id: "job_unassigned", name: "Alert unassigned open tickets", description: "Weekday-morning nudge on OPS tickets nobody has picked up.", enabled: true, schedule: { cron: "0 10 * * 1-5", timeZone: "Europe/Zurich" }, scope: { jql: 'project = OPS AND assignee is EMPTY AND status in (Open, "To Do") AND created <= -2d', maxIssues: 50 }, mode: "script", functions: [mkStep("fn-un-1", "Comment and flag", "Comment how long the ticket has been unassigned and add the label unassigned-alert", UNASSIGNED_CODE)], agent: { instructions: "", allowedActions: ["get_issue", "search_issues", "add_comment"], maxRounds: 5 }, simulationMode: false, suppressNotifications: false, createdBy: ACCT, createdAt: "2026-08-10T09:00:00.000Z", updatedAt: "2026-09-06T10:10:00.000Z", stats: { runCount: 37, errorCount: 0, lastRunAt: "2026-09-07T08:00:00.000Z", lastStatus: "ok", lastError: null, nextRunAt: "2026-09-08T08:00:00.000Z" } },
  { id: "job_epics", name: "Weekly stale-epic digest", description: "", enabled: true, schedule: { cron: "0 9 * * 1", timeZone: "Europe/Zurich" }, scope: null, mode: "agent", functions: [], agent: { instructions: "Search project TPP for epics that are not Done and have had no update in 21 days. Post ONE comment on TPP-1 (the planning epic) listing each stale epic with its key, assignee and days since the last update, then add the label stale-epic to each of them. If nothing is stale, finish without writing anything.", allowedActions: ["get_issue", "search_issues", "add_comment", "add_labels"], maxRounds: 6 }, simulationMode: false, suppressNotifications: false, createdBy: ACCT, createdAt: "2026-08-15T09:00:00.000Z", updatedAt: "2026-09-04T12:00:00.000Z", stats: { runCount: 12, errorCount: 0, lastRunAt: "2026-09-07T07:00:00.000Z", lastStatus: "ok", lastError: null, nextRunAt: "2026-09-14T07:00:00.000Z" } },
  { id: "job_hygiene", name: "Nightly label hygiene", description: "", enabled: true, schedule: { cron: "30 2 * * *", timeZone: "UTC" }, scope: { jql: 'project in (TPP, OPS) AND labels in ("Needs Triage", needs_triage, NeedsTriage)', maxIssues: 100 }, mode: "script", functions: [mkStep("fn-hy-1", "Normalise the label", "Replace every spelling variant of needs triage with the canonical needs-triage label", HYGIENE_CODE)], agent: { instructions: "", allowedActions: ["get_issue", "search_issues", "add_comment"], maxRounds: 5 }, simulationMode: false, suppressNotifications: true, createdBy: ACCT, createdAt: "2026-07-30T09:00:00.000Z", updatedAt: "2026-08-27T08:45:00.000Z", stats: { runCount: 86, errorCount: 3, lastRunAt: "2026-09-07T02:30:00.000Z", lastStatus: "ok", lastError: null, nextRunAt: "2026-09-08T02:30:00.000Z" } },
  { id: "job_readiness", name: "Friday release-readiness report", description: "", enabled: false, schedule: { cron: "0 16 * * 5", timeZone: "Europe/London" }, scope: null, mode: "script", functions: [mkStep("fn-rr-1", "Post the report", "List everything still open in the earliest unreleased version and comment it on TPP-1", DIGEST_CODE)], agent: { instructions: "", allowedActions: ["get_issue", "search_issues", "add_comment"], maxRounds: 5 }, simulationMode: false, suppressNotifications: false, createdBy: "557058:22222222-2222-2222-2222-222222222222", createdAt: "2026-08-01T09:00:00.000Z", updatedAt: "2026-08-22T15:30:00.000Z", stats: { runCount: 4, errorCount: 0, lastRunAt: "2026-08-28T15:00:00.000Z", lastStatus: "ok", lastError: null, nextRunAt: null } },
];
const mktJobRow = (j) => ({ id: j.id, name: j.name, enabled: j.enabled !== false, schedule: j.schedule, scoped: Boolean(j.scope), mode: j.mode, simulationMode: j.simulationMode === true, createdBy: j.createdBy, createdAt: j.createdAt, updatedAt: j.updatedAt, stats: j.stats });

const MKT_RUN_ISSUES = ["OPS-418", "OPS-421", "OPS-425", "OPS-427", "OPS-430", "OPS-431"];
const MKT_JOB_RUN = {
  success: true,
  reason: "6/6 issue(s) processed OK, 12 change(s)",
  issues: MKT_RUN_ISSUES.map((key) => ({ key, success: true, reason: "1 step(s), 2 change(s)" })),
  changes: MKT_RUN_ISSUES.flatMap((key, i) => [{ action: "addComment", key, id: String(31240 + i), issue: key }, { action: "editIssue", key, update: { labels: [{ add: "unassigned-alert" }] }, issue: key }]),
  logs: [
    'Scope "project = OPS AND assignee is EMPTY AND status in (Open, "To Do") AND created <= -2d" matched 6 issue(s) (cap 50)',
    ...MKT_RUN_ISSUES.flatMap((key, i) => [`--- ${key}: OK — 1 step(s), 2 change(s)`, `    "Comment and flag": addComment: ${31240 + i}`, `    "Comment and flag": editIssue("${key}", update {"labels":[{"add":"unassigned-alert"}]})`, `    "Comment and flag": Completed in ${640 + i * 37}ms`]),
  ],
  executionTimeMs: 9420, tokens: 0, aiTimeMs: 0,
};
const MKT_LOGS = [
  { id: "mlg-01", type: "listener", source: "async", issueKey: "CS-2210", fieldId: "avi:jira:commented:issue", eventType: "avi:jira:commented:issue", mode: "agent", isValid: true, reason: "Agent done: Raised CS-2210 to High, labelled customer-escalation and acknowledged the delay with a next step (callback today).", gateReason: "The customer says the invoice bug is blocking month-end close and asks for a manager.", executionTimeMs: 7840, aiTimeMs: 6900, tokens: 2310, rounds: 3, toolCalls: [{ name: "get_issue", ok: true }, { name: "update_fields", ok: true }, { name: "add_labels", ok: true }, { name: "add_comment", ok: true }], changes: [{ action: "updateIssue", key: "CS-2210", fields: { priority: { name: "High" } } }, { action: "editIssue", key: "CS-2210", update: { labels: [{ add: "customer-escalation" }] } }, { action: "addComment", key: "CS-2210", id: "31302" }], logs: ["round 1: get_issue CS-2210", "round 2: update_fields {priority: High}; add_labels customer-escalation", "round 3: add_comment (212 chars); finish"], ruleId: "lst_concierge", ruleName: "Customer complaint concierge", ruleWorkflow: null, timestamp: "2026-09-07T08:01:00.000Z" },
  { id: "mlg-02", type: "scheduledjob", source: "async", issueKey: "6 issue(s)", fieldId: "0 10 * * 1-5 Europe/Zurich", mode: "script", scheduledFor: "2026-09-07T08:00:00.000Z", manual: false, missed: 0, isValid: true, reason: MKT_JOB_RUN.reason, perIssue: MKT_JOB_RUN.issues, changes: MKT_JOB_RUN.changes, logs: MKT_JOB_RUN.logs, executionTimeMs: 9420, tokens: 0, aiTimeMs: 0, queueDelayMs: 4100, ruleId: "job_unassigned", ruleName: "Alert unassigned open tickets", ruleWorkflow: null, timestamp: "2026-09-07T08:00:14.000Z" },
  { id: "mlg-03", type: "listener", source: "async", issueKey: "TPP-1187", fieldId: "avi:jira:created:issue", eventType: "avi:jira:created:issue", mode: "script", isValid: true, reason: "Ran 1 step(s), 2 change(s)", gateReason: "No acceptance criteria and a single sentence of description.", executionTimeMs: 2310, aiTimeMs: 1420, tokens: 640, changes: [{ action: "editIssue", key: "TPP-1187", update: { labels: [{ add: "needs-refinement" }] } }, { action: "addComment", key: "TPP-1187", id: "31298" }], logs: ["AI condition met: No acceptance criteria and a single sentence of description.", "Starting 1 step(s) for TPP-1187", "\"Label and ask for acceptance criteria\": editIssue(\"TPP-1187\", update {\"labels\":[{\"add\":\"needs-refinement\"}]})", "\"Label and ask for acceptance criteria\": addComment: 31298", "\"Label and ask for acceptance criteria\": Completed in 870ms", "Finished: 1/1 step(s) succeeded in 2310ms, 2 change(s) made"], ruleId: "lst_triage", ruleName: "Auto-triage vague stories", ruleWorkflow: null, timestamp: "2026-09-07T07:42:00.000Z" },
  { id: "mlg-04", type: "listener", source: "async", issueKey: "TPP-1184", fieldId: "avi:jira:created:issue", eventType: "avi:jira:created:issue", mode: "script", isValid: true, decision: "SKIP", reason: "AI condition not met: the story has three Given/When/Then scenarios and names the user outcome.", executionTimeMs: 1010, aiTimeMs: 980, tokens: 410, ruleId: "lst_triage", ruleName: "Auto-triage vague stories", ruleWorkflow: null, timestamp: "2026-09-07T06:58:00.000Z" },
  { id: "mlg-05", type: "scheduledjob", source: "async", issueKey: "(no issue)", fieldId: "0 9 * * 1 Europe/Zurich", mode: "agent", scheduledFor: "2026-09-07T07:00:00.000Z", manual: false, missed: 0, isValid: true, reason: "Agent done: 3 stale epics listed on TPP-1 and labelled stale-epic.", agentOutcome: "done", agentSummary: "3 stale epics listed on TPP-1 and labelled stale-epic.", executionTimeMs: 14200, aiTimeMs: 12100, tokens: 5120, toolCalls: [{ name: "search_issues", ok: true }, { name: "add_comment", ok: true }, { name: "add_labels", ok: true }, { name: "add_labels", ok: true }, { name: "add_labels", ok: true }], changes: [{ action: "addComment", key: "TPP-1", id: "31290" }, { action: "editIssue", key: "TPP-1102", update: { labels: [{ add: "stale-epic" }] } }, { action: "editIssue", key: "TPP-1088", update: { labels: [{ add: "stale-epic" }] } }, { action: "editIssue", key: "TPP-1061", update: { labels: [{ add: "stale-epic" }] } }], logs: ["round 1: search_issues project = TPP AND issuetype = Epic AND status != Done AND updated <= -21d → 3", "round 2: add_comment TPP-1 (388 chars)", "round 3: add_labels TPP-1102, TPP-1088, TPP-1061; finish"], ruleId: "job_epics", ruleName: "Weekly stale-epic digest", ruleWorkflow: null, timestamp: "2026-09-07T07:00:22.000Z" },
  { id: "mlg-06", type: "listener", source: "async", issueKey: "OPS-433", fieldId: "avi:jira:commented:issue", eventType: "avi:jira:commented:issue", mode: "script", isValid: true, reason: "Ran 1 step(s), 4 change(s)", executionTimeMs: 1980, changes: [{ action: "updateIssue", key: "OPS-433", fields: { priority: { name: "Highest" } } }, { action: "editIssue", key: "OPS-433", update: { labels: [{ add: "p1-escalated" }] } }, { action: "addWatcher", key: "OPS-433", accountId: "5f8a2c1e0b3d4e001c9a7b21" }, { action: "addComment", key: "OPS-433", id: "31285" }], logs: ["Comment matched /urgent|outage|sev ?1|escalat/i", "Starting 1 step(s) for OPS-433", "\"Raise priority and page on-call\": updateIssue(\"OPS-433\", {\"priority\":{\"name\":\"Highest\"}})", "\"Raise priority and page on-call\": addWatcher 5f8a2c1e0b3d4e001c9a7b21", "\"Raise priority and page on-call\": addComment: 31285", "Finished: 1/1 step(s) succeeded in 1980ms, 4 change(s) made"], ruleId: "lst_p1", ruleName: "Escalate P1 comments", ruleWorkflow: null, timestamp: "2026-09-07T05:18:00.000Z" },
];
const MKT_API_TOKENS = { success: true, url: "https://9d2f6b1c-3e4a-4f8b-a1c7-5e0d2b9f7a63.hello.atlassian-dev.net/x1/Qm9vbVdvcmtmbG93/2c7a4e19-8f3b-4d6e-9a21-b5c8e0f4d7a2", tokens: [
  { id: "tok_ci", name: "CI pipeline", prefix: "cgr_4d8e1f", createdAt: "2026-08-12T09:30:00.000Z", createdBy: ACCT, lastUsedAt: "2026-09-07T06:15:00.000Z", revokedAt: null },
  { id: "tok_harness", name: "Test harness", prefix: "cgr_b07c92", createdAt: "2026-08-28T14:05:00.000Z", createdBy: ACCT, lastUsedAt: "2026-09-06T22:40:00.000Z", revokedAt: null },
  { id: "tok_old", name: "Migration script (Aug)", prefix: "cgr_11aa2b", createdAt: "2026-08-03T08:00:00.000Z", createdBy: ACCT, lastUsedAt: "2026-08-19T10:12:00.000Z", revokedAt: "2026-08-20T07:00:00.000Z" },
] };
// Returns a Promise for the resolvers the marketing dataset overrides, else null.
function mktInvoke(name, payload) {
  const byId = (arr) => arr.find((x) => x.id === (payload && payload.id));
  switch (name) {
    case "listProjects": return Promise.resolve(MKT_PROJECTS);
    case "getListeners": return Promise.resolve({ success: true, listeners: MKT_LISTENERS.map(mktListenerRow) });
    case "getListener": { const l = byId(MKT_LISTENERS); return Promise.resolve(l ? { success: true, listener: l } : { success: false, error: "Listener not found" }); }
    case "saveListener": { const l = (payload && payload.listener) || {}; return Promise.resolve({ success: true, listener: { ...l, id: l.id || "lst_new1", stats: l.stats || { runCount: 0, errorCount: 0, lastRunAt: null, lastStatus: null, lastError: null, lastIssueKey: null } } }); }
    case "setListenerEnabled": { const l = byId(MKT_LISTENERS) || {}; return Promise.resolve({ success: true, listener: { ...l, enabled: payload && payload.enabled } }); }
    case "deleteListener": return Promise.resolve({ success: true, removed: true });
    case "getScheduledJobs": return Promise.resolve({ success: true, jobs: MKT_JOBS.map(mktJobRow) });
    case "getScheduledJob": { const j = byId(MKT_JOBS); return Promise.resolve(j ? { success: true, job: j } : { success: false, error: "Scheduled job not found" }); }
    case "saveScheduledJob": { const j = (payload && payload.job) || {}; const prev = MKT_JOBS.find((x) => x.id === j.id); return Promise.resolve({ success: true, job: { ...j, id: j.id || "job_new1", stats: (prev && prev.stats) || { runCount: 0, errorCount: 0, lastRunAt: null, lastStatus: null, lastError: null, nextRunAt: null } } }); }
    case "setScheduledJobEnabled": { const j = byId(MKT_JOBS) || {}; return Promise.resolve({ success: true, job: { ...j, enabled: payload && payload.enabled } }); }
    case "deleteScheduledJob": return Promise.resolve({ success: true, removed: true });
    case "runScheduledJobNow": return Promise.resolve({ success: true, async: true, taskId: "task-mkt-job" });
    case "getAsyncTaskResult":
      if (payload && payload.taskId === "task-mkt-job") return Promise.resolve({ success: true, status: "done", result: MKT_JOB_RUN });
      return null;
    case "getLogs": {
      const rid = payload && payload.ruleId;
      return Promise.resolve({ success: true, logs: rid ? MKT_LOGS.filter((l) => l.ruleId === rid) : MKT_LOGS });
    }
    case "getApiTokens": return Promise.resolve(MKT_API_TOKENS);
    case "createApiToken": return Promise.resolve({ success: true, token: "cgr_e7c41a9f2b8d6053f1a4c9e2b7d80f6a13c5e9b2d4f7a081", row: { id: "tok_new", name: (payload && payload.name) || "API token", prefix: "cgr_e7c41a", createdAt: new Date().toISOString(), createdBy: ACCT, lastUsedAt: null, revokedAt: null } });
    default: return null;
  }
}

/* ----------------------------- invoke router --------------------------------- */

/* F-167 - memory store ceiling fixture. storeFull rides getMemories' settings (what
 * MemoriesTab / MemoriesAdminTab read) AND getMemorySettings / getKnowledgeCounts,
 * matching the backend. Null unless window.__MEMORY_FULL__ is set by a test. */
const MEMORY_STORE_FULL = { at: "2026-09-09T11:20:00.000Z", reason: "cap" };

/* F-189 - the WORST memory-store state, and the one the app previously could not repair:
 * the store is already OVER Jira's ~240KiB platform ceiling. `pf_memories` is a single KVS
 * value, so at that size NO write lands — not even deleting one memory, because a one-row
 * delete still rewrites the whole oversized array. The row count is irrelevant and can read
 * "40 of 200" throughout, which is what made the state unreadable from the UI.
 *
 * window.__MEMORY_OVERCAP__ = true models it end to end: getMemoryStoreStats reports the
 * size and both verdicts, and every write answers
 * { success:false, reason:"platform-cap", bytesOver, error }.
 *
 * DERIVED from the shared constants, never typed. The +6544 overshoot is the only literal;
 * it puts the store past the PLATFORM number, not merely past the guard, because that is
 * what `reason: "platform-cap"` means — a fixture sitting between the two ceilings would
 * photograph a state the refusal does not describe. */
const MEMORY_OVERCAP_OVER = 6544;
const MEMORY_OVERCAP_BYTES = MEMORY_PLATFORM_MAX_SERIALIZED_BYTES + MEMORY_OVERCAP_OVER;
const isMemoryOvercap = () => typeof window !== "undefined" && !!window.__MEMORY_OVERCAP__;
/* F-189 - deleted ids actually STAY deleted for the life of the page. Without this the
 * bulk-delete journey is fiction: getMemories would keep returning the rows the admin
 * just removed, the table would never shrink, and the "(n)" would never fall back to
 * zero — so a component that failed to clear its selection, or failed to reload, would
 * photograph identically to one that worked. */
const DELETED_MEMORY_IDS = new Set();
/* F-202 — the STALE LIST, and it is deliberately a SEPARATE set from DELETED_MEMORY_IDS.
   `deleteMemory` answers with the ids it actually found (`deleted`) and the ids that were
   already gone (`notFound`), so "ticked" and "removed" can legitimately differ: another
   admin, or the rule-editor tab, removed a row while this table sat open. Modelling that
   needs a row the SERVER no longer has but the loaded list still shows — so it must not go
   through DELETED_MEMORY_IDS, which getMemories filters by and which would simply hide the
   row instead. `__MEMORY_STALE_LIST__` seeds exactly one, so a suite can prove the toast
   counts the RESPONSE array and not the selection. */
const STALE_MEMORY_ID = "m3";
const isServerGone = (id) => (
  DELETED_MEMORY_IDS.has(id)
  || (id === STALE_MEMORY_ID && typeof window !== "undefined" && !!window.__MEMORY_STALE_LIST__)
);
/* F-209 - how much ONE row frees. Deliberately less than the whole overshoot, so a
   single-row delete cannot clear the deficit and a multi-row one can: that asymmetry IS
   the platform-cap story both walls tell in words. Derived, never a second literal. */
const MEMORY_OVERCAP_ROW_BYTES = Math.ceil(MEMORY_OVERCAP_OVER / 2);
const MEMORY_PLATFORM_REFUSAL = (bytesOver = MEMORY_OVERCAP_OVER) => ({
  success: false,
  reason: "platform-cap",
  stored: false,
  bytesOver,
  // The BACKEND's sentence, imported. It interpolates both the deficit and the platform
  // number, so this fixture cannot drift from the words a tenant actually reads.
  error: memoryPlatformCapMessage(bytesOver),
});
/* F-189 - hoisted so the delete fixture can filter it. Same rows as before. */
const MEMORY_ROWS = [
      { id: "m1", content: "This instance stores the team in customfield_10003 (Team), not Components.", source: "learned", createdAt: "2026-06-14T10:00:00Z" },
      { id: "m2", content: "Release Notes is customfield_10042 and accepts plain text.", source: "learned", createdAt: "2026-06-12T09:00:00Z" },
      { id: "m3", content: "Transitions to Done require a non-empty resolution.", source: "user", createdAt: "2026-06-10T08:00:00Z" },
      { id: "m4", content: "The Risk Level field options are Low, Medium, High, Critical.", source: "learned", createdAt: "2026-06-09T08:00:00Z" },
      { id: "m5", content: "Bugs use the 'Software Simplified Workflow'.", source: "user", createdAt: "2026-06-08T08:00:00Z" },
      /* F-182 — one ARCHIVED row. The admin tab has rendered archived memories (muted row,
         "Archived" divider, Restore button) since F-176 and no scenario ever produced one,
         so that whole branch was unphotographed and unasserted. It is also the only way to
         see the hint that archiving does not free capacity, which is the point of F-182. */
      { id: "m6", content: "The old Severity field was retired in March; do not write to it.", source: "learned", createdAt: "2026-05-02T08:00:00Z", disabled: true },
];

const MEMORY_SETTINGS = () => ({
  autoCapture: true,
  injection: true,
  runtimeInjection: false,
  storeFull: (typeof window !== "undefined" && window.__MEMORY_FULL__) ? MEMORY_STORE_FULL : null,
});

/* F-296 - the reads that sit behind the F-228/F-235 VIEWER FLOOR, and the ones an edition
   gate can refuse. ONE list each, so `__NO_ROSTER__` / `__UPGRADE_REQUIRED__` cannot mean
   one thing on the memories tab and another on the docs tab - the exact drift that let the
   admin Documentation and Skills tabs ship with no refusal branch while the embedded
   components had one. `getContextDocContent` is deliberately ABSENT from the roster list:
   that resolver has no role floor in the backend today, and a fixture that invents a gate
   the backend does not have would verify a screen no tenant can reach. */
/* ── 1.4 commit 6: CODE TAB fixtures ──────────────────────────────────────────────
   The shapes are the BACKEND's own allow-lists, field for field: `publicConnection`
   (src/git-connections.js) for a connection row, `publicWhoami` + `capabilityFlags` for a
   Test, `forgeIdentityStatus` for the identity. A fixture that invented a field would let
   the UI render something no tenant can ever see - and a fixture carrying a TOKEN would
   let a leak pass, which is why none of these rows has one.

   Scenario flags:
     window.__CODE_CAP__       - the getAgentCapability answer (default: Coder ON, BYOK).
                                 Set to a reason string for the OFF arms.
     window.__CODE_DEAD__      - the second connection reports `auth_dead` (the red banner).
     window.__CODE_NO_CONNS__  - empty list.
     window.__CODE_IDENTITY__  - a Forge deploy identity is already stored. */
const CODE_CAP = () => {
  const raw = (typeof window !== "undefined" && window.__CODE_CAP__) || null;
  if (!raw) return { success: true, enabled: true, reason: "byok", provider: "anthropic", edition: "standard", agentModel: "claude-sonnet-5", allowanceLevel: null };
  if (raw === "needs-coder-edition") return { success: true, enabled: false, reason: raw, provider: "atlassian", edition: "standard", agentModel: "claude-sonnet-5", allowanceLevel: null };
  if (raw === "needs-frontier-model") return { success: true, enabled: false, reason: raw, provider: "atlassian", edition: "advanced", agentModel: "claude-haiku-4-5-20251001", allowanceLevel: null };
  if (raw === "allowance-exhausted") return { success: true, enabled: false, reason: raw, provider: "atlassian", edition: "advanced", agentModel: "claude-sonnet-5", allowanceLevel: "hard" };
  if (raw === "forge-frontier") return { success: true, enabled: true, reason: raw, provider: "atlassian", edition: "advanced", agentModel: "claude-sonnet-5", allowanceLevel: "soft" };
  // Anything else models a read that did not answer - the restrictive side.
  return { success: true, enabled: false, reason: "unknown", provider: null, edition: null, agentModel: null, allowanceLevel: null };
};
const CODE_CONNS = () => {
  if (typeof window !== "undefined" && window.__CODE_NO_CONNS__) return [];
  const dead = typeof window !== "undefined" && !!window.__CODE_DEAD__;
  return [
    {
      id: "gc_1", kind: "github", label: "Acme engineering", host: null, owner: "acme",
      createdBy: ACCT, createdAt: "2026-09-01T08:00:00.000Z", updatedAt: "2026-09-10T08:00:00.000Z",
      hasToken: true, status: "ok", authDeadAt: null, authDeadReason: null,
      lastCheckedAt: "2026-09-12T08:00:00.000Z", login: "acme-bot",
      repos: ["acme/web", "acme/api"],
      capabilities: { canCreateRepos: true, canWebhooks: true, canPipelines: null, reason: "Derived from the classic token's reported OAuth scopes." },
    },
    {
      id: "gc_2", kind: "bitbucket", label: "Acme platform", host: null, owner: "acme",
      createdBy: ACCT, createdAt: "2026-09-02T08:00:00.000Z", updatedAt: "2026-09-11T08:00:00.000Z",
      hasToken: true, status: dead ? "auth_dead" : "ok",
      authDeadAt: dead ? "2026-09-12T09:00:00.000Z" : null,
      authDeadReason: dead ? "The provider rejected this credential" : null,
      lastCheckedAt: "2026-09-12T09:00:00.000Z", login: "acme-platform",
      repos: ["acme/platform"],
      capabilities: { canCreateRepos: null, canWebhooks: null, canPipelines: null, reason: "Bitbucket does not report scopes on this call. Capability is proven only by the call that needs it." },
    },
  ];
};
const CODE_IDENTITY = () => ((typeof window !== "undefined" && window.__CODE_IDENTITY__)
  ? { hasIdentity: true, email: "deploy@acme.example", consent: { accountId: ACCT, at: "2026-09-03T10:00:00.000Z" }, rotation: null, createdAt: "2026-09-03T10:00:00.000Z", updatedAt: "2026-09-03T10:00:00.000Z" }
  : { hasIdentity: false, email: null, consent: null, rotation: null, createdAt: null, updatedAt: null });

/* ── 1.4 commit 9b: THE CODER PANEL fixtures ──────────────────────────────────────
   One mutable thread per page load, because the panel's whole job is a CONVERSATION:
   a turn appends to it, a decision appends to it, and the panel re-reads it after each.
   A fixture that answered a constant would let a panel that never re-reads pass.

   The shapes are the ENGINE's, field for field (src/coder-engine.js):
     runCoderTurn  -> { success, reply, actions[{name,args,ok,ms}], usage, endedBy, rounds,
                        awaiting:"confirm"?, ticket:{id,action,argsPreview}? }
     thread        -> { messages[{role,content,kind?,at}], turns, pendingTicketId? }
     confirm       -> { success, resume, ... } + { async:true, taskId } from the resolver,
                      or { duplicate:true } when it was already answered.

   NOTE the ticket id: it is in the fixture because the WIRE carries it, and the panel is
   required never to render it. coder-panel.test.mjs asserts that absence, which is only
   meaningful because the id here is a distinctive string.

   Scenario flags:
     window.__CODER_SCENARIO__ - "ticket" (default: the turn halts on a consent ticket),
                                 "plain" (it just answers), "empty" (no thread yet).
     window.__CODER_SLOW__     - the first poll answers `pending`, so the running state and
                                 its veil are on screen long enough to be asserted.
     window.__CODER_DUPLICATE__- confirmCoderTicket answers { duplicate: true }.
     window.__CODER_NO_RESUME__- the decision is recorded but the follow-up did not enqueue.
     window.__CODER_TICKET__   - F-374: WHICH action the consent ticket is for, so the
                                 preview shapes `buildArgsPreview` really returns are on
                                 screen: "create_repo" (a boolean `private:false` that
                                 decides whether the repo is public) and "trigger_deploy"
                                 (a NESTED `inputs` object carrying the environment).
                                 Default: open_pull_request, whose preview is an OBJECT too.
     window.__CODER_PENDING__  - F-374: the thread comes back with a pendingTicketId and
                                 nothing else, the state a RELOAD leaves behind: the panel
                                 has a ticket id, no action and `argsPreview:null`.
     window.__CODER_BOOM__     - F-374: a transcript row whose `content` THROWS when React
                                 reads it during render. The only honest way to force a
                                 render fault from the mock, and the error boundary's test.
     window.__CODER_SIM_LOCKED__- F-371: the turn is REFUSED by the engine's F-360 arm,
                                 `reason:"simulation-locked"`, which arrives through the
                                 QUEUE (the resolver enqueues before the engine reads the
                                 thread row) and so lands in the poll's result.
   The capability and the connection list reuse __CODE_CAP__ / __CODE_NO_CONNS__ above -
   one flag per product question, not one per surface. */
const CODER_TICKET_ID = "ct_9f31c0de";
const CODER_SEED = () => ((typeof window !== "undefined" && window.__CODER_SCENARIO__) === "empty" ? [] : [
  { role: "user", content: "Open a branch for this and add the retry guard to the payment client.", at: "2026-09-13T08:00:00.000Z" },
  { role: "assistant", content: "I read PROJ-42 and the payment client.\n\nThe retry guard belongs in sendPayment, around the provider call. I will open a branch first and push the change to it, then ask before anything leaves the branch.", at: "2026-09-13T08:00:20.000Z" },
]);
/* F-368 - threads are keyed BY ID, because the panel can now start a second conversation
   on the same issue and switch back. The FIRST id the panel asks for gets the seeded
   transcript; every later one starts EMPTY, which is what a freshly minted `t_<ts>` thread
   is. A fixture that answered the same messages for every id would let a panel that
   ignores threadId pass the switch. */
const CODER_THREADS = new Map();
let CODER_FIRST_THREAD = null;
let CODER_ACTIVE_THREAD = null;
const coderThread = (threadId) => {
  const key = String(threadId || CODER_ACTIVE_THREAD || "p_demo");
  if (!CODER_THREADS.has(key)) {
    const first = CODER_FIRST_THREAD === null;
    if (first) CODER_FIRST_THREAD = key;
    const seed = first ? CODER_SEED() : [];
    /* F-374 - a row React cannot render. `content` is a getter that throws, so the fault
       happens INSIDE the render pass (where an error boundary is the only thing that can
       catch it) and not in the fetch, which is wrapped in a try/catch. */
    if (first && typeof window !== "undefined" && window.__CODER_BOOM__) {
      const row = { role: "assistant", at: "2026-09-13T08:01:00.000Z" };
      Object.defineProperty(row, "content", { enumerable: true, get() { throw new Error("forced render fault (F-374 harness)"); } });
      seed.push(row);
    }
    const row = { messages: seed, turns: seed.length ? 1 : 0 };
    /* F-374 - the RELOAD state: the record keeps the ticket id and nothing else. */
    if (first && typeof window !== "undefined" && window.__CODER_PENDING__) row.pendingTicketId = CODER_TICKET_ID;
    CODER_THREADS.set(key, row);
  }
  return CODER_THREADS.get(key);
};
/* F-374 - THE PREVIEW IS AN OBJECT, because that is what `buildArgsPreview` returns: the
   action's own schema keys, already clamped, with booleans and numbers left as values and
   `inputs` left NESTED. The fixture used to be a hand-written sentence, which is exactly
   why the harness never saw the panel throw on the real shape. */
const CODER_TICKET_ARGS = {
  open_pull_request: {
    repo: "acme/web",
    title: "Retry guard for the payment client",
    body: "Adds a bounded retry around the provider call in sendPayment.",
    sourceBranch: "proj-42-retry-guard",
    targetBranch: "main",
    draft: false,
  },
  // F-363's whole point: `private:false` is the difference between an internal repo and a
  // public one, and it is a value the user must SEE, not an absence.
  create_repo: { name: "acme-internal", org: "acme", private: false, description: "Internal tooling" },
  // ... and a NESTED object: the environment a deploy lands in.
  trigger_deploy: { repo: "acme/web", workflow: "deploy.yml", ref: "main", inputs: { environment: "production", canary: false, batch: 4 } },
};
const CODER_TICKET_ACTION = () => {
  const want = (typeof window !== "undefined" && window.__CODER_TICKET__) || "open_pull_request";
  return CODER_TICKET_ARGS[want] ? want : "open_pull_request";
};
const CODER_TURN_TICKET = () => {
  const action = CODER_TICKET_ACTION();
  return {
    success: true, reply: "", actions: [{ name: "create_branch", args: { name: "proj-42-retry-guard" }, ok: true, ms: 640 }],
    usage: { totalTokens: 8120 }, endedBy: "awaiting_confirmation", rounds: 2,
    awaiting: "confirm",
    ticket: { id: CODER_TICKET_ID, action, argsPreview: { ...CODER_TICKET_ARGS[action] } },
  };
};
const CODER_TURN_PLAIN = {
  success: true, reply: "The retry guard is in and the branch is pushed.\n\nI did not open a pull request, because you have not asked for one yet.",
  actions: [{ name: "create_branch", args: {}, ok: true, ms: 640 }, { name: "commit_files", args: {}, ok: true, ms: 1210 }, { name: "trigger_build", args: {}, ok: false, ms: 300 }],
  usage: { totalTokens: 9400 }, endedBy: "final", rounds: 3,
};
const CODER_TURN_AFTER = (decision) => ({
  success: true,
  reply: decision === "skip"
    ? "Understood, no pull request. The branch is pushed and waiting for you."
    : "The pull request is open: acme/web #418.",
  actions: decision === "skip" ? [] : [{ name: "open_pull_request", args: {}, ok: true, ms: 980 }],
  usage: { totalTokens: 5100 }, endedBy: "final", rounds: 1,
});
let CODER_LAST_DECISION = "confirm";
let CODER_POLLS = 0;
function coderInvoke(name, payload) {
  const scenario = (typeof window !== "undefined" && window.__CODER_SCENARIO__) || "ticket";
  /* confirmCoderTicket and getAsyncTaskResult carry no threadId (a ticket id is already
     bound to its thread in the engine), so the last thread the panel NAMED is the one they
     append to - exactly the binding the backend makes off the ticket row. */
  if (payload && payload.threadId) CODER_ACTIVE_THREAD = payload.threadId;
  const t = coderThread(payload && payload.threadId);
  switch (name) {
    case "getCoderThread":
      return Promise.resolve({ success: true, thread: { messages: t.messages.slice(), turns: t.turns, ...(t.pendingTicketId ? { pendingTicketId: t.pendingTicketId } : {}) } });
    case "startCoderTurn": {
      CODER_POLLS = 0;
      t.messages.push({ role: "user", content: String((payload && payload.message) || ""), at: new Date().toISOString() });
      if (typeof window !== "undefined") window.__CODER_LAST_START__ = payload;
      return Promise.resolve({ success: true, async: true, taskId: "coder_turn_1", threadId: (payload && payload.threadId) || "p_demo" });
    }
    case "confirmCoderTicket": {
      const decision = (payload && payload.decision) || "confirm";
      CODER_LAST_DECISION = decision;
      CODER_POLLS = 0;
      if (typeof window !== "undefined") window.__CODER_LAST_DECISION__ = payload;
      if (typeof window !== "undefined" && window.__CODER_DUPLICATE__) {
        return Promise.resolve({ success: true, duplicate: true, decision, status: "confirmed", ticketId: CODER_TICKET_ID });
      }
      delete t.pendingTicketId;
      t.messages.push({
        role: "user", kind: "decision", at: new Date().toISOString(),
        content: decision === "skip"
          ? "DECISION: the user SKIPPED open_pull_request. It was not performed and must not be retried unless they ask again."
          : decision === "change"
            ? `DECISION: the user asked to CHANGE open_pull_request before it runs. Their words: ${String((payload && payload.change) || "")}`
            : "DECISION: the user CONFIRMED open_pull_request and it was performed.",
      });
      if (typeof window !== "undefined" && window.__CODER_NO_RESUME__) {
        return Promise.resolve({ success: true, resume: true, resumed: false, error: "The decision was recorded, but the Coder could not be resumed: the queue refused the push." });
      }
      return Promise.resolve({ success: true, resume: true, async: true, taskId: "coder_turn_2" });
    }
    case "getAsyncTaskResult": {
      const slow = typeof window !== "undefined" && window.__CODER_SLOW__;
      CODER_POLLS++;
      if (slow && CODER_POLLS === 1) return Promise.resolve({ success: true, status: "processing" });
      if (typeof window !== "undefined" && window.__CODER_SIM_LOCKED__) {
        return Promise.resolve({
          success: true, status: "done",
          result: {
            success: false, reason: "simulation-locked", simulation: true,
            error: "This Coder thread is running in SIMULATION \u2014 it cannot be switched to live writes mid-thread. Start a new thread to work for real.",
          },
        });
      }
      const first = payload && payload.taskId === "coder_turn_1";
      const result = first
        ? (scenario === "plain" ? CODER_TURN_PLAIN : CODER_TURN_TICKET())
        : CODER_TURN_AFTER(CODER_LAST_DECISION);
      if (result.awaiting === "confirm") t.pendingTicketId = result.ticket.id;
      else if (result.reply) t.messages.push({ role: "assistant", content: result.reply, at: new Date().toISOString() });
      t.turns++;
      return Promise.resolve({ success: true, status: "done", result });
    }
    default: return Promise.resolve({ success: false, error: `no coder fixture for ${name}` });
  }
}

const ROSTER_GATED_READS = ["getContextDocs", "getSkills", "getSkillContent", "getMemories", "getMemoryStoreStats"];
const EDITION_GATED_READS = ["getContextDocs", "getSkills", "getSkillContent", "getMemories", "getMemoryStoreStats", "getKnowledgeCounts"];

function invoke(name, payload) {
  const s = shot();
  const mkt = s.startsWith("admin-");
  const isAdmin = s === "admin" || mkt;
  if (mkt) { const r = mktInvoke(name, payload); if (r) return r; }
  // Error-state testing: window.__FAIL__ = ["getSkills", ...] makes those resolvers
  // reject, so components take their catch → loadError path. Set via capture.mjs.
  if (typeof window !== "undefined" && Array.isArray(window.__FAIL__) && window.__FAIL__.includes(name)) {
    return Promise.reject(new Error("Simulated network failure (harness __FAIL__)"));
  }
  /* F-242/F-244..F-250 — REFUSAL testing, the deliberate twin of __FAIL__ above.
     window.__REFUSE__ = ["getContextDocs", ...] makes those resolvers answer with the shape
     src/index.js's permissionDenied() actually emits: a RESOLVED body carrying
     `success:false`, the English sentence, `reason:"no-permission"` and the `needsRole` the
     gate asked for. It is a separate flag from __FAIL__ on purpose — the whole class of
     findings this fixture exists for is the app CONFLATING the two, so a harness that could
     only simulate one of them could never catch it. Note the contrast: __FAIL__ REJECTS
     (transport fault, hits the catch arm), __REFUSE__ RESOLVES (the backend answered, and
     what it said was "no"). Any frontend that puts a refusal on the catch path is wrong.
     `needsRole` defaults to viewer (the F-228 read floor) and can be overridden per test
     with window.__REFUSE_ROLE__. */
  if (typeof window !== "undefined" && Array.isArray(window.__REFUSE__) && window.__REFUSE__.includes(name)) {
    /* F-252/F-254 — a permission refusal has TWO shapes and the fixture must be able to
       produce both, because the UI is required to say DIFFERENT things for them:
         ask-app-admin (+needsRole) — a role floor. A CogniRunner admin can grant the level.
         not-owner (and NO needsRole) — the rule belongs to someone else. No role fixes it,
           and the reader may already be an admin, so "ask an admin for access" is false and
           unactionable. The MISSING needsRole is the signal, so the fixture must actually
           omit it — a mock that sent one anyway would let a UI that ignores the hint pass. */
    const ownerRefusal = window.__REFUSE_HINT__ === "not-owner";
    return Promise.resolve(ownerRefusal ? {
      success: false,
      error: "You don't have permission to modify this rule.",
      reason: "no-permission",
      hint: "not-owner",
      memories: [], docs: [], skills: [], logs: [],
    } : {
      success: false,
      error: "You don't have permission to perform this action.",
      reason: "no-permission",
      hint: "ask-app-admin",
      needsRole: window.__REFUSE_ROLE__ || "viewer",
      // Empty collections ride along exactly as the real resolvers send them.
      memories: [], docs: [], skills: [], logs: [],
    });
  }
  /* F-255 — an EDITION denial, which is NOT a permission refusal and must never be rendered
     as one. Separate flag, separate `reason`, and it deliberately carries no `needsRole` or
     `hint`: the reader's role is irrelevant, the site's plan is the constraint, and the
     remedy is an upgrade rather than a conversation with a CogniRunner admin. Its presence
     in the harness is what makes "isPermissionRefusal must not match this" testable at all. */
  if (typeof window !== "undefined" && Array.isArray(window.__UPGRADE__) && window.__UPGRADE__.includes(name)) {
    return Promise.resolve({
      success: false,
      error: "This feature requires the Coder edition.",
      reason: "upgrade-required",
      featureId: window.__UPGRADE_FEATURE__ || "static-post-function",
    });
  }
  /* F-296 - the TENANT-WIDE edition state, the deliberate twin of `__NO_ROSTER__` below.
     `__UPGRADE__` pokes one named resolver, which is right for proving a predicate but
     wrong for proving a SCREEN: a site whose plan excludes the knowledge stores is refused
     on every read at once, and a fixture that denies only one of them models a tenant that
     does not exist. Each admin knowledge tab must stand up on its own under it - which is
     what the F-296 findings were hiding behind: the embedded components had the arm, the
     admin tabs did not, and no fixture ever put a whole tenant in that state.
     `featureId` is overridable so the note's LABEL still comes from ADVANCED_FEATURES
     rather than a string this file invents. */
  if (typeof window !== "undefined" && window.__UPGRADE_REQUIRED__ && EDITION_GATED_READS.includes(name)) {
    return Promise.resolve({
      success: false,
      error: "This feature requires the Coder edition.",
      reason: "upgrade-required",
      featureId: window.__UPGRADE_FEATURE__ || "coder",
      memories: [], docs: [], skills: [],
    });
  }
  /* F-296 - `__NO_ROSTER__` is a WHOLE-TENANT state too: a reader on neither the
     CogniRunner roster nor Jira's admin list is refused by the F-228/F-235 VIEWER FLOOR on
     every knowledge read, not only the memory ones it originally modelled (getContextDocs,
     getSkills, getSkillContent, getMemories, getMemoryStoreStats all carry it). Handled
     centrally here so the per-case branches below cannot drift apart; the shape is the
     backend's own noPerm(..., "viewer") verbatim. */
  if (typeof window !== "undefined" && window.__NO_ROSTER__ && ROSTER_GATED_READS.includes(name)) {
    return Promise.resolve({
      success: false,
      error: "You don't have permission to read this.",
      reason: "no-permission",
      hint: "ask-app-admin",
      needsRole: "viewer",
      memories: [], docs: [], skills: [],
    });
  }
  // F-141 — HOLD fixture: window.__HOLD__ = ["fixPostFunctionCode"] parks that resolver
  // in flight until the test calls window.__RELEASE_HOLD__(). Needed to assert what the
  // UI offers WHILE an AI write to a step's code is running (generate and fix are
  // mutually exclusive), which a resolved-immediately mock can never expose. On release
  // the name is dropped from the list and the call re-enters the normal router.
  if (typeof window !== "undefined" && Array.isArray(window.__HOLD__) && window.__HOLD__.includes(name)) {
    return new Promise((resolve) => {
      window.__RELEASE_HOLD__ = () => {
        window.__HOLD__ = window.__HOLD__.filter((n) => n !== name);
        resolve(invoke(name, payload));
      };
    });
  }
  // F-129 — Stop-all CANCEL fixture. window.__ASYNC_CANCEL__ = true routes the four
  // queueable AI resolvers down the async branch, and the poll then answers with the
  // shape the tenant Stop-all epoch actually writes:
  //   { status: "error", error: "Cancelled", cancelled: true }
  // (an operator stop is NEVER reported as status "cancelled" — see JobsTab F-122).
  // Surfaces exercised: FunctionBlock generate + fix, SkillEditor distill, ReviewPanel.
  if (typeof window !== "undefined" && window.__ASYNC_CANCEL__) {
    if (name === "generatePostFunctionCode" || name === "fixPostFunctionCode"
      || name === "distillSkillFromStep" || name === "reviewConfig") {
      return Promise.resolve({ success: true, async: true, taskId: "task-cancel" });
    }
    if (name === "getAsyncTaskResult" && payload && payload.taskId === "task-cancel") {
      return Promise.resolve({ success: true, status: "error", error: "Cancelled", cancelled: true });
    }
  }
  /* F-294: record EVERY invoke, unconditionally. This used to happen only when a test had
     also set window.__RESPONSES__, which made __CALLS__ useless for the assertion that
     matters here - that a resolver is NEVER called. A negative cannot be proven from a log
     that is only kept when something else opted in. Existing readers all filter by name
     (`.filter(c => c.name === X)` / `.some(...)`), so a longer log cannot break them. */
  if (typeof window !== "undefined") {
    window.__CALLS__ = window.__CALLS__ || [];
    window.__CALLS__.push({ name, payload });
  }
  // Optional resolver fixtures for targeted browser regressions; never bundled into production.
  if (typeof window !== "undefined" && window.__RESPONSES__) {
    if (Object.prototype.hasOwnProperty.call(window.__RESPONSES__, name)) return Promise.resolve(window.__RESPONSES__[name]);
  }
  /* 1.4 commit 9b - a CODER task id routes to the coder fixture before the switch below,
     whose getAsyncTaskResult arm answers `pending` to anything it does not recognise. A
     poll that never resolves would have made the panel's whole turn untestable. */
  if (name === "getAsyncTaskResult" && payload && String(payload.taskId || "").startsWith("coder_turn_")) {
    return coderInvoke(name, payload);
  }
  switch (name) {
    case "setUiIntent":
      if (typeof window !== "undefined") window.__SET_INTENT__ = payload;
      return Promise.resolve({ success: true });
    case "takeUiIntent":
      return Promise.resolve((typeof window !== "undefined" && window.__PENDING_INTENT__)
        ? { success: true, intent: window.__PENDING_INTENT__ }
        : { success: true, intent: null });
    case "getIssueActivity": {
      const gShot = (typeof window !== "undefined" && window.__SHOT__) || "";
      if (gShot === "issue-glance-loading") return new Promise(() => {}); // never resolves → loading spinner stays
      if (gShot === "issue-glance-empty") return Promise.resolve({ success: true, issueKey: "DEMO-42", items: [], count: 0 });
      return Promise.resolve({ success: true, issueKey: "DEMO-42", count: 4, items: [
        { kind: "validator", label: "Description completeness", decision: "Blocked", verdictOk: false, reason: "The description is missing acceptance criteria and a reproduction steps section.", timestamp: new Date(Date.now() - 3 * 60000).toISOString() },
        { kind: "condition", label: "Requires linked incident", decision: "Transition shown", verdictOk: true, reason: "A linked incident (INC-88) was found.", timestamp: new Date(Date.now() - 42 * 60000).toISOString() },
        { kind: "post-function", label: "Risk summary writer", decision: "Ran", verdictOk: true, reason: 'Updated "Risk" field with a 2-sentence summary.', timestamp: new Date(Date.now() - 3 * 3600000).toISOString() },
        { kind: "skipped", label: "On-call escalation", decision: "Skipped", verdictOk: false, reason: "Duplicate platform delivery suppressed.", timestamp: new Date(Date.now() - 26 * 3600000).toISOString() },
      ] });
    }
    case "checkLicense": return Promise.resolve({
      // isActive is NULL on an unlicensed install — the backend sends null whenever
      // there is no license property (src/index.js checkLicense). `edition` is still
      // a real non-empty string ("standard"), which is what the chip must gate on.
      isActive: isUnlicensedEd() ? null : true,
      edition: edName(),
      label: isStandardEd() ? "Standard" : "Coder",
      capabilitySet: isUnlicensedEd() ? null : (isStandardEd() ? "capabilityStandard" : "capabilityAdvanced"),
      source: isUnlicensedEd() ? "none" : "license",
      // Built from ADVANCED_FEATURES so the mock can never carry a feature id the
      // product does not have (F-085) — editions.test.mjs asserts the parity.
      features: ADVANCED_FEATURES.map((f) => ({ id: f.id, label: f.label, allowed: !isStandardEd() })),
    });
    // F-200 — `isAdmin` is a real branch on several admin tabs (the Memories tab alone
    // gates the select column, the bulk bar and every row action on it), and the mock used
    // to make it unreachable by always answering true. `__NOT_ADMIN__` models a project
    // EDITOR: a role the backend genuinely lets through `addMemory` (requireRole "editor"),
    // which is exactly the person who can trip a write refusal with no delete control on
    // screen. Without this flag the non-admin half of every `{isAdmin && ...}` is untested.
    // F-219 — `__VIEWER__` is the THIRD role state, and until now it did not exist in the
    // mock at all. It matters because `isAdmin: false` was being used as a stand-in for
    // "cannot write", which conflated an EDITOR (who the backend lets add, edit, archive
    // and delete memories) with a VIEWER (who it does not). Every `{isAdmin && ...}` gate
    // that F-219 corrected to `canEdit` needs a fixture on BOTH sides of the new line, or
    // the correction is only half tested: the editor arm proves the controls appeared, and
    // this one proves they did not appear for someone the backend would refuse.
    // F-230 — `__ROLE_UNKNOWN__` is the FOURTH answer, and the only one that is not a
    // verdict about the user. The backend returns it when the permission probe AND the
    // group scan both threw, i.e. Jira could not be asked at all. It is deliberately
    // shaped like the others (`success: true`) because the resolver DID answer — what it
    // reports is that it has no information, which is a different thing from a failed
    // invoke and a very different thing from `role: null` meaning "no role". The frontend
    // must not collapse the two: without a fixture on this side, the only rendering a real
    // Jira outage produces ("CogniRunner has you as no role, ask an admin") is untested
    // and reads as a confident false claim to the admin most likely to hit it.
    case "checkIsAdmin": return Promise.resolve(
      typeof window !== "undefined" && window.__ROLE_UNKNOWN__
        ? { success: true, isAdmin: false, role: null, unknown: true, reason: "jira-unreachable", accountId: ACCT }
        : typeof window !== "undefined" && window.__NO_ROSTER__
        // F-234 — on neither the roster nor Jira's admin list: a real, answered `role: null`
        // (NOT `unknown`, which means the lookup faulted — F-230 keeps those two apart).
        ? { success: true, isAdmin: false, role: null, scope: null, accountId: ACCT }
        : typeof window !== "undefined" && window.__VIEWER__
        ? { success: true, isAdmin: false, role: "viewer", scope: "mine", accountId: ACCT }
        : typeof window !== "undefined" && (window.__NOT_ADMIN__ || window.__DEMOTED_ADMIN__)
        ? { success: true, isAdmin: false, role: "editor", scope: "mine", accountId: ACCT }
        : { success: true, isAdmin: true, role: "admin", scope: "all", accountId: ACCT });
    case "checkProviderHealth": return Promise.resolve({ success: true, ok: true, provider: "anthropic", providerLabel: "Anthropic", model: "claude-haiku-4-5-20251001" });
    case "getConfigs": return Promise.resolve(ADMIN_CONFIGS);
    case "getRuleApiInfo": return Promise.resolve({
      success: true,
      appId: "36415848-6868-4697-9554-3c3ad87b8da9",
      environmentId: "989ecaa0-4d62-46d9-8f2b-6c1a52e80d11",
      modules: [
        { label: "Validator", ruleKey: "forge:expression-validator", slot: "validators[]", ari: "ari:cloud:ecosystem::extension/36415848-6868-4697-9554-3c3ad87b8da9/989ecaa0-4d62-46d9-8f2b-6c1a52e80d11/static/ai-text-field-validator" },
        { label: "Condition", ruleKey: "forge:expression-condition", slot: "conditions tree", ari: "ari:cloud:ecosystem::extension/36415848-6868-4697-9554-3c3ad87b8da9/989ecaa0-4d62-46d9-8f2b-6c1a52e80d11/static/ai-text-field-condition" },
        { label: "Semantic post-function", ruleKey: "forge:workflow-post-function", slot: "actions[]", ari: "ari:cloud:ecosystem::extension/36415848-6868-4697-9554-3c3ad87b8da9/989ecaa0-4d62-46d9-8f2b-6c1a52e80d11/static/ai-semantic-post-function" },
        { label: "Static post-function", ruleKey: "forge:workflow-post-function", slot: "actions[]", ari: "ari:cloud:ecosystem::extension/36415848-6868-4697-9554-3c3ad87b8da9/989ecaa0-4d62-46d9-8f2b-6c1a52e80d11/static/ai-static-post-function" },
      ],
      limits: { maxRuleConfigBytes: 32768, maxRegistryRows: 500, registryRefuseAtBytes: 200000 },
      docsUrl: "https://github.com/leanzero-srl/leanzero-cognirunner-forgeapp/blob/main/docs/REST-API-RULES.md",
    });
    case "previewRuleDeletion": return Promise.resolve({
      success: true,
      items: (payload?.ids || []).map((id) => {
        const row = ADMIN_CONFIGS.configs.find((c) => c.id === id) || {};
        return {
          id: String(id), type: row.type || "validator", disabled: row.disabled === true,
          workflowName: row.workflow?.workflowName || null,
          transitionName: row.workflow?.transitionName || null,
          transitionFromName: row.workflow?.transitionFromName || null,
          transitionToName: row.workflow?.transitionToName || null,
          prompt: (row.prompt || "").slice(0, 120), canDelete: true, locatable: true, ambiguous: false, reason: null,
        };
      }),
      projectCounts: { "Software Dev Workflow": 3, "Bug Triage": 1 },
      truncatedWorkflows: false,
    });
    case "deleteRules": return Promise.resolve({
      success: true, removed: (payload?.ids || []).length,
      results: (payload?.ids || []).map((id) => ({ id: String(id), ok: true, detached: true, reason: "detached" })),
    });
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
    /* F-369/F-373 — the EDITOR FLOOR list. `gitconnections` rows are RICH
       ({id, kind, label, repos[]}) and carry no status and no secret state, so a non-admin
       workflow editor can both SEE the connections and narrow repositories to one of them.
       `gitrepos` stays the flat union for the older callers. This is the shape the Coder
       panel's fallback and PremadeRuleForm's fallback are written against. */
    case "getRuleLists": return Promise.resolve({ success: true, lists: {
      issuetypes: [{ value: "Bug", label: "Bug" }, { value: "Task", label: "Task" }],
      statuses: [{ value: "Done", label: "Done" }],
      priorities: [{ value: "High", label: "High" }],
      gitconnections: CODE_CONNS().map((c) => ({ id: c.id, kind: c.kind, label: c.label, repos: (c.repos || []).slice() })),
      gitrepos: [...new Set(CODE_CONNS().flatMap((c) => c.repos || []))].sort().map((r) => ({ value: r, label: r })),
    } });
    // F-077: THIS IS THE BACKEND SHAPE — `usage`, `seats` and `forgeLlm` are
    // SIBLINGS on the result (src/index.js getAiUsage). The mock used to nest
    // seats/forgeLlm INSIDE usage, which made a dead allowance meter look alive.
    // Do not nest them again.
    case "getAiUsage": return Promise.resolve({
      success: true,
      usage: { month: { key: "2026-07", calls: 1284, prompt: 512000, completion: 148000, total: 660000, byProvider: { anthropic: { calls: 720, total: 410000 }, openai: { calls: 402, total: 180000 }, atlassian: { calls: 162, total: 70000 } } }, today: { key: "2026-07-08", calls: 96, total: 48200 }, history: [{ key: "2026-06", calls: 3140, total: 1620000 }] },
      // 1.3: the monthly Forge LLM allowance meter. F-091: Standard (and any BYOK
      // tenant) gets an explicit `null`, which is what the backend sends — NOT
      // `undefined`, so "no allowance row" is tested against the real absent value.
      forgeLlm: isStandardEd() ? null : mockAllowance(),
      seats: MOCK_SEATS,
    });
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
    // __TESTFAIL_ALWAYS__ keeps the dry run failing (F-156 needs a SECOND fix whose auto
    // re-run also fails, which is the case that saves no new memory).
    case "testPostFunction": if (typeof window !== "undefined" && (window.__TESTFAIL_ONCE__ || window.__TESTFAIL_ALWAYS__)) { window.__TESTFAIL_ONCE__ = false; return Promise.resolve({ success: false, isValid: false, mode: "live", issueKey: "PROJ-42", error: "ReferenceError: dupes is not defined", logs: ["getIssue(\"PROJ-42\") — OK", "ERROR: ReferenceError: dupes is not defined"], changes: [], executionTimeMs: 900 }); } return Promise.resolve({ success: true, isValid: true, mode: "live", issueKey: "PROJ-42", logs: ["getIssue(\"PROJ-42\") — OK (Payment retry fails)", "searchJql — returned 3 issues", "updateIssue — DRY RUN", "addComment — DRY RUN"], changes: [
      { action: "updateIssue", key: "PROJ-42", fields: { priority: { name: "High" }, labels: ["escalated"] } },
      { action: "addComment", key: "PROJ-42" },
      { action: "transitionIssue", key: "PROJ-42", transitionId: "31" },
      { action: "setAssignee", key: "PROJ-42", accountId: "5f00aa" },
    ], result: { commented: true, count: 3 }, executionTimeMs: 1600 });
    case "narrateDryRun": return Promise.resolve({ success: true, summary: "This step raises PROJ-42 to High priority, tags it \"escalated\", posts a comment, moves it to the next status, and assigns it to a teammate.", verify: ["Confirm \"High\" is the intended priority", "Check the comment wording is customer-safe", "Make sure transition 31 is the right next status"] });
    /* F-294: window.__PROVIDER__ overrides the active provider. The default stays
       "anthropic" (a BYOK tenant) so no existing shot changes; set it to "atlassian" to
       model a Forge LLM tenant, which is the only case that earns the upgrade sentence. */
    case "getProvider": {
      const prov = (typeof window !== "undefined" && window.__PROVIDER__) || "anthropic";
      const burl = prov === "atlassian" ? "" : "https://api.anthropic.com";
      return Promise.resolve({ success: true, provider: prov, baseUrl: burl, providers: PROVIDER_LIST, bedrockAck: false });
    }
    case "getOpenAIKey":
      // First-run no-key state (window.__NOKEY__): a BYOK provider with no key stored →
      // hasKey:false (matches the real getOpenAIKey shape). Exercises the provider-warning.
      if (typeof window !== "undefined" && window.__NOKEY__) return Promise.resolve({ success: true, provider: "anthropic", baseUrl: "https://api.anthropic.com", hasKey: false, isByok: false });
      if (payload && payload.provider === "lmstudio") return Promise.resolve({ success: true, provider: "lmstudio", baseUrl: LM_URL, hasKey: false, hasToken: true, isByok: true });
      return Promise.resolve(isAdmin ? { success: true, provider: "anthropic", baseUrl: "https://api.anthropic.com", hasKey: true, isByok: true } : { success: true, isByok: false });
    case "getOpenAIModels":
      if (payload && payload.provider === "lmstudio") return Promise.resolve({ success: true, isByok: true, models: LM_MODELS.map((m) => m.id), modelDetails: LM_MODELS, locked: [], edition: edName() });
      // Forge LLM: never refuses — returns what this edition may pick PLUS the locked ids.
      if (payload && payload.provider === "atlassian") return Promise.resolve({
        success: true,
        isByok: false,
        currentModel: FORGE_HAIKU,
        edition: edName(),
        models: isStandardEd() ? [FORGE_HAIKU] : [FORGE_HAIKU, ...FORGE_FRONTIER],
        locked: isStandardEd() ? FORGE_FRONTIER : [],
      });
      return Promise.resolve({ success: true, isByok: true, edition: edName(), locked: [], models: ["claude-haiku-4-5-20251001", "claude-sonnet-4-6-20260101", "claude-opus-4-1-20250805", "claude-3-7-sonnet-20250219"] });
    case "getOpenAIModelFromKVS":
      if (payload && payload.provider === "lmstudio") return Promise.resolve({ success: true, model: "qwen/qwen3.6-27b", isByok: true, edition: edName(), clamped: false });
      if (payload && payload.provider === "atlassian") return Promise.resolve({
        success: true,
        // Standard shot: a Sonnet 5 was saved while on Coder, the edition lapsed ->
        // the backend serves Haiku and reports `clamped` so the UI can say so.
        model: isStandardEd() ? FORGE_HAIKU : "claude-sonnet-5",
        savedModel: isStandardEd() ? "claude-sonnet-5" : undefined,
        isByok: false, edition: edName(), clamped: isStandardEd(),
      });
      return Promise.resolve({ success: true, model: "claude-haiku-4-5-20251001", isByok: true, edition: edName(), clamped: false });
    case "getAgentModel":
      if (payload && payload.provider === "atlassian") {
        return Promise.resolve({ success: true, model: isStandardEd() ? "" : "claude-sonnet-5", edition: edName(), frontierOnly: true });
      }
      return Promise.resolve({ success: true, model: "anthropic/claude-opus-5", edition: edName(), frontierOnly: false });
    case "saveAgentModel":
      if (isStandardEd() && payload && payload.provider === "atlassian") {
        return Promise.resolve({ success: false, upgradeRequired: true, featureId: "agentModel", error: "The agent model on Forge LLM is part of CogniRunner Coder \u2014 upgrade in Jira's Manage apps." });
      }
      return Promise.resolve({ success: true });
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
    case "getContextDocs": return Promise.resolve((typeof window !== "undefined" && window.__EMPTY__) ? { success: true, docs: [] } : DOCS);
    case "getContextDocContent": return Promise.resolve({ success: true, doc: { content: '{\n  "orders": { "GET /v2/orders": "List orders" }\n}' } });
    // F-167 - window.__MEMORY_FULL__ models the store at its hard ceiling: the backend
    // answers getMemorySettings/getKnowledgeCounts with storeFull = { at, reason } and
    // refuses a user add with reason "cap". The counts chip must then read "200 / 200".
    // F-175 - both numbers are MAX_MEMORIES, not a typed 200: "at the ceiling" means
    // memories === the cap, so raising the cap must move this fixture with it.
    case "getKnowledgeCounts": return Promise.resolve(
      typeof window !== "undefined" && window.__MEMORY_FULL__
        ? { success: true, docs: 4, skills: 6, memories: MAX_MEMORIES, memoryCap: MAX_MEMORIES, storeFull: MEMORY_STORE_FULL }
        : { success: true, docs: 4, skills: 6, memories: 12 });
    /* F-189 - what the store WEIGHS. Its own resolver, mirroring memoryStoreStats(): the
     * two verdict booleans are computed from the same comparisons the backend uses
     * (overGuard is >=, overPlatform is >), never hand-set, so a fixture cannot claim a
     * state the real rule would not produce. Answered on BOTH branches because the stats
     * line has two states — slate under the guard, red over it — and both are real. */
    case "getMemoryStoreStats": {
      /* F-234 — this resolver carries the SAME F-228 viewer floor as getMemories, so a
         non-roster reader must be refused here too: without it the fixture models a
         half-state no tenant is ever in — the read refused but the store's byte pressure
         still reported — and the access-denied screen would be verified with a size line
         the real backend would never send.
         F-296 — that refusal now happens in ROSTER_GATED_READS above, with the docs and
         skills reads that carry the identical floor. Kept as ONE list rather than a
         per-case line each, because five hand-copied refusals are five chances for the
         tabs to disagree about what "not on the roster" means. */
      const bytes = isMemoryOvercap() ? MEMORY_OVERCAP_BYTES : 49152;
      return Promise.resolve({
        success: true,
        rows: isMemoryOvercap() ? 40 : MEMORY_ROWS.filter((m) => !DELETED_MEMORY_IDS.has(m.id)).length,
        bytes,
        guardBytes: MEMORY_MAX_SERIALIZED_BYTES,
        platformBytes: MEMORY_PLATFORM_MAX_SERIALIZED_BYTES,
        overGuard: bytes >= MEMORY_MAX_SERIALIZED_BYTES,
        overPlatform: bytes > MEMORY_PLATFORM_MAX_SERIALIZED_BYTES,
        bytesOverPlatform: Math.max(0, bytes - MEMORY_PLATFORM_MAX_SERIALIZED_BYTES),
        storeFull: (typeof window !== "undefined" && window.__MEMORY_FULL__) ? MEMORY_STORE_FULL : null,
      });
    }
    case "getMemorySettings": return Promise.resolve({ success: true, settings: MEMORY_SETTINGS() });
    case "getSkills": if (typeof window !== "undefined" && window.__EMPTY__) return Promise.resolve({ success: true, skills: [] }); return Promise.resolve({ success: true, skills: [
      { id: "sk1", name: "Create a linked issue", category: "Jira API", builtin: true, description: "Create and link a sub-task or related issue via the REST API." },
      { id: "sk2", name: "Find duplicates by summary", category: "Workflow Patterns", builtin: true, description: "Search the project with JQL for issues with a similar summary." },
      { id: "sk3", name: "Build an ADF comment", category: "ADF & Formatting", builtin: true, description: "Construct a valid Atlassian Document Format comment body." },
      { id: "sk4", name: "Read a custom field safely", category: "Fields & Data", builtin: true, description: "Read a custom field by id, handling missing or null values." },
      { id: "sk5", name: "Post to an external webhook", category: "External / Webhooks", builtin: false, description: "Notify an external service on a transition." },
      { id: "sk6", name: "Summarize a description", category: "Other", builtin: false, description: "Condense a long description into a short, structured summary." },
    ] });
    /* F-234 — `__NO_ROSTER__` is the F-228 VIEWER FLOOR refusing the read: a user who is
       on neither the CogniRunner roster nor Jira's admin list. The shape is the backend's
       own `noPerm("read memories", "viewer")` VERBATIM (src/index.js:476/7395).
       F-242 — the shape GREW a machine-readable half: `reason:"no-permission"` plus the
       `needsRole` the gate asked for. The note about the frontend "matching the sentence"
       is dead and was the thing worth killing: the UI now branches on `reason` and BUILDS
       its sentence from `needsRole`, so this fixture must carry both or every refusal test
       would silently assert against the failure path instead of the refusal path. */
    case "getMemories":
      /* F-296 — the `__NO_ROSTER__` refusal moved to ROSTER_GATED_READS at the top of
         invoke(), alongside the docs and skills reads behind the same viewer floor. */
      if (typeof window !== "undefined" && window.__EMPTY__) return Promise.resolve({ success: true, memories: [], settings: MEMORY_SETTINGS() });
      return Promise.resolve({ success: true, settings: MEMORY_SETTINGS(), memories: MEMORY_ROWS.filter((m) => !DELETED_MEMORY_IDS.has(m.id)) });
    /* 1.4 commit 6 - Code tab. Every one of these resolvers is requireAdmin in the
       backend, so `__REFUSE__`/`__NO_ROSTER__` at the top of invoke() is what models a
       non-admin reader; these arms are the ADMIN answers. */
    case "getAgentCapability": return Promise.resolve(CODE_CAP());
    case "listGitConnections": return Promise.resolve({ success: true, connections: CODE_CONNS() });
    /* 1.4 commit 9b - THE CODER PANEL. Four doors, and the shapes are the ENGINE's own
       (src/coder-engine.js runCoderTurn / getCoderThread / confirmCoderTicket): a turn is
       `{success, async:true, taskId, threadId}` and the RESULT arrives through
       getAsyncTaskResult, exactly like every other queued AI task. See CODER_STATE. */
    case "startCoderTurn": case "getCoderThread": case "confirmCoderTicket":
      return coderInvoke(name, payload);
    case "saveGitConnection": return Promise.resolve({ success: true, connection: CODE_CONNS()[0], whoami: { kind: "github", login: "acme-bot", name: "Acme Bot", scopes: ["repo", "workflow"] } });
    case "testGitConnection":
      if (typeof window !== "undefined" && window.__CODE_TEST_FAILS__) {
        return Promise.resolve({ success: false, error: "The provider could not be reached", code: "network", transient: true });
      }
      return Promise.resolve({ success: true, whoami: { kind: "github", login: "acme-bot", name: "Acme Bot", scopes: ["repo", "workflow"] }, capabilities: { canCreateRepos: true, canWebhooks: true, canPipelines: null, reason: "Derived from the classic token's reported OAuth scopes." } });
    case "setGitRepoAllowlist": return Promise.resolve({ success: true, connection: CODE_CONNS()[0] });
    case "deleteGitConnection": return Promise.resolve({ success: true });
    case "rotateGitCredential": return Promise.resolve({ success: true, taskId: "rot_abc", queued: true });
    case "getForgeIdentityStatus": return Promise.resolve({ success: true, status: CODE_IDENTITY() });
    case "saveForgeIdentity":
      // The backend FAILS CLOSED without an explicit consent flag, and so does the mock -
      // a fixture that accepted a missing flag would let a consent-free form ship.
      if (!payload || payload.consent !== true) return Promise.resolve({ success: false, error: "Explicit consent is required to store a deploy identity", code: "consent_required" });
      return Promise.resolve({ success: true, status: { hasIdentity: true, email: payload.email || null, consent: { accountId: ACCT, at: new Date().toISOString() }, rotation: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } });
    case "clearForgeIdentity": return Promise.resolve({ success: true, status: { hasIdentity: false, email: null, consent: null, rotation: null, createdAt: null, updatedAt: null } });
    /* listeners + scheduled jobs + API tokens (admin) */
    case "getListeners": return Promise.resolve({ success: true, listeners: LISTENER_ROWS });
    case "getListener": return Promise.resolve(LISTENER_FULL[payload && payload.id] ? { success: true, listener: LISTENER_FULL[payload.id] } : { success: false, error: "Listener not found" });
    case "saveListener": { const l = (payload && payload.listener) || {}; return Promise.resolve({ success: true, listener: { ...l, id: l.id || "lst_new1", stats: l.stats || { runCount: 0 } } }); }
    case "deleteListener": case "setListenerEnabled": return Promise.resolve({ success: true, listener: { ...(LISTENER_FULL[payload && payload.id] || {}), enabled: payload && payload.enabled }, removed: true });
    case "testListener": return new Promise((r) => setTimeout(() => r({ success: true, result: LISTENER_TEST_RESULT }), 300));
    case "getEventSample": return Promise.resolve({ success: true, sample: (payload && payload.eventType === "avi:jira:created:issue") ? { eventType: "avi:jira:created:issue", capturedAt: "2026-09-01T08:00:00.000Z", payload: { eventType: "avi:jira:created:issue", atlassianId: ACCT, issue: { id: "10042", key: "PROJ-42", fields: { summary: "Payment retry fails", issuetype: { name: "Bug" }, project: { key: "PROJ" } } } } } : null });
    case "getScheduledJobs": return Promise.resolve({ success: true, jobs: JOB_ROWS });
    case "getScheduledJob": return Promise.resolve(JOB_FULL[payload && payload.id] ? { success: true, job: JOB_FULL[payload.id] } : { success: false, error: "Scheduled job not found" });
    case "saveScheduledJob": { const j = (payload && payload.job) || {}; return Promise.resolve({ success: true, job: { ...j, id: j.id || "job_new1", stats: j.stats || { runCount: 0 } } }); }
    case "deleteScheduledJob": case "setScheduledJobEnabled": return Promise.resolve({ success: true, job: { ...(JOB_FULL[payload && payload.id] || {}), enabled: payload && payload.enabled }, removed: true });
    case "runScheduledJobNow": return Promise.resolve({ success: true, async: true, taskId: "task-job-1" });
    case "previewSchedule": return Promise.resolve({ success: true, ok: true, description: "Weekdays at 09:00", runs: ["2026-09-02T07:00:00.000Z"] });
    case "getAsyncTaskResult":
      if (payload && payload.taskId === "task-job-1") return Promise.resolve({ success: true, status: "done", result: { success: true, reason: "2/2 issue(s) processed OK, 4 change(s)", changes: [{ action: "addComment", key: "PROJ-7", id: "1" }, { action: "addLabels", key: "PROJ-7" }], logs: ["Scope \"project = PROJ AND status = \"In Progress\" AND updated <= -7d\" matched 2 issue(s) (cap 25)", "--- PROJ-7: OK — done: asked for an update", "--- PROJ-9: OK — done: asked for an update"], issues: [{ key: "PROJ-7", success: true }, { key: "PROJ-9", success: true }], executionTimeMs: 6120, tokens: 1830 } });
      return Promise.resolve({ success: true, status: "pending" });
    case "getApiTokens": return Promise.resolve(API_TOKENS);
    case "createApiToken": return Promise.resolve({ success: true, token: "cgr_9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f", row: { id: "tok_2", name: (payload && payload.name) || "API token", prefix: "cgr_9f9f9f", createdAt: new Date().toISOString(), createdBy: ACCT, lastUsedAt: null, revokedAt: null } });
    case "revokeApiToken": return Promise.resolve({ success: true, revoked: true });
    case "generatePostFunctionCode": return Promise.resolve({ success: true, code: STATIC_CODE_1, meta: { appliedDocs: [{ id: "builtin_doc_jql", title: "JQL Cheat Sheet" }], appliedSkills: [], appliedMemories: 1, truncatedDocs: [] } });
    // F-150 — window.__FIX_MEMORY__ = true makes the fix answer carry a memoryCandidate,
    // which is what drives FunctionBlock's post-verified-re-run addMemory tail (the badge
    // + veto). Opt-in so the other fix journeys keep their existing, memory-free screens.
    // F-158 — successive fixes return DIFFERENT code (a real fix always moves the source),
    // and __FIX_MEMORY__ is read PER CALL so a test can turn the candidate off for fix #2 —
    // the commonest real shape (typo / ReferenceError repairs teach nothing reusable, so
    // src/index.js instructs the model to answer memoryCandidate: null).
    case "fixPostFunctionCode": {
      if (typeof window !== "undefined") window.__FIXCALLS__ = (window.__FIXCALLS__ || 0) + 1;
      const nth = (typeof window !== "undefined" && window.__FIXCALLS__) || 1;
      return Promise.resolve({ success: true, code: nth >= 2 ? STATIC_CODE_FIXED_2 : STATIC_CODE_FIXED, explanation: "Renamed the undefined `dupes` to `duplicates` and guarded the empty case.", meta: { appliedDocs: [], appliedSkills: [], appliedMemories: 1, truncatedDocs: [] }, ...(typeof window !== "undefined" && window.__FIX_MEMORY__ ? { memoryCandidate: { content: "api.searchJql returns { issues }, not a bare array — destructure before mapping.", projectScoped: false } } : {}) });
    }
    // F-155 — addMemory has TWO real shapes and the UI must tell them apart:
    //   { success, id, merged: false } -> a NEW row this fix owns (veto = undo)
    //   { success, id, merged: true }  -> the candidate was deduped INTO an existing memory,
    //                                     so `id` is somebody else's row and a delete is not an undo.
    // window.__MEMORY_MERGED__ = true selects the merged shape.
    // F-158 — a THIRD real shape (backend 5dd3d4f): the store could not keep the row, so
    // the resolver answers success:false with reason "cap" and stored:false. There is no id,
    // so there is nothing to badge and nothing to veto — and it is NOT a generic failure.
    // The kept shapes carry stored:true (+ whatever the write evicted).
    // F-175 — BOTH cap branches now answer with the backend's real refusal, built by the
    // shared memoryCapRefusalMessage(). Two bugs died here: __MEMORY_CAP__ carried no
    // `error` at all (the Memories tabs render that field, so the inline refusal had
    // nothing to say), and __MEMORY_FULL__ carried a hand-typed near-miss of the sentence.
    // The two branches differ only in what ELSE the scenario sets up, never in the words.
    // F-189 — a FOURTH shape: the row cap is fine and the BYTE guard is not. Distinct
    // `reason` ("platform-cap") and a `bytesOver` the UI must name, because "it is full"
    // with no magnitude is a refusal nobody can size a response to.
    // F-190 — window.__MEMORY_BYTES__ is the BYTE-guard refusal: `reason: "bytes"`, the
    // other half of memoryCapRefusalMessage and the shape no scenario ever produced. It is
    // exactly what FunctionBlock's toast used to swallow — it branched on `reason === "cap"`
    // alone, so this landed in the else and announced "Nothing was learned from it.", an
    // outcome with no cause on the one surface the author is looking at.
    case "addMemory": return Promise.resolve(
      isMemoryOvercap()
        ? MEMORY_PLATFORM_REFUSAL()
        : typeof window !== "undefined" && window.__MEMORY_BYTES__
        ? { success: false, reason: "bytes", stored: false, error: memoryCapRefusalMessage("bytes") }
        : typeof window !== "undefined" && window.__MEMORY_CAP__
        ? { success: false, reason: "cap", stored: false, error: memoryCapRefusalMessage("cap") }
        : typeof window !== "undefined" && window.__MEMORY_FULL__
        ? { success: false, reason: "cap", stored: false, error: memoryCapRefusalMessage("cap") }
        : typeof window !== "undefined" && window.__MEMORY_MERGED__
        ? { success: true, id: "mem_existing_7", merged: true, stored: true, evicted: [] }
        : { success: true, id: "mem_fix_1", merged: false, stored: true, evicted: [] });
    // F-189 — an edit is a write too, and lands on the same wall.
    case "updateMemory": return Promise.resolve(isMemoryOvercap() ? MEMORY_PLATFORM_REFUSAL() : { success: true });
    // F-189 — deleteMemory takes `{ id }` (one row) OR `{ ids: [...] }` (bulk). The bulk
    // answer reports how many actually went, which is what the toast counts.
    case "deleteMemory": {
      const ids = payload && Array.isArray(payload.ids) ? payload.ids : (payload && payload.id ? [payload.id] : []);
      // Recorded unconditionally so a test can assert the SHAPE of the call: bulk delete
      // must be ONE `{ ids: [...] }` invoke, not N `{ id }` ones. `pf_memories` is a single
      // KVS value, so N calls are N read-modify-writes racing each other — a UI that loops
      // deletes looks identical on screen and is wrong on the wire.
      if (typeof window !== "undefined") {
        window.__DELETE_MEMORY_CALLS__ = window.__DELETE_MEMORY_CALLS__ || [];
        window.__DELETE_MEMORY_CALLS__.push(payload);
      }
      /* F-217 - MIRROR src/index.js deleteMemory (~7343-7368), in its order, because the
         order is the behaviour:

         1. PRESENCE FIRST. The backend resolves `deleted` / `notFound` against the rows it
            actually holds and returns `{ success:false, error:"Memory not found", notFound }`
            when NOTHING matched - before any write, so before any cap can be consulted. The
            mock used to check the cap first, which made a delete of an already-gone row
            answer "over Jira's storage limit" - a sentence the backend cannot produce for
            that input, and the one shape that would hide a real ordering bug in the UI.
         2. THEN THE WRITE, AND THE WRITE IS BYTES. `pf_memories` is one KVS value: the
            delete rewrites the whole array, and `saveMemories` refuses when what comes out
            is still over the PLATFORM ceiling. F-209 modelled that as "one row is never
            enough, two always are", which is a rule about COUNT and is not true - it made
            a 1-row delete of a store 10 bytes over refuse. Model the real quantity: the
            post-delete serialized size. Freed bytes come off `deleted.length`, not
            `ids.length`, because rows that were already gone free nothing.
         3. THE REFUSAL ARM CARRIES THE ARRAYS. src/index.js returns `deleted: []` and the
            real `notFound` on refusal (F-188/F-202) - nothing went, but the stale ids are
            still worth reporting. A mock that omits them lets a UI reading
            `result.deleted.length` on the failure path pass here and throw in production. */
      const alreadyGone = ids.filter((i) => isServerGone(i));
      const deleted = ids.filter((i) => !isServerGone(i));
      if (!deleted.length) return Promise.resolve({ success: false, error: "Memory not found", notFound: alreadyGone });
      if (isMemoryOvercap()) {
        const after = MEMORY_OVERCAP_BYTES - (deleted.length * MEMORY_OVERCAP_ROW_BYTES);
        if (after > MEMORY_PLATFORM_MAX_SERIALIZED_BYTES) {
          return Promise.resolve({
            ...MEMORY_PLATFORM_REFUSAL(after - MEMORY_PLATFORM_MAX_SERIALIZED_BYTES),
            deleted: [], notFound: alreadyGone, evicted: [],
          });
        }
      }
      ids.forEach((i) => DELETED_MEMORY_IDS.add(i));
      return Promise.resolve({ success: true, deleted, notFound: alreadyGone, evicted: [] });
    }
    case "reviewConfig": return Promise.resolve({ success: true, review: { verdict: "has_issues", summary: "The steps are sound; two improvements suggested.", items: [{ type: "warning", message: "Step 2 posts a comment without checking the issue is still open." }, { type: "suggestion", message: "Reuse the JQL result from step 1 instead of re-querying." }] }, tokens: 1240 });
    case "searchIssues": return Promise.resolve({ success: true, issues: [{ key: "PROJ-481", fields: { summary: "Checkout latency spike on mobile", status: { name: "In Progress" }, issuetype: { name: "Bug" } } }] });
    case "validateIssue": return Promise.resolve({ success: true, valid: true, summary: "Checkout latency spike on mobile", status: "In Progress", type: "Bug" });
    default: return Promise.resolve({ success: true });
  }
}

const view = {
  getContext: async () => getContext(),
  theme: { enable: async () => { applyTheme(); } },
};
// Record router calls so tests can assert a handoff navigated (window.__ROUTER_CALLS__).
const _recordRouter = (fn, arg) => {
  if (typeof window !== "undefined") { window.__ROUTER_CALLS__ = window.__ROUTER_CALLS__ || []; window.__ROUTER_CALLS__.push({ fn, arg }); }
  return Promise.resolve();
};
const router = { open: (url) => _recordRouter("open", url), navigate: (arg) => _recordRouter("navigate", arg) };
const requestJira = async () => ({ ok: true, json: async () => ({}) });

export { invoke, view, router, requestJira };
export default { invoke, view, router, requestJira };
