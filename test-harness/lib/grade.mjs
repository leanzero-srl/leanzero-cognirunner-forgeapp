/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Graded scoring: replace the binary `correct` with PASS / SOFT-FAIL / HARD-FAIL.
// SOFT-FAIL absorbs weak-model roughness (coherent-but-rough reason, plausible-
// but-imperfect value) so it is NEVER conflated with a system bug. HARD-FAIL is a
// wrong verdict / wrong-or-out-of-schema write / deterministic-code mismatch — the
// things the hardening loop must explain. legacyCorrect mirrors the old binary so
// the 766–770/782 baseline + FINDINGS matrix keep computing.
//
// Deep-assertion metadata lives on the fixture rules (fixtures/rules.mjs):
//   reasonMustCite : [string|[string...]]   term groups the reason should cite
//   plausibleSet   : { plausible:[...], hard:[...] }  for closed-label semantic
//   expectRange    : [min, max]              for number semantic
//   expectExact    : value                   for deterministic static writes
//   overlapTokens  : [string...]             salient source tokens for free-text
//   valueOracle    : "schema" | "overlap" | "closed-label"

const WORST = { PASS: 0, SOFT: 1, HARD: 2 };
const NAME = ["PASS", "SOFT", "HARD"];
const worst = (...gs) => NAME[Math.max(...gs.map((g) => WORST[g] ?? 0))];

// ---- text utilities --------------------------------------------------------

function tokens(s) {
  return String(s || "").toLowerCase().match(/[a-z0-9]+/g) || [];
}
function jaccard(a, b) {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}
function citesAny(reason, groups) {
  const lc = String(reason || "").toLowerCase();
  for (const g of groups || []) {
    const terms = Array.isArray(g) ? g : [g];
    if (terms.some((t) => lc.includes(String(t).toLowerCase()))) return true;
  }
  return false;
}
function overlapCount(text, toks) {
  const set = new Set(tokens(text));
  return (toks || []).filter((t) => set.has(String(t).toLowerCase())).length;
}

const RE_TRANSIENT_REASON = /temporarily unavailable|fail-open|ai service error|malformed json|empty response|rate ?limit|timed out|timeout|service (unavailable|down)/i;

// ---- reason rubric (validators) -------------------------------------------

// Returns "PASS" | "SOFT" | "HARD" for the reason axis. expectReason=true when a
// reason is genuinely expected (a BLOCK). On ALLOW with no reason we skip (PASS).
export function gradeReason(reason, fieldValue, mustCite, expectReason) {
  const r = String(reason || "").trim();
  if (!expectReason && !r) return "PASS"; // allow with no error text is fine
  if (!r) return "HARD"; // a block with no reason at all = extraction gap
  if (RE_TRANSIENT_REASON.test(r)) return "HARD"; // fail-open/error artifact, not a real verdict
  const toks = tokens(r);
  if (r.length < 15 || toks.length < 3) return "HARD";
  if (fieldValue && jaccard(r, fieldValue) > 0.6) return "HARD"; // parroting the input
  if (mustCite && mustCite.length) return citesAny(r, mustCite) ? "PASS" : "SOFT";
  return "PASS";
}

// ---- public grading entrypoints -------------------------------------------

/**
 * gradeValidator(rule, obs)
 *  obs: { actual, expected, reason, fieldValue, cogniDebug }
 *  -> { grade, axes:{direction,reason,tool}, legacyCorrect }
 */
export function gradeValidator(rule, obs) {
  const directionOK = obs.actual === obs.expected;
  const axes = { direction: directionOK ? "PASS" : "HARD" };
  let legacyCorrect = directionOK;

  // docs-injection rules: verdict must be right AND docs actually injected
  if (rule.checkDocsUsed) {
    const used = obs.cogniDebug?.docsUsed === true;
    axes.docs = used ? "PASS" : "HARD";
    legacyCorrect = legacyCorrect && used;
  }

  if (!directionOK) return { grade: "HARD", axes, legacyCorrect };

  const blocked = obs.actual === "BLOCKED";
  const reasonText = obs.reason || obs.cogniDebug?.reason || "";
  axes.reason = gradeReason(reasonText, obs.fieldValue, rule.reasonMustCite, blocked);

  if (rule.config?.enableTools) {
    const tm = obs.cogniDebug?.toolMeta;
    axes.tool = tm && tm.toolsUsed && (tm.toolRounds || 0) >= 1 && (tm.queries || []).length >= 1 ? "PASS" : "SOFT";
  }

  return { grade: worst(axes.reason, axes.tool || "PASS", axes.docs || "PASS"), axes, legacyCorrect };
}

