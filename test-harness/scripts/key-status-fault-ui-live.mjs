/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */
/* ═══════════════════════════════════════════════════════════════════════════════
 * F-629 / F-603 — THE FAILED KEY READ, IN THE ADMIN'S OWN BROWSER.
 *
 * WHY THIS SCRIPT EXISTS AT ALL. `key-status-fault-live.mjs` arms the lever and then
 * asks `getOpenAIKey` THROUGH THE DEV HOOK — and the hook's invokeResolver allow-list
 * does not carry `getOpenAIKey` (measured: `functionKey not allowlisted: getOpenAIKey`),
 * so its every check dies at STEP 0. The browser needs no allow-list: the admin panel
 * calls that resolver itself. So the lever is armed over the hook and the ANSWER is read
 * where F-603 actually lives — the Settings card.
 *
 * F-603: a failed `getOpenAIKey` used to leave the previous provider's key status
 * standing, so an admin who opened Settings on the MANAGED engine and then picked OpenAI
 * saw "Managed by LeanZero — ready, no key needed" for OpenAI, with NO key input at all.
 * The journey below is exactly that one, with the read faulted on purpose.
 *
 * NOTHING IS SAVED. Picking a provider in the dropdown VIEWS it (`handleSelectProvider`
 * never activates), so the active-provider slot is never written. The key slot is
 * fingerprinted (PRESENT/EMPTY — never the value, never its length) before and after.
 * The lever is TTL-bounded and disarmed in the `finally`, proven gone by a re-read.
 *
 * SHARED DEV TENANT (F-686). `--env` defaults to `staging`; `--env=dev` additionally needs
 * `--i-know-dev-is-shared` (lib/shared-env-guard.mjs — the one home of that refusal). The
 * arming TTL was 240s and is now 60s: this journey reads the card ONCE, and every extra
 * second is a second in which a real admin on that site reads the planted refusal as a bad
 * credential and rotates a working key.
 *
 *   node scripts/key-status-fault-ui-live.mjs [--env=staging|dev] [--i-know-dev-is-shared]
 *     [--provider=openai] [--label=OpenAI] [--envid=<forge env id>]
 * ═══════════════════════════════════════════════════════════════════════════════ */
import fs from "node:fs";
import { requireEnv } from "../lib/env.mjs";
// F-686 — one home for the shared-dev acknowledgement. This driver arms F-679's own lever
// AND drives the real admin page, so it is the last one that should have been without it.
import { requireEnvAck } from "../lib/shared-env-guard.mjs";
import { providerKeySlot } from "../../src/shared/provider-slots.js";

