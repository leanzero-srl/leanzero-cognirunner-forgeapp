/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Offline round-trip test for src/shared/rule-portability.js. Encodes the critique's
// load-bearing guarantees: emit-only (no secret/PII), key fields survive, unknown keys
// dropped, malformed/oversized rejected, match-by-value never guesses. Run: node this.
import {
  serializeRule, buildExportEnvelope, validateImportSchema, resolveBindings, resolveField,
  containsSecretKey, EXPORT_CAPS, SCHEMA_VERSION, EXPORT_KIND,
} from "../../src/shared/rule-portability.js";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

// A realistic full config carrying secrets/PII that MUST NOT be exported.
const fullConfig = {
  id: "cr::Dev WF::21::abc123", type: "postfunction-semantic", ruleKind: "ai",
  fieldId: "customfield_10042", prompt: "Summarize the risk.", actionPrompt: "Set Risk Level.",
  actionFieldId: "customfield_10099", simulationMode: false, enableTools: true,
  crossCheckClaims: true, op: "gte", min: "3", allowedValues: ["High", "Low"],
  issueTypeName: "Bug", statusName: "Done",
  // secrets / PII / instance-local — must be stripped:
  actorAccountId: "557058:abc-def", createdBy: "557058:abc-def", createdAt: "2026-01-01",
  updatedAt: "2026-02-01", disabled: false, codeRef: "pf_code:cr::x:hash",
  workflow: { workflowId: "wf-1", transitionId: "21", siteUrl: "https://x.atlassian.net" },
  headers: { Authorization: "Bearer sk-secret-123" },
  selectedDocIds: ["doc_1", "doc_2"],
  functions: [{ name: "Step 1", operationType: "rest_api_internal", variableName: "r1",
    code: "await api.addComment(api.context.issueKey, 'hi');", docNames: ["Jira Field Reference"] }],
};
const input = {
  config: fullConfig,
  workflowContext: { workflowName: "Dev WF", transitionFromName: "In Progress", transitionToName: "In Review" },
  fieldMeta: { fieldName: "Summary", fieldType: "string", actionFieldName: "Risk Level" },
  docNames: ["Jira Field Reference"],
  functions: fullConfig.functions,
};

const serialized = serializeRule(input);
const envelope = buildExportEnvelope([serialized], { appVersion: "1.0.0", exportedAt: "2026-07-08T00:00:00Z" });

// --- EMIT-ONLY: no secret / PII / id-shaped key anywhere ---
ok(!containsSecretKey(envelope), "export contains NO secret/PII/id-shaped key");
ok(serialized.actorAccountId === undefined, "actorAccountId stripped");
ok(serialized.createdBy === undefined, "createdBy stripped");
ok(serialized.headers === undefined, "endpoint auth headers stripped");
ok(serialized.codeRef === undefined, "codeRef stripped");
ok(serialized.workflow === undefined, "workflow(ids) stripped");
ok(serialized.id === undefined, "source id stripped");
ok(serialized.selectedDocIds === undefined, "instance-local doc ids stripped (names emitted instead)");

// --- key rule-defining fields SURVIVE (the BLOCKER: silent field loss) ---
for (const k of ["type", "prompt", "actionPrompt", "op", "min", "issueTypeName", "statusName", "enableTools", "crossCheckClaims"]) {
  ok(serialized[k] !== undefined, `field "${k}" survives export`);
}
ok(Array.isArray(serialized.allowedValues) && serialized.allowedValues.length === 2, "allowedValues array survives");
ok(serialized.workflowName === "Dev WF" && serialized.transitionToName === "In Review", "by-name workflow context emitted");
ok(serialized.fieldName === "Summary", "fieldName (for re-bind) emitted");
ok(Array.isArray(serialized.docNames) && serialized.docNames[0] === "Jira Field Reference", "doc NAMES emitted");
ok(serialized.functions[0].code.includes("api.addComment"), "static-PF code inlined");

// --- round-trip: validate the envelope's rules ---
const v = validateImportSchema(envelope);
ok(v.ok && v.rules.length === 1, "envelope validates");
ok(v.rules[0].prompt === "Summarize the risk.", "prompt round-trips through validate");

