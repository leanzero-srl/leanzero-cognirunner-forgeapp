/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/*
 * Execution-log SOURCE + honesty FLAGS — pure, dependency-free. Shared by the
 * backend (deriveLogFlags at the log-write path) and both log renderers (admin
 * App.js renderLogEntry, config-view App.js) so the chip vocabulary + the
 * pre-feature fallback live in ONE place.
 *
 * These SURFACE truths the runtime already computes — they never invent a signal.
 */

// Bounded source enum. runtime = an inline Jira transition (validators, conditions,
// inline PFs — and REST-harness activity, which IS real runtime). async = the
// background consumer (queued PF / LM Studio route). test is reserved for design-time
// dry-runs (not currently persisted — see the deferred test-resolver persistence).
export const LOG_SOURCES = ["runtime", "async", "test"];
export const SOURCE_LABEL = { runtime: "LIVE", async: "QUEUED", test: "TEST" };

// Bounded, fixed flag vocabulary. timedOut is intentionally absent from v1 (executors
// swallow their own pfDeadline before dispatch, so it would be a dead flag without
// per-executor tagging; transientError already covers validator fail-open timeouts).
export const FLAG_ENUM = ["simulated", "transientError", "capped"];
export const FLAG_LABEL = { simulated: "DRY-RUN", transientError: "FAIL-OPEN", capped: "CAPPED" };

// Render-time source fallback: a pre-feature entry has no `source`, but an async one
// self-identifies from its existing queueDelayMs; everything else is honestly runtime.
export const logSourceOf = (log) => {
  if (log && LOG_SOURCES.includes(log.source)) return log.source;
  if (log && log.queueDelayMs != null) return "async";
  return "runtime";
};

// Derive the honesty flags from signals ALREADY on the entry + this run's config.
// Pure + fail-safe. capped is derived ONLY from genuine runtime caps — the api.log
// volume-cap sentinel in the trace, a step result too large to chain (__truncated),
// or an executor's own valueTruncated boolean — NEVER the 500-char display clip on
// updatedValue/attemptedValue (that "…" is cosmetic, not a real cap).
export const deriveLogFlags = (entry, config) => {
  const flags = [];
  try {
    if (!entry || typeof entry !== "object") return [];
    if ((config && config.simulationMode === true) || entry.simulated === true) flags.push("simulated");
    if (entry.transientError === true) flags.push("transientError");
    const trace = Array.isArray(entry.trace) ? entry.trace : [];
    const steps = Array.isArray(entry.stepResults) ? entry.stepResults : [];
    const capped = entry.valueTruncated === true
      || trace.some((l) => typeof l === "string" && l.includes("output capped"))
      || steps.some((s) => s && s.__truncated === true);
    if (capped) flags.push("capped");
  } catch (e) { /* advisory — flags never break a log write */ }
  return flags.filter((f) => FLAG_ENUM.includes(f)).slice(0, 6);
};
