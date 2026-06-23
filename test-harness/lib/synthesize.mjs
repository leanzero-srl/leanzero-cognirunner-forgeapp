/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Synthesize fit-for-purpose inputs for an ARBITRARY discovered rule (we don't
// know the rule's intent the way we know the canonical fixtures), and provide the
// reachability helpers needed to drive a rule in-place: find/seed an issue in the
// right project and make its target transition available. The bar is a non-zero
// execution with a sane, observable outcome — not perfect verdict calibration of
// someone else's prompt.

import { get, post, put, getTransitions, doTransition, searchJql, sleep } from "./jira.mjs";

// ---- ADF + value shaping --------------------------------------------------

export function adfDoc(text) {
  return {
    type: "doc",
    version: 1,
    content: [{ type: "paragraph", content: [{ type: "text", text: String(text) }] }],
  };
}

// A concrete, legitimate engineering task — the "should pass" content for a
// quality/validity validator. Rich enough to satisfy "well-formed report" prompts.
export const GOOD_TASK_SUMMARY = "Implement sliding-window session-token refresh to fix intermittent 401s";
export const GOOD_REPORT_TEXT =
  "Saved-card checkout intermittently returns HTTP 500 after release v2.3. " +
  "Repro: log in, add a saved card, submit payment twice within 5s — the second call 500s ~30% of the time. " +
  "Impact: ~3% of checkout attempts fail; revenue-affecting. " +
  "Acceptance criteria: no 500s under concurrent submit; idempotency key honored; regression test added.";
const GIBBERISH = "asdf qwer zxcv hjkl ;;; 1209 ~~~ blorp";

let FIELD_INDEX = null;
/** fieldId -> { name, schemaType, itemsType, custom }. Cached for the process. */
export async function fetchFieldIndex() {
  if (FIELD_INDEX) return FIELD_INDEX;
  const fields = await get("/rest/api/3/field");
  const idx = {};
  for (const f of fields || []) {
    idx[f.id] = {
      name: f.name,
      schemaType: f.schema?.type || null,
      itemsType: f.schema?.items || null,
      custom: f.schema?.custom || null,
    };
  }
  FIELD_INDEX = idx;
  return idx;
}

const accountIdCache = { id: null };
export async function myAccountId() {
  if (accountIdCache.id) return accountIdCache.id;
  const me = await get("/rest/api/3/myself");
  accountIdCache.id = me.accountId;
  return accountIdCache.id;
}

// Pick a value for fieldId in a given flavor ("pass" | "fail" | "source").
// Returns { set: boolean, value, note }. set=false → fire as-is (we couldn't
// safely synthesize a value for this field type without risking a 400).
export async function valueForField(fieldId, flavor, fieldIndex, prompt = "") {
  const meta = fieldIndex[fieldId] || {};
  const type = meta.schemaType;
  const p = String(prompt).toLowerCase();

  // System text fields by id (schema may say "string"/"doc")
  if (fieldId === "summary" || type === "string") {
    return { set: true, value: textFlavor(flavor, p), note: "string" };
  }
  if (fieldId === "description" || type === "doc") {
    return { set: true, value: adfDoc(textFlavor(flavor, p, true)), note: "doc(adf)" };
  }
  if (type === "date") {
    return { set: true, value: dateFlavor(flavor, p), note: "date" };
  }
  if (type === "datetime") {
    const d = dateFlavor(flavor, p);
    return { set: true, value: `${d}T09:30:00.000+0000`, note: "datetime" };
  }
  if (type === "number") {
    return { set: true, value: flavor === "fail" ? 250 : 5, note: "number" };
  }
  if (type === "user") {
    return { set: true, value: { accountId: await myAccountId() }, note: "user" };
  }
  if (type === "array" && meta.itemsType === "string") {
    // labels-style
    if (flavor === "fail" && /(wontfix|duplicate|forbidden|not allowed)/.test(p)) {
      return { set: true, value: ["wontfix", "duplicate"], note: "labels(fail-biased)" };
    }
    return { set: true, value: flavor === "fail" ? ["cogtest-bad"] : ["cogtest-ok"], note: "labels" };
  }
  // option / component / version / multi-select / cascading / any: allowedValues
  // matter and arbitrary writes 400. Fire as-is — still a real execution.
  return { set: false, value: null, note: `as-is (${type || "unknown"} field)` };
}

function textFlavor(flavor, prompt, rich = false) {
  if (flavor === "source" || flavor === "pass") {
    return rich ? GOOD_REPORT_TEXT : GOOD_TASK_SUMMARY;
  }
  // fail: bias by prompt cues
  if (/(pii|email|ssn|credit|card|secret|api ?key|phone|personal)/.test(prompt)) {
    return "Contact john.doe@example.com, SSN 123-45-6789, card 4111 1111 1111 1111, key sk-live-abc123.";
  }
  if (/(empty|blank|whitespace|null)/.test(prompt)) return "   ";
  return GIBBERISH;
}

function dateFlavor(flavor, prompt) {
  // "odd day" style prompts: make fail an odd day-of-month, pass an even one.
  const wantOddForFail = /odd/.test(prompt);
  const base = "2026-07-";
  if (wantOddForFail) return base + (flavor === "fail" ? "07" : "08");
  return flavor === "fail" ? base + "01" : base + "15";
}

/**
 * Inputs for a validator/condition rule: a value its prompt should accept and one
 * it should reject, for the configured field. { passValue, failValue, fieldId, strategy }.
 * pass/failValue are { set, value, note } objects (set=false → fire as-is).
 */
export async function synthesizeValidatorInputs(config, fieldIndex) {
  const fieldId = config.fieldId || "summary";
  const passValue = await valueForField(fieldId, "pass", fieldIndex, config.prompt);
  const failValue = await valueForField(fieldId, "fail", fieldIndex, config.prompt);
  return { fieldId, passValue, failValue, strategy: passValue.note };
}

/** Source population for a PF rule so the AI has substantive material to act on. */
export async function synthesizeSourceFor(config, fieldIndex) {
  const fieldId = config.fieldId || "description";
  const v = await valueForField(fieldId, "source", fieldIndex, config.actionPrompt || config.prompt || "");
  return { fieldId, value: v };
}

// ---- issue seeding + reachability -----------------------------------------

const DISCO_LABEL = "cogtest-disco";

/** Find an existing disco-seeded issue in a project, or create a fresh one. */
export async function findOrSeedIssue(projectKey, issueTypeIds, summary = "CogniRunner discovery probe") {
  const existing = await searchJql(
    `project = "${projectKey}" AND labels = ${DISCO_LABEL} ORDER BY created DESC`,
    ["status", "summary"],
    5
  );
  if (existing.length) return { key: existing[0].key, seeded: false };

  // resolve a usable issue type
  let issueTypeId = (issueTypeIds || [])[0];
  if (!issueTypeId) {
    const meta = await get(`/rest/api/3/issue/createmeta?projectKeys=${projectKey}&expand=projects.issuetypes`);
    const proj = meta?.projects?.[0];
    const it = (proj?.issuetypes || []).find((t) => !t.subtask) || proj?.issuetypes?.[0];
    issueTypeId = it?.id;
  }
  if (!issueTypeId) throw new Error(`no issue type for project ${projectKey}`);

  const body = {
    fields: {
      project: { key: projectKey },
      issuetype: { id: String(issueTypeId) },
      summary,
      labels: [DISCO_LABEL],
      description: adfDoc(GOOD_REPORT_TEXT),
    },
  };
  const created = await post("/rest/api/3/issue", body);
  return { key: created.key, seeded: true };
}

/** Set fields on an issue (best-effort; returns the HTTP-ok boolean + error). */
export async function setFields(issueKey, fields) {
  try {
    await put(`/rest/api/3/issue/${issueKey}`, { fields });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message.slice(0, 200) };
  }
}

