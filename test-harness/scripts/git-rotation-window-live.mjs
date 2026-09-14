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
// F-686 — every driver that arms a harness fault goes through the ONE acknowledgement.
import { requireEnvAck } from "../lib/shared-env-guard.mjs";
import { gitHookUrl } from "../lib/git-hook-url.mjs";

/* F-686 — DEV-ONLY BY CONSTRUCTION: both hook calls below go to `env.TESTSTATE_URL`, and
 * there is no staging trigger for this flow, so `--env` is decided FOR this driver and the
 * acknowledgement is mandatory. `armHookPromoteFault` makes a secret rotation fail at its
 * promote step, and the connection card shows "rotation failed" to anyone who opens it. */
requireEnvAck([...process.argv.slice(2), "--env=dev"], {
  faults: ["hookPromote"],
  script: "git-rotation-window-live.mjs",   // count-bounded: one unit, no TTL to quote
});

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


/* ═══════════════════════════════════════════════════════════════════════════════
 * F-504 / F-481 / F-491 — THE FAULT PHASE.  `node scripts/git-rotation-window-live.mjs fault`
 *
 * What the run above could not do, this one does: it ARMS the dev-only promote fault
 * (src/harness-fault.js kind `hook-promote`, action `armHookPromoteFault`, one unit),
 * rotates through the REAL Code tab, and then asks — of the app, of the DOM and of
 * GITHUB — the three questions F-481 and F-491 are made of:
 *
 *   1. the rotate is REFUSED with code "rotation-failed" and the row is stamped
 *      `hookState:"rotation-failed"` (F-481's loud half);
 *   2. a REAL GitHub delivery, which GitHub now signs with the NEW secret, is still
 *      ACCEPTED 202 — the pending slot is live, the hook is not deaf (F-481's quiet half);
 *   3. rotating AGAIN on top of that state SUCCEEDS — step 0 promotes the installed
 *      pending secret before minting (F-491, reconcile-then-rotate) — the banner clears,
 *      and a delivery signed with the newest secret is STILL accepted.
 *
 * The negative is proven on the same object first (a wrong-secret delivery to the same
 * url is refused), so every 202 below means the signature was checked and passed.
 * The lever is read back after the rotate to prove it was CONSUMED — one armed unit,
 * one failure — so the failure observed is the planted one and not a real defect.
 *
 * NOTHING SECRET IS PRINTED. Cleanup belongs to git-webhook-setup-live.mjs `cleanup`.
 * ═══════════════════════════════════════════════════════════════════════════════ */

const BASE = "https://wolfaenpak.atlassian.net";
const APP = "36415848-6868-4697-9554-3c3ad87b8da9";
const DEV_ENV = forgeEnvId("dev");
const PROFILE = "/Users/mihaiperdum/Projects/forge-live-harness/.auth/profile";

/** The dev hook, raw — the fault actions are not resolvers, they are hook actions. */
async function hookAction(body) {
  const r = await fetch(env.TESTSTATE_URL, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + SECRET },
    body: JSON.stringify(body),
  });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ }
  return { status: r.status, body: j, raw: j ? null : t.slice(0, 200) };
}

async function openCodeTab() {
  const { chromium } = await import("../../static/_screenshot-harness/node_modules/playwright/index.mjs");
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true, viewport: { width: 1500, height: 1200 } });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto(`${BASE}/jira/apps/${APP}/${DEV_ENV}`, { waitUntil: "domcontentloaded" });
  let frame = null;
  for (let i = 0; i < 90; i++) {
    frame = page.frames().find((f) => f.url().includes("cdn.prod.atlassian-dev.net"));
    if (frame && (await frame.locator(".tab-btn").count()) > 0) break;
    await sleep(1000);
  }
  if (!frame) { await ctx.close(); throw new Error("the admin panel iframe never appeared — is the persistent profile still signed in?"); }
  await frame.locator(".tab-btn", { hasText: /^\s*Code\s*$/ }).click();
  await frame.locator(".code-conns, .empty-state, .load-error").first().waitFor({ state: "visible", timeout: 60000 }).catch(() => {});
  return { ctx, frame };
}

const repoRowFor = (frame, label) =>
  frame.locator(".code-conn").filter({ has: frame.locator(".code-conn-label", { hasText: label }) })
    .locator(".code-repo-row").filter({ has: frame.locator(".code-repo", { hasText: REPO }) });

/** Click Rotate secret → confirm in the app's OWN dialog. Returns the toasts it raised. */
async function clickRotate(frame, label) {
  const rr = repoRowFor(frame, label);
  await rr.locator("button", { hasText: /^(Rotate secret|Working…)$/ }).click();
  await frame.locator(".cr-confirm-actions button", { hasText: /^Rotate$/ }).last().click();
  const seen = new Set();
  for (let i = 0; i < 48; i++) {
    for (const t of await frame.locator(".mls-toast").allInnerTexts().catch(() => [])) seen.add(t.replace(/^✕\s*/, "").trim());
    await sleep(250);
  }
  return [...seen];
}

