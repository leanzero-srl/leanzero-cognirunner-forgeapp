/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/* ═══════════════════════════════════════════════════════════════════════════════
 * F-823 — THE OFFLINE CONTROL ON "DID THIS TICK WRITE A RECEIPT".
 *
 * The four situations the live run actually produces, each asserted to BLOCK or ALLOW:
 *   1. SAME-BUCKET OVERWRITE — two ticks inside one five-minute bucket. The count the
 *      old driver used cannot move; the identity (`at`) does. This is the false PASS.
 *   2. PAUSED IN 600 ms — the after-window tick finishes between the two reads of one
 *      poll iteration. Re-reading after liveness sees the receipt; the arm is `paused`
 *      and not `settling`, so the step passes. This is the false FAIL.
 *   3. SETTLING-REFUSED — the in-window tick, receipt-free by design, with liveness.
 *   4. GENUINE PREPARE — the after-window tick that swept and staged.
 *
 * The receipt fixtures below are the `getVaStatus` projection shape (src/va-admin.js
 * `publicReceipt`: `{at, startedAt, phase, tickId, ok, swept, worked, skipped[]}`), and
 * the skip rows are the exact ones `runVaTick` stores (src/virtual-admin.js): the paused
 * arm's `{key:"(agent)", reason:"paused"}` with NO gate, and the capability arm's
 * `{key:"(agent)", gate:"capability"}`. The purge-settling arm stores NOTHING — its
 * fixture exists only to prove the reader would still be right if it ever did.
 *
 * WHAT THIS FILE CANNOT PROVE: that staging's consumer really writes `async_job` for a
 * refused `va-tick`, and that the live driver feeds these functions the right receipts.
 * Both are owed to a live run.
 * ═══════════════════════════════════════════════════════════════════════════════ */

import { judgeTickReceipt, receiptArm, receiptIdentity, PURGE_GATE, TICK_EXPECTATIONS } from "../lib/va-tick-receipt.mjs";

let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) { pass++; console.log(`  ok   ${what}`); } else { fail++; console.log(`  FAIL ${what}`); } };

/* The projection shape, with only the fields the judge reads varied. */
const receipt = (tickId, at, skipped = [], extra = {}) => ({
  at, startedAt: at, phase: "prepare", tickId, ok: true, swept: 0, worked: 0, error: null, skipped, ...extra,
});
const PAUSED_SKIP = [{ itemKey: null, reason: "paused" }];
const CAPABILITY_SKIP = [{ itemKey: null, gate: "capability", reason: "needs-coder-edition" }];
const SETTLING_SKIP = [{ itemKey: null, gate: PURGE_GATE, reason: "purge still settling (window)" }];

console.log("\n1 · receiptArm — THE BODY NAMES THE ARM, AND THE FOUR ARMS ARE DISTINCT");
{
  ok(receiptArm(null) === null, "no receipt answers null — absence is representable and never guessed at");
  ok(receiptArm(receipt("t1", "2026-09-14T10:00:00.000Z", PAUSED_SKIP)) === "paused",
    "the paused arm's `{reason:\"paused\"}` with NO gate reads as `paused` (src/virtual-admin.js:~726)");
  ok(receiptArm(receipt("t1", "2026-09-14T10:00:00.000Z", SETTLING_SKIP)) === "settling",
    "a `gate:\"purge-settling\"` row reads as `settling` wherever it sits");
  ok(receiptArm(receipt("t1", "2026-09-14T10:00:00.000Z", CAPABILITY_SKIP)) === "gate:capability",
    "the capability gate reads as its own arm and is NOT mistaken for the settle gate");
  ok(receiptArm(receipt("t1", "2026-09-14T10:00:00.000Z", [], { swept: 4, worked: 2 })) === "prepare",
    "a swept-and-staged receipt with no agent-level skip is a genuine prepare");
  ok(receiptArm(receipt("t1", "2026-09-14T10:00:00.000Z", [{ itemKey: "JT-1", reason: "claim" }])) === "prepare",
    "a per-ITEM skip does not make the tick a gated one — only the `(agent)` sentinel speaks for the tick");
  ok(receiptArm({ tickId: "t1", at: "x", skipped: [{ key: "(agent)", reason: "paused" }] }) === "paused",
    "the RAW engine shape (`key:\"(agent)\"`) reads the same as the projection's `itemKey:null`");
  ok(receiptIdentity(receipt("t1", "2026-09-14T10:00:00.000Z")).tickId === "t1" && receiptIdentity(null) === null,
    "receiptIdentity carries {tickId, at} and passes null through");
}

console.log("\n2 · SAME-BUCKET OVERWRITE — the false PASS the count produced");
{
  const before = receipt("29528520", "2026-09-14T10:01:02.000Z", PAUSED_SKIP);
  // Same bucket, same key, overwritten in place: a COUNT of prepare receipts is 1 both times.
  const after = receipt("29528520", "2026-09-14T10:03:44.000Z", PAUSED_SKIP);
  const v = judgeTickReceipt({ before, after, taskDone: true, expect: "settling-refused" });
  ok(v.wrote === true, "the rewrite IS seen as a write: same tickId, later `at` — the identity moved where the count could not");
  ok(v.sameBucket === true && /SAME bucket/.test(v.reason), "…and the verdict says the bucket was shared, so a reader knows why a count would have missed it");
  ok(v.verdict === "FAIL", "an in-window tick that wrote a NON-settling receipt is a FAIL — the gate did not hold (this is the case that used to PASS vacuously)");
}

