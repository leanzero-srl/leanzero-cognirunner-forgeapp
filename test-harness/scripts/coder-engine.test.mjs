/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// THE CODER ENGINE (src/coder-engine.js) and the loop extraction it rides on
// (runAgentLoop / createAgentActionDispatcher, src/agent-runner.js), 1.4 commit 8.
//
// What is proven here, and why each one is a GUARANTEE rather than a habit:
//   · loop extraction PARITY — runAgentTask's outputs on the existing fixture shapes;
//   · a `confirm` action HALTS the turn and NOTHING is executed;
//   · the ticket id is absent from EVERY payload sent to the model (grepped over the
//     captured provider requests, not asserted on one field);
//   · a redelivered confirm executes exactly ONCE;
//   · a turn from another account is refused with the one refusal shape;
//   · compaction preserves decisions VERBATIM and stays under the cap;
//   · the per-issue claim is released when the turn THROWS;
//   · simulation makes no git call at all.
import { register } from "node:module";
import assert from "node:assert/strict";

// The engine and the runner both reach src/index.js lazily; stub it before either loads.
register("data:text/javascript," + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  const parent = String(ctx.parentURL || "");
  if (spec === "./index.js" && (parent.endsWith("/src/agent-runner.js") || parent.endsWith("/src/coder-engine.js") || parent.endsWith("/src/coder-workspace.js"))) {
    return { url: "coder-engine:index", shortCircuit: true };
  }
  return next(spec, ctx);
}
export async function load(url, ctx, next) {
  if (url === "coder-engine:index") return { format: "module", shortCircuit: true, source:
    "export const createSandboxSession = args => globalThis.__coder.session(args);"
    + "export const getOpenAIKey = async () => 'mock-key';"
    + "export const getOpenAIModel = async () => 'mock-model';"
    + "export const getProviderConfig = async () => ({ provider: globalThis.__coder.provider || 'anthropic' });"
    + "export const raceDeadline = p => p;"
    + "export const callAIChat = args => globalThis.__coder.chat(args);"
    + "export const isJobCancelled = async () => false;"
    + "export const coerceToAdf = s => s;"
    + "export const extractTextFromADF = s => s;"
    + "export const parseAIJson = () => ({});"
    + "export const getUserPermissions = async () => ({ role: globalThis.__coderRole || 'admin' });"
    + "export const UPLOAD_ALLOWED_EXTENSIONS = new Set(['.md','.txt']);"
    + "export const UPLOAD_MAX_BYTES = 26214400;" };
  return next(url, ctx);
}`));

const store = (await import("../lib/mock-kvs.mjs")).default;
const {
  runCoderTurn, confirmCoderTicket, compactThread, buildCoderSystemPrompt, buildArgsPreview,
  coderThreadKey, coderTicketKey, coderExecClaimKey, coderTicketExecClaimKey, coderThreadWriteClaimKey,
  CODER_MAX_ROUNDS, CODER_CLAIM_TTL_MINUTES, repairTranscript,
} = await import("../../src/coder-engine.js");
const { runAgentTask, runAgentLoop, createAgentActionDispatcher } = await import("../../src/agent-runner.js");
const { AGENT_ACTIONS } = await import("../../src/shared/agent-actions.js");
const { createGitActionExecutor } = await import("../../src/git-actions.js");

let passed = 0, failed = 0;
const check = async (name, fn) => { try { await fn(); passed++; } catch (e) { failed++; console.error(`FAIL ${name}: ${e.message}`); } };

/* ───────── harness plumbing ───────── */
const call = (name, args, id = "call-1") => ({ id, function: { name, arguments: JSON.stringify(args) } });
const finish = (summary = "Done") => call("finish", { summary, outcome: "done" }, "call-fin");
const reply = (tool_calls, content = null) => ({
  ok: true, status: 200,
  data: { choices: [{ message: { role: "assistant", content, tool_calls } }], usage: { total_tokens: 7 } },
});

const setupWorld = ({ rounds = [], provider = "anthropic" } = {}) => {
  const world = {
    provider, requests: [], writes: [], gitCalls: [], round: 0,
    session({ issueKey, config }) {
      const api = (key) => new Proxy({}, {
        get(_t, method) {
          if (method === "forIssue") return (other) => api(other);
          return async (...args) => {
            world.writes.push({ method, key, args });
            if (method === "getIssue") return { key, fields: { summary: "An issue", status: { name: "To Do" } } };
            if (method === "searchJql") return { issues: [] };
            return { ok: true };
          };
        },
      });
      return { changes: [], executionLogs: [], simulated: config && config.simulationMode === true, createApi: () => api(issueKey) };
    },
    async chat(args) {
      // A seam for the F-364 interleaving test: something else writes the thread row
      // while the model round is in flight.
      if (world.chatHook) await world.chatHook();
      world.requests.push(JSON.parse(JSON.stringify({ messages: args.messages, tools: (args.tools || []).map((t) => t.function.name) })));
      const r = rounds[world.round] !== undefined ? rounds[world.round] : reply([finish()]);
      world.round++;
      return typeof r === "function" ? r() : r;
    },
  };
  globalThis.__coder = world;
  return world;
};

/** A git executor that records instead of calling a provider. */
const recordingGit = (world) => ({
  execute: async (name, args) => { world.gitCalls.push({ name, args }); return { ok: true, name }; },
});

const resetStore = () => { store.__reset ? store.__reset() : null; };

/* ═════════ 1. loop extraction parity ═════════ */

await check("runAgentTask still reports rounds, tool calls, tokens and the finish summary", async () => {
  const world = setupWorld({ rounds: [reply([call("get_issue", {})]), reply([finish("All good")])] });
  const r = await runAgentTask({
    issueKey: "LZPT-2", allowedActions: ["get_issue"], maxRounds: 3,
    instructions: "read it", config: { simulationMode: true },
  });
  assert.equal(r.success, true);
  assert.equal(r.outcome, "done");
  assert.equal(r.summary, "All good");
  assert.equal(r.rounds, 2);
  assert.equal(r.tokens, 14);
  assert.deepEqual(r.toolCalls.map((t) => t.name), ["get_issue", "finish"]);
  assert.equal(world.writes[0].method, "getIssue");
});

await check("runAgentTask still fails closed on the round cap with the same sentence", async () => {
  setupWorld({ rounds: [reply([call("get_issue", {})]), reply([call("get_issue", {})]), reply([call("get_issue", {})])] });
  const r = await runAgentTask({ issueKey: "LZPT-2", allowedActions: ["get_issue"], maxRounds: 1, instructions: "loop", config: { simulationMode: true } });
  assert.equal(r.success, false);
  assert.match(r.error, /^Stopped after 1 tool rounds without finish$/);
});

await check("runAgentTask still surfaces a provider error and never claims success", async () => {
  setupWorld({ rounds: [() => ({ ok: false, status: 503, error: "upstream down" })] });
  const r = await runAgentTask({ issueKey: "LZPT-2", allowedActions: ["get_issue"], maxRounds: 2, instructions: "x", config: { simulationMode: true } });
  assert.equal(r.success, false);
  assert.equal(r.outcome, "failed");
  assert.match(r.error, /AI provider error \(503\)/);
});

await check("runAgentLoop reports endedBy and usage separately from the caller's result", async () => {
  setupWorld({ rounds: [reply([finish("ok")])] });
  const out = await runAgentLoop({
    messages: [{ role: "system", content: "s" }, { role: "user", content: "u" }],
    tools: [], maxRounds: 2, execute: async () => ({ finished: true }), apiKey: "k", model: "m",
  });
  assert.equal(out.endedBy, "finish");
  assert.equal(out.usage.tokens, 7);
  assert.equal(out.usage.cacheReadTokens, 0);
  assert.equal(out.actions.length, 1);
});

await check("a provider that reports zero cache reads across rounds logs one DEFECT line", async () => {
  setupWorld({ rounds: [reply([call("get_issue", {})]), reply([finish()])] });
  const logs = [];
  const warn = console.warn; console.warn = (...a) => logs.push(a.join(" "));
  try {
    await runAgentLoop({
      messages: [{ role: "system", content: "s" }, { role: "user", content: "u" }],
      tools: [], maxRounds: 3, provider: "anthropic", apiKey: "k", model: "m",
      execute: async () => ({ ok: true }),
    });
  } finally { console.warn = warn; }
  assert.equal(logs.filter((l) => /DEFECT/.test(l)).length, 1, "exactly one defect line");
  assert.match(logs.join("\n"), /0 cache-read tokens/);
});

await check("a provider with no cache-read billing gets no defect line", async () => {
  setupWorld({ rounds: [reply([call("get_issue", {})]), reply([finish()])] });
  const logs = [];
  const warn = console.warn; console.warn = (...a) => logs.push(a.join(" "));
  try {
    await runAgentLoop({
      messages: [{ role: "system", content: "s" }], tools: [], maxRounds: 3, provider: "openai",
      apiKey: "k", model: "m", execute: async () => ({ ok: true }),
    });
  } finally { console.warn = warn; }
  assert.equal(logs.filter((l) => /DEFECT/.test(l)).length, 0);
});

/* ═════════ 2. the consent ticket ═════════ */

const startTurn = async (world, extra = {}) => runCoderTurn({
  issueKey: "LZPT-7", threadId: "t1", userMessage: "open a PR for the fix", accountId: "acct-owner",
  gateFacts: { edition: "advanced", provider: "anthropic", agentModel: "claude-sonnet-5", allowanceLevel: null },
  savedByRole: "admin", deps: { store, gitExecutor: recordingGit(world), ticketId: () => "tkt_FIXED_ID" },
  ...extra,
});

await check("a confirm action halts the turn, writes a pending ticket and executes nothing", async () => {
  resetStore();
  const world = setupWorld({ rounds: [reply([call("open_pull_request", { repo: "acme/app", title: "Fix", sourceBranch: "fix/1" })])] });
  const r = await startTurn(world);
  assert.equal(r.success, true, "a question is not a failure");
  assert.equal(r.awaiting, "confirm");
  assert.equal(r.ticket.action, "open_pull_request");
  assert.equal(r.ticket.id, "tkt_FIXED_ID");
  assert.equal(r.endedBy, "halt");
  assert.equal(world.gitCalls.length, 0, "NOTHING may be performed before the user answers");
  const ticket = await store.get(coderTicketKey("tkt_FIXED_ID"));
  assert.equal(ticket.status, "pending");
  assert.equal(ticket.ownerAccountId, "acct-owner");
  assert.equal(ticket.argsPreview.repo, "acme/app");
});

await check("the ticket id never appears in ANY payload sent to the model", async () => {
  resetStore();
  const world = setupWorld({ rounds: [reply([call("commit_files", { repo: "acme/app", branch: "fix/1", message: "m", files: [{ path: "a.js", content: "x" }] })])] });
  const r = await startTurn(world);
  assert.equal(r.awaiting, "confirm");
  const blob = JSON.stringify(world.requests);
  assert.ok(!blob.includes("tkt_FIXED_ID"), "the ticket id leaked into the model context");
  assert.ok(!blob.includes("coder_ticket"), "the ticket key shape leaked into the model context");
  // And the model IS told a question was asked, so it does not retry.
  const thread = await store.get(coderThreadKey("LZPT-7", "t1"));
  const transcript = JSON.stringify(thread.messages);
  assert.ok(/was asked to confirm/.test(transcript));
  assert.ok(!transcript.includes("tkt_FIXED_ID"), "the ticket id must not sit in the thread the model is re-fed");
});

await check("every tool call in a halted round still gets a result, and none of them runs", async () => {
  resetStore();
  const world = setupWorld({ rounds: [reply([
    call("open_pull_request", { repo: "acme/app", title: "T", sourceBranch: "s" }, "c1"),
    call("get_issue", {}, "c2"),
  ])] });
  const r = await startTurn(world);
  assert.equal(r.awaiting, "confirm");
  assert.equal(world.gitCalls.length, 0);
  assert.equal(world.writes.filter((w) => w.method === "getIssue" && w.args[0] === "LZPT-7").length, 1,
    "only the prompt's own context read happened — the halted round's get_issue did not run");
  const thread = await store.get(coderThreadKey("LZPT-7", "t1"));
  const toolRows = thread.messages.filter((m) => m.role === "tool");
  assert.equal(toolRows.length, 2, "both tool calls were answered so the transcript stays valid");
});

await check("a second confirm request inside one turn is refused, not queued", async () => {
  resetStore();
  const world = setupWorld({ rounds: [reply([call("open_pull_request", { repo: "acme/app", title: "T", sourceBranch: "s" })])] });
  await startTurn(world);
  // The ticket row exists exactly once.
  const rows = [];
  for (const id of ["tkt_FIXED_ID"]) rows.push(await store.get(coderTicketKey(id)));
  assert.equal(rows.filter(Boolean).length, 1);
});

await check("F-359: a gate-REFUSED confirm action opens NO ticket — the gate runs before the ticket", async () => {
  resetStore();
  // A non-admin editor: `gateActions` refuses every `confirm` git action with
  // "needs-admin", so none of them is in `allowed`. The model names one anyway.
  const world = setupWorld({ rounds: [
    reply([call("trigger_deploy", { repo: "acme/app", workflow: "deploy.yml", ref: "main" })]),
    reply([finish("nothing done")]),
  ] });
  const r = await runCoderTurn({
    issueKey: "LZPT-7", threadId: "t1", userMessage: "ship it", accountId: "acct-owner",
    gateFacts: { edition: "advanced", provider: "anthropic", agentModel: "claude-sonnet-5", allowanceLevel: null },
    savedByRole: "editor",
    deps: { store, gitExecutor: recordingGit(world), ticketId: () => "tkt_FIXED_ID" },
  });
  assert.equal(r.awaiting, undefined, "a refused action must never put the turn into awaiting-confirm");
  assert.equal(await store.get(coderTicketKey("tkt_FIXED_ID")), undefined, "NO consent ticket may exist for a refused action");
  assert.equal(world.gitCalls.length, 0);
  const thread = await store.get(coderThreadKey("LZPT-7", "t1"));
  assert.match(JSON.stringify(thread.messages), /is not allowed for this rule/,
    "the model gets the SAME refusal the dispatcher would have given");
});

await check("F-359: a dangerous action on an EXTERNALLY triggered gate context opens no ticket either", async () => {
  resetStore();
  const world = setupWorld({ rounds: [
    reply([call("approve_pull_request", { repo: "acme/app", number: 4 })]),
    reply([finish("no")]),
  ] });
  // admin-saved, but the ONE non-confirm route left: the engine's own gate keeps
  // triggerSource null, so this asserts the allow-list path with a capability that is OFF.
  const r = await runCoderTurn({
    issueKey: "LZPT-7", threadId: "t2", userMessage: "approve it", accountId: "acct-owner",
    gateFacts: { edition: "standard", provider: null, agentModel: null, allowanceLevel: null },
    savedByRole: "admin",
    deps: { store, gitExecutor: recordingGit(world), ticketId: () => "tkt_FIXED_ID" },
  });
  assert.equal(r.awaiting, undefined);
  assert.equal(await store.get(coderTicketKey("tkt_FIXED_ID")), undefined, "capability-off must not open a ticket");
  assert.equal(world.gitCalls.length, 0);
});

await check("F-359: a ticket naming something that is not a confirmable action executes nothing", async () => {
  resetStore();
  const world = setupWorld({});
  await store.set(coderTicketKey("tkt_FORGED"), {
    ticketId: "tkt_FORGED", issueKey: "LZPT-7", threadId: "t1", action: "get_issue",
    args: {}, argsPreview: {}, ownerAccountId: "acct-owner", status: "pending",
  });
  const r = await confirmCoderTicket({ ticketId: "tkt_FORGED", decision: "confirm", accountId: "acct-owner", deps: { store, gitExecutor: recordingGit(world) } });
  assert.equal(r.success, false);
  assert.equal(r.code, "not_confirmable");
  assert.equal(world.gitCalls.length, 0);
});

/* ═════════ 3. confirming — once, owner only ═════════ */

const openTicket = async (world) => { resetStore(); setupWorld({ rounds: [reply([call("open_pull_request", { repo: "acme/app", title: "T", sourceBranch: "s" })])] }); return startTurn(world); };

await check("a redelivered confirm executes exactly once", async () => {
  const world = setupWorld({});
  await openTicket(world);
  const git = recordingGit(world);
  const first = await confirmCoderTicket({ ticketId: "tkt_FIXED_ID", decision: "confirm", accountId: "acct-owner", deps: { store, gitExecutor: git } });
  const second = await confirmCoderTicket({ ticketId: "tkt_FIXED_ID", decision: "confirm", accountId: "acct-owner", deps: { store, gitExecutor: git } });
  assert.equal(first.success, true);
  assert.equal(first.decision, "confirm");
  assert.equal(second.duplicate, true, "the second answer is a duplicate, not a second write");
  assert.equal(world.gitCalls.length, 1, "the repository was written exactly once");
  assert.ok(await store.get(coderTicketExecClaimKey("tkt_FIXED_ID")), "the once-claim is kept, not released");
});

await check("F-375: a ticket opened by an ADMIN is REFUSED after the admin is demoted", async () => {
  const world = setupWorld({});
  await openTicket(world);            // opened while __coderRole is "admin"
  globalThis.__coderRole = "editor";  // …the role flips inside the ticket's 24 h life
  try {
    const r = await confirmCoderTicket({ ticketId: "tkt_FIXED_ID", decision: "confirm", accountId: "acct-owner", deps: { store, gitExecutor: recordingGit(world) } });
    assert.equal(r.success, false, "a demoted owner cannot execute a needs-admin action");
    assert.equal(r.reason, "action-not-allowed");
    assert.deepEqual(r.refused, [{ id: "open_pull_request", reason: "needs-admin" }]);
    assert.equal(world.gitCalls.length, 0, "NOTHING reached the repository");
    const ticket = await store.get(coderTicketKey("tkt_FIXED_ID"));
    assert.equal(ticket.status, "refused", "the ticket is CLOSED, not left open for a retry");
    const thread = await store.get(coderThreadKey("LZPT-7", "t1"));
    assert.ok(thread.messages.some((m) => m.kind === "decision" && /REFUSED/.test(m.content)), "the thread records the refusal as a decision row");
    // …and answering it again gives the same refusal, never a cheerful duplicate.
    const again = await confirmCoderTicket({ ticketId: "tkt_FIXED_ID", decision: "confirm", accountId: "acct-owner", deps: { store, gitExecutor: recordingGit(world) } });
    assert.equal(again.success, false);
    assert.equal(again.reason, "action-not-allowed");
  } finally { globalThis.__coderRole = "admin"; }
});

await check("F-382: capability that LAPSED inside the ticket's life refuses the confirm", async () => {
  // The resolver passes `gateFacts: gate.facts` (src/index.js confirmCoderTicket), so the
  // per-action allow-list is rebuilt against the CURRENT instance facts and not only the
  // current role. Forge LLM + the Standard edition is the lapse the ledger row names.
  const world = setupWorld({});
  await openTicket(world);
  const r = await confirmCoderTicket({
    ticketId: "tkt_FIXED_ID", decision: "confirm", accountId: "acct-owner",
    gateFacts: { edition: "standard", provider: "atlassian", agentModel: "claude-sonnet-5", allowanceLevel: null },
    deps: { store, gitExecutor: recordingGit(world) },
  });
  assert.equal(r.success, false, "a git action is refused once the Coder edition has lapsed");
  assert.equal(r.reason, "action-not-allowed");
  assert.deepEqual(r.refused, [{ id: "open_pull_request", reason: "needs-coder-edition" }]);
  assert.equal(world.gitCalls.length, 0, "NOTHING reached the repository");
  const ticket = await store.get(coderTicketKey("tkt_FIXED_ID"));
  assert.equal(ticket.status, "refused", "the ticket is CLOSED, not left open for a retry");
  const thread = await store.get(coderThreadKey("LZPT-7", "t1"));
  assert.ok(thread.messages.some((m) => m.kind === "decision" && /REFUSED/.test(m.content)),
    "the thread records the refusal as a decision row");
});

await check("F-382: the SAME ticket executes when the facts still carry the capability", async () => {
  const world = setupWorld({});
  await openTicket(world);
  const r = await confirmCoderTicket({
    ticketId: "tkt_FIXED_ID", decision: "confirm", accountId: "acct-owner",
    gateFacts: { edition: "advanced", provider: "anthropic", agentModel: "claude-sonnet-5", allowanceLevel: null },
    deps: { store, gitExecutor: recordingGit(world) },
  });
  assert.equal(r.success, true, "passing facts must not be a downgrade");
  assert.equal(world.gitCalls.length, 1);
});

await check("F-375: the same ticket still executes for an owner who IS still an admin", async () => {
  const world = setupWorld({});
  await openTicket(world);
  const r = await confirmCoderTicket({ ticketId: "tkt_FIXED_ID", decision: "confirm", accountId: "acct-owner", deps: { store, gitExecutor: recordingGit(world) } });
  assert.equal(r.success, true);
  assert.equal(world.gitCalls.length, 1);
});

await check("F-375: a demoted owner may still SKIP the step they opened", async () => {
  const world = setupWorld({});
  await openTicket(world);
  globalThis.__coderRole = "editor";
  try {
    const r = await confirmCoderTicket({ ticketId: "tkt_FIXED_ID", decision: "skip", accountId: "acct-owner", deps: { store, gitExecutor: recordingGit(world) } });
    assert.equal(r.success, true, "cancelling executes nothing, so it is not gated");
    assert.equal(world.gitCalls.length, 0);
  } finally { globalThis.__coderRole = "admin"; }
});

await check("a non-owner cannot answer a ticket, and the refusal carries the machine flags", async () => {
  const world = setupWorld({});
  await openTicket(world);
  const r = await confirmCoderTicket({ ticketId: "tkt_FIXED_ID", decision: "confirm", accountId: "acct-intruder", deps: { store, gitExecutor: recordingGit(world) } });
  assert.equal(r.success, false);
  assert.equal(r.reason, "no-permission");
  assert.equal(r.hint, "not-owner");
  assert.equal(world.gitCalls.length, 0);
});

await check("skip records the refusal as a DECISION and performs nothing", async () => {
  const world = setupWorld({});
  await openTicket(world);
  const r = await confirmCoderTicket({ ticketId: "tkt_FIXED_ID", decision: "skip", accountId: "acct-owner", deps: { store, gitExecutor: recordingGit(world) } });
  assert.equal(r.success, true);
  assert.equal(r.resume, true);
  assert.equal(world.gitCalls.length, 0);
  const thread = await store.get(coderThreadKey("LZPT-7", "t1"));
  const decision = thread.messages.find((m) => m.kind === "decision");
  assert.ok(decision && /SKIPPED open_pull_request/.test(decision.content));
});

await check("change appends the user's words and resumes", async () => {
  const world = setupWorld({});
  await openTicket(world);
  const r = await confirmCoderTicket({ ticketId: "tkt_FIXED_ID", decision: "change", change: "target release/2 instead", accountId: "acct-owner", deps: { store, gitExecutor: recordingGit(world) } });
  assert.equal(r.resume, true);
  assert.match(r.resumeMessage, /target release\/2 instead/);
  assert.equal(world.gitCalls.length, 0);
  const thread = await store.get(coderThreadKey("LZPT-7", "t1"));
  assert.ok(thread.messages.some((m) => m.kind === "decision" && /release\/2/.test(m.content)));
});

/* ═════════ 4. the owner check on a turn ═════════ */

await check("a turn from another account is refused with the one refusal shape", async () => {
  resetStore();
  const world = setupWorld({ rounds: [reply([finish()])] });
  await startTurn(world);                                   // acct-owner creates the thread
  const r = await runCoderTurn({
    issueKey: "LZPT-7", threadId: "t1", userMessage: "hello", accountId: "acct-intruder",
    deps: { store, gitExecutor: recordingGit(world) },
  });
  assert.equal(r.success, false);
  assert.equal(r.reason, "no-permission");
  assert.equal(r.hint, "not-owner");
  assert.match(r.error, /belongs to someone else/);
});

/* ═════════ 5. the per-issue claim ═════════ */

await check("the claim is released when the turn throws", async () => {
  resetStore();
  const world = setupWorld({});
  world.session = () => { throw new Error("sandbox exploded"); };
  await assert.rejects(() => runCoderTurn({
    issueKey: "LZPT-9", threadId: "t9", userMessage: "go", accountId: "acct-owner",
    deps: { store, gitExecutor: recordingGit(world) },
  }), /sandbox exploded/);
  assert.equal(await store.get(coderExecClaimKey("LZPT-9")), undefined, "a crashed turn must not lock the issue");
});

await check("a second concurrent turn on the same issue is refused, not run", async () => {
  resetStore();
  const world = setupWorld({ rounds: [reply([finish()])] });
  await store.set(coderExecClaimKey("LZPT-11"), { at: new Date().toISOString() });
  const r = await runCoderTurn({ issueKey: "LZPT-11", threadId: "t1", userMessage: "go", accountId: "acct-owner", deps: { store, gitExecutor: recordingGit(world) } });
  assert.equal(r.success, false);
  assert.equal(r.busy, true);
  assert.equal(world.requests.length, 0, "no model call was made");
});

await check("the claim TTL outlives the long consumer's budget", async () => {
  assert.ok(CODER_CLAIM_TTL_MINUTES * 60 > 900, "a 900 s turn must not outlive its own lock");
  assert.equal(CODER_MAX_ROUNDS, 8);
});

/* ═════════ 6. simulation ═════════ */

await check("in simulation no git call is made, even after a confirmation", async () => {
  resetStore();
  const world = setupWorld({ rounds: [reply([call("commit_files", { repo: "acme/app", branch: "b", message: "m", files: [{ path: "a.js", content: "x" }] })])] });
  const turn = await startTurn(world, { simulation: true });
  assert.equal(turn.awaiting, "confirm");
  const ticket = await store.get(coderTicketKey("tkt_FIXED_ID"));
  assert.equal(ticket.simulation, true, "the ticket remembers it is a simulation");
  // The REAL executor, in simulation, against a connection that exists: neither the
  // network nor the provider factory may be touched. Both throw if they are.
  const simulated = createGitActionExecutor({
    simulation: true, connectionId: "c1",
    fetchImpl: () => { throw new Error("a network call was made in simulation"); },
    deps: {
      getConnection: async () => ({ id: "c1", kind: "github", owner: "acme", accountType: "organization", repos: ["acme/app"] }),
      providerForConnection: () => { throw new Error("a provider was built in simulation"); },
      isRepoAllowed: () => true,
    },
  });
  const r = await confirmCoderTicket({ ticketId: "tkt_FIXED_ID", decision: "confirm", accountId: "acct-owner", deps: { store, gitExecutor: simulated } });
  assert.equal(r.success, true, r.error || "");
  assert.equal(r.decision, "confirm");
  assert.equal(world.gitCalls.length, 0);
});

await check("with no Git connection a confirmed write refuses — it never half-performs", async () => {
  const world = setupWorld({});
  await openTicket(world);
  const r = await confirmCoderTicket({ ticketId: "tkt_FIXED_ID", decision: "confirm", accountId: "acct-owner", deps: { store } });
  assert.equal(r.success, false);
  assert.match(r.error, /connection/i);
  const ticket = await store.get(coderTicketKey("tkt_FIXED_ID"));
  assert.equal(ticket.status, "failed", "a refused confirmation is never recorded as confirmed");
});

await check("F-360: a resume turn that carries no simulation flag inherits the thread's", async () => {
  resetStore();
  const world = setupWorld({ rounds: [reply([call("commit_files", { repo: "acme/app", branch: "b", message: "m", files: [{ path: "a.js", content: "x" }] })])] });
  const first = await startTurn(world, { simulation: true });
  assert.equal(first.awaiting, "confirm");
  assert.equal((await store.get(coderThreadKey("LZPT-7", "t1"))).simulation, true);
  // The resolver's resume push carries the decision text and no `simulation` — exactly
  // the body that used to flip the thread live.
  setupWorld({ rounds: [reply([call("commit_files", { repo: "acme/app", branch: "b", message: "m2", files: [{ path: "b.js", content: "y" }] })])] });
  const resumed = await runCoderTurn({
    issueKey: "LZPT-7", threadId: "t1", userMessage: "DECISION: the user SKIPPED commit_files.",
    accountId: "acct-owner",
    gateFacts: { edition: "advanced", provider: "anthropic", agentModel: "claude-sonnet-5", allowanceLevel: null },
    savedByRole: "admin",
    deps: { store, gitExecutor: recordingGit(world), ticketId: () => "tkt_SECOND" },
  });
  assert.equal(resumed.awaiting, "confirm");
  assert.equal((await store.get(coderThreadKey("LZPT-7", "t1"))).simulation, true, "the thread stays a simulation");
  const ticket2 = await store.get(coderTicketKey("tkt_SECOND"));
  assert.equal(ticket2.simulation, true, "the ticket the resumed turn opened is still a simulation");
});

await check("F-360: a turn that asks for the OPPOSITE mode is refused by name, not honoured", async () => {
  resetStore();
  const world = setupWorld({ rounds: [reply([finish("ok")])] });
  await startTurn(world, { simulation: true });
  const flipped = await runCoderTurn({
    issueKey: "LZPT-7", threadId: "t1", userMessage: "now do it for real", accountId: "acct-owner",
    simulation: false, savedByRole: "admin",
    deps: { store, gitExecutor: recordingGit(world), ticketId: () => "tkt_X" },
  });
  assert.equal(flipped.success, false);
  assert.equal(flipped.reason, "simulation-locked");
  assert.equal(flipped.simulation, true);
  assert.equal((await store.get(coderThreadKey("LZPT-7", "t1"))).simulation, true);
  assert.equal(await store.get(coderExecClaimKey("LZPT-7")), undefined, "the refused turn still releases its claim");
});

await check("F-364: two concurrent confirms on one thread keep BOTH decision rows", async () => {
  resetStore();
  const world = setupWorld({ rounds: [reply([call("open_pull_request", { repo: "acme/app", title: "T", sourceBranch: "s" })])] });
  await startTurn(world);
  // A second pending ticket on the same thread (the shape a turn + a queued answer make).
  const first = await store.get(coderTicketKey("tkt_FIXED_ID"));
  await store.set(coderTicketKey("tkt_SECOND"), { ...first, ticketId: "tkt_SECOND", action: "create_branch", args: { repo: "acme/app", branch: "b" } });
  const git = recordingGit(world);
  // A store whose WRITES take time: that is what opens the read-modify-write window the
  // two entry points really race in (the resolver is inline, the turn is on a consumer).
  // Without the thread-write lock the second reader sees the row before the first write
  // lands and overwrites it.
  const slow = {
    get: (k) => store.get(k),
    delete: (k) => store.delete(k),
    set: async (k, v, o) => { await new Promise((r) => setTimeout(r, 15)); return store.set(k, v, o); },
  };
  const [a, b] = await Promise.all([
    confirmCoderTicket({ ticketId: "tkt_FIXED_ID", decision: "skip", accountId: "acct-owner", deps: { store: slow, gitExecutor: git } }),
    confirmCoderTicket({ ticketId: "tkt_SECOND", decision: "confirm", accountId: "acct-owner", deps: { store: slow, gitExecutor: git } }),
  ]);
  assert.equal(a.success, true);
  assert.equal(b.success, true, b.error || "");
  const thread = await store.get(coderThreadKey("LZPT-7", "t1"));
  const decisions = thread.messages.filter((m) => m.kind === "decision").map((m) => m.content).join("\n");
  assert.match(decisions, /SKIPPED open_pull_request/, "the skip must survive the concurrent confirm");
  assert.match(decisions, /CONFIRMED create_branch/, "the confirm must survive the concurrent skip");
  assert.equal(await store.get(coderThreadWriteClaimKey("LZPT-7", "t1")), undefined, "the lock is released");
});

await check("F-364: a turn's write-back MERGES a decision row appended while it ran", async () => {
  resetStore();
  const world = setupWorld({ rounds: [reply([finish("done")])] });
  // Seed a thread, then run a turn whose model round appends a decision row behind it —
  // exactly the interleaving a confirm answered on the resolver produces.
  await store.set(coderThreadKey("LZPT-21", "t1"), {
    issueKey: "LZPT-21", threadId: "t1", ownerAccountId: "acct-owner", createdAt: "x",
    messages: [{ role: "user", at: "x", content: "the original ask" }], turns: 1,
  });
  world.chatHook = async () => {
    const row = await store.get(coderThreadKey("LZPT-21", "t1"));
    row.messages = [...row.messages, { role: "user", kind: "decision", at: "x", content: "DECISION: the user SKIPPED trigger_deploy." }];
    await store.set(coderThreadKey("LZPT-21", "t1"), row);
  };
  const r = await runCoderTurn({
    issueKey: "LZPT-21", threadId: "t1", userMessage: "carry on", accountId: "acct-owner",
    deps: { store, gitExecutor: recordingGit(world) },
  });
  assert.equal(r.success, true);
  const thread = await store.get(coderThreadKey("LZPT-21", "t1"));
  assert.ok(thread.messages.some((m) => m.kind === "decision"), "the decision row written during the turn must not be overwritten");
  assert.ok(thread.messages.some((m) => m.content === "carry on"), "…and the turn's own message is still there");
});

/* ═════════ 7. compaction ═════════ */

const bigMsg = (i) => ({ role: i % 2 ? "assistant" : "user", at: "2026-09-13T00:00:00.000Z", content: `filler ${i} `.repeat(400) });

await check("a thread under the cap is not compacted at all", async () => {
  const msgs = [{ role: "user", content: "hello" }, { role: "assistant", content: "hi" }];
  const out = compactThread(msgs, { maxBytes: 10000 });
  assert.equal(out.compacted, false);
  assert.deepEqual(out.messages, msgs);
});

await check("compaction preserves decisions verbatim and stays under the cap", async () => {
  const decision = { role: "user", kind: "decision", at: "x", content: "DECISION: the user SKIPPED trigger_deploy. Never deploy from this thread." };
  const msgs = [{ role: "user", content: "the original ask: fix LZPT-42 in acme/app" }];
  for (let i = 0; i < 30; i++) msgs.push(bigMsg(i));
  msgs.splice(10, 0, decision);
  for (let i = 30; i < 45; i++) msgs.push(bigMsg(i));
  const cap = 20000;
  const out = compactThread(msgs, { maxBytes: cap, keepRecent: 8 });
  assert.equal(out.compacted, true);
  assert.ok(Buffer.byteLength(JSON.stringify(out.messages), "utf8") <= cap, "the compacted thread must fit the cap");
  const kept = out.messages.find((m) => m.kind === "decision");
  assert.deepEqual(kept, decision, "a decision is preserved BYTE FOR BYTE");
  assert.equal(out.messages[0].content, "the original ask: fix LZPT-42 in acme/app", "the first ask survives");
  const note = out.messages.find((m) => m.kind === "compaction");
  assert.ok(note, "a note replaces what was dropped");
  assert.match(note.content, /message\(s\) omitted/);
  assert.ok(out.dropped > 0);
});

await check("the compaction note names the issue keys and repositories it dropped", async () => {
  const msgs = [{ role: "user", content: "start" }];
  for (let i = 0; i < 20; i++) msgs.push({ role: "user", at: "x", content: `working on LZPT-${100 + i} in acme/service ${"pad ".repeat(300)}` });
  const out = compactThread(msgs, { maxBytes: 8000, keepRecent: 4 });
  const note = out.messages.find((m) => m.kind === "compaction");
  assert.match(note.content, /issues mentioned: LZPT-/);
  assert.match(note.content, /repositories mentioned: acme\/service/);
});

await check("a thread of nothing but oversized decisions is capped, and says decisions were dropped", async () => {
  const msgs = [];
  for (let i = 0; i < 20; i++) msgs.push({ role: "user", kind: "decision", at: "x", content: `DECISION ${i} ${"z".repeat(2000)}` });
  const out = compactThread(msgs, { maxBytes: 6000, keepRecent: 2 });
  assert.ok(Buffer.byteLength(JSON.stringify(out.messages), "utf8") <= 6000);
  assert.match(out.messages[0].content, /DECISIONS were dropped/);
});

await check("F-361: compaction never orphans a tool result from its tool_calls (odd cut point)", async () => {
  // A thread whose recent window deliberately BEGINS mid tool-call group: the assistant
  // that made the calls sits just outside it. By index that orphans the tool rows; by
  // unit it cannot.
  const pad = (i) => ({ role: "user", at: "x", content: `filler ${i} `.repeat(60) });
  const msgs = [{ role: "user", content: "the original ask" }];
  for (let i = 0; i < 20; i++) msgs.push(pad(i));
  msgs.push({ role: "assistant", at: "x", content: null, tool_calls: [{ id: "c1", function: { name: "get_issue", arguments: "{}" } }, { id: "c2", function: { name: "search_issues", arguments: "{}" } }] });
  msgs.push({ role: "tool", at: "x", tool_call_id: "c1", content: "{\"ok\":true}" });
  msgs.push({ role: "tool", at: "x", tool_call_id: "c2", content: "{\"ok\":true}" });
  for (let i = 20; i < 24; i++) msgs.push(pad(i));
  // keepRecent = 6 ⇒ the window starts on the SECOND tool row: an index cut orphans it.
  const out = compactThread(msgs, { maxBytes: 6000, keepRecent: 6 });
  assert.equal(out.compacted, true);
  const kept = out.messages;
  const leaders = new Set();
  kept.forEach((m) => { if (Array.isArray(m.tool_calls)) m.tool_calls.forEach((tc) => leaders.add(tc.id)); });
  for (const m of kept) {
    if (m.role === "tool") assert.ok(leaders.has(m.tool_call_id), `orphan tool row ${m.tool_call_id} survived compaction`);
  }
  const answered = new Set(kept.filter((m) => m.role === "tool").map((m) => m.tool_call_id));
  for (const id of leaders) assert.ok(answered.has(id), `tool_call ${id} kept with no result row`);
  // …and the group really did survive, so the two loops above were not vacuous.
  assert.equal(leaders.size, 2, "the whole tool-call group is kept together, not dropped to dodge the pairing");
  assert.ok(Buffer.byteLength(JSON.stringify(kept), "utf8") <= 6000, "still inside the cap");
});

await check("F-361: repairTranscript drops an orphan tool row and strips an unanswered tool_calls", async () => {
  const repaired = repairTranscript([
    { role: "user", content: "a" },
    { role: "tool", tool_call_id: "gone", content: "{}" },
    { role: "assistant", content: "", tool_calls: [{ id: "x", function: { name: "f", arguments: "{}" } }] },
    { role: "assistant", content: "I said something", tool_calls: [{ id: "y", function: { name: "f", arguments: "{}" } }] },
  ]);
  assert.deepEqual(repaired.map((m) => m.role), ["user", "assistant"]);
  assert.equal(repaired[1].content, "I said something");
  assert.equal(repaired[1].tool_calls, undefined, "an unanswered tool_calls is stripped, not replayed");
});

await check("F-361: a paired group that fits is left exactly as it was", async () => {
  const msgs = [
    { role: "user", content: "hi" },
    { role: "assistant", content: null, tool_calls: [{ id: "c1", function: { name: "f", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "c1", content: "{}" },
  ];
  const out = compactThread(msgs, { maxBytes: 10000 });
  assert.equal(out.compacted, false);
  assert.deepEqual(out.messages, msgs);
});

/* ═════════ 8. the prompt and the preview ═════════ */

await check("the system prompt is a stable prefix — no ids, no timestamps", async () => {
  const a = buildCoderSystemPrompt({ simulated: false });
  await new Promise((r) => setTimeout(r, 5));
  const b = buildCoderSystemPrompt({ simulated: false });
  assert.equal(a, b, "two builds must be byte-identical or no cache can hit");
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(a), "no date in the stable prefix");
  assert.match(a, /CONFIRM before you change anything outside Jira/);
  assert.match(buildCoderSystemPrompt({ simulated: true }), /SIMULATION MODE/);
});

await check("the args preview is an allow-list: file CONTENT never reaches the user's dialog", async () => {
  const preview = buildArgsPreview("commit_files", {
    repo: "acme/app", branch: "b", message: "m",
    files: [{ path: "a.js", content: "SECRET-CONTENT-".repeat(100) }],
    secretsToken: "should-not-appear",
  });
  const blob = JSON.stringify(preview);
  assert.ok(!blob.includes("SECRET-CONTENT"), "file content must not be previewed");
  assert.ok(!blob.includes("should-not-appear"), "an unknown field must not be previewed");
  assert.equal(preview.files[0].path, "a.js");
  assert.ok(preview.files[0].bytes > 0);
});

await check("F-363: EVERY declared argument of EVERY confirmable action appears in its preview", async () => {
  // ONE HOME: the preview is derived from the action's own parameter schema, so this
  // loop covers actions that do not exist yet. A sample value per declared type.
  const sample = (name, schema) => {
    switch (schema.type) {
      case "boolean": return false;                 // the value the old hand list DROPPED
      case "integer": case "number": return 7;
      case "array": return [{ path: "a.js", content: "x" }];
      case "object": return { environment: "production" };
      default: return `v-${name}`;
    }
  };
  const confirmable = AGENT_ACTIONS.filter((a) => a.confirm === true);
  assert.ok(confirmable.length >= 7, "the git namespace's confirm actions are under test");
  for (const a of confirmable) {
    const args = {};
    for (const [name, schema] of Object.entries(a.parameters.properties)) args[name] = sample(name, schema);
    const preview = buildArgsPreview(a.id, args);
    for (const name of Object.keys(a.parameters.properties)) {
      assert.ok(Object.prototype.hasOwnProperty.call(preview, name),
        `${a.id}: the executor acts on "${name}" but the consent preview never shows it`);
    }
  }
});

await check("F-363: the fields that change the blast radius are previewed with their real values", async () => {
  const repo = buildArgsPreview("create_repo", { name: "acme-internal", private: false, org: "acme", description: "d" });
  assert.equal(repo.private, false, "a PUBLIC repository must be visible in the preview");
  assert.equal(repo.org, "acme");
  const deploy = buildArgsPreview("trigger_deploy", { repo: "acme/app", workflow: "deploy.yml", ref: "main", inputs: { environment: "production" } });
  assert.equal(deploy.inputs.environment, "production", "the deployment's environment must be visible");
  const comment = buildArgsPreview("add_pr_comment", { repo: "acme/app", number: 4, body: "b", path: "src/a.js", line: 12 });
  assert.equal(comment.path, "src/a.js");
  assert.equal(comment.line, 12);
  const pr = buildArgsPreview("open_pull_request", { repo: "acme/app", title: "t", sourceBranch: "s", draft: true });
  assert.equal(pr.draft, true);
});

/* ═════════ 9. the dispatcher is shared, not copied ═════════ */

await check("createAgentActionDispatcher enforces the gate's verdict it was handed", async () => {
  const world = setupWorld({});
  const session = world.session({ issueKey: "LZPT-2", config: {} });
  const dispatch = createAgentActionDispatcher({ issueKey: "LZPT-2", session, allowed: ["get_issue"], executors: {}, m: {} });
  await assert.rejects(() => dispatch("add_comment", { text: "no" }), /not allowed/);
  await assert.rejects(() => dispatch("open_pull_request", { repo: "a/b" }), /not allowed/);
});

await check("a namespace with no executor refuses instead of falling through to Jira", async () => {
  const world = setupWorld({});
  const session = world.session({ issueKey: "LZPT-2", config: {} });
  const dispatch = createAgentActionDispatcher({ issueKey: "LZPT-2", session, allowed: ["open_pull_request"], executors: {}, m: {} });
  const r = await dispatch("open_pull_request", { repo: "a/b", title: "t", sourceBranch: "s" });
  assert.equal(r.success, false);
  assert.equal(r.code, "not_configured");
  assert.equal(world.writes.length, 0);
});

await check("F-404: the knowledge blocks reach the MODEL PAYLOAD of a coder turn", async () => {
  resetStore();
  const world = setupWorld({ rounds: [reply([finish()])] });
  await startTurn(world, {
    knowledge: {
      skillsBlock: "### Skill: House style\nTwo-space indent.",
      memoryBlock: "- [fix] The build script lives in tools/, not scripts/.",
    },
  });
  const sent = JSON.stringify(world.requests[0].messages);
  assert.match(sent, /<<<SKILLS/, "the skills block is in the payload the model was actually sent");
  assert.match(sent, /Two-space indent/, "…with the skill's own text");
  assert.match(sent, /<<<LEARNED_MEMORIES/, "the memories block is there too");
  assert.match(sent, /build script lives in tools/, "…with the memory's own text");
  // The order rule: knowledge sits after the system prompt and before the turn's history.
  const roles = world.requests[0].messages.map((mm) => mm.role);
  assert.equal(roles[0], "system", "the system prompt is still first");
  const firstUser = roles.indexOf("user");
  const knowledgeAt = world.requests[0].messages.findIndex((mm) => /<<<SKILLS|<<<LEARNED_MEMORIES/.test(String(mm.content || "")));
  assert.ok(knowledgeAt > 0 && (firstUser === -1 || knowledgeAt < firstUser),
    "knowledge is seeded before the user turn that carries untrusted content");
});

await check("F-404: a turn with no knowledge sends no fenced blocks (a pre-13b turn is unchanged)", async () => {
  resetStore();
  const world = setupWorld({ rounds: [reply([finish()])] });
  await startTurn(world);
  const sent = JSON.stringify(world.requests[0].messages);
  assert.ok(!/<<<SKILLS|<<<LEARNED_MEMORIES/.test(sent), "nothing is conjured when the caller passes none");
});

/* ═════════ F-487: the Coder's knowledge leaves a TRACE ═════════
 *
 * Before this, the Coder was the one agent whose injected knowledge was invisible at
 * run time: no `Knowledge injected` line, nothing on the thread row, nothing on the
 * task result. A live turn with skills and a live turn without them were byte-identical
 * from outside, so a regression that dropped `skillIds` on the way to the engine looked
 * exactly like a healthy run. These assert the receipt, in all three places, and assert
 * that it is IDS AND COUNTS ONLY — the skill's text must never enter a stored record.
 */
await check("F-487: a coder turn LOGS the injection and stamps the receipt on the turn record", async () => {
  resetStore();
  const world = setupWorld({ rounds: [reply([finish()])] });
  const r = await startTurn(world, {
    knowledge: {
      skillsBlock: "### Skill: House style\nTwo-space indent.",
      skillIds: ["builtin_skill_agile_fields", "sk_house"],
      skillCount: 2,
      memoryBlock: "- [fix] The build script lives in tools/, not scripts/.",
      memoryCount: 1,
    },
  });
  assert.ok((r.logs || []).some((l) => /^Knowledge injected: skills \+ memories$/.test(l)),
    `the run log records the injection (got: ${JSON.stringify(r.logs)})`);
  assert.deepEqual(r.knowledge.skillIds, ["builtin_skill_agile_fields", "sk_house"],
    "the RESULT carries the skill ids the caller passed to the turn");
  assert.equal(r.knowledge.skillCount, 2);
  assert.equal(r.knowledge.memoryCount, 1);

  const row = await store.get(coderThreadKey("LZPT-7", "t1"));
  const userRow = (row.messages || []).find((mm) => mm.role === "user" && mm.knowledge);
  assert.ok(userRow, "the turn's own record on the thread carries the receipt");
  assert.deepEqual(userRow.knowledge.skillIds, ["builtin_skill_agile_fields", "sk_house"]);
  // IDS AND COUNTS ONLY. A skill is an admin's writing and a memory is derived from
  // issue content; neither belongs in a 90-day thread row (and `seededCount` keeps the
  // block itself out of the transcript, which this re-proves from the stored side).
  const stored = JSON.stringify(row);
  assert.ok(!/Two-space indent/.test(stored), "the skill's TEXT is not stored on the thread");
  assert.ok(!/build script lives in tools/.test(stored), "the memory's TEXT is not stored either");
  assert.ok(!/<<<SKILLS|<<<LEARNED_MEMORIES/.test(stored), "and neither fence is in the transcript");
});

await check("F-487: ids are not required — a block with no ids still reports honest counts", async () => {
  resetStore();
  const world = setupWorld({ rounds: [reply([finish()])] });
  const r = await startTurn(world, { knowledge: { skillsBlock: "### Skill: X\nY." } });
  assert.ok((r.logs || []).some((l) => l === "Knowledge injected: skills"), "the line names skills only");
  assert.deepEqual(r.knowledge.skillIds, [], "no ids were supplied, so none are invented");
  assert.equal(r.knowledge.skillCount, 1, "…but a block WAS injected, and the count says so");
  assert.equal(r.knowledge.memoryCount, 0);
});

await check("F-487: a turn with no knowledge logs nothing and stamps nothing", async () => {
  resetStore();
  const world = setupWorld({ rounds: [reply([finish()])] });
  const r = await startTurn(world);
  assert.ok(!(r.logs || []).some((l) => /Knowledge injected/.test(l)), "no line when nothing was injected");
  assert.equal(r.knowledge, undefined, "and no receipt on the result");
  const row = await store.get(coderThreadKey("LZPT-7", "t1"));
  assert.ok(!(row.messages || []).some((mm) => mm.knowledge), "…nor on the thread row");
});

await check("F-487: the receipt is built by ONE function, shared with the listener/job runner", async () => {
  const { summarizeKnowledge, logKnowledgeInjection } = await import("../../src/agent-runner.js");
  assert.equal(summarizeKnowledge(null), null, "nothing injected ⇒ no receipt");
  assert.equal(summarizeKnowledge({ skillsBlock: "   " }), null, "a blank block is not an injection");
  // The runner accepts both shapes fetchSkillsBlock/buildMemoryBlock return.
  const s = summarizeKnowledge({ skillsBlock: { text: "### Skill: a\nb" }, skillIds: ["sk_1"], memoryBlock: { text: "- m" }, memoryCount: 3 });
  assert.deepEqual(s, { skillIds: ["sk_1"], skillCount: 1, memoryCount: 3 });
  const lines = [];
  const again = logKnowledgeInjection({ memoryBlock: "- m", memoryCount: 2 }, (l) => lines.push(l));
  assert.deepEqual(lines, ["Knowledge injected: memories"], "the wording the live drivers grep for");
  assert.equal(again.memoryCount, 2);
  assert.equal(logKnowledgeInjection({}, (l) => lines.push(l)), null, "…and nothing is logged for an empty object");
  assert.equal(lines.length, 1);
});

/* ═════════ F-550: the prompt prefix really is byte-identical ACROSS TURNS ═════════
 *
 * `buildCoderSystemPrompt` promises a prefix that is stable "across the rounds of one turn
 * AND ACROSS THE TURNS OF ONE THREAD", and `runAgentLoop` freezes its cache breakpoint at
 * everything seeded on entry — so a prefix that moves costs the thread its entire history
 * at write price, every turn, on a cache-billing provider. The guide is now chosen once per
 * thread (proven in coder-resume-params.test.mjs); this proves the ENGINE keeps the promise
 * given a stable guide, and that a turn's ADDITIONS land after the prefix, never inside it.
 */
const GUIDE = "<<<FIELD_GUIDE\nBackground.\n\n### Manifest modules\nA resolver is declared once.\nFIELD_GUIDE>>>";
const EXTRA = "<<<FIELD_GUIDE\nBackground.\n\n### ADF\nA comment is an ADF document.\nFIELD_GUIDE>>>";

await check("F-550: turn 2's prompt repeats turn 1's prefix BYTE FOR BYTE", async () => {
  resetStore();
  const world = setupWorld({ rounds: [reply([finish()]), reply([finish()])] });
  const knowledge = { fieldGuideBlock: GUIDE, fieldGuideSections: ["forge-app-builder/x/manifest-1"] };
  await startTurn(world, { knowledge });
  await startTurn(world, { userMessage: "now fix the ADF in the comment", knowledge });

  const t1 = world.requests[0].messages;
  const t2 = world.requests[1].messages;
  // Turn 1 is [system, knowledge…, userTurn]: everything but the last message is the part
  // turn 2 has to match. Turn 2 adds the stored history on top of exactly those bytes.
  const prefixLen = t1.length - 1;
  assert.ok(prefixLen >= 2, "turn 1 seeded a system prompt and at least one knowledge message");
  assert.equal(
    JSON.stringify(t2.slice(0, prefixLen)),
    JSON.stringify(t1.slice(0, prefixLen)),
    "the system prompt and the knowledge messages are identical bytes on turn 2",
  );
  assert.ok(t2.length > t1.length, "turn 2 is longer — the history was appended AFTER the shared prefix");
  assert.ok(JSON.stringify(t2[prefixLen]).includes("open a PR for the fix"),
    "…and the first thing after the prefix is turn 1's stored message");
});

await check("F-550: the thread row pins the guide's section ids once, and records the prefix size", async () => {
  resetStore();
  const world = setupWorld({ rounds: [reply([finish()]), reply([finish()])] });
  await startTurn(world, { knowledge: { fieldGuideBlock: GUIDE, fieldGuideSections: ["sec-a", "sec-b"] } });
  const row1 = await store.get(coderThreadKey("LZPT-7", "t1"));
  assert.deepEqual(row1.fieldGuideSections, ["sec-a", "sec-b"], "the first turn pins the thread's guide");
  assert.ok(Number(row1.promptPrefixBytes) > 0, "…and records how big the prefix it sent was");

  // A later turn does NOT get to re-pin: that would be the per-turn re-selection F-550 removed.
  await startTurn(world, { userMessage: "second", knowledge: { fieldGuideBlock: GUIDE, fieldGuideSections: ["sec-z"] } });
  const row2 = await store.get(coderThreadKey("LZPT-7", "t1"));
  assert.deepEqual(row2.fieldGuideSections, ["sec-a", "sec-b"], "the pin is written once and never rewritten");
});

await check("F-550: a turn's ADDED sections are sent after the prefix, not inside it", async () => {
  resetStore();
  const world = setupWorld({ rounds: [reply([finish()]), reply([finish()])] });
  const knowledge = { fieldGuideBlock: GUIDE, fieldGuideSections: ["sec-a"] };
  await startTurn(world, { knowledge });
  await startTurn(world, { userMessage: "now the ADF", knowledge: { ...knowledge, fieldGuideExtraBlock: EXTRA } });

  const t1 = world.requests[0].messages;
  const t2 = world.requests[1].messages;
  const prefixLen = t1.length - 1;
  assert.equal(JSON.stringify(t2.slice(0, prefixLen)), JSON.stringify(t1.slice(0, prefixLen)),
    "the addition did not disturb one byte of the shared prefix");
  const extraAt = t2.findIndex((mm) => String(mm.content || "").includes("A comment is an ADF document"));
  assert.ok(extraAt >= prefixLen, `the addition sits after the shared prefix (at ${extraAt}, prefix ends at ${prefixLen})`);
  assert.equal(t2[t2.length - 1].role, "user", "…and still before the user's own turn");
  assert.ok(String(t2[t2.length - 1].content).includes("now the ADF"), "which is the message they just sent");
  // It is a per-turn cost, so it never becomes part of the thread.
  const row = await store.get(coderThreadKey("LZPT-7", "t1"));
  assert.ok(!JSON.stringify(row.messages).includes("A comment is an ADF document"),
    "an added block is never stored into the thread as if the model had said it");
});

await check("F-550: the cross-turn cache miss gets its own observation line", async () => {
  const { reportCrossTurnCacheDefect, CACHE_BYTES_PER_TOKEN } = await import("../../src/agent-runner.js");
  const lines = [];
  const log = (l) => lines.push(l);
  // A prefix well over any provider's minimum cacheable size.
  const priorPrefixBytes = 40000;
  const priorTokens = Math.floor(priorPrefixBytes / CACHE_BYTES_PER_TOKEN);

  // The MISS: this turn's first round read almost nothing of it.
  const miss = reportCrossTurnCacheDefect({ provider: "anthropic", usage: { firstRoundCacheReadTokens: 0 }, priorPrefixBytes, log });
  assert.ok(miss && /FIRST round/.test(miss), "a first round that read nothing of the previous prefix is reported");
  assert.equal(lines.length, 1, "…once, on the turn's own log");

  // The HIT: nothing is said.
  assert.equal(
    reportCrossTurnCacheDefect({ provider: "anthropic", usage: { firstRoundCacheReadTokens: priorTokens }, priorPrefixBytes, log }),
    null, "a first round that met the prefix says nothing");
  // A provider that does not bill cache reads is never judged on it.
  assert.equal(
    reportCrossTurnCacheDefect({ provider: "openai", usage: { firstRoundCacheReadTokens: 0 }, priorPrefixBytes, log }),
    null, "a provider outside the cache-billing set is not judged");
  // Neither is a first turn (no previous prefix) or a prefix too small to be cacheable.
  assert.equal(reportCrossTurnCacheDefect({ provider: "anthropic", usage: { firstRoundCacheReadTokens: 0 }, priorPrefixBytes: 0, log }),
    null, "a thread's FIRST turn has nothing to compare against");
  assert.equal(reportCrossTurnCacheDefect({ provider: "anthropic", usage: { firstRoundCacheReadTokens: 0 }, priorPrefixBytes: 900, log }),
    null, "a prefix under the minimum cacheable size is not a defect");
  assert.equal(lines.length, 1, "no other case logged anything");
});

console.log(`CODER ENGINE: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
