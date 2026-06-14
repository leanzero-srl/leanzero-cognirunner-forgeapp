/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Stand up Jira Software agile structure over COGTEST so the agile sandbox
// actions (moveToSprint / moveToBacklog / rankIssue) can be tested: a saved
// filter -> a SCRUM board -> a sprint. Idempotent (reuses by name). Stores
// boardId / sprintId / filterId in run-state.

import { get, post, getMyself } from "../lib/jira.mjs";
import { loadState, patchState } from "../lib/state.mjs";

async function ensureFilter(projectKey, accountId) {
  const name = `COGTEST harness filter`;
  const found = await get(`/rest/api/3/filter/search?filterName=${encodeURIComponent(name)}`).catch(() => ({ values: [] }));
  const hit = (found.values || []).find((f) => f.name === name);
  if (hit) return hit.id;
  const f = await post("/rest/api/3/filter", {
    name, jql: `project = ${projectKey} ORDER BY Rank ASC`,
    sharePermissions: [{ type: "authenticated" }],
    editPermissions: [],
  });
  return f.id;
}

async function ensureScrumBoard(filterId) {
  const name = "COGTEST Scrum (harness)";
  const search = await get(`/rest/agile/1.0/board?name=${encodeURIComponent(name)}`).catch(() => ({ values: [] }));
  const hit = (search.values || []).find((b) => b.name === name && b.type === "scrum");
  if (hit) return hit.id;
  const b = await post("/rest/agile/1.0/board", { name, type: "scrum", filterId: Number(filterId) });
  return b.id;
}

async function ensureSprint(boardId) {
  const name = "Harness Sprint 1";
  const search = await get(`/rest/agile/1.0/board/${boardId}/sprint?state=active,future`).catch(() => ({ values: [] }));
  const hit = (search.values || []).find((sp) => sp.name === name);
  if (hit) return { id: hit.id, state: hit.state };
  const sp = await post("/rest/agile/1.0/sprint", { name, originBoardId: Number(boardId), goal: "Harness agile-action tests" });
  return { id: sp.id, state: sp.state };
}

async function main() {
  const s = loadState();
  if (!s.projectKey) throw new Error("Run setup-testbed first.");
  const me = await getMyself();
  const filterId = await ensureFilter(s.projectKey, me.accountId);
  console.log(`Filter: ${filterId}`);
  const boardId = await ensureScrumBoard(filterId);
  console.log(`Scrum board: ${boardId}`);
  const sprint = await ensureSprint(boardId);
  console.log(`Sprint: ${sprint.id} (${sprint.state})`);

  patchState({ agile: { filterId, boardId, sprintId: sprint.id, sprintState: sprint.state } });
  console.log(`\nAgile structure ready. board=${boardId} sprint=${sprint.id}`);
}

main().catch((e) => {
  console.error("AGILE-SETUP FAILED:", e.message);
  if (e.body) console.error(JSON.stringify(e.body, null, 2));
  process.exit(1);
});
