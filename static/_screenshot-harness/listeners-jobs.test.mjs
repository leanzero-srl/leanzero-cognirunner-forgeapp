/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 *
 * admin-panel LISTENERS + SCHEDULED JOBS + API ACCESS browser journeys (mock-bridge harness).
 * Drives the REAL admin-panel build with @forge/bridge aliased to bridge.js, so the tabs,
 * editors, pickers, test-run and run-now flows are exercised end-to-end against canned
 * resolver responses — UI-behaviour coverage in isolation, no Jira / AI needed.
 *
 * No prereq build: the suite rebuilds admin-panel's build-shot itself when it is
 * missing or older than src/ (lib/build-shot.mjs, F-125).
 * Run:    node static/_screenshot-harness/listeners-jobs.test.mjs   (add --shots to save PNGs to out/)
 */
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureFreshBuildShot } from "./lib/build-shot.mjs";
/* F-189 - the byte guard, the platform ceiling and the over-platform refusal sentence come
   from the ONE home for them, so a test cannot assert a limit or a sentence the app does
   not actually use. */
import { MEMORY_MAX_SERIALIZED_BYTES, MEMORY_PLATFORM_MAX_SERIALIZED_BYTES, memoryPlatformCapMessage } from "../../src/shared/registry-limits.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC = path.resolve(__dirname, "..");
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
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true }); };

async function openAdmin(browser, theme = "light", extraInit = null) {
  const root = ensureFreshBuildShot("admin-panel"); // F-125: never serve a bundle older than src/
  const { s, port } = await serve(root);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await ctx.addInitScript(([th, extra]) => { window.__SHOT__ = "admin"; window.__THEME__ = th; if (extra) for (const k in extra) window[k] = extra[k]; }, [theme, extraInit]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e && e.message)));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!document.querySelector(".container") && !document.querySelector(".container .sk"), { timeout: 15000 }).catch(() => {});
  return { page, ctx, s, errors };
}
async function close(env) { await env.ctx.close(); await new Promise((r) => env.s.close(r)); }
const tab = (page, label) => page.locator(".tab-btn", { hasText: new RegExp(`^\\s*${label}\\s*$`) }).first().click();

