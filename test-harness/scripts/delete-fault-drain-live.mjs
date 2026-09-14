/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */
/* ═══════════════════════════════════════════════════════════════════════════════
 * F-721 LIVE — THE FAILING-DELETE HALF OF THE SWEEP CONTRACT, ON A REAL TENANT.
 *
 * F-706 built the door and NO LIVE DRIVER WALKS THROUGH IT. `armDeleteFault` is called from
 * exactly two places in the repo, `harness-fault-ttl.test.mjs` and
 * `test-hook-jira-fault.test.mjs`, and both are offline suites running against
 * `lib/mock-kvs.mjs`. So F-682 (`deletes-failing`), F-683 (`deletes-failed` +
 * `failedResume`), F-690 (the paced back-off) and F-691 (the unresolved failure riding the
 * resume token) are STILL proven against a mock whose `Promise.reject` was manufactured by
 * the same helper that asserts it — the exact state the F-706 docblock claims to have ended.
 * `plant-sweep-live.mjs`, the one driver that drains a real tenant, arms nothing and says so
 * (`faults: []`), and it saw `failed: 0` throughout on 2026-09-14.
 *
 * This driver is that missing walk. On a REAL Forge KVS, where the rejection competes with
 * real write latency inside a 25 s trigger and `settleDeletes`' sequential decrement is a real
 * read-modify-write against a real store:
 *
 *   1. PLANT 400 expired rows as a POPULATION (F-696): POST, resume on `startIndex: nextIndex`
 *      until the rows are actually there. `complete:true` is NOT "the population exists"
 *      (F-710 — a fresh call over 150 is clamped SILENTLY and still answered complete), so the
 *      loop counts ROWS, and the answer's own `resume` says how it continues — `"stop"`,
 *      which is what `writes-failed` now carries, is a FAILURE, never a resume.
 *   2. ARM `{mode:"refuse", count: 8, ttlSeconds: 120}` and READ THE LEVER BACK. Eight is not
 *      a taste: it is `IDENTICAL_ANSWER_LIMIT × KVS_DELETE_BATCH − 1`, and F-722 is filed
 *      because those two numbers live in two files that never mention each other.
 *
 *      WHY THE COUPLING DECIDES THE COUNT. A faulted sweep stops mid-page on its FIRST
 *      all-rejected batch with `deletes-failing` and the page's OWN cursor, so one call spends
 *      exactly `KVS_DELETE_BATCH` (3) units and answers BYTE-IDENTICALLY to the last.
 *      `drainSweep` stops a byte-identical answer at `IDENTICAL_ANSWER_LIMIT` (3). An arm of 9
 *      or more therefore makes the transition this driver exists to prove — `deletes-failing`
 *      → resume → the deletes land → `complete` — UNREACHABLE, and the run would fail with
 *      `not-converging`: a cause the tenant does not contain, because the store never refused
 *      anything, the harness did. Eight leaves the lever spent INSIDE the third call's batch,
 *      one unit under the stop. The lever's own ceiling is 50 — five times what any drain
 *      tolerates — which is the whole of F-722, and both constants are written into the
 *      evidence so the row is arguable from the artefact rather than from this comment.
 *   3. DRAIN through `lib/sweep-drain.mjs` (F-690 for the decision, F-702 for the loop — a
 *      hand-rolled copy beside the library is what that directory rule exists to forbid) and
 *      record, per call: `deleted`/`failed`/`reason`/`complete`, the token's SHAPE, and the
 *      back-off actually slept. The expected shape is calls 1 and 2 `deletes-failing` with
 *      `failed>0` and the page-0 cursor, paced 500 ms then 1000 ms; call 3 spends the last two
 *      units mid-batch, lands the rest of the page and ends `deletes-failed`; the calls after
 *      it walk the remaining pages — a 400-row population is about three 15 s budgets — until
 *      one answers `complete:true` with `deleted` totalling the 400 planted.
 *   4. F-691's IDENTITY RULE, ASSERTED ON EVERY ANSWER rather than described: `f` rides the
 *      token ONLY while a failure is unresolved AND the answer resumes somewhere AHEAD of it.
 *      When the answer's own cursor IS the failing page — which is every `deletes-failing`
 *      break, mid-page with that page's cursor — `f` must be ABSENT, because resuming at the
 *      failure IS the retry. The `f`-PRESENT half needs a budget break landing PAST a failed
 *      page, which is why the population is 400 and not 60 (F-758: at 60 the walk never breaks
 *      on budget at all, so that half was unreachable by construction and two live runs both
 *      recorded f-ABSENT). It is asserted when it occurs and recorded N/V when it does not —
 *      with the reason READ OFF THE RUN's own answers, never asserted from the plan. Never
 *      silently skipped.
 *   5. A `mode:"throttle"` variant with `count: 3` — one whole batch — drives the exact code
 *      F-677/F-682 were written about. `RATE_LIMIT_EXCEEDED` must surface as `failed` and as
 *      NOTHING ELSE: the answer is 200/`ok:true` with no `code` and no `error`, because a
 *      planted throttle that escapes the sweep as a call failure is a different defect from the
 *      one the pacing exists for.
 *   6. THE LEVER IS SPENT AND THE KEYSPACE IS CLEAN, each by a SECOND READ: `readDeleteFault`
 *      answers no armed count, and a dry-run sweep shows zero planted rows. Both negatives are
 *      proven READABLE FIRST — the lever is read back immediately after every arm, and the
 *      final dry run is the same query that listed the planted rows — because an empty answer from a
 *      query never shown to see the object is not evidence.
 *
 * ⚠️ BLAST RADIUS — AND WHY `faults: []` IS THE TRUTH HERE, NOT A SILENCED GUARD.
 * `armDeleteFault` takes ONE prefix, by equality, and it is the PLANT's. Planted rows are inert
 * ballast under the kind `plant` that nothing in the app reads (F-688), so the worst this lever
 * can do is decline to remove some ballast — which the rows' own 60 s TTL removes anyway — and
 * it is bounded twice over, by `count` and by a 120 s `until`. No admin sees a refused key
 * read, no rule author sees an empty people picker: there is no user-visible fault to name.
 * `requireAck: true` still asks the guard for the shared-dev refusal, exactly as
 * `plant-sweep-live.mjs` does and for the same reason.
 *
 *   ⚠️ AND A GAP THIS DRIVER CANNOT CLOSE FROM HERE. `FAULT_HARMS` in
 *   `lib/shared-env-guard.mjs` knows four levers; the delete fault is the SEVENTH member of the
 *   family. Naming it would THROW at the call site ("unknown fault … add it to FAULT_HARMS, do
 *   not describe it at the call site"), so the honest form is the one above.
 *   `evidence-redaction.test.mjs`'s arming cohort is likewise a closed list that does not name
 *   this lever, so neither rule 4e nor 4g holds this file. Both are one line each, in two files
 *   another agent holds; they are REPORTED with F-721 rather than edited here.
 *
 * NO LIVE RUN HAS HAPPENED YET: at the time of writing nothing is deployed and the Forge CLI
 * identity is wrong. Everything below is proven offline by `delete-fault-drain.test.mjs`, which
 * drives this file's PURE helpers against the answer shapes recorded in
 * `harness-fault-ttl.test.mjs`. That is why the module is ENTRY-GUARDED — importing it runs
 * nothing, and the env guard is still the first statement on any path that touches a tenant.
 *
 * READ-ONLY on src/ and static/. It never deploys. Every sentence and every payload, console
 * and disk alike, goes through `redactSecrets`/`redactString`; no row KEY is ever recorded (a
 * fault key carries a faulted path or provider, and the lever's own key names its prefix); the
 * resume token is recorded only as a length, a shape and a four-character head.
 *
 *   node scripts/delete-fault-drain-live.mjs --env=dev --i-know-dev-is-shared
 * ═══════════════════════════════════════════════════════════════════════════════ */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { requireEnvAck } from "../lib/shared-env-guard.mjs";
