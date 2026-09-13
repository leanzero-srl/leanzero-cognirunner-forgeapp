/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// F-360 — ANSWERING A CONSENT TICKET MUST NOT TAKE A SIMULATED THREAD LIVE.
//
// `confirmCoderTicket` is the ONE producer of the resume turn, and it used to push
// that turn with only the message: no `simulation`. The engine re-assigns
// `record.simulation` from the parameter every turn, so a missing flag meant FALSE
// — the next turn ran with real Jira and real repository writes, and the user was
// never told the dry run had ended.
//
// This suite drives the REAL resolvers in src/index.js against the offline mocks and
// reads the queue the mock @forge/events records, so it pins the PUSHED PARAMS, not
// a source string:
//   1. startCoderTurn stores what the thread runs with,
//   2. the resume push carries simulation/connectionId from that record,
//   3. a confirm payload claiming simulation:false cannot flip it,
//   4. with no record at all the resume says NOTHING, leaving the engine's thread row
//      (the authority since F-360's engine half) to decide.
//
// Run: node scripts/coder-resume-params.test.mjs (auto-discovered by run-offline.mjs)

import "../lib/register-mocks-index.mjs";
import storage from "../lib/mock-kvs.mjs";
const { default: forgeApi, pushed } = await import("@forge/api");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const OWNER = "acct-owner";

await storage.set("COGNIRUNNER_AI_PROVIDER", "openai");
await storage.set("COGNIRUNNER_OPENAI_KEY", "sk-test");
await storage.set("COGNIRUNNER_EDITION_SNAPSHOT", { active: true, edition: "advanced", at: new Date().toISOString() });
await storage.set("app_admins", [{ accountId: OWNER, role: "admin", scope: "all" }]);
forgeApi.__respond(() => forgeApi.__response(200, {}));

const { handler } = await import("../../src/index.js");
const coder = await import("../../src/coder-engine.js");

const call = (functionKey, payload = {}, accountId = OWNER) =>
  handler({ call: { functionKey, payload }, context: {} }, { principal: { accountId } });

const lastCoderPush = () => {
  for (let i = pushed.length - 1; i >= 0; i--) if (pushed[i]?.body?.taskType === "coder") return pushed[i].body.params;
  return null;
};

const ISSUE = "LZPT-77";

/* ===== 1. a SIMULATED turn records what it runs with ===== */
const started = await call("startCoderTurn", {
  issueKey: ISSUE, threadId: "t_sim", message: "have a look", simulation: true,
  connectionId: "conn-1", maxRounds: 3,
});
ok(started && started.success === true, `startCoderTurn accepted the turn (got ${JSON.stringify(started).slice(0, 200)})`);
{
  const p = lastCoderPush();
  ok(p && p.simulation === true, "the FIRST turn is pushed with simulation:true");
  const row = await storage.get(`coder_turn:${ISSUE}:t_sim`);
  ok(!!row && row.simulation === true && row.connectionId === "conn-1" && row.maxRounds === 3,
    `the turn params are stored for the resume to read (got ${JSON.stringify(row)})`);
}

/* ===== 2. the resume INHERITS simulation ===== */
// A pending ticket, in the shape the engine writes, answered with "skip" so nothing
// external is executed and the test stays offline.
const seedTicket = async (id, over = {}) => {
  await storage.set(coder.coderTicketKey(id), {
    ticketId: id, issueKey: ISSUE, threadId: "t_sim", ownerAccountId: OWNER,
    action: "commit_files", args: {}, argsPreview: {}, status: "pending",
    simulation: true, connectionId: "conn-1", ...over,
  });
  await storage.set(coder.coderThreadKey(ISSUE, "t_sim"), {
    issueKey: ISSUE, threadId: "t_sim", ownerAccountId: OWNER, messages: [],
    simulation: true, connectionId: "conn-1", pendingTicketId: id,
  });
};

await seedTicket("tkt_1");
const skipped = await call("confirmCoderTicket", { ticketId: "tkt_1", decision: "skip" });
ok(skipped && skipped.success === true, `the skip was recorded (got ${JSON.stringify(skipped).slice(0, 200)})`);
{
  const p = lastCoderPush();
  ok(p && p.simulation === true, `THE FINDING: the resume turn carries simulation:true (got ${JSON.stringify(p && p.simulation)})`);
  ok(p && p.connectionId === "conn-1", "…and the connection the thread was started against");
  ok(p && p.maxRounds === 3, "…and the round budget of the original turn");
  ok(p && p.message === skipped.resumeMessage, "…and the engine's own resume sentence, unchanged");
}

/* ===== 3. the confirm PAYLOAD cannot flip simulation ===== */
await seedTicket("tkt_2");
await call("confirmCoderTicket", { ticketId: "tkt_2", decision: "skip", simulation: false, connectionId: "conn-evil", maxRounds: 99 });
{
  const p = lastCoderPush();
  ok(p && p.simulation === true, "a caller-supplied simulation:false is IGNORED — the thread stays simulated");
  ok(p && p.connectionId === "conn-1", "a caller-supplied connectionId is ignored too");
  ok(p && p.maxRounds === 3, "…and so is a caller-supplied round budget");
}

/* ===== 4. no record at all → SAY NOTHING, so the engine's thread row decides ===== */
await storage.delete(`coder_turn:${ISSUE}:t_orphan`);
await storage.set(coder.coderTicketKey("tkt_3"), {
  ticketId: "tkt_3", issueKey: ISSUE, threadId: "t_orphan", ownerAccountId: OWNER,
  action: "commit_files", args: {}, argsPreview: {}, status: "pending", simulation: true,
});
const orphan = await call("confirmCoderTicket", { ticketId: "tkt_3", decision: "skip" });
ok(orphan && orphan.success === true, "a ticket whose thread row is gone is still answerable");
{
  const p = lastCoderPush();
  // The engine half of F-360 made the THREAD ROW the authority and refuses a mid-thread
  // flip by name, so the honest answer when nothing is known is to say nothing: a value
  // invented here would either take a simulated thread live or be refused as
  // "simulation-locked" on a live one.
  ok(p && !("simulation" in p), `an UNKNOWN mode pushes NO simulation flag, leaving the thread row as the authority (got ${JSON.stringify(p && p.simulation)})`);
}

/* ===== 5. a LIVE thread still resumes live (the fix is not a downgrade) ===== */
await call("startCoderTurn", { issueKey: ISSUE, threadId: "t_live", message: "go", simulation: false, connectionId: "conn-2" });
await storage.set(coder.coderTicketKey("tkt_4"), {
  ticketId: "tkt_4", issueKey: ISSUE, threadId: "t_live", ownerAccountId: OWNER,
  action: "commit_files", args: {}, argsPreview: {}, status: "pending", simulation: false, connectionId: "conn-2",
});
await call("confirmCoderTicket", { ticketId: "tkt_4", decision: "skip" });
{
  const p = lastCoderPush();
  ok(p && p.simulation === false, "a thread the owner started LIVE resumes live");
  ok(p && p.connectionId === "conn-2", "…against its own connection");
}

console.log(`\ncoder resume params: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
