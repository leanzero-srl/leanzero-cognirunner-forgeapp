/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// LIVE proof of two 1.4-commit-13 items the big suites do not cover:
//
//  A. THE JOB WRITE BRAKE. A scoped AI job with `maxWritesPerRun: 2` over THREE issues
//     that each take one write: the third issue must be left UNPROCESSED and the run row
//     must carry `brake: { kind: "job-writes" }`. Proven on the real issues, not on the
//     counter: the third issue's labels are read back and must be empty.
//  B. KNOWLEDGE INTO AGENTS. A listener bound to a real skill id with `useMemories:true`
//     must record "Knowledge injected: skills + memories" in its run log — the one line
//     the runner writes when `buildKnowledgeMessages` produced anything.
//
// Everything is driven through the dev test-state hook's resolver layer as an admin, and
// every fixture is removed at the end.
//
// Run: node scripts/brakes-knowledge-live.mjs        (KEEP=1 keeps the fixtures)
import { loadEnv } from "../lib/env.mjs";
import { testState } from "../lib/rules-api.mjs";
import { disposableProject, cleanupFixtures, deleteIssueFixture } from "../lib/fixture-cleanup.mjs";

const env = loadEnv();
const BASE = env.JIRA_BASE_URL.replace(/\/$/, "");
const AUTH = "Basic " + Buffer.from(`${env.JIRA_ADMIN_EMAIL}:${env.JIRA_API_TOKEN}`).toString("base64");
const ADMIN = env.HARNESS_ADMIN_ACCOUNT_ID;
const RUN = Date.now().toString(36).slice(-5);
const TAG = `crbk${RUN}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log("  PASS " + msg); } else { fail++; console.log("  FAIL " + msg); } };
// The hook and Jira both sit behind a laptop's network; one dropped socket must not lose
// a live run that already spent model tokens.
const retry = async (fn, n = 4) => { let e; for (let i = 0; i < n; i++) { try { return await fn(); } catch (x) { e = x; await sleep(3000); } } throw e; };
const jira = (method, path, body) => retry(async () => {
  const res = await fetch(`${BASE}${path}`, { method, headers: { Authorization: AUTH, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 300) }; }
  return { status: res.status, ok: res.ok, body: json };
});
const invoke = (functionKey, payload) => retry(() => testState.post({ action: "invokeResolver", functionKey, payload, accountId: ADMIN }));

const created = { jobs: [], listeners: [], issues: [], memories: [] };
try {
  const proj = await disposableProject(jira, env);
  const stdType = proj.issueTypes.find((t) => !t.subtask);

  /* ───────────────────── A. the job write brake ───────────────────── */
  for (let i = 1; i <= 3; i++) {
    const r = await jira("POST", "/rest/api/3/issue", { fields: { project: { id: proj.id }, issuetype: { id: stdType.id }, summary: `${TAG} brake target ${i}` } });
    if (!r.ok) throw new Error(`brake target ${i} → ${r.status}`);
    created.issues.push(r.body.key);
  }
  console.log(`  brake targets: ${created.issues.join(", ")}`);
  // The scope is ORDER-BEARING for this proof: the JQL sorts oldest first so "the third
  // issue" is the one created last, and the assertion below reads that exact key.
  const jobSave = await invoke("saveScheduledJob", {
    job: {
      // ENABLED: a manual run of a disabled job is allowed, but an enabled row is what an
      // operator actually has; the cron is 03:00 daily so the real tick cannot fire it here.
      name: `Brake job ${RUN}`, enabled: true,
      schedule: { cron: "0 3 * * *", timeZone: "UTC" },
      // `key in (...)`, never `summary ~ "..."`: Jira's TEXT index lags issue creation by
      // seconds-to-minutes, and a scope that matched zero issues looks exactly like a brake
      // that worked. The key clause is index-independent and ORDER BY key ASC fixes "third".
      scope: { jql: `key in (${created.issues.join(", ")}) ORDER BY key ASC`, maxIssues: 10 },
      maxWritesPerRun: 2,
      mode: "agent",
      agent: { instructions: `Add exactly one label "${TAG}-braked" to the issue, then finish. Nothing else.`, allowedActions: ["add_labels"], maxRounds: 3 },
    },
  });
  const job = jobSave?.body?.job || jobSave?.body?.saved;
  ok(!!job?.id, `scoped job saved: ${job?.id} (maxWritesPerRun=${job?.maxWritesPerRun})`);
  ok(job?.maxWritesPerRun === 2, `the saved record carries maxWritesPerRun=2 (got ${job?.maxWritesPerRun})`);
  if (job?.id) created.jobs.push(job.id);

  const started = await invoke("runScheduledJobNow", { id: job.id });
  const taskId = started?.body?.taskId;
  ok(!!taskId, `run-now queued: ${taskId}`);
  let result = null;
  for (let i = 0; i < 60 && taskId; i++) {
    const r = await invoke("getAsyncTaskResult", { taskId });
    if (r?.body?.status && r.body.status !== "processing") { result = r.body.result || r.body; break; }
    await sleep(5000);
  }
  ok(!!result, "run-now finished");
  if (result) {
    console.log("    reason: " + String(result.reason || result.summary || "").slice(0, 300));
    console.log("    brake:  " + JSON.stringify(result.brake || null));
    console.log("    perIssue: " + JSON.stringify((result.issues || result.perIssue || []).map((x) => ({ key: x.key, success: x.success, reason: String(x.reason || "").slice(0, 40) }))));
  }
  let row = null;
  for (let i = 0; i < 10 && !row; i++) {
    const logs = (await invoke("getLogs", { ruleId: job?.id }))?.body?.logs || [];
    row = logs[0] || null;
    if (!row) await sleep(4000);
  }
  ok(!!row, "the job produced a run row");
  ok(row?.brake?.kind === "job-writes", `the run row carries brake.kind="job-writes" (got ${JSON.stringify(row?.brake || null)})`);
  ok(String(row?.reason || "").includes("BRAKED (job-writes)"), `the row's sentence says it was braked: ${String(row?.reason || "").slice(0, 120)}`);
  const brakeLine = (row?.logs || []).find((l) => /WRITE BRAKE/.test(l));
  ok(!!brakeLine, `the run log names the brake: ${brakeLine || "(absent)"}`);

  // THE SECOND READ — what the user sees on the issues themselves.
  const labelled = [];
  for (const key of created.issues) {
    const r = await jira("GET", `/rest/api/3/issue/${key}?fields=labels`);
    labelled.push({ key, labels: r.body?.fields?.labels || [] });
  }
  console.log("    labels after the run: " + JSON.stringify(labelled));
  const wrote = labelled.filter((x) => x.labels.includes(`${TAG}-braked`));
  ok(wrote.length === 2, `exactly two issues were written (got ${wrote.length}: ${wrote.map((x) => x.key).join(", ")})`);
  const third = labelled[2];
  ok(!third.labels.includes(`${TAG}-braked`), `the THIRD issue ${third.key} was never written — its labels are ${JSON.stringify(third.labels)}`);
  const notProcessed = (row?.perIssue || []).find((x) => x.key === third.key);
  ok(/write brake/.test(String(notProcessed?.reason || "")), `the third issue's per-issue outcome names the brake: ${JSON.stringify(notProcessed || null)}`);

  /* ───────────────────── B. knowledge into an agent listener ───────────────────── */
  const skills = (await invoke("getSkills", {}))?.body?.skills || [];
  const skill = skills.find((s) => /label|bulk|field/i.test(s.name || "")) || skills[0];
  const mems = (await invoke("getMemories", {}))?.body?.memories || [];
  ok(!!skill?.id, `a real skill exists to bind: ${skill?.id} "${skill?.name}"`);
  // THE POSITIVE CONTROL, and it is not optional. `buildMemoryBlock` keeps a memory only
  // when it is unscoped or scoped to THIS project; on a store where every row belongs to
  // another project the block is legitimately empty and "memories were not injected" would
  // be a false defect. So one memory scoped to the run's project is planted here and
  // removed at the end.
  ok(mems.length > 0, `the instance has ${mems.length} memories`);
  const eligible = mems.filter((x) => !x.disabled && (!x.projectKey || x.projectKey === proj.key));
  console.log(`    memories eligible for ${proj.key} before planting: ${eligible.length}`);
  const planted = await invoke("addMemory", { content: `${TAG}: this harness memory exists to prove the memory block reaches an agent run in ${proj.key}.`, projectKey: proj.key, source: "user" });
  const plantedId = planted?.body?.memory?.id || planted?.body?.id || null;
  ok(!!plantedId, `planted a ${proj.key}-scoped memory: ${plantedId}`);
  if (plantedId) created.memories.push(plantedId);

  const lSave = await invoke("saveListener", {
    listener: {
      name: `Knowledge listener ${RUN}`, events: ["avi:jira:created:issue"],
      // NO `jql` FILTER. A listener's JQL filter is evaluated against Jira's TEXT INDEX at
      // trigger time, and an issue created two seconds ago is not in it yet — the event is
      // dropped BEFORE the queue, so there is no run and no log row at all (it cost three
      // "the listener missed the event" false alarms on 2026-09-13). Filter by project and
      // pick this run's issue out of the log rows by key.
      filters: { projectKeys: [proj.key] },
      mode: "agent",
      agent: {
        instructions: `Add the label "${TAG}-know" to the issue and finish.`,
        allowedActions: ["add_labels"], maxRounds: 3,
        skillIds: [skill.id], useMemories: true,
      },
    },
  });
  const listener = lSave?.body?.listener || lSave?.body?.saved;
  ok(!!listener?.id, `listener saved: ${listener?.id}`);
  ok(Array.isArray(listener?.agent?.skillIds) && listener.agent.skillIds.includes(skill.id), `the saved record kept skillIds: ${JSON.stringify(listener?.agent?.skillIds)}`);
  ok(listener?.agent?.useMemories === true, `the saved record kept useMemories: ${listener?.agent?.useMemories}`);
  if (listener?.id) created.listeners.push(listener.id);

  console.log("  waiting 35s for the 30s listener-index cache…");
  await sleep(35000);
  const ki = await jira("POST", "/rest/api/3/issue", { fields: { project: { id: proj.id }, issuetype: { id: stdType.id }, summary: `${TAG}know knowledge target` } });
  created.issues.push(ki.body.key);
  console.log(`  knowledge target: ${ki.body.key} — waiting for the run…`);
  let krow = null;
  for (let i = 0; i < 60; i++) {
    const r = await invoke("getLogs", { ruleId: listener.id });
    krow = (r?.body?.logs || []).find((l) => l.issueKey === ki.body.key) || null;
    if (krow) break;
    await sleep(6000);
  }
  ok(!!krow, "the knowledge listener produced a run row");
  if (krow) {
    const line = (krow.logs || []).find((l) => /Knowledge injected/.test(l));
    console.log("    " + (krow.logs || []).slice(0, 4).join("\n    "));
    ok(!!line, `the run log records the injection: ${line || "(no 'Knowledge injected' line)"}`);
    ok(/skills/.test(line || ""), "the skills block was injected");
    ok(/memories/.test(line || ""), "the memory block was injected");
    const after = await jira("GET", `/rest/api/3/issue/${ki.body.key}?fields=labels`);
    ok((after.body?.fields?.labels || []).includes(`${TAG}-know`), `the run still did its work: labels ${JSON.stringify(after.body?.fields?.labels)}`);
  }
} catch (e) {
  fail++; console.log("  FAIL threw: " + (e && e.stack || e));
}
if (!process.env.KEEP) {
  fail += await cleanupFixtures([
    ...created.jobs.map((id) => ["job " + id, async () => { const r = await invoke("deleteScheduledJob", { id }); return { ok: r.status === 200, status: r.status }; }]),
    ...created.listeners.map((id) => ["listener " + id, async () => { const r = await invoke("deleteListener", { id }); return { ok: r.status === 200, status: r.status }; }]),
    ...created.memories.map((id) => ["memory " + id, async () => { const r = await invoke("deleteMemory", { id }); return { ok: r.status === 200, status: r.status }; }]),
    ...created.issues.map((key) => ["issue " + key, () => deleteIssueFixture(jira, key)]),
  ]);
}
console.log(`\nBRAKES + KNOWLEDGE LIVE: ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
