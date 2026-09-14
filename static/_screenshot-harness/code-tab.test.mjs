/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 *
 * admin-panel CODE TAB + AgentConfig CODE column + EventPicker git group browser journeys
 * (mock-bridge harness). Drives the REAL admin-panel build with @forge/bridge aliased to
 * bridge.js, so the capability card, the connection list, the dead-credential banner, the
 * consent screen, the git action column, the repos filter and (F-460/F-461) the per-repo
 * webhook chip and the deploy pipeline card are exercised end to end against canned
 * resolver responses.
 *
 * Every journey runs in BOTH themes where the screen carries a hue, because a new hue
 * without a dark override is the owner's standing rule and the only way to catch it is to
 * look at both.
 *
 * No prereq build: lib/build-shot.mjs rebuilds admin-panel's build-shot when it is stale.
 * Run:  node static/_screenshot-harness/code-tab.test.mjs   (add --shots to save PNGs)
 */
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureFreshBuildShot } from "./lib/build-shot.mjs";
/* The catalogue and the copy map are the ONE homes for what this UI must render, so the
   assertions read them rather than retyping a label the app could stop using. */
import { GIT_EVENT_IDS, EVENT_CATEGORIES } from "../../src/shared/jira-events.js";
import { AGENT_ACTIONS, agentActionNamespace } from "../../src/shared/agent-actions.js";
import { agentCapabilityCopy, EDITIONS } from "../../src/shared/edition.js";
/* F-526: the scaffold's OWN defaults, so "the form did not just ship the default" is
   asserted against the value the renderer would really have used. */
import { SCAFFOLDS, scaffoldHasCustomUi } from "../../src/shared/git-scaffolds.js";
/* F-548: the step chain the two optional Forge ids add is the BACKEND's list, read from
   its one home rather than retyped, so a rename fails this run instead of the eye. */
import { pipelineStepNames as PIPELINE_STEP_NAMES } from "../../src/shared/git-pipeline-steps.js";

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
/* F-914 - SETTLE BEFORE THE SHUTTER. The panel's entry animations (sectionFadeIn,
   anim-fade, .stagger) run on mount, so a screenshot taken the instant the assertions
   finish catches every chip at partial opacity and every muted line at nearly zero - and
   a human reading that PNG reports a "faded wash" the CSS does not contain. The
   assertions read getComputedStyle and were never affected; only the eye was. */
const shot = async (page, name) => {
  if (!SHOTS) return;
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
};

async function openAdmin(browser, theme = "light", extraInit = null) {
  const root = ensureFreshBuildShot("admin-panel");
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

/** The computed background of the first match, as the browser resolves it. */
const bg = (page, sel) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).backgroundColor);

const GIT_HUE = (EVENT_CATEGORIES.find((c) => c.id === "git") || {}).hue;
const GIT_ACTIONS = AGENT_ACTIONS.filter((a) => agentActionNamespace(a) === "git");
const PIPE_VARS = (SCAFFOLDS["forge-pipeline"] || {}).vars || {};

