#!/usr/bin/env node
/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * LIVE proof of the F-526..F-541 scaffold batch on a REAL GitHub repository, driven the
 * way an admin drives it: the admin panel's Code tab, in a browser holding the persistent
 * admin profile at forge-live-harness/.auth/profile.
 *
 * WHY PLAYWRIGHT. `saveGitConnection`, `saveForgeIdentity`, `setupGitPipeline` and
 * `triggerGitDeploy` are DELIBERATELY absent from the test hook's invokeResolver
 * allow-list (src/test-hook.js): a harness that can plant a credential or push a deploy
 * into somebody's repository is a harness that can be turned into one. So the WRITE half
 * is the UI and the READ half is the hook + the GitHub API — two independent sides for
 * every claim.
 *
 * THE UI FOLDER IS READ FROM THE REPOSITORY, NOT ASSUMED. The scaffold's default is
 * `static/app`; this offshoot's real Custom UI lives in `static/next-steps`. A test that
 * types the default would prove the default, not the F-526 field.
 *
 * Phases (state in results/pipeline-scaffold/state.json):
 *   node scripts/pipeline-scaffold-live.mjs setup    # connection + identity + pipeline setup
 *   node scripts/pipeline-scaffold-live.mjs workflow # read the COMMITTED workflow back
 *   node scripts/pipeline-scaffold-live.mjs run      # dispatch, wait, assert green + bootstrap skipped
 *   node scripts/pipeline-scaffold-live.mjs drift    # widen scopes on a throwaway branch -> lock refuses
 *   node scripts/pipeline-scaffold-live.mjs cleanup  # branch, PR, connection, identity
 *
 * NOTHING SECRET IS PRINTED: not GH_TOKEN, not the Atlassian API token, not the webtrigger url.
 *
 * Env: GH_TOKEN, test-harness/.env (TESTSTATE_URL, HARNESS_SECRET, HARNESS_ADMIN_ACCOUNT_ID,
 *      JIRA_ADMIN_EMAIL, JIRA_API_TOKEN).
 */
import { forgeEnvId, declareMutations } from "../lib/shared-env-guard.mjs";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { chromium } from "../../static/_screenshot-harness/node_modules/playwright/index.mjs";
import { loadEnv } from "../lib/env.mjs";
import { testState } from "../lib/rules-api.mjs";
import { readJobLog, assertLockRefusal } from "../lib/gh-job-log.mjs";

/* F-733 — THIS DRIVER IS DEV-ONLY BY CONSTRUCTION (no `--env`), AND THE SHARED TENANT IS
   THE ONLY TENANT IT HAS. So it declares what it CHANGES and leaves changed, in the guard's
   closed vocabulary, and a non-empty set asks for `--i-know-dev-is-shared` before anything is
   written. No environment is resolved and no `.env` is demanded: this is the DECLARATION half
   of `requireEnvAck` on its own, which is what keeps a Playwright script that never opens a
   web trigger out of the mapping it has no use for (F-699's reasoning). */
declareMutations(["git"]);

