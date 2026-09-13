/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * GIT PROVIDER LAYER — the SINGLE home of every outbound call CogniRunner makes
 * to a git host. One interface, two adapters (GitHub, Bitbucket). Release 1.4
 * commit 1 (plan §3.3, FRAME commit 2's "single home of the new rules").
 *
 * Why this file exists at all: without it, every call site (the Coder agent
 * actions, the PR-review listener, the pipeline-setup resolver, the Git
 * validators) would grow its own `if (kind === "bitbucket")`. Provider
 * differences — Basic `email:token` auth, `X-Hub-Signature` hooks, inline
 * comments shaped `inline:{path,to}`, the approve / request-changes endpoints,
 * `pipelines_config` — live INSIDE the adapter and are never visible to a
 * caller. A caller only ever sees the normalised shapes below and
 * `GitProviderError`.
 *
 * Contracts this module is the enforcement point for:
 *  - ONE error type, `GitProviderError`, with a closed code set:
 *    auth_dead | not_found | rate_limited | conflict | network | not_supported.
 *  - WRITES ARE NEVER RETRIED. A retried POST is a duplicate PR, a duplicate
 *    comment or a duplicate commit; at-least-once is the caller's problem to
 *    solve with an idempotency key, never ours to paper over. Reads may retry
 *    exactly once, and only on a transport fault or a 429/5xx.
 *  - 10 s per call, enforced by AbortController (same idiom as the LM Studio
 *    ping in src/index.js). Nothing here may outlive a 25 s sync resolver.
 *  - Diff caps: 60 KB total / 16 KB per file, enforced in getPullRequestDiff,
 *    because a PR diff is untrusted content that ends up in a model prompt.
 *  - NEVER LOG OR THROW A TOKEN. Every message goes through redactSecrets()
 *    before it leaves this module; auth headers are built at the last moment
 *    and are never attached to an error.
 *  - Egress: api.github.com and api.bitbucket.org only, plus bitbucket.org for
 *    the diff/src redirect (flagged — see GIT_PROVIDER_HOSTS).
 *
 * Dependency-free on purpose: it is imported by the backend and by an offline
 * mocked-fetch suite (test-harness/scripts/git-providers.test.mjs) that must
 * run with no Forge runtime.
 */

/**
 * The ONE home of the outbound hosts this app talks to for git. The manifest
 * egress bump reads this list — do not spell a host anywhere else.
 *
 * `bitbucket.org` is NOT an API host: Bitbucket's `/diff` and `/src` endpoints
 * answer 302 to it, so a fetch that follows redirects lands there. It is
 * flagged rather than silently bundled so the manifest reviewer sees why.
 */
export const GIT_PROVIDER_HOSTS = [
  { host: "api.github.com", kind: "github", why: "GitHub REST v3 API" },
  { host: "api.bitbucket.org", kind: "bitbucket", why: "Bitbucket Cloud REST 2.0 API" },
  {
    host: "bitbucket.org",
    kind: "bitbucket",
    redirectOnly: true,
    why: "Bitbucket /diff and /src answer 302 to this host; reached only by following a redirect, never called directly",
  },
];

/** Just the hostnames, in manifest order. */
export const GIT_PROVIDER_HOST_NAMES = GIT_PROVIDER_HOSTS.map((h) => h.host);

/** The provider kinds this module can build. */
export const GIT_PROVIDER_KINDS = ["github", "bitbucket"];

/** The closed error-code set. Anything outside it is a bug in this file. */
export const GIT_ERROR_CODES = [
  "auth_dead",
  "not_found",
  "rate_limited",
  "conflict",
  "network",
  "not_supported",
];

/** Per-call wall clock. Deliberately well under the 25 s sync resolver cap. */
export const GIT_CALL_TIMEOUT_MS = 10000;

/** Diff caps (plan §3.14 "bounded inputs everywhere"). */
export const DIFF_MAX_TOTAL_BYTES = 60 * 1024;
export const DIFF_MAX_FILE_BYTES = 16 * 1024;

/** Hard ceiling on any single list call, so a huge repo cannot blow the budget. */
export const LIST_PAGE_SIZE = 100;

const API_BASE = {
  github: "https://api.github.com",
  bitbucket: "https://api.bitbucket.org/2.0",
};

/**
 * The one error every method throws. `code` is from GIT_ERROR_CODES; `status`
 * is the HTTP status when there was one; `timeout` marks our own abort;
 * `retryAfterSeconds` is set for rate_limited when the host said so.
 */
export class GitProviderError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "GitProviderError";
    this.code = GIT_ERROR_CODES.includes(code) ? code : "network";
    this.provider = details.provider || null;
    this.operation = details.operation || null;
    this.status = typeof details.status === "number" ? details.status : null;
    this.timeout = details.timeout === true;
    this.retryAfterSeconds =
      typeof details.retryAfterSeconds === "number" ? details.retryAfterSeconds : null;
  }
}

/**
 * Scrub every known secret out of a string before it can reach an Error, a log
 * line or a resolver result. Called on EVERY message this module produces —
 * including the ones we build from a provider's own response body, because a
 * provider that echoes a bad credential back is exactly the 401 path.
 */
export function redactSecrets(text, secrets) {
  let out = String(text == null ? "" : text);
  for (const s of secrets || []) {
    if (typeof s !== "string" || s.length < 4) continue;
    // Split on the literal, which handles regex metacharacters in tokens.
    out = out.split(s).join("***");
    // Bitbucket Basic auth travels base64'd; redact that form too.
    const b64 = base64(s);
    if (b64.length >= 8) out = out.split(b64).join("***");
  }
  return out;
}

function base64(str) {
  if (typeof Buffer !== "undefined" && Buffer.from) return Buffer.from(str, "utf8").toString("base64");
  /* istanbul ignore next - browsers only */
  return btoa(unescape(encodeURIComponent(str)));
}

function byteLength(str) {
  if (typeof Buffer !== "undefined" && Buffer.byteLength) return Buffer.byteLength(str, "utf8");
  /* istanbul ignore next */
  return new TextEncoder().encode(str).length;
}

