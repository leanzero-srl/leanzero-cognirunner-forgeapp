/* CogniRunner - Copyright (C) 2025 LeanZero. SPDX-License-Identifier: AGPL-3.0-or-later */
import "../lib/register-mocks-index.mjs";
import assert from "node:assert/strict";
const { handler, createSandboxSession } = await import("../../src/index.js");
const { default: jira } = await import("@forge/api");
let created = 1;
jira.__respond((path, options) => jira.__response(200,
  options.method === "POST" ? { key: `ABC-${++created}` } : { key: "ABC-1", fields: { project: { id: "1" }, issuetype: { id: "1" }, summary: "source" } }));
const code = `const child = await api.createIssue({project:{key:'ABC'},issuetype:{name:'Task'},summary:'new'});
await api.updateIssue(child.key,{labels:['child']});
const clone = await api.cloneIssue(); await api.forIssue(clone.key).addLabels('clone');
return {child:child.key,clone:clone.key};`;
for (const runtime of ["postfunction", "listener", "job"]) {
  jira.__calls.length = 0;
  const result = await handler({ call: { functionKey: "testPostFunction", payload: { code, issueKey: "ABC-1", runtime } }, context: {} }, {});
  assert.equal(result.success, true, JSON.stringify(result));
  const [child, update, clone, label] = result.changes;
  assert.equal(child.action, "createIssue"); assert.equal(update.key, child.key);
  assert.equal(clone.action, "cloneIssue"); assert.equal(label.key, clone.key);
  assert.notEqual(child.key, clone.key); assert.notEqual(child.key, "ABC-1"); assert.notEqual(clone.key, "ABC-1");
  assert.ok(jira.__calls.every(c => !c.opts.method || c.opts.method === "GET"));
}
// The same operations in the real session follow returned Jira keys.
const session = createSandboxSession({ issueKey: "ABC-1" }), api = session.createApi();
const child = await api.createIssue({ summary: "new" }); await api.updateIssue(child.key, { labels: ["child"] });
const clone = await api.cloneIssue(); await api.forIssue(clone.key).addLabels("clone");
assert.equal(session.changes[1].key, child.key); assert.equal(session.changes[3].key, clone.key);
const sim = createSandboxSession({ issueKey: "ABC-1", config: { simulationMode: true } }).createApi();
const placeholder = await sim.createIssue({ summary: "virtual" });
const before = jira.__calls.length;
await assert.rejects(() => sim.getIssue(placeholder.key), /created only in simulation/);
await assert.rejects(() => sim.forIssue(placeholder.key).getProperty("x"), /created only in simulation/);
assert.equal(jira.__calls.length, before, "uncreated issue reads never reach Jira");
// Every independent read must distinguish denied from genuinely empty data.
for (const simulationMode of [true, false]) for (const method of ["transitionByName", "transitionParent", "transitionSubtasks", "cloneIssue"]) {
  jira.__respond(() => jira.__response(403, { errorMessages: ["Denied"] }));
  const s = createSandboxSession({ issueKey: "ABC-1", config: { simulationMode } });
  await assert.rejects(() => s.createApi()[method](method === "cloneIssue" ? {} : "Done"), /403/);
  assert.equal(s.changes.length, 0);
}
jira.__respond(() => jira.__response(200, { fields: {} }));
assert.deepEqual(await sim.transitionParent("Done"), { moved: 0 });
assert.deepEqual(await sim.transitionSubtasks("Done"), { moved: 0, total: 0 });
console.log("simulation identity and denied-read regressions passed");
