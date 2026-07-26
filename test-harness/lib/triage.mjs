/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// System-vs-model triage. The whole point of running under a deliberately weak
// LM Studio model is to surface SYSTEM weaknesses (bad JSON parsing, tool-call
// shape, missing server-side clamps, fence leaks, transient mishandling) — NOT to
// penalize the model for being dumb. Only Bucket A drives src/index.js hardening.
//
//   A = SYSTEM BUG (drives hardening)   — first-match-wins ordered signals
//   B = MODEL CAPABILITY (no hardening) — well-formed but weak/wrong
//   C = EXPECTED / ENVIRONMENTAL        — known platform behavior, subtract from to-fix
//
// triageCase(c) takes a normalized case result and returns
//   { bucket, signal, hardeningTarget, note }
// or null when the case PASSED (nothing to triage).

// App-emitted parse/shape error strings leak into errorMessages/reason when the
// backend's parser or tool-call handler can't cope with the model's output.
const RE_PARSE = /malformed json|returned malformed|not valid json|after \d+ round|start_object|start_array|cannot deserialize|unexpected token|json ?parse|failed to parse|jsonparse|expected.*token/i;
const RE_TOOLSHAPE = /tool.?call|tool ?arguments|function\.arguments|tool_use|invalid tool|tool result/i;
const RE_TRANSIENT = /temporarily unavailable|rate ?limit|too many requests|429|timdevice|timed out|timeout|service (is )?(unavailable|down)|ai service error|503|502|upstream/i;
const RE_EMPTY = /empty response from ai|no response from (the )?ai|empty ai response/i;
const RE_FENCE = /```|<<<|source_field|field_value|system_prompt|<\|.*\|>|"isvalid"\s*:/i;
// Jira's generic message when a Forge validate()/condition function THROWS or runs
// past the platform limit without returning a graceful verdict — a system bug, not
// a verdict. (Found by the weak-model run: number-field + agentic validators.)
const RE_VALIDATOR_CRASH = /error in (validator|condition)|bug in the app that provided|workflow (validator|condition).*(failed|error)/i;

// signal -> the src/index.js function(s) a fix would most likely touch.
export const HARDENING_TARGETS = {
  http5xx: "trace via forge logs — usually an unguarded resolver/executor path",
  parseLeak: "parseAIJson / repairTruncatedJson (src/index.js ~597/631) + per-callsite extraction in callOpenAI/agentic",
  toolShape: "tool-arg parsing: callForgeLlmChat/callAnthropicChat/callBedrockChat + agentic JSON.parse(toolCall.function.arguments)",
  outOfSchema: "validateValueAgainstField / prepareSemanticValue (src/index.js ~9840/9960)",
  fenceLeak: "output-side defang on written values + buildSemanticAIRequest (defangFence currently guards inputs only)",
  emptyEcho: "callLmStudioNative extraction fallbacks (src/index.js ~7037/7347) — empty-after-fallback must fail-open transient, not block",
  transientMishandled: "isTransientAIError (src/index.js ~245) + fail-open branches in callOpenAI/agentic",
  validatorCrash: "validate() top-level try/catch + agentic loop time-bounding — must always return a graceful {result, errorMessage}, never throw/time out to Jira",
};

/**
 * @param {object} c normalized case:
 *   { type, http, reason, writtenValue, cogniDebug, grade ('PASS'|'SOFT'|'HARD'),
 *     gradeAxes (optional {schemaViolation, reasonAxis, valueAxis}),
 *     expectedMiss (optional {fId, note}), rawAttemptedJson (optional bool) }
 * @returns {null | {bucket, signal, hardeningTarget, note}}
 */
export function triageCase(c) {
  if (!c || c.grade === "PASS") return null;

  const reason = String(c.reason || "");
  const lc = reason.toLowerCase();
  const dbg = c.cogniDebug || {};
  const transientFlag = dbg.transientError === true;
  const toolMeta = dbg.toolMeta || null;
  const written = c.writtenValue == null ? "" : (typeof c.writtenValue === "string" ? c.writtenValue : JSON.stringify(c.writtenValue));

  // ---- Bucket C: expected / environmental (checked first so they never count as bugs) ----
  if (c.expectedMiss) {
    return { bucket: "C", signal: c.expectedMiss.fId || "expected", hardeningTarget: null, note: c.expectedMiss.note || "known expected miss" };
  }

  // ---- Bucket A: system bug (first match wins) ----
  if (typeof c.http === "number" && c.http >= 500) {
    return mk("A", "http5xx", `transition POST returned HTTP ${c.http}`);
  }
  if (RE_VALIDATOR_CRASH.test(lc)) {
    return mk("A", "validatorCrash", `validate()/condition threw or timed out ungracefully (Jira reported a validator error): "${snippet(reason)}"`);
  }
  if (RE_PARSE.test(lc)) {
    return mk("A", "parseLeak", `parse/deserialize error surfaced in verdict: "${snippet(reason)}"`);
  }
  if (written && RE_FENCE.test(written)) {
    return mk("A", "fenceLeak", `fence/control marker leaked into a stored value: "${snippet(written)}"`);
  }
  if (c.gradeAxes?.schemaViolation) {
    return mk("A", "outOfSchema", `out-of-schema value persisted: "${snippet(written)}"`);
  }
  if (toolMeta && (RE_TOOLSHAPE.test(String(toolMeta.skippedReason || "")) || (RE_PARSE.test(lc) && (toolMeta.toolRounds || 0) >= 1))) {
    return mk("A", "toolShape", `agentic tool-call shape issue (skippedReason=${toolMeta.skippedReason || "?"}, rounds=${toolMeta.toolRounds || 0})`);
  }
  if (RE_EMPTY.test(lc) && !transientFlag) {
    return mk("A", "emptyEcho", `non-transient empty AI response surfaced as a verdict`);
  }
  if (RE_TRANSIENT.test(lc) && !transientFlag && c.http >= 400) {
    return mk("A", "transientMishandled", `transient-flavored failure hard-blocked without transientError flag: "${snippet(reason)}"`);
  }

  // ---- Bucket B: model capability (no A-signal fired) ----
  if (toolMeta && /non-tool|no.?tool|lmstudio-non-tool/i.test(String(toolMeta.skippedReason || ""))) {
    return { bucket: "B", signal: "capabilityGate", hardeningTarget: null, note: `documented model limit: ${toolMeta.skippedReason}` };
  }
  if (c.gradeAxes?.reasonAxis === "SOFT") {
    return { bucket: "B", signal: "reasonNoCite", hardeningTarget: null, note: "coherent reason but missing/weak criterion citation" };
  }
  if (c.gradeAxes?.valueAxis === "SOFT") {
    return { bucket: "B", signal: "valueImperfect", hardeningTarget: null, note: "in-schema but imperfect value" };
  }
  if (c.gradeAxes?.modelSlow) {
    return { bucket: "B", signal: "modelSlow", hardeningTarget: null, note: "near-cap timeout, fail-closed on bad content" };
  }
  return { bucket: "B", signal: "wellFormedWrong", hardeningTarget: null, note: "well-formed output, wrong direction/value" };
}

function mk(bucket, signal, note) {
  return { bucket, signal, hardeningTarget: HARDENING_TARGETS[signal] || null, note };
}
function snippet(s) {
  return String(s).replace(/\s+/g, " ").slice(0, 120);
}

/**
 * Aggregate-pass escalation: a single weak-model "pure prose, no JSON" answer is a
 * model miss, but the SAME parse-ish symptom recurring across many DISTINCT rules
 * is a systemic extraction gap. Promote recurring Bucket-B 'wellFormedWrong' with
 * parse-flavored reasons to Bucket A when they span >= minDistinctRules rules.
 * Mutates the triaged results in place and returns the count promoted.
 */
export function escalateRecurring(results, minDistinctRules = 3) {
  const bySignalRules = {};
  for (const r of results) {
    const t = r.triage;
    if (!t || t.bucket !== "B") continue;
    if (!RE_PARSE.test(String(r.reason || "").toLowerCase())) continue;
    (bySignalRules.parseLeak ||= new Set()).add(r.ruleKey || r.ruleId || r.issueKey);
  }
  const distinct = bySignalRules.parseLeak ? bySignalRules.parseLeak.size : 0;
  if (distinct < minDistinctRules) return 0;
  let promoted = 0;
  for (const r of results) {
    if (r.triage?.bucket === "B" && RE_PARSE.test(String(r.reason || "").toLowerCase())) {
      r.triage = mk("A", "parseLeak", `recurring parse-flavored failure across ${distinct} distinct rules (escalated): "${snippet(r.reason)}"`);
      promoted++;
    }
  }
  return promoted;
}
