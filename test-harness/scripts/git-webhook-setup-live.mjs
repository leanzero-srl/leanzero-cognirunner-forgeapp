/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * LIVE proof of F-460 (per-repo webhook installation) and F-462 (the premade
 * PR-review listener) against a REAL GitHub repository.
 *
 * WHY PLAYWRIGHT AND NOT THE TEST HOOK: `saveGitConnection`, `setupGitWebhook` and
 * `rotateGitWebhookSecret` are DELIBERATELY absent from the hook's invokeResolver
 * allow-list (src/test-hook.js) — a harness that can plant or destroy a credential is
 * a harness that can be turned into one. So the WRITE half is driven the way a human
 * admin drives it: the admin panel's Code tab, in a browser holding the persistent
 * admin profile. The READ half (listGitConnections, getListener, getLogs) still goes
 * through the hook, which is what makes each claim checkable from two sides.
 *
 * THE AUTH PROFILE. `.auth/storage-state.json` in forge-live-harness is STALE (it
 * redirects to id.atlassian.com/login). The live session is the PERSISTENT PROFILE at
 * `.auth/profile` — launchPersistentContext, not newContext({storageState}).
 *
 * THE IDEMPOTENCE ARM, and why it is shaped this way. `setupRepoWebhook` matches an
 * existing hook by `config.url === hookUrlFor(trigger, conn, repo)`; a match is PATCHed,
 * a miss is POSTed. The Code tab only shows "Set up webhook" while no hook is RECORDED,
 * so a second click is unreachable through the UI. Instead the reuse arm pre-creates the
 * hook ON GITHUB at exactly that url (with a secret of our own) and then presses the
 * button once: if the match is real, GitHub still holds ONE hook for that url and its id
 * is the one we created. That is the same question `reused:true` answers, asked of the
 * provider rather than of our own return value.
 *
 * Phases (state carries in results/git-webhook-setup/state.json):
 *   node scripts/git-webhook-setup-live.mjs setup     # connection + first hook (create arm)
 *   node scripts/git-webhook-setup-live.mjs idem      # second connection, pre-made hook, reuse arm
 *   node scripts/git-webhook-setup-live.mjs rotate    # rotate the secret, re-read the config
 *   node scripts/git-webhook-setup-live.mjs listener  # the premade PR-review listener
 *   node scripts/git-webhook-setup-live.mjs pr        # a real PR -> delivery -> queued run
 *   node scripts/git-webhook-setup-live.mjs cleanup   # PR, branch, hooks, connections, listener
 *
 * NOTHING SECRET IS PRINTED: not the GitHub token, not the webtrigger url, not the
 * hook signing secret (there is no read path for it anywhere). The hook url is only
 * ever compared, never logged; its suffix `?conn=&repo=` is logged on its own.
 *
 * Env: GIT_WEBHOOK_URL (forge webtrigger create -f git-webhook -e development),
 *      GH_TOKEN, and test-harness/.env (TESTSTATE_URL, HARNESS_SECRET,
 *      HARNESS_ADMIN_ACCOUNT_ID).
 */
import { forgeEnvId } from "../lib/shared-env-guard.mjs";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { chromium } from "../../static/_screenshot-harness/node_modules/playwright/index.mjs";
import { testState } from "../lib/rules-api.mjs";
import { gitHookUrl } from "../lib/git-hook-url.mjs";

