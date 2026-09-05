/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Actual listener/job modules, mocked platform and sandbox boundary only.
// Run: node --import ./lib/register-mocks.mjs scripts/rules-runtime-regression.test.mjs
import { register } from "node:module";
import assert from "node:assert/strict";
import storage from "../lib/mock-kvs.mjs";
import forgeApi, { pushed } from "../lib/mock-forge-api.mjs";
import { normalizeListener, testListener, executeListenerTask } from "../../src/listeners.js";
import { normalizeJob, runJob, executeScheduledJobTask, scheduledTick } from "../../src/scheduled-jobs.js";
import { testStateTrigger } from "../../src/test-hook.js";

register("data:text/javascript," + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (["/src/listeners.js", "/src/scheduled-jobs.js"].some(p => String(ctx.parentURL || "").endsWith(p))) {
    if (spec === "./index.js") return { url: "cogni-runtime:index", shortCircuit: true };
    if (spec === "./agent-runner.js") return { url: "cogni-runtime:agent", shortCircuit: true };
  }
  return next(spec, ctx);
}
export async function load(url, ctx, next) {
  if (url === "cogni-runtime:index") return { format: "module", shortCircuit: true, source: \
    "export const runSandboxSteps = async (args) => globalThis.__rulesRuntime.sandbox(args); export const storeLog = async (entry) => globalThis.__rulesRuntime.logs.push(entry); export const isJobCancelled = async () => globalThis.__rulesRuntime.cancel(); export const makeTaskId = () => 'queued-' + (++globalThis.__rulesRuntime.taskSeq); export const writeAsyncJob = async () => {};" };
  if (url === "cogni-runtime:agent") return { format: "module", shortCircuit: true, source: \
    "export const runAgentTask = async (args) => globalThis.__rulesRuntime.agent(args); export const evaluateAiCondition = async (args) => globalThis.__rulesRuntime.gate(args);" };
  return next(url, ctx);
}`));

let passed = 0; let failed = 0;
const check = async (name, fn) => {
  try { await fn(); passed++; }
  catch (e) { failed++; console.error(`FAIL ${name}: ${e.message}`); }
};
const ISSUE = { id: "200", key: "LZPT-2", fields: { summary: "Selected issue", project: { id: "10", key: "LZPT" }, issuetype: { id: "2", name: "Bug" }, comment: { comments: [{ id: "new-comment", body: "urgent request" }] } } };
const UPDATE = "avi:jira:updated:issue";
const COMMENT = "avi:jira:commented:issue";
const SPRINT = "avi:jira-software:started:sprint";
const reset = ({ jqlMatch = true, jqlStatus = 200 } = {}) => {
  storage.__reset(); forgeApi.__reset(); pushed.length = 0;
  const state = globalThis.__rulesRuntime = {
    runs: [], logs: [], gates: [], taskSeq: 0, cancel: () => false,
    sandbox(args) { this.runs.push(args); return { success: true, stepsTotal: 1, changes: [{ simulated: true, value: args.issueKey }], logs: [], stepResults: [] }; },
    agent(args) { this.runs.push(args); return { success: true, outcome: "finished", summary: "simulated", changes: [], logs: [] }; },
    gate(args) { this.gates.push(args); return { match: true, reason: "matched" }; },
  };
  forgeApi.__respond((path) => {
    if (path.startsWith("/rest/api/3/issue/")) return forgeApi.__response(200, ISSUE);
    if (path === "/rest/api/3/search/jql") return forgeApi.__response(jqlStatus, { issues: jqlMatch ? [ISSUE] : [] });
    if (path.startsWith("/rest/api/3/project/")) return forgeApi.__response(200, { key: "LZPT" });
    throw new Error(`Unexpected Jira read: ${path}`);
  });
  return state;
};
const listener = (filters = {}, over = {}) => normalizeListener({ name: "Dry run", events: [UPDATE], filters, functions: [{ code: "api.log(1)" }], ...over });
const dryRun = (config, extra = {}) => testListener({ listener: config, issueKey: ISSUE.key, ...extra });

for (const [name, filters, events] of [
  ["project mismatch", { projectKeys: ["OTHER"] }, [UPDATE]],
  ["issue type mismatch", { issueTypes: ["Task"] }, [UPDATE]],
  ["changed field mismatch", { changedFields: ["priority"] }, [UPDATE]],
  ["comment mismatch", { commentPattern: "^refund" }, [COMMENT]],
]) await check(name, async () => {
  const state = reset(); const result = await dryRun(listener(filters, { events, aiCondition: "Needs attention" }));
  assert.equal(result.skipped, true); assert.equal(result.decision, "SKIP");
  assert.match(result.reason, /Filtered out/); assert.equal(state.runs.length, 0); assert.equal(state.gates.length, 0);
  assert.equal(state.logs.length, 1); assert.equal(state.logs[0].testRun, true);
});
await check("JQL mismatch", async () => {
  const state = reset({ jqlMatch: false }); const result = await dryRun(listener({ jql: "priority = Highest" }));
  assert.equal(result.skipped, true); assert.equal(result.decision, "SKIP"); assert.equal(state.runs.length, 0);
  assert.equal(JSON.parse(forgeApi.__calls.find(c => c.path.endsWith("/search/jql")).opts.body).jql, "key = LZPT-2 AND (priority = Highest)");
});
await check("JQL error fails closed", async () => {
  const state = reset({ jqlStatus: 400 }); const result = await dryRun(listener({ jql: "bad query" }));
  assert.equal(result.skipped, true); assert.equal(result.isValid, false); assert.match(result.reason, /JQL filter could not be evaluated/); assert.equal(state.runs.length, 0);
});
await check("disabled draft still tests matching filters in simulation", async () => {
  const state = reset(); const config = listener({ projectKeys: ["LZPT"], issueTypes: ["Bug"], changedFields: ["summary"], jql: "priority = Highest" }, { enabled: false });
  const result = await dryRun(config);
  assert.equal(result.isValid, true); assert.equal(result.skipped, false); assert.equal(state.runs.length, 1);
  assert.equal(state.runs[0].config.simulationMode, true); assert.equal(state.runs[0].extraContext.event.selfGenerated, false); assert.equal(config.enabled, false);
  assert.match(result.testNote, /summary-only/); assert.match(result.testNote, /disabled draft/);
});
await check("nonissue event does not inherit an unrelated selected issue", async () => {
  const state = reset(); const result = await dryRun(listener({}, { events: [SPRINT] }), { syntheticEvent: { sprint: { name: "Sprint 1" } } });
  assert.equal(result.isValid, true); assert.equal(state.runs[0].issueKey, null); assert.equal(forgeApi.__calls.length, 0);
});
await check("nonissue JQL visibly skips even with a selected issue", async () => {
  const state = reset(); const result = await dryRun(listener({ jql: "project = LZPT" }, { events: [SPRINT] }), { syntheticEvent: { sprint: { name: "Sprint 1" } } });
  assert.equal(result.skipped, true); assert.match(result.reason, /JQL filter needs an issue/); assert.equal(state.runs.length, 0);
});
await check("id-only worklog resolves matching context", async () => {
  const state = reset(); const result = await dryRun(listener({ projectKeys: ["LZPT"], jql: "priority = Highest" }, { events: ["avi:jira:created:worklog"] }), { issueKey: null, syntheticEvent: { worklog: { id: "55", issueId: ISSUE.id } } });
  assert.equal(result.isValid, true); assert.equal(state.runs[0].issueKey, ISSUE.key);
});
await check("id-only project context resolves before static matching", async () => {
  const state = reset(); const result = await dryRun(listener({ projectKeys: ["OTHER"] }, { events: ["avi:jira:created:version"] }), { issueKey: null, syntheticEvent: { version: { projectId: "10", name: "v1" } } });
  assert.equal(result.skipped, true); assert.match(result.reason, /project LZPT not in filter/); assert.equal(state.runs.length, 0);
});
await check("sample from another issue cannot supply the selected issue's comment", async () => {
  const state = reset(); storage.__seed(`event_sample:${COMMENT}`, { payload: { issue: { id: "100", key: "OLD-1" }, comment: { id: "old-comment", issueId: "100", body: "refund" } } });
  const result = await dryRun(listener({ commentPattern: "urgent" }, { events: [COMMENT] }));
  assert.equal(result.isValid, true); assert.equal(result.skipped, false);
  assert.equal(state.runs[0].extraContext.event.comment.id, "new-comment"); assert.equal(result.eventUsed, "synthetic");
  assert.match(result.testNote, /latest returned comment/);
});
await check("provided issue-link payload rebinds only source identity without mutating input", async () => {
  const state = reset(); const provided = { issueLink: { sourceIssueId: "100", sourceProjectId: "20", destinationIssueId: "300" }, issueKey: "OLD-1", selfGenerated: true };
  const result = await dryRun(listener({ projectKeys: ["LZPT"] }, { events: ["avi:jira:created:issuelink"] }), { syntheticEvent: provided });
  assert.equal(result.isValid, true); assert.equal(result.eventUsed, "provided");
  const event = state.runs[0].extraContext.event;
  assert.equal(event.issueLink.sourceIssueId, ISSUE.id); assert.equal(event.issueLink.sourceProjectId, "10"); assert.equal(event.issueLink.destinationIssueId, "300"); assert.equal(event.issueKey, ISSUE.key);
  assert.equal(provided.issueLink.sourceIssueId, "100"); assert.equal(provided.selfGenerated, true);
});
await check("sample nonissue event keeps no issue and carries redaction limits", async () => {
  const state = reset(); storage.__seed(`event_sample:${SPRINT}`, { payload: { sprint: { name: "Sprint sample" } } });
  const result = await dryRun(listener({}, { events: [SPRINT] }));
  assert.equal(result.isValid, true); assert.equal(result.eventUsed, "sample"); assert.match(result.testNote, /redacted text/);
  assert.equal(state.runs[0].issueKey, null); assert.equal(state.runs[0].extraContext.event.issue, undefined);
});
await check("agent filter miss prevents both AI gate and agent actions", async () => {
  const state = reset(); const result = await dryRun(listener({ projectKeys: ["OTHER"] }, { mode: "agent", agent: { instructions: "Read the issue" }, aiCondition: "Needs attention" }));
  assert.equal(result.skipped, true); assert.equal(state.runs.length, 0); assert.equal(state.gates.length, 0);
});

const job = (mode = "script") => normalizeJob({ name: "Scoped job", schedule: { cron: "*/5 * * * *" }, scope: { jql: "project = LZPT", maxIssues: 3 }, mode, agent: { instructions: "Read each issue" }, functions: [{ code: "api.log(1)" }] });
const scope = [ISSUE, { ...ISSUE, key: "LZPT-3" }, { ...ISSUE, key: "LZPT-4" }];
for (const mode of ["script", "agent"]) for (const completed of [0, 1]) await check(`${mode} cancellation after ${completed} issues`, async () => {
  const state = reset(); state.cancel = () => state.runs.length >= completed;
  forgeApi.__respond(() => forgeApi.__response(200, { issues: scope }));
  const result = await runJob({ job: job(mode), cancelToken: "cancel-token" });
  assert.equal(result.success, false); assert.equal(result.log.isValid, false); assert.equal(state.runs.length, completed);
  assert.equal(result.issues.length, scope.length); assert.match(result.log.reason, new RegExp(`^${completed}/3 issue`)); assert.match(result.log.reason, /cancelled/);
  assert.equal(result.issues.filter(i => i.success).length, completed);
  assert.ok(result.issues.slice(completed).every(i => !i.success && /cancelled/.test(i.reason)));
  assert.equal(result.log.changes.length, mode === "script" ? completed : 0);
});
await check("normal scoped completion", async () => {
  const state = reset(); forgeApi.__respond(() => forgeApi.__response(200, { issues: scope }));
  const result = await runJob({ job: job(), cancelToken: "not-cancelled" });
  assert.equal(result.success, true); assert.match(result.log.reason, /^3\/3 issue/); assert.equal(state.runs.length, 3);
});
await check("empty scope remains successful and does no work", async () => {
  const state = reset(); forgeApi.__respond(() => forgeApi.__response(200, { issues: [] }));
  const result = await runJob({ job: job(), cancelToken: "not-cancelled" });
  assert.equal(result.success, true); assert.match(result.log.reason, /^0\/0 issue/); assert.equal(state.runs.length, 0);
});
await check("exhausted scoped budget lists every unfinished issue", async () => {
  const state = reset(); forgeApi.__respond(() => forgeApi.__response(200, { issues: scope }));
  const result = await runJob({ job: job(), deadline: Date.now() + 1000 });
  assert.equal(result.success, false); assert.match(result.log.reason, /^0\/3 issue/); assert.equal(state.runs.length, 0);
  assert.equal(result.issues.length, 3); assert.ok(result.issues.every(i => !i.success && /time budget/.test(i.reason)));
});
await check("failed step and prior writes remain represented when next issue is cancelled", async () => {
  const state = reset(); state.cancel = () => state.runs.length === 1;
  state.sandbox = (args) => { state.runs.push(args); return { success: false, failedStep: "Step 2", changes: [{ simulated: true }], logs: ["partial write"], stepResults: [{ status: "error", error: "failed after write" }] }; };
  forgeApi.__respond(() => forgeApi.__response(200, { issues: scope }));
  const result = await runJob({ job: job(), cancelToken: "cancel-token" });
  assert.equal(result.success, false); assert.match(result.log.reason, /^0\/3 issue/); assert.match(result.log.reason, /1 failed, 2 cancelled/);
  assert.equal(result.issues.length, 3); assert.match(result.issues[0].reason, /failed after write/); assert.equal(result.log.changes.length, 1);
});
// Duplicate consumers must be suppressed before either the AI gate or sandbox
// starts. Promise.all overlaps the actual entrypoints, not a claim-only stand-in.
console.log(`RULES RUNTIME REGRESSION: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
