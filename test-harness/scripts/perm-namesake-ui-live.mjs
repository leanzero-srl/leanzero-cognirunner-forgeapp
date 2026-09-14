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
 * READ-ONLY on src/ and static/. No deploy. No token, URL or secret is ever printed —
 * and since F-652, no EMAIL ADDRESS either: every roster row this driver touches goes
 * through `lib/redact.mjs` before it reaches a terminal or a file, because that header
 * sentence was a promise the code did not keep (F-646 is what a promise like it costs).
 * ═══════════════════════════════════════════════════════════════════════════════ */
import fs from "node:fs";
import { loadEnv, requireEnv } from "../lib/env.mjs";
import { redactSecrets, redactString } from "../lib/redact.mjs";
/* F-660 — the evidence JSON beside these captures is masked; the CAPTURES were not, and
   a full-page shot of the Permissions tab renders real addresses as PIXELS that no text
   redactor can see. Every capture goes through `shotMasked`, which masks every
   `.perm-ident-email`, asserts nothing readable is left, shoots, and restores. */
import { makeShot } from "../lib/roster-ui.mjs";
/* F-657 — the ROW is chosen by `selectByDiscriminator`, which matches the FULL account id
   in the `.perm-ident-id` title, falls back to the visible segment only when it is unique,
   and refuses on a duplicate or a miss. Never `.perm-ident` `.first()`: that class is the
   BASE class on the email span too, so on a row carrying an address `.first()` is the
   address, and the segment comparison could only ever fail. */
import { selectByDiscriminator } from "../lib/roster-restore.mjs";

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
/* F-646/F-652 — this driver reads `app_admins`, which carries real `emailAddress`
   values since F-647, and it wrote every roster row to four files and to stdout with
   no redaction at all. EVERY payload now passes `redactSecrets` ONCE, here, before
   the console line and before it is pushed into `ev`; the raw rows survive only in
   memory, where the byte-identical restore diff needs them. */
const PASS = (s, d) => { const r = d ? redactSecrets(d) : d; passes++; ev.checks.push({ v: "PASS", s, ...(d ? { d: r } : {}) }); console.log(`  PASS  ${s}${d ? " " + JSON.stringify(r) : ""}`); };
const FAIL = (s, d) => { const r = d ? redactSecrets(d) : d; fails++; ev.checks.push({ v: "FAIL", s, ...(d ? { d: r } : {}) }); console.log(`  FAIL  ${s}${d ? " " + JSON.stringify(r) : ""}`); };
const NV = (s, d) => { const r = d ? redactSecrets(d) : d; unproven++; ev.checks.push({ v: "N/V", s, ...(d ? { d: r } : {}) }); console.log(`  N/V   ${s}${d ? " " + JSON.stringify(r) : ""}`); };

/* F-668 — THE CAPTURE'S ANSWER IS RECORDED, NEVER DISCARDED. Every call site here used
 * to waive the strict flag AND swallow the returned promise, so the branch that REFUSES a
 * leaking capture never ran, and the `{captured:false, reason}` answer had no reader: a
 * missing PNG was a silent hole in a green run. `makeShot` binds this driver's N/V writer
 * once. Strict is the default again — a readable address ABORTS rather than reaching disk
 * — and a capture that did not happen now says so, with its reason, in the evidence.
 * `scripts/evidence-redaction.test.mjs` keeps both halves true for the whole directory.
 *
 * F-681 — AND THE CAPTURE THAT SUCCEEDED IS RECORDED TOO. F-668 gave the FAILED capture a
 * reader; the successful one still had none, and the successful one is the case that
 * carries the proof — its `{total, masked, readable}` IS the F-660 DOM assertion, the only
 * evidence that the addresses on that page were masked before the shutter. Measured on dev
 * 381199f: 13 PNGs, 3 shot records, and the one capture that had a real address to mask
 * recorded nothing at all. So this binding takes all three writers: a capture that happened
 * is a PASS with its numbers, a capture that did not is an N/V with its reason, and a
 * capture REFUSED for a readable address is a FAIL — never a sentence in an actions array. */
