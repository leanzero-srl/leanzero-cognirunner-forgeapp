/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Offline unit test for shapeIssueActivity (src/index.js) — the pure log→glance shaper behind the
// jira:issueContext "CogniRunner on this issue" panel. fs+eval extraction (index.js has Forge deps
// that can't load offline). Covers: per-issue filter, field-VALUE exclusion (privacy), kind/decision/
// verdictOk mapping per rule type, cap, empty-key guard, reason clamp.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, "../../src/index.js"), "utf8");
const m = src.match(/export const shapeIssueActivity = \(rows, issueKey, cap = 20\) => \{[\s\S]*?\n\};/);
if (!m) { console.log("FAIL: could not extract shapeIssueActivity"); process.exit(1); }
// eslint-disable-next-line no-eval
const shapeIssueActivity = eval("(" + m[0].replace("export const shapeIssueActivity = ", "").replace(/;\s*$/, "") + ")");

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log("FAIL:", msg); } };

const rows = [
  { type: "validator", issueKey: "ABC-1", isValid: false, reason: "Description too short", ruleName: "Desc gate", fieldValue: "SECRET field content", ruleId: "r1", timestamp: "2026-07-13T10:00:00Z" },
  { type: "condition", issueKey: "ABC-1", isValid: true, reason: "Has a linked bug", ruleName: "Bug link cond", fieldValue: "more secret", timestamp: "2026-07-13T09:00:00Z" },
  { type: "postfunction-semantic", issueKey: "ABC-1", isValid: true, reason: 'Updated "Risk" field', ruleName: "Risk writer", timestamp: "2026-07-13T08:00:00Z" },
  { type: "postfunction-skipped", issueKey: "ABC-1", isValid: false, reason: "Duplicate delivery suppressed", moduleKey: "ai-static-post-function", timestamp: "2026-07-13T07:00:00Z" },
  { type: "validator", issueKey: "OTHER-9", isValid: true, reason: "different issue", ruleName: "Nope", timestamp: "2026-07-13T11:00:00Z" },
  { type: "validator", issueKey: "ABC-1", isValid: true, reason: "premade pass", premadeRuleType: "field-required", timestamp: "2026-07-13T06:00:00Z" },
];

// --- per-issue filter ---
const a = shapeIssueActivity(rows, "ABC-1");
ok(a.length === 5, `only ABC-1 rows returned (got ${a.length}, expected 5 — OTHER-9 excluded)`);
ok(!a.some((x) => x.label === "Nope"), "another issue's activity (OTHER-9) is filtered out");

// --- PRIVACY: raw field value is never in the shaped output ---
const serialized = JSON.stringify(a);
ok(!serialized.includes("SECRET field content") && !serialized.includes("more secret") && !("fieldValue" in a[0]),
  "raw field VALUE is excluded from the glance (no fieldValue key, no secret content)");

// --- kind + decision + verdictOk mapping ---
const val = a[0]; // validator, isValid:false
ok(val.kind === "validator" && val.decision === "Blocked" && val.verdictOk === false, "validator isValid:false → Blocked / verdictOk false");
const cond = a[1]; // condition, isValid:true
ok(cond.kind === "condition" && cond.decision === "Transition shown" && cond.verdictOk === true, "condition isValid:true → Transition shown / verdictOk true");
const pf = a[2]; // postfunction-semantic, isValid:true
ok(pf.kind === "post-function" && pf.decision === "Ran" && pf.verdictOk === true, "postfunction isValid:true → Ran");
const skip = a[3]; // skipped
ok(skip.kind === "skipped" && skip.decision === "Skipped" && skip.verdictOk === false, "postfunction-skipped → Skipped / verdictOk false");
const premade = a[4]; // validator premade, no ruleName
ok(premade.label === "Premade check: field-required", "premade row with no ruleName labels by premadeRuleType");

// --- reason clamp (400) ---
const long = shapeIssueActivity([{ type: "validator", issueKey: "X-1", isValid: true, reason: "z".repeat(900) }], "X-1");
ok(long[0].reason.length === 400, "reason is clamped to 400 chars");

// --- guards ---
ok(shapeIssueActivity(rows, "").length === 0, "empty issueKey → []");
ok(shapeIssueActivity(null, "ABC-1").length === 0, "non-array rows → []");
ok(shapeIssueActivity(rows, "ABC-1", 2).length === 2, "cap limits the number of items");

console.log(`\nissue-activity: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
