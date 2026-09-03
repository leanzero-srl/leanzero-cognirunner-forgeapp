/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// LIVE proof for F-004 / F-015: "which issue does a key-optional sandbox call act on?"
//
// Drives the deployed app through the Rules REST API and proves each outcome with a
// SECOND REST read (issue property, label list, changelog, JQL) — never the step's
// own return value.
//
//   a  api.getIssue()                      key omitted -> the event's issue (was /issue/undefined -> 404)
//   b  api.updateIssue({...}) / editIssue  key omitted -> writes land on the event's issue
//   c  api.transitionByName(name)          key omitted -> the event's issue transitions
//   c2 api.transitionIssue(id)             key omitted -> the event's issue transitions
//   d  the same shapes in an UNSCOPED job  -> throw the api.forIssue("KEY") message, not a 404, and write NOTHING
//   e  api.forIssue("KEY").transitionByName("Done") -> targets KEY (the doc example)
//   f  api.updateIssue("", {...})          -> throws the empty-key error and writes NOTHING
//   g  the dry-run (testListener) agrees with production, and fails on a null-issue context
//
// Run: node scripts/issue-key-live.mjs        (KEEP=1 keeps the listeners/jobs/issues)
import { loadEnv } from "../lib/env.mjs";
import { rulesApi, waitForLogs, waitForTask } from "../lib/rules-api.mjs";

const env = loadEnv();
const BASE = env.JIRA_BASE_URL.replace(/\/$/, "");
const AUTH = "Basic " + Buffer.from(`${env.JIRA_ADMIN_EMAIL}:${env.JIRA_API_TOKEN}`).toString("base64");
const KEEP = process.env.KEEP === "1";
const RUN = Date.now().toString(36).slice(-5);
const TAG = `f004${RUN}`;

