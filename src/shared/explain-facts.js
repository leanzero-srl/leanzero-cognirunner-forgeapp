/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * FRONTEND-ONLY shared helpers for the "Explain this rule" assist. Imported by
 * config-view (single-rule view) AND admin-panel (per-rule in the Rules table) via
 * the ../../../src/shared relative path both apps already use for
 * premade-rules-catalog.js. The BACKEND does not import this — it receives the
 * built factsText as an explainRule payload and never calls these functions.
 * Dependency-free except the dependency-free premade catalog below.
 *
 * Two shapes feed these: config-view's saved config (config.ruleType, detail fields,
 * type derived from extension.type) and the admin REGISTRY row (config.premadeRuleType,
 * explicit config.type incl. "condition"/"validator", functionsMeta name-only, no
 * detail fields, no enableTools). Handled by (a) premade key = premadeRuleType||ruleType
 * and (b) the agentic line only when enableTools is a defined boolean.
 */

import { findRule, opLabel } from "./premade-rules-catalog.js";

// Human-readable label for a premade (non-AI) rule. Reads premadeRuleType (admin
// registry) OR ruleType (config-view saved config).
export const premadeRuleLabel = (config) => {
  const key = config?.premadeRuleType || config?.ruleType;
  return (findRule("validator", key) || findRule("condition", key) || {}).label || key;
};

export const premadeSummaryRows = (config) => {
  const rows = [{ label: "Premade rule:", value: premadeRuleLabel(config) }];
  if (config.fieldId) rows.push({ label: "Field:", value: config.fieldId, code: true });
  if (config.op) rows.push({ label: "Condition:", value: `${opLabel(config.op)} “${config.compareValue ?? ""}”` });
  if (config.regex) rows.push({ label: "Pattern:", value: config.regex, code: true });
  if (config.allowedValues) rows.push({ label: "Allowed:", value: config.allowedValues });
  if (config.value != null && config.value !== "") rows.push({ label: "Equals:", value: String(config.value) });
  if (config.min != null) rows.push({ label: "Min:", value: String(config.min) });
  if (config.max != null) rows.push({ label: "Max:", value: String(config.max) });
  if (config.mode) rows.push({ label: "When:", value: config.mode === "within" ? `within ${config.days} day(s)` : "in the future" });
  for (const k of ["issueTypeName", "statusName", "resolutionName", "linkTypeName", "priorityName"]) {
    if (config[k]) rows.push({ label: "Value:", value: config[k] });
  }
  if (config.errorMessage) rows.push({ label: "Message:", value: config.errorMessage });
  return rows;
};

// Compact rule facts for the "Explain this rule" assist — the SAME data the summary
// shows (no hidden fields). For static PFs only step NAMES exist post-offload
// (functionsMeta); the backend prompt restates them without inferring code. Lengths
// are bounded here and again (+ defanged) server-side.
export const buildFactsText = (config, staticSteps) => {
  if (!config) return "";
  const lines = [];
  const push = (label, value) => {
    if (value == null || value === "") return;
    lines.push(`${label}: ${String(value).slice(0, 220)}`);
  };
  if (config.type === "postfunction-semantic") {
    push("When", config.conditionPrompt);
    push("Action", config.actionPrompt);
    push("Target field", config.actionFieldId);
  } else if (config.type === "postfunction-static") {
    const steps = staticSteps || [];
    push("Steps", `${steps.length} automated step(s)`);
    steps.forEach((s, i) => push(`Step ${i + 1}`, s.name || s.operationPrompt || "(unnamed)"));
  } else if (config.ruleKind === "premade") {
    premadeSummaryRows(config).forEach((r) => push(r.label.replace(/:$/, ""), r.value));
  } else {
    push("Field", config.fieldId);
    push("Prompt", config.prompt);
    // Only when the tool-state is an EXPLICIT boolean — matches the summary card,
    // which shows no Tools row for auto mode (null) or legacy configs (undefined).
    // (The registry never stores enableTools either → correctly omitted there.)
    if (config.enableTools === true || config.enableTools === false) {
      push("Agentic JQL search", config.enableTools ? "enabled" : "disabled");
    }
  }
  return lines.join("\n").slice(0, 1500);
};

// The rule kind the explain prompt keys its behavior line on. ruleModule is the
// authoritative module signal (config-view: extension.type; admin: config.type).
// For premade, only asserts validator-vs-condition when that signal is present,
// else the soft "premade" kind (no confident BLOCK-vs-HIDE claim).
export const ruleKindEnum = (config, ruleModule, isCondition) => {
  if (config.type === "postfunction-semantic") return "semantic-pf";
  if (config.type === "postfunction-static") return "static-pf";
  if (config.ruleKind === "premade") {
    if (ruleModule === "condition") return "premade-condition";
    if (ruleModule === "validator") return "premade-validator";
    return "premade";
  }
  return isCondition ? "condition" : "validator";
};
