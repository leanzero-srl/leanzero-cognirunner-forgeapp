/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * OFFLINE test for the GIT branches of the ONE workflow-condition expression
 * (1.4 commit 11).
 *
 * HOW IT EVALUATES, and what that is worth. There is no Jira-expression engine
 * available offline, so the expression is lifted verbatim out of manifest.yml and
 * evaluated as JAVASCRIPT (`new Function`, which is fine in Node — the CSP ban on
 * eval applies to the Custom UI iframes, not here). That is an APPROXIMATION:
 * Jira's `==` is strict and an type-mismatched comparison is an evaluation ERROR
 * (= FALSE = a hidden transition), while JS `==` coerces. The git branches are
 * written so the difference cannot matter — each one null-guards the exact path it
 * is about to read and returns the raw boolean, and the build branch compares only
 * String-to-String after `.toLowerCase()`. The LIVE proof that `issue.properties`
 * is readable at all is probe (b), 2026-09-12 (_probe-git-condition.mjs): six
 * conditions on six transitions, missing property -> shown, "success" -> shown,
 * "failure" -> hidden.
 *
 * The fixtures are built by the REAL writer (listeners.js mergeGitProperty), so
 * this test cannot drift from the property shape the app actually writes.
 *
 *   node --import ./lib/register-mocks.mjs scripts/git-condition-expression.test.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mergeGitProperty } from "../../src/listeners.js";
import { EXPRESSION_BACKED_CONDITIONS, PREMADE_CONDITIONS } from "../../src/shared/premade-rules-catalog.js";

const here = dirname(fileURLToPath(import.meta.url));
const manifest = readFileSync(resolve(here, "../../manifest.yml"), "utf8");

let passed = 0;
const failures = [];
const ok = (cond, name) => { if (cond) passed++; else failures.push(name); };
const eq = (actual, expected, name) => ok(actual === expected, `${name} (expected ${expected}, got ${actual})`);

// --- lift the ONE expression out of the manifest -----------------------------
const block = manifest.split("jira:workflowCondition:")[1];
const exprStart = block.indexOf("expression: >-");
const lines = block.slice(exprStart).split("\n").slice(1);
const body = [];
for (const line of lines) {
  if (!line.trim()) break;
  if (/^ {6}\S/.test(line)) break; // back out to the next module key (`create:`)
  body.push(line.trim());
}
const expr = body.join(" ");
ok(expr.length > 200, "the condition expression was lifted from manifest.yml");

// The three git rule types are branches of THIS expression — not a second one.
for (const key of ["git-pr-merged", "git-pr-approved", "git-build-passed"]) {
  ok(expr.includes(`config.ruleType == "${key}"`), `expression has a branch for ${key}`);
  ok(EXPRESSION_BACKED_CONDITIONS.includes(key), `${key} is listed in EXPRESSION_BACKED_CONDITIONS`);
  const row = PREMADE_CONDITIONS.find((r) => r.key === key);
  ok(!!row && row.availability === "available", `${key} is an available catalogue condition`);
  ok(!!row && /never blocks on a missing property/.test(row.help), `${key}'s help carries the missing-property sentence`);
}
// Every git branch null-guards the path it reads BEFORE reading it (this is what
// makes "missing -> TRUE" structural rather than incidental).
for (const leaf of ["merged", "approved", "build"]) {
  ok(expr.includes(`?.pr?.${leaf} == null ? true :`), `the ${leaf} branch null-guards before it reads`);
}
ok(expr.includes("config.repo == null ||"), "a condition with no repository chosen evaluates TRUE");

// eslint-disable-next-line no-new-func
const evaluate = new Function("config", "issue", "user", `return (${expr});`);
const show = (ruleType, repo, prop) =>
  evaluate({ ruleType, conditionKind: "deterministic", repo }, { properties: prop ? { "cognirunner.git": prop } : {} }, null);

const REPO = "leanzero/cognirunner";
const prop = (pr) => mergeGitProperty(null, { repoId: REPO, pr });

