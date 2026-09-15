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
 * THE ONE HOME for what an unfinished admin form may keep, where it keeps it, and how
 * long it lives (F-990).
 *
 * The complaint was concrete: every admin form in this app holds its answers in
 * `useState` and NOTHING persists them, so a reload, a tab close, an accidental
 * navigation or a session bounce silently destroys a half-finished pipeline setup, rule
 * wizard or agent definition. Exactly one flow survived - the VA chat wizard, which
 * resumes from `va_wizard:{accountId}` server side (F-969). That flow is deliberately
 * left alone; this file is the CLIENT-side equivalent for the ordinary forms.
 *
 * WHY A SHARED MODULE AND NOT A HOOK. The hook is ~60 lines of debounce and try/catch and
 * has no opinions. The OPINIONS are here: which key a draft may occupy, which field names
 * must never be written down, how a version bump discards, when a draft is too old and
 * how big is too big. Put those in the hook and there are nine copies of them the moment
 * the ninth form is wired, and the ninth copy is the one that persists a token.
 *
 * -- THE RULE THAT MATTERS: A DRAFT IS NOT A PLACE TO PUT A CREDENTIAL ----------------
 *
 * localStorage is readable by anything running in the iframe's origin and it OUTLIVES the
 * session by design, which is the whole point of the feature. So the exclusion is a BELT
 * AND BRACES, and the two halves fail in opposite directions on purpose:
 *
 *   - `DRAFT_SECRET_FIELDS` is the NAMED list. It is exact, auditable and covers the
 *     fields that exist today, including the ones that are not credentials at all but are
 *     still wrong to persist: every `has*` flag (server truth about whether a key is
 *     stored, and a stale `hasKey:true` in a week-old draft would make the UI lie about
 *     the tenant's configuration) and every `taskId`/in-flight/polling field (resuming
 *     into a "generating" state whose async task expired hours ago is an orphan poll and
 *     a spinner that never stops).
 *
 *   - `isSecretishKey` is the DENY-BY-SHAPE belt. It drops anything whose NAME looks like
 *     a credential regardless of whether anyone remembered to list it. This is the half
 *     that covers the field nobody has written yet: the next `myNewToken` added to
 *     OpenAIConfig persists nothing on the day it is added, not on the day someone
 *     notices. A false positive here costs one field of convenience; a false negative
 *     costs a tenant a credential sitting in browser storage for a week.
 *
 * The named list is therefore allowed to be incomplete and the shape belt is allowed to be
 * over-broad, and NEITHER is allowed to be the only one. `pruneDraft` applies both, at
 * every depth, because these forms nest (a rule wizard carries function steps, a step
 * carries a generation task id).
 *
 * -- SILENT-OPEN ---------------------------------------------------------------------
 *
 * Every function here is total: it returns a value for hostile input and throws for none.
 * A draft is a CONVENIENCE. Losing one is a disappointment; taking the admin panel down
 * because storage was disabled, quota was full or a stored string was corrupt is a
 * failure. The hook wraps its storage access; this file simply never gives it a reason.
 *
 * Dependency-free apart from the two sibling shared modules, because it bundles into the
 * backend's module graph (via registry-limits) and into two frontends.
 */
import { safeKeyPart } from "./kvs-keys.js";
import { DRAFT_TTL_DAYS } from "./registry-limits.js";

export { DRAFT_TTL_DAYS };

/**
 * Bumped whenever a persisted shape changes meaning. A draft stamped with anything else
 * is DISCARDED, never migrated: a migration path for a seven-day browser-local
 * convenience is code that can only ever be wrong, and restoring a half-understood old
 * shape into a changed form is precisely the "resume wrongly" the TTL exists to prevent.
 */
export const DRAFT_VERSION = 1;

/**
 * THE CLOSED VOCABULARY of things that may hold a draft.
 *
 * A free-form id would make the key space unbounded and untestable: a typo would write a
 * draft nothing ever reads, and two forms could collide on one key and overwrite each
 * other's answers with no diff that looks wrong. So the ids are enumerated, and
 * `admin-drafts.test.mjs` source-scans both apps for a `useDraft(` call with a literal
 * that is not in this list.
 *
 * NOT here, deliberately: the VA chat wizard (it resumes server side and must keep exactly
 * one source of truth) and the OpenAIConfig MCP endpoint block (a separate change, and the
 * form is dense with credentials).
 */
export const DRAFT_FORM_IDS = Object.freeze({
  ADD_RULE_WIZARD: "add-rule-wizard",
  CODE_PIPELINE: "code-pipeline",
  CODE_CONNECTION: "code-connection",
  VA_EDITOR: "va-editor",
  LISTENER_EDITOR: "listener-editor",
  JOB_EDITOR: "job-editor",
  SKILL_EDITOR: "skill-editor",
  DOC_ADD: "doc-add",
  MEMORY_ADD: "memory-add",
});

