/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/* ═══════════════════════════════════════════════════════════════════════════════
 * F-823 — "DID THIS TICK WRITE A RECEIPT" IS AN IDENTITY QUESTION, NOT A COUNT.
 *
 * A tick receipt lives at `va_tick:{agent}:{phase}-{tickId}` (src/shared/va-keys.js
 * `vaTickKey` + `tickIdFor`), and `tickId` is a FIVE-MINUTE BUCKET. `recordTick`
 * (src/va-ledger.js:~1152) `store.set`s that key — it OVERWRITES IN PLACE. Two ticks
 * fired inside one bucket therefore leave ONE row, and the driver that asked
 * "did the number of prepare receipts grow?" was asking a question whose answer is
 * NO for a tick that wrote, whenever the previous tick shared its bucket.
 *
 * That produced BOTH signs of wrong answer on one staging run (17/1):
 *   · STEP 3 (in-window) PASSED because the count could not grow — a false PASS that
 *     would have survived the gate being removed entirely, as long as the two ticks
 *     landed in the same five minutes;
 *   · STEP 4 (after-window) FAILED because the count read happened BEFORE the
 *     `async_job` read in the same poll iteration, and a 600 ms paused tick wrote its
 *     receipt in between — the driver then accused the product of doing nothing while
 *     `forge logs` showed the paused arm running and recording.
 *
 * THE THREE CHANGES THIS FUNCTION EXISTS TO CARRY:
 *
 *  1. LIVENESS IS NOT A RECEIPT. `taskDone` is the F-797 answer — the consumer's own
 *     `async_job:{taskId}` row reaching `done`/`error`. It is outside the ledger, so a
 *     standing tombstone cannot refuse it, and it is written for the refused tick too.
 *     No liveness ⇒ N/V. Nothing below is a measurement without it.
 *
 *  2. THE RECEIPT IS RE-READ AFTER LIVENESS, AND COMPARED BY IDENTITY. `{tickId, at}`,
 *     where `at` is the projection of `recordTick`'s `finished` (millisecond ISO,
 *     src/va-admin.js `publicReceipt`). A same-bucket rewrite keeps `tickId` and moves
 *     `at`, which a count cannot see and this can. When BOTH are identical the honest
 *     answer is N/V — "indistinguishable", not "did not write".
 *
 *  3. THE BODY IS READ, NOT JUST ITS EXISTENCE. `runVaTick`'s arms are distinguishable
 *     in the receipt and the driver never looked:
 *       · purge-settling (src/virtual-admin.js:~707-720) is RECEIPT-FREE by design and
 *         returns `skipped:[{key:"(agent)", gate:"purge-settling", ...}]` to the queue
 *         log only. If the product ever starts recording it, the gate field is how this
 *         still reads it correctly — hence "no receipt OR a purge-settling receipt".
 *       · paused (:~726-732) RECORDS `skipped:[{key:"(agent)", reason:"paused"}]`,
 *         deliberately WITHOUT a `gate` (a paused tick is a healthy no-op, F-510).
 *       · capability records `{gate:"capability"}` and fails the tick.
 *       · a genuine prepare records candidates/staged and no agent-level gate.
 *     "A receipt exists" conflates all four. `expect` names which one is being measured.
 *
 * WHY A LIB. The live driver acquires its environment, secret and hook URL at module
 * scope, so it cannot be imported by a test; leaving this decision inline would leave it
 * unprovable offline, which is how it stayed wrong through two passes.
 * ═══════════════════════════════════════════════════════════════════════════════ */

/** The gate string `runVaTick` stamps on the settle refusal. One home for the literal. */
export const PURGE_GATE = "purge-settling";

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const asArray = (v) => (Array.isArray(v) ? v : []);

/**
 * The identity of a receipt, as the `getVaStatus` projection hands it over.
 * `null` in ⇒ `null` out, so "there was none" is representable and never guessed at.
 */
export const receiptIdentity = (r) =>
  (isObj(r) ? { tickId: r.tickId == null ? null : String(r.tickId), at: r.at == null ? null : String(r.at) } : null);

const sameIdentity = (a, b) => !!a && !!b && a.tickId === b.tickId && a.at === b.at;

/**
 * WHICH ARM WROTE THIS RECEIPT, read from the body and from nothing else.
 *
 * Answers one of: `"settling"` | `"paused"` | `"gate:{id}"` | `"prepare"` | `null`
 * (no receipt). The agent-level rows are the `(agent)` sentinel, which the projection
 * renders as `itemKey: null` (src/va-admin.js) — the RAW engine shape (`key:"(agent)"`)
 * is accepted too so a caller reading `va_tick:*` straight from KVS gets the same answer.
 */
