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
 * THE CODER WORKSPACE — the ONE writer that puts a coder turn's effects on the Jira issue
 * (plan §3.8, "one writer module ... per-issue lock").
 *
 * Everything a coder turn leaves behind on an issue is written HERE and nowhere else:
 *
 *   1. writeCoderPlan          — the "CogniRunner plan" section of the description, replaced
 *                                IN PLACE between two marker paragraphs. Text outside the
 *                                markers is never rewritten.
 *   2. appendStepComment       — ONE comment per completed step, plus repo/branch/PR as
 *                                REMOTE LINKS carrying a deterministic `globalId`, so a
 *                                re-run updates the link instead of adding a second one.
 *   3. updateCoderLog          — ONE running "Coder log" comment, EDITED in place. Its id
 *                                lives in `coder_log:<issueKey>:<threadId>`; the body is the last
 *                                CODER_LOG_MAX_LINES lines under a byte cap.
 *   4. attachSessionArtifact   — `.md` only, through the SAME allow-list and size cap the
 *                                attachment-upload webtrigger enforces
 *                                (UPLOAD_ALLOWED_EXTENSIONS / UPLOAD_MAX_BYTES in
 *                                src/index.js — imported, never re-typed).
 *
 * WHY ONE MODULE. The red team's finding (plan §8) was "description race; two threads
 * clobber". Two coder threads on one issue read the same description and write back two
 * different bodies, and the second one wins silently. So every write group here runs under
 * `coder_ws:<issueKey>`, a FAIL_IF_EXISTS claim with a SHORT ttl, released in `finally`.
 * The lock is short because it guards a Jira round trip, not a model round trip — a coder
 * TURN is already serialised by `coder_exec:<issueKey>` in src/coder-engine.js; this one
 * additionally serialises the writer against anything else that ever calls it.
 *
 * THE MODEL'S TEXT IS DATA. A plan, a step title and a log line are PLAIN TEXT. They are
 * turned into ADF here, paragraph by paragraph, by `plainTextAdf` — the module never
 * accepts ADF from the model and never calls `coerceToAdf`, which would happily parse a
 * model-authored JSON string into live document nodes (mentions, links, panels). Lengths
 * are clamped before the write, not after.
 *
 * NOTHING HERE THROWS AT THE ENGINE. Every function answers `{ok:true, ...ids}` or
 * `{ok:false, error, errorClass}` where the class is one of
 * "permission" | "not-found" | "invalid" | "network" | "busy" | "unknown", logged ONCE.
 * A workspace write that failed must degrade the turn's record, never kill the turn: the
 * user's repository work already happened.
 *
 * SIMULATION writes nothing at all and answers `{ok:true, simulated:true, would:{…}}`.
 */
import api, { route } from "@forge/api";
import storage from "@forge/kvs";
import { safeKeyPart, assertKvsKey } from "./shared/kvs-keys.js";
import { claimRuleExecution } from "./shared/execution-claim.js";
import { clampChars } from "./shared/text-clamp.js";

const idx = () => import("./index.js");

/* ───────────────────────────── constants (ONE home) ───────────────────────────── */

/**
 * THE SECTION MARKERS. Two paragraphs whose plain text is exactly these strings. They are
 * plain ASCII and visible on purpose: a user who sees them knows which part of their
 * description the app owns, and a user who deletes one gets a fresh section appended
 * rather than a mangled one. NEVER change these strings without a migration — a renamed
 * marker orphans every section already on an issue.
 */
export const PLAN_MARKER_START = "[CogniRunner plan]";
export const PLAN_MARKER_END = "[/CogniRunner plan]";

/** The plan section's own ceiling. Jira's description field is ~32 KB; we stay well under. */
export const PLAN_MAX_BYTES = 12 * 1024;
export const PLAN_MAX_LINES = 60;
/** One line of any rendered block. Long enough for a sentence, short enough to be a line. */
export const LINE_MAX_CHARS = 600;

/** The running log comment: last N lines, under a byte cap. Comments are ~32 KB in Jira. */
export const CODER_LOG_MAX_LINES = 60;
export const CODER_LOG_MAX_BYTES = 16 * 1024;
export const CODER_LOG_TITLE = "Coder log";

export const STEP_MAX_LINKS = 10;
export const STEP_MAX_BYTES = 8 * 1024;

