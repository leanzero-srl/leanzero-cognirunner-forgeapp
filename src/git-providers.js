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
 * ⚠ WHAT THIS MODULE GUARANTEES: BOUNDED, NOT SANITISED (F-271).
 * Every value returned here is size-capped, shape-normalised and secret-redacted.
 * It is NOT safe content: a PR title, body, comment, branch name, file path and
 * diff are all attacker-authored on a public repository, and this module does not
 * defang fence markers, strip prompt injections or escape markup. A CALLER THAT
 * PUTS ANY OF IT IN A PROMPT MUST FENCE IT AND RUN defangFence() ITSELF
 * (src/memories.js) — see src/git-review.js and src/git-actions.js. Do not "fix"
 * that here: defanging at the source would corrupt the content we commit and diff.
 *
 * NO FORGE RUNTIME on purpose: it is imported by the backend and by an offline
 * mocked-fetch suite (test-harness/scripts/git-providers.test.mjs) that runs
 * with no @forge/* module available. Its ONE npm dependency is `tweetnacl`
 * (pure JS, no native bindings — §4b row 35), needed for the GitHub Actions
 * sealed box below and for nothing else. It is NOT a src/shared/ module and
 * must never become one: src/shared/* bundles into the Custom UI iframes and
 * has to stay dependency-free.
 */
import nacl from "tweetnacl";

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
  // F-299 — a 403 that is NOT about the credential. A fine-grained PAT without access
  // to ONE repository, an org enforcing SAML on ONE org, a protected-branch rejection:
  // all 403, all per-RESOURCE, none of them a dead credential. They used to be reported
  // as `auth_dead`, which is connection-wide and killed every repo on that connection.
  "forbidden",
  "bad_request",
  "not_found",
  "rate_limited",
  "conflict",
  "network",
  "not_supported",
];

/** Redirect hops followed by hand, and the ceiling on an honoured Retry-After. */
const MAX_REDIRECT_HOPS = 3;
const RETRY_AFTER_MAX_MS = 10000;

/** Per-call wall clock. Deliberately well under the 25 s sync resolver cap. */
export const GIT_CALL_TIMEOUT_MS = 10000;

/** Diff caps (plan §3.14 "bounded inputs everywhere"). */
export const DIFF_MAX_TOTAL_BYTES = 60 * 1024;
export const DIFF_MAX_FILE_BYTES = 16 * 1024;

/**
 * Wall clock for ONE logical OPERATION, shared by every HTTP call it chains
 * (F-262). `commitFiles` is 4–5 calls: five independent 10 s timeouts is a 50 s
 * operation inside a 25 s resolver, so the budget — not the per-call timeout —
 * is what actually bounds it. Deliberately under the sync resolver cap.
 */
export const GIT_OPERATION_BUDGET_MS = 20000;

/**
 * Outbound commit caps, enforced AT THE ADAPTER (F-270). src/git-actions.js caps
 * the model's arguments too; this is the backstop for every OTHER caller
 * (pipeline setup, scaffolds, a future coder turn) — one bound they all inherit.
 */
export const COMMIT_MAX_FILES = 20;
export const COMMIT_MAX_TOTAL_BYTES = 200 * 1024;
export const COMMIT_MAX_FILE_BYTES = 64 * 1024;

/**
 * PR BODY cap on the normalised shape (F-282). The review engine reads `body`;
 * it is raw, attacker-authored text and the engine fences + defangs it.
 */
export const PR_BODY_MAX_BYTES = 8 * 1024;

/**
 * THE resolved-thread contract (F-269). Three values, three meanings:
 *   null  — NOT PROVEN. GitHub exposes thread resolution only through GraphQL, so
 *           REST cannot answer it. A validator must never read this as "resolved"
 *           NOR as "unresolved"; it is unknown and must say so.
 *   false — PROVEN UNRESOLVED (Bitbucket answers it directly).
 *   true  — PROVEN RESOLVED.
 */
export const PR_COMMENT_RESOLVED_UNKNOWN = null;

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

/**
 * Truncate to a byte budget on a character boundary, with a visible marker.
 * EXPORTED (F-287): the review engine needs the same maths, and a second copy of a
 * truncation rule is how a marker and a budget silently drift apart. Returns
 * `{ text, truncated }` — callers that only want the string take `.text`.
 */
