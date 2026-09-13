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
 */

/**
 * LISTENERS — Jira product-event rules (the ScriptRunner "Script Listener" surface,
 * rebuilt around AI).
 *
 * Flow:
 *   manifest `trigger` modules (every Jira / Jira Software / JSM event)
 *   — or, for `source:"git"` events, the app's git webhook →
 *     → listenerTrigger(event)            25s platform budget: match + enqueue only
 *     → async-ai-queue  taskType "listener"
 *     → executeListenerTask(params)        120s consumer budget: filters that need
 *                                          I/O, the AI condition, then the run
 *   run = "script" (sandbox code steps bound to the event's issue) or "agent"
 *         (the AI decides + acts through allow-listed tools).
 *
 * Storage: `listener_index` (slim rows: identity, events, project keys, stats) and
 * `listener:{id}` (full config incl. code). The index is what the trigger reads on
 * EVERY subscribed event (cached 30s per warm container), so it must stay small.
 */
import { kvs as storage } from "@forge/kvs";
import { normalizeRepoId } from "./shared/git-ids.js";
import api, { route } from "@forge/api";
import {
  isKnownEvent, getEvent, eventLabel, extractEventContext, changedFieldsOf, commentTextOf,
  trimEventPayload, adfToPlainText, isGitEvent, requiresRepoFilter,
} from "./shared/jira-events.js";
import { assertAllowedActions, buildAgentGateContext, DEFAULT_AGENT_ACTIONS, DEFAULT_AGENT_ROUNDS, MAX_AGENT_ROUNDS } from "./shared/agent-actions.js";
import { redosRisk } from "./shared/regex-safety.js";
import { agentResultFields } from "./shared/agent-result.js";
import { claimRuleExecution } from "./shared/execution-claim.js";
import { LISTENER_STATS_KEY, statsForRule, statsReceipt, deleteRuleWithStats } from "./rule-stats.js";

const idx = () => import("./index.js");
const agentMod = () => import("./agent-runner.js");

export const LISTENER_INDEX_KEY = "listener_index";
export const LISTENER_PREFIX = "listener:";
// Run statistics live in their OWN key (a map id → stats) so the consumers never
// read-modify-write the index or the config record: a stats update racing a save
// could otherwise revert the save (lost update). The rule_stats consumer also
// serializes stats-vs-stats writes, so simultaneous completions retain every count.
export { LISTENER_STATS_KEY };
export const EXEC_CLAIM_PREFIX = "lst_exec:";
const EXEC_CLAIM_TTL = { ttl: { value: 2, unit: "HOURS" } };
const INDEX_MAX_BYTES = 200 * 1024;
const STEP_CODE_MAX = 32768;
const COMMENT_MATCH_MAX = 4000;
export const EVENT_SAMPLE_PREFIX = "event_sample:";
export const MAX_LISTENERS = 200;
const LISTENER_MAX_BYTES = 200 * 1024;
const MAX_CANDIDATES_PER_EVENT = 25;
const LISTENER_RUN_BUDGET_MS = 105000;   // inside the 120s consumer cap, with log headroom
const TRIGGER_BUDGET_MS = 18000;         // inside the 25s trigger cap
// A saved listener needs ~35s before live event tests: each warm container caches 30s.
const INDEX_CACHE_TTL_MS = 30000;
// Loop brakes: per issue and per listener, fixed 5-minute buckets.
const BRAKE_PREFIX = "lst_brake:";
const BRAKE_BUCKET_MS = 300000;
export const BRAKE_MAX_PER_ISSUE = 30;
export const BRAKE_MAX_PER_LISTENER = 120;
const SAMPLE_TTL = { ttl: { value: 7, unit: "DAYS" } };
const SAMPLE_MIN_INTERVAL_MS = 15 * 60 * 1000;

