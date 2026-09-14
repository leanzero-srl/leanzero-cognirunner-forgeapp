/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */
/* ═══════════════════════════════════════════════════════════════════════════════
 * F-648 / F-655 LIVE — THE JIRA USER-SEARCH FAULT, THROUGH THE REAL DOOR.
 *
 * WHAT IT PROVES. F-648 made `searchUsers` fail CLOSED for the whole transport class:
 * a 403/429/500 from `/rest/api/3/user/search` is `{success:false,
 * reason:"jira_unavailable", status}` and NOT the empty success an admin reads as
 * "that person is not on this site". F-655 built the two halves of the live door that
 * arm was missing — `searchUsers` on the hook's `invokeResolver` allow-list, and
 * `armJiraFault` in the `armHarnessFault` family. This driver is the proof that both
 * halves work against a deployed build:
 *
 *   1. ADMIN + fault armed          -> {success:false, reason:"jira_unavailable", 429}, no users
 *   2. NON-ADMIN (role:null) + fault -> the no-permission refusal: THE GATE RUNS FIRST,
 *                                       and the fault row is untouched by that call
 *   3. The Permissions tab, as the signed-in admin, renders the BACKEND SENTENCE
 *      (naming HTTP 429) and not "No users found" — and the notice is REPLACED across
 *      keystrokes, never stacked
 *   4. Disarm -> the three real namesakes come back; readJiraFault -> null
 *   5. TTL -> arm for 5 s, wait 8 s, search: real results. The window EXPIRES; the
 *      passing state in (4) is not an artefact of the disarm call alone.
 *
 * WHY (2) NEEDS ITS OWN SECOND READ. The fault row is a WINDOW, not a COUNT (see
 * `HARNESS_FAULT_JIRA` in src/harness-fault.js) — `jiraFaultStatus` reads it without
 * decrementing, so there is no counter to watch fall. The non-consumption evidence is
 * therefore a BYTE COMPARE of the row before and after the non-admin call, plus the
 * refusal shape itself; this driver says that in as many words rather than claiming a
 * counter it does not have.
 *
 * READ-ONLY on src/ and static/. It never deploys. Everything it writes — console line
 * and evidence file alike — goes through `redactSecrets`/`redactString` from
 * lib/redact.mjs, so emails land as `<initial>***@<domain>` and no token, secret or dev
 * web-trigger URL can reach the terminal or the disk. The one screenshot goes through
 * `shotMasked` from lib/roster-ui.mjs — the SINGLE home of the pixel mask (F-660/F-665).
 * It rewrites every `.perm-ident-email` to the same `<initial>***@<domain>` shape
 * `redact.mjs` produces, ASSERTS in the DOM that no readable address survives, and
 * REFUSES the capture if one does. This driver does not carry a second mask, and it does
 * not choose a search row its own way: `selectByDiscriminator` is the one home of that.
 *
 * CLEANUP IS PART OF THE PROOF. The lever is disarmed in a `finally`, and the last
 * check is a `readJiraFault` that must answer `value:null`.
 *
 * SHARED DEV TENANT (F-686). This driver used to be dev-ONLY with no acknowledgement at
 * all, while arming the same 429 that blanks the Permissions people picker for everyone
 * else on the site. `--env` now exists and defaults to `staging`; `--env=dev` needs
 * `--i-know-dev-is-shared` (lib/shared-env-guard.mjs is the one home of that refusal).
 *
 *   node scripts/user-search-fault-live.mjs [--env=staging|dev] [--i-know-dev-is-shared]
 *     [--nonadmin=<accountId>] [--envid=<forge env id>] [--headed]
 * ═══════════════════════════════════════════════════════════════════════════════ */
import fs from "node:fs";
import { requireEnv } from "../lib/env.mjs";
// F-686 — this driver had NO `--env` and NO acknowledgement: dev was its only mode, and it
// hardcoded `env:"development"` into its own evidence. Both now come from the one home.
import { requireEnvAck } from "../lib/shared-env-guard.mjs";
import { redactString, redactSecrets } from "../lib/redact.mjs";
import { makeShot } from "../lib/roster-ui.mjs";
import { selectByDiscriminator } from "../lib/roster-restore.mjs";

