/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */
/* ═══════════════════════════════════════════════════════════════════════════════
 * F-721 OFFLINE — THE LIVE DRIVER'S PLANNING AND ASSERTIONS, GRADED WITHOUT A TENANT.
 *
 * `delete-fault-drain-live.mjs` cannot run yet: nothing is deployed and the Forge CLI identity
 * is wrong. A driver that has never executed is a driver whose arithmetic nobody has checked,
 * and the arithmetic is the whole point of this one — the arm count is DERIVED from two
 * constants in two files that never mention each other (F-722), and the verdicts it will print
 * are what closes or fails four ledger rows.
 *
 * So the driver's pure half is exercised here against ANSWER SHAPES TAKEN FROM
 * `harness-fault-ttl.test.mjs`'s own fixtures — the shapes the module demonstrably produces
 * under `armDeleteFault`, section 7h — plus the tokens `encodeSweepCursor` mints for each of
 * them. Nothing is imported from src, nothing touches the network, and the driver's module
 * side-effects are none: it is ENTRY-GUARDED precisely so this file can import it.
 *
 * WHAT THIS PROVES, AND WHAT IT DELIBERATELY DOES NOT.
 * It proves the driver will READ a correct answer as correct and a broken one as broken —
 * every negative below is a shape the sweep could actually emit if a fix regressed. It proves
 * NOTHING about a real Forge KVS: whether a live cursor round-trips, whether the sequential
 * decrement survives real write latency, whether the platform's own throttling interleaves with
 * the planted one. Those are what the live run is for, and until it happens F-682/683/690/691
 * remain offline-only exactly as F-706's row says.
 * ═══════════════════════════════════════════════════════════════════════════════ */
import {
  KVS_DELETE_BATCH_EXPECTED, drainableArmCount, tokenFacts, tokenNote,
  carryVerdict, replayPausedMs, judgeRefuseDrain, armFacts, leverFacts, shape,
} from "./delete-fault-drain-live.mjs";
import { IDENTICAL_ANSWER_LIMIT, DELETES_FAILING_BACKOFF_MS } from "../lib/sweep-drain.mjs";

let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) { pass++; console.log(`  ok   ${what}`); } else { fail++; console.log(`  FAIL ${what}`); } };

/* ── THE TOKEN MINT, COPIED FROM THE MODULE'S CONTRACT RATHER THAN IMPORTED ──────
   `encodeSweepCursor` lives in src and this suite may not import it, so the token is built
   here to the grammar the module's docblock publishes: base64 of `{"c": <cursor|null>}`, with
   `"f"` PRESENT — at any value, including null — only while a failure is unresolved. If the
   grammar ever changes, the live driver's `tokenFacts` stops agreeing with the app and this
   mint is where the disagreement shows up first. */
const mint = (c, f) => {
  const payload = { c: c === undefined ? null : c };
  if (f !== undefined) payload.f = f;
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
};

console.log("\n1 · THE TOKEN, AS THE DRIVER READS IT");
{
  const page0 = mint(null);
  const f0 = tokenFacts(page0);
  ok(f0.present === true && f0.decodable === true && f0.hasCKey === true && f0.carriesF === false,
    "a page-0 token decodes as ours, with `c` and without `f`");
  ok(f0.innerType === "null" && f0.innerIsRealCursor === false,
    "…and its inner `c` is null — the beginning of the keyspace, which a raw KVS cursor cannot express (F-674)");

  const real = tokenFacts(mint("kvs-cursor-abcdef"));
  ok(real.innerIsRealCursor === true && real.innerLength === 17 && real.innerHead === "kvs-",
    "a token wrapping a REAL cursor is reported as length + four-character head, never in full (the key may encode a path)");

  const carried = tokenFacts(mint("page4", null));
  ok(carried.carriesF === true,
    "F-691: `\"f\": null` is PRESENCE, not truthiness — an unresolved failure at the START of the keyspace still rides the token");

  ok(tokenFacts(null).present === false && tokenFacts("").present === false,
    "a null or empty cursor is simply absent");
  const opaque = tokenFacts("not a token!!");
  ok(opaque.present === true && opaque.decodable === false && opaque.grammar === false,
    "a string outside the grammar is recorded as present-but-not-ours rather than crashing the ledger");
  ok(tokenFacts(Buffer.from(JSON.stringify({ x: 1 }), "utf8").toString("base64")).hasCKey === false,
    "decodable base64 JSON without a `c` key is not one of ours either");

  ok(tokenNote(tokenFacts(page0)).includes("f:absent") && tokenNote(tokenFacts(mint("p", "q"))).includes("f:carried"),
    "the ledger SENTENCE names whether `f` rode the token — the one field these four rows turn on");
  ok(tokenNote({ present: false }) === "none" && tokenNote(null) === "none",
    "…and an absent token has a sentence too, so a ledger row is never blank");
  ok(tokenNote(tokenFacts(page0)) !== tokenNote(tokenFacts(page0)) === false
    && typeof tokenNote(tokenFacts(page0)) === "string",
    "the note is a fresh primitive every time (F-702: a shared reference is written [CIRCULAR] by the redactor)");
}

