/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/* ═══════════════════════════════════════════════════════════════════════════════
 * THE OFFLINE CONTROL ON WHAT A LIVE DRIVER SAYS ABOUT ITS OWN RUN.
 *
 * F-784 — the crash was found under `RESULT — 2 pass, 0 fail, 0 not verified`, printed by a
 * driver whose process was dying of a TypeError. Every number in that line was true and the
 * whole was a lie, because four drivers print the line from a `finally` (so the restore block
 * can report its own residue after it) and a finally runs on the crash path too, with the
 * counters frozen wherever the throw left them. A crash is not zero failures — it is NO
 * RESULT AT ALL.
 *
 * F-787 — and an evidence.json never said which commit produced it.
 *
 * WHAT THIS FILE CANNOT PROVE: that the four wired drivers really reach `formatResultLine`
 * with `crashed` set — their `catch` blocks are live-only code. What it CAN prove, and does,
 * is that the sentence is honest for every input, which is the half that was wrong.
 * ═══════════════════════════════════════════════════════════════════════════════ */

import { formatResultLine, resultExitCode, runProvenance } from "../lib/driver-report.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ok   ${m}`); } else { fail++; console.log(`  FAIL ${m}`); } };

console.log("\n1 · formatResultLine — THE CLEAN RUN IS BYTE-COMPATIBLE");
{
  const line = formatResultLine({ passes: 22, fails: 0, unproven: 1 });
  ok(line === "RESULT — 22 pass, 0 fail, 1 not verified",
    "a finished run prints exactly what the four drivers printed before — the conversion must not move a single passing line");
  ok(formatResultLine({ passes: 1, fails: 2, unproven: 3, dash: "-" }) === "RESULT - 1 pass, 2 fail, 3 not verified",
    "…and the ASCII dash is available, because va-purge-on-delete and two others punctuate it that way and a gratuitous change to their output is noise in a diff nobody asked for");
  ok(formatResultLine({ passes: 1, fails: 0, unproven: 0, suffix: ". Evidence: /x" }).endsWith(". Evidence: /x"),
    "…and the evidence-path tail the evidence-writing drivers append survives, verbatim");
  ok(!formatResultLine({ passes: 0, fails: 0, unproven: 0 }).startsWith("\n"),
    "the helper never owns the leading blank line — each driver keeps its own spacing, so no console layout moves");
}

console.log("\n2 · formatResultLine — THE CRASH PATH SAYS SO IN THE FIRST WORD (F-784)");
{
  const line = formatResultLine({ passes: 2, fails: 0, unproven: 0, crashed: new Error("x[undefined] is not a function") });
  ok(/^RESULT — CRASHED/.test(line),
    "CRASHED is the FIRST word after RESULT — the first word is all a grep or a tired reader takes, which is exactly how F-784 survived a live run");
  ok(/NOT a result/.test(line),
    "…and the line says in words that the counts are not a result, because '0 fail' was individually true the whole time the driver was dying");
  ok(/2 pass, 0 fail, 0 not verified/.test(line),
    "…while still reporting the counters: they are where the throw landed, which is a useful fact once it is labelled as one");
  ok(/is not a function/.test(line),
    "…and carries the error's own message, so the RESULT line alone names the defect without scrolling to the stack");

  const long = formatResultLine({ passes: 0, fails: 0, unproven: 0, crashed: new Error("z".repeat(900)) });
  ok(long.length < 600, "a runaway error message is clamped — the RESULT line stays one readable line");

  ok(/CRASHED/.test(formatResultLine({ passes: 0, fails: 0, unproven: 0, crashed: "the browser never opened" })),
    "a STRING is accepted as the crash marker too: a driver that knows it aborted without holding an Error must still be able to say so");
  ok(!/CRASHED/.test(formatResultLine({ passes: 0, fails: 0, unproven: 0, crashed: null })),
    "and `crashed: null` — the initial value in all four wired drivers — is the clean line, so a normal run is untouched");
}

console.log("\n3 · resultExitCode — A CRASH EXITS NON-ZERO EVEN WITH ZERO FAILURES");
{
  ok(resultExitCode({ fails: 0, crashed: null }) === 0, "clean run exits 0");
  ok(resultExitCode({ fails: 1, crashed: null }) === 1, "a failure exits 1, as before");
  ok(resultExitCode({ fails: 0, crashed: new Error("boom") }) === 1,
    "a CRASH with zero failures exits 1 — the shape that made F-784 printable: the counters said pass and only the process's death said otherwise");
  ok(resultExitCode({}) === 0 && resultExitCode() === 0,
    "an empty call is 0, so a driver that forgets an argument does not silently invent a failure");
}

console.log("\n4 · runProvenance — WHICH COMMIT PRODUCED THE EVIDENCE (F-787)");
{
  const p = runProvenance();
  ok(typeof p.at === "string" && !Number.isNaN(Date.parse(p.at)), "`at` is an ISO instant");
  ok(p.commit === null || /^[0-9a-f]{7,40}$/.test(p.commit),
    "`commit` is a short sha, or null when there is no git — never a thrown error, because a driver must not die of being run from a tarball");
  ok(p.dirty === null || typeof p.dirty === "boolean",
    "`dirty` is a boolean beside it: evidence produced from uncommitted edits is still evidence, but it is not reproducible from the commit it names, and a reader who is not told will assume it is");
  ok(p.commit !== null, "…and in THIS repo it really resolves, so the assertion above is not vacuous");

  const bad = runProvenance({ cwd: "/nonexistent-path-for-the-provenance-control" });
  ok(bad.commit === null && typeof bad.note === "string",
    "an unavailable git is recorded as `commit: null` WITH a note — which is itself provenance, and is the only honest answer");
  ok(!Object.prototype.hasOwnProperty.call(p, "branch"),
    "no branch name: it is not a stable identifier of anything and would be the field people trusted instead of the sha");
}

console.log(`\ndriver-report: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
