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
 * KNOWN BLOCKER (2026-09-13, F-346): `gitHookSecretKey` embeds the repo id
 * "owner/name" verbatim and Forge KVS rejects "/" in a key, so the plant fails with
 * INVALID_KEY and every delivery answers 503. This script reports that as a FAIL
 * with the KVS error attached rather than pretending the surface is unproven.
 *
 *   node scripts/git-inbound-live.mjs                 # plant, deliver, assert, clean up
 *   KEEP=1 node scripts/git-inbound-live.mjs          # leave the stand-in row in place
 *   GIT_WEBHOOK_URL=<url> node scripts/git-inbound-live.mjs
 *
 * Env (test-harness/.env): TESTSTATE_URL + HARNESS_SECRET. The web-trigger URL is
 * NOT discoverable through the hook (only `rules-api` is), so mint it once with
 * `forge webtrigger create -f git-webhook -e development` and pass it in
 * GIT_WEBHOOK_URL. Neither the URL nor any secret is ever printed.
 */
import crypto from "node:crypto";
import { testState } from "../lib/rules-api.mjs";

const CONN = process.env.GIT_CONN_ID || "harness-git-live";
const REPO = process.env.GIT_REPO_ID || "leanzero-srl/cognirunner-forge-offshoot";
const URL_ = process.env.GIT_WEBHOOK_URL || "";
const KEEP = process.env.KEEP === "1";

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

  // ---- 3. cleanup ----
  if (!KEEP) {
    const gone = await testState.post({ action: "deleteHarnessConnection", connId: CONN });
    check("stand-in removed", gone.body?.ok === true, true, JSON.stringify(gone.body).slice(0, 120));
  } else {
    console.log("KEEP=1 — the stand-in connection is still installed; remove it with deleteHarnessConnection.");
  }

  console.log(failures ? `\n${failures} check(s) FAILED` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
};

main().catch((e) => { console.error("harness error:", e && e.message); process.exit(2); });
