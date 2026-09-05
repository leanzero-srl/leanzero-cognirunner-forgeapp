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
 * SCHEDULED JOBS — cron-scheduled rules (the ScriptRunner "Scheduled Job" /
 * "Escalation Service" surface, rebuilt around AI).
 *
 * Flow:
 *   manifest `scheduledTrigger` (interval fiveMinute) → scheduledTick()
 *     → for each enabled job: what came due since the job's last check (cron in the
 *       job's time zone) → claim the due minute (idempotent against duplicate ticks)
 *       → async-ai-queue taskType "scheduledjob"
 *     → executeScheduledJobTask(params)   120s consumer budget
 *   run = once (no current issue) or per issue of a JQL scope ("escalation"), in
 *   "script" (sandbox code) or "agent" (AI acts through allow-listed tools) mode.
 *
 * Effective granularity = the tick interval (5 min): a job runs at most once per
 * tick even if several cron minutes matched (the latest wins; the rest are counted
 * as `missed` on the log entry).
 *
 * Storage: `job_index` (slim rows + scheduler bookkeeping) and `job:{id}` (full).
 */
import storage from "@forge/kvs";
import api, { route } from "@forge/api";
import { validateCron, normalizeTimeZone, dueInWindow, nextRuns, describeCron } from "./shared/cron.js";
import { normalizeAllowedActions, DEFAULT_AGENT_ACTIONS, DEFAULT_AGENT_ROUNDS, MAX_AGENT_ROUNDS } from "./shared/agent-actions.js";
import { normalizeStep } from "./listeners.js";

const idx = () => import("./index.js");
const agentMod = () => import("./agent-runner.js");

export const JOB_INDEX_KEY = "job_index";
export const JOB_PREFIX = "job:";
// Run stats and the scheduler's own bookkeeping (lastCheckedAt per job) live in
// their own keys: the consumer never rewrites the index or a config record, and the
// tick (single writer of `job_sched`) never rewrites the index either — so a save
// racing either of them can no longer be lost.
export const JOB_STATS_KEY = "job_stats";
export const JOB_SCHED_KEY = "job_sched";
export const EXEC_CLAIM_PREFIX = "job_exec:";
const EXEC_CLAIM_TTL = { ttl: { value: 2, unit: "HOURS" } };
const INDEX_MAX_BYTES = 200 * 1024;
const NEXT_RUN_HORIZON_MIN = 60 * 24 * 60; // 60 days for list previews
export const MAX_JOBS = 200;
const JOB_MAX_BYTES = 200 * 1024;
const JOB_RUN_BUDGET_MS = 105000;
const TICK_BUDGET_MS = 100000;
const MAX_REPLAY_MS = 60 * 60 * 1000;   // never replay more than an hour of missed minutes
const CLAIM_TTL = { ttl: { value: 2, unit: "HOURS" } };
export const MAX_SCOPE_ISSUES = 100;
export const DEFAULT_SCOPE_ISSUES = 50;

