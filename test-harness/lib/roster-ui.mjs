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
   */
  async function grantRole(accountId, role, scope, queries) {
    if (!ROLE_LABEL[role] || !SCOPE_LABEL[scope]) {
      return { ok: false, refused: true, reason: "refusing to click a default for role=" + JSON.stringify(role) + " scope=" + JSON.stringify(scope) + " - the UI cannot express it" };
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
        await frame.locator(".perm-search-wrap .dropdown").nth(1).click();
        await frame.locator(".dropdown-item-name", { hasText: SCOPE_LABEL[scope] }).first().click();
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
        return { clicked: true, rows: rows.length, how: pick.how, index: pick.index, shot: grantShot };
      });
      if (r.disabledHit) return { ok: true, alreadyPresent: true, query: q };
      if (r.clicked) {
        /* SECOND READ: the product's own storage, not the click's return value. */
        const row = (await rosterRows()).find((x) => rosterIdOf(x) === accountId);
        if (row && row.role === role && (row.scope === scope || scope === undefined)) return { ok: true, how: r.how, index: r.index, query: q, shot: r.shot };
        return { ok: false, reason: "the click landed but the roster row is " + JSON.stringify(row ? { role: row.role, scope: row.scope } : null) };
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
   */
  async function restoreRosterToSnapshot(snapshot) {
    const actions = [];
    for (let pass = 0; pass < 4; pass++) {
      const plan = planRosterRestore(snapshot, await rosterRows());
      if (plan.clean) return { ok: true, actions, verdict: "byte-identical" };
      /* Strays first: a wrong grant is the thing that must not survive this process. */
      for (const r of plan.strays) {
        const id = rosterIdOf(r);
        actions.push({ act: "remove-stray", id: idTail(id), ...(await removeAccount(id)) });
      }
      /* A changed row goes back by removing it and re-granting the role the PRODUCT reads
         off the snapshot row (F-658), and is REFUSED if the UI cannot express it. */
      for (const c of plan.changed) {
        const repro = isReproducibleRosterRow(c.before);
        if (!repro.ok) { actions.push({ act: "readd-changed", id: idTail(c.accountId), ok: false, refused: true, reason: repro.reason }); continue; }
        const r1 = await removeAccount(c.accountId);
        actions.push({ act: "remove-changed", id: idTail(c.accountId), ...r1 });
        if (r1.removed) {
          const r2 = await grantRole(c.accountId, repro.role, repro.scope, [c.before.displayName, c.before.emailAddress].filter(Boolean));
          actions.push({ act: "readd-changed", id: idTail(c.accountId), ok: !!r2.ok, role: repro.role, scope: repro.scope, reason: r2.reason });
        }
      }
      for (const r of plan.missing) {
        const id = rosterIdOf(r);
        const repro = isReproducibleRosterRow(r);
        if (!repro.ok) { actions.push({ act: "readd-missing", id: idTail(id), ok: false, refused: true, reason: repro.reason }); continue; }
        const g = await grantRole(id, repro.role, repro.scope, [r.displayName, r.emailAddress].filter(Boolean));
        actions.push({ act: "readd-missing", id: idTail(id), ok: !!g.ok, role: repro.role, scope: repro.scope, reason: g.reason });
      }
      if (plan.sameSet) break;   // F-659 - order only; no click can fix it, and it is a pass
    }
    const v = rosterRestoreVerdict(snapshot, await rosterRows());
    return { ok: v.ok, actions, verdict: v.verdict, ...(v.info ? { info: v.info } : {}), plan: describePlan(v.plan) };
  }

  return { readRows, grantRole, removeAccount, restoreRosterToSnapshot, rosterIds };
}