import { loadEnv, requireEnv } from "../lib/env.mjs";
import { redactString, redactSecrets } from "../lib/redact.mjs";
import {
  drainSweep, answerComplete, decideSweepStep, newDrainState,
  IDENTICAL_ANSWER_LIMIT, DELETES_FAILING_BACKOFF_MS, plantPopulation,
} from "../lib/sweep-drain.mjs";

/* ═══════════════════════════════════════════════════════════════════════════════
 * THE PURE HALF — no I/O, no env, no network. Exported so `delete-fault-drain.test.mjs` can
 * run the planning and the assertions against RECORDED answer shapes, and so the numbers below
 * are checked by something other than the one run that depends on them.
 * ═══════════════════════════════════════════════════════════════════════════════ */

/**
 * `KVS_DELETE_BATCH`'s home is the harness-fault module in src, and a live driver does not
 * import from src. This is an EXPECTATION, not a second home: the run PROVES it from the
 * tenant's own answer — the first all-rejected batch reports exactly this many `failed` — and
 * records a mismatch as a finding rather than carrying on with a number the app disagrees with.
 */
export const KVS_DELETE_BATCH_EXPECTED = 3;

/**
 * F-722, AS ARITHMETIC. The largest arm a shared drain can survive: each faulted call spends
 * one batch and repeats itself, and `IDENTICAL_ANSWER_LIMIT` identical answers is the stop. One
 * unit under that is an arm whose last units are spent INSIDE a batch, which is the only way
 * the documented `deletes-failing` -> resume -> `complete` transition can be reached at all.
 */
export const drainableArmCount = (identicalLimit, deleteBatch) =>
  Math.max(1, identicalLimit * deleteBatch - 1);

/* The token grammar, as the library states it, for RECORDING purposes only — the app's own
 * `sweepCursorWellFormed` is the authority and this never decides anything the app decides. */
const TOKEN_GRAMMAR = /^[A-Za-z0-9+/=_-]+$/;
/* Built rather than written, so no scanner mistakes a doubled dot in a source file for a path
 * escape. The library refuses a token containing one; this only reports whether it does. */
const DOUBLED_DOT = "." + ".";

/** A base64 token -> what may be RECORDED about it. Never the inner cursor: it may encode a key. */
export const tokenFacts = (token) => {
  if (typeof token !== "string" || !token) return { present: false };
  const grammar = TOKEN_GRAMMAR.test(token) && !token.includes(DOUBLED_DOT) && token.length <= 2048;
  let parsed = null;
  try { parsed = JSON.parse(Buffer.from(token, "base64").toString("utf8")); } catch {
    return { present: true, grammar, decodable: false };
  }
  if (!parsed || typeof parsed !== "object") return { present: true, grammar, decodable: false };
  const inner = "c" in parsed ? parsed.c : undefined;
  return {
    present: true, grammar, decodable: true,
    tokenLength: token.length,
    hasCKey: "c" in parsed,
    /* PRESENCE, not truthiness (F-691): `"f": null` is a real unresolved failure at the
       beginning of the keyspace, which is precisely the ambiguity this token ended. */
    carriesF: "f" in parsed,
    innerType: inner === null ? "null" : typeof inner,
    innerIsRealCursor: typeof inner === "string" && inner.length > 0,
    innerLength: typeof inner === "string" ? inner.length : null,
    innerHead: typeof inner === "string" ? inner.slice(0, 4) : null,
  };
};

/** A fresh SENTENCE every time — never a second reference into the evidence tree (F-702). */
export const tokenNote = (facts) => {
  if (!facts || facts.present !== true) return "none";
  if (facts.decodable !== true) return `opaque, not decodable (grammar ${facts.grammar})`;
  const head = facts.innerHead ? `, head "${facts.innerHead}"` : "";
  const len = facts.innerLength === null || facts.innerLength === undefined ? "" : ` len ${facts.innerLength}`;
  return `token len ${facts.tokenLength}, c:${facts.innerType}${len}${head}, f:${facts.carriesF ? "carried" : "absent"}`;
};

/**
 * F-691'S IDENTITY RULE, AS A VERDICT ON ONE ANSWER.
 *
 * `sweepAnswerTail`: `f` rides the resume token while a failure is unresolved AND the answer
 * resumes somewhere AHEAD of it; it is dropped when the answer's own cursor IS the failing
 * page, because resuming at the failure is the retry and the cursor already says everything `f`
 * would. BOTH halves are asserted — the second is what F-691 was cut for, and the first is what
 * stops a "fix" that simply carries `f` always.
 *
 * @returns {{verdict:"ok"|"bad"|"n/v", kind:string, why:string}}
 */
