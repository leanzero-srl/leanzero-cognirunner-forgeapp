/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */
/*
 * F-690 — THE DRAIN LOOP'S DECISION, UNIT-TESTED WHERE THE PRODUCTION LOOP READS IT.
 *
 * The `deletes-failing` back-off contract used to be asserted only against a hand-written
 * loop inside `harness-fault-ttl.test.mjs` — a loop that existed nowhere in production. This
 * suite asserts the function `harness-fault-expiry-live.mjs` actually calls, so the contract
 * and its proof have one home. Every case below is a REAL answer shape from
 * `src/harness-fault.js`'s return statement, not a convenient stand-in.
 */
import assert from "node:assert/strict";
import {
  decideSweepStep, newDrainState, answerSignature, answerComplete,
  DELETES_FAILING_BACKOFF_MS, IDENTICAL_ANSWER_LIMIT,
} from "../lib/sweep-drain.mjs";

/** Walk a scripted list of answers through the decision, returning every step taken. */
const drive = (answers) => {
  let state = newDrainState();
  const steps = [];
  for (const a of answers) {
    const step = decideSweepStep(a, state);
    state = step.state;
    steps.push(step);
    if (step.action !== "resume") break;
  }
  return steps;
};

const failing = (n) => ({
  ok: true, dryRun: false, scanned: 100, deleted: 0, failed: 3,
  truncated: true, reason: "deletes-failing", rowsTruncated: false,
  complete: false, cursor: "page-" + n,
});
const budget = (n) => ({
  ok: true, dryRun: false, scanned: 100, deleted: 40, failed: 0,
  truncated: true, reason: "budget", rowsTruncated: false, complete: false, cursor: "page-" + n,
});
const failed = (n) => ({
  ok: true, dryRun: false, scanned: 100, deleted: 40, failed: 2,
  truncated: true, reason: "deletes-failed", rowsTruncated: false, complete: false, cursor: "page-" + n,
});
const done = () => ({
  ok: true, dryRun: false, scanned: 100, deleted: 40, failed: 0,
  truncated: false, reason: null, rowsTruncated: false, complete: true, cursor: null,
});

/* ── 1 · complete is READ, not re-derived from `truncated` (F-692 prep) ───────────────── */
assert.equal(decideSweepStep(done(), newDrainState()).action, "done");
// The library's single source WINS over the derived copy the moment the two disagree.
assert.equal(
  decideSweepStep({ truncated: false, complete: false, reason: "deletes-failed", failed: 2, cursor: "p1" }, newDrainState()).action,
  "resume",
  "an answer the LIBRARY calls incomplete must not be treated as drained just because `truncated` is false",
);
// And an answer from a build that predates `complete` still falls back to `truncated`.
assert.equal(answerComplete({ truncated: false }), true);
assert.equal(answerComplete({ truncated: true }), false);
assert.equal(answerComplete({ truncated: false, complete: false }), false);

/* ── 2 · deletes-failing: paced back-off, capped, then not-converging ─────────────────── */
// Distinct cursors each time, so the byte-identical rule is NOT what stops it - the try cap is.
const paced = drive([failing(1), failing(2), failing(3), failing(4)]);
assert.deepEqual(paced.slice(0, 3).map((s) => s.action), ["resume", "resume", "resume"]);
/* The LITERALS, not the constant. Comparing the steps against `DELETES_FAILING_BACKOFF_MS`
   alone is a tautology: setting the table to `[0, 0, 0]` — an unpaced hammer, which is the
   exact F-690 harm — still satisfies it. Mutation-checked by doing precisely that. */
assert.deepEqual(paced.slice(0, 3).map((s) => s.sleepMs), [500, 1000, 2000],
  "the first three `deletes-failing` resumes must sleep 500ms, 1s, 2s - the whole point of the reason");
