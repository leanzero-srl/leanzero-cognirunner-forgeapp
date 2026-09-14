/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */
/* ═══════════════════════════════════════════════════════════════════════════════
 * F-642 — THE FOUR KNOWLEDGE DOORS + THE PROVIDER DOOR, DRIVEN AS A REAL
 * scope-"own" EDITOR, LIVE.
 *
 * WHY THIS SCRIPT EXISTS. F-638 put `saveSkill` / `deleteSkill` / `deleteContextDoc` /
 * `getContextDocContent` / `getOpenAIKey` on the dev hook's `invokeResolver` allow-list,
 * and F-642 recorded that the driver they were added for still calls them with the ADMIN
 * account id — so it proves nothing about F-622/624/625/626/633, all of which are about
 * what a scope-"own" EDITOR is told. The hook's principal is an ACCOUNT ID, and until now
 * the only account id in the harness was the admin's.
 *
 * WHERE THE EDITOR COMES FROM. The site's second active account holds no app role
 * (measured: `checkIsAdmin` -> role null). This script grants it {role:"editor",
 * scope:"own"} THROUGH THE PRODUCT'S OWN ROSTER SURFACE — the admin panel's Permissions
 * tab, which invokes `addAppAdmin` — because neither `addAppAdmin` nor `updateUserRole`
 * is on the hook's allow-list and `app_admins` is not a kvSet key. Playwright drives the
 * real UI under the persistent admin profile.
 *
 * THE ACCOUNT IS PICKED BY ITS ACCOUNT ID, NEVER BY POSITION (F-654). Three site accounts
 * are called "Mihai Perdum" and the search order is not stable; this script used to click
 * a candidate and find out afterwards whether it had hit the target, which meant a real
 * stranger held an app role for the seconds in between. It now reads the F-647
 * `.perm-ident-id` title off each row and clicks only the row whose FULL account id
 * matches — and if no row can be identified, it clicks NOTHING and reports N/V.
 *
 * THE ROSTER IS SNAPSHOTTED BEFORE AND RESTORED BY DIFF AFTERWARDS, unconditionally, in
 * the `finally`: every row absent from the snapshot is removed whoever added it, every
 * row the run lost is re-added with its snapshot role and scope, and a second read proves
 * both the byte-identical restore and the absence of ANY stray grant.
 *
 * WHAT IT REFUSES TO RISK (F-639). The "colleague's document" is a THROWAWAY created by
 * this run through the Documentation tab, never one of the tenant's real docs: the doc
 * probes expect a refusal, and a refusal that is broken is a DELETE — and no hook action
 * can re-create a document. Everything this run creates is deleted in the `finally`
 * and proven gone by a second read.
 *
 * No token, URL, secret or key value is ever printed.
 * ═══════════════════════════════════════════════════════════════════════════════ */
import fs from "node:fs";
import { loadEnv, requireEnv } from "../lib/env.mjs";
import { redactSecrets, redactString } from "../lib/redact.mjs";
import {
  rosterIdOf, idTail, planRosterRestore, rosterRestoreVerdict, describePlan,
} from "../lib/roster-restore.mjs";
/* F-660 — screenshots go through `shotMasked`, never `page.screenshot`: this driver
   captures the Permissions tab, which renders real addresses as PIXELS that no text
   redactor will ever see. `evidence-redaction.test.mjs` refuses a raw `.screenshot(` in
   any `*-live.mjs` that mentions `perm-`. */
import { makeRosterUI, makeShot } from "../lib/roster-ui.mjs";

