/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * F-660 — THE PII GUARANTEE HAS TO COVER PIXELS, NOT JUST TEXT.
 *
 * WHAT F-652 ACTUALLY BOUGHT. `lib/redact.mjs` learned PII, every evidence writer runs its
 * payload through it, and an offline scan refuses a roster snapshot that reaches disk
 * un-redacted. All of that is TEXT. The same drivers also write full-page SCREENSHOTS of
 * the Permissions tab, which render the same real addresses as PIXELS — and the scan never
 * opens an image, so the suite stayed green while the artefact directory filled with
 * legible email addresses.
 *
 * F-651 MADE IT STRICTLY WORSE, ON PURPOSE. The email used to ellipsise; it now wraps and
 * owns a line, so the FULL address is legible in every capture. The JSON beside the PNG
 * says `m***@<domain>`, so a reader reasonably believes the artefact set is PII-free and
 * attaches the PNG to a ledger row or a bug report.
 *
 * THE RULE. A driver does not call `page.screenshot` on the Permissions tab. It calls
 * `shotMasked`, which rewrites every `.perm-ident-email` to the same
 * `<initial>***@<domain>` mask `lib/redact.mjs` produces, VERIFIES in the DOM that no
 * readable address survives, captures, and then puts the real text back so a later read in
 * the same context still sees the truth. The id chips are untouched: they are the
 * discriminator the screenshots exist to prove, and they are not PII.
 *
 * IT RUNS ON THE FRAME, NOT THE PAGE. The admin panel is a cross-origin Custom UI iframe;
 * `page.evaluate` cannot reach into it. `shotMasked` therefore takes BOTH — the frame to
 * mask, the page to capture.
 *
 * THE SCAN THAT KEEPS IT TRUE lives in `scripts/evidence-redaction.test.mjs`: any
 * `*-live.mjs` that mentions `perm-` may not contain a raw `.screenshot(` call.
 *
 * This file is ALSO the one home of the Playwright half of the roster restore, so
 * `knowledge-doors-editor-live` and `perm-discriminator-live` drive ONE implementation of
 * "select by discriminator, click once, put the roster back by diff" rather than two that
 * drift — which is exactly what F-657 is: the F-654 defect, verbatim, in the driver that
 * was written as the proof that F-654 was fixed. The DECISIONS stay pure in
 * `lib/roster-restore.mjs`; this file is only the hands.
 */

import {
  rosterIdOf, idTail, selectByDiscriminator, planRosterRestore, rosterRestoreVerdict,
  describePlan, isReproducibleRosterRow,
} from "./roster-restore.mjs";

export const ROLE_LABEL = { viewer: /^Viewer/, editor: /^Editor/, admin: /^Admin/ };
export const SCOPE_LABEL = { own: /^Own Rules/, all: /^All Rules/ };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The mask `lib/redact.mjs#maskEmail` produces, re-expressed for the BROWSER context.
 * It is a source STRING because it is evaluated inside the page, where this module's
 * imports do not exist. `redact.mjs` stays the authority for the SHAPE; this is the one
 * place that shape is restated, and `roster-ui.test.mjs` asserts the two agree.
 */
export const BROWSER_MASK_SRC =
  '(s) => { const at = s.lastIndexOf("@"); return at > 0 && at < s.length - 1 ? s[0] + "***@" + s.slice(at + 1) : "[REDACTED]"; }';

/** The DOM-side source of the mask pass. Exported so a unit test can run it on a fake DOM. */
export const MASK_EMAILS_SRC = [
  '(() => {',
  '  const mask = ' + BROWSER_MASK_SRC + ';',
  '  const ADDR = /[^\\s@<>]+@[^\\s@<>]+\\.[^\\s@<>]+/;',
  '  const els = Array.from(document.querySelectorAll(".perm-ident-email"));',
  '  let masked = 0;',
  '  for (const el of els) {',
  '    const t = (el.textContent || "").trim();',
  '    if (t && t.indexOf("@") > 0 && t.indexOf("***@") < 0) {',
  '      if (!el.getAttribute("data-cr-raw-email")) el.setAttribute("data-cr-raw-email", t);',
  '      el.textContent = mask(t);',
  '      masked++;',
  '    }',
  '    const title = el.getAttribute("title");',
  '    if (title && title.indexOf("@") > 0 && title.indexOf("***@") < 0) {',
  '      if (!el.getAttribute("data-cr-raw-title")) el.setAttribute("data-cr-raw-title", title);',
  '      el.setAttribute("title", mask(title));',
  '    }',
  '  }',
  '  const readable = Array.from(document.querySelectorAll(".perm-ident-email"))',
  '    .filter((el) => { const t = el.textContent || ""; return ADDR.test(t) && t.indexOf("***@") < 0; }).length;',
  '  return { total: els.length, masked, readable };',
  '})()',
].join("\n");

