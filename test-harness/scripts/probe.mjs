/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Smoke-test the REST client: auth, server info, admin perm, app capabilities.

import { getMyself, getServerInfo, get } from "../lib/jira.mjs";

const COGNI_APP_ID = "36415848-6868-4697-9554-3c3ad87b8da9";

async function main() {
  const me = await getMyself();
  console.log(`Auth OK: ${me.displayName} <${me.emailAddress}> (${me.accountId})`);

  const info = await getServerInfo();
  console.log(`Instance: ${info.baseUrl} ${info.deploymentType} build ${info.buildNumber}`);

  const perms = await get(
    "/rest/api/3/mypermissions?permissions=ADMINISTER"
  );
  console.log(`ADMINISTER: ${perms.permissions?.ADMINISTER?.havePermission}`);

  // Confirm CogniRunner forge rules are attachable (scope to any software project)
  const projects = await get("/rest/api/3/project/search?maxResults=50");
  const sw = projects.values.find((p) => p.projectTypeKey === "software");
  if (sw) {
    const pinfo = await get(`/rest/api/3/project/${sw.key}?expand=issueTypes`);
    const it = (pinfo.issueTypes || []).find((i) => !i.subtask) || pinfo.issueTypes?.[0];
    const cap = await get(
      `/rest/api/3/workflows/capabilities?projectId=${pinfo.id}&issueTypeId=${it.id}`
    );
    const forge = (cap.forgeRules || []).filter((r) => r.id?.includes(COGNI_APP_ID));
    console.log(`CogniRunner forge rules visible: ${forge.length}`);
    for (const r of forge) {
      const mod = r.id.split("/static/")[1] || "?";
      console.log(`  ${r.ruleKey}  [${r.ruleType}]  module=${mod}`);
    }
  }
  console.log("\nProbe complete.");
}

main().catch((e) => {
  console.error("PROBE FAILED:", e.message);
  process.exit(1);
});
