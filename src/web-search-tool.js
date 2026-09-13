/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * THE `web` NAMESPACE EXECUTOR — one action, `web_search({query, recency})`.
 *
 * WHY A MODULE AND NOT A BRANCH IN THE RUNNER: `src/agent-runner.js` delegates by
 * NAMESPACE and must never grow a switch over an id from another namespace (LAW 1).
 * Everything that makes a web search safe for an agent lives here, once.
 *
 * WHAT MAKES IT SAFE — the field-agent discipline, IN CODE rather than in a prompt
 * sentence the model may ignore:
 *
 *  1. IDENTIFIER-LEAK REFUSAL, BEFORE ANY REQUEST. The query is checked against ONE
 *     regex table (IDENTIFIER_PATTERNS). A query carrying an Atlassian account id, an
 *     `*.atlassian.net` host, a Jira issue key, a UUID or an e-mail address is REFUSED
 *     and never leaves the instance. The refusal names the KIND ("an issue key"), never
 *     the value — a refusal that echoes the identifier has leaked it into the model's
 *     transcript, the execution log and the operator's screen, which is the whole thing
 *     we were preventing. The ISSUE-KEY half is decided by the TENANT'S REAL PROJECT
 *     KEYS, read once per 30 s (F-395) — see findIdentifierLeak.
 *  2. REDUCTION. At most TOP_RESULTS rows survive, each trimmed to an ALLOW-LIST of
 *     fields, each snippet cut to SNIPPET_MAX_CHARS. The search engine's payload is not
 *     a shape we control and must never be forwarded verbatim into a context window.
 *  3. FENCING. Results are UNTRUSTED third-party text: they go back inside a fence and
 *     through `defangFence`, so a page that contains the literal fence marker (or a
 *     sentence addressed to the model) cannot break out of it.
 *  4. THE READING RULE travels WITH the result (RESULT_RULE), not only in the system
 *     prompt, because by round four the system prompt is far away and the tool message
 *     is right there.
 *  5. BUDGETS, three of them, each refusing with a NAMED reason instead of silently
 *     returning nothing: SEARCHES_PER_TURN per agent turn, WEB_SEARCH_MAX_PER_RUN per JOB
 *     OR LISTENER RUN (F-407 — a scoped job runs one turn per issue, so the turn budget
 *     alone let a 100-issue sweep search 300 times), and a tenant-wide 5-minute brake that
 *     counts every search the installation makes.
 *  6. The MCP toggle is the ONE gate (see AGENT_ACTION_NAMESPACES.web). It is a LIVE
 *     tenant setting, so it is checked HERE, at run time — a rule saved while web search
 *     was on stays saved when an admin turns it off; its web_search calls just refuse.
 */

import { defangFence } from "./memories.js";
import { WEB_SEARCH_MAX_PER_RUN, brakeRefusalText } from "./shared/registry-limits.js";
// THE LEAK TABLE IS NOT OURS (F-419): it lives in src/shared/identifier-leak.js so that the
// knowledge bake scans for the same identifiers this does. Re-exported here because the
// agent-side callers and the suite have always reached for it through this module.
import { findIdentifierLeak } from "./shared/identifier-leak.js";
export {
  IDENTIFIER_PATTERNS, IDENTIFIER_KINDS, NON_KEY_PREFIXES, PROJECT_KEY_CAP,
  normalizeProjectKeys, matchesTenantIssueKey, findIdentifierLeak, createProjectKeysMemo,
} from "./shared/identifier-leak.js";

const idx = () => import("./index.js");

/** At most this many result rows reach the model. */
export const TOP_RESULTS = 5;
/** Per-result snippet ceiling, in characters. */
export const SNIPPET_MAX_CHARS = 300;
/** Searches one agent turn may perform. Refused, by name, past this. */
export const SEARCHES_PER_TURN = 3;
/** Wall-clock ceiling for one search. Web search is slow (30-90 s on a cold query). */
export const SEARCH_TIMEOUT_MS = 20000;

/**
 * THE SENTENCE THAT RIDES WITH EVERY RESULT. A search engine returns PAGES; a model
 * that treats the first snippet as the answer is how a confident wrong version number
 * gets written onto somebody's issue.
 */
export const RESULT_RULE =
  "these are pages a search engine returned, not answers — name the link for anything you take, say plainly when none answers";

/**
 * THE SENTENCE ADDED TO THE SYSTEM PROMPT of any agent holding `web_search`. ONE
 * constant: `src/agent-runner.js` appends it, and nothing else retypes it.
 */
