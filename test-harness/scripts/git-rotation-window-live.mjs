/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * F-481 - THE ROTATION WINDOW, LIVE, AGAINST A REAL GITHUB REPOSITORY.
 *
 * `rotateGitHookSecret` (src/git-connections.js) is three steps in this order: STORE the
 * new secret in the row's `pending` slot, PATCH the provider, PROMOTE. The guarantee is
 * "no step can leave a hook signing with a secret we do not hold", and after F-481 it
 * covers the STORE too: if step 3 throws, the pending slot is already carrying the
 * INSTALLED secret, `getHookSecretCandidates` accepts BOTH for the window so deliveries
 * keep arriving, and the connection is stamped `hookState:"rotation-failed"`.
 *
 * WHAT THIS SCRIPT PROVES, AND WHAT IT DOES NOT.
 *
 *   PROVEN: after a real rotation driven through the admin UI, a REAL GitHub delivery -
 *   signed by GitHub with the secret it now holds - is ACCEPTED by the production
 *   `git-webhook` trigger with 202. That is the whole guarantee stated positively: the
 *   secret at the provider and the secret in KVS are the same one. It is asked of
 *   GITHUB's own delivery record (the response code GitHub saw), not of our return value.
 *   The negative is proven on the same object first: a delivery signed with a WRONG
 *   secret, sent to the same url, is REFUSED - so an accepted 202 means the signature
 *   was checked and passed, not that the endpoint accepts anything.
 *
 *   NOT VERIFIED BY THIS SCRIPT, AND DELIBERATELY NOT FAKED: the step-3 failure itself.
 *   F-504 gave it the lever it lacked - `src/harness-fault.js` kind
 *   `HARNESS_FAULT_HOOK_PROMOTE`, armed through the dev hook action `armHookPromoteFault`
 *   and consumed at the promote write - but THIS run does not arm it; a follow-up does.
 *   `plantHookSecret` writes `{secret, connId, repoId, createdAt}` and has no `pending`
 *   field, and the `kvSet` allow-list is explicitly NOT widened to `git_conn_secret:*`
 *   ("secrets are never plantable"). So neither the fault nor the two-slot state can be
 *   produced from outside the app, and `hookState:"rotation-failed"` cannot be observed
 *   live on this build. This script reports that as NOT VERIFIED and reads the banner
 *   field anyway, so at least its presence and its cleared value are on the record.
 *
 * It runs AFTER `git-webhook-setup-live.mjs setup` and `... rotate`, reading the
 * connection and hook ids out of their shared state file. Cleanup is that script's
 * `cleanup` phase.
 *
 * Usage (from test-harness/):
 *   GH_TOKEN=... GIT_WEBHOOK_URL=... node scripts/git-rotation-window-live.mjs
 *
 * NOTHING SECRET IS PRINTED - not the GitHub token, not the trigger url, not a signing
 * secret (there is no read path for one anywhere).
 */

import fs from "node:fs";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { loadEnv, requireEnv } from "../lib/env.mjs";
import { gitHookUrl } from "../lib/git-hook-url.mjs";

const env = loadEnv();
const REPO = process.env.GIT_REPO_ID || "leanzero-srl/cognirunner-forge-offshoot";
const TRIGGER = process.env.GIT_WEBHOOK_URL || "";
const SECRET = requireEnv("HARNESS_SECRET");
const ADMIN = requireEnv("HARNESS_ADMIN_ACCOUNT_ID");
const STATE = new URL("../results/git-webhook-setup/state.json", import.meta.url).pathname;

