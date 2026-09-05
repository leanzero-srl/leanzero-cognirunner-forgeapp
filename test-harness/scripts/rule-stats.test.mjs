/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Actual engines, logging, and async consumer; only Forge I/O is mocked. The
// drain implements the platform's per-key queue concurrency, not a product lock.
import "../lib/register-mocks-index.mjs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { default: storage } = await import("@forge/kvs");
const { pushed, Queue, default: jira } = await import("@forge/api");
const { handler: consume } = await import("../../src/async-handler.js");
const { storeLog, readLogs, handler: resolve } = await import("../../src/index.js");
const { normalizeListener, executeListenerTask, getListener, deleteListener, toIndexRow: listenerRow, readListenerIndex } = await import("../../src/listeners.js");
const { normalizeJob, executeScheduledJobTask, getJob, deleteJob, scheduledTick, toIndexRow: jobRow } = await import("../../src/scheduled-jobs.js");
const { processRuleStatsReceipt, statsReceipt, enqueueRuleStats, recoverRuleStats, pendingRuleStats } = await import("../../src/rule-stats.js");

let passed = 0; let failed = 0;
const check = async (name, fn) => {
  storage.__reset(); pushed.length = 0; jira.__reset();
  try { await fn(); passed++; }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.stack}`); }
};
const drain = async () => {
  const events = pushed.splice(0);
  const groups = new Map();
  for (const event of events) {
    assert.equal(event.body.taskType, "rule_stats");
    assert.deepEqual(event.concurrency, { key: event.body.params.kind === "listener" ? "listener_stats" : "job_stats", limit: 1 });
    const prior = groups.get(event.concurrency.key) || Promise.resolve();
    groups.set(event.concurrency.key, prior.then(async () => assert.equal(await consume(event), undefined)));
  }
  await Promise.all(groups.values());
};
const seed = (kind, id = "count-test", createdAt = "2026-01-01T00:00:00.000Z") => {
  const base = { id, name: id, createdAt, functions: [{ name: "Run", code: "return 1;" }] };
  const rule = kind === "listener" ? normalizeListener({ ...base, events: ["avi:jira:created:issue"] }) : normalizeJob({ ...base, schedule: { cron: "*/5 * * * *" } });
  rule.createdAt = createdAt;
  storage.__seed((kind === "listener" ? "listener:" : "job:") + id, rule);
  return rule;
};
const receipt = async (kind, rule, status = "ok", completedAt = "2026-09-05T18:00:00.000Z") => {
  const entry = { type: kind, ruleId: rule.id, isValid: status === "ok", reason: status === "ok" ? "passed" : "deliberate failure" };
  const stats = { ...statsReceipt(kind, rule, entry, "LZPT-1"), completedAt };
  const key = await storeLog(entry, { statsReceipt: stats });
  return { key, stats, event: pushed.at(-1) };
};

await check("10 parallel jobs and 20 listeners keep every completion and error through actual engines", async () => {
  const runs = [];
  for (const kind of ["listener", "scheduledjob"]) {
    for (let i = 0; i < (kind === "listener" ? 20 : 10); i++) {
      const rule = seed(kind, `${kind}-${i}`);
      if (i % 3 === 0) rule.functions[0].code = 'throw new Error("expected test failure");';
      storage.__seed((kind === "listener" ? "listener:" : "job:") + rule.id, rule);
      for (let j = 0; j < 2; j++) {
        runs.push(kind === "listener"
          ? executeListenerTask({ listenerId: rule.id, eventType: rule.events[0], event: {}, ctx: { issueKey: "LZPT-1" } }, `${rule.id}-${j}`)
          : executeScheduledJobTask({ jobId: rule.id, manual: true }, `${rule.id}-${j}`));
      }
    }
  }
  await Promise.all(runs);
  assert.equal(pushed.length, 60);
  assert.equal(await storage.get("job_stats"), undefined, "executions do not write the shared map");
  await drain();
  for (const kind of ["listener", "scheduledjob"]) for (let i = 0; i < (kind === "listener" ? 20 : 10); i++) {
    const full = await (kind === "listener" ? getListener : getJob)(`${kind}-${i}`);
    assert.equal(full.stats.runCount, 2);
    assert.equal(full.stats.errorCount, i % 3 === 0 ? 2 : 0);
    assert.equal(full.stats.lastStatus, i % 3 === 0 ? "error" : "ok");
    assert.equal(full.stats._createdAt, undefined);
    assert.ok(full.stats.lastRunAt);
    const completedLogs = await readLogs(full.id);
    assert.equal(full.stats.lastRunAt, completedLogs.map(entry => entry.timestamp).sort().at(-1));
    assert.equal(Boolean(full.stats.lastError), i % 3 === 0);
    if (kind === "listener") assert.equal(full.stats.lastIssueKey, "LZPT-1");
  }
  assert.equal(jira.__calls.length, 0);
});

await check("out-of-order mixed runs increment counts but retain newest status and error", async () => {
  const rule = seed("listener");
  const newest = await receipt("listener", rule, "error", "2026-09-05T19:00:00.000Z");
  const older = await receipt("listener", rule, "ok", "2026-09-05T18:00:00.000Z");
  await consume(newest.event); await consume(older.event); await consume(newest.event);
  assert.deepEqual((await getListener(rule.id)).stats, { runCount: 2, errorCount: 1, lastRunAt: newest.stats.completedAt, lastStatus: "error", lastError: "deliberate failure", lastIssueKey: "LZPT-1" });
  assert.equal((await getListener(rule.id)).stats.lastRunAt, (await storage.get(newest.key)).timestamp);
});

for (const committed of [false, true]) await check(`transaction failure ${committed ? "after" : "before"} commit retries without loss or duplication`, async () => {
  const rule = seed("scheduledjob"); const { event, key } = await receipt("scheduledjob", rule, "error");
  const transact = storage.transact; let attempts = 0;
  storage.transact = () => {
    const transaction = transact(); const execute = transaction.execute;
    transaction.execute = async () => {
      attempts++;
      if (committed) await execute();
      throw new Error("ambiguous transaction transport failure");
    };
    return transaction;
  };
  try { assert.deepEqual(await consume(event), { _retry: true, retryOptions: { retryAfter: 30, retryReason: "FUNCTION_RETRY_REQUEST" } }); }
  finally { storage.transact = transact; }
  assert.equal(attempts, 1);
  assert.equal((await storage.get(key)).statsReceipt.applied, committed ? true : undefined);
  await consume(event); await consume(event);
  assert.equal((await getJob(rule.id)).stats.runCount, 1); assert.equal((await getJob(rule.id)).stats.errorCount, 1);
});

await check("ambiguous log write is not overwritten after recovery has counted it", async () => {
  const rule = seed("scheduledjob"); const set = storage.set; let intercepted = false;
  storage.set = async (key, value, options) => {
    const result = await set(key, value, options);
    if (!intercepted && value.statsReceipt) {
      intercepted = true;
      await processRuleStatsReceipt({ receiptKey: key, kind: "scheduledjob" });
      throw new Error("TIMEOUT after write");
    }
    return result;
  };
  try { await receipt("scheduledjob", rule); } finally { storage.set = set; }
  await drain();
  assert.equal((await getJob(rule.id)).stats.runCount, 1);
  assert.equal((await readLogs()).length, 1);
});

await check("enqueue failure is recovered by the actual tick on a listener-only site", async () => {
  const rule = seed("listener"); const push = Queue.prototype.push;
  Queue.prototype.push = async () => { throw new Error("queue unavailable"); };
  let key;
  try { ({ key } = await receipt("listener", rule)); } finally { Queue.prototype.push = push; }
  assert.ok(pendingRuleStats(await storage.get(key))); assert.equal(pushed.length, 0);
  await scheduledTick(); await drain();
  assert.equal((await getListener(rule.id)).stats.runCount, 1);
});

await check("recovery cursor progresses beyond 100 recent non-pending logs", async () => {
  const rule = seed("scheduledjob");
  for (let i = 0; i < 105; i++) storage.__seed(`log_entry:0000000000000_${String(i).padStart(3, "0")}`, { reason: "unrelated" });
  const { key } = await receipt("scheduledjob", rule); pushed.length = 0;
  const cursor = await recoverRuleStats(); assert.ok(cursor); assert.equal(pushed.length, 0);
  assert.equal(await recoverRuleStats(cursor), null); await drain();
  assert.equal((await storage.get(key)).statsReceipt.applied, true);
});

for (const kind of ["listener", "scheduledjob"]) for (const recreate of [false, true]) await check(`${kind} deletion racing completion${recreate ? " and recreation" : ""} preserves other rules`, async () => {
  const rule = seed(kind); const other = seed(kind, "untouched");
  const mapKey = kind === "listener" ? "listener_stats" : "job_stats";
  storage.__seed(mapKey, { [rule.id]: { runCount: 7, errorCount: 3, lastRunAt: "2026-08-01T00:00:00.000Z" }, [other.id]: { runCount: 11 } });
  const old = await receipt(kind, rule);
  await (kind === "listener" ? deleteListener : deleteJob)(rule.id);
  if (recreate) {
    const replacement = seed(kind, rule.id, "2026-09-05T17:59:00.000Z");
    assert.equal((await (kind === "listener" ? getListener : getJob)(rule.id)).stats.runCount, 0);
    const current = await receipt(kind, replacement, "error");
    // Deliberately process new receipt BEFORE the old cleanup/completion.
    await consume(current.event);
  }
  await consume(old.event); await drain();
  const map = await storage.get(mapKey);
  assert.equal(map[other.id].runCount, 11);
  if (recreate) { assert.equal(map[rule.id].runCount, 1); assert.equal(map[rule.id].errorCount, 1); }
  else assert.equal(map[rule.id], undefined);
  assert.ok((await readLogs()).every(entry => !entry.statsOnly));
});

for (const kind of ["listener", "scheduledjob"]) await check(`${kind} delete resolver leaves record, index and counters intact when receipt transaction fails`, async () => {
  const rule = seed(kind); const isListener = kind === "listener";
  const indexKey = isListener ? "listener_index" : "job_index";
  const mapKey = isListener ? "listener_stats" : "job_stats";
  const rows = [(isListener ? listenerRow : jobRow)(rule)];
  storage.__seed(indexKey, rows); storage.__seed(mapKey, { [rule.id]: { runCount: 2 } });
  if (isListener) await readListenerIndex(); // Populate the warm-container cache.
  const transact = storage.transact; const staged = [];
  storage.transact = () => {
    const transaction = transact(); const set = transaction.set;
    transaction.set = (key, value, entity, options) => { staged.push({ key, value, entity, options }); return set(key, value, entity, options); };
    transaction.execute = async () => {
      assert.ok(staged.some(operation => operation.value?.statsOnly));
      throw new Error("TOO_MANY_REQUESTS 429 for atomic cleanup receipt");
    };
    return transaction;
  };
  const request = { call: { functionKey: isListener ? "deleteListener" : "deleteScheduledJob", payload: { id: rule.id } } };
  const context = { principal: { accountId: "stats-test-admin" } };
  try {
    const result = await resolve(request, context);
    assert.equal(result.success, false); assert.match(result.error, /429/);
  } finally { storage.transact = transact; }
  assert.deepEqual(await storage.get((isListener ? "listener:" : "job:") + rule.id), rule);
  assert.deepEqual(await storage.get(indexKey), rows);
  assert.deepEqual(await storage.get(mapKey), { [rule.id]: { runCount: 2 } });
  assert.equal(pushed.length, 0);
  assert.equal((await storage.query().where("key", { condition: "BEGINS_WITH", values: ["log_entry:"] }).limit(100).getMany()).results.length, 0);
  if (isListener) assert.deepEqual(await readListenerIndex({ cached: true }), rows);
  assert.equal((await resolve(request, context)).success, true);
  assert.equal(await storage.get((isListener ? "listener:" : "job:") + rule.id), undefined);
  assert.deepEqual(await storage.get(indexKey), []);
  if (isListener) assert.deepEqual(await readListenerIndex({ cached: true }), []);
  await drain(); assert.equal((await storage.get(mapKey))[rule.id], undefined);
});

for (const kind of ["listener", "scheduledjob"]) await check(`${kind} committed deletion survives cleanup enqueue failure`, async () => {
  const rule = seed(kind); const isListener = kind === "listener";
  const mapKey = isListener ? "listener_stats" : "job_stats";
  storage.__seed(isListener ? "listener_index" : "job_index", [(isListener ? listenerRow : jobRow)(rule)]);
  storage.__seed(mapKey, { [rule.id]: { runCount: 2 } });
  const push = Queue.prototype.push;
  Queue.prototype.push = async () => { throw new Error("queue unavailable"); };
  try {
    assert.equal((await resolve({ call: { functionKey: isListener ? "deleteListener" : "deleteScheduledJob", payload: { id: rule.id } } }, { principal: { accountId: "stats-test-admin" } })).success, true);
  } finally { Queue.prototype.push = push; }
  assert.equal(await storage.get((isListener ? "listener:" : "job:") + rule.id), undefined);
  const rows = (await storage.query().where("key", { condition: "BEGINS_WITH", values: ["log_entry:"] }).limit(100).getMany()).results;
  assert.equal(rows.length, 1); assert.ok(pendingRuleStats(rows[0].value));
  assert.equal(rows[0].value.statsReceipt.remove, true);
  await recoverRuleStats(); await drain();
  assert.equal((await storage.get(mapKey))[rule.id], undefined);
});

await check("clearing a pending log atomically counts it and retains only hidden deduplication evidence", async () => {
  const rule = seed("listener"); const { key, event, stats } = await receipt("listener", rule);
  await enqueueRuleStats(key, stats, true); const clearEvent = pushed.at(-1);
  await consume(clearEvent); await consume(event); await consume(clearEvent);
  assert.deepEqual(await storage.get(key), { id: (await storage.get(key)).id, statsOnly: true, statsReceipt: { kind: "listener", applied: true } });
  assert.equal((await readLogs()).length, 0); assert.equal((await getListener(rule.id)).stats.runCount, 1);
});

for (const applyFirst of [false, true]) await check(`ambiguous log write survives repeated clears of ${applyFirst ? "applied" : "pending"} receipt`, async () => {
  const rule = seed("scheduledjob"); const set = storage.set; let intercepted = false; let receiptKey;
  storage.set = async (key, value, options) => {
    const result = await set(key, value, options);
    if (!intercepted && value.statsReceipt) {
      intercepted = true; receiptKey = key;
      if (applyFirst) await processRuleStatsReceipt({ receiptKey: key, kind: "scheduledjob" });
      for (let i = 0; i < 2; i++) {
        assert.deepEqual(await resolve({ call: { functionKey: "clearLogs" } }, { principal: { accountId: "stats-test-admin" } }), { success: true });
        await drain();
      }
      assert.equal((await readLogs()).length, 0);
      assert.equal((await getJob(rule.id)).stats.runCount, 1);
      assert.deepEqual(await storage.get(key), { id: value.id, statsOnly: true, statsReceipt: { kind: "scheduledjob", applied: true } });
      throw new Error("TIMEOUT after log write committed");
    }
    return result;
  };
  try { await receipt("scheduledjob", rule); } finally { storage.set = set; }
  await drain();
  assert.equal((await getJob(rule.id)).stats.runCount, 1);
  assert.equal((await readLogs()).length, 0);
  assert.equal((await storage.get(receiptKey)).statsOnly, true);
});

await check("clearLogs pages past pending receipts without discarding their counts", async () => {
  const rule = seed("listener");
  const { key, event } = await receipt("listener", rule);
  for (let i = 0; i < 105; i++) storage.__seed(`log_entry:0000000000000_${String(i).padStart(3, "0")}`, { reason: "unrelated" });
  const result = await resolve({ call: { functionKey: "clearLogs" } }, { principal: { accountId: "stats-test-admin" } });
  assert.deepEqual(result, { success: true });
  assert.ok(pendingRuleStats(await storage.get(key)));
  await drain(); await consume(event);
  assert.equal((await readLogs()).length, 0);
  assert.equal((await getListener(rule.id)).stats.runCount, 1);
});

await check("pruning preserves old pending receipts and delayed deliveries after pruning never recount", async () => {
  const rule = seed("scheduledjob"); const { key, event } = await receipt("scheduledjob", rule);
  // Move the pending receipt to a key older than the one-hour prune cutoff.
  const ancient = `log_entry:${String(1e13 - Date.now() + 7200000).padStart(13, "0")}_pending`;
  storage.__seed(ancient, await storage.get(key)); await storage.delete(key);
  for (let i = 0; i < 70; i++) storage.__seed(`log_entry:0000000000000_${String(i).padStart(3, "0")}`, { reason: "unrelated" });
  const random = Math.random; Math.random = () => 0.01;
  try { await storeLog({ type: "validation", reason: "force prune" }); } finally { Math.random = random; }
  assert.ok(pendingRuleStats(await storage.get(ancient)));
  const pendingEvent = { ...event, body: { ...event.body, params: { ...event.body.params, receiptKey: ancient } } };
  await consume(pendingEvent);
  Math.random = () => 0.01;
  try { await storeLog({ type: "validation", reason: "force prune applied receipt" }); } finally { Math.random = random; }
  assert.equal(await storage.get(ancient), undefined);
  await consume(pendingEvent);
  assert.equal((await getJob(rule.id)).stats.runCount, 1);
});

await check("legacy counters carry forward for the existing generation", async () => {
  const rule = seed("scheduledjob");
  storage.__seed("job_stats", { [rule.id]: { runCount: 100, errorCount: 4, lastRunAt: "2026-08-01T00:00:00.000Z" } });
  await receipt("scheduledjob", rule, "error"); await drain();
  assert.equal((await getJob(rule.id)).stats.runCount, 101); assert.equal((await getJob(rule.id)).stats.errorCount, 5);
});

await check("receipt applies outside cancellation and staleness bookkeeping", async () => {
  const rule = seed("listener"); const { key, event } = await receipt("listener", rule);
  storage.__seed(`async_job:${key}`, { cancelled: true, enqueuedAt: "2020-01-01T00:00:00.000Z" });
  await consume(event);
  assert.equal((await getListener(rule.id)).stats.runCount, 1); assert.equal(await storage.get(`async_task:${key}`), undefined);
  assert.equal((await storage.get(`async_job:${key}`)).enqueuedAt, "2020-01-01T00:00:00.000Z");
});

await check("installed KVS transaction builder puts TTL in options, not custom entity", async () => {
  const require = createRequire(import.meta.url);
  const { TransactionBuilderImpl } = require("../../node_modules/@forge/kvs/out/transaction-api.js");
  const transact = storage.transact; let request;
  storage.transact = () => new TransactionBuilderImpl({ transact: async value => { request = value; } });
  try {
    const rule = seed("scheduledjob"); const { event } = await receipt("scheduledjob", rule); await consume(event);
    const logSet = request.set.find(operation => operation.key.startsWith("log_entry:"));
    assert.deepEqual(logSet.options, { ttl: { value: 30, unit: "DAYS" } }); assert.equal(logSet.entityName, undefined);
    assert.equal(request.set.length, 2);
  } finally { storage.transact = transact; }
});

await check("installed KVS transaction builder stages rule/index/cleanup deletion together", async () => {
  const require = createRequire(import.meta.url);
  const { TransactionBuilderImpl } = require("../../node_modules/@forge/kvs/out/transaction-api.js");
  const transact = storage.transact;
  try {
    for (const kind of ["listener", "scheduledjob"]) {
      const rule = seed(kind); let request;
      storage.transact = () => new TransactionBuilderImpl({ transact: async value => { request = value; } });
      await (kind === "listener" ? deleteListener : deleteJob)(rule.id);
      assert.equal(request.set.length, 2); assert.equal(request.delete.length, 1);
      assert.equal(request.delete[0].key, (kind === "listener" ? "listener:" : "job:") + rule.id);
      assert.deepEqual(request.set.find(operation => operation.key === (kind === "listener" ? "listener_index" : "job_index")).value, []);
      const receiptSet = request.set.find(operation => operation.value?.statsOnly);
      assert.equal(receiptSet.value.statsReceipt.remove, true);
      assert.deepEqual(receiptSet.options, { ttl: { value: 30, unit: "DAYS" } }); assert.equal(receiptSet.entityName, undefined);
      assert.ok(!request.set.some(operation => operation.key.endsWith("_stats")));
    }
  } finally { storage.transact = transact; }
});

console.log(`Rule statistics: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
