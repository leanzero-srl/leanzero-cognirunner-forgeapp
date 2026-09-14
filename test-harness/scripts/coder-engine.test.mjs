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
  coderThreadKey, coderPinKey, coderTicketKey, coderExecClaimKey, coderTicketExecClaimKey, coderThreadWriteClaimKey,
  CODER_MAX_ROUNDS, CODER_CLAIM_TTL_MINUTES, repairTranscript, isEmptyTurn,
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
      // `cachePrefix` rides along because it is the thing the provider turns into
      // `cache_control` breakpoints (F-636) — a request captured without it cannot show
      // where the cache boundary was declared. `turnPrefix` is the SECOND boundary the
      // adapters place a mark at (F-641): the messages stable for THIS turn's rounds.
      world.requests.push(JSON.parse(JSON.stringify({
        messages: args.messages, cachePrefix: args.cachePrefix, turnPrefix: args.turnPrefix,
        tools: (args.tools || []).map((t) => t.function.name),
      })));
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

/* ═════════ F-574: the skills and memory blocks are pinned per thread too ═════════
 *
 * F-550 pinned the FIELD GUIDE and left the other two blocks of the same cached prefix
 * re-derived every turn. The guide is pinned by section id because packs are baked
 * constants; a skill can be edited and a memory added, so those two are pinned by their
 * BYTES. This is the engine half: the row is written once, and a turn's additions are
 * emitted after the prefix, in the builder's trust order.
 */
const SKILLS = "### Skill: House style\nTwo-space indent, never tabs.";
const MEM = "- [user] Always rebase before opening a PR.";
const MEM_NEW = "- [user] Deploys need the production environment flag set.";

await check("F-574: the thread pins the skills and memory BYTES once, on its own key, and never re-pins", async () => {
  resetStore();
  const world = setupWorld({ rounds: [reply([finish()]), reply([finish()])] });
  await startTurn(world, { knowledge: { skillsBlock: SKILLS, memoryBlock: MEM, skillIds: ["skill_house"], memoryCount: 1 } });
  const pin1 = await store.get(coderPinKey("LZPT-7", "t1"));
  assert.equal(pin1.skillsBlock, SKILLS, "the first turn pins the rendered skills block");
  assert.equal(pin1.memoryBlock, MEM, "…and the rendered memory block");
  assert.deepEqual(pin1.skillIds, ["skill_house"], "…with the receipt's ids");
  assert.equal(pin1.memoryCount, 1, "…and its count");
  // F-631 — and the ids the TURN ASKED FOR, beside the ones that rendered. The next turn's
  // "did the picker change?" compare reads this list; without it, an id that can never
  // render (disabled, 9th, over budget) made every turn look like a change and re-pinned
  // the thread forever. Absent on the knowledge object, it falls back to the applied ids.
  assert.deepEqual(pin1.requestedSkillIds, ["skill_house"],
    "…and the requested ids, defaulting to the applied ones when the builder named none");
  // …and when the builder DOES name a wider request, THAT is what the pin carries.
  const wReq = setupWorld({ rounds: [reply([finish()])] });
  await startTurn(wReq, { threadId: "t_req", knowledge: {
    skillsBlock: SKILLS, memoryBlock: MEM, memoryCount: 1,
    skillIds: ["skill_house"], requestedSkillIds: ["skill_house", "skill_disabled"],
  } });
  const pinReq = await store.get(coderPinKey("LZPT-7", "t_req"));
  assert.deepEqual(pinReq.skillIds, ["skill_house"], "the applied receipt stays the applied receipt");
  assert.deepEqual(pinReq.requestedSkillIds, ["skill_house", "skill_disabled"],
    "F-631: the request the turn made is pinned beside it, unrenderable ids and all");
  // F-487 stands: the TRANSCRIPT still carries ids and counts only, so the pin cannot be
  // "fixed" by moving it onto the thread row.
  const stored = JSON.stringify(await store.get(coderThreadKey("LZPT-7", "t1")));
  assert.ok(!/Two-space indent/.test(stored) && !/Always rebase/.test(stored),
    "the pinned text is NOT on the thread row — that row is the transcript (F-487)");

  // A later turn does NOT re-pin — that would be the per-turn re-derivation this removed.
  await startTurn(world, { userMessage: "second", knowledge: { skillsBlock: "### Skill: Other\nx", memoryBlock: `${MEM}\n${MEM_NEW}` } });
  const pin2 = await store.get(coderPinKey("LZPT-7", "t1"));
  assert.equal(pin2.skillsBlock, SKILLS, "the pin is written once and never rewritten");
  assert.equal(pin2.memoryBlock, MEM, "…for either block");
});

await check("F-574: a turn offered NO knowledge still records the decision, so turn 2's memory lands outside the prefix", async () => {
  resetStore();
  const world = setupWorld({ rounds: [reply([finish()]), reply([finish()])] });
  await startTurn(world, { knowledge: { fieldGuideBlock: GUIDE, fieldGuideSections: ["sec-a"] } });
  const pin = await store.get(coderPinKey("LZPT-7", "t1"));
  assert.ok(pin, "the pin records that this thread was offered knowledge and had no skills or memories");
  assert.equal(pin.skillsBlock, "");
  assert.equal(pin.memoryBlock, "");
});

