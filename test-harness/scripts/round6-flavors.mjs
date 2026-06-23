/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// ROUND 6 — SEMANTIC PF FLAVORS. The flavors only lightly touched by the stress run,
// now graded for CORRECTNESS by the ARTIFACT each is supposed to produce:
//   • comment       → a triage comment is posted
//   • subtask       → a sub-task is created (on a parent type that allows sub-tasks)
//   • link          → an issue link to a related issue is created
//   • generate-doc  → a document is attached (+ optional comment)
//   • research      → a research doc/comment (needs the web-search MCP; SKIP is OK if absent)
// All are heavy → queued async, so we POLL the artifact count for up to 120s.
// Transitions R6-*; issues labelled cogtest-r6.

import { post, get, getIssue, doTransition, sleep, BASE } from "../lib/jira.mjs";
import { readWorkflow, updateWorkflow, makeSelfLoop, buildRule, attachRuleToTransition } from "../lib/workflow.mjs";
import { loadState, writeResult } from "../lib/state.mjs";
import { adfDoc } from "../lib/synthesize.mjs";

const R6_LABEL = "cogtest-r6";
const INCIDENT = "Saved-card checkout returns HTTP 500 after release v2.3 when a payment is submitted twice within 5 seconds; ~3% of checkouts fail. Needs an idempotency key, a regression test, and a dashboard alert on the 500 rate.";

async function seedIssue(projectKey, typeId, summary, descText) {
  const body = { fields: { project: { key: projectKey }, issuetype: { id: String(typeId) }, summary, labels: [R6_LABEL], description: adfDoc(descText) } };
  return (await post("/rest/api/3/issue", body)).key;
}
async function defaultIssueTypeId(projectKey) {
  const meta = await get(`/rest/api/3/issue/createmeta?projectKeys=${projectKey}&expand=projects.issuetypes`);
  const proj = meta?.projects?.[0];
  const it = (proj?.issuetypes || []).find((t) => !t.subtask) || proj?.issuetypes?.[0];
  return it?.id;
}
async function readTrace(key) { try { const r = await get(`/rest/api/3/issue/${key}/properties/cogni-debug`, { raw: true }); if (r.status >= 400) return null; return JSON.parse(r.text).value; } catch { return null; } }

const counts = (i) => ({
  comments: i?.fields?.comment?.total ?? i?.fields?.comment?.comments?.length ?? 0,
  subtasks: (i?.fields?.subtasks || []).length,
  links: (i?.fields?.issuelinks || []).length,
  attach: (i?.fields?.attachment || []).length,
});
const EXPAND = "comment,subtasks,issuelinks,attachment,updated";

