/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// DIAGNOSTIC PROBE — per-field-kind Jira-expression semantics, proven live.
//
// Purpose: decide, from evidence rather than docs, exactly which custom-field
// kinds the field-based condition types (field-has-value / field-empty /
// field-equals) may ship for. The withdrawal (commit 1e2ea87) was driven by a
// fail-CLOSED hypothesis — expression type errors hide the transition — that
// had NEVER been reproduced live. This probe reproduces it deliberately once
// (the `errlen` case) and pins, per kind:
//   - that the custom-field accessor issue?.[<REST id>] resolves at all
//   - what an UNSET field reads as (null vs [] vs ""), per kind
//   - the value SHAPE (String / Number / {value} option / array) under strict ==
//   - whether String.toLowerCase() exists (case-insensitive equals shippable)
//   - that null==String is a safe false, not an error (`nullcmp` discriminator:
//     `(issue?.[f] == config.v) != true` — safe false → outer true → VISIBLE;
//     evaluation error → whole expression false → HIDDEN)
//   - that the customfield-only regex guard accepts/rejects correctly
//
// METHOD (same as _probe-condition-config.mjs, one refinement): the probe
// branches are APPENDED to the deployed dev expression, gated on
// `config.conditionKind == "cogprobe"` — production configs can't reach them
// and the seven live types keep working mid-probe. Hand-edit manifest.yml,
// `forge deploy` (development), run this, then REVERT the manifest, redeploy,
// and re-run reg-conditions-enforce.mjs to prove restoration. The probe
// expression is NEVER committed; its exact text is the constant below.
//
// Case 0 is the deploy sentinel: {p:"deny"} must be HIDDEN. Against a
// production expression (no cogprobe branch → default-true) it would be
// VISIBLE, so the run ABORTS rather than recording 40 meaningless verdicts.
//
// Results → results/condition-fieldkind-probe.json + a FINDINGS evidence table.
// Run: node scripts/_probe-condition-fieldkinds.mjs

import { writeFileSync } from "node:fs";
import path from "node:path";
import { getTransitions, doTransition, searchJql, post } from "../lib/jira.mjs";
import { readWorkflow, updateWorkflow, makeSelfLoop, buildRule, attachRuleToTransition, removeTransitionsByName } from "../lib/workflow.mjs";
import { loadState, RESULTS_DIR } from "../lib/state.mjs";

/**
 * The EXACT text to insert into manifest.yml's expression — as the FIRST
 * branch, BEFORE the default-true head (`config == null || conditionKind !=
 * "deterministic" …`), because that head would otherwise swallow cogprobe
 * configs (their conditionKind isn't "deterministic") and allow everything.
 * Indent to match; YAML folds it fine.
 *
 *   config != null && config.conditionKind == "cogprobe" ? (
 *     config.p == "deny" ? false :
 *     config.p == "nul" ? issue?.[config.f] != null :
 *     config.p == "arrhas" ? (issue?.[config.f] != null && issue?.[config.f].length > 0) :
 *     config.p == "arris0" ? (issue?.[config.f] != null && issue?.[config.f].length == 0) :
 *     config.p == "streq" ? issue?.[config.f] == config.v :
 *     config.p == "strlower" ? issue?.[config.f].toLowerCase() == config.v.toLowerCase() :
 *     config.p == "opteq" ? issue?.[config.f].value == config.v :
 *     config.p == "optlower" ? issue?.[config.f].value.toLowerCase() == config.v.toLowerCase() :
 *     config.p == "numeq" ? issue?.[config.f] == config.vn :
 *     config.p == "nullcmp" ? (issue?.[config.f] == config.v) != true :
 *     config.p == "guard" ? config.f.match("^customfield_[0-9]+$") != null :
 *     config.p == "errlen" ? issue?.[config.f].length > 0 :
 *     true
 *   ) :
 */
const PROBE_MARKER = "cogprobe";

const SET_LABEL = "cogtest-condprobe-set";
const BARE_LABEL = "cogtest-condprobe-bare";

