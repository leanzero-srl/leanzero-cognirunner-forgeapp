/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * THE IDENTIFIER-LEAK TABLE AND SCANNER — one home, no dependencies.
 *
 * WHAT IT IS FOR: before any text this instance holds leaves it — an agent's web search
 * today (src/web-search-tool.js), the knowledge bake tomorrow (FRAME 1.5 §8b, F-419) — it
 * is scanned for identifiers that name this customer: account ids, the site address,
 * e-mail addresses, UUIDs and this tenant's own issue keys.
 *
 * WHY A SHARED MODULE: the table is the product decision, and a second copy of it is a
 * second answer to "is a bare 24-hex string an account id?" (F-406 was exactly that
 * question, answered late). A caller may choose WHAT to do with a hit; nobody re-decides
 * what a hit IS.
 *
 * THE REFUSAL NAMES THE KIND, NEVER THE VALUE. A refusal that echoes the identifier has
 * copied it into the model transcript, the execution log and the operator's screen —
 * which is the whole thing being prevented. Every function here examines matched text and
 * discards it.
 *
 * DEPENDENCY-FREE, like everything else in src/shared/: it bundles into the backend and,
 * if a surface ever needs it, into a frontend.
 */

/**
 * THE ONE REGEX TABLE. Each row is { id, kind, re } where `kind` is the sentence
 * fragment the refusal uses — the refusal says the KIND and never the VALUE.
 *
 * Order matters only for which kind is REPORTED first; every row is evaluated against
 * the raw query, so a query with two kinds is refused for the first one listed.
 */
/**
 * The issue-key SHAPE, named because two things use it and they must not drift: the table
 * row below and the all-matches scanner in shapeLooksLikeIssueKey.
 */
const ISSUE_KEY_SHAPE = /\b[A-Z][A-Z0-9_]{1,9}-\d{1,6}\b/;

export const IDENTIFIER_PATTERNS = Object.freeze([
  // Atlassian account id: the `712020:` (or any numeric realm) prefix followed by hex.
  { id: "accountId", kind: "an Atlassian account id", re: /\b\d{6}:[0-9a-fA-F]{8}/ },
  // F-406 — the OTHER account id. Classic Atlassian Cloud accountIds are a bare 24-char
  // hex string with no realm prefix and no dashes (`5b10ac8d82e05b22cc7d4ef5`), which the
  // realm-prefixed row above and the UUID row both miss entirely. It is the identifier
  // that appears in every REST payload an agent reads, so it is the one most likely to be
  // pasted into a query. 24 hex chars is specific enough that a public token of that exact
  // shape is vanishingly rare, and an extra refusal costs one sentence.
  { id: "accountIdHex", kind: "an Atlassian account id", re: /\b[0-9a-f]{24}\b/i },
  // Any Atlassian Cloud site host — naming the tenant is naming the customer.
  { id: "atlassianHost", kind: "an Atlassian site address", re: /\b[A-Za-z0-9][A-Za-z0-9-]*\.atlassian\.net\b/ },
  { id: "email", kind: "an e-mail address", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/ },
  { id: "uuid", kind: "a UUID", re: /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/ },
  // Jira issue key. Decided by the TENANT'S project keys (F-395); this shape is the
  // fallback for a failed read — see NON_KEY_PREFIXES and shapeLooksLikeIssueKey.
  { id: "issueKey", kind: "a Jira issue key", re: ISSUE_KEY_SHAPE },
]);

