/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Offline: F-592 - the drift phase's job-log read and its two assertions.
//
// The fixture below is the REAL shape the live run produced (the ledger row's quoted
// lines, re-wrapped in the group/colour noise a runner emits): an ANSI-coloured
// "##[error]permission lock: DRIFT (scopes) ..." line and NO MAJOR_VERSION_RULE.
//
// What this proves, in order of how badly it would hurt:
//  1. An UNREADABLE log THROWS - it can never be mistaken for "no error lines found",
//     which is how F-592 turned a skipped assertion into a green-looking phase.
//  2. A log the bare CLI call REFUSES is still read, and the refusal message never
//     reaches the assertions as if it were log content.
//  3. The lock line is matched THROUGH the escape sequences, and MAJOR_VERSION_RULE is
//     detected even when coloured.
//
// Run: node scripts/gh-job-log.test.mjs   (auto-discovered by run-offline.mjs)

import { stripAnsi, errorLines, assertLockRefusal, readJobLog } from "../lib/gh-job-log.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const RED = ESC + "[31m", OFF = ESC + "[0m", BOLD = ESC + "[1m";
const REFUSAL = "the response contains terminal escape sequences; pass --allow-escape-sequences to output it anyway";

const LOCK_LINE = "##[error]permission lock: DRIFT (scopes) - added manage:jira-configuration, removed none. Nothing was deployed.";
const FIXTURE = [
  "2026-09-13T09:00:01.1Z " + ESC + "[0;36m##[group]" + OFF + "Run permission lock",
  "2026-09-13T09:00:01.2Z " + BOLD + "Comparing manifest scopes against the recorded lock" + OFF,
  "2026-09-13T09:00:01.9Z " + RED + LOCK_LINE + OFF + "\r",
  "2026-09-13T09:00:02.0Z ##[endgroup]",
  "2026-09-13T09:00:02.1Z " + ESC + "]0;forge-deploy" + BEL + "Deploy: skipped",
].join("\n");

/* 1. stripAnsi leaves the text matchable and drops every escape byte. */
const clean = stripAnsi(FIXTURE);
ok(!clean.includes(ESC), "every escape byte is gone after stripAnsi");
ok(clean.includes(LOCK_LINE), "the lock line survives stripping verbatim");
ok(clean.includes("Deploy: skipped"), "an OSC (BEL-terminated) sequence does not eat the text after it");

/* 2. errorLines finds the runner's error line through the colour codes. */
const errs = errorLines(FIXTURE);
ok(errs.length === 1 && errs[0].includes("permission lock: DRIFT (scopes)"),
  "exactly the one error line is extracted (got " + JSON.stringify(errs) + ")");
ok(errorLines("2026 ::error::forge deploy failed").length === 1, "the ::error:: form is recognised too");

/* 3. The two assertions the live phase must make. */
const v = assertLockRefusal(FIXTURE);
ok(v.ok === true, "the fixture PASSES the lock assertion (got " + JSON.stringify(v) + ")");
ok(v.lockLines.length === 1 && /manage:jira-configuration/.test(v.lockLines[0]), "the lock line is the one reported as evidence");
ok(v.sawMajorVersionRule === false, "MAJOR_VERSION_RULE is absent from the fixture");

/* The NEGATIVE on the same shape: a job that failed on the version rule instead must
   NOT pass, even though it is also a coloured error line in the same log. */
const wrong = FIXTURE.replace(LOCK_LINE, "##[error]MAJOR_VERSION_RULE: a major version bump requires manual approval");
const wv = assertLockRefusal(wrong);
ok(wv.ok === false && wv.sawMajorVersionRule === true, "a MAJOR_VERSION_RULE failure is refused (got " + JSON.stringify(wv) + ")");
ok(assertLockRefusal("2026 nothing to see here").ok === false, "a log with no error line does not pass the assertion");

/* 4. readJobLog: the escape-sequence guard is survived, not skipped. */
const calls = [];
const refusingBare = (file, args) => {
  calls.push(args.join(" "));
  if (args[0] === "run") throw new Error("unknown command for this CLI build");
  if (args.includes("--allow-escape-sequences")) return FIXTURE;
  throw new Error(REFUSAL);
};
const got = readJobLog({ run: refusingBare, repo: "o/r", runId: 11, jobId: 22 });
ok(got.text.includes(LOCK_LINE) && !got.text.includes(ESC), "the log is read via the --allow-escape-sequences fallback, stripped");
ok(got.via === "api /repos/o/r/actions/jobs/22/logs", "the carrier is reported (got " + got.via + ")");
ok(assertLockRefusal(got.text).ok === true, "the text readJobLog returns still satisfies the lock assertion");

/* The whole-run carrier is PREFERRED when it works, and is enough on its own. */
calls.length = 0;
const viewWorks = (file, args) => { calls.push(args.join(" ")); if (args[0] === "run") return FIXTURE; throw new Error("should not have been reached"); };
const viaRun = readJobLog({ run: viewWorks, repo: "o/r", runId: 11, jobId: 22 });
ok(viaRun.via === "run view" && calls.length === 1, "the whole-run carrier is tried first and alone (calls=" + JSON.stringify(calls) + ")");

/* THE F-592 RULE: nothing readable => THROW. Never an empty string that reads as
   "no error lines", which is exactly how the assertion got skipped. */
let threw = null;
try { readJobLog({ run: () => { throw new Error(REFUSAL); }, repo: "o/r", runId: 11, jobId: 22 }); }
catch (e) { threw = e; }
ok(threw !== null, "an unreadable log THROWS instead of returning empty text");
ok(threw && /cannot be skipped/.test(threw.message) && /escape sequences/.test(threw.message),
  "the exception names the rule and every attempt (got " + (threw && threw.message) + ")");
let threwEmpty = null;
try { readJobLog({ run: () => "   ", repo: "o/r", runId: 11, jobId: 22 }); } catch (e) { threwEmpty = e; }
ok(threwEmpty !== null && /empty body/.test(threwEmpty.message), "an empty log body is a failure, not a pass");

console.log("gh-job-log: " + pass + " passed, " + fail + " failed");
if (fail) process.exit(1);