let passes = 0, fails = 0, unproven = 0;
/** The objects this script BORROWS from git-webhook-setup-live.mjs; checked in the finally. */
const borrowed = { connId: null, hookId: null };
const PASS = (s) => { passes++; console.log(`  PASS  ${s}`); };
const FAIL = (s) => { fails++; console.log(`  FAIL  ${s}`); };
const NV = (s) => { unproven++; console.log(`  N/V   ${s}`); };
const info = (s) => console.log(`        ${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const gh = (args, body) => {
  const out = execFileSync("gh", args, {
    env: { ...process.env, GH_TOKEN: process.env.GH_TOKEN },
    input: body === undefined ? undefined : JSON.stringify(body),
    encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
  });
  return out.trim() ? JSON.parse(out) : null;
};

async function invoke(functionKey, payload = {}) {
  const r = await fetch(env.TESTSTATE_URL, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + SECRET },
    body: JSON.stringify({ action: "invokeResolver", functionKey, payload, accountId: ADMIN }),
  });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ }
  return { status: r.status, body: j, raw: j ? null : t.slice(0, 200) };
}

const hookUrl = (connId) => gitHookUrl(TRIGGER, connId, REPO);

async function main() {
  console.log("\nF-481 - THE ROTATION WINDOW, live on DEV against a real GitHub repository\n");
  if (!TRIGGER) throw new Error("GIT_WEBHOOK_URL is required (forge webtrigger list -f git-webhook -e development)");
  if (!fs.existsSync(STATE)) throw new Error("run `node scripts/git-webhook-setup-live.mjs setup` then `... rotate` first");
  const st = JSON.parse(fs.readFileSync(STATE, "utf8"));
  const connId = st.conn1, hookId = st.hook1;
  if (!connId || !hookId) throw new Error("the setup state has no conn1/hook1");
  borrowed.connId = connId; borrowed.hookId = hookId;
  info(`connection ${connId}, GitHub hook ${hookId}, repo ${REPO}`);

  /* ── STEP 1 — the banner field, as the Code tab reads it ─────────────────── */
  console.log("STEP 1 - the F-481 banner field on the connection row");
  const conns = await invoke("listGitConnections", {});
  const row = ((conns.body && conns.body.connections) || []).find((c) => c.id === connId);
  const rec = row && row.webhooks && row.webhooks[REPO];
  if (!rec) { FAIL(`the connection row has no webhook record for ${REPO}`); return; }
  info(`webhook record: ${JSON.stringify(rec)}`);
  if ("hookState" in rec && "hookStateAt" in rec) PASS(`the public shape carries the banner fields: hookState=${JSON.stringify(rec.hookState)} hookStateAt=${JSON.stringify(rec.hookStateAt)}`);
  else FAIL(`the public webhook shape has no hookState/hookStateAt: ${JSON.stringify(rec)}`);
  if (rec.hookState === null) PASS("hookState is null after a SUCCESSFUL rotation - the sticky banner was cleared by the promote (`clearState: true`)");
  else FAIL(`hookState is ${JSON.stringify(rec.hookState)} after a successful rotation`);
  if (rec.rotatedAt) PASS(`rotatedAt is stamped: ${rec.rotatedAt}`);
  else FAIL("rotatedAt is not stamped, so the rotation did not complete");
  if (!JSON.stringify(row).includes("secret")) PASS("the connection's public shape contains no secret of any kind");
  else FAIL("the connection's public shape mentions a secret");

  /* ── STEP 2 — THE NEGATIVE, ON THE SAME OBJECT, FIRST ───────────────────── */
  console.log("\nSTEP 2 - the negative first: a delivery signed with a WRONG secret must be refused");
  const payload = JSON.stringify({ zen: "harness rotation-window probe", hook_id: Number(hookId), repository: { full_name: REPO } });
  const send = async (secret, label) => {
    const sig = "sha256=" + crypto.createHmac("sha256", secret).update(payload).digest("hex");
    const res = await fetch(hookUrl(connId), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "ping",
        "X-GitHub-Delivery": `harness-${label}-${Date.now()}`,
        "X-Hub-Signature-256": sig,
      },
      body: payload,
    });
    const text = await res.text();
    return { status: res.status, body: text.slice(0, 200) };
  };
  const bad = await send("thisIsNotTheSecret" + "0".repeat(20), "bad");
  info(`a delivery signed with a WRONG secret -> HTTP ${bad.status} ${bad.body}`);
  if (bad.status !== 202) PASS(`REFUSED (${bad.status}) - the signature IS checked on this url, so a 202 below means the signature passed`);
  else FAIL("a delivery signed with a wrong secret was ACCEPTED (202) - the signature is not being checked");

  /* ── STEP 3 — GITHUB's own delivery, signed with the ROTATED secret ──────── */
  console.log("\nSTEP 3 - GitHub redelivers, signed with the secret the ROTATION installed");
  // `POST /hooks/{id}/tests` makes GitHub send a real event, signed with the secret
  // GitHub holds - which is the one the rotation PATCHed in. Asking GitHub's delivery
  // record for the response code it saw is the second read: our own 202 would only be
  // our own opinion.
  try { gh(["api", "-X", "POST", `/repos/${REPO}/hooks/${hookId}/tests`]); }
  catch (e) { FAIL(`GitHub refused to fire a test delivery: ${String(e.message).slice(0, 200)}`); return; }
  info("test delivery fired; waiting up to 60s for GitHub to record the response");
  let delivery = null;
  for (let i = 0; i < 20; i++) {
    await sleep(3000);
    const list = gh(["api", `/repos/${REPO}/hooks/${hookId}/deliveries?per_page=5`]) || [];
    delivery = list.find((d) => Date.parse(d.delivered_at) > Date.now() - 180000) || null;
    if (delivery && delivery.status_code) break;
  }
  if (!delivery) { FAIL("GitHub recorded no delivery for the test"); return; }
  info(`GitHub's delivery record: event=${delivery.event} status_code=${delivery.status_code} status="${delivery.status}" at=${delivery.delivered_at}`);
  if (Number(delivery.status_code) === 202) PASS(`GITHUB saw 202 - the secret GitHub signs with after the rotation is the secret the app holds (F-481's guarantee, stated positively)`);
  else FAIL(`GitHub saw ${delivery.status_code} "${delivery.status}" - the rotated hook is DEAF`);

  /* ── STEP 4 — what cannot be proven here, and exactly why ───────────────── */
  console.log("\nSTEP 4 - the step-3-failure arm");
  NV("the PROMOTE failure (step 3 of rotateGitHookSecret) is not exercised by THIS script: F-504 added the lever it needed - src/harness-fault.js kind HARNESS_FAULT_HOOK_PROMOTE, armed via the dev hook action `armHookPromoteFault` ({connectionId, repoId, count}) and consumed at the promote write - so a follow-up run can arm one unit, rotate, and read the banner for real.");
  NV("the two-slot state cannot be planted either: plantHookSecret writes {secret, connId, repoId, createdAt} with no `pending` field, and the kvSet allow-list is deliberately not widened to git_conn_secret:* (\"secrets are never plantable\").");
  NV('so `hookState:"rotation-failed"` and the pending-secret acceptance window remain NOT VERIFIED by this run. The lever now exists (armHookPromoteFault, HARNESS_SECRET-gated, inert in production); driving it live is the next run, not this one.');

  console.log(`\nRESULT - ${passes} pass, ${fails} fail, ${unproven} not verified`);
  if (fails) process.exitCode = 1;
}

