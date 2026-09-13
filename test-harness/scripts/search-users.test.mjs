/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// F-648 — THE USER PICKER THAT BACKS A ROLE GRANT.
//
// F-648: `searchUsers` used to answer EVERY Jira-side failure with
// `{ success: true, users: [] }`, which the Permissions tab renders as "No users
// found". That is a negative that authorises action: the admin concludes the person
// is not on the site and invites a duplicate, or grants the role to a namesake a
// complete result set would have disambiguated. The resolver now fails CLOSED for
// the whole transport class, with `reason: "jira_unavailable"` kept DISTINCT from
// the admin-gate refusal (`reason: "no-permission"`, + needsRole/hint).
//
// Run: node scripts/search-users.test.mjs (auto-discovered by run-offline.mjs)

import "../lib/register-mocks-index.mjs";
import storage from "../lib/mock-kvs.mjs";
const { default: forgeApi } = await import("@forge/api");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const ADMIN = "acct-admin";
const VIEWER = "acct-viewer";

await storage.set("app_admins", [
  { accountId: ADMIN, role: "admin", scope: "all" },
  { accountId: VIEWER, role: "viewer", scope: "own" },
]);

const { handler } = await import("../../src/index.js");
const call = (functionKey, payload = {}, accountId = ADMIN) =>
  handler({ call: { functionKey, payload }, context: {} }, { principal: { accountId } });

/* ===== 1. every transport failure is a REFUSAL, never an empty success ===== */
for (const status of [403, 429, 500]) {
  forgeApi.__respond(() => forgeApi.__response(status, { errorMessages: ["nope"] }));
  const r = await call("searchUsers", { query: "mihai" });
  ok(r && r.success === false, `HTTP ${status} from the Jira user search is success:false (got ${JSON.stringify(r).slice(0, 160)})`);
  ok(r && r.reason === "jira_unavailable", `HTTP ${status} carries reason:"jira_unavailable"`);
  ok(r && typeof r.error === "string" && r.error.includes(String(status)),
    `HTTP ${status} names the status in the sentence the admin reads (got ${JSON.stringify(r && r.error)})`);
  ok(r && Array.isArray(r.users) && r.users.length === 0, `HTTP ${status} returns no users to render`);
  ok(r && r.reason !== "no-permission" && r.needsRole === undefined,
    `HTTP ${status} does NOT wear the admin-gate refusal shape (the two stay distinguishable)`);
}
{
  forgeApi.__respond(() => { throw new Error("socket hang up"); });
  const r = await call("searchUsers", { query: "mihai" });
  ok(r && r.success === false && r.reason === "jira_unavailable",
    `a THROWN search is a refusal too (got ${JSON.stringify(r).slice(0, 160)})`);
  ok(r && Array.isArray(r.users) && r.users.length === 0, "a thrown search returns no users");
  ok(r && !/socket hang up/.test(String(r.error)), "the raw transport error is not leaked to the picker");
}

/* ===== 2. the short-query branch is the ONLY legitimate empty success ===== */
{
  forgeApi.__respond(() => forgeApi.__response(200, []));
  const short = await call("searchUsers", { query: "m" });
  ok(short && short.success === true && short.users.length === 0,
    "a query under 2 chars is still a legitimate empty SUCCESS (no error copy)");
  const none = await call("searchUsers", { query: "zzzz" });
  ok(none && none.success === true && none.users.length === 0,
    "a genuine zero-match 200 stays an empty success — 'nobody matches' survives the fix");
}

/* ===== 3. the admin gate keeps its own distinct shape ===== */
{
  forgeApi.__respond(() => forgeApi.__response(200, []));
  const refused = await call("searchUsers", { query: "mihai" }, VIEWER);
  ok(refused && refused.success === false && refused.reason === "no-permission" && refused.needsRole === "admin",
    `a non-admin still gets the F-257 refusal, not the transport one (got ${JSON.stringify(refused).slice(0, 160)})`);
}

console.log(`\nsearch-users: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