const env = loadEnv();
const BASE = "https://wolfaenpak.atlassian.net";
const APP = "36415848-6868-4697-9554-3c3ad87b8da9";
const DEV_ENV = forgeEnvId("dev");
const PROFILE = "/Users/mihaiperdum/Projects/forge-live-harness/.auth/profile";
const REPO = process.env.GIT_REPO_ID || "leanzero-srl/cognirunner-forge-offshoot";
const ACCT = process.env.HARNESS_ADMIN_ACCOUNT_ID || env.HARNESS_ADMIN_ACCOUNT_ID;
const APP_NAME = "CogniRunner Offshoot";
const DRIFT_BRANCH = "harness-scope-drift";
const OUT = new URL("../results/pipeline-scaffold", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const STATE = OUT + "/state.json";
const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : { checks: [] };
const save = () => fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
let failures = 0;
const check = (label, ok, data = {}) => {
  if (!ok) failures += 1;
  state.checks.push({ label, ok, ...data, at: new Date().toISOString() });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${Object.keys(data).length ? " " + JSON.stringify(data) : ""}`);
  save();
};
const note = (label, data = {}) => { state.checks.push({ label, note: true, ...data }); console.log(`NOTE  ${label} ${JSON.stringify(data)}`); save(); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const GH = process.env.GH_TOKEN || execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
const gh = (args, input) => {
  const o = execFileSync("gh", args, { encoding: "utf8", input: input ? JSON.stringify(input) : undefined, env: { ...process.env, GH_TOKEN: GH } });
  try { return JSON.parse(o); } catch { return o; }
};
/* Raw stdout, no JSON parse and no throw-on-stderr sugar - readJobLog needs the text
   exactly as gh printed it, and needs the exception when gh refuses. */
const ghRun = (file, args) => execFileSync(file, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GH_TOKEN: GH, NO_COLOR: "1" } });
const ghText = (p, ref) => {
  const r = gh(["api", `/repos/${REPO}/contents/${p}${ref ? `?ref=${ref}` : ""}`]);
  return Buffer.from(r.content, "base64").toString("utf8");
};
const call = async (functionKey, payload = {}) => {
  const r = await testState.post({ action: "invokeResolver", functionKey, accountId: ACCT, payload });
  if (!r.ok) throw new Error(`${functionKey} HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
  return r.body;
};

const openAdmin = async (tab) => {
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true, viewport: { width: 1500, height: 1400 } });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto(`${BASE}/jira/apps/${APP}/${DEV_ENV}`, { waitUntil: "domcontentloaded" });
  let frame = null;
  for (let i = 0; i < 90; i++) {
    frame = page.frames().find((f) => f.url().includes("cdn.prod.atlassian-dev.net"));
    if (frame && (await frame.locator(".tab-btn").count()) > 0) break;
    await sleep(1000);
  }
  if (!frame) { await ctx.close(); throw new Error("the admin panel iframe never appeared — is the profile still signed in?"); }
  await frame.locator(".tab-btn", { hasText: new RegExp(`^\\s*${tab}\\s*$`) }).click();
  /* The tab's own data (connections, identity, pipeline rows) loads AFTER the click.
     Returning immediately made every "is the button there?" read answer 0 and a cleanup
     loop exit on its first iteration reporting nothing to do. */
  await sleep(8000);
  return { ctx, page, frame };
};

