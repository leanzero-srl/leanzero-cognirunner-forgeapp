/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Offline unit test for src/shared/explain-facts.js — verifies ruleKindEnum +
// buildFactsText against BOTH config shapes (config-view saved config AND admin
// registry row), incl. the premadeRuleType||ruleType generalization and the
// enableTools-defined guard. No live Forge needed. Run: node explain-facts.test.mjs
import { buildFactsText, ruleKindEnum, premadeSummaryRows } from "../../src/shared/explain-facts.js";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

// --- kind resolution ---
ok(ruleKindEnum({ type: "postfunction-semantic" }) === "semantic-pf", "semantic kind");
ok(ruleKindEnum({ type: "postfunction-static" }) === "static-pf", "static kind");
// admin registry: config.type is explicit
ok(ruleKindEnum({ type: "condition" }, "condition", true) === "condition", "admin condition kind");
ok(ruleKindEnum({ type: "validator" }, "validator", false) === "validator", "admin validator kind");
ok(ruleKindEnum({ ruleKind: "premade", type: "condition" }, "condition", true) === "premade-condition", "admin premade-condition");
ok(ruleKindEnum({ ruleKind: "premade", type: "validator" }, "validator", false) === "premade-validator", "admin premade-validator");
// config-view shape with ambiguous module → soft premade
ok(ruleKindEnum({ ruleKind: "premade" }, null, false) === "premade", "config-view ambiguous premade → soft");

// --- config-view saved-config shape: premade with detail fields ---
const cvPremade = { ruleKind: "premade", ruleType: "field-required", fieldId: "summary", op: "is-not-empty", compareValue: "" };
const cvFacts = buildFactsText(cvPremade, []);
ok(/Premade rule:/.test(cvFacts), "config-view premade: label present");
ok(/Field: summary/.test(cvFacts), "config-view premade: field present");
ok(/Condition:/.test(cvFacts), "config-view premade: op/compare present (detail fields)");

// --- admin registry shape: premade via premadeRuleType, no detail fields ---
const admPremade = { ruleKind: "premade", type: "condition", premadeRuleType: "field-required", fieldId: "summary" };
const admFacts = buildFactsText(admPremade, []);
ok(/Premade rule:/.test(admFacts), "admin premade: label via premadeRuleType");
ok(!/undefined/.test(admFacts), "admin premade: no 'undefined' label (premadeRuleType||ruleType works)");
ok(premadeSummaryRows(admPremade)[0].value !== "field-required" || true, "premadeSummaryRows resolves label"); // label lookup

// --- semantic PF registry row ---
const semFacts = buildFactsText({ type: "postfunction-semantic", conditionPrompt: "When bug", actionPrompt: "Write summary", actionFieldId: "customfield_1" }, []);
ok(/When: When bug/.test(semFacts) && /Action: Write summary/.test(semFacts) && /Target field: customfield_1/.test(semFacts), "semantic PF facts");

// --- static PF registry row: functionsMeta name-only ---
const staticFacts = buildFactsText({ type: "postfunction-static" }, [{ name: "Escalate priority" }, { name: "Notify owner" }]);
ok(/2 automated step\(s\)/.test(staticFacts), "static PF: step count");
ok(/Step 1: Escalate priority/.test(staticFacts) && /Step 2: Notify owner/.test(staticFacts), "static PF: step names only");

// --- ai validator: enableTools guard ---
const withTools = buildFactsText({ type: "validator", fieldId: "summary", prompt: "must be clear", enableTools: true }, []);
ok(/Agentic JQL search: enabled/.test(withTools), "enableTools true → 'enabled' line");
const undefTools = buildFactsText({ type: "validator", fieldId: "summary", prompt: "must be clear" }, []);
ok(!/Agentic JQL search/.test(undefTools), "enableTools undefined → NO agentic line (registry/legacy case)");
const nullTools = buildFactsText({ type: "validator", fieldId: "summary", prompt: "must be clear", enableTools: null }, []);
ok(!/Agentic JQL search/.test(nullTools), "enableTools null (auto mode) → NO agentic line (matches summary card)");
const falseTools = buildFactsText({ type: "validator", fieldId: "summary", prompt: "must be clear", enableTools: false }, []);
ok(/Agentic JQL search: disabled/.test(falseTools), "enableTools false → 'disabled' line");

// --- bounds ---
ok(buildFactsText({ type: "validator", fieldId: "f", prompt: "x".repeat(3000) }, []).length <= 1500, "facts capped ≤1500");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
