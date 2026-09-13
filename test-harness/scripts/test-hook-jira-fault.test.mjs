/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * F-655 — THE LIVE DOOR ONTO F-648, AND THE LEVER THAT OPENS IT.
 *
 * F-648 made `searchUsers` fail CLOSED for the whole Jira transport class: a 403/429/500
 * from `/rest/api/3/user/search` answers `{success:false, reason:"jira_unavailable"}`
 * instead of the empty success the Permissions tab renders as "No users found" — a
 * negative that authorises action (the admin concludes the person is absent and invites a
 * duplicate, or grants the role to a namesake a complete result set would have
 * disambiguated). That fix had NO live door: the hook's `invokeResolver` allow-list
 * refused the function key by name, and nothing a tester can do from outside makes Jira's
 * user search fail. Both halves are closed here.
 *
 * A lever that can break a product's Jira call is the most dangerous thing in this file,
 * so most of what this suite proves is when it must NOT work:
 *  · THE ADMIN GATE RUNS FIRST. A non-admin is refused with the F-257 shape and the fault
 *    keyspace is not read AT ALL on that path — asserted by counting KVS operations, not
 *    by reading the source, because the ordering is the finding;
 *  · IT IS INERT IN PRODUCTION. With HARNESS_SECRET absent the arming refuses, the status
 *    read answers null, the hook is 404 — and a row armed while the gate was open stops
 *    being consulted the moment it closes, which is the property that matters: a lever
 *    left armed on a build that is then promoted must not follow it;
 *  · THE PATH IS EXACT. Only `JIRA_FAULT_PATHS` is accepted — no wildcard, no prefix;
 *  · THE STATUS IS A FAILURE. 400-599 only, re-validated on the way OUT of the row, so a
 *    planted "200" can never make the consumer's `!ok` arm quietly not fire;
 *  · WITH NO ROW THE REAL FETCH RUNS — the control, on the same query, before and after.
 *
 * Run: node scripts/test-hook-jira-fault.test.mjs (auto-discovered by run-offline.mjs)
 */

import "../lib/register-mocks-index.mjs";
import storage from "../lib/mock-kvs.mjs";
const { default: forgeApi } = await import("@forge/api");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const SECRET = "harness-secret-655";
const ADMIN = "acct-admin";
const VIEWER = "acct-viewer";

const { testStateTrigger } = await import("../../src/test-hook.js");
const { handler } = await import("../../src/index.js");
const fault = await import("../../src/harness-fault.js");
const PATH = fault.JIRA_FAULT_USER_SEARCH_PATH;

await storage.set("app_admins", [
  { accountId: ADMIN, role: "admin", scope: "all" },
  { accountId: VIEWER, role: "viewer", scope: "own" },
]);

const post = async (body, { bearer = SECRET } = {}) => {
  const res = await testStateTrigger({
    method: "POST",
    headers: bearer === null ? {} : { authorization: `Bearer ${bearer}` },
    body: JSON.stringify(body),
  });
  let parsed = null; try { parsed = JSON.parse(res.body); } catch { /* text */ }
  return { status: res.statusCode, body: parsed, raw: res.body };
};
// THE DOOR: the same call a live driver makes, through the hook, with a chosen principal.
const searchViaHook = (query, accountId = ADMIN) =>
  post({ action: "invokeResolver", functionKey: "searchUsers", payload: { query }, accountId });
const arm = (extra) => post({ action: "armJiraFault", path: PATH, status: 429, ttlSeconds: 60, ...extra });
const disarm = () => post({ action: "disarmJiraFault", path: PATH });
const readLever = () => post({ action: "readJiraFault", path: PATH });

// Jira answers a real, populated 200 unless a test says otherwise, so "the fetch ran" is a
// positive answer and never an empty store.
const REAL_ROW = { accountId: "8888", displayName: "Mihai Perdum", avatarUrls: { "24x24": "a.png" } };
forgeApi.__respond(() => forgeApi.__response(200, [REAL_ROW]));