/** Truncate to a byte budget on a character boundary, with a visible marker. */
function clampBytes(str, maxBytes, marker) {
  const s = String(str == null ? "" : str);
  if (byteLength(s) <= maxBytes) return { text: s, truncated: false };
  let cut = s.slice(0, maxBytes);
  while (byteLength(cut) > maxBytes && cut.length > 0) cut = cut.slice(0, -64);
  return { text: cut + (marker || "\n… [truncated]"), truncated: true };
}

function isWriteMethod(method) {
  return method !== "GET" && method !== "HEAD";
}

/**
 * Status → code. The mapping is deliberate and the reasoning is written down,
 * because BREAK lens 2 ("can a 404 be read as 'the thing is absent'?") lands
 * squarely here: a 404 from a token that cannot SEE a repo is indistinguishable
 * from a repo that does not exist. So not_found NEVER authorises a write on its
 * own — callers must prove absence with a call the token demonstrably can make.
 */
function codeForStatus(status, bodyText, headers) {
  if (status === 401) return "auth_dead";
  if (status === 403) {
    const remaining = headers && headers.get && headers.get("x-ratelimit-remaining");
    if (remaining === "0" || /rate limit|secondary rate|too many requests/i.test(bodyText || "")) {
      return "rate_limited";
    }
    // A 403 that is not a rate limit is a credential/permission failure and is
    // LOUD: the connection's status goes dead and the banner comes up. Silent
    // "no restriction" is the failure mode this closes.
    return "auth_dead";
  }
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status === 409 || status === 422) return "conflict";
  if (status >= 500) return "network";
  return "conflict";
}

function retryAfterOf(headers) {
  const raw = headers && headers.get && headers.get("retry-after");
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Header bag shim so a mocked fetch may return a plain object for `headers`. */
function headerGetter(headers) {
  if (!headers) return { get: () => null };
  if (typeof headers.get === "function") return headers;
  const lower = {};
  for (const k of Object.keys(headers)) lower[String(k).toLowerCase()] = headers[k];
  return { get: (k) => (k && lower[String(k).toLowerCase()] !== undefined ? lower[String(k).toLowerCase()] : null) };
}

/**
 * Build the low-level client. One place holds the timeout, the retry policy,
 * the error mapping and the redaction — no adapter re-implements any of them.
 */
function makeClient(opts) {
  const {
    kind,
    baseUrl,
    authHeaders,
    defaultHeaders,
    secrets,
    fetchImpl,
    timeoutMs,
    sleepImpl,
  } = opts;

  const doFetch = fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (typeof doFetch !== "function") {
    throw new GitProviderError("network", "No fetch implementation available", { provider: kind });
  }
  const sleep = sleepImpl || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const limitMs = typeof timeoutMs === "number" && timeoutMs > 0 ? timeoutMs : GIT_CALL_TIMEOUT_MS;

  function fail(code, message, details) {
    return new GitProviderError(code, redactSecrets(message, secrets), { provider: kind, ...details });
  }

  async function once(operation, method, path, init) {
    const url = /^https?:/i.test(path) ? path : baseUrl + path;
    const ac = typeof AbortController === "function" ? new AbortController() : null;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (ac) ac.abort();
    }, limitMs);
    let resp;
    try {
      resp = await doFetch(url, {
        method,
        headers: { ...defaultHeaders, ...authHeaders(), ...((init && init.headers) || {}) },
        body: init && init.body !== undefined ? init.body : undefined,
        redirect: (init && init.redirect) || "follow",
        signal: ac ? ac.signal : undefined,
      });
    } catch (e) {
      const aborted = timedOut || (e && (e.name === "AbortError" || e.code === "ABORT_ERR"));
      throw fail(
        "network",
        aborted
          ? operation + ": timed out after " + limitMs / 1000 + "s"
          : operation + ": " + (e && e.message ? e.message : "network failure"),
        { timeout: !!aborted }
      );
    } finally {
      clearTimeout(timer);
    }

    const h = headerGetter(resp.headers);
    if (resp.status >= 200 && resp.status < 300) return { resp, headers: h };

    let bodyText = "";
    try {
      bodyText = typeof resp.text === "function" ? await resp.text() : "";
    } catch (_) {
      bodyText = "";
    }
    const code = codeForStatus(resp.status, bodyText, h);
    throw fail(code, operation + ": HTTP " + resp.status + (bodyText ? " — " + bodyText.slice(0, 300) : ""), {
      status: resp.status,
      operation,
      retryAfterSeconds: code === "rate_limited" ? retryAfterOf(h) : null,
    });
  }

  /**
   * The retry policy, in one place:
   *   - a WRITE (anything but GET/HEAD) is issued EXACTLY ONCE. Ever. Even a
   *     transport fault: we do not know whether the server saw it, and a second
   *     POST /pulls is a second pull request.
   *   - a READ retries at most once, and only for `network` (incl. timeout) or
   *     `rate_limited`.
   */
  async function request(operation, method, path, init) {
    try {
      return await once(operation, method, path, init);
    } catch (e) {
      const retryable = e instanceof GitProviderError && (e.code === "network" || e.code === "rate_limited");
      if (isWriteMethod(method) || !retryable) throw e;
      const waitMs = e.retryAfterSeconds ? Math.min(e.retryAfterSeconds * 1000, 2000) : 250;
      await sleep(waitMs);
      return once(operation, method, path, init);
    }
  }

  async function json(operation, method, path, body, extra) {
    const init = { ...(extra || {}) };
    if (body !== undefined) {
      init.body = typeof body === "string" ? body : JSON.stringify(body);
      init.headers = { "Content-Type": "application/json", ...(init.headers || {}) };
    }
    const { resp, headers } = await request(operation, method, path, init);
    if (resp.status === 204) return { data: null, headers };
    let data = null;
    try {
      if (typeof resp.json === "function") data = await resp.json();
      else if (typeof resp.text === "function") data = JSON.parse((await resp.text()) || "null");
    } catch (_) {
      data = null;
    }
    return { data, headers };
  }

  async function text(operation, method, path, init) {
    const { resp, headers } = await request(operation, method, path, init);
    const body = typeof resp.text === "function" ? await resp.text() : "";
    return { body: body || "", headers };
  }

  return { request, json, text, fail, secrets };
}

/* An async refusal, not a sync throw: every other method is awaited, and a
 * surface that mixes the two grows a call site that forgets the try/catch. */
