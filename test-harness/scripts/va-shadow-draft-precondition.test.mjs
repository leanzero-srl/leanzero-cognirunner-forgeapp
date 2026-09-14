/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */
/*
 * F-846 — ONE UN-RUNNABLE PRECONDITION MUST PRODUCE ONE VERDICT.
 *
 * `va-shadow-live.mjs` graded F-414 with
 *   `else if (!drafts2.length) FAIL("no drafts remain after the second tick, so F-414
 *    could not be judged")`
 * — a sentence that says "could not be judged" and grades it RED — on exactly the run where
 * STEP 3 had already FAILED for the same empty `listVaDrafts`. Two reds, one cause, and the
 * cause was usually "this tenant had nothing owed", which is not a defect: the fixture stages
 * nothing of its own, and each item turn may legitimately end with nothing staged
 * (src/virtual-admin.js, the F-414 attempts branch).
 *
 * The two judges are PURE and live in the driver (lib/va-tick-receipt.mjs is the RECEIPT
 * library — live-driver-scope RULE 6 — and owns nothing about drafts). The driver cannot be
 * imported offline: its first statements call `requireEnvAck` and `loadEnv`, which refuse or
 * throw without a tenant and a `.env`. So the functions are fs+regex extracted and
 * re-materialised, the same way configs-filter.test.mjs and prompt-builders.test.mjs reach
 * into src/index.js.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * F-854 — AND THE WAIT THAT COULD ONLY STOP ON THE POSITIVE.
 *
 * The same step ran
 *   `pollStatus(jobId, (s) => Number(s.staged) >= 1, TICK_WAIT_S, "first staged draft")`
 * with ONE stop condition, so every run where nothing was ever going to stage spent the full
 * 240 s to reach an answer the prepare receipt — read a dozen lines ABOVE it — had already
 * given: `worked` is the number of `va-item` tasks the tick actually pushed
 * (src/va-admin.js `publicReceipt`, `worked = r.staged = fannedOut`), and `status.staged`
 * counts drafts, which only an item TURN can create. `worked === 0` therefore means
 * `staged` can never rise from this tick, and waiting cannot change it.
 *
 * And the sweep was graded `FAIL("the sweep found nothing: swept=…")` — the F-846 defect
 * again, one row up: this fixture sweeps whatever issues ALREADY EXIST in the project, so an
 * empty or fully-tracked project sweeps zero and that is a tenant state, not a defect. It
 * now goes through the same precondition judge (N/V unless `--expect-drafts`), and when it
 * fires, the draft row below is SUPPRESSED — one cause, one verdict, which is the whole of
 * F-846 and does not stop applying because the cause moved up a row.
 *
 * Run: node scripts/va-shadow-draft-precondition.test.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const here = path.dirname(fileURLToPath(import.meta.url));
const DRIVER = "va-shadow-live.mjs";
const src = readFileSync(path.join(here, DRIVER), "utf8");

const grab = (name) => {
  const m = src.match(new RegExp(`export function ${name}\\([\\s\\S]*?\\n\\}`));
  if (!m) { console.log(`FAIL: could not extract ${name} from ${DRIVER}`); process.exit(1); }
  return m[0].replace(/^export /, "");
};
// eslint-disable-next-line no-new-func
/* All four judges are PURE and take their receipt facts ALREADY READ (`receipt`,
   `unavailable`, `arm` come from lib/va-tick-receipt.mjs at the call site). That is what
   makes them materialisable here with no lib in scope — and it is also live-driver-scope
   RULE 6: the receipt list keeps exactly one reader, and it is not a judge. */
const { judgeDraftPrecondition, judgeRestageEvidence, judgeDraftPollStop, judgeSweepPrecondition } = new Function(
  `"use strict";
   ${grab("judgeDraftPrecondition")}
   ${grab("judgeRestageEvidence")}
   ${grab("judgeDraftPollStop")}
   ${grab("judgeSweepPrecondition")}
   return { judgeDraftPrecondition, judgeRestageEvidence, judgeDraftPollStop, judgeSweepPrecondition };`,
)();