/* ═══════════════════════ phase: setup ═══════════════════════ */
const phaseSetup = async () => {
  // THE UI FOLDER, READ FROM THE REPOSITORY ITSELF.
  const tree = gh(["api", `/repos/${REPO}/git/trees/main?recursive=1`]).tree.map((t) => t.path);
  const uiDirs = tree.filter((p) => /^static\/[^/]+\/package\.json$/.test(p)).map((p) => p.replace(/\/package\.json$/, ""));
  check("the offshoot's REAL Custom UI folder was read from the repo (not assumed)", uiDirs.length === 1, { uiDirs });
  const UI_DIR = uiDirs[0];
  state.uiDir = UI_DIR; save();

  const vars = gh(["api", `/repos/${REPO}/actions/variables`]).variables.map((v) => v.name);
  check("FORGE_APP_ID is already a repository variable, so the bootstrap step must be skipped", vars.includes("FORGE_APP_ID"), { vars });

  const manifest = ghText("manifest.yml");
  state.label = `harness pipeline ${Date.now().toString(36)}`; save();

  const { ctx, frame } = await openAdmin("Code");
  try {
    // --- connection (resumable: a re-run reuses the row it already created) ---
    let conns = (await call("listGitConnections")).connections || [];
    let row = conns.find((c) => c.label === state.label);
    if (!row) {
      await frame.locator("button", { hasText: "+ Add connection" }).click();
      await frame.locator("#code-label").fill(state.label);
      await frame.locator("#code-token").fill(GH);
      await frame.locator("#code-repos").fill(REPO);
      await frame.locator("button", { hasText: "Save connection" }).click();
      await frame.locator(".code-conn-label", { hasText: state.label }).waitFor({ timeout: 60000 });
      conns = (await call("listGitConnections")).connections || [];
      row = conns.find((c) => c.label === state.label);
    }
    check("the connection was created and its public shape carries no token", !!row && row.hasToken === true && !("token" in row), { id: row && row.id, login: row && row.login });
    state.connId = row.id; save();

    // --- Forge deploy identity ---
    const idBefore = (await call("getForgeIdentityStatus")).status;
    check("no deploy identity is stored before this run", idBefore.hasIdentity === false, { before: idBefore });
    // The button lives in the "Forge deploy identity" card and simply reads "Set up".
    const idCard = frame.locator(".code-card").filter({ hasText: "Forge deploy identity" }).first();
    if (idBefore.hasIdentity !== true) await idCard.locator("button", { hasText: /^Set up$/ }).click();
    await frame.locator("#code-id-email").waitFor({ timeout: 30000 });
    await frame.locator("#code-id-email").fill(env.JIRA_ADMIN_EMAIL);
    await frame.locator("#code-id-token").fill(env.JIRA_API_TOKEN);
    await frame.locator(".code-consent input[type=checkbox]").check();
    await frame.locator("button", { hasText: "Store deploy identity" }).click();
    await sleep(4000);
    const idAfter = (await call("getForgeIdentityStatus")).status;
    check("the deploy identity is stored WITH consent and no token is readable",
      idAfter.hasIdentity === true && !!idAfter.consent && !JSON.stringify(idAfter).includes(env.JIRA_API_TOKEN),
      { email: idAfter.email, consent: idAfter.consent });

    // --- pipeline setup ---
    // The pipeline card is collapsed behind the repo row's "Pipeline" button.
    const manifestBox = frame.locator("textarea[id^=pipe-manifest-]").first();
    if (!(await manifestBox.count())) {
      await frame.locator(".code-repo-row button", { hasText: /^Pipeline$/ }).first().click();
    }
    await manifestBox.waitFor({ timeout: 30000 });
    await manifestBox.fill(manifest);
    await frame.locator("input[id^=pipe-site-]").first().fill("wolfaenpak.atlassian.net");
    await frame.locator("input[id^=pipe-branch-]").first().fill("main");
    const appNameIn = frame.locator("input[id^=pipe-appname-]").first();
    await appNameIn.fill(APP_NAME);
    const uiIn = frame.locator("input[id^=pipe-uidir-]").first();
    await uiIn.fill(UI_DIR);
    // THE REVIEW BLOCK — the values as the committed workflow will carry them, read back
    // from the UI BEFORE the write. This is the F-526 field doing its job.
    const review = (await frame.locator(".code-pipe-review").first().innerText()).replace(/\s+/g, " ");
    check("the review block names the App name and the UI folder this run typed",
      review.includes(APP_NAME) && review.includes(UI_DIR), { review });
    await frame.locator("button", { hasText: /Set up pipeline|Set up again/ }).first().click();
    // ~15 writes to a repository: give it room.
    let st = null;
    for (let i = 0; i < 60; i++) {
      st = (await call("getGitPipelineStatus", { connectionId: state.connId, repo: REPO })).status || null;
      if (st && (st.status === "installed" || st.status === "failed" || st.status === "partial")) break;
      await sleep(10000);
    }
    check("the pipeline setup reached INSTALLED", !!st && st.status === "installed", { status: st && st.status, failedStep: st && st.failedStep, steps: st && st.steps });
    state.pipeStatus = st; save();
  } finally { await ctx.close(); }
};

/* ═══════════════════════ phase: workflow ═══════════════════════ */
const phaseWorkflow = async () => {
  const wf = ghText(".github/workflows/forge-deploy.yml");
  fs.writeFileSync(OUT + "/forge-deploy.yml", wf);
  const UI_DIR = state.uiDir;
  check(`the committed workflow builds the REAL UI folder (${UI_DIR})`, wf.includes(`working-directory: ${UI_DIR}`), { has: wf.includes(`working-directory: ${UI_DIR}`) });
  check("the committed workflow carries the app name that was typed", wf.includes(`FORGE_APP_NAME: ${APP_NAME}`), {});
  check("the push trigger covers main AND master", /branches:\s*\[main,\s*master\]/.test(wf), { line: (wf.match(/branches:.*/) || [])[0] });
  check("the installs are `npm install`, not `npm ci`", wf.includes("npm install --no-audit --no-fund") && !/\bnpm ci\b/.test(wf), {});
  const lockAt = wf.indexOf("name: Permission lock");
  const deployAt = wf.indexOf("name: Deploy");
  check("the Permission lock step comes BEFORE the Deploy step", lockAt > 0 && deployAt > lockAt, { lockAt, deployAt });
  check("the bootstrap registers with a developer space (-s), never --personal", wf.includes('forge register -y -s "$FORGE_DEVELOPER_SPACE"') && !wf.includes("--personal"), {});
};