process.env.HARNESS_SECRET = SECRET;

/* ═════ 1. THE HOOK KEY IS ACCEPTED — the half of F-655 that is one string ═════ */
{
  const r = await searchViaHook("mihai");
  ok(r.status === 200, `invokeResolver searchUsers is allowlisted (got ${r.status} ${r.raw.slice(0, 120)})`);
  ok(!/functionKey not allowlisted/.test(r.raw), "…the refusal that made every F-648 check dead is gone");
  ok(r.body && r.body.success === true && r.body.users.length === 1 && r.body.users[0].accountId === "8888",
    `…and the resolver really ran, against the real fetch path (got ${r.raw.slice(0, 160)})`);
}

/* ═════ 2. THE CONTROL — with no lever armed, the real fetch runs ═════ */
{
  ok((await readLever()).body.value === null, "there really is no lever armed (the control is a real read)");
  const r = await handler({ call: { functionKey: "searchUsers", payload: { query: "mihai" } } }, { principal: { accountId: ADMIN } });
  ok(r.success === true && r.users.length === 1, `an absent fault takes the real fetch path (got ${JSON.stringify(r).slice(0, 160)})`);
}

/* ═════ 3. THE GATE ═════ */
{
  process.env.HARNESS_SECRET = "";
  ok((await arm()).status === 404, "with NO HARNESS_SECRET configured the whole hook is 404");
  const armed = await fault.armJiraFault(PATH, 429, 60);
  ok(armed && armed.ok === false && armed.reason === "harness-off", "…and the lever itself refuses harness-off even if something else calls it");
  ok((await fault.jiraFaultStatus(PATH)) === null, "…and the consuming side answers null in production");
  process.env.HARNESS_SECRET = SECRET;

  const none = await post({ action: "armJiraFault", path: PATH, status: 429 }, { bearer: null });
  ok(none.status === 404, `no bearer -> 404 (got ${none.status})`);
  const wrong = await post({ action: "armJiraFault", path: PATH, status: 429 }, { bearer: "not-the-secret" });
  ok(wrong.status === 404, `a wrong bearer -> 404 (got ${wrong.status})`);
  ok((await fault.jiraFaultStatus(PATH)) === null, "…and neither refused call armed anything");
}

/* ═════ 4. THE INPUT GUARDS — the path is EXACT, the status is a FAILURE ═════ */
{
  ok((await post({ action: "armJiraFault", path: "/rest/api/3/issue", status: 429 })).status === 400, "a path outside the allow-list is 400");
  ok((await post({ action: "armJiraFault", path: "/rest/api/3/user/search?query=x", status: 429 })).status === 400,
    "…and so is the SAME path with a query string — equality, never a prefix match");
  ok((await post({ action: "armJiraFault", path: "/rest/api/3/*", status: 429 })).status === 400, "…and a wildcard is just an unknown path");
  ok((await post({ action: "armJiraFault", path: PATH, status: 200 })).status === 400, "a status of 200 is 400 — a planted fault is a FAILURE");
  ok((await post({ action: "armJiraFault", path: PATH, status: 999 })).status === 400, "a status outside 400-599 is 400");
  ok((await post({ action: "armJiraFault", path: PATH })).status === 400, "a missing status is 400");
  ok((await fault.jiraFaultStatus(PATH)) === null, "…and none of those refusals armed anything");
  // The module refuses on its own terms too — the gate is not only in the web trigger.
  ok((await fault.armJiraFault("/rest/api/3/issue", 429, 60)).reason === "bad-path", "the lever refuses an unknown path itself");
  ok((await fault.armJiraFault(PATH, 200, 60)).reason === "bad-status", "…and a non-failure status itself");
}

