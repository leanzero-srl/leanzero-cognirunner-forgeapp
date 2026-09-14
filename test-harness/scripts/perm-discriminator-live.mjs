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
 * before it reaches the console or the evidence file, by `lib/redact.mjs` — which learned
 * PII in F-652 and is now the ONLY home of that rule (F-662: this file used to carry a
 * second, narrower one and ran it first).
 *
 * RESTORE. The roster is snapshotted in memory, the grant is removed through the same
 * UI, and the restore is proven by a byte compare of the KVS value.
 * ═══════════════════════════════════════════════════════════════════════════════ */
import fs from "node:fs";
import { loadEnv, requireEnv } from "../lib/env.mjs";
import { redactString, redactSecrets } from "../lib/redact.mjs";
/* F-660 — the evidence JSON beside these captures is masked; the CAPTURES were not, and a
   full-page shot of the Permissions tab renders real addresses as PIXELS that no text
   redactor can see — F-651 made the address fully legible on purpose. Every capture goes
   through `shotMasked`, which masks every `.perm-ident-email`, asserts nothing readable is
   left, shoots, and restores. The id chips stay legible: they are the discriminator these
   screenshots exist to prove. */
import { makeRosterUI, makeShot, maskPositiveControl } from "../lib/roster-ui.mjs";
import {
  rosterIdOf, idTail, selectByDiscriminator, planRosterRestore, rosterRestoreVerdict, describePlan,
} from "../lib/roster-restore.mjs";

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

/* F-662 — THERE IS NO LOCAL EMAIL MASK HERE ANY MORE.
 * This driver used to carry its own `EMAIL_RE` (no `'` in the local part, a laxer domain)
 * and ran it BEFORE `lib/redact.mjs`, so the two homes disagreed about what a mask IS and
 * the narrow one always won: `o'brien@tenant.com` came out as `o'b***@tenant.com`, which
 * the shared rule could no longer match because `*` is not a legal local-part character.
 * `redactString` / `redactSecrets` are now the ONLY answer, here and at the file boundary.
 */
const J = (d) => JSON.stringify(redactSecrets(d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passes = 0, fails = 0, unproven = 0;
const ev = { at: new Date().toISOString(), env: "dev", target: TARGET, checks: [] };
const PASS = (s, d) => { passes++; ev.checks.push({ v: "PASS", s: redactString(s), ...(d ? { d: redactSecrets(d) } : {}) }); console.log(`  PASS  ${redactString(s)}${d ? " " + J(d) : ""}`); };
const FAIL = (s, d) => { fails++; ev.checks.push({ v: "FAIL", s: redactString(s), ...(d ? { d: redactSecrets(d) } : {}) }); console.log(`  FAIL  ${redactString(s)}${d ? " " + J(d) : ""}`); };
const NV = (s, d) => { unproven++; ev.checks.push({ v: "N/V", s: redactString(s), ...(d ? { d: redactSecrets(d) } : {}) }); console.log(`  N/V   ${redactString(s)}${d ? " " + J(d) : ""}`); };

/* F-668 — THE CAPTURE'S ANSWER IS RECORDED, NEVER DISCARDED. Every call site here used
 * to waive the strict flag AND swallow the returned promise, so the branch that REFUSES a
 * leaking capture never ran, and the `{captured:false, reason}` answer had no reader: a
 * missing PNG was a silent hole in a green run. `makeShot` binds this driver's N/V writer
 * once. Strict is the default again — a readable address ABORTS rather than reaching disk
 * — and a capture that did not happen now says so, with its reason, in the evidence.
 * `scripts/evidence-redaction.test.mjs` keeps both halves true for the whole directory.
 *
 * F-689 — AND THE SUCCESSFUL CAPTURE GETS A WRITER TOO. This binding used to be
 * `makeShot(NV)`, a bare N/V function, which `makeShot` reads as "this driver offered no
 * PASS writer" — so a capture that actually HAPPENED was recorded nowhere, and the
 * `{total, masked, readable}` numbers that ARE the F-660 DOM assertion never reached
 * `evidence.json`. F-681 fixed that at the library and in one driver of four; this is the
 * same cut here. PASS for a capture taken, N/V for one that could not be, FAIL for one
 * REFUSED because a readable address survived the mask. */
const shot_ = makeShot({ pass: PASS, nv: NV, fail: FAIL });
const info = (s) => console.log(`        ${redactString(String(s))}`);

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
    await shot_(page, frame, `${OUT}/${shot}`);
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
    await shot_(page, frame, `${OUT}/${shot}`);
    return out;
  });
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * F-657 — THIS DRIVER USED TO CARRY THE VERY DEFECT IT WAS WRITTEN TO DISPROVE.
 *
 * `readSearchRows` opened a persistent context, read the rows, and CLOSED it. `grantRow(i)`
 * then opened ANOTHER context, re-typed "Mihai", waited five seconds and clicked
 * `.perm-search-item` nth(i) — a fresh invocation of Jira's user search, whose order this
 * file's own sibling docblock says is not stable. Three site accounts read "Mihai Perdum".
 * A reorder between the two searches put a REAL `{role:"editor", scope:"own"}` on a
 * stranger's account; `granted` was then false (the target never appeared on the roster),
 * so the `finally`'s `if (granted)` removed NOTHING and the stray survived the run, with
 * the operator told only that the byte compare had failed.
 *
 * The selection was also a PREFIX match (`seg(TARGET).startsWith(chip)`) that took the
 * FIRST candidate with no uniqueness guard — and `lib/roster-restore.mjs`'s
 * `selectByDiscriminator`, landed in the same commit range to forbid exactly this, was
 * never imported here.
 *
 * THE CUT. Both operations come from `lib/roster-ui.mjs` — the same implementation
 * `knowledge-doors-editor-live.mjs` drives. The read and the click happen in ONE context,
 * the chosen row's FULL account id is re-read from the live DOM immediately before the
 * click and any disagreement refuses, an unidentifiable target is N/V rather than a guess,
 * and the roster is restored by DIFF against the raw snapshot, UNCONDITIONALLY, so a
 * stray this run never recorded making is still removed.
 * ═══════════════════════════════════════════════════════════════════════════════ */
