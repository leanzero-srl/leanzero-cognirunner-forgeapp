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

    /* ------------------------------------------------- 2a. the UPGRADE arm (F-255).
       An edition denial is a BILLING statement. It must not be rendered as a permission
       problem, and the sentence must name the feature from ADVANCED_FEATURES rather than
       a string the panel invents. */
    await withPanel({ __THEME__: theme, __UPGRADE__: ["getAgentCapability"], __UPGRADE_FEATURE__: "coder" }, async (page, errors) => {
      const id = `upgrade/${theme}`;
      await page.locator(".coder-cap-off").waitFor({ timeout: 10000 });
      const txt = (await page.locator(".coder-cap-off").innerText());
      ok(/This needs CogniRunner Coder\./.test(txt), `${id} the headline names the edition (got "${txt.replace(/\n/g, " ")}")`);
      ok(/Upgrade in Settings to unlock /.test(txt), `${id} the remedy is an upgrade, not a role request`);
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
      await page.locator(".coder-composer .coder-btn-go").click();

      // 6. the running state is the app's OWN treatment, and it is over the composer.
      await page.locator(".veil").waitFor({ timeout: 5000 });
      ok(await page.locator(".veil .spin-ring").count() === 1, `${id} the running state uses the MLS spinner`);
      ok(/Working/.test(await page.locator(".veil-label").innerText()), `${id} the running state says what it is doing`);

      await page.locator(".coder-consent").waitFor({ timeout: 20000 });
      ok(await page.locator(".coder-consent-action").innerText() === "open_pull_request", `${id} the action is named`);
      const args = await page.locator(".coder-consent-args").innerText();
      ok(args.includes("proj-42-retry-guard"), `${id} the argument preview is shown (got "${args}")`);
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
      ok(actions.length === 1 && /open_pull_request/.test(actions[0]) && /ok/i.test(actions[0]) && /ms/.test(actions[0]),
        `${id} the actions list shows name, verdict and ms (got ${JSON.stringify(actions)})`);
      const okDot = await page.locator(".coder-action-ok").evaluate((el) => getComputedStyle(el).backgroundColor);
      ok(okDot === (theme === "dark" ? "rgb(34, 197, 94)" : "rgb(22, 163, 74)"), `${id} the ok dot is the solid green (got ${okDot})`);
      const foot = await page.locator(".coder-outcome-foot").innerText();
      ok(/ended by final/.test(foot), `${id} the turn says how it ended (got "${foot}")`);
      // The reply is on screen exactly ONCE: the transcript re-read owns it after a turn.
      const replies = await page.locator(".glance").evaluate((el) => (el.innerText.match(/acme\/web #418/g) || []).length);
      ok(replies === 1, `${id} the reply appears once, not twice (got ${replies})`);
      // The decision is in the transcript, written by code and kept verbatim.
      ok(await page.locator(".coder-msg-decision").count() === 1, `${id} the decision row is in the thread`);
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

    /* ------------------------------------------------------------------- 5. the SKIP path.
       Same road, different answer: nothing was performed, the actions list is empty rather
       than absent-by-accident, and the transcript records the refusal so the next turn
       cannot quietly retry it. */
    await withPanel({ __THEME__: theme }, async (page, errors) => {
      const id = `skip/${theme}`;
      await page.locator(".coder-composer").waitFor({ timeout: 10000 });
      await page.locator("textarea.coder-input").fill("Open the PR.");
      await page.locator(".coder-composer .coder-btn-go").click();
      await page.locator(".coder-consent").waitFor({ timeout: 20000 });
      await page.locator(".coder-consent-btns .coder-btn-alt").nth(1).click(); // Skip
      await page.locator(".coder-outcome").waitFor({ timeout: 20000 });
      const sent = await page.evaluate(() => window.__CODER_LAST_DECISION__ || {});
      ok(sent.decision === "skip", `${id} the wire carried decision "skip" (got ${sent.decision})`);
      ok(await page.locator(".coder-action").count() === 0, `${id} nothing was performed, so no actions are listed`);
      const thread = await page.locator(".coder-thread").innerText();
      ok(/SKIPPED/.test(thread), `${id} the refusal is recorded in the transcript`);
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
      await page.locator(".coder-composer .coder-btn-go").click();
      await page.locator(".coder-outcome").waitFor({ timeout: 20000 });
      ok(await page.locator(".coder-consent").count() === 0, `${id} no consent row on a plain turn`);
      ok(await page.locator(".coder-action").count() === 3, `${id} every action is listed`);
      ok(await page.locator(".coder-action-bad").count() === 1, `${id} the failed action is marked failed`);
      const badDot = await page.locator(".coder-action-bad").evaluate((el) => getComputedStyle(el).backgroundColor);
      ok(badDot === (theme === "dark" ? "rgb(239, 68, 68)" : "rgb(220, 38, 38)"), `${id} the failed dot is solid red (got ${badDot})`);
      ok(/3 rounds/.test(await page.locator(".coder-outcome-foot").innerText()), `${id} the rounds are counted`);
      // The Dry run switch travels on the wire as `simulation`.
      await page.locator(".coder-toggle").click();
      await page.locator("textarea.coder-input").fill("Again, but do not write anything.");
      await page.locator(".coder-composer .coder-btn-go").click();
      await page.locator(".coder-outcome").waitFor({ timeout: 20000 });
      const start = await page.evaluate(() => window.__CODER_LAST_START__ || {});
      ok(start.simulation === true, `${id} Dry run sends simulation: true (got ${start.simulation})`);
      ok(errors.length === 0, `${id} no page errors: ${errors.join(" | ")}`);
      if (SHOTS) await page.locator(".glance").screenshot({ path: path.join(OUT, `coder-plain-${theme}.png`) });
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
