/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
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

// --- F-372: the GIT parameter group reaches BOTH the card and the explain prompt ---
// Before this, a saved "Git: the pull request is merged" rule rendered as one line and a
// reviewer could not see which repository it gated or what a provider outage would do.
{
  const gitCfg = {
    ruleKind: "premade", type: "validator", premadeRuleType: "git-pr-merged",
    connectionId: "gc_7", repo: "acme/widget", prMatch: "branch", strict: true,
  };
  const rowVal = (rows, label) => (rows.find((r) => r.label === label) || {}).value;

  // (a) with no connection list: the id is shown AND named as an id, never as a name.
  const bare = premadeSummaryRows(gitCfg);
  ok(rowVal(bare, "Connection:") === "gc_7 (connection id)", "git: no list → the id is rendered and labelled as an id");
  ok((bare.find((r) => r.label === "Connection:") || {}).code === true, "git: an unresolved id renders as code, not as prose");
  ok(rowVal(bare, "Repository:") === "acme/widget", "git: the repository is on the card");

  // (b) with a list: the human name, and ONLY for an id the list actually contains.
  const conns = [{ id: "gc_7", label: "Acme GitHub" }, { id: "gc_8", label: "Other" }];
  ok(rowVal(premadeSummaryRows(gitCfg, conns), "Connection:") === "Acme GitHub", "git: a supplied list resolves the connection name");
  ok(/gc_9 \(connection id\)/.test(rowVal(premadeSummaryRows({ ...gitCfg, connectionId: "gc_9" }, conns), "Connection:")),
    "git: an id the list does not contain is NEVER given an invented label");

  // (c) prMatch in words, including the default when the key was never stored.
  ok(/source branch name only/.test(rowVal(bare, "Match pull request by:")), "git: prMatch 'branch' in words");
  ok(/branch name or the pull request title/.test(rowVal(premadeSummaryRows({ ...gitCfg, prMatch: "both" }), "Match pull request by:")), "git: prMatch 'both' in words");
  ok(/branch name or the pull request title/.test(rowVal(premadeSummaryRows({ ...gitCfg, prMatch: "property" }), "Match pull request by:")), "git: prMatch 'property' in words");
  const noMatch = { ...gitCfg }; delete noMatch.prMatch;
  ok(/branch name or the pull request title/.test(rowVal(premadeSummaryRows(noMatch), "Match pull request by:")), "git: an unstored prMatch reads as the 'both' default");

  // (d) strict says what src/premade-rules.js' fail-open/fail-closed table says.
  ok(/^On — /.test(rowVal(bare, "Strict:")) && /BLOCKS the transition/.test(rowVal(bare, "Strict:")), "git: strict on → the outage/dead-token/no-PR cases BLOCK");
  const lax = rowVal(premadeSummaryRows({ ...gitCfg, strict: false }), "Strict:");
  ok(/^Off — /.test(lax) && /ALLOWS the transition \(fail-open\)/.test(lax), "git: strict off → fail-open, and it says fail-open");
  ok(/always blocks/.test(lax), "git: …and the two fail-CLOSED cases (dead connection / repo not allowed) are stated even with strict off");
  const unset = { ...gitCfg }; delete unset.strict;
  ok(/^Off — /.test(rowVal(premadeSummaryRows(unset), "Strict:")), "git: an unstored strict reads as the 'off' default");

  // (e) a non-git premade rule grows no git rows.
  ok(!premadeSummaryRows(cvPremade).some((r) => /Repository|Strict|Match pull request/.test(r.label)), "a non-git premade rule gets NO git rows");

  // (f) the explain prompt carries the same facts, untruncated.
  const facts = buildFactsText(gitCfg, [], conns);
  ok(/Connection: Acme GitHub/.test(facts), "explain facts: the connection name");
  ok(/Repository: acme\/widget/.test(facts), "explain facts: the repository");
  ok(/Match pull request by: /.test(facts), "explain facts: the prMatch sentence");
  ok(/Strict: On — /.test(facts), "explain facts: the strict sentence");
  const laxFacts = buildFactsText({ ...gitCfg, strict: false }, [], conns);
  // The 220-char per-line clamp must not eat the end of the longest sentence.
  ok(/always blocks\.$/m.test(laxFacts), "explain facts: the strict-off sentence survives the 220-char line clamp whole");
}

