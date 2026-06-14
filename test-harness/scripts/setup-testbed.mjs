/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Idempotent test-bed setup. Phase 1 (this file): create the isolated COGTEST
// company-managed software project, discover its generated workflow + hub
// status, and persist run-state. Custom fields + screen wiring are added by
// setup-fields.mjs (kept separate so each phase can be re-run independently).

import { get, post, getMyself } from "../lib/jira.mjs";
import { readWorkflow, initialStatusRef } from "../lib/workflow.mjs";
import { patchState } from "../lib/state.mjs";

const PROJECT_KEY = process.env.COGTEST_PROJECT_KEY || "COGTEST";
const PROJECT_NAME = "CogniRunner Test Harness";
const TEMPLATE = "com.pyxis.greenhopper.jira:gh-simplified-kanban-classic";

async function ensureProject(leadAccountId) {
  try {
    const existing = await get(`/rest/api/3/project/${PROJECT_KEY}`);
    console.log(`Project ${PROJECT_KEY} already exists (id ${existing.id}).`);
    return existing;
  } catch (e) {
    if (e.status !== 404) throw e;
  }
  console.log(`Creating company-managed software project ${PROJECT_KEY}...`);
  const created = await post("/rest/api/3/project", {
    key: PROJECT_KEY,
    name: PROJECT_NAME,
    projectTypeKey: "software",
    projectTemplateKey: TEMPLATE,
    leadAccountId,
    assigneeType: "PROJECT_LEAD",
    description: "Automated CogniRunner E2E test harness — safe to delete.",
  });
  console.log(`Created project id ${created.id}.`);
  return await get(`/rest/api/3/project/${PROJECT_KEY}`);
}

async function main() {
  const me = await getMyself();
  console.log(`Acting as ${me.displayName} (${me.accountId})`);

  const project = await ensureProject(me.accountId);
  const meta = await get(`/rest/api/3/project/${PROJECT_KEY}?expand=issueTypes`);
  const issueTypes = (meta.issueTypes || []).map((t) => ({
    id: t.id,
    name: t.name,
    subtask: !!t.subtask,
  }));
  const standardTypes = issueTypes.filter((t) => !t.subtask);
  console.log(`Issue types: ${issueTypes.map((t) => t.name).join(", ")}`);

  // The generated workflow follows the instance-wide naming pattern.
  const workflowName = `Software Simplified Workflow for Project ${PROJECT_KEY}`;
  let hubStatusRef, hubStatusName, statusesByRef = {};
  try {
    const { top, wf } = await readWorkflow(workflowName);
    hubStatusRef = initialStatusRef(wf);
    // map statusReference -> name/id via top-level statuses
    for (const s of top.statuses || []) {
      statusesByRef[s.statusReference] = { id: s.id, name: s.name, category: s.statusCategory?.key };
    }
    hubStatusName = statusesByRef[hubStatusRef]?.name;
    console.log(`Workflow "${workflowName}" found.`);
    console.log(`Statuses: ${(wf.statuses || []).map((s) => `${statusesByRef[s.statusReference]?.name}(${s.statusReference})`).join(", ")}`);
    console.log(`Hub status (issue birth): ${hubStatusName} (ref ${hubStatusRef})`);
    console.log(`Existing transitions: ${(wf.transitions || []).map((t) => `${t.id}:${t.name}`).join(", ")}`);
  } catch (e) {
    console.error(`Could not read generated workflow "${workflowName}": ${e.message}`);
    console.error("You may need to inspect the project's workflow scheme manually.");
    throw e;
  }

  const state = patchState({
    projectKey: PROJECT_KEY,
    projectId: project.id,
    projectName: PROJECT_NAME,
    leadAccountId: me.accountId,
    issueTypes,
    primaryIssueType: standardTypes[0],
    workflowName,
    hubStatusRef,
    hubStatusName,
    statusesByRef,
  });

  console.log("\nState persisted to results/testbed.json");
  console.log(`Project: ${state.projectKey} (${state.projectId})  hub=${state.hubStatusName}`);
}

main().catch((e) => {
  console.error("SETUP FAILED:", e.message);
  if (e.body) console.error(JSON.stringify(e.body, null, 2));
  process.exit(1);
});
