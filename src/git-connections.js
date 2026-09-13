/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * GIT CONNECTIONS — the SINGLE home of every long-lived credential CogniRunner
 * holds for a git host, and of the security model around it.
 * Release 1.4 commit 2 (plan §3.4, FRAME "Commit 2", red-team ledger §8).
 *
 * WHY THIS FILE EXISTS
 * A git connection is a credential that BOTH a human admin and a MODEL can
 * reach. The red team's finding was not "the model is dangerous" — it was that
 * SETUP and EXECUTION were one surface. They are two here:
 *   - SETUP (create a connection, store a token, allow-list repos, install a
 *     pipeline, write the Forge identity) is an ADMIN RESOLVER. Never an agent
 *     action. `PIPELINE_SETUP_IS_ADMIN_RESOLVER` below is that rule in code.
 *   - EXECUTION (an agent action, a listener, a PR review) may only act on a
 *     repo that appears in a connection's admin-edited `repos` allow-list, and
 *     never sees a token: it asks this module for a provider instance.
 *
 * EVERY WRITE PATH THIS MODULE OWNS, ENUMERATED (nothing else writes these keys):
 *   1. `git_conn_index`            — saveConnection (add), deleteConnection (remove)
 *   2. `git_conn:<id>`             — saveConnection, setRepoAllowlist,
 *                                    markAuthDead, testConnection (records the
 *                                    whoami verdict and clears a stale banner),
 *                                    applyCredentialRotation
 *   3. `git_conn_secret:<id>`      — saveConnection (store), deleteConnection (erase),
 *                                    applyCredentialRotation (QUEUED TASK ONLY)
 *   4. `git_hook_secret:<c>:<r>`   — ensureHookSecret (create-if-absent),
 *                                    rotateHookSecret (QUEUED TASK ONLY),
 *                                    deleteConnection (erase, best-effort)
 *   5. `COGNIRUNNER_FORGE_IDENTITY` — saveForgeIdentity, clearForgeIdentity,
 *                                    applyCredentialRotation (QUEUED TASK ONLY)
 * There is no sixth. A caller that wants to change a credential goes through a
 * function here or it is a finding.
 *
 * SECRETS NEVER LEAVE. `git_conn_secret:*` and the Forge identity's token are
 * read by exactly two functions in this file (`readConnectionSecret`,
 * `readForgeIdentity`), both marked INTERNAL, both never called by a resolver
 * that returns their value. Every public shape goes through `publicConnection`
 * / `forgeIdentityStatus`, which are ALLOW-LISTS of fields — the export lesson
 * (`RULE_EMIT_KEYS`): you never widen an emit whitelist to make something work.
 * `git-connections.test.mjs` deep-scans every resolver return for the token.
 *
 * LAW 3 (fail open / fail closed), stated once for the whole module and again
 * per function: EVERYTHING HERE FAILS CLOSED. A credential that cannot be read
 * is never "no restriction"; an allow-list that cannot be read never allows; a
 * connection whose token is dead is LOUD (`status:"auth_dead"` on the row, the
 * banner reads it) and never silently absent. None of this sits inside a Jira
 * transition, so the app's fail-OPEN validator contract is untouched: a git
 * validator that cannot reach its connection still fails OPEN at the transition
 * (commit 10), and it does so by asking this module and getting a REFUSAL, not
 * by this module inventing a permissive answer.
 *
 * ROTATION IS A QUEUED TASK, NEVER A RESOLVER (§8 "Rotation in a resolver").
 * A resolver has 25 s and no retry; a half-rotated credential is a locked-out
 * connection. `requestCredentialRotation()` enqueues; `applyCredentialRotation()`
 * is what the consumer calls, and it is the only writer that replaces a stored
 * secret in place.
 *
 * No Forge runtime at import time beyond @forge/kvs (the offline suite swaps it
 * for a mock); @forge/events is imported dynamically inside the one function
 * that queues.
 */

import storage from "@forge/kvs";
import { createGitProvider, GitProviderError, GIT_PROVIDER_KINDS } from "./git-providers.js";
import { safeKeyPart, isKeyConflict } from "./shared/kvs-keys.js";
// F-310 - the repo-id canonical form has ONE home, and it is a shared/ module because
// the admin panel needs the same answer and cannot import this file (it loads @forge/kvs).
import { normalizeRepoId } from "./shared/git-ids.js";

/* ===== KEY NAMES — the ONE home. Never retype one of these strings. ===== */

/** Index of connection ids (a short array; the rows themselves are separate). */
export const GIT_CONN_INDEX_KEY = "git_conn_index";
/** The connection ROW. Never contains a token. */
export const gitConnKey = (id) => `git_conn:${id}`;
/** The connection's CREDENTIAL. Its own key so a row read can never carry it. */
export const gitConnSecretKey = (id) => `git_conn_secret:${id}`;
/** Per-repo webhook signing secret. Per-repo, not per-connection: a leaked
 *  secret on one repo must not let an attacker forge deliveries for another. */
export const gitHookSecretKey = (connId, repoId) => `git_hook_secret:${connId}:${normalizeRepoId(repoId)}`;
/** The customer-supplied Atlassian identity used to deploy their Forge app. */
export const FORGE_IDENTITY_KEY = "COGNIRUNNER_FORGE_IDENTITY";

/** Task type for the rotation job on the EXISTING `async-ai-queue`. */
export const CREDENTIAL_ROTATION_TASK = "gitcredrotate";
/**
 * F-336 — the rotation LOCK, keyed by TARGET and nothing else. It serialises
 * rotations; it does not dedupe deliveries.
 *
 * It used to carry the taskId (F-304), which made it a per-delivery dedupe key
 * and therefore no lock at all: two DIFFERENT rotations of one connection both
 * claimed, both read the pre-rotation row, and whichever finished its network
 * probe last won — so the credential the admin abandoned could be the one that
 * is stored. Per-delivery idempotency did not disappear with the key: the row
 * records the `taskId` it last applied, and a redelivery of that same task is
 * answered `duplicate` under the lock.
 *
 * `forge-identity` has no id of its own and uses the literal as its slot.
 */
export const gitRotateClaimKey = (targetId) => `git_rotate:${safeKeyPart(targetId || "forge-identity")}`;

/** Safety net only — the lock is released on EVERY exit, success or failure. */
const ROTATE_LOCK_TTL = { ttl: { value: 10, unit: "MINUTES" } };

