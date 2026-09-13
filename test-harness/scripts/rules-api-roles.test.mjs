/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * THE ROLE FLOOR ON EVERY RESOURCE OF THE RULES REST API (F-466).
 *
 * Before this, `?resource=agents` was the ONLY resource that read the token's role:
 * a "viewer" token could create, edit, delete, enable and RUN a listener or a job —
 * powers the Listeners tab refuses a viewer's click. The fix is one predicate
 * (`tokenRoleAtLeast`) applied at every route with the floors the RESOLVERS use.
 *
 * What this suite proves, in BOTH directions (a floor asserted only one way can
 * drift the other way without failing):
 *  · the allowed/refused matrix, per role token, per route;
 *  · a legacy row with NO role is still ADMIN — no live integration loses a power;
 *  · an unknown role is REFUSED at mint, never coerced to admin;
 *  · the role is stored on the row and returned by listApiTokens + whoami.
 *
 * Run: node --import ./lib/register-mocks.mjs scripts/rules-api-roles.test.mjs
 * (auto-discovered by run-offline.mjs, which supplies the loader.)
 */

import "../lib/register-mocks-index.mjs";
import storage from "../lib/mock-kvs.mjs";
const { default: forgeApi } = await import("@forge/api");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

forgeApi.__respond(() => forgeApi.__response(200, {}));

const { createApiTokenInternal, listApiTokens, rulesApiHandler, API_TOKENS_KEY } = await import("../../src/rules-api.js");

const tokens = {
  viewer: (await createApiTokenInternal({ name: "viewer", accountId: "admin-1", role: "viewer" })).token,
  editor: (await createApiTokenInternal({ name: "editor", accountId: "admin-1", role: "editor" })).token,
  admin: (await createApiTokenInternal({ name: "admin", accountId: "admin-1", role: "admin" })).token,
  // Minted the way every token was minted before the field existed.
  legacy: (await createApiTokenInternal({ name: "legacy", accountId: "admin-1" })).token,
};

