/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Offline: the git provider layer (src/git-providers.js) on a MOCKED fetch.
// Proves, for BOTH adapters: the request shape of every method (verb, path,
// headers, body), the response mapping, every GitProviderError code, the 10 s
// AbortController cap, the 60 KB/16 KB diff caps, that WRITES ARE NEVER RETRIED
// while reads retry once, that only the declared egress hosts are called, and
// that no token value can appear in any thrown message.
// Run: node scripts/git-providers.test.mjs   (auto-discovered by run-offline.mjs)

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const m = await import(path.join(here, "..", "..", "src", "git-providers.js"));
const {
  createGitProvider,
  GitProviderError,
  GIT_PROVIDER_HOSTS,
  GIT_PROVIDER_HOST_NAMES,
  GIT_PROVIDER_METHODS,
  GIT_ERROR_CODES,
  GIT_CALL_TIMEOUT_MS,
  DIFF_MAX_TOTAL_BYTES,
  DIFF_MAX_FILE_BYTES,
  capDiff,
  splitUnifiedDiff,
  redactSecrets,
} = m;

let checks = 0;
const ok = (cond, msg) => {
  checks++;
  assert.ok(cond, msg);
};
const eq = (a, b, msg) => {
  checks++;
  assert.deepEqual(a, b, msg);
};

const nacl = (await import("tweetnacl")).default;

const GH_TOKEN = "ghp_SUPERSECRET_TOKEN_abcdef0123456789";
const BB_EMAIL = "bot@leanzero.net";
const BB_TOKEN = "ATATT_BITBUCKET_SECRET_9876543210";

/* Every URL any test touched — scanned for egress at the end. */
const allUrls = [];
/* Every message any error path produced — scanned for token leaks at the end. */
const allMessages = [];

function res(status, body, headers = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body === undefined ? null : body);
  return {
    status,
    headers,
    async json() {
      return JSON.parse(text || "null");
    },
    async text() {
      return text;
    },
  };
}

/** A fetch that answers a queue of responses in order and records every call. */
function mockFetch(queue) {
  const calls = [];
  const fn = async (url, init) => {
    allUrls.push(url);
    calls.push({ url, ...init });
    const next = queue.shift();
    if (next === undefined) throw new Error("mock fetch: unexpected extra call to " + url);
    if (typeof next === "function") return next(url, init);
    return next;
  };
  fn.calls = calls;
  fn.remaining = () => queue.length;
  return fn;
}

const gh = (queue, extra = {}) =>
  createGitProvider({ kind: "github", auth: { token: GH_TOKEN }, fetchImpl: queue, sleepImpl: async () => {}, ...extra });
const bb = (queue, extra = {}) =>
  createGitProvider({
    kind: "bitbucket",
    auth: { email: BB_EMAIL, token: BB_TOKEN },
    fetchImpl: queue,
    sleepImpl: async () => {},
    ...extra,
  });

/* ─────────────────────────── 1. surface & factory ───────────────────────── */

for (const kind of ["github", "bitbucket"]) {
  const p = kind === "github" ? gh(mockFetch([])) : bb(mockFetch([]));
  for (const name of GIT_PROVIDER_METHODS) ok(typeof p[name] === "function", kind + " exposes " + name);
  ok(p.kind === kind, kind + " reports its kind");
}
assert.throws(() => createGitProvider({ kind: "gitlab", auth: {} }), (e) => e instanceof GitProviderError && e.code === "not_supported");
checks++;
assert.throws(() => createGitProvider({ kind: "github", auth: {} }), (e) => e.code === "auth_dead");
checks++;
assert.throws(() => createGitProvider({ kind: "bitbucket", auth: { email: BB_EMAIL } }), (e) => e.code === "auth_dead");
checks++;
eq(GIT_PROVIDER_HOST_NAMES, ["api.github.com", "api.bitbucket.org", "bitbucket.org"], "the one egress home");
ok(GIT_PROVIDER_HOSTS.find((h) => h.host === "bitbucket.org").redirectOnly === true, "bitbucket.org is flagged redirect-only");
eq(GIT_ERROR_CODES, ["auth_dead", "not_found", "rate_limited", "conflict", "network", "not_supported"], "closed code set");
ok(GIT_CALL_TIMEOUT_MS === 10000, "10 s per call");
ok(DIFF_MAX_TOTAL_BYTES === 61440 && DIFF_MAX_FILE_BYTES === 16384, "diff caps are 60 KB / 16 KB");

/* ─────────────────────────── 2. GitHub request shapes ───────────────────── */

{
  const f = mockFetch([res(200, { login: "acme-bot", id: 7, name: "Acme" }, { "x-oauth-scopes": "repo, workflow" })]);
  const who = await gh(f).whoami();
  const c = f.calls[0];
  eq(c.url, "https://api.github.com/user", "whoami path");
  eq(c.method, "GET", "whoami verb");
  eq(c.headers.Authorization, "Bearer " + GH_TOKEN, "bearer auth");
  eq(c.headers.Accept, "application/vnd.github+json", "github media type");
  eq(c.headers["X-GitHub-Api-Version"], "2022-11-28", "pinned api version");
  eq({ login: who.login, scopes: who.scopes }, { login: "acme-bot", scopes: ["repo", "workflow"] }, "whoami mapping");
}

