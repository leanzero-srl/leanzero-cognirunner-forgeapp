/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 *
 * MEGA volume pass — run the active (weak) model over EVERY issue on the instance
 * through the OWNER'S REAL deployed rules, in place. For each project that has
 * CogniRunner rules on a GLOBAL transition, fire that transition on every issue in
 * the project: its validators run synchronously (verdict observed live) and its
 * post-functions queue. This is the forcing-function at full scale — maximum real
 * content variety through the system, triaged for SYSTEM bugs (Bucket A).
 *
 * Resumable: appends to results/mega-issues.jsonl (caseId = issueKey__transitionId).
 *   node scripts/mega-issues.mjs                full sweep over all issues
 *   node scripts/mega-issues.mjs --resume       skip already-fired (issue,transition)
 *   MEGA_CONCURRENCY=6  MEGA_MAX_PER_PROJECT=0 (0 = all; >0 caps + logs the cap)
 *   MEGA_PROJECTS=COGTEST,WFH  (restrict to specific projects)
 */

import { post, get, doTransition, mapLimit, sleep, BASE } from "../lib/jira.mjs";
import { writeResult, RESULTS_DIR, ensureResults } from "../lib/state.mjs";
import { discoverAllRules, buildWorkflowProjectIndex } from "../lib/discover.mjs";
import { classifyRule } from "../lib/classify.mjs";
import { triageCase, escalateRecurring } from "../lib/triage.mjs";
import { readFileSync, existsSync, appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CONCURRENCY = parseInt(process.env.MEGA_CONCURRENCY || "6", 10);
const MAX_PER_PROJECT = parseInt(process.env.MEGA_MAX_PER_PROJECT || "0", 10);
const ONLY_PROJECTS = (process.env.MEGA_PROJECTS || "").split(",").map((s) => s.trim()).filter(Boolean);
const RESUME = process.argv.includes("--resume");
const FORCE = process.argv.includes("--force");
const JSONL = join(RESULTS_DIR, "mega-issues.jsonl");

const RE_PARSE = /malformed json|not valid json|after \d+ round|cannot deserialize|unexpected token|failed to parse|json ?parse/i;
const RE_ERRORISH = /ai service error|temporarily unavailable|empty response|service (unavailable|down)|timed out|timeout|rate ?limit/i;

function parseReason(text) {
  try { const j = JSON.parse(text || "{}"); const m = j.errorMessages || []; const e = j.errors ? Object.values(j.errors) : []; return [...m, ...e].join(" | "); }
  catch { return text || ""; }
}
async function readTrace(key) {
  try { const r = await get(`/rest/api/3/issue/${key}/properties/cogni-debug`, { raw: true }); if (r.status >= 400) return null; return JSON.parse(r.text).value; } catch { return null; }
}
function grade(http, reason, trace) {
  if (http >= 500) return "HARD";
  if (RE_PARSE.test(reason)) return "HARD";
  if (RE_ERRORISH.test(reason) && trace?.transientError !== true && http >= 400) return "HARD";
  if (trace?.transientError === true) return "SOFT";
  return "PASS";
}

// Pull ALL issues for a project (full pagination, no 2000 cap).
async function allIssues(projectKey, cap) {
  const out = [];
  let token;
  do {
    const body = { jql: `project = "${projectKey}" ORDER BY created ASC`, fields: ["status"], maxResults: 100 };
    if (token) body.nextPageToken = token;
    const page = await post("/rest/api/3/search/jql", body);
    out.push(...(page.issues || []));
    token = page.nextPageToken;
    if (cap > 0 && out.length >= cap) return out.slice(0, cap);
  } while (token);
  return out;
}

function loadDone() {
  if (!existsSync(JSONL)) return new Set();
  const s = new Set();
  for (const l of readFileSync(JSONL, "utf8").split("\n")) { if (!l.trim()) continue; try { const o = JSON.parse(l); if (o.caseId) s.add(o.caseId); } catch {} }
  return s;
}

async function main() {
  ensureResults();
  console.log(`MEGA volume pass over all issues on ${BASE}\n`);

  const { rules } = await discoverAllRules();
  const projectIndex = await buildWorkflowProjectIndex();

  // GLOBAL transitions carrying CogniRunner rules, grouped by workflow.
  // (Validators run sync on the REST path; conditions don't (F3) but PFs queue.)
  const globalTransByWf = {}; // wf -> Map(transitionId -> {name, ruleTypes:Set})
  for (const r of rules) {
    if (r.transitionType !== "GLOBAL" && r.transitionType !== "GLOBAL_LOOP") continue;
    const et = classifyRule(r).effectiveType;
    const m = (globalTransByWf[r.workflowName] ||= new Map());
    if (!m.has(r.transitionId)) m.set(r.transitionId, { name: r.transitionName, ruleTypes: new Set() });
    m.get(r.transitionId).ruleTypes.add(et);
  }

  // Build fire targets per project.
  const targets = []; // { projectKey, transitionId, transitionName, ruleTypes }
  const projectsSeen = new Set();
  for (const [wf, m] of Object.entries(globalTransByWf)) {
    const projs = projectIndex.get(wf) || [];
    for (const p of projs) {
      if (ONLY_PROJECTS.length && !ONLY_PROJECTS.includes(p.projectKey)) continue;
      projectsSeen.add(p.projectKey);
      for (const [tid, info] of m) targets.push({ projectKey: p.projectKey, transitionId: tid, transitionName: info.name, ruleTypes: [...info.ruleTypes] });
    }
  }
  // dedupe targets (a workflow may map to a project once)
  const seenT = new Set();
  const fireTargets = targets.filter((t) => { const k = `${t.projectKey}__${t.transitionId}`; if (seenT.has(k)) return false; seenT.add(k); return true; });

  console.log(`GLOBAL rule-transitions to fire across ${projectsSeen.size} project(s): ${fireTargets.length}`);
  for (const p of projectsSeen) {
    const ts = fireTargets.filter((t) => t.projectKey === p);
    console.log(`  ${p}: ${ts.map((t) => `${t.transitionName}[${t.ruleTypes.join("/")}]`).join(", ")}`);
  }

  // Pull issues per project + build the (issue × transition) work list.
  const work = [];
  for (const p of projectsSeen) {
    const issues = await allIssues(p, MAX_PER_PROJECT);
    if (MAX_PER_PROJECT > 0) console.log(`  ⚠ ${p}: capped at ${MAX_PER_PROJECT} issue(s) (MEGA_MAX_PER_PROJECT)`);
    console.log(`  ${p}: ${issues.length} issue(s)`);
    const ts = fireTargets.filter((t) => t.projectKey === p);
    for (const iss of issues) for (const t of ts) work.push({ issueKey: iss.key, ...t });
  }

  const done = (RESUME && !FORCE) ? loadDone() : new Set();
  if (!RESUME) writeFileSync(JSONL, "");
  const todo = work.filter((w) => !done.has(`${w.issueKey}__${w.transitionId}`));
  console.log(`\nMEGA work: ${todo.length} (issue × GLOBAL-transition) fire(s)${RESUME ? ` (resume; ${work.length - todo.length} already done)` : ""} @ concurrency ${CONCURRENCY}.`);
  console.log(`This fires the owner's real rules on every issue. Validators gate live; PFs queue async.\n`);

  const results = [];
  let n = 0;
  await mapLimit(todo, CONCURRENCY, async (w) => {
    const caseId = `${w.issueKey}__${w.transitionId}`;
    let rec;
    try {
      const res = await doTransition(w.issueKey, w.transitionId);
      const http = res.status;
      const reason = http >= 400 ? parseReason(res.text) : "";
      await sleep(150);
      const trace = await readTrace(w.issueKey);
      const g = grade(http, reason, trace);
      const c = { type: "validator", http, reason, cogniDebug: trace, grade: g };
      rec = {
        caseId, issueKey: w.issueKey, projectKey: w.projectKey, transitionId: w.transitionId, transitionName: w.transitionName,
        ruleTypes: w.ruleTypes, http, verdict: http >= 400 ? "BLOCKED" : "ALLOWED", reason: reason.slice(0, 300),
        modelUsed: trace?.modelUsed || null, grade: g, triage: triageCase(c), at: Date.now(),
      };
    } catch (e) {
      rec = { caseId, issueKey: w.issueKey, projectKey: w.projectKey, transitionId: w.transitionId, http: 0, grade: "HARD", error: e.message.slice(0, 200), triage: triageCase({ type: "validator", http: 0, reason: e.message, grade: "HARD" }), at: Date.now() };
    }
    appendFileSync(JSONL, JSON.stringify(rec) + "\n");
    results.push(rec);
    n++;
    if (n % 50 === 0 || n === todo.length) {
      const a = results.filter((r) => r.triage?.bucket === "A").length;
      console.log(`  ${n}/${todo.length} fired · blocked=${results.filter((r) => r.verdict === "BLOCKED").length} · systemBugs(A)=${a}`);
    }
    return rec;
  });

  const promoted = escalateRecurring(results);
  if (promoted) console.log(`Escalated ${promoted} recurring parse-flavored case(s) to Bucket A.`);

  const buckets = { A: 0, B: 0, C: 0 };
  const models = {};
  for (const r of results) { if (r.triage) buckets[r.triage.bucket]++; if (r.modelUsed) models[r.modelUsed] = (models[r.modelUsed] || 0) + 1; }
  writeResult("mega-issues-summary.json", { base: BASE, total: results.length, projects: [...projectsSeen], fireTargets: fireTargets.length, buckets, models });

  console.log(`\n=== MEGA volume summary ===`);
  console.log(`  fired: ${results.length}  blocked: ${results.filter((r) => r.verdict === "BLOCKED").length}  allowed: ${results.filter((r) => r.verdict === "ALLOWED").length}`);
  console.log(`  model spread: ${JSON.stringify(models)}`);
  console.log(`  triage: A(system)=${buckets.A}  B(model)=${buckets.B}  C(expected)=${buckets.C}`);
  const sys = results.filter((r) => r.triage?.bucket === "A");
  if (sys.length) {
    const bySig = {};
    for (const r of sys) (bySig[r.triage.signal] ||= []).push(r);
    console.log(`\n=== SYSTEM-BUG signals (Bucket A → hardening) ===`);
    for (const [sig, rs] of Object.entries(bySig)) {
      console.log(`  ${rs.length}× ${sig} → ${rs[0].triage.hardeningTarget || "(forge logs)"}`);
      console.log(`      e.g. ${rs[0].issueKey} ${rs[0].transitionName}: ${(rs[0].reason || rs[0].error || "").slice(0, 110)}`);
    }
  }
  console.log(`\nAppended ${results.length} fire(s) to results/mega-issues.jsonl`);
}

main().catch((e) => { console.error("MEGA FAILED:", e.message); if (e.body) console.error(JSON.stringify(e.body).slice(0, 400)); process.exit(1); });