/* F-686 — `--env` now EXISTS here and defaults to `staging`, and the dev tenant needs
 * `--i-know-dev-is-shared`. The longest window this driver arms is step 3's 240s: the UI
 * half is slower than the hook half and holds the 429 across a Permissions-tab keystroke
 * sequence, so that — not the 60s of step 1 — is the number the operator is shown. */
const { envName: ENV_NAME, hookUrl: HOOK_URL, envId: ENV_ID_DEFAULT } = requireEnvAck(process.argv.slice(2), {
  faults: ["jiraUserSearch"],
  mutates: [],   /* checkIsAdmin and searchUsers are reads; nothing is written */
  maxSeconds: 240,
  script: "user-search-fault-live.mjs",
});
const SECRET = requireEnv("HARNESS_SECRET");
const ADMIN = requireEnv("HARNESS_ADMIN_ACCOUNT_ID");
const arg = (n, d) => { const h = process.argv.slice(2).find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
/** An account with NO app role (`checkIsAdmin` -> role:null) — asserted, never assumed. */
const NONADMIN = arg("nonadmin", "557058:653160a5-6112-470d-baea-333ac760364e");
const QUERY = arg("query", "mihai");
const PATH = "/rest/api/3/user/search";
const FAULT_STATUS = 429;

const BASE = "https://wolfaenpak.atlassian.net";
const APP = "36415848-6868-4697-9554-3c3ad87b8da9";
/* F-686 — the Forge environment id FOLLOWS `--env` now. A hardcoded dev id under a
 * staging default would point the browser half at the tenant the guard just refused. */
const ENV_ID = arg("envid", ENV_ID_DEFAULT);
const PROFILE = "/Users/mihaiperdum/Projects/forge-live-harness/.auth/profile";
const OUT = new URL("../results/user-search-fault", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passes = 0, fails = 0, unproven = 0;
/* F-686 — the evidence records the environment it RAN in, not the one the driver used to
 * be able to reach. `env:"development"` was a literal here while `--env` did not exist. */
const ev = { at: new Date().toISOString(), env: ENV_NAME, path: PATH, status: FAULT_STATUS, query: QUERY, checks: [] };

/* ── THE WRITERS. Every payload and every sentence through the shared redactor, at the
 *    console AND at the file boundary (F-646/F-652) — never a per-call-site judgement. */
const R = (d) => redactSecrets(d);
const J = (d) => JSON.stringify(R(d));
const say = (v, s, d) => { ev.checks.push({ v, s: redactString(String(s)), ...(d ? { d: R(d) } : {}) }); console.log(`  ${v.padEnd(5)} ${redactString(String(s))}${d ? " " + J(d) : ""}`); };
const PASS = (s, d) => { passes++; say("PASS", s, d); };
const FAIL = (s, d) => { fails++; say("FAIL", s, d); };
const NV = (s, d) => { unproven++; say("N/V", s, d); };

/* F-668 — the capture's answer is RECORDED, never discarded, and `strict` is the default:
   a readable address ABORTS rather than reaching disk. `makeShot` is the one home of that
   recording, so no call site here carries a `.catch(() => {})` or a `strict` flag.

   F-689 — AND THE SUCCESSFUL CAPTURE GETS A WRITER TOO. This binding used to be a bare
   N/V function, which `makeShot` reads as "this driver offered no PASS writer" — so a
   capture that actually HAPPENED was recorded nowhere, and the `{total, masked, readable}`
   numbers that ARE the F-660 DOM assertion never reached `evidence.json`. The three
   verdicts are distinct and all three are written: PASS for a capture taken, N/V for one
   that could not be, FAIL for one REFUSED because a readable address survived the mask.
   The driver no longer writes its own "captured" PASS — that would double-count the one
   `makeShot` now emits, from the same numbers. */
const shot_ = makeShot({ pass: PASS, nv: NV, fail: FAIL });
const info = (s) => console.log(`        ${redactString(String(s))}`);
const step = (s) => console.log(`\n── ${s}`);

const readRes = async (res) => { let t = ""; try { t = await res.text(); } catch { return { status: 0, json: null }; } let j = null; try { j = JSON.parse(t); } catch {} return { status: res.status, json: j, text: t }; };
async function hook(body, method = "POST", qs = "") {
  return readRes(await fetch(HOOK_URL + qs, { method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + SECRET }, body: method === "POST" ? JSON.stringify(body) : undefined }));
}
const invoke = (functionKey, payload = {}, accountId = ADMIN) => hook({ action: "invokeResolver", functionKey, payload, accountId });
const arm = (ttlSeconds) => hook({ action: "armJiraFault", path: PATH, status: FAULT_STATUS, ttlSeconds });
const readFault = () => hook({ action: "readJiraFault", path: PATH });
const disarm = () => hook({ action: "disarmJiraFault", path: PATH });
/** The stored row, or null. `{status, armedAt}` — a WINDOW, with no counter by design. */
const faultRow = async () => (await readFault()).json?.value ?? null;

/* ── THE UI HALF ─────────────────────────────────────────────────────────────────── */
async function withAdminPanel(fn) {
  const { chromium } = await import("../../static/_screenshot-harness/node_modules/playwright/index.mjs");
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: !process.argv.includes("--headed"), viewport: { width: 1500, height: 1100 } });
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
    await frame.locator(".tab-btn", { hasText: /^\s*Permissions\s*$/ }).click();
    await frame.locator(".perm-search-input").waitFor({ state: "visible", timeout: 60000 });
    return await fn(page, frame);
  } finally { await ctx.close(); }
}

