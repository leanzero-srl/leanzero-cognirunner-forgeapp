// LZ Condition Probe — settles the open F3 question.
//
// F3 in FINDINGS.md says "Forge conditions are not enforced on the REST transition path",
// but the evidence could not prove it: CogniRunner's condition module declares
// expression:"true", a tautology, so the transition is allowed on EVERY surface for a
// reason that has nothing to do with REST.
//
// This probe uses a separate app (LZ Condition Probe) whose condition declares
// expression:"false" — always hide — plus a `function:` the module schema does not have.
// Positive control: a function-based validator that always blocks.
//
// Run: node scripts/lz-condition-probe.mjs

import crypto from "node:crypto";
import { get, post, getIssue, getTransitions, searchJql } from "../lib/jira.mjs";
import { readWorkflow, updateWorkflow, makeSelfLoop, attachRuleToTransition } from "../lib/workflow.mjs";

const WF = "Software Simplified Workflow for Project COGTEST";
const APP = "741d6811-57df-4ce9-849e-d9dbbdbc2788";
const ENV = "2a1db5c8-f40b-4854-a284-4dcf213c4a85";
const ari = (m) => `ari:cloud:ecosystem::extension/${APP}/${ENV}/static/${m}`;

const COND_T = "LZPROBE-Cond-AlwaysFalse";
const VAL_T = "LZPROBE-Val-AlwaysFalse";
const MARKER = "LZPROBE condition-vs-validator fixture";

function forgeRule(ruleKey, moduleKey) {
  return {
    ruleKey,
    parameters: { key: ari(moduleKey), config: "{}", id: crypto.randomUUID(), disabled: "false" },
    id: crypto.randomUUID(),
  };
}

const args = new Set(process.argv.slice(2));

async function detach() {
  const { top, wf } = await readWorkflow(WF);
  const before = wf.transitions.length;
  wf.transitions = wf.transitions.filter((t) => !String(t.name || "").startsWith("LZPROBE-"));
  if (before !== wf.transitions.length) {
    await updateWorkflow(top, wf);
    console.log(`detached ${before - wf.transitions.length} LZPROBE- transitions`);
  } else console.log("nothing to detach");
}

async function attach() {
  const { top, wf } = await readWorkflow(WF);
  if (wf.transitions.some((t) => String(t.name || "").startsWith("LZPROBE-"))) {
    console.log("LZPROBE- transitions already attached; skipping");
    return;
  }
  // Hub = the status the existing CT- self-loops sit on.
  const sample = wf.transitions.find((t) => String(t.name || "").startsWith("CT-"));
  const hub = sample.toStatusReference;
  console.log("hub statusReference:", hub);

  const ids = new Set(wf.transitions.map((t) => String(t.id)));
  let n = 9990;
  const made = [];
  for (const [name, type, ruleKey, mod] of [
    [COND_T, "condition", "forge:expression-condition", "probe-condition"],
    [VAL_T, "validator", "forge:expression-validator", "probe-validator"],
  ]) {
    while (ids.has(String(n))) n++;
    ids.add(String(n));
    const t = makeSelfLoop(hub, name, n);
    attachRuleToTransition(t, type, forgeRule(ruleKey, mod));
    wf.transitions.push(t);
    made.push({ name, id: String(n) });
    n++;
  }
  await updateWorkflow(top, wf);
  console.log("attached:", JSON.stringify(made));
  return { hub, made };
}

async function probe() {
  // find-or-create the fixture issue (never bulk-delete; reuse by exact marker)
  let key = null;
  try {
    const hits = await searchJql(`project = COGTEST AND summary ~ ${JSON.stringify(MARKER)}`, ["summary"], 50);
    key = (hits.find((i) => (i.fields?.summary || "") === MARKER) || {}).key || null;
  } catch { /* ignore */ }
  if (!key) {
    const r = await post("/rest/api/3/issue", {
      fields: { project: { key: "COGTEST" }, summary: MARKER, issuetype: { name: "Task" } },
    });
    key = r.key;
    console.log("created fixture", key);
  } else console.log("reusing fixture", key);

  const issue = await getIssue(key, "status");
  console.log("issue status:", issue.fields.status.name);

  const tr = await getTransitions(key);
  const names = (tr.transitions || []).map((t) => t.name);
  const cond = (tr.transitions || []).find((t) => t.name === COND_T);
  const val = (tr.transitions || []).find((t) => t.name === VAL_T);

  console.log("\n--- LISTING (GET /issue/{key}/transitions) ---");
  console.log(`  ${COND_T}: ${cond ? "LISTED (id " + cond.id + ")" : "NOT LISTED"}`);
  console.log(`  ${VAL_T}:  ${val ? "LISTED (id " + val.id + ")" : "NOT LISTED"}`);
  console.log(`  (total transitions listed: ${names.length})`);

  console.log("\n--- EXECUTION (POST /issue/{key}/transitions) ---");
  for (const [label, t] of [["condition(false)", cond], ["validator(false)", val]]) {
    if (!t) { console.log(`  ${label}: skipped, not listed`); continue; }
    const res = await post(`/rest/api/3/issue/${key}/transitions`, { transition: { id: String(t.id) } }, { raw: true });
    console.log(`  ${label}: HTTP ${res.status} ${String(res.text || "").slice(0, 300)}`);
  }
}

if (args.has("--detach")) await detach();
else if (args.has("--attach")) await attach();
else if (args.has("--probe")) await probe();
else { await attach(); await probe(); }