/**
 * THE FALLBACK DENY-LIST — used ONLY when the tenant's real project keys cannot be read.
 *
 * A Jira issue key and a public standard reference are the SAME SHAPE: `UTF-8`,
 * `CVE-2024`, `RFC-7231`, `ISO-8601` and `PROJ-123` cannot be told apart by a regex.
 *
 * Which way to be wrong is a product decision, and this is it: refusing "what changed in
 * UTF-8" is a useless agent, while sending "PROJ-123" to a search engine is a leak. So
 * the key pattern keeps its breadth and this SMALL, EXPLICIT deny-list of well-known
 * public prefixes is subtracted from it. A prefix belongs here only if it is a public
 * standard or format that nobody would use as a Jira project key. When in doubt, leave
 * it OUT — the cost of an extra refusal is a sentence to the operator, and the cost of
 * an extra allowance is an identifier on somebody else's server.
 *
 * F-395: THIS LIST IS NO LONGER THE PRIMARY RULE, because both of its errors were real.
 * A tenant whose project key IS one of these tokens (API, SQL, UTF are all legal Jira
 * project keys) had its real issue keys sent to the search engine, and every tenant lost
 * "CVE-2024-1234". A guess about which prefixes are public cannot decide that; the
 * tenant's OWN project list can, and it is one cached read away. So the shape rule is
 * kept ONLY as the fallback for when that read FAILS — and there it stays deliberately
 * BROAD (refuse on shape), because failing closed is the only safe way to be wrong about
 * a leak.
 */
export const NON_KEY_PREFIXES = Object.freeze(new Set([
  "UTF", "ISO", "RFC", "CVE", "CWE", "HTTP", "HTTPS", "TLS", "SSL", "SHA", "MD", "AES", "RSA",
  "IPV", "IPV4", "IPV6", "PEP", "JSR", "JDK", "JEP", "ES", "ECMA", "CSS", "HTML", "SQL", "ADF",
  "PDF", "GPT", "LTS", "API", "AWS", "GCP", "OWASP", "NIST", "GDPR", "WCAG", "ARIA", "USB",
  "PCI", "DSS", "SOC", "PY", "NODE", "PHP", "CVSS", "SPDX", "PNG", "JPEG", "WEBP", "SVG",
]));

/**
 * How many project keys one tenant may contribute to the matcher. The read in
 * src/index.js is paginated and stops here; a site with more projects than this reports
 * `ok:false`, which means the SHAPE fallback (refuse) applies rather than a matcher that
 * silently knows only half the site's keys.
 */
export const PROJECT_KEY_CAP = 500;

/** A project key Jira itself would accept: a letter first, then letters/digits/_ , <=10. */
const LEGAL_PROJECT_KEY = /^[A-Za-z][A-Za-z0-9_]{0,9}$/;

/**
 * Normalise whatever the project read produced into the matcher's input: an upper-cased,
 * deduped list of keys that are SAFE to interpolate into a regex. A key that does not
 * look like a Jira project key is DROPPED rather than escaped — no legal key is lost, and
 * nothing out of a REST payload ever reaches `new RegExp` unchecked.
 */
export const normalizeProjectKeys = (keys) => [...new Set((Array.isArray(keys) ? keys : [])
  .map((k) => String(k == null ? "" : k).trim().toUpperCase())
  .filter((k) => LEGAL_PROJECT_KEY.test(k)))].slice(0, PROJECT_KEY_CAP);

/**
 * Does the query carry `<KEY>-<digits>` for one of THIS tenant's project keys?
 *
 * CASE-INSENSITIVE on purpose: a model writes "can you check api-12" as readily as
 * "API-12", and a leak in lower case is the same leak. The boundaries are written out
 * rather than `\b` so that `XAPI-12` is not read as this site's `API-12` — a different
 * token is a different thing. A HYPHEN is deliberately left out of the boundary class:
 * `SOMETHING-API-12` still carries the key, and when the two readings differ the refusal
 * is the one we want.
 */
export const matchesTenantIssueKey = (query, keys) => {
  const q = String(query == null ? "" : query);
  for (const key of normalizeProjectKeys(keys)) {
    if (new RegExp(`(?<![A-Za-z0-9_])${key}-\\d{1,6}(?![A-Za-z0-9_])`, "i").test(q)) return true;
  }
  return false;
};

/**
 * THE SHAPE FALLBACK, used only when the tenant's project list could not be read.
 *
 * F-400: this used to take the FIRST shape match and, if its prefix was deny-listed,
 * `continue` past the WHOLE query — so "UTF-8 error in ACME-1234" was allowed, carrying a
 * real issue key to the search engine on the strength of an unrelated public token earlier
 * in the sentence. One innocent match cannot vouch for the rest of the string. EVERY match
 * is examined, and ANY match whose prefix is not a known public standard refuses.
 *
 * The matched text is examined here and DISCARDED — it never reaches the refusal, the log
 * or the tool result.
 */
