/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Premade (non-AI, "static") workflow rule catalog — the SINGLE SOURCE OF TRUTH.
 *
 * This module is dependency-free and bundles into BOTH the backend (the
 * `executePremadeRule` executor in src/premade-rules.js reads `key`s) AND the
 * three Custom UIs (config-ui / admin-panel / config-view import it via the
 * `../../../../src/shared/...` relative path, same as sandbox-api-spec.js).
 *
 * A "premade rule" is a deterministic check the user picks from a catalog and
 * parameterises in a small form — zero AI cost, instant, no prompt-writing.
 *
 * ⚠️ VALIDATORS and CONDITIONS are executed by two DIFFERENT engines. This caught
 * the project out for a long time (see F3 in test-harness/FINDINGS.md):
 *
 *   VALIDATORS run in CogniRunner's own backend `validate(args)`, branching on
 *   `configuration.ruleKind === 'premade'` → `executePremadeRule` in
 *   src/premade-rules.js. It reads via REST, so we use the REST status name
 *   (`status.statusCategory.key`) everywhere — Altomata's expression-vs-REST
 *   `status.category` name-crossing does not apply here.
 *
 *   CONDITIONS are evaluated by JIRA, as the Jira expression in manifest.yml.
 *   `validate()` is never called for a condition — `function` is not even a
 *   property of the jira:workflowCondition module. So a condition rule type is
 *   only real if the EXPRESSION implements it; see EXPRESSION_BACKED_CONDITIONS
 *   below, which must stay in lockstep with the manifest.
 *
 * Adding a VALIDATOR type = one entry here + the matching branch in
 * src/premade-rules.js. The parity lint (test-harness/scripts/premade-parity.mjs)
 * asserts every `available` entry has an executor branch, and vice-versa.
 * Adding a CONDITION type = one entry here + a branch in the manifest expression
 * + its key in EXPRESSION_BACKED_CONDITIONS + a both-directions case in
 * test-harness/scripts/reg-conditions-enforce.mjs.
 *
 * `availability`:
 *   'available'   — fully supported.
 *   'unavailable' — cannot be implemented as a backend VALIDATOR function because
 *                   Forge does not pass the acting user to one. (As CONDITIONS the
 *                   acting-user rules DO work: Jira's expression engine supplies
 *                   the `user` binding.) The form shows these greyed with
 *                   `unavailableReason`.
 *
 * Param vocabulary (drives the form renderer in PremadeRuleForm.jsx):
 *   field       — field picker (writes `fieldId` + `fieldName`)
 *   opValue     — operator dropdown + compare value (writes `op` + `compareValue`)
 *   regex       — regex pattern input (writes `regex`)
 *   allowed     — comma-separated list input (writes `allowedValues`)
 *   value       — single text input (writes `value`)
 *   lengthBounds— min/max number inputs (writes `min` / `max`)
 *   dateRel     — mode (future|within) + days (writes `mode` / `days`)
 *   text:{key,label,ph}              — one named text input
 *   picker:{key,label,source,ph,optional} — REST-backed dropdown (source = a list
 *                                           key from the getRuleLists resolver)
 */

export const COMPARE_OPS = [
  { value: "eq", label: "equals" },
  { value: "ne", label: "does not equal" },
  { value: "gt", label: "is greater than" },
  { value: "gte", label: "is at least" },
  { value: "lt", label: "is less than" },
  { value: "lte", label: "is at most" },
  { value: "contains", label: "contains" },
];