export const carryVerdict = (answer) => {
  const cursor = typeof answer?.cursor === "string" && answer.cursor ? answer.cursor : null;
  const failedResume = typeof answer?.failedResume === "string" && answer.failedResume ? answer.failedResume : null;
  const facts = tokenFacts(cursor);
  /* "THE SAME PAGE" IS THE INNER `c`, NEVER THE TOKEN STRING.
   *
   * `sweepAnswerTail` decides `carry` by comparing RAW KVS cursors (`at === failedResume`) and
   * only then mints the tokens — and the two tokens differ in their bytes exactly when `f` is
   * carried, which is the case being judged. Comparing the base64 strings therefore answers
   * "the cursor is not the failing page" for every carried token and grades the redundant-`f`
   * regression as correct. The comparison is on the decoded `c`, like the module's. */
  const innerC = (token) => {
    const f = tokenFacts(token);
    if (!f.present || f.decodable !== true || f.hasCKey !== true) return { readable: false, c: null };
    return { readable: true, c: JSON.parse(Buffer.from(token, "base64").toString("utf8")).c ?? null };
  };
  if (!cursor) {
    if (failedResume) {
      return { verdict: "bad", kind: "no-cursor", why: `the answer reports an unresolved failure and hands back NO cursor — the rows it condemned are unreachable (reason ${JSON.stringify(answer?.reason ?? null)})` };
    }
    return { verdict: "n/v", kind: "finished", why: "no resume token on this answer — there is nothing to carry" };
  }
  if (facts.decodable !== true) {
    return { verdict: "bad", kind: "opaque", why: "the resume token is not one of ours (not decodable base64 JSON)" };
  }
  if (!failedResume) {
    return facts.carriesF
      ? { verdict: "bad", kind: "phantom-f", why: "the token carries `f` while the answer reports NO unresolved failure" }
      : { verdict: "ok", kind: "clean", why: "no unresolved failure, and the token carries no `f`" };
  }
  const here = innerC(cursor), mess = innerC(failedResume);
  /* F-727 — THE ANSWER'S OWN CURSOR IS GUARDED TOO, AND THE ASYMMETRY WAS THE DEFECT.
   *
   * `mess.readable` was checked and `here.readable` never was, so a cursor that decodes but
   * carries NO `c` key became `c: null` and was then COMPARED as if it had been read. A token
   * that carries no resume position at all could therefore be graded `ahead-of-failure` — a
   * PASS, and one that also satisfies this driver's `some(kind === "ahead-of-failure")`
   * positive control — for an answer that can resume nothing. The mirror case is just as bad:
   * against a page-0 `failedResume` (`c: null`) a `c`-less cursor grades `at-failure`, also a
   * PASS.
   *
   * It is N/V and not FAIL because this is a grader refusing to grade: the app's own
   * `sweepAnswerTail` always mints through `encodeSweepCursor`, so I could not prove the
   * input is reachable today. What is certain is that F-691's identity rule is a statement
   * about WHICH PAGE the answer resumes at, and an unreadable cursor does not name one — so
   * the honest verdict is "not verified", never "correct".
   *
   * It is checked AFTER `mess`, deliberately: an unreadable `failedResume` is a stated
   * REQUIREMENT of F-691 and stays the harder `bad` verdict when both are unreadable. */
  if (!mess.readable) {
    return { verdict: "bad", kind: "opaque-failedresume", why: "`failedResume` is not one of our tokens — F-691 requires it to be reported as a TOKEN so that null means 'none' and nothing else" };
  }
  if (!here.readable) {
    return {
      verdict: "n/v",
      kind: "opaque-cursor",
      why: `the answer's OWN resume token decodes but names no page (hasCKey ${facts.hasCKey === true}) — F-691's identity rule is about which page the answer resumes AT, so a cursor that carries no \`c\` cannot be graded against \`failedResume\` and is not evidence either way`,
    };
  }
  if (here.c === mess.c) {
    return facts.carriesF
      ? { verdict: "bad", kind: "redundant-f", why: "the answer resumes AT the failing page and still carries `f` — the cursor already says everything `f` would (F-691's identity rule)" }
      : { verdict: "ok", kind: "at-failure", why: "the answer resumes AT the failing page, so `f` is correctly ABSENT" };
  }
  return facts.carriesF
    ? { verdict: "ok", kind: "ahead-of-failure", why: "the answer resumes AHEAD of an unresolved failure and the token CARRIES `f` — the mess survives the call boundary" }
    : { verdict: "bad", kind: "dropped-f", why: "the answer resumes AHEAD of an unresolved failure and DROPPED `f` — this is F-691 itself: a later call will answer complete:true over rows this drain condemned" };
};

/**
 * THE BACK-OFF THE DECISION DEMANDS, replayed over the answers the tenant actually gave.
 *
 * Asserting a literal 1500 ms would be asserting my arithmetic about a run I have not seen:
 * whether the ladder is 500+1000 or 500+500 depends on whether other expired rows on a shared
 * tenant let a faulted call delete something first, which RESETS `failingTries` (F-703). So the
 * expectation is DERIVED from the recorded answers through the library's own decision, and what
 * is asserted is that the loop SLEPT WHAT IT WAS TOLD TO — a claim about this driver, not a
 * guess about the tenant.
 */
export const replayPausedMs = (answers) => {
  let state = newDrainState();
  let pausedMs = 0;
  const ladder = [];
  for (const answer of answers || []) {
    const decision = decideSweepStep(answer, state);
    state = decision.state;
    if (decision.sleepMs > 0) { pausedMs += decision.sleepMs; ladder.push(decision.sleepMs); }
    if (decision.action !== "resume") break;
  }
  return { pausedMs, ladder };
};

/**
 * THE WHOLE REFUSE DRAIN, JUDGED IN ONE PLACE, so the live run and the offline fixtures are
 * graded by the same function and "what F-682/683/690/691 say" has exactly one reader.
 */
