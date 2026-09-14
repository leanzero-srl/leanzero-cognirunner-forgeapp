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
/* 1.4 commit 14b — the field-guide chip resolves section ids to TITLES out of the generated
   index. Both the ids the mock stamps and the titles they must render come from that one
   home, so this suite cannot assert a name the corpus does not carry. */
import { KNOWLEDGE_INDEX } from "../../src/shared/knowledge-index.js";
const FG_IDS = KNOWLEDGE_INDEX
  .filter((x) => x.pack === "jira-rest-correctness" || x.pack === "cognirunner-sandbox-traps")
  .slice(0, 3).map((x) => x.id);
const FG_TITLES = [...new Set(FG_IDS.map((id) => KNOWLEDGE_INDEX.find((x) => x.id === id).title))];
/* F-175: M1 asserts the cap refusal the app ACTUALLY emits, pulled from its ONE home.
   Retyping the sentence here would let the test and the mock agree with each other while
   both drift from src/shared/registry-limits.js — which is exactly what happened before
   (the suite hunted for "prune in the Memories tab", words no tenant has ever seen). */
import { memoryCapRefusalMessage, memoryPlatformCapMessage } from "../../src/shared/registry-limits.js";

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

/* PNGs only with --shots, the same contract as every other journey in this harness.
   (`openEditor`'s third PARAMETER is also called `shot` — it is the __SHOT__ fixture key,
   not this. It shadows this helper inside that function only, which uses neither.) */