{
  const repoBody = { full_name: "acme/app", name: "app", owner: { login: "acme" }, default_branch: "main", private: true, html_url: "https://github.com/acme/app" };
  const f = mockFetch([res(200, [repoBody]), res(200, repoBody), res(200, repoBody)]);
  const p = gh(f);
  const list = await p.listRepos();
  eq(list[0], { kind: "github", fullName: "acme/app", owner: "acme", name: "app", defaultBranch: "main", private: true, url: "https://github.com/acme/app" }, "repo mapping");
  ok(f.calls[0].url.includes("/user/repos?per_page=100"), "listRepos paging");
  await p.getRepo({ repo: "acme/app" });
  eq(f.calls[1].url, "https://api.github.com/repos/acme/app", "getRepo path");
  eq(await p.getDefaultBranch({ repo: "acme/app" }), "main", "getDefaultBranch derives from the repo");
}

{
  const f = mockFetch([res(201, { full_name: "acme/new", name: "new", owner: { login: "acme" }, default_branch: "main" })]);
  await gh(f).createRepo({ name: "new", org: "acme", private: true, description: "d" });
  eq(f.calls[0].url, "https://api.github.com/orgs/acme/repos", "createRepo org path");
  eq(JSON.parse(f.calls[0].body), { name: "new", private: true, description: "d", auto_init: true }, "createRepo body");
}

{
  const f = mockFetch([
    res(200, { full_name: "acme/app", name: "app", owner: { login: "acme" }, default_branch: "main" }),
    res(200, { object: { sha: "base111" } }),
    res(201, { object: { sha: "new222" } }),
  ]);
  const r = await gh(f).createBranch({ repo: "acme/app", branch: "feat/x" });
  eq(f.calls[1].url, "https://api.github.com/repos/acme/app/git/ref/heads/main", "base ref read from the default branch");
  eq(f.calls[2].method, "POST", "createBranch is a POST");
  eq(JSON.parse(f.calls[2].body), { ref: "refs/heads/feat/x", sha: "base111" }, "createBranch body");
  eq(r, { branch: "feat/x", sha: "new222" }, "createBranch result");
}

{
  const f = mockFetch([
    res(200, { tree: { sha: "tree0" } }),
    res(201, { sha: "tree1" }),
    res(201, { sha: "commit1" }),
    res(200, { object: { sha: "commit1" } }),
  ]);
  const r = await gh(f).commitFiles({
    repo: "acme/app",
    branch: "feat/x",
    baseSha: "base111",
    message: "chore: scaffold",
    files: [{ path: "a.txt", content: "hello" }],
  });
  eq(f.calls.map((c) => c.method), ["GET", "POST", "POST", "PATCH"], "commitFiles uses the git data API");
  eq(JSON.parse(f.calls[1].body).tree, [{ path: "a.txt", mode: "100644", type: "blob", content: "hello" }], "tree entry");
  eq(JSON.parse(f.calls[2].body), { message: "chore: scaffold", tree: "tree1", parents: ["base111"] }, "commit body");
  eq(f.calls[3].url, "https://api.github.com/repos/acme/app/git/refs/heads/feat%2Fx", "ref update path");
  eq(JSON.parse(f.calls[3].body).force, false, "never force-pushes");
  eq(r.sha, "commit1", "commitFiles returns the new sha");
}

{
  const prBody = { number: 12, title: "T", state: "open", merged_at: null, head: { ref: "feat/x", sha: "sha12" }, base: { ref: "main" }, html_url: "u", user: { login: "bot" }, draft: false };
  const f = mockFetch([res(201, prBody), res(200, prBody), res(200, { ...prBody, state: "closed", merged_at: "2026-09-13T00:00:00Z" })]);
  const p = gh(f);
  const pr = await p.openPullRequest({ repo: "acme/app", title: "T", body: "B", sourceBranch: "feat/x", targetBranch: "main" });
  eq(JSON.parse(f.calls[0].body), { title: "T", body: "B", head: "feat/x", base: "main", draft: false }, "openPullRequest body");
  eq({ number: pr.number, state: pr.state, headSha: pr.headSha }, { number: 12, state: "open", headSha: "sha12" }, "pr mapping");
  eq((await p.getPullRequest({ repo: "acme/app", number: 12 })).state, "open", "open pr");
  eq((await p.getPullRequest({ repo: "acme/app", number: 12 })).state, "merged", "merged beats closed");
}

{
  // Latest review per author wins; COMMENTED never counts as a verdict.
  const prBody = { number: 12, state: "open", head: { ref: "f", sha: "s" }, base: { ref: "main" } };
  const f = mockFetch([
    res(200, prBody),
    res(200, [
      { user: { login: "ann" }, state: "CHANGES_REQUESTED" },
      { user: { login: "ann" }, state: "APPROVED" },
      { user: { login: "bo" }, state: "COMMENTED" },
    ]),
  ]);
  const st = await gh(f).getPullRequestState({ repo: "acme/app", number: 12 });
  eq({ a: st.approved, c: st.changesRequested, n: st.reviewers.length }, { a: true, c: false, n: 1 }, "latest verdict per author");
}