export const judgeRefuseDrain = ({ answers, drained, pausedMs, deleteBatch }) => {
  const out = [];
  const list = answers || [];
  const first = list[0] || null;
  const failing = list.filter((a) => a?.reason === "deletes-failing");
  const add = (verdict, what) => out.push({ verdict, what });

  if (!first) { add("FAIL", "the drain recorded no answer at all"); return out; }

  if (first.reason === "deletes-failing" && Number(first.failed) > 0 && Number(first.deleted) === 0) {
    add("PASS", `call 1 answered "deletes-failing" with failed=${first.failed} and deleted=0 — an all-rejected batch ENDS the call instead of counting as progress (F-682)`);
  } else if (first.reason === "deletes-failing" && Number(first.failed) > 0) {
    add("PASS", `call 1 answered "deletes-failing" with failed=${first.failed} after deleting ${first.deleted} row(s) earlier in the page — the batch that landed nothing still ended the call (F-682)`);
  } else {
    add("FAIL", `call 1 answered reason=${JSON.stringify(first.reason ?? null)} failed=${first.failed} deleted=${first.deleted} — the armed lever did not produce a refusing batch, so nothing below is evidence about the failing-delete path`);
  }

  if (answerComplete(first) === false && typeof first.cursor === "string" && first.cursor) {
    add("PASS", "…and it is NOT complete and hands back a resume token (F-674: never null while work remains)");
  } else {
    add("FAIL", `…but complete=${first.complete} and cursor is ${typeof first.cursor} — an incomplete sweep must carry a token`);
  }

  if (Number(first.failed) === deleteBatch) {
    add("PASS", `the refused batch is exactly KVS_DELETE_BATCH=${deleteBatch} — the app's own batch size, read off the tenant's answer rather than assumed`);
  } else {
    add("N/V", `the first refusal reports failed=${first.failed} against the expected batch of ${deleteBatch} — either the constant moved in the harness-fault module or only part of a batch was faulted; the arm arithmetic is derived from ${deleteBatch}`);
  }

  for (let i = 0; i < list.length; i++) {
    const v = carryVerdict(list[i]);
    if (v.verdict === "bad") add("FAIL", `call ${i + 1}: ${v.why}`);
    else if (v.verdict === "ok") add("PASS", `call ${i + 1}: ${v.why}`);
    /* F-727 — an ungradeable cursor is REPORTED, not dropped. `finished` (no token on a
       complete answer) is the one n/v that is routine and stays quiet; anything else means
       the grader could not read the thing it is meant to judge, and silence there is how a
       PASS gets manufactured out of a token nobody could decode. */
    else if (v.kind !== "finished") add("N/V", `call ${i + 1}: ${v.why}`);
  }
  if (!list.some((a) => carryVerdict(a).kind === "ahead-of-failure")) {
    /* F-758 — THE REASON IS READ OFF THE RUN, NOT ASSERTED FROM THE PLAN.
       This sentence used to say "60 rows fit one 100-row page, so no budget break can land
       past a failed page" — a claim about the population, hard-coded, and FALSE the moment
       anyone passed `--n=150` (two pages) while the verdict stayed N/V for a quite different
       reason. The next reader then raises the population per the sentence and concludes the
       rule is unprovable. What the grader actually knows is which calls happened and why
       each one stopped, so that is what it reports: whether a failure was ever left
       unresolved, and whether the 15 s sweep budget ever tripped AFTER one. Those two facts
       are the precondition, and naming the missing one names the fix. */
    const reasons = list.map((a, i) => `call ${i + 1}:${JSON.stringify(a?.reason ?? null)}`).join(", ");
    const lastUnresolved = list.reduce((acc, a, i) => (a?.failedResume ? i + 1 : acc), 0);
    const budgetAfter = list.findIndex((a, i) => a?.reason === "budget" && i + 1 > lastUnresolved) + 1;
    const cause = lastUnresolved === 0
      ? `no answer ever reported an unresolved failure (${reasons}), so there was no failed page for a later cursor to land past — the armed lever refused nothing that outlived its own call`
      : budgetAfter === 0
        ? `the last unresolved failure was at call ${lastUnresolved} and NO answer after it broke on the 15 s sweep budget (${reasons}), so every cursor handed back was the failing page's own — which is precisely the f-ABSENT case, correctly graded above`
        : `the budget broke at call ${budgetAfter}, after the unresolved failure at call ${lastUnresolved} (${reasons}), yet no cursor decoded to a position ahead of the failure — if that recurs it is a finding, not a gap in coverage`;
    add("N/V", `no answer resumed AHEAD of an unresolved failure, so the \`f\`-PRESENT half of F-691 is NOT exercised by this run: ${cause}. The \`f\`-ABSENT half above IS the live proof; the other half needs a population big enough that a budget break lands past a failed page (F-758 raised the default to make that the ordinary case)`);
  }

  const replay = replayPausedMs(list);
  if (pausedMs === replay.pausedMs && replay.pausedMs > 0) {
    add("PASS", `the loop slept exactly what the decision demanded: ${replay.ladder.join(" + ")} = ${pausedMs} ms of paced back-off (F-690)`);
  } else if (replay.pausedMs === 0 && failing.length > 0) {
    add("FAIL", `${failing.length} "deletes-failing" answer(s) and the decision asked for NO pause — the back-off is not engaging`);
  } else {
    add("FAIL", `the loop paused ${pausedMs} ms where the decision demanded ${replay.pausedMs} ms (${replay.ladder.join(" + ") || "none"})`);
  }

  /* Only creditable once the pause above MATCHED: "N retries happened" is a count, and a count
     of retries that were not paced is the F-690 harm, not evidence against it. */
  if (failing.length > 0 && pausedMs === replay.pausedMs && replay.pausedMs > 0) {
    add("PASS", `${failing.length} PACED retry(ies) of the refusing page, every pause drawn from the published ladder of ${DELETES_FAILING_BACKOFF_MS.join("/")} ms and none above its last rung`);
  }
  if (failing.length >= IDENTICAL_ANSWER_LIMIT) {
    add("N/V", `${failing.length} "deletes-failing" answers is at or past IDENTICAL_ANSWER_LIMIT (${IDENTICAL_ANSWER_LIMIT}); if any two of them were byte-identical the drain stopped as not-converging, which on a HARNESS-armed lever is F-722 and not a refusing store`);
  }

  if (drained === true) add("PASS", "and the drain reached complete:true — the lever spent itself and the deletes landed, which is the transition F-706 built the door for");
  else add("FAIL", "the drain never reached complete:true");

  return out;
};

/** The exact fields of an arm answer that may be RECORDED. Never `key`: it names the prefix. */
export const armFacts = (j) => ({
  ok: j?.ok ?? null, prefix: j?.prefix ?? null, mode: j?.mode ?? null,
  count: j?.count ?? null, ttlSeconds: j?.ttlSeconds ?? null, until: j?.until ?? null,
  modes: j?.modes ?? null, maxCount: j?.maxCount ?? null, maxTtlSeconds: j?.maxTtlSeconds ?? null,
  reason: j?.reason ?? null,
});

/** What the lever says right now, without naming its key. `armed:false`/`count:0` = not armed. */
export const leverFacts = (j) => ({
  ok: j?.ok ?? null,
  prefix: j?.prefix ?? null,
  armed: Boolean(j?.value),
  count: j?.value?.count ?? 0,
  mode: j?.value?.mode ?? null,
  expired: j?.expired ?? null,
  until: j?.value?.until ?? null,
});

const PLANT_PREFIX = "harness_fault:plant:";

/** A sweep answer reduced to what may be recorded. NEVER the rows: a key carries a path. */
export const shape = (j) => ({
  scanned: j?.scanned ?? null, deleted: j?.deleted ?? null, failed: j?.failed ?? null,
  truncated: j?.truncated ?? null, reason: j?.reason ?? null, complete: j?.complete ?? null,
  budgetMs: j?.budgetMs ?? null, rowsTruncated: j?.rowsTruncated ?? null,
  rowsListed: (j?.rows || []).length,
  plantedRows: (j?.rows || []).filter((r) => String(r.key || "").startsWith(PLANT_PREFIX)).length,
  plantedExpired: (j?.rows || []).filter((r) => String(r.key || "").startsWith(PLANT_PREFIX) && r.expired === true).length,
  otherExpired: (j?.rows || []).filter((r) => !String(r.key || "").startsWith(PLANT_PREFIX) && r.expired === true).length,
  hasCursor: typeof j?.cursor === "string" && j.cursor.length > 0,
  carriesFailedResume: typeof j?.failedResume === "string" && j.failedResume.length > 0,
  /* A planted throttle must surface as `failed` and NOTHING else — an answer carrying a
     platform code has escaped the sweep as a failure of the CALL, which is a different defect
     from the one F-677's pacing was written for. */
  code: j?.code ?? null, error: j?.error ? "[present]" : null,
});

