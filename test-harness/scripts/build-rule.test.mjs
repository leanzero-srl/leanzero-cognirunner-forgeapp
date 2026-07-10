/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Offline unit test for src/shared/build-rule.js — the NL-to-rule STRUCTURE boundary.
// Proves the validator rejects hallucinations, strips undeclared params, coerces/
// clamps values, and (coverage assertion) that build-rule.js handles EVERY param
// type the catalog actually uses. No live Forge. Run: node build-rule.test.mjs
// NOTE: this verifies the SANITIZER only — that a real provider maps a description
// to a mappable key is a live-AI-quality claim, gated on a live smoke.
import { buildCatalogPromptBlock, validateBuiltRule, KNOWN_PARAM_TYPES } from "../../src/shared/build-rule.js";
import { PREMADE_VALIDATORS, PREMADE_CONDITIONS } from "../../src/shared/premade-rules-catalog.js";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const FIELDS = [{ id: "summary", name: "Summary" }, { id: "customfield_10099", name: "Rollback Plan" }];
const LISTS = { issuetypes: [{ value: "Bug", label: "Bug" }, { value: "Task", label: "Task" }], statuses: [{ value: "Done", label: "Done" }] };

// --- rejection of hallucinated / unavailable keys ---
ok(validateBuiltRule("validator", { ruleType: "frobnicate" }).ok === false, "hallucinated ruleType → ok:false");
ok(validateBuiltRule("condition", { ruleType: "user-in-role" }).ok === false, "unavailable rule → ok:false");
ok(validateBuiltRule("validator", null).ok === false, "null aiOutput → ok:false");
ok(validateBuiltRule("validator", { ruleType: "" }).ok === false, "empty ruleType → ok:false");

// --- undeclared params stripped ---
const stripd = validateBuiltRule("validator", { ruleType: "field-required", params: { field: "Summary", allowedValues: "a,b,c", regex: ".*" } }, { fields: FIELDS });
ok(stripd.ok && stripd.config.ruleType === "field-required", "field-required accepted");
ok(stripd.config.allowedValues === undefined && stripd.config.regex === undefined, "undeclared params (allowedValues/regex) stripped from field-required");
ok(stripd.config.fieldId === "summary" && stripd.config.fieldName === "Summary", "field resolved by name → id");

// --- field resolution by id and by name, and drop-when-unresolved ---
ok(validateBuiltRule("validator", { ruleType: "field-required", field: "customfield_10099" }, { fields: FIELDS }).config.fieldId === "customfield_10099", "field resolved by id");
const noField = validateBuiltRule("validator", { ruleType: "field-required", field: "Nonexistent Field" }, { fields: FIELDS });
ok(noField.config.fieldId === undefined && noField.unresolved.includes("field"), "unresolvable field dropped + marked unresolved");

// --- op / bounds / date coercion (numerics returned as STRINGS to match form state) ---
ok(validateBuiltRule("validator", { ruleType: "field-comparison", field: "summary", op: "banana", compareValue: "5" }, { fields: FIELDS }).config.op === "eq", "bad op coerced to eq");
const bounds = validateBuiltRule("validator", { ruleType: "text-length", field: "summary", min: "5.9", max: 999999999 }, { fields: FIELDS });
ok(bounds.config.min === "5" && typeof bounds.config.min === "string", "min coerced to integer STRING '5'");
ok(bounds.config.max === undefined, "over-cap max dropped");
const dr = validateBuiltRule("validator", { ruleType: "date-relative", field: "summary", mode: "sideways", days: -3 }, { fields: FIELDS });
ok(dr.config.dateMode === "future", "invalid date mode → future");
ok(dr.config.days === undefined, "future mode has no days; negative days dropped");
const drWithin = validateBuiltRule("validator", { ruleType: "date-relative", field: "summary", mode: "within", days: "7" }, { fields: FIELDS });
ok(drWithin.config.dateMode === "within" && drWithin.config.days === "7", "within + positive days STRING '7'");

// --- regex compile-check: bad regex dropped + marked unresolved (never seeds a fail-open guard) ---
ok(validateBuiltRule("validator", { ruleType: "field-regex", field: "summary", regex: "^[A-Z]+$" }, { fields: FIELDS }).config.regex === "^[A-Z]+$", "valid regex kept");
const badrx = validateBuiltRule("validator", { ruleType: "field-regex", field: "summary", regex: "[unclosed(" }, { fields: FIELDS });
ok(badrx.config.regex === undefined && badrx.unresolved.includes("pattern"), "invalid regex dropped + marked unresolved");

// --- picker allow-list ---
ok(validateBuiltRule("condition", { ruleType: "issue-type-is", issueTypeName: "Bug" }, { lists: LISTS }).config.pickerValue === "Bug", "picker value in allow-list kept");
const badPick = validateBuiltRule("condition", { ruleType: "issue-type-is", issueTypeName: "Epic" }, { lists: LISTS });
ok(badPick.config.pickerValue === undefined && badPick.unresolved.includes("issueTypeName"), "picker value not in allow-list dropped + unresolved");

// --- explanation clamp (markdown/newlines stripped, one bounded sentence) ---
const expl = validateBuiltRule("validator", { ruleType: "field-required", field: "summary", explanation: "**Requires** the field.\n- extra" }, { fields: FIELDS });
ok(!/[*_`#]/.test(expl.explanation) && expl.explanation.length <= 240, "explanation markdown-stripped + clamped");

// --- parse boundary: a raw JSON STRING (as a provider returns) parsed then validated ---
const rawJson = '{"ruleType":"field-required","field":"Summary","explanation":"Requires Summary."}';
const parsed = JSON.parse(rawJson);
ok(validateBuiltRule("validator", parsed, { fields: FIELDS }).config.fieldId === "summary", "parsed-from-string output validates correctly");

// --- COVERAGE: every available rule uses only KNOWN param types, and the prompt block lists it ---
for (const mode of ["validator", "condition"]) {
  const block = buildCatalogPromptBlock(mode);
  const rules = (mode === "validator" ? PREMADE_VALIDATORS : PREMADE_CONDITIONS).filter((r) => r.availability === "available");
  for (const r of rules) {
    ok(block.includes(r.key), `prompt block lists ${r.key}`);
    for (const ptype of Object.keys(r.params || {})) {
      ok(KNOWN_PARAM_TYPES.includes(ptype), `param type "${ptype}" (on ${r.key}) is handled by build-rule.js`);
    }
  }
  ok(!block.includes("user-in-role"), `${mode} prompt block excludes the unavailable user-in-role`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