const env = loadEnv();
const arg = (n, d) => { const h = process.argv.slice(2).find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const ENV_NAME = arg("env", "dev");
const HOOK_URL = ENV_NAME === "dev" ? env.TESTSTATE_URL : env.STAGING_TESTSTATE_URL;
const SECRET = requireEnv("HARNESS_SECRET");
const ADMIN = requireEnv("HARNESS_ADMIN_ACCOUNT_ID");
const EDITOR = arg("editor", "557058:653160a5-6112-470d-baea-333ac760364e");
const BASE = "https://wolfaenpak.atlassian.net";
const APP = "36415848-6868-4697-9554-3c3ad87b8da9";
const ENV_ID = arg("envid", ENV_NAME === "dev" ? "989ecaa0-261b-406e-b444-78c01c0d7772" : "1abe9beb-537b-43c1-b94f-e877e251f779");
const PROFILE = "/Users/mihaiperdum/Projects/forge-live-harness/.auth/profile";
const OUT = new URL("../results/knowledge-doors-editor", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passes = 0, fails = 0, unproven = 0;
const ev = { at: new Date().toISOString(), env: ENV_NAME, editorAccount: EDITOR, checks: [] };
/* F-646 — EVERY evidence payload is redacted ONCE, here, before it reaches the
   console or `ev` (which is what gets written to results/evidence.json). Call sites
   must never have to remember; that is exactly the memory that failed. */
const PASS = (s, d) => { const r = d ? redactSecrets(d) : d; passes++; ev.checks.push({ v: "PASS", s, ...(d ? { d: r } : {}) }); console.log(`  PASS  ${s}${d ? " " + JSON.stringify(r) : ""}`); };
const FAIL = (s, d) => { const r = d ? redactSecrets(d) : d; fails++; ev.checks.push({ v: "FAIL", s, ...(d ? { d: r } : {}) }); console.log(`  FAIL  ${s}${d ? " " + JSON.stringify(r) : ""}`); };
const NV = (s, d) => { const r = d ? redactSecrets(d) : d; unproven++; ev.checks.push({ v: "N/V", s, ...(d ? { d: r } : {}) }); console.log(`  N/V   ${s}${d ? " " + JSON.stringify(r) : ""}`); };

/* F-668 — THE CAPTURE'S ANSWER IS RECORDED, NEVER DISCARDED. Every call site here used
 * to waive the strict flag AND swallow the returned promise, so the branch that REFUSES a
 * leaking capture never ran, and the `{captured:false, reason}` answer had no reader: a
 * missing PNG was a silent hole in a green run. `makeShot` binds this driver's N/V writer
 * once. Strict is the default again — a readable address ABORTS rather than reaching disk
 * — and a capture that did not happen now says so, with its reason, in the evidence.
 * `scripts/evidence-redaction.test.mjs` keeps both halves true for the whole directory. */
const shot_ = makeShot(NV);
const info = (s) => console.log(`        ${redactString(String(s))}`);

const readRes = async (res) => {
  let text = ""; try { text = await res.text(); } catch { return { status: 0, json: null, text: "" }; }
  let json = null; try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, json, text };
};
async function hook(body, method = "POST", qs = "") {
  if (!HOOK_URL) throw new Error(`no web-trigger URL for environment "${ENV_NAME}"`);
  return readRes(await fetch(HOOK_URL + qs, {
    method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + SECRET },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  }));
}
const invoke = (functionKey, payload = {}, accountId = ADMIN) => hook({ action: "invokeResolver", functionKey, payload, accountId });
const kvs = async (key) => (await hook(null, "GET", `?what=kvs&key=${encodeURIComponent(key)}`)).json;

/** The whole point: two refusals compared as BYTES. */
function assertIdentical(tag, unknown, foreign) {
  const same = unknown.status === foreign.status && unknown.text === foreign.text;
  if (same) PASS(`${tag}: an unknown id and a colleague's row answer IDENTICALLY (HTTP ${unknown.status}, byte-for-byte)`, { body: unknown.text.slice(0, 160) });
  else FAIL(`${tag}: the two answers DIFFER — that is the F-261 existence oracle`, {
    unknown: { status: unknown.status, body: unknown.text.slice(0, 200) },
    foreign: { status: foreign.status, body: foreign.text.slice(0, 200) },
  });
  return same;
}

/* ── the admin panel, under the persistent admin profile ──────────────────────── */
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
    return await fn(page, frame);
  } finally { await ctx.close(); }
}

