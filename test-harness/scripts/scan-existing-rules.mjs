/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Scan every workflow on the instance for an already-attached CogniRunner forge
// rule. If found, dump its exact persisted shape — this resolves the
// record-then-replay gate WITHOUT any UI step.

import { get, post } from "../lib/jira.mjs";

const APP_ID = "36415848-6868-4697-9554-3c3ad87b8da9";

function ruleHasCogni(rule) {
  const k = rule?.parameters?.key || rule?.parameters?.appKey || "";
  const rk = rule?.ruleKey || "";
  return String(k).includes(APP_ID) || rk.startsWith("forge:");
}

function collectRules(transition) {
  const rules = [];
  const push = (arr, slot) => {
    for (const r of arr || []) rules.push({ slot, rule: r });
  };
  push(transition.validators, "validator");
  push(transition.actions, "action");
  // conditions can be a group tree
  const conds = transition.conditions;
  if (Array.isArray(conds)) push(conds, "condition");
  else if (conds && Array.isArray(conds.conditions)) {
    const walk = (node) => {
      for (const c of node.conditions || []) {
        if (c.conditions || c.conditionGroups) walk(c);
        else rules.push({ slot: "condition", rule: c });
      }
      for (const g of node.conditionGroups || []) walk(g);
    };
    walk(conds);
  }
  return rules;
}

async function main() {
  const search = await get("/rest/api/3/workflow/search?maxResults=100");
  const names = (search.values || []).map((w) => w.id?.name).filter(Boolean);
  console.log(`Scanning ${names.length} workflows for CogniRunner rules...`);

  const found = [];
  // bulk read in batches of 10
  for (let i = 0; i < names.length; i += 10) {
    const batch = names.slice(i, i + 10);
    let data;
    try {
      data = await post("/rest/api/3/workflows", { workflowNames: batch });
    } catch (e) {
      console.log(`  batch ${i} read error: ${e.message.slice(0, 120)}`);
      continue;
    }
    for (const wf of data.workflows || []) {
      for (const t of wf.transitions || []) {
        for (const { slot, rule } of collectRules(t)) {
          if (ruleHasCogni(rule)) {
            found.push({ workflow: wf.name, wfId: wf.id, transition: t.name, transitionId: t.id, slot, rule });
          }
        }
      }
    }
  }

  console.log(`\nFound ${found.length} CogniRunner rule(s) attached.\n`);
  for (const f of found) {
    console.log("=".repeat(70));
    console.log(`workflow: ${f.workflow}  (id ${f.wfId})`);
    console.log(`transition: ${f.transition} (id ${f.transitionId})  slot: ${f.slot}`);
    console.log(JSON.stringify(f.rule, null, 2));
  }

  if (found.length === 0) {
    console.log("None attached yet -> record-replay must use the UI step.");
  }
}

main().catch((e) => {
  console.error("SCAN FAILED:", e.message);
  process.exit(1);
});
