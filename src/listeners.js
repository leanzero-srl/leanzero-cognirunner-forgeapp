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
import storage from "@forge/kvs";
import api, { route } from "@forge/api";
import {
  isKnownEvent, getEvent, eventLabel, extractEventContext, changedFieldsOf, commentTextOf,
  trimEventPayload, adfToPlainText,
} from "./shared/jira-events.js";
import { normalizeAllowedActions, DEFAULT_AGENT_ACTIONS, DEFAULT_AGENT_ROUNDS, MAX_AGENT_ROUNDS } from "./shared/agent-actions.js";
import { redosRisk } from "./shared/regex-safety.js";
import { agentResultFields } from "./shared/agent-result.js";
import { claimRuleExecution } from "./shared/execution-claim.js";

const idx = () => import("./index.js");
const agentMod = () => import("./agent-runner.js");

export const LISTENER_INDEX_KEY = "listener_index";
export const LISTENER_PREFIX = "listener:";
// Run statistics live in their OWN key (a map id → stats) so the consumers never
// read-modify-write the index or the config record: a stats update racing a save
// could otherwise revert the save (lost update). Stats-vs-stats races only lose a
// count — acceptable for an advisory meter.
export const LISTENER_STATS_KEY = "listener_stats";
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
 * Validate + clamp a listener config. Throws Error(message) on hard errors.
 * `existing` (previous full record) preserves identity/stats on update.
 */
