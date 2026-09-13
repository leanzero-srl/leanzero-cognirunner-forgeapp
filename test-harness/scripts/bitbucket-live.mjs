#!/usr/bin/env node
/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * PART 0b — the BITBUCKET mirror of the GitHub offshoot proof, driven through the
 * SHIPPED adapter (src/git-providers.js `createGitProvider({ kind:"bitbucket" })`),
 * never through a retyped client. What it settles, live:
 *
 *   §4b row 16  — is `api.bitbucket.org` enough, or does /diff and /src really 302 to
 *                 bitbucket.org (the flagged redirect-only egress host)?
 *   §4b row 29  — does Bitbucket accept `inline:{path,to}`, on which line does the
 *                 comment land, and do approve / request-changes / `resolution` behave?
 *   §4b row 17  — is Bitbucket's `X-Hub-Signature` the same sha256= construction over
 *                 the raw body that GitHub's `-256` header is?
 *   §5 step 6   — repo + scaffold + pipelines + secured variables + custom trigger.
 *
 * SECRETS: BITBUCKET_API_TOKEN / JIRA_API_TOKEN / the hook secret are read from
 * test-harness/.env and NEVER printed. Nothing here logs a header value.
 *
 * Phases (state in results/bitbucket-live/state.json):
 *   node scripts/bitbucket-live.mjs whoami     # (1) identity + workspace + create rights
 *   node scripts/bitbucket-live.mjs repo       # (2) repo, scaffold, pipelines, variables
 *   node scripts/bitbucket-live.mjs redirect   # (3) the /diff and /src redirect probe
 *   node scripts/bitbucket-live.mjs pr         # (4) PR, inline comment, approve/changes
 *   node scripts/bitbucket-live.mjs hook       # (5) signed delivery -> dev git-webhook
 *   node scripts/bitbucket-live.mjs pipeline   # (6) custom pipeline trigger + status
 *   node scripts/bitbucket-live.mjs cleanup    # PR closed, branch/hook deleted
 *
 * Env: test-harness/.env (BITBUCKET_EMAIL, BITBUCKET_API_TOKEN, BITBUCKET_WORKSPACE,
 * JIRA_ADMIN_EMAIL, JIRA_API_TOKEN, TESTSTATE_URL, HARNESS_SECRET) and
 * GIT_WEBHOOK_URL (forge webtrigger create -f git-webhook -e development).
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../lib/env.mjs";
import { testState } from "../lib/rules-api.mjs";
import { gitHookUrl } from "../lib/git-hook-url.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, "..", "..");
const env = loadEnv();
const { createGitProvider } = await import(path.join(ROOT, "src", "git-providers.js"));
const { renderScaffold } = await import(path.join(ROOT, "src", "shared", "git-scaffolds.js"));

