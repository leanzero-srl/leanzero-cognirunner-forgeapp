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
import { replaceCredentialSpans, credentialPrefixRegex, SECRET_FIELD_NAME_HINTS, URL_FIELD_NAME_HINTS } from "../../src/shared/secret-shapes.js";

export const REDACTED = "[REDACTED]";

/* ═══════════════════════════════════════════════════════════════════════════════
 * F-830 — AND THE NAMES HAVE ONE HOME TOO.
 *
 * F-803 unified what a credential LOOKS like and left the other half of the same
 * question — what a credential is CALLED — with two owners that had never been
 * compared. `src/test-hook.js` asks `SECRET_FIELD_NAME_HINTS` (`credential`,
 * `privatekey`, `cookie`, `webtrigger`, `webhookurl`, `cognirunnerkey`,
 * `gitconnection`, …); this file asked `SECRET_KEY`/`SECRET_KEY_PART`, which knew
 * none of those. MEASURED on the pre-fix file:
 * `redactSecrets({privateKey:"-----BEGIN…", cookie:"sessionid=…",
 * credential:"hunter2…", webhookUrl:"https://x/y/zz"})` returned ALL FOUR VERBATIM —
 * masked at the door, printed at the file boundary, which is the exact inversion F-803
 * found in the other direction for values.
 *
 * The hints are now `SECRET_FIELD_NAME_HINTS` in `src/shared/secret-shapes.js` and both
 * files import them; the 4m parity gate refuses either file a private list.
 *
 * TWO TIERS, DERIVED FROM THE ONE LIST, and the tiers are the thing this file keeps:
 *   · TIER A — the flattened name ENDS WITH a hint (`token`, `apiToken`, `api_token`,
 *     `accessToken`, `xAuthorization`, `harnessSecret`, `privateKey`, `webhookUrl`).
 *     The value is masked WHATEVER ITS TYPE, which is the contract the old anchored
 *     `SECRET_KEY` had, now reachable by every hint rather than by thirteen of them.
 *   · TIER B — the flattened name CONTAINS a hint anywhere (`tokens`, `cookieJar`,
 *     `secretsFound`). NON-EMPTY STRINGS ONLY, which is F-650's rule and the reason
 *     `maxTokens: 4000` and `promptTokens: 812` survive into readable evidence.
 * The plural is what separates them: `maxTokens` flattens to `maxtokens`, which ends
 * with `tokens` and not with `token`, so a COUNT is never tier A. That is the same
 * judgement F-825 made at the door by asking the value's TYPE.
 *
 * FLATTENED, not raw: `API_KEY`, `api-key` and `apiKey` are one name, and a rule that
 * only knew one spelling of it is how a list drifts in the first place.
 * ═══════════════════════════════════════════════════════════════════════════════ */
const flattenKey = (k) => String(k).toLowerCase().replace(/[^a-z0-9]/g, "");
/** TIER A — any type. */
const secretKeyExact = (k) => { const f = flattenKey(k); return SECRET_FIELD_NAME_HINTS.some((h) => f.endsWith(h)); };
/** TIER B — non-empty strings only. */
const secretKeyPart = (k) => { const f = flattenKey(k); return SECRET_FIELD_NAME_HINTS.some((h) => f.includes(h)); };

/**
 * Credential shapes that are secrets wherever they appear, key or no key.
 *
 * F-803 — THIS FILE NO LONGER OWNS THE LIST. It used to, and `src/test-hook.js` owned a
 * SECOND one, and the two disagreed about the app's own bearer in BOTH directions: F-650
 * taught this file `cgr_` and `ATATT` after a measured leak and nobody taught the door,
 * while the door knew `gh[ousr]_` and the dev web-trigger host and this file did not. The
 * shapes are now `src/shared/secret-shapes.js`, imported by both, and a parity check in
 * `scripts/evidence-redaction.test.mjs` refuses either file a private copy.
 *
 * The `cgr_` reasoning survives the move and is written down there: `{48,}` not `{16,}`,
 * because a mint answer also carries a `row.prefix` of `cgr_` + 6 hex, the non-secret
 * HANDLE the UI lists tokens by, and masking that would blind the evidence to which token
 * a check was about.
 *
 * F-815 — AND IT IS NO LONGER A REGEX AT ALL HERE. The JWT shape was quadratic on dot-free
 * input (245,760 chars of `"eyAb"` = 15.2 s for one `.test()`), and this file ran it with
 * `g` + `.replace()` on whatever a driver hands `redactSecrets` — where the blow-up hangs
 * the harness rather than a door. `replaceCredentialSpans` is the one home's own scanner:
 * the alternation for the prefix shapes, a linear hand scanner for the JWT, merged into one
 * leftmost-first span list. The replacement is identical; the worst case is not.
 */
