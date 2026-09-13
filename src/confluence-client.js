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

/*
 * CONFLUENCE CLIENT — the SINGLE home of every call CogniRunner makes to
 * Confluence. Release 1.5 commit 6a (plan §3.12, FRAME "Confluence REST, error
 * mapping, confluence_unavailable").
 *
 * NOTHING ELSE MAY CALL `requestConfluence`. The sandbox, the agent actions, the
 * validator and the post-functions all come through here; a second call site is
 * a finding. That is what makes the error mapping, the budget, the caps and the
 * no-retry-on-write rule true for the whole app instead of true in one place.
 *
 * The endpoint shapes this module uses are documented ONCE in
 * `src/shared/confluence-endpoints.js` — the catalogue the picker and the AI
 * prompts also read. Paths are built here from that same surface; a path that
 * is not in the catalogue should not be added here without adding it there.
 *
 * Contracts this module is the enforcement point for:
 *
 *  - ONE error type, `ConfluenceError`, with a closed code set:
 *    confluence_unavailable | auth | not_found | conflict | rate_limited |
 *    network | invalid.
 *
 *  - THE INSTALL-STATE DIRECTION IS FAIL-OPEN, DELIBERATELY (probe P2 is still
 *    open). The app ships as a Jira app; Confluence is an OPTIONAL product
 *    (`compatibility.confluence.required:false`), and nobody has yet captured
 *    what a Cloud site answers when the app is not installed on Confluence —
 *    only the success path is proven (`src/test-hook.js` probeConfluence → 200
 *    after `forge install -p Confluence`). So `statusToCode` sends ANY status it
 *    does not positively recognise — every 5xx, every 3xx, every unexpected
 *    code — to `confluence_unavailable`, and on the install PROBE it sends any
 *    non-2xx there, INCLUDING 404. Being over-broad about "unavailable" is the
 *    correct direction: per the F-416 degradation table a validator that cannot
 *    reach Confluence fails OPEN with the reason, so an over-broad
 *    `confluence_unavailable` lets a transition through with an explanation,
 *    while an over-broad `not_found` would read as "the page does not exist"
 *    and BLOCK — the proven-negative trap. Narrow this only when the real
 *    not-installed response text has been captured.
 *
 *  - WRITES ARE NEVER RETRIED. A retried POST is a duplicate page or a duplicate
 *    comment. Reads retry at most once, and only on `network` or `rate_limited`.
 *
 *  - 10 s per logical operation (`CONFLUENCE_OPERATION_BUDGET_MS`), shared by
 *    every HTTP call an operation chains, and a 10 s per-call wall clock
 *    (AbortController). `getPageByTitle` and `createPage` are two calls each:
 *    two independent 10 s timeouts would be a 20 s operation inside a 25 s sync
 *    resolver, so the BUDGET — not the per-call timeout — is what bounds them.
 *
 *  - `updatePage` is VERSION-CHECKED. A blind update is a lost edit. When the
 *    caller does not supply a title we read the page first and refuse BEFORE
 *    the write if the version moved (`conflict`); when it does, the 409 from
 *    Confluence maps to the same code. Never retried either way.
 *
 *  - Response bodies are CLAMPED BEFORE PARSING (1 MB), and page text is clamped
 *    to 60 KB by the ONE html→text reducer in this file (`storageToText`).
 *
 * ⚠ WHAT THIS MODULE GUARANTEES: BOUNDED, NOT SANITISED.
 * A page title, a page body, an excerpt and a comment are all user-authored
 * content from another product. This module size-caps and shape-normalises them
 * and DOES NOT fence or defang them — `text` handed to a caller is raw.
 * A CALLER THAT PUTS ANY OF IT IN A PROMPT MUST FENCE IT AND RUN `defangFence()`
 * ITSELF (`src/memories.js`), exactly as the git review engine does with a PR
 * body. Defanging here would corrupt the content we also write back to pages.
 *
 * NO FORGE RUNTIME AT MODULE LOAD, on purpose: `@forge/api` is imported lazily
 * inside the default transport only, so the offline mocked-fetch suite
 * (test-harness/scripts/confluence-client.test.mjs) can exercise every path with
 * no @forge/* module available. Every request goes through an injectable
 * `deps.request`.
 */