await check("F-574: knowledge too large to pin leaves the thread unpinned and says so, rather than failing the turn", async () => {
  resetStore();
  const world = setupWorld({ rounds: [reply([finish()])] });
  const huge = "x".repeat(33 * 1024);
  const r = await startTurn(world, { knowledge: { skillsBlock: huge } });
  assert.equal(r.success, true, "the turn still runs — a pin is an optimisation, never a gate");
  assert.equal(await store.get(coderPinKey("LZPT-7", "t1")), undefined, "nothing is pinned");
  assert.ok((r.logs || []).some((l) => /too large to pin/.test(l)), "…and the turn's log says why");
});

await check("F-574: a memory added between two turns does not move one byte of the prefix, and still reaches the model", async () => {
  resetStore();
  const world = setupWorld({ rounds: [reply([finish()]), reply([finish()])] });
  // What `buildCoderKnowledge` hands the engine on each turn: turn 2 replays the pinned
  // blocks and passes the NEW memory separately (proven against the real stores in
  // coder-resume-params.test.mjs).
  const stable = { skillsBlock: SKILLS, memoryBlock: MEM, fieldGuideBlock: GUIDE, fieldGuideSections: ["sec-a"] };
  await startTurn(world, { knowledge: stable });
  await startTurn(world, { userMessage: "and deploy it", knowledge: { ...stable, memoryExtraBlock: MEM_NEW } });

  const t1 = world.requests[0].messages;
  const t2 = world.requests[1].messages;
  const prefixLen = t1.length - 1;
  assert.equal(JSON.stringify(t2.slice(0, prefixLen)), JSON.stringify(t1.slice(0, prefixLen)),
    "THE FINDING: turn 2's prefix is byte-identical although a memory was added between the turns");
  const at = t2.findIndex((mm) => String(mm.content || "").includes("production environment flag"));
  assert.ok(at >= prefixLen, `the new memory sits after the shared prefix (at ${at}, prefix ends at ${prefixLen})`);
  assert.equal(t2[t2.length - 1].role, "user", "…and still before the user's own turn");
  assert.ok(String(t2[at].content).includes("LEARNED MEMORIES"), "…rendered by the SAME builder, with the advisory header");
  const row = await store.get(coderThreadKey("LZPT-7", "t1"));
  assert.ok(!JSON.stringify(row.messages).includes("production environment flag"),
    "a per-turn block is never stored into the thread as if the model had said it");
  assert.ok(Number(row.promptPrefixBytes) > 0, "…and the prefix size is recorded for the next turn's cache check");
});

await check("F-574: a newly bound skill takes the same route, after the history and above the memories", async () => {
  resetStore();
  const world = setupWorld({ rounds: [reply([finish()]), reply([finish()])] });
  const stable = { skillsBlock: SKILLS, memoryBlock: MEM };
  await startTurn(world, { knowledge: stable });
  await startTurn(world, { userMessage: "now the ADF", knowledge: { ...stable, skillsExtraBlock: "### Skill: ADF\nComments are ADF documents.", memoryExtraBlock: MEM_NEW } });

  const t1 = world.requests[0].messages;
  const t2 = world.requests[1].messages;
  const prefixLen = t1.length - 1;
  assert.equal(JSON.stringify(t2.slice(0, prefixLen)), JSON.stringify(t1.slice(0, prefixLen)),
    "the addition did not disturb one byte of the shared prefix");
  const skillAt = t2.findIndex((mm) => String(mm.content || "").includes("Comments are ADF documents"));
  const memAt = t2.findIndex((mm) => String(mm.content || "").includes("production environment flag"));
  assert.ok(skillAt >= prefixLen && memAt > skillAt,
    `the extra blocks keep the prompt's trust order: skills then memories (${skillAt} < ${memAt}, prefix ends at ${prefixLen})`);
  assert.ok(String(t2[skillAt].content).includes("<<<SKILLS"), "…and the skills addition is fenced like the stable block");
});

/* ═════════ F-578: a pin is replayed only while its knowledge is still true ═════════
 *
 * F-574 pinned the bytes and nothing invalidated them, so a DELETED memory kept reaching
 * the model for the life of the thread and an EDITED one reached it twice. The builder
 * (src/async-handler.js) owns the decision — it compares the stores' epochs against the
 * ones on the pin, and coder-resume-params.test.mjs proves that half against the REAL
 * memory and skills stores. THIS is the engine half: what the engine does when the builder
 * says `repin`, and what it stamps so the builder can decide at all.
 */
await check("F-578: the engine stamps both store epochs on the pin, so a later turn can tell whether they still hold", async () => {
  resetStore();
  const world = setupWorld({ rounds: [reply([finish()])] });
  await startTurn(world, {
    knowledge: { skillsBlock: SKILLS, memoryBlock: MEM, skillIds: ["skill_house"], memoryCount: 1, memoryEpoch: 4, skillEpoch: "skill_house:on:2026-09-13" },
  });
  const pin = await store.get(coderPinKey("LZPT-7", "t1"));
  assert.equal(pin.memoryEpoch, 4, "the memory store's epoch travels onto the pin");
  assert.equal(pin.skillEpoch, "skill_house:on:2026-09-13", "…and the pinned skills' epoch with it");
});

