/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * OFFLINE test for the premade post-function RECIPES (src/shared/builtin-recipes.js).
 *
 * For every recipe it:
 *   1. builds sandbox JS from sample params,
 *   2. parses it (node:vm, wrapped as an async fn — compile only, never run),
 *   3. asserts every `api.X` used is a REAL documented method (∈ KNOWN_API_MEMBERS),
 *   4. asserts the methods used are covered by the recipe's declared apiMembers
 *      (+ the always-available log/context) so the picker's gating is accurate,
 *   5. asserts declared apiMembers ⊆ KNOWN_API_MEMBERS (the gating contract).
 * Plus an injection case: a param with quotes/newlines must be safely escaped
 * (JSON.stringify) so it can't break out of the string literal.
 *
 *   node test-harness/scripts/recipes.test.mjs    # exits 1 on any failure
 */
import vm from "node:vm";
import { BUILTIN_RECIPES, getRecipeByKey, RECIPE_CATEGORIES } from "../../src/shared/builtin-recipes.js";
import { KNOWN_API_MEMBERS } from "../../src/shared/sandbox-api-spec.js";

let passed = 0;
const failures = [];
const ok = (cond, msg) => { if (cond) passed++; else failures.push(msg); };

const ALWAYS = new Set(["log", "context"]);
const known = new Set(KNOWN_API_MEMBERS);

// Representative params per recipe; quote/newline payloads probe escaping.
const SAMPLES = {
  copy_field: { source: "summary", target: "customfield_10001", onlyIfEmpty: "empty" },
  set_field: { target: "priority", value: 'High "tier"', valueShape: "name" },
  clear_field: { target: "customfield_10001", kind: "array" },
  conditional_set: { source: "status", operator: "contains", compareValue: "done", target: "resolution", setValue: "Fixed" },
  rollup_sum_subtasks: { sourceField: "customfield_10002", target: "customfield_10003" },
  bulk_transition_linked: { scope: "linked", transitionId: "31", max: 10 },
  append_to_text: { target: "customfield_10004", text: 'a "quoted" line\nwith a newline' },
  add_remove_labels: { add: "triaged, urgent", remove: "stale" },
  clone_issue: { summaryPrefix: '[Copy] "x"', link: "yes" },
  create_subtask: { summary: 'Do "this"\nnow', issuetypeId: "5" },
};

function parseOK(code) {
  // Compile (parse) without executing — recipes use top-level await + return, so wrap in an async fn.
  new vm.Script(`(async (api) => {\n${code}\n});`);
}

function usedApiMembers(code) {
  const set = new Set();
  for (const m of code.matchAll(/\bapi\.(\w+)/g)) set.add(m[1]);
  return [...set];
}

function main() {
  ok(BUILTIN_RECIPES.length >= 7, `expected ≥7 recipes, got ${BUILTIN_RECIPES.length}`);
  ok(RECIPE_CATEGORIES.length >= 1, "expected at least one recipe category");

  for (const recipe of BUILTIN_RECIPES) {
    const name = recipe.key;

    // declared apiMembers ⊆ KNOWN_API_MEMBERS (gating contract)
    for (const m of recipe.apiMembers || []) {
      ok(known.has(m), `${name}: declared apiMember "${m}" is not a real documented method`);
    }
    ok(getRecipeByKey(name) === recipe, `${name}: getRecipeByKey mismatch`);
    ok(Array.isArray(recipe.params), `${name}: params must be an array`);
    ok(typeof recipe.build === "function", `${name}: build must be a function`);

    const params = SAMPLES[name];
    ok(!!params, `${name}: MISSING test sample params (add one to SAMPLES)`);
    if (!params) continue;

    let code;
    try {
      code = recipe.build(params);
    } catch (e) {
      failures.push(`${name}: build() threw ${e.message}`);
      continue;
    }
    ok(typeof code === "string" && code.length > 0, `${name}: build() returned empty`);

    try {
      parseOK(code);
      passed++;
    } catch (e) {
      failures.push(`${name}: generated code does NOT parse — ${e.message}\n---\n${code}\n---`);
      continue;
    }

    const used = usedApiMembers(code);
    const declared = new Set(recipe.apiMembers || []);
    for (const m of used) {
      ok(known.has(m), `${name}: generated code uses api.${m} which is NOT a real documented method`);
      ok(declared.has(m) || ALWAYS.has(m), `${name}: uses api.${m} but it is not in declared apiMembers (gating would be wrong)`);
    }
  }

  // Injection: append_to_text with a hostile payload must keep it INSIDE a string literal.
  const evil = BUILTIN_RECIPES.find((r) => r.key === "append_to_text").build({ target: "cf", text: '"; await api.deleteEverything(); //' });
  try {
    parseOK(evil);
    // The payload must appear JSON-escaped (as data), not as bare executable tokens.
    const encoded = JSON.stringify('"; await api.deleteEverything(); //');
    ok(evil.includes(encoded), "append_to_text: hostile payload not JSON-escaped");
    // Strip every occurrence of the escaped literal; nothing executable must remain.
    ok(!/\bapi\.deleteEverything\(/.test(evil.split(encoded).join("")), "append_to_text: payload leaked outside the string literal");
    passed++;
  } catch (e) {
    failures.push(`append_to_text injection case failed to parse: ${e.message}`);
  }

  // clone/create recipes must carry an idempotency marker guard.
  for (const key of ["clone_issue", "create_subtask"]) {
    const code = BUILTIN_RECIPES.find((r) => r.key === key).build(SAMPLES[key]);
    ok(/getProperty\(MARKER\)/.test(code) && /setProperty\(MARKER/.test(code), `${key}: missing idempotency property-marker guard`);
  }

  const total = passed + failures.length;
  if (failures.length) {
    console.error(`\n✗ recipes: ${passed}/${total} checks passed, ${failures.length} FAILED:`);
    for (const f of failures) console.error("  - " + f);
    process.exit(1);
  }
  console.log(`✓ recipes: ${passed}/${total} checks passed across ${BUILTIN_RECIPES.length} recipes.`);
}

main();