/** The DOM-side source of the undo pass. */
export const RESTORE_EMAILS_SRC = [
  '(() => {',
  '  let restored = 0;',
  '  for (const el of Array.from(document.querySelectorAll("[data-cr-raw-email]"))) {',
  '    el.textContent = el.getAttribute("data-cr-raw-email");',
  '    el.removeAttribute("data-cr-raw-email");',
  '    restored++;',
  '  }',
  '  for (const el of Array.from(document.querySelectorAll("[data-cr-raw-title]"))) {',
  '    el.setAttribute("title", el.getAttribute("data-cr-raw-title"));',
  '    el.removeAttribute("data-cr-raw-title");',
  '  }',
  '  return { restored };',
  '})()',
].join("\n");

/**
 * Mask every `.perm-ident-email` in `frame`.
 *
 * @returns {{ total:number, masked:number, readable:number }} — `readable` is the number
 *   of spans that STILL render something shaped like an address. A caller must treat a
 *   non-zero as a refusal to capture: an assertion, not a warning.
 */
export async function maskEmailsOnPage(frame) {
  return frame.evaluate(MASK_EMAILS_SRC);
}

/** Put the real addresses back, so a later read in the same context sees the truth. */
export async function restoreMaskedEmails(frame) {
  return frame.evaluate(RESTORE_EMAILS_SRC);
}

/**
 * THE ONLY WAY A PERMISSIONS-TAB SCREENSHOT IS TAKEN. Mask, assert nothing readable is
 * left, capture, restore.
 *
 * @param opts.strict  when true (the DEFAULT, and F-668 is why it is no longer waived at
 *   any call site) a readable address ABORTS the capture and throws — a PNG that leaks is
 *   worse than a missing one, because the missing one gets noticed. `strict:false` is not
 *   used by any driver any more: it survives as the unit-testable branch, and a caller
 *   that passes it must still RECORD the `{captured:false, reason}` answer. Prefer
 *   `makeShot` below — it is the one home of that recording.
 */
export async function shotMasked(page, frame, path, opts = {}) {
  const strict = opts.strict !== false;
  const m = await maskEmailsOnPage(frame).catch((e) => ({
    total: 0, masked: 0, readable: -1, maskFailed: String((e && e.message) || e).slice(0, 120),
  }));
  if (m.readable !== 0) {
    await restoreMaskedEmails(frame).catch(() => {});
    const msg = m.readable < 0
      ? "refusing to capture " + path + ": the email mask could not run (" + m.maskFailed + ")"
      : "refusing to capture " + path + ": " + m.readable + " email span(s) still render a readable address";
    if (strict) throw new Error(msg);
    return { path, ...m, captured: false, reason: msg };
  }
  let captured = true;
  await page.screenshot({ path }).catch(() => { captured = false; });
  await restoreMaskedEmails(frame).catch(() => {});
  return { path, total: m.total, masked: m.masked, readable: m.readable, captured };
}

