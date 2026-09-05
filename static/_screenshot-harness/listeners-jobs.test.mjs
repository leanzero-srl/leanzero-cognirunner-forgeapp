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