const shot_ = makeShot({ pass: PASS, nv: NV, fail: FAIL });
const info = (s) => console.log(`        ${redactString(String(s))}`);

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
      /* F-657 — `.perm-ident` is the BASE class on BOTH the email span and the id chip, so
         `.first()` is the ADDRESS on any row that carries one, and every comparison below
         against an id segment would silently fail. The DISCRIMINATOR is `.perm-ident-id`;
         `.perm-ident` is read only to report whether anything else is rendered beside it. */
      const idLoc = r.locator(".perm-ident-id");
      const hasId = (await idLoc.count()) > 0;
      const anyIdent = r.locator(".perm-ident");
      out.push({
        i,
        name,
        ident: hasId ? (await idLoc.first().innerText()).trim() : null,
        identTitle: hasId ? await idLoc.first().getAttribute("title") : null,
        identClass: hasId ? await idLoc.first().getAttribute("class") : null,
        identSpans: await anyIdent.count(),
        cls: (await r.getAttribute("class")) || "",
      });
    }
    if (shot) await shot_(page, frame, `${OUT}/${shot}`);
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
    /* F-657 — READ AND SELECT IN THIS CONTEXT, THROUGH `selectByDiscriminator`.
       The read/click were already in one context here, which is why this driver never
       produced the F-654 damage — but the match was `.perm-ident` `.first()`, and
       `.perm-ident` is the BASE class on BOTH the email span and the id chip
       (PermissionsTab.jsx renders `perm-ident perm-ident-email` and
       `perm-ident perm-ident-id`). On a row that carries an email, `.first()` is the
       ADDRESS, so the comparison against an id segment could only ever fail — and there
       was no uniqueness guard, so the first match won. The selection now reads
       `.perm-ident-id` specifically, prefers the FULL id in the title, and refuses on a
       duplicate or a miss instead of taking a neighbour. */
    const rows = frame.locator(".perm-search-item");
    const n = await rows.count();
    const read = [];
    for (let i = 0; i < n; i++) {
      const r = rows.nth(i);
      const idEl = r.locator(".perm-ident-id");
      const hasId = (await idEl.count()) > 0;
      read.push({
        i,
        disabled: ((await r.getAttribute("class")) || "").includes("perm-search-disabled"),
        idShown: hasId ? (await idEl.first().innerText()).trim() : null,
        idTitle: hasId ? await idEl.first().getAttribute("title") : null,
      });
    }
    const pick = selectByDiscriminator(read, TARGET);
    if (pick.index < 0) {
      if (pick.disabledHit) return { clicked: false, why: "already on roster", reason: pick.reason };
      return { clicked: false, why: pick.reason, rows: n, ambiguous: !!pick.ambiguous };
    }
    /* THE LAST READ BEFORE THE CLICK: the row's FULL id, off the live DOM. A re-render
       between the read above and this click cannot move the grant onto a namesake. */
    const target = rows.nth(pick.index);
    const confirm = await target.locator(".perm-ident-id").first().getAttribute("title").catch(() => null);
    const confirmShown = (await target.locator(".perm-ident-id").first().innerText().catch(() => "")).trim();
    if (!(confirm === TARGET || (confirm === null && confirmShown === segment))) {
      return { clicked: false, raced: true, why: `the row at index ${pick.index} no longer carries the target id when re-read immediately before the click (chip: ${confirmShown || "absent"}) — refusing to click` };
    }
    await target.click();
    await sleep(5000);
    await shot_(page, frame, `${OUT}/02-granted-roster.png`);
    return { clicked: true, index: pick.index, how: pick.how, ident: confirmShown };
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
      /* F-657 — the DISCRIMINATOR is `.perm-ident-id`, never `.perm-ident` `.first()`,
         which is the email span on a card that carries an address. */
      const identLoc = c.locator(".perm-ident-id");
      const hasIdent = (await identLoc.count()) > 0;
      out.push({
        i,
        name: (await c.locator(".perm-admin-name").innerText().catch(() => "")).trim(),
        role: (await c.locator(".perm-admin-role").innerText().catch(() => "")).trim(),
        ident: hasIdent ? (await identLoc.first().innerText()).trim() : null,
        identTitle: hasIdent ? await identLoc.first().getAttribute("title") : null,
      });
    }
    if (shot) await shot_(page, frame, `${OUT}/${shot}`);
    return out;
  });
}

