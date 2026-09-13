/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 *
 * admin-panel CODE TAB + AgentConfig CODE column + EventPicker git group browser journeys
 * (mock-bridge harness). Drives the REAL admin-panel build with @forge/bridge aliased to
 * bridge.js, so the capability card, the connection list, the dead-credential banner, the
 * consent screen, the git action column and the repos filter are exercised end to end
 * against canned resolver responses.
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
      await page.locator("button", { hasText: "Set up" }).first().click();
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
} finally {
  await browser.close();
}
console.log(`\nCODE TAB JOURNEYS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
