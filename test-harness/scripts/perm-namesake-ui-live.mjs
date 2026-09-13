/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */
/* ═══════════════════════════════════════════════════════════════════════════════
 * F-645 LIVE PROOF — "a display name is not an identity", on the three real
 * namesakes, through the product's own Permissions tab.
 *
 * WHAT IT PROVES, and why each step is there:
 *  1. searching "Mihai Perdum" returns THREE rows whose display name is identical and
 *     whose SECOND LINE differs per row (the account id's last segment on this build —
 *     `searchUsers` carries no emailAddress), with the FULL id in the row's `title`;
 *  2. clicking the row whose segment matches a chosen account grants the role to THAT
 *     account — proven by diffing `app_admins` in KVS, not by reading the UI;
 *  3. the roster card that appears carries the SAME segment (the cross-surface link
 *     F-647 says is missing when an email exists — here both surfaces are id-kind);
 *  4. removing that card restores `app_admins` BYTE-IDENTICALLY to the snapshot.
 *
 * READ-ONLY on src/ and static/. No deploy. No token, URL or secret is ever printed.
 * ═══════════════════════════════════════════════════════════════════════════════ */
import fs from "node:fs";
import { loadEnv, requireEnv } from "../lib/env.mjs";

const env = loadEnv();
const arg = (n, d) => { const h = process.argv.slice(2).find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const ENV_NAME = arg("env", "dev");
const HOOK_URL = ENV_NAME === "dev" ? env.TESTSTATE_URL : env.STAGING_TESTSTATE_URL;
const SECRET = requireEnv("HARNESS_SECRET");
const TARGET = arg("target", "557058:653160a5-6112-470d-baea-333ac760364e");
const NAME = arg("name", "Mihai Perdum");
const BASE = "https://wolfaenpak.atlassian.net";
const APP = "36415848-6868-4697-9554-3c3ad87b8da9";
const ENV_ID = arg("envid", "989ecaa0-261b-406e-b444-78c01c0d7772");
const PROFILE = "/Users/mihaiperdum/Projects/forge-live-harness/.auth/profile";
const OUT = new URL("../results/perm-namesake-ui", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const seg = (id) => (id.lastIndexOf(":") >= 0 ? id.slice(id.lastIndexOf(":") + 1) : id);
const TARGET_SEG = seg(TARGET);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passes = 0, fails = 0, unproven = 0;
const ev = { at: new Date().toISOString(), env: ENV_NAME, target: TARGET, checks: [] };
const PASS = (s, d) => { passes++; ev.checks.push({ v: "PASS", s, ...(d ? { d } : {}) }); console.log(`  PASS  ${s}${d ? " " + JSON.stringify(d) : ""}`); };
const FAIL = (s, d) => { fails++; ev.checks.push({ v: "FAIL", s, ...(d ? { d } : {}) }); console.log(`  FAIL  ${s}${d ? " " + JSON.stringify(d) : ""}`); };
const NV = (s, d) => { unproven++; ev.checks.push({ v: "N/V", s, ...(d ? { d } : {}) }); console.log(`  N/V   ${s}${d ? " " + JSON.stringify(d) : ""}`); };
const info = (s) => console.log(`        ${s}`);

async function hook(body, method = "POST", qs = "") {
  if (!HOOK_URL) throw new Error(`no web-trigger URL for environment "${ENV_NAME}"`);
  const res = await fetch(HOOK_URL + qs, {
    method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + SECRET },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
  let text = ""; try { text = await res.text(); } catch { /* */ }
  let json = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, text };
}
const roster = async () => (await hook(null, "GET", "?what=kvs&key=app_admins")).json?.value || [];

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
    if (!frame) throw new Error("the admin panel iframe never appeared — is the persistent profile still signed in?");
    await frame.locator(".tab-btn", { hasText: /^\s*Permissions\s*$/ }).click();
    return await fn(page, frame);
  } finally { await ctx.close(); }
}