const nowIso = () => new Date().toISOString();
const clampStr = (v, n) => (v == null ? "" : String(v)).slice(0, n);
const clampInt = (v, lo, hi, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const uniqStrings = (arr, max, mapFn = (s) => s) => {
  const out = [];
  for (const v of Array.isArray(arr) ? arr : []) {
    const s = mapFn(clampStr(v, 200).trim());
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= max) break;
  }
  return out;
};
export const newListenerId = () => `lst_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const safeKeyPart = (s) => String(s).replace(/[^a-zA-Z0-9:._#-]/g, "-").slice(0, 120);

// ── Validation / normalisation (shared by the resolvers AND the REST API) ─────

/**
 * The role the SAVER held, recorded on the rule row at save time.
 *
 * Why a stored field and not a live check: a run has no user. A queued PR review
 * executes as the app, hours after the save, with nobody's permissions attached —
 * so the only honest answer to "may this rule arm an AI to approve a pull request"
 * is the role of the human who saved it. Least privilege is the DEFAULT: a caller
 * that does not pass a role gets "editor", which can never unlock a verdict action.
 * (F-311: this field did not exist before 1.4 commit 5c; rows saved earlier carry
 * no `savedByRole` and are therefore treated as "editor" on read.)
 */
export const SAVED_BY_ROLES = ["admin", "editor"];
export const normalizeSavedByRole = (role) => (role === "admin" ? "admin" : "editor");

/**
 * Validate + clamp a listener config. Throws Error(message) on hard errors.
 * `existing` (previous full record) preserves identity/stats on update.
 */
export const normalizeListener = (input = {}, { existing = null, accountId = null, gate = undefined, savedByRole = "editor" } = {}) => {
  const src = input && typeof input === "object" ? input : {};
  const id = existing ? existing.id : (typeof src.id === "string" && /^[A-Za-z0-9_.-]{3,80}$/.test(src.id) ? src.id : newListenerId());
  const name = clampStr(src.name, 120).trim();
  if (!name) throw new Error("name is required");
  const events = uniqStrings(src.events, 100).filter(isKnownEvent);
  if (!events.length) throw new Error("events must contain at least one supported Jira event id (see GET ?resource=events)");
  const f = src.filters && typeof src.filters === "object" ? src.filters : {};
  const filters = {
    projectKeys: uniqStrings(f.projectKeys, 50, (s) => s.toUpperCase()),
    issueTypes: uniqStrings(f.issueTypes, 30),
    jql: clampStr(f.jql, 2000).trim().replace(/\s+ORDER\s+BY\s+[\s\S]*$/i, "").trim(),
    changedFields: uniqStrings(f.changedFields, 50),
    commentPattern: clampStr(f.commentPattern, 300),
    // Repository allow-list for git events. Same normalisation as
    // git-connections.normalizeRepoId ("owner/name", trimmed, lower-cased) — see
    // the FINDINGS ledger row asking for one shared home for that one line.
    // F-310 - the ONE normaliser, shared with the connection allow-list, the webhook
    // envelope and the admin picker. A filter canonicalised differently from the
    // envelope is a listener that looks configured and never matches.
    repos: uniqStrings(f.repos, 50, normalizeRepoId),
  };
  // There is NO "all repositories" listener. A git event names a repo, the app
  // may be connected to hundreds, and a listener that fired on every one of them
  // would be a cost and blast-radius surprise, not a convenience.
  const gitEvents = events.filter(requiresRepoFilter);
  if (gitEvents.length && !filters.repos.length) {
    throw new Error(`filters.repos is required for git events (${gitEvents.join(", ")}): list the repositories ("owner/name") this listener may run for`);
  }
  if (filters.commentPattern) {
    const risk = redosRisk(filters.commentPattern);
    if (risk) throw new Error(`filters.commentPattern is unsafe: ${risk}`);
    try { new RegExp(filters.commentPattern, "i"); } catch (e) { throw new Error(`filters.commentPattern is not a valid regex: ${e.message}`); }
  }
  const mode = src.mode === "agent" ? "agent" : "script";
  const functions = Array.isArray(src.functions) ? src.functions.slice(0, 50).map((fn, i) => normalizeStep(fn, i)) : [];
  const a = src.agent && typeof src.agent === "object" ? src.agent : {};
  const agent = {
    instructions: clampStr(a.instructions, 6000),
    // SAVE TIME FAILS CLOSED (F-277): an action this context may not use is REFUSED,
    // never quietly stripped — the admin UI offers the checkbox and the REST API
    // advertises the id, so saving fewer actions than were ticked would leave the
    // operator believing a gate they cannot see. `gate` omitted = restrictive default.
    allowedActions: assertAllowedActions(a.allowedActions == null ? DEFAULT_AGENT_ACTIONS : a.allowedActions, gate),
    maxRounds: clampInt(a.maxRounds, 1, MAX_AGENT_ROUNDS, DEFAULT_AGENT_ROUNDS),
  };
  if (mode === "agent" && !agent.instructions.trim()) throw new Error("agent.instructions is required in agent mode");
  if (mode === "agent" && String(a.instructions || "").length > 6000) throw new Error("agent.instructions exceeds 6000 characters");
  if (mode === "script" && functions.length === 0) throw new Error("functions must contain at least one code step in script mode");
  if (String(src.aiCondition || "").length > 1500) throw new Error("aiCondition exceeds 1500 characters");
  const role = normalizeSavedByRole(savedByRole);
  // Which engine an agentless instance runs for this listener. Only the deterministic
  // PR-review engine exists (taskType "gitreview", src/git-review.js); the id is the
  // premade catalogue's own `agentlessTaskType`, validated here so an arbitrary string
  // from the REST API can never name a task type.
  const agentlessTaskType = src.agentlessTaskType === "gitreview" ? "gitreview" : null;
  // A VERDICT IS NOT AN ACTION. `allowVerdictActions` lets the review engine approve or
  // request changes on a pull request, so it is armable ONLY on a rule an ADMIN saved.
  // An editor ticking it does not get an error (the checkbox is theirs to express) — it
  // is stored as false, and executeGitReview re-checks `savedByRole` anyway, because a
  // permission asserted in one place is one refactor away from being asserted nowhere.
  const gr = src.gitReview && typeof src.gitReview === "object" ? src.gitReview : null;
  const gitReview = gr ? { allowVerdictActions: role === "admin" && gr.allowVerdictActions === true } : null;
  const out = {
    id, name,
    description: clampStr(src.description, 2000),
    enabled: src.enabled !== false,
    events, filters,
    ignoreSelf: src.ignoreSelf !== false,
    aiCondition: clampStr(src.aiCondition, 1500).trim(),
    mode, functions, agent,
    agentlessTaskType, gitReview,
    simulationMode: src.simulationMode === true,
    suppressNotifications: src.suppressNotifications === true,
    savedByRole: role,
    createdBy: existing ? existing.createdBy || accountId || null : accountId || null,
    createdAt: existing ? existing.createdAt || nowIso() : nowIso(),
    updatedAt: nowIso(),
  };
  const bytes = Buffer.byteLength(JSON.stringify(out), "utf8");
  if (bytes > LISTENER_MAX_BYTES) throw new Error(`listener is too large (${bytes} bytes > ${LISTENER_MAX_BYTES})`);
  return out;
};

export const emptyStats = () => ({ runCount: 0, errorCount: 0, lastRunAt: null, lastStatus: null, lastError: null, lastIssueKey: null });

// A code step keeps the FunctionBuilder shape; strings clamped, unknown keys dropped.
export const normalizeStep = (fn = {}, i = 0) => {
  const s = fn && typeof fn === "object" ? fn : {};
  const out = {
    id: clampStr(s.id, 60) || `step-${i + 1}`,
    name: clampStr(s.name, 120) || `Step ${i + 1}`,
    operationType: clampStr(s.operationType, 40) || "work_item_query",
    operationPrompt: clampStr(s.operationPrompt || s.description, 8000),
    conditionPrompt: clampStr(s.conditionPrompt, 2000),
    endpoint: clampStr(s.endpoint, 500),
    method: clampStr(s.method, 10) || "GET",
    variableName: clampStr(s.variableName, 60),
    code: String(s.code == null ? "" : s.code),
    includeBackoff: s.includeBackoff === true,
  };
  if (out.code.length > STEP_CODE_MAX) throw new Error(`step "${out.name}" code exceeds ${STEP_CODE_MAX} characters (${out.code.length}) — split it into smaller steps`);
  if (Array.isArray(s.selectedDocIds)) out.selectedDocIds = uniqStrings(s.selectedDocIds, 10);
  if (Array.isArray(s.selectedSkillIds)) out.selectedSkillIds = uniqStrings(s.selectedSkillIds, 4);
  if (s.generationMeta && typeof s.generationMeta === "object") out.generationMeta = s.generationMeta;
  if (typeof s.testedFingerprint === "string") out.testedFingerprint = s.testedFingerprint.slice(0, 80);
  return out;
};

export const toIndexRow = (full) => ({
  id: full.id, name: full.name, enabled: full.enabled !== false, events: full.events,
  projectKeys: (full.filters && full.filters.projectKeys) || [], mode: full.mode,
  // The trigger pre-filters git deliveries on the slim row, before any full read.
  repos: (full.filters && full.filters.repos) || [],
  hasAiCondition: Boolean(full.aiCondition), simulationMode: full.simulationMode === true,
  createdBy: full.createdBy || null, createdAt: full.createdAt, updatedAt: full.updatedAt,
});

// ── Storage ──────────────────────────────────────────────────────────────────

let _indexCache = null;
export const readListenerIndex = async ({ cached = false } = {}) => {
  if (cached && _indexCache && Date.now() - _indexCache.at < INDEX_CACHE_TTL_MS) return _indexCache.value;
  const value = (await storage.get(LISTENER_INDEX_KEY)) || [];
  const rows = Array.isArray(value) ? value : [];
  _indexCache = { value: rows, at: Date.now() };
  return rows;
};
const writeListenerIndex = async (rows) => { await storage.set(LISTENER_INDEX_KEY, rows); _indexCache = null; };

export const readStatsMap = async () => { const v = (await storage.get(LISTENER_STATS_KEY)) || {}; return v && typeof v === "object" ? v : {}; };
const withStats = (row, statsMap) => ({ ...row, stats: { ...emptyStats(), ...statsForRule(statsMap && statsMap[row.id], row) } });

export const listListeners = async () => {
  const [rows, statsMap] = await Promise.all([readListenerIndex(), readStatsMap()]);
  return rows.map((r) => withStats(r, statsMap)).sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
};
export const getListener = async (id) => {
  if (!id) return null;
  const full = (await storage.get(LISTENER_PREFIX + safeKeyPart(id))) || null;
  if (!full) return null;
  try { full.stats = { ...emptyStats(), ...statsForRule((await readStatsMap())[id], full) }; } catch { full.stats = emptyStats(); }
  return full;
};

export const saveListener = async (input, { accountId = null, gate = undefined, savedByRole = "editor" } = {}) => {
  const existing = input && input.id ? await getListener(input.id) : null;
  // The role belongs to THIS save, not to the row's history: an admin-armed rule that
  // an editor edits is re-recorded as editor and loses its verdict actions. That is the
  // intended direction — privilege can only be granted by someone who holds it.
  const full = normalizeListener(input, { existing, accountId, gate, savedByRole });
  delete full.stats; // stats live in LISTENER_STATS_KEY — never inside the record
  const rows = await readListenerIndex();
  const at = rows.findIndex((r) => r.id === full.id);
  if (at < 0 && rows.length >= MAX_LISTENERS) throw new Error(`Listener limit reached (${MAX_LISTENERS}). Delete unused listeners first.`);
  const row = toIndexRow(full);
  const next = rows.slice();
  if (at >= 0) next[at] = row; else next.push(row);
  const indexBytes = Buffer.byteLength(JSON.stringify(next), "utf8");
  if (indexBytes > INDEX_MAX_BYTES) throw new Error(`Listener index would exceed ${INDEX_MAX_BYTES} bytes (${indexBytes}). Delete unused listeners or subscribe to fewer events.`);
  // Index first, record second: a failed record write leaves a row the trigger skips
  // (getListener → null) instead of an orphaned record nobody can see.
  await writeListenerIndex(next);
  await storage.set(LISTENER_PREFIX + safeKeyPart(full.id), full);
  return { ...full, stats: (existing && existing.stats) || emptyStats() };
};

export const deleteListener = async (id) => {
  const full = await getListener(id);
  const rows = await readListenerIndex();
  const next = rows.filter((r) => r.id !== id);
  if (!full && next.length === rows.length) return { removed: false };
  await deleteRuleWithStats({ kind: "listener", rule: full || { id, createdAt: null }, recordKey: LISTENER_PREFIX + safeKeyPart(id), indexKey: LISTENER_INDEX_KEY, indexRows: next });
  _indexCache = null;
  return { removed: next.length !== rows.length };
};

export const setListenerEnabled = async (id, enabled) => {
  const full = await getListener(id);
  if (!full) throw new Error("Listener not found");
  const stats = full.stats; delete full.stats;
  full.enabled = enabled !== false; full.updatedAt = nowIso();
  const rows = await readListenerIndex();
  const at = rows.findIndex((r) => r.id === id);
  if (at >= 0) rows[at] = toIndexRow(full); else rows.push(toIndexRow(full));
  await writeListenerIndex(rows);
  await storage.set(LISTENER_PREFIX + safeKeyPart(id), full);
  return { ...full, stats };
};

// ── Matching (pure — exported for offline tests) ─────────────────────────────

// The slim index and the full record share this predicate. Project ids are
// resolved to keys before matching; projectIds is not a supported config filter.
export const matchesListenerProject = (projectKeys, ctx) => {
  if (!projectKeys || !projectKeys.length || (getEvent(ctx.eventType) || {}).projectScoped === false) return true;
  return Boolean(ctx.projectKey && projectKeys.some((key) => String(key).toUpperCase() === String(ctx.projectKey).toUpperCase()));
};

/**
 * Repository allow-list for git events. Project filters do NOT apply to a git
 * event (a repository is not a Jira project — `projectScoped:false` in the
 * catalogue already makes matchesListenerProject pass), so THIS is the only
 * scoping a git listener has, and an empty list matches NOTHING (save-time
 * validation refuses it; a legacy row without one must not fire on everything).
 */
export const matchesListenerRepos = (repos, ctx) => {
  const want = Array.isArray(repos) ? repos.map(normalizeRepoId) : [];
  if (!want.length) return false;
  const have = ctx.repoId ? String(ctx.repoId).trim().toLowerCase() : null;
  return Boolean(have && want.includes(have));
};

/**
 * Static filters that need no I/O. Returns { ok:true } or { ok:false, reason }.
 * `ctx` is extractEventContext(); `event` the raw payload.
 */
export const matchListenerStatic = (listener, ctx, event) => {
  if (listener.enabled === false) return { ok: false, reason: "disabled" };
  if (!Array.isArray(listener.events) || !listener.events.includes(ctx.eventType)) return { ok: false, reason: "event not subscribed" };
  if (listener.ignoreSelf !== false && ctx.selfGenerated) return { ok: false, reason: "self-generated event ignored" };
  const f = listener.filters || {};
  const meta = getEvent(ctx.eventType) || {};
  if (!matchesListenerProject(f.projectKeys, ctx)) return { ok: false, reason: `project ${ctx.projectKey || ctx.projectId || "(unknown)"} not in filter` };
  if (meta.repos === true && !matchesListenerRepos(f.repos, ctx)) return { ok: false, reason: `repository ${ctx.repoId || "(unknown)"} not in the listener's repos filter` };
  if (f.issueTypes && f.issueTypes.length && meta.issueBound) {
    const want = f.issueTypes.map((t) => String(t).toLowerCase());
    const haveName = ctx.issueTypeName ? String(ctx.issueTypeName).toLowerCase() : null;
    const haveId = ctx.issueTypeId ? String(ctx.issueTypeId) : null;
    if (!(haveName && want.includes(haveName)) && !(haveId && want.includes(haveId))) return { ok: false, reason: `issue type ${ctx.issueTypeName || "(unknown)"} not in filter` };
  }
  if (f.changedFields && f.changedFields.length && ctx.eventType === "avi:jira:updated:issue") {
    const changed = changedFieldsOf(event).map((s) => s.toLowerCase());
    const want = f.changedFields.map((s) => String(s).toLowerCase());
    if (!want.some((w) => changed.includes(w))) return { ok: false, reason: `none of the watched fields changed (changed: ${changed.slice(0, 8).join(", ") || "none"})` };
  }
  if (f.commentPattern && (getEvent(ctx.eventType) || {}).entity === "comment") {
    let re;
    try { re = new RegExp(f.commentPattern, "i"); } catch { return { ok: false, reason: "comment pattern invalid" }; }
    const text = commentTextOf(event).slice(0, COMMENT_MATCH_MAX);
    if (!re.test(text)) return { ok: false, reason: "comment does not match the pattern" };
  }
  return { ok: true };
};

