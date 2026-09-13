/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// F-592 - reading a GitHub Actions job log without letting the CLI's escape-sequence
// guard swallow the evidence.
//
// WHY THIS EXISTS. `gh api /repos/{o}/{r}/actions/jobs/{id}/logs` on the newer gh CLI
// REFUSES to print a body containing terminal escape sequences: it exits 1 with
// "the response contains terminal escape sequences; pass --allow-escape-sequences to
// output it anyway". A runner log always contains them, so `execFileSync` threw and the
// drift phase died BEFORE its ::error:: assertions - the two assertions that are the
// whole point of the phase. What was left reported only the checks that happened to run
// earlier, which reads like a pass.
//
// THE RULE THIS ENCODES: a log we cannot read is a FAILURE, never a skip. `readJobLog`
// throws with every attempt it made; the caller turns that into a failed check.

// ESC is built from its code point on purpose: a literal escape byte in source is
// invisible in every diff and in every review tool.
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
// CSI (colour, cursor), OSC (title/hyperlink, BEL- or ST-terminated), and the
// single-character escapes a runner can emit.
const ANSI = new RegExp(
  [
    ESC + "\\[[0-9;?]*[ -\\/]*[@-~]",
    ESC + "\\][\\s\\S]*?(?:" + BEL + "|" + ESC + "\\\\)",
    ESC + "[@-Z\\\\-_]",
  ].join("|"),
  "g",
);
// Everything else below space except \t and \n (\r is normalised first).
const OTHER_CONTROL = new RegExp("[" + String.fromCharCode(0) + "-" + String.fromCharCode(8)
  + String.fromCharCode(11) + "-" + String.fromCharCode(12)
  + String.fromCharCode(14) + "-" + String.fromCharCode(31) + "]", "g");

/** Strip ANSI/VT escape sequences and stray control bytes; normalise lone CRs. */
export const stripAnsi = (text) =>
  String(text == null ? "" : text)
    .replace(ANSI, "")
    .replace(/\r(?!\n)/g, "\n")
    .replace(OTHER_CONTROL, "");

/** The `::error::` / `##[error]` lines a runner emits, cleaned and trimmed. */
export const errorLines = (text) =>
  stripAnsi(text)
    .split("\n")
    .filter((l) => l.includes("::error::") || l.includes("##[error]"))
    .map((l) => l.trim());

/**
 * The F-529 claim, evaluated over already-captured text:
 *   - at least one error line is the permission LOCK's own line, and
 *   - MAJOR_VERSION_RULE appears nowhere (a different refusal wearing the same failure).
 * Returns { ok, lockLines, errLines, sawMajorVersionRule } - never throws on content.
 */
export const assertLockRefusal = (text) => {
  const clean = stripAnsi(text);
  const errs = errorLines(clean);
  const lockLines = errs.filter((l) => /lock|permission|scope/i.test(l));
  const sawMajorVersionRule = /MAJOR_VERSION_RULE/.test(clean);
  return { ok: lockLines.length > 0 && !sawMajorVersionRule, lockLines, errLines: errs, sawMajorVersionRule };
};

/**
 * Read a job log as text. `run` is an execFileSync-style runner ((file, args) => string)
 * so this is testable without a network.
 *
 * Order: `gh run view <runId> --log` first (documented, whole-run, plain text), then the
 * job-logs API WITH --allow-escape-sequences, then the API bare (older gh has no such
 * flag and needs none). Every attempt's error is kept; if all of them fail the caller
 * gets ONE exception naming all of them - never a skip.
 */
export const readJobLog = ({ run, repo, runId, jobId }) => {
  const attempts = [];
  const tries = [];
  if (runId) tries.push(["run", "view", String(runId), "--repo", repo, "--log"]);
  if (jobId) {
    tries.push(["api", `/repos/${repo}/actions/jobs/${jobId}/logs`, "--allow-escape-sequences"]);
    tries.push(["api", `/repos/${repo}/actions/jobs/${jobId}/logs`]);
  }
  for (const args of tries) {
    try {
      const out = run("gh", args);
      const text = stripAnsi(out);
      if (text.trim()) return { text, via: args.slice(0, 2).join(" ") };
      attempts.push(`${args.join(" ")}: empty body`);
    } catch (e) {
      attempts.push(`${args.join(" ")}: ${String((e && e.message) || e).split("\n")[0].slice(0, 200)}`);
    }
  }
  throw new Error(`the job log could NOT be read - the F-529 assertions cannot be skipped. Attempts: ${attempts.join(" | ")}`);
};
