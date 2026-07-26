/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Reset the run-transitions SUITE corpus back to the hub status (Backlog) so the
// per-rule self-loop transitions are available again. The mass-/pack-transition
// waves march issues through the real lifecycle (Backlog->...->Done), which moves
// the seed corpus OFF the hub status; a directed self-loop (from==to==hub) is only
// available when the issue is IN the hub status, so an off-hub issue makes every
// suite transition fail with Jira's generic "Can't move" 4xx — recorded as a false
// BLOCKED. Run this before run-transitions whenever a wave has run since the last
// suite. Scope: cogtest-harness issues that are NOT part of the cogtest-k bulk.

import { searchJql, getTransitions, doTransition, mapLimit } from "../lib/jira.mjs";

const HUB = process.env.HUB_STATUS || "Backlog";

async function main() {
  const jql = `project = COGTEST AND labels = cogtest-harness AND labels != cogtest-k AND status != "${HUB}" ORDER BY created ASC`;
  const issues = await searchJql(jql, ["status"], 100);
  console.log(`Resetting ${issues.length} suite issues to "${HUB}"...`);
  if (!issues.length) { console.log("Nothing to reset — all suite issues already on the hub."); return; }

  // Resolve the global "Backlog" transition id once (global → available anywhere).
  const sample = await getTransitions(issues[0].key);
  const back = (sample.transitions || []).find((t) => t.name === HUB);
  if (!back) throw new Error(`No transition named "${HUB}" available (have: ${(sample.transitions || []).map((t) => t.name).join(", ")})`);

  let moved = 0, failed = 0;
  await mapLimit(issues, 8, async (iss) => {
    const r = await doTransition(iss.key, back.id);
    if (r.status < 400) moved++; else { failed++; console.log(`  ${iss.key}: HTTP ${r.status}`); }
  });
  console.log(`Reset complete: ${moved} moved to ${HUB}, ${failed} failed.`);
}

main().catch((e) => { console.error("RESET FAILED:", e.message); process.exit(1); });
