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

console.log("permission bootstrap: 4 cases passed (non-admin refused, admin seeded, group fallback, anonymous denied)");