let pass = 0; let fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log("  ✓ " + msg); } else { fail++; console.log("  ✗ " + msg); } };
const note = (m) => console.log("  · " + m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jira = async (method, path, body) => {
  const res = await fetch(`${BASE}${path}`, { method, headers: { Authorization: AUTH, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 400) }; }
  return { status: res.status, ok: res.ok, body: json };
};
const must = (r, what) => { if (!r.ok) throw new Error(`${what} -> ${r.status} ${JSON.stringify(r.body).slice(0, 400)}`); return r.body; };

const created = { listeners: [], jobs: [], issues: [] };

// labels used as write-witnesses
const L_UPD = `${TAG}-upd`;
const L_EDIT = `${TAG}-edit`;
const L_NEVER = `${TAG}-emptykey-never`;
const L_JOBNEVER = `${TAG}-job-never`;
const L_DRY = `${TAG}-dryrun-never`;

async function main() {
  console.log(`ISSUE-KEY LIVE PROOF on ${BASE} (run ${RUN})`);
  const who = await rulesApi.whoami();
  ok(who.ok, `Rules REST API reachable (token ${who.body?.token?.prefix})`);

  const projects = must(await jira("GET", "/rest/api/3/project/search?maxResults=100"), "projects").values || [];
  const proj = projects.find((p) => p.key === (env.COGTEST_PROJECT_KEY || "COGTEST")) || projects.find((p) => p.projectTypeKey === "software");
  if (!proj) throw new Error("no project");
  const types = must(await jira("GET", `/rest/api/3/project/${proj.id}`), "project").issueTypes || [];
  const stdType = types.find((t) => !t.subtask && /task/i.test(t.name)) || types.find((t) => !t.subtask);
  console.log(`  project ${proj.key}, issue type ${stdType.name}`);

  const mk = async (label) => {
    const r = must(await jira("POST", "/rest/api/3/issue", { fields: { project: { id: proj.id }, issuetype: { id: stdType.id }, summary: `${TAG} ${label}` } }), `create ${label}`);
    created.issues.push(r.key); return r;
  };
  const A = await mk("A event issue");
  const B = await mk("B forIssue target");
  console.log(`  A=${A.key} (event issue)  B=${B.key} (forIssue target)`);

  // transitions available from the starting status (same workflow for A/B/C)
  const trA = must(await jira("GET", `/rest/api/3/issue/${A.key}/transitions`), "transitions A").transitions || [];
  const startStatus = must(await jira("GET", `/rest/api/3/issue/${A.key}?fields=status`), "A status").fields.status.name;
  const tA = trA.find((t) => t.to && t.to.name !== startStatus) || trA[0];
  if (!tA) throw new Error("no transition available");
  const trB = must(await jira("GET", `/rest/api/3/issue/${B.key}/transitions`), "transitions B").transitions || [];
  const tB = trB.find((t) => t.to && t.to.name !== startStatus) || trB[0];
  note(`start status "${startStatus}"; A will transitionByName("${tA.name}") -> ${tA.to.name}; B via forIssue("${B.key}").transitionByName("${tB.name}") -> ${tB.to.name}`);
  // a second, still-available transition id for the key-omitted transitionIssue(id) leg on issue C
  const tC = trA.find((t) => t.to && t.to.name !== startStatus && t.id !== tA.id) || tA;

  // ── listeners ───────────────────────────────────────────────────────────────
  const L1 = must(await rulesApi.listeners.create({
    name: `F004 positives ${RUN}`, events: ["avi:jira:updated:issue"], ignoreSelf: true,
    filters: { projectKeys: [proj.key], jql: `key = ${A.key}` },
    functions: [
      { name: "a-getIssue", code: `const iss = await api.getIssue();\nawait api.setProperty("f004a", { key: iss.key, summary: (iss.fields && iss.fields.summary) || null, status: iss.fields && iss.fields.status && iss.fields.status.name, ctx: api.context.issueKey });\nreturn iss.key;` },
      { name: "b-updateIssue", code: `await api.updateIssue({ labels: ["${L_UPD}"] });\nreturn "updated";` },
      { name: "b2-editIssue", code: `await api.editIssue({ labels: [{ add: "${L_EDIT}" }] });\nreturn "edited";` },
      { name: "e-forIssue", code: `await api.forIssue("${B.key}").transitionByName("${tB.name}");\nreturn "${B.key}";` },
      { name: "c-transitionByName", code: `await api.transitionByName("${tA.name}");\nreturn api.context.issueKey;` },
    ],
  }), "create L1").listener;
  created.listeners.push(L1.id);

  const L2 = must(await rulesApi.listeners.create({
    name: `F004 empty key ${RUN}`, events: ["avi:jira:commented:issue"], ignoreSelf: true,
    filters: { projectKeys: [proj.key], jql: `key = ${A.key}` },
    functions: [{ name: "f-emptyKey", code: `await api.updateIssue("", { labels: ["${L_NEVER}"] });\nreturn "WROTE";` }],
  }), "create L2").listener;
  created.listeners.push(L2.id);

  const L3 = must(await rulesApi.listeners.create({
    name: `F004 created ${RUN}`, events: ["avi:jira:created:issue"], ignoreSelf: true,
    filters: { projectKeys: [proj.key] },
    functions: [
      { name: "c2-transitionIssue", code: `await api.transitionIssue("${tC.id}");\nreturn api.context.issueKey;` },
      { name: "a2-getIssue", code: `const iss = await api.getIssue();\nawait api.setProperty("f004c2", { key: iss.key, status: iss.fields.status.name });\nreturn iss.key;` },
    ],
  }), "create L3").listener;
  created.listeners.push(L3.id);

  // dry-run subject (disabled so it can never fire on a real event)
  const L4 = must(await rulesApi.listeners.create({
    name: `F004 dryrun ${RUN}`, enabled: false, events: ["avi:jira:updated:issue", "avi:jira:created:project"],
    functions: [{ name: "g-dry", code: `const iss = await api.getIssue();\nawait api.updateIssue({ labels: ["${L_DRY}"] });\nawait api.setProperty("f004g", { k: iss.key });\nreturn iss.key;` }],
  }), "create L4").listener;
  created.listeners.push(L4.id);

  // unscoped job (no scope -> api.context.issueKey is null)
  const JOB = must(await rulesApi.jobs.create({
    name: `F004 unscoped ${RUN}`, schedule: { cron: "0 4 * * *", timeZone: "UTC" },
    functions: [{ name: "d-noissue", code:
`const out = [];
const probes = [
  ["getIssue", () => api.getIssue()],
  ["updateIssue", () => api.updateIssue({ labels: ["${L_JOBNEVER}"] })],
  ["transitionByName", () => api.transitionByName("${tA.name}")],
  ["editIssue", () => api.editIssue({ labels: [{ add: "${L_JOBNEVER}" }] })],
  ["transitionIssue", () => api.transitionIssue("${tA.id}")],
];
for (const [name, fn] of probes) {
  try { await fn(); api.log("PROBE " + name + " :: NO THROW"); out.push(name); }
  catch (e) { api.log("PROBE " + name + " :: " + String(e.message).slice(0, 170)); out.push(name); }
}
return out.length;` }],
  }), "create job").job;
  created.jobs.push(JOB.id);

  // the same call with the throw UNCAUGHT: the step itself must fail with the forIssue message
  const JOB2 = must(await rulesApi.jobs.create({
    name: `F004 unscoped bare ${RUN}`, schedule: { cron: "0 4 * * *", timeZone: "UTC" },
    functions: [{ name: "d-bare-getIssue", code: `return await api.getIssue();` }],
  }), "create job2").job;
  created.jobs.push(JOB2.id);

  console.log("  rules in place; waiting 35s for the 30s listener index cache…");
  await sleep(35000);

  // ── fire ────────────────────────────────────────────────────────────────────
  must(await jira("PUT", `/rest/api/3/issue/${A.key}`, { fields: { summary: `${TAG} A event issue (touched)` } }), "touch A");
  note("fired avi:jira:updated:issue on A");
  must(await jira("POST", `/rest/api/3/issue/${A.key}/comment`, { body: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: `${TAG} empty-key probe` }] }] } }), "comment A");
  note("fired avi:jira:commented:issue on A");
  const C = await mk("C created-event issue");
  console.log(`  C=${C.key} (created-event issue)`);

  // ── d: unscoped job, run now ────────────────────────────────────────────────
  const runRes = await rulesApi.jobs.run(JOB.id);
  ok(runRes.status === 202 && runRes.body.taskId, `unscoped job run-now queued (${runRes.body && runRes.body.taskId})`);
  const task = await waitForTask(runRes.body.taskId, { tries: 40 });
  const runRes2 = await rulesApi.jobs.run(JOB2.id);
  const task2 = await waitForTask(runRes2.body.taskId, { tries: 40 });

  // ── g: dry-run ──────────────────────────────────────────────────────────────
  const g1 = await rulesApi.listeners.test(L4.id, { issueKey: A.key, eventType: "avi:jira:updated:issue" });
  console.log("  [g1] dry-run with an issue:", JSON.stringify(g1.body).slice(0, 1200));
  const g2 = await rulesApi.listeners.test(L4.id, { eventType: "avi:jira:created:project", event: {} });
  console.log("  [g2] dry-run with NO issue:", JSON.stringify(g2.body).slice(0, 1200));

  // ── wait for the event-driven runs ──────────────────────────────────────────
  console.log("  waiting for the listener runs (Forge product events can lag ~3 min)…");
  const w1 = await waitForLogs(L1.id, (logs) => logs.some((l) => !l.testRun), { intervalMs: 5000, tries: 48 });
  const w2 = await waitForLogs(L2.id, (logs) => logs.some((l) => !l.testRun), { intervalMs: 5000, tries: 24 });
  const w3 = await waitForLogs(L3.id, (logs) => logs.some((l) => !l.testRun && l.issueKey === C.key), { intervalMs: 5000, tries: 24 });
  ok(w1.ok, "L1 (positives) ran");
  ok(w2.ok, "L2 (empty key) ran");
  ok(w3.ok, "L3 (created -> transitionIssue) ran");
  const l1log = (w1.logs || []).find((l) => !l.testRun) || {};
  const l2log = (w2.logs || []).find((l) => !l.testRun) || {};
  const l3log = (w3.logs || []).find((l) => !l.testRun && l.issueKey === C.key) || {};
  console.log("  [L1 log]", JSON.stringify({ isValid: l1log.isValid, reason: l1log.reason, steps: (l1log.stepResults || []).map((s) => ({ n: s.name, st: s.status, e: s.error })) }).slice(0, 1500));
  console.log("  [L2 log]", JSON.stringify({ isValid: l2log.isValid, reason: l2log.reason, steps: (l2log.stepResults || []).map((s) => ({ n: s.name, st: s.status, e: s.error })) }).slice(0, 1200));
  console.log("  [L3 log]", JSON.stringify({ isValid: l3log.isValid, reason: l3log.reason, steps: (l3log.stepResults || []).map((s) => ({ n: s.name, st: s.status, e: s.error })) }).slice(0, 1200));

  // ═══ SECOND READS ═══════════════════════════════════════════════════════════
  console.log("\n  === second REST reads ===");
  // a
  const propA = await jira("GET", `/rest/api/3/issue/${A.key}/properties/f004a`);
  ok(propA.ok && propA.body.value && propA.body.value.key === A.key,
    `[a] issue property f004a on ${A.key} says getIssue() returned ${propA.body?.value?.key} (summary "${propA.body?.value?.summary}", ctx ${propA.body?.value?.ctx})`);
  ok(propA.ok && typeof propA.body.value?.summary === "string" && propA.body.value.summary.includes(TAG),
    "[a] the returned issue carried real fields (summary matches the live issue), not a 404 stub");
  // b
  const afterA = await jira("GET", `/rest/api/3/issue/${A.key}?fields=labels,status,summary`);
  const labelsA = afterA.body?.fields?.labels || [];
  ok(labelsA.includes(L_UPD), `[b] updateIssue({labels}) with the key OMITTED landed on ${A.key}: labels=${JSON.stringify(labelsA)}`);
  ok(labelsA.includes(L_EDIT), `[b] editIssue({labels:[{add}]}) with the key OMITTED landed on ${A.key}`);
  // c
  const clA = await jira("GET", `/rest/api/3/issue/${A.key}?expand=changelog&fields=status`);
  const stChangesA = (clA.body?.changelog?.histories || []).flatMap((h) => (h.items || []).filter((i) => i.field === "status").map((i) => `${i.fromString}->${i.toString}`));
  ok(afterA.body?.fields?.status?.name === tA.to.name && stChangesA.length > 0,
    `[c] transitionByName("${tA.name}") with the key OMITTED moved ${A.key}: status now "${afterA.body?.fields?.status?.name}", changelog ${JSON.stringify(stChangesA)}`);
  // c2
  const afterC = await jira("GET", `/rest/api/3/issue/${C.key}?expand=changelog&fields=status`);
  const stChangesC = (afterC.body?.changelog?.histories || []).flatMap((h) => (h.items || []).filter((i) => i.field === "status").map((i) => `${i.fromString}->${i.toString}`));
  ok(afterC.body?.fields?.status?.name === tC.to.name && stChangesC.length > 0,
    `[c2] transitionIssue("${tC.id}") with the key OMITTED moved ${C.key}: status "${afterC.body?.fields?.status?.name}", changelog ${JSON.stringify(stChangesC)}`);
  const propC = await jira("GET", `/rest/api/3/issue/${C.key}/properties/f004c2`);
  ok(propC.ok && propC.body.value?.key === C.key, `[c2] getIssue() on the created-event run returned ${propC.body?.value?.key} (status ${propC.body?.value?.status})`);
  // e
  const afterB = await jira("GET", `/rest/api/3/issue/${B.key}?expand=changelog&fields=status,labels`);
  const stChangesB = (afterB.body?.changelog?.histories || []).flatMap((h) => (h.items || []).filter((i) => i.field === "status").map((i) => `${i.fromString}->${i.toString}`));
  ok(afterB.body?.fields?.status?.name === tB.to.name && stChangesB.length > 0,
    `[e] api.forIssue("${B.key}").transitionByName("${tB.name}") moved B: status "${afterB.body?.fields?.status?.name}", changelog ${JSON.stringify(stChangesB)}`);
  ok(!(afterB.body?.fields?.labels || []).includes(L_UPD), "[e] B did NOT receive A's label (forIssue re-bound only the transition)");
  // f
  const fStep = (l2log.stepResults || [])[0] || {};
  ok(fStep.status === "error" && /empty string/i.test(String(fStep.error || "")),
    `[f] empty explicit key threw: "${String(fStep.error || "").slice(0, 200)}"`);
  ok(!labelsA.includes(L_NEVER), `[f] ${A.key} was NOT written by the empty-key call (label ${L_NEVER} absent)`);
  // f negative control: the SAME JQL shape can see a label that IS there
  const jqlNever = await jira("POST", "/rest/api/3/search/jql", { jql: `labels = "${L_NEVER}"`, maxResults: 5, fields: ["key"] });
  const jqlUpd = await jira("POST", "/rest/api/3/search/jql", { jql: `labels = "${L_UPD}"`, maxResults: 5, fields: ["key"] });
  ok((jqlUpd.body?.issues || []).length > 0, `[f/control] the label query CAN see a label that was written (${L_UPD} -> ${(jqlUpd.body?.issues || []).map((i) => i.key).join(",")})`);
  ok((jqlNever.body?.issues || []).length === 0, `[f] site-wide: NO issue anywhere carries ${L_NEVER}`);
  // d
  const jobLogs = await rulesApi.logs(JOB.id);
  const jobLog = ((jobLogs.body && jobLogs.body.logs) || []).find((l) => l.type === "scheduledjob") || {};
  const dLines = (jobLog.logs || []).filter((l) => String(l).startsWith("PROBE "));
  console.log("  [d] persisted job-log lines:\n   " + dLines.join("\n   "));
  for (const w of ["getIssue", "updateIssue", "transitionByName", "editIssue", "transitionIssue"]) {
    const line = dLines.find((l) => String(l).startsWith("PROBE " + w + " ::")) || "";
    ok(/needs a current issue/.test(line) && /api\.forIssue\(/.test(line) && !/404/.test(line),
      `[d] unscoped job: api.${w}() threw the forIssue message, not a 404 — "${String(line).slice(0, 175)}"`);
  }
  ok(dLines.length === 5 && !/NO THROW/.test(dLines.join("|")), "[d] none of the five silently succeeded on a null-issue context");
  const job2Logs = await rulesApi.logs(JOB2.id);
  const job2Log = ((job2Logs.body && job2Logs.body.logs) || []).find((l) => l.type === "scheduledjob") || {};
  const d2 = (job2Log.stepResults || [])[0] || {};
  ok(job2Log.isValid === false && d2.status === "error" && /needs a current issue/.test(String(d2.error || "")) && /api\.forIssue\(/.test(String(d2.error || "")) && !/404/.test(String(d2.error || "")),
    `[d] bare "return await api.getIssue();" in an unscoped job FAILED the step: "${String(d2.error || "").slice(0, 190)}"`);
  const jqlJobNever = await jira("POST", "/rest/api/3/search/jql", { jql: `labels = "${L_JOBNEVER}"`, maxResults: 5, fields: ["key"] });
  ok((jqlJobNever.body?.issues || []).length === 0, `[d] site-wide: NO issue carries ${L_JOBNEVER} (the unscoped job wrote nothing)`);
  const dText = JSON.stringify(task) + JSON.stringify(task2) + JSON.stringify(jobLog) + JSON.stringify(job2Log);
  ok(!/\b404\b/.test(dText) && !/issue\/undefined/.test(dText), "[d] neither task result nor persisted job log mentions a 404 / issue/undefined");
  // g
  const g1r = g1.body?.result || {};
  const g1step = (g1r.stepResults || [])[0] || {};
  const g1keys = (g1r.changes || []).map((c) => c.key);
  const g1simline = (g1r.logs || []).find((l) => /\[SIMULATION\] updateIssue/.test(String(l))) || "";
  ok(g1.ok && g1step.status === "success" && g1keys.length > 0 && g1keys.every((k) => k === A.key),
    `[g1] dry-run (testListener) resolved every key-omitted call to ${JSON.stringify([...new Set(g1keys)])} — the same issue production wrote to (${A.key})`);
  ok(String(g1simline).includes(`"${A.key}"`), `[g1] simulation log names the resolved issue: ${String(g1simline).slice(0, 150)}`);
  const afterDry = await jira("GET", `/rest/api/3/issue/${A.key}?fields=labels`);
  ok(!(afterDry.body?.fields?.labels || []).includes(L_DRY), `[g1] the dry-run wrote nothing: ${L_DRY} absent from ${A.key}`);
  const propDry = await jira("GET", `/rest/api/3/issue/${A.key}/properties/f004g`);
  ok(propDry.status === 404, `[g1] the dry-run's setProperty was simulated (property f004g -> ${propDry.status})`);
  const g2r = g2.body?.result || {};
  const g2step = (g2r.stepResults || [])[0] || {};
  const g2err = String(g2step.error || g2r.reason || g2.body?.error || "");
  ok(/needs a current issue/.test(g2err) && /api\.forIssue\(/.test(g2err),
    `[g2] dry-run with a NULL-issue context FAILED with the forIssue message (no MOCK fallback): "${g2err.slice(0, 200)}"`);

  console.log(`\n  A=${A.key} B=${B.key} C=${C.key}  listeners=${created.listeners.join(",")} job=${JOB.id}`);
}

main().then(async () => {
  if (!KEEP) {
    for (const id of created.listeners) await rulesApi.listeners.remove(id);
    for (const id of created.jobs) await rulesApi.jobs.remove(id);
    for (const k of created.issues) await jira("DELETE", `/rest/api/3/issue/${k}?deleteSubtasks=true`);
    console.log("  cleaned up (KEEP=1 to keep)");
  }
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch(async (e) => {
  console.error("FATAL", e);
  if (!KEEP) { for (const id of created.listeners) await rulesApi.listeners.remove(id).catch(() => {}); for (const id of created.jobs) await rulesApi.jobs.remove(id).catch(() => {}); }
  process.exit(2);
});
