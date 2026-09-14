/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// F-648 / F-647 — THE USER PICKER THAT BACKS A ROLE GRANT.
//
// F-648: `searchUsers` used to answer EVERY Jira-side failure with
// `{ success: true, users: [] }`, which the Permissions tab renders as "No users
// found". That is a negative that authorises action: the admin concludes the person
// is not on the site and invites a duplicate, or grants the role to a namesake a
// complete result set would have disambiguated. The resolver now fails CLOSED for
// the whole transport class, with `reason: "jira_unavailable"` kept DISTINCT from
// the admin-gate refusal (`reason: "no-permission"`, + needsRole/hint).
//
// F-647 (backend half): both surfaces must be able to show the SAME discriminator,
// so `searchUsers` maps `emailAddress` through when Jira returns one (it is absent,
// not empty, when the caller may not see it) and `addAppAdmin` persists it on the
// roster row so the roster read carries it back.
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

/* ===== 4. F-647 — emailAddress rides the search row when Jira returns one ===== */
{
  forgeApi.__respond(() => forgeApi.__response(200, [
    { accountId: "8888", displayName: "Mihai Perdum", emailAddress: " mihai.a@example.com ", avatarUrls: { "24x24": "a.png" } },
    { accountId: "9999", displayName: "Mihai Perdum", avatarUrls: { "24x24": "b.png" } },
    { accountId: "7777", displayName: "Mihai Perdum", emailAddress: "" },
  ]));
  const r = await call("searchUsers", { query: "mihai" });
  ok(r.success === true && r.users.length === 3, "a 200 maps every row through");
  ok(r.users[0].emailAddress === "mihai.a@example.com", "an available email is carried (and trimmed)");
  ok(!("emailAddress" in r.users[1]), "a row Jira gave no email for OMITS the key rather than sending an empty string");
  ok(!("emailAddress" in r.users[2]), "an empty-string email is treated as absent, not as a blank discriminator");
  ok(r.users[0].accountId === "8888" && r.users[0].displayName === "Mihai Perdum" && r.users[0].avatarUrl === "a.png",
    "the pre-existing row fields are unchanged");
}

/* ===== 5. F-647 — the roster row stores the email and the roster READ carries it ===== */
{
  const added = await call("addAppAdmin", {
    accountId: "8888", displayName: "Mihai Perdum", role: "editor", scope: "own",
    emailAddress: "mihai.a@example.com",
  });
  ok(added && added.success === true, `the grant succeeds (got ${JSON.stringify(added).slice(0, 160)})`);
  const stored = (await storage.get("app_admins")).find((a) => a.accountId === "8888");
  ok(stored && stored.emailAddress === "mihai.a@example.com", "the persisted roster row keeps the discriminator");
  const roster = await call("getAppAdmins", {});
  const row = roster.admins.find((a) => a.accountId === "8888");
  ok(row && row.emailAddress === "mihai.a@example.com",
    "the roster READ hands the SAME string back, so both surfaces can show one discriminator");

  const noEmail = await call("addAppAdmin", { accountId: "9999", displayName: "Mihai Perdum", role: "viewer" });
  const stored2 = (await storage.get("app_admins")).find((a) => a.accountId === "9999");
  ok(noEmail.success === true && !("emailAddress" in stored2),
    "a grant with no email stores NO key, so the UI falls back to the account id segment");
}

/* ===== 6. F-661 — the URL this resolver puts on the wire is DERIVED from the constant ==
 *
 * `JIRA_FAULT_USER_SEARCH_PATH` called itself "THE one home of the path string" while this
 * resolver still carried its own `route` literal — so a migration of the endpoint would
 * have left the fault lever pointing at a path nobody calls, and the live door would have
 * reported "no fault" rather than "the constant is stale". String equality, here, is what
 * turns that comment into a mechanism.
 */
{
  const { JIRA_FAULT_USER_SEARCH_PATH } = await import("../../src/harness-fault.js");
  const { userSearchRoute, routeString } = await import("../../src/jira-routes.js");

  ok(routeString(userSearchRoute("mihai", { maxResults: 10 })) === `${JIRA_FAULT_USER_SEARCH_PATH}?query=mihai&maxResults=10`,
    "the builder composes the URL out of the one path constant");

  forgeApi.__reset();
  forgeApi.__respond(() => forgeApi.__response(200, []));
  await call("searchUsers", { query: "mihai" });
  const last = forgeApi.__calls[forgeApi.__calls.length - 1];
  ok(last.path === routeString(userSearchRoute("mihai", { maxResults: 10 })),
    `…and searchUsers fetches exactly that string (got ${last.path})`);
  ok(last.path.startsWith(`${JIRA_FAULT_USER_SEARCH_PATH}?`),
    "…so the fault key and the bytes on the wire cannot drift apart");
}

console.log(`\nsearch-users: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