console.log("\n2 · F-691'S IDENTITY RULE, ON THE SHAPES THE MODULE ACTUALLY EMITS");
{
  /* THE FIXTURE. harness-fault-ttl.test.mjs section 7h, `refuse`/`throttle`, five planted rows
     and a three-deep lever: the whole first batch is refused, so the call breaks MID-PAGE with
     the page's own cursor and `cursor === failedResume` — which is why `f` is absent. */
  const call1 = {
    ok: true, scanned: 5, deleted: 0, failed: KVS_DELETE_BATCH_EXPECTED,
    truncated: true, reason: "deletes-failing", complete: false,
    cursor: mint(null), failedResume: mint(null),
  };
  const v1 = carryVerdict(call1);
  ok(v1.verdict === "ok" && v1.kind === "at-failure",
    "the `deletes-failing` answer resumes AT the failing page, so `f` is correctly ABSENT — the exact assertion the offline suite makes on the real module");

  /* THE REGRESSION THIS RULE EXISTS TO CATCH, in both directions. */
  const redundant = { ...call1, cursor: mint(null, null) };
  ok(carryVerdict(redundant).verdict === "bad" && carryVerdict(redundant).kind === "redundant-f",
    "POSITIVE CONTROL: a `f` carried on a token whose cursor IS the failing page is caught — a 'fix' that always carries it does not pass");
  const dropped = { ...call1, cursor: mint("page4"), failedResume: mint(null) };
  ok(carryVerdict(dropped).verdict === "bad" && carryVerdict(dropped).kind === "dropped-f",
    "POSITIVE CONTROL: F-691 ITSELF — resuming AHEAD of an unresolved failure with `f` dropped is caught, which is the bug that answered complete:true over condemned rows");
  const ahead = { ...call1, cursor: mint("page4", null), failedResume: mint(null) };
  ok(carryVerdict(ahead).verdict === "ok" && carryVerdict(ahead).kind === "ahead-of-failure",
    "…and the FIXED shape — resuming ahead WITH `f` — is the one the rule accepts");
  const phantom = { ok: true, deleted: 5, failed: 0, truncated: true, reason: "budget", complete: false, cursor: mint("page2", null), failedResume: null };
  ok(carryVerdict(phantom).verdict === "bad" && carryVerdict(phantom).kind === "phantom-f",
    "POSITIVE CONTROL: `f` on an answer that reports NO unresolved failure is caught too");
  const unreachable = { ok: true, deleted: 0, failed: 2, truncated: true, reason: "deletes-failed", complete: false, cursor: null, failedResume: mint(null) };
  ok(carryVerdict(unreachable).verdict === "bad" && carryVerdict(unreachable).kind === "no-cursor",
    "POSITIVE CONTROL: an unresolved failure handed back with NO cursor is the unreachable-rows shape F-674 and F-683 both forbid");

  const done = { ok: true, deleted: 5, failed: 0, truncated: false, reason: null, complete: true, cursor: null, failedResume: null };
  ok(carryVerdict(done).verdict === "n/v" && carryVerdict(done).kind === "finished",
    "NEGATIVE CONTROL: a finished answer carries nothing and is not graded as a pass or a failure");

  /* ── F-727 — THE ANSWER'S OWN CURSOR WAS THE UNGUARDED HALF ─────────────────────────
     `mess.readable` was checked; `here.readable` never was. A token that decodes to an
     object with NO `c` key became `c: null` and was then COMPARED as if it had been read,
     so a cursor that can resume NOTHING could be graded `ahead-of-failure` — a PASS that
     also satisfies this driver's `some(kind === "ahead-of-failure")` positive control.
     These fixtures are that token, in both directions, and the verdict is N/V: the grader
     refusing to grade, never "correct". */
  const cLess = Buffer.from(JSON.stringify({ f: "page-7" }), "utf8").toString("base64");
  ok(tokenFacts(cLess).decodable === true && tokenFacts(cLess).hasCKey === false,
    "the fixture really is the shape being judged: it DECODES (so `decodable` never catches it) and carries no `c`");
  {
    /* AHEAD-OF-FAILURE, the arm that used to manufacture a PASS. */
    const v = carryVerdict({ ...call1, cursor: cLess, failedResume: mint("page-7") });
    ok(v.verdict === "n/v" && v.kind === "opaque-cursor",
      "POSITIVE CONTROL (F-727): a `c`-less cursor against a readable `failedResume` is NOT VERIFIED — it used to be graded `ahead-of-failure`, a PASS for an answer that names no resume page");
    ok(v.verdict !== "ok",
      "…and specifically never a PASS, which is the whole finding");
  }
  {
    /* AT-FAILURE, the mirror: against a page-0 (`c: null`) failedResume the `c`-less token
       used to compare EQUAL and grade `at-failure` — also a PASS. */
    const v = carryVerdict({ ...call1, cursor: cLess, failedResume: mint(null) });
    ok(v.verdict === "n/v" && v.kind === "opaque-cursor",
      "POSITIVE CONTROL (F-727): …and the mirror case, where `null === null` used to make a `c`-less token look like the failing page itself");
  }
  {
    /* THE ORDER IS DELIBERATE: an unreadable `failedResume` is a stated REQUIREMENT of
       F-691 and keeps the harder `bad` verdict when both tokens are unreadable. */
    const v = carryVerdict({ ...call1, cursor: cLess, failedResume: "not a token!!" });
    ok(v.verdict === "bad" && v.kind === "opaque-failedresume",
      "NEGATIVE CONTROL: with BOTH unreadable, the `failedResume` requirement still wins — the new guard did not soften an existing failure");
  }
  {
    /* And the readable shapes are untouched: the guard adds a branch, it does not move one. */
    const v = carryVerdict({ ...call1, cursor: mint("page4", null), failedResume: mint(null) });
    ok(v.verdict === "ok" && v.kind === "ahead-of-failure",
      "NEGATIVE CONTROL: a cursor that DOES name a page still grades exactly as before");
  }
}

