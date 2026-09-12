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
 * Prereq: cd static/admin-panel && npx webpack --config webpack.screenshot.js --mode production
 * Run:    node static/_screenshot-harness/listeners-jobs.test.mjs   (add --shots to save PNGs to out/)
 */
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  const root = path.join(STATIC, "admin-panel", "build-shot");
  if (!fs.existsSync(path.join(root, "index.html"))) throw new Error("no admin-panel build-shot — build it first (webpack.screenshot.js)");
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
} finally {
  await browser.close();
}
console.log(`LISTENERS/JOBS UI JOURNEYS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
