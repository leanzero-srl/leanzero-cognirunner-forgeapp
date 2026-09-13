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
 *     we were preventing.
 *  2. REDUCTION. At most TOP_RESULTS rows survive, each trimmed to an ALLOW-LIST of
 *     fields, each snippet cut to SNIPPET_MAX_CHARS. The search engine's payload is not
 *     a shape we control and must never be forwarded verbatim into a context window.
 *  3. FENCING. Results are UNTRUSTED third-party text: they go back inside a fence and
 *     through `defangFence`, so a page that contains the literal fence marker (or a
 *     sentence addressed to the model) cannot break out of it.
 *  4. THE READING RULE travels WITH the result (RESULT_RULE), not only in the system
 *     prompt, because by round four the system prompt is far away and the tool message
 *     is right there.
 *  5. BUDGET. SEARCHES_PER_TURN per run, counted by the counter the caller creates; past
 *     it the tool refuses with a NAMED reason instead of silently returning nothing.
 *  6. The MCP toggle is the ONE gate (see AGENT_ACTION_NAMESPACES.web). It is a LIVE
 *     tenant setting, so it is checked HERE, at run time — a rule saved while web search
 *     was on stays saved when an admin turns it off; its web_search calls just refuse.
 */

import { defangFence } from "./memories.js";

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

/**
 * THE ONE REGEX TABLE. Each row is { id, kind, re } where `kind` is the sentence
 * fragment the refusal uses — the refusal says the KIND and never the VALUE.
 *
 * Order matters only for which kind is REPORTED first; every row is evaluated against
 * the raw query, so a query with two kinds is refused for the first one listed.
 */
export const IDENTIFIER_PATTERNS = Object.freeze([
  // Atlassian account id: the `712020:` (or any numeric realm) prefix followed by hex.
  { id: "accountId", kind: "an Atlassian account id", re: /\b\d{6}:[0-9a-fA-F]{8}/ },
  // Any Atlassian Cloud site host — naming the tenant is naming the customer.
  { id: "atlassianHost", kind: "an Atlassian site address", re: /\b[A-Za-z0-9][A-Za-z0-9-]*\.atlassian\.net\b/ },
  { id: "email", kind: "an e-mail address", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/ },
  { id: "uuid", kind: "a UUID", re: /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/ },
  // Jira issue key. See NON_KEY_PREFIXES below for why this one needs a deny-list.
  { id: "issueKey", kind: "a Jira issue key", re: /\b[A-Z][A-Z0-9_]{1,9}-\d{1,6}\b/ },
]);

/**
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
 */
export const NON_KEY_PREFIXES = Object.freeze(new Set([
  "UTF", "ISO", "RFC", "CVE", "CWE", "HTTP", "HTTPS", "TLS", "SSL", "SHA", "MD", "AES", "RSA",
  "IPV", "IPV4", "IPV6", "PEP", "JSR", "JDK", "JEP", "ES", "ECMA", "CSS", "HTML", "SQL", "ADF",
  "PDF", "GPT", "LTS", "API", "AWS", "GCP", "OWASP", "NIST", "GDPR", "WCAG", "ARIA", "USB",
  "PCI", "DSS", "SOC", "PY", "NODE", "PHP", "CVSS", "SPDX", "PNG", "JPEG", "WEBP", "SVG",
]));

/**
 * Refusal check. Returns `null` when the query is clean, or
 * `{ id, kind, message }` when it is not. NEVER returns the offending text.
 */
export const findIdentifierLeak = (query) => {
  const q = String(query == null ? "" : query);
  for (const row of IDENTIFIER_PATTERNS) {
    const m = q.match(row.re);
    if (!m) continue;
    if (row.id === "issueKey") {
      // Subtract the public-standard shapes. `m[0]` is examined here and DISCARDED —
      // it is never put into the refusal, the log or the tool result.
      const prefix = String(m[0]).split("-")[0].toUpperCase();
      if (NON_KEY_PREFIXES.has(prefix)) continue;
    }
    return {
      id: row.id,
      kind: row.kind,
      message: `Refused: the query contains ${row.kind} from this Jira instance. Nothing was sent to the search engine. Search for the PUBLIC subject only — describe the product, the version, the API or the error text in general terms, with no identifier from this site in it.`,
    };
  }
  return null;
};

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