/* ═══════════════════════ phase: run ═══════════════════════ */
const runsSince = (t) => gh(["api", `/repos/${REPO}/actions/runs?per_page=20`]).workflow_runs.filter((r) => new Date(r.created_at).getTime() >= t);
const waitRun = async (t) => {
  for (let i = 0; i < 90; i++) {
    const rs = runsSince(t);
    const r = rs[0];
    if (r && r.status === "completed") return r;
    await sleep(10000);
  }
  return runsSince(t)[0] || null;
};
const phaseRun = async () => {
  const t = Date.now() - 5000;
  gh(["api", "-X", "POST", `/repos/${REPO}/actions/workflows/forge-deploy.yml/dispatches`, "--input", "-"], { ref: "main", inputs: { environment: "development" } });
  const r = await waitRun(t);
  check("the deploy run finished GREEN on the first try", !!r && r.conclusion === "success", { id: r && r.id, conclusion: r && r.conclusion, url: r && r.html_url });
  state.runId = r && r.id; save();
  if (!r) return;
  const jobs = gh(["api", `/repos/${REPO}/actions/runs/${r.id}/jobs`]).jobs;
  const steps = (jobs[0] || {}).steps || [];
  const boot = steps.find((s) => /Bootstrap/.test(s.name));
  check("the Bootstrap step was SKIPPED because FORGE_APP_ID is already set (F-526/F-548)",
    !!boot && boot.conclusion === "skipped", { bootstrap: boot && { name: boot.name, conclusion: boot.conclusion } });
  check("every non-skipped step succeeded", steps.every((s) => s.conclusion === "success" || s.conclusion === "skipped"),
    { steps: steps.map((s) => `${s.name}=${s.conclusion}`) });
};

/* ═══════════════════════ phase: drift ═══════════════════════ */
const phaseDrift = async () => {
  const mainSha = gh(["api", `/repos/${REPO}/git/ref/heads/main`]).object.sha;
  try { gh(["api", "-X", "DELETE", `/repos/${REPO}/git/refs/heads/${DRIFT_BRANCH}`]); } catch { /* absent */ }
  gh(["api", "-X", "POST", `/repos/${REPO}/git/refs`, "--input", "-"], { ref: `refs/heads/${DRIFT_BRANCH}`, sha: mainSha });
  const cur = gh(["api", `/repos/${REPO}/contents/manifest.yml?ref=${DRIFT_BRANCH}`]);
  const text = Buffer.from(cur.content, "base64").toString("utf8");
  // WIDEN: add a scope the committed lock does not hold.
  const widened = text.replace(/(\n\s*scopes:\n)/, `$1      - manage:jira-configuration\n`);
  check("the throwaway branch's manifest really was widened", widened !== text, { added: "manage:jira-configuration" });
  gh(["api", "-X", "PUT", `/repos/${REPO}/contents/manifest.yml`, "--input", "-"], {
    message: "harness: widen scopes to prove the permission lock refuses (F-529)",
    content: Buffer.from(widened, "utf8").toString("base64"), sha: cur.sha, branch: DRIFT_BRANCH,
  });
  const t = Date.now() - 5000;
  gh(["api", "-X", "POST", `/repos/${REPO}/actions/workflows/forge-deploy.yml/dispatches`, "--input", "-"], { ref: DRIFT_BRANCH, inputs: { environment: "development" } });
  const r = await waitRun(t);
  check("the widened-scope run FAILED", !!r && r.conclusion === "failure", { id: r && r.id, conclusion: r && r.conclusion, url: r && r.html_url });
  if (!r) return;
  const jobs = gh(["api", `/repos/${REPO}/actions/runs/${r.id}/jobs`]).jobs;
  const steps = (jobs[0] || {}).steps || [];
  const lock = steps.find((s) => /Permission lock/.test(s.name));
  const deploy = steps.find((s) => /^Deploy$/.test(s.name));
  check("it failed AT the Permission lock step (F-529), not later", !!lock && lock.conclusion === "failure", { lock: lock && lock.conclusion });
  check("the Deploy step never ran", !deploy || deploy.conclusion === "skipped" || deploy.conclusion === null, { deploy: deploy && deploy.conclusion });
  /* F-592: the newer gh CLI refuses to PRINT a log body containing terminal escape
     sequences, so the bare `gh api .../logs` call threw and killed this phase before
     its two most important assertions ever ran - and the phase still printed the
     earlier PASS lines. readJobLog tries `gh run view --log`, then the API with
     --allow-escape-sequences, then the API bare, strips ANSI, and THROWS if none of
     them produced text. A log we cannot read is a FAILED CHECK, never a skipped one. */
  let log = null, via = null, readErr = null;
  try {
    const got = readJobLog({ run: ghRun, repo: REPO, runId: r.id, jobId: jobs[0].id });
    log = got.text; via = got.via;
    fs.writeFileSync(OUT + "/drift-job.log", log);
  } catch (e) { readErr = String(e.message).slice(0, 400); }
  check("the failing job's log was READ (the ::error:: assertions are never skipped)", log !== null, { via, err: readErr, file: log !== null ? OUT + "/drift-job.log" : null });
  if (log === null) {
    check("the failure carries the LOCK's own ::error:: line, not MAJOR_VERSION_RULE", false, { reason: "the log could not be read - assertion NOT evaluated" });
    return;
  }
  const verdict = assertLockRefusal(log);
  check("the failure carries the LOCK's own ::error:: line, not MAJOR_VERSION_RULE",
    verdict.ok,
    { lockLines: verdict.lockLines.slice(0, 3).map((l) => l.slice(0, 240)),
      errLines: verdict.errLines.slice(0, 5).map((l) => l.slice(0, 240)),
      sawMajorVersionRule: verdict.sawMajorVersionRule,
      missing: verdict.missing, broken: verdict.broken });
};

