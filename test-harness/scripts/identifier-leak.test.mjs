/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// src/shared/identifier-leak.js — the ONE table of identifiers that must not leave this
// instance, and the scanner over it (F-395, F-400, F-406, F-419).
//
// What this suite is FOR: the rule is in CODE rather than in a prompt sentence, so it has
// to be testable without a model and without the network — and it now has two callers (the
// agent's web search today, the knowledge bake next), which is exactly when a rule starts
// to drift. Every rule below is asserted with a POSITIVE fixture (it refuses) and a
// NEGATIVE one (it does NOT refuse the innocent case), because a leak check that refuses
// everything is indistinguishable from one that works until somebody asks a real question.
import assert from "node:assert/strict";
import {
  IDENTIFIER_PATTERNS, IDENTIFIER_KINDS, NON_KEY_PREFIXES, findIdentifierLeak,
  matchesTenantIssueKey, normalizeProjectKeys, PROJECT_KEY_CAP,
} from "../../src/shared/identifier-leak.js";

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, `${msg} — got ${JSON.stringify(a)}`); n++; };

/* ===================== the ONE regex table ===================== */

ok(Array.isArray(IDENTIFIER_PATTERNS) && IDENTIFIER_PATTERNS.length >= 5, "the table has every kind the plan names");
for (const row of IDENTIFIER_PATTERNS) {
  ok(typeof row.id === "string" && row.id, `${row.id}: has an id`);
  ok(typeof row.kind === "string" && row.kind, `${row.id}: names a KIND for the refusal`);
  ok(row.re instanceof RegExp, `${row.id}: is a regex`);
  ok(!row.re.global, `${row.id}: is not /g (a stateful lastIndex makes a leak check skip every other call)`);
}
eq([...new Set(IDENTIFIER_PATTERNS.map((r) => r.id))].length, IDENTIFIER_PATTERNS.length, "ids are unique");

/* ===================== POSITIVE fixtures — these must REFUSE ===================== */

const LEAKS = [
  ["does 712020:8f3a91cc own this", "accountId"],
  // F-406 - the bare 24-hex accountId, the shape every REST payload actually carries.
  ["who is 5b10ac8d82e05b22cc7d4ef5", "accountIdHex"],
  ["reporter 557058ABC0D1E2F3A4B5C6D7 history", "accountIdHex"],
  ["wolfaenpak.atlassian.net rest api v3 search", "atlassianHost"],
  ["who is mihai.perdum@leanzero.net", "email"],
  ["what is 3f2504e0-4f89-11d3-9a0c-0305e82c3301", "uuid"],
  ["is COGTEST-1421 a known bug", "issueKey"],
  ["PROJ-1 root cause", "issueKey"],
];
for (const [query, id] of LEAKS) {
  const leak = findIdentifierLeak(query);
  ok(leak && leak.id === id, `refuses ${id}: "${query.slice(0, 30)}…"`);
  // THE REFUSAL NAMES THE KIND, NEVER THE VALUE. This is the assertion the whole
  // module exists for: a refusal that echoes the identifier has leaked it into the
  // transcript, the execution log and the operator's screen.
  ok(!leak.message.includes(query), `${id}: the refusal does not echo the query`);
  for (const token of query.split(/\s+/).filter((t) => /[:@]|-\d|\d{4}/.test(t))) {
    ok(!leak.message.includes(token), `${id}: the refusal does not echo the identifier token`);
  }
  ok(leak.message.includes(leak.kind), `${id}: the refusal names the kind`);
}

/* ===================== NEGATIVE fixtures — these must PASS ===================== */

const CLEAN = [
  "what changed in UTF-8 handling in node 24",
  "CVE-2024-3094 xz backdoor summary",
  "RFC-7231 cache-control semantics",
  "ISO-8601 duration format",
  "jira rest api v3 search jql pagination nextPageToken",
  "forge kvs 240 KiB value limit",
  "HTTP-2 server push deprecation",
  "SHA-256 collision status",
  "sha256 of the release is 9f86d081884c7d659a2feaa054", // 24 hex is an account id; 26 is not
  "short hash 5b10ac8d82e0 rolled back", // a short hash is not an account id
];
for (const query of CLEAN) ok(findIdentifierLeak(query) === null, `allows the public question "${query.slice(0, 40)}…"`);

ok(findIdentifierLeak("") === null, "an empty query is not a leak (it is refused elsewhere, for being empty)");
ok(findIdentifierLeak(null) === null, "null does not throw");
ok(NON_KEY_PREFIXES.has("UTF") && NON_KEY_PREFIXES.has("CVE"), "the deny-list holds the standards that share an issue key's shape");
ok(!NON_KEY_PREFIXES.has("PROJ") && !NON_KEY_PREFIXES.has("COGTEST"), "…and nothing that looks like a real project key");

/* ========== the TENANT'S REAL PROJECT KEYS decide the issue-key half (F-395) ==========

The shape rule got BOTH errors in one table: a tenant whose project key is API/SQL/UTF had
its real issue keys sent to a search engine, and every tenant lost "CVE-2024-1234". These
assert the replacement, and the fallback that must survive a failed read. */

const site = (...keys) => ({ ok: true, keys });