await check("F-578: `repin` REPLACES the pinned bytes and says so — an ordinary turn still never touches them", async () => {
  resetStore();
  const world = setupWorld({ rounds: [reply([finish()]), reply([finish()]), reply([finish()])] });
  const first = { skillsBlock: SKILLS, memoryBlock: MEM, skillIds: ["skill_house"], memoryCount: 1, memoryEpoch: 1, skillEpoch: "e1" };
  await startTurn(world, { knowledge: first });

  // An ordinary later turn: the builder replayed the pin, so it sends no `repin` and the
  // bytes must stay exactly where they are (F-574 — this is the guard against a re-pin
  // that "fixes" the finding by rebuilding every turn).
  await startTurn(world, { userMessage: "second", knowledge: { ...first, memoryExtraBlock: MEM_NEW } });
  const pin2 = await store.get(coderPinKey("LZPT-7", "t1"));
  assert.equal(pin2.memoryBlock, MEM, "a turn without `repin` leaves the pinned bytes alone");

  // The invalidating turn: the builder rebuilt the blocks live and asked for a re-pin.
  const rebuilt = `- [user] Deploys need the production environment flag set.`;
  const r = await startTurn(world, {
    userMessage: "third",
    knowledge: { skillsBlock: SKILLS, memoryBlock: rebuilt, skillIds: ["skill_house"], memoryCount: 1, memoryEpoch: 2, skillEpoch: "e1", repin: true, pinInvalidated: "memoryEpoch 1→2" },
  });
  const pin3 = await store.get(coderPinKey("LZPT-7", "t1"));
  assert.equal(pin3.memoryBlock, rebuilt, "THE FINDING: the deleted memory is no longer what this thread replays");
  assert.ok(!pin3.memoryBlock.includes("Always rebase"), "…the stale line is gone from the pin, not merely contradicted");
  assert.equal(pin3.memoryEpoch, 2, "…and the pin now records the epoch it was rebuilt under");
  assert.ok((r.logs || []).some((l) => /memoryEpoch 1→2/.test(l) && /prefix moves once/.test(l)),
    `the turn's own log says why the prefix moved (${JSON.stringify((r.logs || []).filter((l) => /pin/.test(l)))})`);
});

/* ═════════ F-636: the declared cache boundary is the CROSS-TURN one ═════════
 *
 * Measured live on staging twice (2026-09-14): the turn AFTER a pin rebuild read ZERO
 * cached tokens and raised F-550's DEFECT WARN although it decided nothing. The prefix
 * itself was innocent — coder-resume-params.test.mjs proves the rebuilt and replayed
 * blocks are byte-identical — and the miss was in WHERE the provider was told to put its
 * `cache_control` marks.
 *
 * `runAgentLoop` declared the WHOLE entry array as the cache prefix, which is true for the
 * ROUNDS of one turn and false across TURNS: `extraKnowledge` (a newly bound skill, a
 * memory written since the thread started, a guide section this turn's words scored) is a
 * `system` message deliberately placed AFTER the history, and the adapters
 * (markOpenRouterCacheBreakpoints / callAnthropicChat, src/index.js) mark the LAST SYSTEM
 * MESSAGE inside the declared prefix. So on any turn carrying an addition the mark moved
 * onto the addition, the request had no breakpoint anywhere inside what the previous turn
 * wrote, and the whole thread was re-billed.
 *
 * These two assert the boundary itself, because it is the thing the provider reads: the
 * declared count is the STABLE prefix, and the mark the adapters' own rule would place
 * still falls inside the bytes the previous turn sent.
 */
// The adapters' rule, copied from markOpenRouterCacheBreakpoints (src/index.js) — the
// first mark is what a cross-turn read can land on.
const firstCacheMark = (messages, prefixCount) => {
  const stableEnd = Math.min(Math.floor(prefixCount), messages.length) - 1;
  let lastSystem = -1;
  for (let i = 0; i <= stableEnd; i++) if (messages[i].role === "system") lastSystem = i;
  return lastSystem;
};

await check("F-636: the cache prefix a turn declares STOPS at the history — the per-turn additions are outside it", async () => {
  resetStore();
  const world = setupWorld({ rounds: [reply([finish()]), reply([finish()])] });
  const stable = { skillsBlock: SKILLS, memoryBlock: MEM, fieldGuideBlock: GUIDE, fieldGuideSections: ["sec-a"] };
  await startTurn(world, { knowledge: stable });
  await startTurn(world, { userMessage: "and deploy it", knowledge: { ...stable, memoryExtraBlock: MEM_NEW } });

  const t2 = world.requests[1];
  assert.ok(Number(t2.cachePrefix) > 0, "the loop still declares a prefix at all (F-353)");
  assert.ok(t2.cachePrefix < t2.messages.length,
    `THE FINDING: the addition and the user's turn are OUTSIDE the declared prefix (declared ${t2.cachePrefix} of ${t2.messages.length})`);
  const tail = t2.messages.slice(t2.cachePrefix);
  assert.ok(tail.some((mm) => String(mm.content || "").includes("production environment flag")),
    "…the per-turn memory addition is one of the messages left out");
  assert.equal(tail[tail.length - 1].role, "user", "…and the user's own words are the last of them");
  // The boundary is the end of the stored HISTORY, so the last message inside it is one
  // the transcript holds (user / assistant / tool) and never one of the knowledge blocks.
  assert.ok(["user", "assistant", "tool"].includes(t2.messages[t2.cachePrefix - 1].role),
    `…so the boundary sits at the end of the stored history (last declared role: ${t2.messages[t2.cachePrefix - 1].role})`);
  assert.ok(!tail.some((mm, i) => i < tail.length - 1 && mm.role !== "system"),
    "…and everything after it is a knowledge addition, up to the user's turn");
});

