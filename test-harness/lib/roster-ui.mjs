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
 * F-731 — `removeAccount`'s TWO SETTLES HAVE ONE HOME AND ONE NAME.
 *
 * They used to be bare `sleep(1500)` / `sleep(3500)` literals buried in `removeAccount`,
 * which made them invisible to everything except a reader of that function — and
 * invisible is how they became a COST nobody could see. F-717 added an offline fixture
 * that drives `restoreRosterToSnapshot` over a roster that CANNOT be repaired, so every
 * one of the four repair passes pays both settles in real `setTimeout`s: five seconds a
 * pass, twenty seconds for one test case, inside an OFFLINE suite that is supposed to
 * finish in seconds. Naming them is what lets a fake-DOM fixture lower them — the fixture
 * has no browser to settle and no render to wait for — while a live driver keeps the
 * measured values.
 *
 * THE DEFAULTS ARE THE LIVE VALUES AND THEY DO NOT CHANGE HERE. `rosterList` is the
 * settle after the Permissions tab is opened and the first card is visible, before the
 * card list is read by discriminator; `removeConfirm` is the settle after the `.cr-confirm`
 * "Remove" click, before the restore screenshot — both are against a real admin-panel
 * iframe re-render. Lower them only where there is no render to miss; `roster-ui.test.mjs`
 * keeps one arm on the untouched default precisely so the live numbers stay proven.
 * (F-671's separate "1.2s settle and a second read" measurement lives in `grantRole` and
 * is untouched by this.)
 */
export const SETTLE_MS = Object.freeze({ rosterList: 1500, removeConfirm: 3500 });

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
    if (strict) {
      /* F-681 — THE REFUSAL IS TAGGED, SO A SEAM CANNOT LAUNDER IT INTO A STRING.
         `restoreRosterToSnapshot`'s `attempt()` deliberately converts a throw into a
         recorded failure and carries on, which is right for a repair that could not run
         and WRONG for a PII refusal: a leak became an `actions[].threw` sentence and the
         run stayed green. The error carries `leak` (true when a readable address survived
         the mask, false when the mask could not RUN at all) and the `path` it refused, so
         every catcher between here and the driver can tell the two apart without parsing
         English. */
      const err = new Error(msg);
      err.leak = m.readable > 0;
      err.maskUnrunnable = m.readable < 0;
      err.shotPath = path;
      err.shotCounts = { total: m.total, masked: m.masked, readable: m.readable };
      throw err;
    }
    return { path, ...m, captured: false, reason: msg };
  }
  let captured = true;
  await page.screenshot({ path }).catch(() => { captured = false; });
  await restoreMaskedEmails(frame).catch(() => {});
  return { path, total: m.total, masked: m.masked, readable: m.readable, captured };
}

