/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import "../lib/register-mocks-index.mjs";
import assert from "node:assert/strict";
import storage from "../lib/mock-kvs.mjs";
const { default: forgeApi } = await import("@forge/api");
const { handler } = await import("../../src/index.js");

// Exercise the actual resolver at the registry cap, including failed workflow
// reads. Logging must not consume Forge's 100-line allowance or alter retention.
const rows = Array.from({ length: 500 }, (_, i) => ({
  id: `row-${i}`, type: "validator",
  workflow: { workflowName: `workflow-${i}`, transitionId: "11" },
}));
storage.__seed("config_registry", rows);
storage.__seed("registry_migrations", { discoveredOwnershipV1: true, registrySlimV1: true });
forgeApi.__respond((path) => {
  const name = new URL(path, "https://jira.test").searchParams.get("queryString");
  assert.ok(name, `unexpected request ${path}`);
  const number = Number(name.split("-").at(-1));
  if (number % 2 === 0) return forgeApi.__response(403, { errorMessages: ["Denied"] });
  return forgeApi.__response(200, { values: [{ name, transitions: [] }] });
});
const logs = [], saved = { log: console.log, error: console.error };
let result;
try {
  console.log = (...args) => logs.push(args);
  console.error = (...args) => logs.push(args);
  result = await handler({ call: { functionKey: "getConfigs", payload: {} }, context: {} }, {});
} finally { Object.assign(console, saved); }
assert.equal(result.success, true);
assert.deepEqual(result.configs.map((r) => r.id), rows.filter((_, i) => i % 2 === 0).map((r) => r.id));
assert.equal(result.removedCount, 250);
assert.equal((await storage.get("config_registry")).length, 250);
assert.equal(forgeApi.__calls.length, 500);
assert.ok(logs.length <= 5, `${logs.length} log lines exceed the bounded summary`);
const summary = JSON.parse(logs.find(([label]) => label === "getConfigs orphan summary:")[1]);
assert.equal(summary.checked, 500);
assert.equal(summary.retained, 250);
assert.equal(summary.removed, 250);
assert.equal(summary.failedWorkflows, 250);
assert.equal(summary.partial, true);
assert.equal(summary.errorExamples.length, 5);
assert.equal(summary.removedExamples.length, 5);
assert.ok(summary.errorExamples.every((e) => e.error.includes("403")));
assert.ok(JSON.stringify(logs).length < 2500);
console.log("registry logging: 500 actual rows checked, 250 denied retained, bounded diagnostics passed");
