/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// LM Studio multi-model pool — PROOF + EVIDENCE.
//
// The backend spreads runtime validator AI calls across every LOADED LM Studio
// model (resolveLmStudioModel + cogni-debug.modelUsed). This script proves it
// black-box: attach a debugTrace validator self-loop on the hub, fire it on N
// distinct on-hub issues CONCURRENTLY (optionally over several rounds), then read
// each issue's `cogni-debug` property to learn which model actually served it.
//
// Output:
//   • histogram of modelUsed across the whole battery,
//   • PER-MODEL EVIDENCE: for each model, sample rows (issue key + HTTP verdict +
//     the AI's own reason + the client-measured AI window) — concrete proof that
//     each specific model produced a real verdict on a real issue,
//   • one RAW cogni-debug payload dumped per model (hard, un-summarized proof),
//   • cross-model concurrency (overlapping AI windows on different models) + peak
//     distinct models in flight,
//   • a written evidence file results/lmstudio-multimodel-evidence.md.
//
// Exits non-zero if fewer than MM_EXPECT_MODELS distinct models served.
//
// Env: MM_FIRES (per round, default 30), MM_ROUNDS (default 1), MM_CONCURRENCY
//      (default 6), MM_EXPECT_MODELS (default 3).

import { searchJql, doTransition, get, sleep, mapLimit, resetStats, stats } from "../lib/jira.mjs";
import { readWorkflow, updateWorkflow, makeSelfLoop, buildRule, attachRuleToTransition } from "../lib/workflow.mjs";
import { loadState, writeResult, RESULTS_DIR } from "../lib/state.mjs";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const POOL_NAME = "CT-LmPool";
const FIRES = parseInt(process.env.MM_FIRES || "30", 10);
const ROUNDS = parseInt(process.env.MM_ROUNDS || "1", 10);
const CONC = parseInt(process.env.MM_CONCURRENCY || "6", 10);
const EXPECT = parseInt(process.env.MM_EXPECT_MODELS || "3", 10);

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

async function readDebugRaw(key) {
  const r = await get(`/rest/api/3/issue/${key}/properties/cogni-debug`, { raw: true });
  if (r.status >= 400) return null;
  try { return JSON.parse(r.text).value; } catch { return null; }
}

const overlaps = (a, b) => a.t0 < b.t1 && b.t0 < a.t1;

function peakDistinctInFlight(fires) {
  const evts = [];
  for (const f of fires) {
    if (!f.modelUsed) continue;
    evts.push({ t: f.t0, d: +1, m: f.modelUsed });
    evts.push({ t: f.t1, d: -1, m: f.modelUsed });
  }
  evts.sort((a, b) => a.t - b.t || a.d - b.d);
  const live = new Map();
  let peak = 0;
  for (const e of evts) {
    const n = (live.get(e.m) || 0) + e.d;
    if (n <= 0) live.delete(e.m); else live.set(e.m, n);
    if (live.size > peak) peak = live.size;
  }
  return peak;
}

const short = (s, n = 70) => (s == null ? "" : String(s).replace(/\s+/g, " ").slice(0, n));

