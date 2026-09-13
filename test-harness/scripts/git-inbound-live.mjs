/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * LIVE proof of the 1.4 INBOUND git path: plant a tokenless stand-in connection +
 * a per-repo hook secret through the dev test hook, then drive the PRODUCTION
 * `git-webhook` web trigger with self-signed deliveries and assert each documented
 * answer (202 accept, 202 duplicate, 401 unsigned, 401 bad signature, 404 unknown
 * route, 405 on GET).
 *
 * WHY A SCRIPT AND NOT A GITHUB WEBHOOK: every answer below depends only on the
 * signature over the RAW body, so a locally-signed POST exercises exactly the same
 * code GitHub would — without leaving a webhook, a branch or a pull request behind
 * on somebody's repository. Point it at a real repo id that is on the stand-in
 * connection's allow-list; nothing here ever talks to GitHub.
 *
 * F-346 (fixed 2026-09-13, not yet re-proven live): `gitHookSecretKey` used to embed the
 * repo id "owner/name" verbatim, and Forge KVS rejects "/" in a key — the plant failed
 * with INVALID_KEY and every delivery answered 503. The key part is now built by
 * `repoKeyPart` (src/shared/git-ids.js): "owner#name.<8-hex>". This script never asserts
 * a key STRING — it echoes whatever key the plant reports — so nothing here had to change;
 * what it still does is report a failed plant as a FAIL with the KVS error attached
 * rather than pretending the surface is unproven. Re-run it to close F-346 live.
 *
 * F-335 (FAULT=1, opt-in): the retry contract — a dispatch that THROWS must release the
 * `git_delivery` claim, count the attempt in `git_delivery_try:*` and be redelivered by the
 * platform, up to GIT_DISPATCH_MAX_ATTEMPTS, after which the delivery is DROPPED loudly.
 * No envelope the webhook accepts ever fails on its own, so the failure needs a LEVER: the
 * dev hook's `armGitDispatchFault` (src/harness-fault.js, HARNESS_SECRET-gated and inert in
 * production) arms N forced throws at the dispatch seam. That section is opt-in because it
 * WAITS ON THE PLATFORM's own retry schedule — see the polling budget note below.
 *
 *   node scripts/git-inbound-live.mjs                 # plant, deliver, assert, clean up
 *   KEEP=1 node scripts/git-inbound-live.mjs          # leave the stand-in row in place
 *   GIT_WEBHOOK_URL=<url> node scripts/git-inbound-live.mjs
 *   FAULT=1 node scripts/git-inbound-live.mjs         # …plus the F-335 retry proof
 *
 * Env (test-harness/.env): TESTSTATE_URL + HARNESS_SECRET. The web-trigger URL is
 * NOT discoverable through the hook (only `rules-api` is), so mint it once with
 * `forge webtrigger create -f git-webhook -e development` and pass it in
 * GIT_WEBHOOK_URL. Neither the URL nor any secret is ever printed.
 *
 * THE POLLING BUDGET (read this before calling a FAULT run a failure). A thrown consumer
 * event is redelivered by the PLATFORM on its own schedule, not ours: `@forge/events` lets
 * a handler ask for a delay (`retryOptions.retryAfter`, see node_modules/@forge/events/out/
 * retryOptions.d.ts) but this app asks for nothing, so the default backoff applies and it is
 * NOT documented as a number anywhere we can cite — observed spacing is seconds to a few
 * minutes, growing with each attempt (plan §4b row 38b). So every wait here is bounded at
 * FAULT_BUDGET_MS (10 minutes, override with FAULT_BUDGET_MIN) and a run that reaches the
 * budget exits "NOT VERIFIED", never "FAIL": the difference between "the contract is broken"
 * and "the platform had not retried yet" is exactly what a fixed sleep would destroy.
 */
import crypto from "node:crypto";
import { testState } from "../lib/rules-api.mjs";
// The key SHAPES come from the module both writers use — never retyped in a test (F-335).
import { gitDeliveryClaimKey, gitDeliveryAttemptKey, GIT_DISPATCH_MAX_ATTEMPTS } from "../../src/shared/git-ids.js";

const CONN = process.env.GIT_CONN_ID || "harness-git-live";
const REPO = process.env.GIT_REPO_ID || "leanzero-srl/cognirunner-forge-offshoot";
const URL_ = process.env.GIT_WEBHOOK_URL || "";
const KEEP = process.env.KEEP === "1";
const FAULT = process.env.FAULT === "1";
const FAULT_BUDGET_MS = Math.max(1, Number(process.env.FAULT_BUDGET_MIN) || 10) * 60_000;

