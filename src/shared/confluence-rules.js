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
 * THE SHARED VOCABULARY OF THE CONFLUENCE PREMADE RULES (1.5 commit 7).
 *
 * Dependency-free (shared/ only) so it bundles into the backend AND the three Custom
 * UIs, exactly like premade-rules-catalog.js and sandbox-api-spec.js. It holds two
 * things, and it is the ONE home of both:
 *
 *   1. THE CQL ESCAPER AND THE TEMPLATE RENDERER. Every value that reaches a CQL
 *      string — an issue key, a summary, a field value — goes through `cqlQuote`,
 *      once, here. A second escaper anywhere is the defect.
 *   2. THE ADVISORY `cognirunner.confluence` ISSUE PROPERTY: its key, its bounds and
 *      the pure builder of its value. The validator writes it, the post-function
 *      writes it, the workflow CONDITION reads it in the manifest expression.
 *
 * ⚠️ THE PROPERTY IS ADVISORY — say it next to every reader and every writer.
 * It is the last Confluence page this app SAW for an issue, not a fact it can vouch
 * for: anyone who can edit the issue can write it, and a missing property means
 * "nothing seen", never "no page exists". A workflow CONDITION may read it (it is
 * cheap, it cannot make a network call, and it only decides what a screen shows); the
 * VALIDATOR never does — it searches Confluence LIVE on the transition and only then
 * writes the property. Same rule, and same reason, as `cognirunner.git`
 * (src/listeners.js, "THE PROPERTY IS ADVISORY").
 */

import { clampChars } from "./text-clamp.js";

/* ── The advisory issue property ──────────────────────────────────────────── */

export const CONFLUENCE_PROPERTY_KEY = "cognirunner.confluence";
/** Bumped only when the SHAPE changes. The condition expression refuses any other
 *  version and SHOWS the transition rather than guessing (the F-365 pattern). */
export const CONFLUENCE_PROPERTY_VERSION = 1;
export const CONFLUENCE_PROPERTY_TITLE_MAX = 255;
export const CONFLUENCE_PROPERTY_URL_MAX = 512;
export const CONFLUENCE_PROPERTY_ID_MAX = 64;
/** A property that grows without a cap is a 32 KB failure on somebody's busiest issue,
 *  months later. Every field above is clamped, so this is a belt-and-braces assertion. */
export const CONFLUENCE_PROPERTY_MAX_BYTES = 2048;

/**
 * The value to PUT on the issue, from one page. PURE — testable without Jira.
 *
 * Returns null when there is no page id, because a property that says "a page was
 * checked" without naming one is exactly the state the condition would misread.
 */
export const confluencePropertyValue = (page, checkedAt = new Date().toISOString()) => {
  const pageId = clampChars(String((page && page.id) || "").trim(), CONFLUENCE_PROPERTY_ID_MAX);
  if (!pageId) return null;
  return {
    version: CONFLUENCE_PROPERTY_VERSION,
    pageId,
    title: clampChars(String((page && page.title) || "").trim(), CONFLUENCE_PROPERTY_TITLE_MAX),
    url: clampChars(String((page && page.url) || "").trim(), CONFLUENCE_PROPERTY_URL_MAX),
    checkedAt: String(checkedAt),
  };
};

/* ── CQL: the ONE escaper and the ONE template renderer ───────────────────── */

/** Per substituted value. A summary is unbounded user text and ends up in a URL. */
export const CQL_VALUE_MAX_CHARS = 200;
/** The whole rendered query. */
export const CQL_MAX_CHARS = 2000;

/**
 * ONE ESCAPER. Returns a QUOTED CQL string literal, always — callers never add their
 * own quotes, because "sometimes quoted" is how an injection gets in.
 *
 * Backslash first, then the double quote: reversing those two double-escapes every
 * quote and produces a query Confluence rejects. Control characters (a newline pasted
 * into a summary) become spaces — CQL has no escape for them and an unterminated
 * literal is a 400, which this rule reads as misconfiguration and BLOCKS on.
 *
 * Operators are NOT special inside a literal: a summary of `foo AND bar` renders as
 * the four-word phrase "foo AND bar", not as a CQL conjunction. That is the whole
 * point of quoting, and the test asserts it.
 */
