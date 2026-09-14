/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */
/* ═══════════════════════════════════════════════════════════════════════════════
 * F-769 — "DID THIS RUN GO NEAR A CREDENTIAL SLOT?", ASKED THROUGH THE READ CEILING.
 *
 * ONE HOME, because it had two. `key-status-fault-live.mjs` and
 * `key-status-fault-ui-live.mjs` each carried their own `keySlotFingerprint`, and both
 * copies read `r.json.value` — the field the F-769 read ceiling REMOVED from a
 * credential-family answer. After the ceiling both copies would have reduced every
 * answer to `undefined`, therefore to `"EMPTY"`, therefore to `EMPTY === EMPTY`: a
 * before/after assertion that can no longer fail, printed as a PASS. That is worse than
 * no check, because the run reports "the lever never went near a credential" on the
 * strength of a field that is not there any more.
 *
 * So the witness is built from what the ceiling DOES answer:
 *   `present`     → PRESENT / EMPTY, which is what the census of these drivers wanted.
 *   `fingerprint` → a sha256-16 of the stored row, the IDENTITY half. Two reads of the
 *                   same bytes fingerprint the same; one byte's difference does not.
 *
 * ANTI-VACUITY IS THE POINT, so every way of NOT getting an answer is `UNREADABLE`, and
 * `sameKeySlot` refuses an UNREADABLE pair rather than calling it unchanged:
 *   - a non-200, or a body that did not parse;
 *   - `masked !== true` — the ceiling is not in place on the environment under test, so
 *     `present`/`fingerprint` are not being answered and nothing below may be believed;
 *   - a `value` field on a credential answer, which is the F-769 leak itself;
 *   - a PRESENT row with no 16-hex fingerprint, which is an identity we cannot compare.
 *
 * The VALUE is never read, never logged and never returned — a fingerprint is 64 bits,
 * far too little to brute a key out of and far more than enough that two rows in one
 * test run do not collide.
 * ═══════════════════════════════════════════════════════════════════════════════ */

/** A PRESENT slot must answer this shape, or its identity is not comparable. */
const FINGERPRINT_RE = /^[0-9a-f]{16}$/;

/**
 * Read one KVS key through the dev hook's `?what=kvs` and reduce it to a witness.
 *
 * @param {(qs: string) => Promise<{status: number, json: any}>} readKvs
 *        the driver's own GET helper — this module opens no sockets and knows no secret.
 * @param {string} key  the credential slot, e.g. `providerKeySlot("openai")`.
 * @returns {Promise<{key: string, state: "PRESENT"|"EMPTY"|"UNREADABLE",
 *                    fingerprint: string|null, why: string|null}>}
 */
export async function readKeySlotWitness(readKvs, key) {
  const unreadable = (why) => ({ key, state: "UNREADABLE", fingerprint: null, why });
  let r;
  try { r = await readKvs(`?what=kvs&key=${encodeURIComponent(key)}`); }
  catch (e) { return unreadable(`the read threw: ${(e && e.message) || e}`); }
  if (!r || r.status !== 200) return unreadable(`?what=kvs answered ${(r && r.status) || 0}`);
  const j = r.json;
  if (!j || typeof j !== "object") return unreadable("?what=kvs answered a body that is not JSON");
  // THE LEAK ITSELF. A credential answer carrying `value` means the ceiling is gone; say
  // so here rather than quietly reading it, and never put the value in the witness.
  if ("value" in j) return unreadable("the answer carried a `value` field — the F-769 read ceiling is NOT in place on this environment");
  if (j.masked !== true) return unreadable("the answer is not marked masked — this key is not being treated as a credential, so present/fingerprint are not being answered");
  if (j.present !== true) return { key, state: "EMPTY", fingerprint: null, why: null };
  if (typeof j.fingerprint !== "string" || !FINGERPRINT_RE.test(j.fingerprint)) {
    return unreadable(`present:true with no sha256-16 fingerprint (${JSON.stringify(j.fingerprint)}) — the identity is not comparable`);
  }
  return { key, state: "PRESENT", fingerprint: j.fingerprint, why: null };
}

/** What a witness may be PRINTED as. The fingerprint is not the value and is safe to log. */
export const describeKeySlot = (w) =>
  !w ? "UNREADABLE" : w.state === "PRESENT" ? `PRESENT#${w.fingerprint}` : w.state;

/**
 * Are these the same slot, byte for byte? The answer a before/after restore assertion
 * needs, with every non-answer counted as NO.
 *
 * EMPTY→EMPTY is a real yes (the ceiling answered `present:false` twice, on the same
 * key, and that is the state the run found). UNREADABLE on either side is a no, which
 * is what stops the assertion passing vacuously when the ceiling or the hook moves.
 *
 * @returns {{same: boolean, why: string|null}}
 */
export function sameKeySlot(before, after) {
  if (!before || !after) return { same: false, why: "a witness is missing" };
  if (before.state === "UNREADABLE" || after.state === "UNREADABLE") {
    return { same: false, why: `the slot could not be read through the ceiling (before: ${before.why || "ok"}; after: ${after.why || "ok"})` };
  }
  if (before.key !== after.key) return { same: false, why: `two different keys were compared (${before.key} vs ${after.key})` };
  if (before.state !== after.state) return { same: false, why: `the slot went ${before.state} -> ${after.state}` };
  if (before.state === "PRESENT" && before.fingerprint !== after.fingerprint) {
    return { same: false, why: `the slot still holds a key, but NOT the same one (${before.fingerprint} -> ${after.fingerprint})` };
  }
  return { same: true, why: null };
}
