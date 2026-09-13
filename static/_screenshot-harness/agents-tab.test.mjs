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
 *       a helper or a template cannot slip past it (F-525).
 *   A15 a SUCCESSFUL save's own notes reach the admin on BOTH doors (F-538): the resolver's
 *       `refused` and the job row's `vaRefused` both render, the id becomes a sentence, the
 *       door stays open until the notes are dismissed - both themes, computed colours.
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
      return { fnBody, tickBody, chunks: [fnBody, tickBody, ...pushes].map(strip) };
    };
    /* Every quoted literal in a range, cut into the parts the copy map is keyed on. */
    const extractIds = (src) => {
      const out = new Set();
      for (const chunk of sites(src).chunks) {
        for (const lit of chunk.matchAll(/(["'`])((?:[^\\`"']|\\.)*?)\1/g)) {
          for (const part of String(lit[2]).replace(/^compaction:/, "").split(/[:$]/)) {
            const p = part.trim();
            if (ID_RE.test(p)) out.add(p);
          }
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
    const probed = extractIds(probeSrc);
    for (const id of ["harness_probe_ternary", "harness_probe_other", "harness_probe_tail"]) {
      ok(probed.has(id), `A14 the extractor sees a reason written as a ternary or a template ("${id}")`);
    }
    /* The words in those ranges that are NOT reason ids: the gate/namespace value itself,
       and two BACKOFF-CAUSE details that ride `armBackoff()`/`detail` and never reach the
       copy map. Each is asserted present so this list cannot rot into an excuse. */
    const ALLOW = ["compaction", "compact_backoff_write_failed", "write_refused"];
    const raw = extractIds(engineSrc);
    for (const w of ALLOW) ok(raw.has(w), `A14 the allow-listed non-reason word "${w}" is still in the compaction source (stale allow-list otherwise)`);
    const engineIds = new Set([...raw].filter((id) => !ALLOW.includes(id)));
    /* THE EXACT SET, listed here on purpose: a new engine id is not a bigger number, it is
       a failing test naming the id nobody has written a sentence for. */
    const EXPECTED = [
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
    ];
    const extra = [...engineIds].filter((id) => !EXPECTED.includes(id)).sort();
    const missing = EXPECTED.filter((id) => !engineIds.has(id));
    ok(extra.length === 0, `A14 the engine pushes no reason id this test does not know about (new: ${extra.join(", ")})`);
    ok(missing.length === 0, `A14 every expected engine reason id is still pushed (gone: ${missing.join(", ")})`);
    const tabSrc = fs.readFileSync(path.join(__dirname, "../admin-panel/src/components/AgentsTab.jsx"), "utf8");
    const mapBody = tabSrc.slice(tabSrc.indexOf("const COMPACTION_COPY = {"));
    const mapText = mapBody.slice(0, mapBody.indexOf("\n};"));
    const mapKeys = new Set([...mapText.matchAll(/^\s*"([^"]+)":/gm)].map((m) => m[1]));
    for (const id of [...engineIds].sort()) ok(mapKeys.has(id), `A14 the copy map has a sentence for the engine id "${id}"`);
    /* And no sentence carries an em-dash or an engine id inside it. */
    const sentences = [...mapText.matchAll(/^\s*"[^"]+":\s*"([^"]+)"/gm)].map((m) => m[1]);
    ok(sentences.length === mapKeys.size, "A14 every map key carries a sentence");
    ok(sentences.every((t) => !/[—–]/.test(t)), "A14 no em-dash or en-dash in the compaction copy");
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
} finally {
  await browser.close();
}
console.log(`\nagents-tab: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
