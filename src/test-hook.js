/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * DEV-ONLY test-state web trigger for the forge-live-harness E2E suite.
 * Gated by HARNESS_SECRET (set ONLY in the development environment). Returns 404
 * unless the secret is configured (absent in prod) AND matches the Bearer header.
 * Reads and explicitly allowlisted test actions only.
 */
import { kvs as storage } from "@forge/kvs";
import { PROVIDER_IDS, providerSlotsFor } from "./shared/provider-slots.js";
import { readBearerToken } from "./shared/http-headers.js";
// F-803: "what does a credential VALUE look like" has ONE home, shared with the harness
// evidence redactor — the two used to disagree about this app's own Rules-API bearer.
import { SECRET_FIELD_NAME_HINTS, findCredentialSpans } from "./shared/secret-shapes.js";
// F-770: "is this a legal KVS key" has ONE home, and it is not this file. Same module the
// key BUILDERS assert against, so this door and the builders cannot drift apart again.
import { isKvsKey, safeKeyPart, KVS_KEY_PATTERN, KVS_KEY_MAX_CHARS } from "./shared/kvs-keys.js";
// F-163: the memory-store key NAMES come from the module that owns them — never retyped here.
import { MEMORIES_KEY, MEMORY_SETTINGS_KEY, MEMORY_STORE_FULL_KEY } from "./memories.js";
// F-566: same discipline for the knowledge-pack settings slot — the module that owns it.
import { KNOWLEDGE_SETTINGS_KEY } from "./knowledge-packs.js";

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": ["application/json"] },
  body: JSON.stringify(body),
});
const notFound = () => ({ statusCode: 404, headers: { "Content-Type": ["text/plain"] }, body: "not found" });
const q = (req, n) => {
  const v = req && req.queryParameters && req.queryParameters[n];
  return Array.isArray(v) ? v[0] : v;
};

/* ───────────────── 1.5 probe P1 — the JSM audience question (FRAME §5) ─────────────────
 *
 * FRAME-1.5 §5 P1 is a CONTRADICTION, not a curiosity: this app's own sandbox spec says
 * a JSM internal note is the comment property `sd.public.comment = { internal: true }`
 * (src/shared/sandbox-api-spec.js:279), the 1.5 plan text says `sd.public.comment = false`.
 * The code is the authority, and the VA's audience gate is built on whichever is true.
 * So the probe POSTS one short fixed comment both ways and READS IT BACK through the
 * JSM request-comment API, where `public` is the portal's own answer.
 *
 * WHAT IT REPORTS: status codes, response KEYS, the boolean `public`, and whether the
 * property echo carries `internal: true`. NEVER a body, never a comment id, never a
 * display name — a probe result is evidence, not a data export.
 *
 * THE COMMENT IS ALWAYS DELETED. The delete lives in `finally` and runs on the throw
 * path, the non-2xx read path and the happy path alike: a probe that leaves a comment on
 * a customer-visible request has become the leak it was measuring.
 */
export const JSM_PROBE_COMMENT_TEXT = "CogniRunner harness audience probe — safe to ignore, deleted automatically.";
export const JSM_INTERNAL_PROPERTY_KEY = "sd.public.comment";

/** The error CLASS only — a message can carry a URL, an issue key or a token. */
const errorClassOf = (e) => (e && (e.code || e.name) ? String(e.code || e.name) : "Error").slice(0, 60);
/* F-789 — WHICH error classes mean "this installation would not give the row a TTL", used
 * by the stash refusal to name its cause. TTL must be a DELIMITED token: the platform's
 * codes are SCREAMING_SNAKE (`INVALID_TTL`, `TTL_NOT_SUPPORTED`), and a bare substring test
 * answers true for `THROTTLED` — which is the exact mis-attribution F-789 is about, arriving
 * through the fix for it. Anything this does not match is a write failure, and the raw class
 * rides along in `reason` either way, so nothing depends on this being exhaustive. */
const STASH_TTL_ERROR_CLASS_RE = /(?:^|[^A-Za-z])TTL(?:[^A-Za-z]|$)/i;
const keysOf = (data) => (data && typeof data === "object" && !Array.isArray(data) ? Object.keys(data).slice(0, 30) : []);
const jsonOf = async (res) => { try { return JSON.parse(String(await res.text()).slice(0, 200000)); } catch { return null; } };

/* ═══════════════════════════════════════════════════════════════════════════════════
 * F-627/F-628 — "A SECRET IS NEVER PLANTABLE", IN ONE HOME.
 *
 * Two doors in this file now PLANT A ROW from a caller-supplied object: `pipelineRow`
 * (a `git_pipeline:*` record) and `vaTombstone`'s `turns`. Both build their row field by
 * field from an allow-list, so a stray key cannot reach storage by construction — but
 * "by construction" is a property a future edit can lose quietly, and the promise the
 * whole file rests on ("the write resolvers are off the allow-list because a planted
 * token would then exist on a real tenant") deserves a check that FAILS LOUDLY rather
 * than an argument that has to be re-derived by every reader.
 *
 * So a plant body is REFUSED OUTRIGHT when it so much as mentions a credential: any key
 * whose name reads like one, at any depth, and any string value that looks like a stored
 * key slot, a provider token or a web-trigger URL. It is deliberately coarse — a harness
 * body has no legitimate reason to carry any of these, and a false refusal costs a
 * driver one rename while a false accept costs a tenant a live credential.
 *
 * Returns `null` when the body is clean, or `{ error, harnessRefusal, field }`.
 * ═══════════════════════════════════════════════════════════════════════════════════ */
/* F-803 — the hints are NOT this file's list. They are one half of the one answer to
 * "what does a credential look like" (src/shared/secret-shapes.js); the other half is the
 * VALUE shapes spliced into the family regex below. `test-harness/lib/redact.mjs` reads
 * the same module, because the two used to disagree about this app's own bearer. */
const SECRET_KEY_HINTS = SECRET_FIELD_NAME_HINTS;

/* ═══════════════════════════════════════════════════════════════════════════════════
 * F-769 — THE CREDENTIAL KEY FAMILIES, AND THE READ CEILING THEY CARRY. ONE HOME.
 *
 * This list is the answer to one question — "is the VALUE behind this KVS key a
 * credential?" — and it is asked in exactly two places, which is why it is a list and
 * not two regexes:
 *
 *   1. `isCredentialKey`, the READ CEILING on the GET `?what=kvs` (see its call site).
 *   2. `secretSpansInText` below, the WRITE refusal (`findPlantedSecret`), which used to
 *      keep its own retyped copy of `COGNIRUNNER_KEY_` and `git_conn_secret:` — two
 *      homes for one census, so a family added to one was missing from the other.
 *
 * THE CENSUS, and where each family's value comes from (read, not guessed):
 *   COGNIRUNNER_KEY_*                   — the BYOK provider keys (src/shared/provider-slots.js)
 *   COGNIRUNNER_OPENAI_API_KEY          — the legacy single-provider slot index.js still reads
 *   COGNIRUNNER_FORGE_IDENTITY          — carries the identity's token (src/git-connections.js)
 *   COGNIRUNNER_DOC_PROCESSOR_REMOTE    — `{url, bearer}` (index.js)
 *   COGNIRUNNER_WEB_SEARCH_REMOTE       — `{url, bearer, serperKey?, githubToken?}` (index.js)
 *   COGNIRUNNER_CONTEXT7_REMOTE         — `{url, apiKey?}` (index.js) — F-778
 *   git_conn_secret:*                   — the connection token (git-connections.js)
 *   git_hook_secret:*                   — the webhook SIGNING secret (shared/git-ids.js)
 *   webtrigger_url:*                    — a CAPABILITY URL with an unguessable path token
 *                                         (attachment-bridge, attachment-upload, rules-api)
 *   att_token:* / upload_token:*        — minted capability tokens (index.js)
 *   probe:webhook:secret                — the Part 0 probe's HMAC secret (this file)
 *   harness_stash:*                     — the F-769 stash itself; see `kvStash` below
 *
 * …plus a NAME catch-all, so a family invented next quarter is covered on the day it is
 * invented rather than on the day it leaks. It reuses `SECRET_KEY_HINTS` — the same
 * words the write door already refuses a FIELD for. Deliberately coarse in the SAFE
 * direction: a false positive costs a driver a fingerprint instead of a value (and every
 * driver found in the F-769 census only ever wanted PRESENT/ABSENT), while a false
 * negative costs a tenant a live credential in a committed evidence file.
 *
 * F-778 — WHY BOTH HALVES ARE NOT ENOUGH, AND WHAT NOW POLICES THE CENSUS. The MCP-remote
 * triple is three sibling rows written by three sibling resolvers, and only two of them
 * were ever declared: `saveContext7Remote` stores the admin's context7 API key as
 * `apiKey` in `COGNIRUNNER_CONTEXT7_REMOTE` (index.js), whose flattened name
 * (`cognirunnercontext7remote`) contains none of `SECRET_KEY_HINTS` — so the catch-all
 * that exists for exactly this case could not save it either. The catch-all reads the KEY
 * NAME; a row is a credential because of what is INSIDE it, and those two only coincide
 * when whoever named the key happened to say so.
 *
 * So adding one name here would have been the fix that schedules its own return. The
 * MECHANISM is a test that reads `src/` the way the leak does: every KVS write site whose
 * stored object carries a field named like a secret must land on a key this predicate
 * already covers, or be named in a reviewed exception with its reason. It lives beside
 * the other F-769 checks in `test-harness/scripts/rules-runtime-regression.test.mjs`
 * ("every src write site that stores a secret is covered by the census"), and it carries
 * a positive control — a synthetic write site with an undeclared key — so a green run
 * means the scanner still SEES a leak rather than that it stopped looking.
 * ═══════════════════════════════════════════════════════════════════════════════════ */
export const CREDENTIAL_KEY_FAMILIES = [
  "COGNIRUNNER_KEY_",
  "COGNIRUNNER_OPENAI_API_KEY",
  "COGNIRUNNER_FORGE_IDENTITY",
  "COGNIRUNNER_DOC_PROCESSOR_REMOTE",
  "COGNIRUNNER_WEB_SEARCH_REMOTE",
  "COGNIRUNNER_CONTEXT7_REMOTE",
  "git_conn_secret:",
  "git_hook_secret:",
  "webtrigger_url:",
  "att_token:",
  "upload_token:",
  "probe:webhook:secret",
  "harness_stash:",
];

/* ═══════════════════════════════════════════════════════════════════════════════════
 * F-794 — THE NAME CATCH-ALL'S OWN FALSE POSITIVES, REVIEWED ONE BY ONE.
 *
 * The catch-all is coarse in the SAFE direction on purpose, and the F-769 reasoning for
 * that stands. But coarse in the safe direction is only free while the alternative is
 * "answer the whole row plain" — once the FIELD ceiling exists (`maskSecretFields`), a row
 * the catch-all claims for its NAME alone is now over-masked when what it actually holds
 * is a HASH and a PREFIX. `api_tokens` is exactly that: `createApiTokenInternal`
 * (src/rules-api.js) stores `{id, name, hash: sha256(token), prefix: token.slice(0,10),
 * createdAt, createdBy, role, lastUsedAt, revokedAt}` — the plaintext is shown once and
 * never stored — and `api_token_revoked:{id}` is a tombstone, `{id, revokedAt}`. Neither
 * row can hand anyone a bearer, and masking them whole costs a driver the ability to see
 * that a mint landed, what its role is, or that a revoke wrote its tombstone.
 *
 * A key listed here is NOT a credential family, so it drops through to the FIELD ceiling.
 * `fields` names the field NAMES within it that are still masked wherever they appear —
 * `hash` is not a `SECRET_KEY_HINTS` word and never should be (a hash is not a secret in
 * general), but THIS hash is a verification oracle for a live bearer and a fingerprint
 * answers every question a driver had about it.
 *
 * PER KEY, WITH THE REASON, LIKE `NOT_A_CREDENTIAL` IN THE CENSUS TEST: the judgement
 * being recorded is "this ROW is safe to read field-by-field", never "this WORD is safe".
 * A new key containing `token` is still claimed by the catch-all until someone reads it.
 * ═══════════════════════════════════════════════════════════════════════════════════ */
export const NAME_CATCHALL_EXEMPT = new Map([
  ["api_tokens", { fields: ["hash"], why: "the mint row stores sha256(token)+prefix, never the bearer (src/rules-api.js createApiTokenInternal); `hash` is fingerprinted because it verifies a live token" }],
  ["api_token_revoked:", { fields: [], why: "a revoke tombstone, `{id, revokedAt}` (src/rules-api.js revokeApiTokenInternal) — it carries no secret at all" }],
]);

/** The reviewed exemption for a key, or null. A trailing `:` entry matches as a prefix. */
const catchAllExemption = (key) => {
  for (const [k, entry] of NAME_CATCHALL_EXEMPT) {
    if (key === k || (k.endsWith(":") && key.startsWith(k))) return entry;
  }
  return null;
};

/** The extra field NAMES the field ceiling masks in this row (empty for almost every key). */
export const extraMaskedFieldsFor = (key) => (typeof key === "string" ? (catchAllExemption(key)?.fields || []) : []);

/**
 * TRUE when the VALUE behind this key is a credential and must never be returned.
 * Prefix match on the declared families, then the reviewed exemptions, then the name
 * catch-all. A DECLARED family always wins — an exemption can only ever excuse the
 * catch-all, never a family someone deliberately added.
 */
export const isCredentialKey = (key) => {
  if (typeof key !== "string" || key.length === 0) return false;
  if (CREDENTIAL_KEY_FAMILIES.some((p) => key.startsWith(p))) return true;
  if (catchAllExemption(key)) return false;
  const flat = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return SECRET_KEY_HINTS.some((h) => flat.includes(h));
};

/**
 * THE SERIALISATION A FINGERPRINT IS TAKEN OF. ONE RULE, WRITTEN DOWN, BECAUSE TWO DOORS
 * ANSWER "THE sha256-16 OF THIS SECRET" AND THEY DISAGREED (F-780).
 *
 *   · A STRING fingerprints as ITSELF. `JSON.stringify("x")` is `"x"` WITH the quotes, so
 *     hashing the serialisation of a string hashes two bytes that are not in it. The
 *     githooks door hashed the raw URL and the `?what=kvs` door hashed its JSON, so a
 *     driver comparing `urlMasked.fingerprint` against `webtrigger_url:git-webhook`'s
 *     fingerprint — both documented as "the sha256-16 of this URL", both masked under the
 *     same doctrine — got a guaranteed mismatch for a byte-identical URL. An equality
 *     check that always answers "it changed" is worse than none.
 *   · ANYTHING ELSE fingerprints as CANONICAL JSON: object keys sorted, recursively. A row
 *     that survives a KVS round trip is the same row whatever order the platform hands its
 *     keys back in, and the whole use-case is "prove the snapshot came back identical".
 *
 * Numbers, booleans and arrays go through the same canonical form, so `"1"` and `1` are
 * different fingerprints — which is right: they are different values in a KVS row.
 */
const canonicalJson = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(value[k])).join(",") + "}";
};
export const fingerprintInput = (value) => (typeof value === "string" ? value : canonicalJson(value));

/**
 * What a masked read answers INSTEAD of the value: an HMAC-SHA256 of the row under
 * `fingerprintInput` above, keyed per installation, truncated to 16 hex characters.
 *
 * WHY A FINGERPRINT AND NOT JUST `present`. The two things drivers actually do with a
 * credential row are "prove the F-126 planted fault landed" (present/absent) and "prove
 * a snapshot came back byte-identical" (equality). A fingerprint serves the second
 * without serving the value. `null` and a missing row both fingerprint as `null`, never
 * as a hash of the string "null", so "absent" is one answer and not two.
 *
 * F-781 — WHY IT IS KEYED, AND NOT A BARE sha256. The docblock before F-781 argued that 64
 * bits is "far too little to brute a key back out of". That is true of a PREIMAGE SEARCH and
 * false of the attack that matters: a GUESS CHECK. An unsalted hash is a verification
 * oracle — hash your candidate, compare, done — and the values behind these rows are not
 * all high-entropy. `probe:webhook:secret` is an HMAC secret a TESTER types (`s3cr3t`, the
 * repo name, today's date); a credential slot a tenant filled with a placeholder is the same
 * shape. Recovering one turns "masked" back into "recoverable" for exactly the values a
 * human chose, and `probe:webhook:secret` in particular signs requests at the
 * UNAUTHENTICATED `gitWebhookProbe` door. So the fingerprint is an HMAC under a key DERIVED
 * FROM `HARNESS_SECRET`, the env var this whole file is already gated on: no new secret to
 * manage and no new storage row.
 *
 * F-791 — AND HERE IS WHO THAT ACTUALLY STOPS, because the F-781 text named the wrong
 * attacker and then claimed him as beaten. It said "a reader who holds the harness secret
 * could run a wordlist… an offline wordlist is useless without it" — but the key IS derived
 * from that same secret, so a holder of it can compute `HMAC(sha256(domain || HARNESS_SECRET),
 * candidate)` and check guesses exactly as before. The keying does not touch that actor at
 * all. THE CEILING, stated so nobody has to re-derive it:
 *
 *   · STOPPED: a holder of a LEAKED FINGERPRINT WITHOUT THE SECRET — a committed evidence
 *     file, a pasted log, a run artefact in CI. For them the digest is now unlinkable to any
 *     candidate, and that is the real and worthwhile gain F-781 bought. It is also the
 *     likeliest exposure: fingerprints are written into evidence files by design, while
 *     `HARNESS_SECRET` is not.
 *   · NOT STOPPED: a holder of `HARNESS_SECRET` — which is every tester and every driver
 *     env. Against that actor the mask is a speed bump, not a boundary: they cannot read the
 *     value back through this door, but they CAN confirm a guess, so a low-entropy value is
 *     recoverable by anyone already trusted with the bearer. The mitigation for that is not
 *     cryptographic — it is "do not type a guessable secret into a slot whose fingerprint
 *     this door will answer", and `HARNESS_SECRET` is a credential in its own right, not a
 *     test fixture to be shared with anyone who wants to run a driver.
 *   · COMPARABILITY, which is the same ceiling wearing its other face: a fingerprint is
 *     comparable ONLY within one installation and ONLY while `HARNESS_SECRET` is unchanged.
 *     Rotate the secret and every previously recorded fingerprint becomes incomparable —
 *     correct, because it is no longer the same oracle, but it means a comparison across a
 *     rotation answers "this changed" about a row nothing touched. Every use this exists for
 *     compares fingerprints FROM THE SAME RUN (`lib/key-slot-witness.mjs`, the stash/restore
 *     round trip, before-vs-after on one slot), so equality semantics are untouched; what is
 *     lost is comparing a fingerprint in an old evidence file against a fresh read.
 *
 * The derivation is one HKDF-ish step rather than the raw secret as the key, so a
 * fingerprint can never be a distinguisher on `HARNESS_SECRET` itself.
 *
 * THIS IS THE ONLY TRUNCATED DIGEST IN THIS FILE. It was not: the githooks URL mask
 * carried a second one, inline, on a different serialisation (F-780). A rule about what a
 * masked answer may say is exactly the rule that must not have two homes.
 */
const fingerprintKey = async () => {
  const { createHash } = await import("node:crypto");
  // Domain-separated from any other use of the secret, and a HASH of it rather than the
  // secret itself, so no answer this file gives is computed directly under the bearer token.
  return createHash("sha256").update("cognirunner:test-hook:fingerprint:v1\n" + String(process.env.HARNESS_SECRET || "")).digest();
};
export const credentialFingerprint = async (value) => {
  if (value === null || value === undefined) return null;
  const { createHmac } = await import("node:crypto");
  return createHmac("sha256", await fingerprintKey()).update(fingerprintInput(value)).digest("hex").slice(0, 16);
};

/** Regex-escape a literal so a family prefix can be spliced into `familyRe`. */
const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A plant body that MENTIONS a credential key family, plus the token/URL SHAPES that no
 * key family can describe (GitHub/GitLab/OpenAI/Atlassian/Slack/AWS tokens, JWTs, Forge
 * web-trigger URLs).
 *
 * BOTH halves are DERIVED — neither is retyped here — and they are now two functions
 * rather than one spliced alternation, because the shape half grew a hand scanner (F-815)
 * a regex alternation cannot hold. `secretSpansInText` below is where they meet:
 *   · the FAMILY half is `familyRe`, from `CREDENTIAL_KEY_FAMILIES` above, since F-769;
 *   · the SHAPE half is `findCredentialSpans` from `src/shared/secret-shapes.js`, since
 *     F-803 (and anchored since F-814). It used to be an
 *     inline alternation that knew `gh[pousr]_`, `github_pat_`, `sk-`, `xoxb-` and the dev
 *     web-trigger host — and NOT `cgr_`, this app's own Rules-API bearer, nor `ATATT`,
 *     `glpat-`, `AKIA`, `xoxp-` or a JWT, all of which the evidence redactor at the file
 *     boundary already knew. Two lists, one question, and the door was the weaker of them.
 */
const familyRe = (flags = "") => new RegExp("(" + CREDENTIAL_KEY_FAMILIES.map(reEscape).join("|") + ")", flags);

/**
 * EVERY credential SPAN in a string — the SHAPES from their one home merged with this
 * door's own key FAMILIES, leftmost-first and non-overlapping.
 *
 * F-814 — spans, not a yes/no, because the read ceiling needs to know WHERE the credential
 * is: a token inside prose is rewritten in place and the sentence survives. The shapes
 * carry the left anchor the bare `SECRET_VALUE_SHAPES` census does not, which is why
 * `risk-assessment` no longer answers true here.
 * F-815 — the shape half is `findCredentialSpans`, which carries the JWT as a LINEAR hand
 * scanner rather than a quadratic regex, because this door reads tenant-authored rows up to
 * the 240 KiB KVS cap. The families are literals and cannot blow up; their regex is built
 * per call because a `g` regex kept across calls carries `lastIndex`.
 */
const secretSpansInText = (text) => {
  if (typeof text !== "string" || text === "") return [];
  const spans = findCredentialSpans(text);
  const re = familyRe("g");
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[0] === "") { re.lastIndex++; continue; }
    spans.push({ start: m.index, end: m.index + m[0].length });
  }
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  for (const sp of spans) {
    const last = out[out.length - 1];
    if (last && sp.start < last.end) { if (sp.end > last.end) last.end = sp.end; continue; }
    out.push({ ...sp });
  }
  return out;
};

/**
 * Is the WHOLE trimmed string a credential and nothing else? This is the discriminator
 * between the two projections F-814 introduced: a value that IS a bare credential is
 * replaced WHOLE — there is nothing else in it to read — and a credential inside a
 * sentence is replaced IN PLACE, because the sentence is what the door is read for.
 */
