/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/*
 * Rule portability — pure, dependency-free serialize / validate / match-by-value
 * re-bind for same-site rule export/import. Shared by the backend resolvers
 * (exportRules / previewImport / commitImport) and an offline round-trip test.
 * NO I/O here: the resolvers do all Jira/KVS reads and pass plain data in.
 *
 * Safety doctrine:
 *  - serialize is EMIT-ONLY (whitelist output keys). Anything not on RULE_EMIT_KEYS
 *    — actorAccountId, createdBy, endpoint auth headers, codeRef, workflow ids,
 *    source ids, audit/state — can NEVER leak, by construction.
 *  - validate treats the imported JSON as UNTRUSTED: schema/version/caps enforced,
 *    unknown keys dropped, strings clamped, regex compile-checked.
 *  - resolveBindings never GUESSES: a field/workflow/transition/picker that doesn't
 *    match by exact value is marked needs-rebind for the user to pick.
 */

export const SCHEMA_VERSION = 1;
export const EXPORT_KIND = "cognirunner-rules-export";

export const EXPORT_CAPS = {
  maxRules: 50,
  maxBytes: 1048576,          // 1 MB of import text
  maxSteps: 50,               // functions[] per static PF
  maxStepCodeBytes: 24576,    // per-step code (matches the offload step cap)
  maxPromptChars: 32768,      // whole-config editor cap
  maxStringChars: 8192,       // any other string field
  maxArrayItems: 200,
};

// EMIT-ONLY whitelist — the ONLY config keys ever serialized. Derived from the full
// runtime-read config surface (grep of config./configuration. reads). Deliberately
// EXCLUDES: actorAccountId, createdBy, createdAt, updatedAt, disabled, instanced, id,
// ruleId, ruleKey, codeRef, workflow (ids), parameters, headers (endpoint auth),
// projectKey — none of these belong in a portable, secret-free export.
export const RULE_EMIT_KEYS = [
  // identity / kind
  "type", "ruleKind", "ruleType", "premadeRuleType",
  // field bindings (id is a same-site hint; name+type drive match-by-value)
  "fieldId", "fieldName", "fieldType", "actionFieldId", "actionFieldName", "actionFieldType",
  // prompts
  "prompt", "conditionPrompt", "actionPrompt", "contentPrompt", "docTitlePrompt",
  "commentPrompt", "subtaskPrompt", "linkPrompt",
  // semantic / doc / research PF config
  "docFormat", "stylePreset", "attachComment", "crossCheckClaims", "autoSelectResearchDoc",
  "researchQuery", "researchTitle", "researchSources", "alsoSaveToLibrary", "libraryName", "maxLinks",
  // premade params (already name-valued — match-by-value friendly)
  "op", "compareValue", "allowedValues", "min", "max", "minLen", "days", "regex", "value",
  "mode", "errorMessage", "issueTypeName", "statusName", "resolutionName", "priorityName",
  "linkTypeName", "groupName", "name",
  // behaviour flags
  "enableTools", "simulationMode", "runAsync", "stateful", "parallel", "suppressNotifications",
  // semantic-PF endpoint URL (headers EXCLUDED — may carry auth)
  "url",
];

const clampStr = (v, max) => (typeof v === "string" ? v.slice(0, max) : v);
const isPlain = (v) => v && typeof v === "object" && !Array.isArray(v);

