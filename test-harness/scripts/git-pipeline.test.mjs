/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Offline: PIPELINE SETUP (1.4 commit 7) — the admin resolvers in src/index.js and
// their one home, src/git-pipeline.js, driven through the REAL resolver handler on a
// mock KVS and a stubbed global fetch.
//
// What this file is here to prove, in order of how badly it would hurt:
//  1. THE PERMISSION LOCK REFUSES. A manifest whose scopes differ from the lock this
//     app recorded is refused BY SCOPE NAME, and — the commitImportCore rule — the
//     refusal happens before a single secret is written or a byte committed.
//  2. NO SECRET ANYWHERE. The Forge API token is deep-scanned out of every resolver
//     return AND out of the stored `git_pipeline:*` row.
//  3. Setup is ADMIN. An editor gets `needsRole:"admin"` through the one refusal shape.
//  4. A missing deploy identity refuses with the one vocabulary (reason/code/hint).
//  5. The claim is RELEASED when the chain fails, so the queue's retry is not swallowed.
//  6. A second run of the SAME manifest is idempotent, not a second install.
//
// Run: node scripts/git-pipeline.test.mjs   (auto-discovered by run-offline.mjs)

import "../lib/register-mocks-index.mjs";
import storage from "../lib/mock-kvs.mjs";
import { pushed as pushedEvents } from "../lib/mock-forge-api.mjs";

const conns = await import("../../src/git-connections.js");
const pipe = await import("../../src/git-pipeline.js");
const { handler } = await import("../../src/index.js");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const ADMIN = "acct-admin";
const EDITOR = "acct-editor";

/* ---- the planted secrets. Nothing may echo any of these. ---- */
const GH_TOKEN = "ghp_PLANTED_CONNECTION_TOKEN_0123456789";
const FORGE_TOKEN = "ATATT_PLANTED_FORGE_API_TOKEN_abcdefghij";
const SECRETS = [GH_TOKEN, FORGE_TOKEN];

const REPO = "acme/forge-app";
const SITE = "acme.atlassian.net";

const MANIFEST = [
  "modules:",
  "  jira:globalPage:",
  "    - key: page",
  "permissions:",
  "  scopes:",
  "    - read:jira-work",
  "    - write:jira-work",
  "    - storage:app",
  "resources:",
  "  - key: main",
].join("\n");

// Same app, one EXTRA scope — the thing the lock exists to refuse.
const MANIFEST_WIDENED = MANIFEST.replace("    - storage:app", "    - storage:app\n    - manage:jira-configuration");
// A scope the allow-list does not carry at all.
const MANIFEST_FORBIDDEN = MANIFEST.replace("    - storage:app", "    - storage:app\n    - manage:app-access-rule");

/* ---- stubbed fetch: a scripted queue of responses ---- */
let fetchQueue = [];
let fetchCalls = [];
const res = (status, body, headers = {}) => ({
  status,
  headers: { get: (k) => headers[String(k).toLowerCase()] ?? null },
  async json() { return body; },
  async text() { return JSON.stringify(body); },
});
globalThis.fetch = async (url, init) => {
  fetchCalls.push({ url: String(url), method: (init && init.method) || "GET", body: init && init.body });
  if (!fetchQueue.length) throw new Error("unexpected fetch: " + url);
  const next = fetchQueue.shift();
  if (next instanceof Error) throw next;
  return next;
};
const whoamiOk = () => res(200, { login: "leanzero-bot", id: 42 }, { "x-oauth-scopes": "repo, workflow" });

/**
 * The GitHub chain a successful setup makes, in order:
 *   setSecret ×2  = (GET public-key, PUT secret) ×2
 *   setVariable ×3 = POST (created)
 *   commitFiles    = GET ref, GET commit, POST tree, POST commit, PATCH ref
 * plus one GET repo for the default branch.
 */