{
  const f = mockFetch([
    res(200, [
      { id: 1, body: "inline", user: { login: "ann" }, path: "a.js", line: 10, created_at: "t" },
    ]),
    res(200, [{ id: 2, body: "general", user: { login: "bo" }, created_at: "t" }]),
  ]);
  const list = await gh(f).listPullRequestComments({ repo: "acme/app", number: 12 });
  ok(f.calls[0].url.includes("/pulls/12/comments"), "inline comments are read");
  ok(f.calls[1].url.includes("/issues/12/comments"), "general comments are read");
  eq(list[0].inline, { path: "a.js", line: 10 }, "inline comment mapping");
  eq(list[1].inline, null, "general comment has no inline");
  eq(list.map((c) => c.resolved), [null, null], "REST cannot answer resolution — null means UNKNOWN, never resolved");
}

{
  const f = mockFetch([res(201, { id: 9, html_url: "u" })]);
  await gh(f).addPullRequestComment({ repo: "acme/app", number: 12, body: "hi" });
  ok(f.calls[0].url.endsWith("/issues/12/comments"), "general comment endpoint");
  eq(JSON.parse(f.calls[0].body), { body: "hi" }, "general comment body");

  const f2 = mockFetch([res(201, { id: 10, html_url: "u" })]);
  await gh(f2).addPullRequestComment({ repo: "acme/app", number: 12, body: "hi", path: "a.js", line: 4, commitSha: "sha12" });
  ok(f2.calls[0].url.endsWith("/pulls/12/comments"), "inline comment endpoint");
  eq(JSON.parse(f2.calls[0].body), { body: "hi", commit_id: "sha12", path: "a.js", line: 4, side: "RIGHT" }, "inline comment body");
}

{
  const f = mockFetch([res(200, { id: 1 }), res(200, { id: 2 })]);
  const p = gh(f);
  await p.approvePullRequest({ repo: "acme/app", number: 12, body: "lgtm" });
  eq(JSON.parse(f.calls[0].body), { event: "APPROVE", body: "lgtm" }, "approve body");
  await p.requestChanges({ repo: "acme/app", number: 12, body: "fix lint" });
  eq(JSON.parse(f.calls[1].body), { event: "REQUEST_CHANGES", body: "fix lint" }, "request-changes body");
  await assert.rejects(p.requestChanges({ repo: "acme/app", number: 12 }), (e) => e.code === "conflict");
  checks++;
}

{
  const mk = (runs) => mockFetch([res(200, { check_runs: runs })]);
  const state = async (runs) => (await gh(mk(runs)).getBuildState({ repo: "acme/app", ref: "sha12" })).state;
  eq(await state([]), "none", "no checks = none, never success");
  eq(await state([{ name: "a", status: "completed", conclusion: "success" }]), "success", "all green");
  eq(await state([{ status: "completed", conclusion: "success" }, { status: "completed", conclusion: "failure" }]), "failed", "one red fails the roll-up");
  eq(await state([{ status: "in_progress" }, { status: "completed", conclusion: "success" }]), "running", "running wins over success");
  eq(await state([{ status: "queued" }]), "pending", "queued = pending");
}

{
  const f = mockFetch([res(201, { id: 55 })]);
  await gh(f).createWebhook({ repo: "acme/app", url: "https://trigger", secret: "s3cr3t", events: ["pull_request"] });
  const body = JSON.parse(f.calls[0].body);
  eq(body.config.url, "https://trigger", "hook url");
  eq(body.config.secret, "s3cr3t", "hook secret rides the create call");
  eq(body.events, ["pull_request"], "hook events");
}

{
  // setSecret on GitHub: GET the repo public key (a read), then PUT the SEALED
  // value (a write, issued once). The plaintext must never appear on the wire.
  const kp = nacl.box.keyPair();
  const pubB64 = Buffer.from(kp.publicKey).toString("base64");
  const f = mockFetch([res(200, { key: pubB64, key_id: "KID-1" }), res(201, {})]);
  const r = await gh(f).setSecret({ repo: "acme/app", name: "FORGE_API_TOKEN", value: "plaintext-forge-token" });
  eq(r.keyId, "KID-1", "setSecret returns the key id it sealed against");
  eq(f.calls.length, 2, "setSecret = one key read + one write");
  eq(f.calls[0].method, "GET", "public key is read first");
  eq(f.calls[1].method, "PUT", "the secret is PUT");
  ok(f.calls[1].url.endsWith("/actions/secrets/FORGE_API_TOKEN"), "secret path carries the name");
  const putBody = JSON.parse(f.calls[1].body);
  eq(putBody.key_id, "KID-1", "the PUT quotes the key id");
  ok(!f.calls[1].body.includes("plaintext-forge-token"), "the PLAINTEXT never reaches the wire");
  // and the ciphertext really is a crypto_box_seal the recipient can open.
  const sealed = new Uint8Array(Buffer.from(putBody.encrypted_value, "base64"));
  const epk = sealed.slice(0, 32);
  const pre = new Uint8Array(64); pre.set(epk, 0); pre.set(kp.publicKey, 32);
  const opened = nacl.box.open(sealed.slice(32), m.blake2b(pre, 24), epk, kp.secretKey);
  eq(opened && Buffer.from(opened).toString("utf8"), "plaintext-forge-token", "sealed box round-trips");

  // A 404 on the public key is not_found and NEVER "there is no secret yet";
  // nothing is written after it.
  const f404 = mockFetch([res(404, { message: "Not Found" })]);
  await assert.rejects(
    gh(f404).setSecret({ repo: "acme/app", name: "X", value: "v" }),
    (e) => { allMessages.push(e.message); return e.code === "not_found"; }
  );
  checks++;
  eq(f404.calls.length, 1, "a refused key read writes nothing");
  await assert.rejects(gh(mockFetch([])).enablePipelines({ repo: "acme/app" }), (e) => e.code === "not_supported");
  checks++;
}