const redactCredentialShapes = (s) => replaceCredentialSpans(s, () => REDACTED);

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
 * too, so `key=` is still masked — but by the VALUE's SHAPE, not by its name.
 *
 * F-830 — AND THE PARAMETER NAMES COME FROM THE ONE HOME TOO. This was a FOURTH retyped
 * name list (`token|secret|api[_-]?key|apikey|password|auth|access_token`), so `?cookie=`,
 * `?credential=`, `?privateKey=` and `?bearer=` were readable here while the door masked
 * the same names as fields. The name half is now `secretKeyExact`, the tier-A predicate
 * above, asked about the flattened parameter name — which also folds the F-663 `key=` rule
 * into the SAME pass, so there is one place that decides what a query parameter is.
 *
 * THE ONE NAME THAT IS NOT A HINT: `auth`. As a QUERY parameter it is a credential; as a
 * FIELD name it is a substring of `author`, and `SECRET_FIELD_NAME_HINTS` is asked with
 * `includes` at the door — adding it there would mask every Jira `author` in every
 * evidence file. It is therefore scoped to this rule and written down rather than smuggled
 * into the shared list.
 */
const QUERY_PARAM = /([?&])([A-Za-z0-9_.\-]+)=([^&\s"'<>\\]+)/g;
const queryNameIsSecret = (name) => secretKeyExact(name) || flattenKey(name) === "auth";
const redactQueryParams = (s) => s.replace(QUERY_PARAM, (m, sep, name, val) => {
  if (queryNameIsSecret(name)) return `${sep}${name}=${REDACTED}`;
  // F-663 — `key=` is decided by the VALUE's shape, never by the parameter's NAME.
  if (flattenKey(name) === "key" && looksLikeCredentialValue(val)) return `${sep}${name}=${REDACTED}`;
  return m;
});

/**
 * F-663 — WHAT `looksLikeCredentialValue` IS FOR: `?key=` / `&key=`, masked ONLY when the
 * VALUE looks like a credential. The rule itself now lives in `redactQueryParams` above,
 * one pass with the name rule; this is the discriminator it asks.
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
/* F-803 — the same census as `SECRET_VALUE`, anchored, and from the same one home. It
 * gained `gho_`/`ghu_`/`ghs_`/`ghr_`, `glpat-`, `xoxp-` and `AKIA` by being derived rather
 * than retyped, which is the whole point of deriving it. */
const CREDENTIAL_PREFIX = credentialPrefixRegex();

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

/*
 * F-828 — `DEV_URL` IS GONE, AND THE ONE HOME OWNS THE WHOLE URL.
 *
 * This file used to carry a `DEV_URL` regex — `https?://` then a run of non-space,
 * non-quote, non-angle-bracket characters around `atlassian-dev.net` — matching the
 * dev/staging web-trigger host, a bearer-less URL that is itself a capability. The SAME
 * question was answered one layer down by the `\.atlassian-dev\.net/` literal in
 * `src/shared/secret-shapes.js`, and the two had different WIDTHS: this one swallowed the
 * URL, that one matched only the fixed literal in the middle of it. That did not matter
 * while the shape was only ever asked yes/no — and then F-814 made the read ceiling replace
 * the matched SPAN in place, so the door answered a web-trigger URL with its subdomain and
 * its path token still in plain text around a `<masked:…>` of the literal.
 *
 * `findCapabilityUrlSpans` in the one home is now the URL scanner, and
 * `replaceCredentialSpans` applies it here in exactly the position this regex occupied:
 * same family, matched anywhere in the URL text as before, same `[REDACTED]` replacement,
 * and the span now ends at `)` as well — which can only ever end it sooner.
 *
 * `isDevUrlKey` below is NOT the same rule and stays: it masks a whole VALUE because of its
 * KEY, before the value is ever scanned, and it is the name half of this file's contract.
 */

/**
 * `"token": "…"` inside an ALREADY-STRINGIFIED body — how F-646 actually escaped.
 *
 * F-830 — THE THIRD NAME LIST, also deleted. This regex carried its own retyped
 * alternation of credential field names, so a body stringified before it reached a writer
 * was judged by a list that knew nothing of `privateKey`, `cookie` or `credential` even
 * after the object walk above learned them. It now matches ANY quoted `"name": "value"`
 * pair and asks `secretKeyExact` — the SAME tier-A predicate the object walk uses — about
 * the name, so this file carries no name alternation at all and `api_key`, `API-KEY` and
 * `apiKey` cannot be spelled differently here than they are one function up.
 * It stays a STRING-VALUE rule by construction: `"maxTokens": 4000` has no quoted value
 * and is not touched, which is the same reason tier B is strings-only.
 */
const EMBEDDED_PAIR = /("([A-Za-z0-9_.\-]+)"\s*:\s*)"(?:[^"\\]|\\.)*"/g;
const redactEmbeddedPairs = (s) => s.replace(EMBEDDED_PAIR, (m, pre, name) => (secretKeyExact(name) ? `${pre}"${REDACTED}"` : m));