const isBareCredential = (text) => {
  const t = String(text).trim();
  if (t === "") return false;
  const spans = secretSpansInText(t);
  return spans.length === 1 && spans[0].start === 0 && spans[0].end === t.length;
};

export const SECRET_PLANT_REFUSAL = "harnessRefusal: a plant body may never carry a credential — this door plants state, never secrets";

/**
 * THE WRITE ALLOW-LIST, in one place because TWO doors are bounded by it: `kvSet` and
 * the F-769 `kvStash`/`kvRestore` pair. The reasoning for each entry lives at the `kvSet`
 * call site, which is still the only place that grows it. Built per call — a Set that
 * outlives a request is a Set a future edit can mutate.
 */
const kvWriteAllowList = () => {
  const keys = new Set([
    "COGNIRUNNER_USAGE", "COGNIRUNNER_SEAT_SNAPSHOT", "COGNIRUNNER_EDITION_SNAPSHOT",
    "COGNIRUNNER_AI_PROVIDER", MEMORIES_KEY, MEMORY_SETTINGS_KEY, MEMORY_STORE_FULL_KEY,
    KNOWLEDGE_SETTINGS_KEY,
  ]);
  for (const p of PROVIDER_IDS) for (const slot of providerSlotsFor(p)) keys.add(slot);
  return keys;
};

/* ═══════════════════════════════════════════════════════════════════════════════════
 * F-639 — THE KNOWLEDGE FAMILIES: WHICH ROWS A DRIVER MAY SNAPSHOT AND PUT BACK.
 *
 * The `invokeResolver` allow-list admits six MUTATORS — `saveSkill`, `deleteSkill`,
 * `deleteContextDoc`, `saveListener`, `deleteScheduledJob`, `addMemory` — and the only
 * thing that ever put the tenant back the way it was found is a SENTENCE in the docblock
 * above them: "a driver that calls them must restore what it changed, in the same run, in
 * a `finally`". A duty written in prose is discharged by whoever remembers it. A driver
 * that deletes a builtin doc and then throws before its `finally` — or is killed, or
 * times out mid-run — leaves the tenant changed, and nothing in this file notices.
 *
 * So this is the same answer F-769 gave the credential problem, aimed at the knowledge
 * store: the rows move SERVER-SIDE, by NAME, and the restore is a lever rather than a
 * promise. `knowledgeSnapshot` copies the rows a driver names, `knowledgeRestore` puts
 * them back. Neither door ever puts a row's CONTENT on the wire in either direction —
 * a skill body is the tenant's own writing, and the read ceiling's rule ("what a door
 * says about a stored row is `present`, a fingerprint, and nothing else") is not
 * suspended because the row happens not to be a credential.
 *
 * WHICH KEYS, and where each NAME comes from (the module that owns it, never retyped —
 * this is the rule the memory and knowledge-pack slots already follow at `kvSet`):
 *   skill_repo_index / skill_repo:{id} / skill_repo_seed_meta   — src/skills.js
 *   pf_memories / the settings row / the store-full marker      — src/memories.js
 *   listener_index / listener:{id}                              — src/listeners.js
 *   job_index / job:{id} / job_sched                            — src/scheduled-jobs.js
 *   doc_repo_index / doc_repo:{id} / doc_repo_seed_meta         — src/index.js, RETYPED
 *
 * THE LAST LINE IS A DEFECT THIS DOOR CANNOT FIX, SO IT IS NAMED. `DOC_REPO_INDEX_KEY`,
 * `DOC_REPO_PREFIX` and `DOC_SEED_META_KEY` are module-private consts in src/index.js and
 * are not exported, so there is no binding to import — and index.js already carries a
 * SECOND home for the prefix itself (`storage.get(\`doc_repo:${id}\`)` at its doc-fetch
 * site, nowhere near the consts). Retyping them here makes a third. The fix is to export
 * the three from index.js (or move them to a shared module) and have all three sites
 * import them; that belongs to whoever owns index.js, not to this door.
 *
 * WHAT IS DELIBERATELY OUT. Every credential family (`isCredentialKey`) — a knowledge
 * snapshot is not a way to move a secret, and `kvStash` already exists for the one case
 * that legitimately needs it. The registry, the execution logs, `pf_code:*` and the
 * provider slots: none of the six mutators touch them, and a snapshot door is bounded by
 * what the drivers it exists for actually change, not by what would be convenient.
 *
 * Async because the names are IMPORTED, and this file imports a backend module the way
 * every other harness path in it does — lazily, inside the request — so production loads
 * none of it.
 * ═══════════════════════════════════════════════════════════════════════════════════ */
export const knowledgeKeyFamilies = async () => {
  const [skills, listeners, jobs] = await Promise.all([
    import("./skills.js"), import("./listeners.js"), import("./scheduled-jobs.js"),
  ]);
  return {
    // Rows addressed by their whole name.
    exact: [
      "doc_repo_index", "doc_repo_seed_meta",
      skills.SKILL_INDEX_KEY, skills.SKILL_SEED_META_KEY,
      MEMORIES_KEY, MEMORY_SETTINGS_KEY, MEMORY_STORE_FULL_KEY,
      listeners.LISTENER_INDEX_KEY,
      jobs.JOB_INDEX_KEY, jobs.JOB_SCHED_KEY,
    ],
    // Families addressed by prefix — `doc_repo:{id}` and friends. A bare prefix with no
    // id after it is NOT a member: `doc_repo:` names no row, and admitting it would let a
    // malformed driver write an empty-id row the product can never read or clean up.
    prefixes: ["doc_repo:", skills.SKILL_PREFIX, listeners.LISTENER_PREFIX, jobs.JOB_PREFIX],
  };
};

/**
 * Is this key one of the knowledge rows the snapshot door may copy? Asked on the way IN
 * (which keys a snapshot may name) and again on the way OUT (F-769's rule: a row snapshot
 * before a families change must not become a write door for a key the list no longer
 * admits).
 */
export const isKnowledgeKey = async (key) => {
  if (typeof key !== "string" || key.length === 0) return false;
  // A credential is never a knowledge row, whatever else it is. Stated rather than relied
  // on: no family below overlaps one today, and this is what keeps that true tomorrow.
  if (isCredentialKey(key)) return false;
  const f = await knowledgeKeyFamilies();
  return f.exact.includes(key) || f.prefixes.some((p) => key.startsWith(p) && key.length > p.length);
};

/** At most this many rows in one snapshot — a driver restores what it touched, not a tenant. */
export const KNOWLEDGE_SNAPSHOT_MAX_KEYS = 40;
/* The snapshot rows live in the `harness_stash:*` PREFIX FAMILY, deliberately, because
 * that family already has everything this one needs and a second keyspace would need all
 * of it again: the TTL (`HARNESS_STASH_MAX_AGE_SECONDS`), the sweeper that can SEE and
 * reap a leaked row (`stashSweep`), and a place in `CREDENTIAL_KEY_FAMILIES` so the
 * `?what=kvs` read cannot hand the copied rows back out. One home. The id carries a
 * `snap-` marker and the row carries `kind`, so the two doors cannot be crossed: a
 * `kvRestore` of a snapshot id finds no `row.key` and 404s, and a `knowledgeRestore` of a
 * stash id finds no `kind` and 404s. Both directions asserted offline. */
export const KNOWLEDGE_SNAPSHOT_ID_PREFIX = "snap-";
export const KNOWLEDGE_SNAPSHOT_KIND = "knowledge-snapshot";

/* ═══════════════════════════════════════════════════════════════════════════════════
 * F-769 — `kvStash` / `kvRestore`: PUT THE TENANT'S OWN CREDENTIAL BACK WITHOUT EVER
 * HAVING READ IT.
 *
 * The read ceiling (see the `?what=kvs` call site) creates one honest problem, and this
 * is its answer rather than an exception to it. A driver that REPLACES a credential to
 * plant a fault — `va-compaction-live.mjs` points the instance at a deliberately dead
 * BYOK key to drive F-506's own scenario — must put the tenant's real key back in its
 * `finally`, and it did that by snapshotting the value through the read and replaying it
 * through `kvSet`. With the value masked, that restore would write `undefined` and
 * DESTROY a working credential: strictly worse than the leak it fixed.
 *
 * So the value moves SERVER-SIDE and is addressed by NAME. `kvStash` copies the row to
 * `harness_stash:{stashId}` and answers `{stashed:true, stashId, key, present,
 * fingerprint}`; `kvRestore` writes it back to the key it came from and answers
 * `{restored:true, key, present, fingerprint}`. The value never crosses the wire in
 * either direction, and the fingerprint on both ends lets a driver PROVE the round trip
 * was byte-identical — which is strictly more than the old snapshot-and-compare proved,
 * because it compares hashes of the stored rows rather than of what a script remembered.
 *
 * WHAT BOUNDS IT:
 *   - the same `kvWriteAllowList()` as `kvSet` — this door writes, so it may not reach a
 *     row `kvSet` may not write. `git_conn_secret:*` and `git_hook_secret:*` stay off it,
 *     exactly as F-339 left them: secrets are never plantable, and they are not stashable.
 *   - `harness_stash:*` is ITSELF a credential family, so the stash row cannot be read
 *     back out through `?what=kvs` either. Closing that is the whole point.
 *   - a TTL, through `faultTtlOption` (the one home for the option shape), so a driver
 *     that dies between stash and restore leaves nothing behind for long. The stash is
 *     deleted on a successful restore anyway.
 *   - `stashId` is opaque and server-minted; a caller cannot name a stash into existence.
 *
 * F-779 — THE TTL IS A GUARANTEE, SO IT FAILS CLOSED. It used to be best-effort: when the
 * platform refused the TTL option the catch re-wrote the SAME row with no expiry at all and
 * the 200 still said `ttlSeconds: 3600` — a permanent plaintext credential under a row that
 * `?what=kvs` masks, described to the driver's evidence file as expiring in an hour. A
 * refused TTL is now a REFUSED STASH: any partial row is deleted, the answer is 424
 * `{ok:false, error:"stash-ttl-unavailable"}`, and the driver must not go on to plant its
 * fault, because it would have nothing to put back from. `ttlSeconds` is only ever the TTL
 * that was actually applied — it is reachable only on the path that applied it.
 *
 * And a TTL is not a sweeper: nothing ENUMERATED `harness_stash:*`, so a row that outlived
 * its TTL option (or its driver) was unreachable by any lever and invisible to the read door
 * that masks it. The `stashSweep` action below is that lever — a DEDICATED one bound to this
 * prefix, deliberately not a widened `sweepHarnessFaults`, whose reasoning is at
 * `sweepHarnessStashes` in harness-fault.js (which is also where this prefix now lives, so
 * the writer and the reaper cannot drift onto two different keyspaces).
 *
 * A restore of a stash whose row was ABSENT deletes the key rather than writing `null`,
 * because "there was no key here" and "there was a key holding null" are different
 * states and only one of them is what the driver found.
 * ═══════════════════════════════════════════════════════════════════════════════════ */
/* F-779 — the PREFIX and the key builder live in harness-fault.js next to the lever that
 * reaps them (`sweepHarnessStashes`), and are imported dynamically at each use the way every
 * other harness-fault use in this file is, so production loads none of it. The TTL the stash
 * asks for is the same hour that lever reaps at — ONE number, read from there, never a second
 * copy that could quietly drift below it and leave rows the reaper thinks are still live. */

/*
 * F-632 — ONE PREDICATE FOR "THE HARNESS PLANTED THIS ROW", AND ONE REFUSAL FOR WHEN IT
 * DID NOT. The pipeline door shipped with this discipline and the tombstone door shipped
 * without it, in the same commit: `pipelineRow clear` refused a row it had not planted,
 * while `vaTombstone clear` deleted ANY tombstone and `op:"age"` rewrote a real one.
 * Deleting a real `va_purged:{agent}` row is the one direction that hands a purged agent
 * its voice back and destroys the record the F-608 purges panel exists to print, and an
 * age is the soft form of the same thing. Both doors now ask the SAME question here
 * rather than each carrying its own copy of it.
 */
export const harnessPlanted = (row) => Boolean(row && typeof row === "object" && row.plantedBy === "harness");

export const notPlantedRefusal = (what) => ({
  error: `harnessRefusal: that ${what} was not planted by the harness — this door never touches a real record`,
  harnessRefusal: "not-planted",
});

/* ═══════════════════════════════════════════════════════════════════════════════════
 * F-794 — ONE TRAVERSAL, TWO CALLERS: THE WRITE REFUSAL AND THE READ MASK.
 *
 * `findSecretFields` walks a value and returns EVERY path whose FIELD NAME reads like a
 * credential (`SECRET_KEY_HINTS`) or whose STRING VALUE looks like one
 * (`secretSpansInText`), in depth-first order. Two doors ask it one question:
 *
 *   · the WRITE refusal (`findPlantedSecret`) wants the FIRST hit, to name a field and
 *     refuse the body. Its behaviour is UNCHANGED — it is now the one-line caller that
 *     takes `[0]`, at the same `depth > 6` ceiling it always had.
 *   · the READ mask (`maskSecretFields`, the `?what=kvs` FIELD ceiling) wants ALL hits,
 *     so it can answer the row with exactly those subtrees replaced and the rest plain.
 *
 * TWO CEILINGS, ON PURPOSE. The write refusal keeps 6: a plant body is a small, flat,
 * harness-authored thing, and a deeper walk only costs every refused body more work. The
 * read mask walks to `READ_MASK_MAX_DEPTH`, because the rows it must see through are real
 * tenant configs (`config_registry` → rule → config → functions[] → step) and a secret one
 * level below the walker's sight is a secret returned in plain text. Below that depth the
 * mask FAILS CLOSED — the subtree is replaced by a fingerprint and its path is listed —
 * because "I could not look" must never be spelled the same way as "I looked and it was
 * clean". The write refusal never reaches that edge in practice; if a plant body ever
 * nests 7 deep it refuses, which is the safe direction for a door that plants state.
 *
 * A FIELD-NAME hit does NOT descend: the whole subtree under a field called `headers` is
 * the credential, not one leaf of it, and the read mask replaces exactly that subtree.
 * F-825 — but a name hit only FIRES on a value that could hold a credential (a string, or
 * a subtree containing one); see `couldHoldCredential` below for why a number never does.
 * ═══════════════════════════════════════════════════════════════════════════════════ */
const WRITE_REFUSAL_MAX_DEPTH = 6;
const READ_MASK_MAX_DEPTH = 12;

/* ═══════════════════════════════════════════════════════════════════════════════════
 * F-825 — A FIELD NAME IS A GUESS ABOUT THE VALUE; THE VALUE'S TYPE SETTLES IT.
 *
 * `SECRET_KEY_HINTS` contains `token`, and `flat.includes(h)` is a SUBSTRING test, so the
 * name `tokens` matches. Every `log_entry:*` row carries `tokens` — the NUMERIC AI usage
 * counter — and once F-802 put the execlog arm behind the ceiling, 12 of 47 execlog
 * entries on dev answered `tokens` as `{masked:true,…}`. A number cannot authenticate
 * anything: masking it disclosed nothing and blinded every driver that reads token usage,
 * which is the F-814 lesson (an over-mask asserts a false cause about the field) arriving
 * by the NAME door instead of the value-shape one.
 *
 * So a name hit now only fires on a value that COULD hold a credential: a string, or an
 * object/array that contains one anywhere beneath it. Numbers, booleans, null, and
 * all-numeric subtrees answer PLAIN and the walk continues into them, so a credential
 * deeper down is still found by name or by shape. The WRITE refusal shares this traversal
 * and therefore this rule: `{token:"ghp_…"}` still refuses a plant body, `{tokens:1234}`
 * no longer does — and refusing a number was never protecting anything.
 *
 * WHY THERE IS NO `tokens` / `usage.tokens` NAME EXEMPTION, though the live report asked.
 * A name exemption would be a SECOND home for the credential-name rule (the F-778 shape:
 * a hand-written list beside a hint list, drifting), and it would answer `{tokens:"ghp_…"}`
 * — a list of real tokens under a plural name — in plain text. The type rule is general,
 * needs no per-name maintenance, and errs in the safe direction: it can only ever UNMASK a
 * value that cannot carry a secret. The plural stays claimed whenever it holds strings.
 *
 * FAILS CLOSED on what it cannot read: a subtree deeper than the read ceiling is treated
 * as string-bearing, because "I could not look" must not be spelled like "I looked and
 * there was nothing a credential could hide in" — the same rule the walker itself keeps.
 * ═══════════════════════════════════════════════════════════════════════════════════ */
const couldHoldCredential = (v, depth = 0) => {
  if (typeof v === "string") return true;
  if (!v || typeof v !== "object") return false;
  if (depth > READ_MASK_MAX_DEPTH) return true;
  const subs = Array.isArray(v) ? v : Object.values(v);
  return subs.some((s) => couldHoldCredential(s, depth + 1));
};

export const findSecretFields = (value, { maxDepth = WRITE_REFUSAL_MAX_DEPTH, maxItems = 50, extraFieldNames = [] } = {}) => {
  const extra = new Set(extraFieldNames);
  const out = [];
  const walk = (v, path, depth) => {
    if (depth > maxDepth) { out.push({ field: path || "(root)", why: "below-the-walker-depth-ceiling" }); return; }
    if (typeof v === "string") {
      // F-814 — TWO ANSWERS, because a string can BE a credential or merely CONTAIN one.
      // A bare credential is the whole value (`?what=provider` seeded with `sk-…`): the node
      // is replaced. A credential inside prose (a validator `reason`, a rule `prompt`, a
      // step's `code`) is a hit on the TOKEN, and the read projection rewrites the token in
      // place so the sentence survives. The WRITE refusal treats both the same — it only
      // ever asks whether there is a credential in the plant body at all.
      if (isBareCredential(v)) { out.push({ field: path || "(root)", why: "value-looks-like-a-credential" }); return; }
      if (secretSpansInText(v).length > 0) out.push({ field: path || "(root)", why: "value-redacted-in-text" });
      return;
    }
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length && i < maxItems; i++) walk(v[i], `${path}[${i}]`, depth + 1);
      return;
    }
    for (const [k, sub] of Object.entries(v)) {
      const p = path ? `${path}.${k}` : k;
      const flat = k.toLowerCase().replace(/[^a-z0-9]/g, "");
      // `key` alone is a legitimate harness word (a KVS key); the hints below are not.
      // The REVIEWED per-key mask is unconditional: a human named that exact field on that
      // exact key after reading the row, so it is a decision, not a guess, and the type rule
      // below (which exists only to correct a NAME GUESS) has no business overriding it.
      if (extra.has(k)) { out.push({ field: p, why: "reviewed-field-mask-for-this-key" }); continue; }
      // F-825 — A NAME HIT ONLY MASKS A VALUE THAT COULD HOLD A CREDENTIAL.
      if (SECRET_KEY_HINTS.some((h) => flat.includes(h)) && couldHoldCredential(sub)) {
        out.push({ field: p, why: "field-name-reads-like-a-credential" }); continue;
      }
      walk(sub, p, depth + 1);
    }
  };
  walk(value, "", 0);
  return out;
};

export const findPlantedSecret = (value) => findSecretFields(value)[0] || null;

/* ═══════════════════════════════════════════════════════════════════════════════════
 * F-794 — THE FIELD CEILING. THE READ CEILING WAS PER-KEY; A CREDENTIAL IS PER-FIELD.
 *
 * F-769 drew the `?what=kvs` disclosure ceiling around a KEY FAMILY: a row whose KEY is a
 * credential answers a fingerprint, and EVERY OTHER ROW answers entirely in plain text.
 * That is the right shape for a row that IS a secret (`COGNIRUNNER_KEY_*` — a naked
 * string). It is the wrong shape for a MIXED row, and the app is full of mixed rows:
 * `config_registry`, `pf_code:*`, `job:*`, `listener:*`, `async_job:*` are tenant configs
 * whose key says nothing and which can carry an endpoint credential inside them. The tell
 * is already written down elsewhere in this repo: `src/shared/rule-portability.js` strips
 * `headers` from an export as "endpoint auth" — the exporter knows those rows hold
 * credentials, and this door did not.
 *
 * So a non-family key is now answered FIELD BY FIELD: the value comes back with every
 * path `findSecretFields` names replaced by `{masked:true, why, fingerprint}` and a
 * top-level `maskedFields:[path]` saying which, and everything else PLAIN. (F-814: a path
 * whose hit was a credential INSIDE FREE TEXT is the exception — it stays a string with
 * only the token rewritten as `<masked:fingerprint>`, and `maskedWhy[path]` says so.) A driver still
 * reads a rule's events, filters and step names out of `job:*`; it no longer reads the
 * bearer token under `functions[].endpoint.headers`.
 *
 * THE RESIDUAL, STATED OUT LOUD RATHER THAN LEFT TO BE DISCOVERED. This is a FIELD-NAME
 * ceiling with a value-shape backstop, and free text is neither:
 *   · `functions[].code`, `agent.instructions`, `prompt`/`systemPrompt`/`instructions` and
 *     every other prose field come back PLAIN. A tenant who pasted a token into a prompt is
 *     caught ONLY if it wears a shape `secretSpansInText` knows (`sk-…`, `ghp_…`, `xoxb-`,
 *     `github_pat_`, a `.atlassian-dev.net/` web-trigger URL, or a declared key family
 *     name). A bare hex/base64 blob in a prompt is invisible, and masking every long
 *     string in a `code` field would mask the code.
 *   · a field named in a language no hint covers (`autorisierung`, `pw`) is invisible for
 *     the same reason the F-778 catch-all could not see `COGNIRUNNER_CONTEXT7_REMOTE`: a
 *     name-based rule can only see the names it knows. A `headers` MAP is walked field by
 *     field, so `Authorization`, `Cookie` and anything containing `token`/`apikey` are
 *     masked and `X-Trace` stays readable — which is the point, and also the residual: a
 *     bearer sent under `X-Client-Id` is not caught by name, only by shape.
 * What it DOES guarantee: the shape a door cannot read is MASKED, never returned. A
 * subtree below `READ_MASK_MAX_DEPTH` is fingerprinted, not answered.
 *
 * Returns `null` when the row is clean (the caller answers it plain, unchanged), otherwise
 * `{value, maskedFields}`. The fingerprint is the ONE `credentialFingerprint` (F-780) —
 * there is no second digest in this file and there must not be.
 * ═══════════════════════════════════════════════════════════════════════════════════ */