export const PREMADE_VALIDATORS = [
  {
    key: "field-required",
    label: "Field is required",
    help: "Block the transition unless the chosen field has a value.",
    params: { field: true },
    availability: "available",
  },
  {
    key: "field-changed",
    label: "Field must be changed",
    help: "Block unless the user edits this field to a value on the transition. The field must be on the transition screen; leaving it untouched (or clearing it) still blocks.",
    params: { field: true },
    availability: "available",
  },
  {
    key: "field-comparison",
    label: "Field compares to a value",
    help: "Block unless the field matches the comparison. Numbers compare numerically, ISO dates by date; greater/less on other text is skipped (allowed).",
    params: { field: true, opValue: true },
    availability: "available",
  },
  {
    key: "field-regex",
    label: "Field matches a pattern",
    help: "Block unless the field value matches a regular expression.",
    params: { field: true, regex: true },
    availability: "available",
  },
  {
    key: "allowed-values",
    label: "Field is one of…",
    help: "Block unless the field value is in an allowed list.",
    params: { field: true, allowed: true },
    availability: "available",
  },
  {
    key: "text-length",
    label: "Text length is within bounds",
    help: "Block unless a text/rich-text field's length is within the min/max you set (set at least one).",
    params: { field: true, lengthBounds: true },
    availability: "available",
  },
  {
    key: "date-relative",
    label: "Date is in the future / within N days",
    help: "Block unless a date field is in the future, or within N days from today. Dates are compared in UTC by calendar day.",
    params: { field: true, dateRel: true },
    availability: "available",
  },
  {
    key: "sub-tasks-resolved",
    label: "All sub-tasks must be resolved",
    help: "Block unless every sub-task of the issue is Done. No sub-tasks → allowed.",
    params: {},
    availability: "available",
  },
  {
    key: "attachment-required",
    label: "An attachment is required",
    help: "Block unless the issue has at least one attachment.",
    params: {},
    availability: "available",
  },
  {
    key: "comment-required",
    label: "A comment is required",
    help: "Block unless the user adds a comment on this transition. The Comment field must be on the transition screen, or no comment can be entered and it blocks for everyone.",
    params: {},
    availability: "available",
  },
  {
    key: "field-cardinality",
    label: "Field value count is within bounds",
    help: "Block unless a multi-value field (Fix versions, Components, Labels…) has a value count within the min/max you set. For exactly one, set min 1 and max 1.",
    params: { field: true, lengthBounds: true },
    availability: "available",
  },
];

/**
 * Condition rule types the Jira EXPRESSION in manifest.yml actually implements.
 *
 * A Forge condition is not a lambda — Jira evaluates it itself as a Jira
 * expression, so `src/premade-rules.js` never runs for a condition. Only what the
 * expression can compute is real; everything else would silently allow every
 * transition, which is worse than not offering it. The form greys out the rest.
 *
 * Keep this list in lockstep with the `expression:` block in manifest.yml, and
 * with test-harness/scripts/reg-conditions-enforce.mjs, which proves each one
 * both allows and blocks against a live instance.
 */
export const EXPRESSION_BACKED_CONDITIONS = [
  "issue-type-is",
  "issue-is-resolved",
  "resolution-is",
  "priority-is",
  "parent-status-is",
  "current-user-is-assignee",
  "current-user-is-reporter",
  // Field-based types — CUSTOM fields only, per-kind (see CONDITION_FIELD_KINDS).
  "field-has-value",
  "field-empty",
  "field-equals",
];

/**
 * Field-based condition support — CUSTOM fields only, per field kind.
 *
 * Why custom-only: for a custom field the Jira-expression accessor IS the REST
 * id (`issue.customfield_10010`), so the system-field name-mismatch class
 * (`dueDate` vs `duedate` — reads null, hides the transition on exactly the
 * issues that satisfy the rule) is structurally impossible. The manifest
 * expression additionally enforces this with a `^customfield_[0-9]+$` guard, so
 * even a hand-crafted config carrying a system id falls open, never null-reads.
 * System fields are a possible v2, each behind its own live-probed whitelist
 * entry.
 *
 * Why per-kind: expression `==` is STRICT — comparing a Number to a String (or
 * probing `.length` on a Number) is an evaluation ERROR, and an erroring
 * condition is FALSE = fail-closed. Every kind below was probed live on real
 * fields, both directions, before being listed (2026-08-13, 41 cases, 0
 * mismatches — `_probe-condition-fieldkinds.mjs`, FINDINGS F-COND-FIELD):
 *   nul — scalar kinds; unset reads null → null-check has-value/empty.
 *   arr — array kinds; unset reads null, set supports .length → null-or-length.
 *   str — plain-String values (text/url/date; date is REST "YYYY-MM-DD");
 *         equals folds BOTH sides with toLowerCase() in the expression engine.
 *   opt — {value} option objects (select/radio); equals compares ?.value.
 *   num — Number values; equals compares against `valueNum`, a JSON number in
 *         the config, which the expression receives TYPED (probed).
 * Kinds deliberately NOT given equals: textarea (rich object, not a String —
 * probed), datetime (exact-millisecond match is a UX trap), user/group/
 * version/cascading/project (object identities — v2 candidates).
 *
 * Keyed by the `schema.custom` suffix getFields returns for custom fields.
 */
