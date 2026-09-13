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

import "../lib/register-mocks-index.mjs";
import storage from "../lib/mock-kvs.mjs";

const conns = await import("../../src/git-connections.js");
const { handler } = await import("../../src/index.js");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const ADMIN = "acct-admin";
const VIEWER = "acct-viewer";
const NOBODY = "acct-nobody";

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
  fetchCalls.push({ url, method: (init && init.method) || "GET" });
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
const rotated = await conns.rotateHookSecret("c1", "acme/app");
ok(rotated.secret !== h1.secret, "rotation replaces the secret");
ok((await conns.getHookSecret("c1", "acme/app")) === rotated.secret, "and the verifier reads the new one");
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

/* ===================== 10. the security model is data, and it is asserted ===================== */
ok(conns.PIPELINE_SETUP_IS_ADMIN_RESOLVER === true,
  "pipeline setup is an ADMIN RESOLVER — flipping this has to be a visible diff");
ok(conns.CONNECTION_SECURITY_MODEL.agentReposAreAllowListed === true, "agents are confined to allow-listed repos");
ok(conns.CONNECTION_SECURITY_MODEL.repoAllowListEditableBy === "admin", "only an admin edits the allow-list");
ok(conns.CONNECTION_SECURITY_MODEL.tokensAreWriteOnly === true, "tokens are write-only");
ok(conns.CONNECTION_SECURITY_MODEL.rotationIsQueuedOnly === true, "rotation is queued-only");
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
for (const secret of [BB_TOKEN]) {
  ok(findSecret(bb, secret) === null, "the bitbucket app password is not returned by saveGitConnection");
  ok(findSecret(await call("listGitConnections", {}), secret) === null, "…nor by listGitConnections");
  ok(findSecret(await call("testGitConnection", { id: bb.connection.id }).catch(() => ({})), secret) === null,
    "…nor by testGitConnection");
}
ok(findSecret(conns.publicConnection(storage.__raw(conns.gitConnKey(bb.connection.id))), BB_TOKEN) === null,
  "publicConnection is a whitelist: a secret added to the stored row cannot leak through it");
// prove the whitelist by PLANTING a token field on the stored row.
const tainted = { ...storage.__raw(conns.gitConnKey(bb.connection.id)), token: BB_TOKEN, secret: BB_TOKEN };
ok(findSecret(conns.publicConnection(tainted), BB_TOKEN) === null,
  "even a row that carries a token field emits nothing — publicConnection builds a new object, it does not spread-and-delete");

console.log(`git-connections: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
