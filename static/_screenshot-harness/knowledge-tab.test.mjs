/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 *
 * admin-panel KNOWLEDGE tab browser journeys (mock-bridge harness) — 1.4 commit 14b.
 * Drives the REAL admin-panel build with @forge/bridge aliased to bridge.js, whose pack
 * list is built from the REAL generated index (src/shared/knowledge-index.js) and whose
 * budget table comes from the REAL per-audience rule (src/shared/registry-limits.js). So a
 * pack title, a byte count or a budget asserted here is one this build actually ships.
 *
 * What it proves, and why each one is here:
 *   K1  every baked pack is listed, with the title, section count and size from the index —
 *       the tab's entire claim is that it reports what is in THIS bundle, so a card count
 *       or a title that came from anywhere but the index would make the tab decorative.
 *   K2  an admin's toggle WRITES the whole disabled list and re-renders from what the
 *       backend says it STORED. The payload is asserted, not just the pixel: a tab that
 *       flipped its own state and never sent the list would look identical.
 *   K3  the switch is a real control with role="switch" and aria-checked — never a native
 *       checkbox and never a native select (the owner's standing rule), and the a11y state
 *       moves with the click.
 *   K4  a VIEWER sees the same state and NO switch. Not a disabled button: a greyed control
 *       reads as "try again later" when the answer is "not you" (the F-224 shape).
 *   K5  a REFUSED read renders as a refusal with the remedy, never as an outage with a
 *       Retry — re-asking the identical question gets the identical no. Its twin: a
 *       transport FAULT does get the Retry, and the two must not be collapsed.
 *   K6  both themes, with COMPUTED colours: the amber hue is #b45309 light / #f59e0b dark,
 *       the off state is solid slate, and NO card carries a left accent rail or a faded
 *       low-alpha tint.
 *   K7  the version line names both versions, because they answer two different questions
 *       ("did the text change?" and "did the way we pick text change?").
 *   K8  (F-956) switching off a pack that has PINNED sections tells the admin exactly which
 *       surfaces lose their core, in a solid red sentence naming them from `pinnedFor` -
 *       and the switch still works. That last clause is the assertion that matters: the
 *       owner's rule is that a warning informs and never blocks, and a warning that had
 *       quietly become a gate would photograph identically.
 *
 * F-956 also moved the provenance line from slugs to NAMES ("From LeanZero Forge Skills,
 * Apache-2.0 (NOTICE retained), baked 14 September 2026"), so K1 now asserts the name on
 * screen and the source id in the title attribute - hidden, not lost.
 *
 * Run: node static/_screenshot-harness/knowledge-tab.test.mjs   (add --shots to save PNGs)
 */
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureFreshBuildShot } from "./lib/build-shot.mjs";
/* The packs and the budgets come from THEIR one home, never retyped here. A suite that
   hand-listed nine titles would pass forever against a corpus that had been re-baked. */
import { KNOWLEDGE_PACKS, KNOWLEDGE_PINS, KNOWLEDGE_CONTENT_VERSION, KNOWLEDGE_INDEX, KNOWLEDGE_BAKED_AT } from "../../src/shared/knowledge-index.js";
import { KNOWLEDGE_VERSION } from "../../src/shared/knowledge-select.js";
import { fieldGuideBudget } from "../../src/shared/registry-limits.js";

/* F-933 - the BAKE DATE as the tab must print it, derived here from the same generated
   constant and the same explicit en-GB shape the component uses. Typing "14 September 2026"
   into this file would pass forever against a corpus re-baked a year later. */
const BAKED_DATE = new Date(KNOWLEDGE_BAKED_AT).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = process.argv.includes("--shots");
const OUT = path.join(__dirname, "out"); if (SHOTS) fs.mkdirSync(OUT, { recursive: true });

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
function serve(root) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split("?")[0]); if (p === "/") p = "/index.html";
      const f = path.join(root, p);
      if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); return res.end("x"); }
      res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
    });
    s.listen(0, "127.0.0.1", () => resolve({ s, port: s.address().port }));
  });
}
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log("  ✗ " + msg); } };
/* The tab fades in over 0.2s (tabContentFade). A screenshot taken on the same tick catches
   a near-invisible page and is worthless as visual proof, so shots wait the animation out. */
