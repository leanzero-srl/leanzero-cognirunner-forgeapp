/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * config-ui RULE EDITOR browser journeys (mock-bridge harness).
 *
 * The config-ui rule editor renders inside the Jira WORKFLOW EDITOR (a transition
 * config modal), which has no stable deep-link — so it can't be reached the way the
 * admin globalPage is. Instead we drive the REAL config-ui build with @forge/bridge +
 * @forge/jira-bridge aliased to the local mocks (bridge.js): view.getContext() seeds a
 * full editor per window.__SHOT__, and invoke() returns canned resolver responses. This
 * exercises the editor UI end-to-end (form hydration, field picker, Test flow, verdict
 * render) with mocked backend responses — UI-behaviour coverage, not real-AI e2e.
 *
 * Prereq: a fresh build —  cd static/config-ui && npx webpack --config webpack.screenshot.js --mode production
 * Run:    node static/_screenshot-harness/editor-journeys.test.mjs
 */
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC = path.resolve(__dirname, "..");

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

async function openEditor(browser, app, shot, theme = "light") {
  const root = path.join(STATIC, app, "build-shot");
  if (!fs.existsSync(path.join(root, "index.html"))) throw new Error(`no build-shot for ${app} — build it first (webpack.screenshot.js)`);
  const { s, port } = await serve(root);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addInitScript(([sh, th]) => { window.__SHOT__ = sh; window.__THEME__ = th; }, [shot, theme]);
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
  // App mounted into .container with no skeletons left.
  await page.waitForFunction(() => !!document.querySelector(".container") && !document.querySelector(".container .sk"), { timeout: 15000 }).catch(() => {});
  return { page, ctx, s };
}
async function closeEditor(env) { await env.ctx.close(); await new Promise((r) => env.s.close(r)); }