// Correct Jira create/update value per field role — kept in step with
// field-matrix.mjs writeValueFor (the shapes proven 19/19 there).
function writeValueFor(cf, role) {
  const f = cf[role];
  const opts = Array.isArray(f?.options) ? f.options : Object.keys(f?.options || {});
  switch (role) {
    case "text": return "harness text";
    case "textarea": return { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: "harness textarea body" }] }] };
    case "url": return "https://example.com/cogtest";
    case "number": return 7;
    case "date": return "2026-03-15";
    case "datetime": return "2026-03-15T10:30:00.000+0000";
    case "clabels": return ["alpha", "beta"];
    case "select": return { value: opts[0] || "Low" };
    case "multiselect": return (opts.length ? opts : ["Backend"]).slice(0, 2).map((v) => ({ value: v }));
    case "radio": return { value: opts[0] || "Yes" };
    case "checkboxes": return (opts.length ? opts : ["A11y"]).slice(0, 2).map((v) => ({ value: v }));
    case "user": return { accountId: cf._lead };
    case "multiuser": return [{ accountId: cf._lead }];
    case "group": return { name: f.group };
    case "multigroup": return [{ name: f.group }];
    case "cascading": return { value: f.cascade.parent, child: { value: f.cascade.child } };
    case "version": return { id: String(f.version.id) };
    case "multiversion": return [{ id: String(f.version.id) }];
    case "project": return { key: f.projectKey };
    default: return null;
  }
}

const SCALAR_ROLES = ["text", "textarea", "url", "number", "date", "datetime", "select", "radio", "user", "group", "cascading", "version", "project"];
const ARRAY_ROLES = ["clabels", "multiselect", "checkboxes", "multiuser", "multigroup", "multiversion"];

