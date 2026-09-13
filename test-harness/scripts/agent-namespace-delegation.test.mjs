/* CogniRunner - Copyright (C) 2025 LeanZero. SPDX-License-Identifier: AGPL-3.0-or-later */
// runAgentTask delegates by NAMESPACE: git.* goes to the injected executor, an
// absent executor REFUSES with not_configured, and the Jira actions are untouched.
import "../lib/register-mocks-index.mjs";
import { register } from "node:module";
import assert from "node:assert/strict";
const real = await import("../../src/index.js");
const { default: jira } = await import("@forge/api");
globalThis.__agentNs = { ...real, getOpenAIKey: async () => "offline", getOpenAIModel: async () => "offline" };
register("data:text/javascript," + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if(spec === './index.js' && ctx.parentURL.endsWith('/src/agent-runner.js')) return {url:'agent-ns:index',shortCircuit:true};
  return next(spec,ctx);
}
export async function load(url,ctx,next) {
  if(url==='agent-ns:index') return {format:'module',shortCircuit:true,source:
    'export const createSandboxSession=(...a)=>globalThis.__agentNs.createSandboxSession(...a); export const getOpenAIKey=(...a)=>globalThis.__agentNs.getOpenAIKey(...a); export const getOpenAIModel=(...a)=>globalThis.__agentNs.getOpenAIModel(...a); export const callAIChat=(...a)=>globalThis.__agentNs.callAIChat(...a); export const extractTextFromADF=(...a)=>globalThis.__agentNs.extractTextFromADF(...a); export const coerceToAdf=(...a)=>globalThis.__agentNs.coerceToAdf(...a); export const raceDeadline=p=>p; export const isJobCancelled=async()=>false;'};
  return next(url,ctx);
}`));
const { runAgentTask } = await import("../../src/agent-runner.js");

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m + " — got " + JSON.stringify(a)); n++; };

// The model calls `script` in order, then finish.
const scripted = (script) => {
  let i = 0;
  globalThis.__agentNs.callAIChat = async () => {
    const step = script[i++] || { name: "finish", args: { outcome: "done", summary: "done" } };
    return { ok: true, data: { choices: [{ message: { role: "assistant", tool_calls: [{ id: "c" + i, function: { name: step.name, arguments: JSON.stringify(step.args) } }] } }] } };
  };
};
const ADMIN_GIT = { capability: true, savedByRole: "admin" };
const lastToolResult = (res) => res.toolCalls;

/* ---------- git.* reaches the injected executor, not the Jira switch ---------- */
jira.__reset();
let seen = [];
const gitExecutor = { namespace: "git", execute: async (id, args) => { seen.push({ id, args }); return { success: true, action: id, number: 7 }; } };
scripted([{ name: "open_pull_request", args: { repo: "acme/app", title: "t", sourceBranch: "feat" } }]);
let res = await runAgentTask({
  instructions: "open a PR", allowedActions: ["open_pull_request"], gate: ADMIN_GIT, maxRounds: 3,
  issueKey: "ABC-1", executors: { git: gitExecutor },
});
eq(res.success, true, "the run succeeds");
eq(seen.map((s) => s.id), ["open_pull_request"], "the git action was delegated to the git executor");
eq(seen[0].args.repo, "acme/app", "the model's arguments reach the executor verbatim (it does the clamping)");
ok(lastToolResult(res)[0].ok === true, "the tool call is reported ok");
eq(jira.__calls.length, 0, "no Jira REST call was made for a git action");

/* ---------- no executor → not_configured, and nothing is attempted ---------- */
scripted([{ name: "open_pull_request", args: { repo: "acme/app", title: "t", sourceBranch: "feat" } }]);
res = await runAgentTask({ instructions: "open a PR", allowedActions: ["open_pull_request"], gate: ADMIN_GIT, maxRounds: 3, issueKey: "ABC-1" });
const refusal = res.toolCalls[0];
ok(refusal && refusal.name === "open_pull_request", "the call was attempted");
eq(refusal.ok, false, "an unconfigured namespace reads as a FAILED tool call, never as ok");
ok(res.logs.some((l) => /tool ERROR open_pull_request/.test(l)), "the operator's log says the call failed");
eq(jira.__calls.length, 0, "an unconfigured namespace never touches Jira");

/* ---------- the gate still governs: without the context the git tool is not offered ---------- */
scripted([{ name: "finish", args: { outcome: "done", summary: "s" } }]);
res = await runAgentTask({ instructions: "x", allowedActions: ["open_pull_request", "get_issue"], maxRounds: 2, issueKey: "ABC-1", executors: { git: gitExecutor } });
ok(res.logs[0].includes("actions=[get_issue]"), "arity-1 (no gate) offers only the Jira action — " + res.logs[0]);
scripted([{ name: "approve_pull_request", args: { repo: "acme/app", number: 1 } }]);
res = await runAgentTask({ instructions: "x", allowedActions: ["approve_pull_request"], gate: { ...ADMIN_GIT, triggerSource: "external" }, maxRounds: 2, issueKey: "ABC-1", executors: { git: gitExecutor } });
eq(res.refusedActions, [{ id: "approve_pull_request", reason: "external-trigger" }], "an external run reports the dropped dangerous action");
ok(res.toolCalls[0].ok === false, "…and calling it anyway is refused by the runner");

/* ---------- Jira actions are untouched ---------- */
jira.__reset();
jira.__respond(() => jira.__response(200, { key: "ABC-1", fields: { summary: "S" } }));
scripted([{ name: "get_issue", args: { issueKey: "ABC-1" } }]);
seen = [];
res = await runAgentTask({ instructions: "read it", allowedActions: ["get_issue"], maxRounds: 3, issueKey: "ABC-1", executors: { git: gitExecutor } });
eq(res.success, true, "a Jira action still runs");
ok(jira.__calls.length >= 1, "…through the sandbox, against Jira REST");
eq(seen, [], "…and never through a namespace executor");

console.log(`agent namespace delegation: ${n} assertions passed`);
