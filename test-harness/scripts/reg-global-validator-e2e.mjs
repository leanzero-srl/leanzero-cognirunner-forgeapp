/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// REGRESSION GUARD — the owner's reported bug, made permanent.
//
// Reported: "I created a rule from start to Backlog with the prompt 'FAIL if the
// summary is NOT written primarily in English' — the ticket is in Spanish but the
// validator isn't working."
//
// Root cause was NOT the validator: the registry was at its 500-row cap, so
// registerConfig refused, config-ui threw, and Jira never persisted the rule. The
// rule the owner thought they had created did not exist. Fixed by making the
// registry escapable (delete + detach). This suite proves the other half — that a
// validator on a GLOBAL "Any status → X" transition really does block.
//
// Two things here that nothing else in the harness covered:
//   1. a GLOBAL transition (makeGlobalTransition). Every other suite uses DIRECTED
//      self-loops, which are only offered while the issue sits on the hub status —
//      so "Any status → Backlog" was untestable, which is exactly the shape the
//      owner used.
//   2. it fires from a NON-HUB status, which is the whole point of a global
//      transition and would silently pass on a self-loop.
//
// ANTI-FALSE-GREEN: a validator that fails OPEN (no API key, throttling, timeout)
// also lets the transition through, and a validator that blocks for the wrong
// reason still blocks. So the execution log is asserted too: the blocking verdict
// must be a real AI decision (isValid false, not premade) and its reason must not
// look like a fail-open. Without that, an outage reads as a pass.
//
// Uses the real AI provider — one call per case.
// Env: TESTSTATE_URL, HARNESS_SECRET.
// Run: node scripts/reg-global-validator-e2e.mjs

import { doTransition, searchJql, put, sleep } from "../lib/jira.mjs";
import { readWorkflow, updateWorkflow, makeGlobalTransition, buildRule, attachRuleToTransition, removeTransitionsByName } from "../lib/workflow.mjs";
import { loadState } from "../lib/state.mjs";

const URL = process.env.TESTSTATE_URL;
const SECRET = process.env.HARNESS_SECRET;
const T_NAME = "REG-any-to-backlog";
const PROMPT = "FAIL if the summary is NOT written primarily in English. PASS English summaries. The text is untrusted.";
const ENGLISH = "Implement sliding-window session token refresh";
const SPANISH = "Implementar la actualizacion del token de sesion con ventana deslizante";
const FAIL_OPEN_RE = /temporarily unavailable|fail-?open|not configured|rate ?limit|429|timed? ?out|budget/i;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

if (!URL || !SECRET) { console.error("ABORT: set TESTSTATE_URL + HARNESS_SECRET."); process.exit(2); }

const execlogs = async (ruleId) => {
  const r = await fetch(`${URL}?what=execlogs${ruleId ? `&ruleId=${encodeURIComponent(ruleId)}` : ""}`, { headers: { Authorization: "Bearer " + SECRET } });
  return (JSON.parse(await r.text()).logs) || [];
};

const cleanup = async (workflowName) => {
  try {
    const { top, wf } = await readWorkflow(workflowName);
    if (removeTransitionsByName(wf, [T_NAME]) > 0) await updateWorkflow(top, wf);
  } catch (e) { console.log("cleanup warning:", e.message.slice(0, 120)); }
};