export const cqlQuote = (value, maxChars = CQL_VALUE_MAX_CHARS) => {
  const raw = clampChars(String(value == null ? "" : value), maxChars);
  // eslint-disable-next-line no-control-regex
  const flat = raw.replace(/[\u0000-\u001F\u007F]/g, " ");
  return `"${flat.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
};

/** The placeholders a template may use. Anything else is MISCONFIGURATION. */
export const CQL_PLACEHOLDER_RE = /\{(issueKey|summary|field:[A-Za-z0-9_]+)\}/g;
export const CQL_PLACEHOLDER_HELP =
  '{issueKey}, {summary} and {field:<fieldId>} are replaced by the issue’s values, each already quoted — write `title ~ {summary}`, never `title ~ "{summary}"`.';

/**
 * Render a CQL template. The TEMPLATE is the administrator's own text and is trusted
 * as query syntax; the VALUES substituted into it are untrusted issue content and are
 * quoted by `cqlQuote`. That is the whole security boundary of this rule, and it is
 * why the placeholders expand to a complete quoted literal: a template that had to
 * write its own quotes could be closed by a summary.
 *
 * `{field:x}` with no value becomes `""` rather than disappearing — an empty literal
 * matches nothing, which is a determinate answer; a vanished clause silently widens
 * the query.
 *
 * ⚠️ THE PLACEHOLDER SCAN RUNS ON THE TEMPLATE, BEFORE SUBSTITUTION, AND NEVER ON THE
 * RESULT. A brace is only a placeholder where the ADMINISTRATOR typed it; a brace that
 * arrives inside an issue summary (`Fix {code} rendering`, mustache, a pasted `{"json"}`)
 * is data, it is inside a quoted CQL literal after `cqlQuote`, and it is literal to
 * Confluence. Scanning the rendered query blamed the admin's template for a cause it did
 * not contain and BLOCKED the transition in BOTH strict columns, because misconfiguration
 * is not a fail-open degradation — that was F-450, and re-adding a scan over `out` brings
 * it straight back.
 *
 * @returns {{ok:true, cql:string} | {ok:false, reason:string}} — `ok:false` is
 *   MISCONFIGURATION, which the validator treats as a BLOCK regardless of `strict`.
 */
export const renderCqlTemplate = (template, values = {}) => {
  const src = String(template == null ? "" : template).trim();
  if (!src) return { ok: false, reason: "the rule has no CQL template" };
  // Unknown placeholders are judged on the TEMPLATE (see above): drop the ones we know
  // how to fill, and anything brace-shaped still standing is the admin's own typo.
  const leftover = src.replace(CQL_PLACEHOLDER_RE, "").match(/\{[^}\n]*\}/);
  if (leftover) {
    return { ok: false, reason: `the CQL template uses ${leftover[0]}, which is not a placeholder this rule can fill` };
  }
  const fields = (values && values.fields) || {};
  const out = src.replace(CQL_PLACEHOLDER_RE, (_m, name) => {
    if (name === "issueKey") return cqlQuote(values.issueKey || "");
    if (name === "summary") return cqlQuote(values.summary || "");
    return cqlQuote(fields[String(name).slice("field:".length)] || "");
  });
  if (out.length > CQL_MAX_CHARS) {
    return { ok: false, reason: `the rendered CQL is ${out.length} characters, over the ${CQL_MAX_CHARS} limit` };
  }
  return { ok: true, cql: out };
};

/**
 * The final query: the rule's space clause AND the rendered template, page type only.
 *
 * The space clause is added HERE and not left to the template so that "which space"
 * is a picked parameter the form can validate and the summary can state, rather than
 * a string an admin may forget — a template with no space clause searches the whole
 * site, which is not what "the page exists in this space" means.
 */
export const buildPageExistsCql = (spaceKey, template, values) => {
  const space = String(spaceKey == null ? "" : spaceKey).trim();
  if (!space) return { ok: false, reason: "the rule has no Confluence space" };
  const rendered = renderCqlTemplate(template, values);
  if (!rendered.ok) return rendered;
  return { ok: true, cql: `space = ${cqlQuote(space, 64)} AND type = page AND (${rendered.cql})` };
};

/** How many pages the SEMANTIC mode may read and put in front of a model (plan §3.12). */
export const SEMANTIC_MAX_PAGES = 3;

/* ── Plain-text templates (titles, comments) — NOT CQL ────────────────────── */

/** A page title, and the comment body a deterministic post-function writes. */
export const TITLE_MAX_CHARS = 200;

/**
 * The page title used when a rule names no template. ONE home (F-447): the page
 * post-function falls back to it at run time AND the rule form shows it as the default
 * in its placeholder, so a reader of the form sees the title their transition will
 * actually write. A second copy in the form is how the two start disagreeing.
 */
export const CONFLUENCE_DEFAULT_TITLE_TEMPLATE = "{issueKey} \u2014 {summary}";
export const COMMENT_TEMPLATE_MAX_CHARS = 2000;

/**
 * The SAME placeholders as a CQL template, substituted RAW.
 *
 * A title is not a query and a comment is not a query: there is no literal to close, so
 * quoting them would put stray `"` in the page title. The quoting in `cqlQuote` is not
 * "sanitisation we can reuse", it is CQL syntax — reusing it here would be the second
 * escaper this file exists to prevent, applied to the wrong grammar.
 *
 * The escaping these values DO need is the one their own destination needs, and it is
 * applied there: `storageEscape` before anything reaches a page body.
 */
export const renderTextTemplate = (template, values = {}, maxChars = TITLE_MAX_CHARS) => {
  const src = String(template == null ? "" : template);
  const fields = (values && values.fields) || {};
  const out = src.replace(CQL_PLACEHOLDER_RE, (_m, name) => {
    if (name === "issueKey") return String(values.issueKey || "");
    if (name === "summary") return String(values.summary || "");
    return String(fields[String(name).slice("field:".length)] || "");
  });
  return clampChars(out.replace(/\s+/g, " ").trim(), maxChars);
};

/* ── Markdown → Confluence storage ────────────────────────────────────────── */

const STORAGE_ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** Confluence storage format is XHTML. Everything model-authored is escaped first. */
export const storageEscape = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => STORAGE_ENTITIES[c]);

