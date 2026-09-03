/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// LIVE E2E for the RULE IMPORTER against a JIRA SERVICE MANAGEMENT workflow.
//
// The it12 import smoke only ever ran against the COGTEST *software* workflow. A JSM
// company-managed project has its own workflow scheme and its own workflow ("<KEY>: Jira
// Service Management default workflow"), so this proves the import path end to end on the
// surface a JSM customer actually has:
//
//   1. read the JSM project's workflow (workflows/search) and add a fresh self-loop transition
//   2. commitImport a static post-function through the dev-gated test hook (the SAME
//      commitImportCore the admin panel's Import uses)
//   3. assert the rule landed on the transition AND a registry row exists
//   4. drive a real JSM issue through the transition and read back the issue property the
//      imported step writes — the firing proof
//   5. round-trip the portable JSON through the same validator the resolver uses
//   6. clean up: remove the transition (which removes the rule) and the property
//
// Run: node scripts/jsm-import-e2e.mjs        (KEEP=1 keeps the transition + issue)
//      JSM_PROJECT_KEY=JT overrides the project choice.
import { loadEnv } from "../lib/env.mjs";
import { readWorkflow, makeSelfLoop, updateWorkflow } from "../lib/workflow.mjs";

const env = loadEnv();
const BASE = env.JIRA_BASE_URL.replace(/\/$/, "");
const AUTH = "Basic " + Buffer.from(`${env.JIRA_ADMIN_EMAIL}:${env.JIRA_API_TOKEN}`).toString("base64");
const KEEP = process.env.KEEP === "1";
const RUN = Date.now().toString(36).slice(-5);
const TRANSITION_ID = 9541;
const PROP = "cogni-jsm-import";

let pass = 0; let fail = 0; const notes = [];
const ok = (c, msg) => { if (c) { pass++; console.log("  ✓ " + msg); } else { fail++; console.log("  ✗ " + msg); } return !!c; };
const note = (m) => { notes.push(m); console.log("  · " + m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const jira = async (method, path, body) => {
  const res = await fetch(`${BASE}${path}`, { method, headers: { Authorization: AUTH, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 300) }; }
  return { status: res.status, ok: res.ok, body: json };
};
const must = (r, what) => { if (!r.ok) throw new Error(`${what} → ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`); return r.body; };

const hook = async (bodyObj, method = "POST") => {
  const res = await fetch(env.TESTSTATE_URL, { method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.HARNESS_SECRET }, body: method === "POST" ? JSON.stringify(bodyObj) : undefined });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* leave */ }
  return { status: res.status, json, text };
};