const BASE = "https://wolfaenpak.atlassian.net";
const APP = "36415848-6868-4697-9554-3c3ad87b8da9";
const DEV_ENV = forgeEnvId("dev");
const PROFILE = "/Users/mihaiperdum/Projects/forge-live-harness/.auth/profile";
const REPO = process.env.GIT_REPO_ID || "leanzero-srl/cognirunner-forge-offshoot";
const TRIGGER = process.env.GIT_WEBHOOK_URL || "";
const ACCT = process.env.HARNESS_ADMIN_ACCOUNT_ID;
const OUT = new URL("../results/git-webhook-setup", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const STATE = OUT + "/state.json";
const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : { checks: [] };
const saveState = () => fs.writeFileSync(STATE, JSON.stringify(state, null, 2));

let failures = 0;
const check = (label, ok, data = {}) => {
  if (!ok) failures += 1;
  state.checks.push({ label, ok, ...data, at: new Date().toISOString() });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${Object.keys(data).length ? " " + JSON.stringify(data) : ""}`);
  saveState();
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- GitHub, through gh, with the token in the ENV and never on a command line ---- */
const gh = (args, body) => {
  const out = execFileSync("gh", args, {
    env: { ...process.env, GH_TOKEN: process.env.GH_TOKEN },
    input: body === undefined ? undefined : JSON.stringify(body),
    encoding: "utf8",
  });
  return out.trim() ? JSON.parse(out) : null;
};
const ghHooks = () => gh(["api", `/repos/${REPO}/hooks`]);
/** The url a delivery for this connection+repo must arrive on — hookUrlFor, retyped
 *  nowhere: this mirrors src/git-connections.js and is compared, never printed. */
const hookUrl = (connId) => gitHookUrl(TRIGGER, connId, REPO);

/* ---- the app, read-side, through the dev test hook ---- */
const call = async (functionKey, payload = {}) => {
  const r = await testState.post({ action: "invokeResolver", functionKey, accountId: ACCT, payload });
  if (!r.ok) throw new Error(`${functionKey} HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
  return r.body;
};

/* ---- the admin panel ---- */
const openAdmin = async (tab) => {
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: true, viewport: { width: 1500, height: 1200 } });
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
  return { ctx, page, frame };
};

const addConnection = async (frame, label) => {
  await frame.locator("button", { hasText: "+ Add connection" }).click();
  await frame.locator("#code-label").fill(label);
  // WRITE-ONLY FIELD. The token is typed from the environment and never echoed.
  await frame.locator("#code-token").fill(process.env.GH_TOKEN);
  await frame.locator("#code-repos").fill(REPO);
  await frame.locator("button", { hasText: "Save connection" }).click();
  await frame.locator(".code-conn-label", { hasText: label }).waitFor({ timeout: 60000 });
};

const repoRow = (frame, label) =>
  frame.locator(".code-conn").filter({ has: frame.locator(".code-conn-label", { hasText: label }) })
    .locator(".code-repo-row").filter({ has: frame.locator(".code-repo", { hasText: REPO }) });

/* ═══════════════════════════════ phases ═══════════════════════════════ */

const phaseSetup = async () => {
  const before = ghHooks();
  check("the repository starts with no webhook of ours", before.length === 0, { hooksBefore: before.length });
  state.label1 = `harness webhook ${Date.now().toString(36)}`;
  const { ctx, frame } = await openAdmin("Code");
  try {
    await addConnection(frame, state.label1);
    const list = await call("listGitConnections");
    const row = (list.connections || []).find((c) => c.label === state.label1);
    check("the connection was created and carries no token in its public shape",
      !!row && row.hasToken === true && !("token" in row), { id: row && row.id, repos: row && row.repos, login: row && row.login });
    state.conn1 = row.id; saveState();

    const rr = repoRow(frame, state.label1);
    await rr.locator("button", { hasText: "Set up webhook" }).click();
    await rr.locator(".code-hook.set").waitFor({ timeout: 60000 });
    check("the Code tab reports WEBHOOK SET", true, { chip: (await rr.locator(".code-hook").innerText()).trim() });

    const hooks = ghHooks();
    const ours = hooks.filter((h) => h.config && h.config.url === hookUrl(state.conn1));
    check("GitHub holds exactly ONE hook for this connection+repo url", ours.length === 1, { total: hooks.length, matching: ours.length });
    const h = ours[0];
    state.hook1 = h && h.id; saveState();
    check("the hook is signed (GitHub reports a secret set)", !!h && h.config.secret === "********", { secret: h && h.config.secret });
    check("the hook subscribes to the app's five events", !!h && JSON.stringify(h.events.slice().sort()) === JSON.stringify(["check_run", "issue_comment", "pull_request", "pull_request_review", "push"]), { events: h && h.events });
    check("the hook is active and delivers JSON", !!h && h.active === true && h.config.content_type === "json" && h.config.insecure_ssl === "0", { active: h && h.active, contentType: h && h.config.content_type });
    const after = await call("listGitConnections");
    const rec = (after.connections || []).find((c) => c.id === state.conn1);
    check("the connection row records the hook, and no secret",
      !!rec && rec.webhooks && String(rec.webhooks[REPO].hookId) === String(h.id) && !JSON.stringify(rec).includes("secret"),
      { recorded: rec && rec.webhooks && rec.webhooks[REPO] });
  } finally { await ctx.close(); }
};

