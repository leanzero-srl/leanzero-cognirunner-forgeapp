/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Exercise EVERY CogniRunner rule deployed on the instance so none has zero
// executions, and triage any SYSTEM weakness the (weak) active model surfaces.
//
// Backbone — REPLAY-WITH-TRACE (authoritative, always on): every discovered
// rule's EXACT persisted config is cloned onto a COGTEST hub self-loop with
// debugTrace=on (conditions are cloned as validators — the F3 mirror, since
// conditions never fire on the REST path), fired on a distinct on-hub issue with a
// fit-for-purpose synthesized input, then observed via the cogni-debug trace +
// side effects. This is deterministic, needs no fragile from-status reachability,
// tests the real prompt/code/field map through the real AI path, and yields a
// guaranteed execution + model + reason for every rule.
//
// IN-PLACE (IN_PLACE=1, default on): additionally fire each GLOBAL rule on its
// real transition in its home project — production-path confirmation, best-effort,
// side-effect-observed.
//
// Writes results/discovered-results.json. Replay/mirror transitions are named
// DISCO-/CMIRROR- so `CLEAN=1 npm run audit` removes them.

import { getIssue, doTransition, get, sleep, mapLimit, searchJql, BASE } from "../lib/jira.mjs";
import { readWorkflow, updateWorkflow, makeSelfLoop, buildRule, attachRuleToTransition } from "../lib/workflow.mjs";
import { loadState, writeResult } from "../lib/state.mjs";
import { discoverAllRules, buildWorkflowProjectIndex } from "../lib/discover.mjs";
import { classifyRule, decideLane } from "../lib/classify.mjs";
import {
  fetchFieldIndex, synthesizeValidatorInputs, synthesizeSourceFor,
  findOrSeedIssue, setFields, tryReach, DISCO_LABEL,
} from "../lib/synthesize.mjs";
import { triageCase, escalateRecurring } from "../lib/triage.mjs";

const CONCURRENCY = parseInt(process.env.DISCO_CONCURRENCY || "4", 10);
const IN_PLACE = process.env.IN_PLACE !== "0";
const ATTACH_CHUNK = 25;
const MUTATE_TIMEOUT = parseInt(process.env.DISCO_MUTATE_TIMEOUT || "60000", 10);
const POLL_MS = 3000;