console.log("\n3 · F-722 — THE ARM COUNT IS DERIVED, AND THE DERIVATION IS THE FINDING");
{
  ok(drainableArmCount(3, 3) === 8, "3 identical answers x a batch of 3, minus one = 8");
  ok(drainableArmCount(IDENTICAL_ANSWER_LIMIT, KVS_DELETE_BATCH_EXPECTED) === 8,
    `…and the live constants give the same 8 (IDENTICAL_ANSWER_LIMIT=${IDENTICAL_ANSWER_LIMIT}, batch=${KVS_DELETE_BATCH_EXPECTED}) — if either moves, the driver's arm moves with it and this line fails loudly`);
  ok(drainableArmCount(1, 1) === 1 && drainableArmCount(0, 0) === 1,
    "the floor is 1 — an arm of zero is a lever that silently does nothing, which is the clamp the module makes for the same reason");
  ok(IDENTICAL_ANSWER_LIMIT * KVS_DELETE_BATCH_EXPECTED - 1 < 50,
    "F-722, stated as the row states it: the lever's advertised ceiling of 50 is far above what one drain tolerates, and nothing in either file says so");
  ok(DELETES_FAILING_BACKOFF_MS.length === 3 && DELETES_FAILING_BACKOFF_MS[0] === 500,
    "the published back-off ladder is the 500/1000/2000 the driver names in its evidence");
}