/**
 * THE ONE HOME OF "EVERY CAPTURE IS RECORDED" — the one that happened as much as the one
 * that did not.
 *
 * F-668 — THE GUARANTEE WAS ARMED AT ZERO CALL SITES. `strict` defaulted to true, and
 * every one of the nine live call sites passed `{ strict: false }` and then wrote
 * `.catch(() => {})` around the call, throwing the answer away. So the branch that
 * REFUSES a leaking capture never ran anywhere, and the branch that reports WHY a capture
 * is missing had no reader: the run stayed green, the PNG was silently absent, and
 * nothing in the evidence said why — while this file's own docblock told a reader the
 * answer "should be recorded".
 *
 * F-681 — AND THE SUCCESS BRANCH WAS STILL SILENT, WHICH IS THE BRANCH THAT CARRIES THE
 * PROOF. F-668's fix recorded only `captured:false`; the success branch returned `r` and
 * wrote nothing, and no caller kept the `{total, masked, readable}` it returned. That
 * object IS the F-660 DOM assertion — the only record of how many addresses were on the
 * page and how many the mask took. MEASURED on dev 381199f: 13 PNGs across four drivers,
 * and exactly 3 shot records in all their `evidence.json` files — all three from
 * `removeAccount` (the one operation that carried `shot` into its result), all three
 * reading `{total:0, masked:0, readable:0}`, the roster-card view where there was nothing
 * to mask. The ONE capture that had a real address to mask
 * (`perm-discriminator/01-search-rows.png`, `{total:1, masked:1, readable:0}`) recorded
 * NOTHING. So "no PNG on this tenant is unmasked" could not be READ off the artefact set;
 * it could only be ARGUED from the absence of a throw — and that argument is not even
 * uniformly sound, because `grantRole`'s capture sits under `restoreRosterToSnapshot`'s
 * `attempt()` seam, which converts a throw into a recorded sentence and carries on, so a
 * PII refusal became an `actions[].threw` string in a green run.
 *
 * SO: EVERY call records. A capture that happened is a PASS carrying its numbers; a
 * capture that did not is an N/V carrying its reason; a capture REFUSED because a readable
 * address survived the mask is a FAIL, written HERE — before the throw leaves this
 * function — so no seam downstream can re-label it as a failed repair. A LEAK still throws
 * out on top of being recorded: recording is not a substitute for refusing, and softening
 * the refusal is not this function's job.
 *
 * @param record  the driver's writers. Either a single N/V function `(sentence, detail) =>
 *   void` (the F-668 shape — still accepted, and then a SUCCESSFUL capture is recorded only
 *   on the ledger below, because a driver that offered no PASS writer must not have its
 *   proofs written into its unproven column), or `{ pass, nv, fail }`, which is the shape
 *   that closes F-681 end to end.
 *
 * The returned function additionally carries:
 *   `shot.shots`   every `{path, total, masked, readable, captured}` this binding produced,
 *                  in order, refusals included — the machine-readable form of the record, so
 *                  a driver folds ONE array into its evidence instead of N call sites.
 *   `shot.leaks`   the subset refused for a readable address.
 *   `shot.leaked`  true once any leak has been refused. This is the flag a run fails on, and
 *                  it is set SYNCHRONOUSLY here, so it survives a caller that swallowed the
 *                  throw — which is exactly what `attempt()` does.
 */
/**
 * THE RUN-LEVEL POSITIVE CONTROL FOR THE EMAIL MASK — F-693.
 *
 * An empty result is not evidence until the query has been shown to see the thing at all.
 * Every PER-SHOT assertion in this file is of the form "nothing readable was left", and a
 * mask that matches ZERO elements satisfies that unconditionally. Rename or drop
 * `.perm-ident-email` in `static/admin-panel/src/components/PermissionsTab.jsx` and
 * `MASK_EMAILS_SRC` selects nothing on every page: every capture reports
 * `{total:0, masked:0, readable:0}`, `shot.leaked` stays false, the run goes green with a
 * HIGHER pass count than before — and every PNG on disk renders real addresses. Neither
 * `roster-ui.test.mjs` nor `evidence-redaction.test.mjs` can catch that on its own: both
 * feed the mask a stubbed result rather than proving the live page ever had a span.
 *
 * So a driver that visits a view which MUST carry an address — the user-search dropdown in
 * `perm-namesake-ui-live.mjs`, where the namesake fixture is known to render one, and in
 * `perm-discriminator-live.mjs` — calls this ONCE at the end of its run and FAILs on
 * `ok:false`. `knowledge-doors-editor-live.mjs` records it but does NOT gate on it: it never
 * opens a view that is guaranteed an address, and demanding one there buys a flake, not a
 * guarantee.
 *
 * `scripts/perm-selector-parity.test.mjs` is the OFFLINE half of the same rule — it asserts
 * every selector this file hunts for still exists verbatim in the component. The parity test
 * catches the rename before a run; this control catches everything else that can make the
 * mask match nothing: a view that stopped rendering the span, a frame that never loaded, a
 * dropdown that never opened, a tenant with no address on any visible row.
 *
 * It counts REFUSED captures too. A refusal is already a FAIL, but the question this answers
 * is "did the mask ever match anything", and a refusal measured the view exactly as a success
 * did. Counting only the happy path would be the same blindness one level down.
 *
 * @param shots  the `shot.shots` array, or the concatenation of several — `perm-discriminator`
 *   and `knowledge-doors-editor` each have two recorders and both must count toward the one
 *   control.
 */