/** Read the three search rows without clicking anything. */
async function readSearchRows(shot) {
  return withAdminPanel(async (page, frame) => {
    await frame.locator(".perm-search-input").waitFor({ state: "visible", timeout: 60000 });
    await frame.locator(".perm-search-input").fill(NAME);
    await sleep(5000);
    const rows = frame.locator(".perm-search-item");
    const n = await rows.count();
    const out = [];
    for (let i = 0; i < n; i++) {
      const r = rows.nth(i);
      const name = (await r.locator(".perm-search-name").innerText().catch(() => "")).trim();
      const identLoc = r.locator(".perm-ident");
      const hasIdent = (await identLoc.count()) > 0;
      out.push({
        i,
        name,
        ident: hasIdent ? (await identLoc.first().innerText()).trim() : null,
        identTitle: hasIdent ? await identLoc.first().getAttribute("title") : null,
        identClass: hasIdent ? await identLoc.first().getAttribute("class") : null,
        cls: (await r.getAttribute("class")) || "",
      });
    }
    if (shot) await page.screenshot({ path: `${OUT}/${shot}`, fullPage: false }).catch(() => {});
    return out;
  });
}

async function clickRowBySegment(segment, role = "Editor", scope = /^Own Rules/) {
  return withAdminPanel(async (page, frame) => {
    await frame.locator(".perm-search-input").waitFor({ state: "visible", timeout: 60000 });
    const roleSel = frame.locator(".perm-search-wrap .dropdown");
    await roleSel.nth(0).click();
    await frame.locator(".dropdown-item-name", { hasText: new RegExp("^" + role) }).first().click();
    await sleep(500);
    await frame.locator(".perm-search-wrap .dropdown").nth(1).click();
    await frame.locator(".dropdown-item-name", { hasText: scope }).first().click();
    await sleep(400);
    await frame.locator(".perm-search-input").fill(NAME);
    await sleep(5000);
    const rows = frame.locator(".perm-search-item");
    const n = await rows.count();
    for (let i = 0; i < n; i++) {
      const r = rows.nth(i);
      const ident = (await r.locator(".perm-ident").first().innerText().catch(() => "")).trim();
      if (ident !== segment) continue;
      if (((await r.getAttribute("class")) || "").includes("perm-search-disabled")) return { clicked: false, why: "already on roster" };
      await r.click();
      await sleep(5000);
      await page.screenshot({ path: `${OUT}/02-granted-roster.png` }).catch(() => {});
      return { clicked: true, index: i, ident };
    }
    return { clicked: false, why: `no search row carried segment ${segment}`, rows: n };
  });
}

/** Every roster card, with its discriminator. */
async function readRosterCards(shot) {
  return withAdminPanel(async (page, frame) => {
    await frame.locator(".perm-admin-card").first().waitFor({ state: "visible", timeout: 60000 });
    await sleep(1500);
    const cards = frame.locator(".perm-admin-card");
    const n = await cards.count();
    const out = [];
    for (let i = 0; i < n; i++) {
      const c = cards.nth(i);
      const identLoc = c.locator(".perm-ident");
      const hasIdent = (await identLoc.count()) > 0;
      out.push({
        i,
        name: (await c.locator(".perm-admin-name").innerText().catch(() => "")).trim(),
        role: (await c.locator(".perm-admin-role").innerText().catch(() => "")).trim(),
        ident: hasIdent ? (await identLoc.first().innerText()).trim() : null,
        identTitle: hasIdent ? await identLoc.first().getAttribute("title") : null,
      });
    }
    if (shot) await page.screenshot({ path: `${OUT}/${shot}` }).catch(() => {});
    return out;
  });
}

async function removeRosterBySegment(segment) {
  return withAdminPanel(async (page, frame) => {
    await frame.locator(".perm-admin-card").first().waitFor({ state: "visible", timeout: 60000 });
    await sleep(1500);
    const cards = frame.locator(".perm-admin-card");
    const n = await cards.count();
    for (let i = 0; i < n; i++) {
      const c = cards.nth(i);
      const ident = (await c.locator(".perm-ident").first().innerText().catch(() => "")).trim();
      if (ident !== segment) continue;
      await c.locator(".perm-remove-btn").click();
      await frame.locator(".cr-confirm").waitFor({ state: "visible", timeout: 15000 });
      await frame.locator(".cr-confirm-actions button", { hasText: /^\s*Remove\s*$/ }).first().click();
      await sleep(4000);
      await page.screenshot({ path: `${OUT}/04-roster-restored.png` }).catch(() => {});
      return { removed: true, index: i };
    }
    return { removed: false, cards: n };
  });
}