async function removeRosterBySegment(segment) {
  return withAdminPanel(async (page, frame) => {
    await frame.locator(".perm-admin-card").first().waitFor({ state: "visible", timeout: 60000 });
    await sleep(1500);
    /* F-657 — same discriminator, same refusal. `.perm-ident` `.first()` is the EMAIL span
       on a card that carries one; the id chip is `.perm-ident-id`. A REMOVE opts into
       disabled rows, because the roster card is the on-roster row by definition. */
    const cards = frame.locator(".perm-admin-card");
    const n = await cards.count();
    const read = [];
    for (let i = 0; i < n; i++) {
      const c = cards.nth(i);
      const idEl = c.locator(".perm-ident-id");
      const hasId = (await idEl.count()) > 0;
      read.push({
        i,
        idShown: hasId ? (await idEl.first().innerText()).trim() : null,
        idTitle: hasId ? await idEl.first().getAttribute("title") : null,
      });
    }
    const pick = selectByDiscriminator(read, TARGET, { allowDisabled: true });
    if (pick.index >= 0) {
      const c = cards.nth(pick.index);
      await c.locator(".perm-remove-btn").click();
      await frame.locator(".cr-confirm").waitFor({ state: "visible", timeout: 15000 });
      await frame.locator(".cr-confirm-actions button", { hasText: /^\s*Remove\s*$/ }).first().click();
      await sleep(4000);
      await shot_(page, frame, `${OUT}/04-roster-restored.png`);
      return { removed: true, index: pick.index, how: pick.how };
    }
    return { removed: false, cards: n, reason: pick.reason };
  });
}

