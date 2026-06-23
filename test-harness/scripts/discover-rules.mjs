/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Read-only inventory of EVERY CogniRunner rule deployed on the instance.
// Dumps a structured summary + per-rule detail and writes results/discovered.json.
// No mutation — safe to run anytime. Pass PROJECT_INDEX=1 to also resolve the
// workflow→project mapping (extra REST calls).

import { discoverAllRules, buildWorkflowProjectIndex, summarizeRules } from "../lib/discover.mjs";
import { writeResult } from "../lib/state.mjs";
import { BASE } from "../lib/jira.mjs";

const short = (s, n = 90) => (s == null ? "" : String(s).replace(/\s+/g, " ").slice(0, n));

function ruleHeadline(r) {
  const c = r.config || {};
  const t = c.type || r.ruleKey;
  if (r.slot === "validator" || r.slot === "condition" || r.ruleKey?.includes("expression")) {
    return `field=${c.fieldId || "?"} tools=${c.enableTools ? "Y" : "n"} docs=${(c.selectedDocIds || []).length} prompt="${short(c.prompt, 70)}"`;
  }
  if (String(t).includes("static")) {
    const fns = c.functions || [];
    return `static steps=${fns.length}${c.codeRef ? " (offloaded)" : ""}`;
  }
  if (String(t).includes("semantic")) {
    return `src=${c.fieldId || "?"} → ${c.actionFieldId || "?"}  action="${short(c.actionPrompt, 60)}"`;
  }
  return `type=${t} ${short(JSON.stringify(c), 70)}`;
}

async function main() {
  console.log(`Discovering CogniRunner rules on ${BASE} ...\n`);
  const { rules, foreignForgeRules, workflowCount, statusRef } = await discoverAllRules();
  const sum = summarizeRules(rules);

  console.log(`Scanned ${workflowCount} workflow(s). Found ${rules.length} CogniRunner rule(s).\n`);

  console.log("By type:");
  for (const [t, n] of Object.entries(sum.byType).sort()) console.log(`  ${String(n).padStart(3)}  ${t}`);
  console.log(`\nMalformed configs: ${sum.malformed}`);
  console.log(`Workflows carrying rules: ${Object.keys(sum.byWorkflow).length}`);
  for (const [wf, n] of Object.entries(sum.byWorkflow).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)}  ${wf}`);
  }

  console.log(`\n=== Per-rule detail ===`);
  for (const r of rules) {
    const loc = `${r.workflowName} :: ${r.transitionName} [${r.transitionType || "?"}] (from: ${r.fromStatusNames.join("/") || "?"} → ${r.toStatusName || "?"})`;
    const flag = r.configError ? "  ⚠ MALFORMED CONFIG" : "";
    console.log(`\n• [${r.slot}] ${r.ruleKey}${flag}`);
    console.log(`    ${loc}`);
    console.log(`    ${ruleHeadline(r)}`);
    if (r.configError) console.log(`    parse error: ${r.configError}`);
  }

  if (foreignForgeRules.length) {
    console.log(`\n=== ${foreignForgeRules.length} non-CogniRunner forge rule(s) (other apps, not counted) ===`);
    for (const f of foreignForgeRules.slice(0, 20)) {
      console.log(`  ${f.workflowName} :: ${f.transitionName} — ${f.ruleKey}`);
    }
  }

  let projectIndex = null;
  if (process.env.PROJECT_INDEX === "1") {
    console.log(`\nResolving workflow → project mapping ...`);
    const idx = await buildWorkflowProjectIndex();
    projectIndex = Object.fromEntries(idx);
    console.log(`\n=== Workflow → projects (classic schemes) ===`);
    const ruleWorkflows = new Set(rules.map((r) => r.workflowName));
    for (const wf of ruleWorkflows) {
      const ps = idx.get(wf) || [];
      const tag = ps.length ? ps.map((p) => `${p.projectKey}${p.isDefault ? "*" : ""}`).join(", ") : "(no classic project — replay-only)";
      console.log(`  ${wf}: ${tag}`);
    }
  }

  writeResult("discovered.json", {
    base: BASE,
    workflowCount,
    total: rules.length,
    summary: sum,
    rules,
    foreignForgeRules,
    projectIndex,
    statusRefCount: Object.keys(statusRef).length,
  });
  console.log(`\nWrote results/discovered.json (${rules.length} rules).`);
}

main().catch((e) => {
  console.error("DISCOVER FAILED:", e.message);
  if (e.body) console.error(JSON.stringify(e.body).slice(0, 600));
  process.exit(1);
});
