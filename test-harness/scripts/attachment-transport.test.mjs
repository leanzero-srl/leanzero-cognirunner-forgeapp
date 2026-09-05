/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import "../lib/register-mocks-index.mjs";
import assert from "node:assert/strict";
import storage from "../lib/mock-kvs.mjs";
const { serveAttachmentUpload } = await import("../../src/index.js");
const { default: forgeApi } = await import("@forge/api");

// Drive the real webtrigger, then parse its actual outbound bytes with WHATWG
// Request/FormData. A mocked HTTP 200 alone cannot detect node-fetch stream bodies
// being silently converted to "[object FormData]" by the newer Forge fetch client.
const bytes = Buffer.from([0, 255, 80, 75, 3, 4, 13, 10, 127, 128, 192, 42]);
let captured;
forgeApi.__respond(async (url, options) => {
  const request = new Request(`https://jira.example${url}`, options);
  const parsed = await request.formData();
  const file = parsed.get("file");
  captured = { url, options, file, bytes: Buffer.from(await file.arrayBuffer()) };
  return forgeApi.__response(200, [{ id: "101", filename: file.name, size: file.size, mimeType: file.type, content: "https://jira.example/attachment/101" }]);
});

const token = "offline-upload-token";
const bearer = "offline-upload-bearer";
const seed = () => storage.__seed(`upload_token:${token}`, { issueKey: "ABC-1", bearer, expiresAt: Date.now() + 60000 });
const req = (overrides = {}) => ({
  queryParameters: { t: [token] }, headers: { authorization: [`Bearer ${bearer}`] },
  body: JSON.stringify({ filename: "binary.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", data: bytes.toString("base64"), issueKey: "OTHER-2" }),
  ...overrides,
});

seed();
let result = await serveAttachmentUpload(req());
assert.equal(result.statusCode, 200, JSON.stringify(result));
assert.deepEqual(captured.bytes, bytes, "every binary byte survives multipart transport");
assert.equal(captured.file.name, "binary.pptx");
assert.equal(captured.file.type, "application/vnd.openxmlformats-officedocument.presentationml.presentation");
assert.equal(captured.url, "/rest/api/3/issue/ABC-1/attachments", "caller cannot retarget the bound capability");
assert.equal(captured.options.headers["X-Atlassian-Token"], "no-check");
assert.match(captured.options.headers["content-type"], /^multipart\/form-data; boundary=/);
assert.equal(JSON.parse(result.body).attachment.size, bytes.length);
assert.equal(await storage.get(`upload_token:${token}`), undefined);
const callsAfterUpload = forgeApi.__calls.length;
assert.equal((await serveAttachmentUpload(req())).statusCode, 404, "serial replay is rejected");
assert.equal(forgeApi.__calls.length, callsAfterUpload);

seed();
result = await serveAttachmentUpload(req({ headers: { Authorization: ["Bearer incorrect"] } }));
assert.equal(result.statusCode, 401);
assert.ok(await storage.get(`upload_token:${token}`), "wrong bearer must not burn a legitimate capability");
assert.equal(forgeApi.__calls.length, callsAfterUpload);
result = await serveAttachmentUpload(req({ body: JSON.stringify({ filename: "not-allowed.exe", data: bytes.toString("base64") }) }));
assert.equal(result.statusCode, 415);
assert.equal(forgeApi.__calls.length, callsAfterUpload);

// Empty files and text are still valid payloads; MIME defaults remain intact.
seed();
result = await serveAttachmentUpload(req({ body: JSON.stringify({ filename: "empty.txt", data: "" }) }));
assert.equal(result.statusCode, 200);
assert.equal(captured.bytes.length, 0);
assert.equal(captured.file.type, "application/octet-stream");
console.log("attachment transport: binary multipart, boundary/MIME, targeting and capability checks passed");
