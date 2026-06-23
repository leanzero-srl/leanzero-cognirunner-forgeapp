/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Audits every CogniRunner rule attached to the COGTEST workflow: enumerates by
// type, validates each rule's stored config (parseable + required fields per
// type), flags duplicates and orphaned/transient probe transitions, and (with
// CLEAN=1) removes the transient ones — keeping the durable CT-* suite. This is
// the "check the workflow rules you've done" health check.

import { readWorkflow, updateWorkflow, APP_ID } from "../lib/workflow.mjs";
import { loadState, writeResult } from "../lib/state.mjs";

const CLEAN = process.env.CLEAN === "1";
// Transient transitions created by probe scripts — safe to remove on CLEAN.
const TRANSIENT = [/^FM-(write|read)-/, /^EX-/, /^ACTX-/, /^CT-Memory-/, /^GATE Validator/, /^CogniRunner Emergency/, /^DISCO-/, /^CMIRROR-/, /^CL-/, /^STRESS-/, /^R\d+-/, /^AG-/];

function collectRules(t) {
  const out = [];
  for (const r of t.validators || []) out.push({ slot: "validator", rule: r });
  for (const r of t.actions || []) out.push({ slot: "action", rule: r });
  const walk = (node) => { if (!node) return; for (const c of node.conditions || []) { if (c.conditions || c.conditionGroups) walk(c); else out.push({ slot: "condition", rule: c }); } for (const g of node.conditionGroups || []) walk(g); };
  if (Array.isArray(t.conditions)) for (const r of t.conditions) out.push({ slot: "condition", rule: r });
  else walk(t.conditions);
  return out.filter(({ rule }) => String(rule?.parameters?.key || "").includes(APP_ID) || String(rule?.ruleKey || "").startsWith("forge:expression") || String(rule?.ruleKey || "").startsWith("forge:workflow"));
}

// Validate a rule's stored config is well-formed for its type.
function validateConfig(rule) {
  let cfg;
  try { cfg = JSON.parse(rule.parameters?.config || "{}"); } catch { return "config is not valid JSON"; }
  const t = cfg.type || "";
  if (rule.ruleKey === "forge:expression-validator" || rule.ruleKey === "forge:expression-condition") {
    if (!cfg.fieldId) return "validator/condition missing fieldId";
    if (!cfg.prompt) return "validator/condition missing prompt";
  } else if (t.includes("semantic")) {
    if (!cfg.actionPrompt || !cfg.actionFieldId) return "semantic missing actionPrompt/actionFieldId";
  } else if (t.includes("static")) {
    const fns = cfg.functions || [];
    if (!fns.length) return "static has no functions";
    if (fns.some((f) => !f.code || !f.code.trim())) return "static has an empty code step";
  }
  return null; // ok
}

async function main() {
  const s = loadState();
  const { top, wf } = await readWorkflow(s.workflowName);
  const statusName = {}; for (const st of top.statuses || []) statusName[st.statusReference] = st.name;

  const byCategory = {};
  const malformed = [];
  const dupes = [];
  const transient = [];
  let cogniTotal = 0;

  for (const t of wf.transitions || []) {
    const rules = collectRules(t);
    if (!rules.length) continue;
    const isTransient = TRANSIENT.some((re) => re.test(String(t.name || "")));
    if (isTransient) transient.push(t.name);
    const sig = new Set();
    for (const { slot, rule } of rules) {
      cogniTotal++;
      const cat = `${slot}:${rule.ruleKey}`;
      byCategory[cat] = (byCategory[cat] || 0) + 1;
      const bad = validateConfig(rule);
      if (bad) malformed.push({ transition: t.name, slot, problem: bad });
      const key = `${rule.ruleKey}|${(rule.parameters?.config || "").slice(0, 120)}`;
      if (sig.has(key)) dupes.push({ transition: t.name, ruleKey: rule.ruleKey });
      sig.add(key);
    }
  }

  console.log(`=== Workflow rule audit: ${s.workflowName} ===`);
  console.log(`Total transitions: ${(wf.transitions || []).length}`);
  console.log(`CogniRunner rules attached: ${cogniTotal}`);
  console.log(`\nBy category:`);
  for (const [cat, n] of Object.entries(byCategory).sort()) console.log(`  ${cat}: ${n}`);
  console.log(`\nMalformed configs: ${malformed.length}`);
  for (const m of malformed.slice(0, 20)) console.log(`  ✗ ${m.transition} [${m.slot}] — ${m.problem}`);
  console.log(`Duplicate rules on a transition: ${dupes.length}`);
  for (const d of dupes.slice(0, 20)) console.log(`  ⚠ ${d.transition} — ${d.ruleKey}`);
  console.log(`\nTransient/probe transitions: ${transient.length}${transient.length ? ` (${transient.slice(0, 8).join(", ")}${transient.length > 8 ? "…" : ""})` : ""}`);

  writeResult("audit-results.json", { workflow: s.workflowName, totalTransitions: (wf.transitions || []).length, cogniRules: cogniTotal, byCategory, malformed, dupes, transientCount: transient.length, transient });

  if (CLEAN && transient.length) {
    const before = wf.transitions.length;
    wf.transitions = wf.transitions.filter((t) => !TRANSIENT.some((re) => re.test(String(t.name || ""))));
    await updateWorkflow(top, wf);
    console.log(`\nCLEAN: removed ${before - wf.transitions.length} transient transitions. Durable CT-* suite kept.`);
  } else if (transient.length) {
    console.log(`\nRun  CLEAN=1 npm run audit  to remove the ${transient.length} transient probe transitions.`);
  }
  console.log(`\nHealth: ${malformed.length === 0 && dupes.length === 0 ? "✅ all attached rule configs are well-formed, no duplicates" : "⚠ see flags above"}`);
}

main().catch((e) => { console.error("AUDIT FAILED:", e.message); if (e.body) console.error(JSON.stringify(e.body, null, 2)); process.exit(1); });
