/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// LM Studio multi-model pool — PROOF.
//
// The backend now spreads runtime validator AI calls across every LOADED LM
// Studio model (resolveLmStudioModel + cogni-debug.modelUsed). This script
// proves it black-box: attach a debugTrace validator self-loop on the hub,
// fire it on N distinct on-hub issues CONCURRENTLY, then read each issue's
// `cogni-debug` property to learn which model actually served that call.
//
// It reports:
//   • a histogram of modelUsed across the flood,
//   • how many distinct models served (must be >= MM_EXPECT_MODELS, default 3),
//   • cross-model concurrency: pairs of fires whose client-measured AI windows
//     OVERLAP while using DIFFERENT models (direct proof of parallel inference),
//   • peak distinct models in flight at any instant.
//
// Exits non-zero if fewer than MM_EXPECT_MODELS distinct models served — i.e.
// the spread did not happen (provider not LM Studio, pool disabled, <N loaded,
// or /api/v1/models unavailable).
//
// Env: MM_FIRES (default 30), MM_CONCURRENCY (default 8), MM_EXPECT_MODELS (3).

import { searchJql, doTransition, get, sleep, mapLimit, resetStats, stats } from "../lib/jira.mjs";
import { readWorkflow, updateWorkflow, makeSelfLoop, buildRule, attachRuleToTransition } from "../lib/workflow.mjs";
import { loadState, writeResult } from "../lib/state.mjs";

const POOL_NAME = "CT-LmPool";
const FIRES = parseInt(process.env.MM_FIRES || "30", 10);
const CONC = parseInt(process.env.MM_CONCURRENCY || "8", 10);
const EXPECT = parseInt(process.env.MM_EXPECT_MODELS || "3", 10);

// Benign, non-agentic prompt: the verdict is irrelevant — we only need the AI
// call to RUN so the pool picks a model. enableTools:false => one fast native
// call per fire (no agentic loop, no tool round-trips).
const PROMPT =
  "Judge whether the issue summary names a software-related task. Respond isValid:true unless the text is completely empty or pure gibberish; keep the reason to one short sentence.";

async function attachPoolValidator(s) {
  const { top, wf } = await readWorkflow(s.workflowName);
  wf.transitions = (wf.transitions || []).filter((t) => t.name !== POOL_NAME);
  const existing = new Set(wf.transitions.map((t) => String(t.id)));
  let id = 9700;
  while (existing.has(String(id))) id++;
  const t = makeSelfLoop(s.hubStatusRef, POOL_NAME, id);
  const rule = buildRule("validator", { fieldId: "summary", prompt: PROMPT, enableTools: false, debugTrace: true });
  attachRuleToTransition(t, "validator", rule);
  wf.transitions.push(t);
  await updateWorkflow(top, wf);
  return String(id);
}

async function readDebug(key) {
  const r = await get(`/rest/api/3/issue/${key}/properties/cogni-debug`, { raw: true });
  if (r.status >= 400) return null;
  try { return JSON.parse(r.text).value; } catch { return null; }
}

const overlaps = (a, b) => a.t0 < b.t1 && b.t0 < a.t1;

// Peak number of DISTINCT models whose AI windows are simultaneously in flight.
function peakDistinctInFlight(fires) {
  const evts = [];
  for (const f of fires) {
    if (!f.modelUsed) continue;
    evts.push({ t: f.t0, d: +1, m: f.modelUsed });
    evts.push({ t: f.t1, d: -1, m: f.modelUsed });
  }
  evts.sort((a, b) => a.t - b.t || a.d - b.d); // exits before entries at same instant
  const live = new Map();
  let peak = 0;
  for (const e of evts) {
    const n = (live.get(e.m) || 0) + e.d;
    if (n <= 0) live.delete(e.m); else live.set(e.m, n);
    if (live.size > peak) peak = live.size;
  }
  return peak;
}

