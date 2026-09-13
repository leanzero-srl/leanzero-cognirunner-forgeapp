/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Offline: the GIT CONNECTION resolvers in src/index.js and their one home,
// src/git-connections.js, driven through the REAL resolver handler on a mock
// KVS and a stubbed global fetch.
//
// What this file is here to prove, in order of how badly it would hurt:
//  1. NO RESOLVER EVER RETURNS A SECRET. Every return value of every git
//     resolver is DEEP-SCANNED for the planted token, app password, Forge API
//     token and webhook secret — including nested objects and arrays, so a
//     future "just add the row to the response" cannot pass.
//  2. The admin gate: every one of these resolvers refuses a non-admin through
//     the one refusal shape (reason "no-permission").
//  3. Consent is REQUIRED to store a deploy identity, and it is recorded.
//  4. A dead credential is refused at save (never stored) and marks the row
//     LOUDLY when it dies later (the banner has one source).
//  5. Caps are checked BEFORE the side effect, and the repo allow-list fails
//     closed (empty allows nothing).
//
// Run: node scripts/git-connections.test.mjs   (auto-discovered by run-offline.mjs)

import { readFile } from "node:fs/promises";

import "../lib/register-mocks-index.mjs";
import storage from "../lib/mock-kvs.mjs";
import { pushed as pushedEvents } from "../lib/mock-forge-api.mjs";

const conns = await import("../../src/git-connections.js");
const { handler } = await import("../../src/index.js");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const ADMIN = "acct-admin";
const VIEWER = "acct-viewer";
const NOBODY = "acct-nobody";
const EDITOR = "acct-editor";

/* ---- the planted secrets. Nothing may echo any of these. ---- */
const GH_TOKEN = "ghp_PLANTED_CONNECTION_TOKEN_0123456789";
const BB_TOKEN = "ATATT_PLANTED_BITBUCKET_APP_PASSWORD_987";
const FORGE_TOKEN = "ATATT_PLANTED_FORGE_API_TOKEN_abcdefghij";
const SECRETS = [GH_TOKEN, BB_TOKEN, FORGE_TOKEN];

/* ---- stubbed fetch: a scripted queue of responses ---- */
let fetchQueue = [];
let fetchCalls = [];
const res = (status, body, headers = {}) => ({
  status,
  headers: { get: (k) => headers[String(k).toLowerCase()] ?? null },
  async json() { return body; },
  async text() { return JSON.stringify(body); },
});
globalThis.fetch = async (url, init) => {
  // The BODY is recorded too (F-481): proving the rotation window accepts the right
  // secret means comparing what we PATCHed to the provider against what we stored.
  fetchCalls.push({ url, method: (init && init.method) || "GET", body: (init && init.body) || null });
  if (!fetchQueue.length) throw new Error("unexpected fetch: " + url);
  const next = fetchQueue.shift();
  if (next instanceof Error) throw next;
  return next;
};
const whoamiOk = (login = "leanzero-bot", scopes = "repo, workflow, admin:repo_hook") =>
  res(200, { login, id: 42, name: "LeanZero Bot" }, { "x-oauth-scopes": scopes });

const reset = () => {
  storage.__reset();
  storage.__seed("app_admins", [
    { accountId: ADMIN, displayName: "Admin", role: "admin", scope: "all" },
    { accountId: VIEWER, displayName: "Viewer", role: "viewer", scope: "own" },
    { accountId: EDITOR, displayName: "Editor", role: "editor", scope: "all" },
  ]);
  fetchQueue = [];
  fetchCalls = [];
};
const call = (functionKey, payload = {}, accountId = ADMIN) =>
  handler({ call: { functionKey, payload } }, { principal: { accountId } });

