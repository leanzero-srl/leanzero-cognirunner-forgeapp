/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * F-660 — THE SCREENSHOT MASK, ON A FAKE DOM.
 *
 * The defect is a PNG: `lib/redact.mjs` masks every email that reaches a terminal or a
 * file, and the same drivers then captured the Permissions tab as PIXELS, where the
 * address is legible and no text scan will ever see it. The mask that fixes it runs INSIDE
 * the page, so it cannot import anything — it is a source string, which is exactly the
 * shape that rots silently.
 *
 * So the source string is exported and executed here against a hand-rolled DOM:
 *   1. it produces the SAME mask `lib/redact.mjs#maskEmail` does — one shape, two runtimes;
 *   2. it reports `readable > 0` when a span it cannot mask still renders an address,
 *      which is the signal `shotMasked` turns into a refusal to capture;
 *   3. it is idempotent, and `restoreMaskedEmails` puts the real text back byte-for-byte;
 *   4. it does NOT touch `.perm-ident-id` — the discriminator the screenshots exist to
 *      prove is not PII and must stay legible.
 *
 * Run: node scripts/roster-ui.test.mjs (auto-discovered by run-offline.mjs)
 */

import { MASK_EMAILS_SRC, RESTORE_EMAILS_SRC, shotMasked, makeShot, makeRosterUI } from "../lib/roster-ui.mjs";
import { maskEmail } from "../lib/redact.mjs";
import { idTail } from "../lib/roster-restore.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

/* ── a DOM small enough to read, faithful enough to run the real source against ── */
function makeEl(cls, text, title) {
  const attrs = title === undefined ? {} : { title };
  return {
    className: cls,
    textContent: text,
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; },
    setAttribute(k, v) { attrs[k] = String(v); },
    removeAttribute(k) { delete attrs[k]; },
    _attrs: attrs,
  };
}
function makeDom(els) {
  return {
    querySelectorAll(sel) {
      if (sel.startsWith("[") && sel.endsWith("]")) {
        const name = sel.slice(1, -1);
        return els.filter((e) => e.getAttribute(name) !== null);
      }
      const cls = sel.slice(1);
      return els.filter((e) => e.className.split(/\s+/).includes(cls));
    },
  };
}
/* The real source strings, executed. `document` is the only global they touch. */
const run = (src, dom) => new Function("document", "return " + src)(dom);

/* ── 1. the same mask, in both runtimes ────────────────────────────────────────── */
{
  const addresses = [
    "mihai@wolfaenpak.com",
    "mihai.perdum+contractor2025@wolfaenpak.com",
    "o'brien@tenant.com",
    "x@y.co",
  ];
  const els = addresses.map((a) => makeEl("perm-ident perm-ident-email", a, a));
  const dom = makeDom(els);
  const r = run(MASK_EMAILS_SRC, dom);
  ok(r.total === addresses.length && r.masked === addresses.length, `every email span is masked (got ${JSON.stringify(r)})`);
  ok(r.readable === 0, "…and nothing readable is left, which is what licenses the capture");
  for (let i = 0; i < addresses.length; i++) {
    ok(els[i].textContent === maskEmail(addresses[i]),
      `the in-page mask agrees with lib/redact.mjs#maskEmail for ${addresses[i].slice(0, 10)}… (got ${els[i].textContent})`);
    ok(!els[i].textContent.includes(addresses[i]), "…and the original address is not a substring of the result");
    ok(els[i].getAttribute("title") === maskEmail(addresses[i]), "…the `title` attribute is masked too — a tooltip is pixels as well");
  }
  ok(els[0].textContent.endsWith("@wolfaenpak.com"),
    "the DOMAIN survives, for the same reason it does in the JSON: the namesake proof needs it");
}