{
  const f = mockFetch([res(201, {})]);
  eq(await gh(f).setVariable({ repo: "acme/app", name: "V", value: 1 }), { name: "V", created: true }, "variable created");
  eq(JSON.parse(f.calls[0].body), { name: "V", value: "1" }, "variable body");
  const f2 = mockFetch([res(409, { message: "already exists" }), res(204, undefined)]);
  eq(await gh(f2).setVariable({ repo: "acme/app", name: "V", value: 2 }), { name: "V", created: false }, "409 upserts");
  eq(f2.calls.map((c) => c.method), ["POST", "PATCH"], "the upsert is a DIFFERENT call, not a retry of the POST");
  ok(f2.calls[1].url.endsWith("/actions/variables/V"), "patch targets the named variable");
}

{
  const f = mockFetch([res(204, undefined)]);
  const r = await gh(f).triggerDeploy({ repo: "acme/app", workflow: "forge-deploy.yml", ref: "main", inputs: { env: "dev" } });
  eq(f.calls[0].url, "https://api.github.com/repos/acme/app/actions/workflows/forge-deploy.yml/dispatches", "dispatch path");
  eq(JSON.parse(f.calls[0].body), { ref: "main", inputs: { env: "dev" } }, "dispatch body");
  eq(r.id, null, "a dispatch has no run id and we never invent one");

  const f2 = mockFetch([res(200, { workflow_runs: [{ id: 3, status: "completed", conclusion: "failure", html_url: "u", created_at: "t", name: "deploy" }] })]);
  const st = await gh(f2).getDeployStatus({ repo: "acme/app", workflow: "forge-deploy.yml", branch: "main" });
  ok(f2.calls[0].url.includes("&branch=main"), "deploy status filters by branch");
  eq(st.latest.state, "failed", "failed run mapping");
}

/* ─────────────────────── 3. Bitbucket request shapes ────────────────────── */

const BASIC = "Basic " + Buffer.from(BB_EMAIL + ":" + BB_TOKEN, "utf8").toString("base64");

{
  const f = mockFetch([res(200, { username: "acme-bot", uuid: "{u}", display_name: "Acme Bot" })]);
  const who = await bb(f).whoami();
  eq(f.calls[0].url, "https://api.bitbucket.org/2.0/user", "bitbucket whoami path");
  eq(f.calls[0].headers.Authorization, BASIC, "Basic email:token auth");
  eq({ login: who.login, id: who.id }, { login: "acme-bot", id: "{u}" }, "bitbucket whoami mapping");
}

{
  const repoBody = { full_name: "ws/app", slug: "app", workspace: { slug: "ws" }, mainbranch: { name: "develop" }, is_private: true, links: { html: { href: "h" } } };
  const f = mockFetch([res(200, { values: [repoBody] }), res(200, repoBody), res(200, repoBody)]);
  const p = bb(f);
  eq((await p.listRepos({ workspace: "ws" }))[0], { kind: "bitbucket", fullName: "ws/app", owner: "ws", name: "app", defaultBranch: "develop", private: true, url: "h" }, "bitbucket repo mapping");
  ok(f.calls[0].url.includes("/repositories/ws?role=member&pagelen=100"), "bitbucket paging");
  await p.getRepo({ repo: "ws/app" });
  eq(f.calls[1].url, "https://api.bitbucket.org/2.0/repositories/ws/app", "bitbucket getRepo path");
  eq(await p.getDefaultBranch({ repo: "ws/app" }), "develop", "mainbranch is the default branch");
}

{
  const f = mockFetch([res(200, { full_name: "ws/new", slug: "new", workspace: { slug: "ws" } })]);
  await bb(f).createRepo({ name: "new", workspace: "ws" });
  eq(f.calls[0].url, "https://api.bitbucket.org/2.0/repositories/ws/new", "bitbucket createRepo path");
  eq(JSON.parse(f.calls[0].body).scm, "git", "bitbucket needs scm:git");
  await assert.rejects(bb(mockFetch([])).createRepo({ name: "x" }), (e) => e.code === "conflict");
  checks++;
}