console.log("\n4 · THE WHOLE REFUSE DRAIN, JUDGED — THE SEQUENCE AN 8-UNIT LEVER PRODUCES");
{
  /* The four answers a 60-row plant under `{refuse, count: 8}` must produce, built to the
     shapes section 7h records: two full-batch refusals with the page-0 cursor (calls 1-2, 3
     units each), then a call whose last two units are spent mid-batch so the rest of the page
     lands and the walk reaches the end still unresolved (`deletes-failed`), then the retry at
     the failure that clears it. */
  const page0 = mint(null);
  const failing = () => ({
    ok: true, scanned: 60, deleted: 0, failed: 3, truncated: true,
    reason: "deletes-failing", complete: false, rowsTruncated: false,
    cursor: page0, failedResume: page0,
  });
  const answers = [
    failing(),
    failing(),
    { ok: true, scanned: 60, deleted: 58, failed: 2, truncated: true, reason: "deletes-failed", complete: false, rowsTruncated: false, cursor: page0, failedResume: page0 },
    { ok: true, scanned: 2, deleted: 2, failed: 0, truncated: false, reason: null, complete: true, rowsTruncated: false, cursor: null, failedResume: null },
  ];

  const replay = replayPausedMs(answers);
  ok(replay.pausedMs === 1500 && replay.ladder.join(",") === "500,1000",
    `the decision demands the published ladder over two refusals: ${replay.ladder.join(" + ")} = ${replay.pausedMs} ms (F-690's back-off, actually taken)`);

  const rows = judgeRefuseDrain({ answers, drained: true, pausedMs: replay.pausedMs, deleteBatch: KVS_DELETE_BATCH_EXPECTED });
  const fails = rows.filter((r) => r.verdict === "FAIL");
  ok(fails.length === 0, `the expected live sequence is graded clean (${fails.map((r) => r.what).join(" | ") || "no FAIL rows"})`);
  ok(rows.some((r) => r.verdict === "PASS" && r.what.includes("deletes-failing")),
    "…and it says so about F-682's all-rejected batch rather than passing silently");
  ok(rows.some((r) => r.verdict === "PASS" && r.what.includes("KVS_DELETE_BATCH=3")),
    "…and it reads the batch size OFF THE ANSWER, so a moved constant is reported rather than assumed");
  ok(rows.some((r) => r.verdict === "N/V" && r.what.includes("`f`-PRESENT half")),
    "…and it records the half of F-691 a single-page plant CANNOT exercise, instead of letting a green run imply it");

  /* ── F-758 · THE N/V NAMES THE CAUSE THE RUN RECORDED, NOT THE ONE THE PLAN ASSUMED ──
     The sentence used to end "60 rows fit one 100-row page", a hard-coded claim about the
     population that was already false for `--n=150` and that told the next reader to raise
     the population when the real cause might be something else entirely. The three causes
     below are the three states the grader can actually distinguish from the answers. */
  {
    const nv = (r) => (r.find((x) => x.verdict === "N/V" && x.what.includes("`f`-PRESENT half")) || {}).what || "";
    ok(nv(rows).includes("the last unresolved failure was at call")
      && nv(rows).includes("NO answer after it broke on the 15 s sweep budget"),
      "POSITIVE CONTROL (F-758): the expected live sequence leaves a failure unresolved and never breaks on budget after it, and the N/V says exactly that — with the per-call reasons, so the cause is arguable from the sentence");
    const clean = [{ reason: "complete", failed: 0, deleted: 10, complete: true, cursor: null }];
    ok(nv(judgeRefuseDrain({ answers: clean, drained: true, pausedMs: 0, deleteBatch: 3 }))
      .includes("no answer ever reported an unresolved failure"),
      "POSITIVE CONTROL (F-758): a drain with no unresolved failure at all gets the OTHER cause — there was no failed page for a cursor to land past, which is a different missing precondition and a different fix");
    const budgetAfter = [
      { reason: "deletes-failing", failed: 3, deleted: 0, complete: false, cursor: "aaa", failedResume: "aaa" },
      { reason: "budget", failed: 0, deleted: 90, complete: false, cursor: "bbb" },
    ];
    ok(nv(judgeRefuseDrain({ answers: budgetAfter, drained: true, pausedMs: 500, deleteBatch: 3 }))
      .includes("yet no cursor decoded to a position ahead of the failure — if that recurs it is a finding, not a gap in coverage"),
      "POSITIVE CONTROL (F-758): when BOTH preconditions are met and the half still is not exercised, the N/V stops calling it a coverage gap and calls it a finding — the old sentence would have blamed the row count either way");
  }

  /* THE GRADER MUST FAIL THE THINGS IT EXISTS TO FAIL. Each of these is a shape the module
     could emit if one of the four fixes regressed, and an empty match set is not evidence
     until the matcher is shown to see the thing at all. */
  const notDrained = judgeRefuseDrain({ answers: answers.slice(0, 3), drained: false, pausedMs: 1500, deleteBatch: 3 });
  ok(notDrained.some((r) => r.verdict === "FAIL" && r.what.includes("never reached complete")),
    "POSITIVE CONTROL: a drain that stops short is a FAIL, not a partial win");
  const unpaced = judgeRefuseDrain({ answers, drained: true, pausedMs: 0, deleteBatch: 3 });
  ok(unpaced.some((r) => r.verdict === "FAIL" && r.what.includes("the loop paused 0 ms where the decision demanded 1500 ms")),
    "POSITIVE CONTROL: refusals answered back-to-back with NO pause is F-690 itself — twenty unpaced calls at a store already refusing — and the FAIL names both numbers");
  const noPauseAsked = judgeRefuseDrain({
    answers: [{ ok: true, scanned: 60, deleted: 0, failed: 3, truncated: true, reason: "deletes-failing", complete: false, cursor: page0, failedResume: page0, budgetMs: 15000, rowsTruncated: false }],
    drained: false, pausedMs: 0, deleteBatch: 3,
  });
  ok(noPauseAsked.some((r) => r.verdict === "PASS" && r.what.includes("paced back-off")) === false,
    "POSITIVE CONTROL: a single refusal whose pause was never taken is not credited with the back-off either");
  const wrongPause = judgeRefuseDrain({ answers, drained: true, pausedMs: 4000, deleteBatch: 3 });
  ok(wrongPause.some((r) => r.verdict === "FAIL" && r.what.includes("where the decision demanded")),
    "POSITIVE CONTROL: a loop that sleeps something OTHER than what the decision said is caught — the flat 1 s copy F-702 deleted would fail here");
  const noFault = judgeRefuseDrain({ answers: [answers[3]], drained: true, pausedMs: 0, deleteBatch: 3 });
  ok(noFault.some((r) => r.verdict === "FAIL" && r.what.includes("did not produce a refusing batch")),
    "POSITIVE CONTROL: a clean drain with the lever doing NOTHING is a FAIL — this driver exists to exercise the failing path, and a green sweep proves none of it");
  const progressSpin = judgeRefuseDrain({
    answers: [{ ...failing(), deleted: 0, failed: 3, cursor: page0, failedResume: mint("elsewhere") }],
    drained: false, pausedMs: 500, deleteBatch: 3,
  });
  ok(progressSpin.some((r) => r.verdict === "FAIL" && r.what.includes("DROPPED `f`")),
    "POSITIVE CONTROL: the per-call carry verdicts are folded into the drain's verdict, so an F-691 regression fails the RUN and not only a helper");
  ok(judgeRefuseDrain({ answers: [], drained: true, pausedMs: 0, deleteBatch: 3 })[0].verdict === "FAIL",
    "POSITIVE CONTROL: no answers at all is a FAIL — an empty drain is not a clean one");
}

