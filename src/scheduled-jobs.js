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
import { kvs as storage } from "@forge/kvs";
import api, { route } from "@forge/api";
import { validateCron, normalizeTimeZone, dueInWindow, nextRuns, describeCron, fireIdentity } from "./shared/cron.js";
import { assertAllowedActions, buildAgentGateContext, normalizeAgentKnowledge, DEFAULT_AGENT_ACTIONS, DEFAULT_AGENT_ROUNDS, MAX_AGENT_ROUNDS } from "./shared/agent-actions.js";
import { normalizeStep, armingStamp, assertKnownSkillIds, buildAgentKnowledge, takeAgentRunSlot } from "./listeners.js";
import { createRunSearchBudget } from "./web-search-tool.js";
import { JOB_DEFAULT_MAX_WRITES_PER_RUN, JOB_MAX_WRITES_PER_RUN, JOB_MIN_WRITES_PER_RUN, brakeRefusalText } from "./shared/registry-limits.js";
// The VA record has ONE normalizer and it is called FROM INSIDE normalizeJob — a parallel
// save path for agents would be the split this release exists to avoid.
import { normalizeVa } from "./shared/va-config.js";
import { agentResultFields, SCOPED_AGENT_SUMMARY_BUDGET_BYTES, boundScopedJobLog } from "./shared/agent-result.js";
import { claimRuleExecution } from "./shared/execution-claim.js";
// ONE HOME for KVS key sanitising / conflict detection — src/shared/kvs-keys.js (F-340).
import { safeKeyPart } from "./shared/kvs-keys.js";
import { JOB_STATS_KEY, statsForRule, statsReceipt, deleteRuleWithStats, recoverRuleStats } from "./rule-stats.js";

const idx = () => import("./index.js");
const agentMod = () => import("./agent-runner.js");

export const JOB_INDEX_KEY = "job_index";
export const JOB_PREFIX = "job:";
// Run stats and the scheduler's own bookkeeping (lastCheckedAt per job) live in
// their own keys: the consumer never rewrites the index or a config record, and the
// tick (single writer of `job_sched`) never rewrites the index either — so a save
// racing either of them can no longer be lost.
export { JOB_STATS_KEY };
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

// ── Validation / normalisation ───────────────────────────────────────────────