// expect: { set: bool|null, bare: bool|null } — null = record-only (informational).
// decides: what a decisive mismatch kills (GO/NO-GO bookkeeping in the report).
function buildCases(cf) {
  const id = (role) => cf[role].id;
  const cases = [];
  const add = (name, config, expect, decides) => cases.push({ name: `CPK-${name}`, config, expect, decides });

  // 0 — deploy sentinel (checked FIRST, aborts the run when not hidden).
  add("deny", { p: "deny" }, { set: false, bare: false }, "the whole run (probe expression not deployed)");

  // scalar kinds: accessor resolves + unset reads null
  for (const role of SCALAR_ROLES) {
    add(`nul-${role}`, { p: "nul", f: id(role) }, { set: true, bare: false }, `kind ${role} entirely`);
  }
  // array kinds: accessor + .length work; unset hides under null-or-empty
  for (const role of ARRAY_ROLES) {
    add(`arrhas-${role}`, { p: "arrhas", f: id(role) }, { set: true, bare: false }, `array kind ${role} entirely`);
  }
  // informational: does an UNSET array read [] (visible) or null (hidden)?
  add("arris0-clabels", { p: "arris0", f: id("clabels") }, { set: null, bare: null }, null);
  add("arris0-multiselect", { p: "arris0", f: id("multiselect") }, { set: null, bare: null }, null);

  // String equals, both directions
  add("streq-text-yes", { p: "streq", f: id("text"), v: "harness text" }, { set: true, bare: false }, "equals for text");
  add("streq-text-no", { p: "streq", f: id("text"), v: "WRONG" }, { set: false, bare: null }, "equals block direction");
  add("streq-url-yes", { p: "streq", f: id("url"), v: "https://example.com/cogtest" }, { set: true, bare: null }, "equals for url");
  add("streq-date-yes", { p: "streq", f: id("date"), v: "2026-03-15" }, { set: true, bare: null }, "equals for date (REST YYYY-MM-DD shape)");
  add("streq-date-no", { p: "streq", f: id("date"), v: "2026-03-16" }, { set: false, bare: null }, "date equals block direction");
  add("streq-textarea", { p: "streq", f: id("textarea"), v: "harness textarea body" }, { set: null, bare: null }, null); // informational: rich shape?
  add("streq-datetime", { p: "streq", f: id("datetime"), v: "2026-03-15T10:30:00.000+0000" }, { set: null, bare: null }, null); // informational only

  // case-insensitivity (decides case-insensitive vs case-sensitive ship)
  add("strlower-text", { p: "strlower", f: id("text"), v: "HARNESS TEXT" }, { set: null, bare: null }, "case-insensitive equals (fallback: case-sensitive)");
  add("optlower-select", { p: "optlower", f: id("select"), v: "LOW" }, { set: null, bare: null }, "case-insensitive option equals");

  // option kinds
  add("opteq-select-yes", { p: "opteq", f: id("select"), v: "Low" }, { set: true, bare: false }, "equals for select");
  add("opteq-select-no", { p: "opteq", f: id("select"), v: "High" }, { set: false, bare: null }, "option equals block direction");
  add("opteq-radio-yes", { p: "opteq", f: id("radio"), v: "Yes" }, { set: true, bare: null }, "equals for radio");

  // number kind: typed arrival + strict-typing error reproduction
  add("numeq-yes", { p: "numeq", f: id("number"), vn: 7 }, { set: true, bare: false }, "equals for number (config numbers arrive typed)");
  add("numeq-no", { p: "numeq", f: id("number"), vn: 8 }, { set: false, bare: null }, "number equals block direction");
  add("numeq-strtyped", { p: "numeq", f: id("number"), vn: "7" }, { set: false, bare: null }, "strict-== model (Number==String must ERROR→hidden; VISIBLE = model wrong, investigate)");

  // THE fail-closed reproduction: .length on a Number is an evaluation error.
  // Paired with nul-number (visible) this also proves errors are branch-local.
  add("errlen-number", { p: "errlen", f: id("number") }, { set: false, bare: null }, "NOTHING ships if not hidden — unexplained favorable anomaly");

  // null==String discriminator (BARE text is null): visible ⇒ safe false; hidden ⇒ error.
  add("nullcmp-text", { p: "nullcmp", f: id("text"), v: "x" }, { set: null, bare: null }, null);

  // regex guard accept/reject
  add("guard-custom", { p: "guard", f: id("text") }, { set: true, bare: true }, "the expression-level customfield guard");
  add("guard-system", { p: "guard", f: "duedate" }, { set: false, bare: false }, "the expression-level customfield guard");

  return cases;
}

async function findOrCreateFixture(s, cf, label, withValues) {
  const found = await searchJql(`project = ${s.projectKey} AND labels = ${label} AND status = "${s.hubStatusName || "Backlog"}" ORDER BY created ASC`, ["summary"], 1);
  if (found.length) return found[0].key;
  const fields = { project: { key: s.projectKey }, issuetype: { id: s.primaryIssueType.id }, summary: `Condition field-kind probe (${withValues ? "SET" : "BARE"}; reused)`, labels: ["cogtest-harness", label] };
  if (withValues) {
    for (const role of [...SCALAR_ROLES, ...ARRAY_ROLES]) fields[cf[role].id] = writeValueFor(cf, role);
  }
  const res = await post("/rest/api/3/issue", { fields });
  console.log(`created ${withValues ? "SET" : "BARE"} fixture ${res.key}`);
  return res.key;
}

const cleanup = async (workflowName, names) => {
  const { top, wf } = await readWorkflow(workflowName);
  if (removeTransitionsByName(wf, names) > 0) await updateWorkflow(top, wf);
};