/* ═══════════════════════ phase: cleanup ═══════════════════════ */
const phaseCleanup = async () => {
  try { gh(["api", "-X", "DELETE", `/repos/${REPO}/git/refs/heads/${DRIFT_BRANCH}`]); note("throwaway branch deleted"); } catch (e) { note("branch delete", { err: String(e.message).slice(0, 120) }); }
  const { ctx, frame } = await openAdmin("Code");
  try {
    /* Delete EVERY connection this driver made — an interrupted run leaves one behind,
       and a cleanup that only knows the last label is how a tenant accumulates them. */
    /* Every connection row carries its own "Delete" (a .btn-danger). A `filter({has})`
       built from a FRAME-level locator does not scope to the row, so the plain button
       text is what this walks — one at a time, re-read after each confirm. */
    for (let i = 0; i < 8; i++) {
      const del = frame.locator("button.btn-danger", { hasText: /^Delete$/ }).first();
      if (!(await del.count())) break;
      await del.click();
      await frame.locator(".cr-confirm-actions button", { hasText: /^Delete$/ }).first().click();
      await sleep(5000);
    }
    const idCard = frame.locator(".code-card").filter({ hasText: "Forge deploy identity" }).first();
    const idDel = idCard.locator("button", { hasText: /^Remove$/ }).first();
    if (await idDel.count()) {
      await idDel.click();
      const c = frame.locator(".cr-confirm-actions button").filter({ hasText: /^(Remove|Delete|Confirm)$/ }).first();
      if (await c.count()) await c.click();
      await sleep(4000);
    }
    await sleep(4000);
  } finally { await ctx.close(); }
  const conns = (await call("listGitConnections")).connections || [];
  check("every harness connection is gone", !conns.some((c) => /^harness pipeline /.test(c.label)), { left: conns.map((c) => c.label) });
  const id = (await call("getForgeIdentityStatus")).status;
  check("the deploy identity is gone", id.hasIdentity === false, { id });
  const hooks = gh(["api", `/repos/${REPO}/hooks`]);
  note("repo hooks remaining", { count: Array.isArray(hooks) ? hooks.length : "?" });
  const vars = gh(["api", `/repos/${REPO}/actions/variables`]).variables.map((v) => v.name);
  note("repo variables kept (deliberate)", { vars });
};

const PHASES = { setup: phaseSetup, workflow: phaseWorkflow, run: phaseRun, drift: phaseDrift, cleanup: phaseCleanup };
const which = process.argv[2];
if (!PHASES[which]) { console.error("usage: pipeline-scaffold-live.mjs <" + Object.keys(PHASES).join("|") + ">"); process.exit(2); }
await PHASES[which]();
console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"} — phase ${which}`);
process.exit(failures === 0 ? 0 : 1);
