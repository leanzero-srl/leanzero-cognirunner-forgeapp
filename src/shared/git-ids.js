/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The storage keys that identify ONE git webhook delivery — the single home of the
 * shapes (F-335). The webhook (src/index.js `gitWebhook`) takes the claim at ACCEPT
 * time and the consumer (src/async-handler.js `executeGitEvent`) is what makes it mean
 * COMPLETION: it releases the claim when a dispatch throws, so the provider's Redeliver
 * button is not answered `duplicate` for a delivery that never ran.
 *
 * Two writers on one key shape means the shape may not live inline in either of them.
 * Dependency-free on purpose: it bundles into the backend and any test (kvs-keys.js
 * is shared and dependency-free too).
 *
 * BOTH ids are SANITISED here, not at the call sites: `deliveryId` is a clamped but
 * otherwise raw provider header, and a key part that can contain arbitrary characters
 * is a key part that can be shaped (F-334). Sanitising inside the builder is also what
 * keeps the webhook's claim and the consumer's release on the SAME key.
 */
import { safeKeyPart, assertKvsKey } from "./kvs-keys.js";

const part = (s) => safeKeyPart(s);

/**
 * F-370 — THE ONE HOME for how long a git delivery claim lives.
 *
 * Two files write this row: the webhook (src/index.js `gitWebhook`) takes it at ACCEPT
 * time with FAIL_IF_EXISTS, and the consumer (src/async-handler.js `executeGitEvent`)
 * RE-TAKES it after a retried success (F-367). The row means the same thing in both, so
 * it must expire at the same time in both — a shorter re-take would let a provider
 * Redeliver run a delivery twice, a longer one would answer `duplicate` for a delivery
 * whose accept-time twin had already aged out. It was a bare `{ value: 24, unit: "HOURS" }`
 * literal in BOTH files, which is LAW 1's signature defect.
 *
 * The attempt counter (`gitDeliveryAttemptKey`) shares the window deliberately: it must
 * not outlive the claim it counts, nor vanish while the claim still refuses redelivery.
 *
 * Seconds, not hours, so a test can assert the number without re-deriving a unit.
 */
export const GIT_DELIVERY_CLAIM_TTL_S = 24 * 60 * 60;

/** The same TTL in the option shape KVS `set` and `claimRuleExecution` both take. */
export const GIT_DELIVERY_CLAIM_TTL = { ttl: { value: GIT_DELIVERY_CLAIM_TTL_S, unit: "SECONDS" } };

/** The 24 h idempotency claim: taken at accept, released when a dispatch throws. */
export const gitDeliveryClaimKey = (connectionId, deliveryId) => assertKvsKey(`git_delivery:${part(connectionId)}:${part(deliveryId)}`);

/** The dispatch-attempt counter, so a poison delivery cannot retry forever. */
export const gitDeliveryAttemptKey = (connectionId, deliveryId) => assertKvsKey(`git_delivery_try:${part(connectionId)}:${part(deliveryId)}`);

/**
 * The platform retries a thrown consumer event up to four times. A delivery that has
 * thrown this many times is DROPPED loudly rather than redelivered forever.
 */
export const GIT_DISPATCH_MAX_ATTEMPTS = 4;

/**
 * F-310 — THE ONE HOME for a repository identifier.
 *
 * A repo id is the string "owner/name" (GitHub) or "workspace/slug" (Bitbucket), and
 * the app compares it in four places that must all agree: the connection allow-list
 * (`isRepoAllowed`, src/git-connections.js), the per-repo webhook secret key
 * (`gitHookSecretKey`), the normalised webhook envelope (`src/shared/jira-events.js`
 * slims `payload.repoId`), and now a listener's `filters.repos` typed by a human in
 * the admin panel's EventPicker. Before this module there were THREE copies of
 * `String(x).trim().toLowerCase()` — one of them in a BACKEND module the frontend
 * cannot import (git-connections.js loads @forge/kvs), which is exactly why the
 * fourth copy was about to be typed into a .jsx file.
 *
 * Case: provider repo names are case-INSENSITIVE for addressing and the webhook
 * envelope already lower-cases what it stores, so lower-case is the canonical form.
 * A filter that stored "Acme/Web" would silently never match the envelope's
 * "acme/web" — a listener that looks configured and never fires.
 *
 * Dependency-free: this bundles into the Forge backend AND two webpack builds.
 */

/** Canonical form of one repo id: trimmed, lower-cased, surrounding slashes dropped. */
export const normalizeRepoId = (repoId) =>
  String(repoId == null ? "" : repoId).trim().replace(/^\/+|\/+$/g, "").toLowerCase();

/**
 * Is this a plausible "owner/name"? Deliberately SHAPE-only — it is not a claim that
 * the repository exists, and it must not be used as a security control (the
 * allow-list is). It exists so the picker can tell a human "that is not owner/name"
 * instead of storing a filter that can never match.
 */
export const isRepoIdShaped = (repoId) => /^[^\s/]+\/[^\s/]+$/.test(normalizeRepoId(repoId));

/**
 * Parse what a human typed (comma, semicolon, newline or whitespace separated) into
 * canonical ids, de-duplicated, order preserved. Empty entries vanish; malformed ones
 * are KEPT (the caller shows them as invalid) — dropping them silently would make a
 * typo look like it was accepted.
 */
