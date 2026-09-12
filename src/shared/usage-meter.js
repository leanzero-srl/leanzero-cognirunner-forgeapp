/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * AI usage meter — pure, dependency-free counter math + provider-shape usage
 * normalizer. Imported by the backend (recordAiUsage at the callAIChat seam and
 * the async callAIChatSimple seam) and an offline Node unit test. No I/O here.
 *
 * The meter is a BEST-EFFORT under-count, not an exact ledger: the backend does a
 * re-read+add on a single KVS key with no CAS, so concurrent runtime + async
 * writers lose updates (they only ever UNDER-count — acceptable for a meter). The
 * optional monthly call ceiling reads the same under-counted total, so it enforces
 * a SOFT ceiling that real spend can modestly overshoot under concurrency.
 */

// Providers are clamped to this fixed set so byProvider can never grow unbounded
// (the KVS key has no TTL — boundedness is required by the core contract).
export const METER_PROVIDERS = ["openai", "azure", "openrouter", "anthropic", "bedrock", "lmstudio", "atlassian"];
const clampProvider = (p) => (METER_PROVIDERS.includes(p) ? p : "other");

const nn = (v) => {
  const n = typeof v === "number" ? v : parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

// Accept every provider usage shape seen at the two seams: OpenAI-compat
// {prompt_tokens,completion_tokens,total_tokens}; Anthropic {input_tokens,output_tokens};
// Bedrock {inputTokens,outputTokens,totalTokens}; a bare number or {tokens:N} (async
// flat seam); null/garbage -> zeros + hadUsage:false.
export const normalizeUsage = (u) => {
  if (typeof u === "number") { const t = nn(u); return { prompt: 0, completion: 0, total: t, hadUsage: t > 0 }; }
  if (!u || typeof u !== "object") return { prompt: 0, completion: 0, total: 0, hadUsage: false };
  const prompt = nn(u.prompt_tokens ?? u.input_tokens ?? u.inputTokens ?? u.promptTokens);
  const completion = nn(u.completion_tokens ?? u.output_tokens ?? u.outputTokens ?? u.completionTokens);
  let total = nn(u.total_tokens ?? u.totalTokens ?? u.tokens);
  if (!total) total = prompt + completion;
  return { prompt, completion, total, hadUsage: (prompt + completion + total) > 0 };
};

// UTC period keys.
const two = (n) => (n < 10 ? "0" + n : "" + n);
export const monthKey = (ms) => { const d = new Date(ms); return d.getUTCFullYear() + "-" + two(d.getUTCMonth() + 1); };
export const dayKey = (ms) => monthKey(ms) + "-" + two(d2(ms));
function d2(ms) { return new Date(ms).getUTCDate(); }

const emptyForgeLlm = () => ({
  byTier: {
    haiku: { calls: 0, prompt: 0, completion: 0 },
    sonnet: { calls: 0, prompt: 0, completion: 0 },
    opus: { calls: 0, prompt: 0, completion: 0 },
  },
  estUsd: 0,
  clampedCalls: 0,
});

/*
 * FORGE LLM PRICE TABLE — USD per MILLION tokens, by model TIER.
 *
 * ⚠️ ASSUMED, NOT PUBLISHED. Atlassian has not published pass-through rates for
 * Forge LLM, and the Claude 5-series (Sonnet 5 / Opus 5) list prices were not
 * public when this shipped (2026-09-12). These numbers are AT-TIER estimates used
 * only to drive the vendor-spend allowance meter and the admin panel's "estimated
 * spend" line — they are NOT billing, and no customer is charged from them.
 * Confirm the real rates before any pricing decision rests on this table.
 */
export const FORGE_LLM_USD_PER_M = {
  haiku: { in: 1, out: 5 },
  sonnet: { in: 3, out: 15 },
  opus: { in: 5, out: 25 },
};

/** Estimated USD for one Forge LLM call. Unknown tier → 0 (never guess upward). */
export const forgeLlmCostUsd = (tier, promptTokens, completionTokens) => {
  const rate = FORGE_LLM_USD_PER_M[tier];
  if (!rate) return 0;
  return (nn(promptTokens) * rate.in + nn(completionTokens) * rate.out) / 1e6;
};

/*
 * MONTHLY VENDOR ALLOWANCE. Forge LLM tokens are billed to LeanZero, so a Coder
 * tenant gets an allowance that scales with the seats they pay for:
 * clamp(seats × $2.00, $40, $800) per month. Soft at 80% (warn), hard at 100%
 * (saved rules downgrade to Haiku, agent surfaces pause — both documented).
 * Seat count is a daily snapshot; when it is unknown we assume 100 seats, which
 * lands mid-band rather than at either clamp.
 */
export const FORGE_LLM_ALLOWANCE = { perSeatUsd: 2.0, minUsd: 40, maxUsd: 800, softPct: 0.8 };
export const FORGE_LLM_ALLOWANCE_FALLBACK_SEATS = 100;

export const allowanceUsdForSeats = (seats) => {
  const n = typeof seats === "number" && Number.isFinite(seats) && seats > 0 ? seats : FORGE_LLM_ALLOWANCE_FALLBACK_SEATS;
  const raw = n * FORGE_LLM_ALLOWANCE.perSeatUsd;
  return Math.min(FORGE_LLM_ALLOWANCE.maxUsd, Math.max(FORGE_LLM_ALLOWANCE.minUsd, raw));
};

const FORGE_TIERS = ["haiku", "sonnet", "opus"];

/** Deep-copy + shape-repair a stored forgeLlm block (old rows have none). */
const mergeForgeLlm = (f) => {
  const base = emptyForgeLlm();
  if (!f || typeof f !== "object") return base;
  const src = f.byTier && typeof f.byTier === "object" ? f.byTier : {};
  for (const t of FORGE_TIERS) {
    const b = src[t] || {};
    base.byTier[t] = { calls: nn(b.calls), prompt: nn(b.prompt), completion: nn(b.completion) };
  }
  const est = typeof f.estUsd === "number" && Number.isFinite(f.estUsd) && f.estUsd > 0 ? f.estUsd : 0;
  base.estUsd = est;
  base.clampedCalls = nn(f.clampedCalls);
  return base;
};

const emptyMonth = (key) => ({ key, calls: 0, prompt: 0, completion: 0, total: 0, byProvider: {}, forgeLlm: emptyForgeLlm() });
const emptyDay = (key) => ({ key, calls: 0, prompt: 0, completion: 0, total: 0 });

export const emptyState = () => ({ month: emptyMonth(null), today: emptyDay(null), history: [] });

// Apply the month/day rollover to a state given `now`, returning a NEW state
// (never mutates the input). Rolling the finished month into a capped history and
// resetting the day bucket. Used by both bumpCounters and summarizeState so a read
// across a period boundary shows the new period at zero without a write.
const rolled = (state, nowMs) => {
  const s = state && typeof state === "object" ? state : emptyState();
  const mk = monthKey(nowMs);
  const dk = dayKey(nowMs);
  let month = s.month && typeof s.month === "object" ? s.month : emptyMonth(null);
  let today = s.today && typeof s.today === "object" ? s.today : emptyDay(null);
  let history = Array.isArray(s.history) ? s.history.slice() : [];
  if (month.key !== mk) {
    if (month.key) history = [{ key: month.key, calls: nn(month.calls), total: nn(month.total) }, ...history].slice(0, 6);
    month = emptyMonth(mk);
  } else {
    month = { ...month, key: mk, byProvider: { ...(month.byProvider || {}) }, forgeLlm: mergeForgeLlm(month.forgeLlm) };
  }
  if (today.key !== dk) today = emptyDay(dk);
  else today = { ...today, key: dk };
  return { month, today, history };
};

// Record one AI call. Returns a NEW state (pure).
// `model` / `tier` / `costUsd` are OPTIONAL and are recorded ONLY for the
// "atlassian" provider — Forge LLM is the only provider whose tokens land on the
// vendor's bill, so it is the only one with a per-tier cost bucket. BYOK spend is
// the customer's and is deliberately not costed here.
export const bumpCounters = (state, { provider, usage, nowMs, model, tier, costUsd }) => {
  const s = rolled(state, nowMs);
  const u = usage && typeof usage === "object" ? usage : normalizeUsage(usage);
  const p = clampProvider(provider);
  const month = { ...s.month, byProvider: { ...s.month.byProvider }, forgeLlm: mergeForgeLlm(s.month.forgeLlm) };
  month.calls += 1;
  month.prompt += nn(u.prompt);
  month.completion += nn(u.completion);
  month.total += nn(u.total);
  const bp = month.byProvider[p] || { calls: 0, total: 0 };
  month.byProvider[p] = { calls: bp.calls + 1, total: bp.total + nn(u.total) };
  if (p === "atlassian") {
    const t = FORGE_TIERS.includes(tier) ? tier : forgeLlmTierFromModel(model);
    if (t) {
      const b = month.forgeLlm.byTier[t];
      month.forgeLlm.byTier[t] = { calls: b.calls + 1, prompt: b.prompt + nn(u.prompt), completion: b.completion + nn(u.completion) };
    }
    const cost = typeof costUsd === "number" && Number.isFinite(costUsd) && costUsd > 0
      ? costUsd
      : forgeLlmCostUsd(t, u.prompt, u.completion);
    month.forgeLlm.estUsd += cost;
  }
  const today = { ...s.today };
  today.calls += 1;
  today.total += nn(u.total);
  return { month, today, history: s.history };
};

// Read-only summary (applies rollover without a write).
export const summarizeState = (state, nowMs) => {
  const s = rolled(state, nowMs);
  return {
    month: { key: s.month.key, calls: nn(s.month.calls), prompt: nn(s.month.prompt), completion: nn(s.month.completion), total: nn(s.month.total), byProvider: s.month.byProvider || {}, forgeLlm: mergeForgeLlm(s.month.forgeLlm) },
    today: { key: s.today.key, calls: nn(s.today.calls), total: nn(s.today.total) },
    history: s.history || [],
  };
};

// Soft monthly-call ceiling check (0/absent = unlimited). Counts ALL AI calls
// (runtime validators/PFs AND design-time), so the caller must only ever GATE
// discretionary design-time features with it — never a runtime transition.
export const overCallCeiling = (state, limit, nowMs) => {
  const lim = nn(limit);
  if (lim <= 0) return false;
  return summarizeState(state, nowMs).month.calls >= lim;
};

/*
 * Tier from a model id, kept LOCAL and minimal so usage-meter.js stays free of
 * imports (it bundles into the admin panel). The authoritative classifier is
 * `forgeLlmTier` in src/shared/edition.js; callers that already have an edition
 * in hand should pass `tier` into bumpCounters explicitly rather than rely on this.
 */
function forgeLlmTierFromModel(model) {
  const s = typeof model === "string" ? model.toLowerCase() : "";
  if (!s) return null;
  if (s.includes("haiku")) return "haiku";
  if (s.includes("sonnet")) return "sonnet";
  if (s.includes("opus")) return "opus";
  return null;
}

/**
 * Where this month's Forge LLM spend sits against the tenant's allowance.
 * level: "ok" < 80%, "soft" >= 80%, "hard" >= 100%. A non-positive allowance is
 * treated as "ok" with pct 0 — an unknown allowance must never pause the product.
 */
export const forgeLlmAllowanceStatus = (state, allowanceUsd, nowMs = Date.now()) => {
  const est = summarizeState(state, nowMs).month.forgeLlm.estUsd || 0;
  const allowance = typeof allowanceUsd === "number" && Number.isFinite(allowanceUsd) && allowanceUsd > 0 ? allowanceUsd : 0;
  const pct = allowance > 0 ? est / allowance : 0;
  const level = allowance > 0 ? (pct >= 1 ? "hard" : (pct >= FORGE_LLM_ALLOWANCE.softPct ? "soft" : "ok")) : "ok";
  return { estUsd: est, allowanceUsd: allowance, pct, level };
};

/** Count one allowance-forced downgrade to Haiku. Returns a NEW state (pure). */
export const noteForgeLlmClamp = (state, nowMs = Date.now()) => {
  const s = rolled(state, nowMs);
  const forgeLlm = mergeForgeLlm(s.month.forgeLlm);
  forgeLlm.clampedCalls += 1;
  return { month: { ...s.month, forgeLlm }, today: s.today, history: s.history };
};
