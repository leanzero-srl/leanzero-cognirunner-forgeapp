/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * PROBE: does the Jira workflowValidator contract reject a response object that carries
 * keys beyond { result, errorMessage }?
 *
 * `git-validator-live.mjs` found that BOTH git-validator answers — the strict:false
 * ALLOW and the strict:true BLOCK — are refused by the platform with
 *   "the function that implements validator ... returned a response in an unexpected format"
 * even though the app's own execution log records the correct verdict. The git branch is
 * the only premade branch that returns extra keys (`banner`, `gitReason`, added for
 * config-view), so the extra key is the suspect. This probe is the A/B that turns that
 * inference into evidence: the SAME workflow, the SAME self-loop shape, two rules —
 *   A: a non-git premade validator, which returns a bare { result:true }
 *   B: the git validator on an unconfigured connection, which returns
 *      { result:true, gitReason:"not-configured" } and NO banner
 * If A passes and B 400s, the extra key is the cause and `banner` is not needed to
 * trigger it.
 *
 *   node scripts/_probe-validator-shape.mjs
 */
import { post, getTransitions, doTransition } from "../lib/jira.mjs";
import { attachSelfLoopRules, readWorkflow, updateWorkflow } from "../lib/workflow.mjs";
import { loadState } from "../lib/state.mjs";

const s = loadState();
const A = "PROBE-shape-plain", B = "PROBE-shape-git";

const cleanup = async () => {
  const { top, wf } = await readWorkflow(s.workflowName);
  const before = wf.transitions.length;
  wf.transitions = wf.transitions.filter((t) => !String(t.name || "").startsWith("PROBE-shape"));
  if (wf.transitions.length !== before) await updateWorkflow(top, wf);
};

await cleanup();
await attachSelfLoopRules(s.workflowName, s.hubStatusRef, [
  // A — `text-length` with no bounds set returns PASS = a bare { result: true }.
  { name: A, type: "validator", config: { ruleKind: "premade", ruleType: "text-length", fieldId: "summary" } },
  // B — a git validator with no connection returns allow("not-configured") =
  //     { result: true, gitReason: "not-configured" }. No banner on this path.
  { name: B, type: "validator", config: { ruleKind: "premade", ruleType: "git-pr-merged", repo: "", connectionId: "" } },
], 9801);

const key = (await post("/rest/api/3/issue", { fields: { project: { key: s.projectKey }, issuetype: { id: s.primaryIssueType.id }, summary: "validator response-shape probe" } })).key;
await new Promise((r) => setTimeout(r, 3000));

const fire = async (name) => {
  const tr = await getTransitions(key);
  const t = (tr.transitions || []).find((x) => x.name === name);
  if (!t) return { status: 0, text: "transition absent" };
  const res = await doTransition(key, t.id);
  return { status: res.status, text: String(res.text || "").slice(0, 300) };
};

for (const [label, name, shape] of [["A bare {result:true}", A, "{ result: true }"], ["B {result:true, gitReason}", B, "{ result: true, gitReason: 'not-configured' }"]]) {
  const r = await fire(name);
  console.log(`${r.status >= 200 && r.status < 300 ? "ALLOWED " : "REFUSED "} ${label}  returns ${shape}  → HTTP ${r.status} ${r.text}`);
}

await cleanup();
console.log(`(probe issue ${key} left in place)`);