/* ---- the deep scan: every resolver return is checked against every secret ---- */
const returned = [];
async function callScanned(functionKey, payload = {}, accountId = ADMIN) {
  const r = await call(functionKey, payload, accountId);
  returned.push({ functionKey, r });
  return r;
}
function findSecret(value, needle, path = "$") {
  if (typeof value === "string") return value.includes(needle) ? path : null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = findSecret(value[i], needle, `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const k of Object.keys(value)) {
      // The KEY itself must not be a secret either.
      if (k.includes(needle)) return `${path}.${k} (key)`;
      const hit = findSecret(value[k], needle, `${path}.${k}`);
      if (hit) return hit;
    }
    return null;
  }
  return null;
}

/* ===================== 1. the admin gate ===================== */
reset();
const GIT_RESOLVERS = [
  "listGitConnections", "saveGitConnection", "testGitConnection", "setGitRepoAllowlist",
  "deleteGitConnection", "saveForgeIdentity", "clearForgeIdentity", "getForgeIdentityStatus",
  "rotateGitCredential",
];
for (const key of GIT_RESOLVERS) {
  for (const who of [VIEWER, NOBODY]) {
    const r = await call(key, { id: "x", consent: true, token: GH_TOKEN, email: "a@b.c" }, who);
    ok(r && r.success === false && r.reason === "no-permission",
      `${key} refuses ${who} through the one refusal shape (got ${JSON.stringify(r)})`);
  }
}
ok(fetchCalls.length === 0, "a refused resolver never reaches the network");

/* ===================== 2. save: whoami first, then store ===================== */
reset();
fetchQueue = [whoamiOk()];
const saved = await callScanned("saveGitConnection", {
  kind: "github", label: "LeanZero org", token: GH_TOKEN, repos: ["LeanZero/App", "leanzero/app", " leanzero/other "],
});
ok(saved.success === true, `save succeeds (${JSON.stringify(saved).slice(0, 200)})`);
ok(fetchCalls.length === 1 && /\/user$/.test(fetchCalls[0].url), "the credential is VERIFIED with whoami before it is stored");
const connId = saved.connection.id;
ok(saved.connection.hasToken === true, "the public row says a credential EXISTS");
ok(saved.connection.tokenSlot === undefined, "the public row does not even carry the key NAME");
ok(saved.connection.login === "leanzero-bot", "the row records who the credential is");
ok(JSON.stringify(saved.connection.repos) === JSON.stringify(["leanzero/app", "leanzero/other"]),
  `repo ids are normalised and de-duplicated (got ${JSON.stringify(saved.connection.repos)})`);
ok(saved.connection.capabilities.canWebhooks === true && saved.connection.capabilities.canPipelines === true,
  "capability flags come from the token's own reported scopes");

/* ---- F-532: the row records WHICH ACCOUNT, not just what it is called ---- */
//
// `ignoreSelf` compares the delivery's actor to this row. A LABEL is not an
// identity: on Bitbucket whoami answers `username` while a PR-comment delivery
// labels the same human with their `nickname`, so a label-only row made the guard
// inert and the app answered its own PR comments. The id is stored at the one
// moment we hold a fresh whoami, and it is a public account id — never anything
// derived from the credential (the secret scan below covers every field here).
ok(saved.connection.userId === "42", `the GitHub numeric id is stored beside the login (${saved.connection.userId})`);
ok(saved.connection.userUuid === null && saved.connection.userAccountId === null,
  "…and the Bitbucket-only fields stay null rather than being invented for GitHub");
ok(storage.__raw(conns.gitConnKey(connId)).userId === "42", "the id is on the STORED row, not only in the response");

// the token is where it should be, and the row is not.
ok(storage.__raw(conns.gitConnSecretKey(connId)).token === GH_TOKEN, "the token lives under its own key");
ok(!JSON.stringify(storage.__raw(conns.gitConnKey(connId))).includes(GH_TOKEN), "the connection ROW never contains the token");

/* ---- an UNKNOWN scope set must not be reported as "no" ---- */
reset();
fetchQueue = [whoamiOk("fine-grained", "")];
const fg = await callScanned("saveGitConnection", { kind: "github", label: "Fine grained", token: GH_TOKEN });
ok(fg.connection.capabilities.canCreateRepos === null && fg.connection.capabilities.canWebhooks === null,
  "a token that reports NO scopes yields UNKNOWN (null), never false — an unproven negative must not read as a denial");

/* ===================== 3. the cap, before the side effect ===================== */
reset();
storage.__seed(conns.GIT_CONN_INDEX_KEY, Array.from({ length: conns.GIT_CONN_MAX }, (_, i) => `gc_${i}`));
const capped = await callScanned("saveGitConnection", { kind: "github", label: "one too many", token: GH_TOKEN });
ok(capped.success === false && capped.code === "cap", `the ${conns.GIT_CONN_MAX}-connection cap refuses (got ${JSON.stringify(capped)})`);
ok(fetchCalls.length === 0, "the cap is checked BEFORE the whoami call and before any write");
ok(storage.__raw(conns.GIT_CONN_INDEX_KEY).length === conns.GIT_CONN_MAX, "a refused save left the index untouched");

/* ===================== 4. auth_dead ===================== */
// (a) at save: a dead credential is REFUSED and never stored.
reset();
fetchQueue = [res(401, { message: "Bad credentials" })];
const dead = await callScanned("saveGitConnection", { kind: "github", label: "dead", token: GH_TOKEN });
ok(dead.success === false && dead.code === "auth_dead", `a dead credential is refused at save (got ${JSON.stringify(dead)})`);
ok((storage.__raw(conns.GIT_CONN_INDEX_KEY) || []).length === 0, "the refused save created NO connection");
ok(!JSON.stringify(dead).includes(GH_TOKEN), "the refusal does not echo the credential");

// (b) later: the row goes loudly dead, and one field is the banner's source.
reset();
fetchQueue = [whoamiOk()];
const live = await call("saveGitConnection", { kind: "github", label: "live", token: GH_TOKEN, repos: ["acme/app"] });
const liveId = live.connection.id;
fetchQueue = [res(401, { message: "Bad credentials" })];
const tested = await callScanned("testGitConnection", { id: liveId });
ok(tested.success === false && tested.code === "auth_dead", "a 401 on Test reports auth_dead");
ok(storage.__raw(conns.gitConnKey(liveId)).status === "auth_dead", "and it is RECORDED on the row — the banner is never silent");
ok(typeof storage.__raw(conns.gitConnKey(liveId)).authDeadAt === "string", "with the moment it died");
const listedDead = await callScanned("listGitConnections", {});
ok(listedDead.connections[0].status === "auth_dead", "the list surfaces the dead status");

// (c) a TRANSIENT fault must NOT raise the credential alarm.
fetchQueue = [whoamiOk()];
await call("testGitConnection", { id: liveId });
ok(storage.__raw(conns.gitConnKey(liveId)).status === "ok", "a successful Test clears a stale banner");
fetchQueue = [res(500, { message: "upstream" }), res(500, { message: "upstream" })];
const flaky = await callScanned("testGitConnection", { id: liveId });
ok(flaky.success === false && flaky.transient === true, `a 5xx is reported as transient (got ${JSON.stringify(flaky)})`);
ok(storage.__raw(conns.gitConnKey(liveId)).status === "ok", "a network blip does NOT mark the credential dead");

// (d) a dead connection refuses to produce a provider at all (fail closed).
await conns.markAuthDead(liveId, "test");
let threw = null;
try { await conns.providerForConnection(liveId, { repo: "acme/app" }); } catch (e) { threw = e; }
ok(threw && threw.code === "auth_dead", "providerForConnection refuses on a dead connection");

// (e) F-292 — the EXECUTION path marks the row too, not just Test.
// A lost `git_conn_secret:<id>` used to make every agent action and PR review
// throw while `status` stayed "ok": a healthy-looking connection, no banner,
// and the only way to learn the truth was to press Test.
reset();
fetchQueue = [whoamiOk()];
const ex = await call("saveGitConnection", { kind: "github", label: "exec", token: GH_TOKEN, repos: ["acme/app"] });
const exId = ex.connection.id;
await storage.delete(conns.gitConnSecretKey(exId));
threw = null;
try { await conns.providerForConnection(exId, { repo: "acme/app" }); } catch (e) { threw = e; }
ok(threw && threw.code === "auth_dead", "a missing credential still fails closed");
ok(storage.__raw(conns.gitConnKey(exId)).status === "auth_dead",
  `…and it is RECORDED, so the banner appears without pressing Test (got ${JSON.stringify(storage.__raw(conns.gitConnKey(exId)).status)})`);

// …and a credential the PROVIDER rejects mid-action marks the row on the way out,
// with the error rethrown unchanged.
reset();
fetchQueue = [whoamiOk()];
const ex2 = await call("saveGitConnection", { kind: "github", label: "exec2", token: GH_TOKEN, repos: ["acme/app"] });
const ex2Id = ex2.connection.id;
const prov = await conns.providerForConnection(ex2Id, { repo: "acme/app" });
fetchQueue = [res(401, { message: "Bad credentials" })];
threw = null;
try { await prov.whoami(); } catch (e) { threw = e; }
ok(threw && threw.code === "auth_dead", "a 401 from an adapter call is rethrown UNCHANGED (never swallowed)");
ok(storage.__raw(conns.gitConnKey(ex2Id)).status === "auth_dead",
  "…and the execution path routed it to markAuthDead — one writer, no silent gate");
// a transient fault from the same wrapper must NOT raise the alarm.
reset();
fetchQueue = [whoamiOk()];
const ex3 = await call("saveGitConnection", { kind: "github", label: "exec3", token: GH_TOKEN, repos: ["acme/app"] });
const ex3Id = ex3.connection.id;
const prov3 = await conns.providerForConnection(ex3Id, { repo: "acme/app" });
fetchQueue = [res(500, { message: "upstream" }), res(500, { message: "upstream" }), res(500, { message: "upstream" })];
try { await prov3.whoami(); } catch (e) { /* expected */ }
ok(storage.__raw(conns.gitConnKey(ex3Id)).status === "ok", "a 5xx through the wrapper does NOT mark the credential dead");
// and a later successful Test clears the flag (already the rule — proven for the execution-marked row).
fetchQueue = [res(401, { message: "Bad credentials" })];
try { await prov3.whoami(); } catch (e) { /* expected */ }
ok(storage.__raw(conns.gitConnKey(ex3Id)).status === "auth_dead", "the wrapper marked it");
fetchQueue = [whoamiOk()];
await call("testGitConnection", { id: ex3Id });
ok(storage.__raw(conns.gitConnKey(ex3Id)).status === "ok", "a successful Test clears a flag the execution path set");

/* ===================== 5. the repo allow-list fails CLOSED ===================== */
reset();
fetchQueue = [whoamiOk()];
const al = await call("saveGitConnection", { kind: "github", label: "al", token: GH_TOKEN, repos: [] });
const alId = al.connection.id;
ok(conns.isRepoAllowed(storage.__raw(conns.gitConnKey(alId)), "acme/app") === false,
  "an EMPTY allow-list allows nothing — 'nothing listed' never means 'everything'");
ok(conns.isRepoAllowed({}, "acme/app") === false, "a row with no repos field allows nothing");
ok(conns.isRepoAllowed({ repos: ["acme/app"] }, "ACME/App") === true, "matching is case-insensitive");
ok(conns.isRepoAllowed({ repos: ["acme/app"] }, "") === false, "a blank repo id is never allowed");
threw = null;
try { await conns.providerForConnection(alId, { repo: "acme/app" }); } catch (e) { threw = e; }
ok(threw && threw.code === "not_supported", "a repo off the allow-list cannot produce a provider");

const tooMany = await callScanned("setGitRepoAllowlist", {
  id: alId, repos: Array.from({ length: conns.REPO_ALLOWLIST_MAX + 1 }, (_, i) => `acme/r${i}`),
});
ok(tooMany.success === false && tooMany.code === "cap", "the allow-list cap refuses");
ok(storage.__raw(conns.gitConnKey(alId)).repos.length === 0, "and the refused set wrote nothing");
const setOk = await callScanned("setGitRepoAllowlist", { id: alId, repos: ["Acme/App"] });
ok(setOk.success === true && setOk.connection.repos[0] === "acme/app", "a valid allow-list is stored normalised");

/* ===================== 6. delete erases the credential ===================== */
reset();
fetchQueue = [whoamiOk()];
const del = await call("saveGitConnection", { kind: "github", label: "del", token: GH_TOKEN, repos: ["acme/app"] });
const delId = del.connection.id;
await conns.ensureHookSecret(delId, "acme/app");
ok(!!storage.__raw(conns.gitHookSecretKey(delId, "acme/app")), "a per-repo hook secret exists");
const gone = await callScanned("deleteGitConnection", { id: delId });
ok(gone.success === true, "delete succeeds");
ok(storage.__raw(conns.gitConnSecretKey(delId)) === undefined, "the credential is ERASED");
ok(storage.__raw(conns.gitConnKey(delId)) === undefined, "the row is erased");
ok(storage.__raw(conns.gitHookSecretKey(delId, "acme/app")) === undefined, "the per-repo hook secret is erased");
ok((storage.__raw(conns.GIT_CONN_INDEX_KEY) || []).length === 0, "the index no longer lists it");
const gone2 = await callScanned("deleteGitConnection", { id: delId });
ok(gone2.success === false && gone2.code === "not_found", "deleting it twice is a clean not_found");

/* ===================== 7. per-repo webhook secrets ===================== */
reset();
const h1 = await conns.ensureHookSecret("c1", "acme/app");
const h1b = await conns.ensureHookSecret("c1", "acme/app");
ok(h1.created === true && h1b.created === false && h1.secret === h1b.secret,
  "ensureHookSecret is create-if-absent — re-running setup does not invalidate the installed hook");
const h2 = await conns.ensureHookSecret("c1", "acme/other");
ok(h2.secret !== h1.secret, "the secret is PER REPO — one leak does not forge deliveries for another repo");
ok(/^[0-9a-f]{64}$/.test(h1.secret), "the secret is 32 random bytes, hex");
// F-483 — ONE RULE, ONE HOME. `rotateHookSecret` was a SECOND implementation of
// "rotate the hook secret": it replaced the stored secret with NO provider call (so
// the hook kept signing with the old one and every delivery 401'd) and it RETURNED
// the secret, which this module's "secrets never leave" rule forbids. It had no
// caller — the only queued rotation task is gitcredrotate → applyCredentialRotation.
// It is gone, and the module must expose exactly ONE exported rotate path so it
// cannot grow back. The real rotation is exercised in section 13 (F-460/F-481).
ok(conns.rotateHookSecret === undefined,
  "the callerless no-provider rotateHookSecret is GONE — hook-secret rotation has one home");
ok(typeof conns.rotateGitHookSecret === "function",
  "…and that home is rotateGitHookSecret (pending slot → provider → promote)");
{
  const src = await readFile(new URL("../../src/git-connections.js", import.meta.url), "utf8");
  const rotateExports = (src.match(/^export\s+(?:async\s+)?function\s+\w*[Rr]otate\w*/gm) || [])
    .map((m) => m.replace(/^export\s+(?:async\s+)?function\s+/, ""));
  ok(rotateExports.length === 1 && rotateExports[0] === "rotateGitHookSecret",
    `SOURCE: exactly one exported rotate path in git-connections.js (found ${JSON.stringify(rotateExports)})`);
  ok(!/\bfunction\s+rotateHookSecret\b/.test(src),
    "SOURCE: rotateHookSecret is not redefined anywhere in the module");
}
ok((await conns.getHookSecret("c1", "nope/none")) === null,
  "an unknown repo yields null — the WEBHOOK's answer to null is 401, never 'unsigned is fine'");

/* ===================== 8. the Forge deploy identity ===================== */
reset();
const noConsent = await callScanned("saveForgeIdentity", { email: "dev@acme.com", token: FORGE_TOKEN });
ok(noConsent.success === false && noConsent.code === "consent_required",
  `a MISSING consent flag is a refusal, never a default-yes (got ${JSON.stringify(noConsent)})`);
ok(storage.__raw(conns.FORGE_IDENTITY_KEY) === undefined, "and nothing was stored");
for (const c of [false, "true", 1, null, undefined, {}]) {
  const r = await callScanned("saveForgeIdentity", { email: "dev@acme.com", token: FORGE_TOKEN, consent: c });
  ok(r.success === false && r.code === "consent_required", `consent ${JSON.stringify(c)} is refused — only a literal true consents`);
}
const idOk = await callScanned("saveForgeIdentity", { email: "dev@acme.com", token: FORGE_TOKEN, consent: true });
ok(idOk.success === true && idOk.status.hasIdentity === true, "an explicit consent stores the identity");
ok(idOk.status.consent.accountId === ADMIN && typeof idOk.status.consent.at === "string",
  "the consent records WHO agreed and WHEN");
ok(storage.__raw(conns.FORGE_IDENTITY_KEY).token === FORGE_TOKEN, "the token is stored");
const status = await callScanned("getForgeIdentityStatus", {});
ok(status.status.hasIdentity === true && status.status.email === "dev@acme.com", "the status is a boolean plus the email");
ok(!("token" in status.status), "the status shape has no token field at all");
const cleared = await callScanned("clearForgeIdentity", {});
ok(cleared.success === true && cleared.status.hasIdentity === false, "clear reports no identity");
ok(storage.__raw(conns.FORGE_IDENTITY_KEY) === undefined, "and the row is gone");
const cleared2 = await callScanned("clearForgeIdentity", {});
ok(cleared2.success === true, "clearing twice is not an error — 'make sure it is gone' is always answerable");
threw = null;
try { await conns.readForgeIdentity(); } catch (e) { threw = e; }
ok(threw && threw.code === "auth_dead", "readForgeIdentity FAILS CLOSED — it never yields a blank credential");

/* ===================== 9. rotation is queued, never inline ===================== */
reset();
fetchQueue = [whoamiOk()];
const rot = await call("saveGitConnection", { kind: "github", label: "rot", token: GH_TOKEN });
const rotId = rot.connection.id;
fetchCalls = [];
const queued = await callScanned("rotateGitCredential", { target: { kind: "connection", id: rotId }, token: "ghp_NEW" });
ok(queued.success === true && queued.queued === true && typeof queued.taskId === "string",
  `rotate ENQUEUES and returns a task id (got ${JSON.stringify(queued)})`);
ok(fetchCalls.length === 0, "the resolver itself performs no rotation and no provider call");
ok(storage.__raw(conns.gitConnSecretKey(rotId)).token === GH_TOKEN, "the stored credential is UNCHANGED until the consumer runs");

// the consumer half: a bad replacement changes nothing.
fetchQueue = [res(401, { message: "Bad credentials" })];
const badRot = await conns.applyCredentialRotation({ target: { kind: "connection", id: rotId }, secret: { token: "ghp_DEAD" } });
ok(badRot.ok === false, "a rejected replacement refuses");
ok(storage.__raw(conns.gitConnSecretKey(rotId)).token === GH_TOKEN,
  "and the OLD credential still works — a failed rotation never locks the tenant out");
fetchQueue = [whoamiOk()];
const goodRot = await conns.applyCredentialRotation({ target: { kind: "connection", id: rotId }, secret: { token: "ghp_GOOD" } });
ok(goodRot.ok === true && storage.__raw(conns.gitConnSecretKey(rotId)).token === "ghp_GOOD", "a verified replacement lands");
const unknownTarget = await conns.requestCredentialRotation({ kind: "nonsense" }, { token: "x" });
ok(unknownTarget.ok === false, "an unknown rotation target is refused");

// F-295 — the queued path enforces the SAME token cap as the resolver writes,
// before the push. It used to push params.secret verbatim.
const huge = "g".repeat(conns.TOKEN_MAX_CHARS + 1);
const tooLong = await callScanned("rotateGitCredential", { target: { kind: "connection", id: rotId }, token: huge });
ok(tooLong.success === false && /implausibly long/i.test(String(tooLong.error)),
  `an implausibly long replacement is refused BEFORE the queue (got ${JSON.stringify(tooLong).slice(0, 160)})`);
const emptyTok = await callScanned("rotateGitCredential", { target: { kind: "connection", id: rotId }, token: "   " });
ok(emptyTok.success === false && /replacement token is required/i.test(String(emptyTok.error)),
  `an empty replacement is refused (got ${JSON.stringify(emptyTok).slice(0, 160)})`);
ok(storage.__raw(conns.gitConnSecretKey(rotId)).token === "ghp_GOOD", "and neither refusal touched the stored credential");
// …and the consumer half caps too, so no path reaches a write unchecked.
const applyHuge = await conns.applyCredentialRotation({ target: { kind: "connection", id: rotId }, secret: { token: huge } });
ok(applyHuge.ok === false && /implausibly long/i.test(String(applyHuge.error)), "applyCredentialRotation caps before the side effect");
ok(storage.__raw(conns.gitConnSecretKey(rotId)).token === "ghp_GOOD", "the oversized apply wrote nothing");

// F-303 — A ROTATION NEVER FABRICATES A CONSENT.
// F-293 fixed one defect and created its mirror image: `{...prev}` used to carry
// admin A's consent onto a token admin B handed over later (a STALE record), so the
// fix stamped a fresh consent naming B — a record asserting that B sat through a
// consent screen they were never shown. There is no consent flag on the rotation
// path at all; `saveForgeIdentity` refuses without an explicit `consent:true`, so
// the rotation path CANNOT have collected one. Two facts, two fields: the original
// `consent` is kept verbatim, and who replaced the token is recorded under
// `rotation`.
reset();
const idA = await call("saveForgeIdentity", { email: "a@leanzero.net", token: FORGE_TOKEN, consent: true }, ADMIN);
ok(idA.success === true, `the identity saves (${JSON.stringify(idA).slice(0, 120)})`);
const consentA = (await conns.getForgeIdentityStatus()).consent;
ok(consentA.accountId === ADMIN, "the first consent names the admin who gave it");
await new Promise((r) => setTimeout(r, 5));
const ROT_AT = new Date(Date.now() + 1000).toISOString();
const rotId2 = await conns.applyCredentialRotation({
  target: { kind: "forge-identity" }, secret: { token: "ATATT_ROTATED_TOKEN" },
  requestedBy: "acct-admin-b", enqueuedAt: ROT_AT, taskId: "rot_1",
});
ok(rotId2.ok === true, "the identity rotation applies");
const statusB = await conns.getForgeIdentityStatus();
ok(statusB.consent.accountId === ADMIN && statusB.consent.at === consentA.at,
  `the ORIGINAL consent record survives a rotation verbatim (got ${JSON.stringify(statusB.consent)})`);
ok(statusB.rotation && statusB.rotation.requestedBy === "acct-admin-b",
  `who replaced the token is recorded SEPARATELY, under rotation (got ${JSON.stringify(statusB.rotation)})`);
ok(statusB.rotation.at === ROT_AT,
  "…and `at` is the moment the ADMIN asked (enqueuedAt), not the consumer's clock");
ok(storage.__raw(conns.FORGE_IDENTITY_KEY).token === "ATATT_ROTATED_TOKEN", "the new token is stored");
ok(!JSON.stringify(statusB).includes("ATATT_"), "and the status still emits no token");

// F-304 — AT-LEAST-ONCE DELIVERY MUST NOT RESURRECT AN OLDER CREDENTIAL.
// A redelivery of the SAME event does nothing…
const replay = await conns.applyCredentialRotation({
  target: { kind: "forge-identity" }, secret: { token: "ATATT_REPLAYED" },
  requestedBy: "acct-admin-b", enqueuedAt: ROT_AT, taskId: "rot_1",
});
ok(replay.ok === true && replay.duplicate === true,
  `a redelivered rotation is a no-op, not an error (got ${JSON.stringify(replay)})`);
ok(storage.__raw(conns.FORGE_IDENTITY_KEY).token === "ATATT_ROTATED_TOKEN",
  "…and the stored token is untouched by the replay");
ok(storage.__raw(conns.gitRotateClaimKey("forge-identity")) === undefined,
  "the lock key is git_rotate:<target> and it is RELEASED on completion — it is a lock, not a receipt");
ok(storage.__raw(conns.FORGE_IDENTITY_KEY).rotatedTaskId === "rot_1",
  "…and per-delivery idempotency lives in the ROW, as rotatedTaskId (F-336)");

// …and a LATE delivery of an OLDER rotation never overwrites a newer one. This is
// the scenario in the finding: an admin mistypes a token, rotates again to fix it,
// and Forge redelivers the first event afterwards.
const late = await conns.applyCredentialRotation({
  target: { kind: "forge-identity" }, secret: { token: "ATATT_MISTYPED" },
  requestedBy: "acct-admin-b", enqueuedAt: new Date(Date.parse(ROT_AT) - 60000).toISOString(), taskId: "rot_0",
});
ok(late.ok === false && late.code === "stale",
  `an older rotation arriving late is REFUSED (got ${JSON.stringify(late)})`);
ok(storage.__raw(conns.FORGE_IDENTITY_KEY).token === "ATATT_ROTATED_TOKEN",
  "…and the newer token survives — nothing reverts");

// A rotation that does NOT complete puts its claim back, or the platform's retry
// would be swallowed and the admin's change lost for good.
const failed = await conns.applyCredentialRotation({
  target: { kind: "forge-identity" }, secret: { token: huge },
  requestedBy: ADMIN, enqueuedAt: new Date(Date.now() + 5000).toISOString(), taskId: "rot_retry",
});
ok(failed.ok === false && /implausibly long/i.test(String(failed.error)), "the identity arm caps the token too");
ok(!storage.__raw(conns.gitRotateClaimKey("forge-identity")),
  "a refused rotation RELEASES its lock, so the next attempt is not refused as busy");
const retried = await conns.applyCredentialRotation({
  target: { kind: "forge-identity" }, secret: { token: "ATATT_RETRIED" },
  requestedBy: ADMIN, enqueuedAt: new Date(Date.now() + 5000).toISOString(), taskId: "rot_retry",
});
ok(retried.ok === true, "…and the retry applies");
ok(storage.__raw(conns.FORGE_IDENTITY_KEY).token === "ATATT_RETRIED", "the retried token is stored");

// An unattributed rotation records no requester and still never invents a consent.
const anon = await conns.applyCredentialRotation({
  target: { kind: "forge-identity" }, secret: { token: "ATATT_ANON" },
  enqueuedAt: new Date(Date.now() + 10000).toISOString(), taskId: "rot_anon",
});
const statusAnon = await conns.getForgeIdentityStatus();
ok(anon.ok === true && statusAnon.rotation.requestedBy === null,
  "an unattributed rotation records NO requester — it never inherits somebody else's name");
ok(statusAnon.consent.accountId === ADMIN, "…and the original consent is STILL the one on file");
ok(storage.__raw(conns.FORGE_IDENTITY_KEY).token === "ATATT_ANON", "the anonymous rotation wrote its token");

// The CONNECTION arm carries the same two guards.
reset();
fetchQueue = [whoamiOk()];
const cSaved = await call("saveGitConnection", { kind: "github", label: "rot", token: GH_TOKEN });
const cId = cSaved.connection.id;
const CONN_AT = new Date(Date.now() + 1000).toISOString();
fetchQueue = [whoamiOk()];
const cRot = await conns.applyCredentialRotation({
  target: { kind: "connection", id: cId }, secret: { token: "ghp_ROTATED" },
  requestedBy: ADMIN, enqueuedAt: CONN_AT, taskId: "crot_1",
});
ok(cRot.ok === true, `the connection rotation applies (${JSON.stringify(cRot)})`);
const cReplay = await conns.applyCredentialRotation({
  target: { kind: "connection", id: cId }, secret: { token: "ghp_REPLAY" },
  requestedBy: ADMIN, enqueuedAt: CONN_AT, taskId: "crot_1",
});
ok(cReplay.duplicate === true && storage.__raw(conns.gitConnSecretKey(cId)).token === "ghp_ROTATED",
  "a redelivered CONNECTION rotation is a no-op too");
const cLate = await conns.applyCredentialRotation({
  target: { kind: "connection", id: cId }, secret: { token: "ghp_OLD" },
  requestedBy: ADMIN, enqueuedAt: new Date(Date.parse(CONN_AT) - 60000).toISOString(), taskId: "crot_0",
});
ok(cLate.ok === false && cLate.code === "stale" && storage.__raw(conns.gitConnSecretKey(cId)).token === "ghp_ROTATED",
  `a late older CONNECTION rotation is refused and nothing reverts (got ${JSON.stringify(cLate)})`);
ok(fetchCalls.length === 2,
  "a refused-by-ordering rotation never even probes the provider — the guard is BEFORE the side effect");

// F-336 — TWO ROTATIONS OF ONE CONNECTION MUST NOT RACE.
// The finding's scenario: an admin pastes a token with a trailing space, sees the
// connection go auth_dead, and immediately submits the correct one. Both events are
// on the queue. The guard is a per-TARGET lock plus an ordering compare, so the
// SECOND-ENQUEUED request is the one whose credential is left in the box — whatever
// order the two probes happen to finish in.
reset();
fetchQueue = [whoamiOk()];
const rSaved = await call("saveGitConnection", { kind: "github", label: "race", token: GH_TOKEN });
const rId = rSaved.connection.id;
const T1 = new Date(Date.now() + 1000).toISOString();
const T2 = new Date(Date.now() + 2000).toISOString();
fetchQueue = [whoamiOk(), whoamiOk()];
// The NEWER request lands first; the older one arrives after and must be refused.
const good = await conns.applyCredentialRotation({
  target: { kind: "connection", id: rId }, secret: { token: "ghp_GOOD" },
  requestedBy: ADMIN, enqueuedAt: T2, taskId: "rot_b",
});
const bad = await conns.applyCredentialRotation({
  target: { kind: "connection", id: rId }, secret: { token: "ghp_BAD_TRAILING_SPACE" },
  requestedBy: ADMIN, enqueuedAt: T1, taskId: "rot_a",
});
ok(good.ok === true, `the second-enqueued rotation applies (${JSON.stringify(good)})`);
ok(bad.ok === false && bad.code === "stale", `the first-enqueued one, arriving later, is REFUSED (${JSON.stringify(bad)})`);
ok(storage.__raw(conns.gitConnSecretKey(rId)).token === "ghp_GOOD",
  "the credential the admin actually wanted is the one stored");

// EQUAL enqueuedAt is the gap the old strict `<` left open: both applied, and the
// slower probe won. The tiebreak is the taskId, so there is exactly one winner.
reset();
fetchQueue = [whoamiOk()];
const eSaved = await call("saveGitConnection", { kind: "github", label: "tie", token: GH_TOKEN });
const eId = eSaved.connection.id;
const SAME = new Date(Date.now() + 1000).toISOString();
fetchQueue = [whoamiOk(), whoamiOk()];
const tieHigh = await conns.applyCredentialRotation({
  target: { kind: "connection", id: eId }, secret: { token: "ghp_TIE_B" },
  requestedBy: ADMIN, enqueuedAt: SAME, taskId: "rot_b",
});
const tieLow = await conns.applyCredentialRotation({
  target: { kind: "connection", id: eId }, secret: { token: "ghp_TIE_A" },
  requestedBy: ADMIN, enqueuedAt: SAME, taskId: "rot_a",
});
ok(tieHigh.ok === true && tieLow.ok === false && tieLow.code === "stale",
  `two rotations in the SAME millisecond have one deterministic winner (${JSON.stringify(tieLow)})`);
ok(storage.__raw(conns.gitConnSecretKey(eId)).token === "ghp_TIE_B",
  "…and the loser never reaches the write");

// A rotation running while another holds the target's lock is refused BUSY, and it
// never probes the provider — the refusal is before the side effect.
reset();
fetchQueue = [whoamiOk()];
const bSaved = await call("saveGitConnection", { kind: "github", label: "busy", token: GH_TOKEN });
const bId = bSaved.connection.id;
storage.__seed(conns.gitRotateClaimKey(bId), { at: new Date().toISOString(), target: "connection" });
const probesBefore = fetchCalls.length;
const busy = await conns.applyCredentialRotation({
  target: { kind: "connection", id: bId }, secret: { token: "ghp_BUSY" },
  requestedBy: ADMIN, enqueuedAt: new Date(Date.now() + 3000).toISOString(), taskId: "rot_busy",
});
ok(busy.ok === false && busy.code === "busy", `a rotation held off by the lock answers busy (${JSON.stringify(busy)})`);
ok(fetchCalls.length === probesBefore, "…and it never probes the provider");
ok(storage.__raw(conns.gitConnSecretKey(bId)).token === GH_TOKEN, "…and nothing was written");

// A KVS fault taking the lock is NOT a conflict: it fails closed and writes nothing.
storage.__failNextSet();
const lockFault = await conns.applyCredentialRotation({
  target: { kind: "connection", id: bId }, secret: { token: "ghp_FAULT" },
  requestedBy: ADMIN, enqueuedAt: new Date(Date.now() + 4000).toISOString(), taskId: "rot_fault",
});
ok(lockFault.ok === false && lockFault.code === "claim_failed",
  `a KVS fault on the lock fails CLOSED, it is not reported as a duplicate (${JSON.stringify(lockFault)})`);
ok(storage.__raw(conns.gitConnSecretKey(bId)).token === GH_TOKEN, "…and nothing was written");

// The queued request carries the idempotency key the consumer needs.
reset();
fetchQueue = [whoamiOk()];
const qSaved = await call("saveGitConnection", { kind: "github", label: "q", token: GH_TOKEN });
const qReq = await conns.requestCredentialRotation(
  { kind: "connection", id: qSaved.connection.id }, { token: "ghp_QUEUED" }, { accountId: ADMIN });
ok(qReq.ok === true && typeof qReq.taskId === "string", "requestCredentialRotation enqueues");
const rotEvent = pushedEvents[pushedEvents.length - 1];
ok(rotEvent.body.params.taskId === qReq.taskId,
  "the taskId rides the PARAMS — the consumer is handed `params` only, and the claim needs the key");
ok(typeof rotEvent.body.params.enqueuedAt === "string",
  "…and so does enqueuedAt, which is what orders two rotations");
ok(rotEvent.concurrency && rotEvent.concurrency.limit === 1
  && rotEvent.concurrency.key === `git-rotate:${qSaved.connection.id}`,
  `the rotation is pushed with a per-connection concurrency key, limit 1 (${JSON.stringify(rotEvent.concurrency)})`);

/* ===================== 10. the security model is data, and it is asserted ===================== */
ok(conns.PIPELINE_SETUP_IS_ADMIN_RESOLVER === true,
  "pipeline setup is an ADMIN RESOLVER — flipping this has to be a visible diff");
ok(conns.CONNECTION_SECURITY_MODEL.agentReposAreAllowListed === true, "agents are confined to allow-listed repos");
ok(conns.CONNECTION_SECURITY_MODEL.repoAllowListEditableBy === "admin", "only an admin edits the allow-list");
ok(conns.CONNECTION_SECURITY_MODEL.tokensAreWriteOnly === true, "tokens are write-only");
ok(conns.CONNECTION_SECURITY_MODEL.rotationIsQueuedOnly === true, "rotation is queued-only");
ok(conns.CONNECTION_SECURITY_MODEL.harnessConnectionsAreTokenless === true, "a harness stand-in is tokenless by construction (F-339)");
ok(conns.HARNESS_STATUS === "harness" && conns.isHarnessConnection({ status: "harness" }) === true
  && conns.isHarnessConnection({ status: "ok" }) === false,
  "the stand-in status has ONE home and one predicate");
// The stand-in never carries a credential and is never returned as if it had one.
reset();
const hPlant = await conns.plantHarnessConnection({ id: "gc_h1", kind: "github", repoId: "LeanZero/Cogni" });
ok(hPlant.ok === true && hPlant.connection.hasToken === false && hPlant.connection.status === "harness",
  `the stand-in plants tokenless (${JSON.stringify(hPlant).slice(0, 140)})`);
ok(storage.__raw(conns.gitConnSecretKey("gc_h1")) === undefined, "…and no secret key exists for it");
ok((await conns.listConnections()).some((c) => c.id === "gc_h1"), "…it is INDEXED, so an admin can see and remove it");
const hProbes = fetchCalls.length;
const hTest = await conns.testConnection("gc_h1");
ok(hTest.ok === false && hTest.code === "auth_dead" && fetchCalls.length === hProbes,
  `testing a stand-in refuses in the auth_dead class without a network call (${JSON.stringify(hTest)})`);
const hDel = await conns.deleteHarnessConnection("gc_h1");
ok(hDel.ok === true, "the stand-in deletes");
ok(!(await conns.listConnections()).some((c) => c.id === "gc_h1"), "…and leaves the index");
ok(Object.isFrozen(conns.CONNECTION_SECURITY_MODEL), "and the model cannot be mutated at runtime");

/* ===================== 11. THE DEEP SCAN (runs last, over everything above) ===== */
ok(returned.length >= 20, `the scan covers every git resolver call made above (${returned.length})`);
for (const { functionKey, r } of returned) {
  for (const secret of SECRETS) {
    const hit = findSecret(r, secret);
    ok(hit === null, `${functionKey} does not return the secret (found at ${hit})`);
  }
}
// and the bitbucket app password, planted through a bitbucket save.
reset();
fetchQueue = [res(200, { username: "bb-bot", display_name: "BB Bot", account_id: "1" })];
const bb = await call("saveGitConnection", { kind: "bitbucket", label: "bb", token: BB_TOKEN, email: "bot@leanzero.net" });
ok(bb.success === true, `a bitbucket connection saves (${JSON.stringify(bb).slice(0, 160)})`);
// F-532 — the Bitbucket save above deliberately reports NO uuid, so nothing is
// invented; the next block saves a realistic whoami and checks all three fields.
ok(bb.connection.userAccountId === "1" && bb.connection.userUuid === null,
  `a whoami without a uuid stores the account_id and leaves uuid null (${JSON.stringify([bb.connection.userUuid, bb.connection.userAccountId])})`);
for (const secret of [BB_TOKEN]) {
  ok(findSecret(bb, secret) === null, "the bitbucket app password is not returned by saveGitConnection");
  ok(findSecret(await call("listGitConnections", {}), secret) === null, "…nor by listGitConnections");
  ok(findSecret(await call("testGitConnection", { id: bb.connection.id }).catch(() => ({})), secret) === null,
    "…nor by testGitConnection");
}
/* ---- F-532: the live Bitbucket shape, and Test refreshing an old row ---- */
reset();
const BB_UUID = "{b1e1a0c2-7d3f-4c2a-9a1e-000000000001}";
// The account read live on 2026-09-14 (wp-global): `username` and `nickname` are
// DIFFERENT strings on the same person, which is the whole finding.
const bbWhoami = () => res(200, { username: "mihaiwolfaenpak", nickname: "Mihai Perdum", display_name: "Mihai Perdum", uuid: BB_UUID, account_id: "557058:abc" });
fetchQueue = [bbWhoami()];
const bb2 = await callScanned("saveGitConnection", { kind: "bitbucket", label: "wp-global", token: BB_TOKEN, email: "bot@leanzero.net", repos: ["wp-global/cognirunner-forge-offshoot-bb"] });
ok(bb2.success === true, "the wp-global bitbucket connection saves");
ok(bb2.connection.login === "mihaiwolfaenpak", "the row's LABEL is whoami's username…");
ok(bb2.connection.userUuid === BB_UUID && bb2.connection.userAccountId === "557058:abc",
  `…and BOTH stable ids are stored beside it (${JSON.stringify([bb2.connection.userUuid, bb2.connection.userAccountId])})`);
ok(bb2.connection.login !== "Mihai Perdum",
  "the stored label is NOT the nickname a delivery carries — which is exactly why the id is needed");
// A connection saved before this fix has no ids. A Test must heal it, without the
// admin re-entering the credential.
const bb2Id = bb2.connection.id;
const preFix = { ...storage.__raw(conns.gitConnKey(bb2Id)) };
delete preFix.userUuid; delete preFix.userAccountId; delete preFix.userId;
storage.__seed(conns.gitConnKey(bb2Id), preFix);
ok(storage.__raw(conns.gitConnKey(bb2Id)).userUuid === undefined, "…the pre-F-532 row genuinely has no id (the negative is proven, not assumed)");
fetchQueue = [bbWhoami()];
const bbHealed = await callScanned("testGitConnection", { id: bb2Id });
ok(bbHealed.success === true, "Test succeeds on the pre-F-532 row");
ok(storage.__raw(conns.gitConnKey(bb2Id)).userUuid === BB_UUID,
  "F-532: a Test REFRESHES the identity, so an existing connection gains its id without being re-entered");
ok(findSecret(conns.publicConnection(storage.__raw(conns.gitConnKey(bb.connection.id))), BB_TOKEN) === null,
  "publicConnection is a whitelist: a secret added to the stored row cannot leak through it");
// prove the whitelist by PLANTING a token field on the stored row.
const tainted = { ...storage.__raw(conns.gitConnKey(bb.connection.id)), token: BB_TOKEN, secret: BB_TOKEN };
ok(findSecret(conns.publicConnection(tainted), BB_TOKEN) === null,
  "even a row that carries a token field emits nothing — publicConnection builds a new object, it does not spread-and-delete");

/* ===================== 12. F-373 — THE EDITOR FLOOR ============================ */
// `getRuleLists` is the ONE resolver here that a non-admin editor may call, and it is
// where a git rule's connection and repository are chosen. It used to return a flat
// UNION of every connection's allow-list, so an editor could pair connection A with a
// repository only B may read — the rule saved and then failed CLOSED forever. It now
// returns RICH rows. Two things must both hold: the editor gets enough to NARROW, and
// the editor gets nothing about anyone's CREDENTIAL.
reset();
fetchQueue = [whoamiOk()];
const cA = await call("saveGitConnection", { kind: "github", label: "Alpha org", token: GH_TOKEN, repos: ["acme/alpha", "acme/shared"] });
fetchQueue = [res(200, { username: "bb-bot", display_name: "BB Bot", account_id: "1" })];
const cB = await call("saveGitConnection", { kind: "bitbucket", label: "Beta team", token: BB_TOKEN, email: "bot@leanzero.net", repos: ["beta/web"] });
ok(cA.success === true && cB.success === true, "two connections with DIFFERENT allow-lists are set up");

const asEditor = await call("getRuleLists", {}, EDITOR);
ok(asEditor.success === true, `an editor may call getRuleLists (${JSON.stringify(asEditor).slice(0, 120)})`);
const gconns = (asEditor.lists || {}).gitconnections || [];
ok(Array.isArray(gconns) && gconns.length === 2, `the editor receives one row per connection (${gconns.length})`);

const alpha = gconns.find((c) => c.label === "Alpha org");
const beta = gconns.find((c) => c.label === "Beta team");
ok(!!alpha && !!beta, "…keyed by a human label, not just an id");
ok(alpha.id === cA.connection.id && alpha.kind === "github", "the row carries id and kind, so the form can validate repo shape per provider");
ok(Array.isArray(alpha.repos) && alpha.repos.includes("acme/alpha") && alpha.repos.includes("acme/shared"), "the row carries ITS OWN repo allow-list");
// THE DEFECT, stated as an assertion: one connection's repos must not appear on another.
ok(!alpha.repos.includes("beta/web"), "F-373: connection A's row does NOT carry connection B's repository");
ok(beta.repos.length === 1 && beta.repos[0] === "beta/web", "…and B's row carries only B's");

// Every admin-only field of publicConnection must be ABSENT from every editor row.
// Enumerated against publicConnection itself, so a field added there tomorrow that is
// not in editorConnectionView's four keys fails HERE.
const EDITOR_KEYS = ["id", "kind", "label", "repos"];
const adminOnly = Object.keys(conns.publicConnection(storage.__raw(conns.gitConnKey(cA.connection.id))))
  .filter((k) => !EDITOR_KEYS.includes(k));
ok(adminOnly.includes("hasToken") && adminOnly.includes("status"), `the enumeration really covers the credential fields (${adminOnly.join(",")})`);
for (const row of gconns) {
  ok(Object.keys(row).sort().join(",") === EDITOR_KEYS.slice().sort().join(","),
    `an editor row carries EXACTLY ${EDITOR_KEYS.join("/")} (got ${Object.keys(row).join(",")})`);
  for (const k of adminOnly) {
    ok(!(k in row), `an editor row never carries the admin-only field "${k}"`);
  }
}
// hasToken/status named explicitly too — these are the two the ledger row calls out.
ok(!gconns.some((c) => "hasToken" in c), "F-373: no editor row exposes hasToken");
ok(!gconns.some((c) => "status" in c), "F-373: no editor row exposes status");
// And nothing in the whole editor-floor answer is a secret.
for (const secret of SECRETS) ok(findSecret(asEditor, secret) === null, "getRuleLists returns no secret at the editor floor");

// The flat union stays, for the `picker` source vocabulary that still reads it.
const grepos = (asEditor.lists || {}).gitrepos || [];
ok(grepos.some((r) => r.value === "acme/alpha") && grepos.some((r) => r.value === "beta/web"),
  "gitrepos is still the union, so the existing picker source keeps working");

// The projection is ONE home and it is a whitelist by construction — same proof as
// publicConnection's: plant a token on the stored row and it still emits nothing.
const taintedEd = { ...storage.__raw(conns.gitConnKey(cA.connection.id)), token: GH_TOKEN, hasToken: true, status: "auth_dead" };
const edView = conns.editorConnectionView(taintedEd);
ok(findSecret(edView, GH_TOKEN) === null, "editorConnectionView builds a new object — a planted token cannot leak through it");
ok(!("hasToken" in edView) && !("status" in edView), "…and a planted credential-health field cannot either");
ok(conns.editorConnectionView(null) === null, "editorConnectionView refuses a non-row rather than inventing one");

// A viewer is still below the floor.
const asViewer = await call("getRuleLists", {}, VIEWER);
ok(asViewer.success !== true, "a viewer is still refused the editor floor");

/* ===================== 13. F-460 — PER-REPO WEBHOOK SETUP ====================== *
 * Before this, `ensureHookSecret` / `rotateGitHookSecret` / `createWebhook` had NO
 * caller but the dev hook: an admin could add a connection, arm a git listener and
 * never receive one delivery. What must hold, in the order it would hurt:
 *   1. the SECRET never appears in a return value, on any path;
 *   2. setup is IDEMPOTENT — a second call reuses the hook whose url already points
 *      here, so a repo never ends up with two hooks double-delivering;
 *   3. rotation talks to the PROVIDER FIRST and stores only on success, so a failed
 *      rotation leaves a working hook rather than a deaf one;
 *   4. the admin gate, through the one refusal shape;
 *   5. the subscribed event list and the nine catalogue git rows are in LOCKSTEP —
 *      an event the catalogue offers but no hook subscribes to is a rule that looks
 *      armed and never fires.
 */
const { GIT_HOOK_EVENTS } = await import("../../src/git-providers.js");
const { mapGitEvent } = await import("../../src/index.js");
const { GIT_EVENT_IDS } = await import("../../src/shared/jira-events.js");

reset();
fetchQueue = [whoamiOk()];
const hookConn = await call("saveGitConnection", { kind: "github", label: "Hooks", token: GH_TOKEN, repos: ["acme/app"] });
const hookId = hookConn.connection.id;
const HOOK_URL = `https://mock.webtrigger/git-webhook?conn=${encodeURIComponent(hookId)}&repo=acme%2Fapp`;

// --- the admin gate, first: a refused call reaches neither provider nor storage.
for (const key of ["setupGitWebhook", "rotateGitWebhookSecret", "listGitWebhooks"]) {
  const r = await callScanned(key, { connectionId: hookId, repo: "acme/app" }, EDITOR);
  ok(r && r.success === false && r.reason === "no-permission", `${key} refuses an EDITOR through the one refusal shape`);
}
ok(storage.__raw(conns.gitHookSecretKey(hookId, "acme/app")) === undefined, "a refused setup minted no secret");

// --- (1) first setup: list (empty) → create exactly one hook.
fetchCalls = [];
fetchQueue = [res(200, []), res(201, { id: 4242 })];
const setup1 = await callScanned("setupGitWebhook", { connectionId: hookId, repo: "acme/app" });
ok(setup1.success === true && setup1.reused === false, `setup installs the hook (${JSON.stringify(setup1).slice(0, 200)})`);
ok(setup1.hook.hookId === "4242" && setup1.hook.provider === "github" && typeof setup1.hook.createdAt === "string", "…and reports the provider's hook id");
ok(fetchCalls.length === 2 && fetchCalls[0].method === "GET" && fetchCalls[1].method === "POST",
  `…through one list and one create (${JSON.stringify(fetchCalls.map((c) => c.method))})`);
ok(/\/repos\/acme\/app\/hooks/.test(fetchCalls[1].url), `…on the repo's hooks endpoint (${fetchCalls[1].url})`);
const hookPlanted = storage.__raw(conns.gitHookSecretKey(hookId, "acme/app"));
ok(hookPlanted && typeof hookPlanted.secret === "string" && hookPlanted.secret.length === 64, "the per-repo signing secret is stored, 32 bytes hex");
ok(setup1.connection.webhooks["acme/app"].hookId === "4242", "the connection row records the hook per repo");
ok(setup1.connection.webhooks["acme/app"].secret === undefined, "…and the record carries no secret field");
const HOOK_SECRET = hookPlanted.secret;
ok(findSecret(setup1, HOOK_SECRET) === null, "setupGitWebhook does not return the signing secret");

// --- (2) second setup: the SAME hook is reused, never duplicated.
fetchCalls = [];
fetchQueue = [res(200, [{ id: 4242, active: true, events: ["push"], config: { url: HOOK_URL } }]), res(200, { id: 4242 })];
const setup2 = await callScanned("setupGitWebhook", { connectionId: hookId, repo: "acme/app" });
ok(setup2.success === true && setup2.reused === true, `a second setup REUSES the existing hook (${JSON.stringify(setup2).slice(0, 160)})`);
ok(fetchCalls.length === 2 && fetchCalls[1].method === "PATCH", `…converging it with an update, never a second create (${fetchCalls.map((c) => c.method).join(",")})`);
ok(storage.__raw(conns.gitHookSecretKey(hookId, "acme/app")).secret === HOOK_SECRET,
  "…and it does NOT mint a new secret, which would silently invalidate the installed hook");

// --- (3) rotation: the new secret is STORED as `pending` first, then installed at the
// provider, then promoted (F-481). A happy path looks the same from outside: one PATCH,
// one new stored secret, no window left open.
fetchCalls = [];
fetchQueue = [res(200, { id: 4242 })];
const hookRot = await callScanned("rotateGitWebhookSecret", { connectionId: hookId, repo: "acme/app" });
ok(hookRot.success === true, `rotation succeeds (${JSON.stringify(hookRot).slice(0, 160)})`);
ok(fetchCalls.length === 1 && fetchCalls[0].method === "PATCH", "…through one hook-config update");
const hookSecret2 = storage.__raw(conns.gitHookSecretKey(hookId, "acme/app"));
ok(hookSecret2.secret !== HOOK_SECRET && hookSecret2.secret.length === 64, "…the stored secret is a NEW one");
ok(typeof hookSecret2.rotatedAt === "string", "…stamped with the moment it rotated");
ok(findSecret(hookRot, hookSecret2.secret) === null && findSecret(hookRot, HOOK_SECRET) === null,
  "rotateGitWebhookSecret returns neither the new secret nor the old one");
ok(typeof hookRot.connection.webhooks["acme/app"].rotatedAt === "string", "the connection row shows THAT it rotated, never the value");
ok(typeof hookRot.rotatedAt === "string", "…and the call answers WHEN it rotated, which is all the Code tab renders");
ok(storage.__raw(conns.gitConnKey(hookId)).webhooks["acme/app"].secret === undefined, "the STORED row carries no secret under webhooks either");

// a provider failure during rotation changes NOTHING.
fetchQueue = [res(404, { message: "no such hook" })];
const rotFail = await callScanned("rotateGitWebhookSecret", { connectionId: hookId, repo: "acme/app" });
ok(rotFail.success === false && rotFail.code === "not_found", `a refused rotation is named (${JSON.stringify(rotFail)})`);
ok(storage.__raw(conns.gitHookSecretKey(hookId, "acme/app")).secret === hookSecret2.secret,
  "…and the stored secret is untouched — a failed rotation leaves a WORKING hook, not a deaf one");

/* --- F-481: THE STORE IS PART OF THE ORDER GUARANTEE -------------------------
 *
 * The F-460 guarantee ("a failed rotation leaves a working webhook, not a deaf one")
 * only ever covered the PROVIDER call. The store was the second step, so a KVS fault
 * AFTER a successful PATCH left the hook signing with a secret we never kept: every
 * delivery 401s for ever and the admin sees a generic error. These arms hold the
 * guarantee over BOTH steps.
 */
const HOOK_KEY = conns.gitHookSecretKey(hookId, "acme/app");

// (a) a store fault BEFORE the provider hears anything: nothing installed, nothing changed.
fetchCalls = [];
storage.__failNextSet();
const rotStore0 = await callScanned("rotateGitWebhookSecret", { connectionId: hookId, repo: "acme/app" });
ok(rotStore0.success === false && rotStore0.code === "storage",
  `a store fault before the PATCH is named "storage" (${JSON.stringify(rotStore0)})`);
ok(fetchCalls.length === 0, "…and the provider was never called — the new secret is durable BEFORE the side effect");
ok(storage.__raw(HOOK_KEY).secret === hookSecret2.secret && !storage.__raw(HOOK_KEY).pending,
  "…and the row is exactly as it was");

// (b) THE FATAL CASE: the provider accepted the new secret, the PROMOTION throws.
fetchCalls = [];
fetchQueue = [res(200, { id: 4242 })];
// Fail the SECOND write to the hook-secret key — the promotion carries no pending slot,
// which is what distinguishes it from the pending write that precedes the PATCH.
storage.__failSetWhen((key, value) => key === HOOK_KEY && value && !value.pending);
const rotHalf = await callScanned("rotateGitWebhookSecret", { connectionId: hookId, repo: "acme/app" });
ok(rotHalf.success === false && rotHalf.code === "rotation-failed",
  `a store fault after the PATCH is named "rotation-failed", not a generic error (${JSON.stringify(rotHalf).slice(0, 200)})`);
ok(/set up webhook/i.test(String(rotHalf.error || "")),
  `…and the refusal names the REMEDY (${JSON.stringify(rotHalf.error)})`);
const halfRow = storage.__raw(HOOK_KEY);
const installed = JSON.parse(fetchCalls[0].body || "{}").config.secret;
ok(halfRow.secret === hookSecret2.secret, "the CURRENT secret is still the old one — the promotion did not happen");
ok(typeof halfRow.pending === "string" && halfRow.pending === installed,
  "…but the secret the provider now signs with is held in the PENDING slot");
ok(Date.parse(halfRow.pendingUntil) > Date.now(), "…with an expiry, so a half-rotation cannot leave two live secrets for ever");
const candidates = await conns.getHookSecretCandidates(hookId, "acme/app");
ok(candidates.length === 2 && candidates[0] === hookSecret2.secret && candidates[1] === installed,
  `the verifier is offered BOTH secrets during the window, current first (${candidates.length})`);
ok(findSecret(rotHalf, installed) === null && findSecret(rotHalf, hookSecret2.secret) === null,
  "…and the failed rotation still returns no secret of either generation");

// the failure is LOUD: the connection carries it, and the read-only door repeats it.
const halfConn = storage.__raw(conns.gitConnKey(hookId)).webhooks["acme/app"];
ok(halfConn.hookState === "rotation-failed" && typeof halfConn.hookStateAt === "string",
  `the connection row records the broken rotation, so the Code tab can say so (${JSON.stringify(halfConn)})`);
fetchQueue = [res(200, [{ id: 4242, active: true, events: GIT_HOOK_EVENTS.github.slice(), config: { url: HOOK_URL } }])];
const halfListed = await callScanned("listGitWebhooks", { connectionId: hookId, repo: "acme/app" });
ok(halfListed.success === true && halfListed.recorded.hookState === "rotation-failed",
  `listGitWebhooks surfaces the state the banner renders (${JSON.stringify(halfListed.recorded)})`);
ok(findSecret(halfListed, installed) === null, "…without carrying the pending secret anywhere");

// an EXPIRED pending slot is simply absent — the window closes on its own.
const expired = { ...storage.__raw(HOOK_KEY), pendingUntil: new Date(Date.now() - 1000).toISOString() };
storage.__seed(HOOK_KEY, expired);
ok((await conns.getHookSecretCandidates(hookId, "acme/app")).length === 1,
  "an expired pending secret is no longer accepted");
storage.__seed(HOOK_KEY, halfRow);

// (c) SELF-HEAL: the next "Set up webhook" re-installs the stored secret and closes both
// the window and the banner — the recovery path the refusal told the admin to take.
fetchCalls = [];
fetchQueue = [res(200, [{ id: 4242, active: true, events: GIT_HOOK_EVENTS.github.slice(), config: { url: HOOK_URL } }]), res(200, { id: 4242 })];
const healed = await callScanned("setupGitWebhook", { connectionId: hookId, repo: "acme/app" });
ok(healed.success === true && healed.reused === true, `the self-heal re-installs the existing hook (${JSON.stringify(healed).slice(0, 160)})`);
ok(JSON.parse(fetchCalls[1].body || "{}").config.secret === hookSecret2.secret,
  "…with the STORED current secret, so provider and store agree again");
ok(storage.__raw(HOOK_KEY).secret === hookSecret2.secret && storage.__raw(HOOK_KEY).pending === undefined,
  "…the pending slot is closed");
ok((await conns.getHookSecretCandidates(hookId, "acme/app")).length === 1, "…so exactly one secret is legal again");
ok(healed.connection.webhooks["acme/app"].hookState === null,
  `…and the loud banner is cleared only by a call that PROVED the hook healthy (${JSON.stringify(healed.connection.webhooks["acme/app"])})`);

/* --- F-491: A SECOND ROTATION ON TOP OF A HALF-DONE ONE RECONCILES, NEVER EVICTS --
 *
 * The `rotation-failed` banner invites a retry, and "Rotate secret" stays enabled.
 * Before this, that retry rebuilt the row as `{secret: OLD, pending: NEW2}` and threw
 * away NEW — the secret the provider had already been PATCHed with — so every
 * delivery 401d from that instant, and if the retry's PATCH then failed the
 * compensating write left `{secret: OLD}` and the repo was deaf until someone pressed
 * "Set up webhook". The invariant under test is the one the module claims: at every
 * instant, the secret the PROVIDER signs with is among `getHookSecretCandidates`.
 */
const providerHolds = async (expected, when) => {
  const cands = await conns.getHookSecretCandidates(hookId, "acme/app");
  ok(cands.includes(expected), `${when}: the provider's live secret is still a candidate (${cands.length} slot(s))`);
};

// Rotation A: PATCH ok, promotion throws -> the fatal shape, again.
fetchCalls = [];
fetchQueue = [res(200, { id: 4242 })];
const beforeA = storage.__raw(HOOK_KEY).secret;
storage.__failSetWhen((key, value) => key === HOOK_KEY && value && !value.pending);
const rotA = await callScanned("rotateGitWebhookSecret", { connectionId: hookId, repo: "acme/app" });
ok(rotA.success === false && rotA.code === "rotation-failed", `rotation A breaks at the promotion (${rotA.code})`);
const installedA = JSON.parse(fetchCalls[0].body || "{}").config.secret;
ok(storage.__raw(HOOK_KEY).secret === beforeA && storage.__raw(HOOK_KEY).pending === installedA,
  "…leaving {secret: OLD, pending: the secret the provider now signs with}");
await providerHolds(installedA, "after rotation A");

// Rotation B, pressed on top of it. Step 0 must PROMOTE installedA before minting.
fetchCalls = [];
fetchQueue = [res(200, { id: 4242 })];
// The eviction is a MID-rotation state — it is gone by the time the call returns — so
// the row is snapshotted at the instant of the PATCH, which is the instant a delivery
// would arrive and have to verify.
let rowAtPatchB = null;
const realFetchB = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String((init && init.method) || "") === "PATCH" && !rowAtPatchB) rowAtPatchB = storage.__raw(HOOK_KEY);
  return realFetchB(url, init);
};
const rotB = await callScanned("rotateGitWebhookSecret", { connectionId: hookId, repo: "acme/app" });
globalThis.fetch = realFetchB;
ok(rowAtPatchB && (rowAtPatchB.secret === installedA || rowAtPatchB.pending === installedA),
  `MID-rotation, the secret the provider is signing with is STILL in a slot — the retry reconciled instead of evicting (${JSON.stringify({ secret: rowAtPatchB && rowAtPatchB.secret === installedA, pending: rowAtPatchB && rowAtPatchB.pending === installedA })})`);
