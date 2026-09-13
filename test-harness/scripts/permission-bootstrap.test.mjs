/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import "../lib/register-mocks-index.mjs";
import assert from "node:assert/strict";
import storage from "../lib/mock-kvs.mjs";
const { default: forgeApi } = await import("@forge/api");
const { handler } = await import("../../src/index.js");

// The first caller on an EMPTY roster used to be persisted as { role: "admin",
// scope: "all" } without ever asking Jira — any licensed user who opened the app
// first became its administrator (F-220). And checkIsAdmin answered isAdmin:true
// with no accountId at all on an empty roster (F-221). Both are proved here
// against a scripted Jira: the bootstrap row may only be written for a caller
// Jira confirms holds ADMINISTER (or sits in an admin group).

const ADMIN = "acct-admin";
const USER = "acct-plain";
const invoke = (accountId) =>
  handler({ call: { functionKey: "checkIsAdmin", payload: {} }, context: {} },
    accountId ? { principal: { accountId } } : {});

// Jira answers ADMINISTER only for ADMIN; the group scan finds nobody.
let currentCaller = null;
const scriptJira = ({ adminIds = [ADMIN], groupMembers = [] } = {}) => {
  forgeApi.__respond((path) => {
    if (path.includes("mypermissions")) {
      // asUser() — the mock has no identity, so the test drives it explicitly.
      return forgeApi.__response(200, {
        permissions: { ADMINISTER: { havePermission: currentCaller !== null && adminIds.includes(currentCaller) } },
      });
    }
    if (path.includes("/group/member")) {
      return forgeApi.__response(200, { values: groupMembers.map((accountId) => ({ accountId })) });
    }
    return forgeApi.__response(404, { errorMessages: ["unexpected " + path] });
  });
};

const captureLogs = async (fn) => {
  const lines = [], saved = console.log;
  console.log = (...args) => lines.push(args.join(" "));
  try { return [await fn(), lines]; } finally { console.log = saved; }
};

// 1. Empty roster + NON-admin first caller → no role, and nothing written.
storage.__reset(); forgeApi.__reset();
currentCaller = USER; scriptJira();
let [res] = await captureLogs(() => invoke(USER));
assert.equal(res.isAdmin, false, "non-admin first caller must not be admin");
assert.equal(res.role, null, "non-admin first caller must have no role");
assert.equal(await storage.get("app_admins"), undefined, "refused bootstrap must not write a roster row");

// 2. Empty roster + ADMIN first caller → bootstrapped, written, and logged once.
storage.__reset(); forgeApi.__reset();
currentCaller = ADMIN; scriptJira();
let logs;
[res, logs] = await captureLogs(() => invoke(ADMIN));
assert.equal(res.isAdmin, true);
assert.equal(res.role, "admin");
assert.equal(res.scope, "all");
const roster = await storage.get("app_admins");
assert.equal(roster.length, 1);
assert.equal(roster[0].accountId, ADMIN);
assert.equal(roster[0].role, "admin");
assert.equal(logs.filter((l) => l.includes("bootstrapping")).length, 1, "the bootstrap write must log exactly one line");

// 3. Empty roster + admin only by GROUP membership (no ADMINISTER) → bootstrapped.
storage.__reset(); forgeApi.__reset();
currentCaller = USER; scriptJira({ adminIds: [], groupMembers: [USER] });
[res] = await captureLogs(() => invoke(USER));
assert.equal(res.isAdmin, true, "group-scan fallback still authorizes");
assert.equal((await storage.get("app_admins"))[0].accountId, USER);

// 4. F-221: no accountId at all → never admin, even on an empty roster.
storage.__reset(); forgeApi.__reset();
currentCaller = null; scriptJira();
[res] = await captureLogs(() => invoke(null));
assert.equal(res.isAdmin, false, "checkIsAdmin cannot know who is asking without an accountId");
assert.equal(res.role, null);
assert.equal(res.scope, null);
assert.equal(res.accountId, null);
assert.equal(await storage.get("app_admins"), undefined, "an anonymous call must not write a roster row");