const githubSetupChain = () => [
  res(200, { key: Buffer.alloc(32, 7).toString("base64"), key_id: "kid" }), // public key
  res(201, {}),                                                             // PUT FORGE_EMAIL
  res(200, { key: Buffer.alloc(32, 7).toString("base64"), key_id: "kid" }),
  res(201, {}),                                                             // PUT FORGE_API_TOKEN
  res(201, {}), res(201, {}), res(201, {}),                                 // 3 variables
  res(200, { default_branch: "main", full_name: REPO }),                    // getDefaultBranch
  res(200, { object: { sha: "parentsha" } }),                               // ref
  res(200, { tree: { sha: "treesha" } }),                                   // parent commit
  res(201, { sha: "newtree" }),                                             // tree
  res(201, { sha: "commitsha" }),                                           // commit
  res(200, {}),                                                             // ref update
];

const reset = () => {
  storage.__reset();
  storage.__seed("app_admins", [
    { accountId: ADMIN, displayName: "Admin", role: "admin", scope: "all" },
    { accountId: EDITOR, displayName: "Editor", role: "editor", scope: "all" },
  ]);
  fetchQueue = [];
  fetchCalls = [];
  pushedEvents.length = 0;
};
const call = (functionKey, payload = {}, accountId = ADMIN) =>
  handler({ call: { functionKey, payload } }, { principal: { accountId } });