export const WEB_SEARCH_SYSTEM_RULE =
  "A version, behaviour or limitation claim that matters must come from a read (Jira, Confluence, a page you fetched), never from memory; when you could not check, say so.";

/** Recency → the search MCP's `tbs`-style hint. Unknown values mean "any". */
const RECENCY = { day: "qdr:d", week: "qdr:w", month: "qdr:m", year: "qdr:y" };

const clampSnippet = (v) => {
  const s = String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  return s.length > SNIPPET_MAX_CHARS ? `${s.slice(0, SNIPPET_MAX_CHARS)}…` : s;
};

/**
 * THE ALLOW-LIST. A search engine's row carries far more than this (positions, sitelinks,
 * ratings, image URLs, raw HTML). Four fields is what a model needs to cite a page, and
 * an allow-list is the only reduction that stays correct when the upstream shape changes.
 */
export const reduceResults = (rows) => (Array.isArray(rows) ? rows : [])
  .filter((r) => r && typeof r === "object")
  .slice(0, TOP_RESULTS)
  .map((r) => {
    const out = {
      title: clampSnippet(r.title || r.name || ""),
      link: String(r.link || r.url || "").slice(0, 500),
      snippet: clampSnippet(r.snippet || r.description || r.content || ""),
    };
    const date = r.date || r.published || r.publishedDate || null;
    if (date) out.date = String(date).slice(0, 40);
    return out;
  })
  .filter((r) => r.title || r.link);

/** The ceiling on the unstructured `note` fallback, in characters. Its own constant
 * rather than SNIPPET_MAX_CHARS: a note is a whole reply, not one row's snippet, and the
 * two ceilings move for different reasons. */
export const NOTE_MAX_CHARS = 1200;

/** clampSnippet's ceiling, made a parameter. Same whitespace collapse and ellipsis. */
export const clampTo = (v, max) => {
  const s = String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
};

/** The balanced-scan half of the extractor below. Separate so it stays readable, and so
 * the fenced case does not pay for it when the fence already answered. */
const firstBalanced = (body) => {
  const a = body.indexOf("{");
  const b = body.indexOf("[");
  const start = a < 0 ? b : (b < 0 ? a : Math.min(a, b));
  if (start < 0) return null;
  const open = body[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === open) depth++;
    else if (ch === close) { depth--; if (depth === 0) return body.slice(start, i + 1); }
  }
  return null;
};

/**
 * FIND THE JSON INSIDE WHATEVER THE BRIDGE SAID (F-444).
 *
 * The hosted `get-web-search-summaries` does NOT answer with a JSON body: it answers with
 * a SENTENCE ("Search summaries for "…" with 5 results:") wrapping a ```json fenced block.
 * The old parser accepted only a body that STARTS with `{`/`[`, so on this MCP it found no
 * rows on EVERY successful search — the 5-row cap, the field allow-list, the 300-char
 * snippet cut and the per-row defang were dead code, and the engine's whole payload reached
 * the model through the `note` instead.
 *
 * ONE extractor, two shapes, in this order:
 *   1. the first fenced block (```json … ``` or a bare ``` … ```), and
 *   2. otherwise the first BALANCED top-level `{…}` or `[…]` in the text.
 * Balance is counted with string- and escape-awareness, so a brace inside a title or a URL
 * cannot end the scan early. Returns null when there is nothing that even LOOKS like JSON;
 * it never throws and never parses — parsing is the caller's job.
 */
export const extractJsonBlock = (text) => {
  const body = typeof text === "string" ? text : "";
  if (!body) return null;
  const fenced = /```(?:json|JSON)?\s*\n?([\s\S]*?)```/.exec(body);
  const candidates = [];
  if (fenced && fenced[1] && fenced[1].trim()) candidates.push(fenced[1].trim());
  const balanced = firstBalanced(body);
  if (balanced) candidates.push(balanced);
  for (const c of candidates) if (c.startsWith("{") || c.startsWith("[")) return c;
  return null;
};

/**
 * Pull the result ROWS out of whatever envelope the hosted MCP returned. The bridge hands
 * back a STRING (`callBridgeTool`), which may be a JSON body, PROSE WRAPPING a fenced JSON
 * block (the hosted web-search MCP — F-444), or plain text on a niche query.
 *
 * Never throws: an unreadable body becomes `{ rows: [], raw, parsed: false }`, and
 * `parsed` is what the caller reports so that "the engine answered something we could not
 * read" is never dressed up as "the engine found nothing".
 */