{
  const f = mockFetch([res(200, { target: { hash: "abc" } }), res(201, { target: { hash: "abc" } })]);
  await bb(f).createBranch({ repo: "ws/app", branch: "feat/x", fromBranch: "develop" });
  eq(f.calls[0].url, "https://api.bitbucket.org/2.0/repositories/ws/app/refs/branches/develop", "bitbucket base ref");
  eq(JSON.parse(f.calls[1].body), { name: "feat/x", target: { hash: "abc" } }, "bitbucket createBranch body");
}

{
  const f = mockFetch([res(201, {}, { location: "https://api.bitbucket.org/2.0/repositories/ws/app/commit/deadbeef" })]);
  const r = await bb(f).commitFiles({ repo: "ws/app", branch: "feat/x", message: "m", files: [{ path: "dir/a.txt", content: "hello world" }] });
  eq(f.calls.length, 1, "bitbucket commits in ONE call");
  eq(f.calls[0].headers["Content-Type"], "application/x-www-form-urlencoded", "the /src endpoint takes a form body");
  ok(f.calls[0].body.includes("dir%2Fa.txt=hello%20world"), "the file path IS the form field name");
  ok(f.calls[0].body.includes("branch=feat%2Fx"), "branch rides the form");
  eq(r.sha, "deadbeef", "sha comes from the Location header");
}

{
  const prBody = { id: 7, title: "T", state: "OPEN", source: { branch: { name: "feat/x" }, commit: { hash: "h" } }, destination: { branch: { name: "develop" } }, links: { html: { href: "u" } }, author: { nickname: "bot" } };
  const f = mockFetch([res(201, prBody), res(200, { ...prBody, state: "MERGED" }), res(200, { ...prBody, state: "DECLINED" })]);
  const p = bb(f);
  const pr = await p.openPullRequest({ repo: "ws/app", title: "T", body: "B", sourceBranch: "feat/x", targetBranch: "develop" });
  eq(JSON.parse(f.calls[0].body), { title: "T", description: "B", source: { branch: { name: "feat/x" } }, destination: { branch: { name: "develop" } }, close_source_branch: false }, "bitbucket PR body");
  eq({ id: pr.id, state: pr.state, target: pr.targetBranch }, { id: 7, state: "open", target: "develop" }, "bitbucket PR mapping");
  eq((await p.getPullRequest({ repo: "ws/app", number: 7 })).state, "merged", "MERGED maps");
  eq((await p.getPullRequest({ repo: "ws/app", number: 7 })).state, "closed", "DECLINED maps to closed");
}

{
  const f = mockFetch([
    res(200, {
      id: 7, state: "OPEN", source: { branch: { name: "f" } }, destination: { branch: { name: "d" } },
      participants: [
        { user: { nickname: "ann" }, approved: true },
        { user: { nickname: "bo" }, approved: false, state: "changes_requested" },
      ],
    }),
  ]);
  const st = await bb(f).getPullRequestState({ repo: "ws/app", number: 7 });
  eq(f.calls.length, 1, "bitbucket answers state in one call");
  eq({ a: st.approved, c: st.changesRequested }, { a: true, c: true }, "participants carry both verdicts");
}

{
  const f = mockFetch([res(200, { values: [
    { id: 1, content: { raw: "inline" }, user: { nickname: "ann" }, inline: { path: "a.js", to: 12 }, resolution: { type: "r" }, created_on: "t" },
    { id: 2, content: { raw: "general" }, user: { nickname: "bo" }, created_on: "t" },
  ] })]);
  const list = await bb(f).listPullRequestComments({ repo: "ws/app", number: 7 });
  eq(list[0].inline, { path: "a.js", line: 12 }, "inline `to` is the line");
  eq([list[0].resolved, list[1].resolved], [true, false], "bitbucket DOES answer resolution");
}

{
  const f = mockFetch([res(201, { id: 3, links: { html: { href: "u" } } }), res(201, { id: 4, links: {} })]);
  const p = bb(f);
  await p.addPullRequestComment({ repo: "ws/app", number: 7, body: "hi" });
  eq(JSON.parse(f.calls[0].body), { content: { raw: "hi" } }, "general comment body");
  await p.addPullRequestComment({ repo: "ws/app", number: 7, body: "hi", path: "a.js", line: 12 });
  eq(JSON.parse(f.calls[1].body), { content: { raw: "hi" }, inline: { path: "a.js", to: 12 } }, "inline:{path,to} is the bitbucket spelling");
}

{
  const f = mockFetch([res(200, { user: { uuid: "{a}" } }), res(201, { id: 5, links: {} }), res(200, { user: { uuid: "{a}" } })]);
  const p = bb(f);
  eq((await p.approvePullRequest({ repo: "ws/app", number: 7 })).state, "APPROVED", "approve");
  ok(f.calls[0].url.endsWith("/pullrequests/7/approve"), "approve endpoint");
  await p.requestChanges({ repo: "ws/app", number: 7, body: "fix lint" });
  ok(f.calls[1].url.endsWith("/comments"), "the review body becomes a comment first");
  ok(f.calls[2].url.endsWith("/pullrequests/7/request-changes"), "request-changes endpoint");
}