let notVerified = 0;
const unverified = (label, why) => { notVerified += 1; console.log(`NOT VERIFIED  ${label} — ${why}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kvRead = async (key) => (await testState.get("kvs", `&key=${encodeURIComponent(key)}`)).body?.value ?? null;

/* Poll one KVS row until `done(value)` or the budget runs out. Backoff mirrors the
   platform's own: fast at first (a first retry can land in seconds), then patient. */
const pollRow = async (key, done, budgetMs = FAULT_BUDGET_MS) => {
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

let failures = 0;
const check = (label, actual, expected, note = "") => {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: got ${actual}, expected ${expected}${note ? ` — ${note}` : ""}`);
};

const prBody = (n, sha) => JSON.stringify({
  action: "opened", number: n,
  pull_request: { number: n, title: `harness PR ${n}`, state: "open", head: { ref: `harness-${n}`, sha } },
  repository: { full_name: REPO },
});

const deliver = async (url, { body, secret, sigHeader = "X-Hub-Signature-256", signature, event = "pull_request", delivery, conn = CONN, repo = REPO, method = "POST" }) => {
  const headers = { "Content-Type": "application/json" };
  if (event) headers["X-GitHub-Event"] = event;
  if (delivery) headers["X-GitHub-Delivery"] = delivery;
  const sig = signature !== undefined
    ? signature
    : (secret ? "sha256=" + crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex") : undefined);
  if (sig) headers[sigHeader] = sig;
  const target = `${url}?conn=${encodeURIComponent(conn)}&repo=${encodeURIComponent(repo)}`;
  const res = await fetch(target, { method, headers, body: method === "GET" ? undefined : body });
  let json = null;
  const text = await res.text();
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 200) }; }
  return { status: res.status, body: json };
};