// ── F-230: role null has two meanings, and only one of them is "you have no role".
const captureWarn = async (fn) => {
  const lines = [], saved = console.warn;
  console.warn = (...args) => lines.push(args.join(" "));
  try { return [await fn(), lines]; } finally { console.warn = saved; }
};

// 5. Informed NO: roster reads fine and empty, Jira answers "not an admin".
//    No `unknown` marker — the UI is right to say "you have no role".
storage.__reset(); forgeApi.__reset();
currentCaller = USER; scriptJira({ adminIds: [], groupMembers: [] });
[res] = await captureLogs(() => invoke(USER));
assert.equal(res.role, null);
assert.equal(res.unknown, undefined, "an ANSWERED no must not be marked unknown");

// 6. Jira fault on BOTH arms (probe throws, every group read throws) → unknown:true,
//    forwarded by checkIsAdmin, and still not admin.
storage.__reset(); forgeApi.__reset();
storage.__seed("app_admins", [{ accountId: ADMIN, role: "admin", scope: "all" }]);
forgeApi.__respond(() => { throw new Error("Jira 503"); });
let warns;
[res, warns] = await captureWarn(() => invoke(USER));
assert.equal(res.isAdmin, false, "an unverifiable caller is NOT admin — fail closed");
assert.equal(res.role, null);
assert.equal(res.unknown, true, "both authorization arms faulted → unknown");
assert.match(res.reason, /Jira could not confirm/);
assert.match(res.reason, /503/, "the reason must name the underlying fault");
assert.equal(warns.filter((l) => l.includes("unknown role")).length, 1);

// 7. Probe faults but the GROUP SCAN answers (200, caller absent) → an informed no.
storage.__reset(); forgeApi.__reset();
forgeApi.__respond((path) => (path.includes("mypermissions")
  ? forgeApi.__response(500, { errorMessages: ["boom"] })
  : forgeApi.__response(200, { values: [] })));
[res] = await captureWarn(() => invoke(USER));
assert.equal(res.role, null);
assert.equal(res.unknown, undefined, "one arm answering is enough to know the caller is not an admin");

// 8. The ROSTER read faults → unknown even though Jira answers cleanly.
storage.__reset(); forgeApi.__reset();
currentCaller = USER; scriptJira({ adminIds: [], groupMembers: [] });
storage.__failNextGet();
[res] = await captureWarn(() => invoke(USER));
assert.equal(res.role, null);
assert.equal(res.unknown, true, "an unreadable roster cannot produce a confident 'no role'");
assert.match(res.reason, /role store unavailable/);

// 9. A faulted lookup authorizes NOTHING: the gated resolvers still refuse.
storage.__reset(); forgeApi.__reset();
storage.__seed("app_admins", [{ accountId: ADMIN, role: "admin", scope: "all" }]);
forgeApi.__respond(() => { throw new Error("Jira 503"); });
for (const fn of ["getAppAdmins", "getListeners", "getScheduledJobs", "getLogs", "getMemories", "getMemorySettings"]) {
  const out = await captureWarn(() => handler(
    { call: { functionKey: fn, payload: {} }, context: {} }, { principal: { accountId: USER } }));
  assert.equal(out[0].success, false, `${fn} must refuse an unverifiable caller (fail closed)`);
  // F-240: the refusal text is the fixed sentence — never the F-230 `reason`, which
  // interpolates the raw KVS/Jira fault. getLogs was the one gate that leaked it.
  assert.doesNotMatch(String(out[0].error), /Jira 503|role store unavailable|HTTP \d|could not confirm/,
    `${fn} must not hand the fault text to the caller it is refusing (got: ${out[0].error})`);
}