const phaseIdem = async () => {
  state.label2 = `harness reuse ${Date.now().toString(36)}`;
  const { ctx, frame } = await openAdmin("Code");
  try {
    await addConnection(frame, state.label2);
    const list = await call("listGitConnections");
    const row = (list.connections || []).find((c) => c.label === state.label2);
    state.conn2 = row.id; saveState();

    // PRE-CREATE the hook GitHub-side, at exactly the url this connection+repo must
    // use, with a secret of our own and ONE event. If setup is idempotent by url it
    // must PATCH this row; if it is not, GitHub ends up with a twin.
    const pre = gh(["api", "-X", "POST", `/repos/${REPO}/hooks`, "--input", "-"], {
      name: "web", active: true, events: ["push"],
      config: { url: hookUrl(state.conn2), content_type: "json", insecure_ssl: "0", secret: "harness-preexisting-" + Date.now() },
    });
    state.hookPre = pre.id; saveState();
    check("a hook already exists at this connection+repo url before setup runs", !!pre.id, { preHookId: pre.id, preEvents: pre.events });

    const rr = repoRow(frame, state.label2);
    await rr.locator("button", { hasText: "Set up webhook" }).click();
    await rr.locator(".code-hook.set").waitFor({ timeout: 60000 });

    const hooks = ghHooks();
    const ours = hooks.filter((h) => h.config && h.config.url === hookUrl(state.conn2));
    check("setup REUSED the existing hook — still exactly one at that url, no twin", ours.length === 1, { matchingAtUrl: ours.length, totalOnRepo: hooks.length });
    check("the reused hook is the very row we created (same id) — reused, not recreated", ours[0] && String(ours[0].id) === String(pre.id), { before: pre.id, after: ours[0] && ours[0].id });
    check("the reused hook's events were converged to the app's five", ours[0] && ours[0].events.length === 5, { events: ours[0] && ours[0].events });
    const rec = (await call("listGitConnections")).connections.find((c) => c.id === state.conn2);
    check("the connection records the SAME hook id it reused", rec && String(rec.webhooks[REPO].hookId) === String(pre.id), { recorded: rec && rec.webhooks[REPO] });
  } finally { await ctx.close(); }
};

const phaseRotate = async () => {
  const beforeHooks = ghHooks().find((h) => String(h.id) === String(state.hook1));
  const { ctx, frame } = await openAdmin("Code");
  try {
    const rr = repoRow(frame, state.label1);
    await rr.locator("button", { hasText: "Rotate secret" }).click();
    await frame.locator(".dialog-confirm, button", { hasText: /^Rotate$/ }).last().click();
    await rr.locator(".code-fact", { hasText: "Secret rotated" }).waitFor({ timeout: 60000 });
    const stamp = (await rr.locator(".code-fact", { hasText: "Secret rotated" }).innerText()).trim();
    check("the Code tab shows WHEN the secret rotated (never what to)", /secret rotated/i.test(stamp) && !/[a-f0-9]{20}/.test(stamp), { stamp });
    const rec = (await call("listGitConnections")).connections.find((c) => c.id === state.conn1);
    check("the connection row carries rotatedAt", !!(rec && rec.webhooks[REPO] && rec.webhooks[REPO].rotatedAt), { recorded: rec && rec.webhooks[REPO] });

    // THE PATCH-REPLACES-CONFIG QUESTION: GitHub replaces the whole config object, so a
    // rotation that omitted url/content_type/insecure_ssl would silently unpoint or
    // unsign the hook. Read every config field back from GitHub, not just the secret.
    const after = ghHooks().find((h) => String(h.id) === String(state.hook1));
    check("after rotation the hook still exists with the same id", !!after, { hookId: state.hook1 });
    check("after rotation the hook is still SIGNED", after && after.config.secret === "********", { secret: after && after.config.secret });
    check("after rotation the payload url is unchanged", after && beforeHooks && after.config.url === beforeHooks.config.url, { urlUnchanged: !!(after && beforeHooks && after.config.url === beforeHooks.config.url) });
    check("after rotation content_type / insecure_ssl / active survive the PATCH",
      after && after.config.content_type === "json" && after.config.insecure_ssl === "0" && after.active === true,
      { contentType: after && after.config.content_type, insecureSsl: after && after.config.insecure_ssl, active: after && after.active });
    check("after rotation the five events survive the PATCH", after && after.events.length === 5, { events: after && after.events });
  } finally { await ctx.close(); }
};

