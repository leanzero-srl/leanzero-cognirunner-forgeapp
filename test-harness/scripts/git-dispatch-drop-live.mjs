/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * LIVE proof of the F-335 / F-367 RETRY CONTRACT, in the ORDER the contract happens.
 *
 * WHY THIS EXISTS ALONGSIDE `git-inbound-live.mjs` (which already has a FAULT=1 section):
 * that script reads the completion claim the instant the attempt counter reaches 2, and
 * the successful attempt is the NEXT one — the platform redelivered it 67 s later in the
 * 2026-09-13 run. So it asks its F-367 question BEFORE the answer exists, calls a correct
 * app a failure, and (worse) its own "is a Redeliver answered duplicate?" POST is itself
 * accepted and dispatches the delivery a SECOND time — manufacturing the duplicate it was
 * checking for. It also never reached its case 2 at all, because a single transient
 * `fetch failed` aborts the whole run.
 *
 * This driver waits on the EVENT, not on a counter that precedes it:
 *
 *   CASE 1 (count=2) — arm two throws; wait for the COMPLETION CLAIM to come back on its
 *     own (the consumer re-takes it only after `dispatchGitEvent` returns). Only then ask
 *     whether a Redeliver is answered `duplicate`. The claim key and the attempt key come
 *     from src/shared/git-ids.js — the module both writers use, never retyped here.
 *
 *   CASE 2 (count=5, past GIT_DISPATCH_MAX_ATTEMPTS) — arm more throws than the cap and
 *     do NOT touch the delivery while the ladder climbs. The fourth failure must DROP
 *     loudly (return instead of rethrow) and must NOT hold the claim, so the provider's
 *     Redeliver gets a FRESH accept rather than `duplicate`. The fault is disarmed only
 *     after the cap is reached, so an early disarm can never let attempt 3 succeed and
 *     silently spoil the case — which is exactly what the aborted run did.
 *
 * Every hook call is retried: a transient TLS/DNS blip on the webtrigger host is a
 * property of somebody's wifi, not a verdict on the retry contract.
 *
 *   GIT_WEBHOOK_URL=<url> node scripts/git-dispatch-drop-live.mjs
 *   CASE=2 …                                  # run only case 2
 *   FAULT_BUDGET_MIN=15 …                     # widen the per-wait budget (default 10)
 *
 * A wait that reaches its budget exits NOT VERIFIED (3), never FAIL: "the platform had
 * not retried yet" and "the contract is broken" are different findings.
 * Neither the trigger URL nor any secret is printed. Cleans up the stand-in unless KEEP=1.
 */
import crypto from "node:crypto";
import { testState } from "../lib/rules-api.mjs";
import { gitDeliveryClaimKey, gitDeliveryAttemptKey, GIT_DISPATCH_MAX_ATTEMPTS } from "../../src/shared/git-ids.js";

const CONN = process.env.GIT_CONN_ID || "harness-git-drop";
const REPO = process.env.GIT_REPO_ID || "leanzero-srl/cognirunner-forge-offshoot";
const URL_ = process.env.GIT_WEBHOOK_URL || "";
const KEEP = process.env.KEEP === "1";
const ONLY = process.env.CASE || "";
const BUDGET_MS = Math.max(1, Number(process.env.FAULT_BUDGET_MIN) || 10) * 60_000;

