/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// MASS TRANSITIONS — a real wave. Drains the Backlog and marches EVERY issue in
// the project FORWARD through the workflow (Backlog -> Selected -> In Progress ->
// Done), distributing the final states across the later columns so the board
// visibly fills and the Jira workflow/transition APIs are stressed at scale. A
// static PF on the In Progress transition fires on every issue that passes
// through it. Issues are NOT cycled back to Backlog (that made prior runs look
// like nothing happened).
//
// Env: MASS_COUNT (0 = ALL issues, default 0), MASS_CONCURRENCY (default 15),
//      MASS_TARGET ("distribute" | "done", default "distribute").

import { getTransitions, doTransition, mapLimit, searchJql } from "../lib/jira.mjs";
import { readWorkflow, updateWorkflow, attachRuleToTransition, buildRule } from "../lib/workflow.mjs";
import { loadState, writeResult } from "../lib/state.mjs";

const COUNT = parseInt(process.env.MASS_COUNT || "0", 10); // 0 = all
const CONCURRENCY = parseInt(process.env.MASS_CONCURRENCY || "15", 10);
const TARGET_MODE = process.env.MASS_TARGET || "distribute";
const FORWARD = ["Selected for Development", "In Progress", "Done"];

async function attachLifecyclePf(workflowName) {
  const { top, wf } = await readWorkflow(workflowName);
  const t = (wf.transitions || []).find((x) => x.name === "In Progress");
  if (!t) return;
  const has = (t.actions || []).some((a) => String(a.parameters?.config || "").includes("mass-touched"));
  if (!has) {
    const code = `const i = await api.getIssue(api.context.issueKey);\nconst labels = Array.isArray(i.fields.labels) ? i.fields.labels : [];\nif (!labels.includes("mass-touched")) await api.updateIssue(api.context.issueKey, { labels: [...labels, "mass-touched"] });\napi.log("mass-touched");`;
    attachRuleToTransition(t, "static", buildRule("static", { type: "postfunction-static", functions: [{ name: "touch", code, variableName: "step1" }] }));
    await updateWorkflow(top, wf);
    console.log('Attached "mass-touched" static PF to the In Progress transition.');
  }
}

// How many forward steps to take for this issue (1=Selected, 2=In Progress, 3=Done).
function stepsForIndex(i) {
  if (TARGET_MODE === "done") return 3;
  const m = i % 10;            // distribution: 20% Selected, 30% In Progress, 50% Done
  if (m < 2) return 1;
  if (m < 5) return 2;
  return 3;
}

async function main() {
  const s = loadState();
  if (!s.workflowName) throw new Error("Run setup first.");
  await attachLifecyclePf(s.workflowName);

  // ALL issues in the project (drain the whole backlog).
  console.log(`Fetching all issues in ${s.projectKey}...`);
  const all = await searchJql(`project = ${s.projectKey} ORDER BY created ASC`, ["status"], 100);
  let keys = all.map((i) => i.key);
  if (COUNT > 0) keys = keys.slice(0, COUNT);
  console.log(`Marching ${keys.length} issues forward (${TARGET_MODE}) at concurrency ${CONCURRENCY}.`);

  // Resolve forward transition ids by name (GLOBAL -> available from any status).
  const sample = await getTransitions(keys[0]);
  const byName = {};
  for (const t of sample.transitions || []) byName[t.name] = t.id;
  const steps = FORWARD.filter((n) => byName[n]).map((n) => ({ name: n, id: byName[n] }));
  console.log(`Forward steps: ${steps.map((x) => `${x.name}(${x.id})`).join(" -> ")}`);
  if (!steps.length) throw new Error("Could not resolve forward transitions.");

  const status = { fired: 0, failed: 0, rateLimited: 0 };
  const t0 = Date.now();
  let done = 0;
  await mapLimit(keys, CONCURRENCY, async (key, i) => {
    const n = Math.min(stepsForIndex(i), steps.length);
    for (let step = 0; step < n; step++) {
      const r = await doTransition(key, steps[step].id);
      if (r.status < 400) status.fired++;
      else { status.failed++; if (r.status === 429) status.rateLimited++; }
    }
    done++;
    if (done % 100 === 0) console.log(`  ${done}/${keys.length} issues moved (${status.fired} transitions, ${status.failed} failed)...`);
  });
  const wall = Date.now() - t0;

  // Final status distribution across the WHOLE project.
  const after = await searchJql(`project = ${s.projectKey}`, ["status"], 100);
  const dist = {};
  for (const i of after) { const st = i.fields.status?.name || "?"; dist[st] = (dist[st] || 0) + 1; }

  const summary = { issuesMoved: keys.length, transitionsFired: status.fired, failed: status.failed, rateLimited: status.rateLimited, wallMs: wall, throughputPerSec: +(status.fired / (wall / 1000)).toFixed(2), finalDistribution: dist };
  writeResult("mass-transitions-results.json", summary);
  console.log(`\n=== Mass transition wave ===`);
  console.log(`  ${status.fired} transitions fired across ${keys.length} issues in ${(wall / 1000).toFixed(1)}s (${summary.throughputPerSec}/s)`);
  console.log(`  failed: ${status.failed} (rate-limited 429: ${status.rateLimited})`);
  console.log(`  final board distribution: ${JSON.stringify(dist)}`);
  console.log("Results -> results/mass-transitions-results.json");
}

main().catch((e) => {
  console.error("MASS-TRANSITIONS FAILED:", e.message);
  if (e.body) console.error(JSON.stringify(e.body, null, 2));
  process.exit(1);
});
