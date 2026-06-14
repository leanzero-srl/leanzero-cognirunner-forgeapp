/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// MASS TRANSITIONS — drive many issues through the REAL workflow lifecycle so
// status changes are VISIBLE on the tickets (the self-loop rules used elsewhere
// keep an issue in place; this one actually moves it Backlog -> Selected -> In
// Progress -> Done -> Backlog, cycling). A static PF is attached to the
// "In Progress" lifecycle transition so the mass moves also fire a rule at scale.
//
// Env: MASS_COUNT (issues, default 50), MASS_CYCLES (laps, default 2),
//      MASS_CONCURRENCY (default 8).

import { getTransitions, doTransition, getIssue, mapLimit, sleep } from "../lib/jira.mjs";
import { readWorkflow, updateWorkflow, attachRuleToTransition, buildRule } from "../lib/workflow.mjs";
import { loadState, writeResult } from "../lib/state.mjs";

const COUNT = parseInt(process.env.MASS_COUNT || "50", 10);
const CYCLES = parseInt(process.env.MASS_CYCLES || "2", 10);
const CONCURRENCY = parseInt(process.env.MASS_CONCURRENCY || "8", 10);
// Lifecycle order to walk (names from the generated company-managed workflow).
const LIFECYCLE = ["Selected for Development", "In Progress", "Done", "Backlog"];

// Attach a static PF to the "In Progress" lifecycle transition so mass moves
// also exercise a rule (adds a label) — idempotent.
async function attachLifecyclePf(workflowName) {
  const { top, wf } = await readWorkflow(workflowName);
  const t = (wf.transitions || []).find((x) => x.name === "In Progress");
  if (!t) return null;
  const has = (t.actions || []).some((a) => a.parameters?.key?.includes("36415848") && String(a.parameters?.config || "").includes("mass-touched"));
  if (!has) {
    const code = `const i = await api.getIssue(api.context.issueKey);\nconst labels = Array.isArray(i.fields.labels) ? i.fields.labels : [];\nif (!labels.includes("mass-touched")) await api.updateIssue(api.context.issueKey, { labels: [...labels, "mass-touched"] });\napi.log("mass-touched");`;
    attachRuleToTransition(t, "static", buildRule("static", { type: "postfunction-static", functions: [{ name: "touch", code, variableName: "step1" }] }));
    await updateWorkflow(top, wf);
    console.log('Attached "mass-touched" static PF to the In Progress transition.');
  }
  return t.id;
}

async function main() {
  const s = loadState();
  if (!s.issues) throw new Error("Run setup + seed first.");
  await attachLifecyclePf(s.workflowName);

  // Pick a pool of real issues to march through the lifecycle.
  const keys = Object.values(s.issues).map((v) => v.key).slice(0, COUNT);
  console.log(`Marching ${keys.length} issues through ${CYCLES} lifecycle lap(s) at concurrency ${CONCURRENCY}.`);

  // Resolve lifecycle transition ids by name from a sample issue (they are GLOBAL
  // so available from any status).
  const sample = await getTransitions(keys[0]);
  const byName = {};
  for (const t of sample.transitions || []) byName[t.name] = t.id;
  const steps = LIFECYCLE.filter((n) => byName[n]).map((n) => ({ name: n, id: byName[n] }));
  console.log(`Lifecycle steps: ${steps.map((x) => `${x.name}(${x.id})`).join(" -> ")}`);
  if (steps.length < 2) throw new Error("Could not resolve lifecycle transitions.");

  let fired = 0, failed = 0;
  const t0 = Date.now();
  await mapLimit(keys, CONCURRENCY, async (key) => {
    for (let lap = 0; lap < CYCLES; lap++) {
      for (const step of steps) {
        const r = await doTransition(key, step.id);
        if (r.status < 400) fired++;
        else failed++;
        // tiny gap so a human watching the ticket sees the moves progress
        await sleep(150);
      }
    }
  });
  const wall = Date.now() - t0;

  // Final status distribution
  const dist = {};
  const sampleKeys = keys.slice(0, Math.min(keys.length, 25));
  await mapLimit(sampleKeys, CONCURRENCY, async (key) => {
    const iss = await getIssue(key, "status");
    const st = iss.fields.status?.name || "?";
    dist[st] = (dist[st] || 0) + 1;
  });

  const summary = { issues: keys.length, cycles: CYCLES, transitionsFired: fired, failed, wallMs: wall, throughputPerSec: +(fired / (wall / 1000)).toFixed(2), statusSample: dist };
  writeResult("mass-transitions-results.json", summary);
  console.log(`\n=== Mass transitions ===`);
  console.log(`  ${fired} transitions fired (${failed} failed) across ${keys.length} issues in ${(wall / 1000).toFixed(1)}s (${summary.throughputPerSec}/s)`);
  console.log(`  status sample: ${JSON.stringify(dist)}`);
  console.log(`  Watch any COGTEST issue move Backlog -> Selected -> In Progress -> Done -> Backlog.`);
  console.log("Results -> results/mass-transitions-results.json");
}

main().catch((e) => {
  console.error("MASS-TRANSITIONS FAILED:", e.message);
  if (e.body) console.error(JSON.stringify(e.body, null, 2));
  process.exit(1);
});
