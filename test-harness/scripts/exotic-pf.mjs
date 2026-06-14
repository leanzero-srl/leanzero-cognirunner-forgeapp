/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Test the EXOTIC sandbox capabilities (deployed v18.0.0): createVersion,
// createComponent, createIssue, cloneIssue, and the emergency forceStatus
// (temp-transition trick). Each runs as a real static PF on a transition;
// verified black-box via REST (issue fields, project versions/components, issue
// search, status) + the workflow definition (temp transition cleaned up).

import { post, doTransition, getIssue, searchJql } from "../lib/jira.mjs";
import { readWorkflow, attachSelfLoopRules } from "../lib/workflow.mjs";
import { loadState, writeResult } from "../lib/state.mjs";

async function createIssue(s, summary) {
  const r = await post("/rest/api/3/issue", { fields: { project: { key: s.projectKey }, issuetype: { id: s.primaryIssueType.id }, summary, labels: ["cogtest-harness", "cogtest-exotic"] } });
  return r.key;
}
const poll = async (fn, ms = 30000) => { const end = Date.now() + ms; do { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 2500)); } while (Date.now() < end); return null; };

async function main() {
  const s = loadState();
  const wfName = s.workflowName;
  const code = {
    version: `const v = await api.createVersion("hv-" + api.context.issueKey); await api.updateIssue(api.context.issueKey, { fixVersions: [{ id: v.id }] }); api.log("version " + v.name);`,
    component: `const c = await api.createComponent("hc-" + api.context.issueKey); await api.updateIssue(api.context.issueKey, { components: [{ id: c.id }] }); api.log("component " + c.name);`,
    clone: `const dup = await api.cloneIssue({ summary: "CLONEPF of " + api.context.issueKey }); api.log("cloned " + dup.key);`,
    createissue: `const child = await api.createIssue({ project: { key: ${JSON.stringify(s.projectKey)} }, issuetype: { id: ${JSON.stringify(s.primaryIssueType.id)} }, summary: "PFCHILD of " + api.context.issueKey, labels: ["cogtest-harness"] }); api.log("created " + child.key);`,
    forcestatus: `const r = await api.forceStatus("Done", { workflowName: ${JSON.stringify(wfName)} }); api.log("forceStatus -> " + JSON.stringify(r));`,
  };

  const specs = Object.entries(code).map(([role, c]) => ({
    name: `EX-${role}`, type: "static",
    config: { type: "postfunction-static", debugTrace: true, functions: [{ name: role, code: c, variableName: "step1" }] },
  }));
  const att = await attachSelfLoopRules(wfName, s.hubStatusRef, specs, 9600);
  const tid = {}; att.forEach((a, i) => { tid[Object.keys(code)[i]] = a.transitionId; });
  console.log("Attached exotic PFs:", Object.entries(tid).map(([k, v]) => `${k}=${v}`).join(", "));

  const results = {};

  // createVersion
  let k = await createIssue(s, "Exotic: createVersion");
  await doTransition(k, tid.version);
  const fv = await poll(async () => { const i = await getIssue(k, "fixVersions"); return (i.fields.fixVersions || []).length ? i.fields.fixVersions[0].name : null; });
  results.createVersion = { ok: !!fv, detail: `fixVersion=${fv}` };

  // createComponent
  k = await createIssue(s, "Exotic: createComponent");
  await doTransition(k, tid.component);
  const cm = await poll(async () => { const i = await getIssue(k, "components"); return (i.fields.components || []).length ? i.fields.components[0].name : null; });
  results.createComponent = { ok: !!cm, detail: `component=${cm}` };

  // cloneIssue
  k = await createIssue(s, "Exotic: cloneIssue");
  await doTransition(k, tid.clone);
  const clone = await poll(async () => { const hits = await searchJql(`project = ${s.projectKey} AND summary ~ "CLONEPF of ${k}"`, ["summary"], 5); return hits.length ? hits[0].key : null; });
  results.cloneIssue = { ok: !!clone, detail: `clone=${clone}` };

  // createIssue
  k = await createIssue(s, "Exotic: createIssue");
  await doTransition(k, tid.createissue);
  const child = await poll(async () => { const hits = await searchJql(`project = ${s.projectKey} AND summary ~ "PFCHILD of ${k}"`, ["summary"], 5); return hits.length ? hits[0].key : null; });
  results.createIssue = { ok: !!child, detail: `child=${child}` };

  // forceStatus (emergency temp-transition trick)
  k = await createIssue(s, "Exotic: forceStatus");
  await doTransition(k, tid.forcestatus);
  const done = await poll(async () => { const i = await getIssue(k, "status"); return i.fields.status?.name === "Done" ? "Done" : null; }, 40000);
  // verify the temp transition was cleaned up (poll — the workflow read lags the
  // removal's propagation, so retry before concluding it leaked).
  const cleaned = await poll(async () => {
    try { const { wf } = await readWorkflow(wfName); return (wf.transitions || []).filter((t) => String(t.name || "").startsWith("CogniRunner Emergency")).length === 0 ? "clean" : null; } catch { return null; }
  }, 20000);
  results.forceStatus = { ok: done === "Done" && cleaned === "clean", detail: `status=${done}, tempTransitionCleanedUp=${cleaned === "clean"}` };

  console.log("\n=== Exotic PF results ===");
  for (const [name, r] of Object.entries(results)) console.log(`  ${name.padEnd(16)} ${r.ok ? "✓" : "✗"}  ${r.detail}`);
  const okCount = Object.values(results).filter((r) => r.ok).length;
  console.log(`\n${okCount}/${Object.keys(results).length} exotic capabilities verified.`);
  writeResult("exotic-pf-results.json", { okCount, total: Object.keys(results).length, results });
}

main().catch((e) => {
  console.error("EXOTIC-PF FAILED:", e.message);
  if (e.body) console.error(JSON.stringify(e.body, null, 2));
  process.exit(1);
});
