/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * F-850 — THE TWO TEST DOORS AND THE RUN ANSWER THE SAME THING.
 *
 * `POST ?resource=listeners&id=…&action=test` called `listeners.testListener` with NO
 * `gateFacts`, while the resolver's `testListener` (src/index.js) passed them. The run
 * site then built no gate context at all and `normalizeAllowedActions` fell to its
 * arity-1 restrictive default, so a REST test of an ADMIN-armed listener reported
 * `commit_files` gone — a rule that cannot do what its own queued delivery (F-842) now
 * does. F-302's rule is that a test must never disagree with the run, and a test that
 * disagrees with the OTHER test door breaks it twice.
 *
 * The property asserted here is an IDENTITY, not three separate expectations: the
 * allowed/refused sets the agent is handed must be byte-identical across
 *   1. the resolver test door       (src/index.js `testListener`)
 *   2. the REST test door           (src/rules-api.js `action=test`)
 *   3. the QUEUED run               (src/async-handler.js `executeQueuedListener`)
 * for ONE saved row. Every set is read off the gate the RUN handed `runAgentTask`,
 * through the SHIPPED predicate — nothing about capability is re-implemented here.
 *
 * Everything goes through the REAL `rulesApiHandler`, the REAL resolver `handler`, the
 * REAL `src/listeners.js` and the REAL `agentGateFacts`; only the platform (KVS, Jira,
 * the model) is mocked. The queued arm executes the SOURCE of the async wrapper, exactly
 * as rules-runtime-regression.test.mjs does, because src/async-handler.js cannot be
 * imported offline.
 *
 * Run: node --import ./lib/register-mocks.mjs scripts/rules-api-gate-freshness.test.mjs
 * (auto-discovered by run-offline.mjs, which supplies the loader.)
 */

import "../lib/register-mocks-index.mjs";
import { register } from "node:module";
import { readFileSync } from "node:fs";
import storage from "../lib/mock-kvs.mjs";