// Serialize ONE rule to the portable shape. Input is plain data the resolver already
// assembled: { config, workflowContext, fieldMeta, docNames, functions }. Emit-only.
export const serializeRule = (input) => {
  const cfg = isPlain(input && input.config) ? input.config : {};
  const out = {};
  for (const k of RULE_EMIT_KEYS) {
    if (cfg[k] === undefined || cfg[k] === null) continue;
    if (k === "functions") continue; // handled below (inlined, offload-free)
    let v = cfg[k];
    if (typeof v === "string") v = clampStr(v, k === "prompt" || k.endsWith("Prompt") ? EXPORT_CAPS.maxPromptChars : EXPORT_CAPS.maxStringChars);
    if (Array.isArray(v)) v = v.slice(0, EXPORT_CAPS.maxArrayItems);
    out[k] = v;
  }
  // By-NAME workflow context (never numeric ids / site url).
  const wc = isPlain(input && input.workflowContext) ? input.workflowContext : {};
  out.workflowName = clampStr(wc.workflowName || "", EXPORT_CAPS.maxStringChars) || undefined;
  out.transitionFromName = clampStr(wc.transitionFromName || "", EXPORT_CAPS.maxStringChars) || undefined;
  out.transitionToName = clampStr(wc.transitionToName || "", EXPORT_CAPS.maxStringChars) || undefined;
  // Field re-bind hints: keep the id as a same-site fast-path, plus name+type for match.
  const fm = isPlain(input && input.fieldMeta) ? input.fieldMeta : {};
  if (fm.fieldName) out.fieldName = clampStr(fm.fieldName, EXPORT_CAPS.maxStringChars);
  if (fm.fieldType) out.fieldType = clampStr(fm.fieldType, EXPORT_CAPS.maxStringChars);
  if (fm.actionFieldName) out.actionFieldName = clampStr(fm.actionFieldName, EXPORT_CAPS.maxStringChars);
  if (fm.actionFieldType) out.actionFieldType = clampStr(fm.actionFieldType, EXPORT_CAPS.maxStringChars);
  // Knowledge as NAMES (instance-local ids don't travel).
  if (Array.isArray(input && input.docNames)) out.docNames = input.docNames.slice(0, EXPORT_CAPS.maxArrayItems).map((s) => clampStr(String(s), 300));
  // Static-PF steps: inlined, offload-free.
  const fns = Array.isArray(input && input.functions) ? input.functions : (Array.isArray(cfg.functions) ? cfg.functions : null);
  if (fns) {
    out.functions = fns.slice(0, EXPORT_CAPS.maxSteps).map((f) => {
      const step = {};
      if (f && typeof f.name === "string") step.name = clampStr(f.name, 300);
      if (f && typeof f.operationType === "string") step.operationType = clampStr(f.operationType, 120);
      if (f && typeof f.variableName === "string") step.variableName = clampStr(f.variableName, 120);
      if (f && typeof f.code === "string") step.code = f.code.slice(0, EXPORT_CAPS.maxStepCodeBytes);
      if (f && typeof f.description === "string") step.description = clampStr(f.description, EXPORT_CAPS.maxStringChars);
      if (Array.isArray(f && f.docNames)) step.docNames = f.docNames.slice(0, EXPORT_CAPS.maxArrayItems).map((s) => clampStr(String(s), 300));
      if (Array.isArray(f && f.skillNames)) step.skillNames = f.skillNames.slice(0, EXPORT_CAPS.maxArrayItems);
      return step;
    });
  }
  // selectedDocIds / actorAccountId / codeRef / workflow / ids intentionally NOT emitted.
  return out;
};

// Build the full export envelope from an array of serialized rules.
export const buildExportEnvelope = (rules, meta = {}) => ({
  schemaVersion: SCHEMA_VERSION,
  app: "CogniRunner",
  kind: EXPORT_KIND,
  appVersion: clampStr(meta.appVersion || "", 40) || undefined,
  exportedAt: clampStr(meta.exportedAt || "", 40) || undefined, // resolver stamps this (no Date in pure code)
  ruleCount: Array.isArray(rules) ? rules.length : 0,
  rules: Array.isArray(rules) ? rules.slice(0, EXPORT_CAPS.maxRules) : [],
});

// Assert an export/import object carries NO secret/PII/id-shaped keys anywhere. Used
// by the test and defensively by the resolver before returning an export.
export const containsSecretKey = (obj) => {
  const bad = /(accountId|apiKey|api_key|secret|token|password|bearer|codeRef|createdBy)/i;
  let found = false;
  const walk = (v) => {
    if (found || v == null) return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (typeof v === "object") {
      for (const k of Object.keys(v)) { if (bad.test(k)) { found = true; return; } walk(v[k]); }
    }
  };
  walk(obj);
  return found;
};

// Validate an UNTRUSTED parsed import object. Returns { ok, error?, rules? } where
// rules are shape-checked + clamped (unknown keys dropped). Never throws.
export const validateImportSchema = (parsed) => {
  try {
    if (!isPlain(parsed)) return { ok: false, error: "Not a rules export object." };
    if (parsed.kind !== EXPORT_KIND) return { ok: false, error: "Unrecognized file (missing CogniRunner export marker)." };
    if (parsed.schemaVersion !== SCHEMA_VERSION) return { ok: false, error: `Unsupported schema version ${parsed.schemaVersion} (expected ${SCHEMA_VERSION}).` };
    if (!Array.isArray(parsed.rules)) return { ok: false, error: "Export has no rules array." };
    if (parsed.rules.length === 0) return { ok: false, error: "Export contains no rules." };
    if (parsed.rules.length > EXPORT_CAPS.maxRules) return { ok: false, error: `Too many rules (${parsed.rules.length} > ${EXPORT_CAPS.maxRules}).` };
    const allow = new Set([...RULE_EMIT_KEYS, "workflowName", "transitionFromName", "transitionToName", "docNames", "functions"]);
    const rules = [];
    for (const raw of parsed.rules) {
      if (!isPlain(raw)) return { ok: false, error: "A rule entry is not an object." };
      if (typeof raw.type !== "string" || !raw.type) return { ok: false, error: "A rule is missing its type." };
      const rule = {};
      for (const k of Object.keys(raw)) {
        if (!allow.has(k)) continue; // drop unknown/untrusted keys
        let v = raw[k];
        if (typeof v === "string") v = v.slice(0, k === "prompt" || k.endsWith("Prompt") ? EXPORT_CAPS.maxPromptChars : EXPORT_CAPS.maxStringChars);
        if (k === "regex" && typeof v === "string") { try { new RegExp(v); } catch (e) { return { ok: false, error: `Rule "${raw.name || raw.type}" has an invalid regex.` }; } }
        if (k === "functions") {
          if (!Array.isArray(v)) continue;
          if (v.length > EXPORT_CAPS.maxSteps) return { ok: false, error: "A rule has too many steps." };
          v = v.map((f) => {
            const step = {};
            if (isPlain(f)) {
              if (typeof f.name === "string") step.name = f.name.slice(0, 300);
              if (typeof f.operationType === "string") step.operationType = f.operationType.slice(0, 120);
              if (typeof f.variableName === "string") step.variableName = f.variableName.slice(0, 120);
              if (typeof f.code === "string") step.code = f.code.slice(0, EXPORT_CAPS.maxStepCodeBytes);
              if (typeof f.description === "string") step.description = f.description.slice(0, EXPORT_CAPS.maxStringChars);
              if (Array.isArray(f.docNames)) step.docNames = f.docNames.slice(0, EXPORT_CAPS.maxArrayItems).map((s) => String(s).slice(0, 300));
              if (Array.isArray(f.skillNames)) step.skillNames = f.skillNames.slice(0, EXPORT_CAPS.maxArrayItems);
            }
            return step;
          });
        }
        if (Array.isArray(v)) v = v.slice(0, EXPORT_CAPS.maxArrayItems);
        rule[k] = v;
      }
      rules.push(rule);
    }
    return { ok: true, rules };
  } catch (e) {
    return { ok: false, error: "Malformed export: " + String(e && e.message || e) };
  }
};

