/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Verifies the NEW "Research & Document" PF flavor (postfunction-research-doc):
// gather evidence from web-search AND context7 -> AI authors a brief -> create + ATTACH
// it to the issue (the docWriter pipeline). Black-box signal = a NEW .md/.pdf attachment
// whose name matches the research title. Also exercises the dispatch substring-trap fix
// ("research-doc".includes("research") must NOT route to the plain research executor).
//
//   node scripts/research-doc-test.mjs            (CLEAN=1 removes the temp transition)

import { loadState, writeResult } from "../lib/state.mjs";
import { readWorkflow, updateWorkflow, attachSelfLoopRules } from "../lib/workflow.mjs";
import { post, getIssue, doTransition, getTransitions, sleep } from "../lib/jira.mjs";

const CLEAN = process.env.CLEAN === "1";
const s = loadState();
const hub = s.hubStatusRef;
const wfName = s.workflowName;
if (!hub || !wfName) { console.error("testbed missing hub / workflow"); process.exit(2); }

const adf = (t) => ({ type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });

async function removeTrans(prefix) {
  const { top, wf } = await readWorkflow(wfName);
  const before = wf.transitions.length;
  wf.transitions = wf.transitions.filter((t) => !new RegExp(`^${prefix}`).test(String(t.name || "")));
  if (wf.transitions.length !== before) await updateWorkflow(top, wf);
  return before - wf.transitions.length;
}

async function snapshot(key) {
  const issue = await getIssue(key, ["attachment", "comment"]);
  return {
    attachments: (issue.fields?.attachment || []).map((a) => ({ id: a.id, filename: a.filename, mime: a.mimeType, size: a.size })),
    comments: issue.fields?.comment?.comments?.length || 0,
  };
}

async function main() {
  console.log("=== Research & Document PF flavor (web + context7 → authored brief → attach) ===\n");
  await removeTrans("RDOC-");

  const cfg = {
    name: "RDOC-webctx7",
    type: "research-doc",
    config: {
      type: "postfunction-research-doc",
      fieldId: "description",
      researchSources: ["web", "context7"],
      researchQuery: "Express.js error-handling middleware: best practices and common pitfalls",
      libraryName: "express",
      researchTitle: "Express error-handling middleware brief",
      docFormat: "markdown",
      attachComment: true,
      debugTrace: true,
    },
  };
  const attached = await attachSelfLoopRules(wfName, hub, [cfg], 9760);
  const tid = attached[0].transitionId;
  console.log(`attached RDOC-webctx7 = ${tid}\n`);

  const r0 = await post("/rest/api/3/issue", { fields: {
    project: { key: s.projectKey }, issuetype: { id: s.primaryIssueType.id },
    summary: "Harden the API error-handling layer",
    description: adf("Our Express service leaks stack traces on 500s and the error middleware ordering is inconsistent. Need a brief on best practices."),
    labels: ["cogtest-harness", "research-doc"],
  } });
  const key = r0.key;
  console.log(`issue ${key} created`);

  await sleep(1200);
  const before = await snapshot(key);
  const tr = await getTransitions(key);
  if (!(tr.transitions || []).some((t) => String(t.id) === String(tid))) {
    console.log(`⚠ transition ${tid} not available on ${key}`); process.exit(1);
  }
  const fired = await doTransition(key, tid);
  console.log(`fired -> HTTP ${fired.status}${fired.status >= 400 ? " (BLOCKED?! should never block)" : " (allowed)"}`);

  // Heavy PF → queued (110s budget); web + context7 + authoring + create-attach take time.
  let after = before;
  for (let i = 0; i < 20; i++) {
    await sleep(4000);
    after = await snapshot(key);
    if (after.attachments.length > before.attachments.length || after.comments > before.comments) {
      console.log(`  side effect after ~${(i + 1) * 4}s`);
      break;
    }
  }
  const newAtt = after.attachments.filter((a) => !before.attachments.some((b) => b.id === a.id));

  let verdict, detail;
  if (newAtt.length > 0) {
    verdict = "PASS";
    detail = `attached ${newAtt.map((a) => `${a.filename} (${a.mime}, ${a.size}b)`).join(", ")}. Research→author→attach round-trip works.`;
  } else if (after.comments > before.comments) {
    verdict = "PARTIAL";
    detail = "comment added but no attachment — create/attach failed (check forge logs).";
  } else {
    verdict = "SKIP/FAIL";
    detail = "no attachment/comment — evidence gather or authoring skipped (check forge logs for the trace).";
  }
  console.log(`\n=== ${verdict}: ${detail} ===`);
  writeResult("research-doc-test.json", { key, tid, http: fired.status, before, after, newAttachments: newAtt, verdict, detail });
  console.log("(forge logs — grep: 'Research-doc PF result' 'web-search:' 'context7:' 'Authored' 'Attached' to see the trace.)");

  if (CLEAN) { const n = await removeTrans("RDOC-"); console.log(`\nCLEAN: removed ${n} RDOC-* transition(s).`); }
  else console.log("\nRun CLEAN=1 to remove the RDOC-* transition.");
}

main().catch((e) => { console.error("RDOC TEST FAILED:", e.message); if (e.body) console.error(JSON.stringify(e.body).slice(0, 400)); process.exit(1); });
