/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// THE GATE: prove the full pipeline end-to-end before scaling.
// 1) Attach a validator self-loop via REST (deterministic prompt: block iff
//    the summary equals BLOCKME). 2) Create two issues. 3) Fire the transition.
// Expect: BLOCKME -> blocked, normal -> allowed. This also reveals whether a
// working AI provider is currently configured.

import { post, getTransitions, doTransition } from "../lib/jira.mjs";
import { attachSelfLoopRules } from "../lib/workflow.mjs";
import { loadState } from "../lib/state.mjs";

async function createIssue(projectKey, issueTypeId, summary) {
  const res = await post("/rest/api/3/issue", {
    fields: {
      project: { key: projectKey },
      issuetype: { id: issueTypeId },
      summary,
    },
  });
  return res.key;
}

function findTransition(transitions, name) {
  return (transitions || []).find((t) => t.name === name);
}

async function main() {
  const s = loadState();
  if (!s.workflowName) throw new Error("Run setup-testbed.mjs first.");

  const GATE_NAME = "GATE Validator (BLOCKME)";
  const prompt =
    "You are a strict gate. FAIL validation (isValid=false) if and only if the field value, ignoring surrounding whitespace and case, is exactly the single word BLOCKME. In every other case PASS (isValid=true).";

  console.log("Attaching gate validator via REST...");
  const attached = await attachSelfLoopRules(
    s.workflowName,
    s.hubStatusRef,
    [{ name: GATE_NAME, type: "validator", config: { fieldId: "summary", prompt, enableTools: false } }],
    9001
  );
  const gate = attached[0];
  console.log(`Attached transition ${gate.transitionId} ruleId ${gate.ruleId}`);

  const itId = s.primaryIssueType.id;
  const badKey = await createIssue(s.projectKey, itId, "BLOCKME");
  const goodKey = await createIssue(s.projectKey, itId, "Implement the login screen with validation");
  console.log(`Created ${badKey} (BLOCKME) and ${goodKey} (normal)`);

  // small settle
  await new Promise((r) => setTimeout(r, 1500));

  for (const [label, key, expectBlocked] of [
    ["BLOCKME", badKey, true],
    ["normal", goodKey, false],
  ]) {
    const tr = await getTransitions(key);
    const t = findTransition(tr.transitions, GATE_NAME);
    if (!t) {
      console.log(`  [${label}] ${key}: transition "${GATE_NAME}" NOT available (id list: ${tr.transitions.map((x) => x.name).join(", ")})`);
      continue;
    }
    const res = await doTransition(key, t.id);
    const blocked = res.status >= 400;
    let reason = "";
    try {
      const j = JSON.parse(res.text || "{}");
      reason = (j.errorMessages || []).join(" | ") || JSON.stringify(j.errors || {});
    } catch { reason = res.text.slice(0, 200); }
    const verdict = blocked ? "BLOCKED" : "ALLOWED";
    const ok = blocked === expectBlocked ? "PASS" : "XXXX MISMATCH";
    console.log(`  [${label}] ${key}: ${verdict} (HTTP ${res.status}) ${ok}  ${reason ? "-> " + reason : ""}`);
  }

  console.log("\nGate verify complete. If both PASS, the pipeline works end-to-end.");
  console.log("If both ALLOWED, no working AI provider is configured (validators fail-open) -> run provider config.");
}

main().catch((e) => {
  console.error("GATE FAILED:", e.message);
  if (e.body) console.error(JSON.stringify(e.body, null, 2));
  process.exit(1);
});