const nowIso = () => new Date().toISOString();
const clampStr = (v, n) => (v == null ? "" : String(v)).slice(0, n);
const clampInt = (v, lo, hi, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
export const newJobId = () => `job_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const safeKeyPart = (s) => String(s).replace(/[^a-zA-Z0-9:._#-]/g, "-").slice(0, 120);

// ── Validation / normalisation ───────────────────────────────────────────────

export const normalizeJob = (input = {}, { existing = null, accountId = null } = {}) => {
  const src = input && typeof input === "object" ? input : {};
  const id = existing ? existing.id : (typeof src.id === "string" && /^[A-Za-z0-9_.-]{3,80}$/.test(src.id) ? src.id : newJobId());
  const name = clampStr(src.name, 120).trim();
  if (!name) throw new Error("name is required");
  const sch = src.schedule && typeof src.schedule === "object" ? src.schedule : {};
  const cron = clampStr(sch.cron, 120).trim().replace(/\s+/g, " ");
  const v = validateCron(cron);
  if (!v.ok) throw new Error(`schedule.cron is invalid: ${v.error}`);
  const schedule = { cron, timeZone: normalizeTimeZone(sch.timeZone) };
  let scope = null;
  if (src.scope && typeof src.scope === "object" && clampStr(src.scope.jql, 2000).trim()) {
    scope = { jql: clampStr(src.scope.jql, 2000).trim(), maxIssues: clampInt(src.scope.maxIssues, 1, MAX_SCOPE_ISSUES, DEFAULT_SCOPE_ISSUES) };
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
  const out = {
    id, name,
    description: clampStr(src.description, 2000),
    enabled: src.enabled !== false,
    schedule, scope, mode, functions, agent,
    simulationMode: src.simulationMode === true,
    suppressNotifications: src.suppressNotifications === true,
    createdBy: existing ? existing.createdBy || accountId || null : accountId || null,
    createdAt: existing ? existing.createdAt || nowIso() : nowIso(),
    updatedAt: nowIso(),
  };
  const bytes = Buffer.byteLength(JSON.stringify(out), "utf8");
  if (bytes > JOB_MAX_BYTES) throw new Error(`job is too large (${bytes} bytes > ${JOB_MAX_BYTES})`);
  return out;
};

export const toIndexRow = (full) => ({
  id: full.id, name: full.name, enabled: full.enabled !== false, schedule: full.schedule,
  scoped: Boolean(full.scope), mode: full.mode, simulationMode: full.simulationMode === true,
  createdBy: full.createdBy || null, updatedAt: full.updatedAt,
});
export const emptyStats = () => ({ runCount: 0, errorCount: 0, lastRunAt: null, lastStatus: null, lastError: null });
export const nextRunOf = (row) => {
  if (!row || row.enabled === false || !row.schedule) return null;
  try { return nextRuns(row.schedule.cron, { timeZone: row.schedule.timeZone, count: 1, maxMinutes: NEXT_RUN_HORIZON_MIN })[0] || null; } catch { return null; }
};

// ── Storage ──────────────────────────────────────────────────────────────────

export const readJobIndex = async () => { const v = (await storage.get(JOB_INDEX_KEY)) || []; return Array.isArray(v) ? v : []; };
const writeJobIndex = async (rows) => storage.set(JOB_INDEX_KEY, rows);
export const readStatsMap = async () => { const v = (await storage.get(JOB_STATS_KEY)) || {}; return v && typeof v === "object" ? v : {}; };
export const readSchedMap = async () => { const v = (await storage.get(JOB_SCHED_KEY)) || {}; return v && typeof v === "object" ? v : {}; };
const writeSchedMap = async (m) => storage.set(JOB_SCHED_KEY, m);
const decorate = (row, statsMap) => ({ ...row, stats: { ...((statsMap && statsMap[row.id]) || emptyStats()), nextRunAt: nextRunOf(row) } });

export const listJobs = async () => {
  const [rows, statsMap] = await Promise.all([readJobIndex(), readStatsMap()]);
  return rows.map((r) => decorate(r, statsMap)).sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
};
export const getJob = async (id) => {
  if (!id) return null;
  const full = (await storage.get(JOB_PREFIX + safeKeyPart(id))) || null;
  if (!full) return null;
  let statsMap = {};
  try { statsMap = await readStatsMap(); } catch { /* best-effort */ }
  return decorate(full, statsMap);
};

// Mark "checked up to now" for a job (new / re-enabled) so it never replays minutes
// from before it existed or while it was disabled. Single small RMW on the sched map.
const touchSched = async (id) => {
  try { const m = await readSchedMap(); m[id] = { ...(m[id] || {}), lastCheckedAt: nowIso() }; await writeSchedMap(m); } catch (e) { console.warn("[job] sched touch skipped:", e && e.message); }
};

export const saveJob = async (input, { accountId = null } = {}) => {
  const existing = input && input.id ? await getJob(input.id) : null;
  const full = normalizeJob(input, { existing, accountId });
  delete full.stats;
  const rows = await readJobIndex();
  const at = rows.findIndex((r) => r.id === full.id);
  if (at < 0 && rows.length >= MAX_JOBS) throw new Error(`Scheduled job limit reached (${MAX_JOBS}). Delete unused jobs first.`);
  const row = toIndexRow(full);
  const next = rows.slice();
  if (at >= 0) next[at] = row; else next.push(row);
  const indexBytes = Buffer.byteLength(JSON.stringify(next), "utf8");
  if (indexBytes > INDEX_MAX_BYTES) throw new Error(`Job index would exceed ${INDEX_MAX_BYTES} bytes (${indexBytes}). Delete unused jobs first.`);
  if (at < 0 || (existing && existing.enabled === false && full.enabled)) await touchSched(full.id);
  await writeJobIndex(next);
  await storage.set(JOB_PREFIX + safeKeyPart(full.id), full);
  return decorate(full, existing && existing.stats ? { [full.id]: existing.stats } : {});
};

export const deleteJob = async (id) => {
  const rows = await readJobIndex();
  const next = rows.filter((r) => r.id !== id);
  if (next.length !== rows.length) await writeJobIndex(next);
  await storage.delete(JOB_PREFIX + safeKeyPart(id));
  try { const m = await readStatsMap(); if (m[id]) { delete m[id]; await storage.set(JOB_STATS_KEY, m); } } catch { /* best-effort */ }
  try { const m = await readSchedMap(); if (m[id]) { delete m[id]; await writeSchedMap(m); } } catch { /* best-effort */ }
  return { removed: next.length !== rows.length };
};

export const setJobEnabled = async (id, enabled) => {
  const full = await getJob(id);
  if (!full) throw new Error("Scheduled job not found");
  const stats = full.stats; delete full.stats;
  full.enabled = enabled !== false; full.updatedAt = nowIso();
  // A re-enabled job must not replay the minutes it was disabled for.
  if (full.enabled) await touchSched(id);
  const rows = await readJobIndex();
  const at = rows.findIndex((r) => r.id === id);
  if (at >= 0) rows[at] = toIndexRow(full); else rows.push(toIndexRow(full));
  await writeJobIndex(rows);
  await storage.set(JOB_PREFIX + safeKeyPart(id), full);
  return { ...full, stats: { ...(stats || emptyStats()), nextRunAt: nextRunOf(full) } };
};

// Best-effort stats update (advisory; touches ONLY the stats map).
export const updateJobStats = async (id, { status, error = null }) => {
  try {
    const m = await readStatsMap();
    const st = m[id] || emptyStats();
    st.runCount = (st.runCount || 0) + 1;
    if (status === "error") st.errorCount = (st.errorCount || 0) + 1;
    st.lastRunAt = nowIso(); st.lastStatus = status; st.lastError = error ? clampStr(error, 300) : null;
    m[id] = st;
    await storage.set(JOB_STATS_KEY, m);
  } catch (e) { console.warn("[job] stats update skipped:", e && e.message); }
};

// ── Queue ────────────────────────────────────────────────────────────────────

export const enqueueJobRun = async ({ job, scheduledFor, missed = 0, manual = false, accountId = null }) => {
  const m = await idx();
  const { Queue } = await import("@forge/events");
  const queue = new Queue({ key: "async-ai-queue" });
  const taskId = m.makeTaskId("scheduledjob");
  const enqueuedAt = nowIso();
  await queue.push({ body: { taskType: "scheduledjob", taskId, params: { jobId: job.id, jobName: job.name, scheduledFor, missed, manual, enqueuedAt } } });
  await m.writeAsyncJob({ taskId, taskType: "scheduledjob", status: "queued", ruleId: job.id, ruleName: job.name, issueKey: null, provider: null, model: null, accountId, enqueuedAt });
  return { taskId };
};

// ── The tick (manifest `scheduledTrigger` → here) ────────────────────────────

/**
 * Pure planning step, exported for offline tests: which jobs are due and when.
 * `sched` is the bookkeeping map (id → { lastCheckedAt }); it is mutated to `now`
 * for every row. Returns [{ job, fireAt, missed }].
 */
export const planTick = (rows, sched = {}, now = Date.now()) => {
  const due = [];
  for (const job of rows) {
    if (!job || !job.schedule || !job.schedule.cron) continue;
    const bk = sched[job.id] || {};
    const lastChecked = bk.lastCheckedAt ? Date.parse(bk.lastCheckedAt) : NaN;
    const after = Number.isFinite(lastChecked) ? Math.max(lastChecked, now - MAX_REPLAY_MS) : now - 6 * 60000;
    sched[job.id] = { ...bk, lastCheckedAt: new Date(now).toISOString() };
    if (job.enabled === false) continue;
    let matches = [];
    try { matches = dueInWindow(job.schedule.cron, after, now, job.schedule.timeZone); } catch { continue; }
    if (!matches.length) continue;
    due.push({ job, fireAt: matches[matches.length - 1], missed: matches.length - 1 });
  }
  return due;
};

export async function scheduledTick() {
  const started = Date.now();
  let rows; let sched;
  try { [rows, sched] = await Promise.all([readJobIndex(), readSchedMap()]); } catch (e) { console.error("[job] index read failed:", e && e.message); return; }
  if (!rows.length) return;
  // Drop bookkeeping for jobs that no longer exist (keeps the map bounded).
  const ids = new Set(rows.map((r) => r.id));
  for (const k of Object.keys(sched)) if (!ids.has(k)) delete sched[k];
  const due = planTick(rows, sched, started);
  // Persist lastCheckedAt for every job first — the window must advance even if
  // an enqueue below fails (otherwise a broken job would be re-planned forever).
  // Only the sched map is written here: the index and the records stay untouched.
  try { await writeSchedMap(sched); } catch (e) { console.error("[job] sched write failed:", e && e.message); }
  let queued = 0;
  for (const d of due) {
    if (Date.now() - started > TICK_BUDGET_MS) { console.warn(`[job] tick budget hit after ${queued} enqueue(s)`); break; }
    const claimKey = `job_claim:${safeKeyPart(d.job.id)}:${d.fireAt}`;
    try {
      if (await storage.get(claimKey)) continue; // duplicate tick delivery
      await storage.set(claimKey, { at: nowIso() }, CLAIM_TTL);
    } catch (e) { console.warn("[job] claim failed (continuing):", e && e.message); }
    const full = await getJob(d.job.id);
    if (!full || full.enabled === false) continue;
    try {
      await enqueueJobRun({ job: full, scheduledFor: new Date(d.fireAt).toISOString(), missed: d.missed });
      queued++;
    } catch (e) { console.error(`[job] enqueue failed for ${full.id}:`, e && e.message); }
  }
  console.log(`[job] tick: ${rows.length} job(s), ${due.length} due, ${queued} queued in ${Date.now() - started}ms`);
}

// ── Execution (consumer) ─────────────────────────────────────────────────────

const searchScope = async (scope) => {
  const issues = [];
  let nextPageToken = null;
  while (issues.length < scope.maxIssues) {
    const body = { jql: scope.jql, maxResults: Math.min(50, scope.maxIssues - issues.length), fields: ["summary", "status", "issuetype", "priority", "assignee", "project", "updated"] };
    if (nextPageToken) body.nextPageToken = nextPageToken;
    const res = await api.asApp().requestJira(route`/rest/api/3/search/jql`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`Scope JQL failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    for (const i of data.issues || []) issues.push(i);
    if (!data.nextPageToken || !(data.issues || []).length) break;
    nextPageToken = data.nextPageToken;
  }
  return issues;
};