ok(rotB.success === true, `a second rotation on top of a broken one SUCCEEDS (${JSON.stringify(rotB).slice(0, 140)})`);
const installedB = JSON.parse(fetchCalls[0].body || "{}").config.secret;
ok(installedB !== installedA && installedB !== beforeA, "…installing a genuinely new secret at the provider");
ok(storage.__raw(HOOK_KEY).secret === installedB && storage.__raw(HOOK_KEY).pending === undefined,
  "…and the row ends on the installed secret with no window left open");
await providerHolds(installedB, "after rotation B");
ok(!(await conns.getHookSecretCandidates(hookId, "acme/app")).includes(beforeA),
  "…and the secret the provider stopped honouring at rotation A's PATCH is gone");
ok(findSecret(rotB, installedA) === null && findSecret(rotB, installedB) === null,
  "…and the reconciling rotation still returns no secret of any generation");

// The same retry, but its own PATCH fails: the provider is still signing installedC
// (rotation D's PATCH never landed), and installedC must be in a slot - never in
// neither, which is the "deaf until Set up webhook" state.
fetchCalls = [];
fetchQueue = [res(200, { id: 4242 })];
storage.__failSetWhen((key, value) => key === HOOK_KEY && value && !value.pending);
const rotC = await callScanned("rotateGitWebhookSecret", { connectionId: hookId, repo: "acme/app" });
ok(rotC.success === false && rotC.code === "rotation-failed", "rotation C breaks at the promotion again");
const installedC = JSON.parse(fetchCalls[0].body || "{}").config.secret;
await providerHolds(installedC, "after rotation C");
fetchCalls = [];
fetchQueue = [res(500, { message: "provider is down" })];
const rotD = await callScanned("rotateGitWebhookSecret", { connectionId: hookId, repo: "acme/app" });
ok(rotD.success === false, `rotation D is refused by the provider (${JSON.stringify(rotD).slice(0, 140)})`);
ok(storage.__raw(HOOK_KEY).secret === installedC,
  "…and a PATCH failure on the retry leaves the PROVIDER'S secret as the stored current one, never out of both slots");
