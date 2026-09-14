/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Actual listener/job modules, mocked platform and sandbox boundary only.
// Run: node --import ./lib/register-mocks.mjs scripts/rules-runtime-regression.test.mjs
// F-467: self-arranging mocks — must precede every src/ import (see lib/ensure-mocks.mjs).
import "../lib/ensure-mocks.mjs";
import { register } from "node:module";
import assert from "node:assert/strict";
import storage from "../lib/mock-kvs.mjs";
import forgeApi, { pushed } from "../lib/mock-forge-api.mjs";
import { normalizeListener, testListener, executeListenerTask, matchListenerStatic, listenerTrigger, readListenerIndex, toIndexRow } from "../../src/listeners.js";
import { normalizeJob, runJob, executeScheduledJobTask, scheduledTick } from "../../src/scheduled-jobs.js";
import { JIRA_EVENTS } from "../../src/shared/jira-events.js";
// F-842 — the SHIPPED gate predicate and context builder; this suite never re-implements
// either, it only asks them what the run's gate allows.
import { buildAgentGateContext, normalizeAllowedActions, toolDefinitionsFor } from "../../src/shared/agent-actions.js";
import { readFileSync, readdirSync } from "node:fs";
import { testStateTrigger } from "../../src/test-hook.js";
// F-770 — the platform's key predicate, imported from its ONE home so these checks
// assert the same rule the door now asks rather than a retyped copy of it.
import { isKvsKey } from "../../src/shared/kvs-keys.js";
// F-769 — the credential census, imported from its ONE home so these checks ask the same
// predicate the read ceiling asks rather than a retyped list of prefixes.
import { isCredentialKey } from "../../src/test-hook.js";

import { maskComments, maskNonCode } from "../lib/js-source-scan.mjs";
/* F-137 / F-805 — "a comment is allowed to NAME a slot; code is not" is the rule these
   gates enforce, and this file used to answer "which bytes are code?" with a FOURTH private
   scanner. It knew nothing of `${…}` holes and it read the quotes inside a regex body as
   string openers — the same fault that stranded maskComments on src/virtual-admin.js. The
   shared mask is the one home for the question, and it preserves LENGTH, so every slice and
   indexOf below still indexes the same bytes. */
const stripJsComments = maskComments;