// ── ignoreSelf for git events ────────────────────────────────────────────────
//
// Forge's `selfGenerated` flag (matchListenerStatic above) answers "did OUR app
// cause this Jira event". A git provider sends no such flag, so the same question
// is answered differently: compare the delivery's actor login to the login the
// CONNECTION's credential reported at whoami (cached on the connection row as
// `login`). The two self-detections keep separate names on purpose — one field for
// both would be exactly the "N copies of one rule" defect (FRAME 1.4 §commit 5).
//
// Injected, never statically imported: git-connections.js pulls @forge/kvs and the
// provider layer at module load, and this file is on the hottest path in the app
// (every product event). The default resolver lazy-imports it, the same way index.js
// is reached through idx().
let _identityResolver = null;
/** Test/DI seam: setConnectionIdentityResolver(async (connId) => ({ login })). */
export const setConnectionIdentityResolver = (fn) => { _identityResolver = typeof fn === "function" ? fn : null; };
const defaultConnectionIdentity = async (connId) => {
  const gc = await import("./git-connections.js");
  const row = await gc.getConnection(connId);
  // Every identifier the connection row has kept, not just the label (F-326). The row
  // owner stores what whoami returned; missing fields simply do not participate.
  return row ? { login: row.login || null, accountId: row.accountId || null, uuid: row.uuid || null, id: row.accountIdNumeric || row.userId || null } : null;
};
export const getConnectionIdentity = (connId) => (_identityResolver || defaultConnectionIdentity)(connId);

/**
 * Are these two git identities the same actor? (F-326)
 *
 * NOT a login comparison. Bitbucket's own payloads disagree about a user's NAME —
 * whoami returns `username || nickname`, a PR comment's author is `nickname ||
 * display_name` — so a login-only check was permanently false for some workspaces and
 * ignoreSelf was inert with nothing in the log saying so. Compare every stable
 * identifier either side offers (`accountId`, `uuid`, numeric `id`) and fall back to
 * the lower-cased login. Any ONE matching identifier is a match; a match on nothing is
 * not a match.
 *
 * Accepts a bare login string on either side, so every existing caller keeps working.
 */
const gitIdentity = (v) => {
  if (v == null) return {};
  if (typeof v === "string") return { login: v.trim().toLowerCase() };
  const norm = (x) => (x == null ? "" : String(x).trim().toLowerCase());
  return { login: norm(v.login), accountId: norm(v.accountId), uuid: norm(v.uuid), id: norm(v.id) };
};
export const sameGitActor = (a, b) => {
  const x = gitIdentity(a);
  const y = gitIdentity(b);
  // Ids first: they survive a rename and they never collide across accounts.
  for (const k of ["accountId", "uuid", "id"]) if (x[k] && y[k] && x[k] === y[k]) return true;
  // A login match is only trusted when neither side offered an id that DISAGREED.
  for (const k of ["accountId", "uuid", "id"]) if (x[k] && y[k] && x[k] !== y[k]) return false;
  return Boolean(x.login && y.login && x.login === y.login);
};

/**
 * True when this git delivery was caused by the connection's OWN credential — the
 * loop this surface fears most (our comment on a PR re-delivering as a PR comment
 * event that makes us comment again).
 *
 * FAILS OPEN on a lookup error: dropping real deliveries because a storage read
 * blipped is silent data loss, and the per-issue / per-listener brakes still cap a
 * loop at 30 / 120 per 5 minutes. Say it in the log when it happens.
 */
export const isGitSelfEvent = async (ctx) => {
  if (!ctx || !isGitEvent(ctx.eventType) || !ctx.connectionId) return false;
  // Either a login or a stable id is enough to ask the question (F-326).
  const actor = { login: ctx.actorLogin || null, accountId: ctx.actorAccountIdGit || null, uuid: ctx.actorUuid || null, id: ctx.actorId || null };
  if (!actor.login && !actor.accountId && !actor.uuid && !actor.id) return false;
  try {
    const who = await getConnectionIdentity(ctx.connectionId);
    return sameGitActor(actor, who);
  } catch (e) {
    console.warn("[listener] git ignoreSelf lookup failed (event NOT dropped; brakes still apply):", e && e.message);
    return false;
  }
};