const phaseListener = async () => {
  /* THE PREMADE PATH, driven exactly as an admin drives it. Two refusals are expected
     to be DIFFERENT things and this phase separates them: the missing-repositories
     refusal is the feature (the seed ships `filters.repos` empty on purpose), and
     anything else is a defect in the row or in the button that offers it. */
  const { ctx, frame } = await openAdmin("Listeners");
  const toastsFor = async (ms) => {
    const seen = new Set();
    for (let i = 0; i < ms / 250; i++) {
      for (const t of await frame.locator(".mls-toast").allInnerTexts().catch(() => [])) seen.add(t.replace(/^✕\s*/, "").trim());
      await sleep(250);
    }
    return [...seen];
  };
  try {
    await frame.locator(".lst-premade-btn", { hasText: "Review every opened PR" }).click();
    await frame.locator("#lst-name").waitFor({ timeout: 30000 });
    state.listenerName = (await frame.locator("#lst-name").inputValue()) + " " + Date.now().toString(36);
    await frame.locator("#lst-name").fill(state.listenerName);
    state.premadeSeed = {
      events: await frame.locator(".evp-row input[type=checkbox]:checked").count(),
      repos: await frame.locator("#evp-repos-input").inputValue(),
    };
    await frame.locator("button", { hasText: /^Save$/ }).click();
    const said = await toastsFor(3000);
    check("saving the premade without repositories is refused, by name",
      said.some((t) => /run per repository/i.test(t)), { said });

    await frame.locator("#evp-repos-input").fill(REPO);
    await frame.locator("#lst-name").click();
    await sleep(600);
    await frame.locator("button", { hasText: "Save & close" }).click();
    const said2 = await toastsFor(6000);
    state.premadeSaveSaid = said2; saveState();
    const savedThroughUi = said2.some((t) => /Listener saved/i.test(t));
    check("the premade PR-review listener saves through the admin panel once the repositories are named",
      savedThroughUi, { said: said2 });
    if (!savedThroughUi) {
      console.log("      The premade row could not be saved on this instance. The listener below is built from the SAME seed with `agent.allowedActions` cleared — the agentless configuration `agentlessTaskType` exists for — so the delivery half of this proof can still run. Reported as a defect, not papered over.");
    }
  } finally { await ctx.close(); }

  let rows = (await call("getListeners")).listeners || [];
  let row = rows.find((l) => l.name === state.listenerName);
  state.premadeSavedViaUi = !!row;
  if (!row) {
    // FALLBACK, named: the premade SEED, verbatim, minus the agent action the instance
    // refuses. Saved as the same admin, through the same saveListener the UI calls.
    const { PREMADE_LISTENERS } = await import("../../src/shared/premade-rules-catalog.js");
    const seed = PREMADE_LISTENERS.find((p) => p.key === "git-pr-review");
    const draft = {
      ...seed.seed, name: state.listenerName, premadeKey: seed.key,
      events: seed.events.slice(), filters: { ...seed.seed.filters, repos: [REPO] },
      agent: { ...seed.seed.agent, allowedActions: [] },
    };
    const r = await call("saveListener", { listener: draft });
    check("the same seed saves once the refused agent action is cleared (the agentless shape)", r.success === true, { error: r.error, reason: r.reason });
    rows = (await call("getListeners")).listeners || [];
    row = rows.find((l) => l.name === state.listenerName);
  }
  check("a git-pr-review listener now exists", !!row, { id: row && row.id, viaPremadeUi: state.premadeSavedViaUi });
  state.listener = row && row.id; saveState();
  const full = (await call("getListener", { id: state.listener })).listener;
  state.listenerRow = full; saveState();
  check("filters.repos holds exactly the repository the admin named", JSON.stringify((full.filters || {}).repos) === JSON.stringify([REPO]), { repos: (full.filters || {}).repos });
  check('agentlessTaskType is "gitreview"', full.agentlessTaskType === "gitreview", { agentlessTaskType: full.agentlessTaskType });
  check('savedByRole is "admin"', full.savedByRole === "admin", { savedByRole: full.savedByRole, createdBy: full.createdBy });
  check("it listens to the two pull-request events from the catalogue",
    JSON.stringify((full.events || []).slice().sort()) === JSON.stringify(["git:pull_request:opened", "git:pull_request:synchronize"]), { events: full.events });
  check("it is enabled and ignores its own writes", full.enabled !== false && full.ignoreSelf === true, { enabled: full.enabled, ignoreSelf: full.ignoreSelf });
};

