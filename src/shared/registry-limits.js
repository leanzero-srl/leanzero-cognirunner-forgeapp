/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * Rule-registry scale limits — the SINGLE SOURCE for the caps that guard the
 * `config_registry` KVS value, plus the pure pressure math behind the admin
 * panel's meter. Pure and dependency-free. Imported by the backend only
 * (registerConfig / registerPostFunction / registerDiscoveredRulesCore /
 * commitImportCore / getConfigs); the admin-panel frontend renders the
 * pressure object the getConfigs resolver returns — it does NOT import this
 * module, so cap changes reach the UI without a frontend rebuild.
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
 * Byte threshold above which the REGISTRY COPY of a static post-function's
 * step code moves to its own `pf_code:` KVS entry. Deliberately far below
 * PF_FUNCTIONS_OFFLOAD_BYTES (24576, src/index.js) — that constant decides
 * when the WORKFLOW-embedded config goes slim (a runtime behaviour change:
 * execution then depends on the bundle fetch), while this one only decides
 * what the shared 240KiB registry value carries. Offloading the registry copy
 * costs nothing at runtime and nothing in the editor: the workflow config
 * stays inline, and the row keeps codeRef + functionsMeta for display.
 */
export const REGISTRY_FUNCTIONS_OFFLOAD_BYTES = 2048;

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

/**
 * Serialized-byte ceiling for UPDATING an existing row. Updates were entirely
 * unguarded (both create checks gate on "is this a new row"), so edits could
 * grow rows from the 200KB refusal line straight to the platform ceiling.
 * Deliberately ABOVE the claim threshold: an update that shrinks or barely
 * grows a row must never be refused near the line — slimming and deleting are
 * how a full registry recovers — so this only stops updates that would push
 * the whole value within a hair of corruption.
 */
export const REGISTRY_UPDATE_MAX_BYTES = 235000;

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
/**
 * Slim one registry row for storage. Pure, synchronous, idempotent — applied
 * to EVERY row on EVERY registry write (saveRegistry in src/index.js), so the
 * stored shape converges without a per-row migration sweep.
 *
 * What it removes is exactly what every reader already treats as absent:
 *   - null/undefined values, and "" (all row readers — backend and both
 *     frontends — test these fields with truthiness, never with `in`).
 *   - `false` for the known boolean flags below. Their absence already means
 *     false to every reader. Keep this an EXPLICIT list: a future boolean
 *     whose false differs from absent must not be added here.
 *   - empty arrays, EXCEPT `functions` next to a codeRef (there, [] is the
 *     offload signal and stays).
 *   - `ruleKind: "ai"` — the default every reader assumes.
 *   - `workflow.siteUrl` — identical on every row of a site; both frontends
 *     already fall back to their own context siteUrl (admin App.js ~6235).
 *
 * And what it rewrites:
 *   - createdAt/updatedAt/claimedAt ISO strings → epoch-ms numbers (half the
 *     bytes at 500 rows). Readers were made tolerant of both forms:
 *     `new Date(x)` (frontends) and rowTimeMs (backend orphan check) accept a
 *     number or a string; rows may hold either form mid-migration.
 *
 * Measured on the wolfaenpak dev registry (498 rows): 219,040 → ~188,500
 * bytes (-14%), which moves the site back below REGISTRY_CREATE_MAX_BYTES.
 */
/**
 * Serialized size of registry content in UTF-8 BYTES — the unit the 240KiB
 * Forge KVS ceiling is measured in. JSON.stringify(...).length counts UTF-16
 * code units, which under-reports any non-ASCII content (a prompt written in
 * Greek or with emoji counts 1 per char but stores 2-4 bytes) — so guards
 * measuring .length can pass a write the platform then refuses. The repo
 * already establishes bytes as the platform truth (memories.js, index.js
 * attachment paths); every registry cap check and the meter go through here.
 * TextEncoder exists in Node ≥11 and every browser, keeping this module
 * dependency-free and isomorphic.
 */
export function registrySerializedBytes(value) {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return 0; // never let size math throw on a read path
  }
}

const SLIM_FALSE_FLAGS = new Set([
  "disabled", "discovered", "crossCheckClaims", "attachComment", "autoSelectResearchDoc",
]);
const SLIM_EPOCH_FIELDS = new Set(["createdAt", "updatedAt", "claimedAt"]);
export function slimRegistryRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return row;
  // Ownership invariant, enforced at EVERY write: a scan-claimed row
  // (discovered:true) never carries authorship — claiming is not authoring.
  // The one-shot getConfigs repair fixed the historical rows, but a one-shot
  // guarded by a flag is only as strong as its worst race: a concurrent writer
  // holding a pre-repair snapshot could save the mis-stamped rows back AFTER
  // the flag was set, permanently. With the invariant here, any later write
  // re-heals — the clobber can survive at most until the next save.
  if (row.discovered === true && row.createdBy) {
    row = { ...row, claimedBy: row.claimedBy || row.createdBy, createdBy: null };
  }
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined || v === "") continue;
    if (v === false && SLIM_FALSE_FLAGS.has(k)) continue;
    if (Array.isArray(v) && v.length === 0 && !(k === "functions" && row.codeRef)) continue;
    if (k === "ruleKind" && v === "ai") continue;
    if (SLIM_EPOCH_FIELDS.has(k) && typeof v === "string") {
      const ms = Date.parse(v);
      out[k] = Number.isFinite(ms) ? ms : v;
      continue;
    }
    if (k === "workflow" && v && typeof v === "object" && !Array.isArray(v)) {
      const wf = {};
      for (const [wk, wv] of Object.entries(v)) {
        if (wk === "siteUrl") continue;
        if (wv === null || wv === undefined || wv === "") continue;
        wf[wk] = wv;
      }
      if (Object.keys(wf).length > 0) out.workflow = wf;
      continue;
    }
    out[k] = v;
  }
  return out;
}

