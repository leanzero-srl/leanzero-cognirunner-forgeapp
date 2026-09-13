/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// THE HEADLESS CODER TURN (1.4 commit 12) — the engine half of premade-coder-pf.test.mjs,
// run as a child because stubbing src/index.js at the module loader (the only way to run
// the engine offline) cannot coexist with importing the real src/index.js.
//
//   · a `confirm` action the gate REFUSED ends the turn: endedBy "halt", a NAMED
//     haltReason, NO consent ticket row, NO git call;
//   · a `confirm` action the gate ALLOWS (admin-saved) EXECUTES — headless has no
//     ticket path, so an armed rule must actually do the work;
//   · the same refused action in the INTERACTIVE path still opens a ticket, i.e. the
//     flag changed the headless surface and nothing else;
//   · the mode's ceiling is what the model is offered.
//
// Not auto-discovered (no .test.mjs suffix) — the parent runs it.

import { register } from "node:module";
import assert from "node:assert/strict";

register("data:text/javascript," + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  const parent = String(ctx.parentURL || "");
  if (spec === "./index.js" && (parent.endsWith("/src/agent-runner.js") || parent.endsWith("/src/coder-engine.js") || parent.endsWith("/src/coder-workspace.js"))) {
    return { url: "coderpf:index", shortCircuit: true };
  }
  return next(spec, ctx);
}
export async function load(url, ctx, next) {
  if (url === "coderpf:index") return { format: "module", shortCircuit: true, source:
    "export const createSandboxSession = args => globalThis.__coderpf.session(args);"
    + "export const getOpenAIKey = async () => 'mock-key';"
    + "export const getOpenAIModel = async () => 'mock-model';"
    + "export const getProviderConfig = async () => ({ provider: 'openai' });"
    + "export const raceDeadline = p => p;"
    + "export const callAIChat = args => globalThis.__coderpf.chat(args);"
    + "export const isJobCancelled = async () => false;"
    + "export const coerceToAdf = s => s;"
    + "export const extractTextFromADF = s => s;"
    + "export const parseAIJson = () => ({});"
    + "export const UPLOAD_ALLOWED_EXTENSIONS = new Set(['.md','.txt']);"
    + "export const UPLOAD_MAX_BYTES = 26214400;" };
  return next(url, ctx);
}`));

const store = (await import("../lib/mock-kvs.mjs")).default;
const { runCoderTurn, isHeadlessTrigger, coderTicketKey } = await import("../../src/coder-engine.js");
const { getCoderPfMode } = await import("../../src/shared/premade-rules-catalog.js");
const { normalizeAllowedActions, buildAgentGateContext } = await import("../../src/shared/agent-actions.js");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const call = (name, args, id = "call-1") => ({ id, function: { name, arguments: JSON.stringify(args) } });
const reply = (tool_calls, content = null) => ({
  ok: true, status: 200,
  data: { choices: [{ message: { role: "assistant", content, tool_calls } }], usage: { total_tokens: 7 } },
});

const setupWorld = ({ rounds = [] } = {}) => {
  const world = {
    requests: [], gitCalls: [], round: 0,
    session({ issueKey, config }) {
      const api = (key) => new Proxy({}, {
        get(_t, method) {
          if (method === "forIssue") return (other) => api(other);
          return async () => (method === "getIssue" ? { key, fields: { summary: "s" } } : { ok: true });
        },
      });
      return { changes: [], executionLogs: [], simulated: config && config.simulationMode === true, createApi: () => api(issueKey) };
    },
    async chat(args) {
      world.requests.push((args.tools || []).map((t) => t.function.name));
      const r = rounds[world.round] !== undefined ? rounds[world.round] : reply([call("finish", { summary: "done", outcome: "done" }, "f")]);
      world.round++;
      return typeof r === "function" ? r() : r;
    },
  };
  globalThis.__coderpf = world;
  return world;
};
const recordingGit = (world) => ({
  execute: async (name, args) => { world.gitCalls.push({ name, args }); return { ok: true, name }; },
});

const FACTS = { edition: "advanced", provider: "openai", agentModel: "gpt-5.4", allowanceLevel: null };
const MODE = getCoderPfMode("review");
const ceilingFor = (savedByRole) =>
  normalizeAllowedActions(MODE.actions, buildAgentGateContext({ ...FACTS, triggerSource: "external", savedByRole })).allowed;

const turn = (world, over = {}) => runCoderTurn({
  issueKey: "LZPT-9", threadId: `pf_r_${Math.random().toString(36).slice(2)}`,
  userMessage: "review the pull request", accountId: "acct-owner",
  gateFacts: FACTS, deps: { store, gitExecutor: recordingGit(world), ticketId: () => "tkt_HEADLESS" },
  ...over,
});

/* ── the derivation ── */
ok(isHeadlessTrigger("postfunction") === true, "a post-function trigger is headless");
ok(isHeadlessTrigger("panel") === false, "the issue panel is not");
ok(isHeadlessTrigger(null) === false, "an absent label means the panel (the pre-1.4 callers)");
ok(isHeadlessTrigger("something-new") === true, "an unknown producer gets the restrictive answer");

/* ── a REFUSED confirm halts, by name, with nothing written ── */
{
  const world = setupWorld({ rounds: [reply([call("add_pr_comment", { repo: "acme/app", number: 3, body: "nit" })])] });
  const r = await turn(world, {
    savedByRole: "editor", headless: true, allowedActions: ceilingFor("editor"),
  });
  ok(r.endedBy === "halt", `the turn HALTS (got ${r.endedBy})`);
  ok(typeof r.haltReason === "string" && r.haltReason.includes("add_pr_comment"),
    `the reason NAMES the action (got ${JSON.stringify(r.haltReason)})`);
  ok(/ADMIN/i.test(r.haltReason), `…and the cause (got ${JSON.stringify(r.haltReason)})`);
  ok(r.awaiting === undefined, "nobody is awaited — there is no human");
  ok((await store.get(coderTicketKey("tkt_HEADLESS"))) == null, "NO consent ticket row was written");
  ok(world.gitCalls.length === 0, "NOTHING reached the repository");
  ok(!world.requests[0].includes("add_pr_comment"), "…and it was never offered as a tool in the first place");
}

/* ── an ALLOWED confirm EXECUTES, because headless has no ticket path ── */
{
  const world = setupWorld({
    rounds: [
      reply([call("add_pr_comment", { repo: "acme/app", number: 3, body: "looks fine" })]),
      reply([call("finish", { summary: "reviewed", outcome: "done" }, "f")]),
    ],
  });
  const r = await turn(world, {
    savedByRole: "admin", headless: true, allowedActions: ceilingFor("admin"),
  });
  ok(r.endedBy === "finish", `an admin-saved rule runs to completion (got ${r.endedBy})`);
  ok(world.gitCalls.length === 1 && world.gitCalls[0].name === "add_pr_comment",
    `the confirm action EXECUTED without a ticket (got ${JSON.stringify(world.gitCalls)})`);
  ok((await store.get(coderTicketKey("tkt_HEADLESS"))) == null, "still no ticket row");
}

/* ── the INTERACTIVE path is untouched: the same action still asks ── */
{
  const world = setupWorld({ rounds: [reply([call("add_pr_comment", { repo: "acme/app", number: 3, body: "nit" })])] });
  const r = await turn(world, { savedByRole: "admin" });
  ok(r.awaiting === "confirm" && r.ticket && r.ticket.id === "tkt_HEADLESS",
    "with a human in the loop a confirm action still opens a consent ticket");
  ok(world.gitCalls.length === 0, "…and executes nothing until it is answered");
}

/* ── the ceiling is what the model is offered ── */
{
  const world = setupWorld({ rounds: [reply([call("finish", { summary: "x", outcome: "done" }, "f")])] });
  await turn(world, { savedByRole: "admin", headless: true, allowedActions: getCoderPfMode("open-branch").actions });
  const offered = world.requests[0];
  ok(offered.includes("create_branch"), "the mode's own action is offered");
  ok(!offered.includes("commit_files") && !offered.includes("open_pull_request"),
    `nothing outside the mode is (got ${offered.join(", ")})`);
  ok(!offered.includes("approve_pull_request") && !offered.includes("trigger_deploy"),
    "and no dangerous action, ever");
  ok(offered.includes("finish"), "finish is always implicit");
}

console.log(`premade-coder-pf (headless engine): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