const summarizeJobForAi = (job, scheduledFor, issue) => {
  const lines = [`Scheduled job: ${job.name}`, `Schedule: ${describeCron(job.schedule.cron)} (${job.schedule.timeZone})`, `Scheduled for: ${scheduledFor || "manual run"}`, `Now: ${nowIso()}`];
  if (issue) {
    const f = issue.fields || {};
    lines.push(`Current issue: ${issue.key}`, `Summary: ${f.summary || ""}`, `Status: ${f.status ? f.status.name : "?"}`, `Type: ${f.issuetype ? f.issuetype.name : "?"}`, `Priority: ${f.priority ? f.priority.name : "?"}`, `Assignee: ${f.assignee ? f.assignee.displayName : "unassigned"}`, `Updated: ${f.updated || "?"}`);
  } else if (job.scope) {
    lines.push(`Scope JQL: ${job.scope.jql}`);
  } else {
    lines.push("No current issue — pass issueKey explicitly to issue tools.");
  }
  return lines.join("\n");
};

/**
 * Run ONE job (all scoped issues, or once). Shared by the consumer and REST/UI
 * "Run now" (which also goes through the queue so the 120s budget applies).
 */
export const runJob = async ({ job, scheduledFor = null, missed = 0, manual = false, deadline = Date.now() + JOB_RUN_BUDGET_MS, cancelToken = null, forceSimulation = false, source = "async" }) => {
  const m = await idx();
  const started = Date.now();
  const config = { ...job, simulationMode: forceSimulation || job.simulationMode === true };
  const baseCtx = { runtime: "job", jobId: job.id, jobName: job.name, scheduledFor, manual, schedule: job.schedule };
  const base = { type: "scheduledjob", source, fieldId: `${job.schedule.cron} ${job.schedule.timeZone}`, ruleId: job.id, ruleName: job.name, ruleWorkflow: null, mode: job.mode, scheduledFor, manual, missed };
  const runOne = async (issue, perDeadline) => {
    const issueKey = issue ? issue.key : null;
    const extraContext = { ...baseCtx, issueKey, projectKey: issue && issue.fields && issue.fields.project ? issue.fields.project.key : null, scopeIssue: issue ? { key: issue.key, summary: issue.fields && issue.fields.summary, status: issue.fields && issue.fields.status && issue.fields.status.name } : null };
    if (job.mode === "agent") {
      const { runAgentTask } = await agentMod();
      const r = await runAgentTask({ instructions: job.agent.instructions, allowedActions: job.agent.allowedActions, maxRounds: job.agent.maxRounds, issueKey, config, contextTitle: "JOB CONTEXT", contextText: summarizeJobForAi(job, scheduledFor, issue), deadline: perDeadline, cancelToken, extraContext });
      return { issueKey, success: r.success, reason: r.success ? `${r.outcome}: ${r.summary || ""}` : (r.error || "agent failed"), changes: r.changes || [], logs: r.logs || [], tokens: r.tokens || 0, aiTimeMs: r.aiTimeMs || 0 };
    }
    const r = await m.runSandboxSteps({ issueKey, config, deadline: perDeadline, cancelToken, extraContext });
    return { issueKey, success: r.success, reason: r.success ? `${r.stepsTotal} step(s), ${r.changes.length} change(s)` : `step "${r.failedStep}" failed: ${(r.stepResults.find((s) => s.status === "error") || {}).error || "see logs"}`, recommendation: r.recommendation, changes: r.changes || [], logs: r.logs || [], stepResults: r.stepResults };
  };

  if (!job.scope) {
    const r = await runOne(null, deadline);
    return { log: { ...base, issueKey: "(no issue)", isValid: r.success, reason: r.reason, recommendation: r.recommendation, executionTimeMs: Date.now() - started, changes: r.changes.slice(0, 20), logs: r.logs.slice(-60).map((s) => String(s).slice(0, 300)), tokens: r.tokens, aiTimeMs: r.aiTimeMs, stepResults: r.stepResults }, success: r.success, issues: [] };
  }
  let issues;
  try { issues = await searchScope(job.scope); } catch (e) {
    return { log: { ...base, issueKey: "(scope)", isValid: false, reason: e.message, recommendation: "Check the job's scope JQL.", executionTimeMs: Date.now() - started }, success: false, issues: [] };
  }
  const perIssue = [];
  const logs = [`Scope "${job.scope.jql}" matched ${issues.length} issue(s) (cap ${job.scope.maxIssues})`];
  let changes = []; let tokens = 0; let aiTimeMs = 0; let failures = 0; let cancelled = 0;
  for (let i = 0; i < issues.length; i++) {
    const remaining = deadline - Date.now();
    if (remaining < 8000) { logs.push(`TIMEOUT: ${issues.length - i} issue(s) not processed — time budget exhausted`); failures += issues.length - i; for (const rest of issues.slice(i)) perIssue.push({ key: rest.key, success: false, reason: "not processed (time budget)" }); break; }
    if (cancelToken && await m.isJobCancelled(cancelToken)) {
      // Cancellation preserves completed work, but every untouched issue must have
      // an outcome: a partial run must never claim the entire scope processed OK.
      cancelled = issues.length - i;
      logs.push(`CANCELLED by operator: ${cancelled} issue(s) not processed`);
      for (const rest of issues.slice(i)) perIssue.push({ key: rest.key, success: false, reason: "not processed (cancelled)" });
      break;
    }
    const share = Math.max(8000, Math.floor(remaining / (issues.length - i)));
    const r = await runOne(issues[i], Date.now() + Math.min(remaining - 2000, share));
    perIssue.push({ key: issues[i].key, success: r.success, reason: String(r.reason || "").slice(0, 200) });
    if (!r.success) failures++;
    changes = changes.concat((r.changes || []).map((c) => ({ ...c, issue: issues[i].key })));
    tokens += r.tokens || 0; aiTimeMs += r.aiTimeMs || 0;
    logs.push(`--- ${issues[i].key}: ${r.success ? "OK" : "FAILED"} — ${r.reason}`);
    for (const l of (r.logs || []).slice(-12)) logs.push(`    ${String(l).slice(0, 240)}`);
  }
  const processedOk = perIssue.filter((r) => r.success).length;
  const success = processedOk === issues.length;
  return {
    log: { ...base, issueKey: `${issues.length} issue(s)`, isValid: success, reason: `${processedOk}/${issues.length} issue(s) processed OK, ${changes.length} change(s)${failures ? `, ${failures} failed` : ""}${cancelled ? `, ${cancelled} cancelled` : ""}`, recommendation: success ? undefined : "Open the job's log details for the per-issue outcomes.", executionTimeMs: Date.now() - started, changes: changes.slice(0, 30), logs: logs.slice(-120).map((s) => String(s).slice(0, 300)), tokens, aiTimeMs, perIssue: perIssue.slice(0, 100) },
    success, issues: perIssue,
  };
};

