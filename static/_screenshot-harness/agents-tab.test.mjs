/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 *
 * admin-panel AGENTS tab browser journeys (mock-bridge harness) — release 1.5 commit 5c.
 * Drives the REAL admin-panel build with @forge/bridge aliased to bridge.js, whose wizard
 * turns come from the REAL state machine (src/shared/va-wizard.js). So this suite exercises
 * the chat wizard end to end, the classic form, and every status surface, with no Jira and
 * no model.
 *
 * What it proves, and why each one is here:
 *   A1  the full interview to Create, asserting the EXACT saved payload — the wizard's whole
 *       claim is that it hands over the record normalizeVa produced, unedited.
 *   A2  a refused answer renders as a refusal and does NOT advance the step.
 *   A3  the site-wide WRITE refusal says what the save path says, word for word.
 *   A4  the voice sample chips re-render the sample on the same step.
 *   A5  fallbackToForm lands in the classic form holding the answers.
 *   A6  the status card, and the solid red health banner at the engine's own threshold.
 *   A7  staged drafts approve / reject carry the item to the resolver.
 *   A8  pause goes through the app's own confirm dialog, never window.confirm.
 *   A9  the memory editor saves what is on screen.
 *   A10 SchedulePicker's multi-hour presets round-trip through the minute spinner (13c).
 *   A11 dark theme renders the same surfaces.
 *   A12 a tick refused by the agent-capability gate renders the copy home's sentence as a
 *       solid red state, in both themes (F-501).
 *   A13 the three memory-compaction shapes (F-511): a clean compaction as a solid teal
 *       chip, a fallback and a non-converging gate as solid red states, and the backoff as
 *       a solid slate one - both themes, computed colours, no rail, no em-dash.
 *   A14 the compaction copy map covers EVERY reason id `src/virtual-admin.js` pushes
 *       (asserted by reading the engine source, F-518), and the ids that carry a `:detail`
 *       suffix or that the map has never heard of never leak an id or an exception message
 *       into the admin's copy - on the receipt rows AND on the health banner, the reason's
 *       second and durable home (F-524). The extraction reads EVERY literal in the
 *       compaction sites' ranges and asserts an EXACT set, so a reason written as a ternary,
 *       a helper or a template cannot slip past it (F-525). The scope is EVERY
 *       `recordTickHealth(` call site as well as the compaction ones (F-535), because the
 *       health row is where the tick's two catch arms file their ids.
 *   A14b the tick's own health ids (`tick:prepare_failed`, `tick:post_failed`) each read as
 *       their own sentence on the banner, in both themes, whether the stored row carries the
 *       base id alone or a legacy row with the exception glued on (F-535).
 *   A17 the site-wide "recently deleted agents that wrote during deletion" section
 *       (F-608): absent when nothing landed, the rows and their turns when something did,
 *       the truncation note, a storage fault as a solid red notice and never as an empty
 *       state, and the admin-floor refusal in the backend's own words - both themes,
 *       computed colours, no rail, no em-dash, no engine id.
 *   A15 a SUCCESSFUL save's own notes reach the admin on BOTH doors (F-538): the resolver's
 *       `refused` and the job row's `vaRefused` both render, the id becomes a sentence, the
 *       door stays open until the notes are dismissed - both themes, computed colours.
 *
 *   A18 the purge SETTLE WINDOW renders at all (F-614): the engine arm that skips a
 *       re-created agent is receipt-free on purpose, so the wait now arrives as
 *       `status.settling` and renders as a solid amber state on the card AND in the Ticks
 *       pane header - both themes, computed colours - while the dead GATE_COPY row that
 *       could never fire is gone rather than duplicated.
 *
 * Run: node static/_screenshot-harness/agents-tab.test.mjs   (add --shots to save PNGs)
 */
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureFreshBuildShot } from "./lib/build-shot.mjs";
/* The refusal sentence and the banner threshold come from their ONE home, so this suite
   cannot assert words or a number the app does not actually use. */
import { writeSiteRefusalReason, stepWizard } from "../../src/shared/va-wizard.js";
import { VA_LIMITS } from "../../src/shared/va-config.js";
/* F-501 - the capability sentence is asserted from its ONE home, so this suite cannot pass
   on words the app does not actually render. */
import { agentCapabilityCopy } from "../../src/shared/edition.js";

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
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true }); };

async function openAgents(browser, theme = "light", extraInit = null) {
  const root = ensureFreshBuildShot("admin-panel");
  const { s, port } = await serve(root);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  await ctx.addInitScript(([th, extra]) => { window.__SHOT__ = "admin"; window.__THEME__ = th; if (extra) for (const k in extra) window[k] = extra[k]; }, [theme, extraInit]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e && e.message)));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!document.querySelector(".container"), { timeout: 15000 }).catch(() => {});
  await page.locator(".tab-btn", { hasText: /^\s*Agents\s*$/ }).first().click();
  await page.locator(".section-title", { hasText: /Agents/ }).first().waitFor({ timeout: 10000 });
  return { page, ctx, s, errors };
}
const close = async (env) => { await env.ctx.close(); await new Promise((r) => env.s.close(r)); };
const chip = (page, label) => page.locator(".va-chip", { hasText: new RegExp(`^${label}( ×)?$`) }).first();
const stepIs = (page, id) => page.locator(`.va-step[data-step="${id}"]`).waitFor({ timeout: 8000 });
/* The app's own dialog primitive, never window.confirm (the harness would hang on a native
   one, which is itself a check: a native confirm blocks the page and this helper times out). */
const confirmYes = async (page) => { await page.locator(".cr-confirm").waitFor({ timeout: 5000 }); await page.locator(".cr-confirm button", { hasText: /^(?!Cancel).*$/ }).last().click(); };

/** Drive the interview from the opening turn to the create step. */
async function runInterview(page, { stopAt = null } = {}) {
  await page.locator(".va-new").click();
  await stepIs(page, "persona_name");
  if (stopAt === "persona_name") return;
  await page.locator(".va-name").fill("Nadia");
  await page.locator(".va-actions .btn-solid").click();

  await stepIs(page, "persona_voice");
  if (stopAt === "persona_voice") return;
  await chip(page, "warm").click();
  await page.locator(".va-actions .btn-solid").click();

  await stepIs(page, "intake");
  if (stopAt === "intake") return;
  await page.locator(".va-desk-head", { hasText: "IT Service Desk" }).locator("input").check();
  await chip(page, "Waiting for support").click();
  await page.locator(".va-actions .btn-solid").click();

  await stepIs(page, "read_scope");
  if (stopAt === "read_scope") return;
  await chip(page, "Payments").click();
  await chip(page, "IT Operations").click();
  await page.locator(".va-actions .btn-solid").click();

  await stepIs(page, "write_scope");
  if (stopAt === "write_scope") return;
  await chip(page, "IT Operations").click();
  await page.locator(".va-actions .btn-solid").click();

  await stepIs(page, "cadence");
  if (stopAt === "cadence") return;
  await chip(page, "Every 30 minutes").click();
  await page.locator(".va-actions .btn-solid").click();

  await stepIs(page, "powers");
  if (stopAt === "powers") return;
  await page.locator(".va-power", { hasText: "Reply internally" }).locator("input").check();
  await page.locator(".va-actions .btn-solid").click();

  await stepIs(page, "guardrails");
  if (stopAt === "guardrails") return;
  await page.locator(".va-actions .btn-solid").click();

  await stepIs(page, "review");
  if (stopAt === "review") return;
  await page.locator(".va-actions .btn-solid").first().click();
  await stepIs(page, "create");
}

