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

import { MASK_EMAILS_SRC, RESTORE_EMAILS_SRC, shotMasked, makeShot } from "../lib/roster-ui.mjs";
import { maskEmail } from "../lib/redact.mjs";

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

console.log(`roster-ui.test.mjs: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
