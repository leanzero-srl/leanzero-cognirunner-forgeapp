/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 * SPDX-License-Identifier: Apache-2.0
 */
// DIAGNOSTIC: independently paginate /rest/api/3/workflows/search (NO caps) and count
// every attached CogniRunner rule, to verify the admin "100 rules" figure is real and
// not a pagination/limit artifact. Mirrors the app's discoverWorkflowRules counting.

import { get } from "../lib/jira.mjs";

const APP_ID = "36415848-6868-4697-9554-3c3ad87b8da9";

const flattenConditions = (conds) => {
  // conditions can nest in groups: { conditions: [...] } / { operator, conditions }
  const out = [];
  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (Array.isArray(node.conditions)) { node.conditions.forEach(walk); return; }
    out.push(node);
  };
  walk(conds);
  return out;
};

const ruleKeyOf = (r) => r?.parameters?.key || r?.ruleKey || "";

let startAt = 0;
const pageSize = 50;
let scannedWorkflows = 0;
let totalCogni = 0;
let pages = 0;
const perWorkflow = [];
let apiTotal = null;
let apiIsLastSeen = null;

for (;;) {
  let data;
  try {
    data = await get(`/rest/api/3/workflows/search?startAt=${startAt}&maxResults=${pageSize}&expand=values.transitions`);
  } catch (e) { console.log(`workflows/search failed at startAt=${startAt}: ${e.message}`); break; }
  pages++;
  apiTotal = data.total ?? apiTotal;
  apiIsLastSeen = data.isLast;
  const values = data.values || [];
  for (const wf of values) {
    scannedWorkflows++;
    let wfCount = 0;
    let transitionCount = (wf.transitions || []).length;
    for (const t of (wf.transitions || [])) {
      const slot = [
        ...(t.validators || []),
        ...flattenConditions(t.conditions),
        ...(t.actions || []),
      ];
      for (const rule of slot) {
        if (String(ruleKeyOf(rule)).includes(APP_ID)) { totalCogni++; wfCount++; }
      }
    }
    perWorkflow.push({ name: wf.name, transitions: transitionCount, cogniRules: wfCount });
  }
  const isLast = data.isLast === true || values.length < pageSize
    || (typeof data.total === "number" && startAt + values.length >= data.total);
  console.log(`page ${pages}: startAt=${startAt} returned=${values.length} isLast=${data.isLast} total=${data.total ?? "n/a"} → running rule count=${totalCogni}`);
  if (isLast || values.length === 0) break;
  startAt += pageSize;
}

console.log(`\n=== GROUND TRUTH ===`);
console.log(`pages fetched: ${pages}`);
console.log(`workflows scanned: ${scannedWorkflows}  (API reported total=${apiTotal}, last isLast=${apiIsLastSeen})`);
console.log(`TOTAL CogniRunner rules attached: ${totalCogni}`);
console.log(`\nTop workflows by rule count:`);
perWorkflow.sort((a, b) => b.cogniRules - a.cogniRules).slice(0, 12)
  .forEach((w) => console.log(`  ${String(w.cogniRules).padStart(4)} rules  (${w.transitions} transitions)  ${w.name}`));

console.log(`\nVERDICT: ${totalCogni > 100 ? `⚠️  ${totalCogni} > 100 — the admin scan is UNDER-counting (cap/pagination bug)` : totalCogni === 100 ? "exactly 100 — admin figure matches ground truth" : `${totalCogni} (< 100) — admin figure may be stale or counting differently`}`);
