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
 * Both VALIDATORS (block a transition + show a message) and CONDITIONS (hide a
 * transition silently) run through CogniRunner's one backend `validate(args)`
 * function, branching on `configuration.ruleKind === 'premade'`. Because that
 * function reads via REST on BOTH surfaces, we use the REST status name
 * (`status.statusCategory.key`) everywhere — Altomata's expression-vs-REST
 * `status.category` / `status.statusCategory` name-crossing does not apply here.
 *
 * Adding a rule type = one entry here + the matching branch in
 * src/premade-rules.js. The parity lint (test-harness/scripts/premade-parity.mjs)
 * asserts every `available` entry has an executor branch, and vice-versa.
 *
 * `availability`:
 *   'available'   — fully supported.
 *   'unavailable' — cannot be implemented as a backend condition FUNCTION because
 *                   Forge does not pass the acting user to app validators/
 *                   conditions (only Jira's native expression-based conditions get
 *                   the `user` binding). The form shows these greyed with
 *                   `unavailableReason`, pointing at Jira's native built-ins.
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

export const PREMADE_CONDITIONS = [
  {
    key: "field-has-value",
    label: "Field has a value",
    help: "Only show this transition when the chosen field is set.",
    params: { field: true },
    availability: "available",
  },
  {
    key: "field-equals",
    label: "Field equals a value",
    help: "Only show this transition when a single-value field equals a value (case-insensitive).",
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
    help: "Only show this transition when the chosen field has no value (the inverse of “Field has a value”).",
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
  // --- Acting-user conditions. The acting user's accountId IS present in the rule
  //     payload (args.user.accountId — confirmed live), so these are supported.
  //     NOTE: app conditions are evaluated by Jira in the UI, not on the REST
  //     transition-listing path, so their effect is UI-only (same as every other
  //     CogniRunner condition). ---
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