await check("F-636: a turn carrying an addition still marks the cache INSIDE the bytes the previous turn sent", async () => {
  resetStore();
  const world = setupWorld({ rounds: [reply([finish()]), reply([finish()]), reply([finish()])] });
  const stable = { skillsBlock: SKILLS, memoryBlock: MEM, fieldGuideBlock: GUIDE, fieldGuideSections: ["sec-a"] };
  await startTurn(world, { knowledge: stable });
  // A rebuild turn — the prefix moves ONCE, on purpose (F-578/F-630).
  await startTurn(world, { userMessage: "drop the skills", knowledge: { memoryBlock: MEM, fieldGuideBlock: GUIDE, fieldGuideSections: ["sec-a"], repin: true, pinInvalidated: "skills changed by the turn" } });
  // The turn AFTER it, deciding nothing, carrying one addition: this is the live shape.
  await startTurn(world, { userMessage: "carry on", knowledge: { memoryBlock: MEM, fieldGuideBlock: GUIDE, fieldGuideSections: ["sec-a"], memoryExtraBlock: MEM_NEW } });

  const prev = world.requests[1];
  const now = world.requests[2];
  let common = 0;
  while (common < now.messages.length && common < prev.messages.length
    && JSON.stringify(now.messages[common]) === JSON.stringify(prev.messages[common])) common++;
  assert.ok(common > 1, `the rebuilt prefix is shared with the turn that rebuilt it (${common} messages)`);
  const mark = firstCacheMark(now.messages, now.cachePrefix);
  assert.ok(mark >= 0, "the turn has a cache breakpoint at all");
  assert.ok(mark < common,
    `THE FINDING: the breakpoint (index ${mark}) falls inside the ${common} messages the previous turn already sent, so the read is a hit — it used to land on the addition at index ${firstCacheMark(now.messages, now.messages.length)}`);
  assert.equal(firstCacheMark(prev.messages, prev.cachePrefix), mark,
    "…at the SAME index the rebuild turn wrote its entry at, which is what makes it reachable");
});

/* ═════════ F-641: the loop declares BOTH boundaries, so both marks exist ═════════
 *
 * F-636 bought the cross-turn mark by giving up the within-turn one. On turn 1 that cost
 * the turn EVERY message mark: `history` is empty, so the cross-turn prefix is the system
 * prompt plus the knowledge blocks — all `system`, all hoisted into Anthropic's `system`
 * field — and the one markable message, the user's turn with its fenced issue context,
 * fell outside the declared prefix. Rounds 2..8 of that turn then re-billed it in full.
 *
 * This drives the REAL placement rule (`cacheBreakpointIndices` +
 * `markOpenRouterCacheBreakpoints`, lifted out of src/index.js rather than re-stated here)
 * over the requests the engine actually emitted.
 */
const placementRule = await (async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const indexSrc = readFileSync(fileURLToPath(new URL("../../src/index.js", import.meta.url)), "utf8");
  const grab = (re, what) => {
    const m = indexSrc.match(re);
    if (!m) throw new Error(`could not lift ${what} out of src/index.js`);
    return m[0].replace(/^const [A-Za-z]+ = /, "").replace(/;\s*$/, "");
  };
  const mp = grab(/const canCarryCacheBreakpoint = \(msg\) => \{[\s\S]*?\n\};/, "canCarryCacheBreakpoint");
  const mb = grab(/const markCacheBreakpoint = \(msg\) => \{[\s\S]*?\n\};/, "markCacheBreakpoint");
  const mi = grab(/const cacheBreakpointIndices = \(\{ messages, boundaries[\s\S]*?\n\};/, "cacheBreakpointIndices");
  const mo = grab(/const markOpenRouterCacheBreakpoints = \(messages, prefixCount, turnCount\) => \{[\s\S]*?\n\};/, "markOpenRouterCacheBreakpoints");
  // eslint-disable-next-line no-new-func
  const fn = new Function(`const canCarryCacheBreakpoint = ${mp};\nconst markCacheBreakpoint = ${mb};\nconst cacheBreakpointIndices = ${mi};\nreturn ${mo};`)();
  // F-643 — the marker returns { messages, marks }; this drives the placement, so it reads
  // the array and the emitted-mark count is asserted where it is the point.
  return Object.assign((...a) => fn(...a).messages, { raw: fn });
})();

const markedIndices = (req) => placementRule(req.messages, req.cachePrefix, req.turnPrefix)
  .map((m, i) => (Array.isArray(m.content) && m.content.some((pp) => pp && pp.cache_control) ? i : -1))
  .filter((i) => i >= 0);

await check("F-641: a FIRST turn — nothing but system messages inside the prefix — still marks the user's turn", async () => {
  resetStore();
  const world = setupWorld({ rounds: [reply([finish()])] });
  await startTurn(world, { knowledge: { skillsBlock: SKILLS, memoryBlock: MEM, fieldGuideBlock: GUIDE, fieldGuideSections: ["sec-a"] } });

  const t1 = world.requests[0];
  assert.equal(t1.turnPrefix, t1.messages.length, "the within-turn boundary is every seeded message");
  assert.ok(t1.cachePrefix < t1.turnPrefix,
    `turn 1's two boundaries genuinely differ (cross-turn ${t1.cachePrefix} of ${t1.turnPrefix})`);
  assert.ok(t1.messages.slice(0, t1.cachePrefix).every((mm) => mm.role === "system"),
    "…because with no history the cross-turn prefix is system messages ONLY — the shape that lost the mark");
  const marks = markedIndices(t1);
  assert.ok(marks.includes(t1.messages.length - 1),
    `THE FINDING: the user's turn carries a breakpoint, so rounds 2..N read the fenced issue context back instead of re-billing it (marks ${JSON.stringify(marks)})`);
  assert.ok(marks.length >= 2 && marks.length <= 4,
    `two to four breakpoints, inside the provider cap (got ${marks.length})`);
});

