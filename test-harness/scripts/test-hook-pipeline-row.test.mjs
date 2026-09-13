/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * F-627 — THE PIPELINE-ROW TEST DOOR, AND ITS GATE.
 *
 * F-604, F-605 and F-611 are fixes to ONE state of a `git_pipeline:*` row that no door on
 * a tenant could produce: a repository whose committed scaffold is older than the one this
 * build installs (`outdated`), or a setup run that died and left "queued" behind (`stuck`).
 * A setup always stamps the CURRENT `SCAFFOLD_VERSION`, so the three fixes were
 * render-proven and live-unprovable. `pipelineRow` is their door.
 *
 * A test door is a door. What this suite proves:
 *  · IT IS 404 WITHOUT THE SECRET — no bearer, a wrong bearer, and (the one that matters
 *    in production) no HARNESS_SECRET configured at all, with nothing written on any of
 *    those paths;
 *  · A SECRET IS NEVER PLANTABLE. A body naming a token, an api key, a web-trigger URL or
 *    a `COGNIRUNNER_KEY_*` slot — at the top level or nested inside `scaffoldVars` — is
 *    refused outright, and the refusal happens BEFORE the row is read or written;
 *  · EVERY FIELD IS CLAMPED server-side: the scaffold version to 1..SCAFFOLD_VERSION, the
 *    age to seven days, the status to the two the product writes, the scaffold variables
 *    to the ones the scaffold DECLARES and through the product's own `scaffoldVarError`;
 *  · THE PERMISSION LOCK IS NOT PLANTABLE. `lockHash`/`lockScopes` are written as their
 *    empty values whatever the body says — that is the objection the invoke allow-list
 *    recorded against ever making this row plantable, and it is answered by construction;
 *  · IT NEVER TOUCHES A REAL ROW: a plant over an un-planted row is 409, and so is a clear;
 *  · THE PLANTED STATE IS THE PRODUCT'S. `publicPipelineRow` and the three predicates in
 *    src/shared/git-pipeline-state.js — the same functions the Code tab renders from — are
 *    called on the stored row and must agree with what the driver asked for;
 *  · `triggerGitDeploy` IS REACHABLE, AND ONLY ON AN OUTDATED ROW. On anything else the
 *    hook refuses `not-outdated` before the resolver runs; on an outdated row the REAL
 *    resolver answers F-611's `pipeline_outdated` and no provider call is made.
 *
 * Run: node scripts/test-hook-pipeline-row.test.mjs (auto-discovered by run-offline.mjs)
 */

import "../lib/register-mocks-index.mjs";
import storage from "../lib/mock-kvs.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const SECRET = "harness-secret-627";
const CONN = "gc_f627";
const REPO = "leanzero-srl/cognirunner-offshoot";
const ADMIN = "acct-admin";

const { testStateTrigger } = await import("../../src/test-hook.js");
const { gitPipelineKey } = await import("../../src/shared/git-ids.js");
const { SCAFFOLD_VERSION } = await import("../../src/shared/git-scaffolds.js");
const { pipelineOutdated, pipelineLive, pipelineStuck } = await import("../../src/shared/git-pipeline-state.js");
const { publicPipelineRow } = await import("../../src/git-pipeline.js");
const { plantHarnessConnection } = await import("../../src/git-connections.js");

const KEY = gitPipelineKey(CONN, REPO);

const post = async (body, { bearer = SECRET } = {}) => {
  const res = await testStateTrigger({
    method: "POST",
    headers: bearer === null ? {} : { authorization: `Bearer ${bearer}` },
    body: JSON.stringify(body),
  });
  let parsed = null; try { parsed = JSON.parse(res.body); } catch { /* text */ }
  return { status: res.statusCode, body: parsed, raw: res.body };
};
const plant = (extra = {}) => post({ action: "pipelineRow", op: "plant", connId: CONN, repoId: REPO, ...extra });
const rawRow = async () => (await storage.get(KEY)) ?? null;

/* ═════ 1. THE GATE ═════ */
process.env.HARNESS_SECRET = "";
{
  const r = await post({ action: "pipelineRow", op: "read", connId: CONN, repoId: REPO });
  ok(r.status === 404, `with NO HARNESS_SECRET configured the whole hook is 404 (got ${r.status})`);
}
process.env.HARNESS_SECRET = SECRET;
{
  const none = await post({ action: "pipelineRow", op: "plant", connId: CONN, repoId: REPO }, { bearer: null });
  ok(none.status === 404, `no bearer -> 404, and no detail (got ${none.status} ${none.raw})`);
  const wrong = await post({ action: "pipelineRow", op: "plant", connId: CONN, repoId: REPO }, { bearer: "not-the-secret" });
  ok(wrong.status === 404, `a wrong bearer -> 404 (got ${wrong.status})`);
  ok((await rawRow()) === null, "…and neither refused call wrote a row");
}

