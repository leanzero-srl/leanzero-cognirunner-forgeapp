/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */
/* ═══════════════════════════════════════════════════════════════════════════════
 * F-647 / F-648 LIVE — THE PERMISSIONS PICKER DISCRIMINATOR, ON REAL wolfaenpak DATA.
 *
 * WHY PLAYWRIGHT AND NOT THE HOOK. `searchUsers` is NOT on the dev hook's
 * `invokeResolver` allow-list (src/test-hook.js ALLOWED_KEYS), and this run is
 * READ-ONLY on src/ and must never deploy, so the resolver cannot be driven as a
 * chosen principal. The ONLY live path to it is the product's own Permissions tab,
 * which invokes it as the signed-in admin — which is also the surface the finding is
 * about. So: drive the UI, read what an admin actually sees, and confirm the stored
 * row with a KVS read through the hook.
 *
 * PII. Jira may return `emailAddress`. Every email is masked to `<initial>***@<domain>`
 * before it reaches the console or the evidence file — by hand, here, because
 * `lib/redact.mjs` is a SECRET redactor with no notion of PII (F-652).
 *
 * RESTORE. The roster is snapshotted in memory, the grant is removed through the same
 * UI, and the restore is proven by a byte compare of the KVS value.
 * ═══════════════════════════════════════════════════════════════════════════════ */
import fs from "node:fs";
import { loadEnv, requireEnv } from "../lib/env.mjs";
import { redactString } from "../lib/redact.mjs";