// ── F-227: getConfigs ran the app-privileged orphan sweep for a caller it could
// not identify, because the gate read `if (accountId && !perms)`.
storage.__reset(); forgeApi.__reset();
storage.__seed("config_registry", [{ id: "r1", type: "validator", createdBy: ADMIN, workflow: { workflowName: "WF", transitionId: "11" } }]);
scriptJira();
let anon = await handler({ call: { functionKey: "getConfigs", payload: {} }, context: {} }, {});
assert.equal(anon.success, false, "an anonymous getConfigs must be refused");
assert.match(anon.error, /Viewer access required/);
assert.deepEqual(anon.configs, []);
assert.equal(forgeApi.__calls.filter((c) => c.path.includes("workflow")).length, 0,
  "the app-privileged orphan sweep must not run for an anonymous caller");
assert.deepEqual(await storage.get("config_registry"),
  [{ id: "r1", type: "validator", createdBy: ADMIN, workflow: { workflowName: "WF", transitionId: "11" } }],
  "a refused call must not delete registry rows");

// A roleless but IDENTIFIED caller still gets the restricted (not refused) shape,
// and still no sweep — that arm is unchanged.
storage.__reset(); forgeApi.__reset();
storage.__seed("config_registry", [{ id: "r1", type: "validator", workflow: { workflowName: "WF", transitionId: "11" } }]);
storage.__seed("app_admins", [{ accountId: ADMIN, role: "admin", scope: "all" }]);
currentCaller = USER; scriptJira({ adminIds: [], groupMembers: [] });
const restricted = await handler({ call: { functionKey: "getConfigs", payload: {} }, context: {} }, { principal: { accountId: USER } });
assert.equal(restricted.success, true);
assert.equal(restricted.restricted, true);
assert.deepEqual(restricted.configs, []);
assert.equal(forgeApi.__calls.filter((c) => c.path.includes("workflow")).length, 0);