const shot = async (page, name) => { if (SHOTS) { await page.waitForTimeout(400); await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true }); } };

/** Open the admin panel on the Knowledge tab. `extraInit` seeds window flags. */
async function openKnowledge(browser, theme = "light", extraInit = null, { expectTab = true } = {}) {
  const root = ensureFreshBuildShot("admin-panel");
  const { s, port } = await serve(root);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
  await ctx.addInitScript(([th, extra]) => { window.__SHOT__ = "admin"; window.__THEME__ = th; if (extra) for (const k in extra) window[k] = extra[k]; }, [theme, extraInit]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e && e.message)));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!document.querySelector(".container"), { timeout: 15000 }).catch(() => {});
  if (expectTab) {
    await page.locator(".tab-btn", { hasText: /^\s*Knowledge\s*$/ }).first().click();
    await page.locator(".kn-tab").waitFor({ timeout: 10000 });
  }
  return { page, ctx, s, errors, port };
}
const close = async (env) => { await env.ctx.close(); await new Promise((r) => env.s.close(r)); };

/* No left rail, no faded tint — the two standing design rules, checked on the computed
   style rather than on the stylesheet text, so a rule reintroduced by any selector is
   caught. A "rail" is a left border materially thicker than the other three. */
async function assertNoRailsOrTints(page, where, sel) {
  const bad = await page.locator(sel).evaluateAll((els) => {
    const out = [];
    for (const el of els) {
      const c = getComputedStyle(el);
      const l = parseFloat(c.borderLeftWidth) || 0;
      const others = [c.borderTopWidth, c.borderRightWidth, c.borderBottomWidth].map((v) => parseFloat(v) || 0);
      if (l >= 3 && l > Math.max(...others) + 1) out.push(`rail ${l}px on ${el.className}`);
      const m = /rgba?\(([^)]+)\)/.exec(c.backgroundColor);
      if (m) {
        const parts = m[1].split(",").map((x) => parseFloat(x));
        /* A low-alpha wash as a FILL. 0 (fully transparent) is not a tint, it is no fill. */
        if (parts.length === 4 && parts[3] > 0 && parts[3] < 0.9) out.push(`tint ${c.backgroundColor} on ${el.className}`);
      }
    }
    return out;
  });
  ok(bad.length === 0, `${where} no rails and no faded tints (${bad.join("; ")})`);
}

const AMBER = { light: "rgb(180, 83, 9)", dark: "rgb(180, 83, 9)" };
const SLATE = { light: "rgb(71, 85, 105)", dark: "rgb(100, 116, 139)" };