/* ── 2. POSITIVE CONTROL — an unmaskable span REFUSES the capture ───────────────
   `readable` is the whole safety property. If it can never be non-zero, `shotMasked`
   is decoration. A span whose address is not the whole text (a stray label around it)
   still ends masked; a span the mask is BLIND to — a different class — must be seen as
   readable, or the assertion is vacuous. Here the blind spot is simulated by leaving an
   element in place whose text the mask pass cannot rewrite. */
{
  const stubborn = makeEl("perm-ident perm-ident-email", "leak@tenant.com");
  /* textContent is read-only on this one: the mask writes, the value does not change —
     precisely the failure mode a silent mask would hide. */
  Object.defineProperty(stubborn, "textContent", { get: () => "leak@tenant.com", set: () => {}, configurable: true });
  const r = run(MASK_EMAILS_SRC, makeDom([stubborn]));
  ok(r.readable === 1, `POSITIVE CONTROL: a span the mask could not rewrite is reported as READABLE (got ${JSON.stringify(r)})`);
}

/* ── 3. idempotence, and the undo ──────────────────────────────────────────────── */
{
  const RAW = "mihai.perdum+contractor2025@wolfaenpak.com";
  const el = makeEl("perm-ident perm-ident-email", RAW, RAW);
  const dom = makeDom([el]);
  run(MASK_EMAILS_SRC, dom);
  const once = el.textContent;
  const second = run(MASK_EMAILS_SRC, dom);
  ok(el.textContent === once && second.masked === 0, "a second mask pass is a no-op — the mask is idempotent");
  ok(el.getAttribute("data-cr-raw-email") === RAW, "…and the raw value is stashed exactly once, for the undo");

  const back = run(RESTORE_EMAILS_SRC, dom);
  ok(back.restored === 1 && el.textContent === RAW, "restoreMaskedEmails puts the real text back byte-for-byte");
  ok(el.getAttribute("title") === RAW, "…including the title");
  ok(el.getAttribute("data-cr-raw-email") === null, "…and clears its own bookkeeping, so a later mask starts clean");
  ok(run(RESTORE_EMAILS_SRC, dom).restored === 0, "a second undo is a no-op");
}

/* ── 4. the id chip is NOT touched ─────────────────────────────────────────────── */
{
  const FULL = "557058:653160a5-6112-470d-baea-333ac760364e";
  const chip = makeEl("perm-ident perm-ident-id", "653160a5-6112-470d-baea-333ac760364e", FULL);
  const email = makeEl("perm-ident perm-ident-email", "mihai@wolfaenpak.com", "mihai@wolfaenpak.com");
  run(MASK_EMAILS_SRC, makeDom([chip, email]));
  ok(chip.textContent === "653160a5-6112-470d-baea-333ac760364e" && chip.getAttribute("title") === FULL,
    "the account-id chip is untouched — it is the discriminator the screenshot exists to prove, and it is not PII");
  ok(email.textContent === maskEmail("mihai@wolfaenpak.com"), "…while the email beside it is masked");
}

/* ── 5. shotMasked REFUSES rather than capturing a leak ─────────────────────────── */
{
  const frameOf = (result) => ({ evaluate: async () => result });
  let shots = 0;
  const page = { screenshot: async () => { shots++; } };

  const clean = await shotMasked(page, frameOf({ total: 2, masked: 2, readable: 0 }), "/tmp/cr-x.png");
  ok(clean.captured === true && shots === 1, "a clean page IS captured");

  shots = 0;
  let threw = null;
  try { await shotMasked(page, frameOf({ total: 2, masked: 1, readable: 1 }), "/tmp/cr-y.png"); }
  catch (e) { threw = String(e.message); }
  ok(threw !== null && shots === 0, "a readable address ABORTS the capture — no file is written at all");
  ok(/readable address/.test(String(threw)), `…and the error says why (got: ${threw})`);

  shots = 0;
  const soft = await shotMasked(page, frameOf({ total: 1, masked: 0, readable: 1 }), "/tmp/cr-z.png", { strict: false });
  ok(soft.captured === false && shots === 0 && /readable address/.test(soft.reason),
    "…and the non-strict form still refuses; it only declines to take the run down with it");

  shots = 0;
  const blind = await shotMasked(page, { evaluate: async () => { throw new Error("frame detached"); } }, "/tmp/cr-w.png", { strict: false });
  ok(blind.captured === false && shots === 0 && /could not run/.test(blind.reason),
    "a mask that could not RUN is a refusal too — an unknown page is not a safe page");
}

