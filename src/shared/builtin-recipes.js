/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Premade post-function RECIPES — ready-made, parameterised code templates for the
 * static post-function builder. A recipe is an alternative entry point to authoring
 * a step: pick a recipe, fill a small param form, and `build(params)` returns sandbox
 * JS that drops into the existing CodeEditor and flows through the SAME Test → Fix →
 * Save pipeline. No AI is used to author the code (deterministic), and none at runtime.
 *
 * Dependency-free; mirrors builtin-skills.js / builtin-docs.js. Imported by the
 * frontends (FunctionBlock) via the shared relative path. NOT seeded into storage —
 * this is a static catalog read directly.
 *
 * Recipe entry:
 *   key           stable id
 *   label         dropdown label
 *   description   one-liner shown under the picker
 *   category      reuses the skill taxonomy for badge styling
 *   apiMembers    sandbox api.* methods the generated code uses — the UI greys a recipe
 *                 whose members aren't all in KNOWN_API_MEMBERS (the Phase-2 gate)
 *   operationType pre-sets the step's operation type so auto-detect doesn't fight it
 *   params        [{ name, type, label, required, options?, default?, hint? }]
 *                 type ∈ field | value | jql | operator | number | select
 *   build(params) → string of sandbox JS. ALWAYS JSON.stringify interpolated values
 *                 (safe escaping into the generated source — honours the JQL/code lint).
 *
 * Phase 1a recipes below use ONLY the always-available methods
 * (getIssue / updateIssue / searchJql / transitionIssue / log / context) so they are
 * lint-clean, test-clean, and prod-clean with no spec changes.
 */

export const RECIPE_CATALOG_VERSION = 1;

const EMPTY_CHECK = 'cur === null || cur === undefined || cur === "" || (Array.isArray(cur) && cur.length === 0)';