const FORM_ID_LIST = Object.freeze(Object.values(DRAFT_FORM_IDS));

/** Is this a form id the vocabulary knows? The hook and the test both ask. */
export const isDraftFormId = (id) => FORM_ID_LIST.indexOf(id) !== -1;

/**
 * `cr-draft:<accountId>:<formId>` - one draft per admin per form.
 *
 * Keyed on the ACCOUNT and not on the browser because two admins on one shared machine
 * must not read each other's half-finished work, and because the panel already knows the
 * account (`checkIsAdmin` returns it). Both parts go through the same sanitiser the KVS
 * key builders use: an account id arrives from a resolver, and a value interpolated into
 * a storage key without a sanitiser is a key-injection waiting for the first id that
 * contains a colon. `safeKeyPart` also clamps the length, so a hostile id cannot make an
 * unbounded key.
 *
 * AND THEN THE COLON GOES TOO, which `safeKeyPart` alone does not do. It deliberately
 * PERMITS `:` because every KVS builder in this app uses colons as its own separators and
 * is namespaced by a distinct prefix. Here the separator is the only structure the key
 * has, so an accountId containing one silently produces a FOUR segment key
 * (`cr-draft:a:code-pipeline:doc-add`) that no sweep or parse would read as it looks. No
 * collision with a real form is reachable today, because every id in the vocabulary is
 * plain kebab and the form segment is always last - but that is an accident of the
 * current vocabulary, not a property, and the next id with a colon in it would make it
 * one. The invariant asserted by `draft-state.test.mjs` is simply: three segments, always,
 * for every input.
 *
 * Returns null for anything it will not name: an absent account (the panel sets it ASYNC,
 * and a draft keyed on "null" would be shared by every admin and restored into the wrong
 * session), an id outside the vocabulary, or an account that sanitises down to nothing
 * distinguishing. The caller reads null as "no draft today", the silent-open stance.
 */
const keySegment = (s) => safeKeyPart(s).replace(/:/g, "-");
export const draftKey = (accountId, formId) => {
  if (!accountId || typeof accountId !== "string") return null;
  if (!isDraftFormId(formId)) return null;
  const account = keySegment(accountId);
  if (!account || /^-+$/.test(account)) return null;
  return `cr-draft:${account}:${keySegment(formId)}`;
};

/** The prefix a sweep uses to find every draft this browser holds. A PREFIX, not a key. */
export const DRAFT_KEY_PREFIX = "cr-draft:";

/**
 * THE NAMED EXCLUSION LIST - field names that are never written to a draft.
 *
 * Grouped by why, because "it is a secret" is only one of the three reasons and the other
 * two are the ones that get argued away later.
 */
export const DRAFT_SECRET_FIELDS = Object.freeze([
  /* 1. CREDENTIALS THE ADMIN TYPES. OpenAIConfig's provider key and every MCP bearer. */
  "keyInput",
  "docProcBearerInput",
  "webSearchBearerInput",
  "webSearchSerperInput",
  "webSearchGithubInput",
  "context7ApiKeyInput",
  /* 2. CREDENTIALS AND IDENTITY THE CODE TAB TAKES. A git token, the Atlassian API token
     behind the scaffold pipeline, the email they are paired with, and the consent flag
     that records a deliberate act, because a consent restored from storage is not
     consent. */
  "token",
  "rotateToken",
  "email",
  "rotateEmail",
  "identityEmail",
  "identityToken",
  "identityConsent",
  /* 3. SERVER TRUTH AND IN-FLIGHT STATE. `has*` flags say what the TENANT has stored, not
     what this form holds, and a week-old copy of one makes the UI claim a key exists that
     does not. Task ids, polling handles and busy flags describe an async job that has
     since finished or expired: restoring them yields a spinner with nothing behind it. */
  "hasKey",
  "hasToken",
  "hasDocProcBearer",
  "hasWebSearchBearer",
  "hasWebSearchSerper",
  "hasWebSearchGithub",
  "hasContext7ApiKey",
  "taskId",
  "generationTaskId",
  "reviewTaskId",
  "fixTaskId",
  "pollTimer",
  "polling",
  "generating",
  "isGenerating",
  "testing",
  "saving",
  "busy",
  "inFlight",
]);

const NAMED = new Set(DRAFT_SECRET_FIELDS);

/**
 * The deny-by-shape belt. Anything whose NAME reads like a credential or an async handle
 * is dropped whether or not it is named above.
 *
 * Case-insensitive and substring, on purpose: `webSearchSerperInput`, `gitToken`,
 * `apiKeyDraft` and `myNewToken` must all lose. `has*` is NOT in this shape, because it is
 * far too common a prefix in ordinary form state ("hasChanges", "hasCustomUi") to
 * blanket-ban, so the server-truth flags stay a NAMED problem and this belt stays about
 * secrets.
 */
