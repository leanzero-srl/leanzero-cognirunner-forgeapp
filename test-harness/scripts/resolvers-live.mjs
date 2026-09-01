/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// LIVE resolver-layer test for Listeners / Scheduled Jobs / API tokens: drives the SAME
// resolvers the admin panel invokes (getListeners, saveListener, testListener, runScheduledJobNow,
// getAsyncTaskResult, createApiToken, …) through the dev-gated test-state hook with a synthetic
// Custom-UI principal — the permission gates and payload shapes the REST path bypasses.
// Env: TESTSTATE_URL + HARNESS_SECRET (+ JIRA_* for the fixture issue), RESOLVER_ACCOUNT_ID
// (an app admin's accountId; defaults to the forge-cli login used on wolfaenpak).
// Run: node scripts/resolvers-live.mjs
import { loadEnv } from "../lib/env.mjs";
import { testState } from "../lib/rules-api.mjs";

const env = loadEnv();
const ACCOUNT = env.RESOLVER_ACCOUNT_ID || "712020:937bc860-eec2-4294-a65d-8e0fe7c45086";
const BASE = env.JIRA_BASE_URL.replace(/\/$/, "");
const AUTH = "Basic " + Buffer.from(`${env.JIRA_ADMIN_EMAIL}:${env.JIRA_API_TOKEN}`).toString("base64");
const RUN = Date.now().toString(36).slice(-5); const TAG = `crres${RUN}`;
let pass = 0; let fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log("  ✓ " + msg); } else { fail++; console.log("  ✗ " + msg); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = async (name, payload = {}, accountId = ACCOUNT) => {
  const r = await testState.post({ action: "invokeResolver", name, payload, accountId });
  if (!r.ok) throw new Error(`${name} → HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
  return r.body;
};
const jira = async (method, path, body) => {
  const res = await fetch(`${BASE}${path}`, { method, headers: { Authorization: AUTH, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text(); let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 300) }; }
  return { status: res.status, ok: res.ok, body: json };
};
const created = { listeners: [], jobs: [], issues: [], tokens: [] };
try {
  const who = await call("checkIsAdmin");
  ok(who && (who.isAdmin === true || who.role === "admin" || who.success), `principal resolves (${JSON.stringify(who).slice(0, 120)})`);
  // fixture issue
  const projects = (await jira("GET", "/rest/api/3/project/search?maxResults=100")).body.values || [];
  const proj = projects.find((p) => p.key === (env.COGTEST_PROJECT_KEY || "COGTEST")) || projects[0];
  const types = (await jira("GET", `/rest/api/3/project/${proj.id}`)).body.issueTypes || [];
  const stdType = types.find((t) => !t.subtask && /task/i.test(t.name)) || types.find((t) => !t.subtask);
  const issue = (await jira("POST", "/rest/api/3/issue", { fields: { project: { id: proj.id }, issuetype: { id: stdType.id }, summary: `${TAG} resolver bed` } })).body;
  created.issues.push(issue.key);

  // ── listeners via resolvers ──
  const l0 = await call("getListeners");
  ok(l0.success && Array.isArray(l0.listeners), `getListeners → ${l0.listeners && l0.listeners.length} row(s)`);
  const bad = await call("saveListener", { listener: { name: "x", events: ["nope"] } });
  ok(bad.success === false && /events must contain/.test(bad.error), `saveListener validation surfaces: ${bad.error}`);
  const draft = { name: `Resolver listener ${RUN}`, events: ["avi:jira:commented:issue"], filters: { projectKeys: [proj.key] }, functions: [{ id: "fn-1", name: "label", operationType: "work_item_query", operationPrompt: "add a label", variableName: "r1", code: `await api.addLabels("${TAG}-lst");\nreturn true;` }] };
  const t0 = await call("testListener", { listener: draft, issueKey: issue.key, eventType: "avi:jira:commented:issue" });
  ok(t0.success && t0.result && t0.result.isValid && (t0.result.changes || []).some((c) => c.simulated), `testListener on an UNSAVED draft runs in simulation: ${t0.result && t0.result.reason} (event: ${t0.result && t0.result.eventUsed})`);
  ok(typeof t0.result.ruleId === "string" && t0.result.ruleId.startsWith("lst_"), "test run mints the draft's id (the UI adopts it before Save)");
  const s1 = await call("saveListener", { listener: { ...draft, id: t0.result.ruleId } });
  ok(s1.success && s1.listener.id === t0.result.ruleId && s1.listener.createdBy === ACCOUNT, `saveListener keeps the minted id → ${s1.listener && s1.listener.id} (createdBy = principal)`);
  created.listeners.push(s1.listener.id);
  const g1 = await call("getListener", { id: s1.listener.id });
  ok(g1.success && g1.listener.functions[0].code.includes(TAG), "getListener returns the full record with code");
  const e1 = await call("setListenerEnabled", { id: s1.listener.id, enabled: false });
  ok(e1.success && e1.listener.enabled === false, "setListenerEnabled(false)");
  const viewer = await call("saveListener", { listener: { ...g1.listener, name: "hijack" } }, "557058:00000000-0000-0000-0000-000000000000");
  ok(viewer.success === false && /permission/i.test(viewer.error || ""), `unknown principal cannot edit: ${viewer.error}`);
  const smp = await call("getEventSample", { eventType: "avi:jira:commented:issue" });
  ok(smp.success && smp.sample && smp.sample.payload, "getEventSample returns the captured comment payload");
  const lg = await call("getLogs", { ruleId: s1.listener.id });
  ok(lg.success && lg.logs.some((x) => x.testRun === true && x.source === "test"), "test run logged with source=test");
  const d1 = await call("deleteListener", { id: s1.listener.id });
  ok(d1.success && d1.removed, "deleteListener");
  created.listeners = [];

  // ── jobs via resolvers ──
  const pv = await call("previewSchedule", { cron: "0 9 * * 1-5", timeZone: "Europe/Zurich", count: 3 });
  ok(pv.success && pv.ok && pv.runs.length === 3, `previewSchedule: ${pv.description}`);
  const j1 = await call("saveScheduledJob", { job: { name: `Resolver job ${RUN}`, schedule: { cron: "0 4 * * *", timeZone: "UTC" }, scope: { jql: `key = ${issue.key}`, maxIssues: 5 }, functions: [{ id: "fn-1", name: "label", operationType: "work_item_query", operationPrompt: "label", variableName: "r1", code: `await api.addLabels("${TAG}-job");\nreturn api.context.scopeIssue;` }] } });
  ok(j1.success && j1.job.id && j1.job.stats.nextRunAt, `saveScheduledJob → ${j1.job && j1.job.id}`);
  created.jobs.push(j1.job.id);
  const r1 = await call("runScheduledJobNow", { id: j1.job.id });
  ok(r1.success && r1.async && r1.taskId, `runScheduledJobNow queued task ${r1.taskId}`);
  let done = null;
  for (let i = 0; i < 40 && !done; i++) { await sleep(3000); const p = await call("getAsyncTaskResult", { taskId: r1.taskId }); if (p.status === "done" || p.status === "error") done = p; }
  ok(done && done.status === "done" && done.result && done.result.success, `getAsyncTaskResult → ${done && done.status}: ${done && done.result && done.result.reason}`);
  const after = (await jira("GET", `/rest/api/3/issue/${issue.key}?fields=labels`)).body;
  ok((after.fields.labels || []).includes(`${TAG}-job`), "scoped job wrote the label on the fixture issue");
  const jl = await call("getScheduledJobs");
  ok(jl.success && jl.jobs.some((j) => j.id === j1.job.id && j.stats.runCount >= 1), "getScheduledJobs shows the run in stats");
  const dj = await call("deleteScheduledJob", { id: j1.job.id });
  ok(dj.success && dj.removed, "deleteScheduledJob");
  created.jobs = [];

  // ── API tokens via resolvers (admin) ──
  const tk = await call("createApiToken", { name: `resolver ${RUN}` });
  ok(tk.success && /^cgr_[0-9a-f]{48}$/.test(tk.token) && tk.row.prefix === tk.token.slice(0, 10), "createApiToken returns a well-formed token once");
  created.tokens.push(tk.row.id);
  const tl = await call("getApiTokens");
  ok(tl.success && tl.tokens.some((t) => t.id === tk.row.id && !t.hash) && typeof tl.url === "string", "getApiTokens lists it without the hash + returns the endpoint URL");
  const tv = await call("revokeApiToken", { id: tk.row.id });
  ok(tv.success && tv.revoked, "revokeApiToken");
  const nonAdmin = await call("getApiTokens", {}, "557058:00000000-0000-0000-0000-000000000000");
  ok(nonAdmin.success === false, "token management denied to a non-admin principal");
} catch (e) { fail++; console.log("  ✗ threw: " + (e && e.stack || e)); }
for (const id of created.listeners) await call("deleteListener", { id }).catch(() => {});
for (const id of created.jobs) await call("deleteScheduledJob", { id }).catch(() => {});
for (const k of created.issues) await jira("DELETE", `/rest/api/3/issue/${k}`).catch(() => {});
console.log(`\nRESOLVERS LIVE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