function notSupported(kind, operation, why) {
  return async () => {
    throw new GitProviderError("not_supported", operation + " is not supported on " + kind + ": " + why, {
      provider: kind,
      operation,
    });
  };
}

function requireArg(kind, operation, name, value) {
  if (value === undefined || value === null || value === "") {
    throw new GitProviderError("conflict", operation + ": missing required argument `" + name + "`", {
      provider: kind,
      operation,
    });
  }
  return value;
}

function enc(v) {
  return encodeURIComponent(String(v));
}

/* Split "owner/name" (or accept {owner,repo} / {workspace,repoSlug}). */
function splitRepo(kind, operation, repo) {
  if (repo && typeof repo === "object") {
    const owner = repo.owner || repo.workspace;
    const name = repo.repo || repo.name || repo.slug || repo.repoSlug;
    if (owner && name) return { owner: String(owner), name: String(name) };
  }
  const s = String(repo || "");
  const i = s.indexOf("/");
  if (i > 0 && i < s.length - 1) return { owner: s.slice(0, i), name: s.slice(i + 1) };
  throw new GitProviderError("conflict", operation + ": repo must be \"owner/name\"", {
    provider: kind,
    operation,
  });
}

/* ── normalised shapes ──────────────────────────────────────────────────────
 * Every adapter answers in THESE shapes. A caller never branches on `kind`.
 *   repo:    { fullName, owner, name, defaultBranch, private, url, kind }
 *   pr:      { id, number, title, state: open|merged|closed, sourceBranch,
 *              targetBranch, url, headSha, author, draft }
 *   prState: { state, approved, changesRequested, mergeable, reviewers[] }
 *   comment: { id, body, author, createdAt, inline: {path,line}|null,
 *              resolved: boolean|null }
 *   build:   { state: success|failed|running|pending|none, url, name, checks[] }
 *   deploy:  { id, state, url, createdAt }
 * ------------------------------------------------------------------------ */

function prStateFromFlags(open, merged) {
  return merged ? "merged" : open ? "open" : "closed";
}

/* ════════════════════════════ GitHub adapter ════════════════════════════ */

