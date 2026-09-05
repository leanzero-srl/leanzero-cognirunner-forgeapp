/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Actual sample read/capture/trigger/runtime functions; only platform and sandbox mocked.
// Auto-discovered by test:offline. Run: node scripts/event-sample-redaction.test.mjs
import "../lib/register-mocks.mjs";
import { register } from "node:module";
import assert from "node:assert/strict";
import storage from "../lib/mock-kvs.mjs";
import forgeApi, { pushed } from "../lib/mock-forge-api.mjs";

register("data:text/javascript," + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === "./index.js" && String(ctx.parentURL || "").endsWith("/src/listeners.js")) return { url: "cogni-sample:index", shortCircuit: true };
  return next(spec, ctx);
}
export async function load(url, ctx, next) {
  if (url === "cogni-sample:index") return { format: "module", shortCircuit: true, source:
    "export const makeTaskId = () => 'sample-task'; export const writeAsyncJob = async () => {}; export const runSandboxSteps = async (args) => { globalThis.__sampleRuntime = args; return { success: true, stepsTotal: 1, changes: [], logs: [], stepResults: [] }; };" };
  return next(url, ctx);
}`));
const { redactSample, getEventSample, saveListener, listenerTrigger, runListener } = await import("../../src/listeners.js");
const EVENT = "avi:jira:created:issue";
const KEY = `event_sample:${EVENT}`;
const noContextToken = (value) => {
  if (!value || typeof value !== "object") return;
  assert.equal(Object.hasOwn(value, "contextToken"), false, "sample must omit contextToken at every depth");
  for (const child of Object.values(value)) noContextToken(child);
};
const fixture = () => ({
  eventType: EVENT, contextToken: "synthetic-root",
  issue: { id: "100", key: "LZPT-1", fields: {
    project: { id: "10", key: "LZPT" }, summary: "Sample test", description: "private text",
    environment: { type: "doc", version: 1, content: [] },
    customfield_10001: { type: "doc", version: 1, content: [] },
  } },
  attachment: { id: "501", issueId: "100", fileName: "briefing.md", contextToken: "synthetic-nested" },
  comment: { body: "private comment" }, worklog: { comment: "private worklog" },
  nested: [null, false, 0, "keep", { contextToken: "synthetic-array", id: "502", deeper: [{ contextToken: "synthetic-deeper", flag: true }] }],
  contextTokenHint: "keep similarly named keys", ContextToken: "case-sensitive application field",
});
let passed = 0; let failed = 0;
const check = async (name, fn) => {
  try { await fn(); passed++; }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`); }
};

await check("capture redaction strips tokens while preserving payload shape and input", () => {
  const input = fixture(), before = structuredClone(input);
  const sample = redactSample(input);
  noContextToken(sample);
  assert.deepEqual(sample.attachment, { id: "501", issueId: "100", fileName: "briefing.md" });
  assert.deepEqual(sample.nested, [null, false, 0, "keep", { id: "502", deeper: [{ flag: true }] }]);
  assert.equal(sample.contextTokenHint, input.contextTokenHint);
  assert.equal(sample.ContextToken, input.ContextToken);
  assert.equal(sample.issue.fields.description, "<redacted text, 12 chars>");
  assert.equal(sample.comment.body, "<redacted text, 15 chars>");
  assert.equal(sample.worklog.comment, "<redacted text, 15 chars>");
  for (const key of ["environment", "customfield_10001"]) assert.deepEqual(sample.issue.fields[key], { type: "doc", version: 1, _redacted: true, content: [] });
  assert.deepEqual(input, before);
  assert.notEqual(sample.issue.fields, input.issue.fields);
});

for (const redacted of [true, false, undefined]) await check(`legacy cached read remains stable (redacted=${redacted})`, async () => {
  storage.__reset();
  const legacy = { eventType: EVENT, capturedAt: "2026-09-05T00:00:00.000Z", redacted, contextToken: "synthetic-envelope", payload: fixture() };
  legacy.payload.issue.fields.description = "<redacted text, 999 chars>";
  legacy.payload.comment.body = "<redacted text, 888 chars>";
  legacy.payload.worklog.comment = { type: "doc", version: 1, _redacted: true, content: [] };
  storage.__seed(KEY, legacy);
  const original = structuredClone(storage.__raw(KEY));
  const first = await getEventSample(EVENT);
  noContextToken(first);
  assert.equal(first.capturedAt, legacy.capturedAt);
  assert.equal(first.eventType, EVENT);
  assert.equal(first.redacted, redacted);
  assert.equal(first.payload.issue.fields.description, legacy.payload.issue.fields.description);
  assert.equal(first.payload.comment.body, legacy.payload.comment.body);
  assert.deepEqual(first.payload.worklog.comment, legacy.payload.worklog.comment);
  assert.equal(first.payload.attachment.fileName, "briefing.md");
  assert.deepEqual(await getEventSample(EVENT), first, "repeat reads preserve placeholders");
  storage.__seed(KEY, first);
  assert.deepEqual(await getEventSample(EVENT), first, "sanitizing an already sanitized record is idempotent");
  storage.__seed(KEY, original);
  first.payload.attachment.fileName = "changed by caller";
  assert.deepEqual(storage.__raw(KEY), original, "reads never alter stored legacy rows");
});

await check("absent and unsupported samples keep the null contract", async () => {
  storage.__reset();
  assert.equal(await getEventSample(EVENT), null);
  storage.__seed("event_sample:unsupported", { payload: fixture() });
  assert.equal(await getEventSample("unsupported"), null);
  assert.equal(await getEventSample(null), null);
});

await check("actual trigger stores sanitized sample and passes raw event into queue and runtime", async () => {
  storage.__reset(); forgeApi.__reset(); pushed.length = 0;
  const listener = await saveListener({ name: "Sample boundary", events: [EVENT], functions: [{ code: "api.log(1)" }] });
  const input = fixture(), before = structuredClone(input);
  // saveListener invalidates this mock container's index cache. Live tests wait ~35 s.
  await listenerTrigger(input, {});
  assert.equal(pushed.length, 1);
  const captured = await storage.get(KEY);
  assert.equal(captured.redacted, true);
  assert.ok(Number.isFinite(Date.parse(captured.capturedAt)));
  noContextToken(captured);
  assert.equal(captured.payload.attachment.fileName, "briefing.md");
  const { params } = pushed[0].body;
  assert.deepEqual(params.event, before, "raw queue event retains all original fields");
  const outcome = await runListener({ listener, eventType: EVENT, event: params.event, ctx: params.ctx });
  assert.equal(outcome.log.isValid, true);
  assert.deepEqual(globalThis.__sampleRuntime.extraContext.event, before, "api.context.event keeps its runtime contract");
  assert.deepEqual(input, before, "capture must never mutate the event used by matcher and runner");
  assert.equal(forgeApi.__calls.length, 0);
});

console.log(`event sample redaction: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