const jqlMatchesIssue = async (issueKey, jql) => {
  const res = await api.asApp().requestJira(route`/rest/api/3/search/jql`, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ jql: `key = ${issueKey} AND (${jql})`, maxResults: 1, fields: ["key"] }),
  });
  if (!res.ok) throw new Error(`JQL check failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return Array.isArray(data.issues) && data.issues.some((i) => i.key === issueKey);
};

const _projectKeyCache = new Map();
const resolveProjectKey = async (projectId) => {
  if (_projectKeyCache.has(projectId)) return _projectKeyCache.get(projectId);
  const res = await api.asApp().requestJira(route`/rest/api/3/project/${projectId}?properties=`);
  if (!res.ok) return null;
  const key = ((await res.json()) || {}).key || null;
  if (key) _projectKeyCache.set(projectId, key);
  return key;
};

// Resolve key/project/type for id-only payloads (worklog, link, attachment) with ONE read.
const resolveIssueById = async (issueId) => {
  const res = await api.asApp().requestJira(route`/rest/api/3/issue/${issueId}?fields=project,issuetype`);
  if (!res.ok) return null;
  const d = await res.json();
  return { issueKey: d.key, projectKey: d.fields && d.fields.project ? d.fields.project.key : null, projectId: d.fields && d.fields.project ? String(d.fields.project.id) : null, issueTypeId: d.fields && d.fields.issuetype ? String(d.fields.issuetype.id) : null, issueTypeName: d.fields && d.fields.issuetype ? d.fields.issuetype.name : null };
};

// ── Brakes ───────────────────────────────────────────────────────────────────

const readBrake = async (key) => {
  try { return { key, count: Number(await storage.get(key)) || 0 }; } catch { return { key, count: 0, readFailed: true }; }
};
const bumpBrake = async (b) => { if (b.readFailed) return; try { await storage.set(b.key, b.count + 1, { ttl: { value: 15, unit: "MINUTES" } }); } catch { /* best-effort */ } };
/**
 * The per-OBJECT brake key (F-320).
 *
 * For a Jira event the object is the issue. For a GIT delivery there usually is NO
 * issue key — one is present only when the webhook parsed one out of a branch name or
 * a PR title, which is advisory and usually absent — so the 30-per-5-minutes loop
 * guard did not exist for git at all and the only ceiling left was 120 per listener
 * per 5 minutes, i.e. a steady ~34k comments a day on someone's pull request. The
 * object for a git delivery is the PULL REQUEST (`repo#number`), falling back to the
 * repository, so a loop on one PR is capped at 30 runs per 5 minutes like any issue.
 */
export const brakeObjectKey = (ctx) => {
  if (!ctx) return null;
  if (ctx.issueKey) return ctx.issueKey;
  if (isGitEvent(ctx.eventType) && ctx.repoId) return ctx.prNumber == null ? `git:${ctx.repoId}` : `git:${ctx.repoId}#${ctx.prNumber}`;
  return null;
};
const brakeKeys = (listenerId, objectKey) => {
  const bucket = Math.floor(Date.now() / BRAKE_BUCKET_MS);
  return { issue: objectKey ? `${BRAKE_PREFIX}${safeKeyPart(objectKey)}:${bucket}` : null, listener: `${BRAKE_PREFIX}L:${safeKeyPart(listenerId)}:${bucket}` };
};

// ── Event samples (the "last seen payload" reference in the editor) ──────────

const _sampleAt = new Map();
// Samples are references for the editor/REST, not execution payloads. Strip Forge
// context tokens at every depth on capture AND read, including legacy cached rows.
// JSON cloning keeps this idempotent and never mutates the raw event used by a run.
const cloneSampleWithoutContextTokens = (value) => JSON.parse(JSON.stringify(value, (key, child) => key === "contextToken" ? undefined : child));
/**
 * Samples show the SHAPE of a payload, never its CONTENT. What that guarantees,
 * exactly (it used to claim more than it did — only ADF was placeheld, so summaries,
 * string custom fields, labels, people and changelog values crossed project lines):
 *
 *  · Inside the CONTENT ZONES — `issue.fields`, `comment`, `worklog`, `changelog`,
 *    and any user-shaped object anywhere in the payload (accountId / displayName /
 *    emailAddress / avatarUrls) — EVERY string becomes `<redacted text, N chars>`
 *    and every ADF document becomes an empty doc, UNLESS it is schema rather than
 *    content: an id/key/self/accountId/field id (SAMPLE_STRUCTURAL_KEYS), a date or
 *    timestamp, or the NAME of a configuration object (status, status category,
 *    priority, issue type, resolution, project, link type). So `summary`, string and
 *    ADF custom fields, `labels`, `description`, `environment`, `comment.body`,
 *    `comment.renderedBody` (which commentTextOf reads when `body` is absent),
 *    `worklog.comment`, every changelog `fromString`/`toString` — for EVERY field,
 *    not just rich text — and every display name, email and avatar URL are placeheld.
 *  · The whole `issue.fields.comment` COLLECTION is dropped.
 *  · Keys, nesting, array lengths and value types survive, so the editor still shows
 *    the exact event shape; ids, keys, timestamps and the event type survive too.
 *
 * NOT redacted: everything outside those zones — entity metadata such as
 * `attachment.fileName` or a version/sprint/board name. Those are only ever stored
 * for an event that at least one enabled listener subscribes to AND whose project
 * passes that listener's project filter (see the capture call in listenerTrigger).
 */
const SAMPLE_STRUCTURAL_KEYS = new Set([
  "id", "key", "self", "accountId", "accountType", "atlassianId", "eventType", "type", "mimeType",
  "field", "fieldId", "fieldtype", "from", "to", "issueId", "projectId", "parentId", "entityId",
  "iconUrl", "colorName", "projectTypeKey",
]);
// `name` (and a link type's inward/outward wording) is configuration, not content,
// only when it belongs to one of these objects.
const SAMPLE_SCHEMA_PARENTS = new Set(["status", "statusCategory", "priority", "issuetype", "issueType", "resolution", "project", "type", "security", "securitylevel"]);
const SAMPLE_SCHEMA_KEYS = new Set(["name", "inward", "outward", "description"]);
const SAMPLE_TIMESTAMP = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}|$)/;
const sampleKeepsString = (value, key, parentKey) => SAMPLE_STRUCTURAL_KEYS.has(key)
  || SAMPLE_TIMESTAMP.test(value)
  || (SAMPLE_SCHEMA_KEYS.has(key) && SAMPLE_SCHEMA_PARENTS.has(parentKey));
const sampleIsUser = (v) => v && typeof v === "object" && !Array.isArray(v)
  && ("accountId" in v || "displayName" in v || "emailAddress" in v || "avatarUrls" in v);
// One pass, type-preserving. `content` turns on inside a content zone and stays on.
const redactSampleNode = (value, key, parentKey, content, depth = 0) => {
  if (value == null || depth > 24) return value;
  if (typeof value === "string") return content && !sampleKeepsString(value, key, parentKey) ? `<redacted text, ${value.length} chars>` : value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redactSampleNode(v, key, parentKey, content, depth + 1));
  if (content && value.type === "doc") return { type: "doc", version: 1, _redacted: true, content: [] };
  const inside = content || sampleIsUser(value);
  const out = {};
  for (const k of Object.keys(value)) out[k] = redactSampleNode(value[k], k, key, inside, depth + 1);
  return out;
};
export const redactSample = (payload) => {
  const p = cloneSampleWithoutContextTokens(payload || {});
  if (p.issue && p.issue.fields && p.issue.fields.comment) delete p.issue.fields.comment;
  const out = {};
  for (const k of Object.keys(p)) {
    if (k === "issue" && p.issue && typeof p.issue === "object" && !Array.isArray(p.issue)) {
      const issue = {};
      for (const ik of Object.keys(p.issue)) issue[ik] = redactSampleNode(p.issue[ik], ik, "issue", ik === "fields");
      out.issue = issue;
    } else {
      out[k] = redactSampleNode(p[k], k, "", k === "comment" || k === "worklog" || k === "changelog");
    }
  }
  return out;
};
const captureSample = async (eventType, event) => {
  // NO SAMPLE FOR A GIT DELIVERY, stated twice on purpose (the trigger also skips it).
  // redactSample below knows Jira content zones only — a PR title, a review body or a
  // commit message would be stored verbatim under a row labelled "redacted", which is
  // worse than no sample. Teaching the redactor the git envelope is a change to this
  // guard, not to the caller.
  if (isGitEvent(eventType)) return;
  const last = _sampleAt.get(eventType) || 0;
  if (Date.now() - last < SAMPLE_MIN_INTERVAL_MS) return;
  _sampleAt.set(eventType, Date.now());
  try {
    // `redactVersion` marks WHICH redaction produced this row. Reads never re-redact
    // (placeholders would change under the caller), so a row captured by an older,
    // weaker pass keeps its own content until its 7-day TTL expires; the marker is
    // how a future migration — or an operator — can tell the two apart.
    await storage.set(EVENT_SAMPLE_PREFIX + safeKeyPart(eventType), { eventType, capturedAt: nowIso(), redacted: true, redactVersion: 2, payload: trimEventPayload(redactSample(event), 20000) }, SAMPLE_TTL);
  } catch { /* best-effort */ }
};
export const getEventSample = async (eventType) => {
  if (!isKnownEvent(eventType)) return null;
  const sample = (await storage.get(EVENT_SAMPLE_PREFIX + safeKeyPart(eventType))) || null;
  // Do not reapply rich-text redaction: its placeholders would change on each read.
  return sample ? cloneSampleWithoutContextTokens(sample) : null;
};

// ── Queue ────────────────────────────────────────────────────────────────────

export const enqueueListenerRun = async ({ listener, eventType, event, ctx, source = "event" }) => {
  const m = await idx();
  const { Queue } = await import("@forge/events");
  const queue = new Queue({ key: "async-ai-queue" });
  const taskId = m.makeTaskId("listener");
  const enqueuedAt = nowIso();
  const params = { listenerId: listener.id, listenerName: listener.name, eventType, event: trimEventPayload(event, 60000), ctx, source, enqueuedAt };
  const body = { taskType: "listener", taskId, params };
  if (Buffer.byteLength(JSON.stringify(body), "utf8") > 180000) params.event = trimEventPayload(event, 8000);
  await queue.push({ body });
  await m.writeAsyncJob({ taskId, taskType: "listener", status: "queued", ruleId: listener.id, ruleName: listener.name, issueKey: ctx.issueKey || null, provider: null, model: null, accountId: null, enqueuedAt });
  return { taskId };
};