function githubAdapter({ auth, fetchImpl, timeoutMs, sleepImpl }) {
  const token = (auth && (auth.token || auth.password)) || "";
  if (!token) {
    throw new GitProviderError("auth_dead", "github: no token configured", { provider: "github" });
  }
  const secrets = [token];
  const client = makeClient({
    kind: "github",
    baseUrl: API_BASE.github,
    authHeaders: () => ({ Authorization: "Bearer " + token }),
    defaultHeaders: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "CogniRunner",
    },
    secrets,
    fetchImpl,
    timeoutMs,
    sleepImpl,
  });

  const R = (repo, op) => splitRepo("github", op, repo);
  const repoPath = (repo, op) => {
    const { owner, name } = R(repo, op);
    return "/repos/" + enc(owner) + "/" + enc(name);
  };

  function mapRepo(d) {
    return {
      kind: "github",
      fullName: d.full_name,
      owner: d.owner && d.owner.login,
      name: d.name,
      defaultBranch: d.default_branch || null,
      private: !!d.private,
      url: d.html_url || null,
    };
  }

  function mapPr(d) {
    return {
      kind: "github",
      id: d.number,
      number: d.number,
      title: d.title,
      state: prStateFromFlags(d.state === "open", !!d.merged_at || d.merged === true),
      sourceBranch: d.head && d.head.ref,
      targetBranch: d.base && d.base.ref,
      headSha: (d.head && d.head.sha) || null,
      url: d.html_url || null,
      author: (d.user && d.user.login) || null,
      draft: !!d.draft,
    };
  }

  const api = {
    kind: "github",

    async whoami() {
      const { data, headers } = await client.json("whoami", "GET", "/user");
      return {
        kind: "github",
        login: (data && data.login) || null,
        id: (data && data.id) || null,
        name: (data && data.name) || null,
        scopes: String(headers.get("x-oauth-scopes") || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      };
    },

    async listRepos({ limit = LIST_PAGE_SIZE } = {}) {
      const { data } = await client.json(
        "listRepos",
        "GET",
        "/user/repos?per_page=" + Math.min(limit, LIST_PAGE_SIZE) + "&sort=updated"
      );
      return (Array.isArray(data) ? data : []).map(mapRepo);
    },

    async getRepo({ repo }) {
      const { data } = await client.json("getRepo", "GET", repoPath(repo, "getRepo"));
      return mapRepo(data || {});
    },

    async createRepo({ name, org, private: isPrivate = true, description = "" }) {
      requireArg("github", "createRepo", "name", name);
      const path = org ? "/orgs/" + enc(org) + "/repos" : "/user/repos";
      const { data } = await client.json("createRepo", "POST", path, {
        name,
        private: !!isPrivate,
        description,
        auto_init: true,
      });
      return mapRepo(data || {});
    },

    async getDefaultBranch({ repo }) {
      const r = await api.getRepo({ repo });
      return r.defaultBranch;
    },

    async createBranch({ repo, branch, fromBranch, fromSha }) {
      requireArg("github", "createBranch", "branch", branch);
      const base = repoPath(repo, "createBranch");
      let sha = fromSha;
      if (!sha) {
        const from = fromBranch || (await api.getDefaultBranch({ repo }));
        const { data } = await client.json(
          "createBranch",
          "GET",
          base + "/git/ref/heads/" + enc(from)
        );
        sha = data && data.object && data.object.sha;
      }
      if (!sha) {
        throw new GitProviderError("not_found", "createBranch: base branch has no commit", {
          provider: "github",
          operation: "createBranch",
        });
      }
      const { data } = await client.json("createBranch", "POST", base + "/git/refs", {
        ref: "refs/heads/" + branch,
        sha,
      });
      return { branch, sha: (data && data.object && data.object.sha) || sha };
    },

    /**
     * Files → one commit, via the git data API (blobs are inlined in the tree so
     * a small change is 4 calls, not 4 + N). Each step is a WRITE and therefore
     * unretried; a partial failure leaves dangling objects, never a moved ref.
     */
    async commitFiles({ repo, branch, message, files, baseSha }) {
      requireArg("github", "commitFiles", "branch", branch);
      requireArg("github", "commitFiles", "message", message);
      if (!Array.isArray(files) || files.length === 0) {
        throw new GitProviderError("conflict", "commitFiles: no files given", {
          provider: "github",
          operation: "commitFiles",
        });
      }
      const base = repoPath(repo, "commitFiles");
      let parent = baseSha;
      if (!parent) {
        const { data } = await client.json("commitFiles", "GET", base + "/git/ref/heads/" + enc(branch));
        parent = data && data.object && data.object.sha;
      }
      const { data: parentCommit } = await client.json(
        "commitFiles",
        "GET",
        base + "/git/commits/" + enc(parent)
      );
      const { data: tree } = await client.json("commitFiles", "POST", base + "/git/trees", {
        base_tree: parentCommit && parentCommit.tree && parentCommit.tree.sha,
        tree: files.map((f) => ({
          path: f.path,
          mode: f.mode || "100644",
          type: "blob",
          content: f.content == null ? "" : String(f.content),
        })),
      });
      const { data: commit } = await client.json("commitFiles", "POST", base + "/git/commits", {
        message,
        tree: tree && tree.sha,
        parents: [parent],
      });
      await client.json("commitFiles", "PATCH", base + "/git/refs/heads/" + enc(branch), {
        sha: commit && commit.sha,
        force: false,
      });
      return { sha: (commit && commit.sha) || null, branch, files: files.length };
    },

    async openPullRequest({ repo, title, body = "", sourceBranch, targetBranch, draft = false }) {
      requireArg("github", "openPullRequest", "title", title);
      requireArg("github", "openPullRequest", "sourceBranch", sourceBranch);
      const base = repoPath(repo, "openPullRequest");
      const target = targetBranch || (await api.getDefaultBranch({ repo }));
      const { data } = await client.json("openPullRequest", "POST", base + "/pulls", {
        title,
        body,
        head: sourceBranch,
        base: target,
        draft: !!draft,
      });
      return mapPr(data || {});
    },

    async getPullRequest({ repo, number }) {
      requireArg("github", "getPullRequest", "number", number);
      const { data } = await client.json(
        "getPullRequest",
        "GET",
        repoPath(repo, "getPullRequest") + "/pulls/" + enc(number)
      );
      return mapPr(data || {});
    },

    async getPullRequestState({ repo, number }) {
      const pr = await api.getPullRequest({ repo, number });
      const { data } = await client.json(
        "getPullRequestState",
        "GET",
        repoPath(repo, "getPullRequestState") + "/pulls/" + enc(number) + "/reviews?per_page=" + LIST_PAGE_SIZE
      );
      // Last review per author wins — GitHub keeps the history, the gate cares
      // about the CURRENT verdict.
      const latest = new Map();
      for (const r of Array.isArray(data) ? data : []) {
        const who = (r.user && r.user.login) || "?";
        if (r.state === "COMMENTED") continue;
        latest.set(who, r.state);
      }
      const verdicts = [...latest.entries()];
      return {
        kind: "github",
        state: pr.state,
        approved: verdicts.some(([, s]) => s === "APPROVED"),
        changesRequested: verdicts.some(([, s]) => s === "CHANGES_REQUESTED"),
        mergeable: null,
        reviewers: verdicts.map(([login, s]) => ({ login, state: s })),
        pr,
      };
    },

    async getPullRequestDiff({ repo, number }) {
      requireArg("github", "getPullRequestDiff", "number", number);
      const { data } = await client.json(
        "getPullRequestDiff",
        "GET",
        repoPath(repo, "getPullRequestDiff") + "/pulls/" + enc(number) + "/files?per_page=" + LIST_PAGE_SIZE
      );
      return capDiff(
        (Array.isArray(data) ? data : []).map((f) => ({
          path: f.filename,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
          patch: f.patch || "",
        }))
      );
    },

    async listPullRequestComments({ repo, number }) {
      requireArg("github", "listPullRequestComments", "number", number);
      const base = repoPath(repo, "listPullRequestComments");
      const { data: inline } = await client.json(
        "listPullRequestComments",
        "GET",
        base + "/pulls/" + enc(number) + "/comments?per_page=" + LIST_PAGE_SIZE
      );
      const { data: general } = await client.json(
        "listPullRequestComments",
        "GET",
        base + "/issues/" + enc(number) + "/comments?per_page=" + LIST_PAGE_SIZE
      );
      const map = (c, isInline) => ({
        kind: "github",
        id: c.id,
        body: c.body || "",
        author: (c.user && c.user.login) || null,
        createdAt: c.created_at || null,
        inline: isInline ? { path: c.path || null, line: c.line != null ? c.line : c.original_line } : null,
        // GitHub exposes thread resolution only through GraphQL; REST cannot
        // answer it, and `null` means UNKNOWN — never "resolved".
        resolved: null,
      });
      return [
        ...(Array.isArray(inline) ? inline : []).map((c) => map(c, true)),
        ...(Array.isArray(general) ? general : []).map((c) => map(c, false)),
      ];
    },

    async addPullRequestComment({ repo, number, body, path, line, commitSha }) {
      requireArg("github", "addPullRequestComment", "number", number);
      requireArg("github", "addPullRequestComment", "body", body);
      const base = repoPath(repo, "addPullRequestComment");
      if (path) {
        let sha = commitSha;
        if (!sha) sha = (await api.getPullRequest({ repo, number })).headSha;
        const { data } = await client.json(
          "addPullRequestComment",
          "POST",
          base + "/pulls/" + enc(number) + "/comments",
          { body, commit_id: sha, path, line, side: "RIGHT" }
        );
        return { id: data && data.id, inline: true, url: (data && data.html_url) || null };
      }
      const { data } = await client.json(
        "addPullRequestComment",
        "POST",
        base + "/issues/" + enc(number) + "/comments",
        { body }
      );
      return { id: data && data.id, inline: false, url: (data && data.html_url) || null };
    },

    async approvePullRequest({ repo, number, body = "" }) {
      requireArg("github", "approvePullRequest", "number", number);
      const { data } = await client.json(
        "approvePullRequest",
        "POST",
        repoPath(repo, "approvePullRequest") + "/pulls/" + enc(number) + "/reviews",
        { event: "APPROVE", body }
      );
      return { id: data && data.id, state: "APPROVED" };
    },

    async requestChanges({ repo, number, body = "" }) {
      requireArg("github", "requestChanges", "number", number);
      requireArg("github", "requestChanges", "body", body);
      const { data } = await client.json(
        "requestChanges",
        "POST",
        repoPath(repo, "requestChanges") + "/pulls/" + enc(number) + "/reviews",
        { event: "REQUEST_CHANGES", body }
      );
      return { id: data && data.id, state: "CHANGES_REQUESTED" };
    },

    async getBuildState({ repo, ref }) {
      requireArg("github", "getBuildState", "ref", ref);
      const { data } = await client.json(
        "getBuildState",
        "GET",
        repoPath(repo, "getBuildState") + "/commits/" + enc(ref) + "/check-runs?per_page=" + LIST_PAGE_SIZE
      );
      const runs = (data && Array.isArray(data.check_runs) ? data.check_runs : []).map((c) => ({
        name: c.name,
        status: c.status,
        conclusion: c.conclusion,
        url: c.html_url || null,
      }));
      return { kind: "github", ...rollUpChecks(runs), checks: runs };
    },

    async createWebhook({ repo, url, secret, events = ["pull_request", "push"] }) {
      requireArg("github", "createWebhook", "url", url);
      const { data } = await client.json("createWebhook", "POST", repoPath(repo, "createWebhook") + "/hooks", {
        name: "web",
        active: true,
        events,
        config: { url, content_type: "json", insecure_ssl: "0", secret },
      });
      return { id: data && data.id, url, events };
    },

    /**
     * NOT SUPPORTED, on purpose. A GitHub Actions secret must be encrypted with
     * the repository's public key using libsodium's crypto_box_seal. There is no
     * sealed-box implementation in this app's dependency tree (checked: package.json
     * carries no tweetnacl / libsodium-wrappers), and adding a dependency is an
     * owner's call, not a surgeon's. Until one lands, the pipeline-setup flow must
     * ask the admin to paste the secret in GitHub, and this refuses LOUDLY rather
     * than sending a plaintext secret to an endpoint that expects ciphertext.
     */
    setSecret: notSupported(
      "github",
      "setSecret",
      "Actions secrets require libsodium sealed-box encryption and no pure-JS libsodium (e.g. tweetnacl) is a dependency of this app; add one deliberately, or set the secret in the GitHub UI"
    ),

    async setVariable({ repo, name, value }) {
      requireArg("github", "setVariable", "name", name);
      const base = repoPath(repo, "setVariable") + "/actions/variables";
      try {
        await client.json("setVariable", "POST", base, { name, value: String(value == null ? "" : value) });
        return { name, created: true };
      } catch (e) {
        // 409 = the variable already exists. Updating it is UPSERT semantics, a
        // different call to a different path — not a retry of the POST.
        if (e instanceof GitProviderError && e.code === "conflict") {
          await client.json("setVariable", "PATCH", base + "/" + enc(name), {
            name,
            value: String(value == null ? "" : value),
          });
          return { name, created: false };
        }
        throw e;
      }
    },

    /* GitHub Actions is enabled by the presence of a workflow file — there is no
     * "enable pipelines" call. Bitbucket's pipelines_config has no counterpart. */
    enablePipelines: notSupported(
      "github",
      "enablePipelines",
      "GitHub Actions has no enable call — committing .github/workflows/*.yml is what enables it"
    ),

    async triggerDeploy({ repo, workflow, ref, inputs }) {
      requireArg("github", "triggerDeploy", "workflow", workflow);
      requireArg("github", "triggerDeploy", "ref", ref);
      await client.json(
        "triggerDeploy",
        "POST",
        repoPath(repo, "triggerDeploy") + "/actions/workflows/" + enc(workflow) + "/dispatches",
        { ref, inputs: inputs || {} }
      );
      // 204 No Content: the dispatch carries no run id. The caller polls
      // getDeployStatus by branch; we do NOT invent an id.
      return { dispatched: true, id: null, ref };
    },

    async getDeployStatus({ repo, workflow, branch, limit = 5 }) {
      const base = repoPath(repo, "getDeployStatus");
      const path = workflow
        ? base + "/actions/workflows/" + enc(workflow) + "/runs"
        : base + "/actions/runs";
      const q = "?per_page=" + Math.min(limit, LIST_PAGE_SIZE) + (branch ? "&branch=" + enc(branch) : "");
      const { data } = await client.json("getDeployStatus", "GET", path + q);
      const runs = (data && Array.isArray(data.workflow_runs) ? data.workflow_runs : []).map((r) => ({
        id: r.id,
        state: runStateOf(r.status, r.conclusion),
        url: r.html_url || null,
        createdAt: r.created_at || null,
        name: r.name || null,
      }));
      return { kind: "github", latest: runs[0] || null, runs };
    },
  };

  return api;
}

