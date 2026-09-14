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
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import storage, { kvs, KVS_INVALID_CURSOR_CODE } from "../lib/mock-kvs.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
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

/* ═════ 8b. F-664 — THE WINDOW IS ON THE ROW, AND THE HOOK REPORTS IT ═════
 *
 * Measured live at e3a1ecb: a lever armed with ttlSeconds:5 was still biting at 615 s.
 * The option shape was never wrong — Forge KVS simply deletes expired keys lazily, so the
 * platform TTL cleans up and does not bound. The bound is `until` on the row, refused by
 * every read, and a live driver polling `readJiraFault` must be able to SEE it: a lever
 * that ended on its own is `value:null, expired:true`, one never armed is `expired:false`.
 */
{
  await disarm();
  const armed = await arm({ ttlSeconds: 30 });
  ok(typeof armed.body.until === "string" && Math.round((Date.parse(armed.body.until) - Date.now()) / 1000) === 30,
    `arming answers the row's OWN deadline, thirty seconds out (got ${armed.body.until})`);
  const live = await readLever();
  ok(live.body.value && live.body.value.until === armed.body.until && live.body.expired === false,
    "…the read action carries that deadline back, and says the lever has not passed it");

  // The state a crashed driver leaves behind: a row whose window is over, which KVS has
  // not got round to deleting. Planted straight into the keyspace, past the arming clamp.
  const key = fault.harnessFaultKey(fault.HARNESS_FAULT_JIRA, PATH);
  const stale = { status: 429, armedAt: new Date(Date.now() - 700_000).toISOString(), until: new Date(Date.now() - 1_000).toISOString() };
  await storage.set(key, stale);
  const gone = await readLever();
  ok(gone.body.value === null && gone.body.expired === true && gone.body.until === stale.until,
    `a row past its deadline reads as ABSENT and is reported expired (got ${JSON.stringify(gone.body).slice(0, 160)})`);
  ok((await storage.get(key)) === undefined, "…and the read deleted it, so nothing has to remember to disarm");

  await storage.set(key, stale);
  const r = await handler({ call: { functionKey: "searchUsers", payload: { query: "mihai" } } }, { principal: { accountId: ADMIN } });
  ok(r.success === true && r.users.length === 1,
    `…and the product search runs for real against the stale row — a dead driver stops faulting the tenant (got ${JSON.stringify(r).slice(0, 160)})`);
  const after = await readLever();
  ok(after.body.value === null && after.body.expired === false,
    "…a lever that was never armed is still distinguishable from one that expired");
  await disarm();
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

/* ═════ 11. F-661 — ONE ROUTE HOME, AND BOTH CONSUMERS BEHIND THE SAME LEVER ═════
 *
 * F-655 shipped `JIRA_FAULT_USER_SEARCH_PATH` as "THE one home of the path string" while
 * NOTHING built a fetch from it: both consumers carried their own `route` literal, so the
 * agreement was a comment. And the SECOND consumer — `resolveUserToAccountId`, on the
 * semantic-PF assignee WRITE path — never asked the lever at all, so every block above
 * proved ONE of the two call sites while reading as a proof of the endpoint.
 */
{
  const routes = await import("../../src/jira-routes.js");
  const index = await import("../../src/index.js");

  /* 11a. THE URL IS DERIVED FROM THE CONSTANT — string equality, not a code review. */
  const built = routes.routeString(routes.userSearchRoute("mihai", { maxResults: 10 }));
  ok(built === `${PATH}?query=mihai&maxResults=10`,
    `the builder composes the URL out of the constant (got ${built})`);
  ok(built.startsWith(`${PATH}?`),
    "…so a migration of the endpoint moves the constant and BOTH routes follow it");
  ok(routes.routeString(routes.userSearchRoute("x", { maxResults: 20 })) === `${PATH}?query=x&maxResults=20`,
    "…and the second consumer's page size rides the SAME builder, not a second literal");
  ok(!/route`\/rest\/api\/3\/user\/search\?/.test(
    await (await import("node:fs/promises")).readFile(new URL("../../src/index.js", import.meta.url), "utf8")),
    "…and no `route`/rest/api/3/user/search?…`` literal survives in src/index.js");

  /* 11b. BOTH consumers put that exact URL on the wire, with the lever DISARMED. */
  await disarm();
  forgeApi.__reset();
  forgeApi.__respond(() => forgeApi.__response(200, [REAL_ROW]));
  await handler({ call: { functionKey: "searchUsers", payload: { query: "mihai" } } }, { principal: { accountId: ADMIN } });
  const searchCall = forgeApi.__calls[forgeApi.__calls.length - 1];
  ok(searchCall.path === `${PATH}?query=mihai&maxResults=10`,
    `searchUsers fetches exactly the built route (got ${searchCall.path})`);
  ok(searchCall.opts === undefined || Object.keys(searchCall.opts).length === 0,
    `…with the SAME fetch arity it had before the wrapper (got ${JSON.stringify(searchCall.opts)})`);

  forgeApi.__calls.length = 0;
  const resolved = await index.resolveUserToAccountId({ query: "Mihai Perdum" });
  const resolveCall = forgeApi.__calls[forgeApi.__calls.length - 1];
  /* F-669 — THE SPACE IS ESCAPED, and this expectation used to say it was not. The mock's
     `route` was a plain concatenation, so the assertion asserted a string that can never
     be on the wire: the real tag encodeURIComponent's a query parameter. */
  ok(resolveCall.path === `${PATH}?query=Mihai%20Perdum&maxResults=20`,
    `resolveUserToAccountId fetches the SAME derived route, with the query ESCAPED (got ${resolveCall.path})`);
  ok(resolveCall.opts && resolveCall.opts.headers && resolveCall.opts.headers.Accept === "application/json",
    "…and keeps its own Accept header — the wrapper forwards options untouched");
  ok(resolved.ok === true && resolved.accountId === "8888",
    `…and with no lever it resolves for real (got ${JSON.stringify(resolved)})`);

  /* 11c. The assignable branch is a DIFFERENT endpoint and is NOT faultable. */
  forgeApi.__calls.length = 0;
  await index.resolveUserToAccountId({ query: "Mihai Perdum", issueKey: "TEST-1", assignable: true });
  ok(forgeApi.__calls[forgeApi.__calls.length - 1].path.startsWith("/rest/api/3/user/assignable/search?"),
    "the assignable branch still calls its own endpoint, unchanged");
  ok(!fault.JIRA_FAULT_PATHS.includes("/rest/api/3/user/assignable/search"),
    "…which is deliberately NOT on JIRA_FAULT_PATHS — widening that list is a decision");

  /* 11d. THE FINDING: an armed 429 reaches the SECOND consumer too. */
  await arm({ status: 429, ttlSeconds: 60 });
  const faulted = await index.resolveUserToAccountId({ query: "Mihai Perdum" });
  ok(faulted.ok === false, `an armed 429 makes the assignee lookup REFUSE (got ${JSON.stringify(faulted)})`);
  ok(/HTTP 429/.test(String(faulted.reason)),
    `…through its own pre-existing !resp.ok arm, carrying the status (got ${faulted.reason})`);
  ok(faulted.accountId === undefined,
    "…and NEVER an ok:true with nobody in it — a failed lookup must not read as a successful assignment");
  // The lever is armed for the user-search path only: the assignable branch runs for real.
  forgeApi.__calls.length = 0;
  const stillReal = await index.resolveUserToAccountId({ query: "Mihai Perdum", issueKey: "TEST-1", assignable: true });
  ok(stillReal.ok === true, "…while the assignable branch, on a path with no lever, still runs for real");
  ok(forgeApi.__calls.length === 1, "…i.e. a real fetch happened on that branch");
  // And the FIRST consumer is still faulted by the same single row — one lever, two sites.
  const bothFaulted = await handler({ call: { functionKey: "searchUsers", payload: { query: "mihai" } } }, { principal: { accountId: ADMIN } });
  ok(bothFaulted.success === false && bothFaulted.status === 429,
    "…and the SAME armed row still faults searchUsers — one lever, both consumers");

  /* 11e. HARNESS OFF → BYTE-IDENTICAL FETCH ARGS on both, with the row still armed. */
  process.env.HARNESS_SECRET = "";
  forgeApi.__calls.length = 0;
  await handler({ call: { functionKey: "searchUsers", payload: { query: "mihai" } } }, { principal: { accountId: ADMIN } });
  const offSearch = forgeApi.__calls[forgeApi.__calls.length - 1];
  const offResolveBefore = forgeApi.__calls.length;
  const offResolved = await index.resolveUserToAccountId({ query: "Mihai Perdum" });
  const offResolve = forgeApi.__calls[forgeApi.__calls.length - 1];
  process.env.HARNESS_SECRET = SECRET;

  ok(offSearch.path === searchCall.path && JSON.stringify(offSearch.opts) === JSON.stringify(searchCall.opts),
    `harness-off searchUsers issues a BYTE-IDENTICAL fetch (got ${offSearch.path} / ${JSON.stringify(offSearch.opts)})`);
  ok(offResolve.path === resolveCall.path && JSON.stringify(offResolve.opts) === JSON.stringify(resolveCall.opts),
    `harness-off resolveUserToAccountId issues a BYTE-IDENTICAL fetch (got ${offResolve.path} / ${JSON.stringify(offResolve.opts)})`);
  ok(forgeApi.__calls.length === offResolveBefore + 1 && offResolved.ok === true,
    "…and the still-armed row changed nothing once the gate closed");

  await disarm();
}

/* ═════ 12. F-667 — THE SWEEP DOOR: a crashed driver's leftovers clear in ONE call ═════
 *
 * The lever this file is about is the one that was measured still biting at 615 s, and the
 * reason it could was that nothing ever looked at the row again. F-664 bounded the READ;
 * this is the action that reaches the rows nobody will read. It sits behind the SAME Bearer
 * as every other action here and is inert without HARNESS_SECRET, and — the part that has to
 * hold — it deletes only rows whose deadline has passed.
 */
{
  await disarm();
  const legacyKey = fault.harnessFaultKey(fault.HARNESS_FAULT_GIT_DISPATCH, "gc_667", "d-crashed");
  // THE ROW F-667 IS ABOUT: armed by a build before the F-664 deploy, so no `until` at all,
  // and `armedAt` an hour ago. Planted straight into the keyspace, past the arming clamp.
  await storage.set(legacyKey, { count: 3, armedAt: new Date(Date.now() - 3_600_000).toISOString() });
  await arm({ status: 503, ttlSeconds: 120 });

  const bearerless = await post({ action: "sweepHarnessFaults" }, { bearer: null });
  ok(bearerless.status === 404, "the sweep needs the Bearer, like every other action here");
  ok((await storage.get(legacyKey)) !== undefined, "…and refusing it deleted nothing");

  const dry = await post({ action: "sweepHarnessFaults", dryRun: true });
  ok(dry.status === 200 && dry.body.ok === true && dry.body.deleted === 0 && dry.body.dryRun === true,
    `a dry run lists without deleting (got ${JSON.stringify(dry.body && { ok: dry.body.ok, deleted: dry.body.deleted })})`);
  const dryLegacy = (dry.body.rows || []).find((r) => r.key === legacyKey);
  ok(dryLegacy && dryLegacy.expired === true && dryLegacy.until === null && typeof dryLegacy.deadline === "string",
    `…and reports the legacy row as expired with no \`until\` of its own (got ${JSON.stringify(dryLegacy)})`);

  const swept = await post({ action: "sweepHarnessFaults" });
  ok(swept.status === 200 && swept.body.deleted >= 1, `the sweep deletes the expired rows (got deleted=${swept.body && swept.body.deleted})`);
  ok((await storage.get(legacyKey)) === undefined, "…the pre-deploy row is gone, on a key the caller never had to name");
  ok((await readLever()).body.value && (await readLever()).body.value.status === 503,
    "…and THE LIVE Jira lever is untouched — a sweep must never cancel a running driver's fault");
  ok((await handler({ call: { functionKey: "searchUsers", payload: { query: "mihai" } } }, { principal: { accountId: ADMIN } })).status === 503,
    "…so it still bites after the sweep");
  await disarm();

  /* F-673 — THE DOOR CARRIES THE BUDGET AND THE CURSOR. This action is a WEB TRIGGER the
   * platform kills at 25 s; before F-673 a sweep that ran long was killed holding an answer it
   * never sent, so the caller learned neither what it had deleted nor where to carry on. The
   * budget must therefore be reachable FROM THE DOOR (`maxMs`) and the resume cursor must come
   * back THROUGH the door — a bound enforced in the module but unreachable from the only caller
   * is the same defect one layer up.
   *
   * The offline mock answers instantly, which is exactly why no existing assertion could ever
   * reach a time bound — so the ENUMERATION is given latency here, and `maxMs: 1` then makes
   * the stop land deterministically after the first page is fetched and before anything is
   * deleted, rather than racing the machine's clock granularity. */
  /* F-674 — AND THE OUT-OF-BUDGET ANSWER MUST STILL HAVE MOVED. The old door test planted
   * ONE row and asserted the starved sweep "deleted nothing" — which is the F-674 defect
   * written down as an expectation: a call that lists a page, deletes nothing and hands back
   * the cursor it was given (or, on a fresh call, `null`) is a loop that never converges. So
   * the fixture plants MORE THAN ONE DELETE BATCH and the contract is the opposite one:
   * progress first, budget second, and a token that is never null while rows remain. */
  const budgetKeys = [];
  for (let i = 0; i < 15; i++) {
    const key = fault.harnessFaultKey(fault.HARNESS_FAULT_GIT_DISPATCH, "gc_673", `d-door-${i}`);
    budgetKeys.push(key);
    await storage.set(key, { count: 1, armedAt: new Date(Date.now() - 3_600_000).toISOString() });
  }
  const realQuery = kvs.query;
  kvs.query = function slowQuery(...args) {
    const q = realQuery.apply(this, args);
    const realGetMany = q.getMany;
    q.getMany = async function getManySlowly(...inner) {
      await new Promise((r) => setTimeout(r, 8));
      return realGetMany.apply(q, inner);
    };
    return q;
  };
  const starved = await post({ action: "sweepHarnessFaults", maxMs: 1 });
  kvs.query = realQuery;
  ok(starved.status === 200 && starved.body.truncated === true && starved.body.reason === "budget",
    `an out-of-budget sweep still ANSWERS 200, truncated with reason "budget" (got ${JSON.stringify(starved.body && { status: starved.status, truncated: starved.body.truncated, reason: starved.body.reason })})`);
  ok(starved.body.budgetMs === 1 && typeof starved.body.cursor === "string" && starved.body.cursor.length > 0,
    `…echoing the budget it honoured and carrying a NON-NULL resume cursor (got ${JSON.stringify({ budgetMs: starved.body.budgetMs, cursor: starved.body.cursor })})`);
  ok(starved.body.deleted > 0,
    `…and having honoured the budget only AFTER a delete batch landed, it MOVED (deleted ${starved.body.deleted})`);
  let leftAfterStarve = 0;
  for (const key of budgetKeys) if ((await storage.get(key)) !== undefined) leftAfterStarve++;
  ok(leftAfterStarve > 0, `…with rows still to do, which is what makes the resume cursor meaningful (left ${leftAfterStarve})`);

  let doorToken = starved.body.cursor, doorCalls = 0;
  while (doorToken && doorCalls < 50) {
    const r = await post({ action: "sweepHarnessFaults", cursor: doorToken });
    ok(r.status === 200, "…every resumed POST answers 200");
    doorToken = r.body.cursor;
    doorCalls++;
  }
  let leftAfterDrain = 0;
  for (const key of budgetKeys) if ((await storage.get(key)) !== undefined) leftAfterDrain++;
  ok(doorToken === null && leftAfterDrain === 0,
    `…and POSTing that cursor back to the SAME action until it answers null finishes the job (${doorCalls} calls, left ${leftAfterDrain})`);

  /* F-676 — THE ONE CALLER-CONTROLLED VALUE THIS DOOR ADDED IS VALIDATED LIKE THE REST.
   * `cursor` went straight into `storage.query().cursor(...)` behind nothing but a typeof
   * check — the only input here with no allow-list, beside siblings that check an exact path
   * and a 400-599 status range. And the POST branch has no try/catch of its own, so a KVS
   * that REJECTS a malformed or foreign token threw out of the trigger and the caller got a
   * platform 500 with no JSON body, where every other refusal on this door is a 400 with a
   * reason — a resume loop cannot tell "bad token" from "the tenant is down". */
  const badCursors = [
    ["outside the opaque-token grammar", "../../etc/passwd"],
    ["outside the grammar by one character", "abc def"],
    ["over the 2 KB ceiling", "A".repeat(2100)],
    ["whitespace, which is not a token", "   "],
    ["not a string at all", 42],
    // F-685 — the library's back-compat path accepted this verbatim while this door refused
    // it, which was two answers to one question. There is one grammar now and it says no.
    ["a legacy RAW KVS cursor, which is no longer a grammar", "harness_fault:git:x"],
    // In the grammar, but not one of our tokens: refused by the LIBRARY, before any KVS call.
    ["base64 that is not one of our tokens", "dGhpcy1pcy1ub3QteW91cnM="],
  ];
  for (const [why, value] of badCursors) {
    const r = await post({ action: "sweepHarnessFaults", cursor: value, dryRun: true });
    ok(r.status === 400 && r.body && r.body.ok === false && r.body.reason === "bad-cursor",
      `a cursor ${why} is REFUSED 400 bad-cursor, not a 500 with no body (got ${JSON.stringify({ status: r.status, body: r.body })})`);
  }
  // …and the refusal is a REFUSAL: the sweep never ran, so nothing was enumerated or deleted.
  {
    const victim = fault.harnessFaultKey(fault.HARNESS_FAULT_GIT_DISPATCH, "gc_676", "d-1");
    await storage.set(victim, { count: 1, armedAt: new Date(Date.now() - 3_600_000).toISOString() });
    const refused = await post({ action: "sweepHarnessFaults", cursor: "../../etc/passwd" });
    ok(refused.status === 400 && (await storage.get(victim)) !== undefined,
      "…and a refused cursor does no work at all — the expired row it would have swept is untouched");
    await storage.delete(victim);
  }

  /* F-684 — THE OTHER HALF: a VALID token that KVS ITSELF throws on.
   *
   * Every throw with a cursor in play was labelled `bad-cursor`, purely because a cursor had
   * been supplied — a cause the failure never carried. A resume loop mid-drain when the
   * tenant starts throttling was told its perfectly good token was bad; written to the
   * door's own grammar it would drop the token and re-sweep from the top, doubling the load
   * on the KVS already refusing it. The SAME platform fault on call 1 (no cursor) answered
   * `500 sweep-failed`: one fault, two diagnoses, chosen by call number.
   *
   * So the token here is a REAL one, and the mock is armed to refuse the KVS cursor inside
   * it — the only way to reach a throw from `getMany()` now that a malformed token is
   * refused synchronously, before any KVS call, as `bad-cursor`. */
  const liveToken = fault.encodeSweepCursor("harness_fault:git:zzz");
  kvs.__rejectCursor("harness_fault:git:zzz");
  const rejected = await post({ action: "sweepHarnessFaults", cursor: liveToken });
  kvs.__rejectCursor(null);
  ok(rejected.status === 500 && rejected.body && rejected.body.ok === false && rejected.body.reason === "sweep-failed",
    `a throw from KVS on a well-formed token is "sweep-failed", NOT the caller's cursor blamed (got ${JSON.stringify({ status: rejected.status, reason: rejected.body && rejected.body.reason })})`);
  ok(rejected.body.code === KVS_INVALID_CURSOR_CODE,
    `…carrying the platform error's own code, so a caller can back off on a throttle instead of restarting (got ${JSON.stringify(rejected.body.code)})`);
  ok(typeof rejected.body.error === "string" && rejected.body.error.length > 0,
    "…and the platform's message, so a resume loop can tell a bad token from a dead tenant");
  /* …while the LIBRARY's own refusal of a token — the one thing that cannot have come from
   * the platform, because it happens before any KVS call — is the ONLY `bad-cursor`. */
  const notOurs = await post({ action: "sweepHarnessFaults", cursor: "dGhpcy1pcy1ub3QteW91cnM=" });
  ok(notOurs.status === 400 && notOurs.body.reason === "bad-cursor" && !notOurs.body.code,
    `…and only a pre-KVS refusal of the token is bad-cursor (got ${JSON.stringify({ status: notOurs.status, reason: notOurs.body && notOurs.body.reason })})`);
  // A NULL or ABSENT cursor is not a bad one — the fresh-sweep case must keep working.
  ok((await post({ action: "sweepHarnessFaults", cursor: null, dryRun: true })).status === 200
    && (await post({ action: "sweepHarnessFaults", dryRun: true })).status === 200,
    "…while an absent or explicitly null cursor is still just a fresh sweep");

  // A caller cannot buy more time than the trigger has: the clamp is the module's, not the door's.
  const greedy = await post({ action: "sweepHarnessFaults", maxMs: 600_000, dryRun: true });
  ok(greedy.body.budgetMs === fault.HARNESS_FAULT_SWEEP_MAX_MS,
    `…and the door cannot raise the budget past the ${fault.HARNESS_FAULT_SWEEP_MAX_MS} ms ceiling (got ${greedy.body && greedy.body.budgetMs})`);

  process.env.HARNESS_SECRET = "";
  ok((await post({ action: "sweepHarnessFaults" })).status === 404, "with no HARNESS_SECRET configured the sweep door is 404, like the rest of the hook");
  process.env.HARNESS_SECRET = SECRET;
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * F-688 — THE DOOR ONTO THE SWEEP'S MULTI-PAGE PATH.
 *
 * F-673/F-674/F-677/F-682/F-683 built a resumable, paced, progress-guaranteed sweep and
 * proved every bit of it against a keyspace no tester could produce on a real tenant: the
 * arming actions above write ONE row per exact path and ONE per provider, so
 * `harness_fault:` never reached a second page and the resume token, the KVS cursor
 * round-trip and `complete` had no live door. `plantHarnessFaults` is that door.
 *
 * IT IS THE MOST WRITE-HAPPY ACTION IN THIS FILE — five hundred rows in one POST — so most
 * of what is asserted here is, again, when it must NOT work and what it must NOT touch:
 *  · REFUSED IN PRODUCTION and without the Bearer, like every sibling, and refused by the
 *    LEVER too, so the gate is not the door's alone;
 *  · `n` CLAMPED 1..500 in the library, echoed by the door, with junk clamping DOWN to one;
 *  · THE ROWS ARE INERT — the four read actions on this same hook are asked while 250
 *    planted rows sit in the keyspace and every one of them answers `null`;
 *  · THE SWEEP THEN DRAINS THEM through the same `sweepHarnessFaults` action, truncating
 *    with a resumable cursor and terminating on `complete: true`;
 *  · `clearPlantedFaults` takes the planted rows and leaves a LIVE Jira lever alone.
 *
 * Time is compressed (setTimeout shimmed to fire immediately, delays recorded) because the
 * paced rate is ~17 s of real waiting for 250 rows; the pacing itself is asserted from the
 * recorded delays. The pagination, the tokens and the termination are real.
 * ═══════════════════════════════════════════════════════════════════════════════ */
{
  const realTimeout = globalThis.setTimeout;
  const delays = [];
  globalThis.setTimeout = function compressed(fn, ms, ...rest) {
    if (typeof ms === "number") delays.push(ms);
    return realTimeout(fn, 0, ...rest);
  };
  const plant = (body, opts) => post({ action: "plantHarnessFaults", ...body }, opts);
  /* F-696 — `n` IS THE POPULATION AND A FRESH CALL MAY ONLY ATTEMPT ONE CALL'S WORTH, so a
   * fixture that wants 250 rows POSTs the same `n` back with `startIndex: nextIndex` until
   * the door answers `complete: true`. That is the contract a live caller follows, and it is
   * the reason the lever can no longer time out with the row count unknown. */
  const plantAll = async (n, expired) => {
    let next = 0, planted = 0, failed = 0, calls = 0, keys = [], last = null;
    while (next < n && calls < 20) {
      last = await plant({ n, expired, startIndex: next || undefined, maxMs: 20_000 });
      if (last.status !== 200 || !last.body || last.body.ok === false) break;
      planted += last.body.planted; failed += last.body.failed; calls++;
      keys = keys.concat(last.body.keys || []);
      // F-707: no FORWARD progress is the stop, whatever the call placed — a plant whose
      // writes are refused answers with the first failed index and can place rows while
      // handing back the index it was given.
      if (last.body.nextIndex <= next) break;
      next = last.body.nextIndex;
    }
    return { status: last && last.status, body: last && last.body, planted, failed, calls, keys, nextIndex: next };
  };
  const clearPlanted = (body, opts) => post({ action: "clearPlantedFaults", ...body }, opts);
  const countPlanted = async () => {
    let n = 0, cursor = null;
    for (let i = 0; i < 20; i++) {
      let q = kvs.query().where("key", { condition: "BEGINS_WITH", values: [fault.HARNESS_FAULT_PLANT_PREFIX] }).limit(100);
      if (cursor) q = q.cursor(cursor);
      const page = await q.getMany();
      n += ((page && page.results) || []).length;
      cursor = (page && page.nextCursor) || null;
      if (!cursor) break;
    }
    return n;
  };

  /* ── THE GATE. Production has no HARNESS_SECRET, so the door is 404 and the lever refuses
   * on its own account; a wrong or absent Bearer is 404 on a door that does have one. ── */
  process.env.HARNESS_SECRET = "";
  ok((await plant({ n: 250, expired: true })).status === 404,
    "with NO HARNESS_SECRET configured the plant door is 404 — it cannot exist in production");
  ok((await clearPlanted({})).status === 404, "…and so is the clear door");
  const offLever = await fault.plantHarnessFaults({ n: 250, expired: true });
  ok(offLever && offLever.ok === false && offLever.reason === "harness-off",
    "…and the lever itself refuses harness-off even if something inside the app calls it");
  process.env.HARNESS_SECRET = SECRET;
  ok((await countPlanted()) === 0, "…and none of those refusals planted a single row");

  ok((await plant({ n: 5, expired: true }, { bearer: null })).status === 404, "no bearer -> 404");
  ok((await plant({ n: 5, expired: true }, { bearer: "not-the-secret" })).status === 404, "a wrong bearer -> 404");
  ok((await clearPlanted({}, { bearer: "not-the-secret" })).status === 404, "…the clear door answers the same to a wrong bearer");
  ok((await countPlanted()) === 0, "…and neither refused call planted anything either");

  /* ── THE CLAMP, echoed by the door but enforced in the lever, beside the constant. ── */
  const over = await plant({ n: 10_000, expired: true });
  ok(over.status === 200 && over.body.n === fault.HARNESS_FAULT_PLANT_MAX && over.body.planted === fault.HARNESS_FAULT_PLANT_CALL_MAX,
    `a FRESH request for 10000 rows plants exactly one call's worth and ECHOES the population (F-710) (got n=${over.body && over.body.n} planted=${over.body && over.body.planted})`);
  ok(over.body.maxN === fault.HARNESS_FAULT_PLANT_CALL_MAX && over.body.prefix === "harness_fault:plant:",
    `…and the answer names the ceiling THIS call had and the sub-prefix it wrote under (got ${JSON.stringify({ maxN: over.body.maxN, prefix: over.body.prefix })})`);
  ok(over.body.nextIndex === fault.HARNESS_FAULT_PLANT_CALL_MAX && over.body.startIndex === 0,
    `…and it says where to carry on (nextIndex ${over.body && over.body.nextIndex})`);
  /* F-710 — the clamp is VISIBLE at the door too. It used to answer `complete: true` with `n`
   * rewritten to 150, so a caller looping "until complete" planted one call's worth believing
   * it had planted what it asked for — the opposite of the loop this door documents. */
  ok(over.body.truncated === true && over.body.reason === "call-max" && over.body.complete === false,
    `F-710: a clamped call is TRUNCATED with its own reason, never complete (got ${JSON.stringify({ truncated: over.body && over.body.truncated, reason: over.body && over.body.reason, complete: over.body && over.body.complete })})`);
  ok(over.body.maxN === fault.HARNESS_FAULT_PLANT_CALL_MAX && over.body.maxN < over.body.n,
    "F-710: …with `maxN` (this call's ceiling) and `n` (the population) as two different numbers in the same answer");
  /* F-696 — THE FULL POPULATION IS REACHED BY RESUMING, exactly as the sweep is drained: the
   * 500-row ceiling was ~45 s of paced writing against a trigger killed at 25 s, and the old
   * answer was assembled only after the LAST write, so a timed-out plant reported nothing at
   * all while having written an unknown number of rows. */
  const overResumed = await plant({ n: 10_000, expired: true, startIndex: over.body.nextIndex });
  ok(overResumed.body.n === fault.HARNESS_FAULT_PLANT_MAX && overResumed.body.maxN === fault.HARNESS_FAULT_PLANT_MAX,
    `a RESUMED call may name the whole 500-row population (got n=${overResumed.body && overResumed.body.n}, maxN=${overResumed.body && overResumed.body.maxN})`);
  ok(overResumed.body.startIndex === over.body.nextIndex && overResumed.body.nextIndex === 500 && overResumed.body.complete === true,
    `…and finishes it (startIndex ${overResumed.body && overResumed.body.startIndex} → nextIndex ${overResumed.body && overResumed.body.nextIndex})`);
  ok((await countPlanted()) === 500, "…five hundred rows, not ten thousand and not a thousand — the keys are index-derived, so resuming cannot double-count");
  /* THE BUDGET AT THE DOOR: `maxMs` is the caller's, clamped in the lever, and a break is a
   * PARTIAL ANSWER with real counters — never a platform timeout with no body. */
  await clearPlanted({ maxMs: 20_000 });
  const budgeted = await plant({ n: 150, expired: true, maxMs: 1 });
  ok(budgeted.status === 200 && budgeted.body.budgetMs === 1 && budgeted.body.planted > 0 && budgeted.body.planted < 150,
    `a plant given an impossible \`maxMs\` still answers 200 with what it PLACED (planted ${budgeted.body && budgeted.body.planted}, budgetMs ${budgeted.body && budgeted.body.budgetMs})`);
  ok(budgeted.body.truncated === true && budgeted.body.reason === "budget" && budgeted.body.complete === false
    && budgeted.body.nextIndex === budgeted.body.planted,
    `…truncated on budget, never complete, and naming the index to resume from (got ${JSON.stringify({ reason: budgeted.body && budgeted.body.reason, nextIndex: budgeted.body && budgeted.body.nextIndex })})`);
  ok((await countPlanted()) === budgeted.body.planted,
    "…and the keyspace holds exactly what the partial answer claims — the count is never unknown again");
  await clearPlanted({ maxMs: 20_000 });
  ok((await countPlanted()) === 0, "(fixture) cleared again");

  /* ── F-707 AT THE DOOR: a plant whose writes are REFUSED must send the caller back to the
   * first hole. The answer used to carry `reason: "writes-failed"` with `nextIndex: n`, so
   * the loop this very door documents POSTed past the holes, wrote nothing and was answered
   * `complete: true` — a failed plant reported through the web trigger as a finished one. ── */
  {
    const setBefore = kvs.set;
    const refusedWrites = new Set([fault.plantedFaultKey(4), fault.plantedFaultKey(5)]);
    kvs.set = async function refusingSet707(key, value, options) {
      if (refusedWrites.has(String(key))) {
        const e = new Error("HARNESS_WRITE_FAULT"); e.code = "HARNESS_WRITE_FAULT"; throw e;
      }
      return setBefore.call(this, key, value, options);
    };
    const holed = await plant({ n: 9, expired: true, maxMs: 20_000 });
    ok(holed.status === 200 && holed.body.planted === 7 && holed.body.failed === 2,
      `(fixture) two refused writes through the door (planted ${holed.body && holed.body.planted}, failed ${holed.body && holed.body.failed})`);
    ok(holed.body.reason === "writes-failed" && holed.body.complete === false && holed.body.nextIndex === 4,
      `F-707: the door hands back the FIRST failed index and never calls it complete (got ${JSON.stringify({ reason: holed.body && holed.body.reason, nextIndex: holed.body && holed.body.nextIndex, complete: holed.body && holed.body.complete })})`);
    const back = await plant({ n: 9, expired: true, startIndex: holed.body.nextIndex, maxMs: 20_000 });
    ok(back.body.complete === false && back.body.nextIndex === 4,
      `F-707: …and POSTing that handle back lands ON the holes rather than past them (got ${JSON.stringify({ nextIndex: back.body && back.body.nextIndex, complete: back.body && back.body.complete })})`);
    const stuck = await plantAll(9, true);
    ok(stuck.body.complete === false && stuck.calls <= 3,
      `F-707: the fixture's drain loop terminates and reports the plant UNFINISHED (calls ${stuck.calls})`);
    kvs.set = setBefore;
    await clearPlanted({ maxMs: 20_000 });
    const control = await plant({ n: 9, expired: true, maxMs: 20_000 });
    ok(control.body.planted === 9 && control.body.failed === 0 && control.body.nextIndex === 9 && control.body.complete === true,
      `F-707 (negative control): with the write fault removed the SAME body completes in one call (got ${JSON.stringify({ planted: control.body && control.body.planted, complete: control.body && control.body.complete })})`);
    await clearPlanted({ maxMs: 20_000 });
    ok((await countPlanted()) === 0, "(fixture) cleared after the F-707 arm");
  }

  /* ── F-708 AT THE DOOR: `startIndex` is judged against the POPULATION, and past it is the
   * refusal path the door already has (`ok === false` → 400). It used to be a 200 whose
   * `nextIndex` pointed BEHIND its own `startIndex` and whose `complete: true` told every
   * documented drain loop that a keyspace it never looked at was fully planted. ── */
  {
    await clearPlanted({ maxMs: 20_000 });
    const past = await plant({ n: 5, startIndex: 400, expired: true });
    ok(past.status === 400 && past.body.ok === false && past.body.reason === "bad-start",
      `F-708: the door REFUSES a start past the population (got ${past.status} ${JSON.stringify(past.body && past.body.reason)})`);
    ok(past.body.complete !== true && (await countPlanted()) === 0,
      "F-708: …never answering complete, and never planting a row on the way out");
    const noop = await plant({ n: 5, startIndex: 5, expired: true });
    ok(noop.status === 200 && noop.body.planted === 0 && noop.body.noop === true && noop.body.complete === true,
      `F-708: …while \`startIndex === n\` — the loop's own last POST — is an explicit no-op (got ${JSON.stringify({ planted: noop.body && noop.body.planted, noop: noop.body && noop.body.noop, complete: noop.body && noop.body.complete })})`);
    const twenty = await plant({ n: 20, expired: true, maxMs: 20_000 });
    ok(twenty.body.planted === 20 && twenty.body.cleared === 0, "(fixture) a 20-row population through the door");
    const five = await plant({ n: 5, expired: true, maxMs: 20_000 });
    ok(five.body.cleared === 15 && (await countPlanted()) === 5,
      `F-708: a SMALLER re-plant takes the old tail with it and reports it (cleared ${five.body && five.body.cleared}, rows ${await countPlanted()})`);
    await clearPlanted({ maxMs: 20_000 });
    const same = await plant({ n: 5, expired: true, maxMs: 20_000 });
    const again = await plant({ n: 5, expired: true, maxMs: 20_000 });
    ok(same.body.cleared === 0 && again.body.cleared === 0 && (await countPlanted()) === 5,
      `F-708 (negative control): re-planting the SAME population removes nothing (cleared ${again.body && again.body.cleared})`);
    await clearPlanted({ maxMs: 20_000 });
  }

  const junk = await plant({ n: "banana", expired: true });
  ok(junk.body.n === 1 && junk.body.planted === 1, `a junk \`n\` clamps DOWN to one, never up (got ${junk.body && junk.body.n})`);
  const zero = await plant({ n: 0, expired: true });
  ok(zero.body.n === 1, "…and so does zero");
  await clearPlanted({ maxMs: 20_000 });

  /* ── THE ROWS ARE INERT, asked of the four read actions on this same door while 250 of
   * them sit in the keyspace. Every consumer exact-matches its own kind; `plant` is none. ── */
  const planted = await plantAll(250, true);
  ok(planted.status === 200 && planted.planted === 250 && planted.body.expired === true,
    `(fixture) 250 expired rows planted through the door in ${planted.calls} call(s) (got ${planted.planted})`);
  ok(planted.keys.length === 250 && planted.keys.every((k) => k.startsWith("harness_fault:plant:")),
    "…every key under the plant sub-prefix and nowhere else, across the resume boundary");
  ok(planted.body.ttlSeconds >= fault.HARNESS_FAULT_PLANT_TTL_SECONDS
    && planted.body.ttlSeconds === fault.plantTtlSeconds(250),
    `F-697: …each with a window that COVERS the plant that wrote it plus a minute after it (got ${planted.body && planted.body.ttlSeconds} s, never a flat 60 under a 22 s plant)`);
  /* F-709 AT THE DOOR: the resume loop above spans several web-trigger calls, and every row
   * it wrote must carry the SAME deadline. A per-call deadline made the tail outlive the head
   * by the whole wall time of the plant — which is how the head of an `expired: false`
   * population could be gone before the tail existed, and the sweep then "deleted rows it was
   * told to leave alone". `armedAt` still says which row was written first. */
  {
    const head = await kvs.get(fault.plantedFaultKey(0));
    const tail = await kvs.get(fault.plantedFaultKey(249));
    ok(head && tail && head.until === tail.until,
      `F-709: head and tail of a population planted across ${planted.calls} door call(s) share ONE deadline (head ${head && head.until}, tail ${tail && tail.until})`);
    ok(head && tail && tail.armedAt > head.armedAt,
      "F-709: …while `armedAt` still walks forward batch by batch");
    ok(planted.body.ttlSeconds * 1000 >= Math.ceil(250 / fault.HARNESS_FAULT_PLANT_CALL_MAX)
      * (fault.HARNESS_FAULT_SWEEP_DEFAULT_MS + fault.HARNESS_FAULT_PLANT_COLD_START_MS)
      + fault.HARNESS_FAULT_PLANT_TTL_SECONDS * 1000,
      `F-709: …and the window the door reports covers every call the resume loop forces, plus a minute (got ${planted.body && planted.body.ttlSeconds} s)`);
  }

  ok((await readLever()).body.value === null, "readJiraFault answers null with 250 planted rows in the keyspace");
  ok((await post({ action: "readKeyReadFault", provider: "openai" })).body.value === null, "…readKeyReadFault too");
  ok((await post({ action: "readGitDispatchFault", connectionId: "gc_688", deliveryId: "000" })).body.value === null,
    "…readGitDispatchFault, on the very part id a planted key uses");
  ok((await post({ action: "readHookPromoteFault", connectionId: "gc_688", repo: "acme/000" })).body.value === null,
    "…and readHookPromoteFault");
  const stillReal = await handler({ call: { functionKey: "searchUsers", payload: { query: "mihai" } } }, { principal: { accountId: ADMIN } });
  ok(stillReal.success === true && stillReal.users.length === 1,
    `…and the product's own Jira call still runs for real — ballast faults NOTHING (got ${JSON.stringify(stillReal).slice(0, 120)})`);
  ok((await countPlanted()) === 250, "…with all 250 rows still exactly where they were");

  /* ── THE DRAIN, through the SWEEP action, which is the whole point of the ballast. ── */
  const firstSweep = await post({ action: "sweepHarnessFaults", maxMs: 1 });
  ok(firstSweep.status === 200 && firstSweep.body.truncated === true && firstSweep.body.reason === "budget",
    `a sweep over 250 planted rows truncates on budget (got ${JSON.stringify({ truncated: firstSweep.body && firstSweep.body.truncated, reason: firstSweep.body && firstSweep.body.reason })})`);
  ok(firstSweep.body.deleted > 0 && firstSweep.body.complete === false,
    `…having MOVED first, and never calling itself complete (deleted ${firstSweep.body && firstSweep.body.deleted})`);
  ok(typeof firstSweep.body.cursor === "string" && firstSweep.body.cursor.length > 0,
    `…and hands back a RESUMABLE token (got ${JSON.stringify(firstSweep.body.cursor)})`);

  let token = firstSweep.body.cursor, calls = 1, lastSweep = firstSweep;
  while (token && calls < 400) {
    lastSweep = await post({ action: "sweepHarnessFaults", maxMs: 1, cursor: token });
    ok(lastSweep.status === 200, "…every resumed POST answers 200");
    token = lastSweep.body.cursor;
    calls++;
  }
  ok(token === null && lastSweep.body.complete === true && lastSweep.body.truncated === false,
    `…and POSTing it back to the same action TERMINATES with complete:true (${calls} calls)`);
  ok(calls > 10, `…after many resumed calls — the multi-page path a one-row keyspace can never reach (${calls})`);
  ok((await countPlanted()) === 0, "…with the whole 250-row population swept out of the keyspace");
  ok(delays.filter((d) => d === fault.KVS_DELETE_PAUSE_MS).length > 80,
    `…and both the planting and the deletes were PACED at the app's published ${fault.KVS_DELETE_PAUSE_MS} ms rate (${delays.filter((d) => d === fault.KVS_DELETE_PAUSE_MS).length} rounds)`);


  /* ── F-691/F-692 AT THE DOOR: the finished signal is `complete`, and a drain that could
   * not delete what it condemned never reaches it, however the calls in between ended.
   *
   * This is the sequence F-691 names, driven through the live door F-688 opened: a page of
   * ballast whose deletes REFUSE, budget breaks on later pages that would have thrown the
   * failing page's resume point away, and a final call that walks to the end with `failed: 0`
   * of its own. `truncated` is a per-CALL fact; `complete` is the drain's. ── */
  const drainDelete = kvs.delete;
  const refused692 = new Set([fault.plantedFaultKey(0), fault.plantedFaultKey(1)]);
  kvs.delete = async function refusing692(key) {
    if (refused692.has(key)) { const e = new Error("RATE_LIMIT_EXCEEDED"); e.code = "RATE_LIMIT_EXCEEDED"; throw e; }
    return drainDelete.call(this, key);
  };
  ok((await plant({ n: 120, expired: true })).body.planted === 120, "(fixture) 120 expired planted rows, two of which refuse to be deleted");
  let t692 = null, last692 = null, calls692 = 0;
  do {
    last692 = await post({ action: "sweepHarnessFaults", maxMs: 1, cursor: t692 });
    t692 = last692.body.cursor; calls692++;
    // A drain STOPS on `complete`, never on "the cursor came back null" and never on
    // `truncated === false` — and it backs off when told the call is not converging.
  } while (t692 && calls692 < 400 && last692.body.complete !== true && last692.body.reason !== "deletes-failing");
  ok(calls692 > 1 && last692.body.failed > 0,
    `(fixture) the drain took several calls and some deletes refused (calls ${calls692}, failed on the last ${last692.body.failed})`);
  ok(last692.body.complete === false,
    "F-691: no call of this drain is complete — two rows it condemned are still live, even on the call that reached the end of the keyspace");
  ok(typeof last692.body.failedResume === "string" && last692.body.failedResume.length > 0,
    "F-691: …and the door hands back `failedResume`, the page to go back to, rather than dropping it at the first budget break");
  ok(typeof last692.body.complete === "boolean" && "complete" in last692.body,
    "F-692: the sweep door ALWAYS carries `complete` — it is the finished signal, not an optional extra");

  kvs.delete = drainDelete;
  const finished692 = await post({ action: "sweepHarnessFaults", maxMs: 20_000, cursor: last692.body.failedResume });
  ok(finished692.body.complete === true && finished692.body.cursor === null && finished692.body.failedResume === null,
    `F-691: POSTing \`failedResume\` back finishes the job, and only THEN is the drain complete (got ${JSON.stringify({ complete: finished692.body.complete, deleted: finished692.body.deleted })})`);
  ok((await countPlanted()) === 0, "…with the keyspace actually empty, which is what `complete` was claiming all along");

  /* SOURCE — F-692: `complete` had ZERO production consumers; it arrived only by spread and
   * the drivers re-derived finishedness from `truncated`, so one rule had two homes the
   * moment it was given one. Both actions now NAME it, and the docblock says outright that
   * deriving it is deprecated. */
  const hookSrc = readFileSync(path.join(here, "../../src/test-hook.js"), "utf8");
  ok((hookSrc.match(/\.\.\.r, complete: r\.complete === true,?\s*\}\)/g) || []).length === 3,
    "F-692.SOURCE: the sweep, the clear AND the plant (F-696) return `complete` explicitly, so a reshape of the library's answer cannot silently drop it");
  ok(/DEPRECATED: DERIVING FINISHEDNESS FROM `truncated`/.test(hookSrc),
    "F-692.SOURCE: …and the docblock marks the `truncated`-only derivation deprecated, naming `complete` as the ONE finished signal");

  /* ── THE CLEAR takes LIVE ballast (which the sweep must never touch) and nothing else. ── */
  const livePlant = await plant({ n: 120, expired: false });
  ok(livePlant.body.planted === 120 && livePlant.body.expired === false, "(fixture) 120 LIVE planted rows");
  const sweepLeavesThem = await post({ action: "sweepHarnessFaults", maxMs: 20_000 });
  ok(sweepLeavesThem.body.deleted === 0 && (await countPlanted()) === 120,
    `the sweep LISTS live ballast and deletes none of it — it is a sweep, not a disarm-everything (deleted ${sweepLeavesThem.body && sweepLeavesThem.body.deleted})`);

  await arm({ status: 503, ttlSeconds: 120 });
  ok((await readLever()).body.value.status === 503, "(fixture) a real, LIVE Jira lever armed beside the ballast");

  let ct = (await clearPlanted({ maxMs: 1 })).body.cursor, clearCalls = 1, lastClear = null;
  ok(typeof ct === "string" && ct.length > 0, "a budgeted clear truncates with a resumable token, exactly like the sweep");
  while (ct && clearCalls < 400) {
    const r = await clearPlanted({ maxMs: 1, cursor: ct });
    ok(r.status === 200, "…every resumed clear answers 200");
    lastClear = r; ct = r.body.cursor; clearCalls++;
  }
  ok(ct === null && lastClear && lastClear.body.complete === true,
    `…and drains to complete:true (${clearCalls} calls)`);
  ok((await countPlanted()) === 0, "…the plant sub-prefix is empty");
  ok((await readLever()).body.value && (await readLever()).body.value.status === 503,
    "…while the LIVE Jira lever beside it is untouched — the clear's prefix is bound to `harness_fault:plant:` and is not a parameter");
  ok((await handler({ call: { functionKey: "searchUsers", payload: { query: "mihai" } } }, { principal: { accountId: ADMIN } })).status === 503,
    "…so that lever still bites after the ballast is gone");
  await disarm();

  /* ── The clear's cursor is validated by the SAME one grammar as the sweep's (F-676/F-685),
   * and only the library's own pre-KVS refusal of a token is `bad-cursor` (F-684). ── */
  for (const bad of ["../../etc/passwd", "abc def", "A".repeat(2100), 42, "harness_fault:plant:000", "dGhpcy1pcy1ub3QteW91cnM="]) {
    const r = await clearPlanted({ cursor: bad });
    ok(r.status === 400 && r.body && r.body.ok === false && r.body.reason === "bad-cursor",
      `a clear cursor ${JSON.stringify(String(bad).slice(0, 30))} is REFUSED 400 bad-cursor, not a bodyless 500 (got ${JSON.stringify({ status: r.status, body: r.body })})`);
  }
  {
    const victim = await plant({ n: 3, expired: false });
    ok(victim.body.planted === 3 && (await clearPlanted({ cursor: "../../etc/passwd" })).status === 400
      && (await countPlanted()) === 3,
      "…and a refused cursor does no work at all — the ballast it would have cleared is untouched");
    await clearPlanted({ maxMs: 20_000 });
  }
  ok((await clearPlanted({ maxMs: 600_000 })).body.budgetMs === fault.HARNESS_FAULT_SWEEP_MAX_MS,
    `…and the clear cannot buy more time than the trigger has either (${fault.HARNESS_FAULT_SWEEP_MAX_MS} ms)`);

  globalThis.setTimeout = realTimeout;
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * F-669 — THE MOCK MUST BE ABLE TO SEE THE TRUSTED-SLOT RISK.
 *
 * F-661 introduced `assumeTrustedRoute`, the one call in the codebase that can put a
 * string into `route`'s PATH position without the tag inspecting it. Today its argument
 * is a frozen module constant and the code is correct. The exposure is the NEXT edit:
 * someone "fixes" a rejected query by writing
 *   route`${assumeTrustedRoute(JIRA_FAULT_USER_SEARCH_PATH + "?query=" + query)}`
 * and caller-controlled admin search text reaches the wire unescaped. Every offline
 * assertion still passed, because the mock concatenated either way and the expectations
 * were written against a concatenation — so the suite could not see the one thing the
 * new door made possible.
 *
 * The mock now mirrors `@forge/api/out/safeUrl.js`. These checks prove the mirror is
 * real: the tag REFUSES path manipulation, it ESCAPES in query mode, and — where the
 * real package is resolvable — it produces the byte-identical string.
 * ═══════════════════════════════════════════════════════════════════════════════ */
{
  const { route: mockRoute, assumeTrustedRoute: mockTrust } = await import("../lib/mock-forge-api.mjs");
  const routes = await import("../../src/jira-routes.js");

  /* THE POSITIVE CONTROL FIRST. A refusal proves nothing until the same tag is shown to
     ACCEPT the legitimate case on the same shape. */
  ok(routes.routeString(routes.userSearchRoute("mihai")) === `${PATH}?query=mihai&maxResults=10`,
    "POSITIVE CONTROL: the real builder still produces the plain route for a plain query");

  let threw = null;
  try { mockRoute`${"/rest/api/3/user/search?query=x"}`; }
  catch (e) { threw = String(e.message); }
  ok(threw !== null, "splicing a plain string containing `/` into the TRUSTED slot THROWS — the mock can now see the risk");
  ok(/path manipulation/i.test(String(threw)), `…with the real package's message (got: ${threw})`);

  for (const bad of ["a/b", "a\\b", "..", "%2e%2e", "a?b", "a#b"]) {
    let t = null;
    try { mockRoute`/x/${bad}`; } catch (e) { t = e; }
    ok(t !== null, `path mode refuses ${JSON.stringify(bad)} — every rule escapeParameter carries, not just the slash`);
  }

  ok(routes.routeString(mockRoute`/x/${mockTrust("a/b")}`) === "/x/a/b",
    "…while a Route object IS spliced verbatim, which is the whole point of assumeTrustedRoute");

  /* QUERY MODE. The mode flips on the template FRAGMENT that carries the `?`, BEFORE the
     parameter after it is escaped — which is why a slash in the query is encoded, not
     refused. Get that ordering wrong and the mock is a different function. */
  const tricky = "a b/c&d=e#f";
  const built = routes.routeString(routes.userSearchRoute(tricky));
  ok(built === `${PATH}?query=${encodeURIComponent(tricky)}&maxResults=10`,
    `a query is ESCAPED, not refused: the mode flips on the "?" fragment first (got ${built})`);
  ok(!built.includes(" ") && !built.includes("#"),
    "…so no raw separator from caller text can reach the wire and change the request's parameters");

  /* THE MIRROR, AGAINST THE REAL THING. If @forge/api is installed, the two tags must
     agree byte-for-byte; if it is not, say so rather than claim a comparison never made. */
  let real = null;
  try {
    const { createRequire } = await import("node:module");
    real = createRequire(import.meta.url)("@forge/api/out/safeUrl.js");
  } catch { real = null; }
  if (real && typeof real.route === "function") {
    const realBase = real.assumeTrustedRoute(PATH);
    const expected = real.route`${realBase}?query=${tricky}&maxResults=${10}`.value;
    ok(built === expected, `the mock's tag is byte-identical to @forge/api's for userSearchRoute(${JSON.stringify(tricky)}) (mock ${built} / real ${expected})`);

    let realThrew = null;
    try { real.route`${"/rest/api/3/user/search?query=x"}`; } catch (e) { realThrew = String(e.message); }
    ok(realThrew !== null && /path manipulation/i.test(realThrew),
      "…and the real tag refuses the same trusted-slot splice, for the same stated reason");

    ok(real.route`/x/${real.assumeTrustedRoute("a/b")}`.value === "/x/a/b",
      "…and splices a real Route verbatim, exactly as the mock does");
  } else {
    console.log("  N/V   @forge/api is not resolvable here, so the mock was checked against the DOCUMENTED safeUrl rules only, not against the package");
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * F-706 — THE DOOR ONTO THE FAILING-DELETE HALF OF THE SWEEP CONTRACT.
 *
 * F-682/F-683/F-690/F-691 all describe what a drain does when a KVS delete REFUSES, and
 * nothing a tester can do on a live tenant makes one refuse — plant-sweep-live saw `failed: 0`
 * throughout, so all four were proven against the offline mock only. `armDeleteFault` is the
 * seventh member of the family and this is its door. What is asserted here is the DOOR's own
 * behaviour — the Bearer, the 404 in production, the refusals the lever hands up and the
 * prefix the door never retypes; the lever's own semantics are harness-fault-ttl.test.mjs's.
 * ═══════════════════════════════════════════════════════════════════════════════ */
{
  const PLANT = fault.HARNESS_FAULT_PLANT_PREFIX;
  const armDel = (extra) => post({ action: "armDeleteFault", mode: "refuse", count: 3, ttlSeconds: 60, ...extra });

  ok((await armDel({}, )).status === 200, "armDeleteFault is a door, and it opens for the harness Bearer");
  ok((await post({ action: "armDeleteFault", mode: "refuse" }, { bearer: null })).status === 404,
    "…and is 404 with no Bearer — the hook never confirms an action exists to an unauthenticated caller");
  ok((await post({ action: "armDeleteFault", mode: "refuse" }, { bearer: "not-the-secret" })).status === 404,
    "…and with the wrong one");

  const armedBody = (await armDel({ count: 2, ttlSeconds: 45 })).body;
  ok(armedBody.ok === true && armedBody.prefix === PLANT && armedBody.mode === "refuse" && armedBody.count === 2,
    `F-706: the arm answers the prefix, the mode and the clamped count (got ${JSON.stringify(armedBody)})`);
  ok(armedBody.modes.join(",") === "refuse,throttle"
    && armedBody.maxCount === fault.HARNESS_DELETE_FAULT_MAX_COUNT
    && armedBody.maxTtlSeconds === fault.HARNESS_DELETE_FAULT_MAX_TTL_SECONDS,
    "…and publishes the lever's OWN allow-list and caps, never a literal retyped at the door");
  ok(typeof armedBody.until === "string" && armedBody.key.includes(PLANT),
    `…and the row carries an \`until\` like every lever in this family (got ${armedBody.until})`);

  const readBack = (await post({ action: "readDeleteFault", prefix: PLANT })).body;
  ok(readBack.ok === true && readBack.value && readBack.value.count === 2 && readBack.value.mode === "refuse",
    `F-706: readDeleteFault answers what is LEFT on the lever (got ${JSON.stringify(readBack.value)})`);
  const disarmed = (await post({ action: "disarmDeleteFault" })).body;
  ok(disarmed.ok === true && disarmed.disarmed === true, "F-706: …and disarmDeleteFault removes it");
  ok((await post({ action: "readDeleteFault" })).body.value === null, "…idempotently, to nothing");

  /* THE PREFIX IS EXACT AND IT IS THE PLANT'S — refused by the LEVER, surfaced by the door as
   * a 400. A lever that could fail an arbitrary delete could strand app data; this one can
   * only refuse to remove inert ballast that expires on its own. */
  for (const bad of ["harness_fault:", "doc_repo:", `${PLANT}x`, "*", ""]) {
    const r = await armDel({ prefix: bad });
    ok(r.status === 400 && r.body.reason === "bad-prefix" && r.body.prefix === PLANT,
      `F-706: prefix ${JSON.stringify(bad)} is 400 bad-prefix (got ${r.status} ${JSON.stringify(r.body && r.body.reason)})`);
  }
  ok((await armDel({ mode: "explode" })).status === 400, "a mode outside the allow-list is 400");
  ok((await armDel({ mode: undefined })).status === 400, "…and a missing mode is 400 — the door plants no default failure");
  // The door OMITS the prefix on purpose: the one value this family may touch has one home.
  const defaulted = await post({ action: "armDeleteFault", mode: "throttle", count: 1, ttlSeconds: 30 });
  ok(defaulted.status === 200 && defaulted.body.prefix === PLANT,
    "F-706: a body with no prefix gets the lever's own — the door names HARNESS_FAULT_PLANT_PREFIX, never a literal");
  await post({ action: "disarmDeleteFault" });

  process.env.HARNESS_SECRET = "";
  ok((await post({ action: "armDeleteFault", mode: "refuse" })).status === 404,
    "with no HARNESS_SECRET configured the delete-fault door is 404, like the rest of the hook");
  process.env.HARNESS_SECRET = SECRET;
}

console.log(`test-hook-jira-fault (F-655/F-661/F-667/F-669): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