const browser = await chromium.launch();
try {
  /* ---------------- J14 — create/edit an AI VALIDATOR ---------------- */
  {
    console.log("J14 AI validator editor (cfg-validator)");
    const env = await openEditor(browser, "config-ui", "cfg-validator");
    const { page } = env;
    try {
      // Form hydrates from the seeded validatorConfig (fieldId=description, prompt, enableTools=auto).
      ok(await page.locator(".dropdown-trigger", { hasText: "Description" }).count() > 0, "J14 field picker shows the seeded field (Description)");
      const promptEl = page.locator("textarea[placeholder*='makes the field value valid']").first();
      const promptVal = await promptEl.inputValue();
      ok(/steps to reproduce/i.test(promptVal), "J14 validation prompt textarea hydrated from config");
      ok(await page.getByText("Auto-detect from prompt").count() > 0, "J14 agentic JQL (enableTools) select renders");

      // Edit the prompt (the editor is interactive, not just displaying).
      await promptEl.fill(promptVal + " Also require an owner.");
      ok((await promptEl.inputValue()).includes("Also require an owner."), "J14 prompt is editable");

      // Open the Test panel, pick an issue (mock validateIssue → valid), run the dry-run test.
      await page.locator("button.btn-semantic-test-toggle", { hasText: "Test Validation" }).click();
      await page.waitForSelector(".semantic-test-panel", { timeout: 8000 });
      ok(await page.locator(".test-panel-badge", { hasText: /Dry run/i }).count() > 0, "J14 Test panel opens with the dry-run badge");
      await page.locator("input.issue-picker-input").fill("PROJ-42");
      await page.waitForSelector(".issue-picker-valid", { timeout: 8000 });
      ok(true, "J14 IssuePicker validates the entered key (mock validateIssue)");
      const runBtn = page.locator("button.btn-run-test", { hasText: "Run Test" });
      await runBtn.click();
      await page.waitForSelector(".semantic-test-result", { timeout: 10000 });
      ok(await page.locator(".test-badge-pass", { hasText: "PASS" }).count() > 0, "J14 Test Validation returns a PASS verdict");
      const resultText = await page.locator(".semantic-test-result").first().innerText();
      ok(/steps to reproduce/i.test(resultText), "J14 verdict shows the AI reason");
    } catch (e) { fail++; console.log("  ✗ J14 threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- J18 — STATIC post-function builder (multi-step + CodeMirror) ---------------- */
  {
    console.log("J18 static-PF editor (cfg-static)");
    const env = await openEditor(browser, "config-ui", "cfg-static");
    const { page } = env;
    try {
      // FunctionBuilder hydrates the seeded multi-step build (3 generated steps).
      ok(await page.locator(".function-block").count() >= 3, "J18 FunctionBuilder renders the seeded multi-step build (>=3 steps)");
      const firstName = await page.locator("input.function-name-input").first().inputValue();
      ok(/Find duplicate issues/i.test(firstName), "J18 step name hydrated from config");
      // The step name is editable (interactive editor).
      const nameEl = page.locator("input.function-name-input").first();
      await nameEl.fill("Find duplicate issues (edited)");
      ok((await nameEl.inputValue()).includes("(edited)"), "J18 step name is editable");
      // CodeMirror mounted, showing the AI-generated code.
      ok(await page.locator(".cm-content").count() >= 1, "J18 CodeMirror editor mounted for the steps");
      const cmText = await page.locator(".cm-content").first().innerText();
      ok(/searchJql|getIssue|project/i.test(cmText), "J18 seeded code renders in the editor");
      // Generation provenance chips (docs / skill / memories) for the AI-generated step.
      ok(await page.locator(".gen-meta-chip.gmc-docs").count() >= 1, "J18 provenance shows an applied-docs chip");
      ok(await page.locator(".gen-meta-chip.gmc-skill", { hasText: "Duplicate Finder" }).count() >= 1, "J18 provenance shows the applied-skill chip");
      ok(await page.locator(".gen-meta-chip.gmc-mem").count() >= 1, "J18 provenance shows an applied-memories chip");
      // Interactive: a step with code offers Regenerate (vs first-time Generate).
      ok(await page.locator(".btn-generate", { hasText: "Regenerate Code" }).count() >= 1, "J18 Regenerate Code control present on a coded step");
    } catch (e) { fail++; console.log("  ✗ J18 threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- J17 — SEMANTIC post-function editor ---------------- */
  {
    console.log("J17 semantic-PF editor (cfg-semantic)");
    const env = await openEditor(browser, "config-ui", "cfg-semantic");
    const { page } = env;
    try {
      const condEl = page.locator('textarea[placeholder*="mentions a bug or defect"]').first();
      const actEl = page.locator('textarea[placeholder*="2-3 bullet points"]').first();
      ok(/customer-facing bug/i.test(await condEl.inputValue()), "J17 run-condition prompt hydrated from config");
      ok(/executive summary/i.test(await actEl.inputValue()), "J17 action prompt hydrated from config");
      // Cross-check claims (fact-check MCP) toggle seeded on.
      ok(await page.locator('input[type="checkbox"]:checked').count() >= 1, "J17 cross-check-claims toggle seeded on");
      // Action prompt is editable.
      await actEl.fill((await actEl.inputValue()) + " Keep it factual.");
      ok((await actEl.inputValue()).includes("Keep it factual."), "J17 action prompt is editable");
      // Test Run → the AI writes a proposed value for the target field.
      await page.locator("button.btn-semantic-test-toggle", { hasText: "Test Run" }).click();
      await page.waitForSelector(".semantic-test-panel", { timeout: 8000 });
      await page.locator("input.issue-picker-input").fill("PROJ-42");
      await page.waitForSelector(".issue-picker-valid", { timeout: 8000 });
      await page.locator("button.btn-run-test", { hasText: "Run Test" }).click();
      await page.waitForSelector(".semantic-test-result", { timeout: 10000 });
      ok(await page.locator(".test-badge", { hasText: "UPDATE" }).count() >= 1, "J17 Test Run returns an UPDATE decision");
      const st = await page.locator(".semantic-test-result").first().innerText();
      ok(/coupon|checkout|customer impact/i.test(st), "J17 result renders the AI's proposed value");
    } catch (e) { fail++; console.log("  ✗ J17 threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- J15 — AI CONDITION editor (same form, condition mode) ---------------- */
  {
    console.log("J15 AI condition editor (cfg-condition)");
    const env = await openEditor(browser, "config-ui", "cfg-condition");
    const { page } = env;
    try {
      ok(await page.getByText("AI Condition Configuration").count() >= 1, "J15 renders in Condition mode (not Validator)");
      ok(await page.locator(".dropdown-trigger", { hasText: "Acceptance Criteria" }).count() > 0, "J15 field picker shows the seeded field (Acceptance Criteria)");
      const promptEl = page.locator("textarea").first();
      ok(/testable, measurable criterion/i.test(await promptEl.inputValue()), "J15 condition prompt hydrated from config");
      await promptEl.fill((await promptEl.inputValue()) + " Non-empty.");
      ok((await promptEl.inputValue()).includes("Non-empty."), "J15 condition prompt is editable");
      // Same dry-run Test flow as the validator.
      await page.locator("button.btn-semantic-test-toggle", { hasText: /Test/ }).click();
      await page.waitForSelector(".semantic-test-panel", { timeout: 8000 });
      await page.locator("input.issue-picker-input").fill("PROJ-42");
      await page.waitForSelector(".issue-picker-valid", { timeout: 8000 });
      await page.locator("button.btn-run-test", { hasText: "Run Test" }).click();
      await page.waitForSelector(".semantic-test-result", { timeout: 10000 });
      ok(await page.locator(".test-badge-pass, .test-badge-fail").count() >= 1, "J15 dry-run Test returns a verdict");
    } catch (e) { fail++; console.log("  ✗ J15 threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- J16 — PREMADE (zero-AI) rule editor ---------------- */
  {
    console.log("J16 premade rule editor (cfg-premade)");
    const env = await openEditor(browser, "config-ui", "cfg-premade");
    const { page } = env;
    try {
      // Premade mode: the catalog "Rule" picker hydrates to the saved ruleType.
      ok(await page.locator(".dropdown-trigger", { hasText: "Issue type is" }).count() > 0, "J16 Rule picker hydrated to the saved premade type (Issue type is…)");
      // Zero-AI: a premade rule has NO AI validation-prompt textarea.
      ok(await page.locator("textarea[placeholder*='makes the field value valid']").count() === 0, "J16 premade form shows NO AI validation prompt (zero-AI)");
      ok(await page.locator("select").count() === 0, "J16 no native <select> — custom dropdowns only");
      // The REST-backed issue-type picker lists options from getRuleLists (Bug/Task) and is selectable.
      const picker = page.locator(".dropdown-trigger", { hasText: "Choose an issue type" });
      ok(await picker.count() > 0, "J16 issue-type picker renders with its placeholder");
      await picker.first().click();
      await page.waitForSelector(".dropdown-panel", { timeout: 6000 });
      ok(await page.locator(".dropdown-panel .dropdown-item", { hasText: "Bug" }).count() > 0, "J16 picker lists getRuleLists options (Bug)");
      await page.locator(".dropdown-panel .dropdown-item", { hasText: "Bug" }).first().click();
      ok(await page.locator(".dropdown-trigger", { hasText: "Bug" }).count() > 0, "J16 selecting an issue type updates the picker");
    } catch (e) { fail++; console.log("  ✗ J16 threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- J18b — static-PF DRIVE: Regenerate + dry-run Test ---------------- */
  {
    console.log("J18b static-PF drive (regenerate + test run)");
    const env = await openEditor(browser, "config-ui", "cfg-static");
    const { page } = env;
    try {
      const firstBlock = page.locator(".function-block").first();
      // Seeded provenance on step 1: 2 memories.
      ok(/2 memor/i.test(await firstBlock.locator(".gmc-mem").first().innerText()), "J18b step 1 seeded with a '2 memories' provenance chip");
      // Regenerate → generatePostFunctionCode mock (appliedMemories:1) rewrites the provenance.
      await firstBlock.locator(".btn-generate", { hasText: "Regenerate Code" }).first().click();
      await firstBlock.locator(".gmc-mem", { hasText: "1 memor" }).first().waitFor({ timeout: 8000 });
      ok(true, "J18b Regenerate Code runs generatePostFunctionCode → provenance updates (2 → 1 memory)");
      // Dry-run Test Run → testPostFunction mock → a PASS with the proposed changes.
      await firstBlock.locator(".btn-test-run", { hasText: /Test Run/ }).click();
      await firstBlock.locator(".btn-run-test", { hasText: "Run Test" }).click();
      await firstBlock.locator(".test-result", { hasText: /PROJ-42|priority|updateIssue/i }).first().waitFor({ timeout: 10000 });
      ok(await firstBlock.locator(".test-result.test-pass").count() > 0, "J18b Test Run returns a PASS dry-run with proposed changes");
    } catch (e) { fail++; console.log("  ✗ J18b threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
  }
} finally {
  await browser.close();
}

console.log(`\nEDITOR JOURNEYS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
