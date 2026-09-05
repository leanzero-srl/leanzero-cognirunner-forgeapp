/* CogniRunner - Copyright (C) 2025 LeanZero. SPDX-License-Identifier: AGPL-3.0-or-later */
import "../lib/register-mocks-index.mjs";
import { register } from "node:module";
import assert from "node:assert/strict";
const real = await import("../../src/index.js");
const { default: jira } = await import("@forge/api");
globalThis.__agentIdentity = { ...real, getOpenAIKey: async () => "offline", getOpenAIModel: async () => "offline", raceDeadline: p => p };
register("data:text/javascript," + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if(spec === './index.js' && ctx.parentURL.endsWith('/src/agent-runner.js')) return {url:'agent-identity:index',shortCircuit:true};
  return next(spec,ctx);
}
export async function load(url,ctx,next) {
  if(url==='agent-identity:index') return {format:'module',shortCircuit:true,source:
    'export const createSandboxSession=(...a)=>globalThis.__agentIdentity.createSandboxSession(...a); export const getOpenAIKey=(...a)=>globalThis.__agentIdentity.getOpenAIKey(...a); export const getOpenAIModel=(...a)=>globalThis.__agentIdentity.getOpenAIModel(...a); export const callAIChat=(...a)=>globalThis.__agentIdentity.callAIChat(...a); export const raceDeadline=p=>p; export const isJobCancelled=async()=>false;'};
  return next(url,ctx);
}`));
const { runAgentTask } = await import("../../src/agent-runner.js");
for (const simulationMode of [true, false]) {
  let round = 0, createdKey;
  jira.__reset();
  jira.__respond(() => jira.__response(200, { key: "ABC-2" }));
  globalThis.__agentIdentity.callAIChat = async ({ messages }) => {
    let name, args;
    if (round++ === 0) { name = "create_issue"; args = { projectKey: "ABC", issueType: "Task", summary: "new" }; }
    else if (round === 2) { createdKey = JSON.parse(messages.at(-1).content).key; name = "add_labels"; args = { issueKey: createdKey, labels: ["new-child"] }; }
    else { name = "finish"; args = { outcome: "done", summary: "Created and labelled child" }; }
    return { ok: true, data: { choices: [{ message: { role: "assistant", tool_calls: [{ id: `call-${round}`, function: { name, arguments: JSON.stringify(args) } }] } }] } };
  };
  const result = await runAgentTask({ issueKey: "ABC-1", config: { simulationMode }, instructions: "Create and label the new child", allowedActions: ["create_issue", "add_labels"], maxRounds: 3 });
  assert.equal(result.success, true, JSON.stringify(result));
  assert.ok(result.toolCalls.every(c => c.ok), JSON.stringify(result.toolCalls));
  assert.equal(result.changes.length, 2);
  assert.equal(result.changes[0].key, createdKey);
  assert.equal(result.changes[1].key, createdKey);
  assert.notEqual(createdKey, "ABC-1");
  if (simulationMode) assert.equal(jira.__calls.length, 0);
  else assert.equal(jira.__calls.length, 2);
}
console.log("actual agent and sandbox preserve created issue identity in simulation and live dispatch");