export const maskSecretFields = async (value, { extraFieldNames = [] } = {}) => {
  // `maxItems: Infinity` — the write refusal stops at 50 array items because a plant body
  // is small and the FIRST hit is all it needs; a READ that stopped at 50 would answer
  // `config_registry`'s 51st rule in plain text. A KVS value is capped at 240 KiB, so the
  // walk is bounded by the row itself.
  const hits = findSecretFields(value, { maxDepth: READ_MASK_MAX_DEPTH, maxItems: Infinity, extraFieldNames });
  if (hits.length === 0) return null;
  const why = new Map(hits.map((h) => [h.field, h.why]));
  const maskedFields = [];
  const rebuild = async (v, path, depth) => {
    const at = path || "(root)";
    if (why.has(at)) {
      maskedFields.push(at);
      // F-814 — IN PLACE for free text. Replacing the whole node destroyed the field a
      // driver reads that row FOR (a validator's `reason`, a rule's `prompt`, a step's
      // `code`) and asserted a false cause for it. Only the matched TOKEN goes, replaced by
      // its own fingerprint, so the sentence around it stays readable and the path is still
      // named in `maskedFields`. A whole-node mask is now reserved for a FIELD-NAME hit and
      // for a value that IS a bare credential.
      if (why.get(at) === "value-redacted-in-text") {
        let out = "", cursor = 0;
        for (const { start, end } of secretSpansInText(v)) {
          out += v.slice(cursor, start) + `<masked:${await credentialFingerprint(v.slice(start, end))}>`;
          cursor = end;
        }
        return out + v.slice(cursor);
      }
      return { masked: true, why: why.get(at), fingerprint: await credentialFingerprint(v) };
    }
    if (!v || typeof v !== "object") return v;
    if (Array.isArray(v)) {
      const out = [];
      for (let i = 0; i < v.length; i++) out.push(await rebuild(v[i], `${path}[${i}]`, depth + 1));
      return out;
    }
    const out = {};
    for (const [k, sub] of Object.entries(v)) out[k] = await rebuild(sub, path ? `${path}.${k}` : k, depth + 1);
    return out;
  };
  /* F-814 — `maskedFields` is still a LIST OF PATHS (drivers read it that way and must not
     have to change), and `maskedWhy` says WHICH of the two projections each path got:
     `value-redacted-in-text` means the field is still a readable string with the token
     rewritten, anything else means the node was replaced. Without it a caller could only
     tell the two apart by inspecting the value, which is the guesswork this cut removes. */
  const projected = await rebuild(value, "", 0);
  return { value: projected, maskedFields, maskedWhy: Object.fromEntries(maskedFields.map((f) => [f, why.get(f)])) };
};

/* ═══════════════════════════════════════════════════════════════════════════════════
 * F-802 — ONE ANSWER PROJECTION FOR EVERY READ DOOR THAT RETURNS A STORED ROW.
 *
 * The F-794 FIELD ceiling was hung on ONE of the four read arms of the same `what`
 * switch. `?what=kvs&key=config_registry` masked the secret-looking paths; `?what=registry`
 * returned the identical row VERBATIM, one query parameter away. The same held for
 * `validation_logs` (`?what=logs`) and for every `log_entry:*` (`?what=execlogs` ->
 * `readLogs`) - and `log_entry:` is precisely the key the census test excuses as
 * `unbounded-field-masked-at-the-door`, naming a door those rows are not read through.
 * A ceiling with one door open is not a ceiling; it is a query string away from nothing.
 *
 * So the projection is no longer a property of the `kvs` arm. `readCeiling` is the ONE
 * rule - the F-769 per-KEY family mask, then the F-794 per-FIELD mask - and
 * `answerStored` is the ONE way any arm of this switch may put a stored row on the wire.
 * A new `what` that reads storage and answers `json(200, ...)` directly is the defect this
 * paragraph exists to make obvious.
 *
 * A LIST OF ENTRIES IS ONE VALUE. `?what=logs`/`?what=execlogs` hand the whole ARRAY to
 * the same traversal, so every entry is masked and the paths come back aggregated with the
 * entry INDEX in them (`[3].result.headers.<the header name>`) rather than a per-entry
 * `maskedFields` a caller would have to zip back together. One row, one `maskedFields`,
 * whichever door answered - which is the property the F-794 kvSet-echo check pins.
 *
 * THE KEY IS NOMINAL for the doors that do not take one (`config_registry`,
 * `validation_logs`, `log_entry:*`): it is the key those rows actually live under, so
 * `isCredentialKey` and `extraMaskedFieldsFor` answer the same thing they would if the
 * driver had come through `?what=kvs`. That equality IS the cut.
 *
 * THE RESIDUAL IS UNCHANGED and is the one stated at `maskSecretFields`: free text
 * (`functions[].code`, `agent.instructions`, a log entry's AI output) is caught only by
 * SHAPE (`secretSpansInText`).
 *
 * F-814 — AND FREE TEXT IS NOW REDACTED IN PLACE RATHER THAN SWALLOWED. Widening the
 * ceiling onto the log and registry arms put PROSE through a rule written for a header
 * value: an unanchored `sk-` matched `risk-assessment`, and a validator `reason` or a rule
 * `prompt` came back as `{masked:true, why:"value-looks-like-a-credential"}` — an object
 * where four drivers read a string, and a false cause asserted about a sentence with no
 * credential in it. The shape is anchored (`src/shared/secret-shapes.js`) and the
 * projection now replaces the TOKEN, not the field.
 * ═══════════════════════════════════════════════════════════════════════════════════ */
export const readCeiling = async (key, value) => {
  const stored = value === undefined ? null : value;
  if (isCredentialKey(key)) {
    return { masked: true, present: stored !== null, fingerprint: await credentialFingerprint(stored) };
  }
  const m = await maskSecretFields(stored, { extraFieldNames: extraMaskedFieldsFor(key) });
  return m ? { value: m.value, maskedFields: m.maskedFields, maskedWhy: m.maskedWhy } : { value: stored };
};

/**
 * Put a stored row on the wire under this door's own envelope name, through `readCeiling`
 * and nothing else. `envelope` keeps each arm's historical field (`registry`, `logs`,
 * `value`) so no driver has to change; `key` is what the row is stored under.
 */
const answerStored = async (envelope, key, value) =>
  json(200, { key, ...(await storedFields(envelope, key, value)) });

/* ═══════════════════════════════════════════════════════════════════════════════════
 * F-806 — THE CEILING IS THE DOOR'S, NOT THE GET SWITCH'S.
 *
 * F-802 routed all five arms of the GET `what` switch through `readCeiling`, and left the
 * POST action map — which also reads storage and also answers rows — outside it. Nothing
 * leaked: every row those actions reach is harness-PLANTED, and `findPlantedSecret`
 * refuses a credential in the plant body before anything is written. But "no leak today"
 * was a property of the PLANT, not of the READ, so the ceiling had two classes of door and
 * only one of them was gated — which is precisely the shape F-802 was filed about.
 *
 * `storedFields` is the projection; `answerStored` is now a thin `json(200, …)` around it,
 * so GET and POST share ONE rule rather than two that agree today. A POST answer carries
 * OTHER fields beside the row (`ok`, `key`, `op`, `planted`, `predicates`, `set`), so it
 * SPREADS the projection instead of replacing the envelope: every answer's field names are
 * unchanged and no driver has to move. A masked row is spelled the way the GET side spells
 * it — `{masked:true, present, fingerprint}`, the envelope absent — so a caller reads one
 * shape whichever door answered.
 *
 * `answerFingerprintOnly` is the deliberately TIGHTER statement for the two doors that must
 * never put the row on the wire at all: `kvStash`/`kvRestore` move a tenant's value BY NAME
 * (F-769), so their answers are present+fingerprint and the value is not projected, it is
 * not answered. It is named rather than inlined so the POST gate can SEE that the read was
 * answered on purpose, instead of reading an un-projected `storage.get` as a bypass.
 * ═══════════════════════════════════════════════════════════════════════════════════ */
const storedFields = async (envelope, key, value) => {
  const c = await readCeiling(key, value);
  if (c.masked) return { masked: true, present: c.present, fingerprint: c.fingerprint };
  return { [envelope]: c.value, ...(c.maskedFields ? { maskedFields: c.maskedFields, maskedWhy: c.maskedWhy } : {}) };
};

/** The row is NOT answered — only whether it is there and which bytes it was. */
const answerFingerprintOnly = async (stored) => ({
  present: stored !== null && stored !== undefined,
  fingerprint: await credentialFingerprint(stored ?? null),
});

/* ═══════════════════════════════════════════════════════════════════════════════════
 * F-742 — THE KVS DOOR: A MALFORMED BODY IS A 400 HERE, NOT A STACK TRACE THERE.
 *
 * `kvSet` forwarded `body.key` and `body.value` straight into `storage.set`. The
 * allow-list answered the question "may this key be written", and nothing at all
 * answered "is this a key, and is this a value": a non-string key, a missing value or
 * an oversized one reached the platform, which threw `ForgeKvsAPIError [BAD_REQUEST]`.
 * The webtrigger then died on the throw — a raw stack in the Forge log and a 424 at the
 * caller, with no word about WHICH half of the body was wrong. A harness door that
 * cannot say "your value is 300 KiB" costs a driver an hour every time it is wrong.
 *
 * So the shape is asked HERE, before the platform is touched, and the answer NAMES THE
 * FIELD and never the value: a key may be echoed (the allow-list already echoes it, and
 * a key is not a secret), a value never may — this file's whole promise is that a
 * credential in a body is refused rather than reflected (`findPlantedSecret`). A size
 * in bytes is a measurement, not a disclosure, so a reason may carry it.
 *
 * THE KEY GRAMMAR IS NOT THIS FILE'S TO OWN (F-770). The KEY door also guards the
 * unrestricted `?what=kvs` READ, which must stay able to look at any row a live tenant
 * holds — `pf_code:{id}:{hash}`, `log_entry:*`, keys this file has never heard of. F-742
 * expressed that as a deliberately COARSE local check, and in doing so wrote a SECOND
 * home for "is this a legal KVS key" (plus a second `KVS_KEY_MAX_CHARS = 500`) beside
 * `src/shared/kvs-keys.js`, which already owns the platform's own grammar. The two homes
 * disagreed in BOTH directions, which is worse than either being wrong alone:
 *
 *   - `"a b"` is LEGAL to the platform (its pattern admits whitespace explicitly) and the
 *     local check answered 400 on it — a FALSE REFUSAL, the exact harm "coarse" was meant
 *     to avoid, on a row a live tenant really holds.
 *   - `"a/b"`, `"pf_code:1/2"`, `"x%y"` and non-ASCII all PASSED the local check and are
 *     ILLEGAL, so they still reached the platform and still produced the
 *     `ForgeKvsAPIError [INVALID_KEY]` -> 500/424 that F-742 exists to eliminate. "/" is
 *     the character that caused F-346, so it is the first thing a repo driver types.
 *
 * So the predicate is now `isKvsKey` from `src/shared/kvs-keys.js` — ONE HOME, the same
 * one the key BUILDERS assert against (`assertKvsKey`), dependency-free and already
 * bundled into this backend. This door keeps only the 400 SHAPE (`{ok,error,field,
 * reason}`) and the field names; what counts as a key is no longer its opinion.
 * "Unrestricted" is unchanged: there is still no allow-list on a read.
 *
 * Returns `null` when the pair is usable, or the 400 body `{ ok, error, field, reason }`.
 * ONE HOME — the census of the sibling doors is in the comment at the `kvSet` call site.
 * ═══════════════════════════════════════════════════════════════════════════════════ */
export const KVS_VALUE_MAX_BYTES = 240 * 1024;
const badRequest = (field, reason) => ({ ok: false, error: "bad-request", field, reason });

/** The key half — shared by the `kvSet` write and the `?what=kvs` read. */
export const kvsKeyRefusal = (key) => {
  if (typeof key !== "string") return badRequest("key", `key must be a string (got ${key === null ? "null" : typeof key})`);
  if (key.length === 0) return badRequest("key", "key must not be empty");
  if (key.length > KVS_KEY_MAX_CHARS) return badRequest("key", `key must be at most ${KVS_KEY_MAX_CHARS} characters (got ${key.length})`);
  // The platform's own grammar, asked at its ONE home. The reason may name the pattern:
  // it is a published constant, not a value.
  if (!isKvsKey(key)) return badRequest("key", `key must match the platform key pattern ${KVS_KEY_PATTERN} — alphanumerics, ":", ".", "_", "#", "-" and spaces (note "/" is not legal)`);
  return null;
};

/**
 * The value half. `null` is NOT a bad value here — it is how `kvSet` spells "delete",
 * and that meaning belongs to the call site, which passes `allowNull` to say so.
 */
export const kvsValueRefusal = (value, { allowNull = false } = {}) => {
  if (value === undefined) return badRequest("value", "value is required (send null to delete)");
  if (value === null) return allowNull ? null : badRequest("value", "value must not be null");
  const t = typeof value;
  if (t === "function" || t === "symbol" || t === "bigint") return badRequest("value", `value must be JSON-serialisable (got ${t})`);
  let encoded;
  try {
    encoded = JSON.stringify(value);
  } catch (e) {
    return badRequest("value", `value must be JSON-serialisable (${errorClassOf(e)})`);
  }
  if (encoded === undefined) return badRequest("value", `value must be JSON-serialisable (got ${t})`);
  // Byte length, not character length: the platform's cap is on the encoded bytes, and a
  // multi-byte string that passes a `.length` check still throws BAD_REQUEST.
  const bytes = typeof Buffer !== "undefined" ? Buffer.byteLength(encoded, "utf8") : new TextEncoder().encode(encoded).length;
  if (bytes > KVS_VALUE_MAX_BYTES) {
    return badRequest("value", `value is ${bytes} bytes, over the ${KVS_VALUE_MAX_BYTES}-byte KVS limit`);
  }
  return null;
};


/**
 * The four calls, as real `route` templates. Injected as a unit so the offline suite can
 * drive every branch (including the delete) without a network.
 */
export const createJsmProbeCalls = (api, route) => ({
  postComment: (issueKey, payload) =>
    api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/comment`, {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(payload),
    }),
  readJsdComment: (issueKey, commentId) =>
    api.asApp().requestJira(route`/rest/servicedeskapi/request/${issueKey}/comment/${commentId}`),
  readCommentProperty: (commentId) =>
    api.asApp().requestJira(route`/rest/api/3/comment/${commentId}/properties/sd.public.comment`),
  deleteComment: (issueKey, commentId) =>
    api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/comment/${commentId}`, { method: "DELETE" }),
});

export async function runJsmCommentProbe({ issueKey, mode, calls }) {
  const internal = mode !== "public";
  const out = {
    mode: internal ? "internal" : "public",
    postStatus: null, hasId: false, readStatus: null, jsdPublic: null,
    keys: [], propertyStatus: null, propertyEcho: null, deleteStatus: null, errorClass: null,
  };
  let commentId = null;
  try {
    const payload = {
      body: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: JSM_PROBE_COMMENT_TEXT }] }] },
    };
    // The ONE claim under test: the property shape for an internal note. The public arm
    // sends NO property at all — that is what "public" means on this API.
    if (internal) payload.properties = [{ key: JSM_INTERNAL_PROPERTY_KEY, value: { internal: true } }];
    const post = await calls.postComment(issueKey, payload);
    out.postStatus = post && post.status != null ? post.status : null;
    const created = await jsonOf(post);
    const rawId = created && created.id != null ? String(created.id) : "";
    // Only a digit id is ever interpolated into a later path.
    if (/^[0-9]{1,20}$/.test(rawId)) { commentId = rawId; out.hasId = true; }
    if (commentId) {
      const read = await calls.readJsdComment(issueKey, commentId);
      out.readStatus = read && read.status != null ? read.status : null;
      const data = await jsonOf(read);
      out.keys = keysOf(data);
      out.jsdPublic = data && typeof data.public === "boolean" ? data.public : null;
      const prop = await calls.readCommentProperty(commentId);
      out.propertyStatus = prop && prop.status != null ? prop.status : null;
      const pv = await jsonOf(prop);
      const value = pv && pv.value;
      out.propertyEcho = value && typeof value === "object"
        ? { internal: value.internal === true, keys: keysOf(value) }
        : null;
    }
  } catch (e) {
    out.errorClass = errorClassOf(e);
  } finally {
    // ALWAYS. Throw path, error-status path, happy path.
    if (commentId) {
      try {
        const del = await calls.deleteComment(issueKey, commentId);
        out.deleteStatus = del && del.status != null ? del.status : null;
      } catch (e) {
        out.deleteStatus = null;
        out.deleteErrorClass = errorClassOf(e);
      }
    } else {
      out.deleteStatus = "nothing-to-delete";
    }
  }
  return out;
}