const browser = await chromium.launch();
try {
  /* ---------- A1 the whole interview, and the exact payload it saves ---------- */
  {
    console.log("A1 wizard → Create");
    const env = await openAgents(browser);
    const { page } = env;
    try {
      await runInterview(page);
      await shot(page, "agents-wizard-create");
      await page.locator(".va-actions .btn-solid").click();
      await page.waitForFunction(() => !!window.__VA_SAVE__, { timeout: 8000 });
      const saved = await page.evaluate(() => window.__VA_SAVE__);
      ok(saved && saved.mode === "va", "A1 saved with mode va");
      const va = (saved && saved.va) || {};
      ok(va.persona && va.persona.name === "Nadia", "A1 persona name saved");
      ok(va.persona && va.persona.voice && va.persona.voice.register === "warm", "A1 register saved");
      ok(va.scope && !va.scope.read.site && va.scope.read.projects.join(",") === "PROJ,OPS", "A1 read scope saved");
      ok(va.scope && va.scope.write.projects.join(",") === "OPS", "A1 write scope saved");
      ok(va.intake && va.intake.serviceDesks.length === 1 && va.intake.serviceDesks[0].queueIds.join(",") === "21", "A1 intake desk + queue saved");
      ok(va.cadence && va.cadence.preset === "every30", "A1 cadence preset saved");
      ok(va.powers && va.powers.replyInternal === true && va.powers.replyPublic === false, "A1 powers saved, replyPublic still off");
      // F-425's vocabulary: one brake name, and the dropped ones must not exist.
      ok(va.guardrails && typeof va.guardrails.maxWritesPerRun === "number", "A1 maxWritesPerRun on the record");
      ok(va.guardrails && va.guardrails.maxBulkTargets === undefined && va.guardrails.owedUncapped === undefined, "A1 the dropped brake names are absent");
      ok(va.status && va.status.shadowUntilTick > 0, "A1 it starts in shadow");
      // back on the list, and the agent count came from the resolver again
      await page.locator(".section-title", { hasText: /Agents/ }).first().waitFor({ timeout: 8000 });
      ok(env.errors.length === 0, `A1 no page errors (${env.errors[0] || ""})`);
    } finally { await close(env); }
  }

  /* ---------- A2 a refused answer stays on its step and says why ---------- */
  {
    console.log("A2 refusal");
    const env = await openAgents(browser);
    const { page } = env;
    try {
      await runInterview(page, { stopAt: "write_scope" });
      await stepIs(page, "write_scope");
      // SUP is in the catalogue but NOT in the read scope chosen above: an agent cannot
      // write where it cannot read, and the refusal must name the project.
      await chip(page, "Customer Support").click();
      await page.locator(".va-actions .btn-solid").click();
      await page.locator(".va-notes-refusal").waitFor({ timeout: 8000 });
      const text = await page.locator(".va-notes-refusal").innerText();
      ok(/SUP/.test(text) && /read scope/i.test(text), "A2 refusal names the project and the reason");
      ok(await page.locator('.va-step[data-step="write_scope"]').count() === 1, "A2 the step did not advance");
      // innerText is what the reader sees, and the label is uppercased by CSS.
      const fields = (await page.locator(".va-note-field").allInnerTexts()).map((t) => t.toLowerCase());
      ok(fields.includes("scope.write.projects"), `A2 refusal names the field (got ${fields.join("|")})`);
      await shot(page, "agents-wizard-refusal");
    } finally { await close(env); }
  }

  /* ---------- A3 the site-wide WRITE refusal, word for word ---------- */
  {
    console.log("A3 write-site refusal");
    const env = await openAgents(browser);
    const { page } = env;
    try {
      await runInterview(page, { stopAt: "write_scope" });
      await stepIs(page, "write_scope");
      // The UI offers NO site-wide write control at all - that is the point - so the
      // refusal itself is asserted at the module seam (the machine answers with the SAVE
      // PATH's own sentence, probed from normalizeVa rather than retyped), and the screen is
      // asserted for saying the same thing in the copy an admin actually reads.
      const machine = stepWizard({ v: 1, stepId: "write_scope", answers: { readScope: { site: false, projects: ["PROJ"] } }, history: [], refused: [], notes: [], done: false, catalog: {} }, { answer: { site: true } });
      const sentence = (machine.refused[0] || {}).reason;
      ok(sentence === writeSiteRefusalReason(), "A3 the wizard refuses site-wide writes in the save path's own words");
      ok(/projects/i.test(String(sentence)), "A3 the sentence names what IS allowed (a list of projects)");
      const hint = await page.locator('.va-step[data-step="write_scope"] .hint').innerText();
      ok(/no site-wide option/i.test(hint), "A3 the step's copy says the same thing on screen");
    } finally { await close(env); }
  }

  /* ---------- A4 the voice sample and its chips ---------- */
  {
    console.log("A4 voice sample chips");
    const env = await openAgents(browser);
    const { page } = env;
    try {
      await runInterview(page, { stopAt: "persona_voice" });
      await stepIs(page, "persona_voice");
      await page.locator(".va-sample").waitFor({ timeout: 8000 });
      ok(await page.locator(".va-reply").count() === 2, "A4 two samples render");
      ok(await page.locator(".va-sample-flag").count() === 1, "A4 the sample carries a verdict flag");
      const before = await page.locator(".va-reply-text").first().innerText();
      await page.locator(".va-sample-chips .va-chip", { hasText: "Shorter" }).click();
      await page.waitForTimeout(300);
      ok(await page.locator('.va-step[data-step="persona_voice"]').count() === 1, "A4 a chip stays on the voice step");
      const after = await page.locator(".va-reply-text").first().innerText();
      ok(before !== after, "A4 Shorter changed the sample");
      await shot(page, "agents-wizard-voice");
    } finally { await close(env); }
  }

  /* ---------- A5 fallbackToForm ---------- */
  {
    console.log("A5 fallback to the classic form");
    const env = await openAgents(browser);
    const { page } = env;
    try {
      // The form is also the "Use the form" door, and the same component. Opening it
      // directly proves it renders and saves the same record shape.
      await page.locator(".btn-small", { hasText: "Use the form" }).click();
      await page.locator(".va-editor").waitFor({ timeout: 8000 });
      await page.locator(".va-name").fill("Priya");
      await chip(page, "Payments").first().click();
      await page.locator(".va-editor .section-actions .btn-solid").click();
      await page.waitForFunction(() => !!window.__VA_SAVE__, { timeout: 8000 });
      const saved = await page.evaluate(() => window.__VA_SAVE__);
      ok(saved && saved.mode === "va" && saved.va.persona.name === "Priya", "A5 the form saves the same record shape");
      ok(saved.va.scope.read.projects.includes("PROJ"), "A5 the form's read scope lands on the record");
      await shot(page, "agents-form");
    } finally { await close(env); }
  }

  /* ---------- A5b the wizard FAILS CLOSED into the form, holding the answers ---------- */
  {
    console.log("A5b fallbackToForm");
    const env = await openAgents(browser, "light", { __VA_FALLBACK__: true });
    const { page } = env;
    try {
      await runInterview(page, { stopAt: "guardrails" });
      await page.locator(".va-actions .btn-solid").click(); // the answer whose turn cannot be reviewed
      await page.locator(".va-editor").waitFor({ timeout: 8000 });
      ok(true, "A5b a record the save path refuses lands in the classic form");
      ok(await page.locator(".va-name").inputValue() === "Nadia", "A5b the name answered in the interview is still there");
      ok(await page.locator(".va-notes-refusal").count() === 1, "A5b the refusal that stopped it is rendered above the form");
      const on = await page.locator(".va-chip.on").allInnerTexts();
      ok(on.includes("Payments") && on.includes("IT Operations"), "A5b the read scope survived the handover");
      await shot(page, "agents-fallback");
    } finally { await close(env); }
  }

  /* ---------- A6 status card + health banner ---------- */
  {
    console.log("A6 status + health");
    const env = await openAgents(browser);
    const { page } = env;
    try {
      await page.locator(".va-agent").first().waitFor({ timeout: 8000 });
      /* F-554 - the card renders BEFORE its status answers, and until it does the mode is
         LOADING for both agents. This suite is about the loaded card, so wait for the read
         rather than for the element; A16 owns the two non-answers. */
      await page.locator(".va-badge-shadow").first().waitFor({ timeout: 8000 });
      ok(await page.locator(".va-agent").count() === 2, "A6 two agent cards");
      ok(await page.locator(".va-badge-shadow").count() === 1, "A6 the shadow agent is badged SHADOW");
      ok(await page.locator(".va-badge-live").count() === 1, "A6 the live agent is badged LIVE");
      const stats = await page.locator(".va-agent").first().locator(".va-stat-label").allInnerTexts();
      ok(stats.join("|").includes("LAST TICK") || stats.join("|").toLowerCase().includes("last tick"), "A6 last tick is rendered");
      ok(stats.length === 5, "A6 five status facts (last tick, staged, next tick, next window, mode)");
      // The banner is the engine's counter at the engine's threshold, not a UI guess.
      ok(await page.locator(".va-health").count() === 1, "A6 exactly one health banner, on the broken agent");
      const health = await page.locator(".va-health").innerText();
      /* F-524 - the cause is named in COPY. The fixture's `lastReason` is the engine's own
         namespaced id with an exception slice on it (what the engine actually stores), so
         "names the cause" means the mapped sentence and none of the stored string. */
      ok(/not working/i.test(health), "A6 the banner says the agent is not working");
      ok(/stopped on an unexpected error/.test(health), `A6 the banner names the cause in copy, got ${JSON.stringify(health)}`);
      ok(!/compaction:|compaction_failed|TypeError|Cannot read properties/.test(health), "A6 the banner names it without the engine's own string");
      ok(VA_LIMITS.healthBannerFailedTicks >= 1, "A6 the threshold has one home");
      await shot(page, "agents-status");
    } finally { await close(env); }
  }

  /* ---------- A7 drafts approve / reject ---------- */
  {
    console.log("A7 drafts");
    const env = await openAgents(browser);
    const { page } = env;
    try {
      await page.locator(".va-agent").first().locator(".rule-expand-btn").click();
      await page.locator(".va-table").first().waitFor({ timeout: 8000 });
      ok(await page.locator(".va-table tbody tr").count() === 2, "A7 two staged drafts");
      ok(await page.locator(".va-badge-public").count() === 1, "A7 the customer-bound draft is badged");
      await shot(page, "agents-drafts");
      await page.locator(".va-table tbody tr").first().locator("button", { hasText: "Approve" }).click();
      await confirmYes(page);
      await page.waitForFunction(() => (window.__VA_DECISIONS__ || []).length === 1, { timeout: 8000 });
      const d1 = await page.evaluate(() => window.__VA_DECISIONS__[0]);
      ok(d1.name === "approveVaDraft" && d1.itemKey === "OPS-31" && !!d1.stagedAt, "A7 approve carries the item and its stagedAt");
      await page.locator(".va-table tbody tr").first().locator("button", { hasText: "Reject" }).click();
      await confirmYes(page);
      await page.waitForFunction(() => (window.__VA_DECISIONS__ || []).length === 2, { timeout: 8000 });
      const d2 = await page.evaluate(() => window.__VA_DECISIONS__[1]);
      ok(d2.name === "rejectVaDraft" && d2.itemKey === "OPS-44", "A7 reject carries the other item");
      // The tick receipts pane renders a skip BY GATE NAME, never as a bare count.
      await page.locator(".va-pane-btn", { hasText: "Ticks" }).click();
      await page.locator(".va-receipt").first().waitFor({ timeout: 8000 });
      const gates = await page.locator(".va-receipt-gate").allInnerTexts();
      ok(gates.includes("pileup") && gates.includes("shadow"), "A7 receipts name the gates that skipped");
      ok((await page.locator(".va-receipt-skip").first().innerText()).length > 20, "A7 each skip renders a sentence");
    } finally { await close(env); }
  }

  /* ---------- A8 pause goes through the app's own dialog ---------- */
  {
    console.log("A8 pause");
    const env = await openAgents(browser);
    const { page } = env;
    let nativeCalled = false;
    page.on("dialog", async (d) => { nativeCalled = true; await d.dismiss(); });
    try {
      await page.locator(".va-agent").first().locator("button", { hasText: "Pause" }).click();
      await page.locator(".cr-confirm").waitFor({ timeout: 5000 });
      ok(true, "A8 the app's confirm dialog opened");
      await confirmYes(page);
      await page.locator(".va-badge-paused").first().waitFor({ timeout: 8000 });
      ok(await page.locator(".va-badge-paused").count() === 1, "A8 the card reads PAUSED");
      ok(await page.locator(".va-agent").first().locator("button", { hasText: "Resume" }).count() === 1, "A8 the control became Resume");
      ok(!nativeCalled, "A8 no native confirm was used");
      ok(await page.locator("select").count() === 0, "A8 no native select anywhere on the tab");
    } finally { await close(env); }
  }

  /* ---------- A9 memory editor ---------- */
  {
    console.log("A9 memory");
    const env = await openAgents(browser);
    const { page } = env;
    try {
      await page.locator(".va-agent").first().locator(".rule-expand-btn").click();
      await page.locator(".va-pane-btn", { hasText: "Memory" }).click();
      await page.locator(".va-memory").waitFor({ timeout: 8000 });
      ok(await page.locator(".va-constraint").count() === 2, "A9 the pinned constraints are shown");
      ok(/bytes/.test(await page.locator(".va-memory-count").innerText()), "A9 the counter is in bytes, like the cap");
      await page.locator(".va-memory").fill("Finance approves licence requests on Tuesdays.");
      await page.locator("button", { hasText: "Save memory" }).click();
      await page.waitForFunction(() => !!window.__VA_MEMORY_SAVE__, { timeout: 8000 });
      const saved = await page.evaluate(() => window.__VA_MEMORY_SAVE__);
      ok(saved.memory === "Finance approves licence requests on Tuesdays." && saved.jobId === "va_1", "A9 the memory saved is what was on screen");
      ok(Array.isArray(saved.constraints) && saved.constraints.length === 2, "A9 the constraints ride the save");
      await shot(page, "agents-memory");
    } finally { await close(env); }
  }

  /* ---------- A10 the 13c presets in SchedulePicker ---------- */
  {
    console.log("A10 multi-hour presets");
    const env = await openAgents(browser);
    const { page } = env;
    try {
      await page.locator(".btn-small", { hasText: "Use the form" }).click();
      await page.locator(".schp").waitFor({ timeout: 8000 });
      await page.locator(".schp-preset button").first().click();
      await page.locator(".dropdown-item", { hasText: "Every 4 hours" }).first().click();
      await page.locator(".schp-preview-cron").waitFor({ timeout: 5000 });
      ok((await page.locator(".schp-preview-cron").innerText()).includes("*/4"), "A10 Every 4 hours emits a 4-hourly cron");
      const minute = page.locator('.schp-field:has-text("At minute") input');
      ok(await minute.count() === 1, "A10 the minute spinner is offered for a multi-hour cadence (the owed 13c UI half)");
      await minute.fill("15");
      await page.waitForTimeout(200);
      const cron = await page.locator(".schp-preview-cron").innerText();
      ok(cron.trim().startsWith("15 ") && cron.includes("*/4"), `A10 the minute round-trips into the cron (${cron})`);
      ok(/Every 4 hours at minute 15/i.test(await page.locator(".schp-preview-head").innerText()), "A10 the description names the minute");
    } finally { await close(env); }
  }

  /* ---------- A11 dark ---------- */
  {
    console.log("A11 dark theme");
    const env = await openAgents(browser, "dark");
    const { page } = env;
    try {
      await page.locator(".va-agent").first().waitFor({ timeout: 8000 });
      ok(await page.locator(".va-health").count() === 1, "A11 the health banner renders in dark");
      const bg = await page.locator(".va-badge-shadow").first().evaluate((el) => getComputedStyle(el).backgroundColor);
      ok(bg === "rgb(245, 158, 11)", `A11 the shadow badge takes its dark override (#f59e0b), got ${bg}`);
      const ink = await page.locator(".va-badge-shadow").first().evaluate((el) => getComputedStyle(el).color);
      ok(ink === "rgb(42, 22, 2)", `A11 dark amber keeps the app's dark ink, got ${ink}`);
      await page.locator(".va-new").click();
      await stepIs(page, "persona_name");
      await shot(page, "agents-wizard-dark");
      ok(env.errors.length === 0, `A11 no page errors in dark (${env.errors[0] || ""})`);
    } finally { await close(env); }
  }

  /* ---------- A12 the capability gate's refusal (F-501) ---------- */
  for (const [theme, red] of [["light", "rgb(220, 38, 38)"], ["dark", "rgb(239, 68, 68)"]]) {
    console.log(`A12 capability gate (${theme})`);
    const env = await openAgents(browser, theme);
    const { page } = env;
    try {
      // The second card is the broken agent; its receipts carry the capability skip.
      await page.locator(".va-agent").nth(1).locator(".rule-expand-btn").click();
      await page.locator(".va-pane-btn", { hasText: "Ticks" }).click();
      await page.locator(".va-receipt-cap").first().waitFor({ timeout: 8000 });
      const copy = agentCapabilityCopy("needs-coder-edition");
      const block = page.locator(".va-receipt-cap").first();
      ok((await block.locator(".va-receipt-cap-title").innerText()).trim() === copy.title, `A12 ${theme} the title is the copy home's title`);
      ok((await block.locator(".va-receipt-cap-text").innerText()).trim() === copy.remedy, `A12 ${theme} the remedy is the copy home's remedy`);
      ok(!/capability/i.test(await block.innerText()), `A12 ${theme} the raw gate id is not what the admin reads`);
      ok(!(await block.innerText()).includes("\u2014"), `A12 ${theme} no em-dash`);
      ok(copy.link === "settings" && await block.locator(".va-receipt-cap-link").count() === 1, `A12 ${theme} the Settings remedy link is offered`);
      const css = await block.evaluate((el) => { const c = getComputedStyle(el); return { bg: c.backgroundColor, fg: c.color, bl: c.borderLeftWidth, w: getComputedStyle(el.querySelector(".va-receipt-cap-title")).fontWeight }; });
      ok(css.bg === red, `A12 ${theme} solid red fill, got ${css.bg}`);
      ok(css.fg === "rgb(255, 255, 255)", `A12 ${theme} white ink, got ${css.fg}`);
      ok(css.bl === "0px", `A12 ${theme} no left rail, got ${css.bl}`);
      ok(Number(css.w) >= 600 && Number(css.w) <= 700, `A12 ${theme} 600-700 weight, got ${css.w}`);
      // An ok:false tick says so even when skipped[] is empty.
      ok(await page.locator(".va-receipt-failed").count() >= 1, `A12 ${theme} a failed tick is badged FAILED`);
      await shot(page, `agents-capability-${theme}`);
      ok(env.errors.length === 0, `A12 ${theme} no page errors (${env.errors[0] || ""})`);
    } finally { await close(env); }
  }
  /* ---------- A13 the memory-compaction line (F-511) ---------- */
  for (const [theme, teal, red, slate] of [
    ["light", "rgb(13, 148, 136)", "rgb(220, 38, 38)", "rgb(71, 85, 105)"],
    ["dark", "rgb(20, 184, 166)", "rgb(239, 68, 68)", "rgb(100, 116, 139)"],
  ]) {
    console.log(`A13 memory compaction (${theme})`);
    const env = await openAgents(browser, theme);
    const { page } = env;
    try {
      const css = (loc) => loc.evaluate((el) => {
        const c = getComputedStyle(el);
        const t = el.querySelector(".va-receipt-compact-title");
        return { bg: c.backgroundColor, fg: c.color, bl: c.borderLeftWidth, w: getComputedStyle(t).fontWeight };
      });

      /* The healthy agent: one clean compaction, and the backoff tick beside it. */
      await page.locator(".va-agent").first().locator(".rule-expand-btn").click();
      await page.locator(".va-pane-btn", { hasText: "Ticks" }).click();
      await page.locator(".va-receipt-compact").first().waitFor({ timeout: 8000 });
      const good = page.locator(".va-receipt-compact").first();
      const goodText = (await good.innerText()).trim();
      ok(goodText === "Memory compacted 7268 to 3942 bytes", `A13 ${theme} the clean chip names both sizes with the word "to", got ${JSON.stringify(goodText)}`);
      ok(!/[—–→]/.test(goodText), `A13 ${theme} no em-dash, en-dash or arrow on the clean chip`);
      const g = await css(good);
      ok(g.bg === teal, `A13 ${theme} solid teal fill, got ${g.bg}`);
      ok(g.fg === "rgb(255, 255, 255)", `A13 ${theme} white ink, got ${g.fg}`);
      ok(g.bl === "0px", `A13 ${theme} no left rail, got ${g.bl}`);
      ok(Number(g.w) >= 600 && Number(g.w) <= 700, `A13 ${theme} 600-700 weight, got ${g.w}`);

      const paused = page.locator(".va-receipt-compact-muted").first();
      await paused.waitFor({ timeout: 8000 });
      const pausedText = (await paused.innerText()).trim();
      ok(/paused for six hours/i.test(pausedText), `A13 ${theme} the backoff sentence is the copy map's, got ${JSON.stringify(pausedText)}`);
      ok(!/compaction-backoff/.test(pausedText), `A13 ${theme} the raw reason id is not what the admin reads`);
      ok((await css(paused)).bg === slate, `A13 ${theme} the paused state is solid slate`);
      /* A backoff tick is NOT a failure - the engine leaves the gate off it on purpose. */
      ok(await paused.locator("xpath=ancestor::div[contains(@class,'va-receipt')][1]").locator(".va-receipt-failed").count() === 0, `A13 ${theme} the backoff tick is not badged FAILED`);
      await shot(page, `agents-compaction-ok-${theme}`);

      /* The broken agent: the non-converging gate, and the fallback. */
      await page.locator(".va-agent").first().locator(".rule-expand-btn").click();
      await page.locator(".va-agent").nth(1).locator(".rule-expand-btn").click();
      await page.locator(".va-pane-btn", { hasText: "Ticks" }).click();
      await page.locator(".va-receipt-compact-bad").first().waitFor({ timeout: 8000 });
      const bad = page.locator(".va-receipt-compact-bad");
      ok(await bad.count() === 2, `A13 ${theme} both failing shapes render, got ${await bad.count()}`);
      const badTexts = (await bad.allInnerTexts()).map((t) => t.trim());
      ok(badTexts.every((t) => /Memory compaction failed/.test(t)), `A13 ${theme} each failure says so`);
      ok(badTexts.some((t) => /still over its byte budget/.test(t)), `A13 ${theme} the did-not-converge sentence`);
      ok(badTexts.some((t) => /summariser did not answer/.test(t)), `A13 ${theme} the summariser-failed sentence`);
      ok(badTexts.every((t) => !/[—–→]/.test(t)), `A13 ${theme} no em-dash, en-dash or arrow on the failed states`);
      ok(badTexts.every((t) => !/did-not-converge|summariser-failed|compaction:/.test(t)), `A13 ${theme} no raw reason ids`);
      /* The fallback is written by the engine TWICE (compacted.fellBack and a gated skip)
         and must be named once. */
      ok(badTexts.filter((t) => /summariser did not answer/.test(t)).length === 1, `A13 ${theme} the fallback is named once`);
      /* A failed compaction never renders the teal "compacted" chip beside itself. */
      ok(await page.locator(".va-receipt-compact:not(.va-receipt-compact-bad):not(.va-receipt-compact-muted)").count() === 0, `A13 ${theme} no clean chip on a failed compaction`);
      const b = await css(bad.first());
      ok(b.bg === red, `A13 ${theme} solid red fill, got ${b.bg}`);
      ok(b.fg === "rgb(255, 255, 255)", `A13 ${theme} white ink on the failed state, got ${b.fg}`);
      ok(b.bl === "0px", `A13 ${theme} no left rail on the failed state, got ${b.bl}`);
      ok(Number(b.w) >= 600 && Number(b.w) <= 700, `A13 ${theme} 600-700 weight on the failed state, got ${b.w}`);
      await shot(page, `agents-compaction-bad-${theme}`);
      ok(env.errors.length === 0, `A13 ${theme} no page errors (${env.errors[0] || ""})`);
    } finally { await close(env); }
  }
  /* ---------- A14 every engine reason id has copy, and no id ever leaks (F-518) ---------- */
  {
    console.log("A14 compaction copy covers the engine");
    /* THE SOURCE ASSERTION. The engine's reason ids are read out of `src/virtual-admin.js`
       itself, not typed here, so a new id added to `runVaCompaction` fails THIS test rather
       than reaching an admin as a raw string. Comments are stripped first: the docblocks
       quote ids that are not reasons (`compact_backoff_write_failed` is a backoff-write
       detail, never a compaction reason).

       F-525 - THE EXTRACTOR DOES NOT PATTERN-MATCH ON `reason:`. The first version of this
       guard only saw a bare literal directly after `reason:`, so a ternary
       (`reason: spent ? "a" : "b"`), a helper spread (`...compactionFail("x")`) or a
       leading interpolation (`` `${p}_failed` ``) added a reason the test could not see -
       and `size >= 8` passed on 8 of 9, so a swallowed id did not even move the count.
       Instead: take EVERY quoted literal inside the compaction sites' text ranges, split it
       on the engine's own `compaction:`/`:detail`/`${}` separators, and keep every part
       that matches the reason-id grammar. That over-collects a handful of JS-ish words that
       sit in those ranges and are not reasons, so they are named in ALLOW below and the
       test asserts each one is still there - a stale allow-list entry fails the run rather
       than silently excusing a real id that happens to share its name. */
    const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const engineSrc = fs.readFileSync(path.join(__dirname, "../../src/virtual-admin.js"), "utf8");
    const ID_RE = /^[a-z][a-z0-9_-]*$/;
    /* The two sites, by anchor: the whole of `runVaCompaction` (every arm returns a reason),
       and the tick's compaction slice - which must run PAST `const compactionGated` to the
       gate-reason line, so a `skipped.push` moved below that line is still inside the range
       (the old slice stopped short of exactly that). Any other `skipped.push` in the file
       that mentions compaction is swept in as its own range, so a site moved out of the
       tick entirely is still read. */
    const sites = (src) => {
      const afterFn = src.slice(src.indexOf("export const runVaCompaction"));
      const fnBody = afterFn.slice(0, afterFn.indexOf("\n};") + 3);
      const afterTick = src.slice(src.indexOf("const compaction = await runVaCompaction"));
      const gateLine = afterTick.indexOf("const compactionGateReason");
      const tickBody = afterTick.slice(0, gateLine >= 0 ? afterTick.indexOf("\n", gateLine) : afterTick.indexOf("\n};") + 3);
      const pushes = [];
      for (const m of src.matchAll(/skipped\.push\(/g)) {
        const seg = src.slice(m.index, src.indexOf(";", m.index) + 1);
        if (/compaction/.test(seg)) pushes.push(seg);
      }
      /* F-535 - EVERY `recordTickHealth(` call, not just the compaction one. The health row
         is the reason's durable home and two of its writers (the prepare and the post catch
         arms) live nowhere near a `skipped.push`, so the compaction-only scope could not
         see the ids they store. Each call runs to its own statement terminator, the
         `);`/`});` that closes it - none of these calls contains a `;` of its own. */
      const health = [];
      for (const m of src.matchAll(/recordTickHealth\(/g)) {
        health.push(src.slice(m.index, src.indexOf(";", m.index) + 1));
      }
      return { fnBody, tickBody, health, chunks: [fnBody, tickBody, ...pushes, ...health].map(strip) };
    };
    /* Every quoted literal in a range, cut into the ONE key the copy map is looked up by.
       A literal is read the way src/va-ledger.js `splitHealthReason` reads a stored reason:
       the interpolated tail is not part of the id, `compaction:` is the namespace the map's
       keys are written without, `capability:` resolves through its own copy home, and any
       other two id-shaped segments are a `namespace:id` key (`tick:prepare_failed`). */
    const copyKeyOf = (literal) => {
      const head = String(literal).split("$")[0];
      const segs = head.split(":").map((x) => x.trim()).filter((x) => ID_RE.test(x));
      if (!segs.length) return null;
      if (segs[0] === "compaction") return segs.length > 1 ? segs[1] : "compaction";
      if (segs[0] === "capability") return "capability";
      return segs.slice(0, 2).join(":");
    };
    const extractIds = (src) => {
      const out = new Set();
      for (const chunk of sites(src).chunks) {
        /* Two passes: ordinary quoted strings, and template literals - which the first
           pattern cannot see whole, because a `${...}` may hold a quote of its own. */
        for (const lit of chunk.matchAll(/(["'])((?:[^\\"'])*?)\1/g)) {
          const key = copyKeyOf(lit[2]);
          if (key) out.add(key);
        }
        for (const lit of chunk.matchAll(/`([^`]*)`/g)) {
          const key = copyKeyOf(lit[1]);
          if (key) out.add(key);
        }
      }
      return out;
    };
    const found = sites(engineSrc);
    ok(found.fnBody.length > 500 && found.tickBody.length > 200, "A14 both compaction push sites were located in the engine source");
    /* PROOF THE EXTRACTOR BITES (F-525). A scratch copy of the engine source - never the
       file - grows a ternary arm and a template reason. Both must come out, or this guard
       is back to matching shapes instead of reading the source. */
    const probeSrc = engineSrc.replace(
      "export const runVaCompaction = async ({ agent, tick, deps }) => {",
      'export const runVaCompaction = async ({ agent, tick, deps }) => {\n  if (globalThis.__never__) return { ran: false, gate: "compaction", reason: deps ? "harness_probe_ternary" : "harness_probe_other", detail: `${tick}:harness_probe_tail` };',
    );
    /* F-535 - and a health arm grows an id too, so the WIDENED scope is proven to bite the
       same way the compaction scope is. */
    const probeSrc2 = probeSrc.replace(
      "await recordTickHealth(deps.store, agentId, true, { now });",
      'await recordTickHealth(deps.store, agentId, true, { now, reason: "tick:harness_probe_health" });',
    );
    const probed = extractIds(probeSrc2);
    for (const id of ["harness_probe_ternary", "harness_probe_other", "tick:harness_probe_health"]) {
      ok(probed.has(id), `A14 the extractor sees a reason written as a ternary, a template or a health arm ("${id}")`);
    }
    /* The words in those ranges that are NOT reason ids: the gate/namespace value itself,
       and two BACKOFF-CAUSE details that ride `armBackoff()`/`detail` and never reach the
       copy map. Each is asserted present so this list cannot rot into an excuse. */
    const ALLOW = ["compaction", "compact_backoff_write_failed", "write_refused", "prepare"];
    const raw = extractIds(engineSrc);
    for (const w of ALLOW) ok(raw.has(w), `A14 the allow-listed non-reason word "${w}" is still in the compaction source (stale allow-list otherwise)`);
    const engineIds = new Set([...raw].filter((id) => !ALLOW.includes(id)));
    /* THE EXACT SET, listed here on purpose: a new engine id is not a bigger number, it is
       a failing test naming the id nobody has written a sentence for. */
    const EXPECTED = [
      /* F-564 - the purge tombstone read F-553 put in front of the compaction turn and the
         item turn (src/va-ledger.js `refuseIfPurged`). Receipt-free at every site, but the
         id is still pushed, so it owes a sentence like any other. */
      "agent-purged",
      "compaction-backoff",
      "compaction-backoff-write-failed",
      "compaction_failed",
      "compaction_produced_nothing",
      "did-not-converge",
      "memory_read_failed",
      "not_claimed",
      "pinned_dropped",
      "summariser-failed",
      "under_threshold",
      /* F-535 - the health row's own writers. `capability` stands for the whole
         `capability:<id>` namespace, whose sentences live in src/shared/edition.js and are
         asserted below rather than in the map; `unknown` is what `splitHealthReason` files
         a prose reason under. */
      "capability",
      "tick:post_failed",
      "tick:prepare_failed",
      "unknown",
    ];
    /* F-577/F-575 - IDS THE COPY LEADS THE ENGINE ON. The purge work lands in two halves:
       the engine half teaches `runVaItem` to answer `agent-purged-after-writes` (with a
       count) on the write-seam path, and this half writes the sentences. The copy may ship
       FIRST - an admin never sees a sentence for an id nobody emits, and a missing sentence
       is what does the damage - so these ids are allowed to be absent from the engine and
       are still REQUIRED to have copy. The tolerance is one-directional on purpose: an id
       the engine emits with no sentence fails below, always, and the moment the engine half
       merges these stop being pending and are covered by the ordinary `missing` check. */
    const PENDING_ENGINE_IDS = [
      "agent-purged-after-writes",
      "purge-settling",
    ];
    const extra = [...engineIds].filter((id) => !EXPECTED.includes(id) && !PENDING_ENGINE_IDS.includes(id)).sort();
    const missing = EXPECTED.filter((id) => !engineIds.has(id));
    ok(extra.length === 0, `A14 the engine pushes no reason id this test does not know about (new: ${extra.join(", ")})`);
    ok(missing.length === 0, `A14 every expected engine reason id is still pushed (gone: ${missing.join(", ")})`);
    const tabSrc = fs.readFileSync(path.join(__dirname, "../admin-panel/src/components/AgentsTab.jsx"), "utf8");
    const mapOf = (decl) => {
      const body = tabSrc.slice(tabSrc.indexOf(decl));
      return body.slice(0, body.indexOf("\n};"));
    };
    /* BOTH copy maps: the receipt's compaction ids and F-535's health ids. A key may be
       quoted (`"tick:prepare_failed"`) or bare (`unknown`), and a sentence may be written
       as the shared UNKNOWN_REASON constant rather than inline. */
    /* F-577 added a THIRD map to the scan (GATE_COPY, where a gate id's copy has always
       lived). F-614 added a FOURTH: `purge-settling` is not a gate on a receipt at all -
       the arm that produces it writes no receipt, so no skip row can ever carry it - and
       its sentence moved to STATUS_COPY, which answers "what is this agent doing right
       now" rather than "why did this tick skip that item". Function rows in GATE_COPY
       (`capability`, `agent-purged-after-writes`) do not match KEY_RE and are asserted by
       name below instead. */
    const mapText = `${mapOf("const COMPACTION_COPY = {")}\n${mapOf("const HEALTH_COPY = {")}\n${mapOf("const GATE_COPY = {")}\n${mapOf("const STATUS_COPY = {")}`;
    const KEY_RE = /^\s*"?([a-z][a-z0-9_:.-]*)"?\s*:\s*("([^"]+)"|UNKNOWN_REASON)/gm;
    const rows = [...mapText.matchAll(KEY_RE)];
    const unknownText = (tabSrc.match(/const UNKNOWN_REASON = "([^"]+)"/) || [])[1] || "";
    const mapKeys = new Set(rows.map((m) => m[1]));
    for (const id of [...engineIds].sort()) {
      /* `capability:<id>` has no row here on purpose: F-501 made src/shared/edition.js the
         ONE home for those words, so what is asserted is that the tab still routes to it. */
      if (id === "capability") {
        ok(/\/\^capability:\//.test(tabSrc) && /agentCapabilityCopy\(/.test(tabSrc), "A14 the capability namespace still resolves through agentCapabilityCopy()");
        ok(!!(agentCapabilityCopy("unknown") || {}).title, "A14 the capability copy home answers an id it has never heard of");
        continue;
      }
      ok(mapKeys.has(id), `A14 the copy map has a sentence for the engine id "${id}"`);
    }
    /* F-577/F-575 - the pending ids owe their sentence NOW, whether or not the engine half
       has merged. `agent-purged-after-writes` is a copy ROW, not a flat sentence, because
       it is the one purge an admin must act on: it renders the solid-red receipt state and
       names how many writes stayed on the issue, so it is asserted by shape rather than by
       KEY_RE. And the id it replaces must have stopped promising that nothing was written. */
    for (const id of PENDING_ENGINE_IDS) {
      const inFlatMap = mapKeys.has(id);
      const asCopyRow = new RegExp(`"${id}":\\s*\\(s\\)\\s*=>`).test(tabSrc);
      ok(inFlatMap || asCopyRow, `A14 the pending engine id "${id}" already has copy in the tab`);
    }
    ok(/"agent-purged-after-writes":\s*\(s\)\s*=>/.test(tabSrc) && /va-receipt-cap/.test(tabSrc),
      "A14 agent-purged-after-writes is a copy row, so it renders the solid-red receipt state");
    /* F-614 - MOVED, NOT COPIED. A gate row that no receipt can carry is dead copy wherever
       it sits, and two homes for one sentence is how they drift. So the sentence must be in
       STATUS_COPY and must NOT be back in GATE_COPY. */
    {
      const gateBody = mapOf("const GATE_COPY = {");
      const statusBody = mapOf("const STATUS_COPY = {");
      ok(!/"purge-settling"/.test(gateBody),
        "A14/F-614 the purge-settling sentence is no longer a GATE row - the arm that produces it writes no receipt, so that branch could never render");
      ok(/"purge-settling":\s*"/.test(statusBody),
        "A14/F-614 …and it lives in STATUS_COPY, which is keyed on the agent's state and reached from status.settling");
      ok(/status\.settling/.test(tabSrc) && /settlingLine\(/.test(tabSrc),
        "A14/F-614 …and the tab actually reads `status.settling`, so the copy has a live carrier");
    }
    ok(!/"agent-purged":\s*"[^"]*nothing was written[^"]*while a turn/.test(tabSrc),
      "A14 the entry-check sentence no longer claims nothing was written for a turn that ran");
    {
      const purgedRow = (tabSrc.match(/"agent-purged":\s*"([^"]+)"/) || [])[1] || "";
      ok(/before the turn started/.test(purgedRow),
        `A14 agent-purged names the entry check it actually covers, got ${JSON.stringify(purgedRow)}`);
      const afterRow = (tabSrc.match(/"agent-purged-after-writes":\s*"([^"]+)"/) || [])[1] || "";
      ok(/stayed on the issue/.test(afterRow),
        `A14 agent-purged-after-writes says the writes stayed on the issue, got ${JSON.stringify(afterRow)}`);
    }
    /* And no sentence carries an em-dash or an engine id inside it. */
    const sentences = rows.map((m) => m[3] || unknownText);
    ok(unknownText.length > 20, "A14 the neutral sentence was read from the tab");
    ok(sentences.length === mapKeys.size, `A14 every map key carries a sentence (${sentences.length} of ${mapKeys.size})`);
    ok(sentences.every((t) => !/[—–]/.test(t)), "A14 no em-dash or en-dash in the reason copy");
    ok(sentences.every((t) => ![...engineIds].some((id) => t.includes(id))), "A14 no sentence prints an engine id");
  }
  for (const [theme, red] of [["light", "rgb(220, 38, 38)"], ["dark", "rgb(239, 68, 68)"]]) {
    console.log(`A14 unknown and detailed ids (${theme})`);
    const env = await openAgents(browser, theme);
    const { page } = env;
    try {
      /* F-524 - THE HEALTH BANNER, the reason's SECOND and durable home. The fixture's
         `lastReason` is the engine's own string, prefix and exception slice included; the
         admin must read the mapped sentence and none of the string. */
      const hb = page.locator(".va-health-text").first();
      await hb.waitFor({ timeout: 8000 });
      const banner = (await hb.innerText()).trim();
      ok(/stopped on an unexpected error/.test(banner), `A14 ${theme} the health banner renders the mapped sentence, got ${JSON.stringify(banner)}`);
      for (const leak of ["compaction:", "compaction_failed", "TypeError", "Cannot read properties", "undefined"]) {
        ok(!banner.includes(leak), `A14 ${theme} the health banner never prints "${leak}"`);
      }
      ok(!/[—–→]/.test(banner), `A14 ${theme} no em-dash, en-dash or arrow in the health banner`);

      await page.locator(".va-agent").first().locator(".rule-expand-btn").click();
      await page.locator(".va-pane-btn", { hasText: "Ticks" }).click();
      await page.locator(".va-receipt-compact").first().waitFor({ timeout: 8000 });
      const texts = (await page.locator(".va-receipt-compact").allInnerTexts()).map((t) => t.trim());
      const all = texts.join("\n");

      /* The three shapes that used to print the engine at the admin. */
      ok(/pause could not be recorded/.test(all), `A14 ${theme} the backoff-write failure says the pause was not recorded`);
      ok(/lost a pinned instruction/.test(all), `A14 ${theme} pinned_dropped:2 reads as a sentence`);
      ok(/stopped on an unexpected error/.test(all), `A14 ${theme} compaction_failed reads as a sentence`);
      /* And the id nothing has copy for says so, and says NOTHING else. */
      ok(texts.some((t) => /Memory compaction reported an unrecognised result\./.test(t)), `A14 ${theme} an unknown id renders the neutral sentence`);

      /* NOTHING from the engine reaches the screen: not the id, not the count, not the
         exception text the `compaction_failed:` slice carries. */
      for (const leak of ["pinned_dropped", "compaction_failed", "compaction-backoff-write-failed", "compact_backoff_write_failed", "memory_conveyor_jammed", "sprocket-7", "TypeError", "Cannot read properties", "undefined", "compaction:"]) {
        ok(!all.includes(leak), `A14 ${theme} "${leak}" never appears in the admin's copy`);
      }
      ok(!/[—–→]/.test(all), `A14 ${theme} no em-dash, en-dash or arrow`);

      /* The un-armed brake is a GATED row, so it is solid red with white ink and no rail. */
      const brake = page.locator(".va-receipt-compact-bad", { hasText: "pause could not be recorded" }).first();
      await brake.waitFor({ timeout: 8000 });
      const css = await brake.evaluate((el) => {
        const c = getComputedStyle(el);
        return { bg: c.backgroundColor, fg: c.color, bl: c.borderLeftWidth, w: getComputedStyle(el.querySelector(".va-receipt-compact-title")).fontWeight };
      });
      ok(css.bg === red, `A14 ${theme} solid red fill on the un-armed brake, got ${css.bg}`);
      ok(css.fg === "rgb(255, 255, 255)", `A14 ${theme} white ink, got ${css.fg}`);
      ok(css.bl === "0px", `A14 ${theme} no left rail, got ${css.bl}`);
      ok(Number(css.w) >= 600 && Number(css.w) <= 700, `A14 ${theme} 600-700 weight, got ${css.w}`);
      await shot(page, `agents-compaction-unknown-${theme}`);
      ok(env.errors.length === 0, `A14 ${theme} no page errors (${env.errors[0] || ""})`);
    } finally { await close(env); }
  }
  /* ---------- A14c the three purge states, rendered, both themes (F-577 / F-575) ---------- */
  for (const [theme, red, slate] of [
    ["light", "rgb(220, 38, 38)", "rgb(71, 85, 105)"],
    ["dark", "rgb(239, 68, 68)", "rgb(100, 116, 139)"],
  ]) {
    console.log(`A14c purge states (${theme})`);
    const env = await openAgents(browser, theme);
    const { page } = env;
    try {
      await page.locator(".va-agent").first().locator(".rule-expand-btn").click();
      await page.locator(".va-pane-btn", { hasText: "Ticks" }).click();
      await page.locator(".va-receipt-cap").first().waitFor({ timeout: 8000 });
      const all = (await page.locator(".va-receipts").innerText());

      /* F-614 - THE SETTLING ROW IS NOT ASSERTED HERE ANY MORE, AND THAT IS THE POINT.
         This block used to drive a fabricated receipt carrying `gate: "purge-settling"`,
         and it passed for months while the product showed a re-created agent nothing:
         the engine arm that produces that gate is RECEIPT-FREE by design, so the row the
         fixture invented cannot exist. A hand-built fixture that only the renderer has
         ever seen is not evidence. The wait now arrives on `status.settling` and is
         asserted end to end in A17. What is still asserted here is the NEGATIVE: no skip
         row, and no engine detail string, anywhere on this pane. */
      ok(await page.locator(".va-receipt-skip", { hasText: /waiting for the deleted agent/i }).count() === 0,
        `A14c ${theme} no settling SKIP row is fixtured, because the engine cannot write one`);

      /* F-577 - the entry check keeps the "nothing was written" promise, because there it
         is true. */
      const before = page.locator(".va-receipt-skip", { hasText: /before the turn started/i }).first();
      const beforeFound = await before.count() === 1;
      ok(beforeFound, `A14c ${theme} the entry-check purge renders its sentence`);
      /* Read only if it is there: a missing row is already a failure above, and reading it
         anyway would spend a 30s locator timeout to say the same thing. */
      ok(beforeFound && /nothing was written/.test(await before.innerText()), `A14c ${theme} the entry check still says nothing was written`);

      /* F-577 - and the MID-TURN purge, which is the defect: a solid red state that names
         the count the engine sent, and never the promise that nothing was written. */
      const cap = page.locator(".va-receipt-cap", { hasText: /deleted while a turn was running/i }).first();
      const capFound = await cap.count() === 1;
      ok(capFound, `A14c ${theme} the mid-turn purge renders as its own state`);
      const capText = capFound ? (await cap.innerText()).trim() : "";
      ok(/3 earlier writes stayed on the issue/.test(capText), `A14c ${theme} the count the engine sent is named, got ${JSON.stringify(capText)}`);
      ok(/check its history/i.test(capText), `A14c ${theme} the admin is told where to look`);
      ok(!/nothing was written/.test(capText), `A14c ${theme} the mid-turn state never claims nothing was written`);
      ok(!/agent-purged/.test(capText), `A14c ${theme} the raw reason id is not what the admin reads`);
      ok(!/[\u2014\u2013\u2192]/.test(capText), `A14c ${theme} no em-dash, en-dash or arrow`);
      ok(/OPS-77/.test(capText), `A14c ${theme} the item the writes landed on is named`);
      const css = capFound ? await cap.evaluate((el) => {
        const c = getComputedStyle(el);
        return { bg: c.backgroundColor, fg: c.color, bl: c.borderLeftWidth, w: getComputedStyle(el.querySelector(".va-receipt-cap-title")).fontWeight };
      }) : { bg: "", fg: "", bl: "", w: "0" };
      ok(css.bg === red, `A14c ${theme} solid red fill on the mid-turn purge, got ${css.bg}`);
      ok(css.fg === "rgb(255, 255, 255)", `A14c ${theme} white ink, got ${css.fg}`);
      ok(css.bl === "0px", `A14c ${theme} no left rail, got ${css.bl}`);
      ok(Number(css.w) >= 600 && Number(css.w) <= 700, `A14c ${theme} 600-700 weight, got ${css.w}`);
      ok(slate.length > 0 && !all.includes("purge still settling"), `A14c ${theme} no engine detail anywhere on the pane`);
      await shot(page, `agents-purge-${theme}`);
      ok(env.errors.length === 0, `A14c ${theme} no page errors (${env.errors[0] || ""})`);
    } finally { await close(env); }
  }
  /* ---------- A14b the TICK's own health ids, both themes (F-535) ---------- */
  for (const theme of ["light", "dark"]) {
    console.log(`A14b tick health ids (${theme})`);
    for (const [id, must] of [["tick:prepare_failed", /before any work was queued/], ["tick:post_failed", /while it was posting/]]) {
      /* BOTH shapes: what the engine stores today (the base id alone, F-524) and the glued
         legacy row a site upgraded mid-flight still carries (`<id>:<exception>`). Neither
         may reach the admin, and both must land on the SAME sentence. */
      for (const stored of [id, `${id}:TypeError: Cannot read properties of undefined (reading 'text')`]) {
        const env = await openAgents(browser, theme, { __VA_HEALTH_REASON__: stored });
        const { page } = env;
        try {
          const hb = page.locator(".va-health-text").first();
          await hb.waitFor({ timeout: 8000 });
          const banner = (await hb.innerText()).trim();
          ok(must.test(banner), `A14b ${theme} "${stored}" renders its own sentence, got ${JSON.stringify(banner)}`);
          ok(!/does not recognise/.test(banner), `A14b ${theme} "${id}" is not falling through to the neutral sentence`);
          for (const leak of ["tick:", "prepare_failed", "post_failed", "TypeError", "Cannot read properties", "undefined"]) {
            ok(!banner.includes(leak), `A14b ${theme} the health banner never prints "${leak}"`);
          }
          ok(!/[\u2014\u2013\u2192]/.test(banner), `A14b ${theme} no em-dash, en-dash or arrow in the health banner`);
          if (stored === id) {
            const css = await page.locator(".va-health").first().evaluate((el) => {
              const c = getComputedStyle(el);
              return { bl: c.borderLeftWidth, fg: c.color, bg: c.backgroundColor };
            });
            ok(css.bl === "0px", `A14b ${theme} no left rail on the health banner, got ${css.bl}`);
            /* The tab fades in; a shot taken the instant the banner exists catches the
               transition mid-flight and is not a picture of anything. */
            await page.locator(".va-agent").first().waitFor({ timeout: 8000 });
            await page.waitForTimeout(600);
            await shot(page, `agents-health-${id.replace(":", "-")}-${theme}`);
          }
          ok(env.errors.length === 0, `A14b ${theme} no page errors (${env.errors[0] || ""})`);
        } finally { await close(env); }
      }
    }
  }

  /* ---------- A15 the SAVE's own notes reach the admin, on both doors (F-538) ---------- */
  /*
   * THE DEFECT THIS PINS. A successful `mode:"va"` save answers with `refused` (the
   * resolver, from `prepareVaSave`) and `vaRefused` (the job row, from the second
   * normalise pass). Both carry notes the browser CANNOT compute - the agent's own tick
   * counter, a catalogue source that failed - and both doors read neither, rendering only
   * the client-side `preview.refused`. So a field the save narrowed stayed a field the
   * operator believed they had set, and a toast said "Agent saved".
   *
   * The mock answers on BOTH keys deliberately: reading one and not the other is exactly
   * the shape of the original defect, and a fix that only picked up `refused` would pass a
   * one-key test. The `shadow-watch-unknown` row is the id case (no prose in `reason`), so
   * this also asserts the sentence map is what the admin reads.
   */
  for (const theme of ["light", "dark"]) {
    console.log(`A15 save notes (${theme})`);
    const NOTES = {
      refused: [{ field: "va.status.shadowUntilTick", reason: "shadow-watch-unknown" }],
      vaRefused: [{ field: "catalogue.projects", reason: "This site's projects could not be read, so that part of the configuration was accepted without being checked against live data." }],
    };
    const env = await openAgents(browser, theme, { __VA_SAVE_NOTES__: NOTES });
    const { page } = env;
    try {
      const amber = theme === "dark" ? "rgb(245, 158, 11)" : "rgb(217, 119, 6)";
      const ink = theme === "dark" ? "rgb(42, 22, 2)" : "rgb(255, 255, 255)";

      /* — the classic form — */
      await page.locator(".btn-small", { hasText: "Use the form" }).click();
      await page.locator(".va-editor").waitFor({ timeout: 8000 });
      await page.locator(".va-name").fill("Priya");
      await page.locator(".va-editor .section-actions .btn-solid").click();
      await page.locator(".va-save-notes").waitFor({ timeout: 8000 });
      ok(await page.locator(".va-editor").count() === 1, `A15 ${theme} the form stays open until the notes are dismissed`);

      const fields = await page.locator(".va-save-note-field").allInnerTexts();
      ok(fields.length === 2, `A15 ${theme} BOTH answer keys render, got ${fields.length}: ${JSON.stringify(fields)}`);
      ok(fields.some((f) => /va\.status\.shadowUntilTick/i.test(f)), `A15 ${theme} the resolver's "refused" row names its field`);
      ok(fields.some((f) => /catalogue\.projects/i.test(f)), `A15 ${theme} the job row's "vaRefused" row names its field`);

      const texts = await page.locator(".va-save-note-text").allInnerTexts();
      ok(texts.some((t) => /tick counter could not be read/i.test(t)), `A15 ${theme} the id became a sentence, got ${JSON.stringify(texts)}`);
      ok(texts.every((t) => !/shadow-watch-unknown/.test(t)), `A15 ${theme} the raw reason id is not what the admin reads`);
      ok(texts.some((t) => /without being checked against live data/i.test(t)), `A15 ${theme} the catalogue sentence is carried through`);
      ok(texts.every((t) => !/[—–→]/.test(t)), `A15 ${theme} no em-dash, en-dash or arrow`);

      const css = await page.locator(".va-save-notes").first().evaluate((el) => {
        const c = getComputedStyle(el);
        const t = getComputedStyle(el.querySelector(".va-save-note-text"));
        return { bg: c.backgroundColor, fg: c.color, bl: c.borderLeftWidth, w: t.fontWeight };
      });
      ok(css.bg === amber, `A15 ${theme} solid amber fill, got ${css.bg}`);
      ok(css.fg === ink, `A15 ${theme} the hue's own ink, got ${css.fg}`);
      ok(css.bl === "0px", `A15 ${theme} no left rail, got ${css.bl}`);
      ok(Number(css.w) >= 600 && Number(css.w) <= 700, `A15 ${theme} 600-700 weight, got ${css.w}`);
      await shot(page, `agents-save-notes-form-${theme}`);

      /* Dismissing is what returns to the list - nothing before it does. */
      await page.locator(".va-save-notes-dismiss").click();
      await page.locator(".section-title", { hasText: /Agents/ }).first().waitFor({ timeout: 8000 });
      ok(await page.locator(".va-editor").count() === 0, `A15 ${theme} dismissing leaves the form`);

      /* — the wizard's review step, same rendering — */
      await runInterview(page);
      await page.locator(".va-actions .btn-solid").click();
      await page.locator(".va-save-notes").waitFor({ timeout: 8000 });
      const wf = await page.locator(".va-save-note-field").allInnerTexts();
      ok(wf.length === 2, `A15 ${theme} the wizard review shows both notes, got ${wf.length}`);
      const wcss = await page.locator(".va-save-notes").first().evaluate((el) => getComputedStyle(el).backgroundColor);
      ok(wcss === amber, `A15 ${theme} the wizard uses the same solid amber, got ${wcss}`);
      await shot(page, `agents-save-notes-wizard-${theme}`);
      await page.locator(".va-save-notes-dismiss").click();
      await page.locator(".section-title", { hasText: /Agents/ }).first().waitFor({ timeout: 8000 });

      ok(env.errors.length === 0, `A15 ${theme} no page errors (${env.errors[0] || ""})`);
    } finally { await close(env); }
  }

  /* ---------- A16 the mode badge's THREE states (F-554) ----------
     The finding: `status` starts null, `shadow` read null as "not in shadow", and the card
     painted LIVE and Mode "live" for the whole of the status round trip - observed on
     staging against an agent that was actually in shadow with 500 ticks left. So both
     non-answers are driven here, on the SAME fixture that later resolves to SHADOW, and
     the assertion is that neither of them is ever allowed to read LIVE. */
  for (const [theme, slate, red] of [["light", "rgb(71, 85, 105)", "rgb(220, 38, 38)"], ["dark", "rgb(100, 116, 139)", "rgb(239, 68, 68)"]]) {
    console.log(`A16 mode badge three states (${theme})`);
    /* The delay is long enough to read the card mid-flight and short enough that the same
       page then shows the flip - one fixture, both halves of the claim. */
    const env = await openAgents(browser, theme, { __VA_STATUS_DELAY_MS__: 2500 });
    const { page } = env;
    try {
      const badge = page.locator(".va-agent").first().locator(".va-badge[data-mode]").first();
      await badge.waitFor({ timeout: 8000 });
      ok((await badge.innerText()).trim() === "LOADING", `A16 ${theme} an unanswered status reads LOADING, got ${JSON.stringify(await badge.innerText())}`);
      ok(await badge.getAttribute("data-mode") === "loading", `A16 ${theme} the loading mode is named on the element`);
      ok(await page.locator(".va-badge-live").count() === 0, `A16 ${theme} NOTHING is badged LIVE while no status has answered`);
      const modeStat = page.locator(".va-agent").first().locator(".va-stat", { hasText: /MODE/i }).first();
      ok(/checking/i.test(await modeStat.innerText()), `A16 ${theme} the Mode line reads checking, got ${JSON.stringify(await modeStat.innerText())}`);
      ok(!/\blive\b/i.test(await modeStat.innerText()), `A16 ${theme} the Mode line does not claim live while checking`);
      const lcss = await badge.evaluate((el) => { const c = getComputedStyle(el); return { bg: c.backgroundColor, fg: c.color, bl: c.borderLeftWidth, w: c.fontWeight }; });
      ok(lcss.bg === slate, `A16 ${theme} LOADING is solid neutral slate, got ${lcss.bg}`);
      ok(lcss.fg === "rgb(255, 255, 255)", `A16 ${theme} LOADING has white ink, got ${lcss.fg}`);
      ok(lcss.bl === "0px", `A16 ${theme} LOADING has no left rail, got ${lcss.bl}`);
      ok(Number(lcss.w) >= 600 && Number(lcss.w) <= 800, `A16 ${theme} LOADING is 600-800 weight, got ${lcss.w}`);
      // Let the card's entry animation settle so the saved PNG is readable evidence and
      // not a half-faded frame; the colour assertions above already ran on the element.
      await page.waitForTimeout(900);
      await shot(page, `agents-mode-loading-${theme}`);

      // ...and it FLIPS to the engine's own answer once the read lands. va_1 is in shadow.
      await page.locator(".va-agent").first().locator(".va-badge-shadow").waitFor({ timeout: 10000 });
      ok((await badge.innerText()).trim() === "SHADOW", `A16 ${theme} the loaded status reads SHADOW, got ${JSON.stringify(await badge.innerText())}`);
      ok(/shadow, 4 ticks left/.test(await modeStat.innerText()), `A16 ${theme} the Mode line carries the engine's ticks left, got ${JSON.stringify(await modeStat.innerText())}`);
      // The SECOND agent's status says shadow:null - only THAT may read LIVE.
      ok(await page.locator(".va-badge-live").count() === 1, `A16 ${theme} only the agent whose status says shadow:null is badged LIVE`);
      ok(env.errors.length === 0, `A16 ${theme} no page errors (${env.errors[0] || ""})`);
    } finally { await close(env); }

    /* A failed read is NOT a live agent. */
    const env2 = await openAgents(browser, theme, { __VA_STATUS_FAIL__: true });
    const page2 = env2.page;
    try {
      const badge = page2.locator(".va-agent").first().locator(".va-badge[data-mode]").first();
      await badge.waitFor({ timeout: 8000 });
      await page2.locator(".va-agent").first().locator(".va-badge-unknown").waitFor({ timeout: 8000 });
      ok((await badge.innerText()).trim() === "UNKNOWN", `A16 ${theme} a failed status read reads UNKNOWN, got ${JSON.stringify(await badge.innerText())}`);
      ok(await page2.locator(".va-badge-live").count() === 0, `A16 ${theme} a failed read is NEVER badged LIVE`);
      const modeStat = page2.locator(".va-agent").first().locator(".va-stat", { hasText: /MODE/i }).first();
      ok(/not known/i.test(await modeStat.innerText()), `A16 ${theme} the Mode line says not known, got ${JSON.stringify(await modeStat.innerText())}`);
      const ucss = await badge.evaluate((el) => { const c = getComputedStyle(el); return { bg: c.backgroundColor, fg: c.color, bl: c.borderLeftWidth, w: c.fontWeight }; });
      ok(ucss.bg === red, `A16 ${theme} UNKNOWN is the app's solid red, got ${ucss.bg}`);
      ok(ucss.fg === "rgb(255, 255, 255)", `A16 ${theme} UNKNOWN has white ink, got ${ucss.fg}`);
      ok(ucss.bl === "0px", `A16 ${theme} UNKNOWN has no left rail, got ${ucss.bl}`);
      // The way back: a Retry that actually re-asks, exactly as F-436's read offers one.
      const retry = page2.locator(".va-agent").first().locator("button", { hasText: /^Retry$/ }).first();
      ok(await retry.count() === 1, `A16 ${theme} the unknown state offers a Retry`);
      await page2.waitForTimeout(900);
      await shot(page2, `agents-mode-unknown-${theme}`);
      await page2.evaluate(() => { window.__VA_STATUS_FAIL__ = false; });
      await retry.click();
      await page2.locator(".va-agent").first().locator(".va-badge-shadow").waitFor({ timeout: 8000 });
      ok((await badge.innerText()).trim() === "SHADOW", `A16 ${theme} Retry re-asks and the real state lands`);
      ok(env2.errors.length === 0, `A16 ${theme} no page errors (${env2.errors[0] || ""})`);
    } finally { await close(env2); }
  }

  /* ---------- A17 the deleted agents that wrote on their way out (F-608) ---------- */
  for (const [theme, red, slate] of [
    ["light", "rgb(220, 38, 38)", "rgb(71, 85, 105)"],
    ["dark", "rgb(239, 68, 68)", "rgb(100, 116, 139)"],
  ]) {
    console.log(`A17 recent purges (${theme})`);

    /* EMPTY. The resolver only ever returns tombstones that landed writes, so an empty
       array is trustworthy and the honest rendering is silence - not a box saying nothing
       happened, which is the shape that trains an admin to stop reading the panel. */
    {
      const env = await openAgents(browser, theme);
      try {
        await env.page.locator(".va-agent").first().waitFor({ timeout: 8000 });
        await env.page.waitForTimeout(500);
        ok(await env.page.locator(".va-purges").count() === 0, `A17 ${theme} no purge with writes renders NO section at all`);
        ok(env.errors.length === 0, `A17 ${theme} empty: no page errors (${env.errors[0] || ""})`);
      } finally { await close(env); }
    }

    /* TWO ROWS. The agent, when it went, how many writes, and the turns on click. */
    {
      const env = await openAgents(browser, theme, { __VA_PURGES__: "two" });
      const { page } = env;
      try {
        await page.locator(".va-purges").waitFor({ timeout: 8000 });
        const title = (await page.locator(".va-purges .label").first().innerText()).trim();
        ok(/deleted agents that wrote during deletion/i.test(title), `A17 ${theme} the section says what it is, got ${JSON.stringify(title)}`);
        const rows = page.locator(".va-purge");
        ok(await rows.count() === 2, `A17 ${theme} both purges render, got ${await rows.count()}`);
        const first = (await rows.first().innerText()).trim();
        ok(/va_nadia_old/.test(first), `A17 ${theme} the row names the agent, got ${JSON.stringify(first)}`);
        ok(/3 writes stayed/.test(first), `A17 ${theme} the row carries the engine's write count`);
        ok(!/not known yet/.test(first), `A17 ${theme} the purge time is rendered, not "not known yet"`);
        const second = (await rows.nth(1).innerText()).trim();
        ok(/1 write stayed/.test(second), `A17 ${theme} a count of one is singular, got ${JSON.stringify(second)}`);
        /* Newest purge first, which is the order listRecentPurges sorts in and the order
           an admin acts in. */
        ok(/va_nadia_old/.test(first) && /va_triage_old/.test(second), `A17 ${theme} newest purge first`);

        // The turns are behind a click, and they name the issue and the write kinds.
        ok(await page.locator(".va-purge-turn").count() === 0, `A17 ${theme} the turns start collapsed`);
        await rows.first().locator(".va-purge-head").click();
        await page.locator(".va-purge-turn").first().waitFor({ timeout: 5000 });
        const turns = await page.locator(".va-purge-turn").allInnerTexts();
        ok(turns.length === 2, `A17 ${theme} both turns expand, got ${turns.length}`);
        ok(/SUP-1/.test(turns[0]) && /SUP-4/.test(turns[1]), `A17 ${theme} each turn names its issue`);
        const writeChips = await page.locator(".va-purge-write").allInnerTexts();
        ok(writeChips.length === 3 && writeChips.includes("add_comment SUP-1") && writeChips.includes("transition SUP-1") && writeChips.includes("set_assignee OPS-12") === false,
          `A17 ${theme} only the expanded row's write kinds render, got ${JSON.stringify(writeChips)}`);

        // Law 6, computed: solid fills, white ink, 600-700 weight, no rail anywhere.
        const chipCss = (loc) => loc.evaluate((el) => { const c = getComputedStyle(el); return { bg: c.backgroundColor, fg: c.color, bl: c.borderLeftWidth, w: c.fontWeight }; });
        const count = await chipCss(page.locator(".va-purge-count").first());
        ok(count.bg === red, `A17 ${theme} the write count is the app's solid red, got ${count.bg}`);
        ok(count.fg === "rgb(255, 255, 255)", `A17 ${theme} white ink on the count, got ${count.fg}`);
        ok(count.bl === "0px", `A17 ${theme} no left rail on the count`);
        ok(Number(count.w) >= 600 && Number(count.w) <= 800, `A17 ${theme} bold count, got ${count.w}`);
        const w = await chipCss(page.locator(".va-purge-write").first());
        ok(w.bg === slate, `A17 ${theme} the write kinds are solid slate, got ${w.bg}`);
        ok(w.fg === "rgb(255, 255, 255)", `A17 ${theme} white ink on a write kind, got ${w.fg}`);
        ok(w.bl === "0px", `A17 ${theme} no left rail on a write kind`);
        const rowCss = await chipCss(page.locator(".va-purge").first());
        ok(rowCss.bl === "1px", `A17 ${theme} the row is fully bordered, never a left rail, got ${rowCss.bl}`);

        const all = (await page.locator(".va-purges").innerText()).trim();
        ok(!/[—–→]/.test(all), `A17 ${theme} no em-dash, en-dash or arrow in the section`);
        ok(!/scan_failed|scan_unavailable|agent-purged/.test(all), `A17 ${theme} no engine id reaches the admin`);
        ok(await page.locator(".va-purge-fault").count() === 0, `A17 ${theme} a good answer raises no fault notice`);
        ok(await page.locator(".va-purge-more").count() === 0, `A17 ${theme} a complete answer claims nothing about older rows`);
        await page.waitForTimeout(900);
        await shot(page, `agents-purges-${theme}`);
        ok(env.errors.length === 0, `A17 ${theme} two rows: no page errors (${env.errors[0] || ""})`);
      } finally { await close(env); }
    }

    /* TRUNCATED. The list is bounded by VA_ADMIN_PURGES_MAX and says so. */
    {
      const env = await openAgents(browser, theme, { __VA_PURGES__: "truncated" });
      try {
        await env.page.locator(".va-purge-more").waitFor({ timeout: 8000 });
        const note = (await env.page.locator(".va-purge-more").innerText()).trim();
        ok(/older/i.test(note) && /not shown/i.test(note), `A17 ${theme} the truncation note says what is missing, got ${JSON.stringify(note)}`);
        ok(await env.page.locator(".va-purge").count() === 2, `A17 ${theme} the rows still render beside the note`);
        ok(env.errors.length === 0, `A17 ${theme} truncated: no page errors (${env.errors[0] || ""})`);
      } finally { await close(env); }
    }

    /* A STORAGE FAULT IS NOT AN EMPTY STATE. "No agent wrote while it was being deleted"
       is the one sentence this panel must not say falsely, so an unreadable store makes
       the section APPEAR, in solid red, with no rows. */
    {
      const env = await openAgents(browser, theme, { __VA_PURGES__: "scan_failed" });
      const { page } = env;
      try {
        await page.locator(".va-purge-fault").waitFor({ timeout: 8000 });
        const text = (await page.locator(".va-purge-fault").innerText()).trim();
        ok(/not the whole answer/i.test(text), `A17 ${theme} the notice says the list is incomplete, got ${JSON.stringify(text)}`);
        ok(/could not be read/i.test(text), `A17 ${theme} the notice names the fault`);
        ok(!/scan_failed/.test(text), `A17 ${theme} the engine's reason id is not what the admin reads`);
        ok(!/[—–→]/.test(text), `A17 ${theme} no em-dash in the fault notice`);
        ok(await page.locator(".va-purge").count() === 0, `A17 ${theme} a fault invents no rows`);
        ok(await page.locator(".va-purges .empty-state").count() === 0, `A17 ${theme} a fault is NEVER rendered as an empty state`);
        const f = await page.locator(".va-purge-fault").evaluate((el) => { const c = getComputedStyle(el); const t = el.querySelector(".va-purge-fault-title"); return { bg: c.backgroundColor, fg: c.color, bl: c.borderLeftWidth, w: getComputedStyle(t).fontWeight }; });
        ok(f.bg === red, `A17 ${theme} the fault notice is solid red, got ${f.bg}`);
        ok(f.fg === "rgb(255, 255, 255)", `A17 ${theme} white ink on the fault notice, got ${f.fg}`);
        ok(f.bl === "0px", `A17 ${theme} no left rail on the fault notice`);
        ok(Number(f.w) >= 600 && Number(f.w) <= 800, `A17 ${theme} the fault title is bold, got ${f.w}`);
        await page.waitForTimeout(900);
        await shot(page, `agents-purges-fault-${theme}`);
        ok(env.errors.length === 0, `A17 ${theme} fault: no page errors (${env.errors[0] || ""})`);
      } finally { await close(env); }
    }

    /* THE ROLE FLOOR. This read is admin-only and the agent list is not, so an editor sees
       the tab and this one refusal - rendered in the backend's own words, because the
       sentence that names a remedy and its owner is the backend's to write. */
    {
      const env = await openAgents(browser, theme, { __VA_PURGES__: "non_admin" });
      const { page } = env;
      try {
        await page.locator(".va-purges .va-refused").waitFor({ timeout: 8000 });
        const text = (await page.locator(".va-purges .va-refused").innerText()).trim();
        ok(/don't have permission/i.test(text) && /admin role/i.test(text), `A17 ${theme} the backend's refusal is rendered as given, got ${JSON.stringify(text)}`);
        ok(await page.locator(".va-purge-fault").count() === 0, `A17 ${theme} a permission refusal is not a storage fault`);
        ok(await page.locator(".va-purge").count() === 0, `A17 ${theme} a refusal invents no rows`);
        ok(env.errors.length === 0, `A17 ${theme} refusal: no page errors (${env.errors[0] || ""})`);
      } finally { await close(env); }
    }
  }

  /* ---------- A18 the purge SETTLE WINDOW is visible at all (F-614) ----------
   *
   * THE DEFECT THIS PINS. An admin deletes an agent and re-creates it under the same id
   * (the documented recovery). For the next five minutes every tick skips, writes NOTHING
   * - the arm is receipt-free BECAUSE the standing tombstone refuses every ledger write -
   * and the Agents tab showed no new tick and no sentence. Measured live on staging twice:
   * 180 s of waiting for a receipt that cannot exist, while `forge logs` carried "purge
   * still settling". The sentence written for this exact moment sat in GATE_COPY, keyed on
   * a skip row nothing can produce.
   *
   * So the carrier is a READ (`status.settling`, projected from the tombstone) and this
   * asserts the two places an admin looks: the card, where "Last tick" would otherwise be
   * the only thing on screen and reads as silence, and the Ticks pane, whose honest
   * "nothing new" is exactly what looks like a dead agent.
   *
   * `stale` is the second mode: a tombstone past its window is the F-585/F-596 truncation
   * lockout, which can last days. It must render the same wait, never a clock in the past
   * and never nothing.
   */
  for (const theme of ["light", "dark"]) {
    console.log(`A18 purge settle window (${theme})`);
    const env = await openAgents(browser, theme, { __VA_SETTLING__: "window" });
    const { page } = env;
    try {
      const amber = theme === "dark" ? "rgb(245, 158, 11)" : "rgb(217, 119, 6)";
      const card = page.locator(".va-agent").first();
      const banner = card.locator(".va-settling").first();
      await banner.waitFor({ timeout: 8000 });
      const title = (await banner.locator(".va-settling-title").innerText()).trim();
      const text = (await banner.locator(".va-settling-text").innerText()).trim();
      ok(/Deletion settling until/.test(title), `A18 ${theme} the card names the wait and when it ends, got ${JSON.stringify(title)}`);
      ok(/\d{1,2}:\d{2}/.test(title), `A18 ${theme} …with a real clock time, got ${JSON.stringify(title)}`);
      ok(/ticks are skipped/.test(title), `A18 ${theme} …and says plainly that nothing is running`);
      ok(/waiting for the deleted agent's last turns/.test(text), `A18 ${theme} the copy is the sentence written for this moment, got ${JSON.stringify(text)}`);
      for (const leak of ["purge-settling", "scan_truncated", "va_purged", "tombstone", "undefined", "NaN"]) {
        ok(!`${title} ${text}`.includes(leak), `A18 ${theme} the admin never reads the engine word "${leak}"`);
      }
      ok(!/[—–→]/.test(`${title} ${text}`), `A18 ${theme} no em-dash, en-dash or arrow`);

      const css = await banner.evaluate((el) => {
        const c = getComputedStyle(el);
        const t = getComputedStyle(el.querySelector(".va-settling-title"));
        return { bg: c.backgroundColor, fg: c.color, bl: c.borderLeftWidth, w: t.fontWeight };
      });
      ok(css.bg === amber, `A18 ${theme} solid amber fill, because this is a WAIT and not a failure, got ${css.bg}`);
      ok(css.fg === "rgb(255, 255, 255)", `A18 ${theme} white ink on the solid fill, got ${css.fg}`);
      ok(css.bl === "0px", `A18 ${theme} no left rail, got ${css.bl}`);
      ok(Number(css.w) >= 700, `A18 ${theme} the title carries the emphasis, got ${css.w}`);
      /* The health banner is RED and means somebody must act; this must not be red too. */
      ok(css.bg !== "rgb(220, 38, 38)" && css.bg !== "rgb(239, 68, 68)", `A18 ${theme} the wait is not dressed as the failure banner`);

      /* — the Ticks pane, where the absence of a receipt is what the admin is staring at — */
      await card.locator(".rule-expand-btn").click();
      await page.locator(".va-pane-btn", { hasText: "Ticks" }).click();
      const paneHead = page.locator(".va-settling-pane").first();
      await paneHead.waitFor({ timeout: 8000 });
      ok(/Deletion settling until/.test((await paneHead.locator(".va-settling-title").innerText()).trim()),
        `A18 ${theme} the Ticks pane header states the wait, so "no new tick" is not read as a dead agent`);
      await shot(page, `agents-settling-${theme}`);
      ok(env.errors.length === 0, `A18 ${theme} no page errors (${env.errors[0] || ""})`);
    } finally { await close(env); }
  }
  {
    console.log("A18 a tombstone past its window (the truncation lockout)");
    const env = await openAgents(browser, "light", { __VA_SETTLING__: "stale" });
    const { page } = env;
    try {
      const banner = page.locator(".va-agent").first().locator(".va-settling").first();
      await banner.waitFor({ timeout: 8000 });
      const title = (await banner.locator(".va-settling-title").innerText()).trim();
      ok(/settling/i.test(title) && /ticks are skipped/.test(title),
        `A18 a tombstone that has outlived its window still states the wait, got ${JSON.stringify(title)}`);
      ok(env.errors.length === 0, `A18 stale: no page errors (${env.errors[0] || ""})`);
    } finally { await close(env); }
  }
  {
    console.log("A18 no tombstone, no state");
    const env = await openAgents(browser, "light");
    const { page } = env;
    try {
      await page.locator(".va-agent").first().locator(".va-stats").waitFor({ timeout: 8000 });
      await page.waitForTimeout(400);
      ok(await page.locator(".va-settling").count() === 0,
        "A18 an agent with no tombstone shows NO settle state - the card is unchanged for every agent that was not just re-created");
    } finally { await close(env); }
  }
} finally {
  await browser.close();
}
console.log(`\nagents-tab: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
