/* CogniRunner - Copyright (C) 2025 LeanZero. SPDX-License-Identifier: AGPL-3.0-or-later */
import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
const source = fs.readFileSync(new URL("../../src/index.js", import.meta.url), "utf8");
const extract = name => source.match(new RegExp(`const ${name} = ([\\s\\S]*?\\n});`))[1];
let reply, stateful = false;
const ctx = vm.createContext({ getBridgeMcp: async () => ({ url: "https://example.test", stateful }),
  mcpRpc: async () => reply, mcpRpcSession: async () => reply });
const call = vm.runInContext(`(${extract("callBridgeTool")})`, ctx);
for (stateful of [false, true]) {
  for (reply of [
    { status: 200, json: { result: { isError: true, content: [{ type: "text", text: "Access denied: ".repeat(20) }] } } },
    { status: 403, json: { result: { content: [{ type: "text", text: "Long denial".repeat(20) }] } } },
    { status: 200, json: { error: { message: "RPC error" } } },
  ]) assert.ok(JSON.parse(await call("docReader", "create-markdown", {})).error);
  reply = { status: 200, json: { result: { content: [{ type: "text", text: "ordinary tool text" }] } } };
  assert.equal(await call("webSearch", "full-web-search", {}), "ordinary tool text");
}
console.log("MCP bridge: HTTP, JSON-RPC and tool errors remain errors on both transports");
