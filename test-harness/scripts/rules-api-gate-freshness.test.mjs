/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * F-819 — THE REST DOOR READS THE INSTANCE'S FACTS FRESH, LIKE THE TAB'S DOOR.
 *
 * `restGateContext` (src/rules-api.js) is the REST skin over the SAME save doors the
 * resolvers expose, and it read `agentGateFacts(null)` MEMOISED while F-811 had just
 * made `saveListener` / `testListener` / `saveScheduledJob` `{fresh:true}`. One capability
 * question, two doors, one of them 30 s behind the instance.
 *
 * THE SHAPE, reproduced here end to end: the provider memo still holds `managed` after
 * the provider row is deleted (`_cachedProvider` is cleared only in the container that
 * served `saveProvider`), so the stale facts describe an instance that no longer exists
 * while the fresh ones say `atlassian` + Haiku.
 *
 * WHICH DIRECTION THE SPLIT RUNS DEPENDS ON WHAT THE MEMO HAPPENS TO HOLD, and BOTH are
 * defects. Against the pre-fix file this suite fails three assertions, the sharp one
 * being the PERMISSIVE-to-RESTRICTIVE direction: with a BYOK row on the instance, the
 * stale `managed` memo (no managed key in this harness) made the REST door refuse
 * `managed-key-missing` a git action the tab's own save door ACCEPTS — a rule that is
 * legitimately editable in the UI and permanently 400 over REST, which is F-480's defect
 * one door down. On staging the memo ran the other way (permissive), and the refusal
 * reason under the stale memo differs from the real one either way, which the
 * `refused[].reason` assertion below catches.
 *
 * THE PROPERTY IS AGREEMENT, exactly as in agent-capability-seams.test.mjs: the REST
 * door and the resolver door must give the SAME verdict and the SAME reason for the same
 * body on the same instance — and the reason this instance earns is asserted too, so
 * "they agree because both broke open" cannot pass.
 *
 * ONE PROCESS ON PURPOSE. The 30 s memo has no test seam, but this suite does not need
 * to flip it: it primes it ONCE with `managed` and then deletes the row underneath, which
 * is the staging shape. Both doors are asked afterwards, against that one stale memo.
 *
 * Auto-discovered by run-offline.mjs (test:offline), which supplies the loader.
 * Run alone: node --import ./lib/register-mocks.mjs scripts/rules-api-gate-freshness.test.mjs
 */

import "../lib/register-mocks-index.mjs";
import storage from "../lib/mock-kvs.mjs";
const { default: forgeApi } = await import("@forge/api");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const eq = (a, b, m) => ok(a === b, `${m} (got ${JSON.stringify(a)}, expected ${JSON.stringify(b)})`);

const ADMIN = "acct-admin";

forgeApi.__respond(() => forgeApi.__response(200, {}));

// A Coder-edition instance, so nothing but the PROVIDER facts can decide the git
// capability here — that is the fact this finding is about.
await storage.set("COGNIRUNNER_EDITION_SNAPSHOT", { active: true, edition: "advanced", at: new Date().toISOString() });
await storage.set("COGNIRUNNER_SEAT_SNAPSHOT", { seats: 10, at: new Date().toISOString() });
await storage.set("app_admins", [{ accountId: ADMIN, role: "admin", scope: "all" }]);

// THE PRIME: a real `managed` row, read through the resolver that resolves the ACTIVE
// provider's model — which goes through `getProviderConfig()` and stamps the 30 s memo.
await storage.set("COGNIRUNNER_AI_PROVIDER", "managed");
const { handler, readProviderConfigFresh } = await import("../../src/index.js");
await handler({ call: { functionKey: "getAgentModel", payload: {} }, context: {} }, { principal: { accountId: ADMIN } });

// …and THE DELETION underneath it. From here the memo describes an instance that no
// longer exists; an absent row defaults to `atlassian`, whose default model is Haiku.
await storage.delete("COGNIRUNNER_AI_PROVIDER");
eq((await readProviderConfigFresh()).provider, "atlassian",
  "F-819: the row really is gone — a fresh read says atlassian");

