/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// LIVE E2E for Scheduled Jobs against a real Jira Cloud site (wolfaenpak test instance).
//   1. REST: create a script job (every 5 minutes, no scope) that comments on a fixed issue,
//      an AI-agent job scoped by JQL to the test issue, and a disabled job.
//   2. Run-now through the REST API for the scoped agent job → poll the task → assert the
//      label + comment it was told to add.
//   3. Wait for the REAL scheduler tick (up to ~12 min) to run the every-5-minutes job and
//      assert its log entry + the comment on the issue (scheduledFor stamped, source=async).
//   4. Preview, enable/disable, PUT, DELETE round-trips.
// Run: node scripts/jobs-e2e.mjs      (KEEP=1 keeps jobs + issue; QUICK=1 skips the tick wait)
import { loadEnv } from "../lib/env.mjs";
import { disposableProject, cleanupFixtures, deleteIssueFixture } from "../lib/fixture-cleanup.mjs";
import { closeRulesApi, rulesApi, waitForTask, waitForLogs } from "../lib/rules-api.mjs";

try {
const env = loadEnv();
const BASE = env.JIRA_BASE_URL.replace(/\/$/, "");
const AUTH = "Basic " + Buffer.from(`${env.JIRA_ADMIN_EMAIL}:${env.JIRA_API_TOKEN}`).toString("base64");
const KEEP = process.env.KEEP === "1"; const QUICK = process.env.QUICK === "1";
const RUN = Date.now().toString(36).slice(-5); const TAG = `crjob${RUN}`;
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
const created = { jobs: [], issues: [] };

async function main() {
  console.log(`JOBS E2E on ${BASE} (run ${RUN})`);
  const proj = await disposableProject(jira, env);
  const types = proj.issueTypes;
  const stdType = types.find((t) => !t.subtask && /task/i.test(t.name)) || types.find((t) => !t.subtask);
  const issue = must(await jira("POST", "/rest/api/3/issue", { fields: { project: { id: proj.id }, issuetype: { id: stdType.id }, summary: `${TAG} scheduled job bed`, labels: [TAG] } }), "create issue");
  created.issues.push(issue.key);
  console.log(`  project ${proj.key}, issue ${issue.key}`);

  // every-5-minutes script job, unscoped → must use api.forIssue
  const tick = must(await rulesApi.jobs.create({
    name: `E2E tick ${RUN}`, schedule: { cron: "*/5 * * * *", timeZone: "UTC" },
    functions: [{ name: "comment", code: `await api.forIssue("${issue.key}").addComment("${TAG} tick " + api.context.scheduledFor + (api.context.manual ? " (manual)" : " (scheduled)"));\nreturn api.context.scheduledFor;` }],
  }), "create tick job").job;
  created.jobs.push(tick.id);
  ok(tick.schedule.cron === "*/5 * * * *" && typeof tick.stats.nextRunAt === "string", `tick job created (${tick.id}), next run ${tick.stats.nextRunAt}`);
  // scoped AI-agent job
  const agent = must(await rulesApi.jobs.create({
    name: `E2E agent ${RUN}`, schedule: { cron: "0 3 * * *", timeZone: "Europe/Zurich" },
    scope: { jql: `labels = ${TAG}`, maxIssues: 5 }, mode: "agent",
    agent: { instructions: `Add the label "${TAG}-agent" to the current issue and post a comment containing exactly "${TAG} agent ran". Then finish.`, allowedActions: ["get_issue", "add_comment", "add_labels"], maxRounds: 4 },
  }), "create agent job").job;
  created.jobs.push(agent.id);
  const disabled = must(await rulesApi.jobs.create({ name: `E2E disabled ${RUN}`, enabled: false, schedule: { cron: "* * * * *" }, functions: [{ name: "x", code: `await api.forIssue("${issue.key}").addLabels("${TAG}-never");` }] }), "create disabled").job;
  created.jobs.push(disabled.id);
  ok(disabled.enabled === false && disabled.stats.nextRunAt === null, "disabled job has no next run");
  const pv = await rulesApi.jobs.preview(agent.id, { count: 3 });
  ok(pv.ok && pv.body.runs.length === 3 && /03:00/.test(pv.body.description), `preview: ${pv.body && pv.body.description} → ${pv.body && pv.body.runs[0]}`);
  const bad = await rulesApi.jobs.create({ name: "bad", schedule: { cron: "99 * * * *" }, functions: [{ code: "1" }] });
  ok(bad.status === 400 && /schedule.cron is invalid/.test(bad.body.error || ""), "invalid cron → 400");

  // run now (agent, scoped)
  const run = await rulesApi.jobs.run(agent.id);
  ok(run.status === 202 && run.body.taskId, `run-now queued (task ${run.body && run.body.taskId})`);
  const task = await waitForTask(run.body.taskId, { tries: 60 });
  ok(task.status === "done" && task.result && task.result.success, `run-now finished: ${task.status} — ${task.result && task.result.reason}`);
  ok(task.result && Array.isArray(task.result.issues) && task.result.issues.some((i) => i.key === issue.key && i.success), "scoped run processed the test issue");
  const fin = must(await jira("GET", `/rest/api/3/issue/${issue.key}?fields=labels,comment`), "issue after run");
  ok((fin.fields.labels || []).includes(`${TAG}-agent`), `label ${TAG}-agent added by the agent job`);
  ok((fin.fields.comment.comments || []).some((c) => JSON.stringify(c.body).includes(`${TAG} agent ran`)), "agent job comment posted");
  const jl = await rulesApi.logs(agent.id);
  ok(jl.ok && jl.body.logs.some((l) => l.type === "scheduledjob" && l.manual === true && l.isValid), "run-now logged as a manual scheduled-job execution");

  // run-now of the tick job too (manual path) — proves api.forIssue on an unscoped run
  const run2 = await rulesApi.jobs.run(tick.id);
  const task2 = await waitForTask(run2.body.taskId, { tries: 40 });
  ok(task2.status === "done" && task2.result && task2.result.success, `tick job manual run: ${task2.status} — ${task2.result && task2.result.reason}`);

  // the real scheduler
  if (!QUICK) {
    console.log("  waiting for the real 5-minute scheduler tick (up to 12 min)…");
    const w = await waitForLogs(tick.id, (logs) => logs.some((l) => l.type === "scheduledjob" && !l.manual && l.isValid && l.scheduledFor), { intervalMs: 15000, tries: 48 });
    const sched = w.logs.find((l) => l.type === "scheduledjob" && !l.manual && l.isValid);
    ok(!!sched, `scheduler ran the tick job: scheduledFor=${sched && sched.scheduledFor} (queue delay ${sched && sched.queueDelayMs} ms)`);
    const fin2 = must(await jira("GET", `/rest/api/3/issue/${issue.key}?fields=comment`), "issue after tick");
    ok((fin2.fields.comment.comments || []).some((c) => JSON.stringify(c.body).includes("(scheduled)")), "scheduled (non-manual) tick comment posted on the issue");
    const st = await rulesApi.jobs.get(tick.id);
    ok(st.ok && st.body.job.stats.runCount >= 2 && st.body.job.stats.lastStatus === "ok", `job stats updated (runs ${st.body && st.body.job.stats.runCount})`);
  }

  // lifecycle round-trips
  const dis = await rulesApi.jobs.disable(tick.id);
  ok(dis.ok && dis.body.job.enabled === false, "disable via REST");
  const en = await rulesApi.jobs.enable(tick.id);
  ok(en.ok && en.body.job.enabled === true && en.body.job.stats.nextRunAt, "enable via REST recomputes next run");
  const put = await rulesApi.jobs.update(tick.id, { schedule: { cron: "0 6 * * *" } });
  ok(put.ok && put.body.job.schedule.cron === "0 6 * * *" && put.body.job.schedule.timeZone === "UTC", "PUT merges the schedule (zone kept)");
  const dl = await rulesApi.jobs.remove(disabled.id);
  ok(dl.ok, "DELETE removes a job");
  created.jobs = created.jobs.filter((id) => id !== disabled.id);
  const gone = await rulesApi.jobs.get(disabled.id);
  ok(gone.status === 404, "deleted job → 404");
}
async function cleanup() {
  if (KEEP) { console.log("KEEP=1 — leaving jobs + issue in place"); return; }
  fail += await cleanupFixtures([
    ...created.jobs.map(id => [`job ${id}`, () => rulesApi.jobs.remove(id)]),
    ...created.issues.map(key => [`issue ${key}`, () => deleteIssueFixture(jira, key)]),
  ]);
}
try { await main(); } catch (e) { fail++; console.log("  ✗ E2E threw: " + (e && e.stack || e)); } finally { await cleanup(); }
console.log(`\nJOBS E2E: ${pass} passed, ${fail} failed`);
process.exitCode = process.exitCode || (fail ? 1 : 0);

} finally {
  await closeRulesApi();
}