/**
 * THE ONE HOME OF "A CAPTURE THAT DID NOT HAPPEN IS RECORDED".
 *
 * F-668 — THE GUARANTEE WAS ARMED AT ZERO CALL SITES. `strict` defaulted to true, and
 * every one of the nine live call sites passed `{ strict: false }` and then wrote
 * `.catch(() => {})` around the call, throwing the answer away. So the branch that
 * REFUSES a leaking capture never ran anywhere, and the branch that reports WHY a capture
 * is missing had no reader: the run stayed green, the PNG was silently absent, and
 * nothing in the evidence said why — while this file's own docblock told a reader the
 * answer "should be recorded".
 *
 * Fixing the nine sites one at a time would schedule the tenth. This wrapper is the fix:
 * a driver hands it its own N/V writer ONCE, and every capture in that driver is then
 * recorded on failure, with no `.catch` to remember to omit and no `strict` to remember
 * to set. A LEAK still throws out — that is the F-660 promise, and softening it is not
 * this function's job.
 *
 * @param record  the driver's N/V writer, `(sentence, detail) => void`.
 */
export function makeShot(record) {
  const note = typeof record === "function" ? record : () => {};
  return async function shot(page, frame, path, opts = {}) {
    const r = await shotMasked(page, frame, path, opts);
    if (!r.captured) {
      note("a screenshot was not captured: " + path, {
        reason: r.reason || "page.screenshot() failed (the mask itself passed: nothing readable was left)",
        readable: r.readable, spans: r.total, masked: r.masked,
      });
    }
    return r;
  };
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * THE ROSTER, THROUGH THE PERMISSIONS TAB — ONE IMPLEMENTATION.
 *
 * `makeRosterUI` takes the driver's own plumbing and returns the operations both
 * permission drivers need.
 *
 * @param deps.withAdminPanel  (fn(page, frame)) => result — opens the panel, closes it
 * @param deps.rosterRows      () => the raw `app_admins` array, straight from KVS
 * @param deps.out             the results directory screenshots are written to
 * @param deps.record          (F-668) the driver's N/V writer. Its captures are recorded
 *   through it exactly as the driver's own are; omitted, the answer still rides out on
 *   the returned `shot` field, which `restoreRosterToSnapshot` folds into `actions`.
 * ═══════════════════════════════════════════════════════════════════════════════ */
export function makeRosterUI({ withAdminPanel, rosterRows, out, record }) {
  const rosterIds = async () => (await rosterRows()).map(rosterIdOf);
  const shot = makeShot(record);

  /** Every search row / roster card with its discriminator — read in the SAME context. */
  async function readRows(frame, sel) {
    const rows = frame.locator(sel);
    const n = await rows.count();
    const list = [];
    for (let i = 0; i < n; i++) {
      const r = rows.nth(i);
      const idEl = r.locator(".perm-ident-id");
      const hasId = (await idEl.count()) > 0;
      list.push({
        i,
        disabled: ((await r.getAttribute("class")) || "").includes("perm-search-disabled"),
        idShown: hasId ? (await idEl.first().innerText()).trim() : null,
        idTitle: hasId ? await idEl.first().getAttribute("title") : null,
      });
    }
    return list;
  }

  /**
   * Grant `{role, scope}` to `accountId` — by DISCRIMINATOR, in ONE context.
   *
   * F-657 — THE READ AND THE CLICK ARE THE SAME CONTEXT, AND THE TITLE IS RE-READ
   * IMMEDIATELY BEFORE THE CLICK. `perm-discriminator-live.mjs` used to choose an INDEX in
   * one `launchPersistentContext`, close it, open another, re-run the search and click
   * `nth(index)` — a fresh invocation of Jira's user search whose order that same file's
   * docblock says is not stable. Three site accounts read "Mihai Perdum", so a reorder
   * between the two searches puts a REAL `{editor, own}` grant on a stranger; and because
   * the target was then absent from the roster, the driver's `if (granted)` restore removed
   * NOTHING and the stray survived the run.
   *
   * F-658 — a role or scope the UI cannot express is REFUSED, never rounded to a label.
   *
   * F-666 — ADMIN HAS NO SCOPE CONTROL, SO THERE IS NOTHING TO CLICK. PermissionsTab
   * renders the scope `CustomSelect` behind `{addRole !== "admin" && (` and forces
   * `effectiveScope = "all"` itself, so the moment Admin is chosen the second `.dropdown`
   * UNMOUNTS. `nth(1).click()` then had no element, hung to the Playwright timeout and
   * THREW — out of `grantRole`, out of `restoreRosterToSnapshot`, past every remaining
   * repair. That is not an edge: `rosterRowRole` makes every LEGACY roster row (a bare
   * accountId string, or an object with no `role`) an admin, and `isReproducibleRosterRow`
   * declares admin reproducible — so the common shape is the one that could not be put
   * back. And the `changed` path removes BEFORE it re-grants, so the throw left a real
   * site admin deleted from `app_admins` with no second pass coming.
   *
   * So: for admin the scope dropdown is SKIPPED, and `all` is the only scope that may be
   * asked for (anything else is a refusal, not a silent rounding — F-658's rule).
   */
  async function grantRole(accountId, role, scope, queries) {
    const adminGrant = role === "admin";
    if (!ROLE_LABEL[role] || (!adminGrant && !SCOPE_LABEL[scope])) {
      return { ok: false, refused: true, reason: "refusing to click a default for role=" + JSON.stringify(role) + " scope=" + JSON.stringify(scope) + " - the UI cannot express it" };
    }
    if (adminGrant && scope !== undefined && scope !== "all") {
      return { ok: false, refused: true, reason: "refusing to grant admin with scope=" + JSON.stringify(scope) + " - the UI renders no scope control for Admin and stores \"all\"; asking for anything else cannot be expressed" };
    }
    const qs = (queries && queries.length ? queries : ["Mihai"]).concat([idTail(accountId)]);
    let lastReason = null;
    for (const q of qs) {
      const r = await withAdminPanel(async (page, frame) => {
        await frame.locator(".tab-btn", { hasText: /^\s*Permissions\s*$/ }).click();
        await frame.locator(".perm-search-input").waitFor({ state: "visible", timeout: 60000 });
        await frame.locator(".perm-search-wrap .dropdown").nth(0).click();
        await frame.locator(".dropdown-item-name", { hasText: ROLE_LABEL[role] }).first().click();
        await sleep(500);
        if (adminGrant) {
          /* F-666 — the scope select is GONE now that Admin is selected. Prove that, rather
             than assume it: a second `.dropdown` here would mean the product changed and
             this branch is silently skipping a real control. */
          const scopeControls = await frame.locator(".perm-search-wrap .dropdown").count();
          if (scopeControls !== 1) {
            return { clicked: false, rows: 0, reason: "expected the scope control to unmount for Admin, but the search row carries " + scopeControls + " dropdown(s) - PermissionsTab's `addRole !== \"admin\"` guard has changed and grantRole's admin path is now wrong" };
          }
        } else {
          await frame.locator(".perm-search-wrap .dropdown").nth(1).click();
          await frame.locator(".dropdown-item-name", { hasText: SCOPE_LABEL[scope] }).first().click();
        }
        await sleep(400);
        await frame.locator(".perm-search-input").fill(q);
        await sleep(4500);
        const rows = await readRows(frame, ".perm-search-item");
        const pick = selectByDiscriminator(rows, accountId);
        if (pick.index < 0) return { clicked: false, rows: rows.length, reason: pick.reason, disabledHit: !!pick.disabledHit };

        /* THE LAST READ BEFORE THE CLICK. The rows above were read one locator at a time;
           this re-reads the chosen row's FULL id from the live DOM and refuses on any
           disagreement, so a re-render between the read and the click cannot move the
           grant onto a namesake. */
        const target = frame.locator(".perm-search-item").nth(pick.index);
        const idEl = target.locator(".perm-ident-id");
        const confirmCount = await idEl.count();
        const confirmTitle = confirmCount > 0 ? await idEl.first().getAttribute("title") : null;
        const confirmShown = confirmCount > 0 ? (await idEl.first().innerText()).trim() : null;
        if (!(confirmTitle === accountId || (confirmTitle === null && confirmShown === idTail(accountId)))) {
          return { clicked: false, rows: rows.length, raced: true, reason: "the row at index " + pick.index + " no longer carries the target id when re-read immediately before the click (chip: " + (confirmShown || "absent") + ") - refusing to click" };
        }
        await target.click();
        await sleep(4500);
        const grantShot = await shot(page, frame, out + "/02-roster-granted.png");

        /* F-666 — READ THE CARD THE GRANT PRODUCED, by the same discriminator. The storage
           read below is the authority, but it cannot tell an operator whether the UI AGREES
           with it; for admin in particular the whole point is that the card renders its
           scope as "All rules (always)" with no control beside it. `.perm-admin-role` is
           `scopeLabel(role, scope)` — the one sentence the product shows for this row. */
        /* F-671 — AN UNREADABLE CARD IS A FAILED READ, AND THE READ NAMES WHICH FAILURE.
           `card` used to come back `null` for three unrelated reasons — `readRows` threw,
           no card matched the discriminator, or `.perm-admin-role` was absent — and the
           caller below then treated every one of them as AGREEMENT. The read now reports
           its own failure, and it gets ONE retry after a settle: the first attempt follows
           a bare sleep with no wait-for, so a slow render must not read as a regression. */
        const readCard = async () => {
          const cards = await readRows(frame, ".perm-admin-card").catch((e) => ({ readFailed: String((e && e.message) || e).slice(0, 120) }));
          if (!Array.isArray(cards)) return { card: null, how: "the roster card list could not be read (" + cards.readFailed + ")" };
          const cardPick = selectByDiscriminator(cards, accountId, { allowDisabled: true });
          if (cardPick.index < 0) return { card: null, how: "no roster card matched the target by its discriminator among " + cards.length + " card(s): " + (cardPick.reason || "no reason given") };
          const roleEl = frame.locator(".perm-admin-card").nth(cardPick.index).locator(".perm-admin-role");
          if ((await roleEl.count()) === 0) return { card: null, how: "the matched card renders no `.perm-admin-role` element - PermissionsTab's scopeLabel markup has moved or been renamed" };
          return { card: (await roleEl.first().innerText()).trim(), how: cardPick.how || cardPick.reason };
        };
        let cardRead = await readCard();
        if (cardRead.card === null) {
          await sleep(1200);
          const again = await readCard();
          cardRead = again.card === null
            ? { card: null, how: again.how + " (still, after a 1.2s settle and a second read)" }
            : { card: again.card, how: (again.how || "") + " (read only on the second attempt, after a settle)" };
        }
        return { clicked: true, rows: rows.length, how: pick.how, index: pick.index, shot: grantShot, card: cardRead.card, cardHow: cardRead.how };
      });
      if (r.disabledHit) return { ok: true, alreadyPresent: true, query: q };
      if (r.clicked) {
        /* SECOND READ: the product's own storage, not the click's return value. For admin
           the stored scope is "all" whatever the caller passed — PermissionsTab forces it
           (`effectiveScope = addRole === "admin" ? "all" : addScope`), so that, not the
           argument, is what the row must equal. */
        const wantScope = adminGrant ? "all" : scope;
        const row = (await rosterRows()).find((x) => rosterIdOf(x) === accountId);
        if (row && row.role === role && (row.scope === wantScope || wantScope === undefined)) {
          /* F-666 — the CARD must agree with the store. `scopeLabel` says "All rules
             (always)" for admin, "All rules"/"Own rules only" otherwise. A disagreement is
             reported, not swallowed: it means the grant landed but the UI shows something
             else, which is exactly what an operator reading a screenshot would be misled by. */
          const wantCard = role === "admin" ? "All rules (always)" : (wantScope === "all" ? "All rules" : "Own rules only");
          /* F-671 — A CARD THAT COULD NOT BE READ IS NOT A CARD THAT AGREES. `r.card === null`
             used to satisfy this assertion outright, so moving or renaming `.perm-admin-role`
             would have disarmed the F-666 check at every call site, in silence and forever —
             F-668's shape, one commit later. An unreadable card FAILS the read-back, and
             `cardHow` is the reason it gives. The stored row above remains the authority for
             `ok`: this assertion is about whether the UI can be SHOWN to agree with it. */
          const cardAgrees = r.card === wantCard;
          const cardMismatch = r.card === null
            ? "the roster card could not be read back, so the UI cannot be shown to agree with the stored row " + JSON.stringify({ role: row.role, scope: row.scope }) + " (expected the card to read " + JSON.stringify(wantCard) + "): " + (r.cardHow || "no reason given")
            : "the roster card reads " + JSON.stringify(r.card) + " but the stored row is " + JSON.stringify({ role: row.role, scope: row.scope }) + " (expected the card to read " + JSON.stringify(wantCard) + ")";
          return { ok: true, how: r.how, index: r.index, query: q, shot: r.shot, card: r.card, cardHow: r.cardHow, cardAgrees, ...(cardAgrees ? {} : { cardMismatch, ...(r.card === null ? { cardUnreadable: true } : {}) }) };
        }
        return { ok: false, reason: "the click landed but the roster row is " + JSON.stringify(row ? { role: row.role, scope: row.scope } : null) + " (wanted " + JSON.stringify({ role, scope: wantScope }) + ")" };
      }
      lastReason = r.reason;
      if (r.raced) return { ok: false, raced: true, reason: r.reason };
    }
    return { ok: false, notFound: true, reason: "the target row was never identified across queries " + JSON.stringify(qs) + " (last: " + lastReason + ")" };
  }

  /** Remove `accountId` by its DISCRIMINATOR, never by position. */
  async function removeAccount(accountId) {
    const r = await withAdminPanel(async (page, frame) => {
      await frame.locator(".tab-btn", { hasText: /^\s*Permissions\s*$/ }).click();
      await frame.locator(".perm-admin-card").first().waitFor({ state: "visible", timeout: 60000 });
      await sleep(1500);
      const cards = await readRows(frame, ".perm-admin-card");
      let pick = selectByDiscriminator(cards, accountId, { allowDisabled: true });
      if (pick.index < 0 && cards.every((c) => !c.idTitle && !c.idShown)) {
        /* No discriminator anywhere on this build: fall back to the KVS index, which the
           list renders in roster order. Recorded explicitly so it is never invisible. */
        const idx = (await rosterIds()).indexOf(accountId);
        if (idx >= 0 && idx < cards.length) pick = { index: idx, how: "kvs-position (no chip on this build)" };
      }
      if (pick.index < 0) return { removed: false, reason: pick.reason, cards: cards.length };
      const card = frame.locator(".perm-admin-card").nth(pick.index);
      await card.locator(".perm-remove-btn").click();
      await frame.locator(".cr-confirm").waitFor({ state: "visible", timeout: 15000 });
      await frame.locator(".cr-confirm-actions button", { hasText: /^\s*Remove\s*$/ }).first().click();
      await sleep(3500);
      const rmShot = await shot(page, frame, out + "/03-roster-restore-" + idTail(accountId).slice(0, 8) + ".png");
      return { removed: true, how: pick.how, index: pick.index, shot: rmShot };
    });
    if (!r.removed) return r;
    const gone = !(await rosterIds()).includes(accountId);   // SECOND READ
    return { removed: gone, how: r.how, index: r.index, shot: r.shot, ...(gone ? {} : { reason: "the card was clicked but the row is still in app_admins" }) };
  }

  /**
   * Make the roster identical to `snapshot` again, driven by the DIFF — so it repairs
   * damage this run never recorded causing. A driver runs this UNCONDITIONALLY in its
   * `finally`: the state that needs repairing is the state on the tenant, not the state
   * the run believes it caused.
   *
   * F-666 — ONE FAILED REPAIR MUST NOT CANCEL THE REST. Every repair here used to run
   * un-guarded, so the first `grantRole` or `removeAccount` that THREW (the admin scope
   * dropdown that is not rendered, a Playwright timeout, a detached frame) propagated
   * straight out of this function, past every remaining `changed` and `missing` row. The
   * `changed` path removes BEFORE it re-grants, so the throw left real site admins
   * DELETED from `app_admins` and no second pass ever came. A restore is the last thing
   * that runs and it is repairing damage, so it attempts EVERY row and reports ALL the
   * failures at the end — it does not stop at the first one.
   */
  async function restoreRosterToSnapshot(snapshot) {
    const actions = [];
    const failures = [];
    /* The one seam that turns a throw into a recorded failure. It never rethrows: the
       verdict below is computed from a fresh READ of the roster, so a lie here would be
       caught anyway — and a repair that crashed is exactly the thing the operator needs
       spelled out rather than replaced by a stack trace from row one. */
    const attempt = async (act, id, fn) => {
      try {
        const r = await fn();
        const entry = { act, id: idTail(id), ...r };
        actions.push(entry);
        if (r && r.ok === false) failures.push({ act, id: idTail(id), reason: r.reason || "refused" });
        if (r && r.removed === false) failures.push({ act, id: idTail(id), reason: r.reason || "not removed" });
        return entry;
      } catch (e) {
        const reason = "threw: " + String((e && e.message) || e).slice(0, 200);
        actions.push({ act, id: idTail(id), ok: false, threw: true, reason });
        failures.push({ act, id: idTail(id), reason });
        return { ok: false, threw: true, removed: false, reason };
      }
    };

    for (let pass = 0; pass < 4; pass++) {
      const plan = planRosterRestore(snapshot, await rosterRows());
      if (plan.clean) return { ok: true, actions, verdict: "byte-identical", ...(failures.length ? { failures, info: failures.length + " repair(s) failed on the way, but the roster ended byte-identical" } : {}) };
      /* Strays first: a wrong grant is the thing that must not survive this process. */
      for (const r of plan.strays) {
        const id = rosterIdOf(r);
        await attempt("remove-stray", id, () => removeAccount(id));
      }
      /* A changed row goes back by removing it and re-granting the role the PRODUCT reads
         off the snapshot row (F-658), and is REFUSED if the UI cannot express it. */
      for (const c of plan.changed) {
        const repro = isReproducibleRosterRow(c.before);
        if (!repro.ok) { actions.push({ act: "readd-changed", id: idTail(c.accountId), ok: false, refused: true, reason: repro.reason }); failures.push({ act: "readd-changed", id: idTail(c.accountId), reason: repro.reason }); continue; }
        const r1 = await attempt("remove-changed", c.accountId, () => removeAccount(c.accountId));
        if (r1.removed) {
          await attempt("readd-changed", c.accountId, async () => {
            const r2 = await grantRole(c.accountId, repro.role, repro.scope, [c.before.displayName, c.before.emailAddress].filter(Boolean));
            /* F-671 - carry the card READ-BACK verdict, not just its text: `card:null` used to
               arrive here indistinguishable from a card that agreed. */
            return { ok: !!r2.ok, role: repro.role, scope: repro.scope, reason: r2.reason, card: r2.card, cardAgrees: r2.cardAgrees, ...(r2.cardMismatch ? { cardMismatch: r2.cardMismatch } : {}) };
          });
        }
      }
      for (const r of plan.missing) {
        const id = rosterIdOf(r);
        const repro = isReproducibleRosterRow(r);
        if (!repro.ok) { actions.push({ act: "readd-missing", id: idTail(id), ok: false, refused: true, reason: repro.reason }); failures.push({ act: "readd-missing", id: idTail(id), reason: repro.reason }); continue; }
        await attempt("readd-missing", id, async () => {
          const g = await grantRole(id, repro.role, repro.scope, [r.displayName, r.emailAddress].filter(Boolean));
          return { ok: !!g.ok, role: repro.role, scope: repro.scope, reason: g.reason, card: g.card, cardAgrees: g.cardAgrees, ...(g.cardMismatch ? { cardMismatch: g.cardMismatch } : {}) };
        });
      }
      if (plan.sameSet) break;   // F-659 - order only; no click can fix it, and it is a pass
    }
    /* THE VERDICT IS A FRESH READ, NOT A TALLY OF THE ATTEMPTS. `failures` rides alongside
       it so an operator can see WHAT could not be repaired even on a run that ended
       byte-identical (a row another pass fixed), and so a failed restore names every
       broken repair rather than only the first one that threw (F-666). */
    const v = rosterRestoreVerdict(snapshot, await rosterRows());
    return { ok: v.ok, actions, verdict: v.verdict, ...(v.info ? { info: v.info } : {}), ...(failures.length ? { failures } : {}), plan: describePlan(v.plan) };
  }

  return { readRows, grantRole, removeAccount, restoreRosterToSnapshot, rosterIds };
}
