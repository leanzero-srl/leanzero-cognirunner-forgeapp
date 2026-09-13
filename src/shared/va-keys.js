/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * THE ONE HOME for every Virtual Administrator KVS key and its row TTL (F-346/F-349).
 *
 * F-346 was live proof that an id interpolated straight into a key can make a whole
 * feature unwritable: Forge KVS refuses "/" (`INVALID_KEY`), and nothing offline could
 * tell, because legality was asserted nowhere. The VA's key parts are WORSE than a repo
 * id — an agent id is generated, but an issue key comes from a JQL sweep, a caps bucket
 * from a clock, and a `tickId` from a scheduler. So every part goes through
 * `safeKeyPart` and every finished key through `assertKvsKey`, HERE, not at the call
 * site. `test-harness/scripts/kvs-key-shapes.test.mjs` feeds each builder below the same
 * hostile fixture set the git builders get.
 *
 * WHY THE TTL SHAPES LIVE HERE AND THE NUMBERS DO NOT: a row's lifetime belongs beside
 * the key that names it (the `git-ids.js` GIT_DELIVERY_CLAIM_TTL precedent — two writers,
 * one window), but the NUMBER is a cap and caps have one home in `va-config.js`. So this
 * file owns the `{ttl:{value,unit}}` shapes and imports every number.
 *
 * Dependency-free: it bundles into the backend and into the admin panel's Agents tab,
 * which renders the same TTLs it must not retype.
 */
import { safeKeyPart, assertKvsKey } from "./kvs-keys.js";
import { VA_LIMITS } from "./va-config.js";

const part = (s) => safeKeyPart(s);
const days = (n) => ({ ttl: { value: n, unit: "DAYS" } });

/* ── row TTLs, in the option shape KVS `set` and `claimRuleExecution` both take ── */

/** 90 days, REFRESHED on every touch (F-413) — an item worked on yesterday is not stale. */
export const VA_ITEM_TTL = days(VA_LIMITS.itemTtlDays);
/** The index shares the item TTL: an index that outlives every row it names is a lie. */
export const VA_INDEX_TTL = days(VA_LIMITS.itemTtlDays);
/** Tick receipts: 7 days. Long enough to read a weekend, short enough to stay cheap. */
export const VA_TICK_TTL = days(VA_LIMITS.tickTtlDays);
/** Effects: 30 days — this is the row an admin reads to answer "what did it DO?". */
export const VA_EFFECT_TTL = days(VA_LIMITS.effectTtlDays);
/**
 * Caps buckets outlive their own window by a margin so a clock skew cannot make a bucket
 * vanish mid-window; 2 days covers the day bucket and every hour bucket inside it.
 */
export const VA_CAPS_TTL = days(2);
/**
 * `va_health`: the item TTL, REFRESHED on every tick (F-469).
 *
 * F-426 is why this counter is a row of its own rather than a scan over `va_tick:*`, and
 * that argument is about RECONSTRUCTION, not about immortality: the row is rewritten by
 * `recordTickHealth` on every single tick, so a TTL as long as an item row can only ever
 * expire for an agent that has not ticked in 90 days - one that is disabled, or deleted
 * and left behind by a purge that could not finish. Before this it never expired at all,
 * which is how a deleted agent's counter outlived the agent for ever.
 *
 * `va_memory` still carries NO TTL, deliberately. It is the agent's only durable state
 * and it is written only when the agent LEARNS something, not on a clock, so any TTL
 * would silently erase what a quiet agent knows. Its bounded end is `purgeAgent`
 * (src/va-ledger.js), called from the job delete.
 */
export const VA_HEALTH_TTL = days(VA_LIMITS.itemTtlDays);
/** Claims: 2 days. Longer than any retry window, shorter than the item row. */
export const VA_CLAIM_TTL = days(2);
/**
 * A half-finished setup interview: 7 days (`VA_LIMITS.wizardTtlDays`, one home in
 * `registry-limits.js`). This row is keyed on an ACCOUNT ID, which is the one key part
 * here that comes from Atlassian rather than from us — account ids carry `:` and `-`
 * routinely and a connect-era one can carry far worse, so `safeKeyPart` is doing real
 * work on this builder and not merely satisfying the rule (F-346's exact class).
 */
export const VA_WIZARD_TTL = days(VA_LIMITS.wizardTtlDays);

/* ── key builders — every one asserted ─────────────────────────────────────── */

/** `va_item:{agent}:{issueKey}` — one row per item. NEVER an array (the `pf_memories` lesson). */
export const vaItemKey = (agent, issueKey) => assertKvsKey(`va_item:${part(agent)}:${part(issueKey)}`);

/** `va_index:{agent}` — the bounded, LRU-ordered list of live item ids for one agent. */
export const vaIndexKey = (agent) => assertKvsKey(`va_index:${part(agent)}`);