const env = loadEnv();
const HOOK_URL = env.TESTSTATE_URL;
const SECRET = requireEnv("HARNESS_SECRET");
const ADMIN = requireEnv("HARNESS_ADMIN_ACCOUNT_ID");
const arg = (n, d) => { const h = process.argv.slice(2).find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const TARGET = arg("editor", "557058:653160a5-6112-470d-baea-333ac760364e");
const BASE = "https://wolfaenpak.atlassian.net";
const APP = "36415848-6868-4697-9554-3c3ad87b8da9";
const ENV_ID = "989ecaa0-261b-406e-b444-78c01c0d7772";
const PROFILE = "/Users/mihaiperdum/Projects/forge-live-harness/.auth/profile";
const OUT = new URL("../results/perm-discriminator", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

/** PII mask: mihai@wolfaenpak.com -> m***@wolfaenpak.com. Applied to strings AND deeply. */
const EMAIL_RE = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const maskEmails = (s) => (typeof s === "string" ? s.replace(EMAIL_RE, (_m, a, d) => `${a}***@${d}`) : s);
function maskDeep(v, d = 0) {
  if (v === null || v === undefined || d > 12) return v;
  if (typeof v === "string") return maskEmails(redactString(v));
  if (typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map((x) => maskDeep(x, d + 1));
  const o = {};
  for (const [k, val] of Object.entries(v)) o[k] = maskDeep(val, d + 1);
  return o;
}
const J = (d) => JSON.stringify(maskDeep(d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passes = 0, fails = 0, unproven = 0;
const ev = { at: new Date().toISOString(), env: "dev", target: TARGET, checks: [] };
const PASS = (s, d) => { passes++; ev.checks.push({ v: "PASS", s: maskEmails(s), ...(d ? { d: maskDeep(d) } : {}) }); console.log(`  PASS  ${maskEmails(s)}${d ? " " + J(d) : ""}`); };
const FAIL = (s, d) => { fails++; ev.checks.push({ v: "FAIL", s: maskEmails(s), ...(d ? { d: maskDeep(d) } : {}) }); console.log(`  FAIL  ${maskEmails(s)}${d ? " " + J(d) : ""}`); };
const NV = (s, d) => { unproven++; ev.checks.push({ v: "N/V", s: maskEmails(s), ...(d ? { d: maskDeep(d) } : {}) }); console.log(`  N/V   ${maskEmails(s)}${d ? " " + J(d) : ""}`); };
const info = (s) => console.log(`        ${maskEmails(redactString(String(s)))}`);

const readRes = async (res) => { let t = ""; try { t = await res.text(); } catch { return { status: 0, json: null, text: "" }; } let j = null; try { j = JSON.parse(t); } catch {} return { status: res.status, json: j, text: t }; };
async function hook(body, method = "POST", qs = "") {
  return readRes(await fetch(HOOK_URL + qs, { method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + SECRET }, body: method === "POST" ? JSON.stringify(body) : undefined }));
}
const invoke = (functionKey, payload = {}, accountId = ADMIN) => hook({ action: "invokeResolver", functionKey, payload, accountId });
const kvs = async (key) => (await hook(null, "GET", `?what=kvs&key=${encodeURIComponent(key)}`)).json;
const rosterRaw = async () => (await kvs("app_admins"))?.value || [];
const rosterIds = async () => (await rosterRaw()).map((r) => (typeof r === "string" ? r : r.accountId));
const seg = (id) => (id && id.lastIndexOf(":") >= 0 ? id.slice(id.lastIndexOf(":") + 1) : id);

async function withAdminPanel(fn) {
  const { chromium } = await import("../../static/_screenshot-harness/node_modules/playwright/index.mjs");
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true, viewport: { width: 1500, height: 1300 } });
  try {
    const page = ctx.pages()[0] || (await ctx.newPage());
    await page.goto(`${BASE}/jira/apps/${APP}/${ENV_ID}`, { waitUntil: "domcontentloaded" });
    let frame = null;
    for (let i = 0; i < 90; i++) {
      frame = page.frames().find((f) => f.url().includes("cdn.prod.atlassian-dev.net"));
      if (frame && (await frame.locator(".tab-btn").count()) > 0) break;
      await sleep(1000);
    }
    if (!frame) throw new Error("the admin panel iframe never appeared - is the persistent profile still signed in?");
    return await fn(page, frame);
  } finally { await ctx.close(); }
}

/** Read the search rows for `q`, row by row: name, email span, id chip, both titles. */
async function readSearchRows(q, shot) {
  return withAdminPanel(async (page, frame) => {
    await frame.locator(".tab-btn", { hasText: /^\s*Permissions\s*$/ }).click();
    await frame.locator(".perm-search-input").waitFor({ state: "visible", timeout: 60000 });
    await frame.locator(".perm-search-input").fill(q);
    await sleep(5000);
    const rows = frame.locator(".perm-search-item");
    const n = await rows.count();
    const out = [];
    for (let i = 0; i < n; i++) {
      const r = rows.nth(i);
      const emailEl = r.locator(".perm-ident-email");
      const idEl = r.locator(".perm-ident-id");
      out.push({
        i,
        disabled: ((await r.getAttribute("class")) || "").includes("perm-search-disabled"),
        name: ((await r.locator(".perm-search-name, .perm-user-name").first().innerText().catch(() => "")) || (await r.innerText()).split("\n")[0] || "").trim(),
        emailShown: (await emailEl.count()) > 0 ? (await emailEl.first().innerText()).trim() : null,
        emailTitle: (await emailEl.count()) > 0 ? await emailEl.first().getAttribute("title") : null,
        idShown: (await idEl.count()) > 0 ? (await idEl.first().innerText()).trim() : null,
        idTitle: (await idEl.count()) > 0 ? await idEl.first().getAttribute("title") : null,
      });
    }
    const errBox = frame.locator(".perm-search-error");
    const err = (await errBox.count()) > 0 ? (await errBox.first().innerText()).trim() : null;
    await page.screenshot({ path: `${OUT}/${shot}` }).catch(() => {});
    return { rows: out, err };
  });
}

/** Read the roster cards the same way. */
async function readRosterCards(shot) {
  return withAdminPanel(async (page, frame) => {
    await frame.locator(".tab-btn", { hasText: /^\s*Permissions\s*$/ }).click();
    await frame.locator(".perm-admin-card").first().waitFor({ state: "visible", timeout: 60000 });
    await sleep(1500);
    const cards = frame.locator(".perm-admin-card");
    const n = await cards.count();
    const out = [];
    for (let i = 0; i < n; i++) {
      const c = cards.nth(i);
      const emailEl = c.locator(".perm-ident-email"), idEl = c.locator(".perm-ident-id");
      out.push({
        i,
        text: (await c.innerText()).replace(/\s+/g, " ").trim(),
        emailShown: (await emailEl.count()) > 0 ? (await emailEl.first().innerText()).trim() : null,
        emailTitle: (await emailEl.count()) > 0 ? await emailEl.first().getAttribute("title") : null,
        idShown: (await idEl.count()) > 0 ? (await idEl.first().innerText()).trim() : null,
        idTitle: (await idEl.count()) > 0 ? await idEl.first().getAttribute("title") : null,
      });
    }
    await page.screenshot({ path: `${OUT}/${shot}` }).catch(() => {});
    return out;
  });
}

/** Click the search row at index `i` after setting Editor / Own Rules. */
async function grantRow(i) {
  return withAdminPanel(async (page, frame) => {
    await frame.locator(".tab-btn", { hasText: /^\s*Permissions\s*$/ }).click();
    await frame.locator(".perm-search-input").waitFor({ state: "visible", timeout: 60000 });
    await frame.locator(".perm-search-wrap .dropdown").nth(0).click();
    await frame.locator(".dropdown-item-name", { hasText: /^Editor/ }).first().click();
    await sleep(500);
    await frame.locator(".perm-search-wrap .dropdown").nth(1).click();
    await frame.locator(".dropdown-item-name", { hasText: /^Own Rules/ }).first().click();
    await sleep(400);
    await frame.locator(".perm-search-input").fill("Mihai");
    await sleep(5000);
    const row = frame.locator(".perm-search-item").nth(i);
    const snap = {
      email: (await row.locator(".perm-ident-email").count()) > 0 ? (await row.locator(".perm-ident-email").first().innerText()).trim() : null,
      id: (await row.locator(".perm-ident-id").count()) > 0 ? (await row.locator(".perm-ident-id").first().innerText()).trim() : null,
      idTitle: (await row.locator(".perm-ident-id").count()) > 0 ? await row.locator(".perm-ident-id").first().getAttribute("title") : null,
    };
    await row.click();
    await sleep(4500);
    await page.screenshot({ path: `${OUT}/03-granted.png` }).catch(() => {});
    return snap;
  });
}

async function removeRosterIndex(i) {
  return withAdminPanel(async (page, frame) => {
    await frame.locator(".tab-btn", { hasText: /^\s*Permissions\s*$/ }).click();
    await frame.locator(".perm-admin-card").first().waitFor({ state: "visible", timeout: 60000 });
    await sleep(1500);
    const card = frame.locator(".perm-admin-card").nth(i);
    const text = (await card.innerText()).replace(/\s+/g, " ");
    await card.locator(".perm-remove-btn").click();
    await frame.locator(".cr-confirm").waitFor({ state: "visible", timeout: 15000 });
    await frame.locator(".cr-confirm-actions button", { hasText: /^\s*Remove\s*$/ }).first().click();
    await sleep(3500);
    await page.screenshot({ path: `${OUT}/05-restored.png` }).catch(() => {});
    return { index: i, card: text };
  });
}

async function main() {
  console.log("\nF-647 / F-648 - the Permissions picker discriminator, live on DEV\n");
  const ping = await hook(null, "GET");
  if (ping.status !== 200) throw new Error(`the hook is not reachable (GET -> ${ping.status})`);
  PASS("hook reachable on dev, secret accepted");

  const rosterBefore = await rosterRaw();
  const rosterBeforeBytes = JSON.stringify(rosterBefore);
  ev.rosterBefore = rosterBefore;               // masked at write time
  info(`roster snapshot held IN MEMORY: ${rosterBefore.length} row(s)`);

  /* ── ITEM 2 — the admin gate precedes everything, as a NON-ADMIN principal ── */
  console.log("\nSTEP A - F-648: is the admin gate still in front of searchUsers, live?");
  const nonAdmin = TARGET;
  const roleOf = async (a) => (await invoke("checkIsAdmin", {}, a)).json;
  const pre = await roleOf(nonAdmin);
  if (pre && pre.role === null) PASS("the probe account holds NO app role - a genuine non-admin principal", { role: pre.role });
  else FAIL("the probe account already holds a role - the non-admin arm is not genuine", { answer: J(pre) });
  const su = await invoke("searchUsers", { query: "Mihai" }, nonAdmin);
  ev.searchUsersHook = { status: su.status, body: maskEmails(su.text).slice(0, 300) };
  info(`searchUsers via hook (non-admin) -> ${su.status} ${maskEmails(su.text).slice(0, 200)}`);
  if (su.json && su.json.success === false && su.json.reason === "no-permission" && !(su.json.users || []).length) {
    PASS("F-648: the admin gate answers first - success:false, reason:'no-permission', no users", { reason: su.json.reason, needsRole: su.json.needsRole });
  } else if (su.status === 400 && /not allowlisted/.test(su.text)) {
    NV("F-648 admin-gate arm: `searchUsers` is NOT on the dev hook's invokeResolver allow-list, so no live call can choose a non-admin principal. Offline-proven only (scripts/search-users.test.mjs).", { hookAnswer: su.text.slice(0, 120) });
  } else {
    FAIL("F-648: the non-admin answer is neither the refusal nor the allow-list rejection", { status: su.status, body: maskEmails(su.text).slice(0, 200) });
  }
  NV("F-648 fail-CLOSED (429/5xx) arm: there is no hook lever that makes Jira's /user/search fail, and this run may not deploy one. Offline-proven only (search-users.test.mjs drives 403/429/500 + a thrown fetch through the mock).");

  /* ── ITEM 1 — the search rows, as an admin, through the real UI ─────────── */
  console.log("\nSTEP B - F-647: what does an admin actually SEE for the three namesakes?");
  const search = await readSearchRows("Mihai", "01-search-rows.png");
  ev.searchRows = search.rows;
  for (const r of search.rows) info(`row ${r.i}${r.disabled ? " (on roster)" : ""}: name="${r.name}" email=${r.emailShown ? maskEmails(r.emailShown) : "(absent)"} idChip=${r.idShown || "(absent)"} idTitle=${r.idTitle || "(absent)"}`);
  if (search.err) info(`search error box: "${search.err}"`);
  if (search.rows.length >= 2) PASS(`the picker returned ${search.rows.length} namesake rows for "Mihai" - the F-645 ambiguity is reproducible`, { rows: search.rows.length });
  else FAIL("fewer than two rows came back; the namesake case is not reproduced", { rows: search.rows.length });

  const withEmail = search.rows.filter((r) => r.emailShown);
  const withId = search.rows.filter((r) => r.idShown);
  ev.emailPresence = search.rows.map((r) => ({ i: r.i, hasEmail: !!r.emailShown, hasId: !!r.idShown }));
  if (withId.length === search.rows.length) PASS("EVERY search row carries the account-id chip - the cross-surface key is unconditional", { rows: withId.length });
  else FAIL("a search row has NO id chip - F-647's 'always' is not held", { withId: withId.length, of: search.rows.length });
  for (const r of search.rows) {
    if (r.idShown && r.idTitle && r.idTitle.endsWith(r.idShown) && r.idTitle.includes(":"))
      PASS(`row ${r.i}: the id chip shows the last segment and its title carries the FULL id`, { chip: r.idShown, titleTail: r.idTitle.slice(-12) });
    else FAIL(`row ${r.i}: the id chip / title pair is not the documented shape`, { chip: r.idShown, title: r.idTitle });
  }
  if (withEmail.length === 0) {
    NV("F-647 EMAIL branch: Jira returned NO emailAddress for any of the namesake rows on this site (GDPR/profile visibility), so the email discriminator cannot be exercised live here. The id-segment fallback is what an admin sees, and it is confirmed above.", { rows: search.rows.length });
  } else {
    PASS(`Jira DOES return emailAddress: ${withEmail.length}/${search.rows.length} rows render an email`, { rowsWithEmail: withEmail.map((r) => ({ i: r.i, email: maskEmails(r.emailShown) })) });
    for (const r of withEmail) {
      if (r.idShown) PASS(`row ${r.i}: email AND id chip are shown together - the F-647 suppression is gone`, { email: maskEmails(r.emailShown), chip: r.idShown });
      else FAIL(`row ${r.i}: an email row SUPPRESSES the id chip - F-647 is live`, { email: maskEmails(r.emailShown) });
    }
  }

  /* ── the grant, the roster card, the stored row ─────────────────────────── */
  console.log("\nSTEP C - grant editor/own to the second account through the picker, and read all three surfaces back");
  let granted = false, clicked = null;
  try {
    const before = await rosterIds();
    const candidates = search.rows.filter((r) => !r.disabled);
    let idx = candidates.find((r) => r.idShown && seg(TARGET).startsWith(r.idShown.replace(/…|\.\.\./g, "")))?.i;
    if (idx === undefined) idx = candidates.find((r) => r.idTitle === TARGET)?.i;
    if (idx === undefined) { FAIL("no search row identifies the target account - the picker cannot be used to grant deliberately", { target: seg(TARGET) }); }
    else {
      PASS("the ROW FOR THE TARGET ACCOUNT IS IDENTIFIABLE FROM THE UI ALONE (id chip/title), which is exactly what F-645 said was impossible", { rowIndex: idx, chip: seg(TARGET).slice(0, 8) });
      clicked = await grantRow(idx);
      info(`clicked row ${idx}: email=${clicked.email ? maskEmails(clicked.email) : "(absent)"} idChip=${clicked.id}`);
      const after = await rosterRaw();
      const added = after.filter((r) => !before.includes(typeof r === "string" ? r : r.accountId));
      ev.added = added;
      const row = after.find((r) => (typeof r === "string" ? r : r.accountId) === TARGET);
      granted = Boolean(row);
      if (row && row.role === "editor" && row.scope === "own")
        PASS("the grant landed on THE INTENDED ACCOUNT as {editor, own} (KVS read of app_admins)", { accountId: seg(TARGET), role: row.role, scope: row.scope });
      else FAIL("the grant did not land on the intended account", { added: J(added) });

      if (row) {
        if (row.emailAddress) PASS("app_admins stored `emailAddress` on the roster row - the roster can repeat what the admin clicked", { emailAddress: maskEmails(row.emailAddress) });
        else if (clicked.email) FAIL("the search row showed an email but app_admins stored NONE - the two namespaces are still split", { clickedEmail: maskEmails(clicked.email) });
        else NV("app_admins stored no `emailAddress` because Jira never returned one for this account - nothing to persist", { accountId: seg(TARGET) });
      }

      const cards = await readRosterCards("04-roster-card.png");
      ev.rosterCards = cards;
      for (const c of cards) info(`card ${c.i}: email=${c.emailShown ? maskEmails(c.emailShown) : "(absent)"} idChip=${c.idShown || "(absent)"}`);
      const card = cards.find((c) => c.idTitle === TARGET || (c.idShown && seg(TARGET).startsWith(c.idShown)));
      if (!card) FAIL("no roster card carries the granted account's id - the roster surface has no discriminator", { cards: cards.length });
      else {
        PASS("the roster CARD carries the same id segment as the search row that was clicked - the two surfaces match by eye", { chip: card.idShown, sameAsClicked: card.idShown === clicked.id });
        if (card.idTitle === TARGET) PASS("...and the card's id title is the FULL account id (no KVS read needed to recover it)", { titleTail: card.idTitle.slice(-12) });
        else FAIL("the card's id title is not the full account id", { title: card.idTitle });
        if (clicked.email) {
          if (card.emailShown && card.emailShown === clicked.email) PASS("the roster card repeats the SAME email the admin clicked", { email: maskEmails(card.emailShown) });
          else FAIL("the roster card does not repeat the clicked email - F-647 verbatim", { clicked: maskEmails(clicked.email), card: card.emailShown ? maskEmails(card.emailShown) : null });
        } else {
          NV("the email half of the roster card cannot be checked: no email was available on the search row either", {});
        }
      }
    }
  } finally {
    console.log("\nRESTORE");
    if (granted) {
      const i = (await rosterIds()).indexOf(TARGET);
      if (i >= 0) { const r = await removeRosterIndex(i); info(`removed roster card #${i} (${maskEmails(r.card)})`); }
      else info("the granted row is already gone");
    }
    const end = await rosterRaw();
    ev.rosterAfter = end;
    if (JSON.stringify(end) === rosterBeforeBytes) PASS("SECOND READ: app_admins is BYTE-IDENTICAL to the in-memory snapshot taken before this run", { rows: end.length });
    else FAIL("THE ROSTER IS NOT RESTORED", { beforeRows: rosterBefore.length, nowRows: end.length, diff: J(end) });
    const endRole = (await invoke("checkIsAdmin", {}, TARGET)).json;
    if (endRole && endRole.role === null) PASS("...and checkIsAdmin reports the second account back to NO role (second read through the product)", { role: endRole.role });
    else FAIL("the second account still holds a role", { answer: J(endRole) });

    fs.writeFileSync(`${OUT}/evidence.json`, JSON.stringify(maskDeep(ev), null, 2));
    console.log(`\n${passes} pass, ${fails} fail, ${unproven} not verified. Evidence: ${OUT}/evidence.json`);
    if (fails > 0) process.exitCode = 1;
  }
}
await main();
