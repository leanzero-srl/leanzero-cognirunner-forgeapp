/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */
/* ═══════════════════════════════════════════════════════════════════════════════
 * THE DRAIN LOOP'S DECISION, IN ONE PLACE — F-690.
 *
 * `sweepHarnessFaults` answers a PAGE, never the keyspace, and every caller that wants a
 * whole-keyspace verdict has to resume on the returned `cursor`. F-682 added the reason
 * `deletes-failing` — truncated, with THIS page's own cursor — precisely so that a caller
 * could tell "there is more to do" from "I am not converging". F-690 is that the contract
 * existed only in the offline test's hand-written loop: `drainSweep`, the ONLY real caller,
 * broke solely on `truncated !== true`, so a `deletes-failing` answer was POSTed straight
 * back, unpaced, up to its private 20-call bound — twenty web-trigger invocations, twenty
 * full KVS queries and sixty rejected deletes hammering a store that is already refusing.
 * The bound was the harness's, not the contract's; an unbounded `while (cursor)` caller,
 * which `src/harness-fault.js`'s own docblock still invites, never stopped at all.
 *
 * So the decision is now a PURE FUNCTION with no I/O, unit-tested offline against all three
 * reasons, and the live driver is the dumb loop that obeys it. One rule, one home (LAW 1):
 * `harness-fault-ttl.test.mjs` asserted a loop that existed nowhere in production, which is
 * the same defect one layer up.
 *
 * THE ANSWERS AND WHAT EACH EARNS:
 *   · `deletes-failing` — nothing landed on this page. PAUSE with exponential back-off
 *     (500 ms, 1 s, 2 s) and resume, at most `DELETES_FAILING_BACKOFF_MS.length` times
 *     CONSECUTIVELY. A store that refuses three paced retries OF A PAGE THAT NEVER MOVES is
 *     not going to answer the fourth, and the stop says `not-converging` rather than the
 *     driver's generic "bound".
 *
 *     F-703 — THE CAP COUNTS CONSECUTIVE NON-PROGRESS, NOT LIFETIME REFUSALS. `failingTries`
 *     used to be a per-DRAIN counter that only ever incremented, so three `deletes-failing`
 *     pages ANYWHERE in a long drain — with healthy deleting pages between them — exhausted
 *     it and stopped a demonstrably converging sweep. Measured: `deletes-failing(p1)`,
 *     `budget(deleted:5,p2)`, `deletes-failing(p3)`, `budget(deleted:5,p4)`,
 *     `deletes-failing(p5)`, `budget(deleted:5,p6)`, `deletes-failing(p7)` stopped as
 *     `not-converging` after FIFTEEN rows had been deleted across three DIFFERENT refusing
 *     pages — and the stop sentence asserted "3 paced retries of a page all landed no
 *     delete", a cause the answers contradict (LAW: never assert a cause the result did not
 *     contain). The counter now RESETS on any answer that made progress, where progress is
 *     `deleted > 0` OR a cursor that moved off the page the last answer named. What remains
 *     capped is the real refusal: the SAME page, answered three times, landing nothing.
 *
 *     Why the cursor counts as progress: a refusing page answers with ITS OWN cursor
 *     (F-682), so a genuine "the store is refusing" spin re-presents the identical token and
 *     the cap still fires. A cursor that MOVED means the sweep walked on, which is the
 *     "legitimately progressing" case the back-off was never meant to kill. When the whole
 *     answer repeats byte for byte, `IDENTICAL_ANSWER_LIMIT` fires first and independently.
 *   · the SAME ANSWER `IDENTICAL_ANSWER_LIMIT` times — byte-identical counters, reason and
 *     cursor — is the spin itself, made visible. It stops immediately with `not-converging`
 *     whatever the reason was, because a loop whose answer never changes cannot converge by
 *     being run again.
 *   · `deletes-failed` — the sweep REACHED the end of the keyspace but some delete did not
 *     land, and the cursor points at the page where the failures started. That is worth
 *     exactly ONE resume: the retry either clears the mess or answers the same thing, and
 *     the second identical answer is not new information.
 *   · anything else (`budget`, `pages`) — a healthy partial sweep. Resume at once, no pause.
 *
 * FINISHEDNESS IS READ, NOT RE-DERIVED (F-692 prep). `complete` is the library's single
 * source for "the whole keyspace was walked and every delete landed". This function reads it
 * when the answer carries it and only falls back to `truncated !== true` for an answer from a
 * build that predates it, so the driver's verdict cannot silently diverge from the library's.
 */