await providerHolds(installedC, "after rotation D's provider failure");

// Self-heal from here re-installs that same secret, so provider and store agree.
fetchCalls = [];
fetchQueue = [res(200, [{ id: 4242, active: true, events: GIT_HOOK_EVENTS.github.slice(), config: { url: HOOK_URL } }]), res(200, { id: 4242 })];
const healed2 = await callScanned("setupGitWebhook", { connectionId: hookId, repo: "acme/app" });
ok(healed2.success === true && JSON.parse(fetchCalls[1].body || "{}").config.secret === installedC,
  "…and “Set up webhook” re-installs exactly that secret");
ok(healed2.connection.webhooks["acme/app"].hookState === null, "…clearing the banner");

/* --- F-504: THE PROMOTE FAILURE HAS A LEVER, SO IT IS OBSERVABLE LIVE -------------
 *
 * Everything above reaches `rotation-failed` by failing a MOCK KVS write, which exists
 * only in this process. On a real tenant there was no way to reach it at all, so F-481's
 * pending-secret acceptance window and F-491's reconcile were unproven in the only place
 * that matters. `HARNESS_FAULT_HOOK_PROMOTE` is that missing seam: same file, same env
 * gate, same one-shot counter as the dispatch lever. These arms prove the lever produces
 * the SAME state the mock fault does — and that it is inert unarmed and in production.
 */
{
  const fault = await import("../../src/harness-fault.js");
  const savedHarnessEnv = process.env.HARNESS_SECRET;
  const faultParts = [hookId, "acme/app"];
  const beforeLever = storage.__raw(HOOK_KEY).secret;

  // (a) UNARMED, env present: the lever changes nothing — a rotation still succeeds.
  process.env.HARNESS_SECRET = "dev";
  fetchCalls = [];
  fetchQueue = [res(200, { id: 4242 })];
  const leverOff = await callScanned("rotateGitWebhookSecret", { connectionId: hookId, repo: "acme/app" });
  ok(leverOff.success === true, `an UNARMED lever has no effect — the rotation completes (${JSON.stringify(leverOff).slice(0, 120)})`);
  const promoted = JSON.parse(fetchCalls[0].body || "{}").config.secret;
  ok(storage.__raw(HOOK_KEY).secret === promoted && storage.__raw(HOOK_KEY).pending === undefined,
    "…the promotion happened and the window is closed");
  ok(beforeLever !== promoted, "…(sanity) the secret really did change");

  // (b) ARMED: the promote write throws ONCE, and the outcome is the F-481 shape exactly.
  await fault.armHarnessFault(fault.HARNESS_FAULT_HOOK_PROMOTE, faultParts, 1);
  fetchCalls = [];
  fetchQueue = [res(200, { id: 4242 })];
  const levered = await callScanned("rotateGitWebhookSecret", { connectionId: hookId, repo: "acme/app" });
  ok(levered.success === false && levered.code === "rotation-failed",
    `an ARMED lever breaks the PROMOTE, and the refusal is the real one — "rotation-failed" (${JSON.stringify(levered).slice(0, 160)})`);
  const leveredInstalled = JSON.parse(fetchCalls[0].body || "{}").config.secret;
  const leveredRow = storage.__raw(HOOK_KEY);
  ok(leveredRow.secret === promoted && leveredRow.pending === leveredInstalled,
    "…the row carries BOTH secrets: current is still the old one, the installed one is pending");
  const leveredCands = await conns.getHookSecretCandidates(hookId, "acme/app");
  ok(leveredCands.length === 2 && leveredCands.includes(leveredInstalled) && leveredCands.includes(promoted),
    `…so the verifier accepts both for the window and no delivery 401s (${leveredCands.length} candidates)`);
  ok(storage.__raw(conns.gitConnKey(hookId)).webhooks["acme/app"].hookState === "rotation-failed",
    "…and the connection is stamped rotation-failed, which is what the live driver reads");
  ok(findSecret(levered, leveredInstalled) === null && findSecret(levered, promoted) === null,
    "…and a levered failure still returns no secret — the lever is not a read path");
  ok((await fault.readHarnessFault(fault.HARNESS_FAULT_HOOK_PROMOTE, faultParts)).value === null,
    "…the single armed unit was consumed: exactly ONE failure, then the retry runs for real");

  // (c) the retry: F-491's reconcile promotes the installed secret first, so nothing is evicted.
  fetchCalls = [];
  fetchQueue = [res(200, { id: 4242 })];
  const retried = await callScanned("rotateGitWebhookSecret", { connectionId: hookId, repo: "acme/app" });
  ok(retried.success === true, `the retry the banner invites now succeeds — the lever fired once only (${retried.code || "ok"})`);
  ok(storage.__raw(HOOK_KEY).pending === undefined && storage.__raw(conns.gitConnKey(hookId)).webhooks["acme/app"].hookState === null,
    "…closing both the window and the banner");

  // (d) PRODUCTION: arm the row, remove the env gate, rotate — the lever must be dead.
  await fault.armHarnessFault(fault.HARNESS_FAULT_HOOK_PROMOTE, faultParts, 1);
  delete process.env.HARNESS_SECRET;
  fetchCalls = [];
  fetchQueue = [res(200, { id: 4242 })];
  const prodRot = await callScanned("rotateGitWebhookSecret", { connectionId: hookId, repo: "acme/app" });
  ok(prodRot.success === true,
    `with HARNESS_SECRET absent (production) an armed row CANNOT break a rotation (${JSON.stringify(prodRot).slice(0, 120)})`);
  // F-522 — the READ is gated too, so with the env gone it answers `null` without
  // touching storage. The row is proved intact a line later, with the gate back on.
  ok((await fault.readHarnessFault(fault.HARNESS_FAULT_HOOK_PROMOTE, faultParts)) === null,
    "…and the read path is inert in production too — null, with no KVS read (F-522)");
  process.env.HARNESS_SECRET = "dev";
  ok((await fault.readHarnessFault(fault.HARNESS_FAULT_HOOK_PROMOTE, faultParts)).value.count === 1,
    "…and the row was not even read — a planted lever is inert, not merely unlucky");
  await fault.disarmHarnessFault(fault.HARNESS_FAULT_HOOK_PROMOTE, faultParts);
  if (savedHarnessEnv === undefined) delete process.env.HARNESS_SECRET; else process.env.HARNESS_SECRET = savedHarnessEnv;
}

