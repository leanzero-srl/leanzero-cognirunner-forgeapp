/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Bounded, non-accumulating issue pool + workflow detach helpers for the live
// premade-rule test harness. Issue-delete is 403 on this instance and the owner
// rule is "never accumulate / never bulk-delete", so every fixture issue is
// FOUND-OR-CREATED by an exact summary marker and REUSED across runs. The
// workflow side gets a prefix-detach so ZHARNESS self-loops never pile up.

import { get, post, put, getIssue, getTransitions, doTransition, searchJql } from "./jira.mjs";
import { readWorkflow, updateWorkflow } from "./workflow.mjs";

/**
 * Remove every transition whose name starts with `prefix` from a workflow.
 * One update if anything changed. Idempotent. Generalizes the inline filters in
 * premade-e2e.mjs / premade-battery.mjs. Returns the count removed.
 */
export async function detachByNamePrefix(workflowName, prefix) {
  const { top, wf } = await readWorkflow(workflowName);
  const before = (wf.transitions || []).length;
  wf.transitions = (wf.transitions || []).filter((t) => !String(t.name || "").startsWith(prefix));
  const removed = before - wf.transitions.length;
  if (removed > 0) await updateWorkflow(top, wf);
  return removed;
}

/**
 * Find an issue by EXACT summary marker (the `~` JQL operator is fuzzy, so we
 * filter for exact equality in JS) or create it once. Returns the issue key.
 * `fieldsOnCreate` is merged into the create payload (project + summary added).
 */
export async function findOrCreateMarkerIssue(projectKey, marker, fieldsOnCreate = {}) {
  let hits = [];
  try {
    hits = await searchJql(`project = ${projectKey} AND summary ~ ${JSON.stringify(marker)}`, ["summary"], 50);
  } catch {
    hits = [];
  }
  const exact = hits.find((i) => (i.fields?.summary || "") === marker);
  if (exact) return exact.key;
  const res = await post("/rest/api/3/issue", {
    fields: { project: { key: projectKey }, summary: marker, ...fieldsOnCreate },
  });
  return res.key;
}

/**
 * Ensure `key` sits at the hub status so hub self-loops are listable. No-op if
 * already there; otherwise fire the first NON-ZHARNESS transition that lands on
 * the hub. Best-effort (logs if no path).
 */
export async function ensureAtHub(key, hubStatusName) {
  const issue = await getIssue(key, "status");
  if ((issue.fields?.status?.name || "") === hubStatusName) return;
  const tr = await getTransitions(key);
  const t = (tr.transitions || []).find(
    (x) => x.to?.name === hubStatusName && !String(x.name || "").startsWith("ZHARNESS"),
  );
  if (t) await doTransition(key, t.id);
  else console.log(`  (ensureAtHub: no path to ${hubStatusName} for ${key}; currently ${issue.fields?.status?.name})`);
}

/** ADF doc with a single paragraph (empty paragraph when text is falsy). */
export function adfDoc(text) {
  return {
    type: "doc",
    version: 1,
    content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }],
  };
}

/**
 * Map a human value + field role to the REST WRITE shape. `null` clears.
 * Mirrors premade-battery.mjs cf() but role-keyed and clearing-aware.
 */
export function writeShape(role, value) {
  if (value === null || value === undefined) {
    // Array-valued fields clear with [], scalars with null.
    if (["multiselect", "checkboxes", "labels", "clabels", "multiuser", "multigroup", "multiversion"].includes(role)) return [];
    return null;
  }
  switch (role) {
    case "select":
    case "radio":
      return typeof value === "object" ? value : { value: String(value) };
    case "multiselect":
    case "checkboxes":
      return (Array.isArray(value) ? value : [value]).map((v) => (typeof v === "object" ? v : { value: String(v) }));
    case "user":
    case "assignee":
    case "reporter":
      return typeof value === "object" ? value : { accountId: String(value) };
    case "multiuser":
      return (Array.isArray(value) ? value : [value]).map((v) => (typeof v === "object" ? v : { accountId: String(v) }));
    case "group":
      return typeof value === "object" ? value : { name: String(value) };
    case "multigroup":
      return (Array.isArray(value) ? value : [value]).map((v) => (typeof v === "object" ? v : { name: String(v) }));
    case "cascading":
      // value: { parent, child? }
      return value.child ? { value: value.parent, child: { value: value.child } } : { value: value.parent };
    case "version":
      return typeof value === "object" ? value : { id: String(value) };
    case "multiversion":
      return (Array.isArray(value) ? value : [value]).map((v) => (typeof v === "object" ? v : { id: String(v) }));
    case "project":
      return typeof value === "object" ? value : { key: String(value) };
    case "priority":
      return typeof value === "object" ? value : { name: String(value) };
    case "labels":
    case "clabels":
      return Array.isArray(value) ? value : [value];
    case "adf":
      return typeof value === "object" ? value : adfDoc(String(value));
    case "number":
      return value;
    case "text":
    case "textarea":
    case "url":
    case "date":
    case "datetime":
    default:
      return value;
  }
}

/** PUT a single field to a value (or clear with null) using its role's write shape. */
export async function resetField(key, fieldId, value, role) {
  await put(`/rest/api/3/issue/${key}`, { fields: { [fieldId]: writeShape(role, value) } });
}

/** GET a single field straight back after a write — the STORED shape (attribution evidence). */
export async function readBack(key, fieldId) {
  const d = await getIssue(key, fieldId);
  return (d.fields || {})[fieldId];
}

/** Group names the given account belongs to (for user-in-group Lane 2). */
export async function restReadUserGroups(accountId) {
  const d = await get(`/rest/api/3/user/groups?accountId=${encodeURIComponent(accountId)}`);
  return (Array.isArray(d) ? d : d?.items || []).map((g) => g && g.name).filter(Boolean);
}

/** Transition an issue to a status by name (direct, or hop via In Progress). */
export async function transitionToStatus(key, statusName) {
  const tr = await getTransitions(key);
  let t = (tr.transitions || []).find((x) => x.to?.name === statusName);
  if (!t && statusName === "Done") {
    const mid = (tr.transitions || []).find((x) => x.to?.name === "In Progress");
    if (mid) {
      await doTransition(key, mid.id);
      const tr2 = await getTransitions(key);
      t = (tr2.transitions || []).find((x) => x.to?.name === "Done");
    }
  }
  if (!t) throw new Error(`no path to ${statusName} for ${key}`);
  await doTransition(key, t.id);
}
