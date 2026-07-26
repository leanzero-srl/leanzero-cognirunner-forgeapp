/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// READ-ONLY diagnostic: dumps the identity shape of CogniRunner rules attached
// to the COGTEST workflow — parameters.key (truncated), parameters.id, top-level
// id, and the KEYS of the embedded parameters.config (NOT values, to avoid
// printing prompts). Tells us whether attached rules carry an embedded config
// id/ruleId (which the registry matches on) so the discovery/sync resolver can
// extract a stable identity. Used to scope Workstream R (rule visibility).

import { readWorkflow, APP_ID } from "../lib/workflow.mjs";
import { loadState } from "../lib/state.mjs";

const s = loadState();
const { top, wf } = await readWorkflow(s.workflowName);

const isCogni = (r) =>
  String(r?.parameters?.key || "").includes(APP_ID) ||
  String(r?.ruleKey || "").startsWith("forge:expression") ||
  String(r?.ruleKey || "").startsWith("forge:workflow");

const collect = (t) => {
  const out = [];
  for (const r of t.validators || []) out.push(["validator", r]);
  for (const r of t.actions || []) out.push(["action", r]);
  const walk = (n) => { if (!n) return; for (const c of n.conditions || []) { if (c.conditions || c.conditionGroups) walk(c); else out.push(["condition", c]); } for (const g of n.conditionGroups || []) walk(g); };
  if (Array.isArray(t.conditions)) for (const r of t.conditions) out.push(["condition", r]);
  else walk(t.conditions);
  return out.filter(([, r]) => isCogni(r));
};

let shown = 0;
const idStats = { hasConfigId: 0, hasConfigRuleId: 0, noEmbeddedId: 0, total: 0 };
for (const t of wf.transitions || []) {
  for (const [slot, r] of collect(t)) {
    idStats.total++;
    let cfg = {};
    try { cfg = JSON.parse(r.parameters?.config || "{}"); } catch { /* */ }
    if (cfg.id) idStats.hasConfigId++;
    else if (cfg.ruleId) idStats.hasConfigRuleId++;
    else idStats.noEmbeddedId++;
    if (shown < 8) {
      shown++;
      console.log(`\n[${slot}] transition="${t.name}" ruleKey=${r.ruleKey}`);
      console.log(`  parameters.id = ${r.parameters?.id}`);
      console.log(`  top-level id  = ${r.id}`);
      console.log(`  parameters.key tail = ...${String(r.parameters?.key || "").slice(-60)}`);
      console.log(`  config keys = ${Object.keys(cfg).sort().join(", ")}`);
      console.log(`  config.id=${cfg.id ?? "(none)"} config.ruleId=${cfg.ruleId ?? "(none)"} config.type=${cfg.type ?? "(none)"} config.fieldId=${cfg.fieldId ?? "(none)"}`);
    }
  }
}

console.log(`\n=== identity summary across ${idStats.total} CogniRunner rules ===`);
console.log(`  embedded config.id present:    ${idStats.hasConfigId}`);
console.log(`  embedded config.ruleId present:${idStats.hasConfigRuleId}`);
console.log(`  NO embedded id (uuid-only):    ${idStats.noEmbeddedId}`);
