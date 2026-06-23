/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Create the FULL set of standard Atlassian custom field types (beyond the
// initial 6) so the harness can exercise the app's field handling
// (extractFieldDisplayValue on read; api.updateIssue / semantic write) across
// EVERY type: text/textarea/url, single+multi option, radio, checkboxes,
// date+datetime, number, labels, user+multiuser, group+multigroup, cascading,
// version+multiversion, project. Idempotent. Merges into state.customFields with
// the write-format metadata the field-matrix test needs.

import { get, post } from "../lib/jira.mjs";
import { loadState, patchState } from "../lib/state.mjs";

const CFT = "com.atlassian.jira.plugin.system.customfieldtypes";
const SCREENS = [10064, 10065];

// role -> { type, searcher, options?, cascading?, version?, group?, project? }
const SPECS = [
  { role: "textarea", name: "COGTEST_TextArea", type: `${CFT}:textarea`, searcher: `${CFT}:textsearcher` },
  { role: "url", name: "COGTEST_Url2", type: `${CFT}:url`, searcher: `${CFT}:exacttextsearcher` },
  { role: "clabels", name: "COGTEST_Labels2", type: `${CFT}:labels`, searcher: `${CFT}:labelsearcher` },
  { role: "datetime", name: "COGTEST_DateTime", type: `${CFT}:datetime`, searcher: `${CFT}:datetimerange` },
  { role: "multiselect", name: "COGTEST_MultiSelect", type: `${CFT}:multiselect`, searcher: `${CFT}:multiselectsearcher`, options: ["Backend", "Frontend", "Infra", "Security"] },
  { role: "radio", name: "COGTEST_Radio", type: `${CFT}:radiobuttons`, searcher: `${CFT}:multiselectsearcher`, options: ["Yes", "No", "Maybe"] },
  { role: "checkboxes", name: "COGTEST_Checkboxes", type: `${CFT}:multicheckboxes`, searcher: `${CFT}:multiselectsearcher`, options: ["A11y", "Perf", "Docs", "Tests"] },
  { role: "multiuser", name: "COGTEST_MultiUser", type: `${CFT}:multiuserpicker`, searcher: `${CFT}:userpickergroupsearcher` },
  { role: "group", name: "COGTEST_Group", type: `${CFT}:grouppicker`, searcher: `${CFT}:grouppickersearcher`, group: true },
  { role: "multigroup", name: "COGTEST_MultiGroup", type: `${CFT}:multigrouppicker`, searcher: `${CFT}:grouppickersearcher`, group: true },
  { role: "cascading", name: "COGTEST_Cascading", type: `${CFT}:cascadingselect`, searcher: `${CFT}:cascadingselectsearcher`, cascading: true },
  { role: "version", name: "COGTEST_Version", type: `${CFT}:version`, searcher: `${CFT}:versionsearcher`, version: true },
  { role: "multiversion", name: "COGTEST_MultiVersion", type: `${CFT}:multiversion`, searcher: `${CFT}:versionsearcher`, version: true },
  { role: "project", name: "COGTEST_Project", type: `${CFT}:project`, searcher: `${CFT}:projectsearcher`, project: true },
];

async function findFieldByName(name) {
  return (await get("/rest/api/3/field")).find((f) => f.custom && f.name === name) || null;
}
async function ensureField(spec) {
  let f = await findFieldByName(spec.name);
  if (f) return f.id;
  const c = await post("/rest/api/3/field", { name: spec.name, type: spec.type, searcherKey: spec.searcher });
  console.log(`  created ${spec.name} (${c.id})`);
  return c.id;
}
async function ensureContext(fieldId) {
  const ctxs = await get(`/rest/api/3/field/${fieldId}/context`);
  if ((ctxs.values || []).length) return ctxs.values[0].id;
  const ctx = await post(`/rest/api/3/field/${fieldId}/context`, { name: `${fieldId} ctx`, projectIds: [], issueTypeIds: [] });
  return ctx.id;
}
async function ensureOptions(fieldId, ctxId, values) {
  const ex = await get(`/rest/api/3/field/${fieldId}/context/${ctxId}/option`);
  const have = new Set((ex.values || []).map((o) => o.value));
  const map = {}; for (const o of ex.values || []) map[o.value] = o.id;
  const toAdd = values.filter((v) => !have.has(v));
  if (toAdd.length) {
    const r = await post(`/rest/api/3/field/${fieldId}/context/${ctxId}/option`, { options: toAdd.map((v) => ({ value: v, disabled: false })) });
    for (const o of r.options || []) map[o.value] = o.id;
  }
  return map;
}
async function ensureCascading(fieldId, ctxId) {
  // parent option + child options
  const ex = await get(`/rest/api/3/field/${fieldId}/context/${ctxId}/option`);
  let parent = (ex.values || []).find((o) => o.value === "Platform" && !o.optionId);
  if (!parent) {
    const r = await post(`/rest/api/3/field/${fieldId}/context/${ctxId}/option`, { options: [{ value: "Platform", disabled: false }] });
    parent = r.options[0];
  }
  const kids = (ex.values || []).filter((o) => o.optionId === parent.id).map((o) => o.value);
  const wantKids = ["iOS", "Android", "Web"].filter((k) => !kids.includes(k));
  if (wantKids.length) {
    await post(`/rest/api/3/field/${fieldId}/context/${ctxId}/option`, { options: wantKids.map((v) => ({ value: v, optionId: parent.id, disabled: false })) });
  }
  return { parent: "Platform", child: "Web" };
}
async function wireToScreens(fieldId) {
  for (const screenId of SCREENS) {
    const tabs = await get(`/rest/api/3/screens/${screenId}/tabs`);
    const tabId = tabs[0]?.id; if (!tabId) continue;
    const fields = await get(`/rest/api/3/screens/${screenId}/tabs/${tabId}/fields`);
    if ((fields || []).some((f) => f.id === fieldId)) continue;
    try { await post(`/rest/api/3/screens/${screenId}/tabs/${tabId}/fields`, { fieldId }); } catch { /* may already be present */ }
  }
}
async function ensureVersion(projectId) {
  const vs = await get(`/rest/api/3/project/${projectId}/versions`);
  let v = (vs || []).find((x) => x.name === "v1.0-cogtest");
  if (!v) v = await post("/rest/api/3/version", { name: "v1.0-cogtest", projectId: Number(projectId) });
  return { id: v.id, name: v.name };
}
async function ensureGroup() {
  const name = "cogtest-group";
  try { await post("/rest/api/3/group", { name }); } catch { /* exists */ }
  return name;
}

async function main() {
  const s = loadState();
  if (!s.projectId) throw new Error("Run setup-testbed first.");
  const version = await ensureVersion(s.projectId);
  const groupName = await ensureGroup();
  const customFields = { ...(s.customFields || {}) };

  for (const spec of SPECS) {
    console.log(`Field ${spec.name}:`);
    const id = await ensureField(spec);
    const ctxId = await ensureContext(id);
    const entry = { id, name: spec.name, type: spec.type, role: spec.role };
    if (spec.options) entry.options = Object.keys(await ensureOptions(id, ctxId, spec.options));
    if (spec.cascading) entry.cascade = await ensureCascading(id, ctxId);
    if (spec.version) entry.version = version;
    if (spec.group) entry.group = groupName;
    if (spec.project) entry.projectKey = s.projectKey;
    await wireToScreens(id);
    customFields[spec.role] = entry;
  }

  patchState({ customFields, testVersion: version, testGroup: groupName });
  console.log(`\nField set now covers ${Object.keys(customFields).length} types: ${Object.keys(customFields).join(", ")}`);
}

main().catch((e) => {
  console.error("SETUP-FIELDS-ALL FAILED:", e.message);
  if (e.body) console.error(JSON.stringify(e.body, null, 2));
  process.exit(1);
});
