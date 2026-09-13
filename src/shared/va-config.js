/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// STUB — replaced by 1.5 commit 1; keep names identical
//
// 1.5 commit 1 (cr-rules-surgeon, in parallel) owns this file: the VA record shape,
// `normalizeVa`, `assertWriteScope` and every gate constant. Commit 2 (`src/va-ledger.js`,
// `src/shared/va-keys.js`) needs ONLY the cap/TTL NUMBERS, so this stub declares exactly
// those and nothing else. The merge is a DELETE of this file — commit 1's version must
// carry the same `VA_LIMITS` member names or the ledger's clamps silently become NaN.
//
// Dependency-free (bundles into the backend AND the admin panel), like every src/shared/*.

/**
 * THE ONE HOME for the ledger's caps and TTLs (F-413/F-414/F-423/F-412).
 *
 * Frozen so a caller cannot mutate a cap at runtime: a cap that one module can raise is
 * not a cap. Numbers, not option shapes — the KVS `{ttl:{value,unit}}` shapes are built
 * in `va-keys.js` beside the keys they belong to (the `git-ids.js` precedent).
 */
export const VA_LIMITS = Object.freeze({
  /** `va_item` row TTL, refreshed on every touch (F-413). */
  itemTtlDays: 90,
  /** `va_tick` receipt TTL (FRAME §4 commit 2). */
  tickTtlDays: 7,
  /** `va_effect` TTL (FRAME §4 commit 2). */
  effectTtlDays: 30,
  /** Per-agent `va_item` row cap; the oldest-touched rows are PARKED over it (F-413). */
  itemRowCap: 400,
  /** A per-item turn that stages nothing counts an attempt; it parks at this many (F-414). */
  attemptsCap: 3,
  /** `history[]` entries kept per item. */
  historyMax: 10,
  /** `notes` characters per item. */
  notesMaxChars: 600,
  /** A staged draft body. */
  stagedBodyMaxChars: 2000,
  /** `va_memory.text` ceiling after compaction. */
  memoryCapBytes: 8192,
  /** Compaction is triggered above this. */
  memoryCompactBytes: 6144,
  /** Pinned constraints: how many, and how long each may be. */
  constraintsMax: 20,
  constraintMaxChars: 300,
  /** Candidates fanned out per prepare tick. */
  maxItemsPerTick: 5,
  /** Speech caps (F-412). `owedPerHour` is its OWN counter — `owedUncapped` does not exist. */
  capsPerHour: 6,
  capsPerDay: 40,
  owedPerHour: 12,
});