/** The pause before each `deletes-failing` resume. Its LENGTH is also the try cap. */
export const DELETES_FAILING_BACKOFF_MS = [500, 1000, 2000];

/** How many byte-identical answers in a row prove the loop is not converging. */
export const IDENTICAL_ANSWER_LIMIT = 3;

/**
 * The bytes a resume can possibly change. Two answers that agree on ALL of these have moved
 * nothing: the same page, the same counters, the same stop and the same resume token.
 * `rows` is deliberately excluded — it is derived from the same page and can be capped, so
 * it adds noise without adding a distinction.
 */
export const answerSignature = (j) => JSON.stringify({
  scanned: j?.scanned ?? null,
  deleted: j?.deleted ?? null,
  failed: j?.failed ?? null,
  truncated: j?.truncated ?? null,
  reason: j?.reason ?? null,
  rowsTruncated: j?.rowsTruncated ?? null,
  complete: j?.complete ?? null,
  cursor: typeof j?.cursor === "string" ? j.cursor : null,
});

/** The loop's carried state. Held by the caller, threaded through `decideSweepStep`. */
export const newDrainState = () => ({
  lastSignature: null,
  identical: 0,
  /* CONSECUTIVE non-progress `deletes-failing` answers (F-703). Reset by `madeProgress`. */
  failingTries: 0,
  /* The cursor the PREVIOUS answer carried, so "the page moved" is answerable (F-703). */
  lastCursor: null,
  resumedAfterFailed: false,
});

/**
 * Is this answer finished? `complete` when the answer carries it (the library's single
 * source), the legacy derivation only when it does not.
 */
export const answerComplete = (j) =>
  (typeof j?.complete === "boolean" ? j.complete : j?.truncated !== true);

/**
 * DID THIS ANSWER MOVE ANYTHING? (F-703) — the predicate that resets the back-off cap.
 *
 * Progress is either row(s) actually deleted, or a resume token that no longer names the page
 * the previous answer named. `prevCursor === null` is the FIRST answer of a drain, which
 * cannot have moved off anything and is treated as non-progress; the cap is zero there
 * anyway, so the distinction only matters for clarity.
 */
export const madeProgress = (answer, prevCursor) => {
  if (Number(answer?.deleted || 0) > 0) return true;
  const cursor = typeof answer?.cursor === "string" && answer.cursor ? answer.cursor : null;
  return prevCursor !== null && cursor !== null && cursor !== prevCursor;
};

/**
 * ONE STEP of the drain loop, decided from the answer and the carried state.
 *
 * @returns {{action: "done"|"resume"|"stop", sleepMs: number, cursor: string|null,
 *            stopReason: string|null, state: object}}
 *   `action:"done"`   — the answer is complete; its counters describe the whole keyspace.
 *   `action:"resume"` — POST `cursor` back after `sleepMs`.
 *   `action:"stop"`   — give up; `stopReason` is the sentence a verdict can name.
 */