let failures = 0, notVerified = 0;
const check = (label, actual, expected, note = "") => {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: got ${actual}, expected ${expected}${note ? ` — ${note}` : ""}`);
};
const unverified = (label, why) => { notVerified += 1; console.log(`NOT VERIFIED  ${label} — ${why}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* One transient network fault must not end a 10-minute proof. */
const retry = async (fn, tries = 5) => {
  let last;
  for (let i = 0; i < tries; i += 1) {
    try { return await fn(); } catch (e) { last = e; await sleep(2000 * (i + 1)); }
  }
  throw last;
};
const hook = (body) => retry(() => testState.post(body));
const kvRead = async (key) => (await retry(() => testState.get("kvs", `&key=${encodeURIComponent(key)}`))).body?.value ?? null;

const poll = async (key, done, budgetMs = BUDGET_MS) => {
  const started = Date.now();
  let wait = 3000;
  for (;;) {
    const value = await kvRead(key);
    if (done(value)) return { ok: true, value, ms: Date.now() - started };
    if (Date.now() - started >= budgetMs) return { ok: false, value, ms: Date.now() - started };
    await sleep(wait);
    wait = Math.min(20000, Math.round(wait * 1.4));
  }
};

const prBody = (n, sha) => JSON.stringify({
  action: "opened", number: n,
  pull_request: { number: n, title: `harness PR ${n}`, state: "open", head: { ref: `harness-${n}`, sha } },
  repository: { full_name: REPO },
});

const deliver = async (secret, deliveryId, n) => {
  const body = prBody(n, crypto.randomBytes(20).toString("hex"));
  const sig = "sha256=" + crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex");
  const target = `${URL_}?conn=${encodeURIComponent(CONN)}&repo=${encodeURIComponent(REPO)}`;
  return retry(async () => {
    const res = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-GitHub-Event": "pull_request", "X-GitHub-Delivery": deliveryId, "X-Hub-Signature-256": sig },
      body,
    });
    const text = await res.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 200) }; }
    return { status: res.status, body: json };
  });
};