/**
 * A queued PR REVIEW for a listener that runs the deterministic engine instead of the
 * agent (`agentlessTaskType:"gitreview"` — the premade "Review every opened PR" row).
 * Same brakes, same claim discipline; a different consumer. `savedByRole` is NOT sent
 * in the params: executeGitReview reads it from the rule row, so a params forgery
 * cannot arm a verdict action.
 */
/** Bytes of diff a PR is likely to carry, from whatever size fields the envelope has. */
export const prDiffBytes = (pr) => {
  if (!pr || typeof pr !== "object") return null;
  const lines = Number(pr.additions) + Number(pr.deletions);
  if (Number.isFinite(lines) && lines > 0) return Math.min(lines * 40, 1024 * 1024);
  return null;
};

export const enqueueGitReviewRun = async ({ listener, ctx, event = null }) => {
  const m = await idx();
  const { Queue } = await import("@forge/events");
  const queue = new Queue({ key: "async-ai-queue" });
  const taskId = m.makeTaskId("gitreview");
  const enqueuedAt = nowIso();
  const params = {
    connId: ctx.connectionId || null, repoId: ctx.repoId || null, prNumber: ctx.prNumber ?? null,
    ruleId: listener.id, simulation: listener.simulationMode === true, enqueuedAt,
    // F-323 — the token governor prices a review by its DIFF, and only the producer
    // ever sees the PR's size (the engine fetches the diff after the gate has already
    // decided). When the envelope carries additions/deletions we pass a byte estimate
    // (~40 bytes per changed line, the usual patch line with its context); when it does
    // not, we pass nothing and the estimator assumes the cap the engine truncates to —
    // never the flat minimum, which is what breached the per-minute ceiling.
    ...(prDiffBytes(event && event.pullRequest) == null ? {} : { diffBytes: prDiffBytes(event.pullRequest) }),
  };
  await queue.push({ body: { taskType: "gitreview", taskId, params } });
  await m.writeAsyncJob({ taskId, taskType: "gitreview", status: "queued", ruleId: listener.id, ruleName: listener.name, issueKey: ctx.issueKey || null, provider: null, model: null, accountId: null, enqueuedAt });
  return { taskId };
};

/**
 * ONE enqueue decision for a matched listener, used by every delivery path.
 *
 * A git listener has two engines and the rule row names both: the AGENT (mode
 * "agent" → the normal listener task, the envelope IS the event) and the agentless
 * deterministic PR-review engine (`agentlessTaskType:"gitreview"` → the gitreview
 * task). Anything else is a normal listener run. Neither path runs AI here — both
 * only push onto the queue.
 */
export const enqueueForListener = async ({ listener, eventType, event, ctx, source = "event" }) => {
  // The ROW names the engine, and naming it wins over `mode` (F-329): a rule that
  // says "gitreview" runs the deterministic engine — with its claim, its write brake
  // and its per-repo rate ledger — and its agent block is only what an admin gets if
  // they clear the field. A field that lost to `mode` would be metadata again.
  const agentless = isGitEvent(eventType) && listener.agentlessTaskType === "gitreview";
  if (agentless) {
    if (ctx.prNumber == null) {
      console.log(`[listener] ${eventType}: "${listener.name}" (${listener.id}) skipped — the PR review engine needs a pull-request number`);
      return null;
    }
      const r = await enqueueGitReviewRun({ listener, ctx, event });
    return { ...r, taskType: "gitreview" };
  }
  const r = await enqueueListenerRun({ listener, eventType, event, ctx, source });
  return { ...r, taskType: "listener" };
};

// ── The advisory `cognirunner.git` issue property ────────────────────────────

export const GIT_PROPERTY_KEY = "cognirunner.git";
export const GIT_PROPERTY_MAX_REPOS = 5;
export const GIT_PROPERTY_MAX_BYTES = 2048;
/** How many issue keys one delivery may touch (each is one Jira REST write). */
export const GIT_PROPERTY_MAX_ISSUES = 5;

/**
 * THE PROPERTY IS ADVISORY. It is the last git state this app SAW, not a fact it can
 * vouch for: anyone who can write issue properties can forge it, deliveries arrive out
 * of order, and a missing property means "nothing seen", never "not merged". A workflow
 * CONDITION may read it (it is cheap and it only decides what a screen shows); a
 * VALIDATOR must verify live against the provider before it blocks anything. Say this
 * next to every reader — plan §3.9.
 *
 * Pure, so the merge and the bounds are testable without Jira: returns the next value
 * for one issue, given the previous one.
 */
export const mergeGitProperty = (previous, entry, now = nowIso()) => {
  const prev = previous && typeof previous === "object" && previous.repos && typeof previous.repos === "object" ? previous.repos : {};
  const repos = {};
  for (const k of Object.keys(prev)) if (prev[k] && typeof prev[k] === "object") repos[k] = prev[k];
  if (entry && entry.repoId) {
    const before = repos[entry.repoId] || {};
    const pr = { ...(before.pr || {}), ...(entry.pr || {}) };
    // Only the keys a reader is documented to find, in a fixed order, each clamped.
    repos[entry.repoId] = {
      repoId: entry.repoId,
      pr: {
        number: pr.number == null ? null : Number(pr.number) || null,
        state: pr.state ? String(pr.state).slice(0, 24) : null,
        headSha: pr.headSha ? String(pr.headSha).slice(0, 64) : null,
        ...(pr.merged === undefined ? {} : { merged: pr.merged === true }),
        ...(pr.approved === undefined ? {} : { approved: pr.approved === true }),
        ...(pr.build === undefined || pr.build === null ? {} : { build: String(pr.build).slice(0, 24) }),
      },
      updatedAt: now,
    };
  }
  // Bounds, oldest first: the newest N repositories survive. A property that grows
  // without a cap is a 32 KB failure on someone's busiest issue, months later.
  const byAge = Object.keys(repos).sort((a, b) => String(repos[a].updatedAt || "").localeCompare(String(repos[b].updatedAt || "")));
  while (byAge.length > GIT_PROPERTY_MAX_REPOS) delete repos[byAge.shift()];
  let out = { version: 1, repos, updatedAt: now };
  while (byAge.length > 1 && Buffer.byteLength(JSON.stringify(out), "utf8") > GIT_PROPERTY_MAX_BYTES) {
    delete repos[byAge.shift()];
    out = { version: 1, repos, updatedAt: now };
  }
  return out;
};

/**
 * The git state this delivery carries, as the property entry for its repository.
 * Returns null when the envelope says nothing about a pull request or a build.
 */
export const gitPropertyEntry = (envelope, ctx) => {
  const repoId = ctx.repoId || null;
  if (!repoId) return null;
  const p = envelope || {};
  const pr = p.pullRequest || null;
  const check = p.check || null;
  const review = p.review || null;
  if (!pr && !check) return null;
  const entry = { repoId, pr: {} };
  if (pr) {
    entry.pr.number = pr.number == null ? null : pr.number;
    entry.pr.state = pr.state || (ctx.eventType === "git:pull_request:merged" ? "merged" : ctx.eventType === "git:pull_request:closed" ? "closed" : "open");
    entry.pr.headSha = pr.headSha || null;
    if (pr.merged !== undefined || ctx.eventType === "git:pull_request:merged") entry.pr.merged = pr.merged === true || ctx.eventType === "git:pull_request:merged";
  }
  if (review && review.state) entry.pr.approved = String(review.state).toLowerCase() === "approved";
  if (check) {
    entry.pr.build = check.conclusion || check.status || null;
    if (!entry.pr.headSha && check.headSha) entry.pr.headSha = check.headSha;
  }
  return entry;
};

/**
 * Write the advisory property on every issue key the delivery names (≤5).
 *
 * BEST EFFORT, ALWAYS: a failed property write must never fail the delivery or the
 * runs it dispatches — the property is a convenience, the run is the product.
 *
 * This is the app's SECOND property writer and it is deliberate, not an oversight of
 * LAW 1: the first one is `api.setProperty` inside index.js `createApi()`, a closure
 * bound to ONE sandbox run's issue key, simulation flag and change ledger, and it is
 * not exported or callable from here. Converging the two means lifting a plain
 * `putIssueProperty(issueKey, key, value)` out of index.js — index.js is another
 * surgeon's territory this commit, so the note is filed in the ledger (F-312) instead
 * of a drive-by edit to a file two other agents are holding.
 */