// --- 1. the missing cases. ALL of them must SHOW ------------------------------
for (const t of ["git-pr-merged", "git-pr-approved", "git-build-passed"]) {
  eq(show(t, REPO, null), true, `${t}: no cognirunner.git property at all -> SHOW`);
  eq(show(t, REPO, { version: 1, repos: {} }), true, `${t}: property with no repositories -> SHOW`);
  eq(show(t, REPO, prop({ number: 4 })), true, `${t}: repository seen but the flag absent -> SHOW`);
  eq(show(t, REPO, mergeGitProperty(null, { repoId: "someone/else", pr: { number: 4, merged: false, approved: false, build: "failure" } })), true,
    `${t}: only a DIFFERENT repository is in the property -> SHOW`);
  eq(show(t, null, prop({ number: 4, merged: false, approved: false, build: "failure" })), true,
    `${t}: no repository chosen on the rule -> SHOW`);
}

// --- 2. merged / approved: the known-negative hides, the positive shows -------
eq(show("git-pr-merged", REPO, prop({ number: 4, merged: true })), true, "merged:true -> SHOW");
eq(show("git-pr-merged", REPO, prop({ number: 4, merged: false })), false, "merged:false -> HIDE");
eq(show("git-pr-approved", REPO, prop({ number: 4, approved: true })), true, "approved:true -> SHOW");
eq(show("git-pr-approved", REPO, prop({ number: 4, approved: false })), false, "approved:false -> HIDE");
// …and the branches do not read each other's flag.
eq(show("git-pr-approved", REPO, prop({ number: 4, merged: false })), true, "merged:false does not hide an APPROVED condition");
eq(show("git-pr-merged", REPO, prop({ number: 4, approved: false })), true, "approved:false does not hide a MERGED condition");

// --- 3. build: only a determinate failure hides -------------------------------
for (const good of ["success", "SUCCESSFUL", "neutral", "skipped", "in_progress", "queued", "INPROGRESS", "completed"]) {
  eq(show("git-build-passed", REPO, prop({ number: 4, build: good })), true, `build "${good}" -> SHOW (not a known negative)`);
}
for (const bad of ["failure", "FAILED", "timed_out", "cancelled", "action_required", "stale", "STOPPED"]) {
  eq(show("git-build-passed", REPO, prop({ number: 4, build: bad })), false, `build "${bad}" -> HIDE`);
}

// --- 4. the expression's own guards still hold (no regression) ----------------
eq(evaluate(null, { properties: {} }, null), true, "config == null -> SHOW (unchanged)");
eq(evaluate({ ruleType: "git-pr-merged", repo: REPO }, { properties: { "cognirunner.git": prop({ number: 4, merged: false }) } }, null), true,
  "a config without conditionKind:'deterministic' is not ours -> SHOW (unchanged)");
eq(show("git-pr-merged", REPO, prop({ number: 4, merged: false })) === false
  && evaluate({ ruleType: "git-pr-merged", conditionKind: "deterministic", disabled: true, repo: REPO },
    { properties: { "cognirunner.git": prop({ number: 4, merged: false }) } }, null) === true, true,
  "a DISABLED git condition -> SHOW (unchanged)");
eq(evaluate({ ruleType: "issue-is-resolved", conditionKind: "deterministic" }, { properties: {}, resolution: { name: "Done" } }, null), true,
  "a pre-existing condition type still evaluates (issue-is-resolved)");
eq(evaluate({ ruleType: "issue-is-resolved", conditionKind: "deterministic" }, { properties: {}, resolution: null }, null), false,
  "a pre-existing condition type still blocks (issue-is-resolved)");

console.log(failures.length
  ? `✗ git condition expression: ${passed} passed, ${failures.length} FAILED\n  - ${failures.join("\n  - ")}`
  : `✓ git condition expression: ${passed}/${passed} assertions passed.`);
process.exit(failures.length ? 1 : 0);
