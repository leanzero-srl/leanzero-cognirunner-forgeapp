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
 * lone surrogate is a malformed payload. This module is byte-size-agnostic on purpose: a
 * BYTE budget is a different rule and lives in `clampBytes` (src/git-providers.js), which
 * cuts on a character boundary for its own budget.
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
