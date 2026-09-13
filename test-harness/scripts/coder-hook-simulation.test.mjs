/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * F-387 — THE HARNESS MAY DRIVE THE CODER, BUT NEVER LIVE.
 *
 * `src/test-hook.js` deliberately excluded `startCoderTurn` and `confirmCoderTicket`: the
 * first spends a frontier model's tokens, the second is the one door between a model's
 * request and a write to a customer's repository. The consequence was that no automated
 * path could prove the Coder at all — a Standard tenant's `needs-coder-edition` refusal
 * could only be DERIVED from facts read through other resolvers, never observed.
 *
 * The doors are open now behind a FORCED-SIMULATION wrapper, and this suite pins the
 * property that makes that safe:
 *   1. `startCoderTurn` is rewritten to `simulation:true` whatever the payload says,
 *   2. `confirmCoderTicket` is REFUSED unless the ticket AND its thread are simulated
 *      (an unreadable ticket or a missing thread row is refused too — unknown is not a
 *      licence),
 *   3. `getAgentCapability` — a pure read — is reachable,
 *   4. the write doors are still behind HARNESS_SECRET, and the allow-list is still a list.
 *
 * Run: node scripts/coder-hook-simulation.test.mjs (auto-discovered by run-offline.mjs)
 */
import "../lib/register-mocks-index.mjs";
import storage from "../lib/mock-kvs.mjs";
const { default: forgeApi, pushed } = await import("@forge/api");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const OWNER = "acct-owner";
await storage.set("COGNIRUNNER_AI_PROVIDER", "openai");
await storage.set("COGNIRUNNER_OPENAI_KEY", "sk-test");
await storage.set("COGNIRUNNER_EDITION_SNAPSHOT", { active: true, edition: "advanced", at: new Date().toISOString() });
await storage.set("app_admins", [{ accountId: OWNER, role: "admin", scope: "all" }]);
forgeApi.__respond(() => forgeApi.__response(200, {}));

const { testStateTrigger } = await import("../../src/test-hook.js");
const coder = await import("../../src/coder-engine.js");

const SECRET = "offline-coder-hook-secret";
const previousSecret = process.env.HARNESS_SECRET;
process.env.HARNESS_SECRET = SECRET;

const hook = (body, authorization = `Bearer ${SECRET}`) =>
  testStateTrigger({ method: "POST", headers: { authorization: [authorization] }, body: JSON.stringify(body) });

const invoke = (functionKey, payload = {}, accountId = OWNER) =>
  hook({ action: "invokeResolver", functionKey, payload, accountId });

const lastCoderPush = () => {
  for (let i = pushed.length - 1; i >= 0; i--) if (pushed[i]?.body?.taskType === "coder") return pushed[i].body.params;
  return null;
};

const ISSUE = "LZPT-90";

/* ═══ 1. getAgentCapability — a pure read, reachable ═══ */
{
  const r = await invoke("getAgentCapability");
  eq(r.statusCode, 200, "getAgentCapability is allowlisted");
  const body = JSON.parse(r.body);
  ok(typeof body === "object" && body !== null, "…and answers the capability verdict");
}

/* ═══ 2. startCoderTurn is FORCED to simulation ═══ */
{
  const r = await invoke("startCoderTurn", {
    issueKey: ISSUE, threadId: "t_hook", message: "have a look", simulation: false, maxRounds: 2,
  });
  eq(r.statusCode, 200, "startCoderTurn is reachable through the hook");
  const body = JSON.parse(r.body);
  eq(body.success, true, `…and the turn is accepted (${JSON.stringify(body).slice(0, 160)})`);
  const p = lastCoderPush();
  eq(p && p.simulation, true, "THE FINDING: a payload asking for simulation:false still runs SIMULATED");
  const row = await storage.get(`coder_turn:${ISSUE}:t_hook`);
  eq(row && row.simulation, true, "…and the thread's recorded mode is simulated, so every later turn inherits it");
}

/* ═══ 3. confirmCoderTicket — only on a simulated thread ═══ */
const seed = async (id, { ticketSim = true, threadSim = true, thread = true } = {}) => {
  await storage.set(coder.coderTicketKey(id), {
    ticketId: id, issueKey: ISSUE, threadId: "t_hook", ownerAccountId: OWNER,
    action: "commit_files", args: {}, argsPreview: {}, status: "pending", simulation: ticketSim,
  });
  if (thread) {
    await storage.set(coder.coderThreadKey(ISSUE, "t_hook"), {
      issueKey: ISSUE, threadId: "t_hook", ownerAccountId: OWNER, messages: [],
      simulation: threadSim, pendingTicketId: id,
    });
  } else {
    await storage.delete(coder.coderThreadKey(ISSUE, "t_hook"));
  }
};

{
  await seed("tkt_sim");
  const r = await invoke("confirmCoderTicket", { ticketId: "tkt_sim", decision: "skip" });
  eq(r.statusCode, 200, "a ticket on a SIMULATED thread is answerable through the hook");
  eq(JSON.parse(r.body).success, true, "…and the resolver actually ran");
}
{
  await seed("tkt_live", { ticketSim: false, threadSim: false });
  const r = await invoke("confirmCoderTicket", { ticketId: "tkt_live", decision: "confirm" });
  eq(r.statusCode, 400, "a LIVE thread's ticket is REFUSED by the hook, before the resolver");
  eq(JSON.parse(r.body).harnessRefusal, "not-simulated", "…with the reason named");
}
{
  await seed("tkt_halflive", { ticketSim: true, threadSim: false });
  const r = await invoke("confirmCoderTicket", { ticketId: "tkt_halflive", decision: "confirm" });
  eq(JSON.parse(r.body).harnessRefusal, "not-simulated", "a simulated TICKET on a live THREAD is refused too — both rows must say so");
}
{
  await seed("tkt_nothread", { thread: false });
  const r = await invoke("confirmCoderTicket", { ticketId: "tkt_nothread", decision: "confirm" });
  eq(JSON.parse(r.body).harnessRefusal, "not-simulated", "a MISSING thread row is refused — unknown is not a licence");
}
{
  const r = await invoke("confirmCoderTicket", { ticketId: "tkt_does_not_exist", decision: "confirm" });
  eq(r.statusCode, 400, "an unreadable ticket is refused");
  eq(JSON.parse(r.body).harnessRefusal, "ticket-unreadable", "…with its own reason");
}

/* ═══ 4. the gate and the list are still what they were ═══ */
{
  const r = await hook({ action: "invokeResolver", functionKey: "startCoderTurn", payload: {}, accountId: OWNER }, "Bearer wrong-secret");
  eq(r.statusCode, 404, "the Coder doors stay behind HARNESS_SECRET");
  const w = await invoke("saveGitConnection", {});
  eq(w.statusCode, 400, "the allow-list is still a LIST — the credential writers stay out");
  ok(/not allowlisted/.test(JSON.parse(w.body).error), "…and says so");
  for (const key of ["setupGitPipeline", "triggerGitDeploy", "rotateGitCredential", "deleteGitConnection"]) {
    const out = await invoke(key, {});
    eq(out.statusCode, 400, `${key} is still refused`);
  }
}

if (previousSecret === undefined) delete process.env.HARNESS_SECRET;
else process.env.HARNESS_SECRET = previousSecret;

console.log(`\ncoder hook simulation: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
