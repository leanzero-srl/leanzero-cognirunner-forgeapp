/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// MASSIVE it12 import-COMMIT scale run. Imports N rules of varied types via commitImport
// (over REST, through the dev-gated webtrigger) onto fresh self-loop transitions on the
// COGTEST workflow, asserts each landed on the transition + registry, drives real issues
// through the static-PF transitions, and confirms each imported PF FIRED (unique property
// marker). Reports a matrix + surfaces any commit failures. Cleans up all it added.
// Env: TESTSTATE_URL, HARNESS_SECRET. Optional: SCALE_COUNT (default 24), SCALE_BASE (9600).
import { get, post, del, doTransition, searchJql, sleep, mapLimit } from "../lib/jira.mjs";
import { readWorkflow, makeSelfLoop, updateWorkflow } from "../lib/workflow.mjs";
import { loadState } from "../lib/state.mjs";

const TESTSTATE_URL = process.env.TESTSTATE_URL;
const SECRET = process.env.HARNESS_SECRET;
const COUNT = parseInt(process.env.SCALE_COUNT || "24", 10);
const BASE = parseInt(process.env.SCALE_BASE || "9600", 10);

const die = (m) => { console.error("SCALE FAIL:", m); process.exit(1); };
if (!TESTSTATE_URL || !SECRET) die("Set TESTSTATE_URL + HARNESS_SECRET.");

const hook = async (bodyObj, method = "POST") => {
  const res = await fetch(TESTSTATE_URL, { method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + SECRET }, body: method === "POST" ? JSON.stringify(bodyObj) : undefined });
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, text };
};

// Rule spec factory — rotates across types. Static PFs carry a unique property marker so
// firing is REST-observable; premade validator/condition exercise the non-PF commit path.
function specFor(i) {
  const marker = `cogni-scale-${i}`;
  const mod = i % 4;
  if (mod === 0 || mod === 1) {
    return { kind: "static", marker, rule: {
      type: "postfunction-static", name: `Scale static PF #${i}`,
      functions: [{ name: "mark", operationType: "rest_api_internal", variableName: "r",
        code: `await api.setProperty(${JSON.stringify(marker)}, { fired: true, i: ${i} });\nreturn { ok: true };` }],
    } };
  }
  if (mod === 2) {
    return { kind: "validator", rule: {
      type: "validator", name: `Scale premade validator #${i}`, ruleKind: "premade",
      premadeRuleType: "field-required", fieldName: "Summary", fieldType: "string",
      errorMessage: "Summary is required.",
    } };
  }
  return { kind: "condition", rule: {
    type: "condition", name: `Scale premade condition #${i}`, ruleKind: "premade",
    premadeRuleType: "field-not-empty", fieldName: "Summary", fieldType: "string",
  } };
}

