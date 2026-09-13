/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Offline unit test for src/shared/usage-meter.js — the load-bearing pure logic
// (normalizer + counter math + rollover + ceiling). No live Forge. Run:
// node usage-meter.test.mjs
import {
  normalizeUsage, emptyState, bumpCounters, summarizeState, overCallCeiling, METER_PROVIDERS,
  FORGE_LLM_USD_PER_M, forgeLlmCostUsd, FORGE_LLM_ALLOWANCE, allowanceUsdForSeats,
  forgeLlmAllowanceStatus, noteForgeLlmClamp,
} from "../../src/shared/usage-meter.js";

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

// --- F-366: cache reads are counted, in their OWN counter, never in `prompt` ---
{
  // our Anthropic adapter's shape: cache reads are IN ADDITION to prompt_tokens
  const anth = normalizeUsage({ prompt_tokens: 150, completion_tokens: 20, total_tokens: 170, prompt_tokens_details: { cached_tokens: 900 }, cache_read_tokens: 900, cache_creation_tokens: 50 });
  ok(anth.cacheRead === 900, "explicit cache_read_tokens is read");
  ok(anth.cacheCreation === 50, "explicit cache_creation_tokens is read");
  ok(anth.prompt === 150 && anth.total === 170, "the PACED figures are untouched — cache reads are never folded into prompt/total");
  // an OpenAI-compatible provider reports the detail only (a SUBSET of prompt_tokens)
  const oai = normalizeUsage({ prompt_tokens: 1000, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 800 } });
  ok(oai.cacheRead === 800, "the OpenAI-shaped detail is the fallback source");
  ok(oai.prompt === 1000, "…and it is NOT subtracted from prompt (it is already inside it there)");
  // raw Anthropic field names, for a shape that reaches the meter unmapped
  ok(normalizeUsage({ input_tokens: 5, cache_read_input_tokens: 7, cache_creation_input_tokens: 3 }).cacheRead === 7, "raw cache_read_input_tokens is read");
  ok(normalizeUsage({ input_tokens: 5, cache_read_input_tokens: 7 }).cacheCreation === 0, "absent cache creation → 0, never undefined");
  ok(normalizeUsage(null).cacheRead === 0 && normalizeUsage(42).cacheRead === 0, "null / bare-number shapes carry 0 cache reads");
  ok(normalizeUsage({ cache_read_tokens: 900 }).hadUsage === false, "cache reads alone are not 'usage' — hadUsage still keys on prompt/completion/total");

  let c = emptyState();
  c = bumpCounters(c, { provider: "anthropic", usage: anth, nowMs: MS(2026, 7, 8) });
  c = bumpCounters(c, { provider: "anthropic", usage: anth, nowMs: MS(2026, 7, 8) });
  const cm = summarizeState(c, MS(2026, 7, 8)).month;
  ok(cm.cacheReadTokens === 1800 && cm.cacheCreationTokens === 100, "the month accumulates cache reads and writes separately");
  ok(cm.prompt === 300 && cm.total === 340, "prompt/total still only count billed non-cached input");
  // an OLD stored month has neither key — it must read as 0 and keep accumulating
  const legacy = { month: { key: "2026-07", calls: 1, prompt: 10, completion: 1, total: 11, byProvider: {} }, today: { key: "2026-07-08", calls: 1, total: 11 }, history: [] };
  const bumped = summarizeState(bumpCounters(legacy, { provider: "anthropic", usage: anth, nowMs: MS(2026, 7, 8) }), MS(2026, 7, 8)).month;
  ok(bumped.cacheReadTokens === 900 && bumped.cacheCreationTokens === 50, "a pre-F-366 stored month gains the counters without NaN");
  ok(summarizeState(emptyState(), MS(2026, 7, 8)).month.cacheReadTokens === 0, "an empty month reports 0, not undefined");
}

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