/** Session artifacts are markdown, and only markdown. */
export const ARTIFACT_EXTENSION = ".md";
export const ARTIFACT_NAME_RE = /^coder-session-\d{1,6}\.md$/;

/**
 * The writer lock. SHORT: it covers Jira round trips only. Forge KVS ttl is expressed in
 * whole minutes, so one minute is the floor and is also the right number — a writer that
 * has not finished in a minute has been killed, and the next turn must not be blocked for
 * longer than that.
 */
export const WORKSPACE_LOCK_TTL = { ttl: { value: 1, unit: "MINUTES" } };

/* ───────────────────────────── keys ───────────────────────────── */
// Every key part goes through `safeKeyPart` and every built key through `assertKvsKey`
// (F-346/F-349: a key part is never a raw id, and an illegal key fails at the builder).

export const coderWorkspaceLockKey = (issueKey) => assertKvsKey(`coder_ws:${safeKeyPart(issueKey)}`);
/**
 * THE LOG POINTER IS PER THREAD (F-377), not per issue.
 *
 * It used to be `coder_log:<issueKey>` while the log it points at is per THREAD, so two
 * threads on one issue — one user with "New conversation", or two users, whose default
 * thread ids differ — abandoned each other's comment and POSTED A NEW ONE every turn.
 * Ten alternating turns meant ten "Coder log" comments and no way to tell which was live.
 * The thread is part of the key, so each thread edits its own comment in place.
 * (Rows written under the old, issue-only key are simply never read again; they carry a
 * 90-day ttl and expire. Nothing migrates them — the comment they name is already on the
 * issue and re-editing it from a new thread is the bug, not the fix.)
 */
export const coderLogKey = (issueKey, threadId) =>
  assertKvsKey(`coder_log:${safeKeyPart(issueKey)}:${safeKeyPart(threadId == null ? "" : threadId) || "-"}`);

/** A small, stable, non-cryptographic digest. Identity only — never a secret. */
const hash32 = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
};

/**
 * THE REMOTE-LINK IDENTITY. `globalId` is what makes the link idempotent: Jira's
 * POST /remotelink UPSERTS on it, so the same repo/branch/PR posted on ten turns is one
 * link, updated. It is derived from the issue, the kind and the URL — never from a
 * timestamp, a run id or the model's title, any of which would make every re-run a new row.
 */
export const remoteLinkGlobalId = (issueKey, kind, url) =>
  `cognirunner-coder:${safeKeyPart(issueKey)}:${safeKeyPart(kind || "link")}:${hash32(String(url || ""))}`;

/* ───────────────────────────── plain text → ADF ───────────────────────────── */

const bytesOf = (v) => Buffer.byteLength(typeof v === "string" ? v : JSON.stringify(v) || "", "utf8");

/** Control characters are stripped: they are invisible in Jira and break marker matching. */
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

/** One paragraph node from one plain-text line. An empty line is an empty paragraph. */
const paragraph = (text) => {
  // F-381 — CODE POINTS, NOT CODE UNITS. A `.slice()` here cut emoji in half and put a
  // lone surrogate into the ADF that is PUT to Jira. ONE helper, src/shared/text-clamp.js.
  const t = clampChars(String(text == null ? "" : text).replace(CONTROL_CHARS, " "), LINE_MAX_CHARS);
  return t ? { type: "paragraph", content: [{ type: "text", text: t }] } : { type: "paragraph", content: [] };
};

/**
 * PLAIN TEXT ONLY. Splits on newlines, clamps the line count and then the byte total by
 * dropping from the END and saying so. The model can put anything in here — a JSON blob,
 * an ADF document, a mention string — and all of it lands as literal text.
 */
export const plainTextAdf = (text, { maxLines = PLAN_MAX_LINES, maxBytes = PLAN_MAX_BYTES } = {}) => {
  const raw = String(text == null ? "" : text).replace(/\r\n?/g, "\n").split("\n");
  const lines = raw.slice(0, maxLines);
  let truncated = raw.length > lines.length;
  let content = lines.map(paragraph);
  while (content.length > 1 && bytesOf(content) > maxBytes) { content.pop(); truncated = true; }
  if (truncated) content.push(paragraph("… (truncated by CogniRunner)"));
  if (!content.length) content = [paragraph("")];
  return { type: "doc", version: 1, content };
};