async function main() {
  const s = loadState();
  if (!s.workflowName || !s.hubStatusRef) die("Run harness setup first.");
  console.log(`SCALE RUN — ${COUNT} imports onto ${s.workflowName} (base transition ${BASE})`);
  const ping = await hook(null, "GET");
  if (ping.status !== 200) die(`webtrigger unreachable (${ping.status})`);

  const ids = Array.from({ length: COUNT }, (_, i) => BASE + i);
  // 1. Add COUNT fresh self-loop transitions (the import targets).
  let { top, wf } = await readWorkflow(s.workflowName);
  wf.transitions = (wf.transitions || []).filter((t) => !ids.includes(Number(t.id)));
  ids.forEach((id, i) => wf.transitions.push(makeSelfLoop(s.hubStatusRef, `IT12 Scale ${i}`, id)));
  await updateWorkflow(top, wf);
  console.log(`✓ added ${COUNT} self-loop transitions`);
  await sleep(2000);

  // 2. Import-commit each rule (ONE per invoke, serialized — each does a workflows/update).
  const results = [];
  for (let i = 0; i < COUNT; i++) {
    const spec = specFor(i);
    const r = await hook({ action: "commit", rule: spec.rule, targetWorkflowName: s.workflowName, targetTransitionId: String(ids[i]) });
    const ok = r.status === 200 && r.json && r.json.success && r.json.status === "committed";
    results.push({ i, id: ids[i], kind: spec.kind, marker: spec.marker, ok, ruleId: r.json?.ruleId, err: ok ? null : (r.json?.error || r.text?.slice(0, 120)) });
    if ((i + 1) % 6 === 0) console.log(`  committed ${i + 1}/${COUNT}...`);
  }
  const committed = results.filter((r) => r.ok);
  console.log(`\n=== COMMIT: ${committed.length}/${COUNT} succeeded ===`);
  const byKind = {};
  for (const r of results) { byKind[r.kind] ||= { ok: 0, fail: 0 }; r.ok ? byKind[r.kind].ok++ : byKind[r.kind].fail++; }
  console.log("by kind:", JSON.stringify(byKind));
  const fails = results.filter((r) => !r.ok);
  if (fails.length) fails.slice(0, 5).forEach((f) => console.log(`  FAIL #${f.i} (${f.kind}): ${f.err}`));

  // 3. Assert landing: re-read workflow + registry, confirm each committed rule is present.
  await sleep(2000);
  ({ top, wf } = await readWorkflow(s.workflowName));
  const onTx = new Set();
  for (const t of wf.transitions || []) {
    for (const a of [...(t.actions || []), ...(t.validators || []), ...flatten(t.conditions)]) {
      try { onTx.add(JSON.parse(a.parameters?.config || "{}").id); } catch { /* */ }
    }
  }
  const landed = committed.filter((r) => onTx.has(r.ruleId)).length;
  console.log(`✓ landed on transitions: ${landed}/${committed.length}`);
  const reg = await hook(null, "GET");
  const regIds = new Set((reg.json?.registry || []).map((r) => r.id));
  const inReg = committed.filter((r) => regIds.has(r.ruleId)).length;
  console.log(`✓ registry rows: ${inReg}/${committed.length}`);

  // 4. Drive issues through the STATIC-PF transitions and confirm each marker fired.
  const statics = committed.filter((r) => r.kind === "static");
  const issues = await searchJql(`project = ${s.projectKey} AND status = "${s.hubStatusName}"`, ["status"], statics.length + 5);
  let fired = 0;
  await mapLimit(statics, 8, async (r, idx) => {
    const key = issues[idx % issues.length]?.key;
    if (!key) return;
    await del(`/rest/api/3/issue/${key}/properties/${r.marker}`).catch(() => {});
    await doTransition(key, r.id).catch(() => {});
    for (let t = 0; t < 8; t++) { await sleep(2000); const p = await get(`/rest/api/3/issue/${key}/properties/${r.marker}`).catch(() => null); if (p?.value?.fired) { fired++; break; } }
  });
  console.log(`\n=== FIRING: ${fired}/${statics.length} static PFs fired on a real transition ===`);

  // 5. Surface any recent backend errors for the tweak loop.
  console.log("\n=== RESULT MATRIX ===");
  console.log(JSON.stringify({ count: COUNT, committed: committed.length, landed, inRegistry: inReg, staticsFired: fired, staticsTotal: statics.length, byKind }, null, 0));

  // 6. Cleanup — drop all the scale transitions (removes the rules); clear markers.
  try {
    ({ top, wf } = await readWorkflow(s.workflowName));
    wf.transitions = (wf.transitions || []).filter((t) => !ids.includes(Number(t.id)));
    await updateWorkflow(top, wf);
    for (const r of statics) { for (const iss of issues) await del(`/rest/api/3/issue/${iss.key}/properties/${r.marker}`).catch(() => {}); }
    console.log("✓ cleaned up scale transitions + markers");
  } catch (e) { console.log("cleanup note:", e.message); }

  const pass = committed.length === COUNT && landed === committed.length && fired === statics.length;
  console.log(pass ? "\n✅ SCALE RUN PASSED" : "\n⚠ SCALE RUN had gaps (see matrix)");
  process.exit(pass ? 0 : 1);
}
function flatten(cond) { if (!cond) return []; if (Array.isArray(cond)) return cond; const out = []; const walk = (n) => { if (!n) return; (n.conditions || []).forEach((c) => { if (c.conditions || c.conditionGroups) walk(c); else out.push(c); }); (n.conditionGroups || []).forEach(walk); }; walk(cond); return out; }
main().catch((e) => die(e.message));