async function createThrowawayDoc(title) {
  return withAdminPanel(async (page, frame) => {
    await frame.locator(".tab-btn", { hasText: /^\s*Documentation\s*$/ }).click();
    const addBtn = frame.locator("button.btn-small", { hasText: /\+ Add Document/ }).first();
    await addBtn.waitFor({ state: "visible", timeout: 60000 });
    await addBtn.click();
    await frame.locator("input.doc-input").fill(title);
    await frame.locator("textarea").first().fill(
      "F-642 throwaway fixture. Created by knowledge-doors-editor-live.mjs to stand in as a COLLEAGUE'S document for the deleteContextDoc existence-parity probe. It is deleted in the same run.",
    );
    await frame.locator("button.btn-small", { hasText: /^\s*Save\s*$/ }).first().click();
    await sleep(5000);
    await shot_(page, frame, `${OUT}/01-doc-created.png`);
    return true;
  });
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * F-654 — THE ROSTER, DRIVEN BY DISCRIMINATOR AND RESTORED BY DIFF.
 *
 * WHAT WAS HERE BEFORE, AND WHY IT IS GONE. This file used to grant the role with a
 * "loop with a ledger": click the nth enabled search row, read `app_admins`, and if the
 * id that appeared was the wrong "Mihai Perdum", remove it and try n+1. MEASURED live on
 * dev 2026-09-14: `[{hitTarget:false},{hitTarget:true}]` — a REAL wrong account held
 * {role:"editor",scope:"own"} for the seconds between the click and the read, every run.
 * The `finally` restored only EDITOR, so a Playwright timeout or a killed process in that
 * window left the stray grant on the tenant permanently.
 *
 * It existed because the search rows carried no account id. F-647 fixed that: every row
 * and every card now renders `.perm-ident-id` whose `title` is the FULL `557058:<uuid>`.
 * So the target is identifiable BEFORE the click, and the loop is not a workaround any
 * more — it is just a way to grant roles to the wrong people.
 *
 * THE RULE NOW: one click, on a row identified by its discriminator, or NO CLICK AT ALL.
 * `selectByDiscriminator` (lib/roster-restore.mjs) never guesses and never falls back to
 * the display name; when it cannot identify the target the step is NOT VERIFIED. An N/V
 * costs a re-run. A grant on a stranger's account costs trust.
 *
 * AND THE RESTORE IS A DIFF, NOT AN UNDO. `restoreRosterToSnapshot` reads the roster,
 * diffs it against the raw pre-run snapshot, removes EVERY row that is not in the
 * snapshot (whoever put it there), re-adds every row the run lost, and proves it with a
 * second read. It runs in the `finally` UNCONDITIONALLY — not behind `if (granted)` —
 * because the state that needs repairing is the state on the tenant, not the state we
 * think we caused.
 *
 * AND IT ALL LIVES IN `lib/roster-ui.mjs` NOW (F-657). It used to live HERE, in full, and
 * `perm-discriminator-live.mjs` — the driver written as the PROOF that F-654 was fixed —
 * had its own copy that reverted to a stale INDEX across two browser contexts. One home
 * for the hands, one home for the decisions; a driver that wants this behaviour imports
 * it and cannot half-implement it.
 * ═══════════════════════════════════════════════════════════════════════════════ */


/** The app roster, raw rows, straight from KVS. Held in memory; never written unredacted. */
const rosterRows = async () => (await kvs("app_admins"))?.value || [];

/* F-657 — THE HANDS LIVE IN `lib/roster-ui.mjs`, NOT HERE. `perm-discriminator-live.mjs`
 * was written as the PROOF that the F-654 positional grant was fixed, and it carried the
 * same defect verbatim because it had its own copy of these three functions. Two homes for
 * "click the right namesake and put the roster back" is how that happens; there is now
 * one, and both drivers call it. The DECISIONS stay pure in `lib/roster-restore.mjs`. */
const { grantRole, restoreRosterToSnapshot } =
  makeRosterUI({ withAdminPanel, rosterRows, out: OUT, record: NV });

async function main() {
  console.log(`\nF-642 — the knowledge/provider doors as a scope-"own" EDITOR, live on ${ENV_NAME.toUpperCase()}\n`);
  const ping = await hook(null, "GET");
  if (ping.status !== 200) throw new Error(`the hook is not reachable on ${ENV_NAME} (GET -> ${ping.status})`);
  PASS(`hook reachable on ${ENV_NAME}, secret accepted`);

  /* ── STEP 0 — snapshots ───────────────────────────────────────────────────── */
  /* F-652 — `app_admins` carries real `emailAddress` values since F-647. The RAW
     snapshot is what the byte-identical RESTORE check at the end compares against, so
     it is held IN MEMORY ONLY and never written; every copy that reaches disk or a
     terminal goes through `redactSecrets`, which masks the address to
     `<initial>***@<domain>` — enough to tell namesakes apart, not a contactable
     address in an artefact. */
  const rosterBefore = (await kvs("app_admins"))?.value || [];
  const rosterBeforeJson = JSON.stringify(rosterBefore);   // in-memory, for the restore diff
  ev.rosterBefore = rosterBefore;                          // redacted at the file boundary
  fs.writeFileSync(`${OUT}/roster-before.json`, JSON.stringify(redactSecrets(rosterBefore), null, 2));
  info(`roster snapshot: ${rosterBefore.length} row(s) -> ${OUT}/roster-before.json`);
  const docsBefore = (await invoke("getContextDocs", {})).json?.docs || [];
  const skillsBefore = (await invoke("getSkills", {})).json?.skills || [];
  ev.docsBefore = docsBefore.map((d) => ({ id: d.id, builtin: !!d.builtin, disabled: !!d.disabled }));
  ev.skillsBefore = skillsBefore.map((s) => ({ id: s.id, builtin: !!s.builtin, enabled: s.enabled !== false }));
  fs.writeFileSync(`${OUT}/knowledge-before.json`, JSON.stringify(redactSecrets({ docs: ev.docsBefore, skills: ev.skillsBefore }), null, 2));

  const roleOf = async (acc) => (await invoke("checkIsAdmin", {}, acc)).json;
  const preRole = await roleOf(EDITOR);
  if (preRole && preRole.role === null) PASS("the second account starts with NO app role — the pre-grant probes below are a genuine non-viewer", { role: preRole.role, scope: preRole.scope });
  else { FAIL("the second account already holds a role — this run cannot prove the non-viewer arm", { answer: JSON.stringify(preRole).slice(0, 160) }); return; }

  let docId = null, skillAdmin = null, skillOwn = null, granted = false;
  try {
    /* ── STEP 1 — F-626 / F-633 as a NON-VIEWER (before any grant) ──────────── */
    console.log("\nSTEP 1 - F-626 getContextDocContent and F-633 getOpenAIKey as an account with NO role");
    const probeDocId = (docsBefore.find((d) => !d.builtin) || docsBefore[0]).id;
    const asAdminDoc = await invoke("getContextDocContent", { id: probeDocId }, ADMIN);
    if (asAdminDoc.json?.success && asAdminDoc.json.doc && typeof asAdminDoc.json.doc.content === "string") {
      PASS("POSITIVE CONTROL: the SAME document id returns a BODY for the admin — so a refusal below is the gate, not a missing row", { id: probeDocId, contentLength: asAdminDoc.json.doc.content.length });
    } else FAIL("the positive control failed: the admin cannot read this document either", { body: asAdminDoc.text.slice(0, 200) });
    const asNoneDoc = await invoke("getContextDocContent", { id: probeDocId }, EDITOR);
    ev.f626 = { admin: asAdminDoc.json && { success: true, contentLength: asAdminDoc.json.doc?.content?.length }, nonViewer: asNoneDoc.json };
    const noBody = asNoneDoc.json && asNoneDoc.json.success === false && !asNoneDoc.json.doc;
    if (noBody && /viewer/.test(JSON.stringify(asNoneDoc.json))) PASS("F-626: a non-viewer is REFUSED the document body, and the answer carries no `doc`", { answer: asNoneDoc.text.slice(0, 200) });
    else FAIL("F-626: the non-viewer answer is not a bodyless refusal", { answer: asNoneDoc.text.slice(0, 250) });

    const keyAdmin = await invoke("getOpenAIKey", {}, ADMIN);
    const keyNone = await invoke("getOpenAIKey", {}, EDITOR);
    const mask = (o) => o && { success: o.success, hasKey: o.hasKey, isByok: o.isByok, provider: o.provider, hasBaseUrl: typeof o.baseUrl === "string" && o.baseUrl.length > 0, error: o.error, needsRole: o.needsRole, hint: o.hint };
    ev.f633 = { admin: mask(keyAdmin.json), nonViewer: mask(keyNone.json) };
    if (keyAdmin.json?.success) PASS("POSITIVE CONTROL: the admin DOES get the provider settings answer", mask(keyAdmin.json));
    else FAIL("the positive control failed: the admin cannot read the provider settings either", mask(keyAdmin.json));
    const kn = keyNone.json || {};
    if (kn.success === false && !kn.baseUrl && !kn.provider) PASS("F-633: a non-viewer is REFUSED the provider settings — no baseUrl, no provider name", { answer: JSON.stringify(mask(kn)) });
    else FAIL("F-633: the non-viewer still learns the AI infrastructure", { answer: JSON.stringify(mask(kn)) });

    /* ── STEP 2 — a colleague's DOC (throwaway) + the roster grant, both through the UI ── */
    console.log("\nSTEP 2 - a throwaway colleague document, then the editor grant, both through the product's own UI");
    const title = `F-642 colleague doc ${Date.now()}`;
    await createThrowawayDoc(title);
    const docsAfterCreate = (await invoke("getContextDocs", {})).json?.docs || [];
    const mine = docsAfterCreate.find((d) => d.title === title);
    docId = mine?.id || null;
    if (docId && mine.createdBy === ADMIN) PASS("the throwaway document exists and is authored by the ADMIN — a genuine colleague's row for the editor", { id: docId });
    else { FAIL("the throwaway document was not created — the doc probes cannot run safely", { found: JSON.stringify(mine || null).slice(0, 160) }); }

    /* F-654 — ONE grant, on a row identified by its FULL account id before the click.
       There is no attempt loop any more: if the discriminator cannot name the target,
       nothing is clicked and the run is NOT VERIFIED from here on. */
    const g = await grantRole(EDITOR, "editor", "own", ["Mihai"]);
    info(`roster grant: ${JSON.stringify({ ok: !!g.ok, how: g.how, rowIndex: g.index, alreadyPresent: !!g.alreadyPresent, notFound: !!g.notFound })}`);
    /* F-671 — THE CARD READ-BACK IS REPORTED, NOT JUST COMPUTED. `grantRole` learned to
       tell "the card agrees with the store" apart from "the card could not be read at
       all" (the null that used to satisfy the assertion outright). That answer had no
       reader here: `ev.grant` carried only the click's own fields, so a card that went
       unreadable — the exact regression F-671 is about — left no trace in the evidence
       and no assertion to fail. Every grant now states `cardAgrees`, `cardUnreadable`
       and the `cardHow` reason the read gives for itself. */
    ev.grant = {
      ok: !!g.ok, how: g.how, index: g.index, notFound: !!g.notFound, reason: g.reason,
      card: g.card ?? null, cardAgrees: g.cardAgrees ?? null,
      cardUnreadable: !!g.cardUnreadable, cardHow: g.cardHow ?? null,
      ...(g.cardMismatch ? { cardMismatch: g.cardMismatch } : {}),
    };
    if (g.ok) {
      if (g.cardAgrees === true) PASS("the roster CARD agrees with the stored row — the UI shows the permission storage actually granted", { card: g.card, how: g.cardHow });
      else if (g.cardUnreadable) FAIL("the roster card could NOT be read back, so the UI cannot be shown to agree with the stored row (F-671: this used to count as agreement)", { cardHow: String(g.cardHow).slice(0, 220) });
      else FAIL("the roster card disagrees with the stored row", { card: g.card, mismatch: String(g.cardMismatch).slice(0, 220) });
    }
    if (g.notFound) {
      NV("the target account's search row could not be identified by its discriminator — NOTHING was clicked, so no namesake was granted a role", { reason: String(g.reason).slice(0, 220) });
      return;
    }
    const rosterAfter = await rosterRows();
    const row = rosterAfter.find((r) => rosterIdOf(r) === EDITOR);
    granted = Boolean(row);
    ev.rosterAfterGrant = rosterAfter;
    /* THE PROOF THAT THE OLD LOOP COULD NEVER GIVE: the roster gained EXACTLY the account
       under test and nothing else. A namesake grant would show up here as a second row. */
    const gainedNow = planRosterRestore(rosterBefore, rosterAfter).strays.map(rosterIdOf);
    if (gainedNow.length === 1 && gainedNow[0] === EDITOR)
      PASS("the grant added EXACTLY ONE account and it is the one under test — no namesake was touched", { added: gainedNow.map(idTail) });
    else FAIL("the grant changed the roster in a way this run did not intend", { added: gainedNow.map(idTail) });
    if (row && row.role === "editor" && row.scope === "own") PASS("the second account now holds {role:'editor', scope:'own'} on the app roster", { accountId: EDITOR, role: row.role, scope: row.scope });
    else { FAIL("the editor grant did not land as scope-'own' editor", { row: JSON.stringify(redactSecrets(row || null)).slice(0, 200) }); return; }
    const postRole = await roleOf(EDITOR);
    if (postRole?.role === "editor" && postRole.scope === "own" && postRole.isAdmin === false)
      PASS("…and the product's own `checkIsAdmin` agrees (second read, through the resolver)", { role: postRole.role, scope: postRole.scope });
    else FAIL("checkIsAdmin does not report the granted role", { answer: JSON.stringify(postRole).slice(0, 200) });

    /* ── STEP 3 — the two skills: one the editor owns, one it does not ───────── */
    console.log("\nSTEP 3 - a colleague's skill (admin-authored) and the editor's own");
    const a = await invoke("saveSkill", { name: `F-642 colleague skill ${Date.now()}`, category: "Other", instructions: "F-642 fixture. Never used at runtime." }, ADMIN);
    skillAdmin = a.json?.id || null;
    const o = await invoke("saveSkill", { name: `F-642 editor own skill ${Date.now()}`, category: "Other", instructions: "F-642 fixture. Authored by the editor." }, EDITOR);
    skillOwn = o.json?.id || null;
    if (skillAdmin && skillOwn) PASS("both fixture skills exist", { colleague: skillAdmin, own: skillOwn });
    else { FAIL("a fixture skill could not be created", { admin: a.text.slice(0, 200), editor: o.text.slice(0, 200) }); return; }
    const idx = (await invoke("getSkills", {})).json?.skills || [];
    const cRow = idx.find((s) => s.id === skillAdmin), oRow = idx.find((s) => s.id === skillOwn);
    if (cRow?.createdBy === ADMIN && oRow?.createdBy === EDITOR)
      PASS("authorship is what the probes need: the colleague skill is the ADMIN's, the own skill is the EDITOR's", { colleagueBy: "admin", ownBy: "editor" });
    else FAIL("authorship is not as expected", { colleagueBy: cRow?.createdBy, ownBy: oRow?.createdBy });

    /* ── STEP 4 — F-622 saveSkill: unknown id vs a colleague's ───────────────── */
    console.log("\nSTEP 4 - F-622 saveSkill as the scope-'own' editor: unknown id vs a colleague's skill");
    const freeSkill = `skill_f642free${Date.now().toString(36)}`;
    const body = (id) => ({ id, name: "probe", category: "Other", instructions: "probe" });

    /* F-649 — THE PRE-READ, TAKEN BEFORE ANYTHING IS ATTEMPTED. "the row was not
       modified" is only a claim about the REFUSAL if we know what the row said first,
       and the old check compared one field (`name`) against the STEP-3 index row, which
       an edit to `instructions` would sail straight past. Read the full stored object
       as the AUTHOR (admin) — getSkillContent returns `{ success, skill }`, the bytes. */
    const preRead = await invoke("getSkillContent", { id: skillAdmin }, ADMIN);
    const preBytes = preRead.json?.success === true && preRead.json.skill ? JSON.stringify(preRead.json.skill) : null;
    if (preBytes) PASS("PRE-READ: the colleague's skill bytes are on record before the refused save", { id: skillAdmin, bytes: preBytes.length });
    else FAIL("the pre-read failed, so 'unchanged' below could not be proven — it is not a pass", { id: skillAdmin, answer: preRead.text.slice(0, 200) });

    const uS = await invoke("saveSkill", body(freeSkill), EDITOR);
    const fS = await invoke("saveSkill", body(skillAdmin), EDITOR);
    ev.saveSkill = { unknown: uS.text, foreign: fS.text };
    info(`unknown -> ${uS.status} ${uS.text.slice(0, 140)}`);
    info(`foreign -> ${fS.status} ${fS.text.slice(0, 140)}`);
    assertIdentical("saveSkill", uS, fS);

    /* F-649 — THE ARM USED TO BE VACUOUS. `assertIdentical` only requires the two
       answers to MATCH, and "does not say 'not found'" is satisfied by silence, so two
       identical HTTP 500s from a wholly broken saveSkill printed three PASSes. The
       sibling deleteSkill arm at least rejected `success:true`; this one asserted
       nothing positive at all. Mirror it, and go further: assert the SHAPE of the
       shared refusal on BOTH answers, so a uniform outage is a FAIL, not a clean step. */
    if (!/not found/i.test(uS.text)) PASS("saveSkill: the shared answer never says 'not found'");
    else FAIL("saveSkill: the shared answer still leaks existence wording", { body: uS.text.slice(0, 200) });
    for (const [arm, r] of [["unknown id", uS], ["a colleague's skill", fS]]) {
      const j = r.json || {};
      // The one refusal shape: notOwner() = permissionDenied(…, null, { hint: "not-owner" }).
      const isRefusal = j.success === false;
      const named = j.reason === "no-permission" && (j.hint === "not-owner" || /belongs to someone else/i.test(String(j.error || "")));
      if (isRefusal && named)
        PASS(`saveSkill (${arm}): the answer is the REAL refusal — success:false, reason:"no-permission", the not-owner hint`, { reason: j.reason, hint: j.hint });
      else if (j.success === true)
        FAIL(`saveSkill (${arm}): answered success — the write door is open`, { body: r.text.slice(0, 200) });
      else
        FAIL(`saveSkill (${arm}): not the shared ownership refusal — an outage answers this way too, and that must not grade PASS`, { status: r.status, body: r.text.slice(0, 200) });
    }

    const postRead = await invoke("getSkillContent", { id: skillAdmin }, ADMIN);
    const postBytes = postRead.json?.success === true && postRead.json.skill ? JSON.stringify(postRead.json.skill) : null;
    if (!preBytes || !postBytes)
      FAIL("SECOND READ: the colleague's skill could not be read back, so 'unchanged' is NOT VERIFIABLE here", { id: skillAdmin, pre: !!preBytes, post: !!postBytes });
    else if (postBytes === preBytes)
      PASS("SECOND READ: the colleague's skill is byte-for-byte what it was before the refused save", { id: skillAdmin, bytes: postBytes.length });
    else
      FAIL("the refused save CHANGED the colleague's skill", { id: skillAdmin, preBytes: preBytes.length, postBytes: postBytes.length });

    /* ── STEP 5 — F-624 deleteSkill: unknown vs colleague, then the author's own ─ */
    console.log("\nSTEP 5 - F-624 deleteSkill: unknown id vs a colleague's, then the author deleting their OWN");
    const uD = await invoke("deleteSkill", { id: `skill_f642free${Date.now().toString(36)}` }, EDITOR);
    const fD = await invoke("deleteSkill", { id: skillAdmin }, EDITOR);
    ev.deleteSkill = { unknown: uD.text, foreign: fD.text };
    info(`unknown -> ${uD.status} ${uD.text.slice(0, 140)}`);
    info(`foreign -> ${fD.status} ${fD.text.slice(0, 140)}`);
    assertIdentical("deleteSkill", uD, fD);
    if (!/"success":\s*true/.test(uD.text)) PASS("deleteSkill: an unknown id is REFUSED, not silently 'deleted' (the F-624 write attempt is gone)");
    else FAIL("deleteSkill: an unknown id still answers success — the oracle is open", { body: uD.text.slice(0, 200) });
    /* F-649 (same class as the saveSkill arm above) — "not success:true" is still
       satisfied by an outage. Name the refusal on BOTH answers here too. */
    for (const [arm, r] of [["unknown id", uD], ["a colleague's skill", fD]]) {
      const j = r.json || {};
      const named = j.success === false && j.reason === "no-permission" &&
        (j.hint === "not-owner" || /belongs to someone else/i.test(String(j.error || "")));
      if (named) PASS(`deleteSkill (${arm}): the answer is the REAL refusal — success:false, reason:"no-permission", the not-owner hint`, { reason: j.reason, hint: j.hint });
      else FAIL(`deleteSkill (${arm}): not the shared ownership refusal — an outage answers this way too`, { status: r.status, body: r.text.slice(0, 200) });
    }
    const afterDel = (await invoke("getSkills", {})).json?.skills || [];
    if (afterDel.find((s) => s.id === skillAdmin)) PASS("SECOND READ: the colleague's skill SURVIVED the refused delete", { id: skillAdmin });
    else FAIL("the refused delete removed the colleague's skill", { id: skillAdmin });
    const own = await invoke("deleteSkill", { id: skillOwn }, EDITOR);
    if (own.json?.success === true) {
      const gone = ((await invoke("getSkills", {})).json?.skills || []).find((s) => s.id === skillOwn);
      if (!gone) { PASS("the AUTHOR can still delete their OWN skill, and a second read of the same index no longer finds it", { id: skillOwn }); skillOwn = null; }
      else FAIL("the author's delete answered success but the row is still in the index", { id: skillOwn });
    } else FAIL("the author cannot delete their own skill — the gate over-tightened", { answer: own.text.slice(0, 200) });

    /* ── STEP 6 — F-625 deleteContextDoc: unknown vs a colleague's ───────────── */
    console.log("\nSTEP 6 - F-625 deleteContextDoc: unknown id vs a colleague's document");
    if (!docId) NV("F-625: no throwaway document was created, so the colleague arm cannot be driven safely");
    else {
      const uC = await invoke("deleteContextDoc", { id: `doc_f642free${Date.now().toString(36)}` }, EDITOR);
      const fC = await invoke("deleteContextDoc", { id: docId }, EDITOR);
      ev.deleteDoc = { unknown: uC.text, foreign: fC.text };
      info(`unknown -> ${uC.status} ${uC.text.slice(0, 140)}`);
      info(`foreign -> ${fC.status} ${fC.text.slice(0, 140)}`);
      assertIdentical("deleteContextDoc", uC, fC);
      if (!/"success":\s*true/.test(uC.text)) PASS("deleteContextDoc: an unknown id is REFUSED before any storage write");
      else FAIL("deleteContextDoc: an unknown id still answers success", { body: uC.text.slice(0, 200) });
      const survived = ((await invoke("getContextDocs", {})).json?.docs || []).find((d) => d.id === docId);
      if (survived) PASS("SECOND READ: the colleague's document SURVIVED the refused delete", { id: docId });
      else FAIL("the refused delete removed the colleague's document", { id: docId });
    }

    /* ── STEP 7 — F-635: a BUILTIN must name the admin as the remedy ─────────── */
    console.log("\nSTEP 7 - F-635: a BUILTIN skill and a BUILTIN document, deleted as the scope-'own' editor");
    const builtinSkill = skillsBefore.find((s) => s.builtin);
    const builtinDoc = docsBefore.find((d) => d.builtin);
    const bS = await invoke("deleteSkill", { id: builtinSkill.id }, EDITOR);
    ev.builtinSkill = { id: builtinSkill.id, answer: bS.text };
    info(`builtin skill -> ${bS.status} ${bS.text.slice(0, 200)}`);
    if (/Only admins can disable built-in skills/.test(bS.text) && bS.json?.needsRole === "admin")
      PASS("F-635: the builtin SKILL answers 'Only admins can disable built-in skills' with needsRole:'admin' — the remedy is named", { needsRole: bS.json.needsRole });
    else FAIL("F-635: the builtin skill refusal does not name the admin remedy", { answer: bS.text.slice(0, 250) });
    const bD = await invoke("deleteContextDoc", { id: builtinDoc.id }, EDITOR);
    ev.builtinDoc = { id: builtinDoc.id, answer: bD.text };
    info(`builtin doc -> ${bD.status} ${bD.text.slice(0, 200)}`);
    if (/Only admins can disable built-in documents/.test(bD.text) && bD.json?.needsRole === "admin")
      PASS("F-635: the builtin DOCUMENT answers 'Only admins can disable built-in documents' with needsRole:'admin'", { needsRole: bD.json.needsRole });
    else FAIL("F-635: the builtin document refusal does not name the admin remedy", { answer: bD.text.slice(0, 250) });
    const sEdit = await invoke("saveSkill", { id: builtinSkill.id, name: "probe", instructions: "probe" }, EDITOR);
    if (/Admin access required to edit built-in skills/.test(sEdit.text) && sEdit.json?.needsRole === "admin")
      PASS("…and EDITING a builtin skill answers 'Admin access required to edit built-in skills' with needsRole:'admin'", { needsRole: sEdit.json.needsRole });
    else FAIL("the builtin saveSkill refusal does not name the admin remedy", { answer: sEdit.text.slice(0, 250) });
    /* THE SECOND READ THAT MATTERS: nothing was left disabled. */
    const skillsNow = (await invoke("getSkills", {})).json?.skills || [];
    const docsNow = (await invoke("getContextDocs", {})).json?.docs || [];
    const bsNow = skillsNow.find((s) => s.id === builtinSkill.id);
    const bdNow = docsNow.find((d) => d.id === builtinDoc.id);
    if (bsNow && bsNow.enabled !== false && bsNow.disabled !== true) PASS("SECOND READ: the builtin skill is still present and NOT disabled", { id: builtinSkill.id });
    else FAIL("the refused builtin delete left the skill disabled or gone", { row: JSON.stringify(bsNow || null).slice(0, 200) });
    if (bdNow && bdNow.disabled !== true) PASS("SECOND READ: the builtin document is still present and NOT disabled", { id: builtinDoc.id });
    else FAIL("the refused builtin delete left the document disabled or gone", { row: JSON.stringify(bdNow || null).slice(0, 200) });
    const namesNow = JSON.stringify(skillsNow.filter((s) => s.builtin).map((s) => [s.id, s.enabled !== false]));
    const namesBefore = JSON.stringify(skillsBefore.filter((s) => s.builtin).map((s) => [s.id, s.enabled !== false]));
    if (namesNow === namesBefore) PASS("…and NO builtin skill anywhere on the instance changed its enabled flag during this run");
    else FAIL("a builtin skill's enabled flag moved during this run", { before: namesBefore.slice(0, 200), now: namesNow.slice(0, 200) });
  } finally {
    /* ── RESTORE (F-639: everything this run made, unmade, and proven) ───────── */
    console.log("\nRESTORE");
    if (skillOwn) { await invoke("deleteSkill", { id: skillOwn }, ADMIN); }
    if (skillAdmin) { await invoke("deleteSkill", { id: skillAdmin }, ADMIN); }
    if (docId) { await invoke("deleteContextDoc", { id: docId }, ADMIN); }
    const skillsEnd = (await invoke("getSkills", {})).json?.skills || [];
    const docsEnd = (await invoke("getContextDocs", {})).json?.docs || [];
    const leftS = skillsEnd.filter((s) => /^F-642 /.test(s.name || ""));
    const leftD = docsEnd.filter((d) => /^F-642 /.test(d.title || ""));
    if (leftS.length === 0 && leftD.length === 0) PASS("every fixture this run created is GONE (second read of the skill and doc indexes finds none)");
    else FAIL("a fixture survives", { skills: leftS.map((s) => s.id), docs: leftD.map((d) => d.id) });

    /* F-654 — THE ROSTER RESTORE RUNS UNCONDITIONALLY. It used to sit behind
       `if (granted)`, which is a statement about what this run BELIEVES it did; the thing
       that needs repairing is what is actually on the tenant. Driven by the diff against
       the raw snapshot, it removes any stray row — including one a mis-click or a partial
       failure left behind — and re-adds anything the run lost. */
    let restore = null;
    try {
      restore = await restoreRosterToSnapshot(rosterBefore);
      info(`roster restore: ${JSON.stringify(restore.actions.map((a) => ({ act: a.act, id: a.id, ok: a.removed ?? a.ok, how: a.how })))}`);
    } catch (e) { FAIL("the roster restore UI failed — the roster may still hold a row this run added", { error: String(e.message).slice(0, 200) }); }
    {
      const rosterEnd = await rosterRows();
      ev.rosterAfter = rosterEnd;
      ev.rosterRestore = restore && { ok: restore.ok, verdict: restore.verdict, actions: restore.actions, plan: restore.plan };
      /* The comparison is RAW on both sides — a redacted diff would pass while two
         different addresses sat behind the same mask. Only the FAIL payload is
         redacted, and it is redacted BEFORE the slice: cutting first can leave a
         half-address under the 300-char boundary that no email pattern would match.

         F-659 — THE VERDICT, NOT A BYTE COMPARE. `addAppAdmin` APPENDS, so any restore
         that re-adds a row lands it at the tail: this line used to be a permanent red
         after every re-add, telling an operator to hand-repair a tenant that was already
         correct. `rosterRestoreVerdict` compares the {accountId, role, scope} SET and
         keeps the hand-repair FAIL for strays, missing, changed and duplicated rows. */
      const v = rosterRestoreVerdict(rosterBefore, rosterEnd);
      if (v.verdict === "byte-identical") PASS("SECOND READ: the app roster is byte-identical to the snapshot taken before this run", { rows: rosterEnd.length });
      else if (v.ok) {
        PASS(`SECOND READ: the app roster carries EXACTLY the snapshot's accounts, roles and scopes (${v.verdict})`, { rows: rosterEnd.length, verdict: v.verdict });
        info(`roster residue: ${v.info}`);
      } else FAIL("THE ROSTER IS NOT RESTORED — restore it by hand from roster-before.json", {
        verdict: v.verdict,
        diff: restore ? restore.plan : describePlan(v.plan),
        before: redactString(rosterBeforeJson).slice(0, 300),
        now: redactString(JSON.stringify(rosterEnd)).slice(0, 300),
      });
      /* THE NEGATIVE THAT MATTERS MOST: no account other than the snapshot's holds a row.
         Proven on the same object — this is the very read that showed the stray grants. */
      const strayEnd = planRosterRestore(rosterBefore, rosterEnd).strays.map(rosterIdOf);
      if (strayEnd.length === 0) PASS("…and NO account outside the pre-run snapshot holds an app role — no namesake was left with a grant", { rows: rosterEnd.length });
      else FAIL("AN ACCOUNT THIS RUN DID NOT START WITH STILL HOLDS AN APP ROLE — remove it by hand", { strays: strayEnd.map(idTail) });
    }
    if (granted) {
      const endRole = (await invoke("checkIsAdmin", {}, EDITOR)).json;
      if (endRole && endRole.role === null) PASS("…and the product's own checkIsAdmin reports the second account back to NO role", { role: endRole.role });
      else FAIL("the second account still holds a role", { answer: JSON.stringify(endRole).slice(0, 200) });
    }
    const docsFinal = (await invoke("getContextDocs", {})).json?.docs || [];
    const beforeIds = JSON.stringify(ev.docsBefore);
    const nowIds = JSON.stringify(docsFinal.map((d) => ({ id: d.id, builtin: !!d.builtin, disabled: !!d.disabled })));
    if (beforeIds === nowIds) PASS("SECOND READ: the documentation index is identical to the pre-run snapshot (ids, builtin flags, disabled flags)");
    else FAIL("the documentation index changed across this run", { before: beforeIds.slice(0, 300), now: nowIds.slice(0, 300) });

    /* F-646 — redacted AGAIN at the file boundary: `ev.f626`/`ev.f633`/`ev.saveSkill`
       are assigned directly and never pass through PASS/FAIL/NV. */
    fs.writeFileSync(`${OUT}/evidence.json`, JSON.stringify(redactSecrets(ev), null, 2));
    console.log(`\n${passes} pass, ${fails} fail, ${unproven} not verified. Evidence: ${OUT}/evidence.json`);
    if (fails > 0) process.exitCode = 1;
  }
}

await main();