/**
 * Make a target transition available for the issue. GLOBAL transitions are
 * available anywhere. For DIRECTED, try ≤maxHops: at each hop, if the target is
 * available fire nothing and return true; else fire a transition whose
 * destination matches one of the rule's from-status names (lands us on the
 * from-status). Returns { reachable, hops }.
 */
export async function tryReach(issueKey, transitionId, fromStatusNames = [], maxHops = 3) {
  const wantFrom = new Set((fromStatusNames || []).map((n) => String(n).toLowerCase()));
  for (let hop = 0; hop <= maxHops; hop++) {
    const tr = await getTransitions(issueKey);
    const avail = tr.transitions || [];
    if (avail.some((t) => String(t.id) === String(transitionId))) return { reachable: true, hops: hop };
    // prefer a transition that lands us on the desired from-status
    let next = avail.find((t) => wantFrom.has(String(t.to?.name || "").toLowerCase()));
    // else, if the from-status is a common hub, try a transition NAMED like it
    if (!next) next = avail.find((t) => wantFrom.has(String(t.name || "").toLowerCase()));
    if (!next) return { reachable: false, hops: hop };
    const r = await doTransition(issueKey, next.id);
    if (r.status >= 400) return { reachable: false, hops: hop };
    await sleep(800);
  }
  return { reachable: false, hops: maxHops };
}

export { DISCO_LABEL };