/* ═════ 5. ARMED 429 → the F-648 fail-closed arm, with the status carried ═════ */
{
  const armed = await arm({ status: 429, ttlSeconds: 60 });
  ok(armed.status === 200 && armed.body.status === 429 && armed.body.ttlSeconds === 60,
    `arming answers the status and the effective TTL (got ${armed.raw.slice(0, 160)})`);
  ok(typeof armed.body.key === "string" && armed.body.key.startsWith("harness_fault:jira:"),
    `…on the fault keyspace, from harnessFaultKey (got ${armed.body.key})`);

  const r = await handler({ call: { functionKey: "searchUsers", payload: { query: "mihai" } } }, { principal: { accountId: ADMIN } });
  ok(r.success === false, `a 429 at the user search is a REFUSAL, not an empty success (got ${JSON.stringify(r).slice(0, 200)})`);
  ok(r.reason === "jira_unavailable", "…carrying the F-648 reason, distinct from the admin-gate one");
  ok(r.status === 429, `…and the status the admin's sentence is built from (got ${r.status})`);
  ok(typeof r.error === "string" && r.error.includes("429"), "…named in the copy the picker renders");
  ok(Array.isArray(r.users) && r.users.length === 0, "…with no users to render");
  ok(r.needsRole === undefined && r.reason !== "no-permission", "…and NOT wearing the admin-gate refusal shape");

  // Through the hook, which is what a live driver actually holds.
  const viaHook = await searchViaHook("mihai");
  ok(viaHook.status === 200 && viaHook.body.success === false && viaHook.body.status === 429,
    `the same answer arrives through the hook (got ${viaHook.raw.slice(0, 160)})`);

  // NON-CONSUMING: the window bounds it, not a count. The tab searches on every keystroke.
  const again = await handler({ call: { functionKey: "searchUsers", payload: { query: "mihai" } } }, { principal: { accountId: ADMIN } });
  ok(again.success === false && again.status === 429, "a SECOND search still fails — the lever is a window, not a one-shot");
  ok((await readLever()).body.value.status === 429, "…the row is still armed after two searches");
}

/* ═════ 6. THE ADMIN GATE RUNS FIRST — asserted by COUNTING, not by reading ═════ */
{
  // The lever is still armed from block 5. A non-admin must be refused by the app's own
  // gate BEFORE anything touches the fault keyspace: the ordering is the finding, so it is
  // measured rather than eyeballed.
  const real = { get: storage.get, set: storage.set, delete: storage.delete };
  const touched = [];
  const spy = (name) => async function counting(k, ...rest) {
    if (String(k).startsWith("harness_fault:")) touched.push(`${name} ${k}`);
    return real[name].call(this, k, ...rest);
  };
  storage.get = spy("get"); storage.set = spy("set"); storage.delete = spy("delete");
  const refused = await handler({ call: { functionKey: "searchUsers", payload: { query: "mihai" } } }, { principal: { accountId: VIEWER } });
  const nonAdminOps = touched.length;
  touched.length = 0;
  const admin = await handler({ call: { functionKey: "searchUsers", payload: { query: "mihai" } } }, { principal: { accountId: ADMIN } });
  const adminOps = touched.length;
  storage.get = real.get; storage.set = real.set; storage.delete = real.delete;

  ok(refused.success === false && refused.reason === "no-permission" && refused.needsRole === "admin",
    `a non-admin gets the F-257 refusal (got ${JSON.stringify(refused).slice(0, 160)})`);
  ok(refused.status === undefined && refused.reason !== "jira_unavailable",
    "…and NOT the transport refusal — the armed 429 did not leak into the gate's answer");
  ok(nonAdminOps === 0, `…with ZERO reads of the fault keyspace: the gate ran first (got ${JSON.stringify(touched)} / ${nonAdminOps})`);
  ok(adminOps > 0 && admin.status === 429,
    `(sanity) the SAME armed lever IS consulted for an admin — the zero above is the ordering, not a dead spy (ops=${adminOps})`);
  // The same ordering through the hook, which can choose the principal.
  const hookRefused = await searchViaHook("mihai", VIEWER);
  ok(hookRefused.body.reason === "no-permission", "…and the hook, driving a non-admin principal, gets the same refusal");
}