const arg = (n, d) => { const h = process.argv.slice(2).find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const PROVIDER = arg("provider", "openai");
/* F-686 — THE WINDOW IS MEASURED, NOT GUESSED. The journey is: launch the browser, open
 * Settings, pick the provider, READ THE CARD ONCE, screenshot. One page load and one read —
 * the lever is not held across a human's session. 240s was 48x the guarded sibling's window
 * for a journey that needs seconds, and every one of those seconds is a window in which a
 * real admin reads "Couldn't read key status" and rotates a good key. 60s covers a cold
 * iframe boot (the loop below waits up to 90s for the frame, and if it ever takes longer
 * than 60s the fault expires and the check FAILS LOUDLY rather than lingering armed). */
const ARM_TTL_SECONDS = 60;
const { envName: ENV_NAME, hookUrl: HOOK_URL } = requireEnvAck(process.argv.slice(2), {
  faults: [`keyRead:${PROVIDER}`],
  maxSeconds: ARM_TTL_SECONDS,
  script: "key-status-fault-ui-live.mjs",
});
const SECRET = requireEnv("HARNESS_SECRET");
const PROVIDER_LABEL = arg("label", "OpenAI");
const BASE = "https://wolfaenpak.atlassian.net";
const APP = "36415848-6868-4697-9554-3c3ad87b8da9";
const ENV_ID = arg("envid", ENV_ID_DEFAULT);
const PROFILE = "/Users/mihaiperdum/Projects/forge-live-harness/.auth/profile";
const OUT = new URL("../results/key-status-fault-ui", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passes = 0, fails = 0, unproven = 0;
const ev = { at: new Date().toISOString(), env: ENV_NAME, provider: PROVIDER, checks: [] };
const PASS = (s, d) => { passes++; ev.checks.push({ v: "PASS", s, ...(d ? { d } : {}) }); console.log(`  PASS  ${s}${d ? " " + JSON.stringify(d) : ""}`); };
const FAIL = (s, d) => { fails++; ev.checks.push({ v: "FAIL", s, ...(d ? { d } : {}) }); console.log(`  FAIL  ${s}${d ? " " + JSON.stringify(d) : ""}`); };
const NV = (s, d) => { unproven++; ev.checks.push({ v: "N/V", s, ...(d ? { d } : {}) }); console.log(`  N/V   ${s}${d ? " " + JSON.stringify(d) : ""}`); };
const info = (s) => console.log(`        ${s}`);

const readRes = async (res) => {
  let text = ""; try { text = await res.text(); } catch (e) { return { status: 0, json: null, raw: e.message }; }
  let json = null; try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, json, raw: json ? null : text.slice(0, 300) };
};
async function hook(body, method = "POST", qs = "") {
  if (!HOOK_URL) throw new Error(`no web-trigger URL for environment "${ENV_NAME}"`);
  return readRes(await fetch(HOOK_URL + qs, {
    method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + SECRET },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  }));
}
const keySlotFingerprint = async () => {
  const r = await hook(null, "GET", `?what=kvs&key=${encodeURIComponent(providerKeySlot(PROVIDER))}`);
  const v = r.json ? r.json.value : undefined;
  return v === null || v === undefined ? "EMPTY" : "PRESENT";
};
const arm = (mode, ttlSeconds = ARM_TTL_SECONDS) => hook({ action: "armKeyReadFault", provider: PROVIDER, mode, ttlSeconds });
const disarm = () => hook({ action: "disarmKeyReadFault", provider: PROVIDER });
const readLever = () => hook({ action: "readKeyReadFault", provider: PROVIDER });

/** Open Settings, pick a provider in the dropdown, and read the key-status card. */
async function readSettingsCard(pickLabel, shot) {
  const { chromium } = await import("../../static/_screenshot-harness/node_modules/playwright/index.mjs");
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true, viewport: { width: 1500, height: 1400 } });
  const consoleErrors = [];
  try {
    const page = ctx.pages()[0] || (await ctx.newPage());
    page.on("pageerror", (e) => consoleErrors.push(String(e.message).slice(0, 200)));
    await page.goto(`${BASE}/jira/apps/${APP}/${ENV_ID}`, { waitUntil: "domcontentloaded" });
    let frame = null;
    for (let i = 0; i < 90; i++) {
      frame = page.frames().find((f) => f.url().includes("cdn.prod.atlassian-dev.net"));
      if (frame && (await frame.locator(".tab-btn").count()) > 0) break;
      await sleep(1000);
    }
    if (!frame) return { error: "the admin panel iframe never appeared — is the persistent profile still signed in?" };
    await frame.locator(".tab-btn", { hasText: /^\s*Settings\s*$/ }).click();
    await frame.locator(".openai-status").first().waitFor({ state: "visible", timeout: 60000 });
    /* The state F-603 is about starts on the ACTIVE (managed) provider — read it first,
       so the "previous provider's values" the bug carried over are measured, not assumed. */
    const before = (await frame.locator(".openai-status").first().innerText()).replace(/\s+/g, " ").trim();
    if (pickLabel) {
      await frame.locator(".dropdown").first().click();
      await frame.locator(".dropdown-item-name", { hasText: new RegExp(`^${pickLabel}`) }).first().click();
      /* Wait for the card to stop being the PREVIOUS provider's card. The refresh veil
         is the app's own signal; the text changing is the honest one. */
      for (let i = 0; i < 40; i++) {
        const now = (await frame.locator(".openai-status").first().innerText()).replace(/\s+/g, " ").trim();
        if (now !== before) break;
        await sleep(750);
      }
      await sleep(2500);
    }
    const status = (await frame.locator(".openai-status").first().innerText()).replace(/\s+/g, " ").trim();
    const keyInputs = await frame.locator('input[type="password"], input[placeholder*="sk-"], input[placeholder*="key" i]').count();
    const cardBg = await frame.evaluate(() => {
      const el = document.querySelector(".card") || document.body;
      return getComputedStyle(el).backgroundColor;
    }).catch(() => null);
    if (shot) await page.screenshot({ path: `${OUT}/${shot}.png`, fullPage: false }).catch(() => {});
    return { before, status, keyInputs, cardBg, consoleErrors };
  } catch (e) {
    return { error: String((e && e.message) || e).slice(0, 300), consoleErrors };
  } finally { await ctx.close(); }
}