/**
 * gradeSemantic(rule, obs)
 *  obs: { mutated, writtenName (option/value), writtenText (free-text), writtenNumber,
 *         allowedValues, sourceText, legacyPass }
 *  -> { grade, axes:{value}, schemaViolation, legacyCorrect }
 */
export function gradeSemantic(rule, obs) {
  const axes = {};
  const legacyCorrect = !!obs.legacyPass;

  // SKIP/SAFE rules: success == unchanged (handled by legacy assert). A SAFE-rule
  // failure means an out-of-allowed-set option WAS persisted → a server-side clamp
  // gap (Bucket-A schema violation), not model roughness.
  if (rule.expectPf === "SKIPPED" || rule.expectPf === "SAFE" || rule.expectPf === "SECURE") {
    const g = legacyCorrect ? "PASS" : "HARD";
    return { grade: g, axes: { value: g }, schemaViolation: rule.expectPf === "SAFE" && !legacyCorrect, legacyCorrect };
  }
  if (rule.expectPf === "TOLERANT") {
    return { grade: "PASS", axes: { value: "PASS" }, schemaViolation: false, legacyCorrect: true };
  }

  if (!obs.mutated) {
    return { grade: "HARD", axes: { value: "HARD" }, schemaViolation: false, legacyCorrect };
  }

  const oracle = rule.valueOracle;
  if (oracle === "closed-label" && rule.plausibleSet) {
    const name = obs.writtenName;
    const inAllowed = !obs.allowedValues || obs.allowedValues.includes(name);
    if (!inAllowed) { axes.value = "HARD"; return { grade: "HARD", axes, schemaViolation: true, legacyCorrect }; }
    if ((rule.plausibleSet.hard || []).includes(name)) { axes.value = "HARD"; return { grade: "HARD", axes, schemaViolation: false, legacyCorrect }; }
    axes.value = (rule.plausibleSet.plausible || []).includes(name) ? "PASS" : "SOFT";
    return { grade: axes.value, axes, schemaViolation: false, legacyCorrect };
  }

  if (oracle === "schema" || rule.expectRange) {
    if (rule.expectRange && typeof obs.writtenNumber === "number") {
      const [min, max] = rule.expectRange;
      if (obs.writtenNumber < min || obs.writtenNumber > max) {
        axes.value = "HARD";
        return { grade: "HARD", axes, schemaViolation: true, legacyCorrect };
      }
    }
    if (obs.allowedValues && obs.writtenName && !obs.allowedValues.includes(obs.writtenName)) {
      axes.value = "HARD";
      return { grade: "HARD", axes, schemaViolation: true, legacyCorrect };
    }
    axes.value = "PASS";
    return { grade: "PASS", axes, schemaViolation: false, legacyCorrect };
  }

  // free-text overlap
  if (oracle === "overlap" || rule.overlapTokens) {
    const text = obs.writtenText || "";
    if (!text.trim()) { axes.value = "HARD"; return { grade: "HARD", axes, schemaViolation: false, legacyCorrect }; }
    const k = overlapCount(text, rule.overlapTokens || []);
    const need = Math.max(1, Math.ceil((rule.overlapTokens || []).length / 3));
    axes.value = k >= need ? "PASS" : (text.length > 40 ? "SOFT" : "HARD");
    return { grade: axes.value, axes, schemaViolation: false, legacyCorrect };
  }

  // no oracle declared — fall back to legacy pass
  axes.value = legacyCorrect ? "PASS" : "HARD";
  return { grade: axes.value, axes, schemaViolation: false, legacyCorrect };
}

/**
 * gradeStatic(rule, obs)
 *  obs: { writtenValue, legacyPass } — deterministic code, so a mismatch is a HARD
 *  system bug (never model roughness).
 */
export function gradeStatic(rule, obs) {
  const legacyCorrect = !!obs.legacyPass;
  if (rule.expectPf === "SKIPPED" || rule.expectPf === "SECURE") {
    return { grade: legacyCorrect ? "PASS" : "HARD", axes: { value: legacyCorrect ? "PASS" : "HARD" }, schemaViolation: false, legacyCorrect };
  }
  if (rule.expectExact !== undefined) {
    const got = obs.writtenValue;
    const ok = String(got) === String(rule.expectExact);
    return { grade: ok ? "PASS" : "HARD", axes: { value: ok ? "PASS" : "HARD" }, schemaViolation: !ok, legacyCorrect };
  }
  return { grade: legacyCorrect ? "PASS" : "HARD", axes: { value: legacyCorrect ? "PASS" : "HARD" }, schemaViolation: false, legacyCorrect };
}

export { worst, jaccard, citesAny, overlapCount, tokens };
