/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Exercise the actual sandbox and workflow handler. Only Forge platform I/O is mocked.
import "../lib/register-mocks-index.mjs";
import assert from "node:assert/strict";
const { runSandboxSteps, executePostFunction } = await import("../../src/index.js");
const { default: storage } = await import("@forge/kvs");
const { default: jira, pushed } = await import("@forge/api");

let passed = 0; let failed = 0;
const check = async (name, fn) => {
  try { await fn(); passed++; }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`); }
};
const functions = [
  { name: "Unconfigured", code: "" },
  { name: "First failure", code: 'throw new Error("first distinct failure");' },
  { name: "Second failure", code: 'throw new Error("second distinct failure");' },
  { name: "Later success", code: 'await api.updateIssue({ labels: ["continued"] }); api.log("later step ran");' },
];
const firstRecommendation = 'Error in "First failure": first distinct failure. Use api.log() to debug values, and Test Run with a real issue to trace the problem.';

for (const runtime of ["postfunction", "listener", "job"]) {
  await check(`${runtime} keeps first failure identity and continues all later steps`, async () => {
    jira.__reset();
    const result = await runSandboxSteps({ issueKey: "TEST-1", config: { simulationMode: true, functions }, extraContext: { runtime } });
    assert.equal(result.success, false);
    assert.equal(result.failedStep, "First failure");
    assert.equal(result.failedStepIndex, 2);
    assert.equal(result.failedStepCodeExcerpt, functions[1].code);
    assert.equal(result.recommendation, firstRecommendation);
    assert.deepEqual(result.stepResults.map(({ name, status, error }) => ({ name, status, error })), [
      { name: "Unconfigured", status: "empty", error: undefined },
      { name: "First failure", status: "error", error: "first distinct failure" },
      { name: "Second failure", status: "error", error: "second distinct failure" },
      { name: "Later success", status: "success", error: undefined },
    ]);
    assert.deepEqual(result.changes, [{ action: "updateIssue", key: "TEST-1", fields: { labels: ["continued"] }, simulated: true }]);
    assert.ok(result.logs.includes("later step ran"));
    assert.equal(jira.__calls.length, 0);
  });
}

await check("workflow handler stores matching first failure and learns from its code", async () => {
  storage.__reset(); pushed.length = 0;
  storage.__seed("COGNIRUNNER_MEMORY_SETTINGS", { autoCapture: true });
  const entries = [];
  const set = storage.set;
  storage.set = async (key, value, options) => {
    if (key.startsWith("log_entry:")) entries.push(structuredClone(value));
    return set(key, value, options);
  };
  try {
    assert.deepEqual(await executePostFunction({
      issue: { key: "TEST-1" }, context: { license: { isActive: true } },
      configuration: { type: "postfunction-static", id: "failure-reporting-test", simulationMode: true, functions },
    }), { result: true });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].isValid, false);
    assert.equal(entries[0].reason, 'Failed at "First failure": first distinct failure');
    assert.equal(entries[0].recommendation, firstRecommendation);
    assert.equal(entries[0].steps, 4);
    assert.equal(entries[0].changes, 1);
    assert.equal(entries[0].stepResults[3].status, "success");
    const learning = pushed.find((event) => event.body.taskType === "memory_distill")?.body.params;
    assert.equal(learning?.stepName, "First failure");
    assert.equal(learning?.error, "first distinct failure");
    assert.equal(learning?.codeExcerpt, functions[1].code);
    assert.equal(learning?.recommendation, firstRecommendation);
  } finally { storage.set = set; }
});

for (const offloaded of [false, true]) {
  await check(`workflow learning selects the executed duplicate-name step (${offloaded ? "offloaded" : "inline"})`, async () => {
    storage.__reset(); pushed.length = 0;
    storage.__seed("COGNIRUNNER_MEMORY_SETTINGS", { autoCapture: true });
    const duplicateFunctions = [
      { name: "Repeated name", code: 'api.log("successful first step");' },
      { name: "Repeated name", code: 'throw new Error("distinct duplicate step failure");\n//' + "x".repeat(1800) },
      { name: "Other name", code: 'throw new Error("later distinct failure");' },
      { name: "Later success", code: 'api.log("still continued");' },
    ];
    const codeRef = "pf_code:offload-first-failure";
    if (offloaded) storage.__seed(codeRef, { v: 1, functions: duplicateFunctions });
    const entries = [];
    const set = storage.set;
    storage.set = async (key, value, options) => {
      if (key.startsWith("log_entry:")) entries.push(structuredClone(value));
      return set(key, value, options);
    };
    try {
      assert.deepEqual(await executePostFunction({
        issue: { key: "TEST-1" }, context: { license: { isActive: true } },
        configuration: { type: "postfunction-static", id: `duplicate-first-error-${offloaded}`, simulationMode: true,
          functions: offloaded ? [] : duplicateFunctions, ...(offloaded ? { codeRef } : {}) },
      }), { result: true });
      assert.equal(entries.length, 1);
      assert.equal(entries[0].reason, 'Failed at "Repeated name": distinct duplicate step failure');
      assert.deepEqual(entries[0].stepResults.map((step) => step.status), ["success", "error", "error", "success"]);
      assert.equal(entries[0].steps, duplicateFunctions.length);
      const learning = pushed.filter((event) => event.body.taskType === "memory_distill");
      assert.equal(learning.length, 1);
      const params = learning[0].body.params;
      assert.equal(params.stepName, "Repeated name");
      assert.equal(params.error, "distinct duplicate step failure");
      assert.equal(params.recommendation, entries[0].stepResults[1].recommendation);
      assert.equal(params.codeExcerpt, duplicateFunctions[1].code.substring(0, 1500));
      assert.equal(params.codeExcerpt.length, 1500);
    } finally { storage.set = set; }
  });
}

await check("an empty step remains non-failing when later code succeeds", async () => {
  const result = await runSandboxSteps({ functions: [functions[0], { code: "return 1;" }] });
  assert.equal(result.success, true);
  assert.equal(result.failedStep, null);
  assert.equal(result.recommendation, undefined);
  assert.deepEqual(result.stepResults.map((step) => step.status), ["empty", "success"]);
});

await check("deadline skip reports its own recommendation instead of a preceding empty step", async () => {
  const now = Date.now;
  let tick = now();
  const deadline = tick + 20000;
  jira.__respond(() => {
    tick = deadline - 4000;
    return jira.__response(200, { key: "TEST-1" });
  });
  Date.now = () => tick;
  try {
    const result = await runSandboxSteps({ issueKey: "TEST-1", deadline, functions: [functions[0], { name: "Slow read", code: "await api.getIssue();" }, { name: "Skipped by deadline", code: "return 1;" }] });
    assert.equal(result.success, false);
    assert.equal(result.failedStep, "Skipped by deadline");
    assert.equal(result.stepResults[2].status, "timeout");
    assert.equal(result.recommendation, result.stepResults[2].recommendation);
    assert.match(result.recommendation, /earlier steps took too long/);
  } finally { Date.now = now; jira.__reset(); }
});

console.log(`Sandbox failure reporting: ${passed} passed, ${failed} failed`);
// Production step timers remain pending after quick runs; avoid waiting for those
// unrelated timers after every awaited assertion has completed.
process.exit(failed ? 1 : 0);