/** Queue consumer entry: taskType "scheduledjob" (polled by "Run now"). */
export const executeScheduledJobTask = async (params, taskId) => {
  const m = await idx();
  const { jobId, scheduledFor, missed, manual } = params || {};
  const job = await getJob(jobId);
  if (!job) return { skipped: true, reason: "job deleted" };
  if (job.enabled === false && !manual) {
    await m.storeLog({ type: "scheduledjob", source: "async", issueKey: "(no issue)", fieldId: `${job.schedule.cron} ${job.schedule.timeZone}`, isValid: true, decision: "SKIP", reason: "Skipped: job was disabled before the queued run started.", executionTimeMs: 0, ruleId: job.id, ruleName: job.name, ruleWorkflow: null });
    return { skipped: true, reason: "disabled" };
  }
  // At-least-once delivery guard: a scheduled run is identified by job + due minute,
  // a manual run by its task id (best-effort check-then-set; mirrors pf_exec).
  try {
    const claimKey = EXEC_CLAIM_PREFIX + safeKeyPart(manual ? `${job.id}:manual:${taskId}` : `${job.id}:${scheduledFor || taskId}`);
    if (await storage.get(claimKey)) { console.log(`[job] duplicate delivery of ${taskId} suppressed`); return { skipped: true, reason: "duplicate delivery" }; }
    await storage.set(claimKey, { at: nowIso() }, EXEC_CLAIM_TTL);
  } catch (e) { console.warn("[job] claim failed (continuing):", e && e.message); }
  const enqueuedMs = params.enqueuedAt ? Date.parse(params.enqueuedAt) : NaN;
  const started = Date.now();
  let out;
  try {
    out = await runJob({ job, scheduledFor, missed, manual, deadline: Date.now() + JOB_RUN_BUDGET_MS, cancelToken: taskId, source: "async" });
  } catch (e) {
    console.error(`[job] ${job.id} run crashed:`, e);
    out = { success: false, issues: [], log: { type: "scheduledjob", source: "async", issueKey: "(no issue)", fieldId: `${job.schedule.cron} ${job.schedule.timeZone}`, isValid: false, reason: `Run crashed: ${String((e && e.message) || e).slice(0, 400)}`, recommendation: "Open the job and use 'Run now' to reproduce; check the AI provider settings if the job uses agent mode.", executionTimeMs: Date.now() - started, ruleId: job.id, ruleName: job.name, ruleWorkflow: null, mode: job.mode, scheduledFor, manual, missed } };
  }
  const entry = out.log;
  if (Number.isFinite(enqueuedMs)) entry.queueDelayMs = Math.max(0, Date.now() - enqueuedMs);
  await m.storeLog(entry);
  await updateJobStats(job.id, { status: entry.isValid ? "ok" : "error", error: entry.isValid ? null : entry.reason });
  return { success: entry.isValid, reason: entry.reason, changes: entry.changes, logs: entry.logs, issues: out.issues, executionTimeMs: entry.executionTimeMs, tokens: entry.tokens };
};

/** Next firing instants for the editor preview. */
export const previewSchedule = ({ cron, timeZone, count = 5 }) => {
  const v = validateCron(cron);
  if (!v.ok) return { ok: false, error: v.error, runs: [] };
  const tz = normalizeTimeZone(timeZone);
  return { ok: true, description: describeCron(cron), timeZone: tz, runs: nextRuns(cron, { timeZone: tz, count: Math.min(10, Math.max(1, count)) }) };
};
