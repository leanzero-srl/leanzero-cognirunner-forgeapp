/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 *
 * THE CODER PANEL (1.4 commit 9b) — static/issue-glance/src/components/CoderPanel.jsx
 * mounted as `jira:issuePanel coder-panel`, driven through the mock bridge.
 *
 * WHAT IT PROVES, in LIGHT and DARK, because every arm carries a hue:
 *   1. the capability card's OFF arms say the reason AND the remedy, and offer no composer;
 *   2. the upgrade arm and the permission arm are DIFFERENT screens (isUpgradeRequired vs
 *      isPermissionRefusal — F-255: a billing answer must never be told as a role answer);
 *   3. ON renders the thread, and the model's text is TEXT (no element the model authored);
 *   4. a turn that halts on a consent ticket shows the ACTION and its preview, never the
 *      TICKET ID, and Confirm resumes into a final reply plus a compact actions list;
 *   5. Skip travels the same road to a different answer, and the decision it wrote is in
 *      the transcript;
 *   6. the running state uses the app's own treatment (.veil + .spin-ring), not a new one;
 *   7. the owner's rules on every rendered arm: no left accent rail, no faded accent, no
 *      native <select> and no native confirm(), solid hues with a dark override.
 *
 * Run: node static/_screenshot-harness/coder-panel.test.mjs   (--shots saves PNGs)
 */
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureFreshBuildShot } from "./lib/build-shot.mjs";
/* 1.4 commit 14b - the field-guide chip resolves baked section ids to TITLES out of the
   generated index. Both the ids the mock stamps and the titles they render come from that
   one home, so this suite cannot assert a name the corpus does not carry. */
import { KNOWLEDGE_INDEX } from "../../src/shared/knowledge-index.js";
const FG_IDS = KNOWLEDGE_INDEX
  .filter((x) => x.pack === "jira-rest-correctness" || x.pack === "cognirunner-sandbox-traps")
  .slice(0, 3).map((x) => x.id);
const FG_TITLES = [...new Set(FG_IDS.map((id) => KNOWLEDGE_INDEX.find((x) => x.id === id).title))];

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
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log("  ✗ " + msg); } };

/* The panel's hues, per theme. Agents #b45309 / #f59e0b is the Coder itself; slate is the
   neutral "off" statement; red is a named failure. Asserting the COMPUTED value is what
   makes "every new hue needs a dark-mode override" a gate rather than a hope. */
const HUE = {
  agents: { light: "rgb(180, 83, 9)", dark: "rgb(245, 158, 11)" },
  slate: { light: "rgb(71, 85, 105)", dark: "rgb(100, 116, 139)" },
  // F-463 - the SKILLS hue, the one the knowledge panel and the rule form already use.
  skills: { light: "rgb(124, 58, 237)", dark: "rgb(139, 92, 246)" },
};

const browser = await chromium.launch();

/** Mount the coder-panel with a set of harness flags, and hand the page to `body`. */
async function withPanel(flags, body) {
  const root = ensureFreshBuildShot("issue-glance");
  const { s, port } = await serve(root);
  const ctx = await browser.newContext({ viewport: { width: 460, height: 900 } });
  await ctx.addInitScript((f) => {
    window.__SHOT__ = "issue-glance";
    window.__MODULE_KEY__ = "coder-panel";
    Object.assign(window, f);
    /* The owner's hardest "never" is a native dialog. Replacing them with a recorder is the
       only way to prove a click did not open one: a confirm() in a headless browser returns
       false and the flow silently continues, which reads exactly like a pass. */
    /* F-368 - the remembered thread ids are a per-viewer localStorage convenience, so the
       panel has to survive a store that is unreadable. Writing garbage here is the only way
       to prove the try/catch is real: a browser that never throws would let a missing one
       pass. DEMO-42 is the issue key the glance context seeds. */
    if (f.__CODER_BAD_STORAGE__) { try { window.localStorage.setItem("cognirunner.coder.threads.DEMO-42", "{not json"); } catch (e) { /* nothing to do */ } }
    window.__NATIVE__ = [];
    for (const fn of ["alert", "confirm", "prompt"]) {
      window[fn] = (msg) => { window.__NATIVE__.push(fn + ":" + String(msg)); return fn === "confirm" ? true : ""; };
    }
  }, flags);
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(String(e && e.message)));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
  await page.locator(".glance").waitFor({ timeout: 15000 });
  try {
    await body(page, errors);
  } finally {
    await ctx.close(); await new Promise((r) => s.close(r));
  }
}

/* F-954 - NAME THE CONNECTION BEFORE SENDING.
   The default fixture has TWO connections, and the panel now refuses a turn that has not
   said which one it acts as (Send is disabled and the sentence asks for the pick). Every
   arm below that just wants to GET a turn started therefore has to make the pick first,
   the way a developer would. Idempotent and self-skipping: no picker (one connection, or
   none) and nothing happens, and an already-chosen connection is left alone - so it can
   stand in front of every send without asserting anything about which arm it is in. */
async function chooseConnection(page) {
  if (await page.locator(".coder-picker .dropdown").count() === 0) return;
  const trigger = page.locator(".coder-picker .dropdown-trigger");
  if (!/Choose a connection/.test(await trigger.innerText())) return;
  await trigger.click();
  await page.waitForSelector(".dropdown-panel .dropdown-item", { timeout: 6000 });
  await page.locator(".dropdown-panel .dropdown-item").first().click();
}

/* The owner's UI rules, run over whatever is on screen. Kept as ONE function so a new arm
   cannot be added without inheriting them. */
async function designRules(page, id, scope = ".glance") {
  const rails = await page.locator(scope).evaluate((el) => {
    const bad = [];
    for (const n of [el, ...el.querySelectorAll("*")]) {
      const cs = getComputedStyle(n);
      const lw = parseFloat(cs.borderLeftWidth) || 0;
      const others = ["borderTopWidth", "borderRightWidth", "borderBottomWidth"].map((k) => parseFloat(cs[k]) || 0);
      if (lw > 0 && others.some((w) => w !== lw)) bad.push((n.className || n.tagName) + ":" + cs.borderLeftWidth);
    }
    return bad;
  });
  ok(rails.length === 0, `${id} no left accent rail (${rails.join(" | ")})`);
  // No native chrome: not a <select> anywhere, and no alert/confirm/prompt was called.
  ok(await page.locator("select").count() === 0, `${id} no native <select>`);
  ok((await page.evaluate(() => window.__NATIVE__ || [])).length === 0, `${id} no native alert/confirm/prompt`);
  // Chips and filled buttons are SOLID: full opacity, and a background that is not a
  // low-alpha tint (alpha < 1 in an rgba() background is exactly the washed-out accent
  // the owner forbids).
  const faded = await page.locator(scope).evaluate((el) => {
    const bad = [];
    for (const n of el.querySelectorAll(".coder-chip, .coder-fact, .coder-btn-go, .coder-error")) {
      const cs = getComputedStyle(n);
      if (parseFloat(cs.opacity) < 1) bad.push(n.className + " opacity " + cs.opacity);
      const m = /^rgba\(.*,\s*([\d.]+)\)$/.exec(cs.backgroundColor);
      if (m && parseFloat(m[1]) < 1) bad.push(n.className + " bg " + cs.backgroundColor);
    }
    return bad;
  });
  ok(faded.length === 0, `${id} no faded accents (${faded.join(" | ")})`);
  // Em-dashes are not the app's punctuation.
  const dashes = await page.locator(scope).evaluate((el) => (el.innerText.match(/—/g) || []).length);
  ok(dashes === 0, `${id} no em-dashes in copy (${dashes})`);
}