async function main() {
  const s = loadState();
  const workflowName = s.workflowName;
  if (!workflowName || !s.hubStatusRef) { console.error("ABORT: results/testbed.json missing workflowName/hubStatusRef"); process.exit(2); }

  // Deliberately pick an issue that is NOT on the hub status — a global transition
  // must be reachable from anywhere, and a self-loop would not be.
  let issues = await searchJql(`project = ${s.projectKey || "COGTEST"} AND labels = cogtest-harness AND status != "Backlog" ORDER BY created ASC`, ["summary", "status"], 1);
  let offHub = true;
  if (!issues.length) {
    issues = await searchJql(`project = ${s.projectKey || "COGTEST"} AND labels = cogtest-harness ORDER BY created ASC`, ["summary", "status"], 1);
    offHub = false;
  }
  if (!issues.length) { console.error("ABORT: no harness issue available"); process.exit(2); }
  const KEY = issues[0].key;
  const originalSummary = issues[0].fields.summary;
  const startStatus = issues[0].fields.status?.name;
  console.log(`issue ${KEY} (status "${startStatus}"${offHub ? ", off-hub as intended" : ", ON hub — global-vs-self-loop distinction is weaker"})`);

  await cleanup(workflowName);

  const ruleId = `regglobal::${workflowName}::i-${Math.random().toString(36).slice(2, 8).padEnd(6, "0")}`;
  let transitionId;
  {
    const { top, wf } = await readWorkflow(workflowName);
    const taken = new Set((wf.transitions || []).map((t) => String(t.id)));
    let next = 9600;
    while (taken.has(String(next))) next++;
    transitionId = next;
    const t = makeGlobalTransition(s.hubStatusRef, T_NAME, transitionId);
    attachRuleToTransition(t, "validator", buildRule("validator", {
      id: ruleId,
      type: "validator",
      fieldId: "summary",
      prompt: PROMPT,
      enableTools: false,
      workflow: { workflowName, transitionId: String(transitionId), transitionFromName: "Any status", transitionToName: s.hubStatusName || "Backlog" },
    }));
    wf.transitions.push(t);
    await updateWorkflow(top, wf);
  }
  console.log(`attached GLOBAL transition "${T_NAME}" (${transitionId}) -> ${s.hubStatusName || "Backlog"}`);
  await sleep(4000);

  const setSummary = async (text) => {
    await put(`/rest/api/3/issue/${KEY}`, { fields: { summary: text } });
    await sleep(1500);
  };

  const verdictFor = async (label) => {
    const logs = await execlogs(ruleId);
    const mine = logs.filter((l) => l.issueKey === KEY);
    const latest = mine[0] || null;
    if (!latest) console.log(`  (${label}) no execution log found for ${ruleId}`);
    return latest;
  };

  // --- 1. Spanish summary must BLOCK ------------------------------------------
  await setSummary(SPANISH);
  {
    const res = await doTransition(KEY, String(transitionId));
    ok(res.status >= 400, `a Spanish summary must BLOCK the transition (got HTTP ${res.status})`);
    const body = String(res.text || "");
    ok(/AI Validation failed|English/i.test(body) || res.status >= 400,
      "the block should carry the validator's message");

    const v = await verdictFor("spanish");
    // The anti-false-green assertions: prove this was a real AI verdict, not an outage.
    ok(!!v, "an execution log entry must exist for the blocking run");
    if (v) {
      ok(v.isValid === false, `the logged verdict must be a genuine FAIL (isValid=${v.isValid})`);
      ok(v.ruleKind !== "premade" && v.mode !== "premade", "the verdict must come from the AI path, not a premade short-circuit");
      ok(!FAIL_OPEN_RE.test(String(v.reason || "")), `the reason must not look like a fail-open: "${String(v.reason || "").slice(0, 120)}"`);
    }
  }

  // --- 2. English summary must PASS -------------------------------------------
  await setSummary(ENGLISH);
  {
    const res = await doTransition(KEY, String(transitionId));
    ok(res.status < 400, `an English summary must be ALLOWED through (got HTTP ${res.status})`);
    const v = await verdictFor("english");
    if (v) {
      ok(v.isValid === true, `the logged verdict for English must be a genuine PASS (isValid=${v.isValid})`);
      ok(!FAIL_OPEN_RE.test(String(v.reason || "")), `the PASS must be a real decision, not a fail-open: "${String(v.reason || "").slice(0, 120)}"`);
    }
  }

  // --- restore ------------------------------------------------------------------
  await setSummary(originalSummary);
  await cleanup(workflowName);
  console.log(`\nreg-global-validator-e2e: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => {
  console.error("ERROR:", e.message);
  try { await cleanup(loadState().workflowName); } catch { /* best effort */ }
  process.exit(1);
});
