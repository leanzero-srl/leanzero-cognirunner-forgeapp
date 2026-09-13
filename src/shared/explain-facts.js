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

import {
  findRule, opLabel, prMatchWords, gitSubEnabled, hasGitGroup,
  getCoderPfMode, CODER_PF_INSTRUCTIONS_MAX,
} from "./premade-rules-catalog.js";

// Human-readable label for a premade (non-AI) rule. Reads premadeRuleType (admin
// registry) OR ruleType (config-view saved config).
// The catalogue entry behind a saved premade config, or null. ONE lookup, shared by
// the label and the git-group rows below — the key can arrive under either name.
// All THREE halves of the catalogue are searched: the premade POST-FUNCTIONS (the Coder,
// 1.4 commit 12) are premade rows too, and a lookup that skipped them would render a saved
// Coder rule as a bare key with none of its params (F-388).
const premadeRuleDef = (config) => {
  const key = config?.premadeRuleType || config?.ruleType;
  return findRule("validator", key) || findRule("condition", key) || findRule("postfunction", key) || null;
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
/* F-379 — the prMatch words come from the CATALOG, which is also where the picker's
   labels and hints live. There used to be a copy here that told the truth and a copy in
   PremadeRuleForm.jsx that did not; one rule, one home. */

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
const gitSummaryRows = (config, connections, params) => {
  const rows = [];
  const id = config.connectionId;
  if (id) {
    const match = (Array.isArray(connections) ? connections : []).find((c) => c && c.id === id);
    rows.push(match && match.label
      ? { label: "Connection:", value: match.label }
      : { label: "Connection:", value: `${id} (connection id)`, code: true });
  }
  if (config.repo) rows.push({ label: "Repository:", value: config.repo, code: true });
  // Only the sub-controls this rule HAS (gitSubEnabled is the one home for that question).
  // A "Match pull request by" line on a Coder rule would describe a key nothing reads.
  if (gitSubEnabled(params, "prMatch")) rows.push({ label: "Match pull request by:", value: prMatchWords(config.prMatch) });
  if (gitSubEnabled(params, "strict")) rows.push({ label: "Strict:", value: strictWords(config.strict === true) });
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
  // `mode` is a key TWO param groups write: the dateRel one (future/within) and the
  // Coder's. The catalogue entry decides which it is; without that check a Coder rule
  // rendered as "When: in the future", which is a sentence about a rule that does not exist.
  const defForMode = premadeRuleDef(config);
  const isCoderMode = !!(defForMode && defForMode.params && defForMode.params.coderMode);
  if (config.mode && !isCoderMode) rows.push({ label: "When:", value: config.mode === "within" ? `within ${config.days} day(s)` : "in the future" });
  if (isCoderMode) {
    // The mode's LABEL, never its id: the id is the executor's vocabulary and means
    // nothing to a reader. An unknown id is named as unset, because that is what the
    // executor does with it (an ERROR on every transition, in both strict columns).
    const coderRow = getCoderPfMode(config.mode);
    rows.push({ label: "What the Coder does:", value: coderRow ? coderRow.label : "not set — this rule fails on every transition" });
  }
  for (const k of ["issueTypeName", "statusName", "resolutionName", "linkTypeName", "priorityName"]) {
    if (config[k]) rows.push({ label: "Value:", value: config[k] });
  }
  // The catalogue is the authority on whether this rule HAS a git group; the stored keys
  // are the fallback for a config whose rule key the catalogue no longer knows (an
  // export from a newer build), so a git rule never renders bare.
  const def = premadeRuleDef(config);
  // `params.git` has two legal shapes (true, or an object switching sub-controls off), so
  // hasGitGroup asks the question and gitSubEnabled decides which rows follow. Reading it
  // with `=== true` drew the whole group for an object form and none of it for a Coder rule.
  const isGit = (def && hasGitGroup(def.params))
    || (!def && (config.connectionId != null || config.repo != null));
  // A config the catalogue no longer knows keeps its old behaviour: both sub-rows, because
  // there is nothing left to say which ones it had.
  if (isGit) rows.push(...gitSummaryRows(config, connections, def ? def.params : { git: true }));
  // The admin's own note. UNTRUSTED — clamped to the SAME cap the form and the prompt
  // renderer use, and rendered as TEXT by every caller (the summary card escapes it, and
  // the explain prompt defangs + fences it at the backend seam).
  if (isCoderMode && typeof config.instructions === "string" && config.instructions.trim()) {
    rows.push({ label: "Extra instructions:", value: config.instructions.trim().slice(0, CODER_PF_INSTRUCTIONS_MAX) });
  }
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