const { createApiTokenInternal, rulesApiHandler } = await import("../../src/rules-api.js");
// The REST layer saves as an EDITOR (`REST_SAVED_BY_ROLE`), so the action under test is
// a git READ: a git WRITE would be refused `needs-admin` by the role arm and would tell
// us nothing about the capability arm, which is the one that rode the memo.
const token = (await createApiTokenInternal({ name: "f819", accountId: ADMIN, role: "admin" })).token;

const listenerBody = (name) => ({
  name, events: ["avi:jira:created:issue"], mode: "agent",
  agent: { instructions: "read the PR", allowedActions: ["get_pull_request"] },
});

const viaRest = async (name) => {
  const res = await rulesApiHandler({
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    queryParameters: { resource: ["listeners"] },
    body: JSON.stringify(listenerBody(name)),
  });
  return { status: res.statusCode, body: JSON.parse(res.body) };
};

const viaResolver = (name, accountId = ADMIN) =>
  handler({ call: { functionKey: "saveListener", payload: { listener: listenerBody(name) } }, context: {} },
    { principal: { accountId } });

/* ═════ THE TWO DOORS, ON THE STALE-MEMO INSTANCE ═════ */
{
  const rest = await viaRest("F-819 REST");
  const res = await viaResolver("F-819 resolver");

  const restRefused = rest.status >= 400;
  eq(restRefused, res.success === false,
    `F-819: the REST door and the resolver door agree on the VERDICT for the same body (REST ${rest.status} ${JSON.stringify(rest.body).slice(0, 200)} / resolver ${JSON.stringify(res).slice(0, 200)})`);
  eq(String(rest.body.reason || ""), String(res.reason || ""),
    "F-819: …and on the REASON");

  // The verdict this instance actually earns: no provider row, so `atlassian` + Haiku,
  // so the git capability is off for want of a frontier agent model.
  eq(rest.status, 400, "F-819: the REST save of a git action is REFUSED on an atlassian+Haiku instance");
  eq(rest.body.reason, "action-not-allowed", "F-819: …in the ONE refusal shape");
  ok(Array.isArray(rest.body.refused) && rest.body.refused[0] && rest.body.refused[0].reason === "needs-frontier-model",
    `F-819: …naming the real cause the tab names (got ${JSON.stringify(rest.body.refused)})`);
  ok(res.success === false && Array.isArray(res.refused) && res.refused[0].reason === "needs-frontier-model",
    `F-819: …and the resolver refuses it the same way (got ${JSON.stringify(res).slice(0, 220)})`);
}

/* ═════ THE OTHER DIRECTION: a fresh read must still ALLOW a capable instance ═════
 *
 * `{fresh:true}` must not have turned the REST door into a door that refuses everything.
 * Put a BYOK provider row back — `agentCapability` answers `byok` for any non-Atlassian
 * provider — and the same body must now be ACCEPTED at both doors. This is the assertion
 * that would fail if the cut had simply broken the fact read.
 */
{
  await storage.set("COGNIRUNNER_AI_PROVIDER", "openai");
  await storage.set("COGNIRUNNER_OPENAI_KEY", "sk-test-key");
  const rest = await viaRest("F-819 REST byok");
  const res = await viaResolver("F-819 resolver byok");
  eq(rest.status, 201, `F-819: a BYOK instance ACCEPTS the same git read over REST (got ${JSON.stringify(rest.body).slice(0, 200)})`);
  ok(rest.body.listener && Array.isArray(rest.body.listener.agent.allowedActions)
    && rest.body.listener.agent.allowedActions.includes("get_pull_request"),
    "F-819: …and the action survives normalisation rather than being silently stripped");
  ok(res.success === true, `F-819: …and the resolver door agrees (got ${JSON.stringify(res).slice(0, 200)})`);
}

console.log(`rules-api gate freshness (F-819): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
