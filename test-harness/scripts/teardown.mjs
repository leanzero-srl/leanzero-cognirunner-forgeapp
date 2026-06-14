/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Destructive cleanup: deletes the COGTEST project (cascades its workflow,
// scheme, screens, issues, and attached rules) and the instance-wide COGTEST_*
// custom fields. Guarded — requires CONFIRM=1 to run.

import { get, del } from "../lib/jira.mjs";
import { loadState, saveState } from "../lib/state.mjs";

async function main() {
  if (process.env.CONFIRM !== "1") {
    console.log("Refusing to delete without confirmation. Re-run with:  CONFIRM=1 npm run teardown");
    console.log("This will DELETE the COGTEST project (all issues) and the COGTEST_* custom fields.");
    return;
  }
  const s = loadState();
  const key = s.projectKey || process.env.COGTEST_PROJECT_KEY || "COGTEST";

  // Delete project (cascades issues, workflow scheme, screens, attached rules)
  try {
    await del(`/rest/api/3/project/${key}`);
    console.log(`Deleted project ${key}.`);
  } catch (e) {
    console.log(`Project delete: ${e.message.slice(0, 160)}`);
  }

  // Delete COGTEST_* custom fields (instance-wide -> trash)
  const all = await get("/rest/api/3/field");
  const cogFields = all.filter((f) => f.custom && /^COGTEST_/.test(f.name || ""));
  for (const f of cogFields) {
    try {
      await del(`/rest/api/3/field/${f.id}`);
      console.log(`Trashed field ${f.name} (${f.id}).`);
    } catch (e) {
      console.log(`Field ${f.name} delete: ${e.message.slice(0, 120)}`);
    }
  }

  saveState({});
  console.log("Teardown complete. (Custom fields are moved to trash; purge from Jira admin if desired.)");
}

main().catch((e) => {
  console.error("TEARDOWN FAILED:", e.message);
  process.exit(1);
});