// --- rotation before setup is refused, and the allow-list gates both.
fetchCalls = [];
const rotNever = await callScanned("rotateGitWebhookSecret", { connectionId: hookId, repo: "acme/other" });
ok(rotNever.success === false && rotNever.code === "forbidden", `a repo off the allow-list is refused (${JSON.stringify(rotNever)})`);
const setupOff = await callScanned("setupGitWebhook", { connectionId: hookId, repo: "acme/other" });
ok(setupOff.success === false && setupOff.code === "forbidden", "…for setup too: the allow-list is a security control, not a convenience");
ok(fetchCalls.length === 0, "…and neither reached the network");

// --- the read-only door.
fetchCalls = [];
fetchQueue = [res(200, [{ id: 4242, active: true, events: GIT_HOOK_EVENTS.github.slice(), config: { url: HOOK_URL, secret: HOOK_SECRET } }])];
const hookListed = await callScanned("listGitWebhooks", { connectionId: hookId, repo: "acme/app" });
ok(hookListed.success === true && hookListed.hooks.length === 1 && hookListed.hooks[0].hookId === "4242", `listGitWebhooks reads the provider (${JSON.stringify(hookListed).slice(0, 200)})`);
ok(findSecret(hookListed, HOOK_SECRET) === null, "…and drops the secret even when the provider echoes it back");
ok(fetchCalls.every((c) => c.method === "GET"), "…and writes nothing");