function assertFailedCard(tag, card) {
  if (card.error) { FAIL(`${tag}: the panel could not be read`, { error: card.error }); return; }
  info(`${tag} card: ${card.status.slice(0, 220)}`);
  if (/Couldn.t read key status/i.test(card.status)) PASS(`${tag}: the card SAYS the read failed ("Couldn't read key status")`);
  else FAIL(`${tag}: the failure sentence is absent`, { status: card.status.slice(0, 200) });
  if (/STATUS UNREAD/.test(card.status)) PASS(`${tag}: the solid STATUS UNREAD chip is rendered`);
  else FAIL(`${tag}: no STATUS UNREAD chip`, { status: card.status.slice(0, 200) });
  if (!/Managed by LeanZero/i.test(card.status)) PASS(`${tag}: it NEVER says "Managed by LeanZero" — the F-603 lie is gone`);
  else FAIL(`${tag}: the card still paints the managed engine's copy for ${PROVIDER}`, { status: card.status.slice(0, 200) });
  if (!/ready, no key needed|nothing to paste here/i.test(card.status)) PASS(`${tag}: no "ready, no key needed" / "nothing to paste here"`);
  else FAIL(`${tag}: a readiness sentence survived a failed read`, { status: card.status.slice(0, 200) });
  if (!/No key configured/i.test(card.status)) PASS(`${tag}: it does not CLAIM "No key configured" either — an unread status is not a measurement`);
  else FAIL(`${tag}: the card claims a measurement it never made`, { status: card.status.slice(0, 200) });
  if (card.keyInputs > 0) PASS(`${tag}: the API key input IS rendered — the admin can still configure the provider`, { inputs: card.keyInputs });
  else FAIL(`${tag}: no key input on the card`, { inputs: card.keyInputs });
  if ((card.consoleErrors || []).length === 0) PASS(`${tag}: no page errors`);
  else FAIL(`${tag}: the page threw`, { errors: card.consoleErrors.slice(0, 2) });
}