/* ═════ 7. IT IS INERT THE MOMENT THE GATE CLOSES ═════ */
{
  process.env.HARNESS_SECRET = "";
  const r = await handler({ call: { functionKey: "searchUsers", payload: { query: "mihai" } } }, { principal: { accountId: ADMIN } });
  ok(r.success === true && r.users.length === 1,
    `with the row STILL ARMED but HARNESS_SECRET absent, the real fetch runs again (got ${JSON.stringify(r).slice(0, 160)})`);
  process.env.HARNESS_SECRET = SECRET;
  const back = await handler({ call: { functionKey: "searchUsers", payload: { query: "mihai" } } }, { principal: { accountId: ADMIN } });
  ok(back.success === false && back.status === 429, "…and the same row bites again when the gate reopens — it was the gate, not an expiry");
}

/* ═════ 8. THE TTL CLAMP ═════ */
{
  await disarm();
  const huge = await arm({ ttlSeconds: 99999 });
  ok(huge.body.ttlSeconds === fault.HARNESS_JIRA_FAULT_MAX_TTL_SECONDS,
    `a TTL above the cap is clamped to ${fault.HARNESS_JIRA_FAULT_MAX_TTL_SECONDS}s (got ${huge.body.ttlSeconds})`);
  ok(fault.HARNESS_JIRA_FAULT_MAX_TTL_SECONDS <= 300, "…and the cap is the five minutes the family agreed on");
  await disarm();
  const tiny = await arm({ ttlSeconds: 0 });
  ok(tiny.body.ttlSeconds >= 1, `a TTL of zero is clamped up, never to "forever" (got ${tiny.body.ttlSeconds})`);
  await disarm();
  const noTtl = await post({ action: "armJiraFault", path: PATH, status: 500 });
  ok(noTtl.body.ttlSeconds === fault.HARNESS_JIRA_FAULT_MAX_TTL_SECONDS, "an absent TTL defaults to the cap, not to unbounded");
  ok(noTtl.body.status === 500, "…and any other failure status rides through (500 here, not just 429)");
}

/* ═════ 9. A ROW IS DATA — a planted 200 is not a licence ═════ */
{
  await disarm();
  // Straight into the keyspace, past the arming guard, the way an expired-then-rewritten
  // or hand-edited row would arrive. The consumer re-validates on the way out.
  await storage.set(fault.harnessFaultKey(fault.HARNESS_FAULT_JIRA, PATH), { status: 200, armedAt: new Date().toISOString() });
  ok((await fault.jiraFaultStatus(PATH)) === null, "a row carrying a 200 is read as NO fault — the status is re-validated on the way out");
  const r = await handler({ call: { functionKey: "searchUsers", payload: { query: "mihai" } } }, { principal: { accountId: ADMIN } });
  ok(r.success === true && r.users.length === 1, "…so the real fetch runs, rather than a synthetic `ok:false` with a success status");
  await disarm();
}

/* ═════ 10. DISARM (the expired-row case), AND THE CONTROL AGAIN ═════ */
{
  await arm({ status: 503, ttlSeconds: 60 });
  ok((await handler({ call: { functionKey: "searchUsers", payload: { query: "mihai" } } }, { principal: { accountId: ADMIN } })).status === 503,
    "(fixture) the lever is armed and biting");
  const d = await disarm();
  ok(d.status === 200 && d.body.disarmed === true, "disarm removes the lever and says so");
  ok((await readLever()).body.value === null, "…the row is gone, which is the state an EXPIRED row reaches on its own");
  const r = await handler({ call: { functionKey: "searchUsers", payload: { query: "mihai" } } }, { principal: { accountId: ADMIN } });
  ok(r.success === true && r.users.length === 1 && r.users[0].accountId === "8888",
    `…and the same search that failed above now takes the real fetch path (got ${JSON.stringify(r).slice(0, 160)})`);
}

console.log(`test-hook-jira-fault (F-655): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