// The agent runner is the OBSERVATION POINT: it is the last thing that sees the gate the
// run built, which is precisely what the three doors must agree on. Stubbed only for
// src/listeners.js, so index.js keeps the real module and nothing else is displaced.
register("data:text/javascript," + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (String(ctx.parentURL || "").endsWith("/src/listeners.js") && spec === "./agent-runner.js") {
    return { url: "cogni-f850:agent", shortCircuit: true };
  }
  return next(spec, ctx);
}
export async function load(url, ctx, next) {
  if (url === "cogni-f850:agent") return { format: "module", shortCircuit: true, source:
    "export const runAgentTask = async (args) => globalThis.__f850.agent(args);"
    + "export const evaluateAiCondition = async () => ({ match: true, reason: 'matched' });" };
  return next(url, ctx);
}`));

const { default: forgeApi } = await import("@forge/api");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const ADMIN = "acct-admin";
const UPDATE = "avi:jira:updated:issue";
const ISSUE = {
  id: "200", key: "LZPT-2",
  fields: { summary: "Selected issue", project: { id: "10", key: "LZPT" }, issuetype: { id: "2", name: "Bug" } },
};
// One capability-gated action next to two plain Jira ones, so "the gate refused it" can
// never be confused with "the rule held nothing".
const ACTIONS = ["get_issue", "add_comment", "commit_files"];

forgeApi.__respond((path) => {
  const p = String(path);
  if (p.startsWith("/rest/api/3/issue/")) return forgeApi.__response(200, ISSUE);
  if (p.startsWith("/rest/api/3/search/jql")) return forgeApi.__response(200, { issues: [ISSUE] });
  if (p.startsWith("/rest/api/3/project/")) return forgeApi.__response(200, { key: "LZPT" });
  return forgeApi.__response(200, {});
});

// A BYOK provider on Standard: `commit_files` is genuinely ALLOWED for an admin-saved
// rule here, which is what makes the arity-1 default visible as a LOSS rather than as a
// capability the instance never had.
await storage.set("COGNIRUNNER_AI_PROVIDER", "openai");
await storage.set("app_admins", [{ accountId: ADMIN, role: "admin", scope: "all" }]);

const { createApiTokenInternal, rulesApiHandler } = await import("../../src/rules-api.js");
const { handler, agentGateFacts } = await import("../../src/index.js");
const L = await import("../../src/listeners.js");
const { buildAgentGateContext, normalizeAllowedActions } = await import("../../src/shared/agent-actions.js");

const adminToken = (await createApiTokenInternal({ name: "admin", accountId: ADMIN, role: "admin" })).token;

const resolverCall = (functionKey, payload = {}, accountId = ADMIN) =>
  handler({ call: { functionKey, payload }, context: {} }, { principal: { accountId } });

const rest = async ({ method = "POST", query = {}, body } = {}) => {
  const res = await rulesApiHandler({
    method,
    headers: { authorization: `Bearer ${adminToken}` },
    queryParameters: Object.fromEntries(Object.entries({ resource: "listeners", ...query }).map(([k, v]) => [k, [String(v)]])),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.statusCode, body: JSON.parse(res.body) };
};

// The verdict is read off the gate the run handed the agent, through the SHIPPED
// predicate — exactly what src/agent-runner.js does with it. `gate === undefined` is the
// defect's own signature: no context at all, hence the arity-1 restrictive default.
const verdictOf = (args) => (args.gate === undefined
  ? { allowed: normalizeAllowedActions(args.allowedActions), refused: [{ id: "(arity-1 default)", reason: "no-gate-context" }] }
  : normalizeAllowedActions(args.allowedActions, args.gate));

const capture = async (fn) => {
  const calls = [];
  globalThis.__f850 = { agent: (args) => { calls.push(args); return { success: true, outcome: "finished", summary: "simulated", changes: [], logs: [] }; } };
  const out = await fn();
  return { calls, out };
};

/* ═════ the ONE row: an agent listener an ADMIN armed with a git action ═════ */

const saved = await resolverCall("saveListener", {
  listener: {
    name: "F-850 parity", events: [UPDATE], enabled: true, mode: "agent",
    agent: { instructions: "go", allowedActions: ACTIONS },
  },
});
ok(saved.success === true && saved.listener && saved.listener.savedByRole === "admin",
  `the row is saved by an ADMIN and keeps its git action (got ${JSON.stringify(saved).slice(0, 220)})`);
const listenerId = saved.listener && saved.listener.id;
ok(Array.isArray(saved.listener && saved.listener.agent.allowedActions) && saved.listener.agent.allowedActions.includes("commit_files"),
  "…and the save door did not strip `commit_files` — the gate is the RUN's question here, not the save's");

/* ── 1. the resolver test door ── */
const viaResolver = await capture(() => resolverCall("testListener", { id: listenerId, issueKey: ISSUE.key, eventType: UPDATE }));
ok(viaResolver.out.success === true && viaResolver.calls.length === 1,
  `the resolver test door runs the agent once (got ${JSON.stringify(viaResolver.out).slice(0, 200)})`);
const resolverVerdict = verdictOf(viaResolver.calls[0]);

/* ── 2. the REST test door ── */
const viaRest = await capture(() => rest({ query: { id: listenerId, action: "test" }, body: { issueKey: ISSUE.key, eventType: UPDATE } }));
ok(viaRest.out.status === 200 && viaRest.calls.length === 1,
  `the REST test door runs the agent once (got ${viaRest.out.status} ${JSON.stringify(viaRest.out.body).slice(0, 200)})`);
const restVerdict = verdictOf(viaRest.calls[0]);

/* ── 3. the queued run (the wrapper's own source, F-842) ── */
const asyncSource = readFileSync(new URL("../../src/async-handler.js", import.meta.url), "utf8");
const wiring = asyncSource.slice(asyncSource.indexOf("const withFreshGateFacts = async (opts)"), asyncSource.indexOf("const resolveFreshCoderGate"));
const queued = new Function("resolveFreshGateFacts", "executeListenerTask", "executeScheduledJobTask",
  `${wiring} return { executeQueuedListener, executeQueuedScheduledJob };`)(
  () => agentGateFacts(undefined, { fresh: true }), L.executeListenerTask, L.executeScheduledJobTask);
const viaQueue = await capture(() => queued.executeQueuedListener(
  { listenerId, eventType: UPDATE, event: { issue: ISSUE }, ctx: { issueKey: ISSUE.key, projectKey: "LZPT" } }, "task-f850"));
ok(viaQueue.calls.length === 1, `the queued delivery runs the agent once (got ${viaQueue.calls.length})`);
const queueVerdict = verdictOf(viaQueue.calls[0]);

/* ═════ THE IDENTITY ═════ */

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
ok(same(restVerdict, resolverVerdict),
  `F-850: the REST test door and the resolver test door allow and refuse the SAME actions (REST ${JSON.stringify(restVerdict)} vs resolver ${JSON.stringify(resolverVerdict)})`);
ok(same(restVerdict, queueVerdict),
  `F-850: …and both agree with the QUEUED run, which is the thing a test stands in for (REST ${JSON.stringify(restVerdict)} vs queue ${JSON.stringify(queueVerdict)})`);

// The SHARP end: the agreed set must be the CAPABLE one. Three doors agreeing on a
// stripped set would satisfy the identity above and still be the defect, so the content
// is asserted too — `commit_files` survives on an instance whose facts permit it.
ok(same(restVerdict, { allowed: ACTIONS, refused: [] }),
  `F-850: the agreed verdict is the CAPABLE one — the admin's git action survives a REST test (got ${JSON.stringify(restVerdict)})`);
ok(viaRest.calls[0].gate !== undefined && viaRest.calls[0].gate.savedByRole === "admin"
  && viaRest.calls[0].gate.triggerSource === "external",
  `F-850: the REST door crosses FACTS, not a context — the run builds it with triggerSource "external" and the ROW's savedByRole (got ${JSON.stringify(viaRest.calls[0].gate)})`);

// THE BAN, in the file itself: the REST test door must never call `testListener` again
// without facts. A comment naming `gateFacts` cannot satisfy this — the call is matched.
{
  const src = readFileSync(new URL("../../src/rules-api.js", import.meta.url), "utf8");
  const call = (src.match(/await L\.testListener\(\{[\s\S]*?\}\);/) || [""])[0];
  ok(/gateFacts:/.test(call), "F-850: the REST `action=test` call site passes `gateFacts` (source gate)");
  ok(/restGateFacts\(\)/.test(call),
    "F-850: …read FRESH through the file's ONE fact reader, because the run it stands in for reads fresh too");
  ok((src.match(/agentGateFacts\(/g) || []).length === 1,
    `F-850: src/rules-api.js reads the facts in exactly ONE place (got ${(src.match(/agentGateFacts\(/g) || []).length})`);
}

// F-851 — the resolver door's note used to say the threading did not exist. A stale
// comment that contradicts the wiring is how the next reader re-opens a closed defect.
{
  const idxSrc = readFileSync(new URL("../../src/index.js", import.meta.url), "utf8");
  ok(!/TODO\(F-302\): `listeners\.testListener` does not thread/.test(idxSrc),
    "F-851: the stale TODO claiming testListener drops gateFacts is gone from src/index.js");
}

console.log(`\nrules-api-gate-freshness: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
