/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * STAGE 3 — AGGRESSIVE LM STUDIO STRESS TEST.
 * The normal suites are tame: validators run sync and only ~1 PF queues per issue.
 * This deliberately FLOODS the async-ai-queue with HEAVY post-functions (semantic,
 * fact-checked semantic, comment, subtask, generate-doc, research) fired at high
 * concurrency across many DISTINCT issues (to dodge the per-issue 10/5min PF brake),
 * plus agentic validators that hold a worker for multiple rounds. Result: the Active
 * Jobs panel fills deep and the LM Studio worker pool + async consumer + graceful-
 * degradation paths all get hammered. We then characterize behavior from the
 * cogni-debug traces (queueDelayMs, modelUsed) and the captured forge logs.
 *
 *   node scripts/stress-lmstudio.mjs
 *   STRESS_CONCURRENCY=32  STRESS_FIRES=500  STRESS_ISSUES=120
 *   STRESS_DRAIN_WAIT=180   seconds to watch the queue drain after firing (0 = skip)
 */

import { get, put, doTransition, searchJql, mapLimit, sleep, BASE, stats, resetStats } from "../lib/jira.mjs";
import { readWorkflow, updateWorkflow, makeSelfLoop, buildRule, attachRuleToTransition } from "../lib/workflow.mjs";
import { loadState, writeResult } from "../lib/state.mjs";
import { adfDoc } from "../lib/synthesize.mjs";

const CONCURRENCY = parseInt(process.env.STRESS_CONCURRENCY || "32", 10);
const FIRES = parseInt(process.env.STRESS_FIRES || "500", 10);
const ISSUES = parseInt(process.env.STRESS_ISSUES || "120", 10);
const DRAIN_WAIT = parseInt(process.env.STRESS_DRAIN_WAIT || "180", 10);

const RICH = "Saved-card checkout intermittently returns HTTP 500 after release v2.3. Repro: log in, add a saved card, submit payment twice within 5s — the second call 500s ~30% of the time. Impact: ~3% of checkout attempts fail; revenue-affecting. Acceptance criteria: idempotency key honored; no 500s under concurrent submit; regression test added; dashboard alert on the 500 rate.";

function heavyRules(cf) {
  const text = cf.text && cf.text.id;
  const lead = loadState().leadAccountId;
  // Each of these QUEUES an async LM Studio job per fire (slowProvider/heavy path).
  return [
    { key: "STRESS-semantic", type: "semantic", config: { type: "postfunction-semantic", fieldId: "description", conditionPrompt: "Run every time", actionPrompt: "Write a one-sentence technical summary of this issue.", actionFieldId: text } },
    { key: "STRESS-crosscheck", type: "semantic", config: { type: "postfunction-semantic", fieldId: "description", conditionPrompt: "Run every time", actionPrompt: "Summarize the root cause in one sentence.", actionFieldId: text, crossCheckClaims: true } },
    { key: "STRESS-comment", type: "comment", config: { type: "postfunction-comment", fieldId: "description", commentPrompt: "Write a concise triage comment: one-line summary, most likely root cause, and the single most useful next step." } },
    { key: "STRESS-subtask", type: "subtask", config: { type: "postfunction-subtask", fieldId: "description", subtaskPrompt: "Write a single concrete implementation subtask as a short imperative title." } },
    { key: "STRESS-gendoc", type: "generate-doc", config: { type: "postfunction-generate-doc", fieldId: "description", contentPrompt: "Draft a short root-cause analysis: summary, timeline, root cause, remediation.", docTitlePrompt: "RCA", docFormat: "markdown", attachComment: true, actorAccountId: lead } },
    { key: "STRESS-research", type: "research", config: { type: "postfunction-research", fieldId: "description", researchQuery: "Mitigations for idempotency failures in payment retries.", researchTitle: "Idempotency research", actorAccountId: lead } },
    { key: "STRESS-agentic", type: "validator", config: { fieldId: "summary", prompt: "Search Jira for existing issues that describe the same bug as this one. FAIL if a duplicate exists; PASS if unique. Use the search tool.", enableTools: true } },
  ].filter((r) => (r.type === "validator" ? r.config.fieldId : r.config.actionFieldId || r.type === "comment" || r.type === "subtask" || r.type.includes("doc") || r.type === "research"))
   .map((r) => { r.config.debugTrace = true; return r; });
}