const { grantRole, restoreRosterToSnapshot, shots: uiShots, leaked: uiLeaked } =
  makeRosterUI({ withAdminPanel, rosterRows: rosterRaw, out: OUT, record: { pass: PASS, nv: NV, fail: FAIL } });

async function main() {
  console.log("\nF-647 / F-648 - the Permissions picker discriminator, live on DEV\n");
  const ping = await hook(null, "GET");
  if (ping.status !== 200) throw new Error(`the hook is not reachable (GET -> ${ping.status})`);
  PASS("hook reachable on dev, secret accepted");

  /* The snapshot is RAW and stays in memory: it is what the restore diffs against, and a
     redacted copy would call two different addresses equal because they share one mask.
     It is redacted at the file boundary (F-652). */
  const rosterBefore = await rosterRaw();
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
  ev.searchUsersHook = { status: su.status, body: redactString(su.text).slice(0, 300) };
  info(`searchUsers via hook (non-admin) -> ${su.status} ${redactString(su.text).slice(0, 200)}`);
  if (su.json && su.json.success === false && su.json.reason === "no-permission" && !(su.json.users || []).length) {
    PASS("F-648: the admin gate answers first - success:false, reason:'no-permission', no users", { reason: su.json.reason, needsRole: su.json.needsRole });
  } else if (su.status === 400 && /not allowlisted/.test(su.text)) {
    NV("F-648 admin-gate arm: `searchUsers` is NOT on the dev hook's invokeResolver allow-list, so no live call can choose a non-admin principal. Offline-proven only (scripts/search-users.test.mjs).", { hookAnswer: su.text.slice(0, 120) });
  } else {
    FAIL("F-648: the non-admin answer is neither the refusal nor the allow-list rejection", { status: su.status, body: redactString(su.text).slice(0, 200) });
  }
  NV("F-648 fail-CLOSED (429/5xx) arm: there is no hook lever that makes Jira's /user/search fail, and this run may not deploy one. Offline-proven only (search-users.test.mjs drives 403/429/500 + a thrown fetch through the mock).");

  /* ── ITEM 1 — the search rows, as an admin, through the real UI ─────────── */
  console.log("\nSTEP B - F-647: what does an admin actually SEE for the three namesakes?");
  const search = await readSearchRows("Mihai", "01-search-rows.png");
  ev.searchRows = search.rows;
  for (const r of search.rows) info(`row ${r.i}${r.disabled ? " (on roster)" : ""}: name="${r.name}" email=${r.emailShown ? redactString(r.emailShown) : "(absent)"} idChip=${r.idShown || "(absent)"} idTitle=${r.idTitle || "(absent)"}`);
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
    PASS(`Jira DOES return emailAddress: ${withEmail.length}/${search.rows.length} rows render an email`, { rowsWithEmail: withEmail.map((r) => ({ i: r.i, email: redactString(r.emailShown) })) });
    for (const r of withEmail) {
      if (r.idShown) PASS(`row ${r.i}: email AND id chip are shown together - the F-647 suppression is gone`, { email: redactString(r.emailShown), chip: r.idShown });
      else FAIL(`row ${r.i}: an email row SUPPRESSES the id chip - F-647 is live`, { email: redactString(r.emailShown) });
    }
  }

  /* ── the grant, the roster card, the stored row ─────────────────────────── */
  console.log("\nSTEP C - grant editor/own to the second account through the picker, and read all three surfaces back");
  let clicked = null;
  try {
    const before = await rosterIds();
    /* F-657 — THE SELECTION IS `selectByDiscriminator`, IN THE SAME CONTEXT AS THE CLICK.
       This used to pick an INDEX here, off rows read in a context that was then CLOSED,
       and hand that index to a second context that re-ran the search. It was also a PREFIX
       match on the visible chip with no uniqueness guard. The read below is only the
       PROOF that the target is identifiable from the UI; the grant re-reads and re-selects
       inside the one context that clicks, and refuses on any disagreement. */
    const pick = selectByDiscriminator(search.rows, TARGET);
    if (pick.index < 0) {
      if (pick.disabledHit) NV("the target account is ALREADY on the roster, so the picker grant cannot be exercised this run", { reason: pick.reason });
      else FAIL("no search row identifies the target account - the picker cannot be used to grant deliberately", { target: seg(TARGET), reason: pick.reason, ambiguous: !!pick.ambiguous });
    } else {
      PASS("the ROW FOR THE TARGET ACCOUNT IS IDENTIFIABLE FROM THE UI ALONE (id chip/title), which is exactly what F-645 said was impossible", { rowIndex: pick.index, how: pick.how, chip: seg(TARGET).slice(0, 8) });
      const emailAtPick = search.rows[pick.index] ? search.rows[pick.index].emailShown : null;

      const g = await grantRole(TARGET, "editor", "own", ["Mihai"]);
      ev.grant = { ok: !!g.ok, how: g.how, index: g.index, query: g.query, raced: !!g.raced, reason: g.reason };
      if (g.raced) {
        NV("the row carrying the target id had MOVED when it was re-read immediately before the click, so NOTHING was clicked - this is the F-657 window, refused instead of granted to a stranger", { reason: g.reason });
      } else if (!g.ok && g.notFound) {
        NV("the target row could not be identified inside the clicking context across any query - no click was made", { reason: g.reason });
      }
      clicked = { id: seg(TARGET), email: emailAtPick };

      const after = await rosterRaw();
      const added = after.filter((r) => !before.includes(typeof r === "string" ? r : r.accountId));
      ev.added = added;
      const row = after.find((r) => (typeof r === "string" ? r : r.accountId) === TARGET);
      if (row && row.role === "editor" && row.scope === "own")
        PASS("the grant landed on THE INTENDED ACCOUNT as {editor, own} (KVS read of app_admins)", { accountId: seg(TARGET), role: row.role, scope: row.scope });
      else if (g.ok || added.length) FAIL("the grant did not land on the intended account", { added: J(added) });
      /* THE NEGATIVE THAT F-657 IS ABOUT: a click that missed must not have landed on
         SOMEONE ELSE. Proven on the same read that would have shown the target. */
      const strayNow = added.filter((r) => (typeof r === "string" ? r : r.accountId) !== TARGET);
      if (strayNow.length === 0) PASS("...and NO account other than the target gained a role from this grant - no namesake was touched", { added: added.length });
      else FAIL("AN ACCOUNT THIS RUN DID NOT INTEND NOW HOLDS A ROLE - the positional grant is live", { strays: strayNow.map((r) => seg(typeof r === "string" ? r : r.accountId)) });

      if (row) {
        if (row.emailAddress) PASS("app_admins stored `emailAddress` on the roster row - the roster can repeat what the admin clicked", { emailAddress: redactString(row.emailAddress) });
        else if (clicked.email) FAIL("the search row showed an email but app_admins stored NONE - the two namespaces are still split", { clickedEmail: redactString(clicked.email) });
        else NV("app_admins stored no `emailAddress` because Jira never returned one for this account - nothing to persist", { accountId: seg(TARGET) });
      }

      /* The roster-card half only has something to read when a grant actually landed. It
         used to run unconditionally off `clicked`, which was the CLICK's own report. */
      if (!row) {
        NV("the roster-card surface could not be checked: no grant landed on the target this run", { reason: g.reason || "no row in app_admins" });
      } else {
      const cards = await readRosterCards("04-roster-card.png");
      ev.rosterCards = cards;
      for (const c of cards) info(`card ${c.i}: email=${c.emailShown ? redactString(c.emailShown) : "(absent)"} idChip=${c.idShown || "(absent)"}`);
      const card = cards.find((c) => c.idTitle === TARGET || (c.idShown && seg(TARGET).startsWith(c.idShown)));
      if (!card) FAIL("no roster card carries the granted account's id - the roster surface has no discriminator", { cards: cards.length });
      else {
        PASS("the roster CARD carries the same id segment as the search row that was clicked - the two surfaces match by eye", { chip: card.idShown, sameAsClicked: card.idShown === clicked.id });
        if (card.idTitle === TARGET) PASS("...and the card's id title is the FULL account id (no KVS read needed to recover it)", { titleTail: card.idTitle.slice(-12) });
        else FAIL("the card's id title is not the full account id", { title: card.idTitle });
        if (clicked.email) {
          if (card.emailShown && card.emailShown === clicked.email) PASS("the roster card repeats the SAME email the admin clicked", { email: redactString(card.emailShown) });
          else FAIL("the roster card does not repeat the clicked email - F-647 verbatim", { clicked: redactString(clicked.email), card: card.emailShown ? redactString(card.emailShown) : null });
        } else {
          NV("the email half of the roster card cannot be checked: no email was available on the search row either", {});
        }
      }
      }
    }
  } finally {
    console.log("\nRESTORE");
    /* F-657 — UNCONDITIONAL, AND BY DIFF. This used to be `if (granted)`, which is a
       statement about what the run BELIEVES it did — and the exact case that needed
       repairing was the one where `granted` is false because the click landed on a
       STRANGER. The plan is computed against the raw snapshot, so every row that is not
       in it is removed whoever put it there, and every row the run lost is re-added. */
    let restore = null;
    try {
      restore = await restoreRosterToSnapshot(rosterBefore);
      ev.rosterRestore = restore;
      info(`roster restore: ${JSON.stringify(restore.actions.map((a) => ({ act: a.act, id: a.id, ok: a.removed ?? a.ok })))}`);
    } catch (e) { FAIL("the roster restore UI failed - the roster may still hold a row this run added", { error: String(e.message).slice(0, 200) }); }

    const end = await rosterRaw();
    ev.rosterAfter = end;
    /* F-659 — the verdict, not a byte compare: `addAppAdmin` APPENDS, so a re-add can
       never reproduce the snapshot's row ORDER and a byte compare would be a permanent
       red. Strays, missing, changed and duplicated rows all stay a FAIL. */
    const v = rosterRestoreVerdict(rosterBefore, end);
    if (v.verdict === "byte-identical") PASS("SECOND READ: app_admins is BYTE-IDENTICAL to the in-memory snapshot taken before this run", { rows: end.length });
    else if (v.ok) { PASS(`SECOND READ: app_admins carries EXACTLY the snapshot's accounts, roles and scopes (${v.verdict})`, { rows: end.length }); info(`roster residue: ${v.info}`); }
    else FAIL("THE ROSTER IS NOT RESTORED", { verdict: v.verdict, beforeRows: rosterBefore.length, nowRows: end.length, diff: describePlan(v.plan) });
    /* The negative that F-657 is about, on the same object that would show it. */
    const strayEnd = planRosterRestore(rosterBefore, end).strays.map(rosterIdOf);
    if (strayEnd.length === 0) PASS("...and NO account outside the pre-run snapshot holds an app role - no namesake was left with a grant", { rows: end.length });
    else FAIL("AN ACCOUNT THIS RUN DID NOT START WITH STILL HOLDS AN APP ROLE - remove it by hand", { strays: strayEnd.map(idTail) });
    const endRole = (await invoke("checkIsAdmin", {}, TARGET)).json;
    if (endRole && endRole.role === null) PASS("...and checkIsAdmin reports the second account back to NO role (second read through the product)", { role: endRole.role });
    else FAIL("the second account still holds a role", { answer: J(endRole) });

    /* F-689 — THE CAPTURE RECORD IS EVIDENCE, AND A LEAK FAILS THE RUN ON ITS OWN.
       Two bindings take screenshots here — this file's `shot_` and the one inside
       `makeRosterUI` (grantRole/removeAccount) — so BOTH sets are folded in; reading one
       would leave the library's captures as invisible as they were before. With this
       written, "no PNG in this directory is unmasked" is something a reader can READ off
       `evidence.json` instead of inferring it from the absence of a throw.

       And the restore's own verdict is asserted HERE, at run level. `restoreRosterToSnapshot`
       runs its repairs under `attempt()`, which deliberately converts a throw into a
       recorded sentence and carries on — so a PII refusal during a repair came back as
       `{ok:false, leaked:true}` and this driver simply ignored it: the roster verdict below
       was clean, `fails` stayed 0, and the run exited green on a capture that had leaked.
       The PNG paths are named so the operator knows which artefacts to destroy. */
    const allShots = [...shot_.shots, ...uiShots()];
    ev.shots = allShots;
    const leaks = allShots.filter((s) => s.readable > 0);
    if (shot_.leaked || uiLeaked()) {
      FAIL("a screenshot capture was REFUSED because a readable email address survived the mask - the F-660 guarantee fired and this run FAILS on it regardless of the roster verdict", { paths: leaks.map((s) => s.path), leaks });
    }
    if (restore && restore.leaked) FAIL("the roster restore reports leaked:true - a capture taken during a repair was refused for a readable address", { paths: (restore.leaks || []).map((l) => l.path), leakInfo: restore.leakInfo });
    if (restore && restore.ok === false) FAIL("the roster restore reports ok:false - the repair did not complete cleanly", { verdict: restore.verdict, failures: restore.failures, reason: restore.reason });
    /* F-693 — THE POSITIVE CONTROL FOR THE MASK ITSELF, ONCE PER RUN, OVER BOTH SOURCES.
       Every per-shot verdict above is "nothing readable was left", which a mask matching ZERO
       elements satisfies unconditionally — so a rename of `.perm-ident-email` makes this
       driver report MORE passes while every PNG renders real addresses. This driver opens the
       user-search dropdown, a view that must carry at least one address, so seeing no span at
       all means the passes proved nothing. `allShots` is used rather than `shot_.shots`
       because the roster-UI helper is the second recorder and its captures count too. */
    const mask = maskPositiveControl(allShots);
    ev.maskPositiveControl = mask;
    if (mask.ok) PASS(mask.sentence, { spans: mask.spanTotal, masked: mask.maskedTotal, captures: mask.captures });
    else FAIL(mask.sentence, { spans: mask.spanTotal, captures: mask.captures, expected: "the user-search dropdown renders at least one `.perm-ident-email`" });
    ev.summary = { passes, fails, unproven, shots: allShots.length, captured: allShots.filter((s) => s.captured).length, leaks: leaks.length, maskSpans: mask.spanTotal };
    fs.writeFileSync(`${OUT}/evidence.json`, JSON.stringify(redactSecrets(ev), null, 2)); // F-656/F-662: the shared redactor is the ONLY gate
    console.log(`\n${passes} pass, ${fails} fail, ${unproven} not verified. Evidence: ${OUT}/evidence.json`);
    if (fails > 0) process.exitCode = 1;
  }
}
await main();