assert.deepEqual(DELETES_FAILING_BACKOFF_MS, [500, 1000, 2000]);
assert.ok(DELETES_FAILING_BACKOFF_MS.every((ms) => ms > 0), "a back-off of zero is not a back-off");
assert.deepEqual(paced.slice(0, 3).map((s) => s.cursor), ["page-1", "page-2", "page-3"]);
assert.equal(paced[3].action, "stop", "a fourth refusing page must not be resumed");
assert.match(paced[3].stopReason, /not-converging/);
assert.match(paced[3].stopReason, /refusing/);
assert.equal(paced.length, 4, "the loop must stop at the cap, not run on");

/* ── 3 · the byte-identical answer is the spin, and it stops sooner than the cap ──────── */
const same = drive([failing(9), failing(9), failing(9), failing(9)]);
assert.equal(same.length, IDENTICAL_ANSWER_LIMIT, "three identical answers is the whole run");
assert.deepEqual(same.slice(0, 2).map((s) => s.action), ["resume", "resume"]);
assert.equal(same[2].action, "stop");
assert.match(same[2].stopReason, /not-converging/);
assert.match(same[2].stopReason, /byte-identically 3 times/);
// The rule is reason-agnostic: a `budget` answer that never moves is the same spin.
const sameBudget = drive([budget(9), budget(9), budget(9)]);
assert.equal(sameBudget[2].action, "stop");
assert.match(sameBudget[2].stopReason, /not-converging/);
// ... and two identical answers with a different one between them is NOT a spin.
const notASpin = drive([budget(9), budget(8), budget(9), done()]);
assert.deepEqual(notASpin.map((s) => s.action), ["resume", "resume", "resume", "done"]);

/* ── 4 · deletes-failed: resumed from its cursor exactly ONCE ─────────────────────────── */
const once = drive([failed(5), failed(6), failed(7)]);
assert.equal(once[0].action, "resume");
assert.equal(once[0].cursor, "page-5", "the resume must use the page where the failures started");
assert.equal(once[0].sleepMs, 0, "a reached-the-end sweep is not a refusing store - no back-off");
assert.equal(once[1].action, "stop", "the second `deletes-failed` is not new information");
assert.match(once[1].stopReason, /delete\(s\) did not land/);
assert.equal(once.length, 2);
// A `deletes-failed` whose retry SUCCEEDS drains cleanly.
assert.deepEqual(drive([failed(5), done()]).map((s) => s.action), ["resume", "done"]);
// The one allowed resume is spent even when the second stop has a different reason.
assert.deepEqual(drive([failed(5), budget(6), failed(7)]).map((s) => s.action), ["resume", "resume", "stop"]);

/* ── 5 · budget / pages keep the old behaviour: resume at once, no pause ──────────────── */
const healthy = drive([budget(1), { ...budget(2), reason: "pages" }, done()]);
assert.deepEqual(healthy.map((s) => s.action), ["resume", "resume", "done"]);
assert.deepEqual(healthy.slice(0, 2).map((s) => s.sleepMs), [0, 0]);

/* ── 6 · incomplete with no resumable cursor is a stop, never a drain ─────────────────── */
for (const bad of [null, "", 7, undefined]) {
  const s = decideSweepStep({ truncated: true, complete: false, reason: "budget", cursor: bad }, newDrainState());
  assert.equal(s.action, "stop", `cursor ${JSON.stringify(bad)} must not be resumable`);
  assert.match(s.stopReason, /NO resumable cursor/);
}

/* ── 7 · the signature distinguishes exactly what a resume can change ─────────────────── */
assert.equal(answerSignature(failing(1)), answerSignature({ ...failing(1), rows: [{ key: "x" }], budgetMs: 15000 }),
  "`rows` and `budgetMs` are not distinctions - they must not hide a spin");
assert.notEqual(answerSignature(failing(1)), answerSignature(failing(2)));
assert.notEqual(answerSignature(failing(1)), answerSignature({ ...failing(1), deleted: 1 }));
assert.notEqual(answerSignature(failing(1)), answerSignature({ ...failing(1), reason: "budget" }));

console.log("sweep drain decision: deletes-failing backs off and stops not-converging, deletes-failed resumes once, complete is read not derived");
