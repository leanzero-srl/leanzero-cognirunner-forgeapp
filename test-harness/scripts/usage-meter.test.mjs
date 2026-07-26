/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Offline unit test for src/shared/usage-meter.js — the load-bearing pure logic
// (normalizer + counter math + rollover + ceiling). No live Forge. Run:
// node usage-meter.test.mjs
import { normalizeUsage, emptyState, bumpCounters, summarizeState, overCallCeiling, METER_PROVIDERS } from "../../src/shared/usage-meter.js";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const MS = (y, mo, d) => Date.UTC(y, mo - 1, d, 12, 0, 0);

// --- normalizeUsage across every provider shape ---
ok(normalizeUsage({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }).total === 15, "OpenAI shape total");
ok(normalizeUsage({ input_tokens: 8, output_tokens: 4 }).total === 12, "Anthropic shape total = in+out");
ok(normalizeUsage({ inputTokens: 3, outputTokens: 2, totalTokens: 5 }).total === 5, "Bedrock shape total");
ok(normalizeUsage(42).total === 42 && normalizeUsage(42).hadUsage, "bare number");
ok(normalizeUsage({ tokens: 7 }).total === 7, "{tokens} async flat shape");
ok(normalizeUsage(null).hadUsage === false && normalizeUsage(null).total === 0, "null → zeros, hadUsage false");
ok(normalizeUsage({ garbage: true }).total === 0, "garbage object → 0");
ok(normalizeUsage({ prompt_tokens: -5, completion_tokens: -2 }).total === 0, "negatives clamped to 0");
ok(normalizeUsage({ prompt_tokens: 3.9 }).prompt === 3, "floored");

// --- bumpCounters: accumulation + per-provider (clamped to enum) ---
let s = emptyState();
s = bumpCounters(s, { provider: "openai", usage: normalizeUsage({ total_tokens: 100 }), nowMs: MS(2026, 7, 8) });
s = bumpCounters(s, { provider: "anthropic", usage: normalizeUsage({ total_tokens: 50 }), nowMs: MS(2026, 7, 8) });
s = bumpCounters(s, { provider: "mystery-provider", usage: normalizeUsage({ total_tokens: 10 }), nowMs: MS(2026, 7, 8) });
let sum = summarizeState(s, MS(2026, 7, 8));
ok(sum.month.calls === 3 && sum.month.total === 160, "3 calls, 160 tokens accumulated");
ok(sum.month.byProvider.openai.total === 100 && sum.month.byProvider.anthropic.total === 50, "per-provider totals");
ok(sum.month.byProvider.other && sum.month.byProvider.other.total === 10, "unknown provider clamped to 'other'");
ok(Object.keys(sum.month.byProvider).every((p) => METER_PROVIDERS.includes(p) || p === "other"), "byProvider bounded to enum+other");
ok(sum.today.calls === 3, "today count");

// --- month rollover into capped history ---
let r = bumpCounters(s, { provider: "openai", usage: normalizeUsage({ total_tokens: 5 }), nowMs: MS(2026, 8, 1) });
let rs = summarizeState(r, MS(2026, 8, 1));
ok(rs.month.key === "2026-08" && rs.month.calls === 1 && rs.month.total === 5, "August is a fresh month bucket");
ok(rs.history[0] && rs.history[0].key === "2026-07" && rs.history[0].total === 160, "July rolled into history");

// history cap at 6
let h = emptyState();
for (let m = 1; m <= 9; m++) h = bumpCounters(h, { provider: "openai", usage: normalizeUsage(1), nowMs: MS(2026, m, 1) });
ok(summarizeState(h, MS(2026, 9, 1)).history.length === 6, "history capped at 6");

// day rollover resets today, keeps month
let d = bumpCounters(s, { provider: "openai", usage: normalizeUsage({ total_tokens: 9 }), nowMs: MS(2026, 7, 9) });
let ds = summarizeState(d, MS(2026, 7, 9));
ok(ds.today.calls === 1 && ds.today.total === 9, "next day: today reset");
ok(ds.month.calls === 4, "next day: month accumulates (was 3, +1)");

// --- summarizeState PURITY: must not mutate a deep-frozen input ---
const frozen = emptyState();
frozen.month.calls = 5; frozen.month.total = 500;
Object.freeze(frozen); Object.freeze(frozen.month); Object.freeze(frozen.today); Object.freeze(frozen.history);
let threw = false;
try { summarizeState(frozen, MS(2026, 7, 8)); } catch (e) { threw = true; }
ok(!threw, "summarizeState does not mutate a frozen input (pure)");
ok(frozen.month.calls === 5, "input unchanged after summarize");

// bumpCounters purity too
const frozen2 = emptyState(); Object.freeze(frozen2); Object.freeze(frozen2.month); Object.freeze(frozen2.today); Object.freeze(frozen2.history);
let threw2 = false;
try { bumpCounters(frozen2, { provider: "openai", usage: normalizeUsage(1), nowMs: MS(2026, 7, 8) }); } catch (e) { threw2 = true; }
ok(!threw2, "bumpCounters does not mutate a frozen input (pure)");

// --- overCallCeiling (soft ceiling; 0 = unlimited) ---
ok(overCallCeiling(s, 0, MS(2026, 7, 8)) === false, "ceiling 0 = unlimited");
ok(overCallCeiling(s, 100, MS(2026, 7, 8)) === false, "3 calls < 100 → under ceiling");
ok(overCallCeiling(s, 3, MS(2026, 7, 8)) === true, "3 calls >= 3 → at ceiling");
ok(overCallCeiling(s, 2, MS(2026, 7, 8)) === true, "3 calls >= 2 → over ceiling");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
