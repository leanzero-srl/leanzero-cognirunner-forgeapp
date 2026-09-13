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
for (const fn of ["getAppAdmins", "getListeners", "getScheduledJobs", "getLogs"]) {
  const out = await captureWarn(() => handler(
    { call: { functionKey: fn, payload: {} }, context: {} }, { principal: { accountId: USER } }));
  assert.equal(out[0].success, false, `${fn} must refuse an unverifiable caller (fail closed)`);
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

console.log("permission bootstrap: 11 cases passed (non-admin refused, admin seeded, group fallback, anonymous denied, F-230 unknown vs no-role, gates still closed, F-227 anonymous getConfigs refused)");