import { clampUtf8Bytes } from "./shared/text-clamp.js";

/** The closed error-code set. Anything outside it is a bug in this file. */
export const CONFLUENCE_ERROR_CODES = [
  "confluence_unavailable",
  "auth",
  "not_found",
  "conflict",
  "rate_limited",
  "network",
  "invalid",
];

/** Per-call wall clock and per-operation budget. Both well under the 25 s sync resolver cap. */
export const CONFLUENCE_CALL_TIMEOUT_MS = 10000;
export const CONFLUENCE_OPERATION_BUDGET_MS = 10000;

/** Page text handed to a caller (plan §3.12: "storage + plain text ≤ 60 KB"). */
export const PAGE_TEXT_MAX_BYTES = 60 * 1024;
/** Storage (XHTML) body kept alongside the text — same budget, it feeds an update. */
export const PAGE_STORAGE_MAX_BYTES = 60 * 1024;
/** A response we will not even try to parse. Bigger than any page we ask for. */
export const RESPONSE_MAX_BYTES = 1024 * 1024;
/** CQL results per call. Every result ends up in a prompt. */
export const SEARCH_MAX_LIMIT = 25;
/** Spaces offered in a rule's space PICKER. A dropdown, not a directory listing. */
export const SPACE_LIST_MAX = 100;
/** Comment body written to a page. */
export const COMMENT_MAX_BYTES = 32 * 1024;

/** The install probe — the same entry the catalogue documents. */
export const INSTALL_PROBE_PATH = "/wiki/api/v2/spaces?limit=1";

/**
 * The one error every method throws. `code` is from CONFLUENCE_ERROR_CODES,
 * `status` is the HTTP status when there was one, `timeout` marks our own abort.
 */
export class ConfluenceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ConfluenceError";
    // An unknown code is a bug here; default to the fail-open direction rather
    // than to something a validator would read as a definite answer.
    this.code = CONFLUENCE_ERROR_CODES.includes(code) ? code : "confluence_unavailable";
    this.operation = details.operation || null;
    this.status = typeof details.status === "number" ? details.status : null;
    this.timeout = details.timeout === true;
    this.retryAfterSeconds =
      typeof details.retryAfterSeconds === "number" ? details.retryAfterSeconds : null;
  }
}

/**
 * Status → code. THE table. Read the fail-open note in the file header first.
 *
 * @param {number} status
 * @param {{ installProbe?: boolean }} [opts] on the install probe ANY non-2xx is
 *   `confluence_unavailable`, including 404: a 404 there means "this site has no
 *   Confluence for us", not "a space is missing".
 */
export function statusToCode(status, opts = {}) {
  const s = Number(status);
  if (Number.isFinite(s) && s >= 200 && s < 300) return null;
  if (opts.installProbe) return "confluence_unavailable";
  if (s === 400 || s === 405 || s === 415 || s === 422) return "invalid";
  if (s === 401 || s === 403) return "auth";
  if (s === 404) return "not_found";
  if (s === 409 || s === 412) return "conflict";
  if (s === 429) return "rate_limited";
  // 5xx, 3xx, 0, anything unrecognised: we cannot tell an outage from a site
  // that never installed us, and "unavailable" is the fail-open answer.
  return "confluence_unavailable";
}

const isWriteMethod = (method) => method !== "GET" && method !== "HEAD";

const enc = (v) => encodeURIComponent(String(v == null ? "" : v));

/** Minimal entity set — enough for text Confluence actually emits in storage format. */
const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘",
  ldquo: "“", rdquo: "”",
};