function findSecret(value, needle, path = "$") {
  if (typeof value === "string") return value.includes(needle) ? path : null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = findSecret(value[i], needle, `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const k of Object.keys(value)) {
      if (k.includes(needle)) return `${path}.${k} (key)`;
      const hit = findSecret(value[k], needle, `${path}.${k}`);
      if (hit) return hit;
    }
    return null;
  }
  return null;
}

/** A live connection with REPO on its allow-list, plus a consented deploy identity. */
async function seedConnection({ identity = true } = {}) {
  fetchQueue = [whoamiOk()];
  const saved = await call("saveGitConnection", { kind: "github", label: "acme", token: GH_TOKEN, repos: [REPO] });
  if (!saved.success) throw new Error("seed failed: " + JSON.stringify(saved));
  if (identity) {
    const r = await call("saveForgeIdentity", { email: "deploy@acme.test", token: FORGE_TOKEN, consent: true });
    if (!r.success) throw new Error("identity seed failed: " + JSON.stringify(r));
  }
  fetchCalls = [];
  fetchQueue = [];
  return saved.connection.id;
}

/** Run the queued task the way the consumer does — through the real chain. */
const runQueued = (params) => pipe.runPipelineSetup(params);
const lastParams = () => pushedEvents[pushedEvents.length - 1].body.params;

/* ===================== 0. the pure lock maths ===================== */
{
  const a = pipe.hashLock({ permissions: ["scopes:", "- read:jira-work", "- storage:app"] });
  const b = pipe.hashLock({ permissions: ["- storage:app", "scopes:", "- read:jira-work"] });
  ok(a === b, "a reordered-but-equivalent lock hashes the SAME — order is not a permission change");
  const d = pipe.diffLocks({ permissions: ["scopes:", "- read:jira-work"] }, { permissions: ["scopes:", "- read:jira-work", "- write:jira-work"] });
  ok(d.added.length === 1 && d.added[0] === "write:jira-work" && d.removed.length === 0,
    `the diff names the scope that appeared (got ${JSON.stringify(d)})`);
  ok(pipe.lockScopeNames({ permissions: ["scopes:", "content:", "- unsafe-inline", "- read:jira-work"] }).join() === "read:jira-work",
    "structural YAML lines are not reported as scopes");
  ok(pipe.disallowedScopes({ permissions: ["- manage:app-access-rule"] }).length === 1,
    "a scope outside the allow-list is named as disallowed");
  ok(pipe.pipelineStepNames("bitbucket").length === pipe.pipelineStepNames("github").length + 1,
    "bitbucket carries the one extra step (enablePipelines) and nothing else");
}

/* ===================== 1. the ADMIN gate ===================== */
reset();
{
  const connId = await seedConnection();
  for (const key of ["setupGitPipeline", "triggerGitDeploy"]) {
    const r = await call(key, { connectionId: connId, repo: REPO, manifestYaml: MANIFEST, site: SITE, confirm: true }, EDITOR);
    ok(r && r.success === false && r.reason === "no-permission" && r.needsRole === "admin" && r.hint === "ask-app-admin",
      `${key} refuses an EDITOR with needsRole:"admin" through the one refusal shape (got ${JSON.stringify(r)})`);
  }
  ok(fetchCalls.length === 0, "a refused resolver never reaches the network");
  ok(pushedEvents.length === 0, "…and never queues anything");
  // the READ has an editor floor, not an admin one.
  const readable = await call("getGitPipelineStatus", { connectionId: connId, repo: REPO }, EDITOR);
  ok(readable.success === true && readable.status === null, "an editor CAN read the status, and 'never set up' reads as null");
}

/* ===================== 2. identity missing -> refusal shape ===================== */
reset();
{
  const connId = await seedConnection({ identity: false });
  const r = await call("setupGitPipeline", { connectionId: connId, repo: REPO, manifestYaml: MANIFEST, site: SITE });
  ok(r.success === false && r.code === "identity_required" && r.hint === "configure-forge-identity",
    `a missing deploy identity refuses with code+hint (got ${JSON.stringify(r)})`);
  ok(fetchCalls.length === 0 && pushedEvents.length === 0, "nothing was queued and nothing was written");
  ok(storage.__raw(pipe.gitPipelineClaimKey(connId, REPO)) === undefined, "and no claim was taken");
}

/* ===================== 3. a repo off the allow-list ===================== */
reset();
{
  const connId = await seedConnection();
  const r = await call("setupGitPipeline", { connectionId: connId, repo: "someone/else", manifestYaml: MANIFEST, site: SITE });
  ok(r.success === false && r.code === "not_allowed", `an unlisted repo is refused (got ${JSON.stringify(r)})`);
  ok(pushedEvents.length === 0, "nothing queued for a repo the admin never allow-listed");
}

/* ===================== 4. a scope outside the allow-list ===================== */
reset();
{
  const connId = await seedConnection();
  const r = await call("setupGitPipeline", { connectionId: connId, repo: REPO, manifestYaml: MANIFEST_FORBIDDEN, site: SITE });
  ok(r.success === false && r.code === "scope_not_allowed" && r.scopes.includes("manage:app-access-rule"),
    `a scope CogniRunner will not install is refused BY NAME (got ${JSON.stringify(r)})`);
  ok(pushedEvents.length === 0, "and nothing is queued — the refusal is before the side effect");
}

/* ===================== 5. HAPPY PATH ===================== */
reset();
let happyConnId;
{
  const connId = (happyConnId = await seedConnection());
  const queued = await call("setupGitPipeline", { connectionId: connId, repo: REPO, manifestYaml: MANIFEST, site: SITE });
  ok(queued.success === true && queued.async === true && typeof queued.taskId === "string",
    `setup returns {async:true,taskId} (got ${JSON.stringify(queued).slice(0, 200)})`);
  ok(pushedEvents.length === 1 && pushedEvents[0].body.taskType === "gitpipeline",
    "exactly one `gitpipeline` event is queued on async-ai-queue");
  ok(fetchCalls.length === 0, "the RESOLVER touched no git host — every call is the consumer's");
  ok(storage.__raw(pipe.gitPipelineClaimKey(connId, REPO)) !== undefined, "the concurrency claim is held while it runs");
  ok(queued.status.status === "queued" && queued.status.steps.length === 6 &&
     queued.status.steps.every((s) => s.status === "pending"),
    `the row is created with the FIXED step list, all pending (got ${JSON.stringify(queued.status && queued.status.steps)})`);

  // a SECOND request while the first is still claimed is refused, not double-run.
  const second = await call("setupGitPipeline", { connectionId: connId, repo: REPO, manifestYaml: MANIFEST, site: SITE });
  ok(second.success === false && second.code === "already_running",
    `a concurrent second setup is refused (got ${JSON.stringify(second)})`);
  ok(pushedEvents.length === 1, "…and queued nothing");

  // now run the chain the way the consumer does.
  fetchQueue = githubSetupChain();
  const out = await runQueued(lastParams());
  ok(out.ok === true, `the chain completes (${JSON.stringify(out).slice(0, 300)})`);
  const row = storage.__raw(pipe.gitPipelineKey(connId, REPO));
  ok(row.status === "installed" && typeof row.installedAt === "string", "the row says installed, with the moment");
  ok(row.steps.length === 6 && row.steps.every((s) => s.status === "done"), "every step is recorded done");
  ok(row.commitSha === "commitsha" && row.branch === "main", "the commit sha and branch are recorded");
  ok(fetchCalls.filter((c) => c.method === "PUT" && /actions\/secrets/.test(c.url)).length === 2,
    "both deploy secrets were pushed, sealed (PUT /actions/secrets/<name>)");
  ok(fetchCalls.filter((c) => /actions\/variables/.test(c.url)).length === 3, "three variables were set");
  const commitBody = fetchCalls.find((c) => /git\/trees/.test(c.url)).body;
  ok(commitBody.includes(".github/workflows/forge-deploy.yml") && commitBody.includes(".cognirunner/forge-permissions.lock"),
    "the commit carries the rendered workflow AND the permission lock");
  ok(storage.__raw(pipe.gitPipelineClaimKey(connId, REPO)) === undefined, "the claim is released when the run finishes");
}

/* ===================== 6. NO SECRET IN THE ROW OR THE RETURN ===================== */
{
  const row = storage.__raw(pipe.gitPipelineKey(happyConnId, REPO));
  for (const secret of SECRETS) {
    ok(findSecret(row, secret) === null, `the stored pipeline row never contains the credential (${secret.slice(0, 12)}…)`);
  }
  const status = await call("getGitPipelineStatus", { connectionId: happyConnId, repo: REPO });
  for (const secret of SECRETS) {
    ok(findSecret(status, secret) === null, "getGitPipelineStatus returns no credential");
  }
  // prove the allow-list, not the absence: PLANT a token on the stored row.
  const tainted = { ...row, token: FORGE_TOKEN, secret: FORGE_TOKEN };
  ok(findSecret(pipe.publicPipelineRow(tainted), FORGE_TOKEN) === null,
    "publicPipelineRow builds a new object — a token added to the row cannot leak through it");
}

/* ===================== 7. IDEMPOTENT second run ===================== */
{
  const connId = happyConnId;
  const again = await call("setupGitPipeline", { connectionId: connId, repo: REPO, manifestYaml: MANIFEST, site: SITE });
  ok(again.success === true, `the same manifest may be re-run (got ${JSON.stringify(again).slice(0, 160)})`);
  const before = storage.__raw(pipe.gitPipelineKey(connId, REPO)).installedAt;
  // A REDELIVERY of the original event does nothing: same lock, already installed.
  const dupParams = { ...lastParams(), taskId: "redelivered" };
  storage.__seed(pipe.gitPipelineKey(connId, REPO), { ...storage.__raw(pipe.gitPipelineKey(connId, REPO)), status: "installed", installedAt: before });
  fetchCalls = [];
  fetchQueue = [];
  const dup = await runQueued(dupParams);
  ok(dup.ok === true && dup.duplicate === true, `a redelivery of an installed lock is a no-op (got ${JSON.stringify(dup).slice(0, 200)})`);
  ok(fetchCalls.length === 0, "…and made no git call at all");
}

/* ===================== 8. LOCK MISMATCH refusal, by scope name ===================== */
{
  const connId = happyConnId;
  fetchCalls = [];
  pushedEvents.length = 0;
  const r = await call("setupGitPipeline", { connectionId: connId, repo: REPO, manifestYaml: MANIFEST_WIDENED, site: SITE });
  ok(r.success === false && r.code === "lock_mismatch", `a widened manifest is REFUSED (got ${JSON.stringify(r).slice(0, 240)})`);
  ok(Array.isArray(r.added) && r.added.length === 1 && r.added[0] === "manage:jira-configuration",
    `the refusal names the scope that differs, by NAME (got ${JSON.stringify(r.added)})`);
  ok(/manage:jira-configuration/.test(r.error), "…and says it in English too");
  ok(fetchCalls.length === 0 && pushedEvents.length === 0,
    "THE COMMITIMPORTCORE RULE: a refused setup wrote no secret, committed nothing and queued nothing");
  ok(storage.__raw(pipe.gitPipelineKey(connId, REPO)).lockScopes.join() === "read:jira-work,storage:app,write:jira-work",
    "the recorded lock is untouched by the refusal");
}

/* ===================== 9. the claim is RELEASED when the chain fails ===================== */
reset();
{
  const connId = await seedConnection();
  await call("setupGitPipeline", { connectionId: connId, repo: REPO, manifestYaml: MANIFEST, site: SITE });
  ok(storage.__raw(pipe.gitPipelineClaimKey(connId, REPO)) !== undefined, "claim held");
  // the FIRST secret's public-key read 403s: the chain dies on step 1.
  fetchQueue = [res(403, { message: "Resource not accessible by integration" })];
  const out = await runQueued(lastParams());
  ok(out.ok === false, `the chain reports failure (got ${JSON.stringify(out).slice(0, 200)})`);
  const row = storage.__raw(pipe.gitPipelineKey(connId, REPO));
  ok(row.status === "partial" && row.failedStep === "secret:FORGE_EMAIL",
    `a half-finished setup is PARTIAL and names the failed step — never "ready" (got ${row.status}/${row.failedStep})`);
  ok(row.steps[0].status === "failed" && typeof row.steps[0].error === "string", "the failed step carries its error");
  ok(row.steps.slice(1).every((s) => s.status === "pending"), "and the steps after it never ran");
  ok(!row.installedAt, "a partial setup has no installedAt");
  ok(storage.__raw(pipe.gitPipelineClaimKey(connId, REPO)) === undefined,
    "THE CLAIM IS RELEASED on failure — the platform's retry is never swallowed");
  for (const secret of SECRETS) ok(findSecret(row, secret) === null, "a FAILED run's row carries no credential either");
}

/* ===================== 10. triggerGitDeploy needs the confirmation ===================== */
reset();
{
  const connId = await seedConnection();
  const noConfirm = await call("triggerGitDeploy", { connectionId: connId, repo: REPO });
  ok(noConfirm.success === false && noConfirm.code === "confirmation_required",
    `a dangerous action without the confirmation flag is refused (got ${JSON.stringify(noConfirm)})`);
  ok(fetchCalls.length === 0, "…before any network call");
  const notSetUp = await call("triggerGitDeploy", { connectionId: connId, repo: REPO, confirm: true });
  ok(notSetUp.success === false && notSetUp.code === "not_installed", "a repo with no installed pipeline cannot be deployed");
  const unlisted = await call("triggerGitDeploy", { connectionId: connId, repo: "someone/else", confirm: true });
  ok(unlisted.success === false && unlisted.code === "not_allowed", "and neither can a repo off the allow-list");

  // install it, then trigger.
  await call("setupGitPipeline", { connectionId: connId, repo: REPO, manifestYaml: MANIFEST, site: SITE });
  fetchQueue = githubSetupChain();
  await runQueued(lastParams());
  fetchCalls = [];
  fetchQueue = [res(204, {})];
  const fired = await call("triggerGitDeploy", { connectionId: connId, repo: REPO, confirm: true });
  ok(fired.success === true && fired.run.id === null && fired.run.ref === "main",
    `the dispatch is recorded with the TRUTH about its id (GitHub returns none) (got ${JSON.stringify(fired)})`);
  ok(storage.__raw(pipe.gitPipelineKey(connId, REPO)).lastRun.by === ADMIN, "the row records who started it");

  fetchQueue = [res(200, { workflow_runs: [{ id: 7, status: "completed", conclusion: "success", html_url: "u", created_at: "t", name: "forge-deploy" }] })];
  const st = await call("getGitPipelineStatus", { connectionId: connId, repo: REPO });
  ok(st.success === true && st.deploy && st.deploy.latest && st.deploy.latest.state === "success",
    `the status read returns the LIVE deploy state once a run is known (got ${JSON.stringify(st.deploy)})`);

  // a provider fault on the live read must not hide the row.
  fetchQueue = [new Error("network down")];
  const degraded = await call("getGitPipelineStatus", { connectionId: connId, repo: REPO });
  ok(degraded.success === true && degraded.status.status === "installed" && degraded.deploy === null && typeof degraded.deployError === "string",
    `a CI outage degrades to the row plus a deployError, never a lost status (got ${JSON.stringify(degraded).slice(0, 200)})`);
}

console.log(`git-pipeline: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