const SECRETISH = /token|secret|bearer|apikey|api_key|password|credential|keyinput|taskid/i;
export const isSecretishKey = (name) => typeof name === "string" && SECRETISH.test(name);

/** Would this field be persisted? Both halves of the belt, in one question. */
export const isExcludedDraftField = (name) => NAMED.has(name) || isSecretishKey(name);

/**
 * Deep-copy `state` minus every excluded field, and minus everything that cannot survive
 * `JSON.stringify` intact anyway.
 *
 * Functions, DOM nodes, timers and React refs are dropped rather than serialised to
 * `null`, because a restored `null` where a callback was is a crash at the first call and
 * a dropped key is simply an unset field the form will default. Depth is bounded: form
 * state is shallow, and a cycle or a pathological nesting must cost a truncated draft, not
 * a blown stack in the admin panel.
 */
const MAX_DEPTH = 12;
export const pruneDraft = (state, depth = 0) => {
  if (state === null || state === undefined) return undefined;
  const t = typeof state;
  if (t === "string" || t === "boolean") return state;
  if (t === "number") return Number.isFinite(state) ? state : undefined;
  if (t !== "object") return undefined; // function, symbol, bigint
  if (depth >= MAX_DEPTH) return undefined;
  if (Array.isArray(state)) {
    const out = [];
    for (const v of state) {
      const p = pruneDraft(v, depth + 1);
      /* An array is POSITIONAL: dropping element 3 would silently renumber 4 and 5, so a
         value this function will not keep becomes null here rather than disappearing. */
      out.push(p === undefined ? null : p);
    }
    return out;
  }
  if (state instanceof Date) return state.toISOString();
  /* Anything else exotic (Map, Set, Element, Error) has no faithful JSON form. */
  const proto = Object.getPrototypeOf(state);
  if (proto !== Object.prototype && proto !== null) return undefined;
  const out = {};
  for (const k of Object.keys(state)) {
    if (isExcludedDraftField(k)) continue;
    const p = pruneDraft(state[k], depth + 1);
    if (p !== undefined) out[k] = p;
  }
  return out;
};

/**
 * The size clamp. 512 KB of UTF-16 is far more than any form here can legitimately hold
 * and well inside a 5 MB localStorage budget shared with the coder panel's thread list; a
 * draft bigger than this is a bug (a pasted document, a whole doc library echoed into
 * state) and writing it would risk evicting every OTHER form's draft on quota.
 */
export const DRAFT_MAX_CHARS = 512 * 1024;

/**
 * Prune, stamp and stringify. Returns null when there is nothing worth writing or when
 * the result is over the clamp. In both cases the caller simply does not write, and the
 * previous draft (if any) is left alone rather than replaced with a broken one.
 */
export const serializeDraft = (state, now = Date.now()) => {
  const data = pruneDraft(state);
  if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).length === 0) return null;
  let raw;
  try {
    raw = JSON.stringify({ v: DRAFT_VERSION, savedAt: Number(now) || 0, data });
  } catch (e) {
    return null;
  }
  if (!raw || raw.length > DRAFT_MAX_CHARS) return null;
  return raw;
};

/**
 * Read one back. Returns `{ data, savedAt }` or null for: corrupt JSON, a foreign or
 * missing version stamp, or a payload that is not an object. Never throws, because this
 * runs on mount and a bad string in storage must not be able to white-screen the panel.
 *
 * The prune is applied AGAIN on the way in. The write side is the only one that should
 * ever have produced this string, but "should" is not a guarantee for a value any script
 * on the origin can write, and a restored field is about to be pushed into form state.
 */
export const deserializeDraft = (raw) => {
  if (typeof raw !== "string" || !raw) return null;
  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) { return null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (parsed.v !== DRAFT_VERSION) return null;
  const data = pruneDraft(parsed.data);
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const savedAt = Number(parsed.savedAt);
  return { data, savedAt: Number.isFinite(savedAt) ? savedAt : 0 };
};

const DAY_MS = 86400000;
/** Older than the TTL, or stamped with a time we cannot believe, is stale. */
export const isDraftStale = (savedAt, now = Date.now()) => {
  const t = Number(savedAt);
  if (!Number.isFinite(t) || t <= 0) return true;
  return (Number(now) || 0) - t > DRAFT_TTL_DAYS * DAY_MS;
};

/**
 * "4 minutes ago" for the resume card. Lives here rather than in the hook so nine forms
 * cannot phrase the same sentence nine ways, and so the copy obeys the house rule against
 * em and en dashes.
 */
export const draftAgeLabel = (savedAt, now = Date.now()) => {
  const ms = Math.max(0, (Number(now) || 0) - (Number(savedAt) || 0));
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "a moment ago";
  if (mins === 1) return "1 minute ago";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  if (hours === 1) return "1 hour ago";
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
};