export const CONDITION_FIELD_KINDS = {
  textfield: { presence: "nul", equals: "str" },
  textarea: { presence: "nul", equals: null },
  url: { presence: "nul", equals: "str" },
  float: { presence: "nul", equals: "num" },
  datepicker: { presence: "nul", equals: "str" },
  datetime: { presence: "nul", equals: null },
  select: { presence: "nul", equals: "opt" },
  radiobuttons: { presence: "nul", equals: "opt" },
  userpicker: { presence: "nul", equals: null },
  grouppicker: { presence: "nul", equals: null },
  cascadingselect: { presence: "nul", equals: null },
  version: { presence: "nul", equals: null },
  project: { presence: "nul", equals: null },
  labels: { presence: "arr", equals: null },
  multiselect: { presence: "arr", equals: null },
  multicheckboxes: { presence: "arr", equals: null },
  multiuserpicker: { presence: "arr", equals: null },
  multigrouppicker: { presence: "arr", equals: null },
  multiversion: { presence: "arr", equals: null },
};

/**
 * Resolve whether a picked field supports a field-based condition type, and
 * with which expression strategy. The single source for the picker, the config
 * assembly, and the docs. `field` is a getFields row ({id, name, custom,
 * schema}); returns { exprProp, exprKind } or { unsupported: <reason> }.
 */
export function conditionFieldSupport(field, ruleType) {
  if (!field || !field.id) return { unsupported: CONDITION_FIELD_UNSUPPORTED_REASON };
  // Custom fields only (v1) — the accessor is the REST id; system fields need a
  // per-field verified accessor map (v2). The manifest expression enforces the
  // same boundary with its customfield regex guard.
  if (!/^customfield_[0-9]+$/.test(String(field.id))) {
    return { unsupported: "System fields aren't supported for field conditions yet — Jira's expression engine names them differently from the field picker. Pick a custom field, or use a validator." };
  }
  const kindKey = String(field.schema?.custom || "").split(":").pop();
  const kind = CONDITION_FIELD_KINDS[kindKey];
  if (!kind) return { unsupported: CONDITION_FIELD_UNSUPPORTED_REASON };
  if (ruleType === "field-equals") {
    if (!kind.equals) {
      return { unsupported: "This field's type doesn't support an equals check as a condition (only text, URL, date, number, select and radio fields do). Use “Field has a value”, or a validator." };
    }
    return { exprProp: field.id, exprKind: kind.equals };
  }
  return { exprProp: field.id, exprKind: kind.presence };
}

/** Why a condition type isn't offered — shown in the picker. */
export const CONDITION_NOT_EXPRESSIBLE_REASON =
  "Not available as a condition: Jira evaluates conditions itself, in a sandbox that can't read related issues, attachments or group membership. Use a validator for this check.";

/** Shown when a PICKED FIELD's kind isn't supported for field conditions. */
export const CONDITION_FIELD_UNSUPPORTED_REASON =
  "This field's type isn't supported for conditions — only custom fields of a live-verified kind are (text, URL, date, datetime, number, select, radio, user, group, version, project, and the multi-value kinds for has/empty checks). Use a validator for anything else.";

