/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/* ═══════════════════════════════════════════════════════════════════════════════
 * F-784 / F-787 — THE TWO THINGS EVERY LIVE DRIVER SAYS ABOUT ITS OWN RUN.
 *
 * 1. THE RESULT LINE, AND WHAT IT SAYS WHEN THE RUN DID NOT FINISH.
 *
 * F-784's crash was found because a tester read `RESULT — 2 pass, 0 fail, 0 not verified`
 * under a TypeError stack. Both halves of that were true and the whole was a lie: the
 * counters really were 2/0/0, because the run died before anything else could be counted.
 * Four drivers print their RESULT line from a `finally` (so the restore block can report its
 * own residue after it), which means the line prints on the crash path too — with the
 * counters frozen wherever the throw left them.
 *
 * A crash is not zero failures. It is NO RESULT AT ALL, and the line has to say so in the
 * first word, because the first word is the only part a grep or a tired reader takes.
 *
 * WHY NOT `process.on("uncaughtException")`: every one of these drivers already owns its
 * throw (a `.catch()` on the main promise, or a top-level `try`) so that the restore block
 * always runs — the residue assertions are the whole reason the finally exists. A process
 * handler would fire alongside that, print a second verdict, and race the restore it was
 * meant to protect. The honest fix is to carry the error INTO the line the driver already
 * prints, which is what `formatResultLine({crashed})` is for.
 *
 * 2. WHICH COMMIT PRODUCED THE EVIDENCE.
 *
 * `evidence.json` records what a run saw, and is read weeks later beside a findings row. What
 * it did NOT record is the code that produced it, so an evidence file and the driver that
 * wrote it could drift apart with nothing in either to show it. `runProvenance()` answers
 * that in three fields, and reports a DIRTY worktree explicitly: evidence produced from
 * uncommitted edits is still evidence, but it is not reproducible from the commit it names,
 * and a reader who is not told that will assume it is.
 * ═══════════════════════════════════════════════════════════════════════════════ */

import { execFileSync } from "node:child_process";

/**
 * The RESULT line, with the crash path told the truth.
 *
 * @param {{passes:number, fails:number, unproven:number, crashed?:any, dash?:string, suffix?:string}} o
 *   `crashed` is the error (or any truthy marker) if the run did not reach its end.
 *   `dash` keeps each driver's existing punctuation ("—" or "-") so no untouched line moves.
 *   `suffix` is appended verbatim (the evidence-path tail three drivers print).
 * @returns {string} — never prefixed with a newline; the caller keeps its own spacing.
 */
export function formatResultLine({ passes = 0, fails = 0, unproven = 0, crashed = null, dash = "—", suffix = "" } = {}) {
  const counts = `${passes} pass, ${fails} fail, ${unproven} not verified`;
  if (!crashed) return `RESULT ${dash} ${counts}${suffix}`;
  const msg = (crashed && crashed.message) || (typeof crashed === "string" ? crashed : "");
  return (
    `RESULT ${dash} CRASHED ${dash} the run did not finish, so these counts are where the throw left them and NOT a result: ` +
    `${counts}${msg ? ` · ${String(msg).slice(0, 300)}` : ""}${suffix}`
  );
}

/** True when the run should exit non-zero: a failure OR a crash. */
export function resultExitCode({ fails = 0, crashed = null } = {}) {
  return fails || crashed ? 1 : 0;
}

/**
 * The commit this run's code came from.
 *
 * Never throws: a driver must not die because it was run from a tarball with no `.git`, so an
 * unavailable answer is recorded as `commit: null` with the reason, which is itself provenance.
 *
 * @returns {{commit: string|null, dirty: boolean|null, at: string, note?: string}}
 */
export function runProvenance({ cwd } = {}) {
  const at = new Date().toISOString();
  const git = (args) =>
    execFileSync("git", args, { cwd: cwd || process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  try {
    const commit = git(["rev-parse", "--short", "HEAD"]);
    /* `--porcelain` over the whole worktree: a driver edited but not committed is the case
       this field exists to expose, and limiting the status to one path would hide exactly the
       lib edits that change what the driver does. */
    const dirty = git(["status", "--porcelain"]).length > 0;
    return { commit, dirty, at };
  } catch (e) {
    return { commit: null, dirty: null, at, note: `git unavailable: ${String((e && e.message) || e).slice(0, 160)}` };
  }
}