async function main() {
  const s = loadState();
  if (!s.workflowName) throw new Error("Run `npm run setup` first (no testbed state).");
  const hubName = s.hubStatusName || "Backlog";

  const transitionId = await attachPoolValidator(s);
  console.log(`Pool validator attached on transition ${transitionId} (field=summary, debugTrace=on, non-agentic).`);
  console.log(`Battery: ${ROUNDS} round(s) x ${FIRES} fires @ concurrency ${CONC}.\n`);

  const allFires = [];
  resetStats();
  const batteryStart = Date.now();

  for (let round = 1; round <= ROUNDS; round++) {
    const onHub = await searchJql(`project=${s.projectKey} AND status="${hubName}"`, ["summary"], 600);
    if (onHub.length === 0) throw new Error(`No issues on hub status "${hubName}" — run reset-to-hub.mjs first.`);
    const want = Math.min(FIRES, onHub.length);
    // Rotate the starting offset per round so we exercise different issues each round.
    const offset = ((round - 1) * want) % onHub.length;
    const targets = [];
    for (let i = 0; i < want; i++) targets.push(onHub[(offset + i) % onHub.length]);

    process.stdout.write(`Round ${round}/${ROUNDS}: firing ${want} validators @ ${CONC} ... `);
    const t0r = Date.now();
    const fires = await mapLimit(targets, CONC, async (iss) => {
      const key = iss.key;
      const t0 = Date.now();
      let httpStatus = 0;
      try { const r = await doTransition(key, transitionId); httpStatus = r.status; }
      catch (e) { httpStatus = e.status || -1; }
      const t1 = Date.now();
      await sleep(250);
      const dbg = await readDebugRaw(key);
      return {
        round, key, t0, t1, ms: t1 - t0, httpStatus,
        modelUsed: dbg?.modelUsed ?? null,
        isValid: dbg?.isValid ?? null,
        reason: dbg?.reason ?? null,
        execMs: dbg?.executionTimeMs ?? null,
        mode: dbg?.mode ?? null,
        transient: dbg?.transientError ?? false,
      };
    });
    allFires.push(...fires);
    const got = new Set(fires.filter((f) => f.modelUsed).map((f) => f.modelUsed));
    console.log(`done in ${((Date.now() - t0r) / 1000).toFixed(1)}s — ${got.size} distinct model(s) this round`);
  }
  const wallMs = Date.now() - batteryStart;

  // Histogram
  const hist = {};
  for (const f of allFires) { const m = f.modelUsed || "(none)"; hist[m] = (hist[m] || 0) + 1; }
  const distinct = Object.keys(hist).filter((m) => m !== "(none)");
  const noneCount = hist["(none)"] || 0;
  const withModel = allFires.filter((f) => f.modelUsed);

  // Concurrency
  let crossOverlaps = 0;
  for (let a = 0; a < withModel.length; a++)
    for (let b = a + 1; b < withModel.length; b++)
      if (withModel[a].modelUsed !== withModel[b].modelUsed && overlaps(withModel[a], withModel[b])) crossOverlaps++;
  const peak = peakDistinctInFlight(allFires);

  // ---- Report ----
  const total = allFires.length;
  console.log(`\n=== modelUsed histogram (${total} fires across ${ROUNDS} round(s), wall ${(wallMs / 1000).toFixed(1)}s) ===`);
  for (const [m, c] of Object.entries(hist).sort((x, y) => y[1] - x[1])) {
    const pct = ((c / total) * 100).toFixed(0);
    console.log(`  ${String(c).padStart(3)} (${pct.padStart(3)}%)  ${"█".repeat(Math.round(c / total * 40))}  ${m}`);
  }
  console.log(`\nDistinct models that served : ${distinct.length}  [${distinct.join(", ")}]`);
  console.log(`Cross-model concurrent pairs: ${crossOverlaps}`);
  console.log(`Peak distinct models in flight simultaneously: ${peak}`);
  if (noneCount) console.log(`Fires with no modelUsed (F14 platform fail-close etc.): ${noneCount}`);
  console.log(`Jira REST: ${stats.requests} req, ${stats.status429} x429, ${stats.retries} retries`);

  // ---- Per-model evidence ----
  console.log(`\n=== PER-MODEL EVIDENCE (each model produced real verdicts on real issues) ===`);
  const evidence = {};
  for (const m of distinct) {
    const rows = withModel.filter((f) => f.modelUsed === m);
    evidence[m] = { served: rows.length, samples: rows.slice(0, 3).map((r) => ({ issue: r.key, http: r.httpStatus, isValid: r.isValid, reason: short(r.reason, 90), aiMs: r.ms })) };
    console.log(`\n  ▸ ${m}  — served ${rows.length} validation(s)`);
    for (const r of rows.slice(0, 3)) {
      console.log(`      ${r.key}  HTTP ${r.httpStatus}  isValid=${r.isValid}  ${r.ms}ms  :: "${short(r.reason, 80)}"`);
    }
  }

  // ---- Raw, un-summarized proof: one full cogni-debug per model ----
  console.log(`\n=== RAW cogni-debug proof (one issue per model, fetched fresh) ===`);
  const rawProof = {};
  for (const m of distinct) {
    const sample = withModel.find((f) => f.modelUsed === m);
    if (!sample) continue;
    const raw = await readDebugRaw(sample.key);
    rawProof[m] = { issue: sample.key, cogniDebug: raw };
    console.log(`\n  ${sample.key} (served by ${m}):`);
    console.log("  " + JSON.stringify({ modelUsed: raw?.modelUsed, isValid: raw?.isValid, mode: raw?.mode, reason: short(raw?.reason, 100), at: raw?.at }, null, 0));
  }

  // ---- Write evidence artifacts ----
  writeResult("lmstudio-multimodel.json", {
    transitionId, rounds: ROUNDS, firesPerRound: FIRES, concurrency: CONC,
    total, wallMs, hist, distinct, crossOverlaps, peakInFlight: peak, evidence, rawProof, fires: allFires,
  });
  const md = [
    `# LM Studio multi-model pool — evidence`,
    ``,
    `Battery: **${ROUNDS} round(s) × ${FIRES} fires** @ concurrency ${CONC} = **${total} validator transitions**, wall ${(wallMs / 1000).toFixed(1)}s.`,
    `Each fire is one Jira workflow transition → one synchronous LM Studio validation; the model that served it is read back from the issue's \`cogni-debug\` property.`,
    ``,
    `## Models that served (histogram)`,
    ``,
    `| model | validations served | share |`,
    `|---|---|---|`,
    ...Object.entries(hist).sort((a, b) => b[1] - a[1]).map(([m, c]) => `| \`${m}\` | ${c} | ${((c / total) * 100).toFixed(0)}% |`),
    ``,
    `**Distinct models engaged: ${distinct.length}** — ${distinct.map((m) => `\`${m}\``).join(", ")}.`,
    `Cross-model concurrent overlaps (different models inferring at the same instant): **${crossOverlaps}**. Peak distinct models in flight: **${peak}**.`,
    ``,
    `## Per-model evidence (sample real verdicts)`,
    ``,
    ...distinct.flatMap((m) => [
      `### \`${m}\` — ${evidence[m].served} validations`,
      ``,
      `| issue | HTTP | isValid | AI reason | AI ms |`,
      `|---|---|---|---|---|`,
      ...evidence[m].samples.map((sx) => `| ${sx.issue} | ${sx.http} | ${sx.isValid} | ${sx.reason} | ${sx.aiMs} |`),
      ``,
    ]),
    `## Raw cogni-debug proof`,
    ``,
    "```json",
    JSON.stringify(rawProof, null, 2),
    "```",
  ].join("\n");
  writeFileSync(join(RESULTS_DIR, "lmstudio-multimodel-evidence.md"), md);
  console.log(`\nWrote results/lmstudio-multimodel.json + results/lmstudio-multimodel-evidence.md`);

  if (distinct.length >= EXPECT && crossOverlaps > 0) {
    console.log(`\n✓ PASS — ${distinct.length} distinct models served the battery (≥${EXPECT}) AND ran concurrently (peak ${peak} in flight).`);
  } else if (distinct.length >= EXPECT) {
    console.log(`\n~ PARTIAL — all ${distinct.length} models used, but no overlapping windows observed. Raise MM_CONCURRENCY.`);
  } else {
    console.log(`\n✗ FAIL — only ${distinct.length} distinct model(s) served (expected ≥${EXPECT}).`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("MULTIMODEL FAILED:", e.message);
  if (e.body) console.error(JSON.stringify(e.body).slice(0, 400));
  process.exit(1);
});