export const parseRepoList = (text) => {
  const out = [];
  for (const raw of String(text == null ? "" : text).split(/[\s,;]+/)) {
    const id = normalizeRepoId(raw);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
};

/** The canonical rendering of a parsed list back into an input field. */
export const formatRepoList = (repos) =>
  (Array.isArray(repos) ? repos : []).map(normalizeRepoId).filter(Boolean).join(", ");

/**
 * THE provider-kind vocabulary, and its brand hues, in a module the ADMIN PANEL can
 * import. `src/git-providers.js` owned this list first but pulls in `tweetnacl`, so a
 * frontend that needed the two ids would have retyped them - and a kind the picker
 * offers but the backend does not know is a connection that cannot be saved.
 * git-providers.js now re-exports from here, so there is still one list.
 *
 * NO HUES HERE, deliberately. The brand colours (GitHub #0f172a / dark #334155,
 * Bitbucket #0052cc / dark #2684ff) live in CSS as `.code-kind-github` /
 * `.code-kind-bitbucket` because they need a dark-mode override, and an inline style
 * read from JS cannot have one. `EVENT_CATEGORIES` keeps its hues in JS only because
 * EventPicker renders them inline; that is the exception, not the pattern to copy.
 */
export const GIT_PROVIDER_KINDS = ["github", "bitbucket"];
export const GIT_PROVIDER_KIND_META = {
  github: { id: "github", label: "GitHub" },
  bitbucket: { id: "bitbucket", label: "Bitbucket" },
};
/** Never guesses: an unknown kind renders as itself, and the CSS gives it neutral slate. */
export const gitProviderKindMeta = (kind) =>
  GIT_PROVIDER_KIND_META[String(kind || "").toLowerCase()]
  || { id: String(kind || "unknown"), label: String(kind || "Unknown") };

/* ===== F-346 / F-348 — EVERY KVS KEY SHAPE THAT CARRIES A REPO ID LIVES HERE ===== */

/** 32-bit FNV-1a, hex, 8 chars. Dependency-free and stable across runtimes — it is an
 *  identity suffix, never a security primitive. */
const fnv1a32 = (s) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
};

/**
 * THE ONE WAY a repository id becomes part of a KVS key (F-346).
 *
 * Forge KVS refuses "/" in a key (`assertKvsKey` carries the platform pattern), so the
 * canonical repo id "owner/name" can never be embedded raw — the live proof was that the
 * per-repo hook secret could not be written at all and the whole inbound git path
 * answered 503.
 *
 * THE COLLISION CHOICE: sanitising alone is LOSSY — `safeKeyPart` maps every illegal
 * character to "-", so "a/b-c" and "a-b/c" would land on the same key and one repo's
 * secret would be read for another repo. So the part is TWO pieces:
 *   1. a readable body: "/" → "#" (legal in a KVS key, and no provider allows "#" in an
 *      owner or repo name, so it reads back unambiguously for a well-formed id), then
 *      `safeKeyPart` for anything else and a clamp to 80 chars;
 *   2. a "." separated 8-hex FNV-1a of the RAW canonical id, which is what actually makes
 *      the part injective for hostile or over-long ids where piece 1 is lossy.
 * Readability comes from piece 1; correctness comes from piece 2. Never drop the hash.
 *
 * The raw canonical `normalizeRepoId(...)` stays the comparison VALUE everywhere (the
 * connection allow-list, the webhook envelope, a listener's `filters.repos`) — only KEY
 * parts change shape. There is nothing to migrate: no row was ever written under the old
 * shape, because the platform refused every one of them.
 */
export const repoKeyPart = (repoId) => {
  const canonical = normalizeRepoId(repoId);
  return `${safeKeyPart(canonical.replace(/\//g, "#")).slice(0, 80)}.${fnv1a32(canonical)}`;
};

/** Per-repo webhook signing secret. Per-repo, not per-connection: a leaked secret on one
 *  repo must not let an attacker forge deliveries for another. */
export const gitHookSecretKey = (connId, repoId) =>
  assertKvsKey(`git_hook_secret:${part(connId)}:${repoKeyPart(repoId)}`);

/** The per-repo pipeline record. Bounded; never carries a secret. */
export const gitPipelineKey = (connId, repoId) =>
  assertKvsKey(`git_pipeline:${part(connId)}:${repoKeyPart(repoId)}`);

/** The concurrency CLAIM for one pipeline setup run (FAIL_IF_EXISTS, 10 minutes). */
export const gitPipelineClaimKey = (connId, repoId) =>
  assertKvsKey(`git_pipeline_exec:${part(connId)}:${repoKeyPart(repoId)}`);

export const REVIEW_CLAIM_PREFIX = "git_review:";
export const REVIEW_RATE_PREFIX = "git_review_rate:";

/** The PR-review claim identity: one review per connection, repo, PR and head sha. */
export const reviewClaimKey = (connectionId, repoId, prNumber, headSha) =>
  assertKvsKey(`${REVIEW_CLAIM_PREFIX}${part(connectionId) || "none"}:${repoKeyPart(repoId)}:${part(prNumber)}:${part(headSha) || "nosha"}`);

/** One slot of the reviews-per-repo-per-clock-hour ledger (F-285). */
export const reviewRateKey = (connectionId, repoId, nowMs = Date.now(), slot = 0) =>
  assertKvsKey(`${REVIEW_RATE_PREFIX}${part(connectionId) || "none"}:${repoKeyPart(repoId)}:${Math.floor(nowMs / 3600000)}:${slot}`);