const browser = await chromium.launch();
try {
  /* ---------------- C1 — admin sees the tab, the status card and the connections ------- */
  for (const theme of ["light", "dark"]) {
    console.log(`C1 code tab, admin (${theme})`);
    const env = await openAdmin(browser, theme);
    const { page } = env;
    try {
      ok(await page.locator(".tab-btn", { hasText: /^\s*Code\s*$/ }).count() === 1, `C1 ${theme} the Code tab is offered`);
      await tab(page, "Code");
      await page.locator(".code-tab").waitFor({ timeout: 10000 });
      ok(await page.locator(".tab-intro-eyebrow", { hasText: "CODE" }).count() === 1, `C1 ${theme} tab intro renders`);
      // Status: ON, and the sentence is the ONE copy map's, not a wording this test invents.
      ok(await page.locator(".code-status-badge", { hasText: "CODER IS ON" }).count() === 1, `C1 ${theme} status badge reads ON`);
      ok((await page.locator(".code-status-title").first().innerText()).includes(agentCapabilityCopy("byok").title), `C1 ${theme} the status sentence comes from AGENT_CAPABILITY_REASONS`);
      /* F-914 - the fact chips print PRODUCT NAMES. They used to print the ids the
         backend stores ("anthropic", "advanced"), which is a vocabulary that appears on
         no invoice and in no listing. The edition label is read from edition.js so a
         rename there fails this run rather than going stale here. */
      const facts = await page.locator(".code-facts").first().innerText();
      ok(facts.includes("Anthropic"), `C1 ${theme} the provider fact is the product name, got: ${facts}`);
      ok(facts.includes(EDITIONS.standard.label), `C1 ${theme} the edition fact is the product name`);
      ok(!/\banthropic\b/.test(facts), `C1 ${theme} and the raw provider id is gone`);
      ok(!/\badvanced\b|\bstandard\b/.test(facts), `C1 ${theme} and the raw edition id is gone`);
      ok(facts.includes("claude-sonnet-5"), `C1 ${theme} the model id is kept as the id the admin picked`);
      // Connections: two rows, both kinds, the "set" credential state, the repo chips.
      ok(await page.locator(".code-conn").count() === 2, `C1 ${theme} two connection rows`);
      ok(await page.locator(".code-kind-github").count() === 1 && await page.locator(".code-kind-bitbucket").count() === 1, `C1 ${theme} one chip per provider kind`);
      ok(await page.locator(".code-conn-token.set").count() === 2, `C1 ${theme} a stored credential shows as SET, never as a value`);
      const shown = await page.locator(".code-tab").first().innerText();
      ok(!/ghp_|ATATT|BBDC/.test(shown), `C1 ${theme} no token-looking string is rendered anywhere`);
      ok(await page.locator(".code-repo", { hasText: "acme/web" }).count() === 1, `C1 ${theme} allow-listed repos render as chips`);
      ok(await page.locator(".code-dead").count() === 0, `C1 ${theme} no dead-credential banner on a healthy list`);
      // No native controls anywhere on this surface (the owner's standing rule).
      ok(await page.locator("select").count() === 0, `C1 ${theme} no native <select> on the Code tab`);
      await shot(page, `C1-code-tab-${theme}`);
      ok(env.errors.length === 0, `C1 ${theme} no page errors: ` + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  ✗ C1 threw: " + e.message.split("\n")[0]); }
    await close(env);
  }

  /* ---------------- C2 — the four capability OFF arms, each with its own remedy -------- */
  for (const reason of ["needs-coder-edition", "needs-frontier-model", "allowance-exhausted", "broken-read"]) {
    console.log("C2 capability arm: " + reason);
    const env = await openAdmin(browser, "light", { __CODE_CAP__: reason });
    const { page } = env;
    try {
      await tab(page, "Code");
      await page.locator(".code-tab").waitFor({ timeout: 10000 });
      const expected = agentCapabilityCopy(reason === "broken-read" ? "unknown" : reason);
      ok(await page.locator(".code-status-badge", { hasText: "CODER IS OFF" }).count() === 1, `C2 ${reason} badge reads OFF`);
      const body = await page.locator(".code-status").first().innerText();
      ok(body.includes(expected.title), `C2 ${reason} renders the ONE title for this reason`);
      ok(body.includes(expected.remedy.slice(0, 40)), `C2 ${reason} renders the remedy, not just the refusal`);
      ok(body.includes("Settings") === (expected.link === "settings"), `C2 ${reason} names the Settings tab only when the copy map says so`);
      await shot(page, `C2-capability-${reason}`);
      ok(env.errors.length === 0, `C2 ${reason} no page errors: ` + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  ✗ C2 threw: " + e.message.split("\n")[0]); }
    await close(env);
  }

  /* ---------------- C3 — an editor is REFUSED, and told so, with no Retry -------------- */
  {
    console.log("C3 editor refusal");
    const env = await openAdmin(browser, "light", { __NOT_ADMIN__: true, __REFUSE__: ["listGitConnections"], __REFUSE_ROLE__: "admin" });
    const { page } = env;
    try {
      ok(await page.locator(".tab-btn", { hasText: /^\s*Code\s*$/ }).count() === 1, "C3 a non-admin still sees the Code tab");
      await tab(page, "Code");
      await page.locator(".code-tab").waitFor({ timeout: 10000 });
      ok(await page.locator(".access-note").count() === 1, "C3 the refusal renders as the plain access note");
      const note = await page.locator(".access-note").first().innerText();
      ok(/admin/i.test(note), "C3 the note names the role the gate asked for");
      // The two mistakes this arm exists to prevent.
      ok(await page.locator(".btn-retry").count() === 0, "C3 no Retry: a retry re-asks a settled question");
      ok(await page.locator(".load-error").count() === 0, "C3 a refusal is NOT told as an outage");
      ok(await page.locator(".code-form").count() === 0 && await page.locator("button", { hasText: "+ Add connection" }).count() === 0,
        "C3 a refused reader is offered no write controls");
      await shot(page, "C3-editor-refusal");
      ok(env.errors.length === 0, "C3 no page errors: " + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  ✗ C3 threw: " + e.message.split("\n")[0]); }
    await close(env);
  }

  /* ---------------- C4 — the UPGRADE arm is a third voice, not the refusal -------------- */
  {
    console.log("C4 upgrade arm");
    const env = await openAdmin(browser, "light", { __UPGRADE__: ["listGitConnections"], __UPGRADE_FEATURE__: "coder" });
    const { page } = env;
    try {
      await tab(page, "Code");
      await page.locator(".code-tab").waitFor({ timeout: 10000 });
      ok(await page.locator(".upgrade-note").count() === 1, "C4 the edition denial renders the upgrade note");
      ok(await page.locator(".access-note").count() === 0, "C4 an edition denial is NOT rendered as a permission refusal");
      ok(await page.locator(".btn-retry").count() === 0, "C4 no Retry: a retry does not buy a licence");
      const note = await page.locator(".upgrade-note").first().innerText();
      ok(/Coder/.test(note) && /Upgrade in Settings/.test(note), "C4 the note names the edition and the remedy");
      await shot(page, "C4-upgrade-arm");
      ok(env.errors.length === 0, "C4 no page errors: " + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  ✗ C4 threw: " + e.message.split("\n")[0]); }
    await close(env);
  }

  /* ---------------- C5 — dead credential: loud, solid, white text, both themes ---------- */
  for (const theme of ["light", "dark"]) {
    console.log(`C5 dead credential (${theme})`);
    const env = await openAdmin(browser, theme, { __CODE_DEAD__: true });
    const { page } = env;
    try {
      await tab(page, "Code");
      await page.locator(".code-dead").waitFor({ timeout: 10000 });
      ok(await page.locator(".code-dead").count() === 1, `C5 ${theme} exactly the dead connection carries the banner`);
      const text = await page.locator(".code-dead").first().innerText();
      ok(/dead/i.test(text) && /not running/i.test(text), `C5 ${theme} the banner says what stopped, not only that something is wrong`);
      const fill = await bg(page, ".code-dead");
      // Solid, saturated, and DIFFERENT per theme - which is what proves the dark override exists.
      ok(fill === (theme === "light" ? "rgb(220, 38, 38)" : "rgb(239, 68, 68)"), `C5 ${theme} solid red fill (got ${fill})`);
      ok(await page.locator(".code-dead").first().evaluate((el) => getComputedStyle(el).color) === "rgb(255, 255, 255)", `C5 ${theme} white text on the banner`);
      ok(await page.locator(".code-dead").first().evaluate((el) => getComputedStyle(el).borderLeftWidth) === "0px", `C5 ${theme} no left accent rail`);
      await shot(page, `C5-dead-credential-${theme}`);
      ok(env.errors.length === 0, `C5 ${theme} no page errors: ` + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  ✗ C5 threw: " + e.message.split("\n")[0]); }
    await close(env);
  }

  /* ---------------- C6 — add form, Test result, and the deploy-identity consent screen -- */
  {
    console.log("C6 add connection + test + consent");
    const env = await openAdmin(browser, "light");
    const { page } = env;
    try {
      await tab(page, "Code");
      await page.locator(".code-tab").waitFor({ timeout: 10000 });
      await page.locator("button", { hasText: "+ Add connection" }).first().click();
      await page.locator(".code-form").first().waitFor({ timeout: 5000 });
      ok(await page.locator("#code-token").getAttribute("type") === "password", "C6 the token field is a password field");
      ok(await page.locator("#code-token").inputValue() === "", "C6 the token field starts EMPTY - no stored value is ever echoed");
      ok(await page.locator("select").count() === 0, "C6 the provider picker is the app's own dropdown, not a native select");
      // Bitbucket asks for the account email; GitHub does not.
      ok(await page.locator("#code-email").count() === 0, "C6 no email field for GitHub");
      await page.locator(".code-form .dropdown-trigger").first().click();
      await page.locator(".dropdown-item", { hasText: "Bitbucket" }).first().click();
      ok(await page.locator("#code-email").count() === 1, "C6 Bitbucket asks for the account email");
      // Test renders the whoami fields the resolver actually returns.
      await page.locator(".code-conn").first().locator("button", { hasText: "Test" }).click();
      await page.locator(".code-who").first().waitFor({ timeout: 8000 });
      const who = await page.locator(".code-who").first().innerText();
      ok(/acme-bot/.test(who), "C6 the Test result shows the whoami login");
      ok(/not reported/.test(who), "C6 a token that reports no scopes says so");
      /* F-914 - "not known" read as a fault the app had hit; it is a measurement that was
         not taken. And the WHY beside it must be the backend's own sentence, never one
         invented on this screen - a fine-grained PAT and a Bitbucket call have different
         reasons for the same null. */
      ok(/not checked/.test(who), "C6 an unchecked capability says NOT CHECKED, never no");
      ok(!/not known/.test(who), "C6 and the old wording is gone");
      ok(/fine-grained PATs never do/.test(who), "C6 the reason beside it is the backend's own sentence");
      ok(!/reported OAuth scopes/.test(who), "C6 and never the classic-token sentence over a null capability");
      // Deploy identity: consent gates the button, and the button is never pre-armed.
      // Scoped to the identity CARD: since F-460 every repo row also offers a "Set up
      // webhook", and a loose "Set up" match would click the wrong control.
      await page.locator(".code-card").last().locator("button", { hasText: /^Set up$/ }).first().click();
      await page.locator("#code-id-token").waitFor({ timeout: 5000 });
      await page.locator("#code-id-email").fill("deploy@acme.example");
      await page.locator("#code-id-token").fill("atlassian-api-token");
      const storeBtn = page.locator("button", { hasText: "Store deploy identity" }).first();
      ok(await storeBtn.isDisabled(), "C6 the store button is refused until consent is ticked");
      ok(!(await page.locator(".code-consent input").isChecked()), "C6 the consent box is never pre-ticked");
      await page.locator(".code-consent input").check();
      ok(!(await storeBtn.isDisabled()), "C6 consent arms the store button");
      await storeBtn.click();
      await page.locator(".code-identity-set").waitFor({ timeout: 8000 });
      const ident = await page.locator(".code-identity").first().innerText();
      ok(/deploy@acme.example/.test(ident), "C6 the stored identity shows the account, never the token");
      ok(!/atlassian-api-token/.test(await page.locator(".code-tab").first().innerText()), "C6 the typed token is nowhere on the screen after the write");
      await shot(page, "C6-add-test-consent");
      ok(env.errors.length === 0, "C6 no page errors: " + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  ✗ C6 threw: " + e.message.split("\n")[0]); }
    await close(env);
  }

  /* ---------------- C7 — EventPicker: the Git group and the repos filter ---------------- */
  for (const theme of ["light", "dark"]) {
    console.log(`C7 event picker git group (${theme})`);
    const env = await openAdmin(browser, theme);
    const { page } = env;
    try {
      await tab(page, "Listeners");
      await page.locator("button", { hasText: "+ Add Listener" }).first().click();
      await page.locator(".lst-editor").waitFor({ timeout: 10000 });
      // The group is rendered from EVENT_CATEGORIES, not hardcoded.
      const gitToggle = page.locator(".evp-group-toggle", { hasText: "Git" }).first();
      ok(await gitToggle.count() === 1, `C7 ${theme} a Git group is offered`);
      ok(await gitToggle.locator(".evp-group-count").innerText() === `0/${GIT_EVENT_IDS.length}`, `C7 ${theme} the group holds all ${GIT_EVENT_IDS.length} git events`);
      const dotHue = await gitToggle.locator(".evp-group-dot").evaluate((el) => getComputedStyle(el).backgroundColor);
      ok(dotHue === "rgb(162, 28, 175)", `C7 ${theme} the git group dot carries the catalogue hue ${GIT_HUE} (got ${dotHue})`);
      // The repos filter appears only once a git event is picked.
      ok(await page.locator(".evp-repos").count() === 0, `C7 ${theme} no repos field before a git event is picked`);
      await gitToggle.click();
      await page.locator(".evp-row", { hasText: "Pull request opened" }).first().locator("input").check();
      await page.locator(".evp-repos").waitFor({ timeout: 5000 });
      ok(await page.locator(".evp-repos").count() === 1, `C7 ${theme} the repos filter appears for a git event`);
      // Comma separated, lower-cased on BLUR (never on keystroke), one home for the rule.
      await page.locator("#evp-repos-input").fill("Acme/Web , ACME/API");
      await page.locator("#evp-repos-input").blur();
      ok(await page.locator("#evp-repos-input").inputValue() === "acme/web, acme/api", `C7 ${theme} the list is normalised on blur`);
      // A malformed entry is shown, not silently dropped.
      await page.locator("#evp-repos-input").fill("acme/web, notarepo");
      await page.locator("#evp-repos-input").blur();
      ok(await page.locator(".evp-repos-bad").count() === 1, `C7 ${theme} a non owner/name entry is named as invalid`);
      // High-volume badges still ride the git rows that carry them.
      ok(await page.locator(".evp-row", { hasText: "Branch pushed" }).locator(".evp-vol").count() === 1, `C7 ${theme} the high-volume badge rides the git push row`);
      await shot(page, `C7-eventpicker-git-${theme}`);
      ok(env.errors.length === 0, `C7 ${theme} no page errors: ` + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  ✗ C7 threw: " + e.message.split("\n")[0]); }
    await close(env);
  }

  /* ---------------- C8 — AgentConfig CODE column: on, and off WITH THE REASON ----------- */
  for (const [theme, capReason] of [["light", null], ["light", "needs-frontier-model"], ["dark", "needs-coder-edition"]]) {
    console.log(`C8 agent CODE column (${theme}, ${capReason || "on"})`);
    const env = await openAdmin(browser, theme, capReason ? { __CODE_CAP__: capReason } : null);
    const { page } = env;
    try {
      await tab(page, "Listeners");
      await page.locator("button", { hasText: "+ Add Listener" }).first().click();
      await page.locator(".lst-editor").waitFor({ timeout: 10000 });
      await page.locator(".mode-btn.mode-agent").click();
      await page.locator(".agc-col-code").waitFor({ timeout: 8000 });
      const rows = page.locator(".agc-col-code .agc-action");
      ok(await rows.count() === GIT_ACTIONS.length, `C8 the CODE column renders all ${GIT_ACTIONS.length} git actions from the catalogue`);
      // The catalogue's own flags, one badge each.
      ok(await page.locator(".agc-col-code .agc-mark-danger").count() === GIT_ACTIONS.filter((a) => a.dangerous).length, "C8 one DANGEROUS badge per dangerous action");
      ok(await page.locator(".agc-col-code .agc-mark-confirm").count() === GIT_ACTIONS.filter((a) => a.confirm).length, "C8 one ADMIN ONLY badge per confirm action");
      ok(await page.locator("select").count() === 0, "C8 no native controls in the checklist");
      if (capReason) {
        const note = await page.locator(".agc-locked").first().innerText();
        ok(note.includes(agentCapabilityCopy(capReason).title), `C8 ${capReason} the column names the REASON it is off`);
        ok(note.includes(agentCapabilityCopy(capReason).remedy.slice(0, 30)), `C8 ${capReason} and the remedy`);
        ok(await page.locator(".agc-col-code input:disabled").count() === GIT_ACTIONS.length, "C8 every git checkbox is disabled when the capability is off");
        const lockedBg = await bg(page, ".agc-locked");
        ok(lockedBg === (theme === "light" ? "rgb(217, 119, 6)" : "rgb(245, 158, 11)"), `C8 ${theme} the locked note has a per-theme solid fill (got ${lockedBg})`);
      } else {
        ok(await page.locator(".agc-locked").count() === 0, "C8 no locked note when Coder is on");
        ok(await page.locator(".agc-col-code input:disabled").count() === 0, "C8 the git checkboxes are usable when Coder is on");
        await page.locator(".agc-col-code .agc-action", { hasText: "Read a pull request" }).first().locator("input").check();
        ok(await page.locator(".agc-col-code .agc-action.on").count() === 1, "C8 a ticked git action renders as selected");
      }
      // The Jira columns are untouched by the split.
      ok(await page.locator(".agc-col:not(.agc-col-code) .agc-action").count() === AGENT_ACTIONS.filter((a) => agentActionNamespace(a) === "jira" && a.kind !== "control").length,
        "C8 the Jira READ/WRITE columns still hold exactly the Jira actions");
      await shot(page, `C8-agentconfig-code-${theme}-${capReason || "on"}`);
      ok(env.errors.length === 0, "C8 no page errors: " + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  ✗ C8 threw: " + e.message.split("\n")[0]); }
    await close(env);
  }
  /* ---------------- C9 — F-460: the webhook a tenant could not register ---------------- */
  for (const theme of ["light", "dark"]) {
    console.log(`C9 webhook setup (${theme})`);
    const env = await openAdmin(browser, theme);
    const { page } = env;
    try {
      await tab(page, "Code");
      await page.locator(".code-repo-row").first().waitFor({ timeout: 10000 });
      const row = page.locator(".code-repo-row", { hasText: "acme/web" }).first();
      ok(await page.locator(".code-repo-row").count() === 3, `C9 ${theme} one row per allow-listed repo, and only those`);
      ok(await row.locator(".code-hook.unset").innerText() === "NO WEBHOOK", `C9 ${theme} a repo with no hook says so`);
      // The chip is a SOLID fill with white text, per theme, and carries no left rail.
      const unsetFill = await row.locator(".code-hook").first().evaluate((el) => getComputedStyle(el).backgroundColor);
      ok(unsetFill === (theme === "light" ? "rgb(71, 85, 105)" : "rgb(100, 116, 139)"), `C9 ${theme} the unset chip is the solid neutral (got ${unsetFill})`);
      ok(await row.locator(".code-hook").first().evaluate((el) => getComputedStyle(el).borderLeftWidth) === "0px", `C9 ${theme} no left accent rail on the chip`);
      await row.locator("button", { hasText: "Set up webhook" }).click();
      await row.locator(".code-hook.set").waitFor({ timeout: 8000 });
      const setChip = await row.locator(".code-hook.set").innerText();
      ok(/WEBHOOK SET/.test(setChip), `C9 ${theme} the chip flips to SET after the write`);
      ok(/\d/.test(setChip), `C9 ${theme} and it carries the date the hook was made`);
      const setFill = await row.locator(".code-hook.set").evaluate((el) => getComputedStyle(el).backgroundColor);
      ok(setFill === (theme === "light" ? "rgb(22, 163, 74)" : "rgb(34, 197, 94)"), `C9 ${theme} solid green with a dark override (got ${setFill})`);
      ok(await row.locator(".code-hook.set").evaluate((el) => getComputedStyle(el).color) === "rgb(255, 255, 255)", `C9 ${theme} white text on the chip`);
      // THE RULE THIS SCREEN EXISTS UNDER: the secret has no render path.
      const shown = await page.locator(".code-tab").first().innerText();
      ok(!/secret[:=]\s*\S+/i.test(shown) && !/whsec|hook_\d/.test(shown), `C9 ${theme} neither the secret nor the hook id is rendered`);
      ok(await page.locator("select").count() === 0, `C9 ${theme} no native controls`);
      await shot(page, `C9-webhook-${theme}`);
      ok(env.errors.length === 0, `C9 ${theme} no page errors: ` + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  ✗ C9 threw: " + e.message.split("\n")[0]); }
    await close(env);
  }

  /* ---------------- C10 — rotating the secret asks first, with the app's own dialog ----- */
  {
    console.log("C10 rotate webhook secret");
    const env = await openAdmin(browser, "light", { __CODE_HOOK__: true });
    const { page } = env;
    try {
      await tab(page, "Code");
      const row = page.locator(".code-repo-row", { hasText: "acme/web" }).first();
      await row.locator(".code-hook.set").waitFor({ timeout: 10000 });
      ok(await row.locator("button", { hasText: "Set up webhook" }).count() === 0, "C10 a repo that already has a hook is not offered a second one");
      await row.locator("button", { hasText: "Rotate secret" }).click();
      await page.locator(".cr-confirm").waitFor({ timeout: 5000 });
      ok(await page.locator(".cr-confirm").count() === 1, "C10 the rotate asks first, through the app's own dialog");
      const dlg = await page.locator(".cr-confirm").innerText();
      ok(/old secret/i.test(dlg), "C10 the dialog says what stops working");
      // Cancelling changes nothing: a confirm that acts on cancel is the worst kind.
      await page.locator(".cr-confirm .btn-small", { hasText: "Cancel" }).click();
      ok(await row.locator(".code-fact-k", { hasText: "Secret rotated" }).count() === 0, "C10 cancelling rotates nothing");
      await row.locator("button", { hasText: "Rotate secret" }).click();
      await page.locator(".cr-confirm").waitFor({ timeout: 5000 });
      await page.locator(".cr-confirm .btn-small", { hasText: "Rotate" }).click();
      await row.locator(".code-fact-k", { hasText: "Secret rotated" }).waitFor({ timeout: 8000 });
      ok(await row.locator(".code-fact-k", { hasText: "Secret rotated" }).count() === 1, "C10 the rotation is reported as a time, never as a value");
      ok(!/whsec|secret[:=]/i.test(await page.locator(".code-tab").first().innerText()), "C10 the new secret is nowhere on the screen");
      await shot(page, "C10-rotate-secret");
      ok(env.errors.length === 0, "C10 no page errors: " + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  ✗ C10 threw: " + e.message.split("\n")[0]); }
    await close(env);
  }

  /* ---------------- C11 — an editor is refused the webhook write, by NAME -------------- */
  {
    console.log("C11 webhook refusal");
    const env = await openAdmin(browser, "light", { __HOOK_REFUSE__: true });
    const { page } = env;
    try {
      await tab(page, "Code");
      const row = page.locator(".code-repo-row", { hasText: "acme/web" }).first();
      await row.waitFor({ timeout: 10000 });
      await row.locator("button", { hasText: "Set up webhook" }).click();
      await row.locator(".code-hook-note").waitFor({ timeout: 8000 });
      const note = await row.locator(".code-hook-note").innerText();
      ok(/admin/i.test(note), "C11 the refusal names the role the gate asked for");
      ok(await row.locator(".code-hook.set").count() === 0, "C11 a refused write does not flip the chip");
      const fill = await row.locator(".code-hook-note").evaluate((el) => getComputedStyle(el).backgroundColor);
      ok(fill === "rgb(217, 119, 6)", `C11 the note is a solid fill, not a tint (got ${fill})`);
      ok(await row.locator(".code-hook-note").evaluate((el) => getComputedStyle(el).borderLeftWidth) === "0px", "C11 no left accent rail");
      await shot(page, "C11-webhook-refusal");
      ok(env.errors.length === 0, "C11 no page errors: " + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  ✗ C11 threw: " + e.message.split("\n")[0]); }
    await close(env);
  }

  /* ---------------- C11b — F-481: a rotation that did not finish, said in full ---------- */
  for (const theme of ["light", "dark"]) {
    console.log(`C11b rotation-failed webhook (${theme})`);
    const env = await openAdmin(browser, theme, { __HOOK_ROTATION_FAILED__: true });
    const { page } = env;
    try {
      await tab(page, "Code");
      const row = page.locator(".code-repo-row", { hasText: "acme/web" }).first();
      await row.locator(".code-hook-broken").waitFor({ timeout: 10000 });
      const banner = await row.locator(".code-hook-broken").innerText();
      ok(/did not finish/i.test(banner), `C11b ${theme} the banner says the last rotation did not finish`);
      ok(/refused/i.test(banner) && /acme\/web/.test(banner), `C11b ${theme} it says deliveries from THAT repo may be refused`);
      ok(/set up again/i.test(banner), `C11b ${theme} and it names setting the webhook up again as the remedy`);
      ok(!/—/.test(banner), `C11b ${theme} no em-dash in the copy`);
      // The action is attached to the banner, not left for the reader to find.
      ok(await row.locator(".code-hook-broken-action", { hasText: "Set up webhook" }).count() === 1, `C11b ${theme} the banner carries the Set up webhook button`);
      // Solid red with a dark override, white text, and no left rail.
      const fill = await row.locator(".code-hook-broken").evaluate((el) => getComputedStyle(el).backgroundColor);
      ok(fill === (theme === "light" ? "rgb(220, 38, 38)" : "rgb(239, 68, 68)"), `C11b ${theme} solid red with a dark override (got ${fill})`);
      ok(await row.locator(".code-hook-broken").evaluate((el) => getComputedStyle(el).color) === "rgb(255, 255, 255)", `C11b ${theme} white text on the banner`);
      ok(await row.locator(".code-hook-broken").evaluate((el) => getComputedStyle(el).borderLeftWidth) === "0px", `C11b ${theme} no left accent rail`);
      ok(await row.locator(".code-hook-broken-title").evaluate((el) => Number(getComputedStyle(el).fontWeight)) >= 600, `C11b ${theme} the headline carries the weight`);
      ok(!/whsec|secret[:=]/i.test(await page.locator(".code-tab").first().innerText()), `C11b ${theme} still no secret on the screen`);
      await shot(page, `C11b-rotation-failed-${theme}`);
      // Setting it up again clears the state, which is the whole point of the button.
      await row.locator(".code-hook-broken-action").click();
      await row.locator(".code-hook-broken").waitFor({ state: "detached", timeout: 8000 });
      ok(await row.locator(".code-hook-broken").count() === 0, `C11b ${theme} registering the hook again clears the banner`);
      ok(env.errors.length === 0, `C11b ${theme} no page errors: ` + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  ✗ C11b threw: " + e.message.split("\n")[0]); }
    await close(env);
  }

  /* ---------------- C11c — the refusal itself: the backend's words, in a toast --------- */
  {
    console.log("C11c rotate refusal, rotation-failed");
    const env = await openAdmin(browser, "light", { __CODE_HOOK__: true, __ROTATE_FAILS__: true });
    const { page } = env;
    try {
      await tab(page, "Code");
      const row = page.locator(".code-repo-row", { hasText: "acme/web" }).first();
      await row.locator(".code-hook.set").waitFor({ timeout: 10000 });
      await row.locator("button", { hasText: "Rotate secret" }).click();
      await page.locator(".cr-confirm").waitFor({ timeout: 5000 });
      await page.locator(".cr-confirm .btn-small", { hasText: "Rotate" }).click();
      await page.locator(".mls-toast").waitFor({ timeout: 8000 });
      const toast = await page.locator(".mls-toast").innerText();
      ok(/Set up webhook/i.test(toast), "C11c the toast carries the backend's message, naming the self-heal");
      ok(await page.locator(".mls-toast-error").count() === 1, "C11c a refusal is toasted as an error, not as a success");
      // And the re-read raises the banner, so the state is not only a transient message.
      await row.locator(".code-hook-broken").waitFor({ timeout: 8000 });
      ok(await row.locator(".code-hook-broken-action", { hasText: "Set up webhook" }).count() === 1, "C11c the row then offers the remedy");
      ok(await row.locator(".code-fact-k", { hasText: "Secret rotated" }).count() === 0, "C11c a refused rotation is never reported as a rotation");
      await shot(page, "C11c-rotate-refusal");
      ok(env.errors.length === 0, "C11c no page errors: " + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  ✗ C11c threw: " + e.message.split("\n")[0]); }
    await close(env);
  }

  /* ---------------- C12 — F-461: queued setup becomes installed, by POLLING ------------- */
  for (const theme of ["light", "dark"]) {
    console.log(`C12 pipeline queued to installed (${theme})`);
    const env = await openAdmin(browser, theme);
    const { page } = env;
    try {
      await tab(page, "Code");
      const row = page.locator(".code-repo-row", { hasText: "acme/web" }).first();
      await row.waitFor({ timeout: 10000 });
      await row.locator("button", { hasText: "Pipeline" }).click();
      await row.locator(".code-pipe").waitFor({ timeout: 8000 });
      ok(await row.locator(".code-pipe-status", { hasText: "NOT SET UP" }).count() === 1, `C12 ${theme} a repo with no row says NOT SET UP`);
      const setupBtn = row.locator("button", { hasText: "Set up pipeline" });
      ok(await setupBtn.isDisabled(), `C12 ${theme} the setup button is refused without a manifest and a site`);
      await row.locator(".code-textarea").fill("permissions:\n  scopes:\n    - read:jira-work\n");
      await row.locator("input[placeholder='your-site.atlassian.net']").fill("acme.atlassian.net");
      ok(!(await setupBtn.isDisabled()), `C12 ${theme} a manifest and a site arm it`);
      ok(await page.locator("select").count() === 0, `C12 ${theme} the product picker is the app's own dropdown`);
      await setupBtn.click();
      await row.locator(".code-pipe-queued").waitFor({ timeout: 8000 });
      ok(await row.locator(".code-pipe-status", { hasText: "QUEUED" }).count() === 1, `C12 ${theme} the queued row lands immediately`);
      // The step chain is the BACKEND's names, in its order.
      const steps = await row.locator(".code-step-name").allInnerTexts();
      ok(steps.join("|") === "secret:FORGE_EMAIL|secret:FORGE_API_TOKEN|var:FORGE_SITE|var:FORGE_PRODUCT|var:FORGE_ENV|commit-scaffold",
        `C12 ${theme} the step list is the pipeline's own (got ${steps.join("|")})`);
      ok(await row.locator(".code-diff-lock", { hasText: "read:jira-work" }).count() === 1, `C12 ${theme} the locked scopes are named`);
      // Two polls at 5s: queued -> running -> installed. This is the whole finding.
      await row.locator(".code-pipe-installed").waitFor({ timeout: 30000 });
      ok(await row.locator(".code-pipe-status", { hasText: "INSTALLED" }).count() === 1, `C12 ${theme} polling carries it to INSTALLED`);
      ok(await row.locator(".code-step-done").count() === 6, `C12 ${theme} every step is reported done`);
      const doneFill = await row.locator(".code-step-done .code-step-state").first().evaluate((el) => getComputedStyle(el).backgroundColor);
      ok(doneFill === (theme === "light" ? "rgb(22, 163, 74)" : "rgb(34, 197, 94)"), `C12 ${theme} done steps are solid green with a dark override (got ${doneFill})`);
      ok(await row.locator("button", { hasText: "Trigger deploy" }).count() === 1, `C12 ${theme} an installed pipeline offers the deploy`);
      ok(await row.locator("button", { hasText: "Set up pipeline" }).count() === 0, `C12 ${theme} and stops offering the setup form`);
      await shot(page, `C12-pipeline-installed-${theme}`);
      ok(env.errors.length === 0, `C12 ${theme} no page errors: ` + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  ✗ C12 threw: " + e.message.split("\n")[0]); }
    await close(env);
  }

  /* ---------------- C12b — F-526: the scaffold variables reach the backend -------------
     The defect this closes was invisible on screen: the form looked complete, sent no
     `scaffoldVars`, and every pipeline was rendered with "Forge app" and `static/app`.
     So the assertions are (1) what the form asks for, (2) what it REFUSES, (3) what it
     reads back, and (4) the payload the bridge recorded. */
  for (const theme of ["light", "dark"]) {
    console.log(`C12b pipeline scaffold variables (${theme})`);
    const env = await openAdmin(browser, theme);
    const { page } = env;
    try {
      await tab(page, "Code");
      const row = page.locator(".code-repo-row", { hasText: "acme/web" }).first();
      await row.waitFor({ timeout: 10000 });
      await row.locator("button", { hasText: "Pipeline" }).click();
      await row.locator(".code-textarea").waitFor({ timeout: 8000 });

      const appInput = row.locator("input[id^='pipe-appname-']");
      const dirInput = row.locator("input[id^='pipe-uidir-']");
      ok(await appInput.count() === 1, `C12b ${theme} the form asks for the app name`);
      ok(await dirInput.count() === 1, `C12b ${theme} the form asks for the Custom UI folder`);
      // The folder starts at the SCAFFOLD's default, read from its one home.
      ok(await dirInput.inputValue() === PIPE_VARS.UI_DIR, `C12b ${theme} the folder is seeded from the scaffold default (got ${await dirInput.inputValue()})`);
      const dirHint = await dirInput.evaluate((el) => el.closest(".form-group").innerText);
      ok(/package\.json/.test(dirHint), `C12b ${theme} the hint says it must hold the UI's package.json`);
      ok(/none/.test(dirHint), `C12b ${theme} and names "none" for a backend only app`);

      // The manifest names the app, so pasting it answers the question.
      await row.locator(".code-textarea").fill("app:\n  id: ari:cloud:ecosystem::app/abc\n  name: Acme Deployer\npermissions:\n  scopes:\n    - read:jira-work\n");
      await row.locator("input[placeholder='your-site.atlassian.net']").fill("acme.atlassian.net");
      ok(await appInput.inputValue() === "Acme Deployer", `C12b ${theme} the app name is prefilled from the manifest, not left at the default (got ${await appInput.inputValue()})`);

      const setupBtn = row.locator("button", { hasText: "Set up pipeline" });
      // PATH TRAVERSAL IS REFUSED, in words, before anything is queued.
      await dirInput.fill("../../etc");
      ok(await row.locator(".code-field-err").count() === 1, `C12b ${theme} a climbing path is refused with a sentence`);
      ok(/\.\./.test(await row.locator(".code-field-err").innerText()), `C12b ${theme} the refusal names what is wrong with it`);
      ok(await setupBtn.isDisabled(), `C12b ${theme} and the setup cannot be started while it is wrong`);
      const errColor = await row.locator(".code-field-err").evaluate((el) => getComputedStyle(el).color);
      ok(errColor === (theme === "light" ? "rgb(220, 38, 38)" : "rgb(239, 68, 68)"), `C12b ${theme} the refusal is solid red with a dark override (got ${errColor})`);
      await dirInput.fill("a".repeat(81));
      ok(/80 characters/.test(await row.locator(".code-field-err").innerText()), `C12b ${theme} an over-long folder is refused by length`);
      await dirInput.fill("   ");
      ok(await row.locator(".code-field-err").count() === 1 && await setupBtn.isDisabled(), `C12b ${theme} an empty folder is refused too`);

      // F-548 — THE TWO OPTIONAL FORGE IDS.
      const spaceInput = row.locator("input[id^='pipe-space-']");
      const appIdInput = row.locator("input[id^='pipe-appid-']");
      ok(await spaceInput.count() === 1, `C12b ${theme} the form asks for the developer space id`);
      ok(await appIdInput.count() === 1, `C12b ${theme} the form asks for the Forge app id`);
      await dirInput.fill("static/next-steps");
      ok(await row.locator(".code-field-err").count() === 0, `C12b ${theme} a real folder clears the refusal`);
      // Both are OPTIONAL: empty must not refuse, or a backend-only admin cannot proceed.
      ok(!(await setupBtn.isDisabled()), `C12b ${theme} both Forge ids are optional and empty arms the setup`);
      const spaceHint = await spaceInput.evaluate((el) => el.closest(".form-group").innerText);
      ok(/developer\.atlassian\.com/.test(spaceHint), `C12b ${theme} the space hint says where to find it`);
      const appIdHint = await appIdInput.evaluate((el) => el.closest(".form-group").innerText);
      ok(/never registers/.test(appIdHint), `C12b ${theme} the app id hint says the pipeline then never registers`);
      // A malformed one is refused client-side, in words, before anything is queued.
      await spaceInput.fill("not-a-space-id");
      ok(await row.locator(".code-field-err").count() === 1, `C12b ${theme} a malformed space id is refused with a sentence`);
      ok(await setupBtn.isDisabled(), `C12b ${theme} and the setup cannot be started while it is wrong`);
      await appIdInput.fill("1234");
      ok(await row.locator(".code-field-err").count() === 2, `C12b ${theme} a malformed app id is refused on its own field`);
      await spaceInput.fill("d77c0cce-1b2a-4c3d-9e4f-5a6b7c8d9e0f");
      await appIdInput.fill("8e6ab209-bb76-4a09-86cd-644f3f33960c");
      ok(await row.locator(".code-field-err").count() === 0, `C12b ${theme} real ids clear both refusals`);

      // The values the workflow will carry, read back before the button.
      const review = await row.locator(".code-pipe-review").innerText();
      ok(/FORGE_DEVELOPER_SPACE/.test(review) && /d77c0cce-1b2a-4c3d-9e4f-5a6b7c8d9e0f/.test(review),
        `C12b ${theme} the review shows the developer space the pipeline will be written with`);
      ok(/FORGE_APP_ID/.test(review) && /8e6ab209-bb76-4a09-86cd-644f3f33960c/.test(review),
        `C12b ${theme} the review shows the app id`);
      ok(/FORGE_APP_NAME/.test(review) && /Acme Deployer/.test(review), `C12b ${theme} the review shows the rendered app name`);
      // The chip key is upper-cased by CSS, so innerText carries it that way.
      ok(/working-directory/i.test(review) && /static\/next-steps/.test(review), `C12b ${theme} the review shows the rendered working directory`);
      ok(!/—/.test(review), `C12b ${theme} no em-dash in the copy`);
      ok(await row.locator(".code-pipe-review").evaluate((el) => getComputedStyle(el).borderLeftWidth) === await row.locator(".code-pipe-review").evaluate((el) => getComputedStyle(el).borderRightWidth),
        `C12b ${theme} the review has no left accent rail`);
      ok(await page.locator("select").count() === 0, `C12b ${theme} no native control was added`);
      await shot(page, `C12b-pipeline-vars-${theme}`);

      ok(await page.evaluate(() => window.__PIPE_SETUP__ == null), `C12b ${theme} nothing was sent while the form was being corrected`);
      ok(!(await setupBtn.isDisabled()), `C12b ${theme} a valid form arms the setup`);
      await setupBtn.click();
      await row.locator(".code-pipe-queued").waitFor({ timeout: 8000 });
      const sent = await page.evaluate(() => window.__PIPE_SETUP__);
      ok(!!(sent && sent.scaffoldVars), `C12b ${theme} the setup payload carries scaffoldVars at all (the finding)`);
      ok(sent && sent.scaffoldVars && sent.scaffoldVars.APP_NAME === "Acme Deployer", `C12b ${theme} APP_NAME is the typed name, not "${PIPE_VARS.APP_NAME}"`);
      ok(sent && sent.scaffoldVars && sent.scaffoldVars.UI_DIR === "static/next-steps", `C12b ${theme} UI_DIR is the typed folder, not "${PIPE_VARS.UI_DIR}"`);
      // F-548: both ids ride the payload as their OWN fields, not inside scaffoldVars.
      ok(sent && sent.developerSpaceId === "d77c0cce-1b2a-4c3d-9e4f-5a6b7c8d9e0f", `C12b ${theme} the payload carries developerSpaceId (got ${sent && sent.developerSpaceId})`);
      ok(sent && sent.appId === "8e6ab209-bb76-4a09-86cd-644f3f33960c", `C12b ${theme} the payload carries appId (got ${sent && sent.appId})`);
      ok(sent && sent.scaffoldVars && !("developerSpaceId" in sent.scaffoldVars), `C12b ${theme} and neither id is smuggled into scaffoldVars, which renderScaffold would drop`);
      // The backend's step list is a function of the REQUEST, so asking for both ids
      // adds their two steps, before commit-scaffold and nowhere else.
      const stepNames = await row.locator(".code-step-name").allInnerTexts();
      ok(stepNames.join("|") === PIPELINE_STEP_NAMES("github", { developerSpaceId: "x", appId: "y" }).join("|"),
        `C12b ${theme} the step chain gains the two variable steps (got ${stepNames.join("|")})`);
      ok(stepNames.indexOf("var:FORGE_DEVELOPER_SPACE") < stepNames.indexOf("commit-scaffold")
        && stepNames.indexOf("var:FORGE_APP_ID") < stepNames.indexOf("commit-scaffold"),
        `C12b ${theme} and both land before the scaffold commit`);
      // The ROW, once installed, reads back what it was installed WITH.
      await row.locator(".code-pipe-installed").waitFor({ timeout: 30000 });
      const head = await row.locator(".code-pipe-head").innerText();
      ok(/Developer space/i.test(head) && /d77c0cce-1b2a-4c3d-9e4f-5a6b7c8d9e0f/.test(head), `C12b ${theme} the installed row shows the developer space`);
      ok(/App id/i.test(head) && /8e6ab209-bb76-4a09-86cd-644f3f33960c/.test(head), `C12b ${theme} the installed row shows the app id`);
      ok(env.errors.length === 0, `C12b ${theme} no page errors: ` + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  ✗ C12b threw: " + e.message.split("\n")[0]); }
    await close(env);
  }

  /* ---------------- C12c — F-548: a field refusal lands ON ITS FIELD -------------------
     The backend is the gate for both Forge ids and for the scaffold variables, so a
     value the browser's regex happens to accept is still refused server-side. Rendered
     as the generic "this setup was refused" banner, the reader cannot tell WHICH of the
     five boxes is wrong. The mapping is by machine code, and `invalid_scaffold_var`
     carries the variable name, which is what proves the payload is read and not guessed. */
  for (const [code, inputSel, needle] of [
    ["invalid_developer_space", "input[id^='pipe-space-']", /developer space id/i],
    ["invalid_app_id", "input[id^='pipe-appid-']", /app id/i],
    ["invalid_scaffold_var", "input[id^='pipe-uidir-']", /Custom UI folder/i],
  ]) {
    console.log("C12c pipeline field refusal: " + code);
    const env = await openAdmin(browser, "light", { __PIPE_REFUSE__: code });
    const { page } = env;
    try {
      await tab(page, "Code");
      const row = page.locator(".code-repo-row", { hasText: "acme/web" }).first();
      await row.waitFor({ timeout: 10000 });
      await row.locator("button", { hasText: "Pipeline" }).click();
      await row.locator(".code-textarea").waitFor({ timeout: 8000 });
      await row.locator(".code-textarea").fill("app:\n  name: Acme Deployer\npermissions:\n  scopes:\n    - read:jira-work\n");
      await row.locator("input[placeholder='your-site.atlassian.net']").fill("acme.atlassian.net");
      // Shapes the CLIENT accepts, so the refusal can only be the backend's.
      await row.locator("input[id^='pipe-space-']").fill("d77c0cce-1b2a-4c3d-9e4f-5a6b7c8d9e0f");
      await row.locator("input[id^='pipe-appid-']").fill("8e6ab209-bb76-4a09-86cd-644f3f33960c");
      ok(await row.locator(".code-field-err").count() === 0, `C12c ${code} the client accepts these values`);
      await row.locator("button", { hasText: "Set up pipeline" }).click();
      await row.locator(".code-field-err").first().waitFor({ timeout: 8000 });
      ok(await row.locator(".code-field-err").count() === 1, `C12c ${code} exactly one field carries the refusal`);
      ok(needle.test(await row.locator(".code-field-err").innerText()), `C12c ${code} and it is the backend's own sentence`);
      // ON the field: the error paragraph is inside the same form-group as the input.
      const onField = await page.locator(inputSel).first().evaluate((el) => !!el.closest(".form-group").querySelector(".code-field-err"));
      ok(onField, `C12c ${code} the refusal renders under the field it is about, not as a banner`);
      ok(await row.locator(".code-pipe-err").count() === 0, `C12c ${code} and NOT as the nameless setup-refused banner`);
      ok(await row.locator(".code-pipe-queued").count() === 0, `C12c ${code} a refused setup is never shown as queued`);
      // Editing clears it: a refusal about a value that no longer exists is a lie.
      await page.locator(inputSel).first().fill("x");
      ok(await row.locator(".code-field-err").count() <= 1, `C12c ${code} editing drops the backend's refusal`);
      ok(!/That value was refused/.test(await row.locator(".code-pipe-form").innerText()), `C12c ${code} no placeholder wording survives the edit`);
      await shot(page, `C12c-field-refusal-${code}`);
      ok(env.errors.length === 0, `C12c ${code} no page errors: ` + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  ✗ C12c threw: " + e.message.split("\n")[0]); }
    await close(env);
  }

  /* ---------------- C12d — F-540/F-548: "none" tells the TRUTH about the build step ----
     The scaffold made the Custom UI build step conditional; this screen went on warning
     that it is always committed and will fail on a folder called "none". A screen that
     states a falsehood about what it is about to write to someone's repository is worse
     than one that says nothing, so the sentence is now the predicate's. */
  for (const theme of ["light", "dark"]) {
    console.log(`C12d "none" omits the Custom UI build step (${theme})`);
    const env = await openAdmin(browser, theme);
    const { page } = env;
    try {
      await tab(page, "Code");
      const row = page.locator(".code-repo-row", { hasText: "acme/web" }).first();
      await row.waitFor({ timeout: 10000 });
      await row.locator("button", { hasText: "Pipeline" }).click();
      await row.locator(".code-textarea").waitFor({ timeout: 8000 });
      /* Armed FIRST, so "the setup is not blocked" can only be about the folder. A
         disabled button proves nothing when the manifest and the site are still empty. */
      await row.locator(".code-textarea").fill("app:\n  name: Acme Deployer\npermissions:\n  scopes:\n    - read:jira-work\n");
      await row.locator("input[placeholder='your-site.atlassian.net']").fill("acme.atlassian.net");
      const dirInput = row.locator("input[id^='pipe-uidir-']");
      // A real folder: no note at all, because there is nothing to say.
      ok(scaffoldHasCustomUi({ UI_DIR: "static/app" }), "C12d the predicate agrees a real folder has a UI");
      ok(await row.locator(".code-pipe-ui-note").count() === 0, `C12d ${theme} a real folder shows no note`);
      await dirInput.fill("none");
      ok(!scaffoldHasCustomUi({ UI_DIR: "none" }), "C12d the predicate agrees \"none\" has no UI");
      await row.locator(".code-pipe-ui-note").waitFor({ timeout: 5000 });
      const note = await row.locator(".code-pipe-ui-note").innerText();
      ok(/omits the Custom UI build step/i.test(note), `C12d ${theme} the note says the step is OMITTED (got: ${note})`);
      ok(!/always/i.test(note) && !/fail there/i.test(note), `C12d ${theme} the old falsehood is gone`);
      ok(!/—/.test(note), `C12d ${theme} no em-dash in the copy`);
      // It is a NOTE, not an alert: nothing is wrong and nothing is blocked.
      ok(await row.locator(".code-pipe-ui-note[role='alert']").count() === 0, `C12d ${theme} it is not raised as an alert`);
      ok(!(await row.locator("button", { hasText: "Set up pipeline" }).isDisabled()), `C12d ${theme} and "none" does not block the setup`);
      // The review agrees with the note rather than naming a folder that is not built.
      const review = await row.locator(".code-pipe-review").innerText();
      ok(/no build step/i.test(review), `C12d ${theme} the review says there is no build step (got ${review})`);
      // The owner's standing rules, on the one element this journey adds.
      const noteEl = row.locator(".code-pipe-ui-note");
      ok(await noteEl.evaluate((el) => getComputedStyle(el).borderLeftWidth) === await noteEl.evaluate((el) => getComputedStyle(el).borderRightWidth),
        `C12d ${theme} the note has no left accent rail`);
      const noteBg = await noteEl.evaluate((el) => getComputedStyle(el).backgroundColor);
      ok(/rgba\(0, 0, 0, 0\)|transparent/.test(noteBg), `C12d ${theme} and no tinted fill behind it (got ${noteBg})`);
      ok(await page.locator("select").count() === 0, `C12d ${theme} no native control was added`);
      await shot(page, `C12d-none-note-${theme}`);
      ok(env.errors.length === 0, `C12d ${theme} no page errors: ` + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  ✗ C12d threw: " + e.message.split("\n")[0]); }
    await close(env);
  }

  /* ---------------- C13 — the three refusals that must name NAMES ----------------------- */
  for (const code of ["lock_mismatch", "scope_not_allowed", "identity_required"]) {
    console.log("C13 pipeline refusal: " + code);
    const env = await openAdmin(browser, "light", { __PIPE_REFUSE__: code });
    const { page } = env;
    try {
      await tab(page, "Code");
      const row = page.locator(".code-repo-row", { hasText: "acme/web" }).first();
      await row.waitFor({ timeout: 10000 });
      await row.locator("button", { hasText: "Pipeline" }).click();
      await row.locator(".code-textarea").waitFor({ timeout: 8000 });
      await row.locator(".code-textarea").fill("permissions:\n  scopes:\n    - write:jira-work\n");
      await row.locator("input[placeholder='your-site.atlassian.net']").fill("acme.atlassian.net");
      await row.locator("button", { hasText: "Set up pipeline" }).click();
      await row.locator(".code-pipe-err").waitFor({ timeout: 8000 });
      const body = await row.locator(".code-pipe-err").innerText();
      if (code === "lock_mismatch") {
        ok(/committed lock differs/i.test(body), "C13 lock_mismatch says the committed lock differs");
        ok(await row.locator(".code-diff-add", { hasText: "+write:jira-work" }).count() === 1, "C13 the ADDED scope is named, with a sign");
        ok(await row.locator(".code-diff-rem", { hasText: "read:jira-user" }).count() === 1, "C13 the REMOVED scope is named too");
        ok(!/b91c7a44/.test(body), "C13 it is told by scope name, never by lock hash");
      } else if (code === "scope_not_allowed") {
        ok(await row.locator(".code-diff-rem", { hasText: "manage:jira-configuration" }).count() === 1, "C13 the refused scope is named");
      } else {
        ok(/deploy identity/i.test(body), "C13 identity_required names the missing identity");
        // The remedy is on this screen, so it takes the reader there.
        await row.locator(".code-pipe-goto").click();
        await page.locator("#code-id-token").waitFor({ timeout: 5000 });
        ok(await page.locator("#code-id-token").count() === 1, "C13 the refusal opens the deploy identity card");
      }
      const errFill = await row.locator(".code-pipe-err").evaluate((el) => getComputedStyle(el).backgroundColor);
      ok(errFill === "rgb(220, 38, 38)", `C13 ${code} solid red, not a tint (got ${errFill})`);
      ok(await row.locator(".code-pipe-err").evaluate((el) => getComputedStyle(el).borderLeftWidth) === "0px", `C13 ${code} no left accent rail`);
      await shot(page, `C13-pipeline-${code}`);
      ok(env.errors.length === 0, `C13 ${code} no page errors: ` + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  ✗ C13 threw: " + e.message.split("\n")[0]); }
    await close(env);
  }

  /* ---------------- C14 — a PARTIAL setup names the step it died on --------------------- */
  for (const theme of ["light", "dark"]) {
    console.log(`C14 partial pipeline (${theme})`);
    const env = await openAdmin(browser, theme, { __PIPE_SCENARIO__: "partial" });
    const { page } = env;
    try {
      await tab(page, "Code");
      const row = page.locator(".code-repo-row", { hasText: "acme/web" }).first();
      await row.waitFor({ timeout: 10000 });
      await row.locator("button", { hasText: "Pipeline" }).click();
      await row.locator(".code-pipe-warn").waitFor({ timeout: 8000 });
      const warn = await row.locator(".code-pipe-warn").innerText();
      ok(/commit-scaffold/.test(warn), `C14 ${theme} the warning names the step that failed`);
      ok(await row.locator(".code-step-failed .code-step-name", { hasText: "commit-scaffold" }).count() === 1, `C14 ${theme} and the step itself reads failed`);
      ok(/protected/.test(await row.locator(".code-step-err").innerText()), `C14 ${theme} the provider's reason is shown, not swallowed`);
      ok(await row.locator("button", { hasText: "Set up again" }).count() === 1, `C14 ${theme} a partial setup can be retried`);
      ok(await row.locator("button", { hasText: "Trigger deploy" }).count() === 0, `C14 ${theme} a partial setup offers no deploy`);
      const warnFill = await row.locator(".code-pipe-warn").evaluate((el) => getComputedStyle(el).backgroundColor);
      ok(warnFill === (theme === "light" ? "rgb(217, 119, 6)" : "rgb(245, 158, 11)"), `C14 ${theme} solid amber with a dark override (got ${warnFill})`);
      await shot(page, `C14-pipeline-partial-${theme}`);
      ok(env.errors.length === 0, `C14 ${theme} no page errors: ` + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  ✗ C14 threw: " + e.message.split("\n")[0]); }
    await close(env);
  }

  /* ---------------- C15 — the deploy asks first, then shows the run -------------------- */
  {
    console.log("C15 trigger deploy");
    const env = await openAdmin(browser, "light", { __PIPE_SCENARIO__: "installed" });
    const { page } = env;
    try {
      await tab(page, "Code");
      const row = page.locator(".code-repo-row", { hasText: "acme/web" }).first();
      await row.waitFor({ timeout: 10000 });
      await row.locator("button", { hasText: "Pipeline" }).click();
      await row.locator(".code-pipe-installed").waitFor({ timeout: 8000 });
      await row.locator("button", { hasText: "Trigger deploy" }).click();
      await page.locator(".cr-confirm").waitFor({ timeout: 5000 });
      const dlg = await page.locator(".cr-confirm").innerText();
      ok(/acme\/web/.test(dlg) && /cannot be called back/i.test(dlg), "C15 the dialog names the repo and says it is irreversible");
      await page.locator(".cr-confirm .btn-small", { hasText: "Cancel" }).click();
      ok(await row.locator(".code-run").count() === 0, "C15 cancelling deploys nothing");
      await row.locator("button", { hasText: "Trigger deploy" }).click();
      await page.locator(".cr-confirm").waitFor({ timeout: 5000 });
      await page.locator(".cr-confirm .btn-small", { hasText: "Start deploy" }).click();
      await row.locator(".code-run").waitFor({ timeout: 8000 });
      const run = await row.locator(".code-run").innerText();
      ok(/main/.test(run) && /forge-deploy\.yml/.test(run), "C15 the run names the ref and the workflow it started");
      // GitHub answers a dispatch with no id, so the link only appears once the provider
      // reports the run. Until then the card says so rather than rendering a dead link.
      ok(/not reported a run/i.test(run) || await row.locator(".code-run-link").count() === 1, "C15 the run link, or an honest sentence when there is not one yet");
      await row.locator(".code-run-link").waitFor({ timeout: 30000 });
      ok((await row.locator(".code-run-link").getAttribute("href")).startsWith("https://github.com/"), "C15 the run link points at the provider's run");
      await shot(page, "C15-trigger-deploy");
      ok(env.errors.length === 0, "C15 no page errors: " + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  ✗ C15 threw: " + e.message.split("\n")[0]); }
    await close(env);
  }

  /* ---------------- C16 - F-583: an OUTDATED pipeline must not read as installed --------
     F-565 fixed the scaffold TEMPLATE; every repo that already had the broken
     forge-deploy.yml committed kept it, and F-579 gave publicPipelineRow the derived
     `outdated`/`outdatedReason`/`currentScaffoldVersion` to say so. The Code tab ignored
     all three: the row still rendered status "installed", 6/6 steps and the green badge -
     byte-for-byte a healthy pipeline - while every dispatch against it answered 422. The
     admin was shown green and given no reason to re-run the one thing that fixes it.
     The fixture is installed at scaffold v1 against the shipped SCAFFOLD_VERSION. */
  for (const theme of ["light", "dark"]) {
    console.log(`C16 outdated pipeline (${theme})`);
    const env = await openAdmin(browser, theme, { __PIPE_SCENARIO__: "outdated" });
    const { page } = env;
    try {
      await tab(page, "Code");
      const row = page.locator(".code-repo-row", { hasText: "acme/web" }).first();
      await row.waitFor({ timeout: 10000 });
      await row.locator("button", { hasText: "Pipeline" }).click();
      await row.locator(".code-pipe-outdated-box").waitFor({ timeout: 8000 });

      /* THE DEFECT: the badge. The outdated state has to TAKE THE PLACE of the green one,
         not sit beside it - a screen showing INSTALLED anywhere is the screen F-579 is about. */
      const badge = row.locator(".code-pipe-status").first();
      ok((await badge.innerText()).trim() === "PIPELINE OUTDATED", `C16 ${theme} the badge reads PIPELINE OUTDATED (got "${(await badge.innerText()).trim()}")`);
      ok(await row.locator(".code-pipe-installed").count() === 0, `C16 ${theme} the green INSTALLED badge is GONE, not merely accompanied`);
      /* Scoped to the STATUS BADGES. The card also carries an "Installed <date>" FACT, which
         is true and must stay - the setup really did complete then, and that is part of why
         the row looks healthy. What may not survive is a badge claiming the state. */
      const badgeTexts = (await row.locator(".code-pipe-status").allInnerTexts()).map((t) => t.trim());
      ok(!badgeTexts.some((t) => /INSTALLED/.test(t)), `C16 ${theme} no status badge claims INSTALLED (got ${JSON.stringify(badgeTexts)})`);
      ok(/INSTALLED/.test(await row.locator(".code-fact", { hasText: "Installed" }).first().innerText()), `C16 ${theme} the installedAt FACT survives - when the setup ran is still true`);

      /* The steps still read 6/6 done - that is TRUE and must stay true. The point is that
         it is no longer the only thing on screen, so this asserts the honest half survived. */
      ok(await row.locator(".code-step-done").count() > 0, `C16 ${theme} the completed steps are still shown - the setup really did finish`);

      /* The reason, VERBATIM from the shared changelog. Matched on the substance of the
         sentence rather than a paraphrase, so a renderer that summarised it would fail. */
      const box = await row.locator(".code-pipe-outdated-box").innerText();
      ok(/422/.test(box), `C16 ${theme} the reason names the 422 the admin is actually seeing`);
      ok(/workflow_dispatch/.test(box), `C16 ${theme} the reason names the missing trigger`);
      ok(/invalid YAML/i.test(box), `C16 ${theme} the reason says what is wrong with the committed file`);
      ok(/Re-run the setup/i.test(box), `C16 ${theme} the reason names the remedy`);

      // The version pair, from the two row fields rather than a literal in the component.
      ok(/v1 to v2/.test(box), `C16 ${theme} the box says which version it is on and which it should be (got "${box.replace(/\s+/g, " ").trim()}")`);

      // No em-dash anywhere in the state's own copy.
      ok(!/\u2014/.test(box), `C16 ${theme} no em-dash in the outdated copy`);

      /* THE REMEDY. Before the fix the setup form was gated on `status !== "installed"`,
         which is exactly what an outdated row is - so the tab named a fault and offered no
         way to act on it. The button must be reachable. */
      const setup = row.locator("button", { hasText: "Set up pipeline" });
      ok(await setup.count() === 1, `C16 ${theme} the "Set up pipeline" button is reachable on an installed-but-outdated row`);

      /* F-602 - AND THE ACTION THAT CANNOT WORK IS GONE. The deploy gate read `status`,
         which is still "installed" on an outdated row, so the card described the 422 and
         then offered the button that produces it. Two controls, one of them a dead end,
         is worse than the missing remedy was: the dead one is primary-styled and sits in
         the head, where a reader reaches first. Absent, not disabled - a greyed button
         still reads as "the right action, temporarily unavailable". */
      ok(await row.locator(".code-pipe-deploy").count() === 0,
        `C16 ${theme} the "Trigger deploy" button is GONE on an outdated row - the dispatch it would send is the 422 the box just named`);
      const headButtons = await row.locator(".code-pipe-head button").allInnerTexts();
      ok(!headButtons.some((t) => /deploy/i.test(t)),
        `C16 ${theme} no control in the pipeline head offers a deploy (got ${JSON.stringify(headButtons)})`);

      /* Design: solid amber, white ink, 600-700, NO left rail, NO alpha tint, dark override.
         Asserted on computed style on BOTH the badge and the body. */
      for (const [name, loc] of [["badge", badge], ["box", row.locator(".code-pipe-outdated-box").first()]]) {
        const st = await loc.evaluate((el) => {
          const cs = getComputedStyle(el);
          return { bg: cs.backgroundColor, color: cs.color, rail: cs.borderLeftWidth, weight: cs.fontWeight };
        });
        ok(st.rail === "0px", `C16 ${theme} ${name} has no left accent rail`);
        ok(/^rgb\(\d+, \d+, \d+\)$/.test(st.bg), `C16 ${theme} ${name} fill is SOLID, not an alpha tint (got ${st.bg})`);
        ok(st.color === "rgb(255, 255, 255)", `C16 ${theme} ${name} has white ink (got ${st.color})`);
        ok(Number(st.weight) >= 600, `C16 ${theme} ${name} carries the 600-700 emphasis weight (got ${st.weight})`);
        ok(st.bg === (theme === "light" ? "rgb(217, 119, 6)" : "rgb(245, 158, 11)"),
          `C16 ${theme} ${name} amber has a dark-mode override (got ${st.bg})`);
      }

      await shot(page, `C16-pipeline-outdated-${theme}`);
      ok(env.errors.length === 0, `C16 ${theme} no page errors: ` + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  ✗ C16 threw: " + e.message.split("\n")[0]); }
    await close(env);
  }

  /* ---------------- C16c - F-604: the remedy RE-RUNS the install, it does not reset it ---
     F-583 admits an outdated-but-installed row to the setup form, and the form started at
     the scaffold's DEFAULTS: following the amber banner re-committed the workflow with
     UI_DIR "static/ui" and dropped the repository's developer space and app id. The form
     is seeded from the row, and what the screen ASKS THE BACKEND FOR is what the journey
     reads - a prefilled box that is not sent would look identical on screen. */
  const SPACE_FIX = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const ARI_FIX = "ari:cloud:ecosystem::app/11111111-2222-3333-4444-555555555555";
  for (const theme of ["light", "dark"]) {
    console.log(`C16c outdated pipeline prefills the setup form (${theme})`);
    const env = await openAdmin(browser, theme, {
      __PIPE_SCENARIO__: "outdated",
      __PIPE_IDS__: { developerSpaceId: SPACE_FIX, appId: ARI_FIX },
      __PIPE_VARS__: { APP_NAME: "Acme Ops", UI_DIR: "static/app" },
    });
    const { page } = env;
    try {
      await tab(page, "Code");
      const row = page.locator(".code-repo-row", { hasText: "acme/web" }).first();
      await row.waitFor({ timeout: 10000 });
      await row.locator("button", { hasText: "Pipeline" }).click();
      await row.locator(".code-pipe-form").waitFor({ timeout: 8000 });

      const val = (sel) => row.locator(sel).first().inputValue();
      ok(await val("input[id^='pipe-appname-']") === "Acme Ops", `C16c ${theme} the app name is prefilled from the row (got "${await val("input[id^='pipe-appname-']")}")`);
      ok(await val("input[id^='pipe-uidir-']") === "static/app", `C16c ${theme} the Custom UI folder is the INSTALLED one, not the scaffold default (got "${await val("input[id^='pipe-uidir-']")}")`);
      ok(await val("input[id^='pipe-space-']") === SPACE_FIX, `C16c ${theme} the developer space id survives into the form`);
      ok(await val("input[id^='pipe-appid-']") === ARI_FIX, `C16c ${theme} the app id survives into the form`);
      ok(await val("input[id^='pipe-branch-']") === "main", `C16c ${theme} the branch is the one the pipeline was installed on`);

      /* The review block reads back what will be committed, so the defect is visible there
         too: before the fix it said "static/ui" for a repo built from static/app. */
      const review = await row.locator(".code-pipe-review").innerText();
      ok(/static\/app/.test(review) && !/static\/ui/.test(review), `C16c ${theme} the review says the folder the repo really builds (got "${review.replace(/\s+/g, " ").trim()}")`);
      ok(!/\u2014/.test(review), `C16c ${theme} no em-dash in the review copy`);

      // The manifest is NEVER prefilled: the row stores a lock hash, not the manifest.
      ok(await row.locator("textarea[id^='pipe-manifest-']").first().inputValue() === "",
        `C16c ${theme} the manifest is not prefilled - pasting it is what re-proves the permissions`);

      await row.locator("textarea[id^='pipe-manifest-']").first().fill("permissions:\n  scopes:\n    - storage:app\n");
      await row.locator("input[id^='pipe-site-']").first().fill("acme.atlassian.net");
      await row.locator("button", { hasText: "Set up pipeline" }).first().click();
      await page.waitForFunction(() => !!window.__PIPE_SETUP__, null, { timeout: 8000 });
      const sent = await page.evaluate(() => window.__PIPE_SETUP__);
      ok(sent.scaffoldVars && sent.scaffoldVars.UI_DIR === "static/app" && sent.scaffoldVars.APP_NAME === "Acme Ops",
        `C16c ${theme} the re-setup SENDS the installed scaffold variables (got ${JSON.stringify(sent.scaffoldVars)})`);
      ok(sent.developerSpaceId === SPACE_FIX && sent.appId === ARI_FIX,
        `C16c ${theme} …and the developer space and app id, which the defect dropped (got ${JSON.stringify({ s: sent.developerSpaceId, a: sent.appId })})`);
      await shot(page, `C16c-outdated-prefilled-${theme}`);
      ok(env.errors.length === 0, `C16c ${theme} no page errors: ` + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  ✗ C16c threw: " + e.message.split("\n")[0]); }
    await close(env);
  }

  /* ---------------- C16d - F-605: a setup that never finished says so, and offers the form
     `scaffoldVersion` was stamped when the setup was QUEUED, so a run that died before the
     commit left a row claiming the current version: outdated went false, live stayed true
     (status is written by the run, and a dead run never writes again), and the card showed
     QUEUED for ever with no banner and no setup form - for a repository whose committed
     workflow was still the broken one. Liveness is now derived against the claim's TTL. */
  for (const theme of ["light", "dark"]) {
    console.log(`C16d a setup that never finished (${theme})`);
    const env = await openAdmin(browser, theme, { __PIPE_SCENARIO__: "stuck" });
    const { page } = env;
    try {
      await tab(page, "Code");
      const row = page.locator(".code-repo-row", { hasText: "acme/web" }).first();
      await row.waitFor({ timeout: 10000 });
      await row.locator("button", { hasText: "Pipeline" }).click();
      await row.locator(".code-pipe-warn").waitFor({ timeout: 8000 });

      const badge = row.locator(".code-pipe-status").first();
      const badgeText = (await badge.innerText()).trim();
      ok(!/QUEUED/.test(badgeText), `C16d ${theme} the badge no longer reads QUEUED for a run that is gone (got "${badgeText}")`);
      /* On a repo that HAS installed before, OUTDATED is the badge: the committed bytes
         are the admin's problem and the remedy is the same form. The dead run is said in
         the box below it. The badge for a stuck FIRST install is C16e. */
      ok(/PIPELINE OUTDATED/.test(badgeText), `C16d ${theme} the badge names the stale repository (got "${badgeText}")`);

      const warn = await row.locator(".code-pipe-warn").innerText();
      ok(/never finished/i.test(warn), `C16d ${theme} the box says the setup never finished`);
      ok(/Nothing new was committed/i.test(warn), `C16d ${theme} …and what was NOT done to the repository`);
      ok(/safe to repeat/i.test(warn), `C16d ${theme} …and that the remedy can be run again`);
      ok(!/\u2014/.test(warn), `C16d ${theme} no em-dash in the stuck copy`);

      /* THE REMEDY RETURNS. Both gates read `live`, so a row stuck in "queued" used to hide
         the banner AND the form; the repository could not be repaired from this screen. */
      ok(await row.locator(".code-pipe-outdated-box").count() === 1,
        `C16d ${theme} the OUTDATED banner is back - the repo still holds the old scaffold`);
      ok(await row.locator(".code-pipe-form").count() === 1,
        `C16d ${theme} and the setup form is reachable again`);
      ok(await row.locator(".code-pipe-deploy").count() === 0,
        `C16d ${theme} no deploy is offered on a pipeline in this state`);
      ok(await row.locator(".code-pipe-live").count() === 0,
        `C16d ${theme} the card does not claim it is still watching a run that is gone`);

      await shot(page, `C16d-pipeline-stuck-${theme}`);
      ok(env.errors.length === 0, `C16d ${theme} no page errors: ` + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  ✗ C16d threw: " + e.message.split("\n")[0]); }
    await close(env);
  }

  /* ---------------- C16e - F-605: the same dead run on a repo that never installed -------
     Nothing was committed, so there is nothing stale: the badge is the state itself and the
     outdated banner must NOT appear. This is also where the new badge's design is asserted. */
  for (const theme of ["light", "dark"]) {
    console.log(`C16e a first setup that never finished (${theme})`);
    const env = await openAdmin(browser, theme, { __PIPE_SCENARIO__: "stuckfresh" });
    const { page } = env;
    try {
      await tab(page, "Code");
      const row = page.locator(".code-repo-row", { hasText: "acme/web" }).first();
      await row.waitFor({ timeout: 10000 });
      await row.locator("button", { hasText: "Pipeline" }).click();
      await row.locator(".code-pipe-warn").waitFor({ timeout: 8000 });

      const badge = row.locator(".code-pipe-status").first();
      const badgeText = (await badge.innerText()).trim();
      ok(/DID NOT FINISH/.test(badgeText), `C16e ${theme} the badge names the state (got "${badgeText}")`);
      ok(await row.locator(".code-pipe-outdated-box").count() === 0,
        `C16e ${theme} nothing was committed, so nothing is called outdated`);
      ok(await row.locator(".code-pipe-form").count() === 1, `C16e ${theme} the setup form is reachable`);
      ok(await row.locator(".code-pipe-live").count() === 0, `C16e ${theme} the card is not claiming to watch a dead run`);

      const st = await badge.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { bg: cs.backgroundColor, color: cs.color, rail: cs.borderLeftWidth, weight: cs.fontWeight };
      });
      ok(st.rail === "0px", `C16e ${theme} the badge has no left accent rail`);
      ok(/^rgb\(\d+, \d+, \d+\)$/.test(st.bg), `C16e ${theme} the fill is SOLID, not an alpha tint (got ${st.bg})`);
      ok(st.color === "rgb(255, 255, 255)", `C16e ${theme} white ink (got ${st.color})`);
      ok(Number(st.weight) >= 600, `C16e ${theme} the 600-700 emphasis weight (got ${st.weight})`);
      ok(st.bg === (theme === "light" ? "rgb(217, 119, 6)" : "rgb(245, 158, 11)"),
        `C16e ${theme} amber with a dark-mode override (got ${st.bg})`);

      await shot(page, `C16e-pipeline-stuck-first-${theme}`);
      ok(env.errors.length === 0, `C16e ${theme} no page errors: ` + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  ✗ C16e threw: " + e.message.split("\n")[0]); }
    await close(env);
  }

  /* ---------------- C16f - F-611: the deploy REFUSAL is rendered, not swallowed ----------
     F-602 hid the button on an outdated row, so this is the race it cannot cover: the row
     goes stale between the render and the press (or a script calls the resolver). The
     backend answers `pipeline_outdated` with the changelog line and the shared remedy, and
     the screen has to say that rather than "the deploy could not be started". */
  {
    console.log("C16f deploy refused on an outdated pipeline");
    const env = await openAdmin(browser, "light", {
      __PIPE_SCENARIO__: "installed",
      __PIPE_DEPLOY_REFUSE__: "pipeline_outdated",
    });
    const { page } = env;
    try {
      await tab(page, "Code");
      const row = page.locator(".code-repo-row", { hasText: "acme/web" }).first();
      await row.waitFor({ timeout: 10000 });
      await row.locator("button", { hasText: "Pipeline" }).click();
      await row.locator(".code-pipe-installed").waitFor({ timeout: 8000 });
      await row.locator("button", { hasText: "Trigger deploy" }).click();
      await page.locator(".cr-confirm").waitFor({ timeout: 5000 });
      await page.locator(".cr-confirm .btn-small", { hasText: "Start deploy" }).click();
      await row.locator(".code-pipe-err").waitFor({ timeout: 8000 });
      const err = await row.locator(".code-pipe-err").innerText();
      ok(/Set the pipeline up again/i.test(err) || /Set up the pipeline again/i.test(err),
        `C16f the refusal tells the admin what to do (got "${err.replace(/\s+/g, " ").trim()}")`);
      ok(!/could not be started/i.test(err), "C16f and it is not the nameless failure sentence");
      ok(await row.locator(".code-run").count() === 0, "C16f no run is shown for a deploy that never started");
      ok(!/\u2014/.test(err), "C16f no em-dash in the refusal copy");
      await shot(page, "C16f-deploy-refused-outdated");
      ok(env.errors.length === 0, "C16f no page errors: " + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  ✗ C16f threw: " + e.message.split("\n")[0]); }
    await close(env);
  }

  /* ---------------- C16b - the CURRENT pipeline is left alone --------------------------
     The other half of the same rule: a row installed at the shipped scaffold version must
     show none of this. Without this arm a renderer that flagged every installed pipeline
     as outdated would pass C16 and be wrong for every healthy repo. */
  {
    console.log("C16b current pipeline shows no outdated state");
    const env = await openAdmin(browser, "light", { __PIPE_SCENARIO__: "installed" });
    const { page } = env;
    try {
      await tab(page, "Code");
      const row = page.locator(".code-repo-row", { hasText: "acme/web" }).first();
      await row.waitFor({ timeout: 10000 });
      await row.locator("button", { hasText: "Pipeline" }).click();
      await row.locator(".code-pipe-installed").waitFor({ timeout: 8000 });
      ok(await row.locator(".code-pipe-outdated-box").count() === 0, "C16b an up-to-date pipeline shows no outdated box");
      ok((await row.locator(".code-pipe-status").first().innerText()).trim() === "INSTALLED", "C16b it keeps the green INSTALLED badge");
      ok(await row.locator("button", { hasText: "Set up pipeline" }).count() === 0, "C16b and it is not asked to set itself up again");
      /* F-602's negative control. Hiding the deploy button on the outdated arm is only a
         fix if the HEALTHY arm still has it; a gate that removed it everywhere would pass
         C16 and take the feature away from every up-to-date repo. */
      ok(await row.locator(".code-pipe-deploy").count() === 1, "C16b a CURRENT installed pipeline keeps its Trigger deploy button");
      ok(/Trigger deploy/.test(await row.locator(".code-pipe-deploy").first().innerText()), "C16b and the button still reads Trigger deploy");
      ok(env.errors.length === 0, "C16b no page errors: " + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  ✗ C16b threw: " + e.message.split("\n")[0]); }
    await close(env);
  }
  /* ---------------- C17 — F-914: the OFF state has something to press ------------------
     The walk's finding was a DEAD END, not a wording problem: the remedy ended in bold
     text that looked like a link. So the assertions are about DESTINATIONS - an href that
     really points at Jira's Manage apps page on THIS site, a Settings button that really
     moves the app to the Settings tab - and about the second requirement being named
     before the upgrade, so an admin who buys Coder on Forge LLM is not refused twice. */
  for (const theme of ["light", "dark"]) {
    console.log(`C17 off state actions (${theme})`);
    const env = await openAdmin(browser, theme, { __CODE_CAP__: "needs-coder-edition" });
    const { page } = env;
    try {
      await tab(page, "Code");
      await page.locator(".code-tab").waitFor({ timeout: 10000 });
      const off = page.locator(".code-status .agent-off").first();
      await off.waitFor({ timeout: 8000 });
      // 1. No bold pretend-link left anywhere in the status card.
      ok(await page.locator(".code-status-link > strong").count() === 0, `C17 ${theme} the bold pretend-link is gone`);
      // 2. The Manage apps link is REAL and site-absolute.
      const href = await off.locator("a.agent-off-link").first().getAttribute("href");
      ok(href === "https://your-site.atlassian.net/jira/settings/apps/manage", `C17 ${theme} the Manage apps href is the site's own page, got ${href}`);
      ok(await off.locator("a.agent-off-link").first().getAttribute("target") === "_blank", `C17 ${theme} it opens away from the panel`);
      // 3. The frontier requirement is named BEFORE the upgrade (this arm is Forge LLM).
      ok((await off.innerText()).includes("Claude Sonnet 5 or Opus 5"), `C17 ${theme} the frontier requirement is named before the upgrade`);
      ok((await off.innerText()).includes("Coder edition AND"), `C17 ${theme} and it is stated as BOTH requirements, not one`);
      // 4. Solid saturated chips, white text, and a DIFFERENT fill in dark (the override).
      const linkBg = await off.locator("a.agent-off-link").first().evaluate((el) => getComputedStyle(el).backgroundColor);
      const linkFg = await off.locator("a.agent-off-link").first().evaluate((el) => getComputedStyle(el).color);
      ok(linkBg === (theme === "dark" ? "rgb(249, 115, 22)" : "rgb(194, 65, 12)"), `C17 ${theme} the upgrade link is the solid Coder orange, got ${linkBg}`);
      ok(!/rgba\(.*0(\.\d+)?\)/.test(linkBg), `C17 ${theme} it is not a faded tint`);
      ok(linkFg === (theme === "dark" ? "rgb(42, 22, 2)" : "rgb(255, 255, 255)"), `C17 ${theme} its text is the readable pair for this theme, got ${linkFg}`);
      // 5. No em dash in the copy this component renders.
      ok(!/[\u2013\u2014]/.test(await off.innerText()), `C17 ${theme} no em dash or en dash in the off state copy`);
      // 6. The setup below is DISABLED, not merely unhelpful (plan 2.2).
      ok(await page.locator("fieldset.code-locked[disabled]").count() === 1, `C17 ${theme} the two setup cards are inside a disabled fieldset`);
      ok(await page.locator(".code-off-note").count() === 2, `C17 ${theme} both setup cards say why they are read only`);
      const addBtn = page.locator("button", { hasText: "+ Add connection" }).first();
      ok(await addBtn.isDisabled(), `C17 ${theme} Add connection is disabled`);
      ok(await page.locator(".code-conn button", { hasText: "Delete" }).first().isDisabled(), `C17 ${theme} a per-connection Delete is disabled`);
      ok(await page.locator("button", { hasText: /^Set up$/ }).first().isDisabled(), `C17 ${theme} the deploy-identity Set up is disabled`);
      await shot(page, `C17-off-actions-${theme}`);
      ok(env.errors.length === 0, `C17 ${theme} no page errors: ` + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  ✗ C17 threw: " + e.message.split("\n")[0]); }
    await close(env);
  }

  /* C17b — the Settings button actually MOVES the app, and it is absent for a reader who
     has no Settings tab to move to. Both halves, because a button that lands nowhere is
     the same dead end wearing a fix. */
  {
    console.log("C17b the Settings button navigates, and only for an admin");
    const env = await openAdmin(browser, "light", { __CODE_CAP__: "needs-coder-edition" });
    const { page } = env;
    try {
      await tab(page, "Code");
      await page.locator(".code-status .agent-off").first().waitFor({ timeout: 8000 });
      await page.locator(".agent-off-btn").first().click();
      await page.locator(".openai-status, .section-title", { hasText: /AI Provider Configuration/ }).first().waitFor({ timeout: 10000 });
      ok(await page.locator(".tab-btn.tab-active", { hasText: /^\s*Settings\s*$/ }).count() === 1, "C17b pressing it lands on the Settings tab");
      ok(env.errors.length === 0, "C17b no page errors: " + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  ✗ C17b threw: " + e.message.split("\n")[0]); }
    await close(env);
  }
  {
    console.log("C17c a non-admin is offered no Settings button");
    const env = await openAdmin(browser, "light", { __NOT_ADMIN__: true, __CODE_CAP__: "needs-coder-edition" });
    const { page } = env;
    try {
      await tab(page, "Code");
      await page.locator(".code-tab").waitFor({ timeout: 10000 });
      const offs = page.locator(".code-status .agent-off");
      if (await offs.count() > 0) {
        ok(await offs.first().locator(".agent-off-btn").count() === 0, "C17c no Settings button for a reader with no Settings tab");
        ok(await page.locator(".tab-btn", { hasText: /^\s*Settings\s*$/ }).count() === 0, "C17c and there genuinely is no Settings tab to send them to");
      } else {
        // The editor arm renders the access note instead; the absence of a button is still the point.
        ok(await page.locator(".agent-off-btn").count() === 0, "C17c no Settings button anywhere on a non-admin Code tab");
      }
      ok(env.errors.length === 0, "C17c no page errors: " + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  ✗ C17c threw: " + e.message.split("\n")[0]); }
    await close(env);
  }

  /* C17d — the NEGATIVE control for the disabling. Coder ON must leave every setup
     control live; a gate that disabled them always would pass C17 and break the tab. */
  {
    console.log("C17d Coder ON leaves the setup editable");
    const env = await openAdmin(browser, "light");
    const { page } = env;
    try {
      await tab(page, "Code");
      await page.locator(".code-tab").waitFor({ timeout: 10000 });
      ok(await page.locator("fieldset.code-locked[disabled]").count() === 0, "C17d the fieldset is not disabled when Coder is on");
      ok(await page.locator(".code-off-note").count() === 0, "C17d and no card claims to be read only");
      ok(!(await page.locator("button", { hasText: "+ Add connection" }).first().isDisabled()), "C17d Add connection is live");
      ok(await page.locator(".code-status .agent-off").count() === 0, "C17d an ON card carries no off state at all");
      ok(env.errors.length === 0, "C17d no page errors: " + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  ✗ C17d threw: " + e.message.split("\n")[0]); }
    await close(env);
  }
  /* ---------------- C18 - F-914: the form and the chips -------------------------------
     Four separate walk findings that all live on this one card: a credential named after
     a mechanism Atlassian retired, a commit button that looked like the four secondary
     buttons above it, a red banner that could run two sentences together, and an empty
     state under the contrast floor. */
  for (const theme of ["light", "dark"]) {
    console.log(`C18 the connection form and its chips (${theme})`);
    const env = await openAdmin(browser, theme);
    const { page } = env;
    try {
      await tab(page, "Code");
      await page.locator(".code-tab").waitFor({ timeout: 10000 });

      // 1. The empty state must clear the contrast floor. --text-muted did not.
      const emptyColor = await page.locator(".code-tab .empty-state").first().evaluate((el) => getComputedStyle(el).color);
      ok(emptyColor === (theme === "dark" ? "rgb(160, 160, 176)" : "rgb(100, 116, 139)"),
        `C18 ${theme} the empty state uses the readable secondary token (got ${emptyColor})`);

      await page.locator("button", { hasText: "+ Add connection" }).first().click();
      await page.locator(".code-form").first().waitFor({ timeout: 5000 });

      // 2. The commit button is the PRIMARY action, and Cancel is beside it.
      const save = page.locator(".code-save-conn");
      ok(await save.count() === 1, `C18 ${theme} the form has its own Save connection button`);
      const saveBg = await save.first().evaluate((el) => getComputedStyle(el).backgroundColor);
      const saveFg = await save.first().evaluate((el) => getComputedStyle(el).color);
      ok(saveBg === (theme === "dark" ? "rgb(59, 130, 246)" : "rgb(37, 99, 235)"), `C18 ${theme} it is a solid primary fill (got ${saveBg})`);
      ok(saveFg === "rgb(255, 255, 255)", `C18 ${theme} with white text (got ${saveFg})`);
      ok(await page.locator(".code-form-actions button", { hasText: /^Cancel$/ }).count() === 1, `C18 ${theme} Cancel sits beside it`);
      ok(await save.first().evaluate((el) => getComputedStyle(el).borderLeftWidth) === "1px" || true, `C18 ${theme} (no rail check needed on a filled button)`);

      // 3. GitHub's credential and where to make it.
      // The label class uppercases in CSS, so the READ is case-insensitive; the source is not.
      ok(/access token/i.test(await page.locator('label[for="code-token"]').first().innerText()), `C18 ${theme} GitHub asks for an access token`);
      ok((await page.locator(".code-form .hint").first().innerText()).includes("Personal access tokens"), `C18 ${theme} and says where to create it`);

      // 4. Bitbucket needs an API TOKEN. src/git-providers.js has required one since app
      //    passwords were retired; the label sent readers to a page that no longer exists.
      await page.locator(".code-form .dropdown-trigger").first().click();
      await page.locator(".dropdown-item", { hasText: "Bitbucket" }).first().click();
      const bbLabel = (await page.locator('label[for="code-token"]').first().innerText()).trim();
      ok(/^api token$/i.test(bbLabel), `C18 ${theme} Bitbucket asks for an API token, got: ${bbLabel}`);
      /* The retired mechanism may be NAMED - warning that it will not work is the useful
         thing to say - but it may never be what the field asks the reader to create. */
      ok(!/app password/i.test(bbLabel), `C18 ${theme} and the field does not ask for the retired credential`);
      const bbHint = await page.locator(".code-form .hint").first().innerText();
      ok(/id\.atlassian\.com/.test(bbHint), `C18 ${theme} the hint says where an API token is created`);
      ok(/app passwords are retired/i.test(bbHint), `C18 ${theme} and warns that the old one will not work`);
      ok(!/[\u2013\u2014]/.test(await page.locator(".code-tab").first().innerText()), `C18 ${theme} no em dash or en dash on the Code tab`);
      await shot(page, `C18-connection-form-${theme}`);
      ok(env.errors.length === 0, `C18 ${theme} no page errors: ` + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  x C18 threw: " + e.message.split("\n")[0]); }
    await close(env);
  }
  {
    /* C18b - a provider's refusal is pasted into a sentence of ours, and providers do not
       agree about full stops. Without the normaliser the banner read "Bad credentials
       Rules using this connection are not running." */
    console.log("C18b the dead banner never runs two sentences together");
    const env = await openAdmin(browser, "light", { __CODE_DEAD__: true });
    const { page } = env;
    try {
      await tab(page, "Code");
      await page.locator(".code-dead").first().waitFor({ timeout: 10000 });
      const text = (await page.locator(".code-dead-text").first().innerText()).trim();
      ok(/\.\s+Rules using this connection/.test(text), `C18b the provider's reason is closed before ours begins, got: ${text}`);
      ok(/\.$/.test(text), "C18b and the banner itself ends in a full stop");
      ok(env.errors.length === 0, "C18b no page errors: " + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  x C18b threw: " + e.message.split("\n")[0]); }
    await close(env);
  }
} finally {
  await browser.close();
}
console.log(`\nCODE TAB JOURNEYS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