/** Fire a REAL GitHub test delivery on the hook and return GitHub's own record of it. */
async function githubDelivery(hookId, sinceMs) {
  gh(["api", "-X", "POST", `/repos/${REPO}/hooks/${hookId}/tests`]);
  for (let i = 0; i < 20; i++) {
    await sleep(3000);
    const list = gh(["api", `/repos/${REPO}/hooks/${hookId}/deliveries?per_page=10`]) || [];
    const d = list.find((x) => Date.parse(x.delivered_at) >= sinceMs - 5000 && x.status_code);
    if (d) return d;
  }
  return null;
}

const readRec = async (connId) => {
  const conns = await invoke("listGitConnections", {});
  const row = ((conns.body && conns.body.connections) || []).find((c) => c.id === connId);
  return { row, rec: row && row.webhooks && row.webhooks[REPO] };
};

async function faultPhase() {
  console.log("\nF-504 / F-481 / F-491 — the ROTATION-FAILED window, driven for real on DEV\n");
  if (!TRIGGER) throw new Error("GIT_WEBHOOK_URL is required");
  if (!process.env.GH_TOKEN) throw new Error("GH_TOKEN is required");
  if (!fs.existsSync(STATE)) throw new Error("run `node scripts/git-webhook-setup-live.mjs setup` first");
  const st = JSON.parse(fs.readFileSync(STATE, "utf8"));
  const { conn1: connId, hook1: hookId, label1: label } = st;
  if (!connId || !hookId || !label) throw new Error("the setup state has no conn1/hook1/label1");
  borrowed.connId = connId; borrowed.hookId = hookId;
  info(`connection ${connId} ("${label}"), GitHub hook ${hookId}, repo ${REPO}`);

  /* ── STEP 0 — the baseline, and the negative control on the SAME url ─────── */
  console.log("STEP 0 — baseline: the hook is healthy and its signature IS checked");
  const base = await readRec(connId);
  if (!base.rec) { FAIL("the connection row has no webhook record — run setup first"); return; }
  info(`webhook record before: ${JSON.stringify(base.rec)}`);
  if (base.rec.hookState === null) PASS("hookState starts null (no banner) — so a 'rotation-failed' below is this run's doing");
  else FAIL(`hookState is already ${JSON.stringify(base.rec.hookState)} before the fault is armed`);

  const payload = JSON.stringify({ zen: "harness fault-window probe", hook_id: Number(hookId), repository: { full_name: REPO } });
  const sendSigned = async (secret, tag) => {
    const sig = "sha256=" + crypto.createHmac("sha256", secret).update(payload).digest("hex");
    const res = await fetch(hookUrl(connId), {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-GitHub-Event": "ping", "X-GitHub-Delivery": `harness-${tag}-${Date.now()}`, "X-Hub-Signature-256": sig },
      body: payload,
    });
    return { status: res.status, body: (await res.text()).slice(0, 160) };
  };
  const bad = await sendSigned("thisIsNotTheSecret" + "0".repeat(20), "bad");
  info(`a delivery signed with a WRONG secret -> HTTP ${bad.status} ${bad.body}`);
  if (bad.status !== 202) PASS(`REFUSED (${bad.status}) on the SAME url — so every 202 below means the signature passed, not that the endpoint is open`);
  else FAIL("a wrong-secret delivery was ACCEPTED (202) — the signature is not being checked, and no 202 below proves anything");

  /* ── STEP 1 — ARM the dev-only promote fault ─────────────────────────────── */
  console.log("\nSTEP 1 — arm the F-504 promote fault (one unit) on this connection+repo");
  const pre = await hookAction({ action: "readHookPromoteFault", connectionId: connId, repoId: REPO });
  info(`readHookPromoteFault before arming: ${JSON.stringify(pre.body)}`);
  const levelCount = (r) => Number((r && r.body && r.body.value && r.body.value.count) || 0);
  if (pre.status === 200 && levelCount(pre) === 0) PASS("the lever starts DISARMED (count absent/0) — the control for 'consumed' below");
  else FAIL(`the lever is not disarmed before this run: ${JSON.stringify(pre.body)}`);

  const armed = await hookAction({ action: "armHookPromoteFault", connectionId: connId, repoId: REPO, count: 1 });
  info(`armHookPromoteFault -> HTTP ${armed.status} ${JSON.stringify(armed.body)}`);
  if (armed.status === 200 && armed.body && armed.body.ok) PASS("armHookPromoteFault accepted one unit");
  else { FAIL(`armHookPromoteFault refused: ${JSON.stringify(armed.body || armed.raw)}`); return; }
  const armedRead = await hookAction({ action: "readHookPromoteFault", connectionId: connId, repoId: REPO });
  info(`readHookPromoteFault after arming: ${JSON.stringify(armedRead.body)}`);
  if (levelCount(armedRead) === 1) PASS("the lever reads back count=1 — it is armed on THIS connection+repo, not another");
  else FAIL(`the armed lever does not read back as one unit: ${JSON.stringify(armedRead.body)}`);

  /* ── STEP 2 — rotate through the REAL Code tab; expect a named refusal ──── */
  console.log("\nSTEP 2 — rotate through the admin panel's Code tab with the fault armed");
  let ctx, frame;
  try {
    ({ ctx, frame } = await openCodeTab());
    const said = await clickRotate(frame, label);
    info(`toasts: ${JSON.stringify(said)}`);
    const refusalSaid = said.some((t) => /installed at the provider but could not be stored/i.test(t));
    if (refusalSaid) PASS('the Code tab said the rotation half-finished, in the app\'s own words ("installed at the provider but could not be stored")');
    else FAIL(`the Code tab did not raise the rotation-failed refusal; toasts were ${JSON.stringify(said)}`);
    if (!said.some((t) => /Webhook secret rotated/i.test(t))) PASS("no success toast was shown — the refusal was not also reported as a success");
    else FAIL("the Code tab reported BOTH a failure and a success for the same rotation");

    /* ── STEP 3 — the RED BANNER, read off the DOM ─────────────────────────── */
    console.log("\nSTEP 3 — the red banner the admin actually sees");
    const rr = repoRowFor(frame, label);
    const banner = rr.locator(".code-hook-broken");
    let shown = true;
    try { await banner.waitFor({ state: "visible", timeout: 30000 }); } catch { shown = false; }
    if (shown) {
      const title = (await banner.locator(".code-hook-broken-title").innerText()).trim();
      const text = (await banner.locator(".code-hook-broken-text").innerText()).trim();
      const btn = (await banner.locator(".code-hook-broken-action").innerText()).trim();
      info(`banner title: "${title}"`);
      info(`banner text:  "${text}"`);
      info(`banner action button: "${btn}"`);
      if (/LAST SECRET ROTATION DID NOT FINISH/i.test(title)) PASS("the banner names the state in full, in the row for this repository");
      else FAIL(`the banner title is not the F-481 wording: "${title}"`);
      if (text.includes(REPO) && /set up again/i.test(text)) PASS("the banner names the repository and the remedy");
      else FAIL(`the banner text does not name the repository and the remedy: "${text}"`);
      if (/^Set up webhook$/i.test(btn)) PASS('the banner carries the "Set up webhook" self-heal button');
      else FAIL(`the banner's action button is not "Set up webhook": "${btn}"`);
      if (!/[a-f0-9]{20}/.test(title + text + btn)) PASS("the banner shows no secret material of any kind");
      else FAIL("the banner appears to contain secret-looking material");
    } else {
      FAIL("the red rotation-failed banner never appeared in the Code tab");
    }
  } finally { if (ctx) await ctx.close(); }

  /* ── STEP 4 — the app's own row, and the lever's consumption ─────────────── */
  console.log("\nSTEP 4 — the stamped state, read back through the app");
  const after1 = await readRec(connId);
  info(`webhook record after the failed rotation: ${JSON.stringify(after1.rec)}`);
  if (after1.rec && after1.rec.hookState === "rotation-failed") PASS('the connection row is stamped hookState:"rotation-failed" (F-481)');
  else FAIL(`hookState is ${JSON.stringify(after1.rec && after1.rec.hookState)}, not "rotation-failed"`);
  if (after1.rec && after1.rec.hookStateAt) PASS(`hookStateAt is stamped: ${after1.rec.hookStateAt}`);
  else FAIL("hookStateAt is not stamped alongside the state");
  if (!JSON.stringify(after1.row || {}).includes("secret")) PASS("the connection's public shape still contains no secret of any kind");
  else FAIL("the connection's public shape mentions a secret");

  const lw = await invoke("listGitWebhooks", { connectionId: connId, repo: REPO });
  info(`listGitWebhooks through the dev hook -> HTTP ${lw.status} ${JSON.stringify(lw.body || lw.raw).slice(0, 220)}`);
  if (lw.body && lw.body.success) {
    const recorded = lw.body.recorded;
    if (recorded && recorded.hookState === "rotation-failed") PASS("listGitWebhooks reports the same hookState as listGitConnections");
    else FAIL(`listGitWebhooks.recorded does not carry the state: ${JSON.stringify(recorded)}`);
  } else {
    NV(`listGitWebhooks is not on the dev hook's invokeResolver allow-list, so the state is read through listGitConnections instead (same row, same field): ${JSON.stringify(lw.body || lw.raw).slice(0, 160)}`);
  }

  const consumed = await hookAction({ action: "readHookPromoteFault", connectionId: connId, repoId: REPO });
  info(`readHookPromoteFault after the rotate: ${JSON.stringify(consumed.body)}`);
  if (levelCount(consumed) === 0) PASS("the armed unit was CONSUMED — exactly one planted failure, so what was observed is the planted fault and not a real defect");
  else FAIL(`the lever still reads count=${levelCount(consumed)} — the failure above may not have come from it`);

  /* ── STEP 5 — the hook is NOT deaf: GitHub's own delivery, 202 ──────────── */
  console.log("\nSTEP 5 — the pending slot is live: GitHub now signs with the NEW secret");
  const t1 = Date.now();
  const d1 = await githubDelivery(hookId, t1);
  if (!d1) { FAIL("GitHub recorded no delivery for the test after the failed rotation"); }
  else {
    info(`GitHub's delivery record: event=${d1.event} status_code=${d1.status_code} status="${d1.status}" at=${d1.delivered_at}`);
    if (Number(d1.status_code) === 202) PASS("GITHUB saw 202 during the rotation window — the PENDING secret is accepted, the hook is not deaf (F-481's quiet half)");
    else FAIL(`GitHub saw ${d1.status_code} "${d1.status}" — the hook went DEAF inside the rotation window`);
  }

  /* ── STEP 6 — F-491: rotate AGAIN on top of the broken state ────────────── */
  console.log("\nSTEP 6 — F-491: rotating AGAIN reconciles first, then rotates");
  let ctx2, frame2;
  try {
    ({ ctx: ctx2, frame: frame2 } = await openCodeTab());
    const rr = repoRowFor(frame2, label);
    let bannerWasThere = true;
    try { await rr.locator(".code-hook-broken").waitFor({ state: "visible", timeout: 30000 }); } catch { bannerWasThere = false; }
    if (bannerWasThere) PASS("the banner is STICKY — it is still there on a fresh load of the tab, not just in the rotating session");
    else FAIL("the banner was gone on a fresh load, so the state was not persisted");

    const said = await clickRotate(frame2, label);
    info(`toasts: ${JSON.stringify(said)}`);
    if (said.some((t) => /Webhook secret rotated/i.test(t))) PASS("the SECOND rotation succeeded — step 0 promoted the installed pending secret before minting (F-491)");
    else FAIL(`the second rotation did not succeed; toasts were ${JSON.stringify(said)}`);

    let gone = true;
    try { await rr.locator(".code-hook-broken").waitFor({ state: "detached", timeout: 30000 }); } catch { gone = !(await rr.locator(".code-hook-broken").isVisible().catch(() => false)); }
    if (gone) PASS("the red banner is GONE from the Code tab after the successful rotation — the self-heal button was never needed");
    else FAIL("the red banner is still displayed after a successful rotation");
  } finally { if (ctx2) await ctx2.close(); }

  const after2 = await readRec(connId);
  info(`webhook record after the successful rotation: ${JSON.stringify(after2.rec)}`);
  if (after2.rec && after2.rec.hookState === null) PASS("hookState is cleared back to null by the successful promote (clearState: true)");
  else FAIL(`hookState is ${JSON.stringify(after2.rec && after2.rec.hookState)} after a successful rotation`);
  if (after2.rec && after2.rec.rotatedAt) PASS(`rotatedAt is stamped: ${after2.rec.rotatedAt}`);
  else FAIL("rotatedAt is not stamped after the successful rotation");

  /* ── STEP 7 — and the hook still works, asked of GitHub ─────────────────── */
  console.log("\nSTEP 7 — GitHub delivers again, signed with the secret the SECOND rotation installed");
  const t2 = Date.now();
  const d2 = await githubDelivery(hookId, t2);
  if (!d2) { FAIL("GitHub recorded no delivery for the test after the successful rotation"); }
  else {
    info(`GitHub's delivery record: event=${d2.event} status_code=${d2.status_code} status="${d2.status}" at=${d2.delivered_at}`);
    if (Number(d2.status_code) === 202) PASS("GITHUB saw 202 after the recovery rotation — the secret at the provider is the secret the app holds");
    else FAIL(`GitHub saw ${d2.status_code} "${d2.status}" — the recovered hook is DEAF`);
  }

  // Belt and braces: leave nothing armed even if a step above returned early.
  await hookAction({ action: "disarmHookPromoteFault", connectionId: connId, repoId: REPO }).catch(() => {});
  console.log(`\nRESULT — ${passes} pass, ${fails} fail, ${unproven} not verified`);
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
const PHASE = process.argv[2] || "window";
const ENTRY = { window: main, fault: faultPhase }[PHASE];
if (!ENTRY) { console.error(`phase must be one of: window, fault`); process.exit(2); }

ENTRY()
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