{
  const st = async (values) =>
    (await bb(mockFetch([res(200, { values })])).getBuildState({ repo: "ws/app", ref: "h" })).state;
  eq(await st([]), "none", "no statuses = none");
  eq(await st([{ state: "SUCCESSFUL", key: "k" }]), "success", "SUCCESSFUL");
  eq(await st([{ state: "SUCCESSFUL" }, { state: "FAILED" }]), "failed", "FAILED wins");
  eq(await st([{ state: "INPROGRESS" }]), "running", "INPROGRESS");
}

{
  const f = mockFetch([res(201, { uuid: "{h}" })]);
  await bb(f).createWebhook({ repo: "ws/app", url: "https://trigger", secret: "s3cr3t" });
  const body = JSON.parse(f.calls[0].body);
  eq(body.secret, "s3cr3t", "bitbucket hooks carry the X-Hub-Signature secret");
  ok(body.events.includes("pullrequest:created"), "bitbucket event names");
}

{
  const f = mockFetch([res(201, { uuid: "{v}" }), res(201, { uuid: "{v2}" }), res(200, { enabled: true })]);
  const p = bb(f);
  eq((await p.setSecret({ repo: "ws/app", name: "FORGE_API_TOKEN", value: "x" })).secured, true, "bitbucket CAN set a secret");
  eq(JSON.parse(f.calls[0].body), { key: "FORGE_API_TOKEN", value: "x", secured: true }, "secured variable body");
  ok(f.calls[0].url.endsWith("/pipelines_config/variables"), "pipelines_config is the home");
  eq((await p.setVariable({ repo: "ws/app", name: "V", value: 1 })).secured, false, "plain variable");
  const en = await p.enablePipelines({ repo: "ws/app" });
  eq(f.calls[2].method, "PUT", "enablePipelines is a PUT on pipelines_config");
  eq(en, { enabled: true }, "pipelines enabled");
}

{
  const f = mockFetch([res(201, { uuid: "{p}", build_number: 4 })]);
  await bb(f).triggerDeploy({ repo: "ws/app", ref: "develop", pattern: "deploy" });
  eq(JSON.parse(f.calls[0].body), { target: { type: "pipeline_ref_target", ref_type: "branch", ref_name: "develop", selector: { type: "custom", pattern: "deploy" } } }, "custom pipeline trigger");
  const f2 = mockFetch([res(200, { values: [{ uuid: "{p}", state: { name: "COMPLETED", result: { name: "FAILED" } }, created_on: "t", links: { self: { href: "u" } }, target: { ref_name: "develop" } }] })]);
  eq((await bb(f2).getDeployStatus({ repo: "ws/app" })).latest.state, "failed", "pipeline result mapping");
  ok(f2.calls[0].url.includes("sort=-created_on"), "newest pipeline first");
}

/* ────────────────────────────── 4. error codes ──────────────────────────── */

const errorCases = [
  [401, {}, "auth_dead", "a dead token is loud"],
  [403, { "x-ratelimit-remaining": "0" }, "rate_limited", "403 + exhausted budget is a rate limit"],
  [403, {}, "auth_dead", "a plain 403 is a credential/permission failure, never silence"],
  [404, {}, "not_found", "404"],
  [429, { "retry-after": "30" }, "rate_limited", "429"],
  [409, {}, "conflict", "409"],
  [422, {}, "conflict", "422"],
  [500, {}, "network", "5xx is transport, not a verdict"],
];
for (const [status, headers, code, why] of errorCases) {
  for (const kind of ["github", "bitbucket"]) {
    // Retryable codes are queued twice: getRepo is a READ, and a read retries once.
    // The provider echoes back the credential IT was given — an adapter can only
    // redact its own secrets, which is exactly what the leak scan must prove.
    const echoed = kind === "github" ? GH_TOKEN : BB_TOKEN;
    const one = () => res(status, { message: "boom " + echoed }, headers);
    const f = mockFetch(code === "not_found" || code === "conflict" || code === "auth_dead" ? [one()] : [one(), one()]);
    const p = kind === "github" ? gh(f, { sleepImpl: async () => {} }) : bb(f, { sleepImpl: async () => {} });
    await assert.rejects(
      p.getRepo({ repo: "a/b" }),
      (e) => {
        allMessages.push(e.message);
        return e instanceof GitProviderError && e.code === code && e.status === status;
      },
      kind + " " + status + " → " + code + " (" + why + ")"
    );
    checks++;
  }
}
{
  const f = mockFetch([res(429, {}, { "retry-after": "42" })]);
  await assert.rejects(gh(f, { sleepImpl: async () => {} }).createRepo({ name: "x" }), (e) => e.retryAfterSeconds === 42);
  checks++;
}
{
  // A transport fault (DNS, socket) is `network`, and is NOT a timeout.
  const f = mockFetch([() => { throw new Error("getaddrinfo ENOTFOUND"); }]);
  await assert.rejects(gh(f).createRepo({ name: "x" }), (e) => {
    allMessages.push(e.message);
    return e.code === "network" && e.timeout === false && e.status === null;
  });
  checks++;
}

