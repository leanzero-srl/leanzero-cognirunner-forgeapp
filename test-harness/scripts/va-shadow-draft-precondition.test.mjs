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
const { judgeDraftPrecondition, judgeRestageEvidence } = new Function(
  `"use strict";
   ${grab("judgeDraftPrecondition")}
   ${grab("judgeRestageEvidence")}
   return { judgeDraftPrecondition, judgeRestageEvidence };`,
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

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — va-shadow draft precondition: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