// --- validate rejects malformed / hostile input ---
ok(!validateImportSchema(null).ok, "null rejected");
ok(!validateImportSchema({}).ok, "empty object rejected (no kind)");
ok(!validateImportSchema({ kind: EXPORT_KIND, schemaVersion: 99, rules: [] }).ok, "wrong version rejected");
ok(!validateImportSchema({ kind: EXPORT_KIND, schemaVersion: SCHEMA_VERSION, rules: [] }).ok, "zero rules rejected");
ok(!validateImportSchema({ kind: "other", schemaVersion: 1, rules: [{ type: "x" }] }).ok, "wrong kind rejected");
const tooMany = { kind: EXPORT_KIND, schemaVersion: 1, rules: Array.from({ length: 60 }, () => ({ type: "validator" })) };
ok(!validateImportSchema(tooMany).ok, "too many rules rejected");
const badRegex = { kind: EXPORT_KIND, schemaVersion: 1, rules: [{ type: "validator", regex: "([" }] };
ok(!validateImportSchema(badRegex).ok, "invalid regex rejected");

// --- unknown/untrusted keys dropped on import ---
const hostile = { kind: EXPORT_KIND, schemaVersion: 1, rules: [{ type: "validator", prompt: "ok", actorAccountId: "x", __proto__evil: 1, arbitraryKey: "drop me" }] };
const hv = validateImportSchema(hostile);
ok(hv.ok && hv.rules[0].actorAccountId === undefined && hv.rules[0].arbitraryKey === undefined, "unknown/untrusted keys dropped on import");
ok(hv.rules[0].prompt === "ok", "legit key kept");

// --- match-by-value: never guesses ---
const fields = [{ id: "customfield_10042", name: "Summary", type: "string" }, { id: "customfield_20000", name: "Risk Level", type: "string" }];
const readyPlan = resolveBindings({ type: "postfunction-semantic", fieldName: "Summary", fieldType: "string", actionFieldName: "Risk Level" }, { fields });
ok(readyPlan.status === "ready" && readyPlan.fieldId === "customfield_10042", "exact name+type match → ready + resolved id");
const missPlan = resolveBindings({ type: "validator", fieldName: "Nonexistent Field" }, { fields });
ok(missPlan.status === "needs-rebind", "unknown field → needs-rebind, never guessed");
// Action field matches by its OWN type, not the source field's (read text → write user-picker).
const typedFields = [{ id: "cf_sum", name: "Summary", type: "string" }, { id: "cf_rev", name: "Reviewer", type: "user" }];
const actionPlan = resolveBindings({ type: "postfunction-semantic", fieldName: "Summary", fieldType: "string", actionFieldName: "Reviewer", actionFieldType: "user" }, { fields: typedFields });
ok(actionPlan.status === "ready" && actionPlan.actionFieldId === "cf_rev", "action field matched by its own type (user), not the source type (string)");
const dupFields = [{ id: "cf_1", name: "Owner", type: "string" }, { id: "cf_2", name: "Owner", type: "string" }];
const ambigPlan = resolveBindings({ type: "validator", fieldName: "Owner" }, { fields: dupFields });
ok(ambigPlan.status === "needs-rebind", "ambiguous (2 same-name) → needs-rebind, never guessed");
// fast-path: source id still present + name matches
const fp = resolveField({ fieldId: "customfield_10042", fieldName: "Summary" }, "fieldId", "fieldName", "fieldType", fields);
ok(fp.status === "ready" && fp.fieldId === "customfield_10042", "fast-path id+name match → ready");
// same id but name changed on the target → do NOT trust the stale id
const drift = resolveField({ fieldId: "customfield_10042", fieldName: "Totally Different" }, "fieldId", "fieldName", "fieldType", fields);
ok(drift.status === "needs-rebind", "id present but name drifted → needs-rebind (no stale bind)");
// dangling doc name dropped with a note, rule stays importable
const docPlan = resolveBindings({ type: "validator", fieldName: "Summary", docNames: ["Jira Field Reference", "Gone"] }, { fields, docNamesToId: { "Jira Field Reference": "doc_9" } });
ok(docPlan.status === "ready" && docPlan.selectedDocIds.length === 1 && docPlan.notes.some((n) => /dropped/.test(n)), "dangling doc name dropped with note; rule stays ready");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
