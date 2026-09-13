/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// The REAL token lifecycle of the Rules REST API (mint → authenticate → revoke) and
// the error contract of its web trigger; only the Forge platform is mocked. Auth is
// exercised through rulesApiHandler (?resource=whoami), i.e. the shape a caller sees.
// Auto-discovered by test:offline. Run: node scripts/rules-api-tokens.test.mjs
import "../lib/register-mocks-index.mjs";
import assert from "node:assert/strict";
import storage from "../lib/mock-kvs.mjs";
const { createApiTokenInternal, revokeApiTokenInternal, listApiTokens, rulesApiHandler, API_TOKENS_KEY, REVOKED_TOKEN_PREFIX } = await import("../../src/rules-api.js");

let passed = 0; let failed = 0;
const check = async (name, fn) => {
  const get = storage.get; const set = storage.set;
  try { await fn(); passed++; }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`); }
  finally { storage.get = get; storage.set = set; }
};
const req = (token, resource = "whoami", extra = {}) => ({
  method: "GET", headers: { authorization: `Bearer ${token}` },
  queryParameters: { resource: [resource], ...(extra.query || {}) }, ...extra,
});
const call = async (...args) => { const res = await rulesApiHandler(...args); return { statusCode: res.statusCode, body: JSON.parse(res.body) }; };
const rows = () => storage.__raw(API_TOKENS_KEY) || [];
const rowOf = (id) => rows().find((r) => r.id === id);

await check("a minted token authenticates and a revoked one does not", async () => {
  storage.__reset();
  const a = await createApiTokenInternal({ name: "harness", accountId: "admin-1" });
  assert.match(a.token, /^cgr_[0-9a-f]{48}$/);
  assert.equal(a.row.hash, undefined, "the hash never leaves the module");
  const ok = await call(req(a.token));
  assert.equal(ok.statusCode, 200); assert.equal(ok.body.token.id, a.row.id);
  assert.equal((await call(req("cgr_" + "0".repeat(48)))).statusCode, 401, "unknown token");
  assert.equal((await call(req("not-a-token"))).statusCode, 401, "malformed token");
  assert.deepEqual((await call(req("cgr_" + "0".repeat(48)))).body, { error: "unauthorized" });
  await revokeApiTokenInternal(a.row.id);
  assert.equal((await call(req(a.token))).statusCode, 401, "revoked token");
  assert.ok(await storage.get(REVOKED_TOKEN_PREFIX + a.row.id), "revocation leaves a tombstone");
});

await check("a revoke landing mid-request cannot be undone by the in-flight snapshot", async () => {
  storage.__reset();
  const a = await createApiTokenInternal({ name: "in-flight", accountId: "admin-1" });
  const stale = structuredClone(rows()); // the live hash, as an in-flight request already read it
  const origGet = storage.get;
  let armed = true;
  storage.get = async (key) => {
    if (key === API_TOKENS_KEY && armed) {
      armed = false;
      await revokeApiTokenInternal(a.row.id); // the admin revokes while this request is in flight
      return structuredClone(stale);          // …and the request carries on with its snapshot
    }
    return origGet.call(storage, key);
  };
  const res = await call(req(a.token));
  storage.get = origGet;
  assert.equal(res.statusCode, 401, "the snapshot is stale: the token is already revoked");
  assert.equal(rowOf(a.row.id).hash, "revoked", "and the stale write must not put the hash back");
  assert.ok(rowOf(a.row.id).revokedAt);
  assert.equal((await call(req(a.token))).statusCode, 401, "still revoked on the next request");
});

await check("a resurrected row is still refused and still reported as revoked", async () => {
  storage.__reset();
  const a = await createApiTokenInternal({ name: "zombie", accountId: "admin-1" });
  const live = structuredClone(rows());
  await revokeApiTokenInternal(a.row.id);
  storage.__seed(API_TOKENS_KEY, live); // whatever put the live hash back (a stale write, a restore)
  assert.equal(rowOf(a.row.id).hash.length, 64, "precondition: the array says the token is live");
  assert.equal((await call(req(a.token))).statusCode, 401, "the tombstone outranks the array");
  const listed = (await listApiTokens()).find((t) => t.id === a.row.id);
  assert.ok(listed.revokedAt, "the admin list must not show a revoked token as live");
});

await check("the lastUsedAt touch merges into fresh rows instead of overwriting them", async () => {
  storage.__reset();
  const a = await createApiTokenInternal({ name: "toucher", accountId: "admin-1" });
  const stale = structuredClone(rows()); // snapshot: A only
  const b = await createApiTokenInternal({ name: "minted meanwhile", accountId: "admin-1" });
  const origGet = storage.get;
  let armed = true;
  storage.get = async (key) => {
    if (key === API_TOKENS_KEY && armed) { armed = false; return structuredClone(stale); }
    return origGet.call(storage, key);
  };
  const res = await call(req(a.token));
  storage.get = origGet;
  assert.equal(res.statusCode, 200);
  assert.equal(rows().length, 2, "the touch must not drop a token minted since its read");
  assert.ok(rowOf(b.row.id), "B survives");
  assert.equal(rowOf(b.row.id).hash.length, 64, "…with its hash intact");
  assert.ok(rowOf(a.row.id).lastUsedAt, "and A is still touched");
  assert.equal((await call(req(b.token))).statusCode, 200, "B still authenticates");
});

await check("lastUsedAt is touched at most once per hour", async () => {
  storage.__reset();
  const a = await createApiTokenInternal({ name: "quiet", accountId: "admin-1" });
  await call(req(a.token));
  const touchedAt = rowOf(a.row.id).lastUsedAt;
  assert.ok(touchedAt, "first use writes");
  const origSet = storage.set;
  const writes = [];
  storage.set = async (key, value, options) => { writes.push(key); return origSet.call(storage, key, value, options); };
  assert.equal((await call(req(a.token))).statusCode, 200);
  storage.set = origSet;
  assert.equal(writes.filter((k) => k === API_TOKENS_KEY).length, 0, "a second use within the hour writes nothing");
  assert.equal(rowOf(a.row.id).lastUsedAt, touchedAt);
});

await check("a KVS fault inside a collection still answers the JSON error contract", async () => {
  storage.__reset();
  const a = await createApiTokenInternal({ name: "faulty", accountId: "admin-1" });
  const origGet = storage.get; const origError = console.error; const logged = [];
  storage.get = async (key) => {
    if (key === "listener_index" || key === "job_index") throw new Error("kvs 429");
    return origGet.call(storage, key);
  };
  console.error = (...args) => logged.push(args.join(" "));
  try {
    for (const resource of ["listeners", "jobs"]) {
      // Without `return await` the rejection escapes the handler's try: the caller gets
      // a platform error page instead of { error }, and nothing is logged.
      const res = await call(req(a.token, resource));
      assert.equal(res.statusCode, 500, `${resource} answers 500`);
      assert.match(res.body.error, /kvs 429/, `${resource} carries the message`);
    }
    const del = await call({ ...req(a.token, "listeners", { query: { id: ["lst_x"] } }), method: "DELETE" });
    assert.equal(del.statusCode, 500); assert.match(del.body.error, /kvs 429/);
  } finally { storage.get = origGet; console.error = origError; }
  assert.equal(logged.filter((l) => l.includes("[rules-api] error:")).length, 3, "every fault is logged");
});

// F-331 — a REST refusal carries the SAME fields a resolver refusal does. The admin UI
// renders `needsRole` + `hint`; a client that got only prose had to parse a sentence.
await check("a validation refusal forwards reason, needsRole, hint and refused[]", async () => {
  const src = await import("node:fs").then((fs) => fs.readFileSync(new URL("../../src/rules-api.js", import.meta.url), "utf8"));
  const body = src.match(/const errBody = \(e\) => \(\{[\s\S]*?\}\);/)[0];
  const expr = body.replace("const errBody = (e) =>", "").replace(/;\s*$/, "");
  const errBody = new Function("e", `return (e => ${expr})(e);`);
  const e = Object.assign(new Error("nope"), { reason: "action-not-allowed", needsRole: "admin", hint: "ask-app-admin", refused: [{ id: "commit_files", reason: "needs-admin" }] });
  const out = errBody(e);
  assert.deepEqual(out, { error: "nope", reason: "action-not-allowed", needsRole: "admin", hint: "ask-app-admin", refused: [{ id: "commit_files", reason: "needs-admin" }] });
  assert.deepEqual(errBody(new Error("plain")), { error: "plain" }, "a plain error still carries only the message — no invented fields");
  assert.deepEqual(errBody(null), { error: "invalid" }, "…and a thrown non-error is still an { error }");
});

console.log(`rules-api tokens: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
