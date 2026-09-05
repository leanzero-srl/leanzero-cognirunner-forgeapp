/*
 * CogniRunner - Copyright (C) 2025 LeanZero
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Keep cleanup failures visible and continue cleaning the remaining owned fixtures.
export async function cleanupFixtures(tasks) {
  let failed = 0;
  for (const [label, remove] of tasks) {
    try {
      const r = await remove();
      if (!r || (!r.ok && r.status !== 404) || r.body?.success === false) {
        throw new Error(`HTTP ${r?.status ?? "unknown"}`);
      }
      console.log(`  cleanup OK: ${label}`);
    } catch (e) {
      failed++;
      console.error(`  cleanup FAILED: ${label}: ${e.message}`);
    }
  }
  if (failed) process.exitCode = 1;
  return failed;
}

// Only call for issue keys created by this run. A failed DELETE is never "cleaned".
export async function deleteIssueFixture(jira, key) {
  const before = await jira("GET", `/rest/api/3/issue/${key}?fields=summary`);
  if (before.status === 404) return before; // Already deleted by a lifecycle assertion.
  if (!before.ok || before.body?.key !== key) throw new Error(`Cannot verify owned issue ${key}: HTTP ${before.status}`);
  const removed = await jira("DELETE", `/rest/api/3/issue/${key}?deleteSubtasks=true`);
  if (!removed.ok) return removed;
  const after = await jira("GET", `/rest/api/3/issue/${key}?fields=summary`);
  if (after.status !== 404) throw new Error(`Issue still readable or absence unverified: HTTP ${after.status}`);
  return removed;
}

// Listener/job fixtures use an explicitly named disposable project, never an arbitrary
// first project or the older workflow-scale COGTEST bed with no Delete Issues permission.
export async function disposableProject(jira, env) {
  const key = env.RULES_TEST_PROJECT_KEY || "LZPT";
  const p = await jira("GET", `/rest/api/3/project/${encodeURIComponent(key)}`);
  if (!p.ok || p.body?.key !== key) throw new Error(`Cannot read rules test project ${key}: HTTP ${p.status}`);
  const cm = await jira("GET", `/rest/api/3/issue/createmeta/${encodeURIComponent(key)}/issuetypes?maxResults=100`);
  const types = cm.ok ? (cm.body?.issueTypes || cm.body?.values || []) : [];
  if (!types.some(t => !t.subtask)) throw new Error(`No creatable issue type in rules test project ${key}`);
  const perms = await jira("GET", `/rest/api/3/mypermissions?projectKey=${encodeURIComponent(key)}&permissions=DELETE_ISSUES`);
  if (!perms.ok || !perms.body?.permissions?.DELETE_ISSUES?.havePermission) throw new Error(`Rules test project ${key} requires Delete Issues for fixture cleanup`);
  return { ...p.body, issueTypes: types };
}
