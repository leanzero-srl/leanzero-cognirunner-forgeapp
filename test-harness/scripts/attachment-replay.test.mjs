/* CogniRunner - Copyright (C) 2025 LeanZero. SPDX-License-Identifier: AGPL-3.0-or-later */
import "../lib/register-mocks-index.mjs";
import assert from "node:assert/strict";
import storage from "../lib/mock-kvs.mjs";
const { serveAttachment, serveAttachmentUpload } = await import("../../src/index.js");
const { default: jira } = await import("@forge/api");
const { claimRuleExecution } = await import("../../src/shared/execution-claim.js");
jira.__respond((path) => ({ ...jira.__response(200, path.includes("/attachments") ? [{ id: "101" }] : { filename: "test.txt" }), arrayBuffer: async () => Buffer.from("test") }));
for (const [handler, prefix, record, expectedCalls] of [
  [serveAttachmentUpload, "upload_token:", { issueKey: "ABC-1" }, 1],
  [serveAttachment, "att_token:", { attachmentId: "101" }, 2],
]) {
  const token = "race", key = prefix + token;
  const req = { queryParameters: { t: [token] }, headers: { authorization: ["Bearer secret"] }, body: JSON.stringify({ filename: "test.txt", data: "dGVzdA==" }) };
  const seed = () => { storage.__reset(); storage.__seed(key, { ...record, bearer: "secret", expiresAt: Date.now() + 60000 }); jira.__calls.length = 0; };
  seed();
  const results = await Promise.all([handler(req), handler(req)]);
  assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 404], prefix);
  assert.equal(jira.__calls.length, expectedCalls, "one request owns the capability");
  assert.equal((await handler(req)).statusCode, 404);
  for (const operation of ["set", "delete"]) {
    seed();
    const original = storage[operation];
    storage[operation] = async () => { throw Error("storage unavailable"); };
    try {
      assert.equal((await handler(req)).statusCode, 500);
      assert.equal((await handler(req)).statusCode, operation === "delete" ? 404 : 500);
      assert.equal(jira.__calls.length, 0, "storage failure must not reach Jira");
    } finally { storage[operation] = original; }
  }
  seed();
  const bad = await handler({ ...req, headers: { authorization: ["Bearer wrong"] } });
  assert.equal(bad.statusCode, 401);
  assert.equal((await handler(req)).statusCode, 200, "invalid bearer never claims a valid capability");
}
const unavailable = { set: async () => { throw Error("outage"); } };
assert.equal(await claimRuleExecution(unavailable, "rule", {}, "test"), true, "rule delivery availability policy remains unchanged");
await assert.rejects(() => claimRuleExecution(unavailable, "cap", {}, "test", { failClosed: true }), /outage/);
console.log("attachment replay: concurrent read/write capability and storage failures passed");