// =====================================================================================
// FORGE LLM VENDOR-SPEND METER (editions 1.3)
// Only the "atlassian" provider is costed: Forge LLM tokens land on LeanZero's bill,
// BYOK tokens land on the customer's and are deliberately NOT priced here.
// =====================================================================================
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// --- cost math (rates are ASSUMED at tier — see the comment on FORGE_LLM_USD_PER_M) ---
ok(near(forgeLlmCostUsd("sonnet", 3000, 300), 0.0135), "sonnet 3k/0.3k ≈ $0.0135 (the §3.2 validator figure)");
ok(near(forgeLlmCostUsd("haiku", 3000, 300), 0.0045), "haiku 3k/0.3k ≈ $0.0045");
ok(near(forgeLlmCostUsd("opus", 3000, 300), 0.0225), "opus 3k/0.3k ≈ $0.0225");
ok(near(forgeLlmCostUsd("opus", 40000, 10000), 0.45), "opus agent turn 40k/10k ≈ $0.45");
ok(forgeLlmCostUsd(null, 1e6, 1e6) === 0, "unknown tier costs 0 — never guess upward");
ok(forgeLlmCostUsd("haiku", -5, -5) === 0, "negative tokens clamp to 0");
ok(FORGE_LLM_USD_PER_M.haiku.in === 1 && FORGE_LLM_USD_PER_M.opus.out === 25, "price table shape");

// --- tier buckets: atlassian only, split by model ---
let fs0 = emptyState();
fs0 = bumpCounters(fs0, { provider: "atlassian", usage: normalizeUsage({ prompt_tokens: 3000, completion_tokens: 300 }), nowMs: MS(2026, 7, 8), model: "claude-sonnet-5" });
fs0 = bumpCounters(fs0, { provider: "atlassian", usage: normalizeUsage({ prompt_tokens: 1000, completion_tokens: 100 }), nowMs: MS(2026, 7, 8), tier: "haiku" });
fs0 = bumpCounters(fs0, { provider: "openai", usage: normalizeUsage({ prompt_tokens: 9000, completion_tokens: 900 }), nowMs: MS(2026, 7, 8), model: "claude-opus-5" });
let fsum = summarizeState(fs0, MS(2026, 7, 8)).month.forgeLlm;
ok(fsum.byTier.sonnet.calls === 1 && fsum.byTier.sonnet.prompt === 3000 && fsum.byTier.sonnet.completion === 300, "sonnet bucket from the model id");
ok(fsum.byTier.haiku.calls === 1 && fsum.byTier.haiku.prompt === 1000, "explicit tier is honoured");
ok(fsum.byTier.opus.calls === 0, "a BYOK (openai) call NEVER lands in a forgeLlm tier bucket, whatever the model is named");
ok(near(fsum.estUsd, 0.0135 + 0.0015), "estUsd = sonnet 0.0135 + haiku 0.0015");
ok(fsum.clampedCalls === 0, "no clamps recorded yet");
ok(summarizeState(fs0, MS(2026, 7, 8)).month.calls === 3, "all three calls still counted in the ordinary month totals");
{
  const unclassified = bumpCounters(emptyState(), { provider: "atlassian", usage: normalizeUsage(50), nowMs: MS(2026, 7, 8), model: "some-unlisted-model" });
  const u = summarizeState(unclassified, MS(2026, 7, 8)).month.forgeLlm;
  ok(u.byTier.haiku.calls === 0 && u.byTier.sonnet.calls === 0 && u.byTier.opus.calls === 0 && u.estUsd === 0,
    "an unclassifiable Forge LLM model adds no tier row and no cost (rather than mis-billing a tier)");
}

// --- emptyState()/emptyMonth shape carries the forgeLlm block ---
{
  const fresh = summarizeState(emptyState(), MS(2026, 7, 8)).month.forgeLlm;
  ok(!!fresh && !!fresh.byTier && fresh.estUsd === 0 && fresh.clampedCalls === 0, "emptyState month has a zeroed forgeLlm block");
  ok(["haiku", "sonnet", "opus"].every((t) => fresh.byTier[t] && fresh.byTier[t].calls === 0), "all three tier buckets initialised");
  // A pre-editions stored state has no forgeLlm at all — it must be repaired, not crash.
  const legacy = { month: { key: "2026-07", calls: 4, prompt: 1, completion: 1, total: 2, byProvider: {} }, today: { key: "2026-07-08", calls: 0, total: 0 }, history: [] };
  ok(summarizeState(legacy, MS(2026, 7, 8)).month.forgeLlm.estUsd === 0, "a legacy state with no forgeLlm block summarizes to a zeroed one");
}