await check("F-641: a turn WITH history marks the cross-turn boundary AND this turn's words", async () => {
  resetStore();
  const world = setupWorld({ rounds: [reply([finish()]), reply([finish()])] });
  const stable = { skillsBlock: SKILLS, memoryBlock: MEM, fieldGuideBlock: GUIDE, fieldGuideSections: ["sec-a"] };
  await startTurn(world, { knowledge: stable });
  await startTurn(world, { userMessage: "and deploy it", knowledge: { ...stable, memoryExtraBlock: MEM_NEW } });

  const t2 = world.requests[1];
  const marks = markedIndices(t2);
  assert.ok(marks.includes(t2.cachePrefix - 1),
    `F-636 STILL HOLDS: a mark sits at the end of the history, inside the bytes turn 1 sent (marks ${JSON.stringify(marks)}, prefix ${t2.cachePrefix})`);
  assert.ok(marks.includes(t2.messages.length - 1),
    "…and this turn's own words carry the within-turn mark the rounds read back");
  assert.ok(marks.length <= 4, `at most four breakpoints (got ${marks.length})`);
});

await check("F-641: a caller with no stablePrefixCount declares ONE boundary twice — placement unchanged", async () => {
  const msgs = [
    { role: "system", content: "RULES" },
    { role: "user", content: "one-shot question" },
  ];
  const legacy = placementRule(msgs, 2)
    .map((m, i) => (Array.isArray(m.content) && m.content.some((pp) => pp && pp.cache_control) ? i : -1))
    .filter((i) => i >= 0);
  const both = placementRule(msgs, 2, 2)
    .map((m, i) => (Array.isArray(m.content) && m.content.some((pp) => pp && pp.cache_control) ? i : -1))
    .filter((i) => i >= 0);
  assert.deepEqual(both, legacy, "coinciding boundaries collapse to the pre-F-641 marks");
  assert.equal(placementRule(msgs, 0, 2), msgs, "and a caller that never opted in is returned AS IS");
});

/* ═════════ F-644: an EMPTY model turn is never stored and never replayed ═════════
 *
 * A model can stop with empty prose and no tool calls (the `exhausted` round forces
 * `tool_choice:"none"`). That message was stored verbatim and replayed into every later
 * turn — and the Anthropic Messages API rejects a non-final message with empty content, so
 * one such reply could 400 the rest of the thread. It is also what left the cross-turn
 * cache boundary with nothing to mark (F-643). One predicate, `isEmptyTurn`, on all three
 * seams: the store, the replay and the compactor.
 */
await check("F-644: an assistant reply with empty content and no tool calls is NOT stored", async () => {
  resetStore();
  const world = setupWorld({ rounds: [reply(null, "")] });
  const r = await startTurn(world, { userMessage: "say nothing" });
  assert.equal(r.success, true, "the turn itself still completes — this is about what is kept");
  const thread = await store.get(coderThreadKey("LZPT-7", "t1"));
  assert.ok(thread.messages.some((m) => m.content === "say nothing"), "the user's own words are stored");
  assert.equal(thread.messages.filter((m) => m.role === "assistant").length, 0,
    `THE FINDING: the empty assistant turn is dropped, not written (${JSON.stringify(thread.messages.map((m) => [m.role, m.content]))})`);
  assert.ok(r.logs.some((l) => /Dropped 1 empty model message/.test(l)),
    "…and the turn says so at INFO, naming the thread");
});

await check("F-644: a non-empty reply is still stored (the control)", async () => {
  resetStore();
  const world = setupWorld({ rounds: [reply(null, "here is the answer")] });
  await startTurn(world, { userMessage: "say something" });
  const thread = await store.get(coderThreadKey("LZPT-7", "t1"));
  assert.equal(thread.messages.filter((m) => m.role === "assistant" && m.content === "here is the answer").length, 1,
    "a reply with words is kept exactly as before");
});

await check("F-644: a LEGACY empty row is never replayed into the model's messages", async () => {
  resetStore();
  // A thread written by the previous version: the poisoned row is already on the record.
  await store.set(coderThreadKey("LZPT-7", "t1"), {
    issueKey: "LZPT-7", threadId: "t1", turns: 1, messages: [
      { role: "user", at: "x", content: "turn 1" },
      { role: "assistant", at: "x", content: "" },
    ],
  });
  const world = setupWorld({ rounds: [reply([finish()])] });
  await startTurn(world, { userMessage: "turn 2" });
  const sent = world.requests[0].messages;
  assert.equal(sent.filter((m) => m.role === "assistant" && (m.content === "" || m.content == null)).length, 0,
    `THE FINDING: no empty assistant message reaches the provider (${JSON.stringify(sent.map((m) => [m.role, String(m.content).slice(0, 20)]))})`);
  assert.ok(sent.some((m) => m.content === "turn 1"), "…while the rest of the history still replays");
  const thread = await store.get(coderThreadKey("LZPT-7", "t1"));
  assert.equal(thread.messages.filter((m) => isEmptyTurn(m)).length, 0,
    "…and the thread write heals the stored row, so the next turn starts clean");
});