/**
 * THE ONE html→text reducer for this app's Confluence content. One home, because
 * a second copy is how two callers end up disagreeing about whether a heading
 * keeps its newline — and the text is what a model reads.
 *
 * Deliberately NOT a parser: storage format is XHTML-ish but arbitrary, and a
 * regex reducer cannot be made to execute anything. Blocks that carry no prose
 * (script, style, and Confluence's structured-macro parameter noise) are dropped
 * whole; block-level tags become newlines; everything else loses its tags.
 *
 * The result is RAW USER CONTENT — bounded, not sanitised. Fence and defang at
 * the prompt seam, not here.
 *
 * @returns {{ text: string, truncated: boolean }} clamped to `maxBytes`.
 */
export function storageToText(html, maxBytes = PAGE_TEXT_MAX_BYTES) {
  let s = String(html == null ? "" : html);
  // Drop whole non-prose blocks first, so their contents never reach the output.
  s = s.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<ac:parameter\b[^>]*>[\s\S]*?<\/ac:parameter>/gi, " ");
  // Block-level boundaries become newlines so paragraphs and list items survive.
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|li|tr|h[1-6]|blockquote|pre|td|th|table|ul|ol|section)\s*>/gi, "\n");
  s = s.replace(/<(hr)\s*\/?>/gi, "\n");
  // Everything else: tags out, text kept.
  s = s.replace(/<[^>]*>/g, "");
  // Entities last, so a decoded "<" can never re-introduce a tag.
  s = s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, ent) => {
    if (ent[0] === "#") {
      const cp = ent[1] === "x" || ent[1] === "X"
        ? parseInt(ent.slice(2), 16)
        : parseInt(ent.slice(1), 10);
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff) return m;
      try { return String.fromCodePoint(cp); } catch (_) { return m; }
    }
    const hit = ENTITIES[ent.toLowerCase()];
    return hit === undefined ? m : hit;
  });
  // Collapse the whitespace storage format is full of, but keep paragraph breaks.
  s = s.replace(/[ \t\r\f\v]+/g, " ");
  s = s.replace(/ *\n[ \n]*/g, "\n");
  s = s.trim();
  return clampUtf8Bytes(s, maxBytes, "\n… [page text truncated at 60 KB]");
}

/**
 * Build a Confluence client.
 *
 * @param {object} [deps]
 * @param {(path: string, init: object) => Promise<{status:number, ok?:boolean, headers?:any, text:() => Promise<string>}>} [deps.request]
 *   The transport. Injected by the offline suite; defaults to
 *   `asApp().requestConfluence(path, init)`. The path handed to it is ALREADY
 *   fully encoded by this module (every dynamic segment and query value goes
 *   through encodeURIComponent), which is why it is passed as a plain string
 *   rather than through the `route` tag — `route` would percent-encode an
 *   interpolated whole path a second time. This matches the existing plain-path
 *   call idiom in src/coder-workspace.js and src/index.js.
 * @param {number} [deps.timeoutMs]
 * @param {(ms:number)=>Promise<void>} [deps.sleep]
 */