/*
 * THIS SCRIPT CREATES NOTHING, SO IT DELETES NOTHING — the connection and the GitHub hook
 * belong to `git-webhook-setup-live.mjs`, whose `cleanup` phase removes them. What it CAN
 * do is damage that borrowed fixture (it fires real deliveries at a real hook), and the
 * cheapest way for that damage to go unnoticed is for this script to simply end.
 *
 * So the same rule the cleanup phases now follow applies here: PROVE BY A SECOND READ that
 * the fixture this run borrowed is still intact — `listGitConnections` through the hook and
 * `gh api /repos/…/hooks` on GitHub — and FAIL LOUD, named, if it is not. A missing hook
 * here means the NEXT script in the chain will fail for a reason that started in this one.
 */
main()
  .catch((e) => { console.error("\nDRIVER ERROR:", e && e.message); process.exitCode = 1; })
  .finally(async () => {
    if (!borrowed.connId || !borrowed.hookId) return;
    console.log("\nFIXTURE CHECK - this script owns no objects; it proves it did not break the ones it borrowed");
    const problems = [];
    const conns = await invoke("listGitConnections", {}).catch((e) => ({ body: { error: e.message } }));
    const rows = (conns.body && conns.body.connections) || null;
    if (!Array.isArray(rows)) {
      problems.push(`listGitConnections could not be read (${JSON.stringify(conns.body).slice(0, 160)}), so the connection's survival is UNPROVEN`);
    } else {
      const row = rows.find((c) => c.id === borrowed.connId);
      const rec = row && row.webhooks && row.webhooks[REPO];
      console.log(`        connection ${borrowed.connId}: ${row ? "present" : "GONE"}; webhook record for ${REPO}: ${rec ? "present" : "GONE"}`);
      if (!row) problems.push(`the borrowed connection ${borrowed.connId} is gone from listGitConnections`);
      else if (!rec) problems.push(`the borrowed connection no longer records a webhook for ${REPO}`);
    }
    let hooks = null;
    try { hooks = gh(["api", `/repos/${REPO}/hooks`]); } catch (e) { problems.push(`GitHub's hook list could not be read (${String(e.message).slice(0, 120)}), so the hook's survival is UNPROVEN`); }
    if (Array.isArray(hooks)) {
      const h = hooks.find((x) => String(x.id) === String(borrowed.hookId));
      console.log(`        GitHub hook ${borrowed.hookId}: ${h ? `present, active=${h.active} signed=${h.config && h.config.secret === "********"}` : "GONE"}`);
      if (!h) problems.push(`the borrowed GitHub hook ${borrowed.hookId} is gone from ${REPO}`);
      else if (!h.active || !(h.config && h.config.secret === "********")) problems.push(`the borrowed hook ${borrowed.hookId} is no longer active-and-signed (active=${h.active})`);
    }
    if (problems.length) {
      console.error(`\nFIXTURE CHECK FAILED — the shared webhook fixture is not as this run found it:\n        ${problems.join("\n        ")}`);
      console.error("        Re-run `node scripts/git-webhook-setup-live.mjs setup` (and `... rotate`) before anything else uses it.");
      process.exitCode = 1;
    }
  });