const SHOTS = process.argv.includes("--shots");
const OUT = path.join(__dirname, "out"); if (SHOTS) fs.mkdirSync(OUT, { recursive: true });
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true }); };

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
      /* 1.4 commit 14b — the BAKED knowledge, beside the three curated stores. Collapsed by
         default: the section names are long and this is provenance, not the subject. */
      const fg = page.locator(".gmc-fieldguide").first();
      ok(await fg.count() === 1, "J18 provenance shows the field-guide chip");
      ok(new RegExp(`Field guide: ${FG_TITLES.length} sections?`).test(await fg.innerText()),
        `J18 the chip counts the sections it can NAME (want ${FG_TITLES.length}), got "${await fg.innerText()}"`);
      ok(await page.locator(".fg-chip-list").count() === 0, "J18 the section list starts collapsed");
      ok(await fg.getAttribute("aria-expanded") === "false", "J18 and says so");
      await fg.click();
      await page.locator(".fg-chip-list").first().waitFor({ timeout: 5000 });
      const fgItems = await page.locator(".fg-chip-item").allInnerTexts();
      for (const t of FG_TITLES) ok(fgItems.includes(t), `J18 the expanded list names "${t}"`);
      ok(await fg.getAttribute("aria-expanded") === "true", "J18 expanded state is announced");
      /* A BUTTON, not a native control, and not a bare span pretending to be clickable. */
      ok(await fg.evaluate((el) => el.tagName) === "BUTTON", "J18 the chip is a real button");
      await fg.click();
      ok(await page.locator(".fg-chip-list").count() === 0, "J18 it collapses again");
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

  /* ---------------- J16g — F-350: the GIT param group, light AND dark ----------------
     The defect this closes: PremadeRuleForm had no renderer for the `git` group the git
     premade validators declare, so a designer could pick "PR merged", save a rule with no
     connection and no repo, and the executor would ALLOW every transition as unfinished
     config. The journey drives the whole group from empty and then asserts on the string
     the editor hands JIRA — a rendered picker that does not reach the saved config is the
     same silent pass wearing a form. */
  for (const theme of ["light", "dark"]) {
    console.log(`J16g git premade validator group (cfg-premade-git, ${theme})`);
    const env = await openEditor(browser, "config-ui", "cfg-premade-git", theme);
    const { page } = env;
    try {
      // Pick the git rule. It is in the VALIDATOR half of the catalogue only.
      const rulePicker = page.locator(".dropdown-trigger", { hasText: "Choose a premade rule" }).first();
      await rulePicker.click();
      await page.waitForSelector(".dropdown-panel", { timeout: 6000 });
      const gitOpt = page.locator(".dropdown-panel .dropdown-item", { hasText: "the pull request is merged" }).first();
      ok(await gitOpt.count() > 0, `J16g (${theme}) the catalogue offers "Git: the pull request is merged"`);
      await gitOpt.click();

      // The whole group renders — and none of it is native chrome.
      await page.waitForSelector(".pr-seg", { timeout: 6000 });
      ok(await page.locator("select").count() === 0, `J16g (${theme}) no native <select> anywhere in the git group`);
      ok(await page.locator(".pr-seg-btn").count() === 3, `J16g (${theme}) prMatch is a 3-option segmented control, not a dropdown`);
      ok(await page.locator(".pr-git-toggle-row input[type=checkbox]").count() === 1, `J16g (${theme}) the Strict toggle renders`);

      /* F-379 - the picker must not promise a trust the executor dropped. After F-362 the
         cognirunner.git property only NOMINATES a pull request number: its branch or title
         must still name the issue key, so "property" and "both" are the SAME check and the
         labels come from the catalog that explain-facts.js also reads. */
      const segLabels = await page.locator(".pr-seg-btn").allInnerTexts();
      ok(!segLabels.some((t) => /^Linked by CogniRunner$/.test(t.trim())) && !segLabels.some((t) => /^Either$/.test(t.trim())),
        `J16g (${theme}) the retired prMatch labels are gone (got ${JSON.stringify(segLabels)})`);
      ok(segLabels.filter((t) => /names the issue|title/i.test(t)).length === 3,
        `J16g (${theme}) every option says what LIVE signal binds the pull request (got ${JSON.stringify(segLabels)})`);
      await page.locator(".pr-seg-btn", { hasText: "(linked by CogniRunner)" }).first().click();
      const propHint = await page.locator(".pr-seg").locator("xpath=following-sibling::p[1]").innerText();
      ok(/only a candidate/i.test(propHint) && /must still name the issue key/i.test(propHint),
        `J16g (${theme}) the property option's hint tells the truth (got "${propHint}")`);

      // Connection list — both mock connections, each carrying its provider kind.
      const connPicker = page.locator(".dropdown-trigger", { hasText: "Choose a git connection" }).first();
      ok(await connPicker.count() > 0, `J16g (${theme}) the connection picker renders with its placeholder`);
      await connPicker.click();
      await page.waitForSelector(".dropdown-panel", { timeout: 6000 });
      ok(await page.locator(".dropdown-panel .dropdown-item", { hasText: "Acme engineering" }).count() > 0, `J16g (${theme}) connection list shows listGitConnections rows (Acme engineering)`);
      ok(await page.locator(".dropdown-panel .dropdown-item", { hasText: "Acme platform" }).count() > 0, `J16g (${theme}) connection list shows the second connection (Acme platform)`);
      ok(/GitHub/.test(await page.locator(".dropdown-panel .dropdown-item", { hasText: "Acme engineering" }).first().innerText()), `J16g (${theme}) the connection option names its provider kind`);
      await page.locator(".dropdown-panel .dropdown-item", { hasText: "Acme engineering" }).first().click();
      // The chosen connection gets the SOLID kind chip (never a faded tint).
      await page.waitForSelector(".pr-git-kind-github", { timeout: 6000 });
      ok(await page.locator(".pr-git-kind-github").count() === 1, `J16g (${theme}) the chosen connection shows a solid GitHub kind chip`);

      // THE NARROWING. gc_1 allows acme/web + acme/api; acme/platform belongs to gc_2 and
      // must not be offerable — the executor fails CLOSED on a repo off the allow-list, so
      // a picker that offered it would build a rule that blocks every transition.
      const repoPicker = page.locator(".dropdown-trigger", { hasText: "Choose a repository" }).first();
      await repoPicker.click();
      await page.waitForSelector(".dropdown-panel", { timeout: 6000 });
      const repoItems = await page.locator(".dropdown-panel .dropdown-item").allInnerTexts();
      ok(repoItems.some((t) => /acme\/web/.test(t)), `J16g (${theme}) repo list narrows to the connection's allow-list (acme/web)`);
      ok(repoItems.some((t) => /acme\/api/.test(t)), `J16g (${theme}) repo list narrows to the connection's allow-list (acme/api)`);
      ok(!repoItems.some((t) => /acme\/platform/.test(t)), `J16g (${theme}) the OTHER connection's repo (acme/platform) is not offered`);
      await page.locator(".dropdown-panel .dropdown-item", { hasText: "acme/web" }).first().click();

      // Strict copy switches, and it says what the executor's fail-open/closed table says.
      const strictBox = page.locator(".pr-git-toggle-row input[type=checkbox]").first();
      ok(!(await strictBox.isChecked()), `J16g (${theme}) Strict defaults OFF (the app-wide fail-OPEN contract)`);
      // The helper text is the <p class="hint"> immediately after the toggle's own label.
      const strictCopy = async () => (await page.locator(".pr-git-toggle-row").locator("xpath=following-sibling::p[1]").first().innerText());
      ok(/allowed and a banner shows why/.test(await strictCopy()), `J16g (${theme}) Strict OFF copy: transition is allowed + a banner shows why`);
      await strictBox.check();
      ok(/blocked until the connection works again/.test(await strictCopy()), `J16g (${theme}) Strict ON copy: transition is blocked until the connection works again`);

      // prMatch: pick the non-default so the saved value proves the control is wired.
      await page.locator(".pr-seg-btn", { hasText: "Branch names the issue" }).first().click();
      ok(await page.locator(".pr-seg-btn.active", { hasText: "Branch names the issue" }).count() === 1, `J16g (${theme}) the segmented control marks the chosen option active`);

      // THE POINT OF THE WHOLE JOURNEY: all four keys reach the config Jira is handed.
      const saved = await page.evaluate(async () => JSON.parse(await window.__ON_CONFIGURE__()));
      ok(saved.ruleKind === "premade" && saved.ruleType === "git-pr-merged", `J16g (${theme}) saved config is the premade git rule`);
      ok(saved.connectionId === "gc_1", `J16g (${theme}) saved config carries connectionId (gc_1)`);
      ok(saved.repo === "acme/web", `J16g (${theme}) saved config carries repo (acme/web)`);
      ok(saved.prMatch === "branch", `J16g (${theme}) saved config carries prMatch (branch)`);
      ok(saved.strict === true, `J16g (${theme}) saved config carries strict (true)`);
    } catch (e) { fail++; console.log(`  ✗ J16g (${theme}) threw: ` + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- J16h — F-350: a DEAD credential is loud, not whispered ----------- */
  {
    console.log("J16h git connection with a dead credential (cfg-premade-git)");
    const env = await openEditor(browser, "config-ui", "cfg-premade-git", "light", { __CODE_DEAD__: true });
    const { page } = env;
    try {
      await page.locator(".dropdown-trigger", { hasText: "Choose a premade rule" }).first().click();
      await page.waitForSelector(".dropdown-panel", { timeout: 6000 });
      await page.locator(".dropdown-panel .dropdown-item", { hasText: "the pull request is merged" }).first().click();
      await page.waitForSelector(".pr-seg", { timeout: 6000 });
      await page.locator(".dropdown-trigger", { hasText: "Choose a git connection" }).first().click();
      await page.waitForSelector(".dropdown-panel", { timeout: 6000 });
      const deadOpt = page.locator(".dropdown-panel .dropdown-item", { hasText: "Acme platform" }).first();
      ok(/credential dead/.test(await deadOpt.innerText()), "J16h the dead connection is marked IN the list, before it is chosen");
      await deadOpt.click();
      await page.waitForSelector(".pr-git-dead", { timeout: 6000 });
      const bg = await page.locator(".pr-git-dead").first().evaluate((el) => getComputedStyle(el).backgroundColor);
      ok(bg === "rgb(220, 38, 38)", `J16h the dead-credential block is SOLID red (#dc2626), not a tint — got ${bg}`);
      const borderLeft = await page.locator(".pr-git-dead").first().evaluate((el) => getComputedStyle(el).borderLeftWidth);
      ok(borderLeft === "0px", `J16h the dead-credential block has NO left accent rail — got ${borderLeft}`);
      ok(/credential is dead/i.test(await page.locator(".pr-git-dead").first().innerText()), "J16h the block says the credential is dead in words");
    } catch (e) { fail++; console.log("  ✗ J16h threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ------------- J16i — F-369: the EDITOR floor picks a connection and narrows repos ---
     `listGitConnections` is requireAdmin, so a workflow editor is REFUSED there. Before
     this the form fell back to a flat list whose repos were the union across every
     connection: the editor could pick connection A and a repo only B allows, save it, and
     the transition would fail CLOSED at run time. getRuleLists now answers the editor floor
     with rich rows ({id, kind, label, repos[]}), so the SAME renderer narrows on both paths
     and the "this is every repository" note is gone with the thing it described. */
  for (const theme of ["light", "dark"]) {
    console.log(`J16i git group on the EDITOR floor (listGitConnections refused, ${theme})`);
    const env = await openEditor(browser, "config-ui", "cfg-premade-git", theme, { __REFUSE__: ["listGitConnections"], __REFUSE_ROLE__: "admin" });
    const { page } = env;
    try {
      await page.locator(".dropdown-trigger", { hasText: "Choose a premade rule" }).first().click();
      await page.waitForSelector(".dropdown-panel", { timeout: 6000 });
      await page.locator(".dropdown-panel .dropdown-item", { hasText: "the pull request is merged" }).first().click();
      await page.waitForSelector(".pr-seg", { timeout: 6000 });

      // The picker EXISTS for a non-admin, and it is the app's own control.
      const connPicker = page.locator(".dropdown-trigger", { hasText: "Choose a git connection" }).first();
      ok(await connPicker.count() > 0, `J16i (${theme}) an editor refused by listGitConnections still gets a connection picker`);
      ok(await page.locator("select").count() === 0, `J16i (${theme}) no native <select> on the editor floor either`);
      await connPicker.click();
      await page.waitForSelector(".dropdown-panel", { timeout: 6000 });
      const connItems = await page.locator(".dropdown-panel .dropdown-item").allInnerTexts();
      ok(connItems.some((t) => /Acme engineering/.test(t)), `J16i (${theme}) the editor-floor rows are listed (Acme engineering)`);
      ok(connItems.some((t) => /Acme platform/.test(t)), `J16i (${theme}) both connections are listed`);
      // The editor floor carries NO credential state, so nothing may claim one.
      ok(!connItems.some((t) => /credential dead/.test(t)), `J16i (${theme}) the editor floor claims no credential status it cannot see`);
      await page.locator(".dropdown-panel .dropdown-item", { hasText: "Acme engineering" }).first().click();

      // THE NARROWING, on the editor path: repos[] rides each row.
      await page.locator(".dropdown-trigger", { hasText: "Choose a repository" }).first().click();
      await page.waitForSelector(".dropdown-panel", { timeout: 6000 });
      const repoItems = await page.locator(".dropdown-panel .dropdown-item").allInnerTexts();
      ok(repoItems.some((t) => /acme\/web/.test(t)), `J16i (${theme}) the editor sees the chosen connection's repos (acme/web)`);
      ok(!repoItems.some((t) => /acme\/platform/.test(t)), `J16i (${theme}) the OTHER connection's repo is NOT offered to an editor either`);
      await page.locator(".dropdown-panel .dropdown-item", { hasText: "acme/web" }).first().click();

      // The union note belonged to a list that could not narrow. It must be gone.
      const formText = await page.locator(".container").innerText();
      ok(!/every repository across all connections/.test(formText), `J16i (${theme}) the "every repository" note is gone once the editor floor narrows`);

      // And the config an editor hands Jira is the same four keys.
      const saved = await page.evaluate(async () => JSON.parse(await window.__ON_CONFIGURE__()));
      ok(saved.connectionId === "gc_1" && saved.repo === "acme/web", `J16i (${theme}) the editor's config carries the connection AND the repo`);
    } catch (e) { fail++; console.log(`  ✗ J16i (${theme}) threw: ` + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ------------- J16j — F-369: NO connections configured, on both floors --------------
     Nothing to pick is a real state, and it must read as "an admin adds them", never as an
     empty control that looks broken. */
  for (const flags of [{ __CODE_NO_CONNS__: true }, { __CODE_NO_CONNS__: true, __REFUSE__: ["listGitConnections"], __REFUSE_ROLE__: "admin" }]) {
    const who = flags.__REFUSE__ ? "editor" : "admin";
    console.log(`J16j git group with NO connections (${who})`);
    const env = await openEditor(browser, "config-ui", "cfg-premade-git", "light", flags);
    const { page } = env;
    try {
      await page.locator(".dropdown-trigger", { hasText: "Choose a premade rule" }).first().click();
      await page.waitForSelector(".dropdown-panel", { timeout: 6000 });
      await page.locator(".dropdown-panel .dropdown-item", { hasText: "the pull request is merged" }).first().click();
      await page.waitForSelector(".pr-seg", { timeout: 6000 });
      const empty = page.locator(".dropdown-trigger", { hasText: "No git connections" }).first();
      ok(await empty.count() > 0, `J16j (${who}) the empty picker says an admin adds connections in Settings`);
      ok(await page.locator("select").count() === 0, `J16j (${who}) still no native <select>`);
      /* With no connection to pick the rule is INVALID, so the editor refuses to hand Jira
         a config at all - which is the right answer: a git rule with no connection is the
         unfinished config the executor would ALLOW every transition on. */
      const saved = await page.evaluate(async () => {
        const raw = await window.__ON_CONFIGURE__();
        if (raw == null || raw === "undefined") return null;
        try { return JSON.parse(raw); } catch (e) { return null; }
      });
      ok(!saved || !saved.connectionId, `J16j (${who}) nothing was invented for the saved config`);
    } catch (e) { fail++; console.log(`  ✗ J16j (${who}) threw: ` + e.message.split("\n")[0]); }
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
      ok(await firstBlock.locator(".gmc-fieldguide").count() === 1, "J18b the regenerated step carries a field-guide chip");
      ok(new RegExp(`Field guide: ${FG_TITLES.length} sections?`).test(await firstBlock.locator(".gmc-fieldguide").first().innerText()),
        "J18b and it counts the sections the fresh generation was shown");
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
      /* F-233 CONTROL — the same panel as an EDITOR-or-better must still offer the write.
         Without this arm the viewer assertions below pass just as well against a Memories
         tab that renders the add form for NOBODY, which is the other way to get this
         wrong and the one a permission fix is most likely to cause. */
      await kp.locator(".knowledge-tab-memories").click();
      await kp.locator(".memory-quick-add").first().waitFor({ timeout: 6000 });
      ok(await kp.locator(".btn-remember").count() > 0, "J21 an admin gets the Remember add form on the Memories tab");
      ok(await kp.locator(".memory-list .doc-btn-delete").count() > 0, "J21 an admin gets the per-row delete on the Memories tab");
      ok(await kp.locator(".memory-quick-add-note").count() === 0, "J21 an admin gets no non-editor note");
    } catch (e) { fail++; console.log("  ✗ J21 threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- F-233 — a VIEWER on the rule editor's Memories tab ----------------
     `addMemory` and `deleteMemory` both gate on requireRole(accountId, "editor")
     (src/index.js:7355 / 7442). MemoriesTab carried no role state at all, so the rule
     editor handed a viewer a text box and a solid teal "Remember" button — plus a per-row
     × — that the backend was always going to refuse. This is the config-ui twin of F-224,
     which fixed exactly this shape on the ADMIN Memories tab and left the copy inside the
     KnowledgePanel untouched; the component is byte-shared with admin-panel, so the same
     defect shipped in the rule wizard, the listeners tab and the jobs tab as well.
     The non-editor arm is a plain slate NOTE, not a disabled input: a greyed-out form
     reads as "try again later" when the answer is "not you, ever" (F-224's words).
     Both themes — the note is a new hue slot and the owner's law is that every one of
     them carries a dark override. */
  for (const T of ["light", "dark"]) {
    console.log(`F-233 viewer / rule-editor Memories tab (${T})`);
    const env = await openEditor(browser, "config-ui", "cfg-static", T, { __VIEWER__: true });
    const { page } = env;
    try {
      const kp = page.locator(".knowledge-panel").first();
      if (!(await kp.locator(".knowledge-tabs").isVisible().catch(() => false))) {
        await kp.locator(".knowledge-summary").click();
      }
      await kp.locator(".knowledge-tabs").waitFor({ timeout: 6000 });
      await kp.locator(".knowledge-tab-memories").click();
      // The READ survives — a viewer still sees what the AI is being told.
      await kp.locator(".memory-list .memory-item").first().waitFor({ timeout: 6000 });
      ok(await kp.getByText(/customfield_10003|resolution|Risk Level/i).count() > 0,
        `F-233 ${T} a viewer still READS the memories injected into every generation`);

      // The two WRITES are gone.
      ok(await kp.locator(".memory-quick-add").count() === 0, `F-233 ${T} no add form for a viewer`);
      ok(await kp.locator(".btn-remember").count() === 0, `F-233 ${T} no "Remember" button for a viewer`);
      ok(await kp.locator(".memory-list .doc-btn-delete").count() === 0, `F-233 ${T} no per-row delete for a viewer`);

      // ...and are REPLACED by an explanation, not left as a silent hole.
      const note = kp.locator(".memory-quick-add-note").first();
      ok(await note.count() > 0, `F-233 ${T} the viewer gets the slate non-editor note`);
      ok(/Editors and admins can add memories\./.test(await note.innerText()),
        `F-233 ${T} the note names the roles that CAN, in the admin tab's words`);

      /* Owner design law, ASSERTED not eyeballed: the note is a plain slate line — no
         left accent rail, solid colour, no tinted block. A rail on this element is the
         single most likely way a later edit breaks the rule. */
      const style = await note.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { bl: cs.borderLeftWidth, color: cs.color, bg: cs.backgroundColor };
      });
      ok(parseFloat(style.bl) === 0, `F-233 ${T} the note has NO left accent rail (got ${style.bl})`);
      const alpha = (style.color.match(/[\d.]+/g) || [])[3];
      ok(alpha === undefined || parseFloat(alpha) === 1, `F-233 ${T} the note colour is solid, not a faded alpha (${style.color})`);
      ok(/rgba\(0, 0, 0, 0\)|transparent/.test(style.bg), `F-233 ${T} the note is not a tinted block (${style.bg})`);
    } catch (e) { fail++; console.log("  ✗ F-233 " + T + " threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- F-243 — an UNREACHABLE JIRA on the rule editor's Memories tab -------
     F-233 gave config-ui its first role read and derived `canEdit` from it. But
     `checkIsAdmin` has a THIRD answer — `{ unknown: true }`, when the permission probe and
     the group scan BOTH threw — and config-ui had no name for it, so an outage collapsed
     into a verdict: a possible editor was told "Editors and admins can add memories.", which
     reads as "you are not one". False about them, names no outage, offers no action. The
     admin panel has told the truth about this since F-230.
     This asserts the SENTENCE, not merely that a note exists — the pre-fix build renders a
     note here too, and it is the wrong one. Both themes. */
  for (const T of ["light", "dark"]) {
    console.log(`F-243 role-unknown / rule-editor Memories tab (${T})`);
    const env = await openEditor(browser, "config-ui", "cfg-static", T, { __ROLE_UNKNOWN__: true });
    const { page } = env;
    try {
      const kp = page.locator(".knowledge-panel").first();
      if (!(await kp.locator(".knowledge-tabs").isVisible().catch(() => false))) {
        await kp.locator(".knowledge-summary").click();
      }
      await kp.locator(".knowledge-tabs").waitFor({ timeout: 6000 });
      await kp.locator(".knowledge-tab-memories").click();

      /* The WRITE still closes. `unknown` changes no access decision — the backend refuses
         either way — so a "fix" that opened the add form would be worse than the bug. */
      await kp.locator(".memory-quick-add-note").first().waitFor({ timeout: 6000 });
      ok(await kp.locator(".memory-quick-add").count() === 0, `F-243 ${T} no add form while the role is unverified`);
      ok(await kp.locator(".btn-remember").count() === 0, `F-243 ${T} no Remember button while the role is unverified`);

      const note = kp.locator(".memory-quick-add-note").first();
      const ntxt = (await note.innerText()).trim();
      ok(/could not verify your role with Jira just now/i.test(ntxt),
        `F-243 ${T} the note names the OUTAGE, not a verdict (got: ${JSON.stringify(ntxt)})`);
      ok(!/Editors and admins can add memories/.test(ntxt),
        `F-243 ${T} the note makes NO claim about this reader's role`);
      /* ONE HOME, proven: byte-identical to the admin panel's role-note sentence
         (listeners-jobs.test.mjs asserts that surface). Compared against the literal, not
         against itself — retyping is exactly how the two would drift. */
      ok(ntxt === "CogniRunner could not verify your role with Jira just now, reload to try again.",
        `F-243 ${T} the sentence matches the admin panel's byte for byte`);

      const st = await note.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { bl: cs.borderLeftWidth, color: cs.color, bg: cs.backgroundColor, fw: cs.fontWeight };
      });
      ok(parseFloat(st.bl) === 0, `F-243 ${T} outage note has NO left accent rail (got ${st.bl})`);
      const a243 = (st.color.match(/[\d.]+/g) || [])[3];
      ok(a243 === undefined || parseFloat(a243) === 1, `F-243 ${T} outage note colour is solid (${st.color})`);
      ok(/rgba\(0, 0, 0, 0\)|transparent/.test(st.bg), `F-243 ${T} outage note is not a tinted block (${st.bg})`);
      ok(parseInt(st.fw, 10) >= 600, `F-243 ${T} outage note keeps 600+ emphasis (got ${st.fw})`);
    } catch (e) { fail++; console.log("  \u2717 F-243 " + T + " threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ------- F-244/F-245/F-249/F-250 — a REFUSED read is not an outage (Knowledge panel) ---
     Every one of these surfaces answered a `{ success:false, reason:"no-permission" }` with
     the OUTAGE grammar: "Couldn't load X." plus a Retry button. Two lies in one control. The
     app is not broken — the backend answered, and the answer was "not you" — and Retry
     cannot ever succeed, so it keeps the reader pressing a button instead of telling them
     which role to ask for. F-242 made the refusal machine-readable; these four surfaces now
     branch on it and render the slate .access-note with the level and the owner named.
     The `__REFUSE__` fixture RESOLVES (unlike `__FAIL__`, which rejects) — that distinction
     is the whole finding, so the fixture has to model it.
     Both themes: .access-note is a new class and the owner's law is that every one carries
     a dark override. */
  for (const T of ["light", "dark"]) {
    console.log(`F-244/245/249/250 refused knowledge reads (${T})`);
    const env = await openEditor(browser, "config-ui", "cfg-static", T, {
      __REFUSE__: ["getContextDocs", "getSkills", "getMemories", "getKnowledgeCounts", "getSkillContent"],
      __REFUSE_ROLE__: "viewer",
    });
    const { page } = env;
    try {
      const kp = page.locator(".knowledge-panel").first();

      /* F-249 — the SUMMARY, before anything is opened. Three em-dashes are this app's
         symbol for "still loading", so a refused count read made the header look like a
         fetch that never finishes. */
      const summary = kp.locator(".knowledge-summary-counts").first();
      await summary.waitFor({ timeout: 8000 });
      const sumtxt = (await summary.innerText()).trim();
      ok(/No access to knowledge/i.test(sumtxt),
        `F-249 ${T} the summary says the counts were refused (got: ${JSON.stringify(sumtxt)})`);
      ok(!/—\s*docs/.test(sumtxt),
        `F-249 ${T} the summary does NOT render the "still loading" em-dashes`);

      if (!(await kp.locator(".knowledge-tabs").isVisible().catch(() => false))) {
        await kp.locator(".knowledge-summary").click();
      }
      await kp.locator(".knowledge-tabs").waitFor({ timeout: 6000 });

      /* The F-249 summary note is ALSO an .access-note — same grammar on purpose — so a
         bare `.first()` inside the panel matches the HEADER, not the tab body. Scope every
         tab assertion below to the body. (This bit me: the first run reported "No access to
         knowledge" as the docs sentence.) */
      const body = kp.locator(".doc-repo-embedded:visible");

      // F-244 — documents.
      await kp.locator(".knowledge-tab-docs").click();
      const dn = body.locator(".access-note").first();
      await dn.waitFor({ timeout: 8000 });
      const dtxt = (await dn.innerText()).trim();
      ok(/You need CogniRunner viewer access to see documents\./.test(dtxt),
        `F-244 ${T} docs: the refusal names the LEVEL required (got: ${JSON.stringify(dtxt)})`);
      ok(/Ask a CogniRunner admin under Permissions\./.test(dtxt),
        `F-244 ${T} docs: the refusal names WHO can change it`);
      ok(await kp.locator(".btn-retry").count() === 0,
        `F-244 ${T} docs: NO Retry button — it could only re-ask and be refused again`);
      ok(!/Couldn.t load documents/i.test(await kp.innerText()),
        `F-244 ${T} docs: the outage sentence is gone`);

      // F-244 — skills.
      await kp.locator(".knowledge-tab-skills").click();
      const sn = body.locator(".access-note").first();
      await sn.waitFor({ timeout: 8000 });
      ok(/You need CogniRunner viewer access to see skills\./.test((await sn.innerText()).trim()),
        `F-244 ${T} skills: the refusal names the level required`);
      ok(await kp.locator(".btn-retry").count() === 0, `F-244 ${T} skills: NO Retry button`);
      ok(!/Couldn.t load skills/i.test(await kp.innerText()), `F-244 ${T} skills: the outage sentence is gone`);

      // F-245 — memories, the Knowledge-panel copy F-234 never reached.
      await kp.locator(".knowledge-tab-memories").click();
      const mn = body.locator(".access-note").first();
      await mn.waitFor({ timeout: 8000 });
      ok(/You need CogniRunner viewer access to see memories\./.test((await mn.innerText()).trim()),
        `F-245 ${T} memories: the refusal names the level required`);
      ok(await kp.locator(".btn-retry").count() === 0, `F-245 ${T} memories: NO Retry button`);
      ok(!/Couldn.t load memories/i.test(await kp.innerText()), `F-245 ${T} memories: the outage sentence is gone`);

      /* Owner design law on the new class, in BOTH themes. Asserted on a live element, not
         read off the stylesheet — a rail added by a more specific selector would still
         pass a source grep. */
      const st = await mn.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { bl: cs.borderLeftWidth, color: cs.color, bg: cs.backgroundColor, fw: cs.fontWeight };
      });
      ok(parseFloat(st.bl) === 0, `F-244 ${T} .access-note has NO left accent rail (got ${st.bl})`);
      const al = (st.color.match(/[\d.]+/g) || [])[3];
      ok(al === undefined || parseFloat(al) === 1, `F-244 ${T} .access-note colour is solid, not faded (${st.color})`);
      ok(/rgba\(0, 0, 0, 0\)|transparent/.test(st.bg), `F-244 ${T} .access-note is not a tinted block (${st.bg})`);
      ok(parseInt(st.fw, 10) >= 600, `F-244 ${T} .access-note carries the 600+ emphasis weight (got ${st.fw})`);
      /* The dark override exists and actually CHANGES the colour — a new hue with no dark
         arm is the owner's named failure, and asserting only "not empty" would miss it. */
      ok(st.color === (T === "dark" ? "rgb(100, 116, 139)" : "rgb(71, 85, 105)"),
        `F-244 ${T} .access-note uses the ${T} slate (#${T === "dark" ? "64748b" : "475569"}) — got ${st.color}`);
    } catch (e) { fail++; console.log("  \u2717 F-244/245/249 " + T + " threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* F-250 — the EXPANDED skill row. `getSkillContent` refusing left `expandedContent` null,
     which is the same state as "not fetched yet", so the row opened onto a silent empty
     panel. Needs the list to LOAD (so there are rows to click) and only the content call to
     be refused — a distinction the per-resolver __REFUSE__ list makes expressible. */
  {
    console.log("F-250 refused skill content (light)");
    const env = await openEditor(browser, "config-ui", "cfg-static", "light", {
      __REFUSE__: ["getSkillContent"], __REFUSE_ROLE__: "viewer",
    });
    const { page } = env;
    try {
      const kp = page.locator(".knowledge-panel").first();
      if (!(await kp.locator(".knowledge-tabs").isVisible().catch(() => false))) {
        await kp.locator(".knowledge-summary").click();
      }
      await kp.locator(".knowledge-tabs").waitFor({ timeout: 6000 });
      await kp.locator(".knowledge-tab-skills").click();
      const row = kp.locator(".skill-item").first();
      await row.waitFor({ timeout: 8000 });
      ok(await kp.locator(".access-note").count() === 0, "F-250 the skills LIST still loads — only the content read is refused");
      /* Expansion is the PREVIEW button. Clicking the row body toggles SELECTION instead —
         which is what the first version of this test did, and it duly reported an
         unexpanded row as "no message". */
      await row.locator(".doc-btn-preview").click();
      await page.waitForTimeout(600);
      const txt = (await kp.innerText());
      ok(/You need CogniRunner viewer access to see this skill\./.test(txt),
        `F-250 the expanded row says WHY it is empty (got: ${JSON.stringify(txt.slice(0, 400))})`);
    } catch (e) { fail++; console.log("  \u2717 F-250 threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* F-246 — the role probe must NOT block the editor's first paint.
     F-233 put an awaited `checkIsAdmin` on the line above `setLoading(false)`, so a Jira that
     accepts the connection and never answers held the workflow editor on its skeleton until
     the 25s resolver cap — over a lookup whose only consumer is the wording of one note in a
     collapsed panel. `__HOLD__` parks the resolver in flight, which is the only way to
     express "slow" as opposed to "failed": a rejecting mock takes the catch arm immediately
     and would pass against the broken build. */
  {
    console.log("F-246 role probe does not block first paint");
    const env = await openEditor(browser, "config-ui", "cfg-static", "light", { __HOLD__: ["checkIsAdmin"] });
    const { page } = env;
    try {
      /* The editor is INTERACTIVE while the probe is still pending. openEditor already waits
         for .container with no .sk, so reaching here at all is most of the assertion; the
         locators below prove it is the real editor and not an empty shell. */
      ok(await page.locator(".function-block").count() > 0, "F-246 the step editor rendered while checkIsAdmin is still in flight");
      ok(await page.locator(".container .sk").count() === 0, "F-246 no loading skeleton remains while the probe hangs");
      const kp = page.locator(".knowledge-panel").first();
      ok(await kp.count() > 0, "F-246 the Knowledge panel rendered too");

      /* Fail-CLOSED until the answer lands: no role known means no write offered and — this
         is the F-243 half — no claim made about the reader either. */
      if (!(await kp.locator(".knowledge-tabs").isVisible().catch(() => false))) {
        await kp.locator(".knowledge-summary").click();
      }
      await kp.locator(".knowledge-tab-memories").click();
      ok(await kp.locator(".memory-quick-add").count() === 0, "F-246 the add form stays closed while the role is unknown");
    } catch (e) { fail++; console.log("  \u2717 F-246 threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* F-252 — an OWNERSHIP refusal must not be told as a role problem.
     `hint: "not-owner"` arrives WITHOUT `needsRole`, because no role fixes it: the rule
     belongs to another editor, and the reader may already be a CogniRunner admin. Rendering
     the role sentence here would tell an admin with every permission in the product to go
     ask an admin for access — false, unactionable, and the exact shape of the F-234 defect
     one vocabulary further along. Asserted through the real render path, not just the helper,
     because the bug would live in a call site that ignores `hint`. */
  {
    console.log("F-252 ownership refusal is not a role refusal");
    const env = await openEditor(browser, "config-ui", "cfg-static", "light", {
      __REFUSE__: ["getMemories"], __REFUSE_HINT__: "not-owner",
    });
    const { page } = env;
    try {
      const kp = page.locator(".knowledge-panel").first();
      if (!(await kp.locator(".knowledge-tabs").isVisible().catch(() => false))) {
        await kp.locator(".knowledge-summary").click();
      }
      await kp.locator(".knowledge-tabs").waitFor({ timeout: 6000 });
      await kp.locator(".knowledge-tab-memories").click();
      const note = kp.locator(".doc-repo-embedded:visible .access-note").first();
      await note.waitFor({ timeout: 8000 });
      const t = (await note.innerText()).replace(/\s+/g, " ").trim();
      ok(/This rule belongs to another editor; only its author or an admin can change it\./.test(t),
        `F-252 the note states OWNERSHIP, not a missing role (got: ${JSON.stringify(t)})`);
      ok(!/You need CogniRunner/.test(t), "F-252 it does not claim a role level is missing");
      ok(!/Ask a CogniRunner admin under Permissions/.test(t),
        "F-252 it does not send the reader to ask for a role that would not help");
      ok(await kp.locator(".btn-retry").count() === 0, "F-252 still no Retry — ownership will not change on a re-ask");
    } catch (e) { fail++; console.log("  \u2717 F-252 threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* F-255 — an EDITION denial must NOT be absorbed into the refusal grammar.
     `reason: "upgrade-required"` is a statement about the SITE'S PLAN, not about this
     reader: their role is fine and no CogniRunner admin can grant their way out of it. The
     risk this asserts against is a well-meaning edit widening `isPermissionRefusal` to "any
     refusal-looking result", which would route a billing question to the Permissions tab and
     silently replace the upgrade copy that already exists. The load-bearing assertion is the
     NEGATIVE one: the permission note must be absent. */
  {
    console.log("F-255 an edition denial is not a permission refusal");
    const env = await openEditor(browser, "config-ui", "cfg-static", "light", {
      __UPGRADE__: ["getMemories"], __UPGRADE_FEATURE__: "static-post-function",
    });
    const { page } = env;
    try {
      const kp = page.locator(".knowledge-panel").first();
      if (!(await kp.locator(".knowledge-tabs").isVisible().catch(() => false))) {
        await kp.locator(".knowledge-summary").click();
      }
      await kp.locator(".knowledge-tabs").waitFor({ timeout: 6000 });
      await kp.locator(".knowledge-tab-memories").click();
      await page.waitForTimeout(700);
      const panel = (await kp.innerText());
      ok(await kp.locator(".doc-repo-embedded:visible .access-note").count() === 0,
        "F-255 no permission note — an edition denial is not a role problem");
      ok(!/You need CogniRunner \w+ access/.test(panel),
        "F-255 the panel never asks the reader to get a role for a plan limit");
      ok(!/Ask a CogniRunner admin under Permissions/.test(panel),
        "F-255 and never sends a billing question to the Permissions tab");
    } catch (e) { fail++; console.log("  \u2717 F-255 threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* F-273 — and now the POSITIVE half of F-255.
     F-255 proved an edition denial is not absorbed into the permission grammar. It did not
     prove the reader is told anything, and they were not: `upgrade-required` matched neither
     the success arm nor isPermissionRefusal on all four knowledge surfaces, so it fell
     through to the OUTAGE arm — "Couldn't load memories." beside a Retry. A false claim
     (nothing is broken; the app works exactly as sold) plus a control that CANNOT succeed,
     because no number of re-asks changes which edition the site is on. The negative
     assertions alone would stay green against that bug, which is why this arm exists.

     BOTH THEMES, because this introduces a NEW HUE, and every new hue needs a dark-mode
     override. The colour is read live from getComputedStyle rather than eyeballed in a
     screenshot, so a missing override fails the run instead of surviving as a washed-out
     orange nobody looks at. */
  for (const theme of ["light", "dark"]) {
    console.log(`F-273 ${theme} an edition denial is told as an upgrade, not an outage`);
    const env = await openEditor(browser, "config-ui", "cfg-static", theme, {
      __UPGRADE__: ["getMemories"], __UPGRADE_FEATURE__: "coder",
    });
    const { page } = env;
    try {
      const kp = page.locator(".knowledge-panel").first();
      if (!(await kp.locator(".knowledge-tabs").isVisible().catch(() => false))) {
        await kp.locator(".knowledge-summary").click();
      }
      await kp.locator(".knowledge-tabs").waitFor({ timeout: 6000 });
      await kp.locator(".knowledge-tab-memories").click();
      const note = kp.locator(".upgrade-note").first();
      await note.waitFor({ timeout: 8000 });

      /* The two false things the reader used to be shown. Their ABSENCE is the fix — the
         note merely being present would not prove the outage arm stopped firing. */
      ok(await kp.locator(".load-error").count() === 0,
        `F-273 ${theme} an edition denial is NOT rendered as a failed load`);
      ok(await kp.locator(".btn-retry").count() === 0,
        `F-273 ${theme} and offers no Retry — no retry buys a licence`);
      ok(await kp.locator(".doc-repo-embedded:visible .access-note").count() === 0,
        `F-273 ${theme} and is still not mistold as a role refusal (F-255 holds)`);

      const txt = (await note.innerText()).replace(/\s+/g, " ").trim();
      ok(/This needs CogniRunner Coder\./.test(txt),
        `F-273 ${theme} the note names the edition — got: ${JSON.stringify(txt)}`);
      ok(/Upgrade CogniRunner under Apps, Manage apps to unlock /.test(txt),
        `F-273 ${theme} and names the remedy and where to do it — got: ${JSON.stringify(txt)}`);
      /* F-915 — Settings is where the PROVIDER is chosen; the EDITION is a Marketplace
         subscription changed under Apps, Manage apps. Sending a paying admin to Settings
         over a billing question is F-255's defect in the other direction, so the sentence
         names both places and gives each one its subject. */
      ok(/CogniRunner Settings changes the AI provider, not the edition/.test(txt),
        `F-915 ${theme} Settings is named for what it DOES change — got: ${JSON.stringify(txt)}`);
      /* F-330 — the body under that headline is a sentence: it opens with a capital and does
         not say "Coder" a second and third time. Asserted on the LIVE render, not the pure
         function, because the defect was only ever visible as two stacked lines. */
      ok(/This needs CogniRunner Coder\. Upgrade CogniRunner under Apps, Manage apps to unlock /.test(txt),
        `F-330 ${theme} headline then a capitalised one-clause body — got: ${JSON.stringify(txt)}`);
      ok(!/Coder edition/.test(txt),
        `F-330 ${theme} the body does not re-announce the edition the headline just named — got: ${JSON.stringify(txt)}`);

      /* Owner design law, asserted live in BOTH themes: solid saturated orange, white text,
         no left accent rail, no faded low-alpha tint. */
      const st = await note.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { bl: cs.borderLeftWidth, bt: cs.borderTopWidth, color: cs.color, bg: cs.backgroundColor };
      });
      ok(st.bl === st.bt, `F-273 ${theme} the upgrade note has NO left accent rail`);
      const bg = (st.bg.match(/[\d.]+/g) || []).map(Number);
      /* F-298 — the dark fill moved from #f59e0b (amber-500) to #d97706 (amber-600).
         White text on amber-500 is ~2.1:1: legible to nobody who needs contrast, and it
         reads as a highlighter wash rather than the solid statement the owner asked for.
         Everywhere else in the app #f59e0b carries DARK text (#2a1602); this note keeps
         WHITE text because white-on-solid is the grammar for a filled note, so the fill
         is what had to move. */
      const wantBg = theme === "dark" ? [217, 119, 6] : [180, 83, 9];
      ok(bg.slice(0, 3).every((v, i) => Math.abs(v - wantBg[i]) <= 2),
        `F-273 ${theme} the fill is the solid orange ${wantBg.join(",")} — got ${st.bg}`);
      /* Alpha 1 states the "no faded tint" law numerically — a 10% wash would still match
         the hue above, and is exactly what the owner rejects. */
      ok(bg.length < 4 || bg[3] === 1,
        `F-273 ${theme} the fill is SOLID, not a low-alpha tint — got ${st.bg}`);
      const fg = (st.color.match(/\d+/g) || []).map(Number);
      ok(fg.slice(0, 3).every((v) => v >= 250), `F-273 ${theme} the text is white — got ${st.color}`);

      /* F-298 — and the pair is MEASURED, not eyeballed. A hue assertion alone would have
         stayed green on the amber-500 fill that caused this finding: it named the right
         colour family and still could not be read. 3:1 is the WCAG floor for large/bold
         text, which is what this note is (12px 700 title on a solid fill). Computed here
         rather than trusted from the constants above so a future re-tint of either the
         fill or the text has to pass the ratio, not just look like orange. */
      const lum = (rgb) => {
        const c = rgb.slice(0, 3).map((v) => {
          const x = v / 255;
          return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      };
      const lf = lum(fg), lb = lum(bg);
      const ratio = (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05);
      ok(ratio >= 3, `F-298 ${theme} the upgrade note clears 3:1 text/fill contrast — got ${ratio.toFixed(2)}:1`);

      /* The header counts, the fourth surface: three em-dashes are the app's symbol for
         "still loading", so a refused count read made the panel look permanently mid-fetch. */
      const summary = (await kp.locator(".knowledge-summary-counts").first().innerText()).replace(/\s+/g, " ").trim();
      ok(!/—\s*(docs|memories)/.test(summary),
        `F-273 ${theme} the summary does not imply a fetch that will never finish — got: ${JSON.stringify(summary)}`);

      /* No screenshot here on purpose: this file has no shot plumbing, and the colour is
         already asserted from getComputedStyle above — which is the STRONGER check. A PNG
         proves a human could have looked; the assertion fails the run when nobody does. */
    } catch (e) { fail++; console.log(`  ✗ F-273 ${theme} threw: ` + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* F-273 CONTROL — a genuine transport failure must STILL retry.
     The arm that stops the fix from over-reaching: if a later edit routed every
     unsuccessful load to the upgrade note, the journey above would stay green while the
     real retry path quietly disappeared for everyone. One theme — a behaviour claim, not a
     colour claim. */
  {
    console.log("F-273 CONTROL a thrown knowledge read is still a retryable outage");
    const env = await openEditor(browser, "config-ui", "cfg-static", "light", {
      __FAIL__: ["getMemories"],
    });
    const { page } = env;
    try {
      const kp = page.locator(".knowledge-panel").first();
      if (!(await kp.locator(".knowledge-tabs").isVisible().catch(() => false))) {
        await kp.locator(".knowledge-summary").click();
      }
      await kp.locator(".knowledge-tabs").waitFor({ timeout: 6000 });
      await kp.locator(".knowledge-tab-memories").click();
      await kp.locator(".load-error").first().waitFor({ timeout: 8000 });
      ok(await kp.locator(".btn-retry").count() >= 1,
        "F-273 CONTROL a transport failure still offers Retry");
      ok(await kp.locator(".upgrade-note").count() === 0,
        "F-273 CONTROL and is NOT mistold as an edition denial");
    } catch (e) { fail++; console.log("  ✗ F-273 CONTROL threw: " + e.message.split("\n")[0]); }
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
  const CANCEL_TEXT = /Cancelled, nothing was changed/;
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
  const KEPT_TEXT = /Generation failed, your existing code was kept/;
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
        ok(/Nothing was kept/.test(note) && /memory store is full/i.test(note),
          `F-158 ${T} the note says nothing was kept and why (got: ${note})`);
        // F-181 — the note must be the BACKEND'S sentence, verbatim, not a second one
        // retyped in the component. The mock answers addMemory with the shared
        // memoryCapRefusalMessage(), so asserting against that same import proves the
        // words travelled end to end instead of two surfaces happening to agree.
        ok(note.includes(memoryCapRefusalMessage("cap")),
          `F-158/F-181 ${T} the note carries the resolver's own refusal verbatim (got: ${note})`);
        // The words the app does not use, and must never retype here again.
        ok(!/prune/i.test(note), `F-181 ${T} the note never says "prune" — no control in this app prunes`);
        ok(!/merge/i.test(note), `F-181 ${T} the note never offers "merge" — there is no merge control`);
        // Slate, never the teal "learned" hue — and it must resolve in BOTH themes.
        const color = await b.locator(".memory-not-kept").first().evaluate((el) => getComputedStyle(el).color);
        ok(color === (theme === "dark" ? "rgb(100, 116, 139)" : "rgb(71, 85, 105)"),
          `F-158 ${T} the note is slate for this theme (got: ${color})`);
        // F-190 — the TOAST is the surface the author is actually looking at while the step
        // is busy; the inline note is below the fold of their attention. It must carry the
        // resolver's own sentence too, not a second one retyped here.
        const capToast = await page.locator(".mls-toast").first().innerText();
        ok(capToast.includes(memoryCapRefusalMessage("cap")),
          `F-190 ${T} the cap TOAST carries the resolver's refusal verbatim (got: ${capToast})`);
        ok(!/Nothing was learned from it/.test(capToast),
          `F-190 ${T} the cap toast never reports an outcome with no cause`);
      } catch (e) { fail++; console.log(`  ✗ F-158 cap ${T} threw: ` + e.message.split("\n")[0]); }
      await closeEditor(env);
    }

    /* F-190 — the OTHER refusal reason: the byte guard (`reason: "bytes"`) --------------
     * F-181 gave the inline note the backend's words and left the toast branching on
     * `reason === "cap"` alone. A byte-guard refusal therefore fell to the else and said
     * "Fix verified. Nothing was learned from it." — an outcome with no cause, and the one
     * refusal a user cannot diagnose from anywhere else in the app: the Memories tab shows
     * a row count nowhere near 200, so a causeless toast reads as the AI deciding the
     * lesson was not worth keeping. Both surfaces now read `memRes.error`. */
    {
      console.log(`F-190 a BYTE-guard refusal names its cause on both surfaces (cfg-static, ${theme})`);
      const env = await openEditor(browser, "config-ui", "cfg-static", theme, {
        __TESTFAIL_ONCE__: true,
        __FIX_MEMORY__: true,
        __MEMORY_BYTES__: true,
      });
      const { page } = env;
      try {
        const b = page.locator(".function-block").first();
        await b.locator(".btn-test-run", { hasText: /Test Run/ }).click();
        await b.locator(".btn-run-test", { hasText: "Run Test" }).click();
        await b.locator(".test-result.test-fail").waitFor({ timeout: 10000 });
        await b.locator(".btn-fix-ai", { hasText: "Fix with AI" }).click();
        await b.locator(".memory-not-kept").first().waitFor({ timeout: 15000 });

        const bytesMsg = memoryCapRefusalMessage("bytes");
        // The two refusal sentences must actually DIFFER, or this test proves nothing:
        // a component that hardcoded the cap wording would pass a comparison against
        // whichever sentence it happened to have typed.
        ok(bytesMsg !== memoryCapRefusalMessage("cap"),
          `F-190 ${T} the byte and row refusals are genuinely different sentences`);

        const note = await b.locator(".memory-not-kept").first().innerText();
        ok(note.includes(bytesMsg), `F-190 ${T} the note carries the BYTE refusal verbatim (got: ${note})`);
        ok(!note.includes(memoryCapRefusalMessage("cap")),
          `F-190 ${T} the note does not show row-cap wording for a byte refusal`);
        ok(/size limit/i.test(note), `F-190 ${T} the note names a SIZE limit, not a count`);

        // THE defect: this toast used to read "Fix verified. Nothing was learned from it."
        const toast = await page.locator(".mls-toast").first().innerText();
        ok(/Fix verified/.test(toast), `F-190 ${T} the toast still confirms the fix itself worked (got: ${toast})`);
        ok(toast.includes(bytesMsg),
          `F-190 ${T} the toast names the BYTE cause, from the resolver's own sentence (got: ${toast})`);
        ok(!/Nothing was learned from it/.test(toast),
          `F-190 ${T} the toast is never a causeless "Nothing was learned from it."`);
        ok(!/memory store is full/i.test(toast),
          `F-190 ${T} the toast does not mislabel a byte refusal as a full store`);

        // Still not a memory: no badge, no veto. The F-158 contract is unchanged.
        ok(await b.locator(".memory-saved-badge").count() === 0, `F-190 ${T} no badge — nothing was stored`);
        // And it is a SUCCESS toast: the fix landed, only the lesson did not.
        ok(await page.locator(".mls-toast-error").count() === 0,
          `F-190 ${T} a refused memory is not an error toast — the fix itself verified`);
      } catch (e) { fail++; console.log(`  ✗ F-190 bytes ${T} threw: ` + e.message.split("\n")[0]); }
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

  /* ---------------- E4b — F-634: the embedded doc PREVIEW is refused, not broken ----------
   * The rule editor's Documentation tab is DocRepository.jsx (the duplicated component, so
   * this case covers the admin wizard's copy too). F-626 gave `getContextDocContent` the
   * F-235 viewer floor; the component still branched on `result.success` alone and dropped
   * the backend's permission sentence into the red error text - an outage claim for a
   * decision the backend made on purpose, and no remedy for the one thing the reader can act
   * on. E4 above is the deliberate twin: the LIST read failing is still an outage with a
   * Retry, and these two must never collapse into each other.
   *
   * `__REFUSE__` on the single door, not `__NO_ROSTER__`: the tenant-wide state refuses
   * `getContextDocs` as well, so no doc row renders and there is nothing to expand. Both
   * themes, because .access-note makes a coloured claim. */
  for (const theme of ["light", "dark"]) {
    console.log(`E4b Documentation preview REFUSED (getContextDocContent) — ${theme}`);
    const env = await openEditor(browser, "config-ui", "cfg-static", theme, { __REFUSE__: ["getContextDocContent"], __REFUSE_ROLE__: "viewer" });
    const { page } = env;
    try {
      const kp = page.locator(".knowledge-panel").first();
      if (!(await kp.locator(".knowledge-tabs").isVisible().catch(() => false))) await kp.locator(".knowledge-summary").click();
      await kp.locator(".knowledge-tab-docs").click();
      // The LIST is fine — the control arm. Without it this case could pass against a panel
      // that refused everything and rendered no rows at all.
      await kp.locator(".doc-item").first().waitFor({ timeout: 8000 });
      ok(await kp.locator(".access-note").count() === 0, `E4b ${theme} the docs list itself is NOT refused`);
      ok(await kp.locator(".load-error").count() === 0, `E4b ${theme} and is not an outage either`);

      await kp.locator(".doc-item .doc-btn-preview").first().click();
      const note = kp.locator(".doc-preview .access-note").first();
      await note.waitFor({ timeout: 8000 });
      const t = (await note.innerText()).replace(/\s+/g, " ").trim();
      ok(/You need CogniRunner viewer access to see this document\./.test(t),
        `E4b ${theme} the note names the LEVEL the gate asked for (got: ${t})`);
      ok(/Ask a CogniRunner admin under Permissions\./.test(t),
        `E4b ${theme} and names WHO can grant it, and where`);
      ok(await kp.locator(".doc-preview-content").count() === 0,
        `E4b ${theme} and no body is rendered — the content was withheld, not emptied`);

      // Owner design law, read live: slate, bold, no rail, no tint.
      const st = await note.evaluate((el) => {
        const c = getComputedStyle(el);
        return { fg: c.color, w: c.fontWeight, bl: c.borderLeftWidth, bt: c.borderTopWidth, bg: c.backgroundColor };
      });
      const rgb = st.fg.match(/\d+/g).map(Number);
      const wantSlate = theme === "dark" ? [100, 116, 139] : [71, 85, 105];
      ok(rgb.slice(0, 3).every((v, i) => Math.abs(v - wantSlate[i]) <= 2),
        `E4b ${theme} the note is the neutral slate ${wantSlate.join(",")} — got ${st.fg}`);
      ok(Number(st.w) >= 600, `E4b ${theme} 600+ weight — got ${st.w}`);
      ok(st.bl === st.bt, `E4b ${theme} NO left accent rail`);
      ok(/rgba\(0, 0, 0, 0\)|transparent/.test(st.bg), `E4b ${theme} not a tinted block — got ${st.bg}`);
    } catch (e) { fail++; console.log(`  ✗ E4b ${theme} threw: ` + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- E4c — F-634 CONTROL: a FAULT on the same door keeps the error text -----
   * The over-reach arm. A thrown content read is TRANSPORT — the resolver never answered —
   * and must stay an error, not become a permission note. Without this, routing every
   * unsuccessful body read to .access-note would leave E4b green. One theme. */
  {
    console.log("E4c Documentation preview THROWS — still an error, not a refusal");
    const env = await openEditor(browser, "config-ui", "cfg-static", "light", { __FAIL__: ["getContextDocContent"] });
    const { page } = env;
    try {
      const kp = page.locator(".knowledge-panel").first();
      if (!(await kp.locator(".knowledge-tabs").isVisible().catch(() => false))) await kp.locator(".knowledge-summary").click();
      await kp.locator(".knowledge-tab-docs").click();
      await kp.locator(".doc-item").first().waitFor({ timeout: 8000 });
      await kp.locator(".doc-item .doc-btn-preview").first().click();
      await kp.getByText(/Failed to load content/i).first().waitFor({ timeout: 8000 });
      ok(await kp.locator(".doc-preview .access-note").count() === 0,
        "E4c a transport failure is NOT mistold as an access refusal");
    } catch (e) { fail++; console.log("  ✗ E4c threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- E4d — F-896: the Add-Document size hint, in BOTH of its homes --------
   * The whole finding is that there were TWO Add-Document forms measuring DIFFERENT things.
   * config-ui's DocRepository.jsx counted UTF-8 bytes with `utf8Bytes` and gated Save on the
   * cap (F-836 fixed it there). admin-panel's DocsTab.jsx carried its own two-line
   * `formatSize` fed with `newContent.length` — UTF-16 code units labelled "B" — with no cap
   * gate at all. Measured live in dev: 100 rocket emoji is 200 characters and 400 UTF-8
   * bytes, and that form read "200 B".
   *
   * So this case drives BOTH forms with the SAME non-ASCII fixture and the same over-cap
   * fixture and demands the same answer from each. Asserting only the fixed form would let
   * the pair drift apart again, which is precisely how the defect survived F-836.
   *
   * The emoji is written as a surrogate PAIR on purpose: it is the difference between the
   * two measures (2 code units, 4 bytes), so a hint that answers 200 for this input has
   * been caught counting the wrong thing. */
  {
    const { DOC_CONTENT_MAX_BYTES, DOC_CONTENT_MAX_LABEL, utf8Bytes } =
      await import("../../src/shared/registry-limits.js");
    const ROCKETS = "\u{1F680}".repeat(100);
    const OVER = "x".repeat(DOC_CONTENT_MAX_BYTES + 1);
    // The harness states the arithmetic itself rather than trusting the number it expects.
    ok(ROCKETS.length === 200, `E4d fixture is 200 UTF-16 code units (got ${ROCKETS.length})`);
    ok(utf8Bytes(ROCKETS) === 400, `E4d fixture is 400 UTF-8 bytes (got ${utf8Bytes(ROCKETS)})`);

    /* Open the Add-Document form in whichever home this page is, and answer the two
       locators that differ between them. Everything asserted after this is identical. */
    const openAddForm = async (page, home) => {
      if (home === "config-ui") {
        const kp = page.locator(".knowledge-panel").first();
        if (!(await kp.locator(".knowledge-tabs").isVisible().catch(() => false))) await kp.locator(".knowledge-summary").click();
        await kp.locator(".knowledge-tab-docs").click();
        await kp.locator(".btn-add-doc").first().click();
        return { scope: kp, textarea: kp.locator("textarea.doc-content-input").first(), title: kp.locator(".doc-add-form input.input").first() };
      }
      await page.locator(".tab-btn", { hasText: /^\s*Documentation\s*$/ }).first().click();
      await page.locator(".docs-tab").waitFor({ timeout: 10000 });
      await page.locator(".docs-tab .section-actions button", { hasText: "+ Add Document" }).first().click();
      const scope = page.locator(".docs-tab").first();
      return { scope, textarea: scope.locator("textarea").first(), title: scope.locator("input.doc-input").first() };
    };

    for (const theme of ["light", "dark"]) {
      for (const home of ["config-ui", "admin-panel"]) {
        console.log(`E4d Add-Document size hint — ${home}, ${theme}`);
        const env = home === "config-ui"
          ? await openEditor(browser, "config-ui", "cfg-static", theme)
          : await openEditor(browser, "admin-panel", "admin", theme);
        const { page } = env;
        try {
          const { scope, textarea, title } = await openAddForm(page, home);
          await textarea.waitFor({ timeout: 10000 });
          await title.fill("Byte counting");

          // 1. THE DEFECT. Bytes, not characters.
          await textarea.fill(ROCKETS);
          await page.waitForTimeout(200);
          const hint = scope.locator(".doc-size-hint").last();
          const txt = (await hint.innerText()).trim();
          ok(txt === "400 B",
            `E4d ${home}/${theme} 100 emoji reads 400 B, the UTF-8 byte count (got "${txt}")`);
          ok(txt !== "200 B",
            `E4d ${home}/${theme} and is NOT the character count the backend does not gate on`);
          ok(await hint.evaluate((el) => el.classList.contains("is-over")) === false,
            `E4d ${home}/${theme} a 400 byte document is not flagged too large`);
          await shot(page, `E4d-doc-size-bytes-${home}-${theme}`);

          // 2. THE CAP. Same element, same sentence, Save dead, in both homes.
          await textarea.fill(OVER);
          await page.waitForTimeout(250);
          const overTxt = (await hint.innerText()).replace(/\s+/g, " ").trim();
          ok(overTxt.includes(`too large, max ${DOC_CONTENT_MAX_LABEL}`),
            `E4d ${home}/${theme} the too-large clause names the cap from the one home (got "${overTxt}")`);
          /* ONE UNIT IN ONE SENTENCE. `formatSize` used to divide by 1024 while the cap
             label divides by 1000, so a draft one byte over rendered
             "195.3 KB (too large, max 200 KB)" - a refusal arguing with itself. The
             number now has to be at least the cap it is being refused against. */
          const shownKb = parseFloat(overTxt);
          ok(shownKb >= parseFloat(DOC_CONTENT_MAX_LABEL),
            `E4d ${home}/${theme} the size shown is not SMALLER than the cap it exceeds (got "${overTxt}")`);
          ok(!overTxt.includes("—") && !overTxt.includes("–"),
            `E4d ${home}/${theme} no em/en dash in the hint`);
          ok(await hint.evaluate((el) => el.classList.contains("is-over")) === true,
            `E4d ${home}/${theme} the hint carries the over-cap state`);
          const st = await hint.evaluate((el) => {
            const c = getComputedStyle(el);
            return { fg: c.color, w: c.fontWeight, bl: c.borderLeftWidth, bt: c.borderTopWidth, op: c.opacity };
          });
          const want = theme === "dark" ? [239, 68, 68] : [220, 38, 38];
          const rgb = st.fg.match(/\d+/g).map(Number);
          ok(rgb.slice(0, 3).every((v, i) => Math.abs(v - want[i]) <= 2),
            `E4d ${home}/${theme} the over-cap hint is the solid red ${want.join(",")} (got ${st.fg})`);
          ok(Number(st.w) >= 700, `E4d ${home}/${theme} 700 weight on the refusal (got ${st.w})`);
          ok(st.op === "1", `E4d ${home}/${theme} solid, not a faded tint (opacity ${st.op})`);
          ok(st.bl === st.bt, `E4d ${home}/${theme} no left accent rail`);

          const save = home === "config-ui"
            ? scope.locator(".btn-save-doc").first()
            : scope.locator("button", { hasText: /^Save$/ }).first();
          ok(await save.isDisabled(),
            `E4d ${home}/${theme} Save is disabled over the cap, so the form cannot reach a backend refusal`);
          await shot(page, `E4d-doc-size-too-large-${home}-${theme}`);
        } catch (e) { fail++; console.log(`  ✗ E4d ${home}/${theme} threw: ` + e.message.split("\n")[0]); }
        await closeEditor(env);
      }
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

  /* ---------------- E1b — F-555: a managed-engine tenant is NOT warned ----------------
     The managed engine (CogniRunner Cloud AI) reports `hasKey: false` honestly — its
     credential is LeanZero's env var, never a KVS slot — together with `noKeyNeeded: true`.
     config-ui used to read `hasKey !== false` alone and so told a tenant on a WORKING
     provider that its rules fail open, pointing at a Settings key field that does not exist
     for that engine. E1 above is the other half of the pair: the BYOK-without-key case must
     keep warning, so this fix cannot be "stop warning".

     The absence assertion is guarded by a positive control first (the hydrated prompt
     textarea): an editor that failed to render also has no .provider-warning, and that
     must not read as a pass. */
  for (const theme of ["light", "dark"]) {
    console.log(`E1b managed engine → no provider warning (cfg-validator, ${theme})`);
    const env = await openEditor(browser, "config-ui", "cfg-validator", theme, { __MANAGED__: true, __PROVIDER__: "managed" });
    const { page } = env;
    try {
      const prompt = "textarea[placeholder*='makes the field value valid']";
      await page.locator(prompt).first().waitFor({ timeout: 8000 });
      ok(await page.locator(prompt).count() > 0,
        `E1b/${theme} positive control: the validator form rendered (so an absent warning means absent, not blank)`);
      // Give the getOpenAIKey effect room to land a warning if it were going to.
      await page.waitForTimeout(700);
      ok(await page.locator(".provider-warning").count() === 0,
        `E1b/${theme} no 'no AI provider key' warning on a managed-engine tenant (noKeyNeeded)`);
    } catch (e) { fail++; console.log(`  ✗ E1b/${theme} threw: ` + e.message.split("\n")[0]); }
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
      // F-179 — the banner must state the EVICTION POLICY the backend implements: archived
      // rows are never evicted and still occupy their slot, so archiving frees nothing and
      // DELETING is the only escape. The old copy ("Delete or merge memories") named a merge
      // control that does not exist and let a user believe archiving would recover the store.
      ok(/Archived memories still count toward the cap/i.test(btxt),
        `M1 ${theme} banner says archiving does NOT free capacity`);
      ok(/delete some to resume learning/i.test(btxt), `M1 ${theme} banner names deleting as the escape`);
      ok(!/merge/i.test(btxt), `M1 ${theme} banner never offers "merge" — there is no such control`);
      ok(!/prune/i.test(btxt), `M1 ${theme} banner never says "prune"`);
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
      // F-175 — assert the app's REAL refusal, taken from its ONE home rather than retyped.
      // The old assertion hunted for "prune in the Memories tab" — words the backend never
      // emitted; it passed only because the mock had invented the same wrong sentence.
      const capMsg = memoryCapRefusalMessage("cap");
      await kp.getByText(capMsg, { exact: false }).first().waitFor({ timeout: 6000 });
      ok(await kp.getByText(capMsg, { exact: false }).count() > 0,
        `M1 ${theme} the cap refusal renders inline under the add form, verbatim (F-166/F-175)`);
      // The typed content survives the refusal — nothing was stored, so nothing is discarded.
      ok(await kp.locator(".memory-quick-add .input").inputValue() === "Sprint field is customfield_10020.",
        `M1 ${theme} the refused text is kept in the input, not silently cleared`);
    } catch (e) { fail++; console.log(`  ✗ M1 ${theme} threw: ` + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- M1b — F-201: the PLATFORM-CAP wall in the RULE-EDITOR Memories tab ----------------
   * Two surfaces render the same refusal and only one of them was updated. `platform-cap`
   * means the `pf_memories` value has passed Jira's ~240 KiB per-value ceiling: no write to
   * it succeeds at all, including the single-row Delete this tab offers. The admin twin got
   * a solid red wall (F-189); here the identical sentence came out as a muted grey line
   * above a Delete button that is itself refused — the same severity grammar as "content too
   * long", which reads as retryable. And the backend's own sentence says "the Memories tab",
   * which is ambiguous between the two tabs that carry that title; only the ADMIN one has
   * the multi-select the sentence asks for. So this surface must add the pointer.
   * Both themes — every new hue needs a dark override. */
  for (const theme of ["light", "dark"]) {
    console.log(`M1b memories platform-cap wall in the rule editor — ${theme} (cfg-static)`);
    const env = await openEditor(browser, "config-ui", "cfg-static", theme, { __MEMORY_OVERCAP__: true });
    const { page } = env;
    try {
      const kp = page.locator(".knowledge-panel").first();
      if (!(await kp.locator(".knowledge-tabs").isVisible().catch(() => false))) await kp.locator(".knowledge-summary").click();
      await kp.locator(".knowledge-tab-memories").click();
      await kp.locator(".memory-quick-add .input").waitFor({ timeout: 8000 });

      ok(await kp.locator(".memory-cap-refusal").count() === 0,
        `M1b ${theme} no wall before a write is attempted`);
      await kp.locator(".memory-quick-add .input").fill("A memory this store cannot fit.");
      await kp.locator(".btn-remember").click();

      const wall = kp.locator(".memory-cap-refusal").first();
      await wall.waitFor({ timeout: 8000 });
      const wtxt = await wall.innerText();
      ok(await wall.getAttribute("role") === "alert", `M1b ${theme} the wall is announced as an alert`);
      // The backend's sentence, verbatim from its ONE home — it owns the byte deficit.
      ok(wtxt.includes(memoryPlatformCapMessage(6544)),
        `M1b ${theme} the wall carries the resolver's platform-cap sentence verbatim (got: ${wtxt.replace(/\n/g, " | ")})`);
      ok(/\b6544 bytes\b/.test(wtxt), `M1b ${theme} the deficit is a real quantity, not "some"`);
      /* OUR line. F-208 made it a STATEMENT ("A Jira admin has to...") because the admin
         panel's bulk delete was then admin-gated, so an instruction would have pointed a
         project editor at a control they could not be given.
         F-225 — F-219 moved that control onto `canEdit` (deleteMemory gates on
         requireRole("editor")), so the editor reading this CAN clear the store and the
         statement form now withholds the only instruction that works. It is an instruction
         again, and it names the roles that can follow it. */
      ok(/Apps → CogniRunner → Memories/.test(wtxt),
        `M1b ${theme} the wall names where the bulk delete lives (got: ${wtxt.replace(/\n/g, " | ")})`);
      ok(/select several memories and delete them\s+together/i.test(wtxt),
        `M1b ${theme} the wall gives the BULK instruction, which is the only write that clears an over-cap store (got: ${wtxt.replace(/\n/g, " | ")})`);
      ok(/\(editors and admins can\)/i.test(wtxt),
        `M1b ${theme} the wall names the roles the BACKEND accepts (got: ${wtxt.replace(/\n/g, " | ")})`);
      /* And it must NOT say "a Jira admin" — false for the reader who most needs it, since
         an app-demoted SITE admin IS the Jira admin and was being sent to themselves. This
         is the same false referral F-219 removed from the admin tab's own wall. */
      ok(!/a Jira admin has to/i.test(wtxt),
        `M1b ${theme} the wall never refers an editor to "a Jira admin" (got: ${wtxt.replace(/\n/g, " | ")})`);
      // The old single-row imperative stays gone: one-at-a-time deleting cannot clear this.
      ok(!/Deleting memories one at a time here/i.test(wtxt),
        `M1b ${theme} the wall does not suggest a one-row delete, which the same guard refuses`);
      // It is the WALL, not the grey error line — that substitution is the whole finding.
      ok(await kp.locator(".memory-cap-refusal").count() === 1, `M1b ${theme} exactly one wall`);
      const greys = await kp.locator(".doc-repo-embedded > div").evaluateAll(
        (els) => els.filter((el) => /6544 bytes/.test(el.textContent || "") && !el.className.includes("memory-cap-refusal")).length,
      );
      ok(greys === 0, `M1b ${theme} the sentence is NOT also rendered as a plain error line (got ${greys})`);

      // Owner design law, in both themes: solid saturated fill, white text, no left rail.
      const style = await wall.evaluate((el) => {
        const c = getComputedStyle(el);
        return { bg: c.backgroundColor, fg: c.color, w: getComputedStyle(el.firstElementChild).fontWeight, bl: c.borderLeftWidth, bt: c.borderTopWidth };
      });
      const rgb = style.bg.match(/\d+/g).map(Number);
      ok(rgb[0] > 180 && rgb[1] < 90 && rgb[2] < 90, `M1b ${theme} wall is a SOLID red fill, not a tint — got ${style.bg}`);
      ok((style.bg.match(/[\d.]+/g) || []).length < 4 || Number(style.bg.match(/[\d.]+/g)[3]) === 1,
        `M1b ${theme} wall fill is fully opaque — got ${style.bg}`);
      ok(/255,\s*255,\s*255/.test(style.fg), `M1b ${theme} wall text is white — got ${style.fg}`);
      ok(Number(style.w) >= 700, `M1b ${theme} the wall title is 700 weight — got ${style.w}`);
      ok(style.bl === style.bt, `M1b ${theme} no left accent rail (border-left ${style.bl} vs top ${style.bt})`);
      // The refused text survives — nothing was stored, so nothing may be discarded.
      ok(await kp.locator(".memory-quick-add .input").inputValue() === "A memory this store cannot fit.",
        `M1b ${theme} the refused text is kept in the input`);
    } catch (e) { fail++; console.log(`  ✗ M1b ${theme} threw: ` + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- M1c — F-209 / F-207 / F-212: the DELETE side of the wall, and what clears it
   * Three things that only this journey can prove.
   *
   * F-209: under `platform-cap` the per-row Delete on this tab is refused by the SAME
   * ceiling the add is — `pf_memories` is one KVS value, so a one-row delete rewrites an
   * array that is still oversized. The mock used to answer every delete with success, so
   * `handleDelete`'s `consumeCapRefusal` branch — the only refusal path that button has —
   * had never once rendered.
   *
   * F-207: a refusal wall describes the LAST write. A write that LANDS falsifies it, so a
   * successful add must clear both the wall and the grey error line. Before the fix only
   * delete cleared it, and consumeCapRefusal left a stale grey `error` sitting above the
   * red wall — two different accounts of one refusal on screen at once.
   *
   * F-212: the wall and the store-full banner are the same severity and must render
   * identically — same fill, same title weight, same body weight. They were hand-copied
   * blocks and had already drifted (body 600 vs 500).
   * Both themes. */
  for (const theme of ["light", "dark"]) {
    console.log(`M1c memories platform-cap: delete-side wall, clearing, hard-stop parity — ${theme} (cfg-static)`);
    // BOTH flags: __MEMORY_OVERCAP__ for the platform wall, __MEMORY_FULL__ so the
    // store-full banner is on screen at the same time — the F-212 parity assertion needs
    // the two hard stops rendered together, in one document, under one theme.
    const env = await openEditor(browser, "config-ui", "cfg-static", theme, { __MEMORY_OVERCAP__: true, __MEMORY_FULL__: true });
    const { page } = env;
    try {
      const kp = page.locator(".knowledge-panel").first();
      if (!(await kp.locator(".knowledge-tabs").isVisible().catch(() => false))) await kp.locator(".knowledge-summary").click();
      await kp.locator(".knowledge-tab-memories").click();
      await kp.locator(".memory-quick-add .input").waitFor({ timeout: 8000 });

      /* ---- F-216: FIRST put a real grey `error` line on screen ----
       * The F-207 assertion at the foot of this journey checks that no stale refusal text
       * survives a successful write. As written it could not fail: nothing in the journey
       * ever produced a grey `error` at all, so "the grey line is gone" was asserted
       * against a line that had never existed. A test that cannot fail is not a test.
       *
       * So produce one, the way a tenant does: with the store merely FULL (row cap) rather
       * than over the platform ceiling, an add is refused with reason "cap" — which
       * `consumeCapRefusal` correctly declines (it is keyed on reason "platform-cap"), so
       * it lands in the grey line. THEN raise the platform wall on top of it. That is the
       * exact two-account-of-one-refusal state F-207 closed: a grey line and a red block
       * describing different failures at once. */
      await page.evaluate(() => { window.__MEMORY_OVERCAP__ = false; });
      await kp.locator(".memory-quick-add .input").fill("Refused by the row cap.");
      await kp.locator(".btn-remember").click();
      const panel = kp.locator(".doc-repo-embedded").filter({ has: page.locator(".memory-quick-add") }).first();
      const greyText = () => panel.innerText();
      await page.waitForFunction(
        (sentence) => document.body.innerText.includes(sentence),
        memoryCapRefusalMessage("cap"),
        { timeout: 8000 },
      );
      ok((await greyText()).includes(memoryCapRefusalMessage("cap")),
        `M1c ${theme} a row-cap refusal renders as the grey error line, not the red wall`);
      ok(await kp.locator(".memory-cap-refusal").count() === 0,
        `M1c ${theme} a row-cap refusal is NOT the platform wall (they are different states)`);
      await page.evaluate(() => { window.__MEMORY_OVERCAP__ = true; });

      /* ---- F-209: the per-row Delete is refused, and says so as the WALL ---- */
      const rowDelete = kp.locator(".memory-item .doc-btn-delete").first();
      await rowDelete.waitFor({ timeout: 8000 });
      const rowsBefore = await kp.locator(".memory-item").count();
      await rowDelete.click();
      const wall = kp.locator(".memory-cap-refusal").first();
      await wall.waitFor({ timeout: 8000 });
      const dtxt = await wall.innerText();
      ok(/over Jira/i.test(dtxt), `M1c ${theme} a refused DELETE renders the platform-cap wall, not a toast`);
      ok(/bytes/.test(dtxt), `M1c ${theme} the delete-side wall names the deficit (got: ${dtxt.replace(/\n/g, " | ")})`);
      ok(await kp.locator(".memory-item").count() === rowsBefore,
        `M1c ${theme} a refused delete removes nothing from the list`);
      // F-216 — and the grey line from the PREVIOUS refusal is gone. consumeCapRefusal
      // clears it, so the screen carries exactly ONE account of why writes are failing.
      ok(!(await greyText()).includes(memoryCapRefusalMessage("cap")),
        `M1c ${theme} raising the platform wall clears the older grey error line (got: ${(await greyText()).replace(/\n/g, " | ")})`);
      // The call still went out with the single-row shape — the refusal is the SERVER's.
      const dcalls = await page.evaluate(() => window.__DELETE_MEMORY_CALLS__ || []);
      ok(dcalls.length === 1 && !!dcalls[0].id && !dcalls[0].ids,
        `M1c ${theme} the row Delete sends { id } and is refused server-side (got: ${JSON.stringify(dcalls[0])})`);

      /* ---- F-212: the wall and the store-full banner share ONE grammar ---- */
      const grammar = (sel) => page.locator(sel).first().evaluate((el) => {
        const c = getComputedStyle(el);
        const t = getComputedStyle(el.firstElementChild);
        const b = getComputedStyle(el.children[1] || el.firstElementChild);
        return { bg: c.backgroundColor, fg: c.color, radius: c.borderTopLeftRadius,
                 bl: c.borderLeftWidth, bt: c.borderTopWidth,
                 titleW: t.fontWeight, bodyW: b.fontWeight };
      });
      const gWall = await grammar(".memory-cap-refusal");
      ok(await kp.locator(".memory-full-banner").count() === 1,
        `M1c ${theme} the store-full banner is on screen to compare against`);
      const gFull = await grammar(".memory-full-banner");
      ok(gWall.bg === gFull.bg,
        `M1c ${theme} both hard stops share ONE fill — wall ${gWall.bg} vs banner ${gFull.bg}`);
      ok(gWall.fg === gFull.fg, `M1c ${theme} both hard stops share one text colour`);
      ok(gWall.titleW === gFull.titleW && Number(gWall.titleW) >= 700,
        `M1c ${theme} both titles are the same 700 weight — ${gWall.titleW} vs ${gFull.titleW}`);
      ok(gWall.bodyW === gFull.bodyW && Number(gWall.bodyW) === 500,
        `M1c ${theme} both bodies are the same 500 weight — ${gWall.bodyW} vs ${gFull.bodyW} (F-212: these were 500 and 600)`);
      ok(gWall.radius === gFull.radius, `M1c ${theme} both hard stops share one radius`);
      ok(gWall.bl === gWall.bt && gFull.bl === gFull.bt, `M1c ${theme} neither hard stop grew a left rail`);

      /* ---- F-207: a write that LANDS clears the wall and the grey line ---- */
      // Repair the store the way an admin would have, in another tab: from here on every
      // write succeeds, so the wall is describing a state that no longer exists.
      await page.evaluate(() => { window.__MEMORY_OVERCAP__ = false; window.__MEMORY_FULL__ = false; });
      await kp.locator(".memory-quick-add .input").fill("Team lives in customfield_10003.");
      await kp.locator(".btn-remember").click();
      await page.waitForTimeout(700);
      ok(await kp.locator(".memory-cap-refusal").count() === 0,
        `M1c ${theme} a successful ADD clears the refusal wall (F-207: only delete used to)`);
      // ...including the GREY error line, which is the other half of F-207: consuming a
      // wall used to leave whatever the previous failure had written sitting above it.
      // F-216 — check BOTH refusal sentences this journey has now produced: the grey
      // row-cap one AND the red platform one. Checking only the platform sentence was half
      // the assertion, and the half that was already covered by the .memory-cap-refusal
      // count above it.
      const stale = await panel.evaluate(
        (el, sentences) => (sentences.some((x) => el.innerText.includes(x)) ? el.innerText : ""),
        [memoryPlatformCapMessage(3272), memoryCapRefusalMessage("cap")],
      );
      ok(stale === "",
        `M1c ${theme} no stale refusal text of any severity survives the successful write (got: ${stale.replace(/\n/g, " | ")})`);
      ok(await kp.locator(".memory-quick-add .input").inputValue() === "",
        `M1c ${theme} the accepted text is cleared from the input`);
    } catch (e) { fail++; console.log(`  ✗ M1c ${theme} threw: ` + e.message.split("\n")[0]); }
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

  /* ---------------- J23b — F-380: config-view names the git CONNECTION ---------------- */
  {
    console.log("J23b config-view git rule summary (view-premade-git)");
    for (const theme of ["light", "dark"]) {
    const env = await openEditor(browser, "config-view", "view-premade-git", theme);
    const { page } = env;
    try {
      const row = page.locator(".config-item", { hasText: "Connection:" }).first();
      await row.waitFor({ timeout: 8000 });
      const value = (await row.innerText()).replace(/^Connection:/, "").trim();
      /* The whole finding: this screen has no picker, so an id here is unanswerable.
         `premadeSummaryRows(config, connections)` had the human-label branch since F-372
         and no call site ever passed a list. */
      ok(value === "Acme engineering", `J23b (${theme}) the connection row shows the LABEL, not the id (got "${value}")`);
      ok(!/gc_1/.test(await page.locator("body").innerText()), `J23b (${theme}) the raw connection id is nowhere on the read-only summary`);
      // The rest of the git group still renders, so the label did not cost a row.
      const body = await page.locator("body").innerText();
      ok(/acme\/web/.test(body), `J23b (${theme}) the repository still renders`);
      ok(/source branch name or the pull request title/.test(body), `J23b (${theme}) the prMatch sentence still renders`);
      // The row is a summary row like any other, so it inherits the surface's own colours
      // in both themes: the fix is DATA, and it must not have introduced a hue.
      const contrast = await page.locator(".config-item", { hasText: "Connection:" }).first().evaluate((el) => getComputedStyle(el).color);
      ok(!!contrast, `J23b (${theme}) the connection row renders in ${theme}`);
    } catch (e) { fail++; console.log("  \u2717 J23b threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
    }
  }


  /* ---------------- J16p — F-398: the CODER post-function, created from the rule editor ----
     The finding: `postfunction-coder` could not be created from any surface. The form was
     ready (F-388) and the resolver learned the shape (cdf9476), but nothing mounted it - the
     post-function slot offered semantic and static and nothing else, so a designer who wanted
     "Coder: build" on a transition had no door.

     The journey walks that door: pick the premade kind, pick the Coder, prove the save is
     REFUSED while no mode is chosen, then pick one and assert the exact config the editor
     hands Jira AND the exact payload it hands `registerPostFunction`. A rendered picker that
     does not reach the saved config is the same silent pass wearing a form. */
  for (const theme of ["light", "dark"]) {
    console.log(`J16p premade CODER post-function (cfg-premade-pf, ${theme})`);
    const env = await openEditor(browser, "config-ui", "cfg-premade-pf", theme);
    const { page } = env;
    try {
      // The slot offers the premade catalogue BESIDE the AI post-function.
      const kindBtn = page.locator(".rulekind-opt", { hasText: "Premade post-function" }).first();
      ok(await kindBtn.count() > 0, `J16p (${theme}) the post-function slot offers a premade kind`);
      ok(await page.locator(".rulekind-opt", { hasText: "AI post-function" }).count() > 0, `J16p (${theme}) the AI post-function is still offered beside it`);
      // The hydrated fixture already carries ruleKind:"premade", so the form is mounted.
      await page.waitForSelector(".pr-form", { timeout: 8000 });
      ok(await page.locator("select").count() === 0, `J16p (${theme}) no native <select> anywhere on the premade post-function editor`);

      // The catalogue's one entry is on offer, by its catalogue label.
      const rulePicker = page.locator(".dropdown-trigger", { hasText: "Choose a premade rule" }).first();
      await rulePicker.click();
      await page.waitForSelector(".dropdown-panel", { timeout: 6000 });
      const coderOpt = page.locator(".dropdown-panel .dropdown-item", { hasText: "Coder: build" }).first();
      ok(await coderOpt.count() > 0, `J16p (${theme}) the catalogue offers the Coder post-function`);
      await coderOpt.click();

      // The Coder's controls render, and the prMatch control the executor ignores does NOT.
      await page.waitForSelector(".pr-seg-coder", { timeout: 6000 });
      ok(await page.locator(".pr-seg-coder .pr-seg-btn").count() === 5, `J16p (${theme}) all five Coder modes render as a segmented control`);
      ok(await page.locator(".pr-seg:not(.pr-seg-coder)").count() === 0, `J16p (${theme}) the prMatch control (switched off by the catalogue) is not drawn`);
      // F-398 — the NL builder is not offered on this half: it can only ever build a validator.
      ok(await page.locator(".br-toggle").count() === 0, `J16p (${theme}) "Build from a description" is not offered for a post-function`);

      // MODE IS REQUIRED. Before one is chosen the editor says so in its own words...
      ok(await page.locator(".cpf-gate").count() === 1, `J16p (${theme}) the save gate is shown while no mode is chosen`);
      const gateBg = await page.locator(".cpf-gate").first().evaluate((el) => getComputedStyle(el).backgroundColor);
      ok(gateBg === (theme === "dark" ? "rgb(245, 158, 11)" : "rgb(180, 83, 9)"), `J16p (${theme}) the gate is a SOLID agents-hue block, not a tint - got ${gateBg}`);
      ok(await page.locator(".cpf-gate").first().evaluate((el) => getComputedStyle(el).borderLeftWidth) === "0px", `J16p (${theme}) the gate has no left accent rail`);
      // ...and the save is actually REFUSED, not merely discouraged.
      const refused = await page.evaluate(async () => await window.__ON_CONFIGURE__());
      ok(refused === undefined, `J16p (${theme}) onConfigure REFUSES the save while no mode is chosen`);
      ok(!(await page.evaluate(() => (window.__CALLS__ || []).some((c) => c.name === "registerPostFunction"))), `J16p (${theme}) nothing was registered by the refused save`);

      // Now complete the rule: mode, connection, repository, strict, a note.
      await page.locator(".pr-seg-coder .pr-seg-btn", { hasText: "Build the change" }).first().click();
      ok(await page.locator(".pr-seg-coder .pr-seg-btn.active", { hasText: "Build the change" }).count() === 1, `J16p (${theme}) the chosen mode is marked active`);
      await page.locator(".dropdown-trigger", { hasText: "Choose a git connection" }).first().click();
      await page.waitForSelector(".dropdown-panel", { timeout: 6000 });
      await page.locator(".dropdown-panel .dropdown-item", { hasText: "Acme engineering" }).first().click();
      await page.locator(".dropdown-trigger", { hasText: "Choose a repository" }).first().click();
      await page.waitForSelector(".dropdown-panel", { timeout: 6000 });
      await page.locator(".dropdown-panel .dropdown-item", { hasText: "acme/web" }).first().click();
      await page.locator(".pr-git-toggle-row input[type=checkbox]").first().check();
      await page.locator("textarea").last().fill("Keep the diff small.");
      ok(await page.locator(".cpf-gate").count() === 0, `J16p (${theme}) the gate clears once the rule is complete`);

      // THE POINT: the config Jira is handed, and the registry payload beside it.
      const saved = await page.evaluate(async () => JSON.parse(await window.__ON_CONFIGURE__()));
      ok(saved.ruleKind === "premade", `J16p (${theme}) saved config is a premade rule`);
      ok(saved.ruleType === "postfunction-coder" && saved.type === "postfunction-coder",
        `J16p (${theme}) BOTH ruleType and type carry the catalogue key (resolvePfType reads ruleType, every badge reads type)`);
      ok(saved.mode === "build", `J16p (${theme}) saved config carries the Coder mode`);
      ok(saved.connectionId === "gc_1" && saved.repo === "acme/web", `J16p (${theme}) saved config carries the connection and the repository`);
      ok(saved.strict === true, `J16p (${theme}) saved config carries strict`);
      ok(saved.instructions === "Keep the diff small.", `J16p (${theme}) saved config carries the admin's note`);
      ok(!("prMatch" in saved), `J16p (${theme}) the saved config stores NO prMatch - the Coder ignores it and the catalogue switches it off`);
      const reg = await page.evaluate(() => (window.__CALLS__ || []).filter((c) => c.name === "registerPostFunction").at(-1).payload);
      ok(reg.ruleKind === "premade" && reg.premadeRuleType === "postfunction-coder",
        `J16p (${theme}) registerPostFunction is told this is a premade save (the key it validates against)`);
      ok(reg.type === "postfunction-coder", `J16p (${theme}) the registry row is typed as the catalogue key`);
      ok(reg.mode === "build" && reg.repo === "acme/web" && reg.connectionId === "gc_1" && reg.strict === true,
        `J16p (${theme}) the registry payload carries the params the backend re-clamps`);
      ok(!("prMatch" in reg), `J16p (${theme}) the registry payload carries no prMatch either`);
    } catch (e) { fail++; console.log(`  ✗ J16p (${theme}) threw: ` + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- J16s — F-463: the SKILLS a Coder post-function runs with --------------
     The panel half of F-463 gives a conversation its skills; this is the RULE half. The
     catalogue row carries `params.skillIds`, the form draws the same hand-rolled
     multi-select the composer does, and what must be true is that the picks reach BOTH the
     config Jira stores and the payload `registerPostFunction` re-clamps. A picker that
     renders and does not reach the save is the silent pass this journey exists to refuse.

     The CONTROL is drawn from the catalogue, and the catalogue half of F-463 is cut
     alongside this one. Until it lands the picker is absent by design, so the journey says
     PENDING rather than failing - and it can never quietly pass, because the moment the
     param exists every assertion below runs. */
  for (const theme of ["light", "dark"]) {
    console.log(`J16s premade CODER post-function SKILLS (cfg-premade-pf, ${theme})`);
    const env = await openEditor(browser, "config-ui", "cfg-premade-pf", theme);
    const { page } = env;
    try {
      await page.waitForSelector(".pr-form", { timeout: 8000 });
      await page.locator(".dropdown-trigger", { hasText: "Choose a premade rule" }).first().click();
      await page.waitForSelector(".dropdown-panel", { timeout: 6000 });
      await page.locator(".dropdown-panel .dropdown-item", { hasText: "Coder: build" }).first().click();
      await page.waitForSelector(".pr-seg-coder", { timeout: 6000 });
      // Give the skills read a moment; the control appears only once rows arrive.
      await page.waitForTimeout(400);

      if (await page.locator(".pr-skill-list").count() === 0) {
        console.log(`  · J16s (${theme}) PENDING: the catalogue row does not carry params.skillIds yet (backend half of F-463)`);
      } else {
        const chips = page.locator(".pr-skill-list .pr-skill-chip");
        ok(await chips.count() === 6, `J16s (${theme}) every enabled skill is offered (got ${await chips.count()})`);
        ok(await page.locator(".pr-skill-list input").count() === 0, `J16s (${theme}) the picker is chips, never a checkbox or a native control`);
        await chips.nth(0).click();
        await chips.nth(2).click();
        const onBg = await page.locator(".pr-skill-chip.is-on").first().evaluate((el) => getComputedStyle(el).backgroundColor);
        ok(onBg === (theme === "dark" ? "rgb(139, 92, 246)" : "rgb(124, 58, 237)"), `J16s (${theme}) a chosen skill is the solid skills hue (got ${onBg})`);
        ok(await page.locator(".pr-skill-chip.is-on").first().evaluate((el) => getComputedStyle(el).borderLeftWidth)
          === await page.locator(".pr-skill-chip.is-on").first().evaluate((el) => getComputedStyle(el).borderTopWidth),
          `J16s (${theme}) the chip has no left accent rail`);
        // The cap is the CONTROL's, exactly as it is in the composer.
        await chips.nth(3).click();
        await chips.nth(4).click();
        ok(await page.locator(".pr-skill-list .pr-skill-chip:disabled").count() === 2, `J16s (${theme}) at four picks nothing else is selectable`);
        await chips.nth(3).click();
        await chips.nth(4).click();

        // Complete the rule so it can be saved at all, then read the save.
        await page.locator(".pr-seg-coder .pr-seg-btn", { hasText: "Build the change" }).first().click();
        await page.locator(".dropdown-trigger", { hasText: "Choose a git connection" }).first().click();
        await page.waitForSelector(".dropdown-panel", { timeout: 6000 });
        await page.locator(".dropdown-panel .dropdown-item", { hasText: "Acme engineering" }).first().click();
        await page.locator(".dropdown-trigger", { hasText: "Choose a repository" }).first().click();
        await page.waitForSelector(".dropdown-panel", { timeout: 6000 });
        await page.locator(".dropdown-panel .dropdown-item", { hasText: "acme/web" }).first().click();
        const saved = await page.evaluate(async () => JSON.parse(await window.__ON_CONFIGURE__()));
        ok(Array.isArray(saved.skillIds) && saved.skillIds.length === 2, `J16s (${theme}) the saved config carries the picked skill ids (got ${JSON.stringify(saved.skillIds)})`);
        ok(saved.skillIds.includes("sk1") && saved.skillIds.includes("sk3"), `J16s (${theme}) and carries the RIGHT ids`);
        ok(Array.isArray(saved.skillNames) && /Create a linked issue/.test(saved.skillNames.join("|")),
          `J16s (${theme}) the names ride beside the ids for the summary, exactly as fieldName rides beside fieldId`);
        const reg = await page.evaluate(() => (window.__CALLS__ || []).filter((c) => c.name === "registerPostFunction").at(-1).payload);
        ok(Array.isArray(reg.skillIds) && reg.skillIds.length === 2, `J16s (${theme}) the registry payload carries the ids the backend re-clamps`);
      }
    } catch (e) { fail++; console.log(`  ✗ J16s (${theme}) threw: ` + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- J16q — F-398: the Coder is OFF, so the rule cannot be saved -----------
     The decision the cut made explicit: a rule that CANNOT RUN is not saved. A Coder
     post-function on an instance whose capability is off would sit on the transition writing
     SKIP or ERROR rows forever while reading as configured. The arm names the reason and the
     remedy from the ONE table (AGENT_CAPABILITY_REASONS, src/shared/edition.js), and the save
     is refused - not merely discouraged. */
  for (const theme of ["light", "dark"]) {
    console.log(`J16q Coder capability OFF on the premade post-function (${theme})`);
    const env = await openEditor(browser, "config-ui", "cfg-premade-pf", theme, { __CODE_CAP__: "needs-coder-edition" });
    const { page } = env;
    try {
      await page.waitForSelector(".pr-form", { timeout: 8000 });
      await page.locator(".dropdown-trigger", { hasText: "Choose a premade rule" }).first().click();
      await page.waitForSelector(".dropdown-panel", { timeout: 6000 });
      await page.locator(".dropdown-panel .dropdown-item", { hasText: "Coder: build" }).first().click();
      await page.waitForSelector(".cpf-cap-off", { timeout: 8000 });
      const capText = await page.locator(".cpf-cap-off").first().innerText();
      ok(/this site is on CogniRunner Standard/i.test(capText), `J16q (${theme}) the OFF arm names the reason in the shared table's words`);
      ok(/Upgrade the app's edition|switch to any BYOK provider/i.test(capText), `J16q (${theme}) the OFF arm names the remedy`);
      ok(/cannot be saved/i.test(capText), `J16q (${theme}) the OFF arm says the rule cannot be saved`);
      const bg = await page.locator(".cpf-cap-off").first().evaluate((el) => getComputedStyle(el).backgroundColor);
      ok(bg === (theme === "dark" ? "rgb(245, 158, 11)" : "rgb(180, 83, 9)"), `J16q (${theme}) the OFF arm is a SOLID block - got ${bg}`);
      ok(await page.locator(".cpf-cap-off").first().evaluate((el) => getComputedStyle(el).borderLeftWidth) === "0px", `J16q (${theme}) the OFF arm has no left accent rail`);

      // Complete the rule anyway - the refusal must survive a form that is otherwise valid.
      await page.locator(".pr-seg-coder .pr-seg-btn", { hasText: "Build the change" }).first().click();
      await page.locator(".dropdown-trigger", { hasText: "Choose a git connection" }).first().click();
      await page.waitForSelector(".dropdown-panel", { timeout: 6000 });
      await page.locator(".dropdown-panel .dropdown-item", { hasText: "Acme engineering" }).first().click();
      await page.locator(".dropdown-trigger", { hasText: "Choose a repository" }).first().click();
      await page.waitForSelector(".dropdown-panel", { timeout: 6000 });
      await page.locator(".dropdown-panel .dropdown-item", { hasText: "acme/web" }).first().click();
      const refused = await page.evaluate(async () => await window.__ON_CONFIGURE__());
      ok(refused === undefined, `J16q (${theme}) the save is REFUSED while the Coder is off, even with a complete form`);
      ok(!(await page.evaluate(() => (window.__CALLS__ || []).some((c) => c.name === "registerPostFunction"))), `J16q (${theme}) nothing reached the registry`);
      ok(/CogniRunner Standard/i.test(await page.locator(".alert-error").first().innerText()), `J16q (${theme}) the refusal banner says why`);
    } catch (e) { fail++; console.log(`  ✗ J16q (${theme}) threw: ` + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- J16s — F-436: the capability READ failed, which is not "the Coder is off"
     The finding: one dropped `getAgentCapability` was stored as `{enabled:false,
     reason:"unknown"}`, the fetching effect guarded on that value being truthy, and so the
     editor never asked again for the life of the iframe - every later save refused, naming a
     cause the backend had never given. This journey fails the read outright, waits out the
     2/4/8 s ladder, and asserts three things: the banner is about the CHECK, the refusal it
     produces never says the Coder is off, and Retry actually re-asks and reaches the verdict.
     The OFF arm is J16q's and is deliberately untouched. */
  for (const theme of ["light", "dark"]) {
    console.log(`J16s Coder capability read FAILS, then retries (${theme})`);
    // 99 = every read rejects, so the ladder is genuinely exhausted rather than lucky.
    const env = await openEditor(browser, "config-ui", "cfg-premade-pf", theme, { __CODE_CAP_FAIL__: 99 });
    const { page } = env;
    try {
      await page.waitForSelector(".pr-form", { timeout: 8000 });
      await page.locator(".dropdown-trigger", { hasText: "Choose a premade rule" }).first().click();
      await page.waitForSelector(".dropdown-panel", { timeout: 6000 });
      await page.locator(".dropdown-panel .dropdown-item", { hasText: "Coder: build" }).first().click();

      // While the ladder runs, the editor says it is CHECKING - not that anything is off.
      await page.waitForSelector(".cpf-cap-checking", { timeout: 8000 });
      ok(await page.locator(".cpf-cap-off").count() === 0, `J16s (${theme}) nothing claims the Coder is off while the check is still running`);

      /* The ladder: first read immediately, retries at 2 s, 4 s and 8 s, so the verdict
         cannot be declared unknown before ~14 s. 25 s of headroom. */
      await page.waitForSelector(".cpf-cap-unknown", { timeout: 25000 });
      const capText = await page.locator(".cpf-cap-unknown").first().innerText();
      ok(/Could not check whether the Coder is available/.test(capText), `J16s (${theme}) the banner says the CHECK failed`);
      ok(!/Coder is off|CogniRunner Standard|Upgrade the app/i.test(capText), `J16s (${theme}) the banner makes no claim about the instance's capability`);
      ok(await page.locator(".cpf-cap-off").count() === 0, `J16s (${theme}) the OFF arm is NOT rendered for a transport failure`);
      const bg = await page.locator(".cpf-cap-unknown").first().evaluate((el) => getComputedStyle(el).backgroundColor);
      ok(bg === (theme === "dark" ? "rgb(100, 116, 139)" : "rgb(71, 85, 105)"), `J16s (${theme}) the unknown arm is a SOLID slate block, not the Coder's amber - got ${bg}`);
      ok(await page.locator(".cpf-cap-unknown").first().evaluate((el) => getComputedStyle(el).borderLeftWidth) === "0px", `J16s (${theme}) the unknown arm has no left accent rail`);
      ok(await page.locator(".cpf-cap-retry").count() === 1, `J16s (${theme}) there is a Retry control`);

      // The save is still refused - and the refusal names the READ, never the Coder.
      await page.locator(".pr-seg-coder .pr-seg-btn", { hasText: "Build the change" }).first().click();
      await page.locator(".dropdown-trigger", { hasText: "Choose a git connection" }).first().click();
      await page.waitForSelector(".dropdown-panel", { timeout: 6000 });
      await page.locator(".dropdown-panel .dropdown-item", { hasText: "Acme engineering" }).first().click();
      await page.locator(".dropdown-trigger", { hasText: "Choose a repository" }).first().click();
      await page.waitForSelector(".dropdown-panel", { timeout: 6000 });
      await page.locator(".dropdown-panel .dropdown-item", { hasText: "acme/web" }).first().click();
      const refused = await page.evaluate(async () => await window.__ON_CONFIGURE__());
      ok(refused === undefined, `J16s (${theme}) the save is still REFUSED while the capability is unknown`);
      ok(!(await page.evaluate(() => (window.__CALLS__ || []).some((c) => c.name === "registerPostFunction"))), `J16s (${theme}) nothing reached the registry`);
      const err = await page.locator(".alert-error").first().innerText();
      ok(/Could not check whether the Coder is available/.test(err), `J16s (${theme}) the refusal banner names the failed check`);
      ok(!/is off|CogniRunner Standard/i.test(err), `J16s (${theme}) the refusal banner never says the Coder is off`);

      // THE WAY BACK. The connection comes good; Retry re-asks and the verdict lands.
      await page.evaluate(() => { window.__CODE_CAP_FAIL__ = 0; });
      const before = await page.evaluate(() => (window.__CALLS__ || []).filter((c) => c.name === "getAgentCapability").length);
      await page.locator(".cpf-cap-retry").first().click();
      await page.waitForSelector(".cpf-cap-on", { timeout: 15000 });
      const after = await page.evaluate(() => (window.__CALLS__ || []).filter((c) => c.name === "getAgentCapability").length);
      ok(after > before, `J16s (${theme}) Retry actually re-asks getAgentCapability (${before} -> ${after})`);
      ok(await page.locator(".cpf-cap-unknown").count() === 0, `J16s (${theme}) the unknown banner is gone once the verdict lands`);
      ok(/Coder/i.test(await page.locator(".cpf-cap-on").first().innerText()), `J16s (${theme}) the ON verdict renders`);

      // And the save the transport failure had bricked now goes through.
      const saved = await page.evaluate(async () => await window.__ON_CONFIGURE__());
      ok(typeof saved === "string" && JSON.parse(saved).ruleType === "postfunction-coder",
        `J16s (${theme}) the save that one dropped request used to brick now succeeds`);
    } catch (e) { fail++; console.log(`  ✗ J16s (${theme}) threw: ` + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- J16r — F-398: the admin wizard offers the same row -------------------- */
  {
    console.log("J16r admin wizard offers the Coder post-function (admin)");
    const env = await openEditor(browser, "admin-panel", "admin");
    const { page } = env;
    try {
      await page.locator("button", { hasText: /Add Rule/ }).first().click();
      const wiz = page.locator(".wizard");
      await wiz.waitFor({ timeout: 10000 });
      await wiz.locator("button", { hasText: "Demo Project" }).first().click();
      await wiz.locator("button", { hasText: "Software Simplified Workflow" }).first().click();
      await wiz.locator("button", { hasText: "Submit for Review" }).first().click();
      const row = wiz.locator("button", { hasText: "Coder: build" }).first();
      ok(await row.count() > 0, "J16r the rule-type step offers the Coder post-function row");
      await row.click();
      await wiz.locator(".pr-seg-coder").first().waitFor({ timeout: 12000 });
      ok(await wiz.locator(".pr-seg-coder .pr-seg-btn").count() === 5, "J16r step 5 mounts the same catalogue form (five modes)");
      // The rule is chosen ONCE, at the type step: the form arrives hydrated to it.
      ok(await wiz.locator(".dropdown-trigger", { hasText: "Coder: build" }).count() === 1, "J16r the form is hydrated to the rule the type step already chose");
      ok(await wiz.locator(".cpf-cap-on").count() === 1, "J16r the capability verdict is shown (Coder ON in the default fixture)");
      ok(await wiz.locator(".cpf-gate").count() === 1, "J16r the save gate is shown while no mode is chosen");
      // Mode required: Create is refused and nothing is registered or injected.
      await page.locator("button", { hasText: "Create Rule" }).first().click();
      await page.waitForTimeout(400);
      const calls = await page.evaluate(() => (window.__CALLS__ || []).map((c) => c.name));
      ok(!calls.includes("injectWorkflowRule"), "J16r the wizard refuses to create a modeless Coder rule");
      // Complete it and create for real.
      await wiz.locator(".pr-seg-coder .pr-seg-btn", { hasText: "Review the pull request" }).first().click();
      await wiz.locator(".dropdown-trigger", { hasText: "Choose a git connection" }).first().click();
      await page.waitForSelector(".dropdown-panel", { timeout: 6000 });
      await page.locator(".dropdown-panel .dropdown-item", { hasText: "Acme engineering" }).first().click();
      await wiz.locator(".dropdown-trigger", { hasText: "Choose a repository" }).first().click();
      await page.waitForSelector(".dropdown-panel", { timeout: 6000 });
      await page.locator(".dropdown-panel .dropdown-item", { hasText: "acme/web" }).first().click();
      await page.locator("button", { hasText: "Create Rule" }).first().click();
      await page.waitForFunction(() => (window.__CALLS__ || []).some((c) => c.name === "injectWorkflowRule"), { timeout: 8000 });
      const reg = await page.evaluate(() => (window.__CALLS__ || []).filter((c) => c.name === "registerPostFunction").at(-1).payload);
      ok(reg.ruleKind === "premade" && reg.premadeRuleType === "postfunction-coder" && reg.type === "postfunction-coder",
        "J16r the wizard registers a premade post-function row typed as the catalogue key");
      ok(reg.mode === "review" && reg.repo === "acme/web", "J16r the wizard's payload carries the mode and the repository");
      const inj = await page.evaluate(() => (window.__CALLS__ || []).filter((c) => c.name === "injectWorkflowRule").at(-1).payload);
      ok(inj.ruleType === "postfunction-coder", "J16r the injected rule type is the catalogue key (RULE_KEY_MAP routes it to the semantic slot)");
      ok(JSON.parse(inj.config).ruleKind === "premade", "J16r the injected config is the premade one resolvePfType routes on");
    } catch (e) { fail++; console.log("  ✗ J16r threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- J23c — F-398: config-view renders a saved Coder post-function ---------
     The read-only surface already had the ROWS (premadeSummaryRows renders the mode, the
     note and the git group), but its IDENTITY could only answer validator-vs-condition, so a
     saved Coder rule opened here announced itself as a "Premade Validator". */
  for (const theme of ["light", "dark"]) {
    console.log(`J23c config-view coder post-function summary (view-premade-coder, ${theme})`);
    const env = await openEditor(browser, "config-view", "view-premade-coder", theme);
    const { page } = env;
    try {
      await page.locator(".cv-summary-card").first().waitFor({ timeout: 8000 });
      const title = await page.locator(".cv-summary-card").first().innerText();
      ok(/Premade Post Function/i.test(title), `J23c (${theme}) the summary names it a post-function, not a validator`);
      ok(!/Premade Validator/i.test(title), `J23c (${theme}) it is no longer labelled a validator`);
      const body = await page.locator("body").innerText();
      ok(/Coder: build/.test(body), `J23c (${theme}) the catalogue label renders`);
      ok(/What the Coder does:/.test(body) && /Build the change/.test(body), `J23c (${theme}) the mode renders by LABEL, not by id`);
      ok(/CONTRIBUTING\.md/.test(body), `J23c (${theme}) the admin's extra instructions render`);
      ok(/Acme engineering/.test(body) && /acme\/web/.test(body), `J23c (${theme}) the connection label and the repository render`);
      ok(/BLOCKS the transition|Strict:/.test(body), `J23c (${theme}) the strict sentence renders`);
      ok(!/Match pull request by/.test(body), `J23c (${theme}) no prMatch row - the Coder has no such control`);
      /* F-463 - the skills the rule runs with, by NAME. The ids are the engine's
         vocabulary; a reader checking what this transition hands the Coder needs the same
         words the skills list shows them. */
      ok(/Skills:/.test(body), `J23c (${theme}) the skills row renders`);
      ok(/Create a linked issue/.test(body) && /Build an ADF comment/.test(body), `J23c (${theme}) the skills are named`);
      ok(!/sk1|sk3/.test(body), `J23c (${theme}) no raw skill id reaches the read-only summary`);
    } catch (e) { fail++; console.log(`  ✗ J23c (${theme}) threw: ` + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- J23e — F-572: the field guide is provenance in the READ-ONLY view -------
     config-view's `hasProvenance` tested docs/skills/memories only, so a step generated with
     the BAKED FIELD GUIDE and nothing else rendered no GENERATED WITH row at all — and that
     is the DEFAULT shape for a first-time author (no docs picked, no skills bound, memory
     injection off). The reviewer reading the saved rule was told the code was generated with
     nothing. The fixture deliberately empties the other three so the row can only be on
     screen because the guide put it there. */
  for (const theme of ["light", "dark"]) {
    console.log(`J23e config-view field-guide provenance (view-static-fieldguide, ${theme})`);
    const env = await openEditor(browser, "config-view", "view-static-fieldguide", theme);
    const { page } = env;
    try {
      const row = page.locator(".cv-gen-row", { hasText: "GENERATED WITH" }).first();
      await row.waitFor({ timeout: 8000 });
      ok(await row.count() > 0, `J23e (${theme}) the GENERATED WITH row renders when the field guide is the ONLY provenance`);

      // The fixture's control: none of the three old chip kinds may be what put the row there.
      ok(await page.locator(".cv-gen-docs, .cv-gen-skill, .cv-gen-mem").count() === 0,
        `J23e (${theme}) no docs/skills/memories chip — the row is carried by the guide alone`);

      const chip = row.locator(".gen-meta-chip.gmc-fieldguide").first();
      ok(await chip.count() === 1, `J23e (${theme}) the shared FieldGuideChip renders inside the row`);
      const label = await chip.innerText();
      ok(/Field guide:\s*3 sections/.test(label), `J23e (${theme}) the chip names the count it can resolve (got "${label.replace(/\s+/g, " ").trim()}")`);

      // Collapsed by default, and the expanded list must agree with the count on the chip.
      ok(await page.locator(".fg-chip-item").count() === 0, `J23e (${theme}) the title list starts collapsed`);
      ok(await chip.getAttribute("aria-expanded") === "false", `J23e (${theme}) the chip reports its collapsed state`);
      await chip.click();
      await page.locator(".fg-chip-item").first().waitFor({ timeout: 4000 });
      const titles = await page.locator(".fg-chip-item").allInnerTexts();
      ok(titles.length === 3, `J23e (${theme}) the expanded list has one entry per counted section (got ${titles.length})`);
      for (const want of [
        "12. Two agents, one working tree",
        "17. An Assets object field silently stores nothing until configured in the UI",
        "4. A silent wrong-issue WRITE hides behind a type check that looks defensive",
      ]) ok(titles.some((t) => t.trim() === want), `J23e (${theme}) the list names "${want.slice(0, 34)}…"`);

      /* The rule the shared chip exists for: a generated section id is meaningless to a
         reader and must never reach the screen, not even as a fallback. */
      const body = await page.locator("body").innerText();
      ok(!/cognirunner-sandbox-traps\/|jira-rest-correctness\//.test(body),
        `J23e (${theme}) no raw section id reaches the read-only summary`);

      /* Design: solid saturated hue with its own dark override, NO left accent rail, NO
         low-alpha tint. Asserted on computed style so a later CSS edit that reaches for
         either device fails here. */
      const style = await chip.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { background: cs.backgroundColor, color: cs.color, borderLeftWidth: cs.borderLeftWidth, fontWeight: cs.fontWeight };
      });
      ok(style.borderLeftWidth === "0px", `J23e (${theme}) no left accent rail on the chip`);
      ok(/^rgb\(\d+, \d+, \d+\)$/.test(style.background), `J23e (${theme}) the chip fill is a SOLID colour, not an alpha tint (got ${style.background})`);
      ok(Number(style.fontWeight) >= 600, `J23e (${theme}) the chip carries the 600-700 emphasis weight`);
      ok(style.background === (theme === "dark" ? "rgb(245, 158, 11)" : "rgb(180, 83, 9)"),
        `J23e (${theme}) the amber has a dark-mode override (got ${style.background})`);
      /* Dark takes dark ink on #f59e0b: white on that amber is the one pair in the project
         hue map that fails contrast, the same exception .pf-test-stale makes. */
      ok(style.color === (theme === "dark" ? "rgb(42, 22, 2)" : "rgb(255, 255, 255)"),
        `J23e (${theme}) the ink is the readable one for this fill (got ${style.color})`);
    } catch (e) { fail++; console.log(`  ✗ J23e (${theme}) threw: ` + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- J23f — F-587: the predicate and the chip must AGREE -------------------
     `hasProvenance` tested the presence of stored IDS; `FieldGuideChip` tests the presence of
     resolvable TITLES and renders null when it can name none. They disagree in exactly the
     case the chip was written for — a config saved before a RE-BAKE, whose chunk ids carry a
     content hash and no longer exist — so with no docs, no skills and memory injection off
     (the stated default) the row rendered the words GENERATED WITH followed by empty space.
     That is a worse claim than the blank row F-572 replaced: it asserts provenance and then
     names none. Two arms, because a fix that simply HID the row would pass the first one and
     lose real provenance in the second:
       all-stale → the label plus a NEUTRAL chip saying the sections predate this bake
       mixed     → the resolvable titles, and no neutral chip while a real title exists */
  for (const theme of ["light", "dark"]) {
    console.log(`J23f config-view stale field-guide ids (view-static-fieldguide, all-stale, ${theme})`);
    const env = await openEditor(browser, "config-view", "view-static-fieldguide", theme, { __FG_STALE__: "all" });
    const { page } = env;
    try {
      const row = page.locator(".cv-gen-row", { hasText: "GENERATED WITH" }).first();
      await row.waitFor({ timeout: 8000 });
      ok(await row.count() > 0, `J23f (${theme}) the GENERATED WITH row still renders when every stored id is stale`);

      // The control: the guide is the ONLY provenance, so nothing else can hold the row open.
      ok(await page.locator(".cv-gen-docs, .cv-gen-skill, .cv-gen-mem").count() === 0,
        `J23f (${theme}) no docs/skills/memories chip — the row is the guide's alone`);

      // The bug, asserted directly: the shared chip can name nothing, so the row must not be empty.
      ok(await row.locator(".gen-meta-chip.gmc-fieldguide").count() === 0,
        `J23f (${theme}) the resolving chip is absent — it can name no section`);
      const stale = row.locator(".cv-gen-fg-stale").first();
      ok(await stale.count() === 1, `J23f (${theme}) the neutral stale chip stands in its place`);
      const staleText = (await stale.innerText()).replace(/\s+/g, " ").trim();
      ok(/field guide sections from an earlier bake/i.test(staleText),
        `J23f (${theme}) the chip says the sections predate this bake (got "${staleText}")`);
      ok(!/—/.test(staleText), `J23f (${theme}) no em-dash in the chip copy`);

      /* The defect itself, asserted on the RENDERED TEXT rather than on the chip that happens
         to fix it today: GENERATED WITH may never be followed by nothing again. */
      const rowText = (await row.innerText()).replace(/\s+/g, " ").trim();
      ok(rowText.replace(/GENERATED WITH/i, "").trim().length > 0,
        `J23f (${theme}) GENERATED WITH is never followed by nothing (got "${rowText}")`);

      // The chip's standing rule: a generated section id is meaningless and never reaches the screen.
      const body = await page.locator("body").innerText();
      ok(!/stale-chunk-1|stale-chunk-2/.test(body), `J23f (${theme}) no raw stale id is printed as a fallback`);

      /* Design: NEUTRAL slate, solid fill, white ink, 600-700, no left rail, no alpha tint.
         Slate rather than the guide's amber on purpose — amber would imply the sections
         resolved. --accent-slate carries its own dark variant, asserted here in both themes. */
      const style = await stale.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { background: cs.backgroundColor, color: cs.color, borderLeftWidth: cs.borderLeftWidth, fontWeight: cs.fontWeight };
      });
      ok(style.borderLeftWidth === "0px", `J23f (${theme}) no left accent rail on the stale chip`);
      ok(/^rgb\(\d+, \d+, \d+\)$/.test(style.background), `J23f (${theme}) the fill is SOLID, not an alpha tint (got ${style.background})`);
      ok(Number(style.fontWeight) >= 600, `J23f (${theme}) the stale chip carries the 600-700 emphasis weight`);
      ok(style.color === "rgb(255, 255, 255)", `J23f (${theme}) white ink on the slate fill (got ${style.color})`);
      ok(style.background === (theme === "dark" ? "rgb(100, 116, 139)" : "rgb(71, 85, 105)"),
        `J23f (${theme}) the slate has a dark-mode override (got ${style.background})`);
    } catch (e) { fail++; console.log(`  ✗ J23f (${theme}) threw: ` + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  {
    /* MIXED — one resolvable id among two stale ones. The fix must not trade a wrong EMPTY
       row for a wrong NEUTRAL one: the chip names what it can, the count matches the expanded
       list, and the stale chip stays away while a real title is on screen. */
    console.log("J23f-mixed config-view mixed field-guide ids (view-static-fieldguide, mixed)");
    const env = await openEditor(browser, "config-view", "view-static-fieldguide", "light", { __FG_STALE__: "mixed" });
    const { page } = env;
    try {
      const row = page.locator(".cv-gen-row", { hasText: "GENERATED WITH" }).first();
      await row.waitFor({ timeout: 8000 });
      const chip = row.locator(".gen-meta-chip.gmc-fieldguide").first();
      ok(await chip.count() === 1, "J23f-mixed the resolving chip renders for the id that still exists");
      const label = (await chip.innerText()).replace(/\s+/g, " ").trim();
      ok(/Field guide:\s*1 section\b/.test(label), `J23f-mixed the chip counts ONLY what it resolved (got "${label}")`);
      ok(await row.locator(".cv-gen-fg-stale").count() === 0,
        "J23f-mixed no neutral stale chip while a real title is nameable");

      // The expanded list must agree with the count, as it does in the all-resolvable arm.
      await chip.click();
      await page.locator(".fg-chip-item").first().waitFor({ timeout: 4000 });
      const titles = await page.locator(".fg-chip-item").allInnerTexts();
      ok(titles.length === 1, `J23f-mixed the expanded list has one entry per counted section (got ${titles.length})`);
      const body = await page.locator("body").innerText();
      ok(!/stale-chunk-1|stale-chunk-2/.test(body), "J23f-mixed the two dead ids are dropped, not printed");
    } catch (e) { fail++; console.log("  ✗ J23f-mixed threw: " + e.message.split("\n")[0]); }
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
      /* F-915 - AN HONEST EMPTY STATE IS NOT ENOUGH IF IT IS ALSO A DEAD END. A cold walk
         of a real issue found this panel to be the developer's first contact with the app,
         saying nothing had happened and offering no way to make anything happen. The Coder
         lives in a SEPARATE issue panel that Jira does not show until the reader adds it
         from the issue's Apps control, so the sentence has to name both the control and the
         panel's title. Asserted on the words a reader would look for, not on a class. */
      const empty = await page.locator(".glance-empty").innerText();
      ok(/Apps/.test(empty) && /CogniRunner Coder/.test(empty),
        `E14 the empty state names the Apps button and the Coder panel (got "${empty}")`);
      ok(/describe what you want done/i.test(empty), "E14 ...and says what to do once it is open");
      if (SHOTS) await page.locator(".glance").screenshot({ path: path.join(OUT, "glance-empty-pointer-light.png") });
    } catch (e) { fail++; console.log("  ✗ E14 threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);

    // The same state in DARK. The sentence carries two <strong> runs, and emphasis is the
    // one device in this app that has to be legible on both backgrounds.
    const envDark = await openEditor(browser, "issue-glance", "issue-glance-empty", "dark");
    try {
      await envDark.page.locator(".glance-empty").waitFor({ timeout: 8000 });
      ok(/CogniRunner Coder/.test(await envDark.page.locator(".glance-empty").innerText()), "E14 dark carries the same pointer");
      if (SHOTS) await envDark.page.locator(".glance").screenshot({ path: path.join(OUT, "glance-empty-pointer-dark.png") });
    } catch (e) { fail++; console.log("  ✗ E14 dark threw: " + e.message.split("\n")[0]); }
    await closeEditor(envDark);
  }

  /* --------- E14b — F-915: the pointer is EDITION-GATED, on the restrictive side --------
     The Coder panel refuses a Standard install (`coderGate`), so a Standard reader sent to
     it would arrive at a card that tells them no. The empty state still says what it
     always said; it just stops offering a door that is locked. */
  {
    console.log("E14b issue-glance empty state, Standard edition (F-915)");
    const env = await openEditor(browser, "issue-glance", "issue-glance-empty", "light", { __STANDARD__: true });
    const { page } = env;
    try {
      await page.locator(".glance-empty").waitFor({ timeout: 8000 });
      const empty = await page.locator(".glance-empty").innerText();
      ok(/No CogniRunner activity recorded/i.test(empty), "E14b the empty state itself is unchanged on Standard");
      ok(!/CogniRunner Coder/.test(empty), `E14b a Standard install is NOT pointed at the Coder panel (got "${empty}")`);
    } catch (e) { fail++; console.log("  ✗ E14b threw: " + e.message.split("\n")[0]); }
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
  /* ---------------- F-179/F-181 — the retired wording may not come back ----------------
   * A browser assertion proves the two surfaces we drove say the right thing TODAY. It
   * cannot stop a third surface — a toast, an empty state, a tooltip — from being written
   * next month with the old words, which is exactly how this defect spread: the banner and
   * the fix-tail each carried their own copy of a policy sentence and each drifted from it
   * separately. So scan the SOURCE of all three apps.
   *
   * Retired, and why:
   *   "prune"          — no control in this app prunes anything; the verb is Delete.
   *   "Delete or merge" — there is no merge control. `merged` is an outcome of a dedup on
   *                      save, not an action a user can take to reclaim capacity.
   * Comments are stripped first: the docblocks that RECORD this decision necessarily quote
   * the retired words, and a scan that cannot tell a quotation from a regression would
   * force the reasoning to be deleted to stay green. */
  {
    console.log("F-179/F-181 no .jsx retypes the retired memory-cap wording");
    const RETIRED = [
      { re: /prune/i, why: 'the verb is "Delete" — nothing in this app prunes' },
      { re: /delete or merge/i, why: "there is no merge control to offer" },
    ];
    // Strip block comments, then line comments. The `(^|[^:])` guard keeps `https://` in a
    // string literal from being read as the start of a comment and silently eating the rest
    // of the line (which would turn this scan into a false PASS).
    const stripComments = (src) => src
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    const jsxFiles = [];
    for (const app of ["config-ui", "config-view", "admin-panel"]) {
      const root = path.join(STATIC, app, "src");
      if (!fs.existsSync(root)) continue;
      const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          const f = path.join(dir, e.name);
          if (e.isDirectory()) walk(f);
          else if (/\.(jsx|js)$/.test(e.name)) jsxFiles.push(f);
        }
      };
      walk(root);
    }
    ok(jsxFiles.length > 0, `F-179 the scan actually found source to read (${jsxFiles.length} files)`);
    // Positive control: prove the scan CAN see live code text, so an empty result means
    // "clean" rather than "the walk or the stripper quietly read nothing".
    const canSee = jsxFiles.some((f) => /Memory store is full/.test(stripComments(fs.readFileSync(f, "utf8"))));
    ok(canSee, "F-179 the scan can see live UI copy (positive control: the banner title)");

    const offenders = [];
    for (const f of jsxFiles) {
      const code = stripComments(fs.readFileSync(f, "utf8"));
      for (const { re, why } of RETIRED) {
        if (re.test(code)) offenders.push(`${path.relative(STATIC, f)} matches ${re} — ${why}`);
      }
    }
    ok(offenders.length === 0,
      `F-179/F-181 no app source retypes the retired wording${offenders.length ? " — " + offenders.join("; ") : ""}`);
  }


  /* ---------------- J16u - F-447: the CONFLUENCE param group, light AND dark ----------
     The defect this closes is the git one repeating on a new group: PremadeRuleForm had
     no renderer for `params.confluence`, so the Confluence validator could be picked and
     saved with no space and no query - a rule the executor then BLOCKS every transition
     on, in both strict columns, because misconfiguration is not a degradation (F-416).
     The arm drives the group from empty and asserts the string the editor hands Jira:
     a control that does not reach the saved config is a form pretending to be a rule. */
  for (const theme of ["light", "dark"]) {
    console.log(`J16u Confluence premade validator group (cfg-premade-confluence, ${theme})`);
    const env = await openEditor(browser, "config-ui", "cfg-premade-confluence", theme);
    const { page } = env;
    try {
      const rulePicker = page.locator(".dropdown-trigger", { hasText: "Choose a premade rule" }).first();
      await rulePicker.click();
      await page.waitForSelector(".dropdown-panel", { timeout: 6000 });
      const opt = page.locator(".dropdown-panel .dropdown-item", { hasText: "a page for this issue exists" }).first();
      ok(await opt.count() > 0, `J16u (${theme}) the catalogue offers "Confluence: a page for this issue exists"`);
      await opt.click();

      // The whole group renders, and none of it is native chrome.
      await page.waitForSelector(".pr-seg-conf", { timeout: 6000 });
      ok(await page.locator("select").count() === 0, `J16u (${theme}) no native <select> anywhere in the Confluence group`);
      ok(await page.locator(".pr-seg-conf .pr-seg-btn").count() === 2, `J16u (${theme}) the mode is a 2-option segmented control, not a dropdown`);
      ok(await page.locator(".pr-conf-ph").count() >= 3, `J16u (${theme}) the placeholder legend names {issueKey}, {summary} and {field:<id>}`);
      ok(await page.locator(".pr-git-toggle-row input[type=checkbox]").count() === 1, `J16u (${theme}) the Strict toggle renders on the validator`);

      // The SPACE is picked, never typed.
      const spacePicker = page.locator(".dropdown-trigger", { hasText: "Choose a Confluence space" }).first();
      ok(await spacePicker.count() > 0, `J16u (${theme}) the space picker renders with its placeholder`);
      await spacePicker.click();
      await page.waitForSelector(".dropdown-panel", { timeout: 6000 });
      const spaceItems = await page.locator(".dropdown-panel .dropdown-item").allInnerTexts();
      ok(spaceItems.some((t) => /Engineering \(ENG\)/.test(t)), `J16u (${theme}) the space list comes from getRuleLists.confluencespaces`);
      await page.locator(".dropdown-panel .dropdown-item", { hasText: "Engineering (ENG)" }).first().click();

      // The query, and the LIVE example: proof the value arrives already quoted.
      const cql = page.locator("textarea.pr-conf-tpl").first();
      await cql.fill("title ~ {issueKey} OR text ~ {summary}");
      await page.waitForSelector(".pr-conf-example", { timeout: 6000 });
      const exampleText = await page.locator(".pr-conf-example-text").first().innerText();
      ok(/ACME-42/.test(exampleText), `J16u (${theme}) the live example substitutes the sample issue key (got "${exampleText}")`);
      ok(/"ACME-42"/.test(exampleText), `J16u (${theme}) the example shows the value ARRIVING QUOTED, which is what the template must not do itself`);
      const exBg = await page.locator(".pr-conf-example").first().evaluate((el) => getComputedStyle(el).backgroundColor);
      ok(exBg === (theme === "dark" ? "rgb(59, 130, 246)" : "rgb(29, 78, 216)"), `J16u (${theme}) the example block is a SOLID Confluence-hue fill, not a tint - got ${exBg}`);
      ok(await page.locator(".pr-conf-example").first().evaluate((el) => getComputedStyle(el).borderLeftWidth) === "0px", `J16u (${theme}) the example block has NO left accent rail`);

      // THE MODE SWITCH: semantic reveals the prompt, and the prompt is REQUIRED there
      // (a semantic rule with no prompt is misconfiguration, which blocks either way).
      ok(await page.locator("textarea[placeholder*='rollback plan and name an owner']").count() === 0, `J16u (${theme}) CQL mode does not draw the semantic prompt`);
      await page.locator(".pr-seg-conf .pr-seg-btn", { hasText: "must SAY something" }).first().click();
      await page.waitForSelector("textarea[placeholder*='rollback plan and name an owner']", { timeout: 6000 });
      ok(await page.locator(".pr-seg-conf .pr-seg-btn.active", { hasText: "must SAY something" }).count() === 1, `J16u (${theme}) the segmented control marks Semantic active`);
      const halfSaved = await page.evaluate(async () => {
        const raw = await window.__ON_CONFIGURE__();
        return raw == null || raw === "undefined" ? null : JSON.parse(raw);
      });
      ok(halfSaved === null, `J16u (${theme}) Semantic mode with no prompt is NOT savable (it would block every transition as misconfigured)`);
      await page.locator("textarea[placeholder*='rollback plan and name an owner']").first().fill("The page must describe the rollback plan.");

      // Strict copy switches, and it says what the F-416 table says - both columns.
      const strictBox = page.locator(".pr-git-toggle-row input[type=checkbox]").first();
      ok(!(await strictBox.isChecked()), `J16u (${theme}) Strict defaults OFF (the app-wide fail-OPEN contract)`);
      const strictCopy = async () => (await page.locator(".pr-git-toggle-row").locator("xpath=following-sibling::p[1]").first().innerText());
      ok(/ALLOWED/.test(await strictCopy()), `J16u (${theme}) Strict OFF copy: an unreachable Confluence ALLOWS the transition`);
      await strictBox.check();
      ok(/BLOCKED/.test(await strictCopy()), `J16u (${theme}) Strict ON copy: an unreachable Confluence BLOCKS the transition`);
      const misconfigCopy = await page.locator(".pr-conf-misconfig").first().innerText();
      ok(/blocks the transition in both modes/.test(misconfigCopy), `J16u (${theme}) the note says an incomplete rule blocks in BOTH columns (got "${misconfigCopy}")`);

      // THE POINT: exactly the catalogue's param ids reach the config Jira is handed.
      const saved = await page.evaluate(async () => JSON.parse(await window.__ON_CONFIGURE__()));
      ok(saved.ruleKind === "premade" && saved.ruleType === "confluence-page-exists", `J16u (${theme}) saved config is the premade Confluence rule`);
      ok(saved.spaceKey === "ENG", `J16u (${theme}) saved config carries spaceKey (ENG)`);
      ok(saved.mode === "semantic", `J16u (${theme}) saved config carries mode (semantic)`);
      ok(saved.cqlTemplate === "title ~ {issueKey} OR text ~ {summary}", `J16u (${theme}) saved config carries the UNRENDERED cqlTemplate`);
      ok(saved.prompt === "The page must describe the rollback plan.", `J16u (${theme}) saved config carries the semantic prompt`);
      ok(saved.strict === true, `J16u (${theme}) saved config carries strict`);
      ok(!("titleTemplate" in saved) && !("commentTemplate" in saved) && !("parentId" in saved),
        `J16u (${theme}) the validator saves NO post-function-only keys - the catalogue does not give it those controls`);
    } catch (e) { fail++; console.log(`  ✗ J16u (${theme}) threw: ` + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- J16v - F-447: the two CONFLUENCE POST-FUNCTIONS -------------------
     Same group, two OBJECT forms of it (`confluence: { mode: false, ... }`). The arm
     proves the form reads `confluenceSubEnabled` and not truthiness: the page rule draws
     a title and a parent and NO mode; the comment rule draws the comment text and none
     of the page's controls. Neither draws Strict - a post-function runs after the
     transition, where "block or allow" is not a choice anything can make. */
  for (const theme of ["light", "dark"]) {
    console.log(`J16v Confluence premade post-functions (cfg-premade-confluence-pf, ${theme})`);
    const env = await openEditor(browser, "config-ui", "cfg-premade-confluence-pf", theme);
    const { page } = env;
    try {
      await page.waitForSelector(".pr-form", { timeout: 8000 });
      // --- the PAGE rule ---
      await page.locator(".dropdown-trigger", { hasText: "Choose a premade rule" }).first().click();
      await page.waitForSelector(".dropdown-panel", { timeout: 6000 });
      await page.locator(".dropdown-panel .dropdown-item", { hasText: "create or update a page" }).first().click();
      await page.waitForSelector(".dropdown-trigger", { hasText: "Choose a Confluence space" }, { timeout: 8000 });
      ok(await page.locator("select").count() === 0, `J16v (${theme}) no native <select> on the Confluence post-function editor`);
      ok(await page.locator(".pr-seg-conf").count() === 0, `J16v (${theme}) the page rule draws NO mode control - the catalogue switches it off`);
      ok(await page.locator("input[placeholder*='Default:']").count() === 1, `J16v (${theme}) the page rule shows the DEFAULT title in the title control`);
      ok(await page.locator("input[placeholder='e.g. 393217']").count() === 1, `J16v (${theme}) the page rule draws the parent page id`);
      ok(await page.locator("textarea[placeholder*='moved on']").count() === 0, `J16v (${theme}) the page rule draws NO comment text`);
      ok(await page.locator(".pr-git-toggle-row").count() === 0, `J16v (${theme}) a post-function draws NO Strict toggle - it cannot block anything`);
      /* F-915 - THE FOOTER TALKED ABOUT THE CODER ON A CONFLUENCE RULE. It was keyed on
         "is this a post-function", so a designer configuring a page rule was told, in the
         app's own voice, that "the Coder works in the background for several minutes".
         The sentence now comes from the catalogue row's own `foot`, beside its label and
         its help, and this asserts the WORDS the reader ends up with. */
      const confFoot = await page.locator(".pr-foot").innerText();
      ok(!/Coder/.test(confFoot), `J16v (${theme}) a Confluence rule's footer does not mention the Coder (got "${confFoot}")`);
      /* F-915 - AND NEITHER DOES THE SAVE GATE ABOVE THE FORM. It was keyed on "is this a
         post-function", so a designer with an unfinished CONFLUENCE rule was told to "pick
         what the Coder should do" and that "the connection and the repository are required
         too" - of a rule that has neither. It is keyed on the same `requiresCapability`
         predicate the capability card uses. The rule is unfinished at this point (no space
         has been picked yet), which is exactly when the gate renders. */
      if (await page.locator(".cpf-gate").count() > 0) {
        const gate = (await page.locator(".cpf-gate").innerText()).replace(/\s+/g, " ");
        ok(!/Coder/.test(gate) && !/repository/i.test(gate),
          `J16v (${theme}) the save gate does not describe the Coder on a Confluence rule (got "${gate}")`);
        ok(/Fill in this rule's details/.test(gate), `J16v (${theme}) it names what it actually wants (got "${gate}")`);
      }
      ok(/runs AFTER the transition/.test(confFoot) && /link to it/.test(confFoot),
        `J16v (${theme}) it says what the PAGE rule does instead (got "${confFoot}")`);
      /* F-915 - the parent page id says where the number comes from, in the LABEL, because
         the question a reader has at that box is "which number is that". */
      const parentLabel = await page.locator(".label", { hasText: "Parent page" }).first().innerText();
      ok(/id from the page URL/i.test(parentLabel), `J16v (${theme}) the parent control names its source (got "${parentLabel}")`);
      const titleDefault = await page.locator("input[placeholder*='Default:']").first().getAttribute("placeholder");
      ok(/\{issueKey\}/.test(titleDefault) && /\{summary\}/.test(titleDefault), `J16v (${theme}) the default title is the run time's own fallback (got "${titleDefault}")`);
      // A parent that is not a page id is refused in front of the reader.
      await page.locator("input[placeholder='e.g. 393217']").first().fill("Engineering home");
      ok(/digits only/.test(await page.locator("input[placeholder='e.g. 393217']").locator("xpath=following-sibling::p[1]").first().innerText()),
        `J16v (${theme}) a non-numeric parent page id is named as wrong, not silently dropped`);
      await page.locator("input[placeholder='e.g. 393217']").first().fill("393217");

      await page.locator(".dropdown-trigger", { hasText: "Choose a Confluence space" }).first().click();
      await page.waitForSelector(".dropdown-panel", { timeout: 6000 });
      await page.locator(".dropdown-panel .dropdown-item", { hasText: "Operations (OPS)" }).first().click();
      await page.locator("input[placeholder*='Default:']").first().fill("{issueKey} design notes");
      const savedPage = await page.evaluate(async () => JSON.parse(await window.__ON_CONFIGURE__()));
      ok(savedPage.ruleType === "postfunction-confluence-page" && savedPage.type === "postfunction-confluence-page",
        `J16v (${theme}) BOTH ruleType and type carry the catalogue key for the page rule`);
      ok(savedPage.spaceKey === "OPS", `J16v (${theme}) the page rule saves its space`);
      ok(savedPage.titleTemplate === "{issueKey} design notes", `J16v (${theme}) the page rule saves the title template`);
      ok(savedPage.parentId === "393217", `J16v (${theme}) the page rule saves the parent page id`);
      ok(!("mode" in savedPage) && !("commentTemplate" in savedPage),
        `J16v (${theme}) the page rule saves NO key its group switched off`);

      // --- the COMMENT rule. Switching rule types must clear the page rule's params. ---
      await page.locator(".dropdown-trigger", { hasText: "create or update a page" }).first().click();
      await page.waitForSelector(".dropdown-panel", { timeout: 6000 });
      await page.locator(".dropdown-panel .dropdown-item", { hasText: "comment on the linked page" }).first().click();
      await page.waitForSelector("textarea[placeholder*='moved on']", { timeout: 8000 });
      ok(await page.locator("input[placeholder*='Default:']").count() === 0, `J16v (${theme}) the comment rule draws NO page title`);
      ok(await page.locator("input[placeholder='e.g. 393217']").count() === 0, `J16v (${theme}) the comment rule draws NO parent page id`);
      ok(await page.locator("textarea.pr-conf-tpl").count() === 1, `J16v (${theme}) the comment rule draws ONE template box - the comment text`);
      const beforeText = await page.evaluate(async () => {
        const raw = await window.__ON_CONFIGURE__();
        return raw == null || raw === "undefined" ? null : JSON.parse(raw);
      });
      ok(beforeText === null, `J16v (${theme}) a comment rule with no text is NOT savable (it errors on every run)`);
      await page.locator(".dropdown-trigger", { hasText: "Choose a Confluence space" }).first().click();
      await page.waitForSelector(".dropdown-panel", { timeout: 6000 });
      await page.locator(".dropdown-panel .dropdown-item", { hasText: "Engineering (ENG)" }).first().click();
      await page.locator("textarea.pr-conf-tpl").first().fill("{issueKey} moved: {summary}");
      const commentExample = await page.locator(".pr-conf-example-text").first().innerText();
      ok(/ACME-42 moved:/.test(commentExample), `J16v (${theme}) the comment's live example substitutes RAW - a comment is not a query (got "${commentExample}")`);
      const savedComment = await page.evaluate(async () => JSON.parse(await window.__ON_CONFIGURE__()));
      ok(savedComment.ruleType === "postfunction-confluence-comment", `J16v (${theme}) the comment rule saves its catalogue key`);
      ok(savedComment.commentTemplate === "{issueKey} moved: {summary}", `J16v (${theme}) the comment rule saves the comment template`);
      // F-915 - and the COMMENT rule gets its own footer, not the page rule's and not the Coder's.
      const cFoot = await page.locator(".pr-foot").innerText();
      ok(!/Coder/.test(cFoot) && /no AI and no token cost/i.test(cFoot),
        `J16v (${theme}) the comment rule's footer is its own (got "${cFoot}")`);
      if (SHOTS) await page.locator(".pr-form").screenshot({ path: path.join(OUT, `conf-pf-comment-${theme}.png`) });
      ok(savedComment.spaceKey === "ENG", `J16v (${theme}) the comment rule saves its space`);
      ok(!("titleTemplate" in savedComment) && !("parentId" in savedComment) && !("cqlTemplate" in savedComment),
        `J16v (${theme}) the page rule's params did NOT survive the rule-type switch`);
    } catch (e) { fail++; console.log(`  ✗ J16v (${theme}) threw: ` + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- J16w - F-447: no Confluence on the site ---------------------------
     `listConfluenceSpacesForPicker` degrades to an EMPTY list on a site with no
     Confluence (the common case - this is a Jira app), and an empty control that looks
     broken is not an answer. The picker must SAY what is missing, and the rule must not
     be savable without a space. */
  {
    console.log("J16w Confluence group with no spaces (cfg-premade-confluence)");
    const env = await openEditor(browser, "config-ui", "cfg-premade-confluence", "light", { __NO_CONFLUENCE__: true });
    const { page } = env;
    try {
      await page.locator(".dropdown-trigger", { hasText: "Choose a premade rule" }).first().click();
      await page.waitForSelector(".dropdown-panel", { timeout: 6000 });
      await page.locator(".dropdown-panel .dropdown-item", { hasText: "a page for this issue exists" }).first().click();
      await page.waitForSelector(".pr-seg-conf", { timeout: 6000 });
      const empty = page.locator(".dropdown-trigger", { hasText: "No Confluence spaces" }).first();
      ok(await empty.count() > 0, "J16w the empty picker says CogniRunner is not installed on Confluence");
      ok(await page.locator("select").count() === 0, "J16w still no native <select>");
      /* F-915 - A DISABLED PICKER IS NOT AN ANSWER. The placeholder was the whole story,
         and an empty control reads as "this app is broken" rather than "one install is
         missing". The card under it says what is missing and who fixes it, in the SAME
         words the runtime refusal uses - both read src/shared/confluence-rules.js, so an
         operator reading the execution log and a designer reading this form are never
         told two different things. */
      const card = page.locator(".pr-conf-missing");
      ok(await card.count() === 1, "J16w the missing install is stated as a card, not only as a placeholder");
      const cardText = (await card.innerText()).replace(/\s+/g, " ");
      ok(/not installed on Confluence on this site/.test(cardText), "J16w the card says what is missing");
      ok(/Apps, Manage apps/.test(cardText), "J16w ...and names the page a Jira admin does it on");
      ok(/cannot be saved/.test(cardText), "J16w ...and says what that means for this rule");
      /* The owner's rules on the new hue, both themes, at the render: a solid fill with
         white text, and never a left rail. */
      const cardStyle = await card.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { bg: cs.backgroundColor, fg: cs.color, leftBorder: cs.borderLeftWidth };
      });
      ok(cardStyle.bg === "rgb(71, 85, 105)", `J16w the card is the SOLID neutral slate (got ${cardStyle.bg})`);
      ok(cardStyle.fg === "rgb(255, 255, 255)", `J16w white text on it (got ${cardStyle.fg})`);
      ok(cardStyle.leftBorder === "0px", `J16w and no left accent rail (got ${cardStyle.leftBorder})`);
      if (SHOTS) await page.locator(".pr-form").screenshot({ path: path.join(OUT, "conf-not-installed-light.png") });
      await page.locator("textarea.pr-conf-tpl").first().fill("title ~ {issueKey}");
      const saved = await page.evaluate(async () => {
        const raw = await window.__ON_CONFIGURE__();
        return raw == null || raw === "undefined" ? null : JSON.parse(raw);
      });
      ok(saved === null, "J16w a Confluence rule with no space is NOT savable (it would block every transition)");
    } catch (e) { fail++; console.log("  ✗ J16w threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* J16w-dark - F-915: the new hue needs its dark override proven, not assumed. */
  {
    console.log("J16w-dark Confluence not installed, dark (F-915)");
    const env = await openEditor(browser, "config-ui", "cfg-premade-confluence", "dark", { __NO_CONFLUENCE__: true });
    const { page } = env;
    try {
      await page.locator(".dropdown-trigger", { hasText: "Choose a premade rule" }).first().click();
      await page.waitForSelector(".dropdown-panel", { timeout: 6000 });
      await page.locator(".dropdown-panel .dropdown-item", { hasText: "a page for this issue exists" }).first().click();
      await page.locator(".pr-conf-missing").waitFor({ timeout: 8000 });
      const s = await page.locator(".pr-conf-missing").evaluate((el) => {
        const cs = getComputedStyle(el);
        return { bg: cs.backgroundColor, fg: cs.color, leftBorder: cs.borderLeftWidth };
      });
      ok(s.bg === "rgb(100, 116, 139)", `J16w-dark the card uses the DARK slate (got ${s.bg})`);
      ok(s.fg === "rgb(255, 255, 255)", `J16w-dark white text in dark too (got ${s.fg})`);
      ok(s.leftBorder === "0px", `J16w-dark still no left accent rail (got ${s.leftBorder})`);
      if (SHOTS) await page.locator(".pr-form").screenshot({ path: path.join(OUT, "conf-not-installed-dark.png") });
    } catch (e) { fail++; console.log("  ✗ J16w-dark threw: " + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- J16y - F-958: the SECOND cold walk of the Confluence form ---------
     Three defects, all of them "the form knows something and does not say it":
       1. "Which page to look for" is REQUIRED and takes CQL, and the description builder
          that writes CQL sits COLLAPSED at the top of the form. A designer who does not
          write CQL was stopped at a required field with no route forward. The field now
          carries "Describe the page instead", which opens the builder and puts the caret
          in it.
       2. The not-installed card named "Apps, Manage apps" in prose and linked nothing.
       3. The rule's behaviour was stated THREE times on one screen - the catalogue help
          paragraph, the Strict paragraph and the footer - twice of them in caps-lock
          ALLOWED/BLOCKS. The Strict paragraph is the one that stays: it sits beside the
          checkbox that flips the behaviour and it states both columns. */
  for (const theme of ["light", "dark"]) {
    console.log(`J16y F-958 Confluence form: the route out of CQL and the copy that stopped repeating (${theme})`);
    const env = await openEditor(browser, "config-ui", "cfg-premade-confluence", theme);
    const { page } = env;
    try {
      await page.locator(".dropdown-trigger", { hasText: "Choose a premade rule" }).first().click();
      await page.waitForSelector(".dropdown-panel", { timeout: 6000 });
      await page.locator(".dropdown-panel .dropdown-item", { hasText: "a page for this issue exists" }).first().click();
      await page.waitForSelector(".pr-seg-conf", { timeout: 6000 });

      // (3) ONE statement of the degradation behaviour, not three.
      /* The COPY, not the labels: `.label` is uppercased by CSS, so "shown to the user if
         blocked" reads as caps in innerText and is not a second statement of anything. */
      const copyParas = (await page.locator(".pr-form p.hint, .pr-form .pr-note").allInnerTexts())
        .map((t) => t.replace(/\s+/g, " "));
      const capsParas = copyParas.filter((t) => /\b(ALLOWED|BLOCKED|BLOCKS)\b/.test(t));
      ok(capsParas.length === 1, `J16y (${theme}) the fail-open behaviour is stated ONCE on the screen, in caps, beside Strict (got ${capsParas.length}: ${capsParas.join(" || ")})`);
      const strictPara = await page.locator(".pr-git-toggle-row").locator("xpath=following-sibling::p[1]").first().innerText();
      ok(/ALLOWED/.test(strictPara), `J16y (${theme}) ...and the one that survives is the Strict paragraph`);
      const helpPara = (await page.locator(".pr-form .form-group").first().locator("p.hint").first().innerText()).replace(/\s+/g, " ");
      ok(/searched LIVE on every transition/.test(helpPara), `J16y (${theme}) the catalogue help still says what the rule CHECKS`);
      ok(!/Strict|ALLOWED|BLOCKS/.test(helpPara), `J16y (${theme}) ...and no longer re-states the Strict behaviour (got "${helpPara}")`);
      const foot = (await page.locator("p.pr-foot").first().innerText()).replace(/\s+/g, " ");
      ok(/blocked and your message is shown/.test(foot), `J16y (${theme}) the footer keeps what only it says: a plain fail blocks with your message`);
      ok(!/can't be reached|never traps the issue|Strict is on/.test(foot), `J16y (${theme}) ...and drops the third copy of the degradation sentence (got "${foot}")`);

      // (1) THE ROUTE OUT OF CQL. A real button on the required field's own label row.
      const describe = page.locator(".pr-describe-btn").first();
      ok(await describe.count() === 1, `J16y (${theme}) the CQL field offers "Describe the page instead"`);
      const btnStyle = await describe.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { bg: cs.backgroundColor, fg: cs.color, leftBorder: cs.borderLeftWidth, weight: cs.fontWeight };
      });
      ok(btnStyle.bg === (theme === "dark" ? "rgb(99, 102, 241)" : "rgb(79, 70, 229)"), `J16y (${theme}) it is a SOLID indigo fill with a dark override, not a tint (got ${btnStyle.bg})`);
      ok(btnStyle.fg === "rgb(255, 255, 255)", `J16y (${theme}) white text on it (got ${btnStyle.fg})`);
      ok(btnStyle.leftBorder === "0px", `J16y (${theme}) and no left accent rail (got ${btnStyle.leftBorder})`);
      ok(Number(btnStyle.weight) >= 600, `J16y (${theme}) 600-700 weight for the emphasis (got ${btnStyle.weight})`);
      ok(await page.locator(".br-body").count() === 0, `J16y (${theme}) the builder starts collapsed, which is the whole defect`);
      await describe.click();
      await page.waitForSelector(".br-body .br-input", { timeout: 6000 });
      ok(await page.locator(".br-body .br-input").count() === 1, `J16y (${theme}) clicking it OPENS the description builder`);
      const focused = await page.evaluate(() => document.activeElement && document.activeElement.className);
      ok(/br-input/.test(focused || ""), `J16y (${theme}) ...with the caret already in the description box (focus was "${focused}")`);
      const inView = await page.locator(".br-body").first().evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.top < window.innerHeight && r.bottom > 0;
      });
      ok(inView, `J16y (${theme}) ...and scrolled into view rather than left above the fold`);
      ok(await page.locator("select").count() === 0, `J16y (${theme}) still no native <select> anywhere on this form`);
      if (SHOTS) await page.locator(".pr-form").screenshot({ path: path.join(OUT, `conf-describe-route-${theme}.png`) });
    } catch (e) { fail++; console.log(`  ✗ J16y (${theme}) threw: ` + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- J16z - F-958 (2): the Manage apps link the banner owed -------------
     The card told the reader a Jira admin does this "under Apps, Manage apps" and linked
     nothing, on a screen where the app knows the site origin. The href is built from the
     ONE path (src/shared/manage-apps.js) and opened through the bridge router, so it
     behaves in the iframe rather than dying in a sandboxed tab. */
  for (const theme of ["light", "dark"]) {
    console.log(`J16z F-958 Manage apps link on the not-installed card (${theme})`);
    const env = await openEditor(browser, "config-ui", "cfg-premade-confluence", theme, { __NO_CONFLUENCE__: true });
    const { page } = env;
    try {
      await page.locator(".dropdown-trigger", { hasText: "Choose a premade rule" }).first().click();
      await page.waitForSelector(".dropdown-panel", { timeout: 6000 });
      await page.locator(".dropdown-panel .dropdown-item", { hasText: "a page for this issue exists" }).first().click();
      await page.locator(".pr-conf-missing").waitFor({ timeout: 8000 });
      const link = page.locator(".pr-conf-missing-link").first();
      ok(await link.count() === 1, `J16z (${theme}) the card carries a real link, not only the prose`);
      const href = await link.getAttribute("href");
      ok(href === "https://your-site.atlassian.net/jira/settings/apps/manage", `J16z (${theme}) it is the site-relative Manage apps page (got ${href})`);
      ok(await link.getAttribute("target") === "_blank", `J16z (${theme}) it opens in a new tab`);
      const ls = await link.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { fg: cs.color, leftBorder: cs.borderLeftWidth, deco: cs.textDecorationLine, weight: cs.fontWeight };
      });
      ok(ls.fg === "rgb(255, 255, 255)", `J16z (${theme}) white on the solid slate card, in both themes (got ${ls.fg})`);
      ok(/underline/.test(ls.deco), `J16z (${theme}) underlined, so it reads as a link and not as more prose`);
      ok(Number(ls.weight) >= 600, `J16z (${theme}) 600-700 weight (got ${ls.weight})`);
      ok(ls.leftBorder === "0px", `J16z (${theme}) no left accent rail (got ${ls.leftBorder})`);
      await link.click();
      const calls = await page.evaluate(() => window.__ROUTER_CALLS__ || []);
      ok(calls.some((c) => /\/jira\/settings\/apps\/manage$/.test((c && (c.arg || c.url)) || "")),
        `J16z (${theme}) clicking it navigates through the bridge router (got ${JSON.stringify(calls)})`);
      if (SHOTS) await page.locator(".pr-conf-missing").screenshot({ path: path.join(OUT, `conf-manage-apps-${theme}.png`) });
    } catch (e) { fail++; console.log(`  ✗ J16z (${theme}) threw: ` + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- J23d - F-447: the fail-open BANNER in config-view -----------------
     A Confluence validator that could not reach Confluence ALLOWS the transition and says
     so on the log row as `banner: "confluence_unavailable"`. config-view rendered no row
     for it, so the one screen a designer has showed a green PASS for a gate that had
     stopped gating. Solid fill, white text, no rail - in both themes. */
  for (const theme of ["light", "dark"]) {
    console.log(`J23d config-view Confluence banner (view-premade-confluence, ${theme})`);
    const env = await openEditor(browser, "config-view", "view-premade-confluence", theme);
    const { page } = env;
    try {
      // The summary rows first: the group must read as words, not as a bare rule name.
      const body = await page.locator("body").innerText();
      ok(/ENG/.test(body), `J23d (${theme}) the summary names the Confluence space`);
      ok(/title ~ \{issueKey\}/.test(body), `J23d (${theme}) the summary shows the page query`);
      ok(/fail-open/.test(body), `J23d (${theme}) the summary says what Strict OFF means`);

      await page.locator("button", { hasText: /Show Logs/i }).first().click();
      await page.locator(".log-entry").first().waitFor({ timeout: 8000 });
      await page.locator(".log-banner").first().waitFor({ timeout: 8000 });
      ok(await page.locator(".log-banner").count() === 1, `J23d (${theme}) exactly the degraded run carries a banner - the clean one does not`);
      const bannerText = await page.locator(".log-banner").first().innerText();
      ok(/Confluence could not be checked/.test(bannerText), `J23d (${theme}) the banner says what happened`);
      ok(/Turn Strict on/.test(bannerText), `J23d (${theme}) the banner names the remedy`);
      ok(/unreachable/.test(bannerText), `J23d (${theme}) the banner names WHICH fault it was`);
      const bg = await page.locator(".log-banner").first().evaluate((el) => getComputedStyle(el).backgroundColor);
      ok(bg === (theme === "dark" ? "rgb(59, 130, 246)" : "rgb(29, 78, 216)"), `J23d (${theme}) the banner is a SOLID Confluence-hue fill, not a tint - got ${bg}`);
      ok(await page.locator(".log-banner").first().evaluate((el) => getComputedStyle(el).borderLeftWidth) === "0px", `J23d (${theme}) the banner has NO left accent rail`);
    } catch (e) { fail++; console.log(`  ✗ J23d (${theme}) threw: ` + e.message.split("\n")[0]); }
    await closeEditor(env);
  }

  /* ---------------- J18n - F-497: the api.confluence NAMESPACE in the editor ----------
     F-495 added `confluence` as a namespace entry (callable:false) whose members live in
     SANDBOX_CONFLUENCE_METHODS. The three editor consumers render one row per
     SANDBOX_API_METHODS entry, so the namespace collapsed to a single row: no member
     completions, no per-member hover, one reference row. All three now derive their
     member rows from getNamespaceMembers() in the spec, and the lint checks the SECOND
     segment too (api.confluence is a real member of `api`, so the first-segment check
     used to wave api.confluence.nope through). Asserted against the spec, never against
     a retyped list, so a seventh member cannot pass here while missing in the UI. */
  {
    const { SANDBOX_CONFLUENCE_METHODS } = await import("../../src/shared/sandbox-api-spec.js");
    const MEMBERS = SANDBOX_CONFLUENCE_METHODS.map((m) => m.name);

    // Appends a line at the END of the first step's editor. Deliberately an APPEND and
    // never a clear: emptying the document flips the step's `hasCode` false, React
    // unmounts the CodeMirror, and every later assertion then runs against a different
    // step's editor (which is exactly how the first cut of this journey lied).
    const appendLine = async (page, text) => {
      await page.locator(".cm-content").first().click();
      await page.keyboard.press("ControlOrMeta+End");
      await page.keyboard.press("Enter");
      if (text) await page.keyboard.type(text, { delay: 20 });
    };
    // Centre of the first occurrence of `word` inside the editor text, via a DOM Range
    // (CodeMirror splits highlighted tokens across spans, so a text search is safer
    // than guessing at character coordinates).
    const wordPoint = (page, word) =>
      page.evaluate((w) => {
        const root = document.querySelector(".cm-content");
        if (!root) return null;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = walker.nextNode())) {
          const i = n.textContent.indexOf(w);
          if (i < 0) continue;
          const r = document.createRange();
          r.setStart(n, i);
          r.setEnd(n, i + w.length);
          const b = r.getBoundingClientRect();
          if (b.width === 0) continue;
          return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        }
        return null;
      }, word);

    for (const theme of ["light", "dark"]) {
      console.log(`J18n api.confluence namespace in the editor (cfg-static, ${theme})`);
      const env = await openEditor(browser, "config-ui", "cfg-static", theme);
      const { page } = env;
      try {
        /* --- (1) API REFERENCE PANEL: sub-rows, one per member --- */
        await page.locator("button.btn-api-ref", { hasText: /Show API Reference/ }).first().click();
        await page.waitForSelector(".api-ref-panel", { timeout: 8000 });
        const ns = page.locator(".api-ref-panel .api-ref-ns").first();
        ok(await page.locator(".api-ref-panel .api-ref-ns").count() === 1, `J18n (${theme}) the reference groups exactly one namespace (api.confluence)`);
        ok((await ns.locator(".api-ref-ns-chip").innerText()).trim() === "api.confluence", `J18n (${theme}) the namespace chip names api.confluence`);
        const subRows = ns.locator(".api-ref-ns-members .api-ref-item");
        ok(await subRows.count() === MEMBERS.length, `J18n (${theme}) the namespace shows one sub-row per member (${MEMBERS.length}) - got ${await subRows.count()}`);
        const nsText = await ns.innerText();
        for (const name of MEMBERS) {
          ok(nsText.includes(`api.confluence.${name}(`), `J18n (${theme}) the panel shows the SIGNATURE of api.confluence.${name}`);
        }
        ok(/storage-format|storage format|CQL/i.test(nsText), `J18n (${theme}) the sub-rows carry the member summaries, not just names`);
        // Design: SOLID Confluence hue, white text, no left rail, no tint.
        const chipBg = await ns.locator(".api-ref-ns-chip").evaluate((el) => getComputedStyle(el).backgroundColor);
        ok(chipBg === (theme === "dark" ? "rgb(59, 130, 246)" : "rgb(29, 78, 216)"), `J18n (${theme}) the namespace chip is a SOLID Confluence-hue fill - got ${chipBg}`);
        ok(await ns.locator(".api-ref-ns-chip").evaluate((el) => getComputedStyle(el).color) === "rgb(255, 255, 255)", `J18n (${theme}) the namespace chip has white text`);
        ok(await ns.evaluate((el) => getComputedStyle(el).borderLeftWidth) === "1px", `J18n (${theme}) the namespace group has a full hairline box, NOT a left accent rail`);
        ok(await ns.evaluate((el) => {
          const s = getComputedStyle(el);
          return s.borderLeftColor === s.borderTopColor && s.borderLeftColor === s.borderRightColor;
        }), `J18n (${theme}) no coloured left edge - all four borders are the same neutral`);

        /* --- (2) the seeded step lints clean, so any marker below is ours --- */
        await page.locator(".cm-content").first().click();
        await page.waitForTimeout(1500);
        ok(await page.locator(".cm-lint-marker-error").count() === 0, `J18n (${theme}) the seeded step lints clean (lint baseline is zero)`);

        /* --- (3) COMPLETIONS after "api.confluence." --- */
        await appendLine(page, "api.confluence.");
        await page.waitForSelector(".cm-tooltip-autocomplete", { timeout: 8000 });
        const optionLabels = await page.locator(".cm-tooltip-autocomplete .cm-completionLabel").allInnerTexts();
        for (const name of MEMBERS) {
          ok(optionLabels.some((l) => l.trim() === `api.confluence.${name}`), `J18n (${theme}) completion list offers api.confluence.${name}`);
        }
        ok(optionLabels.length === MEMBERS.length, `J18n (${theme}) exactly the ${MEMBERS.length} members are offered - got ${optionLabels.length}`);
        await page.keyboard.press("Escape");

        /* --- (4) LINT accepts a real member, and HOVER documents the MEMBER --- */
        await page.keyboard.type("getPage;", { delay: 20 });
        await page.keyboard.press("Escape");
        await page.waitForTimeout(1500);
        ok(await page.locator(".cm-lint-marker-error").count() === 0, `J18n (${theme}) lint ACCEPTS api.confluence.getPage`);

        await page.mouse.move(10, 10);
        const pt = await wordPoint(page, "getPage");
        ok(!!pt, `J18n (${theme}) the member token is on screen to hover`);
        await page.mouse.move(pt.x, pt.y);
        await page.mouse.move(pt.x + 1, pt.y);
        await page.waitForSelector(".cm-api-hover", { timeout: 8000 });
        const hoverText = await page.locator(".cm-api-hover").first().innerText();
        ok(hoverText.includes("api.confluence.getPage({ id, bodyFormat? })"), `J18n (${theme}) hover shows the MEMBER signature, not the namespace one`);
        ok(/Reads one page by id/.test(hoverText), `J18n (${theme}) hover shows the member summary`);
        ok(!/Confluence namespace \(/.test(hoverText), `J18n (${theme}) hover on a member must NOT fall back to the namespace card`);

        /* --- (5) LINT rejects an invented member of the namespace --- */
        await appendLine(page, "api.confluence.nope;");
        await page.keyboard.press("Escape");
        await page.waitForSelector(".cm-lint-marker-error", { timeout: 8000 });
        ok(await page.locator(".cm-lint-marker-error").count() >= 1, `J18n (${theme}) lint REJECTS api.confluence.nope`);
        await page.mouse.move(10, 10);
        await page.locator(".cm-lint-marker-error").last().hover();
        await page.waitForSelector(".cm-tooltip-lint", { timeout: 8000 });
        const lintText = await page.locator(".cm-tooltip-lint").first().innerText();
        ok(/api\.confluence\.nope does not exist/.test(lintText), `J18n (${theme}) the lint message names the bad member`);
        for (const name of MEMBERS) {
          ok(lintText.includes(name), `J18n (${theme}) the lint message lists the real member ${name}`);
        }
      } catch (e) { fail++; console.log(`  ✗ J18n (${theme}) threw: ` + e.message.split("\n")[0]); }
      await closeEditor(env);
    }
  }

} finally {
  await browser.close();
}

console.log(`\nEDITOR JOURNEYS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