export function clampBytes(str, maxBytes, marker) {
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
function codeForStatus(status, bodyText, headers, operation) {
  if (status === 401) return "auth_dead";
  if (status === 403) {
    const remaining = headers && headers.get && headers.get("x-ratelimit-remaining");
    if (remaining === "0" || /rate limit|secondary rate|too many requests/i.test(bodyText || "")) {
      return "rate_limited";
    }
    // F-299 — A 403 IS STILL LOUD, BUT IT IS NOT PROOF THE CREDENTIAL IS DEAD.
    //
    // `auth_dead` is CONNECTION-WIDE: every call site routes it to markAuthDead, the
    // row goes dead, and the only way out is a successful Test or a re-save. A 403 is
    // routinely per-RESOURCE (a fine-grained PAT that cannot see one repo, SSO on one
    // org, a protected branch), so one unlucky repository used to stop PR review for
    // every repository on that connection — and pressing Test cleared the banner,
    // because whoami never 403s, which is exactly the "banner that vanishes when
    // challenged" an operator cannot trust.
    //
    // The credential IS the subject of a 403 on `whoami`: that call asks nothing but
    // "who is this token". Only there does a 403 remain auth_dead.
    return operation === "whoami" ? "auth_dead" : "forbidden";
  }
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  // ONLY 409 is a conflict — "the thing you are acting on moved or already exists",
  // which is a RETRYABLE-BY-A-HUMAN state. 400/422 are "your request was wrong",
  // which is our bug or the model's argument, and a caller that retries it retries
  // forever. Two different answers deserve two different codes (F-265).
  if (status === 409) return "conflict";
  if (status >= 500) return "network";
  return "bad_request";
}

function retryAfterOf(headers) {
  const raw = headers && headers.get && headers.get("retry-after");
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * THE outbound host gate (F-264 / F-267). Every absolute URL this module fetches —
 * a caller-supplied `path`, or a Location header we are about to follow — must be
 * one of GIT_PROVIDER_HOSTS. The manifest allow-lists those hosts; anything else is
 * an SSRF the manifest would not have sanctioned, and a redirect is exactly how one
 * arrives. `http:` is refused outright: a token must never leave over plaintext.
 */
export function assertAllowedUrl(url, operation, kind, { redirected = false } = {}) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch (_) {
    throw new GitProviderError("bad_request", operation + ": not a valid URL", { provider: kind, operation });
  }
  // `not_supported`, deliberately, and NOT `network`: a refused host is a permanent
  // answer, and `network` is the one code a READ retries. Retrying an SSRF refusal
  // would just make the same forbidden request twice.
  if (parsed.protocol !== "https:") {
    throw new GitProviderError("not_supported", operation + ": refused a non-HTTPS URL (" + parsed.protocol + ")", { provider: kind, operation });
  }
  const host = parsed.hostname.toLowerCase();
  const entry = GIT_PROVIDER_HOSTS.find((h) => h.host === host) || null;
  if (!entry) {
    throw new GitProviderError("not_supported", operation + ': refused a URL outside the allowed git hosts ("' + parsed.hostname + '")', { provider: kind, operation });
  }
  // F-306 — the entry's OWN declarations are enforced, not just its hostname.
  //
  //  · `redirectOnly` means what it says: bitbucket.org is on the list because
  //    Bitbucket's /diff and /src answer 302 to it, NOT as a callable API host.
  //  · `kind` scopes the host to its provider. Without this, a 3xx served to a GITHUB
  //    call could carry the GitHub Authorization header to bitbucket.org — a host the
  //    manifest allow-listed for a Bitbucket redirect, never as a place a GitHub
  //    credential should be sent. The headers are reused on every hop, so the gate is
  //    the only thing that can prevent it.
  if (entry.redirectOnly && !redirected) {
    throw new GitProviderError("not_supported", operation + ': refused to call "' + host + '" directly (it is reachable only by following a redirect)', { provider: kind, operation });
  }
  if (kind && entry.kind && entry.kind !== kind) {
    throw new GitProviderError("not_supported", operation + ': refused to send a ' + kind + ' credential to "' + host + '" (a ' + entry.kind + ' host)', { provider: kind, operation });
  }
  return parsed.href;
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

  // fail(message, details, code) — `secrets` is read at CALL time, so a secret
  // registered mid-operation (a webhook secret, a variable value — F-266) is
  // redacted out of every message produced after it was registered.
  function fail(message, details, code = "network") {
    return new GitProviderError(code, redactSecrets(message, secrets), { provider: kind, ...details });
  }

  // F-262: one budget per logical OPERATION, shared by every call it chains.
  // `withBudget` nests safely — an inner budget can only ever be TIGHTER.
  let budgetDeadline = null;
  async function withBudget(totalMs, fn) {
    const prev = budgetDeadline;
    const want = Date.now() + (typeof totalMs === "number" && totalMs > 0 ? totalMs : GIT_OPERATION_BUDGET_MS);
    budgetDeadline = prev === null ? want : Math.min(prev, want);
    try { return await fn(); } finally { budgetDeadline = prev; }
  }

  async function once(operation, method, path, init) {
    let url = /^[a-z][a-z0-9+.-]*:/i.test(path) ? assertAllowedUrl(path, operation, kind) : baseUrl + path;
    const remaining = budgetDeadline === null ? Infinity : budgetDeadline - Date.now();
    if (remaining <= 0) {
      throw fail(operation + ": operation budget of " + GIT_OPERATION_BUDGET_MS / 1000 + "s exhausted", { timeout: true }, "network");
    }
    // F-305 — the per-call wall clock is recomputed PER HOP, below. It used to be
    // computed once, before the loop, and a fresh timer of that length was armed on
    // every hop: with MAX_REDIRECT_HOPS = 3 one `once()` could burn 4 × 10 s = 40 s,
    // past the 25 s sync-resolver cap, and the caller saw a platform timeout instead of
    // this module's own error. The operation budget did not save it either — only calls
    // wrapped in `withBudget` have one, and the Bitbucket adapters (the only reason the
    // redirect loop exists) are unwrapped.
    const callDeadline = Date.now() + Math.max(1, Math.min(limitMs, remaining === Infinity ? limitMs : remaining));
    let resp;
    // F-264/F-267: redirects are followed BY HAND (`redirect:"manual"`) so the host
    // gate sees every hop. `redirect:"follow"` would let a 302 carry the Authorization
    // header to a host the manifest never allow-listed. Bitbucket's /diff and /src
    // legitimately 302 to bitbucket.org, which IS on the list — that is the only
    // reason this loop exists. A WRITE is never redirect-followed: re-POSTing to a
    // new location is the duplicate-write this module refuses to risk.
    for (let hop = 0; ; hop++) {
      // What is LEFT of this call's clock (and of the operation budget, which another
      // chained call may have moved on) — never a fresh full timeout per hop.
      const budgetLeft = budgetDeadline === null ? Infinity : budgetDeadline - Date.now();
      const effectiveMs = Math.min(callDeadline - Date.now(), budgetLeft === Infinity ? Infinity : budgetLeft);
      if (!(effectiveMs > 0)) {
        throw fail(operation + ": timed out after " + limitMs / 1000 + "s" + (hop ? " (" + hop + " redirect hop(s))" : ""), { timeout: true }, "network");
      }
      const ac = typeof AbortController === "function" ? new AbortController() : null;
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; if (ac) ac.abort(); }, effectiveMs);
      try {
        resp = await doFetch(url, {
          method,
          headers: { ...defaultHeaders, ...authHeaders(), ...((init && init.headers) || {}) },
          body: init && init.body !== undefined ? init.body : undefined,
          redirect: "manual",
          signal: ac ? ac.signal : undefined,
        });
      } catch (e) {
        const aborted = timedOut || (e && (e.name === "AbortError" || e.code === "ABORT_ERR"));
        throw fail(
          aborted
            ? operation + ": timed out after " + effectiveMs / 1000 + "s"
            : operation + ": " + (e && e.message ? e.message : "network failure"),
          { timeout: !!aborted },
          "network"
        );
      } finally {
        clearTimeout(timer);
      }
      const isRedirect = resp.status >= 300 && resp.status < 400;
      if (!isRedirect) break;
      const location = headerGetter(resp.headers).get("location");
      if (!location) throw fail(operation + ": HTTP " + resp.status + " with no Location header", { status: resp.status, operation }, "network");
      if (isWriteMethod(method)) throw fail(operation + ": refused to follow a redirect on a write", { status: resp.status, operation }, "not_supported");
      if (hop >= MAX_REDIRECT_HOPS) throw fail(operation + ": too many redirects", { status: resp.status, operation }, "network");
      url = assertAllowedUrl(new URL(location, url).href, operation, kind, { redirected: true });
    }

    const h = headerGetter(resp.headers);
    if (resp.status >= 200 && resp.status < 300) return { resp, headers: h };

    let bodyText = "";
    try {
      bodyText = typeof resp.text === "function" ? await resp.text() : "";
    } catch (_) {
      bodyText = "";
    }
    const code = codeForStatus(resp.status, bodyText, h, operation);
    throw fail(operation + ": HTTP " + resp.status + (bodyText ? " — " + bodyText.slice(0, 300) : ""), {
      status: resp.status,
      operation,
      retryAfterSeconds: code === "rate_limited" ? retryAfterOf(h) : null,
    }, code);
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
      // F-268: the host told us when it will serve us again — honour it, up to 10 s.
      // Capping at 2 s meant the retry was issued while still rate-limited, burning
      // the one retry a read gets and turning a 1 s wait into a hard failure. The
      // operation budget still bounds the total, so a long Retry-After cannot hang.
      const waitMs = e.retryAfterSeconds ? Math.min(Math.max(e.retryAfterSeconds, 0) * 1000, RETRY_AFTER_MAX_MS) : 250;
      if (budgetDeadline !== null && Date.now() + waitMs >= budgetDeadline) throw e;
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
    // F-264: a body we cannot parse is an ERROR, never `null`. Swallowing it turned
    // an HTML error page / captive portal / proxy interstitial into `files: []` — a
    // PR that "has no changes", which is the false-negative that authorises a bad
    // review. An EMPTY body stays null: several endpoints legitimately answer 201
    // with nothing.
    let data = null;
    let raw = "";
    try {
      raw = typeof resp.text === "function" ? await resp.text() : "";
    } catch (e) {
      throw fail(operation + ": response body could not be read", { operation }, "network");
    }
    if (raw && raw.trim()) {
      try {
        data = JSON.parse(raw);
      } catch (_) {
        const looksHtml = /^\s*<(?:!doctype|html|\?xml)/i.test(raw);
        throw fail(
          operation + ": expected JSON but got " + (looksHtml ? "an HTML page" : "an unparseable body") + " — " + raw.slice(0, 200),
          { operation, status: resp.status },
          "network"
        );
      }
    }
    return { data, headers };
  }

  async function text(operation, method, path, init) {
    const { resp, headers } = await request(operation, method, path, init);
    const body = typeof resp.text === "function" ? await resp.text() : "";
    return { body: body || "", headers };
  }

  return { request, json, text, fail, secrets, withBudget };
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
    // A missing argument is a BAD REQUEST, never a conflict (F-265).
    throw new GitProviderError("bad_request", operation + ": missing required argument `" + name + "`", {
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
  throw new GitProviderError("bad_request", operation + ": repo must be \"owner/name\"", {
    provider: kind,
    operation,
  });
}

/* ── normalised shapes ──────────────────────────────────────────────────────
 * Every adapter answers in THESE shapes. A caller never branches on `kind`.
 *   repo:    { fullName, owner, name, defaultBranch, private, url, kind }
 *   pr:      { id, number, title, body, state: open|merged|closed, sourceBranch,
 *              targetBranch, url, headSha, author, draft }
 *              — `body` is the PR description, <= 8 KB, RAW (F-282).
 *   prState: { state, approved, changesRequested, mergeable, reviewers[] }
 *   comment: { id, body, author, createdAt, inline: {path,line}|null,
 *              resolved: true|false|null } — null is NOT PROVEN (GitHub REST cannot
 *              answer it); false is PROVEN unresolved (Bitbucket). See
 *              PR_COMMENT_RESOLVED_UNKNOWN (F-269).
 *   build:   { state: success|failed|running|pending|none, url, name, checks[] }
 *   deploy:  { id, state, url, createdAt }
 * ------------------------------------------------------------------------ */

function prStateFromFlags(open, merged) {
  return merged ? "merged" : open ? "open" : "closed";
}

/* ════════════════════════════ GitHub adapter ════════════════════════════ */

/* ===========================================================================
 * GITHUB SEALED BOX (libsodium crypto_box_seal, pure JS)
 *
 * A GitHub Actions secret is NOT sent in plaintext: the value must be sealed
 * to the repository's own Curve25519 public key with libsodium's
 * `crypto_box_seal`. This is the ONE home of that construction in the app —
 * `setSecret` on the GitHub adapter is its only caller, and nothing else may
 * grow a second copy.
 *
 * Why it is written out here instead of imported: `crypto_box_seal` needs
 * X25519 + XSalsa20-Poly1305 (tweetnacl, a declared dependency, pure JS, no
 * native bindings) AND BLAKE2b with a 24-BYTE digest for the nonce. Node's
 * `crypto` only offers `blake2b512` at a fixed 512-bit length, and BLAKE2b's
 * output length is part of its parameter block — truncating a 64-byte digest
 * is a DIFFERENT hash and would produce a nonce GitHub cannot reproduce. So
 * the digest is computed here (RFC 7693, the reference 32-bit-halves form).
 *
 * Proven, not assumed: the digest is asserted against independent BLAKE2b
 * vectors (including digest_size=24) and the whole sealed box is asserted to
 * round-trip against the reference `crypto_box_seal` layout in
 * test-harness/scripts/git-sealed-box.test.mjs.
 *
 * NEVER log a plaintext secret or a sealed box. The caller passes the value in
 * and gets ciphertext out; no intermediate is retained.
 * =========================================================================== */

const BLAKE2B_IV32 = new Uint32Array([
  0xf3bcc908, 0x6a09e667, 0x84caa73b, 0xbb67ae85,
  0xfe94f82b, 0x3c6ef372, 0x5f1d36f1, 0xa54ff53a,
  0xade682d1, 0x510e527f, 0x2b3e6c1f, 0x9b05688c,
  0xfb41bd6b, 0x1f83d9ab, 0x137e2179, 0x5be0cd19,
]);
const BLAKE2B_SIGMA = new Uint8Array([
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
  14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3,
  11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4,
  7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8,
  9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13,
  2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9,
  12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11,
  13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10,
  6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5,
  10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0,
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
  14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3,
].map((x) => x * 2));

function b2bAddAA(v, a, b) {
  const o0 = v[a] + v[b];
  let o1 = v[a + 1] + v[b + 1];
  if (o0 >= 0x100000000) o1++;
  v[a] = o0;
  v[a + 1] = o1;
}
function b2bAddAC(v, a, b0, b1) {
  let o0 = v[a] + b0;
  if (b0 < 0) o0 += 0x100000000;
  let o1 = v[a + 1] + b1;
  if (o0 >= 0x100000000) o1++;
  v[a] = o0;
  v[a + 1] = o1;
}
function b2bGet32(arr, i) {
  return arr[i] ^ (arr[i + 1] << 8) ^ (arr[i + 2] << 16) ^ (arr[i + 3] << 24);
}
function b2bG(v, m, a, b, c, d, ix, iy) {
  const x0 = m[ix], x1 = m[ix + 1], y0 = m[iy], y1 = m[iy + 1];
  b2bAddAA(v, a, b); b2bAddAC(v, a, x0, x1);
  let xor0 = v[d] ^ v[a], xor1 = v[d + 1] ^ v[a + 1];
  v[d] = xor1; v[d + 1] = xor0;
  b2bAddAA(v, c, d);
  xor0 = v[b] ^ v[c]; xor1 = v[b + 1] ^ v[c + 1];
  v[b] = (xor0 >>> 24) ^ (xor1 << 8); v[b + 1] = (xor1 >>> 24) ^ (xor0 << 8);
  b2bAddAA(v, a, b); b2bAddAC(v, a, y0, y1);
  xor0 = v[d] ^ v[a]; xor1 = v[d + 1] ^ v[a + 1];
  v[d] = (xor0 >>> 16) ^ (xor1 << 16); v[d + 1] = (xor1 >>> 16) ^ (xor0 << 16);
  b2bAddAA(v, c, d);
  xor0 = v[b] ^ v[c]; xor1 = v[b + 1] ^ v[c + 1];
  v[b] = (xor1 >>> 31) ^ (xor0 << 1); v[b + 1] = (xor0 >>> 31) ^ (xor1 << 1);
}
function b2bCompress(ctx, v, m, last) {
  for (let i = 0; i < 16; i++) { v[i] = ctx.h[i]; v[i + 16] = BLAKE2B_IV32[i]; }
  v[24] = v[24] ^ ctx.t;
  v[25] = v[25] ^ (ctx.t / 0x100000000);
  if (last) { v[28] = ~v[28]; v[29] = ~v[29]; }
  for (let i = 0; i < 32; i++) m[i] = b2bGet32(ctx.b, 4 * i);
  for (let i = 0; i < 12; i++) {
    const s = i * 16;
    b2bG(v, m, 0, 8, 16, 24, BLAKE2B_SIGMA[s + 0], BLAKE2B_SIGMA[s + 1]);
    b2bG(v, m, 2, 10, 18, 26, BLAKE2B_SIGMA[s + 2], BLAKE2B_SIGMA[s + 3]);
    b2bG(v, m, 4, 12, 20, 28, BLAKE2B_SIGMA[s + 4], BLAKE2B_SIGMA[s + 5]);
    b2bG(v, m, 6, 14, 22, 30, BLAKE2B_SIGMA[s + 6], BLAKE2B_SIGMA[s + 7]);
    b2bG(v, m, 0, 10, 20, 30, BLAKE2B_SIGMA[s + 8], BLAKE2B_SIGMA[s + 9]);
    b2bG(v, m, 2, 12, 22, 24, BLAKE2B_SIGMA[s + 10], BLAKE2B_SIGMA[s + 11]);
    b2bG(v, m, 4, 14, 16, 26, BLAKE2B_SIGMA[s + 12], BLAKE2B_SIGMA[s + 13]);
    b2bG(v, m, 6, 8, 18, 28, BLAKE2B_SIGMA[s + 14], BLAKE2B_SIGMA[s + 15]);
  }
  for (let i = 0; i < 16; i++) ctx.h[i] = ctx.h[i] ^ v[i] ^ v[i + 16];
}

/**
 * Unkeyed BLAKE2b with an arbitrary digest length (1..64 bytes).
 * Exported ONLY so the offline suite can assert it against published vectors.
 */
export function blake2b(input, outlen = 64) {
  if (!(outlen >= 1 && outlen <= 64)) {
    throw new GitProviderError("conflict", "blake2b: outlen must be 1..64");
  }
  const ctx = { b: new Uint8Array(128), h: new Uint32Array(16), t: 0, c: 0 };
  const v = new Uint32Array(32);
  const m = new Uint32Array(32);
  for (let i = 0; i < 16; i++) ctx.h[i] = BLAKE2B_IV32[i];
  ctx.h[0] ^= 0x01010000 ^ outlen;
  for (let i = 0; i < input.length; i++) {
    if (ctx.c === 128) { ctx.t += ctx.c; b2bCompress(ctx, v, m, false); ctx.c = 0; }
    ctx.b[ctx.c++] = input[i];
  }
  ctx.t += ctx.c;
  while (ctx.c < 128) ctx.b[ctx.c++] = 0;
  b2bCompress(ctx, v, m, true);
  const out = new Uint8Array(outlen);
  for (let i = 0; i < outlen; i++) out[i] = ctx.h[i >> 2] >> (8 * (i & 3));
  return out;
}

/**
 * libsodium `crypto_box_seal(message, recipientPk)`:
 *   ephemeral X25519 keypair → nonce = BLAKE2b-24(epk ‖ rpk) →
 *   box = crypto_box(message, nonce, rpk, esk) → output = epk ‖ box.
 * `ephemeralKeyPair` is injectable for the deterministic offline vector only;
 * production ALWAYS uses a fresh random pair (a reused ephemeral key is a
 * nonce reuse, which breaks the cipher).
 *
 * @param {Uint8Array} message       plaintext bytes
 * @param {Uint8Array} recipientPk   32-byte Curve25519 public key
 * @returns {Uint8Array} epk ‖ ciphertext
 */
export function sealBox(message, recipientPk, ephemeralKeyPair) {
  if (!(recipientPk instanceof Uint8Array) || recipientPk.length !== 32) {
    throw new GitProviderError("conflict", "sealBox: recipient public key must be 32 bytes");
  }
  const eph = ephemeralKeyPair || nacl.box.keyPair();
  const pre = new Uint8Array(64);
  pre.set(eph.publicKey, 0);
  pre.set(recipientPk, 32);
  const nonce = blake2b(pre, 24);
  const boxed = nacl.box(message, nonce, recipientPk, eph.secretKey);
  if (!boxed) throw new GitProviderError("conflict", "sealBox: encryption failed");
  const out = new Uint8Array(32 + boxed.length);
  out.set(eph.publicKey, 0);
  out.set(boxed, 32);
  return out;
}

/** Seal a UTF-8 string to a base64 GitHub public key and return base64 ciphertext. */
export function sealSecretForGithub(value, publicKeyBase64, ephemeralKeyPair) {
  const rpk = new Uint8Array(Buffer.from(String(publicKeyBase64 || ""), "base64"));
  const msg = new Uint8Array(Buffer.from(String(value == null ? "" : value), "utf8"));
  const sealed = sealBox(msg, rpk, ephemeralKeyPair);
  return Buffer.from(sealed).toString("base64");
}

function githubAdapter({ auth, fetchImpl, timeoutMs, sleepImpl }) {
  const token = (auth && (auth.token || auth.password)) || "";
  if (!token) {
    throw new GitProviderError("auth_dead", "github: no token configured", { provider: "github" });
  }
  const secrets = [token];
  // F-266: the redaction set GROWS. `fail()` reads it at call time, so anything
  // registered here is scrubbed from every message produced afterwards.
  const registerSecret = (v) => { const t = String(v == null ? "" : v); if (t.length >= 8 && !secrets.includes(t)) secrets.push(t); };
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
      // F-282: the DESCRIPTION. The review engine reads it ("(no description)" was
      // all it ever saw). Raw and attacker-authored — capped here, fenced+defanged
      // by the caller (see this file's "BOUNDED, NOT SANITISED" note).
      body: capBody(d.body),
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
        // The ACCOUNT TYPE ("User" / "Organization"). The login cannot answer it and
        // two things need it: create_repo's /user/repos vs /orgs/{org}/repos choice
        // (F-301) and any identity comparison that must not match on a login alone.
        type: (data && data.type) || null,
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
      assertCommitWithinCaps("github", files);
      // F-262: ONE budget for the whole chain. commitFiles is 4–5 HTTP calls and five
      // independent 10 s timeouts is a 50 s operation inside a 25 s resolver.
      return client.withBudget(GIT_OPERATION_BUDGET_MS, async () => {
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
      });
    },

    async openPullRequest({ repo, title, body = "", sourceBranch, targetBranch, draft = false }) {
      requireArg("github", "openPullRequest", "title", title);
      requireArg("github", "openPullRequest", "sourceBranch", sourceBranch);
      return client.withBudget(GIT_OPERATION_BUDGET_MS, async () => { // F-262
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
      });
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
      return client.withBudget(GIT_OPERATION_BUDGET_MS, async () => { // F-262
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
      });
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
          // F-263: GitHub OMITS `patch` for binary files, very large files and
          // renames-without-changes. `f.patch || ""` turned "we were not shown this"
          // into "this file changed nothing" — a reviewer then approves a diff it
          // never saw. Absent is WITHHELD; present-but-empty is genuinely empty.
          patch: typeof f.patch === "string" ? f.patch : "",
          withheld: typeof f.patch !== "string",
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
        // F-269 — see PR_COMMENT_RESOLVED_UNKNOWN: null is NOT PROVEN, not "resolved"
        // and not "unresolved". GitHub REST cannot answer thread resolution at all.
        resolved: PR_COMMENT_RESOLVED_UNKNOWN,
      });
      return [
        ...(Array.isArray(inline) ? inline : []).map((c) => map(c, true)),
        ...(Array.isArray(general) ? general : []).map((c) => map(c, false)),
      ];
    },

    async addPullRequestComment({ repo, number, body, path, line, commitSha }) {
      requireArg("github", "addPullRequestComment", "number", number);
      requireArg("github", "addPullRequestComment", "body", body);
      return client.withBudget(GIT_OPERATION_BUDGET_MS, async () => { // F-262
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
      });
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
      // F-266: the secret joins the redaction list BEFORE the call, because the
      // failure path is exactly the one that echoes it (a 422 body repeating the
      // rejected config, a proxy error quoting the request).
      registerSecret(secret);
      const { data } = await client.json("createWebhook", "POST", repoPath(repo, "createWebhook") + "/hooks", {
        name: "web",
        active: true,
        events,
        config: { url, content_type: "json", insecure_ssl: "0", secret },
      });
      return { id: data && data.id, url, events };
    },

    /**
     * A GitHub Actions repository secret, sealed to the repo's own public key.
     *
     * TWO CALLS, and the order matters: GET the repo's Curve25519 public key,
     * then PUT the sealed value keyed by that `key_id`. The GET is a read (it
     * may retry); the PUT is a write and is issued EXACTLY ONCE, like every
     * other write in this module.
     *
     * The plaintext never leaves this function, never reaches an error message
     * (it is in `secrets`, so redactSecrets scrubs it from any body GitHub
     * echoes) and is never logged. A 404 on the public key means "this token
     * cannot see this repo's Actions config" just as much as it means "no such
     * repo" — it is surfaced as not_found and NEVER read as "no secret exists".
     */
    async setSecret({ repo, name, value }) {
      requireArg("github", "setSecret", "name", name);
      const base = repoPath(repo, "setSecret") + "/actions/secrets";
      const { data: pk } = await client.json("setSecret", "GET", base + "/public-key");
      if (!pk || !pk.key || !pk.key_id) {
        throw new GitProviderError("conflict", "setSecret: repository public key unavailable", {
          provider: "github",
          operation: "setSecret",
        });
      }
      // The plaintext joins the redaction list for the remainder of the call.
      secrets.push(String(value == null ? "" : value));
      const encrypted_value = sealSecretForGithub(value, pk.key);
      await client.json("setSecret", "PUT", base + "/" + enc(name), {
        encrypted_value,
        key_id: pk.key_id,
      });
      return { name, secured: true, keyId: pk.key_id };
    },

    async setVariable({ repo, name, value }) {
      requireArg("github", "setVariable", "name", name);
      // A "variable" is not a secret by GitHub's taxonomy, but callers put connection
      // ids, webtrigger URLs and tokens-in-all-but-name in them. Redact it too (F-266).
      registerSecret(value);
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
 * Outbound commit caps (F-270). src/git-actions.js clamps the MODEL's arguments;
 * this is the bound every OTHER caller inherits — pipeline setup, scaffold
 * rendering, a coder turn. Refuses (`bad_request`) rather than truncating: a
 * silently shortened file is a corrupt commit, which is worse than a failed one.
 */
export function assertCommitWithinCaps(kind, files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new GitProviderError("bad_request", "commitFiles: no files given", { provider: kind, operation: "commitFiles" });
  }
  if (files.length > COMMIT_MAX_FILES) {
    throw new GitProviderError("bad_request", "commitFiles: " + files.length + " files exceeds the cap of " + COMMIT_MAX_FILES, { provider: kind, operation: "commitFiles" });
  }
  let total = 0;
  for (const f of files) {
    const size = byteLength(String((f && f.content) == null ? "" : f.content));
    if (size > COMMIT_MAX_FILE_BYTES) {
      throw new GitProviderError("bad_request", "commitFiles: \"" + String(f && f.path) + "\" is " + size + " bytes, over the " + COMMIT_MAX_FILE_BYTES + "-byte per-file cap", { provider: kind, operation: "commitFiles" });
    }
    total += size;
  }
  if (total > COMMIT_MAX_TOTAL_BYTES) {
    throw new GitProviderError("bad_request", "commitFiles: " + total + " bytes exceeds the " + COMMIT_MAX_TOTAL_BYTES + "-byte commit cap", { provider: kind, operation: "commitFiles" });
  }
  return files;
}