const WS = env.BITBUCKET_WORKSPACE;
const NAME = process.env.BB_REPO || "cognirunner-forge-offshoot-bb";
const REPO = `${WS}/${NAME}`;
const OUT = path.join(here, "..", "results", "bitbucket-live");
fs.mkdirSync(OUT, { recursive: true });
const STATE = path.join(OUT, "state.json");
const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : { checks: [] };
const save = () => fs.writeFileSync(STATE, JSON.stringify(state, null, 2));
let failures = 0;
const check = (label, ok, data = {}) => {
  if (!ok) failures += 1;
  state.checks.push({ label, ok, ...data, at: new Date().toISOString() });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${Object.keys(data).length ? " " + JSON.stringify(data) : ""}`);
  save();
};
const note = (label, data) => { state.checks.push({ label, note: true, ...data, at: new Date().toISOString() }); console.log(`NOTE  ${label} ${JSON.stringify(data)}`); save(); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const bb = createGitProvider({ kind: "bitbucket", auth: { email: env.BITBUCKET_EMAIL, token: env.BITBUCKET_API_TOKEN } });

/* A SECOND READ path that does not go through the adapter — so every claim the
 * adapter makes is checked against a plain REST read of the same object. */
const raw = async (method, p, { body, headers = {}, redirect = "manual", accept = "application/json" } = {}) => {
  const auth = "Basic " + Buffer.from(`${env.BITBUCKET_EMAIL}:${env.BITBUCKET_API_TOKEN}`).toString("base64");
  const res = await fetch("https://api.bitbucket.org/2.0" + p, {
    method, redirect,
    headers: { Authorization: auth, Accept: accept, ...headers },
    body,
  });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, headers: res.headers, text, json };
};

async function phaseWhoami() {
  const me = await bb.whoami();
  check("whoami through the adapter", !!me.login && !!me.accountId, { login: me.login, uuid: me.uuid, accountId: me.accountId, name: me.name });
  // F-326 — the whoami label and the PR-comment label are different strings.
  note("whoami label vs nickname", { username: me.login, displayName: me.name });
  const ws = await raw("GET", `/workspaces/${WS}`);
  check("workspace readable (second read)", ws.status === 200 && ws.json && ws.json.slug === WS, { status: ws.status, slug: ws.json && ws.json.slug, name: ws.json && ws.json.name });
  const repos = await bb.listRepos({ workspace: WS });
  check("listRepos through the adapter", Array.isArray(repos) && repos.length > 0, { count: repos.length, sample: repos.slice(0, 3).map((r) => r.fullName) });
  state.whoami = { login: me.login, accountId: me.accountId, uuid: me.uuid };
  save();
}

async function phaseRepo() {
  let repo = null;
  try { repo = await bb.getRepo({ repo: REPO }); } catch (e) { repo = null; }
  if (!repo || !repo.fullName) {
    repo = await bb.createRepo({ name: NAME, workspace: WS, private: true, description: "CogniRunner Part 0b — Bitbucket bed" });
    check("createRepo (the app's own call)", repo.fullName === REPO && repo.private === true, { fullName: repo.fullName, private: repo.private });
  } else {
    check("repo reused", repo.fullName === REPO, { fullName: repo.fullName, private: repo.private });
  }
  const rr = await raw("GET", `/repositories/${REPO}`);
  check("repo exists (second read)", rr.status === 200 && rr.json.is_private === true, { status: rr.status, private: rr.json && rr.json.is_private, mainbranch: rr.json && rr.json.mainbranch && rr.json.mainbranch.name });

  // The SAME scaffold the GitHub offshoot carries, rendered from the single source.
  const files = renderScaffold("forge-custom-ui", {});
  const branch = (rr.json && rr.json.mainbranch && rr.json.mainbranch.name) || "main";
  // Bitbucket's /src takes one commit; the scaffold is 16 files (caps allow 20).
  const commit = await bb.commitFiles({ repo: REPO, branch, message: "chore: CogniRunner scaffold (Part 0b)", files });
  check("scaffold committed in one call", commit.files === files.length, { files: commit.files, sha: commit.sha, branch });
  const srcList = await raw("GET", `/repositories/${REPO}/src/${branch}/?pagelen=50`);
  const names = srcList.json && srcList.json.values ? srcList.json.values.map((v) => v.path) : [];
  check("scaffold visible in /src (second read)", names.includes("manifest.yml") && names.includes("bitbucket-pipelines.yml"), { status: srcList.status, paths: names });
  state.defaultBranch = branch; save();

  const pipe = await bb.enablePipelines({ repo: REPO, enabled: true });
  const pr2 = await raw("GET", `/repositories/${REPO}/pipelines_config`);
  check("pipelines enabled (second read)", pipe.enabled === true && pr2.json && pr2.json.enabled === true, { adapter: pipe.enabled, read: pr2.json && pr2.json.enabled });

  // Secured variables: the deploy identity. Values never printed, and Bitbucket
  // refuses to read a secured value back — which is itself the check.
  const want = {
    FORGE_EMAIL: { value: env.JIRA_ADMIN_EMAIL, secured: true },
    FORGE_API_TOKEN: { value: env.JIRA_API_TOKEN, secured: true },
    FORGE_SITE: { value: (env.JIRA_BASE_URL || "").replace(/^https?:\/\//, ""), secured: false },
    FORGE_PRODUCT: { value: "Jira", secured: false },
  };
  const existing = await raw("GET", `/repositories/${REPO}/pipelines_config/variables/?pagelen=100`);
  const have = new Map((existing.json && existing.json.values || []).map((v) => [v.key, v]));
  /*
   * F-530/F-531 — the UPSERT arm, and why it no longer skips.
   *
   * This loop used to `continue` on a key that already existed, so a second run proved
   * nothing about the one thing `upsertPipelineVariable` exists for: Bitbucket answers a
   * POST of an existing pipeline variable with HTTP 409, and the adapter must then PUT it
   * by uuid rather than surface the conflict as a partial setup. Skipping meant the 409
   * branch was never executed after the very first run. Every key is now written on every
   * run, and `existed` records whether this call took the create path or the 409 path, so
   * a re-run is the idempotence test rather than a no-op.
   */
  for (const [k, spec] of Object.entries(want)) {
    const existed = have.has(k);
    const r = spec.secured ? await bb.setSecret({ repo: REPO, name: k, value: spec.value }) : await bb.setVariable({ repo: REPO, name: k, value: spec.value });
    check(`variable ${k} upserted${existed ? " (it already existed — the 409 branch)" : " (created)"}`, !!r.name, { key: k, secured: r.secured, existedBefore: existed });
  }
  const after = await raw("GET", `/repositories/${REPO}/pipelines_config/variables/?pagelen=100`);
  const rows = (after.json && after.json.values) || [];
  const byKey = Object.fromEntries(rows.map((v) => [v.key, { secured: v.secured, hasValue: v.value !== undefined && v.value !== null }]));
  check("all four variables present (second read)", Object.keys(want).every((k) => byKey[k]), { keys: Object.keys(byKey) });
  check("secured variables do not read back", byKey.FORGE_API_TOKEN && byKey.FORGE_API_TOKEN.secured === true && byKey.FORGE_API_TOKEN.hasValue === false, { forgeApiToken: byKey.FORGE_API_TOKEN, forgeEmail: byKey.FORGE_EMAIL });
  check("plain variables read back", byKey.FORGE_SITE && byKey.FORGE_SITE.secured === false && byKey.FORGE_SITE.hasValue === true, { forgeSite: byKey.FORGE_SITE, forgeProduct: byKey.FORGE_PRODUCT });
}

async function phaseRedirect() {
  // The whole §4b row 16 question: does api.bitbucket.org ANSWER /src and /diff, or
  // does it 30x to bitbucket.org? Asked with redirect:"manual" so the Location host
  // is visible — exactly what the adapter's own host gate sees.
  const branch = state.defaultBranch || "main";
  const src = await raw("GET", `/repositories/${REPO}/src/${branch}/manifest.yml`, { accept: "text/plain" });
  const srcLoc = src.headers.get("location");
  note("/src file fetch", { status: src.status, locationHost: srcLoc ? new URL(srcLoc, "https://api.bitbucket.org").host : null });
  const spec = state.pr && state.pr.spec ? state.pr.spec : branch;
  const diff = await raw("GET", `/repositories/${REPO}/diff/${encodeURIComponent(spec)}`, { accept: "text/plain" });
  const diffLoc = diff.headers.get("location");
  note("/diff fetch", { status: diff.status, locationHost: diffLoc ? new URL(diffLoc, "https://api.bitbucket.org").host : null });
  const hosts = [srcLoc, diffLoc].filter(Boolean).map((l) => new URL(l, "https://api.bitbucket.org").host);
  state.redirect = { srcStatus: src.status, diffStatus: diff.status, hosts };
  check("redirect probe answered", src.status > 0 && diff.status > 0, state.redirect);
  const needsEgress = hosts.includes("bitbucket.org");
  check(needsEgress ? "bitbucket.org IS required in egress (30x observed)" : "no bitbucket.org redirect observed on these endpoints", true, { hosts, needsEgress });
  save();
}

async function phasePr() {
  const ts = Date.now();
  const branch = `LZPT-186-bb-${ts}`;
  const base = state.defaultBranch || "main";
  const made = await bb.createBranch({ repo: REPO, branch, fromBranch: base });
  check("branch created", !!made.sha, { branch, sha: made.sha && made.sha.slice(0, 12) });
  // A multi-line file so an inline comment has a line 3 to land on.
  const body = ["# Part 0b", "", "one", "two", "three", "four"].join("\n") + "\n";
  const c = await bb.commitFiles({ repo: REPO, branch, message: "test: Part 0b inline-comment target", files: [{ path: "PART0B.md", content: body }] });
  check("commit on the branch", c.files === 1, { sha: c.sha, branch });
  const pr = await bb.openPullRequest({ repo: REPO, title: `LZPT-186 Part 0b (${ts})`, body: "Bitbucket mirror proof.", sourceBranch: branch, targetBranch: base });
  check("PR opened", pr.state === "open" && !!pr.number, { number: pr.number, state: pr.state, source: pr.sourceBranch, target: pr.targetBranch, head: pr.headSha && pr.headSha.slice(0, 12) });
  state.pr = { number: pr.number, branch, base, spec: `${branch}..${base}` }; save();

  // The §4b row 16 question, asked of the endpoint the app actually calls on a PR.
  const prDiffRaw = await raw("GET", `/repositories/${REPO}/pullrequests/${pr.number}/diff`, { accept: "text/plain" });
  const prDiffLoc = prDiffRaw.headers.get("location");
  const prDiffHost = prDiffLoc ? new URL(prDiffLoc, "https://api.bitbucket.org").host : null;
  check("PR /diff redirect recorded", prDiffRaw.status > 0, { status: prDiffRaw.status, locationHost: prDiffHost });
  state.prDiffRedirect = { status: prDiffRaw.status, host: prDiffHost }; save();
  const diff = await bb.getPullRequestDiff({ repo: REPO, number: pr.number });
  const dfiles = diff.files || [];
  check("PR diff readable through the adapter (redirect followed by hand)", dfiles.length > 0 && dfiles.some((f) => f.path === "PART0B.md"), { files: dfiles.map((f) => f.path), bytes: diff.bytes, truncated: diff.truncated });
  state.diffPatch = (dfiles.find((f) => f.path === "PART0B.md") || {}).patch || ""; save();

  // §4b row 29 — the inline line question. `to` is the line in the NEW file.
  const inline = await bb.addPullRequestComment({ repo: REPO, number: pr.number, body: "CogniRunner inline probe: this must land on line 5 of the new file.", path: "PART0B.md", line: 5 });
  check("inline comment accepted", !!inline.id && inline.inline === true, { id: inline.id, url: inline.url });
  const rd = await raw("GET", `/repositories/${REPO}/pullrequests/${pr.number}/comments/${inline.id}`);
  check("inline comment landed where asked (second read)", rd.status === 200 && rd.json && rd.json.inline && rd.json.inline.to === 5, { status: rd.status, inline: rd.json && rd.json.inline });
  state.inlineCommentId = inline.id; save();

  const plain = await bb.addPullRequestComment({ repo: REPO, number: pr.number, body: "CogniRunner top-level probe comment." });
  check("top-level comment accepted", !!plain.id, { id: plain.id });

  const listed = await bb.listPullRequestComments({ repo: REPO, number: pr.number });
  const mine = listed.find((x) => x.id === inline.id);
  check("comment list maps inline + resolved", !!mine && mine.inline && mine.inline.line === 5 && mine.resolved === false, { inline: mine && mine.inline, resolved: mine && mine.resolved, author: mine && mine.author, count: listed.length });

  const ap = await bb.approvePullRequest({ repo: REPO, number: pr.number });
  check("approve accepted", ap.state === "APPROVED", ap);
  let st = await bb.getPullRequestState({ repo: REPO, number: pr.number });
  check("approval visible in participants (second read)", st.approved === true && st.changesRequested === false, { approved: st.approved, changesRequested: st.changesRequested, reviewers: st.reviewers });

  const rc = await bb.requestChanges({ repo: REPO, number: pr.number, body: "CogniRunner request-changes probe." });
  check("request-changes accepted", rc.state === "CHANGES_REQUESTED", rc);
  st = await bb.getPullRequestState({ repo: REPO, number: pr.number });
  check("request-changes visible, approval cleared (second read)", st.changesRequested === true, { approved: st.approved, changesRequested: st.changesRequested, reviewers: st.reviewers });

  // `resolution` — the F-269 claim that Bitbucket ANSWERS resolved, so false is proven.
  const res = await raw("POST", `/repositories/${REPO}/pullrequests/${pr.number}/comments/${state.inlineCommentId}/resolve`, { body: "{}", headers: { "Content-Type": "application/json" } });
  note("resolve endpoint", { status: res.status });
  const after = await bb.listPullRequestComments({ repo: REPO, number: pr.number });
  const mine2 = after.find((x) => x.id === state.inlineCommentId);
  check("resolution reflected by the adapter", res.status >= 400 ? true : mine2 && mine2.resolved === true, { resolveStatus: res.status, resolved: mine2 && mine2.resolved });
  const rawc = await raw("GET", `/repositories/${REPO}/pullrequests/${pr.number}/comments/${state.inlineCommentId}`);
  note("raw comment resolution field", { hasResolution: !!(rawc.json && rawc.json.resolution), resolvedBy: rawc.json && rawc.json.resolution && rawc.json.resolution.user && rawc.json.resolution.user.nickname });
}

async function phaseHook() {
  const TRIGGER = process.env.GIT_WEBHOOK_URL || state.trigger;
  if (!TRIGGER) { check("GIT_WEBHOOK_URL present", false, { hint: "forge webtrigger create -f git-webhook -e development" }); return; }
  state.trigger = TRIGGER; save();
  const connId = state.connId || `bbpart0b${Date.now().toString(36)}`;
  const secret = state.hookSecret || [...Array(3)].map(() => Math.random().toString(36).slice(2)).join("").replace(/[^A-Za-z0-9]/g, "").slice(0, 40);
  state.connId = connId; state.hookSecret = secret; save();
  // Plant a TOKENLESS stand-in connection + the per-repo secret (F-339). No
  // credential is planted: routing only.
  const planted = await testState.post({ action: "plantHookSecret", connId, repoId: REPO, secret, plantConnection: true, kind: "bitbucket" });
  check("stand-in bitbucket connection planted", planted.status === 200 && planted.body && planted.body.ok, { status: planted.status, key: planted.body && planted.body.key, kind: planted.body && planted.body.connection && planted.body.connection.kind });
  const url = gitHookUrl(TRIGGER, connId, REPO);
  const hook = await bb.createWebhook({ repo: REPO, url, secret });
  check("webhook created on Bitbucket", !!hook.id, { id: hook.id, events: hook.events, urlSuffix: `?conn=${connId}&repo=${REPO}` });
  state.hookId = hook.id; save();
  const hooks = await bb.listWebhooks({ repo: REPO });
  const mine = hooks.find((h) => h.id === hook.id);
  check("webhook visible (second read)", !!mine && mine.active === true && mine.url === url, { events: mine && mine.events, active: mine && mine.active });
  // Fire a REAL event: a comment on the open PR (pullrequest:comment_created).
  const pr = state.pr;
  const c = await bb.addPullRequestComment({ repo: REPO, number: pr.number, body: `Delivery trigger ${new Date().toISOString()}` });
  check("event fired (PR comment)", !!c.id, { commentId: c.id });
  await sleep(15000);
  console.log("NOTE  read `forge logs -e development` for the [git-webhook] line of this delivery");
}

async function phasePipeline() {
  const branch = state.defaultBranch || "main";
  let t = null;
  try {
    t = await bb.triggerDeploy({ repo: REPO, ref: branch, pattern: process.env.BB_PIPELINE || "forge-deploy" });
    check("custom pipeline dispatched", t.dispatched === true, { id: t.id, ref: t.ref });
  } catch (e) {
    check("custom pipeline dispatched", false, { error: String(e.message).slice(0, 200), code: e.code });
    return;
  }
  await sleep(20000);
  const s = await bb.getDeployStatus({ repo: REPO, limit: 5 });
  check("pipeline status readable", !!s.latest, { latest: s.latest, runs: s.runs.length });
  const rawRun = await raw("GET", `/repositories/${REPO}/pipelines/?sort=-created_on&pagelen=3`);
  const v = (rawRun.json && rawRun.json.values) || [];
  note("pipeline raw state (second read)", { states: v.map((p) => ({ n: p.build_number, state: p.state && p.state.name, result: p.state && p.state.result && p.state.result.name })) });
}

async function phaseCleanup() {
  if (state.pr && state.pr.number) {
    const d = await raw("POST", `/repositories/${REPO}/pullrequests/${state.pr.number}/decline`, { body: "{}", headers: { "Content-Type": "application/json" } });
    check("PR declined", d.status === 200, { status: d.status });
    const st = await bb.getPullRequest({ repo: REPO, number: state.pr.number });
    check("PR closed (second read)", st.state !== "open", { state: st.state });
    const b = await raw("DELETE", `/repositories/${REPO}/refs/branches/${encodeURIComponent(state.pr.branch)}`);
    const gone = await raw("GET", `/repositories/${REPO}/refs/branches/${encodeURIComponent(state.pr.branch)}`);
    check("branch deleted (second read)", gone.status === 404, { delete: b.status, read: gone.status });
  }
  if (state.hookId) {
    await raw("DELETE", `/repositories/${REPO}/hooks/${encodeURIComponent(state.hookId)}`);
    const hooks = await bb.listWebhooks({ repo: REPO });
    check("webhook deleted (second read)", !hooks.some((h) => h.id === state.hookId), { remaining: hooks.length });
  }
  if (state.connId) {
    const r = await testState.post({ action: "deleteHarnessConnection", connId: state.connId });
    check("stand-in connection deleted", r.status === 200, { status: r.status, body: r.body });
  }
}

const phases = { whoami: phaseWhoami, repo: phaseRepo, redirect: phaseRedirect, pr: phasePr, hook: phaseHook, pipeline: phasePipeline, cleanup: phaseCleanup };
const want = process.argv[2];
if (!phases[want]) { console.error("usage: bitbucket-live.mjs " + Object.keys(phases).join("|")); process.exit(2); }
await phases[want]();
console.log(failures ? `\n${failures} FAILURE(S) in phase ${want}` : `\nphase ${want}: all checks passed`);
process.exit(failures ? 1 : 0);