/** `va_memory:{agent}` — prose + pinned constraints. */
export const vaMemoryKey = (agent) => assertKvsKey(`va_memory:${part(agent)}`);

/**
 * `va_tick:{agent}:{tickId}` — ONE receipt per PHASE (F-421): the post phase is its own
 * task and does not ride the prepare tick's receipt, so callers pass `tickIdFor(phase, id)`.
 */
export const vaTickKey = (agent, tickId) => assertKvsKey(`va_tick:${part(agent)}:${part(tickId)}`);

/** The phased receipt id. Kept here so both phases cannot drift apart in two files. */
export const VA_TICK_PHASES = Object.freeze(["prepare", "post"]);
export const tickIdFor = (phase, tickId) => `${VA_TICK_PHASES.includes(phase) ? phase : "prepare"}-${tickId}`;

/** `va_effect:{agent}:{invTs}` — written ONLY after a read-back proof (§3.14 law 6). */
export const vaEffectKey = (agent, invTs) => assertKvsKey(`va_effect:${part(agent)}:${part(invTs)}`);

/**
 * `va_caps:{agent}:{bucket}` — fixed clock buckets, the `lst_brake` mechanism
 * (`src/listeners.js:77`) at a different granularity. Owed speech has its OWN bucket
 * prefix because F-412 dropped `owedUncapped`: owed is cheaper, never free.
 */
export const VA_CAPS_BUCKET_PREFIXES = Object.freeze({ hour: "h", day: "d", owedHour: "oh" });
export const vaCapsKey = (agent, bucket) => assertKvsKey(`va_caps:${part(agent)}:${part(bucket)}`);
export const capsBuckets = (now = Date.now()) => {
  const t = Number(now) || 0;
  const hour = Math.floor(t / 3600000);
  const day = Math.floor(t / 86400000);
  return { hour: `h:${hour}`, day: `d:${day}`, owedHour: `oh:${hour}` };
};

/** `va_health:{agent}` — the banner's OWN consecutive-failure counter (F-426). */
export const vaHealthKey = (agent) => assertKvsKey(`va_health:${part(agent)}`);

/**
 * `va_wizard:{accountId}` — ONE half-finished setup interview per admin.
 *
 * Keyed on the ADMIN, not on an agent, because the interview exists before the agent
 * does; there is nothing else it could be named after. One row per admin is deliberate:
 * two interviews in two tabs would race on the same key and the loser's answers would be
 * silently overwritten, so the second tab RESUMES the first rather than forking it.
 */
export const vaWizardKey = (accountId) => assertKvsKey(`va_wizard:${part(accountId)}`);

/**
 * The prefix a bounded `query()` scan uses to read one agent's tick receipts and effects
 * rows for the Agents tab. They are PREFIXES, not keys, so they are not asserted —
 * `assertKvsKey` checks a whole key and a prefix is by definition a fragment. They live
 * here anyway so the read side cannot retype the string the write side builds, which is
 * the failure mode that makes a panel silently show nothing.
 */
export const vaTickPrefix = (agent) => `va_tick:${part(agent)}:`;
export const vaEffectPrefix = (agent) => `va_effect:${part(agent)}:`;

/**
 * `va_exec:{agent}:{key}:{tickId}` — taken by the CONSUMER at the start of the item task,
 * FAIL_IF_EXISTS + failClosed, released on throw before any side effect (F-422).
 */
export const vaExecClaimKey = (agent, issueKey, tickId) =>
  assertKvsKey(`va_exec:${part(agent)}:${part(issueKey)}:${part(tickId)}`);

/**
 * `va_post:{agent}:{key}:{stagedAt}` — the delivery claim. `stagedAt`, not `tickId`: the
 * identity of a post is the DRAFT it delivers, so a redelivered post task and a second
 * tick that finds the same staged row both land on the same key.
 */
export const vaPostClaimKey = (agent, issueKey, stagedAt) =>
  assertKvsKey(`va_post:${part(agent)}:${part(issueKey)}:${part(stagedAt)}`);

/**
 * `va_compact:{agent}:{tickId}` — taken by the MEMORY COMPACTION STEP at the head of the
 * prepare tick (F-494), FAIL_IF_EXISTS + failClosed, exactly like the item claim.
 *
 * The identity is the TICK, not the memory: a compaction turn is one model call, and a
 * duplicate trigger delivery for the same 5-minute tick must buy exactly one of them. The
 * step is idempotent under the claim in the direction that matters — a second delivery
 * does nothing rather than summarising an already-summarised memory, which is how a
 * memory loses detail twice for one tick's worth of growth.
 */
export const vaCompactClaimKey = (agent, tickId) =>
  assertKvsKey(`va_compact:${part(agent)}:${part(tickId)}`);
