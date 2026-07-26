/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Attach the full rule set onto the COGTEST hub status as self-loop
// transitions, in a single workflows/update. Idempotent: removes any prior
// harness transitions (CT-* and the gate validator) before re-adding.

import {
  readWorkflow, updateWorkflow, makeSelfLoop, buildRule, attachRuleToTransition,
} from "../lib/workflow.mjs";
import { buildRules } from "../fixtures/rules.mjs";
import { loadState, patchState } from "../lib/state.mjs";

const isHarnessTransition = (t) =>
  typeof t.name === "string" && (t.name.startsWith("CT-") || t.name.startsWith("GATE Validator"));

async function main() {
  const s = loadState();
  if (!s.workflowName || !s.customFields) throw new Error("Run setup-testbed + setup-fields first.");
  const rules = buildRules(s);

  for (let attempt = 0; attempt < 3; attempt++) {
    const { top, wf } = await readWorkflow(s.workflowName);

    // Remove prior harness self-loops (idempotent re-attach)
    const before = wf.transitions.length;
    wf.transitions = wf.transitions.filter((t) => !isHarnessTransition(t));
    const removed = before - wf.transitions.length;

    const existingIds = new Set(wf.transitions.map((t) => String(t.id)));
    let idNum = 9001;
    const mapping = {};
    for (const rule of rules) {
      while (existingIds.has(String(idNum))) idNum++;
      existingIds.add(String(idNum));
      const t = makeSelfLoop(s.hubStatusRef, rule.name, idNum);
      const ruleObj = buildRule(rule.type, rule.config);
      attachRuleToTransition(t, rule.type, ruleObj);
      wf.transitions.push(t);
      mapping[rule.key] = { transitionId: String(idNum), name: rule.name, type: rule.type, ruleId: ruleObj.parameters.id };
      idNum++;
    }

    try {
      await updateWorkflow(top, wf);
      patchState({ ruleTransitions: mapping });
      console.log(`Attached ${rules.length} rules (removed ${removed} prior). Transitions ${Object.values(mapping).map((m) => m.transitionId).join(",")}`);
      for (const [k, m] of Object.entries(mapping)) console.log(`  ${k} -> transition ${m.transitionId} (${m.type})`);
      return;
    } catch (e) {
      if (attempt < 2 && /409|version|conflict/i.test(e.message)) {
        console.log(`  version conflict, retrying (${attempt + 1})...`);
        continue;
      }
      throw e;
    }
  }
}

main().catch((e) => {
  console.error("ATTACH FAILED:", e.message);
  if (e.body) console.error(JSON.stringify(e.body, null, 2));
  process.exit(1);
});