export const normalizeListener = (input = {}, { existing = null, accountId = null } = {}) => {
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
  };
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
    allowedActions: normalizeAllowedActions(a.allowedActions == null ? DEFAULT_AGENT_ACTIONS : a.allowedActions),
    maxRounds: clampInt(a.maxRounds, 1, MAX_AGENT_ROUNDS, DEFAULT_AGENT_ROUNDS),
  };
  if (mode === "agent" && !agent.instructions.trim()) throw new Error("agent.instructions is required in agent mode");
  if (mode === "agent" && String(a.instructions || "").length > 6000) throw new Error("agent.instructions exceeds 6000 characters");
  if (mode === "script" && functions.length === 0) throw new Error("functions must contain at least one code step in script mode");
  if (String(src.aiCondition || "").length > 1500) throw new Error("aiCondition exceeds 1500 characters");
  const out = {
    id, name,
    description: clampStr(src.description, 2000),
    enabled: src.enabled !== false,
    events, filters,
    ignoreSelf: src.ignoreSelf !== false,
    aiCondition: clampStr(src.aiCondition, 1500).trim(),
    mode, functions, agent,
    simulationMode: src.simulationMode === true,
    suppressNotifications: src.suppressNotifications === true,
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
  hasAiCondition: Boolean(full.aiCondition), simulationMode: full.simulationMode === true,
  createdBy: full.createdBy || null, updatedAt: full.updatedAt,
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
const withStats = (row, statsMap) => ({ ...row, stats: (statsMap && statsMap[row.id]) || emptyStats() });

export const listListeners = async () => {
  const [rows, statsMap] = await Promise.all([readListenerIndex(), readStatsMap()]);
  return rows.map((r) => withStats(r, statsMap)).sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
};
export const getListener = async (id) => {
  if (!id) return null;
  const full = (await storage.get(LISTENER_PREFIX + safeKeyPart(id))) || null;
  if (!full) return null;
  try { full.stats = (await readStatsMap())[id] || emptyStats(); } catch { full.stats = emptyStats(); }
  return full;
};

export const saveListener = async (input, { accountId = null } = {}) => {
  const existing = input && input.id ? await getListener(input.id) : null;
  const full = normalizeListener(input, { existing, accountId });
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
  const rows = await readListenerIndex();
  const next = rows.filter((r) => r.id !== id);
  if (next.length !== rows.length) await writeListenerIndex(next);
  await storage.delete(LISTENER_PREFIX + safeKeyPart(id));
  try { const m = await readStatsMap(); if (m[id]) { delete m[id]; await storage.set(LISTENER_STATS_KEY, m); } } catch { /* best-effort */ }
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

// Best-effort stats update (advisory — never load-bearing; touches ONLY the stats map).
export const updateListenerStats = async (id, { status, error = null, issueKey = null }) => {
  try {
    const m = await readStatsMap();
    const st = m[id] || emptyStats();
    st.runCount = (st.runCount || 0) + 1;
    if (status === "error") st.errorCount = (st.errorCount || 0) + 1;
    st.lastRunAt = nowIso(); st.lastStatus = status; st.lastError = error ? clampStr(error, 300) : null; st.lastIssueKey = issueKey || null;
    m[id] = st;
    await storage.set(LISTENER_STATS_KEY, m);
  } catch (e) { console.warn("[listener] stats update skipped:", e && e.message); }
};

// ── Matching (pure — exported for offline tests) ─────────────────────────────

// The slim index and the full record share this predicate. Project ids are
// resolved to keys before matching; projectIds is not a supported config filter.
export const matchesListenerProject = (projectKeys, ctx) => {
  if (!projectKeys || !projectKeys.length || (getEvent(ctx.eventType) || {}).projectScoped === false) return true;
  return Boolean(ctx.projectKey && projectKeys.some((key) => String(key).toUpperCase() === String(ctx.projectKey).toUpperCase()));
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
const brakeKeys = (listenerId, issueKey) => {
  const bucket = Math.floor(Date.now() / BRAKE_BUCKET_MS);
  return { issue: issueKey ? `${BRAKE_PREFIX}${safeKeyPart(issueKey)}:${bucket}` : null, listener: `${BRAKE_PREFIX}L:${safeKeyPart(listenerId)}:${bucket}` };
};

// ── Event samples (the "last seen payload" reference in the editor) ──────────

const _sampleAt = new Map();
// Samples show the SHAPE of a payload, not its content: rich-text bodies are replaced by
// a placeholder so a sample never leaks a description or comment across project permissions.
export const redactSample = (payload) => {
  const red = (v) => (v == null ? v : (typeof v === "string" ? `<redacted text, ${v.length} chars>` : { type: "doc", version: 1, _redacted: true, content: [] }));
  const p = JSON.parse(JSON.stringify(payload || {}));
  if (p.issue && p.issue.fields) { const f = p.issue.fields; if (f.description != null) f.description = red(f.description); if (f.environment != null) f.environment = red(f.environment); if (f.comment) delete f.comment; for (const k of Object.keys(f)) if (k.startsWith("customfield_") && f[k] && typeof f[k] === "object" && f[k].type === "doc") f[k] = red(f[k]); }
  if (p.comment && p.comment.body != null) p.comment.body = red(p.comment.body);
  if (p.worklog && p.worklog.comment != null) p.worklog.comment = red(p.worklog.comment);
  if (p.changelog && Array.isArray(p.changelog.items)) for (const it of p.changelog.items) { if (it && /description|comment|environment/i.test(String(it.field || ""))) { if (it.fromString != null) it.fromString = red(it.fromString); if (it.toString != null) it.toString = red(it.toString); } }
  return p;
};
const captureSample = async (eventType, event) => {
  const last = _sampleAt.get(eventType) || 0;
  if (Date.now() - last < SAMPLE_MIN_INTERVAL_MS) return;
  _sampleAt.set(eventType, Date.now());
  try {
    await storage.set(EVENT_SAMPLE_PREFIX + safeKeyPart(eventType), { eventType, capturedAt: nowIso(), redacted: true, payload: trimEventPayload(redactSample(event), 20000) }, SAMPLE_TTL);
  } catch { /* best-effort */ }
};
export const getEventSample = async (eventType) => (isKnownEvent(eventType) ? (await storage.get(EVENT_SAMPLE_PREFIX + safeKeyPart(eventType))) || null : null);

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

// ── The trigger (manifest `trigger` modules → here) ──────────────────────────

/**
 * Forge product-event handler. Must stay CHEAP: one cached index read for events
 * nobody listens to (viewed:issue fires on every issue view), then per candidate a
 * full-record read, the static filters, the optional JQL check, and a queue push.
 */
export async function listenerTrigger(event, context) {
  const started = Date.now();
  const eventType = event && event.eventType;
  if (!eventType || !isKnownEvent(eventType)) return;
  let rows;
  try { rows = await readListenerIndex({ cached: true }); } catch (e) { console.error("[listener] index read failed:", e && e.message); return; }
  const candidates = rows.filter((r) => r.enabled !== false && Array.isArray(r.events) && r.events.includes(eventType));
  if (!candidates.length) return;
  await captureSample(eventType, event); // only when someone listens; throttled 15 min per event type per container

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
  const matched = candidates.filter((r) => matchesListenerProject(r.projectKeys, ctx));
  const shortlisted = matched.slice(0, MAX_CANDIDATES_PER_EVENT);
  // Say it out loud when the cap bites: saveListener APPENDS to the index, so the rows
  // this slice drops are the NEWEST ones — the listener someone just saved and is testing
  // is the first to disappear, and silence there looks exactly like "my listener is broken".
  if (matched.length > shortlisted.length) console.warn(`[listener] ${eventType}: ${matched.length} listeners matched but only ${MAX_CANDIDATES_PER_EVENT} run per event — ${matched.length - shortlisted.length} skipped (the index is append-ordered, so the newest listeners are the ones dropped)`);
  if (!shortlisted.length) return;

  const jqlCache = new Map();
  let queued = 0;
  for (const row of shortlisted) {
    if (Date.now() - started > TRIGGER_BUDGET_MS) { console.warn(`[listener] trigger budget hit after ${queued} enqueue(s); remaining candidates skipped for ${eventType}`); break; }
    let full;
    try { full = await getListener(row.id); } catch { full = null; }
    if (!full) continue;
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
    const bk = brakeKeys(full.id, ctx.issueKey);
    const lb = await readBrake(bk.listener);
    if (lb.count >= BRAKE_MAX_PER_LISTENER) { await bumpBrake(lb); if (lb.count === BRAKE_MAX_PER_LISTENER) await logBrake(full, ctx, `listener fired more than ${BRAKE_MAX_PER_LISTENER} times in 5 minutes`); continue; }
    let ib = null;
    if (bk.issue) {
      ib = await readBrake(bk.issue);
      if (ib.count >= BRAKE_MAX_PER_ISSUE) { await bumpBrake(ib); if (ib.count === BRAKE_MAX_PER_ISSUE) await logBrake(full, ctx, `issue ${ctx.issueKey} triggered more than ${BRAKE_MAX_PER_ISSUE} listener runs in 5 minutes`); continue; }
    }
    try {
      const { taskId } = await enqueueListenerRun({ listener: full, eventType, event, ctx: { ...ctx, jqlPending }, source: "event" });
      console.log(`[listener] ${eventType}: "${full.name}" (${full.id}) queued as ${taskId}${ctx.issueKey ? ` for ${ctx.issueKey}` : ""}`);
      queued++;
      await bumpBrake(lb);
      if (ib) await bumpBrake(ib);
    } catch (e) {
      console.error(`[listener] enqueue failed for ${full.id}:`, e && e.message);
    }
  }
  if (queued) console.log(`[listener] ${eventType}: queued ${queued} run(s) in ${Date.now() - started}ms`);
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
export const runListener = async ({ listener, eventType, event, ctx, deadline = Date.now() + LISTENER_RUN_BUDGET_MS, cancelToken = null, forceSimulation = false, source = "async" }) => {
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
    const r = await runAgentTask({
      instructions: listener.agent.instructions, allowedActions: listener.agent.allowedActions, maxRounds: listener.agent.maxRounds,
      issueKey: ctx.issueKey || null, config, contextTitle: "EVENT", contextText: summarizeEventForAi(eventType, event, ctx),
      deadline, cancelToken, extraContext,
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

/** Queue consumer entry: taskType "listener". */
export const executeListenerTask = async (params, taskId) => {
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
  const claimKey = EXEC_CLAIM_PREFIX + safeKeyPart(taskId || `${listenerId}:${params.enqueuedAt || ""}`);
  if (!(await claimRuleExecution(storage, claimKey, EXEC_CLAIM_TTL, "listener"))) {
    console.log(`[listener] duplicate delivery of ${taskId} suppressed`);
    return { skipped: true, reason: "duplicate delivery" };
  }
  const enqueuedMs = params.enqueuedAt ? Date.parse(params.enqueuedAt) : NaN;
  const started = Date.now();
  let out;
  try {
    out = await runListener({ listener, eventType, event, ctx: ctx || extractEventContext(eventType, event), deadline: Date.now() + LISTENER_RUN_BUDGET_MS, cancelToken: taskId, source: "async" });
  } catch (e) {
    // A crash inside the run must still leave a trace — never a silent miss.
    console.error(`[listener] ${listener.id} run crashed:`, e);
    out = { skipped: false, log: { type: "listener", source: "async", issueKey: (ctx && ctx.issueKey) || (ctx && ctx.entityName) || "(no issue)", fieldId: eventType, isValid: false, reason: `Run crashed: ${String((e && e.message) || e).slice(0, 400)}`, recommendation: "Open the listener and use 'Test with an issue' to reproduce; check the AI provider settings if the run uses the AI condition or agent mode.", executionTimeMs: Date.now() - started, ruleId: listener.id, ruleName: listener.name, ruleWorkflow: null, eventType, mode: listener.mode } };
  }
  const entry = out.log;
  if (Number.isFinite(enqueuedMs)) entry.queueDelayMs = Math.max(0, Date.now() - enqueuedMs);
  await m.storeLog(entry);
  if (!out.skipped) await updateListenerStats(listener.id, { status: entry.isValid ? "ok" : "error", error: entry.isValid ? null : entry.reason, issueKey: ctx && ctx.issueKey });
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
export const testListener = async ({ listener, issueKey, eventType, syntheticEvent = null, deadline = Date.now() + 20000 }) => {
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
  } } : await runListener({ listener, eventType: ev, event, ctx: { ...ctx, jqlPending: Boolean(jql) }, deadline, forceSimulation: true, source: "test" });
  const entry = { ...out.log, testRun: true };
  await m.storeLog(entry);
  return { ...entry, skipped: out.skipped, gate: out.gate || null, eventUsed, testNote: testNotes.join(" ") };
};