async function readTrace(key) { try { const r = await get(`/rest/api/3/issue/${key}/properties/cogni-debug`, { raw: true }); if (r.status >= 400) return null; return JSON.parse(r.text).value; } catch { return null; } }

async function main() {
  console.log(`STAGE 3 — AGGRESSIVE LM STUDIO STRESS TEST on ${BASE}\n`);
  const state = loadState();
  const cf = state.customFields || {};
  const wfName = state.workflowName;
  const hubRef = state.hubStatusRef;
  const hubName = state.hubStatusName || "Backlog";
  const projectKey = state.projectKey || "COGTEST";
  if (!hubRef || !wfName) throw new Error("Run `npm run setup` first.");

  const rules = heavyRules(cf);
  console.log(`Heavy rule types (each fire queues/holds an LM Studio job): ${rules.map((r) => r.key).join(", ")}`);

  // attach heavy self-loops (idempotent)
  for (let attempt = 0; attempt < 2; attempt++) {
    const { top, wf } = await readWorkflow(wfName);
    wf.transitions = (wf.transitions || []).filter((t) => !String(t.name || "").startsWith("STRESS-"));
    const existing = new Set(wf.transitions.map((t) => String(t.id)));
    let id = 9601; rules.forEach((r) => { while (existing.has(String(id))) id++; existing.add(String(id)); const rule = buildRule(r.type, r.config); const t = makeSelfLoop(hubRef, r.key, id); attachRuleToTransition(t, r.type, rule); wf.transitions.push(t); r.tid = String(id); id++; });
    try { await updateWorkflow(top, wf); break; } catch (e) { if (attempt === 0 && /409|version/i.test(e.message)) continue; throw e; }
  }
  console.log(`Attached ${rules.length} heavy self-loops.`);

  // distinct on-hub issues (spread fires so the per-issue 10/5min brake doesn't suppress)
  const pool = (await searchJql(`project = ${projectKey} AND status = "${hubName}" ORDER BY created DESC`, ["status"], Math.max(ISSUES, 50))).map((i) => i.key).slice(0, ISSUES);
  if (pool.length < 10) throw new Error(`only ${pool.length} hub issues — run reset-to-hub + seed first.`);
  console.log(`Issue pool: ${pool.length} distinct on-hub issues.`);

  // Pre-populate descriptions so the heavy PFs have substantive material (best-effort, parallel).
  console.log("Priming issue descriptions…");
  await mapLimit(pool, 12, async (k) => { try { await put(`/rest/api/3/issue/${k}`, { fields: { description: adfDoc(RICH) } }); } catch { /* off-screen */ } });

  // Build the flood work list: round-robin (heavy rule × distinct issue), capped per issue.
  const perIssueCap = 9; // < PF brake (10/5min)
  const work = []; const issueCount = {};
  let ri = 0;
  while (work.length < FIRES) {
    const issue = pool[work.length % pool.length];
    issueCount[issue] = (issueCount[issue] || 0) + 1;
    if (issueCount[issue] > perIssueCap) { if (work.length >= pool.length * perIssueCap) break; continue; }
    const rule = rules[ri % rules.length]; ri++;
    work.push({ rule, issue });
  }
  console.log(`\nFLOODING: ${work.length} heavy fires @ concurrency ${CONCURRENCY} (spread over ${pool.length} issues).`);
  console.log(`Watch the admin Active Jobs panel now — it should fill deep.\n`);

  resetStats();
  const t0 = Date.now();
  let fired = 0, http4xx = 0, http429 = 0, errors = 0;
  const fires = await mapLimit(work, CONCURRENCY, async (w) => {
    const ts = Date.now();
    let status = 0;
    try { const r = await doTransition(w.issue, w.rule.tid); status = r.status; }
    catch (e) { status = e.status || -1; errors++; }
    if (status === 429) http429++; else if (status >= 400) http4xx++;
    fired++;
    if (fired % 50 === 0) console.log(`  fired ${fired}/${work.length}  (4xx=${http4xx} 429=${http429} err=${errors})  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    return { issue: w.issue, key: w.rule.key, type: w.rule.type, status, ts };
  });
  const fireWallMs = Date.now() - t0;
  const fireRate = (work.length / (fireWallMs / 1000)).toFixed(1);
  console.log(`\nFired ${work.length} in ${(fireWallMs / 1000).toFixed(0)}s = ${fireRate} fires/s. Jira: ${stats.requests} req, ${stats.status429} x429, ${stats.retries} retries.`);

  // Watch the queue drain: sample distinct issues' cogni-debug for queueDelayMs + model spread.
  let drain = { sampled: 0, withTrace: 0, queueDelays: [], models: {}, transient: 0, timedOut: 0 };
  if (DRAIN_WAIT > 0) {
    console.log(`\nWatching the drain for ${DRAIN_WAIT}s (queueDelayMs = how backed-up the queue got)…`);
    const sampleKeys = [...new Set(fires.map((f) => f.issue))].slice(0, 40);
    const deadline = Date.now() + DRAIN_WAIT * 1000;
    while (Date.now() < deadline) {
      await sleep(15000);
      for (const k of sampleKeys) {
        const tr = await readTrace(k);
        if (!tr) continue;
        drain.withTrace++;
        if (typeof tr.queueDelayMs === "number") drain.queueDelays.push(tr.queueDelayMs);
        if (tr.modelUsed) drain.models[tr.modelUsed] = (drain.models[tr.modelUsed] || 0) + 1;
        if (tr.transientError) drain.transient++;
      }
      const qd = drain.queueDelays;
      const avg = qd.length ? Math.round(qd.reduce((a, b) => a + b, 0) / qd.length) : 0;
      const max = qd.length ? Math.max(...qd) : 0;
      console.log(`  drain probe: traces=${drain.withTrace} models=${Object.keys(drain.models).length} avgQueueDelay=${avg}ms maxQueueDelay=${max}ms transient=${drain.transient}`);
    }
    drain.sampled = sampleKeys.length;
  }

  const qd = drain.queueDelays;
  const summary = {
    base: BASE, concurrency: CONCURRENCY, fires: work.length, fireWallMs, fireRate: Number(fireRate),
    http4xx, http429, errors, jira: { requests: stats.requests, status429: stats.status429, retries: stats.retries },
    drain: { models: drain.models, distinctModels: Object.keys(drain.models).length,
      queueDelayMs: { count: qd.length, avg: qd.length ? Math.round(qd.reduce((a, b) => a + b, 0) / qd.length) : 0, max: qd.length ? Math.max(...qd) : 0 },
      transient: drain.transient },
    statusHistogram: fires.reduce((h, f) => { h[f.status] = (h[f.status] || 0) + 1; return h; }, {}),
  };
  writeResult("stress-lmstudio.json", { ...summary, fires });

  console.log(`\n=== STRESS SUMMARY ===`);
  console.log(`  fires: ${work.length} @ conc ${CONCURRENCY} → ${fireRate}/s`);
  console.log(`  transition status: ${JSON.stringify(summary.statusHistogram)}`);
  console.log(`  Jira throttle: ${stats.status429} x429, ${stats.retries} retries`);
  console.log(`  worker spread (from traces): ${JSON.stringify(drain.models)} (${summary.drain.distinctModels} models)`);
  console.log(`  queue delay: avg ${summary.drain.queueDelayMs.avg}ms max ${summary.drain.queueDelayMs.max}ms (n=${qd.length}) — high = deep queue under load`);
  console.log(`  transient fail-opens: ${drain.transient}`);
  console.log(`\nNow run:  node scripts/_forge-logs.mjs --review   for the backend-side stress picture (lm-pool spread, timeouts, errors).`);
  console.log(`Cleanup:  CLEAN=1 npm run audit  (removes STRESS- transitions).`);
}

main().catch((e) => { console.error("STRESS FAILED:", e.message); if (e.body) console.error(JSON.stringify(e.body).slice(0, 400)); process.exit(1); });
