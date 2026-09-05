/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Focused LIVE probe: one script listener + one AI-agent listener + one version listener
// on the same comment pattern / project, ONE comment, ONE version release. Verifies each
// runs (execution logs via REST) and the agent's side effects land. Fast (~2 min).
// Run: node scripts/listeners-agent-probe.mjs
import { loadEnv } from "../lib/env.mjs";
import { disposableProject, cleanupFixtures, deleteIssueFixture } from "../lib/fixture-cleanup.mjs";
import { closeRulesApi, rulesApi, waitForLogs } from "../lib/rules-api.mjs";

try {
const env = loadEnv();
const BASE = env.JIRA_BASE_URL.replace(/\/$/, "");
const AUTH = "Basic " + Buffer.from(`${env.JIRA_ADMIN_EMAIL}:${env.JIRA_API_TOKEN}`).toString("base64");
const RUN = Date.now().toString(36).slice(-5); const TAG = `crprobe${RUN}`;
let pass = 0; let fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log("  ✓ " + msg); } else { fail++; console.log("  ✗ " + msg); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jira = async (method, path, body) => {
  const res = await fetch(`${BASE}${path}`, { method, headers: { Authorization: AUTH, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 300) }; }
  return { status: res.status, ok: res.ok, body: json };
};
const must = (r, what) => { if (!r.ok) throw new Error(`${what} → ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`); return r.body; };
const adf = (t) => ({ type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });
const created = { listeners: [], issues: [], versions: [] };
try {
  const proj = await disposableProject(jira, env);
  const types = proj.issueTypes;
  const stdType = types.find((t) => !t.subtask && /task/i.test(t.name)) || types.find((t) => !t.subtask);
  const script = must(await rulesApi.listeners.create({ name: `Probe script ${RUN}`, events: ["avi:jira:commented:issue"], filters: { projectKeys: [proj.key], commentPattern: `${TAG}-ping` }, functions: [{ name: "label", code: `await api.addLabels("${TAG}-script");` }] }), "script").listener;
  created.listeners.push(script.id);
  const agent = must(await rulesApi.listeners.create({ name: `Probe agent ${RUN}`, events: ["avi:jira:commented:issue"], filters: { projectKeys: [proj.key], commentPattern: `${TAG}-ping` }, mode: "agent", agent: { instructions: `Add the label "${TAG}-agent" to the issue and reply with a comment containing exactly "${TAG} agent acknowledged". Then finish.`, allowedActions: ["get_issue", "add_comment", "add_labels"], maxRounds: 4 } }), "agent").listener;
  created.listeners.push(agent.id);
  const version = must(await rulesApi.listeners.create({ name: `Probe version ${RUN}`, events: ["avi:jira:released:version"], filters: { projectKeys: [proj.key] }, functions: [{ name: "announce", code: `const r = await api.searchJql("labels = ${TAG}-script");\nfor (const i of (r.issues || []).slice(0, 1)) await api.forIssue(i.key).addComment("${TAG}: version released " + (api.context.event.version || {}).name);\nreturn r.issues.length;` }] }), "version").listener;
  created.listeners.push(version.id);
  console.log(`  listeners: script ${script.id}, agent ${agent.id}, version ${version.id}; waiting 35s for the trigger cache…`);
  await sleep(35000);
  const issue = must(await jira("POST", "/rest/api/3/issue", { fields: { project: { id: proj.id }, issuetype: { id: stdType.id }, summary: `${TAG} probe` } }), "issue");
  created.issues.push(issue.key);
  must(await jira("POST", `/rest/api/3/issue/${issue.key}/comment`, { body: adf(`${TAG}-ping please acknowledge`) }), "comment");
  console.log(`  issue ${issue.key}, comment posted; waiting for runs…`);
  const ws = await waitForLogs(script.id, (l) => l.some((x) => x.issueKey === issue.key), { tries: 30 });
  ok(ws.ok && ws.logs[0].isValid, `script listener ran: ${ws.logs[0] && ws.logs[0].reason}`);
  const wa = await waitForLogs(agent.id, (l) => l.some((x) => x.issueKey === issue.key), { tries: 36 });
  const a = wa.logs.find((x) => x.issueKey === issue.key);
  ok(!!a, `agent listener produced a log entry${a ? `: ${a.isValid ? "PASS" : "FAIL"} — ${a.reason}` : ""}`);
  if (a && a.toolCalls) console.log("    tool calls:", JSON.stringify(a.toolCalls));
  if (a && a.logs) console.log("    " + a.logs.slice(-8).join("\n    "));
  await sleep(4000);
  const fin = must(await jira("GET", `/rest/api/3/issue/${issue.key}?fields=labels,comment`), "issue after");
  ok((fin.fields.labels || []).includes(`${TAG}-script`), "script label present");
  ok((fin.fields.labels || []).includes(`${TAG}-agent`), "agent label present");
  ok((fin.fields.comment.comments || []).some((c) => JSON.stringify(c.body).includes(`${TAG} agent acknowledged`)), "agent acknowledgement comment present");
  // version release → non-issue event with project id only
  const ver = must(await jira("POST", "/rest/api/3/version", { name: `${TAG}-v1`, projectId: Number(proj.id) }), "version"); created.versions.push(ver.id);
  must(await jira("PUT", `/rest/api/3/version/${ver.id}`, { released: true }), "release");
  const wv = await waitForLogs(version.id, (l) => l.length > 0, { tries: 30 });
  ok(wv.ok && wv.logs[0].isValid, `version listener ran on released:version (project filter resolved by id): ${wv.logs[0] && wv.logs[0].reason}`);
  const fin2 = must(await jira("GET", `/rest/api/3/issue/${issue.key}?fields=comment`), "issue after version");
  ok((fin2.fields.comment.comments || []).some((c) => JSON.stringify(c.body).includes("version released")), "version-released comment posted via api.forIssue");
} catch (e) { fail++; console.log("  ✗ probe threw: " + (e && e.stack || e)); }
fail += await cleanupFixtures([
  ...created.listeners.map(id => [`listener ${id}`, () => rulesApi.listeners.remove(id)]),
  ...created.versions.map(id => [`version ${id}`, () => jira("POST", `/rest/api/3/version/${id}/removeAndSwap`, {})]),
  ...created.issues.map(key => [`issue ${key}`, () => deleteIssueFixture(jira, key)]),
]);
console.log(`\nAGENT PROBE: ${pass} passed, ${fail} failed`);
process.exitCode = process.exitCode || (fail ? 1 : 0);

} finally {
  await closeRulesApi();
}