/* ═════ 2. THE INPUT GUARDS ═════ */
{
  ok((await post({ action: "pipelineRow", op: "plant", connId: "has spaces", repoId: REPO })).status === 400, "a malformed connId is 400");
  ok((await post({ action: "pipelineRow", op: "plant", connId: CONN, repoId: "no-slash" })).status === 400, "a repoId that is not owner/name is 400");
  ok((await post({ action: "pipelineRow", op: "nonsense", connId: CONN, repoId: REPO })).status === 400, "an unknown op is 400");
  ok((await rawRow()) === null, "…and none of the refused calls wrote a row");
}

/* ═════ 3. A SECRET IS NEVER PLANTABLE ═════ */
{
  const cases = [
    ["token", { token: "ghp_abcdefgh12345678" }],
    ["apiKey", { apiKey: "whatever" }],
    ["a nested scaffoldVars.token", { scaffoldVars: { APP_NAME: "app", token: "x" } }],
    ["a password field", { password: "hunter2" }],
    ["a COGNIRUNNER_KEY_* value under an innocent name", { note: "read COGNIRUNNER_KEY_openai" }],
    ["a web-trigger URL value", { callback: "https://abc.atlassian-dev.net/x1/deadbeef" }],
    ["a bare sk- key value", { note: "sk-proj-ABCDEFGHIJKL" }],
  ];
  for (const [what, extra] of cases) {
    const r = await plant(extra);
    ok(r.status === 400 && r.body && r.body.harnessRefusal === "secret-field",
      `plant carrying ${what} is refused secret-field (got ${r.status} ${r.raw.slice(0, 140)})`);
  }
  ok((await rawRow()) === null, "…and not one of those refusals wrote a row — the check is BEFORE the side effect");
}

