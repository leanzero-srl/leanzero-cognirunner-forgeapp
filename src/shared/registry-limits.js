/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * Rule-registry scale limits — the SINGLE SOURCE for the caps that guard the
 * `config_registry` KVS value, plus the pure pressure math the admin panel's
 * meter renders. Pure and dependency-free: imported by the backend
 * (registerConfig / registerPostFunction / registerDiscoveredRulesCore /
 * commitImportCore / getConfigs) AND by the admin-panel frontend.
 *
 * Why these numbers exist at all: the whole registry lives in ONE KVS value
 * with a hard ~240KiB platform ceiling. There is no eviction — the caps are a
 * refusal, and the escape valve is deleting rules from the admin panel's Rules
 * tab. Before these constants existed the literals were duplicated across six
 * call sites and the two byte thresholds silently disagreed.
 *
 * The two byte thresholds are deliberately DIFFERENT, not an oversight:
 * minting a brand-new rule earns less headroom than claiming a rule that is
 * already attached and already running (refusing the claim doesn't stop the
 * rule, it just leaves it unmanageable). Keep them named rather than merged —
 * collapsing them is a cap change, which CORE_CONTRACT §1.7 puts behind
 * explicit human approval.
 */

/** Hard row cap for the registry. A create/claim at or above this is refused. */
export const REGISTRY_MAX_ROWS = 500;

/**
 * The real ceiling: Forge stores one KVS value up to 240KiB. Crossing this is
 * not a policy choice, it is data corruption. Everything below is headroom
 * management beneath it.
 */
export const REGISTRY_HARD_MAX_BYTES = 240 * 1024;

/** Serialized-byte ceiling for MINTING a new rule (create paths). */
export const REGISTRY_CREATE_MAX_BYTES = 200000;

/** Serialized-byte ceiling for CLAIMING an already-attached rule (scan paths). */
export const REGISTRY_CLAIM_MAX_BYTES = 230000;

/** Shown when the row cap is hit. Must name the actual escape route. */
export const REGISTRY_FULL_MESSAGE =
  `Rule registry is full (${REGISTRY_MAX_ROWS} rules). Delete rules you no longer need from the admin panel's Rules tab, then try again.`;

/** Shown when the byte ceiling is hit before the row cap (PF-heavy installs). */
export const REGISTRY_SIZE_MESSAGE =
  "Rule registry has reached its storage size limit. Delete rules you no longer need from the admin panel's Rules tab (static post-function code is the usual culprit), then try again.";

/** Warn/full thresholds for the meter, as fractions of the caps. */
export const REGISTRY_WARN_AT = 0.7;
export const REGISTRY_FULL_AT = 0.9;

/**
 * Pure pressure math for the admin-panel meter.
 *
 * Accepts either the registry array or a precomputed `{ count, bytes }` so the
 * caller can avoid a second JSON.stringify on a hot path.
 *
 * Two different numbers, and conflating them produced a meter that read
 * "219 / 200 KB" — a usage bar reporting a value past its own maximum, which
 * tells a user nothing except that the number is wrong:
 *
 *   CAPACITY  = REGISTRY_HARD_MAX_BYTES. What the meter measures against. Going
 *               past it corrupts the registry, so it is the only honest "out of".
 *   REFUSAL   = REGISTRY_CREATE_MAX_BYTES. Where the app stops accepting NEW
 *               rules, deliberately below capacity so there is room to
 *               re-save and delete existing ones. Being past it is normal and
 *               recoverable — it is a state to report, not a maximum breached.
 *
 * Returns { count, bytes, max, maxBytes, refuseAtBytes, rowPct, bytePct, pct,
 * level, refusing } where `pct` is the binding constraint and `level` is
 * "ok" | "warn" | "full".
 */
export function registryPressure(input) {
  let count = 0;
  let bytes = 0;
  if (Array.isArray(input)) {
    count = input.length;
    try {
      bytes = JSON.stringify(input).length;
    } catch {
      bytes = 0; // never let meter math throw on the read path
    }
  } else if (input && typeof input === "object") {
    count = Number(input.count) || 0;
    bytes = Number(input.bytes) || 0;
  }
  const rowPct = REGISTRY_MAX_ROWS > 0 ? count / REGISTRY_MAX_ROWS : 0;
  // Measured against CAPACITY, so the fraction can never exceed 1 in normal use.
  const bytePct = REGISTRY_HARD_MAX_BYTES > 0 ? bytes / REGISTRY_HARD_MAX_BYTES : 0;
  const pct = Math.max(rowPct, bytePct);
  // Refusing is a fact about the app's behaviour, not a percentage — a user at
  // 201 KB is refused just as firmly as one at 239 KB, and needs to be told so.
  const refusing = count >= REGISTRY_MAX_ROWS || bytes > REGISTRY_CREATE_MAX_BYTES;
  const level = refusing || pct >= REGISTRY_FULL_AT ? "full"
    : pct >= REGISTRY_WARN_AT ? "warn"
      : "ok";
  return {
    count,
    bytes,
    max: REGISTRY_MAX_ROWS,
    maxBytes: REGISTRY_HARD_MAX_BYTES,
    refuseAtBytes: REGISTRY_CREATE_MAX_BYTES,
    rowPct,
    bytePct,
    pct,
    level,
    refusing,
  };
}
