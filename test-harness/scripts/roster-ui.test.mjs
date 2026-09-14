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

/* ── 6. F-668/F-681 — makeShot RECORDS EVERY capture, and still lets a LEAK abort ── */
{
  const frameOf = (result) => ({ evaluate: async () => result });
  let shots = 0;
  const page = { screenshot: async () => { shots++; } };
  const okPage = { screenshot: async () => { shots++; throw new Error("ENOSPC"); } };

  /* F-681 — THE SUCCESSFUL CAPTURE IS THE ONE THAT CARRIES THE PROOF, AND IT IS RECORDED
     WITH ITS NUMBERS. This is the branch F-668's fix left silent: `{total, masked,
     readable}` IS the F-660 DOM assertion, and before this it existed only in a return
     value every caller dropped. */
  const wrote = { pass: [], nv: [], fail: [] };
  const W = {
    pass: (s, d) => wrote.pass.push({ s, d }),
    nv: (s, d) => wrote.nv.push({ s, d }),
    fail: (s, d) => wrote.fail.push({ s, d }),
  };
  const shotW = makeShot(W);
  const cap = await shotW(page, frameOf({ total: 3, masked: 2, readable: 0 }), "/tmp/cr-p.png");
  ok(cap.captured === true && wrote.pass.length === 1 && wrote.nv.length === 0 && wrote.fail.length === 0,
    "F-681: a SUCCESSFUL capture is recorded, through the PASS writer — not silence, and not an N/V");
  ok(/cr-p\.png/.test(wrote.pass[0].s), "…and the record names the PNG it is about");
  ok(wrote.pass[0].d && wrote.pass[0].d.total === 3 && wrote.pass[0].d.masked === 2
    && wrote.pass[0].d.readable === 0 && wrote.pass[0].d.captured === true,
    `…and carries the mask's NUMBERS, which are the F-660 assertion itself (got: ${JSON.stringify(wrote.pass[0].d)})`);
  ok(shotW.shots.length === 1 && shotW.shots[0].path === "/tmp/cr-p.png" && shotW.shots[0].captured === true,
    "…and the same record lands on the binding's ledger, so a driver folds ONE array into its evidence");
  ok(shotW.leaked === false && shotW.leaks.length === 0, "…and a clean capture leaves the leak flag down");

  /* THE LEAK IS A FAIL, WRITTEN BEFORE THE THROW LEAVES makeShot — so no seam downstream
     can re-label it. It is NOT an N/V: a missing artefact and a PII refusal are different
     verdicts, and F-681 is exactly the case where the second wore the first's clothes. */
  shots = 0;
  let leakThrew = null;
  try { await shotW(page, frameOf({ total: 4, masked: 1, readable: 3 }), "/tmp/cr-q.png"); }
  catch (e) { leakThrew = e; }
  ok(leakThrew !== null && shots === 0, "F-681: a LEAK still ABORTS — recording did not soften the refusal");
  ok(wrote.fail.length === 1 && /REFUSED/.test(wrote.fail[0].s) && /cr-q\.png/.test(wrote.fail[0].s),
    "…and it is recorded as a FAIL, naming the PNG, through the driver's FAIL writer");
  ok(wrote.fail[0].d && wrote.fail[0].d.readable === 3 && wrote.fail[0].d.spans === 4,
    `…with the counts that justify the refusal (got: ${JSON.stringify(wrote.fail[0].d)})`);
  ok(wrote.nv.length === 0, "…and NOT as an N/V — a PII refusal is a failure, not an unproven");
  ok(shotW.leaked === true && shotW.leaks.length === 1 && shotW.leaks[0].path === "/tmp/cr-q.png",
    "…and the binding's leak flag is up, set SYNCHRONOUSLY so it survives a caller that swallows the throw");
  ok(leakThrew.leak === true && leakThrew.shotPath === "/tmp/cr-q.png",
    "…and the ERROR itself is tagged `leak` with its path, so a catcher need not parse English");

  /* A mask that could not RUN is a different animal: it is a missing artefact (N/V), not a
     proven leak (FAIL). Without this the leak flag would fire on every detached frame. */
  const blindThrow = await shotW(page, { evaluate: async () => { throw new Error("frame detached"); } }, "/tmp/cr-r.png")
    .then(() => null, (e) => e);
  ok(blindThrow !== null && blindThrow.leak === false && blindThrow.maskUnrunnable === true,
    "a mask that could not RUN throws too, but it is not tagged as a leak");
  ok(wrote.nv.length === 1 && /was not captured/.test(wrote.nv[0].s) && wrote.fail.length === 1,
    "…and it is an N/V, not a FAIL — an unknown page is unproven, not proven to be leaking");
  ok(shotW.leaks.length === 1, "…and it does not raise the leak count");

  /* The F-668 shape still works. A single function is the N/V writer; with no PASS writer
     offered, a driver's PROOFS must not be written into its unproven column — so the
     success lands on the ledger only. */
  const noted = [];
  const shot = makeShot((s, d) => noted.push({ s, d }));
  const good = await shot(page, frameOf({ total: 2, masked: 2, readable: 0 }), "/tmp/cr-a.png");
  ok(good.captured === true && noted.length === 0,
    "the single-function (F-668) form is unchanged: with no PASS writer, a captured shot writes no check");
  ok(shot.shots.length === 1 && shot.shots[0].total === 2 && shot.shots[0].masked === 2 && shot.shots[0].captured === true,
    "…but F-681 still records it on the ledger, with its numbers — the success is never lost");

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
      maskLeaks: opts.maskLeaks === true,
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
      /* F-681 — `maskLeaks` makes the mask pass report a survivor, which is the one thing
         that must take a run down no matter which seam it happens under. */
      async evaluate(src) { return /\brestored\b/.test(src) ? { restored: 0 } : { total: 2, masked: 1, readable: st.maskLeaks ? 1 : 0 }; },
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

  /* 7h. F-681 — A LEAK UNDER `attempt()` FAILS THE RUN, EVEN ON A CLEAN ROSTER.
     `attempt` exists so one broken repair cannot cancel the rest, and it converts a throw
     into an `actions[]` entry. That is right for a timeout; it is WRONG for the F-660 PII
     refusal, which is the guarantee firing. Live, `grantRole`'s and `removeAccount`'s
     captures both sit under this seam, so a readable address became a `threw` string in a
     run that ended green and byte-identical — and nothing named which PNG was refused.

     The setup is the mildest possible: ONE stray to remove, whose removal SUCCEEDS, and a
     mask that reports a survivor. The roster therefore ends byte-identical to the snapshot
     — the strongest version of the old false pass — and the restore must still FAIL. */
  {
    const snapshot = [{ accountId: DIR[0].accountId, displayName: "Ann Namesake", role: "editor", scope: "own" }];
    const live = [
      { accountId: DIR[0].accountId, displayName: "Ann Namesake", role: "editor", scope: "own" },
      { accountId: DIR[2].accountId, displayName: "Cid Namesake", role: "editor", scope: "all" },   // the stray
    ];
    const wrote = { pass: [], nv: [], fail: [] };
    const { st, deps } = makeFakeUI({ roster: live, maskLeaks: true });
    const ui = makeRosterUI({
      ...deps,
      record: { pass: (s, d) => wrote.pass.push({ s, d }), nv: (s, d) => wrote.nv.push({ s, d }), fail: (s, d) => wrote.fail.push({ s, d }) },
    });
    let threw = null, res = null;
    try { res = await ui.restoreRosterToSnapshot(snapshot); }
    catch (e) { threw = String(e.message); }

    ok(threw === null, `the leak does not crash the restore — attempt() still absorbs the throw (got: ${threw})`);
    ok(st.roster.length === 1 && st.roster[0].accountId === DIR[0].accountId,
      "the stray WAS removed, so the roster genuinely ends byte-identical to the snapshot");
    ok(res && res.verdict === "byte-identical", `…and the roster verdict says so (got ${JSON.stringify(res && res.verdict)})`);
    ok(res && res.leaked === true, "F-681: …and the restore still reports `leaked`, because a clean roster does not make a leaking PNG acceptable");
    ok(res && res.ok === false, "F-681: …and `ok` is FALSE — the run fails at the end on the leak, not on the roster diff");
    ok(res && Array.isArray(res.leaks) && res.leaks.length >= 1 && /\.png$/.test(String(res.leaks[0].path)),
      `…and the verdict NAMES the PNG that was refused (got ${JSON.stringify(res && res.leaks)})`);
    ok(!!(res && res.leaks && res.leaks[0] && res.leaks[0].readable === 1), "…with the count of addresses that survived the mask");

    ok(wrote.fail.length >= 1 && /REFUSED/.test(wrote.fail[0].s),
      "…and the refusal was written as a FAIL through the driver's own writer, BEFORE the seam saw the throw");
    ok(wrote.pass.length === 0, "…and no capture was recorded as a PASS in this run — nothing reached disk");

    const leakActions = (res ? res.actions : []).filter((a) => a.leak === true);
    ok(leakActions.length >= 1 && typeof leakActions[0].shotPath === "string",
      "…and the `attempt` entry carries `leak:true` with its path, instead of hiding as an ordinary `threw` string");
    ok(res.failures && res.failures.some((f) => f.leak === true),
      "…and the failure row carries the flag too, so a caller reading only `failures` still sees it");

    /* NEGATIVE CONTROL BY REVERT: the verdict this finding changed, computed the old way on
       this very answer. It says the restore passed — which is the defect. */
    const revertedVerdict = { ok: res.verdict === "byte-identical" };
    ok(revertedVerdict.ok === true,
      "NEGATIVE CONTROL: the pre-F-681 verdict (roster diff alone) calls this same leaking run a PASS");
  }
}

console.log(`roster-ui.test.mjs: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