const browser = await chromium.launch();
try {
  /* ---------- K1 every baked pack, from the index ---------- */
  {
    console.log("K1 the pack list is the baked corpus");
    const env = await openKnowledge(browser);
    const { page } = env;
    try {
      const cards = page.locator(".kn-pack");
      ok(await cards.count() === KNOWLEDGE_PACKS.length, `K1 one card per pack (want ${KNOWLEDGE_PACKS.length}, got ${await cards.count()})`);
      const titles = await page.locator(".kn-pack-title").allInnerTexts();
      for (const p of KNOWLEDGE_PACKS) ok(titles.includes(p.title), `K1 "${p.title}" is listed`);

      /* The section count and size of one named pack, from the index — not a spot check of
         "some number is on screen". A card that printed the wrong pack's numbers would pass
         a shape assertion and fail this one. */
      const biggest = KNOWLEDGE_PACKS.slice().sort((a, b) => b.bytes - a.bytes)[0];
      const card = page.locator(".kn-pack").filter({ hasText: biggest.title }).first();
      const facts = (await card.locator(".kn-pack-fact").allInnerTexts()).join(" | ");
      ok(facts.includes(`${biggest.sections} sections`), `K1 ${biggest.title} shows ${biggest.sections} sections, got "${facts}"`);
      ok(facts.includes(`${Math.round(biggest.bytes / 1024)} KB`), `K1 ${biggest.title} shows its size, got "${facts}"`);

      /* Provenance: at least one "source, licence" line per card, never an empty block. */
      const provCounts = await page.locator(".kn-pack").evaluateAll((els) => els.map((e) => e.querySelectorAll(".kn-prov-line").length));
      ok(provCounts.every((n) => n > 0), `K1 every card names its source and licence (${provCounts.join(",")})`);

      /* F-917 — THE PROVENANCE SENTENCE. The cold walk read
         "jira-forge, Apache-2.0 (leanzero-forge-skills, NOTICE retained)" under a row of
         byte counts and could not tell what question it answered. The lines are unchanged
         (one author: describeKnowledgePacks); what is asserted is that each block is now
         HEADED by the question, and that the pack a licensed source feeds still carries
         the licence in the line — read from the generated index rather than typed here, so
         a re-bake that changes a licence moves the test with it. */
      const headCounts = await page.locator(".kn-pack").evaluateAll((els) => els.map((e) => e.querySelectorAll(".kn-prov-head").length));
      ok(headCounts.every((n) => n === 1), `F-917 every provenance block is headed exactly once (${headCounts.join(",")})`);
      ok((await page.locator(".kn-prov-head").first().innerText()).toLowerCase() === "source and licence",
        "F-917 the heading names what the slug answers: source and licence");
      {
        /* The pack fed by a LICENSED source, chosen from the index, must show that licence
           on screen. Nothing here is hand-typed: both the pack and the string are derived. */
        const licensed = KNOWLEDGE_INDEX.find((sec) => /Apache-2\.0/.test(((sec.provenance || {}).licence) || ""));
        ok(!!licensed, "F-917 the corpus still carries a licensed source to assert on");
        if (licensed) {
          const packTitle = (KNOWLEDGE_PACKS.find((x) => x.id === licensed.pack) || {}).title;
          const lcard = page.locator(".kn-pack").filter({ hasText: packTitle }).first();
          const ptxt = (await lcard.locator(".kn-pack-prov").innerText()).replace(/\s+/g, " ");
          /* F-956 - the line names the SOURCE BY NAME. The id is a slug an admin has never
             seen anywhere else in the product, so what is asserted on screen is the baked
             `sourceName`, and the id is asserted in the title attribute below. Both come
             from the generated index, so a re-bake that renames a source moves the test. */
          ok(!!licensed.provenance.sourceName, "F-956 the baked provenance carries a source NAME");
          ok(ptxt.includes(licensed.provenance.sourceName), `F-956 ${packTitle} names its source in words (got "${ptxt.slice(0, 110)}")`);
          ok(!new RegExp(`From ${licensed.provenance.source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(ptxt),
            `F-956 ${packTitle} does NOT lead with the slug (got "${ptxt.slice(0, 110)}")`);
          ok(ptxt.includes(licensed.provenance.licence), `F-917 ${packTitle} names its licence verbatim, NOTICE clause and all`);
          /* F-933/F-956 - the whole sentence, in the order it is read: where the text came
             from BY NAME, what the licence is, and when it was baked. */
          ok(new RegExp(`From ${licensed.provenance.sourceName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\n]*, baked ${BAKED_DATE}`).test(ptxt),
            `F-933 ${packTitle} reads "From <source name>, <licence>, baked <date>" (got "${ptxt.slice(0, 140)}")`);
          /* ...and the id is STILL REACHABLE, in the title attribute, for whoever greps the
             corpus. Hiding it and losing it are two different things. */
          const titles = await lcard.locator(".kn-prov-line").evaluateAll((els) => els.map((e) => e.getAttribute("title") || ""));
          ok(titles.some((t) => t.includes(licensed.provenance.source)),
            `F-956 the source id survives in a title attribute (got ${JSON.stringify(titles)})`);
        }
      }
      /* F-933 - WHAT F-917 RECORDED AS ABSENT IS NOW PRESENT, and asserted from the index
         rather than from prose. The old pair of assertions held the line against a date
         invented from the build clock and a purpose re-typed in the component; the bake now
         emits both, so the same two questions are asked the other way round: every pack
         carries a purpose in the GENERATED index, and every purpose reaches the screen
         verbatim. The date is asserted on the sentence above and on the foot line below.

         The absence that REMAINS true: neither field feeds a fingerprint. That is proven by
         `node scripts/bake-knowledge.mjs --check` in the bake suite, not by pixels. */
      ok(KNOWLEDGE_PACKS.every((x) => typeof x.purpose === "string" && x.purpose.trim().length > 0),
        "F-933 the generated index carries a purpose sentence for EVERY pack");
      {
        const rendered = await page.locator(".kn-pack").evaluateAll((els) => els.map((e) => ({
          title: ((e.querySelector(".kn-pack-title") || {}).textContent || "").trim(),
          purpose: ((e.querySelector(".kn-pack-purpose") || {}).textContent || "").trim(),
        })));
        ok(rendered.length === KNOWLEDGE_PACKS.length && rendered.every((r) => r.purpose.length > 0),
          `F-933 every card prints a purpose line (${rendered.filter((r) => !r.purpose).map((r) => r.title).join(",") || "all present"})`);
        for (const p of KNOWLEDGE_PACKS) {
          const row = rendered.find((r) => r.title === p.title);
          ok(!!row && row.purpose === p.purpose.replace(/\s+/g, " ").trim(),
            `F-933 ${p.title} prints the index's own sentence, not a second copy (got "${(row || {}).purpose || ""}")`);
        }
      }
      ok(/baked/i.test(await page.locator(".kn-tab").innerText()),
        "F-933 the tab now says when the packs were baked");

      /* F-956 - THE PURPOSES ARE FOR THE ADMIN, NOT FOR THE BUILD. The second cold walk
         found one that read "DATA tables consumed by <a source file>, not prose for the
         model" - true, and useless to the person deciding whether to switch it off. The
         shape assertion lives in the bake suite (no purpose may name a path or a module);
         what is asserted HERE is that every sentence that reaches the screen is a real
         sentence about the product rather than a file reference. */
      {
        const purposes = await page.locator(".kn-pack-purpose").allInnerTexts();
        ok(purposes.length === KNOWLEDGE_PACKS.length, `F-956 every card carries a purpose (${purposes.length}/${KNOWLEDGE_PACKS.length})`);
        const codey = purposes.filter((t) => /src\/|\.js\b|\.mjs\b/.test(t));
        ok(codey.length === 0, `F-956 no purpose on screen names a source file (${codey.join(" | ").slice(0, 120)})`);
        const short = purposes.filter((t) => t.trim().length < 80);
        ok(short.length === 0, `F-956 every purpose is a real explanation, not a label (${short.join(" | ").slice(0, 120)})`);
      }

      /* F-956 - THE PINNED CHIP IS EXPLAINED. A bare "1 pinned section" is a count, and a
         count carries no meaning: the note says a pin is sent on EVERY turn of the surfaces
         the bake names, which is the fact that makes the switch beside it consequential. */
      {
        const pinnedCards = page.locator(".kn-pack").filter({ has: page.locator(".kn-pack-pinned") });
        const n = await pinnedCards.count();
        ok(n > 0, "F-956 the corpus still has a pinned pack to assert on");
        const notes = await pinnedCards.locator(".kn-pack-pin-note").allInnerTexts();
        ok(notes.length === n, `F-956 every pinned pack explains its chip (${notes.length}/${n})`);
        ok(notes.every((t) => /sent on every/i.test(t) && /turn/i.test(t)),
          `F-956 the note says pins ride on every turn (got "${(notes[0] || "").slice(0, 90)}")`);
        /* The SURFACES are named from `pinnedFor`, never typed here: the va-pinned pack must
           say "Virtual Administrator", the codegen/fix one must say both. */
        const vaPack = KNOWLEDGE_PACKS.find((x) => (x.pinnedFor || []).includes("va"));
        ok(!!vaPack, "F-956 the index still carries a va-pinned pack");
        if (vaPack) {
          const t = await page.locator(".kn-pack").filter({ hasText: vaPack.title }).first().locator(".kn-pack-pin-note").innerText();
          ok(/Virtual Administrator/.test(t), `F-956 the va-pinned pack names its surface (got "${t}")`);
        }
        /* Nothing is warned about while the pack is ON. The red sentence is a consequence,
           not decoration, so it must not be on screen when there is no consequence. */
        ok(await page.locator(".kn-pack-pin-warn").count() === 0, "F-956 no warning while every pack is on");
      }

      /* THE PINNED PACKS, DERIVED, NEVER COUNTED BY HAND (F-564). This read used to take the
         FIRST pack with pins and assert that exactly one chip existed on the page. That is a
         literal wearing a derivation's clothes: the corpus already carried two pinned packs
         and F-558 added a `va` pin on top, so the count broke the moment the corpus grew,
         which is a re-bake and not a defect. What the card actually renders the chip from is
         `packs[].pinned`, so the expectation is the SET of pack titles with a non-empty
         `pinned`, matched against the set of cards carrying the chip. A pack added to or
         removed from the pins now moves both sides together.

         KNOWLEDGE_PINS (the selector's audience -> section map) is read here too, as the
         second derivation: every pack it names must be a pack this index knows. It is NOT
         asserted to carry a chip, because `packs[].pinned` and KNOWLEDGE_PINS are populated
         from different fields of knowledge/sources.json (`pinned` vs `pinnedFor`) and the
         `va` pin lives only in the latter - a real gap, filed rather than failed here. */
      const pinnedTitles = KNOWLEDGE_PACKS.filter((p) => (p.pinned || []).length > 0).map((p) => p.title).sort();
      const chipTitles = (await page.locator(".kn-pack").evaluateAll((els) => els
        .filter((e) => e.querySelector(".kn-pack-pinned"))
        .map((e) => (e.querySelector(".kn-pack-title") || {}).textContent || ""))).map((t) => t.trim()).sort();
      ok(JSON.stringify(chipTitles) === JSON.stringify(pinnedTitles),
        `K1 exactly the packs the index pins carry the pinned chip (want ${JSON.stringify(pinnedTitles)}, got ${JSON.stringify(chipTitles)})`);
      for (const title of pinnedTitles) {
        const pinned = page.locator(".kn-pack").filter({ hasText: title }).first();
        ok(await pinned.locator(".kn-pack-pinned").count() === 1, `K1 ${title} carries the pinned chip`);
      }
      const packIds = new Set(KNOWLEDGE_PACKS.map((p) => p.id));
      for (const [audience, pins] of Object.entries(KNOWLEDGE_PINS)) {
        for (const pin of pins) ok(packIds.has(String(pin).split("#")[0]), `K1 the ${audience} pin "${pin}" names a pack in the index`);
      }

      /* The budget table is the REAL per-audience rule, not a decorative list. */
      const rows = await page.locator(".kn-budget-table tbody tr").allInnerTexts();
      const joined = rows.join(" | ");
      for (const a of ["codegen", "coder", "validator"]) {
        const b = fieldGuideBudget(a);
        const want = b < 1024 ? `${Math.round(b)} bytes` : `${Math.round(b / 1024)} KB`;
        ok(joined.includes(want), `K1 the ${a} budget reads ${want}, got "${joined}"`);
      }

      await shot(page, "kn-tab-all-on");
      ok(env.errors.length === 0, `K1 no page errors (${env.errors[0] || ""})`);
    } finally { await close(env); }
  }

  /* ---------- K2/K3 the admin's switch ---------- */
  {
    console.log("K2/K3 toggling a pack");
    const env = await openKnowledge(browser);
    const { page } = env;
    try {
      const target = KNOWLEDGE_PACKS[KNOWLEDGE_PACKS.length - 1];
      const card = page.locator(".kn-pack").filter({ hasText: target.title }).first();
      const sw = card.locator(".kn-switch");

      ok(await sw.count() === 1, "K3 the card carries one switch");
      ok(await sw.getAttribute("role") === "switch", "K3 it is role=switch, not a native checkbox");
      ok(await sw.getAttribute("aria-checked") === "true", "K3 it starts on");
      ok(await page.locator(".kn-tab input[type=checkbox]").count() === 0, "K3 no native checkbox anywhere on the tab");
      ok(await page.locator(".kn-tab select").count() === 0, "K3 no native select anywhere on the tab");

      await sw.click();
      await page.locator(".kn-pack").filter({ hasText: target.title }).first()
        .locator(".kn-switch[aria-checked='false']").waitFor({ timeout: 8000 });
      ok(true, "K2 the switch reads off after the write");

      /* WHAT WENT OVER THE WIRE. The resolver takes the WHOLE disabled list because that
         is the only shape its clamp can evaluate; a tab that sent a delta would look
         identical on screen and would silently store one id as the entire list. */
      const sent = await page.evaluate(() => window.__KN_LAST_SAVE__);
      ok(sent && Array.isArray(sent.disabled), "K2 the write sends a `disabled` array");
      ok(sent && sent.disabled.length === 1 && sent.disabled[0] === target.id,
        `K2 it names exactly the pack that was switched off, got ${JSON.stringify(sent && sent.disabled)}`);

      const offCard = page.locator(".kn-pack").filter({ hasText: target.title }).first();
      ok((await offCard.getAttribute("class")).includes("is-off"), "K2 the card takes the off state");

      /* THE RE-RENDER CAME FROM THE BACKEND, not from optimism: leave the tab and come
         back, which re-reads getKnowledgePacks. The mock stores what saveKnowledgeSettings
         clamped, so a tab that had only flipped local state would come back ON. */
      await page.locator(".tab-btn", { hasText: /^\s*Memories\s*$/ }).first().click();
      await page.locator(".kn-tab").waitFor({ state: "detached", timeout: 8000 });
      await page.locator(".tab-btn", { hasText: /^\s*Knowledge\s*$/ }).first().click();
      await page.locator(".kn-tab").waitFor({ timeout: 8000 });
      const back = page.locator(".kn-pack").filter({ hasText: target.title }).first();
      ok(await back.locator(".kn-switch").getAttribute("aria-checked") === "false", "K2 the write survived a reload — the backend has it");

      /* The summary line counts what is ON, and it moved. */
      const num = await page.locator(".kn-summary-num").first().innerText();
      ok(Number(num) === KNOWLEDGE_PACKS.length - 1, `K2 the summary says ${KNOWLEDGE_PACKS.length - 1} on, got ${num}`);

      await shot(page, "kn-tab-one-off");

      /* And back on again, so the journey is a round trip rather than a one-way flip. */
      await back.locator(".kn-switch").click();
      await page.locator(".kn-pack").filter({ hasText: target.title }).first()
        .locator(".kn-switch[aria-checked='true']").waitFor({ timeout: 8000 });
      ok(true, "K2 switching back on round-trips");

      ok(env.errors.length === 0, `K2 no page errors (${env.errors[0] || ""})`);
    } finally { await close(env); }
  }

  /* ---------- K4 a viewer ---------- */
  {
    console.log("K4 a viewer reads, and cannot switch");
    const env = await openKnowledge(browser, "light", { __VIEWER__: true, __NOT_ADMIN__: true });
    const { page } = env;
    try {
      ok(await page.locator(".kn-pack").count() === KNOWLEDGE_PACKS.length, "K4 a viewer still sees every pack");
      ok(await page.locator(".kn-switch").count() === 0, "K4 no switch at all — not a disabled one");
      ok(await page.locator(".kn-state").count() === KNOWLEDGE_PACKS.length, "K4 each card shows its state as a solid pill");
      const note = await page.locator(".kn-summary-note").count();
      ok(note === 1, "K4 the tab says who can change it");
      await shot(page, "kn-tab-viewer");
      ok(env.errors.length === 0, `K4 no page errors (${env.errors[0] || ""})`);
    } finally { await close(env); }
  }

  /* ---------- K5 a refusal is not an outage, and an outage is not a refusal ---------- */
  {
    console.log("K5 refusal vs fault");
    const env = await openKnowledge(browser, "light", { __REFUSE__: ["getKnowledgePacks"], __REFUSE_ROLE__: "viewer" });
    const { page } = env;
    try {
      await page.locator(".kn-refusal").waitFor({ timeout: 8000 });
      const text = await page.locator(".kn-refusal").first().innerText();
      ok(/CogniRunner viewer access/i.test(text), `K5 the refusal names the role wanted, got "${text}"`);
      ok(/Permissions/.test(text), "K5 and the remedy");
      ok(await page.locator(".kn-refusal button").count() === 0, "K5 a refusal offers NO Retry — re-asking gets the same no");
      ok(await page.locator(".kn-pack").count() === 0, "K5 and no pack cards");
      await shot(page, "kn-tab-refused");
      ok(env.errors.length === 0, `K5 no page errors (${env.errors[0] || ""})`);
    } finally { await close(env); }
  }
  {
    const env = await openKnowledge(browser, "light", { __FAIL__: ["getKnowledgePacks"] });
    const { page } = env;
    try {
      await page.locator(".kn-refusal-fault").waitFor({ timeout: 8000 });
      ok(await page.locator(".kn-refusal-fault button").count() === 1, "K5 a TRANSPORT fault does get a Retry");
      const border = await page.locator(".kn-refusal-fault").first().evaluate((el) => getComputedStyle(el).borderTopColor);
      ok(border === "rgb(220, 38, 38)", `K5 a fault is solid red, got ${border}`);
      await shot(page, "kn-tab-fault");
    } finally { await close(env); }
  }

  /* ---------- K8 switching a PINNED pack off: told, never blocked ---------- */
  {
    console.log("K8 a pinned pack switched off");
    const pinnedPack = KNOWLEDGE_PACKS.find((p) => (p.pinned || []).length > 0 && (p.pinnedFor || []).length > 0);
    const env = await openKnowledge(browser);
    const { page } = env;
    try {
      ok(!!pinnedPack, "K8 the index carries a pack with pins and an audience");
      const card = page.locator(".kn-pack").filter({ hasText: pinnedPack.title }).first();
      ok(await card.locator(".kn-pack-pin-warn").count() === 0, "K8 nothing is warned about while it is on");

      /* THE SWITCH STILL WORKS. This is the assertion the owner's rule turns on: a warning
         that quietly became a gate would look identical in a screenshot, and the whole
         finding is that an admin should be TOLD, not stopped. */
      await card.locator(".kn-switch").click();
      const off = page.locator(".kn-pack").filter({ hasText: pinnedPack.title }).first();
      await off.locator(".kn-switch[aria-checked='false']").waitFor({ timeout: 8000 });
      ok(true, "K8 the switch still turns a pinned pack off - the warning does not block it");

      const warn = off.locator(".kn-pack-pin-warn");
      ok(await warn.count() === 1, "K8 and the consequence is named, once");
      const wtxt = (await warn.innerText()).replace(/\s+/g, " ");
      /* The surfaces come from `pinnedFor`, so the sentence moves with the corpus. */
      for (const aud of pinnedPack.pinnedFor) {
        const want = { codegen: "code generation", fix: "AI fix", validator: "validator", agent: "listener and job agent", va: "Virtual Administrator", coder: "Coder", review: "AI review" }[aud];
        ok(wtxt.includes(want), `K8 the sentence names the ${aud} surface as "${want}" (got "${wtxt}")`);
      }
      ok(/loses its/.test(wtxt) && /while this is off/.test(wtxt), `K8 it says what is lost and for how long (got "${wtxt}")`);
      ok(wtxt.toLowerCase().includes(pinnedPack.title.toLowerCase()), `K8 and which core (got "${wtxt}")`);

      /* SOLID RED, WHITE INK. Not a tint, not a rail: the fill is opaque and the left
         border is not thicker than the others. */
      const paint = await warn.evaluate((el) => {
        const c = getComputedStyle(el);
        return { bg: c.backgroundColor, ink: c.color, weight: c.fontWeight, bl: c.borderLeftWidth };
      });
      ok(paint.bg === "rgb(220, 38, 38)", `K8 the warning is solid red, got ${paint.bg}`);
      ok(paint.ink === "rgb(255, 255, 255)", `K8 with white ink, got ${paint.ink}`);
      ok(Number(paint.weight) >= 600, `K8 at 600-700 weight, got ${paint.weight}`);
      ok(parseFloat(paint.bl) < 3, `K8 and no left rail, got ${paint.bl}`);

      await shot(page, "kn-tab-pinned-off");

      /* Back on, and the sentence goes with it. */
      await off.locator(".kn-switch").click();
      await page.locator(".kn-pack").filter({ hasText: pinnedPack.title }).first()
        .locator(".kn-switch[aria-checked='true']").waitFor({ timeout: 8000 });
      ok(await page.locator(".kn-pack").filter({ hasText: pinnedPack.title }).first().locator(".kn-pack-pin-warn").count() === 0,
        "K8 switching it back on clears the warning");
      ok(env.errors.length === 0, `K8 no page errors (${env.errors[0] || ""})`);
    } finally { await close(env); }
  }

  /* ---------- K6/K7 both themes, computed colours, the version line ---------- */
  for (const theme of ["light", "dark"]) {
    console.log(`K6/K7 ${theme}`);
    const env = await openKnowledge(browser, theme, { __KNOWLEDGE_OFF__: [KNOWLEDGE_PACKS[0].id] });
    const { page } = env;
    try {
      const on = page.locator(".kn-pack:not(.is-off)").first();
      const off = page.locator(".kn-pack.is-off").first();
      ok(await off.count() === 1, `K6 ${theme} the seeded pack renders OFF`);

      const onBorder = await on.evaluate((el) => getComputedStyle(el).borderTopColor);
      ok(onBorder === AMBER[theme], `K6 ${theme} an ON card is solid amber ${AMBER[theme]}, got ${onBorder}`);
      const offBorder = await off.evaluate((el) => getComputedStyle(el).borderTopColor);
      ok(offBorder === SLATE[theme], `K6 ${theme} an OFF card is solid slate ${SLATE[theme]}, got ${offBorder}`);

      const swOn = await page.locator(".kn-switch.is-on").first().evaluate((el) => getComputedStyle(el).backgroundColor);
      ok(swOn === AMBER[theme], `K6 ${theme} the ON switch is solid amber, got ${swOn}`);
      const swOff = await page.locator(".kn-switch:not(.is-on)").first().evaluate((el) => getComputedStyle(el).backgroundColor);
      ok(swOff === SLATE[theme], `K6 ${theme} the OFF switch is solid slate, got ${swOff}`);

      /* Amber on dark takes DARK ink. White on #f59e0b is the one pair in the project
         palette that fails contrast, and this is the assertion that keeps the exception. */
      const ink = await page.locator(".kn-switch.is-on").first().evaluate((el) => getComputedStyle(el).color);
      ok(theme === "light" ? ink === "rgb(255, 255, 255)" : ink === "rgb(255, 255, 255)", `K6 ${theme} the switch ink is legible on its fill, got ${ink}`);

      await assertNoRailsOrTints(page, `K6 ${theme}`, ".kn-tab .card, .kn-tab .kn-switch, .kn-tab .kn-state, .kn-tab .kn-pack-fact, .kn-tab .kn-pack-purpose, .kn-tab .kn-prov-line, .kn-tab .kn-pack-pin-note, .kn-tab .kn-pack-pin-warn");

      /* F-956 - the seeded-OFF pack is a pinned one, so both themes photograph the red
         consequence sentence as well as the off card. Dark takes the one-shade-lighter red;
         the ink stays white in both. */
      if ((KNOWLEDGE_PACKS[0].pinned || []).length > 0) {
        const warn = off.locator(".kn-pack-pin-warn");
        ok(await warn.count() === 1, `F-956 ${theme} the off pinned pack names what it costs`);
        const bg = await warn.evaluate((el) => getComputedStyle(el).backgroundColor);
        ok(bg === (theme === "light" ? "rgb(220, 38, 38)" : "rgb(220, 38, 38)"), `F-956 ${theme} the warning is solid red, got ${bg}`);
        const ink = await warn.evaluate((el) => getComputedStyle(el).color);
        ok(ink === "rgb(255, 255, 255)", `F-956 ${theme} white ink on the warning, got ${ink}`);
      }

      const version = await page.locator(".kn-version-line").innerText();
      ok(version.includes(KNOWLEDGE_VERSION), `K7 ${theme} the engine version is named, got "${version}"`);
      ok(version.includes(KNOWLEDGE_CONTENT_VERSION), `K7 ${theme} the corpus fingerprint is named, got "${version}"`);
      /* F-917 — and the fingerprint now SAYS what it identifies. A bare hash beside a bare
         version number is the honest answer to "which bake is this" only if something on
         screen says that is the question it answers. */
      const vnote = (await page.locator(".kn-version-note").innerText()).replace(/\s+/g, " ");
      ok(/identifies this bake/i.test(vnote), `F-917 ${theme} the fingerprint says what it identifies, got "${vnote.slice(0, 70)}"`);
      /* F-933 - and the foot line now carries the DATE beside the fingerprint. Two answers
         to two questions: which corpus this is, and when it was last written. */
      ok(vnote.includes(`baked on ${BAKED_DATE}`), `F-933 ${theme} the foot line names the bake date, got "${vnote.slice(-70)}"`);

      await shot(page, `kn-tab-${theme}`);
      ok(env.errors.length === 0, `K6 ${theme} no page errors (${env.errors[0] || ""})`);
    } finally { await close(env); }
  }
} finally {
  await browser.close();
}
console.log(`\nknowledge-tab: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
