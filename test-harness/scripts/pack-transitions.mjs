/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Pack the REAL lifecycle transitions (Backlog / Selected for Development /
// In Progress / Done) with RICH stacks of CogniRunner rules — multiple
// validators + a condition + several post-functions (+ semantic on Done) — so
// inspecting any transition shows a heavy, real configuration (not "light
// touch"). Idempotent: every packed rule config is tagged { pack: true } and
// stripped before re-adding. Validators are lenient (always pass valid issues)
// so the lifecycle keeps working.
//
// CLEAN=1 removes the packed rules without re-adding.

import { readWorkflow, updateWorkflow, attachRuleToTransition, buildRule, APP_ID } from "../lib/workflow.mjs";
import { loadState } from "../lib/state.mjs";

const CLEAN = process.env.CLEAN === "1";

function isPacked(rule) {
  if (!String(rule?.parameters?.key || "").includes(APP_ID)) return false;
  try { return JSON.parse(rule.parameters.config || "{}").pack === true; } catch { return false; }
}
// Also strip the legacy read-modify-write "mass-touched" PF — it does a full
// labels REPLACE and clobbers additive label writers (the F10 root cause).
const isLegacyClobber = (rule) => String(rule?.parameters?.config || "").includes("mass-touched");
function stripPacked(t) {
  if (Array.isArray(t.validators)) t.validators = t.validators.filter((r) => !isPacked(r));
  if (Array.isArray(t.actions)) t.actions = t.actions.filter((r) => !isPacked(r) && !isLegacyClobber(r));
  if (t.conditions && Array.isArray(t.conditions.conditions)) t.conditions.conditions = t.conditions.conditions.filter((r) => !isPacked(r));
}

// F10 fix in practice: do same-field writes in ONE additive call (api.addLabels
// adds both labels via update.add) — never two PFs racing on the same field. Each
// PF below targets a DISTINCT field/entity so concurrent post-functions can't
// clobber each other.
const addBothLabels = (a, b) => `await api.addLabels("${a}", "${b}");\napi.log("packed labels: ${a}, ${b}");`;
const setText = (id, v) => `await api.updateIssue(api.context.issueKey, { ${JSON.stringify(id)}: ${JSON.stringify(v)} });`;
const setSelect = (id) => `await api.updateIssue(api.context.issueKey, { ${JSON.stringify(id)}: { value: "High" } });`;
const comment = (text) => `await api.addComment(${JSON.stringify(text)});`;
const setProp = (key) => `await api.setProperty(${JSON.stringify(key)}, { packedAt: ${JSON.stringify(key)}, ts: api.context.issueKey });`;
const worklog = () => `await api.addWorklog(600, "packed work log");`;

// Two lenient validators (always pass a real issue) + a lenient condition.
const vLenient = (n) => ({ pack: true, fieldId: "summary", prompt: `Advisory check #${n}: respond isValid=true unless the summary is literally empty. This is a non-blocking quality note.`, enableTools: false });
const cLenient = () => ({ pack: true, fieldId: "summary", prompt: "Show this transition whenever the summary is non-empty (effectively always).", enableTools: false });

function stackFor(name, cf) {
  const textId = cf.text.id, selectId = cf.select.id;
  const slug = name.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "");
  const staticPf = (code) => ({ pack: true, type: "postfunction-static", functions: [{ name: "pk", code, variableName: "step1" }] });
  const semantic = () => ({ pack: true, type: "postfunction-semantic", fieldId: "description", conditionPrompt: "Run every time", actionPrompt: "Write a one-line status note for this issue.", actionFieldId: textId });

  // Chalk-full stack — each PF targets a DISTINCT field/entity (labels / property /
  // comment / worklog / text / select / semantic) so concurrent PFs never clobber.
  const stack = [
    { type: "validator", config: vLenient(1) },
    { type: "validator", config: vLenient(2) },
    { type: "condition", config: cLenient() },
    { type: "static", config: staticPf(addBothLabels(`pk-${slug}-1`, `pk-${slug}-2`)) }, // labels
    { type: "static", config: staticPf(setProp(`pk-${slug}`)) },                          // entity property
    { type: "static", config: staticPf(comment(`CogniRunner packed PF ran on the '${name}' transition.`)) }, // comment
    { type: "static", config: staticPf(worklog()) },                                       // worklog
  ];
  if (name !== "Done") stack.push({ type: "static", config: staticPf(setText(textId, `packed @ ${name}`)) }); // text (single writer)
  if (name === "In Progress") stack.push({ type: "validator", config: vLenient(3) });
  if (name === "Done") {
    stack.push({ type: "static", config: staticPf(setSelect(selectId)) }); // select
    stack.push({ type: "semantic", config: semantic() });                  // text via AI (sole text writer on Done)
  }
  return stack;
}

async function main() {
  const s = loadState();
  if (!s.customFields) throw new Error("Run setup first.");
  const LIFECYCLE = ["Backlog", "Selected for Development", "In Progress", "Done"];

  for (let attempt = 0; attempt < 3; attempt++) {
    const { top, wf } = await readWorkflow(s.workflowName);
    let removed = 0, added = 0;
    const perTransition = {};
    for (const t of wf.transitions || []) {
      const before = (t.validators || []).length + (t.actions || []).length + (t.conditions?.conditions?.length || 0);
      stripPacked(t);
      removed += before - ((t.validators || []).length + (t.actions || []).length + (t.conditions?.conditions?.length || 0));
      if (!CLEAN && LIFECYCLE.includes(t.name)) {
        const stack = stackFor(t.name, s.customFields);
        for (const r of stack) { attachRuleToTransition(t, r.type, buildRule(r.type, r.config)); added++; }
        perTransition[t.name] = stack.length;
      }
    }
    try {
      await updateWorkflow(top, wf);
      if (CLEAN) { console.log(`Removed ${removed} packed rules.`); return; }
      console.log(`Packed lifecycle transitions (removed ${removed} prior, added ${added}):`);
      for (const [n, c] of Object.entries(perTransition)) console.log(`  ${n}: ${c} CogniRunner rules`);
      console.log(`\nOpen any of these transitions in the workflow editor — each now shows a rich stack of validators + condition + post-functions.`);
      return;
    } catch (e) {
      if (attempt < 2 && /409|version|conflict/i.test(e.message)) { console.log("version conflict, retrying..."); continue; }
      throw e;
    }
  }
}

main().catch((e) => { console.error("PACK FAILED:", e.message); if (e.body) console.error(JSON.stringify(e.body, null, 2)); process.exit(1); });
