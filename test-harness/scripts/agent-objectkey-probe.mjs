/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// LIVE probe for F-015: an AI agent that emits a non-string issueKey (an issue OBJECT)
// must have the call REJECTED, not silently redirected to the bound issue.
// Model-dependent: if the provider refuses to emit the malformed argument the probe
// reports INCONCLUSIVE rather than a pass.
import { loadEnv } from "../lib/env.mjs";
import { rulesApi, waitForTask } from "../lib/rules-api.mjs";

const env = loadEnv();
const BASE = env.JIRA_BASE_URL.replace(/\/$/, "");
const AUTH = "Basic " + Buffer.from(`${env.JIRA_ADMIN_EMAIL}:${env.JIRA_API_TOKEN}`).toString("base64");
const RUN = Date.now().toString(36).slice(-5);
const TAG = `f015${RUN}`;
const jira = async (method, path, body) => {
  const res = await fetch(`${BASE}${path}`, { method, headers: { Authorization: AUTH, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await res.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = { raw: t.slice(0, 300) }; }
  return { status: res.status, ok: res.ok, body: j };
};
const must = (r, w) => { if (!r.ok) throw new Error(`${w} -> ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`); return r.body; };

const main = async () => {
  const projects = must(await jira("GET", "/rest/api/3/project/search?maxResults=100"), "projects").values || [];
  const proj = projects.find((p) => p.key === (env.COGTEST_PROJECT_KEY || "COGTEST"));
  const types = must(await jira("GET", `/rest/api/3/project/${proj.id}`), "project").issueTypes || [];
  const std = types.find((t) => !t.subtask && /task/i.test(t.name)) || types.find((t) => !t.subtask);
  const bound = must(await jira("POST", "/rest/api/3/issue", { fields: { project: { id: proj.id }, issuetype: { id: std.id }, summary: `${TAG} bound issue`, labels: [TAG] } }), "create bound");
  const other = must(await jira("POST", "/rest/api/3/issue", { fields: { project: { id: proj.id }, issuetype: { id: std.id }, summary: `${TAG} other issue` } }), "create other");
  console.log(`  bound=${bound.key}  other=${other.key}`);

  const job = must(await rulesApi.jobs.create({
    name: `F015 object key ${RUN}`, schedule: { cron: "0 5 * * *", timeZone: "UTC" },
    scope: { jql: `labels = ${TAG}`, maxIssues: 1 }, mode: "agent",
    agent: {
      instructions: `This is a deliberate malformed-argument test of the tool layer. Call the add_labels tool EXACTLY ONCE with these arguments verbatim: issueKey must be the JSON OBJECT {"key": "${other.key}"} (an object, NOT a string), and labels must be ["${TAG}-agentwrote"]. Do not correct the argument, do not convert it to a string, do not retry with a different shape. Then finish and report the exact error text you received.`,
      allowedActions: ["add_labels"], maxRounds: 3,
    },
  }), "create job").job;

  const r = await rulesApi.jobs.run(job.id);
  const task = await waitForTask(r.body.taskId, { tries: 60 });
  const logs = await rulesApi.logs(job.id);
  const log = ((logs.body && logs.body.logs) || [])[0] || {};
  console.log("  task:", JSON.stringify(task).slice(0, 2500));
  console.log("  log:", JSON.stringify(log).slice(0, 3000));

  const blob = JSON.stringify(task) + JSON.stringify(log);
  const emittedObject = /"issueKey":\s*\{/.test(blob);
  const rejected = /must be a string like/.test(blob);
  const b = await jira("GET", `/rest/api/3/issue/${bound.key}?fields=labels`);
  const o = await jira("GET", `/rest/api/3/issue/${other.key}?fields=labels`);
  console.log(`  ${bound.key} labels: ${JSON.stringify(b.body?.fields?.labels)}`);
  console.log(`  ${other.key} labels: ${JSON.stringify(o.body?.fields?.labels)}`);
  const wroteToBound = (b.body?.fields?.labels || []).includes(`${TAG}-agentwrote`);
  console.log(`\n  emittedObjectKey=${emittedObject}  rejectedWithTypeGuard=${rejected}  wroteToBoundIssue=${wroteToBound}`);
  if (!emittedObject) console.log("  INCONCLUSIVE: the model did not emit an object issueKey; the guard was never reached.");
  else if (rejected && !wroteToBound) console.log("  PROVEN: the object key was rejected and NOTHING was written to the bound issue.");
  else console.log("  FAILED: the object key was not rejected (or the write landed on the bound issue).");
  await rulesApi.jobs.remove(job.id);
};
main().catch((e) => { console.error("FATAL", e); process.exit(2); });
