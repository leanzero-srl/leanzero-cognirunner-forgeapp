/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/* ═══════════════════════════════════════════════════════════════════════════════
 * F-646 — THE LAST LINE BEFORE A SECRET REACHES A TERMINAL OR A FILE.
 *
 * WHY THIS EXISTS. `parity-doors-live.mjs` carried a header promising "No token, URL
 * or secret is ever printed" and then, on ONE failure arm, did
 * `FAIL(..., { body: JSON.stringify(e.json).slice(0, 250) })` on the answer to
 * `createApiToken` — which returns the plaintext `token` at the TOP LEVEL of that
 * body (src/index.js, `{ success:true, ...createApiTokenInternal() }`). That arm
 * fires on a SUCCESSFUL mint whose `role` is not the literal "editor" — precisely
 * the drift the guard exists to catch — so the one and only disclosure of a live
 * Rules-API credential was printed to stdout and written to results/evidence.json.
 *
 * THE RULE THIS ENCODES. A driver may not decide, per call site, whether an answer
 * is safe to show. Evidence writers (PASS/FAIL/NV) run EVERY payload through
 * `redactSecrets` before the console line and before the file write, so a new
 * assertion cannot reintroduce the leak by being written the obvious way.
 *
 * IT MUST SCRUB STRINGS, NOT JUST KEYS. The leak was a STRING — the driver had
 * already stringified the object, so a key-walk alone would have seen only
 * `{ body: "<json text>" }` and passed it through. Hence both layers: key-based
 * redaction for structured values, and pattern-based redaction inside any string
 * (embedded `"token":"…"` pairs, known credential prefixes, dev web-trigger URLs).
 * ═══════════════════════════════════════════════════════════════════════════════ */

export const REDACTED = "[REDACTED]";

/** Keys whose VALUE is a secret regardless of what it looks like. */
const SECRET_KEY = /^(token|apitoken|api_token|apikey|api_key|secret|accesstoken|access_token|refreshtoken|refresh_token|password|authorization|bearer)$/i;

/** Credential shapes that are secrets wherever they appear, key or no key. */
const SECRET_VALUE = /(sk-[A-Za-z0-9_\-]{8,}|ghp_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|ATATT[A-Za-z0-9_\-+=/]{8,}|xoxb-[A-Za-z0-9-]{8,})/g;

/** The dev/staging web-trigger host: a bearer-less URL that is itself a capability. */
const DEV_URL = /https?:\/\/[^\s"'<>]*atlassian-dev\.net[^\s"'<>]*/gi;

/** `"token": "…"` inside an ALREADY-STRINGIFIED body — how F-646 actually escaped. */
const EMBEDDED_PAIR = new RegExp(
  '("(?:token|apiToken|api_token|apiKey|api_key|secret|accessToken|access_token|refreshToken|refresh_token|password|authorization)"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"',
  "gi",
);

/** True when this key/value pair is a URL that leaks the dev web-trigger. */
const isDevUrlKey = (key, value) =>
  /^(url|baseurl|base_url|href|endpoint|hookurl|hook_url|webtrigger|webtriggerurl)$/i.test(String(key)) &&
  typeof value === "string" && /atlassian-dev\.net/i.test(value);

/** Scrub a bare string: embedded JSON secret pairs, credential shapes, dev URLs. */
export function redactString(s) {
  if (typeof s !== "string") return s;
  return s
    .replace(EMBEDDED_PAIR, `$1"${REDACTED}"`)
    .replace(DEV_URL, REDACTED)
    .replace(SECRET_VALUE, REDACTED);
}

/**
 * Deep-redact any evidence payload. Returns a NEW value; never mutates the input,
 * because drivers keep the original answer around for their own assertions.
 * Cycle-safe and depth-bounded so a driver can hand it a whole response object.
 */
export function redactSecrets(value, _seen = new WeakSet(), _depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value !== "object") return value;
  if (_depth > 12) return "[TRUNCATED]";
  if (_seen.has(value)) return "[CIRCULAR]";
  _seen.add(value);
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, _seen, _depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_KEY.test(k)) { out[k] = v === null || v === undefined ? v : REDACTED; continue; }
    if (isDevUrlKey(k, v)) { out[k] = REDACTED; continue; }
    out[k] = redactSecrets(v, _seen, _depth + 1);
  }
  return out;
}

/** Convenience for the console half of an evidence writer. */
export const redactedJson = (d) => JSON.stringify(redactSecrets(d));
