/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// OFFLINE characterisation of the in-UI dry-run (`testPostFunction` -> testApi) for F-004.
// The dev test-state hook does NOT allowlist testPostFunction, so this drives the very
// same src/index.js resolver locally with @forge/api mocked. Run:
//   node --import ./lib/register-mocks.mjs scripts/testpf-dryrun-probe.mjs
import forgeApi from "@forge/api";
import { handler } from "../../src/index.js";

let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };

forgeApi.__respond((path) => {
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

  // 6. and with a job/listener runtime context that has a null issue?
  r = await testPF({ code: `return await api.getIssue();`, contextExtras: { runtime: "job", issueKey: null } });
  console.log(`  · mock mode + contextExtras{runtime:"job",issueKey:null}: success=${r.success} issueKey=${r.issueKey}`);
  ok(r.success === true && r.issueKey === "MOCK-1", "even an explicit null issueKey in contextExtras is overridden by MOCK-1");

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};
main().catch((e) => { console.error("FATAL", e); process.exit(2); });