export const PREMADE_CONDITIONS = [
  {
    key: "field-has-value",
    label: "Field has a value",
    help: "Only show this transition when the chosen custom field is set. A field hidden by a field configuration reads as empty.",
    params: { field: true },
    availability: "available",
  },
  {
    key: "field-equals",
    label: "Field equals a value",
    help: "Only show this transition when the chosen custom field equals a value (case-insensitive). An EMPTY field doesn't hide the transition — combine with “Field has a value” if it should.",
    params: { field: true, value: true },
    availability: "available",
  },
  {
    key: "issue-type-is",
    label: "Issue type is…",
    help: "Only show this transition for issues of the named type.",
    params: { picker: { key: "issueTypeName", label: "Issue type", source: "issuetypes", ph: "Choose an issue type…" } },
    availability: "available",
  },
  {
    key: "has-attachments",
    label: "Issue has attachments",
    help: "Only show this transition when the issue has at least one attachment.",
    params: {},
    availability: "available",
  },
  {
    key: "field-empty",
    label: "Field is empty",
    help: "Only show this transition when the chosen custom field has no value (the inverse of “Field has a value”). A field hidden by a field configuration reads as empty.",
    params: { field: true },
    availability: "available",
  },
  {
    key: "issue-is-resolved",
    label: "Issue is resolved",
    help: "Only show this transition when the issue has a resolution set.",
    params: {},
    availability: "available",
  },
  {
    key: "sub-tasks-all-resolved",
    label: "All sub-tasks are resolved",
    help: "Only show this transition when every sub-task is Done. No sub-tasks → shown.",
    params: {},
    availability: "available",
  },
  {
    key: "parent-status-is",
    label: "Parent issue status is…",
    help: "Only show this transition when the parent issue is in the chosen status. Top-level issues (no parent) → shown.",
    params: { picker: { key: "statusName", label: "Parent status", source: "statuses", ph: "Choose a status…" } },
    availability: "available",
  },
  {
    key: "resolution-is",
    label: "Resolution is…",
    help: "Only show this transition when the issue's resolution is the chosen value.",
    params: { picker: { key: "resolutionName", label: "Resolution", source: "resolutions", ph: "Choose a resolution…" } },
    availability: "available",
  },
  {
    key: "linked-issue-resolved",
    label: "Linked issues are resolved",
    help: "Only show this transition when all linked issues (optionally of one link type) are Done. No links → shown.",
    params: { picker: { key: "linkTypeName", label: "Link type", source: "linktypes", ph: "Any link type", optional: true } },
    availability: "available",
  },
  {
    key: "priority-is",
    label: "Priority is…",
    help: "Only show this transition when the issue's priority is the chosen value (e.g. only Highest can be Escalated).",
    params: { picker: { key: "priorityName", label: "Priority", source: "priorities", ph: "Choose a priority…" } },
    availability: "available",
  },
  // --- Acting-user conditions. As CONDITIONS these work because Jira's expression
  //     engine supplies the `user` binding; the manifest expression reads
  //     user.accountId directly. They are marked unavailable for VALIDATORS because
  //     Forge does not pass the acting user to a validator function.
  //     (An earlier note here claimed condition effects are "UI-only" because REST
  //     bypasses them. That was wrong — see F3 in test-harness/FINDINGS.md. Jira
  //     enforces conditions on the REST transition path too; our conditions did
  //     nothing only because the manifest shipped a constant expression:"true".) ---
  {
    key: "current-user-is-assignee",
    label: "User is the assignee",
    help: "Only show this transition to the issue's current assignee.",
    params: {},
    availability: "available",
  },
  {
    key: "current-user-is-reporter",
    label: "User is the reporter",
    help: "Only show this transition to the issue's reporter.",
    params: {},
    availability: "available",
  },
  {
    key: "user-in-field",
    label: "User is in a user field",
    help: "Only show this transition to the person named in the chosen single-user field (e.g. an Approver field). Field-relative, so it survives reassignment.",
    params: { field: true },
    availability: "available",
  },
  {
    key: "user-in-group",
    label: "User is in a group",
    help: "Only show this transition to members of the named group.",
    params: { picker: { key: "groupName", label: "Group", source: "groups", ph: "Choose a group…" } },
    availability: "available",
  },
  {
    key: "user-in-role",
    label: "User is in a project role",
    help: "Only show this transition to members of the named project role.",
    params: { picker: { key: "roleName", label: "Project role", source: "roles", ph: "Choose a role…" } },
    availability: "unavailable",
    unavailableReason: "Deferred — needs project-role-actor resolution and only resolves in company-managed projects. Use Jira's built-in “User Is In Project Role” condition.",
  },
];

export const getCatalog = (mode) =>
  mode === "condition" ? PREMADE_CONDITIONS : PREMADE_VALIDATORS;

export const findRule = (mode, key) =>
  getCatalog(mode).find((r) => r.key === key) || null;

/** Operator label for a `field-comparison` op key (used by config-view summaries). */
export const opLabel = (op) =>
  (COMPARE_OPS.find((o) => o.value === op) || {}).label || op || "equals";