/** The plain text of an ADF node, for marker matching only. */
export const adfNodeText = (node) => {
  if (!node || typeof node !== "object") return "";
  if (typeof node.text === "string") return node.text;
  if (!Array.isArray(node.content)) return "";
  return node.content.map(adfNodeText).join("");
};

/**
 * REPLACE THE SECTION, IN PLACE.
 *
 * Pure and exported so the rule is testable without Jira. The description is a list of
 * top-level nodes; the section is everything from the START marker node to the END marker
 * node INCLUSIVE. Those nodes are replaced by the freshly rendered section and **nothing
 * else in the array is touched** — not reordered, not re-encoded, not clamped. When either
 * marker is missing (or they are out of order, which means somebody edited one away) the
 * section is APPENDED at the end, which is also the first-write path.
 *
 * @returns {{doc: object, replaced: boolean}}
 */
export const replacePlanSection = (description, sectionNodes) => {
  const doc = description && description.type === "doc" && Array.isArray(description.content)
    ? { ...description, version: 1, content: description.content.slice() }
    : { type: "doc", version: 1, content: [] };
  const isMarker = (node, marker) => adfNodeText(node).trim() === marker;
  // THE FIRST OPEN, THE LAST CLOSE (F-376). Taking the first close orphans everything
  // between a duplicate close and the real one — permanently, because the next write
  // matches the same first close again. Widest span = the section can always be reclaimed,
  // which is the only direction that is self-healing on an already-damaged description.
  const start = doc.content.findIndex((n) => isMarker(n, PLAN_MARKER_START));
  let end = -1;
  for (let i = doc.content.length - 1; i > start; i--) { if (isMarker(doc.content[i], PLAN_MARKER_END)) { end = i; break; } }
  if (start >= 0 && end > start) {
    doc.content.splice(start, end - start + 1, ...sectionNodes);
    return { doc, replaced: true };
  }
  doc.content.push(...sectionNodes);
  return { doc, replaced: false };
};

/**
 * DEFANG THE MARKERS (F-376). The plan markers are a FENCE, and every other fence in this
 * app strips its own token out of the content it wraps (`defangFence`, memories.js). This
 * one did not: a plan line whose text is exactly `[/CogniRunner plan]` became a top-level
 * paragraph that the NEXT write read as the section's end, so everything after it was
 * orphaned OUTSIDE the app-owned section and could never be rewritten or removed again —
 * permanent model-authored text in the user's description, reachable from the untrusted
 * `<<<ISSUE>>>` context the plan is derived from.
 *
 * Any line that WOULD match a marker (case-insensitive, after the same control-character
 * normalisation and trim that `paragraph()` and the matcher apply) is rewritten to a
 * visibly altered, non-matching form. It is a REWRITE, not a rejection: the model's text is
 * data, and a plan is not dropped because it contains an unlucky line.
 */
export const defangPlanMarkers = (text) => {
  const looksLike = (line, marker) => line.replace(CONTROL_CHARS, " ").trim().toLowerCase() === marker.toLowerCase();
  const altered = (marker) => `${marker.slice(0, -1)} (text)]`;
  return String(text == null ? "" : text).replace(/\r\n?/g, "\n").split("\n").map((line) => {
    if (looksLike(line, PLAN_MARKER_START)) return altered(PLAN_MARKER_START);
    if (looksLike(line, PLAN_MARKER_END)) return altered(PLAN_MARKER_END);
    return line;
  }).join("\n");
};

/**
 * The section as nodes: marker, heading, the plan's paragraphs, marker.
 * The plan is the MODEL'S text and is defanged before it goes between the markers — the
 * marker paragraphs themselves are written here, by code, and are never passed through it.
 */
export const buildPlanSection = (plan) => [
  paragraph(PLAN_MARKER_START),
  { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "CogniRunner plan" }] },
  ...plainTextAdf(defangPlanMarkers(plan), { maxLines: PLAN_MAX_LINES, maxBytes: PLAN_MAX_BYTES }).content,
  paragraph(PLAN_MARKER_END),
];

/* ───────────────────────────── failure, named once ───────────────────────────── */

