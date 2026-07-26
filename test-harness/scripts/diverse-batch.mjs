/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// DIVERSE cross-feature batch — exercises every runtime-firable rule family in one
// pass so the live forge-logs monitor can show them all: premade (non-AI) validator
// + condition, AI prompt validator, AGENTIC tool-use validator (JQL search), semantic
// post-function (AI reads source → writes target), static post-function (sandbox code),
// and a memory-injection probe. MCP is intentionally excluded.
//
// AI families need a configured provider; whatever the provider does (evaluate /
// fail-open / error) is surfaced honestly in the logs. Skills are NOT here: they are
// a design-time/codegen feature with no transition-firing path (they shape generated
// code at authoring time, not at runtime) — see the report notes.
//
//   node test-harness/scripts/diverse-batch.mjs

import { post, get, getTransitions, doTransition } from "../lib/jira.mjs";
import { attachSelfLoopRules, readWorkflow, updateWorkflow } from "../lib/workflow.mjs";
import { loadState } from "../lib/state.mjs";

const s = loadState();
const CF = s.customFields;
const TEXT = CF.text.id;
const TASK = "10005";

const STATIC_CODE = `await api.updateIssue(api.context.issueKey, { ${JSON.stringify(TEXT)}: "static-pf ran @ " + api.context.issueKey }); return "ok";`;

// name, type (validator|condition|static|semantic-via-type), config, expects/notes
const SPECS = [
  { name: "DV-premade-validator", type: "validator", family: "premade validator (non-AI)",
    config: { ruleKind: "premade", ruleType: "field-required", fieldId: "summary", fieldName: "Summary" } },
  { name: "DV-premade-condition", type: "condition", family: "premade condition (non-AI, UI-only)",
    config: { ruleKind: "premade", ruleType: "priority-is", priorityName: "Highest" } },
  { name: "DV-ai-validator", type: "validator", family: "AI prompt validator",
    config: { fieldId: "summary", prompt: "The summary must be a clear, professional sentence describing the work. Reject if it is empty, vague, or a single word.", enableTools: false, debugTrace: true } },
  { name: "DV-agentic-validator", type: "validator", family: "AGENTIC validator (JQL tool use)",
    config: { fieldId: "summary", prompt: "Search Jira for existing issues with a very similar summary (possible duplicates). If a clear duplicate already exists, reject; otherwise pass.", enableTools: true, debugTrace: true } },
  { name: "DV-semantic-pf", type: "static", family: "semantic post-function (AI source→target)",
    config: { type: "postfunction-semantic", fieldId: "description", conditionPrompt: "Run every time", actionPrompt: "Write a one-sentence plain-text summary of this issue based on its description.", actionFieldId: TEXT, debugTrace: true } },
  { name: "DV-static-pf", type: "static", family: "static post-function (sandbox code)",
    config: { type: "postfunction-static", functions: [{ name: "tag", code: STATIC_CODE, variableName: "step1" }], debugTrace: true } },
  { name: "DV-memory-probe", type: "validator", family: "memory runtime-injection probe",
    config: { fieldId: "summary", prompt: "Validate that the summary is acceptable for this team.", enableTools: false, debugTrace: true } },
];

const mk = (summary, extra = {}) => post("/rest/api/3/issue", { fields: { project: { key: s.projectKey }, issuetype: { id: TASK }, summary, ...extra } }).then((r) => r.key);
const fieldVal = async (key, fid) => (await get(`/rest/api/3/issue/${key}?fields=${fid}`)).fields?.[fid];
async function fire(key, name) {
  const tr = await getTransitions(key);
  const t = (tr.transitions || []).find((x) => x.name === name);
  if (!t) return { status: "NA" };
  return doTransition(key, t.id);
}

async function main() {
  if (!s.workflowName) throw new Error("Run setup-testbed.mjs first.");

  // idempotent: drop prior DV- transitions, attach the fresh diverse set
  {
    const { top, wf } = await readWorkflow(s.workflowName);
    const before = wf.transitions.length;
    wf.transitions = wf.transitions.filter((t) => !String(t.name || "").startsWith("DV-"));
    if (wf.transitions.length !== before) await updateWorkflow(top, wf);
  }
  await attachSelfLoopRules(s.workflowName, s.hubStatusRef, SPECS.map((x) => ({ name: x.name, type: x.type, config: x.config })), 9701);
  console.log(`Attached ${SPECS.length} diverse rules (DV-*). Firing each...\n`);

  // A realistic issue: good summary + a real description for the semantic PF to read.
  const desc = "Users report the login button is unresponsive on Safari after the 2.3 release. Repro: open /login in Safari 17, click Sign in, nothing happens. Expected: redirect to the dashboard. Console shows a CSP violation on the auth script.";
  const adf = { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: desc }] }] };

  const results = [];
  for (const spec of SPECS) {
    // Each rule gets its own issue so post-function mutations are observable & isolated.
    const key = await mk(`OAuth login is unresponsive on Safari (${spec.name.slice(3)})`, { description: adf });
    const res = await fire(key, spec.name);
    let note = `HTTP ${res.status}`;
    if (res.status === "NA") note = "transition not available";
    results.push({ spec, key, status: res.status });
    console.log(`  ${spec.family.padEnd(40)} ${spec.name} @ ${key}: ${note}`);
  }

  // Post-functions are async — wait, then verify their field effects.
  console.log("\nWaiting 8s for async post-functions...");
  await new Promise((r) => setTimeout(r, 8000));
  for (const r of results) {
    if (r.spec.name === "DV-static-pf") {
      const v = await fieldVal(r.key, TEXT);
      console.log(`  static-pf effect on ${r.key}: ${JSON.stringify(v)} ${typeof v === "string" && v.startsWith("static-pf ran") ? "✓" : "(no effect — check logs)"}`);
    }
    if (r.spec.name === "DV-semantic-pf") {
      const v = await fieldVal(r.key, TEXT);
      console.log(`  semantic-pf effect on ${r.key}: ${JSON.stringify(v)?.slice(0, 100)} ${v ? "✓ (AI wrote target)" : "(empty — provider off or fail-open; check logs)"}`);
    }
  }

  console.log("\nDiverse batch fired. Watch the live monitor / forge logs for each family's trace:");
  console.log("  premade → [cognirunner:premade]; AI/agentic → 'AI Validator called' + model + (agentic) JQL tool rounds;");
  console.log("  semantic/static → 'Static PF result' / semantic dispatch; memory → cogni-debug 'memoriesUsed'.");
}

main().catch((e) => { console.error("DIVERSE BATCH FAILED:", e.message); if (e.body) console.error(JSON.stringify(e.body, null, 2)); process.exit(1); });
