/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Offline unit test for the ReDoS (catastrophic-backtracking) defense (audit defect #2).
// Proves: (1) redosRisk() flags nested-unbounded-quantifier patterns + passes safe ones with no
// false positives; (2) build-rule.js leaves a ReDoS pattern UNRESOLVED (AI codegen path); (3) the
// premade field-regex executor FAILS OPEN on a ReDoS pattern WITHOUT running it (no hang). Run:
//   node test-harness/scripts/regex-safety.test.mjs
import { redosRisk } from "../../src/shared/regex-safety.js";
import { validateBuiltRule } from "../../src/shared/build-rule.js";
import { executePremadeRule } from "../../src/premade-rules.js";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

// --- (1) heuristic: known-bad flagged, known-good passed ---
const BAD = ["^(a+)+$", "(a*)*", "(a+)*", "(x+x+)+y", "^(\\w+\\s?)+$", "(\\d+)+", "([a-z]+)*", "(.*)+", "(a{2,})+", "((a)+)+", "(a+){2,}"];
const GOOD = ["^[A-Z]{2,4}-\\d+$", "\\d{4}-\\d{2}-\\d{2}", "^https?://", "^(cat|dog|bird)$", "[a-z]+@[a-z]+\\.[a-z]+", "^\\w+$", "(ab)+", "a{2,5}", "(foo)*bar", "(a+){2,5}", "(a|b)+", "(https?)+", "^\\d+$", ""];
for (const p of BAD) ok(!!redosRisk(p), `redosRisk flags ${JSON.stringify(p)}`);
for (const p of GOOD) ok(!redosRisk(p), `redosRisk passes ${JSON.stringify(p)}`);

// --- (2) build-rule.js leaves a ReDoS regex unresolved (AI path) ---
const badBuilt = validateBuiltRule("validator", { ruleType: "field-regex", params: { field: "Summary", regex: "^(a+)+$" } }, { fields: [{ id: "summary", name: "Summary" }] });
ok(badBuilt.ok === true && (badBuilt.unresolved || []).includes("pattern") && badBuilt.config.regex === undefined, "build-rule leaves a ReDoS regex UNRESOLVED (not persisted)");
const goodBuilt = validateBuiltRule("validator", { ruleType: "field-regex", params: { field: "Summary", regex: "^[A-Z]+$" } }, { fields: [{ id: "summary", name: "Summary" }] });
ok(goodBuilt.ok === true && goodBuilt.config.regex === "^[A-Z]+$", "build-rule keeps a safe regex");

// --- (3) executor fails OPEN on a ReDoS pattern WITHOUT running it (must be fast, not hang) ---
const evil = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!"; // would be catastrophic for ^(a+)+$
const t0 = Date.now();
const out = await executePremadeRule(
  { ruleType: "field-regex", premadeRuleType: "field-regex", ruleKind: "premade", fieldId: "customfield_10280", regex: "^(a+)+$", errorMessage: "no" },
  { issue: { key: "T-1" }, modifiedFields: { customfield_10280: evil } },
  "validator",
);
const ms = Date.now() - t0;
ok(out.result === true, "ReDoS field-regex FAILS OPEN (result:true)");
ok(ms < 500, `executor returned fast (${ms}ms) — the dangerous regex never ran`);
// sanity: a SAFE regex still enforces (blocks a non-match)
const enf = await executePremadeRule(
  { ruleType: "field-regex", premadeRuleType: "field-regex", ruleKind: "premade", fieldId: "customfield_10280", regex: "^[0-9]+$", errorMessage: "digits only" },
  { issue: { key: "T-2" }, modifiedFields: { customfield_10280: "abc" } },
  "validator",
);
ok(enf.result === false, "safe regex still ENFORCES (blocks a non-match)");

console.log(`\nregex-safety: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