/**
 * THE ERROR CLASS. The engine does not branch on HTTP numbers and the user does not read
 * them: what both need is WHICH KIND of failure this was, because "the app may not write
 * to this issue" and "Jira was unreachable" are different answers.
 */
export const classifyStatus = (status) => {
  const s = Number(status) || 0;
  if (s === 401 || s === 403) return "permission";
  if (s === 404) return "not-found";
  if (s === 400 || s === 413 || s === 415 || s === 422) return "invalid";
  if (s === 429 || s >= 500 || s === 0) return "network";
  return "unknown";
};

const classifyThrow = (e) => {
  const msg = String((e && e.message) || e || "").toLowerCase();
  if (msg.includes("permission") || msg.includes("forbidden") || msg.includes("unauthor")) return "permission";
  if (msg.includes("not found")) return "not-found";
  return "network";
};

/** ONE line of log per failure, and exactly one. */
const failure = (what, issueKey, errorClass, detail) => {
  const error = `${what} failed (${errorClass}): ${String(detail || "").slice(0, 300)}`;
  console.warn(`[coder-workspace] ${issueKey}: ${error}`);
  return { ok: false, error, errorClass };
};

/** A Jira call that answers `{ok, status, json}` and never throws. */
const jira = async (path, options = {}) => {
  try {
    const res = await api.asApp().requestJira(path, options);
    if (!res.ok) {
      let body = "";
      try { body = String(await res.text()).slice(0, 200); } catch { /* the body is optional */ }
      return { ok: false, status: res.status, errorClass: classifyStatus(res.status), detail: `HTTP ${res.status}${body ? ` — ${body}` : ""}` };
    }
    let json = null;
    try { json = await res.json(); } catch { json = null; }
    return { ok: true, status: res.status, json };
  } catch (e) {
    return { ok: false, status: 0, errorClass: classifyThrow(e), detail: String((e && e.message) || e).slice(0, 200) };
  }
};