/* ── 6. F-668 — makeShot RECORDS the answer, and still lets a LEAK abort ────────── */
{
  const frameOf = (result) => ({ evaluate: async () => result });
  let shots = 0;
  const page = { screenshot: async () => { shots++; } };
  const okPage = { screenshot: async () => { shots++; throw new Error("ENOSPC"); } };

  /* The happy path is SILENT: a captured shot is not an N/V. */
  const noted = [];
  const shot = makeShot((s, d) => noted.push({ s, d }));
  const good = await shot(page, frameOf({ total: 2, masked: 2, readable: 0 }), "/tmp/cr-a.png");
  ok(good.captured === true && noted.length === 0, "a captured shot records NOTHING — makeShot is not a narrator");

  /* The failure that is NOT a leak: the mask passed, the shutter failed. Recorded, and
     the run carries on — this is the case the nine `.catch(() => {})`s were hiding. */
  shots = 0;
  const failed = await shot(okPage, frameOf({ total: 1, masked: 1, readable: 0 }), "/tmp/cr-b.png");
  ok(failed.captured === false, "a shutter failure is reported as captured:false, not as success");
  ok(noted.length === 1 && /was not captured/.test(noted[0].s) && /cr-b\.png/.test(noted[0].s),
    "…and it is RECORDED through the driver's own writer, naming the file");
  ok(noted[0].d && typeof noted[0].d.reason === "string" && noted[0].d.reason.length > 0,
    "…with a reason, so the missing PNG is never a silent hole");

  /* THE GUARANTEE THAT MUST NOT SOFTEN. makeShot takes the strict default, so a readable
     address still THROWS out of the caller — it is not downgraded to a recorded note. */
  shots = 0;
  let threw = null;
  try { await shot(page, frameOf({ total: 2, masked: 0, readable: 2 }), "/tmp/cr-c.png"); }
  catch (e) { threw = String(e.message); }
  ok(threw !== null && shots === 0, "a LEAK still ABORTS through makeShot — recording did not soften the refusal");
  ok(/readable address/.test(String(threw)), "…and it aborts for the stated reason");

  /* No writer at all must not crash the driver that forgot to pass one. */
  const bare = makeShot();
  const r = await bare(okPage, frameOf({ total: 0, masked: 0, readable: 0 }), "/tmp/cr-d.png");
  ok(r.captured === false, "makeShot() with no writer still answers; the result rides out on the return value");
}