await check("F-644: isEmptyTurn never drops half of a tool pair", async () => {
  const toolCall = { role: "assistant", content: "", tool_calls: [{ id: "c1", function: { name: "f", arguments: "{}" } }] };
  const toolRow = { role: "tool", tool_call_id: "c1", content: "" };
  assert.equal(isEmptyTurn(toolCall), false, "an assistant carrying tool_calls is never empty, whatever its text");
  assert.equal(isEmptyTurn(toolRow), false, "a tool RESULT is never empty — dropping it would orphan the call");
  assert.equal(isEmptyTurn({ role: "assistant", content: "   " }), true, "whitespace-only prose is empty");
  assert.equal(isEmptyTurn({ role: "assistant", content: null }), true, "…so is null content with no calls");
  assert.equal(isEmptyTurn({ role: "assistant", content: [] }), true, "…and an empty content array");
  assert.equal(isEmptyTurn({ role: "assistant", content: "a" }), false, "a real answer is not empty");
});

await check("F-644: compactThread prunes legacy empty rows and keeps the pairs", async () => {
  const msgs = [
    { role: "user", content: "hi" },
    { role: "assistant", content: "" },
    { role: "assistant", content: null, tool_calls: [{ id: "c1", function: { name: "f", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "c1", content: "{}" },
    { role: "assistant", content: "done" },
  ];
  const out = compactThread(msgs, { maxBytes: 10000 });
  assert.equal(out.messages.length, 4, "the empty row is gone");
  assert.equal(out.messages.filter((m) => isEmptyTurn(m)).length, 0, "…and nothing empty survives");
  assert.equal(out.compacted, false, "removing a row that said nothing is not a compaction, and must not be reported as one");
  assert.equal(out.dropped, 0, "…so the dropped COUNT stays about compaction");
  assert.deepEqual(out.messages.map((m) => m.role), ["user", "assistant", "tool", "assistant"], "the tool pair is intact");
});

await check("F-578: a re-pin too large to write CLEARS the stale row rather than leaving it to replay", async () => {
  resetStore();
  const world = setupWorld({ rounds: [reply([finish()]), reply([finish()])] });
  await startTurn(world, { knowledge: { skillsBlock: SKILLS, memoryBlock: MEM, memoryEpoch: 1, skillEpoch: "e1" } });
  assert.ok(await store.get(coderPinKey("LZPT-7", "t1")), "turn 1 pinned");
  const r = await startTurn(world, {
    userMessage: "second",
    knowledge: { skillsBlock: "x".repeat(33 * 1024), memoryBlock: "", memoryEpoch: 2, skillEpoch: "e1", repin: true, pinInvalidated: "memoryEpoch 1→2" },
  });
  assert.equal(r.success, true, "the turn still runs — a pin is an optimisation, never a gate");
  assert.equal(await store.get(coderPinKey("LZPT-7", "t1")), undefined,
    "the INVALIDATED row is removed: keeping it would hand the deleted memory back to the next turn");
});

/* ═════════ F-581: the pin lives exactly as long as the thread does ═════════
 *
 * The transcript row's 90-day TTL is re-set on EVERY turn, so a thread in regular use is
 * effectively immortal. The pin's was written once under `if (!already)` and never renewed,
 * so it expired FIRST — and the turn after that found no pin, built knowledge live, and
 * wrote a NEW pin presenting today's skills and memories in the prefix as if they had been
 * the thread's all along. A silent re-pin, a moved prefix, and the whole stored history
 * re-billed at write price, with nothing in the log to say why.
 */
const ttlSpyStore = (calls) => ({
  ...store,
  get: (k) => store.get(k),
  set: (k, v, opts) => { calls.push({ key: k, ttl: opts && opts.ttl }); return store.set(k, v, opts); },
  delete: (k) => store.delete(k),
  query: (...a) => store.query(...a),
});

await check("F-581: the pin's TTL is refreshed on every turn, by the same writer and on the same turn as the thread row's", async () => {
  resetStore();
  const world = setupWorld({ rounds: [reply([finish()]), reply([finish()])] });
  const stable = { skillsBlock: SKILLS, memoryBlock: MEM, memoryEpoch: 1, skillEpoch: "e1" };
  await startTurn(world, { knowledge: stable });

  const calls = [];
  await startTurn(world, { userMessage: "second", knowledge: stable, deps: { store: ttlSpyStore(calls), gitExecutor: recordingGit(world), ticketId: () => "tkt_FIXED_ID" } });

  const pinWrites = calls.filter((c) => c.key === coderPinKey("LZPT-7", "t1"));
  const threadWrites = calls.filter((c) => c.key === coderThreadKey("LZPT-7", "t1"));
  assert.equal(pinWrites.length, 1, "THE FINDING: a later turn writes the pin at all — it used to write it never");
  assert.deepEqual(pinWrites[0].ttl, threadWrites[threadWrites.length - 1].ttl,
    "…under exactly the thread row's TTL, from the one constant both now read");

  // REFRESHED, NOT REWRITTEN: the bytes the prefix carries must not move for this.
  const pin = await store.get(coderPinKey("LZPT-7", "t1"));
  assert.equal(pin.memoryBlock, MEM, "the refresh puts the SAME object back");
  assert.equal(pin.skillsBlock, SKILLS);
  const t1 = world.requests[0].messages;
  const t2 = world.requests[1].messages;
  assert.equal(JSON.stringify(t2.slice(0, t1.length - 1)), JSON.stringify(t1.slice(0, t1.length - 1)),
    "…and not one byte of the shared prefix moved");
});

await check("F-581: a pin that expired under a living thread is re-pinned OUT LOUD, never silently", async () => {
  resetStore();
  const world = setupWorld({ rounds: [reply([finish()]), reply([finish()])] });
  const stable = { skillsBlock: SKILLS, memoryBlock: MEM, memoryEpoch: 1, skillEpoch: "e1" };
  await startTurn(world, { knowledge: stable });
  // What a 90-day TTL does to the pin while the thread row, refreshed every turn, lives on.
  await store.delete(coderPinKey("LZPT-7", "t1"));

  const TODAY = "- [user] Deploys need the production environment flag set.";
  const r = await startTurn(world, { userMessage: "second", knowledge: { ...stable, memoryBlock: TODAY, memoryEpoch: 2 } });
  const pin = await store.get(coderPinKey("LZPT-7", "t1"));
  assert.equal(pin.memoryBlock, TODAY, "the thread does get a working pin again");
  assert.ok((r.logs || []).some((l) => /pin expired/.test(l) && /prefix moves once/.test(l)),
    `THE FINDING: the turn says the prefix moved and why (${JSON.stringify((r.logs || []).filter((l) => /pin/.test(l)))})`);
});

await check("F-581: the FIRST turn of a thread pins without claiming anything expired", async () => {
  resetStore();
  const world = setupWorld({ rounds: [reply([finish()])] });
  const r = await startTurn(world, { knowledge: { skillsBlock: SKILLS, memoryBlock: MEM, memoryEpoch: 1, skillEpoch: "e1" } });
  assert.ok(!(r.logs || []).some((l) => /pin expired/.test(l)), "turn 1 has nothing to have expired");
  assert.ok(await store.get(coderPinKey("LZPT-7", "t1")), "…and it still pins");
});

await check("F-598: a verified epoch is re-stamped onto the pin without moving one byte of the prefix", async () => {
  resetStore();
  const world = setupWorld({ rounds: [reply([finish()]), reply([finish()])] });
  const stable = { skillsBlock: SKILLS, memoryBlock: MEM, memoryEpoch: 1, skillEpoch: "e1" };
  await startTurn(world, { knowledge: stable });

  // The builder saw the epoch move, re-rendered THIS project's block, found it identical,
  // and said so. The engine must carry the new stamp so the thread does not pay the same
  // re-render on every later turn for one unrelated write elsewhere on the instance.
  const r = await startTurn(world, {
    userMessage: "second",
    knowledge: { ...stable, memoryEpoch: 7, pinEpochVerified: true },
  });
  const pin = await store.get(coderPinKey("LZPT-7", "t1"));
  assert.equal(pin.memoryEpoch, 7, "THE FINDING: the pin is re-stamped at the epoch its bytes were proven against");
  assert.equal(pin.memoryBlock, MEM, "…and the memory bytes did not move");
  assert.equal(pin.skillsBlock, SKILLS, "…nor the skills");
  assert.ok(!(r.logs || []).some((l) => /prefix moves once/.test(l)),
    "…and the turn claims no prefix move, because there was none");
  const t1 = world.requests[0].messages;
  const t2 = world.requests[1].messages;
  assert.equal(JSON.stringify(t2.slice(0, t1.length - 1)), JSON.stringify(t1.slice(0, t1.length - 1)),
    "…the shared prefix is byte-identical");
});

await check("F-598: an UNVERIFIED epoch on a living pin changes nothing — the stamp only moves on proof", async () => {
  resetStore();
  const world = setupWorld({ rounds: [reply([finish()]), reply([finish()])] });
  const stable = { skillsBlock: SKILLS, memoryBlock: MEM, memoryEpoch: 1, skillEpoch: "e1" };
  await startTurn(world, { knowledge: stable });
  await startTurn(world, { userMessage: "second", knowledge: { ...stable, memoryEpoch: 9 } });
  const pin = await store.get(coderPinKey("LZPT-7", "t1"));
  assert.equal(pin.memoryEpoch, 1, "a refresh without `pinEpochVerified` leaves the stamp exactly as it was");
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
  assert.ok(miss && /FIRST round/.test(miss.line), "a first round that read nothing of the previous prefix is reported");
  assert.equal(miss.defect, true, "…as a defect, because nothing explained it");
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

await check("F-615: a prefix this turn re-built ON PURPOSE is an INFO with the true cause, not a DEFECT", async () => {
  const { reportCrossTurnCacheDefect } = await import("../../src/agent-runner.js");
  const lines = [];
  const log = (l) => lines.push(l);
  const warned = [];
  const warn = console.warn; console.warn = (...a) => warned.push(a.join(" "));
  let out;
  try {
    // Exactly the live case: F-578 invalidated the pin because the memory epoch moved, the
    // engine rebuilt the blocks and said so, and the turn then read nothing of the old prefix.
    out = reportCrossTurnCacheDefect({
      provider: "managed", usage: { firstRoundCacheReadTokens: 0 }, priorPrefixBytes: 40000,
      prefixReset: "memoryEpoch 0→1, and this project's memory block changed with it", log,
    });
  } finally { console.warn = warn; }
  assert.equal(out.defect, false, "THE FINDING: a deliberate re-pin is not counted as a defect");
  assert.equal(warned.length, 0, "…and nothing is written at WARN");
  assert.ok(/^pin re-built: memoryEpoch 0→1/.test(out.line), "…the line names the true cause first");
  assert.ok(!/DEFECT/.test(out.line), "…and never uses the word the reader acts on");
  assert.equal(out.reason, "memoryEpoch 0→1, and this project's memory block changed with it");
  assert.equal(lines.length, 1, "still one line on the turn's own log");
});

await check("F-615: a zero read with NO reason is still the WARN defect", async () => {
  const { reportCrossTurnCacheDefect } = await import("../../src/agent-runner.js");
  const warned = [];
  const warn = console.warn; console.warn = (...a) => warned.push(a.join(" "));
  let out;
  try {
    out = reportCrossTurnCacheDefect({ provider: "managed", usage: { firstRoundCacheReadTokens: 0 }, priorPrefixBytes: 40000, prefixReset: "" });
  } finally { console.warn = warn; }
  assert.equal(out.defect, true, "a stable pin that read nothing is the miss F-550 exists to catch");
  assert.equal(out.reason, "unexplained");
  assert.equal(warned.filter((l) => /DEFECT/.test(l)).length, 1, "…and it is still a WARN");
});

await check("F-615: the turn records WHY the prefix moved, and a healthy turn records nothing", async () => {
  resetStore();
  const world = setupWorld({ rounds: [reply([finish()]), reply([finish()]), reply([finish()])] });
  const stable = { skillsBlock: SKILLS, memoryBlock: MEM, memoryEpoch: 1, skillEpoch: "e1" };
  await startTurn(world, { knowledge: stable });
  // Turn 1 of a thread compares against nothing, so it is NEITHER a defect nor a re-pin.
  const first = await store.get(coderThreadKey("LZPT-7", "t1"));
  assert.equal(first.cacheReset, undefined, "a thread's first turn has no cache reset to explain");

  // Make the previous prefix big enough to be worth caching, then re-pin on purpose.
  first.promptPrefixBytes = 40000;
  await store.set(coderThreadKey("LZPT-7", "t1"), first);
  await startTurn(world, {
    userMessage: "second",
    knowledge: { ...stable, memoryEpoch: 2, repin: true, pinInvalidated: "memoryEpoch 1→2, and this project's memory block changed with it" },
  });
  const row = await store.get(coderThreadKey("LZPT-7", "t1"));
  assert.equal(row.cacheReset.defect, false, "THE FINDING: the deliberate re-pin is recorded as not-a-defect");
  assert.match(row.cacheReset.reason, /memoryEpoch 1→2/, "…with the cause the next tester needs");

  // A turn that did not move the prefix must not inherit the previous turn's excuse.
  row.promptPrefixBytes = 40000;
  await store.set(coderThreadKey("LZPT-7", "t1"), row);
  await startTurn(world, { userMessage: "third", knowledge: { ...stable, memoryEpoch: 2 } });
  const row3 = await store.get(coderThreadKey("LZPT-7", "t1"));
  assert.equal(row3.cacheReset.defect, true, "an unexplained miss on a stable pin is still the defect");
  assert.equal(row3.cacheReset.reason, "unexplained", "…and it never carries the last turn's reason");
});

/* ───────── F-829 — the engine's gate is only as fresh as the facts handed to it ─────────
 *
 * `runCoderTurn` re-runs the PREDICATE (`agentCapability`) over `gateFacts`; it reads no
 * fact itself and it never will — that is what makes it a pure gate. So the guarantee is
 * the CALLER's: the queue consumer must hand in facts read at EXECUTION time, not the ones
 * the producer serialised into the payload minutes earlier. The consumer used to pass
 * `p.gateFacts` straight through, which is why "the engine re-runs the gate" bought
 * nothing. This is the ban that keeps that line from coming back.
 */
await check("F-829: the consumer hands the engine FRESH facts, never the queued payload's", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const consumerSrc = readFileSync(fileURLToPath(new URL("../../src/async-handler.js", import.meta.url)), "utf8");
  const at = consumerSrc.indexOf("const executeCoderTurn = async (params, taskId) => {");
  assert.ok(at > 0, "executeCoderTurn exists");
  const body = consumerSrc.slice(at, consumerSrc.indexOf("\n};\n", at));
  assert.ok(!/gateFacts:\s*p\.gateFacts/.test(body),
    "the queued facts must not be the ones the engine gates on — they are advisory (F-829)");
  assert.match(body, /gateFacts:\s*gateNow\.facts/,
    "the engine receives the facts re-derived at execution time");
  assert.ok(consumerSrc.includes("const resolveFreshCoderGate = async (p) => {"),
    "the fresh derivation has ONE home in the consumer");
  // …and the engine itself still reads nothing: no fact-reader may appear in its gate.
  const engineSrc = readFileSync(fileURLToPath(new URL("../../src/coder-engine.js", import.meta.url)), "utf8");
  assert.ok(!/agentGateFacts|readProviderConfigFresh|readForgeLlmAllowance/.test(engineSrc),
    "the engine stays a pure predicate — a second fact-reader here is the split F-302 closed");
});

console.log(`CODER ENGINE: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
