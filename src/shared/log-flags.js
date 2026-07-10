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

// Bounded, fixed flag vocabulary — ONLY flags that map to a truth the runtime
// reliably computes. `timedOut` and `capped` are intentionally absent: executors
// swallow their own pfDeadline before dispatch (timedOut would be dead), and every
// available `capped` signal is either dead (valueTruncated has no producer), reads
// the wrong object (stepResults), or false-fires on user-controlled api.log content
// — a flag that lies is worse than none. `transientError` already covers fail-open
// timeouts; `simulated` is authoritative from config.simulationMode.
export const FLAG_ENUM = ["simulated", "transientError"];
export const FLAG_LABEL = { simulated: "DRY-RUN", transientError: "FAIL-OPEN" };

// Render-time source fallback: a pre-feature entry has no `source`, but an async one
// self-identifies from its existing queueDelayMs; everything else is honestly runtime.
export const logSourceOf = (log) => {
  if (log && LOG_SOURCES.includes(log.source)) return log.source;
  if (log && log.queueDelayMs != null) return "async";
  return "runtime";
};

// Derive the honesty flags from signals ALREADY on the entry + this run's config.
// Pure + fail-safe. Only surfaces flags the runtime reliably computes (simulated,
// transientError) — never a guessed/spoofable signal.
export const deriveLogFlags = (entry, config) => {
  const flags = [];
  try {
    if (!entry || typeof entry !== "object") return [];
    if ((config && config.simulationMode === true) || entry.simulated === true) flags.push("simulated");
    if (entry.transientError === true) flags.push("transientError");
  } catch (e) { /* advisory — flags never break a log write */ }
  return flags.filter((f) => FLAG_ENUM.includes(f)).slice(0, 6);
};
