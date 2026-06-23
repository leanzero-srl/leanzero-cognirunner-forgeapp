/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Create the focused COGTEST_* custom-field set (target-write coverage for
// semantic PFs) and wire them onto the project's screens. Idempotent: reuses
// fields/options/screen placements that already exist. System fields
// (summary/description/labels/priority/assignee/duedate) cover the source-side
// edge tests and need no wiring.

import { get, post } from "../lib/jira.mjs";
import { loadState, patchState } from "../lib/state.mjs";

const CFT = "com.atlassian.jira.plugin.system.customfieldtypes";
const SCR = "com.atlassian.jira.plugin.system.customfieldtypes"; // searcher prefix shares ns

// type, searcher, optional options (for select). All names prefixed COGTEST_.
const FIELD_SPECS = [
  { name: "COGTEST_Text", type: `${CFT}:textfield`, searcher: `${SCR}:textsearcher`, wire: true, role: "text" },
  { name: "COGTEST_Select", type: `${CFT}:select`, searcher: `${SCR}:multiselectsearcher`, wire: true, role: "select", options: ["Low", "Medium", "High", "Security"] },
  { name: "COGTEST_Number", type: `${CFT}:float`, searcher: `${SCR}:exactnumber`, wire: true, role: "number" },
  { name: "COGTEST_Date", type: `${CFT}:datepicker`, searcher: `${SCR}:daterange`, wire: true, role: "date" },
  { name: "COGTEST_User", type: `${CFT}:userpicker`, searcher: `${SCR}:userpickergroupsearcher`, wire: true, role: "user" },
  // Deliberately NOT wired to screens -> exercises the "target not on screen" SKIP path.
  { name: "COGTEST_OffScreen", type: `${CFT}:textfield`, searcher: `${SCR}:textsearcher`, wire: false, role: "offscreen" },
];

async function findFieldByName(name) {
  const all = await get("/rest/api/3/field");
  return all.find((f) => f.custom && f.name === name) || null;
}

async function ensureField(spec) {
  let field = await findFieldByName(spec.name);
  if (!field) {
    console.log(`  creating field ${spec.name}...`);
    const created = await post("/rest/api/3/field", {
      name: spec.name,
      type: spec.type,
      searcherKey: spec.searcher,
    });
    field = { id: created.id, name: spec.name };
  } else {
    console.log(`  field ${spec.name} exists (${field.id})`);
  }
  return field.id;
}

async function ensureContext(fieldId) {
  const ctxs = await get(`/rest/api/3/field/${fieldId}/context`);
  if ((ctxs.values || []).length) return ctxs.values[0].id;
  console.log(`    creating global context for ${fieldId}...`);
  const ctx = await post(`/rest/api/3/field/${fieldId}/context`, {
    name: `${fieldId} global context`,
    projectIds: [],
    issueTypeIds: [],
  });
  return ctx.id;
}

async function ensureOptions(fieldId, contextId, values) {
  const existing = await get(`/rest/api/3/field/${fieldId}/context/${contextId}/option`);
  const have = new Set((existing.values || []).map((o) => o.value));
  const toAdd = values.filter((v) => !have.has(v));
  const map = {};
  for (const o of existing.values || []) map[o.value] = o.id;
  if (toAdd.length) {
    const res = await post(`/rest/api/3/field/${fieldId}/context/${contextId}/option`, {
      options: toAdd.map((v) => ({ value: v, disabled: false })),
    });
    for (const o of res.options || []) map[o.value] = o.id;
    console.log(`    added options: ${toAdd.join(", ")}`);
  }
  return map;
}

async function wireToScreens(fieldId, screenIds) {
  for (const screenId of screenIds) {
    const tabs = await get(`/rest/api/3/screens/${screenId}/tabs`);
    const tabId = tabs[0]?.id;
    if (!tabId) continue;
    // is it already on the tab?
    const fields = await get(`/rest/api/3/screens/${screenId}/tabs/${tabId}/fields`);
    if ((fields || []).some((f) => f.id === fieldId)) continue;
    try {
      await post(`/rest/api/3/screens/${screenId}/tabs/${tabId}/fields`, { fieldId });
      console.log(`    wired ${fieldId} -> screen ${screenId} tab ${tabId}`);
    } catch (e) {
      console.log(`    wire ${fieldId} -> screen ${screenId} failed: ${e.message.slice(0, 120)}`);
    }
  }
}

async function main() {
  const s = loadState();
  if (!s.projectId) throw new Error("Run setup-testbed.mjs first.");
  const screenIds = [10064, 10065]; // COGTEST default + bug screens

  const customFields = {};
  for (const spec of FIELD_SPECS) {
    console.log(`Field ${spec.name}:`);
    const fieldId = await ensureField(spec);
    const contextId = await ensureContext(fieldId);
    let options = null;
    if (spec.options) options = await ensureOptions(fieldId, contextId, spec.options);
    if (spec.wire) await wireToScreens(fieldId, screenIds);
    customFields[spec.role] = { id: fieldId, name: spec.name, type: spec.type, contextId, options };
  }

  patchState({ customFields });
  console.log("\nCustom fields ready:");
  for (const [role, f] of Object.entries(customFields)) {
    console.log(`  ${role}: ${f.name} (${f.id})${f.options ? " opts=" + Object.keys(f.options).join("/") : ""}`);
  }
}

main().catch((e) => {
  console.error("SETUP-FIELDS FAILED:", e.message);
  if (e.body) console.error(JSON.stringify(e.body, null, 2));
  process.exit(1);
});