const phasePr = async () => {
  const ts = Date.now();
  state.branch = `LZPT-186-live-${ts}`;
  const main = gh(["api", `/repos/${REPO}/git/ref/heads/main`]);
  gh(["api", "-X", "POST", `/repos/${REPO}/git/refs`, "--input", "-"], { ref: `refs/heads/${state.branch}`, sha: main.object.sha });
  const content = Buffer.from(`// LZPT-186 live webhook proof ${new Date(ts).toISOString()}\nexport const marker = ${ts};\n`).toString("base64");
  gh(["api", "-X", "PUT", `/repos/${REPO}/contents/harness/lzpt-186-${ts}.js`, "--input", "-"],
    { message: `LZPT-186 live webhook proof ${ts}`, content, branch: state.branch });
  const pr = gh(["api", "-X", "POST", `/repos/${REPO}/pulls`, "--input", "-"],
    { title: `LZPT-186 live webhook proof ${ts}`, head: state.branch, base: "main", body: "Opened by test-harness/scripts/git-webhook-setup-live.mjs to prove the F-460 inbound path end to end. Closed and deleted by the same script." });
  state.pr = pr.number; state.prSha = pr.head.sha; saveState();
  check("a real pull request was opened on the repository", !!pr.number, { pr: pr.number, head: pr.head.ref });

  // The DELIVERY, read from GitHub's own ledger — the app's answer, not ours.
  let del = null;
  for (let i = 0; i < 20; i++) {
    const ds = gh(["api", `/repos/${REPO}/hooks/${state.hook1}/deliveries`]);
    del = (ds || []).find((d) => d.event === "pull_request" && d.action === "opened" && new Date(d.delivered_at).getTime() >= ts - 5000);
    if (del && del.status_code) break;
    await sleep(3000);
  }
  check("GitHub delivered the pull_request/opened event and CogniRunner accepted it (202)",
    !!del && del.status_code === 202, { deliveryId: del && del.id, status: del && del.status_code, statusText: del && del.status });
  state.delivery = del && del.id; saveState();

  // The RUN. gitreview writes its own execution-log entry on every outcome.
  let log = null;
  for (let i = 0; i < 40; i++) {
    const logs = (await call("getLogs", { ruleId: state.listener })).logs || [];
    log = logs.find((l) => new Date(l.timestamp || l.createdAt || 0).getTime() >= ts - 5000);
    if (log) break;
    await sleep(5000);
  }
  check("the listener produced a run row for this delivery", !!log, { log: log && { isValid: log.isValid, reason: String(log.reason || "").slice(0, 300), ruleId: log.ruleId } });

  // What the reader of the PULL REQUEST actually sees. On our own repository a real
  // review comment is the correct outcome, not a problem — so it is READ BACK and named.
  const comments = gh(["api", `/repos/${REPO}/pulls/${state.pr}/comments`]);
  const reviews = gh(["api", `/repos/${REPO}/pulls/${state.pr}/reviews`]);
  const issueComments = gh(["api", `/repos/${REPO}/issues/${state.pr}/comments`]);
  check("the PR's review surface was read back", true, {
    inlineComments: comments.length, reviews: reviews.length, issueComments: issueComments.length,
    firstReview: reviews[0] ? { state: reviews[0].state, body: String(reviews[0].body || "").slice(0, 300) } : null,
    firstIssueComment: issueComments[0] ? String(issueComments[0].body || "").slice(0, 300) : null,
  });
};

