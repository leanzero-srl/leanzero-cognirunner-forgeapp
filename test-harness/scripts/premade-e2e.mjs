/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// LIVE end-to-end test of PREMADE (non-AI) validators through the real Jira
// transition path. Attaches deterministic premade validators as self-loops via
// REST, creates pass/block issues with controlled summaries, fires each rule's
// transition, and asserts BLOCKED/ALLOWED.
//
// Unlike gate-verify.mjs, this needs NO AI provider — premade rules are
// deterministic. It DOES need the deployed app (with the premade branch in
// validate()) + a testbed (run setup-testbed.mjs first). Conditions are NOT
// exercised here: Jira does not evaluate conditions on the REST transition path
// (see README / FINDINGS) — condition logic is covered by premade-rules.test.mjs.
//
//   node test-harness/scripts/premade-e2e.mjs

import { post, getTransitions, doTransition } from "../lib/jira.mjs";
import { attachSelfLoopRules, readWorkflow, updateWorkflow } from "../lib/workflow.mjs";
import { loadState } from "../lib/state.mjs";

// Each case: a premade validator on `summary` (always present + controllable at
// create time), with a summary that should PASS and one that should BLOCK.
const CASES = [
  {
    name: "PM-field-comparison",
    config: { ruleKind: "premade", ruleType: "field-comparison", fieldId: "summary", fieldName: "Summary", op: "contains", compareValue: "PASS" },
    pass: "PASS this one through",
    block: "nothing matches here",
  },
  {
    name: "PM-field-regex",
    config: { ruleKind: "premade", ruleType: "field-regex", fieldId: "summary", fieldName: "Summary", regex: "^OK-\\d+" },
    pass: "OK-42 ready to go",
    block: "not in the right format",
  },
  {
    name: "PM-text-length",
    config: { ruleKind: "premade", ruleType: "text-length", fieldId: "summary", fieldName: "Summary", min: 12 },
    pass: "this summary is plenty long",
    block: "short",
  },
  {
    name: "PM-allowed-values",
    config: { ruleKind: "premade", ruleType: "allowed-values", fieldId: "summary", fieldName: "Summary", allowedValues: "alpha, beta" },
    pass: "alpha",
    block: "gamma",
  },
];

async function createIssue(projectKey, issueTypeId, summary) {
  const res = await post("/rest/api/3/issue", {
    fields: { project: { key: projectKey }, issuetype: { id: issueTypeId }, summary },
  });
  return res.key;
}

const findTransition = (transitions, name) => (transitions || []).find((t) => t.name === name);

async function fireAndJudge(key, transitionName, expectBlocked, label) {
  const tr = await getTransitions(key);
  const t = findTransition(tr.transitions, transitionName);
  if (!t) {
    return { ok: false, line: `  [${label}] ${key}: transition "${transitionName}" NOT available` };
  }
  const res = await doTransition(key, t.id);
  const blocked = res.status >= 400;
  let reason = "";
  try {
    const j = JSON.parse(res.text || "{}");
    reason = (j.errorMessages || []).join(" | ") || JSON.stringify(j.errors || {});
  } catch { reason = (res.text || "").slice(0, 200); }
  const ok = blocked === expectBlocked;
  const verdict = blocked ? "BLOCKED" : "ALLOWED";
  return {
    ok,
    line: `  [${label}] ${key}: ${verdict} (HTTP ${res.status}) ${ok ? "PASS" : "XXXX MISMATCH"}${reason ? " -> " + reason : ""}`,
  };
}

async function main() {
  const s = loadState();
  if (!s.workflowName) throw new Error("Run setup-testbed.mjs first.");
  const itId = s.primaryIssueType.id;

  // Idempotent: drop any prior PM- transitions before re-attaching.
  {
    const { top, wf } = await readWorkflow(s.workflowName);
    const before = wf.transitions.length;
    wf.transitions = wf.transitions.filter((t) => !String(t.name || "").startsWith("PM-"));
    if (wf.transitions.length !== before) {
      await updateWorkflow(top, wf);
      console.log(`Removed ${before - wf.transitions.length} prior PM- transition(s).`);
    }
  }

  console.log("Attaching premade validators via REST...");
  await attachSelfLoopRules(
    s.workflowName,
    s.hubStatusRef,
    CASES.map((c) => ({ name: c.name, type: "validator", config: c.config })),
    9101,
  );

  // Create one pass + one block issue per case.
  for (const c of CASES) {
    c.passKey = await createIssue(s.projectKey, itId, c.pass);
    c.blockKey = await createIssue(s.projectKey, itId, c.block);
  }
  console.log("Created pass/block issues. Settling 2s...");
  await new Promise((r) => setTimeout(r, 2000));

  let total = 0, failed = 0;
  for (const c of CASES) {
    console.log(`\n${c.name} (${c.config.ruleType}):`);
    for (const [label, key, expectBlocked] of [
      ["expect ALLOW", c.passKey, false],
      ["expect BLOCK", c.blockKey, true],
    ]) {
      const r = await fireAndJudge(key, c.name, expectBlocked, label);
      console.log(r.line);
      total++;
      if (!r.ok) failed++;
    }
  }

  console.log(`\nPremade E2E: ${total - failed}/${total} checks passed.`);
  if (failed > 0) {
    console.log("If ALLOWs unexpectedly passed where a BLOCK was due, confirm the deployed build has the premade branch in validate().");
    process.exit(1);
  }
  console.log("All premade validators enforced correctly on the live transition path (no AI provider needed).");
}

main().catch((e) => {
  console.error("PREMADE E2E FAILED:", e.message);
  if (e.body) console.error(JSON.stringify(e.body, null, 2));
  process.exit(1);
});
