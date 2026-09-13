/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Offline: the drift phase's job-log read and its lock assertion (F-592, F-606).
//
// F-592 put the READ here: a log we cannot read must THROW, never look like "no error
// lines found". F-606 puts the JUDGEMENT here: the old predicate was
// `/lock|permission|scope/i` over the run's error lines, which the runner's own
// "Cannot find module '.../.cognirunner/check-permissions-lock.js'" satisfies - so a run
// where the lock never executed scored a full F-529 PASS. The assertion now demands the
// lock script's OWN output, and the fixtures below include the two logs that used to
// sneak past it.
//
// The DRIFT fixture is REAL TEXT, copied from run 34775476424 of
// leanzero-srl/cognirunner-forge-offshoot (branch harness-scope-drift, 2026-09-13) -
// the same shape the live phase reads, tab-prefixed the way `gh run view --log` emits
// it, with the runner's colour codes put back around the lines that carry them.
//
// Run: node scripts/gh-job-log.test.mjs   (auto-discovered by run-offline.mjs)

import { stripAnsi, errorLines, assertLockRefusal, readJobLog, LOCK_SIGNATURE } from "../lib/gh-job-log.mjs";
import { SCAFFOLDS } from "../../src/shared/git-scaffolds.js";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const RED = ESC + "[31m", OFF = ESC + "[0m", CYAN = ESC + "[36;1m";
const REFUSAL = "the response contains terminal escape sequences; pass --allow-escape-sequences to output it anyway";

/* 0. THE ANTI-DRIFT GATE. Every literal the assertion keys on must still be PRINTED by
   the scaffold customers actually get. If someone rewords the lock, THIS fails here -
   not the live phase three weeks later, and not silently as a green run. */
const lockSrc = SCAFFOLDS["forge-pipeline"].files
  .find((f) => f.path === ".cognirunner/check-permissions-lock.js").lines.join("\n");
for (const [name, literal] of Object.entries({
  verdict: "console.log('permission lock: DRIFT (' + drift + ')');",
  approved: "console.log('approved: ' + JSON.stringify(approved));",
  current: "console.log('current:  ' + JSON.stringify(current));",
  lockedFalse: "console.log('locked=' + (locked ? 'true' : 'false'));",
  errorLine: "console.log('::error::permission lock: DRIFT (scopes) - added ' + (added.join(', ') || 'none') + ', removed ' + (removed.join(', ') || 'none') + '. Nothing was deployed.",
})) {
  ok(lockSrc.includes(literal), "the scaffold still prints the '" + name + "' line the matcher keys on");
}
ok(Object.keys(LOCK_SIGNATURE).length === 5, "the signature has exactly the five parts gated above");

/* THE POSITIVE CONTROL: the real drift log, verbatim. */
const P = "deploy\tPermission lock\t";
const LOCK_LINE = "##[error]permission lock: DRIFT (scopes) - added manage:jira-configuration, removed none. Nothing was deployed. Re-approve these permissions in CogniRunner, which rewrites .cognirunner/forge-permissions.lock, then re-run.";
const DRIFT_LINES = [
  P + "2026-09-13T18:43:36.5234435Z ##[group]Run node .cognirunner/check-permissions-lock.js",
  P + "2026-09-13T18:43:36.5235238Z " + CYAN + "node .cognirunner/check-permissions-lock.js" + OFF,
  P + "2026-09-13T18:43:36.5291137Z shell: /usr/bin/bash -e {0}",
  P + "2026-09-13T18:43:36.5292161Z   FORGE_SITE: wolfaenpak.atlassian.net",
  P + "2026-09-13T18:43:36.5297828Z ##[endgroup]",
  P + "2026-09-13T18:43:36.5940039Z permission lock: DRIFT (scopes)",
  P + '2026-09-13T18:43:36.5963220Z approved: ["- read:jira-user","- read:jira-work","- storage:app","- unsafe-inline","content:","scopes:","styles:"]',
  P + '2026-09-13T18:43:36.6003967Z current:  ["- manage:jira-configuration","- read:jira-user","- read:jira-work","- storage:app","- unsafe-inline","content:","scopes:","styles:"]',
  P + "2026-09-13T18:43:36.6025401Z locked=false",
  P + "2026-09-13T18:43:36.6036338Z drift=scopes",
  P + "2026-09-13T18:43:36.6069571Z " + RED + LOCK_LINE + OFF + "\r",
  P + "2026-09-13T18:43:36.6109016Z ##[error]Process completed with exit code 1.",
  "deploy\tDeploy\t2026-09-13T18:43:36.7000000Z " + ESC + "]0;forge-deploy" + BEL + "Deploy: skipped",
];
const FIXTURE = DRIFT_LINES.join("\n");
/* The same step as `gh run view --job <id> --log` returns it: no job/step prefix. */
const JOB_FIXTURE = DRIFT_LINES.map((l) => l.replace(/^[^\t]*\t[^\t]*\t/, "")).join("\n");