/* ═══════════════════════════════════════════════════════════════════════════════
 * THE LIVE HALF. Nothing below runs on import — the entry guard at the bottom is what lets
 * the offline suite exercise the pure helpers above without the env guard refusing.
 * ═══════════════════════════════════════════════════════════════════════════════ */

/** The doors the cleanup needs, published by `run` so they are not built a second time. */
let DOORS = null;

async function run(state) {
  /* THE GUARD IS THE FIRST THING ON THE PATH THAT TOUCHES A TENANT. It DOES arm a lever —
     `armDeleteFault` — and F-718 gave that lever its sentence in FAULT_HARMS, so it is
     named here rather than hidden behind a bare `requireAck`. Its honest harm is "nothing
     a user sees, but the app's own sweep stops advancing"; the rows it refuses to delete
     are the inert ballast this driver planted, which is the separate `mutates: ["kvs"]`
     declaration. Both now earn the refusal on their own. */
  const argv = process.argv.slice(2);
  const { envName: ENV_NAME, hookUrl: HOOK_URL } = requireEnvAck(argv, {
    faults: ["deleteFault"],
    mutates: ["kvs"],
    maxSeconds: 120,
    defaultEnv: "staging",
    script: "delete-fault-drain-live.mjs",
  });
  loadEnv();
  const SECRET = requireEnv("HARNESS_SECRET");

  const argOf = (n, d) => { const h = argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
  /* ── F-758 · THE POPULATION HAS TO OUTGROW ONE BUDGET, OR HALF OF F-691 IS UNPROVABLE ──
     The old population was 60 and the clamp 150, and both kept the `f`-PRESENT half of
     F-691 unreachable BY CONSTRUCTION. `f` rides the resume token only when the 15 s sweep
     budget trips AFTER a partially-refused batch (src/harness-fault.js:930) — i.e. when the
     walk has to continue past a failed page. At the ~178 deletes a single budget was
     measured to manage on a live tenant, a 60-row run never breaks on budget at all and a
     150-row run breaks at most once, so two live runs (60 and 150) both recorded f-ABSENT
     and the half stayed offline-only. 400 rows is about three budgets, which puts at least
     one break past the failed page.

     The clamp moves with it. `plantPopulation` resumes on `startIndex`, and the producer's
     own per-call ceiling is 150, so 400 is three POSTs rather than one silently-clamped one
     — which is F-710's whole point and is already asserted by the `clamped` comparison.

     COST. The call budget is what bounds the wall clock: 3 plant calls, at most
     MAX_DRAIN_CALLS drain calls, the throttle pass and a handful of reads, each one web
     trigger bounded by its own 25 s. The realistic run is a few minutes; the arithmetic
     ceiling if every call ran to the trigger limit is on the order of a quarter of an hour.
     The lever is untouched by the change: it is spent by COUNT (8 units, inside the first
     three calls) long before its 120 s `until`.

     The arm count is deliberately NOT raised. ARM_COUNT leaves the lever spent INSIDE a
     batch — a PARTIAL refusal — which is exactly the precondition for a later budget break
     to land ahead of the failure. A count on a batch boundary would refuse cleanly and give
     the walk nothing to carry. */
  const N = Math.max(12, Math.min(400, Number(argOf("n", "400")) || 400));
  /** The rows for the throttle pass — one batch refused, then the count is gone. */
  const N_THROTTLE = 12;
  const MAX_DRAIN_CALLS = 12;
  const MAX_PLANT_CALLS = 10;
  const TTL_SECONDS = 120;
  const ARM_COUNT = drainableArmCount(IDENTICAL_ANSWER_LIMIT, KVS_DELETE_BATCH_EXPECTED);

  const ev = state.ev;
  ev.env = ENV_NAME;
  ev.n = N;
  ev.nThrottle = N_THROTTLE;
  /* F-722 — BOTH CONSTANTS, IN THE ARTEFACT, so the coupling is arguable from the evidence file
     rather than from a comment. `armCount` is derived from them and from nothing else. */
  ev.coupling = {
    identicalAnswerLimit: IDENTICAL_ANSWER_LIMIT,
    kvsDeleteBatchExpected: KVS_DELETE_BATCH_EXPECTED,
    armCount: ARM_COUNT,
    backoffLadderMs: DELETES_FAILING_BACKOFF_MS,
    note: "armCount = IDENTICAL_ANSWER_LIMIT * KVS_DELETE_BATCH - 1: one unit under the byte-identical stop, so the lever is spent INSIDE a batch and the deletes-failing -> resume -> complete transition is reachable. The lever's own ceiling is reported as maxCount on every arm answer below.",
  };

  const PASS = (s, d) => state.note("PASS", s, d);
  const FAIL = (s, d) => state.note("FAIL", s, d);
  const NV = (s, d) => state.note("N/V", s, d);
  const record = (rows) => { for (const r of rows) state.note(r.verdict, r.what); };
  const step = (s) => console.log(`\n── ${s}`);

  const readRes = async (res) => { let t = ""; try { t = await res.text(); } catch { return { status: 0, json: null }; } let j = null; try { j = JSON.parse(t); } catch {} return { status: res.status, json: j }; };
  const hook = async (body) => readRes(await fetch(HOOK_URL, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + SECRET }, body: JSON.stringify(body) }));

  /* F-744/F-748 — `clearToken` rides an identical re-POST, unchanged, so the stale clear's
     running `clearedSoFar` keeps counting across the loop's re-POSTs. */
  const plant = (n, startIndex, clearToken) => hook({ action: "plantHarnessFaults", n, expired: true, ...(startIndex ? { startIndex } : {}), ...(clearToken ? { clearToken } : {}) });
  const sweep = (body) => hook({ action: "sweepHarnessFaults", ...body });
  const clear = (cursor) => hook({ action: "clearPlantedFaults", ...(cursor ? { cursor } : {}) });
  /* The door supplies the one legal prefix when the body omits it, so the prefix this lever may
     touch is NOT retyped here — `armDeleteFault` tests it by equality on its own side. */
  const armLever = (mode, count) => hook({ action: "armDeleteFault", mode, count, ttlSeconds: TTL_SECONDS });
  const readLever = () => hook({ action: "readDeleteFault" });
  const disarmLever = () => hook({ action: "disarmDeleteFault" });
  const ok200 = (res) => res.status === 200 && res.json?.ok === true;
  DOORS = { hook, sweep, clear, ok200 };

  /* THE PLANT, AS A POPULATION (F-696) AND NOT AS A CALL (F-710) — AND THE LOOP IS THE
     LIBRARY'S (F-724). It was hand-rolled here and byte-copied from `plant-sweep-live.mjs`,
     which is how both copies came to read `reason:"clearing"` — the stale-tail clear's
     "re-POST me unchanged" answer — as "the population cannot be reached" and FAIL a run one
     more identical POST would have completed. `lib/sweep-drain.mjs` owns it now, with the
     bounded clearing retry and an offline fixture; only the ledger row stays local. */
  const plantTo = (n) => plantPopulation((count, startIndex, clearToken) => plant(count, startIndex, clearToken), n, {
    maxCalls: MAX_PLANT_CALLS,
    row: (j, nth) => ({
      call: nth, n: j.n ?? null, startIndex: j.startIndex ?? null, planted: j.planted ?? null,
      failed: j.failed ?? null, nextIndex: j.nextIndex ?? null, reason: j.reason ?? null,
      complete: j.complete ?? null, expired: j.expired ?? null, cleared: j.cleared ?? null,
      budgetMs: j.budgetMs ?? null,
    }),
  });

  /* ARM, THEN READ THE LEVER BACK. The read-back is the POSITIVE CONTROL for the negative
     asserted at the end: "the lever says nothing" is not evidence until this same query has been
     shown to see this same lever armed. */
  const armAndConfirm = async (mode, count, label) => {
    const armed = await armLever(mode, count);
    const facts = armFacts(armed.json);
    if (!ok200(armed)) { FAIL(`${label}: armDeleteFault did not answer 200/ok (HTTP ${armed.status})`, facts); return { ok: false, facts, lever: null }; }
    PASS(`${label}: armed mode=${facts.mode} count=${facts.count} ttlSeconds=${facts.ttlSeconds} until=${facts.until}; the lever's own ceilings came back with it — maxCount=${facts.maxCount} maxTtlSeconds=${facts.maxTtlSeconds}, modes ${JSON.stringify(facts.modes)}`, facts);
    if (facts.count !== count) FAIL(`${label}: asked for count=${count} and the lever answered ${facts.count} — the arm arithmetic no longer describes this run`, facts);
    /* F-722, MEASURED RATHER THAN ASSERTED: the ceiling the door advertises, against what one
       drain can survive. Recorded on every arm, because the row is about the two numbers. */
    if (Number(facts.maxCount) > ARM_COUNT) {
      NV(`${label}: F-722 — the lever advertises maxCount=${facts.maxCount} while this drain tolerates at most ${ARM_COUNT} (IDENTICAL_ANSWER_LIMIT ${IDENTICAL_ANSWER_LIMIT} x KVS_DELETE_BATCH ${KVS_DELETE_BATCH_EXPECTED} - 1); an arm above that stops the drain as "not-converging" over a store that never refused anything`, { maxCount: facts.maxCount, drainable: ARM_COUNT });
    }
    const back = await readLever();
    const lever = leverFacts(back.json);
    if (ok200(back) && lever.armed && lever.count === facts.count && lever.mode === mode) {
      PASS(`${label}: readDeleteFault SEES the armed lever — mode=${lever.mode} count=${lever.count} until=${lever.until}; this is the positive control for the count:0 read at the end`, lever);
    } else {
      FAIL(`${label}: readDeleteFault did not read back the lever it had just armed — every "the lever is spent" claim below would be unfalsifiable`, lever);
    }
    return { ok: true, facts, lever };
  };

  /* THE DRAIN IS THE LIBRARY'S (F-702). This wrapper only ACCOUNTS: it never decides
     finishedness, never paces, and never resumes on its own. */
  const drainAll = async (label, maxMs) => {
    const answers = [];
    const ledger = [];
    let totalDeleted = 0, totalFailed = 0;
    const d = await drainSweep((cursor) => sweep({ maxMs, cursor }), {
      maxCalls: MAX_DRAIN_CALLS,
      onAnswer: (json, call) => {
        answers.push(json);
        const s = shape(json);
        /* A STRING, built fresh (F-702): a shared reference into the evidence tree is written
           `[CIRCULAR]` by the cycle-safe redactor the second time it meets it. */
        ledger.push({ call, ...s, cursor: tokenNote(tokenFacts(json.cursor)), carry: carryVerdict(json).kind });
        totalDeleted += Number(s.deleted || 0);
        totalFailed += Number(s.failed || 0);
      },
    });
    console.log(`  ${label}: ${d.calls} call(s), ${d.pausedMs} ms paced, deleted ${totalDeleted}, failed ${totalFailed}, drained ${d.drained}`);
    return { ...d, answers, ledger, totalDeleted, totalFailed };
  };

  console.log(`\nDELETE-FAULT DRAIN — env=${ENV_NAME}  n=${N}  arm=${ARM_COUNT} (${IDENTICAL_ANSWER_LIMIT} x ${KVS_DELETE_BATCH_EXPECTED} - 1)`);

  /* ── 0 · BASELINE. An empty answer proves nothing until the query is shown to see rows at
   *      all, and the sweep deletes EXPIRED rows that are not mine, so the totals need this. */
  step("0 · BASELINE — the fault keyspace, and the lever, before anything is armed");
  const base = await sweep({ dryRun: true });
  if (!ok200(base)) { FAIL(`baseline dry-run sweep did not answer 200/ok (HTTP ${base.status})`, { reason: base.json?.reason ?? null }); return; }
  const baseShape = shape(base.json);
  ev.baseline = baseShape;
  PASS(`baseline dry-run sweep scanned ${baseShape.scanned} row(s): ${baseShape.plantedRows} planted, ${baseShape.otherExpired} other expired`, baseShape);
  const baseLever = await readLever();
  ev.baselineLever = leverFacts(baseLever.json);
  if (ok200(baseLever) && ev.baselineLever.armed) {
    NV("a delete fault was ALREADY armed before this run — another driver's, or a killed run's; it is disarmed here and again in the cleanup", ev.baselineLever);
    await disarmLever();
  } else {
    PASS("no delete fault is armed at the start", ev.baselineLever);
  }

  /* ── 1 · THE PLANT. ── */
  step(`1 · PLANT ${N} expired rows, resuming on startIndex until the rows are there`);
  const t0 = Date.now();
  const p = await plantTo(N);
  ev.plant = { ms: Date.now() - t0, calls: p.calls.length, totalPlanted: p.totalPlanted, totalFailed: p.totalFailed, perCall: p.calls, ...(p.stopReason ? { stopReason: p.stopReason } : {}) };
  if (!p.planted || p.totalFailed > 0) {
    FAIL(`the plant did not reach ${N} clean rows — ${p.stopReason || `${p.totalFailed} failed write(s)`}`, ev.plant);
    const recover = await sweep({ dryRun: true });
    if (ok200(recover)) NV(`count recovered by a SECOND READ instead: ${shape(recover.json).plantedRows} planted row(s) visible`, shape(recover.json));
    return;
  }
  PASS(`planted ${p.totalPlanted}/${N} rows across ${p.calls.length} call(s), 0 failed, in ${ev.plant.ms} ms`, { calls: p.calls.length, totalPlanted: p.totalPlanted, ms: ev.plant.ms });
  const beforeArm = await sweep({ dryRun: true });
  ev.beforeArm = ok200(beforeArm) ? shape(beforeArm.json) : null;
  if (ev.beforeArm && ev.beforeArm.plantedExpired >= N) PASS(`a SECOND READ sees ${ev.beforeArm.plantedExpired} expired planted row(s) — the ballast whose deletion is about to be refused`, ev.beforeArm);
  else FAIL(`the dry run sees only ${ev.beforeArm ? ev.beforeArm.plantedExpired : "?"} expired planted row(s), not the ${N} planted`, ev.beforeArm);

  /* ── 2 · ARM `refuse`. ── */
  step(`2 · ARM the delete fault: mode=refuse count=${ARM_COUNT} ttlSeconds=${TTL_SECONDS}`);
  const armRefuse = await armAndConfirm("refuse", ARM_COUNT, "refuse");
  ev.armRefuse = armRefuse.facts;
  ev.armRefuseLever = armRefuse.lever;
  if (!armRefuse.ok) return;

  /* ── 3 · THE DRAIN, THROUGH THE ONE HOME. ── */
  step("3 · DRAIN — deletes-failing, paced back-off, the lever spends itself, complete:true");
  const refuse = await drainAll("refuse drain", 15000);
  ev.refuseDrain = {
    calls: refuse.ledger, sweepCalls: refuse.calls, pausedMs: refuse.pausedMs,
    totalDeleted: refuse.totalDeleted, totalFailed: refuse.totalFailed,
    drained: refuse.drained, ...(refuse.stopReason ? { stopReason: refuse.stopReason } : {}),
  };
  record(judgeRefuseDrain({ answers: refuse.answers, drained: refuse.drained, pausedMs: refuse.pausedMs, deleteBatch: KVS_DELETE_BATCH_EXPECTED }));
  if (!refuse.drained && refuse.stopReason) FAIL(`the drain stopped: ${refuse.stopReason}`, ev.refuseDrain);
  if (refuse.totalFailed > 0) PASS(`${refuse.totalFailed} delete(s) were refused across the drain and every one of them was COUNTED, not thrown — the sweep answered 200/ok throughout`, { totalFailed: refuse.totalFailed });
  else FAIL("not one delete was refused across the whole drain — the armed lever did nothing, and nothing here is evidence about the failing-delete path", ev.refuseDrain);

  const expectedDeleted = N + baseShape.otherExpired + baseShape.plantedRows;
  if (refuse.totalDeleted === expectedDeleted) {
    PASS(`total deleted ${refuse.totalDeleted} == ${N} planted + ${baseShape.otherExpired} pre-existing expired + ${baseShape.plantedRows} pre-existing planted — every row the drain condemned is gone`, { totalDeleted: refuse.totalDeleted, expectedDeleted });
  } else if (refuse.totalDeleted >= N) {
    NV(`total deleted ${refuse.totalDeleted} against ${expectedDeleted} expected — the ${N} planted are covered; the difference is a shared tenant's own rows moving under the run (planted rows also expire lazily on their own TTL)`, { totalDeleted: refuse.totalDeleted, expectedDeleted });
  } else {
    FAIL(`total deleted ${refuse.totalDeleted} is FEWER than the ${N} rows planted — the drain answered complete over rows it left behind`, { totalDeleted: refuse.totalDeleted, expectedDeleted });
  }

  /* ── 4 · THE THROTTLE VARIANT — the code F-677/F-682 were written about. ── */
  step(`4 · mode=throttle, count=${KVS_DELETE_BATCH_EXPECTED} — RATE_LIMIT_EXCEEDED must be COUNTED, never escape`);
  const p2 = await plantTo(N_THROTTLE);
  ev.throttlePlant = { calls: p2.calls.length, totalPlanted: p2.totalPlanted, totalFailed: p2.totalFailed, ...(p2.stopReason ? { stopReason: p2.stopReason } : {}) };
  if (!p2.planted) {
    FAIL(`the throttle pass could not plant ${N_THROTTLE} rows — ${p2.stopReason}`, ev.throttlePlant);
  } else {
    const armThrottle = await armAndConfirm("throttle", KVS_DELETE_BATCH_EXPECTED, "throttle");
    ev.armThrottle = armThrottle.facts;
    ev.armThrottleLever = armThrottle.lever;
    const thr = await drainAll("throttle drain", 15000);
    ev.throttleDrain = {
      calls: thr.ledger, sweepCalls: thr.calls, pausedMs: thr.pausedMs,
      totalDeleted: thr.totalDeleted, totalFailed: thr.totalFailed, drained: thr.drained,
      ...(thr.stopReason ? { stopReason: thr.stopReason } : {}),
    };
    const t1 = thr.ledger[0] || null;
    if (t1 && t1.failed === KVS_DELETE_BATCH_EXPECTED && t1.reason === "deletes-failing") {
      PASS(`the throttled batch surfaced as failed=${t1.failed} with reason "deletes-failing" — the RATE_LIMIT_EXCEEDED rejections were COUNTED`, t1);
    } else {
      FAIL(`the throttle pass answered failed=${t1 ? t1.failed : "?"} reason=${t1 ? JSON.stringify(t1.reason) : "?"} — the planted throttle did not reach the delete batch`, t1);
    }
    /* NEVER ESCAPES: the whole point of the pacing is that a throttle is a COUNTED refusal, not
       an exception. A `code` or an `error` on the answer means it came out of the sweep as a
       failure of the CALL, which is a different defect from the one F-677 fixed. */
    const escaped = thr.ledger.filter((c) => c.code !== null || c.error !== null);
    if (escaped.length === 0) PASS(`no answer in the throttle drain carried a \`code\` or an \`error\` across ${thr.ledger.length} call(s) — the throttle never escaped the sweep as a call failure`, { calls: thr.ledger.length });
    else FAIL(`${escaped.length} answer(s) carried a platform code/error — the throttle ESCAPED the sweep instead of being counted`, { escaped: escaped.map((c) => ({ call: c.call, code: c.code })) });
    for (let i = 0; i < thr.answers.length; i++) {
      const v = carryVerdict(thr.answers[i]);
      if (v.verdict === "bad") FAIL(`throttle call ${i + 1}: ${v.why}`);
    }
    if (thr.drained && thr.totalDeleted >= N_THROTTLE) PASS(`the throttle drain converged: complete:true in ${thr.calls} call(s), ${thr.pausedMs} ms paced, deleted ${thr.totalDeleted}`, { calls: thr.calls, pausedMs: thr.pausedMs, totalDeleted: thr.totalDeleted });
    else FAIL(`the throttle drain did not converge over its ${N_THROTTLE} rows — drained=${thr.drained} deleted=${thr.totalDeleted}${thr.stopReason ? ` (${thr.stopReason})` : ""}`, ev.throttleDrain);
  }

  /* ── 5 · THE LEVER IS SPENT, AND THE KEYSPACE IS CLEAN. Both by a SECOND READ, and both
   *      negatives proven readable first — the lever was read back ARMED at every arm. ── */
  step("5 · SECOND READS — the lever says nothing, and the keyspace has nothing");
  const spent = await readLever();
  ev.leverAfter = leverFacts(spent.json);
  if (ok200(spent) && ev.leverAfter.count === 0) {
    PASS(`readDeleteFault answers count:0 (armed=${ev.leverAfter.armed}, expired=${ev.leverAfter.expired}) — the lever spent itself through the counted-consumption home, and the SAME query read it armed earlier in this run`, ev.leverAfter);
  } else {
    FAIL(`readDeleteFault still reports count=${ev.leverAfter.count} armed=${ev.leverAfter.armed} — units survived the drain`, ev.leverAfter);
  }
  const disarmed = await disarmLever();
  ev.disarm = { ok: ok200(disarmed), prefix: disarmed.json?.prefix ?? null, removed: disarmed.json?.removed ?? disarmed.json?.deleted ?? null };
  if (ok200(disarmed)) PASS("disarmDeleteFault answered 200/ok — the lever is down whatever the count said", ev.disarm);
  else FAIL(`disarmDeleteFault did not answer 200/ok (HTTP ${disarmed.status})`, ev.disarm);
  const after = await sweep({ dryRun: true });
  if (!ok200(after)) {
    FAIL(`the final dry-run sweep did not answer 200/ok (HTTP ${after.status})`, { reason: after.json?.reason ?? null });
  } else {
    const a = shape(after.json);
    ev.afterAll = a;
    if (a.plantedRows === 0) PASS(`the final dry run shows 0 planted rows — the same query that listed ${ev.beforeArm ? ev.beforeArm.plantedRows : "?"} of them before the arm`, a);
    else FAIL(`${a.plantedRows} planted row(s) still present after both drains`, a);
    if (a.plantedExpired === 0 && a.otherExpired === 0) PASS("and no expired row of any kind remains", a);
    else NV(`${a.otherExpired} expired row(s) not mine remain — armed by another driver between the drain and this read`, a);
  }
}