export const writeGitIssueProperty = async (envelope, ctx) => {
  const entry = gitPropertyEntry(envelope, ctx);
  if (!entry) return { written: 0 };
  const keys = (Array.isArray(ctx.issueKeys) && ctx.issueKeys.length ? ctx.issueKeys : (ctx.issueKey ? [ctx.issueKey] : []))
    .filter((k) => typeof k === "string" && /^[A-Z][A-Z0-9_]*-\d+$/i.test(k))
    .slice(0, GIT_PROPERTY_MAX_ISSUES);
  let written = 0;
  for (const issueKey of keys) {
    try {
      let previous = null;
      const got = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/properties/${GIT_PROPERTY_KEY}`, { headers: { Accept: "application/json" } });
      if (got.ok) { const body = await got.json(); previous = body && body.value; }
      const next = mergeGitProperty(previous, entry);
      const res = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/properties/${GIT_PROPERTY_KEY}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next),
      });
      if (res.ok) written++;
      else console.warn(`[git-event] ${GIT_PROPERTY_KEY} write on ${issueKey} returned ${res.status}`);
    } catch (e) {
      console.warn(`[git-event] ${GIT_PROPERTY_KEY} write on ${issueKey} failed:`, e && e.message);
    }
  }
  return { written, entry };
};

// ── The git delivery (webhook → queue taskType "git-event" → here) ───────────

/**
 * A VERIFIED git webhook delivery, dispatched on the CONSUMER (120 s), never on the
 * webhook itself: the provider abandons a delivery in ~10 s, and matching costs a
 * storage read, a full record read per candidate and a Jira write per advisory issue.
 *
 * It is a MATCHER, exactly like listenerTrigger — it reads the index, filters, takes
 * the brakes and pushes onto the queue. NO AI runs here (which is why "git-event" is
 * absent from AI_TASK_TYPES and costs the token governor nothing); every model call
 * happens in the listener/gitreview task this enqueues.
 *
 * The matching itself is listenerTrigger's, called with the envelope as the event:
 * repo allow-list, ignoreSelf-by-whoami, the static filters and the 30/120-per-5-min
 * brakes are ONE implementation, not a git-shaped copy of them.
 */
export const dispatchGitEvent = async (envelope) => {
  const eventType = envelope && envelope.eventType;
  if (!eventType || !isGitEvent(eventType)) {
    console.warn(`[git-event] ignored: ${eventType || "(no eventType)"} is not a git event id`);
    return { skipped: "not-a-git-event" };
  }
  const ctx = extractEventContext(eventType, envelope);
  // The property first: it describes the delivery, not the runs, so an instance with
  // no listener at all still gets the advisory state its conditions read.
  const property = await writeGitIssueProperty(envelope, ctx);
  const dispatched = await listenerTrigger(envelope, null);
  return { eventType, repoId: ctx.repoId, propertyWrites: property.written, queued: (dispatched && dispatched.queued) || 0 };
};

// ── The trigger (manifest `trigger` modules → here) ──────────────────────────

/**
 * Forge product-event handler. Must stay CHEAP: one cached index read for events
 * nobody listens to (viewed:issue fires on every issue view), then per candidate a
 * full-record read, the static filters, the optional JQL check, and a queue push.
 */
export async function listenerTrigger(event, context) {
  const started = Date.now();
  const eventType = event && event.eventType;
  if (!eventType || !isKnownEvent(eventType)) return { queued: 0 };
  let rows;
  try { rows = await readListenerIndex({ cached: true }); } catch (e) { console.error("[listener] index read failed:", e && e.message); return { queued: 0 }; }
  const candidates = rows.filter((r) => r.enabled !== false && Array.isArray(r.events) && r.events.includes(eventType));
  if (!candidates.length) return { queued: 0 };

  const ctx = extractEventContext(eventType, event);
  // id-only payloads: resolve the issue key once, only when someone listens.
  if (!ctx.issueKey && ctx.issueId) {
    try { const r = await resolveIssueById(ctx.issueId); if (r) Object.assign(ctx, r); } catch (e) { console.warn("[listener] issue resolve failed:", e && e.message); }
  }
  // Project-scoped events that name the project by id only (versions, components by id,
  // issue links): resolve the key so project filters can apply (cached per container).
  if (!ctx.projectKey && ctx.projectId && candidates.some((r) => r.projectKeys && r.projectKeys.length)) {
    try { ctx.projectKey = await resolveProjectKey(ctx.projectId); } catch (e) { console.warn("[listener] project resolve failed:", e && e.message); }
  }
  // Pre-filter on the slim index rows before paying for full reads.
  const gitDelivery = isGitEvent(eventType);
  const matched = candidates.filter((r) => (gitDelivery
    ? matchesListenerRepos(r.repos, ctx)
    : matchesListenerProject(r.projectKeys, ctx)));
  // The editor's "last real payload" is captured ONLY for an event some enabled
  // listener actually accepts. Capturing before this filter published one project's
  // issue content (summary, custom fields, people) to every editor — including those
  // scoped to a different project — through getEventSample / ?resource=samples.
  // Throttled to once per 15 min per event type per warm container.
  // Samples are Jira-payload-shaped and redactSample() only knows Jira content
  // zones; a git payload (PR titles, review bodies, diffs) would be stored largely
  // unredacted. Git events get no sample until the redactor learns their shape.
  if (matched.length && !gitDelivery) await captureSample(eventType, event);
  const shortlisted = matched.slice(0, MAX_CANDIDATES_PER_EVENT);
  // Say it out loud when the cap bites: saveListener APPENDS to the index, so the rows
  // this slice drops are the NEWEST ones — the listener someone just saved and is testing
  // is the first to disappear, and silence there looks exactly like "my listener is broken".
  if (matched.length > shortlisted.length) console.warn(`[listener] ${eventType}: ${matched.length} listeners matched but only ${MAX_CANDIDATES_PER_EVENT} run per event — ${matched.length - shortlisted.length} skipped (the index is append-ordered, so the newest listeners are the ones dropped)`);
  if (!shortlisted.length) return { queued: 0 };

  const jqlCache = new Map();
  // ONE per-delivery fact, resolved ONCE (F-328). Both depend only on the delivery,
  // not on the candidate: re-asking inside the loop cost up to 25 serial KVS reads
  // (plus a dynamic import each) against the same 25 s budget the loop breaks out of,
  // which drops the tail of the shortlist — the newest listeners.
  const objectKey = brakeObjectKey(ctx);
  const gitSelf = gitDelivery ? await isGitSelfEvent(ctx) : false;
  let queued = 0;
  for (const row of shortlisted) {
    if (Date.now() - started > TRIGGER_BUDGET_MS) { console.warn(`[listener] trigger budget hit after ${queued} enqueue(s); remaining candidates skipped for ${eventType}`); break; }
    let full;
    try { full = await getListener(row.id); } catch { full = null; }
    if (!full) continue;
    if (gitDelivery && full.ignoreSelf !== false && gitSelf) {
      console.log(`[listener] ${eventType}: "${full.name}" (${full.id}) skipped — the actor is the connection's own identity (ignoreSelf)`);
      continue;
    }
    const st = matchListenerStatic(full, ctx, event);
    if (!st.ok) { console.log(`[listener] ${eventType}: "${full.name}" (${full.id}) skipped — ${st.reason}`); continue; }
    const jql = full.filters && full.filters.jql;
    let jqlPending = false;
    if (jql) {
      if (!ctx.issueKey) { console.log(`[listener] ${eventType}: "${full.name}" skipped — JQL filter needs an issue`); continue; }
      try {
        if (!jqlCache.has(jql)) jqlCache.set(jql, await jqlMatchesIssue(ctx.issueKey, jql));
        if (!jqlCache.get(jql)) { console.log(`[listener] ${eventType}: "${full.name}" skipped — JQL did not match ${ctx.issueKey}`); continue; }
      } catch (e) {
        // Search hiccup — let the consumer re-check rather than drop the event.
        console.warn("[listener] JQL check deferred:", e && e.message);
        jqlPending = true;
      }
    }
    // Brakes: per issue (loop guard) and per listener (cost guard).
    const bk = brakeKeys(full.id, objectKey);
    const lb = await readBrake(bk.listener);
    if (lb.count >= BRAKE_MAX_PER_LISTENER) { await bumpBrake(lb); if (lb.count === BRAKE_MAX_PER_LISTENER) await logBrake(full, ctx, `listener fired more than ${BRAKE_MAX_PER_LISTENER} times in 5 minutes`); continue; }
    let ib = null;
    if (bk.issue) {
      ib = await readBrake(bk.issue);
      if (ib.count >= BRAKE_MAX_PER_ISSUE) { await bumpBrake(ib); if (ib.count === BRAKE_MAX_PER_ISSUE) await logBrake(full, ctx, `${objectKey} triggered more than ${BRAKE_MAX_PER_ISSUE} listener runs in 5 minutes`); continue; }
    }
    try {
      const enq = await enqueueForListener({ listener: full, eventType, event, ctx: { ...ctx, jqlPending }, source: "event" });
      if (!enq) continue;
      console.log(`[listener] ${eventType}: "${full.name}" (${full.id}) queued as ${enq.taskId} (${enq.taskType})${ctx.issueKey ? ` for ${ctx.issueKey}` : ""}`);
      queued++;
      await bumpBrake(lb);
      if (ib) await bumpBrake(ib);
    } catch (e) {
      console.error(`[listener] enqueue failed for ${full.id}:`, e && e.message);
    }
  }
  if (queued) console.log(`[listener] ${eventType}: queued ${queued} run(s) in ${Date.now() - started}ms`);
  // The count is for the CALLER's report (dispatchGitEvent logs it for a webhook
  // delivery). Forge ignores a trigger's return value.
  return { queued };
}