const rest = async (role, resource, { method = "GET", query = {}, body } = {}) => {
  const res = await rulesApiHandler({
    method,
    headers: { authorization: `Bearer ${tokens[role]}` },
    queryParameters: Object.fromEntries(Object.entries({ resource, ...query }).map(([k, v]) => [k, [String(v)]])),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.statusCode, body: JSON.parse(res.body) };
};

const listenerBody = (name) => ({ name, events: ["avi:jira:created:issue"], functions: [{ code: "api.log(1)" }] });
const jobBody = (name) => ({ name, schedule: { cron: "0 9 * * *", timeZone: "UTC" }, scope: { jql: "project = LZPT" }, functions: [{ code: "api.log(1)" }] });

/* ── mint-time role handling ───────────────────────────────────────────────── */

ok((await listApiTokens()).find((t) => t.name === "viewer").role === "viewer", "listApiTokens reports the role it was minted with");
ok((await listApiTokens()).find((t) => t.name === "legacy").role === "admin", "a row with NO role reads as admin (the documented compatibility default)");
ok((storage.__raw(API_TOKENS_KEY).find((r) => r.name === "legacy").role) === null, "…and the stored row keeps null, not a back-filled 'admin'");
ok((storage.__raw(API_TOKENS_KEY).find((r) => r.name === "viewer").role) === "viewer", "the chosen role is stored on the row");

for (const bad of ["superuser", "Admin ", "", " ", "owner", 7]) {
  if (bad === "" || bad === null) continue;
  let threw = null;
  try { await createApiTokenInternal({ name: "bad", accountId: "admin-1", role: bad }); } catch (e) { threw = e; }
  if (bad === "Admin ") {
    ok(threw === null, "a role differing only in case/whitespace is normalised, not refused");
  } else {
    ok(threw !== null && /Unknown token role/.test(threw.message), `an unknown role (${JSON.stringify(bad)}) is REFUSED at mint, never coerced to admin`);
  }
}
{
  const t = await createApiTokenInternal({ name: "omitted", accountId: "admin-1" });
  ok(t.row.role === "admin", "an omitted role mints the compatibility default (admin)");
}

ok((await rest("viewer", "whoami")).body.token.role === "viewer", "whoami tells a caller its own role");

/* ── the matrix: [route, method, query, body, floor] ───────────────────────── */

// A seed row per collection, made by an ADMIN token, so the BLOCK/ALLOW answers below
// are about the floor and never about a missing id.
const seedL = (await rest("admin", "listeners", { method: "POST", body: listenerBody("seed") })).body.listener;
const seedJ = (await rest("admin", "jobs", { method: "POST", body: jobBody("seed") })).body.job;
ok(seedL && seedL.id, "precondition: an admin token can create a listener");
ok(seedJ && seedJ.id, "precondition: an admin token can create a job");

const ROUTES = [
  // [label, resource, opts, floor]
  ["GET whoami", "whoami", {}, "any"],
  ["GET events", "events", {}, "any"],
  ["GET actions", "actions", {}, "any"],
  ["GET listeners", "listeners", {}, "viewer"],
  ["GET listener by id", "listeners", { query: { id: seedL.id } }, "viewer"],
  ["GET jobs", "jobs", {}, "viewer"],
  ["GET logs", "logs", {}, "viewer"],
  ["GET tasks", "tasks", { query: { id: "task-nope" } }, "viewer"],
  ["POST jobs preview", "jobs", { method: "POST", query: { id: seedJ.id, action: "preview" }, body: { cron: "0 9 * * *", timeZone: "UTC" } }, "viewer"],
  ["GET samples", "samples", { query: { eventType: "avi:jira:created:issue" } }, "editor"],
  ["POST listeners (create)", "listeners", { method: "POST", body: listenerBody("made") }, "editor"],
  ["PUT listener", "listeners", { method: "PUT", query: { id: seedL.id }, body: { name: "renamed" } }, "editor"],
  ["POST listener disable", "listeners", { method: "POST", query: { id: seedL.id, action: "disable" } }, "editor"],
  ["POST jobs (create)", "jobs", { method: "POST", body: jobBody("made") }, "editor"],
  ["PUT job", "jobs", { method: "PUT", query: { id: seedJ.id }, body: { name: "renamed" } }, "editor"],
  ["POST job run", "jobs", { method: "POST", query: { id: seedJ.id, action: "run" } }, "editor"],
  ["GET agents", "agents", {}, "editor"],
  ["GET agent drafts", "agents", { query: { id: seedJ.id, part: "drafts" } }, "admin"],
  // DELETE last: it consumes the seed rows.
  ["DELETE job", "jobs", { method: "DELETE", query: { id: seedJ.id } }, "editor"],
  ["DELETE listener", "listeners", { method: "DELETE", query: { id: seedL.id } }, "editor"],
];

const RANK = { any: 0, viewer: 1, editor: 2, admin: 3 };
const ROLE_RANK = { viewer: 1, editor: 2, admin: 3, legacy: 3 };

for (const [label, resource, opts, floor] of ROUTES) {
  for (const role of ["viewer", "editor", "admin", "legacy"]) {
    const allowed = ROLE_RANK[role] >= RANK[floor];
    const r = await rest(role, resource, opts);
    if (allowed) {
      // ALLOW means "not refused by the floor" — a 404/400/409 from the resource
      // itself is still an allowed call; only 403 no-permission is a refusal.
      ok(!(r.status === 403 && r.body.reason === "no-permission"),
        `ALLOW ${role} → ${label} (floor ${floor}) — got ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
    } else {
      ok(r.status === 403 && r.body.reason === "no-permission" && r.body.needsRole === floor && r.body.hint === "ask-app-admin",
        `BLOCK ${role} → ${label} (floor ${floor}) — got ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
    }
  }
}

// The sharpest single case, stated on its own: the defect F-466 names.
{
  const before = (await rest("admin", "listeners")).body.listeners.length;
  const r = await rest("viewer", "listeners", { method: "POST", body: listenerBody("viewer-should-not-write") });
  const after = (await rest("admin", "listeners")).body.listeners.length;
  ok(r.status === 403 && after === before, "a VIEWER token cannot write a listener, and none is left behind");
}

// ONE predicate, not a floor per resource.
{
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../../src/rules-api.js", import.meta.url), "utf8");
  const ranks = src.match(/ROLE_RANK\[/g) || [];
  ok(ranks.length === 2, `the role comparison lives in ONE predicate (ROLE_RANK read ${ranks.length}× — expected the 2 inside tokenRoleAtLeast)`);
}

console.log(`rules-api roles: ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
