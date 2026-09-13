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
  findIdentifierLeak, reduceResults, parseSearchPayload,
  cacheFieldsOf, createSearchBudget, createWebSearchExecutor, createProjectKeysMemo,
  TOP_RESULTS, SNIPPET_MAX_CHARS, SEARCHES_PER_TURN, RESULT_RULE, WEB_SEARCH_SYSTEM_RULE,
  createRunSearchBudget,
} from "../../src/web-search-tool.js";
import { WEB_SEARCH_MAX_PER_RUN, WEB_SEARCH_BRAKE_MAX_PER_BUCKET, brakeRefusalText } from "../../src/shared/registry-limits.js";

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, `${msg} — got ${JSON.stringify(a)}`); n++; };

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

/* ===== the project-key memo (its CELL lives in src/index.js, beside the provider memo) ===== */

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

/* ===== the leak table is NOT this module's (F-419) — see identifier-leak.test.mjs ===== */

// The table and the scanner moved to src/shared/identifier-leak.js so the knowledge bake
// scans for the same identifiers. What this suite still owns is that the tool REACHES it:
// every caller of the executor goes through this module, and a re-export that quietly
// disappears would turn the leak check into a no-op with no test failing anywhere else.
ok(typeof findIdentifierLeak === "function", "the tool re-exports the scanner from its shared home");
ok(findIdentifierLeak("PROJ-123 root cause") !== null, "…and it is the real one (it still refuses)");

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
  ok(/budget is spent/.test(r.error) && /2 searches per turn/.test(r.error), "…with a NAMED reason that states the cap");
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

/* ========== the RUN ceiling and the tenant brake (F-407) ==========

The per-turn budget is per runAgentTask call, and a scoped job calls that once PER ISSUE —
so a 100-issue sweep could make 300 searches with every turn politely inside its three. */

