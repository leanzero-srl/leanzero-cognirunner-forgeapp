/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
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
const SIGNALS = [
  { re: /\b5\d\d\b|internal server error|unhandled|uncaught|TypeError|ReferenceError|stack trace|at Object\.<anonymous>|at async /i, signal: "http5xx" },
  { re: /malformed json|not valid json|cannot deserialize|unexpected token|failed to parse|JSON\.parse|after \d+ round/i, signal: "parseLeak" },
  { re: /tool.?call|function\.arguments|tool_use|invalid tool|tool result/i, signal: "toolShape" },
  { re: /allowedvalues|out of (the )?allowed|invalid option|not a valid option|coerc/i, signal: "outOfSchema" },
  { re: /```|<<<|source_field|field_value|system_prompt/i, signal: "fenceLeak" },
  { re: /empty response|no response from (the )?ai/i, signal: "emptyEcho" },
  { re: /temporarily unavailable|rate ?limit|\b429\b|timed out|timeout|ECONNRESET|ETIMEDOUT|\b503\b|\b502\b/i, signal: "transientMishandled" },
  { re: /\[mcp-bridge\].*(fail|error)|tools\/list.*(fail|error)/i, signal: "mcpBridge" },
];

export function classifyLogLine(line) {
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
