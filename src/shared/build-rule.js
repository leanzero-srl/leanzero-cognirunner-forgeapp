/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/*
 * NL-to-rule builder helpers — the prompt grounding AND the security/structure
 * boundary for the buildRule resolver. Both derive from the premade catalog
 * (single source), so a new rule needs no change here as long as it reuses a
 * known param type (the offline test asserts full param-type coverage).
 *
 * FRONTEND + BACKEND shared, dependency-free (imports only the dependency-free
 * catalog + clampNarrateLine). validateBuiltRule is the STRUCTURE boundary: AI
 * output is never trusted; only a real "available" catalog key and its declared
 * params, with every value coerced/clamped, survive. Field/picker VALUES are
 * resolved against client-mirrored allow-lists (same trust as the form's own
 * dropdowns) — buildRule only ever produces a REVIEWABLE DRAFT, never a write.
 */

import { getCatalog, findRule, COMPARE_OPS } from "./premade-rules-catalog.js";
import { clampNarrateLine } from "./narrate-utils.js";

// The param types this module knows how to prompt for and validate. The offline
// test asserts every "available" catalog rule uses only these — so an unhandled
// param type fails CI instead of silently under-handling a rule.
export const KNOWN_PARAM_TYPES = ["field", "opValue", "regex", "allowed", "value", "lengthBounds", "dateRel", "picker", "text"];

// One compact prompt line per AVAILABLE rule (the unavailable ones — e.g.
// user-in-role — are filtered out so the AI can never pick them).
export const buildCatalogPromptBlock = (mode) => {
  const rules = getCatalog(mode).filter((r) => r.availability === "available");
  return rules.map((r) => {
    const p = r.params || {};
    const hints = [];
    if (p.field) hints.push('"field" (a field name from the provided list)');
    if (p.opValue) hints.push(`"op" (one of: ${COMPARE_OPS.map((o) => o.value).join(", ")}), "compareValue"`);
    if (p.regex) hints.push('"regex" (a valid regular expression)');
    if (p.allowed) hints.push('"allowedValues" (comma-separated list)');
    if (p.value) hints.push('"value"');
    if (p.lengthBounds) hints.push('"min" and/or "max" (non-negative integers)');
    if (p.dateRel) hints.push('"mode" ("future" or "within"), "days" (positive integer, only when "within")');
    if (p.picker) hints.push(`"${p.picker.key}" (a name from the provided ${p.picker.source} list)`);
    if (p.text) hints.push(`"${p.text.key}" (text)`);
    const params = hints.length ? hints.join("; ") : "no params";
    return `- ${r.key}: ${r.label} — ${r.help} PARAMS: ${params}`;
  }).join("\n");
};

const clampStr = (v, n) => (typeof v === "string" || typeof v === "number") ? String(v).trim().slice(0, n || 200) : "";
const toBoundInt = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 && n <= 100000 ? String(n) : null; };

// Validate + sanitize the model's output against the catalog. Returns
// { ok:false } for a hallucinated/unavailable ruleType (nothing is applied), or
// { ok:true, config, explanation, unresolved } where config is shaped for the
// PremadeRuleForm state setters (numerics as STRINGS to match string-typed state)
// and unresolved lists params the user must still fill in.
export const validateBuiltRule = (mode, aiOutput, ctx = {}) => {
  if (!aiOutput || typeof aiOutput !== "object") return { ok: false };
  const rule = findRule(mode === "condition" ? "condition" : "validator", String(aiOutput.ruleType || ""));
  if (!rule || rule.availability !== "available") return { ok: false };
  const p = rule.params || {};
  // Accept params nested under `params` OR flattened onto the output object.
  const raw = (aiOutput.params && typeof aiOutput.params === "object") ? aiOutput.params : aiOutput;
  const fields = Array.isArray(ctx.fields) ? ctx.fields : [];
  const lists = (ctx.lists && typeof ctx.lists === "object") ? ctx.lists : {};
  const built = { ruleType: rule.key };
  const unresolved = [];

  if (p.field) {
    const want = clampStr(raw.field ?? raw.fieldId ?? raw.fieldName, 120).toLowerCase();
    const match = fields.find((f) => String(f.id).toLowerCase() === want)
      || fields.find((f) => String(f.name).toLowerCase() === want);
    if (match) { built.fieldId = match.id; built.fieldName = match.name; }
    else unresolved.push("field");
  }
  if (p.opValue) {
    built.op = COMPARE_OPS.some((o) => o.value === raw.op) ? raw.op : "eq";
    built.compareValue = clampStr(raw.compareValue, 200);
    if (!built.compareValue) unresolved.push("compareValue");
  }
  if (p.regex) {
    const rx = clampStr(raw.regex, 500);
    let good = false;
    try { if (rx) { new RegExp(rx); good = true; } } catch (e) { good = false; }
    if (good) built.regex = rx; else unresolved.push("pattern");
  }
  if (p.allowed) {
    built.allowedValues = clampStr(raw.allowedValues ?? raw.allowed, 500);
    if (!built.allowedValues) unresolved.push("allowedValues");
  }
  if (p.value) {
    built.value = clampStr(raw.value, 200);
    if (!built.value) unresolved.push("value");
  }
  if (p.lengthBounds) {
    const mn = toBoundInt(raw.min);
    const mx = toBoundInt(raw.max);
    if (mn != null) built.min = mn;   // STRING (matches string-typed form state)
    if (mx != null) built.max = mx;
    if (mn == null && mx == null) unresolved.push("min/max");
  }
  if (p.dateRel) {
    built.dateMode = raw.mode === "within" ? "within" : "future";
    if (built.dateMode === "within") {
      const d = parseInt(raw.days, 10);
      if (Number.isFinite(d) && d > 0 && d <= 100000) built.days = String(d);
      else unresolved.push("days");
    }
  }
  if (p.picker) {
    const options = Array.isArray(lists[p.picker.source]) ? lists[p.picker.source] : [];
    const want = clampStr(raw[p.picker.key] ?? raw.picker, 120).toLowerCase();
    const match = options.find((o) => String(o && o.value).toLowerCase() === want && want);
    if (match) built.pickerValue = match.value;
    else if (!p.picker.optional) unresolved.push(p.picker.key);
  }
  if (p.text) {
    const key = p.text.key;
    const t = clampStr(raw[key], 200);
    if (t) built.textValue = t; else unresolved.push(key);
  }

  return { ok: true, config: built, explanation: clampNarrateLine(aiOutput.explanation, 240), unresolved };
};