// --- (5) LOCKSTEP: every subscribed event maps, and every catalogue git row is reachable.
const GH_SAMPLES = {
  pull_request: [
    { action: "opened" }, { action: "synchronize" },
    { action: "closed", pull_request: { merged: true } }, { action: "closed", pull_request: { merged: false } },
  ],
  pull_request_review: [{ action: "submitted" }],
  issue_comment: [{ action: "created", issue: { pull_request: {} } }],
  push: [{}],
  check_run: [{ action: "completed", check_run: { status: "completed" } }],
};
const reachable = new Set();
for (const ev of GIT_HOOK_EVENTS.github) {
  const samples = GH_SAMPLES[ev] || [{}];
  const ids = samples.map((p) => mapGitEvent("github", ev, p)).filter(Boolean);
  ok(ids.length > 0, `the subscribed GitHub event "${ev}" maps to a catalogue id (mapGitEvent answers it)`);
  ids.forEach((id) => reachable.add(id));
}
for (const ev of GIT_HOOK_EVENTS.bitbucket) {
  const id = mapGitEvent("bitbucket", ev, {});
  ok(!!id, `the subscribed Bitbucket event "${ev}" maps to a catalogue id`);
  if (id) reachable.add(id);
}
ok(GIT_EVENT_IDS.length === 9, `the catalogue still has nine git rows (${GIT_EVENT_IDS.length})`);
for (const id of GIT_EVENT_IDS) {
  ok(reachable.has(id), `the catalogue event "${id}" is reachable from an event the hook SUBSCRIBES to`);
}

console.log(`git-connections: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
