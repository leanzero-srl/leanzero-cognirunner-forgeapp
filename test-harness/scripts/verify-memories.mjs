/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Verify RUNTIME MEMORY INJECTION. Memories are only injected into validators /
// conditions / semantic PFs when an admin opts in (Memories tab: "runtime
// injection" ON) AND at least one memory exists. This script fires a validator
// (debugTrace on) and reads the memoriesUsed flag from the cogni-debug property
// to prove whether memories reached the prompt. Run it AFTER enabling the
// setting + adding a memory in the admin panel.
//
// Optional influence probe: set MEMORY_TOKEN to a distinctive word you put in a
// memory; the script seeds an issue mentioning it and shows the validator reason.

import { post, get, doTransition } from "../lib/jira.mjs";
import { attachSelfLoopRules } from "../lib/workflow.mjs";
import { loadState } from "../lib/state.mjs";

const TOKEN = process.env.MEMORY_TOKEN || "";

async function main() {
  const s = loadState();
  if (!s.workflowName) throw new Error("Run setup-testbed first.");

  // Attach a fresh memory-probe validator (debugTrace on) as a self-loop.
  const att = await attachSelfLoopRules(s.workflowName, s.hubStatusRef, [{
    name: "CT-Memory-Probe", type: "validator",
    config: {
      fieldId: "summary",
      prompt: "Always PASS. If any advisory 'Learned Memories' were provided to you, quote the first one VERBATIM in your reason, prefixed with 'MEMORY:'. If none were provided, say 'no memories'.",
      enableTools: false, debugTrace: true,
    },
  }], 9500);
  const tid = att[0].transitionId;

  // Issue (optionally mentioning the memory token for an influence signal).
  const summary = TOKEN ? `Investigate ${TOKEN} regression in checkout` : "Investigate checkout regression and add tests";
  const issue = await post("/rest/api/3/issue", { fields: { project: { key: s.projectKey }, issuetype: { id: s.primaryIssueType.id }, summary, labels: ["cogtest-harness", "cogtest-memprobe"] } });
  await new Promise((r) => setTimeout(r, 1200));

  await doTransition(issue.key, tid);
  await new Promise((r) => setTimeout(r, 1800));

  const prop = await get(`/rest/api/3/issue/${issue.key}/properties/cogni-debug`).catch(() => null);
  const v = prop?.value;
  const used = v?.memoriesUsed === true;

  console.log(`\n=== Memory injection check (issue ${issue.key}) ===`);
  console.log(`  memoriesUsed = ${used}`);
  console.log(`  validator reason: ${(v?.reason || "(none)").slice(0, 200)}`);
  if (used) {
    console.log(`\n  ✅ Runtime memory injection is ACTIVE — memories reached the validator prompt.`);
  } else {
    console.log(`\n  ⚠️  No memories injected yet. To enable (admin panel):`);
    console.log(`     1. Open CogniRunner admin panel → Memories tab.`);
    console.log(`     2. Turn ON "runtime injection" (opt-in, default OFF). Keep the master "injection" ON.`);
    console.log(`     3. Add at least one memory (Add memory). For an influence probe, include a`);
    console.log(`        distinctive word and re-run with MEMORY_TOKEN=<that word>.`);
    console.log(`     4. Re-run:  npm run verify-memories`);
  }
}

main().catch((e) => {
  console.error("VERIFY-MEMORIES FAILED:", e.message);
  process.exit(1);
});