/*
 * THE ACTOR TRAP, and why this phase exists. The first PR was opened with the SAME
 * leanzero-srl credential the connection holds, so the app did exactly what it promises:
 *   [listener] git:pull_request:opened: skipped - the actor is the connection's own identity (ignoreSelf)
 * That is correct behaviour (it is what stops a review comment from triggering another
 * review), and it is also a test-design trap: with one token there is no second actor to
 * be. So this phase turns ignoreSelf OFF on the listener - an ordinary listener setting -
 * and pushes one more commit to the open PR, which is a `synchronize` delivery on the same
 * hook. Nothing about the webhook or the connection changes.
 */
const phaseRerun = async () => {
  const ts = Date.now();
  const before = (await call("getListener", { id: state.listener })).listener;
  const r = await call("saveListener", { listener: { ...before, ignoreSelf: false } });
  check("ignoreSelf turned off for this listener so the same actor is no longer skipped", r.success === true, { ignoreSelf: r.listener && r.listener.ignoreSelf });
  await sleep(40000);  // the listener index is cached ~30s

  const content = Buffer.from(`// second commit ${new Date(ts).toISOString()}\nexport const again = ${ts};\n`).toString("base64");
  gh(["api", "-X", "PUT", `/repos/${REPO}/contents/harness/lzpt-186-again-${ts}.js`, "--input", "-"],
    { message: `LZPT-186 second commit ${ts}`, content, branch: state.branch });
  check("a second commit was pushed to the open pull request", true, { branch: state.branch });

  let del = null;
  for (let i = 0; i < 20; i++) {
    const ds = gh(["api", `/repos/${REPO}/hooks/${state.hook1}/deliveries`]);
    del = (ds || []).find((d) => d.event === "pull_request" && d.action === "synchronize" && new Date(d.delivered_at).getTime() >= ts - 5000);
    if (del && del.status_code) break;
    await sleep(3000);
  }
  check("GitHub delivered pull_request/synchronize and CogniRunner accepted it (202)", !!del && del.status_code === 202,
    { deliveryId: del && del.id, status: del && del.status_code });

  let log = null;
  for (let i = 0; i < 48; i++) {
    const logs = (await call("getLogs", { ruleId: state.listener })).logs || [];
    log = logs.find((l) => new Date(l.timestamp || l.createdAt || 0).getTime() >= ts - 5000);
    if (log) break;
    await sleep(5000);
  }
  state.reviewLog = log; saveState();
  check("the gitreview run wrote an execution-log row with a named result", !!log,
    { isValid: log && log.isValid, reason: log && String(log.reason || "").slice(0, 400) });

  const comments = gh(["api", `/repos/${REPO}/pulls/${state.pr}/comments`]);
  const reviews = gh(["api", `/repos/${REPO}/pulls/${state.pr}/reviews`]);
  const issueComments = gh(["api", `/repos/${REPO}/issues/${state.pr}/comments`]);
  check("the pull request's own review surface was read back from GitHub", true, {
    inlineComments: comments.length, reviews: reviews.length, issueComments: issueComments.length,
    firstReview: reviews[0] ? { state: reviews[0].state, user: reviews[0].user && reviews[0].user.login, body: String(reviews[0].body || "").slice(0, 400) } : null,
    firstIssueComment: issueComments[0] ? String(issueComments[0].body || "").slice(0, 400) : null,
  });
};

/* The ADVISORY issue property the delivery wrote on LZPT-186 - "1 issue propert(ies)
 * written" in the log is our own count, so it is read back from JIRA, which is where a
 * workflow condition would read it. */
const phaseProperty = async () => {
  const { get } = await import("../lib/jira.mjs");
  let prop = null;
  try { prop = await get("/rest/api/3/issue/LZPT-186/properties/cognirunner.git"); } catch (e) { prop = { error: e.status }; }
  const repoEntry = prop && prop.value && prop.value.repos && prop.value.repos[REPO];
  check("the delivery wrote the advisory cognirunner.git property on LZPT-186, naming this PR",
    !!repoEntry && Number(repoEntry.pr && repoEntry.pr.number) === Number(state.pr),
    { property: repoEntry || prop });
};

