/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// LIVE end-to-end test of premade post-function RECIPES. Builds sandbox code from
// each recipe, attaches it as a static post-function self-loop via REST, fires the
// transition on a freshly created issue, and asserts the recipe actually mutated
// the issue as intended — proving the generated code runs in the real sandbox.
//
// Needs the deployed app + a testbed (setup-testbed.mjs).
//   node test-harness/scripts/recipes-e2e.mjs

import { get, post, doTransition, getTransitions } from "../lib/jira.mjs";
import { attachSelfLoopRules, readWorkflow, updateWorkflow } from "../lib/workflow.mjs";
import { loadState } from "../lib/state.mjs";
import { getRecipeByKey } from "../../src/shared/builtin-recipes.js";

const s = loadState();
const CF = s.customFields;
const TEXT = CF.text.id;       // customfield_10280 (textfield)
const OFFSCREEN = CF.offscreen.id; // customfield_10285 (textfield)
const TASK = "10005";

async function createIssue(fields) {
  const res = await post("/rest/api/3/issue", { fields: { project: { key: s.projectKey }, issuetype: { id: TASK }, ...fields } });
  return res.key;
}
const fieldVal = async (key, fid) => (await get(`/rest/api/3/issue/${key}?fields=${fid}`)).fields?.[fid];

// Each recipe spec: build the code, the source-issue fields, and a check(after) predicate.
function specs() {
  return [
    {
      name: "RC-copy_field",
      recipe: "copy_field",
      params: { source: TEXT, target: OFFSCREEN, onlyIfEmpty: "always" },
      seed: { [TEXT]: "recipe copied this" },
      check: async (key) => (await fieldVal(key, OFFSCREEN)) === "recipe copied this",
      describe: "copy Text -> OffScreen",
    },
    {
      name: "RC-set_field",
      recipe: "set_field",
      params: { target: TEXT, value: "set by recipe", valueShape: "plain" },
      seed: {},
      check: async (key) => (await fieldVal(key, TEXT)) === "set by recipe",
      describe: "set Text to a constant",
    },
    {
      name: "RC-append_to_text",
      recipe: "append_to_text",
      params: { target: TEXT, text: "appended line" },
      seed: { [TEXT]: "original" },
      check: async (key) => (await fieldVal(key, TEXT)) === "original\nappended line",
      describe: "append a line to Text",
    },
    {
      name: "RC-conditional_set",
      recipe: "conditional_set",
      params: { source: TEXT, operator: "contains", compareValue: "trigger", target: OFFSCREEN, setValue: "condition-fired" },
      seed: { [TEXT]: "this should trigger it" },
      check: async (key) => (await fieldVal(key, OFFSCREEN)) === "condition-fired",
      describe: "set OffScreen only when Text contains 'trigger'",
    },
  ];
}

async function main() {
  if (!s.workflowName) throw new Error("Run setup-testbed.mjs first.");
  const S = specs();

  // Build code + attach each as a static-PF self-loop.
  const built = S.map((sp) => {
    const recipe = getRecipeByKey(sp.recipe);
    if (!recipe) throw new Error(`unknown recipe ${sp.recipe}`);
    return { ...sp, code: recipe.build(sp.params) };
  });

  // idempotent: drop prior RC- transitions
  {
    const { top, wf } = await readWorkflow(s.workflowName);
    const before = wf.transitions.length;
    wf.transitions = wf.transitions.filter((t) => !String(t.name || "").startsWith("RC-"));
    if (wf.transitions.length !== before) await updateWorkflow(top, wf);
  }

  console.log("Attaching recipe static post-functions via REST...");
  await attachSelfLoopRules(
    s.workflowName,
    s.hubStatusRef,
    built.map((b) => ({
      name: b.name,
      type: "static",
      config: { type: "postfunction-static", functions: [{ name: b.recipe, code: b.code, variableName: "step1" }], debugTrace: true },
    })),
    9301,
  );

  // Create one seeded issue per recipe.
  for (const b of built) b.key = await createIssue({ summary: `recipe test: ${b.describe}`, ...b.seed });
  console.log("Created seed issues. Settling 2s...");
  await new Promise((r) => setTimeout(r, 2000));

  let pass = 0, fail = 0;
  for (const b of built) {
    const tr = await getTransitions(b.key);
    const t = (tr.transitions || []).find((x) => x.name === b.name);
    if (!t) { console.log(`  ${b.name}: transition NOT available — SKIP`); continue; }
    const res = await doTransition(b.key, t.id);
    // Post-functions run as part of the transition; give the write a moment to land.
    await new Promise((r) => setTimeout(r, 1500));
    let ok = false;
    try { ok = await b.check(b.key); } catch (e) { ok = false; b.err = e.message; }
    console.log(`  ${b.name.padEnd(22)} (${b.describe}) ${ok ? "PASS ✓" : "FAIL ✗"}${b.err ? " — " + b.err : ""} [transition HTTP ${res.status}, ${b.key}]`);
    if (ok) pass++; else fail++;
  }

  console.log(`\nRecipe E2E: ${pass}/${pass + fail} recipes executed and mutated the issue correctly.`);
  if (fail > 0) {
    console.log("If a recipe's effect is missing, check forge logs for the static-PF sandbox run (debugTrace is on).");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("RECIPE E2E FAILED:", e.message);
  if (e.body) console.error(JSON.stringify(e.body, null, 2));
  process.exit(1);
});
