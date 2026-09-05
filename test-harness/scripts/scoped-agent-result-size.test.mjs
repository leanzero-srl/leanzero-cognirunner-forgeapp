/* CogniRunner - Copyright (C) 2025 LeanZero. SPDX-License-Identifier: AGPL-3.0-or-later */
// Actual runJob, storeLog and async result persistence; only AI output/Jira/KVS
// transport are mocked. Enforce Forge's real 240KiB value limit in the transport.
import "../lib/register-mocks-index.mjs";
import { register } from "node:module";
import assert from "node:assert/strict";
import storage from "../lib/mock-kvs.mjs";
import jira from "../lib/mock-forge-api.mjs";
register("data:text/javascript," + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === "./agent-runner.js" && String(ctx.parentURL || "").endsWith("/src/scheduled-jobs.js")) return {url:"scoped-size:agent",shortCircuit:true};
  return next(spec,ctx);
}
export async function load(url,ctx,next) {
  if(url === "scoped-size:agent") return {format:"module",shortCircuit:true,source:"export const runAgentTask = async () => globalThis.__scopedSizeAgent();"};
  return next(url,ctx);
}`));
const { handler } = await import("../../src/async-handler.js");
const { normalizeJob } = await import("../../src/scheduled-jobs.js");
const bytes = value => Buffer.byteLength(JSON.stringify(value), "utf8");
const originalSet = storage.set;
let rejected = [], logKeys = [];
storage.set = async (key, value, options) => {
  const size = bytes(value);
  if (size > 240 * 1024) { rejected.push({ key, size }); throw new Error(`KVS value exceeds 240KiB: ${size}`); }
  if (key.startsWith("log_entry:")) logKeys.push(key);
  return originalSet(key, value, options);
};
try {
  for (const [label, text, largeChanges] of [["CJK", "界".repeat(1200)], ["astral", "🌍".repeat(600)], ["CJK controls", ("界" + String.fromCharCode(0)).repeat(600)], ["lone surrogates", String.fromCharCode(0xd800).repeat(1200)], ["mixed and JSON escaping", '界🌍"\\'.repeat(240)], ["oversized change details", "x".repeat(1200), true]]) {
    storage.__reset(); rejected = []; logKeys = [];
    globalThis.__scopedSizeAgent = () => ({ success: true, outcome: "done", summary: text, logs: [text], changes: largeChanges ? [{ action: "updateIssue", fields: { description: "界".repeat(5000) } }] : [] });
    const issues = Array.from({ length: 100 }, (_, i) => ({ key: `LZPT-${i + 1}`, fields: { summary: `Scoped issue ${i + 1}` } }));
    jira.__respond((_path, options) => {
      const second = JSON.parse(options.body).nextPageToken === "next";
      return jira.__response(200, { issues: issues.slice(second ? 50 : 0, second ? 100 : 50), ...(second ? {} : { nextPageToken: "next" }) });
    });
    const job = normalizeJob({ id: "size-job", name: "Scoped size", schedule: { cron: "*/5 * * * *", timeZone: "UTC" }, scope: { jql: "project = LZPT", maxIssues: 100 }, mode: "agent", agent: { instructions: "Read each issue" } });
    storage.__seed("job:size-job", job);
    await handler({ body: { taskType: "scheduledjob", taskId: `size-${label}`, params: { jobId: job.id, manual: true } } });
    assert.deepEqual(rejected, [], `${label}: persistence must not hit size rejection`);
    assert.equal(logKeys.length, 1, "the actual storeLog must persist the completed run");
    const log = storage.__raw(logKeys[0]);
    const task = storage.__raw(`async_task:size-${label}`);
    assert.equal(task.status, "done"); assert.equal(task.result.success, true); assert.equal(log.isValid, true);
    assert.equal(log.perIssue.length, 100); assert.equal(task.result.issues.length, 100);
    assert.deepEqual(log.perIssue.map(i => i.key), issues.map(i => i.key));
    assert.deepEqual(task.result.issues, log.perIssue);
    assert.deepEqual(task.result.logs, log.logs); assert.deepEqual(task.result.changes, log.changes);
    if (/controls|surrogates|oversized/.test(label)) assert.match(log.reason, /Display details truncated/);
    else assert.doesNotMatch(log.reason, /Display details truncated/);
    if (largeChanges) { assert.ok(log.changes.length < 30); assert.match(log.logs.at(-1), /change detail record\(s\) omitted/); }
    for (const issue of log.perIssue) {
      assert.equal(issue.agentOutcome, "done"); assert.equal(issue.success, true);
      assert.match(issue.agentSummary, /\[truncated\]$/);
      assert.ok(bytes(issue.agentSummary) <= 240);
      assert.ok(!/\uFFFD/.test(issue.agentSummary), "no split surrogate pairs");
    }
    assert.ok(bytes(log) <= 220 * 1024); assert.ok(bytes(task) <= 220 * 1024);
    console.log(`scoped agent size ${label}: 100 outcomes persisted, log=${bytes(log)}, task=${bytes(task)} bytes`);
  }
} finally { storage.set = originalSet; }