/*
 * CLEANUP IS AN ASSERTION, NOT A COURTESY.
 *
 * WHAT WENT WRONG BEFORE: this phase clicked the Code tab and read `card.count()` in the
 * very next statement. The React tab had not rendered yet, so the count was 0, the delete
 * was skipped, and the phase still reported OK — the connection had to be removed BY HAND
 * after the run. `count()` NEVER waits; it is a snapshot. Only `waitFor`/`expect` retry.
 *
 * THE RULE THIS PHASE NOW FOLLOWS, end to end:
 *   1. WAIT for the thing before concluding it is absent — bounded `.waitFor({ timeout })`,
 *      the same pattern the setup phase already uses for `.code-conn-label` / `.code-hook.set`.
 *   2. PROVE BY A SECOND READ, never by the DOM and never by a resolver's own `removed:true`:
 *      `listGitConnections` through the dev hook, and `gh api /repos/…/hooks` on GitHub.
 *   3. PROVE THE NEGATIVE ON THE SAME OBJECT. Before deleting, show that the read which will
 *      later report "gone" can SEE this exact connection while it still lives — otherwise
 *      "listGitConnections is empty" might only mean the read is broken.
 *   4. FAIL LOUD. Any residue is `check(..., false)`, so the phase exits non-zero with the
 *      phase named; a cleanup that no-ops can never read as a pass again.
 */