/* ── 7. F-666 — THE ADMIN GRANT, AND A RESTORE THAT FINISHES ────────────────────
   Two defects, one function each, and NEITHER is visible unless `makeRosterUI` is
   actually DRIVEN. So below is a fake Playwright frame — faithful to the selectors
   `lib/roster-ui.mjs` uses, and to the one product fact that broke it: PermissionsTab
   renders the scope `CustomSelect` behind `{addRole !== "admin" && (`, so choosing Admin
   UNMOUNTS it and `nth(1).click()` has nothing to click. Live that hung to the Playwright
   timeout and threw out of `restoreRosterToSnapshot`, past every remaining repair — after
   the `changed` path had ALREADY removed a real site admin. `rosterRowRole` makes every
   legacy roster row an admin, so that was the common shape, not the edge. */
{
  const scopeLabel = (role, scope) => (role === "admin" ? "All rules (always)" : (scope === "all" ? "All rules" : "Own rules only"));
  const DIR = [
    { accountId: "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa", displayName: "Ann Namesake" },
    { accountId: "bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb", displayName: "Bob Namesake" },
    { accountId: "cccccccc-3333-4ccc-8ccc-cccccccccccc", displayName: "Cid Namesake" },
  ];
  /* The visible id CHIP is the last dash-segment; `idTail` (what the library labels an
     action with) is the ARI tail, which for a bare uuid is the whole string. Both are
     used below, and they are deliberately not the same function. */
  const chip = (id) => String(id).split("-").pop();

  function makeFakeUI(opts = {}) {
    const st = {
      roster: (opts.roster || []).map((r) => ({ ...r })),
      role: "viewer", scope: "own", open: null, query: "",
      clicks: [], scopeDropdownClicks: 0, shots: 0, pendingRemove: null,
      forceScopeControl: opts.forceScopeControl === true,
      throwFor: opts.throwFor || null,
      /* F-671 — the product moved or renamed `scopeLabel`'s wrapper, so the card still
         renders but `.perm-admin-role` no longer matches anything on it. */
      noRoleClass: opts.noRoleClass === true,
      roleClassReads: 0,
    };
    /* THE PRODUCT FACT THE DEFECT TURNED ON. */
    const dropdownCount = () => (st.forceScopeControl ? 2 : (st.role === "admin" ? 1 : 2));

    const node = (o) => ({
      async getAttribute(k) { return o.attrs && k in o.attrs ? o.attrs[k] : null; },
      async innerText() { return o.text || ""; },
      async count() { return o.count === undefined ? 1 : o.count; },
      async click() { if (o.onClick) await o.onClick(); },
      async waitFor() {},
      async fill(v) { if (o.onFill) await o.onFill(v); },
      first() { return node(o); },
      nth(i) { return o.nth ? o.nth(i) : node(o); },
      locator(sel, op) { return o.locator ? o.locator(sel, op) : frame.locator(sel, op); },
    });

    const searchRows = () => (!st.query ? [] : DIR.filter((u) =>
      u.displayName.toLowerCase().includes(String(st.query).toLowerCase()) || u.accountId.includes(st.query)));

    const rowNode = (u) => node({
      attrs: { class: st.roster.some((r) => r.accountId === u.accountId) ? "perm-search-item perm-search-disabled" : "perm-search-item" },
      onClick: async () => {
        const eff = st.role === "admin" ? "all" : st.scope;   // PermissionsTab#handleAdd
        st.clicks.push({ accountId: u.accountId, role: st.role, scope: eff });
        st.roster.push({ accountId: u.accountId, displayName: u.displayName, role: st.role, scope: eff });
      },
      locator: (sel) => (sel === ".perm-ident-id"
        ? node({ count: 1, text: chip(u.accountId), attrs: { title: u.accountId } })
        : node({ count: 0 })),
    });
    const cardNode = (r) => node({
      attrs: { class: "perm-admin-card" },
      locator: (sel) => {
        if (sel === ".perm-ident-id") return node({ count: 1, text: chip(r.accountId), attrs: { title: r.accountId } });
        if (sel === ".perm-admin-role") { st.roleClassReads++; return node({ count: st.noRoleClass ? 0 : 1, text: st.noRoleClass ? "" : scopeLabel(r.role, r.scope) }); }
        if (sel === ".perm-remove-btn") return node({ onClick: async () => { st.pendingRemove = r.accountId; } });
        return node({ count: 0 });
      },
    });

    const frame = {
      /* The mask pass is proven against a real DOM in block 1; here it only has to
         ANSWER, so the captures in grantRole/removeAccount behave as they do live. */
      async evaluate(src) { return /\brestored\b/.test(src) ? { restored: 0 } : { total: 0, masked: 0, readable: 0 }; },
      locator(sel, op) {
        const has = op && op.hasText;
        if (sel === ".perm-search-wrap .dropdown") {
          return node({ count: dropdownCount(), nth: (i) => node({ onClick: async () => {
            /* THE HANG, FAITHFULLY. Playwright does not no-op on a missing element: it
               waits and then THROWS a timeout. `nth(1)` when Admin has unmounted the scope
               select is exactly that, and it is the whole of F-666's first half. */
            if (i >= dropdownCount()) throw new Error("locator.click: Timeout 30000ms exceeded waiting for locator('.perm-search-wrap .dropdown').nth(1)");
            st.open = i === 0 ? "role" : "scope";
            if (i === 1) st.scopeDropdownClicks++;
          } }) });
        }
        if (sel === ".dropdown-item-name") {
          return node({ onClick: async () => {
            if (st.open === "role") { for (const [v, label] of [["viewer", "Viewer"], ["editor", "Editor"], ["admin", "Admin"]]) if (has.test(label)) st.role = v; }
            else st.scope = has.test("All Rules") ? "all" : "own";
          } });
        }
        if (sel === ".perm-search-input") {
          return node({ onFill: async (v) => {
            if (st.throwFor && v && String(v).includes(st.throwFor)) throw new Error("locator.click: Timeout 30000ms exceeded");
            st.query = v;
          } });
        }
        if (sel === ".perm-search-item") { const rs = searchRows(); return node({ count: rs.length, nth: (i) => rowNode(rs[i]) }); }
        if (sel === ".perm-admin-card") { const rs = st.roster; return node({ count: rs.length, nth: (i) => cardNode(rs[i]) }); }
        if (sel === ".cr-confirm-actions button") return node({ onClick: async () => { st.roster = st.roster.filter((r) => r.accountId !== st.pendingRemove); st.pendingRemove = null; } });
        return node({ count: 1 });
      },
    };
    const page = { screenshot: async () => { st.shots++; } };
    return { st, deps: { withAdminPanel: async (fn) => fn(page, frame), rosterRows: async () => st.roster.map((r) => ({ ...r })), out: "/tmp/cr-f666" } };
  }

  /* 7a. THE HANG ITSELF. An admin grant must not touch the scope dropdown at all. */
  {
    const { st, deps } = makeFakeUI();
    const ui = makeRosterUI(deps);
    const r = await ui.grantRole(DIR[0].accountId, "admin", "all", ["Ann"]);
    ok(r.ok === true, `an ADMIN grant SUCCEEDS instead of hanging on a control that is not rendered (got ${JSON.stringify(r.reason || r.ok)})`);
    ok(st.scopeDropdownClicks === 0, "…because the scope dropdown is never clicked for Admin — that click is the hang");
    ok(st.clicks.length === 1 && st.clicks[0].accountId === DIR[0].accountId && st.clicks[0].role === "admin" && st.clicks[0].scope === "all",
      "…and the row stored is the TARGET, admin, scope all (the scope the product forces, not one this helper typed)");
    ok(r.card === "All rules (always)", `…and the CARD is read back and says so (got ${JSON.stringify(r.card)})`);
    ok(r.cardAgrees === true, "…and the card agrees with the stored row");
  }

  /* 7b. THE NON-ADMIN PATH IS UNCHANGED — the fix must not become "never set a scope". */
  {
    const { st, deps } = makeFakeUI();
    const ui = makeRosterUI(deps);
    const r = await ui.grantRole(DIR[1].accountId, "editor", "own", ["Bob"]);
    ok(r.ok === true, "an EDITOR grant still succeeds");
    ok(st.scopeDropdownClicks === 1, "…and it DOES click the scope dropdown, which is rendered for every non-admin role");
    ok(st.clicks[0].scope === "own" && r.card === "Own rules only", "…and both the stored scope and the card read 'own'");
  }

  /* 7c. F-658's RULE HOLDS FOR THE NEW PATH. Admin stores "all" whatever is asked, so
     asking for "own" is a REFUSAL — never a click that quietly stores something else. */
  {
    const { st, deps } = makeFakeUI();
    const r = await makeRosterUI(deps).grantRole(DIR[0].accountId, "admin", "own", ["Ann"]);
    ok(r.ok === false && r.refused === true, "admin + scope 'own' is REFUSED, not rounded to the scope the UI would store");
    ok(st.clicks.length === 0, "…and nothing was clicked, so no wrong grant exists to clean up");
    ok(/no scope control for Admin/.test(String(r.reason)), "…and the refusal says why");
  }

  /* 7d. THE DRIFT GUARD. If PermissionsTab ever renders a scope control for Admin again,
     skipping it would silently store a default. That must be reported, not assumed away. */
  {
    const { deps } = makeFakeUI({ forceScopeControl: true });
    const r = await makeRosterUI(deps).grantRole(DIR[0].accountId, "admin", "all", ["Ann"]);
    ok(r.ok === false && /guard has changed/.test(String(r.reason)),
      "a scope control that REAPPEARS for Admin is reported as product drift, not skipped in silence");
  }

  /* 7e. F-671 — AN UNREADABLE CARD IS A FAILED READ-BACK, NEVER AGREEMENT.
     The F-666 assertion read `cardAgrees = r.card === null || r.card === wantCard`, so
     every way the read could FAIL — readRows throwing, no card matching, the class being
     absent — arrived as `true`. Move `.perm-admin-role` in PermissionsTab and the check
     disarms itself at every call site, in silence, forever: F-668's shape exactly. The
     fake DOM here renders the card and withholds only the class. */
  {
    const { st, deps } = makeFakeUI({ noRoleClass: true });
    const r = await makeRosterUI(deps).grantRole(DIR[0].accountId, "admin", "all", ["Ann"]);
    ok(r.ok === true, "the GRANT itself still succeeds — the storage read is the authority and it is unaffected");
    ok(r.card === null, "…the card could not be read");
    ok(r.cardAgrees === false, "…and that is a FAILURE of the read-back, not agreement");
    ok(/could not be read back/.test(String(r.cardMismatch)) && /perm-admin-role/.test(String(r.cardMismatch)),
      `…and the mismatch carries cardHow as the reason, naming the class that moved (got ${JSON.stringify(r.cardMismatch)})`);
    ok(r.cardUnreadable === true, "…flagged distinctly from a card that read a WRONG label");
    ok(st.roleClassReads >= 2, `…and the read was RETRIED once after a settle before it was called a failure (attempts: ${st.roleClassReads})`);

    /* NEGATIVE CONTROL BY REVERT: the predicate this finding removed, run on this very
       answer. It says the card agrees — which is the defect, and the proof this case
       could not have passed before the fix. */
    const revertedPredicate = (card, wantCard) => card === null || card === wantCard;
    ok(revertedPredicate(r.card, "All rules (always)") === true,
      "NEGATIVE CONTROL: the old `card === null || …` predicate calls this same unreadable card AGREEING");
  }

  /* 7f. F-671's RETRY MUST NOT BECOME A SECOND READ FOR EVERYONE. A readable card is
     answered on the first attempt, so the 1.2s settle is paid only by the failure path. */
  {
    const { st, deps } = makeFakeUI();
    const r = await makeRosterUI(deps).grantRole(DIR[1].accountId, "editor", "own", ["Bob"]);
    ok(r.cardAgrees === true && r.card === "Own rules only", "a card that reads cleanly still agrees");
    ok(st.roleClassReads === 1, `…on ONE read, with no retry (attempts: ${st.roleClassReads})`);
  }

  /* 7e. THE RESTORE FINISHES. Ann is `changed`, Bob is `missing`, Cid is `missing`, and
     the repair of Bob THROWS. Before F-666 that throw left the function entirely: Cid was
     never attempted, and Ann — already REMOVED by the `changed` path — stayed deleted. */
  {
    const snapshot = [
      { accountId: DIR[0].accountId, displayName: "Ann Namesake", role: "admin", scope: "all" },
      { accountId: DIR[1].accountId, displayName: "Bob Namesake", role: "editor", scope: "own" },
      { accountId: DIR[2].accountId, displayName: "Cid Namesake", role: "editor", scope: "all" },
    ];
    const live = [{ accountId: DIR[0].accountId, displayName: "Ann Namesake", role: "editor", scope: "own" }];
    const { st, deps } = makeFakeUI({ roster: live, throwFor: "Bob" });
    let threw = null;
    let res = null;
    try { res = await makeRosterUI(deps).restoreRosterToSnapshot(snapshot); }
    catch (e) { threw = String(e.message); }
    ok(threw === null, `restoreRosterToSnapshot does NOT throw out on a failed repair (got: ${threw})`);
    ok(res && res.ok === false, "…it reports the restore as FAILED, because one row genuinely could not be put back");

    const ids = st.roster.map((r) => r.accountId);
    ok(ids.includes(DIR[0].accountId), "Ann — the `changed` row the repair REMOVED first — is back on the roster, not left deleted");
    const ann = st.roster.find((r) => r.accountId === DIR[0].accountId);
    ok(ann && ann.role === "admin" && ann.scope === "all", `…re-granted as the ADMIN she was, through the path that used to hang (got ${JSON.stringify(ann)})`);
    ok(ids.includes(DIR[2].accountId), "Cid — queued AFTER the row that threw — was still attempted and is back");
    ok(!ids.includes(DIR[1].accountId), "Bob, whose repair threw, is the one row genuinely missing");

    const acts = (res ? res.actions : []).map((a) => a.act + ":" + a.id);
    ok(acts.some((a) => a.startsWith("readd-changed")), "the actions record the changed repair");
    ok(acts.some((a) => a === "readd-missing:" + idTail(DIR[2].accountId)), "…and the repair that came after the throw");
    ok(Array.isArray(res.failures) && res.failures.length >= 1, "…and every failure is collected, not just the first");
    ok(res.failures.every((f) => f.id === idTail(DIR[1].accountId)),
      "…and ONLY the row that genuinely failed is listed — the repairs that worked are not tarred with it");
  }

  /* 7f. THE EXACT LIVE HARM. The row that throws is the CHANGED one, whose repair has
     already REMOVED it. Before F-666 that throw left `restoreRosterToSnapshot` entirely,
     so the removed admin stayed deleted AND the two rows queued behind it were never even
     attempted. The removal is not recoverable here (the repair throws on every pass) —
     what must be true is that the damage STOPS THERE and is REPORTED, instead of taking
     the other two rows down with it. */
  {
    const snapshot = [
      { accountId: DIR[0].accountId, displayName: "Ann Namesake", role: "admin", scope: "all" },
      { accountId: DIR[1].accountId, displayName: "Bob Namesake", role: "editor", scope: "own" },
      { accountId: DIR[2].accountId, displayName: "Cid Namesake", role: "editor", scope: "all" },
    ];
    const live = [{ accountId: DIR[0].accountId, displayName: "Ann Namesake", role: "editor", scope: "own" }];
    const { st, deps } = makeFakeUI({ roster: live, throwFor: "Ann" });
    let threw = null, res = null;
    try { res = await makeRosterUI(deps).restoreRosterToSnapshot(snapshot); }
    catch (e) { threw = String(e.message); }
    ok(threw === null, `a throw in the CHANGED repair does not escape the restore (got: ${threw})`);

    const ids = st.roster.map((r) => r.accountId);
    ok(!ids.includes(DIR[0].accountId), "Ann is genuinely gone — the remove landed and the re-grant could not run, which is real damage");
    ok(ids.includes(DIR[1].accountId) && ids.includes(DIR[2].accountId),
      "…but Bob and Cid, queued BEHIND her, were still attempted and are both back — the damage stopped at one row");
    ok(res.ok === false && Array.isArray(res.failures) && res.failures.some((f) => f.id === idTail(DIR[0].accountId)),
      "…and the verdict FAILS, naming Ann, so the operator is told exactly which row to restore by hand");
    ok(res.failures.every((f) => f.id === idTail(DIR[0].accountId)),
      "…and ONLY Ann is listed: Bob and Cid succeeded and are not tarred with her failure");
    ok(res.failures.some((f) => /Timeout/.test(String(f.reason))),
      "…with the reason the repair gave, not a bare 'restore failed'");
  }
}

console.log(`roster-ui.test.mjs: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