export const normalizeJob = (input = {}, { existing = null, accountId = null, gate = undefined, savedByRole = "editor" } = {}) => {
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
  // THREE VALUES NOW (1.5). `mode` was binary for two releases, so the third value's
  // blast radius is every `mode ===` site in this file and in `async-handler.js`; they
  // were grepped in the same cut. The default stays "script" — an unknown value must
  // never become a VA, because a VA is the mode with the most autonomy.
  const mode = src.mode === "agent" ? "agent" : (src.mode === "va" ? "va" : "script");
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
    // Knowledge binding — ONE normalizer, shared with listeners (1.4 commit 13b).
    ...normalizeAgentKnowledge(a),
  };
  if (mode === "agent" && !agent.instructions.trim()) throw new Error("agent.instructions is required in agent mode");
  if (mode === "agent" && String(a.instructions || "").length > 6000) throw new Error("agent.instructions exceeds 6000 characters");
  if (mode === "script" && functions.length === 0) throw new Error("functions must contain at least one code step in script mode");
  // THE VA BLOCK, normalised by its ONE home (`normalizeVa`, src/shared/va-config.js):
  // every number clamped, every project key validated, `scope.write.site` REFUSED.
  // A `mode:"va"` save with no block is refused rather than defaulted — an agent whose
  // persona, scope and caps were invented by the save path is an agent nobody configured.
  const vaResult = mode === "va" ? normalizeVa(src.va, { existing: existing && existing.va, savedByRole }) : null;
  const va = vaResult ? vaResult.va : null;
  const out = {
    id, name,
    description: clampStr(src.description, 2000),
    enabled: src.enabled !== false,
    schedule, scope, mode, functions, agent,
    // Absent on a script/agent job — `isVaJob` reads the PRESENCE of the block, not the
    // mode alone, so a null here can never be mistaken for a configured agent.
    ...(va ? { va } : {}),
    simulationMode: src.simulationMode === true,
    suppressNotifications: src.suppressNotifications === true,
    // THE JOB WRITE BRAKE (1.4 commit 13d). Clamped here, default from the ONE home in
    // src/shared/registry-limits.js. 0 is a MEANINGFUL value (a job that may read and
    // report but never change anything), so `clampInt`'s NaN fallback is what picks the
    // default — a blank or absent field, never a deliberate zero.
    maxWritesPerRun: clampInt(src.maxWritesPerRun, JOB_MIN_WRITES_PER_RUN, JOB_MAX_WRITES_PER_RUN, JOB_DEFAULT_MAX_WRITES_PER_RUN),
    // WHO ARMED THIS JOB — role AND acting account, from the ONE stamp in listeners.js
    // (F-409). See `armingStamp` there for why a stored field and not a live check, why
    // the default is the least-privileged one, and why `createdBy` moves with the role:
    // it is the account the job's authority comes from, not its first author
    // (`firstCreatedBy` keeps that). A job holds no verdict actions today; the fields are
    // here so ALL THREE rule kinds answer "who armed this" the same way, from one home.
    ...armingStamp({ accountId, savedByRole, existing }),
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
  // On the INDEX row so the Jobs tab can render the brake without loading every record.
  maxWritesPerRun: full.maxWritesPerRun,
  createdBy: full.createdBy || null, createdAt: full.createdAt, updatedAt: full.updatedAt,
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
const decorate = (row, statsMap) => ({ ...row, stats: { ...emptyStats(), ...statsForRule(statsMap && statsMap[row.id], row), nextRunAt: nextRunOf(row) } });

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

export const saveJob = async (input, { accountId = null, gate = undefined, savedByRole = "editor" } = {}) => {
  const existing = input && input.id ? await getJob(input.id) : null;
  const full = normalizeJob(input, { existing, accountId, gate, savedByRole });
  // Same refusal as a listener, from the same home (1.4 commit 13b).
  await assertKnownSkillIds(full.agent);
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
  const full = await getJob(id);
  const rows = await readJobIndex();
  const next = rows.filter((r) => r.id !== id);
  if (!full && next.length === rows.length) return { removed: false };
  await deleteRuleWithStats({ kind: "scheduledjob", rule: full || { id, createdAt: null }, recordKey: JOB_PREFIX + safeKeyPart(id), indexKey: JOB_INDEX_KEY, indexRows: next });
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

// ── Queue ────────────────────────────────────────────────────────────────────

export const enqueueJobRun = async ({ job, scheduledFor, missed = 0, manual = false, accountId = null }) => {
  const m = await idx();
  const { Queue } = await import("@forge/events");
  const queue = new Queue({ key: "async-ai-queue" });
  // A VIRTUAL ADMINISTRATOR'S DUE RUN IS ITS PREPARE TICK, not a script/agent run. The
  // branch is HERE rather than in `scheduledTick` so that "Run now" from the Jobs tab and
  // from the REST API reach the same task the scheduler does — a second route that ran a
  // VA as an ordinary job would skip the sweep, the ledger and every gate.
  // ONE home for the question: `isVaJob` (src/virtual-admin.js), which requires the `va`
  // BLOCK and not merely the mode, so a record whose mode says `va` but which carries no
  // configuration runs as an ordinary job rather than as an unconfigured agent.
  const { isVaJob } = await import("./virtual-admin.js");
  const taskType = isVaJob(job) ? "va-tick" : "scheduledjob";
  const taskId = m.makeTaskId(taskType);
  const enqueuedAt = nowIso();
  // The tick identity is the FIVE-MINUTE BUCKET of the firing, not the instant: the post
  // phase's floor asks "was this staged on an EARLIER tick", and an identity minted per
  // delivery would make every item its own tick and silently disable that condition.
  const tickId = taskType === "va-tick"
    ? `${job.id}-${Math.floor((scheduledFor ? Date.parse(scheduledFor) : Date.now()) / 300000)}`
    : null;
  await queue.push({ body: { taskType, taskId, params: { jobId: job.id, jobName: job.name, scheduledFor, missed, manual, enqueuedAt, ...(tickId ? { tickId } : {}) } } });
  await m.writeAsyncJob({ taskId, taskType, status: "queued", ruleId: job.id, ruleName: job.name, issueKey: null, provider: null, model: null, accountId, enqueuedAt });
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
  // Recover completed runs even on sites with listeners but no scheduled jobs.
  // On failure the cursor MUST be dropped: it is opaque, it is held across 5-minute
  // tick boundaries, and it is the most likely CAUSE of the failure — keeping it made
  // every later tick replay the same failing page, killing stats recovery for good.
  // Restarting from the first page re-reads work already enqueued (the receipts are
  // idempotent), and the consecutive-failure count makes a page that always fails
  // loud instead of silent.
  const recovery = sched[":statsRecovery"] || {};
  try {
    sched[":statsRecovery"] = { cursor: await recoverRuleStats(recovery.cursor) };
  } catch (error) {
    const fails = (Number(recovery.fails) || 0) + 1;
    sched[":statsRecovery"] = { cursor: null, fails };
    const where = recovery.cursor ? "cursor dropped, next tick restarts from the first page" : "already at the first page";
    const msg = `[stats] recovery failed ${fails}x (${where}): ${error?.message}`;
    if (fails >= 3) console.error(msg); else console.warn(msg);
  }
  // Drop bookkeeping for jobs that no longer exist (keeps the map bounded).
  const ids = new Set(rows.map((r) => r.id));
  for (const k of Object.keys(sched)) if (k !== ":statsRecovery" && !ids.has(k)) delete sched[k];
  const due = planTick(rows, sched, started);
  // Persist lastCheckedAt for every job first — the window must advance even if
  // an enqueue below fails (otherwise a broken job would be re-planned forever).
  // Only the sched map is written here: the index and the records stay untouched.
  try { await writeSchedMap(sched); } catch (e) { console.error("[job] sched write failed:", e && e.message); }
  let queued = 0;
  for (const d of due) {
    if (Date.now() - started > TICK_BUDGET_MS) { console.warn(`[job] tick budget hit after ${queued} enqueue(s)`); break; }
    // Claim identity comes from the SCHEDULE, not the raw instant: for a wall-clock
    // schedule ("0 2 * * *") it is the local minute, so the two 02:00 hours of a
    // DST fall-back can never mint two claims — see fireIdentity in shared/cron.js.
    const claimKey = `job_claim:${safeKeyPart(d.job.id)}:${safeKeyPart(fireIdentity(d.job.schedule.cron, d.fireAt, d.job.schedule.timeZone))}`;
    if (!(await claimRuleExecution(storage, claimKey, CLAIM_TTL, "job"))) continue; // duplicate tick delivery
    const full = await getJob(d.job.id);
    if (!full || full.enabled === false) continue;
    try {
      await enqueueJobRun({ job: full, scheduledFor: new Date(d.fireAt).toISOString(), missed: d.missed });
      queued++;
    } catch (e) { console.error(`[job] enqueue failed for ${full.id}:`, e && e.message); }
  }
  // THE VIRTUAL ADMINISTRATOR'S POST PHASE (F-421), on the SAME planner. It is its own
  // task with its own receipt, so it cannot ride the prepare tick's row — but it is NOT
  // a second scheduled trigger: one clock drives both phases, which is the only way the
  // "a later tick than the one that staged it" half of the speech floor means anything.
  //
  // It runs on EVERY 5-minute tick, not on the agent's own cadence, because a draft
  // staged at 10:00 with a 15-minute gap must go out at 10:15 — not at 10:30 when a
  // half-hourly agent next wakes. The engine bounds its own scan and refuses everything
  // outside the post window, so a tick with nothing to do is two KVS reads.
  await enqueueVaPostRuns(rows, started);
  console.log(`[job] tick: ${rows.length} job(s), ${due.length} due, ${queued} queued in ${Date.now() - started}ms`);
}

/**
 * Enqueue one `va-post` task per enabled Virtual Administrator.
 *
 * SMALLEST POSSIBLE EDIT TO THE PLANNER, and ONE home for the DECISION.
 *
 * The authority on "is this job a Virtual Administrator" is `isVaJob`
 * (`src/virtual-admin.js`), which requires the `va` BLOCK and not merely the mode — and
 * that is what `enqueueJobRun` and the three task handlers all call. The filter below
 * reads `mode` directly because an INDEX ROW carries the mode and not the block, so the
 * full record cannot be consulted without loading all of them. It is therefore a CHEAP
 * PRE-FILTER, never the decision: a row that says `va` with no record is loaded by the
 * task, refused by `isVaJob` there, and skipped — it is never run as a script job.
 *
 * The claim identity is the MINUTE, not the schedule: the post phase has no cron of its
 * own, so two deliveries of the same 5-minute trigger must collapse onto one key. Failing
 * to claim is the healthy duplicate path and is silent; the post task takes the far
 * narrower `va_post` claim per draft, which is what actually prevents a double reply.
 */
const enqueueVaPostRuns = async (rows, nowMs) => {
  const vaRows = rows.filter((r) => r && r.enabled !== false && r.mode === "va");
  if (!vaRows.length) return;
  const minute = Math.floor(nowMs / 300000);
  const { Queue } = await import("@forge/events");
  const queue = new Queue({ key: "async-ai-queue" });
  for (const row of vaRows) {
    const claimKey = `job_claim:${safeKeyPart(row.id)}:post:${minute}`;
    try {
      if (!(await claimRuleExecution(storage, claimKey, CLAIM_TTL, "va-post"))) continue;
      await queue.push({ body: { taskType: "va-post", taskId: `va-post_${safeKeyPart(row.id)}_${minute}`, params: { jobId: row.id, tickId: `${row.id}-${minute}`, enqueuedAt: nowIso() } } });
    } catch (e) {
      // A post phase that could not be queued is a MISSED CHANCE TO SPEAK, never a
      // failed tick: the drafts stay staged and the next 5-minute tick tries again.
      console.warn(`[va] post enqueue skipped for ${row.id}:`, e && e.message);
    }
  }
};

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
export const runJob = async ({ job, scheduledFor = null, missed = 0, manual = false, deadline = Date.now() + JOB_RUN_BUDGET_MS, cancelToken = null, forceSimulation = false, source = "async",
  // RUN-TIME GATE (F-302) — same contract as runListener: `gateFacts` are the
  // instance's facts, omitted means the most restrictive context. A scheduled job is
  // NOT an external trigger (the app's own clock started it), so a dangerous action an
  // admin saved survives here; `confirm` actions still need that admin save.
  gateFacts = null, executors = {} }) => {
  const m = await idx();
  const started = Date.now();
  const config = { ...job, simulationMode: forceSimulation || job.simulationMode === true };
  const baseCtx = { runtime: "job", jobId: job.id, jobName: job.name, scheduledFor, manual, schedule: job.schedule };
  const base = { type: "scheduledjob", source, fieldId: `${job.schedule.cron} ${job.schedule.timeZone}`, ruleId: job.id, ruleName: job.name, ruleWorkflow: null, mode: job.mode, scheduledFor, manual, missed };
  // THE JOB'S WRITE ALLOWANCE for this whole run — one number for the run, not per issue:
  // a 100-issue scope writing once each is exactly the shape the brake exists to bound.
  // An OLD record saved before 1.4 has no field; it gets the default rather than no brake,
  // because "the field is absent" must not be the way past it.
  const maxWrites = Number.isFinite(Number(job.maxWritesPerRun))
    ? Math.min(JOB_MAX_WRITES_PER_RUN, Math.max(JOB_MIN_WRITES_PER_RUN, Math.trunc(Number(job.maxWritesPerRun))))
    : JOB_DEFAULT_MAX_WRITES_PER_RUN;
  // The run's own brake report, rendered by the Jobs tab and the log details. `null` until
  // something actually trips — an absent field means "nothing was braked", which is the
  // honest default and the common case.
  let brake = null;
  // Changes made SO FAR in this run, across every scope issue. The per-issue sandbox
  // session counts its own (`session.changes`, the one write ledger); this carries the
  // allowance forward, so the brake is a RUN budget and not a per-issue one.
  let writesDone = 0;
  // THE RUN'S WEB-SEARCH CEILING (F-407), created ONCE and shared by every scope issue —
  // the same reason `writesDone` is carried across issues rather than reset per issue. A
  // per-issue counter is not a run budget, and a 100-issue sweep proved it.
  const webRunBudget = createRunSearchBudget();
  const runOne = async (issue, perDeadline) => {
    const issueKey = issue ? issue.key : null;
    const extraContext = { ...baseCtx, issueKey, projectKey: issue && issue.fields && issue.fields.project ? issue.fields.project.key : null, scopeIssue: issue ? { key: issue.key, summary: issue.fields && issue.fields.summary, status: issue.fields && issue.fields.status && issue.fields.status.name } : null };
    if (job.mode === "agent") {
      // THE TENANT-WIDE AGENT BRAKE, taken at the RUN site because cost is spent when the
      // model runs. Same mechanism as the listener brakes (src/listeners.js is its one
      // home); per ISSUE of a scope, because each issue is its own agent run.
      const slot = await takeAgentRunSlot();
      if (slot.braked) {
        brake = { kind: "agent-runs", max: slot.max, reason: slot.reason };
        return { issueKey, success: false, braked: true, reason: slot.reason, changes: [], logs: [slot.reason], tokens: 0, aiTimeMs: 0 };
      }
      const { runAgentTask } = await agentMod();
      const agentGate = gateFacts ? buildAgentGateContext({ ...gateFacts, triggerSource: null, savedByRole: job.savedByRole }) : undefined;
      // Knowledge is built PER ISSUE because the memory block is project-scoped and a
      // scoped job walks issues from different projects. The skills half is identical
      // across them; paying one extra KVS read per issue is the cost of not injecting
      // project A's learned facts while acting on project B's issue.
      // Same as the listener run site (F-405): the "skill too large, not injected" notice
      // had no caller passing a log, so it was never written anywhere at all.
      const knowledgeNotices = [];
      const knowledge = await buildAgentKnowledge(job.agent, { projectKey: extraContext.projectKey, audience: "agentRun", log: (line) => knowledgeNotices.push(String(line)) });
      // The allowance the agent gets is what is LEFT of the run's budget.
      const r = await runAgentTask({ instructions: job.agent.instructions, allowedActions: job.agent.allowedActions, maxRounds: job.agent.maxRounds, issueKey, config, contextTitle: "JOB CONTEXT", contextText: summarizeJobForAi(job, scheduledFor, issue), deadline: perDeadline, cancelToken, extraContext, gate: agentGate, executors, knowledge, maxWrites: Math.max(0, maxWrites - writesDone), webRunBudget,
        // `writeScope: null` — UNSCOPED, DELIBERATELY (F-411). A scheduled job is bounded
        // by its SCOPE JQL (the issues it walks) and by `maxWritesPerRun`, not by a
        // project allow-list, so `null` is exactly the pre-1.5 behaviour. Explicit, not
        // omitted: omitting it now refuses every write, and the explicit value is the
        // greppable admission that this surface has no project scope of its own.
        // TODO(F-411): a job's scope JQL names the issues it READS; give it a
        // `scope.write` naming the projects it may CHANGE, and drop this `null`.
        writeScope: null });
      // NO STAMP HERE (F-402). Reaching the limit is not the same as being STOPPED by it:
      // a run that made exactly its allowance and had nothing left to do was reported as
      // braked, with "the remaining work was not done" on a run where none remained. The
      // brake is stamped where work is actually SKIPPED — the between-issue check below,
      // and the dispatcher's own refusal — so the word means what it says.
      return { issueKey, ...agentResultFields(r, { summaryMaxBytes: job.scope ? Math.floor(SCOPED_AGENT_SUMMARY_BUDGET_BYTES / MAX_SCOPE_ISSUES) : null }), success: r.success, reason: r.success ? `${r.outcome}: ${r.summary || ""}` : (r.error || "agent failed"), changes: r.changes || [], logs: [...knowledgeNotices, ...(r.logs || [])], tokens: r.tokens || 0, aiTimeMs: r.aiTimeMs || 0 };
    }
    // STEP MODE IS BRAKED TOO (F-402). The cap used to reach the agent dispatcher and the
    // between-issue check and nothing else, so one step-mode issue could write a thousand
    // times while the job's own "maximum writes per run" said nothing. The sandbox enforces
    // it at its write boundary, counting the SAME `changes` ledger the agent brake counts —
    // one number for both modes, and what is left of the run's budget, not a fresh one per
    // issue.
    const r = await m.runSandboxSteps({ issueKey, config, deadline: perDeadline, cancelToken, extraContext, maxWrites: Math.max(0, maxWrites - writesDone) });
    return { issueKey, success: r.success, reason: r.success ? `${r.stepsTotal} step(s), ${r.changes.length} change(s)` : `step "${r.failedStep}" failed: ${(r.stepResults.find((s) => s.status === "error") || {}).error || "see logs"}`, recommendation: r.recommendation, changes: r.changes || [], logs: r.logs || [], stepResults: r.stepResults };
  };

  if (!job.scope) {
    const r = await runOne(null, deadline);
    return { log: { ...base, issueKey: "(no issue)", isValid: r.success, reason: r.reason, agentOutcome: r.agentOutcome, agentSummary: r.agentSummary, recommendation: brake ? brake.reason : r.recommendation, executionTimeMs: Date.now() - started, changes: r.changes.slice(0, 20), logs: r.logs.slice(-60).map((s) => String(s).slice(0, 300)), tokens: r.tokens, aiTimeMs: r.aiTimeMs, stepResults: r.stepResults, ...(brake ? { brake } : {}) }, success: r.success, agentOutcome: r.agentOutcome, agentSummary: r.agentSummary, issues: [], ...(brake ? { brake } : {}) };
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
    // THE WRITE BRAKE, between issues. The dispatcher refuses a write inside a run; this
    // stops the SCOPE from starting another issue once the run's allowance is gone —
    // otherwise a 100-issue scope would keep paying for model rounds that can no longer
    // change anything. Every unprocessed issue gets an explicit outcome, the same rule
    // the timeout and cancellation branches above follow: a partial run must never read
    // as a whole one.
    if (writesDone >= maxWrites) {
      brake = brake || { kind: "job-writes", max: maxWrites, reason: brakeRefusalText("job-writes", maxWrites) };
      const left = issues.length - i;
      logs.push(`WRITE BRAKE: ${writesDone} change(s) made, limit ${maxWrites} — ${left} issue(s) not processed`);
      failures += left;
      for (const rest of issues.slice(i)) perIssue.push({ key: rest.key, success: false, reason: "not processed (write brake)" });
      break;
    }
    const share = Math.max(8000, Math.floor(remaining / (issues.length - i)));
    const r = await runOne(issues[i], Date.now() + Math.min(remaining - 2000, share));
    writesDone += (r.changes || []).length;
    perIssue.push({ key: issues[i].key, success: r.success, agentOutcome: r.agentOutcome, agentSummary: r.agentSummary, reason: String(r.reason || "").slice(0, 200) });
    if (!r.success) failures++;
    changes = changes.concat((r.changes || []).map((c) => ({ ...c, issue: issues[i].key })));
    tokens += r.tokens || 0; aiTimeMs += r.aiTimeMs || 0;
    logs.push(`--- ${issues[i].key}: ${r.success ? "OK" : "FAILED"} — ${r.reason}`);
    for (const l of (r.logs || []).slice(-12)) logs.push(`    ${String(l).slice(0, 240)}`);
  }
  const processedOk = perIssue.filter((r) => r.success).length;
  const success = processedOk === issues.length;
  const log = boundScopedJobLog({ ...base, issueKey: `${issues.length} issue(s)`, isValid: success, reason: `${processedOk}/${issues.length} issue(s) processed OK, ${changes.length} change(s)${failures ? `, ${failures} failed` : ""}${cancelled ? `, ${cancelled} cancelled` : ""}${brake ? `, BRAKED (${brake.kind})` : ""}`, recommendation: brake ? brake.reason : (success ? undefined : "Open the job's log details for the per-issue outcomes."), executionTimeMs: Date.now() - started, changes: changes.slice(0, 30), logs: logs.slice(-120).map((s) => String(s).slice(0, 300)), tokens, aiTimeMs, perIssue: perIssue.slice(0, 100), ...(brake ? { brake } : {}) });
  return { log, success, issues: log.perIssue, ...(brake ? { brake } : {}) };
};

// Identity of a scheduled (non-manual) delivery. Falls back to the raw value when the
// queued payload carries no parsable due time (older payloads, hand-pushed tasks).
const scheduledRunIdentity = (job, scheduledFor, taskId) => {
  const ms = scheduledFor ? Date.parse(scheduledFor) : NaN;
  if (!Number.isFinite(ms)) return String(scheduledFor || taskId);
  return fireIdentity(job.schedule.cron, ms, job.schedule.timeZone);
};

/**
 * Claim ONE job delivery. The claim IDENTITY lives here and nowhere else, and it belongs
 * to the RUN PATH ONLY. The queue consumer's fail-closed refusal path (async-handler.js)
 * deliberately does NOT take this claim: it dedups on its own `refuse_exec:<taskId>` key
 * instead, because a refusal that spent the run's identity made the next, healthy
 * redelivery look like a duplicate and lost the scheduled run (F-139 — F-136 originally
 * wired the refusal here). Returns false only on a real conflict (claimRuleExecution
 * keeps a KVS infrastructure fault fail-open).
 */
export const claimJobRun = (job, params, taskId) => {
  const { scheduledFor, manual } = params || {};
  const claimKey = EXEC_CLAIM_PREFIX + safeKeyPart(manual ? `${job.id}:manual:${taskId}` : `${job.id}:${scheduledRunIdentity(job, scheduledFor, taskId)}`);
  return claimRuleExecution(storage, claimKey, EXEC_CLAIM_TTL, "job");
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
  // At-least-once delivery guard: a scheduled run is identified by job + the FIRING
  // the tick planned (fireIdentity: the local minute for a wall-clock schedule, the
  // UTC instant for a real-time one, so a fall-back hour is one run and `*/15` keeps
  // both), a manual run by its task id. The atomic claim precedes every script/AI write.
  if (!(await claimJobRun(job, params, taskId))) {
    console.log(`[job] duplicate delivery of ${taskId} suppressed`);
    return { skipped: true, reason: "duplicate delivery" };
  }
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
  await m.storeLog(entry, { statsReceipt: statsReceipt("scheduledjob", job, entry) });
  return { success: entry.isValid, reason: entry.reason, changes: entry.changes, logs: entry.logs, issues: out.issues, executionTimeMs: entry.executionTimeMs, tokens: entry.tokens, agentOutcome: entry.agentOutcome, agentSummary: entry.agentSummary };
};

/** Next firing instants for the editor preview. */
export const previewSchedule = ({ cron, timeZone, count = 5 }) => {
  const v = validateCron(cron);
  if (!v.ok) return { ok: false, error: v.error, runs: [] };
  const tz = normalizeTimeZone(timeZone);
  return { ok: true, description: describeCron(cron), timeZone: tz, runs: nextRuns(cron, { timeZone: tz, count: Math.min(10, Math.max(1, count)) }) };
};