async function main() {
  console.log(`\nF-629 / F-603 — the failed key read in the admin's browser, on ${ENV_NAME.toUpperCase()}, provider ${PROVIDER}\n`);
  const ping = await hook(null, "GET");
  if (ping.status !== 200) throw new Error(`the hook is not reachable on ${ENV_NAME} (GET -> ${ping.status})`);
  PASS(`hook reachable on ${ENV_NAME}, secret accepted`);
  const slotBefore = await keySlotFingerprint();
  info(`the ${PROVIDER} key slot is ${slotBefore} before anything (fingerprint only)`);

  try {
    /* ── STEP 0 — the CONTROL: no lever, the same journey, a healthy card ──── */
    console.log("STEP 0 - no lever armed: the same dropdown journey paints a NORMAL card");
    const control = await readSettingsCard(PROVIDER_LABEL, "01-control");
    ev.control = control;
    if (control.error) { FAIL("the panel could not be opened", { error: control.error }); return; }
    info(`control card: ${control.status.slice(0, 200)}`);
    if (!/Couldn.t read key status|STATUS UNREAD/i.test(control.status)) {
      PASS("the control card carries NO failure copy - so anything below is this run's lever, not a broken tenant");
    } else { FAIL("the card is already in the failed state with nothing armed", { status: control.status.slice(0, 200) }); return; }
    const lever0 = await readLever();
    if (lever0.json && lever0.json.value === null) PASS("…and no key-read fault is armed for this provider");
    else FAIL("a key-read fault is already armed", { value: lever0.json && lever0.json.value });

    /* ── STEP 1 — mode:refuse — the {success:false} body F-603 is about ────── */
    console.log("\nSTEP 1 - mode:refuse - the failed read, from the MANAGED card, exactly F-603's journey");
    const armed = await arm("refuse");
    ev.armed = armed.json;
    if (armed.status === 200 && armed.json && armed.json.mode === "refuse") PASS("the refuse lever is armed", { ttlSeconds: armed.json.ttlSeconds, maxTtlSeconds: armed.json.maxTtlSeconds });
    else { FAIL("the lever would not arm", { status: armed.status, body: JSON.stringify(armed.json).slice(0, 300) }); return; }
    const refused = await readSettingsCard(PROVIDER_LABEL, "02-refuse");
    ev.refuse = refused;
    if (refused.before && /Managed by LeanZero|no key needed/i.test(refused.before)) {
      PASS("…and the card it started from WAS the managed one - the stale values F-603 carried over were really there to carry", { from: refused.before.slice(0, 90) });
    } else NV("the tab's active provider is not the managed engine right now, so the journey starts from a different card than F-603's report", { from: (refused.before || "").slice(0, 90) });
    assertFailedCard("refuse", refused);

    /* ── STEP 2 — mode:throw — the other arm, a REJECTED invoke ───────────── */
    console.log("\nSTEP 2 - mode:throw - the resolver REJECTS; the catch arm must paint the same card");
    const armed2 = await arm("throw");
    if (armed2.status === 200 && armed2.json && armed2.json.mode === "throw") PASS("the throw lever is armed", { ttlSeconds: armed2.json.ttlSeconds });
    else { FAIL("the throw lever would not arm", { body: JSON.stringify(armed2.json).slice(0, 300) }); return; }
    const thrown = await readSettingsCard(PROVIDER_LABEL, "03-throw");
    ev.throw = thrown;
    assertFailedCard("throw", thrown);
  } finally {
    console.log("\nRESTORE");
    const off = await disarm();
    const lever = await readLever();
    if (lever.json && lever.json.value === null) PASS("the key-read fault is DISARMED - the same read that saw it armed now sees nothing", { disarmed: !!(off.json && off.json.ok) });
    else FAIL("the fault is still armed", { value: lever.json && lever.json.value });
    const after = await readSettingsCard(PROVIDER_LABEL, "04-after");
    ev.after = after;
    if (after.error) NV("the restore DOM read could not open the panel", { error: after.error });
    else if (!/Couldn.t read key status|STATUS UNREAD/i.test(after.status)) {
      PASS("…and the card is healthy again in the browser - the same read that showed the failure now does not", { status: after.status.slice(0, 120) });
    } else FAIL("the card is still failing after the disarm", { status: after.status.slice(0, 200) });
    const slotAfter = await keySlotFingerprint();
    if (slotAfter === slotBefore) PASS(`the ${PROVIDER} key slot is unchanged (${slotBefore} -> ${slotAfter}) - the lever never went near a credential`);
    else FAIL("the key slot changed across this run", { before: slotBefore, after: slotAfter });
    fs.writeFileSync(OUT + "/evidence.json", JSON.stringify(ev, null, 2));
    console.log(`\n${passes} pass, ${fails} fail, ${unproven} not verified. Evidence: ${OUT}/evidence.json`);
  }
}

await main();
process.exit(fails === 0 ? 0 : 1);
