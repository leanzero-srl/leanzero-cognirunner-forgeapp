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
import { maskComments } from "../lib/js-source-scan.mjs";
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

/*
 * THE ROSTER (F-471). A token now acts as the ACCOUNT THAT MINTED IT for the
 * ownership half of a write, so these rows are what `getUserPermissions` resolves:
 * `admin-1` mints the role tokens above and is an app admin (scope "all");
 * `acc-own` is an EDITOR whose scope is "own" — the only caller for whom the
 * ownership arm can refuse anything.
 */
storage.__seed("app_admins", [
  { accountId: "admin-1", displayName: "Admin", role: "admin", scope: "all" },
  { accountId: "acc-own", displayName: "Own-scope editor", role: "editor", scope: "own" },
]);
tokens.owner = (await createApiTokenInternal({ name: "owner", accountId: "acc-own", role: "editor" })).token;
tokens.orphan = (await createApiTokenInternal({ name: "orphan", role: "editor" })).token;

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
      // ALLOW means "not refused by the FLOOR" — a 404/400/409 from the resource itself
      // is still an allowed call. F-503: nor is an OWNERSHIP refusal, which this matrix
      // does not speak to. The seed rows belong to the ADMIN token, and since F-503 the
      // "editor" token (minted by `admin-1`, an app admin) is a scope-"own" principal,
      // so a write on one of those rows is legitimately 403 `hint:"not-owner"`. The two
      // refusals are told apart by `hint`, which is the whole point of F-241/F-260:
      // "ask-app-admin" = a role would help, "not-owner" = it would not. The ownership
      // ANSWER for that same token is asserted in the F-503 block below.
      ok(!(r.status === 403 && r.body.reason === "no-permission" && r.body.hint === "ask-app-admin"),
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
  /* F-805 — COUNT CODE, NOT PROSE. A comment saying "ROLE_RANK[...] is read here and
     nowhere else" would make this count 3 and fail a file that is right. maskComments
     blanks comments and keeps string literals. */
  const src = maskComments(fs.readFileSync(new URL("../../src/rules-api.js", import.meta.url), "utf8"));
  ok((maskComments("// ROLE_RANK[a] explained\nconst r = ROLE_RANK[b];\n").match(/ROLE_RANK\[/g) || []).length === 1,
    "F-805: the count sees the CODE read only, not the one named in a comment");
  const ranks = src.match(/ROLE_RANK\[/g) || [];
  ok(ranks.length === 2, `the role comparison lives in ONE predicate (ROLE_RANK read ${ranks.length}× — expected the 2 inside tokenRoleAtLeast)`);
}

/* ── F-471: OWNERSHIP, not just the role floor ──────────────────────────────
 *
 * The floors above prove an editor token may write. They say nothing about WHOSE row
 * it may write, and that was the defect: an editor token could edit, disable and
 * delete every listener and job on the instance, while the same person's click is
 * refused by `gateExistingRow`'s scope-"own" arm. The gate is the resolvers' one —
 * these cases assert the ANSWER, including that the refusal is byte-identical in
 * shape to the resolver's (`reason:"no-permission"`, `hint:"not-owner"`, and NO
 * `needsRole`, because asking an admin for a role does not make a foreign row yours).
 */
{
  const notOwner = (r) => r.status === 403 && r.body.reason === "no-permission"
    && r.body.hint === "not-owner" && r.body.needsRole === undefined;

  for (const [kind, noun, mk] of [["listeners", "listener", listenerBody], ["jobs", "job", jobBody]]) {
    // A FOREIGN row: written by the admin token, so it carries that token's audit
    // stamp and is nobody's row as far as a scope-"own" editor is concerned.
    const foreign = (await rest("admin", kind, { method: "POST", body: mk("foreign") })).body[noun];
    ok(foreign && foreign.id, `precondition: a foreign ${noun} exists`);

    // The editor token's OWN row: an editor token stamps the ACCOUNT that minted it.
    const mine = (await rest("owner", kind, { method: "POST", body: mk("mine") })).body[noun];
    ok(mine && mine.createdBy === "acc-own", `an editor token's ${noun} is owned by the account that minted the token (got ${mine && mine.createdBy})`);

    ok(notOwner(await rest("owner", kind, { method: "PUT", query: { id: foreign.id }, body: { name: "stolen" } })),
      `BLOCK editor token → PUT a foreign ${noun} (ownership, not the floor)`);
    ok(notOwner(await rest("owner", kind, { method: "POST", query: { id: foreign.id, action: "disable" } })),
      `BLOCK editor token → disable a foreign ${noun}`);
    ok(notOwner(await rest("owner", kind, { method: "DELETE", query: { id: foreign.id } })),
      `BLOCK editor token → DELETE a foreign ${noun}`);
    ok(((await rest("admin", kind, { query: { id: foreign.id } })).body[noun] || {}).name === "foreign",
      `…and the foreign ${noun} is untouched afterwards`);

    /* F-490 — A POST THAT NAMES AN EXISTING ID IS AN EDIT, AND IT WAS UN-GATED.
     *
     * `saveListener`/`saveJob` upsert by id and `normalizeListener` keeps
     * `existing.createdBy`, so this replaced a foreign row IN PLACE and it kept
     * running under its owner's account — the same body sent as PUT was already 403.
     * BLOCK, ALLOW, and the batch arm: a refused item must not leave the rest of a
     * mixed batch written. */
    ok(notOwner(await rest("owner", kind, { method: "POST", body: { ...mk("hijacked"), id: foreign.id } })),
      `BLOCK editor token → POST an UPSERT onto a foreign ${noun} (F-490)`);
    ok(((await rest("admin", kind, { query: { id: foreign.id } })).body[noun] || {}).name === "foreign",
      `…and the foreign ${noun} still carries its own name afterwards`);
    {
      const before = (await rest("admin", kind, { method: "GET" })).body[kind].length;
      const mixed = await rest("owner", kind, { method: "POST", body: [mk("batch-new"), { ...mk("batch-hijack"), id: foreign.id }] });
      ok(notOwner(mixed), `BLOCK a MIXED batch whose second item targets a foreign ${noun}`);
      ok((await rest("admin", kind, { method: "GET" })).body[kind].length === before,
        `…and the legal FIRST item of that batch was not written either (refused before the batch runs)`);
    }
    {
      // ALLOW: the same upsert onto its OWN row is an edit it may make.
      const up = await rest("owner", kind, { method: "POST", body: { ...mk("mine-upserted"), id: mine.id } });
      ok(up.status === 200 || up.status === 201, `ALLOW editor token → POST an upsert onto its OWN ${noun} (got ${up.status})`);
      ok(((await rest("admin", kind, { query: { id: mine.id } })).body[noun] || {}).name === "mine-upserted",
        `…and the upsert actually took`);
    }

    // F-261 — for this caller an UNKNOWN id and a foreign row are the same answer.
    ok(notOwner(await rest("owner", kind, { method: "PUT", query: { id: `${noun}-does-not-exist` }, body: { name: "x" } })),
      `an id that does not exist reads exactly like a foreign ${noun} (no existence leak)`);

    // ALLOW on its own row, both the merge-update and the delete (the delete arm uses
    // the NARROWER destructive ownership rule, so it is asserted separately).
    const renamed = await rest("owner", kind, { method: "PUT", query: { id: mine.id }, body: { name: "mine-renamed" } });
    ok(renamed.status === 200 && renamed.body[noun].name === "mine-renamed", `ALLOW editor token → PUT its OWN ${noun}`);
    ok((await rest("owner", kind, { method: "POST", query: { id: mine.id, action: "disable" } })).status === 200,
      `ALLOW editor token → disable its OWN ${noun}`);
    ok((await rest("owner", kind, { method: "DELETE", query: { id: mine.id } })).status === 200,
      `ALLOW editor token → DELETE its OWN ${noun}`);

    // An ADMIN token keeps scope "all": ownership never refuses it.
    ok((await rest("admin", kind, { method: "PUT", query: { id: foreign.id }, body: { name: "admin-edit" } })).status === 200,
      `ALLOW admin token → PUT any ${noun} (scope "all" is unchanged)`);
    ok((await rest("legacy", kind, { method: "DELETE", query: { id: foreign.id } })).status === 200,
      `ALLOW legacy (roleless = admin) token → DELETE any ${noun} — no live integration loses a power`);

    // An EDITOR token with no minting account has no principal to act as. It fails
    // CLOSED, in the one refusal shape.
    const seed2 = (await rest("admin", kind, { method: "POST", body: mk("for-orphan") })).body[noun];
    const orphaned = await rest("orphan", kind, { method: "PUT", query: { id: seed2.id }, body: { name: "y" } });
    ok(orphaned.status === 403 && orphaned.body.reason === "no-permission",
      `an editor token with no createdBy is REFUSED on an existing ${noun}, not waved through`);
  }
}

/* ═════ F-503 — AN EDITOR TOKEN MINTED BY AN ADMIN IS STILL AN EDITOR ═════
 *
 * The F-471 cases above all use `acc-own`, an account whose STORED scope is already
 * "own" — so they proved the plumbing and hid the defect. Minting is `requireAdmin`,
 * so on a real instance the minter of every token is an APP ADMIN, and `ownerGate`
 * passed the ACCOUNT to `gateExistingRow`, which short-circuits on `seesEverything`
 * for an admin. Result: F-471's ownership arm could not fire through any token on a
 * healthy tenant. Live, a foreign-row PUT with an editor token returned 200 and the
 * F-490 upsert silently TRANSFERRED ownership of the row.
 *
 * `tokens.editor` is exactly that token: role "editor", minted by `admin-1`, an app
 * admin with scope "all". Everything below is asserted with it, both directions.
 */
{
  const notOwner = (r) => r.status === 403 && r.body.reason === "no-permission"
    && r.body.hint === "not-owner" && r.body.needsRole === undefined;

  for (const [kind, noun, mk] of [["listeners", "listener", listenerBody], ["jobs", "job", jobBody]]) {
    // FOREIGN: written by the ADMIN token, so it is stamped `api:<tokenId>` and belongs
    // to no account at all.
    const foreign = (await rest("admin", kind, { method: "POST", body: mk("f503-foreign") })).body[noun];
    ok(foreign && foreign.id, `F-503 precondition: a foreign ${noun} exists`);

    // OWN: the editor token stamps the ACCOUNT that minted it, admin-1.
    const mine = (await rest("editor", kind, { method: "POST", body: mk("f503-mine") })).body[noun];
    ok(mine && mine.createdBy === "admin-1",
      `F-503 precondition: the admin-minted editor token stamps its minter's account (got ${mine && mine.createdBy})`);

    // THE DEFECT, stated as sharply as it can be.
    const stolen = await rest("editor", kind, { method: "PUT", query: { id: foreign.id }, body: { name: "f503-stolen" } });
    ok(notOwner(stolen),
      `F-503.BLOCK — an editor token minted by an ADMIN cannot PUT a foreign ${noun} (got ${stolen.status} ${JSON.stringify(stolen.body).slice(0, 140)})`);
    ok(((await rest("admin", kind, { query: { id: foreign.id } })).body[noun] || {}).name === "f503-foreign",
      `F-503 — …and the foreign ${noun} is untouched`);
    ok(notOwner(await rest("editor", kind, { method: "POST", query: { id: foreign.id, action: "disable" } })),
      `F-503.BLOCK — …nor disable it`);
    ok(notOwner(await rest("editor", kind, { method: "DELETE", query: { id: foreign.id } })),
      `F-503.BLOCK — …nor delete it`);

    // F-490's path: a POST that NAMES an existing foreign id is an edit, and it was the
    // ownership TRANSFER — `normalizeListener` keeps `existing.createdBy`, so the row
    // kept running under its owner while carrying the caller's body.
    ok(notOwner(await rest("editor", kind, { method: "POST", body: { ...mk("f503-hijack"), id: foreign.id } })),
      `F-503.BLOCK — an editor token minted by an admin cannot UPSERT onto a foreign ${noun} (F-490 path)`);
    ok(((await rest("admin", kind, { query: { id: foreign.id } })).body[noun] || {}).name === "f503-foreign",
      `F-503 — …and that upsert transferred nothing`);

    // THE POSITIVE CONTROL. Without it a BLOCK above could pass because the token lost
    // the power entirely, which would be a different (and also wrong) outcome.
    const own = await rest("editor", kind, { method: "PUT", query: { id: mine.id }, body: { name: "f503-renamed" } });
    ok(own.status === 200 && own.body[noun].name === "f503-renamed",
      `F-503.ALLOW — the same token PUTs its OWN ${noun} (got ${own.status})`);
    const upOwn = await rest("editor", kind, { method: "POST", body: { ...mk("f503-own-upsert"), id: mine.id } });
    ok(upOwn.status === 200 || upOwn.status === 201, `F-503.ALLOW — …and upserts onto its OWN ${noun} (got ${upOwn.status})`);
    ok(((await rest("admin", kind, { query: { id: mine.id } })).body[noun] || {}).name === "f503-own-upsert",
      `F-503.ALLOW — …and that upsert took`);

    // AN ADMIN TOKEN IS UNCHANGED: scope "all", the deliberate residual.
    ok((await rest("admin", kind, { method: "PUT", query: { id: foreign.id }, body: { name: "f503-admin-edit" } })).status === 200,
      `F-503 — an ADMIN token still edits any ${noun} (scope "all" untouched)`);
    ok((await rest("legacy", kind, { method: "PUT", query: { id: foreign.id }, body: { name: "f503-legacy-edit" } })).status === 200,
      `F-503 — …and so does a legacy roleless token`);
  }

  /* THE MINTER'S LIVE ROLE IS STILL THE CEILING (F-493's rule, on the EXISTING-row
   * routes). The token's stamp is a ceiling the admin chose; the live role is the
   * ceiling the product still grants. A demoted minter drags the token down. Uses its
   * OWN admin account so nothing above depends on the demotion. */
  await storage.set("app_admins", [
    { accountId: "admin-1", displayName: "Admin", role: "admin", scope: "all" },
    { accountId: "acc-own", displayName: "Own-scope editor", role: "editor", scope: "own" },
    { accountId: "acc-adm2", displayName: "Second admin", role: "admin", scope: "all" },
  ]);
  tokens.minted2 = (await createApiTokenInternal({ name: "minted2", accountId: "acc-adm2", role: "editor" })).token;

  for (const [kind, noun, mk] of [["listeners", "listener", listenerBody], ["jobs", "job", jobBody]]) {
    const row = (await rest("minted2", kind, { method: "POST", body: mk("f503-adm2") })).body[noun];
    ok(row && row.createdBy === "acc-adm2", `F-503 precondition: acc-adm2's editor token owns its ${noun}`);
    ok((await rest("minted2", kind, { method: "PUT", query: { id: row.id }, body: { name: "f503-adm2-renamed" } })).status === 200,
      `F-503.ALLOW — before demotion, acc-adm2's editor token edits its own ${noun}`);

    await storage.set("app_admins", [
      { accountId: "admin-1", displayName: "Admin", role: "admin", scope: "all" },
      { accountId: "acc-own", displayName: "Own-scope editor", role: "editor", scope: "own" },
      { accountId: "acc-adm2", displayName: "Demoted second admin", role: "viewer", scope: "all" },
    ]);
    const after = await rest("minted2", kind, { method: "PUT", query: { id: row.id }, body: { name: "f503-after" } });
    ok(after.status === 403 && after.body.reason === "no-permission" && after.body.needsRole === "editor"
      && after.body.hint === "ask-app-admin",
      `F-503.BLOCK — a DEMOTED minter's editor token may no longer edit even its OWN ${noun} (got ${after.status} ${JSON.stringify(after.body).slice(0, 160)})`);
    ok(((await rest("admin", kind, { query: { id: row.id } })).body[noun] || {}).name === "f503-adm2-renamed",
      `F-503 — …and nothing was written`);

    // Restore for the next iteration / the F-493 block below.
    await storage.set("app_admins", [
      { accountId: "admin-1", displayName: "Admin", role: "admin", scope: "all" },
      { accountId: "acc-own", displayName: "Own-scope editor", role: "editor", scope: "own" },
      { accountId: "acc-adm2", displayName: "Second admin", role: "admin", scope: "all" },
    ]);
  }
}

/* ═════ F-493 — A CREATE RE-READS THE OWNING ACCOUNT'S LIVE ROLE ═════
 *
 * A token's role is a stamp made at mint time. Every route on an EXISTING row re-reads
 * the account through `gateExistingRow`; the CREATE route read only the stamp, so an
 * editor token kept minting live, enabled rules after its owner was demoted or
 * deactivated — rules the product's own UI would have refused that person, and which
 * nobody but an admin could govern afterwards (the owner cannot edit them either).
 *
 * Deliberately LAST in this file: it demotes `acc-own`, and every assertion above needs
 * that account to still hold the editor role. */
{
  const bodies = [["listeners", listenerBody], ["jobs", jobBody]];
  // ALLOW first, so the BLOCK below cannot pass because the route was broken all along.
  for (const [kind, mk] of bodies) {
    ok((await rest("owner", kind, { method: "POST", body: mk("while-editor") })).status === 201,
      `F-493.ALLOW — an editor token whose account still holds the role creates ${kind}`);
  }

  await storage.set("app_admins", [
    { accountId: "admin-1", displayName: "Admin", role: "admin", scope: "all" },
    // Bob left the team: the app admin took his editor role away. His token was never revoked.
    { accountId: "acc-own", displayName: "Demoted", role: "viewer", scope: "own" },
  ]);

  for (const [kind, mk] of bodies) {
    const r = await rest("owner", kind, { method: "POST", body: mk("after-demotion") });
    ok(r.status === 403 && r.body.reason === "no-permission" && r.body.needsRole === "editor",
      `F-493.BLOCK — a demoted owner's token may no longer create ${kind} (got ${r.status} ${JSON.stringify(r.body).slice(0, 160)})`);
    ok((await rest("admin", kind, { method: "GET" })).body[kind].every((x) => x.name !== "after-demotion"),
      `…and nothing was written for ${kind}`);
    // The ADMIN token is unchanged and documented as such: it is scope "all", it has
    // always survived its minter's demotion, and narrowing it would break live
    // integrations silently on upgrade.
    ok((await rest("admin", kind, { method: "POST", body: mk("admin-still-can") })).status === 201,
      `F-493 — an ADMIN token still creates ${kind} (the deliberate residual)`);
  }
}

// ONE ownership home: the verdict is asked in src/index.js, never re-derived here.
{
  const fs = await import("node:fs");
  const src = maskComments(fs.readFileSync(new URL("../../src/rules-api.js", import.meta.url), "utf8"));
  ok(/gateExistingRow/.test(src) && !/createdBy === /.test(src),
    "rules-api.js asks gateExistingRow and owns no ownership comparison of its own");
}

console.log(`rules-api roles: ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