export const BUILTIN_RECIPES = [
  {
    key: "copy_field",
    label: "Copy a field to another field",
    description: "Reads a source field on this issue and writes its value into a target field. Best for same-type text/number fields.",
    category: "Fields & Data",
    apiMembers: ["getIssue", "updateIssue"],
    operationType: "rest_api_internal",
    params: [
      { name: "source", type: "field", label: "Source field", required: true },
      { name: "target", type: "field", label: "Target field", required: true },
      {
        name: "onlyIfEmpty", type: "select", label: "When", required: false, default: "always",
        options: [
          { value: "always", label: "Always overwrite the target" },
          { value: "empty", label: "Only if the target is empty" },
        ],
      },
    ],
    build: (p) => {
      const src = JSON.stringify(p.source);
      const tgt = JSON.stringify(p.target);
      if (p.onlyIfEmpty === "empty") {
        return `// Recipe: copy ${p.source} -> ${p.target} (only if target empty)
const issue = await api.getIssue(api.context.issueKey);
const value = issue.fields[${src}];
const cur = issue.fields[${tgt}];
if (${EMPTY_CHECK}) {
  await api.updateIssue(api.context.issueKey, { [${tgt}]: value });
  api.log("Copied ${p.source} -> ${p.target}");
} else {
  api.log("${p.target} already set - skipped");
}`;
      }
      return `// Recipe: copy ${p.source} -> ${p.target}
const issue = await api.getIssue(api.context.issueKey);
const value = issue.fields[${src}];
await api.updateIssue(api.context.issueKey, { [${tgt}]: value });
api.log("Copied ${p.source} -> ${p.target}");`;
    },
  },

  {
    key: "set_field",
    label: "Set a field to a fixed value",
    description: "Writes a constant value to a field. Choose the value shape that matches the field type.",
    category: "Fields & Data",
    apiMembers: ["updateIssue"],
    operationType: "rest_api_internal",
    params: [
      { name: "target", type: "field", label: "Target field", required: true },
      { name: "value", type: "value", label: "Value", required: true },
      {
        name: "valueShape", type: "select", label: "Value shape", required: false, default: "plain",
        options: [
          { value: "plain", label: "Plain text / number" },
          { value: "name", label: "By name  { name: … }  (priority, status…)" },
          { value: "value", label: "By value  { value: … }  (select fields)" },
          { value: "id", label: "By id  { id: … }" },
          { value: "accountId", label: "User  { accountId: … }" },
        ],
      },
    ],
    build: (p) => {
      const tgt = JSON.stringify(p.target);
      const raw = JSON.stringify(p.value ?? "");
      let wrapped;
      switch (p.valueShape) {
        case "name": wrapped = `{ name: ${raw} }`; break;
        case "value": wrapped = `{ value: ${raw} }`; break;
        case "id": wrapped = `{ id: ${raw} }`; break;
        case "accountId": wrapped = `{ accountId: ${raw} }`; break;
        default: wrapped = raw;
      }
      return `// Recipe: set ${p.target}
await api.updateIssue(api.context.issueKey, { [${tgt}]: ${wrapped} });
api.log("Set ${p.target}");`;
    },
  },

  {
    key: "clear_field",
    label: "Clear a field",
    description: "Empties a field. Use the array option for multi-value fields (components, labels, fix versions).",
    category: "Fields & Data",
    apiMembers: ["updateIssue"],
    operationType: "rest_api_internal",
    params: [
      { name: "target", type: "field", label: "Target field", required: true },
      {
        name: "kind", type: "select", label: "Field kind", required: false, default: "scalar",
        options: [
          { value: "scalar", label: "Single value (set to empty)" },
          { value: "array", label: "Multi-value (set to empty list)" },
        ],
      },
    ],
    build: (p) => {
      const tgt = JSON.stringify(p.target);
      const empty = p.kind === "array" ? "[]" : "null";
      return `// Recipe: clear ${p.target}
await api.updateIssue(api.context.issueKey, { [${tgt}]: ${empty} });
api.log("Cleared ${p.target}");`;
    },
  },

  {
    key: "conditional_set",
    label: "Set a field only when another field matches",
    description: "Reads a source field, and if it matches your operator/value, writes a value into a target field.",
    category: "Fields & Data",
    apiMembers: ["getIssue", "updateIssue"],
    operationType: "rest_api_internal",
    params: [
      { name: "source", type: "field", label: "Source field", required: true },
      {
        name: "operator", type: "operator", label: "Operator", required: true, default: "eq",
        options: [
          { value: "eq", label: "equals" },
          { value: "ne", label: "does not equal" },
          { value: "contains", label: "contains" },
          { value: "empty", label: "is empty" },
          { value: "not_empty", label: "is not empty" },
        ],
      },
      { name: "compareValue", type: "value", label: "Compare value", required: false, hint: "Not needed for is empty / is not empty" },
      { name: "target", type: "field", label: "Target field to set", required: true },
      { name: "setValue", type: "value", label: "Value to set", required: true },
    ],
    build: (p) => {
      const src = JSON.stringify(p.source);
      const tgt = JSON.stringify(p.target);
      const cmp = JSON.stringify(String(p.compareValue ?? ""));
      const setVal = JSON.stringify(p.setValue ?? "");
      let cond;
      switch (p.operator) {
        case "empty": cond = `(${EMPTY_CHECK})`; break;
        case "not_empty": cond = `!(${EMPTY_CHECK})`; break;
        case "ne": cond = `String(text).toLowerCase() !== ${cmp}.toLowerCase()`; break;
        case "contains": cond = `String(text).toLowerCase().includes(${cmp}.toLowerCase())`; break;
        default: cond = `String(text).toLowerCase() === ${cmp}.toLowerCase()`; // eq
      }
      return `// Recipe: set ${p.target} when ${p.source} ${p.operator} compare value
const issue = await api.getIssue(api.context.issueKey);
const cur = issue.fields[${src}];
const text = cur && typeof cur === "object" ? (cur.value ?? cur.name ?? "") : (cur ?? "");
if (${cond}) {
  await api.updateIssue(api.context.issueKey, { [${tgt}]: ${setVal} });
  api.log("Condition met - set ${p.target}");
} else {
  api.log("Condition not met - no change");
}`;
    },
  },

  {
    key: "rollup_sum_subtasks",
    label: "Sum a number across sub-tasks",
    description: "Adds up a numeric field across all sub-tasks of this issue and writes the total to a target field.",
    category: "Workflow Patterns",
    apiMembers: ["getIssue", "updateIssue"],
    operationType: "rest_api_internal",
    params: [
      { name: "sourceField", type: "field", label: "Numeric field on sub-tasks", required: true },
      { name: "target", type: "field", label: "Target field (total)", required: true },
    ],
    build: (p) => {
      const src = JSON.stringify(p.sourceField);
      const tgt = JSON.stringify(p.target);
      return `// Recipe: sum ${p.sourceField} across sub-tasks -> ${p.target}
const issue = await api.getIssue(api.context.issueKey);
const subtasks = issue.fields.subtasks || [];
let total = 0;
for (const st of subtasks) {
  const full = await api.getIssue(st.key);
  const v = Number(full.fields[${src}]);
  if (!Number.isNaN(v)) total += v;
}
await api.updateIssue(api.context.issueKey, { [${tgt}]: total });
api.log("Rolled up " + subtasks.length + " sub-task(s) -> ${p.target} = " + total);`;
    },
  },

  {
    key: "bulk_transition_linked",
    label: "Bulk-transition sub-tasks or linked issues",
    description: "Finds this issue's sub-tasks (or linked issues) and runs a transition on each. Transition IDs are numeric.",
    category: "Workflow Patterns",
    apiMembers: ["searchJql", "transitionIssue"],
    operationType: "work_item_query",
    params: [
      {
        name: "scope", type: "select", label: "Which issues", required: true, default: "subtasks",
        options: [
          { value: "subtasks", label: "Sub-tasks of this issue" },
          { value: "linked", label: "Issues linked to this issue" },
        ],
      },
      { name: "transitionId", type: "value", label: "Transition ID (numeric)", required: true, hint: "Numeric id — transition names can't be looked up in the sandbox." },
      { name: "max", type: "number", label: "Max issues", required: false, default: 20 },
    ],
    build: (p) => {
      const tid = JSON.stringify(String(p.transitionId ?? ""));
      const max = Number(p.max) || 20;
      const jqlLine =
        p.scope === "linked"
          ? `const jql = 'issue in linkedIssues("' + api.context.issueKey + '")';`
          : `const jql = 'parent = "' + api.context.issueKey + '"';`;
      return `// Recipe: bulk-transition ${p.scope}
${jqlLine}
const results = await api.searchJql(jql);
const targets = (results.issues || []).slice(0, ${max});
api.log("Transitioning " + targets.length + " issue(s)");
for (const t of targets) {
  try {
    await api.transitionIssue(t.key, ${tid});
    api.log("Transitioned " + t.key);
  } catch (e) {
    api.log("Failed " + t.key + ": " + e.message);
  }
}`;
    },
  },

  {
    key: "append_to_text",
    label: "Append a line to a plain-text field",
    description: "Adds a line to a plain-text field, keeping the existing content. For plain-text custom fields (not rich-text/ADF).",
    category: "Fields & Data",
    apiMembers: ["getIssue", "updateIssue"],
    operationType: "rest_api_internal",
    params: [
      { name: "target", type: "field", label: "Target text field", required: true },
      { name: "text", type: "value", label: "Line to append", required: true },
    ],
    build: (p) => {
      const tgt = JSON.stringify(p.target);
      const txt = JSON.stringify(p.text ?? "");
      return `// Recipe: append a line to ${p.target}
const issue = await api.getIssue(api.context.issueKey);
const current = issue.fields[${tgt}];
const existing = typeof current === "string" ? current : "";
const updated = existing ? existing + "\\n" + ${txt} : ${txt};
await api.updateIssue(api.context.issueKey, { [${tgt}]: updated });
api.log("Appended to ${p.target}");`;
    },
  },

  // --- Phase 1b/2: use richer sandbox methods. The picker greys these unless every
  //     apiMember is in KNOWN_API_MEMBERS, and they're testable via the dry-run stubs. ---

  {
    key: "add_remove_labels",
    label: "Add / remove labels",
    description: "Adds and/or removes labels without clobbering existing ones (concurrency-safe).",
    category: "Fields & Data",
    apiMembers: ["addLabels", "removeLabels"],
    operationType: "rest_api_internal",
    params: [
      { name: "add", type: "value", label: "Labels to add", required: false, hint: "Comma-separated, e.g. triaged, urgent" },
      { name: "remove", type: "value", label: "Labels to remove", required: false, hint: "Comma-separated" },
    ],
    build: (p) => {
      const add = String(p.add || "").split(",").map((s) => s.trim()).filter(Boolean);
      const rem = String(p.remove || "").split(",").map((s) => s.trim()).filter(Boolean);
      const lines = ["// Recipe: add / remove labels"];
      if (add.length) lines.push(`await api.addLabels(${add.map((l) => JSON.stringify(l)).join(", ")});`);
      if (rem.length) lines.push(`await api.removeLabels(${rem.map((l) => JSON.stringify(l)).join(", ")});`);
      lines.push(`api.log("Labels updated");`);
      return lines.join("\n");
    },
  },

  {
    key: "clone_issue",
    label: "Clone this issue",
    description: "Clones the current issue (optionally linking the clone back). Guarded with an issue property so a re-fired transition won't create duplicates.",
    category: "Workflow Patterns",
    apiMembers: ["getIssue", "cloneIssue", "createIssueLink", "getProperty", "setProperty"],
    operationType: "rest_api_internal",
    params: [
      { name: "summaryPrefix", type: "value", label: "Summary prefix", required: false, hint: "e.g. [Copy] — prepended to the clone's summary" },
      {
        name: "link", type: "select", label: "Link the clone back", required: false, default: "yes",
        options: [
          { value: "yes", label: "Yes — link as “Cloners”" },
          { value: "no", label: "No link" },
        ],
      },
    ],
    build: (p) => {
      const prefix = JSON.stringify(p.summaryPrefix || "");
      const linkBack = p.link !== "no";
      return `// Recipe: clone this issue (idempotent — the marker prevents duplicates on re-fire)
const MARKER = "cogni-recipe-clone-done";
const already = await api.getProperty(MARKER);
if (already) {
  api.log("Clone already created (" + already + ") — skipping");
  return;
}
const issue = await api.getIssue(api.context.issueKey);
const prefix = ${prefix};
const overrides = prefix ? { summary: prefix + " " + (issue.fields.summary || "") } : {};
const dup = await api.cloneIssue(overrides);
api.log("Cloned " + api.context.issueKey + " -> " + dup.key);
${linkBack ? `await api.createIssueLink(dup.key, "Cloners");\n` : ""}await api.setProperty(MARKER, dup.key);`;
    },
  },

  {
    key: "create_subtask",
    label: "Create a sub-task",
    description: "Creates a sub-task under the current issue. Guarded with an issue property so a re-fired transition won't create duplicates.",
    category: "Workflow Patterns",
    apiMembers: ["getIssue", "createIssue", "getProperty", "setProperty"],
    operationType: "rest_api_internal",
    params: [
      { name: "summary", type: "value", label: "Sub-task summary", required: true },
      { name: "issuetypeId", type: "value", label: "Sub-task issue type ID", required: true, hint: "Numeric id of the Sub-task issue type in this project." },
    ],
    build: (p) => {
      const summary = JSON.stringify(p.summary || "");
      const itid = JSON.stringify(String(p.issuetypeId || ""));
      return `// Recipe: create a sub-task (idempotent — the marker prevents duplicates on re-fire)
const MARKER = "cogni-recipe-subtask-done";
const already = await api.getProperty(MARKER);
if (already) {
  api.log("Sub-task already created (" + already + ") — skipping");
  return;
}
const parent = await api.getIssue(api.context.issueKey);
if (!parent.fields.project || !parent.fields.project.id) {
  api.log("Could not read parent project — aborting");
  return;
}
const sub = await api.createIssue({
  project: { id: parent.fields.project.id },
  parent: { key: api.context.issueKey },
  issuetype: { id: ${itid} },
  summary: ${summary},
});
api.log("Created sub-task " + sub.key);
await api.setProperty(MARKER, sub.key);`;
    },
  },
];

export const getRecipeByKey = (k) => BUILTIN_RECIPES.find((r) => r.key === k) || null;
export const RECIPE_CATEGORIES = [...new Set(BUILTIN_RECIPES.map((r) => r.category))];
