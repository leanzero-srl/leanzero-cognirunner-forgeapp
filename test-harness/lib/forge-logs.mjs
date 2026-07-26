/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Constant forge-logs review-and-fix support. `forge logs` returns a recent
// buffer (no native follow), so the monitor POLLS it, dedupes by exact line, and
// scans new lines for SYSTEM-bug signatures — making backend log evidence a
// first-class hardening driver alongside the black-box results, not just a
// correlator. Best-effort: a no-op when the forge CLI isn't present/logged-in.
//
// forge runs from the PROJECT ROOT (where manifest.yml lives), not test-harness.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { HARNESS_ROOT } from "./env.mjs";
import { HARDENING_TARGETS } from "./triage.mjs";

export const PROJECT_ROOT = resolve(HARNESS_ROOT, "..");

export function forgeAvailable() {
  try {
    const r = spawnSync("forge", ["--version"], { cwd: PROJECT_ROOT, encoding: "utf8", timeout: 20000 });
    return !r.error && r.status === 0;
  } catch { return false; }
}

export function pollForgeLogs(extraArgs = []) {
  try {
    const r = spawnSync("forge", ["logs", ...extraArgs], {
      cwd: PROJECT_ROOT, encoding: "utf8", timeout: 90000, maxBuffer: 32 * 1024 * 1024,
    });
    if (r.error) return { ok: false, error: r.error.message, lines: [] };
    const text = (r.stdout || "") + (r.stderr ? "\n" + r.stderr : "");
    return { ok: r.status === 0, lines: text.split(/\r?\n/).filter((l) => l.trim().length), raw: text };
  } catch (e) { return { ok: false, error: e.message, lines: [] }; }
}

// Log-line signatures → triage-style signal name (shared HARDENING_TARGETS map).
// Patterns are deliberately CONTEXTUAL (not bare numbers) so ISO-8601 millisecond
// timestamps (".526+0300"), UUIDs, and success lines don't trip false positives.
//
// Two skip-guards run FIRST (the weak-model run proved both are needed):
//  - INPUT_ECHO: the app logs untrusted field values / summaries for debugging;
//    those legitimately contain ``` / <<<… / the word "error" (it's the ATTACK
//    INPUT, defanged on use) — never a backend bug.
//  - EXPECTED: handled/graceful conditions (fail-open timeouts, the bounded static
//    step budget, MCP-gated skips) — working as designed, not bugs.
const INPUT_ECHO = /field value \(first \d+|field content:|text to validate|untrusted data|"summary"\s*:|"description"\s*:|"comment"\s*:|pf result:/i;
const EXPECTED = /transition allowed|gathering context|fail-open|step exceeded its \d+s|evaluation timed out after \d+s|requires (the )?(doc|web|mcp)|"success"\s*:\s*true/i;

const SIGNALS = [
  { re: /internal server error|unhandled (promise )?(rejection|exception)|uncaught (exception|error)|\b(Type|Reference|Range|Syntax)Error\b|cannot read propert|is not a function|is not defined|status(Code)?["' :=]{1,3}5\d\d|"status"\s*:\s*5\d\d/i, signal: "http5xx" },
  { re: /malformed json|not valid json|cannot deserialize|unexpected token|failed to parse|JSON\.parse|parse error|after \d+ round\(s\)/i, signal: "parseLeak" },
  { re: /function\.arguments|tool_use|invalid tool|malformed tool|tool[- ]call (error|fail|shape)/i, signal: "toolShape" },
  { re: /allowedvalues|out of (the )?allowed|invalid option|not a valid option|could not coerce|coercion failed/i, signal: "outOfSchema" },
  // fence markers only matter in a WRITE/STORE context — not when echoing input.
  { re: /(updated|wrote|stored|persisted|"changes"|set field|written value)[^]{0,80}(```|<<<[A-Z_]|source_field|field_value|system_prompt)/i, signal: "fenceLeak" },
  { re: /empty response from (the )?ai|no response from (the )?ai|ai returned (an )?empty/i, signal: "emptyEcho" },
  // Only the ungraceful platform 25s kill (the F27 case) — graceful timeouts are EXPECTED above.
  { re: /function timed out\. limit of 25/i, signal: "validatorCrash" },
  { re: /\[mcp-bridge\].*(fail|error)|tools\/list.*(fail|error)/i, signal: "mcpBridge" },
];

export function classifyLogLine(line) {
  if (INPUT_ECHO.test(line) || EXPECTED.test(line)) return null;
  for (const s of SIGNALS) if (s.re.test(line)) return s.signal;
  return null;
}

export function scanForSignals(lines) {
  const out = [];
  for (const l of lines) { const sig = classifyLogLine(l); if (sig) out.push({ line: l, signal: sig }); }
  return out;
}

/** Post-run review: distinct error signatures → counts + hardening targets. */
export function reviewLogFile(file) {
  if (!existsSync(file)) return { found: 0, signals: {} };
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const bySig = {};
  for (const l of lines) {
    const sig = classifyLogLine(l);
    if (!sig) continue;
    (bySig[sig] ||= { count: 0, samples: [], hardeningTarget: HARDENING_TARGETS[sig] || null });
    bySig[sig].count++;
    if (bySig[sig].samples.length < 3) bySig[sig].samples.push(l.replace(/\s+/g, " ").slice(0, 200));
  }
  let found = 0; for (const k of Object.keys(bySig)) found += bySig[k].count;
  return { found, signals: bySig };
}
