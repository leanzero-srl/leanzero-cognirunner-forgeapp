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

// ---------------------------------------------------------------------------
// F-606 - THE LOCK'S OWN SIGNATURE, NOT THREE WORDS THAT COULD COME FROM ANYWHERE.
//
// The predicate used to be `/lock|permission|scope/i` over the run's error lines. The
// error a runner emits when the lock script is not there at all -
//   ##[error]Error: Cannot find module '/home/runner/work/x/x/.cognirunner/check-permissions-lock.js'
// - matches BOTH "lock" and "permission", carries no MAJOR_VERSION_RULE, and the two
// checks around it ("it failed AT the Permission lock step", "the Deploy step never
// ran") are satisfied by a CRASHED step just as well as by a refusing one. So a run
// where the lock evaluated NOTHING reported a full F-529 pass. Same class as F-592, one
// layer down: an assertion that reads like a pass because the thing it was meant to
// observe never happened.
//
// THE RULE THIS ENCODES: the evidence must be text only the lock script itself can have
// written. Every literal below is printed by CHECK_PERMISSIONS_LOCK_JS in
// `src/shared/git-scaffolds.js`; gh-job-log.test.mjs imports that scaffold and asserts
// each literal still appears in its source, so the two homes cannot drift apart
// silently - the offline suite fails the day someone rewords the lock.
//
// And a log showing the lock could not RUN (missing module, ENOENT, command not found),
// or carrying no lock output at all, is a FAILURE - never a pass by omission.

/** Printed by the lock script on the drift path (git-scaffolds.js CHECK_PERMISSIONS_LOCK_JS). */
export const LOCK_SIGNATURE = Object.freeze({
  // console.log('permission lock: DRIFT (' + drift + ')')
  verdict: /permission lock: DRIFT \((scopes|other)\)/,
  // console.log('approved: ' + JSON.stringify(approved))
  approved: /\bapproved: \[/,
  // console.log('current:  ' + JSON.stringify(current))   <- two spaces, it is aligned
  current: /\bcurrent: {2}\[/,
  // console.log('locked=' + (locked ? 'true' : 'false'))
  lockedFalse: /\blocked=false\b/,
  // the ::error:: the scaffold exits 1 with, in either of the runner's two renderings
  errorLine: /(?:::error::|##\[error\])permission lock: DRIFT \(scopes\) - added .+?, removed .+?\. Nothing was deployed\./,
});

/** A log proving the lock step BROKE rather than judged. Any hit is a hard failure. */
export const LOCK_BROKEN_MARKERS = Object.freeze([
  /Cannot find module/,
  /MODULE_NOT_FOUND/,
  /\bENOENT\b/,
  /command not found/,
  /No such file or directory/,
]);

/**
 * The F-529 claim, evaluated over already-captured text. Passes ONLY when:
 *   - the lock's own drift verdict, its approved-vs-current listing and `locked=false`
 *     are all present (it RAN and it JUDGED), and
 *   - its own `::error::permission lock: DRIFT (scopes) - added ...` line is present
 *     (it REFUSED, in its own words), and
 *   - nothing in the log says the script failed to run, and
 *   - MAJOR_VERSION_RULE appears nowhere (a different refusal wearing the same failure).
 * Returns { ok, lockLines, errLines, sawMajorVersionRule, missing, broken } - never
 * throws on content. `missing`/`broken` are the reasons, for the caller's evidence line.
 */
export const assertLockRefusal = (text) => {
  const clean = stripAnsi(text);
  const errs = errorLines(clean);
  const missing = [];
  if (!clean.trim()) missing.push("empty log - the lock step produced no output");
  else {
    for (const [name, re] of Object.entries(LOCK_SIGNATURE)) {
      // the ::error:: form must be an ERROR line, not prose quoting it somewhere
      if (!re.test(name === "errorLine" ? errs.join("\n") : clean)) missing.push(name);
    }
  }
  const broken = LOCK_BROKEN_MARKERS.filter((re) => re.test(clean)).map((re) => String(re));
  const sawMajorVersionRule = /MAJOR_VERSION_RULE/.test(clean);
  // Evidence = the lock's OWN error line(s), never "any line with the word lock in it".
  const lockLines = errs.filter((l) => LOCK_SIGNATURE.errorLine.test(l));
  return {
    ok: missing.length === 0 && broken.length === 0 && !sawMajorVersionRule && lockLines.length > 0,
    lockLines, errLines: errs, sawMajorVersionRule, missing, broken,
  };
};

/**
 * Read a job log as text. `run` is an execFileSync-style runner ((file, args) => string)
 * so this is testable without a network.
 *
 * F-606: the first carrier used to be `gh run view <runId> --log`, which is documented
 * as the WHOLE RUN - every job, every step. With that first in the list `jobId` was
 * never used whenever a runId was present, so a read named "the failing job's log" in
 * fact returned the whole run and could be satisfied by any step of any job in it. When
 * a jobId is given we now ask for THAT JOB: `gh run view --job <id> --log`. The
 * whole-run form survives only as the last resort, for a caller that has no job id.
 *
 * Order: the job log via `run view --job`, then the job-logs API WITH
 * --allow-escape-sequences, then the API bare (older gh has no such flag and needs
 * none), then the whole run. Every attempt's error is kept; if all of them fail the
 * caller gets ONE exception naming all of them - never a skip.
 */
export const readJobLog = ({ run, repo, runId, jobId }) => {
  const attempts = [];
  const tries = [];
  if (jobId) {
    tries.push(["run", "view", "--job", String(jobId), "--repo", repo, "--log"]);
    tries.push(["api", `/repos/${repo}/actions/jobs/${jobId}/logs`, "--allow-escape-sequences"]);
    tries.push(["api", `/repos/${repo}/actions/jobs/${jobId}/logs`]);
  }
  if (runId) tries.push(["run", "view", String(runId), "--repo", repo, "--log"]);
  for (const args of tries) {
    try {
      const out = run("gh", args);
      const text = stripAnsi(out);
      if (text.trim()) return { text, via: carrierName(args) };
      attempts.push(`${args.join(" ")}: empty body`);
    } catch (e) {
      attempts.push(`${args.join(" ")}: ${String((e && e.message) || e).split("\n")[0].slice(0, 200)}`);
    }
  }
  throw new Error(`the job log could NOT be read - the F-529 assertions cannot be skipped. Attempts: ${attempts.join(" | ")}`);
};

/** Which carrier produced the text. "run view --job" and "run view <run>" are NOT the
 *  same evidence - one is a job, the other is every job in the run - so they must not
 *  report the same name. */
const carrierName = (args) =>
  args[0] === "run" ? (args.includes("--job") ? "run view --job" : "run view <run>") : args.slice(0, 2).join(" ");
