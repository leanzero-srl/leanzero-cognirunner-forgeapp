/* CogniRunner - Copyright (C) 2025 LeanZero. SPDX-License-Identifier: AGPL-3.0-or-later */
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
const source = fs.readFileSync(new URL("../../src/index.js", import.meta.url), "utf8");
const extract = name => source.match(new RegExp(`const ${name} = ([\\s\\S]*?\\n});`))[1];
let reply, calls = [];
const context = vm.createContext({
  DOC_FORMAT_TOOL: { doc: "create-doc", markdown: "create-markdown", excel: "create-excel", pdf: "create-pdf", pptx: "create-pptx" },
  DOC_FORMAT_EXT: { doc: "docx", markdown: "md", excel: "xlsx", pdf: "pdf", pptx: "pptx" },
  callBridgeTool: async (...args) => { calls.push(args); return typeof reply === "string" ? reply : JSON.stringify(reply); },
  setTimeout: () => {},
});
const create = vm.runInContext(`(${extract("callDocProcessorCreate")})`, context);
const cap = { uploadUrl: "https://example.test/upload?t=secret", uploadAuthHeader: "Bearer secret" };
for (const format of ["doc", "markdown", "excel", "pdf", "pptx"]) {
  reply = { success: true, uploaded: false, uploadError: "upload failed: HTTP 500", message: "Created locally" };
  assert.equal((await create(format, { title: "Test", content: "body" }, cap)).ok, false, `${format}: local file is not an attachment`);
  reply = { success: true, uploaded: true, uploadStatus: 200, uploadAttachment: { id: "101" } };
  assert.equal((await create(format, { title: "Test", content: "body" }, cap)).ok, true);
  assert.equal(calls.at(-1)[2].uploadUrl, cap.uploadUrl);
  assert.equal(calls.at(-1)[2].uploadAuthHeader, cap.uploadAuthHeader);
}
for (reply of [null, {}, [], "Created locally", { success: true }, { success: true, uploaded: true },
  { success: true, uploaded: true, uploadStatus: 500, uploadAttachment: { id: "101" } },
  { success: true, uploaded: true, uploadStatus: 200, uploadAttachment: {} },
  { success: false, error: "MCP failure" }]) {
  assert.equal((await create("markdown", { title: "Test", content: "body" }, cap)).ok, false, JSON.stringify(reply));
}
console.log("document upload result: all five formats require confirmed upload; malformed/local-only results fail");