async function main() {
  console.log(`\nF-645 — the Permissions tab names the ACCOUNT, live on ${ENV_NAME.toUpperCase()}\n`);
  const ping = await hook(null, "GET");
  if (ping.status !== 200) throw new Error(`the hook is not reachable on ${ENV_NAME} (GET -> ${ping.status})`);
  PASS(`hook reachable on ${ENV_NAME}, secret accepted`);

  /* ── STEP 0 — snapshot, and prove the target is NOT already on it ──────────── */
  /* F-652 — `beforeJson` is the RAW snapshot and stays in memory: the restore check
     below is a BYTE-IDENTICAL comparison, and comparing redacted forms would call two
     different addresses equal because they share one mask. The disk copy is redacted. */
  const before = await roster();
  const beforeJson = JSON.stringify(before);
  fs.writeFileSync(`${OUT}/roster-before.json`, JSON.stringify(redactSecrets(before), null, 2));
  ev.rosterBefore = before;   // redacted at the file boundary below
  info(`roster snapshot: ${before.length} row(s) -> ${OUT}/roster-before.json`);
  const beforeIds = before.map((r) => (typeof r === "string" ? r : r.accountId));
  if (beforeIds.includes(TARGET)) { FAIL("the target account is ALREADY on the roster — the grant below would prove nothing"); }
  else PASS("the target account holds NO app role before the run (the grant is a real state change)", { targetSegment: TARGET_SEG });

  let restored = false;
  try {
    /* ── STEP 1 — the three namesake search rows ───────────────────────────── */
    const rows = await readSearchRows("01-search-three-namesakes.png");
    ev.searchRows = rows;
    fs.writeFileSync(`${OUT}/search-rows.json`, JSON.stringify(redactSecrets(rows), null, 2));
    const named = rows.filter((r) => r.name === NAME);
    /* F-681 — THE SENTENCE AND THE DETAIL COUNTED DIFFERENT THINGS. The sentence said
       "returns N rows with an IDENTICAL display name" (that is `named.length`) and the
       detail beside it read `{rows: rows.length}` — EVERY row the search returned, namesake
       or not. On a search that returns five rows of which three are namesakes, the line read
       "returns 3 rows … {rows: 5}" and contradicted itself. Both numbers are worth having;
       they just have to say which is which. */
    if (named.length >= 3) PASS(`the search for "${NAME}" returns ${named.length} row(s) with an IDENTICAL display name, out of ${rows.length} row(s) returned in total`, { namesakeRows: named.length, rowsReturned: rows.length });
    else FAIL(`expected >=3 namesake rows, got ${named.length} of ${rows.length} row(s) returned — the F-645 scenario is not reproduced on this site`, { namesakeRows: named.length, rowsReturned: rows.length, rows });

    const idents = named.map((r) => r.ident);
    if (idents.every((t) => typeof t === "string" && t.length > 0)) PASS("every namesake row carries a SECOND LINE (the discriminator)", { idents });
    else FAIL("a namesake row carries NO discriminator", { idents });
    if (new Set(idents).size === idents.length) PASS("the discriminators are DISTINCT — the three rows are told apart by the UI alone", { idents });
    else FAIL("two namesake rows carry the SAME discriminator", { idents });

    /* F-657 — this used to read `.perm-ident` `.first()` and check its CLASS, which on a
       row carrying an address is the email span, not the chip. The id chip is now read
       directly, so the question it asked ("is the id chip suppressed when an email is
       present?" — F-647) is answered by COUNTING the `.perm-ident` spans instead: an
       id-only row renders one, a row with both renders two, and the chip must be there
       either way. */
    const idKind = named.every((r) => (r.identClass || "").includes("perm-ident-id"));
    const withBoth = named.filter((r) => r.identSpans >= 2);
    if (!idKind) FAIL("a namesake row renders NO `.perm-ident-id` chip — F-647's 'always' is not held on this build", { named });
    else if (withBoth.length === 0) PASS("every namesake row carries the ACCOUNT-ID chip, and Jira returned no emailAddress on this site, so F-647's email branch is dormant here", { rows: named.length });
    else PASS("every namesake row carries the ACCOUNT-ID chip ALONGSIDE its email span — the F-647 suppression is gone", { rowsWithBoth: withBoth.length, of: named.length });

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
    fs.writeFileSync(`${OUT}/roster-after-grant.json`, JSON.stringify(redactSecrets(after), null, 2));
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
    fs.writeFileSync(`${OUT}/roster-cards.json`, JSON.stringify(redactSecrets(cards), null, 2));
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
    fs.writeFileSync(`${OUT}/roster-after-restore.json`, JSON.stringify(redactSecrets(end), null, 2));
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
        fs.writeFileSync(`${OUT}/roster-after-restore.json`, JSON.stringify(redactSecrets(end2), null, 2));
        if (JSON.stringify(end2) === beforeJson) PASS("recovery: the roster is byte-identical to the snapshot");
        else FAIL("RECOVERY FAILED — the roster still differs from the snapshot", { end: end2 });
      }
    }
    /* F-681 — THE CAPTURE RECORD IS PART OF THE EVIDENCE, NOT A SIDE EFFECT. Every shot
       this run took, with the numbers the mask actually measured, so "no PNG here is
       unmasked" is something a reader can READ off `evidence.json` instead of inferring it
       from the absence of a throw. And a leak fails the run in its own right — a recorded
       FAIL is already counted above, but the flag is asserted here too so that a future
       `.catch` around a capture cannot quietly restore the old silence. */
    ev.shots = shot_.shots;
    if (shot_.leaked) {
      FAIL("a screenshot capture was REFUSED because a readable email address survived the mask — the F-660 guarantee fired and this run FAILS on it regardless of the roster verdict", { leaks: shot_.leaks });
    }
    ev.summary = { passes, fails, unproven, shots: shot_.shots.length, captured: shot_.shots.filter((s) => s.captured).length, leaks: shot_.leaks.length };
    fs.writeFileSync(`${OUT}/evidence.json`, JSON.stringify(redactSecrets(ev), null, 2));
    console.log(`\n  ${passes} PASS · ${fails} FAIL · ${unproven} N/V   -> ${OUT}/evidence.json\n`);
    process.exit(fails ? 1 : 0);
  }
}
main();