try {
  for (const theme of ["light", "dark"]) {
    /* ---------------------------------------------------------------- 1. OFF arms.
       Every reason `agentCapability` can return that means "off", plus the read that did
       not answer. The card must carry the reason's own TITLE and REMEDY (the one table in
       src/shared/edition.js), and must NOT offer a composer: a text box that posts into a
       capability the site does not have is a refusal told as an outage. */
    for (const reason of ["needs-coder-edition", "needs-frontier-model", "allowance-exhausted", "unknown"]) {
      await withPanel({ __THEME__: theme, __CODE_CAP__: reason }, async (page, errors) => {
        const id = `off/${reason}/${theme}`;
        await page.locator(".coder-cap-off").waitFor({ timeout: 10000 });
        ok(await page.locator(".coder-composer").count() === 0, `${id} no composer on an OFF capability`);
        ok(await page.locator(".coder-thread").count() === 0, `${id} no thread on an OFF capability`);
        const txt = (await page.locator(".coder-cap-off").innerText()).trim();
        ok(txt.length > 40, `${id} the card says something substantial (got ${txt.length} chars)`);
        // The REMEDY is present, not just the verdict — an "off" with no way forward is the
        // F-233 shape this whole card exists to avoid.
        ok(await page.locator(".coder-cap-remedy").count() === 1, `${id} the remedy sentence is rendered`);
        const chipBg = await page.locator(".coder-chip-off").evaluate((el) => getComputedStyle(el).backgroundColor);
        ok(chipBg === HUE.slate[theme], `${id} the off chip is the solid slate (got ${chipBg})`);
        // The thread is NEVER read on an off capability — one refused read, not three.
        const calls = await page.evaluate(() => (window.__CALLS__ || []).map((c) => c.name));
        ok(calls.includes("getAgentCapability"), `${id} the capability WAS asked (positive control)`);
        ok(!calls.includes("getCoderThread"), `${id} no thread read behind an OFF capability`);
        await designRules(page, id);
        ok(errors.length === 0, `${id} no page errors: ${errors.join(" | ")}`);
        if (SHOTS) await page.locator(".glance").screenshot({ path: path.join(OUT, `coder-off-${reason}-${theme}.png`) });
      });
    }

    /* ------------------------------------- 1b. THE READ THAT NEVER CAME BACK (F-436).
       Distinct from every reason above: those are ANSWERS, this is a dropped request. The
       panel used to store it as `{enabled:false, reason:"unknown"}` and render "Coder off"
       with no way back, which told a developer on a flaky connection a fact about their
       instance that nobody had established. It must now say the CHECK failed, wear the
       neutral slate rather than the Coder's amber, and offer a Retry that re-asks. */
    {
      // 99 = every read rejects, so the 2/4/8 s ladder is exhausted rather than lucky.
      await withPanel({ __THEME__: theme, __CODE_CAP_FAIL__: 99 }, async (page, errors) => {
        const id = `unknown-read/${theme}`;
        await page.locator(".coder-cap-unknown").waitFor({ timeout: 25000 });
        const txt = (await page.locator(".coder-cap-unknown").innerText());
        ok(/Could not check whether the Coder is available/.test(txt), `${id} the card says the CHECK failed`);
        ok(!/Coder is off|CogniRunner Standard|Upgrade in Settings/i.test(txt), `${id} it makes no claim about the instance`);
        ok(await page.locator(".coder-cap-off").count() === 0, `${id} the OFF arm is NOT rendered for a transport failure`);
        ok(await page.locator(".coder-composer").count() === 0, `${id} still no composer - not knowing is not a yes`);
        const chipBg = await page.locator(".coder-chip-unknown").evaluate((el) => getComputedStyle(el).backgroundColor);
        ok(chipBg === HUE.slate[theme], `${id} the chip is the solid slate (got ${chipBg})`);
        const tries = await page.evaluate(() => (window.__CALLS__ || []).filter((c) => c.name === "getAgentCapability").length);
        ok(tries === 4, `${id} the read was retried on the ladder (1 + 3 tries, got ${tries})`);
        ok(!(await page.evaluate(() => (window.__CALLS__ || []).some((c) => c.name === "getCoderThread"))), `${id} no thread read behind an unknown capability`);
        await designRules(page, id);
        ok(errors.length === 0, `${id} no page errors: ${errors.join(" | ")}`);
        if (SHOTS) await page.locator(".glance").screenshot({ path: path.join(OUT, `coder-unknown-read-${theme}.png`) });

        // THE WAY BACK: the connection comes good and Retry reaches the verdict.
        await page.evaluate(() => { window.__CODE_CAP_FAIL__ = 0; });
        await page.locator(".coder-cap-unknown .coder-btn-go").click();
        await page.locator(".coder-cap-on").waitFor({ timeout: 15000 });
        ok(await page.locator(".coder-composer").count() === 1, `${id} Retry re-asks and the panel opens on the ON verdict`);
      });
    }

    /* ------------------------------------------------- 2a. the UPGRADE arm (F-255).
       An edition denial is a BILLING statement. It must not be rendered as a permission
       problem, and the sentence must name the feature from ADVANCED_FEATURES rather than
       a string the panel invents. */
    await withPanel({ __THEME__: theme, __UPGRADE__: ["getAgentCapability"], __UPGRADE_FEATURE__: "coder" }, async (page, errors) => {
      const id = `upgrade/${theme}`;
      await page.locator(".coder-cap-off").waitFor({ timeout: 10000 });
      const txt = (await page.locator(".coder-cap-off").innerText());
      ok(/This needs CogniRunner Coder\./.test(txt), `${id} the headline names the edition (got "${txt.replace(/\n/g, " ")}")`);
      /* F-915 - and it names the page the upgrade is actually ON. "Upgrade in Settings"
         sent a paying admin to the provider picker; the edition is a Marketplace
         subscription, changed under Apps, Manage apps. Both places, each with its subject. */
      ok(/Upgrade CogniRunner under Apps, Manage apps to unlock /.test(txt), `${id} the remedy is an upgrade, not a role request`);
      ok(/Settings changes the AI provider, not the edition/.test(txt), `${id} Settings is named for what it DOES change`);
      ok(!/Ask a CogniRunner admin/.test(txt), `${id} it is NOT told as a permission refusal`);
      ok(await page.locator(".coder-composer").count() === 0, `${id} no composer`);
      await designRules(page, id);
      ok(errors.length === 0, `${id} no page errors: ${errors.join(" | ")}`);
      if (SHOTS) await page.locator(".glance").screenshot({ path: path.join(OUT, `coder-upgrade-${theme}.png`) });
    });

    /* --------------------------------------------- 2b. the PERMISSION arm (F-252/F-254).
       A role floor names the LEVEL and the person who can grant it. The twin of the arm
       above: same card, entirely different sentence, and the panel must pick by the flag. */
    await withPanel({ __THEME__: theme, __REFUSE__: ["getAgentCapability"], __REFUSE_ROLE__: "editor" }, async (page, errors) => {
      const id = `refused/${theme}`;
      await page.locator(".coder-cap-off").waitFor({ timeout: 10000 });
      const txt = await page.locator(".coder-cap-off").innerText();
      ok(/CogniRunner editor access/.test(txt), `${id} the role floor is named (got "${txt.replace(/\n/g, " ")}")`);
      ok(/Ask a CogniRunner admin under Permissions/.test(txt), `${id} it names who can grant it`);
      ok(!/Upgrade in Settings/.test(txt), `${id} it is NOT told as an edition denial`);
      ok(await page.locator(".coder-composer").count() === 0, `${id} no composer`);
      await designRules(page, id);
      ok(errors.length === 0, `${id} no page errors: ${errors.join(" | ")}`);
      if (SHOTS) await page.locator(".glance").screenshot({ path: path.join(OUT, `coder-refused-${theme}.png`) });
    });

    /* ------------------------------------------------------- 3. ON + the thread renders.
       The capability facts (provider, agent model) are on screen, the transcript is there,
       and the model's text is TEXT: not one element inside a message came from the model. */
    await withPanel({ __THEME__: theme }, async (page, errors) => {
      const id = `on/${theme}`;
      await page.locator(".coder-composer").waitFor({ timeout: 10000 });
      const chipBg = await page.locator(".coder-chip-on").evaluate((el) => getComputedStyle(el).backgroundColor);
      ok(chipBg === HUE.agents[theme], `${id} the on chip is the solid agents hue (got ${chipBg})`);
      const facts = (await page.locator(".coder-cap-facts").innerText()).toLowerCase();
      ok(facts.includes("anthropic"), `${id} the provider is named (got "${facts}")`);
      ok(facts.includes("claude-sonnet-5"), `${id} the agent model is named`);
      ok(await page.locator(".coder-msg").count() === 2, `${id} the seeded thread rendered`);
      ok(await page.locator(".coder-msg-user").count() === 1 && await page.locator(".coder-msg-assistant").count() === 1,
        `${id} user and assistant rows are distinguishable`);
      /* Rule 2, asserted: inside the assistant's message there are ONLY the paragraph
         elements the panel created. A model that answered "<b>done</b>" must have produced
         no <b>, and its text must be visible verbatim. */
      const shape = await page.locator(".coder-msg-assistant").evaluate((el) => ({
        tags: [...el.querySelectorAll("*")].map((n) => n.tagName).filter((t) => t !== "P" && t !== "DIV"),
        paras: el.querySelectorAll(".coder-msg-p").length,
      }));
      ok(shape.tags.length === 0, `${id} the model's reply rendered as TEXT only (stray: ${shape.tags.join(",")})`);
      ok(shape.paras === 2, `${id} blank lines became paragraphs (got ${shape.paras})`);

      /* 1.4 commit 14b - WHAT BAKED KNOWLEDGE THIS TURN WAS SHOWN.
         The receipt rides on the USER row, because that is the turn the engine stamps
         (summarizeKnowledge, src/agent-runner.js); the reply is the model's answer to it,
         not a second injection. A chip on the assistant row would be a claim about a
         message nothing stamped - and the "TEXT only" assertion above would catch it. */
      const fgUser = page.locator(".coder-msg-user .gmc-fieldguide");
      ok(await fgUser.count() === 1, `${id} the user turn carries the field-guide chip`);
      ok(await page.locator(".coder-msg-assistant .gmc-fieldguide").count() === 0,
        `${id} and the reply does not`);
      ok(new RegExp(`Field guide: ${FG_TITLES.length} sections?`).test(await fgUser.innerText()),
        `${id} it counts the sections it can NAME, got "${await fgUser.innerText()}"`);
      ok(await fgUser.evaluate((el) => el.tagName) === "BUTTON", `${id} the chip is a real button`);
      /* Collapsed by default: the section names are long and this is provenance, not the
         subject of the conversation. */
      ok(await page.locator(".fg-chip-list").count() === 0, `${id} the section list starts collapsed`);
      await fgUser.click();
      await page.locator(".fg-chip-list").first().waitFor({ timeout: 5000 });
      const fgItems = await page.locator(".fg-chip-item").allInnerTexts();
      for (const t of FG_TITLES) ok(fgItems.includes(t), `${id} the expanded list names "${t}"`);
      /* SOLID amber in both themes, with legible ink on each - no faded tint, and the
         dark shade takes dark ink because white on #f59e0b fails contrast. */
      const fgBg = await fgUser.evaluate((el) => getComputedStyle(el).backgroundColor);
      ok(fgBg === (theme === "dark" ? "rgb(245, 158, 11)" : "rgb(180, 83, 9)"),
        `${id} the chip is solid amber for ${theme}, got ${fgBg}`);
      const fgInk = await fgUser.evaluate((el) => getComputedStyle(el).color);
      ok(fgInk === (theme === "dark" ? "rgb(42, 22, 2)" : "rgb(255, 255, 255)"),
        `${id} the chip ink is legible on its fill, got ${fgInk}`);
      await fgUser.click();
      ok(await page.locator(".fg-chip-list").count() === 0, `${id} it collapses again`);
      // The composer: a real text box, a Dry run switch that is a button with role=switch
      // (never a native checkbox), and NO connection picker while the fixture has two
      // connections... which it does, so the picker IS expected here.
      ok(await page.locator("textarea.coder-input").count() === 1, `${id} one composer input`);
      const sw = page.locator(".coder-toggle");
      ok(await sw.getAttribute("role") === "switch", `${id} Dry run is a switch, not a checkbox`);
      ok((await sw.innerText()).trim() === "Dry run", `${id} the toggle is labelled "Dry run"`);
      ok(await page.locator("input[type=checkbox]").count() === 0, `${id} no native checkbox`);
      ok(await page.locator(".coder-picker .dropdown").count() === 1, `${id} the connection picker is a CustomSelect (2 connections)`);
      await designRules(page, id);
      ok(errors.length === 0, `${id} no page errors: ${errors.join(" | ")}`);
      if (SHOTS) await page.locator(".glance").screenshot({ path: path.join(OUT, `coder-on-${theme}.png`) });
    });

    /* ------------------------------------- 3b. ONE connection: no picker, no dead control.
       The picker exists to choose BETWEEN connections; with one there is nothing to choose
       and offering it would be a control whose only value is the one already in force. */
    await withPanel({ __THEME__: theme, __CODE_NO_CONNS__: true }, async (page) => {
      const id = `on-noconns/${theme}`;
      await page.locator(".coder-composer").waitFor({ timeout: 10000 });
      ok(await page.locator(".coder-picker").count() === 0, `${id} no connection picker with no connections`);
      ok(await page.locator("textarea.coder-input").count() === 1, `${id} the composer still works`);
    });

    /* -------------------------------------- 4. a turn that halts on a CONSENT TICKET.
       The whole point of the Coder's consent model, on screen: it names the ACTION and the
       argument preview, it offers exactly three answers, and it never renders the ticket id.
       Then Confirm resumes and the final reply plus the actions list land. */
    await withPanel({ __THEME__: theme, __CODER_SLOW__: true }, async (page, errors) => {
      const id = `ticket/${theme}`;
      await page.locator(".coder-composer").waitFor({ timeout: 10000 });
      await page.locator("textarea.coder-input").fill("Open the PR when the branch is green.");
      await chooseConnection(page);
      await page.locator(".coder-composer .coder-btn-go").click();

      // 6. the running state is the app's OWN treatment, and it is over the composer.
      await page.locator(".veil").waitFor({ timeout: 5000 });
      ok(await page.locator(".veil .spin-ring").count() === 1, `${id} the running state uses the MLS spinner`);
      ok(/Working/.test(await page.locator(".veil-label").innerText()), `${id} the running state says what it is doing`);

      await page.locator(".coder-consent").waitFor({ timeout: 20000 });
      /* F-915 - THE CONSENT HEAD IS A SENTENCE, NOT AN IDENTIFIER. It read
         `open_pull_request` over a grid of schema keys, to the person being asked to
         authorise a write on their own repository. The words come from
         src/shared/agent-actions.js, which is where the ids live too. */
      const head = await page.locator(".coder-consent-action").innerText();
      ok(head === "Open a pull request on acme/web from proj-42-retry-guard into main (draft: no)",
        `${id} the action is a sentence naming repo, both branches and the draft flag (got "${head}")`);
      ok(!/open_pull_request|[a-z]+_[a-z]+/.test(head), `${id} no engine identifier survives into the consent head`);
      const args = await page.locator(".coder-consent-args").innerText();
      ok(args.includes("proj-42-retry-guard"), `${id} the argument preview is shown (got "${args}")`);
      /* F-374 - the preview is an OBJECT and is rendered as KEY/VALUE ROWS. Every schema key
         the engine put in it has a row, and a boolean is still a VALUE: "this PR is not a
         draft" is a statement, never an absence. F-915 changed only the two vocabularies
         around it - the key is the reader's word for the key, and a boolean is spelled
         "no" rather than "false", which is the same statement in the reader's language. */
      const rows = await page.locator(".coder-arg-row").evaluateAll((els) =>
        els.map((el) => [el.querySelector(".coder-arg-k").innerText, el.querySelector(".coder-arg-v").innerText]));
      const byKey = Object.fromEntries(rows);
      ok(rows.length === 6, `${id} every preview key has a row (got ${rows.length}: ${rows.map((r) => r[0]).join(",")})`);
      ok(byKey.Repository === "acme/web" && byKey["Source branch"] === "proj-42-retry-guard" && byKey["Target branch"] === "main",
        `${id} the preview rows read as words and carry their values (got ${JSON.stringify(byKey)})`);
      ok(byKey.Draft === "no", `${id} a FALSE boolean is still printed as a value (got ${JSON.stringify(byKey.Draft)})`);
      ok(!rows.some((r) => /[a-z]+[A-Z]|_/.test(r[0])), `${id} no schema key is printed raw (got ${rows.map((r) => r[0]).join(",")})`);
      ok(errors.length === 0, `${id} the object preview did not throw during render (${errors.join(" | ")})`);
      // Rule 3 — the ticket id is a capability handle, never copy. Asserted over the WHOLE
      // panel text and the DOM's attributes, because "not rendered" has to include a title=.
      const leak = await page.locator(".glance").evaluate((el) => {
        const html = el.innerHTML;
        return { text: el.innerText.includes("ct_9f31c0de"), dom: html.includes("ct_9f31c0de") };
      });
      ok(!leak.text && !leak.dom, `${id} the ticket id is NOT rendered (text ${leak.text}, dom ${leak.dom})`);
      const btns = await page.locator(".coder-consent-btns .coder-btn").allInnerTexts();
      ok(btns.join("|") === "Confirm|Change|Skip", `${id} three answers, in order (got ${btns.join("|")})`);
      const goBg = await page.locator(".coder-consent-btns .coder-btn-go").evaluate((el) => getComputedStyle(el).backgroundColor);
      ok(goBg === HUE.agents[theme], `${id} Confirm is a solid filled button (got ${goBg})`);

      // Change opens an INLINE box, not a native prompt.
      await page.locator(".coder-consent-btns .coder-btn-alt").first().click();
      ok(await page.locator(".coder-change textarea").count() === 1, `${id} Change opens an inline text box`);
      ok((await page.evaluate(() => window.__NATIVE__ || [])).length === 0, `${id} Change opened no native prompt`);
      await page.locator(".coder-consent-btns .coder-btn-alt").first().click(); // close it again

      if (SHOTS) await page.locator(".glance").screenshot({ path: path.join(OUT, `coder-ticket-${theme}.png`) });
      await designRules(page, id);

      // --- Confirm resumes -------------------------------------------------------
      await page.locator(".coder-consent-btns .coder-btn-go").click();
      await page.locator(".coder-outcome").waitFor({ timeout: 20000 });
      ok(await page.locator(".coder-consent").count() === 0, `${id} the consent row is gone once answered`);
      const sent = await page.evaluate(() => window.__CODER_LAST_DECISION__ || {});
      ok(sent.decision === "confirm" && sent.ticketId === "ct_9f31c0de", `${id} the decision carried the ticket id back on the wire`);
      const actions = await page.locator(".coder-action").allInnerTexts();
      ok(actions.length === 1 && /Open a pull request/.test(actions[0]) && /ok/i.test(actions[0]) && /ms/.test(actions[0]),
        `${id} the actions list shows the action's NAME, verdict and ms (got ${JSON.stringify(actions)})`);
      ok(!/open_pull_request/.test(actions[0]), `${id} the actions list does not print the action id`);
      /* F-915 - WHAT THE CONFIRMED STEP PRODUCED, as a link. The engine has always built
         it for the step comment it writes onto the issue; it now rides the confirm answer
         so the panel can offer it, and the reader is not left to find the pull request the
         Coder just opened by reading the model's sentence. */
      const link = await page.locator(".coder-link").first();
      ok(await page.locator(".coder-link-row").count() === 1, `${id} the confirmed step's artifact is offered as one link row`);
      // innerText is the RENDERED text and the chip is text-transform:uppercase.
      ok(/^pull request$/i.test(await page.locator(".coder-link-kind").innerText()), `${id} the link says what KIND of thing it is`);
      ok(/^https:\/\//.test(await link.getAttribute("href")), `${id} the link is an http(s) URL`);
      ok((await link.getAttribute("rel") || "").includes("noreferrer"), `${id} the outbound link carries rel=noreferrer`);
      const okDot = await page.locator(".coder-action-ok").evaluate((el) => getComputedStyle(el).backgroundColor);
      ok(okDot === (theme === "dark" ? "rgb(34, 197, 94)" : "rgb(22, 163, 74)"), `${id} the ok dot is the solid green (got ${okDot})`);
      const foot = await page.locator(".coder-outcome-foot").innerText();
      /* F-915 - "ended by final" was the engine's field printed raw, and `final` was not
         even one of `runAgentLoop`'s endings: the mock had invented it and nothing could
         tell, because the panel rendered whatever string arrived. The fixture now speaks
         the loop's vocabulary and the panel renders one word per ending. */
      ok(/finished/.test(foot) && !/ended by/.test(foot), `${id} the turn says how it ended, in words (got "${foot}")`);
      // The reply is on screen exactly ONCE: the transcript re-read owns it after a turn.
      const replies = await page.locator(".glance").evaluate((el) => (el.innerText.match(/acme\/web #418/g) || []).length);
      ok(replies === 1, `${id} the reply appears once, not twice (got ${replies})`);
      // The decision is in the transcript, written by code and kept verbatim ON THE WIRE.
      ok(await page.locator(".coder-msg-decision").count() === 1, `${id} the decision row is in the thread`);
      /* F-915 - ...and RE-TOLD on screen. The stored row is addressed to the model
         ("DECISION: the user CONFIRMED open_pull_request and it was performed.") and was
         being shown to the person who made the decision. The parser has one home and a
         gate of its own in refusal-contract.test.mjs; this asserts the panel uses it. */
      const said = await page.locator(".coder-msg-decision .coder-msg-p").innerText();
      ok(said === "You confirmed: open a pull request. Done.", `${id} the decision reads as the reader's own sentence (got "${said}")`);
      ok(!/DECISION:|open_pull_request/.test(said), `${id} the model-facing row is not what the reader is shown`);
      /* The transcript is a scroll box, so "rendered" is not "visible". This turn's answer
         must be IN VIEW, not below the fold of the box — the defect the commit's own
         screenshots caught, where the reply existed in the DOM and nobody could see it. */
      const visible = await page.locator(".coder-thread").evaluate((el) => {
        const last = el.lastElementChild;
        if (!last) return { ok: false, why: "no messages" };
        const box = el.getBoundingClientRect(), row = last.getBoundingClientRect();
        return { ok: row.bottom <= box.bottom + 2 && row.bottom > box.top, why: `row.bottom ${Math.round(row.bottom)} vs box.bottom ${Math.round(box.bottom)}` };
      });
      ok(visible.ok, `${id} the newest message is scrolled into view (${visible.why})`);
      ok(errors.length === 0, `${id} no page errors: ${errors.join(" | ")}`);
      if (SHOTS) await page.locator(".glance").screenshot({ path: path.join(OUT, `coder-confirmed-${theme}.png`) });
    });

    /* ------------------------------------------- 4b. F-374: THE BLAST-RADIUS ARGUMENTS.
       F-363 put the fields that change what an action DOES into the preview; F-374 is that
       the screen could not render them. These two arms are the ones the finding names:
       `create_repo` with `private:false` (public repository) and `trigger_deploy` with a
       NESTED `inputs` (which environment). Both must be readable, key by key. */
    for (const [action, must, sentence] of [
      ["create_repo", { "Private": "no", "Org": "acme", "Name": "acme-internal" },
        "Create a repository named acme-internal in acme (visible to everyone)"],
      ["trigger_deploy", { "Inputs, environment": "production", "Inputs, canary": "no", "Inputs, batch": "4", "Workflow": "deploy.yml" },
        "Trigger a deployment deploy.yml on acme/web for main (environment: production)"],
    ]) {
      await withPanel({ __THEME__: theme, __CODER_TICKET__: action }, async (page, errors) => {
        const id = `args/${action}/${theme}`;
        await page.locator(".coder-composer").waitFor({ timeout: 10000 });
        await page.locator("textarea.coder-input").fill("Do it.");
        await chooseConnection(page);
        await page.locator(".coder-composer .coder-btn-go").click();
        await page.locator(".coder-consent").waitFor({ timeout: 20000 });
        /* F-915 - the blast-radius argument reaches the SENTENCE as well as its row:
           "visible to everyone" for a public repository, the environment for a deploy. */
        ok(await page.locator(".coder-consent-action").innerText() === sentence,
          `${id} the action reads as a sentence (want "${sentence}", got "${await page.locator(".coder-consent-action").innerText()}")`);
        const rows = await page.locator(".coder-arg-row").evaluateAll((els) =>
          Object.fromEntries(els.map((el) => [el.querySelector(".coder-arg-k").innerText, el.querySelector(".coder-arg-v").innerText])));
        for (const [k, v] of Object.entries(must)) {
          ok(rows[k] === v, `${id} ${k} reads "${v}" (got ${JSON.stringify(rows[k])})`);
        }
        // The three answers are still there: a preview that renders is worth nothing if the
        // buttons under it went missing with it.
        ok(await page.locator(".coder-consent-btns .coder-btn").count() === 3, `${id} the three answers are still offered`);
        ok(errors.length === 0, `${id} no page errors: ${errors.join(" | ")}`);
        await designRules(page, id);
        if (SHOTS) await page.locator(".glance").screenshot({ path: path.join(OUT, `coder-args-${action}-${theme}.png`) });
      });
    }

    /* --------------------------------- 4c. F-374: the ticket that OUTLIVED the page.
       On a reload the thread record carries the ticket id and nothing else, so the panel
       has no action and no preview. It must not render an empty preview (which would read
       as "this action takes no arguments" over a live write) and it must still offer the
       way out. */
    await withPanel({ __THEME__: theme, __CODER_PENDING__: true }, async (page, errors) => {
      const id = `pending/${theme}`;
      await page.locator(".coder-consent").waitFor({ timeout: 15000 });
      ok(await page.locator(".coder-arg-row").count() === 0, `${id} no invented preview rows`);
      const text = await page.locator(".coder-consent-args").innerText();
      ok(/not kept when the page reloaded/i.test(text) && /Nothing has run/i.test(text),
        `${id} the panel says the details are unavailable (got "${text}")`);
      ok(await page.locator(".coder-consent-btns .coder-btn").count() === 3, `${id} Confirm, Change and Skip are still offered`);

      /* F-954 - ...AND THE CARD RECOMMENDS WHAT ITS OWN SENTENCE RECOMMENDS.
         The copy above says nothing has run and to skip and ask again, while the row
         underneath put Confirm first, solid, in the affirmative hue. A reader who trusts
         the layout over the paragraph authorises a write that nothing on screen can
         describe. So on THIS card the primary is Skip and Confirm cannot be pressed. */
      const order = await page.locator(".coder-consent-btns .coder-btn").allInnerTexts();
      ok(order.join("|") === "Skip|Change|Confirm", `${id} the degraded card leads with Skip (got ${order.join("|")})`);
      const skipBtn = page.locator(".coder-consent-skip");
      const confirmBtn = page.locator(".coder-consent-confirm");
      const skipBg = await skipBtn.evaluate((el) => getComputedStyle(el).backgroundColor);
      ok(skipBg === HUE.agents[theme], `${id} Skip is the solid primary (got ${skipBg})`);
      ok(await skipBtn.evaluate((el) => getComputedStyle(el).color) === (theme === "dark" ? "rgb(42, 22, 2)" : "rgb(255, 255, 255)"),
        `${id} with legible ink on its fill`);
      ok(await confirmBtn.isDisabled(), `${id} Confirm cannot be pressed without a preview`);
      // A control says WHAT IT NEEDS, on screen and on the control itself.
      ok(await page.locator(".coder-consent-why").innerText() === "Confirm needs the full preview",
        `${id} the disabled Confirm says what it is waiting for`);
      ok(await confirmBtn.getAttribute("title") === "Confirm needs the full preview", `${id} the control carries the same sentence`);
      // Pressed anyway, it must not reach the backend: a disabled button that still
      // decides is the defect wearing a different coat.
      await confirmBtn.click({ force: true }).catch(() => { /* disabled: the point */ });
      ok(!(await page.evaluate(() => (window.__CALLS__ || []).some((c) => c.name === "confirmCoderTicket"))),
        `${id} a forced click on the disabled Confirm reached no resolver`);
      ok(errors.length === 0, `${id} no page errors: ${errors.join(" | ")}`);
      await designRules(page, id);
      if (SHOTS) await page.locator(".glance").screenshot({ path: path.join(OUT, `coder-pending-${theme}.png`) });

      // The way out the sentence names actually works, and travels as a SKIP.
      await skipBtn.click();
      await page.locator(".coder-outcome").waitFor({ timeout: 20000 });
      const sent = await page.evaluate(() => window.__CODER_LAST_DECISION__ || {});
      ok(sent.decision === "skip", `${id} the recommended answer is the one that travels (got ${sent.decision})`);
    });

    /* ---------------------------------- 4c-ii. F-954: the FULL card is UNCHANGED.
       The reordering is a statement about a card that cannot describe its write, and it
       must not become a statement about every consent. With a preview on screen the
       affirmative is first, solid, and pressable - and no "needs the full preview"
       sentence appears anywhere, because nothing is missing. */
    await withPanel({ __THEME__: theme }, async (page, errors) => {
      const id = `full-card/${theme}`;
      await page.locator(".coder-composer").waitFor({ timeout: 10000 });
      await chooseConnection(page);
      await page.locator("textarea.coder-input").fill("Open the PR.");
      await page.locator(".coder-composer .coder-btn-go").click();
      await page.locator(".coder-consent").waitFor({ timeout: 20000 });
      const order = await page.locator(".coder-consent-btns .coder-btn").allInnerTexts();
      ok(order.join("|") === "Confirm|Change|Skip", `${id} the full card still leads with Confirm (got ${order.join("|")})`);
      ok(!(await page.locator(".coder-consent-confirm").isDisabled()), `${id} and Confirm is pressable`);
      ok(await page.locator(".coder-consent-why").count() === 0, `${id} no "needs the full preview" sentence where the preview is present`);
      const goBg = await page.locator(".coder-consent-confirm").evaluate((el) => getComputedStyle(el).backgroundColor);
      ok(goBg === HUE.agents[theme], `${id} Confirm is still the solid primary (got ${goBg})`);
      await designRules(page, id);
      ok(errors.length === 0, `${id} no page errors: ${errors.join(" | ")}`);
      if (SHOTS) await page.locator(".glance").screenshot({ path: path.join(OUT, `coder-full-card-${theme}.png`) });
    });

    /* ------------------------------------------- 4d. F-374: the ERROR BOUNDARY is real.
       A render fault used to unmount the whole right rail to a blank iframe. The mock
       forces one (a transcript row whose `content` throws when React reads it) and the
       panel must come back as a NAMED failure in the app's solid red, with a Reload. */
    await withPanel({ __THEME__: theme, __CODER_BOOM__: true }, async (page) => {
      const id = `boundary/${theme}`;
      await page.locator(".cr-boundary").waitFor({ timeout: 15000 });
      const text = await page.locator(".cr-boundary").innerText();
      ok(/couldn't be displayed/i.test(text), `${id} the failure is named (got "${text}")`);
      ok(/Nothing was run/i.test(text), `${id} it says what it means for a pending write`);
      const btn = page.locator(".cr-boundary-btn");
      ok(await btn.count() === 1 && (await btn.innerText()).trim() === "Reload", `${id} there is one way out, and it reloads`);
      const bg = await page.locator(".cr-boundary").evaluate((el) => getComputedStyle(el).backgroundColor);
      ok(bg === (theme === "dark" ? "rgb(239, 68, 68)" : "rgb(220, 38, 38)"), `${id} the banner is the app's solid red (got ${bg})`);
      // The rail is not blank: the app's own header survived the fault.
      ok(await page.locator(".glance-head").count() === 1, `${id} the panel header is still on screen`);
      await designRules(page, id);
      if (SHOTS) await page.locator(".glance").screenshot({ path: path.join(OUT, `coder-boundary-${theme}.png`) });
    });

    /* ------------------------------------------------------------------- 5. the SKIP path.
       Same road, different answer: nothing was performed, the actions list is empty rather
       than absent-by-accident, and the transcript records the refusal so the next turn
       cannot quietly retry it. */
    await withPanel({ __THEME__: theme }, async (page, errors) => {
      const id = `skip/${theme}`;
      await page.locator(".coder-composer").waitFor({ timeout: 10000 });
      await page.locator("textarea.coder-input").fill("Open the PR.");
      await chooseConnection(page);
      await page.locator(".coder-composer .coder-btn-go").click();
      await page.locator(".coder-consent").waitFor({ timeout: 20000 });
      await page.locator(".coder-consent-btns .coder-btn-alt").nth(1).click(); // Skip
      await page.locator(".coder-outcome").waitFor({ timeout: 20000 });
      const sent = await page.evaluate(() => window.__CODER_LAST_DECISION__ || {});
      ok(sent.decision === "skip", `${id} the wire carried decision "skip" (got ${sent.decision})`);
      ok(await page.locator(".coder-action").count() === 0, `${id} nothing was performed, so no actions are listed`);
      const thread = await page.locator(".coder-thread").innerText();
      /* F-915 - the row on the WIRE still says "DECISION: the user SKIPPED …" (the model
         reads it next turn); the row on SCREEN is the reader's own sentence. */
      ok(/You skipped: open a pull request\. Nothing ran\./.test(thread),
        `${id} the refusal is recorded in the transcript, in the reader's words (got "${thread.slice(-160)}")`);
      ok(!/SKIPPED|open_pull_request/.test(thread), `${id} the model-facing wording is not what the reader is shown`);
      ok(await page.locator(".coder-error").count() === 0, `${id} a Skip is not an error`);
      await designRules(page, id);
      ok(errors.length === 0, `${id} no page errors: ${errors.join(" | ")}`);
      if (SHOTS) await page.locator(".glance").screenshot({ path: path.join(OUT, `coder-skip-${theme}.png`) });
    });

    /* --------------------------------- 5b. a decision that was RECORDED but not RESUMED.
       The backend's own tail case (confirmCoderTicket's catch): the write happened and the
       follow-up turn did not start. The user must be told, not left on a spinner. */
    await withPanel({ __THEME__: theme, __CODER_NO_RESUME__: true }, async (page) => {
      const id = `no-resume/${theme}`;
      await page.locator(".coder-composer").waitFor({ timeout: 10000 });
      await page.locator("textarea.coder-input").fill("Open the PR.");
      await chooseConnection(page);
      await page.locator(".coder-composer .coder-btn-go").click();
      await page.locator(".coder-consent").waitFor({ timeout: 20000 });
      await page.locator(".coder-consent-btns .coder-btn-go").click();
      await page.locator(".coder-error").waitFor({ timeout: 10000 });
      const msg = await page.locator(".coder-error").innerText();
      ok(/could not be resumed/.test(msg), `${id} the banner names what actually failed (got "${msg}")`);
      const bg = await page.locator(".coder-error").evaluate((el) => getComputedStyle(el).backgroundColor);
      ok(bg === (theme === "dark" ? "rgb(239, 68, 68)" : "rgb(220, 38, 38)"), `${id} the banner is solid red (got ${bg})`);
      ok(await page.locator(".veil").count() === 0, `${id} the panel is not left spinning`);
      await designRules(page, id);
      if (SHOTS) await page.locator(".glance").screenshot({ path: path.join(OUT, `coder-noresume-${theme}.png`) });
    });

    /* ------------------------------------------------- 5c. a ticket ANSWERED TWICE.
       The engine answers `{ duplicate: true }` rather than performing the write again; the
       panel must clear the chip and say so instead of reading it as a failure. */
    await withPanel({ __THEME__: theme, __CODER_DUPLICATE__: true }, async (page) => {
      const id = `duplicate/${theme}`;
      await page.locator(".coder-composer").waitFor({ timeout: 10000 });
      await page.locator("textarea.coder-input").fill("Open the PR.");
      await chooseConnection(page);
      await page.locator(".coder-composer .coder-btn-go").click();
      await page.locator(".coder-consent").waitFor({ timeout: 20000 });
      await page.locator(".coder-consent-btns .coder-btn-go").click();
      await page.locator(".coder-error").waitFor({ timeout: 10000 });
      ok(/already been answered/.test(await page.locator(".coder-error").innerText()), `${id} it says the answer was already given`);
      ok(await page.locator(".coder-consent").count() === 0, `${id} the consent row is cleared`);
    });

    /* ------------------------------------------- 7. a turn that just ANSWERS (no ticket).
       The plain road, and the one that carries a FAILED action: ok:false must read as
       failed in its own solid red, so a half-successful turn cannot look clean. */
    await withPanel({ __THEME__: theme, __CODER_SCENARIO__: "plain" }, async (page, errors) => {
      const id = `plain/${theme}`;
      await page.locator(".coder-composer").waitFor({ timeout: 10000 });
      await page.locator("textarea.coder-input").fill("Add the retry guard.");
      await chooseConnection(page);
      await page.locator(".coder-composer .coder-btn-go").click();
      await page.locator(".coder-outcome").waitFor({ timeout: 20000 });
      ok(await page.locator(".coder-consent").count() === 0, `${id} no consent row on a plain turn`);
      ok(await page.locator(".coder-action").count() === 3, `${id} every action is listed`);
      ok(await page.locator(".coder-action-bad").count() === 1, `${id} the failed action is marked failed`);
      const badDot = await page.locator(".coder-action-bad").evaluate((el) => getComputedStyle(el).backgroundColor);
      ok(badDot === (theme === "dark" ? "rgb(239, 68, 68)" : "rgb(220, 38, 38)"), `${id} the failed dot is solid red (got ${badDot})`);
      ok(/3 rounds/.test(await page.locator(".coder-outcome-foot").innerText()), `${id} the rounds are counted`);
      /* F-371: the thread has turns, so the Dry run switch is NOT a choice any more -
         the engine refuses a mid-thread flip, and a control that still looks live would be
         the panel promising something the engine has already decided. */
      ok(await page.locator(".coder-toggle").isDisabled(), `${id} Dry run is locked once the conversation has a turn`);
      const lockNote = await page.locator(".coder-lock-note").innerText();
      ok(/start a new conversation to change it/i.test(lockNote), `${id} the locked state says how to change it (got "${lockNote}")`);
      ok(/live run/.test(lockNote), `${id} the locked state names what this conversation runs as`);

      /* The wire, proven where the choice actually lives: a NEW conversation. Dry run must
         travel as `simulation: true` on its FIRST turn. */
      await page.locator(".coder-newconv").click();
      await page.waitForFunction(() => document.querySelectorAll(".coder-msg").length === 0, { timeout: 8000 });
      ok(!(await page.locator(".coder-toggle").isDisabled()), `${id} a new conversation makes Dry run a choice again`);
      ok(await page.locator(".coder-lock-note").count() === 0, `${id} and drops the locked sentence`);
      await page.locator(".coder-toggle").click();
      await page.locator("textarea.coder-input").fill("Again, but do not write anything.");
      await chooseConnection(page);
      await page.locator(".coder-composer .coder-btn-go").click();
      await page.locator(".coder-outcome").waitFor({ timeout: 20000 });
      const start = await page.evaluate(() => window.__CODER_LAST_START__ || {});
      ok(start.simulation === true, `${id} Dry run sends simulation: true (got ${start.simulation})`);
      ok(await page.locator(".coder-toggle").isDisabled(), `${id} and the first turn locks it again`);
      ok(errors.length === 0, `${id} no page errors: ${errors.join(" | ")}`);
      if (SHOTS) await page.locator(".glance").screenshot({ path: path.join(OUT, `coder-plain-${theme}.png`) });
    });

    /* ------------------------------------ 8. F-368: a SECOND conversation, and back.
       The defect: one thread per person per issue forever. A developer who wants a fresh
       plan on the same issue could only get it with the old thread's history and its
       compaction pins attached, because nothing on screen started a new one.

       What is asserted: the button exists and is the app's OWN control; pressing it mints
       a `t_<timestamp>` id and sends THAT id on the next turn; the transcript it opens is
       EMPTY rather than the previous conversation's; the switcher then lists both and can
       go back; and the ids the browser remembers survive a reload of the panel. */
    await withPanel({ __THEME__: theme }, async (page, errors) => {
      const id = `threads/${theme}`;
      await page.locator(".coder-composer").waitFor({ timeout: 10000 });

      // With nothing remembered there is ONE thread, so no switcher - just the button.
      ok(await page.locator(".coder-newconv").count() === 1, `${id} the new-conversation button is offered`);
      ok(await page.locator(".coder-thread-list").count() === 0, `${id} no switcher while there is only one conversation`);
      ok(await page.locator(".coder-msg").count() === 2, `${id} the first conversation has its transcript`);
      const firstThreadId = await page.evaluate(() => {
        const c = (window.__CALLS__ || []).filter((x) => x.name === "getCoderThread");
        return c.length ? c[0].payload.threadId : null;
      });
      ok(/^p_/.test(String(firstThreadId)), `${id} the default thread is still the stable per-person id (got ${firstThreadId})`);

      // Start a new one. No native dialog, an EMPTY transcript, and a minted t_<ts> id.
      await page.locator(".coder-newconv").click();
      await page.waitForFunction(() => document.querySelectorAll(".coder-msg").length === 0, { timeout: 8000 });
      ok((await page.evaluate(() => window.__NATIVE__ || [])).length === 0, `${id} starting a conversation opened no native confirm`);
      ok(await page.locator(".coder-msg").count() === 0, `${id} the new conversation starts empty`);
      const askedIds = await page.evaluate(() => (window.__CALLS__ || []).filter((c) => c.name === "getCoderThread").map((c) => c.payload.threadId));
      const newThreadId = askedIds[askedIds.length - 1];
      ok(/^t_\d+$/.test(String(newThreadId)), `${id} the new conversation is a minted t_<timestamp> (got ${newThreadId})`);
      ok(newThreadId !== firstThreadId, `${id} it is NOT the default thread`);

      // The switcher now lists both, labels neither with a raw id, and the current one is
      // the solid agents hue (the "you are here" statement, never a tint).
      const chips = page.locator(".coder-thread-chip");
      ok(await chips.count() === 2, `${id} the switcher lists both conversations (got ${await chips.count()})`);
      const chipText = (await chips.allInnerTexts()).join("|");
      ok(!/p_|t_\d/.test(chipText), `${id} a thread id is never printed on a chip (got "${chipText}")`);
      ok(/First conversation/.test(chipText), `${id} the default thread is named "First conversation"`);
      const curBg = await page.locator(".coder-thread-chip.is-current").evaluate((el) => getComputedStyle(el).backgroundColor);
      ok(curBg === HUE.agents[theme], `${id} the current conversation chip is the solid agents hue (got ${curBg})`);

      // A turn in the new conversation travels on the NEW id.
      await page.locator("textarea.coder-input").fill("Start again, from the issue only.");
      await chooseConnection(page);
      await page.locator(".coder-composer .coder-btn-go").click();
      await page.locator(".coder-consent").waitFor({ timeout: 20000 });
      const start = await page.evaluate(() => window.__CODER_LAST_START__ || {});
      ok(start.threadId === newThreadId, `${id} the turn was started on the new thread (got ${start.threadId})`);

      // Go BACK. The first conversation's transcript returns; nothing was lost.
      await page.locator(".coder-consent-btns .coder-btn-alt").nth(1).click(); // Skip, to clear the ticket
      await page.locator(".coder-outcome").waitFor({ timeout: 20000 });
      await page.locator(".coder-thread-chip", { hasText: "First conversation" }).click();
      await page.waitForFunction(() => document.querySelectorAll(".coder-msg-assistant").length > 0, { timeout: 8000 });
      const backText = await page.locator(".coder-thread").innerText();
      ok(/retry guard/i.test(backText), `${id} switching back shows the FIRST conversation again`);
      ok(await page.locator(".coder-consent").count() === 0, `${id} the other conversation's consent chip did not follow the switch`);

      await designRules(page, id);
      ok(errors.length === 0, `${id} no page errors: ${errors.join(" | ")}`);
      if (SHOTS) await page.locator(".glance").screenshot({ path: path.join(OUT, `coder-threads-${theme}.png`) });
    });

    /* --------------------------- 8b. the remembered ids are a CONVENIENCE, not a record.
       localStorage is per viewer and can be empty, stale or unreadable, so the panel has to
       render correctly with NOTHING stored (the arm above) and with a garbage value. Neither
       may take the panel down: the default conversation is always reachable. */
    await withPanel({ __THEME__: theme, __CODER_BAD_STORAGE__: true }, async (page, errors) => {
      const id = `threads-garbage/${theme}`;
      await page.locator(".coder-composer").waitFor({ timeout: 10000 });
      ok(await page.locator(".coder-newconv").count() === 1, `${id} the panel still renders with unreadable stored threads`);
      ok(await page.locator(".coder-thread-list").count() === 0, `${id} a garbage store lists no conversations`);
      ok(errors.length === 0, `${id} no page errors: ${errors.join(" | ")}`);
    });

    /* ------------------------------- 9. F-371: the engine's simulation-locked refusal.
       The F-360 engine half refuses a mid-thread dry-run flip rather than converting a
       simulated thread into a live-writing one. Before this, the panel had no arm for it
       and painted the raw reason into a generic red banner. The refusal arrives through
       the QUEUE, so this drives the whole road: a turn, then the poll's refusal. */
    await withPanel({ __THEME__: theme, __CODER_SIM_LOCKED__: true }, async (page, errors) => {
      const id = `sim-locked/${theme}`;
      await page.locator(".coder-composer").waitFor({ timeout: 10000 });
      await page.locator("textarea.coder-input").fill("Do it for real this time.");
      await chooseConnection(page);
      await page.locator(".coder-composer .coder-btn-go").click();
      await page.locator(".coder-error").waitFor({ timeout: 20000 });
      const msg = await page.locator(".coder-error").innerText();
      ok(/start a new conversation to change it/i.test(msg), `${id} the refusal is told in the app's own sentence (got "${msg}")`);
      ok(/dry run/i.test(msg), `${id} it names what the conversation actually runs as`);
      ok(!/simulation-locked/.test(msg), `${id} the raw reason CODE never reaches the screen`);
      // The toggle is put back to the thread's truth, and locked.
      ok(await page.locator(".coder-toggle").getAttribute("aria-checked") === "true", `${id} the switch is put back to the thread's real mode`);
      ok(await page.locator(".coder-toggle").isDisabled(), `${id} and is locked, so the same refusal cannot be provoked twice`);
      ok(await page.locator(".coder-lock-note").count() === 1, `${id} the locked sentence is on the control as well as in the banner`);
      ok(await page.locator(".veil").count() === 0, `${id} the panel is not left spinning`);
      ok(await page.locator(".coder-newconv").count() === 1, `${id} the way out named by the sentence is on screen`);
      await designRules(page, id);
      ok(errors.length === 0, `${id} no page errors: ${errors.join(" | ")}`);
      if (SHOTS) await page.locator(".glance").screenshot({ path: path.join(OUT, `coder-simlocked-${theme}.png`) });
    });

    /* ------------------------------- 10. F-369: an EDITOR gets the connection picker.
       `listGitConnections` is requireAdmin, so every non-admin developer was refused and
       their turn silently took the engine's DEFAULT connection: with two configured, that
       is a turn landing in the wrong repository with nothing on screen to choose. The
       fallback is the editor-floor rows getRuleLists returns. */
    await withPanel({ __THEME__: theme, __REFUSE__: ["listGitConnections"], __REFUSE_ROLE__: "admin" }, async (page, errors) => {
      const id = `editor-picker/${theme}`;
      await page.locator(".coder-composer").waitFor({ timeout: 10000 });
      await page.locator(".coder-picker .dropdown").waitFor({ timeout: 8000 });
      ok(await page.locator(".coder-picker .dropdown").count() === 1, `${id} the refused editor still gets a picker`);
      // The refusal is NOT told as an outage: the panel is fully usable.
      ok(await page.locator(".coder-error").count() === 0, `${id} an admin-only list being refused is not an error banner`);
      ok(await page.locator("textarea.coder-input").count() === 1, `${id} the composer is untouched`);
      const calls = await page.evaluate(() => (window.__CALLS__ || []).map((c) => c.name));
      ok(calls.includes("getRuleLists"), `${id} the editor-floor list WAS read after the refusal`);
      await page.locator(".coder-picker .dropdown-trigger").click();
      await page.waitForSelector(".dropdown-panel", { timeout: 6000 });
      const items = await page.locator(".dropdown-panel .dropdown-item").allInnerTexts();
      ok(items.some((t) => /Acme engineering/.test(t)) && items.some((t) => /Acme platform/.test(t)), `${id} both connections are offered (got ${JSON.stringify(items)})`);
      await page.locator(".dropdown-panel .dropdown-item", { hasText: "Acme platform" }).first().click();
      await page.locator("textarea.coder-input").fill("Use the platform repo for this one.");
      await chooseConnection(page);
      await page.locator(".coder-composer .coder-btn-go").click();
      await page.locator(".coder-consent").waitFor({ timeout: 20000 });
      const start = await page.evaluate(() => window.__CODER_LAST_START__ || {});
      ok(start.connectionId === "gc_2", `${id} the chosen connection travels on the turn (got ${start.connectionId})`);
      await designRules(page, id);
      ok(errors.length === 0, `${id} no page errors: ${errors.join(" | ")}`);
      if (SHOTS) await page.locator(".glance").screenshot({ path: path.join(OUT, `coder-editor-picker-${theme}.png`) });
    });

    /* ------------------------------------ 11. F-463: the SKILLS a conversation runs with.
       `buildCoderKnowledge`'s skills half never ran, because no surface ever sent
       `skillIds`: a skill written for Forge app generation was ignored by the Coder. The
       composer now carries a picker, and what it must prove is (a) the ids actually reach
       `startCoderTurn`, (b) the cap is enforced by the CONTROL rather than reported after
       the fact, (c) the selection belongs to the CONVERSATION, and (d) it is the app's own
       multi-select - chips with aria-pressed, no native control anywhere. */
    await withPanel({ __THEME__: theme }, async (page, errors) => {
      const id = `skills/${theme}`;
      await page.locator(".coder-composer").waitFor({ timeout: 10000 });
      // Collapsed by default: an issue panel cannot spend its height on a catalogue.
      ok(await page.locator(".coder-skills-toggle").count() === 1, `${id} the composer offers a Skills control`);
      ok(await page.locator(".coder-skill-list").count() === 0, `${id} the list is collapsed until asked for`);
      ok(/none/i.test(await page.locator(".coder-skills-toggle").innerText()), `${id} the summary says nothing is picked`);
      await page.locator(".coder-skills-toggle").click();
      await page.locator(".coder-skill-list").waitFor({ timeout: 6000 });
      const chips = page.locator(".coder-skill-list .coder-skill-chip");
      ok(await chips.count() === 6, `${id} every enabled skill is offered (got ${await chips.count()})`);
      ok(await page.locator(".coder-skill-list input").count() === 0, `${id} the multi-select is chips, never a checkbox or a native control`);

      // PICK TWO. The chosen chips are the SOLID skills hue with white text, and they are
      // named in the summary above the list.
      await chips.nth(0).click();
      await chips.nth(2).click();
      ok(await chips.nth(0).getAttribute("aria-pressed") === "true", `${id} a picked chip carries aria-pressed`);
      const onBg = await page.locator(".coder-skill-list .coder-skill-chip.is-on").first().evaluate((el) => getComputedStyle(el).backgroundColor);
      ok(onBg === HUE.skills[theme], `${id} a chosen skill is the solid skills hue (got ${onBg})`);
      const onFg = await page.locator(".coder-skill-list .coder-skill-chip.is-on").first().evaluate((el) => getComputedStyle(el).color);
      ok(onFg === "rgb(255, 255, 255)", `${id} with white text (got ${onFg})`);
      const chosen = (await page.locator(".coder-skills-chosen .coder-skill-chip").allInnerTexts()).join("|");
      ok(/Create a linked issue/.test(chosen) && /Build an ADF comment/.test(chosen), `${id} the picks are named, not counted (got "${chosen}")`);
      ok(!/sk1|sk3/.test(chosen), `${id} a skill ID is never printed`);

      // THE CAP IS THE CONTROL'S, not a refusal after the send: a fifth chip cannot be
      // pressed, and the note says why.
      await chips.nth(3).click();
      await chips.nth(4).click();
      const disabledCount = await page.locator(".coder-skill-list .coder-skill-chip:disabled").count();
      ok(disabledCount === 2, `${id} at four picks the remaining chips are not selectable (got ${disabledCount})`);
      await chips.nth(5).click({ force: true });
      ok(await page.locator(".coder-skill-list .coder-skill-chip[aria-pressed=true]").count() === 4, `${id} a fifth pick is refused by the control`);
      ok(/most a turn can carry: 4/.test(await page.locator(".coder-skills-note").innerText()), `${id} the note says what the cap is`);
      // Back down to two, and send.
      await chips.nth(3).click();
      await chips.nth(4).click();

      await page.locator("textarea.coder-input").fill("Use those two skills and plan the change.");
      await chooseConnection(page);
      await page.locator(".coder-composer .coder-btn-go").click();
      await page.locator(".coder-consent").waitFor({ timeout: 20000 });
      const start = await page.evaluate(() => window.__CODER_LAST_START__ || {});
      ok(Array.isArray(start.skillIds) && start.skillIds.length === 2, `${id} the turn carries the picked skills (got ${JSON.stringify(start.skillIds)})`);
      ok(start.skillIds.includes("sk1") && start.skillIds.includes("sk3"), `${id} and carries the RIGHT ids (got ${JSON.stringify(start.skillIds)})`);

      // The selection belongs to the CONVERSATION: a new one starts with none.
      await page.locator(".coder-consent-btns .coder-btn-alt").nth(1).click(); // Skip, to clear the ticket
      await page.locator(".coder-outcome").waitFor({ timeout: 20000 });
      await page.locator(".coder-newconv").click();
      await page.waitForFunction(() => document.querySelectorAll(".coder-skills-chosen .coder-skill-chip").length === 0, { timeout: 8000 });
      ok(/none/i.test(await page.locator(".coder-skills-toggle").innerText()), `${id} a new conversation starts with no skills`);

      await designRules(page, id);
      ok(errors.length === 0, `${id} no page errors: ${errors.join(" | ")}`);
      if (SHOTS) await page.locator(".glance").screenshot({ path: path.join(OUT, `coder-skills-${theme}.png`) });
    });

    /* ------------------------ 11b. F-463: the resolver refuses an id no skill carries.
       `{success:false, error, reason:"unknown-skill"}` is a settled answer about the PICK.
       It must be told with the skill's NAME (an id is the resolver's vocabulary), must not
       leave the panel spinning, and must not eat the message the reader typed. */
    await withPanel({ __THEME__: theme, __CODER_UNKNOWN_SKILL__: "sk2" }, async (page, errors) => {
      const id = `skills-refused/${theme}`;
      await page.locator(".coder-composer").waitFor({ timeout: 10000 });
      await page.locator(".coder-skills-toggle").click();
      await page.locator(".coder-skill-list .coder-skill-chip").nth(1).click();
      await page.locator("textarea.coder-input").fill("Plan it with that skill.");
      await chooseConnection(page);
      await page.locator(".coder-composer .coder-btn-go").click();
      await page.locator(".coder-error").waitFor({ timeout: 20000 });
      const msg = await page.locator(".coder-error").innerText();
      ok(/Find duplicates by summary/.test(msg), `${id} the refusal NAMES the skill (got "${msg}")`);
      ok(!/unknown-skill/.test(msg) && !/sk[0-9]/.test(msg), `${id} neither the reason code nor an id reaches the screen`);
      ok(await page.locator(".veil").count() === 0, `${id} the panel is not left spinning`);
      ok((await page.locator("textarea.coder-input").inputValue()).includes("Plan it with that skill"),
        `${id} the message the reader typed is still in the box`);
      ok(await page.locator(".coder-msg-user").count() === 1, `${id} the refused turn left no second user row in the transcript`);
      await designRules(page, id);
      ok(errors.length === 0, `${id} no page errors: ${errors.join(" | ")}`);
      if (SHOTS) await page.locator(".glance").screenshot({ path: path.join(OUT, `coder-skills-refused-${theme}.png`) });
    });

    /* ------------------------- 12. F-954: the OFF card's remedy, for BOTH readers.
       It used to end in "Apps > CogniRunner > Settings" as a paragraph - a breadcrumb,
       not a link, aimed at a Jira admin, printed on an ISSUE panel whose reader is
       usually a developer who is not one. Two different people, two different screens:
       an admin gets the two real doors (the app's own page and Jira's Manage apps), and
       everybody else gets one sentence naming what to ask for and who to ask. */
    for (const admin of [true, false]) {
      await withPanel({ __THEME__: theme, __CODE_CAP__: "needs-frontier-model", ...(admin ? {} : { __NOT_ADMIN__: true }) }, async (page, errors) => {
        const id = `off-remedy/${admin ? "admin" : "developer"}/${theme}`;
        await page.locator(".coder-cap-off").waitFor({ timeout: 10000 });
        const txt = await page.locator(".coder-cap-off").innerText();
        ok(!/Apps\s*›\s*CogniRunner\s*›\s*Settings/.test(txt), `${id} the dead breadcrumb is gone (got "${txt.replace(/\n/g, " ")}")`);
        if (admin) {
          const btn = page.locator(".agent-off-btn");
          ok(await btn.count() === 1, `${id} the admin is given a way to the Settings tab`);
          ok((await btn.innerText()).trim() === "Open CogniRunner Settings", `${id} and it is labelled as a destination`);
          const link = page.locator(".agent-off-link");
          ok(await link.count() === 1, `${id} and a real link to Jira's own app page`);
          ok(await link.getAttribute("href") === "https://your-site.atlassian.net/jira/settings/apps/manage",
            `${id} the Manage apps href is the SITE's page, not the iframe's origin (got ${await link.getAttribute("href")})`);
          ok((await link.getAttribute("rel") || "").includes("noopener"), `${id} the outbound link carries rel=noopener`);
          // Solid fills with legible ink, and a dark override for each.
          const btnBg = await btn.evaluate((el) => getComputedStyle(el).backgroundColor);
          ok(btnBg === (theme === "dark" ? "rgb(59, 130, 246)" : "rgb(37, 99, 235)"), `${id} the button is the solid docs blue (got ${btnBg})`);
          const linkBg = await link.evaluate((el) => getComputedStyle(el).backgroundColor);
          ok(linkBg === (theme === "dark" ? "rgb(249, 115, 22)" : "rgb(194, 65, 12)"), `${id} the link is the solid burnt orange (got ${linkBg})`);
          ok(await btn.evaluate((el) => getComputedStyle(el).color) === "rgb(255, 255, 255)", `${id} white text on the button`);
          ok(!/Ask your Jira admin/.test(txt), `${id} an admin is not told to ask an admin`);
          // BOTH doors actually navigate: the button hands over a tab intent and moves to
          // the app's module, the link opens the site page. Nothing dead.
          await btn.click();
          await page.waitForFunction(() => (window.__ROUTER_CALLS__ || []).length > 0, { timeout: 8000 });
          const calls = await page.evaluate(() => window.__ROUTER_CALLS__ || []);
          ok(calls.some((c) => c.fn === "navigate" && c.arg && c.arg.moduleKey === "cognirunner-global-page"),
            `${id} the button navigates to the app's own page (got ${JSON.stringify(calls)})`);
          const intent = await page.evaluate(() => (window.__CALLS__ || []).find((c) => c.name === "setUiIntent"));
          ok(intent && intent.payload && intent.payload.tab === "settings", `${id} and asks for the Settings tab (got ${JSON.stringify(intent && intent.payload)})`);
          await link.click();
          await page.waitForFunction(() => (window.__ROUTER_CALLS__ || []).some((c) => c.fn === "open"), { timeout: 8000 });
          const opened = await page.evaluate(() => (window.__ROUTER_CALLS__ || []).filter((c) => c.fn === "open").map((c) => c.arg));
          ok(opened.some((u) => String(u).endsWith("/jira/settings/apps/manage")), `${id} the link opens through the router (got ${JSON.stringify(opened)})`);
        } else {
          ok(await page.locator(".agent-off-btn").count() === 0, `${id} no button to a page this reader cannot open`);
          ok(await page.locator(".agent-off-link").count() === 0, `${id} and no Manage apps link either`);
          const ask = await page.locator(".coder-cap-ask").innerText();
          ok(ask === "Ask your Jira admin to change the provider or the edition under Apps, CogniRunner.",
            `${id} one sentence, naming the ask and the person (got "${ask}")`);
          ok(!/›/.test(ask), `${id} it is a sentence, not a breadcrumb`);
        }
        await designRules(page, id);
        ok(errors.length === 0, `${id} no page errors: ${errors.join(" | ")}`);
        if (SHOTS) await page.locator(".glance").screenshot({ path: path.join(OUT, `coder-off-remedy-${admin ? "admin" : "developer"}-${theme}.png`) });
      });
    }

    /* ------------------- 13. F-954: a turn cannot be sent without saying WHO it acts as.
       `connectionId` started empty, rode the turn as `undefined` and Send was enabled on
       the draft alone - so on a site with two connections the turn landed on whatever the
       engine defaults to, in somebody else's repository, with nothing on screen having
       asked. Three sites, three different right answers. */

    // (a) SEVERAL and none chosen: the turn is blocked, and the sentence asks for the pick.
    await withPanel({ __THEME__: theme }, async (page, errors) => {
      const id = `conn-owed/${theme}`;
      await page.locator(".coder-composer").waitFor({ timeout: 10000 });
      await page.locator("textarea.coder-input").fill("Plan the retry guard and push it.");
      const send = page.locator(".coder-composer .coder-btn-go");
      ok(await send.isDisabled(), `${id} Send is not offered on the draft alone`);
      const owed = page.locator(".coder-conn-owed");
      ok(await owed.count() === 1, `${id} and the composer says what is missing`);
      ok(await owed.innerText() === "Choose the Git connection this conversation acts as", `${id} in the owner's words (got "${await owed.innerText()}")`);
      const owedBg = await owed.evaluate((el) => getComputedStyle(el).backgroundColor);
      ok(owedBg === (theme === "dark" ? "rgb(239, 68, 68)" : "rgb(220, 38, 38)"), `${id} the refusal is the app's solid red (got ${owedBg})`);
      ok(await owed.evaluate((el) => getComputedStyle(el).color) === "rgb(255, 255, 255)", `${id} with white text`);
      ok(Number(await owed.evaluate((el) => getComputedStyle(el).fontWeight)) >= 600, `${id} at 600+ weight`);
      ok(!(await page.evaluate(() => (window.__CALLS__ || []).some((c) => c.name === "startCoderTurn"))), `${id} nothing reached the backend`);
      await designRules(page, id);
      if (SHOTS) await page.locator(".glance").screenshot({ path: path.join(OUT, `coder-conn-owed-${theme}.png`) });

      // Choosing clears the refusal and the SAME draft can be sent, carrying the id.
      await chooseConnection(page);
      await page.waitForFunction(() => document.querySelectorAll(".coder-conn-owed").length === 0, { timeout: 6000 });
      ok(!(await send.isDisabled()), `${id} a named connection unblocks the turn`);
      await send.click();
      await page.locator(".coder-consent").waitFor({ timeout: 20000 });
      const start = await page.evaluate(() => window.__CODER_LAST_START__ || {});
      ok(start.connectionId === "gc_1", `${id} and the turn carries it on the wire (got ${start.connectionId})`);
      ok(errors.length === 0, `${id} no page errors: ${errors.join(" | ")}`);
    });

    // (b) EXACTLY ONE: pre-selected, so there is nothing to ask and nothing to pick.
    await withPanel({ __THEME__: theme, __CODE_ONE_CONN__: true }, async (page, errors) => {
      const id = `conn-one/${theme}`;
      await page.locator(".coder-composer").waitFor({ timeout: 10000 });
      ok(await page.locator(".coder-picker").count() === 0, `${id} no picker where there is nothing to choose between`);
      ok(await page.locator(".coder-conn-owed").count() === 0, `${id} and nothing is owed`);
      ok(await page.locator(".coder-conn-note").count() === 0, `${id} the site HAS a connection, so it is not told it has none`);
      await page.locator("textarea.coder-input").fill("Push the retry guard.");
      ok(!(await page.locator(".coder-composer .coder-btn-go").isDisabled()), `${id} Send is available`);
      await page.locator(".coder-composer .coder-btn-go").click();
      await page.locator(".coder-consent").waitFor({ timeout: 20000 });
      /* THE POINT: the turn NAMES the connection rather than travelling as undefined and
         letting the engine pick. Pre-selection is a convenience in the composer; what it
         buys is a record that says which account the conversation acts as. */
      const start = await page.evaluate(() => window.__CODER_LAST_START__ || {});
      ok(start.connectionId === "gc_1", `${id} the sole connection rides the turn (got ${JSON.stringify(start.connectionId)})`);
      await designRules(page, id);
      ok(errors.length === 0, `${id} no page errors: ${errors.join(" | ")}`);
      if (SHOTS) await page.locator(".glance").screenshot({ path: path.join(OUT, `coder-conn-one-${theme}.png`) });
    });

    // (c) NONE: a plan-only turn is legitimate, so Send stays enabled and the composer
    // says what the Coder cannot do rather than refusing the conversation.
    await withPanel({ __THEME__: theme, __CODE_NO_CONNS__: true }, async (page, errors) => {
      const id = `conn-none/${theme}`;
      await page.locator(".coder-composer").waitFor({ timeout: 10000 });
      ok(await page.locator(".coder-picker").count() === 0, `${id} no picker with nothing to pick`);
      ok(await page.locator(".coder-conn-owed").count() === 0, `${id} nothing is owed: there is nothing to owe`);
      const note = page.locator(".coder-conn-note");
      ok(await note.count() === 1, `${id} the composer says what this site can and cannot do`);
      ok(await note.innerText() === "No Git connection on this site; the Coder can plan but not push",
        `${id} in the owner's words (got "${await note.innerText()}")`);
      await page.locator("textarea.coder-input").fill("Just plan it, do not push anything.");
      ok(!(await page.locator(".coder-composer .coder-btn-go").isDisabled()), `${id} Send stays available for a plan-only turn`);
      await page.locator(".coder-composer .coder-btn-go").click();
      await page.locator(".coder-consent").waitFor({ timeout: 20000 });
      const start = await page.evaluate(() => window.__CODER_LAST_START__ || {});
      ok(start.connectionId === undefined, `${id} and it names no connection, because there is none (got ${JSON.stringify(start.connectionId)})`);
      await designRules(page, id);
      ok(errors.length === 0, `${id} no page errors: ${errors.join(" | ")}`);
      if (SHOTS) await page.locator(".glance").screenshot({ path: path.join(OUT, `coder-conn-none-${theme}.png`) });
    });

    /* --------------------------------------- 7b. a FIRST open: no thread, no empty-state lie.
       "Thread not found" is the normal answer on a first open and must not become an error
       banner — an empty transcript is exactly what a new user should see. */
    await withPanel({ __THEME__: theme, __CODER_SCENARIO__: "empty" }, async (page) => {
      const id = `first-open/${theme}`;
      await page.locator(".coder-composer").waitFor({ timeout: 10000 });
      ok(await page.locator(".coder-msg").count() === 0, `${id} no messages`);
      ok(await page.locator(".coder-error").count() === 0, `${id} an empty thread is NOT an error`);
      ok(await page.locator(".coder-cap-on").count() === 1, `${id} the capability card is still there`);
    });
  }
} finally {
  await browser.close();
}
console.log(`CODER PANEL (1.4 commit 9b): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
