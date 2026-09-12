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
 * No prereq build: the suite rebuilds each app's build-shot itself when it is
 * missing or older than src/ (lib/build-shot.mjs, F-125).
 * Run:    node static/_screenshot-harness/editor-journeys.test.mjs
 */
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureFreshBuildShot } from "./lib/build-shot.mjs";

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
  const root = ensureFreshBuildShot(app); // F-125: never serve a bundle older than src/
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
      await firstBlock.locator(".fix-result:has(.fix-undo-bar).fix-verified").waitFor({ timeout: 12000 });
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


  /* ---------------- F-129 — a Stop-all CANCEL is not a generation FAILURE ---------------- */
  // getAsyncTaskResult reports an operator/tenant Stop-all as
  //   { status: "error", error: "Cancelled", cancelled: true }
  // — the literal string "Cancelled" in the `error` field, NOT status "cancelled"
  // (JobsTab F-122 documents the same contract). Before this fix only JobsTab read the
  // `cancelled` flag, so FunctionBlock (generate + fix), SkillEditor (distill) and
  // ReviewPanel (review) all fell through to their red error arms and told the user the
  // AI had FAILED — and FunctionBlock additionally clobbered the editor with a generic
  // template. A cancel must be neutral slate and must leave editor state untouched.
  const CANCEL_TEXT = /Cancelled — nothing was changed/;
  const SLATE = { light: "rgb(71, 85, 105)", dark: "rgb(100, 116, 139)" };
  const noteBg = (scope) => scope.evaluate(() => {
    const el = document.querySelector(".async-cancelled-note");
    return el ? getComputedStyle(el).backgroundColor : null;
  });

  for (const theme of ["light", "dark"]) {
    const T = theme.toUpperCase();

    /* F-129a — FunctionBlock GENERATE cancelled */
    {
      console.log(`F-129a static-PF generate cancelled (cfg-static, ${theme})`);
      const env = await openEditor(browser, "config-ui", "cfg-static", theme, { __ASYNC_CANCEL__: true });
      const { page } = env;
      try {
        const b = page.locator(".function-block").first();
        // Seeded provenance is "2 memories" (J18b). A cancel must NOT rewrite it.
        ok(/2 memor/i.test(await b.locator(".gmc-mem").first().innerText()), `F-129a ${T} step 1 starts on the seeded 2-memory provenance`);
        await b.locator(".btn-generate", { hasText: "Regenerate Code" }).first().click();
        await b.locator(".async-cancelled-note").waitFor({ timeout: 12000 });
        ok(CANCEL_TEXT.test(await b.locator(".async-cancelled-note").first().innerText()), `F-129a ${T} generate shows the neutral cancelled note`);
        ok(await noteBg(page) === SLATE[theme], `F-129a ${T} cancelled note is slate ${SLATE[theme]}, not red`);
        // The red "AI generation failed / generic template inserted" banner must NOT appear.
        ok(await page.getByText("AI generation failed").count() === 0, `F-129a ${T} no red 'AI generation failed' banner on a cancel`);
        // Editor state untouched: provenance still the seeded 2 memories, no template swap.
        ok(/2 memor/i.test(await b.locator(".gmc-mem").first().innerText()), `F-129a ${T} a cancel leaves the generated code + provenance untouched`);
      } catch (e) { fail++; console.log(`  ✗ F-129a ${T} threw: ` + e.message.split("\n")[0]); }
      await closeEditor(env);
    }

    /* F-129b — FunctionBlock FIX-WITH-AI cancelled */
    {
      console.log(`F-129b static-PF fix cancelled (cfg-static, ${theme})`);
      const env = await openEditor(browser, "config-ui", "cfg-static", theme, { __TESTFAIL_ONCE__: true, __ASYNC_CANCEL__: true });
      const { page } = env;
      try {
        const b = page.locator(".function-block").first();
        await b.locator(".btn-test-run", { hasText: /Test Run/ }).click();
        await b.locator(".btn-run-test", { hasText: "Run Test" }).click();
        await b.locator(".test-result.test-fail").waitFor({ timeout: 10000 });
        await b.locator(".btn-fix-ai", { hasText: "Fix with AI" }).click();
        await b.locator(".async-cancelled-note").waitFor({ timeout: 12000 });
        ok(CANCEL_TEXT.test(await b.locator(".async-cancelled-note").first().innerText()), `F-129b ${T} fix shows the neutral cancelled note`);
        ok(await noteBg(page) === SLATE[theme], `F-129b ${T} cancelled note is slate ${SLATE[theme]}, not red`);
        // The failing dry-run must survive intact, with no "AI fix failed" appended to it,
        // and no fix-result card — nothing was changed, so there is nothing to undo.
        ok(await b.locator(".test-result.test-fail").count() > 0, `F-129b ${T} the original failing dry-run is preserved`);
        ok(await page.getByText("AI fix failed").count() === 0, `F-129b ${T} no red 'AI fix failed' on a cancel`);
        ok(await b.locator(".fix-result").count() === 0, `F-129b ${T} no fix-result card — the code was not replaced`);
      } catch (e) { fail++; console.log(`  ✗ F-129b ${T} threw: ` + e.message.split("\n")[0]); }
      await closeEditor(env);
    }

    /* F-129c — SkillEditor DISTILL ("Let AI write it") cancelled */
    {
      console.log(`F-129c skill distill cancelled (cfg-static, ${theme})`);
      const env = await openEditor(browser, "config-ui", "cfg-static", theme, { __ASYNC_CANCEL__: true });
      const { page } = env;
      try {
        const b = page.locator(".function-block").first();
        // Save as Skill is only offered on a PASSING dry-run — run one first.
        await b.locator(".btn-test-run", { hasText: /Test Run/ }).click();
        await b.locator(".btn-run-test", { hasText: "Run Test" }).click();
        await b.locator(".test-result.test-pass").waitFor({ timeout: 10000 });
        await b.locator(".btn-save-skill", { hasText: "Save as Skill" }).click();
        const form = b.locator(".doc-add-form").first();
        await form.waitFor({ timeout: 8000 });
        const name = form.locator("input.input").first();
        const before = await name.inputValue();
        await form.locator(".btn-add-doc", { hasText: "Let AI write it" }).click();
        await form.locator(".async-cancelled-note").waitFor({ timeout: 12000 });
        ok(CANCEL_TEXT.test(await form.locator(".async-cancelled-note").first().innerText()), `F-129c ${T} distill shows the neutral cancelled note`);
        ok(await noteBg(page) === SLATE[theme], `F-129c ${T} cancelled note is slate ${SLATE[theme]}, not red`);
        ok(await form.locator(".doc-error").count() === 0, `F-129c ${T} no red .doc-error on a cancel`);
        // The editor stays open on its pre-fill so the user can just retry.
        ok(await name.inputValue() === before, `F-129c ${T} the skill form keeps its pre-filled values`);
      } catch (e) { fail++; console.log(`  ✗ F-129c ${T} threw: ` + e.message.split("\n")[0]); }
      await closeEditor(env);
    }

    /* F-129d — ReviewPanel AI REVIEW cancelled, in BOTH divergent copies.
       config-ui's ReviewPanel lives in the static-PF FunctionBuilder; admin-panel's is
       reached through AddRuleWizard step 5 (same path J8 walks). They are deliberately
       NOT byte-identical, so each is asserted on its own build. */
    {
      console.log(`F-129d AI review cancelled (config-ui, ${theme})`);
      const env = await openEditor(browser, "config-ui", "cfg-static", theme, { __ASYNC_CANCEL__: true });
      const { page } = env;
      try {
        await page.locator("button.btn-review", { hasText: "AI Review" }).first().click();
        await page.locator(".async-cancelled-note").waitFor({ timeout: 12000 });
        ok(CANCEL_TEXT.test(await page.locator(".async-cancelled-note").first().innerText()), `F-129d ${T} config-ui review shows the neutral cancelled note`);
        ok(await noteBg(page) === SLATE[theme], `F-129d ${T} config-ui cancelled note is slate ${SLATE[theme]}, not red`);
        ok(await page.locator(".review-verdict").count() === 0, `F-129d ${T} config-ui no red review verdict card on a cancel`);
      } catch (e) { fail++; console.log(`  ✗ F-129d ${T} config-ui threw: ` + e.message.split("\n")[0]); }
      await closeEditor(env);
    }
    {
      console.log(`F-129d AI review cancelled (admin-panel, ${theme})`);
      const env = await openEditor(browser, "admin-panel", "admin", theme, { __ASYNC_CANCEL__: true });
      const { page } = env;
      try {
        await page.locator("button", { hasText: /Add Rule/ }).first().click();
        const wiz = page.locator(".wizard");
        await wiz.waitFor({ timeout: 10000 });
        await wiz.locator("button", { hasText: "Demo Project" }).first().click();
        await wiz.locator("button", { hasText: "Software Simplified Workflow" }).first().click();
        await wiz.locator("button", { hasText: "Submit for Review" }).first().click();
        await wiz.locator("button", { hasText: "Static Post Function" }).first().click();
        await wiz.locator(".function-block").first().waitFor({ timeout: 8000 });
        await wiz.locator("button.btn-review", { hasText: "AI Review" }).first().click();
        await wiz.locator(".async-cancelled-note").waitFor({ timeout: 12000 });
        ok(CANCEL_TEXT.test(await wiz.locator(".async-cancelled-note").first().innerText()), `F-129d ${T} admin-panel review shows the neutral cancelled note`);
        ok(await noteBg(page) === SLATE[theme], `F-129d ${T} admin-panel cancelled note is slate ${SLATE[theme]}, not red`);
        ok(await wiz.locator(".review-verdict").count() === 0, `F-129d ${T} admin-panel no red review verdict card on a cancel`);
      } catch (e) { fail++; console.log(`  ✗ F-129d ${T} admin-panel threw: ` + e.message.split("\n")[0]); }
      await closeEditor(env);
    }
  }
  /* ---------------- F-133 — a FAILED regenerate must never replace existing code ---------------- */
  // Before this fix, EVERY non-cancel generate failure (provider 500, poll exhaustion,
  // timeout, network) ran the same `else` arm: overwrite the author's code with a generic
  // local template, null the provenance, drop the dry-run verdict — with no undo (the
  // undo bar is fix-only). Hours of tested work, gone to a transient 500.
  // The template fallback keeps its ORIGINAL purpose: a FIRST generate on an empty step.
  // __FAIL__ = ["generatePostFunctionCode"] makes the resolver reject (the catch arm).
  const FIXTURE_CODE = /Find all issues in this project with a similar summary/;
  const KEPT_TEXT = /Generation failed — your existing code was kept/;
  const RED = { light: "rgb(220, 38, 38)", dark: "rgb(239, 68, 68)" };
  const errBg = (scope) => scope.evaluate(() => {
    const el = document.querySelector(".async-error-note");
    return el ? getComputedStyle(el).backgroundColor : null;
  });

  for (const theme of ["light", "dark"]) {
    const T = theme.toUpperCase();

    /* F-133a — step HAS code (and a PASS): failure keeps code, provenance and verdict */
    {
      console.log(`F-133a generate failure keeps existing code (cfg-static, ${theme})`);
      const env = await openEditor(browser, "config-ui", "cfg-static", theme, { __FAIL__: ["generatePostFunctionCode"] });
      const { page } = env;
      try {
        const b = page.locator(".function-block").first();
        // Earn a real PASS first, so we can prove the verdict survives too.
        await b.locator(".btn-test-run", { hasText: /Test Run/ }).click();
        await b.locator(".btn-run-test", { hasText: "Run Test" }).click();
        await b.locator(".test-result.test-pass").waitFor({ timeout: 10000 });
        ok(await b.locator(".pf-test-chip.pf-test-pass").count() > 0, `F-133a ${T} step is 'Tested ✓' before the failed regenerate`);
        const codeBefore = await b.locator(".cm-content").first().innerText();
        ok(FIXTURE_CODE.test(codeBefore), `F-133a ${T} the editor starts on the author's seeded code`);

        await b.locator(".btn-generate", { hasText: "Regenerate Code" }).first().click();
        await b.locator(".async-error-note").waitFor({ timeout: 12000 });

        ok(KEPT_TEXT.test(await b.locator(".async-error-note").first().innerText()), `F-133a ${T} shows the 'your existing code was kept' note`);
        ok(await errBg(page) === RED[theme], `F-133a ${T} the kept-code note is solid red ${RED[theme]}`);
        ok(await b.locator(".async-error-note .aen-retry", { hasText: "Retry" }).count() > 0, `F-133a ${T} the note offers a Retry affordance`);
        // THE defect: the code must be byte-for-byte what it was.
        ok(await b.locator(".cm-content").first().innerText() === codeBefore, `F-133a ${T} the author's code is UNCHANGED after a failed regenerate`);
        ok(await page.getByText("A generic template was inserted").count() === 0, `F-133a ${T} no generic template was inserted`);
        // Provenance and the dry-run verdict belong to code we kept — they must stand.
        ok(/2 memor/i.test(await b.locator(".gmc-mem").first().innerText()), `F-133a ${T} the seeded provenance chips survive the failure`);
        ok(await b.locator(".test-result.test-pass").count() > 0, `F-133a ${T} the passing dry-run verdict survives the failure`);
        ok(await b.locator(".pf-test-chip.pf-test-pass").count() > 0, `F-133a ${T} the step is still 'Tested ✓' — the verdict still fits the code`);
      } catch (e) { fail++; console.log(`  ✗ F-133a ${T} threw: ` + e.message.split("\n")[0]); }
      await closeEditor(env);
    }

    /* F-133b — step has NO code: the local template fallback is still correct */
    {
      console.log(`F-133b first generate failure falls back to template (cfg-static, ${theme})`);
      const env = await openEditor(browser, "config-ui", "cfg-static", theme, { __FAIL__: ["generatePostFunctionCode"], __STEP_NO_CODE__: true });
      const { page } = env;
      try {
        const b = page.locator(".function-block").first();
        ok(await b.locator(".btn-generate", { hasText: "Generate Code" }).count() > 0, `F-133b ${T} an empty step offers 'Generate Code' (no code yet)`);
        await b.locator(".btn-generate", { hasText: "Generate Code" }).first().click();
        await page.getByText("A generic template was inserted").first().waitFor({ timeout: 12000 });
        ok(true, `F-133b ${T} a first generate that fails still inserts the generic template`);
        ok(await b.locator(".async-error-note").count() === 0, `F-133b ${T} no 'code was kept' note — there was no code to keep`);
        const code = await b.locator(".cm-content").first().innerText();
        ok(code.trim().length > 0, `F-133b ${T} the user is not left with an empty editor`);
        ok(!FIXTURE_CODE.test(code), `F-133b ${T} what landed is the template, not the other step's code`);
      } catch (e) { fail++; console.log(`  ✗ F-133b ${T} threw: ` + e.message.split("\n")[0]); }
      await closeEditor(env);
    }
  }

  /* ---------------- F-141 — generate and fix are mutually exclusive on a step ---------------- */
  // F-133 gave a failed regenerate a red "your existing code was kept" note with a Retry
  // button, and (correctly) stopped clearing the dry-run verdict — so the FAILING verdict
  // and its "Fix with AI" button survive the failed generate and sit on screen next to
  // Retry. Retry, unlike its cancelled-note sibling, carried no `!fixing` guard and
  // handleGenerate had no in-flight check, so both affordances were live at once: pressing
  // Retry mid-fix bumped the generation token, silently abandoned the fix whose provider
  // attempt was already charged, and left the step with neither result.
  // ONE RULE: while an AI write to a step's code is in flight, no other one may start.
  // __HOLD__ parks fixPostFunctionCode in flight until __RELEASE_HOLD__() is called.
  for (const theme of ["light", "dark"]) {
    const T = theme.toUpperCase();
    console.log(`F-141 Retry is withheld while a fix is in flight (cfg-static, ${theme})`);
    const env = await openEditor(browser, "config-ui", "cfg-static", theme, {
      __TESTFAIL_ONCE__: true,
      __FAIL__: ["generatePostFunctionCode"],
      __HOLD__: ["fixPostFunctionCode"],
    });
    const { page } = env;
    try {
      const b = page.locator(".function-block").first();
      const retry = b.locator(".async-error-note .aen-retry");

      // Earn a FAILING dry-run, then fail a regenerate on top of it — this is the exact
      // state F-133 created, with the failing verdict (and its Fix button) still standing.
      await b.locator(".btn-test-run", { hasText: /Test Run/ }).click();
      await b.locator(".btn-run-test", { hasText: "Run Test" }).click();
      await b.locator(".test-result.test-fail").waitFor({ timeout: 10000 });
      await b.locator(".btn-generate", { hasText: "Regenerate Code" }).first().click();
      await b.locator(".async-error-note").waitFor({ timeout: 12000 });
      ok(await retry.count() === 1, `F-141 ${T} Retry is offered while nothing is in flight`);
      ok(await b.locator(".btn-fix-ai").count() === 1, `F-141 ${T} the failing verdict still offers Fix with AI (F-133 kept it)`);

      // Start the fix and park it in flight.
      await b.locator(".btn-fix-ai", { hasText: "Fix with AI" }).click();
      await page.waitForFunction(() => typeof window.__RELEASE_HOLD__ === "function", { timeout: 10000 });

      // THE defect: the kept-code note must still be there (nothing resolved it), but its
      // Retry must not be pressable — absent, or present-and-disabled.
      ok(await b.locator(".async-error-note").count() === 1, `F-141 ${T} the kept-code note stays up while the fix runs`);
      const liveRetries = await retry.count();
      const retryPressable = liveRetries > 0 && await retry.first().isEnabled();
      ok(!retryPressable, `F-141 ${T} Retry is absent or disabled while a fix is in flight`);

      // Let the fix land. The rule is mutual exclusion, not a one-way removal: generating
      // is offered again once nothing is writing the step. The kept-code note itself is
      // now correctly GONE — F-144: a successful fix replaced the very code that note was
      // reporting on — so the affordance to assert on is the Generate button.
      await page.evaluate(() => window.__RELEASE_HOLD__());
      await b.locator(".fix-result").waitFor({ timeout: 12000 });
      await page.waitForFunction(
        () => { const g = document.querySelector(".function-block .generate-row .btn-generate"); return !!g && !g.disabled; },
        { timeout: 12000 },
      );
      ok(await b.locator(".async-error-note").count() === 0, `F-141 ${T} the kept-code note is cleared by the successful fix (F-144)`);
      ok(true, `F-141 ${T} generating is offered again once the fix has settled`);
    } catch (e) { fail++; console.log(`  \u2717 F-141 ${T} threw: ` + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- F-143..F-146 — ONE writer of a step's `code` at a time ---------------- */
  // F-141 established the rule for two writers (generate, fix). There are FIVE: generate,
  // Fix with AI, Insert recipe, Undo fix and the dry-run. They all resolve into the same
  // step, so the fix is ONE predicate — `stepBusy = isGenerating || fixing || testRunning`
  // — behind every writer's guard and every writer button's disabled/hidden state.
  //   F-143: Retry/Generate were live during a dry-run.
  //   F-144: the red kept-code note survived a SUCCESSFUL fix and sat above a green result.
  //   F-145: Insert recipe was neither excluded nor token-bumping — an in-flight AI write
  //          landed on top of the deterministic recipe and stamped AI provenance on it.
  //   F-146: Undo pressed while another writer ran was silently reverted by it.
  for (const theme of ["light", "dark"]) {
    const T = theme.toUpperCase();

    /* F-143 — Retry and Generate are withheld while a DRY-RUN is running */
    {
      console.log(`F-143 Retry/Generate withheld during a dry-run (cfg-static, ${theme})`);
      const env = await openEditor(browser, "config-ui", "cfg-static", theme, {
        __FAIL__: ["generatePostFunctionCode"],
      });
      const { page } = env;
      try {
        const b = page.locator(".function-block").first();
        const retry = b.locator(".async-error-note .aen-retry");
        const genBtn = b.locator(".btn-generate", { hasText: "Regenerate Code" }).first();

        // Fail a generate to put the kept-code note (and its Retry) on screen.
        await genBtn.click();
        await b.locator(".async-error-note").waitFor({ timeout: 12000 });
        ok(await retry.count() === 1, `F-143 ${T} Retry is offered while nothing is in flight`);

        // Park a dry-run in flight.
        await b.locator(".btn-test-run", { hasText: /Test Run/ }).click();
        await page.evaluate(() => { window.__HOLD__ = ["testPostFunction"]; });
        await b.locator(".btn-run-test", { hasText: "Run Test" }).click();
        await page.waitForFunction(() => typeof window.__RELEASE_HOLD__ === "function", { timeout: 10000 });

        ok(await b.locator(".async-error-note").count() === 1, `F-143 ${T} the kept-code note stays up while the test runs`);
        const liveRetries = await retry.count();
        const retryPressable = liveRetries > 0 && await retry.first().isEnabled();
        ok(!retryPressable, `F-143 ${T} Retry is absent or disabled while a dry-run is in flight`);
        ok(!(await genBtn.isEnabled()), `F-143 ${T} the main Generate button is disabled while a dry-run is in flight`);

        // Release: both affordances come back — the rule is exclusion, not removal.
        await page.evaluate(() => window.__RELEASE_HOLD__());
        await b.locator(".test-result").waitFor({ timeout: 12000 });
        await page.waitForFunction(
          () => { const r = document.querySelector(".async-error-note .aen-retry"); return !!r && !r.disabled; },
          { timeout: 10000 },
        );
        ok(await genBtn.isEnabled(), `F-143 ${T} Generate is enabled again once the dry-run has settled`);
      } catch (e) { fail++; console.log(`  ✗ F-143 ${T} threw: ` + e.message.split("\n")[0]); }
      await closeEditor(env);
    }

    /* F-144 — a SUCCESSFUL fix clears the red kept-code note */
    {
      console.log(`F-144 successful fix clears the kept-code note (cfg-static, ${theme})`);
      const env = await openEditor(browser, "config-ui", "cfg-static", theme, {
        __TESTFAIL_ONCE__: true,
        __FAIL__: ["generatePostFunctionCode"],
      });
      const { page } = env;
      try {
        const b = page.locator(".function-block").first();
        await b.locator(".btn-test-run", { hasText: /Test Run/ }).click();
        await b.locator(".btn-run-test", { hasText: "Run Test" }).click();
        await b.locator(".test-result.test-fail").waitFor({ timeout: 10000 });
        await b.locator(".btn-generate", { hasText: "Regenerate Code" }).first().click();
        await b.locator(".async-error-note").waitFor({ timeout: 12000 });
        ok(await b.locator(".async-error-note").count() === 1, `F-144 ${T} the kept-code note is up after the failed generate`);

        await b.locator(".btn-fix-ai", { hasText: "Fix with AI" }).click();
        await b.locator(".fix-result").waitFor({ timeout: 12000 });
        await page.waitForFunction(
          () => { const u = Array.from(document.querySelectorAll(".fix-result button")).find((x) => /Undo/.test(x.textContent || "")); return !!u && !u.disabled; },
          { timeout: 15000 },
        );
        // THE defect: a red "generation failed" banner sitting above a green fix result.
        ok(await b.locator(".async-error-note").count() === 0, `F-144 ${T} the kept-code note is gone after a SUCCESSFUL fix`);
        ok(await b.locator(".fix-result").count() === 1, `F-144 ${T} the fix result card is what the user is left looking at`);
      } catch (e) { fail++; console.log(`  ✗ F-144 ${T} threw: ` + e.message.split("\n")[0]); }
      await closeEditor(env);
    }

    /* F-145 — Insert recipe is excluded while an AI write runs, and takes ownership */
    {
      console.log(`F-145 Insert recipe excluded + token-bumping (cfg-static, ${theme})`);
      const env = await openEditor(browser, "config-ui", "cfg-static", theme, {
        __HOLD__: ["generatePostFunctionCode"],
      });
      const { page } = env;
      try {
        const b = page.locator(".function-block").first();
        const toggle = b.locator(".recipe-bar-toggle").first();
        const insert = b.locator(".recipe-bar-body .btn-generate", { hasText: "Insert recipe" }).first();

        // Pick a no-required-params recipe so Insert is enabled on its own merits.
        await toggle.click();
        await b.locator(".recipe-bar-body .dropdown-trigger").first().click();
        await page.locator(".dropdown-item", { hasText: "Add / remove labels" }).first().click();
        await insert.waitFor({ timeout: 8000 });
        ok(await insert.isEnabled(), `F-145 ${T} Insert recipe is pressable while nothing is in flight`);

        // Park a generate in flight. The recipe bar must go unpressable.
        await b.locator(".btn-generate", { hasText: "Regenerate Code" }).first().click();
        await page.waitForFunction(() => typeof window.__RELEASE_HOLD__ === "function", { timeout: 10000 });
        const insertLive = await insert.count();
        ok(!(insertLive > 0 && await insert.first().isEnabled()), `F-145 ${T} Insert recipe is absent or disabled while a generate is in flight`);
        ok(!(await toggle.isEnabled()), `F-145 ${T} the recipe bar toggle is disabled while a generate is in flight`);

        // The exclusion cannot be forced past from the browser: React drops click handlers on
        // elements whose props.disabled is true, so un-setting the DOM attribute and calling
        // .click() is a no-op. That is the point — the in-flight AI write can no longer be
        // raced. (The genTokenRef bump on insert is the belt to that braces: if an insert
        // ever does land, it takes ownership of the code and the AI result is discarded.)
        await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll(".recipe-bar-body button"));
          const el = btns.find((x) => /Insert recipe/.test(x.textContent || ""));
          if (el) { el.disabled = false; el.click(); }
        });
        await page.waitForTimeout(400);
        ok(!/Recipe: add \/ remove labels/.test(await b.locator(".cm-content").first().innerText()),
          `F-145 ${T} a forced Insert while the generate runs does not land`);

        // Release, then insert for real: the recipe takes ownership of BOTH the code and the
        // provenance — no AI chips may survive on code the user never generated.
        await page.evaluate(() => window.__RELEASE_HOLD__());
        await page.waitForFunction(
          () => { const g = document.querySelector(".function-block .generate-row .btn-generate"); return !!g && !g.disabled; },
          { timeout: 15000 },
        );
        if (await b.locator(".recipe-bar-body").count() === 0) await toggle.click();
        await insert.waitFor({ timeout: 8000 });
        await insert.click();
        await page.waitForFunction(
          () => /Recipe: add \/ remove labels/.test(document.querySelector(".cm-content")?.innerText || ""),
          { timeout: 8000 },
        );
        const code = await b.locator(".cm-content").first().innerText();
        ok(/Recipe: add \/ remove labels/.test(code), `F-145 ${T} the code is the RECIPE after the insert`);
        ok(!/similar summary/i.test(code), `F-145 ${T} no AI code survived under the recipe`);
        ok(await b.locator(".gen-meta-chip.gmc-mem").count() === 0, `F-145 ${T} no AI provenance chips on code the user never generated`);
        ok(await b.locator(".gen-meta-chip.gmc-recipe").count() === 1, `F-145 ${T} the recipe provenance chip stands`);
      } catch (e) { fail++; console.log(`  ✗ F-145 ${T} threw: ` + e.message.split("\n")[0]); }
      await closeEditor(env);
    }

    /* F-146 — Undo is withheld while another writer runs */
    {
      console.log(`F-146 Undo withheld while a writer is in flight (cfg-static, ${theme})`);
      const env = await openEditor(browser, "config-ui", "cfg-static", theme, { __TESTFAIL_ONCE__: true });
      const { page } = env;
      try {
        const b = page.locator(".function-block").first();
        await b.locator(".btn-test-run", { hasText: /Test Run/ }).click();
        await b.locator(".btn-run-test", { hasText: "Run Test" }).click();
        await b.locator(".test-result.test-fail").waitFor({ timeout: 10000 });
        await b.locator(".btn-fix-ai", { hasText: "Fix with AI" }).click();
        await b.locator(".fix-result").waitFor({ timeout: 12000 });
        const undo = b.locator(".fix-result button", { hasText: "Undo" }).first();
        await page.waitForFunction(
          () => { const u = Array.from(document.querySelectorAll(".fix-result button")).find((x) => /Undo/.test(x.textContent || "")); return !!u && !u.disabled; },
          { timeout: 15000 },
        );
        ok(await undo.isEnabled(), `F-146 ${T} Undo is pressable once the fix has settled`);

        // Park another writer (a dry-run) in flight — Undo must go unpressable.
        await page.evaluate(() => { window.__HOLD__ = ["testPostFunction"]; });
        await b.locator(".btn-run-test", { hasText: "Run Test" }).click();
        await page.waitForFunction(() => typeof window.__RELEASE_HOLD__ === "function", { timeout: 10000 });
        ok(await b.locator(".fix-result").count() === 1, `F-146 ${T} the fix card stays up while the run is in flight`);
        ok(!(await undo.isEnabled()), `F-146 ${T} Undo is disabled while another writer is in flight`);

        await page.evaluate(() => window.__RELEASE_HOLD__());
        await page.waitForFunction(
          () => { const u = Array.from(document.querySelectorAll(".fix-result button")).find((x) => /Undo/.test(x.textContent || "")); return !!u && !u.disabled; },
          { timeout: 12000 },
        );
        ok(true, `F-146 ${T} Undo is enabled again once nothing is writing the step`);
      } catch (e) { fail++; console.log(`  ✗ F-146 ${T} threw: ` + e.message.split("\n")[0]); }
      await closeEditor(env);
    }
    /* F-149 — Insert recipe takes ownership of the state describing the code it replaced */
    // F-145 made Insert recipe bump the generation token, so it OWNS the code. It did not
    // own the state describing the code it replaced: the AI fix card stayed on screen with
    // a LIVE Undo whose `preFixCode` was the pre-fix AI program, so one click overwrote the
    // deterministic recipe with code the recipe had just replaced — and the dry-run verdict
    // earned by that same old program sat under it, vouching for a step it never ran.
    {
      console.log(`F-149 Insert recipe clears the stale Undo/verdict (cfg-static, ${theme})`);
      const env = await openEditor(browser, "config-ui", "cfg-static", theme, { __TESTFAIL_ONCE__: true });
      const { page } = env;
      try {
        const b = page.locator(".function-block").first();

        // Earn a fix card (fail a dry-run, fix it, let the auto re-run pass).
        await b.locator(".btn-test-run", { hasText: /Test Run/ }).click();
        await b.locator(".btn-run-test", { hasText: "Run Test" }).click();
        await b.locator(".test-result.test-fail").waitFor({ timeout: 10000 });
        await b.locator(".btn-fix-ai", { hasText: "Fix with AI" }).click();
        await b.locator(".fix-result").waitFor({ timeout: 12000 });
        await page.waitForFunction(
          () => { const u = Array.from(document.querySelectorAll(".fix-result button")).find((x) => /Undo/.test(x.textContent || "")); return !!u && !u.disabled; },
          { timeout: 15000 },
        );
        ok(await b.locator(".fix-result button", { hasText: "Undo" }).count() === 1, `F-149 ${T} the fix card and its Undo are on screen before the insert`);
        ok(await b.locator(".test-result").count() === 1, `F-149 ${T} the fixed code's dry-run verdict is on screen before the insert`);
        const preFixCode = await b.locator(".cm-content").first().innerText();

        // Insert a recipe on top of the fixed code.
        await b.locator(".recipe-bar-toggle").first().click();
        await b.locator(".recipe-bar-body .dropdown-trigger").first().click();
        await page.locator(".dropdown-item", { hasText: "Add / remove labels" }).first().click();
        const insert = b.locator(".recipe-bar-body .btn-generate", { hasText: "Insert recipe" }).first();
        await insert.waitFor({ timeout: 8000 });
        await insert.click();
        await page.waitForFunction(
          () => /Recipe: add \/ remove labels/.test(document.querySelector(".cm-content")?.innerText || ""),
          { timeout: 8000 },
        );

        // THE defect: an Undo that would write the pre-fix AI code over the recipe.
        ok(await b.locator(".fix-result").count() === 0, `F-149 ${T} the fix card is gone after the insert — no Undo can overwrite the recipe`);
        ok(await b.locator(".fix-result button", { hasText: "Undo" }).count() === 0, `F-149 ${T} no live Undo survives the insert`);
        ok(await b.locator(".test-result").count() === 0, `F-149 ${T} the verdict earned by the replaced code is cleared`);
        const code = await b.locator(".cm-content").first().innerText();
        ok(/Recipe: add \/ remove labels/.test(code), `F-149 ${T} the code on screen is the recipe`);
        ok(code !== preFixCode, `F-149 ${T} the recipe actually replaced the fixed code`);
        ok(await b.locator(".gen-meta-chip.gmc-recipe").count() === 1, `F-149 ${T} the recipe provenance chip stands alone`);

        // A GENERATE that lands on top of a fix card is the same writer/ownership problem.
        await b.locator(".btn-generate", { hasText: /Generate Code|Regenerate Code/ }).first().click();
        await page.waitForFunction(
          () => { const g = document.querySelector(".function-block .generate-row .btn-generate"); return !!g && !g.disabled; },
          { timeout: 15000 },
        );
        ok(await b.locator(".fix-result").count() === 0, `F-149 ${T} a landed generate leaves no fix card behind either`);
        ok(await b.locator(".test-result").count() === 0, `F-149 ${T} a landed generate leaves no stale verdict behind either`);
      } catch (e) { fail++; console.log(`  ✗ F-149 ${T} threw: ` + e.message.split("\n")[0]); }
      await closeEditor(env);
    }

    /* F-150 — the step stays busy across the verified fix's addMemory tail */
    // The fix flow does not end when the fixed code lands: a verified re-run is followed by
    // an addMemory write that produces the "Learned:" badge and its veto. That tail ran with
    // the step looking IDLE (fixing already false, testRunning already false), so an Undo or
    // an Insert pressed during it bumped the generation token, the tail's stale-token guard
    // dropped the result, and the memory was persisted with no badge and no way to take it
    // back. The busy window now runs from the Fix click to the badge.
    {
      console.log(`F-150 busy window covers the fix's memory-save tail (cfg-static, ${theme})`);
      const env = await openEditor(browser, "config-ui", "cfg-static", theme, {
        __TESTFAIL_ONCE__: true,
        __FIX_MEMORY__: true,
        __HOLD__: ["addMemory"],
      });
      const { page } = env;
      try {
        const b = page.locator(".function-block").first();
        const undo = b.locator(".fix-result button", { hasText: "Undo" }).first();
        const recipeToggle = b.locator(".recipe-bar-toggle").first();

        await b.locator(".btn-test-run", { hasText: /Test Run/ }).click();
        await b.locator(".btn-run-test", { hasText: "Run Test" }).click();
        await b.locator(".test-result.test-fail").waitFor({ timeout: 10000 });
        await b.locator(".btn-fix-ai", { hasText: "Fix with AI" }).click();

        // The fixed code has landed and its re-run has passed; the memory write is parked.
        await page.waitForFunction(() => typeof window.__RELEASE_HOLD__ === "function", { timeout: 15000 });
        ok(await b.locator(".fix-result").count() === 1, `F-150 ${T} the fix card is up while the memory save is in flight`);
        ok(await b.locator(".memory-saved-badge").count() === 0, `F-150 ${T} no badge yet — the memory is not persisted`);

        // THE defect: both instant writers were pressable during the tail.
        ok(!(await undo.isEnabled()), `F-150 ${T} Undo is disabled while the memory save is in flight`);
        ok(!(await recipeToggle.isEnabled()), `F-150 ${T} the recipe bar is disabled while the memory save is in flight`);
        // And it cannot be forced past from the browser either (React drops handlers on
        // disabled elements) — the token cannot be bumped out from under the tail.
        await page.evaluate(() => {
          const el = Array.from(document.querySelectorAll(".fix-result button")).find((x) => /Undo/.test(x.textContent || ""));
          if (el) { el.disabled = false; el.click(); }
        });
        await page.waitForTimeout(300);

        // Release: the memory lands, and the author gets both the badge and the veto.
        await page.evaluate(() => window.__RELEASE_HOLD__());
        await b.locator(".memory-saved-badge").first().waitFor({ timeout: 12000 });
        ok(await b.locator(".memory-saved-badge").count() === 1, `F-150 ${T} the badge renders for the memory that was persisted`);
        ok(await b.locator(".memory-saved-badge button").count() === 1, `F-150 ${T} the veto is offered next to the badge`);
        await page.waitForFunction(
          () => { const u = Array.from(document.querySelectorAll(".fix-result button")).find((x) => /Undo/.test(x.textContent || "")); return !!u && !u.disabled; },
          { timeout: 12000 },
        );
        ok(await undo.isEnabled(), `F-150 ${T} Undo is pressable again once the tail has settled`);

        // The memory outlives the Undo (it is already persisted) — the veto is the way back.
        await undo.click();
        await page.waitForTimeout(300);
        ok(await b.locator(".memory-saved-badge").count() === 1, `F-150 ${T} the badge survives an Undo — the memory is persisted, the veto is the way back`);
      } catch (e) { fail++; console.log(`  ✗ F-150 ${T} threw: ` + e.message.split("\n")[0]); }
      await closeEditor(env);
    }

    /* F-151 / F-152 — the KEYBOARD is a writer too, and the tail must be VISIBLE */
    // F-150 closed the button writers during the verified fix's addMemory tail, but the
    // code editor was never gated and `handleCodeChange` bumps the generation token on the
    // first keystroke — so one character typed during the tail put the token guard back in
    // front of the memory outcome and the persisted memory lost its badge and its veto.
    // The fix takes the DISCLOSURE out of the token guard entirely (the token owns the
    // code, not the memory). F-152 rides along: during the tail both `fixing` and
    // `testRunning` are already false, so the step showed no spinner at all while six
    // controls were dead — `stepBusy` now drives one visible state and one reason string.
    {
      console.log(`F-151/F-152 a keystroke during the memory tail keeps the badge; the tail is visible (cfg-static, ${theme})`);
      const env = await openEditor(browser, "config-ui", "cfg-static", theme, {
        __TESTFAIL_ONCE__: true,
        __FIX_MEMORY__: true,
        __HOLD__: ["addMemory"],
      });
      const { page } = env;
      try {
        const b = page.locator(".function-block").first();
        await b.locator(".btn-test-run", { hasText: /Test Run/ }).click();
        await b.locator(".btn-run-test", { hasText: "Run Test" }).click();
        await b.locator(".test-result.test-fail").waitFor({ timeout: 10000 });
        await b.locator(".btn-fix-ai", { hasText: "Fix with AI" }).click();
        await page.waitForFunction(() => typeof window.__RELEASE_HOLD__ === "function", { timeout: 15000 });

        // F-152 — ONE visible busy state, with the memory-tail reason.
        ok(await b.locator(".step-busy-note").count() === 1, `F-152 ${T} the step shows it is busy during the memory tail`);
        ok(/Saving what was learned/.test(await b.locator(".step-busy-note").first().innerText()),
          `F-152 ${T} the busy note names the memory save, not a generic "working"`);
        // Every control stepBusy disables carries the same reason. (Insert recipe and Fix
        // with AI are not mounted here — the recipe body is collapsed and the verdict is a
        // PASS — so the four on screen are the testable surface.)
        const titles = await page.evaluate(() => {
          const root = document.querySelector(".function-block");
          const q = (sel, text) => Array.from(root.querySelectorAll(sel)).find((el) => !text || text.test(el.textContent || ""));
          const pick = (el) => (el ? { disabled: !!el.disabled, title: el.getAttribute("title") } : null);
          return {
            recipe: pick(q(".recipe-bar-toggle")),
            generate: pick(q(".generate-row .btn-generate")),
            runTest: pick(q(".btn-run-test")),
            undo: pick(q(".fix-result button", /Undo/)),
          };
        });
        for (const [name, c] of Object.entries(titles)) {
          ok(c && c.disabled, `F-152 ${T} ${name} is disabled during the memory tail`);
          ok(c && c.title === "Saving what was learned…", `F-152 ${T} ${name} says WHY it is disabled (got: ${c && c.title})`);
        }

        // THE F-151 defect: type one character while the memory write is parked.
        await b.locator(".cm-content").first().click();
        await page.keyboard.type("x");
        await page.waitForTimeout(200);
        ok(await b.locator(".fix-result button", { hasText: "Undo" }).count() === 0,
          `F-151 ${T} the keystroke still takes ownership of the code — the fix card and its Undo are gone`);

        // Release: the memory was written server-side, so it MUST be disclosed anyway.
        await page.evaluate(() => window.__RELEASE_HOLD__());
        await b.locator(".memory-saved-badge").first().waitFor({ timeout: 12000 });
        ok(await b.locator(".memory-saved-badge").count() === 1,
          `F-151 ${T} the persisted memory still gets its badge after a keystroke during the tail`);
        ok(await b.locator(".memory-saved-badge button").count() === 1,
          `F-151 ${T} the veto is still offered — a learned memory is never un-forgettable`);
        ok(/Learned from the version of this code the fix repaired/.test(await b.locator(".fix-result").first().innerText()),
          `F-151 ${T} the badge names the code version it belongs to, now that the code has moved on`);
        ok(await b.locator(".step-busy-note").count() === 0, `F-152 ${T} the busy note clears when the tail settles`);
      } catch (e) { fail++; console.log(`  ✗ F-151/F-152 ${T} threw: ` + e.message.split("\n")[0]); }
      await closeEditor(env);
    }

    /* F-153 — the memory tail is BOUNDED: a wedged addMemory cannot lock the step forever */
    // Since F-150 folded `memorySaving` into `stepBusy`, an invoke() that never settles
    // disabled every writer on the step for the life of the mounted component, with no
    // cancel and no route out. The await is now a Promise.race with an 8s bound.
    {
      console.log(`F-153 a wedged memory save unlocks the step within the bound (cfg-static, ${theme})`);
      const env = await openEditor(browser, "config-ui", "cfg-static", theme, {
        __TESTFAIL_ONCE__: true,
        __FIX_MEMORY__: true,
        __HOLD__: ["addMemory"], // deliberately NEVER released
      });
      const { page } = env;
      try {
        const b = page.locator(".function-block").first();
        await b.locator(".btn-test-run", { hasText: /Test Run/ }).click();
        await b.locator(".btn-run-test", { hasText: "Run Test" }).click();
        await b.locator(".test-result.test-fail").waitFor({ timeout: 10000 });
        await b.locator(".btn-fix-ai", { hasText: "Fix with AI" }).click();
        await page.waitForFunction(() => typeof window.__RELEASE_HOLD__ === "function", { timeout: 15000 });
        ok(await b.locator(".step-busy-note").count() === 1, `F-153 ${T} the step is locked while the wedged save is in flight`);

        // THE defect: without the bound this wait times out — memorySaving never clears.
        await page.waitForFunction(
          () => !document.querySelector(".function-block .step-busy-note"),
          { timeout: 12000 },
        );
        ok(await b.locator(".step-busy-note").count() === 0, `F-153 ${T} the step unlocks within the timeout bound`);
        const undo = b.locator(".fix-result button", { hasText: "Undo" }).first();
        ok(await undo.isEnabled(), `F-153 ${T} Undo is pressable again after the bound`);
        ok(await b.locator(".btn-run-test").first().isEnabled(), `F-153 ${T} Run Test is pressable again after the bound`);
        // No id came back, so a badge would carry a veto that cannot delete anything —
        // we drop the badge and point at the Memories tab instead.
        ok(await b.locator(".memory-saved-badge").count() === 0,
          `F-153 ${T} no badge on a timeout — an unconfirmed save must not offer a veto it cannot honour`);
      } catch (e) { fail++; console.log(`  ✗ F-153 ${T} threw: ` + e.message.split("\n")[0]); }
      await closeEditor(env);
    }

    /* F-154 — the template fallback goes through the ONE home for stale code state */
    // The local-template branch of handleGenerateFailure hand-rolled a subset of
    // clearStaleCodeState (it cleared the verdict only), so the one rule had two homes
    // again. The reachable half is asserted here — the template still lands and still
    // announces itself, which an ordering slip in the new call would break.
    {
      console.log(`F-154 template fallback uses clearStaleCodeState (cfg-static, ${theme})`);
      const env = await openEditor(browser, "config-ui", "cfg-static", theme, {
        __FAIL__: ["generatePostFunctionCode"],
      });
      const { page } = env;
      try {
        const b = page.locator(".function-block").first();
        // Empty the step's code so the failure takes the TEMPLATE branch (with code on
        // screen it takes the "your code was kept" branch instead — F-133).
        await b.locator(".cm-content").first().click();
        await page.keyboard.press("ControlOrMeta+a");
        await page.keyboard.press("Backspace");
        // With no code the whole editor section unmounts (`hasCode &&`), so that is the
        // signal the step is genuinely empty.
        await page.waitForFunction(
          () => !document.querySelectorAll(".function-block")[0].querySelector(".cm-content"),
          { timeout: 8000 },
        );
        await b.locator(".btn-generate", { hasText: /Generate Code|Regenerate Code/ }).first().click();
        await page.waitForFunction(
          () => { const g = document.querySelector(".function-block .generate-row .btn-generate"); return !!g && !g.disabled; },
          { timeout: 15000 },
        );
        const text = await b.innerText();
        ok(/A generic template was inserted/.test(text),
          `F-154 ${T} the template fallback still announces itself (clearStaleCodeState must not eat the note)`);
        ok((await b.locator(".cm-content").first().innerText()).trim() !== "",
          `F-154 ${T} the template landed — the author is not left with an empty step`);
        ok(await b.locator(".fix-result").count() === 0, `F-154 ${T} no fix card survives the template`);
        ok(await b.locator(".test-result").count() === 0, `F-154 ${T} no verdict survives the template`);
      } catch (e) { fail++; console.log(`  ✗ F-154 ${T} threw: ` + e.message.split("\n")[0]); }
      await closeEditor(env);
    }

    /* F-155 — a MERGED save is a reinforcement, not a new row: no veto may be offered */
    // `addMemory` answers `merged: true` when the candidate was deduped INTO an existing
    // memory — often user-authored and reinforced many times. The badge's veto called
    // `deleteMemory(id)` on that id, which erases the whole pre-existing row: a destructive
    // delete of somebody else's fact dressed up as "undo what this fix just learned".
    {
      console.log(`F-155 a merged (reinforced) memory offers no veto (cfg-static, ${theme})`);
      const env = await openEditor(browser, "config-ui", "cfg-static", theme, {
        __TESTFAIL_ONCE__: true,
        __FIX_MEMORY__: true,
        __MEMORY_MERGED__: true,
      });
      const { page } = env;
      try {
        const b = page.locator(".function-block").first();
        await b.locator(".btn-test-run", { hasText: /Test Run/ }).click();
        await b.locator(".btn-run-test", { hasText: "Run Test" }).click();
        await b.locator(".test-result.test-fail").waitFor({ timeout: 10000 });
        await b.locator(".btn-fix-ai", { hasText: "Fix with AI" }).click();
        await b.locator(".memory-saved-badge").first().waitFor({ timeout: 15000 });

        const badge = await b.locator(".memory-saved-badge").first().innerText();
        ok(/Reinforced an existing memory/.test(badge),
          `F-155 ${T} the badge says the memory was REINFORCED, not learned fresh (got: ${badge})`);
        // THE defect: a "forget" button here deletes the pre-existing row.
        ok(await b.locator(".memory-saved-badge button").count() === 0,
          `F-155 ${T} no veto is offered on a merged save — deleting is not an un-reinforce`);
        ok(/Memories tab/.test(await b.locator(".fix-result").first().innerText()),
          `F-155 ${T} the author is pointed at the store that owns the row instead`);
        // The badge must not quote the candidate text as if it were the stored row.
        ok(!/Learned: /.test(await b.locator(".fix-result").first().innerText()),
          `F-155 ${T} the merged badge does not claim to quote the stored memory`);
      } catch (e) { fail++; console.log(`  ✗ F-155 ${T} threw: ` + e.message.split("\n")[0]); }
      await closeEditor(env);
    }

    /* F-155 control — a NON-merged save still gets its veto */
    {
      console.log(`F-155 control: a new (non-merged) memory keeps its veto (cfg-static, ${theme})`);
      const env = await openEditor(browser, "config-ui", "cfg-static", theme, {
        __TESTFAIL_ONCE__: true,
        __FIX_MEMORY__: true,
      });
      const { page } = env;
      try {
        const b = page.locator(".function-block").first();
        await b.locator(".btn-test-run", { hasText: /Test Run/ }).click();
        await b.locator(".btn-run-test", { hasText: "Run Test" }).click();
        await b.locator(".test-result.test-fail").waitFor({ timeout: 10000 });
        await b.locator(".btn-fix-ai", { hasText: "Fix with AI" }).click();
        await b.locator(".memory-saved-badge").first().waitFor({ timeout: 15000 });
        ok(/Learned: /.test(await b.locator(".memory-saved-badge").first().innerText()),
          `F-155 ${T} an added memory still quotes what was learned`);
        ok(await b.locator(".memory-saved-badge button").count() === 1,
          `F-155 ${T} an added memory still offers the veto — the fix must not disable it everywhere`);
      } catch (e) { fail++; console.log(`  ✗ F-155 control ${T} threw: ` + e.message.split("\n")[0]); }
      await closeEditor(env);
    }

    /* F-156 — dismissing the fix card, and a second failing fix, both KEEP the badge */
    // `memorySaved` describes a fact persisted server-side and the badge is the only place
    // this screen offers to forget it. Two writers still cleared it unconditionally: the
    // fix card's × and the top of handleFixWithAI. A second fix whose re-run FAILS saves no
    // replacement, so the first memory went live-but-invisible — exactly F-150's defect.
    {
      console.log(`F-156 the badge survives a dismissed card and a failed second fix (cfg-static, ${theme})`);
      const env = await openEditor(browser, "config-ui", "cfg-static", theme, {
        __TESTFAIL_ONCE__: true,
        __FIX_MEMORY__: true,
      });
      const { page } = env;
      try {
        const b = page.locator(".function-block").first();
        await b.locator(".btn-test-run", { hasText: /Test Run/ }).click();
        await b.locator(".btn-run-test", { hasText: "Run Test" }).click();
        await b.locator(".test-result.test-fail").waitFor({ timeout: 10000 });
        await b.locator(".btn-fix-ai", { hasText: "Fix with AI" }).click();
        await b.locator(".memory-saved-badge").first().waitFor({ timeout: 15000 });

        // (a) THE defect: the fix card's × dropped the badge with it.
        await b.locator(".fix-result .test-dismiss").first().click();
        await page.waitForTimeout(250);
        ok(await b.locator(".fix-result .fix-undo-bar").count() === 0,
          `F-156 ${T} the × does dismiss the fix card itself`);
        ok(await b.locator(".memory-saved-badge").count() === 1,
          `F-156 ${T} the persisted memory keeps its badge after the card is dismissed`);
        ok(await b.locator(".memory-saved-badge button").count() === 1,
          `F-156 ${T} and keeps the veto — the only way to forget it from this screen`);

        // (b) THE defect: a SECOND fix cleared the badge at its start, and its re-run fails,
        // so nothing replaces it. Every dry run from here on fails.
        await page.evaluate(() => { window.__TESTFAIL_ALWAYS__ = true; });
        await b.locator(".btn-run-test", { hasText: "Run Test" }).click();
        await b.locator(".test-result.test-fail").waitFor({ timeout: 10000 });
        ok(await b.locator(".memory-saved-badge").count() === 1,
          `F-156 ${T} a fresh failing run does not disturb the badge`);
        await b.locator(".btn-fix-ai", { hasText: "Fix with AI" }).click();
        await page.waitForFunction(
          () => { const el = document.querySelector(".function-block .btn-fix-ai"); return !el || !el.disabled; },
          { timeout: 20000 },
        ).catch(() => {});
        await page.waitForTimeout(400);
        ok(await b.locator(".memory-saved-badge").count() === 1,
          `F-156 ${T} the badge survives a second fix whose re-run FAILS (no new memory replaces it)`);
        ok(await b.locator(".memory-saved-badge button").count() === 1,
          `F-156 ${T} the veto survives it too`);

        // F-162 — the second fix's re-run FAILED. Nothing on this screen is verified, so
        // nothing on it may be green: the standalone memory card used to be hard-coded
        // `fix-result fix-verified` and sat above the real (failed) fix panel claiming a
        // verification that never happened.
        ok(await b.locator(".fix-result.memory-card").count() === 1,
          `F-162 ${T} the surviving memory renders in its own card, not a fix-outcome card`);
        ok(await b.locator(".fix-result.fix-verified").count() === 0,
          `F-162 ${T} NOTHING claims "verified" when the second fix's re-run failed`);
        const memBorder = await b.locator(".fix-result.memory-card").first()
          .evaluate((el) => getComputedStyle(el).borderTopColor);
        ok(memBorder === (theme === "dark" ? "rgb(20, 184, 166)" : "rgb(13, 148, 136)"),
          `F-162 ${T} the memory card wears the memories hue for this theme (got: ${memBorder})`);
        const memLeft = await b.locator(".fix-result.memory-card").first()
          .evaluate((el) => { const c = getComputedStyle(el); return c.borderLeftWidth + "/" + c.borderTopWidth; });
        ok(memLeft.split("/")[0] === memLeft.split("/")[1],
          `F-162 ${T} no left accent rail — all four borders are equal (got: ${memLeft})`);
      } catch (e) { fail++; console.log(`  ✗ F-156 ${T} threw: ` + e.message.split("\n")[0]); }
      await closeEditor(env);
    }

    /* F-158 — a fix card shows ONLY the memory ITS OWN fix produced */
    // F-156 rightly stopped a second fix from CLEARING the first fix's memory. But most
    // repairs return no memoryCandidate at all (typos and ReferenceErrors teach nothing
    // reusable — src/index.js tells the model to answer null), so a second SUCCESSFUL fix
    // then rendered fix #1's badge inside fix #2's card, uncaveated: "this fix learned
    // that", about a lesson drawn from code two versions ago. The memory must still be
    // visible and forgettable — but OUTSIDE the card, with the note that names its version.
    {
      console.log(`F-158 the second fix's card does not claim the first fix's memory (cfg-static, ${theme})`);
      const env = await openEditor(browser, "config-ui", "cfg-static", theme, {
        __TESTFAIL_ONCE__: true,
        __FIX_MEMORY__: true,
      });
      const { page } = env;
      try {
        const b = page.locator(".function-block").first();
        await b.locator(".btn-test-run", { hasText: /Test Run/ }).click();
        await b.locator(".btn-run-test", { hasText: "Run Test" }).click();
        await b.locator(".test-result.test-fail").waitFor({ timeout: 10000 });
        await b.locator(".btn-fix-ai", { hasText: "Fix with AI" }).click();
        await b.locator(".memory-saved-badge").first().waitFor({ timeout: 15000 });
        ok(await b.locator(".fix-result .memory-saved-badge").count() === 1,
          `F-158 ${T} fix #1 DOES show the memory it produced, inside its own card`);

        // An edit takes ownership of the code and clears the fix card (F-149); the memory
        // survives it (F-151) and moves to the card below. Then fix #2 — verified, but with
        // NO candidate of its own, which is the ordinary case.
        await page.evaluate(() => { window.__FIX_MEMORY__ = false; window.__TESTFAIL_ONCE__ = true; });
        await b.locator(".cm-content").first().click();
        await page.keyboard.type("\n// touch");
        await page.waitForTimeout(250);
        await b.locator(".btn-run-test", { hasText: "Run Test" }).click();
        await b.locator(".test-result.test-fail").waitFor({ timeout: 10000 });
        await b.locator(".btn-fix-ai", { hasText: "Fix with AI" }).click();
        await page.waitForFunction(
          // F-162 — the fix PANEL (the card with the undo bar) must be the verified one.
          // Keying on a bare `.fix-result.fix-verified` was satisfied by the standalone
          // memory card, which used to be hard-coded green, so this gate would have opened
          // with fix #2 never verified.
          () => !!document.querySelector(".function-block .fix-result:has(.fix-undo-bar).fix-verified"),
          { timeout: 20000 },
        );
        await page.waitForTimeout(400);
        ok(await b.locator(".fix-result.memory-card.fix-verified").count() === 0,
          `F-162 ${T} the standalone memory card never wears the fix panel's "verified" class`);

        // THE defect: fix #2's card carried fix #1's badge.
        ok(await b.locator(".fix-result .fix-undo-bar").count() === 1,
          `F-158 ${T} fix #2 has its own card`);
        ok(await b.locator(".fix-result:has(.fix-undo-bar) .memory-saved-badge").count() === 0,
          `F-158 ${T} fix #2's card shows NO memory badge — this fix learned nothing`);
        ok(await b.locator(".memory-saved-badge").count() === 1,
          `F-158 ${T} the first fix's memory is still disclosed — it is still in the store`);
        ok(await b.locator(".memory-saved-badge button").count() === 1,
          `F-158 ${T} and still forgettable from here`);
        const outside = await b.locator(".fix-result").last().innerText();
        ok(/the code shown is not that version/.test(outside),
          `F-158 ${T} the surviving badge carries the note naming the version that taught it (got: ${outside.replace(/\n/g, " | ")})`);
      } catch (e) { fail++; console.log(`  ✗ F-158 ${T} threw: ` + e.message.split("\n")[0]); }
      await closeEditor(env);
    }

    /* F-158 — `{ success: false, reason: "cap", stored: false }` is NOT a learned memory */
    // The store could not keep the row. That is neither a memory (a badge would claim one
    // that does not exist, with a veto that has no id behind it) nor a generic failure (the
    // call worked). It is its own outcome, and it says where to make room.
    {
      console.log(`F-158 a save that kept nothing gets a note, not a badge (cfg-static, ${theme})`);
      const env = await openEditor(browser, "config-ui", "cfg-static", theme, {
        __TESTFAIL_ONCE__: true,
        __FIX_MEMORY__: true,
        __MEMORY_CAP__: true,
      });
      const { page } = env;
      try {
        const b = page.locator(".function-block").first();
        await b.locator(".btn-test-run", { hasText: /Test Run/ }).click();
        await b.locator(".btn-run-test", { hasText: "Run Test" }).click();
        await b.locator(".test-result.test-fail").waitFor({ timeout: 10000 });
        await b.locator(".btn-fix-ai", { hasText: "Fix with AI" }).click();
        await b.locator(".memory-not-kept").first().waitFor({ timeout: 15000 });

        ok(await b.locator(".memory-saved-badge").count() === 0,
          `F-158 ${T} no badge — nothing was stored`);
        ok(await b.locator(".memory-saved-badge button").count() === 0,
          `F-158 ${T} no veto — there is no id to delete`);
        const note = await b.locator(".memory-not-kept").first().innerText();
        ok(/Nothing was kept/.test(note) && /memory store is full/.test(note),
          `F-158 ${T} the note says nothing was kept and why (got: ${note})`);
        ok(/prune it in the Memories tab/.test(note),
          `F-158 ${T} and where to fix it`);
        // Slate, never the teal "learned" hue — and it must resolve in BOTH themes.
        const color = await b.locator(".memory-not-kept").first().evaluate((el) => getComputedStyle(el).color);
        ok(color === (theme === "dark" ? "rgb(100, 116, 139)" : "rgb(71, 85, 105)"),
          `F-158 ${T} the note is slate for this theme (got: ${color})`);
      } catch (e) { fail++; console.log(`  ✗ F-158 cap ${T} threw: ` + e.message.split("\n")[0]); }
      await closeEditor(env);
    }

    /* F-157 — after UNDO the mismatch copy must not accuse the author of an edit */
    // The note fires on any fingerprint divergence, and Undo restores the pre-fix code
    // without a keystroke — so the card told the author the code "has been edited since"
    // when they had reverted it. The comparison only proves "not that version".
    {
      console.log(`F-157 the learnedFrom note is neutral after an Undo (cfg-static, ${theme})`);
      const env = await openEditor(browser, "config-ui", "cfg-static", theme, {
        __TESTFAIL_ONCE__: true,
        __FIX_MEMORY__: true,
      });
      const { page } = env;
      try {
        const b = page.locator(".function-block").first();
        await b.locator(".btn-test-run", { hasText: /Test Run/ }).click();
        await b.locator(".btn-run-test", { hasText: "Run Test" }).click();
        await b.locator(".test-result.test-fail").waitFor({ timeout: 10000 });
        await b.locator(".btn-fix-ai", { hasText: "Fix with AI" }).click();
        await b.locator(".memory-saved-badge").first().waitFor({ timeout: 15000 });
        await page.waitForFunction(
          () => { const u = Array.from(document.querySelectorAll(".fix-result button")).find((x) => /Undo/.test(x.textContent || "")); return !!u && !u.disabled; },
          { timeout: 12000 },
        );
        await b.locator(".fix-result button", { hasText: "Undo" }).first().click();
        await page.waitForTimeout(300);

        const card = await b.locator(".fix-result").first().innerText();
        ok(await b.locator(".memory-saved-badge").count() === 1,
          `F-157 ${T} the badge survives the Undo (the memory is persisted)`);
        ok(/Learned from the version of this code the fix repaired/.test(card),
          `F-157 ${T} the note still names which version taught the memory`);
        // THE defect: no edit happened — Undo is not an edit.
        ok(!/edited since/.test(card),
          `F-157 ${T} the note does not claim the code was edited (got: ${card.replace(/\n/g, " | ")})`);
        ok(/the code shown is not that version/.test(card),
          `F-157 ${T} the note states only what the fingerprint comparison proves`);
      } catch (e) { fail++; console.log(`  ✗ F-157 ${T} threw: ` + e.message.split("\n")[0]); }
      await closeEditor(env);
    }
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

  /* ---------------- M1 — memory store FULL (F-167) + cap refusal on add (F-166) ----------------
   * The backend stops keeping new lessons once the store hits its ceiling. Before F-167 that
   * was invisible in the UI: the Memories tab looked normal and the counts chip just read a
   * number, so "the AI stopped learning" was undiagnosable. storeFull ({ at, reason }) now
   * rides the memory settings and the counts, and the tab says so in solid red.
   * Both themes — every new hue needs a dark override. */
  for (const theme of ["light", "dark"]) {
    console.log(`M1 memory store full — ${theme} (cfg-static)`);
    const env = await openEditor(browser, "config-ui", "cfg-static", theme, { __MEMORY_FULL__: true });
    const { page } = env;
    try {
      const kp = page.locator(".knowledge-panel").first();
      // The counts chip carries the ceiling BEFORE the panel is ever opened.
      const chip = kp.locator(".kc-mem").first();
      ok(/200\s*\/\s*200/.test(await chip.innerText()), `M1 ${theme} counts chip reads "200 / 200" at cap`);
      ok(await kp.locator(".kc-mem.kc-mem-full").count() === 1, `M1 ${theme} the at-cap chip is flagged (kc-mem-full)`);

      if (!(await kp.locator(".knowledge-tabs").isVisible().catch(() => false))) await kp.locator(".knowledge-summary").click();
      await kp.locator(".knowledge-tab-memories").click();

      const banner = kp.locator(".memory-full-banner").first();
      await banner.waitFor({ timeout: 6000 });
      const btxt = await banner.innerText();
      ok(/Memory store is full/i.test(btxt), `M1 ${theme} banner names the condition`);
      ok(/not being kept since/i.test(btxt), `M1 ${theme} banner says learning has STOPPED, with a date`);
      ok(/Delete or merge memories to resume learning/i.test(btxt), `M1 ${theme} banner says how to recover`);
      ok(await banner.getAttribute("role") === "alert", `M1 ${theme} banner is announced as an alert`);

      // Owner design law: solid saturated fill with white text, and NEVER a left rail.
      const style = await banner.evaluate((el) => {
        const c = getComputedStyle(el);
        return { bg: c.backgroundColor, fg: c.color, bl: c.borderLeftWidth, bt: c.borderTopWidth };
      });
      const rgb = style.bg.match(/\d+/g).map(Number);
      ok(rgb[0] > 180 && rgb[1] < 90 && rgb[2] < 90, `M1 ${theme} banner is solid red, not a tint — got ${style.bg}`);
      ok(/255,\s*255,\s*255/.test(style.fg), `M1 ${theme} banner text is white — got ${style.fg}`);
      ok(style.bl === style.bt, `M1 ${theme} no left accent rail (border-left ${style.bl} vs top ${style.bt})`);

      // F-166 — a user add refused at cap must surface the backend's own sentence INLINE,
      // next to the form that just failed, not as a toast that scrolls away.
      await kp.locator(".memory-quick-add .input").fill("Sprint field is customfield_10020.");
      await kp.locator(".btn-remember").click();
      await kp.getByText(/full of your own memories/i).first().waitFor({ timeout: 6000 });
      ok(await kp.getByText(/prune in the Memories tab/i).count() > 0,
        `M1 ${theme} the cap refusal renders inline under the add form (F-166)`);
      // The typed content survives the refusal — nothing was stored, so nothing is discarded.
      ok(await kp.locator(".memory-quick-add .input").inputValue() === "Sprint field is customfield_10020.",
        `M1 ${theme} the refused text is kept in the input, not silently cleared`);
    } catch (e) { fail++; console.log(`  ✗ M1 ${theme} threw: ` + e.message.split("\n")[0]); }
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

  /* ============================================================================
     R-series — the admin Rules table review fixes.
     Each block names the defect it locks down so a future edit that reintroduces
     it fails here rather than in someone's screenshot.
     ========================================================================= */

  /* ---------------- R1 — pagination, newest-first order, page size ---------------- */
  {
    console.log("R1 rules table pagination + newest-first ordering");
    const env = await openEditor(browser, "admin-panel", "admin");
    const { page } = env;
    try {
      await page.locator("table.rules-table tbody tr").first().waitFor({ timeout: 12000 });
      const dataRows = () => page.locator("table.rules-table tbody tr:not(.rule-explain-row):not(.rule-accordion-row)");

      // Default page size is 10 — the whole point of the fix is that a 500-rule
      // registry no longer renders as one 76,000px page.
      ok(await dataRows().count() === 10, `R1 default page shows 10 rows (got ${await dataRows().count()})`);
      ok(await page.locator(".rules-pagination").count() > 0, "R1 a pagination footer renders");
      ok(await page.locator(".rules-pagination-info", { hasText: /1–10 of 30/ }).count() > 0, "R1 the range reads 1–10 of 30");

      // Newest first. The Updated column renders through toLocaleString(), whose
      // format depends on the browser locale — so assert the ORDER by rule identity
      // instead. The 8 hand-written fixture rules are all May/June 2026; the 22 bulk
      // rules are February 2026 and are SHUFFLED in the source array. Page 1 must
      // therefore be the hand-written ones, newest first.
      const wfNames = () => page.locator("table.rules-table tbody .workflow-name").allInnerTexts();
      const p1 = await wfNames();
      ok(p1.length === 10, `R1 read a workflow name for all 10 rows (got ${p1.length})`);
      // Assert the EXACT sequence, not just membership. An earlier version of this
      // test only checked that the recent rules were somewhere on page 1, which a
      // broken sort still satisfies — and it did: the live site ordered rows by id
      // because the registry stores epoch-ms NUMBERS and Date.parse(number) is NaN.
      // The fixture now carries both timestamp shapes, so this ordering is the check.
      const EXPECTED_PAGE_1 = [
        "Platform Intake",        // 2026-06-18  ISO
        "Incident Response",      // 2026-06-17  epoch-ms number
        "Release Workflow",       // 2026-06-16  epoch-ms number
        "Software Dev Workflow",  // 2026-06-15  ISO
        "Compliance",             // 2026-06-14  ISO
        "Bug Triage",             // 2026-06-10  ISO
        "Onboarding",             // 2026-06-01  ISO
        "Legacy QA",              // 2026-05-20  ISO
        "Bulk Workflow 22",       // 2026-02-22  epoch-ms number
        "Bulk Workflow 21",       // 2026-02-21  epoch-ms number
      ];
      ok(JSON.stringify(p1) === JSON.stringify(EXPECTED_PAGE_1),
        `R1 page 1 is in newest-first order regardless of timestamp shape\n      expected: ${JSON.stringify(EXPECTED_PAGE_1)}\n      got:      ${JSON.stringify(p1)}`);

      // Paging forward keeps the ordering and lands on the older rules.
      await page.locator(".rules-pager button", { hasText: "Next" }).click();
      await page.waitForTimeout(250);
      ok(await page.locator(".rules-pagination-info", { hasText: /11–20 of 30/ }).count() > 0, "R1 Next advances to 11–20 of 30");
      const p2 = await wfNames();
      ok(p2.length === 10 && p2.every((n) => /^Bulk Workflow/.test(n)), "R1 page 2 holds only the older bulk rules");
      ok(!p2.some((n) => p1.includes(n)), "R1 no rule appears on two pages");

      // Previous is disabled on page 1, Next on the last page — no dead-end paging.
      await page.locator(".rules-pager button", { hasText: "Previous" }).click();
      await page.waitForTimeout(200);
      ok(await page.locator(".rules-pager button:disabled", { hasText: "Previous" }).count() === 1, "R1 Previous is disabled on page 1");

      // Page size is fixed to the 10 / 20 choice the owner asked for.
      const sizes = await page.locator(".rules-pagesize-btn").allInnerTexts();
      ok(JSON.stringify(sizes.map((t) => t.trim())) === JSON.stringify(["10", "20"]), `R1 page-size choices are exactly 10 and 20 (got ${sizes})`);
      await page.locator(".rules-pagesize-btn", { hasText: "20" }).click();
      await page.waitForTimeout(250);
      ok(await dataRows().count() === 20, "R1 choosing 20 renders 20 rows");
      ok(await page.locator(".rules-pagination-info", { hasText: /1–20 of 30/ }).count() > 0, "R1 the range follows the page size");

      // Searching resets to page 1 — the old code could strand you on an empty page.
      await page.locator(".rules-pagesize-btn", { hasText: "10" }).click();
      await page.waitForTimeout(150);
      await page.locator(".rules-pager button", { hasText: "Next" }).click();
      await page.waitForTimeout(200);
      await page.locator("input.list-search").fill("Bulk seeded rule 3");
      await page.waitForTimeout(300);
      ok(await page.locator(".rules-pagination-info", { hasText: /^1–/ }).count() > 0, "R1 a search snaps back to page 1 (never a blank page)");
      await page.locator("input.list-search").fill("");
      await page.waitForTimeout(250);
    } catch (e) { fail++; console.log("  ✗ R1 threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- R2 — frozen header + selection bar docked to the table ---------------- */
  {
    console.log("R2 sticky table head + docked selection bar");
    const env = await openEditor(browser, "admin-panel", "admin");
    const { page } = env;
    try {
      await page.locator("table.rules-table tbody tr").first().waitFor({ timeout: 12000 });
      await page.waitForTimeout(900); // .section + .stagger entry animations must settle before measuring

      const headSticky = await page.locator("table.rules-table thead th").first()
        .evaluate((el) => getComputedStyle(el).position);
      ok(headSticky === "sticky", `R2 the table head is sticky so it stays visible while scrolling (got ${headSticky})`);

      // Selecting a row must NOT move the table. The old bulk bar was rendered above
      // the whole section, so ticking a box inserted ~50px far up the page and shoved
      // every row down under the cursor.
      const firstRow = page.locator("table.rules-table tbody tr").first();
      const absTop = () => firstRow.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
      const before = await absTop();
      const box = page.locator("table.rules-table tbody input[type=checkbox]").first();
      await box.check();
      await page.waitForTimeout(300);
      ok(await page.locator(".rules-bulkbar", { hasText: "1 selected" }).count() > 0, "R2 the selection count appears");

      // The bar is INSIDE the table's card, immediately before the table.
      const docked = await page.locator(".rules-bulkbar").evaluate((el) => ({
        pos: getComputedStyle(el).position,
        nextIsTable: !!el.nextElementSibling && el.nextElementSibling.tagName === "TABLE",
        parentIsCard: !!el.parentElement && el.parentElement.className.includes("card"),
      }));
      ok(docked.nextIsTable, "R2 the selection bar sits directly above the table it acts on");
      ok(docked.parentIsCard, "R2 the selection bar is inside the table card, not above the section");
      ok(docked.pos === "sticky", "R2 the selection bar is sticky so it stays reachable while scrolling");

      const after = await absTop();
      ok(Math.abs(after - before) < 2, `R2 selecting a row does NOT shift the table (moved ${Math.round(after - before)}px)`);

      await page.locator(".rules-bulkbar button", { hasText: "Clear" }).click();
      await page.waitForTimeout(250);
      ok(await page.locator(".rules-bulkbar").count() === 1, "R2 the bar stays (constant height is what stops the jump)");
      ok(await page.locator(".rules-bulkbar-idle", { hasText: /30 rules/ }).count() > 0, "R2 Clear returns the bar to its idle row-count caption");
      const cleared = await absTop();
      ok(Math.abs(cleared - before) < 2, `R2 clearing the selection does not shift the table either (moved ${Math.round(cleared - before)}px)`);
    } catch (e) { fail++; console.log("  ✗ R2 threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- R3 — Add Rule is a modal, and it does not displace the table ---------------- */
  {
    console.log("R3 Add Rule opens a modal dialog");
    const env = await openEditor(browser, "admin-panel", "admin");
    const { page } = env;
    try {
      await page.locator("table.rules-table tbody tr").first().waitFor({ timeout: 12000 });
      await page.waitForTimeout(900); // entry animations must settle before measuring
      const firstRow = page.locator("table.rules-table tbody tr").first();
      const absTop = () => firstRow.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
      const before = await absTop();

      await page.locator("button", { hasText: "+ Add Rule" }).first().click();
      const dlg = page.locator(".wiz-dialog");
      await dlg.waitFor({ timeout: 8000 });
      ok(await dlg.getAttribute("role") === "dialog", "R3 the wizard renders as a dialog, not an inline card");
      ok(await dlg.getAttribute("aria-modal") === "true", "R3 the dialog is modal");
      ok(await page.locator(".wiz-overlay").count() > 0, "R3 the dialog has a backdrop overlay");
      ok(await dlg.getByText("Add New Rule").count() > 0, "R3 the dialog is titled Add New Rule");
      ok(await dlg.getByText(/1\.\s*Project/).count() > 0, "R3 it opens on the project → workflow → transition flow");

      // The whole reason it became a dialog: the table underneath must not move.
      const after = await absTop();
      ok(Math.abs(after - before) < 2, `R3 opening the wizard does NOT displace the rules table (moved ${Math.round(after - before)}px)`);

      // Escape closes it, like every other dialog in the app.
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      ok(await page.locator(".wiz-dialog").count() === 0, "R3 Escape closes the wizard");
    } catch (e) { fail++; console.log("  ✗ R3 threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- R4 — modal lands in the viewport, not above it ---------------- */
  {
    console.log("R4 delete dialog opens in view (containing-block regression)");
    const env = await openEditor(browser, "admin-panel", "admin");
    const { page } = env;
    try {
      await page.locator("table.rules-table tbody tr").first().waitFor({ timeout: 12000 });

      // The bug: `.section` carried a leftover identity transform from a keyframe that
      // ended at translateY(0) instead of none, which made it — not the viewport —
      // the containing block for the overlay's `position: fixed`, so the dialog
      // rendered thousands of pixels above wherever the user was.
      // Two independent guarantees, because the keyframe fix alone is only true once
      // the 0.3s section animation has FINISHED — during it, .section still carries a
      // transform. Portalling the overlay to <body> is what makes this impossible at
      // any moment, and for any future container style.
      await page.waitForTimeout(600); // let .section finish animating
      const sectionTransform = await page.locator(".section").first()
        .evaluate((el) => getComputedStyle(el).transform);
      // Chrome keeps a finished fill-mode:both animation's OUTPUT, and `none`
      // interpolates as the identity matrix — so a settled .section reports
      // "matrix(1, 0, 0, 1, 0, 0)", not "none". What matters is that it settles to
      // an IDENTITY (nothing visually displaced); the portal check below is what
      // guarantees the dialog's position.
      ok(sectionTransform === "none" || sectionTransform === "matrix(1, 0, 0, 1, 0, 0)",
        `R4 .section settles to an identity transform (keyframe ends at transform:none) — got ${sectionTransform}`);

      // Scroll well down the page, then open the dialog from a row that is in view.
      await page.evaluate(() => window.scrollTo(0, 900));
      await page.waitForTimeout(300);
      // Pick a Delete button clear of the sticky toolbar + header; the topmost rows
      // sit UNDER them once scrolled, so a click there is intercepted by the bar.
      const delBtns = page.locator("table.rules-table .row-actions button", { hasText: /^Delete$/ });
      const STICKY_H = 140;
      let opened = false;
      for (let i = 0; i < await delBtns.count(); i++) {
        const bx = await delBtns.nth(i).boundingBox();
        if (bx && bx.y > STICKY_H && bx.y < 900) { await delBtns.nth(i).click(); opened = true; break; }
      }
      ok(opened, "R4 found a Delete button clear of the sticky header to click");
      const modal = page.locator(".pf-modal.del-dialog");
      await modal.waitFor({ timeout: 8000 });
      await page.waitForTimeout(400);

      const geom = await modal.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, vh: window.innerHeight };
      });
      ok(geom.top >= 0 && geom.top < geom.vh,
        `R4 the delete dialog opens INSIDE the viewport (top=${Math.round(geom.top)}, viewport=${geom.vh})`);
      ok(geom.bottom > 0, "R4 the dialog is not scrolled off the top of the screen");

      const overlay = await page.locator(".pf-modal-overlay").evaluate((el) => ({
        pos: getComputedStyle(el).position,
        parentIsBody: el.parentElement === document.body,
      }));
      ok(overlay.pos === "fixed", "R4 the overlay is still position: fixed (tracks the viewport)");
      ok(overlay.parentIsBody, "R4 the overlay is portalled to <body>, so no animated container can capture its fixed positioning");
    } catch (e) { fail++; console.log("  ✗ R4 threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- R5 — one search bar, not two ---------------- */
  {
    console.log("R5 searchable select is a single combobox");
    const env = await openEditor(browser, "config-ui", "cfg-semantic");
    const { page } = env;
    try {
      // The Target Field picker is a searchable CustomSelect. Open it: there must be
      // exactly ONE text input on screen for it — the trigger itself — not a dead
      // "Select a field…" bar stacked on top of a live "Search fields…" bar.
      const trigger = page.locator(".dropdown-trigger", { hasText: /Select a field|Description|Summary/ }).first();
      await trigger.waitFor({ timeout: 12000 });
      await trigger.click();
      await page.locator(".dropdown-panel").first().waitFor({ timeout: 6000 });

      ok(await page.locator(".dropdown-panel .dropdown-search").count() === 0,
        "R5 the open panel no longer carries its own second search box");
      ok(await page.locator(".dropdown-combobox input.dropdown-combobox-input").count() === 1,
        "R5 exactly one search input exists, and it IS the trigger");
      ok(await page.locator(".dropdown-combobox-input").first().evaluate((el) => el === document.activeElement),
        "R5 the single search input is focused on open, so you can just type");

      // Typing filters, and picking still works.
      await page.locator(".dropdown-combobox-input").first().fill("summ");
      await page.waitForTimeout(250);
      const opts = await page.locator(".dropdown-panel .dropdown-item").allInnerTexts();
      ok(opts.length > 0 && opts.every((t) => /summ/i.test(t)), `R5 typing in the trigger filters the list (${opts.length} match)`);
      await page.locator(".dropdown-panel .dropdown-item").first().click();
      await page.waitForTimeout(250);
      ok(await page.locator(".dropdown-panel").count() === 0, "R5 picking an option closes the menu");
      ok(await page.locator(".dropdown-combobox").count() === 0, "R5 the trigger reverts to a button once closed");
    } catch (e) { fail++; console.log("  ✗ R5 threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- R6 — import file picker is ours, and in English ---------------- */
  {
    console.log("R6 import file picker has no browser-native chrome");
    const env = await openEditor(browser, "admin-panel", "admin");
    const { page } = env;
    try {
      await page.locator("button", { hasText: "Export / Import" }).first().click();
      const dlg = page.locator(".port-dialog");
      await dlg.waitFor({ timeout: 8000 });
      await dlg.locator("button.port-tab", { hasText: "Import" }).click();
      await page.waitForTimeout(200);

      // A bare <input type=file> paints the BROWSER's button and "no file selected"
      // label in the BROWSER's language — a Romanian Chrome showed "Răsfoiește…" and
      // "Niciun fișier selectat" inside an otherwise English dialog.
      const visible = await dlg.locator("input[type=file]").first().evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { w: r.width, h: r.height };
      });
      ok(visible.w <= 1 && visible.h <= 1, `R6 the native file input is visually hidden (${visible.w}x${visible.h})`);
      ok(await dlg.locator("button", { hasText: "Choose file…" }).count() === 1, "R6 our own English 'Choose file…' button is shown instead");
      ok(await dlg.locator(".port-file-name", { hasText: "No file chosen" }).count() === 1, "R6 the empty state is our English label");
    } catch (e) { fail++; console.log("  ✗ R6 threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- R7 — Owner column names real people ---------------- */
  {
    console.log("R7 owner column shows real attribution");
    const env = await openEditor(browser, "admin-panel", "admin");
    const { page } = env;
    try {
      await page.locator("table.rules-table tbody tr").first().waitFor({ timeout: 12000 });
      const ownerText = (await page.locator("table.rules-table tbody tr td:nth-last-child(2)").allInnerTexts()).join(" | ");

      ok(/You/.test(ownerText), "R7 a rule created by the viewer reads 'You'");
      ok(/Dana Kovacs/.test(ownerText), "R7 another user's rule shows their display name");
      // The claimed rule used to read "Unowned" even though the registry knew who
      // claimed it — that attribution is now surfaced instead of discarded.
      ok(/Claimed by Priya Raman/.test(ownerText), `R7 a claimed rule names its claimer instead of saying Unowned`);
      // And nothing anywhere prints a raw accountId at the user.
      ok(!/557058:/.test(ownerText), `R7 no raw accountId is ever rendered — got: ${ownerText.slice(0, 200)}`);
    } catch (e) { fail++; console.log("  ✗ R7 threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
  }
} finally {
  await browser.close();
}

console.log(`\nEDITOR JOURNEYS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