// Match-by-value re-bind for ONE field. NEVER guesses. maps: [{id,name,type}].
// Returns { status: "ready"|"needs-rebind", fieldId?, reason? }.
export const resolveField = (rule, sourceIdKey, nameKey, typeKey, fields) => {
  const list = Array.isArray(fields) ? fields : [];
  const wantName = typeof rule[nameKey] === "string" ? rule[nameKey].trim().toLowerCase() : "";
  const wantType = typeof rule[typeKey] === "string" ? rule[typeKey] : "";
  const wantId = typeof rule[sourceIdKey] === "string" ? rule[sourceIdKey] : "";
  if (!wantName && !wantId) return { status: "ready" }; // rule has no field binding (e.g. some PFs)
  // Fast-path: the source id still exists AND its name matches (stable system fields, same-site).
  if (wantId) {
    const byId = list.find((f) => f.id === wantId);
    if (byId && (!wantName || String(byId.name || "").trim().toLowerCase() === wantName)) return { status: "ready", fieldId: byId.id };
  }
  // Match by EXACT case-insensitive name (+ type when present). Ambiguity → needs-rebind.
  const byName = list.filter((f) => String(f.name || "").trim().toLowerCase() === wantName
    && (!wantType || !f.type || String(f.type) === wantType));
  if (byName.length === 1) return { status: "ready", fieldId: byName[0].id };
  if (byName.length > 1) return { status: "needs-rebind", reason: `Field "${rule[nameKey]}" is ambiguous on this site (${byName.length} matches) — pick one.` };
  return { status: "needs-rebind", reason: `Field "${rule[nameKey] || rule[sourceIdKey]}" not found on this site — pick a target field.` };
};

// Compute a per-rule import plan row against the target-site maps.
// maps: { fields:[{id,name,type}], docNamesToId:{name:id} }.
export const resolveBindings = (rule, maps) => {
  const m = isPlain(maps) ? maps : {};
  const unresolved = [];
  const notes = [];
  const plan = { type: rule.type, ruleName: rule.name || rule.premadeRuleType || rule.type, status: "ready" };
  // primary field
  const f = resolveField(rule, "fieldId", "fieldName", "fieldType", m.fields);
  if (f.status === "ready") { if (f.fieldId) plan.fieldId = f.fieldId; } else { unresolved.push("field"); notes.push(f.reason); }
  // action field (semantic PF target)
  if (rule.actionFieldId || rule.actionFieldName) {
    // Use the ACTION field's own type (not the source field's) — matching the target
    // by the source type wrongly rejects a present typed field (e.g. read text → write
    // user-picker). Old exports lack actionFieldType → falls back to name-only match.
    const af = resolveField(rule, "actionFieldId", "actionFieldName", "actionFieldType", m.fields);
    if (af.status === "ready") { if (af.fieldId) plan.actionFieldId = af.fieldId; } else { unresolved.push("target field"); notes.push(af.reason); }
  }
  // docs by name (dangling names are dropped with a note, never fail the rule)
  if (Array.isArray(rule.docNames) && rule.docNames.length) {
    const map = isPlain(m.docNamesToId) ? m.docNamesToId : {};
    const resolved = []; const dropped = [];
    for (const n of rule.docNames) { const id = map[n] || map[String(n).toLowerCase()]; if (id) resolved.push(id); else dropped.push(n); }
    if (resolved.length) plan.selectedDocIds = resolved;
    if (dropped.length) notes.push(`${dropped.length} attached doc(s) not on this site — dropped: ${dropped.slice(0, 3).join(", ")}`);
  }
  if (unresolved.length) { plan.status = "needs-rebind"; plan.unresolved = unresolved; }
  plan.notes = notes;
  return plan;
};