const phaseCleanup = async () => {
  const done = [];
  const labels = [state.label1, state.label2].filter(Boolean);
  const hookIds = [state.hook1, state.hookPre].filter(Boolean).map(String);

  /* ── the POSITIVE CONTROL, first: can the reads that will judge "gone" see these now? ── */
  const connsBefore = (await call("listGitConnections")).connections || [];
  if (labels.length) {
    const visible = labels.filter((l) => connsBefore.some((c) => c.label === l));
    check("cleanup: listGitConnections can SEE the connections this run created (the control every \"gone\" below rests on)",
      visible.length === labels.length, { expected: labels, visible, totalRows: connsBefore.length });
  }
  const hooksBefore = ghHooks();
  if (hookIds.length) {
    const visible = hookIds.filter((id) => hooksBefore.some((h) => String(h.id) === id));
    check("cleanup: GitHub can SEE the webhooks this run created before the delete",
      visible.length === hookIds.length, { expected: hookIds, visible, totalOnRepo: hooksBefore.length });
  }

  if (state.pr) { try { gh(["api", "-X", "PATCH", `/repos/${REPO}/pulls/${state.pr}`, "--input", "-"], { state: "closed" }); done.push(`pr#${state.pr} closed`); } catch (e) { done.push(`pr close failed: ${e.message.slice(0, 120)}`); } }
  if (state.branch) { try { execFileSync("gh", ["api", "-X", "DELETE", `/repos/${REPO}/git/refs/heads/${state.branch}`], { env: process.env }); done.push("branch deleted"); } catch (e) { done.push(`branch delete failed: ${e.message.slice(0, 120)}`); } }
  for (const id of [state.hook1, state.hookPre]) {
    if (!id) continue;
    try { execFileSync("gh", ["api", "-X", "DELETE", `/repos/${REPO}/hooks/${id}`], { env: process.env }); done.push(`hook ${id} deleted`); } catch (e) { done.push(`hook ${id} delete: ${e.message.slice(0, 120)}`); }
  }
  if (state.listener) { try { await call("deleteListener", { id: state.listener }); done.push("listener deleted"); } catch (e) { done.push(`listener: ${e.message.slice(0, 120)}`); } }
  // The connections go through the UI, because deleteGitConnection is not on the hook's
  // allow-list either — the same rule that kept the write half out of the harness.
  const clicked = [];
  if (labels.length) {
    const { ctx, frame } = await openAdmin("Code");
    try {
      // THE TAB MUST RENDER BEFORE ANYTHING IS COUNTED. Wait for the Code tab's own list
      // to resolve to one of its three terminal states (rows / empty / load error) before
      // asking any question about a card. This is the line whose absence broke cleanup.
      await frame.locator(".code-conns, .empty-state, .load-error").first()
        .waitFor({ state: "visible", timeout: 60000 }).catch(() => {});
      for (const label of labels) {
        const card = frame.locator(".code-conn").filter({ has: frame.locator(".code-conn-label", { hasText: label }) });
        let rendered = true;
        try { await card.first().waitFor({ state: "visible", timeout: 30000 }); } catch { rendered = false; }
        if (!rendered) {
          // NOT "nothing to do". The app's own read said this connection exists, so a card
          // that never appears is a finding, not a shortcut past the delete.
          const stillThere = connsBefore.some((c) => c.label === label);
          check(`cleanup: the Code tab rendered the connection card for "${label}" so it could be deleted`,
            !stillThere, { label, listGitConnectionsSawIt: stillThere });
          done.push(`connection "${label}": card never rendered — NOT deleted`);
          continue;
        }
        await card.locator(".code-conn-actions button.btn-danger").click();
        // The app's OWN dialog (static/admin-panel/src/confirmDialog.js) - there is no
        // native confirm anywhere in this app, so the confirm is `.cr-confirm .btn-danger`.
        await frame.locator(".cr-confirm-actions button.btn-danger").click();
        let detached = true;
        try { await card.waitFor({ state: "detached", timeout: 30000 }); } catch { detached = false; }
        clicked.push(label);
        // The DOM is only ever a hint here; the verdict is the second read below.
        done.push(`connection "${label}": delete clicked (card detached: ${detached})`);
      }
    } finally { await ctx.close(); }
  }

  /* ── THE SECOND READ — through the app and through GitHub, never through the DOM ───── */
  const conns = (await call("listGitConnections")).connections || [];
  const connResidue = labels.filter((l) => conns.some((c) => c.label === l));
  check("cleanup: every connection this run created is gone from listGitConnections",
    connResidue.length === 0,
    { stillPresent: connResidue, clicked, otherRowsNotOurs: conns.filter((c) => !labels.includes(c.label)).map((c) => c.label) });

  const hooks = ghHooks();
  const hookResidue = hookIds.filter((id) => hooks.some((h) => String(h.id) === id));
  // Also by URL: a hook still pointing at one of our connections is residue even if its id
  // is not one we recorded (a retried setup can have created a row we never saw).
  const urlResidue = hooks.filter((h) => h.config && [state.conn1, state.conn2].filter(Boolean).some((c) => h.config.url === hookUrl(c)));
  check("cleanup: every GitHub webhook this run created is gone from the repository",
    hookResidue.length === 0 && urlResidue.length === 0,
    { stillPresentById: hookResidue, stillPointingAtOurConnections: urlResidue.length, totalOnRepo: hooks.length });

  const listeners = (await call("getListeners")).listeners || [];
  check("cleanup: the premade listener is gone from getListeners",
    !state.listener || !listeners.some((l) => l.id === state.listener), { listener: state.listener });

  console.log("CLEANUP", JSON.stringify(done, null, 2));
  if (failures) {
    console.error('\nCLEANUP FAILED — phase "cleanup" left residue on the instance or on the repository.');
    console.error("Read the FAIL lines above: whatever is named there is still live and must be removed before the next run.");
  }
};

const PHASES = { setup: phaseSetup, idem: phaseIdem, rotate: phaseRotate, listener: phaseListener, pr: phasePr, rerun: phaseRerun, property: phaseProperty, cleanup: phaseCleanup };
const name = process.argv[2];
if (!PHASES[name]) { console.error(`phase required, one of: ${Object.keys(PHASES).join(", ")}`); process.exit(2); }
if (!TRIGGER && name !== "listener") { console.error("GIT_WEBHOOK_URL is required (and is a secret — keep it out of the repo)."); process.exit(2); }
if (!process.env.GH_TOKEN) { console.error("GH_TOKEN is required in the environment."); process.exit(2); }
try { await PHASES[name](); } catch (e) { console.error("THREW", e.stack); failures += 1; }
saveState();
console.log(`\n${name}: ${failures} failure(s). State: ${STATE}`);
process.exit(failures ? 1 : 0);