export const parseSearchPayload = (text) => {
  const body = typeof text === "string" ? text : "";
  const trimmed = body.trim();
  if (!trimmed) return { rows: [], raw: "", envelope: null, parsed: false };
  const looksJson = trimmed.startsWith("{") || trimmed.startsWith("[");
  const candidate = looksJson ? trimmed : extractJsonBlock(trimmed);
  if (!candidate) return { rows: [], raw: trimmed, envelope: null, parsed: false };
  let parsed;
  try { parsed = JSON.parse(candidate); }
  catch {
    // A body that STARTED like JSON but did not parse may still carry a good fenced or
    // balanced block further down; a block we already extracted has nowhere else to look.
    const second = looksJson ? extractJsonBlock(trimmed) : null;
    if (!second || second === candidate) return { rows: [], raw: trimmed, envelope: null, parsed: false };
    try { parsed = JSON.parse(second); } catch { return { rows: [], raw: trimmed, envelope: null, parsed: false }; }
  }
  if (Array.isArray(parsed)) return { rows: parsed, raw: "", envelope: null, parsed: true };
  if (!parsed || typeof parsed !== "object") return { rows: [], raw: trimmed, envelope: null, parsed: false };
  const rows = ["organic", "results", "items", "webPages", "data"]
    .map((k) => parsed[k])
    .find((v) => Array.isArray(v));
  return { rows: Array.isArray(rows) ? rows : [], raw: rows ? "" : trimmed, envelope: parsed, parsed: true };
};

/**
 * Cache facts, only when the BRIDGE reports them. Never invented: a `cached:true` this
 * module made up would tell an operator the search cost nothing when it cost a call.
 */
export const cacheFieldsOf = (envelope) => {
  if (!envelope || typeof envelope !== "object") return {};
  const out = {};
  if (envelope.cached === true) out.cached = true;
  const at = envelope.searchedAt || envelope.fetchedAt || envelope.cachedAt || null;
  if (at) out.searchedAt = String(at).slice(0, 40);
  return out;
};

/**
 * THE PER-RUN BUDGET COUNTER. One object per agent run, created by the caller
 * (src/agent-runner.js) so that every executor a run holds shares one count. A plain
 * object rather than module state: module state on a warm Forge container is shared by
 * every run the container serves, which would brake the wrong tenant's agent.
 */
export const createSearchBudget = (max = SEARCHES_PER_TURN) => ({ used: 0, max: Math.max(0, Number(max) || 0) });

/**
 * THE PER-RUN CEILING (F-407). The counter above is per `runAgentTask` call — and a scoped
 * job calls that once PER ISSUE, so a 100-issue sweep could make 300 searches while every
 * individual turn stayed politely inside its three. A RUN is what an operator schedules
 * and reads a log row about, so a run gets one of these, created by the job or the listener
 * and carried into every turn of that run.
 *
 * Deliberately the same shape as the turn budget: the executor checks both and names which
 * one it hit, because "this turn has searched enough" and "this run has searched enough"
 * are different things to tell an operator.
 */
export const createRunSearchBudget = (max = WEB_SEARCH_MAX_PER_RUN) => ({ used: 0, max: Math.max(0, Number(max) || 0) });

/**
 * Build the `web` namespace executor for ONE agent run.
 *
 * `budget` is the shared counter above. `log` is the run's execution log — every refusal
 * is logged, because a tool that quietly returns nothing is indistinguishable from a
 * broken one, and an operator who cannot see the refusal cannot fix the query.
 *
 * `runBudget` (F-407) is the RUN's ceiling, shared by every turn of one job or listener
 * run; omitted, only the per-turn budget applies (a caller that has no run to speak of).
 *
 * `deps` are the seams to the instance — each an async function, each defaulting to the
 * real thing in src/index.js / src/listeners.js. They are seams rather than direct imports
 * so that the parts of this module that must never regress — the leak rule and the three
 * budgets — stay assertable with no Forge runtime at all:
 *   projectKeys     () => { ok, keys }  the tenant's real project keys       (F-395)
 *   mcpEnabled      () => boolean       the live web-search MCP toggle
 *   webSearchBrake  () => { braked, max, reason }  the tenant 5-minute brake (F-407)
 *   callBridgeTool  (mcp, tool, args) => string    the hosted MCP call
 */