async function main() {
  console.log(`ROUND 6 — semantic PF flavors on ${BASE}\n`);
  const s = loadState();
  const wfName = s.workflowName, hubRef = s.hubStatusRef, projectKey = s.projectKey || "COGTEST";
  const lead = s.leadAccountId || null;
  if (!wfName || !hubRef) throw new Error("Run `npm run setup` first.");

  const rules = [
    { key: "R6-comment", type: "comment", metric: "comments",
      config: { type: "postfunction-comment", fieldId: "description", commentPrompt: "Post a concise triage comment: one-line summary, the single most likely root cause, and the next action." } },
    { key: "R6-subtask", type: "subtask", metric: "subtasks",
      config: { type: "postfunction-subtask", fieldId: "description", subtaskPrompt: "Create one concrete implementation sub-task as a short imperative title." } },
    { key: "R6-link", type: "link", metric: "links",
      config: { type: "postfunction-link", fieldId: "description", linkPrompt: "Find existing issues describing the same saved-card checkout 500 / payment bug and link them as related.", linkTypeName: "Relates", maxLinks: 3 } },
    { key: "R6-gendoc", type: "generate-doc", metric: "attach",
      config: { type: "postfunction-generate-doc", fieldId: "description", contentPrompt: "Draft a short root-cause analysis: summary, timeline, root cause, remediation.", docTitlePrompt: "RCA", docFormat: "markdown", attachComment: true, actorAccountId: lead } },
    { key: "R6-research", type: "research", metric: "attach",
      config: { type: "postfunction-research", fieldId: "description", researchQuery: "Mitigations for idempotency failures in payment retries.", researchTitle: "Idempotency research", actorAccountId: lead } },
  ].map((r) => { r.config.debugTrace = true; return r; });

  console.log("Attaching R6- self-loops…");
  const attached = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const { top, wf } = await readWorkflow(wfName);
    const existing = new Set((wf.transitions || []).map((t) => String(t.id)));
    wf.transitions = (wf.transitions || []).filter((t) => !String(t.name || "").startsWith("R6-"));
    let idNum = 9850; attached.length = 0;
    for (const r of rules) {
      while (existing.has(String(idNum))) idNum++; existing.add(String(idNum));
      try { const built = buildRule(r.type, r.config); const t = makeSelfLoop(hubRef, r.key, idNum); attachRuleToTransition(t, r.type, built); wf.transitions.push(t); attached.push({ r, tid: String(idNum) }); }
      catch (e) { attached.push({ r, error: e.message.slice(0, 100) }); }
      idNum++;
    }
    try { await updateWorkflow(top, wf); break; } catch (e) { if (attempt === 0 && /409|version/i.test(e.message)) continue; throw e; }
  }
  console.log(`Attached ${attached.filter((a) => a.tid).length}/${rules.length}.`);

  const typeId = await defaultIssueTypeId(projectKey);
  // Link targets: a couple of related issues the link PF can discover + link.
  console.log("Seeding link-target issues…");
  await seedIssue(projectKey, typeId, "Checkout 500 on duplicate saved-card payment submit", INCIDENT);
  await seedIssue(projectKey, typeId, "Payment retry causes intermittent HTTP 500 at checkout", INCIDENT);
  await sleep(6000); // let Jira index them for the link search

  const results = [];
  for (const a of attached.filter((x) => x.tid)) {
    const r = a.r;
    try {
      const key = await seedIssue(projectKey, typeId, "R6 " + r.type + " probe", INCIDENT);
      await sleep(400);
      const before = counts(await getIssue(key, EXPAND));
      const res = await doTransition(key, a.tid);
      let after = before, trace = null, made = false;
      const deadline = Date.now() + 120000;
      while (Date.now() < deadline) {
        await sleep(4000);
        after = counts(await getIssue(key, EXPAND));
        if (after[r.metric] > before[r.metric]) { made = true; break; }
        trace = await readTrace(key);
        if (trace && /skip|fail|error|unavailable|no usable/i.test(JSON.stringify(trace))) break;
      }
      trace = (await readTrace(key)) || trace;
      const grade = res.status >= 500 ? "HARD" : (made ? "PASS" : "SOFT");
      results.push({ key: r.key, type: r.type, metric: r.metric, made, before: before[r.metric], after: after[r.metric], http: res.status, grade, model: trace?.modelUsed || null, reason: (trace?.reason || trace?.decision || "").slice(0, 140) });
    } catch (e) { results.push({ key: r.key, type: r.type, error: e.message.slice(0, 140), made: false, grade: "HARD" }); }
  }

  console.log(`\n=== ROUND 6 — PF flavor results ===`);
  for (const x of results) {
    const mark = x.made ? "✅ PASS" : (x.grade === "HARD" ? "❌ HARD" : "⚠️  SOFT");
    console.log(`  ${mark}  ${x.key.padEnd(12)} ${x.metric}: ${x.before}→${x.after}  ${x.error ? "ERROR " + x.error : (x.reason || "")}  ${x.model ? "(" + x.model + ")" : ""}`);
  }
  const pass = results.filter((x) => x.made).length;
  const hard = results.filter((x) => x.grade === "HARD").length;
  console.log(`\n${pass}/${results.length} artifacts created · ${hard} HARD (system) ${hard ? "⚠️" : "✅"}`);
  writeResult("round6-flavors.json", { base: BASE, results, pass, hard });
  console.log(`Cleanup: CLEAN=1 npm run audit  +  delete issues by  labels = ${R6_LABEL}`);
}

main().catch((e) => { console.error("round6 error:", e); process.exit(1); });
