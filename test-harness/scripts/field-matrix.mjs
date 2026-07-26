/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Field-type coverage matrix. For EVERY Atlassian custom field type, exercises
// the app's field handling end-to-end through the real workflow engine:
//   WRITE: a static PF calls api.updateIssue(field) -> verify the value landed
//          AND that the Jira CHANGELOG recorded the change (from/to/author).
//   READ:  a validator reads the field -> the app's extractFieldDisplayValue
//          output is captured from the cogni-debug PROPERTY (debugTrace).
// Assessment axes per the owner: forge logs + changelog + properties.

import { get, post, doTransition, getIssue, mapLimit, sleep } from "../lib/jira.mjs";
import {
  readWorkflow, updateWorkflow, makeSelfLoop, buildRule, attachRuleToTransition,
} from "../lib/workflow.mjs";
import { loadState, writeResult } from "../lib/state.mjs";

const NEUTRAL_PROMPT = "This is a data round-trip check. PASS unless the field value is completely empty.";

// Build the api.updateIssue value (correct Jira format) per field role.
function writeValueFor(cf, role) {
  const f = cf[role];
  // options may be stored as an array (setup-fields-all) or an object map (setup-fields)
  const opts = Array.isArray(f?.options) ? f.options : Object.keys(f?.options || {});
  switch (role) {
    case "text": return "harness text";
    case "textarea": return { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: "harness textarea body" }] }] };
    case "url": return "https://example.com/cogtest";
    case "number": return 7;
    case "date": return "2026-03-15";
    case "datetime": return "2026-03-15T10:30:00.000+0000";
    case "clabels": return ["alpha", "beta"];
    case "select": return { value: opts[0] || "Low" };
    case "multiselect": return (opts.length?opts:["Backend"]).slice(0, 2).map((v) => ({ value: v }));
    case "radio": return { value: opts[0] || "Yes" };
    case "checkboxes": return (opts.length?opts:["A11y"]).slice(0, 2).map((v) => ({ value: v }));
    case "user": return { accountId: cf._lead };
    case "multiuser": return [{ accountId: cf._lead }];
    case "group": return { name: f.group };
    case "multigroup": return [{ name: f.group }];
    case "cascading": return { value: f.cascade.parent, child: { value: f.cascade.child } };
    case "version": return { id: String(f.version.id) };
    case "multiversion": return [{ id: String(f.version.id) }];
    case "project": return { key: f.projectKey };
    default: return null;
  }
}

// Roles to exercise (all custom field types; offscreen excluded — not on screen).
const ROLES = ["text", "textarea", "url", "number", "date", "datetime", "clabels", "select", "multiselect", "radio", "checkboxes", "user", "multiuser", "group", "multigroup", "cascading", "version", "multiversion", "project"];

async function changelogHasField(key, fieldId) {
  try {
    const cl = await get(`/rest/api/3/issue/${key}/changelog?maxResults=100`);
    for (const h of cl.values || []) {
      for (const it of h.items || []) {
        if (it.fieldId === fieldId || it.field === fieldId) {
          return { found: true, from: it.fromString, to: it.toString, author: h.author?.accountId };
        }
      }
    }
  } catch { /* ignore */ }
  return { found: false };
}

async function createIssue(projectKey, itId, summary, extraFields = {}) {
  const res = await post("/rest/api/3/issue", { fields: { project: { key: projectKey }, issuetype: { id: itId }, summary, labels: ["cogtest-harness", "cogtest-fieldmatrix"], ...extraFields } });
  return res.key;
}

