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
import { readFileSync, readdirSync } from "node:fs";
import { testStateTrigger } from "../../src/test-hook.js";
// F-770 — the platform's key predicate, imported from its ONE home so these checks
// assert the same rule the door now asks rather than a retyped copy of it.
import { isKvsKey } from "../../src/shared/kvs-keys.js";
// F-769 — the credential census, imported from its ONE home so these checks ask the same
// predicate the read ceiling asks rather than a retyped list of prefixes.
import { isCredentialKey } from "../../src/test-hook.js";

// F-137 — the two "no retyped slot name" gates below stripped only WHOLE-LINE comments,
// so a trailing `// COGNIRUNNER_KEY_openai` (a comment is allowed to NAME a slot) read as
// code and would have failed the gate for a file that is perfectly correct — and the same
// blind spot hides real code that shares a line with a trailing comment. One scanner, used
// by both gates: block comments, line comments wherever they start, walking string and
// template literals so a `//` inside a URL is not a comment. Escapes outside strings are
// consumed in pairs so a regex literal's `\/` cannot open a phantom comment.
const stripJsComments = (src) => {
  let out = "", i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") { out += c + (src[i + 1] || ""); i += 2; continue; }
    if (c === "/" && src[i + 1] === "/") { const nl = src.indexOf("\n", i); i = nl < 0 ? src.length : nl; continue; }
    if (c === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i); i = e < 0 ? src.length : e + 2; out += " "; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const q = c; out += c; i++;
      while (i < src.length && src[i] !== q) { if (src[i] === "\\") { out += src[i]; i++; } out += src[i] === undefined ? "" : src[i]; i++; }
      out += q; i++; continue;
    }
    out += c; i++;
  }
  return out;
};

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
    }
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
      for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(["'`])([^"'`\n]*)\2\s*;/g)) if (!own.has(m[1])) own.set(m[1], m[3]);
      ownConstants.set(name, own);
      for (const [k, v] of own) if (/^[A-Z][A-Z0-9_]*$/.test(k) && !constants.has(k)) constants.set(k, v);
      for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\([^)]*\)\s*=>\s*(?:[A-Za-z_$][\w$]*\()?\s*`([^`]*)`/g)) if (!builders.has(m[1])) builders.set(m[1], m[2]);
      for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\([^)]*\)\s*=>\s*([A-Z_][\w$]*)\s*\+/g)) if (!builders.has(m[1])) builders.set(m[1], "${" + m[2] + "}");
    }
    const sites = [];
    for (const [file, src] of code) {
      const lines = src.split("\n");
      const own = ownConstants.get(file);
      const constOf = (n) => (own.has(n) ? own.get(n) : (constants.has(n) ? constants.get(n) : null));
      /* The key PREFIX a write site lands on: interpolations become the end of the
         prefix, which is what a family is — `git_conn_secret:${id}` -> `git_conn_secret:`. */
      const resolveKey = (expr, win, depth = 0) => {
        if (depth > 3) return null;
        let e = expr.trim();
        const tpl = e.match(/^`([\s\S]*)`$/);
        if (!tpl) {
          const lit = e.match(/^["']([^"']*)["']$/);
          if (lit) return lit[1];
          const call = e.match(/^([A-Za-z_$][\w$]*)\s*\(/);
          if (call && builders.has(call[1])) e = builders.get(call[1]);
          else {
            const plus = e.match(/^([A-Za-z_$][\w$]*)\s*\+/);
            if (plus && constOf(plus[1]) !== null) return constOf(plus[1]);
            if (/^[A-Za-z_$][\w$]*$/.test(e)) {
              if (constOf(e) !== null) return constOf(e);
              /* a local `const key = gitHookSecretKey(a, b);` — follow it once */
              const re = new RegExp("(?:const|let|var)\\s+" + e + "\\s*=\\s*([^;\\n]+);", "g");
              let mm, last = null;
              while ((mm = re.exec(win))) last = mm[1];
              return last ? resolveKey(last, win, depth + 1) : null;
            }
            return null;
          }
        } else e = tpl[1];
        e = e.replace(/\$\{([A-Za-z_$][\w$]*)\}/g, (_s, n) => (constOf(n) !== null ? constOf(n) : " "));
        e = e.replace(/\$\{[\s\S]*?\}/g, " ");
        return e.split(/\s/)[0] || null;
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
        const fields = new Set();
        const scanFields = (txt) => { for (const m of txt.matchAll(/(?:^|[{,\s])["']?([A-Za-z_$][\w$]*)["']?\s*[:=](?!=)/g)) if (isSecretField(m[1])) fields.add(m[1]); };
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
        if (fields.size) sites.push({ file, line, keyExpr, key: resolveKey(keyExpr, win), fields: [...fields].sort() });
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
    /* The field words are the hook's OWN list, read from its one home — the same words the
       write door refuses a FIELD for. Retyping them here would be the second home this
       whole rule exists to prevent. */
    const hookSrc = readFileSync(new URL("test-hook.js", SRC), "utf8");
    const hints = [...(hookSrc.match(/const SECRET_KEY_HINTS\s*=\s*\[([\s\S]*?)\]/)?.[1] || "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    assert.ok(hints.length >= 10, `SECRET_KEY_HINTS must be READ from src/test-hook.js (got ${hints.length})`);

    const sites = scanSecretWriteSites(sources, hints);
    assert.ok(sites.length >= 20, `the scanner must still SEE the write sites (found ${sites.length})`);
    /* Every site resolves to a key, or the scanner has stopped understanding how this repo
       builds KVS keys — an unresolved key is a hole, not a pass. */
    const unresolved = sites.filter((s) => !s.key);
    assert.deepEqual(unresolved, [], "every secret-carrying write site must resolve to a key prefix");

    const uncovered = sites.filter((s) => !isCredentialKey(s.key) && !NOT_A_CREDENTIAL.has(s.key));
    assert.deepEqual(uncovered.map((s) => `${s.file}:${s.line} ${s.key} {${s.fields.join(",")}}`), [],
      "a KVS row stores a secret-looking field under a key the read ceiling does not mask — declare the family in CREDENTIAL_KEY_FAMILIES, or add it to NOT_A_CREDENTIAL with the reason");

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
console.log(`RULES RUNTIME REGRESSION: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
