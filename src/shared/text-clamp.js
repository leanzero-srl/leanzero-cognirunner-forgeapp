/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * ONE code-point-safe text clamp (F-381).
 *
 * `"…".slice(0, n)` counts UTF-16 CODE UNITS, so a cut that lands between the two halves
 * of a surrogate pair (every emoji, and most non-BMP script) emits a LONE SURROGATE. That
 * is the one string shape a JSON body can carry that the receiver may reject: the Jira
 * description PUT answers 400 and the caller reports "invalid" without naming the cause.
 * The Coder's whole contract is that the model's text is DATA and the write must not fail
 * on it, so the clamp cannot be the thing that breaks the write.
 *
 * `clampChars` counts CODE POINTS (Array.from splits on them) and therefore never cuts a
 * pair. It does NOT split grapheme clusters "nicely" — a flag or a family emoji may still
 * lose a joiner and render as two glyphs — because that is a rendering nicety, while a
 * lone surrogate is a malformed payload.
 *
 * A BYTE budget is a DIFFERENT rule, so it is a different function in the SAME home
 * (`clampUtf8Bytes`, F-383): `git-providers.js` used to carry its own copy, and it cut with
 * `slice()` too — same defect, different budget. Both live here now.
 *
 * Dependency-free — it bundles into the backend and the frontends like every src/shared/*.
 */

/**
 * Clamp `value` to at most `maxChars` CODE POINTS. Never splits a surrogate pair.
 * A nullish value is "" (never "null"). A non-positive/absent max returns "".
 *
 * @param {*} value
 * @param {number} maxChars
 * @param {string} [suffix]  appended ONLY when something was cut (default: nothing).
 * @returns {string}
 */
export const clampChars = (value, maxChars, suffix = "") => {
  const s = String(value == null ? "" : value);
  const max = Number(maxChars);
  if (!Number.isFinite(max) || max <= 0) return "";
  // Fast path: no surrogate can be split if the string is already inside the budget in
  // code UNITS (code points are never more numerous than units).
  if (s.length <= max) return s;
  const points = Array.from(s);
  if (points.length <= max) return s;
  return points.slice(0, max).join("") + String(suffix || "");
};

/** True when a string carries an unpaired surrogate — the shape this module exists to prevent. */
export const hasLoneSurrogate = (value) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(String(value == null ? "" : value));

/**
 * Clamp `value` to at most `maxBytes` bytes of UTF-8, cutting only on a CODE POINT
 * boundary (F-383). Never splits a surrogate pair and never leaves a truncated multibyte
 * sequence — the encoder is fed whole code points, so what comes out is always valid UTF-8.
 *
 * `marker` is appended ONLY when something was cut, and it COUNTS against the budget, so
 * the returned string is always within `maxBytes`. The git-providers copy this replaces
 * left the marker outside the budget and could therefore answer longer than the caller
 * asked for; a budget that the return value can exceed is not a budget. When the marker
 * alone does not fit, the marker is still returned — the reader must be told the content
 * was dropped, and that is the one case where the budget yields to the truth.
 *
 * Measured with TextEncoder, which exists in the Forge backend runtime AND in the browser,
 * so this module stays dependency-free and keeps bundling into the UI apps.
 *
 * @param {*} value
 * @param {number} maxBytes
 * @param {string} [marker]
 * @returns {{ text: string, truncated: boolean }}
 */
export const clampUtf8Bytes = (value, maxBytes, marker = "") => {
  const s = String(value == null ? "" : value);
  const max = Number(maxBytes);
  const enc = new TextEncoder();
  const mk = String(marker || "");
  if (!Number.isFinite(max) || max <= 0) return { text: mk, truncated: s.length > 0 };
  if (enc.encode(s).length <= max) return { text: s, truncated: false };
  const budget = max - enc.encode(mk).length;
  if (budget <= 0) return { text: mk, truncated: true };
  // Walk CODE POINTS, accumulating their encoded size. A code point is 1–4 bytes, so the
  // only way to stay inside the budget without ever splitting one is to measure each.
  let used = 0;
  let out = "";
  for (const ch of s) {
    const n = enc.encode(ch).length;
    if (used + n > budget) break;
    out += ch;
    used += n;
  }
  return { text: out + mk, truncated: true };
};