console.log("\n5 · THE THROTTLE VARIANT — THE CODE IS COUNTED, NOT THROWN");
{
  /* Section 7h runs the same fixture for `throttle`, whose rejection carries the platform's own
     RATE_LIMIT_EXCEEDED. The sweep does not discriminate — a rejected delete is `failed`,
     whatever the reason — so the ANSWER must look identical and must carry no code. */
  const thr = { ok: true, scanned: 12, deleted: 0, failed: 3, truncated: true, reason: "deletes-failing", complete: false, cursor: mint(null), failedResume: mint(null) };
  const s = shape(thr);
  ok(s.failed === 3 && s.reason === "deletes-failing" && s.code === null && s.error === null,
    "a throttled batch is `failed:3` with no `code` and no `error` — RATE_LIMIT_EXCEEDED was COUNTED inside the sweep");
  const escaped = shape({ ok: false, reason: "sweep-failed", code: "RATE_LIMIT_EXCEEDED", error: "rate limited" });
  ok(escaped.code === "RATE_LIMIT_EXCEEDED" && escaped.error === "[present]",
    "POSITIVE CONTROL: the shape SEES an escaped throttle (the `sweep-failed` answer the door builds from a real platform code) — the driver's 'never escaped' claim is falsifiable");
  ok(escaped.error === "[present]",
    "…and the error is recorded as a PRESENCE flag, never as its text, which on a throttle can name the key it refused");
  ok(carryVerdict(thr).kind === "at-failure",
    "and the throttle answer obeys the same F-691 identity rule as the refuse answer — the lever produces the CONDITION, the contract decides the answer");
}