export function decideSweepStep(answer, state) {
  const prev = state || newDrainState();
  const signature = answerSignature(answer);
  const identical = signature === prev.lastSignature ? prev.identical + 1 : 1;
  const next = { ...prev, lastSignature: signature, identical };
  const stop = (stopReason) => ({ action: "stop", sleepMs: 0, cursor: null, stopReason, state: next });
  const reason = answer?.reason ?? null;

  /* F-703 — the back-off cap counts CONSECUTIVE non-progress answers, so an answer that
     deleted something or walked on to another page clears it. Computed before every branch
     (progress is progress whatever the reason) and recorded for the next step's comparison. */
  const progressed = madeProgress(answer, prev.lastCursor);
  const failingTries = progressed ? 0 : prev.failingTries;
  next.failingTries = failingTries;
  next.lastCursor = typeof answer?.cursor === "string" && answer.cursor ? answer.cursor : null;

  if (answerComplete(answer)) {
    return { action: "done", sleepMs: 0, cursor: null, stopReason: null, state: next };
  }

  const cursor = typeof answer?.cursor === "string" && answer.cursor ? answer.cursor : null;
  if (!cursor) {
    return stop(`the sweep answered incomplete (reason "${reason}") with NO resumable cursor — the remaining rows are unreachable and their state unknown`);
  }

  /* THE SPIN, NAMED. Checked before the per-reason branches so it covers `budget` and
     `pages` too: any answer that repeats itself byte for byte is the same page coming back. */
  if (identical >= IDENTICAL_ANSWER_LIMIT) {
    return stop(`not-converging: the sweep answered byte-identically ${identical} times in a row (reason "${reason}", deleted:${answer?.deleted ?? null}, failed:${answer?.failed ?? null}) — resuming it again cannot change the answer`);
  }

  if (reason === "deletes-failing") {
    if (failingTries >= DELETES_FAILING_BACKOFF_MS.length) {
      return stop(`not-converging: ${failingTries} CONSECUTIVE paced retries of the same "deletes-failing" page all landed no delete and did not advance the cursor (failed:${answer?.failed ?? null}) — the store is refusing and further resumes only double the load on it`);
    }
    next.failingTries = failingTries + 1;
    return {
      action: "resume",
      sleepMs: DELETES_FAILING_BACKOFF_MS[next.failingTries - 1],
      cursor, stopReason: null, state: next,
    };
  }

  if (reason === "deletes-failed") {
    if (prev.resumedAfterFailed) {
      return stop(`the sweep reached the end of the keyspace but ${answer?.failed ?? "some"} delete(s) did not land, and the one resume from that page did not clear them`);
    }
    next.resumedAfterFailed = true;
    return { action: "resume", sleepMs: 0, cursor, stopReason: null, state: next };
  }

  return { action: "resume", sleepMs: 0, cursor, stopReason: null, state: next };
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * THE DRAIN LOOP ITSELF — F-702. ONE HOME FOR THE I/O TOO, NOT JUST THE DECISION.
 *
 * F-690 moved the DECISION here and left every caller to write its own loop around it. That
 * was enough for exactly one driver: `plant-sweep-live.mjs` landed in the SAME range with a
 * hand-rolled loop that never imported this module — so the contract had two homes again,
 * and `decideSweepStep` had a single caller. The hand-rolled copy re-derived finishedness
 * from `truncated` (the derivation F-692 deprecates), backed off a flat 1 s instead of
 * 500/1000/2000, had no byte-identical detection and no `deletes-failed`-resumed-once rule,
 * so the SAME refusing store produced "still not complete after 10 resume call(s)" in one
 * driver and a named `not-converging` in the other.
 *
 * So the loop is here as well, and a driver supplies only the POST. Finishedness is READ
 * from the answer's `complete` (via `answerComplete`) and never re-derived at a call site;
 * `evidence-redaction.test.mjs` enforces that as a directory rule over `scripts/*-live.mjs`.
 *
 * @param post   (cursor) => Promise<{status, json}> — one sweep call. `cursor` is null on the
 *               first call and the resume token thereafter.
 * @param opts.maxCalls  the bound; a drain needing more is a finding, not a retry.
 * @param opts.first     an answer ALREADY received (a driver that judged call 1 itself), so
 *                       it is decided and counted exactly like any other.
 * @param opts.onAnswer  (json, callNumber) => void — the driver's own accounting/ledger.
 * @param opts.sleep     injectable for tests; defaults to a real timer.
 * @returns {{drained, stopReason, calls, pausedMs, last}} — `drained` is the ONLY success.
 * ═══════════════════════════════════════════════════════════════════════════════ */
export async function drainSweep(post, opts = {}) {
  const {
    maxCalls = 20,
    first = null,
    onAnswer = null,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = opts;

  let state = newDrainState();
  let calls = 0, cursor = null, pausedMs = 0;
  let drained = false, stopReason = null, last = null;
  let answer = first ?? null;

  for (;;) {
    if (answer === null) {
      if (calls >= maxCalls) {
        stopReason = `the sweep was still incomplete (reason "${last?.reason ?? null}") after the ${maxCalls}-call bound`;
        break;
      }
      const res = await post(cursor);
      calls++;
      if (!res || res.status !== 200 || res.json?.ok !== true) {
        stopReason = `sweep call ${calls} did not answer 200/ok (HTTP ${res?.status ?? 0})`;
        break;
      }
      answer = res.json;
    } else {
      /* The seeded answer is a CALL — it cost a web-trigger invocation and it counts against
         the bound exactly like one the loop made itself. */
      calls++;
    }

    last = answer;
    if (onAnswer) onAnswer(answer, calls);

    const step = decideSweepStep(answer, state);
    state = step.state;
    if (step.action === "done") { drained = true; break; }
    if (step.action === "stop") { stopReason = `${step.stopReason} (after ${calls} call(s))`; break; }
    if (step.sleepMs > 0) {
      /* The BACK-OFF, actually taken. Sleeping is the whole point of the `deletes-failing`
         answer: the page will not start landing deletes because it was asked again sooner. */
      pausedMs += step.sleepMs;
      await sleep(step.sleepMs);
    }
    cursor = step.cursor;
    answer = null;
  }

  return { drained, stopReason, calls, pausedMs, last };
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * THE PLANT LOOP — F-696 / F-710 / F-724. ONE HOME, FOR THE SAME REASON THE DRAIN HAS ONE.
 *
 * `plantHarnessFaults` was given the sweep's contract in F-696 (a budget, a `startIndex`, a
 * `nextIndex`), so REACHING a population is a loop exactly as draining one is — and the loop
 * was then written TWICE, byte-for-byte, in `plant-sweep-live.mjs` and
 * `delete-fault-drain-live.mjs`. Both copies carried the same hole.
 *
 * F-724 — `reason: "clearing"` IS AN IDENTICAL RE-POST, NOT A STALLED POPULATION.
 * A FRESH call (`startIndex === 0`) first removes any older, LARGER population
 * (`clearStalePlantedRows`, src/harness-fault.js). On a shared tenant holding a crashed
 * run's 300 rows, that clear does not finish inside the trigger budget, and the lever
 * answers — deliberately —
 *
 *     { ok:true, planted:0, failed:0, nextIndex: startIndex, truncated:true, reason:"clearing" }
 *
 * whose whole contract is "POST me again, unchanged, and I will carry on clearing". NOT ONE
 * consumer implemented it: both copies read a non-advancing `nextIndex` as proof the
 * population is unreachable and FAILED the driver — on a tenant where one more identical
 * POST would have finished the clear and planted. A green suite turning red for a reason the
 * tenant does not contain is the worst kind of red, so the answer is honoured here, ONCE, and
 * BOUNDED: `PLANT_CLEARING_LIMIT` consecutive `clearing` answers is a clear that is not
 * converging, and that IS a stop — with its own sentence, never the generic one.
 *
 * The other two traps this loop is written around, unchanged from the copies it replaces:
 *   · `complete: true` DOES NOT MEAN "the population you asked for exists" (F-710). A fresh
 *     call over `HARNESS_FAULT_PLANT_CALL_MAX` is clamped SILENTLY and still answered
 *     `complete:true`. So the loop counts ROWS — `totalPlanted >= n` — and reports the clamp
 *     as an observation (`clamped`) rather than a failure.
 *   · `reason: "writes-failed"` is a FAILURE, never a resume: the store refused writes, the
 *     population is short by an amount nothing will make up, and every assertion downstream
 *     would be measuring a keyspace nobody planted.
 * ═══════════════════════════════════════════════════════════════════════════════ */

/*
 * F-772 — WHAT THE DELETE-FAULT LEVER SAYS RIGHT NOW, READ IN THE *READ* ANSWER'S SHAPE.
 *
 * There are TWO answer shapes in this family and they are not the same shape:
 *
 *   · the ARM answer (`armDeleteFault` via the hook) is FLAT —
 *     `{ ok, key, prefix, mode, count, ttlSeconds, until, modes, maxCount, maxTtlSeconds }`.
 *   · the READ answer (`readDeleteFault` -> `readHarnessFault`) is NESTED —
 *     `{ ok, prefix, key, value: { mode, count, armedAt } | null, until, expired }`.
 *
 * `plant-sweep-live.mjs` read the READ answer in the ARM answer's flat shape, so `armed`,
 * `mode` and `count` were `undefined` on every tenant: its `--stale` arm died at step 2 on
 * the positive control, and its step 6 "the lever is spent" check read `count: undefined`
 * as `0` and PASSED without ever looking at the lever. A false FAIL and a false PASS out of
 * one wrong shape — which is what a SECOND home of one rule buys. `delete-fault-drain-live`
 * had the correct reader; it lives here now and both drivers call this one.
 *
 * `armed` is `Boolean(value)` and NOT `count > 0`: an expired or absent row answers
 * `value: null`, and F-664 has `readHarnessFault` delete a row past its window on the way
 * out, so "this cannot be read" and "this is not armed" are deliberately one answer.
 *
 * `until` is read TOP-LEVEL first because that is where both real answers carry it —
 * `setFaultRow` stores `{ mode, count, armedAt }` and the window is computed outside the
 * row, so a `value.until`-only reader reports `null` on every live run. The `value.until`
 * fallback is kept so an older recorded fixture still reads the same field.
 *
 * The KEY is never among the recorded facts: it names the prefix the lever guards.
 */
export const leverFacts = (j) => ({
  ok: j?.ok ?? null,
  prefix: j?.prefix ?? null,
  armed: Boolean(j?.value),
  count: j?.value?.count ?? 0,
  mode: j?.value?.mode ?? null,
  expired: j?.expired ?? null,
  until: j?.until ?? j?.value?.until ?? null,
});

/** How many CONSECUTIVE `clearing` answers are an identical re-POST worth making. */
export const PLANT_CLEARING_LIMIT = 4;
/** The pause between those identical re-POSTs. The clear is I/O-bound; hammering it helps nobody. */
export const PLANT_CLEARING_PAUSE_MS = 500;

/** The default per-call ledger row. A driver that needs different fields passes `opts.row`. */
/*
 * F-761 — THE LEDGER ROW RECORDS THE FIELDS THE LOOP BRANCHES ON.
 *
 * `plantPopulation` decides the WHOLE shape of a plant on `resume`: "repost" re-POSTs the
 * identical body, "start-index" advances, "stop" aborts. The ledger recorded none of it —
 * not `resume`, and not the `clearedSoFar` that is the only evidence a re-POST trail is
 * PROGRESSING rather than spinning. So a plant that resumed through a stale-tail clear left
 * an evidence file indistinguishable from one that resumed on a start index, and F-744's
 * cumulative count — the whole reason `clearToken` exists — was unfalsifiable live.
 *
 * `clearToken` is recorded as a BOOLEAN and never as its value: it is `encodeSweepCursor`'s
 * base64, an opaque token that may encode a KVS cursor, and the keys in this keyspace carry
 * faulted paths. Its PRESENCE is the whole assertion (F-744: an answer that asks for a
 * re-POST must hand one back, or the running total restarts at zero on the next call).
 *
 * Exported because the offline fixtures drive it directly: a live driver's row builder that
 * only runs on a tenant is a row builder whose shape is asserted nowhere.
 */
export const plantLedgerRow = (j, nth) => ({
  call: nth, n: j.n ?? null, startIndex: j.startIndex ?? null, planted: j.planted ?? null,
  failed: j.failed ?? null, nextIndex: j.nextIndex ?? null, truncated: j.truncated ?? null,
  reason: j.reason ?? null, complete: j.complete ?? null, expired: j.expired ?? null,
  cleared: j.cleared ?? null, ttlSeconds: j.ttlSeconds ?? null, budgetMs: j.budgetMs ?? null,
  /* F-761 — the branch, and the progress a non-advancing `nextIndex` cannot show. `resumeOf`
     rather than `j.resume`, so a pre-F-724 answer is recorded as the mode the loop actually
     obeyed and not as `undefined`. */
  resume: resumeOf(j) ?? null,
  clearedSoFar: j.clearedSoFar ?? null,
  remainingStale: j.remainingStale ?? null,
  staleFailed: j.staleFailed ?? null,
  clearTokenPresent: typeof j.clearToken === "string" && j.clearToken.length > 0,
});

const defaultPlantRow = plantLedgerRow;

/**
 * PLANT `n` ROWS AS A POPULATION, resuming until the rows are THERE.
 *
 * @param post  (n, startIndex) => Promise<{status, json}> — one `plantHarnessFaults` call.
 * @param n     the population the caller wants to exist when this returns.
 * @param opts.maxCalls        the bound; a plant needing more is a finding, not a retry.
 * @param opts.row             (json, callNumber) => object — the driver's own ledger row.
 * @param opts.clearingLimit   consecutive `clearing` answers worth re-POSTing (default 4).
 * @param opts.clearingPauseMs the pause before each of those re-POSTs.
 * @param opts.sleep           injectable for tests; defaults to a real timer.
 * @returns {{planted, stopReason, calls, totalPlanted, totalFailed, totalCleared,
 *            clearingCalls, pausedMs, clamped}} — `planted` is the ONLY success.
 */
/* ── F-748 — THE PLANT'S RESUME CONTRACT HAS ONE AUTHOR, AND IT IS NOT THIS FILE ──────
 * `plantHarnessFaults` (src/harness-fault.js) now says, on every answer, HOW it is resumed:
 * `resume` is `"repost"` | `"start-index"` | `"stop"` | `null`, computed there by
 * `plantResumeMode` from the reason, the complete flag and whether the index actually moved.
 * This loop OBEYS that field and derives nothing from the reason when it is present.
 *
 * It did not used to. The driver half was cut against a base where the repost vocabulary was
 * `["clearing"]` alone, and the producer's is `["clearing", "clear-failed"]` — so a stale
 * clear that refused some deletes answered `clear-failed`, this loop did not recognise it,
 * treated it as a non-advancing answer, and aborted the plant with "the population cannot be
 * reached". That is exactly the abort F-724 was cut to remove, arriving for the second reason,
 * because the contract had two homes written against two different bases.
 *
 * THE FALLBACK IS FOR AGE, NOT FOR DISAGREEMENT. `resume` is absent only from an answer
 * produced by a deployment older than F-724, and the two lists below exist solely to read
 * those. They are NOT a second opinion: when `resume` is present it decides, even if it
 * contradicts them. And src/harness-fault.js is deliberately NOT imported — it pulls
 * `@forge/kvs`, which would drag a Forge runtime into every offline consumer of this library.
 * The price of that is these two constants; the guard on the price is that they are
 * unreachable whenever the field is there, and that an UNKNOWN mode is a stop rather than a
 * guess.
 */
const LEGACY_PLANT_REPOST_REASONS = Object.freeze(["clearing", "clear-failed"]);
const LEGACY_PLANT_STOP_REASONS = Object.freeze(["writes-failed"]);

/** The answer's own resume instruction, or — for a pre-F-724 answer that carries none — the
 *  best reading of its `reason`. Exported for the offline fixtures, which assert both paths. */
export function resumeOf(j) {
  if (j && Object.prototype.hasOwnProperty.call(j, "resume")) return j.resume;
  if (!j || j.complete === true || !j.reason) return null;
  if (LEGACY_PLANT_REPOST_REASONS.includes(j.reason)) return "repost";
  if (LEGACY_PLANT_STOP_REASONS.includes(j.reason)) return "stop";
  return "start-index";
}

export async function plantPopulation(post, n, opts = {}) {
  const {
    maxCalls = 10,
    row = defaultPlantRow,
    clearingLimit = PLANT_CLEARING_LIMIT,
    clearingPauseMs = PLANT_CLEARING_PAUSE_MS,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = opts;

  const calls = [];
  let startIndex = 0, totalPlanted = 0, totalFailed = 0, totalCleared = 0, totalStaleFailed = 0;
  let planted = false, stopReason = null, clamped = null;
  let clearingRun = 0, clearingCalls = 0, pausedMs = 0;
  let clearToken = null;

  while (calls.length < maxCalls) {
    /* F-744 — `clearToken` IS THE RE-POST'S ONLY CARRIED STATE. The producer hands one back
       on a repost answer and asks for it verbatim on the next identical POST; without it the
       running `clearedSoFar` restarts and the answer understates how much of the stale tail
       has gone. A `post` that ignores the third argument is not broken, only less informed —
       which is why it is passed positionally and last. */
    const res = await post(n, startIndex, clearToken);
    const nth = calls.length + 1;
    if (!res || res.status !== 200 || res.json?.ok !== true) {
      stopReason = `plant call ${nth} did not answer 200/ok (HTTP ${res?.status ?? 0})`;
      break;
    }
    const j = res.json;
    calls.push(row(j, nth));
    totalPlanted += Number(j.planted || 0);
    /* F-747 — `failed` is WRITES in every branch now, and the clear's refusals have their own
       name. They used to share one field, so this total meant two things depending on which
       branch answered. */
    totalFailed += Number(j.failed || 0);
    totalStaleFailed += Number(j.staleFailed || 0);
    totalCleared += Number(j.cleared || 0);
    /* F-710 — the ONLY way a caller can see the silent clamp is to compare its own request
       against the `n` it was answered back. Neither shipped helper made that comparison. */
    if (nth === 1 && Number.isFinite(Number(j.n)) && Number(j.n) < n) {
      clamped = { requested: n, answered: Number(j.n), nextIndex: j.nextIndex ?? null, complete: j.complete ?? null };
    }

    const mode = resumeOf(j);
    if (mode === "stop") {
      stopReason = `plant call ${nth} answered reason:${JSON.stringify(j.reason ?? null)} resume:"stop" (planted ${j.planted}, failed ${j.failed}) — the producer says this answer is not resumable, so the population is short at ${totalPlanted}/${n} and nothing downstream may be asserted over it`;
      break;
    }
    if (mode !== null && mode !== "repost" && mode !== "start-index") {
      /* AN UNKNOWN WORD IS A STOP, NEVER A GUESS. The vocabulary is the producer's and it is
         allowed to grow; a consumer that treated an unrecognised instruction as "carry on"
         would be inventing a meaning for it, and the one thing every mode so far has in
         common is that getting it wrong spins or asserts over a short population. */
      stopReason = `plant call ${nth} answered resume:${JSON.stringify(j.resume)}, which this loop does not know how to obey (reason:${JSON.stringify(j.reason ?? null)}) — src/harness-fault.js has grown a resume mode that lib/sweep-drain.mjs has not learned`;
      break;
    }
    if (totalPlanted >= n) { planted = true; break; }

    /* F-724/F-748 — THE RE-POST, HONOURED AS THE PRODUCER STATES IT AND NOT AS A REASON LIST.
       Checked BEFORE the advancing-`nextIndex` test, because a repost answer deliberately
       returns the index it was given: it is the non-advancing answer that means "ask again",
       not "give up". It used to be keyed on `reason === "clearing"` alone, and the producer's
       repost vocabulary also holds `clear-failed` — so a stale clear that refused some deletes
       answered `clear-failed`, was read as a non-advancing answer, and aborted the plant with
       the old sentence: the exact failure F-724 was cut to remove, arriving for the second
       reason. Switching on `resume` means the next reason added on that side needs no edit
       here at all. */
    if (mode === "repost") {
      clearingRun++;
      clearingCalls++;
      if (clearingRun > clearingLimit) {
        stopReason = `plant call ${nth} answered resume:"repost" (reason:${JSON.stringify(j.reason ?? null)}) for the ${clearingRun}th time in a row (cleared ${totalCleared} stale row(s) so far, ${totalStaleFailed} stale delete(s) refused) — an identical re-POST is the documented way to finish a stale-tail clear, but a clear that has not finished in ${clearingLimit} of them is not converging and the population cannot be reached`;
        break;
      }
      if (typeof j.clearToken === "string" && j.clearToken) clearToken = j.clearToken;
      if (clearingPauseMs > 0) { pausedMs += clearingPauseMs; await sleep(clearingPauseMs); }
      continue;                       /* startIndex UNCHANGED — the re-POST must be identical */
    }
    clearingRun = 0;
    clearToken = null;                /* the clear is behind us; a stale token is not carried */

    /* `resume: null` IS NOT "THE POPULATION IS DONE". It is `plantResumeMode`'s answer for a
       call that ended cleanly (`complete: true`), and a clean call can still be a SHORT
       population — the door clamps `n` per call, so 200 rows arrive as two complete answers.
       This loop counts ROWS, never the flag, so a null-resume answer that has not reached `n`
       advances by `nextIndex` exactly as a truncated one does. Only a non-advancing index
       ends it. */
    const next = Number(j.nextIndex);
    if (!Number.isFinite(next) || next <= startIndex) {
      /* F-745's shape, defended on the CONSUMER side too: an instruction to resume where you
         already are is a spin, whoever issued it. The producer now refuses to say
         "start-index" for an answer whose index did not move; this is the assertion that it
         did not, and it names which of the two cases it is. */
      stopReason = mode === "start-index"
        ? `plant call ${nth} answered resume:"start-index" but its nextIndex (${JSON.stringify(j.nextIndex ?? null)}) does not advance past ${startIndex}, with ${totalPlanted}/${n} row(s) planted — resuming there would re-POST the same call forever`
        : `plant call ${nth} answered complete=${j.complete} with only ${totalPlanted}/${n} row(s) planted and no advancing nextIndex (${JSON.stringify(j.nextIndex ?? null)}) — the population cannot be reached`;
      break;
    }
    startIndex = next;
  }
  if (!planted && !stopReason) stopReason = `the plant was still ${totalPlanted}/${n} after the ${maxCalls}-call bound`;
  return { planted, stopReason, calls, totalPlanted, totalFailed, totalCleared, totalStaleFailed, clearingCalls, pausedMs, clamped };
}