const shapeLooksLikeIssueKey = (q) => {
  const scan = new RegExp(ISSUE_KEY_SHAPE.source, "g");
  for (const m of q.matchAll(scan)) {
    if (!NON_KEY_PREFIXES.has(String(m[0]).split("-")[0].toUpperCase())) return true;
  }
  return false;
};

/**
 * THE SCANNER. Returns `null` when the text is clean, or `{ id, kind, message }` when it
 * is not. NEVER returns the offending text.
 *
 * `text` is any string about to leave the instance — a search query today, a knowledge
 * chunk tomorrow. The options object is how a second caller can arrive without a third
 * positional argument being invented for it.
 *
 * `options.projectKeys` (F-395) is the tenant's OWN project list, in the shape the reader
 * in src/index.js reports:
 *   { ok: true,  keys: [...] } → the issue-key row refuses ONLY those keys. "CVE-2024-1234"
 *                                is a public question on a site with no CVE project, and
 *                                "API-12" is a leak on a site whose project key IS API.
 *   { ok: false } / omitted    → the read FAILED (or this caller has no list): fall back to
 *                                the SHAPE rule minus NON_KEY_PREFIXES. Fail CLOSED — a
 *                                site we cannot describe gets the broad refusal, never a
 *                                free pass.
 * Every other row is unaffected; this argument only ever decides the issue-key row.
 */
export const findIdentifierLeak = (text, { projectKeys = null } = {}) => {
  const q = String(text == null ? "" : text);
  const known = Boolean(projectKeys && projectKeys.ok === true && Array.isArray(projectKeys.keys));
  for (const row of IDENTIFIER_PATTERNS) {
    if (row.id === "issueKey") {
      if (known) {
        // The tenant's own keys decide it. The shape regex is not consulted at all: it is
        // upper-case-anchored and would miss "api-12", which leaks just as well.
        if (!matchesTenantIssueKey(q, projectKeys.keys)) continue;
      } else if (!shapeLooksLikeIssueKey(q)) continue;
    } else if (!row.re.test(q)) continue;
    return {
      id: row.id,
      kind: row.kind,
      message: `Refused: the query contains ${row.kind} from this Jira instance. Nothing was sent to the search engine. Search for the PUBLIC subject only, describe the product, the version, the API or the error text in general terms, with no identifier from this site in it.`,
    };
  }
  return null;
};

/**
 * THE MEMO MECHANICS for the project-key read (F-395). The memo CELL lives in ONE home in
 * src/index.js, beside the provider memo and on the same 30 s window — that is where every
 * per-container cache in this app lives, and a second cache home is how two surfaces come
 * to disagree about the same fact. Only the mechanics live here, so that they can be
 * asserted offline: src/index.js cannot be imported without the Forge runtime, and "a memo
 * hit does not re-read" is precisely the property a source grep cannot prove.
 *
 * A FAILED read is NEVER memoised: the next run should try again rather than inherit a
 * 30 s window of shape-fallback refusals from one KVS hiccup.
 */
export const createProjectKeysMemo = (fetchKeys, ttlMs = 30000, now = () => Date.now()) => {
  let value = null;
  let at = 0;
  return async () => {
    if (value && now() - at < ttlMs) return value;
    let r;
    try { r = await fetchKeys(); } catch { r = null; }
    const out = r && r.ok === true && Array.isArray(r.keys)
      ? { ok: true, keys: normalizeProjectKeys(r.keys) }
      : { ok: false, keys: [] };
    if (out.ok) { value = out; at = now(); }
    return out;
  };
};

/**
 * The distinct KINDS this scanner can report, in table order. Exported so a caller can
 * tell a user what is checked without re-reading the regexes — and so a new row cannot be
 * added without the list that describes it moving too.
 */
export const IDENTIFIER_KINDS = Object.freeze([...new Set(IDENTIFIER_PATTERNS.map((r) => r.kind))]);