async function main() {
  const s = loadState();
  if (!s.workflowName) throw new Error("Run `npm run setup` first (no testbed state).");
  const hubName = s.hubStatusName || "Backlog";

  const transitionId = await attachPoolValidator(s);
  console.log(`Pool validator attached on transition ${transitionId} (field=summary, debugTrace=on, non-agentic).`);

  // Pre-flight: one fire to confirm reachability + that modelUsed is populated.
  const probeRows = await searchJql(`project=${s.projectKey} AND status="${hubName}"`, ["summary"], 400);
  if (probeRows.length === 0) throw new Error(`No issues on hub status "${hubName}" — run reset-to-hub.mjs first.`);
  {
    const k = probeRows[0].key;
    const r = await doTransition(k, transitionId);
    await sleep(400);
    const dbg = await readDebug(k);
    console.log(`Pre-flight: ${k} -> HTTP ${r.status}, modelUsed=${dbg?.modelUsed ?? "(none)"}, isValid=${dbg?.isValid ?? "?"}`);
    if (!dbg?.modelUsed) {
      console.log("⚠ modelUsed is empty — the active provider may not be LM Studio, the pool is OFF, or <2 models are loaded. Continuing to measure anyway.");
    }
  }

  // One fire per DISTINCT issue (so each issue's cogni-debug reflects exactly one
  // call — no overwrite races). Cap to however many issues are on the hub.
  const want = Math.min(FIRES, probeRows.length);
  const targets = probeRows.slice(0, want);
  if (want < FIRES) console.log(`Note: only ${want} issues on the hub — firing ${want} (requested ${FIRES}).`);
  console.log(`\nFiring ${want} validator transitions at concurrency ${CONC} ...`);

  resetStats();
  const tStart = Date.now();
  const fires = await mapLimit(targets, CONC, async (iss) => {
    const key = iss.key;
    const t0 = Date.now();
    let httpStatus = 0;
    try { const r = await doTransition(key, transitionId); httpStatus = r.status; }
    catch (e) { httpStatus = e.status || -1; }
    const t1 = Date.now();
    await sleep(250); // let the debugTrace property settle
    const dbg = await readDebug(key);
    return {
      key, t0, t1, ms: t1 - t0, httpStatus,
      modelUsed: dbg?.modelUsed ?? null,
      isValid: dbg?.isValid ?? null,
      execMs: dbg?.executionTimeMs ?? null,
      transient: dbg?.transientError ?? false,
    };
  });
  const wallMs = Date.now() - tStart;

  // Histogram
  const hist = {};
  for (const f of fires) { const m = f.modelUsed || "(none)"; hist[m] = (hist[m] || 0) + 1; }
  const distinct = Object.keys(hist).filter((m) => m !== "(none)");
  const noneCount = hist["(none)"] || 0;

  // Cross-model concurrency: overlapping windows using different models.
  const withModel = fires.filter((f) => f.modelUsed);
  let crossOverlaps = 0;
  const samplePairs = [];
  for (let a = 0; a < withModel.length; a++) {
    for (let b = a + 1; b < withModel.length; b++) {
      if (withModel[a].modelUsed !== withModel[b].modelUsed && overlaps(withModel[a], withModel[b])) {
        crossOverlaps++;
        if (samplePairs.length < 8) samplePairs.push(`${withModel[a].modelUsed} ∥ ${withModel[b].modelUsed}`);
      }
    }
  }
  const peak = peakDistinctInFlight(fires);

  // Report
  const median = (arr) => { if (!arr.length) return 0; const a = [...arr].sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
  console.log(`\n=== modelUsed histogram (${fires.length} fires, wall ${(wallMs / 1000).toFixed(1)}s) ===`);
  for (const [m, c] of Object.entries(hist).sort((x, y) => y[1] - x[1])) {
    const bar = "█".repeat(c);
    console.log(`  ${String(c).padStart(3)}  ${bar}  ${m}`);
  }
  console.log(`\nDistinct models that served : ${distinct.length}  [${distinct.join(", ")}]`);
  console.log(`Median AI window (client)   : ${median(fires.map((f) => f.ms))} ms`);
  console.log(`Cross-model concurrent pairs: ${crossOverlaps}  (different models running at the same instant)`);
  if (samplePairs.length) console.log(`  e.g. ${samplePairs.slice(0, 5).join("  ·  ")}`);
  console.log(`Peak distinct models in flight simultaneously: ${peak}`);
  if (noneCount) console.log(`Fires with no modelUsed: ${noneCount}`);
  console.log(`Jira REST: ${stats.requests} req, ${stats.status429} x429, ${stats.retries} retries`);

  writeResult("lmstudio-multimodel.json", {
    transitionId, fired: fires.length, wallMs, hist, distinct,
    crossOverlaps, peakInFlight: peak, samplePairs, fires,
  });
  console.log("\nWrote results/lmstudio-multimodel.json");

  if (distinct.length >= EXPECT && crossOverlaps > 0) {
    console.log(`\n✓ PASS — ${distinct.length} distinct models served the flood (≥${EXPECT}) AND ran concurrently (peak ${peak} in flight).`);
  } else if (distinct.length >= EXPECT) {
    console.log(`\n~ PARTIAL — all ${distinct.length} models were used, but no overlapping windows were observed. Raise MM_CONCURRENCY and re-run to demonstrate true parallelism.`);
  } else {
    console.log(`\n✗ FAIL — only ${distinct.length} distinct model(s) served (expected ≥${EXPECT}). Check: active provider = LM Studio? pool enabled? ${EXPECT}+ models loaded? /api/v1/models reachable?`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("MULTIMODEL FAILED:", e.message);
  if (e.body) console.error(JSON.stringify(e.body).slice(0, 400));
  process.exit(1);
});