// ── F-235: the four KNOWLEDGE READS carry the same viewer floor as the memory
// reads. getKnowledgeCounts in particular reports the memory count, the cap and the
// storeFull marker — exactly what getMemoryStoreStats was gated to withhold.
storage.__reset(); forgeApi.__reset();
storage.__seed("app_admins", [{ accountId: ADMIN, role: "admin", scope: "all" }]);
storage.__seed("pf_memories", [{ id: "m1", content: "a learned fact", source: "user", disabled: false }]);
currentCaller = USER; scriptJira({ adminIds: [], groupMembers: [] });
for (const fn of ["getKnowledgeCounts", "getSkills", "getSkillContent", "getContextDocs"]) {
  const anonOut = await handler({ call: { functionKey: fn, payload: { id: "builtin_skill_transitions" } }, context: {} }, {});
  assert.equal(anonOut.success, false, `${fn} must refuse an anonymous caller`);
  const roleless = await handler({ call: { functionKey: fn, payload: { id: "builtin_skill_transitions" } }, context: {} }, { principal: { accountId: USER } });
  assert.equal(roleless.success, false, `${fn} must refuse a caller with no role`);
  assert.match(roleless.error, /don't have permission/);
  assert.ok(!roleless.memories, `${fn} must not leak the memory count to a refused caller`);
  assert.equal(roleless.memoryCap, undefined, `${fn} must not leak the memory cap to a refused caller`);
}

// ── F-251: the bootstrap WRITE belongs to the admin panel's own mount call and
// nowhere else. `getUserPermissions` takes `{ allowBootstrap }` (default FALSE);
// only `checkIsAdmin` passes true. A Jira admin reaching a GATED resolver through
// the workflow editor on an empty roster is therefore resolved READ-ONLY: no role,
// refusal, and not one byte written to `app_admins`.
for (const fn of ["getContextDocs", "getSkills", "getMemories", "getKnowledgeCounts", "getLogs", "getConfigs"]) {
  storage.__reset(); forgeApi.__reset();
  // Jira confirms this caller IS an administrator — the only thing standing between
  // them and a roster row is the call site.
  currentCaller = ADMIN; scriptJira({ adminIds: [ADMIN] });
  const [out, seedLogs] = await captureLogs(() =>
    handler({ call: { functionKey: fn, payload: {} }, context: {} }, { principal: { accountId: ADMIN } }));
  assert.equal(await storage.get("app_admins"), undefined,
    `${fn} must not seed the first admin row — the bootstrap is checkIsAdmin's alone`);
  assert.equal(seedLogs.filter((l) => l.includes("bootstrapping")).length, 0,
    `${fn} must not even attempt the bootstrap write`);
  // The CALL still answers — this caller is a Jira site admin, which authorizes
  // them for the duration of the request. What must not happen is the PERSISTED
  // grant: a durable app-admin row created by a surface that never mentions roles.
  assert.equal(out.success, true, `${fn} still authorizes a Jira site admin in-request`);

  // And a caller Jira says is NOT an admin is refused, with nothing written.
  storage.__reset(); forgeApi.__reset();
  currentCaller = USER; scriptJira({ adminIds: [], groupMembers: [] });
  const roleless = await handler({ call: { functionKey: fn, payload: {} }, context: {} }, { principal: { accountId: USER } });
  if (fn === "getConfigs") assert.deepEqual(roleless.configs, [], "getConfigs returns nothing to a role-less caller");
  else assert.equal(roleless.success, false, `${fn} must refuse a caller with no role`);
  assert.equal(await storage.get("app_admins"), undefined, `${fn} refusal must write no roster row`);
}

// The same admin then opens Apps → CogniRunner: THAT call seeds the roster.
storage.__reset(); forgeApi.__reset();
currentCaller = ADMIN; scriptJira({ adminIds: [ADMIN] });
await handler({ call: { functionKey: "getSkills", payload: {} }, context: {} }, { principal: { accountId: ADMIN } });
assert.equal(await storage.get("app_admins"), undefined, "the workflow-editor surface leaves the roster empty");
[res] = await captureLogs(() => invoke(ADMIN));
assert.equal(res.isAdmin, true, "checkIsAdmin is the surface that bootstraps");
assert.equal(((await storage.get("app_admins")) || []).length, 1, "and it writes exactly one row");
// And the role now comes from the ROSTER, not from a Jira round trip: the same
// gated call answers with Jira scripted to deny ADMINISTER outright.
scriptJira({ adminIds: [], groupMembers: [] });
const gatedAfter = await handler({ call: { functionKey: "getSkills", payload: {} }, context: {} }, { principal: { accountId: ADMIN } });
assert.equal(gatedAfter.success, true, "once rostered, the role no longer depends on Jira");

// ── F-229: two first admins bootstrapping AT THE SAME TIME must both survive.
// The old code captured "roster is empty" before four network calls and then blindly
// set the whole key to a one-element array, so the second writer erased the first.
const ADMIN2 = "acct-admin-two";
storage.__reset(); forgeApi.__reset();
forgeApi.__respond((path) => (path.includes("mypermissions")
  // Both callers are real Jira admins. The mock has no identity on asUser(), so
  // ADMINISTER is true for whoever is asking — which is the concurrent case.
  ? forgeApi.__response(200, { permissions: { ADMINISTER: { havePermission: true } } })
  : forgeApi.__response(200, { values: [] })));
const [r1, r2] = await captureLogs(() => Promise.all([invoke(ADMIN), invoke(ADMIN2)])).then(([v]) => v);
assert.equal(r1.isAdmin, true);
assert.equal(r2.isAdmin, true);
const bothRoster = (await storage.get("app_admins")) || [];
const ids = bothRoster.map((a) => a.accountId).sort();
assert.deepEqual(ids, [ADMIN, ADMIN2].sort(), `both concurrent bootstraps must be on the roster, got ${JSON.stringify(bothRoster)}`);
assert.ok(bothRoster.every((a) => a.role === "admin"), "both rows keep the admin role");

// And a repeat call by an already-rostered admin appends nothing.
await captureLogs(() => invoke(ADMIN));
assert.equal(((await storage.get("app_admins")) || []).length, 2, "an existing roster row is never duplicated");

console.log("permission bootstrap: 22 cases passed (non-admin refused, admin seeded, group fallback, anonymous denied, F-230 unknown vs no-role, gates still closed, F-227 anonymous getConfigs refused, F-235 knowledge reads gated, F-229 concurrent bootstrap, F-251 bootstrap is checkIsAdmin-only)");