/* ── 1. drafts staged: step 3 passes and step 6 is free to judge ──────────────── */
{
  const r = judgeDraftPrecondition({ expectedToStage: false, drafts: [{ itemKey: "JT-1" }, { itemKey: "JT-2" }] });
  ok(r.staged === true && r.count === 2, "two drafts read as staged");
  ok(r.stage.verdict === "PASS", "a staged run gives step 3 a PASS");
  ok(r.f414 === null, "…and hands step 6 nothing, so step 6 judges F-414 itself");
  ok(/2 staged draft\(s\)/.test(r.stage.what), "the PASS names the count");
}

/* ── 2. THE BUG: no drafts, nothing was required to stage ─────────────────────── */
{
  const r = judgeDraftPrecondition({ expectedToStage: false, drafts: [], detail: '{"success":true,"drafts":[]}' });
  ok(r.staged === false && r.count === 0, "an empty list reads as nothing staged");
  ok(r.stage.verdict === "N/V", "step 3 records N/V, not FAIL, when nothing was REQUIRED to stage");
  ok(/Remedy:/.test(r.stage.what), "…and the N/V carries the remedy the operator must apply");
  ok(/REQUIRED to stage/.test(r.stage.what), "…and names the precondition rather than blaming the product");
  ok(r.f414 !== null && r.f414.verdict === "N/V", "step 6 is handed an N/V, which is the whole of its row");
  ok(/reported in step 3/.test(r.f414.what), "…and that row POINTS AT step 3, so the two read as one story");
  ok(!/FAIL/.test(r.f414.what), "…and never words itself as a failure");
  /* The regression itself: exactly one non-PASS verdict for one cause, and it is not red. */
  const verdicts = [r.stage.verdict, r.f414.verdict];
  ok(verdicts.filter((v) => v === "FAIL").length === 0,
    "ONE un-runnable precondition produces ZERO red rows — the F-846 defect was two");
  ok(verdicts.length === 2 && verdicts.every((v) => v === "N/V"),
    "…and both rows are N/V, so nothing is silently dropped either");
}

/* ── 3. no drafts, but the run SAID one must stage ────────────────────────────── */
{
  const r = judgeDraftPrecondition({ expectedToStage: true, drafts: [], detail: "body" });
  ok(r.stage.verdict === "FAIL", "--expect-drafts turns an empty list into a real FAIL");
  ok(/MUST stage/.test(r.stage.what), "…and the FAIL says why it is a FAIL (the run asserted staging was due)");
  ok(r.f414.verdict === "N/V", "step 6 STILL only records N/V — the cause is already red once");
}

/* ── 4. step 6's own judgement, when the precondition held ────────────────────── */
{
  const gone = judgeRestageEvidence({ stagedBefore: 2, drafts: [], unchanged: true });
  ok(gone.verdict === "FAIL", "drafts that existed and are now GONE is a product event, and stays red");
  ok(/staged on the first tick are GONE/.test(gone.what), "…and the sentence is about disappearance, not about judgeability");

  const same = judgeRestageEvidence({ stagedBefore: 1, drafts: [{ itemKey: "JT-1" }], unchanged: true });
  ok(same.verdict === "PASS", "unchanged drafts after a re-tick is the F-414 PASS");

  const moved = judgeRestageEvidence({ stagedBefore: 1, drafts: [{ itemKey: "JT-1" }], unchanged: false });
  ok(moved === null, "a draft whose fields moved was already reported field by field — no second row");
}

/* ── 5. the shapes are applyVerdict rows, and the defaults are safe ───────────── */
{
  const keys = Object.freeze(["PASS", "FAIL", "N/V"]);
  const r = judgeDraftPrecondition({});
  ok(keys.includes(r.stage.verdict) && typeof r.stage.what === "string",
    "every row is an applyVerdict row: a known verdict plus a `what` sentence");
  ok(r.staged === false, "called with nothing at all, the judge assumes nothing staged rather than throwing");
  ok(judgeRestageEvidence({}).verdict === "FAIL", "…and the step-6 judge defaults to the empty-drafts arm");
}

