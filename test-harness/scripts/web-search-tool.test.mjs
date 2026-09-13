/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// src/web-search-tool.js — the `web` namespace executor (1.4 commit 13a).
//
// What this suite is FOR: the field-agent discipline is in CODE, not in a prompt
// sentence, so it has to be testable without a model and without the network. Every
// rule below is asserted with a POSITIVE fixture (it refuses / it reduces) and a
// NEGATIVE one (it does NOT refuse the innocent case), because a leak check that
// refuses everything is indistinguishable from one that works until someone tries to
// ask a real question.
import assert from "node:assert/strict";
import {
  IDENTIFIER_PATTERNS, NON_KEY_PREFIXES, findIdentifierLeak, reduceResults, parseSearchPayload,
  cacheFieldsOf, createSearchBudget, createWebSearchExecutor,
  TOP_RESULTS, SNIPPET_MAX_CHARS, SEARCHES_PER_TURN, RESULT_RULE, WEB_SEARCH_SYSTEM_RULE,
  matchesTenantIssueKey, normalizeProjectKeys, createProjectKeysMemo, PROJECT_KEY_CAP,
} from "../../src/web-search-tool.js";

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
  const leak = findIdentifierLeak("API-12 root cause", site("API", "LZPT"));
  ok(leak && leak.id === "issueKey", "API-12 is REFUSED on a site whose project key is API (the leak F-395 names)");
  ok(!leak.message.includes("API-12"), "…and the refusal still names the KIND, never the value");
  ok(findIdentifierLeak("what broke in api-12", site("API")).id === "issueKey",
    "…in LOWER CASE too — a model writes api-12 as readily as API-12, and it is the same leak");
  ok(findIdentifierLeak("COGTEST-1421 regression", site("COGTEST")) !== null, "an ordinary project key is refused");
  ok(findIdentifierLeak("UTF-8 in UTF-9000", site("UTF")) !== null,
    "a site that really did name a project UTF has its keys protected — the deny-list used to forbid exactly that");
}

// NEGATIVE — no such project, so the public question goes through.
{
  ok(findIdentifierLeak("CVE-2024-1234 exploitability", site("LZPT", "COGTEST")) === null,
    "CVE-2024-1234 is ALLOWED when no project is called CVE (the second half of F-395)");
  ok(findIdentifierLeak("API-12 of the vendor SDK", site("LZPT")) === null,
    "…and a key shape that is not a project here is a public question, not a leak");
  ok(findIdentifierLeak("SOMETHING-API-12", site("API")) !== null,
    "a hyphen-joined token still carries the key, so it is REFUSED — the boundaries exclude letters/digits/_ only, which is the fail-safe direction");
  ok(findIdentifierLeak("XAPI-12 docs", site("API")) === null,
    "…but a key glued to a letter is a DIFFERENT token and not this site's key");
  ok(findIdentifierLeak("API-1234567 build", site("API")) === null,
    "seven digits is not an issue number — the matcher is <KEY>-<1..6 digits>, like Jira");
  ok(findIdentifierLeak("who is mihai.perdum@leanzero.net", site("LZPT")).id === "email",
    "every OTHER kind is untouched by the project list");
}