console.log("\n3 · PAUSED IN 600 ms — the false FAIL the read-order produced");
{
  const before = receipt("29528510", "2026-09-14T09:55:00.000Z", [], { swept: 3, worked: 1 });
  const after = receipt("29528525", "2026-09-14T10:20:00.600Z", PAUSED_SKIP);
  const v = judgeTickReceipt({ before, after, taskDone: true, expect: "not-settling" });
  ok(v.verdict === "PASS" && v.arm === "paused",
    "the after-window tick whose receipt landed between the two reads PASSES once it is re-read after liveness — it is past the settle gate, paused");
  ok(/past the settle gate/.test(v.reason) && /arm=paused/.test(v.reason),
    "…and the sentence names the arm, so a reader is not told 'normal prepare' about a paused tick");
}

console.log("\n4 · SETTLING-REFUSED — the in-window tick, receipt-free by design");
{
  const before = receipt("29528510", "2026-09-14T09:55:00.000Z", [], { swept: 3, worked: 1 });
  const same = judgeTickReceipt({ before, after: before, taskDone: true, expect: "settling-refused" });
  ok(same.verdict === "N/V" && /UNCHANGED in identity/.test(same.reason),
    "an IDENTICAL receipt before and after is N/V, not PASS: a byte-identical rewrite and no write are the same evidence here");

  const none = judgeTickReceipt({ before: null, after: null, taskDone: true, expect: "settling-refused" });
  ok(none.verdict === "PASS" && none.wrote === false,
    "a proven-live tick that left NO receipt at all is the purge-settling observable (F-575: the arm returns before recordTick)");

  const recorded = judgeTickReceipt({ before, after: receipt("29528520", "2026-09-14T10:03:00.000Z", SETTLING_SKIP), taskDone: true, expect: "settling-refused" });
  ok(recorded.verdict === "PASS" && recorded.arm === "settling",
    "if the product ever DOES record the refusal, the gate field still reads it correctly — the reader is not pinned to the absence");

  const blind = judgeTickReceipt({ before, after: null, taskDone: false, expect: "settling-refused" });
  ok(blind.verdict === "N/V" && /no liveness/.test(blind.reason),
    "without `async_job` liveness the same absence is N/V — 'nothing happened' and 'the consumer never woke up' must never print the same word");
}

console.log("\n5 · GENUINE PREPARE, AND THE AFTER-WINDOW FAILURES THAT ARE REAL");
{
  const before = null;
  const real = judgeTickReceipt({ before, after: receipt("29528530", "2026-09-14T10:30:00.000Z", [], { swept: 5, worked: 2 }), taskDone: true, expect: "not-settling" });
  ok(real.verdict === "PASS" && real.arm === "prepare", "a swept-and-staged receipt after the window is the clean ALLOW");

  const stillGated = judgeTickReceipt({ before, after: receipt("29528530", "2026-09-14T10:30:00.000Z", SETTLING_SKIP), taskDone: true, expect: "not-settling" });
  ok(stillGated.verdict === "FAIL" && /STILL gated/.test(stillGated.reason),
    "a purge-settling receipt after the window is a REAL failure and says so");

  const mute = judgeTickReceipt({ before, after: null, taskDone: true, expect: "not-settling" });
  ok(mute.verdict === "FAIL", "a proven-live after-window tick that wrote nothing at all is a real failure, not an N/V");

  const muteBlind = judgeTickReceipt({ before, after: null, taskDone: false, expect: "not-settling" });
  ok(muteBlind.verdict === "N/V", "…but with no liveness the very same evidence is N/V — the F-797 rule holds on BOTH arms");
}

console.log("\n6 · THE CONTROL AND THE CALLER-BUG ARMS");
{
  const ctl = judgeTickReceipt({ before: null, after: receipt("t1", "2026-09-14T10:00:00.000Z", [], { swept: 2 }), taskDone: true, expect: "receipt" });
  ok(ctl.verdict === "PASS", "the tick-1 control passes when it writes");
  const ctlMute = judgeTickReceipt({ before: null, after: null, taskDone: true, expect: "receipt" });
  ok(ctlMute.verdict === "N/V" && /weaker/.test(ctlMute.reason),
    "a control that wrote nothing is N/V and says the assertions below are weaker — a control is not the measurement");

  const bogus = judgeTickReceipt({ before: null, after: null, taskDone: true, expect: "whatever" });
  ok(bogus.verdict === "N/V" && /did not say what it was measuring/.test(bogus.reason),
    "an unknown expectation is a caller bug reported as N/V, never a silent PASS");
  ok(TICK_EXPECTATIONS.length === 4 && TICK_EXPECTATIONS.includes("settling-refused") && TICK_EXPECTATIONS.includes("not-settling"),
    "the expectation vocabulary is exported so a step cannot invent one that nothing grades");

  const noArgs = judgeTickReceipt();
  ok(noArgs.verdict === "N/V", "called with nothing at all it is N/V, not a default PASS");
}

console.log(`\nva-tick-receipt: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
