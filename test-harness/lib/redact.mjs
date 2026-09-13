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
 *
 * F-650 — THE REDACTOR DID NOT KNOW THE APP'S OWN TOKEN. This file exists because a
 * `cgr_` credential leaked, and `SECRET_VALUE` listed every provider's prefix except
 * `cgr_` (src/rules-api.js:158 — `cgr_${randomBytes(24).toString("hex")}`, 48 hex).
 * Measured on the pre-fix file: `redactString("Authorization: Bearer cgr_<48hex>")`,
 * `redactSecrets({ url: "https://x.atlassian.net/x1/a?token=cgr_<48hex>" })` and
 * `redactSecrets({ harnessSecret: "s3cr3t" })` all came back VERBATIM — `SECRET_KEY`
 * is ANCHORED (`^secret$`), so `harnessSecret`/`hookSecret` miss, and nothing looked
 * at query parameters at all. Three additions close it: the `cgr_` shape, credential
 * QUERY VALUES, and a case-insensitive SUBSTRING key match.
 *
 * WHY THE SUBSTRING MATCH IS STRING-ONLY. `tokens`-shaped keys are also how the AI
 * budget evidence reports COUNTS (`maxTokens: 4000`, `promptTokens: 812`). Masking
 * those would trade one leak for a pile of unreadable evidence, so the substring rule
 * fires only on a non-empty STRING value; the anchored list keeps its stronger
 * "mask any value, whatever its type" contract.
 *
 * F-652 — PII IS NOT A SECRET, AND IT STILL MUST NOT LAND ON DISK. F-647 put real
 * `emailAddress` values into the `app_admins` roster, and the drivers that snapshot
 * that key wrote the rows out verbatim — a SECRET redactor has no notion of PII, so
 * `emailAddress` was neither a SECRET_KEY nor a SECRET_VALUE and passed straight
 * through to `roster-before.json` and `evidence.json`, the files whose excerpts get
 * pasted into ledger rows.
 *
 * WHY THE DOMAIN IS KEPT. The mask is `<local-initial>***@<domain>`, not [REDACTED].
 * The evidence this protects is the NAMESAKE proof — "two accounts, same display
 * name, told apart by their addresses" — and a flat mask would destroy the very
 * thing being proven while a domain-preserving one keeps it checkable. The mask is
 * idempotent, so a payload that passes a writer AND the file boundary is stable.
 *
 * WHY BOTH LAYERS AGAIN. A roster reaches evidence as an OBJECT in one arm and as
 * `JSON.stringify(roster).slice(0, 300)` in another; a key-walk alone would mask the
 * first and miss the second. Drivers that slice must redact BEFORE slicing, or a
 * truncated address escapes under the cut.
 * ═══════════════════════════════════════════════════════════════════════════════ */

export const REDACTED = "[REDACTED]";

/** Keys whose VALUE is a secret regardless of what it looks like OR what type it is. */
const SECRET_KEY = /^(token|apitoken|api_token|apikey|api_key|secret|accesstoken|access_token|refreshtoken|refresh_token|password|authorization|bearer)$/i;

/**
 * F-650 — a key merely SHAPED like a credential, anywhere in the name, any case:
 * `harnessSecret`, `HARNESS_SECRET`, `hookSecret`, `editorApiKey`, `xAuthorization`.
 * String values only — see the header for why the token COUNTS must survive.
 */
const SECRET_KEY_PART = /(token|secret|apikey|api_key|password|authorization)/i;

/**
 * Credential shapes that are secrets wherever they appear, key or no key.
 * `cgr_` is the app's OWN Rules-API token: `randomBytes(24).toString("hex")` = exactly
 * 48 lowercase hex. `{48,}` (not `{16,}`) is deliberate — a mint answer also carries a
 * `row.prefix` of `cgr_` + 6 hex, which is the non-secret HANDLE the UI lists tokens
 * by, and masking that would blind the evidence to which token a check was about.
 */
const SECRET_VALUE = /(sk-[A-Za-z0-9_\-]{8,}|ghp_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|ATATT[A-Za-z0-9_\-+=/]{8,}|xoxb-[A-Za-z0-9-]{8,}|cgr_[0-9a-f]{48,})/g;

/**
 * F-650 — a credential carried as a QUERY PARAMETER. The obvious next FAIL arm is
 * ``FAIL("rest call refused", { url: `${RULES_URL}?token=${tok("admin")}` })``, and the
 * `url` key is masked only for `atlassian-dev.net` hosts. The `[?&]` anchor keeps this
 * off ordinary prose ("the key=value pair"); the parameter NAME is kept and only the
 * VALUE is masked, so the evidence still says which credential was in play.
 */
const SECRET_QUERY = /([?&](?:token|secret|key|api[_-]?key|apikey|password|auth|access_token)=)[^&\s"'<>\\]+/gi;

/**
 * F-652 — PII. An email ANYWHERE in a string, and the keys that carry one.
 * `+`-tagged locals (`mihai.perdum+contractor2025@…`) are in scope on purpose: that
 * is the exact namesake shape the Permissions tab renders.
 */
const EMAIL = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const PII_KEY = /^(email|emailaddress|email_address|mail|useremail|user_email)$/i;

/**
 * `mihai@wolfaenpak.com` → `m***@wolfaenpak.com`. The domain survives so namesake
 * evidence stays useful. IDEMPOTENT: re-masking `m***@wolfaenpak.com` yields itself,
 * which is what lets a payload pass a writer and the file boundary unchanged.
 */
export function maskEmail(s) {
  const str = String(s);
  const at = str.lastIndexOf("@");
  if (at <= 0 || at === str.length - 1) return REDACTED;
  return `${str[0]}***@${str.slice(at + 1)}`;
}

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

/**
 * Scrub a bare string: embedded JSON secret pairs, credential shapes, dev web-trigger
 * URLs, and credential query parameters (F-650).
 *
 * Order is load-bearing: EMBEDDED_PAIR first so a `"token":"…"` pair keeps its readable
 * shape instead of being eaten value-first, and DEV_URL before SECRET_QUERY so a dev
 * web-trigger URL is swallowed whole rather than surviving with masked parameters.
 * EMAIL runs last, on whatever text is left (F-652).
 */
export function redactString(s) {
  if (typeof s !== "string") return s;
  return s
    .replace(EMBEDDED_PAIR, `$1"${REDACTED}"`)
    .replace(DEV_URL, REDACTED)
    .replace(SECRET_VALUE, REDACTED)
    .replace(SECRET_QUERY, `$1${REDACTED}`)
    .replace(EMAIL, maskEmail);
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
    // F-652 — PII, masked domain-first so namesake evidence survives.
    if (PII_KEY.test(k) && typeof v === "string" && v) { out[k] = v.includes("@") ? maskEmail(v) : REDACTED; continue; }
    // F-650 — a key SHAPED like a credential. String values only, so token COUNTS stay.
    if (SECRET_KEY_PART.test(k) && typeof v === "string" && v) { out[k] = REDACTED; continue; }
    if (isDevUrlKey(k, v)) { out[k] = REDACTED; continue; }
    out[k] = redactSecrets(v, _seen, _depth + 1);
  }
  return out;
}

/** Convenience for the console half of an evidence writer. */
export const redactedJson = (d) => JSON.stringify(redactSecrets(d));