// POSITIVE — the key IS a project on this site, so it is refused whatever it looks like.
{
  const leak = findIdentifierLeak("API-12 root cause", { projectKeys: site("API", "LZPT") });
  ok(leak && leak.id === "issueKey", "API-12 is REFUSED on a site whose project key is API (the leak F-395 names)");
  ok(!leak.message.includes("API-12"), "…and the refusal still names the KIND, never the value");
  ok(findIdentifierLeak("what broke in api-12", { projectKeys: site("API") }).id === "issueKey",
    "…in LOWER CASE too — a model writes api-12 as readily as API-12, and it is the same leak");
  ok(findIdentifierLeak("COGTEST-1421 regression", { projectKeys: site("COGTEST") }) !== null, "an ordinary project key is refused");
  ok(findIdentifierLeak("UTF-8 in UTF-9000", { projectKeys: site("UTF") }) !== null,
    "a site that really did name a project UTF has its keys protected — the deny-list used to forbid exactly that");
}

// NEGATIVE — no such project, so the public question goes through.
{
  ok(findIdentifierLeak("CVE-2024-1234 exploitability", { projectKeys: site("LZPT", "COGTEST") }) === null,
    "CVE-2024-1234 is ALLOWED when no project is called CVE (the second half of F-395)");
  ok(findIdentifierLeak("API-12 of the vendor SDK", { projectKeys: site("LZPT") }) === null,
    "…and a key shape that is not a project here is a public question, not a leak");
  ok(findIdentifierLeak("SOMETHING-API-12", { projectKeys: site("API") }) !== null,
    "a hyphen-joined token still carries the key, so it is REFUSED — the boundaries exclude letters/digits/_ only, which is the fail-safe direction");
  ok(findIdentifierLeak("XAPI-12 docs", { projectKeys: site("API") }) === null,
    "…but a key glued to a letter is a DIFFERENT token and not this site's key");
  ok(findIdentifierLeak("API-1234567 build", { projectKeys: site("API") }) === null,
    "seven digits is not an issue number — the matcher is <KEY>-<1..6 digits>, like Jira");
  ok(findIdentifierLeak("who is mihai.perdum@leanzero.net", { projectKeys: site("LZPT") }).id === "email",
    "every OTHER kind is untouched by the project list");
}

// FAIL CLOSED — a failed read falls back to the SHAPE rule, which refuses.
{
  for (const failed of [{ ok: false, keys: [] }, null, undefined, { keys: ["API"] }, { ok: true }]) {
    ok(findIdentifierLeak("PROJ-123 root cause", { projectKeys: failed }) !== null,
      "read failure → the SHAPE fallback still REFUSES (fail closed)");
  }
  ok(findIdentifierLeak("CVE-2024-1234 exploitability", { projectKeys: { ok: false, keys: [] } }) === null,
    "…and under the fallback the deny-list is what keeps the public standards usable");
  ok(findIdentifierLeak("PROJ-123") !== null, "a caller that passes no list at all gets the fallback, never a free pass");
  // F-400: the fallback used to take the FIRST match only, so one public token early in
  // the sentence vouched for a real key later in it. Every match is scanned now.
  ok(findIdentifierLeak("UTF-8 error in ACME-1234", { projectKeys: { ok: false, keys: [] } }) !== null,
    "a deny-listed token EARLY in the query does not smuggle a real key past the fallback");
  ok(findIdentifierLeak("CVE-2024-1234 and RFC-7231 and ISO-8601", { projectKeys: { ok: false, keys: [] } }) === null,
    "…while a query of nothing but public standards is still allowed");
  ok(findIdentifierLeak("ACME-1 then UTF-8", { projectKeys: { ok: false, keys: [] } }) !== null, "…in either order");
}

// The matcher itself, and what it will put into a regex.
{
  ok(matchesTenantIssueKey("see LZPT-1", ["LZPT"]) === true, "matcher: a hit");
  ok(matchesTenantIssueKey("see LZPT-1", ["OTHER"]) === false, "matcher: a miss");
  ok(matchesTenantIssueKey("see LZPT-1", []) === false, "matcher: no keys means no match (the caller decides what that means)");
  ok(matchesTenantIssueKey(null, ["LZPT"]) === false, "matcher: null query never throws");
  eq(normalizeProjectKeys([" lzpt ", "LZPT", "Cog_1"]), ["LZPT", "COG_1"], "keys are upper-cased, trimmed and deduped");
  eq(normalizeProjectKeys(["A.B", "(", "1AB", "TOOLONGAKEYX", "", null]), [],
    "anything Jira would not accept as a project key is DROPPED — nothing unescaped reaches new RegExp");
  ok(normalizeProjectKeys(Array.from({ length: PROJECT_KEY_CAP + 50 }, (_, i) => `K${i}`)).length === PROJECT_KEY_CAP,
    "the key list is capped");
  ok(matchesTenantIssueKey("a (.*)-1 b", ["(.*)"]) === false, "a regex metacharacter in a key cannot become a pattern");
}


/* ===================== the KINDS list travels with the table ===================== */

ok(Array.isArray(IDENTIFIER_KINDS) && IDENTIFIER_KINDS.length > 0, "the kinds are exported for callers that must describe what is checked");
for (const row of IDENTIFIER_PATTERNS) ok(IDENTIFIER_KINDS.includes(row.kind), `${row.id}: its kind is in the list`);
eq(IDENTIFIER_KINDS.length, [...new Set(IDENTIFIER_KINDS)].length, "the kinds list is deduped (two account-id rows, one sentence)");

/* ============ dependency-free: it may be imported by anything, anywhere ============ */

const selfSrc = await (await import("node:fs/promises")).readFile(new URL("../../src/shared/identifier-leak.js", import.meta.url), "utf8");
ok(!/^import .*from/m.test(selfSrc), "src/shared/identifier-leak.js imports NOTHING — it bundles into the backend and any frontend");
ok(/SPDX-License-Identifier: Apache-2.0/.test(selfSrc), "…and carries the licence header every new file must have");

console.log(`identifier-leak: ${n} passed, 0 failed`);