export function createConfluenceClient(deps = {}) {
  const timeoutMs =
    typeof deps.timeoutMs === "number" && deps.timeoutMs > 0 ? deps.timeoutMs : CONFLUENCE_CALL_TIMEOUT_MS;
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));

  const transport =
    deps.request ||
    (async (path, init) => {
      const { default: api } = await import("@forge/api");
      return api.asApp().requestConfluence(path, init);
    });

  const fail = (code, message, details = {}) => new ConfluenceError(code, message, details);

  // ONE budget per logical OPERATION, shared by every call it chains. Nesting
  // can only ever TIGHTEN it.
  let budgetDeadline = null;
  async function withBudget(totalMs, fn) {
    const prev = budgetDeadline;
    const want = Date.now() + (typeof totalMs === "number" && totalMs > 0 ? totalMs : CONFLUENCE_OPERATION_BUDGET_MS);
    budgetDeadline = prev === null ? want : Math.min(prev, want);
    try {
      return await fn();
    } finally {
      budgetDeadline = prev;
    }
  }

  const headerOf = (headers, name) => {
    if (!headers) return null;
    if (typeof headers.get === "function") return headers.get(name);
    const lower = String(name).toLowerCase();
    for (const k of Object.keys(headers)) if (k.toLowerCase() === lower) return headers[k];
    return null;
  };

  async function once(operation, method, path, init, opts = {}) {
    const remaining = budgetDeadline === null ? Infinity : budgetDeadline - Date.now();
    if (remaining <= 0) {
      throw fail("network", `${operation}: operation budget of ${CONFLUENCE_OPERATION_BUDGET_MS / 1000}s exhausted`, {
        operation,
        timeout: true,
      });
    }
    const effectiveMs = Math.max(1, Math.min(timeoutMs, remaining === Infinity ? timeoutMs : remaining));
    const ac = typeof AbortController === "function" ? new AbortController() : null;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (ac) ac.abort();
    }, effectiveMs);

    let resp;
    try {
      resp = await transport(path, {
        method,
        headers: { Accept: "application/json", ...((init && init.headers) || {}) },
        body: init && init.body !== undefined ? init.body : undefined,
        signal: ac ? ac.signal : undefined,
      });
    } catch (e) {
      const aborted = timedOut || (e && (e.name === "AbortError" || e.code === "ABORT_ERR"));
      throw fail(
        "network",
        aborted
          ? `${operation}: timed out after ${effectiveMs / 1000}s`
          : `${operation}: ${(e && e.message) || "network failure"}`,
        { operation, timeout: !!aborted }
      );
    } finally {
      clearTimeout(timer);
    }

    const status = Number(resp && resp.status);
    const code = statusToCode(status, { installProbe: opts.installProbe === true });
    if (code === null) return resp;

    let bodyText = "";
    try {
      bodyText = resp && typeof resp.text === "function" ? String(await resp.text()) : "";
    } catch (_) {
      bodyText = "";
    }
    const retryAfter = Number(headerOf(resp && resp.headers, "retry-after"));
    throw fail(code, `${operation}: HTTP ${status}${bodyText ? ` — ${bodyText.slice(0, 300)}` : ""}`, {
      operation,
      status,
      retryAfterSeconds: code === "rate_limited" && Number.isFinite(retryAfter) ? retryAfter : null,
    });
  }

  /**
   * The retry policy, in one place:
   *   - a WRITE (anything but GET/HEAD) is issued EXACTLY ONCE. Ever. Even on a
   *     transport fault: we do not know whether the server saw it, and a second
   *     POST /footer-comments is a second comment.
   *   - a READ retries at most once, and only on `network` or `rate_limited`,
   *     and only if the operation budget can still pay for it.
   */
  async function request(operation, method, path, init, opts) {
    try {
      return await once(operation, method, path, init, opts);
    } catch (e) {
      const retryable = e instanceof ConfluenceError && (e.code === "network" || e.code === "rate_limited");
      if (isWriteMethod(method) || !retryable) throw e;
      const waitMs = e.retryAfterSeconds ? Math.min(Math.max(e.retryAfterSeconds, 0) * 1000, 5000) : 250;
      if (budgetDeadline !== null && Date.now() + waitMs >= budgetDeadline) throw e;
      await sleep(waitMs);
      return once(operation, method, path, init, opts);
    }
  }

  /** Read the body, CLAMP IT, then parse. A body we cannot parse is an error, never null. */
  async function json(operation, method, path, body, opts) {
    const init = {};
    if (body !== undefined) {
      init.body = typeof body === "string" ? body : JSON.stringify(body);
      init.headers = { "Content-Type": "application/json" };
    }
    const resp = await request(operation, method, path, init, opts);
    if (Number(resp.status) === 204) return null;

    let raw = "";
    try {
      raw = resp && typeof resp.text === "function" ? String(await resp.text()) : "";
    } catch (_) {
      throw fail("network", `${operation}: response body could not be read`, { operation });
    }
    // The clamp comes BEFORE the parse so a hostile or runaway body can never be
    // handed whole to JSON.parse. A clamped body is by definition not valid JSON,
    // so this is a refusal, not a silent truncation.
    const clamped = clampUtf8Bytes(raw, RESPONSE_MAX_BYTES, "");
    if (clamped.truncated) {
      throw fail("invalid", `${operation}: response exceeded ${RESPONSE_MAX_BYTES} bytes and was not parsed`, {
        operation,
        status: Number(resp.status),
      });
    }
    if (!clamped.text.trim()) return null;
    try {
      return JSON.parse(clamped.text);
    } catch (_) {
      const looksHtml = /^\s*<(?:!doctype|html|\?xml)/i.test(clamped.text);
      // An HTML page where JSON was promised is the classic "the app is not on
      // this product" / interstitial answer — the fail-open direction again.
      throw fail(
        "confluence_unavailable",
        `${operation}: expected JSON but got ${looksHtml ? "an HTML page" : "an unparseable body"} — ${clamped.text.slice(0, 200)}`,
        { operation, status: Number(resp.status) }
      );
    }
  }

  const requireString = (operation, name, value) => {
    const s = String(value == null ? "" : value).trim();
    if (!s) throw fail("invalid", `${operation}: ${name} is required`, { operation });
    return s;
  };

  /* ------------------------------------------------------------------ *
   * Public surface
   * ------------------------------------------------------------------ */

  /**
   * Is the app installed on Confluence at all? NEVER THROWS — install state is a
   * question, and a thrown answer would make every caller write the same
   * try/catch. Any non-2xx (404 included) is "not installed / unavailable".
   */
  async function probeInstalled() {
    try {
      return await withBudget(CONFLUENCE_OPERATION_BUDGET_MS, async () => {
        await request("probeInstalled", "GET", INSTALL_PROBE_PATH, undefined, { installProbe: true });
        return { installed: true, code: null, message: null };
      });
    } catch (e) {
      const err = e instanceof ConfluenceError ? e : fail("confluence_unavailable", String((e && e.message) || e));
      return { installed: false, code: err.code, message: err.message, status: err.status };
    }
  }

  /**
   * The spaces this app can see, for a PICKER (1.5 commit 7). Never a rule's evidence —
   * a rule names ONE space key and every read of that space goes through
   * `resolveSpaceId`, which is the call that can actually answer "does it exist".
   *
   * THROWS like every other read, so a caller can tell "no spaces" from "cannot ask".
   * `limit` is clamped server-side; the picker is a dropdown, not a directory.
   */
  async function listSpaces({ limit = SPACE_LIST_MAX } = {}) {
    const op = "listSpaces";
    const n = Math.max(1, Math.min(SPACE_LIST_MAX, Number(limit) || SPACE_LIST_MAX));
    return withBudget(CONFLUENCE_OPERATION_BUDGET_MS, async () => {
      const data = await json(op, "GET", `/wiki/api/v2/spaces?limit=${n}&status=current`);
      const results = Array.isArray(data && data.results) ? data.results : [];
      return results.slice(0, n)
        .filter((s) => s && s.key)
        .map((s) => ({ id: String(s.id == null ? "" : s.id), key: String(s.key), name: String(s.name || s.key) }));
    });
  }

  /** CQL search. `limit` is clamped to SEARCH_MAX_LIMIT server-side, not trusted. */
  async function searchCql({ cql, limit = 10 } = {}) {
    const op = "searchCql";
    const q = requireString(op, "cql", cql);
    const n = Math.max(1, Math.min(SEARCH_MAX_LIMIT, Number(limit) || 1));
    return withBudget(CONFLUENCE_OPERATION_BUDGET_MS, async () => {
      const data = await json(op, "GET", `/wiki/rest/api/search?cql=${enc(q)}&limit=${n}`);
      const results = Array.isArray(data && data.results) ? data.results : [];
      return {
        results: results.slice(0, n).map((r) => ({
          id: String((r && r.content && r.content.id) || (r && r.id) || ""),
          type: String((r && r.content && r.content.type) || (r && r.entityType) || "") || null,
          title: String((r && r.content && r.content.title) || (r && r.title) || ""),
          url: (r && r.url) || null,
          excerpt: clampUtf8Bytes((r && r.excerpt) || "", 2048, "…").text,
        })),
        size: results.length,
      };
    });
  }

  /**
   * One page, with its storage body and the plain text a model can read.
   * `text` is RAW user content — fence and defang it at the prompt seam.
   */
  async function getPage({ id, bodyFormat = "storage" } = {}) {
    const op = "getPage";
    const pageId = requireString(op, "id", id);
    const fmt = bodyFormat === "atlas_doc_format" ? "atlas_doc_format" : "storage";
    return withBudget(CONFLUENCE_OPERATION_BUDGET_MS, async () => {
      const data = await json(op, "GET", `/wiki/api/v2/pages/${enc(pageId)}?body-format=${fmt}`);
      return shapePage(data, fmt);
    });
  }

  function shapePage(data, fmt) {
    const rawBody = String(((data && data.body && data.body[fmt]) || {}).value || "");
    const storage = clampUtf8Bytes(rawBody, PAGE_STORAGE_MAX_BYTES, "");
    const text = fmt === "storage" ? storageToText(rawBody) : { text: "", truncated: false };
    return {
      id: String((data && data.id) || ""),
      title: String((data && data.title) || ""),
      spaceId: data && data.spaceId != null ? String(data.spaceId) : null,
      status: (data && data.status) || null,
      version: Number((data && data.version && data.version.number) || 0) || null,
      url: (data && data._links && data._links.webui) || null,
      storage: storage.text,
      text: text.text,
      truncated: storage.truncated || text.truncated,
    };
  }

  /** Resolve a space KEY to its numeric id — page writes need the id, configs carry the key. */
  async function resolveSpaceId(op, spaceKey) {
    const key = requireString(op, "spaceKey", spaceKey);
    const data = await json(op, "GET", `/wiki/api/v2/spaces?keys=${enc(key)}&limit=1`);
    const hit = Array.isArray(data && data.results) ? data.results[0] : null;
    if (!hit || hit.id == null) {
      throw fail("not_found", `${op}: no space with key ${key}`, { operation: op });
    }
    return String(hit.id);
  }

  /**
   * Exact-title lookup inside one space. Answers `null` when there is no such
   * page — and note that `null` is NOT proof of absence if the app cannot see
   * the space; an access fault throws `auth`, which is why the two are distinct.
   */
  async function getPageByTitle({ spaceKey, title } = {}) {
    const op = "getPageByTitle";
    const wanted = requireString(op, "title", title);
    return withBudget(CONFLUENCE_OPERATION_BUDGET_MS, async () => {
      const spaceId = await resolveSpaceId(op, spaceKey);
      const data = await json(
        op,
        "GET",
        `/wiki/api/v2/spaces/${enc(spaceId)}/pages?title=${enc(wanted)}&limit=1&body-format=storage`
      );
      const hit = Array.isArray(data && data.results) ? data.results[0] : null;
      return hit ? shapePage(hit, "storage") : null;
    });
  }

  /** Create a page. WRITE — issued exactly once, never retried. */
  async function createPage({ spaceKey, parentId, title, storage } = {}) {
    const op = "createPage";
    const pageTitle = requireString(op, "title", title);
    const value = String(storage == null ? "" : storage);
    if (!value) throw fail("invalid", `${op}: storage body is required`, { operation: op });
    const capped = clampUtf8Bytes(value, PAGE_STORAGE_MAX_BYTES, "");
    return withBudget(CONFLUENCE_OPERATION_BUDGET_MS, async () => {
      const spaceId = await resolveSpaceId(op, spaceKey);
      const body = {
        spaceId,
        status: "current",
        title: pageTitle,
        body: { representation: "storage", value: capped.text },
      };
      if (parentId) body.parentId = String(parentId);
      const data = await json(op, "POST", "/wiki/api/v2/pages", body);
      return {
        id: String((data && data.id) || ""),
        title: String((data && data.title) || pageTitle),
        version: Number((data && data.version && data.version.number) || 1),
        url: (data && data._links && data._links.webui) || null,
        truncated: capped.truncated,
      };
    });
  }

  /**
   * Update a page, VERSION-CHECKED. `version` is the version the caller READ.
   *
   * When no title is supplied we must read the page anyway (the v2 PUT requires
   * a title), and that read is used to refuse BEFORE the write if the version
   * moved — the check comes before the side effect, not after it. When a title
   * IS supplied we write straight away and Confluence's own 409/412 maps to the
   * same `conflict` code. A conflict is NEVER retried: re-reading and re-writing
   * would be exactly the lost edit this guard exists to prevent.
   */
  async function updatePage({ id, version, title, storage } = {}) {
    const op = "updatePage";
    const pageId = requireString(op, "id", id);
    const current = Number(version);
    if (!Number.isInteger(current) || current < 1) {
      throw fail("invalid", `${op}: version must be the page's current version number`, { operation: op });
    }
    const value = String(storage == null ? "" : storage);
    if (!value) throw fail("invalid", `${op}: storage body is required`, { operation: op });
    const capped = clampUtf8Bytes(value, PAGE_STORAGE_MAX_BYTES, "");

    return withBudget(CONFLUENCE_OPERATION_BUDGET_MS, async () => {
      let pageTitle = title == null ? "" : String(title).trim();
      if (!pageTitle) {
        const existing = await json(op, "GET", `/wiki/api/v2/pages/${enc(pageId)}`);
        const live = Number((existing && existing.version && existing.version.number) || 0);
        if (live !== current) {
          throw fail(
            "conflict",
            `${op}: page ${pageId} is at version ${live}, the caller read version ${current} — refusing to overwrite`,
            { operation: op }
          );
        }
        pageTitle = String((existing && existing.title) || "");
      }
      const data = await json(op, "PUT", `/wiki/api/v2/pages/${enc(pageId)}`, {
        id: pageId,
        status: "current",
        title: pageTitle,
        version: { number: current + 1, message: "Updated by CogniRunner" },
        body: { representation: "storage", value: capped.text },
      });
      return {
        id: String((data && data.id) || pageId),
        title: String((data && data.title) || pageTitle),
        version: Number((data && data.version && data.version.number) || current + 1),
        url: (data && data._links && data._links.webui) || null,
        truncated: capped.truncated,
      };
    });
  }

  /** Add a footer comment. WRITE — issued exactly once; a retry is a duplicate comment. */
  async function addComment({ pageId, body } = {}) {
    const op = "addComment";
    const id = requireString(op, "pageId", pageId);
    const value = String(body == null ? "" : body);
    if (!value.trim()) throw fail("invalid", `${op}: body is required`, { operation: op });
    const capped = clampUtf8Bytes(value, COMMENT_MAX_BYTES, "");
    return withBudget(CONFLUENCE_OPERATION_BUDGET_MS, async () => {
      const data = await json(op, "POST", "/wiki/api/v2/footer-comments", {
        pageId: id,
        body: { representation: "storage", value: capped.text },
      });
      return {
        id: String((data && data.id) || ""),
        pageId: id,
        version: Number((data && data.version && data.version.number) || 1),
        truncated: capped.truncated,
      };
    });
  }

  return {
    probeInstalled,
    listSpaces,
    searchCql,
    getPage,
    getPageByTitle,
    createPage,
    updatePage,
    addComment,
  };
}

export default createConfluenceClient;