export const createWebSearchExecutor = ({ budget = createSearchBudget(), runBudget = null, log = () => {}, deadline = null, deps = {} } = {}) => ({
  namespace: "web",
  budget,
  execute: async (name, args) => {
    if (name !== "web_search") return { success: false, code: "unknown_action", error: `"${name}" is not a web action.` };
    const query = String((args && args.query) || "").trim().slice(0, 400);
    if (!query) return { success: false, code: "empty_query", error: "web_search needs a non-empty query." };

    // (1) THE LEAK CHECK RUNS FIRST — before the MCP lookup, before the budget, before
    // anything that could be mistaken for "the request already started".
    //
    // The tenant's project keys decide the issue-key half (F-395). The read is memoised
    // for 30 s in src/index.js, so this costs one REST call per container per half-minute,
    // not one per search. If it fails or throws, `ok:false` makes the check fall back to
    // the SHAPE rule, which REFUSES — a site we could not describe is not a site we guess
    // about.
    let projectKeys = { ok: false, keys: [] };
    try {
      const read = typeof deps.projectKeys === "function"
        ? deps.projectKeys
        : async () => (await idx()).getTenantProjectKeys();
      const r = await read();
      if (r && r.ok === true && Array.isArray(r.keys)) projectKeys = r;
    } catch { projectKeys = { ok: false, keys: [] }; }
    const leak = findIdentifierLeak(query, { projectKeys });
    if (leak) {
      log(`web_search REFUSED — the query contained ${leak.kind} (the value is not recorded).`);
      return { success: false, code: `identifier_leak:${leak.id}`, error: leak.message, rule: RESULT_RULE };
    }

    if (budget.used >= budget.max) {
      const error = `Refused: this turn's web-search budget is spent (${budget.max} search${budget.max === 1 ? "" : "es"} per turn). Work with what the previous searches returned, or say plainly that you could not check.`;
      log(`web_search REFUSED — turn budget spent (${budget.used}/${budget.max}).`);
      return { success: false, code: "budget_spent", error, rule: RESULT_RULE };
    }

    // (2b) THE RUN CEILING (F-407). Named separately from the turn budget: an operator
    // reading "this run has searched ten times" knows to narrow the scope, and one reading
    // "this turn has searched three times" knows the agent is looping.
    if (runBudget && runBudget.used >= runBudget.max) {
      const error = `Refused: ${brakeRefusalText("web-searches-run", runBudget.max)}`;
      log(`web_search REFUSED — the RUN's search ceiling is spent (${runBudget.used}/${runBudget.max}).`);
      return { success: false, code: "run_budget_spent", brake: { kind: "web-searches-run", max: runBudget.max, reason: error }, error, rule: RESULT_RULE };
    }

    const enabledRead = typeof deps.mcpEnabled === "function"
      ? deps.mcpEnabled
      : async () => { const m0 = await idx(); return typeof m0.mcpEnabled === "function" && (await m0.mcpEnabled("webSearch")); };
    if (!(await enabledRead())) {
      log("web_search REFUSED — the web-search MCP is switched off for this instance.");
      return { success: false, code: "mcp_off", error: "Refused: web search is not enabled on this instance (an admin turns it on in CogniRunner Settings → MCP). Say plainly that you could not check.", rule: RESULT_RULE };
    }

    // (2c) THE TENANT-WIDE SEARCH BRAKE (F-407), taken LAST — after the leak check, both
    // budgets and the MCP toggle — so that a refused query never spends the installation's
    // allowance. Same 5-minute bucket mechanism as the agent-run brake, from its one home
    // in src/listeners.js; a seam, like the project-key read, so this module stays testable
    // with no Forge runtime. A brake that cannot be read does NOT refuse: the two budgets
    // above are already hard ceilings, and a KVS hiccup must not silence every agent.
    try {
      const take = typeof deps.webSearchBrake === "function"
        ? deps.webSearchBrake
        : async () => (await import("./listeners.js")).takeWebSearchSlot();
      const slot = await take();
      if (slot && slot.braked) {
        log(`web_search REFUSED — the installation's 5-minute search brake is tripped (${slot.max}).`);
        return { success: false, code: "brake:web-searches", brake: { kind: "web-searches", max: slot.max, reason: slot.reason }, error: `Refused: ${slot.reason}`, rule: RESULT_RULE };
      }
    } catch { /* the brake could not be read — see above */ }

    budget.used++;
    if (runBudget) runBudget.used++;
    const params = { query };
    const tbs = RECENCY[String((args && args.recency) || "any")];
    if (tbs) params.tbs = tbs;

    const remaining = deadline ? deadline - Date.now() - 2000 : SEARCH_TIMEOUT_MS;
    const waitMs = Math.max(3000, Math.min(SEARCH_TIMEOUT_MS, remaining));
    let text;
    try {
      const TIMED_OUT = Symbol("web-search-timeout");
      const call = typeof deps.callBridgeTool === "function"
        ? deps.callBridgeTool
        : async (...a) => (await idx()).callBridgeTool(...a);
      const raced = await Promise.race([
        call("webSearch", "get-web-search-summaries", params),
        new Promise((resolve) => setTimeout(() => resolve(TIMED_OUT), waitMs)),
      ]);
      if (raced === TIMED_OUT) {
        log(`web_search timed out after ${Math.round(waitMs / 1000)}s`);
        return { success: false, code: "timeout", error: `Refused: the search did not answer within ${Math.round(waitMs / 1000)}s. Say plainly that you could not check.`, rule: RESULT_RULE };
      }
      text = typeof raced === "string" ? raced : "";
    } catch (e) {
      log(`web_search failed: ${String((e && e.message) || e).slice(0, 200)}`);
      return { success: false, code: "search_failed", error: `Refused: the search failed (${String((e && e.message) || e).slice(0, 160)}). Say plainly that you could not check.`, rule: RESULT_RULE };
    }

    // The bridge's own error envelope. Surface it as a failure — a denial rendered as
    // "no results" reads to the model as "the claim is unsupported", which is a lie.
    if (text.trim().startsWith("{") && text.includes('"error"')) {
      let err = "";
      try { err = String(JSON.parse(text).error || ""); } catch { err = ""; }
      if (err) {
        log(`web_search error: ${err.slice(0, 160)}`);
        return { success: false, code: "search_error", error: `Refused: the search service returned an error (${err.slice(0, 160)}). Say plainly that you could not check.`, rule: RESULT_RULE };
      }
    }

    const { rows, raw, envelope, parsed } = parseSearchPayload(text);
    const results = reduceResults(rows);
    const cache = cacheFieldsOf(envelope);
    // The log line says whether the body was READ, not only how many rows survived: on the
    // hosted MCP every successful search used to log "0 result(s)" while the model got the
    // whole payload through the note (F-444), and an operator could not tell the two apart.
    log(`web_search "${query.slice(0, 120)}" → ${results.length} result(s)${parsed ? "" : " (unstructured reply — nothing parsed)"}${cache.cached ? " (cached)" : ""} [turn ${budget.used}/${budget.max}${runBudget ? `, run ${runBudget.used}/${runBudget.max}` : ""}]`);

    if (!results.length) {
      // THE FALLBACK, AND IT IS A FALLBACK. `parsed:false` is reported so that a count of 0
      // is never read as "the engine found nothing" when the truth is "we could not read
      // what the engine said". The note itself is third-party text: CLAMPED to
      // NOTE_MAX_CHARS and DEFANGED, so it can neither flood the context window nor carry
      // a literal fence marker out of its fence.
      return {
        success: true, query, results: [], count: 0, parsed: parsed === true, ...cache, rule: RESULT_RULE,
        note: raw
          ? `The search returned no structured results. Unstructured reply, truncated, fenced and untrusted:\n<<<WEB_RESULTS\n${defangFence(clampTo(raw, NOTE_MAX_CHARS))}\nWEB_RESULTS>>>`
          : "The search returned nothing for this query. That is not evidence the claim is false — say plainly that you could not check.",
      };
    }

    // (3) FENCED + DEFANGED. Everything below is third-party text.
    const fenced = results
      .map((r, i) => `${i + 1}. ${defangFence(r.title)}\n   ${defangFence(r.link)}\n   ${defangFence(r.snippet)}${r.date ? `\n   (${defangFence(r.date)})` : ""}`)
      .join("\n");
    return {
      success: true,
      query,
      count: results.length,
      parsed: true,
      ...cache,
      rule: RESULT_RULE,
      results: `<<<WEB_RESULTS\n${fenced}\nWEB_RESULTS>>>`,
      searchesLeft: Math.max(0, Math.min(budget.max - budget.used, runBudget ? runBudget.max - runBudget.used : Infinity)),
    };
  },
});