/**
 * Pull the result ROWS out of whatever envelope the hosted MCP returned. The bridge
 * hands back a STRING (`callBridgeTool`), which is usually JSON but is plain text on a
 * niche query. Never throws: an unparsable body becomes `{ rows: [], raw }` and the
 * caller reports honestly that there was nothing structured to read.
 */
export const parseSearchPayload = (text) => {
  const body = typeof text === "string" ? text : "";
  const trimmed = body.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return { rows: [], raw: trimmed, envelope: null };
  let parsed;
  try { parsed = JSON.parse(trimmed); } catch { return { rows: [], raw: trimmed, envelope: null }; }
  if (Array.isArray(parsed)) return { rows: parsed, raw: "", envelope: null };
  const rows = ["organic", "results", "items", "webPages", "data"]
    .map((k) => parsed[k])
    .find((v) => Array.isArray(v));
  return { rows: Array.isArray(rows) ? rows : [], raw: rows ? "" : trimmed, envelope: parsed };
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
 * Build the `web` namespace executor for ONE agent run.
 *
 * `budget` is the shared counter above. `log` is the run's execution log — every refusal
 * is logged, because a tool that quietly returns nothing is indistinguishable from a
 * broken one, and an operator who cannot see the refusal cannot fix the query.
 */
export const createWebSearchExecutor = ({ budget = createSearchBudget(), log = () => {}, deadline = null } = {}) => ({
  namespace: "web",
  budget,
  execute: async (name, args) => {
    if (name !== "web_search") return { success: false, code: "unknown_action", error: `"${name}" is not a web action.` };
    const query = String((args && args.query) || "").trim().slice(0, 400);
    if (!query) return { success: false, code: "empty_query", error: "web_search needs a non-empty query." };

    // (1) THE LEAK CHECK RUNS FIRST — before the MCP lookup, before the budget, before
    // anything that could be mistaken for "the request already started".
    const leak = findIdentifierLeak(query);
    if (leak) {
      log(`web_search REFUSED — the query contained ${leak.kind} (the value is not recorded).`);
      return { success: false, code: `identifier_leak:${leak.id}`, error: leak.message, rule: RESULT_RULE };
    }

    if (budget.used >= budget.max) {
      const error = `Refused: this run's web-search budget is spent (${budget.max} search${budget.max === 1 ? "" : "es"} per run). Work with what the previous searches returned, or say plainly that you could not check.`;
      log(`web_search REFUSED — budget spent (${budget.used}/${budget.max}).`);
      return { success: false, code: "budget_spent", error, rule: RESULT_RULE };
    }

    const m = await idx();
    if (typeof m.mcpEnabled !== "function" || !(await m.mcpEnabled("webSearch"))) {
      log("web_search REFUSED — the web-search MCP is switched off for this instance.");
      return { success: false, code: "mcp_off", error: "Refused: web search is not enabled on this instance (an admin turns it on in CogniRunner Settings → MCP). Say plainly that you could not check.", rule: RESULT_RULE };
    }

    budget.used++;
    const params = { query };
    const tbs = RECENCY[String((args && args.recency) || "any")];
    if (tbs) params.tbs = tbs;

    const remaining = deadline ? deadline - Date.now() - 2000 : SEARCH_TIMEOUT_MS;
    const waitMs = Math.max(3000, Math.min(SEARCH_TIMEOUT_MS, remaining));
    let text;
    try {
      const TIMED_OUT = Symbol("web-search-timeout");
      const raced = await Promise.race([
        m.callBridgeTool("webSearch", "get-web-search-summaries", params),
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

    const { rows, raw, envelope } = parseSearchPayload(text);
    const results = reduceResults(rows);
    const cache = cacheFieldsOf(envelope);
    log(`web_search "${query.slice(0, 120)}" → ${results.length} result(s)${cache.cached ? " (cached)" : ""} [${budget.used}/${budget.max}]`);

    if (!results.length) {
      return {
        success: true, query, results: [], count: 0, ...cache, rule: RESULT_RULE,
        note: raw
          ? `The search returned no structured results. Unstructured reply, fenced and untrusted:\n<<<WEB_RESULTS\n${defangFence(clampSnippet(raw))}\nWEB_RESULTS>>>`
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
      ...cache,
      rule: RESULT_RULE,
      results: `<<<WEB_RESULTS\n${fenced}\nWEB_RESULTS>>>`,
      searchesLeft: Math.max(0, budget.max - budget.used),
    };
  },
});