/**
 * True when this key/value pair is a URL that leaks the dev web-trigger.
 *
 * F-849 — THE URL-KEY NAMES CAME FROM THEIR ONE HOME. This rule used to carry a
 * hand-written alternation (`url|baseurl|base_url|href|endpoint|hookurl|hook_url|
 * webtrigger|webtriggerurl`) sitting one function below a credential-NAME rule that F-830
 * had already moved into `src/shared/secret-shapes.js`. Two lists of field names, one of
 * them shared and one of them private, is the shape F-830 was cut to remove — so the URL
 * names live beside the credential names now and the door and this file cannot disagree
 * about what a URL field is called.
 *
 * Asked the same way the credential hints are: the key is flattened (lowercased,
 * non-alphanumerics dropped) before the lookup, so `base_url`, `baseURL` and `base-url`
 * are one entry rather than three spellings somebody has to remember to add. EXACT match,
 * not substring — a URL key is masked WHOLE, and a substring rule would claim every field
 * whose name merely ends in `url`.
 *
 * The VALUE test is unchanged and is still the other half: a field named `url` is masked
 * only when what it holds is this installation's dev web trigger.
 */
const URL_KEY_NAMES = new Set(URL_FIELD_NAME_HINTS);
const flatKey = (k) => String(k).toLowerCase().replace(/[^a-z0-9]/g, "");
const isDevUrlKey = (key, value) =>
  URL_KEY_NAMES.has(flatKey(key)) &&
  typeof value === "string" && /atlassian-dev\.net/i.test(value);

/**
 * Scrub a bare string: embedded JSON secret pairs, credential shapes, dev web-trigger
 * URLs, and credential query parameters (F-650).
 *
 * Order is load-bearing: EMBEDDED_PAIR first so a `"token":"…"` pair keeps its readable
 * shape instead of being eaten value-first, and the credential-SHAPE pass (which since
 * F-828 carries the dev web-trigger URL scanner that used to be `DEV_URL` here) before
 * the query-parameter pass, so such a URL is swallowed whole rather than surviving with
 * masked parameters. EMAIL runs last, on whatever text is left (F-652).
 */
export function redactString(s) {
  if (typeof s !== "string") return s;
  // F-815 — the credential-SHAPE pass is a SCANNER, not a `.replace(regex)`, and it sits in
  // exactly the position the regex did. Same input, same output, linear worst case.
  // F-828 — that scanner now also spans a whole capability URL, which is why there is no
  // `.replace(DEV_URL, …)` left in this chain.
  return redactQueryParams(redactCredentialShapes(redactEmbeddedPairs(s)))
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
    if (secretKeyExact(k)) { out[k] = v === null || v === undefined ? v : REDACTED; continue; }
    // F-652 — PII, masked domain-first so namesake evidence survives.
    if (PII_KEY.test(k) && typeof v === "string" && v) { out[k] = v.includes("@") ? maskEmail(v) : REDACTED; continue; }
    // F-650 — a key SHAPED like a credential. String values only, so token COUNTS stay.
    if (secretKeyPart(k) && typeof v === "string" && v) { out[k] = REDACTED; continue; }
    if (isDevUrlKey(k, v)) { out[k] = REDACTED; continue; }
    out[k] = redactSecrets(v, _seen, _depth + 1);
  }
  return out;
}

/** Convenience for the console half of an evidence writer. */
export const redactedJson = (d) => JSON.stringify(redactSecrets(d));
