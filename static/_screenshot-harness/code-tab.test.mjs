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
import { agentCapabilityCopy } from "../../src/shared/edition.js";
/* F-526: the scaffold's OWN defaults, so "the form did not just ship the default" is
   asserted against the value the renderer would really have used. */
import { SCAFFOLDS } from "../../src/shared/git-scaffolds.js";

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
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true }); };

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
      ok((await page.locator(".code-facts").first().innerText()).includes("anthropic"), `C1 ${theme} the provider fact is rendered`);
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
      ok(/repo/.test(who), "C6 the Test result shows the reported scopes");
      ok(/not known/.test(who), "C6 an unknown capability says NOT KNOWN, never no");
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

      // The values the workflow will carry, read back before the button.
      await dirInput.fill("static/next-steps");
      ok(await row.locator(".code-field-err").count() === 0, `C12b ${theme} a real folder clears the refusal`);
      const review = await row.locator(".code-pipe-review").innerText();
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
      ok(env.errors.length === 0, `C12b ${theme} no page errors: ` + env.errors.join(" | "));
    } catch (e) { fail++; console.log("  ✗ C12b threw: " + e.message.split("\n")[0]); }
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
} finally {
  await browser.close();
}
console.log(`\nCODE TAB JOURNEYS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