/* 1. stripAnsi leaves the text matchable and drops every escape byte. */
const clean = stripAnsi(FIXTURE);
ok(!clean.includes(ESC), "every escape byte is gone after stripAnsi");
ok(clean.includes(LOCK_LINE), "the lock line survives stripping verbatim");
ok(clean.includes("Deploy: skipped"), "an OSC (BEL-terminated) sequence does not eat the text after it");

/* 2. errorLines finds the runner's error line through the colour codes. */
const errs = errorLines(FIXTURE);
ok(errs.length === 2 && errs[0].includes("permission lock: DRIFT (scopes) - added"),
  "the runner's error lines are extracted through the colour codes (got " + JSON.stringify(errs) + ")");
ok(errorLines("2026 ::error::forge deploy failed").length === 1, "the ::error:: form is recognised too");

/* 3. THE POSITIVE CONTROL the whole file hangs on: the real drift log must PASS. If it
   ever stops passing, the tightening below has gone too far and the live phase would
   report a false FAIL - which is why it is asserted before every negative. */
const v = assertLockRefusal(FIXTURE);
ok(v.ok === true, "THE POSITIVE CONTROL: the real drift log PASSES (missing=" + JSON.stringify(v.missing) + " broken=" + JSON.stringify(v.broken) + ")");
ok(v.lockLines.length === 1 && /manage:jira-configuration/.test(v.lockLines[0]),
  "only the lock's OWN error line is evidence - not 'Process completed with exit code 1'");
ok(v.sawMajorVersionRule === false, "MAJOR_VERSION_RULE is absent from the fixture");
ok(assertLockRefusal(JOB_FIXTURE).ok === true, "the same step read JOB-scoped (no run/step prefix) passes identically");

/* 3b. F-606: THE LOGS THAT USED TO PASS AND MUST NOT.

   OLD_PREDICATE is the shipped defect, kept verbatim so the negatives below are proven
   rather than asserted: each one is shown to have RETURNED TRUE under it, and to return
   false now. Without this, a fixture that never fooled the old code would look like a
   test of nothing.
     const lockLines = errs.filter((l) => /lock|permission|scope/i.test(l));
     ok: lockLines.length > 0 && !sawMajorVersionRule
*/
const OLD_PREDICATE = (t) =>
  errorLines(t).filter((l) => /lock|permission|scope/i.test(l)).length > 0 && !/MAJOR_VERSION_RULE/.test(stripAnsi(t));
ok(OLD_PREDICATE(FIXTURE) === true, "control: the old predicate passed the REAL drift log (so did the new one, above)");

/* (a) The lock script is not in the repo at all. Node's error names the path, so the
   line contains BOTH "lock" and "permission" - the old three-word predicate's exact
   hole. The lock evaluated NOTHING; this is a FAIL. */
const MISSING_MODULE = [
  P + "2026-09-13T18:43:36.5234435Z ##[group]Run node .cognirunner/check-permissions-lock.js",
  P + "2026-09-13T18:43:36.5900000Z node:internal/modules/cjs/loader:1215",
  P + "2026-09-13T18:43:36.5910000Z " + RED + "##[error]Error: Cannot find module '/home/runner/work/offshoot/offshoot/.cognirunner/check-permissions-lock.js'" + OFF,
  P + "2026-09-13T18:43:36.5920000Z ##[error]    code: 'MODULE_NOT_FOUND'",
  P + "2026-09-13T18:43:36.6109016Z ##[error]Process completed with exit code 1.",
].join("\n");
const mm = assertLockRefusal(MISSING_MODULE);
ok(/lock/i.test(mm.errLines.join("\n")) && /permission/i.test(mm.errLines.join("\n")),
  "control: the missing-module log really does contain both 'lock' and 'permission' (this is WHY the old matcher passed it)");
ok(mm.sawMajorVersionRule === false, "control: and it carries no MAJOR_VERSION_RULE either, so nothing else would have refused it");
ok(OLD_PREDICATE(MISSING_MODULE) === true, "PROVEN: the SHIPPED predicate returned a PASS for the missing-module log");
ok(mm.ok === false, "F-606: a run where the lock script COULD NOT BE FOUND fails the assertion");
ok(mm.broken.length > 0 && mm.missing.includes("verdict") && mm.missing.includes("errorLine"),
  "and it says WHY: the script broke and the lock's own verdict is absent (" + JSON.stringify({ broken: mm.broken.length, missing: mm.missing }) + ")");

/* (b) An unrelated failure that happens to carry "scope" inside a path. Nothing to do
   with the permission lock, and it must not be read as one. */