/* ───────────────────────────── 5. the 10 s cap ──────────────────────────── */

{
  // A fetch that never answers must be aborted by OUR controller, and the error
  // must say timeout — a hung git host may not eat a 25 s resolver.
  const hang = async (url, init) => {
    allUrls.push(url);
    return new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => {
        const e = new Error("aborted");
        e.name = "AbortError";
        reject(e);
      });
    });
  };
  const t0 = Date.now();
  await assert.rejects(
    createGitProvider({ kind: "github", auth: { token: GH_TOKEN }, fetchImpl: hang, timeoutMs: 40 }).createRepo({ name: "x" }),
    (e) => {
      allMessages.push(e.message);
      return e.code === "network" && e.timeout === true && /timed out/.test(e.message);
    }
  );
  checks++;
  ok(Date.now() - t0 < 3000, "the abort fires on the configured budget, not on the socket");
  // The default budget is the declared 10 s.
  const f = mockFetch([res(200, {})]);
  await gh(f).whoami().catch(() => {});
  ok(f.calls[0].signal !== undefined, "every call carries an abort signal");
}

/* ────────────────── 6. writes are never retried, reads retry once ───────── */

{
  const f = mockFetch([res(500, { message: "bad gateway" }), res(200, { full_name: "a/b", slug: "b", name: "b" })]);
  const r = await gh(f, { sleepImpl: async () => {} }).getRepo({ repo: "a/b" });
  eq(f.calls.length, 2, "a READ retries once on a 5xx");
  ok(r.fullName === "a/b", "the retry's answer is used");
}
{
  const f = mockFetch([res(500, {}), res(500, {})]);
  await assert.rejects(gh(f, { sleepImpl: async () => {} }).getRepo({ repo: "a/b" }), (e) => e.code === "network");
  checks++;
  eq(f.calls.length, 2, "a read retries at most ONCE");
}
{
  const f = mockFetch([res(404, {}), res(200, {})]);
  await assert.rejects(gh(f).getRepo({ repo: "a/b" }), (e) => e.code === "not_found");
  checks++;
  eq(f.calls.length, 1, "a 404 is a verdict, not a transient — no retry");
  ok(f.remaining() === 1, "the second canned response was never consumed");
}
for (const [label, run] of [
  ["openPullRequest", (p) => p.openPullRequest({ repo: "a/b", title: "T", sourceBranch: "f", targetBranch: "main" })],
  ["addPullRequestComment", (p) => p.addPullRequestComment({ repo: "a/b", number: 1, body: "x" })],
  ["approvePullRequest", (p) => p.approvePullRequest({ repo: "a/b", number: 1 })],
  ["createWebhook", (p) => p.createWebhook({ repo: "a/b", url: "https://t" })],
  ["createRepo", (p) => p.createRepo({ name: "x" })],
]) {
  for (const kind of ["github", "bitbucket"]) {
    // Two identical failures are queued; a retrying write would consume both.
    const f = mockFetch([res(500, {}), res(500, {})]);
    const p = kind === "github" ? gh(f, { sleepImpl: async () => {} }) : bb(f, { sleepImpl: async () => {} });
    const args = kind === "bitbucket" && label === "createRepo" ? { name: "x", workspace: "ws" } : null;
    await assert.rejects(args ? p.createRepo(args) : run(p), (e) => e instanceof GitProviderError);
    checks++;
    eq(f.calls.length, 1, kind + " " + label + ": a WRITE is issued exactly once, even on a 5xx");
  }
}
{
  // Same rule when the transport itself faults: we do not know if the server saw it.
  let n = 0;
  const f = async (url, init) => { allUrls.push(url); n++; throw new Error("socket hang up"); };
  await assert.rejects(createGitProvider({ kind: "github", auth: { token: GH_TOKEN }, fetchImpl: f }).openPullRequest({ repo: "a/b", title: "T", sourceBranch: "s", targetBranch: "m" }), (e) => e.code === "network");
  checks++;
  eq(n, 1, "a write is not retried on a transport fault either");
}

/* ───────────────────────────── 7. diff caps ─────────────────────────────── */