const main = async () => {
  if (!URL_) { console.error("GIT_WEBHOOK_URL is required (forge webtrigger create -f git-webhook -e development). The URL is a secret."); process.exit(2); }
  const secret = crypto.randomBytes(20).toString("hex");
  const planted = await hook({ action: "plantHookSecret", connId: CONN, repoId: REPO, secret, plantConnection: true });
  check("stand-in planted", planted.status, 200, JSON.stringify(planted.body).slice(0, 160));
  if (planted.status !== 200) process.exit(1);

  try {
    // ---- CASE 1: two throws, then the third attempt dispatches and RE-TAKES the claim ----
    if (ONLY !== "2") {
      console.log(`\n--- case 1: count=2, the retried success re-takes the claim (budget ${Math.round(BUDGET_MS / 60000)} min) ---`);
      const d1 = `drop1-${Date.now()}`;
      const claim1 = gitDeliveryClaimKey(CONN, d1), tries1 = gitDeliveryAttemptKey(CONN, d1);
      try {
        const armed = await hook({ action: "armGitDispatchFault", connectionId: CONN, deliveryId: d1, count: 2 });
        check("fault armed (count=2)", armed.body?.count, 2);
        check("delivery accepted at the door", (await deliver(secret, d1, 21)).status, 202, "the lever sits in the consumer, not the webhook");

        // The claim is RELEASED by each rethrown failure and RE-TAKEN by the success.
        // So: first watch it go (the release is real), then watch it come back.
        const released = await poll(claim1, (v) => v === null);
        if (!released.ok) unverified("the claim is released by the failing attempt", `still present after ${Math.round(released.ms / 1000)}s`);
        else console.log(`PASS  the claim is RELEASED by the failing attempt (after ${Math.round(released.ms / 1000)}s)`);

        // THE EVENT, not the counter: the claim returning IS the completion.
        const retaken = await poll(claim1, (v) => v !== null);
        if (!retaken.ok) {
          const seen = await kvRead(tries1);
          unverified("the claim is RE-TAKEN by the retried success (F-367)", `attempts=${(seen && seen.attempts) ?? 0} after ${Math.round(retaken.ms / 1000)}s — the platform may not have retried yet; raise FAULT_BUDGET_MIN`);
        } else {
          console.log(`PASS  the claim is RE-TAKEN by the retried success (F-367) after ${Math.round(retaken.ms / 1000)}s`);
          const attempts = await kvRead(tries1);
          check("…and it failed exactly twice first", Number(attempts && attempts.attempts), 2);
          const left = await hook({ action: "readGitDispatchFault", connectionId: CONN, deliveryId: d1 });
          check("both armed faults were consumed", left.body?.value === null, true, JSON.stringify(left.body?.value));
          // ONLY NOW is the Redeliver question answerable. Asked earlier it both gets the
          // wrong answer AND causes a second real dispatch of the same delivery.
          const redup = await deliver(secret, d1, 21);
          check("a provider Redeliver after the success is answered duplicate", redup.body?.duplicate === true, true, JSON.stringify(redup.body));
        }
        console.log(`      consumer line: forge logs -e development | grep "succeeded on attempt" (delivery ${d1})`);
      } finally { await hook({ action: "disarmGitDispatchFault", connectionId: CONN, deliveryId: d1 }).catch(() => {}); }
    }

    // ---- CASE 2: past the cap — dropped loudly, claim NOT held ----
    if (ONLY !== "1") {
      console.log(`\n--- case 2: count=5 (> cap ${GIT_DISPATCH_MAX_ATTEMPTS}), the delivery is DROPPED (budget ${Math.round(BUDGET_MS / 60000)} min) ---`);
      const d2 = `drop2-${Date.now()}`;
      const claim2 = gitDeliveryClaimKey(CONN, d2), tries2 = gitDeliveryAttemptKey(CONN, d2);
      let reachedCap = false;
      try {
        const armed2 = await hook({ action: "armGitDispatchFault", connectionId: CONN, deliveryId: d2, count: 5 });
        check("fault armed (count=5)", armed2.body?.count, 5);
        check("poison delivery accepted at the door", (await deliver(secret, d2, 22)).status, 202);

        // Do NOT touch this delivery while the ladder climbs — every extra POST is an
        // extra accept, which re-takes the claim and spoils the case.
        const capped = await poll(tries2, (v) => Number(v && v.attempts) >= GIT_DISPATCH_MAX_ATTEMPTS);
        if (!capped.ok) {
          unverified(`attempts reach the cap (${GIT_DISPATCH_MAX_ATTEMPTS})`, `attempts=${(capped.value && capped.value.attempts) ?? 0} after ${Math.round(capped.ms / 1000)}s — raise FAULT_BUDGET_MIN and re-run`);
        } else {
          reachedCap = true;
          check("the retry ladder stops at the documented cap", Number(capped.value.attempts), GIT_DISPATCH_MAX_ATTEMPTS);
          // The final attempt RETURNS instead of rethrowing, so it does not release the
          // claim — which is why the previous release must already have removed it.
          await sleep(4000);
          check("the claim is NOT held after the drop", (await kvRead(claim2)) === null, true,
            "a held claim here answers the provider's Redeliver 'duplicate' for a delivery that never ran");
          const again = await deliver(secret, d2, 22);
          check("a Redeliver after the drop is a FRESH accept", again.status, 202);
          check("…and is NOT answered duplicate", again.body?.duplicate === true, false, JSON.stringify(again.body));
        }
        console.log(`      the loud drop line: forge logs -e development | grep "DELIVERY DROPPED" (delivery ${d2})`);
      } finally {
        // Disarmed only now: disarming while the ladder is still climbing lets a later
        // attempt SUCCEED and turns a drop proof into a silent pass.
        if (!reachedCap) console.log("      (the cap was not reached — the fault is being disarmed, so this delivery may now succeed on its next attempt)");
        await hook({ action: "disarmGitDispatchFault", connectionId: CONN, deliveryId: d2 }).catch(() => {});
      }
    }
  } finally {
    if (!KEEP) {
      const gone = await hook({ action: "deleteHarnessConnection", connId: CONN }).catch(() => ({ body: {} }));
      check("stand-in removed", gone.body?.ok === true, true, JSON.stringify(gone.body).slice(0, 120));
    } else console.log("KEEP=1 — the stand-in connection is still installed.");
  }

  if (notVerified) console.log(`\n${notVerified} check(s) NOT VERIFIED (budget reached before the platform retried).`);
  console.log(failures ? `\n${failures} check(s) FAILED` : (notVerified ? "\nno check failed, but the run is INCOMPLETE" : "\nall checks passed"));
  process.exit(failures ? 1 : (notVerified ? 3 : 0));
};

main().catch((e) => { console.error("harness error:", e && e.message); process.exit(2); });
