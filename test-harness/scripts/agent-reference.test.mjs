/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Actual agent loop and tool dispatch, with only provider and sandbox I/O mocked.
import { register } from "node:module";
import assert from "node:assert/strict";
import { AGENT_ACTIONS, toolDefinitionsFor } from "../../src/shared/agent-actions.js";
register("data:text/javascript," + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === "./index.js" && String(ctx.parentURL || "").endsWith("/src/agent-runner.js")) return { url: "agent-reference:index", shortCircuit: true };
  return next(spec, ctx);
}
export async function load(url, ctx, next) {
  if (url === "agent-reference:index") return { format: "module", shortCircuit: true, source: \
    "export const createSandboxSession = args => globalThis.__agentReference.session(args); export const getOpenAIKey = async () => 'mock-key'; export const getOpenAIModel = async () => 'mock-model'; export const raceDeadline = p => p; export const callAIChat = args => globalThis.__agentReference.provider(args); export const isJobCancelled = async () => false; export const coerceToAdf = s => s; export const extractTextFromADF = s => s;" };
  return next(url, ctx);
}`));
const { runAgentTask } = await import("../../src/agent-runner.js");
let passed = 0, failed = 0;
const check = async (name, fn) => { try { await fn(); passed++; } catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`); } };
const call = (name, args, raw = false) => ({ id: "call-test", function: { name, arguments: raw ? args : JSON.stringify(args) } });
const finish = () => call("finish", { summary: "Complete", outcome: "done" });
const exercise = async (calls, { issueKey = "LZPT-2", allowedActions = AGENT_ACTIONS.map(a => a.id), laterCalls = [], maxRounds = 3 } = {}) => {
  const state = globalThis.__agentReference = {
    writes: [], requests: [], round: 0,
    session({ issueKey: boundKey }) {
      const changes = [], executionLogs = [];
      const api = key => new Proxy({}, { get(_target, method) {
        if (method === "forIssue") return other => api(other);
        return async (...args) => { state.writes.push({ method, key, args }); return method === "searchJql" ? { issues: [] } : { ok: true }; };
      } });
      return { changes, executionLogs, simulated: true, createApi: () => api(boundKey) };
    },
    async provider(args) {
      this.requests.push(structuredClone(args));
      const tool_calls = this.round++ === 0 ? calls : this.round === 2 && laterCalls.length ? laterCalls : [finish()];
      return { ok: true, data: { choices: [{ message: { role: "assistant", tool_calls } }], usage: { total_tokens: 1 } } };
    },
  };
  const result = await runAgentTask({ issueKey, allowedActions, maxRounds, instructions: "Only run the requested tool", config: { simulationMode: true } });
  return { state, result };
};
const validArgs = name => ({
  get_issue: {}, add_comment: { text: "test" }, update_fields: { fields: { summary: "test" } },
  add_labels: { labels: ["test"] }, remove_labels: { labels: ["test"] }, set_assignee: { accountId: "unassigned" },
  transition_issue: { transitionName: "Done" }, link_issues: { otherIssueKey: "LZPT-3" }, add_watcher: { accountId: "user" },
  send_notification: { subject: "test", body: "test" }, add_worklog: { timeSpentSeconds: 60 },
  create_issue: { projectKey: "LZPT", issueType: "Task", summary: "test" },
}[name]);
const issueActions = AGENT_ACTIONS.filter(a => a.parameters.properties.issueKey);
for (const action of issueActions) for (const bad of ['{"key":"LZPT-3"}', { key: "LZPT-3" }, "LZPT-3/../../", "LZPT-3?fields=*", "", "   ", null, 200, ["LZPT-3"], true]) await check(`${action.id} rejects malformed explicit reference ${JSON.stringify(bad)}`, async () => {
  const { state, result } = await exercise([call(action.id, { ...validArgs(action.id), issueKey: bad })]);
  assert.equal(state.writes.length, 0, "must not call sandbox or fall back to current issue");
  assert.equal(result.toolCalls[0].ok, false); assert.match(result.logs.join("\n"), /issueKey/);
});
for (const field of ["parentKey", "otherIssueKey"]) for (const bad of ['{"key":"LZPT-3"}', { key: "LZPT-3" }, "LZPT-3/path", "", null, 200]) await check(`${field} rejects malformed reference ${JSON.stringify(bad)}`, async () => {
  const name = field === "parentKey" ? "create_issue" : "link_issues";
  const { state, result } = await exercise([call(name, { ...validArgs(name), [field]: bad })]);
  assert.equal(state.writes.length, 0); assert.equal(result.toolCalls[0].ok, false);
  assert.match(result.logs.join("\n"), new RegExp(field));
});
for (const raw of ["{invalid", "null", "[]", '"LZPT-3"']) await check(`invalid argument envelope cannot become current issue: ${raw}`, async () => {
  const { state, result } = await exercise([call("add_comment", raw, true)]);
  assert.equal(state.writes.length, 0); assert.equal(result.toolCalls[0].ok, false);
});
for (const action of issueActions) await check(`${action.id} still accepts omitted bound issue`, async () => {
  const { state, result } = await exercise([call(action.id, validArgs(action.id))]);
  assert.equal(result.toolCalls[0].ok, true); assert.equal(state.writes.length, 1); assert.equal(state.writes[0].key, "LZPT-2");
});
for (const value of ["lzpt-3", "MIXED_Key1-42", "200", " LZPT-3 "]) for (const field of ["issueKey", "parentKey", "otherIssueKey"]) await check(`${field} accepts ${JSON.stringify(value)} without changing identity`, async () => {
  const name = field === "parentKey" ? "create_issue" : field === "otherIssueKey" ? "link_issues" : "add_comment";
  const { state, result } = await exercise([call(name, { ...validArgs(name), [field]: value })]);
  assert.equal(result.toolCalls[0].ok, true); assert.equal(state.writes.length, 1);
  const write = state.writes[0]; const actual = field === "parentKey" ? write.args[0].parent.key : field === "otherIssueKey" ? write.args[0] : write.key;
  assert.equal(actual, value.trim());
});
await check("non-issue run requires an explicit target", async () => {
  const { state, result } = await exercise([call("add_comment", { text: "test" })], { issueKey: null });
  assert.equal(state.writes.length, 0); assert.equal(result.toolCalls[0].ok, false);
  assert.match(result.logs.join("\n"), /needs a current issue/);
});
await check("link destination cannot be omitted", async () => {
  const { state, result } = await exercise([call("link_issues", {})]);
  assert.equal(state.writes.length, 0); assert.equal(result.toolCalls[0].ok, false);
});
await check("creating an ordinary issue still omits parent", async () => {
  const { state, result } = await exercise([call("create_issue", validArgs("create_issue"))], { issueKey: null });
  assert.equal(result.toolCalls[0].ok, true); assert.equal(state.writes[0].args[0].parent, undefined);
});
await check("allow-list denies a valid reference before writes", async () => {
  const { state, result } = await exercise([call("add_comment", { issueKey: "LZPT-3", text: "test" })], { allowedActions: ["get_issue"] });
  assert.equal(state.writes.length, 0); assert.equal(result.toolCalls[0].ok, false); assert.match(result.logs.join("\n"), /not allowed/);
});
await check("model may recover from a malformed key with a valid explicit target", async () => {
  const { state, result } = await exercise([call("add_comment", { issueKey: '{"key":"LZPT-3"}', text: "test" })], { laterCalls: [call("add_comment", { issueKey: "LZPT-3", text: "test" })] });
  assert.equal(state.writes.length, 1); assert.equal(state.writes[0].key, "LZPT-3");
  assert.equal(result.toolCalls[0].ok, false); assert.equal(result.toolCalls[1].ok, true);
  assert.match(state.requests[1].messages.at(-1).content, /issueKey/);
});
await check("all three reference schemas share the same pattern", async () => {
  const refs = toolDefinitionsFor(AGENT_ACTIONS.map(a => a.id)).flatMap(t => Object.entries(t.function.parameters.properties).filter(([name]) => ["issueKey", "parentKey", "otherIssueKey"].includes(name)).map(([, schema]) => schema));
  assert.ok(refs.length > 3); assert.ok(refs.every(s => s.type === "string" && typeof s.pattern === "string"));
  assert.equal(new Set(refs.map(s => s.pattern)).size, 1);
  const pattern = new RegExp(refs[0].pattern); assert.equal(pattern.test('{"key":"LZPT-3"}'), false); assert.equal(pattern.test("200"), true);
});
console.log(`AGENT REFERENCES: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