async function main() {
  const s = loadState();
  if (!s.customFields) throw new Error("Run setup-testbed + setup-fields-all first.");
  const cf = { ...s.customFields, _lead: s.leadAccountId };
  const itId = s.primaryIssueType.id;

  // 1) Attach write-PFs (one per role) + read-validators (one per role) as self-loops.
  const { top, wf } = await readWorkflow(s.workflowName);
  wf.transitions = wf.transitions.filter((t) => !String(t.name || "").startsWith("FM-"));
  const existing = new Set(wf.transitions.map((t) => String(t.id)));
  let idNum = 9200;
  const map = {}; // role -> { writeTid, readTid, fieldId }
  for (const role of ROLES) {
    const fieldId = cf[role].id;
    const val = writeValueFor(cf, role);
    const writeCode = `await api.updateIssue(api.context.issueKey, { ${JSON.stringify(fieldId)}: ${JSON.stringify(val)} });\napi.log("wrote ${role}");`;
    const nextId = (label) => { while (existing.has(String(idNum))) idNum++; existing.add(String(idNum)); return String(idNum++); };
    const writeTid = nextId();
    const readTid = nextId();
    // write PF
    const wt = makeSelfLoop(s.hubStatusRef, `FM-write-${role}`, writeTid);
    attachRuleToTransition(wt, "static", buildRule("static", { type: "postfunction-static", debugTrace: true, functions: [{ name: "w", code: writeCode, variableName: "step1" }] }));
    wf.transitions.push(wt);
    // read validator
    const rt = makeSelfLoop(s.hubStatusRef, `FM-read-${role}`, readTid);
    attachRuleToTransition(rt, "validator", buildRule("validator", { fieldId, prompt: NEUTRAL_PROMPT, enableTools: false, debugTrace: true }));
    wf.transitions.push(rt);
    map[role] = { writeTid, readTid, fieldId, writeValue: val };
  }
  await updateWorkflow(top, wf);
  console.log(`Attached ${ROLES.length} write-PFs + ${ROLES.length} read-validators.`);

  // 2) Seed: a WRITE issue (empty) + a READ issue (field pre-populated) per role.
  const seed = {};
  await mapLimit(ROLES, 4, async (role) => {
    const writeKey = await createIssue(s.projectKey, itId, `FM write ${role}`);
    let readKey;
    try {
      readKey = await createIssue(s.projectKey, itId, `FM read ${role}`, { [map[role].fieldId]: map[role].writeValue });
    } catch (e) {
      readKey = null; // some types can't be set on create screen; fall back to write-then-read
    }
    seed[role] = { writeKey, readKey, createErr: readKey ? null : "create-with-field failed" };
  });

  // 3) Fire WRITE PFs, verify value + changelog.
  const results = [];
  await mapLimit(ROLES, 3, async (role) => {
    const m = map[role]; const sd = seed[role];
    const before = await getIssue(sd.writeKey, m.fieldId);
    await doTransition(sd.writeKey, m.writeTid);
    // poll for the write to land
    let after = before, wrote = false;
    for (let i = 0; i < 10; i++) {
      await sleep(2500);
      after = await getIssue(sd.writeKey, m.fieldId);
      if (JSON.stringify(after.fields[m.fieldId] ?? null) !== JSON.stringify(before.fields[m.fieldId] ?? null)) { wrote = true; break; }
    }
    const cl = wrote ? await changelogHasField(sd.writeKey, m.fieldId) : { found: false };

    // 4) Fire READ validator on the populated read issue; capture extractFieldDisplayValue from the trace.
    let readShown = null, readErr = null;
    const readKey = sd.readKey || sd.writeKey; // if create-with-field failed, the write issue is now populated
    const rres = await doTransition(readKey, m.readTid);
    await sleep(1500);
    try {
      const prop = await get(`/rest/api/3/issue/${readKey}/properties/cogni-debug`);
      readShown = prop?.value?.fieldValue ?? null;
    } catch { readErr = "no trace"; }

    results.push({
      role, fieldId: m.fieldId,
      write: { ok: wrote, changelogRecorded: cl.found, changelogTo: (cl.to || "").slice(0, 50) },
      read: { httpAllowed: rres.status < 400, extracted: (readShown || "").slice(0, 60), nonEmpty: !!(readShown && String(readShown).trim()) },
      createWithFieldOk: !sd.createErr,
    });
    console.log(`  ${role.padEnd(13)} write=${wrote ? "ok" : "XX"} changelog=${cl.found ? "ok" : "--"} read="${(readShown || "").slice(0, 40)}"`);
  });

  writeResult("field-matrix-results.json", { count: results.length, results });
  const writeOk = results.filter((r) => r.write.ok).length;
  const clOk = results.filter((r) => r.write.changelogRecorded).length;
  const readOk = results.filter((r) => r.read.nonEmpty).length;
  console.log(`\n=== Field matrix: ${results.length} types ===`);
  console.log(`  writes landed: ${writeOk}/${results.length}`);
  console.log(`  changelog recorded: ${clOk}/${results.length}`);
  console.log(`  read extracted non-empty (extractFieldDisplayValue): ${readOk}/${results.length}`);
  const writeMiss = results.filter((r) => !r.write.ok).map((r) => r.role);
  const readMiss = results.filter((r) => !r.read.nonEmpty).map((r) => r.role);
  if (writeMiss.length) console.log(`  write misses: ${writeMiss.join(", ")}`);
  if (readMiss.length) console.log(`  read misses: ${readMiss.join(", ")}`);
  console.log("Results -> results/field-matrix-results.json");
}

main().catch((e) => {
  console.error("FIELD-MATRIX FAILED:", e.message);
  if (e.body) console.error(JSON.stringify(e.body, null, 2));
  process.exit(1);
});