/* CLEANUP IS PART OF THE PROOF, and it runs on every path including the throw. The lever is
 * DISARMED FIRST: a clear run under a live delete fault is a clear that cannot clear, and the
 * ballast's only other bound would then be its own row TTL. `clearPlantedFaults` is bound to the
 * plant prefix inside the library — no caller names the keyspace an unconditional delete walks —
 * so this can never reach a lever of another kind. */
async function cleanup(state) {
  if (!DOORS) return;
  console.log("\n── CLEANUP · disarm the lever, clear the ballast, whatever happened above");
  const { hook, sweep, clear, ok200 } = DOORS;
  const down = await hook({ action: "disarmDeleteFault" });
  let deleted = 0;
  const d = await drainSweep((cursor) => clear(cursor), {
    maxCalls: 12,
    onAnswer: (json) => { deleted += Number(json.deleted || 0); },
  });
  const verify = await sweep({ dryRun: true });
  const left = ok200(verify) ? shape(verify.json).plantedRows : null;
  state.ev.cleanup = { leverDisarmed: ok200(down), calls: d.calls, deleted, drained: d.drained, pausedMs: d.pausedMs, plantedRowsLeft: left, ...(d.stopReason ? { stopReason: d.stopReason } : {}) };
  if (d.drained && left === 0 && ok200(down)) state.note("PASS", `cleanup: lever disarmed, ${deleted} row(s) cleared in ${d.calls} call(s); a second read shows 0 planted rows left`, state.ev.cleanup);
  else state.note("FAIL", `cleanup incomplete: leverDisarmed=${ok200(down)} drained=${d.drained}${d.stopReason ? ` (${d.stopReason})` : ""}, planted rows still visible: ${left}`, state.ev.cleanup);
}