/* ===== CAPS — checked BEFORE the side effect, always (commitImportCore) ===== */

export const GIT_CONN_MAX = 25;
export const REPO_ALLOWLIST_MAX = 200;
export const LABEL_MAX_CHARS = 80;
export const TOKEN_MAX_CHARS = 4096;

/**
 * THE SECURITY MODEL, in code, in one place.
 *
 * `PIPELINE_SETUP_IS_ADMIN_RESOLVER` is not decoration: commit 7's pipeline
 * setup asserts it, and the agent-action gate (commit 3) asserts that no action
 * id in the `git` namespace maps to pipeline setup. If anyone ever decides a
 * model may install a pipeline, they have to flip this constant — which makes
 * the decision visible in a diff and breaks the tests that read it.
 */
export const PIPELINE_SETUP_IS_ADMIN_RESOLVER = true;

/**
 * What an agent is allowed to do with a connection, as data rather than as
 * scattered `if`s. Read by commit 3's gate and commit 7's setup resolver.
 */
export const CONNECTION_SECURITY_MODEL = Object.freeze({
  pipelineSetupIsAdminResolver: PIPELINE_SETUP_IS_ADMIN_RESOLVER,
  /** An agent may only ever touch a repo present in `repos` on its connection. */
  agentReposAreAllowListed: true,
  /** The allow-list is edited by an admin resolver only — never by a model. */
  repoAllowListEditableBy: "admin",
  /** No surface, agent or human, ever reads a stored token back out. */
  tokensAreWriteOnly: true,
  /** Credential replacement happens on the queue, never in a resolver. */
  rotationIsQueuedOnly: true,
  /** A harness stand-in row is credential-less BY CONSTRUCTION — see HARNESS_STATUS. */
  harnessConnectionsAreTokenless: true,
});

/**
 * F-339 — THE HARNESS STAND-IN STATUS, IN ONE PLACE.
 *
 * The inbound git path (webhook → verify → claim → enqueue → dispatch) needs a
 * `git_conn:*` row to exist before it will route anything, and the dev hook is
 * forbidden to create a credential — so the whole surface had no automatable
 * live proof. A row with this status is the resolution: it ROUTES like a real
 * connection (`getConnection` + `isRepoAllowed` are all the webhook reads) and
 * it can never TALK to a provider, because every path that would reach for a
 * credential refuses it by name before it reaches the network.
 *
 * Anything comparing against "harness" imports this constant. A row that
 * carries it has no `git_conn_secret:*` key and `hasToken:false`.
 */
export const HARNESS_STATUS = "harness";
export const isHarnessConnection = (row) => !!row && row.status === HARNESS_STATUS;
/** The one refusal message for "this is a stand-in, there is nothing to call with". */
const HARNESS_REFUSAL = "This is a harness stand-in connection with no credential — nothing can be called with it";

/* ===== SHAPES ===== */

const nowIso = () => new Date().toISOString();

/**
 * Stable, printable repo id: "owner/name" lower-cased. F-310 - the implementation
 * moved to src/shared/git-ids.js so the EventPicker's `repos` filter cannot grow a
 * fourth copy of it; re-exported here because every existing caller imports it from
 * this module, and a second import path is how one home becomes two.
 */
export { normalizeRepoId };