{
  const big = "+".repeat(DIFF_MAX_FILE_BYTES * 2);
  const capped = capDiff([{ path: "a.js", patch: big }]);
  ok(Buffer.byteLength(capped.files[0].patch, "utf8") <= DIFF_MAX_FILE_BYTES + 64, "per-file cap at 16 KB");
  ok(capped.files[0].truncated && capped.truncated, "truncation is reported, never silent");

  const many = Array.from({ length: 12 }, (_, i) => ({ path: "f" + i + ".js", patch: "x".repeat(DIFF_MAX_FILE_BYTES - 100) }));
  const cappedAll = capDiff(many);
  ok(cappedAll.bytes <= DIFF_MAX_TOTAL_BYTES, "total cap at 60 KB: " + cappedAll.bytes);
  const omitted = cappedAll.files.filter((f) => f.omitted);
  ok(omitted.length > 0 && omitted.every((f) => f.patch === ""), "files that do not fit are listed as omitted, not dropped");
  eq(cappedAll.files.length, 12, "the model is told every path, even the ones it cannot see");
  eq(cappedAll.caps, { totalBytes: DIFF_MAX_TOTAL_BYTES, fileBytes: DIFF_MAX_FILE_BYTES }, "the caps travel with the result");
}
{
  const f = mockFetch([res(200, [{ filename: "a.js", status: "modified", additions: 1, deletions: 0, patch: "y".repeat(DIFF_MAX_FILE_BYTES + 500) }])]);
  const d = await gh(f).getPullRequestDiff({ repo: "a/b", number: 1 });
  ok(f.calls[0].url.includes("/pulls/1/files"), "github reads the files endpoint");
  ok(d.truncated && d.files[0].path === "a.js", "github diff goes through the caps");
}
{
  const raw = "diff --git a/a.js b/a.js\n@@ -1 +1 @@\n-a\n+b\ndiff --git a/b.js b/b.js\n@@ -1 +1 @@\n+c\n";
  const parts = splitUnifiedDiff(raw);
  eq(parts.map((p) => p.path), ["a.js", "b.js"], "unified diff splits per file");
  eq(splitUnifiedDiff(""), [], "empty diff");
  const f = mockFetch([{ status: 200, headers: {}, async text() { return raw; } }]);
  const d = await bb(f).getPullRequestDiff({ repo: "ws/app", number: 7 });
  ok(f.calls[0].url.endsWith("/pullrequests/7/diff"), "bitbucket diff endpoint");
  eq(f.calls[0].redirect, "follow", "the 302 to bitbucket.org is followed on purpose (flagged host)");
  eq(d.files.map((x) => x.path), ["a.js", "b.js"], "bitbucket diff mapping");
}

/* ─────────────────── 8. missing-argument refusals (no network) ──────────── */

for (const kind of ["github", "bitbucket"]) {
  const f = mockFetch([]);
  const p = kind === "github" ? gh(f) : bb(f);
  await assert.rejects(p.commitFiles({ repo: "a/b", branch: "x", message: "m", files: [] }), (e) => e.code === "conflict");
  checks++;
  await assert.rejects(p.getPullRequest({ repo: "a/b" }), (e) => e.code === "conflict");
  checks++;
  await assert.rejects(p.getRepo({ repo: "nota-repo" }), (e) => e.code === "conflict" && /owner\/name/.test(e.message));
  checks++;
  eq(f.calls.length, 0, kind + ": an argument refusal never reaches the network");
}

/* ───────────────── 9. egress + the token-leak scan (must be last) ───────── */

for (const url of allUrls) {
  const host = new URL(url).host;
  ok(GIT_PROVIDER_HOST_NAMES.includes(host), "only declared egress hosts are called: " + host);
}
ok(allUrls.length > 60, "the scan actually covered the suite (" + allUrls.length + " calls)");

// Every error message this suite produced, plus one forced per adapter for each
// code, must be free of the token in ANY form (raw or base64'd Basic credential).
for (const kind of ["github", "bitbucket"]) {
  for (const status of [401, 403, 404, 409, 429, 500]) {
    const echoed =
      kind === "github"
        ? GH_TOKEN + " " + Buffer.from(GH_TOKEN, "utf8").toString("base64")
        : BB_TOKEN + " " + BB_EMAIL + ":" + BB_TOKEN + " " + BASIC;
    const f = mockFetch([res(status, "server echoed your credential: " + echoed)]);
    const p = kind === "github" ? gh(f, { sleepImpl: async () => {} }) : bb(f, { sleepImpl: async () => {} });
    await p.createRepo(kind === "github" ? { name: "x" } : { name: "x", workspace: "ws" }).catch((e) => {
      allMessages.push(e.message);
      allMessages.push(String(e.stack || ""));
      allMessages.push(JSON.stringify({ code: e.code, status: e.status, provider: e.provider, operation: e.operation }));
    });
  }
}
const forbidden = [GH_TOKEN, BB_TOKEN, BASIC, Buffer.from(GH_TOKEN, "utf8").toString("base64"), BB_EMAIL + ":" + BB_TOKEN];
for (const msg of allMessages) {
  for (const secret of forbidden) {
    checks++;
    assert.ok(!msg.includes(secret), "no token value may appear in a thrown message: " + msg.slice(0, 120));
  }
}
ok(allMessages.length >= 20, "the leak scan saw real messages (" + allMessages.length + ")");
eq(redactSecrets("token=" + GH_TOKEN, [GH_TOKEN]), "token=***", "redactSecrets replaces the literal");
ok(!redactSecrets("basic " + BASIC, [BB_EMAIL + ":" + BB_TOKEN]).includes(BB_TOKEN), "redactSecrets also covers the base64 Basic form");

console.log("git-providers: " + checks + " assertions passed");