// FAIL CLOSED — a failed read falls back to the SHAPE rule, which refuses.
{
  for (const failed of [{ ok: false, keys: [] }, null, undefined, { keys: ["API"] }, { ok: true }]) {
    ok(findIdentifierLeak("PROJ-123 root cause", failed) !== null,
      "read failure → the SHAPE fallback still REFUSES (fail closed)");
  }
  ok(findIdentifierLeak("CVE-2024-1234 exploitability", { ok: false, keys: [] }) === null,
    "…and under the fallback the deny-list is what keeps the public standards usable");
  ok(findIdentifierLeak("PROJ-123") !== null, "a caller that passes no list at all gets the fallback, never a free pass");
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

// THE MEMO: a hit does not re-read, and a FAILED read is never cached.
{
  let reads = 0;
  let now = 1000;
  const memo = createProjectKeysMemo(async () => { reads++; return { ok: true, keys: ["LZPT"] }; }, 30000, () => now);
  const a = await memo();
  const b = await memo();
  eq(a, { ok: true, keys: ["LZPT"] }, "the memo reports the tenant's keys");
  ok(reads === 1, "MEMO HIT: the second call inside the window does NOT re-read");
  eq(b, a, "…and returns the same value");
  now += 30001;
  await memo();
  ok(reads === 2, "past the 30 s window it reads again");

  let fails = 0;
  const bad = createProjectKeysMemo(async () => { fails++; throw new Error("kvs hiccup"); }, 30000, () => now);
  eq(await bad(), { ok: false, keys: [] }, "a THROWING read is reported as ok:false, never thrown at the caller");
  await bad();
  ok(fails === 2, "…and a FAILURE is not memoised — one hiccup must not buy 30 s of shape-fallback refusals");
  const notOk = createProjectKeysMemo(async () => ({ ok: false }), 30000, () => now);
  eq(await notOk(), { ok: false, keys: [] }, "a reader that reports failure is passed through as failure");
}

/* ===================== reduction: top 5, 300 chars, allow-list ===================== */

const rows = Array.from({ length: 12 }, (_, i) => ({
  title: `t${i}`, link: `https://example.com/${i}`, snippet: "s".repeat(800),
  position: i, sitelinks: [{ a: 1 }], imageUrl: "https://img", rating: 5, date: "2026-01-0" + (i % 9 + 1),
}));
const reduced = reduceResults(rows);
eq(reduced.length, TOP_RESULTS, `reduced to the top ${TOP_RESULTS}`);
eq(TOP_RESULTS, 5, "the top-N is 5, as the plan says");
eq(SNIPPET_MAX_CHARS, 300, "the snippet cap is 300 chars, as the plan says");
eq(SEARCHES_PER_TURN, 3, "the budget is 3 searches per turn, as the plan says");
for (const r of reduced) {
  eq(Object.keys(r).sort(), ["date", "link", "snippet", "title"], "ALLOW-LIST: only the four fields survive");
  ok(r.snippet.length <= SNIPPET_MAX_CHARS + 1, "snippet is cut to the cap (plus the ellipsis)");
}
eq(reduceResults(null), [], "a non-array payload reduces to nothing");
eq(reduceResults([{ junk: 1 }]), [], "a row with neither title nor link is dropped");
eq(reduceResults([{ name: "n", url: "u", description: "d" }]), [{ title: "n", link: "u", snippet: "d" }], "the alternate field names are accepted");

/* ===================== envelope parsing ===================== */

eq(parseSearchPayload('{"organic":[{"title":"a"}]}').rows.length, 1, "serper `organic` rows are found");
eq(parseSearchPayload('{"results":[{"title":"a"},{"title":"b"}]}').rows.length, 2, "`results` rows are found");
eq(parseSearchPayload('[{"title":"a"}]').rows.length, 1, "a bare array is accepted");
eq(parseSearchPayload("not json at all").rows, [], "prose is not rows…");
ok(parseSearchPayload("not json at all").raw === "not json at all", "…it is kept as raw");
eq(parseSearchPayload("{broken").rows, [], "unparsable JSON never throws");
eq(parseSearchPayload(undefined).rows, [], "undefined never throws");

/* ===================== cache facts: reported, never invented ===================== */

eq(cacheFieldsOf({ cached: true, searchedAt: "2026-09-13T10:00:00Z" }), { cached: true, searchedAt: "2026-09-13T10:00:00Z" }, "cache facts pass through when the bridge reports them");
eq(cacheFieldsOf({ organic: [] }), {}, "no cache claim is INVENTED when the bridge is silent");
eq(cacheFieldsOf({ cached: false }), {}, "cached:false adds nothing");
eq(cacheFieldsOf(null), {}, "a missing envelope never throws");

/* ===================== the executor ===================== */

// The executor reaches src/index.js only through `mcpEnabled` / `callBridgeTool`. This
// suite stubs both by loading a fake module into the ESM cache is not possible here, so
// the network-touching branches are exercised through the paths that refuse BEFORE any
// import: the leak check and the budget. Both are the ones that must never regress.
const logs = [];
const budget = createSearchBudget(2);
const ex = createWebSearchExecutor({ budget, log: (s) => logs.push(s) });

eq(ex.namespace, "web", "the executor declares its namespace");
ok(typeof ex.execute === "function", "the executor has an execute()");

{
  const r = await ex.execute("not_a_web_action", {});
  ok(r.success === false && r.code === "unknown_action", "an id from another namespace is refused, never executed");
}
{
  const r = await ex.execute("web_search", { query: "   " });
  ok(r.success === false && r.code === "empty_query", "an empty query is refused");
}
{
  const r = await ex.execute("web_search", { query: "is COGTEST-1421 fixed upstream" });
  ok(r.success === false && r.code === "identifier_leak:issueKey", "the leak check refuses BEFORE any request");
  ok(!r.error.includes("COGTEST-1421"), "the refusal does not carry the issue key");
  ok(r.rule === RESULT_RULE, "even a refusal carries the reading rule");
  eq(budget.used, 0, "a REFUSED query spends NO budget — a leak must not cost the run a search");
  ok(logs.some((l) => l.includes("REFUSED") && l.includes("a Jira issue key")), "the refusal is logged by KIND");
  ok(!logs.some((l) => l.includes("COGTEST-1421")), "…and the log does not carry the value either");
}
{
  // Budget exhaustion is asserted by pre-spending the shared counter — the counter IS
  // the contract, and it is shared by every executor the run holds.
  budget.used = budget.max;
  const r = await ex.execute("web_search", { query: "node 24 release date" });
  ok(r.success === false && r.code === "budget_spent", "past the budget the tool refuses…");
  ok(/budget is spent/.test(r.error) && /2 searches per run/.test(r.error), "…with a NAMED reason that states the cap");
}
eq(createSearchBudget().max, SEARCHES_PER_TURN, "the default budget is the plan's number");
eq(createSearchBudget().used, 0, "a fresh budget starts at zero");
ok(createSearchBudget() !== createSearchBudget(), "the budget is PER RUN, not module state (a warm container serves many tenants)");

/* ========== the executor asks the instance for the keys, through ONE seam ========== */

{
  // A site whose project key is API: the search never happens, and the refusal is logged
  // by kind. This is the whole of F-395 seen from where it matters.
  let reads = 0;
  const logs2 = [];
  const tenant = createWebSearchExecutor({
    // Budget ZERO deliberately: the leak check runs BEFORE the budget, so a refusal that
    // says "budget_spent" is proof the query was NOT treated as a leak — and no branch of
    // this suite ever reaches the network or imports src/index.js.
    budget: createSearchBudget(0), log: (s2) => logs2.push(s2),
    deps: { projectKeys: async () => { reads++; return { ok: true, keys: ["API"] }; } },
  });
  const r = await tenant.execute("web_search", { query: "API-12 root cause" });
  ok(r.success === false && r.code === "identifier_leak:issueKey", "the executor refuses a key that IS a project here");
  ok(reads === 1, "…having asked the instance exactly once for this search");
  ok(!r.error.includes("API-12") && !logs2.some((l) => l.includes("API-12")), "…and neither the refusal nor the log carries the value");

  const okr = await tenant.execute("web_search", { query: "CVE-2024-1234 exploitability" });
  ok(okr.code === "budget_spent", "…and the same executor lets the public CVE question PAST the leak check");
}
{
  // A seam that THROWS is the read failing: the tool falls back to the shape rule and
  // refuses. A leak check that crashes open is worse than one that refuses too much.
  const broken = createWebSearchExecutor({ budget: createSearchBudget(0), deps: { projectKeys: async () => { throw new Error("no"); } } });
  const r = await broken.execute("web_search", { query: "PROJ-123 root cause" });
  ok(r.success === false && r.code === "identifier_leak:issueKey", "a THROWING project read falls back to the shape rule, which refuses");
}

/* ===================== the two sentences ===================== */

ok(/pages a search engine returned, not answers/.test(RESULT_RULE), "the result rule is the plan's sentence");
ok(/name the link for anything you take/.test(RESULT_RULE), "…including the citation half");
ok(/say plainly when none answers/.test(RESULT_RULE), "…and the no-answer half");
ok(/must come from a read/.test(WEB_SEARCH_SYSTEM_RULE) && /when you could not check, say so/.test(WEB_SEARCH_SYSTEM_RULE),
  "the system-prompt rule is the plan's sentence");

/* ===================== the wiring, asserted on the source ===================== */

const src = await (await import("node:fs/promises")).readFile(new URL("../../src/agent-runner.js", import.meta.url), "utf8");
ok(/createWebSearchExecutor, createSearchBudget, WEB_SEARCH_SYSTEM_RULE/.test(src), "the runner imports the executor from its ONE home");
ok(/allowed\.includes\("web_search"\)[\s\S]{0,200}executors\.web \|\| createWebSearchExecutor/.test(src),
  "the runner installs the web executor only for an agent that holds the action, and a caller's own executor still wins");
ok(/\$\{webRule\}/.test(src) && /allowed\.includes\("web_search"\) \? `\\n- \$\{WEB_SEARCH_SYSTEM_RULE\}`/.test(src),
  "the system prompt gains the rule from the ONE constant, only when the tool is held");
const idxSrc = await (await import("node:fs/promises")).readFile(new URL("../../src/index.js", import.meta.url), "utf8");
ok(/export const callBridgeTool = async/.test(idxSrc), "callBridgeTool is exported (the one new export the web tool needs)");
ok(/export const mcpEnabled = async/.test(idxSrc), "mcpEnabled is exported (the MCP toggle has ONE reader)");
ok(/export const getTenantProjectKeys = createProjectKeysMemo\(readTenantProjectKeys, PROVIDER_CACHE_TTL_MS\)/.test(idxSrc),
  "the project-key memo CELL lives in index.js, on the provider memo's TTL — one cache home, not two (F-395)");
ok(/project\/search\?maxResults=/.test(idxSrc) && /orderBy=key/.test(idxSrc), "…and it reads the tenant's projects, paginated");
const toolSrc = await (await import("node:fs/promises")).readFile(new URL("../../src/web-search-tool.js", import.meta.url), "utf8");
ok(/getTenantProjectKeys\(\)/.test(toolSrc), "the tool's DEFAULT dep points at that one reader");
ok(/deps\.projectKeys/.test(toolSrc), "…reached through the deps seam, so the leak rule stays testable offline");

console.log(`web-search-tool: ${n} passed, 0 failed`);