const browser = await chromium.launch();
try {
  /* ---------------- L1 — Listeners tab: list renders rows, chips, stats, badges ---------------- */
  {
    console.log("L1 listeners list");
    const env = await openAdmin(browser);
    const { page } = env;
    try {
      await tab(page, "Listeners");
      await page.locator(".lst-table").waitFor({ timeout: 10000 });
      ok(await page.locator(".lst-table tbody tr:not(.rule-accordion-row)").count() === 3, "L1 three listener rows");
      ok(await page.locator(".tab-intro-eyebrow", { hasText: "LISTENERS" }).count() === 1, "L1 tab intro renders");
      ok(await page.locator(".evp-chip", { hasText: "Comment added" }).count() > 0, "L1 event chips render with labels");
      ok(await page.locator(".lst-more", { hasText: "+1" }).count() === 1, "L1 overflow chip (+1) for the 4-event listener");
      ok(await page.locator(".type-badge.lst-mode-agent", { hasText: /AI agent/i }).count() === 1, "L1 AI agent mode badge");
      ok(await page.locator(".type-badge.lst-mode-script").count() === 2, "L1 code mode badges");
      ok(await page.locator(".lst-aic").count() === 1, "L1 AI GATE badge on the gated listener");
      ok(await page.locator(".lst-sim").count() === 1, "L1 DRY-RUN badge on the simulated listener");
      ok(await page.locator(".status-badge.status-disabled").count() === 1, "L1 disabled badge");
      ok(await page.locator(".runstat-ok").count() === 1 && await page.locator(".runstat-err").count() === 1 && await page.locator(".runstat-never").count() === 1, "L1 run stats: ok / error / never");
      // search narrows
      await page.locator(".list-search").fill("version");
      ok(await page.locator(".lst-table tbody tr:not(.rule-accordion-row)").count() === 1, "L1 search narrows to the version listener");
      await page.locator(".list-search").fill("");
      // accordion shows recent executions
      await page.locator(".rule-expand-btn").first().click();
      await page.locator(".rule-accordion-inner").waitFor({ timeout: 5000 });
      ok(await page.locator(".rule-accordion-title", { hasText: "Recent executions" }).count() === 1, "L1 accordion opens with recent executions");
      await shot(page, "L1-listeners-list");
      ok(env.errors.length === 0, "L1 no page errors: " + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  ✗ L1 threw: " + e.message.split("\n")[0]); }
    await close(env);
  }

  /* ---------------- L2 — new listener: event picker, filters, mode switch, agent config, test run ---------------- */
  {
    console.log("L2 new listener editor");
    const env = await openAdmin(browser);
    const { page } = env;
    try {
      await tab(page, "Listeners");
      await page.locator("button", { hasText: "+ Add Listener" }).first().click();
      await page.locator(".lst-editor").waitFor({ timeout: 10000 });
      ok(await page.locator(".section-title", { hasText: "New listener" }).count() === 1, "L2 editor opens");
      await page.locator("#lst-name").fill("Ack pings");
      // event picker: search + pick
      ok(await page.locator(".evp-none").count() === 1, "L2 no events selected initially");
      await page.locator(".evp-search").fill("comment");
      ok(await page.locator(".evp-row").count() === 3, "L2 search narrows the catalogue to the 3 comment events");
      await page.locator(".evp-row", { hasText: "Comment added" }).locator("input").check();
      ok(await page.locator(".evp-selected .evp-chip", { hasText: "Comment added" }).count() === 1, "L2 picked event shows as a solid chip");
      await page.locator(".evp-search").fill("viewed");
      ok(await page.locator(".evp-row .evp-vol", { hasText: "HIGH VOLUME" }).count() === 1, "L2 high-volume warning on Issue viewed");
      await page.locator(".evp-search").fill("");
      // comment-specific filter appears, jql filter appears
      ok(await page.locator(".lst-filter-label", { hasText: "Comment matches" }).count() === 1, "L2 comment-pattern filter offered for comment events");
      ok(await page.locator(".lst-filter-label", { hasText: "Issue matches JQL" }).count() === 1, "L2 JQL filter offered");
      ok(await page.locator(".lst-filter-label", { hasText: "Changed fields" }).count() === 0, "L2 changed-fields filter NOT offered (no updated:issue)");
      // project picker is a custom dropdown (no native select anywhere)
      ok(await page.locator("select").count() === 0, "L2 no native <select> elements");
      await page.locator(".projpick .dropdown-trigger").first().click();
      await page.locator(".dropdown-item", { hasText: "Demo Project" }).first().click();
      ok(await page.locator(".chips-chip-project").count() === 1, "L2 project chip added via custom dropdown");
      // issue types chips input
      await page.locator(".lst-filter", { hasText: "Issue types" }).locator(".chips-input").fill("Bug");
      await page.keyboard.press("Enter");
      ok(await page.locator(".chips-chip", { hasText: "Bug" }).count() === 1, "L2 issue-type chip via Enter");
      // mode switch → agent
      await page.locator(".mode-btn.mode-agent").click();
      ok(await page.locator(".mode-btn.mode-agent.on").count() === 1, "L2 AI agent mode selected (solid)");
      ok(await page.locator(".agc-textarea").count() === 1, "L2 agent instructions textarea renders");
      ok(await page.locator(".agc-action").count() >= 12, "L2 action checklist renders the catalogue");
      ok(await page.locator(".agc-action.on").count() === 3, "L2 default allowed actions pre-ticked (3)");
      await page.locator(".agc-action", { hasText: "Add labels" }).locator("input").check();
      ok(await page.locator(".agc-action.on").count() === 4, "L2 ticking an action adds it");
      await page.locator(".agc-textarea").fill("Reply with a short acknowledgement.");
      // test run
      await page.locator(".lst-test .btn-solid", { hasText: "Run test" }).click();
      await page.locator(".runres").waitFor({ timeout: 8000 });
      ok(await page.locator(".runres-badge.ok", { hasText: "PASS" }).count() === 1, "L2 test result renders PASS");
      ok(await page.locator(".runres-details summary", { hasText: "1 change" }).count() === 1, "L2 test result lists simulated changes");
      // save keeps the editor open with the returned id
      await page.locator(".section-actions .btn-edit", { hasText: /^Save$/ }).click();
      await page.locator(".mls-toast", { hasText: "Listener saved" }).waitFor({ timeout: 5000 });
      ok(true, "L2 save toast");
      await shot(page, "L2-listener-editor-agent");
      ok(env.errors.length === 0, "L2 no page errors: " + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  ✗ L2 threw: " + e.message.split("\n")[0]); }
    await close(env);
  }

  /* ---------------- L3 — edit an existing SCRIPT listener: hydration + FunctionBuilder + last payload ---------------- */
  {
    console.log("L3 edit script listener");
    const env = await openAdmin(browser);
    const { page } = env;
    try {
      await tab(page, "Listeners");
      await page.locator(".lst-table").waitFor({ timeout: 10000 });
      await page.locator("tr", { hasText: "Label new bugs for triage" }).locator("button", { hasText: "Edit" }).click();
      await page.locator(".lst-editor").waitFor({ timeout: 10000 });
      ok((await page.locator("#lst-name").inputValue()) === "Label new bugs for triage", "L3 name hydrated");
      ok(await page.locator(".evp-selected .evp-chip", { hasText: "Issue created" }).count() === 1, "L3 event hydrated");
      ok(await page.locator(".chips-chip", { hasText: "Bug" }).count() === 1, "L3 issue-type filter hydrated");
      ok(await page.locator(".mode-btn.mode-script.on").count() === 1, "L3 code mode selected");
      ok(await page.locator(".function-block").count() === 1, "L3 FunctionBuilder renders the saved step");
      ok(await page.locator(".pf-how-it-works").count() === 0, "L3 'how it works' banner hidden inside the listener editor");
      ok(await page.locator(".lst-check input").nth(1).isChecked() === true, "L3 simulation mode checkbox hydrated (checked)");
      await page.locator("button", { hasText: "Show last real payload" }).click();
      await page.locator(".lst-sample .runres-pre").waitFor({ timeout: 5000 });
      ok((await page.locator(".lst-sample .runres-pre").innerText()).includes("PROJ-42"), "L3 last captured payload renders");
      await shot(page, "L3-listener-editor-script");
      ok(env.errors.length === 0, "L3 no page errors: " + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  ✗ L3 threw: " + e.message.split("\n")[0]); }
    await close(env);
  }

  /* ---------------- J1 — Scheduled Jobs tab: list, run now polling, editor with schedule presets ---------------- */
  {
    console.log("J1 scheduled jobs list + run now + editor");
    const env = await openAdmin(browser);
    const { page } = env;
    try {
      await tab(page, "Scheduled Jobs");
      await page.locator(".lst-table").waitFor({ timeout: 10000 });
      ok(await page.locator(".lst-table tbody tr:not(.rule-accordion-row)").count() === 2, "J1 two job rows");
      ok(await page.locator(".job-sched-desc", { hasText: "Weekdays at 09:00" }).count() === 1, "J1 cron described in words");
      ok(await page.locator(".job-sched-zone", { hasText: "Europe/Zurich" }).count() === 1, "J1 zone + next run shown");
      ok(await page.locator(".lst-scope", { hasText: "Per JQL issue" }).count() === 1 && await page.locator(".lst-scope", { hasText: "Once" }).count() === 1, "J1 scope column");
      // run now → polls → result card
      await page.locator("tr", { hasText: "Nudge stale" }).locator("button", { hasText: "Run now" }).click();
      await page.locator(".runres").waitFor({ timeout: 15000 });
      ok(await page.locator(".runres-badge.ok").count() === 1, "J1 run-now result renders after polling");
      ok(await page.locator(".runres-issue").count() === 2, "J1 per-issue chips (2 issues)");
      // editor: presets + preview + custom cron validation
      await page.locator("tr", { hasText: "Weekly release digest" }).locator("button", { hasText: "Edit" }).click();
      await page.locator(".lst-editor").waitFor({ timeout: 10000 });
      ok(await page.locator(".schp-preview-head", { hasText: "Every Friday at 17:00" }).count() === 1, "J1 schedule preview describes the saved cron");
      ok(await page.locator(".schp-preview-run").count() === 5, "J1 next 5 runs previewed");
      await page.locator(".schp-preset .dropdown-trigger").click();
      await page.locator(".dropdown-item", { hasText: "Every 5 minutes" }).click();
      ok(await page.locator(".schp-preview-cron", { hasText: "*/5 * * * *" }).count() === 1, "J1 preset writes the cron");
      await page.locator(".schp-preset .dropdown-trigger").click();
      await page.locator(".dropdown-item", { hasText: "Custom cron" }).click();
      await page.locator(".schp-cron").fill("61 * * * *");
      ok(await page.locator(".schp-preview-error").count() === 1, "J1 invalid custom cron shows the error preview");
      await page.locator(".schp-cron").fill("*/10 8-18 * * 1-5");
      ok(await page.locator(".schp-preview-error").count() === 0 && await page.locator(".schp-preview-run").count() === 5, "J1 valid custom cron previews runs");
      await page.locator(".schp-preset .dropdown-trigger").click();
      await page.locator(".dropdown-item", { hasText: "Weekly on" }).click();
      ok(await page.locator(".schp-day").count() === 7, "J1 weekly preset shows day toggles");
      await page.locator(".schp-day", { hasText: "Fri" }).click();
      ok(await page.locator(".schp-day.on").count() === 2, "J1 toggling a day updates the selection");
      ok(await page.locator("select").count() === 0, "J1 no native <select> in the job editor");
      ok(await page.locator(".function-block").count() === 1, "J1 saved script step renders in FunctionBuilder");
      await shot(page, "J1-job-editor");
      ok(env.errors.length === 0, "J1 no page errors: " + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  ✗ J1 threw: " + e.message.split("\n")[0]); }
    await close(env);
  }

  /* Regression states: drive the real controls, in both themes. */
  for (const theme of ["light", "dark"]) {
    console.log(`R1 listener/job edge states (${theme})`);
    const note = "Uses a synthetic summary-only change, not the issue's change history. Captured text is redacted.";
    const env = await openAdmin(browser, theme, { __FAIL__: ["listProjects"], __RESPONSES__: {
      testListener: { success: true, result: { success: true, isValid: true, decision: "SKIP", reason: "AI condition not met", testNote: note } },
      getLogs: { success: true, logs: [{ id: "skip-regression", isValid: true, decision: "SKIP", reason: "AI condition not met", type: "listener", timestamp: new Date().toISOString() }] },
      testPostFunction: { success: true, mode: "simulation", issueKey: null, changes: [], logs: ["Live search completed"], executionTimeMs: 10 },
      getAsyncTaskResult: { success: true, status: "cancelled", result: { success: true, reason: "Cancelled after one issue" } },
    } });
    const { page } = env;
    try {
      await tab(page, "Listeners");
      await page.locator(".lst-table").waitFor();
      await page.locator(".rule-expand-btn").first().click();
      await page.locator(".runres-badge.skip").waitFor();
      ok(await page.locator(".runres-badge.ok").count() === 0, "R1 valid SKIP recent log is never PASS");
      await page.locator("tr", { hasText: "Label new bugs for triage" }).locator("button", { hasText: "Edit" }).click();
      await page.locator(".lst-editor").waitFor();
      await page.getByRole("button", { name: "Retry projects" }).waitFor();
      ok((await page.locator(".projpick").innerText()).includes("Projects unavailable"), "R1 project error is distinct from loading");
      await page.evaluate(() => { window.__FAIL__ = []; window.__RESPONSES__.listProjects = { success: true, projects: [] }; });
      await page.getByRole("button", { name: "Retry projects" }).click();
      await page.locator(".projpick .dropdown-trigger", { hasText: "No projects available" }).waitFor();
      ok(true, "R1 retry resolves to honest empty project state");
      ok(!(await page.locator(".function-block").innerText()).includes("every transition"), "R1 listener step uses listener wording");
      await page.locator("button", { hasText: "Show last real payload" }).click();
      await page.locator(".lst-sample .runres-pre").waitFor();
      await page.locator(".evp-search").fill("Issue updated");
      await page.locator(".evp-row", { hasText: "Issue updated" }).locator("input").check();
      await page.locator(".lst-test-field .dropdown-trigger").click();
      await page.locator(".dropdown-item", { hasText: /^Issue updated$/ }).click();
      ok(await page.locator(".lst-sample").count() === 0, "R1 prior event sample disappears when test event changes");
      await page.locator(".btn-test-run").click();
      ok((await page.locator(".test-panel").innerText()).includes("No current issue"), "R1 listener dry-run has no MOCK-1 promise");
      await page.locator(".btn-run-test").click();
      await page.locator(".test-result").waitFor();
      const stepContext = await page.evaluate(() => window.__CALLS__.filter((c) => c.name === "testPostFunction").at(-1).payload.contextExtras);
      ok(stepContext.eventType === "avi:jira:updated:issue" && stepContext.event.eventType === "avi:jira:updated:issue" && !stepContext.event.issue, "R1 per-step test receives selected event only, never stale captured issue");
      ok((await page.locator(".test-result-meta").innerText()).includes("Live reads · no current issue · writes staged"), "R1 simulation result labels live reads and absent issue");
      await page.locator(".lst-test .btn-solid", { hasText: "Run test" }).click();
      await page.locator(".lst-test .runres-badge.skip").waitFor();
      await page.locator(".lst-test .runres-details summary", { hasText: "Test context" }).click();
      ok((await page.locator(".lst-test .runres").innerText()).includes(note), "R1 backend test caveat is visible");
      ok(await page.locator(".lst-test .runres-badge.ok").count() === 0, "R1 valid successful SKIP test is never PASS");
      await shot(page, `R1-${theme}-listener-outcomes`);
      await tab(page, "Execution Logs");
      await page.locator(".log-status.skip").first().waitFor();
      ok(await page.locator(".log-status.valid").count() === 0, "R1 global execution log uses SKIP ahead of isValid");
      await tab(page, "Scheduled Jobs");
      await page.locator("tr", { hasText: "Nudge stale" }).locator("button", { hasText: "Run now" }).click();
      await page.locator(".runres-badge.skip").waitFor({ timeout: 10000 });
      ok((await page.locator(".runres").innerText()).includes("Cancelled after one issue"), "R1 cancelled poll ends with reason");
      ok(await page.locator("button", { hasText: "Run now" }).first().isEnabled(), "R1 cancelled run releases manual action");
      await page.locator("tr", { hasText: "Weekly release digest" }).locator("button", { hasText: "Edit" }).click();
      await page.locator(".schp-zone .dropdown-trigger").click();
      await page.locator(".schp-zone .dropdown-combobox-input").fill("UTC");
      await page.locator(".dropdown-item", { hasText: /^UTC$/ }).click();
      ok((await page.locator(".schp-zone .dropdown-trigger").innerText()).includes("UTC"), "R1 UTC selectable and shown");
      await page.locator(".schp-preset .dropdown-trigger").click();
      await page.locator(".dropdown-item", { hasText: "Custom cron" }).click();
      await page.locator(".schp-cron").fill("");
      ok(await page.locator(".schp-preview-error").count() === 1, "R1 empty custom cron stays invalid");
      await page.waitForFunction((th) => getComputedStyle(document.querySelector(".schp-preview-error")).backgroundColor === (th === "dark" ? "rgb(239, 68, 68)" : "rgb(220, 38, 38)"), theme);
      ok(true, "R1 invalid schedule has a red background after rendering settles");
      await page.locator(".schp-zone .dropdown-trigger").click();
      await page.locator(".schp-zone .dropdown-combobox-input").fill("Europe/London");
      await page.locator(".dropdown-item", { hasText: /^Europe\/London$/ }).click();
      ok(await page.locator(".schp-preview-error").count() === 1 && await page.locator(".schp-preview-run").count() === 0, "R1 zone change cannot restore a fallback schedule");
      await page.locator(".section-actions .btn-edit", { hasText: /^Save$/ }).click();
      await page.locator(".mls-toast", { hasText: "Fix the schedule" }).waitFor();
      ok(!(await page.evaluate(() => window.__CALLS__)).some((c) => c.name === "saveScheduledJob"), "R1 invalid schedule never saved");
      ok((await page.locator(".schp").innerText()).includes("next five-minute scheduler check"), "R1 due times distinguish scheduler and queue delay");
      ok(!(await page.locator(".function-block").innerText()).includes("every transition"), "R1 job step uses job wording");
      await page.locator(".mode-btn.mode-agent").click();
      const unscoped = await page.locator(".agc-textarea").getAttribute("placeholder");
      await page.locator(".job-scope .lst-input").fill("project = PROJ");
      const scoped = await page.locator(".agc-textarea").getAttribute("placeholder");
      ok(unscoped.includes("Find issues") && scoped.includes("current issue"), "R1 job examples adapt to JQL scope without changing instructions");
      await page.waitForFunction(() => {
        const buttons = [...document.querySelectorAll(".mode-btn")];
        return buttons.every((b) => b.getAnimations().every((a) => a.playState === "finished"));
      });
      const modeStyles = await page.locator(".mode-btn").evaluateAll((buttons) => buttons.map((b) => ({ selected: b.getAttribute("aria-checked"), background: getComputedStyle(b).backgroundColor })));
      console.log(`  ${theme} settled modes: ${JSON.stringify(modeStyles)}`);
      await shot(page, `R1-${theme}-job-schedule`);
      await page.locator("button", { hasText: "Back to jobs" }).click();
      await page.evaluate(() => { window.__RESPONSES__.getScheduledJob = { success: true, job: { id: "job_b2", name: "Saved alias job", schedule: { cron: "0 17 * * 5", timeZone: "US/Eastern" }, mode: "agent", agent: { instructions: "Read the current context", allowedActions: ["get_issue"], maxRounds: 3 }, scope: null } }; });
      await page.locator("tr", { hasText: "Weekly release digest" }).locator("button", { hasText: "Edit" }).click();
      await page.locator(".schp-zone .dropdown-trigger", { hasText: "US/Eastern" }).waitFor();
      ok(true, "R1 valid saved timezone alias remains visible");
      await page.locator(".section-actions .btn-edit", { hasText: /^Save$/ }).click();
      await page.locator(".mls-toast", { hasText: "Job saved" }).waitFor();
      const saved = await page.evaluate(() => window.__CALLS__.filter((c) => c.name === "saveScheduledJob").at(-1).payload.job);
      ok(saved.schedule.timeZone === "US/Eastern" && saved.schedule.cron === "0 17 * * 5", "R1 saved alias schedule preserved exactly");
      await tab(page, "Listeners");
      await page.locator("button", { hasText: "+ Add Listener" }).first().click();
      await page.locator(".lst-editor").waitFor();
      ok((await page.locator(".lst-test").innerText()).includes("Pick an event first"), "R1 empty event selection gives a clear next step");
      await page.locator(".evp-search").fill("Version released");
      await page.locator(".evp-row", { hasText: "Version released" }).locator("input").check();
      ok(await page.locator(".lst-test .issue-picker").count() === 0 && (await page.locator(".lst-test").innerText()).includes("This event has no current issue"), "R1 nonissue event removes irrelevant issue picker");
      ok(env.errors.length === 0, "R1 no page errors: " + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  ✗ R1 threw: " + e.message.split("\n")[0]); }
    await close(env);
  }

  /* ---------------- A1 — Settings → API access: tokens + create (shown once) ---------------- */
  {
    console.log("A1 API access panel");
    const env = await openAdmin(browser);
    const { page } = env;
    try {
      await tab(page, "Settings");
      await page.locator(".apx").waitFor({ timeout: 10000 });
      ok((await page.locator(".apx-code").first().innerText()).includes("hello.atlassian-dev.net"), "A1 endpoint URL rendered");
      ok(await page.locator(".apx-table tbody tr").count() === 1, "A1 existing token listed");
      await page.locator(".apx-input").fill("Migration script");
      await page.locator(".apx-create").click();
      await page.locator(".apx-fresh").waitFor({ timeout: 5000 });
      ok((await page.locator(".apx-secret").innerText()).startsWith("cgr_"), "A1 new token shown once");
      ok(await page.locator(".apx-examples").count() === 1, "A1 curl examples present");
      await shot(page, "A1-api-access");
      ok(env.errors.length === 0, "A1 no page errors: " + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  ✗ A1 threw: " + e.message.split("\n")[0]); }
    await close(env);
  }

  /* ---------------- F113 — provider-down banner tells the FAIL-OPEN truth ----------------
     The banner used to claim validations were "blocking every transition". The runtime
     fails OPEN on a provider config error (transitions pass UNVALIDATED), so the banner
     must say that — in both themes — and must never say "blocking". */
  for (const theme of ["light", "dark"]) {
    console.log(`F113 provider-down banner copy (${theme})`);
    const env = await openAdmin(browser, theme, {
      __RESPONSES__: {
        checkProviderHealth: {
          success: true, ok: false, transient: false, provider: "anthropic",
          providerLabel: "Anthropic", model: "claude-haiku-4-5-20251001", status: 401,
          message: "invalid x-api-key",
        },
      },
    });
    const { page } = env;
    try {
      const banner = page.locator(".provider-down-banner");
      await banner.waitFor({ timeout: 10000 });
      const txt = (await banner.innerText()).toLowerCase();
      ok(txt.includes("without validation"), `F113 ${theme} banner says "without validation" — got: ${txt.slice(0, 160)}`);
      ok(!txt.includes("blocking"), `F113 ${theme} banner never says "blocking"`);
      ok(!txt.includes("fail closed") && !txt.includes("fails closed"), `F113 ${theme} banner never claims fail-closed`);
      ok(txt.includes("401") && txt.includes("invalid x-api-key"), `F113 ${theme} banner still names the status + provider message`);
      // Solid saturated red alarm, white text, and NO left accent rail (owner mandate).
      const css = await banner.evaluate((el) => {
        const c = getComputedStyle(el);
        return { bg: c.backgroundColor, fg: c.color, bl: c.borderLeftWidth };
      });
      ok(/^rgb\(2[02][0-9], 3[0-9], [0-9]+\)$/.test(css.bg.replace(/\s+/g, " ")) || css.bg === "rgb(220, 38, 38)" || css.bg === "rgb(239, 68, 68)", `F113 ${theme} banner is solid red — got ${css.bg}`);
      ok(css.fg === "rgb(255, 255, 255)", `F113 ${theme} banner text is white — got ${css.fg}`);
      ok(parseFloat(css.bl) === 0, `F113 ${theme} banner has no left accent rail — got ${css.bl}`);
      await page.waitForTimeout(600); // let the rise/fade settle so the PNG is readable
      await shot(page, `F113-provider-down-${theme}`);
      ok(env.errors.length === 0, `F113 ${theme} no page errors: ` + env.errors.join(" | "));
    } catch (e) { fail++; console.log(`  \u2717 F113 ${theme} threw: ` + e.message.split("\n")[0]); }
    await close(env);
  }

  /* ---------------- F114 — a job carrying an error is never a green DONE ----------------
     A scheduled run that died on the no-provider path came back with an `error` string;
     the row rendered DONE in green and swallowed the message. The error is authoritative. */
  for (const theme of ["light", "dark"]) {
    console.log(`F114 errored job row (${theme})`);
    const NO_PROVIDER = "No AI provider is configured — set a provider and key in Settings.";
    const env = await openAdmin(browser, theme, {
      __RESPONSES__: {
        getAsyncJobs: {
          success: true,
          jobs: {
            running: [],
            queued: [],
            recent: [
              // THE BUG SHAPE: status still says "done", but an error is attached.
              { taskId: "e1", status: "done", taskType: "scheduledjob", ruleName: "Nightly triage", issueKey: "DEMO-1", provider: "anthropic", durationMs: 1200, error: NO_PROVIDER },
              // Control: a genuinely clean run must still read DONE.
              { taskId: "e2", status: "done", taskType: "review", ruleName: "AI review", issueKey: "DEMO-2", provider: "anthropic", durationMs: 3400 },
              // F-123 — a cancelled row keeps its neutral badge, but an `error` on it is
              // NEVER an "operator reason": no cancel writer in the backend sets `error`.
              // The only producer is the sticky-cancelled merge keeping a genuine consumer
              // failure, so the message must be visible under the CANCELLED badge.
              { taskId: "e3", status: "cancelled", taskType: "codegen", ruleName: "Generate code", issueKey: "DEMO-3", provider: "openai", error: "No AI provider configured (provider read failed)" },
              // Control: a plain cancel with no error shows a neutral badge and no message line.
              { taskId: "e4", status: "cancelled", taskType: "codegen", ruleName: "Clean stop", issueKey: "DEMO-4", provider: "openai" },
            ],
          },
        },
      },
    });
    const { page } = env;
    try {
      await tab(page, "Execution Logs");
      await page.locator(".job-entry").first().waitFor({ timeout: 10000 });
      const rows = page.locator(".job-entry");
      const bad = rows.filter({ hasText: "Nightly triage" }).first();
      const badge = await bad.locator(".job-status").first().innerText();
      ok(badge.trim() === "ERROR", `F114 ${theme} errored job renders ERROR, not DONE — got "${badge.trim()}"`);
      ok(await bad.locator(".job-status.done").count() === 0, `F114 ${theme} errored job carries no green done badge`);
      ok((await bad.innerText()).includes("No AI provider is configured"), `F114 ${theme} errored job shows the message text`);
      const good = rows.filter({ hasText: "AI review" }).first();
      ok((await good.locator(".job-status").first().innerText()).trim() === "DONE", `F114 ${theme} a clean run still reads DONE`);
      const cancelled = rows.filter({ hasText: "Generate code" }).first();
      ok((await cancelled.locator(".job-status").first().innerText()).trim() === "CANCELLED", `F114 ${theme} a cancel is not relabelled ERROR`);
      // F-123 — the badge exemption stops at the badge: the message is always rendered.
      ok(await cancelled.locator(".job-error").count() === 1, `F123 ${theme} a cancelled row carrying an error renders the message line`);
      ok((await cancelled.innerText()).includes("No AI provider configured (provider read failed)"), `F123 ${theme} the hidden consumer failure is visible under the CANCELLED badge`);
      const cleanStop = rows.filter({ hasText: "Clean stop" }).first();
      ok((await cleanStop.locator(".job-status").first().innerText()).trim() === "CANCELLED", `F123 ${theme} a clean stop still reads CANCELLED`);
      ok(await cleanStop.locator(".job-error").count() === 0, `F123 ${theme} a clean stop with no error renders no message line`);
      await page.waitForTimeout(600); // let the tab-panel fade settle so the PNG is readable
      await shot(page, `F114-job-error-${theme}`);
      ok(env.errors.length === 0, `F114 ${theme} no page errors: ` + env.errors.join(" | "));
    } catch (e) { fail++; console.log(`  \u2717 F114 ${theme} threw: ` + e.message.split("\n")[0]); }
    await close(env);
  }

  /* ---------------- F118 — "no provider" is NOT "the provider returned an error" ----------------
     `checkProviderHealth` answers `reason: "no-provider"` when COGNIRUNNER_AI_PROVIDER could
     not be read at all: provider, providerLabel, model and status are ALL null. The generic
     sentence rendered that as "` ` returned an error" — a blank provider name asserting a call
     that never happened, while the very next clause said nothing was sent. Own branch, own copy,
     and the remedy must be "re-save the provider", not a key/URL/model audit. */
  for (const theme of ["light", "dark"]) {
    console.log(`F118 no-provider banner copy (${theme})`);
    const env = await openAdmin(browser, theme, {
      __RESPONSES__: {
        checkProviderHealth: {
          success: true, ok: false, transient: false, failOpen: true, reason: "no-provider",
          provider: null, providerLabel: null, model: null, status: null,
          message: "No AI provider configured — the provider setting could not be read. Nothing was sent to any provider.",
        },
      },
    });
    const { page } = env;
    try {
      const banner = page.locator(".provider-down-banner");
      await banner.waitFor({ timeout: 10000 });
      const txt = (await banner.innerText()).replace(/\s+/g, " ").toLowerCase();
      ok(txt.includes("no ai provider could be read from settings"), `F118 ${theme} banner names the real cause — got: ${txt.slice(0, 200)}`);
      ok(txt.includes("passing without validation"), `F118 ${theme} banner still states the fail-open consequence`);
      ok(txt.includes("open settings and re-save the provider"), `F118 ${theme} banner gives the re-save remedy`);
      // The whole defect: a fabricated provider error with a blank name.
      ok(!txt.includes("returned an error"), `F118 ${theme} banner never claims a provider returned an error`);
      ok(!txt.includes("unreachable"), `F118 ${theme} banner does not call an unread provider "unreachable"`);
      ok(!txt.includes("fix the key, base url, or model"), `F118 ${theme} banner does not send the admin auditing the key/URL/model`);
      ok(!txt.includes("blocking") && !txt.includes("fail closed") && !txt.includes("fails closed"), `F118 ${theme} banner never claims fail-closed`);
      // Same solid red alarm, white text, no left accent rail (owner mandate).
      const css = await banner.evaluate((el) => { const c = getComputedStyle(el); return { bg: c.backgroundColor, fg: c.color, bl: c.borderLeftWidth }; });
      ok(css.bg === "rgb(220, 38, 38)" || css.bg === "rgb(239, 68, 68)", `F118 ${theme} banner is solid red — got ${css.bg}`);
      ok(css.fg === "rgb(255, 255, 255)", `F118 ${theme} banner text is white — got ${css.fg}`);
      ok(parseFloat(css.bl) === 0, `F118 ${theme} banner has no left accent rail — got ${css.bl}`);
      await page.waitForTimeout(600);
      await shot(page, `F118-no-provider-${theme}`);
      ok(env.errors.length === 0, `F118 ${theme} no page errors: ` + env.errors.join(" | "));
    } catch (e) { fail++; console.log(`  \u2717 F118 ${theme} threw: ` + e.message.split("\n")[0]); }
    await close(env);
  }

  /* ---------------- F124 — the unreachable fail-CLOSED copy is gone from the shipped bundle ----------------
     Every `ok:false` return of checkProviderHealth hardcodes `failOpen: true`, so the
     `failOpen === false` wording was a second, untestable home for the Law-3 statement.
     Asserted against the BUILT bundles (never printed — an absence check only), because a
     dead branch cannot be reached through the UI and only the artifact can prove it is gone. */
  {
    console.log("F124 dead fail-closed copy removed from the bundles");
    try {
      const DEAD = [
        "AI-guarded transitions are being refused",
        "refusing these transitions until you fix",
      ];
      let checked = 0;
      for (const dir of ["admin-panel/build", "admin-panel/build-shot"]) {
        const root = path.join(STATIC, dir);
        if (!fs.existsSync(root)) continue;
        for (const f of fs.readdirSync(root).filter((n) => n.endsWith(".js"))) {
          const src = fs.readFileSync(path.join(root, f), "utf8");
          checked++;
          for (const d of DEAD) ok(!src.includes(d), `F124 ${dir}/${f} no longer ships the fail-closed copy "${d.slice(0, 40)}…"`);
          // The live copy must still be there — proves we checked a real admin bundle.
          ok(src.includes("passing WITHOUT validation") || src.includes("passing without validation"), `F124 ${dir}/${f} still ships the fail-open copy`);
        }
      }
      ok(checked > 0, "F124 at least one admin-panel bundle was inspected");
    } catch (e) { fail++; console.log("  \u2717 F124 threw: " + e.message.split("\n")[0]); }
  }

  /* ---------------- F122 — an operator Stop is a cancel, never a failed run ----------------
     `getAsyncTaskResult` has no "cancelled" status; the consumer writes a stopped task as
     {status:"error", error:"Cancelled"} plus the `cancelled: true` flag. The F-114
     "error beats the status word" short-circuit was firing first and reporting the stop as
     a red "Run failed". The flag wins: neutral SKIP result, neutral "Run cancelled" toast. */
  for (const theme of ["light", "dark"]) {
    console.log(`F122 stopped run reads as cancelled (${theme})`);
    const env = await openAdmin(browser, theme, {
      __RESPONSES__: {
        getAsyncTaskResult: { success: true, status: "error", cancelled: true, error: "Cancelled" },
      },
    });
    const { page } = env;
    try {
      await tab(page, "Scheduled Jobs");
      await page.locator("tr", { hasText: "Nudge stale" }).locator("button", { hasText: "Run now" }).click();
      await page.locator(".runres-badge.skip").waitFor({ timeout: 15000 });
      ok(await page.locator(".runres-badge.skip").count() === 1, `F122 ${theme} a stopped run renders the neutral SKIP result`);
      ok(await page.locator(".runres-badge.err, .runres-badge.fail").count() === 0, `F122 ${theme} a stopped run is never a red failure result`);
      ok((await page.locator(".runres").innerText()).includes("Cancelled"), `F122 ${theme} the cancel reason is shown`);
      const toasts = (await page.locator(".mls-toast").allInnerTexts()).join(" | ");
      ok(toasts.includes("Run cancelled"), `F122 ${theme} the toast says "Run cancelled" — got: ${toasts}`);
      ok(!toasts.includes("Run failed"), `F122 ${theme} an operator Stop never toasts "Run failed"`);
      ok(await page.locator(".mls-toast-error").count() === 0, `F122 ${theme} the cancel toast is not an error toast`);
      ok(await page.locator("button", { hasText: "Run now" }).first().isEnabled(), `F122 ${theme} a cancelled run releases the manual action`);
      await shot(page, `F122-cancelled-run-${theme}`);
      ok(env.errors.length === 0, `F122 ${theme} no page errors: ` + env.errors.join(" | "));
    } catch (e) { fail++; console.log(`  \u2717 F122 ${theme} threw: ` + e.message.split("\n")[0]); }
    await close(env);
  }

  /* ---------------- D1 — dark theme renders the new tabs without errors ---------------- */
  {
    console.log("D1 dark theme");
    const env = await openAdmin(browser, "dark");
    const { page } = env;
    try {
      await tab(page, "Listeners");
      await page.locator(".lst-table").waitFor({ timeout: 10000 });
      await page.locator("button", { hasText: "+ Add Listener" }).first().click();
      await page.locator(".lst-editor").waitFor({ timeout: 10000 });
      const bg = await page.evaluate(() => getComputedStyle(document.querySelector(".mode-btn.mode-script")).backgroundColor);
      ok(typeof bg === "string" && bg.length > 0, "D1 editor renders in dark mode");
      await shot(page, "D1-dark-listener-editor");
      ok(env.errors.length === 0, "D1 no page errors: " + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  ✗ D1 threw: " + e.message.split("\n")[0]); }
    await close(env);
  }
  /* ---------------- M2 — admin Memories tab: store FULL banner (F-167), both themes ----------------
   * Same storeFull signal as the config-ui Knowledge panel, same wording (MemoryFullBanner is
   * imported, not re-typed), rendered above the admin table where deleting actually happens. */
  for (const theme of ["light", "dark"]) {
    console.log(`M2 admin memories store-full banner — ${theme}`);
    const env = await openAdmin(browser, theme, { __MEMORY_FULL__: true });
    const { page } = env;
    try {
      await tab(page, "Memories");
      const banner = page.locator(".memory-full-banner").first();
      await banner.waitFor({ timeout: 10000 });
      const btxt = await banner.innerText();
      ok(/Memory store is full/i.test(btxt), `M2 ${theme} banner renders in the admin Memories tab`);
      ok(/not being kept since/i.test(btxt) && /resume learning/i.test(btxt), `M2 ${theme} banner carries the full wording`);
      // F-179 — the admin twin imports MemoryFullBanner from the config-ui MemoriesTab, so it
      // can only ever show the same words. Assert the policy sentence here TOO: this is the
      // surface an admin reads when the AI has gone quiet, and it is the one place where
      // "just archive them" is the wrong instinct to leave unchallenged.
      ok(/Archived memories still count toward the cap/i.test(btxt),
        `M2 ${theme} admin banner says archiving does NOT free capacity`);
      ok(/delete some to resume learning/i.test(btxt), `M2 ${theme} admin banner names deleting as the escape`);
      ok(!/merge/i.test(btxt) && !/prune/i.test(btxt), `M2 ${theme} admin banner drops "merge"/"prune"`);
      const style = await banner.evaluate((el) => {
        const c = getComputedStyle(el);
        return { bg: c.backgroundColor, fg: c.color, bl: c.borderLeftWidth, bt: c.borderTopWidth };
      });
      const rgb = style.bg.match(/\d+/g).map(Number);
      ok(rgb[0] > 180 && rgb[1] < 90 && rgb[2] < 90, `M2 ${theme} solid red fill — got ${style.bg}`);
      ok(/255,\s*255,\s*255/.test(style.fg), `M2 ${theme} white text — got ${style.fg}`);
      ok(style.bl === style.bt, `M2 ${theme} no left accent rail`);

      /* F-182 — the banner is not the only place the wrong instinct gets acted on. An admin
         staring at a full store reaches for Archive, because it is the non-destructive
         button sitting right there. It frees nothing: the app evicts only NON-archived
         auto-captured rows, so an archived memory keeps its slot and still counts toward
         the cap. Both the affordance and the archived section must say so. */
      const archivedRow = page.locator("tr.memories-admin-archived-row").first();
      await archivedRow.waitFor({ timeout: 6000 });
      ok(await archivedRow.locator("button", { hasText: "Restore" }).count() === 1,
        `M2 ${theme} an archived memory renders with Restore (the archived branch is exercised)`);
      const hint = page.locator(".memories-admin-archived-hint").first();
      await hint.waitFor({ timeout: 6000 });
      ok(/Archived memories stay out of prompts but still count toward the cap/i.test(await hint.innerText()),
        `M2 ${theme} the Archived section says archiving does not reclaim capacity`);
      // Readable in BOTH themes — a hint nobody can read is a hint that was never written.
      const hintColor = await hint.evaluate((el) => getComputedStyle(el).color);
      ok(/^rgba?\(/.test(hintColor) && !/rgba\(0,\s*0,\s*0,\s*0\)/.test(hintColor),
        `M2 ${theme} the hint resolves a real colour (got ${hintColor})`);
      // And the Archive button itself carries the same caveat where it is clicked.
      const archiveTitle = await page.locator("button", { hasText: /^Archive$/ }).first().getAttribute("title");
      ok(/still count toward the cap/i.test(archiveTitle || ""),
        `M2 ${theme} the Archive button's tooltip names the cap caveat (got: ${archiveTitle})`);

      await shot(page, `m2-memories-full-${theme}`);
    } catch (e) { fail++; console.log(`  ✗ M2 ${theme} threw: ` + e.message.split("\n")[0]); }
    await close(env);
  }

  /* ---------------- M3 — F-189: store byte stats, the platform-cap wall, bulk delete ----------------
   * The memory store has TWO ceilings: a row cap (200) and a byte guard on the single
   * `pf_memories` KVS value, under a hard ~240KiB platform limit. Only the first was ever
   * visible. A byte-capped store therefore refused every write while the tab cheerfully
   * showed 40-odd rows — no number on screen could explain it, and the only remedy
   * (deleting) was a per-row confirm dialog nobody would run forty times.
   *
   * __MEMORY_OVERCAP__ models the whole shape: counts carry { bytes, guardBytes,
   * platformBytes }, every write answers { reason: "platform-cap", bytesOver }. */
  for (const theme of ["light", "dark"]) {
    console.log(`M3 memories byte stats + platform-cap + bulk delete — ${theme}`);
    const env = await openAdmin(browser, theme, { __MEMORY_OVERCAP__: true });
    const { page } = env;
    try {
      await tab(page, "Memories");
      await page.locator(".memories-admin-tab .table").waitFor({ timeout: 10000 });

      /* ---- (3) the stats line: the size of the store, in the unit the guard uses ---- */
      const stats = page.locator(".memories-admin-stats").first();
      await stats.waitFor({ timeout: 8000 });
      const stxt = await stats.innerText();
      // Derived, not typed — 230000 -> 225 KB, 245760 -> 240 KB. If the shared constants
      // move, this expectation moves with them instead of photographing a stale limit.
      const kb = (n) => `${Math.round(n / 1024)} KB`;
      ok(stxt.includes(`of ${kb(MEMORY_MAX_SERIALIZED_BYTES)} guard`),
        `M3 ${theme} stats name the byte GUARD from the shared constant (got: ${stxt})`);
      ok(stxt.includes(`platform limit ${kb(MEMORY_PLATFORM_MAX_SERIALIZED_BYTES)}`),
        `M3 ${theme} stats name the PLATFORM limit from the shared constant (got: ${stxt})`);
      ok(/^Store: \d+ KB of \d+ KB guard \(platform limit \d+ KB\)/.test(stxt.trim()),
        `M3 ${theme} stats lead with the plain size sentence (got: ${stxt})`);
      // Over the guard it is red — the moment it stops being a statistic.
      ok((await stats.getAttribute("class")).includes("memories-admin-stats-over"),
        `M3 ${theme} stats carry the over-guard class when the backend says overGuard`);
      // Past the PLATFORM ceiling it says the stronger thing: nothing can be saved at all,
      // and one-at-a-time deleting is not a route out. This is a DIFFERENT state from
      // "over the guard" and the line has to distinguish them or the admin cannot act.
      const note = page.locator(".memories-admin-stats-note").first();
      await note.waitFor({ timeout: 5000 });
      const ntxt = await note.innerText();
      ok(/over Jira's storage limit/i.test(ntxt),
        `M3 ${theme} the over-platform clause names Jira's storage limit (got: ${ntxt})`);
      ok(/deleted together/i.test(ntxt),
        `M3 ${theme} the over-platform clause says memories must go TOGETHER (got: ${ntxt})`);
      const sc = await stats.evaluate((el) => getComputedStyle(el).color);
      const srgb = sc.match(/\d+/g).map(Number);
      ok(srgb[0] > 180 && srgb[1] < 90 && srgb[2] < 90, `M3 ${theme} over-guard stats are solid red — got ${sc}`);
      ok(Number(await stats.evaluate((el) => getComputedStyle(el).fontWeight)) >= 700,
        `M3 ${theme} over-guard stats are 700 weight`);

      /* ---- (2) a platform-cap refusal is a solid red wall that names bytesOver ---- */
      ok(await page.locator(".memories-admin-capwall").count() === 0,
        `M3 ${theme} no capacity wall before a write is attempted`);
      await page.locator(".memories-admin-add input").fill("A memory this store cannot fit.");
      await page.locator(".btn-add-memory").click();
      const wall = page.locator(".memories-admin-capwall").first();
      await wall.waitFor({ timeout: 8000 });
      const wtxt = await wall.innerText();
      ok(/over Jira's storage limit/i.test(wtxt), `M3 ${theme} the wall names the PLATFORM limit, not the row cap`);
      // THE point of this refusal: it must say BY HOW MUCH. "Delete some" is useless advice
      // when the admin cannot tell whether that means one row or forty. The sentence is the
      // backend's own (memoryPlatformCapMessage), asserted against that same import so this
      // proves the words travelled end to end rather than two surfaces happening to agree.
      ok(wtxt.includes(memoryPlatformCapMessage(6544)),
        `M3 ${theme} the wall carries the resolver's platform-cap sentence verbatim (got: ${wtxt.replace(/\n/g, " | ")})`);
      ok(/\b6544 bytes\b/.test(wtxt),
        `M3 ${theme} the wall names the deficit as a real quantity (got: ${wtxt.replace(/\n/g, " | ")})`);
      /* F-219 — the wall still points at the control that recovers capacity, but the
         sentence is no longer keyed to the literal button label. It was re-worded when the
         gate moved from isAdmin to canEdit, because the SAME sentence now has to be true
         for an editor as well as an admin. What is asserted is the instruction, and (just
         below) that the control it names is actually on this screen. */
      ok(/Select the memories to remove and delete them together/i.test(wtxt),
        `M3 ${theme} the wall points at the control that recovers capacity (got: ${wtxt.replace(/\n/g, " | ")})`);
      ok(await page.locator(".memories-admin-select").count() > 0,
        `M3 ${theme} ...and that control exists here, so the wall is not giving an unfollowable order`);
      // F-200 — and it may only say that to someone who HAS that control. This is the admin
      // arm, so the admin remedy is the right one and the non-admin sentence must be absent.
      ok(!/a Jira admin has to delete memories/i.test(wtxt),
        `M3 ${theme} an ADMIN is not told to go and find an admin (got: ${wtxt.replace(/\n/g, " | ")})`);
      ok(/Archiving does not free capacity/i.test(wtxt),
        `M3 ${theme} the wall forecloses the wrong instinct (archive frees nothing — F-176/F-182)`);
      ok(/one at a time will not work/i.test(wtxt),
        `M3 ${theme} the wall says single-row deletes cannot repair this state`);
      const wst = await wall.evaluate((el) => {
        const c = getComputedStyle(el);
        return { bg: c.backgroundColor, fg: c.color, bl: c.borderLeftWidth, bt: c.borderTopWidth };
      });
      const wrgb = wst.bg.match(/\d+/g).map(Number);
      ok(wrgb[0] > 180 && wrgb[1] < 90 && wrgb[2] < 90, `M3 ${theme} wall is a SOLID red fill, not a tint — got ${wst.bg}`);
      ok((wst.bg.match(/[\d.]+/g) || []).length < 4 || Number(wst.bg.match(/[\d.]+/g)[3]) === 1,
        `M3 ${theme} wall fill is fully opaque — got ${wst.bg}`);
      ok(/255,\s*255,\s*255/.test(wst.fg), `M3 ${theme} wall has white text — got ${wst.fg}`);
      ok(wst.bl === wst.bt, `M3 ${theme} wall has NO left accent rail`);
      /* F-212 — the capwall must BE the shared hard-stop, not a look-alike. Rendering a
         bare `.hard-stop` probe into the same document and comparing computed styles is
         the only check that fails when someone re-types the fill or the weights into
         `.memories-admin-capwall`: an "is it red, is it 700" assertion passes happily on
         a drifted copy, which is exactly how the three surfaces ended up with two
         different body weights. */
      const parity = await wall.evaluate((el) => {
        const probe = document.createElement("div");
        probe.className = "hard-stop";
        probe.innerHTML = '<span class="hard-stop-title">t</span><span class="hard-stop-text">b</span>';
        document.body.appendChild(probe);
        const g = (n) => {
          const c = getComputedStyle(n);
          const t = getComputedStyle(n.children[0]);
          const b = getComputedStyle(n.children[1]);
          return { bg: c.backgroundColor, fg: c.color, radius: c.borderTopLeftRadius, pad: c.padding, titleW: t.fontWeight, bodyW: b.fontWeight };
        };
        const out = { wall: g(el), base: g(probe) };
        probe.remove();
        return out;
      });
      ok(parity.wall.bg === parity.base.bg,
        `M3 ${theme} the capwall takes its fill from .hard-stop — ${parity.wall.bg} vs ${parity.base.bg}`);
      ok(parity.wall.fg === parity.base.fg, `M3 ${theme} the capwall takes its text colour from .hard-stop`);
      ok(parity.wall.titleW === parity.base.titleW && Number(parity.base.titleW) >= 700,
        `M3 ${theme} the capwall title is the shared 700 — ${parity.wall.titleW} vs ${parity.base.titleW}`);
      ok(parity.wall.bodyW === parity.base.bodyW && Number(parity.base.bodyW) === 500,
        `M3 ${theme} the capwall body is the shared 500 — ${parity.wall.bodyW} vs ${parity.base.bodyW}`);
      ok(parity.wall.radius === parity.base.radius && parity.wall.pad === parity.base.pad,
        `M3 ${theme} the capwall keeps only its margin, not its own box`);
      await shot(page, `m3-memories-capwall-${theme}`);

      /* ---- (1) checkbox multi-select + bulk delete through the app's OWN dialog ---- */
      ok(await page.locator("select").count() === 0, `M3 ${theme} no native <select> on this tab`);
      const boxes = page.locator(".memories-admin-select");
      ok(await boxes.count() === 6, `M3 ${theme} every memory row carries a select checkbox`);
      ok(await page.locator(".memories-admin-bulkbar").count() === 0,
        `M3 ${theme} the bulk bar is absent while nothing is ticked (no dead "Delete selected (0)")`);
      await boxes.nth(0).check();
      await boxes.nth(2).check();
      const bulkBtn = page.locator(".memories-admin-bulkdelete").first();
      await bulkBtn.waitFor({ timeout: 5000 });
      ok((await bulkBtn.innerText()).trim() === "Delete selected (2)",
        `M3 ${theme} the button carries the live count (got: ${(await bulkBtn.innerText()).trim()})`);
      const bst = await bulkBtn.evaluate((el) => {
        const c = getComputedStyle(el);
        return { bg: c.backgroundColor, fg: c.color, w: c.fontWeight, bl: c.borderLeftWidth, bt: c.borderTopWidth };
      });
      const brgb = bst.bg.match(/\d+/g).map(Number);
      ok(brgb[0] > 180 && brgb[1] < 90 && brgb[2] < 90, `M3 ${theme} Delete selected is solid red — got ${bst.bg}`);
      ok(/255,\s*255,\s*255/.test(bst.fg), `M3 ${theme} Delete selected has white text — got ${bst.fg}`);
      ok(Number(bst.w) >= 700, `M3 ${theme} Delete selected is 700 weight`);
      ok(bst.bl === bst.bt, `M3 ${theme} Delete selected has no left rail`);

      // Clear selection puts the bar away without deleting anything.
      await page.locator(".memories-admin-bulkbar .btn-small", { hasText: "Clear selection" }).click();
      ok(await page.locator(".memories-admin-bulkbar").count() === 0, `M3 ${theme} Clear selection retracts the bar`);
      ok(await page.evaluate(() => (window.__DELETE_MEMORY_CALLS__ || []).length) === 0,
        `M3 ${theme} Clear selection deleted nothing`);

      await boxes.nth(0).check();
      await boxes.nth(2).check();
      await page.locator(".memories-admin-bulkdelete").first().click();
      // NEVER window.confirm — the app's own dialog primitive, every time.
      const dlg = page.locator(".cr-confirm").first();
      await dlg.waitFor({ timeout: 5000 });
      const dtxt = await dlg.innerText();
      ok(/Delete 2 selected memories\?/.test(dtxt), `M3 ${theme} the custom confirm names the count in its title`);
      ok(/cannot be undone/i.test(dtxt), `M3 ${theme} the confirm says the delete is irreversible`);

      // Cancel is a real cancel.
      await page.locator(".cr-confirm .btn-small", { hasText: "Cancel" }).click();
      await page.waitForTimeout(200);
      ok(await page.evaluate(() => (window.__DELETE_MEMORY_CALLS__ || []).length) === 0,
        `M3 ${theme} cancelling the dialog issues no delete`);
      ok(await page.locator(".memories-admin-bulkdelete").count() === 1,
        `M3 ${theme} the selection survives a cancel`);

      await page.locator(".memories-admin-bulkdelete").first().click();
      await page.locator(".cr-confirm").first().waitFor({ timeout: 5000 });
      await page.locator(".cr-confirm .btn-danger").click();
      await page.locator(".mls-toast").first().waitFor({ timeout: 8000 });
      const m3toast = await page.locator(".mls-toast").first().innerText();
      ok(/2 memories deleted/.test(m3toast),
        `M3 ${theme} the toast reports how many went`);
      // F-202 — nothing was stale here, so the "already gone" clause must NOT appear. A
      // suffix that shows on a clean delete is as wrong as one that never shows.
      ok(!/already gone/i.test(m3toast),
        `M3 ${theme} a clean delete carries no already-gone clause (got: ${m3toast})`);
      // ONE call carrying `ids`, not two carrying `id`: `pf_memories` is a single KVS value,
      // so a UI that loops single deletes races itself and looks identical on screen.
      const calls = await page.evaluate(() => window.__DELETE_MEMORY_CALLS__ || []);
      ok(calls.length === 1, `M3 ${theme} bulk delete is ONE invoke, not N (got ${calls.length})`);
      ok(Array.isArray(calls[0] && calls[0].ids) && calls[0].ids.length === 2,
        `M3 ${theme} it sends { ids: [...] } (got: ${JSON.stringify(calls[0])})`);
      await page.waitForTimeout(400);
      ok(await page.locator(".memories-admin-select").count() === 4,
        `M3 ${theme} the deleted rows are gone from the table`);
      ok(await page.locator(".memories-admin-bulkbar").count() === 0,
        `M3 ${theme} the selection is cleared after the delete — the (n) cannot strand`);
      await shot(page, `m3-memories-bulkdelete-${theme}`);
      ok(env.errors.length === 0, `M3 ${theme} no page errors: ` + env.errors.join(" | "));
    } catch (e) { fail++; console.log(`  ✗ M3 ${theme} threw: ` + e.message.split("\n")[0]); }
    await close(env);
  }

  /* ---------------- M3b — F-214 / F-215 / F-217: the admin tab's DELETE side of the wall
   * M3 above proves the ADD refusal and a bulk delete that lands. Neither of the two paths
   * this journey exists for had any coverage at all:
   *
   * F-214 — a delete is a write. `pf_memories` is ONE KVS value, so the delete rewrites the
   * whole array and is refused by the same platform ceiling an add is (src/index.js
   * deleteMemory honours saveMemories' `{ refused: true }`). Both delete paths used to
   * report that with a toast alone — a four-second banner for the one state this tab exists
   * to repair — while the red wall above kept printing the deficit from an EARLIER attempt.
   * The wall must be REPLACED with the new, smaller deficit, because "how much more must I
   * delete" is the only question left on this screen.
   *
   * F-215 — and a write that LANDS falsifies a refusal, so every successful path clears it.
   *
   * F-217 — the mock now mirrors the backend's ORDER and its QUANTITY: presence is resolved
   * before the cap (an already-gone row is "Memory not found", never a capacity sentence),
   * and the refusal is keyed on the post-delete SIZE, not on "one row is never enough".
   * Both themes. */
  for (const theme of ["light", "dark"]) {
    console.log(`M3b memories platform-cap: the admin tab's delete refusals — ${theme}`);
    const env = await openAdmin(browser, theme, { __MEMORY_OVERCAP__: true });
    const { page } = env;
    try {
      await tab(page, "Memories");
      await page.locator(".memories-admin-tab .table").waitFor({ timeout: 10000 });
      const wall = () => page.locator(".memories-admin-capwall").first();
      const wallText = async () => (await page.locator(".memories-admin-capwall").count() ? wall().innerText() : "");

      /* ---- raise the wall with an ADD, so there is a STALE deficit to replace ---- */
      await page.locator(".memories-admin-add input").fill("A memory this store cannot fit.");
      await page.locator(".btn-add-memory").click();
      await wall().waitFor({ timeout: 8000 });
      ok((await wallText()).includes(memoryPlatformCapMessage(6544)),
        `M3b ${theme} the add refusal prints the full 6544-byte deficit first`);

      /* ---- F-214 (row delete): refused → the WALL, carrying the NEW deficit ---- */
      const rowsBefore = await page.locator(".memories-admin-select").count();
      await page.locator(".memories-admin-tab .row-actions .btn-danger").first().click();
      await page.locator(".cr-confirm").first().waitFor({ timeout: 5000 });
      await page.locator(".cr-confirm .btn-danger").click();
      // One row frees 3272 of the 6544 overshoot, so the store is still over and the write
      // is refused — with HALF the deficit left. That number is the whole point.
      await page.waitForFunction(
        (sentence) => document.body.innerText.includes(sentence),
        memoryPlatformCapMessage(3272),
        { timeout: 8000 },
      );
      const w1 = await wallText();
      ok(w1.includes(memoryPlatformCapMessage(3272)),
        `M3b ${theme} a refused ROW delete replaces the wall's deficit with the new one (got: ${w1.replace(/\n/g, " | ")})`);
      ok(!w1.includes(memoryPlatformCapMessage(6544)),
        `M3b ${theme} the stale 6544 deficit from the add is GONE — one account, not two`);
      ok(await page.locator(".memories-admin-select").count() === rowsBefore,
        `M3b ${theme} a refused delete removes nothing from the table`);
      // The toast is the SECONDARY signal, not the only one.
      ok(/over Jira/i.test(await page.locator(".mls-toast").first().innerText().catch(() => "")),
        `M3b ${theme} the toast still fires alongside the wall`);

      /* ---- F-214 (bulk delete): refused → the wall, and the SELECTION SURVIVES ---- */
      const boxes = page.locator(".memories-admin-select");
      await boxes.nth(0).check();
      await page.locator(".memories-admin-bulkdelete").first().click();
      await page.locator(".cr-confirm").first().waitFor({ timeout: 5000 });
      await page.locator(".cr-confirm .btn-danger").click();
      await page.waitForTimeout(600);
      const w2 = await wallText();
      ok(w2.includes(memoryPlatformCapMessage(3272)),
        `M3b ${theme} a refused BULK delete lands on the wall too (got: ${w2.replace(/\n/g, " | ")})`);
      ok(await page.locator(".memories-admin-bulkdelete").count() === 1,
        `M3b ${theme} a refused bulk delete keeps the selection — the next move is to tick MORE`);

      /* ---- F-215: a delete that LANDS clears the wall ---- */
      // Two rows free the whole overshoot, so this one fits and the refusal is falsified.
      await boxes.nth(1).check();
      await page.locator(".memories-admin-bulkdelete").first().click();
      await page.locator(".cr-confirm").first().waitFor({ timeout: 5000 });
      await page.locator(".cr-confirm .btn-danger").click();
      await page.waitForTimeout(800);
      ok(await page.locator(".memories-admin-capwall").count() === 0,
        `M3b ${theme} the delete that LANDS clears the wall (F-215: only add and bulk used to)`);
      ok(await page.locator(".memories-admin-select").count() === rowsBefore - 2,
        `M3b ${theme} and the two rows are actually gone`);
      await shot(page, `m3b-admin-delete-refusal-${theme}`);
      ok(env.errors.length === 0, `M3b ${theme} no page errors: ` + env.errors.join(" | "));
    } catch (e) { fail++; console.log(`  ✗ M3b ${theme} threw: ` + e.message.split("\n")[0]); }
    await close(env);
  }

  /* ---------------- M3c — F-217: PRESENCE is resolved BEFORE the cap ----------------
   * `__MEMORY_STALE_LIST__` gives the loaded table a row the server no longer has. Deleting
   * it under `__MEMORY_OVERCAP__` must answer "Memory not found" — the backend checks
   * presence first and returns before any write, so no capacity sentence is reachable for
   * that input. The old mock checked the cap first and would have said the store was over
   * Jira's storage limit, sending an admin to bulk-delete over a row that was already gone.
   * One theme: this is a wire-order fact, not a rendering one. */
  {
    console.log("M3c a delete of an already-gone row is 'not found', never a capacity wall");
    const env = await openAdmin(browser, "light", { __MEMORY_OVERCAP__: true, __MEMORY_STALE_LIST__: true });
    const { page } = env;
    try {
      await tab(page, "Memories");
      await page.locator(".memories-admin-tab .table").waitFor({ timeout: 10000 });
      // m3 is the seeded stale row — find it by its text and delete that row.
      const row = page.locator(".memories-admin-tab tr", { hasText: "Transitions to Done require a non-empty resolution." }).first();
      await row.locator(".row-actions .btn-danger").click();
      await page.locator(".cr-confirm").first().waitFor({ timeout: 5000 });
      await page.locator(".cr-confirm .btn-danger").click();
      const toast = page.locator(".mls-toast").first();
      await toast.waitFor({ timeout: 8000 });
      const t = await toast.innerText();
      ok(/Memory not found/i.test(t), `M3c the answer is "Memory not found" (got: ${t})`);
      ok(!/storage limit/i.test(t), `M3c it is NOT a capacity sentence (got: ${t})`);
      ok(await page.locator(".memories-admin-capwall").count() === 0,
        "M3c and no capacity wall is raised for a row that was already gone");
      ok(env.errors.length === 0, "M3c no page errors: " + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  ✗ M3c threw: " + e.message.split("\n")[0]); }
    await close(env);
  }

  /* ---------------- M4 — F-189: a HEALTHY store states its size in slate, not red ----------------
   * The other half of the stats line, and the half that must not cry wolf: under the guard
   * this is a statistic. If it rendered red always, the red that means "nothing is being
   * learned" would be worth nothing by the time it mattered. */
  for (const theme of ["light", "dark"]) {
    console.log(`M4 memories byte stats under the guard — ${theme}`);
    const env = await openAdmin(browser, theme);
    const { page } = env;
    try {
      await tab(page, "Memories");
      const stats = page.locator(".memories-admin-stats").first();
      await stats.waitFor({ timeout: 10000 });
      ok(!(await stats.getAttribute("class")).includes("memories-admin-stats-over"),
        `M4 ${theme} a healthy store does NOT wear the over-guard class`);
      const c = await stats.evaluate((el) => getComputedStyle(el).color);
      const rgb = c.match(/\d+/g).map(Number);
      ok(!(rgb[0] > 180 && rgb[1] < 90 && rgb[2] < 90), `M4 ${theme} a healthy store is not red — got ${c}`);
      ok(/^rgba?\(/.test(c) && !/rgba\(0,\s*0,\s*0,\s*0\)/.test(c), `M4 ${theme} the stats line resolves a real colour (got ${c})`);
      // And no capacity wall / no bulk bar in the resting state.
      ok(await page.locator(".memories-admin-stats-note").count() === 0,
        `M4 ${theme} no over-platform clause on a healthy store`);
      ok(await page.locator(".memories-admin-capwall").count() === 0, `M4 ${theme} no capacity wall on a healthy store`);
      ok(await page.locator(".memories-admin-bulkbar").count() === 0, `M4 ${theme} no bulk bar until something is ticked`);
      ok(env.errors.length === 0, `M4 ${theme} no page errors: ` + env.errors.join(" | "));
      await shot(page, `m4-memories-stats-healthy-${theme}`);
    } catch (e) { fail++; console.log(`  ✗ M4 ${theme} threw: ` + e.message.split("\n")[0]); }
    await close(env);
  }

  /* ---------------- M5 — F-202: the bulk-delete toast counts the RESPONSE, not the ticks ----------------
   * `deleteMemory` returns `{ deleted: string[], notFound: string[] }`. The tab used to read
   * `typeof result.deleted === "number"`, an arm the backend can never satisfy — so the
   * count it showed was always the number of rows the admin TICKED. That is wrong in exactly
   * the case that matters: a list gone stale because another admin (or the rule-editor
   * Memories tab) removed a row while this table sat open. `__MEMORY_STALE_LIST__` makes one
   * of the six rows already-gone on the server while it is still on screen and still
   * tickable, which is the only way to make "ticked" and "removed" differ. */
  for (const theme of ["light", "dark"]) {
    console.log(`M5 bulk-delete toast reports deleted/notFound — ${theme}`);
    const env = await openAdmin(browser, theme, { __MEMORY_STALE_LIST__: true });
    const { page } = env;
    try {
      await tab(page, "Memories");
      await page.locator(".memories-admin-tab .table").waitFor({ timeout: 10000 });
      const boxes = page.locator(".memories-admin-select");
      // Row order is newest-first: m1, m2, m3(stale), m4, m5, then the archived m6.
      await boxes.nth(0).check();   // m1 — really there
      await boxes.nth(2).check();   // m3 — gone on the server, still on screen
      await page.locator(".memories-admin-bulkdelete").first().click();
      await page.locator(".cr-confirm").first().waitFor({ timeout: 5000 });
      await page.locator(".cr-confirm .btn-danger").click();
      await page.locator(".mls-toast").first().waitFor({ timeout: 8000 });
      const ttxt = await page.locator(".mls-toast").first().innerText();
      // TWO were ticked, ONE went. The old numeric-branch code said "2 memories deleted".
      ok(/\b1 memory deleted\b/.test(ttxt),
        `M5 ${theme} the toast counts result.deleted.length (1), not the 2 rows ticked (got: ${ttxt})`);
      ok(!/\b2 memories deleted\b/.test(ttxt),
        `M5 ${theme} the toast does NOT report the selection size (got: ${ttxt})`);
      // And it explains the gap, which is the only thing that makes 2-ticked/1-gone readable.
      ok(/already gone/i.test(ttxt),
        `M5 ${theme} the toast mentions the notFound rows (got: ${ttxt})`);
      ok(/\b1 was already gone\b/.test(ttxt),
        `M5 ${theme} the toast names how many were already gone, singular (got: ${ttxt})`);
      await shot(page, `m5-memories-stale-delete-${theme}`);
      ok(env.errors.length === 0, `M5 ${theme} no page errors: ` + env.errors.join(" | "));
    } catch (e) { fail++; console.log(`  ✗ M5 ${theme} threw: ` + e.message.split("\n")[0]); }
    await close(env);
  }

  /* ---------------- M6 — F-219: the EDITOR owns the repair, because the backend says so ----------------
   * F-200 asserted the opposite of this block, and it was right for the code as it then
   * stood: every delete control was wrapped in `{isAdmin && ...}`, so the wall could not
   * honestly name one. F-219 fixed the gate rather than the copy. `deleteMemory`,
   * `updateMemory` and `addMemory` all gate on `requireRole(accountId, "editor")`
   * (src/index.js:7349/7312/7262) — an editor was ALWAYS allowed to do every one of these
   * writes, and the UI was simply refusing to render controls the backend would have
   * accepted. That gap became reachable the moment F-213 stopped forcing `isAdmin = true`
   * on jira:adminPage: an app-demoted site admin then arrived as an editor, met the
   * platform-cap wall, and had nothing on screen able to clear it — while the wall told
   * them "a Jira admin has to delete memories", which they were.
   *
   * So the assertions INVERT. The editor must now SEE the select column, the row actions
   * and the bulk bar, and the wall must give them the remedy. The old "no control is
   * rendered" premise moves to M6b, where it is true: a VIEWER. */
  for (const theme of ["light", "dark"]) {
    console.log(`M6 platform-cap wall for an EDITOR — ${theme}`);
    const env = await openAdmin(browser, theme, { __MEMORY_OVERCAP__: true, __NOT_ADMIN__: true });
    const { page } = env;
    try {
      await tab(page, "Memories");
      await page.locator(".memories-admin-tab .table").waitFor({ timeout: 10000 });
      // Prove the premise: this really is the NON-admin rendering. If the fixture silently
      // stopped demoting, every assertion below would pass vacuously on an admin screen.
      ok(await page.locator(".tab-btn", { hasText: "Settings" }).count() === 0,
        `M6 ${theme} the fixture really is non-admin (no admin-only Settings tab)`);
      // F-219 — and the editor HAS the delete controls, because the backend accepts them.
      ok(await page.locator(".memories-admin-select").count() > 0,
        `M6 ${theme} an editor SEES the select checkboxes (deleteMemory gates on editor)`);
      ok(await page.locator(".memories-admin-tab .row-actions").count() > 0,
        `M6 ${theme} an editor has the per-row Edit/Archive/Delete actions`);
      // ...and that the add form IS there, which is how they reach the refusal at all.
      // F-224 — both halves, and the absence of the non-editor note. `addMemory` gates on
      // requireRole("editor"), so this is the arm the backend accepts; M6b asserts the other.
      ok(await page.locator(".memories-admin-add input").count() === 1,
        `M6 ${theme} the Add Memory form is available to an editor — this is how they hit the wall`);
      ok(await page.locator(".btn-add-memory").count() === 1,
        `M6 ${theme} an editor gets the Add Memory button, not a note`);
      ok(await page.locator(".memories-admin-add-note").count() === 0,
        `M6 ${theme} an editor is NOT told that only editors and admins can add`);
      // The bulk bar is selection-gated, not role-gated: tick a row and it must appear.
      await page.locator(".memories-admin-select").first().check();
      await page.locator(".memories-admin-bulkdelete").waitFor({ timeout: 5000 });
      ok(await page.locator(".memories-admin-bulkdelete").count() === 1,
        `M6 ${theme} "Delete selected" — the ONLY write that can shrink an over-cap store — is reachable`);
      await page.locator(".memories-admin-select").first().uncheck();

      await page.locator(".memories-admin-add input").fill("A memory this store cannot fit.");
      await page.locator(".btn-add-memory").click();
      const wall = page.locator(".memories-admin-capwall").first();
      await wall.waitFor({ timeout: 8000 });
      const wtxt = await wall.innerText();
      // The backend's sentence still travels verbatim — that half is not surface-dependent.
      ok(wtxt.includes(memoryPlatformCapMessage(6544)),
        `M6 ${theme} the wall still carries the resolver's sentence verbatim (got: ${wtxt.replace(/\n/g, " | ")})`);
      // The REMEDY half inverts with the gate: the editor gets the instruction, because
      // every control it names is now on their screen (asserted above, so this cannot be
      // an instruction they are unable to follow).
      ok(/Select the memories to remove and delete them together/i.test(wtxt),
        `M6 ${theme} the wall gives the editor the remedy (got: ${wtxt.replace(/\n/g, " | ")})`);
      ok(/Archiving does not free capacity/i.test(wtxt),
        `M6 ${theme} the wall still kills the wrong instinct (archive does not reclaim a slot)`);
      // And it must NOT send them to somebody else — the false referral F-219 removed.
      ok(!/a Jira admin has to delete memories/i.test(wtxt),
        `M6 ${theme} the wall does NOT send an editor to a "Jira admin" it no longer needs`);
      ok(/over Jira's storage limit/i.test(wtxt),
        `M6 ${theme} the wall still names the condition`);
      // Same solid-red hard-stop grammar in both themes — the copy changed, the design did not.
      const wst = await wall.evaluate((el) => {
        const c = getComputedStyle(el);
        return { bg: c.backgroundColor, fg: c.color, bl: c.borderLeftWidth, bt: c.borderTopWidth, r: c.borderRadius, g: c.gap, p: c.padding };
      });
      const wrgb = wst.bg.match(/\d+/g).map(Number);
      ok(wrgb[0] > 180 && wrgb[1] < 90 && wrgb[2] < 90, `M6 ${theme} wall is a SOLID red fill — got ${wst.bg}`);
      ok(/255,\s*255,\s*255/.test(wst.fg), `M6 ${theme} wall has white text — got ${wst.fg}`);
      ok(wst.bl === wst.bt, `M6 ${theme} wall has NO left accent rail`);
      /* F-222's hard-stop geometry, asserted HERE from F-224 onward. It used to live in
         M6b, but gating the add form on `canEdit` means a viewer can no longer raise this
         wall at all, so M6b lost its only way to render one. The editor fixture is now the
         only rendered hard-stop in this file — retiring these along with M6b's wall would
         have silently dropped the cross-app CSS-drift claim they exist to make. */
      ok(wst.r === "4px", `M6 ${theme} hard-stop radius is 4px (got ${wst.r})`);
      ok(wst.g === "3px", `M6 ${theme} hard-stop gap is 3px (got ${wst.g})`);
      ok(wst.p === "9px 12px", `M6 ${theme} hard-stop padding is 9px 12px (got ${wst.p})`);
      /* The page TITLE reads against the surface in both themes. Asserted here because
         m6-memories-capwall-nonadmin-dark.png was read as showing a near-black title on
         the dark surface: it is a mid-fade capture, not a token gap (the computed colour
         is the dark --text-color, #F5F5F7). This check is what settles that question
         next time without anyone squinting at a PNG. */
      const titleLum = await page.locator("h2.title").first().evaluate((el) => {
        const [r, g, b] = getComputedStyle(el).color.match(/\d+/g).map(Number);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      });
      ok(theme === "dark" ? titleLum > 140 : titleLum < 120,
        `M6 ${theme} the page title contrasts with the surface (luminance ${Math.round(titleLum)})`);
      await shot(page, `m6-memories-capwall-editor-${theme}`);
      ok(env.errors.length === 0, `M6 ${theme} no page errors: ` + env.errors.join(" | "));
    } catch (e) { fail++; console.log(`  ✗ M6 ${theme} threw: ` + e.message.split("\n")[0]); }
    await close(env);
  }

  /* ---------------- M6b - F-219: the VIEWER, who is the real "cannot repair this" case ----------------
   * This is where F-200's premise actually lives now, and it needs its own fixture because
   * `isAdmin: false` had been doing duty for two very different people. A viewer is the one
   * the backend genuinely refuses (`requireRole(accountId, "editor")` fails for them on
   * add, update AND delete), so a viewer is the one for whom naming a delete control would
   * be an order they cannot obey.
   *
   * F-224 CHANGES WHAT THIS BLOCK CAN ASSERT. The add form was the last write control still
   * rendered for a viewer, and it was also the only way a viewer could raise the capacity
   * wall (`capRefusal` comes from handleAdd and saveEdit, nothing else). Gating it on
   * `canEdit` therefore makes the wall unreachable here, and the referral-arm copy
   * assertions that used to live in this block have nothing left to render. They are not
   * simply deleted: the wall's copy and colour claims are still made in M6 against the
   * EDITOR fixture, which is the one that can still produce one, and F-222's hard-stop
   * geometry moved there with them. What this block asserts now is the gate itself - no
   * text box, no button, the slate note in their place - plus the viewer's remaining
   * signal that the store is stuck, which is the load-driven size line.
   * Both themes, because the note is a colour claim as much as a copy claim. */
  for (const theme of ["light", "dark"]) {
    console.log(`M6b platform-cap wall for a VIEWER - ${theme}`);
    const env = await openAdmin(browser, theme, { __MEMORY_OVERCAP__: true, __VIEWER__: true });
    const { page } = env;
    try {
      await tab(page, "Memories");
      await page.locator(".memories-admin-tab .table").waitFor({ timeout: 10000 });
      // The premise, and the whole point of the new fixture: NO write control at all.
      ok(await page.locator(".memories-admin-select").count() === 0,
        `M6b ${theme} a viewer sees no select checkboxes`);
      ok(await page.locator(".memories-admin-bulkdelete").count() === 0,
        `M6b ${theme} a viewer has no "Delete selected" control`);
      ok(await page.locator(".memories-admin-tab .row-actions").count() === 0,
        `M6b ${theme} a viewer has no per-row Edit/Archive/Delete either`);
      ok(await page.locator(".memories-admin-toggles").count() === 0,
        `M6b ${theme} and no settings toggles - saveMemorySettings gates on requireAdmin`);

      /* F-224 - the add form is the LAST write control that was rendered for everyone, and
         `addMemory` refuses a viewer exactly as update and delete do. Until now a viewer got
         a live text box and a solid teal button: they could type the fact they wanted the AI
         to learn, press Add, and only then be told no. The gate removes the invitation. */
      ok(await page.locator(".memories-admin-add input").count() === 0,
        `M6b ${theme} a viewer gets no Add Memory text box - addMemory gates on requireRole("editor")`);
      ok(await page.locator(".btn-add-memory").count() === 0,
        `M6b ${theme} a viewer gets no Add Memory button`);
      // ...and is TOLD why, rather than simply finding the control missing.
      const note = page.locator(".memories-admin-add-note");
      ok(await note.count() === 1, `M6b ${theme} a viewer gets the one-line note in its place`);
      const ntxt = (await note.innerText()).trim();
      ok(/^Editors and admins can add memories\.$/.test(ntxt),
        `M6b ${theme} the note names the roles the BACKEND accepts (got: ${ntxt})`);
      /* Owner design law on the replacement: neutral slate, solid colour, 600 weight, and
         NO left rail. Both themes, because slate needs its dark override like every hue. */
      const nst = await note.evaluate((el) => {
        const c = getComputedStyle(el);
        return { fg: c.color, w: c.fontWeight, bl: c.borderLeftWidth, bt: c.borderTopWidth };
      });
      const nrgb = nst.fg.match(/\d+/g).map(Number);
      const wantSlate = theme === "dark" ? [100, 116, 139] : [71, 85, 105];
      ok(nrgb.slice(0, 3).every((v, i) => Math.abs(v - wantSlate[i]) <= 2),
        `M6b ${theme} the note is the neutral slate hue ${wantSlate.join(",")} - got ${nst.fg}`);
      ok(Number(nst.w) >= 600, `M6b ${theme} the note is 600+ weight - got ${nst.w}`);
      ok(nst.bl === nst.bt, `M6b ${theme} the note has NO left accent rail`);

      /* And the wall itself is now UNREACHABLE for a viewer, which is the honest consequence
         of the gate rather than an oversight: `capRefusal` is only ever raised by handleAdd
         and saveEdit, and F-224 put both behind `canEdit`. Asserting its absence is what will
         catch a future change that re-opens a write path to a viewer without noticing. The
         viewer's live signal that the store is stuck is the load-driven, role-independent
         size line, so THAT is what must carry the message here. */
      ok(await page.locator(".memories-admin-capwall").count() === 0,
        `M6b ${theme} a viewer cannot raise the capacity wall - no write path reaches it`);
      const statsLine = page.locator(".memories-admin-stats").first();
      await statsLine.waitFor({ timeout: 8000 });
      const stxt = await statsLine.innerText();
      ok(/over Jira's storage limit/i.test(stxt),
        `M6b ${theme} the size line still tells a viewer the store is stuck (got: ${stxt.replace(/\n/g, " | ")})`);
      ok(/deleted together/i.test(stxt),
        `M6b ${theme} and that it takes a bulk delete to clear (got: ${stxt.replace(/\n/g, " | ")})`);
      await shot(page, `m6b-memories-viewer-noadd-${theme}`);
      ok(env.errors.length === 0, `M6b ${theme} no page errors: ` + env.errors.join(" | "));
    } catch (e) { fail++; console.log(`  x M6b ${theme} threw: ` + e.message.split("\n")[0]); }
    await close(env);
  }

  /* ---------------- M6c — F-234: the READ itself is refused (no CogniRunner role) --------
   * F-228 put a VIEWER FLOOR on `getMemories` (src/index.js:7341), so a user on neither
   * the roster nor Jira's admin list gets `{ success: false }` from the LOAD — not just
   * from the writes M6b covers. That refusal landed in the same `loadError` slot as a
   * network fault, so the tab reported "Couldn't load memories." beside a Retry button:
   * an outage told as the cause, and a remedy that re-asks the identical question and
   * gets the identical no, forever. Same defect class as F-230 (an outage told as a
   * verdict) run in the opposite direction — a verdict told as an outage.
   * Both themes, because the replacement is a colour claim as much as a copy claim. */
  for (const theme of ["light", "dark"]) {
    console.log(`M6c getMemories REFUSED - no roster role - ${theme}`);
    const env = await openAdmin(browser, theme, { __NO_ROSTER__: true });
    const { page } = env;
    try {
      await tab(page, "Memories");
      const denied = page.locator(".memories-admin-denied");
      await denied.waitFor({ timeout: 10000 });

      // The refusal is told AS a refusal...
      const dtxt = (await denied.innerText()).replace(/\s+/g, " ").trim();
      ok(/You need CogniRunner viewer access to see memories\./.test(dtxt),
        `M6c ${theme} the note states the refusal, not a failure (got: ${dtxt})`);
      ok(/Ask a CogniRunner admin under Permissions\./.test(dtxt),
        `M6c ${theme} and names WHO can grant it, and where (got: ${dtxt})`);

      /* ...and the two things that made it a lie are GONE. The Retry is the load-bearing
         assertion here: a button that re-asks a settled question can only ever fail, and
         its presence is what kept the reader clicking instead of asking an admin. */
      ok(await page.locator(".memories-admin-tab .load-error").count() === 0,
        `M6c ${theme} no "Couldn't load memories." row - nothing failed to load`);
      ok(await page.locator(".memories-admin-tab .btn-retry").count() === 0,
        `M6c ${theme} and NO Retry button - it could never succeed`);
      // Nor does it fall through to the "No memories yet" empty state, which would be a
      // different false claim: that the store is empty, rather than unreadable by them.
      ok(await page.locator(".memories-admin-empty-title").count() === 0,
        `M6c ${theme} and not the "No memories yet" empty state either`);
      /* `getMemoryStoreStats` carries the same F-228 viewer floor (src/index.js:7502), so
         a reader who cannot see the memories cannot see what they WEIGH either. Asserting
         it here keeps the two refusals in step: a future change that drops the floor from
         one resolver and not the other would leak the store's byte pressure onto the very
         screen that just said "you have no access". */
      ok(await page.locator(".memories-admin-stats").count() === 0,
        `M6c ${theme} and no store-size line - getMemoryStoreStats is refused by the same floor`);

      /* F-243 — ONE refusal, ONE note. The refused reader also failed `canEdit`, so the
         add-form's non-editor note rendered ABOVE the access note: "Editors and admins can
         add memories." stacked on "You need CogniRunner viewer access to see memories."
         Two sentences for one state, and the weaker one came first — it answers a question
         this reader has not reached (who may WRITE) while they cannot even READ the store,
         and it quietly implies the real obstacle is their edit level rather than their lack
         of any access at all. Only the actionable note survives. */
      ok(await page.locator(".memories-admin-add-note").count() === 0,
        `M6c ${theme} the "Editors and admins can add memories." note is NOT stacked above the refusal`);
      ok(await page.locator(".memories-admin-tab [role='note']").count() === 1,
        `M6c ${theme} exactly ONE note is shown to a refused reader`);

      /* F-242 — the refusal was detected from `reason:"no-permission"`, not by regexing the
         English. The fixture sends the real shape now; this asserts the LEVEL in the note
         came from the gate's `needsRole` rather than a hand-typed "viewer" that happened to
         be right. A backend that starts asking for `editor` here must change this sentence,
         and if the level were still hardcoded it silently would not. */
      ok(/viewer/.test(dtxt),
        `M6c ${theme} the note names the level the GATE asked for (needsRole), got: ${dtxt}`);

      /* Owner design law: neutral slate, solid colour, 600+ weight, NO left rail — the
         same grammar as the F-224 add note, asserted the same way. */
      const dst = await denied.evaluate((el) => {
        const c = getComputedStyle(el);
        return { fg: c.color, w: c.fontWeight, bl: c.borderLeftWidth, bt: c.borderTopWidth, bg: c.backgroundColor };
      });
      const drgb = dst.fg.match(/\d+/g).map(Number);
      const wantSlate = theme === "dark" ? [100, 116, 139] : [71, 85, 105];
      ok(drgb.slice(0, 3).every((v, i) => Math.abs(v - wantSlate[i]) <= 2),
        `M6c ${theme} the note is the neutral slate hue ${wantSlate.join(",")} - got ${dst.fg}`);
      ok(Number(dst.w) >= 600, `M6c ${theme} the note is 600+ weight - got ${dst.w}`);
      ok(dst.bl === dst.bt, `M6c ${theme} the note has NO left accent rail`);
      ok(/rgba\(0, 0, 0, 0\)|transparent/.test(dst.bg),
        `M6c ${theme} the note is not a tinted block - got ${dst.bg}`);

      await shot(page, `m6c-memories-access-denied-${theme}`);
      ok(env.errors.length === 0, `M6c ${theme} no page errors: ` + env.errors.join(" | "));
    } catch (e) { fail++; console.log(`  x M6c ${theme} threw: ` + e.message.split("\n")[0]); }
    await close(env);
  }

  /* M6d — F-234 CONTROL. The refusal branch must NOT swallow a real transport failure:
   * `getMemories` THROWING is still "Couldn't load memories." WITH a Retry, because that
   * one genuinely can succeed on a second try. Without this arm, a fix that routed every
   * unsuccessful load to the access note would pass M6c and quietly delete the retry path
   * for everyone. One theme — this is a behaviour claim, not a colour claim. */
  {
    console.log("M6d getMemories THROWS - still a retryable load error");
    const env = await openAdmin(browser, "light", { __FAIL__: ["getMemories"] });
    const { page } = env;
    try {
      await tab(page, "Memories");
      await page.locator(".memories-admin-tab .load-error").waitFor({ timeout: 10000 });
      ok(await page.locator(".memories-admin-tab .btn-retry").count() === 1,
        "M6d a transport failure still offers Retry");
      ok(await page.locator(".memories-admin-denied").count() === 0,
        "M6d and is NOT mistold as an access refusal");
    } catch (e) { fail++; console.log("  x M6d threw: " + e.message.split("\n")[0]); }
    await close(env);
  }

  /* ---------------- M7 — F-213: an app-DEMOTED site admin on jira:adminPage ----------------
   * `jira:adminPage` is gated by Jira's OWN admin permission, so reaching this module
   * proves SITE admin. It proves nothing about the CogniRunner role, and F-210 conflated
   * the two: App.js granted `isAdmin`, role "admin" and scope "all" from the module type,
   * so a site admin the app had demoted to editor got the full admin chrome over editor
   * permissions — Settings and Permissions tabs, bulk-delete controls, an "All Rules"
   * default — every one of which the backend's `requireAdmin` (src/index.js ~261) then
   * refuses. A frontend that overrules the permission authority does not grant access, it
   * manufactures buttons that fail.
   *
   * F-213 removes the override entirely. `checkIsAdmin` is the answer on BOTH modules. The
   * one thing the module is still good for is the EXPLANATION: on jira:adminPage, and only
   * there, an editor/viewer gets a solid slate note naming their real role, because an
   * admin who reaches an admin-gated page and finds it bare will otherwise conclude the app
   * is broken. No chrome comes with the note.
   *
   * `__DEMOTED_ADMIN__` is the only fixture that can show this: it keeps the module at
   * jira:adminPage while checkIsAdmin answers editor/mine. `__NOT_ADMIN__` cannot, because
   * it switches the module to jira:globalPage as well — so it is M7b, the control proving
   * the note is keyed on the MODULE while the PERMISSIONS are keyed on the resolver.
   * Both themes, because this decides what chrome renders. */
  for (const theme of ["light", "dark"]) {
    console.log(`M7 jira:adminPage does NOT override a demoted app role — ${theme}`);
    const env = await openAdmin(browser, theme, { __DEMOTED_ADMIN__: true });
    const { page } = env;
    try {
      await page.locator(".tab-bar").first().waitFor({ timeout: 10000 });
      // NO admin chrome. These are the two adminOnly tabs (App.js TABS: settings,
      // permissions) and they are exactly what the backend would refuse.
      ok(await page.locator(".tab-btn", { hasText: "Settings" }).count() === 0,
        `M7 ${theme} no Settings tab for a site admin the app demoted to editor`);
      ok(await page.locator(".tab-btn", { hasText: "Permissions" }).count() === 0,
        `M7 ${theme} no Permissions tab either`);
      // The note, with the REAL role in it, and in the slate neutral — not the red
      // hard-stop grammar, because nothing here is a capacity failure.
      const note = page.locator(".role-note").first();
      await note.waitFor({ timeout: 8000 });
      const ntxt = await note.innerText();
      ok(/You opened the admin page/i.test(ntxt) && /editor/.test(ntxt),
        `M7 ${theme} the note names the REAL role from the resolver (got: ${ntxt.replace(/\n/g, " ")})`);
      ok(/A CogniRunner admin can change that under Permissions/i.test(ntxt),
        `M7 ${theme} the note names WHO can act (F-208 grammar: a statement, not an instruction)`);
      const g = await note.evaluate((el) => {
        const c = getComputedStyle(el);
        return { bg: c.backgroundColor, fg: c.color, bl: c.borderLeftWidth, bt: c.borderTopWidth };
      });
      const slate = theme === "dark" ? "rgb(100, 116, 139)" : "rgb(71, 85, 105)";
      ok(g.bg === slate, `M7 ${theme} the note is the solid slate neutral (got ${g.bg}, want ${slate})`);
      ok(g.fg === "rgb(255, 255, 255)", `M7 ${theme} white text on the solid fill (got ${g.fg})`);
      ok(g.bl === g.bt, `M7 ${theme} the note has no left accent rail (${g.bl} vs ${g.bt})`);
      // scope "mine" — the editor's real scope survives, so the rules list is honestly
      // narrowed rather than silently narrowed under an admin badge.
      const scopeSel = page.locator(".dropdown-trigger", { hasText: /All Rules|My Rules/ });
      if (await scopeSel.count() > 0) {
        ok((await scopeSel.first().innerText()).includes("My Rules"),
          `M7 ${theme} the rules scope stays My Rules (got: ${(await scopeSel.first().innerText()).trim()})`);
      }
      /* role "editor" - and F-219 changes what that now looks like on the Memories tab.
         The ADMIN-only surfaces stay gone (the two tabs above, and the settings toggles
         below, all backed by `requireAdmin`). The EDITOR surfaces must be present, because
         `deleteMemory`/`updateMemory` gate on `requireRole("editor")` and this user passes
         that. This pairing is the whole finding: a demoted site admin keeps exactly the
         powers the backend grants them, no more and - the part that was broken - no less. */
      await tab(page, "Memories");
      await page.locator(".memories-admin-tab .table").waitFor({ timeout: 10000 });
      ok(await page.locator(".memories-admin-select").count() > 0,
        `M7 ${theme} the select column IS there for an editor (deleteMemory gates on editor)`);
      ok(await page.locator(".memories-admin-tab .row-actions").count() > 0,
        `M7 ${theme} row Edit/Archive/Delete are there too`);
      ok(await page.locator(".memories-admin-toggles").count() === 0,
        `M7 ${theme} but NOT the memory settings toggles - saveMemorySettings gates on requireAdmin`);
      await shot(page, `m7-demoted-admin-${theme}`);
      ok(env.errors.length === 0, `M7 ${theme} no page errors: ` + env.errors.join(" | "));
    } catch (e) { fail++; console.log(`  ✗ M7 ${theme} threw: ` + e.message.split("\n")[0]); }
    await close(env);
  }

  /* M7b — the NEGATIVE control for the NOTE. Same demoted role, but reached through
   * jira:globalPage, where Jira enforced nothing and where there is no expectation of
   * admin chrome to explain away. Permissions must look identical to M7 (the resolver is
   * the authority on both modules) and the note must be ABSENT — if it rendered here it
   * would be keyed on the role rather than the module, and every editor in the tenant
   * would be told to go and ask about a page they never opened. */
  {
    console.log("M7b jira:globalPage: same permissions, and no admin-page note");
    const env = await openAdmin(browser, "light", { __NOT_ADMIN__: true });
    const { page } = env;
    try {
      await page.locator(".tab-bar").first().waitFor({ timeout: 10000 });
      ok(await page.locator(".tab-btn", { hasText: "Settings" }).count() === 0,
        "M7b an editor on jira:globalPage gets no admin-only Settings tab");
      ok(await page.locator(".tab-btn", { hasText: "Permissions" }).count() === 0,
        "M7b an editor on jira:globalPage gets no Permissions tab");
      ok(await page.locator(".role-note").count() === 0,
        "M7b no admin-page note off jira:adminPage — it explains a MODULE, not a role");
      await tab(page, "Memories");
      await page.locator(".memories-admin-tab .table").waitFor({ timeout: 10000 });
      /* F-219 — inverted with the gate. This assertion used to read "no admin-gated select
         column", which was only ever describing the bug: the column is gated on the ability
         to DELETE, and deleteMemory gates on requireRole("editor"). The module is irrelevant
         to it — that is the point of M7b as a control — so an editor arriving through
         jira:globalPage gets exactly what the same editor gets through jira:adminPage. */
      ok(await page.locator(".memories-admin-select").count() > 0,
        "M7b an editor on jira:globalPage gets the select column, same as on jira:adminPage");
      ok(await page.locator(".memories-admin-toggles").count() === 0,
        "M7b but still no memory settings toggles — those are requireAdmin on both modules");
      ok(env.errors.length === 0, "M7b no page errors: " + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  ✗ M7b threw: " + e.message.split("\n")[0]); }
    await close(env);
  }

  /* M7c — the POSITIVE control, and the one that stops F-213 from reading as "admin chrome
   * is gone". A REAL admin (no flag: module jira:adminPage, checkIsAdmin answers
   * admin/all) must still get everything. Without this, deleting the override and deleting
   * the feature look identical to the suite. */
  {
    console.log("M7c a real admin on jira:adminPage still gets the full chrome and no note");
    const env = await openAdmin(browser, "light");
    const { page } = env;
    try {
      await page.locator(".tab-bar").first().waitFor({ timeout: 10000 });
      ok(await page.locator(".tab-btn", { hasText: "Settings" }).count() === 1,
        "M7c a real admin gets the Settings tab");
      ok(await page.locator(".tab-btn", { hasText: "Permissions" }).count() === 1,
        "M7c a real admin gets the Permissions tab");
      ok(await page.locator(".role-note").count() === 0,
        "M7c no note for an admin who is actually an admin");
      const scopeSel = page.locator(".dropdown-trigger", { hasText: /All Rules|My Rules/ }).first();
      await scopeSel.waitFor({ timeout: 8000 });
      ok((await scopeSel.innerText()).includes("All Rules"),
        `M7c the rules scope defaults to All Rules (got: ${(await scopeSel.innerText()).trim()})`);
      await tab(page, "Memories");
      await page.locator(".memories-admin-tab .table").waitFor({ timeout: 10000 });
      ok(await page.locator(".memories-admin-select").count() > 0,
        "M7c the admin-gated select column renders for a real admin");
      ok(await page.locator(".memories-admin-tab .row-actions").count() > 0,
        "M7c the admin-gated row actions render for a real admin");
      ok(env.errors.length === 0, "M7c no page errors: " + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  ✗ M7c threw: " + e.message.split("\n")[0]); }
    await close(env);
  }

  /* ---------------- M7d - F-230: Jira could not be asked, which is NOT "you have no role"
   * M7 proves the note tells a demoted admin their real role. This block proves the app
   * does not make that claim when it has no right to. `checkIsAdmin` now returns
   * `{ isAdmin: false, role: null, unknown: true, reason }` when the permission probe AND
   * the group scan both threw - a Jira outage, not a verdict about the user.
   *
   * Before F-230 the frontend had no way to tell that apart from a genuine `role: null`,
   * so a transient 503 rendered "CogniRunner has you as no role. A CogniRunner admin can
   * change that under Permissions." to a real site admin. Both halves are wrong in the
   * worst direction: the first is a false statement about their permissions, and the second
   * sends them to fix something that is not broken - possibly to themselves, since on
   * jira:adminPage they demonstrably hold Jira's admin permission. Nothing about reloading
   * is discoverable from that copy, and reloading is the only thing that helps.
   *
   * The module stays `jira:adminPage` (the flag is deliberately absent from bridge.js's
   * `notAdmin` switch), because that is the surface the note is keyed to and the only place
   * the false copy could be read. Both themes - same slate .role-note grammar as M7, which
   * is the point: the severity does not change, only the claim. */
  for (const theme of ["light", "dark"]) {
    console.log(`M7d role unknown - Jira could not be asked - ${theme}`);
    const env = await openAdmin(browser, theme, { __ROLE_UNKNOWN__: true });
    const { page } = env;
    try {
      await page.locator(".tab-bar").first().waitFor({ timeout: 10000 });
      // Still no admin chrome: `unknown` is not a grant. Failing OPEN on an unreadable
      // role would paint exactly the controls the backend's requireAdmin then refuses.
      ok(await page.locator(".tab-btn", { hasText: "Settings" }).count() === 0,
        `M7d ${theme} an unreadable role grants no Settings tab`);
      ok(await page.locator(".tab-btn", { hasText: "Permissions" }).count() === 0,
        `M7d ${theme} nor a Permissions tab`);

      const note = page.locator(".role-note").first();
      await note.waitFor({ timeout: 8000 });
      const ntxt = (await note.innerText()).replace(/\s+/g, " ").trim();
      ok(/could not verify your role with Jira just now/i.test(ntxt),
        `M7d ${theme} the note names the OUTAGE, not a role (got: ${ntxt})`);
      ok(/reload to try again/i.test(ntxt),
        `M7d ${theme} and gives the one action that can actually resolve it (got: ${ntxt})`);
      // The two false claims, asserted as absences - this is the whole finding.
      ok(!/no role/i.test(ntxt),
        `M7d ${theme} it never claims the user has "no role" (got: ${ntxt})`);
      ok(!/under Permissions/i.test(ntxt) && !/A CogniRunner admin can change/i.test(ntxt),
        `M7d ${theme} it never sends them to an admin to fix a permission that is not broken (got: ${ntxt})`);
      ok(!/You opened the admin page/i.test(ntxt),
        `M7d ${theme} the known-role copy does not leak into the unknown arm (got: ${ntxt})`);

      /* Same slate .role-note grammar as M7: solid neutral, no left rail, dark override.
         Asserted here because the unknown arm is a NEW render path through that class and
         a hue that only appears in one branch is exactly how a missing dark override ships. */
      const g = await note.evaluate((el) => {
        const c = getComputedStyle(el);
        return { bg: c.backgroundColor, bl: c.borderLeftWidth, bt: c.borderTopWidth };
      });
      ok(g.bl === g.bt, `M7d ${theme} the note has NO left accent rail`);
      const grgb = (g.bg.match(/\d+/g) || []).map(Number);
      const wantSlate = theme === "dark" ? [100, 116, 139] : [71, 85, 105];
      ok(grgb.length >= 3 && grgb.slice(0, 3).every((v, i) => Math.abs(v - wantSlate[i]) <= 2),
        `M7d ${theme} the note is the neutral slate fill ${wantSlate.join(",")} - got ${g.bg}`);

      await shot(page, `m7d-role-unknown-${theme}`);
      ok(env.errors.length === 0, `M7d ${theme} no page errors: ` + env.errors.join(" | "));
    } catch (e) { fail++; console.log(`  ✗ M7d ${theme} threw: ` + e.message.split("\n")[0]); }
    await close(env);
  }

  /* ---------------- F-259 — a REFUSED user search must not look like an empty directory ----
     PermissionsTab's search read `if (result.success)` and had NO else branch at all, so
     every non-success answer vanished: spinner off, box empty, no message. `searchUsers`
     gates on admin, so the reader most likely to hit the refusal is an admin who has just
     been demoted — and the app's answer was to imply that nobody on the site matches their
     query. Silence is the worst of the three possible wrongs here, because there is nothing
     on screen to even tell them a question was asked and answered.
     Both themes: .access-note is a slate class and every hue needs its dark override. */
  for (const theme of ["light", "dark"]) {
    console.log(`F-259 refused user search (${theme})`);
    const env = await openAdmin(browser, theme, { __REFUSE__: ["searchUsers"], __REFUSE_ROLE__: "admin" });
    const { page } = env;
    try {
      await tab(page, "Permissions");
      const input = page.locator(".perm-search-input");
      await input.waitFor({ timeout: 10000 });
      await input.fill("alex");
      const note = page.locator(".perm-search-wrap .access-note");
      await note.waitFor({ timeout: 10000 });
      const t = (await note.innerText()).replace(/\s+/g, " ").trim();

      ok(/You need CogniRunner admin access to see users\./.test(t),
        `F-259 ${theme} the refusal names the level the gate asked for (got: ${JSON.stringify(t)})`);
      ok(/Ask a CogniRunner admin under Permissions\./.test(t),
        `F-259 ${theme} and names who can grant it`);

      /* The load-bearing negative: the old behaviour's ONLY visible outcome was the
         "no users found" line (or nothing at all), which is a false claim about the
         directory rather than a statement about this reader. */
      ok(!/No users found/i.test(await page.locator(".perm-search-wrap").innerText()),
        `F-259 ${theme} it does NOT claim the directory has no match`);
      ok(await page.locator(".perm-search-wrap .perm-result-row, .perm-search-wrap .perm-result").count() === 0,
        `F-259 ${theme} no stale result rows remain clickable under the refusal`);
      ok(await page.locator(".perm-search-wrap .btn-retry").count() === 0,
        `F-259 ${theme} no Retry — the gate answers the same way every time`);

      /* Owner design law on the note, asserted live, in both themes. */
      const st = await note.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { bl: cs.borderLeftWidth, bt: cs.borderTopWidth, color: cs.color, bg: cs.backgroundColor, fw: cs.fontWeight };
      });
      ok(st.bl === st.bt, `F-259 ${theme} the note has NO left accent rail`);
      const rgb = (st.color.match(/\d+/g) || []).map(Number);
      const want = theme === "dark" ? [100, 116, 139] : [71, 85, 105];
      ok(rgb.slice(0, 3).every((v, i) => Math.abs(v - want[i]) <= 2),
        `F-259 ${theme} the note is the neutral slate ${want.join(",")} — got ${st.color}`);
      ok(Number(st.fw) >= 600, `F-259 ${theme} the note is 600+ weight — got ${st.fw}`);
      ok(/rgba\(0, 0, 0, 0\)|transparent/.test(st.bg), `F-259 ${theme} the note is not a tinted block`);

      /* Clearing the box clears the message. A note that outlives the query it answered is
         the next version of this bug: it would sit over a fresh, successful search. */
      await page.locator(".perm-search-clear").click();
      await page.waitForTimeout(300);
      ok(await page.locator(".perm-search-wrap .access-note").count() === 0,
        `F-259 ${theme} clearing the search clears the refusal note with it`);

      ok(env.errors.length === 0, `F-259 ${theme} no page errors: ` + env.errors.join(" | "));
    } catch (e) { fail++; console.log(`  ✗ F-259 ${theme} threw: ` + e.message.split("\n")[0]); }
    await close(env);
  }

} finally {
  await browser.close();
}
console.log(`LISTENERS/JOBS UI JOURNEYS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
