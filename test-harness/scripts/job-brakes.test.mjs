/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// JOB BRAKES (1.4 commit 13d) through the REAL runJob — only the agent and the Jira
// transport are mocked.
//
// The shape-level BLOCK/ALLOW for both brakes lives in listeners.test.mjs; what is
// asserted HERE is the thing that actually matters to a customer: a runaway scope STOPS,
// the issues it did not reach are REPORTED as not processed (a partial run must never
// read as a whole one), and a job inside its allowance is untouched.
import "../lib/register-mocks-index.mjs";
import { register } from "node:module";
import storage from "../lib/mock-kvs.mjs";
import jira from "../lib/mock-forge-api.mjs";
register("data:text/javascript," + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === "./agent-runner.js" && String(ctx.parentURL || "").endsWith("/src/scheduled-jobs.js")) return {url:"job-brake:agent",shortCircuit:true};
  return next(spec,ctx);
}
export async function load(url,ctx,next) {
  if(url === "job-brake:agent") return {format:"module",shortCircuit:true,source:"export const runAgentTask = async (args) => globalThis.__brakeAgent(args);"};
  return next(url,ctx);
}`));
const { normalizeJob, runJob, MAX_SCOPE_ISSUES } = await import("../../src/scheduled-jobs.js");
const { JOB_DEFAULT_MAX_WRITES_PER_RUN, AGENT_RUN_BRAKE_MAX_PER_BUCKET } = await import("../../src/shared/registry-limits.js");
const { BRAKE_BUCKET_MS } = await import("../../src/listeners.js");

let pass = 0; let fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log("  FAIL:", msg); } };

const scopeOf = (n) => {
  const issues = Array.from({ length: n }, (_, i) => ({ key: `LZPT-${i + 1}`, fields: { summary: `s${i}`, project: { key: "LZPT" } } }));
  jira.__respond(() => jira.__response(200, { issues }));
  return issues;
};
// One agent run = one change. The simplest shape that makes the write count equal the
// issue count, so an off-by-one in the brake is visible rather than plausible.
const oneWriteAgent = () => { globalThis.__brakeAgent = async () => ({ success: true, outcome: "done", summary: "did one thing", rounds: 1, toolCalls: [], changes: [{ action: "addComment", key: "x" }], logs: [], tokens: 10, aiTimeMs: 1 }); };
const jobWith = (over) => normalizeJob({ name: "Sweep", schedule: { cron: "0 9 * * *", timeZone: "UTC" }, mode: "agent", agent: { instructions: "do it", allowedActions: ["add_comment"] }, scope: { jql: "project = LZPT", maxIssues: MAX_SCOPE_ISSUES }, ...over });

/* ===================== the WRITE brake ===================== */

// BLOCK: 10 issues, allowance 4 → four are processed, six are reported unprocessed.
{
  storage.__reset(); jira.__reset(); oneWriteAgent();
  scopeOf(10);
  const out = await runJob({ job: jobWith({ maxWritesPerRun: 4, scope: { jql: "project = LZPT", maxIssues: 10 } }), manual: true });
  ok(out.brake && out.brake.kind === "job-writes", "BLOCK: the run reports a write brake");
  ok(out.brake.max === 4, "…naming the limit it hit");
  ok(/Write brake: this run reached its limit of 4 changes/.test(out.brake.reason), "…with the sentence from the ONE home");
  const processed = out.issues.filter((i) => i.success).length;
  ok(processed === 4, `exactly the allowance was spent — ${processed} issue(s) processed`);
  ok(out.issues.length === 10, "EVERY scope issue still has an outcome row");
  const unprocessed = out.issues.filter((i) => i.reason === "not processed (write brake)");
  ok(unprocessed.length === 6, "…and the six it never reached SAY so, by name");
  ok(out.success === false, "a braked run is NOT a success — a partial run must not read as a whole one");
  ok(out.log.changes.length === 4, "the change ledger holds exactly the four writes that happened");
  ok(/BRAKED \(job-writes\)/.test(out.log.reason), "the log line says it was braked");
  ok(out.log.recommendation === out.brake.reason, "…and the recommendation tells the operator what to do");
  ok(out.log.brake && out.log.brake.kind === "job-writes", "the log carries the brake field the Jobs tab renders");
  ok(out.log.logs.some((l) => /WRITE BRAKE: 4 change\(s\) made, limit 4 — 6 issue\(s\) not processed/.test(l)), "the execution log names the numbers");
}

// ALLOW: the same job inside its allowance is untouched — no brake field at all.
{
  storage.__reset(); jira.__reset(); oneWriteAgent();
  scopeOf(10);
  const out = await runJob({ job: jobWith({ maxWritesPerRun: 50, scope: { jql: "project = LZPT", maxIssues: 10 } }), manual: true });
  ok(out.brake === undefined, "ALLOW: a run inside its allowance reports NO brake (absent, not 'none')");
  ok(out.issues.filter((i) => i.success).length === 10, "…all ten issues processed");
  ok(out.success === true, "…and the run is a success");
  ok(out.log.brake === undefined, "…and the log carries no brake field");
}

// A job that may never write at all is a real configuration, not an unset field.
{
  storage.__reset(); jira.__reset(); oneWriteAgent();
  scopeOf(3);
  const out = await runJob({ job: jobWith({ maxWritesPerRun: 0, scope: { jql: "project = LZPT", maxIssues: 3 } }), manual: true });
  ok(out.brake && out.brake.max === 0, "maxWritesPerRun 0 brakes before the first issue");
  ok(out.issues.every((i) => i.reason === "not processed (write brake)"), "…and nothing is processed");
}

// An OLD record saved before 1.4 has no field — it gets the DEFAULT, never "no brake".
{
  storage.__reset(); jira.__reset(); oneWriteAgent();
  scopeOf(2);
  const legacy = jobWith({ scope: { jql: "project = LZPT", maxIssues: 2 } });
  delete legacy.maxWritesPerRun;
  const out = await runJob({ job: legacy, manual: true });
  ok(out.brake === undefined && out.issues.filter((i) => i.success).length === 2, "a legacy record runs normally under the default");
  ok(JOB_DEFAULT_MAX_WRITES_PER_RUN >= MAX_SCOPE_ISSUES * 2, "…because the default clears twice the biggest legal scope");
}

/* ===================== the tenant-wide AGENT-RUN brake ===================== */

// BLOCK: the bucket is already at the cap, so the agent never runs at all.
{
  storage.__reset(); jira.__reset();
  let called = 0;
  globalThis.__brakeAgent = async () => { called++; return { success: true, outcome: "done", summary: "", rounds: 1, toolCalls: [], changes: [], logs: [], tokens: 0, aiTimeMs: 0 }; };
  storage.__seed(`agent_brake:${Math.floor(Date.now() / BRAKE_BUCKET_MS)}`, AGENT_RUN_BRAKE_MAX_PER_BUCKET);
  const out = await runJob({ job: jobWith({ scope: null }), manual: true });
  ok(called === 0, "BLOCK: the model is never called when the tenant brake is tripped");
  ok(out.brake && out.brake.kind === "agent-runs", "…the run reports an agent-run brake");
  ok(/more than 200 AI agent runs in 5 minutes/.test(out.brake.reason), "…with the named reason");
  ok(out.success === false, "…and it is not a success");
  ok(out.log.brake.kind === "agent-runs", "…and the log carries it for the Jobs tab");
}

// ALLOW: an idle installation runs, and the run is accounted for in the bucket.
{
  storage.__reset(); jira.__reset();
  let called = 0;
  globalThis.__brakeAgent = async () => { called++; return { success: true, outcome: "done", summary: "ok", rounds: 1, toolCalls: [], changes: [], logs: [], tokens: 0, aiTimeMs: 0 }; };
  const out = await runJob({ job: jobWith({ scope: null }), manual: true });
  ok(called === 1, "ALLOW: an idle installation runs the agent");
  ok(out.brake === undefined && out.success === true, "…with no brake reported");
  ok(Number(storage.__raw(`agent_brake:${Math.floor(Date.now() / BRAKE_BUCKET_MS)}`)) === 1, "…and the run is counted, so the next one sees it");
}

// SCRIPT mode is not gated by the AGENT brake — it starts no model and costs no tokens.
{
  storage.__reset(); jira.__reset();
  storage.__seed(`agent_brake:${Math.floor(Date.now() / BRAKE_BUCKET_MS)}`, AGENT_RUN_BRAKE_MAX_PER_BUCKET);
  const job = normalizeJob({ name: "Script", schedule: { cron: "0 9 * * *", timeZone: "UTC" }, functions: [{ code: "api.log(1)" }] });
  const out = await runJob({ job, manual: true });
  ok(!out.brake || out.brake.kind !== "agent-runs", "a SCRIPT job is not stopped by the AI brake — it starts no model");
}

/* ===================== the brake INSIDE one run (the dispatcher) ===================== */

// The scope-level brake above stops the NEXT issue; this is the one that stops the next
// WRITE. It counts `session.changes` — the one write ledger every sandbox mutator already
// appends to — so the brake and the log can never disagree about what the run did.
{
  const { createAgentActionDispatcher } = await import("../../src/agent-runner.js");
  const changes = [];
  const fakeApi = {
    addComment: async () => { changes.push({ action: "addComment" }); return { id: "1" }; },
    getIssue: async () => ({ key: "LZPT-1", fields: { summary: "s" } }),
    forIssue: () => fakeApi,
  };
  const session = { createApi: () => fakeApi, changes };
  const m = { extractTextFromADF: (v) => String(v || "") };
  const dispatch = createAgentActionDispatcher({ issueKey: "LZPT-1", session, allowed: ["add_comment", "get_issue"], m, maxWrites: 2 });

  ok((await dispatch("add_comment", { text: "one" })).id === "1", "ALLOW: the first write goes through");
  ok((await dispatch("add_comment", { text: "two" })).id === "1", "ALLOW: the second fills the allowance");
  ok(changes.length === 2, "…and both landed on the shared ledger");
  const refused = await dispatch("add_comment", { text: "three" });
  ok(refused.success === false && refused.code === "write_brake", "BLOCK: the third write is refused, not executed");
  ok(/already made 2 changes, which is its limit of 2/.test(refused.error), "…with a sentence the model can act on");
  ok(/call finish and say what was and was not done/.test(refused.error), "…that tells it to finish honestly rather than retry");
  ok(changes.length === 2, "…and NOTHING was written (the brake runs BEFORE the call)");
  // A READ is never braked: a braked agent must still be able to see enough to finish.
  ok((await dispatch("get_issue", {})).key === "LZPT-1", "reads keep working past the write brake");

  // No brake configured = the pre-1.4 behaviour, unchanged.
  const changes2 = [];
  const api2 = { addComment: async () => { changes2.push({}); return { id: "9" }; }, forIssue: () => api2 };
  const open = createAgentActionDispatcher({ issueKey: "LZPT-1", session: { createApi: () => api2, changes: changes2 }, allowed: ["add_comment"], m, maxWrites: null });
  for (let i = 0; i < 20; i++) await open("add_comment", { text: "x" });
  ok(changes2.length === 20, "maxWrites null = no brake at all (the listener path, unchanged)");
}

/* ============ the write brake counts GIT writes too (F-403) ============

A commit, a branch and a pull request are writes to somebody's repository, but they are
made by an executor that cannot reach `session.changes` — so the brake, which counts
exactly that array, saw none of them. An agent could open forty pull requests under
maxWritesPerRun: 2 and the run's own change ledger showed nothing at all. */

{
  const { createAgentActionDispatcher } = await import("../../src/agent-runner.js");
  const { createSandboxSession } = await import("../../src/index.js");
  // The REAL session, because `recordChange` is the thing under test and a hand-rolled
  // stub would prove only that the test author agrees with the test author.
  const session = createSandboxSession({ issueKey: "LZPT-1", config: {} });
  let calls = 0;
  const gitExecutor = {
    namespace: "git",
    execute: async (name, args) => { calls++; return { success: true, action: name, repo: args.repo, branch: args.branch, number: 7, url: "https://example.com/pr/7" }; },
  };
  const m = { extractTextFromADF: (v) => String(v || "") };
  const dispatch = createAgentActionDispatcher({
    issueKey: "LZPT-1", session, executors: { git: gitExecutor }, m, maxWrites: 2,
    allowed: ["commit_files", "open_pull_request", "get_pull_request"],
  });

  const one = await dispatch("commit_files", { repo: "acme/app", branch: "main", files: [{ path: "a", content: "b" }] });
  ok(one.success === true && calls === 1, "ALLOW: the first git write goes through");
  ok(session.changes.length === 1, "…and LANDS ON THE LEDGER — this is the whole of F-403");
  ok(session.changes[0].namespace === "git" && session.changes[0].action === "commit_files", "…naming the namespace and the action");
  ok(session.changes[0].repo === "acme/app" && session.changes[0].branch === "main", "…and enough of the target to read the row");

  await dispatch("open_pull_request", { repo: "acme/app", branch: "feat" });
  ok(session.changes.length === 2 && calls === 2, "ALLOW: the second git write fills the allowance");

  const third = await dispatch("commit_files", { repo: "acme/app", branch: "main", files: [{ path: "c", content: "d" }] });
  ok(third.success === false && third.code === "write_brake", "BLOCK: the THIRD git write is refused by the same brake Jira writes obey");
  ok(calls === 2, "…and the executor was never called, so nothing reached the repository");
  ok(/already made 2 changes, which is its limit of 2/.test(third.error), "…with the one sentence, from the one home");

  // A git READ is not a write and is never braked — a braked agent must still see enough
  // to finish honestly.
  const read = await dispatch("get_pull_request", { repo: "acme/app", number: 7 });
  ok(read.success === true && session.changes.length === 2, "a git READ is not braked and does not touch the ledger");
}
{
  // A FAILED git write records nothing: a brake that counts refusals brakes the wrong run,
  // and a ledger that lists writes that never happened lies to the operator.
  const { createAgentActionDispatcher } = await import("../../src/agent-runner.js");
  const { createSandboxSession } = await import("../../src/index.js");
  const session = createSandboxSession({ issueKey: "LZPT-1", config: {} });
  const dispatch = createAgentActionDispatcher({
    issueKey: "LZPT-1", session, m: {}, maxWrites: 5, allowed: ["commit_files"],
    executors: { git: { namespace: "git", execute: async () => ({ success: false, code: "not_allowed", error: "no" }) } },
  });
  const r = await dispatch("commit_files", { repo: "acme/app", branch: "main", files: [] });
  ok(r.success === false && session.changes.length === 0, "a REFUSED git write is not counted as a change");
}
{
  // SIMULATION still counts: a simulated run's job is to show what WOULD happen, and a
  // simulated run that ignores the brake shows a plan the real run could never execute.
  const { createAgentActionDispatcher } = await import("../../src/agent-runner.js");
  const { createSandboxSession } = await import("../../src/index.js");
  const session = createSandboxSession({ issueKey: "LZPT-1", config: { simulationMode: true } });
  const dispatch = createAgentActionDispatcher({
    issueKey: "LZPT-1", session, m: {}, maxWrites: 1, allowed: ["commit_files"],
    executors: { git: { namespace: "git", execute: async () => ({ success: true, simulated: true, repo: "acme/app" }) } },
  });
  await dispatch("commit_files", { repo: "acme/app", branch: "main", files: [] });
  ok(session.changes.length === 1 && session.changes[0].simulated === true, "a SIMULATED git write is recorded, and says it was simulated");
  const second = await dispatch("commit_files", { repo: "acme/app", branch: "main", files: [] });
  ok(second.code === "write_brake", "…and it spends the allowance, so a dry run shows the brake the real run would hit");
}

console.log(`job-brakes: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