export const receiptArm = (r) => {
  if (!isObj(r)) return null;
  const skips = asArray(r.skipped).filter(isObj);
  const agentSkip = (s) => s.itemKey == null || s.itemKey === "(agent)" || s.key === "(agent)";
  if (skips.some((s) => s.gate === PURGE_GATE)) return "settling";
  const agentRows = skips.filter(agentSkip);
  const gated = agentRows.find((s) => s.gate);
  if (gated) return `gate:${gated.gate}`;
  if (agentRows.some((s) => String(s.reason || "").trim().toLowerCase() === "paused")) return "paused";
  return "prepare";
};

/** The four things a step can be asking. Anything else is a caller bug, not a verdict. */
export const TICK_EXPECTATIONS = ["settling-refused", "not-settling", "receipt", "no-receipt"];

/**
 * `judgeTickReceipt({before, after, taskDone, expect})` → `{verdict, reason, wrote, arm, ...}`
 *
 *  · `before` / `after` — the NEWEST prepare receipt (the `getVaStatus` projection) read
 *    before the tick was enqueued and again AFTER `taskDone`, or `null` for none.
 *  · `taskDone`  — did `async_job:{taskId}` reach a terminal status (F-797 liveness)?
 *  · `expect`    — `"settling-refused"` | `"not-settling"` | `"receipt"` | `"no-receipt"`.
 *
 * `verdict` is `"PASS"` | `"FAIL"` | `"N/V"`, and N/V is used wherever the run did not
 * MEASURE the thing — never as a soft failure.
 */
export const judgeTickReceipt = ({ before = null, after = null, taskDone = false, expect = "receipt" } = {}) => {
  const idBefore = receiptIdentity(before);
  const idAfter = receiptIdentity(after);
  const arm = receiptArm(after);
  const sameBucket = !!(idBefore && idAfter && idBefore.tickId === idAfter.tickId);
  const base = { identity: { before: idBefore, after: idAfter }, sameBucket, arm, expect };

  if (!TICK_EXPECTATIONS.includes(expect)) {
    return { ...base, verdict: "N/V", wrote: null, reason: `unknown expectation "${expect}" — the step did not say what it was measuring` };
  }
  /* LIVENESS FIRST, ALWAYS. Without it "no receipt" and "the consumer never woke up"
     are the same evidence, which is the vacuous-PASS half of F-797. */
  if (!taskDone) {
    return { ...base, verdict: "N/V", wrote: null, reason: "no liveness: the consumer's async_job never reached done/error and nothing else proved the tick ran, so neither a receipt nor its absence proves anything" };
  }
  /* THE OVERWRITE, SEEN. Same bucket AND the same `finished` instant: either the tick
     wrote a byte-identical row or it wrote nothing, and this cannot tell which. */
  if (sameIdentity(idBefore, idAfter)) {
    return { ...base, verdict: "N/V", wrote: null, reason: `the receipt is UNCHANGED in identity (tickId=${idAfter.tickId}, at=${idAfter.at}) — a same-bucket rewrite is indistinguishable from no write here` };
  }
  const wrote = !!idAfter;
  const said = wrote
    ? `a receipt was written (tickId=${idAfter.tickId}, at=${idAfter.at}, arm=${arm}${sameBucket ? ", SAME bucket as the previous one — the count could not have seen this" : ""})`
    : "no receipt was written";

  if (expect === "receipt") {
    /* The CONTROL, not the measurement: a normal tick that wrote nothing weakens what
       follows, it does not condemn the product arm under test. */
    return wrote
      ? { ...base, verdict: "PASS", wrote, reason: `the control tick wrote its receipt — ${said}` }
      : { ...base, verdict: "N/V", wrote, reason: "the control tick ran but wrote no receipt; every 'no receipt' assertion below is weaker for it" };
  }
  if (expect === "no-receipt") {
    return wrote
      ? { ...base, verdict: "FAIL", wrote, reason: `a receipt was expected NOT to be written, but ${said}` }
      : { ...base, verdict: "PASS", wrote, reason: "the tick ran and wrote no receipt" };
  }
  if (expect === "settling-refused") {
    /* The product's arm is receipt-free (F-575/F-614). A recorded purge-settling receipt
       would be a surface change, not a gate failure, so it PASSES and says which it saw. */
    if (!wrote) return { ...base, verdict: "PASS", wrote, reason: "the tick ran and was refused receipt-free: the purge-settling arm returns before recordTick, so no receipt IS the observable" };
    if (arm === "settling") return { ...base, verdict: "PASS", wrote, reason: `the tick was refused at the purge-settling gate and RECORDED it — ${said}` };
    return { ...base, verdict: "FAIL", wrote, reason: `the in-window tick was NOT gated by the settle window: ${said}` };
  }
  // expect === "not-settling"
  if (!wrote) return { ...base, verdict: "FAIL", wrote, reason: "the after-window tick ran and wrote no receipt at all — it is still doing nothing" };
  if (arm === "settling") return { ...base, verdict: "FAIL", wrote, reason: `the after-window tick is STILL gated on the settle window — ${said}` };
  return { ...base, verdict: "PASS", wrote, reason: `the after-window tick is past the settle gate — ${said}` };
};