function randomId(prefix) {
  const rand =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix}${rand}`;
}

/**
 * Cryptographically random webhook secret (32 bytes, hex). `crypto` is the Web
 * Crypto global present in nodejs22.x; the Math.random fallback exists only so
 * an exotic runtime degrades instead of throwing, and it is NEVER the path on
 * Forge — a test asserts the strong path is taken when getRandomValues exists.
 */
export function generateWebhookSecret() {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const b = new Uint8Array(32);
    crypto.getRandomValues(b);
    return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  }
  /* istanbul ignore next */
  let s = "";
  while (s.length < 64) s += Math.random().toString(16).slice(2);
  return s.slice(0, 64);
}

/**
 * THE EMIT ALLOW-LIST for a connection row. Anything a resolver returns for a
 * connection goes through here. It is a WHITELIST by construction (we build a
 * new object field by field, we do not spread and delete) so a field added to
 * the stored row tomorrow cannot leak by default.
 */
export function publicConnection(row) {
  if (!row || typeof row !== "object") return null;
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    host: row.host || null,
    owner: row.owner || null,
    createdBy: row.createdBy || null,
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null,
    // "does a credential exist", never the credential.
    hasToken: row.hasToken === true,
    status: row.status || "ok",
    authDeadAt: row.authDeadAt || null,
    authDeadReason: row.authDeadReason || null,
    lastCheckedAt: row.lastCheckedAt || null,
    login: row.login || null,
    repos: Array.isArray(row.repos) ? row.repos.slice() : [],
    capabilities: row.capabilities || null,
  };
}

/* ===== INDEX + ROWS ===== */

async function readIndex() {
  const ids = await storage.get(GIT_CONN_INDEX_KEY);
  return Array.isArray(ids) ? ids.filter((x) => typeof x === "string") : [];
}

/** INTERNAL: the raw row. It NEVER carries a token — see gitConnSecretKey. */
export async function getConnection(id) {
  if (!id) return null;
  const row = await storage.get(gitConnKey(id));
  return row && typeof row === "object" ? row : null;
}

/**
 * Every connection, public shape only.
 * LAW 3: a storage fault THROWS — the caller (an admin resolver) turns it into
 * an error the admin can see. An empty list on a read fault would read as
 * "no connections configured", which is the "proven negative" rule's exact trap.
 */
export async function listConnections() {
  const ids = await readIndex();
  const rows = [];
  for (const id of ids) {
    const row = await getConnection(id);
    if (row) rows.push(publicConnection(row));
  }
  return rows;
}

/* ===== CREDENTIALS (INTERNAL — never reachable from a resolver return) ===== */

/**
 * INTERNAL. The stored credential for a connection.
 * LAW 3: FAIL CLOSED. Missing or unreadable → throws. A caller must never treat
 * "no credential" as "unrestricted"; the operation is refused instead.
 */
export async function readConnectionSecret(id) {
  const sec = await storage.get(gitConnSecretKey(id));
  if (!sec || typeof sec !== "object" || !sec.token) {
    throw new GitProviderError("auth_dead", "This connection has no stored credential", {
      provider: "none",
      operation: "readConnectionSecret",
    });
  }
  return sec;
}

/**
 * Build a provider bound to a connection. The ONE way execution code reaches a
 * git host — it never sees the token, it sees the adapter.
 * LAW 3: FAIL CLOSED (throws) when the connection is unknown, dead or
 * credential-less, and when `repo` is given and is not on the allow-list.
 */
export async function providerForConnection(id, { repo, fetchImpl } = {}) {
  const row = await getConnection(id);
  if (!row) {
    throw new GitProviderError("not_found", "Unknown git connection", { operation: "providerForConnection" });
  }
  // A harness stand-in refuses in the SAME class as a dead token (auth_dead), so a
  // downstream run — gitreview, an agent action — fails with a NAMED reason and
  // never reaches GitHub. Checked before the secret read so nothing marks the row.
  if (isHarnessConnection(row)) {
    throw new GitProviderError("auth_dead", HARNESS_REFUSAL, {
      provider: row.kind,
      operation: "providerForConnection",
    });
  }
  if (row.status === "auth_dead") {
    throw new GitProviderError("auth_dead", "This git connection's credential is no longer valid", {
      provider: row.kind,
      operation: "providerForConnection",
    });
  }
  if (repo !== undefined && !isRepoAllowed(row, repo)) {
    throw new GitProviderError("not_supported", "That repository is not on this connection's allow-list", {
      provider: row.kind,
      operation: "providerForConnection",
    });
  }
  let sec;
  try {
    sec = await readConnectionSecret(id);
  } catch (e) {
    // F-292: a missing/malformed secret IS a dead credential. Record it before
    // rethrowing, or the row keeps reporting "ok" while every call fails.
    await noteAuthDead(id, e);
    throw e;
  }
  const provider = createGitProvider({
    kind: row.kind,
    auth: row.kind === "bitbucket" ? { email: sec.email, token: sec.token } : { token: sec.token },
    fetchImpl,
  });
  return watchAuthDead(id, provider);
}

/**
 * F-292 — THE EXECUTION PATH'S ROUTE TO `markAuthDead`.
 *
 * `markAuthDead` is the one writer of the dead-credential flag, and its contract
 * says every call site that discovers an `auth_dead` routes it here. Until this
 * wrapper existed, only `testConnection` did: a connection whose token had been
 * revoked (or whose secret had gone missing) failed every agent action and every
 * PR review while `status` stayed `"ok"`, so the admin UI showed a healthy
 * connection with no banner and the only way to learn the truth was to press
 * Test. Now ANY adapter call that throws `auth_dead` marks the row on the way
 * out, and the error is rethrown UNCHANGED — this wrapper never swallows and
 * never converts. A later successful `testConnection` clears the flag, which is
 * already the rule (it writes `status:"ok", authDeadAt:null`).
 *
 * Marking is best-effort: a KVS fault while recording must not replace the real
 * provider error with a storage one.
 */
async function noteAuthDead(id, e) {
  if (!(e instanceof GitProviderError) || e.code !== "auth_dead") return;
  try {
    await markAuthDead(id, e.message || "The provider rejected this credential");
  } catch (_) {
    /* best-effort: the provider error is the one the caller must see */
  }
}

/**
 * Return the adapter with every method call watched. A Proxy so the wrapper
 * cannot drift out of date as the provider surface grows — a new method is
 * covered the day it is added, which a hand-written method list would not be.
 */
export function watchAuthDead(id, provider) {
  if (!provider || typeof provider !== "object") return provider;
  return new Proxy(provider, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      return (...args) => {
        let out;
        try {
          out = value.apply(target, args);
        } catch (e) {
          return noteAuthDead(id, e).then(() => { throw e; });
        }
        if (!out || typeof out.then !== "function") return out;
        return out.then(undefined, async (e) => {
          await noteAuthDead(id, e);
          throw e;
        });
      };
    },
  });
}

/**
 * THE allow-list predicate. One home; commit 3's gate and commit 7's setup both
 * call it. FAIL CLOSED: an absent or malformed `repos` allows NOTHING. An empty
 * allow-list is a connection an agent cannot use, on purpose — "nothing listed"
 * must never mean "everything".
 */
export function isRepoAllowed(row, repoId) {
  if (!row || !Array.isArray(row.repos)) return false;
  const want = normalizeRepoId(repoId);
  if (!want) return false;
  return row.repos.some((r) => normalizeRepoId(r) === want);
}

/* ===== WHOAMI + CAPABILITIES ===== */

/**
 * Capability flags derived from what the credential ITSELF reports.
 *
 * The "proven negative" rule applies hard here: a GitHub fine-grained PAT does
 * NOT send `x-oauth-scopes`, so an empty scope list means WE DO NOT KNOW, not
 * "no permissions". Unknown is `null`, never `false` — a UI must render "not
 * known until you try", and no code may read `false` from an absent header and
 * refuse a capability the token actually has (or, worse, read absence as yes).
 */
export function capabilityFlags(kind, who) {
  const scopes = Array.isArray(who && who.scopes) ? who.scopes.map((s) => String(s).trim()) : [];
  if (kind !== "github" || scopes.length === 0) {
    return {
      canCreateRepos: null,
      canWebhooks: null,
      canPipelines: null,
      reason:
        kind === "github"
          ? "This token does not report its scopes (fine-grained PATs never do). Capability is proven only by the call that needs it."
          : "Bitbucket does not report scopes on this call. Capability is proven only by the call that needs it.",
    };
  }
  const has = (s) => scopes.includes(s);
  return {
    canCreateRepos: has("repo") || has("public_repo"),
    canWebhooks: has("repo") || has("admin:repo_hook") || has("write:repo_hook"),
    canPipelines: has("workflow"),
    reason: "Derived from the classic token's reported OAuth scopes.",
  };
}

/* ===== SAVE / DELETE ===== */

/**
 * F-295 — THE token-value check. ONE home for "a token is required" and the
 * TOKEN_MAX_CHARS ceiling, because the rotation path (which is not a resolver)
 * shipped without either while both resolver writes had them. Every path that
 * accepts a credential from a human calls this, BEFORE the side effect.
 * The "required" sentence varies by caller (save vs rotation), the cap does not.
 */
export function tokenValueError(token, requiredMessage = "A token is required") {
  if (!token || !String(token).trim()) return requiredMessage;
  if (String(token).length > TOKEN_MAX_CHARS) return "That token is implausibly long";
  return null;
}

function validateSaveInput({ kind, label, token, email, repos }) {
  if (!GIT_PROVIDER_KINDS.includes(kind)) return `Unknown provider kind: ${String(kind)}`;
  if (!label || !String(label).trim()) return "A label is required";
  if (String(label).length > LABEL_MAX_CHARS) return `Label is longer than ${LABEL_MAX_CHARS} characters`;
  const tokenErr = tokenValueError(token);
  if (tokenErr) return tokenErr;
  if (kind === "bitbucket" && (!email || !String(email).trim())) {
    return "Bitbucket needs the account email that owns the app password";
  }
  if (repos !== undefined && !Array.isArray(repos)) return "repos must be a list of repository ids";
  if (Array.isArray(repos) && repos.length > REPO_ALLOWLIST_MAX) {
    return `A connection may allow at most ${REPO_ALLOWLIST_MAX} repositories`;
  }
  return null;
}

/**
 * Create or replace a connection.
 *
 * ORDER IS THE CONTRACT (the commitImportCore lesson — a refused operation must
 * leave nothing live):
 *   1. validate the input  → refuse, nothing written
 *   2. check the count cap → refuse, nothing written
 *   3. CALL whoami with the supplied credential → a credential that is already
 *      dead is refused HERE and never stored. `auth_dead` from the probe is a
 *      refusal, not a stored dead connection.
 *   4. write the secret, then the row, then the index. The index is written
 *      LAST so a partial write leaves an orphan row (invisible, harmless)
 *      rather than an index entry pointing at a row that does not exist.
 *
 * LAW 3: FAIL CLOSED throughout. Returns `{ok:false, error, code}`; never throws
 * for an expected refusal.
 */
export async function saveConnection({
  id,
  kind,
  label,
  token,
  email,
  host,
  owner,
  repos,
  accountId,
  fetchImpl,
} = {}) {
  const bad = validateSaveInput({ kind, label, token, email, repos });
  if (bad) return { ok: false, error: bad, code: "invalid" };

  const ids = await readIndex();
  const existing = id ? await getConnection(id) : null;
  if (id && !existing) return { ok: false, error: "Unknown git connection", code: "not_found" };
  if (!existing && ids.length >= GIT_CONN_MAX) {
    // CAP BEFORE THE SIDE EFFECT. Nothing has been written at this point.
    return { ok: false, error: `You already have ${GIT_CONN_MAX} git connections`, code: "cap" };
  }

  // 3. Prove the credential before storing it (§3.4 "validates via whoami").
  let who;
  try {
    const probe = createGitProvider({
      kind,
      auth: kind === "bitbucket" ? { email, token } : { token },
      fetchImpl,
    });
    who = await probe.whoami();
  } catch (e) {
    const code = e instanceof GitProviderError ? e.code : "network";
    if (code === "auth_dead") {
      // A dead credential is REFUSED, never stored. Storing it would create a
      // connection that is born broken and whose banner nobody asked for.
      return { ok: false, error: "That credential was rejected by the provider", code: "auth_dead" };
    }
    return {
      ok: false,
      // The adapter has already redacted; this message is safe to show.
      error: `Could not reach the provider to verify the credential: ${e && e.message ? e.message : "unknown error"}`,
      code,
    };
  }

  const connId = id || randomId("gc_");
  const row = {
    id: connId,
    kind,
    label: String(label).trim(),
    host: host ? String(host) : null,
    owner: owner ? String(owner) : who.login || null,
    createdBy: existing ? existing.createdBy : accountId || null,
    createdAt: existing ? existing.createdAt : nowIso(),
    updatedAt: nowIso(),
    hasToken: true,
    // The credential just answered, so the row starts healthy — and a re-save
    // of a previously dead connection CLEARS the banner, which is the only
    // supported way out of `auth_dead`.
    status: "ok",
    authDeadAt: null,
    authDeadReason: null,
    lastCheckedAt: nowIso(),
    login: who.login || null,
    repos: Array.isArray(repos)
      ? dedupeRepos(repos)
      : existing && Array.isArray(existing.repos)
        ? existing.repos
        : [],
    capabilities: capabilityFlags(kind, who),
    // `tokenSlot` is the NAME of the key the credential lives under. It is a
    // pointer, never the value — a reader who sees it still cannot read the
    // token without app storage access, and publicConnection does not emit it.
    tokenSlot: gitConnSecretKey(connId),
  };

  await storage.set(gitConnSecretKey(connId), {
    token: String(token),
    ...(kind === "bitbucket" ? { email: String(email) } : {}),
    updatedAt: nowIso(),
  });
  await storage.set(gitConnKey(connId), row);
  if (!ids.includes(connId)) await storage.set(GIT_CONN_INDEX_KEY, [...ids, connId]);

  return { ok: true, connection: publicConnection(row), whoami: publicWhoami(who) };
}

function dedupeRepos(repos) {
  const out = [];
  for (const r of repos) {
    const n = normalizeRepoId(r);
    if (n && !out.includes(n)) out.push(n);
  }
  return out.slice(0, REPO_ALLOWLIST_MAX);
}

/** The whoami fields we are willing to show. Another allow-list, same reason. */
export function publicWhoami(who) {
  if (!who) return null;
  return {
    kind: who.kind || null,
    login: who.login || null,
    name: who.name || null,
    scopes: Array.isArray(who.scopes) ? who.scopes.slice(0, 40) : [],
  };
}

/**
 * Live check of a connection. Returns whoami + capability flags, and RECORDS the
 * verdict on the row so the banner is driven by one field.
 * LAW 3: a failure here never deletes anything; `auth_dead` marks the row LOUDLY
 * (§8 "dead token = gate silently gone") and any other error is reported as a
 * transient fault WITHOUT touching the row's status — a network blip must not
 * raise a credential alarm.
 */
export async function testConnection(id, { fetchImpl } = {}) {
  const row = await getConnection(id);
  if (!row) return { ok: false, error: "Unknown git connection", code: "not_found" };
  // Same named refusal as every other credential path, and the row is left alone:
  // a stand-in is not a connection that WENT dead.
  if (isHarnessConnection(row)) return { ok: false, error: HARNESS_REFUSAL, code: "auth_dead" };
  let sec;
  try {
    sec = await readConnectionSecret(id);
  } catch (e) {
    await markAuthDead(id, "The stored credential is missing");
    return { ok: false, error: "This connection has no stored credential", code: "auth_dead" };
  }
  try {
    const provider = createGitProvider({
      kind: row.kind,
      auth: row.kind === "bitbucket" ? { email: sec.email, token: sec.token } : { token: sec.token },
      fetchImpl,
    });
    const who = await provider.whoami();
    const capabilities = capabilityFlags(row.kind, who);
    await storage.set(gitConnKey(id), {
      ...row,
      status: "ok",
      authDeadAt: null,
      authDeadReason: null,
      lastCheckedAt: nowIso(),
      login: who.login || row.login || null,
      capabilities,
    });
    return { ok: true, whoami: publicWhoami(who), capabilities };
  } catch (e) {
    const code = e instanceof GitProviderError ? e.code : "network";
    if (code === "auth_dead") {
      await markAuthDead(id, "The provider rejected this credential");
      return { ok: false, error: "The provider rejected this credential", code: "auth_dead" };
    }
    return {
      ok: false,
      error: e && e.message ? e.message : "The provider could not be reached",
      code,
      transient: true,
    };
  }
}

/**
 * THE dead-credential flag. One field (`status`), one writer (this function),
 * one reader (the banner / the validators' `strict` option in commit 10). Any
 * call site that discovers an `auth_dead` from the adapter routes it here so the
 * gate cannot go silently missing.
 */
export async function markAuthDead(id, reason) {
  const row = await getConnection(id);
  if (!row) return false;
  await storage.set(gitConnKey(id), {
    ...row,
    status: "auth_dead",
    authDeadAt: nowIso(),
    authDeadReason: String(reason || "The provider rejected this credential").slice(0, 200),
    lastCheckedAt: nowIso(),
  });
  return true;
}

/** Admin-edited repo allow-list. Admin resolver only — never an agent action. */
export async function setRepoAllowlist(id, repos) {
  const row = await getConnection(id);
  if (!row) return { ok: false, error: "Unknown git connection", code: "not_found" };
  if (!Array.isArray(repos)) return { ok: false, error: "repos must be a list", code: "invalid" };
  if (repos.length > REPO_ALLOWLIST_MAX) {
    // CAP BEFORE THE SIDE EFFECT.
    return { ok: false, error: `At most ${REPO_ALLOWLIST_MAX} repositories`, code: "cap" };
  }
  const next = { ...row, repos: dedupeRepos(repos), updatedAt: nowIso() };
  await storage.set(gitConnKey(id), next);
  return { ok: true, connection: publicConnection(next) };
}

/**
 * Delete a connection AND its credential AND its per-repo webhook secrets.
 * ORDER: index first, then the secret, then the row. The index entry is removed
 * FIRST so that a mid-way failure cannot leave a listed connection whose token
 * is already gone (that would look alive and fail on every call); an orphaned
 * row with no index entry is invisible and harmless.
 */
export async function deleteConnection(id) {
  const row = await getConnection(id);
  const ids = await readIndex();
  if (!row && !ids.includes(id)) return { ok: false, error: "Unknown git connection", code: "not_found" };
  await storage.set(GIT_CONN_INDEX_KEY, ids.filter((x) => x !== id));
  await storage.delete(gitConnSecretKey(id));
  for (const repoId of (row && Array.isArray(row.repos) ? row.repos : [])) {
    try {
      await storage.delete(gitHookSecretKey(id, repoId));
    } catch (e) {
      // Best-effort: an orphan hook secret can verify nothing (its connection is
      // gone and the webhook handler resolves the connection first), so it is
      // not worth failing the delete over.
    }
  }
  await storage.delete(gitConnKey(id));
  return { ok: true };
}

/**
 * F-339 — PLANT A TOKENLESS STAND-IN CONNECTION (dev harness only).
 *
 * The ONE home for the stand-in row's shape, so the dev hook stays wiring. It
 * writes NO `git_conn_secret:*` key, ever, and it REFUSES rather than overwrite
 * an existing row — a real connection must never be turned into a stand-in (and
 * a stand-in must never inherit a real connection's repo allow-list).
 * The caller is responsible for the dev gate; this function has no gate of its own
 * and is never reachable from a resolver.
 */
export async function plantHarnessConnection({ id, kind = "github", repoId, accountId = "harness" } = {}) {
  if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(String(id))) return { ok: false, error: "A connection id is required", code: "invalid" };
  if (!GIT_PROVIDER_KINDS.includes(kind)) return { ok: false, error: "Unknown provider kind", code: "invalid" };
  const repo = normalizeRepoId(repoId);
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) return { ok: false, error: "repoId must be owner/name", code: "invalid" };
  if (await getConnection(id)) {
    return { ok: false, error: "A connection with that id already exists — refusing to overwrite it", code: "exists" };
  }
  const row = {
    id: String(id),
    kind,
    label: "harness",
    host: null,
    owner: null,
    createdBy: accountId,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    // No credential exists and none is claimed to.
    hasToken: false,
    status: HARNESS_STATUS,
    authDeadAt: null,
    authDeadReason: null,
    lastCheckedAt: null,
    login: null,
    // EXACTLY the one repo asked for: a stand-in never widens an allow-list.
    repos: [repo],
    capabilities: null,
  };
  try {
    // FAIL_IF_EXISTS as well as the read above: the read is the readable refusal,
    // this is the one that holds under a race.
    await storage.set(gitConnKey(row.id), row, { keyPolicy: "FAIL_IF_EXISTS" });
  } catch (e) {
    if (isKeyConflict(e)) return { ok: false, error: "A connection with that id already exists — refusing to overwrite it", code: "exists" };
    throw e;
  }
  const ids = await readIndex();
  if (!ids.includes(row.id)) await storage.set(GIT_CONN_INDEX_KEY, [...ids, row.id]);
  return { ok: true, connection: publicConnection(row) };
}

/**
 * F-339 — remove a stand-in. REFUSES any row that is not one, so this cannot
 * become a delete path for a real connection (that stays admin-UI-only).
 */
export async function deleteHarnessConnection(id) {
  const row = await getConnection(id);
  if (!row) return { ok: false, error: "Unknown git connection", code: "not_found" };
  if (!isHarnessConnection(row)) {
    return { ok: false, error: "That connection is not a harness stand-in — refusing to delete it", code: "refused" };
  }
  return deleteConnection(id);
}

/* ===== PER-REPO WEBHOOK SECRETS ===== */

/**
 * The signing secret for ONE repo on ONE connection, created if absent.
 * Create-if-absent, never replace: re-running setup must not silently
 * invalidate the secret already installed in the repo's webhook.
 * The secret is returned ONLY to the caller that is about to install it in the
 * provider (commit 7's setup resolver) — it is never part of a connection read.
 */
export async function ensureHookSecret(connId, repoId) {
  const key = gitHookSecretKey(connId, repoId);
  const existing = await storage.get(key);
  if (existing && existing.secret) return { secret: existing.secret, created: false };
  const secret = generateWebhookSecret();
  await storage.set(key, { secret, connId, repoId: normalizeRepoId(repoId), createdAt: nowIso() });
  return { secret, created: true };
}

/**
 * INTERNAL: the secret the webhook handler verifies a delivery against.
 * The one caller is `gitWebhook` in src/index.js (1.4 commit 5), which reads it
 * AFTER checking the repo is on this connection's allow-list.
 * Returns null when there is none — and the HANDLER's answer to null is a 404
 * with no body detail (one refusal shape for unknown connection, unlisted repo
 * and missing secret alike, so the endpoint is not a connection-id oracle),
 * never "unsigned deliveries are fine". Fail CLOSED lives at the caller because
 * only the caller can produce the HTTP response.
 */
export async function getHookSecret(connId, repoId) {
  const row = await storage.get(gitHookSecretKey(connId, repoId));
  return row && row.secret ? row.secret : null;
}

/* ===== FORGE DEPLOY IDENTITY (write-only) ===== */

/**
 * The customer's own Atlassian credential, used by the pipeline CogniRunner
 * installs in THEIR repo to deploy THEIR Forge app. CogniRunner cannot deploy a
 * Forge app itself, which is the whole reason this exists.
 *
 * WRITE-ONLY, and that is enforced by shape, not by discipline: the email and
 * token are stored under this one key and the only public reader is
 * `forgeIdentityStatus()`, which emits `{hasIdentity, email?, consent, ...}`
 * — booleans and metadata, never the token. There is no "reveal" path anywhere
 * in the app, for anyone, including an admin.
 *
 * CONSENT is required and RECORDED: this is a credential a human hands over for
 * an automated system to use on their behalf, so the accountId that agreed and
 * the moment they agreed are stored alongside it. An absent/false consent flag
 * is a REFUSAL (fail closed), never a default-yes.
 */
export async function saveForgeIdentity({ email, token, consent, accountId } = {}) {
  if (consent !== true) {
    // FAIL CLOSED. The caller must pass an explicit `consent: true` that came
    // from the admin ticking the consent screen — a missing flag is a refusal.
    return { ok: false, error: "Explicit consent is required to store a deploy identity", code: "consent_required" };
  }
  if (!email || !String(email).trim()) return { ok: false, error: "An Atlassian account email is required", code: "invalid" };
  const tokenErr = tokenValueError(token, "An Atlassian API token is required");
  if (tokenErr) return { ok: false, error: tokenErr, code: "invalid" };

  const prev = (await storage.get(FORGE_IDENTITY_KEY)) || null;
  const row = {
    email: String(email).trim(),
    token: String(token),
    consent: { accountId: accountId || null, at: nowIso() },
    createdAt: prev && prev.createdAt ? prev.createdAt : nowIso(),
    updatedAt: nowIso(),
  };
  await storage.set(FORGE_IDENTITY_KEY, row);
  // The status is built by the SAME allow-list every read uses — building a
  // bespoke "success" shape here is exactly how a token leaks out of one path.
  return { ok: true, status: forgeIdentityStatus(row) };
}

/** Remove the identity entirely. Idempotent; a missing identity is not an error. */
export async function clearForgeIdentity() {
  await storage.delete(FORGE_IDENTITY_KEY);
  return { ok: true, status: forgeIdentityStatus(null) };
}

/**
 * THE public shape of the identity. An ALLOW-LIST: `hasIdentity` is the boolean
 * the UI renders, the email is shown because the admin typed it and needs to see
 * WHICH account is configured, and the token has no representation here at all.
 */
export function forgeIdentityStatus(row) {
  if (!row || typeof row !== "object") {
    return { hasIdentity: false, email: null, consent: null, rotation: null, createdAt: null, updatedAt: null };
  }
  return {
    hasIdentity: !!row.token || row.hasIdentity === true,
    email: row.email || null,
    consent: row.consent ? { accountId: row.consent.accountId || null, at: row.consent.at || null } : null,
    // F-303 — the two facts an auditor must be able to tell apart: who CONSENTED to
    // this identity being stored (above, collected once, never re-stamped), and who
    // last REPLACED the token (here). A rotation that silently refreshed `consent`
    // read as a consent screen nobody was ever shown.
    rotation: row.rotation
      ? { requestedBy: row.rotation.requestedBy || null, at: row.rotation.at || null }
      : null,
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null,
  };
}

/** Read the status (safe). */
export async function getForgeIdentityStatus() {
  const row = await storage.get(FORGE_IDENTITY_KEY);
  return forgeIdentityStatus(row);
}

/**
 * INTERNAL. The only reader of the identity's token; used by commit 7's
 * pipeline setup to hand it to `setSecret` (sealed, on GitHub). No resolver
 * calls this, and a test asserts no resolver return ever contains its value.
 * LAW 3: FAIL CLOSED — a missing identity throws, it never yields a blank
 * credential that would make a deploy step "succeed" with no auth.
 */
export async function readForgeIdentity() {
  const row = await storage.get(FORGE_IDENTITY_KEY);
  if (!row || !row.token || !row.email) {
    throw new GitProviderError("auth_dead", "No Forge deploy identity is configured", {
      operation: "readForgeIdentity",
    });
  }
  return { email: row.email, token: row.token };
}

/* ===== ROTATION — QUEUED ONLY ===== */

/**
 * Ask for a credential to be replaced. This ENQUEUES and returns; it does not
 * rotate. §8's finding was "rotation in a resolver": a resolver has 25 s, no
 * retry and no visibility, and a half-finished rotation is a locked-out
 * connection that nobody can repair from the UI.
 *
 * `target` is `{ kind: "connection", id }` or `{ kind: "forge-identity" }`.
 * The NEW secret rides the queued event because the queue is app-private
 * storage; it is never logged by this function or the consumer.
 */
export async function requestCredentialRotation(target, secret, { accountId } = {}) {
  if (!target || (target.kind !== "connection" && target.kind !== "forge-identity")) {
    return { ok: false, error: "Unknown rotation target", code: "invalid" };
  }
  if (target.kind === "connection" && !(await getConnection(target.id))) {
    return { ok: false, error: "Unknown git connection", code: "not_found" };
  }
  // F-295 — the cap the resolver writes enforce, enforced here too and BEFORE
  // the push. Without it a multi-megabyte token either bursts the Forge event
  // size limit (surfaced as a bare transport message) or lands somewhere no
  // refusal is possible any more.
  const tokenErr = tokenValueError(secret && secret.token, "A replacement token is required");
  if (tokenErr) return { ok: false, error: tokenErr, code: "invalid" };
  const taskId = randomId("rot_");
  const { Queue } = await import("@forge/events");
  const queue = new Queue({ key: "async-ai-queue" });
  await queue.push({
    body: {
      taskType: CREDENTIAL_ROTATION_TASK,
      taskId,
      // `taskId` rides the PARAMS as well as the envelope: the consumer handler is
      // called with `params` only, and F-304's idempotency claim needs a key that is
      // stable across a redelivery of THIS event. `enqueuedAt` is the moment the admin
      // asked, and it is what orders two rotations — never the consumer's clock, which
      // is the moment a redelivery happened to arrive.
      params: { target, secret, requestedBy: accountId || null, enqueuedAt: nowIso(), taskId },
    },
    // F-336 — ONE rotation at a time per target. The consumer also takes a
    // `git_rotate:<target>` lock (a concurrency key is a scheduling hint, not a
    // mutual-exclusion guarantee), but starting two probes for one connection at
    // once is the race itself, so it is refused here too. Mirrors the shape
    // `gitWebhook` pushes with.
    concurrency: { key: `git-rotate:${target.kind === "connection" ? target.id : "forge-identity"}`, limit: 1 },
  });
  return { ok: true, taskId, queued: true };
}

/**
 * The consumer half of a rotation. The ONLY writer that replaces a stored secret
 * in place.
 *
 * CONNECTION arm: verifies the NEW credential (whoami) before it replaces the
 * old one — a rotation to a dead token would lock the tenant out of their own
 * connection, so the check happens BEFORE the side effect, like every other cap
 * in this app.
 *
 * F-304 / F-336 — AT-LEAST-ONCE IS THE PLATFORM'S PROMISE AND CONCURRENCY IS ITS
 * COROLLARY, SO BOTH GUARDS ARE OURS. Three, all BEFORE the write:
 *   1. A LOCK on `git_rotate:<target>` (FAIL_IF_EXISTS, released on EVERY exit).
 *      It is keyed by target, not by taskId, because its job is to serialise two
 *      DIFFERENT rotations of one connection: they used to read the same
 *      pre-rotation row and race on their `whoami` probes, so the credential the
 *      admin had already abandoned could be the one left in the box. A conflict
 *      answers `busy`; a KVS fault answers `claim_failed` and writes nothing.
 *   2. PER-DELIVERY IDEMPOTENCY, held in the row as `rotatedTaskId`. A redelivery
 *      of the same event does nothing and says `duplicate`.
 *   3. An ORDERING check: a rotation is refused when the row already carries a
 *      `rotatedAt` NEWER than this request's `enqueuedAt`. Without it, a late
 *      redelivery of rotation A overwrites the newer token stored by rotation B —
 *      an admin who fixed a mistyped token watches it silently revert, and the
 *      next deploy 401s with nobody having asked for a change. Equal timestamps
 *      are broken by taskId so the winner is deterministic, never "both".
 * Ordering uses `enqueuedAt` — when the ADMIN asked — never the consumer's clock,
 * which is only when a redelivery happened to arrive.
 *
 * FORGE-IDENTITY arm: NOT verified, and that is PARKED, not an oversight (F-293).
 * Proving an Atlassian API token means calling `/rest/api/3/myself` with Basic
 * email:token against `*.atlassian.net` — a host that is NOT in this app's
 * manifest egress, and adding it is a scope change that needs the owner's
 * decision and tenant re-consent. So a mistyped token here IS stored, and the
 * failure surfaces on the next pipeline deploy as a 401. Do not paper over this
 * with a fake check; the honest fix is the egress entry.
 * What this arm DOES guarantee: the length/emptiness cap before the write, and a
 * consent record that names the admin who actually handed this token over.
 */
export async function applyCredentialRotation(params, { fetchImpl } = {}) {
  const target = params && params.target;
  const secret = params && params.secret;
  if (!target || !secret) return { ok: false, error: "Nothing to rotate", code: "invalid" };

  // The moment the ADMIN asked. Missing (a pre-F-304 event still on the queue)
  // means "unknown", and an unknown moment never wins an ordering comparison.
  const requestedAtMs = params && params.enqueuedAt ? Date.parse(params.enqueuedAt) : NaN;
  const thisTaskId = (params && params.taskId) || "";
  /**
   * Is the request we are holding OLDER than what the row already has?
   * `enqueuedAt` first — the moment the ADMIN asked, never the consumer's clock.
   * EQUAL timestamps are broken by taskId, compared lexicographically, so two
   * requests made in the same millisecond still have ONE deterministic winner
   * instead of both applying (F-336; the old `<` let both through).
   */
  const isStale = (rotatedAt, appliedTaskId) => {
    if (!rotatedAt || Number.isNaN(requestedAtMs)) return false;
    const appliedMs = Date.parse(rotatedAt);
    if (Number.isNaN(appliedMs)) return false;
    if (requestedAtMs !== appliedMs) return requestedAtMs < appliedMs;
    return String(appliedTaskId || "") > thisTaskId;
  };
  const targetId = target.kind === "connection" ? target.id : "forge-identity";
  /** Has THIS delivery already been applied? Per-task idempotency lives in the row now. */
  const alreadyApplied = (row) => !!thisTaskId && row && row.rotatedTaskId === thisTaskId;

  // F-336 — take the per-TARGET lock before reading anything. Two rotations of one
  // connection used to read the same pre-rotation row and race on their network
  // probes; the lock makes the read-probe-write sequence one at a time.
  const lockKey = gitRotateClaimKey(targetId);
  let lockHeld = false;
  const releaseClaim = async () => {
    if (!lockHeld) return;
    lockHeld = false;
    try { await storage.delete(lockKey); } catch (_) { /* best-effort: the real answer is the caller's */ }
  };
  try {
    await storage.set(lockKey, { at: nowIso(), target: target.kind, taskId: thisTaskId || null }, {
      keyPolicy: "FAIL_IF_EXISTS",
      ...ROTATE_LOCK_TTL,
    });
    lockHeld = true;
  } catch (e) {
    // A real conflict means another rotation for this target is in flight. Refuse
    // and write NOTHING — the admin's other rotation is the one that lands, and a
    // second answer would be the race we just closed.
    if (isKeyConflict(e)) {
      return { ok: false, error: "Another rotation for this target is already running — nothing was changed", code: "busy" };
    }
    // Anything else is a KVS fault. This is the only writer that replaces a secret
    // in place, so it fails CLOSED rather than rotating unserialised.
    return { ok: false, error: "The rotation lock could not be taken — nothing was changed", code: "claim_failed" };
  }

  if (target.kind === "forge-identity") {
    const prev = await storage.get(FORGE_IDENTITY_KEY);
    if (!prev) { await releaseClaim(); return { ok: false, error: "No Forge deploy identity is configured", code: "not_found" }; }
    const idTokenErr = tokenValueError(secret.token, "A replacement token is required");
    if (idTokenErr) { await releaseClaim(); return { ok: false, error: idTokenErr, code: "invalid" }; }
    if (alreadyApplied(prev)) {
      // This exact delivery already landed. Not an error — the rotation the admin
      // asked for did happen, once (the per-delivery half of F-304, now recorded
      // in the row instead of in the lock key).
      await releaseClaim();
      return { ok: true, rotated: null, duplicate: true };
    }
    if (isStale(prev.rotatedAt, prev.rotatedTaskId)) {
      // A newer rotation is already stored. Applying this one would REVERT it.
      await releaseClaim();
      return { ok: false, error: "A newer rotation has already been applied — nothing was changed", code: "stale" };
    }
    await storage.set(FORGE_IDENTITY_KEY, {
      ...prev,
      email: secret.email || prev.email,
      token: String(secret.token),
      // F-303 — CONSENT IS COLLECTED, NEVER SYNTHESISED. `saveForgeIdentity` refuses
      // without an explicit `consent: true`; the rotation path has no consent flag at
      // all, so it cannot produce one. The F-293 cut stamped a fresh consent naming
      // the ROTATION's requester, which made the record assert that admin B sat
      // through a consent screen they were never shown — a fabricated audit trail is
      // worse than a stale one.
      //
      // So: the ORIGINAL consent record is kept verbatim (it is the consent that was
      // actually given, for this identity), and who replaced the token is recorded
      // SEPARATELY under `rotation`. Two facts, two fields, neither pretending to be
      // the other. `at` is the moment the ADMIN asked (`enqueuedAt`), not the moment
      // the consumer got round to it.
      consent: prev.consent || null,
      rotation: {
        requestedBy: (params && params.requestedBy) || null,
        at: (params && params.enqueuedAt) || nowIso(),
      },
      rotatedAt: (params && params.enqueuedAt) || nowIso(),
      // The delivery that produced what is in the box: the tiebreak for two
      // requests sharing a millisecond, and the per-task idempotency marker.
      rotatedTaskId: thisTaskId || null,
      updatedAt: nowIso(),
    });
    await releaseClaim();
    return { ok: true, rotated: "forge-identity" };
  }

  const row = await getConnection(target.id);
  if (!row) { await releaseClaim(); return { ok: false, error: "Unknown git connection", code: "not_found" }; }
  const connTokenErr = tokenValueError(secret.token, "A replacement token is required");
  if (connTokenErr) { await releaseClaim(); return { ok: false, error: connTokenErr, code: "invalid" }; }
  if (alreadyApplied(row)) {
    await releaseClaim();
    return { ok: true, rotated: null, duplicate: true };
  }
  if (isStale(row.rotatedAt, row.rotatedTaskId)) {
    await releaseClaim();
    return { ok: false, error: "A newer rotation has already been applied — nothing was changed", code: "stale" };
  }
  try {
    const probe = createGitProvider({
      kind: row.kind,
      auth: row.kind === "bitbucket" ? { email: secret.email, token: secret.token } : { token: secret.token },
      fetchImpl,
    });
    await probe.whoami();
  } catch (e) {
    const code = e instanceof GitProviderError ? e.code : "network";
    // Nothing was written. The old credential is untouched and still works — and the
    // claim goes back, so the platform's retry of this delivery is not swallowed.
    await releaseClaim();
    return { ok: false, error: "The replacement credential was rejected — nothing was changed", code };
  }
  await storage.set(gitConnSecretKey(target.id), {
    token: String(secret.token),
    ...(row.kind === "bitbucket" ? { email: secret.email } : {}),
    updatedAt: nowIso(),
  });
  await storage.set(gitConnKey(target.id), {
    ...row,
    status: "ok",
    authDeadAt: null,
    authDeadReason: null,
    lastCheckedAt: nowIso(),
    // F-304's ordering mark: the moment the ADMIN asked for the credential that is
    // now in the box. A later delivery carrying an EARLIER `enqueuedAt` is refused.
    rotatedAt: (params && params.enqueuedAt) || nowIso(),
    rotatedBy: (params && params.requestedBy) || null,
    rotatedTaskId: thisTaskId || null,
    updatedAt: nowIso(),
  });
  await releaseClaim();
  return { ok: true, rotated: "connection", id: target.id };
}

/** Rotate ONE repo's webhook secret. Queued-task half, same reason as above. */
export async function rotateHookSecret(connId, repoId) {
  const secret = generateWebhookSecret();
  await storage.set(gitHookSecretKey(connId, repoId), {
    secret,
    connId,
    repoId: normalizeRepoId(repoId),
    createdAt: nowIso(),
    rotatedAt: nowIso(),
  });
  return { secret };
}