// F-137 — the backend modules this gate covers are DERIVED from the tree, not hand-typed.
// A hand-typed list silently stops covering the next module somebody adds (which is exactly
// how the consumer's retyped slot names survived: the gate only looked at index.js).
// `src/shared/*` is excluded on purpose — it is the HOME of the slot names.
const backendModules = () => readdirSync(new URL("../../src/", import.meta.url))
  .filter((f) => f.endsWith(".js")).sort();


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
const dueAt = "2026-09-05T09:00:00.000Z";
const claimFixture = (kind) => {
  const state = reset();
  if (kind === "listener") {
    const config = listener({}, { id: "claim-listener", aiCondition: "Needs attention" });
    storage.__seed(`listener:${config.id}`, config);
    return { state, key: "lst_exec:claim-task", invoke: (taskId = "claim-task") => executeListenerTask({ listenerId: config.id, eventType: UPDATE, event: { issue: ISSUE }, ctx: { issueKey: ISSUE.key } }, taskId) };
  }
  const config = normalizeJob({ ...job(), id: "claim-job", scope: null });
  storage.__seed(`job:${config.id}`, config);
  const manual = kind === "manual";
  return { state, key: manual ? "job_exec:claim-job:manual:claim-task" : `job_exec:claim-job:${dueAt}`, invoke: (taskId = "claim-task", scheduledFor = dueAt, jobId = config.id) => executeScheduledJobTask({ jobId, manual, scheduledFor }, taskId), config };
};
for (const kind of ["listener", "manual", "scheduled"]) {
  await check(`${kind} concurrent identical delivery runs once`, async () => {
    const { state, invoke, key } = claimFixture(kind);
    const results = await Promise.all([invoke(), invoke()]);
    assert.equal(state.runs.length, 1); assert.equal(state.logs.length, 1);
    assert.equal(results.filter(r => r.reason === "duplicate delivery" && r.skipped).length, 1);
    assert.equal(results.filter(r => r.success).length, 1);
    assert.equal(state.gates.length, kind === "listener" ? 1 : 0);
    assert.ok(storage.__raw(key)?.at);
  });
  await check(`${kind} existing claim prevents gate and writes`, async () => {
    const { state, invoke, key } = claimFixture(kind);
    storage.__seed(key, { at: dueAt });
    const result = await invoke();
    assert.equal(result.reason, "duplicate delivery"); assert.equal(result.skipped, true);
    assert.equal(state.runs.length, 0); assert.equal(state.gates.length, 0); assert.equal(state.logs.length, 0);
    assert.deepEqual(storage.__raw(key), { at: dueAt });
  });
  await check(`${kind} distinct execution identities both run`, async () => {
    const { state, invoke } = claimFixture(kind);
    const results = kind === "scheduled"
      ? await Promise.all([invoke("first", dueAt), invoke("second", "2026-09-05T09:05:00.000Z")])
      : await Promise.all([invoke("first"), invoke("second")]);
    assert.equal(state.runs.length, 2); assert.ok(results.every(r => r.success));
  });
  for (const [label, error] of [
    ["code", Object.assign(new Error("conflict"), { code: "KEY_ALREADY_EXISTS" })],
    ["HTTP 409", Object.assign(new Error("conflict"), { responseDetails: { status: 409 } })],
    ["message", new Error("Key already exists")],
    ["infrastructure", Object.assign(new Error("service temporarily unavailable"), { code: "SERVICE_UNAVAILABLE" })],
  ]) await check(`${kind} claim ${label} preserves failure policy and TTL`, async () => {
    const { state, invoke, key } = claimFixture(kind);
    const originalSet = storage.set; const originalWarn = console.warn; const warnings = []; const optionsSeen = [];
    storage.set = async (k, value, options) => { if (k === key) { optionsSeen.push(options); throw error; } return originalSet(k, value, options); };
    console.warn = (...args) => warnings.push(args.join(" "));
    try {
      const result = await invoke();
      assert.deepEqual(optionsSeen, [{ keyPolicy: "FAIL_IF_EXISTS", ttl: { value: 2, unit: "HOURS" } }]);
      const infrastructure = label === "infrastructure";
      assert.equal(state.runs.length, infrastructure ? 1 : 0);
      assert.equal(warnings.length, infrastructure ? 1 : 0);
      if (infrastructure) { assert.equal(result.success, true); assert.match(warnings[0], /claim failed \(continuing\)/); }
      else { assert.equal(result.skipped, true); assert.equal(result.reason, "duplicate delivery"); }
    } finally { storage.set = originalSet; console.warn = originalWarn; }
  });
}
await check("different scheduled tasks for the same job and due minute run once", async () => {
  const { state, invoke } = claimFixture("scheduled");
  const results = await Promise.all([invoke("first"), invoke("second")]);
  assert.equal(state.runs.length, 1); assert.equal(results.filter(r => r.skipped).length, 1);
});
await check("different jobs due in the same minute both run", async () => {
  const { state, invoke, config } = claimFixture("scheduled");
  storage.__seed("job:another-job", { ...config, id: "another-job" });
  const results = await Promise.all([invoke(), invoke("second", dueAt, "another-job")]);
  assert.equal(state.runs.length, 2); assert.ok(results.every(r => r.success));
});
const tickFixture = () => {
  const state = reset();
  const config = normalizeJob({ ...job(), id: "claim-tick", scope: null, schedule: { cron: "* * * * *", timeZone: "UTC" } });
  storage.__seed(`job:${config.id}`, config); storage.__seed("job_index", [config]);
  storage.__seed("job_sched", { [config.id]: { lastCheckedAt: new Date(Date.now() - 120000).toISOString() } });
  return { state, config };
};
await check("concurrent scheduled ticks queue a due job once", async () => {
  tickFixture();
  await Promise.all([scheduledTick(), scheduledTick()]);
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].body.params.jobId, "claim-tick");
});
// A failing stats-recovery page must never become permanent: the cursor is opaque,
// it is held across tick boundaries, and it is the likeliest cause of the failure.
await check("a failing stats recovery drops its cursor instead of replaying it forever", async () => {
  tickFixture();
  storage.__seed("job_sched", { ...(storage.__raw("job_sched") || {}), ":statsRecovery": { cursor: "poisoned-cursor" } });
  const originalQuery = storage.query; const originalWarn = console.warn; const originalError = console.error;
  const seen = []; const said = [];
  storage.query = () => { const q = originalQuery.call(storage); const getMany = q.getMany; q.getMany = async () => { seen.push("query"); throw new Error("invalid cursor"); }; q.cursor = (c) => { seen.push(c); return q; }; return q; };
  console.warn = (...a) => said.push(a.join(" ")); console.error = (...a) => said.push(a.join(" "));
  try {
    await scheduledTick();
    assert.deepEqual(seen, ["poisoned-cursor", "query"], "the first tick uses the stored cursor");
    assert.equal(storage.__raw("job_sched")[":statsRecovery"].cursor, null, "and drops it when the page fails");
    assert.equal(storage.__raw("job_sched")[":statsRecovery"].fails, 1);
    assert.ok(said.some((l) => l.includes("cursor dropped")), "the drop is logged");
    seen.length = 0;
    await scheduledTick();
    assert.deepEqual(seen, ["query"], "the next tick restarts from the first page, it does not replay the cursor");
    assert.equal(storage.__raw("job_sched")[":statsRecovery"].fails, 2, "consecutive failures are counted, not silent");
    await scheduledTick();
    assert.ok(said.some((l) => l.includes("recovery failed 3x")), "a permanently failing page becomes loud");
  } finally { storage.query = originalQuery; console.warn = originalWarn; console.error = originalError; }
  // The tick's own work is unaffected by a broken recovery: the due job is queued
  // (once — the three ticks share a due minute, so the claim collapses them).
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].body.params.jobId, "claim-tick");
});
await check("scheduled tick preserves 2h atomic options and infrastructure continue", async () => {
  tickFixture();
  const originalSet = storage.set; const originalWarn = console.warn; const warnings = []; const optionsSeen = [];
  storage.set = async (key, value, options) => { if (key.startsWith("job_claim:")) { optionsSeen.push(options); throw new Error("service unavailable"); } return originalSet(key, value, options); };
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    await scheduledTick(); assert.equal(pushed.length, 1);
    assert.deepEqual(optionsSeen, [{ keyPolicy: "FAIL_IF_EXISTS", ttl: { value: 2, unit: "HOURS" } }]);
    assert.equal(warnings.length, 1); assert.match(warnings[0], /claim failed \(continuing\)/);
  } finally { storage.set = originalSet; console.warn = originalWarn; }
});
const previousSecret = process.env.HARNESS_SECRET;
const probeBody = { action: "probeRuleDelivery", taskType: "listener", ruleId: "claim-listener", taskId: "harness-claim-offline", issueKey: ISSUE.key };
const probe = (body = probeBody, authorization = "Bearer offline-claim-secret") => testStateTrigger({ method: "POST", headers: { authorization: [authorization] }, body: JSON.stringify(body) });
try {
  delete process.env.HARNESS_SECRET;
  await check("claim probe is absent without configured secret", async () => { assert.equal((await probe()).statusCode, 404); });
  process.env.HARNESS_SECRET = "offline-claim-secret";
  await check("claim probe rejects missing or incorrect authentication", async () => {
    assert.equal((await probe(probeBody, "")).statusCode, 404);
    assert.equal((await probe(probeBody, "Bearer wrong-secret")).statusCode, 404);
  });
  for (const patch of [
    { taskType: "index" }, { ruleId: "../bad" }, { taskId: "arbitrary-task" }, { secondTaskId: "arbitrary-task" },
    { issueKey: "LZPT-2/../../" }, { manual: "false" },
    { taskType: "scheduledjob", manual: false },
    { taskType: "scheduledjob", manual: false, scheduledFor: "2026-02-30T09:00:00.000Z" },
    { taskType: "scheduledjob", ruleId: "r".repeat(80), taskId: "harness-claim-" + "t".repeat(60) },
  ]) await check(`claim probe rejects invalid input ${JSON.stringify(patch)}`, async () => {
    const state = reset(); const response = await probe({ ...probeBody, ...patch });
    assert.equal(response.statusCode, 400); assert.equal(state.runs.length, 0); assert.equal(forgeApi.__calls.length, 0);
  });
  await check("claim probe refuses non-harness rule names", async () => {
    const { state } = claimFixture("listener");
    assert.equal((await probe()).statusCode, 400); assert.equal(state.runs.length, 0);
  });
  await check("claim probe refuses agent fixtures", async () => {
    const { state } = claimFixture("listener");
    const config = storage.__raw("listener:claim-listener"); config.name = "[Harness claim] agent"; config.mode = "agent";
    assert.equal((await probe()).statusCode, 400); assert.equal(state.runs.length, 0);
  });
  for (const kind of ["listener", "manual", "scheduled"]) await check(`${kind} claim probe invokes real consumer pair once`, async () => {
    const { state } = claimFixture(kind);
    const configKey = kind === "listener" ? "listener:claim-listener" : "job:claim-job";
    storage.__raw(configKey).name = "[Harness claim] offline";
    const body = kind === "listener" ? probeBody : { ...probeBody, taskType: "scheduledjob", ruleId: "claim-job", manual: kind === "manual", scheduledFor: dueAt, ...(kind === "scheduled" ? { secondTaskId: "harness-claim-second" } : {}) };
    const response = await probe(body); const result = JSON.parse(response.body);
    assert.equal(response.statusCode, 200, response.body); assert.equal(result.directConsumerProbe, true);
    assert.equal(state.runs.length, 1); assert.equal(result.results.filter(r => r.skipped && r.reason === "duplicate delivery").length, 1);
  });
  await check("claim probe refuses listener filter mismatch before claim", async () => {
    const { state } = claimFixture("listener");
    const config = storage.__raw("listener:claim-listener"); config.name = "[Harness claim] mismatch"; config.filters.projectKeys = ["OTHER"];
    const response = await probe(); assert.equal(response.statusCode, 400); assert.equal(state.runs.length, 0);
    assert.equal(storage.__raw("lst_exec:harness-claim-offline"), undefined);
  });
  await check("claim probe refuses scoped job fixtures", async () => {
    const { state } = claimFixture("manual");
    const config = storage.__raw("job:claim-job"); config.name = "[Harness claim] scoped"; config.scope = { jql: "project=LZPT", maxIssues: 3 };
    const response = await probe({ ...probeBody, taskType: "scheduledjob", ruleId: "claim-job" });
    assert.equal(response.statusCode, 400); assert.equal(state.runs.length, 0);
  });
  // F-126 — the kvSet allowlist must carry the provider slots so the harness can plant a
  // provider fault and prove fail-OPEN live; and it must STILL be an allowlist.
  const kvSet = (key, value) => testStateTrigger({ method: "POST", headers: { authorization: ["Bearer offline-claim-secret"] }, body: JSON.stringify({ action: "kvSet", key, value }) });
  await check("kvSet allows the active-provider slot (the fail-open fault the harness plants)", async () => {
    const response = await kvSet("COGNIRUNNER_AI_PROVIDER", null);
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(JSON.parse(response.body).set, "deleted");
  });
  await check("kvSet allows every per-provider key/model/agent-model/baseUrl slot, derived from the shared helpers", async () => {
    const { PROVIDER_IDS, providerSlotsFor } = await import("../../src/shared/provider-slots.js");
    for (const provider of PROVIDER_IDS) {
      for (const key of providerSlotsFor(provider)) {
        const response = await kvSet(key, null);
        assert.equal(response.statusCode, 200, `${key}: ${response.body}`);
      }
    }
    // DERIVED, not retyped: no literal provider slot string anywhere in the hook.
    const hookCode = stripJsComments(readFileSync(new URL("../../src/test-hook.js", import.meta.url), "utf8")); // comments may NAME a slot; code may not
    assert.equal(/COGNIRUNNER_(KEY|MODEL|AGENT_MODEL|BASEURL)_[a-z]/.test(hookCode), false);
    /* F-805 control pair on the mask this gate reads through. */
    assert.equal(/COGNIRUNNER_KEY_[a-z]/.test(stripJsComments("const s = slot(p); // the slot is COGNIRUNNER_KEY_openai\n")), false,
      "a slot NAMED in a trailing comment is not a retyped slot");
    assert.equal(/COGNIRUNNER_KEY_[a-z]/.test(stripJsComments('const s = "COGNIRUNNER_KEY_openai";\n')), true,
      "…and the same name in a string LITERAL still is");
  });
  await check("PROVIDER_IDS stays in lockstep with index.js's PROVIDERS map", async () => {
    const { PROVIDER_IDS } = await import("../../src/shared/provider-slots.js");
    const indexSrc = readFileSync(new URL("../../src/index.js", import.meta.url), "utf8");
    const start = indexSrc.indexOf("const PROVIDERS = {");
    assert.ok(start > 0, "PROVIDERS map not found in index.js");
    // F-130 — parse by BRACE DEPTH, not by a `^  id: {` regex. A differently formatted
    // entry (uppercase/underscore id, quoted key, `{` on the next line, an entry added
    // after a nested block) was missed by the regex on BOTH sides, so the lockstep
    // deepEqual compared two lists that were both wrong and passed.
    const src = indexSrc.slice(start + "const PROVIDERS = ".length);
    let depth = 0, i = 0, end = -1;
    const ids = [];
    let stripped = ""; // same slice with strings/comments blanked, for the independent count
    while (i < src.length) {
      const c = src[i];
      if (c === "/" && src[i + 1] === "/") { const nl = src.indexOf("\n", i); i = nl < 0 ? src.length : nl; continue; }
      if (c === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i); i = e < 0 ? src.length : e + 2; continue; }
      if (c === '"' || c === "'" || c === "`") {
        const q = c; i++;
        while (i < src.length && src[i] !== q) { if (src[i] === "\\") i++; i++; }
        i++; stripped += '""'; continue;
      }
      if (c === "{") {
        depth++;
        if (depth === 2) {
          // the key that opened this entry: last identifier before the `{` and its `:`
          const head = stripped.slice(-200);
          const m = /([A-Za-z0-9_$]+)\s*:\s*$/.exec(head.replace(/\s+$/, (w) => w));
          if (m) ids.push(m[1]);
        }
      } else if (c === "}") {
        depth--;
        if (depth === 0) { end = i; stripped += c; i++; break; }
      }
      stripped += c; i++;
    }
    assert.ok(end > 0, "PROVIDERS object never closed");
    assert.ok(ids.length > 1);
    // Two-sided and format-independent: same length, and every declared id is a key.
    assert.equal(ids.length, PROVIDER_IDS.length, `PROVIDERS has ${ids.length} entries, PROVIDER_IDS has ${PROVIDER_IDS.length}: ${ids.join(",")}`);
    for (const id of PROVIDER_IDS) assert.ok(ids.includes(id), `${id} is in PROVIDER_IDS but not a key of PROVIDERS`);
    for (const id of ids) assert.ok(PROVIDER_IDS.includes(id), `${id} is a PROVIDERS key but missing from PROVIDER_IDS`);
    // A THIRD, independent count: every entry must carry a defaultModel.
    assert.equal((stripped.match(/defaultModel\s*:/g) || []).length, PROVIDER_IDS.length);
    // …and index.js builds its slot names from the shared module, not its own copies.
    assert.match(indexSrc, /from "\.\/shared\/provider-slots\.js"/);
  });
  await check("no backend module keeps a second copy of the provider slot names", async () => {
    // F-127 — the consumer redeclared providerKeySlot/providerModelSlot while the
    // gate only looked at index.js. Every backend module that could retype them is
    // checked here, in BOTH shapes: a `const provider*Slot =` declaration and a raw
    // COGNIRUNNER_* slot literal. Comments may name a slot; code may not.
    const files = backendModules();
    // Sanity: the derivation must actually find the tree (a bad URL would pass vacuously).
    assert.ok(files.length >= 7 && files.includes("index.js") && files.includes("async-handler.js"),
      `backend module derivation returned ${files.join(",") || "nothing"}`);
    for (const f of files) {
      const code = stripJsComments(readFileSync(new URL(`../../src/${f}`, import.meta.url), "utf8"));
      assert.equal(/const provider[A-Za-z]*Slot\s*=/.test(code), false, `${f} redeclares a provider slot helper — import it from src/shared/provider-slots.js`);
      assert.equal(/COGNIRUNNER_(KEY|MODEL|AGENT_MODEL|BASEURL)_[a-z$]/.test(code), false, `${f} types a provider slot literal — derive it from src/shared/provider-slots.js`);
    }
  });
  await check("no backend module retypes a knowledge budget at a skills OR memory block call", async () => {
    // F-868 — src/index.js passed `{ capBytes: 24576 }` to fetchSkillsBlock, which is the
    // function's OWN default (KNOWLEDGE_BUDGET_BYTES.codegen.skills). A budget with two
    // homes drifts: change registry-limits.js and this caller silently keeps the old one.
    // A caller that genuinely needs a different audience passes the NAMED constant.
    //
    // F-873 — WIDENED TO buildMemoryBlock, which is what this comment said was owed. The
    // two memory callers that typed 2048 and 4096 are now named rows in the same table
    // (`endpointAssistant`, `configReview`) and the function's own default is
    // KNOWLEDGE_BUDGET_BYTES.codegen.memories, so no numeric capBytes may stand at either
    // call any more. A caller with a genuinely different audience adds a ROW and names it.
    const files = backendModules();
    assert.ok(files.includes("index.js") && files.includes("async-handler.js"),
      `backend module derivation returned ${files.join(",") || "nothing"}`);
    for (const f of files) {
      const code = stripJsComments(readFileSync(new URL(`../../src/${f}`, import.meta.url), "utf8"));
      for (const fn of ["fetchSkillsBlock", "buildMemoryBlock"]) {
        assert.equal(new RegExp(`${fn}\\([^;]*capBytes\\s*:\\s*\\d`).test(code), false,
          `${f} types a numeric capBytes at a ${fn} call — use the default or KNOWLEDGE_BUDGET_BYTES`);
      }
      if (f !== "index.js") continue;
      // index.js keeps 24576 for PF_FUNCTIONS_OFFLOAD_BYTES (a different, unrelated budget);
      // what must not exist is a SECOND copy of the skills budget.
      const hits = (code.match(/24576/g) || []).length;
      assert.equal(hits, 1, `src/index.js has ${hits} copies of 24576 — only PF_FUNCTIONS_OFFLOAD_BYTES may be one`);
    }
    const { KNOWLEDGE_BUDGET_BYTES } = await import("../../src/shared/registry-limits.js");
    assert.equal(KNOWLEDGE_BUDGET_BYTES.codegen.skills, 24576, "the skills budget's ONE home still reads 24576");
    // …and the memory budgets the two callers moved off their literals onto (F-873).
    assert.equal(KNOWLEDGE_BUDGET_BYTES.codegen.memories, 8192, "buildMemoryBlock's default row");
    assert.equal(KNOWLEDGE_BUDGET_BYTES.endpointAssistant.memories, 2048, "suggestEndpoint's row, ex-literal 2048");
    assert.equal(KNOWLEDGE_BUDGET_BYTES.configReview.memories, 4096, "the async review task's row, ex-literal 4096");
    // The function's default must come FROM the table, not repeat its number.
    const mem = stripJsComments(readFileSync(new URL("../../src/memories.js", import.meta.url), "utf8"));
    assert.match(mem, /capBytes = KNOWLEDGE_BUDGET_BYTES\.codegen\.memories/,
      "buildMemoryBlock's default is the named constant, not a second copy of 8192");
  });
  await check("kvSet is still an allowlist, not a KVS write bridge", async () => {
    // F-163 deliberately ADDED pf_memories + COGNIRUNNER_MEMORY_SETTINGS to the allowlist
    // (the harness must be able to seed a 200-row store to prove the F-160/F-161 cap policy
    // live). The point of this assertion is that the list is still a LIST — every key nobody
    // put on it is refused.
    for (const key of ["config_registry", "COGNIRUNNER_KEY_", "COGNIRUNNER_KEY_notaprovider", "validation_logs", "app_users", "doc_repo_index", "skill_repo_index"]) {
      const response = await kvSet(key, "x");
      assert.equal(response.statusCode, 400, `${key} must be refused`);
      assert.match(JSON.parse(response.body).error, /not allowlisted/);
    }
    // F-163: the two memory keys ARE allowlisted now — the names come from src/memories.js.
    for (const key of ["pf_memories", "COGNIRUNNER_MEMORY_SETTINGS"]) {
      const response = await kvSet(key, null);
      assert.equal(response.statusCode, 200, `${key} must be allowlisted for the memory-store proof`);
    }
  });
  /* F-742 — THE SHAPE DOOR. A malformed body used to reach `storage.set` and throw
   * `ForgeKvsAPIError [BAD_REQUEST]`: a raw stack in the Forge log, a 424 at the caller
   * and no word about WHICH half of the body was wrong. Every bad shape is now a 400
   * that NAMES THE FIELD — and the reason never carries the value back. */
  await check("kvSet BLOCKS a malformed body with a 400 that names the field (F-742)", async () => {
    const cases = [
      { name: "a non-string key", body: { key: { nested: true }, value: "x" }, field: "key" },
      { name: "an empty key", body: { key: "", value: "x" }, field: "key" },
      { name: "a 501-character key", body: { key: "a".repeat(501), value: "x" }, field: "key" },
      /* F-770 — THE TWO CONTROLS, ON THE CHARACTER THAT ACTUALLY MATTERS. F-742's second
       * copy of the key grammar refused whitespace (which the platform ALLOWS) and passed
       * "/" (which the platform REFUSES — it is the F-346 character). So "/" is the BLOCK
       * control here and a SPACE is the ALLOW control in the sibling check below; the
       * pair is asserted on BOTH doors, the kvSet write and the `?what=kvs` read. */
      { name: "a key containing a slash (F-346's character)", body: { key: "COGNIRUNNER_AI/PROVIDER", value: "x" }, field: "key" },
      { name: "a key containing a percent sign", body: { key: "COGNIRUNNER_AI%PROVIDER", value: "x" }, field: "key" },
      { name: "a non-ASCII key", body: { key: "COGNIRUNNER_日本語", value: "x" }, field: "key" },
      { name: "an all-whitespace key", body: { key: "   ", value: "x" }, field: "key" },
      // The value cases must sit on an ALLOWLISTED key, or the allow-list answers first —
      // which is the point of the ordering: authorisation is not this door's question.
      { name: "an omitted value", body: { key: "COGNIRUNNER_AI_PROVIDER" }, field: "value" },
      { name: "an oversized value", body: { key: "COGNIRUNNER_AI_PROVIDER", value: "z".repeat(240 * 1024 + 64) }, field: "value" },
    ];
    for (const c of cases) {
      const response = await testStateTrigger({
        method: "POST",
        headers: { authorization: ["Bearer offline-claim-secret"] },
        body: JSON.stringify({ action: "kvSet", ...c.body }),
      });
      assert.equal(response.statusCode, 400, `${c.name} must be 400, got ${response.statusCode} ${response.body}`);
      const parsed = JSON.parse(response.body);
      assert.equal(parsed.ok, false, `${c.name}: ok:false`);
      assert.equal(parsed.error, "bad-request", `${c.name}: error:"bad-request"`);
      assert.equal(parsed.field, c.field, `${c.name}: names the field`);
      assert.equal(typeof parsed.reason === "string" && parsed.reason.length > 0, true, `${c.name}: carries a reason`);
      // The refusal is a diagnosis, never an echo: the oversized value must not come back.
      assert.equal(/z{40}/.test(response.body), false, `${c.name}: the reason never reflects the value`);
    }
    // …and nothing landed: the slot the value cases aimed at is still absent.
    assert.equal(storage.__raw("COGNIRUNNER_AI_PROVIDER"), undefined);
  });
  await check("kvSet ALLOWS a well-formed body — it still reaches storage (F-742)", async () => {
    const response = await kvSet("COGNIRUNNER_AI_PROVIDER", "openai");
    assert.equal(response.statusCode, 200, response.body);
    const parsed = JSON.parse(response.body);
    assert.equal(parsed.set, true);
    assert.equal(parsed.now, "openai", "the door read the row back — the write landed");
    assert.equal(storage.__raw("COGNIRUNNER_AI_PROVIDER"), "openai");
    // A multi-byte value just under the cap is NOT refused by a character-length check.
    const big = await kvSet("COGNIRUNNER_AI_PROVIDER", "é".repeat(100 * 1024));
    assert.equal(big.statusCode, 200, "a 200 KiB multi-byte value is under the cap and passes");
    assert.equal(JSON.parse((await kvSet("COGNIRUNNER_AI_PROVIDER", null)).body).set, "deleted");
  });
  /* F-770 — ONE GRAMMAR, TWO DOORS, BOTH CONTROLS. The shape door now asks
   * `isKvsKey` from src/shared/kvs-keys.js instead of keeping a second copy. These two
   * checks pin the pair of characters the two copies disagreed about, in BOTH
   * directions and on BOTH doors, so a future "tidy-up" that re-inlines a charset
   * regex fails here rather than on a tenant.
   *
   * The DISCRIMINATOR on the write door is the refusal SHAPE, not the status: a legal
   * key that nobody allow-listed is 400 `key not allowlisted` with NO `field`, which
   * proves it got PAST the shape check; an illegal key is 400 `bad-request` WITH
   * `field:"key"`, which proves it did not. */
  const kvsRead = (key) => testStateTrigger({
    method: "GET",
    headers: { authorization: ["Bearer offline-claim-secret"] },
    queryParameters: { what: ["kvs"], key: [key] },
  });
  await check("a SPACE is legal to the platform, so neither door may refuse it (F-770)", async () => {
    // Forge's own pattern is ^(?!\s+$)[a-zA-Z0-9:._\s#-]+$ — whitespace is admitted.
    const SPACED = "COGNIRUNNER_AI PROVIDER";
    assert.equal(isKvsKey(SPACED), true, "premise: the platform's own predicate accepts a space");

    const written = await testStateTrigger({
      method: "POST",
      headers: { authorization: ["Bearer offline-claim-secret"] },
      body: JSON.stringify({ action: "kvSet", key: SPACED, value: "x" }),
    });
    const wParsed = JSON.parse(written.body);
    assert.match(wParsed.error, /not allowlisted/, `the write door must refuse the space key on AUTHORISATION, not shape (got ${written.body})`);
    assert.equal(wParsed.field, undefined, "…so the refusal carries no `field` — the shape door passed it through");

    // The READ door has no allow-list, so a legal key is a plain 200 — the false refusal
    // F-770 is about would have been a 400 here, blinding a driver on a real row.
    storage.__seed(SPACED, "a value a tenant really holds");
    const read = await kvsRead(SPACED);
    assert.equal(read.statusCode, 200, `the read door must not refuse a legal key (got ${read.statusCode} ${read.body})`);
    assert.equal(JSON.parse(read.body).value, "a value a tenant really holds");
  });
  await check('"/" and friends are ILLEGAL, so BOTH doors refuse them by shape (F-770)', async () => {
    // "/" is the F-346 character: it used to pass this door and throw INVALID_KEY at the
    // platform, which is the 500/424 F-742 exists to eliminate.
    for (const bad of ["acme/app", "pf_code:rule-1/a1b2c3", "x%y", "日本語", "   "]) {
      assert.equal(isKvsKey(bad), false, `premise: the platform's predicate refuses ${JSON.stringify(bad)}`);

      const written = await testStateTrigger({
        method: "POST",
        headers: { authorization: ["Bearer offline-claim-secret"] },
        body: JSON.stringify({ action: "kvSet", key: bad, value: "x" }),
      });
      assert.equal(written.statusCode, 400, `write door: ${JSON.stringify(bad)} must be 400`);
      const wParsed = JSON.parse(written.body);
      assert.equal(wParsed.error, "bad-request", `write door: ${JSON.stringify(bad)} is refused by SHAPE, before the allow-list`);
      assert.equal(wParsed.field, "key", `write door: ${JSON.stringify(bad)} names the field`);

      const read = await kvsRead(bad);
      assert.equal(read.statusCode, 400, `read door: ${JSON.stringify(bad)} must be 400, never a platform throw`);
      const rParsed = JSON.parse(read.body);
      assert.equal(rParsed.error, "bad-request", `read door: ${JSON.stringify(bad)} is a named refusal`);
      assert.equal(rParsed.field, "key", `read door: ${JSON.stringify(bad)} names the field`);
    }
  });
  await check("the hook keeps NO second copy of the KVS key grammar (F-770)", async () => {
    // The defect was a duplicated grammar, so the assertion is against DUPLICATION, not
    // against today's behaviour: behaviour can be restored by a copy, this cannot.
    const src = readFileSync(new URL("../../src/test-hook.js", import.meta.url), "utf8");
    assert.match(src, /from "\.\/shared\/kvs-keys\.js"/, "test-hook.js must import the grammar's one home");
    const code = stripJsComments(src);
    assert.equal(/KVS_KEY_MAX_CHARS\s*=/.test(code), false, "test-hook.js must not redeclare KVS_KEY_MAX_CHARS");
    assert.equal(/KVS_KEY_PATTERN\s*=/.test(code), false, "test-hook.js must not redeclare KVS_KEY_PATTERN");
  });
  /* ═══════════════════════════════════════════════════════════════════════════════
   * F-769 — THE READ CEILING. `?what=kvs` is unrestricted in WHICH rows it may reach
   * and must stay that way; what it may SAY about a credential row is the thing that
   * had no ceiling. These checks pin both halves: the credential families are masked,
   * and everything else is byte-for-byte unchanged.
   * ═══════════════════════════════════════════════════════════════════════════════ */
  const POST = (body) => testStateTrigger({
    method: "POST", headers: { authorization: ["Bearer offline-claim-secret"] }, body: JSON.stringify(body),
  });
  await check("BLOCK: a credential-family row never returns its value (F-769)", async () => {
    // One planted value, used for every family, so a leak is one grep rather than nine.
    const PLANTED = "zz-harness-planted-credential-zz";
    const families = [
      "COGNIRUNNER_KEY_azure",              // the BYOK provider key the finding measured
      "COGNIRUNNER_OPENAI_API_KEY",         // the legacy single-provider slot
      "COGNIRUNNER_FORGE_IDENTITY",         // carries the identity's token
      "COGNIRUNNER_DOC_PROCESSOR_REMOTE",   // {url, bearer}
      "COGNIRUNNER_WEB_SEARCH_REMOTE",      // {url, bearer}
      "git_conn_secret:c1",                 // the connection token
      "git_hook_secret:c1:acme#widget.1a2b", // the webhook SIGNING secret
      "webtrigger_url:rules-api",           // a capability URL with an unguessable token
      "att_token:abc123",
      "upload_token:abc123",
      "probe:webhook:secret",
      // …and the NAME catch-all, for a family nobody has invented yet.
      "some_future_api_token:9",
    ];
    for (const key of families) {
      assert.equal(isCredentialKey(key), true, `premise: ${key} is a credential family`);
      storage.__seed(key, PLANTED);
      const res = await kvsRead(key);
      assert.equal(res.statusCode, 200, `${key}: a credential row is still READABLE — the ceiling is on the value, not on the key`);
      // THE ASSERTION THE FINDING IS ABOUT: the value is nowhere in the response BODY,
      // asserted on the raw text so a nested or re-encoded copy cannot slip through.
      assert.equal(res.body.includes(PLANTED), false, `${key}: the value reached the wire — this is F-769`);
      const parsed = JSON.parse(res.body);
      assert.equal(parsed.masked, true, `${key}: the answer says it is masked`);
      assert.equal("value" in parsed, false, `${key}: there is no \`value\` field at all`);
      assert.equal(parsed.present, true, `${key}: present:true still answers the F-126 planted-fault question`);
      assert.match(parsed.fingerprint, /^[0-9a-f]{16}$/, `${key}: a sha256-16 fingerprint`);
    }
    // ABSENT is one answer, not two: `present:false` with a null fingerprint.
    const absent = JSON.parse((await kvsRead("COGNIRUNNER_KEY_neverset")).body);
    assert.equal(absent.present, false, "a cleared slot reads present:false — F-126's planted fault is still confirmable");
    assert.equal(absent.fingerprint, null, "…and an absent row has no fingerprint, rather than a hash of \"null\"");
    // The fingerprint is an EQUALITY witness: same bytes, same hash; different bytes, not.
    storage.__seed("COGNIRUNNER_KEY_openai", PLANTED);
    const a = JSON.parse((await kvsRead("COGNIRUNNER_KEY_openai")).body).fingerprint;
    storage.__seed("COGNIRUNNER_KEY_openai", PLANTED);
    assert.equal(JSON.parse((await kvsRead("COGNIRUNNER_KEY_openai")).body).fingerprint, a, "identical rows fingerprint identically");
    storage.__seed("COGNIRUNNER_KEY_openai", PLANTED + "!");
    assert.notEqual(JSON.parse((await kvsRead("COGNIRUNNER_KEY_openai")).body).fingerprint, a, "a changed row fingerprints differently");
  });
  await check("ALLOW: every non-credential row reads exactly as before (F-769)", async () => {
    // The ceiling must be a NARROW cut. These are the key shapes the live drivers in the
    // F-769 census actually read, plus a key this file has never heard of.
    const rows = {
      "config_registry": [{ id: "r1" }],
      "app_admins": ["557058:abc"],
      "validation_logs": [{ at: "now" }],
      "pf_code:rule-1:a1b2c3": { code: "api.log('x')" },
      "job:7f3a9c21": { id: "7f3a9c21" },
      "va_health:agent-1": { state: "green" },
      "COGNIRUNNER_AI_PROVIDER": "openai",
      "COGNIRUNNER_MEMORY_SETTINGS": { injection: true },
      "COGNIRUNNER_AGENT_MODEL_atlassian": "gpt-5.4-mini",
      "git_pipeline:c1:acme#widget.1a2b": { status: "installed" },
      "a key nobody declared": { arbitrary: true },
    };
    for (const [key, value] of Object.entries(rows)) {
      assert.equal(isCredentialKey(key), false, `premise: ${key} is NOT a credential family`);
      storage.__seed(key, value);
      const parsed = JSON.parse((await kvsRead(key)).body);
      assert.deepEqual(parsed.value, value, `${key}: the value still comes back verbatim`);
      assert.equal(parsed.masked, undefined, `${key}: an ordinary row is not marked masked`);
      assert.equal("maskedFields" in parsed, false, `${key}: a clean row says nothing about masking (F-794)`);
    }
  });
  /* ═══════════════════════════════════════════════════════════════════════════════
   * F-794 — THE FIELD CEILING. The F-769 ceiling is per-KEY; a credential is per-FIELD,
   * and the app's mixed rows (`config_registry`, `pf_code:*`, `job:*`, `listener:*`,
   * `async_job:*`) answered entirely plain because their KEY says nothing. These pin the
   * three answers the door now gives: masked-by-field, plain-when-clean, and the
   * `api_tokens` row that the NAME catch-all used to over-mask whole.
   * ═══════════════════════════════════════════════════════════════════════════════ */
  await check("BLOCK: a secret FIELD inside a non-credential row is masked, and its siblings are not (F-794)", async () => {
    const BEARER = "zz-harness-planted-endpoint-bearer-zz";
    const key = "job:field-ceiling";
    const row = { id: "field-ceiling", name: "Nightly sync", enabled: true,
      functions: [{ name: "call", endpoint: { url: "https://example.test/x", headers: { Authorization: `Bearer ${BEARER}`, "X-Trace": "t-1" } }, code: "api.log('x')" }] };
    storage.__seed(key, row);
    assert.equal(isCredentialKey(key), false, "premise: `job:*` is not and must not become a credential FAMILY — the row is mostly readable");
    const res = await kvsRead(key);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.includes(BEARER), false, "the endpoint bearer reached the wire — this is F-794");
    const parsed = JSON.parse(res.body);
    assert.deepEqual(parsed.maskedFields, ["functions[0].endpoint.headers.Authorization"],
      "the masked PATH is named to the FIELD, so a driver knows exactly what it is not being shown");
    assert.deepEqual(parsed.value.value ?? null, null, "the row is not swallowed into a `value` wrapper");
    assert.equal(parsed.value.name, "Nightly sync", "a sibling field is PLAIN — this is not the per-key ceiling wearing a new name");
    assert.equal(parsed.value.functions[0].code, "api.log('x')", "…and so is the step code");
    assert.equal(parsed.value.functions[0].endpoint.url, "https://example.test/x", "…and the endpoint URL, which is not a credential");
    const masked = parsed.value.functions[0].endpoint.headers.Authorization;
    assert.equal(masked.masked, true);
    assert.equal(masked.why, "field-name-reads-like-a-credential");
    assert.match(masked.fingerprint, /^[0-9a-f]{16}$/, "the ONE credentialFingerprint (F-780), not a second digest");
    // The header MAP is walked field by field, so a header whose name says nothing stays
    // readable — and a credential under such a name is the residual the docblock names.
    assert.equal(parsed.value.functions[0].endpoint.headers["X-Trace"], "t-1",
      "a header the hints do not name is plain: the ceiling reads NAMES, and that is stated at maskSecretFields");
  });
  await check("BLOCK: a value-SHAPED secret in free text is caught even where no field name says so (F-794)", async () => {
    const key = "pf_code:rule-9:deadbeef";
    storage.__seed(key, { code: "const k = 'sk-abcdefghijkl';", note: "harmless" });
    const parsed = JSON.parse((await kvsRead(key)).body);
    assert.deepEqual(parsed.maskedFields, ["code"], "an `sk-…` shape is masked even inside a field called `code`");
    assert.equal(parsed.value.note, "harmless", "…and the harmless sibling is plain");
    // THE RESIDUAL, asserted rather than assumed: a token with no known SHAPE in free text
    // is NOT caught. Stated at maskSecretFields' docblock; pinned here so it is not a surprise.
    storage.__seed(key, { code: "const k = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';" });
    assert.equal("maskedFields" in JSON.parse((await kvsRead(key)).body), false,
      "a shapeless blob in free text is a KNOWN residual of a field-name ceiling — masking every long string would mask the code");
  });
  await check("the api_tokens row is no longer over-masked whole: hash fingerprinted, the rest readable (F-794)", async () => {
    const { API_TOKENS_KEY, REVOKED_TOKEN_PREFIX } = await import("../../src/rules-api.js");
    assert.equal(isCredentialKey(API_TOKENS_KEY), false,
      "the NAME catch-all claimed `api_tokens` for the word `token`, but the row stores sha256(token)+prefix and never the bearer");
    const HASH = "9f".repeat(32);
    storage.__seed(API_TOKENS_KEY, [{ id: "tok_1", name: "CI", hash: HASH, prefix: "cgr_0a1b2c", role: "editor", revokedAt: null }]);
    const parsed = JSON.parse((await kvsRead(API_TOKENS_KEY)).body);
    assert.deepEqual(parsed.maskedFields, ["[0].hash"], "only the hash is masked, by the REVIEWED per-key rule");
    assert.equal(parsed.value[0].hash.masked, true);
    assert.equal(parsed.value[0].hash.why, "reviewed-field-mask-for-this-key");
    assert.match(parsed.value[0].hash.fingerprint, /^[0-9a-f]{16}$/);
    assert.equal(JSON.stringify(parsed).includes(HASH), false, "the stored hash verifies a live bearer, so it does not reach the wire");
    assert.equal(parsed.value[0].prefix, "cgr_0a1b2c", "the PREFIX is plain — it is what the UI shows and cannot authenticate");
    assert.equal(parsed.value[0].role, "editor", "…and the role, which is the thing a driver reads this row for");
    // The tombstone carries no secret at all, so it answers completely plain.
    const stone = `${REVOKED_TOKEN_PREFIX}tok_1`;
    storage.__seed(stone, { id: "tok_1", revokedAt: "2026-09-14T00:00:00.000Z" });
    const stoneRes = JSON.parse((await kvsRead(stone)).body);
    assert.equal(isCredentialKey(stone), false, "a revoke tombstone is not a credential row");
    assert.deepEqual(stoneRes.value, { id: "tok_1", revokedAt: "2026-09-14T00:00:00.000Z" });
    assert.equal("maskedFields" in stoneRes, false);
    // …and the exemption may only ever excuse the CATCH-ALL, never a declared family.
    assert.equal(isCredentialKey("api_tokens_backup"), true, "a NEW key carrying the word is still claimed until someone reads it");
  });
  await check("the kvSet write echo mirrors the read, so the door has ONE shape in both directions (F-794)", async () => {
    const BEARER = "zz-harness-echo-bearer-zz";
    const value = { probe: { headers: { Authorization: `Bearer ${BEARER}` } }, label: "echo" };
    const res = await kvSet("COGNIRUNNER_MEMORY_SETTINGS", value);
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.body.includes(BEARER), false, "the echo handed the caller's own bearer back on the wire");
    const parsed = JSON.parse(res.body);
    assert.deepEqual(parsed.maskedFields, ["probe.headers.Authorization"], "the same paths as the GET names");
    assert.equal(parsed.now.label, "echo", "…and the same plain siblings");
    assert.equal(parsed.now.probe.headers.Authorization.masked, true);
    // Same row, same shape, through the READ door.
    const readBack = JSON.parse((await kvsRead("COGNIRUNNER_MEMORY_SETTINGS")).body);
    assert.deepEqual(readBack.maskedFields, parsed.maskedFields);
    assert.equal(readBack.value.probe.headers.Authorization.fingerprint, parsed.now.probe.headers.Authorization.fingerprint,
      "one fingerprint for one row, whichever door answered");
  });
  await check("POSITIVE CONTROL: the field walker still SEES, and fails CLOSED on what it cannot read (F-794)", async () => {
    const { findSecretFields, findPlantedSecret, maskSecretFields } = await import("../../src/test-hook.js");
    // It sees both kinds of hit, at depth, and reports ALL of them rather than the first.
    // F-825 — the name hit is asserted on a STRING value, because a number under a
    // credential name is not a credential and no longer hits (its own checks are below).
    const hits = findSecretFields({ a: { password: "hunter2" }, b: ["ghp_abcdefgh"], c: "fine" }, { maxDepth: 12 });
    assert.deepEqual(hits.map((h) => h.field), ["a.password", "b[0]"], "every path, not just the first");
    // The WRITE refusal is unchanged: the same first hit, the same shape, the same depth 6.
    assert.deepEqual(findPlantedSecret({ a: { password: "hunter2" }, b: ["ghp_abcdefgh"] }),
      { field: "a.password", why: "field-name-reads-like-a-credential" });
    assert.equal(findPlantedSecret({ nothing: "here" }), null, "a clean body is still null, never an empty array");
    // FAIL CLOSED: a subtree the read walker cannot reach is fingerprinted, not answered.
    let deep = "leaf"; for (let i = 0; i < 14; i++) deep = { down: deep };
    const masked = await maskSecretFields(deep);
    assert.ok(masked && masked.maskedFields.length === 1, "a row deeper than the walker's ceiling is masked, not returned plain");
    assert.match(masked.maskedFields[0], /^down(\.down)+$/);
    assert.equal(JSON.stringify(masked.value).includes("leaf"), false, "…and the unread leaf never reaches the wire");
    assert.equal(await maskSecretFields({ plain: "row" }), null, "a clean row masks NOTHING — the cut is narrow");
  });
  /* ═══════════════════════════════════════════════════════════════════════════════
   * F-802 — THE CEILING IS A PROPERTY OF THE ANSWER, NOT OF ONE QUERY PARAMETER.
   *
   * The F-794 field ceiling lived in the `?what=kvs` arm alone, and the same GET handler
   * has three other arms that return stored rows: `?what=registry` (`config_registry`),
   * `?what=logs` (`validation_logs`) and `?what=execlogs` (every `log_entry:*`, through
   * `readLogs`). All three answered VERBATIM. These checks read ONE planted row through
   * EVERY door and assert the answers are identical — the equality is the cut, because a
   * ceiling that is a property of one arm is a ceiling one query parameter away from none.
   * Each door also carries its own POSITIVE CONTROL: it still answers a clean row plain,
   * so a green line means the projection is narrow rather than that it masks everything.
   * ═══════════════════════════════════════════════════════════════════════════════ */
  const hookGet = (queryParameters) => testStateTrigger({
    method: "GET", headers: { authorization: ["Bearer offline-claim-secret"] }, queryParameters,
  });
  await check("BLOCK: `?what=registry` masks the same fields `?what=kvs` does, on the same row (F-802)", async () => {
    const BEARER = "zz-harness-cross-door-registry-bearer-zz";
    const row = { id: "r-802", name: "Cross-door", enabled: true,
      endpoint: { url: "https://example.test/x", headers: { Authorization: `Bearer ${BEARER}`, "X-Trace": "t-1" } } };
    storage.__seed("config_registry", [row]);
    const res = await hookGet({ what: ["registry"] });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.body.includes(BEARER), false, "`?what=registry` put the endpoint bearer on the wire — this is F-802");
    const parsed = JSON.parse(res.body);
    assert.deepEqual(parsed.maskedFields, ["[0].endpoint.headers.Authorization"],
      "the ARRAY is one value, so the path carries the entry INDEX rather than a per-entry maskedFields");
    assert.equal(parsed.registry[0].name, "Cross-door", "the envelope name and the plain siblings are unchanged");
    assert.equal(parsed.registry[0].endpoint.headers["X-Trace"], "t-1");
    // THE EQUALITY. The same bytes, read through the door that already had the ceiling.
    const viaKvs = JSON.parse((await kvsRead("config_registry")).body);
    assert.deepEqual(parsed.maskedFields, viaKvs.maskedFields, "the two doors name the same masked paths");
    assert.deepEqual(parsed.registry, viaKvs.value, "…and hand back byte-identical rows");
    // POSITIVE CONTROL: a clean registry is still answered plain, with no masking noise.
    storage.__seed("config_registry", [{ id: "r1", name: "Clean" }]);
    const clean = JSON.parse((await hookGet({ what: ["registry"] })).body);
    assert.deepEqual(clean.registry, [{ id: "r1", name: "Clean" }], "a clean registry reads exactly as it always did");
    assert.equal("maskedFields" in clean, false, "…and says nothing about masking");
  });
  await check("BLOCK: `?what=logs` masks the same fields `?what=kvs` does, on the same row (F-802)", async () => {
    const BEARER = "zz-harness-cross-door-logs-bearer-zz";
    const entry = { at: "2026-09-14T00:00:00.000Z", ruleId: "r1", result: true,
      response: { headers: { Authorization: `Bearer ${BEARER}` } }, reason: "ok" };
    storage.__seed("validation_logs", [entry]);
    const res = await hookGet({ what: ["logs"] });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.body.includes(BEARER), false, "`?what=logs` put a logged bearer on the wire — this is F-802");
    const parsed = JSON.parse(res.body);
    assert.deepEqual(parsed.maskedFields, ["[0].response.headers.Authorization"]);
    assert.equal(parsed.logs[0].reason, "ok", "the rest of the entry is readable — a log is what a driver reads this door for");
    const viaKvs = JSON.parse((await kvsRead("validation_logs")).body);
    assert.deepEqual(parsed.maskedFields, viaKvs.maskedFields);
    assert.deepEqual(parsed.logs, viaKvs.value, "one row, one answer, whichever door");
    // POSITIVE CONTROL: a clean log list is plain.
    storage.__seed("validation_logs", [{ at: "now", reason: "clean" }]);
    const clean = JSON.parse((await hookGet({ what: ["logs"] })).body);
    assert.deepEqual(clean.logs, [{ at: "now", reason: "clean" }]);
    assert.equal("maskedFields" in clean, false);
  });
  await check("BLOCK: `?what=execlogs` masks every log_entry:* the same way (F-802)", async () => {
    /* THE DOOR ITSELF IS NOT DRIVABLE HERE, AND THAT IS STATED RATHER THAN PAPERED OVER.
     * The `?what=execlogs` arm does `await import("./index.js")` for `readLogs`, and
     * `src/index.js:12448` re-exports from the EXTENSIONLESS specifier `"./test-hook"`,
     * which Node's ESM resolver refuses — so the module cannot be loaded offline at all
     * (filed separately; src/index.js belongs to another cut). What is asserted instead is
     * the exact projection that arm performs: `readCeiling("log_entry:", entries)` on the
     * rows `readLogs` returns, and the EQUALITY against the `?what=kvs` answer for the very
     * same stored row — which is the property F-802 is about. The arm's routing through
     * `answerStored` is pinned by the MECHANISM gate below. */
    const { LOG_ENTRY_PREFIX } = await import("../../src/rule-stats.js");
    const { readCeiling } = await import("../../src/test-hook.js");
    const BEARER = "zz-harness-cross-door-execlog-bearer-zz";
    // `log_entry:` is the key SPREAD_BOUNDED_BY excuses as `unbounded-field-masked-at-the-door`
    // — and before this cut, `readLogs` was the door those rows were actually read through.
    const key = `${LOG_ENTRY_PREFIX}9999999999999_aaaaaaaa`;
    const entry = { ruleId: "r1", outcome: "pass", aiResponse: { authorization: `Bearer ${BEARER}` } };
    storage.__seed(key, entry);
    const answer = await readCeiling("log_entry:", [entry]);   // what `readLogs` hands the arm
    assert.equal(JSON.stringify(answer).includes(BEARER), false,
      "`?what=execlogs` would have put a step result's bearer on the wire — this is F-802");
    assert.deepEqual(answer.maskedFields, ["[0].aiResponse.authorization"],
      "a LIST of entries is one value, so the path carries the entry INDEX");
    assert.equal(answer.value[0].outcome, "pass", "the entry is otherwise readable");
    // THE EQUALITY, against the row's own key through the door that already had the ceiling.
    const viaKvs = JSON.parse((await kvsRead(key)).body);
    assert.deepEqual(answer.value[0].aiResponse.authorization, viaKvs.value.aiResponse.authorization,
      "the same field, the same fingerprint, whichever door read it");
    // POSITIVE CONTROL: a clean entry is plain, and says nothing about masking.
    const cleanAnswer = await readCeiling("log_entry:", [{ ruleId: "r1", outcome: "pass" }]);
    assert.deepEqual(cleanAnswer, { value: [{ ruleId: "r1", outcome: "pass" }] });
  });
  /* ═══════════════════════════════════════════════════════════════════════════════
   * F-825 — A NUMBER UNDER A CREDENTIAL-LOOKING NAME IS NOT A CREDENTIAL.
   *
   * `SECRET_KEY_HINTS` holds `token` and the name test is a SUBSTRING match, so `tokens`
   * — the NUMERIC AI usage counter on every `log_entry:*` row — matched, and once F-802
   * put the execlog arm behind the ceiling, 12 of 47 entries on dev answered
   * `{masked:true}` where a driver reads a number. The four controls the live report
   * named are pinned here: the plural counter plain, the singular string masked, an
   * all-numeric usage OBJECT plain, a string-bearing one masked.
   * ═══════════════════════════════════════════════════════════════════════════════ */
  await check("BLOCK: the numeric `tokens` counter answers PLAIN; a string under `token` is still masked (F-825)", async () => {
    const { LOG_ENTRY_PREFIX } = await import("../../src/rule-stats.js");
    const { readCeiling, findSecretFields, findPlantedSecret } = await import("../../src/test-hook.js");
    const GHP = "ghp_abcdefghijklmnopqrst";
    // 1) the counter, exactly as a log entry carries it
    const counted = await readCeiling("log_entry:", [{ ruleId: "r1", outcome: "pass", tokens: 1234 }]);
    assert.deepEqual(counted, { value: [{ ruleId: "r1", outcome: "pass", tokens: 1234 }] },
      "a NUMBER under `tokens` reads plain and the entry says nothing about masking — this is F-825");
    // 2) the singular, holding a real credential string — unchanged
    const secret = await readCeiling("log_entry:", [{ token: GHP }]);
    assert.deepEqual(secret.maskedFields, ["[0].token"], "a STRING under a credential name is still masked whole");
    assert.equal(secret.value[0].token.masked, true);
    assert.equal(secret.value[0].token.why, "field-name-reads-like-a-credential");
    assert.equal(JSON.stringify(secret).includes(GHP), false, "…and never reaches the wire");
    // 3) an all-numeric usage OBJECT is plain, and the walk still descends into it
    const usage = { tokens: { prompt: 12, completion: 3 } };
    assert.deepEqual(findSecretFields(usage, { maxDepth: 12 }), [], "no string beneath it, so nothing a credential could hide in");
    assert.deepEqual(await readCeiling("log_entry:", [usage]), { value: [usage] });
    // 4) …but an object that CONTAINS a string under that name is masked WHOLE, subtree and all
    const bearing = await readCeiling("log_entry:", [{ token: { value: "abcdefghijklmnop" } }]);
    assert.deepEqual(bearing.maskedFields, ["[0].token"], "the field-name hit still claims the whole subtree");
    assert.equal(bearing.value[0].token.masked, true);
    assert.equal(JSON.stringify(bearing).includes("abcdefghijklmnop"), false);
    // booleans and null are values a credential cannot be, so they answer plain too
    assert.deepEqual(findSecretFields({ apiKey: true, secret: null, password: 0 }, { maxDepth: 12 }), [],
      "boolean/null/zero under credential names: masking them disclosed nothing and blinded the reader");
    // THE WRITE REFUSAL SHARES THE TRAVERSAL and therefore the rule.
    assert.deepEqual(findPlantedSecret({ token: GHP }), { field: "token", why: "field-name-reads-like-a-credential" },
      "a plant body carrying a credential STRING is still refused");
    assert.equal(findPlantedSecret({ tokens: 1234 }), null, "…and a usage counter is not a reason to refuse a body");
    // A CREDENTIAL DEEPER DOWN IS STILL FOUND: the name hit no longer fires, so the walk continues.
    const deeper = findSecretFields({ tokens: { count: 3, apiKey: GHP } }, { maxDepth: 12 });
    assert.deepEqual(deeper, [{ field: "tokens", why: "field-name-reads-like-a-credential" }],
      "a string-bearing subtree is claimed whole by the name — the plural is NOT exempted by name, only by type");
    assert.deepEqual(findSecretFields({ usage: { tokens: { count: 3 }, note: GHP } }, { maxDepth: 12 }),
      [{ field: "usage.note", why: "value-looks-like-a-credential" }],
      "…and past a numeric `tokens` the walker keeps going and still catches a credential by SHAPE");
  });
  await check("BLOCK: `?what=provider` is a stored row too, and answers through the same ceiling (F-802)", async () => {
    storage.__seed("COGNIRUNNER_AI_PROVIDER", "openai");
    const plain = JSON.parse((await hookGet({ what: ["provider"] })).body);
    assert.equal(plain.provider, "openai", "POSITIVE CONTROL: the ordinary answer is unchanged — this is the arm every driver reads");
    assert.equal("maskedFields" in plain, false);
    // …and it is not exempt: a credential-SHAPED value at the root is masked like any other.
    storage.__seed("COGNIRUNNER_AI_PROVIDER", "sk-abcdefghijklmnop");
    const res = await hookGet({ what: ["provider"] });
    assert.equal(res.body.includes("sk-abcdefghijklmnop"), false, "a credential shape reached the wire through `?what=provider`");
    const masked = JSON.parse(res.body);
    assert.deepEqual(masked.maskedFields, ["(root)"]);
    assert.equal(masked.provider.masked, true);
    storage.__seed("COGNIRUNNER_AI_PROVIDER", "openai");
  });
  await check("MECHANISM: every GET arm that reads storage answers through `answerStored` (F-802)", async () => {
    // The recurrence this closes is not "the registry leaked" — it is "the projection was
    // a property of ONE arm". So the gate reads the switch itself: an arm that touches
    // storage (or `readLogs`) and hands the result to `json(...)` on its own is the defect.
    const src = readFileSync(new URL("../../src/test-hook.js", import.meta.url), "utf8");
    // `stripJsComments` is the file-wide scanner and it does not survive this file's regex
    // literals, so the comments are dropped LINE-WISE here instead: every line of this
    // switch that is a comment starts with `//` or `*`, and dropping them is what keeps a
    // prose mention of `answerStored` from standing in for a call to it.
    const uncomment = (code) => code.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    const armsOf = (code) => {
      const start = code.indexOf('const what = q(req, "what")');
      const end = code.indexOf("unknown what=", start);
      assert.ok(start >= 0 && end > start, "the GET `what` switch must still be findable");
      const region = uncomment(code.slice(start, end));
      return region.split(/\n(?=\s*if \(what === )/).filter((a) => /if \(what === /.test(a));
    };
    const readsStorage = (arm) => /storage\.(get|query)\(|readLogs\(/.test(arm);
    const arms = armsOf(src);
    assert.ok(arms.length >= 5, `the scanner must SEE the arms (found ${arms.length})`);
    const storedArms = arms.filter(readsStorage);
    assert.equal(storedArms.length, 5,
      "five arms read storage: registry, provider, logs, execlogs, kvs — a sixth needs a judgement, not a silent pass");
    const bypassing = storedArms.filter((arm) => !/answerStored\(/.test(arm));
    assert.deepEqual(bypassing.map((a) => (/if \(what === "([a-z]+)"/.exec(a) || [])[1] || a.slice(0, 60)), [],
      "a GET arm returns a stored row without the ONE read ceiling — route it through `answerStored`");
    // POSITIVE CONTROL: the pre-fix shape of `?what=registry` IS caught by this gate.
    const preFix = 'const what = q(req, "what") || "registry";\n'
      + '    if (what === "registry") return json(200, { registry: (await storage.get("config_registry")) || [] });\n'
      + '    return json(400, { error: `unknown what=${what}` });';
    const preArms = armsOf(preFix).filter(readsStorage);
    assert.equal(preArms.length, 1);
    assert.equal(/answerStored\(/.test(preArms[0]), false,
      "POSITIVE CONTROL: the exact pre-fix arm — a raw `json(200, {registry: await storage.get(...)})` — is still SEEN as a bypass");
  });
  await check("MECHANISM: every POST action that reads storage answers through the same ceiling (F-806)", async () => {
    /* F-806 — THE SECOND CLASS OF DOOR. F-802 gated the GET `what` switch and left the POST
     * action map outside it: `readHarnessProbe`, `readProbe`, the `pipelineRow` and
     * `vaTombstone` reads and the `kvSet` echo all `storage.get` and all answered on their
     * own. Nothing leaked — those rows are harness-PLANTED and `findPlantedSecret` refuses a
     * credential in the plant body — but that is a property of the WRITE, not of the read.
     * Same scanner as the GET gate, same judgement: an action that reads storage either
     * projects its answer, or is named here as one that answers no stored content. */
    const src = readFileSync(new URL("../../src/test-hook.js", import.meta.url), "utf8");
    const uncomment = (code) => code.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    const blocksOf = (code) => {
      const start = code.indexOf('if (body.action === "probe")');
      const end = code.indexOf("unknown POST action=");
      assert.ok(start >= 0 && end > start, "the POST action map must still be findable");
      return uncomment(code.slice(start, end))
        .split(/\n(?=\s*if \(body\.action === )/)
        .filter((b) => /if \(body\.action === /.test(b));
    };
    const namesOf = (b) => [...new Set([...b.matchAll(/body\.action === "([A-Za-z]+)"/g)].map((m) => m[1]))].join("|");
    const readsStorage = (b) => /storage\.(get|query)\(/.test(b);
    // The FOUR named projections, and nothing else, may put a stored row on the wire:
    // `storedFields` (the POST spread), `answerStored` (the GET envelope), `readCeiling`
    // (the rule itself) and `answerFingerprintOnly` (strictly tighter — the row is never
    // answered at all; kvStash/kvRestore move a value by NAME).
    const projects = (b) => /storedFields\(|answerStored\(|readCeiling\(|answerFingerprintOnly\(/.test(b);

    const blocks = blocksOf(src);
    assert.ok(blocks.length >= 40, `the scanner must SEE the action map (found ${blocks.length} blocks)`);
    const reading = blocks.filter(readsStorage).map((b) => ({ name: namesOf(b), projects: projects(b) }));
    /* THE CENSUS. A new action that reads storage lands in neither list and fails here —
     * which is the judgement this gate exists to force, exactly as its GET sibling does. */
    const ANSWERS_NO_STORED_CONTENT = [
      // `invokeResolver` reads the Coder ticket/thread rows and the pipeline row only to
      // ask BOOLEANS of them (`ticket.simulation === true`, `pipelineOutdated(row)`); the
      // rows themselves are never answered, so there is nothing to project.
      "invokeResolver",
      // F-824 - `clearHarnessProbe` reads the row only to say whether there WAS one
      // (`present`, a boolean the driver asserts a clear against); the row itself is
      // deleted, never answered, so there is nothing to project.
      "clearHarnessProbe",
    ];
    // ("kvStash" is the chunk that carries the kvRestore tail too — the split lands on the
    //  NESTED `if (body.action === "kvStash")`, and both reads live below it. F-639's
    //  "knowledgeSnapshot" chunk carries its own `knowledgeRestore` tail the same way, for
    //  the same reason — it is built in the shape of the stash door it was modelled on.)
    assert.deepEqual(reading.map((r) => r.name).sort(),
      ["clearHarnessProbe", "invokeResolver", "knowledgeSnapshot", "kvSet", "kvStash", "pipelineRow", "readHarnessProbe", "readProbe", "vaTombstone"].sort(),
      "the set of POST actions that read storage changed — each one needs a judgement, not a silent pass");
    const bypassing = reading.filter((r) => !r.projects && !ANSWERS_NO_STORED_CONTENT.includes(r.name));
    assert.deepEqual(bypassing.map((r) => r.name), [],
      "a POST action answers a stored row without the ONE read ceiling — route it through `storedFields`");

    // POSITIVE CONTROL: the exact pre-fix `readHarnessProbe` answer IS still seen as a bypass.
    const preFix = 'if (body.action === "probe") { return json(200, {}); }\n'
      + '    if (body.action === "readHarnessProbe") {\n'
      + '      return json(200, { id, kind, key, value: (await storage.get(key)) || null });\n'
      + '    }\n'
      + '    return json(400, { error: `unknown POST action=${body.action}` });';
    const preBlocks = blocksOf(preFix).filter(readsStorage);
    assert.equal(preBlocks.length, 1);
    assert.equal(projects(preBlocks[0]), false,
      "POSITIVE CONTROL: the pre-fix readHarnessProbe line — a raw `value: await storage.get(key)` — is still SEEN as a bypass");
    // …and the shipped one is not.
    const post = blocks.filter((b) => namesOf(b) === "readHarnessProbe");
    assert.equal(post.length, 1);
    assert.equal(projects(post[0]), true, "…while the shipped readHarnessProbe projects its answer");
  });
  /* F-824 - A PROBE ROW OUTLIVED ITS TTL, AND NOTHING COULD CLEAR IT.
   *
   * The consumer wrote `harness_probe:<kind>:<id>` with a 10-minute KVS TTL and the door
   * answered whatever KVS still held - a row was read back 12.4 minutes after it was
   * written, because platform expiry is LAZY. `harness_probe:` is not on the `kvSet` write
   * allow-list either, so a stale plant could only be waited out. The row now stamps its
   * own `until` (F-664's fault-row shape), the read door treats a past `until` as ABSENT
   * and says `expired:true`, and `clearHarnessProbe` removes one. */
  await check("BLOCK: the probe doors honour the row's OWN window, and one of them clears it (F-824)", async () => {
    /* THE DOORS ARE NOT DRIVABLE HERE, AND THAT IS STATED RATHER THAN PAPERED OVER.
     * Both `readHarnessProbe` and `clearHarnessProbe` do `await import("./async-handler.js")`
     * for the key builder, and that module statically imports the EXTENSIONLESS specifier
     * `"./index"`, which Node's ESM resolver refuses under this suite's loader (the same
     * reason the `?what=execlogs` check above states; src/index.js belongs to another cut).
     * So what is asserted is the SHAPE of the two doors, and the expiry rule itself is
     * driven by its own unit checks in async-handler-helpers.test.mjs. */
    const src = readFileSync(new URL("../../src/test-hook.js", import.meta.url), "utf8");
    const arm = (name) => {
      const at = src.indexOf(`body.action === "${name}"`);
      assert.ok(at > 0, `${name} must exist`);
      return src.slice(at, at + 1200);
    };
    const read = arm("readHarnessProbe");
    assert.match(read, /harnessProbeExpired/, "the read door asks the ONE expiry predicate rather than keeping a copy of the window");
    assert.match(read, /expired \? null : stored/, "…and an expired row is answered ABSENT, not as a live measurement");
    assert.match(read, /expired,/, "…with `expired` REPORTED, exactly as readHarnessFault does — a driver is entitled to know its row ended on its own window");
    assert.match(read, /storedFields\(/, "…still through the ONE read ceiling (F-806)");
    const clear = arm("clearHarnessProbe");
    assert.match(clear, /harnessProbeKey\(kind, id\)/, "the clear door builds its key with the ONE builder — no caller ever names the keyspace");
    assert.match(clear, /storage\.delete\(key\)/, "…and deletes exactly that row");
    assert.match(clear, /id required/, "…refusing a malformed id rather than deleting some other key");
    // Both doors are behind the HARNESS_SECRET gate, like every other action.
    const gate = src.indexOf("if (!secret) return notFound();");
    assert.ok(gate > 0 && src.indexOf('body.action === "clearHarnessProbe"') > gate,
      "the clear door is inside the gated POST block");
    // …and the keyspace is still NOT writable through kvSet: a driver may clear a probe, never forge one.
    const setRes = await POST({ action: "kvSet", key: "harness_probe:confluence:forged", value: { status: 200 } });
    assert.notEqual(setRes.statusCode, 200, "a probe row must not be writable through the allow-listed write door");
  });
  await check("kvStash/kvRestore move a credential by NAME, never by value (F-769)", async () => {
    // THE DRIVER THIS DOOR EXISTS FOR: va-compaction-live.mjs replaces the BYOK key with a
    // deliberately dead one to drive F-506's scenario, and must put the tenant's own key
    // back in its `finally`. With the value masked it can no longer snapshot it — so the
    // value moves server-side and is addressed by an opaque id.
    const SLOT = "COGNIRUNNER_KEY_openai";
    const REAL = "zz-the-tenants-own-key-zz";
    storage.__seed(SLOT, REAL);

    const stashed = JSON.parse((await POST({ action: "kvStash", key: SLOT })).body);
    assert.equal(stashed.stashed, true);
    assert.equal(stashed.present, true, "the door reports the row WAS there");
    assert.equal(typeof stashed.stashId === "string" && stashed.stashId.length > 0, true, "an opaque, server-minted id");
    assert.match(stashed.fingerprint, /^[0-9a-f]{16}$/);
    assert.equal(JSON.stringify(stashed).includes(REAL), false, "the stash answer carries no value");

    // The driver now plants its OWN dead key through the ordinary write door…
    await kvSet(SLOT, "sk-harness-deliberately-dead-key-0000");
    assert.equal(storage.__raw(SLOT), "sk-harness-deliberately-dead-key-0000");
    // …and the stash row itself is NOT readable back out through the read door.
    const peek = JSON.parse((await kvsRead(`harness_stash:${stashed.stashId}`)).body);
    assert.equal(peek.masked, true, "harness_stash:* is itself a credential family — the stash is not a new leak");
    assert.equal("value" in peek, false);

    const restored = JSON.parse((await POST({ action: "kvRestore", stashId: stashed.stashId })).body);
    assert.equal(restored.restored, true);
    assert.equal(restored.key, SLOT, "the key came from the STASH, not from the caller");
    assert.equal(restored.fingerprint, stashed.fingerprint, "the round trip was byte-identical — provable without ever reading the value");
    assert.equal(JSON.stringify(restored).includes(REAL), false, "the restore answer carries no value either");
    assert.equal(storage.__raw(SLOT), REAL, "the tenant's own key is back");
    // A stash is single-use: the row is gone, so a replay cannot resurrect an old value.
    assert.equal((await POST({ action: "kvRestore", stashId: stashed.stashId })).statusCode, 404, "a consumed stash is gone");
  });
  /* ═══════════════════════════════════════════════════════════════════════════════
   * F-639 — THE KNOWLEDGE RESTORE DUTY IS A MECHANISM, NOT A DOCBLOCK.
   *
   * Six mutators are on the `invokeResolver` allow-list (`saveSkill`, `deleteSkill`,
   * `deleteContextDoc`, `saveListener`, `deleteScheduledJob`, `addMemory`) and the only
   * thing that ever put the tenant back is a sentence telling drivers to. A driver that
   * deletes a builtin doc and dies before its `finally` leaves the tenant changed.
   * `knowledgeSnapshot`/`knowledgeRestore` is the `kvStash`/`kvRestore` answer aimed at
   * the knowledge store: the rows move server-side, by name, and never on the wire.
   * ═══════════════════════════════════════════════════════════════════════════════ */
  await check("ALLOW: snapshot -> mutate -> restore round-trips knowledge rows byte-identically (F-639)", async () => {
    const DOC_INDEX = "doc_repo_index";
    const DOC = "doc_repo:builtin-adf";
    const SKILLS = "skill_repo_index";
    const MEM = "pf_memories";
    const INDEX_ROWS = [{ id: "builtin-adf", title: "ADF cookbook", builtin: true }];
    const DOC_ROW = { id: "builtin-adf", title: "ADF cookbook", content: "the tenant's own words", builtin: true };
    storage.__seed(DOC_INDEX, INDEX_ROWS);
    storage.__seed(DOC, DOC_ROW);
    storage.__seed(SKILLS, [{ id: "s1", name: "Jira REST" }]);
    await storage.delete(MEM);   // ABSENT is a state, and it must round-trip as absent

    const snap = JSON.parse((await POST({ action: "knowledgeSnapshot", keys: [DOC_INDEX, DOC, SKILLS, MEM] })).body);
    assert.equal(snap.ok, true);
    assert.equal(snap.snapshot, true);
    assert.equal(typeof snap.snapshotId === "string" && snap.snapshotId.length > 0, true, "an opaque, server-minted id");
    assert.deepEqual(snap.keys, [DOC_INDEX, DOC, SKILLS, MEM], "the door answers WHICH rows it holds");
    assert.equal(snap.count, 4);
    assert.equal(snap.presentCount, 3, "…and how many were there — a count, never a content");
    assert.match(snap.fingerprint, /^[0-9a-f]{16}$/);
    assert.equal(snap.ttlSeconds, 3600, "the same TTL the stash family asks for — one home");
    // THE CONTENT NEVER CROSSES THE WIRE. The read ceiling's rule is not suspended because
    // the row is a doc rather than a credential.
    const answer = JSON.stringify(snap);
    assert.equal(answer.includes("the tenant's own words"), false, "the snapshot answer carries no row content");
    assert.equal(answer.includes("ADF cookbook"), false, "…not even a title");
    assert.equal("rows" in snap || "value" in snap, false);
    // …and the snapshot ROW is not readable back out either: it lives in the `harness_stash:*`
    // family, which the read ceiling already masks. That reuse is the point of the prefix.
    const peek = JSON.parse((await kvsRead(`harness_stash:snap-${snap.snapshotId}`)).body);
    assert.equal(peek.masked, true, "a snapshot row is a harness_stash:* row — masked, like a stash");
    assert.equal("value" in peek, false);

    // THE DRIVER NOW DOES WHAT IT CAME FOR: it deletes a builtin doc and rewrites the index,
    // which is exactly the mutation `deleteContextDoc` performs through `invokeResolver`.
    await storage.delete(DOC);
    storage.__seed(DOC_INDEX, []);
    storage.__seed(SKILLS, [{ id: "s1", name: "MUTATED" }]);
    storage.__seed(MEM, [{ id: "m1", text: "planted while snapshot was held" }]);

    const back = JSON.parse((await POST({ action: "knowledgeRestore", snapshotId: snap.snapshotId })).body);
    assert.equal(back.ok, true);
    assert.equal(back.restored, true);
    assert.deepEqual(back.keys, [DOC_INDEX, DOC, SKILLS, MEM], "the keys came from the SNAPSHOT, not from the caller");
    assert.equal(back.fingerprint, snap.fingerprint,
      "the round trip was byte-identical — provable without either door ever reading a row out");
    assert.equal(JSON.stringify(back).includes("the tenant's own words"), false, "the restore answer carries no content either");
    assert.deepEqual(storage.__raw(DOC), DOC_ROW, "the deleted builtin doc is back, byte for byte");
    assert.deepEqual(storage.__raw(DOC_INDEX), INDEX_ROWS, "…and so is the index the driver rewrote");
    assert.deepEqual(storage.__raw(SKILLS), [{ id: "s1", name: "Jira REST" }]);
    assert.equal(storage.__raw(MEM), undefined,
      "…and a row that was ABSENT is restored as ABSENT, not as null — the tenant is as it was FOUND");
    // SINGLE USE, exactly as a stash is: a replay cannot resurrect an old copy of the store.
    assert.equal((await POST({ action: "knowledgeRestore", snapshotId: snap.snapshotId })).statusCode, 404,
      "a consumed snapshot is gone");
  });
  await check("BLOCK: a snapshot may only name a knowledge row, and the two restore doors do not cross (F-639)", async () => {
    /* THE AUTHORISATION HALF. The families are the rows the six mutators touch, and
       nothing else: not a credential (that is `kvStash`'s job and its own allow-list),
       not the registry, not the logs, not `pf_code:*`, not a provider slot. */
    for (const key of ["COGNIRUNNER_KEY_openai", "git_conn_secret:c1", "config_registry",
                       "validation_logs", "pf_code:r1:abc", "harness_stash:whatever", "doc_repo:"]) {
      const res = await POST({ action: "knowledgeSnapshot", keys: [key] });
      assert.equal(res.statusCode, 400, `${key} must be refused by the snapshot door`);
      assert.match(JSON.parse(res.body).error, /not a knowledge row/, `${key}: refused on AUTHORISATION`);
    }
    // `doc_repo:` above is the bare PREFIX: a family name is not a member of itself, and a
    // row with an empty id is one the product can neither read nor clean up.
    // The shape door applies here too — "/" is illegal and is NAMED, never thrown.
    const illegal = JSON.parse((await POST({ action: "knowledgeSnapshot", keys: ["doc_repo:a/b"] })).body);
    assert.equal(illegal.error, "bad-request");
    assert.equal(illegal.field, "key");
    // …and the body shape is a named 400 rather than a stack trace.
    assert.equal(JSON.parse((await POST({ action: "knowledgeSnapshot", keys: [] })).body).field, "keys");
    assert.equal(JSON.parse((await POST({ action: "knowledgeSnapshot" })).body).field, "keys");
    const many = JSON.parse((await POST({ action: "knowledgeSnapshot", keys: Array.from({ length: 41 }, (_x, i) => `doc_repo:d${i}`) })).body);
    assert.equal(many.field, "keys");
    assert.match(many.reason, /at most 40/, "the cap is stated, not discovered at the platform");
    assert.equal(JSON.parse((await POST({ action: "knowledgeRestore" })).body).field, "snapshotId");
    assert.equal((await POST({ action: "knowledgeRestore", snapshotId: "no-such-snapshot" })).statusCode, 404,
      "unknown, consumed and expired are ONE answer — the driver no longer holds the rows");

    /* THE TWO DOORS DO NOT CROSS, in both directions. They share the `harness_stash:*`
       prefix family on purpose (one TTL, one sweeper, one read ceiling); the id marker and
       the row `kind` are what keep a snapshot id from being a credential write door. */
    storage.__seed("COGNIRUNNER_KEY_openai", "zz-the-tenants-own-key-zz");
    const stash = JSON.parse((await POST({ action: "kvStash", key: "COGNIRUNNER_KEY_openai" })).body);
    assert.equal((await POST({ action: "knowledgeRestore", snapshotId: stash.stashId })).statusCode, 404,
      "a kvStash id is not a knowledge snapshot — it has no `kind`");
    storage.__seed("skill_repo_index", [{ id: "s1" }]);
    const snap = JSON.parse((await POST({ action: "knowledgeSnapshot", keys: ["skill_repo_index"] })).body);
    assert.equal((await POST({ action: "kvRestore", stashId: `snap-${snap.snapshotId}` })).statusCode, 404,
      "…and a snapshot row is not a stash — it has no `key`, so kvRestore will not write from it");
    assert.equal((await POST({ action: "kvRestore", stashId: snap.snapshotId })).statusCode, 404,
      "…nor under its bare id");
    // The tenant's own key is still where it was: neither cross-attempt wrote anything.
    assert.equal(storage.__raw("COGNIRUNNER_KEY_openai"), "zz-the-tenants-own-key-zz");
    /* …and this check discharges its OWN duty, which is the whole point of the finding:
       both rows it opened are consumed, so it leaves no `harness_stash:*` behind for the
       sweep checks below to trip over. A test that plants and walks away is the defect. */
    assert.equal((await POST({ action: "kvRestore", stashId: stash.stashId })).statusCode, 200);
    assert.equal((await POST({ action: "knowledgeRestore", snapshotId: snap.snapshotId })).statusCode, 200);
  });
  await check("BLOCK: a snapshot too large to store is refused BEFORE it is written (F-639)", async () => {
    /* THE `commitImportCore` LESSON, applied to this door: a refused snapshot must not
       leave a driver believing it holds the tenant's rows. The cap is asked BEFORE the
       platform, through the ONE home (`kvsValueRefusal`), so the answer NAMES the field
       and carries a measurement — and no `harness_stash:*` row is written at all. */
    /* Counted for real, over the prefix family itself — never behind an `if (mock supports it)`,
       which is a skipped assertion wearing the costume of a passing one. */
    const stashRows = async () => (await storage.query().where("key", { values: ["harness_stash:"] }).limit(100).getMany()).results.length;
    const before = await stashRows();
    storage.__seed("doc_repo:huge", { content: "x".repeat(250 * 1024) });
    const res = await POST({ action: "knowledgeSnapshot", keys: ["doc_repo:huge"] });
    assert.equal(res.statusCode, 400);
    const body = JSON.parse(res.body);
    assert.equal(body.error, "snapshot-too-large");
    assert.equal(body.field, "value", "…named through the one home, so the field names match the other doors");
    assert.match(body.reason, /[0-9]/, "…and it says how big, which is a measurement rather than a disclosure");
    assert.equal("snapshotId" in body, false, "a refused snapshot hands back no id to restore from");
    assert.equal(await stashRows(), before,
      "…and nothing was written: the cap is checked BEFORE the side effect");
    await storage.delete("doc_repo:huge");
  });
  await check("kvStash refuses what kvSet refuses, and an unknown stash (F-769)", async () => {
    // The stash door WRITES, so it may not reach a row the write allow-list excludes.
    // `git_conn_secret:*` / `git_hook_secret:*` are the F-339 line: never plantable, and
    // therefore never stashable either.
    for (const key of ["git_conn_secret:c1", "git_hook_secret:c1:r1", "config_registry", "app_admins"]) {
      const res = await POST({ action: "kvStash", key });
      assert.equal(res.statusCode, 400, `${key} must be refused by the stash door`);
      assert.match(JSON.parse(res.body).error, /not allowlisted/, `${key}: refused on AUTHORISATION`);
    }
    // The shape door applies here too — "/" is illegal and is named, not thrown.
    const illegal = JSON.parse((await POST({ action: "kvStash", key: "acme/app" })).body);
    assert.equal(illegal.error, "bad-request");
    assert.equal(illegal.field, "key");
    // An unknown or expired stash is one answer, and it is not a 500.
    assert.equal((await POST({ action: "kvRestore", stashId: "no-such-stash" })).statusCode, 404);
    const noId = JSON.parse((await POST({ action: "kvRestore" })).body);
    assert.equal(noId.field, "stashId", "a missing stashId is a named 400");
    // Restoring a stash taken of an ABSENT row DELETES the key — "there was nothing here"
    // and "there was a null here" are different states, and only one is what was found.
    await storage.delete("COGNIRUNNER_KEY_azure");
    const s2 = JSON.parse((await POST({ action: "kvStash", key: "COGNIRUNNER_KEY_azure" })).body);
    assert.equal(s2.present, false);
    await kvSet("COGNIRUNNER_KEY_azure", "planted-while-stashed");
    await POST({ action: "kvRestore", stashId: s2.stashId });
    assert.equal(storage.__raw("COGNIRUNNER_KEY_azure"), undefined, "the absent state is restored as ABSENT, not as null");
  });
  await check("the stash door stays behind HARNESS_SECRET (F-769)", async () => {
    for (const body of [{ action: "kvStash", key: "COGNIRUNNER_KEY_openai" }, { action: "kvRestore", stashId: "x" }]) {
      const res = await testStateTrigger({ method: "POST", headers: { authorization: ["Bearer wrong-secret"] }, body: JSON.stringify(body) });
      assert.equal(res.statusCode, 404, `${body.action} must be invisible without the secret`);
    }
    // …and so does the masked read: a wrong secret gets no fingerprint either.
    const read = await testStateTrigger({
      method: "GET", headers: { authorization: ["Bearer wrong-secret"] },
      queryParameters: { what: ["kvs"], key: ["COGNIRUNNER_KEY_openai"] },
    });
    assert.equal(read.statusCode, 404);
  });
  /* ═══════════════════════════════════════════════════════════════════════════════
   * F-780 — ONE FINGERPRINT, ONE SERIALISATION, BOTH DOORS.
   *
   * Two homes for "the sha256-16 of this secret" in one file, disagreeing on the
   * serialisation: `?what=kvs` hashed `JSON.stringify(value)` (a string arrives QUOTED)
   * and the githooks URL mask hashed the raw string. A driver proving a hook still points
   * at the same trigger compares `urlMasked.fingerprint` against the fingerprint of
   * `webtrigger_url:git-webhook` — both documented as "the sha256-16 of this URL", both
   * masked under the same doctrine — and got a guaranteed mismatch for a byte-identical
   * URL. An equality check that always reports a change is worse than no check.
   * ═══════════════════════════════════════════════════════════════════════════════ */
  await check("a string fingerprints identically through BOTH doors (F-780)", async () => {
    const URL_VALUE = "https://x.atlassian-dev.net/x1/zz-trigger-token-zz";
    // DOOR ONE — the masked read of the stored capability URL.
    storage.__seed("webtrigger_url:git-webhook", URL_VALUE);
    const viaKvs = JSON.parse((await kvsRead("webtrigger_url:git-webhook")).body);
    assert.equal(viaKvs.masked, true, "premise: a webtrigger_url row is masked");
    assert.match(viaKvs.fingerprint, /^[0-9a-f]{16}$/);
    // DOOR TWO — the helper both doors now share, asked on the same bytes.
    const { credentialFingerprint, fingerprintInput } = await import("../../src/test-hook.js");
    assert.equal(await credentialFingerprint(URL_VALUE), viaKvs.fingerprint,
      "the SAME URL through the two doors is the SAME fingerprint — this is the finding");
    // THE SERIALISATION, documented and asserted: a string is itself, never its JSON.
    assert.equal(fingerprintInput(URL_VALUE), URL_VALUE, "a string fingerprints as ITSELF, not as a quoted JSON string");
    assert.notEqual(await credentialFingerprint(URL_VALUE), await credentialFingerprint(JSON.stringify(URL_VALUE)),
      "…which is a real distinction, not a no-op: the quoted form is a DIFFERENT value");
    // …and an object is CANONICAL json, so key order cannot change a fingerprint.
    assert.equal(fingerprintInput({ b: 1, a: 2 }), '{"a":2,"b":1}');
    assert.equal(await credentialFingerprint({ url: "u", apiKey: "k" }), await credentialFingerprint({ apiKey: "k", url: "u" }),
      "a row that came back from KVS with its keys in another order is the SAME row");
    assert.notEqual(await credentialFingerprint({ url: "u", apiKey: "k" }), await credentialFingerprint({ url: "u", apiKey: "K" }),
      "…while a changed value is still a changed fingerprint");
    assert.equal(await credentialFingerprint(null), null, "absent is one answer, not a hash of the string null");
  });
  await check("the sha256-16 fingerprint has exactly ONE home in the hook (F-780)", async () => {
    const code = stripJsComments(readFileSync(new URL("../../src/test-hook.js", import.meta.url), "utf8"));
    const truncated = (code.match(/digest\("hex"\)\.slice\(0, 16\)/g) || []).length;
    assert.equal(truncated, 1, `a second sha256-16 is a second serialisation waiting to disagree (found ${truncated})`);
    assert.match(code, /createHmac\("sha256", await fingerprintKey\(\)\)\.update\(fingerprintInput\(value\)\)/,
      "…and the one home keys the HMAC (F-781) over the DOCUMENTED serialisation, not a raw JSON.stringify");
  });
  /* ═══════════════════════════════════════════════════════════════════════════════
   * F-781 — THE FINGERPRINT IS KEYED, BECAUSE AN UNSALTED HASH IS A GUESS ORACLE.
   *
   * 64 bits is far too little to brute a key back out of — true of a PREIMAGE search, and
   * beside the point. The attack is a GUESS CHECK: hash your candidate, compare. The
   * values behind these rows are not all high-entropy — `probe:webhook:secret` is an HMAC
   * secret a TESTER types — so a reader holding the harness secret could recover one from
   * a wordlist offline and then forge a signed request at the UNAUTHENTICATED
   * `gitWebhookProbe` door. Keyed under `HARNESS_SECRET`, that wordlist is useless.
   * ═══════════════════════════════════════════════════════════════════════════════ */
  await check("the fingerprint is keyed per installation, so it is not a guess oracle (F-781)", async () => {
    const { credentialFingerprint } = await import("../../src/test-hook.js");
    const GUESSABLE = "s3cr3t";
    const here781 = await credentialFingerprint(GUESSABLE);
    // THE ORACLE, SHUT: the bare digest an attacker computes offline is NOT the answer.
    const { createHash } = await import("node:crypto");
    const bare = createHash("sha256").update(GUESSABLE).digest("hex").slice(0, 16);
    assert.notEqual(here781, bare, "a wordlist candidate hashed offline no longer matches — this is the finding");
    assert.match(here781, /^[0-9a-f]{16}$/, "…and the shape drivers parse is unchanged");
    // EQUALITY SEMANTICS ARE UNTOUCHED, which is what the witness library compares.
    assert.equal(await credentialFingerprint(GUESSABLE), here781, "same value, same run, same fingerprint");
    assert.notEqual(await credentialFingerprint(GUESSABLE + "!"), here781, "a changed value still changes it");
    // …AND THE KEY IS THE INSTALLATION'S. Rotate the secret and the fingerprint moves —
    // the documented cost: fingerprints compare within ONE installation, and only while
    // the secret is unchanged. Every use in this repo compares within a single run.
    const secretNow = process.env.HARNESS_SECRET;
    try {
      process.env.HARNESS_SECRET = "a-different-installations-secret";
      assert.notEqual(await credentialFingerprint(GUESSABLE), here781,
        "another installation fingerprints the SAME value differently — that is the salt");
    } finally { process.env.HARNESS_SECRET = secretNow; }
    assert.equal(await credentialFingerprint(GUESSABLE), here781, "…and restoring the secret restores comparability");
    // The secret is never the HMAC key directly, so no answer is computed under the bearer token.
    const code781 = stripJsComments(readFileSync(new URL("../../src/test-hook.js", import.meta.url), "utf8"));
    assert.match(code781, /createHash\("sha256"\)\.update\("cognirunner:test-hook:fingerprint:v1[\s\S]{0,40}process\.env\.HARNESS_SECRET/,
      "the HMAC key is a domain-separated DERIVATION of HARNESS_SECRET, never the secret itself");
    assert.equal(/createHmac\("sha256", (?:String\()?process\.env\.HARNESS_SECRET/.test(code781), false,
      "…asserted against the shortcut, not just for today's spelling");
  });
  await check("a masked read still answers a keyed fingerprint end to end (F-781)", async () => {
    const { credentialFingerprint } = await import("../../src/test-hook.js");
    storage.__seed("probe:webhook:secret", "s3cr3t");
    const read = JSON.parse((await kvsRead("probe:webhook:secret")).body);
    assert.equal(read.masked, true);
    assert.equal(read.fingerprint, await credentialFingerprint("s3cr3t"),
      "the door answers the ONE helper's value — the keying is not a second home either");
    const { createHash } = await import("node:crypto");
    assert.notEqual(read.fingerprint, createHash("sha256").update("s3cr3t").digest("hex").slice(0, 16),
      "…and what reaches the wire is not the bare digest a wordlist would produce");
  });
  /* ═══════════════════════════════════════════════════════════════════════════════
   * F-779 — THE STASH TTL IS A GUARANTEE, AND SOMETHING FINALLY ENUMERATES THE KEYSPACE.
   *
   * The TTL was best-effort with a PERMANENT fallback: when `storage.set(..., ttl)` threw,
   * the catch re-wrote the same row with no expiry and the 200 still said `ttlSeconds: 3600`.
   * A driver that stashed the tenant's live BYOK key, got a refused TTL, and was then killed
   * before its restore left that key in plaintext under `harness_stash:{id}` FOREVER — masked
   * to `?what=kvs` (it is a credential family), unreachable by `sweepHarnessFaults` (a
   * different prefix), and recorded in the driver's evidence as expiring in an hour.
   * ═══════════════════════════════════════════════════════════════════════════════ */
  const listStashes = async () => JSON.parse((await POST({ action: "stashSweep", dryRun: true })).body).rows;
  await check("a refused TTL is a REFUSED stash, and plants nothing (F-779)", async () => {
    const SLOT = "COGNIRUNNER_KEY_openai";
    const REAL = "zz-the-tenants-own-key-zz";
    storage.__seed(SLOT, REAL);
    // The platform refuses the TTL OPTION — the exact fault the old catch arm swallowed.
    storage.__failSetWhen((key) => String(key).startsWith("harness_stash:"), Object.assign(new Error("ttl option rejected"), { name: "ForgeKvsError", code: "INVALID_TTL" }));
    const res = await POST({ action: "kvStash", key: SLOT });
    assert.equal(res.statusCode, 424, "a stash that cannot be given a TTL is REFUSED, not silently made permanent");
    const body = JSON.parse(res.body);
    assert.equal(body.ok, false);
    assert.equal(body.stashed, false, "…and says so, so the driver does not go on to plant a fault it cannot undo");
    assert.equal(body.error, "stash-ttl-unavailable");
    assert.equal("ttlSeconds" in body, false, "no TTL was applied, so none is claimed");
    assert.equal(body.reason, "INVALID_TTL", "the error CLASS, never its message");
    assert.equal(JSON.stringify(body).includes(REAL), false, "the refusal carries no value either");
    // AND NOTHING WAS LEFT BEHIND. This is the finding: the old code's fallback write.
    const stashes = await listStashes();
    assert.deepEqual(stashes, [], "no partial stash row survives the refusal");
    assert.equal(storage.__raw(SLOT), REAL, "the tenant's own key is untouched — the stash never got as far as replacing anything");
  });
  /* ═══════════════════════════════════════════════════════════════════════════════
   * F-789 — THE REFUSAL ASSERTED A CAUSE THE FAILURE DID NOT CONTAIN.
   *
   * `error` was the literal "stash-ttl-unavailable" for ANY throw out of the stash write.
   * A KVS throttle, a value-too-large, a transient platform error: all three told the
   * driver that this installation has no TTL support — the one cause F-779 had named — and
   * an operator reads that and goes and reworks the TTL. And the compensating delete of
   * whatever partially landed had an EMPTY catch, so a plaintext row that could not be
   * removed looked exactly like one that was, with no `stashId` in the 424 to find it by.
   * ═══════════════════════════════════════════════════════════════════════════════ */
  await check("a stash refusal names the failure it actually had, and reports its compensation (F-789)", async () => {
    const SLOT = "COGNIRUNNER_KEY_openai";
    const REAL = "zz-the-tenants-own-key-zz";
    const { harnessStashKey } = await import("../../src/harness-fault.js");

    // BLOCK 1 — a THROTTLE is not a missing TTL.
    storage.__seed(SLOT, REAL);
    storage.__failSetWhen((key) => String(key).startsWith("harness_stash:"),
      Object.assign(new Error("rate limited"), { name: "ForgeKvsError", code: "THROTTLED" }));
    const throttled = JSON.parse((await POST({ action: "kvStash", key: SLOT })).body);
    assert.equal(throttled.error, "stash-write-failed",
      "a throttle is a WRITE failure — telling the driver the TTL is unavailable sends it to rework the one thing that was fine");
    assert.equal(throttled.reason, "THROTTLED", "…and the class itself still rides along, so a caller is not limited to our two-way split");
    // THROTTLED literally CONTAINS the letters t-t-l. The split reads a delimited token, not
    // a substring — a naive test re-commits F-789 inside the fix for it.
    assert.equal(throttled.stashed, false);
    assert.equal(throttled.compensation, "deleted", "the partial row was removed, and the answer SAYS so rather than implying it");
    assert.equal(typeof throttled.stashId, "string");
    assert.ok(throttled.stashId.length > 0, "the id of the row the failed write was aimed at comes back");
    assert.deepEqual(await listStashes(), [], "nothing was left behind");
    assert.equal(storage.__raw(SLOT), REAL, "and the tenant's own key is untouched");

    // BLOCK 2 — a TTL refusal still reads as one. The split is on the CLASS, not on a guess.
    storage.__failSetWhen((key) => String(key).startsWith("harness_stash:"),
      Object.assign(new Error("no ttl here"), { name: "ForgeKvsError", code: "TTL_NOT_SUPPORTED" }));
    const noTtl = JSON.parse((await POST({ action: "kvStash", key: SLOT })).body);
    assert.equal(noTtl.error, "stash-ttl-unavailable", "a class that names the TTL is the cause F-779 named");
    assert.equal(noTtl.reason, "TTL_NOT_SUPPORTED");
    assert.equal(noTtl.compensation, "deleted");

    // BLOCK 3 — the compensation ITSELF fails. This is the arm that used to be an empty
    // catch, and the state it hides is a plaintext credential row nobody can see.
    storage.__failSetWhen((key) => String(key).startsWith("harness_stash:"),
      Object.assign(new Error("rate limited"), { name: "ForgeKvsError", code: "THROTTLED" }));
    const realDelete = storage.delete;
    storage.delete = async (key) => {
      if (String(key).startsWith("harness_stash:")) throw Object.assign(new Error("nope"), { name: "ForgeKvsError", code: "THROTTLED" });
      return realDelete.call(storage, key);
    };
    let stranded;
    try {
      stranded = JSON.parse((await POST({ action: "kvStash", key: SLOT })).body);
    } finally {
      storage.delete = realDelete;
    }
    assert.equal(stranded.error, "stash-write-failed");
    assert.equal(stranded.compensation, "delete-failed:THROTTLED",
      "a compensation that did not land is REPORTED — the empty catch made this indistinguishable from a clean refusal");
    assert.ok(typeof stranded.stashId === "string" && stranded.stashId.length > 0,
      "…and the stashId is the handle, because a partial row is otherwise reachable only by stashSweep and only after its age floor");
    // The handle is USABLE: the id names the row an operator or a restore would clear.
    storage.__seed(harnessStashKey(stranded.stashId), { key: SLOT, value: REAL, present: true, stashedAt: new Date().toISOString() });
    assert.equal(JSON.parse((await POST({ action: "kvRestore", stashId: stranded.stashId })).body).restored, true,
      "the id in the 424 finds the row — which is what the refusal withholding it cost");
    assert.deepEqual(await listStashes(), [], "and the restore cleared it");
  });
  await check("a stash that IS given a TTL reports the TTL it actually got (F-779)", async () => {
    const SLOT = "COGNIRUNNER_KEY_openai";
    storage.__seed(SLOT, "zz-key-zz");
    const body = JSON.parse((await POST({ action: "kvStash", key: SLOT })).body);
    assert.equal(body.ok, true);
    const { HARNESS_STASH_MAX_AGE_SECONDS } = await import("../../src/harness-fault.js");
    assert.equal(body.ttlSeconds, HARNESS_STASH_MAX_AGE_SECONDS,
      "the TTL claimed is the constant the reaper reaps at — one number, not two that can drift");
    // Put it back so this check leaves no stash behind for the sweep checks below.
    await POST({ action: "kvRestore", stashId: body.stashId });
  });
  await check("stashSweep LISTS harness_stash:* — the door that did not exist (F-779)", async () => {
    storage.__seed("COGNIRUNNER_KEY_openai", "zz-key-zz");
    const fresh = JSON.parse((await POST({ action: "kvStash", key: "COGNIRUNNER_KEY_openai" })).body);
    // A row from a driver that died an hour ago: same shape, older stamp.
    storage.__seed("harness_stash:abandoned", {
      key: "COGNIRUNNER_KEY_azure", value: "zz-abandoned-tenant-key-zz", present: true,
      stashedAt: new Date(Date.now() - 7200 * 1000).toISOString(),
    });
    const listed = JSON.parse((await POST({ action: "stashSweep", dryRun: true })).body);
    assert.equal(listed.ok, true);
    assert.equal(listed.dryRun, true);
    assert.equal(listed.deleted, 0, "a dry run deletes nothing");
    assert.equal(listed.prefix, "harness_stash:", "the prefix is the lever's, never the caller's");
    const byKey = Object.fromEntries(listed.rows.map((r) => [r.key, r]));
    assert.equal(byKey["harness_stash:abandoned"].expired, true, "the hour-old row is reapable");
    assert.equal(byKey[`harness_stash:${fresh.stashId}`].expired, false, "a LIVE driver's stash is not — reaping it would destroy the key it protects");
    assert.equal(listed.body === undefined && JSON.stringify(listed).includes("zz-abandoned-tenant-key-zz"), false,
      "the census carries the key and the age, never the value");
    assert.equal(typeof byKey["harness_stash:abandoned"].ageSeconds, "number");
  });
  await check("stashSweep reaps ONLY what is older than the age (F-779)", async () => {
    const r = JSON.parse((await POST({ action: "stashSweep" })).body);
    assert.equal(r.ok, true);
    assert.equal(r.complete, true, "one page of a tiny keyspace drains in one call");
    assert.equal(r.deleted, 1, "the abandoned row is gone");
    assert.equal(storage.__raw("harness_stash:abandoned"), undefined);
    const after = await listStashes();
    assert.equal(after.length, 1, "…and the live driver's stash is still there");
    // Its restore still works, which is the property the age rule exists to protect.
    const live = after[0].key.slice("harness_stash:".length);
    assert.equal(JSON.parse((await POST({ action: "kvRestore", stashId: live })).body).restored, true);
  });
  /* ═══════════════════════════════════════════════════════════════════════════════
   * F-787 — `olderThanSeconds: 0` MADE THE AGE RULE OPTIONAL.
   *
   * The lever clamped at `Math.max(0, …)`, so the drain-everything shape every other sweep
   * here invites — `{action:"stashSweep", olderThanSeconds:0}` — made `harnessStashReapable`
   * true for every row: a cleanup run in the same minute as `va-compaction-live`'s plant
   * deleted the tenant's only copy of `COGNIRUNNER_KEY_openai`, the driver's `kvRestore`
   * answered 404, and the credential slot kept the planted dead key with no path back.
   * The floor is in the lever with the constant, the hook forwards raw, and the answer
   * echoes the age that was APPLIED.
   * ═══════════════════════════════════════════════════════════════════════════════ */
  await check("stashSweep cannot be talked into an unconditional delete (F-787)", async () => {
    const { HARNESS_STASH_SWEEP_MIN_AGE_SECONDS: MIN, HARNESS_STASH_MAX_AGE_SECONDS: MAX } =
      await import("../../src/harness-fault.js");
    assert.ok(MIN > 0, "a floor of zero is the defect");
    assert.ok(MIN < MAX, "…and a floor at or above the default would cost the lever its reason to exist: reaping a leaked row SOONER than the TTL hour");

    // A LIVE driver's stash, taken through the real door, exactly as va-compaction-live takes it.
    storage.__seed("COGNIRUNNER_KEY_openai", "zz-the-tenants-own-key-zz");
    const live = JSON.parse((await POST({ action: "kvStash", key: "COGNIRUNNER_KEY_openai" })).body);
    assert.equal(live.stashed, true);
    // …and a row older than the floor but younger than the hour: the ALLOW case, and the
    // proof the floor did not simply pin every sweep to the default.
    storage.__seed("harness_stash:f787-old", {
      key: "COGNIRUNNER_KEY_azure", value: "zz-abandoned-tenant-key-zz", present: true,
      stashedAt: new Date(Date.now() - (MIN + 200) * 1000).toISOString(),
    });

    // BLOCK — the age asked for is 0; the age APPLIED is the floor, and it is what comes back.
    const dry = JSON.parse((await POST({ action: "stashSweep", dryRun: true, olderThanSeconds: 0 })).body);
    assert.equal(dry.olderThanSeconds, MIN, "the answer echoes the EFFECTIVE age, not the number that was asked for");
    const byKey = Object.fromEntries(dry.rows.map((r) => [r.key, r]));
    assert.equal(byKey[`harness_stash:${live.stashId}`].expired, false,
      "a live driver's stash is NOT reapable at olderThanSeconds:0 — this is the whole finding");
    assert.equal(byKey["harness_stash:f787-old"].expired, true, "…while the row past the floor still is");

    // The same, for real, plus the two other spellings of "reap everything".
    for (const asked of [0, -1, 0.9]) {
      const swept = JSON.parse((await POST({ action: "stashSweep", olderThanSeconds: asked })).body);
      assert.equal(swept.olderThanSeconds, MIN, `olderThanSeconds:${asked} is floored like every other value below it`);
    }
    assert.equal(storage.__raw(`harness_stash:${live.stashId}`) !== undefined, true,
      "the live stash SURVIVED the drain-everything sweep");
    assert.equal(storage.__raw("harness_stash:f787-old"), undefined, "ALLOW: the row past the floor was reaped");
    // The property the floor exists to protect: the driver can still put the tenant's key back.
    const restored = JSON.parse((await POST({ action: "kvRestore", stashId: live.stashId })).body);
    assert.equal(restored.restored, true, "…so kvRestore still finds it, which is what a 404 here would have cost");
    assert.equal(storage.__raw("COGNIRUNNER_KEY_openai"), "zz-the-tenants-own-key-zz");

    // ONE HOME: the clamp is in the lever, and the hook does not keep a second one.
    const faultSrc = stripJsComments(readFileSync(new URL("../../src/harness-fault.js", import.meta.url), "utf8"));
    const sweeper = faultSrc.slice(faultSrc.indexOf("export const sweepHarnessStashes"));
    assert.match(sweeper.slice(0, sweeper.indexOf("const budgetMs")), /Math\.max\(HARNESS_STASH_SWEEP_MIN_AGE_SECONDS,/,
      "the floor is applied where the constant lives");
    const hookSrc787 = stripJsComments(readFileSync(new URL("../../src/test-hook.js", import.meta.url), "utf8"));
    assert.equal(/olderThanSeconds[\s\S]{0,120}Math\.max\(/.test(hookSrc787), false,
      "the hook forwards the raw number — a second clamp is the second home that drifts");
  });
  await check("stashSweep stays behind HARNESS_SECRET, and refuses a bad cursor (F-779)", async () => {
    const res = await testStateTrigger({ method: "POST", headers: { authorization: ["Bearer wrong-secret"] }, body: JSON.stringify({ action: "stashSweep" }) });
    assert.equal(res.statusCode, 404, "invisible without the secret, like every other lever here");
    const bad = await POST({ action: "stashSweep", cursor: "x".repeat(5000) });
    assert.equal(bad.statusCode, 400);
    assert.equal(JSON.parse(bad.body).reason, "bad-cursor");
  });
  await check("the stash keyspace has ONE home, and the reaper is bound to it (F-779)", async () => {
    // The door that WRITES the row and the lever that REAPS it read the same constant —
    // a second copy is how a keyspace ends up unswept in the first place.
    const hook = stripJsComments(readFileSync(new URL("../../src/test-hook.js", import.meta.url), "utf8"));
    assert.equal(/harness_stash:/.test(hook.replace(/CREDENTIAL_KEY_FAMILIES[\s\S]*?\];/, "")), false,
      "test-hook.js keeps no second copy of the stash prefix outside the credential census");
    const { HARNESS_STASH_KEY_PREFIX, harnessStashKey } = await import("../../src/harness-fault.js");
    assert.equal(HARNESS_STASH_KEY_PREFIX, "harness_stash:");
    assert.equal(harnessStashKey("a/b"), "harness_stash:a-b", "the id is key-safed, not trusted");
    // …and the census entry IS that prefix, so the row the sweeper reaps is the row the
    // read ceiling masks. Two literals, one meaning — asserted rather than hoped.
    assert.equal(isCredentialKey(HARNESS_STASH_KEY_PREFIX + "anything"), true);
    // The reaper does not take the keyspace as a parameter (the clearPlantedFaults rule).
    const faultCode779 = stripJsComments(readFileSync(new URL("../../src/harness-fault.js", import.meta.url), "utf8"));
    const sweeper = faultCode779.slice(faultCode779.indexOf("export const sweepHarnessStashes"));
    assert.match(sweeper, /values: \[HARNESS_STASH_KEY_PREFIX\]/, "the prefix is bound, not passed in");
    assert.equal(/prefix\s*[:=]\s*(?!HARNESS_STASH_KEY_PREFIX)[a-z]/.test(sweeper.slice(0, sweeper.indexOf("return {"))), false,
      "no caller gets to say which keyspace an unconditional delete walks");
  });
  await check("the credential census has ONE home (F-769)", async () => {
    // The families list is asked by the READ ceiling and by the WRITE refusal
    // (`SECRET_VALUE_RE`). The write door used to keep its own retyped copy of
    // COGNIRUNNER_KEY_ / git_conn_secret:, so a family added to one was missing from the
    // other. This asserts against the DUPLICATION, not against today's behaviour.
    const code = stripJsComments(readFileSync(new URL("../../src/test-hook.js", import.meta.url), "utf8"));
    const families = (code.match(/CREDENTIAL_KEY_FAMILIES/g) || []).length;
    assert.ok(families >= 3, `CREDENTIAL_KEY_FAMILIES must be declared once and USED by both doors (found ${families} mentions)`);
    assert.equal(/SECRET_VALUE_RE\s*=\s*\//.test(code), false,
      "SECRET_VALUE_RE must be BUILT from the families list, not retyped as a literal regex");
    // Both doors still answer on the same family — the write refuses a body mentioning it.
    const plant = await POST({ action: "pipelineRow", op: "plant", connId: "c1", repoId: "acme/widget", note: "COGNIRUNNER_KEY_openai" });
    assert.equal(plant.statusCode, 400, "the write door still refuses a body that mentions a credential family");
  });
  /* ═══════════════════════════════════════════════════════════════════════════════
   * F-778 — THE CENSUS ITSELF IS NOW DERIVED FROM `src/`, NOT REMEMBERED.
   *
   * `COGNIRUNNER_CONTEXT7_REMOTE` stores the admin's context7 API key as `apiKey`
   * (index.js `saveContext7Remote`). It is the THIRD member of the MCP-remote triple;
   * its two siblings are declared families and it was not, and its flattened name carries
   * none of `SECRET_KEY_HINTS`, so the name catch-all could not save it either — the
   * read ceiling answered `{key, value:{url, apiKey:"<plaintext>"}}`.
   *
   * Declaring one more name would leave the MECHANISM open: a family is remembered by
   * whoever adds a write site, and the F-769 census was assembled by reading `src/` ONCE.
   * So this reads `src/` EVERY RUN, the way the leak does — every KVS write call
   * (`storage|kvs|store .set(key, value)`) whose stored object carries a field named like
   * a secret must land on a key `isCredentialKey` already covers, or appear in the
   * reviewed table below with the reason it is not a credential.
   *
   * HOW IT READS. Comments are stripped (a docblock naming `apiKey` is prose), key
   * expressions are resolved through the file's own string constants and through the
   * key-builder arrows the repo writes everywhere (`(id) => \`git_conn_secret:${id}\``,
   * `assertKvsKey(\`...\`)`, `PREFIX + id`), and the stored object is read either inline
   * or from the nearest preceding `const row = { … }` / `row.field =` for the identifier
   * that is handed to `.set`. A VALUE that is a bare identifier named like a secret
   * (`storage.set(providerKeySlot(p), key)`) counts too — a credential slot's value is a
   * naked string with no field to read.
   *
   * WHAT IT DOES NOT DO, stated rather than hidden. It is a SOURCE scan, not a type
   * checker: a secret that reaches storage through a helper two files away, or under a
   * field whose name says nothing (`serperKey` only qualifies because it ends in `Key`),
   * is invisible to it. It is a floor under the census, not a proof of its completeness.
   * ═══════════════════════════════════════════════════════════════════════════════ */
  /* Every KVS write site in `src/` whose stored value carries a secret-looking field.
     `sources` is a Map(name -> source) so the positive control can hand it a fake file. */
  const scanSecretWriteSites = (sources, hints) => {
    const flat = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const isSecretField = (n) => hints.some((h) => flat(n).includes(h)) || /key$/i.test(n);
    /* Balanced argument text for a call whose "(" is at `openIdx`. A regex cannot do this:
       an object literal argument nests braces, parens and strings. */
    const argsOf = (src, openIdx) => {
      let depth = 0, out = "", inS = null, esc = false;
      for (let i = openIdx; i < src.length; i++) {
        const c = src[i];
        if (inS) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === inS) inS = null; out += c; continue; }
        if (c === '"' || c === "'" || c === "`") { inS = c; out += c; continue; }
        if (c === "(") { depth++; if (depth === 1) continue; }
        if (c === ")") { depth--; if (depth === 0) return out; }
        out += c;
      }
      return null;
    };
    const splitTop = (s) => {
      const parts = []; let depth = 0, cur = "", inS = null, esc = false;
      for (const c of s) {
        if (inS) { cur += c; if (esc) esc = false; else if (c === "\\") esc = true; else if (c === inS) inS = null; continue; }
        if (c === '"' || c === "'" || c === "`") { inS = c; cur += c; continue; }
        if ("([{".includes(c)) depth++;
        if (")]}".includes(c)) depth--;
        if (c === "," && depth === 0) { parts.push(cur); cur = ""; continue; }
        cur += c;
      }
      parts.push(cur); return parts;
    };
    const code = new Map();
    for (const [name, raw] of sources) code.set(name, stripJsComments(raw));
    /* Two cross-file dictionaries, because a key is almost never written at its write
       site: SCREAMING_CASE string constants, and the key-BUILDER arrows. */
    const constants = new Map(), builders = new Map(), ownConstants = new Map();
    for (const [name, src] of code) {
      const own = new Map();
      /* F-788 — A TEMPLATE IS NOT A CONSTANT, and this dictionary is FILE-WIDE. The quote
         class includes the backtick, so `const key = \`${UI_INTENT_PREFIX}${accountId}\`;`
         was filed as the file's value for the name `key` and then handed to EVERY
         `storage.set(key, …)` in index.js — a wrong key, resolved with total confidence,
         which the coverage rule then asks `isCredentialKey` about. Only plain literals go
         in the dictionary; a name bound to a template is resolved by the window-local
         follow below, which reads the declaration that actually precedes the write. */
      for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(["'`])([^"'`\n]*)\2\s*;/g)) if (!own.has(m[1]) && !m[3].includes("${")) own.set(m[1], m[3]);
      ownConstants.set(name, own);
      for (const [k, v] of own) if (/^[A-Z][A-Z0-9_]*$/.test(k) && !constants.has(k)) constants.set(k, v);
      for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\([^)]*\)\s*=>\s*(?:[A-Za-z_$][\w$]*\()?\s*`([^`]*)`/g)) if (!builders.has(m[1])) builders.set(m[1], m[2]);
      for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\([^)]*\)\s*=>\s*([A-Z_][\w$]*)\s*\+/g)) if (!builders.has(m[1])) builders.set(m[1], "${" + m[2] + "}");
    }
    const sites = [];
    for (const [file, src] of code) {
      const lines = src.split("\n");
      const own = ownConstants.get(file);
      /* F-834 — "which function is this write site inside?", brace-balanced.
         Counted on `maskNonCode(src)` — the ONE home for "which bytes of this file are
         code" — so a `{` inside a string or a template is not a scope and a `}` inside a
         message does not close one. The mask is the same LENGTH as the source, so the
         balance is walked on the mask and the text is sliced from the original.
         Walking BACKWARDS from the site, every unmatched `{` is an enclosing block; the
         LAST one found is the OUTERMOST, which for a write inside a nested arrow is the
         top-level function that contains both it and the `const` that names its key. A
         top-level write has none, and the chain's next scope (the whole file) is then the
         same text — deliberately, because an empty first scope must cost nothing. */
      const maskedSrc = maskNonCode(src);
      const enclosingScope = (at) => {
        let depth = 0, outermost = -1;
        for (let i = at - 1; i >= 0; i--) {
          const c = maskedSrc[i];
          if (c === "}") depth++;
          else if (c === "{") { if (depth === 0) outermost = i; else depth--; }
        }
        return outermost < 0 ? "" : src.slice(outermost, at);
      };
      const constOf = (n) => (own.has(n) ? own.get(n) : (constants.has(n) ? constants.get(n) : null));
      /* The key PREFIX a write site lands on: interpolations become the end of the
         prefix, which is what a family is — `git_conn_secret:${id}` -> `git_conn_secret:`. */
      const resolveKey = (expr, wins, depth = 0) => {
        if (depth > 3) return null;
        let e = expr.trim();
        const tpl = e.match(/^`([\s\S]*)`$/);
        if (!tpl) {
          const lit = e.match(/^["']([^"']*)["']$/);
          if (lit) return lit[1];
          const call = e.match(/^([A-Za-z_$][\w$]*)\s*\(/);
          if (call && builders.has(call[1])) e = builders.get(call[1]);
          else {
            /* F-788 — `"probe:" + name`: a LITERAL prefix concatenated with a runtime part
               is a family exactly like `PREFIX + id` is, and reading only the identifier
               form left `executeProbe`'s write site with no key at all. */
            const litPlus = e.match(/^["']([^"']*)["']\s*\+/);
            if (litPlus) return litPlus[1];
            const plus = e.match(/^([A-Za-z_$][\w$]*)\s*\+/);
            if (plus && constOf(plus[1]) !== null) return constOf(plus[1]);
            if (/^[A-Za-z_$][\w$]*$/.test(e)) {
              if (constOf(e) !== null) return constOf(e);
              /* a local `const key = gitHookSecretKey(a, b);` — follow it once.
                 F-834: over the ENCLOSING FUNCTION first, then the whole file, then the
                 81-line window. `wins` is that chain in order; the FIRST scope that
                 declares the name wins, and within a scope the LAST declaration does. */
              for (const scope of wins) {
                const re = new RegExp("(?:const|let|var)\\s+" + e + "\\s*=\\s*([^;\\n]+);", "g");
                let mm, last = null;
                while ((mm = re.exec(scope))) last = mm[1];
                if (last) {
                  const got = resolveKey(last, wins, depth + 1);
                  if (got) return got;
                }
              }
              return null;
            }
            return null;
          }
        } else e = tpl[1];
        e = e.replace(/\$\{([A-Za-z_$][\w$]*)\}/g, (_s, n) => (constOf(n) !== null ? constOf(n) : " "));
        e = e.replace(/\$\{[\s\S]*?\}/g, " ");
        const out = e.split(/\s/)[0] || null;
        /* F-788 — a key that still carries a `${` is a FAILED resolution wearing the costume
           of a successful one, and the coverage rule would ask `isCredentialKey` about a
           string no KVS row is ever named. Unresolved is the honest answer, and the
           assertion below refuses to let one pass unreviewed. */
        return out && out.includes("${") ? null : out;
      };
      const WRITE_CALL = /\b(?:storage|kvs|store)\s*\.\s*set\s*\(/g;
      let wm;
      while ((wm = WRITE_CALL.exec(src))) {
        const open = wm.index + wm[0].length - 1;
        const argText = argsOf(src, open);
        if (!argText) continue;
        const parts = splitTop(argText);
        if (parts.length < 2) continue;
        const line = src.slice(0, wm.index).split("\n").length;
        const keyExpr = parts[0].trim(), valueExpr = parts[1].trim();
        const win = lines.slice(Math.max(0, line - 81), line).join("\n");
        /* F-834 — THE KEY IS RESOLVED OVER THE SCOPE IT IS DECLARED IN, not over 81 lines.
           The window is the FIELD scan's unit (the `const row = {...}` a write site hands
           to `.set` really is a few lines up) and it stayed that. But a KEY is routinely
           built at the TOP of a long function — or at module scope, hundreds of lines above
           the write — and 81 lines is an arbitrary number that silently turns such a site
           into an `unresolved` hole. So the key gets a CHAIN of scopes: the enclosing
           function (brace-balanced, see `enclosingScope`), then the whole file above the
           site, and the old window LAST so no site that resolved before stops resolving. */
        const keyWins = [enclosingScope(wm.index), src.slice(0, wm.index), win];
        const fields = new Set(), spreads = new Set();
        /* F-788 — TWO WAYS A FIELD NAME APPEARS IN AN OBJECT LITERAL, and the scanner only
           read one. `name:` / `name =` was the whole rule, so `{ url, apiKey }` — the most
           idiomatic way this repo writes a row, and the exact shape at test-hook.js's
           `storage.set("probe:webhook:secret", { secret, at })` — yielded `fields.size === 0`
           and the site was never even reported, so the census of 27 sites simply did not
           contain it. A SHORTHAND property is an identifier followed by `,` or `}` with no
           colon, and it names the field just as loudly. */
        const scanFields = (txt) => {
          for (const m of txt.matchAll(/(?:^|[{,\s])["']?([A-Za-z_$][\w$]*)["']?\s*[:=](?!=)/g)) if (isSecretField(m[1])) fields.add(m[1]);
          for (const m of txt.matchAll(/(?:^|[{,])\s*([A-Za-z_$][\w$]*)\s*(?=[,}])/g)) if (isSecretField(m[1])) fields.add(m[1]);
          /* F-794 — A SPREAD IS AN UNREADABLE FIELD LIST, one level up from the shorthand
             F-788 fixed. `storage.set(key, { ...config, id })` stores every field `config`
             has and NAMES none of them, so a field-name scan sees nothing and the site is
             never even reported. It cannot be resolved here (the source is usually caller
             JSON several files away), so it is reported as the pseudo-field `...name` and
             JUDGED in the review table below: either a normaliser bounds what can be in it,
             or the door masks it at the point it is read. */
          for (const m of txt.matchAll(/(?:^|[{,])\s*\.\.\.\s*([A-Za-z_$][\w$.]*)/g)) spreads.add("..." + m[1]);
        };
        if (/^\{[\s\S]*\}$/.test(valueExpr)) scanFields(valueExpr);
        const bare = valueExpr.match(/^([A-Za-z_$][\w$]*)$/);
        if (bare) {
          const name = bare[1];
          if (isSecretField(name)) fields.add(name);
          const re = new RegExp("(?:const|let|var)\\s+" + name + "\\s*=\\s*\\{", "g");
          let mm, at = null;
          while ((mm = re.exec(win))) at = mm.index;
          if (at !== null) {
            const braceStart = win.indexOf("{", at);
            let depth = 0, j = braceStart;
            for (; j < win.length; j++) { if (win[j] === "{") depth++; else if (win[j] === "}") { depth--; if (!depth) break; } }
            scanFields(win.slice(braceStart, j + 1));
          }
          for (const m2 of win.matchAll(new RegExp("\\b" + name + "\\.([A-Za-z_$][\\w$]*)\\s*=(?!=)", "g"))) if (isSecretField(m2[1])) fields.add(m2[1]);
        }
        if (fields.size || spreads.size) sites.push({ file, line, keyExpr, key: resolveKey(keyExpr, keyWins), fields: [...fields].sort(), spreads: [...spreads].sort() });
      }
    }
    return sites;
  };
  /* REVIEWED AND NOT A CREDENTIAL — key prefix -> why the secret-looking field is not one.
     Per KEY, so a NEW key carrying the same field name still fails: the judgement being
     recorded is "this row is safe", never "this word is safe". */
  const NOT_A_CREDENTIAL = new Map([
    ["git_conn:", "the PUBLIC connection row: `hasToken` is a boolean and `tokenSlot` is the NAME of the git_conn_secret:* row, which is itself a declared family"],
    ["COGNIRUNNER_AI_BUDGET", "`tokensPerMinute` is the TPM pacing number (src/shared/ai-budget.js), not an auth token"],
    ["ai_cost:", "`tokens` is a usage COUNT for the cost meter"],
    ["pf_exec:", "`issueKey` is a Jira issue key (LZPT-1), which is not secret and is in every log line"],
    // F-788 — the three invocation-claim rows, `{ issueKey, claimedAt }`: SHORTHAND, so the
    // scanner could not see them at all until now. Same judgement as pf_exec: above.
    ["pf_inv:", "`issueKey` — a Jira issue key on a once-only invocation claim row"],
    ["pf_inv:fb:", "`issueKey` — a Jira issue key on the fallback invocation claim row"],
    ["coder_ticket:", "`issueKey` — a Jira issue key"],
    ["coder_pin:", "`issueKey` — a Jira issue key"],
    ["coder_log:", "`issueKey` — a Jira issue key"],
    ["va_item:", "`issueKey` — a Jira issue key"],
    ["va_tick:", "`key` on a tick receipt is the receipt's own id, not a credential"],
    ["va_effect:", "`issueKey`/`key` identify the issue the effect landed on"],
  ]);
  await check("every src/ write site that stores a secret is covered by the census (F-778)", async () => {
    const SRC = new URL("../../src/", import.meta.url);
    const sources = new Map();
    for (const dir of ["", "shared/"]) {
      for (const f of readdirSync(new URL(dir, SRC)).filter((n) => n.endsWith(".js")).sort()) {
        sources.set(dir + f, readFileSync(new URL(dir + f, SRC), "utf8"));
      }
    }
    /* The field words come from their one home — the same words the write door refuses a
       FIELD for. Retyping them here would be the second home this whole rule exists to
       prevent. F-803: that home moved out of test-hook.js (where it was SCRAPED out of the
       source with a regex) into src/shared/secret-shapes.js, which both the door and the
       harness's evidence redactor import — so this reads the binding rather than the text. */
    const { SECRET_FIELD_NAME_HINTS: hints } = await import("../../src/shared/secret-shapes.js");
    assert.ok(hints.length >= 10, `SECRET_FIELD_NAME_HINTS must come from src/shared/secret-shapes.js (got ${hints.length})`);

    const sites = scanSecretWriteSites(sources, hints);
    assert.ok(sites.length >= 20, `the scanner must still SEE the write sites (found ${sites.length})`);
    const named = sites.filter((s) => s.fields.length);
    /* Every site that NAMES a secret field resolves to a key, or the scanner has stopped
       understanding how this repo builds KVS keys — an unresolved key is a hole, not a pass.
       A SPREAD-only site is judged by identity below, which tolerates an unresolvable key
       (`setFaultRow(key, …)` takes its key as a parameter) because the judgement there is
       about the SOURCE of the spread, not about which row it lands on. */
    const unresolved = named.filter((s) => !s.key);
    /* F-834 — A NULL RESOLUTION IS A RED THAT NAMES THE SITE. It was already a red, but it
       printed the whole site OBJECT, so the thing an operator needs first — which file and
       line stopped resolving — arrived wrapped in the fields and the key expression. Named
       the way the two rules below name theirs, `file:line keyExpr`, so the three failures
       of this check read alike and a stale line number is never the only handle. */
    assert.deepEqual(unresolved.map((s) => `${s.file}:${s.line} ${s.keyExpr}`), [],
      "a secret-carrying write site's key could not be resolved — the scanner has stopped understanding how this repo builds KVS keys, which is a HOLE in the census, not a pass");

    const uncovered = named.filter((s) => !isCredentialKey(s.key) && !NOT_A_CREDENTIAL.has(s.key));
    assert.deepEqual(uncovered.map((s) => `${s.file}:${s.line} ${s.key} {${s.fields.join(",")}}`), [],
      "a KVS row stores a secret-looking field under a key the read ceiling does not mask — declare the family in CREDENTIAL_KEY_FAMILIES, or add it to NOT_A_CREDENTIAL with the reason");

    /* ═══════════════════════════════════════════════════════════════════════════════
     * F-794 — THE SPREAD ARM. Filed by F-788 and shippable only now.
     *
     * `storage.set(key, { ...config, id })` stores every field `config` has and names
     * none of them, so the field scan reported `fields.size === 0` and the site was never
     * judged at all. F-788 could not ship this arm because the answer for `job:` — a row
     * that stores a whole job config — was an open question about the READ CEILING, not a
     * review entry: `src/shared/rule-portability.js` strips `headers` from an export as
     * "endpoint auth", so a rule-shaped row can carry an endpoint credential under a field
     * name no hint matches, and the per-KEY ceiling answered the whole row plain.
     *
     * F-794's field ceiling IS that answer, so every spread now has one of exactly two
     * judgements, and there is no third:
     *   · the NORMALISER that bounds the source — a builder that constructs the stored
     *     object FIELD BY FIELD, so what can be in it is a closed list somebody wrote.
     *   · `unbounded-field-masked-at-the-door` — the source is caller JSON or a row this
     *     check has not proved field-built, and the thing standing between it and an
     *     evidence file is `maskSecretFields` on the read. That is a real answer, not an
     *     excuse, BECAUSE the door now masks by field; before F-794 it would have been a
     *     shrug. Its residual is the one stated at `maskSecretFields`: free text.
     * A spread with NO entry is a RED — the rule refuses to guess which of the two it is.
     *
     * Identified by KEY (a line number moves every commit); the one site whose key is a
     * function PARAMETER is identified by `file:keyExpr`, which is stable under edits.
     * ═══════════════════════════════════════════════════════════════════════════════ */
    const SPREAD_BOUNDED_BY = new Map([
      // BOUNDED — a normaliser builds the stored object field by field.
      ["job:", "`normalizeJob` (src/scheduled-jobs.js) builds the record field by field and every step through `normalizeStep`, where `endpoint` is a clamped URL STRING with no header map at all; the residual inside that bound is `generationMeta`, which is passed through as the caller sent it"],
      ["git_conn:", "the connection row is built field by field at creation (`hasToken` is a boolean and `tokenSlot` is the NAME of the git_conn_secret:* row — the same judgement already recorded in NOT_A_CREDENTIAL), and the identity spread is `identityFields` (src/git-connections.js), a three-field builder of public account ids"],
      ["harness_probe:", "`runHarnessProbe` (src/async-handler.js) builds the probe row field by field - status codes, an error CLASS, response KEY NAMES and two booleans, never a body - and the spread adds only `until` (F-824); the write itself refuses unless HARNESS_SECRET is set, so production never reaches it"],
      ["harness-fault.js:key", "`setFaultRow` is NOT exported and is reachable only through the six gated levers in src/harness-fault.js, each of which builds its row field by field; the spread adds `until`"],
      // UNBOUNDED — the source is caller JSON or a row not proved field-built. The field
      // ceiling on `?what=kvs` is what stands between it and a committed evidence file.
      ["doc_repo:", "unbounded-field-masked-at-the-door — a Documentation Library record carries the caller's own doc object"],
      ["skill_repo:", "unbounded-field-masked-at-the-door — a skill record carries the caller's own row"],
      ["ui_intent:", "unbounded-field-masked-at-the-door — the frontend's intent object, spread wholesale with a timestamp"],
      ["async_job:", "unbounded-field-masked-at-the-door — `{...existing, ...patch}`, where the patch is whatever the task handler chose to record"],
      ["log_entry:", "unbounded-field-masked-at-the-door — an execution log entry carries step results and AI output"],
      ["owner_names", "unbounded-field-masked-at-the-door — learned owner names merged over the current map"],
      ["registry_migrations", "unbounded-field-masked-at-the-door — the migration bookkeeping map"],
      ["coder_ticket:", "unbounded-field-masked-at-the-door — a coder ticket is re-stamped by spreading the stored ticket"],
      ["git_pipeline:", "unbounded-field-masked-at-the-door — the pipeline row is re-stamped by spreading itself"],
      ["va_purged:", "unbounded-field-masked-at-the-door — a purge ledger row re-stamped with its turn count"],
      ["va_item:", "unbounded-field-masked-at-the-door — a VA ledger item spread over a base row"],
      ["probe:", "unbounded-field-masked-at-the-door — a probe result row; `probe:webhook:secret` is separately a DECLARED family, which this entry does not weaken"],
      ["probe:license:webtrigger", "unbounded-field-masked-at-the-door — the Part 0 licence probe's own row, written by the harness door"],
      ["COGNIRUNNER_SEAT_SNAPSHOT", "unbounded-field-masked-at-the-door — the seat row as Atlassian's licence API returned it"],
    ]);
    const spreadId = (s) => (s.key || `${s.file}:${s.keyExpr}`);
    const spreadSites = sites.filter((s) => s.spreads.length);
    assert.ok(spreadSites.length >= 25, `the scanner must SEE the spread sites (found ${spreadSites.length})`);
    const unjudged = spreadSites.filter((s) => !isCredentialKey(s.key) && !SPREAD_BOUNDED_BY.has(spreadId(s)));
    assert.deepEqual(unjudged.map((s) => `${s.file}:${s.line} ${spreadId(s)} {${s.spreads.join(",")}}`), [],
      "a KVS row spreads an object nobody has bounded — name the NORMALISER that builds it field by field, or mark it unbounded-field-masked-at-the-door (which is only true while the ?what=kvs FIELD ceiling stands)");
    // …and the table may not outlive its sites: an entry for a spread that no longer
    // exists is a judgement about nothing, and reads as cover for the next one.
    const live = new Set(spreadSites.map(spreadId));
    assert.deepEqual([...SPREAD_BOUNDED_BY.keys()].filter((k) => !live.has(k)), [],
      "a SPREAD_BOUNDED_BY entry names a write site that is gone — delete it rather than leave a stale judgement");
    // POSITIVE CONTROL: the arm can still SEE a spread, and an unjudged one is a red.
    const spreadFixture = new Map([["spread.js", 'const SLOT = "cognirunner_spread_row";\nawait storage.set(SLOT, { ...config, id });\n']]);
    const spreadFound = scanSecretWriteSites(spreadFixture, hints);
    assert.equal(spreadFound.length, 1, "POSITIVE CONTROL: `{ ...config, id }` IS a write site worth judging — it was invisible before F-794");
    assert.deepEqual(spreadFound[0].spreads, ["...config"]);
    assert.deepEqual(spreadFound[0].fields, [], "…and it names no field, which is exactly why the old scan skipped it");
    assert.equal(isCredentialKey(spreadFound[0].key) || SPREAD_BOUNDED_BY.has(spreadFound[0].key), false,
      "POSITIVE CONTROL: …and it is UNJUDGED, so the rule above would fail on it");

    /* F-788 — THE FINDING, named: the most idiomatic way to store a secret was invisible.
       `storage.set("probe:webhook:secret", { secret, at })` is a SHORTHAND property, so the
       old `[:=]`-only scan gave it `fields.size === 0` and never reported the site — it is
       absent from the 27-site census this check was committed with. It is a real HMAC secret
       (a tester types it; `gitWebhookProbe` verifies a signature with it), and the answer to
       "is the read ceiling already over it" is YES twice over: it is a declared family AND
       its name carries the `secret` catch-all. Asserted, not assumed. */
    const probeSecret = sites.find((s) => s.key === "probe:webhook:secret");
    assert.ok(probeSecret && probeSecret.fields.includes("secret"),
      "the scanner sees the SHORTHAND `{ secret, at }` write at test-hook.js — this is the F-788 site");
    assert.equal(isCredentialKey("probe:webhook:secret"), true, "…and the read ceiling masks it");
    assert.equal(isCredentialKey("a:key:named:secret"), true,
      "…and the name catch-all covers it a second time, because the key says `secret` out loud");
    assert.equal(isCredentialKey("probe:webhook:signing"), false,
      "…but ONLY because of that word: rename the key and the DECLARED family is the whole ceiling, which is why the census has to see the site at all");

    // THE FINDING ITSELF, named: the third MCP remote is in the census now.
    const context7 = sites.find((s) => s.key === "COGNIRUNNER_CONTEXT7_REMOTE");
    assert.ok(context7 && context7.fields.includes("apiKey"), "the scanner sees saveContext7Remote storing apiKey");
    assert.equal(isCredentialKey("COGNIRUNNER_CONTEXT7_REMOTE"), true, "…and the read ceiling masks it (F-778)");

    // POSITIVE CONTROL: a fake write site with an undeclared key must be REPORTED and UNCOVERED.
    const fake = new Map([["fake.js", 'const SLOT = "cognirunner_new_thing";\nawait storage.set(SLOT, { url, apiKey: k });\n']]);
    const found = scanSecretWriteSites(fake, hints);
    assert.equal(found.length, 1, "POSITIVE CONTROL: the scanner finds a synthetic secret write site");
    assert.equal(found[0].key, "cognirunner_new_thing");
    assert.equal(isCredentialKey(found[0].key) || NOT_A_CREDENTIAL.has(found[0].key), false,
      "POSITIVE CONTROL: …and it is UNCOVERED, so the rule above would fail on it");
    /* ═══════════════════════════════════════════════════════════════════════════════
     * F-834 — THE KEY IS RESOLVED OVER A SCOPE, AND THE 81-LINE WINDOW WAS AN ARBITRARY
     * NUMBER WEARING THE COSTUME OF A RULE.
     *
     * The window exists for the FIELD scan — the `const row = {…}` handed to `.set` really
     * is a few lines above it — and the KEY was resolved over the same 81 lines only
     * because it was the text already in hand. But a key is routinely built at the TOP of a
     * long function, or at module scope hundreds of lines up, and both of those are ORDINARY
     * in this repo: index.js alone is ~14k lines. Past the window the site resolved to
     * `null`, and `null` here is not "covered" or "uncovered" — it is a site the census
     * cannot judge at all, which is the exact hole F-778 built this scanner to close.
     *
     * The two controls below are the pair: a declaration 200 lines above the write RESOLVES
     * now (it could not before), and a key with NO declaration anywhere still goes RED —
     * which is what stops the widened scope from being a way to make everything resolve.
     * ═══════════════════════════════════════════════════════════════════════════════ */
    const farAway = new Map([["far.js",
      'async function writeIt(id) {\n  const slot = `cognirunner_far_thing:${id}`;\n'
      + "  // …\n".repeat(200)
      + '  await storage.set(slot, { url, apiKey });\n}\n']]);
    const farFound = scanSecretWriteSites(farAway, hints);
    assert.equal(farFound.length, 1, "F-834 CONTROL: the scanner still sees a write 200 lines below its key declaration");
    assert.deepEqual(farFound[0].fields, ["apiKey"]);
    assert.equal(farFound[0].key, "cognirunner_far_thing:",
      "F-834 CONTROL: …and the key RESOLVES over the enclosing function — 81 lines above the write, it was `null`, an unjudgeable hole");
    assert.equal(isCredentialKey(farFound[0].key) || NOT_A_CREDENTIAL.has(farFound[0].key), false,
      "F-834 CONTROL: …and being resolvable is what lets the coverage rule call it UNCOVERED rather than shrug at it");
    /* …and the negative half: a name that is declared NOWHERE must stay null, so the wider
       scope cannot quietly manufacture a key out of a same-named variable somewhere else. */
    const noDecl = new Map([["nodecl.js", 'async function writeIt() {\n  await storage.set(slotFromSomewhereElse, { url, apiKey });\n}\n']]);
    const noDeclFound = scanSecretWriteSites(noDecl, hints);
    assert.equal(noDeclFound.length, 1, "F-834 CONTROL: an undeclared key name is still a REPORTED site");
    assert.equal(noDeclFound[0].key, null,
      "F-834 CONTROL: …and it resolves to null, which the rule above turns into a red naming `nodecl.js:2 slotFromSomewhereElse`");
    assert.deepEqual([noDeclFound[0]].filter((x) => !x.key).map((x) => `${x.file}:${x.line} ${x.keyExpr}`),
      ["nodecl.js:2 slotFromSomewhereElse"],
      "F-834 CONTROL: …in exactly the shape the assertion prints, so the red NAMES the site");
    /* POSITIVE CONTROL for F-788: the SHORTHAND fixture — the exact shape the scanner was
       blind to, and the shape a new `saveXRemote` would copy from line 561's own style. */
    const shorthand = new Map([["shorthand.js", 'const SLOT = "cognirunner_x_remote";\nawait storage.set(SLOT, { url, apiKey });\n']]);
    const shortFound = scanSecretWriteSites(shorthand, hints);
    assert.equal(shortFound.length, 1, "POSITIVE CONTROL: `{ url, apiKey }` IS a secret write site");
    assert.deepEqual(shortFound[0].fields, ["apiKey"], "…and the shorthand field is named, while `url` is not a secret word");
    assert.equal(isCredentialKey(shortFound[0].key) || NOT_A_CREDENTIAL.has(shortFound[0].key), false,
      "…and it is UNCOVERED, so the rule above would fail on it — which it did not before F-788");
    /* …and the two key-resolution holes this exposed, both of which answered a WRONG key
       with total confidence rather than answering "unresolved". A template bound to a name
       is NOT a file-wide constant (`const key = `${UI_INTENT_PREFIX}${accountId}`;` was being
       handed to every `storage.set(key, …)` in index.js), and a literal prefix concatenated
       with a runtime part is a family like any other. */
    const tpl = new Map([["tpl.js", [
      'const P = "ui_intent:";',
      "const key = `${P}${accountId}`;",
      'const other = "probe:" + name;',
      "await storage.set(other, { apiKey });",
      "await storage.set(key, { apiKey });",
    ].join("\n")]]);
    const tplFound = scanSecretWriteSites(tpl, hints);
    assert.deepEqual(tplFound.map((s) => s.key), ["probe:", "ui_intent:"],
      "a literal+identifier key resolves to its prefix, and a template name resolves through the declaration that PRECEDES the write, not through a file-wide dictionary");
    const wrong = new Map([["wrong.js", [
      "const key = `${NOPE}/x`;",
      "await storage.set(key, { apiKey });",
    ].join("\n")]]);
    assert.deepEqual(scanSecretWriteSites(wrong, hints).map((s) => s.key), [null],
      "a key that cannot be resolved answers null — never a string still carrying a ${…}, which the coverage rule would then ask isCredentialKey about");
    // …and a comment that merely NAMES a credential field is prose, not a write site.
    const prose = new Map([["prose.js", '/* the slot stores { apiKey } — see F-778 */\nawait storage.set("plain_row", { count: 1 });\n']]);
    assert.deepEqual(scanSecretWriteSites(prose, hints), [], "POSITIVE CONTROL: a docblock naming apiKey is not a write site");
  });
  await check("kvSet stays behind HARNESS_SECRET", async () => {
    const response = await testStateTrigger({ method: "POST", headers: { authorization: ["Bearer wrong-secret"] }, body: JSON.stringify({ action: "kvSet", key: "COGNIRUNNER_AI_PROVIDER", value: null }) });
    assert.equal(response.statusCode, 404);
  });
} finally {
  if (previousSecret === undefined) delete process.env.HARNESS_SECRET;
  else process.env.HARNESS_SECRET = previousSecret;
}
// Slim index and full records must use the same project rule, including events
// explicitly independent of projects (users, boards, sprints, field contexts).
await check("unsupported projectIds cannot bypass a project-key mismatch", async () => {
  const config = listener({ projectKeys: ["OTHER"] });
  config.filters.projectIds = ["10"];
  assert.equal(matchListenerStatic(config, { eventType: UPDATE, projectKey: "LZPT", projectId: "10" }, {}).ok, false);
});
// A project filter must never gate an event Jira (or a git provider) does not scope
// to a project. Repo-scoped git events carry their OWN mandatory scope instead —
// the repos allow-list — so they are seeded with one and the delivery names it.
for (const eventMeta of JIRA_EVENTS.filter(e => e.projectScoped === false)) await check(`global event ignores project filters in both match paths: ${eventMeta.id}`, async () => {
  reset();
  const repoScoped = eventMeta.repos === true;
  const filters = repoScoped ? { projectKeys: ["OTHER"], repos: ["owner/name"] } : { projectKeys: ["OTHER"] };
  const config = listener(filters, { id: "global-match", events: [eventMeta.id], ...(repoScoped ? { mode: "agent", agent: { instructions: "x" }, functions: [] } : {}) });
  const ctx = repoScoped ? { eventType: eventMeta.id, repoId: "owner/name" } : { eventType: eventMeta.id };
  assert.equal(matchListenerStatic(config, ctx, {}).ok, true);
  storage.__seed("listener:global-match", config); storage.__seed("listener_index", [toIndexRow(config)]);
  await readListenerIndex(); // refresh this test container; live saves require ~35s for the 30s cache
  await listenerTrigger(repoScoped ? { eventType: eventMeta.id, source: "git", connectionId: "gc_1", repoId: "owner/name", actor: { login: "octocat" } } : { eventType: eventMeta.id });
  assert.equal(pushed.length, 1);
});
for (const [keys, projectKey, expected] of [[[], null, true], [["lzpt"], "LzPt", true], [["OTHER"], "LZPT", false], [["LZPT"], null, false]]) await check(`project shortlist/full parity ${JSON.stringify({ keys, projectKey })}`, async () => {
  reset(); const config = listener({}, { id: "project-match" }); config.filters.projectKeys = keys;
  const event = { eventType: UPDATE, issue: { fields: { project: { key: projectKey } } } };
  assert.equal(matchListenerStatic(config, { eventType: UPDATE, projectKey }, event).ok, expected);
  storage.__seed("listener:project-match", config); storage.__seed("listener_index", [toIndexRow(config)]);
  await readListenerIndex(); await listenerTrigger(event);
  assert.equal(pushed.length, expected ? 1 : 0);
});
// Structured agent results must survive both queue returns and persisted logs;
// prose is display-only and remains backwards compatible.
for (const outcome of ["done", "nothing_to_do", "failed"]) for (const family of ["listener", "unscoped job", "scoped job"]) await check(`${family} retains ${outcome} agent summary`, async () => {
  const state = reset(); const summary = "Specific explanation " + "x".repeat(1300);
  state.agent = args => { state.runs.push(args); return { success: outcome !== "failed", outcome, summary, error: outcome === "failed" ? "provider failure" : undefined, changes: [], logs: [] }; };
  let result;
  if (family === "listener") {
    const config = listener({}, { id: "outcome-listener", mode: "agent", agent: { instructions: "Read" } });
    storage.__seed("listener:outcome-listener", config);
    result = await executeListenerTask({ listenerId: config.id, eventType: UPDATE, event: { issue: ISSUE }, ctx: { issueKey: ISSUE.key } }, "outcome-listener-task");
  } else {
    const config = { ...job("agent"), id: "outcome-job", scope: family === "scoped job" ? job().scope : null };
    storage.__seed("job:outcome-job", config);
    forgeApi.__respond(() => forgeApi.__response(200, { issues: [ISSUE] }));
    result = await executeScheduledJobTask({ jobId: config.id, manual: true }, "outcome-job-task");
  }
  const saved = state.logs.at(-1);
  const entries = family === "scoped job" ? [result.issues[0], saved.perIssue[0]] : [result, saved];
  for (const entry of entries) { assert.equal(entry.agentOutcome, outcome); if (family === "scoped job") { assert.match(entry.agentSummary, /\[truncated\]$/); assert.ok(Buffer.byteLength(JSON.stringify(entry.agentSummary), "utf8") <= 240); } else assert.equal(entry.agentSummary, summary.slice(0, 1200)); }
  if (family === "scoped job") { assert.equal(result.agentSummary, undefined); assert.equal(saved.agentSummary, undefined); }
  else if (outcome !== "failed") assert.match(result.reason, new RegExp(`^${family === "listener" ? "Agent " : ""}${outcome}: Specific explanation`));
  else assert.match(result.reason, /provider failure/);
});
await check("script runs do not invent agent outcomes", async () => {
  const { invoke, state } = claimFixture("manual"); const result = await invoke();
  assert.equal(JSON.parse(JSON.stringify(result)).agentOutcome, undefined);
  assert.equal(state.logs[0].agentSummary, undefined);
});
await check("cancelled scoped agent run only reports summaries for attempted issues", async () => {
  const state = reset(); state.cancel = () => state.runs.length === 1;
  state.agent = args => { state.runs.push(args); return { success: true, outcome: "nothing_to_do", summary: "No action needed", logs: [], changes: [] }; };
  forgeApi.__respond(() => forgeApi.__response(200, { issues: scope }));
  const result = await runJob({ job: job("agent"), cancelToken: "cancel" });
  assert.equal(result.issues[0].agentOutcome, "nothing_to_do");
  assert.equal(result.issues[0].agentSummary, "No action needed");
  assert.ok(result.issues.slice(1).every(r => r.agentOutcome === undefined && r.agentSummary === undefined));
});

/* ════ F-842 — a QUEUED listener/job run is gated on the instance's facts, like its test run ════
 *
 * `TASK_HANDLERS` invokes a handler as `(params, taskId)`. Registering the bare
 * `executeListenerTask` / `executeScheduledJobTask` therefore left the THIRD argument —
 * the F-302 seam that carries `gateFacts` — undefined on every queued delivery, so
 * `runListener` / `runJob` built no gate context and `normalizeAllowedActions` fell to its
 * arity-1 restrictive default: every capability-gated action AND every `confirm` action
 * refused as `needs-admin`, on a rule an ADMIN saved, while the same rule's "Test with an
 * issue" (which does thread facts) ran it. The consumer now reads the facts fresh.
 *
 * The wrappers live in src/async-handler.js, which cannot be imported offline (it pulls
 * src/index.js), so their SOURCE is executed here against the REAL listener and job
 * modules and the REAL gate predicate. Nothing about capability is re-implemented.
 */
{
  const asyncSource = readFileSync(new URL("../../src/async-handler.js", import.meta.url), "utf8");
  const wiring = asyncSource.slice(asyncSource.indexOf("const withFreshGateFacts = async (opts)"), asyncSource.indexOf("const resolveFreshCoderGate"));
  const handlers = (facts) => new Function("resolveFreshGateFacts", "executeListenerTask", "executeScheduledJobTask",
    `${wiring} return { executeQueuedListener, executeQueuedScheduledJob };`)(async () => facts, executeListenerTask, executeScheduledJobTask);

  const BYOK = { provider: "openai", edition: "standard", agentModel: "gpt-5.4", allowanceLevel: null };
  const FORGE_STANDARD = { provider: "atlassian", edition: "standard", agentModel: "claude-haiku-4.5", allowanceLevel: null };
  // One capability-gated `confirm` action alongside two plain Jira ones, so a refusal can
  // be told apart from "the rule had nothing".
  const ACTIONS = ["get_issue", "add_comment", "commit_files"];
  const saveGate = buildAgentGateContext({ ...BYOK, savedByRole: "admin" });
  // The verdict is read off the gate the RUN handed the agent, through the shipped
  // predicate — exactly what src/agent-runner.js does with it.
  const verdictOf = (args) => args.gate === undefined
    ? { allowed: normalizeAllowedActions(args.allowedActions), refused: [{ id: "(arity-1 default)", reason: "no-gate-context" }] }
    : normalizeAllowedActions(args.allowedActions, args.gate);
  const queuedRun = async ({ kind, facts, savedByRole, id }) => {
    const state = reset();
    if (kind === "listener") {
      const config = normalizeListener({ id, name: id, events: [UPDATE], mode: "agent", agent: { instructions: "go", allowedActions: ACTIONS } }, { gate: saveGate, savedByRole });
      storage.__seed(`listener:${id}`, config);
      await handlers(facts).executeQueuedListener({ listenerId: id, eventType: UPDATE, event: { issue: ISSUE }, ctx: { issueKey: ISSUE.key, projectKey: "LZPT" } }, `task-${id}`);
    } else {
      const config = normalizeJob({ id, name: id, schedule: { cron: "*/5 * * * *" }, mode: "agent", agent: { instructions: "go", allowedActions: ACTIONS } }, { gate: saveGate, savedByRole });
      storage.__seed(`job:${id}`, config);
      await handlers(facts).executeQueuedScheduledJob({ jobId: id, manual: true }, `task-${id}`);
    }
    assert.equal(state.runs.length, 1);
    return verdictOf(state.runs[0]);
  };

  for (const kind of ["listener", "job"]) {
    await check(`F-842: an admin-saved ${kind} runs its capability-gated action on the ASYNC path`, async () => {
      const v = await queuedRun({ kind, facts: BYOK, savedByRole: "admin", id: `f842-${kind}-admin` });
      assert.deepEqual(v.allowed, ACTIONS);
      assert.deepEqual(v.refused, []);
    });
    await check(`F-842: a viewer-saved ${kind} is refused needs-admin, and keeps its plain actions`, async () => {
      const v = await queuedRun({ kind, facts: BYOK, savedByRole: "viewer", id: `f842-${kind}-viewer` });
      assert.deepEqual(v.allowed, ["get_issue", "add_comment"]);
      assert.deepEqual(v.refused, [{ id: "commit_files", reason: "needs-admin" }]);
    });
    await check(`F-842: the capability off AT EXECUTION refuses the ${kind}'s git action with the capability reason`, async () => {
      const v = await queuedRun({ kind, facts: FORGE_STANDARD, savedByRole: "admin", id: `f842-${kind}-cap` });
      assert.deepEqual(v.allowed, ["get_issue", "add_comment"]);
      assert.deepEqual(v.refused, [{ id: "commit_files", reason: "needs-coder-edition" }]);
    });
    await check(`F-842: no facts at all still gates the ${kind} restrictively — a fault is never the way past`, async () => {
      const v = await queuedRun({ kind, facts: null, savedByRole: "admin", id: `f842-${kind}-nofacts` });
      assert.deepEqual(v.allowed, ["get_issue", "add_comment"]);
    });
  }
  await check("F-842: facts supplied by the caller are preferred over the consumer's own read", async () => {
    const state = reset();
    const id = "f842-explicit";
    storage.__seed(`listener:${id}`, normalizeListener({ id, name: id, events: [UPDATE], mode: "agent", agent: { instructions: "go", allowedActions: ACTIONS } }, { gate: saveGate, savedByRole: "admin" }));
    const h = new Function("resolveFreshGateFacts", "executeListenerTask", "executeScheduledJobTask",
      `${wiring} return { executeQueuedListener };`)(async () => { throw new Error("the consumer must not read facts a caller already supplied"); }, executeListenerTask, executeScheduledJobTask);
    await h.executeQueuedListener({ listenerId: id, eventType: UPDATE, event: { issue: ISSUE }, ctx: { issueKey: ISSUE.key, projectKey: "LZPT" } }, "task-explicit", { gateFacts: BYOK });
    assert.deepEqual(verdictOf(state.runs[0]).allowed, ACTIONS);
  });
  await check("F-842: the wrappers are what TASK_HANDLERS registers", async () => {
    const registry = (asyncSource.match(/const TASK_HANDLERS = \{[\s\S]*?\n\};/) || [""])[0];
    assert.match(registry, /"listener": executeQueuedListener,/);
    assert.match(registry, /"scheduledjob": executeQueuedScheduledJob,/);
  });
}

/* ════ F-852 — a listener/job run ASSEMBLES its namespace executors; `{}` was a lie ════
 *
 * Every door into this surface passed `executors = {}`, so a git or Confluence action
 * that had just survived the whole save-time and run-time gate reached the dispatcher and
 * was told `"commit_files" needs a git connection, and none is configured for this rule.`
 * — a sentence that was FALSE on an instance that had one, and useless on one that did
 * not, because it named neither the rule's missing choice nor the admin's missing setup.
 *
 * These checks run the REAL listener and job modules against the REAL assembler and the
 * REAL git executor (its simulated write path never reaches a provider), and read the
 * executor map off the arguments the run handed `runAgentTask`.
 */
{
  const { gitNoConnectionReason, LEDGER_NOT_ON_THIS_SURFACE } = await import("../../src/agent-executors.js");
  const saveGate852 = buildAgentGateContext({ provider: "openai", edition: "standard", agentModel: "gpt-5.4", savedByRole: "admin" });
  const CONN = { id: "gc1", kind: "github", status: "active", label: "acme", repos: ["acme/app"] };
  const seedConn = () => { storage.__seed("git_conn_index", ["gc1"]); storage.__seed("git_conn:gc1", CONN); };

  const listenerRun = async ({ id, actions, connectionId, seed = true }) => {
    const state = reset();
    if (seed) seedConn();
    const config = normalizeListener({ id, name: id, events: [UPDATE], mode: "agent", agent: { instructions: "go", allowedActions: actions, connectionId } }, { gate: saveGate852, savedByRole: "admin" });
    storage.__seed(`listener:${id}`, config);
    const out = await testListener({ listener: config, issueKey: ISSUE.key, gateFacts: { provider: "openai", edition: "standard", agentModel: "gpt-5.4" } });
    assert.equal(state.runs.length, 1, "the run reached runAgentTask");
    return { state, args: state.runs[0], out, config };
  };
  const jobRun = async ({ id, actions, connectionId, seed = true }) => {
    const state = reset();
    if (seed) seedConn();
    const config = normalizeJob({ id, name: id, schedule: { cron: "*/5 * * * *" }, mode: "agent", agent: { instructions: "go", allowedActions: actions, connectionId } }, { gate: saveGate852, savedByRole: "admin" });
    storage.__seed(`job:${id}`, config);
    await runJob({ job: config, manual: true, forceSimulation: true, source: "test", gateFacts: { provider: "openai", edition: "standard", agentModel: "gpt-5.4" } });
    assert.equal(state.runs.length, 1);
    return { state, args: state.runs[0], config };
  };

  await check("F-852 ALLOW: an admin-saved listener with a connection gets a SIMULATED git executor, and commit_files reaches it", async () => {
    const { args, config } = await listenerRun({ id: "f852-l-allow", actions: ["get_issue", "commit_files"], connectionId: "gc1" });
    assert.equal(config.agent.connectionId, "gc1", "the record carries the connection the rule acts as");
    const ex = args.executors;
    assert.ok(ex && ex.git, "a git executor was assembled");
    // THE FACTORY ARGUMENT: the executor reports the `simulation` it was built with, and
    // `forceSimulation` (a test run) must reach it — a test run that made a real commit
    // is the single worst outcome this cut could have.
    assert.equal(ex.git.simulation, true);
    assert.deepEqual(ex.refusals, {}, "nothing was refused");
    const r = await ex.git.execute("commit_files", { repo: "acme/app", branch: "main", message: "m", files: [{ path: "a.txt", content: "x" }] });
    assert.equal(r.success, true);
    assert.equal(r.simulated, true, "the write was recorded, never issued");
    assert.equal(r.connection, "gc1", "…on the connection the RULE names");
  });

  await check("F-852 ALLOW: the same on a scheduled job — one map for the whole run", async () => {
    const { args } = await jobRun({ id: "f852-j-allow", actions: ["get_issue", "commit_files"], connectionId: "gc1" });
    assert.equal(args.executors.git.simulation, true);
    const r = await args.executors.git.execute("commit_files", { repo: "acme/app", branch: "main", message: "m", files: [{ path: "a.txt", content: "x" }] });
    assert.equal(r.simulated, true);
  });

  await check("F-852 BLOCK, NAMED: no connectionId gets the new sentence, never the generic one", async () => {
    const { args } = await listenerRun({ id: "f852-l-noconn", actions: ["get_issue", "commit_files"], connectionId: null });
    assert.equal(args.executors.git, undefined, "no executor is built from a connection nobody named");
    assert.equal(args.executors.refusals.git, gitNoConnectionReason(1), "the instance HAS one, so the sentence says to choose it");
    assert.match(args.executors.refusals.git, /does not name a Git connection/);
    assert.doesNotMatch(args.executors.refusals.git, /none is configured for this rule/);
  });

  await check("F-852 BLOCK, NAMED: with no connection on the instance at all, the sentence names the admin's job", async () => {
    const { args } = await listenerRun({ id: "f852-l-nonone", actions: ["commit_files"], connectionId: null, seed: false });
    assert.equal(args.executors.refusals.git, gitNoConnectionReason(0));
    assert.match(args.executors.refusals.git, /this instance has none/);
  });

  await check("F-852 BLOCK: a dangerous action on an external trigger is refused at the GATE — the executor is never consulted", async () => {
    const { args } = await listenerRun({ id: "f852-l-danger", actions: ["get_issue", "approve_pull_request"], connectionId: "gc1" });
    // A listener is ALWAYS an external trigger, so the gate the run built drops it.
    const v = normalizeAllowedActions(args.allowedActions, args.gate);
    assert.deepEqual(v.allowed, ["get_issue"]);
    assert.deepEqual(v.refused, [{ id: "approve_pull_request", reason: "external-trigger" }]);
  });

  /* F-865 — THE SAVE NOW REFUSES IT, so the run-time refusal below is a BACKSTOP rather
   * than the first line. `stage_reply` carried no capability, no product, no `confirm`
   * and no `dangerous`, so it passed every arm of the gate and a listener could SAVE it;
   * the model was then OFFERED the tool and spent a round discovering F-852's
   * refusal-by-name. `requiresSurface: "va"` on the ledger namespace moves the no to the
   * save. Both halves are asserted: the save refuses, and a row that predates the flag
   * (planted here exactly as an upgraded instance would hold one) is neither given an
   * executor nor OFFERED the tool. */
  await check("F-865 BLOCK: saving a listener with a ledger action is refused by name at the SAVE", async () => {
    reset(); seedConn();
    assert.throws(() => normalizeListener({ id: "f865-l", name: "x", events: [UPDATE], mode: "agent", agent: { instructions: "go", allowedActions: ["get_issue", "stage_reply"], connectionId: "gc1" } }, { gate: saveGate852, savedByRole: "admin" }),
      (e) => e.reason === "action-not-allowed" && e.refused.length === 1
        && e.refused[0].id === "stage_reply" && e.refused[0].reason === "wrong-surface:va"
        && /Virtual Administrator/.test(e.message),
      "the save refuses stage_reply by name, with the cause an operator can read");
  });

  await check("F-852 NEGATIVE: a LEGACY listener row holding a ledger action gets no executor and is offered no tool", async () => {
    const state = reset(); seedConn();
    // Planted PAST the normalizer on purpose: no save door can mint this row since F-865,
    // and an upgraded instance is exactly where one still exists.
    const clean = normalizeListener({ id: "f852-l-ledger", name: "x", events: [UPDATE], mode: "agent", agent: { instructions: "go", allowedActions: ["get_issue"], connectionId: "gc1" } }, { gate: saveGate852, savedByRole: "admin" });
    const legacy = { ...clean, agent: { ...clean.agent, allowedActions: ["get_issue", "stage_reply"] } };
    storage.__seed("listener:f852-l-ledger", legacy);
    await testListener({ listener: legacy, issueKey: ISSUE.key, gateFacts: { provider: "openai", edition: "standard", agentModel: "gpt-5.4" } });
    const args = state.runs[0];
    assert.equal(args.executors.ledger, undefined, "no ledger executor is ever built here");
    assert.equal(args.executors.refusals.ledger, LEDGER_NOT_ON_THIS_SURFACE);
    // F-865 — and the RUN-TIME gate drops it before the tool list is built, so the model
    // never sees a tool it could only be refused for calling.
    const v = normalizeAllowedActions(args.allowedActions, args.gate);
    assert.deepEqual(v.allowed, ["get_issue"], "the run keeps only what this surface can serve");
    assert.deepEqual(v.refused, [{ id: "stage_reply", reason: "wrong-surface:va" }]);
    assert.deepEqual(toolDefinitionsFor(v.allowed, { pregated: true }).map((t) => t.function.name), ["get_issue", "finish"],
      "the offered tools are the Jira read and finish — no stage_reply");
  });

  await check("F-852: a GIT-TRIGGERED delivery's connection WINS over the rule's — a run started by A acts on A", async () => {
    const state = reset();
    storage.__seed("git_conn_index", ["gc1", "gc2"]);
    storage.__seed("git_conn:gc1", CONN);
    storage.__seed("git_conn:gc2", { ...CONN, id: "gc2", label: "other" });
    const cfg = normalizeListener({ id: "f852-ctx", name: "x", events: [UPDATE], mode: "agent", simulationMode: true, agent: { instructions: "go", allowedActions: ["commit_files"], connectionId: "gc1" } }, { gate: saveGate852, savedByRole: "admin" });
    storage.__seed("listener:f852-ctx", cfg);
    await executeListenerTask({ listenerId: "f852-ctx", eventType: UPDATE, event: { issue: ISSUE }, ctx: { issueKey: ISSUE.key, projectKey: "LZPT", connectionId: "gc2" } }, "task-ctx",
      { gateFacts: { provider: "openai", edition: "standard", agentModel: "gpt-5.4" } });
    const r = await state.runs[0].executors.git.execute("commit_files", { repo: "acme/app", branch: "main", message: "m", files: [{ path: "a.txt", content: "x" }] });
    assert.equal(r.connection, "gc2", "the delivery's connection, not the rule's");
  });

  await check("F-852 PARITY: the TEST door and the QUEUED door produce the same allowed set and the same executor map", async () => {
    const ACTIONS = ["get_issue", "add_comment", "commit_files"];
    const facts = { provider: "openai", edition: "standard", agentModel: "gpt-5.4", allowanceLevel: null };
    const shape = (ex) => ({ namespaces: Object.keys(ex).filter((k) => k !== "refusals").sort(), simulation: ex.git ? ex.git.simulation : null, refusals: ex.refusals });

    const s1 = reset(); seedConn();
    const cfg = normalizeListener({ id: "f852-parity", name: "p", events: [UPDATE], mode: "agent", simulationMode: true, agent: { instructions: "go", allowedActions: ACTIONS, connectionId: "gc1" } }, { gate: saveGate852, savedByRole: "admin" });
    storage.__seed("listener:f852-parity", cfg);
    await testListener({ listener: cfg, issueKey: ISSUE.key, gateFacts: facts });
    const testArgs = s1.runs[0];

    const s2 = reset(); seedConn();
    storage.__seed("listener:f852-parity", cfg);
    await executeListenerTask({ listenerId: "f852-parity", eventType: UPDATE, event: { issue: ISSUE }, ctx: { issueKey: ISSUE.key, projectKey: "LZPT" } }, "task-f852", { gateFacts: facts });
    const queuedArgs = s2.runs[0];

    assert.deepEqual(normalizeAllowedActions(queuedArgs.allowedActions, queuedArgs.gate).allowed,
      normalizeAllowedActions(testArgs.allowedActions, testArgs.gate).allowed, "the two doors allow the same ids");
    assert.deepEqual(shape(queuedArgs.executors), shape(testArgs.executors), "…and hold the same executor map");
    assert.equal(queuedArgs.executors.git.simulation, true, "the rule's own simulationMode reaches the executor on the LIVE door too");
  });

  await check("F-852: a caller-supplied executor map still WINS, whole and unmerged", async () => {
    const state = reset(); seedConn();
    const mine = { git: { namespace: "git", execute: async () => ({ success: true }) }, refusals: {} };
    const cfg = normalizeListener({ id: "f852-caller", name: "c", events: [UPDATE], mode: "agent", agent: { instructions: "go", allowedActions: ["commit_files"], connectionId: "gc1" } }, { gate: saveGate852, savedByRole: "admin" });
    await testListener({ listener: cfg, issueKey: ISSUE.key, executors: mine });
    assert.equal(state.runs[0].executors, mine);
  });

  await check("F-852: a Jira-only listener is byte-identical to the pre-1.4 run — no executor at all", async () => {
    const { args } = await listenerRun({ id: "f852-l-plain", actions: ["get_issue", "add_comment"], connectionId: "gc1" });
    assert.deepEqual(Object.keys(args.executors), ["refusals"]);
    assert.deepEqual(args.executors.refusals, {});
  });
}

console.log(`RULES RUNTIME REGRESSION: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
