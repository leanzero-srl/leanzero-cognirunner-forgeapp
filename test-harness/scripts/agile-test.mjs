/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Tests the agile (Jira Software) sandbox actions added in v19.0.0:
// moveToSprint, moveToBacklog, rankIssue. Each runs as a real static PF on a
// COGTEST transition; verified via the agile REST API (sprint membership,
// backlog removal, board rank order).

import { post, get, doTransition, searchJql } from "../lib/jira.mjs";
import { attachSelfLoopRules } from "../lib/workflow.mjs";
import { loadState } from "../lib/state.mjs";

const poll = async (fn, ms = 30000) => { const end = Date.now() + ms; do { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 2500)); } while (Date.now() < end); return null; };

async function sprintIssues(sprintId) {
  const r = await get(`/rest/agile/1.0/sprint/${sprintId}/issue?fields=key&maxResults=200`).catch(() => ({ issues: [] }));
  return new Set((r.issues || []).map((i) => i.key));
}
async function boardOrder(boardId) {
  const r = await get(`/rest/agile/1.0/board/${boardId}/issue?fields=key&maxResults=500`).catch(() => ({ issues: [] }));
  return (r.issues || []).map((i) => i.key);
}

async function main() {
  const s = loadState();
  if (!s.agile?.sprintId) throw new Error("Run agile-setup.mjs first.");
  const { sprintId, boardId } = s.agile;
  const mk = async (summary) => (await post("/rest/api/3/issue", { fields: { project: { key: s.projectKey }, issuetype: { id: s.primaryIssueType.id }, summary, labels: ["cogtest-harness", "cogtest-agile"] } })).key;

  // Issues for each test.
  const toSprint = await mk("Agile: moveToSprint");
  const toBacklog = await mk("Agile: moveToBacklog");
  const rankA = await mk("Agile: rank A");
  const rankB = await mk("Agile: rank B");
  // Pre-place: toBacklog into the sprint (so moveToBacklog has something to remove).
  await post(`/rest/agile/1.0/sprint/${sprintId}/issue`, { issues: [toBacklog] });
  await new Promise((r) => setTimeout(r, 1500));

  const specs = [
    { name: "AGL-moveToSprint", type: "static", config: { type: "postfunction-static", debugTrace: true, functions: [{ name: "s", code: `await api.moveToSprint(${sprintId});`, variableName: "step1" }] } },
    { name: "AGL-moveToBacklog", type: "static", config: { type: "postfunction-static", debugTrace: true, functions: [{ name: "b", code: `await api.moveToBacklog();`, variableName: "step1" }] } },
    { name: "AGL-rankIssue", type: "static", config: { type: "postfunction-static", debugTrace: true, functions: [{ name: "r", code: `await api.rankIssue(${JSON.stringify(rankB)});`, variableName: "step1" }] } },
  ];
  const att = await attachSelfLoopRules(s.workflowName, s.hubStatusRef, specs, 9800);
  const tid = { sprint: att[0].transitionId, backlog: att[1].transitionId, rank: att[2].transitionId };
  console.log("Attached agile PFs:", JSON.stringify(tid));

  const results = {};

  // moveToSprint
  await doTransition(toSprint, tid.sprint);
  results.moveToSprint = { ok: !!(await poll(async () => (await sprintIssues(sprintId)).has(toSprint) ? true : null)) };

  // moveToBacklog (toBacklog was pre-added to the sprint)
  await doTransition(toBacklog, tid.backlog);
  results.moveToBacklog = { ok: !!(await poll(async () => !(await sprintIssues(sprintId)).has(toBacklog) ? true : null)) };

  // rankIssue: rank A before B, then verify via JQL ORDER BY Rank (reliable).
  await doTransition(rankA, tid.rank);
  results.rankIssue = { ok: !!(await poll(async () => {
    const ranked = await searchJql(`key in (${rankA},${rankB}) ORDER BY Rank ASC`, ["key"], 5);
    return (ranked.length === 2 && ranked[0].key === rankA) ? true : null;
  })) };

  console.log("\n=== Agile action results ===");
  for (const [name, r] of Object.entries(results)) console.log(`  ${name.padEnd(16)} ${r.ok ? "✓" : "✗"}`);
  const okCount = Object.values(results).filter((r) => r.ok).length;
  console.log(`\n${okCount}/${Object.keys(results).length} agile actions verified (sprint=${sprintId}, board=${boardId}).`);
}

main().catch((e) => { console.error("AGILE-TEST FAILED:", e.message); if (e.body) console.error(JSON.stringify(e.body, null, 2)); process.exit(1); });