/**
 * A DELIBERATELY SMALL Markdown → storage converter for the page post-function.
 *
 * The doc generator (src/index.js generateDocContent) authors GitHub-flavored Markdown,
 * and Confluence's v2 page API takes XHTML "storage". Handing the markdown over raw
 * produces a page of literal `##` and `-`, which is not a document.
 *
 * WHAT IT HANDLES: `#`..`######` headings, `-`/`*` bullets, `1.` numbered lists,
 * fenced code blocks, blank-line-separated paragraphs, and inline `code`, `**bold**`
 * and `*italic*`. WHAT IT DOES NOT: tables, images, links, nested lists — those pass
 * through as escaped text rather than being half-rendered, because a half-parsed table
 * is worse than a plain one.
 *
 * EVERY piece of model-authored text is `storageEscape`d BEFORE any markup is added, so
 * a document that contains `<script>` or a Confluence macro tag becomes visible text and
 * never becomes markup. That ordering is the whole security property of this function.
 */
export const markdownToStorage = (markdown) => {
  const lines = String(markdown == null ? "" : markdown).split(/\r?\n/);
  const out = [];
  let para = [];
  let list = null; // "ul" | "ol"
  let code = null;
  const inline = (s) => storageEscape(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(" "))}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (/^\s*```/.test(line)) {
      if (code === null) { flushPara(); flushList(); code = []; }
      else { out.push(`<ac:structured-macro ac:name="code"><ac:plain-text-body><![CDATA[${code.join("\n").replace(/\]\]>/g, "]]&gt;")}]]></ac:plain-text-body></ac:structured-macro>`); code = null; }
      continue;
    }
    if (code !== null) { code.push(raw); continue; }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { flushPara(); flushList(); const n = h[1].length; out.push(`<h${n}>${inline(h[2])}</h${n}>`); continue; }
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      const want = ul ? "ul" : "ol";
      if (list !== want) { flushList(); out.push(`<${want}>`); list = want; }
      out.push(`<li>${inline((ul || ol)[1])}</li>`);
      continue;
    }
    if (!line.trim()) { flushPara(); flushList(); continue; }
    para.push(line.trim());
  }
  if (code !== null) out.push(`<ac:structured-macro ac:name="code"><ac:plain-text-body><![CDATA[${code.join("\n").replace(/\]\]>/g, "]]&gt;")}]]></ac:plain-text-body></ac:structured-macro>`);
  flushPara();
  flushList();
  return out.join("\n");
};

/**
 * The remote link's `globalId` (1.5 commit 7d). DETERMINISTIC on (issue, page), which is
 * what makes the Jira remote-link API UPDATE the existing link instead of adding a
 * second one every time the rule runs. Without it, a transition an issue takes ten times
 * leaves ten identical links.
 */
export const confluenceRemoteLinkGlobalId = (issueKey, pageId) =>
  `cognirunner-confluence:${String(issueKey || "")}:${String(pageId || "")}`;
