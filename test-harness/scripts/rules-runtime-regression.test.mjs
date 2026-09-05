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
import { normalizeListener, testListener, executeListenerTask, matchListenerStatic, listenerTrigger, readListenerIndex, toIndexRow } from "../../src/listeners.js";
import { normalizeJob, runJob, executeScheduledJobTask, scheduledTick } from "../../src/scheduled-jobs.js";
import { JIRA_EVENTS } from "../../src/shared/jira-events.js";
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
for (const eventMeta of JIRA_EVENTS.filter(e => e.projectScoped === false)) await check(`global event ignores project filters in both match paths: ${eventMeta.id}`, async () => {
  reset();
  const config = listener({ projectKeys: ["OTHER"] }, { id: "global-match", events: [eventMeta.id] });
  assert.equal(matchListenerStatic(config, { eventType: eventMeta.id }, {}).ok, true);
  storage.__seed("listener:global-match", config); storage.__seed("listener_index", [toIndexRow(config)]);
  await readListenerIndex(); // refresh this test container; live saves require ~35s for the 30s cache
  await listenerTrigger({ eventType: eventMeta.id });
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
console.log(`RULES RUNTIME REGRESSION: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