const jsonPost = (body) => ({ method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
const jsonPut = (body) => ({ method: "PUT", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });

/* ───────────────────────────── the per-issue lock ───────────────────────────── */

/**
 * Run one write group under `coder_ws:<issueKey>`.
 *
 * FAIL CLOSED (`failClosed: true`): if the claim cannot be taken the write does not happen.
 * A description rewrite is a read-modify-write, and permitting a second writer during a
 * KVS fault is exactly the lost update this module exists to prevent. Released in
 * `finally` — always, including when the body throws.
 */
export const withWorkspaceLock = async (issueKey, what, fn, { store = storage } = {}) => {
  const key = coderWorkspaceLockKey(issueKey);
  let claimed = false;
  try {
    claimed = await claimRuleExecution(store, key, WORKSPACE_LOCK_TTL, "coder-workspace", { failClosed: true });
  } catch (e) {
    return failure(what, issueKey, "network", `the per-issue lock could not be taken: ${(e && e.message) || e}`);
  }
  if (!claimed) {
    return { ok: false, errorClass: "busy", error: `${what} skipped: another Coder write is in flight on ${issueKey}.` };
  }
  try {
    return await fn();
  } catch (e) {
    return failure(what, issueKey, classifyThrow(e), (e && e.message) || e);
  } finally {
    try { await store.delete(key); } catch (e) { console.warn(`[coder-workspace] ${issueKey}: lock release failed: ${e && e.message}`); }
  }
};

const badIssue = (what) => ({ ok: false, errorClass: "invalid", error: `${what} needs an issue key.` });

/* ───────────────────────────── 1. the plan section ───────────────────────────── */

/**
 * Replace the "CogniRunner plan" section of the description IN PLACE.
 *
 * @param {string} issueKey
 * @param {string} plan          PLAIN TEXT from the model. Never ADF.
 * @param {boolean} simulation
 * @returns {{ok:true, issueKey:string, replaced:boolean, bytes:number}}
 *        | {{ok:true, simulated:true, would:object}}
 *        | {{ok:false, error:string, errorClass:string}}
 */
export const writeCoderPlan = async ({ issueKey, plan, simulation = false, deps = {} } = {}) => {
  const key = String(issueKey || "").trim();
  if (!key) return badIssue("Writing the plan");
  const section = buildPlanSection(plan);
  if (simulation === true) {
    return { ok: true, simulated: true, would: { action: "writeCoderPlan", issueKey: key, paragraphs: section.length, bytes: bytesOf(section) } };
  }
  return withWorkspaceLock(key, "Writing the plan", async () => {
    const read = await jira(route`/rest/api/3/issue/${key}?fields=description`, { headers: { Accept: "application/json" } });
    if (!read.ok) return failure("Writing the plan", key, read.errorClass, read.detail);
    const current = (read.json && read.json.fields && read.json.fields.description) || null;
    const { doc, replaced } = replacePlanSection(current, section);
    const write = await jira(route`/rest/api/3/issue/${key}`, jsonPut({ fields: { description: doc } }));
    if (!write.ok) return failure("Writing the plan", key, write.errorClass, write.detail);
    return { ok: true, issueKey: key, replaced, bytes: bytesOf(doc) };
  }, deps);
};

/* ───────────────────────────── 2. one comment per step ───────────────────────────── */

const normalizeLinks = (links) => (Array.isArray(links) ? links : [])
  .map((l) => (l && typeof l === "object" ? l : null))
  .filter(Boolean)
  .map((l) => ({ kind: clampChars(l.kind || "link", 40), url: clampChars(String(l.url || "").trim(), 1000), title: clampChars(l.title || l.url || "", 250) }))
  .filter((l) => /^https?:\/\//i.test(l.url))
  .slice(0, STEP_MAX_LINKS);

/**
 * ONE comment for ONE completed step, plus its links as remote links.
 *
 * `links` is `[{kind, url, title}]` — `kind` is "repo" | "branch" | "pr" | anything short;
 * it is part of the `globalId`, so the SAME kind+url on a later turn UPDATES that link.
 * A link whose URL is not http(s) is dropped, not rendered: the model supplies these.
 *
 * A failed remote link does NOT fail the comment — the comment already carries the URLs as
 * text, and losing the sidebar row is smaller than losing the step record.
 *
 * @returns {{ok:true, issueKey:string, commentId:string, links:Array}}
 */
export const appendStepComment = async ({ issueKey, step, links = [], simulation = false, deps = {} } = {}) => {
  const key = String(issueKey || "").trim();
  if (!key) return badIssue("Posting the step comment");
  const clean = normalizeLinks(links);
  const body = plainTextAdf(
    [`Coder step: ${clampChars((step && step.title) || step || "step", 200)}`,
      ...(step && step.detail ? [String(step.detail)] : []),
      ...clean.map((l) => `${l.kind}: ${l.title} — ${l.url}`)].join("\n"),
    { maxLines: PLAN_MAX_LINES, maxBytes: STEP_MAX_BYTES },
  );
  if (simulation === true) {
    return {
      ok: true,
      simulated: true,
      would: {
        action: "appendStepComment", issueKey: key,
        comment: clampChars(adfNodeText(body), 400),
        links: clean.map((l) => ({ ...l, globalId: remoteLinkGlobalId(key, l.kind, l.url) })),
      },
    };
  }
  return withWorkspaceLock(key, "Posting the step comment", async () => {
    const posted = await jira(route`/rest/api/3/issue/${key}/comment`, jsonPost({ body }));
    if (!posted.ok) return failure("Posting the step comment", key, posted.errorClass, posted.detail);
    const linkResults = [];
    for (const l of clean) {
      const globalId = remoteLinkGlobalId(key, l.kind, l.url);
      // POST with a globalId is an UPSERT in Jira: 201 the first time, 200 after. Either
      // way there is exactly ONE row for this repo/branch/PR on this issue, forever.
      const res = await jira(route`/rest/api/3/issue/${key}/remotelink`, jsonPost({
        globalId,
        object: { url: l.url, title: l.title, summary: `CogniRunner ${l.kind}` },
      }));
      if (res.ok) {
        linkResults.push({ globalId, kind: l.kind, url: l.url, id: (res.json && res.json.id) || null, ok: true, created: res.status === 201 });
      } else {
        console.warn(`[coder-workspace] ${key}: remote link (${res.errorClass}) ${res.detail}`);
        linkResults.push({ globalId, kind: l.kind, url: l.url, ok: false, errorClass: res.errorClass });
      }
    }
    return { ok: true, issueKey: key, commentId: String((posted.json && posted.json.id) || ""), links: linkResults };
  }, deps);
};

/* ───────────────────────────── 3. the running log ───────────────────────────── */

/** Last N lines, then trimmed from the FRONT until the byte cap holds. */
export const clampLogLines = (lines) => {
  let kept = lines.slice(-CODER_LOG_MAX_LINES);
  while (kept.length > 1 && bytesOf(kept.join("\n")) > CODER_LOG_MAX_BYTES) kept = kept.slice(1);
  return kept;
};

/**
 * ONE "Coder log" comment per issue, EDITED in place.
 *
 * The lines accumulate in `coder_log:<issueKey>:<threadId>` (NOT read back out of the comment — a
 * user may edit the comment, and re-parsing our own rendering would let their text become
 * our state). The row keeps the last CODER_LOG_MAX_LINES lines under CODER_LOG_MAX_BYTES.
 * A new `threadId` starts a new log and a new comment: two threads must not interleave in
 * one running record — and because the pointer is keyed BY thread, alternating between two
 * threads keeps editing two comments rather than posting a new one on every switch.
 *
 * If the stored comment id no longer resolves (the user deleted it), the log is recreated
 * and the new id stored — a 404 on the edit is a normal outcome, not a failure.
 *
 * @returns {{ok:true, issueKey:string, commentId:string, created:boolean, lines:number}}
 */
export const updateCoderLog = async ({ issueKey, threadId, lines, simulation = false, deps = {} } = {}) => {
  const key = String(issueKey || "").trim();
  if (!key) return badIssue("Updating the Coder log");
  const incoming = (Array.isArray(lines) ? lines : [lines])
    .filter((l) => l != null && String(l).trim() !== "")
    .map((l) => clampChars(l, LINE_MAX_CHARS));
  const thread = String(threadId || "").slice(0, 120);
  if (simulation === true) {
    return { ok: true, simulated: true, would: { action: "updateCoderLog", issueKey: key, threadId: thread, lines: incoming.length } };
  }
  const store = deps.store || storage;
  return withWorkspaceLock(key, "Updating the Coder log", async () => {
    let row = null;
    try { row = await store.get(coderLogKey(key, thread)); } catch (e) { console.warn(`[coder-workspace] ${key}: log row read failed: ${e && e.message}`); }
    const sameThread = row && typeof row === "object" && row.threadId === thread;
    const kept = clampLogLines([...(sameThread && Array.isArray(row.lines) ? row.lines : []), ...incoming]);
    const body = plainTextAdf([`${CODER_LOG_TITLE} — thread ${thread || "(none)"}`, "", ...kept].join("\n"),
      { maxLines: CODER_LOG_MAX_LINES + 4, maxBytes: CODER_LOG_MAX_BYTES });

    let commentId = sameThread && row.commentId ? String(row.commentId) : "";
    let created = false;
    if (commentId) {
      const edited = await jira(route`/rest/api/3/issue/${key}/comment/${commentId}`, jsonPut({ body }));
      if (!edited.ok) {
        if (edited.errorClass !== "not-found") return failure("Updating the Coder log", key, edited.errorClass, edited.detail);
        commentId = "";
      }
    }
    if (!commentId) {
      const posted = await jira(route`/rest/api/3/issue/${key}/comment`, jsonPost({ body }));
      if (!posted.ok) return failure("Updating the Coder log", key, posted.errorClass, posted.detail);
      commentId = String((posted.json && posted.json.id) || "");
      created = true;
    }
    try {
      await store.set(coderLogKey(key, thread), { issueKey: key, threadId: thread, commentId, lines: kept, updatedAt: new Date().toISOString() }, { ttl: { value: 90, unit: "DAYS" } });
    } catch (e) {
      // The comment is already correct; losing the pointer only costs us a second comment
      // next round. Never re-post because the bookkeeping failed.
      console.warn(`[coder-workspace] ${key}: log pointer not stored: ${e && e.message}`);
    }
    return { ok: true, issueKey: key, commentId, created, lines: kept.length };
  }, deps);
};

/* ───────────────────────────── 4. the session artifact ───────────────────────────── */

/**
 * Attach `coder-session-<n>.md`.
 *
 * MARKDOWN ONLY, and the refusal is on the EXTENSION, checked against the app's ONE
 * allow-list (`UPLOAD_ALLOWED_EXTENSIONS` in src/index.js — imported lazily, exactly as
 * src/coder-engine.js reaches index.js, so this module stays loadable offline). A `.json`
 * transcript is the shape the red team named: it looks harmless, it is served back to
 * browsers, and it is not what this surface promised.
 *
 * @returns {{ok:true, issueKey:string, attachmentId:string, filename:string, bytes:number}}
 */
export const attachSessionArtifact = async ({ issueKey, name, content, simulation = false, deps = {} } = {}) => {
  const key = String(issueKey || "").trim();
  if (!key) return badIssue("Attaching the session artifact");
  const filename = String(name || "").trim();
  if (!ARTIFACT_NAME_RE.test(filename)) {
    return { ok: false, errorClass: "invalid", error: `A Coder artifact must be named coder-session-<n>.md — "${filename.slice(0, 60)}" is not.` };
  }
  // The allow-list lives in src/index.js and is reached lazily. A module load that faults
  // is a FAULT, not an exception the engine has to catch: this function's contract is that
  // it never throws, and that contract does not have an exception for its own import.
  let m;
  try { m = deps.loadIndex ? await deps.loadIndex() : await idx(); }
  catch (e) { return failure("Attaching the session artifact", key, "unknown", `the upload allow-list could not be read: ${(e && e.message) || e}`); }
  const allowed = deps.allowedExtensions || m.UPLOAD_ALLOWED_EXTENSIONS;
  const maxBytes = deps.maxBytes || m.UPLOAD_MAX_BYTES;
  if (!allowed || !allowed.has(ARTIFACT_EXTENSION)) {
    return { ok: false, errorClass: "invalid", error: `${ARTIFACT_EXTENSION} is not in the upload allow-list.` };
  }
  const buffer = Buffer.from(String(content == null ? "" : content), "utf8");
  if (buffer.length > maxBytes) {
    return { ok: false, errorClass: "invalid", error: `The session artifact is ${buffer.length} bytes, over the ${maxBytes} byte upload cap.` };
  }
  if (simulation === true) {
    return { ok: true, simulated: true, would: { action: "attachSessionArtifact", issueKey: key, filename, bytes: buffer.length } };
  }
  return withWorkspaceLock(key, "Attaching the session artifact", async () => {
    const { default: FormData } = await import("form-data");
    const form = new FormData();
    form.append("file", buffer, { filename, contentType: "text/markdown", knownLength: buffer.length });
    // The SAME transport the attachment-upload webtrigger uses: a Buffer body with the
    // boundary-bearing Content-Type from form-data, Accept and X-Atlassian-Token first so
    // getHeaders()' content-type stays authoritative. Do not "simplify" this — a missing
    // boundary is a silent 415 (src/index.js, serveAttachmentUpload).
    const res = await jira(route`/rest/api/3/issue/${key}/attachments`, {
      method: "POST",
      body: form.getBuffer(),
      headers: { Accept: "application/json", "X-Atlassian-Token": "no-check", ...form.getHeaders() },
    });
    if (!res.ok) return failure("Attaching the session artifact", key, res.errorClass, res.detail);
    const first = Array.isArray(res.json) && res.json.length ? res.json[0] : null;
    if (!first || !first.id) return failure("Attaching the session artifact", key, "unknown", "Jira accepted the upload but returned no attachment id");
    return { ok: true, issueKey: key, attachmentId: String(first.id), filename, bytes: buffer.length };
  }, deps);
};

/* ───────────────────────────── the dep the engine injects ───────────────────────────── */

/**
 * THE WORKSPACE OBJECT `runCoderTurn` calls. It exists so the engine's tests can stub the
 * writer wholesale, and so there is exactly ONE name at the call site for "the thing that
 * writes to the issue".
 */
export const createCoderWorkspace = ({ simulation = false, deps = {} } = {}) => ({
  writeCoderPlan: (args) => writeCoderPlan({ simulation, deps, ...args }),
  appendStepComment: (args) => appendStepComment({ simulation, deps, ...args }),
  updateCoderLog: (args) => updateCoderLog({ simulation, deps, ...args }),
  attachSessionArtifact: (args) => attachSessionArtifact({ simulation, deps, ...args }),
});