async function main() {
  console.log(`JSM IMPORT E2E on ${BASE} (run ${RUN})`);
  if (!env.TESTSTATE_URL || !env.HARNESS_SECRET) throw new Error("TESTSTATE_URL + HARNESS_SECRET required (dev test hook).");

  const ping = await hook(null, "GET");
  ok(ping.status === 200, `dev test hook reachable (${ping.status})`);

  // ── the JSM project + its workflow ──────────────────────────────────────────
  const projects = must(await jira("GET", "/rest/api/3/project/search?maxResults=100"), "projects").values || [];
  const wanted = process.env.JSM_PROJECT_KEY || env.JSM_PROJECT_KEY || null;
  let proj = wanted ? projects.find((p) => p.key === wanted) : null;
  if (!proj) {
    // Prefer a company-managed service desk we can actually create issues in — several
    // demo service projects on a site grant the admin nothing but browse.
    for (const p of projects.filter((x) => x.projectTypeKey === "service_desk" && !x.simplified)) {
      // mypermissions LIES here: it reports CREATE_ISSUES:true on demo service projects whose
      // create actually 400s. createmeta is the honest probe — it only lists what can be created.
      const cm = await jira("GET", `/rest/api/3/issue/createmeta/${p.key}/issuetypes`);
      const usable = cm.ok && (cm.body.issueTypes || cm.body.values || []).filter((t) => !t.subtask);
      if (usable && usable.length) { proj = p; break; }
      note(`${p.key}: createmeta offers no creatable issue type for the API user — skipped`);
    }
  }
  if (!proj) throw new Error("no company-managed JSM project the API user can create issues in (team-managed workflows are not editable over the workflows API either)");
  console.log(`  JSM project ${proj.key} (${proj.name})`);

  const scheme = must(await jira("GET", `/rest/api/3/workflowscheme/project?projectId=${proj.id}`), "workflow scheme").values[0];
  const mappings = scheme.workflowScheme.issueTypeMappings || {};
  const wfNames = [...new Set(Object.values(mappings).concat(scheme.workflowScheme.defaultWorkflow || []))].filter((n) => n && n !== "jira");
  ok(wfNames.length > 0, `JSM workflow scheme resolved: ${wfNames.join(" | ")}`);

  // Pick a workflow that is editable AND is used by a non-subtask issue type we can create.
  const types = must(await jira("GET", `/rest/api/3/project/${proj.id}`), "project").issueTypes || [];
  let workflowName = null; let issueType = null;
  for (const [typeId, name] of Object.entries(mappings)) {
    const t = types.find((x) => String(x.id) === String(typeId) && !x.subtask);
    if (!t || name === "jira") continue;
    try { await readWorkflow(name); workflowName = name; issueType = t; break; } catch (e) { note(`workflow "${name}" not readable/editable: ${e.message}`); }
  }
  if (!ok(!!workflowName, `editable JSM workflow found: "${workflowName}" (issue type ${issueType && issueType.name})`)) {
    throw new Error("no editable JSM workflow — cannot test the importer here");
  }

  // ── 1. add the import-target self-loop transition on the issue's CURRENT status ──
  let { top, wf } = await readWorkflow(workflowName);
  const issue = must(await jira("POST", "/rest/api/3/issue", { fields: { project: { id: proj.id }, issuetype: { id: issueType.id }, summary: `CogniRunner JSM import smoke ${RUN}` } }), "create issue");
  console.log(`  issue ${issue.key}`);
  await sleep(1500);
  const live = must(await jira("GET", `/rest/api/3/issue/${issue.key}?fields=status`), "read issue");
  const statusName = live.fields.status.name;
  const statusId = live.fields.status.id;
  const hubRef = (wf.statuses || []).map((s) => s.statusReference).find((ref) => {
    const st = (top.statuses || []).find((x) => x.statusReference === ref);
    return st && (String(st.id) === String(statusId) || st.name === statusName);
  });
  if (!ok(!!hubRef, `issue sits in "${statusName}" and that status is in the workflow (ref ${hubRef})`)) throw new Error("status not found in the workflow graph");

  wf.transitions = (wf.transitions || []).filter((t) => String(t.id) !== String(TRANSITION_ID));
  wf.transitions.push(makeSelfLoop(hubRef, `JSM Import Smoke ${RUN}`, TRANSITION_ID));
  await updateWorkflow(top, wf);
  ok(true, `self-loop transition ${TRANSITION_ID} added on "${statusName}"`);
  await sleep(2000);

  // ── 2. commitImport a static PF through the real core ───────────────────────
  const rule = {
    type: "postfunction-static",
    name: `JSM import smoke ${RUN}`,
    functions: [{
      name: "set-prop", operationType: "rest_api_internal", variableName: "r",
      code: `const f = (await api.getIssue(api.context.issueKey)).fields || {};\nawait api.setProperty(${JSON.stringify(PROP)}, { fired: true, project: (f.project || {}).key || null, at: Date.now() });\nreturn { ok: true };`,
    }],
  };
  const commit = await hook({ action: "commit", rule, targetWorkflowName: workflowName, targetTransitionId: String(TRANSITION_ID) });
  const committed = commit.status === 200 && commit.json && commit.json.success && commit.json.status === "committed";
  if (!ok(committed, `commitImport committed onto the JSM workflow (ruleId ${commit.json && commit.json.ruleId})`)) {
    note(`commit response: ${JSON.stringify(commit.json || commit.text).slice(0, 400)}`);
  }
  const ruleId = commit.json && commit.json.ruleId;

  // ── 3. rule on the transition + registry row ────────────────────────────────
  await sleep(1500);
  ({ top, wf } = await readWorkflow(workflowName));
  const tgt = (wf.transitions || []).find((t) => String(t.id) === String(TRANSITION_ID));
  const onTransition = (tgt && tgt.actions || []).some((a) => { try { return JSON.parse(a.parameters && a.parameters.config || "{}").id === ruleId; } catch { return false; } });
  ok(onTransition, "imported rule is attached to the JSM transition");
  const reg = await hook(null, "GET");
  ok(Array.isArray(reg.json && reg.json.registry) && reg.json.registry.some((r) => r.id === ruleId), "registry row present for the imported rule");

  // ── 4. fire it on a real JSM issue ──────────────────────────────────────────
  await jira("DELETE", `/rest/api/3/issue/${issue.key}/properties/${PROP}`);
  const tr = await jira("POST", `/rest/api/3/issue/${issue.key}/transitions`, { transition: { id: String(TRANSITION_ID) } });
  ok(tr.status < 400, `drove ${issue.key} through the transition (${tr.status})`);
  let fired = null;
  for (let i = 0; i < 12 && !fired; i++) {
    await sleep(2500);
    const p = await jira("GET", `/rest/api/3/issue/${issue.key}/properties/${PROP}`);
    if (p.ok && p.body.value && p.body.value.fired === true) fired = p.body.value;
  }
  ok(!!fired, `imported post-function FIRED on the JSM issue (${JSON.stringify(fired)})`);
  if (fired) ok(fired.project === proj.key, `the step saw the JSM project context (${fired.project})`);

  // ── 5. portable JSON round-trip through the real validator ──────────────────
  const { validateImportSchema, buildExportEnvelope, serializeRule } = await import("../../src/shared/rule-portability.js");
  const envelope = buildExportEnvelope([serializeRule({ config: { type: "postfunction-static", functions: rule.functions }, workflowContext: { workflowName }, fieldMeta: {}, docNames: [], functions: rule.functions })], { appVersion: "1.0.0", exportedAt: new Date().toISOString() });
  const v = validateImportSchema(JSON.parse(JSON.stringify(envelope)));
  ok(v.ok, `export envelope of a JSM rule re-validates on import (${v.ok ? v.rules.length + " rule(s)" : v.error})`);

  // ── cleanup ─────────────────────────────────────────────────────────────────
  if (!KEEP) {
    try {
      ({ top, wf } = await readWorkflow(workflowName));
      wf.transitions = (wf.transitions || []).filter((t) => String(t.id) !== String(TRANSITION_ID));
      await updateWorkflow(top, wf);
      await jira("DELETE", `/rest/api/3/issue/${issue.key}/properties/${PROP}`);
      if (ruleId) await hook({ action: "removeRules", ids: [ruleId], detach: false });
      const d = await jira("DELETE", `/rest/api/3/issue/${issue.key}`);
      console.log(`  cleaned up (transition removed, registry row removed, issue delete ${d.status})`);
    } catch (e) { note(`cleanup: ${e.message}`); }
  } else console.log(`  KEEP=1 — transition ${TRANSITION_ID} and issue ${issue.key} kept`);

  if (notes.length) { console.log("\nNOTES:"); for (const n of notes) console.log("  - " + n); }
  console.log(`\nJSM IMPORT E2E: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error("FATAL:", e && e.stack || e); process.exit(1); });
