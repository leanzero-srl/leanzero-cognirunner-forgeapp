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
// The catalogue entry behind a saved premade config, or null. ONE lookup, shared by
// the label and the git-group rows below — the key can arrive under either name.
const premadeRuleDef = (config) => {
  const key = config?.premadeRuleType || config?.ruleType;
  return findRule("validator", key) || findRule("condition", key) || null;
};

export const premadeRuleLabel = (config) => {
  const key = config?.premadeRuleType || config?.ruleType;
  return (premadeRuleDef(config) || {}).label || key;
};

/*
 * F-372 — the GIT parameter group, in words.
 *
 * A saved git rule stores FOUR keys (connectionId / repo / prMatch / strict — the
 * vocabulary is documented beside `git: true` in premade-rules-catalog.js) and NONE of
 * them used to reach the summary card or the explain prompt, so a "Git: the pull request
 * is merged" rule rendered as a single line and a reviewer could not see which repository
 * it gated or whether a provider outage would block their transition.
 *
 * The strict sentences below MUST keep saying what the fail-open/fail-closed table beside
 * `runGitValidator` in src/premade-rules.js does. If that table changes, these change in
 * the same commit (LAW 3: the policy is written down next to the code, and this is the
 * copy a human actually reads).
 */
const PR_MATCH_WORDS = {
  branch: "the pull request's source branch name only",
  property: "the source branch name or the pull request title",
  both: "the source branch name or the pull request title",
};
const prMatchWords = (prMatch) => PR_MATCH_WORDS[String(prMatch || "both")] || PR_MATCH_WORDS.both;

// Deliberately spells out BOTH halves: what strict changes, and what it does not.
// A misconfigured connection or repository fails CLOSED whatever strict says.
const strictWords = (strict) => (strict === true
  ? "On — a provider outage, a dead token, an unreadable answer or no pull request found BLOCKS the transition."
  : "Off — a provider outage, a dead token, an unreadable answer or no pull request found ALLOWS the transition (fail-open). A deleted connection or a repository the connection may not read always blocks.");

/*
 * `connections` is optional: the summary is rendered in places that have the editor's
 * connection list and places that have nothing. With a list we show the human name; with
 * none we show the stored id and SAY it is an id, rather than printing "gc_7" as if it
 * were a name. Never invents a label for an id the list does not contain — an id that
 * names no connection is exactly the misconfiguration that fails closed at run time.
 */
const gitSummaryRows = (config, connections) => {
  const rows = [];
  const id = config.connectionId;
  if (id) {
    const match = (Array.isArray(connections) ? connections : []).find((c) => c && c.id === id);
    rows.push(match && match.label
      ? { label: "Connection:", value: match.label }
      : { label: "Connection:", value: `${id} (connection id)`, code: true });
  }
  if (config.repo) rows.push({ label: "Repository:", value: config.repo, code: true });
  rows.push({ label: "Match pull request by:", value: prMatchWords(config.prMatch) });
  rows.push({ label: "Strict:", value: strictWords(config.strict === true) });
  return rows;
};

export const premadeSummaryRows = (config, connections) => {
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
  // The catalogue is the authority on whether this rule HAS a git group; the stored keys
  // are the fallback for a config whose rule key the catalogue no longer knows (an
  // export from a newer build), so a git rule never renders bare.
  const def = premadeRuleDef(config);
  const isGit = (def && def.params && def.params.git === true)
    || (!def && (config.connectionId != null || config.repo != null));
  if (isGit) rows.push(...gitSummaryRows(config, connections));
  if (config.errorMessage) rows.push({ label: "Message:", value: config.errorMessage });
  return rows;
};

// Compact rule facts for the "Explain this rule" assist — the SAME data the summary
// shows (no hidden fields). For static PFs only step NAMES exist post-offload
// (functionsMeta); the backend prompt restates them without inferring code. Lengths
// are bounded here and again (+ defanged) server-side.
export const buildFactsText = (config, staticSteps, connections) => {
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
    // Same rows as the card, git group included (F-372) — "no hidden fields" has to
    // stay true in the direction that matters: nothing on the card missing from here.
    premadeSummaryRows(config, connections).forEach((r) => push(r.label.replace(/:$/, ""), r.value));
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