async function main() {
  console.log(`\nF-645 — the Permissions tab names the ACCOUNT, live on ${ENV_NAME.toUpperCase()}\n`);
  const ping = await hook(null, "GET");
  if (ping.status !== 200) throw new Error(`the hook is not reachable on ${ENV_NAME} (GET -> ${ping.status})`);
  PASS(`hook reachable on ${ENV_NAME}, secret accepted`);

  /* ── STEP 0 — snapshot, and prove the target is NOT already on it ──────────── */
  const before = await roster();
  const beforeJson = JSON.stringify(before);
  fs.writeFileSync(`${OUT}/roster-before.json`, JSON.stringify(before, null, 2));
  ev.rosterBefore = before;
  info(`roster snapshot: ${before.length} row(s) -> ${OUT}/roster-before.json`);
  const beforeIds = before.map((r) => (typeof r === "string" ? r : r.accountId));
  if (beforeIds.includes(TARGET)) { FAIL("the target account is ALREADY on the roster — the grant below would prove nothing"); }
  else PASS("the target account holds NO app role before the run (the grant is a real state change)", { targetSegment: TARGET_SEG });

  let restored = false;
  try {
    /* ── STEP 1 — the three namesake search rows ───────────────────────────── */
    const rows = await readSearchRows("01-search-three-namesakes.png");
    ev.searchRows = rows;
    fs.writeFileSync(`${OUT}/search-rows.json`, JSON.stringify(rows, null, 2));
    const named = rows.filter((r) => r.name === NAME);
    if (named.length >= 3) PASS(`the search for "${NAME}" returns ${named.length} rows with an IDENTICAL display name`, { rows: rows.length });
    else FAIL(`expected >=3 namesake rows, got ${named.length} — the F-645 scenario is not reproduced on this site`, { rows });

    const idents = named.map((r) => r.ident);
    if (idents.every((t) => typeof t === "string" && t.length > 0)) PASS("every namesake row carries a SECOND LINE (the discriminator)", { idents });
    else FAIL("a namesake row carries NO discriminator", { idents });
    if (new Set(idents).size === idents.length) PASS("the discriminators are DISTINCT — the three rows are told apart by the UI alone", { idents });
    else FAIL("two namesake rows carry the SAME discriminator", { idents });

    const idKind = named.every((r) => (r.identClass || "").includes("perm-ident-id"));
    if (idKind) PASS("the discriminator is the ACCOUNT-ID kind on this build (searchUsers carries no emailAddress) — F-647's email branch is dormant here, so nothing is suppressed");
    else NV("a row rendered a NON-id discriminator — F-647's email/id namespace split may be live; inspect search-rows.json", { named });

    const titlesOk = named.every((r) => typeof r.identTitle === "string" && r.identTitle.includes(":") && r.identTitle.endsWith(r.ident));
    if (titlesOk) PASS("each row's `title` carries the FULL account id, of which the visible chip is the tail", { titles: named.map((r) => r.identTitle) });
    else FAIL("a row's `title` does not carry the full account id", { named });

    const targetRow = named.find((r) => r.ident === TARGET_SEG);
    if (targetRow && targetRow.identTitle === TARGET) PASS("the target account is IDENTIFIABLE among the namesakes from the UI alone", { index: targetRow.i, ident: targetRow.ident });
    else { FAIL("the target account could not be identified among the search rows", { targetSeg: TARGET_SEG, named }); throw new Error("cannot identify target — refusing to click anything"); }

    /* ── STEP 2 — grant, and prove the RIGHT account got it (KVS diff) ─────── */
    const click = await clickRowBySegment(TARGET_SEG);
    ev.click = click;
    if (!click.clicked) { FAIL("the target row could not be clicked", click); throw new Error("no grant"); }
    const after = await roster();
    ev.rosterAfter = after;
    fs.writeFileSync(`${OUT}/roster-after-grant.json`, JSON.stringify(after, null, 2));
    const afterIds = after.map((r) => (typeof r === "string" ? r : r.accountId));
    const added = afterIds.filter((id) => !beforeIds.includes(id));
    const removedIds = beforeIds.filter((id) => !afterIds.includes(id));
    if (added.length === 1 && added[0] === TARGET) PASS("SECOND READ (KVS `app_admins`): the account added is EXACTLY the one whose segment was clicked", { added });
    else FAIL("the grant landed on a DIFFERENT account than the row clicked — F-645 is NOT fixed", { added, clickedSegment: TARGET_SEG });
    if (removedIds.length === 0) PASS("no pre-existing roster row was disturbed by the grant");
    else FAIL("the grant removed a pre-existing roster row", { removedIds });
    const row = after.find((r) => (typeof r === "string" ? r : r.accountId) === TARGET);
    if (row && row.role === "editor") PASS("the granted row carries role 'editor'", { role: row.role, scope: row.scope });
    else FAIL("the granted row does not carry role 'editor'", { row });

    /* ── STEP 3 — the roster card names the SAME account ───────────────────── */
    const cards = await readRosterCards("03-roster-card.png");
    ev.rosterCards = cards;
    fs.writeFileSync(`${OUT}/roster-cards.json`, JSON.stringify(cards, null, 2));
    const targetCards = cards.filter((c) => c.ident === TARGET_SEG);
    if (targetCards.length === 1) PASS("CROSS-SURFACE: the roster card shows the SAME segment the search row did", { card: targetCards[0] });
    else FAIL("the roster does not carry exactly one card with the clicked segment", { targetSeg: TARGET_SEG, cards });
    if (targetCards[0] && targetCards[0].identTitle === TARGET) PASS("the roster card's `title` carries the full account id", { title: targetCards[0].identTitle });
    else FAIL("the roster card's `title` does not carry the full account id", { card: targetCards[0] });
    const cardIdents = cards.map((c) => c.ident);
    if (new Set(cardIdents).size === cardIdents.length) PASS("every roster card carries a distinct discriminator", { cardIdents });
    else FAIL("two roster cards are indistinguishable", { cardIdents });

    /* ── STEP 4 — remove BY SEGMENT, restore byte-identically ──────────────── */
    const rm = await removeRosterBySegment(TARGET_SEG);
    ev.remove = rm;
    if (rm.removed) PASS("the card was located and removed by its DISCRIMINATOR, not by position", rm);
    else FAIL("the card could not be located by discriminator for removal", rm);
    const end = await roster();
    fs.writeFileSync(`${OUT}/roster-after-restore.json`, JSON.stringify(end, null, 2));
    ev.rosterEnd = end;
    if (JSON.stringify(end) === beforeJson) { restored = true; PASS("SECOND READ: `app_admins` is BYTE-IDENTICAL to the snapshot — the roster is restored", { rows: end.length }); }
    else FAIL("the roster did NOT return to its snapshot", { before, end });
  } catch (e) {
    FAIL("the run aborted", { error: String(e && e.message || e) });
  } finally {
    if (!restored) {
      const end = await roster();
      if (JSON.stringify(end) !== beforeJson) {
        info("ROSTER NOT RESTORED — attempting a final removal by segment");
        await removeRosterBySegment(TARGET_SEG).catch(() => {});
        const end2 = await roster();
        fs.writeFileSync(`${OUT}/roster-after-restore.json`, JSON.stringify(end2, null, 2));
        if (JSON.stringify(end2) === beforeJson) PASS("recovery: the roster is byte-identical to the snapshot");
        else FAIL("RECOVERY FAILED — the roster still differs from the snapshot", { end: end2 });
      }
    }
    ev.summary = { passes, fails, unproven };
    fs.writeFileSync(`${OUT}/evidence.json`, JSON.stringify(ev, null, 2));
    console.log(`\n  ${passes} PASS · ${fails} FAIL · ${unproven} N/V   -> ${OUT}/evidence.json\n`);
    process.exit(fails ? 1 : 0);
  }
}
main();
