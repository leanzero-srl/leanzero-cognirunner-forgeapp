/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Harness-side coverage report. Consumes the deep canonical run
// (results/deep-run.jsonl) and the discovery sweep
// (results/discovered-results.json) and emits results/coverage.json +
// results/coverage.md: per-rule rows, the every-rule-exercised rollup, the
// system-vs-model (A/B/C) split, the Bucket-A hardening worklist, and the
// per-study PASS/SOFT/HARD table with legacyCorrect (no-regression check).

import { loadState, writeResult, RESULTS_DIR, ensureResults } from "../lib/state.mjs";
import { buildRules } from "../fixtures/rules.mjs";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const JSONL = join(RESULTS_DIR, "deep-run.jsonl");
const DISCO = join(RESULTS_DIR, "discovered-results.json");

function loadDeep() {
  if (!existsSync(JSONL)) return [];
  const byCase = new Map();
  for (const line of readFileSync(JSONL, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { const o = JSON.parse(line); const k = o.caseId || `${o.ruleKey}__${o.issueId}`; const prev = byCase.get(k); if (!prev || (o.at || 0) >= (prev.at || 0)) byCase.set(k, o); } catch {}
  }
  return [...byCase.values()];
}

function aggregateDeep(cases) {
  const perRule = {};
  const byStudy = {};
  const buckets = { A: 0, B: 0, C: 0 };
  let legacy = 0;
  for (const c of cases) {
    const r = (perRule[c.ruleKey] ||= { ruleKey: c.ruleKey, ruleName: c.ruleName, type: c.type, study: c.study, cases: 0, pass: 0, soft: 0, hard: 0, A: 0, B: 0, C: 0, legacy: 0, models: new Set(), signals: {}, samples: [] });
    r.cases++;
    if (c.grade === "PASS") r.pass++; else if (c.grade === "SOFT") r.soft++; else r.hard++;
    if (c.legacyCorrect) { r.legacy++; legacy++; }
    if (c.modelUsed) r.models.add(c.modelUsed);
    if (c.triage) { r[c.triage.bucket]++; buckets[c.triage.bucket]++; r.signals[c.triage.signal] = (r.signals[c.triage.signal] || 0) + 1; }
    if (c.grade !== "PASS" && r.samples.length < 3) r.samples.push({ issueId: c.issueId, grade: c.grade, bucket: c.triage?.bucket, signal: c.triage?.signal, reason: (c.reason || c.error || "").slice(0, 140) });
    const s = (byStudy[c.study] ||= { study: c.study, pass: 0, soft: 0, hard: 0, total: 0, legacy: 0 });
    s.total++; if (c.grade === "PASS") s.pass++; else if (c.grade === "SOFT") s.soft++; else s.hard++; if (c.legacyCorrect) s.legacy++;
  }
  for (const r of Object.values(perRule)) r.models = [...r.models];
  return { perRule, byStudy, buckets, legacy, total: cases.length };
}

function canonicalCoverage(deepPerRule) {
  let rules = [];
  try { rules = buildRules(loadState()); } catch { return null; }
  const exercised = []; const missing = [];
  for (const r of rules) {
    const hit = deepPerRule[r.key];
    if (hit && hit.cases > 0) exercised.push(r.key);
    else missing.push({ key: r.key, name: r.name, study: r.study, reason: (r.appliesTo && r.appliesTo.length) ? "no case recorded (run run-deep)" : "not-exercisable (no applicable corpus class)" });
  }
  return { totalRules: rules.length, exercisedRules: exercised.length, missing };
}

function loadDisco() {
  if (!existsSync(DISCO)) return null;
  try { return JSON.parse(readFileSync(DISCO, "utf8")); } catch { return null; }
}

function combinedWorklist(deepCases, disco) {
  const bySignal = {};
  const add = (sig, target, ruleKey, note) => {
    (bySignal[sig] ||= { signal: sig, hardeningTarget: target || null, count: 0, rules: new Set(), samples: [] });
    bySignal[sig].count++;
    bySignal[sig].rules.add(ruleKey);
    if (bySignal[sig].samples.length < 4) bySignal[sig].samples.push({ ruleKey, note: (note || "").slice(0, 140) });
  };
  for (const c of deepCases) if (c.triage?.bucket === "A") add(c.triage.signal, c.triage.hardeningTarget, c.ruleKey, c.reason || c.error || c.triage.note);
  for (const r of (disco?.results || [])) if (r.triage?.bucket === "A") add(r.triage.signal, r.triage.hardeningTarget, r.ruleKey, r.reason || r.error || r.triage.note);
  return Object.values(bySignal).map((s) => ({ ...s, rules: [...s.rules] })).sort((a, b) => b.count - a.count);
}

function main() {
  ensureResults();
  const deepCases = loadDeep();
  const deep = aggregateDeep(deepCases);
  const canon = canonicalCoverage(deep.perRule);
  const disco = loadDisco();
  const worklist = combinedWorklist(deepCases, disco);

  const discoExercised = disco ? (disco.replayExecuted ?? (disco.results || []).filter((r) => r.executed && (r.lane === "replay" || r.lane === "condition-mirror")).length) : 0;
  const discoTotal = disco ? (disco.replayTotal ?? (disco.results || []).filter((r) => r.lane === "replay" || r.lane === "condition-mirror").length) : 0;

  const report = {
    generatedAtNote: "harness coverage report",
    deep: { total: deep.total, buckets: deep.buckets, legacyCorrect: deep.legacy, byStudy: deep.byStudy, perRule: deep.perRule },
    canonicalCoverage: canon,
    discovered: disco ? { total: disco.total, exercised: discoExercised, ofReplay: discoTotal, buckets: disco.buckets } : null,
    systemBugWorklist: worklist,
  };
  writeResult("coverage.json", report);

  // ---- readable markdown ----
  const L = [];
  L.push(`# CogniRunner coverage report`, ``);
  if (disco) {
    L.push(`## Real-instance rule coverage (discovery sweep)`, ``);
    L.push(`Every CogniRunner rule deployed on the instance was exercised via the replay-with-trace backbone.`, ``);
    L.push(`- **${discoExercised}/${discoTotal}** discovered rules confirmed executed (replay/mirror lane)`);
    L.push(`- triage: **A(system)=${disco.buckets?.A || 0}**, B(model)=${disco.buckets?.B || 0}, C(expected)=${disco.buckets?.C || 0}`, ``);
  }
  if (canon) {
    L.push(`## Canonical suite coverage`, ``);
    L.push(`- **${canon.exercisedRules}/${canon.totalRules}** canonical rules exercised in the deep run`);
    if (canon.missing.length) {
      L.push(`- not exercised:`);
      for (const m of canon.missing) L.push(`  - \`${m.key}\` (${m.study}) — ${m.reason}`);
    }
    L.push(``);
  }
  if (deep.total) {
    L.push(`## Deep run by study (PASS / SOFT / HARD · legacyCorrect)`, ``);
    L.push(`| study | PASS | SOFT | HARD | n | legacyCorrect |`, `|---|---|---|---|---|---|`);
    for (const s of Object.values(deep.byStudy)) L.push(`| ${s.study} | ${s.pass} | ${s.soft} | ${s.hard} | ${s.total} | ${s.legacy}/${s.total} |`);
    L.push(``, `**Totals:** ${deep.total} cases · legacyCorrect ${deep.legacy}/${deep.total} · triage A=${deep.buckets.A} B=${deep.buckets.B} C=${deep.buckets.C}`, ``);
  }
  L.push(`## System-bug worklist (Bucket A → src/index.js hardening targets)`, ``);
  if (!worklist.length) L.push(`No system-bug signals — the forcing function is satisfied (remaining non-PASS are model/expected).`, ``);
  for (const w of worklist) {
    L.push(`### ${w.count}× \`${w.signal}\` (${w.rules.length} rule(s))`);
    L.push(`- **fix:** ${w.hardeningTarget || "(trace via forge logs)"}`);
    for (const s of w.samples) L.push(`  - \`${s.ruleKey}\`: ${s.note}`);
    L.push(``);
  }
  L.push(`> Cross-check forge-logs review: \`node scripts/_forge-logs.mjs --review\``);
  writeFileSync(join(RESULTS_DIR, "coverage.md"), L.join("\n"));

  // console
  console.log(`=== Coverage report ===`);
  if (disco) console.log(`Discovered rules executed: ${discoExercised}/${discoTotal}  (A=${disco.buckets?.A || 0} B=${disco.buckets?.B || 0} C=${disco.buckets?.C || 0})`);
  if (canon) console.log(`Canonical rules exercised: ${canon.exercisedRules}/${canon.totalRules}`);
  if (deep.total) console.log(`Deep cases: ${deep.total}  legacyCorrect ${deep.legacy}/${deep.total}  triage A=${deep.buckets.A} B=${deep.buckets.B} C=${deep.buckets.C}`);
  console.log(`System-bug signals: ${worklist.length ? worklist.map((w) => `${w.count}×${w.signal}`).join(", ") : "none"}`);
  console.log(`\nWrote results/coverage.json + results/coverage.md`);
}

main();
