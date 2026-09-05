/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// OFFLINE regression of the in-UI dry-run (`testPostFunction`) for F-004/F-008/F-017.
// The dev test-state hook does NOT allowlist testPostFunction, so this drives the very
// same src/index.js resolver locally with @forge/api mocked. Run:
//   node --import ./lib/register-mocks-index.mjs scripts/testpf-dryrun-probe.mjs
import forgeApi from "@forge/api";
import { handler } from "../../src/index.js";

let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };

forgeApi.__respond((path) => {
  if (String(path).includes("/issue/MISSING-404")) return forgeApi.__response(404, { errorMessages: ["Issue not found"] });
  const m = String(path).match(/\/rest\/api\/3\/issue\/([A-Z]+-\d+)/);
  if (m) return forgeApi.__response(200, { key: m[1], id: "1", fields: { summary: `real ${m[1]}`, status: { name: "To Do" }, labels: [] } });
  return forgeApi.__response(404, { errorMessages: ["mock: not found"] });
});

const testPF = async (payload) => handler({ call: { functionKey: "testPostFunction", payload }, context: {} }, {});

const main = async () => {
  console.log("testPostFunction (in-UI dry-run) — offline probe of the DEPLOYED source\n");

  // 1. live mode: key omitted resolves to the selected test issue
  let r = await testPF({ issueKey: "ABC-1", code: `const i = await api.getIssue(); await api.updateIssue({ labels: ["x"] }); await api.editIssue({ labels: [{ add: "y" }] }); return i.key;` });
  ok(r.success && r.mode === "live", `live mode with a selected issue: success=${r.success} mode=${r.mode}`);
  ok(r.changes.every((c) => c.key === "ABC-1"), `key-omitted writes recorded against ABC-1: ${JSON.stringify(r.changes)}`);
  ok(r.logs.some((l) => /getIssue\("ABC-1"\) — OK \(real ABC-1\)/.test(l)), "getIssue() with no key fetched the real selected issue");
  ok(!JSON.stringify(r.changes).includes("undefined"), "no `fields: undefined` — the arguments shifted");

  // 2. forIssue re-binds
  r = await testPF({ issueKey: "ABC-1", code: `await api.forIssue("ZZZ-9").transitionByName("Done"); await api.forIssue("ZZZ-9").addLabels("q"); return 1;` });
  ok(r.success && r.changes.every((c) => c.key === "ZZZ-9"), `forIssue("ZZZ-9") re-binds the dry-run surface: ${JSON.stringify(r.changes)}`);

  // 2b. forIssue also re-binds the READ (this is what the "not the resolvedKey closure" change buys)
  r = await testPF({ issueKey: "ABC-1", code: `const i = await api.forIssue("ZZZ-9").getIssue(); return i.key;` });
  ok(r.success && r.logs.some((l) => /getIssue\("ZZZ-9"\) — OK \(real ZZZ-9\)/.test(l)), `forIssue("ZZZ-9").getIssue() reads ZZZ-9, not the selected test issue: ${r.logs.join(" | ").slice(0, 200)}`);

  // 3. transitionByName exists at all (it used to be missing from testApi -> "is not a function")
  r = await testPF({ issueKey: "ABC-1", code: `await api.transitionByName("Done"); return 1;` });
  ok(r.success && r.changes.some((c) => c.key === "ABC-1" && /by name: Done/.test(String(c.transitionId))), `api.transitionByName is a function in the dry-run and targets ABC-1: ${JSON.stringify(r.changes)}`);

  // 3b. explicit keys still win, and the arity split is right for every shape
  r = await testPF({ issueKey: "ABC-1", code: `await api.updateIssue("ABC-2", { labels: ["e"] }); await api.transitionIssue("31"); await api.transitionIssue("ABC-2", "41"); await api.editIssue("ABC-2", { labels: [{ add: "f" }] }); return 1;` });
  ok(r.success && JSON.stringify(r.changes) === JSON.stringify([
    { action: "updateIssue", key: "ABC-2", fields: { labels: ["e"] } },
    { action: "transitionIssue", key: "ABC-1", transitionId: "31" },
    { action: "transitionIssue", key: "ABC-2", transitionId: "41" },
    { action: "editIssue", key: "ABC-2", update: { labels: [{ add: "f" }] } },
  ]), `arity split: explicit keys win, 1-arg transitionIssue targets the bound issue — ${JSON.stringify(r.changes)}`);

  // 3c. an issue OBJECT in the key slot throws instead of retargeting the bound issue
  r = await testPF({ issueKey: "ABC-1", code: `await api.updateIssue({ key: "ABC-2" }, { labels: ["g"] }); return 1;` });
  ok(!r.success && r.logs.some((l) => /must be a string/.test(l)) && r.changes.length === 0, `an issue object as the key throws, writes nothing: ${r.logs.filter((l) => /ERROR/.test(l))}`);

  // 4. explicit empty key throws, records nothing
  r = await testPF({ issueKey: "ABC-1", code: `await api.updateIssue("", { labels: ["nope"] }); return 1;` });
  ok(!r.success && r.logs.some((l) => /empty string/.test(l)) && r.changes.length === 0, `explicit "" throws in the dry-run too and records no change: ${r.logs.filter((l) => /ERROR/.test(l))}`);

  // 5. THE QUESTION: no issue selected (mock mode) — does the dry-run fail, or use MOCK-1?
  r = await testPF({ code: `const i = await api.getIssue(); await api.updateIssue({ labels: ["z"] }); return i.key;` });
  console.log(`  · mock mode: success=${r.success} mode=${r.mode} issueKey=${r.issueKey} changes=${JSON.stringify(r.changes)}`);
  ok(r.mode === "mock", "no issue selected -> mode 'mock'");
  ok(r.issueKey === "MOCK-1" && r.success === true && r.changes.every((c) => c.key === "MOCK-1"),
    `CHARACTERISED: with no issue selected the dry-run still binds MOCK-1 and PASSES (success=${r.success}, changes on ${JSON.stringify(r.changes.map((c) => c.key))})`);

  // Listener/job tests use the runtime API with real reads and server-forced simulation.
  for (const runtime of ["job", "listener"]) {
    const contextExtras = { runtime, issueKey: null, eventType: "test:event", event: { project: { key: "ABC" } }, job: { name: "Test job" } };
    for (const code of [`await api.getIssue();`, `await api.addComment("test");`, `await api.setAssignee("test-account");`]) {
      forgeApi.__calls.length = 0;
      r = await testPF({ code, contextExtras });
      ok(!r.success && r.mode === "simulation" && r.issueKey === null && r.logs.some((l) => /current issue.*none/.test(l)) && r.changes.length === 0,
        `${runtime}: no issue fails explicitly for ${code}`);
      ok(forgeApi.__calls.length === 0, `${runtime}: no Jira request without a target`);
    }
    forgeApi.__calls.length = 0;
    r = await testPF({ contextExtras, simulationMode: false, config: { simulationMode: false }, code: `
      const target = api.forIssue("ZZZ-9");
      const issue = await target.getIssue();
      await target.addComment("test"); await target.setAssignee("test-account");
      api.log("rebound", issue.key, api.context.issueKey, api.context.eventType, api.context.event.project.key, api.context.job.name);
      return issue.key;
    ` });
    ok(r.success && r.mode === "simulation" && r.issueKey === null && r.changes.length === 2 && r.changes.every((c) => c.key === "ZZZ-9" && c.simulated === true), `${runtime}: forIssue has real reads and simulated writes, ignores client write settings`);
    ok(r.logs.filter((l) => /\[SIMULATION\]/.test(l)).length === 2 && r.logs.filter((l) => /rebound ZZZ-9 null test:event ABC Test job/.test(l)).length === 1, `${runtime}: returns runtime logs and context exactly once`);
    ok(forgeApi.__calls.length === 1 && forgeApi.__calls.every((c) => !c.opts.method || c.opts.method === "GET"), `${runtime}: rebind emits no POST/PUT/DELETE`);

    forgeApi.__calls.length = 0;
    r = await testPF({ issueKey: "ABC-1", contextExtras, code: `const issue = await api.getIssue(); await api.setAssignee("test-account"); return issue.key;` });
    ok(r.success && r.mode === "live" && r.issueKey === "ABC-1" && r.logs.includes("Return value: ABC-1") && r.changes.length === 1 && r.changes[0].key === "ABC-1" && r.changes[0].simulated === true, `${runtime}: selected issue supports previously missing setAssignee`);
    ok(forgeApi.__calls.length === 1 && forgeApi.__calls[0].path.endsWith("/issue/ABC-1"), `${runtime}: selected issue read goes to the real target`);

    r = await testPF({ issueKey: "MISSING-404", contextExtras, code: `await api.getIssue(); await api.addComment("must not run");` });
    ok(!r.success && r.logs.includes("ERROR: getIssue failed: 404") && r.changes.length === 0, `${runtime}: missing selected issue fails before downstream writes`);
    r = await testPF({ issueKey: "ABC-1", contextExtras, code: `api.log("before failure"); await api.addComment("test"); throw new Error("script failed");` });
    ok(!r.success && r.logs.filter((l) => l === "before failure").length === 1 && r.logs.filter((l) => /\[SIMULATION\]/.test(l)).length === 1 && r.logs.at(-1) === "ERROR: script failed" && r.changes.length === 1, `${runtime}: failure preserves logs and changes exactly once`);
    r = await testPF({ contextExtras, priorVariables: { previous: { key: "ABC-1" }, count: 3 }, code: 'api.log(previous.key, vars.previous.key, ${previous}.key, count, vars.count, ${count}); return api.context.issueKey;' });
    ok(r.success && r.logs.includes("ABC-1 ABC-1 ABC-1 3 3 3") && r.logs.includes("Return value: null"), `${runtime}: named, vars and placeholder prior-variable access all survive`);
    r = await testPF({ issueKey: "ABC-1", contextExtras, code: `await api.addComment("test"); const circular = {}; circular.self = circular; return circular;` });
    ok(!r.success && r.changes.length === 1 && r.logs.filter((l) => /\[SIMULATION\]/.test(l)).length === 1, `${runtime}: unserializable return does not duplicate session evidence`);
  }
  for (const runtime of ["job", "listener"]) {
    for (const scenario of ["empty", "http", "network"]) {
      forgeApi.__respond(() => {
        if (scenario === "network") throw new Error("network unavailable");
        return forgeApi.__response(scenario === "http" ? 400 : 200, scenario === "http" ? { errorMessages: ["bad JQL"] } : { issues: [] });
      });
      r = await testPF({ jql: "project = ABC", contextExtras: { runtime }, code: `api.log("must not run"); return 1;` });
      ok(!r.success && r.issueKey === null && r.changes.length === 0 && r.logs.some((l) => /ERROR: JQL/.test(l)) && !r.logs.includes("must not run"), `${runtime}: ${scenario} JQL fails explicitly without executing code`);
    }
    forgeApi.__respond(() => forgeApi.__response(200, { issues: [{ key: "ABC-2" }] }));
    r = await testPF({ jql: "project = ABC", contextExtras: { runtime }, code: `await api.setAssignee("test-account"); return api.context.issueKey;` });
    ok(r.success && r.mode === "live" && r.issueKey === "ABC-2" && r.changes[0]?.key === "ABC-2" && r.changes[0]?.simulated === true, `${runtime}: matching JQL binds its real result`);
  }
  forgeApi.__respond(() => forgeApi.__response(200, { issues: [] }));
  r = await testPF({ jql: "project = ABC", code: `return (await api.getIssue()).key;` });
  ok(r.success && r.mode === "mock" && r.issueKey === "MOCK-1", "legacy workflow JQL fallback remains unchanged");

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};
main().catch((e) => { console.error("FATAL", e); process.exit(2); });