/**
 * Enforce the diff caps. A per-file patch is cut at 16 KB, and the whole set at
 * 60 KB; files that no longer fit are listed by name with `omitted: true` so the
 * model is told what it cannot see instead of silently reasoning about a subset.
 */
/** PR body → a capped string. Never null: "" is "no description", and says so once. */
export function capBody(value) {
  const raw = String(value == null ? "" : value);
  if (byteLength(raw) <= PR_BODY_MAX_BYTES) return raw;
  return clampBytes(raw, PR_BODY_MAX_BYTES, "\n… [description truncated at 8 KB]").text;
}

export function capDiff(files) {
  let total = 0;
  const out = [];
  let truncated = false;
  for (const f of files) {
    // F-263: a withheld patch is reported as OMITTED, never as an empty diff.
    if (f.withheld) {
      out.push({ ...f, patch: "", omitted: true, truncated: true, reason: "withheld-by-provider" });
      truncated = true;
      continue;
    }
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
  // F-266 — see the GitHub adapter: the redaction set grows as secrets are used.
  const registerSecret = (v) => { const t = String(v == null ? "" : v); if (t.length >= 8 && !secrets.includes(t)) secrets.push(t); };
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
      // F-282 — Bitbucket calls it `description`, and it arrives either as a plain
      // string or as `{ raw, markup, html }`. One normalised `body` either way.
      body: capBody(d.description && typeof d.description === "object" ? d.description.raw : d.description),
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
        // BOTH stable identifiers, because Bitbucket's own payloads disagree about
        // which name a user has: a whoami `username` and a PR-comment `nickname` can
        // differ, so ignoreSelf must be able to compare an ACCOUNT ID, not a label
        // (F-326). `uuid` is the classic id, `account_id` the Atlassian one.
        uuid: (data && data.uuid) || null,
        accountId: (data && data.account_id) || null,
        type: (data && data.type) || null,
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
      assertCommitWithinCaps("bitbucket", files);
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
        // F-269: Bitbucket DOES answer this, so `false` here is PROVEN unresolved —
        // unlike GitHub's `null`, which is not proven at all. A validator must treat
        // the two differently; see PR_COMMENT_RESOLVED_UNKNOWN.
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
      // F-266: the secret joins the redaction list BEFORE the call, because the
      // failure path is exactly the one that echoes it (a 422 body repeating the
      // rejected config, a proxy error quoting the request).
      registerSecret(secret);
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
      registerSecret(value);
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
      registerSecret(value);
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