export function maskPositiveControl(shots) {
  const list = Array.isArray(shots) ? shots : [];
  const spanTotal = list.reduce((n, s) => n + (Number(s && s.total) || 0), 0);
  const maskedTotal = list.reduce((n, s) => n + (Number(s && s.masked) || 0), 0);
  const captures = list.length;
  const ok = spanTotal > 0;
  return {
    ok, captures, spanTotal, maskedTotal,
    sentence: captures === 0
      ? "the email mask ran on NO view all run — zero captures were recorded, so nothing about the PNG set is proven"
      : (ok
        ? "the email mask matched " + spanTotal + " email span(s) across " + captures + " capture(s) this run and masked " + maskedTotal + " of them — the selector is live, so every per-shot \"nothing readable was left\" verdict means something"
        : "the mask matched nothing all run — selector drift or no email on this tenant: " + captures + " capture(s) and 0 `.perm-ident-email` span(s) seen, so every per-shot verdict in this run was vacuous"),
  };
}

export function makeShot(record) {
  const fn = (f) => (typeof f === "function" ? f : null);
  const w = typeof record === "function"
    ? { pass: null, nv: record, fail: record }
    : (record && typeof record === "object"
      ? { pass: fn(record.pass), nv: fn(record.nv) || fn(record.fail), fail: fn(record.fail) || fn(record.nv) }
      : { pass: null, nv: null, fail: null });
  const note = w.nv || (() => {});
  const bad = w.fail || note;
  const good = w.pass;

  /** The FAIL sentence and the N/V sentence, in one place, so the two branches agree. */
  const refusedSentence = (path) =>
    "a screenshot was REFUSED because a readable email address survived the mask: " + path;
  const missingSentence = (path) => "a screenshot was not captured: " + path;
  /* F-693 — THE SUCCESS SENTENCE MUST NOT CLAIM MORE THAN THE CAPTURE MEASURED.
     "captured with every email masked" was written for EVERY successful capture, including
     the ones that found nothing to mask — and when F-681 measured the artefact set, 3 of the
     3 shot records in existence read `{total:0, masked:0, readable:0}`. That sentence is how
     a selector rot reads as a guarantee: rename `.perm-ident-email` and every capture reports
     total:0, the PASS count goes UP, and every PNG on disk renders real addresses. A capture
     with nothing to mask is still a PASS — some views legitimately carry no address — but it
     now SAYS so. The guarantee is restored one level up, by `maskPositiveControl`.

     It says `total` and "none left readable" rather than "masked", because `masked` counts
     only the spans this pass REWROTE — a span already carrying the mask is not recounted, so
     "all N masked" would be wrong whenever a view was captured twice. `readable === 0` is the
     assertion that was actually made on this branch, and it is what the sentence states. */
  const capturedSentence = (path, total) => (total > 0
    ? "a Permissions-tab screenshot was captured; " + total + " email span(s) on the view, none left readable: " + path
    : "a Permissions-tab screenshot was captured; nothing to mask on this view (0 email span(s) present): " + path);

  const shot = async function shot(page, frame, path, opts = {}) {
    let r;
    try {
      r = await shotMasked(page, frame, path, opts);
    } catch (e) {
      /* THE REFUSAL IS RECORDED AT THE DRIVER, THEN RE-THROWN. Whatever `attempt()` or a
         driver-level `.catch` does with the throw afterwards, the FAIL line and the ledger
         entry already exist and `shot.leaked` is already true. */
      const counts = (e && e.shotCounts) || { total: 0, masked: 0, readable: -1 };
      const leak = !!(e && e.leak);
      const entry = {
        path, total: counts.total, masked: counts.masked, readable: counts.readable,
        captured: false, refused: true, leak,
        reason: String((e && e.message) || e).slice(0, 300),
      };
      shot.shots.push(entry);
      if (leak) {
        shot.leaks.push(entry);
        shot.leaked = true;
        bad(refusedSentence(path), { readable: entry.readable, spans: entry.total, masked: entry.masked, reason: entry.reason });
      } else {
        note(missingSentence(path), { reason: entry.reason, readable: entry.readable, spans: entry.total, masked: entry.masked });
      }
      throw e;
    }

    const entry = { path: r.path, total: r.total, masked: r.masked, readable: r.readable, captured: r.captured };
    if (r.captured) {
      /* F-681 — THE PROOF, WRITTEN DOWN. Without this line the DOM assertion that makes the
         PNG safe to attach exists only in a variable nobody kept. */
      shot.shots.push(entry);
      if (good) good(capturedSentence(path, entry.total), entry);
      return r;
    }
    /* Not captured. Two different failures, and they are not the same verdict: a readable
       address is a PII refusal (FAIL), a dead shutter is a missing artefact (N/V). This is
       the `strict:false` path — no driver takes it, and it must still agree with the throw
       path above rather than drift from it. */
    entry.refused = r.readable !== 0;
    entry.leak = r.readable > 0;
    shot.shots.push(entry);
    if (entry.leak) {
      shot.leaks.push(entry);
      shot.leaked = true;
      bad(refusedSentence(path), { readable: r.readable, spans: r.total, masked: r.masked, reason: r.reason });
    } else {
      note(missingSentence(path), {
        reason: r.reason || "page.screenshot() failed (the mask itself passed: nothing readable was left)",
        readable: r.readable, spans: r.total, masked: r.masked,
      });
    }
    return r;
  };
  shot.shots = [];
  shot.leaks = [];
  shot.leaked = false;
  /** F-693 — this recorder's own share of the run-level control. One home, two call shapes. */
  shot.positiveControl = () => maskPositiveControl(shot.shots);
  return shot;
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
 * @param deps.record          (F-668/F-681) the driver's writers — an N/V function, or
 *   `{pass, nv, fail}`. EVERY capture this module takes is recorded through them, and the
 *   whole set also rides out on `ui.shots()` / `ui.leaked()` for a driver that would rather
 *   fold one array into its evidence than read N call sites.
 *   Omitted entirely, the answer still rides out on the returned `shot` field, which
 *   `restoreRosterToSnapshot` folds into `actions`.
 * @param deps.settleMs        (F-731, TEST HOOK — omit it in every live driver) a partial
 *   override of `SETTLE_MS`, e.g. `{ rosterList: 50, removeConfirm: 50 }`. It exists so the
 *   offline fake-DOM fixtures, which have no browser render to wait for, stop paying five
 *   real seconds per repair pass. Supplying it live would be waiting less than the measured
 *   settle for a render that genuinely takes that long.
 * ═══════════════════════════════════════════════════════════════════════════════ */
export function makeRosterUI({ withAdminPanel, rosterRows, out, record, settleMs }) {
  /* F-731 — the ONE test hook for the two `removeAccount` settles. Omitted (every live
     driver), the measured defaults in `SETTLE_MS` apply unchanged; supplied, only the keys
     given are overridden, so a fixture that lowers `removeConfirm` still pays the real
     `rosterList`. Per-instance and not a module mutator: two `makeRosterUI`s in one
     process cannot silently change each other's timing. */
  const settle = { ...SETTLE_MS, ...(settleMs || {}) };
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
      await sleep(settle.rosterList);
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
      await sleep(settle.removeConfirm);
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
    /* F-681 — the leak verdict, folded into EVERY exit of this function: a capture refused
       during a repair must ride out of here whatever the roster diff says.
     *
     * F-700 — BUT IT NO LONGER OVERWRITES `ok` ON THE CLEAN PATH. It used to be spread
     * LAST over every return, including the `plan.clean` early exit, so a leak on a roster
     * that was byte-identical produced `{ ok:false, verdict:"byte-identical" }` with no
     * `failures` key at all. Both drivers then fired TWO run-level FAILs for one event, and
     * the second said "the repair did not complete cleanly" while printing
     * `verdict:"byte-identical", failures:undefined, reason:undefined` — a cause asserted
     * from a result that did not contain it. An operator reading `evidence.json` was sent
     * to inspect a roster that was fine.
     *
     * `ok` now means ONE thing: "is the roster what the snapshot says". The leak is carried
     * on `leaked`/`leaks`/`leakInfo`, which is what the drivers fail on first — `ok:false`
     * is only reached when the leak did not already explain the failure. `ownsOk` is left
     * true on the verdict path below, where `v.ok` is a real roster verdict and the leak
     * forcing it false costs no diagnosis. */
    const leakVerdict = ({ ownsOk = true } = {}) => (shot.leaked
      ? {
        ...(ownsOk ? { ok: false } : {}),
        leaked: true,
        leaks: shot.leaks.map((l) => ({ path: l.path, readable: l.readable, spans: l.total, masked: l.masked })),
        leakInfo: shot.leaks.length + " screenshot capture(s) were REFUSED because a readable email address survived the mask - "
          + "the roster state is reported separately, but this run FAILS on the F-660 guarantee",
      }
      : {});
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
        /* F-681 — A PII REFUSAL IS NOT A FAILED REPAIR, AND THIS SEAM MUST NOT FLATTEN IT
           INTO ONE. `attempt` exists to keep a broken repair from cancelling the rest, and
           that is right for a timeout or a detached frame. A capture refused because a
           readable email address survived the mask is a different animal: it is the F-660
           guarantee firing, and swallowing it turned it into an `actions[].threw` sentence
           inside a run that still ended green. The flag rides OUT on the entry, on the
           failure row, and on the return value, and the run fails on it at the end
           regardless of what the roster diff says — a byte-identical roster does not make a
           leaking screenshot acceptable. `shotMasked` tags the error; `shot.leaked` is the
           belt to this braces, set before the throw ever reached here. */
        const leak = !!(e && e.leak);
        const extra = leak ? { leak: true, shotPath: e.shotPath || null } : {};
        actions.push({ act, id: idTail(id), ok: false, threw: true, reason, ...extra });
        failures.push({ act, id: idTail(id), reason, ...extra });
        return { ok: false, threw: true, removed: false, reason, ...extra };
      }
    };

    for (let pass = 0; pass < 4; pass++) {
      const plan = planRosterRestore(snapshot, await rosterRows());
      /* F-700 — `ownsOk: false`: a byte-identical roster stays `ok:true`. The leak is still
         reported, and the driver still FAILS the run on it — but it is not dressed up as a
         broken repair on a repair that was perfect. */
      if (plan.clean) return { ok: true, actions, verdict: "byte-identical", ...(failures.length ? { failures, info: failures.length + " repair(s) failed on the way, but the roster ended byte-identical" } : {}), ...leakVerdict({ ownsOk: false }) };
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
    return { ok: v.ok, actions, verdict: v.verdict, ...(v.info ? { info: v.info } : {}), ...(failures.length ? { failures } : {}), plan: describePlan(v.plan), ...leakVerdict() };
  }

  /* F-681 — the whole capture record, for a driver that would rather fold ONE array into
     its evidence than remember to keep the return value of every `shot` call. */
  const shots = () => shot.shots.slice();
  const leaked = () => shot.leaked;

  return { readRows, grantRole, removeAccount, restoreRosterToSnapshot, rosterIds, shots, leaked };
}