console.log("\n6 · THE ARM AND LEVER ANSWERS — RECORDED IN FULL, MINUS THE KEY");
{
  const armed = armFacts({
    ok: true, key: "harness_fault:delete:harness_fault:plant:", prefix: "harness_fault:plant:",
    mode: "refuse", count: 8, ttlSeconds: 120, until: "2026-09-14T12:00:00.000Z",
    modes: ["refuse", "throttle"], maxCount: 50, maxTtlSeconds: 120,
  });
  ok(armed.count === 8 && armed.mode === "refuse" && armed.ttlSeconds === 120 && armed.until !== null,
    "the arm answer's exact fields are recorded: mode, count, ttlSeconds and the window it bought");
  ok(armed.maxCount === 50 && armed.maxTtlSeconds === 120 && Array.isArray(armed.modes),
    "…including the lever's OWN ceilings, which is what makes F-722 arguable from the evidence file rather than from a comment");
  ok(!("key" in armed) && JSON.stringify(armed).includes("harness_fault:delete") === false,
    "…and NOT the row key: a fault key names the thing it faults, and no driver in this directory records one");

  const live = leverFacts({ ok: true, prefix: "harness_fault:plant:", value: { mode: "refuse", count: 8, until: "2026-09-14T12:00:00.000Z" }, expired: false });
  ok(live.armed === true && live.count === 8 && live.mode === "refuse",
    "the read-back SEES an armed lever — the positive control without which 'count:0' at the end proves nothing");
  const spent = leverFacts({ ok: true, prefix: "harness_fault:plant:", value: null, expired: false });
  ok(spent.armed === false && spent.count === 0,
    "…and a lever spent to zero removes its own row, which reads as armed:false / count:0");
  const expired = leverFacts({ ok: true, prefix: "harness_fault:plant:", value: null, expired: true });
  ok(expired.count === 0 && expired.expired === true,
    "…while a lever past its `until` reads absent AND says so (F-664's read-time expiry, inherited by this lever)");
}

console.log("\n7 · THE SWEEP SHAPE — COUNTERS AND FLAGS, NEVER ROWS");
{
  const s = shape({
    ok: true, scanned: 61, deleted: 0, failed: 3, truncated: true, reason: "deletes-failing",
    complete: false, budgetMs: 15000, rowsTruncated: false,
    cursor: mint(null), failedResume: mint(null),
    rows: [
      { key: "harness_fault:plant:0", expired: true },
      { key: "harness_fault:plant:1", expired: true },
      { key: "harness_fault:keyRead:openai", expired: true },
      { key: "harness_fault:jira:/rest/api/3/user/search", expired: false },
    ],
  });
  ok(s.plantedRows === 2 && s.plantedExpired === 2 && s.otherExpired === 1,
    "planted and foreign rows are COUNTED separately — the sweep deletes everyone's expired rows, so the totals need both");
  ok(JSON.stringify(s).includes("user/search") === false && JSON.stringify(s).includes("openai") === false,
    "…and not one key reaches the shape: a fault key carries the faulted path or provider, which is the whole reason this rule is a directory rule");
  ok(s.carriesFailedResume === true && s.hasCursor === true && s.complete === false,
    "the three fields an operator acts on survive: is there more, is there a mess, where do I resume");
}

console.log(`\ndelete-fault-drain: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