// --- month rollover RESETS the forgeLlm block ---
{
  const next = bumpCounters(fs0, { provider: "atlassian", usage: normalizeUsage({ prompt_tokens: 10, completion_tokens: 1 }), nowMs: MS(2026, 8, 1), model: "claude-haiku-4-5-20251001" });
  const n = summarizeState(next, MS(2026, 8, 1)).month.forgeLlm;
  ok(n.byTier.sonnet.calls === 0, "new month: sonnet bucket reset");
  ok(n.byTier.haiku.calls === 1, "new month: only the new haiku call");
  ok(near(n.estUsd, forgeLlmCostUsd("haiku", 10, 1)), "new month: estUsd reset to just this call");
}

// --- allowance: clamp(seats × $2, $40, $800), fallback 100 seats ---
ok(FORGE_LLM_ALLOWANCE.perSeatUsd === 2 && FORGE_LLM_ALLOWANCE.softPct === 0.8, "allowance constants");
ok(allowanceUsdForSeats(100) === 200, "100 seats → $200");
ok(allowanceUsdForSeats(5) === 40, "5 seats clamps UP to the $40 floor");
ok(allowanceUsdForSeats(100000) === 800, "huge seat count clamps DOWN to the $800 ceiling");
ok(allowanceUsdForSeats(0) === 200 && allowanceUsdForSeats(-3) === 200, "0 / negative seats → the 100-seat fallback");
ok(allowanceUsdForSeats(null) === 200 && allowanceUsdForSeats("many") === 200 && allowanceUsdForSeats(NaN) === 200,
  "null / string / NaN seats → the 100-seat fallback");

// --- allowance levels at 79 / 80 / 100 % ---
const stateAtUsd = (usd) => {
  // 1M prompt tokens of haiku = exactly $1.00, so this builds an exact spend.
  let st = emptyState();
  st = bumpCounters(st, { provider: "atlassian", usage: normalizeUsage({ prompt_tokens: Math.round(usd * 1e6), completion_tokens: 0 }), nowMs: MS(2026, 7, 8), tier: "haiku" });
  return st;
};
ok(forgeLlmAllowanceStatus(stateAtUsd(79), 100, MS(2026, 7, 8)).level === "ok", "79% → ok");
ok(forgeLlmAllowanceStatus(stateAtUsd(80), 100, MS(2026, 7, 8)).level === "soft", "80% → soft (the warn threshold is inclusive)");
ok(forgeLlmAllowanceStatus(stateAtUsd(99), 100, MS(2026, 7, 8)).level === "soft", "99% → soft");
ok(forgeLlmAllowanceStatus(stateAtUsd(100), 100, MS(2026, 7, 8)).level === "hard", "100% → hard");
ok(forgeLlmAllowanceStatus(stateAtUsd(250), 100, MS(2026, 7, 8)).level === "hard", "over → hard");
{
  const st = forgeLlmAllowanceStatus(stateAtUsd(50), 100, MS(2026, 7, 8));
  ok(near(st.estUsd, 50) && st.allowanceUsd === 100 && near(st.pct, 0.5), "status reports estUsd / allowanceUsd / pct");
}
ok(forgeLlmAllowanceStatus(stateAtUsd(500), 0, MS(2026, 7, 8)).level === "ok",
  "an UNKNOWN (0) allowance is never 'hard' — a missing allowance must not pause the product");
ok(forgeLlmAllowanceStatus(emptyState(), 100, MS(2026, 7, 8)).level === "ok", "empty state → ok");

// --- noteForgeLlmClamp ---
{
  let c = noteForgeLlmClamp(fs0, MS(2026, 7, 8));
  c = noteForgeLlmClamp(c, MS(2026, 7, 8));
  const cs = summarizeState(c, MS(2026, 7, 8)).month;
  ok(cs.forgeLlm.clampedCalls === 2, "two clamps recorded");
  ok(cs.calls === 3 && near(cs.forgeLlm.estUsd, 0.015), "noting a clamp does not invent a call or a cost");
  const frozen3 = emptyState();
  Object.freeze(frozen3); Object.freeze(frozen3.month); Object.freeze(frozen3.today); Object.freeze(frozen3.history);
  let threw3 = false;
  try { noteForgeLlmClamp(frozen3, MS(2026, 7, 8)); } catch (e) { threw3 = true; }
  ok(!threw3, "noteForgeLlmClamp is pure (frozen input survives)");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
