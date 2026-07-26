/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Classify a discovered rule into an effective type and decide HOW to exercise
// it (in-place on its real transition, replay onto a COGTEST self-loop, or — for
// conditions, which never fire on the REST transition path (F3) — mirror as a
// temporary validator). Type routing mirrors src/index.js (config.type is the
// source of truth; module ARI is the fallback). Shape validation mirrors
// audit-rules.mjs validateConfig.

// All post-function config.type values the backend routes on.
const PF_TYPES = {
  "postfunction-static": "static",
  "postfunction-semantic": "semantic",
  "postfunction-comment": "comment",
  "postfunction-subtask": "subtask",
  "postfunction-link": "link",
  "postfunction-generate-doc": "generate-doc",
  "postfunction-research": "research",
  "postfunction-research-doc": "research-doc",
};

// Effective types grouped by how they are observed when fired.
export const OBSERVE = {
  validator: "verdict", // block/allow on the transition
  condition: "verdict", // (mirrored as a validator to observe)
  static: "mutation",
  semantic: "mutation",
  comment: "comment",
  subtask: "subtask",
  link: "link",
  "generate-doc": "attachment",
  research: "field-or-attachment",
  "research-doc": "attachment",
};

/**
 * classifyRule(record) -> { effectiveType, observe, wellFormed, reason }
 * record is a discovery record from lib/discover.mjs (has slot, ruleKey, config).
 */
export function classifyRule(record) {
  const cfg = record.config || {};
  const rk = record.ruleKey || "";

  let effectiveType;
  if (rk === "forge:expression-validator") effectiveType = "validator";
  else if (rk === "forge:expression-condition") effectiveType = "condition";
  else {
    // post-function family — route on config.type, fall back to module ARI hint
    const t = cfg.type || "";
    effectiveType = PF_TYPES[t];
    if (!effectiveType) {
      const ari = String(record.parametersKey || "").toLowerCase();
      if (ari.includes("static")) effectiveType = "static";
      else effectiveType = "semantic"; // semantic module ARI carries every other flavor
    }
  }

  const { wellFormed, reason } = validateShape(effectiveType, cfg, record);
  return { effectiveType, observe: OBSERVE[effectiveType] || "unknown", wellFormed, reason };
}

function validateShape(effectiveType, cfg, record) {
  if (record.configError) return { wellFormed: false, reason: `config not valid JSON: ${record.configError}` };
  if (effectiveType === "validator" || effectiveType === "condition") {
    if (!cfg.fieldId) return { wellFormed: false, reason: "missing fieldId" };
    if (!cfg.prompt) return { wellFormed: false, reason: "missing prompt" };
    return { wellFormed: true, reason: "" };
  }
  if (effectiveType === "static") {
    const fns = cfg.functions || [];
    if (cfg.codeRef && !fns.length) return { wellFormed: true, reason: "code offloaded (codeRef)" };
    if (!fns.length) return { wellFormed: false, reason: "static has no functions" };
    if (fns.some((f) => !f.code || !String(f.code).trim())) return { wellFormed: false, reason: "static has an empty code step" };
    return { wellFormed: true, reason: "" };
  }
  if (effectiveType === "semantic") {
    if (!cfg.actionFieldId || !cfg.actionPrompt) return { wellFormed: false, reason: "semantic missing actionPrompt/actionFieldId" };
    return { wellFormed: true, reason: "" };
  }
  if (effectiveType === "comment") {
    if (!cfg.commentPrompt) return { wellFormed: false, reason: "comment missing commentPrompt" };
    return { wellFormed: true, reason: "" };
  }
  if (effectiveType === "subtask") {
    if (!cfg.subtaskPrompt) return { wellFormed: false, reason: "subtask missing subtaskPrompt" };
    return { wellFormed: true, reason: "" };
  }
  if (effectiveType === "link") {
    return { wellFormed: true, reason: "" }; // linkTypeName optional (defaults exist)
  }
  if (effectiveType === "generate-doc") {
    if (!cfg.contentPrompt) return { wellFormed: false, reason: "generate-doc missing contentPrompt" };
    return { wellFormed: true, reason: "" };
  }
  if (effectiveType === "research" || effectiveType === "research-doc") {
    if (!cfg.researchQuery) return { wellFormed: false, reason: "research missing researchQuery" };
    return { wellFormed: true, reason: "" };
  }
  return { wellFormed: true, reason: "" };
}

/**
 * decideLane(record, classified, projectIndex) -> { lane, reason, projects }
 *   lane: "in-place" | "replay" | "condition-mirror"
 * Conditions always mirror (F3). Everything else prefers in-place when the
 * workflow maps to ≥1 classic project; otherwise replay onto the testbed.
 * GLOBAL transitions are trivially reachable; DIRECTED reachability is attempted
 * at exercise time and may downgrade to replay there.
 */
export function decideLane(record, classified, projectIndex) {
  if (classified.effectiveType === "condition") {
    return { lane: "condition-mirror", reason: "conditions never fire on the REST transition path (F3)", projects: [] };
  }
  const projects = (projectIndex && projectIndex.get && projectIndex.get(record.workflowName)) || [];
  if (!projects.length) {
    return { lane: "replay", reason: "no classic project uses this workflow (team-managed/orphaned)", projects: [] };
  }
  if (!classified.wellFormed) {
    // Still try in-place — a malformed rule should still get an execution attempt
    // so it is not silently uncovered; the result will explain the failure.
    return { lane: "in-place", reason: `malformed (${classified.reason}) — best-effort in-place`, projects };
  }
  const global = record.transitionType === "GLOBAL" || record.transitionType === "GLOBAL_LOOP";
  return {
    lane: "in-place",
    reason: global ? "GLOBAL transition (fires from any status)" : "DIRECTED — will attempt from-status reachability, fall back to replay",
    projects,
  };
}