const UNRELATED_SCOPE = [
  "deploy\tBuild UI\t2026-09-13T18:41:00.0Z ##[group]Run npm ci --prefix static/scope-picker",
  "deploy\tBuild UI\t2026-09-13T18:41:02.0Z " + RED + "##[error]npm ERR! ENOENT: no such file or directory, open '/home/runner/work/x/x/static/scope-picker/package.json'" + OFF,
  "deploy\tBuild UI\t2026-09-13T18:41:02.1Z ##[error]Process completed with exit code 254.",
].join("\n");
const us = assertLockRefusal(UNRELATED_SCOPE);
ok(/scope/i.test(us.errLines.join("\n")), "control: the unrelated failure really does contain 'scope' (old matcher food)");
ok(OLD_PREDICATE(UNRELATED_SCOPE) === true, "PROVEN: the SHIPPED predicate returned a PASS for an unrelated npm ENOENT failure");
ok(us.ok === false && us.lockLines.length === 0,
  "F-606: an unrelated failure mentioning 'scope' in a path is NOT a lock refusal (missing=" + JSON.stringify(us.missing) + ")");

/* (c) The lock step produced nothing, and an entirely empty log. */
ok(assertLockRefusal("").ok === false, "an empty lock-step log fails - it cannot be evidence of anything");
ok(assertLockRefusal("   \n  ").missing.join(" ").includes("empty log"), "and the reason given is that the log is empty");
ok(assertLockRefusal(P + "2026-09-13T18:43:36.5Z ##[endgroup]").ok === false, "a lock step with no lock output at all fails");

/* (d) A HALF log: the lock judged but its ::error:: is absent. The scaffold always
   prints both, so half is a broken observation, not a pass. */
const half = assertLockRefusal(DRIFT_LINES.filter((l) => !l.includes("Nothing was deployed.")).join("\n"));
ok(half.ok === false && half.missing.includes("errorLine"), "the lock's verdict WITHOUT its own ::error:: line does not pass");
/* ...and the mirror: the ::error:: with no verdict or listing above it. */
const qo = assertLockRefusal(P + "2026-09-13T18:43:36.6Z " + LOCK_LINE);
ok(qo.ok === false && qo.missing.includes("approved") && qo.missing.includes("current"),
  "the ::error:: alone, without the approved-vs-current listing, does not pass");

/* (e) The original F-529 negative still holds: MAJOR_VERSION_RULE is a DIFFERENT refusal
   even when the lock's own lines are all present above it. */
const wv = assertLockRefusal(FIXTURE + "\n" + P + "2026-09-13T18:44:00.0Z ##[error]MAJOR_VERSION_RULE: a major version bump requires manual approval");
ok(wv.ok === false && wv.sawMajorVersionRule === true, "a MAJOR_VERSION_RULE failure is refused even alongside a real lock line");
ok(assertLockRefusal("2026 nothing to see here").ok === false, "a log with no error line does not pass the assertion");

/* 4. readJobLog: the escape-sequence guard is survived, not skipped. */
const calls = [];
const refusingBare = (file, args) => {
  calls.push(args.join(" "));
  if (args[0] === "run") throw new Error("unknown command for this CLI build");
  if (args.includes("--allow-escape-sequences")) return JOB_FIXTURE;
  throw new Error(REFUSAL);
};
const got = readJobLog({ run: refusingBare, repo: "o/r", runId: 11, jobId: 22 });
ok(got.text.includes(LOCK_LINE) && !got.text.includes(ESC), "the log is read via the --allow-escape-sequences fallback, stripped");
ok(got.via === "api /repos/o/r/actions/jobs/22/logs", "the carrier is reported (got " + got.via + ")");
ok(assertLockRefusal(got.text).ok === true, "the text readJobLog returns still satisfies the lock assertion");

/* 5. F-606: jobId is HONOURED. `gh run view <runId> --log` is the WHOLE RUN - every job,
   every step - so while it led the list a jobId was never used at all, and a read named
   "the failing job's log" could be satisfied by any step of any job in the run. */
calls.length = 0;
const viewWorks = (file, args) => { calls.push(args.join(" ")); if (args[0] === "run") return JOB_FIXTURE; throw new Error("should not have been reached"); };
const viaJob = readJobLog({ run: viewWorks, repo: "o/r", runId: 11, jobId: 22 });
ok(calls.length === 1 && calls[0] === "run view --job 22 --repo o/r --log",
  "F-606: with a jobId present the FIRST call asks for THAT JOB, not the whole run (calls=" + JSON.stringify(calls) + ")");
ok(viaJob.via === "run view --job", "the job carrier names itself distinctly from the run carrier (got " + viaJob.via + ")");

calls.length = 0;
readJobLog({ run: viewWorks, repo: "o/r", runId: 11 });
ok(calls.length === 1 && calls[0] === "run view 11 --repo o/r --log",
  "with no jobId the whole-run form is still available (calls=" + JSON.stringify(calls) + ")");

calls.length = 0;
const jobCarriersDead = (file, args) => {
  calls.push(args.join(" "));
  if (args.includes("--job") || args[0] === "api") throw new Error("job log expired");
  return FIXTURE;
};
const viaRun = readJobLog({ run: jobCarriersDead, repo: "o/r", runId: 11, jobId: 22 });
ok(viaRun.via === "run view <run>" && calls.length === 4,
  "the whole-run log is the LAST resort, after all three job carriers (calls=" + JSON.stringify(calls) + ")");

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
