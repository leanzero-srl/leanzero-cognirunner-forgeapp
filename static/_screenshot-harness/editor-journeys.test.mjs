/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
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

async function openEditor(browser, app, shot, theme = "light", extraInit = null) {
  const root = path.join(STATIC, app, "build-shot");
  if (!fs.existsSync(path.join(root, "index.html"))) throw new Error(`no build-shot for ${app} — build it first (webpack.screenshot.js)`);
  const { s, port } = await serve(root);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addInitScript(([sh, th, extra]) => {
    window.__SHOT__ = sh; window.__THEME__ = th;
    if (extra) for (const k in extra) window[k] = extra[k];
  }, [shot, theme, extraInit]);
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
  // App mounted into its root with no skeletons left (issue-glance uses .glance, not .container).
  const rootSel = app === "issue-glance" ? ".glance" : ".container";
  await page.waitForFunction((rs) => !!document.querySelector(rs) && !document.querySelector(rs + " .sk"), { timeout: 15000 }, rootSel).catch(() => {});
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
      ok(await page.getByText("Condition Configuration").count() >= 1, "J15 renders in Condition mode (not Validator)");
      // Conditions are evaluated by Jira as a Jira EXPRESSION — no network, so no AI,
      // permanently. The callout must explain that rather than the old (wrong) claim
      // that conditions are deprecated and unenforced. See F3 in test-harness/FINDINGS.md.
      ok(await page.getByText(/run without AI/i).count() > 0, "J15 callout explains conditions run without AI");
      ok(await page.getByText(/deprecated and are not enforced|has no effect/i).count() === 0, "J15 callout must NOT still call conditions deprecated/unenforced");
      ok(await page.getByText(/Validator/).count() > 0, "J15 callout points at a Validator for free-text judgement");
      // A condition can never be an AI rule, so the AI/premade TOGGLE must not exist.
      // (Assert the control, not the words — the conversion notice legitimately
      //  contains the phrase "AI prompt".)
      ok(await page.locator(".rulekind-toggle").count() === 0, "J15 does not offer the AI/premade rule-kind toggle for a condition");
      // The fixture is a condition saved by an older build, i.e. one carrying an AI
      // prompt that could never have run. It must be surfaced for conversion, not
      // silently dropped — and the editor must show the deterministic check picker.
      ok(await page.locator(".legacy-cond-prompt").count() === 1, "J15 surfaces the legacy AI prompt for conversion");
      ok(/testable, measurable criterion/i.test(await page.locator(".legacy-cond-prompt").innerText()), "J15 shows the ORIGINAL prompt text, not a placeholder");
      ok(await page.getByText(/never ran/i).count() > 0, "J15 says plainly that the old prompt never ran");
      // The deterministic check picker replaces the AI prompt box. No dry-run panel
      // here by design: there is no AI call to dry-run.
      ok(await page.locator(".pr-form, .dropdown-trigger").count() > 0, "J15 shows the deterministic check picker");
      ok(await page.locator("button.btn-semantic-test-toggle").count() === 0, "J15 offers no AI dry-run for a condition (nothing to run)");
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
      // it76: a passing dry-run stamps the step's tested-state chip (Untested → Tested ✓).
      await firstBlock.locator(".pf-test-chip.pf-test-pass").waitFor({ timeout: 6000 });
      ok(await firstBlock.locator(".pf-test-chip.pf-test-pass", { hasText: "Tested" }).count() > 0, "J18b step flips to 'Tested ✓' after a passing dry-run");
    } catch (e) { fail++; console.log("  ✗ J18b threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- J21 — KnowledgePanel (docs / skills / memories tabs) ---------------- */
  {
    console.log("J21 KnowledgePanel (cfg-static)");
    const env = await openEditor(browser, "config-ui", "cfg-static");
    const { page } = env;
    try {
      const kp = page.locator(".knowledge-panel").first();
      ok(await kp.count() > 0, "J21 KnowledgePanel renders on a static-PF step");
      // Collapsed by default — open it (robust to initial state).
      if (!(await kp.locator(".knowledge-tabs").isVisible().catch(() => false))) {
        await kp.locator(".knowledge-summary").click();
      }
      await kp.locator(".knowledge-tabs").waitFor({ timeout: 6000 });
      ok(await kp.locator(".knowledge-tab").count() >= 3, "J21 opens to 3 tabs (Documentation / Skills / Memories)");
      // Skills tab → seeded skills (getSkills mock).
      await kp.locator(".knowledge-tab-skills").click();
      await kp.getByText("Create a linked issue").first().waitFor({ timeout: 6000 });
      ok(true, "J21 Skills tab lists the seeded skills (getSkills)");
      // Memories tab → seeded memories (getMemories mock).
      await kp.locator(".knowledge-tab-memories").click();
      ok(await kp.getByText(/customfield_10003|resolution|Risk Level/i).count() > 0, "J21 Memories tab lists the seeded memories (getMemories)");
      // Documentation tab → seeded docs (getContextDocs mock).
      await kp.locator(".knowledge-tab-docs").click();
      ok(await kp.getByText("Jira Field Reference").count() > 0, "J21 Documentation tab lists the seeded docs (getContextDocs)");
    } catch (e) { fail++; console.log("  ✗ J21 threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- J20 — NL-to-rule ("Build from a description") ---------------- */
  {
    console.log("J20 NL-to-rule builder (cfg-premade)");
    const env = await openEditor(browser, "config-ui", "cfg-premade");
    const { page } = env;
    try {
      // The NL builder is collapsed by default — expand it.
      await page.locator("button.br-toggle", { hasText: "Build from a description" }).click();
      const nl = page.locator("textarea.br-input");
      await nl.waitFor({ timeout: 6000 });
      ok(true, "J20 'Build from a description' expands a plain-English input");
      await nl.fill("require the Description field to be filled in");
      // Build rule → buildRule mock → a reviewable draft card with the explanation.
      await page.locator("button.br-btn", { hasText: "Build rule" }).click();
      await page.locator(".br-card").waitFor({ timeout: 8000 });
      ok(await page.locator(".br-eyebrow", { hasText: /WHAT I BUILT/i }).count() > 0, "J20 Build produces a 'what I built' draft card");
      ok(/Blocks the transition unless the Description field/i.test(await page.locator(".br-summary").first().innerText()), "J20 the built rule's explanation renders");
    } catch (e) { fail++; console.log("  ✗ J20 threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- J18c — static-PF Fix-with-AI (fail → fix → verify) ---------------- */
  {
    console.log("J18c static-PF Fix-with-AI (cfg-static)");
    const env = await openEditor(browser, "config-ui", "cfg-static", "light", { __TESTFAIL_ONCE__: true });
    const { page } = env;
    try {
      const firstBlock = page.locator(".function-block").first();
      // Force a FAILING dry-run (one-shot: this first testPostFunction call fails).
      await firstBlock.locator(".btn-test-run", { hasText: /Test Run/ }).click();
      await firstBlock.locator(".btn-run-test", { hasText: "Run Test" }).click();
      await firstBlock.locator(".test-result.test-fail").waitFor({ timeout: 10000 });
      ok(await firstBlock.locator(".test-badge-fail", { hasText: "FAIL" }).count() > 0, "J18c dry-run FAILs on the seeded error");
      ok(await firstBlock.locator(".btn-fix-ai", { hasText: "Fix with AI" }).count() > 0, "J18c 'Fix with AI' is offered on a failed test");
      // Fix with AI → fixPostFunctionCode → apply → auto re-run (now passes) → verified.
      await firstBlock.locator(".btn-fix-ai", { hasText: "Fix with AI" }).click();
      await firstBlock.locator(".fix-result.fix-verified").waitFor({ timeout: 12000 });
      ok(true, "J18c fix applied + auto re-run PASSES → 'applied & verified'");
      ok(/Renamed the undefined/i.test(await firstBlock.locator(".fix-explanation").first().innerText()), "J18c the AI fix explanation renders");
    } catch (e) { fail++; console.log("  ✗ J18c threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- J22 — AI Review (ReviewPanel over the whole static PF) ---------------- */
  {
    console.log("J22 AI Review (cfg-static)");
    const env = await openEditor(browser, "config-ui", "cfg-static");
    const { page } = env;
    try {
      const btn = page.locator("button.btn-review", { hasText: "AI Review" });
      ok(await btn.count() > 0, "J22 AI Review button present");
      await btn.first().click();
      await page.locator(".review-result").waitFor({ timeout: 10000 });
      ok(/two improvements suggested/i.test(await page.locator(".review-verdict-text").first().innerText()), "J22 review verdict summary renders");
      ok(await page.locator(".review-item").count() >= 2, "J22 review findings (items) render");
    } catch (e) { fail++; console.log("  ✗ J22 threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- J19 — MANAGED semantic flavors (config-ui = read-only admin notice) ---------------- */
  {
    console.log("J19 managed semantic flavors (cfg-managed)");
    // In the config-ui workflow editor, managed flavors are NOT editable — the editor recognizes the
    // managed type and shows an "edit in the admin panel" notice (the flavor config forms live in the
    // admin AddRuleWizard, not config-ui). This verifies that recognition + notice across all 6 flavors.
    const FLAVORS = [
      { type: "postfunction-generate-doc", header: /Generate Document/i },
      { type: "postfunction-research", header: /Research & Save/i },
      { type: "postfunction-research-doc", header: /Research & Document/i },
      { type: "postfunction-comment", header: /Add Comment/i },
      { type: "postfunction-subtask", header: /Add Comment/i },
      { type: "postfunction-link", header: /Add Comment/i },
    ];
    for (const f of FLAVORS) {
      const env = await openEditor(browser, "config-ui", "cfg-managed", "light", { __MANAGED__: f.type });
      const { page } = env;
      try {
        await page.getByText(/configured in the/i).first().waitFor({ timeout: 8000 });
        ok(await page.getByText(/CogniRunner admin panel/i).count() > 0, `J19 ${f.type}: managed 'edit in admin' notice renders`);
        ok(await page.locator("h3", { hasText: f.header }).count() > 0, `J19 ${f.type}: correct flavor header`);
        ok(await page.locator('textarea[placeholder*="2-3 bullet points"]').count() === 0, `J19 ${f.type}: no editable semantic form (managed)`);
      } catch (e) { fail++; console.log(`  ✗ J19 ${f.type} threw: ` + e.message.split("\n")[0]); }
      await closeEditor(env);
    }
  }

  /* ---------------- E13 — dark theme renders the editor (house rule: both themes) ---------------- */
  {
    console.log("E13 dark theme (cfg-validator)");
    const env = await openEditor(browser, "config-ui", "cfg-validator", "dark");
    const { page } = env;
    try {
      const mode = await page.evaluate(() => document.documentElement.getAttribute("data-color-mode"));
      ok(mode === "dark", "E13 documentElement is in dark mode");
      ok(await page.locator(".dropdown-trigger", { hasText: "Description" }).count() > 0, "E13 the editor still renders (no white-screen) in dark mode");
    } catch (e) { fail++; console.log("  ✗ E13 threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- E4 — KnowledgePanel load failure → error + Retry ---------------- */
  {
    console.log("E4 KnowledgePanel load failure + Retry");
    // Docs tab is the default → getContextDocs failing shows the load-error immediately.
    {
      const env = await openEditor(browser, "config-ui", "cfg-static", "light", { __FAIL__: ["getContextDocs"] });
      const { page } = env;
      try {
        const kp = page.locator(".knowledge-panel").first();
        if (!(await kp.locator(".knowledge-tabs").isVisible().catch(() => false))) await kp.locator(".knowledge-summary").click();
        await kp.locator(".knowledge-tab-docs").click();
        await kp.locator(".load-error").first().waitFor({ timeout: 8000 });
        ok(await kp.getByText(/Couldn.t load documents/i).count() > 0, "E4 Documentation load failure shows the error");
        ok(await kp.locator(".btn-retry", { hasText: "Retry" }).count() > 0, "E4 Documentation load failure offers Retry");
      } catch (e) { fail++; console.log("  ✗ E4 docs threw: " + e.message.split("\n")[0]); }
      await closeEditor(env);
    }
    // Skills tab failing → its own load-error + Retry (not a bare "no skills" empty state).
    {
      const env = await openEditor(browser, "config-ui", "cfg-static", "light", { __FAIL__: ["getSkills"] });
      const { page } = env;
      try {
        const kp = page.locator(".knowledge-panel").first();
        if (!(await kp.locator(".knowledge-tabs").isVisible().catch(() => false))) await kp.locator(".knowledge-summary").click();
        await kp.locator(".knowledge-tab-skills").click();
        await kp.locator(".load-error").first().waitFor({ timeout: 8000 });
        ok(await kp.locator(".btn-retry", { hasText: "Retry" }).count() > 0, "E4 Skills load failure shows load-error + Retry");
      } catch (e) { fail++; console.log("  ✗ E4 skills threw: " + e.message.split("\n")[0]); }
      await closeEditor(env);
    }
  }

  /* ---------------- E1 — no provider key → amber warning on the form ---------------- */
  {
    console.log("E1 no-key provider warning (cfg-validator)");
    const env = await openEditor(browser, "config-ui", "cfg-validator", "light", { __NOKEY__: true });
    const { page } = env;
    try {
      await page.locator(".provider-warning").first().waitFor({ timeout: 8000 });
      ok(await page.locator(".provider-warning", { hasText: /No AI provider key is set up/i }).count() > 0, "E1 the no-key provider warning renders on the AI validator form");
    } catch (e) { fail++; console.log("  ✗ E1 threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- E2 — premade picker list-load failure → error + Retry ---------------- */
  {
    console.log("E2 getRuleLists failure + Retry (cfg-premade)");
    const env = await openEditor(browser, "config-ui", "cfg-premade", "light", { __FAIL__: ["getRuleLists"] });
    const { page } = env;
    try {
      await page.getByText(/Couldn.t load options/i).first().waitFor({ timeout: 8000 });
      ok(await page.getByText(/Couldn.t load options/i).count() > 0, "E2 getRuleLists failure shows 'Couldn't load options' on the picker");
      ok(await page.locator(".btn-retry", { hasText: "Retry" }).count() > 0, "E2 offers Retry for the failed picker list");
    } catch (e) { fail++; console.log("  ✗ E2 threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- E3 — field-list load failure → manual field-id entry ---------------- */
  {
    console.log("E3 getFields failure → manual entry (cfg-validator)");
    const env = await openEditor(browser, "config-ui", "cfg-validator", "light", { __FAIL__: ["getFields", "getScreenFields"] });
    const { page } = env;
    try {
      await page.getByText(/Could not load fields/i).first().waitFor({ timeout: 8000 });
      ok(await page.getByText(/Enter field ID manually/i).count() > 0, "E3 field-load failure prompts manual field-id entry");
      ok(await page.locator('input[placeholder*="customfield_10001"]').count() > 0, "E3 a manual field-id text input is offered");
    } catch (e) { fail++; console.log("  ✗ E3 threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- E5 — empty knowledge states (no docs / skills / memories) ---------------- */
  {
    console.log("E5 empty knowledge states (cfg-static)");
    const env = await openEditor(browser, "config-ui", "cfg-static", "light", { __EMPTY__: true });
    const { page } = env;
    try {
      const kp = page.locator(".knowledge-panel").first();
      if (!(await kp.locator(".knowledge-tabs").isVisible().catch(() => false))) await kp.locator(".knowledge-summary").click();
      await kp.locator(".knowledge-tab-docs").click();
      ok(await kp.getByText(/No documents yet/i).count() > 0, "E5 Documentation empty-state copy");
      await kp.locator(".knowledge-tab-skills").click();
      ok(await kp.getByText(/No skills yet/i).count() > 0, "E5 Skills empty-state copy");
      await kp.locator(".knowledge-tab-memories").click();
      ok(await kp.getByText(/No memories yet/i).count() > 0, "E5 Memories empty-state copy");
    } catch (e) { fail++; console.log("  ✗ E5 threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- E12 — keyboard-only CustomSelect operation ---------------- */
  {
    console.log("E12 keyboard-only CustomSelect (cfg-validator agentic select)");
    const env = await openEditor(browser, "config-ui", "cfg-validator");
    const { page } = env;
    try {
      // The "Jira Search (JQL)" agentic CustomSelect (seeded "Auto-detect from prompt").
      const trigger = page.locator(".dropdown-trigger", { hasText: "Auto-detect from prompt" }).first();
      await trigger.focus();
      await page.keyboard.press("Enter"); // open via keyboard
      await page.locator(".dropdown-panel").first().waitFor({ timeout: 6000 });
      ok(true, "E12 CustomSelect opens via keyboard (Enter)");
      await page.keyboard.press("End");   // highlight last option
      await page.keyboard.press("Enter"); // select the highlighted option
      await page.locator(".dropdown-trigger", { hasText: "Always disabled" }).first().waitFor({ timeout: 6000 });
      ok(await page.locator(".dropdown-trigger", { hasText: "Always disabled" }).count() > 0, "E12 keyboard nav (End→Enter) selects an option — no mouse");
    } catch (e) { fail++; console.log("  ✗ E12 threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- J19-admin — the 6 MANAGED flavor CONFIG forms (admin AddRuleWizard) ---------------- */
  {
    console.log("J19-admin managed flavor config forms (admin AddRuleWizard)");
    // The full flavor config UIs live in the ADMIN panel (config-ui only shows a notice — see J19). Drive
    // the AddRuleWizard project→workflow→transition→type→config and assert each flavor's config component
    // renders its distinctive field.
    const ADMIN_FLAVORS = [
      { type: "Add Comment", field: /Comment instructions/i },
      { type: "Create Sub-task", field: /Sub-task instructions/i },
      { type: "Generate Document", field: /Document instructions/i },
      { type: "Research & Save", field: /Research query/i },
      { type: "Research & Document", field: /Research sources/i },
      { type: "Link Related Issues", field: /Relation criteria/i },
    ];
    for (const f of ADMIN_FLAVORS) {
      const env = await openEditor(browser, "admin-panel", "admin");
      const { page } = env;
      try {
        await page.locator("button", { hasText: /Add Rule/ }).first().click();
        const wiz = page.locator(".wizard");
        await wiz.waitFor({ timeout: 10000 });
        await wiz.locator("button", { hasText: "Demo Project" }).first().click();
        await wiz.locator("button", { hasText: "Software Simplified Workflow" }).first().click();
        await wiz.locator("button", { hasText: "Submit for Review" }).first().click();
        await wiz.locator("button", { hasText: f.type }).first().click();
        await wiz.getByText(f.field).first().waitFor({ timeout: 8000 });
        ok(await wiz.getByText(f.field).count() > 0, `J19-admin "${f.type}" → its config form renders`);
      } catch (e) { fail++; console.log(`  ✗ J19-admin ${f.type} threw: ` + e.message.split("\n")[0]); }
      await closeEditor(env);
    }
  }

  /* ---------------- J8 — AddRuleWizard non-managed rule types (static + semantic config) ---------------- */
  {
    console.log("J8 AddRuleWizard non-managed types (admin)");
    const ADMIN_TYPES = [
      { type: "Static Post Function", marker: ".function-block", label: "static → FunctionBuilder" },
      { type: "Semantic Post Function", marker: 'textarea[placeholder*="2-3 bullet points"]', label: "semantic → SemanticConfig" },
    ];
    for (const t of ADMIN_TYPES) {
      const env = await openEditor(browser, "admin-panel", "admin");
      const { page } = env;
      try {
        await page.locator("button", { hasText: /Add Rule/ }).first().click();
        const wiz = page.locator(".wizard");
        await wiz.waitFor({ timeout: 10000 });
        await wiz.locator("button", { hasText: "Demo Project" }).first().click();
        await wiz.locator("button", { hasText: "Software Simplified Workflow" }).first().click();
        await wiz.locator("button", { hasText: "Submit for Review" }).first().click();
        await wiz.locator("button", { hasText: t.type }).first().click();
        await wiz.locator(t.marker).first().waitFor({ timeout: 8000 });
        ok(await wiz.locator(t.marker).count() > 0, `J8 "${t.type}" → its config renders at step 5 (${t.label})`);
      } catch (e) { fail++; console.log(`  ✗ J8 ${t.type} threw: ` + e.message.split("\n")[0]); }
      await closeEditor(env);
    }
  }

  /* ---------------- HealthChip — admin Settings connection test (it78) ---------------- */
  {
    console.log("HealthChip admin Settings Test connection");
    const env = await openEditor(browser, "admin-panel", "admin");
    const { page } = env;
    try {
      await page.locator(".tab-btn", { hasText: /^\s*Settings\s*$/ }).first().click();
      const testBtn = page.locator("button", { hasText: "Test connection" });
      await testBtn.first().waitFor({ timeout: 12000 });
      ok(await testBtn.count() > 0, "HealthChip: Settings shows a 'Test connection' button");
      await testBtn.first().click();
      await page.locator(".hc-chip.hc-ok", { hasText: "Connected" }).first().waitFor({ timeout: 8000 });
      ok(await page.locator(".hc-chip.hc-ok", { hasText: "Connected" }).count() > 0, "HealthChip: Test connection → 'Connected' verdict chip (checkProviderHealth)");
    } catch (e) { fail++; console.log("  ✗ HealthChip threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- E10 — rule import preview (needs-rebind / notes) ---------------- */
  {
    console.log("E10 rule import preview (admin RulePortabilityDialog)");
    const env = await openEditor(browser, "admin-panel", "admin");
    const { page } = env;
    try {
      await page.locator("button", { hasText: "Export / Import" }).first().click();
      const dlg = page.locator(".port-dialog");
      await dlg.waitFor({ timeout: 8000 });
      await dlg.locator("button.port-tab", { hasText: "Import" }).click();
      await dlg.locator("textarea.port-textarea").fill('{"rules":[{},{},{}]}');
      await dlg.locator("button", { hasText: "Preview import" }).click();
      await dlg.locator(".port-plan").waitFor({ timeout: 8000 });
      ok(await dlg.getByText(/Import plan \(3 rule/i).count() > 0, "E10 import preview shows a 3-rule dry-run plan");
      ok(await dlg.locator(".port-status", { hasText: "NEEDS REBIND" }).count() > 0, "E10 a needs-rebind row is flagged");
      ok(await dlg.locator(".port-status", { hasText: /^READY$/ }).count() >= 2, "E10 the ready rows are flagged READY");
      ok(await dlg.getByText(/Steps to Reproduce|Internal Orders API/i).count() > 0, "E10 the plan surfaces the rebind/dropped-doc note");
    } catch (e) { fail++; console.log("  ✗ E10 threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- E11 — offloaded static rule (config-view, functionsMeta name-only) ---------------- */
  {
    console.log("E11 offloaded static rule (config-view)");
    const env = await openEditor(browser, "config-view", "view-static-offloaded");
    const { page } = env;
    try {
      // An offloaded static PF carries functions:[] + name-only functionsMeta. config-view must render the
      // step NAMES from functionsMeta (never the full details, which live in the pf_code bundle).
      await page.getByText(/function block/i).first().waitFor({ timeout: 10000 });
      ok(await page.getByText(/2 function blocks/i).count() > 0, "E11 offloaded rule shows its step count from functionsMeta");
      ok(await page.getByText("Escalate priority to High").count() > 0, "E11 step 1 name renders from functionsMeta");
      ok(await page.getByText("Add on-call watcher").count() > 0, "E11 step 2 name renders from functionsMeta");
    } catch (e) { fail++; console.log("  ✗ E11 threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- J23 — config-view read-only rule summary + execution logs ---------------- */
  {
    console.log("J23 config-view rule summary + logs (view-active)");
    const env = await openEditor(browser, "config-view", "view-active");
    const { page } = env;
    try {
      ok(await page.getByText(/customer impact and a rollback plan/i).count() > 0, "J23 config-view renders the read-only rule summary (validator prompt)");
      await page.locator("button", { hasText: /Show Logs/i }).first().click();
      await page.locator(".log-entry").first().waitFor({ timeout: 8000 });
      ok(await page.locator(".log-entry").count() > 0, "J23 Show Logs renders execution-log entries");
      ok(await page.getByText(/PROJ-481|PROJ-479|PROJ-512/).count() > 0, "J23 log entries show real issue keys + reasons");
    } catch (e) { fail++; console.log("  ✗ J23 threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- J24 — jira:issueContext "CogniRunner on this issue" glance ---------------- */
  {
    console.log("J24 issue-context glance (issue-glance)");
    const env = await openEditor(browser, "issue-glance", "issue-glance");
    const { page } = env;
    try {
      await page.locator(".glance-item").first().waitFor({ timeout: 8000 });
      ok(await page.getByText(/CogniRunner on this issue/i).count() > 0, "J24 glance header renders");
      ok(await page.locator(".glance-item").count() === 4, "J24 renders all 4 activity items from getIssueActivity");
      ok(await page.locator(".glance-badge.g-block", { hasText: "Blocked" }).count() > 0, "J24 blocked validator → g-block badge WITH glyph+label (status not colour-alone)");
      ok(await page.locator(".glance-badge.g-ok").count() >= 2, "J24 passing rows → g-ok badges");
      ok(await page.locator(".glance-badge.g-skip", { hasText: "Skipped" }).count() > 0, "J24 skipped row → g-skip badge");
      ok(await page.getByText(/acceptance criteria/i).count() > 0, "J24 the AI reason renders on the card");
      ok(await page.getByText(/ago/).count() > 0, "J24 relative timestamps render");
      const kinds = await page.locator(".glance-kind").allTextContents();
      ok(kinds.includes("Post-function"), "J24 kind label is humanized ('Post-function', not the raw 'post-function' enum)");
    } catch (e) { fail++; console.log("  ✗ J24 threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- E14 — issue-glance honest empty state ---------------- */
  {
    console.log("E14 issue-glance empty state (issue-glance-empty)");
    const env = await openEditor(browser, "issue-glance", "issue-glance-empty");
    const { page } = env;
    try {
      await page.getByText(/No CogniRunner activity recorded/i).waitFor({ timeout: 8000 });
      ok(await page.getByText(/No CogniRunner activity recorded/i).count() > 0, "E14 empty issue → honest empty state");
      ok(await page.locator(".glance-item").count() === 0, "E14 no activity items rendered");
    } catch (e) { fail++; console.log("  ✗ E14 threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- E16 — issue-glance error state (getIssueActivity fails) ---------------- */
  {
    console.log("E16 issue-glance error state");
    const env = await openEditor(browser, "issue-glance", "issue-glance", "light", { __FAIL__: ["getIssueActivity"] });
    const { page } = env;
    try {
      await page.locator(".glance-err").waitFor({ timeout: 10000 });
      ok(await page.locator(".glance-err").count() > 0, "E16 getIssueActivity failure → honest error state (.glance-err)");
      ok(await page.locator(".glance-item").count() === 0, "E16 no activity items on error");
    } catch (e) { fail++; console.log("  ✗ E16 threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- E17 — issue-glance loading state (activity never resolves) ---------------- */
  {
    console.log("E17 issue-glance loading state");
    const env = await openEditor(browser, "issue-glance", "issue-glance-loading");
    const { page } = env;
    try {
      await page.locator(".glance-spinner").waitFor({ timeout: 10000 });
      ok(await page.locator(".glance-spinner").count() > 0, "E17 pending activity → loading spinner");
      ok(await page.locator(".glance-item").count() === 0, "E17 no items while loading");
    } catch (e) { fail++; console.log("  ✗ E17 threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- J25 — config-view → admin UI-intent handoff (Altomata #10) ---------------- */
  {
    console.log("J25 config-view Open-in-admin handoff (view-active)");
    const env = await openEditor(browser, "config-view", "view-active");
    const { page } = env;
    try {
      const btn = page.locator("button", { hasText: /Open in admin/i }).first();
      await btn.waitFor({ timeout: 8000 });
      ok(await btn.count() > 0, "J25 config-view shows an 'Open in admin →' button for the rule");
      await btn.click();
      await page.waitForFunction(() => window.__SET_INTENT__ && Array.isArray(window.__ROUTER_CALLS__) && window.__ROUTER_CALLS__.length > 0, null, { timeout: 5000 });
      const intent = await page.evaluate(() => window.__SET_INTENT__);
      const calls = await page.evaluate(() => window.__ROUTER_CALLS__);
      ok(intent && intent.tab === "rules" && !!intent.ruleId, "J25 click stashes a { tab:'rules', ruleId } intent via setUiIntent");
      ok(calls.some((c) => c.fn === "navigate" && c.arg && c.arg.moduleKey === "cognirunner-global-page"), "J25 click navigates to the admin global-page module");
    } catch (e) { fail++; console.log("  ✗ J25 threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- E15 — admin consumes a pending UI-intent on mount ---------------- */
  {
    console.log("E15 admin consumes UI-intent on mount (opens Settings)");
    const env = await openEditor(browser, "admin-panel", "admin", "light", { __PENDING_INTENT__: { tab: "settings" } });
    const { page } = env;
    try {
      // The admin init effect calls takeUiIntent → setActiveTab('settings') with NO click.
      await page.locator("button", { hasText: "Test connection" }).first().waitFor({ timeout: 12000 });
      ok(await page.locator("button", { hasText: "Test connection" }).count() > 0, "E15 a pending {tab:'settings'} intent auto-opens the Settings tab on mount (no click)");
    } catch (e) { fail++; console.log("  ✗ E15 threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
  }
} finally {
  await browser.close();
}

console.log(`\nEDITOR JOURNEYS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