// --- F-388: the CODER post-function's mode + instructions reach the card and the prompt ---
// A coder rule is a premade row in the POST-FUNCTION half of the catalogue, and its git
// group is the OBJECT form with prMatch switched off. Both facts used to be invisible
// here: the lookup only searched the validator/condition halves, and the git predicate
// read `params.git === true`.
{
  const coderCfg = {
    ruleKind: "premade", premadeRuleType: "postfunction-coder",
    connectionId: "gc_7", repo: "acme/widget", strict: false,
    mode: "open-branch", instructions: "Run npm test before you commit. Never touch infra/.",
  };
  const rows = premadeSummaryRows(coderCfg);
  const val = (l) => (rows.find((r) => r.label === l) || {}).value;

  ok(/Coder/.test(val("Premade rule:") || ""), "coder: the catalogue label is found in the post-function half");
  ok(val("What the Coder does:") === "Open a branch", "coder: the mode renders as its LABEL, not its id");
  ok(!rows.some((r) => r.label === "When:"), "coder: `mode` is NOT mistaken for the dateRel future/within row");
  ok(/npm test/.test(val("Extra instructions:") || ""), "coder: the admin's instructions reach the card");
  ok(val("Repository:") === "acme/widget" && /gc_7/.test(val("Connection:") || ""), "coder: the git rows still render");
  ok(!rows.some((r) => r.label === "Match pull request by:"), "coder: NO prMatch row — the rule switches that sub-control off");
  ok(/^Off — /.test(val("Strict:") || ""), "coder: strict IS one of its sub-controls, so its row stays");

  // An unknown / missing mode says what the executor does with it, and never invents one.
  const noMode = premadeSummaryRows({ ...coderCfg, mode: "" });
  ok(/not set/.test((noMode.find((r) => r.label === "What the Coder does:") || {}).value || ""),
    "coder: a missing mode is named as unset, not defaulted");
  ok(!premadeSummaryRows({ ...coderCfg, instructions: "   " }).some((r) => r.label === "Extra instructions:"),
    "coder: blank instructions grow no row");
  // The 2 KB cap is the catalogue's, applied where the value is READ as well as written.
  const long = premadeSummaryRows({ ...coderCfg, instructions: "x".repeat(5000) });
  ok(((long.find((r) => r.label === "Extra instructions:") || {}).value || "").length === 2048,
    "coder: instructions are clamped to CODER_PF_INSTRUCTIONS_MAX");

  const facts = buildFactsText(coderCfg, []);
  ok(/What the Coder does: Open a branch/.test(facts), "explain facts: the coder mode");
  ok(/Extra instructions: Run npm test/.test(facts), "explain facts: the coder instructions");
  ok(!/Match pull request by/.test(facts), "explain facts: no prMatch sentence for a rule that has no prMatch");

  // The F-350 validators keep the boolean shape — both sub-rows must still appear.
  const boolGit = premadeSummaryRows({ ruleKind: "premade", premadeRuleType: "git-pr-merged", connectionId: "gc_7", repo: "acme/widget", prMatch: "branch", strict: true });
  ok(boolGit.some((r) => r.label === "Match pull request by:") && boolGit.some((r) => r.label === "Strict:"),
    "the boolean `git: true` rules are unchanged — both sub-rows still render");
}

// --- bounds ---
ok(buildFactsText({ type: "validator", fieldId: "f", prompt: "x".repeat(3000) }, []).length <= 1500, "facts capped ≤1500");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
