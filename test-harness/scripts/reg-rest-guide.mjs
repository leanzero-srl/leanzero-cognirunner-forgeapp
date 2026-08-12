/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// REGRESSION GUARD — the documented REST attach flow still works.
//
// docs/REST-API-RULES.md tells customers the EXACT payload shapes for attaching a
// CogniRunner rule with Jira's own workflow API. Every payload on that page was run
// live before publishing — but nothing stopped the app (or Jira) drifting from it
// afterwards. This guard executes the page's own §8 worked example against the live
// COGTEST workflow and proves it end-to-end:
//   1. discover the extension ARI via /workflows/capabilities (§2)
//   2. read the workflow (§4)
//   3. build the deterministic premade validator rule (§3, §6) and push it to a
//      self-loop transition (§4), posting the whole workflow back (§4 update payload)
//   4. attempt the transition on a violating summary → Jira must BLOCK it (§8 verify)
//   5. detach and post back — leaving the workflow as found
//
// The point is fidelity to the PAGE, not to lib/workflow.mjs: the payloads here are
// written the way the doc writes them (ruleKey forge:expression-validator, config as
// a JSON string, statuses split top-level-with-names vs per-workflow-references), so
// if the doc and the platform disagree, THIS fails.
//
// Run: node scripts/reg-rest-guide.mjs

import crypto from "node:crypto";
import { get, post, put, doTransition, searchJql, getIssue } from "../lib/jira.mjs";
import { loadState } from "../lib/state.mjs";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const APP_ID = "36415848-6868-4697-9554-3c3ad87b8da9";
const TRANSITION_NAME = "REG REST-GUIDE selfloop";
const CONFIG_ID = "reg-rest-guide-ticketref";
const VIOLATING = "no ticket ref here";           // must be BLOCKED by the regex rule
const COMPLIANT = "[COGTEST-1] proper summary";   // must be ALLOWED

async function readWorkflow(name) {
  const search = await get(`/rest/api/3/workflows/search?queryString=${encodeURIComponent(name)}&expand=values.transitions`);
  const wf = (search.values || []).find((w) => w.name === name);
  if (!wf) throw new Error(`workflow "${name}" not found`);
  return { search, wf };
}

// Post the WHOLE workflow back — top-level statuses WITH names, per-workflow statuses
// as references only. Exactly the §4 update payload.
async function writeWorkflow(search, wf) {
  return post("/rest/api/3/workflows/update", {
    statuses: (search.statuses || []).map((s) => ({ id: s.id, name: s.name, statusCategory: s.statusCategory, statusReference: s.statusReference })),
    workflows: [{
      id: wf.id,
      version: { id: wf.version.id, versionNumber: wf.version.versionNumber },
      statuses: (search.statuses || []).map((s) => ({ statusReference: s.statusReference })),
      transitions: wf.transitions,
    }],
  });
}

function stripTransition(wf, name) {
  const before = wf.transitions.length;
  wf.transitions = (wf.transitions || []).filter((t) => t.name !== name);
  return before - wf.transitions.length;
}

async function cleanup(workflowName) {
  try {
    const { search, wf } = await readWorkflow(workflowName);
    if (stripTransition(wf, TRANSITION_NAME) > 0) await writeWorkflow(search, wf);
  } catch (e) { console.log("cleanup warning:", e.message.slice(0, 120)); }
}

async function main() {
  const s = loadState();
  const workflowName = s.workflowName;
  if (!workflowName || !s.hubStatusRef) { console.error("results/testbed.json missing workflowName/hubStatusRef"); process.exit(2); }

  const issues = await searchJql(`project = ${s.projectKey || "COGTEST"} AND labels = cogtest-harness AND status = "Backlog" ORDER BY created ASC`, ["summary"], 1);
  if (!issues.length) { console.error("no harness issue parked on the hub status"); process.exit(2); }
  const KEY = issues[0].key;
  const originalSummary = (await getIssue(KEY, ["summary"])).fields.summary;

  // 1. Discover the extension ARI for THIS install — never hardcode the environment id (§2).
  const projectId = s.projectId || "10014";
  const issueTypeId = (s.issueTypes || []).find((t) => !t.subtask)?.id || "10013";
  const caps = await get(`/rest/api/3/workflows/capabilities?projectId=${projectId}&issueTypeId=${issueTypeId}`);
  const validator = (caps.forgeRules || []).find((r) => r.name === "CogniRunner Field Validator" && String(r.id).includes(APP_ID));
  ok(!!validator, "capabilities returns the CogniRunner validator ARI for this install (§2)");
  if (!validator) { console.log(`\nreg-rest-guide: ${pass} passed, ${fail} failed`); process.exit(1); }
  ok(validator.ruleKey === "forge:expression-validator", `the doc's ruleKey matches the live one (got ${validator.ruleKey})`);

  await cleanup(workflowName);

  // 2. Read the workflow, add a self-loop on the hub status, attach the rule (§3, §4).
  const { search, wf } = await readWorkflow(workflowName);
  const taken = new Set((wf.transitions || []).map((t) => String(t.id)));
  let id = 9600; while (taken.has(String(id))) id++;
  const instanceId = crypto.randomUUID();
  const config = {
    id: CONFIG_ID,
    type: "validator",
    ruleKind: "premade",
    ruleType: "field-regex",
    premadeRuleType: "field-regex",
    fieldId: "summary",
    fieldName: "Summary",
    fieldType: "string",
    regex: "^\\[[A-Z]+-\\d+\\]",
    errorMessage: "Summary must start with a ticket reference, e.g. [COGTEST-12].",
    workflow: { workflowName, transitionId: String(id) },
  };
  const rule = {
    ruleKey: validator.ruleKey,
    parameters: { key: validator.id, config: JSON.stringify(config), id: instanceId, disabled: "false" },
    id: instanceId,
  };
  wf.transitions.push({
    id, name: TRANSITION_NAME, type: "GLOBAL",
    to: { statusReference: s.hubStatusRef }, toStatusReference: s.hubStatusRef,
    validators: [rule],
  });
  const upd = await writeWorkflow(search, wf);
  ok(upd && !upd.errors?.length, `the documented /workflows/update payload is accepted (${JSON.stringify(upd?.errors || []).slice(0, 160)})`);
  await new Promise((r) => setTimeout(r, 4000)); // workflow read settles

  try {
    // 3. Violating summary must BLOCK (§8 verify).
    await put(`/rest/api/3/issue/${KEY}`, { fields: { summary: VIOLATING } }).catch(() => {});
    const blocked = await doTransition(KEY, String(id));
    ok(blocked.status >= 400, `a violating summary is BLOCKED by the REST-attached rule (got HTTP ${blocked.status})`);

    // 4. Compliant summary must PASS — proves the block was the rule, not a broken transition.
    await put(`/rest/api/3/issue/${KEY}`, { fields: { summary: COMPLIANT } }).catch(() => {});
    const allowed = await doTransition(KEY, String(id));
    ok(allowed.status < 400, `a compliant summary is ALLOWED through (got HTTP ${allowed.status})`);
  } finally {
    try { await put(`/rest/api/3/issue/${KEY}`, { fields: { summary: originalSummary } }); } catch { /* best effort */ }
    await cleanup(workflowName);
  }

  console.log(`\nreg-rest-guide: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => {
  console.error("ERROR:", e.message);
  try { await cleanup(loadState().workflowName); } catch { /* best effort */ }
  process.exit(1);
});
