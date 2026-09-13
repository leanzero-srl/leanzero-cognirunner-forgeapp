/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * ONE home for reading an inbound webtrigger header.
 *
 * HTTP header names are case-insensitive and senders use whatever casing they
 * like (`X-Hub-Signature-256`, `X-GitHub-Event`, `Authorization`). Guessing a
 * fixed set of spellings — exact/lower/UPPER (F-338) or `authorization ||
 * Authorization` (F-341) — makes the whole surface rest on the runtime
 * happening to normalise case, with nothing asserting it. This folds case over
 * the ACTUAL keys of the header object instead.
 *
 * Forge also gives header values as ARRAYS; the first element is the value.
 */

/**
 * Read one header from a Forge webtrigger request, case-insensitively.
 * @param {{headers?: Object}} req inbound request
 * @param {string} name header name in any casing
 * @returns {string|null} the (first) value, or null when absent/non-string
 */
export const readHeader = (req, name) => {
  const h = (req && req.headers) || {};
  // Exact hit first: it is the common case and skips the scan.
  let v = h[name];
  if (v === undefined || v === null) {
    const want = String(name).toLowerCase();
    const key = Object.keys(h).find((k) => String(k).toLowerCase() === want);
    v = key === undefined ? undefined : h[key];
  }
  const out = Array.isArray(v) ? v[0] : v;
  return typeof out === "string" ? out : null;
};

/**
 * Read an `Authorization: Bearer <token>` header and return the bare token.
 * @param {{headers?: Object}} req inbound request
 * @returns {string} the token, or "" when there is no usable one
 */
export const readBearerToken = (req) => {
  const auth = readHeader(req, "authorization");
  return typeof auth === "string" ? auth.replace(/^Bearer\s+/i, "").trim() : "";
};