const logBrake = async (listener, ctx, why) => {
  try {
    const m = await idx();
    await m.storeLog({
      type: "listener", source: "runtime", issueKey: ctx.issueKey || ctx.entityName || "(no issue)", fieldId: ctx.eventType,
      isValid: false, decision: "SKIP", reason: `Execution brake: ${why}. Further runs in this 5-minute window are suppressed and not logged.`,
      recommendation: "This usually means a loop: the listener's own writes re-fire the event it listens to. Enable 'Ignore self-generated events', narrow the filters (changed fields / JQL), or turn on Simulation Mode while you investigate.",
      executionTimeMs: 0, ruleId: listener.id, ruleName: listener.name, ruleWorkflow: null, eventType: ctx.eventType,
    });
  } catch { /* best-effort */ }
};

// ── Execution (consumer) ─────────────────────────────────────────────────────

const summarizeEventForAi = (eventType, event, ctx) => {
  const m = [`Event: ${eventType} (${eventLabel(eventType)})`, `Entity: ${ctx.entityName || "?"}`, ctx.issueKey ? `Issue: ${ctx.issueKey}` : "", ctx.projectKey ? `Project: ${ctx.projectKey}` : "", ctx.actorAccountId ? `Actor accountId: ${ctx.actorAccountId}` : ""].filter(Boolean);
  const issue = event && event.issue;
  if (issue && issue.fields) {
    const f = issue.fields;
    m.push(`Summary: ${f.summary || ""}`);
    if (f.issuetype) m.push(`Type: ${f.issuetype.name}`);
    if (f.status) m.push(`Status: ${f.status.name}`);
    if (f.priority) m.push(`Priority: ${f.priority.name}`);
    if (f.assignee) m.push(`Assignee: ${f.assignee.displayName}`);
    if (f.reporter) m.push(`Reporter: ${f.reporter.displayName}`);
    if (Array.isArray(f.labels) && f.labels.length) m.push(`Labels: ${f.labels.join(", ")}`);
    if (f.description) m.push(`Description: ${adfToPlainText(f.description).slice(0, 2500)}`);
  }
  if (event && event.changelog && Array.isArray(event.changelog.items)) {
    m.push("Changes:");
    for (const it of event.changelog.items.slice(0, 20)) m.push(`  - ${it.field}: "${it.fromString ?? it.from ?? ""}" → "${it.toString ?? it.to ?? ""}"`);
  }
  if (event && event.comment) {
    const c = event.comment;
    m.push(`Comment by ${c.author ? c.author.displayName || c.author.accountId : "?"}: ${commentTextOf(event).slice(0, 3000)}`);
  }
  for (const k of ["worklog", "attachment", "version", "project", "component", "sprint", "board", "user", "field", "issueType", "filter", "property", "configuration"]) {
    if (event && event[k]) m.push(`${k}: ${JSON.stringify(event[k]).slice(0, 1500)}`);
  }
  if (event && (event.sourceIssueId || event.issueLinkType)) m.push(`issueLink: ${JSON.stringify({ sourceIssueId: event.sourceIssueId, destinationIssueId: event.destinationIssueId, issueLinkType: event.issueLinkType }).slice(0, 600)}`);
  if (Array.isArray(event && event.mentionedAccountIds)) m.push(`Mentioned: ${event.mentionedAccountIds.join(", ")}`);
  return m.join("\n");
};

/**
 * Run ONE listener against ONE event. Shared by the queue consumer (live) and the
 * editor's "Test with an issue" (simulated). Returns the outcome + a ready log entry.
 */
export const runListener = async ({ listener, eventType, event, ctx, deadline = Date.now() + LISTENER_RUN_BUDGET_MS, cancelToken = null, forceSimulation = false, source = "async",
  // RUN-TIME GATE (F-302). `gateFacts` are the instance's facts — { edition, provider,
  // agentModel, allowanceLevel, products } — which only the caller can read (they live
  // behind index.js). OMITTED means the most restrictive context: the 13 Jira actions
  // behave exactly as before and nothing from another namespace is held, so forgetting
  // to pass them can never be the way PAST the gate. `executors` carries the namespace
  // modules (the caller owns the credentials); a namespace with none refuses.
  gateFacts = null, executors = {} }) => {
  const m = await idx();
  const started = Date.now();
  const config = { ...listener, simulationMode: forceSimulation || listener.simulationMode === true };
  const extraContext = { runtime: "listener", eventType, event, issueKey: ctx.issueKey || null, projectKey: ctx.projectKey || null, actorAccountId: ctx.actorAccountId || null, listenerId: listener.id, listenerName: listener.name };
  const base = {
    type: "listener", source, issueKey: ctx.issueKey || ctx.entityName || "(no issue)", fieldId: eventType,
    ruleId: listener.id, ruleName: listener.name, ruleWorkflow: null, eventType, mode: listener.mode,
  };
  const done = (patch) => ({ ...base, executionTimeMs: Date.now() - started, ...patch });

  // Deferred JQL (the trigger's search hiccupped).
  if (ctx.jqlPending && listener.filters && listener.filters.jql && ctx.issueKey) {
    try {
      if (!(await jqlMatchesIssue(ctx.issueKey, listener.filters.jql))) return { skipped: true, log: done({ isValid: true, decision: "SKIP", reason: "Filtered out: issue does not match the listener's JQL." }) };
    } catch (e) {
      return { skipped: true, log: done({ isValid: false, decision: "SKIP", reason: `JQL filter could not be evaluated: ${e.message}`, recommendation: "Check the JQL in the listener's filters." }) };
    }
  }
  // AI condition gate.
  let gate = null;
  if (listener.aiCondition) {
    const { evaluateAiCondition } = await agentMod();
    gate = await evaluateAiCondition({ condition: listener.aiCondition, contextText: summarizeEventForAi(eventType, event, ctx), deadline: Math.min(deadline, Date.now() + 25000) });
    if (!gate.match) {
      return { skipped: true, gate, log: done({ isValid: gate.error ? false : true, decision: "SKIP", reason: `AI condition not met: ${gate.reason}`, tokens: gate.tokens, aiTimeMs: gate.aiTimeMs, recommendation: gate.error ? "The AI condition could not be evaluated, so the listener did not run (fail-closed). Check the AI provider settings." : undefined }) };
    }
  }
  if (listener.mode === "agent") {
    const { runAgentTask } = await agentMod();
    // A LISTENER IS AN EXTERNAL TRIGGER, always: an event we did not originate started
    // this run and no human is watching it, so a `dangerous` action (approve code,
    // block a merge, deploy) is dropped whatever was saved. `savedByRole` comes from
    // the rule ROW, never from the delivery.
    const agentGate = gateFacts
      ? buildAgentGateContext({ ...gateFacts, triggerSource: "external", savedByRole: listener.savedByRole })
      : undefined;
    const r = await runAgentTask({
      instructions: listener.agent.instructions, allowedActions: listener.agent.allowedActions, maxRounds: listener.agent.maxRounds,
      issueKey: ctx.issueKey || null, config, contextTitle: "EVENT", contextText: summarizeEventForAi(eventType, event, ctx),
      deadline, cancelToken, extraContext, gate: agentGate, executors,
    });
    return {
      skipped: false, result: r, gate, ...agentResultFields(r),
      log: done({
        ...agentResultFields(r),
        isValid: r.success, reason: r.success ? `Agent ${r.outcome}: ${r.summary || "(no summary)"}` : `Agent failed: ${r.error || r.summary || "unknown"}`,
        recommendation: r.success ? undefined : "Open the listener, review the instructions and allowed actions, then use 'Test with an issue' to reproduce.",
        tokens: r.tokens, aiTimeMs: r.aiTimeMs, changes: (r.changes || []).slice(0, 20), logs: (r.logs || []).slice(-60).map((s) => String(s).slice(0, 300)),
        toolCalls: r.toolCalls, rounds: r.rounds, gateReason: gate ? gate.reason : undefined,
      }),
    };
  }
  const r = await m.runSandboxSteps({ issueKey: ctx.issueKey || null, config, deadline, cancelToken, extraContext });
  return {
    skipped: false, result: r, gate,
    log: done({
      isValid: r.success, reason: r.success ? `Ran ${r.stepsTotal} step(s), ${r.changes.length} change(s)` : `Step "${r.failedStep}" failed: ${(r.stepResults.find((s) => s.status === "error") || {}).error || "see logs"}`,
      recommendation: r.recommendation, changes: (r.changes || []).slice(0, 20), logs: (r.logs || []).slice(-60).map((s) => String(s).slice(0, 300)),
      stepResults: r.stepResults, gateReason: gate ? gate.reason : undefined,
    }),
  };
};

