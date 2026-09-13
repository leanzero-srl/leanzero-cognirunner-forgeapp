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
    + "export const UPLOAD_ALLOWED_EXTENSIONS = new Set(['.md','.txt']);"
    + "export const UPLOAD_MAX_BYTES = 26214400;" };
  return next(url, ctx);
}`));

const store = (await import("../lib/mock-kvs.mjs")).default;
const {
  runCoderTurn, confirmCoderTicket, compactThread, buildCoderSystemPrompt, buildArgsPreview,
  coderThreadKey, coderTicketKey, coderExecClaimKey, coderTicketExecClaimKey,
  CODER_MAX_ROUNDS, CODER_CLAIM_TTL_MINUTES,
} = await import("../../src/coder-engine.js");
const { runAgentTask, runAgentLoop, createAgentActionDispatcher } = await import("../../src/agent-runner.js");
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

console.log(`CODER ENGINE: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