const main = async () => {
  if (!URL_) {
    console.error("GIT_WEBHOOK_URL is required (forge webtrigger create -f git-webhook -e development). The URL is a secret: keep it out of the repo.");
    process.exit(2);
  }
  const secret = crypto.randomBytes(20).toString("hex");

  // ---- 1. plant the stand-in connection + the per-repo signing secret ----
  const planted = await testState.post({ action: "plantHookSecret", connId: CONN, repoId: REPO, secret, plantConnection: true });
  if (planted.status !== 200) {
    console.log(`FAIL  plantHookSecret: HTTP ${planted.status} ${JSON.stringify(planted.body).slice(0, 200)}`);
    console.log("      The connection row may still have been created (the secret write is the later half) — pull `forge logs -e development` for the cause and clean up with deleteHarnessConnection.");
    failures += 1;
  } else {
    console.log(`PASS  plantHookSecret: connection ${planted.body?.connection?.id} status=${planted.body?.connection?.status} hasToken=${planted.body?.connection?.hasToken}`);
  }

  // A stand-in is credential-less BY CONSTRUCTION: the public shape carries no token
  // field at all, and testGitConnection must refuse it by name without any egress.
  const list = await testState.post({ action: "invokeResolver", functionKey: "listGitConnections", payload: {}, accountId: process.env.HARNESS_ADMIN_ACCOUNT_ID });
  const row = (list.body?.connections || []).find((c) => c.id === CONN) || null;
  check("stand-in row exists", Boolean(row), true);
  if (row) {
    check("stand-in carries no token", row.hasToken === false && !("token" in row) && !("secret" in row), true);
    check("allow-list is exactly the one repo", JSON.stringify(row.repos), JSON.stringify([REPO]));
  }
  const probe = await testState.post({ action: "invokeResolver", functionKey: "testGitConnection", payload: { id: CONN }, accountId: process.env.HARNESS_ADMIN_ACCOUNT_ID });
  check("testGitConnection refuses auth_dead", probe.body?.code, "auth_dead", probe.body?.error || "");

  // ---- 2. the documented answers, in order ----
  const sha = crypto.randomBytes(20).toString("hex");
  const body = prBody(1, sha);
  const deliveryId = `harness-${Date.now()}`;
  const first = await deliver(URL_, { body, secret, delivery: deliveryId });
  check("signed pull_request accepted", first.status, 202, JSON.stringify(first.body));
  check("  … and enqueued (not ignored)", first.body?.accepted === true, true);

  const again = await deliver(URL_, { body, secret, delivery: deliveryId });
  check("redelivery is a duplicate", again.status, 202);
  check("  … and enqueues nothing", again.body?.duplicate === true, true);

  // F-338/F-341: the canonical header casing must be read.
  const lower = await deliver(URL_, { body: prBody(2, sha), secret, sigHeader: "x-hub-signature-256", delivery: `harness-lc-${Date.now()}` });
  check("lower-cased signature header accepted", lower.status, 202);

  const bad = await deliver(URL_, { body, signature: "sha256=" + "0".repeat(64), delivery: `harness-bad-${Date.now()}` });
  check("wrong signature refused (401, NOT 404)", bad.status, 401, "a 404 here would mean routing failed, not verification");

  const unsigned = await deliver(URL_, { body, delivery: `harness-unsigned-${Date.now()}` });
  check("unsigned delivery refused", unsigned.status, 401);

  const unknown = await deliver(URL_, { body, secret, conn: `${CONN}-nope`, delivery: `harness-unknown-${Date.now()}` });
  check("unknown connection is one opaque 404", unknown.status, 404);

  const get = await deliver(URL_, { body, secret, method: "GET" });
  check("GET refused", get.status, 405);

  // ---- 2b. F-335: the retry contract, behind a planted dispatch fault (opt-in) ----
  // OPT-IN because it waits on the platform's retry schedule; see the polling budget note
  // in the header. Everything it arms is dev-hook-only and self-expiring (10 min TTL), and
  // the run disarms both levers in a finally so an aborted run leaves nothing behind.
  if (FAULT) {
    console.log(`\n--- F-335 dispatch-fault proof (budget ${Math.round(FAULT_BUDGET_MS / 60000)} min per wait) ---`);

    // CASE 1 — count=2: two forced failures, then the third attempt dispatches for real.
    const d1 = `harness-fault2-${Date.now()}`;
    const tryKey1 = gitDeliveryAttemptKey(CONN, d1);
    const claimKey1 = gitDeliveryClaimKey(CONN, d1);
    try {
      const armed = await testState.post({ action: "armGitDispatchFault", connectionId: CONN, deliveryId: d1, count: 2 });
      check("fault armed (count=2)", armed.body?.count, 2, JSON.stringify(armed.body).slice(0, 160));
      const acc = await deliver(URL_, { body: prBody(11, crypto.randomBytes(20).toString("hex")), secret, delivery: d1 });
      check("faulted delivery still ACCEPTED at the door", acc.status, 202, "the lever sits in the consumer, not in the webhook");

      const two = await pollRow(tryKey1, (v) => Number(v && v.attempts) >= 2);
      if (!two.ok) unverified("attempts reach 2", `saw attempts=${(two.value && two.value.attempts) ?? 0} after ${Math.round(two.ms / 1000)}s — the platform may simply not have retried yet; re-run or raise FAULT_BUDGET_MIN`);
      else {
        check("the platform redelivered and the attempt counter advanced", Number(two.value.attempts), 2);
        // The lever is consumed: nothing is left armed, so the NEXT attempt must run for real.
        const left = await testState.post({ action: "readGitDispatchFault", connectionId: CONN, deliveryId: d1 });
        check("both armed faults were consumed", left.body?.value === null, true, JSON.stringify(left.body?.value));
        // THE END STATE (F-367): `git_delivery` is written by the webhook at ACCEPT time
        // (src/index.js `gitWebhook`) and deleted by this consumer on every rethrown
        // failure — so the claim means COMPLETION, not acceptance. It used to be absent
        // after a retried success, which made the provider's Redeliver button a second
        // real run of the same delivery. The consumer now RE-TAKES it (FAIL_IF_EXISTS,
        // same 24 h TTL) whenever a dispatch succeeds after at least one release, so the
        // claim must be PRESENT here.
        const claimAfter = await kvRead(claimKey1);
        check("the claim is RE-TAKEN by the successful retry (F-367)", claimAfter !== null, true,
          "an absent claim here means a post-success provider Redeliver runs the delivery a second time");
        // PROOF BY BEHAVIOUR: re-sending the same delivery id must now be answered duplicate.
        const redup = await deliver(URL_, { body: prBody(11, crypto.randomBytes(20).toString("hex")), secret, delivery: d1 });
        check("…so a Redeliver after the success is answered duplicate", redup.body?.duplicate === true, true, JSON.stringify(redup.body));
        // POSITIVE EVIDENCE that attempt 3 dispatched: the ladder STOPS. A third failure
        // would write attempts=3 within one retry interval; a settle window that ends with
        // the counter still at 2 is the observable form of "the third attempt ran".
        const settleMs = Math.min(FAULT_BUDGET_MS, 4 * 60_000);
        const grew = await pollRow(tryKey1, (v) => Number(v && v.attempts) >= 3, settleMs);
        check("the retry ladder STOPPED at 2 — the third attempt dispatched", grew.ok === false, true,
          `attempts=${(grew.value && grew.value.attempts) ?? 0} after a ${Math.round(settleMs / 1000)}s settle window`);
      }
      // WHAT THIS SCRIPT CANNOT SEE: "one run queued, one property written" is reported by
      // the consumer's own line, not by any readable row. Confirm it in
      //   forge logs -e development | grep "\[git-event\]"
      // exactly ONE `… run(s) queued …` line for this delivery id's envelope.
      console.log(`      queued/property counts are in the consumer log only — grep forge logs for [git-event] (delivery ${d1}).`);
    } finally {
      await testState.post({ action: "disarmGitDispatchFault", connectionId: CONN, deliveryId: d1 });
    }

    // CASE 2 — count=5 (> the cap): the delivery is DROPPED after GIT_DISPATCH_MAX_ATTEMPTS
    // and the claim is RELEASED, so the provider's Redeliver button gets a fresh accept
    // rather than `duplicate` — the whole point of F-335.
    const d2 = `harness-fault5-${Date.now()}`;
    const tryKey2 = gitDeliveryAttemptKey(CONN, d2);
    const claimKey2 = gitDeliveryClaimKey(CONN, d2);
    const body2 = prBody(12, crypto.randomBytes(20).toString("hex"));
    try {
      const armed2 = await testState.post({ action: "armGitDispatchFault", connectionId: CONN, deliveryId: d2, count: 5 });
      check("fault armed (count=5, past the cap)", armed2.body?.count, 5, JSON.stringify(armed2.body).slice(0, 160));
      const acc2 = await deliver(URL_, { body: body2, secret, delivery: d2 });
      check("poison delivery accepted at the door", acc2.status, 202);

      const capped = await pollRow(tryKey2, (v) => Number(v && v.attempts) >= GIT_DISPATCH_MAX_ATTEMPTS);
      if (!capped.ok) unverified(`attempts reach the cap (${GIT_DISPATCH_MAX_ATTEMPTS})`, `saw attempts=${(capped.value && capped.value.attempts) ?? 0} after ${Math.round(capped.ms / 1000)}s — raise FAULT_BUDGET_MIN and re-run`);
      else {
        check("the retry ladder stops at the documented cap", Number(capped.value.attempts), GIT_DISPATCH_MAX_ATTEMPTS);
        // The final attempt DROPS: it returns instead of rethrowing, so it does NOT release
        // the claim… which is why the claim must already be gone from the previous release.
        const claimNow = await kvRead(claimKey2);
        check("the claim is NOT held after the drop", claimNow === null, true,
          "a held claim here would answer the provider's Redeliver 'duplicate' for a delivery that never ran");
        // PROOF BY BEHAVIOUR, not by row: redelivering the same id must be a FRESH accept.
        const again2 = await deliver(URL_, { body: body2, secret, delivery: d2 });
        check("redelivery after the drop is a fresh ACCEPT", again2.status, 202);
        check("…and is NOT answered duplicate", again2.body?.duplicate === true, false, JSON.stringify(again2.body));
        console.log(`      the loud drop line is in the consumer log: forge logs -e development | grep "DELIVERY DROPPED" (delivery ${d2}).`);
      }
    } finally {
      await testState.post({ action: "disarmGitDispatchFault", connectionId: CONN, deliveryId: d2 });
    }
  } else {
    console.log("\n(FAULT=1 to also run the F-335 dispatch-retry proof — it waits on the platform's retry schedule.)");
  }

  // ---- 3. cleanup ----
  if (!KEEP) {
    const gone = await testState.post({ action: "deleteHarnessConnection", connId: CONN });
    check("stand-in removed", gone.body?.ok === true, true, JSON.stringify(gone.body).slice(0, 120));
  } else {
    console.log("KEEP=1 — the stand-in connection is still installed; remove it with deleteHarnessConnection.");
  }

  if (notVerified) console.log(`\n${notVerified} check(s) NOT VERIFIED (budget reached before the platform retried) — that is neither a pass nor a failure.`);
  console.log(failures ? `\n${failures} check(s) FAILED` : (notVerified ? "\nno check failed, but the run is INCOMPLETE" : "\nall checks passed"));
  process.exit(failures ? 1 : (notVerified ? 3 : 0));
};

main().catch((e) => { console.error("harness error:", e && e.message); process.exit(2); });