/* ── 6. the call sites really use them (a judge nobody calls is a comment) ────── */
{
  ok(/judgeDraftPrecondition\(\{/.test(src), "the driver calls judgeDraftPrecondition");
  ok(/judgeRestageEvidence\(\{/.test(src), "the driver calls judgeRestageEvidence");
  ok(/applyVerdict\(draftPrecondition\.stage/.test(src), "step 3 dispatches through applyVerdict");
  ok(/applyVerdict\(draftPrecondition\.f414/.test(src), "step 6 dispatches the precondition row through applyVerdict");
  ok(!/no drafts remain after the second tick/.test(src),
    "THE DEFECT IS GONE: the old N/V-worded FAIL is not in the file any more");
  ok(!/listVaDrafts returned no staged draft \(\$\{/.test(src),
    "…and step 3's unconditional FAIL for an empty list is gone with it");
}

/* ── 7. F-854: THE POLL STOPS AS SOON AS THE ANSWER IS KNOWN ──────────────────── */
{
  /* (a) the positive — unchanged in meaning, and still the first thing asked. */
  const staged = judgeDraftPollStop({ staged: 2, receipt: { swept: 5, worked: 5 } });
  ok(staged.stop === true && staged.outcome === "staged", "staged >= 1 stops the poll, positively");
  ok(/status\.staged=2/.test(staged.reason), "…and the reason carries the count it stopped on");

  /* (b) THE DEFECT: the prepare receipt says NOTHING was fanned out. No `va-item` task
     exists, so `staged` cannot rise — and the old predicate waited 240 s for it anyway. */
  const none = judgeDraftPollStop({ staged: 0, receipt: { swept: 0, worked: 0, skipped: [] } });
  ok(none.stop === true, "a tick that fanned NOTHING out stops the poll at once — this is the 240 s the defect burned");
  ok(none.outcome === "nothing-swept", "…named as nothing-swept, because the sweep itself found no candidate");
  ok(/no item turn to wait for/.test(none.reason), "…and the reason says why waiting cannot help");

  /* (c) candidates were swept and EVERY one was skipped with a terminal reason. Same
     conclusion by a different road: fannedOut is still 0, so no turn will ever run. */
  const skipped = judgeDraftPollStop({
    staged: 0,
    receipt: { swept: 3, worked: 0, skipped: [{ itemKey: "JT-1", reason: "parked" }, { itemKey: "JT-2", reason: "index_refused:cap" }, { itemKey: "JT-3", reason: "item_read_failed" }] },
  });
  ok(skipped.stop === true && skipped.outcome === "all-skipped", "swept>=1 with worked=0 stops too: every candidate was skipped, so nothing was pushed");
  ok(/swept 3 candidate\(s\) and fanned out NONE/.test(skipped.reason), "…and the reason names both numbers, not just one");
  ok(/parked/.test(skipped.reason) && /index_refused:cap/.test(skipped.reason),
    "…and lists the skip reasons, which is the only evidence a reader has for WHY nothing ran");

  /* (d) the ledger could not be READ (F-832). Re-asking a door that already said so only
     spends the wait, and the timeout would then be misread as an absence. */
  const un = judgeDraftPollStop({ staged: 0, receipt: null, unavailable: "scan_failed" });
  ok(un.stop === true && un.outcome === "unavailable", "receiptsUnavailable stops the poll — it is an N/V that will not improve with waiting");
  ok(/scan_failed/.test(un.reason), "…and the named reason survives into the sentence");
  ok(!/nothing staged/.test(un.reason), "…and it never claims anything about staging, which is precisely what was not measured");

  /* (e) STILL RUNNING — the one case that must keep waiting. */
  const running = judgeDraftPollStop({ staged: 0, receipt: { swept: 4, worked: 4, skipped: [] } });
  ok(running.stop === false && running.outcome === "waiting", "turns in flight is the ONE case that spends the wait");
  ok(/each turn may still end with nothing staged/.test(running.reason),
    "…and the reason says why the wait is honest here: an item turn may legitimately stage nothing");

  /* (f) no receipt at all yet is the GENUINE 'not yet' and must not stop. */
  const early = judgeDraftPollStop({ staged: 0, receipt: null, unavailable: null });
  ok(early.stop === false && early.outcome === "no-receipt-yet", "before any receipt exists the poll keeps waiting — absence here is not an answer");

  /* (g) a refusal arm: the tick never reached the sweep, so nothing can stage from it. */
  for (const arm of ["settling", "paused", "gate:capability"]) {
    const g = judgeDraftPollStop({ staged: 0, receipt: { swept: 0, worked: 0 }, arm });
    ok(g.stop === true && g.outcome === "gated", `a ${arm} tick stops the poll — it was refused before it swept anything`);
  }
  ok(judgeDraftPollStop({ staged: 0, receipt: { swept: 2, worked: 2 }, arm: "prepare" }).stop === false,
    "…and arm=\"prepare\" is NOT a refusal: a real prepare with turns in flight still waits");

  /* (h) a receipt with no usable worked count says nothing, so it may not stop the poll.
     A missing field is a surface that changed under us, and guessing 0 there would turn
     every future projection change into a silent early stop. */
  ok(judgeDraftPollStop({ staged: 0, receipt: { swept: 1, worked: null } }).stop === false,
    "worked=null keeps waiting rather than guessing that nothing was fanned out");
  ok(judgeDraftPollStop({ staged: 0, receipt: { swept: 1 } }).stop === false,
    "…and so does a receipt with no worked field at all");

  /* (i) safe default. */
  const bare = judgeDraftPollStop({});
  ok(bare.stop === false && typeof bare.reason === "string", "called with nothing, the decision waits rather than throwing or stopping");
}

/* ── 8. THE MEASUREMENT: the wall clock the decision now permits ──────────────── */
{
  /* The DRIVER is live-only, so what is measured here is the DECISION, over the same
     6 s poll cadence and the same 240 s ceiling the driver uses. Each `false` costs one
     sleep; the first `true` ends the wait. */
  const POLL_S = 6, TICK_WAIT_S = 240;
  const drive = (statuses) => {
    let elapsed = 0;
    for (const st of statuses) {
      const d = judgeDraftPollStop(st);
      if (d.stop) return { elapsed, outcome: d.outcome };
      elapsed += POLL_S;
      if (elapsed >= TICK_WAIT_S) return { elapsed: TICK_WAIT_S, outcome: "timeout" };
    }
    return { elapsed: TICK_WAIT_S, outcome: "timeout" };
  };
  const forty = (st) => Array.from({ length: 60 }, () => st);

  const emptyTick = { staged: 0, receipt: { swept: 0, worked: 0, skipped: [] } };
  const r = drive(forty(emptyTick));
  ok(r.elapsed === 0 && r.outcome === "nothing-swept",
    "THE COMMON OUTCOME COSTS ONE TICK RECEIPT, NOT 240 s: the first status read after the receipt already answers");
  ok(r.elapsed < TICK_WAIT_S, "…and it is strictly under the ceiling, which is the whole of F-854");

  /* The OLD predicate, materialised, over the identical fixture — the cost it charged. */
  const oldPredicate = (st) => ({ stop: Number(st.staged) >= 1 });
  let oldElapsed = 0;
  for (const st of forty(emptyTick)) { if (oldPredicate(st).stop) break; oldElapsed += POLL_S; if (oldElapsed >= TICK_WAIT_S) break; }
  ok(oldElapsed === TICK_WAIT_S,
    "POSITIVE CONTROL: the staged>=1-only predicate spends the FULL 240 s on the same fixture, which is the defect measured");

  /* The one case that legitimately waits still waits, so the saving was not bought by
     giving up on the answer. */
  const busy = { staged: 0, receipt: { swept: 4, worked: 4 } };
  ok(drive(forty(busy)).elapsed === TICK_WAIT_S,
    "…and a tick with turns IN FLIGHT still uses the whole wait — the stop conditions removed only the unanswerable waits");
  const late = drive([busy, busy, { staged: 1, receipt: { swept: 4, worked: 4 } }]);
  ok(late.elapsed === 12 && late.outcome === "staged",
    "…and a draft that arrives on the third read is still caught, at the cost of exactly two sleeps");
}

/* ── 9. F-854: THE EMPTY SWEEP GOES THROUGH THE PRECONDITION JUDGE ────────────── */
{
  const found = judgeSweepPrecondition({ expectedToStage: false, swept: 4 });
  ok(found.found === true && found.row.verdict === "PASS", "a sweep that found candidates is the PASS it always was");
  ok(/swept=4/.test(found.row.what), "…and the row still names the count");

  /* THE DEFECT: swept=0 on a project nobody seeded, graded RED. */
  const empty = judgeSweepPrecondition({ expectedToStage: false, swept: 0, detail: "worked=0" });
  ok(empty.found === false, "an empty sweep is MEASURED and empty, which is a different thing from unmeasured");
  ok(empty.row.verdict === "N/V", "…and it is N/V, not FAIL: nothing in this fixture REQUIRED the project to hold a candidate");
  ok(/Remedy:/.test(empty.row.what), "…and it carries the remedy the operator must apply");
  ok(/ALREADY EXIST/.test(empty.row.what), "…and explains that the fixture sweeps a project it did not seed");

  const asserted = judgeSweepPrecondition({ expectedToStage: true, swept: 0 });
  ok(asserted.found === false && asserted.row.verdict === "FAIL",
    "--expect-drafts turns the empty sweep into a real FAIL — the operator asserted an item was there");
  ok(/MUST stage/.test(asserted.row.what), "…and the FAIL says which assertion made it red");

  /* Not measured at all: a receipt with no usable count says nothing about the sweep. */
  for (const swept of [null, undefined, "n/a"]) {
    const nm = judgeSweepPrecondition({ expectedToStage: true, swept });
    ok(nm.found === null && nm.row.verdict === "N/V",
      `swept=${JSON.stringify(swept)} is NOT MEASURED — N/V even under --expect-drafts, because a missing count cannot be evidence for a FAIL`);
  }

  /* ONE CAUSE, ONE VERDICT — the F-846 rule, applied across the two rows. */
  const suppressed = judgeDraftPrecondition({ expectedToStage: false, drafts: [], causeAlreadyReported: true });
  ok(suppressed.stage === null, "when the empty SWEEP already owns the cause, the draft row is SUPPRESSED — no second verdict for one fact");
  ok(suppressed.f414 !== null && suppressed.f414.verdict === "N/V",
    "…but step 6 is STILL told it may not judge F-414, so nothing is silently dropped");
  const rows = [empty.row.verdict, suppressed.stage, suppressed.f414.verdict].filter(Boolean);
  ok(rows.filter((v) => v === "FAIL").length === 0 && rows.length === 2,
    "an empty project therefore produces exactly TWO rows, both N/V, for one cause — the defect produced a FAIL plus an N/V");

  /* And with --expect-drafts the cause is red exactly ONCE. */
  const redOnce = [judgeSweepPrecondition({ expectedToStage: true, swept: 0 }).row.verdict,
    judgeDraftPrecondition({ expectedToStage: true, drafts: [], causeAlreadyReported: true }).f414.verdict];
  ok(redOnce.filter((v) => v === "FAIL").length === 1,
    "…and under --expect-drafts exactly ONE row is red, so a reader opens one investigation");

  /* Unsuppressed is the default: a sweep that DID find candidates leaves the draft row to
     speak for itself, which is F-846's own case and must not have regressed. */
  ok(judgeDraftPrecondition({ expectedToStage: false, drafts: [] }).stage.verdict === "N/V",
    "with the sweep non-empty the draft row still reports, exactly as F-846 left it");
}

/* ── 10. the new judges are really CALLED, and the defect lines are gone ──────── */
{
  ok(/judgeDraftPollStop\(\{/.test(src), "the driver calls judgeDraftPollStop");
  ok(/judgeSweepPrecondition\(\{/.test(src), "the driver calls judgeSweepPrecondition");
  ok(/applyVerdict\(sweep\.row/.test(src), "the sweep verdict is dispatched through applyVerdict, not a ninth PASS/FAIL/NV map");
  ok(!/the sweep found nothing: swept=\$\{prep\.swept\}/.test(src),
    "THE DEFECT IS GONE: the unconditional `FAIL(\"the sweep found nothing: swept=…\")` is not in the driver any more");
  /* The CALL is what must be gone; the docblocks above it quote the defect verbatim and
     must keep being able to, so the `await` is what tells the two apart. */
  ok(!/await pollStatus\(jobId, \(s\) => Number\(s\.staged\)/.test(src),
    "…and so is the staged>=1-only predicate that could only stop on the positive");
  ok(/causeAlreadyReported: sweepFound === false/.test(src),
    "the driver really suppresses the second row on the one cause, rather than the judge merely supporting it");
  ok(/judgeDraftPrecondition\.stage\)? ?\)? ?applyVerdict|if \(draftPrecondition\.stage\) applyVerdict/.test(src),
    "…and it GUARDS the dispatch, because a suppressed row is null and applyVerdict is handed rows, not nulls");
}

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — va-shadow draft precondition + poll stop: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