/* ═════ 4. PLANT — an OUTDATED installed row, and the product's own predicates ═════ */
let planted = null;
{
  const r = await plant({ scaffoldVersion: 1, status: "installed", scaffoldVars: { APP_NAME: "offshoot", UI_DIR: "static/app" }, developerSpaceId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", appId: "11111111-2222-3333-4444-555555555555", branch: "trunk" });
  ok(r.status === 200 && r.body.ok === true, `plant answers 200 (got ${r.status} ${r.raw.slice(0, 200)})`);
  ok(r.body.key === KEY, "…on the key `gitPipelineKey` builds, not a retyped string");
  planted = await rawRow();
  ok(planted && planted.plantedBy === "harness", "…the stored row is stamped plantedBy:harness");
  ok(planted.scaffoldVersion === 1 && planted.status === "installed" && typeof planted.installedAt === "string",
    `…with the version, status and installedAt asked for (got ${JSON.stringify({ v: planted.scaffoldVersion, s: planted.status })})`);
  ok(planted.branch === "trunk" && planted.developerSpaceId === "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" && String(planted.appId).endsWith("11111111-2222-3333-4444-555555555555"),
    "…and the branch, developer space and app id the driver named");
  ok(planted.scaffoldVars && planted.scaffoldVars.APP_NAME === "offshoot" && planted.scaffoldVars.UI_DIR === "static/app",
    "…the DECLARED scaffold variables are stored, which is what F-604's prefill reads");

  ok(pipelineOutdated(planted) === true, "the PRODUCT's pipelineOutdated says the planted row is outdated — F-604/F-605/F-611's state, live at last");
  ok(pipelineLive(planted) === false && pipelineStuck(planted) === false, "…and it is neither live nor stuck: it is installed");
  const projected = publicPipelineRow(planted);
  ok(projected.outdated === true && projected.currentScaffoldVersion === SCAFFOLD_VERSION && typeof projected.outdatedReason === "string",
    "…and `publicPipelineRow` — the exact projection the Code tab renders — agrees, with the changelog reason");
  ok(r.body.predicates && r.body.predicates.outdated === true && r.body.row && r.body.row.outdated === true,
    "…the door's own answer carries both, so a driver never restates the rule");
}

/* ═════ 5. THE PERMISSION LOCK IS NOT PLANTABLE ═════ */
{
  ok(planted.lockHash === null && Array.isArray(planted.lockScopes) && planted.lockScopes.length === 0,
    `lockHash/lockScopes are empty on a planted row (got ${JSON.stringify({ h: planted.lockHash, s: planted.lockScopes })})`);
  // …and a body that ASKS for them changes nothing: the row is built field by field.
  await post({ action: "pipelineRow", op: "clear", connId: CONN, repoId: REPO });
  const r = await plant({ scaffoldVersion: 1, lockHash: "deadbeef", lockScopes: ["manage:app-access-rule"], commitSha: "abc123", requestedBy: "somebody" });
  ok(r.status === 200, "a body naming lockHash/lockScopes is accepted (they are not credentials)…");
  const row = await rawRow();
  ok(row.lockHash === null && row.lockScopes.length === 0 && row.commitSha === null && row.requestedBy === null,
    `…but NONE of them reaches storage (got ${JSON.stringify({ h: row.lockHash, s: row.lockScopes, c: row.commitSha, r: row.requestedBy })})`);
  const keys = Object.keys(row).map((k) => k.toLowerCase());
  ok(!keys.some((k) => k.includes("token") || k.includes("secret") || k.includes("password")),
    `…and the stored row carries no credential-shaped field at all (got ${JSON.stringify(Object.keys(row))})`);
}

/* ═════ 6. THE CLAMPS ═════ */
{
  await post({ action: "pipelineRow", op: "clear", connId: CONN, repoId: REPO });
  const high = await plant({ scaffoldVersion: 999 });
  ok((await rawRow()).scaffoldVersion === SCAFFOLD_VERSION,
    `a scaffoldVersion above the current one is clamped DOWN to ${SCAFFOLD_VERSION} — a row can never claim to be newer than the build`);
  ok(high.body.row.outdated === false, "…and such a row is, correctly, not outdated");

  await post({ action: "pipelineRow", op: "clear", connId: CONN, repoId: REPO });
  await plant({ scaffoldVersion: -5 });
  ok((await rawRow()).scaffoldVersion === 1, "a scaffoldVersion below 1 is clamped UP to 1");

  await post({ action: "pipelineRow", op: "clear", connId: CONN, repoId: REPO });
  await plant({ scaffoldVersion: 1, ageMs: 99 * 24 * 3600 * 1000 });
  const aged = await rawRow();
  ok(Date.now() - Date.parse(aged.installedAt) <= 7 * 24 * 3600 * 1000 + 5000, "ageMs is clamped to seven days");

  ok((await plant({ status: "running" })).status === 400, 'a status outside {installed, queued} is 400 — "running" is the consumer\'s to write');
  ok((await plant({ branch: "no spaces here" })).status === 400, "a malformed branch is 400");
  ok((await plant({ scaffoldVars: "nope" })).status === 400, "a non-object scaffoldVars is 400");
  ok((await plant({ scaffoldVars: { UI_DIR: "../../etc" } })).status === 400,
    "a scaffold variable the PRODUCT would refuse (path traversal) is refused here too, through scaffoldVarError");
  ok((await plant({ developerSpaceId: "NOT A SPACE ID" })).status === 400, "a malformed developerSpaceId is 400");
  ok((await plant({ appId: "not-a-uuid" })).status === 400, "a malformed appId is 400");

  await post({ action: "pipelineRow", op: "clear", connId: CONN, repoId: REPO });
  await plant({ scaffoldVars: { APP_NAME: "app", NOT_A_DECLARED_VAR: "x" } });
  ok(!Object.prototype.hasOwnProperty.call((await rawRow()).scaffoldVars, "NOT_A_DECLARED_VAR"),
    "a scaffold variable the scaffold does not DECLARE never reaches storage");
}

/* ═════ 7. THE STUCK-QUEUED ROW (F-605) ═════ */
{
  await post({ action: "pipelineRow", op: "clear", connId: CONN, repoId: REPO });
  const r = await plant({ status: "queued", scaffoldVersion: 1, ageMs: 30 * 60 * 1000 });
  const row = await rawRow();
  ok(row.status === "queued" && row.installedAt === null, "a queued plant carries no installedAt — nothing was committed");
  ok(pipelineStuck(row) === true && pipelineLive(row) === false,
    "…and past the 10-minute claim window the PRODUCT's pipelineStuck says stuck, which is F-605's banner");
  ok(pipelineOutdated(row) === false, "…while `outdated` stays FALSE: a row that never installed has no stale bytes (the F-611 rule)");
  ok(r.body.predicates.stuck === true && r.body.row.stuck === true, "…and the door's answer and the tab's projection agree");

  await post({ action: "pipelineRow", op: "clear", connId: CONN, repoId: REPO });
  const fresh = await plant({ status: "queued", scaffoldVersion: 1, ageMs: 0 });
  ok(fresh.body.predicates.live === true && fresh.body.predicates.stuck === false, "a freshly queued plant is LIVE, not stuck");
}

/* ═════ 8. IT NEVER TOUCHES A REAL ROW ═════ */
{
  await storage.set(KEY, { connId: CONN, repoId: REPO, status: "installed", scaffoldVersion: 1, installedAt: new Date().toISOString() });
  const over = await plant({ scaffoldVersion: 1 });
  ok(over.status === 409 && over.body.harnessRefusal === "not-planted",
    `a plant over a row this door did not plant is 409 not-planted (got ${over.status})`);
  const cleared = await post({ action: "pipelineRow", op: "clear", connId: CONN, repoId: REPO });
  ok(cleared.status === 409 && cleared.body.harnessRefusal === "not-planted", "…and so is a clear — a real pipeline record is never destroyed here");
  ok((await rawRow()) !== null, "…the real row is still there");
  await storage.delete(KEY);
}

/* ═════ 9. triggerGitDeploy — reachable, and ONLY on an outdated row (F-611) ═════ */
{
  storage.__seed("app_admins", [{ accountId: ADMIN, displayName: "Admin", role: "admin", scope: "all" }]);
  const conn = await plantHarnessConnection({ id: CONN, kind: "github", repoId: REPO });
  ok(conn.ok === true, `(fixture) a tokenless stand-in connection exists (got ${JSON.stringify(conn.error || "ok")})`);

  await post({ action: "pipelineRow", op: "clear", connId: CONN, repoId: REPO });
  const deploy = (payload) => post({ action: "invokeResolver", functionKey: "triggerGitDeploy", accountId: ADMIN, payload });

  const noRow = await deploy({ connectionId: CONN, repo: REPO, confirm: true });
  ok(noRow.status === 400 && noRow.body.harnessRefusal === "not-outdated" && noRow.body.hasRow === false,
    `with no row at all the hook refuses not-outdated BEFORE the resolver (got ${noRow.status} ${noRow.raw.slice(0, 140)})`);

  await plant({ scaffoldVersion: SCAFFOLD_VERSION, status: "installed" });
  const current = await deploy({ connectionId: CONN, repo: REPO, confirm: true });
  ok(current.status === 400 && current.body.harnessRefusal === "not-outdated" && current.body.outdated === false,
    "a CURRENT row is refused too — the hook can never reach a dispatch that would really run");

  await post({ action: "pipelineRow", op: "clear", connId: CONN, repoId: REPO });
  await plant({ scaffoldVersion: 1, status: "installed" });
  const outdated = await deploy({ connectionId: CONN, repo: REPO, confirm: true });
  ok(outdated.status === 200, `on an OUTDATED row the call reaches the REAL resolver (got ${outdated.status} ${outdated.raw.slice(0, 160)})`);
  ok(outdated.body && outdated.body.success === false && outdated.body.code === "pipeline_outdated",
    `…which answers F-611's pipeline_outdated (got ${JSON.stringify(outdated.body)})`);
  ok(typeof outdated.body.error === "string" && outdated.body.error.includes("Set up the pipeline again"),
    "…with the SAME remedy sentence the Code tab shows, from PIPELINE_OUTDATED_REMEDY");
}

/* ═════ 10. READ / CLEAR ═════ */
{
  const read = await post({ action: "pipelineRow", op: "read", connId: CONN, repoId: REPO });
  ok(read.status === 200 && read.body.planted === true && read.body.row.repoId === REPO, "read returns the planted row through publicPipelineRow");
  const cleared = await post({ action: "pipelineRow", op: "clear", connId: CONN, repoId: REPO });
  ok(cleared.status === 200 && cleared.body.row === null, "clear removes it and says so");
  const after = await post({ action: "pipelineRow", op: "read", connId: CONN, repoId: REPO });
  ok(after.status === 200 && after.body.row === null && after.body.predicates.outdated === false,
    "a second read after the clear is empty, and the predicates answer about nothing rather than throwing");
}

console.log(`test-hook-pipeline-row (F-627): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