function runStateOf(status, conclusion) {
  if (status !== "completed") return status === "queued" ? "pending" : "running";
  if (conclusion === "success") return "success";
  if (conclusion === "cancelled" || conclusion === "skipped") return "pending";
  return "failed";
}

function rollUpChecks(runs) {
  if (runs.length === 0) return { state: "none", url: null, name: null };
  const states = runs.map((c) => runStateOf(c.status, c.conclusion));
  const pick = (s) => runs[states.indexOf(s)];
  if (states.includes("failed")) return { state: "failed", url: pick("failed").url, name: pick("failed").name };
  if (states.includes("running")) return { state: "running", url: pick("running").url, name: pick("running").name };
  if (states.includes("pending")) return { state: "pending", url: pick("pending").url, name: pick("pending").name };
  return { state: "success", url: runs[0].url, name: runs[0].name };
}

/**
 * Enforce the diff caps. A per-file patch is cut at 16 KB, and the whole set at
 * 60 KB; files that no longer fit are listed by name with `omitted: true` so the
 * model is told what it cannot see instead of silently reasoning about a subset.
 */
export function capDiff(files) {
  let total = 0;
  const out = [];
  let truncated = false;
  for (const f of files) {
    const capped = clampBytes(f.patch || "", DIFF_MAX_FILE_BYTES, "\n… [file diff truncated at 16 KB]");
    if (capped.truncated) truncated = true;
    const size = byteLength(capped.text);
    if (total + size > DIFF_MAX_TOTAL_BYTES) {
      out.push({ ...f, patch: "", omitted: true, truncated: true });
      truncated = true;
      continue;
    }
    total += size;
    out.push({ ...f, patch: capped.text, omitted: false, truncated: capped.truncated });
  }
  return { files: out, bytes: total, truncated, caps: { totalBytes: DIFF_MAX_TOTAL_BYTES, fileBytes: DIFF_MAX_FILE_BYTES } };
}