const RE_PARSE = /malformed json|not valid json|after \d+ round|cannot deserialize|unexpected token|failed to parse|json ?parse/i;
const RE_FENCE = /```|<<<|source_field|field_value|system_prompt/i;
const RE_ERRORISH = /ai service error|temporarily unavailable|empty response|service (unavailable|down)|timed out|timeout|rate ?limit/i;

// ---- trace + observation helpers ------------------------------------------

async function readTrace(key) {
  try {
    const r = await get(`/rest/api/3/issue/${key}/properties/cogni-debug`, { raw: true });
    if (r.status >= 400) return null;
    return JSON.parse(r.text).value;
  } catch { return null; }
}

function parseReason(text) {
  try {
    const j = JSON.parse(text || "{}");
    const msgs = j.errorMessages || [];
    const errs = j.errors ? Object.values(j.errors) : [];
    return [...msgs, ...errs].join(" | ");
  } catch { return text || ""; }
}

function extractAdfText(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  let out = "";
  const walk = (n) => { if (!n) return; if (n.type === "text" && n.text) out += n.text; for (const c of n.content || []) walk(c); };
  walk(v);
  return out;
}
const fieldText = (issue, id) => { const v = issue?.fields?.[id]; return typeof v === "string" ? v : extractAdfText(v); };
const commentCount = (i) => i?.fields?.comment?.comments?.length ?? i?.fields?.comment?.total ?? 0;
const subtaskCount = (i) => (i?.fields?.subtasks || []).length;
const linkCount = (i) => (i?.fields?.issuelinks || []).length;
const attachCount = (i) => (i?.fields?.attachment || []).length;

// Decide grade for an arbitrary rule (no correctness oracle): PASS unless a
// SYSTEM error signal is present, so triage only ever flags real bugs — never
// "the model gave a debatable verdict on someone's custom prompt".
function discoveredGrade(c) {
  if (typeof c.http === "number" && c.http >= 500) return "HARD";
  const reason = String(c.reason || "");
  const written = c.writtenValue == null ? "" : (typeof c.writtenValue === "string" ? c.writtenValue : JSON.stringify(c.writtenValue));
  if (RE_PARSE.test(reason)) return "HARD";
  if (written && RE_FENCE.test(written)) return "HARD";
  if (RE_ERRORISH.test(reason) && c.cogniDebug?.transientError !== true && c.http >= 400) return "HARD";
  if (c.cogniDebug?.transientError === true) return "SOFT"; // transient, not a bug
  return "PASS";
}

// PF target fields to observe (best-effort) for a given config.
function pfWatchFields(cfg) {
  const ids = ["labels", "comment", "subtasks", "issuelinks", "attachment", "updated"];
  if (cfg.actionFieldId) ids.push(cfg.actionFieldId);
  return ids.join(",");
}

// ---- replay backbone -------------------------------------------------------

function replaySpec(record, classified, idx) {
  const et = classified.effectiveType;
  const isCond = et === "condition";
  const type = isCond ? "validator" : et;            // mirror conditions as validators
  const base = { ...(record.config || {}) };
  let config;
  if (isCond) {
    config = { fieldId: base.fieldId, prompt: base.prompt, enableTools: !!base.enableTools, debugTrace: true };
    if (base.selectedDocIds) config.selectedDocIds = base.selectedDocIds;
  } else {
    config = { ...base, debugTrace: true };
  }
  const prefix = isCond ? "CMIRROR" : "DISCO";
  const tag = `${record.workflowName.slice(0, 6)}-${record.transitionName.slice(0, 10)}-${idx}`.replace(/[^A-Za-z0-9_-]/g, "_");
  return {
    name: `${prefix}-${tag}`.slice(0, 60),
    type,
    config,
    effectiveType: et,
    record,
    classified,
  };
}

async function attachReplaySpecs(workflowName, hubRef, specs) {
  // Chunked self-loop attach to avoid oversized workflow update payloads.
  const out = [];
  let startId = 9301;
  for (let i = 0; i < specs.length; i += ATTACH_CHUNK) {
    const chunk = specs.slice(i, i + ATTACH_CHUNK);
    for (let attempt = 0; attempt < 2; attempt++) {
      const { top, wf } = await readWorkflow(workflowName);
      const existing = new Set((wf.transitions || []).map((t) => String(t.id)));
      let idNum = startId;
      const made = [];
      for (const spec of chunk) {
        while (existing.has(String(idNum))) idNum++;
        existing.add(String(idNum));
        let rule;
        try {
          rule = buildRule(spec.type, spec.config);
        } catch (e) {
          made.push({ spec, error: `buildRule: ${e.message}` });
          idNum++;
          continue;
        }
        const t = makeSelfLoop(hubRef, spec.name, idNum);
        attachRuleToTransition(t, spec.type, rule);
        wf.transitions.push(t);
        made.push({ spec, transitionId: String(idNum) });
        idNum++;
      }
      try {
        await updateWorkflow(top, wf);
        out.push(...made);
        startId = idNum;
        break;
      } catch (e) {
        if (attempt === 0 && /409|version/i.test(e.message)) continue;
        // record the whole chunk as attach-failed
        for (const spec of chunk) out.push({ spec, error: `attach: ${e.message.slice(0, 120)}` });
        startId = idNum;
        break;
      }
    }
  }
  return out;
}

async function ensureHubPool(projectKey, hubName, need) {
  let pool = await searchJql(`project = ${projectKey} AND status = "${hubName}" ORDER BY created DESC`, ["status"], Math.max(need, 50));
  if (pool.length >= need) return pool.slice(0, Math.max(need, pool.length)).map((i) => i.key);
  // seed extras
  const keys = pool.map((i) => i.key);
  while (keys.length < need) {
    const { key } = await findOrSeedIssue(projectKey, [], `CogniRunner replay pool ${keys.length + 1}`);
    keys.push(key);
    await sleep(200);
  }
  return keys;
}

async function observeAndScore(spec, transitionId, issueKey, fieldIndex) {
  const et = spec.effectiveType;
  const cfg = spec.record.config || {};
  const base = {
    ruleKey: `${spec.record.workflowName} :: ${spec.record.transitionName} [${spec.record.slot}]`,
    workflowName: spec.record.workflowName,
    transitionName: spec.record.transitionName,
    effectiveType: et,
    lane: et === "condition" ? "condition-mirror" : "replay",
    issueKey,
  };

  // set fit-for-purpose input
  if (et === "validator" || et === "condition") {
    const inputs = await synthesizeValidatorInputs(et === "condition" ? cfg : cfg, fieldIndex);
    if (inputs.failValue.set) await setFields(issueKey, { [inputs.fieldId]: inputs.failValue.value });
    base.input = `${inputs.fieldId}=${inputs.failValue.note}`;
    base.fieldValue = inputs.failValue.set ? JSON.stringify(inputs.failValue.value).slice(0, 120) : "(as-is)";
  } else {
    const src = await synthesizeSourceFor(cfg, fieldIndex);
    if (src.value.set) await setFields(issueKey, { [src.fieldId]: src.value.value });
    base.input = `source ${src.fieldId}=${src.value.note}`;
  }
  await sleep(400);

  // fire
  const before = (et !== "validator" && et !== "condition") ? await getIssue(issueKey, pfWatchFields(cfg)) : null;
  const t0 = Date.now();
  const res = await doTransition(issueKey, transitionId);
  const http = res.status;

  let reason = "", writtenValue = null, mutated = false, sideEffect = "";
  if (et === "validator" || et === "condition") {
    reason = http >= 400 ? parseReason(res.text) : "";
  } else {
    // poll for a mutation/side-effect
    const watch = pfWatchFields(cfg);
    const deadline = Date.now() + MUTATE_TIMEOUT;
    let after = before;
    do {
      await sleep(POLL_MS);
      after = await getIssue(issueKey, watch);
      const tgt = cfg.actionFieldId ? fieldText(after, cfg.actionFieldId) : "";
      const changedTarget = cfg.actionFieldId && tgt && tgt !== (before ? fieldText(before, cfg.actionFieldId) : "");
      const changedComment = commentCount(after) > commentCount(before);
      const changedSub = subtaskCount(after) > subtaskCount(before);
      const changedLink = linkCount(after) > linkCount(before);
      const changedAttach = attachCount(after) > attachCount(before);
      if (changedTarget || changedComment || changedSub || changedLink || changedAttach) {
        mutated = true;
        if (changedTarget) { writtenValue = tgt; sideEffect = `wrote ${cfg.actionFieldId}`; }
        else if (changedComment) sideEffect = "added comment";
        else if (changedSub) sideEffect = "created subtask";
        else if (changedLink) sideEffect = "added link";
        else if (changedAttach) sideEffect = "attached file";
        break;
      }
    } while (Date.now() < deadline);
  }
  const latencyMs = Date.now() - t0;

  // trace (debugTrace is on for replay/mirror)
  const trace = await readTrace(issueKey);
  if (!reason && trace?.reason) reason = String(trace.reason);

  const executed = !!trace || http >= 400 || mutated;
  const c = {
    ...base,
    http, reason, latencyMs, executed, mutated, sideEffect,
    writtenValue,
    verdict: (et === "validator" || et === "condition") ? (http >= 400 ? "BLOCKED" : "ALLOWED") : undefined,
    cogniDebug: trace ? { transientError: trace.transientError, toolMeta: trace.toolMeta, modelUsed: trace.modelUsed, isValid: trace.isValid, mode: trace.mode } : null,
    modelUsed: trace?.modelUsed || null,
  };
  c.grade = discoveredGrade(c);
  c.triage = triageCase(c);
  return c;
}

// ---- in-place (production path) --------------------------------------------

async function exerciseInPlace(record, classified, projects, fieldIndex) {
  const et = classified.effectiveType;
  const proj = projects[0];
  const out = { ruleKey: `${record.workflowName} :: ${record.transitionName} [${record.slot}]`, lane: "in-place", projectKey: proj.projectKey };
  try {
    const { key } = await findOrSeedIssue(proj.projectKey, proj.issueTypeIds, "CogniRunner in-place probe");
    out.issueKey = key;
    const cfg = record.config || {};
    if (et === "validator") {
      const inputs = await synthesizeValidatorInputs(cfg, fieldIndex);
      if (inputs.failValue.set) await setFields(key, { [inputs.fieldId]: inputs.failValue.value });
    } else {
      const src = await synthesizeSourceFor(cfg, fieldIndex);
      if (src.value.set) await setFields(key, { [src.fieldId]: src.value.value });
    }
    await sleep(400);
    const reach = await tryReach(key, record.transitionId, record.fromStatusNames, 3);
    if (!reach.reachable) { out.executed = false; out.note = `transition not reachable in-place (hops=${reach.hops}) — covered via replay`; return out; }
    const res = await doTransition(key, record.transitionId);
    out.http = res.status;
    out.verdict = res.status >= 400 ? "BLOCKED" : "ALLOWED";
    out.reason = res.status >= 400 ? parseReason(res.text).slice(0, 200) : "";
    const trace = await readTrace(key);
    out.executed = !!trace || res.status >= 400;
    out.modelUsed = trace?.modelUsed || null;
    out.note = trace ? "trace present" : (res.status >= 400 ? "blocked (proof)" : "allowed (no trace — production rule lacks debugTrace)");
  } catch (e) {
    out.executed = false;
    out.error = e.message.slice(0, 200);
  }
  return out;
}

// ---- main ------------------------------------------------------------------

async function main() {
  console.log(`Exercising every CogniRunner rule on ${BASE} ...\n`);
  const state = loadState();
  const cogtestWf = state.workflowName || "Software Simplified Workflow for Project COGTEST";
  const hubRef = state.hubStatusRef;
  const hubName = state.hubStatusName || "Backlog";
  const projectKey = state.projectKey || "COGTEST";
  if (!hubRef) console.log("⚠ no hubStatusRef in testbed state — run `npm run setup` first for the replay lane.");

  const fieldIndex = await fetchFieldIndex();
  const { rules } = await discoverAllRules();
  const projectIndex = await buildWorkflowProjectIndex();
  console.log(`Discovered ${rules.length} rule(s). Classifying + planning lanes...`);

  const planned = rules.map((record, i) => {
    const classified = classifyRule(record);
    const lane = decideLane(record, classified, projectIndex);
    return { record, classified, lane, i };
  });

  // ---- Replay backbone: attach all specs, fire each on a distinct hub issue ----
  const results = [];
  if (hubRef) {
    const specs = planned.map((p) => replaySpec(p.record, p.classified, p.i));
    console.log(`Attaching ${specs.length} replay/mirror self-loop(s) to "${cogtestWf}" (chunks of ${ATTACH_CHUNK})...`);
    const attached = await attachReplaySpecs(cogtestWf, hubRef, specs);
    const ok = attached.filter((a) => a.transitionId);
    const failed = attached.filter((a) => a.error);
    console.log(`Attached ${ok.length}; ${failed.length} could not attach.`);
    for (const f of failed) results.push({ ruleKey: `${f.spec.record.workflowName} :: ${f.spec.record.transitionName}`, lane: f.spec.effectiveType === "condition" ? "condition-mirror" : "replay", executed: false, error: f.error, grade: "HARD", triage: { bucket: "A", signal: "attachFailed", hardeningTarget: null, note: f.error } });

    const poolSize = Math.max(CONCURRENCY * 2, 8);
    const pool = await ensureHubPool(projectKey, hubName, poolSize);
    console.log(`Firing ${ok.length} replay case(s) at concurrency ${CONCURRENCY} over ${pool.length} hub issue(s)...`);

    let done = 0;
    const replayResults = await mapLimit(ok, CONCURRENCY, async (a, idx) => {
      const issueKey = pool[idx % pool.length];
      let r;
      try { r = await observeAndScore(a.spec, a.transitionId, issueKey, fieldIndex); }
      catch (e) { r = { ruleKey: `${a.spec.record.workflowName} :: ${a.spec.record.transitionName}`, lane: a.spec.effectiveType === "condition" ? "condition-mirror" : "replay", executed: false, error: e.message.slice(0, 200), grade: "HARD", triage: { bucket: "A", signal: "harnessError", hardeningTarget: null, note: e.message.slice(0, 120) } }; }
      done++;
      if (done % 10 === 0 || done === ok.length) {
        const tg = r.triage ? ` [${r.triage.bucket}:${r.triage.signal}]` : "";
        console.log(`  ${done}/${ok.length} ${r.effectiveType || "?"} exec=${r.executed} ${r.verdict || r.sideEffect || ""}${tg}`);
      }
      return r;
    });
    results.push(...replayResults);
  }

  // ---- In-place production-path confirmation (GLOBAL rules) ----
  if (IN_PLACE) {
    const inPlaceTargets = planned.filter((p) =>
      p.lane.lane === "in-place" &&
      (p.record.transitionType === "GLOBAL" || p.record.transitionType === "GLOBAL_LOOP") &&
      p.lane.projects.length
    );
    if (inPlaceTargets.length) {
      console.log(`\nIn-place confirmation on ${inPlaceTargets.length} GLOBAL rule(s) in their home projects...`);
      const ip = await mapLimit(inPlaceTargets, Math.min(CONCURRENCY, 3), (p) => exerciseInPlace(p.record, p.classified, p.lane.projects, fieldIndex));
      results.push(...ip.map((r) => ({ ...r, inPlace: true })));
    }
  }

  // ---- aggregate-pass escalation + rollup ----
  const promoted = escalateRecurring(results);
  if (promoted) console.log(`\nEscalated ${promoted} recurring parse-flavored case(s) to system-bug (Bucket A).`);

  const replayCov = results.filter((r) => r.lane === "replay" || r.lane === "condition-mirror");
  const executed = replayCov.filter((r) => r.executed).length;
  const buckets = { A: 0, B: 0, C: 0 };
  for (const r of results) if (r.triage) buckets[r.triage.bucket] = (buckets[r.triage.bucket] || 0) + 1;

  writeResult("discovered-results.json", { base: BASE, generatedNote: "stamp at report time", total: results.length, replayExecuted: executed, replayTotal: replayCov.length, buckets, results });

  console.log(`\n=== Coverage (replay backbone) ===`);
  console.log(`  exercised: ${executed}/${replayCov.length} rules with a confirmed execution`);
  console.log(`  triage buckets: A(system)=${buckets.A}  B(model)=${buckets.B}  C(expected)=${buckets.C}`);
  const systemBugs = results.filter((r) => r.triage?.bucket === "A");
  if (systemBugs.length) {
    console.log(`\n=== ${systemBugs.length} SYSTEM-BUG signal(s) (drive hardening) ===`);
    const bySig = {};
    for (const r of systemBugs) (bySig[r.triage.signal] ||= []).push(r);
    for (const [sig, rs] of Object.entries(bySig)) {
      console.log(`  ${rs.length}× ${sig} → ${rs[0].triage.hardeningTarget || "(see logs)"}`);
      console.log(`      e.g. ${rs[0].ruleKey}: ${(rs[0].reason || rs[0].error || rs[0].triage.note || "").slice(0, 120)}`);
    }
  }
  console.log(`\nWrote results/discovered-results.json`);
  console.log(`Cleanup: CLEAN=1 npm run audit  (removes DISCO-/CMIRROR- transitions); delete seeded issues by  labels = ${DISCO_LABEL}`);
}

main().catch((e) => {
  console.error("EXERCISE FAILED:", e.message);
  if (e.body) console.error(JSON.stringify(e.body).slice(0, 600));
  process.exit(1);
});