export async function testStateTrigger(req) {
  const secret = process.env.HARNESS_SECRET;
  if (!secret) return notFound();
  // F-341: header names are case-insensitive — the read folds case over the actual
  // keys in ONE place (src/shared/http-headers.js), shared with gitWebhook's hookHeader.
  const provided = readBearerToken(req);
  if (!provided || provided !== secret) return notFound();

  // Dev-gated POST action for the it12 import-commit smoke. Runs the SAME
  // commitImportCore the resolver uses (dynamic import avoids the index<->test-hook
  // top-level cycle; resolves the already-loaded module at call time). accountId:null
  // is safe — the HARNESS_SECRET Bearer gate above is the authorization.
  if (String((req && req.method) || "GET").toUpperCase() === "POST") {
    let body = {};
    try { body = JSON.parse((req && req.body) || "{}"); } catch (e) { return json(400, { error: "invalid JSON body" }); }
    /* F-806 - EVERY ACTION BELOW THAT ANSWERS A STORED ROW GOES THROUGH `storedFields`
       (-> `readCeiling`), the same rule the GET `what` switch takes through `answerStored`.
       An action that `storage.get`s and puts the row in its own `json(200, ...)` re-opens
       the ceiling on the POST side, which is where it stood open until now. The two doors
       that must answer even less - `kvStash`/`kvRestore`, which move a value by NAME -
       take `answerFingerprintOnly` instead, and say so at the call. */
    // ===== Coder plan Part 0 platform probes (dev-gated) =====
    // "probe": records getAppContext().license as seen by THIS webtrigger and enqueues the same
    // question (or a Forge LLM cap measurement) into the async consumer; "readProbe" returns the
    // recorded rows. Nothing here touches production paths or user data.
    if (body.action === "probe") {
      try {
        const { getAppContext } = await import("@forge/api");
        const { Queue } = await import("@forge/events");
        let ctx = null; let ctxErr = null;
        try { ctx = getAppContext(); } catch (e) { ctxErr = String(e?.message || e); }
        const webtrigger = { hasContext: !!ctx, license: ctx?.license ?? null, keys: ctx ? Object.keys(ctx) : [], error: ctxErr };
        await storage.set("probe:license:webtrigger", { at: new Date().toISOString(), runtime: "webtrigger", ...webtrigger }, { ttl: { value: 1, unit: "DAYS" } });
        const queue = new Queue({ key: "async-ai-queue" });
        const kind = body.kind === "forgeLlm" ? "forgeLlm" : "license";
        const name = kind === "license" ? "license:consumer" : ("forgellm:" + String(body.name || Date.now()).replace(/[^A-Za-z0-9_.-]/g, ""));
        const taskId = "probe-" + Date.now().toString(36);
        const pushed = await queue.push({ body: { taskType: "probe", taskId, params: { kind, name, model: body.model, tokens: body.tokens, calls: body.calls, enqueuedAt: new Date().toISOString() } } });
        return json(200, { webtrigger, queued: { kind, name, key: "probe:" + name, pushed: pushed || null } });
      } catch (e) {
        return json(500, { error: String((e && e.message) || e) });
      }
    }
    if (body.action === "setWebhookProbeSecret") {
      const secret = String(body.secret || "");
      if (!/^[A-Za-z0-9]{16,80}$/.test(secret)) return json(400, { error: "secret must be 16-80 alphanumerics" });
      await storage.set("probe:webhook:secret", { secret, at: new Date().toISOString() }, { ttl: { value: 1, unit: "DAYS" } });
      return json(200, { ok: true });
    }
    // 1.4 commit 5 — plant a PER-REPO webhook signing secret so a tester can sign a
    // delivery to the PRODUCTION `git-webhook` trigger. Writes through
    // git-connections.js (`gitHookSecretKey`) so the key name has ONE home, and it is
    // dev-gated by the same HARNESS_SECRET Bearer as everything else in this file —
    // there is no path to this action in production, where HARNESS_SECRET is unset.
    if (body.action === "plantHookSecret") {
      const connId = String(body.connId || "");
      const repoId = String(body.repoId || "");
      const secretValue = String(body.secret || "");
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(connId)) return json(400, { error: "connId required" });
      if (!/^[^/\s]+\/[^/\s]+$/.test(repoId)) return json(400, { error: "repoId must be owner/name" });
      if (!/^[A-Za-z0-9]{16,80}$/.test(secretValue)) return json(400, { error: "secret must be 16-80 alphanumerics" });
      const { gitHookSecretKey, normalizeRepoId, plantHarnessConnection } = await import("./git-connections.js");
      // F-339 — the secret alone proves nothing: `gitWebhook` 404s unless a
      // `git_conn:*` row exists AND the repo is on its allow-list, and the write
      // resolvers are deliberately off the allow-list below. So the hook may plant
      // a TOKENLESS STAND-IN row for the same connId — routing without a credential.
      // Its shape lives in git-connections.js; this is wiring. It never overwrites
      // an existing row, and no `git_conn_secret:*` key is written on any path.
      let connection = null;
      if (body.plantConnection === true) {
        const planted = await plantHarnessConnection({ id: connId, kind: body.kind || "github", repoId });
        if (!planted.ok) return json(400, { error: planted.error, code: planted.code });
        connection = planted.connection;
      }
      const key = gitHookSecretKey(connId, repoId);
      await storage.set(key, { secret: secretValue, connId, repoId: normalizeRepoId(repoId), createdAt: new Date().toISOString() });
      // The secret is what the CALLER just sent us; echoing the KEY (never the value)
      // is what makes the plant verifiable without a read path for secrets.
      return json(200, { ok: true, key, connection });
    }
    // F-339 — the cleanup half. It refuses any row that is not a stand-in, so it
    // is not a delete path for a real connection (`deleteGitConnection` stays off
    // the invoke allow-list).
    if (body.action === "deleteHarnessConnection") {
      const connId = String(body.connId || "");
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(connId)) return json(400, { error: "connId required" });
      const { deleteHarnessConnection } = await import("./git-connections.js");
      const r = await deleteHarnessConnection(connId);
      return json(r.ok ? 200 : 400, r);
    }
    /* F-664 — WHAT THE THREE `read*Fault` ACTIONS ANSWER, for all four kinds.
     * `readHarnessFault` now returns `{ key, value, until, expired }`, and each read action
     * below spreads that answer, so a live driver polling a lever sees the row's OWN
     * deadline and whether it has passed. It matters because the platform TTL does NOT end
     * a lever: Forge KVS deletes expired keys lazily, and a Jira fault armed for 5 s was
     * measured still biting at 615 s. The bound is the `until` stamp on the row, enforced
     * on every read in src/harness-fault.js — so `value: null, expired: true` is a lever
     * that ended by itself, and `value: null, expired: false` is one that was never armed.
     * The `?what=kvs` reader below is deliberately UNCHANGED: `until` is a field of the
     * row, not KVS metadata, so a plain `storage.get` already shows it. */
    // ===== F-335 live proof: the dev-only dispatch fault lever =====
    // Arms N consecutive forced throws at the git-event dispatch seam so the live driver
    // can prove the retry/attempt-cap/claim-release contract without breaking anything
    // for real. All of it — the key shape, the cap, the TTL and the env gate — lives in
    // src/harness-fault.js; this is wiring behind the same HARNESS_SECRET Bearer gate as
    // every other action here, and the lever itself is additionally inert whenever that
    // env var is absent (production).
    if (body.action === "armGitDispatchFault" || body.action === "disarmGitDispatchFault" || body.action === "readGitDispatchFault") {
      const connId = String(body.connectionId || body.connId || "");
      const deliveryId = String(body.deliveryId || "");
      if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(connId)) return json(400, { error: "connectionId required" });
      if (!/^[A-Za-z0-9_.:-]{1,120}$/.test(deliveryId)) return json(400, { error: "deliveryId required" });
      const { armHarnessFault, disarmHarnessFault, readHarnessFault, HARNESS_FAULT_GIT_DISPATCH, HARNESS_FAULT_MAX_COUNT } = await import("./harness-fault.js");
      const parts = [connId, deliveryId];
      if (body.action === "armGitDispatchFault") {
        const n = Math.floor(Number(body.count) || 1);
        if (!(n >= 1 && n <= HARNESS_FAULT_MAX_COUNT)) return json(400, { error: `count must be 1-${HARNESS_FAULT_MAX_COUNT}` });
        return json(200, { ok: true, ...(await armHarnessFault(HARNESS_FAULT_GIT_DISPATCH, parts, n)) });
      }
      if (body.action === "disarmGitDispatchFault") return json(200, { ok: true, ...(await disarmHarnessFault(HARNESS_FAULT_GIT_DISPATCH, parts)) });
      return json(200, { ok: true, ...(await readHarnessFault(HARNESS_FAULT_GIT_DISPATCH, parts)) });
    }
    // ===== F-504 live proof: the dev-only HOOK-PROMOTE fault lever =====
    // Same shape, same allow-list discipline and same one-shot semantics as the dispatch
    // lever above — arming N units makes the next N promotions of THIS connection+repo
    // throw at step 3 of rotateGitHookSecret, which is the only way a live driver can
    // reach `hookState:"rotation-failed"`, the pending-secret acceptance window (F-481)
    // and the reconcile-on-retry (F-491). No secret is accepted or returned on any of the
    // three actions: the lever is keyed by connection and repo alone.
    if (body.action === "armHookPromoteFault" || body.action === "disarmHookPromoteFault" || body.action === "readHookPromoteFault") {
      const connId = String(body.connectionId || body.connId || "");
      const repoId = String(body.repoId || body.repo || "");
      if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(connId)) return json(400, { error: "connectionId required" });
      if (!/^[^/\s]+\/[^/\s]+$/.test(repoId) || repoId.length > 120) return json(400, { error: "repoId must be owner/name" });
      const { armHarnessFault, disarmHarnessFault, readHarnessFault, HARNESS_FAULT_HOOK_PROMOTE, HARNESS_FAULT_MAX_COUNT } = await import("./harness-fault.js");
      const { normalizeRepoId } = await import("./shared/git-ids.js");
      // The consumer keys on the NORMALISED repo id (that is what rotate holds), so the
      // arming side must normalise too or the lever would never be found.
      const parts = [connId, normalizeRepoId(repoId)];
      if (body.action === "armHookPromoteFault") {
        const n = Math.floor(Number(body.count) || 1);
        if (!(n >= 1 && n <= HARNESS_FAULT_MAX_COUNT)) return json(400, { error: `count must be 1-${HARNESS_FAULT_MAX_COUNT}` });
        return json(200, { ok: true, ...(await armHarnessFault(HARNESS_FAULT_HOOK_PROMOTE, parts, n)) });
      }
      if (body.action === "disarmHookPromoteFault") return json(200, { ok: true, ...(await disarmHarnessFault(HARNESS_FAULT_HOOK_PROMOTE, parts)) });
      return json(200, { ok: true, ...(await readHarnessFault(HARNESS_FAULT_HOOK_PROMOTE, parts)) });
    }
    /* ===== F-629 live proof: the dev-only KEY-READ fault lever =====
     * THE THIRD MEMBER of the `armHarnessFault` family, and the first that is not
     * git-scoped. F-603 is a bug about what the provider settings card does when
     * `getOpenAIKey` FAILS — a stale `noKeyNeeded` painting a BYOK provider as "Managed
     * by LeanZero, nothing to paste here" with no key input at all — and that resolver is
     * a KVS read plus a provider switch, so nothing a tester can do from outside makes it
     * fail. The fix could only ever be exercised against a mock.
     *
     * KEYED BY PROVIDER ID ALONE, so the F-603 scenario is expressible: the managed engine
     * loads fine, then OpenAI's read fails. The cap, the two modes, the TTL and the env
     * gate all live in src/harness-fault.js; this is wiring behind the same HARNESS_SECRET
     * Bearer as everything else here, and the lever is additionally inert wherever that
     * env var is absent (production).
     *
     * IT ACCEPTS NO KEY AND RETURNS NO KEY. The body carries a provider id, a mode and a
     * TTL — nothing else — and the three answers carry the fault KEY, never a slot value.
     */
    if (body.action === "armKeyReadFault" || body.action === "disarmKeyReadFault" || body.action === "readKeyReadFault") {
      const provider = String(body.provider || "");
      if (!PROVIDER_IDS.includes(provider)) return json(400, { error: `provider must be one of: ${PROVIDER_IDS.join(", ")}` });
      const {
        armKeyReadFault, disarmHarnessFault, readHarnessFault,
        HARNESS_FAULT_KEY_READ, KEY_READ_FAULT_MODES, HARNESS_KEY_READ_FAULT_MAX_TTL_SECONDS,
      } = await import("./harness-fault.js");
      if (body.action === "armKeyReadFault") {
        if (!KEY_READ_FAULT_MODES.includes(body.mode)) return json(400, { error: `mode must be one of: ${KEY_READ_FAULT_MODES.join(", ")}` });
        const r = await armKeyReadFault(provider, body.mode, body.ttlSeconds);
        // The clamp lives with the lever; a refusal from it overrides the optimistic ok.
        return json(r.ok === false ? 400 : 200, { ok: true, provider, maxTtlSeconds: HARNESS_KEY_READ_FAULT_MAX_TTL_SECONDS, ...r });
      }
      if (body.action === "disarmKeyReadFault") return json(200, { ok: true, provider, ...(await disarmHarnessFault(HARNESS_FAULT_KEY_READ, [provider])) });
      return json(200, { ok: true, provider, ...(await readHarnessFault(HARNESS_FAULT_KEY_READ, [provider])) });
    }
    /* ===== F-655 live proof: the dev-only JIRA TRANSPORT fault lever =====
     * THE FOURTH MEMBER of the `armHarnessFault` family. F-648 made `searchUsers` fail
     * CLOSED for the whole transport class — a 403/429/500 from Jira's user search is
     * `{success:false, reason:"jira_unavailable"}` and no longer an empty success the
     * admin reads as "that person is not on this site" — and nothing a tester can do from
     * outside makes that endpoint fail, so the arm (and the ordering of the admin gate
     * above it) had no live door.
     *
     * THE PATH IS EXACT. `armJiraFault` accepts only a member of `JIRA_FAULT_PATHS`; there
     * is no wildcard and no prefix match, because a lever that can fault "anything under
     * /rest" is a lever that can break an arbitrary product path on a real tenant. The
     * status range, the path allow-list and the TTL cap all live in src/harness-fault.js;
     * this is wiring behind the same HARNESS_SECRET Bearer as everything else here, and
     * the lever is additionally inert wherever that env var is absent (production).
     *
     * It plants no data and returns none: the body carries a path, a status and a TTL. */
    if (body.action === "armJiraFault" || body.action === "disarmJiraFault" || body.action === "readJiraFault") {
      const {
        armJiraFault, disarmHarnessFault, readHarnessFault,
        HARNESS_FAULT_JIRA, JIRA_FAULT_PATHS, HARNESS_JIRA_FAULT_MAX_TTL_SECONDS,
      } = await import("./harness-fault.js");
      const path = String(body.path || "");
      if (!JIRA_FAULT_PATHS.includes(path)) return json(400, { error: `path must be one of: ${JIRA_FAULT_PATHS.join(", ")}` });
      if (body.action === "armJiraFault") {
        const r = await armJiraFault(path, body.status, body.ttlSeconds);
        // The clamps live with the lever; a refusal from it overrides the optimistic ok.
        return json(r.ok === false ? 400 : 200, { ok: true, path, maxTtlSeconds: HARNESS_JIRA_FAULT_MAX_TTL_SECONDS, ...r });
      }
      if (body.action === "disarmJiraFault") return json(200, { ok: true, path, ...(await disarmHarnessFault(HARNESS_FAULT_JIRA, [path])) });
      return json(200, { ok: true, path, ...(await readHarnessFault(HARNESS_FAULT_JIRA, [path])) });
    }
    /* ===== F-667: THE SWEEP — one call that clears a crashed driver's leftovers =====
     * F-664 bounded a fault row on the READ, which ends a lever the moment anything looks
     * at it. It does NOT reach the row nobody will look at again: a driver that dies before
     * its `finally` leaves a fault on a key only that dead process knew, and Forge KVS
     * deletes expired keys lazily (up to 48 h). Worse, every row armed by a build before the
     * F-664 deploy carries no `until` at all — F-667's read-time fix dates those from
     * `armedAt` + the ten-minute ceiling, and THIS action is how they actually leave storage.
     *
     * IT DELETES ONLY EXPIRED ROWS, and it says which: the answer lists every
     * row in the fault keyspace with its stored `until`, the deadline that BOUNDS it and whether
     * that has passed. A live lever is listed and left alone — an action that could cancel a
     * running driver's fault would make every suite's result depend on who else pressed it;
     * `disarmJiraFault` and friends are still how you end a lever you armed. `dryRun: true` —
     * the literal `true` and nothing else (F-673) — lists without deleting.
     *
     * F-673: THE SWEEP IS TIME-BOUNDED AND RESUMABLE, because this door is a web trigger the
     * platform kills at 25 s and the old loop could be killed holding an answer it never sent.
     * A caller may pass `maxMs` (clamped in harness-fault.js to 20 s) and a `cursor`; a sweep
     * that runs out of budget answers 200 with `truncated: true, reason: "budget"` and the
     * cursor to POST back, so "keep going" is this same action again rather than a guess.
     *
     * The enumeration, the budget, the page caps and the env gate all live in
     * src/harness-fault.js; this is wiring behind the same HARNESS_SECRET Bearer as every
     * other action here, and the sweep is additionally inert wherever that env var is absent
     * (production). */
    /* F-676 — THE ONE CALLER-CONTROLLED VALUE THIS ACTION ADDED IS VALIDATED LIKE THE REST.
     * `cursor` used to be a bare `typeof === "string"` check and then went STRAIGHT into
     * `storage.query().cursor(...)` — the only input on this door with no allow-list, next
     * to siblings that check `JIRA_FAULT_PATHS.includes(path)` and a 400-599 status range.
     * And the POST branch has no try/catch of its own (the only outer `catch` is on the GET
     * `what` branch), so a KVS that REJECTS a malformed or foreign token threw out of
     * `testStateTrigger` and the caller got a platform 500 with NO JSON body, where every
     * other refusal here is a 400 with a reason. A resume loop then cannot tell "bad token"
     * from "the tenant is down".
     *
     * So: an opaque-token grammar, a 2 KB ceiling, and a try/catch that turns any throw from
     * the sweep into JSON. This is a DOOR guard, not a tightening of a fail-open:
     * `sweepHarnessFaults` still applies its own `BEGINS_WITH` prefix predicate (the key
     * shape has ONE home, in harness-fault.js, and is not retyped here) and still deletes
     * only expired rows, so a cursor that slips through the grammar can no more reach a live
     * lever than one that does not.
     *
     * F-685: the grammar itself is not retyped here either. It is
     * `sweepCursorWellFormed` in harness-fault.js, next to the encoder that produces the
     * only tokens it admits — the door used to hold a WIDER-charactered but narrower-in-
     * effect copy while the library accepted any string as a legacy raw cursor, which is two
     * answers to one question. Legacy raw cursors are refused now; see that docblock.
     *
     * F-684 — THE DIAGNOSIS IS THE ERROR'S, NOT THE SHAPE OF THE REQUEST.
     * Every throw with a cursor in play used to be answered `400 bad-cursor`, purely because
     * a cursor had been supplied — a cause the failure never carried. A resume loop that hit
     * `RATE_LIMIT_EXCEEDED` on call 4 was told its valid token was bad, dropped it and
     * re-swept from the top, doubling the load on the KVS already refusing it; the identical
     * platform fault on call 1 answered `500 sweep-failed`. The door now discriminates on
     * the ERROR: `decodeSweepCursor` refuses a token SYNCHRONOUSLY, before the sweep touches
     * KVS at all, and only that refusal (`BAD_SWEEP_CURSOR_CODE`) is `bad-cursor`. Anything
     * thrown from the query or the deletes is `sweep-failed`, carrying the platform error's
     * own `code` when it has one, so a caller can back off rather than restart.
     *
     * F-683/F-691/F-692 — THE ANSWER CONTRACT, AND THE ONE FIELD THAT CARRIES IT.
     *
     * `complete` IS THE FINISHED SIGNAL. It is computed in ONE place — `sweepAnswerTail` in
     * harness-fault.js — as `!truncated && !unresolved`, where `unresolved` is a failed
     * delete from ANY call of this drain, inherited through the resume token. This door
     * returns it EXPLICITLY, after the spread, so a future reshape of the library's answer
     * cannot quietly stop carrying it.
     *
     * ⚠ DEPRECATED: DERIVING FINISHEDNESS FROM `truncated` (or from `cursor === null`).
     * Both are per-CALL facts. A drain that budget-broke after a page whose deletes failed
     * answers `truncated: false` on its final call while rows it condemned are still live —
     * that is F-691, and re-deriving is how a caller re-acquires the bug the library just
     * fixed. Read `complete`. A caller loops while `cursor !== null` and STOPS ONLY ON
     * `complete === true`; `failedResume` (a token, or null) names the page to go back to.
     *
     * `reason: "deletes-failed"` carries the cursor of the page whose deletes failed so the
     * caller retries it, and `reason: "deletes-failing"` says the call is NOT converging —
     * a whole batch landed nothing — so a loop must back off instead of spinning. */
    /* ===== F-706 live proof: the dev-only DELETE fault lever =====
     * THE SEVENTH MEMBER of the `armHarnessFault` family, and the one the SWEEP's own answer
     * contract needs. F-682 (`deletes-failing`), F-683 (`deletes-failed` + `failedResume`),
     * F-690 (the drain's back-off) and F-691 (the unresolved failure riding the resume token)
     * are all about what the sweep does when a KVS delete REFUSES — and nothing a tester can
     * do on a real tenant makes one refuse. plant-sweep-live saw `failed: 0` throughout, so
     * that whole half of the contract was proven against the offline mock only.
     *
     * THE PREFIX IS EXACT, and it is the PLANT's: `armDeleteFault` accepts
     * `HARNESS_FAULT_PLANT_PREFIX` and nothing else, by equality, exactly as `armJiraFault`
     * accepts one path. A lever that could fail an arbitrary delete could strand app data;
     * this one can only refuse to remove inert ballast nothing reads, which expires on its
     * own in 60 s anyway. The prefix allow-list, the mode allow-list, the count cap and the
     * TTL cap (120 s) all live in src/harness-fault.js, never retyped here, and the lever
     * is consulted in exactly one place: the shared delete batch of the sweep and the clear.
     *
     * F-722 — AND THE COUNT CAP THE DOOR PUBLISHES IS THE DRAINABLE ONE. It used to be a
     * hand-set 50, about five times what a drain tolerates: a faulted sweep spends only
     * `KVS_DELETE_BATCH` units per call and answers byte-identically, so the drain's spin
     * detector stops at `IDENTICAL_ANSWER_LIMIT * KVS_DELETE_BATCH` units with the rest still
     * armed — and the cleanup, which reads the same lever, then fails with "PLANTED ROWS MAY
     * REMAIN" for a reason the tenant does not contain. `DELETE_FAULT_DRAINABLE_MAX` is
     * derived from those two constants, and the arm answers it as `maxCount` AND as
     * `drainableMax`, so a driver reading this door learns the number and its name.
     *
     * It plants no data and returns none: the body carries a prefix, a mode, a count and a
     * TTL. Disarm and read are the generic pair, keyed by the same prefix. */
    if (body.action === "armDeleteFault" || body.action === "disarmDeleteFault" || body.action === "readDeleteFault") {
      const {
        armDeleteFault, disarmHarnessFault, readHarnessFault,
        HARNESS_FAULT_DELETE, HARNESS_FAULT_PLANT_PREFIX, DELETE_FAULT_MODES,
        DELETE_FAULT_DRAINABLE_MAX, HARNESS_DELETE_FAULT_MAX_TTL_SECONDS,
      } = await import("./harness-fault.js");
      // The one prefix this family may touch has ONE home; the door names it, never a literal.
      const prefix = HARNESS_FAULT_PLANT_PREFIX;
      if (body.action === "armDeleteFault") {
        const r = await armDeleteFault({ prefix: body.prefix === undefined ? prefix : body.prefix, mode: body.mode, count: body.count, ttlSeconds: body.ttlSeconds });
        // The clamps live with the lever; a refusal from it overrides the optimistic ok.
        return json(r.ok === false ? 400 : 200, {
          ok: true, prefix, modes: DELETE_FAULT_MODES,
          maxCount: DELETE_FAULT_DRAINABLE_MAX, drainableMax: DELETE_FAULT_DRAINABLE_MAX,
          maxTtlSeconds: HARNESS_DELETE_FAULT_MAX_TTL_SECONDS, ...r,
        });
      }
      if (body.action === "disarmDeleteFault") return json(200, { ok: true, prefix, ...(await disarmHarnessFault(HARNESS_FAULT_DELETE, [prefix])) });
      return json(200, { ok: true, prefix, ...(await readHarnessFault(HARNESS_FAULT_DELETE, [prefix])) });
    }

    if (body.action === "sweepHarnessFaults") {
      const { sweepHarnessFaults, sweepCursorWellFormed, BAD_SWEEP_CURSOR_CODE } = await import("./harness-fault.js");
      const rawCursor = body.cursor;
      let cursor = null;
      if (rawCursor !== undefined && rawCursor !== null) {
        // The same predicate the library applies, run early so an over-long or non-string
        // body is refused before anything else looks at it.
        if (!sweepCursorWellFormed(rawCursor)) return json(400, { ok: false, reason: "bad-cursor" });
        cursor = rawCursor;
      }
      let r;
      try {
        r = await sweepHarnessFaults({
          dryRun: body.dryRun === true,
          maxMs: typeof body.maxMs === "number" ? body.maxMs : undefined,
          cursor,
        });
      } catch (e) {
        const message = String((e && e.message) || e).slice(0, 300);
        const code = (e && typeof e.code === "string" && e.code) || null;
        // The ONLY `bad-cursor` is the library's own pre-KVS refusal of the token.
        if (code === BAD_SWEEP_CURSOR_CODE) return json(400, { ok: false, reason: "bad-cursor", error: message });
        // Everything else is the platform's, with its code when it carries one — never a
        // bodyless 500, and never the caller's token blamed for the tenant's state.
        return json(500, { ok: false, reason: "sweep-failed", code, error: message });
      }
      // A refusal from the lever overrides the optimistic ok, exactly like the arm actions.
      // `complete` is named EXPLICITLY (F-692): it is the finished signal, and a field that
      // only ever arrives by spread is a field a reshape can drop without anyone noticing.
      return json(r.ok === false ? 400 : 200, { ok: true, ...r, complete: r.complete === true });
    }
    /* ===== F-688: THE BALLAST — the only way to give the sweep a second page =====
     * Everything F-673/F-674/F-677/F-682/F-683 built into `sweepHarnessFaults` — the resume
     * token, the real KVS cursor round-trip, the paced deletes, the progress guarantee and
     * `complete` — engages only once the fault keyspace is bigger than one page of
     * 100. The arming actions above cannot get there: one row per exact path, one per
     * provider, a handful per connection. So a tester on a real tenant could never prove the
     * multi-page path, and every resume assertion in this repo stayed offline-only.
     *
     * THE PLANTED ROWS ARE INERT, and that is what licenses a lever that writes five hundred
     * of them when the dangerous ones are capped at one. They go under the kind `plant`, and
     * NOTHING READS THAT KIND: every consumer names its kind exactly —
     * `harnessFaultArmed(HARNESS_FAULT_GIT_DISPATCH…)`, `(HARNESS_FAULT_HOOK_PROMOTE…)`,
     * `readHarnessFault(HARNESS_FAULT_KEY_READ…)` inside `keyReadFaultMode`,
     * `readHarnessFault(HARNESS_FAULT_JIRA…)` inside `jiraFaultStatus`, and the four read
     * actions above, which pass those same four constants. There is no wildcard read, no
     * prefix read and no enumeration anywhere but `sweepHarnessFaults`, which only DELETES.
     * A planted row therefore occupies the keyspace and bites nothing.
     *
     * REFUSED IN PRODUCTION, by the same mechanism as every other action here and one more
     * inside the lever: `HARNESS_SECRET` is set in development and staging and NEVER in
     * production, so this door is 404 there, and `plantHarnessFaults` / `clearPlantedFaults`
     * each ask `harnessEnabled()` as their first statement and answer `harness-off` even if
     * something inside the app calls them directly.
     *
     * `n` IS CLAMPED IN THE LEVER, not here — the clamp lives with the constant it bounds,
     * like the 400-599 status range and the TTL caps. `expired: true` dates the rows in the
     * past so the sweep will actually delete them; anything else plants live rows the sweep
     * must list and leave alone. Every row carries its TTL in the SECONDS shape, so forgotten
     * ballast leaves on its own even if nobody clears it.
     *
     * F-696 — THIS DOOR HAS A BUDGET AND A RESUME, LIKE THE SWEEP'S. Measured live: 200 rows
     * take 17–18 s, so the documented 500 was ~45 s against a trigger killed at 25 s, and a
     * plant that timed out answered NOTHING while having written an unknown number of rows.
     * `maxMs` (clamped in the lever to 20 s) bounds the call; a `budget` break answers
     * F-724/F-745 — AND THE ANSWER SAYS HOW IT IS RESUMED. `resume: "start-index"` means
     * carry on from `nextIndex`; `resume: "repost"` (`reason: "clearing"` / `"clear-failed"`)
     * means send this SAME body again — `nextIndex` deliberately does not advance there, and
     * `clearedSoFar` / `remainingStale` are the progress to watch instead (POST `clearToken`
     * back to keep `clearedSoFar` cumulative, F-744); `resume: "stop"` (`writes-failed`)
     * means do NOT loop — the store refused writes, the population is short, and nothing
     * downstream may be asserted over it. The mapping is the lever's `plantResumeMode` and is
     * never re-derived here.
     * `{ planted, failed, truncated, reason: "budget", nextIndex }` and the caller POSTs the
     * SAME `n` back with `startIndex: nextIndex` until `complete: true`. `maxN` is what THIS
     * call may ask for — one call's worth for a fresh plant, the full population for a resumed
     * one — and it is computed by the lever's `plantMaxForCall`, never retyped here.
     *
     * F-710 — HITTING THAT CEILING IS A TRUNCATION, NOT A FINISH. A fresh `{ n: 500 }` plants
     * 150 and answers `truncated: true, reason: "call-max", nextIndex: 150` with `n` still 500:
     * the population is ECHOED, never rewritten to the clamp. It used to answer `n: 150,
     * complete: true`, so a caller looping "until complete" planted one call's worth believing
     * it had planted what it asked for — the opposite of the loop this door documents, and the
     * reason a live driver's `planted === 200` assertion was red. `maxN` is this call's
     * ceiling and `n` is the population: two different numbers, both in the answer.
     *
     * F-697/F-709 — the TTL covers the WALL TIME of the drain this door forces (one budget
     * plus a cold start per resumed call, plus a full minute after the last row), and the
     * whole population shares ONE deadline carried on `plant:000`, so the head of a large
     * `expired: false` population is still live when the sweep the tester is about to run
     * walks over it. `armedAt` is still stamped per batch: two stamps, two jobs.
     *
     * F-708 — `startIndex` IS JUDGED AGAINST `n`, in the lever, and past it is a REFUSAL that
     * comes back through this door's existing `ok === false` → 400 path. It used to be a 200
     * whose `nextIndex` pointed behind its own `startIndex` and whose `complete: true` told a
     * drain loop that a keyspace it never looked at was planted. Exactly AT `n` is the loop's
     * own last POST and answers `noop: true, planted: 0, complete: true`. A FRESH plant also
     * removes any older population past `n` first and reports it as `cleared`, because the
     * keys are `i`-derived: a smaller re-plant would otherwise leave the previous tail alive
     * under an answer that names a population the store does not hold. */
    if (body.action === "plantHarnessFaults") {
      const { plantHarnessFaults, plantMaxForCall, HARNESS_FAULT_PLANT_PREFIX } = await import("./harness-fault.js");
      const r = await plantHarnessFaults({
        n: body.n,
        expired: body.expired === true,
        maxMs: typeof body.maxMs === "number" ? body.maxMs : undefined,
        startIndex: body.startIndex,
        /* F-744: the running cleared count of an identical re-POST loop, carried in the
         * answer's own `clearToken`. Best-effort in the lever — it is a progress report,
         * not an input to a decision — so the door forwards it and judges nothing. */
        clearToken: typeof body.clearToken === "string" ? body.clearToken : undefined,
      });
      // A refusal from the lever overrides the optimistic ok, exactly like the arm actions.
      // `complete` is named EXPLICITLY (F-692): it is the finished signal, and a field that
      // only ever arrives by spread is a field a reshape can drop without anyone noticing.
      return json(r.ok === false ? 400 : 200, {
        ok: true, maxN: plantMaxForCall(body.startIndex), prefix: HARNESS_FAULT_PLANT_PREFIX,
        ...r, complete: r.complete === true,
      });
    }
    /* The other half: delete the ballast, and ONLY the ballast. The prefix is NOT a
     * parameter — no caller gets to name the keyspace an unconditional delete walks — and it
     * is bound to `HARNESS_FAULT_PLANT_PREFIX` in the library. The answer is the sweep's own shape
     * (`truncated` / `reason` / `cursor` / `complete` / `failedResume`), assembled by the same
     * `sweepAnswerTail`, validated and diagnosed by the same two rules: `sweepCursorWellFormed`
     * at the door (F-676/F-685) and only the library's own pre-KVS refusal of a token is
     * `bad-cursor` (F-684). `complete` is the finished signal here too, for the same reason
     * (F-691/F-692): `truncated` is a per-CALL fact and re-deriving from it is deprecated. */
    if (body.action === "clearPlantedFaults") {
      const { clearPlantedFaults, sweepCursorWellFormed, BAD_SWEEP_CURSOR_CODE } = await import("./harness-fault.js");
      const rawCursor = body.cursor;
      let cursor = null;
      if (rawCursor !== undefined && rawCursor !== null) {
        if (!sweepCursorWellFormed(rawCursor)) return json(400, { ok: false, reason: "bad-cursor" });
        cursor = rawCursor;
      }
      let r;
      try {
        r = await clearPlantedFaults({ maxMs: typeof body.maxMs === "number" ? body.maxMs : undefined, cursor });
      } catch (e) {
        const message = String((e && e.message) || e).slice(0, 300);
        const code = (e && typeof e.code === "string" && e.code) || null;
        if (code === BAD_SWEEP_CURSOR_CODE) return json(400, { ok: false, reason: "bad-cursor", error: message });
        return json(500, { ok: false, reason: "clear-failed", code, error: message });
      }
      // Explicit for the same reason as the sweep above (F-692): this is THE finished signal.
      return json(r.ok === false ? 400 : 200, { ok: true, ...r, complete: r.complete === true });
    }
    if (body.action === "readProbe") {
      const name = String(body.name || "").replace(/[^A-Za-z0-9_.:-]/g, "");
      if (!name) return json(400, { error: "name required" });
      const probeKey = "probe:" + name;
      return json(200, { name, ...(await storedFields("value", probeKey, (await storage.get(probeKey)) || null)) });
    }
    // Cross-product reach: can THIS Jira-triggered function call Confluence, and what is the
    // exact error when the app is not installed on Confluence?
    if (body.action === "probeConfluence") {
      try {
        const { default: api, route } = await import("@forge/api");
        const r = await api.asApp().requestConfluence(route`/wiki/api/v2/spaces?limit=1`);
        const text = await r.text();
        return json(200, { status: r.status, ok: r.ok, body: text.slice(0, 600) });
      } catch (e) {
        return json(200, { thrown: String((e && e.message) || e).slice(0, 600) });
      }
    }
    // JSM reach as the app: service desks and one queue listing.
    if (body.action === "probeServiceDesk") {
      try {
        const { default: api, route } = await import("@forge/api");
        const r1 = await api.asApp().requestJira(route`/rest/servicedeskapi/servicedesk?limit=5`);
        const t1 = await r1.text();
        let queues = null;
        try {
          const desks = JSON.parse(t1);
          const first = desks?.values?.[0]?.id;
          if (first) {
            const r2 = await api.asApp().requestJira(route`/rest/servicedeskapi/servicedesk/${first}/queue?limit=5`);
            const t2 = await r2.text();
            let firstQueue = null;
            try { firstQueue = JSON.parse(t2)?.values?.[0]?.id || null; } catch (e) { /* ignore */ }
            let issues = null;
            if (firstQueue) {
              const r3 = await api.asApp().requestJira(route`/rest/servicedeskapi/servicedesk/${first}/queue/${firstQueue}/issue?limit=3`);
              issues = { status: r3.status, body: (await r3.text()).slice(0, 400) };
            }
            queues = { status: r2.status, body: t2.slice(0, 400), issues };
          }
        } catch (e) { queues = { error: String(e?.message || e) }; }
        return json(200, { servicedesks: { status: r1.status, body: t1.slice(0, 400) }, queues });
      } catch (e) {
        return json(200, { thrown: String((e && e.message) || e).slice(0, 600) });
      }
    }
    // Writes the advisory Git-state property on ONE issue so the condition-expression probe can
    // flip a transition. Dev site only; the harness restores/removes it afterwards.
    if (body.action === "probeProperty") {
      if (typeof body.issueKey !== "string" || !/^[A-Z][A-Z0-9_]*-\d+$/.test(body.issueKey)) return json(400, { error: "issueKey required" });
      try {
        const { default: api, route } = await import("@forge/api");
        const key = String(body.propertyKey || "cognirunner.git");
        if (body.remove === true) {
          const r = await api.asApp().requestJira(route`/rest/api/3/issue/${body.issueKey}/properties/${key}`, { method: "DELETE" });
          return json(200, { removed: r.status });
        }
        const r = await api.asApp().requestJira(route`/rest/api/3/issue/${body.issueKey}/properties/${key}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body.value || {}) });
        const back = await api.asApp().requestJira(route`/rest/api/3/issue/${body.issueKey}/properties/${key}`);
        return json(200, { put: r.status, readBack: back.status, value: (await back.text()).slice(0, 400) });
      } catch (e) {
        return json(200, { thrown: String((e && e.message) || e).slice(0, 600) });
      }
    }
    // ===== 1.5 §5 probes P1–P4 (dev-gated, dev/staging only) =====
    // Every one of these returns STATUS CODES, RESPONSE KEYS and an ERROR CLASS only —
    // never a body, never a token, never a comment id.
    //
    // P1 — the JSM audience contradiction. Posts one short fixed comment as the app
    // (internal: with `sd.public.comment = {internal:true}`; public: with no property),
    // reads it back through the JSM request-comment API and DELETES it on every path.
    if (body.action === "probeJsmComment") {
      if (typeof body.issueKey !== "string" || !/^[A-Z][A-Z0-9_]*-\d+$/.test(body.issueKey)) return json(400, { error: "issueKey required" });
      const mode = body.mode === "public" ? "public" : "internal";
      const { default: api, route } = await import("@forge/api");
      const r = await runJsmCommentProbe({ issueKey: body.issueKey, mode, calls: createJsmProbeCalls(api, route) });
      return json(200, r);
    }
    // P2 — what a site answers when the app is NOT installed on Confluence. The shape of
    // the NOT-INSTALLED answer is what 1.5 needs; this site may well HAVE it installed,
    // in which case `installed:true` is the honest result and the question is still open.
    if (body.action === "probeConfluenceInstalled") {
      try {
        const { createConfluenceClient, INSTALL_PROBE_PATH } = await import("./confluence-client.js");
        // The transport is instrumented ONLY to capture the status and the top-level
        // response KEYS; the body itself is read and dropped here and never returned.
        let status = null; let bodyKeys = [];
        const client = createConfluenceClient({
          request: async (path, init) => {
            const { default: api } = await import("@forge/api");
            const res = await api.asApp().requestConfluence(path, init);
            status = res && res.status != null ? res.status : null;
            const clone = typeof res.clone === "function" ? res.clone() : null;
            if (clone) { const data = await jsonOf(clone); bodyKeys = keysOf(data); }
            return res;
          },
        });
        const out = await client.probeInstalled();
        return json(200, { probePath: INSTALL_PROBE_PATH, installed: out.installed === true, status: status ?? out.status ?? null, code: out.code || null, bodyKeys });
      } catch (e) {
        return json(200, { errorClass: errorClassOf(e) });
      }
    }
    // P3/P4 — the same two reaches FROM THE CONSUMER, which is where a VA item and a
    // queued Confluence post-function actually run. One NON-AI task type, two kinds; the
    // consumer writes `harness_probe:<kind>:<id>` (TTL 10 min) and `readHarnessProbe`
    // reads it. The handler additionally refuses when HARNESS_SECRET is absent.
    if (body.action === "probeConfluenceFromConsumer" || body.action === "probeServicedeskFromConsumer") {
      try {
        const { Queue } = await import("@forge/events");
        const { HARNESS_PROBE_TASK, harnessProbeKey } = await import("./async-handler.js");
        const kind = body.action === "probeServicedeskFromConsumer" ? "servicedesk" : "confluence";
        // P4 runs on the long queue by default (the sweep it stands in for does);
        // P3 answers the question on whichever queue the caller asks for.
        const long = kind === "servicedesk" ? body.long !== false : body.long === true;
        const probeId = "p" + Date.now().toString(36);
        const taskId = "harnessprobe-" + probeId;
        const queue = new Queue({ key: long ? "long-queue" : "async-ai-queue" });
        await queue.push({ body: { taskType: HARNESS_PROBE_TASK, taskId, params: { kind, probeId, queue: long ? "long" : "standard", enqueuedAt: new Date().toISOString() } } });
        return json(200, { id: probeId, kind, queue: long ? "long" : "standard", key: harnessProbeKey(kind, probeId) });
      } catch (e) {
        return json(200, { errorClass: errorClassOf(e) });
      }
    }
    /* F-824 — THE ROW'S OWN WINDOW IS WHAT THIS DOOR HONOURS, NOT KVS'S GOODWILL.
     * A probe row survived its 10-minute TTL by 12.4 minutes, because KVS expiry is lazy,
     * and this door answered it as a live measurement. The expiry judgement lives at
     * `harnessProbeExpired` (async-handler.js, next to the TTL and the key builder, so the
     * writer and the reader cannot drift onto two windows) and an expired row reads ABSENT
     * with `expired:true` — reported, not swallowed, exactly as `readHarnessFault` does. */
    if (body.action === "readHarnessProbe") {
      const id = String(body.id || "");
      if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(id)) return json(400, { error: "id required" });
      const { harnessProbeKey, HARNESS_PROBE_KINDS, harnessProbeExpired } = await import("./async-handler.js");
      const kind = HARNESS_PROBE_KINDS.includes(body.kind) ? body.kind : "confluence";
      const key = harnessProbeKey(kind, id);
      const stored = (await storage.get(key)) || null;
      const expired = harnessProbeExpired(stored);
      return json(200, { id, kind, key, expired, ...(await storedFields("value", key, expired ? null : stored)) });
    }
    /* F-824 — AND A DOOR THAT CLEARS ONE. `harness_probe:` is not on the `kvSet` write
     * allow-list (deliberately — a driver must not forge a measurement), so before this a
     * plant could only be WAITED OUT. This is a targeted delete of ONE key built by the
     * ONE key builder: no caller ever names the keyspace, which is the rule
     * `clearPlantedFaults` states for the prefix-bound sweeps. It is not folded into
     * `clearPlantedFaults` because that lever is bound to `HARNESS_FAULT_PLANT_PREFIX` as a
     * CONSTANT and widening it to a second keyspace is exactly the drift that rule forbids.
     * Idempotent: clearing an absent row is a success, since the caller asked for the row
     * to be gone and it is. */
    if (body.action === "clearHarnessProbe") {
      const id = String(body.id || "");
      if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(id)) return json(400, { error: "id required" });
      const { harnessProbeKey, HARNESS_PROBE_KINDS } = await import("./async-handler.js");
      const kind = HARNESS_PROBE_KINDS.includes(body.kind) ? body.kind : "confluence";
      const key = harnessProbeKey(kind, id);
      const present = (await storage.get(key)) != null;
      try {
        await storage.delete(key);
      } catch (e) {
        return json(500, { ok: false, key, error: String((e && e.message) || e).slice(0, 300) });
      }
      return json(200, { ok: true, id, kind, key, present });
    }
    if (body.action === "commit") {
      try {
        const { commitImportCore } = await import("./index.js");
        const r = await commitImportCore({ rule: body.rule, targetWorkflowName: body.targetWorkflowName, targetTransitionId: body.targetTransitionId, bindings: body.bindings || {}, accountId: null });
        return json(200, r);
      } catch (e) {
        return json(500, { error: String((e && e.message) || e) });
      }
    }
    // Knowledge-injection A/B (dev-gated): seed a skill carrying a nonce directive, run codegen
    // WITH vs WITHOUT it selected, then delete the skill. Touches only design-time codegen + the
    // knowledge store (test data) — NOT the runtime validator/condition/PF decision path.
    if (body.action === "seedSkill") {
      try {
        const { saveSkillInternal } = await import("./skills.js");
        const r = await saveSkillInternal(
          { id: body.id, name: body.name, category: body.category || "Other", description: body.description || "", tags: body.tags || [], operationTypes: body.operationTypes || [], enabled: body.enabled !== false, builtin: false, createdBy: null },
          { instructions: body.instructions || "", examples: body.examples || "" },
        );
        return json(200, r);
      } catch (e) {
        return json(500, { error: String((e && e.message) || e) });
      }
    }
    if (body.action === "runCodegen") {
      try {
        const { runCodegenCore } = await import("./index.js");
        const r = await runCodegenCore({ prompt: body.prompt, operationType: body.operationType, selectedSkillIds: body.selectedSkillIds || [], autoMatch: body.autoMatch === true, projectKey: body.projectKey || null });
        return json(200, r);
      } catch (e) {
        return json(500, { error: String((e && e.message) || e) });
      }
    }
    if (body.action === "deleteSkill") {
      try {
        // F-590 — the skill index has ONE writer (src/skills.js). The hook
        // used to hard-delete here, bypassing the builtin flip-to-disabled rule.
        const { deleteSkillRows } = await import("./skills.js");
        const r = await deleteSkillRows(body.id, { who: "test-hook" });
        return json(200, { success: true, removed: r.removed, mode: r.mode });
      } catch (e) {
        return json(500, { error: String((e && e.message) || e) });
      }
    }
    // At-scale campaign: claim a batch of attached-but-unregistered rules into the registry (the
    // admin "Configured Rules" table) — the same "Scan → Register all" the admin UI does, 500-capped.
    if (body.action === "registerRules") {
      try {
        const { registerDiscoveredRulesCore } = await import("./index.js");
        const r = await registerDiscoveredRulesCore(Array.isArray(body.rules) ? body.rules : [], null);
        return json(200, r);
      } catch (e) {
        return json(500, { error: String((e && e.message) || e) });
      }
    }
    // Rules REST API token for the listeners/jobs E2E harness (dev-gated; the
    // production path is the admin UI's Settings → API access).
    if (body.action === "mintApiToken") {
      try {
        const { createApiTokenInternal } = await import("./rules-api.js");
        const r = await createApiTokenInternal({ name: body.name || "harness", accountId: "harness" });
        return json(200, r);
      } catch (e) {
        return json(500, { error: String((e && e.message) || e) });
      }
    }
    // Direct consumer concurrency proof for dedicated harness fixtures. This tests
    // real KVS claims and sandbox writes, not Forge's product-event/queue delivery.
    // It never accepts code, module names, arbitrary functions or raw event data.
    if (body.action === "probeRuleDelivery") {
      const taskType = body.taskType;
      const validTaskId = (id) => typeof id === "string" && /^harness-claim-[A-Za-z0-9_.-]{1,60}$/.test(id);
      if (!["listener", "scheduledjob"].includes(taskType)
        || typeof body.ruleId !== "string" || !/^[A-Za-z0-9_.-]{3,80}$/.test(body.ruleId)
        || !validTaskId(body.taskId)
        || (body.manual !== undefined && typeof body.manual !== "boolean")
        || (body.secondTaskId !== undefined && !validTaskId(body.secondTaskId))) {
        return json(400, { error: "Expected listener or scheduledjob, a ruleId and harness-claim- task ids." });
      }
      const manual = body.manual !== false;
      // Production claims retain the existing 120-character key-part limit.
      // Reject probe identities that would truncate distinct manual task ids.
      if (taskType === "scheduledjob" && manual
        && [body.taskId, body.secondTaskId || body.taskId].some((id) => `${body.ruleId}:manual:${id}`.length > 120)) {
        return json(400, { error: "Combined manual rule/task identity exceeds the claim key limit." });
      }
      if (taskType === "listener" && (typeof body.issueKey !== "string" || !/^[A-Z][A-Z0-9_]*-\d+$/.test(body.issueKey))) {
        return json(400, { error: "Listener probe requires an issueKey." });
      }
      if (taskType === "scheduledjob" && !manual
        && (typeof body.scheduledFor !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/.test(body.scheduledFor)
          || !Number.isFinite(Date.parse(body.scheduledFor)) || new Date(body.scheduledFor).toISOString() !== body.scheduledFor)) {
        return json(400, { error: "Scheduled probe requires scheduledFor as an exact UTC minute." });
      }
      try {
        const mod = taskType === "listener" ? await import("./listeners.js") : await import("./scheduled-jobs.js");
        const rule = await (taskType === "listener" ? mod.getListener(body.ruleId) : mod.getJob(body.ruleId));
        if (!rule || rule.mode !== "script" || !rule.name.startsWith("[Harness claim]")) {
          return json(400, { error: "Probe requires a saved script rule named [Harness claim]..." });
        }
        let params; let execute;
        if (taskType === "listener") {
          const eventType = rule.events.find((e) => ["avi:jira:created:issue", "avi:jira:updated:issue"].includes(e));
          if (!eventType || rule.enabled === false) return json(400, { error: "Listener probe requires an enabled issue-created or issue-updated fixture." });
          const { default: api, route } = await import("@forge/api");
          const res = await api.asApp().requestJira(route`/rest/api/3/issue/${body.issueKey}?fields=summary,project,issuetype`);
          if (!res.ok) return json(400, { error: `Probe issue read failed: ${res.status}` });
          const event = { eventType, issue: await res.json(), selfGenerated: false };
          const { extractEventContext } = await import("./shared/jira-events.js");
          const ctx = { ...extractEventContext(eventType, event), jqlPending: Boolean(rule.filters?.jql) };
          // The fixture must satisfy the same static filters before the consumer
          // pair is invoked; no need to bypass matching just to exercise claims.
          const match = mod.matchListenerStatic(rule, ctx, event);
          if (!match.ok) return json(400, { error: `Probe fixture does not match: ${match.reason}` });
          params = { listenerId: rule.id, eventType, event, ctx };
          execute = mod.executeListenerTask;
        } else {
          if (rule.scope) return json(400, { error: "Job probe requires an unscoped fixture with explicit issue targeting." });
          if (!manual && rule.enabled === false) return json(400, { error: "Scheduled probe requires an enabled fixture." });
          params = { jobId: rule.id, manual, scheduledFor: manual ? null : body.scheduledFor };
          execute = mod.executeScheduledJobTask;
        }
        const results = await Promise.all([
          execute(params, body.taskId),
          execute(params, body.secondTaskId || body.taskId),
        ]);
        return json(200, { directConsumerProbe: true, results });
      } catch (e) {
        return json(500, { error: String((e && e.message) || e) });
      }
    }
    // Delete registry rows, optionally detaching the rules from their Jira workflows —
    // the same removeRegistryRowsCore the admin panel's Delete uses. Lets the harness
    // assert end-to-end that "delete" actually stops a rule running, and lets a
    // campaign reclaim registry slots it filled. bypassAuthz is safe here for the same
    // reason the other actions run with accountId:null — the Bearer gate above IS the
    // authorization, and this trigger returns 404 wherever HARNESS_SECRET is unset.
    // Flip a rule's disabled flag through the SAME core the resolver uses, so the
    // harness exercises the real path (including the workflow propagation that
    // conditions need) rather than poking the registry directly. A raw KVS writer
    // here would be both a dangerous primitive and a weaker test.
    if (body.action === "setDisabled") {
      try {
        const { setRuleDisabledCore } = await import("./index.js");
        const r = await setRuleDisabledCore({ id: body.id, disabled: body.disabled === true, accountId: null, bypassAuthz: true });
        return json(200, r);
      } catch (e) {
        return json(500, { error: String((e && e.message) || e) });
      }
    }
    // Invoke an allowlisted resolver through the REAL dispatcher (resolver.getDefinitions()
    // → exported `handler`), not through an extracted core: the point is to exercise the
    // resolver body's own wiring — filter args, context construction, sanitizeObject —
    // which unit tests of the pure pieces cannot reach. getConfigs also carries the
    // one-shot ownership/slim migrations, so this is how the harness fires and then
    // verifies them on live data. THE ALLOW-LIST BELOW IS THE ONLY AUTHORITY on what may
    // be driven: most of it is read-only, the mutators on it are named and justified where
    // they are listed, and this must never become a generic invoke-anything bridge. The
    // whole trigger is dev/staging only — the HARNESS_SECRET Bearer gate at the top of this
    // handler 404s wherever the variable is unset, which is every production deployment —
    // and a driver that calls a mutator MUST restore what it changed in the same run.
    if (body.action === "invokeResolver") {
      // Read-only registry keys + the Listener / Scheduled Job / API-token resolvers (the
      // harness drives the admin-panel resolver layer — permission gates, payload shapes —
      // that the Rules REST API bypasses). Still an allowlist, never invoke-anything.
      const ALLOWED_KEYS = new Set(["getConfigs", "getKnowledgeCounts",
        "getListeners", "getListener", "saveListener", "deleteListener", "setListenerEnabled", "testListener", "getEventSample",
        "getScheduledJobs", "getScheduledJob", "saveScheduledJob", "deleteScheduledJob", "setScheduledJobEnabled", "runScheduledJobNow", "previewSchedule",
        "getApiTokens", "createApiToken", "revokeApiToken", "getAsyncTaskResult", "getLogs", "checkIsAdmin",
        "getAiBudget", "saveAiBudget", "getAsyncJobs",
        // HARNESS-ONLY (release 1.3 editions proof): the edition/model/usage resolvers.
        "checkLicense", "getProvider", "getOpenAIModels", "saveOpenAIModel", "getOpenAIModelFromKVS",
        "getAgentModel", "saveAgentModel", "getAiUsage", "resetAiUsage", "checkProviderHealth", "reviewConfig",
        // F-163 — the MEMORY store resolvers. The F-155..F-161 behaviour (dedup/merge, the
        // veto delete, the eviction policy and the at-cap rejection) lives in resolvers that
        // no other hook path could reach, so it could only ever be proven offline. These are
        // WRITES, deliberately: they exist to prove the memory store live, and they are behind
        // the same HARNESS_SECRET Bearer gate (absent in production) as everything else here.
        "getMemories", "addMemory", "updateMemory", "deleteMemory", "getMemorySettings", "saveMemorySettings",
        // F-189 — read-only: what the store weighs against both ceilings.
        "getMemoryStoreStats",
        // F-253 — read-only knowledge/read surfaces, here to prove TWO things live that no
        // other hook path can reach. (1) The VIEWER FLOOR (F-235): a viewer-role account must
        // still get docs, skills, skill content, knowledge counts and logs — these resolvers
        // are the floor, so a regression that over-tightens requireRole shows up as a denial
        // here rather than in a UI nobody scripts. (2) The explainRule OWNER ASYMMETRY: the
        // same rule read by its owner and by a non-owner must differ in what canActOnConfig
        // permits, which only a two-accountId invocation can demonstrate.
        // getKnowledgeCounts and getLogs are already allowlisted above; listed here in the
        // comment only, not re-added — one entry, one home.
        "getContextDocs", "getSkills", "getSkillContent", "explainRule",
        /* ── F-637 / F-638 — THE FIVE KNOWLEDGE/PROVIDER DOORS THAT HAD NO LIVE ARM. ─────
         * Each of these was refused BY NAME (`functionKey not allowlisted: …`), so five
         * shipped fixes could be proven offline and nowhere else. The hook is the right
         * instrument for all five because it is the only path that can choose the CALLING
         * PRINCIPAL (`body.accountId` → `principal.accountId` on the handler call below),
         * and every one of these findings is about WHO the door answers.
         *
         * THREE OF THEM ARE MUTATORS (`saveSkill`, `deleteSkill`, `deleteContextDoc`).
         * They are admitted on the same terms as `saveListener`/`deleteScheduledJob`/
         * `addMemory` above and no wider: this whole trigger is DEV/STAGING ONLY — it is
         * gated by the `HARNESS_SECRET` Bearer check at the top of this handler and 404s
         * wherever that variable is unset, which is every production deployment. They keep
         * their OWN gates (the hook bypasses nothing: a scope-"own" editor still gets the
         * `notOwner` sentence, a builtin row still asks the admin question), and A DRIVER
         * THAT CALLS THEM MUST RESTORE WHAT IT CHANGED — re-save the skill it edited,
         * re-seed the doc it deleted — in the same run, in a `finally`.
         *
         * NOT WIDENED BY ANY OF THIS: every deploy/dispatch key stays out. `setupGitPipeline`
         * is still absent, `triggerGitDeploy` is still reachable ONLY through the F-627
         * outdated-only wrapper below, and the Coder write doors are still forced to
         * simulation. A knowledge door is not a precedent for a door that touches a
         * customer's repository.
         *
         *   saveSkill            — F-622: the unknown-id arm must answer the same sentence
         *                          a colleague's skill does, for a scope-"own" editor.
         *   deleteSkill          — F-624: the same existence parity on the destructive twin.
         *   deleteContextDoc     — F-625: the same existence parity on the docs delete.
         *   getContextDocContent — F-626: the viewer floor on the doc CONTENT reader, which
         *                          had no gate of any kind.
         *   getOpenAIKey         — F-629/F-633: the only consumer of the `armKeyReadFault`
         *                          lever, and the door F-633 put a viewer floor on. It
         *                          returns `hasKey`/`isByok` booleans and a base URL — never
         *                          key material — and the fault lever it reads is itself
         *                          inert without HARNESS_SECRET.
         */
        "saveSkill", "deleteSkill", "deleteContextDoc", "getContextDocContent", "getOpenAIKey",
        /* F-655 — `searchUsers`, on exactly the same terms as the five above and for the
         * same reason: F-648 made it fail CLOSED for the whole Jira transport class
         * (`reason:"jira_unavailable"`, kept distinct from the F-257 admin refusal), and
         * neither that arm nor the ORDER of the admin gate above it could be exercised on
         * a tenant — the key was refused by name here, and nothing made Jira's user search
         * fail. The `armJiraFault` action above is the other half of that door.
         *
         * READ-ONLY. It grants nothing: it forwards a query string to Jira's own
         * `/rest/api/3/user/search` as the app and returns accountId / displayName /
         * avatar / (when Jira discloses it) email — strictly less than `getAppAdmins`,
         * already allowlisted, and it writes nothing. It keeps its OWN admin gate, which
         * is half of what is worth testing: driven with a non-admin `body.accountId` it
         * must answer the refusal, and it must do so BEFORE the fault lever is consulted. */
        "searchUsers",
        // F-566 — the knowledge-pack surfaces. `getKnowledgePacks` is a pure READ of the
        // generated index (titles, tags, sizes, budgets — never a pack BODY), the same
        // class as `getKnowledgeCounts` above. `saveKnowledgeSettings` is a WRITE and is
        // admitted deliberately: "the packs are opt-out" is a product claim, and with the
        // resolver closed to the harness the disable path had no live proof on any build —
        // a tester could read the settings row through `?what=kvs` and never write it.
        // It keeps its OWN admin gate (requireAdmin) — the hook does not bypass it, so a
        // harness driving it with a non-admin accountId still gets the refusal, which is
        // half of what is worth testing. It plants no credential, calls no model and
        // writes nothing outside this instance's own settings row; the clamp in
        // `saveKnowledgeSettings` runs before the write, so a phantom pack id cannot be
        // stored through here either.
        "getKnowledgePacks", "saveKnowledgeSettings",
        // 1.5 commit 5b — the Virtual Administrator READ surfaces, so a live pass can
        // prove the permission floors and the answer shapes on real data: the editor
        // floor on listVaAgents/getVaStatus and the ADMIN floor on the three below.
        // DELIBERATELY ABSENT, and this is the same line the git resolvers draw:
        // saveVaMemory, approveVaDraft, rejectVaDraft, pauseVa, resumeVa, runVaTickNow
        // and runVaPostNow. Every one of those either changes a live automation or
        // moves a human's verdict onto a message queued for a real customer, and a
        // harness that can run a VA tick is a harness that can be turned into one.
        // `vaWizardStep` is also absent: it CREATES an agent and it calls a model.
        "listVaAgents", "getVaStatus", "listVaDrafts", "listVaEffects", "getVaMemory",
        // F-608 — `getVaRecentPurges` joins them on the same terms: it is a READ over
        // F-595's purge tombstones (which agents wrote to Jira while being deleted), it
        // takes no id, it changes nothing and it clears nothing — `clearPurgeTombstone`
        // stays the only authority on whether a tombstone may go, and it is not here.
        "getVaRecentPurges",
        // 1.4 commit 2 — the git-connection READ surfaces only, so a live pass can
        // prove the admin gate and the "a resolver never returns a token" contract
        // on real data. DELIBERATELY ABSENT: saveGitConnection, deleteGitConnection,
        // saveForgeIdentity, clearForgeIdentity, rotateGitCredential. A harness that
        // can plant or destroy a credential is a harness that can be turned into
        // one, and a planted token would then exist on a real tenant — so the write
        // side is driven by a human admin in the UI, never from here. F-339 does NOT
        // relax this: the `plantHookSecret` action can plant a TOKENLESS stand-in row
        // (status "harness", no secret key, one repo) so the inbound path is provable,
        // and `deleteHarnessConnection` refuses anything else — the resolvers stay out. The kvSet
        // allow-list below is NOT widened for `git_conn:*` / `git_conn_secret:*`
        // for the same reason: secrets are never plantable.
        // `testGitConnection` is here despite writing the whoami verdict back to the
        // row: that WRITE is the thing under test (the auth_dead banner has one
        // source), it creates no credential, and it cannot delete one.
        "listGitConnections", "testGitConnection", "getForgeIdentityStatus",
        /* F-762 — `listGitWebhooks`, a READ, admitted ONLY THROUGH THE MASKING
         * PROJECTION below. It was refused by name, so the F-481 rotation banner
         * (`hookState:"rotation-failed"`) could only ever be read live through
         * `listGitConnections` — our own record — and never against what the PROVIDER
         * actually has on the repo, which is the whole reason the resolver exists.
         *
         * IT CARRIES NO SECRET: the signing secret is absent from every return value in
         * src/git-connections.js (including the error paths), and `recorded` is
         * `publicWebhooks()` — hookId/provider/createdAt/rotatedAt/hookState only.
         * BUT IT DOES CARRY `hooks[].url`, AND THAT URL IS A CAPABILITY: it is this
         * installation's `gitWebhook` webtrigger URL, whose path token is unguessable and
         * is the only thing standing between the open internet and our inbound delivery
         * path. HMAC verification means a leaked URL cannot forge a delivery, which is why
         * this is a masking and not a refusal — but a dev hook that prints it into a
         * harness log has published it, and that is not a ceiling, so the raw url NEVER
         * leaves this handler. The masked projection keeps everything the banner and the
         * identity check need (host, the `conn`/`repo` routing the caller already knows,
         * and a stable fingerprint two hooks can be compared by) and drops the token.
         *
         * F-769 — AND THE THREE DOCTRINES IN THIS FILE ARE NOW ONE. For a while they
         * contradicted each other on the same surface: the WRITE refused a body that so
         * much as mentioned a credential (`findPlantedSecret`); THIS resolver had its url
         * masked on the reasoning just above; and the GET `?what=kvs` READ, one query
         * string away, handed out `COGNIRUNNER_KEY_*`, `git_conn_secret:*`,
         * `git_hook_secret:*` and `webtrigger_url:*` in plain text — the signing secret
         * that makes the masked url above merely inconvenient to lose. The read now
         * carries the same ceiling, through the same projection pattern: a
         * credential-family key (`isCredentialKey`, ONE HOME near `findPlantedSecret`)
         * answers `{present, fingerprint, masked:true}` and never the value.
         *
         * THE RULE, stated once so it stops being re-derived per door: WHICH rows this
         * hook may reach is a question each door answers for itself (the read answers
         * "all of them", and that is unchanged and not up for revision). WHAT a credential
         * row may say on the way out is NOT a per-door question — it is `present`, a
         * fingerprint, and nothing else, at every door, in both directions. A driver that
         * needs the value MOVED rather than SEEN has `kvStash`/`kvRestore`. */
        "listGitWebhooks",
        // 1.4 commit 7 — the pipeline READ. `git_pipeline:*` rows are also reachable
        // through the GET `?what=kvs` read (deliberately unrestricted: it is a read,
        // behind HARNESS_SECRET), which is how a tester confirms the bounded row landed
        // on the exact slot. DELIBERATELY ABSENT: setupGitPipeline — it pushes the deploy
        // credential into a customer's repository and commits to it, and a harness that
        // can do that is a harness that can be turned into one.
        //
        // F-627 — `triggerGitDeploy` IS here now, and ONLY through the outdated-only
        // wrapper below. The sentence above has not been relaxed: what changed is that
        // the hook can no longer ask for a deploy that would actually be DISPATCHED.
        // `triggerPipelineDeploy` refuses an outdated row with `pipeline_outdated` BEFORE
        // it touches the provider (src/git-pipeline.js), so the wrapper admits the call
        // only when the stored row is outdated by the product's own predicate — the
        // resolver is then exercised for real and the one thing it can reach is a
        // refusal. F-611 is the reason it had to be reachable at all: the fix lives in
        // the resolver, and the Code tab's button (F-602) is the half a reader sees.
        //
        // The kvSet allow-list below is still NOT widened for `git_pipeline:*` — the
        // F-627 `pipelineRow` action is the door, and it is a CLAMPED plant that can
        // never write `lockHash`/`lockScopes`, which is the permission-lock objection the
        // old wording recorded here.
        "getGitPipelineStatus", "triggerGitDeploy",
        // 1.4 commit 8 — the Coder thread READ only, so a live pass can prove the owner
        // asymmetry (owner sees the thread, another editor is refused with `not-owner`)
        // on a real row. DELIBERATELY ABSENT: startCoderTurn and confirmCoderTicket. The
        // first spends a frontier model's tokens on somebody's tenant; the second is the
        // one door between a model's request and a write to a customer's repository, and
        // a harness that can walk through it is a harness that can be turned into one.
        // The kvSet allow-list below is NOT widened for `coder_thread:*` / `coder_ticket:*`
        // either: a plantable ticket is a plantable CONSENT, which is the fact the whole
        // confirm flow depends on. (`?what=kvs` still READS those rows — a read behind
        // HARNESS_SECRET is how a tester confirms the thread landed.)
        // F-387 — the CAPABILITY READ joins them. `getAgentCapability` answers "may the
        // Coder run on this instance, and if not why" from the same facts the gate uses.
        // It is a pure READ (no write, no model call, no token spend), the same class as
        // `getProvider`/`getAgentModel` above, and it was absent by omission rather than by
        // the policy stated in the paragraph above: with it closed, the refusal a Standard
        // tenant actually emits could only ever be DERIVED, never observed.
        "getAgentCapability",
        // F-387 — the two WRITE doors, admitted ONLY through the forced-simulation wrapper
        // below. The paragraph above still holds and is not relaxed: what changed is that
        // the harness can no longer ask for a LIVE turn at all. `startCoderTurn` is rewritten
        // to `simulation:true` whatever the payload says, and `confirmCoderTicket` is refused
        // unless the ticket it answers belongs to a thread that is itself simulated — so no
        // write to a customer's repository can be planted through this hook, which is the
        // property the original exclusion was protecting. A frontier model's tokens are still
        // spent by a simulated turn; that is a COST, not a write, and it is bounded by the
        // same HARNESS_SECRET gate as everything else here.
        "startCoderTurn", "confirmCoderTicket",
        "getCoderThread"]);
      const functionKey = body.functionKey || body.name;
      if (!ALLOWED_KEYS.has(functionKey)) {
        return json(400, { error: `functionKey not allowlisted: ${functionKey}` });
      }
      /* ── F-387 — THE FORCED-SIMULATION WRAPPER. ───────────────────────────────────────
       * The hook may drive the Coder, but it may never drive it LIVE.
       *   startCoderTurn      → `simulation` is OVERWRITTEN with true. The payload cannot
       *                         ask for a live turn; the engine fixes the mode from the
       *                         thread's FIRST turn (F-360), so the whole thread is
       *                         simulated from here on.
       *   confirmCoderTicket  → the payload has no say in the mode at all (F-360 again:
       *                         the thread row is the authority), so the check is on the
       *                         ROW: the ticket must be simulated, and so must the thread
       *                         it belongs to. Anything else is refused here, before the
       *                         resolver, with the reason named.
       * A refusal is a 400 with `harnessRefusal`, never a silent pass — a harness that
       * quietly does something other than what it was asked is worse than one that stops. */
      let hookPayload = body.payload || {};
      if (functionKey === "startCoderTurn") {
        hookPayload = { ...hookPayload, simulation: true };
      } else if (functionKey === "confirmCoderTicket") {
        const { coderTicketKey, coderThreadKey } = await import("./coder-engine.js");
        const ticketId = String(hookPayload.ticketId || "");
        let ticket = null;
        try { ticket = await storage.get(coderTicketKey(ticketId)); } catch (e) { ticket = null; }
        if (!ticket || typeof ticket !== "object") {
          return json(400, { error: "harnessRefusal: no such Coder ticket — the hook will not answer a ticket it cannot read", harnessRefusal: "ticket-unreadable" });
        }
        let thread = null;
        try { thread = await storage.get(coderThreadKey(ticket.issueKey, ticket.threadId)); } catch (e) { thread = null; }
        // BOTH rows must say simulated. A missing thread row is NOT a licence: unknown is
        // refused, the same direction every other gate in this app fails.
        if (ticket.simulation !== true || !thread || thread.simulation !== true) {
          return json(400, {
            error: "harnessRefusal: the hook only answers a ticket on a SIMULATED thread — a live confirm writes to a customer's repository",
            harnessRefusal: "not-simulated",
            ticketSimulation: ticket.simulation === true,
            threadSimulation: thread ? thread.simulation === true : null,
          });
        }
      } else if (functionKey === "triggerGitDeploy") {
        /* ── F-627 — THE OUTDATED-ONLY WRAPPER. ─────────────────────────────────────
         * Same shape and same reason as the forced-simulation wrapper above: the hook may
         * drive this resolver, but it may never drive it into a REAL dispatch. A deploy
         * on a current row starts CI on a customer's repository; a deploy on an OUTDATED
         * row is refused by `triggerPipelineDeploy` with `pipeline_outdated` before the
         * provider is touched at all, and that refusal is the whole of F-611.
         *
         * So the row is read HERE and asked `pipelineOutdated` — the product's own
         * predicate from src/shared/git-pipeline-state.js, never a restatement — and
         * anything else is refused before the resolver runs. A row that cannot be read is
         * refused too: unknown is not a licence, the same direction every gate here fails. */
        const { readPipelineRow } = await import("./git-pipeline.js");
        const { pipelineOutdated } = await import("./shared/git-pipeline-state.js");
        let row = null;
        try { row = await readPipelineRow(hookPayload.connectionId, hookPayload.repo); } catch (e) { row = null; }
        if (!row || !pipelineOutdated(row)) {
          return json(400, {
            error: "harnessRefusal: the hook only triggers a deploy on an OUTDATED pipeline row — any other row would be dispatched for real against a customer's repository",
            harnessRefusal: "not-outdated",
            hasRow: Boolean(row),
            outdated: pipelineOutdated(row),
          });
        }
      }
      try {
        const { handler } = await import("./index.js");
        // HARNESS-ONLY: checkLicense reads context.license, which the platform supplies on a
        // real resolver invocation. A webtrigger's getAppContext() carries the SAME license
        // object (verified live), so forwarding it makes the hook a faithful stand-in.
        let hookLicense;
        try { const { getAppContext } = await import("@forge/api"); hookLicense = getAppContext()?.license; } catch (e) { hookLicense = undefined; }
        const r = await handler(
          { call: { functionKey, payload: hookPayload }, context: {} },
          { principal: body.accountId ? { accountId: body.accountId } : undefined, license: hookLicense },
        );
        /* F-762 — THE MASKING PROJECTION, on the way OUT. The resolver answers with the
         * provider's real hook urls; this hook may not repeat them (see the allow-list
         * note above). Built field by field, never a spread-and-delete, so a new field on
         * a hook object is absent here until someone decides it may be shown. */
        if (functionKey === "listGitWebhooks" && r && Array.isArray(r.hooks)) {
          /* F-780 — the fingerprint comes from `credentialFingerprint`, the ONE home, so a
             driver can compare this URL's fingerprint with the one `?what=kvs` answers for
             `webtrigger_url:*`. This door used to hash the raw string while that one hashed
             `JSON.stringify` of it, which made that comparison always report a change. */
          const maskUrl = async (u) => {
            const raw = String(u || "");
            if (!raw) return null;
            let host = null;
            let conn = null;
            let repo = null;
            try {
              const parsed = new URL(raw);
              host = parsed.host || null;
              conn = parsed.searchParams.get("conn");
              repo = parsed.searchParams.get("repo");
            } catch (e) { /* an unparseable url is masked to nothing but its fingerprint */ }
            return {
              host,
              // The routing the CALLER already supplied — disclosing it back discloses nothing.
              conn,
              repo,
              // Stable across calls, so two hooks can be compared for identity; one-way,
              // so it can never be turned back into the trigger token.
              fingerprint: await credentialFingerprint(raw),
            };
          };
          const masked = await Promise.all(r.hooks.map((h) => maskUrl(h && h.url)));
          return json(200, {
            ...r,
            hooks: r.hooks.map((h, i) => ({
              hookId: h && h.hookId != null ? String(h.hookId) : null,
              events: h && Array.isArray(h.events) ? h.events.slice() : [],
              active: !(h && h.active === false),
              // `url` is DELIBERATELY ABSENT, not nulled: an absent field cannot be
              // mistaken for "the provider had no url on this hook".
              urlMasked: masked[i],
            })),
            urlsMasked: true,
          });
        }
        return json(200, r);
      } catch (e) {
        return json(500, { error: String((e && e.message) || e) });
      }
    }
    // HARNESS-ONLY (release 1.3 editions proof): seed/restore a narrow set of config slots
    // that no resolver can write on a Standard tenant (the whole point of the gate under test).
    // Key allowlist — never a generic KVS write bridge.
    if (body.action === "kvSet") {
      // F-126 — the provider slots are here so the harness can PLANT A PROVIDER FAULT and
      // prove the fail-OPEN contract LIVE: clear COGNIRUNNER_AI_PROVIDER (or a BYOK key
      // slot) and a validator/condition must still let the transition through, the health
      // banner must say "no provider" and the consumer's budget gate must fail the
      // listener/job closed. Those three 1.3 items cannot be proven any other way — no
      // resolver writes these slots on a tenant, which is the whole point of the gate.
      // The slot NAMES come from src/shared/provider-slots.js — the SAME module index.js
      // builds them with. A retyped "COGNIRUNNER_KEY_openai" here would silently rot the
      // day a helper changes, which is the defect class this repo keeps paying for.
      // Still an allowlist, never a generic KVS write bridge, and still behind
      // HARNESS_SECRET (absent in production, checked at the top of this handler).
      // F-163 — the memory store + its settings, so the harness can SEED a 200-row fixture
      // (an all-user store, a mixed store) and restore it afterwards. No resolver can plant a
      // store at the cap, which is exactly the state the F-160 eviction policy and the F-161
      // at-cap rejection are about. F-174 — plus the store-full MARKER, so a test that
      // drives the banner can back it up and restore it (constant imported, never retyped).
      // F-566 — the knowledge-pack SETTINGS row (a settings key, never a secret), so a
      // driver can back up the instance's pack switches before it flips them and put them
      // back afterwards. The resolver alone cannot do that: it clamps to the known pack
      // ids, which is right for a product surface and wrong for a restore.
      // F-769 — the list itself moved to `kvWriteAllowList()` (module scope) so the
      // `kvStash`/`kvRestore` door below is bounded by the SAME authorisation and cannot
      // reach a row `kvSet` may not write. One home; the reasoning above is its docblock.
      const KEYS = kvWriteAllowList();
      /* F-742 — THE SHAPE IS ASKED BEFORE THE ALLOW-LIST, and before the platform.
       * Key shape first: a non-string key cannot be looked up in a Set of strings in any
       * meaningful way, and `key not allowlisted: [object Object]` is a worse answer than
       * "key must be a string". Then the allow-list, which is the AUTHORISATION question
       * and is untouched by this door. Then the value.
       *
       * THE SIBLING CENSUS (every other door in this file that forwards a body toward
       * storage, read before this was cut): `pipelineRow` plant and `vaTombstone`
       * plant/age build their rows FIELD BY FIELD from an allow-list, each field regexed,
       * clamped or `String(...).slice(...)`-bounded, and their keys are built by
       * `gitPipelineKey`/`vaPurgedKey` from an id this file has already validated — they
       * do NOT share the gap, so they do not get this door. `plantHookSecret` likewise
       * regexes all three inputs before composing its key. There are no `kvGet`/`kvDelete`
       * actions; the READ is the GET `?what=kvs`, whose key comes straight off the query
       * string — that one DOES share the key half, and takes `kvsKeyRefusal` below. */
      const keyBad = kvsKeyRefusal(body.key);
      if (keyBad) return json(400, keyBad);
      if (!KEYS.has(body.key)) return json(400, { error: `key not allowlisted: ${body.key}` });
      // `null` is this door's spelling of "delete", so it is allowed — `undefined`
      // (a body that simply omitted `value`) is the case that used to reach the platform.
      const valueBad = kvsValueRefusal(body.value, { allowNull: true });
      if (valueBad) return json(400, valueBad);
      if (body.value === null) await storage.delete(body.key);
      else await storage.set(body.key, body.value);
      // F-769 — `now` is the caller's OWN value read back (or null after a delete), never
      // a row this door did not just write, so it discloses nothing the caller did not
      // send. A credential slot is nevertheless answered by fingerprint, so that "what
      // this door says about a credential row" has one shape wherever it is said.
      const now = (await storage.get(body.key)) ?? null;
      const set = body.value === null ? "deleted" : true;
      // F-794 — and the FIELD ceiling for the same reason, in the same shape. This echo is
      // the caller's own value, so it discloses nothing new TODAY; it takes the mask so
      // that "what this door says about a secret-carrying row" has ONE shape in both
      // directions and a driver never learns to read a field here that the GET masks.
      // F-806 — and it takes it from `storedFields`, not from its own second copy of the
      // credential-key/field-mask pair, which is what this door carried until now.
      return json(200, { key: body.key, set, ...(await storedFields("now", body.key, now)) });
    }
    /* F-769 — the two halves of the stash door; see its docblock at `kvWriteAllowList`. */
    if (body.action === "kvStash" || body.action === "kvRestore") {
      if (body.action === "kvStash") {
        const keyBad = kvsKeyRefusal(body.key);
        if (keyBad) return json(400, keyBad);
        if (!kvWriteAllowList().has(body.key)) return json(400, { error: `key not allowlisted: ${body.key}` });
        const stored = (await storage.get(body.key)) ?? null;
        const stashId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        const row = { key: body.key, value: stored, present: stored !== null, stashedAt: new Date().toISOString() };
        // The TTL OPTION SHAPE has one home (`{ttl:{value,unit}}` — the `{ttlSeconds}` form
        // is silently ignored by @forge/kvs), and so does the NUMBER: the hour this asks for
        // is the hour `sweepHarnessStashes` reaps at. Imported the way every other
        // harness-fault use in this file does, so production loads none of it.
        const { faultTtlOption, harnessStashKey, HARNESS_STASH_MAX_AGE_SECONDS } = await import("./harness-fault.js");
        const stashRowKey = harnessStashKey(stashId);
        /* F-779 — FAIL CLOSED. A stash with no expiry is a plaintext credential living
         * forever under a key the read door masks; answering 200 for one and CLAIMING an
         * hour of TTL is a cause asserted that the write did not contain. So a refused TTL
         * is a refused STASH: delete whatever landed, say so, and let the driver abort
         * BEFORE it plants the fault it would no longer be able to undo. `ttlSeconds` below
         * is the value that was actually applied, reachable only on the path that applied it.
         *
         * F-789 — AND THE REFUSAL MUST NOT ASSERT A CAUSE THE FAILURE DID NOT CONTAIN.
         * `error` was the literal `"stash-ttl-unavailable"` for ANY throw: a 429, a
         * value-too-large, a transient platform error all told the driver the one thing
         * F-779 had named, and an operator reading it reworks a TTL that was never the
         * problem. The class decides now — a code or name that says TTL is a TTL refusal,
         * anything else is `stash-write-failed` — and `reason` still carries the class
         * itself, so a caller is never limited to our two-way split.
         *
         * THE COMPENSATION IS REPORTED, TOO. The delete of whatever partially landed had an
         * empty catch, so a failed delete was indistinguishable from a clean one — while
         * this file's own sibling idiom (`deleteErrorClass`, in the comment-probe) reports
         * exactly that. A partial PLAINTEXT row that could not be deleted is the F-779 harm
         * happening inside F-779's own fix, so it is named, and the `stashId` comes back
         * with it: without the id, the row is reachable only by `stashSweep` and only after
         * its age floor, and a 424 that withholds it makes a manual clear impossible. */
        let appliedTtlSeconds;
        try {
          await storage.set(stashRowKey, row, faultTtlOption(HARNESS_STASH_MAX_AGE_SECONDS));
          appliedTtlSeconds = HARNESS_STASH_MAX_AGE_SECONDS;
        } catch (e) {
          const errorClass = errorClassOf(e);
          let compensation = "deleted";
          try { await storage.delete(stashRowKey); } catch (de) { compensation = `delete-failed:${errorClassOf(de)}`; }
          return json(424, {
            ok: false, stashed: false,
            error: STASH_TTL_ERROR_CLASS_RE.test(errorClass) ? "stash-ttl-unavailable" : "stash-write-failed",
            key: body.key, reason: errorClass,
            // The id of the row the failed write was aimed at — the only handle on a
            // partial row when the compensation could not remove it.
            stashId, compensation,
          });
        }
        return json(200, {
          ok: true, stashed: true, stashId, key: body.key,
          ...(await answerFingerprintOnly(stored)),
          ttlSeconds: appliedTtlSeconds,
        });
      }
      // kvRestore — by NAME. The value is never named, sent or returned.
      if (typeof body.stashId !== "string" || body.stashId.length === 0) {
        return json(400, { ok: false, error: "bad-request", field: "stashId", reason: "stashId must be a non-empty string" });
      }
      const { harnessStashKey } = await import("./harness-fault.js");
      const row = (await storage.get(harnessStashKey(body.stashId))) ?? null;
      if (!row || typeof row !== "object" || typeof row.key !== "string") {
        // A stash that expired is indistinguishable from one that never existed, and the
        // driver must treat both the same way: it no longer holds the tenant's row.
        return json(404, { ok: false, error: "no such stash (unknown id, or its TTL ran out)", stashId: body.stashId });
      }
      // The allow-list is asked AGAIN on the way out. A row stashed before a list change
      // must not become a write door for a key the list no longer admits.
      if (!kvWriteAllowList().has(row.key)) return json(400, { error: `key not allowlisted: ${row.key}` });
      if (row.present === true) await storage.set(row.key, row.value);
      else await storage.delete(row.key);
      try { await storage.delete(harnessStashKey(body.stashId)); } catch { /* the restore is the contract, not the sweep */ }
      const now = (await storage.get(row.key)) ?? null;
      return json(200, {
        ok: true, restored: true, key: row.key,
        // The SAME fingerprint the stash answered, when the round trip was byte-identical.
        ...(await answerFingerprintOnly(now)),
      });
    }
    /* ═════════════════════════════════════════════════════════════════════════════
     * F-639 — `knowledgeSnapshot` / `knowledgeRestore`: THE RESTORE DUTY BECOMES A LEVER.
     *
     * The six knowledge MUTATORS on the `invokeResolver` allow-list were admitted with a
     * written duty attached — restore what you changed, in the same run, in a `finally`.
     * That duty has no mechanism: a driver that deletes a builtin doc and throws before
     * its `finally`, or is killed, or runs out of budget, leaves the tenant changed and
     * nothing in this file knows. `kvStash`/`kvRestore` answered the identical problem for
     * credentials (F-769/F-779); this is the same answer for the knowledge store, built on
     * the same rows, the same TTL, the same sweeper and the same refusals.
     *
     * WHAT IT ANSWERS, AND WHAT IT NEVER DOES. `{snapshotId, keys, count, presentCount,
     * fingerprint}`. Not the rows. A skill body, a doc body and a listener config are the
     * tenant's own writing, and the read ceiling's rule — what a door says about a stored
     * row is `present`, a fingerprint and nothing else — is not suspended because the row
     * is not a credential. The fingerprint is what makes the round trip PROVABLE: the
     * snapshot's digest of the stored rows and the restore's digest of the rows that are
     * now back must be the same string, which is strictly more than a driver comparing
     * what it remembered.
     *
     * THE CAP IS CHECKED BEFORE THE SIDE EFFECT, and that is the `commitImportCore` lesson
     * rather than a style choice: the snapshot row is measured against the KVS value
     * ceiling (`kvsValueRefusal`, the one home) BEFORE it is written, so a driver learns
     * "your snapshot is 300 KiB" instead of planting its mutation and discovering at
     * restore time that nothing was ever saved.
     *
     * THE TTL FAILS CLOSED, exactly as F-779 left the stash: a snapshot that could not be
     * given an expiry is a REFUSED snapshot — whatever landed is deleted, the compensation
     * is reported, and the driver aborts BEFORE it makes the change it could no longer
     * undo. Same error classes, same 424, same `snapshotId` handed back so a row the
     * compensation could not remove still has a handle.
     *
     * SINGLE USE. A successful restore deletes the snapshot row, so a second restore of
     * the same id is a 404 — the same sentence an expired one gets, because a driver must
     * treat both the same way: it no longer holds the tenant's rows.
     * ════════════════════════════════════════════════════════════════════════════ */
    if (body.action === "knowledgeSnapshot" || body.action === "knowledgeRestore") {
      // The one home for the option SHAPE, the TTL NUMBER and the key builder — the same
      // three the stash uses, because these rows ARE stash-family rows (see the families
      // docblock). Imported the way every other harness-fault use in this file is.
      const { faultTtlOption, harnessStashKey, HARNESS_STASH_MAX_AGE_SECONDS } = await import("./harness-fault.js");
      const snapshotRowKey = (id) => harnessStashKey(`${KNOWLEDGE_SNAPSHOT_ID_PREFIX}${id}`);
      if (body.action === "knowledgeSnapshot") {
        const wanted = [];
        if (!Array.isArray(body.keys) || body.keys.length === 0) {
          return json(400, badRequest("keys", "keys must be a non-empty array of knowledge row names"));
        }
        if (body.keys.length > KNOWLEDGE_SNAPSHOT_MAX_KEYS) {
          return json(400, badRequest("keys", `at most ${KNOWLEDGE_SNAPSHOT_MAX_KEYS} keys per snapshot (got ${body.keys.length})`));
        }
        for (const k of body.keys) {
          // Shape first, then authorisation — the F-742 order, for the F-742 reason: a
          // non-string key cannot be judged against a family in any meaningful way.
          const keyBad = kvsKeyRefusal(k);
          if (keyBad) return json(400, keyBad);
          if (!(await isKnowledgeKey(k))) {
            const families = await knowledgeKeyFamilies();
            return json(400, { ok: false, error: "key is not a knowledge row", key: k, families: [...families.exact, ...families.prefixes].sort() });
          }
          if (!wanted.includes(k)) wanted.push(k);
        }
        const rows = [];
        for (const k of wanted) {
          const v = (await storage.get(k)) ?? null;
          rows.push({ key: k, value: v, present: v !== null });
        }
        const row = { kind: KNOWLEDGE_SNAPSHOT_KIND, keys: wanted, rows, stashedAt: new Date().toISOString() };
        /* THE CAP, BEFORE THE SIDE EFFECT. `kvsValueRefusal` is the one home for "will the
           platform take this value", and a size in bytes is a measurement rather than a
           disclosure, so the reason may carry it. Refusing here is what keeps a driver from
           mutating first and finding out second. */
        const tooBig = kvsValueRefusal(row);
        if (tooBig) return json(400, { ...tooBig, error: "snapshot-too-large", keys: wanted });
        const snapshotId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        let appliedTtlSeconds;
        try {
          await storage.set(snapshotRowKey(snapshotId), row, faultTtlOption(HARNESS_STASH_MAX_AGE_SECONDS));
          appliedTtlSeconds = HARNESS_STASH_MAX_AGE_SECONDS;
        } catch (e) {
          const errorClass = errorClassOf(e);
          let compensation = "deleted";
          try { await storage.delete(snapshotRowKey(snapshotId)); } catch (de) { compensation = `delete-failed:${errorClassOf(de)}`; }
          return json(424, {
            ok: false, snapshot: false,
            error: STASH_TTL_ERROR_CLASS_RE.test(errorClass) ? "snapshot-ttl-unavailable" : "snapshot-write-failed",
            keys: wanted, reason: errorClass, snapshotId, compensation,
          });
        }
        /* The digest comes from the SAME named projection the stash uses, so the POST gate
           can see that the read was answered on purpose. Its `present` is dropped: on an
           ARRAY of rows it is always true and would say nothing — `presentCount` is the
           honest form of the same fact, and it is a count, never a content. */
        const { fingerprint } = await answerFingerprintOnly(rows);
        return json(200, {
          ok: true, snapshot: true, snapshotId, keys: wanted, count: wanted.length,
          presentCount: rows.filter((r) => r.present).length,
          fingerprint, ttlSeconds: appliedTtlSeconds,
        });
      }
      // knowledgeRestore — by ID. The rows are never named on the wire, sent or returned.
      if (typeof body.snapshotId !== "string" || body.snapshotId.length === 0) {
        return json(400, badRequest("snapshotId", "snapshotId must be a non-empty string"));
      }
      const stored = (await storage.get(snapshotRowKey(body.snapshotId))) ?? null;
      /* `kind` is what keeps the two doors from being crossed: a `kvStash` row has a
         `key` and no `kind`, so it is answered here exactly as an unknown id is — and a
         snapshot id handed to `kvRestore` has no `row.key` and gets that door's 404. */
      if (!stored || typeof stored !== "object" || stored.kind !== KNOWLEDGE_SNAPSHOT_KIND || !Array.isArray(stored.rows)) {
        // Expired, consumed and never-existed are ONE answer: the driver no longer holds
        // the tenant's rows, and there is nothing it should do differently for each.
        return json(404, { ok: false, error: "no such snapshot (unknown id, already restored, or its TTL ran out)", snapshotId: body.snapshotId });
      }
      // The families are asked AGAIN on the way out, for F-769's reason: a row snapshot
      // before a families change must not become a write door for a key no longer admitted.
      for (const r of stored.rows) {
        if (!r || !(await isKnowledgeKey(r.key))) return json(400, { ok: false, error: "key is not a knowledge row", key: r && r.key, snapshotId: body.snapshotId });
      }
      for (const r of stored.rows) {
        if (r.present === true) await storage.set(r.key, r.value);
        else await storage.delete(r.key);
      }
      // Single use. The restore is the contract, not the sweep — and `stashSweep` reaps
      // the row by age if this delete cannot.
      try { await storage.delete(snapshotRowKey(body.snapshotId)); } catch { /* swept by age */ }
      const now = [];
      for (const r of stored.rows) {
        const v = (await storage.get(r.key)) ?? null;
        now.push({ key: r.key, value: v, present: v !== null });
      }
      const { fingerprint } = await answerFingerprintOnly(now);
      return json(200, {
        ok: true, restored: true, keys: stored.keys, count: now.length,
        presentCount: now.filter((r) => r.present).length,
        // The SAME fingerprint the snapshot answered, when the round trip was byte-identical.
        fingerprint,
      });
    }
    /* ═════════════════════════════════════════════════════════════════════════════
     * F-779 — `stashSweep`: THE LEVER THAT CAN SEE, AND REAP, A LEAKED STASH ROW.
     *
     * A DEDICATED action rather than a widened `sweepHarnessFaults`, and the choice is the
     * point. The fault sweep deletes rows whose `until` has passed, read off a row shape the
     * stash does not have, and it is the one lever every driver already drains blind —
     * pointing it at a second keyspace would widen the reach of an unconditional delete to
     * rows that hold the tenant's only copy of a credential. `clearPlantedFaults` wrote that
     * rule down for exactly this case: bind the delete to a prefix nothing else writes, in
     * its own function. So this one lists and reaps `harness_stash:*` BY AGE and nothing
     * else; the reasoning and the age predicate live at `sweepHarnessStashes`.
     *
     * `dryRun` is the LIST — the thing that did not exist at all before, and the reason a
     * leaked row was not merely unswept but unseeable: `harness_stash:*` is a credential
     * family, so `?what=kvs` masks it and no other door enumerates. The rows it answers
     * carry the key, the stamp and the age, never the value.
     * ════════════════════════════════════════════════════════════════════════════ */
    if (body.action === "stashSweep") {
      const { sweepHarnessStashes, sweepCursorWellFormed, BAD_SWEEP_CURSOR_CODE } = await import("./harness-fault.js");
      const rawCursor = body.cursor;
      let cursor = null;
      if (rawCursor !== undefined && rawCursor !== null) {
        if (!sweepCursorWellFormed(rawCursor)) return json(400, { ok: false, reason: "bad-cursor" });
        cursor = rawCursor;
      }
      let r;
      try {
        r = await sweepHarnessStashes({
          dryRun: body.dryRun === true,
          // Forwarded RAW. The clamp — and the F-787 floor under it — lives in the lever
          // with the constants it bounds; a second clamp here is the second home that lets
          // the two drift, and the effective age comes back in `r.olderThanSeconds`.
          olderThanSeconds: typeof body.olderThanSeconds === "number" ? body.olderThanSeconds : undefined,
          maxMs: typeof body.maxMs === "number" ? body.maxMs : undefined,
          cursor,
        });
      } catch (e) {
        const message = String((e && e.message) || e).slice(0, 300);
        const code = (e && typeof e.code === "string" && e.code) || null;
        if (code === BAD_SWEEP_CURSOR_CODE) return json(400, { ok: false, reason: "bad-cursor", error: message });
        return json(500, { ok: false, reason: "stash-sweep-failed", code, error: message });
      }
      // Explicit for the same reason as the other two drains (F-692): this is THE finished signal.
      return json(r.ok === false ? 400 : 200, { ok: true, ...r, complete: r.complete === true });
    }
    /*
     * F-627 — THE PIPELINE-ROW DOOR, and why it had to exist.
     *
     * F-604, F-605 and F-611 are all about ONE state of a `git_pipeline:*` row — the
     * committed workflow is older than the scaffold this build installs (`outdated`), or
     * a setup run died and left "queued" behind (`stuck`). Neither state was reachable on
     * a tenant: a setup always stamps the CURRENT `SCAFFOLD_VERSION`, and there is no
     * lever that stops the `gitpipeline` consumer mid-run. So the prefilled setup form,
     * the preserved header facts, the stuck-queued banner and the `pipeline_outdated`
     * deploy refusal were render-proven and live-unprovable. This is their door.
     *
     * WHAT IT PLANTS, AND WHAT IT REFUSES TO. The row is built FIELD BY FIELD from an
     * allow-list — status, scaffold version, the two ageable timestamps, the declared
     * scaffold variables, the developer space and app ids, the branch. Everything else on
     * a real row is written as its empty value, and TWO fields are deliberately never
     * plantable at all: `lockHash` and `lockScopes`. That is the objection the old
     * comment on the invoke allow-list recorded — "a plantable row is a plantable
     * permission LOCK" — and it is answered by construction rather than by prose: this
     * door cannot state what scopes a repository's committed lock declares, so it cannot
     * talk any gate into accepting one. `findPlantedSecret` refuses the body outright if
     * it so much as names a credential.
     *
     * IT NEVER OVERWRITES A REAL ROW. A plant lands only on a free key or on a key this
     * same door planted (`plantedBy: "harness"`), and `clear` deletes only a planted row —
     * so a harness pointed at a tenant with a genuinely installed pipeline refuses instead
     * of destroying the record of it. Same discipline as `deleteHarnessConnection`.
     *
     * THE READ IS THE PRODUCT'S OWN ANSWER. It returns `publicPipelineRow(row)` — the
     * exact projection `getGitPipelineStatus` hands the Code tab — plus the three
     * predicates from `src/shared/git-pipeline-state.js` computed on the stored row, so a
     * driver grades the planted state against the SAME functions the tab renders from and
     * never against a restatement of them.
     */
    if (body.action === "pipelineRow") {
      const connId = String(body.connId || body.connectionId || "");
      const repoRaw = String(body.repoId || body.repo || "");
      if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(connId)) return json(400, { error: "connId required" });
      if (!/^[^/\s]+\/[^/\s]+$/.test(repoRaw) || repoRaw.length > 120) return json(400, { error: "repoId must be owner/name" });
      const { gitPipelineKey, normalizeDeveloperSpaceId, normalizeForgeAppId } = await import("./shared/git-ids.js");
      const { normalizeRepoId } = await import("./git-connections.js");
      const { publicPipelineRow, PIPELINE_SCAFFOLD } = await import("./git-pipeline.js");
      const { pipelineOutdated, pipelineLive, pipelineStuck } = await import("./shared/git-pipeline-state.js");
      const { SCAFFOLD_VERSION, scaffoldVarNames, scaffoldVarError } = await import("./shared/git-scaffolds.js");
      const repoId = normalizeRepoId(repoRaw);
      const key = gitPipelineKey(connId, repoId);
      const op = String(body.op || "read");
      const existing = (await storage.get(key)) ?? null;
      const planted = harnessPlanted(existing);

      if (op === "read") {
        return json(200, {
          ok: true, key, planted,
          ...(await storedFields("row", key, publicPipelineRow(existing))),
          // The SAME three functions the projection and the Code tab ask, on the stored
          // row, so a driver can prove projection and predicate agree rather than assume it.
          predicates: {
            outdated: pipelineOutdated(existing),
            live: pipelineLive(existing),
            stuck: pipelineStuck(existing),
          },
          currentScaffoldVersion: SCAFFOLD_VERSION,
        });
      }
      if (op === "clear") {
        if (existing && !planted) {
          return json(409, { ...notPlantedRefusal("pipeline row"), key });
        }
        await storage.delete(key);
        return json(200, { ok: true, key, ...(await storedFields("row", key, (await storage.get(key)) ?? null)) });
      }
      if (op !== "plant") return json(400, { error: `unknown op "${op}" for pipelineRow (plant|read|clear)` });

      // A credential mentioned ANYWHERE in the body refuses the whole plant, before
      // anything is read or written. One home: `findPlantedSecret`.
      const leak = findPlantedSecret(body);
      if (leak) return json(400, { error: SECRET_PLANT_REFUSAL, harnessRefusal: "secret-field", field: leak.field, why: leak.why });

      if (existing && !planted) {
        return json(409, { ...notPlantedRefusal("pipeline row"), error: "harnessRefusal: a real pipeline row already exists for that repository — this door never overwrites one", key });
      }
      const status = body.status === "queued" ? "queued" : "installed";
      if (body.status !== undefined && body.status !== "queued" && body.status !== "installed") {
        return json(400, { error: 'status must be "installed" or "queued"' });
      }
      // CLAMPED to what this build can actually describe: 1..SCAFFOLD_VERSION. A version
      // above the current one would make `scaffoldOutdatedReason` answer null and the row
      // would claim to be NEWER than the app, a state no setup can produce.
      const wantVersion = body.scaffoldVersion === undefined ? 1 : Math.trunc(Number(body.scaffoldVersion));
      if (!Number.isFinite(wantVersion)) return json(400, { error: "scaffoldVersion must be a number" });
      const scaffoldVersion = Math.max(1, Math.min(SCAFFOLD_VERSION, wantVersion));
      const ageMs = Math.max(0, Math.min(7 * 24 * 3600 * 1000, Number(body.ageMs) || 0));
      const stamp = new Date(Date.now() - ageMs).toISOString();

      // Only DECLARED scaffold variables, each through the module that owns "is this
      // variable usable" (F-541). A value the product would refuse is refused here too.
      let scaffoldVars = null;
      if (body.scaffoldVars !== undefined) {
        if (!body.scaffoldVars || typeof body.scaffoldVars !== "object" || Array.isArray(body.scaffoldVars)) {
          return json(400, { error: "scaffoldVars must be an object" });
        }
        const out = {};
        for (const name of scaffoldVarNames(PIPELINE_SCAFFOLD)) {
          const v = body.scaffoldVars[name];
          if (v === undefined || v === null) continue;
          const text = String(v).slice(0, 200);
          const err = scaffoldVarError(name, text);
          if (err) return json(400, { error: err, variable: name });
          out[name] = text;
        }
        scaffoldVars = Object.keys(out).length ? out : null;
      }
      let developerSpaceId = null;
      if (body.developerSpaceId !== undefined && body.developerSpaceId !== null) {
        developerSpaceId = normalizeDeveloperSpaceId(body.developerSpaceId);
        if (!developerSpaceId) return json(400, { error: "invalid developerSpaceId" });
      }
      let appId = null;
      if (body.appId !== undefined && body.appId !== null) {
        appId = normalizeForgeAppId(body.appId);
        if (!appId) return json(400, { error: "invalid appId" });
      }
      let branch = "main";
      if (body.branch !== undefined && body.branch !== null) {
        branch = String(body.branch);
        if (!/^[A-Za-z0-9._/-]{1,120}$/.test(branch)) return json(400, { error: "invalid branch" });
      }

      const row = {
        connId,
        repoId,
        kind: "github",
        scaffold: PIPELINE_SCAFFOLD,
        scaffoldVersion,
        status,
        steps: [],
        failedStep: null,
        // NEVER PLANTABLE. See the docblock: the permission lock is the one fact a
        // planted row must not be able to assert.
        lockHash: null,
        lockScopes: [],
        branch,
        commitSha: null,
        installedAt: status === "installed" ? stamp : null,
        queuedAt: stamp,
        startedAt: null,
        updatedAt: stamp,
        lastRun: null,
        requestedBy: null,
        scaffoldVars,
        developerSpaceId,
        appId,
        plantedBy: "harness",
      };
      await storage.set(key, row);
      return json(200, {
        ok: true, key, op, planted: true,
        ...(await storedFields("row", key, publicPipelineRow(row))),
        predicates: { outdated: pipelineOutdated(row), live: pipelineLive(row), stuck: pipelineStuck(row) },
        currentScaffoldVersion: SCAFFOLD_VERSION,
        effectiveAgeMs: ageMs,
      });
    }
    /*
     * F-616 — THE PURGE-TOMBSTONE DOOR, and why it had to exist.
     *
     * F-575's settle window was driven live by DELETING a Virtual Administrator and
     * RE-CREATING it under the same id through `saveScheduledJob`. That only worked
     * because a save carrying an unknown id CREATED the row at that id — the defect
     * F-616 closes. With the door shut there is no product path to a re-created agent,
     * so the window would have gone unproven; this is its replacement.
     *
     * WHAT IT DOES. Writes, ages, reads or deletes `va_purged:{agent}` — the tombstone
     * `purgeAgent` stamps on delete and `clearPurgeTombstone` weighs on the first prepare
     * tick. The KEY and the TTL come from `src/shared/va-keys.js`, the module that owns
     * them; nothing is retyped here.
     *
     * F-628 — a plant may additionally carry `turns`, the writes that landed while the
     * agent was being deleted. They are written through the PRODUCT's own writer
     * (`recordPurgedTurnWrites`, src/va-ledger.js), one turn per call, never by a second
     * writer in this file — see the block below for why that distinction is the whole
     * value of the door.
     *
     * WHY IT IS NOT A PLANTABLE PERMISSION (the objection the old driver recorded when
     * it refused to add `va_purged:*` to `kvSet`'s allow-list). A tombstone GRANTS
     * nothing: every writer that reads one REFUSES under it. Planting one can only take
     * an agent's voice away, never hand it one. The directions that DO relax something
     * are `clear` (which hands a purged agent its voice back outright) and `op:"age"`/a
     * large `ageMs` (which retires a settle window early) — and F-632 closed both: every
     * write and the delete refuse a row that is not stamped `plantedBy:"harness"`, through
     * the same `harnessPlanted` predicate `pipelineRow` asks. On top of that this door is
     * behind the same HARNESS_SECRET Bearer as everything else in this file (absent in
     * production, checked at the top of the handler), it refuses an agent id that names
     * no job row, and it never touches any other key.
     *
     * THE CLAMP IS THE POINT. `clearPurgeTombstone` only considers a tombstone STAMPED
     * BEFORE the job's `createdAt` (that is what tells a re-created job from a tick of
     * the deleted one). A planted `at` is therefore clamped to `createdAt - 1s`, so a
     * fresh plant lands on the SETTLE-WINDOW arm rather than the `tombstone_newer_than_job`
     * one, and `ageMs` moves it further back to retire the window. The answer reports the
     * job's `createdAt`, the effective age and whether the clamp bit, so a driver grades
     * on measured facts and never on an assumed clock.
     */
    if (body.action === "vaTombstone") {
      const agent = String(body.agent || "");
      if (!/^[A-Za-z0-9_.-]{3,80}$/.test(agent)) return json(400, { error: "agent must be a job id (3-80 chars of A-Za-z0-9_.-)" });
      const { vaPurgedKey, VA_PURGED_TTL } = await import("./shared/va-keys.js");
      const key = vaPurgedKey(agent);
      const op = String(body.op || "read");
      if (op === "read") return json(200, { ok: true, key, ...(await storedFields("row", key, (await storage.get(key)) ?? null)) });
      if (op === "clear") {
        // F-632 — the same predicate `pipelineRow clear` asks, from the same home. A
        // tombstone this door did not plant is a REAL purge record: deleting it retires a
        // live settle window and erases the landed writes the F-608 purges panel reports,
        // so it is refused and left exactly as it stands.
        const standing = (await storage.get(key)) ?? null;
        if (standing && !harnessPlanted(standing)) return json(409, { ...notPlantedRefusal("tombstone"), key, ...(await storedFields("row", key, standing)) });
        await storage.delete(key);
        return json(200, { ok: true, key, ...(await storedFields("row", key, (await storage.get(key)) ?? null)) });
      }
      if (op === "plant" || op === "age") {
        // F-628 — a write body may never name a credential. One home, shared with the
        // F-627 pipeline door, and asked BEFORE anything is read or written.
        const leak = findPlantedSecret(body);
        if (leak) return json(400, { error: SECRET_PLANT_REFUSAL, harnessRefusal: "secret-field", field: leak.field, why: leak.why });
        const { getJob } = await import("./scheduled-jobs.js");
        const job = await getJob(agent);
        // A tombstone for an id that is not a live row would be unreachable litter, and
        // the clamp below has nothing to clamp against.
        if (!job) return json(404, { error: "no scheduled job / agent with that id" });
        const existing = (await storage.get(key)) ?? null;
        if (op === "age" && !existing) return json(409, { error: "no tombstone to age — plant one first" });
        // F-632 — both write ops REWRITE the row they find, and moving a real tombstone's
        // `at` back is the soft form of deleting it (it retires the settle window early).
        // So a plant or an age over a row this door did not plant is refused, exactly as
        // `pipelineRow plant` refuses a real pipeline record.
        if (existing && !harnessPlanted(existing)) return json(409, { ...notPlantedRefusal("tombstone"), key, op, ...(await storedFields("row", key, existing)) });
        const ageMs = Math.max(0, Math.min(7 * 24 * 3600 * 1000, Number(body.ageMs) || 0));
        const createdMs = Date.parse((job.createdAt == null ? "" : job.createdAt));
        const wanted = Date.now() - ageMs;
        const at = Number.isFinite(createdMs) ? Math.min(wanted, createdMs - 1000) : wanted;
        const row = {
          at: new Date(at).toISOString(),
          agent,
          plantedBy: "harness",
          // F-628 — `age` rewrites the row, so without this an age would silently ERASE
          // the turns a plant had recorded. The carrier survives its own timestamp move.
          ...(existing && Array.isArray(existing.turns) && existing.turns.length ? { turns: existing.turns } : {}),
        };
        await storage.set(key, row, VA_PURGED_TTL);

        /* ── F-628 — THE TURNS THAT LANDED WHILE THE AGENT WAS BEING DELETED ────────
         * F-608's "recently deleted agents that wrote during deletion" panel returns a
         * row ONLY when `turns[].landedWrites` is non-empty, and the sole producer of
         * that field is `recordPurgedTurnWrites` running inside a turn that is writing
         * to Jira at the moment the agent is deleted — a race no driver can schedule. So
         * the panel could only ever be proven EMPTY live, and an empty list is not
         * evidence that a populated one would render.
         *
         * THE WRITE GOES THROUGH THE PRODUCT'S OWN WRITER, ONE TURN PER CALL. That is
         * the whole point: a second writer here would produce a row that merely RESEMBLES
         * what a real race produces, and the panel would then be proven against the
         * harness's idea of the shape rather than the engine's. `recordPurgedTurnWrites`
         * applies its own caps, refuses when no tombstone stands, and is the thing whose
         * output `listRecentPurges` projects.
         *
         * CLAMPED HERE FIRST, well inside the product's own bounds: at most five turns of
         * at most five writes each, every string 64 characters. A tombstone GRANTS
         * nothing — every ledger writer refuses under one — so its CONTENT grants nothing
         * either, which is why the objection that keeps `va_purged:*` out of `kvSet` does
         * not reach this. `at` is clamped to the last seven days and never to the future. */
        let noted = null;
        if (body.turns !== undefined) {
          if (!Array.isArray(body.turns)) return json(400, { error: "turns must be an array" });
          const { recordPurgedTurnWrites } = await import("./va-ledger.js");
          const results = [];
          for (const t of body.turns.slice(0, 5)) {
            if (!t || typeof t !== "object") return json(400, { error: "each turn must be an object" });
            const writes = (Array.isArray(t.writes) ? t.writes : [])
              .slice(0, 5)
              .map((w) => String(w == null ? "" : w).slice(0, 64))
              .filter(Boolean);
            if (!writes.length) return json(400, { error: "each turn needs at least one write string" });
            let issueKey = null;
            if (t.issueKey !== undefined && t.issueKey !== null && String(t.issueKey) !== "") {
              issueKey = String(t.issueKey);
              if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(issueKey)) return json(400, { error: `turn issueKey must be an issue key (got ${issueKey.slice(0, 40)})` });
            }
            const wantedAt = Date.parse(t.at == null ? "" : String(t.at));
            const now = Number.isFinite(wantedAt)
              ? Math.max(Date.now() - 7 * 24 * 3600 * 1000, Math.min(Date.now(), wantedAt))
              : Date.now();
            results.push(await recordPurgedTurnWrites(storage, agent, { issueKey, landedWrites: writes, now }));
          }
          noted = results;
        }

        return json(200, {
          ok: true, key, ...(await storedFields("row", key, (await storage.get(key)) ?? row)), op,
          jobCreatedAt: job.createdAt || null,
          effectiveAgeMs: Date.now() - at,
          clampedToCreatedAt: Number.isFinite(createdMs) && wanted > createdMs - 1000,
          // What the PRODUCT's writer said about each turn — `{ok:true, turns, writes}`
          // or its own refusal reason. A driver grades on the writer's answer, not on ours.
          ...(noted ? { noted } : {}),
        });
      }
      return json(400, { error: `unknown op "${op}" for vaTombstone (plant|age|read|clear)` });
    }
    if (body.action === "removeRules") {
      try {
        const { removeRegistryRowsCore } = await import("./index.js");
        const r = await removeRegistryRowsCore({
          ids: Array.isArray(body.ids) ? body.ids : [],
          accountId: null,
          detach: body.detach === true,
          bypassAuthz: true,
        });
        return json(200, r);
      } catch (e) {
        return json(500, { error: String((e && e.message) || e) });
      }
    }
    return json(400, { error: `unknown POST action=${body.action}` });
  }

  const what = q(req, "what") || "registry";
  try {
    // F-802 - EVERY arm below that answers a stored row goes through `answerStored`
    // (-> `readCeiling`, above). Adding a `what` that reads storage and calls `json(200, ...)`
    // itself re-opens the ceiling this switch was one query parameter away from.
    if (what === "registry") return answerStored("registry", "config_registry", (await storage.get("config_registry")) || []);
    if (what === "provider") return answerStored("provider", "COGNIRUNNER_AI_PROVIDER", (await storage.get("COGNIRUNNER_AI_PROVIDER")) || "atlassian");
    if (what === "logs") return answerStored("logs", "validation_logs", (await storage.get("validation_logs")) || []);
    // Real execution logs live under per-entry log_entry:* keys (NOT validation_logs), so the
    // nominal key is the PREFIX those entries share - the same one SPREAD_BOUNDED_BY judges.
    if (what === "execlogs") { const { readLogs } = await import("./index.js"); return answerStored("logs", "log_entry:", await readLogs(q(req, "ruleId") || null)); }
    if (what === "rulesApiUrl") {
      const { webTrigger } = await import("@forge/api");
      const r = await webTrigger.getUrl("rules-api");
      return json(200, { url: typeof r === "string" ? r : r && r.url });
    }
    /* The kvs READ has NO KEY ALLOW-LIST and never grows one: it is a read, it is behind
     * HARNESS_SECRET, and the harness must be able to confirm a planted fault (F-126)
     * landed on the exact slot it wrote. WHICH KEYS may be read is therefore not a
     * question this door asks.
     *
     * F-769 — WHAT COMES BACK *IS* A QUESTION, AND IT HAS A CEILING. An unrestricted read
     * is not the same thing as an unrestricted DISCLOSURE, and the file had been reading
     * it as though it were: `?what=kvs&key=COGNIRUNNER_KEY_azure` returned the tenant's
     * BYOK key in plain text, as did `git_conn_secret:*`, `git_hook_secret:*` and
     * `webtrigger_url:*`. F-762 masked a webtrigger URL out of `listGitWebhooks` on the
     * reasoning that "a dev hook that prints it into a harness log has published it, and
     * that is not a ceiling" — and that reasoning applies HARDER here, because the value
     * one query-string away is the signing secret that URL's HMAC check depends on.
     * MEASURED on test-harness/lib/redact.mjs: a bare provider key has no `sk-`/`ghp_`
     * prefix and the JSON field is `value`, so the evidence redactor masks NOTHING — the
     * key lands in a committed file verbatim.
     *
     * So a credential-family key (`isCredentialKey`, ONE HOME above) answers
     * `{key, present, fingerprint, masked:true}` and never `value`.
     *
     * F-794 — AND EVERY OTHER KEY IS ANSWERED FIELD BY FIELD, because that ceiling was
     * per-KEY while a credential is per-FIELD. `pf_code:*`, `job:*`, `listener:*`,
     * `async_job:*` and `config_registry` are MIXED rows — a tenant config whose key says
     * nothing, carrying an endpoint bearer inside it — and they were answering entirely
     * plain. `maskSecretFields` (ONE HOME, above, the same traversal the write refusal
     * uses) replaces every secret-looking PATH with a fingerprint and leaves the rest
     * readable; `maskedFields` says which. Its residual — free text such as
     * `functions[].code` and `agent.instructions` — is stated in full at its docblock.
     *
     * THIS DOES NOT COST THE F-126 CONFIRMATION the comment above protects. F-126 plants
     * a provider fault by CLEARING a slot, and `present:false` answers that precisely;
     * `fingerprint` additionally proves a snapshot came back byte-identical, which is the
     * only other thing the census of live drivers did with these rows. A driver that must
     * REPLACE a credential and put the tenant's own back uses `kvStash`/`kvRestore`
     * (POST, below), which moves the value server-side and never returns it.
     */
    if (what === "kvs") {
      const key = q(req, "key");
      if (!key) return json(400, { error: "key required" });
      // F-742 — the KEY half of the same door. Unrestricted stays unrestricted (no
      // allow-list on a read), but a key the platform would throw on is answered 400
      // with the field named, rather than 500 with a `ForgeKvsAPIError` message.
      const keyBad = kvsKeyRefusal(key);
      if (keyBad) return json(400, keyBad);
      // F-802 - the SAME projection the other three arms use, and no longer its own copy
      // of it. A clean row answers exactly as it always did.
      return answerStored("value", key, (await storage.get(key)) ?? null);
    }
    return json(400, { error: `unknown what=${what}` });
  } catch (e) {
    return json(500, { error: String((e && e.message) || e) });
  }
}

// ===== Coder plan Part 0 probe (c): is the webtrigger `body` byte-identical to what the sender
// signed? A GitHub/Bitbucket webhook points here with a secret stored under KVS
// `probe:webhook:secret` (set through the test hook). Records headers (names + signature
// values only), body length/sha256 and the HMAC verdict under `probe:webhook:last`.
// Unauthenticated by design (webhook senders cannot send our Bearer) — it stores no payload.
export async function gitWebhookProbe(req) {
  const { createHmac, createHash, timingSafeEqual } = await import("node:crypto");
  const row = (await storage.get("probe:webhook:secret")) || null;
  const body = typeof (req && req.body) === "string" ? req.body : "";
  const hdr = (n) => { const v = req && req.headers && (req.headers[n] || req.headers[n.toLowerCase()] || req.headers[n.toUpperCase()]); return Array.isArray(v) ? v[0] : (v || null); };
  const sig256 = hdr("x-hub-signature-256") || hdr("X-Hub-Signature-256");
  const sig = hdr("x-hub-signature") || hdr("X-Hub-Signature");
  const provider = hdr("x-github-event") ? "github" : (hdr("x-event-key") ? "bitbucket" : "unknown");
  let verdict = "no-secret";
  if (row && row.secret) {
    const expected = "sha256=" + createHmac("sha256", row.secret).update(body, "utf8").digest("hex");
    const got = sig256 || sig || "";
    verdict = got && expected.length === got.length && timingSafeEqual(Buffer.from(expected), Buffer.from(got)) ? "VALID" : "INVALID";
  }
  await storage.set("probe:webhook:last", {
    at: new Date().toISOString(), provider, event: hdr("x-github-event") || hdr("x-event-key") || null,
    bodyBytes: Buffer.byteLength(body, "utf8"), bodySha256: createHash("sha256").update(body, "utf8").digest("hex"),
    headerNames: req && req.headers ? Object.keys(req.headers) : [], sig256: sig256 ? sig256.slice(0, 20) + "…" : null, sig: sig ? sig.slice(0, 20) + "…" : null,
    verdict, bodyIsString: typeof (req && req.body) === "string",
  }, { ttl: { value: 1, unit: "DAYS" } });
  return { statusCode: 202, headers: { "Content-Type": ["application/json"] }, body: JSON.stringify({ ok: true, verdict }) };
}