/* ══════════════════════════ Bitbucket adapter ══════════════════════════ */

function bitbucketAdapter({ auth, fetchImpl, timeoutMs, sleepImpl }) {
  // Bitbucket Cloud: Basic auth with the Atlassian ACCOUNT EMAIL and an API
  // token (app passwords are retired). `username` is accepted as a legacy alias.
  const user = (auth && (auth.email || auth.username)) || "";
  const token = (auth && (auth.token || auth.password || auth.appPassword)) || "";
  if (!user || !token) {
    throw new GitProviderError("auth_dead", "bitbucket: email + API token required", {
      provider: "bitbucket",
    });
  }
  const secrets = [token, user + ":" + token];
  const basic = "Basic " + base64(user + ":" + token);
  const client = makeClient({
    kind: "bitbucket",
    baseUrl: API_BASE.bitbucket,
    authHeaders: () => ({ Authorization: basic }),
    defaultHeaders: { Accept: "application/json", "User-Agent": "CogniRunner" },
    secrets,
    fetchImpl,
    timeoutMs,
    sleepImpl,
  });

  const repoPath = (repo, op) => {
    const { owner, name } = splitRepo("bitbucket", op, repo);
    return "/repositories/" + enc(owner) + "/" + enc(name);
  };

  function mapRepo(d) {
    return {
      kind: "bitbucket",
      fullName: d.full_name,
      owner: (d.workspace && d.workspace.slug) || (d.full_name || "").split("/")[0] || null,
      name: d.slug || d.name,
      defaultBranch: (d.mainbranch && d.mainbranch.name) || null,
      private: !!d.is_private,
      url: (d.links && d.links.html && d.links.html.href) || null,
    };
  }

  function mapPr(d) {
    const state = d.state === "OPEN" ? "open" : d.state === "MERGED" ? "merged" : "closed";
    return {
      kind: "bitbucket",
      id: d.id,
      number: d.id,
      title: d.title,
      state,
      sourceBranch: d.source && d.source.branch && d.source.branch.name,
      targetBranch: d.destination && d.destination.branch && d.destination.branch.name,
      headSha: (d.source && d.source.commit && d.source.commit.hash) || null,
      url: (d.links && d.links.html && d.links.html.href) || null,
      author: (d.author && (d.author.nickname || d.author.display_name)) || null,
      draft: !!d.draft,
    };
  }

  function form(fields) {
    const parts = [];
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined || v === null) continue;
      parts.push(enc(k) + "=" + enc(v));
    }
    return parts.join("&");
  }

  const api = {
    kind: "bitbucket",

    async whoami() {
      const { data } = await client.json("whoami", "GET", "/user");
      return {
        kind: "bitbucket",
        login: (data && (data.username || data.nickname)) || null,
        id: (data && data.uuid) || null,
        name: (data && data.display_name) || null,
        scopes: [],
      };
    },

    async listRepos({ workspace, limit = LIST_PAGE_SIZE } = {}) {
      const path = workspace
        ? "/repositories/" + enc(workspace) + "?role=member&pagelen=" + Math.min(limit, LIST_PAGE_SIZE)
        : "/repositories?role=member&pagelen=" + Math.min(limit, LIST_PAGE_SIZE);
      const { data } = await client.json("listRepos", "GET", path);
      return (data && Array.isArray(data.values) ? data.values : []).map(mapRepo);
    },

    async getRepo({ repo }) {
      const { data } = await client.json("getRepo", "GET", repoPath(repo, "getRepo"));
      return mapRepo(data || {});
    },

    async createRepo({ name, workspace, private: isPrivate = true, description = "" }) {
      requireArg("bitbucket", "createRepo", "name", name);
      requireArg("bitbucket", "createRepo", "workspace", workspace);
      const { data } = await client.json(
        "createRepo",
        "POST",
        "/repositories/" + enc(workspace) + "/" + enc(name),
        { scm: "git", is_private: !!isPrivate, description, project: undefined }
      );
      return mapRepo(data || {});
    },

    async getDefaultBranch({ repo }) {
      const r = await api.getRepo({ repo });
      return r.defaultBranch;
    },

    async createBranch({ repo, branch, fromBranch, fromSha }) {
      requireArg("bitbucket", "createBranch", "branch", branch);
      const base = repoPath(repo, "createBranch");
      let sha = fromSha;
      if (!sha) {
        const from = fromBranch || (await api.getDefaultBranch({ repo }));
        const { data } = await client.json("createBranch", "GET", base + "/refs/branches/" + enc(from));
        sha = data && data.target && data.target.hash;
      }
      if (!sha) {
        throw new GitProviderError("not_found", "createBranch: base branch has no commit", {
          provider: "bitbucket",
          operation: "createBranch",
        });
      }
      const { data } = await client.json("createBranch", "POST", base + "/refs/branches", {
        name: branch,
        target: { hash: sha },
      });
      return { branch, sha: (data && data.target && data.target.hash) || sha };
    },

    /**
     * Bitbucket has no git-data API: /src takes a form-encoded body whose FIELD
     * NAMES are the file paths. One request, one commit — and, being a write, it
     * is never retried.
     */
    async commitFiles({ repo, branch, message, files, baseSha }) {
      requireArg("bitbucket", "commitFiles", "branch", branch);
      requireArg("bitbucket", "commitFiles", "message", message);
      if (!Array.isArray(files) || files.length === 0) {
        throw new GitProviderError("conflict", "commitFiles: no files given", {
          provider: "bitbucket",
          operation: "commitFiles",
        });
      }
      const fields = { message, branch };
      if (baseSha) fields.parents = baseSha;
      for (const f of files) fields[f.path] = f.content == null ? "" : String(f.content);
      const { headers } = await client.request("commitFiles", "POST", repoPath(repo, "commitFiles") + "/src", {
        body: form(fields),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      // The commit hash comes back only as a Location header on the created ref.
      const loc = headers.get("location") || "";
      const m = loc.match(/\/commit\/([0-9a-f]{7,40})/i);
      return { sha: m ? m[1] : null, branch, files: files.length };
    },

    async openPullRequest({ repo, title, body = "", sourceBranch, targetBranch }) {
      requireArg("bitbucket", "openPullRequest", "title", title);
      requireArg("bitbucket", "openPullRequest", "sourceBranch", sourceBranch);
      const target = targetBranch || (await api.getDefaultBranch({ repo }));
      const { data } = await client.json(
        "openPullRequest",
        "POST",
        repoPath(repo, "openPullRequest") + "/pullrequests",
        {
          title,
          description: body,
          source: { branch: { name: sourceBranch } },
          destination: { branch: { name: target } },
          close_source_branch: false,
        }
      );
      return mapPr(data || {});
    },

    async getPullRequest({ repo, number }) {
      requireArg("bitbucket", "getPullRequest", "number", number);
      const { data } = await client.json(
        "getPullRequest",
        "GET",
        repoPath(repo, "getPullRequest") + "/pullrequests/" + enc(number)
      );
      return mapPr(data || {});
    },

    async getPullRequestState({ repo, number }) {
      requireArg("bitbucket", "getPullRequestState", "number", number);
      const { data } = await client.json(
        "getPullRequestState",
        "GET",
        repoPath(repo, "getPullRequestState") + "/pullrequests/" + enc(number)
      );
      const pr = mapPr(data || {});
      const parts = (data && Array.isArray(data.participants) ? data.participants : []).map((p) => ({
        login: (p.user && (p.user.nickname || p.user.display_name)) || null,
        state: p.approved ? "APPROVED" : p.state === "changes_requested" ? "CHANGES_REQUESTED" : "COMMENTED",
      }));
      return {
        kind: "bitbucket",
        state: pr.state,
        approved: parts.some((p) => p.state === "APPROVED"),
        changesRequested: parts.some((p) => p.state === "CHANGES_REQUESTED"),
        mergeable: null,
        reviewers: parts,
        pr,
      };
    },

    /**
     * /diff answers 302 to bitbucket.org (the flagged host in
     * GIT_PROVIDER_HOSTS). The body is a raw unified diff, so the per-file split
     * happens here before the caps are applied.
     */
    async getPullRequestDiff({ repo, number }) {
      requireArg("bitbucket", "getPullRequestDiff", "number", number);
      const { body } = await client.text(
        "getPullRequestDiff",
        "GET",
        repoPath(repo, "getPullRequestDiff") + "/pullrequests/" + enc(number) + "/diff",
        { headers: { Accept: "text/plain" }, redirect: "follow" }
      );
      return capDiff(splitUnifiedDiff(body));
    },

    async listPullRequestComments({ repo, number }) {
      requireArg("bitbucket", "listPullRequestComments", "number", number);
      const { data } = await client.json(
        "listPullRequestComments",
        "GET",
        repoPath(repo, "listPullRequestComments") +
          "/pullrequests/" + enc(number) + "/comments?pagelen=" + LIST_PAGE_SIZE
      );
      return (data && Array.isArray(data.values) ? data.values : []).map((c) => ({
        kind: "bitbucket",
        id: c.id,
        body: (c.content && c.content.raw) || "",
        author: (c.user && (c.user.nickname || c.user.display_name)) || null,
        createdAt: c.created_on || null,
        inline: c.inline ? { path: c.inline.path || null, line: c.inline.to != null ? c.inline.to : c.inline.from } : null,
        resolved: c.resolution ? true : false,
      }));
    },

    /** Inline comments are `inline: { path, to }` — the Bitbucket spelling stays here. */
    async addPullRequestComment({ repo, number, body, path, line }) {
      requireArg("bitbucket", "addPullRequestComment", "number", number);
      requireArg("bitbucket", "addPullRequestComment", "body", body);
      const payload = { content: { raw: body } };
      if (path) payload.inline = { path, to: line };
      const { data } = await client.json(
        "addPullRequestComment",
        "POST",
        repoPath(repo, "addPullRequestComment") + "/pullrequests/" + enc(number) + "/comments",
        payload
      );
      return {
        id: data && data.id,
        inline: !!path,
        url: (data && data.links && data.links.html && data.links.html.href) || null,
      };
    },

    async approvePullRequest({ repo, number }) {
      requireArg("bitbucket", "approvePullRequest", "number", number);
      const { data } = await client.json(
        "approvePullRequest",
        "POST",
        repoPath(repo, "approvePullRequest") + "/pullrequests/" + enc(number) + "/approve"
      );
      return { id: (data && data.user && data.user.uuid) || null, state: "APPROVED" };
    },

    /** Bitbucket has a first-class endpoint; there is no review body to carry. */
    async requestChanges({ repo, number, body }) {
      requireArg("bitbucket", "requestChanges", "number", number);
      if (body) await api.addPullRequestComment({ repo, number, body });
      const { data } = await client.json(
        "requestChanges",
        "POST",
        repoPath(repo, "requestChanges") + "/pullrequests/" + enc(number) + "/request-changes"
      );
      return { id: (data && data.user && data.user.uuid) || null, state: "CHANGES_REQUESTED" };
    },

    async getBuildState({ repo, ref }) {
      requireArg("bitbucket", "getBuildState", "ref", ref);
      const { data } = await client.json(
        "getBuildState",
        "GET",
        repoPath(repo, "getBuildState") + "/commit/" + enc(ref) + "/statuses?pagelen=" + LIST_PAGE_SIZE
      );
      const checks = (data && Array.isArray(data.values) ? data.values : []).map((s) => ({
        name: s.name || s.key || null,
        status: s.state,
        conclusion: s.state,
        url: s.url || null,
      }));
      const states = checks.map((c) =>
        c.status === "SUCCESSFUL" ? "success" : c.status === "INPROGRESS" ? "running" : c.status === "STOPPED" ? "pending" : "failed"
      );
      let state = "none";
      if (states.includes("failed")) state = "failed";
      else if (states.includes("running")) state = "running";
      else if (states.includes("pending")) state = "pending";
      else if (states.length) state = "success";
      const first = checks[states.indexOf(state)] || checks[0] || null;
      return { kind: "bitbucket", state, url: first ? first.url : null, name: first ? first.name : null, checks };
    },

    /**
     * Bitbucket signs hooks with `X-Hub-Signature` (the sha256= construction
     * GitHub uses on `X-Hub-Signature-256`). The secret rides the create call;
     * the verifier lives with the webtrigger, not here.
     */
    async createWebhook({ repo, url, secret, events = ["pullrequest:created", "pullrequest:updated", "repo:push"] }) {
      requireArg("bitbucket", "createWebhook", "url", url);
      const { data } = await client.json("createWebhook", "POST", repoPath(repo, "createWebhook") + "/hooks", {
        description: "CogniRunner",
        url,
        active: true,
        events,
        secret,
      });
      return { id: data && data.uuid, url, events };
    },

    /** Bitbucket takes the plaintext and stores it secured — no sealed box. */
    async setSecret({ repo, name, value }) {
      requireArg("bitbucket", "setSecret", "name", name);
      const { data } = await client.json(
        "setSecret",
        "POST",
        repoPath(repo, "setSecret") + "/pipelines_config/variables",
        { key: name, value: String(value == null ? "" : value), secured: true }
      );
      return { name, id: (data && data.uuid) || null, secured: true };
    },

    async setVariable({ repo, name, value }) {
      requireArg("bitbucket", "setVariable", "name", name);
      const { data } = await client.json(
        "setVariable",
        "POST",
        repoPath(repo, "setVariable") + "/pipelines_config/variables",
        { key: name, value: String(value == null ? "" : value), secured: false }
      );
      return { name, id: (data && data.uuid) || null, secured: false };
    },

    async enablePipelines({ repo, enabled = true }) {
      const { data } = await client.json(
        "enablePipelines",
        "PUT",
        repoPath(repo, "enablePipelines") + "/pipelines_config",
        { enabled: !!enabled }
      );
      return { enabled: data && data.enabled !== undefined ? !!data.enabled : !!enabled };
    },

    async triggerDeploy({ repo, ref, pattern, variables }) {
      requireArg("bitbucket", "triggerDeploy", "ref", ref);
      const target = pattern
        ? { type: "pipeline_ref_target", ref_type: "branch", ref_name: ref, selector: { type: "custom", pattern } }
        : { type: "pipeline_ref_target", ref_type: "branch", ref_name: ref };
      const payload = { target };
      if (Array.isArray(variables) && variables.length) payload.variables = variables;
      const { data } = await client.json(
        "triggerDeploy",
        "POST",
        repoPath(repo, "triggerDeploy") + "/pipelines/",
        payload
      );
      return { dispatched: true, id: (data && (data.uuid || data.build_number)) || null, ref };
    },

    async getDeployStatus({ repo, limit = 5 }) {
      const { data } = await client.json(
        "getDeployStatus",
        "GET",
        repoPath(repo, "getDeployStatus") + "/pipelines/?sort=-created_on&pagelen=" + Math.min(limit, LIST_PAGE_SIZE)
      );
      const runs = (data && Array.isArray(data.values) ? data.values : []).map((p) => ({
        id: p.uuid || p.build_number,
        state: pipelineStateOf(p.state),
        url: (p.links && p.links.self && p.links.self.href) || null,
        createdAt: p.created_on || null,
        name: (p.target && p.target.ref_name) || null,
      }));
      return { kind: "bitbucket", latest: runs[0] || null, runs };
    },
  };

  return api;
}

function pipelineStateOf(state) {
  const name = (state && state.name) || "";
  if (name === "IN_PROGRESS") return "running";
  if (name === "PENDING") return "pending";
  if (name === "COMPLETED") {
    const r = (state.result && state.result.name) || "";
    if (r === "SUCCESSFUL") return "success";
    if (r === "STOPPED") return "pending";
    return "failed";
  }
  return "pending";
}

/** Raw unified diff → [{ path, patch }]. Used by the Bitbucket adapter. */
export function splitUnifiedDiff(raw) {
  const text = String(raw || "");
  if (!text.trim()) return [];
  const out = [];
  let current = null;
  for (const line of text.split("\n")) {
    const m = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (m) {
      if (current) out.push(current);
      current = { path: m[2], status: "modified", patch: line + "\n" };
      continue;
    }
    if (current) current.patch += line + "\n";
  }
  if (current) out.push(current);
  return out;
}

/* ═════════════════════════════ the factory ═════════════════════════════ */

/**
 * Build a provider.
 *
 * @param {object}   o
 * @param {"github"|"bitbucket"} o.kind
 * @param {object}   o.auth        GitHub: { token }. Bitbucket: { email, token }.
 * @param {Function} [o.fetchImpl] injected for tests; defaults to global fetch.
 * @param {number}   [o.timeoutMs] defaults to GIT_CALL_TIMEOUT_MS (10 s).
 * @param {Function} [o.sleepImpl] injected for tests (read retry backoff only).
 * @returns an object with the full method set; every method throws only GitProviderError.
 */
export function createGitProvider({ kind, auth, fetchImpl, timeoutMs, sleepImpl } = {}) {
  if (!GIT_PROVIDER_KINDS.includes(kind)) {
    throw new GitProviderError("not_supported", "Unknown git provider kind: " + String(kind), {
      provider: String(kind || "none"),
    });
  }
  const args = { auth: auth || {}, fetchImpl, timeoutMs, sleepImpl };
  return kind === "github" ? githubAdapter(args) : bitbucketAdapter(args);
}

/** The method set every adapter must expose — asserted by the offline suite. */
export const GIT_PROVIDER_METHODS = [
  "whoami",
  "listRepos",
  "getRepo",
  "createRepo",
  "createBranch",
  "getDefaultBranch",
  "commitFiles",
  "openPullRequest",
  "getPullRequest",
  "getPullRequestState",
  "getPullRequestDiff",
  "listPullRequestComments",
  "addPullRequestComment",
  "approvePullRequest",
  "requestChanges",
  "getBuildState",
  "createWebhook",
  "setSecret",
  "setVariable",
  "enablePipelines",
  "triggerDeploy",
  "getDeployStatus",
];
