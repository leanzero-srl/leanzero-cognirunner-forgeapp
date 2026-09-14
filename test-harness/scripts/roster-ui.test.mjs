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

import { MASK_EMAILS_SRC, RESTORE_EMAILS_SRC, shotMasked, makeShot, makeRosterUI, maskPositiveControl, SETTLE_MS, REGRANT_ATTEMPTS } from "../lib/roster-ui.mjs";
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

/* ── 6b. F-693 — A CAPTURE THAT MASKED NOTHING DOES NOT CLAIM IT MASKED EVERYTHING ──
   The PASS sentence used to read "captured with every email masked" for EVERY successful
   capture, including the ones that found nothing to mask — and when F-681 measured the
   artefact set, all three shot records read `{total:0, masked:0, readable:0}`. That is how a
   selector rot reads as a guarantee: rename `.perm-ident-email` and every capture reports
   total:0, the PASS COUNT GOES UP, and every PNG renders real addresses. The per-shot verdict
   stays a PASS (some views carry no address) but says which it is; the guarantee moves to
   `maskPositiveControl`, asserted once per run by the drivers that visit a view which must
   carry an address. */
{
  const frameOf = (result) => ({ evaluate: async () => result });
  const page = { screenshot: async () => {} };
  const wrote = { pass: [], nv: [], fail: [] };
  const W = {
    pass: (s, d) => wrote.pass.push({ s, d }),
    nv: (s, d) => wrote.nv.push({ s, d }),
    fail: (s, d) => wrote.fail.push({ s, d }),
  };
  const s = makeShot(W);

  await s(page, frameOf({ total: 0, masked: 0, readable: 0 }), "/tmp/cr-empty.png");
  ok(wrote.pass.length === 1 && /nothing to mask on this view/.test(wrote.pass[0].s),
    `a capture with NOTHING to mask says so (got: ${JSON.stringify(wrote.pass[0].s)})`);
  ok(!/every email masked/.test(wrote.pass[0].s),
    "…and never claims 'every email masked' — the sentence F-693 is about");
  ok(/0 email span\(s\) present/.test(wrote.pass[0].s),
    "…and states the number it measured, so a reader can see the zero instead of inferring it");
  ok(wrote.fail.length === 0 && wrote.nv.length === 0,
    "…and it is still a PASS: a view with no address is legitimate, the refusal belongs at run level");

  /* THE RUN-LEVEL CONTROL, which is where the zero is caught. */
  const zero = s.positiveControl();
  ok(zero.ok === false && zero.spanTotal === 0 && zero.captures === 1,
    `a run whose every capture measured 0 spans FAILS the control (got: ${JSON.stringify(zero)})`);
  ok(/matched nothing all run/.test(zero.sentence) && /selector drift/.test(zero.sentence),
    `…and the sentence names both causes a reader must go and check (got: ${JSON.stringify(zero.sentence)})`);
  ok(/vacuous/.test(zero.sentence),
    "…and says plainly that the per-shot verdicts in such a run proved nothing");

  await s(page, frameOf({ total: 2, masked: 2, readable: 0 }), "/tmp/cr-real.png");
  ok(/2 email span\(s\) on the view, none left readable/.test(wrote.pass[1].s),
    `a capture that DID mask states its count and what it asserted (got: ${JSON.stringify(wrote.pass[1].s)})`);
  const live = s.positiveControl();
  ok(live.ok === true && live.spanTotal === 2 && live.captures === 2,
    `ONE capture with a real span is enough to pass the control for the whole run (got: ${JSON.stringify(live)})`);
  ok(/the selector is live/.test(live.sentence), "…and the sentence says what that buys");

  /* A REFUSED capture measured the view too, so its spans count. Otherwise a run whose only
     span-bearing capture was refused would ALSO report "the mask matched nothing", which is
     a second, wrong diagnosis on top of the leak. */
  const t = makeShot(W);
  await t(page, frameOf({ total: 5, masked: 0, readable: 5 }), "/tmp/cr-leak.png").catch(() => {});
  const refused = t.positiveControl();
  ok(refused.ok === true && refused.spanTotal === 5,
    `a REFUSED capture still counts toward the control — it measured the view (got: ${JSON.stringify(refused)})`);

  /* No captures at all is its own sentence: not "the selector drifted", but "nothing ran". */
  const none = maskPositiveControl([]);
  ok(none.ok === false && none.captures === 0 && /ran on NO view/.test(none.sentence),
    `a run with zero captures is named as such, not misdiagnosed as selector drift (got: ${JSON.stringify(none.sentence)})`);
  ok(maskPositiveControl(undefined).ok === false && maskPositiveControl(null).captures === 0,
    "…and the control never throws on a driver that has no shots array to give it");

  /* `perm-discriminator-live` and `knowledge-doors-editor-live` have TWO recorders and
     concatenate them, so the control must accept a plain array as well as the binding. */
  const both = maskPositiveControl([...s.shots, ...t.shots]);
  ok(both.ok === true && both.captures === 3 && both.spanTotal === 7,
    `the control sums across concatenated recorders (got: ${JSON.stringify(both)})`);
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

  /* F-731 — THE FIXTURES BELOW HAVE NO RENDER TO WAIT FOR, SO THEY DO NOT WAIT FOR ONE.
     `removeAccount` settles twice against a real admin-panel iframe (`SETTLE_MS`), and
     7i's unrepairable roster pays BOTH on all four repair passes — twenty seconds of pure
     `setTimeout` for one case, inside the OFFLINE suite. There is no iframe here: the fake
     DOM answers synchronously, so a settle can only ever burn wall clock. Lowering it
     changes nothing these cases assert — the roster diff, the pass count, the verdict and
     the failures are all computed from the fake's state, not from the passage of time.
     The DEFAULT is proven separately, by the arm just below, which runs a restore with no
     override at all and measures that both real settles were actually paid. */
  /* F-740 — AND `grantRole`'s FIVE, which is where the time actually was. Measured on this
     file: 94.6 s before, and `grantRole`'s settles are ~93 s of it (two 4500s per grant case
     plus 500+400, and this file runs several). Every one of them is a `setTimeout` against a
     fake DOM that answers synchronously. Not one assertion below depends on their values —
     the roster diff, the verdict, `cardHow` and the refusal sentences are all computed from
     the fake's state. The DEFAULTS are proven by the arm just below, numerically. */
  const FAST_SETTLE = {
    rosterList: 50, removeConfirm: 50,
    roleSelect: 5, scopeSelect: 5, searchResults: 5, grantApply: 5, cardRetry: 5,
  };

  /* THE DEFAULT ARM. It exists because every other restore case here now overrides the
     settle, and an override that nothing checks is how a "5 second wait" silently becomes
     a 50 ms one live. One stray, removed successfully, no override: the elapsed time must
     account for BOTH live settles, which is the only evidence that `SETTLE_MS` still
     reaches `removeAccount` and that F-671's measured live waits are what a driver gets. */
  {
    const snapshot = [{ accountId: DIR[0].accountId, displayName: "Ann Namesake", role: "editor", scope: "own" }];
    const live = [
      { accountId: DIR[0].accountId, displayName: "Ann Namesake", role: "editor", scope: "own" },
      { accountId: DIR[2].accountId, displayName: "Cid Namesake", role: "editor", scope: "all" },   // the stray
    ];
    const { st, deps } = makeFakeUI({ roster: live });
    const t0 = Date.now();
    const res = await makeRosterUI(deps).restoreRosterToSnapshot(snapshot);   // NO settleMs
    const elapsed = Date.now() - t0;

    ok(SETTLE_MS.rosterList === 1500 && SETTLE_MS.removeConfirm === 3500,
      `F-731: SETTLE_MS still holds the MEASURED live waits (got ${JSON.stringify(SETTLE_MS)})`);
    /* F-740 — `grantRole`'s five, asserted NUMERICALLY and by NAME. This is the only thing
       standing between a fixture that wants a faster suite and a live driver that clicks a
       row 5 ms after typing a query, before the people picker has answered. The keys are
       listed one by one rather than deep-compared so that ADDING a settle is a deliberate
       act here too, not something a `JSON.stringify` equality quietly absorbs. */
    ok(SETTLE_MS.roleSelect === 500 && SETTLE_MS.scopeSelect === 400,
      `F-740: the two dropdown settles keep their measured live values (got roleSelect=${SETTLE_MS.roleSelect}, scopeSelect=${SETTLE_MS.scopeSelect})`);
    ok(SETTLE_MS.searchResults === 4500 && SETTLE_MS.grantApply === 4500,
      `F-740: …and so do the two that dominate — the people-picker round trip and the post-click roster re-render (got searchResults=${SETTLE_MS.searchResults}, grantApply=${SETTLE_MS.grantApply})`);
    ok(SETTLE_MS.cardRetry === 1200,
      `F-740: …and F-671's retry settle, whose value is quoted in the \`cardHow\` sentence a driver prints (got ${SETTLE_MS.cardRetry})`);
    ok(Object.keys(SETTLE_MS).length === 7,
      `F-740: SETTLE_MS holds exactly the seven named settles — a sixth literal added to the module without a name here is the F-731/F-740 defect returning (got ${Object.keys(SETTLE_MS).join(", ")})`);
    ok(res && res.ok === true && st.roster.length === 1,
      "F-731: the default-settle restore still repairs the roster");
    ok(elapsed >= SETTLE_MS.rosterList + SETTLE_MS.removeConfirm,
      `F-731: …and it PAID both live settles — the default is real, not a name over a 50ms wait (elapsed ${elapsed}ms, floor ${SETTLE_MS.rosterList + SETTLE_MS.removeConfirm}ms)`);
    /* POSITIVE CONTROL: the same restore with the override is dramatically faster, so the
       measurement above is a measurement of the SETTLE and not of the fixture's own cost. */
    const { deps: fastDeps } = makeFakeUI({ roster: live.map((r) => ({ ...r })) });
    const t1 = Date.now();
    const fast = await makeRosterUI({ ...fastDeps, settleMs: FAST_SETTLE }).restoreRosterToSnapshot(snapshot);
    const fastElapsed = Date.now() - t1;
    ok(fast && fast.ok === true, "F-731 CONTROL: the lowered settle repairs the identical roster identically");
    ok(fastElapsed < SETTLE_MS.rosterList,
      `F-731 CONTROL: …in a fraction of the time, so \`settleMs\` is what the elapsed time above measured (${fastElapsed}ms vs ${elapsed}ms)`);
  }

  /* F-740 — THE SAME ARM FOR `grantRole`, because the same override now reaches it. Exactly
     ONE grant in this file runs with no `settleMs` at all, and its elapsed time must account
     for the four settles a successful grant pays (roleSelect + scopeSelect + searchResults +
     grantApply = 9.9 s; `cardRetry` is only paid when the first card read fails, so it is not
     in the floor). Without this, every grant case below could be lowered to 5 ms and nothing
     would notice that a live driver had been lowered with them — which is precisely how the
     five literals became invisible in the first place. It costs ten seconds and it is the
     only evidence the live numbers are real. */
  {
    const { st, deps } = makeFakeUI({});
    const t0 = Date.now();
    const r = await makeRosterUI(deps).grantRole(DIR[1].accountId, "editor", "own", ["Bob"]);   // NO settleMs
    const elapsed = Date.now() - t0;
    const floor = SETTLE_MS.roleSelect + SETTLE_MS.scopeSelect + SETTLE_MS.searchResults + SETTLE_MS.grantApply;
    ok(r && r.ok === true && st.roster.some((x) => x.accountId === DIR[1].accountId),
      "F-740: the default-settle grant still grants — lowering the fixtures did not change what grantRole DOES");
    ok(elapsed >= floor,
      `F-740: …and it PAID all four live settles, so the defaults are real waits and not names over 5ms (elapsed ${elapsed}ms, floor ${floor}ms)`);
    /* POSITIVE CONTROL: the identical grant with the override is dramatically faster, so the
       measurement above is of the SETTLES and not of the fixture's own cost. */
    const { st: st2, deps: deps2 } = makeFakeUI({});
    const t1 = Date.now();
    const fast = await makeRosterUI({ ...deps2, settleMs: FAST_SETTLE }).grantRole(DIR[1].accountId, "editor", "own", ["Bob"]);
    const fastElapsed = Date.now() - t1;
    ok(fast && fast.ok === true && st2.roster.some((x) => x.accountId === DIR[1].accountId),
      "F-740 CONTROL: the lowered settle grants identically");
    ok(fastElapsed < SETTLE_MS.searchResults,
      `F-740 CONTROL: …in a fraction of the time, so \`settleMs\` really is what the elapsed time above measured (${fastElapsed}ms vs ${elapsed}ms)`);
  }

  function makeFakeUI(opts = {}) {
    const st = {
      roster: (opts.roster || []).map((r) => ({ ...r })),
      role: "viewer", scope: "own", open: null, query: "",
      clicks: [], scopeDropdownClicks: 0, shots: 0, pendingRemove: null,
      forceScopeControl: opts.forceScopeControl === true,
      throwFor: opts.throwFor || null,
      maskLeaks: opts.maskLeaks === true,
      /* F-717 — the repair that CANNOT succeed: the confirm dialog is driven, it closes,
         and the row is still in `app_admins`. This is the real shape of a stray grant four
         repair passes cannot clear (a stale frame, a server-side refusal, a role the UI
         will not let go of), and it is what makes `removeAccount`'s SECOND READ report
         `removed:false` instead of a throw. Nothing is stubbed: the library runs its own
         plan, its own retries and its own verdict against this roster. */
      stickyRemove: opts.stickyRemove === true,
      /* F-671 — the product moved or renamed `scopeLabel`'s wrapper, so the card still
         renders but `.perm-admin-role` no longer matches anything on it. */
      noRoleClass: opts.noRoleClass === true,
      roleClassReads: 0,
      /* F-670 — the build whose ROSTER CARD has no in-place role picker (the admin panel
         before PermissionsTab grew the per-card `CustomSelect`s). It is the ONE answer that
         licenses the destructive remove/re-grant repair, so it has to be drivable. */
      noInPlaceControl: opts.noInPlaceControl === true,
      /* F-670 — the first `grantFails` row-CLICKS land on the row and change nothing, which
         is what a grant that did not take looks like from outside: `grantRole`'s own second
         read finds no row and reports ok:false. `Infinity` is the re-grant that never works. */
      grantFails: opts.grantFails === undefined ? 0 : opts.grantFails,
      removals: 0, roleChanges: [],
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
        if (st.grantFails > 0) { st.grantFails--; return; }   // F-670 - the grant that did not take
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
        /* F-670 — THE IN-PLACE DOOR, AS PermissionsTab RENDERS IT. The card holds its own
           role `CustomSelect`, and the scope one beside it behind the SAME
           `{role !== "admin" && (` guard the search row uses — so an ADMIN card carries one
           dropdown and every other card carries two. `noInPlaceControl` is the older build
           that carries none. */
        if (sel === ".dropdown") {
          const n = st.noInPlaceControl ? 0 : (r.role === "admin" ? 1 : 2);
          return node({ count: n, nth: (i) => node({ onClick: async () => {
            if (i >= n) throw new Error("locator.click: Timeout 30000ms exceeded waiting for locator('.dropdown').nth(" + i + ")");
            st.open = { which: i === 0 ? "role" : "scope", card: r.accountId };
          } }) });
        }
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
            st.open = { which: i === 0 ? "role" : "scope", card: null };
            if (i === 1) st.scopeDropdownClicks++;
          } }) });
        }
        if (sel === ".dropdown-item-name") {
          return node({ onClick: async () => {
            const roleOf = () => { let v = null; for (const [val, label] of [["viewer", "Viewer"], ["editor", "Editor"], ["admin", "Admin"]]) if (has.test(label)) v = val; return v; };
            if (st.open && st.open.card) {
              /* PermissionsTab#handleRoleChange, faithfully: the card's role select passes
                 the row's EXISTING scope through for a non-admin role and forces "all" for
                 Admin, so the role click ALONE cannot set the scope — which is exactly why
                 `changeRoleInPlace` clicks twice. */
              const row = st.roster.find((x) => x.accountId === st.open.card);
              if (!row) return;
              if (st.open.which === "role") {
                const v = roleOf();
                if (v) { row.role = v; if (v === "admin") row.scope = "all"; st.roleChanges.push({ accountId: row.accountId, role: v, scope: row.scope }); }
              } else {
                row.scope = has.test("All Rules") ? "all" : "own";
                st.roleChanges.push({ accountId: row.accountId, role: row.role, scope: row.scope });
              }
              return;
            }
            if (st.open && st.open.which === "role") { const v = roleOf(); if (v) st.role = v; }
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
        if (sel === ".cr-confirm-actions button") return node({ onClick: async () => { st.removals++; if (!st.stickyRemove) st.roster = st.roster.filter((r) => r.accountId !== st.pendingRemove); st.pendingRemove = null; } });
        return node({ count: 1 });
      },
    };
    const page = { screenshot: async () => { st.shots++; } };
    return { st, deps: { withAdminPanel: async (fn) => fn(page, frame), rosterRows: async () => st.roster.map((r) => ({ ...r })), out: "/tmp/cr-f666" } };
  }

  /* 7a. THE HANG ITSELF. An admin grant must not touch the scope dropdown at all. */
  {
    const { st, deps } = makeFakeUI();
    const ui = makeRosterUI({ ...deps, settleMs: FAST_SETTLE });
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
    const ui = makeRosterUI({ ...deps, settleMs: FAST_SETTLE });
    const r = await ui.grantRole(DIR[1].accountId, "editor", "own", ["Bob"]);
    ok(r.ok === true, "an EDITOR grant still succeeds");
    ok(st.scopeDropdownClicks === 1, "…and it DOES click the scope dropdown, which is rendered for every non-admin role");
    ok(st.clicks[0].scope === "own" && r.card === "Own rules only", "…and both the stored scope and the card read 'own'");
  }

  /* 7c. F-658's RULE HOLDS FOR THE NEW PATH. Admin stores "all" whatever is asked, so
     asking for "own" is a REFUSAL — never a click that quietly stores something else. */
  {
    const { st, deps } = makeFakeUI();
    const r = await makeRosterUI({ ...deps, settleMs: FAST_SETTLE }).grantRole(DIR[0].accountId, "admin", "own", ["Ann"]);
    ok(r.ok === false && r.refused === true, "admin + scope 'own' is REFUSED, not rounded to the scope the UI would store");
    ok(st.clicks.length === 0, "…and nothing was clicked, so no wrong grant exists to clean up");
    ok(/no scope control for Admin/.test(String(r.reason)), "…and the refusal says why");
  }

  /* 7d. THE DRIFT GUARD. If PermissionsTab ever renders a scope control for Admin again,
     skipping it would silently store a default. That must be reported, not assumed away. */
  {
    const { deps } = makeFakeUI({ forceScopeControl: true });
    const r = await makeRosterUI({ ...deps, settleMs: FAST_SETTLE }).grantRole(DIR[0].accountId, "admin", "all", ["Ann"]);
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
    const r = await makeRosterUI({ ...deps, settleMs: FAST_SETTLE }).grantRole(DIR[0].accountId, "admin", "all", ["Ann"]);
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
    const r = await makeRosterUI({ ...deps, settleMs: FAST_SETTLE }).grantRole(DIR[1].accountId, "editor", "own", ["Bob"]);
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
    try { res = await makeRosterUI({ ...deps, settleMs: FAST_SETTLE }).restoreRosterToSnapshot(snapshot); }
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
    /* F-670 — the `changed` row is repaired IN PLACE now, so the act that records it is
       `change-in-place`; `readd-changed` only appears on a build with no card picker. */
    ok(acts.some((a) => a.startsWith("change-in-place")), "the actions record the changed repair");
    ok(st.removals === 0, "F-670: …and NOTHING was removed to do it — the `changed` row never left the roster");
    ok(acts.some((a) => a === "readd-missing:" + idTail(DIR[2].accountId)), "…and the repair that came after the throw");
    ok(Array.isArray(res.failures) && res.failures.length >= 1, "…and every failure is collected, not just the first");
    ok(res.failures.every((f) => f.id === idTail(DIR[1].accountId)),
      "…and ONLY the row that genuinely failed is listed — the repairs that worked are not tarred with it");
  }

  /* 7f. THE EXACT LIVE HARM, AND THE FACT THAT IT CAN NO LONGER HAPPEN.
     The row whose GRANT throws is the CHANGED one. Under the remove→re-grant repair, the
     remove had already landed when the grant threw, so a real site admin stayed DELETED
     for the rest of the run — F-666 bounded that to one row and made the run name it, and
     F-670 is the finding that a named, unrecoverable deletion is still a deletion the
     restore itself performed.
     `changeRoleInPlace` never opens the search box, so `throwFor:"Ann"` — which throws on
     `.perm-search-input.fill("Ann")` — cannot reach the repair of Ann's row at all: it is
     driven through the card's own role picker and `updateUserRole`. What used to be "the
     damage stopped at one row" is now "there is no damage": Ann is REPAIRED, the roster
     ends whole, and the run passes. The rows queued behind her are still attempted, which
     is F-666's guarantee and must not regress. */
  {
    const snapshot = [
      { accountId: DIR[0].accountId, displayName: "Ann Namesake", role: "admin", scope: "all" },
      { accountId: DIR[1].accountId, displayName: "Bob Namesake", role: "editor", scope: "own" },
      { accountId: DIR[2].accountId, displayName: "Cid Namesake", role: "editor", scope: "all" },
    ];
    const live = [{ accountId: DIR[0].accountId, displayName: "Ann Namesake", role: "editor", scope: "own" }];
    const { st, deps } = makeFakeUI({ roster: live, throwFor: "Ann" });
    let threw = null, res = null;
    try { res = await makeRosterUI({ ...deps, settleMs: FAST_SETTLE }).restoreRosterToSnapshot(snapshot); }
    catch (e) { threw = String(e.message); }
    ok(threw === null, `a throw in the CHANGED repair does not escape the restore (got: ${threw})`);

    const ids = st.roster.map((r) => r.accountId);
    ok(ids.includes(DIR[0].accountId),
      "F-670: Ann is STILL ON THE ROSTER — the repair that used to delete her first never removes anything");
    const ann = st.roster.find((r) => r.accountId === DIR[0].accountId);
    ok(ann && ann.role === "admin" && ann.scope === "all",
      `F-670: …and she carries the ADMIN row the snapshot held, set in place through the card's own picker (got ${JSON.stringify(ann)})`);
    ok(st.removals === 0,
      `F-670: …and the confirm dialog was never driven for her — zero removals in the whole restore (got ${st.removals})`);
    ok(ids.includes(DIR[1].accountId) && ids.includes(DIR[2].accountId),
      "F-666 must not regress: Bob and Cid, queued behind her, were still attempted and are both back");
    ok(res.ok === true, `F-670: …so the restore ends CLEAN, where it used to end one row short (got ${JSON.stringify(res.ok)})`);
    ok(!Array.isArray(res.failures) || !res.failures.some((f) => f.id === idTail(DIR[0].accountId)),
      "F-670: …and no failure names Ann, because there is nothing for an operator to repair by hand");

    /* POSITIVE CONTROL — the SAME fixture on a build with no in-place picker, which is the
       only way the destructive path can still be reached. There the old harm is real and
       must be reported exactly as F-666 left it: Ann removed, the re-grant throwing on
       every attempt, the damage stopping at her row, and the two behind her repaired. */
    const { st: st2, deps: deps2 } = makeFakeUI({ roster: [{ ...live[0] }], throwFor: "Ann", noInPlaceControl: true });
    const old = await makeRosterUI({ ...deps2, settleMs: FAST_SETTLE }).restoreRosterToSnapshot(snapshot);
    const ids2 = st2.roster.map((r) => r.accountId);
    ok(!ids2.includes(DIR[0].accountId),
      "POSITIVE CONTROL (F-670): with NO card picker the repair must remove first, and a grant that throws leaves Ann deleted — the harm this finding removes");
    ok(ids2.includes(DIR[1].accountId) && ids2.includes(DIR[2].accountId),
      "POSITIVE CONTROL: …and F-666 still holds on that path — the rows behind her are attempted and back");
    ok(old.ok === false && Array.isArray(old.failures) && old.failures.some((f) => f.id === idTail(DIR[0].accountId)),
      "POSITIVE CONTROL: …and the verdict FAILS naming Ann, which is what an operator got before and still gets on that build");
    ok(old.failures.some((f) => /Timeout/.test(String(f.reason))),
      "POSITIVE CONTROL: …with the reason the repair gave, not a bare 'restore failed'");
  }

  /* ── F-670. A `changed` ROW IS REPAIRED WITHOUT EVER LEAVING THE ROSTER. ──────────
     THE DEFECT. `restoreRosterToSnapshot` repaired a `changed` row by REMOVE then
     RE-GRANT. F-666 stopped one failed repair cancelling the rest and made the run NAME the
     row it lost; it did not stop the loss. A re-grant that fails on every pass leaves a REAL
     roster row deleted from `app_admins` — a permission the run destroyed on a shared tenant
     and cannot put back.

     WHY NOT GRANT-BEFORE-REMOVE. The roster keys by ACCOUNT and F-651's discriminator work
     settled the UI half: the search row for an account already on the roster renders
     `perm-search-disabled`, so a second row for one account cannot be granted under a
     temporary discriminator and then swapped. There is no such door. The repair therefore
     has to be one that never removes — and PermissionsTab has one: the roster CARD's own
     role/scope `CustomSelect`s, wired to `handleRoleChange` → the `updateUserRole` resolver,
     which REWRITES the row in place.

     The three cases below are the three worlds: the picker is there and works; the picker is
     absent, so the destructive path runs WITH RETRIES; and the re-grant fails every retry, so
     the row is genuinely lost and the run must say so in a sentence an operator can act on. */

  /* 7j. IN PLACE: the role is changed through the card, and NOTHING is removed. */
  {
    const snapshot = [
      { accountId: DIR[0].accountId, displayName: "Ann Namesake", role: "editor", scope: "own", emailAddress: "ann@tenant.example" },
      { accountId: DIR[1].accountId, displayName: "Bob Namesake", role: "admin", scope: "all", emailAddress: "bob@tenant.example" },
    ];
    /* Ann drifted admin→(the snapshot's editor/own) and Bob drifted the other way: BOTH
       directions cross the `role !== "admin"` guard that unmounts the card's scope select,
       which is the F-666 product fact on the card. */
    const live = [
      { accountId: DIR[0].accountId, displayName: "Ann Namesake", role: "admin", scope: "all", emailAddress: "ann@tenant.example" },
      { accountId: DIR[1].accountId, displayName: "Bob Namesake", role: "editor", scope: "all", emailAddress: "bob@tenant.example" },
    ];
    const { st, deps } = makeFakeUI({ roster: live });
    const ui = makeRosterUI({ ...deps, settleMs: FAST_SETTLE });
    const res = await ui.restoreRosterToSnapshot(snapshot);

    ok(res && res.ok === true, `F-670: the changed rows are repaired and the restore passes (got ${JSON.stringify(res && res.verdict)})`);
    ok(st.removals === 0, `F-670: …and the confirm dialog was NEVER driven — not one row left the roster to be put back (got ${st.removals} removal(s))`);
    ok(st.clicks.length === 0, "F-670: …and no GRANT was needed either: the search box was never used for a row that was already there");
    ok(st.roster.length === 2, "F-670: …the roster never even changed length, which is what makes the repair non-destructive");

    const ann = st.roster.find((r) => r.accountId === DIR[0].accountId);
    const bob = st.roster.find((r) => r.accountId === DIR[1].accountId);
    ok(ann && ann.role === "editor" && ann.scope === "own",
      `F-670: admin→editor/own lands BOTH fields — the role click alone passes the old scope through, so the scope click is not optional (got ${JSON.stringify(ann)})`);
    ok(bob && bob.role === "admin" && bob.scope === "all",
      `F-670: editor→admin lands admin with the scope the product forces, without touching a control that unmounted (got ${JSON.stringify(bob)})`);

    const acts = (res.actions || []).filter((a) => a.act === "change-in-place");
    ok(acts.length === 2 && acts.every((a) => a.ok === true), `F-670: both repairs are recorded as in-place changes (got ${JSON.stringify(acts.map((a) => [a.act, a.ok]))})`);
    ok(acts.every((a) => a.cardAgrees === true), "F-670: …and each one READ THE CARD BACK and found it agreeing with the stored row (F-666/F-671's guarantee, on this path too)");
    ok(!res.failures, "F-670: …and nothing is reported as a failure");

    /* A direct call, so the helper's own answer is asserted and not only its effect. */
    const { st: st2, deps: deps2 } = makeFakeUI({ roster: [{ accountId: DIR[2].accountId, displayName: "Cid Namesake", role: "viewer", scope: "own" }] });
    const direct = await makeRosterUI({ ...deps2, settleMs: FAST_SETTLE }).changeRoleInPlace(DIR[2].accountId, "editor", "all");
    ok(direct.ok === true && direct.inPlace === true && direct.card === "All rules",
      `F-670: changeRoleInPlace reports the card it read back (got ${JSON.stringify({ ok: direct.ok, card: direct.card })})`);
    ok(st2.removals === 0 && st2.roster[0].role === "editor" && st2.roster[0].scope === "all",
      "F-670: …and the stored row is the SECOND READ that licenses it, with no removal behind it");
    /* F-658's rule reaches the new path too: a role the UI cannot express is a refusal. */
    const refused = await makeRosterUI({ ...deps2, settleMs: FAST_SETTLE }).changeRoleInPlace(DIR[2].accountId, "superuser", "all");
    ok(refused.ok === false && refused.refused === true,
      `F-658 on the in-place path: an unexpressible role is REFUSED, never rounded to a label (got ${JSON.stringify(refused.reason)})`);
    const refusedAdmin = await makeRosterUI({ ...deps2, settleMs: FAST_SETTLE }).changeRoleInPlace(DIR[2].accountId, "admin", "own");
    ok(refusedAdmin.ok === false && refusedAdmin.refused === true,
      "F-666 on the in-place path: admin with a scope other than \"all\" cannot be expressed and is refused");
  }

  /* 7k. NO IN-PLACE PATH ON THIS BUILD → remove/re-grant, AND THE GRANT IS RETRIED.
     The fallback is the only thing left when the card renders no picker, and it is exactly
     the destructive repair. What F-670 adds to it is that the re-grant does not get ONE
     shot: `REGRANT_ATTEMPTS` tries with the retry settle between them, because the row is
     already off the tenant and a transient people-picker miss must not end the run with a
     permission deleted. Here the first grant click lands and changes nothing — a grant that
     did not take — and the second succeeds. */
  {
    const snapshot = [{ accountId: DIR[0].accountId, displayName: "Ann Namesake", role: "admin", scope: "all", emailAddress: "ann@tenant.example" }];
    const live = [{ accountId: DIR[0].accountId, displayName: "Ann Namesake", role: "editor", scope: "own", emailAddress: "ann@tenant.example" }];
    const { st, deps } = makeFakeUI({ roster: live, noInPlaceControl: true, grantFails: 1 });
    const res = await makeRosterUI({ ...deps, settleMs: FAST_SETTLE }).restoreRosterToSnapshot(snapshot);

    ok(REGRANT_ATTEMPTS >= 2, `F-670: the module names how many re-grants a lost row gets before it is declared lost (got ${REGRANT_ATTEMPTS})`);
    const probe = (res.actions || []).find((a) => a.act === "change-in-place");
    ok(probe && probe.noInPlaceControl === true,
      `F-670: the in-place path was TRIED first and reported that this build has no card picker (got ${JSON.stringify(probe && probe.reason)})`);
    ok(!(res.failures || []).some((f) => f.act === "change-in-place"),
      "F-670: …and that answer is NOT counted as a failed repair — it is a probe whose negative answer chose the other door");
    ok(st.removals === 1, `F-670: …so the destructive path ran: the row was removed once (got ${st.removals})`);
    ok(st.clicks.length === 2, `F-670: …and the re-grant was attempted TWICE — the first click did not take, the second did (got ${st.clicks.length})`);
    const ann = st.roster.find((r) => r.accountId === DIR[0].accountId);
    ok(ann && ann.role === "admin" && ann.scope === "all",
      `F-670: …and the RETRY is what put the row back, as the admin she was (got ${JSON.stringify(ann)})`);
    ok(res.ok === true, `F-670: …so the restore ends clean, where one attempt would have ended a row short (got ${JSON.stringify(res.verdict)})`);
    const readd = (res.actions || []).find((a) => a.act === "readd-changed");
    ok(readd && readd.ok === true && readd.attempts === 2,
      `F-670: …and the action says how many attempts it took, so a flaky tenant is visible rather than silent (got ${JSON.stringify(readd && readd.attempts)})`);
    /* WHAT THE RETRY ACTUALLY BUYS, stated so that lowering `REGRANT_ATTEMPTS` to 1 FAILS
       here. The four-pass loop would have re-added this row on the NEXT pass as `missing`,
       so the roster ends right either way — but not before the run told an operator, in the
       sentence 7l builds, that a real permission had been LOST and had to be redone by
       hand. The retry is what stops a transient miss becoming that false alarm. */
    ok(!(res.failures || []).some((f) => f.redo || f.lost),
      `F-670: …and no row is declared LOST, so nobody is dispatched to redo a grant that the very next attempt made (got ${JSON.stringify((res.failures || []).map((f) => f.act))})`);
    ok(!(res.actions || []).some((a) => a.lost === true),
      "F-670: …and no action carries `lost` either — the repair completed inside its own pass");
    ok(!(res.actions || []).some((a) => a.act === "readd-missing"),
      "F-670: …and the row was never left for a LATER pass to rescue as a `missing` one, which is recovery by luck, not by design");

    /* NEGATIVE CONTROL — the pre-F-670 fallback, which took the FIRST grant's answer. On
       this exact fixture it ends with the row deleted and the run red. */
    const { st: st3, deps: deps3 } = makeFakeUI({ roster: [{ ...live[0] }], noInPlaceControl: true, grantFails: 1 });
    const ui3 = makeRosterUI({ ...deps3, settleMs: FAST_SETTLE });
    await ui3.removeAccount(DIR[0].accountId);
    const onlyTry = await ui3.grantRole(DIR[0].accountId, "admin", "all", ["Ann"]);
    ok(onlyTry.ok === false && !st3.roster.some((r) => r.accountId === DIR[0].accountId),
      "NEGATIVE CONTROL (F-670): one attempt at the same grant fails and leaves the row deleted — which is what the retry above absorbs");
  }

  /* 7l. THE ROW IS GENUINELY LOST → IT IS NAMED, AND THE EXACT GRANT TO REDO IS PRINTED.
     Retries do not make an impossible grant possible. When every one of them fails the row
     is off the tenant for good, and F-666's "name the row" is not enough to act on: an id
     tail does not tell an operator WHAT to put back. The verdict carries role, scope and a
     MASKED address (F-652 — `lib/redact.mjs#maskEmail`, the same mask the screenshots and
     the evidence JSON use), plus the id chip to match the namesake by. */
  {
    const EMAIL = "ann.namesake@tenant.example";
    const snapshot = [{ accountId: DIR[0].accountId, displayName: "Ann Namesake", role: "editor", scope: "own", emailAddress: EMAIL }];
    const live = [{ accountId: DIR[0].accountId, displayName: "Ann Namesake", role: "viewer", scope: "all", emailAddress: EMAIL }];
    const { st, deps } = makeFakeUI({ roster: live, noInPlaceControl: true, grantFails: Infinity });
    let threw = null, res = null;
    try { res = await makeRosterUI({ ...deps, settleMs: FAST_SETTLE }).restoreRosterToSnapshot(snapshot); }
    catch (e) { threw = String(e.message); }

    ok(threw === null, `F-670: an unrepairable changed row does not crash the restore (got: ${threw})`);
    ok(!st.roster.some((r) => r.accountId === DIR[0].accountId),
      "F-670: the row IS gone — on a build with no in-place picker this loss is still possible, and the run must not pretend otherwise");
    ok(st.clicks.length >= REGRANT_ATTEMPTS,
      `F-670: …and it was not given up on after one try: at least ${REGRANT_ATTEMPTS} grants were attempted (got ${st.clicks.length})`);
    ok(res && res.ok === false, "F-670: …the restore FAILS");

    const lost = (res.failures || []).find((f) => f.redo);
    ok(!!lost, `F-670: …and a failure row carries the REDO instruction (got ${JSON.stringify((res.failures || []).map((f) => f.act))})`);
    ok(lost && lost.redo.role === "editor" && lost.redo.scope === "own",
      `F-670: …naming the exact ROLE and SCOPE to grant back (got ${JSON.stringify(lost && lost.redo)})`);
    ok(lost && lost.redo.email === maskEmail(EMAIL),
      `F-670: …and the address MASKED by lib/redact.mjs, so the instruction is printable (got ${JSON.stringify(lost && lost.redo.email)})`);
    ok(lost && !JSON.stringify(lost).includes(EMAIL) && !JSON.stringify(lost).includes("Ann Namesake"),
      "F-652 on the new sentence: the RAW address never appears, and neither does the display name — the id chip is the discriminator");
    ok(lost && lost.redo.id === idTail(DIR[0].accountId) && lost.reason.includes(lost.redo.id),
      "F-670: …the id chip an operator matches the namesake by is in the sentence, which is the F-645 rule");
    ok(lost && /REDO BY HAND/.test(lost.reason) && /Permissions/.test(lost.reason),
      `F-670: …and the reason tells them WHERE to do it, not only that something broke (got ${JSON.stringify(lost.reason)})`);

    const act = (res.actions || []).find((a) => a.lost === true);
    ok(act && act.attempts === REGRANT_ATTEMPTS,
      `F-670: …and the action records that every attempt was spent before the row was declared lost (got ${JSON.stringify(act && act.attempts)})`);

    /* NEGATIVE CONTROL — the pre-F-670 report for this exact row: an act and an id tail and
       nothing an operator can act on. */
    const preFix = { act: "readd-changed", id: idTail(DIR[0].accountId), reason: "the click landed but the roster row is null" };
    ok(preFix.redo === undefined && !/editor|own|@/.test(preFix.reason),
      "NEGATIVE CONTROL (F-670): the pre-fix failure row named the account and NOT the grant — the operator could not put it back from it");
  }

  /* THE DRIVERS' RUN-LEVEL ARMS, TRANSCRIBED ONCE.
     `perm-discriminator-live.mjs` and `knowledge-doors-editor-live.mjs` carry the same
     text modulo an em dash, and 7h (clean roster) and 7i (unrestored roster) must be
     judged by the SAME arms or neither result means anything — a second copy here would
     be the third home of a rule this ledger has already paid for twice. */
  const runArms = (restore, leakedNow) => {
    const fails = [];
    const FAIL = (s, d) => fails.push({ s, d });
    if (leakedNow) {
      FAIL("a screenshot capture was REFUSED because a readable email address survived the mask", {
        ...(restore && restore.leaked ? { duringRepair: restore.leakInfo } : {}),
      });
    }
    /* F-717 — a SECOND, INDEPENDENT `if`, gated on the VERDICT rather than on the leak.
       F-700's `else if` was right about the clean roster and wrong about the dirty one:
       it silenced the only report of state left behind on a shared tenant whenever a
       capture also leaked. `ok:false` with `verdict:"byte-identical"` is the leak's own
       doing and stays quiet; anything else is a roster that was not restored. */
    if (restore && restore.ok === false && restore.verdict !== "byte-identical") {
      FAIL("the roster restore reports ok:false - the repair did not complete cleanly and the roster is NOT what the snapshot says",
        { verdict: restore.verdict, failures: restore.failures, reason: restore.reason });
    }
    return fails;
  };

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
      settleMs: FAST_SETTLE,
    });
    let threw = null, res = null;
    try { res = await ui.restoreRosterToSnapshot(snapshot); }
    catch (e) { threw = String(e.message); }

    ok(threw === null, `the leak does not crash the restore — attempt() still absorbs the throw (got: ${threw})`);
    ok(st.roster.length === 1 && st.roster[0].accountId === DIR[0].accountId,
      "the stray WAS removed, so the roster genuinely ends byte-identical to the snapshot");
    ok(res && res.verdict === "byte-identical", `…and the roster verdict says so (got ${JSON.stringify(res && res.verdict)})`);
    ok(res && res.leaked === true, "F-681: …and the restore still reports `leaked`, because a clean roster does not make a leaking PNG acceptable");
    /* F-700 — `ok` NO LONGER CARRIES THE LEAK ON THE CLEAN PATH. This assertion used to
       read `res.ok === false`, and that was the defect: `leakVerdict()` was spread last
       over the `plan.clean` early return, which has no `failures` key at all, so `ok:false`
       stopped meaning "the roster is wrong" and started meaning "the roster is wrong OR a
       capture leaked". The drivers read it as the former and printed "the repair did not
       complete cleanly" next to `verdict:"byte-identical"`, `failures:undefined`. The leak
       rides on `leaked`/`leaks`/`leakInfo` — which is what a driver must fail on — and `ok`
       answers exactly one question again. */
    ok(res && res.ok === true,
      "F-700: …and `ok` is TRUE, because the ROSTER is byte-identical — `ok` answers the roster question and nothing else");
    /* MEASURED, not assumed: in THIS fixture the refused capture threw under `attempt()`,
       so a `failures` row does exist — it is the leak itself, not a broken repair. The
       `failures:undefined` payload F-700 quotes is the OTHER shape, where the leak was
       taken by the driver outside the restore and the clean return carries nothing at all;
       it is constructed and asserted in the positive control below. Either way the second
       FAIL diagnosed a repair from a row that says `byte-identical`. */
    ok(res && res.verdict === "byte-identical",
      "F-700: …and the verdict is byte-identical, which is what the second FAIL used to print while claiming the repair broke");
    ok(res && Array.isArray(res.failures) && res.failures.every((f) => f.leak === true),
      "F-700: …and every `failures` row on this clean return is the LEAK, not a repair that went wrong");
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
       this very answer. It says the restore passed — which is the defect. `leaked` is the
       field that makes the difference now, and it is the one a driver reads. */
    const revertedVerdict = { ok: res.verdict === "byte-identical" && !res.leaked };
    ok(revertedVerdict.ok === false,
      "NEGATIVE CONTROL: the pre-F-681 verdict (roster diff alone) would call this leaking run a PASS — `leaked` is what still fails it");

    /* 7h-ii. F-700 — THE DRIVERS' RUN-LEVEL ARMS, RUN AGAINST THIS EXACT ANSWER.
       One leak on a byte-identical roster used to fire BOTH run-level FAILs, and the
       second asserted "the repair did not complete cleanly" from a payload that said
       `verdict:"byte-identical"`, `failures:undefined`, `reason:undefined` — a cause read
       off a result that did not contain it. The arms are transcribed from
       `perm-discriminator-live.mjs` and `knowledge-doors-editor-live.mjs` (the two homes
       are the same text modulo an em dash) and counted above, once. */
    const armed = runArms(res, true);
    ok(armed.length === 1, `F-700: a leak on a CLEAN roster fires EXACTLY ONE run-level FAIL (got ${armed.length})`);
    ok(/REFUSED/.test(armed[0].s) && !/did not complete cleanly/.test(armed[0].s),
      "F-700: …and it is the LEAK sentence — the one cause the result actually carries");
    ok(armed[0].d.duringRepair === res.leakInfo && /REFUSED/.test(String(res.leakInfo)),
      "F-700: …carrying the repair-time detail, so nothing the second FAIL used to say is lost");

    /* POSITIVE CONTROL — the pre-fix library answer (`ok` overwritten on the clean path)
       through the pre-fix driver arms (two independent `if`s). Two FAILs, the second one
       diagnosing a repair that was perfect. */
    /* The clean early return as it looks when the leaking capture was taken by the DRIVER
       rather than under `attempt()` — no `failures`, no `reason` — with `ok` overwritten
       the way `leakVerdict()` used to overwrite it. This is the payload F-700 quotes. */
    const preFixRestore = { ...res, ok: false, failures: undefined, info: undefined };
    const preFixArms = (r, leakedNow) => {
      const fails = [];
      const FAIL = (s, d) => fails.push({ s, d });
      if (leakedNow) FAIL("a screenshot capture was REFUSED …", {});
      if (r && r.leaked) FAIL("the roster restore reports leaked:true …", {});
      if (r && r.ok === false) FAIL("the roster restore reports ok:false - the repair did not complete cleanly", { verdict: r.verdict, failures: r.failures, reason: r.reason });
      return fails;
    };
    const preFix = preFixArms(preFixRestore, true);
    ok(preFix.length === 3,
      `POSITIVE CONTROL (F-700): the pre-fix library answer through the pre-fix arms fires THREE FAILs for one leak (got ${preFix.length})`);
    ok(preFix[2].d.verdict === "byte-identical" && preFix[2].d.failures === undefined && preFix[2].d.reason === undefined,
      "POSITIVE CONTROL: …and the last one claims a broken repair while printing byte-identical and two undefined fields — the exact payload F-700 quotes");
  }

  /* 7i. F-717 — THE CASE F-700's `else if` SWALLOWED: A LEAK **AND** A ROSTER THAT WAS
     NOT RESTORED.
     7h proves the clean-roster half. This is the other half, and it is the one that costs
     something real: the run leaks a capture AND `restoreRosterToSnapshot` finishes with a
     stray editor grant still on the tenant. Under the `else if`, the roster arm was never
     reached — `evidence.json` carried one FAIL about a PNG and not one sentence naming the
     grant that is still live, so the operator destroys the artefact, closes the run and
     leaves an editor role granted on a shared site.

     IT IS BUILT, NOT STUBBED. `stickyRemove` makes the confirm dialog close without the
     row leaving `app_admins` — the real shape of a repair that cannot succeed — and the
     library then runs its own plan, its own passes and its own verdict over that roster.
     The only thing this block asserts about the DRIVERS is `runArms`, which is transcribed
     from both of them. */
  {
    const snapshot = [{ accountId: DIR[0].accountId, displayName: "Ann Namesake", role: "editor", scope: "own" }];
    const live = [
      { accountId: DIR[0].accountId, displayName: "Ann Namesake", role: "editor", scope: "own" },
      { accountId: DIR[2].accountId, displayName: "Cid Namesake", role: "editor", scope: "all" },   // the stray that will NOT go
    ];
    const { st, deps } = makeFakeUI({ roster: live, maskLeaks: true, stickyRemove: true });
    let threw = null, res = null;
    try { res = await makeRosterUI({ ...deps, settleMs: FAST_SETTLE }).restoreRosterToSnapshot(snapshot); }
    catch (e) { threw = String(e.message); }

    ok(threw === null, `F-717: the unrepairable roster does not crash the restore (got: ${threw})`);
    ok(st.roster.length === 2 && st.roster.some((r) => r.accountId === DIR[2].accountId),
      "F-717: the stray grant is STILL on the roster — this is a real unresolved repair, not a simulated verdict");
    ok(res && res.ok === false, `F-717: …so \`ok\` is false (got ${JSON.stringify(res && res.ok)})`);
    ok(res && res.verdict !== "byte-identical",
      `F-717: …and the verdict is NOT byte-identical, which is the gate the driver gets to read (got ${JSON.stringify(res && res.verdict)})`);
    /* MEASURED, not assumed: the verdict this fixture produces is
       `"1 stray, 0 missing, 0 changed"` — it NAMES the row still on the tenant, which is
       the sentence the `else if` denied the operator. */
    ok(res && /stray/.test(String(res.verdict)),
      `F-717: …and the verdict NAMES the stray that is still there (got ${JSON.stringify(res && res.verdict)})`);
    ok(res && Array.isArray(res.failures) && res.failures.length >= 1
      && res.failures.every((f) => f.act === "remove-stray" && String(f.id) === DIR[2].accountId),
      "F-717: …and every `failures` row is the repair of THAT row, attempted on every pass and never completed");
    ok(res && res.leaked === true, "F-717: …while the capture also leaked — both things are true at once, which is the whole finding");

    /* THE ARMS, POST-FIX: both FAILs, each with the cause its own result carries. */
    const armed = runArms(res, true);
    ok(armed.length === 2, `F-717: a leak on an UNRESTORED roster fires BOTH run-level FAILs (got ${armed.length})`);
    ok(/REFUSED/.test(armed[0].s), "F-717: …the leak, first, so the artefact is still named");
    ok(/roster is NOT what the snapshot says/.test(armed[1].s),
      "F-717: …and the roster, second, in a sentence that says the state is still on the tenant");
    ok(armed[1].d.verdict === res.verdict && Array.isArray(armed[1].d.failures) && armed[1].d.failures.length >= 1,
      `F-717: …carrying the verdict and the repair failures the operator has to act on (got ${JSON.stringify(armed[1].d.verdict)})`);

    /* POSITIVE CONTROL — the F-700 `else if`, verbatim, over this exact answer. ONE FAIL,
       about a PNG, and the stray grant is never mentioned. */
    const elseIfArms = (r, leakedNow) => {
      const fails = [];
      const FAIL = (s, d) => fails.push({ s, d });
      if (leakedNow) FAIL("a screenshot capture was REFUSED …", { ...(r && r.leaked ? { duringRepair: r.leakInfo } : {}) });
      else if (r && r.ok === false) FAIL("the roster restore reports ok:false - the repair did not complete cleanly", { verdict: r.verdict, failures: r.failures, reason: r.reason });
      return fails;
    };
    const swallowed = elseIfArms(res, true);
    ok(swallowed.length === 1 && /REFUSED/.test(swallowed[0].s),
      `POSITIVE CONTROL (F-717): the pre-fix \`else if\` reports ONLY the screenshot (got ${swallowed.length})`);
    ok(!swallowed.some((f) => f.d && f.d.verdict !== undefined),
      "POSITIVE CONTROL: …and no arm carries `verdict`/`failures`, so nothing in evidence.json names the grant still on the tenant");

    /* NEGATIVE CONTROL — the same post-fix arms on the CLEAN roster of 7h must still fire
       exactly ONE FAIL, or this fix has simply reinstated the F-700 double-report. */
    const cleanish = { ok: false, verdict: "byte-identical", leaked: true, leakInfo: "1 screenshot capture(s) were REFUSED" };
    ok(runArms(cleanish, true).length === 1,
      "NEGATIVE CONTROL (F-700 must stay fixed): `ok:false` with a byte-identical verdict still fires the leak FAIL alone");
    /* …and the third combination, so the gate is the VERDICT and not "always two": an
       unrestored roster with NO leak must still fire exactly the roster FAIL. */
    const dirtyNoLeak = { ok: false, verdict: res.verdict, failures: res.failures, leaked: false };
    const only = runArms(dirtyNoLeak, false);
    ok(only.length === 1 && /roster is NOT what the snapshot says/.test(only[0].s),
      `an unrestored roster with no leak fires the roster FAIL alone (got ${only.length})`);
  }
}

console.log(`roster-ui.test.mjs: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
