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
 * F-662 / F-663 — ONE EMAIL RULE, AND `key=` IS NOT A CREDENTIAL NAME. Two drifts in the
 * same file's contract, landed in the same range that created it. A driver kept a SECOND,
 * NARROWER email regex, so the two disagreed about what a mask IS — and the narrow one ran
 * first and consumed the input, which means the shared rule could only fail to match what
 * the local one had already rewritten. And the query rule masked `key=` on ANY url,
 * including the harness's own `?what=kvs&key=<kvs key>`: the identifier an evidence line
 * exists to record came out as `key=[REDACTED]`. The local mask is deleted; `key=` is now
 * decided by the VALUE's shape, never by the parameter's name.
 * ═══════════════════════════════════════════════════════════════════════════════ */
import { createHash } from "node:crypto";

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
 *
 * F-663 — `key` IS NOT ON THIS LIST ANY MORE. It was, and it clobbered the harness's own
 * KVS door: every driver reads storage through `?what=kvs&key=<kvs key>`, so the
 * IDENTIFIER the evidence exists to record — `app_admins`, `job:<id>`,
 * `COGNIRUNNER_MEMORY_SETTINGS` — came out as `key=[REDACTED]` and a reader could not tell
 * which rule, job or slot a FAIL was about. Generic `?key=<api key>` parameters are real
 * too, so `key=` is still masked — but by the VALUE's SHAPE, below, not by its name.
 */
const SECRET_QUERY = /([?&](?:token|secret|api[_-]?key|apikey|password|auth|access_token)=)[^&\s"'<>\\]+/gi;

/**
 * F-663 — `?key=` / `&key=`, masked ONLY when the VALUE looks like a credential.
 *
 * The discriminator is the value's shape:
 *   - a known credential PREFIX (`sk-`, `ghp_`, `github_pat_`, `ATATT`, `xoxb-`, `cgr_`), or
 *   - >= 20 characters of pure base64/hex alphabet.
 * ANY `_`, `:`, `-`, `.` or `%` in the value makes it a NAME, not a credential: every KVS
 * key this harness reads carries one (`app_admins`, `doc_repo:<id>`, `pf_code:<id>:<hash>`,
 * `COGNIRUNNER_MEMORY_SETTINGS`, and `job:<uuid>` which arrives URL-encoded as `job%3A…`).
 * Credentials on the base64URL alphabet (`-`/`_`) are not lost by that exclusion: they are
 * caught by their prefix here, and by `SECRET_VALUE`, which runs BEFORE this rule.
 */
const KEY_QUERY = /([?&]key=)([^&\s"'<>\\]+)/gi;
const CREDENTIAL_PREFIX = /^(?:sk-|ghp_|github_pat_|ATATT|xoxb-|cgr_)/;

export function looksLikeCredentialValue(v) {
  const s = String(v == null ? "" : v);
  if (CREDENTIAL_PREFIX.test(s)) return true;
  if (s.length < 20) return false;
  if (/[^A-Za-z0-9+/=]/.test(s)) return false;                              // a separator => a NAME
  if (/[+/=]/.test(s)) return true;                                         // real base64 alphabet/padding
  if (/^[0-9a-f]{20,}$/.test(s) || /^[0-9A-F]{20,}$/.test(s)) return true;  // hex
  return /[a-z]/.test(s) && /[A-Z]/.test(s) && /[0-9]/.test(s);             // mixed case + digits
}

/**
 * F-652 — PII. An email ANYWHERE in a string, and the keys that carry one.
 * `+`-tagged locals (`mihai.perdum+contractor2025@…`) are in scope on purpose: that
 * is the exact namesake shape the Permissions tab renders.
 */
/*
 * F-662 — THE LOCAL PART IS RFC-ISH, NOT A GUESS. `perm-discriminator-live.mjs` carried
 * its OWN `EMAIL_RE` whose local-part class had no `'`, so `o'brien@tenant.com` came out
 * of the driver's mask as `o'b***@tenant.com` — a partial address this rule could then no
 * longer match, because `*` is not a legal local-part character. The local mask is gone
 * and the class below is the RFC 5322 `atext` set, so there is ONE answer to "what is an
 * address" and it lives here.
 */
const EMAIL = /[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
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

/*
 * F-775 — A HARNESS FAULT KEY, REDUCED TO ITS FAMILY.
 *
 * `armHarnessFault` answers `{ key, count, until, ttlSeconds }`, and the key is built from
 * the fault's SUBJECT: `harness_fault:hook-promote:<connectionId>:<owner/name>` names the
 * Git connection and the repository path that were faulted. `git-rotation-window-live.mjs`
 * printed the whole arm answer, so those accumulated across runs in terminal scrollback,
 * against the sibling convention that no row KEY is recorded at all (`plant-sweep-live`'s
 * `shape()`, `delete-fault-drain-live`'s `armFacts`, both of which say so in a comment).
 *
 * There is no SECRET here, so deleting the key outright would be the wrong trade: a reader
 * correlating two runs needs to know they faulted the SAME subject. The family stays — it
 * is a constant of the code, not a fact about a tenant — and the subject becomes a
 * sha256-16 of itself. Same subject, same digest, run after run; different subject,
 * different digest; and neither a connection id nor a repo path can be read back out.
 *
 * SIXTEEN hex characters, not the whole digest: this is a correlation handle for a human
 * reading two evidence files side by side, and 64 characters of hex is a line nobody reads.
 * 2^64 of collision space is far past what one driver's keyspace can populate.
 *
 * NOT wired into `redactString`/`redactSecrets`. Those are the SECRET boundary and they
 * apply themselves to every string that passes; a fault key is not a secret, and masking
 * every `harness_fault:` substring that ever appeared in any evidence file would rewrite
 * the assertions of drivers that legitimately print a PREFIX (`harness_fault:plant:` is
 * the whole subject of `armDeleteFault`'s `bad-prefix` refusal). It is a helper a driver
 * calls ON THE KEY, deliberately, which is also what keeps it greppable.
 *
 * THE ONE EDGE, STATED RATHER THAN HIDDEN. The idempotence guard recognises an
 * already-masked subject by its SHAPE — exactly 16 lowercase hex characters — so a real
 * subject of that exact shape would pass through unmasked. No family in
 * `src/harness-fault.js` can produce one: `hook-promote`'s subject is
 * `<connectionId>:<owner/name>` and always carries a colon and a slash, `key-read`'s is a
 * provider name (`openai`, `anthropic`), `jira`'s is a REST path, and `delete`'s is the
 * literal plant prefix. A family whose subject IS a bare hex id would need a different
 * marker, and the test below is where that would be noticed.
 */
export function maskFaultKey(key) {
  const str = String(key == null ? "" : key);
  const m = /^(harness_fault:)([A-Za-z0-9_.-]+):([\s\S]+)$/.exec(str);
  if (!m) return str;
  /* IDEMPOTENT, the property `maskEmail` above documents and for the same reason: a value
     may cross more than one writer, and a subject hashed twice is a THIRD string for one
     subject — which silently breaks the correlation the mask exists to preserve. An
     already-masked subject is exactly 16 lowercase hex characters and is left alone. */
  if (/^[0-9a-f]{16}$/.test(m[3])) return str;
  const digest = createHash("sha256").update(m[3]).digest("hex").slice(0, 16);
  return `${m[1]}${m[2]}:${digest}`;
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
    .replace(KEY_QUERY, (m, pre, val) => (looksLikeCredentialValue(val) ? `${pre}${REDACTED}` : m))
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