/**
 * What the search area says right now. The notices are the direct `div` children of
 * `.perm-search-wrap` that are NOT the input row and NOT the results list, so COUNTING
 * them is exactly the stacked-vs-replaced question.
 */
async function readSearchArea(frame) {
  return frame.evaluate(() => {
    const wrap = document.querySelector(".perm-search-wrap");
    if (!wrap) return { notices: [], rows: 0, text: "" };
    const notices = [...wrap.children]
      .filter((el) => el.tagName === "DIV" && !el.querySelector(".perm-search-input") && !el.classList.contains("perm-search-results"))
      .map((el) => el.innerText.trim())
      .filter(Boolean);
    return {
      notices,
      rows: wrap.querySelectorAll(".perm-search-item").length,
      text: wrap.innerText.trim(),
    };
  });
}

/** Type `q` fresh (clear first), let the 400 ms debounce + the invoke settle. */
async function typeSearch(frame, q, settleMs = 5000) {
  const box = frame.locator(".perm-search-input");
  await box.fill("");
  await sleep(700);
  await box.fill(q);
  await sleep(settleMs);
  return readSearchArea(frame);
}


/* ═════════════════════════════════════════════════════════════════════════════════ */
async function main() {
  console.log("F-648/F-655 LIVE — searchUsers under a planted Jira transport fault");
  info(`path ${PATH}  status ${FAULT_STATUS}  query "${QUERY}"`);

  /* ── 0. PRECONDITIONS. Prove the query CAN see the users before any negative is
   *      allowed to mean anything, and prove the chosen non-admin really has no role. */
  step("0. preconditions (positive control + principal roles)");
  await disarm();
  const before = await faultRow();
  if (before === null) PASS("no fault armed at start", { row: null });
  else FAIL("a fault row was already present at start", { row: before });

  const clean = await invoke("searchUsers", { query: QUERY });
  const cleanUsers = clean.json?.users || [];
  const baselineIds = cleanUsers.map((u) => u.accountId).sort();
  if (clean.json?.success === true && cleanUsers.length >= 1) {
    PASS(`positive control: the admin's search sees ${cleanUsers.length} user(s) with no fault armed`, { users: cleanUsers.map((u) => ({ accountId: u.accountId, displayName: u.displayName, ...(u.emailAddress ? { emailAddress: u.emailAddress } : {}) })) });
  } else {
    FAIL("positive control failed — the clean search returned nothing, so no later empty/error result can be attributed to the lever", { answer: clean.json });
  }

  const adminRole = await invoke("checkIsAdmin", {}, ADMIN);
  if (adminRole.json?.isAdmin === true) PASS("the ADMIN principal is an app admin", { role: adminRole.json.role, accountId: ADMIN });
  else FAIL("the ADMIN principal is not an app admin — check (1) would prove nothing", { answer: adminRole.json });

  const naRole = await invoke("checkIsAdmin", {}, NONADMIN);
  if (naRole.json?.isAdmin === false && naRole.json?.role === null && !naRole.json?.unknown) {
    PASS("the NON-ADMIN principal has role:null (confirmed via checkIsAdmin, not assumed)", { accountId: NONADMIN, role: naRole.json.role, isAdmin: naRole.json.isAdmin });
  } else {
    FAIL("the NON-ADMIN principal is not role:null — check (2) would be about the wrong principal", { answer: naRole.json });
  }

  /* ── 1. ADMIN + fault armed -> fail CLOSED ───────────────────────────────────── */
  step("1. ADMIN with the fault armed → jira_unavailable, no users");
  const armed = await arm(60);
  if (armed.status === 200 && armed.json?.status === FAULT_STATUS) PASS("fault armed", { path: armed.json.path, status: armed.json.status, ttlSeconds: armed.json.ttlSeconds });
  else FAIL("arming the fault failed", { status: armed.status, body: armed.json });
  const rowArmed = await faultRow();
  if (rowArmed && rowArmed.status === FAULT_STATUS) PASS("second read: the fault row is stored", { row: rowArmed });
  else FAIL("second read: no fault row after arming", { row: rowArmed });

  const a = await invoke("searchUsers", { query: QUERY });
  const ab = a.json || {};
  const okShape = ab.success === false && ab.reason === "jira_unavailable" && ab.status === FAULT_STATUS && Array.isArray(ab.users) && ab.users.length === 0;
  if (okShape) PASS("ADMIN: {success:false, reason:'jira_unavailable', status:429} and zero users", { success: ab.success, reason: ab.reason, status: ab.status, users: ab.users.length, error: ab.error });
  else FAIL("ADMIN: the answer is not the fail-closed shape", { answer: ab });
  if (typeof ab.error === "string" && /HTTP 429/.test(ab.error)) PASS("the sentence names the HTTP status the admin must act on", { error: ab.error });
  else FAIL("the error sentence does not name HTTP 429", { error: ab.error });

  /* ── 2. NON-ADMIN + fault armed -> the GATE runs FIRST ───────────────────────── */
  step("2. NON-ADMIN with the fault armed → the no-permission refusal (gate before fault)");
  const rowPre = await faultRow();
  const n = (await invoke("searchUsers", { query: QUERY }, NONADMIN)).json || {};
  const isRefusal = n.success === false && (n.reason === "no-permission" || n.needsRole === "admin");
  if (isRefusal && n.reason !== "jira_unavailable") {
    PASS("NON-ADMIN: the admin gate answers FIRST — the refusal shape, not the transport failure", { success: n.success, reason: n.reason, needsRole: n.needsRole, users: (n.users || []).length, error: n.error });
  } else {
    FAIL("NON-ADMIN: the answer is not the admin-gate refusal", { answer: n });
  }
  const rowPost = await faultRow();
  if (rowPre && rowPost && JSON.stringify(rowPre) === JSON.stringify(rowPost)) {
    PASS("second read: the fault row is byte-identical after the refused call. NOTE — this lever is a WINDOW, not a COUNT: the row carries {status, armedAt} and NO counter, and `jiraFaultStatus` never decrements, so 'not consumed' can only be shown as an unchanged row plus the refusal shape above, never as a counter that did not fall", { before: rowPre, after: rowPost });
  } else {
    FAIL("second read: the fault row changed across the refused call", { before: rowPre, after: rowPost });
  }

  /* ── 3. THE PERMISSIONS TAB, as the signed-in admin ──────────────────────────── */
  step("3. the Permissions tab with the fault armed → the backend sentence, replaced not stacked");
  await arm(240); // the UI half is slower than the hook half; same clamp, same lever.
  let shotPath = null;
  try {
    await withAdminPanel(async (page, frame) => {
      const first = await typeSearch(frame, QUERY);
      const joined = first.notices.join(" | ");
      if (/HTTP 429/.test(joined)) PASS("the tab renders the BACKEND sentence naming HTTP 429", { notices: first.notices });
      else FAIL("the tab does not show the HTTP 429 sentence", { notices: first.notices, text: first.text.slice(0, 300) });
      if (!/No users found/i.test(joined)) PASS("the tab does NOT say 'No users found' — the failure is not dressed as an empty directory", { notices: first.notices });
      else FAIL("the tab still says 'No users found' under a transport failure (the F-648 defect)", { notices: first.notices });
      if (first.rows === 0) PASS("no user rows are offered under the failure", { rows: first.rows });
      else FAIL("user rows were rendered under a failed search", { rows: first.rows });

      /* F-665 — THE ONE MASK, AND IT REFUSES. This driver used to roll its own: a
         `frame.evaluate` that overwrote every email span with a constant `***@masked`,
         `.catch(() => {})`-ed its own failure, and then CAPTURED ANYWAY. That is the
         exact artefact F-660 exists to prevent, re-committed in the driver that ships
         beside F-660's fix — and it tripped F-660's own offline scan, so the range
         shipped a RED suite. `shotMasked` is the single home: it writes the same
         `<initial>***@<domain>` shape `lib/redact.mjs` produces (so the PNG and the JSON
         beside it say the same thing), ASSERTS in the DOM that nothing readable is left,
         and with `strict` it THROWS rather than capture a leak. The throw lands in this
         step's `catch`, which records N/V — a refused capture is reported, never silent.
         (The old mask also targeted `.perm-search-email`, a class the product does not
         render: it was masking nothing on half its selector.) */
      const shot = await shot_(page, frame, `${OUT}/search-error-429.png`);
      shotPath = shot.captured ? shot.path : null;

      // Replaced, not stacked: three more keystroke-driven searches in a row.
      const seq = [];
      for (const q of [`${QUERY}a`, `${QUERY}ab`, QUERY]) seq.push({ q, ...(await typeSearch(frame, q, 4000)) });
      const worst = Math.max(...seq.map((s) => s.notices.length));
      const allNamed = seq.every((s) => /HTTP 429/.test(s.notices.join(" | ")));
      if (worst === 1 && allNamed) PASS("across 3 further searches the notice is REPLACED, never stacked (exactly 1 notice each time, each naming HTTP 429)", { counts: seq.map((s) => ({ q: s.q, notices: s.notices.length })) });
      else if (worst === 1) FAIL("one notice each time, but not every one named the status", { seq: seq.map((s) => ({ q: s.q, notices: s.notices })) });
      else FAIL("notices STACKED across keystrokes", { counts: seq.map((s) => ({ q: s.q, notices: s.notices.length })), seq: seq.map((s) => s.notices) });
    });
    if (shotPath) info(`screenshot (email spans masked in the DOM first, via lib/roster-ui.mjs#shotMasked): ${shotPath}`);
  } catch (e) {
    NV("the Permissions tab could not be driven", { error: String(e && e.message || e) });
  }

  /* ── 4. DISARM -> the real result set returns ────────────────────────────────── */
  step("4. disarm → the same search returns the real users; readJiraFault → null");
  const d = await disarm();
  if (d.status === 200) PASS("disarm accepted", { disarmed: d.json?.disarmed === true });
  else FAIL("disarm was refused", { status: d.status, body: d.json });
  const afterRow = await faultRow();
  if (afterRow === null) PASS("second read: readJiraFault → null", { row: null });
  else FAIL("second read: a fault row survived the disarm", { row: afterRow });

  const back = (await invoke("searchUsers", { query: QUERY })).json || {};
  const backIds = (back.users || []).map((u) => u.accountId).sort();
  if (back.success === true && backIds.length === baselineIds.length && backIds.join(",") === baselineIds.join(",")) {
    PASS(`the same search returns the same ${backIds.length} namesake(s) as the positive control`, { users: (back.users || []).map((u) => ({ accountId: u.accountId, displayName: u.displayName, ...(u.emailAddress ? { emailAddress: u.emailAddress } : {}) })) });
  } else {
    FAIL("after disarm the search does not match the baseline", { baseline: baselineIds, now: backIds, answer: back });
  }

  /* THE UI POSITIVE CONTROL FOR STEP 3's ZERO. Step 3 asserted `rows === 0` under the
     fault. An empty list is not evidence until the same locator, in the same tab, has
     been shown to see rows AT ALL — so the count is repeated here with the lever down,
     and the ADMIN's own row is identified by its DISCRIMINATOR (F-647/F-654: never by
     the display name, which three accounts on this tenant share). `selectByDiscriminator`
     is the one home of that choice — this driver does not get its own idea of which row
     is which, which is the defect F-657 recorded. The admin is already on the roster, so
     its row renders DISABLED; `disabledHit` is a positive identification, not a miss. */
  try {
    await withAdminPanel(async (page, frame) => {
      const area = await typeSearch(frame, QUERY);
      if (area.rows > 0) PASS(`positive control in the TAB: the same locator that read 0 rows under the fault now reads ${area.rows}`, { rows: area.rows, notices: area.notices });
      else FAIL("the tab shows no rows even with the lever down — step 3's zero proves nothing", { rows: area.rows, notices: area.notices, text: area.text.slice(0, 300) });

      const rows = await frame.evaluate(() => [...document.querySelectorAll(".perm-search-item")].map((el, i) => {
        const id = el.querySelector(".perm-ident-id");
        return { i, disabled: el.className.includes("perm-search-disabled"), idShown: id ? (id.textContent || "").trim() : null, idTitle: id ? id.getAttribute("title") : null };
      }));
      const pick = selectByDiscriminator(rows, ADMIN);
      if (pick.index >= 0 || pick.disabledHit) PASS("the ADMIN's own row is identified among the namesakes by its discriminator", { how: pick.how || "disabled-row", index: pick.index, alreadyOnRoster: !!pick.disabledHit, rows: rows.length });
      else FAIL("the ADMIN's row could not be told apart from its namesakes after recovery", { reason: pick.reason, rows: rows.length });
    });
  } catch (e) {
    NV("the recovery check could not drive the Permissions tab", { error: String(e && e.message || e) });
  }

  /* ── 5. THE TTL IS REAL ──────────────────────────────────────────────────────── */
  step("5. TTL: arm for 5 s, wait 8 s, search → real results (expiry, not the disarm call)");
  const t = await arm(5);
  if (t.json?.ttlSeconds === 5) PASS("armed with ttlSeconds:5", { ttlSeconds: t.json.ttlSeconds });
  else FAIL("the 5 s arm did not take", { body: t.json });
  const during = (await invoke("searchUsers", { query: QUERY })).json || {};
  if (during.success === false && during.reason === "jira_unavailable") PASS("inside the window the search still fails closed", { reason: during.reason, status: during.status });
  else FAIL("the short-TTL arm did not fault the search at all — the expiry below would prove nothing", { answer: during });
  /* The 8 s the brief names, then a BOUNDED poll — so an expiry that is merely LATE is
   * reported as a measured number rather than as a hang or as a flat "it never expired". */
  await sleep(8000);
  const expired = (await invoke("searchUsers", { query: QUERY })).json || {};
  const expiredIds = (expired.users || []).map((u) => u.accountId).sort();
  if (expired.success === true && expiredIds.join(",") === baselineIds.join(",")) {
    PASS("after 8 s the window has EXPIRED with no disarm call — the search returns the baseline users", { users: expiredIds.length });
  } else {
    FAIL("the fault outlived its 5 s TTL: at 8 s the search still fails closed with no disarm call", { answer: expired });
    const t0 = Date.now();
    let gone = false;
    while (Date.now() - t0 < 90000) {
      await sleep(10000);
      if ((await faultRow()) === null) { gone = true; break; }
    }
    const waited = Math.round((Date.now() - t0) / 1000) + 8;
    if (gone) NV(`the row DID expire, but late: ~${waited}s after a 5 s TTL. The TTL is real and coarse, not a bound a test can lean on`, { ttlSeconds: 5, observedSeconds: waited });
    else FAIL(`the row is STILL readable and the fault STILL active ${waited}s after a 5 s TTL — on this build the only thing that ends a lever is the explicit disarm, so "a forgotten arm must not outlive the test" (src/harness-fault.js) is not enforced by the TTL. Separately measured on an isolated arm: still present at 615s, past both the 300s clamp and the 10-minute HARNESS_FAULT_TTL`, { ttlSeconds: 5, observedSeconds: waited, note: "expireTime metadata is not readable through the hook's ?what=kvs (storage.get only), so 'TTL was never applied' vs 'applied but not enforced on read' is NOT distinguishable from outside src/" });
  }
  const ttlRow = await faultRow();
  if (ttlRow === null) PASS("second read: the expired row is gone", { row: null });
  else FAIL("second read: an expired fault row is still readable", { row: ttlRow });
}