export function registryPressure(input) {
  let count = 0;
  let bytes = 0;
  if (Array.isArray(input)) {
    count = input.length;
    bytes = registrySerializedBytes(input); // UTF-8 bytes — the platform's unit
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

/* ------------------------------------------------------------------------
 * MEMORY-STORE limits (F-175).
 *
 * These live HERE rather than in src/memories.js because that module imports
 * @forge/kvs at load time, so nothing outside the Forge backend can import it:
 * the screenshot-harness bridge mock had to RETYPE the cap sentence and the
 * cap number, which is exactly the N-copies-of-one-rule defect this file was
 * created to end. src/memories.js re-exports every name below, so existing
 * backend/test imports from "./memories.js" keep working unchanged.
 *
 * Same storage reality as the registry: one KVS array value under
 * `pf_memories`, one hard ~240KiB platform ceiling, and no automatic eviction
 * of anything a human wrote: the app evicts only NON-ARCHIVED auto-captured
 * rows (F-176/F-177), so archiving — the non-destructive action — keeps its
 * slot and still counts toward the cap. The cap is therefore a REFUSAL whose
 * one escape valve is DELETING in the Memories tab.
 * ---------------------------------------------------------------------- */

/** Hard row cap for the memory store. */
export const MAX_MEMORIES = 200;

/**
 * Serialized-byte guard for the `pf_memories` value. Measured in real UTF-8
 * BYTES, not UTF-16 chars — the KVS value cap is 240KiB (245760 bytes) and
 * multibyte content (emoji, CJK) runs ~3-4 bytes/char, so a char count would
 * let the value blow past the platform cap and throw. Safety margin included.
 */
export const MEMORY_MAX_SERIALIZED_BYTES = 230000;

/**
 * The PLATFORM ceiling for one KVS value: 240 KiB. This is not our guard — it is the
 * point at which KVS rejects the write outright and the caller gets an exception instead
 * of an answer (F-183). It exists here as a named constant because F-189 showed the two
 * limits are not interchangeable: a store that is already OVER this number (any 1.2.0
 * instance that ran the pre-F-183 merge/reinforce path) cannot be repaired one row at a
 * time — every single-row delete still writes an oversized array and throws. The app
 * therefore measures against THIS number before it writes, refuses with reason
 * "platform-cap" and says how many bytes have to go, and offers a BULK delete so enough
 * can go in one write.
 */
export const MEMORY_PLATFORM_MAX_SERIALIZED_BYTES = 245760;

/**
 * The ONE memory-content clamp (F-168). Every caller that trims memory text —
 * saveMemoryCandidate in src/memories.js, the addMemory/updateMemory resolvers
 * in src/index.js — imports THIS constant; do not retype the number.
 * (async-handler's distill task clamps model-emitted text tighter on purpose,
 * with its own named constant.)
 */
export const MEMORY_CONTENT_MAX = 400;

/**
 * The ONE user-facing refusal sentence for a store that will not take a lesson
 * (F-174). THREE surfaces say it: the addMemory resolver (src/index.js), the
 * Memories tabs which render its `error`, and the screenshot harness's bridge
 * mock — which can import it from here. Every number in it is interpolated
 * from the constants above; a retyped "200" is the defect class F-168/F-172
 * were filed for. Pure: no storage, no I/O.
 */
export const memoryCapRefusalMessage = (reason) => (reason === "bytes"
  ? "Memory store has reached its size limit — delete or shorten some memories in the Memories tab."
  : `Memory store is full (${MAX_MEMORIES} max) — no memory you wrote is ever evicted automatically, and archived memories still count toward the cap — delete some in the Memories tab to make room.`);

/**
 * The refusal for a store that is already OVER the PLATFORM ceiling (F-189) — a different
 * sentence from the two above because the ACTION is different: the store cannot accept any
 * write at all, not even a one-row delete, until enough rows go in a SINGLE delete. It
 * names the deficit because "delete some" is useless advice when the admin cannot tell
 * whether that means one row or forty. Pure: no storage, no I/O.
 */
/**
 * The refusal for a write the PLATFORM threw on after our own measurement said it would
 * fit (F-197). A different sentence again, because the action is different a third time:
 * nothing is too big, nothing needs deleting, the write simply did not land — so the
 * honest advice is to try again. It carries NO byte number on purpose: the old code
 * reported this case as "platform-cap" with a fabricated 1-byte deficit, which sent an
 * admin to bulk-delete memories over a transient KVS fault on a 1.4 KB write. Pure: no
 * storage, no I/O.
 */
export const memoryWriteFaultMessage = () => "Could not save — Jira storage refused the write; try again.";

export const memoryPlatformCapMessage = (bytesOver) => {
  const over = Math.max(1, Math.round(Number(bytesOver) || 0));
  return `Memory store is ${over} bytes over Jira's ${MEMORY_PLATFORM_MAX_SERIALIZED_BYTES}-byte storage limit, so no change to it can be saved — not even deleting one memory. Select enough memories in the Memories tab to free at least ${over} bytes and delete them together.`;
};