{
  eq(createRunSearchBudget().max, WEB_SEARCH_MAX_PER_RUN, "the run ceiling is the number from its ONE home");
  eq(createRunSearchBudget().used, 0, "…and starts at zero");
  ok(createRunSearchBudget() !== createRunSearchBudget(), "…and is per run, not module state");

  // The RUN ceiling refuses even when the TURN budget is untouched — which is exactly the
  // shape of the sweep this exists for: a fresh turn per issue, each with its own three.
  const runBudget = createRunSearchBudget(2);
  runBudget.used = 2;
  const logs3 = [];
  const ex3 = createWebSearchExecutor({
    budget: createSearchBudget(3), runBudget, log: (l) => logs3.push(l),
    deps: { projectKeys: async () => ({ ok: true, keys: ["LZPT"] }) },
  });
  const r = await ex3.execute("web_search", { query: "node 24 release date" });
  ok(r.success === false && r.code === "run_budget_spent", "a fresh TURN is still refused once the RUN's ceiling is spent");
  ok(r.brake && r.brake.kind === "web-searches-run" && r.brake.max === 2, "…reporting WHICH limit it hit");
  ok(r.error.includes(brakeRefusalText("web-searches-run", 2)), "…with the sentence from the ONE home");
  ok(logs3.some((l) => /RUN's search ceiling/.test(l)), "…and the log says run, not turn, so an operator narrows the scope");
  ok(r.rule === RESULT_RULE, "…and it still carries the reading rule");
}
{
  // The tenant-wide brake is taken LAST, so a refused query never spends the installation's
  // allowance. Here the leak check refuses first and the brake seam is never reached.
  let takes = 0;
  const ex4 = createWebSearchExecutor({
    budget: createSearchBudget(3), runBudget: createRunSearchBudget(5),
    deps: {
      projectKeys: async () => ({ ok: true, keys: ["API"] }),
      mcpEnabled: async () => true,
      webSearchBrake: async () => { takes++; return { braked: false, kind: "web-searches", max: WEB_SEARCH_BRAKE_MAX_PER_BUCKET }; },
    },
  });
  const leaked = await ex4.execute("web_search", { query: "API-12 root cause" });
  ok(leaked.code === "identifier_leak:issueKey" && takes === 0, "a REFUSED query never takes a slot from the tenant's search brake");
}
{
  // And when the installation's brake IS tripped, the search is refused by name, with
  // neither budget spent — the brake is not this run's fault and must not read as if it were.
  const turn = createSearchBudget(3);
  const run = createRunSearchBudget(5);
  const logs5 = [];
  const ex5 = createWebSearchExecutor({
    budget: turn, runBudget: run, log: (l) => logs5.push(l),
    deps: {
      projectKeys: async () => ({ ok: true, keys: ["LZPT"] }),
      mcpEnabled: async () => true,
      webSearchBrake: async () => ({ braked: true, kind: "web-searches", max: WEB_SEARCH_BRAKE_MAX_PER_BUCKET, reason: brakeRefusalText("web-searches", WEB_SEARCH_BRAKE_MAX_PER_BUCKET) }),
    },
  });
  const r5 = await ex5.execute("web_search", { query: "forge kvs value limit" });
  ok(r5.success === false && r5.code === "brake:web-searches", "BLOCK: the installation's 5-minute search brake refuses the search");
  ok(r5.brake.kind === "web-searches" && r5.brake.max === WEB_SEARCH_BRAKE_MAX_PER_BUCKET, "…naming the limit that tripped, distinctly from the run ceiling");
  ok(/more than \d+ web searches in 5 minutes/.test(r5.error), "…with the sentence from the ONE home");
  ok(turn.used === 0 && run.used === 0, "…and neither budget is charged for a search that never happened");
  ok(logs5.some((l) => /search brake/.test(l)), "…and the refusal is logged");
}
{
  // A brake that cannot be read does NOT refuse: both budgets above are already hard
  // ceilings, and a KVS hiccup must not silence every agent on the instance.
  const ex6 = createWebSearchExecutor({
    budget: createSearchBudget(0), runBudget: createRunSearchBudget(5),
    deps: { projectKeys: async () => ({ ok: true, keys: ["LZPT"] }), webSearchBrake: async () => { throw new Error("kvs down"); } },
  });
  const r6 = await ex6.execute("web_search", { query: "forge kvs value limit" });
  ok(r6.code === "budget_spent", "a brake read that THROWS is fail-open — the budgets still bound the run");
}

/* the wiring: one counter per RUN, at both run sites */
{
  const fs = await import("node:fs/promises");
  const jobSrc = await fs.readFile(new URL("../../src/scheduled-jobs.js", import.meta.url), "utf8");
  const lstSrc = await fs.readFile(new URL("../../src/listeners.js", import.meta.url), "utf8");
  const agentSrc = await fs.readFile(new URL("../../src/agent-runner.js", import.meta.url), "utf8");
  ok(/const webRunBudget = createRunSearchBudget\(\);[\s\S]{0,400}const runOne = async/.test(jobSrc),
    "the job creates ONE run budget OUTSIDE runOne — a per-issue counter is not a run budget");
  // Matches the ARGUMENT, not its position in the literal: the old pattern required
  // `webRunBudget` to be the LAST key of the call, so adding any argument after it
  // (1.5's `writeScope`) broke an assertion that is really about the value being passed.
  ok(/runAgentTask\(\{[\s\S]*?\bwebRunBudget\b[\s\S]*?\}\);/.test(jobSrc), "…and passes it into every turn of the run");
  ok(/webRunBudget: createRunSearchBudget\(\)/.test(lstSrc), "the listener run site carries one too");
  ok(/webRunBudget = null/.test(agentSrc) && /runBudget: webRunCeiling/.test(agentSrc),
    "the runner takes the caller's ceiling and hands it to the executor");
  ok(/takeWebSearchSlot/.test(lstSrc), "the tenant-wide search brake lives beside the agent-run brake, in ONE home");
}

/* ===================== the two sentences ===================== */

ok(/pages a search engine returned, not answers/.test(RESULT_RULE), "the result rule is the plan's sentence");
ok(/name the link for anything you take/.test(RESULT_RULE), "…including the citation half");
ok(/say plainly when none answers/.test(RESULT_RULE), "…and the no-answer half");
ok(/must come from a read/.test(WEB_SEARCH_SYSTEM_RULE) && /when you could not check, say so/.test(WEB_SEARCH_SYSTEM_RULE),
  "the system-prompt rule is the plan's sentence");

/* ===================== the wiring, asserted on the source ===================== */

const src = await (await import("node:fs/promises")).readFile(new URL("../../src/agent-runner.js", import.meta.url), "utf8");
ok(/createWebSearchExecutor, createSearchBudget, createRunSearchBudget, WEB_SEARCH_SYSTEM_RULE/.test(src), "the runner imports the executor from its ONE home");
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
