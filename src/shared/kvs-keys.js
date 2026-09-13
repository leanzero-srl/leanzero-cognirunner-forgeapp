/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// ONE HOME for the two things every KVS claim site needs: how a key part is made
// safe, and how a FAIL_IF_EXISTS conflict is told apart from an infrastructure
// fault. Both rules existed as copy-pasted literals at several call sites; the
// difference between them decides whether a caller dedups or fails closed, so a
// site that gets the predicate wrong reports a throttle as a duplicate.
// Dependency-free — this module bundles into the backend and the frontends.

/** Make an arbitrary id safe to embed in a KVS key (same shape as listeners.js). */
export const safeKeyPart = (s) => String(s).replace(/[^a-zA-Z0-9:._#-]/g, "-").slice(0, 120);

/**
 * TRUE only for "this key already exists" — the intended FAIL_IF_EXISTS outcome.
 * Everything else (429 throttle, 5xx, rejected key/TTL option) is an infrastructure
 * fault and MUST NOT be reported as a duplicate.
 */
export const isKeyConflict = (e) =>
  e?.code === "KEY_ALREADY_EXISTS"
  || e?.responseDetails?.status === 409
  || /already\s*exist/i.test(String(e?.message));

/* ===== F-349 — KEY LEGALITY, asserted where keys are BUILT ===== */

/**
 * The platform's own key grammar, copied from the message Forge KVS returns when it
 * refuses a write:
 *   Field 'key' must match pattern "^(?!\s+$)[a-zA-Z0-9:._\s-#]+$"   code INVALID_KEY
 * (observed LIVE on wolfaenpak development 2026-09-13, F-346). The legal set is
 * alphanumerics, ":", ".", "_", whitespace, "-" and "#" — note "/" is NOT in it, which
 * is what made every `owner/name`-keyed row unwritable. `-` sits last in the class here
 * so it stays a literal; the platform's own spelling `\s-#` means the same thing.
 */
export const KVS_KEY_PATTERN = /^(?!\s+$)[a-zA-Z0-9:._\s#-]+$/;

/**
 * Forge documents 500 characters as the key ceiling; @forge/kvs itself ships no
 * constant for it (grepped node_modules/@forge/kvs — README and types carry neither the
 * pattern nor a length), so this number is from the docs, NOT measured on the platform.
 * `safeKeyPart` already clamps each part to 120, so a builder would need five parts to
 * approach it — the cap is a backstop, not the working limit.
 */
export const KVS_KEY_MAX_CHARS = 500;

/** Would the platform accept this key? Pure predicate — no throw, no I/O. */
export const isKvsKey = (key) =>
  typeof key === "string" && key.length > 0 && key.length <= KVS_KEY_MAX_CHARS && KVS_KEY_PATTERN.test(key);

/**
 * Throw LOUDLY, at build time, for a key the platform would refuse.
 *
 * WHY AT THE BUILDER AND NOT AT A STORAGE WRAPPER: there is no central `storage.set`
 * wrapper in this app (grepped) — every module imports @forge/kvs directly, so the only
 * place a rule can have ONE home is the key builder itself. F-346 shipped because the
 * legality of a built key was asserted nowhere: `gitHookSecretKey` embedded `owner/name`
 * and nothing, offline or in review, could tell. This is that missing assertion.
 *
 * It is deliberately a THROW, not a sanitise: a builder that produces an illegal key is a
 * defect in the builder, and silently repairing it here would let two ids collide.
 */
export const assertKvsKey = (key) => {
  if (!isKvsKey(key)) {
    const shown = typeof key === "string" ? key.slice(0, 80) : String(key);
    throw new Error(`Illegal KVS key built: "${shown}" — must match ${KVS_KEY_PATTERN} and be 1..${KVS_KEY_MAX_CHARS} chars`);
  }
  return key;
};
