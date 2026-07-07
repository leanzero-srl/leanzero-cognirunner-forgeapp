/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Offline unit test for src/shared/log-flags.js — the pure source/flag derivation.
// Encodes the CORRECTED capped semantics (the design critique caught a false-firing
// capped derived from the 500-char display clip). Run: node log-flags.test.mjs
import { deriveLogFlags, logSourceOf, FLAG_ENUM } from "../../src/shared/log-flags.js";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- simulated ---
ok(eq(deriveLogFlags({ simulated: true }, null), ["simulated"]), "entry.simulated → simulated");
ok(eq(deriveLogFlags({}, { simulationMode: true }), ["simulated"]), "config.simulationMode → simulated");
ok(eq(deriveLogFlags({}, { simulationMode: false }), []), "simulationMode false → no flag");

// --- transientError (already persisted) ---
ok(eq(deriveLogFlags({ transientError: true }, null), ["transientError"]), "transientError → flag");

// --- capped: ONLY genuine runtime caps ---
ok(eq(deriveLogFlags({ trace: ["step 1 ok", "[api.log output capped at 5000 entries]"] }, null), ["capped"]), "trace 'output capped' sentinel → capped");
ok(eq(deriveLogFlags({ stepResults: [{ __truncated: true }] }, null), ["capped"]), "step __truncated → capped");
ok(eq(deriveLogFlags({ valueTruncated: true }, null), ["capped"]), "executor valueTruncated → capped");
// The critique's BLOCKER: the 500-char DISPLAY clip must NOT read as a runtime cap.
ok(eq(deriveLogFlags({ updatedValue: "a very long ADF value that got display-clipped…" }, null), []), "updatedValue ending in … is NOT capped (display clip)");
ok(eq(deriveLogFlags({ attemptedValue: "x…" }, null), []), "attemptedValue ending in … is NOT capped");

// --- empty / combined / bounds ---
ok(eq(deriveLogFlags({}, null), []), "empty entry → no flags");
ok(eq(deriveLogFlags({ simulated: true, transientError: true, valueTruncated: true }, null), ["simulated", "transientError", "capped"]), "all three combine in order");
ok(deriveLogFlags(null, null).length === 0, "null entry → [] (fail-safe)");
ok(deriveLogFlags({ simulated: true }, null).every((f) => FLAG_ENUM.includes(f)), "only enum flags emitted");

// --- logSourceOf: render-time fallback ---
ok(logSourceOf({ source: "async" }) === "async", "explicit source async");
ok(logSourceOf({ source: "runtime" }) === "runtime", "explicit source runtime");
ok(logSourceOf({ source: "test" }) === "test", "explicit source test");
ok(logSourceOf({ queueDelayMs: 4200 }) === "async", "pre-feature entry with queueDelayMs → async");
ok(logSourceOf({ queueDelayMs: 0 }) === "async", "queueDelayMs 0 (present) → async");
ok(logSourceOf({}) === "runtime", "pre-feature entry, nothing → runtime");
ok(logSourceOf({ source: "garbage" }) === "runtime", "unknown source → runtime fallback");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
