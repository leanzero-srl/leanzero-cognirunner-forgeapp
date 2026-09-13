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
const scaf = await import("../../src/shared/git-scaffolds.js");
const state = await import("../../src/shared/git-pipeline-state.js");
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
const githubSetupChain = (vars = 3) => [
  res(200, { key: Buffer.alloc(32, 7).toString("base64"), key_id: "kid" }), // public key
  res(201, {}),                                                             // PUT FORGE_EMAIL
  res(200, { key: Buffer.alloc(32, 7).toString("base64"), key_id: "kid" }),
  res(201, {}),                                                             // PUT FORGE_API_TOKEN
  ...Array.from({ length: vars }, () => res(201, {})),                       // the variables
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

  /* F-527/F-528 — THE OPTIONAL VARIABLE STEPS. The list is a function of the REQUEST as
   * well as the provider kind: a step stamped "done" for a variable nobody asked to be
   * written would be a lie in the only record an admin can read. */
  ok(pipe.pipelineStepNames("github", { developerSpaceId: "d77c0cce-0000-4000-8000-000000000000" }).join("|")
    === "secret:FORGE_EMAIL|secret:FORGE_API_TOKEN|var:FORGE_SITE|var:FORGE_PRODUCT|var:FORGE_ENV|var:FORGE_DEVELOPER_SPACE|commit-scaffold",
    "a developer space id adds var:FORGE_DEVELOPER_SPACE before the commit");
  ok(pipe.pipelineStepNames("github", { developerSpaceId: "" }).join("|") === pipe.pipelineStepNames("github").join("|"),
    "an empty value adds no step");
  ok(pipe.pipelineStepNames("github", {}).slice(-1)[0] === "commit-scaffold",
    "commit-scaffold is always last - the scaffold commit is the last thing a setup does");

  /* F-528 — the APP ID is accepted in either form an admin is likely to paste and stored
   * as the full ARI, because inject-app-id.js refuses anything else. */
  ok(pipe.normalizeForgeAppId(null) === null && pipe.normalizeForgeAppId(" ") === null,
    "an absent app id is null, not a refusal - it is optional");
  ok(pipe.normalizeForgeAppId("8e6ab209-bb76-4a09-86cd-644f3f33960c")
    === "ari:cloud:ecosystem::app/8e6ab209-bb76-4a09-86cd-644f3f33960c",
    "a bare uuid is normalised to the full ARI the injector requires");
  ok(pipe.normalizeForgeAppId("ARI:cloud:ecosystem::app/8E6AB209-BB76-4A09-86CD-644F3F33960C")
    === "ari:cloud:ecosystem::app/8e6ab209-bb76-4a09-86cd-644f3f33960c",
    "an ARI is accepted and lower-cased");
  for (const bad of ["ari:cloud:ecosystem::app/not-a-uuid", "8e6ab209", "$(whoami)", "ari:cloud:jira::site/x"]) {
    ok(pipe.normalizeForgeAppId(bad) === false, `a malformed app id is refused (${bad})`);
  }
  ok(pipe.pipelineStepNames("github", { appId: "ari:cloud:ecosystem::app/x" }).join("|")
    === "secret:FORGE_EMAIL|secret:FORGE_API_TOKEN|var:FORGE_SITE|var:FORGE_PRODUCT|var:FORGE_ENV|var:FORGE_APP_ID|commit-scaffold",
    "an app id adds var:FORGE_APP_ID before the commit");

  /* F-527 — the developer space id is VALIDATED, never trusted: it is interpolated into a
   * shell word in the rendered workflow. */
  ok(pipe.normalizeDeveloperSpaceId(null) === null && pipe.normalizeDeveloperSpaceId("  ") === null,
    "an absent space id is null, not a refusal - it is optional");
  ok(pipe.normalizeDeveloperSpaceId("D77C0CCE-1111-4222-8333-444444444444") === "d77c0cce-1111-4222-8333-444444444444",
    "a valid one is normalised to lower case");
  for (const bad of ["not-a-space", "d77c0cce-1111-4222-8333-44444444444", "$(id); echo", "d77c0cce 1111 4222 8333 444444444444"]) {
    ok(pipe.normalizeDeveloperSpaceId(bad) === false, `a malformed space id is refused (${bad})`);
  }

  /* F-465 — THE STEP IDS HAVE ONE HOME, and three readers that cannot import each
   * other: this executor, the Code tab, and the screenshot fixture that stands in for
   * the backend. The fixture used to RETYPE the list with a note asking the next person
   * to keep it in step, which is the N-copies defect stated as a comment.
   * What is held here: the executor's export IS the shared module's function, the ids
   * are exactly these, in this order, and neither src/git-pipeline.js nor the fixture
   * re-states one of them. */
  const steps = await import("../../src/shared/git-pipeline-steps.js");
  ok(pipe.pipelineStepNames === steps.pipelineStepNames,
    "src/git-pipeline.js re-exports the shared function rather than owning a second copy");
  ok(steps.pipelineStepNames("github").join("|")
    === "secret:FORGE_EMAIL|secret:FORGE_API_TOKEN|var:FORGE_SITE|var:FORGE_PRODUCT|var:FORGE_ENV|commit-scaffold",
    `the GitHub step ids are stable, in order (got ${steps.pipelineStepNames("github").join("|")})`);
  ok(steps.pipelineStepNames("bitbucket")[0] === "enable-pipelines",
    "…and Bitbucket runs enable-pipelines first");
  ok(Object.isFrozen(steps.PIPELINE_COMMON_STEPS) && Object.isFrozen(steps.PIPELINE_BITBUCKET_PREFIX),
    "the lists cannot be mutated at runtime");

  const { readFileSync } = await import("node:fs");
  const here = new URL("../../", import.meta.url);
  const srcPipeline = readFileSync(new URL("src/git-pipeline.js", here), "utf8");
  const fixture = readFileSync(new URL("static/_screenshot-harness/bridge.js", here), "utf8");
  for (const [label, text] of [["src/git-pipeline.js", srcPipeline], ["the screenshot fixture", fixture]]) {
    // The id appears once in git-pipeline.js as the STEP CALL that runs it; what must
    // never come back is a second LIST literal beside it.
    ok(!/\["enable-pipelines"\]/.test(text) && !/"var:FORGE_SITE",\s*"var:FORGE_PRODUCT"/.test(text),
      `${label} does not re-state the step list — it imports src/shared/git-pipeline-steps.js`);
    ok(/git-pipeline-steps\.js/.test(text), `…and it really imports it`);
  }

  /* F-557 — THE TWO FORGE ID SHAPES HAVE ONE HOME TOO. The backend and the Code tab's
   * form both check `FORGE_DEVELOPER_SPACE` and `FORGE_APP_ID`, and both used to carry
   * their own literal copy of the three regexes, with nothing reading the JSX. The home
   * is src/shared/git-ids.js — dependency-free, and already imported by both sides.
   * What is held: the backend's exports ARE the shared module's functions, and NEITHER
   * file declares a regex or the ARI prefix locally. */
  const ids = await import("../../src/shared/git-ids.js");
  ok(pipe.normalizeDeveloperSpaceId === ids.normalizeDeveloperSpaceId
    && pipe.normalizeForgeAppId === ids.normalizeForgeAppId,
    "src/git-pipeline.js re-exports the shared normalisers rather than owning a second copy");
  const codeTab = readFileSync(new URL("static/admin-panel/src/components/CodeTab.jsx", here), "utf8");
  for (const [label, text] of [["src/git-pipeline.js", srcPipeline], ["CodeTab.jsx", codeTab]]) {
    ok(!/(DEVELOPER_SPACE_RE|APP_ID_UUID_RE|APP_ID_ARI_PREFIX)\s*=/.test(text),
      `${label} does not declare the Forge id shapes locally — it imports src/shared/git-ids.js`);
    // A refusal SENTENCE may name the prefix; what must not come back is a second
    // constant holding it.
    ok(!/=\s*["'`]ari:cloud:ecosystem::app\//.test(text),
      `…and it does not assign the ARI prefix to a local constant (${label})`);
    ok(/git-ids\.js/.test(text), `…and it really imports git-ids.js (${label})`);
  }
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

/* ===== 11. F-527 - the developer space id is collected, refused when malformed,
 *         and written as a repository variable next to FORGE_SITE =============== */
reset();
{
  const connId = await seedConnection();
  const SPACE = "d77c0cce-1111-4222-8333-444444444444";

  // a malformed one is REFUSED before anything happens.
  const bad = await pipe.requestPipelineSetup({
    connectionId: connId, repo: REPO, manifestYaml: MANIFEST, site: SITE,
    developerSpaceId: "oops; rm -rf /", accountId: ADMIN,
  });
  ok(bad.ok === false && bad.code === "invalid_developer_space",
    `a malformed developer space id is refused by code (got ${JSON.stringify(bad)})`);
  ok(fetchCalls.length === 0 && pushedEvents.length === 0, "...with nothing queued and nothing written");
  ok(storage.__raw(pipe.gitPipelineClaimKey(connId, REPO)) === undefined, "...and no claim taken");

  const queued = await pipe.requestPipelineSetup({
    connectionId: connId, repo: REPO, manifestYaml: MANIFEST, site: SITE,
    developerSpaceId: SPACE.toUpperCase(), accountId: ADMIN,
  });
  ok(queued.ok === true, `a valid one is accepted (got ${JSON.stringify(queued).slice(0, 160)})`);
  ok(lastParams().developerSpaceId === SPACE, "the queued params carry the normalised id");
  ok(queued.status.steps.map((x) => x.name).join("|").includes("var:FORGE_DEVELOPER_SPACE"),
    `the row's FIXED step list includes the variable step (got ${queued.status.steps.map((x) => x.name).join("|")})`);

  fetchQueue = githubSetupChain(4);
  const out = await runQueued(lastParams());
  ok(out.ok === true, `the chain completes with the extra variable (${JSON.stringify(out).slice(0, 240)})`);
  const varCalls = fetchCalls.filter((c) => /actions\/variables/.test(c.url));
  ok(varCalls.length === 4, `four variables were written (got ${varCalls.length})`);
  ok(varCalls.some((c) => String(c.body).includes("FORGE_DEVELOPER_SPACE") && String(c.body).includes(SPACE)),
    "...one of them is FORGE_DEVELOPER_SPACE carrying the id the admin gave");
  const row = storage.__raw(pipe.gitPipelineKey(connId, REPO));
  ok(row.status === "installed" && row.developerSpaceId === SPACE, "the row records the space id");
  ok(pipe.publicPipelineRow(row).developerSpaceId === SPACE, "and the public shape exposes it (it is not a secret)");

  // ...and a setup WITHOUT one still runs the same six steps, unchanged.
  reset();
  const connId2 = await seedConnection();
  const plain = await pipe.requestPipelineSetup({
    connectionId: connId2, repo: REPO, manifestYaml: MANIFEST, site: SITE, accountId: ADMIN,
  });
  ok(plain.ok === true && plain.status.steps.length === 6 &&
     !plain.status.steps.some((x) => x.name === "var:FORGE_DEVELOPER_SPACE"),
    `no space id means no step for it (got ${plain.status.steps.map((x) => x.name).join("|")})`);
}

/* ===== 12. F-528 — the PRODUCT stores FORGE_APP_ID, because the runner cannot ===== */
reset();
{
  const connId = await seedConnection();
  const ARI = "ari:cloud:ecosystem::app/8e6ab209-bb76-4a09-86cd-644f3f33960c";

  const bad = await pipe.requestPipelineSetup({
    connectionId: connId, repo: REPO, manifestYaml: MANIFEST, site: SITE,
    appId: "ari:cloud:ecosystem::app/nope", accountId: ADMIN,
  });
  ok(bad.ok === false && bad.code === "invalid_app_id",
    `a malformed app id is refused by code (got ${JSON.stringify(bad)})`);
  ok(fetchCalls.length === 0 && pushedEvents.length === 0, "...before any side effect");

  const queued = await pipe.requestPipelineSetup({
    connectionId: connId, repo: REPO, manifestYaml: MANIFEST, site: SITE,
    appId: "8e6ab209-bb76-4a09-86cd-644f3f33960c", accountId: ADMIN,
  });
  ok(queued.ok === true && lastParams().appId === ARI,
    `a bare uuid is accepted and queued as the full ARI (got ${lastParams().appId})`);

  fetchQueue = githubSetupChain(4);
  const out = await runQueued(lastParams());
  ok(out.ok === true, `the chain completes (${JSON.stringify(out).slice(0, 200)})`);
  const varCalls = fetchCalls.filter((c) => /actions\/variables/.test(c.url));
  ok(varCalls.length === 4 && varCalls.some((c) => String(c.body).includes("FORGE_APP_ID") && String(c.body).includes(ARI)),
    "FORGE_APP_ID is written by THIS app's credential, with the full ARI");
  const row = storage.__raw(pipe.gitPipelineKey(connId, REPO));
  ok(row.appId === ARI && pipe.publicPipelineRow(row).appId === ARI,
    "the row records it and the public shape exposes it (an app id is not a credential)");

  // both optional variables together, in the order the step list declares.
  reset();
  const connId2 = await seedConnection();
  const both = await pipe.requestPipelineSetup({
    connectionId: connId2, repo: REPO, manifestYaml: MANIFEST, site: SITE,
    developerSpaceId: "d77c0cce-1111-4222-8333-444444444444", appId: ARI, accountId: ADMIN,
  });
  ok(both.ok === true && both.status.steps.map((x) => x.name).join("|")
    === "secret:FORGE_EMAIL|secret:FORGE_API_TOKEN|var:FORGE_SITE|var:FORGE_PRODUCT|var:FORGE_ENV|var:FORGE_DEVELOPER_SPACE|var:FORGE_APP_ID|commit-scaffold",
    `both optional steps appear, in order, before the commit (got ${both.status.steps.map((x) => x.name).join("|")})`);
  fetchQueue = githubSetupChain(5);
  const out2 = await runQueued(lastParams());
  ok(out2.ok === true && storage.__raw(pipe.gitPipelineKey(connId2, REPO)).steps.every((x) => x.status === "done"),
    `every step of the widest chain is recorded done (${JSON.stringify(out2).slice(0, 200)})`);
}

/* ===== 13. F-541 — a traversing scaffold variable is refused by the BACKEND ===== */
reset();
{
  const connId = await seedConnection();
  for (const [k, v] of [["UI_DIR", "../../etc"], ["UI_DIR", "/etc"], ["APP_NAME", "a;rm -rf /"], ["UI_DIR", ""]]) {
    const r = await call("setupGitPipeline", {
      connectionId: connId, repo: REPO, manifestYaml: MANIFEST, site: SITE,
      scaffoldVars: { [k]: v },
    });
    ok(r.success === false && r.code === "invalid_scaffold_var",
      `${k}=${JSON.stringify(v)} is refused by the resolver (got ${JSON.stringify(r)})`);
    ok(typeof r.error === "string" && r.error.length > 10,
      "...with a sentence that names the field a human is looking at: " + r.error);
    // The resolver in src/index.js whitelists which refusal extras it forwards, so the
    // machine-readable `variable` is asserted on the module's own return, not through it.
    const direct = await pipe.requestPipelineSetup({
      connectionId: connId, repo: REPO, manifestYaml: MANIFEST, site: SITE,
      scaffoldVars: { [k]: v }, accountId: ADMIN,
    });
    ok(direct.ok === false && direct.code === "invalid_scaffold_var" && direct.variable === k,
      `...and the refusal names the variable in machine form (got ${JSON.stringify(direct)})`);
  }
  ok(fetchCalls.length === 0 && pushedEvents.length === 0,
    "THE COMMITIMPORTCORE RULE: a bad scaffold variable is refused BEFORE a secret reaches the repo - renderScaffold would otherwise have thrown in the consumer, after the credentials were installed");
  ok(storage.__raw(pipe.gitPipelineClaimKey(connId, REPO)) === undefined, "...and no claim was taken");

  const good = await call("setupGitPipeline", {
    connectionId: connId, repo: REPO, manifestYaml: MANIFEST, site: SITE,
    scaffoldVars: { APP_NAME: "Next Steps", UI_DIR: "none" },
  });
  ok(good.success === true, `usable variables still queue, including UI_DIR "none" (got ${JSON.stringify(good).slice(0, 160)})`);
  ok(lastParams().scaffoldVars.UI_DIR === "none", "...and ride to the consumer unchanged");
}

/* ===== 14. F-547 — the resolver's forwarded keys ARE requestPipelineSetup's accepted keys =====
   The F-526 shape, one layer up: a hand-copied field list in src/index.js fell behind the
   module's signature and silently dropped `developerSpaceId`/`appId`. This asserts against
   the SOURCE, because a runtime check can only see the fields a test happens to send. */
{
  const fs = await import("node:fs/promises");
  const url = await import("node:url");
  const here = url.fileURLToPath(new URL(".", import.meta.url));
  const pipeSrc = await fs.readFile(here + "../../src/git-pipeline.js", "utf8");
  const indexSrc = await fs.readFile(here + "../../src/index.js", "utf8");

  // The destructured parameters of requestPipelineSetup, read off its signature.
  const sig = pipeSrc.match(/export async function requestPipelineSetup\(\{([\s\S]*?)\}\s*=\s*\{\}\s*\)/);
  ok(!!sig, "requestPipelineSetup's signature is readable from source");
  const accepted = (sig ? sig[1] : "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, "").trim())
    .filter(Boolean)
    .map((l) => l.split(/[=,]/)[0].trim())
    .filter(Boolean);
  const declared = [...pipe.PIPELINE_SETUP_PAYLOAD_KEYS];
  ok(JSON.stringify(accepted.filter((k) => k !== "accountId")) === JSON.stringify(declared),
    `PIPELINE_SETUP_PAYLOAD_KEYS equals the accepted payload keys (signature ${JSON.stringify(accepted)} vs constant ${JSON.stringify(declared)})`);
  ok(accepted.includes("accountId"),
    "...and accountId is accepted but excluded from the payload list - it comes from context");
  ok(declared.includes("developerSpaceId") && declared.includes("appId"),
    "...and it carries the F-527/F-528 fields");

  // The resolver must copy by that constant, not by a re-typed literal.
  const resolverBody = indexSrc.match(/resolver\.define\("setupGitPipeline"[\s\S]*?\n\}\);/);
  ok(!!resolverBody, "the setupGitPipeline resolver is readable from source");
  const body = resolverBody ? resolverBody[0] : "";
  ok(/for \(const k of PIPELINE_SETUP_PAYLOAD_KEYS\)/.test(body),
    "setupGitPipeline forwards the payload by the exported key list, not a hand-copied literal");
  for (const k of declared) {
    ok(!new RegExp(`${k}:\\s*payload\\?\\.`).test(body),
      `...so no hand-copied \`${k}: payload?.${k}\` line survives to drift`);
  }
  ok(/r\.variable \? \{ variable: r\.variable \}/.test(body),
    "...and the F-541 `variable` extra rides the refusal out to the admin");
}

/* ===== 15. F-547 — the two new fields actually reach the module through the resolver ===== */
reset();
{
  const connId = await seedConnection();
  const ARI2 = "ari:cloud:ecosystem::app/8e6ab209-bb76-4a09-86cd-644f3f33960c";
  const r = await call("setupGitPipeline", {
    connectionId: connId, repo: REPO, manifestYaml: MANIFEST, site: SITE,
    developerSpaceId: "d77c0cce-1111-4222-8333-444444444444", appId: ARI2,
  });
  ok(r.success === true, `a setup carrying the new fields queues (got ${JSON.stringify(r).slice(0, 200)})`);
  const names = (r.status?.steps || []).map((x) => x.name).join("|");
  ok(names.includes("var:FORGE_DEVELOPER_SPACE") && names.includes("var:FORGE_APP_ID"),
    `...and BOTH new steps are planned through the resolver, not dropped one layer up (got ${names})`);
  const bad = await call("setupGitPipeline", {
    connectionId: connId, repo: REPO, manifestYaml: MANIFEST, site: SITE,
    developerSpaceId: "not-a-space",
  });
  ok(bad.success === false && bad.code === "invalid_developer_space",
    `...and a malformed one is refused by the module through the resolver (got ${JSON.stringify(bad).slice(0, 200)})`);
}

/* ===== 16. F-579 — AN INSTALLED PIPELINE KNOWS WHEN ITS COMMITTED FILES ARE STALE =====
 * The scaffold is committed into the customer's repo and never touched again, so a fix to
 * the line arrays repairs the NEXT install only. F-565 shipped exactly that: the workflow
 * content changed, SCAFFOLD_VERSION did not, and no code compared the version stored on the
 * row with the current one — so a repo installed before the fix reported installed, 6/6
 * steps done, while every deploy dispatch 422'd.
 *
 * The row now carries the comparison, DERIVED on read (no migration), and the remedy is the
 * setup path that already exists: re-running it re-commits and clears the flag. */
reset();
{
  const connId = await seedConnection();
  await call("setupGitPipeline", { connectionId: connId, repo: REPO, manifestYaml: MANIFEST, site: SITE });
  fetchQueue = githubSetupChain();
  await runQueued(lastParams());
  const key = pipe.gitPipelineKey(connId, REPO);
  const installed = storage.__raw(key);
  ok(installed.status === "installed" && installed.scaffoldVersion === scaf.SCAFFOLD_VERSION,
    `a fresh install stamps the CURRENT scaffold version (got ${installed.scaffoldVersion})`);
  const fresh = await call("getGitPipelineStatus", { connectionId: connId, repo: REPO });
  ok(fresh.status.outdated === false && fresh.status.outdatedReason === null,
    `…and reads as current (got ${JSON.stringify({ o: fresh.status.outdated, r: fresh.status.outdatedReason })})`);

  // AGE IT. This is the offshoot's row: installed, 6/6, stuck on version 1.
  storage.__seed(key, { ...installed, scaffoldVersion: 1 });
  const stale = await call("getGitPipelineStatus", { connectionId: connId, repo: REPO });
  ok(stale.status.status === "installed" && stale.status.steps.every((s) => s.status === "done"),
    "the aged row still says installed with every step done — the symptom F-579 is about");
  ok(stale.status.outdated === true && stale.status.scaffoldVersion === 1 &&
     stale.status.currentScaffoldVersion === scaf.SCAFFOLD_VERSION,
    `…but it now reports outdated, naming both versions (got ${JSON.stringify(stale.status.scaffoldVersion)} vs ${JSON.stringify(stale.status.currentScaffoldVersion)})`);
  ok(stale.status.outdatedReason === scaf.SCAFFOLD_CHANGELOG[2],
    `…with the CHANGELOG line as the reason, verbatim (got ${JSON.stringify(stale.status.outdatedReason).slice(0, 120)})`);

  // A row that predates the field at all is old, not unknown.
  const noVersion = { ...installed };
  delete noVersion.scaffoldVersion;
  ok(pipe.publicPipelineRow(noVersion).outdated === true,
    "a row with NO recorded version reads as outdated rather than as fine");

  // THE REMEDY. Re-running the same setup — same manifest, same lock — re-commits and
  // clears the flag. The redelivery short-circuit must NOT swallow this run.
  storage.__seed(key, { ...installed, scaffoldVersion: 1 });
  pushedEvents.length = 0;
  const again = await call("setupGitPipeline", { connectionId: connId, repo: REPO, manifestYaml: MANIFEST, site: SITE });
  ok(again.success === true, `an outdated pipeline may be re-set-up (got ${JSON.stringify(again).slice(0, 160)})`);
  fetchCalls = [];
  fetchQueue = githubSetupChain();
  const out = await runQueued(lastParams());
  ok(out.ok === true && out.duplicate !== true,
    `the chain RAN rather than reporting a duplicate (got ${JSON.stringify(out).slice(0, 200)})`);
  ok(fetchCalls.some((c) => /git\/trees/.test(c.url)),
    "…and re-committed the scaffold, which is the whole remedy");
  const after = await call("getGitPipelineStatus", { connectionId: connId, repo: REPO });
  ok(after.status.outdated === false && after.status.outdatedReason === null &&
     after.status.scaffoldVersion === scaf.SCAFFOLD_VERSION,
    `…and the row is current again (got ${JSON.stringify({ v: after.status.scaffoldVersion, o: after.status.outdated })})`);

  // A REDELIVERY of that same event is still a no-op — the version guard did not cost us
  // the at-least-once protection it sits next to.
  fetchCalls = [];
  fetchQueue = [];
  const dup = await runQueued({ ...lastParams(), taskId: "redelivered-579" });
  ok(dup.ok === true && dup.duplicate === true && fetchCalls.length === 0,
    `a redelivery of a CURRENT install is still a no-op (got ${JSON.stringify(dup).slice(0, 160)})`);
}

/* ===== 17. F-604 — A RE-SETUP CARRIES THE INSTALLED VALUES, IT DOES NOT RESET THEM =====
 * F-583 lets an outdated-but-installed row reach the setup form. The row write used to be
 * built from the payload alone, so a caller that omitted a field got null: re-running the
 * remedy re-rendered the workflow with the scaffold's DEFAULT variables and erased the
 * repository's developer space and app id. Carry-over, not overwrite. */
reset();
{
  const connId = await seedConnection();
  const SPACE = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const ARI = "ari:cloud:ecosystem::app/11111111-2222-3333-4444-555555555555";
  await call("setupGitPipeline", {
    connectionId: connId, repo: REPO, manifestYaml: MANIFEST, site: SITE,
    scaffoldVars: { APP_NAME: "Acme App", UI_DIR: "static/app" },
    developerSpaceId: SPACE, appId: ARI,
  });
  fetchQueue = githubSetupChain(5);
  await runQueued(lastParams());
  const key = pipe.gitPipelineKey(connId, REPO);
  const installed = storage.__raw(key);
  ok(installed.status === "installed", `the seed install completes (got ${installed.status} / ${installed.failedStep})`);
  ok(installed.scaffoldVars && installed.scaffoldVars.UI_DIR === "static/app",
    `the installed row records the variables it was rendered with (got ${JSON.stringify(installed.scaffoldVars)})`);
  const pub = await call("getGitPipelineStatus", { connectionId: connId, repo: REPO });
  ok(pub.status.scaffoldVars && pub.status.scaffoldVars.APP_NAME === "Acme App" &&
     pub.status.scaffoldVars.UI_DIR === "static/app",
    "…and the public row carries them, so the Code tab can prefill the form from what is installed");
  ok(findSecret(pub, GH_TOKEN) === null && findSecret(pub, FORGE_TOKEN) === null,
    "…without carrying a secret with them");

  // Age it, then re-set-up with NO scaffoldVars / space / app id in the payload at all.
  storage.__seed(key, { ...installed, scaffoldVersion: 1 });
  pushedEvents.length = 0;
  const again = await call("setupGitPipeline", { connectionId: connId, repo: REPO, manifestYaml: MANIFEST, site: SITE });
  ok(again.success === true, `a partial payload is accepted (got ${JSON.stringify(again).slice(0, 160)})`);
  const queuedRow = storage.__raw(key);
  ok(queuedRow.scaffoldVars && queuedRow.scaffoldVars.UI_DIR === "static/app" &&
     queuedRow.developerSpaceId === SPACE && queuedRow.appId === ARI,
    `the re-setup row KEPT the installed values instead of nulling them (got ${JSON.stringify({ v: queuedRow.scaffoldVars, s: queuedRow.developerSpaceId, a: queuedRow.appId })})`);
  ok(queuedRow.installedAt === installed.installedAt,
    "…and it keeps installedAt, so the header does not lose the install date");
  const params = lastParams();
  ok(params.scaffoldVars && params.scaffoldVars.UI_DIR === "static/app" &&
     params.developerSpaceId === SPACE && params.appId === ARI,
    `…and the CONSUMER is asked to render the same folder and set the same variables (got ${JSON.stringify({ v: params.scaffoldVars, s: params.developerSpaceId, a: params.appId })})`);
  fetchCalls = [];
  const chain = githubSetupChain(5);
  chain.splice(4 + 5, 1); // no default-branch lookup: the row already names the branch
  fetchQueue = chain;
  const out = await runQueued(params);
  ok(out.ok === true, `the carried re-setup runs (got ${JSON.stringify(out).slice(0, 200)})`);
  const treeCall = fetchCalls.find((c) => /git\/trees/.test(c.url));
  ok(!!treeCall && String(treeCall.body).includes("static/app") && !String(treeCall.body).includes("static/ui"),
    "…and the COMMITTED workflow builds the folder the pipeline was installed with, not the scaffold default");

  // An explicitly EMPTY value is a clear, not an omission: the admin can still remove one.
  storage.__seed(key, { ...storage.__raw(key), scaffoldVersion: 1 });
  await call("setupGitPipeline", {
    connectionId: connId, repo: REPO, manifestYaml: MANIFEST, site: SITE, developerSpaceId: "", appId: "",
  });
  const cleared = storage.__raw(key);
  ok(cleared.developerSpaceId === null && cleared.appId === null,
    `an explicitly empty field CLEARS the stored one (got ${JSON.stringify({ s: cleared.developerSpaceId, a: cleared.appId })})`);
  ok(cleared.scaffoldVars && cleared.scaffoldVars.UI_DIR === "static/app",
    "…and clearing one field does not disturb the ones the payload said nothing about");
}

/* ===== 18. F-605 — THE VERSION IS STAMPED BY THE COMMIT, AND A DEAD RUN IS NOT LIVE =====
 * `scaffoldVersion` was written on the QUEUED row, so a run that never reached the commit
 * step left a repository holding the old workflow while the row claimed the current
 * version: `outdated` went false, `live` stayed true (status is written by the run, and a
 * dead run never updates it), and the Code tab showed neither the banner nor the form. */
reset();
{
  const connId = await seedConnection();
  await call("setupGitPipeline", { connectionId: connId, repo: REPO, manifestYaml: MANIFEST, site: SITE });
  const key = pipe.gitPipelineKey(connId, REPO);
  const queued = storage.__raw(key);
  ok(queued.status === "queued" && (queued.scaffoldVersion === null || queued.scaffoldVersion === undefined),
    `a QUEUED first setup carries no scaffold version - nothing is committed yet (got ${JSON.stringify(queued.scaffoldVersion)})`);
  fetchQueue = githubSetupChain();
  await runQueued(lastParams());
  ok(storage.__raw(key).scaffoldVersion === scaf.SCAFFOLD_VERSION,
    "…and the COMMIT is what stamps it");

  // The defect, exactly: an installed-and-stale row is re-set-up and the run dies.
  const installed = storage.__raw(key);
  storage.__seed(key, { ...installed, scaffoldVersion: 1 });
  await call("setupGitPipeline", { connectionId: connId, repo: REPO, manifestYaml: MANIFEST, site: SITE });
  const requeued = storage.__raw(key);
  ok(requeued.status === "queued" && requeued.scaffoldVersion === 1,
    `a re-setup QUEUES on the PREVIOUS version - the repo still holds the old bytes (got ${JSON.stringify(requeued.scaffoldVersion)})`);

  // Fresh queue: live, and deliberately not reported as outdated while it is about to run.
  const fresh = await call("getGitPipelineStatus", { connectionId: connId, repo: REPO });
  ok(fresh.status.live === true && fresh.status.stuck === false,
    `a run inside the claim's window is LIVE (got ${JSON.stringify({ l: fresh.status.live, s: fresh.status.stuck })})`);

  // Now the run never happens. Age the row past the claim TTL.
  const longAgo = new Date(Date.now() - (pipe.PIPELINE_CLAIM_TTL_MINUTES + 5) * 60 * 1000).toISOString();
  storage.__seed(key, { ...requeued, queuedAt: longAgo, updatedAt: longAgo });
  const dead = await call("getGitPipelineStatus", { connectionId: connId, repo: REPO });
  ok(dead.status.live === false && dead.status.stuck === true,
    `a run that stopped reporting past the claim TTL is NOT live (got ${JSON.stringify({ l: dead.status.live, s: dead.status.stuck })})`);
  ok(dead.status.outdated === true && dead.status.outdatedReason === scaf.SCAFFOLD_CHANGELOG[2],
    `…and the repository is still reported OUTDATED, which is the signal the defect erased (got ${JSON.stringify(dead.status.outdatedReason).slice(0, 80)})`);

  // A run that DID install is never stuck and never live.
  const done = pipe.publicPipelineRow(installed);
  ok(done.live === false && done.stuck === false, "an installed row is neither live nor stuck");

  // A first setup that dies in the queue is stuck, but NOT outdated: nothing was committed,
  // so there are no stale bytes to replace and the banner would be a false sentence.
  const neverInstalled = { ...requeued, installedAt: null, scaffoldVersion: null, queuedAt: longAgo, updatedAt: longAgo };
  const never = pipe.publicPipelineRow(neverInstalled);
  ok(never.stuck === true && never.outdated === false && never.outdatedReason === null,
    `a first setup that never ran is stuck, not outdated (got ${JSON.stringify({ s: never.stuck, o: never.outdated })})`);

  // A row with no usable timestamp fails to LIVE: the claim refuses a second setup anyway.
  ok(pipe.publicPipelineRow({ status: "queued" }).live === true,
    "a queued row that cannot be dated is treated as live, not as abandoned");
}

/* ===== 19. F-611 — THE DEPLOY DOOR CONSULTS THE SAME PREDICATE THE SCREEN DOES =====
 * F-602 removed the "Trigger deploy" button from an outdated pipeline's card, which closes
 * the half a reader sees. The resolver still forwarded the dispatch, so a script - or the
 * race where the row goes stale between the render and the press - still reached the 422,
 * surfaced as a generic provider failure instead of the refusal that names the cause. */
reset();
{
  const connId = await seedConnection();
  await call("setupGitPipeline", { connectionId: connId, repo: REPO, manifestYaml: MANIFEST, site: SITE });
  fetchQueue = githubSetupChain();
  await runQueued(lastParams());
  const key = pipe.gitPipelineKey(connId, REPO);
  const installed = storage.__raw(key);

  // A CURRENT pipeline still deploys — the refusal must not take the feature away.
  fetchCalls = [];
  fetchQueue = [res(204, {})];
  const okRun = await call("triggerGitDeploy", { connectionId: connId, repo: REPO, confirm: true });
  ok(okRun.success === true, `a current pipeline still deploys (got ${JSON.stringify(okRun).slice(0, 160)})`);

  // Age it to the offshoot's state: installed, 6/6, stuck on v1. The row carries the run
  // the successful deploy just recorded, which is what proves the refusal writes nothing.
  storage.__seed(key, { ...storage.__raw(key), scaffoldVersion: 1 });
  const beforeRefusal = storage.__raw(key);
  fetchCalls = [];
  fetchQueue = [];
  const refused = await call("triggerGitDeploy", { connectionId: connId, repo: REPO, confirm: true });
  ok(refused.success === false && refused.code === "pipeline_outdated",
    `an OUTDATED pipeline refuses the deploy by machine code (got ${JSON.stringify(refused).slice(0, 200)})`);
  ok(fetchCalls.length === 0,
    "…and nothing was dispatched: the refusal happens before the provider is touched");
  ok(refused.error.includes(scaf.SCAFFOLD_CHANGELOG[2]),
    `…carrying the changelog line the Code tab shows, verbatim (got ${JSON.stringify(refused.error).slice(0, 120)})`);
  ok(refused.error.includes(state.PIPELINE_OUTDATED_REMEDY),
    "…and the one shared remedy sentence, so the screen and the API say the same thing");

  // The row is untouched by a refusal: the run recorded by the SUCCESSFUL deploy above is
  // still the last one, so nothing was written on the way out.
  const after = storage.__raw(key);
  ok(after.lastRun && after.lastRun.ref === "main" && after.lastRun.at === beforeRefusal.lastRun.at,
    `the refusal records no new run on the row (got ${JSON.stringify(after.lastRun)})`);

  // ONE PREDICATE. The projection the tab renders and the deploy gate answer the same way
  // for the same row — that is the whole point of naming it.
  const pub = pipe.publicPipelineRow(storage.__raw(key));
  ok(pub.outdated === pipe.pipelineOutdated(storage.__raw(key)) && pub.outdated === true,
    "the row the screen renders and the gate the deploy asks are the same predicate");

  // A row that never installed refuses as not_installed, not as outdated: nothing is stale.
  storage.__seed(key, { ...installed, installedAt: null, status: "partial", scaffoldVersion: 1 });
  const notSetUp = await call("triggerGitDeploy", { connectionId: connId, repo: REPO, confirm: true });
  ok(notSetUp.code === "not_installed",
    `a repo that never installed is refused as not_installed (got ${JSON.stringify(notSetUp.code)})`);
}

console.log(`git-pipeline: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