let exitCode = 0;
try {
  await main();
} catch (e) {
  FAIL("driver threw", { error: String(e && e.message || e) });
} finally {
  /* CLEANUP IS PART OF THE PROOF: never leave a lever armed on a live tenant. */
  await disarm().catch(() => {});
  const finalRow = await faultRow().catch(() => "unreadable");
  if (finalRow === null) PASS("cleanup: no fault row remains", { row: null });
  else FAIL("cleanup: a fault row remains armed", { row: finalRow });

  /* F-689 — THE CAPTURE RECORD IS EVIDENCE, AND A LEAK FAILS THE RUN ON ITS OWN.
     Without `ev.shots` the F-660 DOM assertion lives only in a variable nobody kept, and
     "no PNG in this directory is unmasked" could only be ARGUED from the absence of a
     throw. Here that argument is especially weak: the only capture this driver takes sits
     inside a `try` whose `catch` records N/V and carries on, so a PII refusal became an
     "the Permissions tab could not be driven" sentence in a run that still exited 0. The
     leak check below is therefore at RUN level, not at the call site, and it names the
     refused PNG paths so the operator knows which artefacts to destroy. */
  ev.shots = shot_.shots;
  const leaks = shot_.shots.filter((s) => s.readable > 0);
  if (shot_.leaked) {
    FAIL("a screenshot capture was REFUSED because a readable email address survived the mask - the F-660 guarantee fired and this run FAILS on it regardless of the fault-lever verdicts", { paths: leaks.map((s) => s.path), leaks });
  }
  ev.summary = { passes, fails, unproven, shots: shot_.shots.length, captured: shot_.shots.filter((s) => s.captured).length, leaks: leaks.length };
  const file = `${OUT}/evidence.json`;
  fs.writeFileSync(file, JSON.stringify(redactSecrets(ev), null, 2));
  console.log(`\nPASS ${passes}  FAIL ${fails}  N/V ${unproven}`);
  console.log(`evidence: ${file}`);
  exitCode = fails > 0 ? 1 : 0;
}
process.exit(exitCode);