async function main() {
  const s = loadState();
  if (!s.workflowName || !s.hubStatusRef) { console.error("results/testbed.json missing workflowName/hubStatusRef"); process.exit(2); }
  if (!s.customFields) { console.error("run setup-fields + setup-fields-all first (customFields missing)"); process.exit(2); }
  const cf = { ...s.customFields, _lead: s.leadAccountId };
  const cases = buildCases(cf);
  const names = cases.map((c) => c.name);

  const SET = await findOrCreateFixture(s, cf, SET_LABEL, true);
  const BARE = await findOrCreateFixture(s, cf, BARE_LABEL, false);
  console.log(`fixtures: SET=${SET} BARE=${BARE}; ${cases.length} probe cases`);

  await cleanup(s.workflowName, names);
  {
    const { top, wf } = await readWorkflow(s.workflowName);
    const taken = new Set((wf.transitions || []).map((t) => String(t.id)));
    let next = 9500;
    for (const c of cases) {
      while (taken.has(String(next))) next++;
      c.id = next; taken.add(String(next));
      const t = makeSelfLoop(s.hubStatusRef, c.name, c.id);
      // conditionKind "cogprobe" — NOT "deterministic": these configs are only
      // meaningful against the temporarily-deployed probe expression, and are
      // invisible (default-true) to the production expression.
      attachRuleToTransition(t, "condition", buildRule("condition", { id: `cpk-${c.id}`, type: "condition", conditionKind: PROBE_MARKER, ...c.config }));
      wf.transitions.push(t);
    }
    await updateWorkflow(top, wf);
  }
  await new Promise((r) => setTimeout(r, 4000));

  const listedFor = async (key) => new Set(((await getTransitions(key)).transitions || []).map((t) => String(t.id)));
  const setListed = await listedFor(SET);

  // Sentinel FIRST: if the deny case is visible, the probe expression is not
  // deployed (production default-true showed it) — abort before recording junk.
  const deny = cases.find((c) => c.name === "CPK-deny");
  if (setListed.has(String(deny.id))) {
    await cleanup(s.workflowName, names);
    console.error("ABORT: the deny sentinel is VISIBLE — the cogprobe expression is not deployed. Hand-edit manifest.yml per the header, `forge deploy -e development`, and re-run.");
    process.exit(2);
  }
  const bareListed = await listedFor(BARE);

  let decisiveFails = 0;
  const rows = [];
  for (const c of cases) {
    const verdict = {};
    for (const [tgt, key, listed] of [["set", SET, setListed], ["bare", BARE, bareListed]]) {
      if (c.expect[tgt] === undefined) continue;
      const visible = listed.has(String(c.id));
      const rest = await doTransition(key, String(c.id));
      const restAllowed = rest.status < 400;
      const agree = visible === restAllowed;
      const okCase = c.expect[tgt] === null ? true : (visible === c.expect[tgt] && agree);
      if (!okCase) decisiveFails++;
      verdict[tgt] = { visible, rest: rest.status, expected: c.expect[tgt], ok: okCase };
      const mark = c.expect[tgt] === null ? "·" : okCase ? " " : "!!";
      console.log(`${mark} ${c.name.padEnd(24)} ${tgt.padEnd(4)} listed=${String(visible).padEnd(5)} REST=${String(rest.status).padEnd(3)} expected=${c.expect[tgt] === null ? "(record)" : c.expect[tgt]}${agree ? "" : "  [GET/POST DISAGREE]"}`);
    }
    rows.push({ name: c.name, config: c.config, decides: c.decides, ...verdict });
  }

  await cleanup(s.workflowName, names);

  const out = { probedAt: new Date().toISOString(), setIssue: SET, bareIssue: BARE, decisiveFails, cases: rows };
  writeFileSync(path.join(RESULTS_DIR, "condition-fieldkind-probe.json"), JSON.stringify(out, null, 2));
  console.log(`\nwrote results/condition-fieldkind-probe.json — ${decisiveFails} decisive mismatch(es)`);
  console.log("Remember: revert manifest.yml, redeploy, re-run reg-conditions-enforce.mjs.");
  process.exit(decisiveFails ? 1 : 0);
}

main().catch(async (e) => {
  console.error("ERROR:", e.message);
  try { await cleanup(loadState().workflowName, buildCases({ ...loadState().customFields, _lead: "x" }).map((c) => c.name)); } catch { /* best effort */ }
  process.exit(1);
});