/**
 * Claim ONE listener delivery. The claim IDENTITY lives here and nowhere else, and it
 * belongs to the RUN PATH ONLY. The queue consumer's fail-closed refusal path
 * (async-handler.js) deliberately does NOT take this claim: it dedups on its own
 * `refuse_exec:<taskId>` key instead, because a refusal that spent the run's identity
 * made the next, healthy redelivery look like a duplicate and lost the run (F-139 —
 * F-136 originally wired the refusal here). Returns false only on a real conflict —
 * a KVS infrastructure fault still permits the run (see claimRuleExecution).
 */
export const claimListenerRun = (params, taskId) => claimRuleExecution(
  storage,
  EXEC_CLAIM_PREFIX + safeKeyPart(taskId || `${params?.listenerId}:${params?.enqueuedAt || ""}`),
  EXEC_CLAIM_TTL,
  "listener",
);

/** Queue consumer entry: taskType "listener". */
export const executeListenerTask = async (params, taskId, { gateFacts = null, executors = {} } = {}) => {
  const m = await idx();
  const { listenerId, eventType, event, ctx } = params || {};
  const listener = await getListener(listenerId);
  if (!listener) { console.log(`[listener] ${listenerId} vanished before execution`); return { skipped: true, reason: "listener deleted" }; }
  if (listener.enabled === false) {
    await m.storeLog({ type: "listener", source: "async", issueKey: (ctx && ctx.issueKey) || "(no issue)", fieldId: eventType, isValid: true, decision: "SKIP", reason: "Skipped: listener was disabled before the queued run started.", executionTimeMs: 0, ruleId: listener.id, ruleName: listener.name, ruleWorkflow: null, eventType });
    return { skipped: true, reason: "disabled" };
  }
  // At-least-once delivery: atomically claim before the AI gate or sandbox. A
  // crash after claiming is not replayed with already-completed writes intact.
  if (!(await claimListenerRun(params, taskId))) {
    console.log(`[listener] duplicate delivery of ${taskId} suppressed`);
    return { skipped: true, reason: "duplicate delivery" };
  }
  const enqueuedMs = params.enqueuedAt ? Date.parse(params.enqueuedAt) : NaN;
  const started = Date.now();
  let out;
  try {
    out = await runListener({ listener, eventType, event, ctx: ctx || extractEventContext(eventType, event), deadline: Date.now() + LISTENER_RUN_BUDGET_MS, cancelToken: taskId, source: "async", gateFacts, executors });
  } catch (e) {
    // A crash inside the run must still leave a trace — never a silent miss.
    console.error(`[listener] ${listener.id} run crashed:`, e);
    out = { skipped: false, log: { type: "listener", source: "async", issueKey: (ctx && ctx.issueKey) || (ctx && ctx.entityName) || "(no issue)", fieldId: eventType, isValid: false, reason: `Run crashed: ${String((e && e.message) || e).slice(0, 400)}`, recommendation: "Open the listener and use 'Test with an issue' to reproduce; check the AI provider settings if the run uses the AI condition or agent mode.", executionTimeMs: Date.now() - started, ruleId: listener.id, ruleName: listener.name, ruleWorkflow: null, eventType, mode: listener.mode } };
  }
  const entry = out.log;
  if (Number.isFinite(enqueuedMs)) entry.queueDelayMs = Math.max(0, Date.now() - enqueuedMs);
  await m.storeLog(entry, { statsReceipt: out.skipped ? null : statsReceipt("listener", listener, entry, ctx && ctx.issueKey) });
  return { skipped: out.skipped, success: entry.isValid, reason: entry.reason, changes: entry.changes, logs: entry.logs, agentOutcome: entry.agentOutcome, agentSummary: entry.agentSummary };
};

/**
 * Editor / REST "Test with an issue": build a synthetic event from a REAL issue,
 * run the listener in SIMULATION (reads live, writes recorded) with a sync budget,
 * store a TEST-sourced log entry. Returns the log entry + gate verdict.
 * This checks matching and execution, not delivery, brakes or the self-event guard.
 * Without a provided payload, issue updates synthesize a summary change and comments
 * use the issue's latest comment; neither proves a particular historical event matched.
 */
export const testListener = async ({ listener, issueKey, eventType, syntheticEvent = null, deadline = Date.now() + 20000,
  // F-302 — the SAME seam the two live run sites use. Without it a test run gated
  // arity-1 and dropped every git action, so "Test with an issue" reported a rule that
  // cannot do what the live delivery will do: the one thing a test must never do.
  gateFacts = null, executors = {} }) => {
  const m = await idx();
  const ev = eventType && listener.events.includes(eventType) ? eventType : listener.events[0];
  const meta = getEvent(ev) || {};
  const hasIssueContext = meta.issueBound || meta.issueIdOnly;
  let event = syntheticEvent && typeof syntheticEvent === "object" ? { ...syntheticEvent, eventType: ev } : null;
  let eventUsed = event ? "provided" : "synthetic";
  const testNotes = ["Simulation reads Jira and records writes. Event delivery, execution brakes and the self-generated event guard are not tested."];
  if (listener.enabled === false) testNotes.push("This disabled draft is tested as enabled.");
  if (!event) {
    const sample = await getEventSample(ev);
    // A sample is a redacted shape captured for the entire event type, potentially
    // from a different issue. Never graft its comment/changelog/linked issue onto
    // the selected issue. An explicit REST payload can supply those test inputs.
    if (sample && sample.payload && !(issueKey && hasIssueContext)) {
      event = { ...sample.payload, eventType: ev, _sample: true };
      eventUsed = "sample";
      testNotes.push("The last captured sample has redacted text; text filters and AI conditions may differ on a real event.");
    } else event = { eventType: ev };
  }
  if (!hasIssueContext) delete event.issue; // an issue picker must not invent an issue for a sprint/project/etc.
  if (issueKey && hasIssueContext) {
    const res = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}`);
    if (!res.ok) throw new Error(`Issue ${issueKey} could not be read (${res.status})`);
    const issue = await res.json();
    event.issue = { id: issue.id, key: issue.key, fields: issue.fields };
    // Keep the selected issue authoritative in id-only payloads as well as event.issue.
    for (const field of ["comment", "worklog", "attachment"]) {
      if (event[field] && event[field].issueId != null) event[field] = { ...event[field], issueId: issue.id };
    }
    if (meta.entity === "issueLink") {
      if (event.issueLink) event.issueLink = { ...event.issueLink, sourceIssueId: issue.id, sourceProjectId: issue.fields?.project?.id };
      else { event.sourceIssueId = issue.id; event.sourceProjectId = issue.fields?.project?.id; }
    }
    if (event.issueId != null) event.issueId = issue.id;
    if (event.issueKey != null) event.issueKey = issue.key;
    if (meta.entity === "comment" && !event.comment) {
      const comments = (issue.fields && issue.fields.comment && issue.fields.comment.comments) || [];
      const last = comments[comments.length - 1];
      if (last) event.comment = last;
      testNotes.push(last ? "Uses the selected issue's latest returned comment, not a replay of a comment event." : "No comment was available on the selected issue.");
    }
    if (ev === "avi:jira:updated:issue" && !event.changelog) {
      event.changelog = { items: [{ field: "summary", fieldId: "summary", fromString: "(test)", toString: issue.fields && issue.fields.summary }] };
      testNotes.push("Uses a synthetic summary-only change, not the issue's change history.");
    }
  }
  event.selfGenerated = false;
  event.atlassianId = event.atlassianId || null;
  const ctx = extractEventContext(ev, event);
  if (hasIssueContext && !ctx.issueKey && ctx.issueId) {
    const resolved = await resolveIssueById(ctx.issueId);
    if (resolved) Object.assign(ctx, resolved);
  }
  if (!ctx.projectKey && ctx.projectId && listener.filters?.projectKeys?.length) ctx.projectKey = await resolveProjectKey(ctx.projectId);
  // Drafts may be disabled while being tested; all other static matcher rules are
  // exactly the trigger's rules. No brakes/claims/stats are consumed by this dry run.
  const match = matchListenerStatic({ ...listener, enabled: true }, ctx, event);
  const jql = listener.filters && listener.filters.jql;
  const skipReason = !match.ok ? `Filtered out: ${match.reason}.` : (jql && !ctx.issueKey ? "Filtered out: JQL filter needs an issue." : null);
  const out = skipReason ? { skipped: true, log: {
    type: "listener", source: "test", issueKey: ctx.issueKey || ctx.entityName || "(no issue)", fieldId: ev,
    ruleId: listener.id, ruleName: listener.name, ruleWorkflow: null, eventType: ev, mode: listener.mode,
    isValid: true, decision: "SKIP", reason: skipReason, executionTimeMs: 0,
  } } : await runListener({ listener, eventType: ev, event, ctx: { ...ctx, jqlPending: Boolean(jql) }, deadline, forceSimulation: true, source: "test", gateFacts, executors });
  const entry = { ...out.log, testRun: true };
  await m.storeLog(entry);
  return { ...entry, skipped: out.skipped, gate: out.gate || null, eventUsed, testNote: testNotes.join(" ") };
};