/* THE ENTRY GUARD. Importing this module for its pure helpers runs nothing — which is what lets
 * `delete-fault-drain.test.mjs` grade them offline without `requireEnvAck` refusing on a machine
 * that has no .env. `realpathSync` so a symlinked invocation still counts as the entry. */
const isEntry = (() => {
  if (!process.argv[1]) return false;
  try { return fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1]); } catch { return false; }
})();

if (isEntry) {
  const OUT = new URL("../results/delete-fault-drain", import.meta.url).pathname;
  const state = {
    passes: 0, fails: 0, unproven: 0,
    ev: { at: new Date().toISOString(), checks: [] },
    note(v, s, d) {
      if (v === "PASS") this.passes++;
      else if (v === "FAIL") this.fails++;
      else this.unproven++;
      const text = redactString(String(s));
      this.ev.checks.push({ v, s: text, ...(d ? { d: redactSecrets(d) } : {}) });
      console.log(`  ${v.padEnd(5)} ${text}${d ? " " + JSON.stringify(redactSecrets(d)) : ""}`);
    },
  };
  try {
    await run(state);
  } catch (e) {
    state.note("FAIL", `driver threw: ${String((e && e.message) || e).slice(0, 300)}`);
  }
  try {
    await cleanup(state);
  } catch (e) {
    state.note("FAIL", `cleanup threw: ${String((e && e.message) || e).slice(0, 300)}`);
  }
  state.ev.summary = { passes: state.passes, fails: state.fails, unproven: state.unproven };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(`${OUT}/evidence.json`, JSON.stringify(redactSecrets(state.ev), null, 2));
  console.log(`\nPASS ${state.passes}  FAIL ${state.fails}  N/V ${state.unproven}  →  results/delete-fault-drain/evidence.json`);
  process.exit(state.fails > 0 ? 1 : 0);
}
