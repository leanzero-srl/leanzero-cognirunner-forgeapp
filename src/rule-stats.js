/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Backend-only: every mutation of the two stats maps is serialized by Forge's
// existing queue. Executions stay parallel; only this short storage task has a
// concurrency limit. A transaction ALONE would not protect the preceding read.
import storage from "@forge/kvs";
import { Queue } from "@forge/events";

export const STATS_TASK_TYPE = "rule_stats";
export const LOG_ENTRY_PREFIX = "log_entry:";
export const LOG_TTL = { ttl: { value: 30, unit: "DAYS" } };
export const LISTENER_STATS_KEY = "listener_stats";
export const JOB_STATS_KEY = "job_stats";
const FAMILIES = { listener: { map: LISTENER_STATS_KEY, prefix: "listener:" }, scheduledjob: { map: JOB_STATS_KEY, prefix: "job:" } };
const queue = () => new Queue({ key: "async-ai-queue" });
export const logEntryKey = () => `${LOG_ENTRY_PREFIX}${String(1e13 - Date.now()).padStart(13, "0")}_${Math.random().toString(36).slice(2, 10)}`;
export const pendingRuleStats = (entry) => Boolean(FAMILIES[entry?.statsReceipt?.kind] && !entry.statsReceipt.applied);

export const statsForRule = (stats, rule) => {
  if (!stats) return {};
  // Legacy maps have no generation marker. Their last completion predates a
  // recreated rule, so those counts must not leak into its new identity.
  if (rule.createdAt && (stats._createdAt ? stats._createdAt !== rule.createdAt : stats.lastRunAt && stats.lastRunAt < rule.createdAt)) return {};
  const { _createdAt, ...visible } = stats;
  return visible;
};

export const statsReceipt = (kind, rule, entry, issueKey = null) => ({
  kind, ruleId: rule.id, createdAt: rule.createdAt,
  completedAt: new Date().toISOString(), status: entry.isValid ? "ok" : "error",
  error: entry.isValid ? null : String(entry.reason || "").slice(0, 300),
  ...(kind === "listener" ? { issueKey: issueKey || null } : {}),
});

const queueEvent = (receiptKey, receipt, clearAfterApply = false) => ({
  body: { taskType: STATS_TASK_TYPE, taskId: receiptKey, params: { receiptKey, kind: receipt.kind, clearAfterApply } },
  concurrency: { key: FAMILIES[receipt.kind].map, limit: 1 },
});

export const enqueueRuleStats = async (receiptKey, receipt, clearAfterApply = false) => {
  if (!FAMILIES[receipt?.kind] || !String(receiptKey).startsWith(LOG_ENTRY_PREFIX)) throw new Error("Invalid statistics receipt");
  await queue().push(queueEvent(receiptKey, receipt, clearAfterApply));
};

// Deletions are durable receipts too, under the existing log namespace. They are
// bookkeeping, not execution history, and readLogs excludes them.
export const removeRuleStats = async (kind, rule) => {
  if (!rule) return;
  const receipt = { kind, ruleId: rule.id, createdAt: rule.createdAt, remove: true };
  const key = logEntryKey();
  await storage.set(key, { statsOnly: true, statsReceipt: receipt }, LOG_TTL);
  try { await enqueueRuleStats(key, receipt); }
  catch (error) { console.warn("[stats] cleanup enqueue deferred to scheduled recovery:", error?.message); }
};

/** Called ONLY by the serialized rule_stats consumer, never a run/save/tick. */
export const processRuleStatsReceipt = async ({ receiptKey, kind, clearAfterApply = false } = {}) => {
  if (!FAMILIES[kind] || !String(receiptKey).startsWith(LOG_ENTRY_PREFIX)) throw new Error("Invalid statistics task");
  const entry = await storage.get(receiptKey);
  // The event carries no increment to reconstruct. A pruned/deleted receipt can
  // never make an old delivery count a second time, even after queue retries.
  if (!entry) return;
  const receipt = entry.statsReceipt;
  if (receipt?.kind !== kind) throw new Error("Statistics receipt family mismatch");
  if (receipt.applied) {
    if (clearAfterApply) await storage.delete(receiptKey);
    return;
  }
  const family = FAMILIES[kind];
  const map = (await storage.get(family.map)) || {};
  const full = await storage.get(family.prefix + receipt.ruleId);
  const previous = map[receipt.ruleId];
  if (receipt.remove) {
    // A delayed deletion must not erase a new incarnation's completed runs.
    if (previous && (previous._createdAt ? previous._createdAt === receipt.createdAt : !full || full.createdAt === receipt.createdAt || previous.lastRunAt < full.createdAt)) delete map[receipt.ruleId];
  } else if (full && full.createdAt === receipt.createdAt) {
    const previousVisible = statsForRule(previous, full);
    const next = { ...previousVisible, _createdAt: receipt.createdAt, runCount: (previousVisible.runCount || 0) + 1, errorCount: (previousVisible.errorCount || 0) + (receipt.status === "error" ? 1 : 0) };
    if (!next.lastRunAt || receipt.completedAt >= next.lastRunAt) {
      next.lastRunAt = receipt.completedAt; next.lastStatus = receipt.status; next.lastError = receipt.error;
      if (kind === "listener") next.lastIssueKey = receipt.issueKey;
    }
    map[receipt.ruleId] = next;
  }
  // Atomic map + receipt completion: a lost transaction response retries as a
  // no-op instead of counting twice. KVS 1.6.x options are the FOURTH argument.
  const transaction = storage.transact().set(family.map, map);
  if (entry.statsOnly || clearAfterApply) transaction.delete(receiptKey);
  else transaction.set(receiptKey, { ...entry, statsReceipt: { ...receipt, applied: true } }, undefined, LOG_TTL);
  await transaction.execute();
};

// One page per platform tick, with the cursor held in the existing job_sched
// bookkeeping map. This progresses through busy tenants rather than repeatedly
// scanning only the newest 100 logs. Duplicated pushes are safe by receipt id.
export const recoverRuleStats = async (cursor = null) => {
  let query = storage.query().where("key", { condition: "BEGINS_WITH", values: [LOG_ENTRY_PREFIX] }).limit(100);
  if (cursor) query = query.cursor(cursor);
  const page = await query.getMany();
  const pending = (page.results || []).filter(({ value }) => pendingRuleStats(value));
  for (let i = 0; i < pending.length; i += 50) {
    await queue().push(pending.slice(i, i + 50).map(({ key, value }) => queueEvent(key, value.statsReceipt)));
  }
  return page.nextCursor || null;
};
