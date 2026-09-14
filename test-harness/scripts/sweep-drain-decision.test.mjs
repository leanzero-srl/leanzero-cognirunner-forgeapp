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
 * suite asserts the function the live drivers actually call, so the contract and its proof
 * have one home. Every case below is a REAL answer shape from `src/harness-fault.js`'s
 * return statement, not a convenient stand-in.
 *
 * F-702 — AND THE LOOP, NOT ONLY THE DECISION. Moving the decision here still left every
 * caller free to write its own loop around it, and `plant-sweep-live.mjs` did: a second home
 * for the contract, with a flat back-off, a deprecated `truncated` derivation and no spin
 * detection. `drainSweep` is now that loop, `harness-fault-expiry-live.mjs` and
 * `plant-sweep-live.mjs` both supply only the POST, and `evidence-redaction.test.mjs` holds
 * the directory rule that keeps the next driver inside it. §8 covers it.
 */
import assert from "node:assert/strict";
import {
  decideSweepStep, newDrainState, answerSignature, answerComplete, madeProgress, drainSweep,
  DELETES_FAILING_BACKOFF_MS, IDENTICAL_ANSWER_LIMIT,
  plantPopulation, resumeOf, PLANT_CLEARING_LIMIT, PLANT_CLEARING_PAUSE_MS,
  plantLedgerRow, leverFacts,
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

const failing = (n, failed = 3) => ({
  ok: true, dryRun: false, scanned: 100, deleted: 0, failed,
  truncated: true, reason: "deletes-failing", rowsTruncated: false,
  complete: false, cursor: "page-" + n,
});
/* A page that keeps refusing but does not answer byte-identically: same page, same zero
   deletes, a `failed` count that drifts. This — not a walk across different pages — is what
   "the store is refusing" looks like, and it is what the try cap exists to stop (F-703). */
const stuck = (failed) => failing(1, failed);
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

/* ── 2 · deletes-failing: paced back-off, capped on CONSECUTIVE non-progress ──────────── */
/* The cap fires on the SAME page refusing over and over. Distinct `failed` counts each time,
   so the byte-identical rule is NOT what stops it - the try cap is. */
const paced = drive([stuck(3), stuck(2), stuck(1), stuck(4)]);
assert.deepEqual(paced.slice(0, 3).map((s) => s.action), ["resume", "resume", "resume"]);
/* The LITERALS, not the constant. Comparing the steps against `DELETES_FAILING_BACKOFF_MS`
   alone is a tautology: setting the table to `[0, 0, 0]` — an unpaced hammer, which is the
   exact F-690 harm — still satisfies it. Mutation-checked by doing precisely that. */
assert.deepEqual(paced.slice(0, 3).map((s) => s.sleepMs), [500, 1000, 2000],
  "the first three `deletes-failing` resumes must sleep 500ms, 1s, 2s - the whole point of the reason");
assert.deepEqual(DELETES_FAILING_BACKOFF_MS, [500, 1000, 2000]);
assert.ok(DELETES_FAILING_BACKOFF_MS.every((ms) => ms > 0), "a back-off of zero is not a back-off");
assert.deepEqual(paced.slice(0, 3).map((s) => s.cursor), ["page-1", "page-1", "page-1"]);
assert.equal(paced[3].action, "stop", "a fourth refusal of the SAME page must not be resumed");
assert.match(paced[3].stopReason, /not-converging/);
assert.match(paced[3].stopReason, /refusing/);
/* The sentence may only claim what the answers contained: these three retries really were
   consecutive, really landed no delete and really never advanced. */
assert.match(paced[3].stopReason, /CONSECUTIVE/);
assert.match(paced[3].stopReason, /did not advance the cursor/);
assert.equal(paced.length, 4, "the loop must stop at the cap, not run on");

/* ── 2b · F-703 · A DRAIN THAT IS PROGRESSING IS NOT "not-converging" ─────────────────────
 * `failingTries` used to be per-DRAIN and never reset, so three refusing pages ANYWHERE in a
 * long drain exhausted it. THE BREAKER'S EXACT MEASURED SEQUENCE: three DIFFERENT refusing
 * pages with healthy deleting pages between them, fifteen rows deleted — it stopped as
 * `not-converging` and blamed "3 paced retries of a page", a cause the answers contradict. */
const progressing = [
  failing(1), budget(2), failing(3), budget(4), failing(5), budget(6), failing(7),
];
const walked = drive(progressing);
assert.equal(walked.length, progressing.length,
  "a drain deleting rows between refusing pages must consume every answer, not stop early");
assert.ok(walked.every((s) => s.action === "resume"),
  `every step of a progressing drain must resume (got ${JSON.stringify(walked.map((s) => s.action))})`);
assert.ok(walked.every((s) => s.stopReason === null), "and none of them may carry a stop reason");
/* Each refusing page is still PACED — the reset clears the cap, never the back-off. */
assert.deepEqual(walked.filter((s) => s.sleepMs > 0).map((s) => s.sleepMs), [500, 500, 500, 500],
  "each refusing page after a converging one starts the back-off afresh, and still pauses");
assert.deepEqual(walked.map((s) => s.cursor),
  ["page-1", "page-2", "page-3", "page-4", "page-5", "page-6", "page-7"]);

/* A DELETE resets the cap even on the SAME page: the store started answering again, so the
   two refusals before it are no longer "consecutive". `budget(1)` deletes 40 rows off the
   very page `stuck` refuses, which is why the cursor cannot be what clears it here. */
const recovered = drive([stuck(3), stuck(2), budget(1), stuck(1), stuck(2)]);
assert.equal(recovered.length, 5, "an answer that landed deletes clears the consecutive count");
assert.ok(recovered.every((s) => s.action === "resume"),
  `...so the two refusals that follow it are the first two of a fresh cap, not the fourth and fifth (got ${JSON.stringify(recovered.map((s) => s.action))})`);
/* ...and the reset is not infinite forgiveness: go quiet again for three consecutive
   non-progress answers on one page and it stops. */
const relapse = drive([stuck(3), budget(2), stuck(3), stuck(2), stuck(1), stuck(4)]);
assert.equal(relapse[relapse.length - 1].action, "stop", "three CONSECUTIVE refusals after a recovery still stop");
assert.match(relapse[relapse.length - 1].stopReason, /not-converging/);
assert.equal(relapse.length, 6);

/* The predicate itself, directly: deletes or a moved cursor, nothing else. */
assert.equal(madeProgress({ deleted: 0, cursor: "page-1" }, "page-1"), false, "the same page, nothing deleted, is not progress");
assert.equal(madeProgress({ deleted: 0, cursor: "page-2" }, "page-1"), true, "the cursor moved on");
assert.equal(madeProgress({ deleted: 5, cursor: "page-1" }, "page-1"), true, "rows actually left the store");
assert.equal(madeProgress({ deleted: 0, cursor: "page-1" }, null), false, "the first answer of a drain has moved off nothing");
assert.equal(madeProgress({ deleted: 0, cursor: null }, "page-1"), false, "a vanished cursor is not an advance");

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

/* ── 8 · F-702 · THE LOOP ITSELF, not just the decision ───────────────────────────────────
 * `plant-sweep-live.mjs` hand-rolled its drain beside this module and so had a SECOND copy
 * of the contract: flat 1 s back-off, finishedness re-derived from `truncated`, no spin
 * detection. The loop lives here now and both live drivers supply only the POST, so the same
 * refusing store cannot produce two different verdicts. These cases drive it with a scripted
 * server and an injected clock — no I/O, no real sleeping. */
const server = (answers) => {
  const seen = [];
  const post = async (cursor) => {
    seen.push(cursor);
    const next = answers[seen.length - 1];
    return next === undefined ? { status: 500, json: null } : { status: 200, json: next };
  };
  return { post, seen };
};
/** Collect the sleeps instead of taking them, so the pacing is asserted without the wait. */
const fakeClock = () => { const slept = []; return { slept, sleep: async (ms) => { slept.push(ms); } }; };

// A healthy multi-page drain: every page resumed at once, ending on the library's `complete`.
{
  const { post, seen } = server([budget(1), budget(2), done()]);
  const clock = fakeClock();
  const d = await drainSweep(post, { maxCalls: 10, sleep: clock.sleep });
  assert.equal(d.drained, true, "a sweep that answers complete is drained");
  assert.equal(d.calls, 3);
  assert.equal(d.stopReason, null);
  assert.equal(d.pausedMs, 0, "a healthy drain never pauses");
  assert.deepEqual(seen, [null, "page-1", "page-2"], "the first call carries no cursor, each resume carries the last one");
  assert.deepEqual(clock.slept, []);
}

// THE F-702 SCENARIO. A store refusing the same page: the old hand-rolled loop POSTed the
// identical token back ten times, 1 s apart, and failed with "still not complete after 10
// resume call(s)" — naming the harness's private bound instead of the cause.
{
  const { post, seen } = server(Array.from({ length: 12 }, () => failing(1)));
  const clock = fakeClock();
  const d = await drainSweep(post, { maxCalls: 11, sleep: clock.sleep });
  assert.equal(d.drained, false);
  assert.match(d.stopReason, /not-converging/, "the drain must name the CAUSE, not its own bound");
  assert.ok(d.calls <= IDENTICAL_ANSWER_LIMIT,
    `and it must stop at the spin detector, not at the bound (calls ${d.calls}, bound 11)`);
  assert.deepEqual(clock.slept, [500, 1000], "the resumes it did allow were PACED with the published back-off, never a flat 1 s");
  assert.equal(d.pausedMs, 1500);
  assert.ok(seen.every((c) => c === null || c === "page-1"));
}

// A driver may hand the loop a call it ALREADY made (plant-sweep judges call 1 itself). It is
// decided and counted exactly like any other, and it seeds the spin detector.
{
  const { post, seen } = server([budget(2), done()]);
  const d = await drainSweep(post, { maxCalls: 10, first: budget(1), sleep: fakeClock().sleep });
  assert.equal(d.drained, true);
  assert.equal(d.calls, 3, "the seeded answer is a CALL - it cost a web-trigger invocation");
  assert.deepEqual(seen, ["page-1", "page-2"], "the first POST resumes from the seeded answer's cursor");
}
// A seeded answer that is ALREADY complete must not cause a single further call.
{
  const { post, seen } = server([]);
  const d = await drainSweep(post, { maxCalls: 10, first: done() });
  assert.equal(d.drained, true);
  assert.equal(d.calls, 1);
  assert.deepEqual(seen, [], "nothing more is owed once the answer is complete");
}

// An HTTP failure is a stop that names the call, and the bound is a stop that names itself.
{
  const d = await drainSweep(async () => ({ status: 503, json: null }), { maxCalls: 5 });
  assert.equal(d.drained, false);
  assert.match(d.stopReason, /call 1 did not answer 200\/ok \(HTTP 503\)/);
  assert.equal(d.calls, 1, "a refusing door is not retried by the drain");
}
{
  // Distinct pages, each landing deletes: legitimately progressing, so only the bound stops it.
  const { post } = server(Array.from({ length: 20 }, (_, i) => budget(i + 1)));
  const d = await drainSweep(post, { maxCalls: 4, sleep: fakeClock().sleep });
  assert.equal(d.drained, false);
  assert.equal(d.calls, 4);
  assert.match(d.stopReason, /after the 4-call bound/);
}
// `ok: false` in a 200 body is not a usable answer either.
{
  const d = await drainSweep(async () => ({ status: 200, json: { ok: false, reason: "forbidden" } }), { maxCalls: 3 });
  assert.equal(d.drained, false);
  assert.match(d.stopReason, /did not answer 200\/ok/);
}

/* ── §9. F-724 — `reason:"clearing"` IS AN IDENTICAL RE-POST, NOT A STALLED POPULATION ──
 *
 * The answer shapes below are `src/harness-fault.js`'s own, verbatim from its return
 * statements: a stale-tail clear that ran out of budget answers `planted:0` with
 * `nextIndex === startIndex` and `reason:"clearing"`, whose documented contract is "POST me
 * again, unchanged". Both live drivers used to read that non-advancing `nextIndex` as proof
 * the population was unreachable and FAIL — on a tenant where one more identical POST would
 * have finished the clear and planted. These fixtures are the recorded sequence.
 */
{
  /** The answer a budget-bound stale-tail clear gives. `nextIndex` is the index it was given. */
  const clearing = (startIndex, cleared) => ({
    ok: true, planted: 0, failed: 0, n: 60, startIndex, nextIndex: startIndex,
    cleared, truncated: true, reason: "clearing", complete: false, budgetMs: 15000,
  });
  /** A normal plant call that lands rows. */
  const planted = (startIndex, count) => ({
    ok: true, planted: count, failed: 0, n: 60, startIndex, nextIndex: startIndex + count,
    cleared: 0, truncated: false, reason: null, complete: true, budgetMs: 15000,
  });

  /* THE WHOLE POINT: two clearing answers, then the plant. The loop must re-POST the SAME
     startIndex — not advance, not stop — and the run must succeed. */
  {
    const seen = [];
    const answers = [clearing(0, 90), clearing(0, 90), planted(0, 60)];
    const r = await plantPopulation(async (n, startIndex) => {
      seen.push(startIndex);
      return { status: 200, json: answers[seen.length - 1] };
    }, 60, { sleep: async () => {} });
    assert.equal(r.planted, true, r.stopReason || "");
    assert.equal(r.stopReason, null);
    assert.deepEqual(seen, [0, 0, 0], "a `clearing` answer is re-POSTed with the SAME startIndex — that is the contract");
    assert.equal(r.totalPlanted, 60);
    assert.equal(r.clearingCalls, 2);
    assert.equal(r.totalCleared, 180, "the stale rows each call cleared are carried into the ledger");
    assert.equal(r.pausedMs, PLANT_CLEARING_PAUSE_MS * 2, "each identical re-POST is paced — the clear does not finish sooner for being asked sooner");
  }

  /* THE PRE-FIX BEHAVIOUR, AS A NEGATIVE CONTROL. Without the `clearing` branch the very
     first answer trips the advancing-`nextIndex` test, which is the F-724 failure verbatim. */
  {
    const r = await plantPopulation(async () => ({ status: 200, json: clearing(0, 90) }), 60, {
      sleep: async () => {}, clearingLimit: 0,
    });
    assert.equal(r.planted, false);
    assert.match(r.stopReason, /answered resume:"repost" \(reason:"clearing"\) for the 1th time in a row/);
    assert.equal(r.calls.length, 1, "clearingLimit:0 spends exactly one call — the bound is honoured at zero too");
  }

  /* A CLEAR THAT NEVER FINISHES IS STILL A STOP, with its OWN sentence — never the generic
     "no advancing nextIndex" one, which would assert a cause the answers do not contain. */
  {
    const r = await plantPopulation(async () => ({ status: 200, json: clearing(0, 3) }), 60, {
      sleep: async () => {}, maxCalls: 20,
    });
    assert.equal(r.planted, false);
    assert.match(r.stopReason, /resume:"repost" \(reason:"clearing"\) for the 5th time in a row/);
    assert.doesNotMatch(r.stopReason, /no advancing nextIndex/);
    assert.equal(r.calls.length, PLANT_CLEARING_LIMIT + 1);
  }

  /* THE RUN COUNTS CONSECUTIVELY. A clear that finishes, a page that lands, then another
     fresh clear later must not inherit the earlier run's count — the same reasoning F-703
     applied to `failingTries` on the drain side. */
  {
    const answers = [clearing(0, 90), planted(0, 30), clearing(30, 5), clearing(30, 5), clearing(30, 5), planted(30, 30)];
    let i = 0;
    const r = await plantPopulation(async () => ({ status: 200, json: answers[i++] }), 60, {
      sleep: async () => {}, clearingLimit: 3, maxCalls: 10,
    });
    assert.equal(r.planted, true, r.stopReason || "");
    assert.equal(r.totalPlanted, 60);
    assert.equal(r.clearingCalls, 4, "every clearing answer is counted for the ledger…");
  }

  /* AND THE OTHER TWO TRAPS STILL BITE. `writes-failed` is a FAILURE, never a resume, and a
     silent clamp is an OBSERVATION rather than a failure (F-710). */
  {
    const r = await plantPopulation(async () => ({
      status: 200,
      json: { ok: true, planted: 4, failed: 11, n: 60, startIndex: 0, nextIndex: 15, reason: "writes-failed", complete: false },
    }), 60, { sleep: async () => {} });
    assert.equal(r.planted, false);
    assert.match(r.stopReason, /reason:"writes-failed"/);
    assert.equal(r.calls.length, 1);
  }
  {
    let i = 0;
    const r = await plantPopulation(async () => {
      i++;
      return i === 1
        ? { status: 200, json: { ok: true, planted: 150, failed: 0, n: 150, startIndex: 0, nextIndex: 150, reason: null, complete: true } }
        : { status: 200, json: { ok: true, planted: 50, failed: 0, n: 200, startIndex: 150, nextIndex: 200, reason: null, complete: true } };
    }, 200, { sleep: async () => {} });
    assert.equal(r.planted, true);
    assert.deepEqual(r.clamped, { requested: 200, answered: 150, nextIndex: 150, complete: true });
    assert.equal(r.totalPlanted, 200, "`complete:true` is not `the population exists` — the loop counts ROWS");
  }
  /* A non-200 or `ok:false` plant answer is not a usable answer, exactly as on the drain side. */
  {
    const r = await plantPopulation(async () => ({ status: 200, json: { ok: false, reason: "bad-start" } }), 60, { sleep: async () => {} });
    assert.equal(r.planted, false);
    assert.match(r.stopReason, /did not answer 200\/ok/);
  }

  /* ══ F-748 — THE ANSWER'S OWN `resume` DECIDES, AND THE REASON LIST IS ONLY FOR AGE ══
     Everything above is a PRE-F-724 answer: none of those fixtures carry `resume`, so they
     exercise the legacy fallback and prove it still reads them. What follows is the shape
     `src/harness-fault.js` actually emits today. */

  /* THE FINDING ITSELF. `clear-failed` is in the producer's repost vocabulary and was NOT in
     this loop's `reason === "clearing"` test, so a stale clear that refused some deletes was
     read as a non-advancing answer and aborted the plant — the exact abort F-724 was cut to
     remove, arriving for the second reason. RECORDED ANSWER, from the producer's own shape. */
  {
    const clearFailed = (startIndex, cleared, staleFailed, clearToken) => ({
      ok: true, planted: 0, failed: 0, staleFailed, n: 60, startIndex, nextIndex: startIndex,
      cleared, remainingStale: 12, clearToken, truncated: false,
      reason: "clear-failed", complete: false, resume: "repost", budgetMs: 15000,
    });
    const seen = [];
    const answers = [clearFailed(0, 40, 3, "tok-1"), clearFailed(0, 12, 1, "tok-2"), planted(0, 60)];
    const r = await plantPopulation(async (n, startIndex, clearToken) => {
      seen.push({ startIndex, clearToken });
      return { status: 200, json: answers[seen.length - 1] };
    }, 60, { sleep: async () => {} });
    assert.equal(r.planted, true, r.stopReason || "");
    assert.equal(r.stopReason, null, "a `clear-failed, resume:repost` answer is RE-POSTED, not treated as a dead end (F-748)");
    assert.deepEqual(seen.map((x) => x.startIndex), [0, 0, 0], "…with the SAME startIndex, because a repost must be identical");
    /* F-744 — and the clearToken is forwarded verbatim, so `clearedSoFar` keeps running. */
    assert.deepEqual(seen.map((x) => x.clearToken), [null, "tok-1", "tok-2"],
      "…and each answer's clearToken rides the NEXT identical POST (F-744) — without it the running clearedSoFar restarts");
    assert.equal(r.clearingCalls, 2);
    assert.equal(r.totalStaleFailed, 4, "F-747: the CLEAR's refusals are counted under their own name, not folded into `failed`");
    assert.equal(r.totalFailed, 0, "…and `failed` stays the WRITES count, which a repost answer never has any of");
  }

  /* `resume:"stop"` IS A STOP WHATEVER THE REASON IS. F-745 gave `writes-failed` this mode
     precisely because its `nextIndex` does NOT advance, so the old `start-index` reading was
     an instruction to spin. The loop must not need to know the reason to obey it. */
  {
    const r = await plantPopulation(async () => ({
      status: 200,
      json: { ok: true, planted: 0, failed: 5, n: 5, startIndex: 0, nextIndex: 0, reason: "writes-failed", complete: false, resume: "stop" },
    }), 5, { sleep: async () => {} });
    assert.equal(r.planted, false);
    assert.match(r.stopReason, /resume:"stop"/);
    assert.match(r.stopReason, /not resumable/);
    assert.equal(r.calls.length, 1, "a stop is obeyed on the first answer — it does not spend the call bound discovering it");
  }

  /* A RESUME MODE THIS LOOP DOES NOT KNOW IS A STOP, NEVER A GUESS. The vocabulary belongs to
     the producer and is allowed to grow; treating an unrecognised instruction as "carry on"
     would be inventing a meaning for it, and every way of getting this wrong either spins or
     asserts over a short population. */
  {
    const r = await plantPopulation(async () => ({
      status: 200,
      json: { ok: true, planted: 0, failed: 0, n: 60, startIndex: 0, nextIndex: 0, reason: "some-new-thing", complete: false, resume: "reshard" },
    }), 60, { sleep: async () => {} });
    assert.equal(r.planted, false);
    assert.match(r.stopReason, /does not know how to obey/);
    assert.equal(r.calls.length, 1);
  }

  /* `resume` WINS OVER THE REASON, which is the whole point of having the field. A `clearing`
     reason carrying `resume:"stop"` must STOP — if the legacy list could override the field,
     the contract would still have two homes and this loop would still be guessing. */
  {
    const r = await plantPopulation(async () => ({
      status: 200,
      json: { ok: true, planted: 0, failed: 0, n: 60, startIndex: 0, nextIndex: 0, reason: "clearing", complete: false, resume: "stop" },
    }), 60, { sleep: async () => {} });
    assert.equal(r.planted, false);
    assert.match(r.stopReason, /resume:"stop"/);
    assert.equal(r.clearingCalls, 0, "the legacy reason list is NOT a second opinion — when `resume` is present it decides alone");
  }

  /* `resume: null` IS NOT "THE POPULATION IS DONE". It is the answer for a call that ended
     cleanly, and the door clamps `n` per call — so a 200-row population arrives as two
     complete answers and the loop must advance through them. This is the F-710 clamp case
     again, now with the field present. */
  {
    let i = 0;
    const r = await plantPopulation(async () => ({
      status: 200,
      json: i++ === 0
        ? { ok: true, planted: 150, failed: 0, n: 150, startIndex: 0, nextIndex: 150, reason: null, complete: true, resume: null }
        : { ok: true, planted: 50, failed: 0, n: 200, startIndex: 150, nextIndex: 200, reason: null, complete: true, resume: null },
    }), 200, { sleep: async () => {} });
    assert.equal(r.planted, true, r.stopReason || "");
    assert.equal(r.totalPlanted, 200, "a COMPLETE call is not a COMPLETE population — the loop counts ROWS, with `resume:null` as with none");
  }

  /* AND A `start-index` THAT DOES NOT MOVE IS STOPPED HERE TOO. F-745 made the producer refuse
     to say it; this is the consumer-side assertion that it did not, so a regression on that
     side becomes a named stop rather than a spin to the call bound. */
  {
    const r = await plantPopulation(async () => ({
      status: 200,
      json: { ok: true, planted: 0, failed: 0, n: 60, startIndex: 0, nextIndex: 0, reason: "truncated", complete: false, resume: "start-index" },
    }), 60, { sleep: async () => {} });
    assert.equal(r.planted, false);
    assert.match(r.stopReason, /does not advance past 0/);
    assert.equal(r.calls.length, 1, "it is caught on the first answer, not after ten identical ones");
  }

  /* THE FALLBACK IS REACHABLE AND CORRECT, asserted directly rather than inferred from the
     fixtures above — `resumeOf` is the one place the two vocabularies meet. */
  assert.equal(resumeOf({ reason: "clear-failed", complete: false }), "repost",
    "F-748: a pre-F-724 `clear-failed` answer reads as a repost — the reason the driver half missed");
  assert.equal(resumeOf({ reason: "clearing", complete: false }), "repost");
  assert.equal(resumeOf({ reason: "writes-failed", complete: false }), "stop");
  assert.equal(resumeOf({ reason: "truncated", complete: false }), "start-index");
  assert.equal(resumeOf({ reason: null, complete: true }), null);
  assert.equal(resumeOf({ reason: "clearing", complete: false, resume: "stop" }), "stop",
    "…and a PRESENT `resume` is never overruled by the legacy list");
  assert.equal(resumeOf({ reason: "writes-failed", complete: false, resume: null }), null,
    "…including when it is explicitly null");
}

/* ── F-761 — THE LEDGER ROW CARRIES THE FIELDS THE LOOP BRANCHED ON ────────────────
 * `plant-sweep-live.mjs` recorded a hand-copied row that had neither `resume` nor
 * `clearedSoFar`, so a plant that resumed through a STALE-TAIL clear left an evidence file
 * identical to one that resumed on a start index — and F-744's cumulative count, the whole
 * reason `clearToken` exists, was unfalsifiable in every live run. The row builder is the
 * library's now, and this is the test that the fields land in the shape a reader gets.
 *
 * It is driven through `plantPopulation` rather than by calling the builder on a literal,
 * because the claim is about the EVIDENCE a real trail produces: a builder that is correct
 * on a hand-written object and never reached by the loop would pass a unit test and record
 * nothing. */
{
  const clearing = (cleared, clearedSoFar, remainingStale, staleFailed, clearToken) => ({
    ok: true, planted: 0, failed: 0, staleFailed, n: 5, startIndex: 0, nextIndex: 0,
    cleared, clearedSoFar, remainingStale, clearToken, expired: true, keys: [],
    truncated: true, reason: "clear-failed", complete: false, resume: "repost",
    ttlSeconds: 300, budgetMs: 15000,
  });
  const done = { ok: true, planted: 5, failed: 0, n: 5, startIndex: 0, nextIndex: 5, cleared: 0, expired: true, keys: ["a", "b", "c", "d", "e"], truncated: false, reason: null, complete: true, resume: null, ttlSeconds: 300, budgetMs: 15000 };
  const answers = [clearing(40, 40, 12, 3, "tok-1"), clearing(12, 52, 0, 1, "tok-2"), done];
  let i = 0;
  const r = await plantPopulation(async () => ({ status: 200, json: answers[i++] }), 5, { sleep: async () => {} });
  assert.equal(r.planted, true, r.stopReason || "");
  assert.equal(r.calls.length, 3);

  const [c1, c2, c3] = r.calls;
  /* THE TWO FIELDS THE OLD ROW OMITTED, on the calls that have them. */
  assert.deepEqual(r.calls.map((c) => c.resume), ["repost", "repost", null],
    "`resume` is in the ledger, so a stale-tail resume is distinguishable from a start-index one (F-761)");
  assert.deepEqual([c1.clearedSoFar, c2.clearedSoFar], [40, 52],
    "`clearedSoFar` is recorded per call and RISES across identical re-POSTs — the F-744 carry, now visible in the evidence");
  assert.deepEqual([c1.remainingStale, c2.remainingStale], [12, 0],
    "`remainingStale` is recorded, which is the progress a non-advancing nextIndex cannot show");
  assert.deepEqual([c1.staleFailed, c2.staleFailed], [3, 1],
    "`staleFailed` is recorded under its own name (F-747), never folded into `failed`");

  /* THE TOKEN IS A BOOLEAN AND NEVER ITS VALUE: it is base64 that may encode a KVS cursor,
     and the keys in this keyspace carry faulted paths. Presence is the whole assertion. */
  assert.deepEqual(r.calls.map((c) => c.clearTokenPresent), [true, true, false],
    "`clearTokenPresent` is a BOOLEAN — an answer that asks for a re-POST must hand a token back, and the token itself never enters the evidence");
  const serialised = JSON.stringify(r.calls);
  assert.ok(!serialised.includes("tok-1") && !serialised.includes("tok-2"),
    "…and the token VALUE appears nowhere in the serialised ledger");

  /* A pre-F-724 answer carries no `resume` at all. The row must record the mode the loop
     OBEYED, not `undefined` — otherwise the one shape where the fallback is load-bearing is
     the one shape the evidence cannot describe. */
  const legacy = plantLedgerRow({ ok: true, planted: 0, n: 5, startIndex: 0, nextIndex: 0, reason: "clearing", complete: false }, 9);
  assert.equal(legacy.resume, "repost", "a legacy answer with no `resume` is recorded as the mode resumeOf READ from its reason");
  assert.equal(legacy.clearedSoFar, null, "…and a field the answer does not carry is null, not undefined — an absent key would vanish from the JSON");
  assert.equal(legacy.clearTokenPresent, false, "…and no token is no token");

  /* THE NULL-SAFETY THAT KEEPS THE ROW A ROW. A malformed answer must not throw inside the
     ledger: the loop's own stop reasons are the diagnosis, and a builder that throws would
     replace a named stop with a stack trace. */
  const empty = plantLedgerRow({}, 1);
  assert.equal(empty.call, 1);
  assert.equal(empty.resume, null);
  assert.equal(empty.clearTokenPresent, false);
}

console.log("F-761: the plant ledger row records `resume`, `clearedSoFar`, `remainingStale` and `staleFailed`, and the clearToken as a boolean only — so a stale-tail resume is legible in the evidence and the F-744 carry is falsifiable live");


/* ─────────────────────────────────────────────────────────────────────────────
 * §10 · F-772 — THE LEVER READER READS THE *READ* ANSWER, AND REFUSES THE ARM'S.
 *
 * `leverFacts` is the one reader of `readDeleteFault` for both live drivers. It used to
 * exist twice, and the second copy — in `plant-sweep-live.mjs` — parsed the READ answer in
 * the ARM answer's FLAT shape. The consequences were one of each kind of lie: the `--stale`
 * arm's positive control FAILED on every tenant (armed came back undefined), and its
 * "the lever is spent" step PASSED on every tenant (count came back undefined, and
 * `Number(undefined || 0) === 0`).
 *
 * So the assertions below are in two halves, and the SECOND half is the one that matters:
 * the flat arm shape must NOT be readable as an armed lever. A reader that merely accepts
 * the nested shape would still have accepted the old driver's bug.
 *
 * Both fixtures are the real return values: the read is `readHarnessFault`
 * (`src/harness-fault.js`, `{ key, value, until, expired }`) spread under the hook's
 * `{ ok: true, prefix }`; the arm is `armDeleteFault`'s flat literal under the same.
 * ───────────────────────────────────────────────────────────────────────────── */
{
  /* THE RECORDED READ SHAPE. `value.armedAt` is carried by the real row and is deliberately
     NOT a recorded fact; `until` is TOP-LEVEL, which is where both real answers put it. */
  const armedRead = leverFacts({
    ok: true, prefix: "harness_fault:plant:",
    key: "harness_fault:delete:harness_fault:plant:",
    value: { count: 5, mode: "refuse", armedAt: "2026-09-14T11:00:00.000Z" },
    until: "2026-09-14T11:05:00.000Z", expired: false,
  });
  assert.equal(armedRead.armed, true, "F-772: the recorded READ shape reads as ARMED");
  assert.equal(armedRead.count, 5, "F-772: …with the count from `value.count`, which is the only place the read answer carries it");
  assert.equal(armedRead.mode, "refuse", "F-772: …and the mode from `value.mode`");
  assert.equal(armedRead.until, "2026-09-14T11:05:00.000Z",
    "F-772: `until` is read TOP-LEVEL — `setFaultRow` stores {mode,count,armedAt} and computes the window outside the row, so a `value.until`-only reader reports null on every live run");
  assert.equal(armedRead.expired, false, "F-772: `expired` is the read answer's own top-level judgement (F-664)");
  assert.ok(!JSON.stringify(armedRead).includes("harness_fault:delete:"),
    "F-772: the lever's KEY never enters the recorded facts — it names the prefix the lever guards");

  /* THE MINIMAL FORM THE FINDING NAMES: value present, count 5, mode refuse -> armed. */
  const minimal = leverFacts({ ok: true, value: { count: 5, mode: "refuse" } });
  assert.equal(minimal.armed, true, "F-772: `{ok:true, value:{count:5, mode:'refuse'}}` reads as armed");
  assert.equal(minimal.count, 5, "F-772: …count 5");

  /* ── THE HALF THAT CATCHES THE BUG. The ARM answer is flat, and it is NOT a read. A
     reader that accepted it would report a lever armed when it had read nothing about one,
     which is exactly the direction a positive control must never fail in. */
  const armAnswer = leverFacts({
    ok: true, key: "harness_fault:delete:harness_fault:plant:", prefix: "harness_fault:plant:",
    mode: "refuse", count: 5, ttlSeconds: 300, until: "2026-09-14T11:05:00.000Z",
    modes: ["refuse"], maxCount: 11, maxTtlSeconds: 300,
  });
  assert.equal(armAnswer.armed, false,
    "F-772: the flat ARM answer is NOT accepted as a read — `armed` keys off `value`, which an arm answer does not have");
  assert.equal(armAnswer.count, 0,
    "F-772: …and its top-level `count` is NOT harvested: a reader that took it would let step 2 pass on an answer that says nothing about the stored row");
  assert.equal(armAnswer.mode, null, "F-772: …nor its top-level `mode`");

  /* AND THE STEP-6 DIRECTION. A spent or expired lever answers `value: null`, and the
     driver's "spent" test is `count === 0` — which must be reached through a real read. */
  const spent = leverFacts({ ok: true, prefix: "harness_fault:plant:", value: null, until: null, expired: false });
  assert.equal(spent.armed, false, "F-772: a spent lever (`value:null`) is not armed");
  assert.equal(spent.count, 0, "F-772: …and counts 0, which is what step 6 asserts on");
  const expiredRead = leverFacts({ ok: true, prefix: "harness_fault:plant:", value: null, expired: true });
  assert.equal(expiredRead.armed, false, "F-772: an EXPIRED row is answered absent (F-664 deletes it on the way out), so unreadable and unarmed are one answer");
  assert.equal(expiredRead.expired, true, "F-772: …but the expiry is reported rather than swallowed, so a driver knows its window ended on its own");

  /* NULL-SAFETY: a harness-off or malformed answer must not throw inside the evidence. */
  const off = leverFacts({});
  assert.equal(off.armed, false, "F-772: an empty answer is not armed");
  assert.equal(off.count, 0);
  assert.equal(off.ok, null, "F-772: …and absent fields are null, not undefined — an absent key would vanish from the JSON");
  assert.equal(leverFacts(undefined).armed, false, "F-772: even `undefined` answers unarmed rather than throwing");
}

console.log("F-772: `leverFacts` has ONE home and reads the readDeleteFault answer's NESTED shape — the flat ARM answer is refused as a read, so the plant-sweep --stale positive control cannot silently fail nor its 'lever is spent' step silently pass");

console.log("sweep drain decision: deletes-failing backs off and stops not-converging on CONSECUTIVE non-progress (F-703), a progressing drain continues, deletes-failed resumes once, complete is read not derived, and drainSweep is the one loop both live drivers obey (F-702); plantPopulation re-POSTs a `clearing` answer UNCHANGED and bounded, so a stale-tail clear no longer fails a run the tenant would have completed (F-724); and it now obeys the answer's own `resume` — repost/start-index/stop — forwarding the clearToken, so `clear-failed` is a re-POST and an unknown mode is a stop (F-744/F-745/F-747/F-748)");
