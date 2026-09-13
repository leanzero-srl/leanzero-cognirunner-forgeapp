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
const hours = (n) => ({ ttl: { value: n, unit: "HOURS" } });

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
 * F-506 — THE COMPACTION BACKOFF: 6 hours, and the number lives HERE rather than in
 * `va-config.js` on purpose. Every other number in this file is a CAP an admin can reason
 * about (how long a row is kept, how many items a tick may take); this one is not a cap,
 * it is the lifetime of the marker itself — how long a broken summariser is left alone
 * before the next tick is allowed to pay for another attempt. It has exactly one reader
 * and one writer (`readCompactBackoff` / `setCompactBackoff` in `src/va-ledger.js`) and no
 * surface renders it, so the "caps have one home" rule has nothing to bind: the TTL IS the
 * policy, and it belongs beside the key it expires.
 *
 * 6 hours is ~72 skipped 5-minute ticks: long enough that a revoked BYOK key costs four
 * failed calls a day instead of 288, short enough that a fixed key heals itself the same
 * working day without anybody touching the agent.
 */
export const VA_COMPACT_BACKOFF_TTL = hours(6);
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

/**
 * `va_compact_backoff:{agent}` — F-506. Set when a compaction turn was PAID FOR and did
 * not converge (the summariser threw, or its output was still over the trigger), read
 * before the claim on every later tick.
 *
 * Keyed on the AGENT, not the tick, and that is the whole point: the claim above makes one
 * tick buy one turn, and a per-tick key can never stop the NEXT tick asking a provider
 * that is still dead. Before this, a revoked key bought 288 failed model calls a day, for
 * ever, on a memory that never shrank by a byte.
 */
export const vaCompactBackoffKey = (agent) =>
  assertKvsKey(`va_compact_backoff:${part(agent)}`);

/**
 * `va_purged:{agent}` — F-553. THE TOMBSTONE. Written FIRST by `purgeAgent`, read by every
 * ledger writer and at the entry and write seam of every VA task.
 *
 * WHY A ROW AND NOT A BETTER-ORDERED PURGE. F-469's purge is raced by the agent's own
 * in-flight turns: `executeVaItemTask` asks whether the agent exists at the START of a turn
 * and then spends up to two minutes on a model call, so a turn already past that check when
 * `deleteScheduledJob` runs finishes normally and writes `va_item:{agent}:{key}` plus a
 * REBUILT `va_index:{agent}` — stamped after the purge, for an agent that no longer exists,
 * and the index carries no TTL. Reproduced live on staging twice, on two agents. There is no
 * ordering that fixes this from the delete side: the delete runs in a 25 s resolver and
 * cannot wait for a 120 s consumer to drain. So the purge leaves a marker that outlives the
 * flight, and the writers ask.
 *
 * THE TTL IS 3 DAYS, and the number is derived, not chosen: the longest thing that can still
 * be in flight for a purged agent is a queued task under its own claim, and `VA_CLAIM_TTL` is
 * 2 days — one day on top of that covers the long consumer's 120 s and any redelivery inside
 * the claim window with room to spare. Shorter than the claim TTL would reopen the race at
 * exactly the horizon the claims were sized for.
 *
 * IT IS CLEARED, NOT ONLY EXPIRED (F-512's shape). An agent id can come BACK — `normalizeJob`
 * accepts a caller-supplied `src.id`, which is the import/restore path — and a re-created
 * agent inheriting a dead one's tombstone could not write a single row for three days. So the
 * first prepare tick clears it, but ONLY when the tombstone predates the job's `createdAt`:
 * that comparison is what distinguishes a genuinely re-created job from a tick of the DELETED
 * job that is still in flight, which must not be allowed to unlock the ledger it is racing.
 *
 * F-575 — AND THAT COMPARISON, ON ITS OWN, PROVES THE WRONG THING. `stamped < created` proves
 * the JOB is new. It says nothing about whether the OLD agent's TURN has finished, and those
 * are different clocks: delete at T+0, re-create through the REST API at T+5 s (`normalizeJob`
 * server-stamps `createdAt`, so it is honestly newer), first prepare tick clears at T+60 s,
 * and the pre-delete turn — delivered before the delete, still inside its 120 s consumer —
 * reaches its write seam at T+90 s and writes its rows into the LIVE agent's ledger. Every
 * guard F-553 added passes again, because the tombstone it was refusing under is gone.
 * See `clearPurgeTombstone` (src/va-ledger.js) for the settle test that closes it.
 */
export const VA_PURGED_TTL = days(3);
export const vaPurgedKey = (agent) => assertKvsKey(`va_purged:${part(agent)}`);

/**
 * F-575 — THE SETTLE WINDOW: how long after a tombstone is stamped no clear may happen.
 *
 * THE NUMBER LIVES HERE, NOT IN `va-config.js`, for the `VA_COMPACT_BACKOFF_TTL` reason
 * stated above: every number in `va-config.js` is a CAP an admin can reason about and a
 * surface renders. This is neither. It is a property of the MARKER — the horizon past
 * which a turn that started before the marker cannot still be running — with one reader
 * (`clearPurgeTombstone`) and no surface at all.
 *
 * WHY IT IS A SOUND PROOF AND NOT A GUESS. The only turn that can reach a write seam
 * without seeing a standing tombstone is one that passed the ENTRY check BEFORE the
 * tombstone was written; any task delivered after it refuses at entry, including every
 * redelivery. Such a turn is bounded by the consumer's 120 s. So once the tombstone is
 * older than the consumer budget plus slop, no pre-delete turn can still be in flight.
 *
 * FIVE MINUTES: the consumer's 120 s, plus queue-visibility and clock slop, rounded to
 * the scheduler's own 5-minute tick so the cost is exactly ONE extra tick for a
 * re-created agent rather than an arbitrary wait. Compare the alternative it replaces:
 * three days of a re-created agent that cannot write a ledger row.
 */
export const VA_PURGE_SETTLE_MS = 5 * 60 * 1000;

/**
 * F-575 — THE CLAIM PREFIXES, listed ONCE.
 *
 * The three keys above that a RUNNING turn holds: `va_exec:` (the item turn),
 * `va_post:` (the delivery) and `va_compact:` (the memory compaction step). The settle
 * window is the guarantee; a bounded scan of these is the CORROBORATION, and it is the
 * only thing that can see the one case the clock cannot — a turn that passed the entry
 * check because its tombstone READ FAULTED (`readPurgeTombstone` fails soft and
 * `purgedGuard` treats a fault as "write on", deliberately).
 *
 * They are PREFIXES, so they are not asserted — `assertKvsKey` checks a whole key and a
 * prefix is a fragment, the same rule `vaTickPrefix` states. They live here, beside the
 * builders that mint the keys, so the read side cannot retype what the write side built:
 * a scan against a misspelt prefix finds nothing and reads as "no turn is running",
 * which is the proven-negative trap this whole area exists to avoid.
 */
export const vaExecPrefix = (agent) => `va_exec:${part(agent)}:`;
export const vaPostPrefix = (agent) => `va_post:${part(agent)}:`;
export const vaCompactPrefix = (agent) => `va_compact:${part(agent)}:`;
export const vaClaimPrefixes = (agent) => [vaExecPrefix(agent), vaPostPrefix(agent), vaCompactPrefix(agent)];
