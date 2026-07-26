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

const emptyMonth = (key) => ({ key, calls: 0, prompt: 0, completion: 0, total: 0, byProvider: {} });
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
    month = { ...month, key: mk, byProvider: { ...(month.byProvider || {}) } };
  }
  if (today.key !== dk) today = emptyDay(dk);
  else today = { ...today, key: dk };
  return { month, today, history };
};

// Record one AI call. Returns a NEW state (pure).
export const bumpCounters = (state, { provider, usage, nowMs }) => {
  const s = rolled(state, nowMs);
  const u = usage && typeof usage === "object" ? usage : normalizeUsage(usage);
  const p = clampProvider(provider);
  const month = { ...s.month, byProvider: { ...s.month.byProvider } };
  month.calls += 1;
  month.prompt += nn(u.prompt);
  month.completion += nn(u.completion);
  month.total += nn(u.total);
  const bp = month.byProvider[p] || { calls: 0, total: 0 };
  month.byProvider[p] = { calls: bp.calls + 1, total: bp.total + nn(u.total) };
  const today = { ...s.today };
  today.calls += 1;
  today.total += nn(u.total);
  return { month, today, history: s.history };
};

// Read-only summary (applies rollover without a write).
export const summarizeState = (state, nowMs) => {
  const s = rolled(state, nowMs);
  return {
    month: { key: s.month.key, calls: nn(s.month.calls), prompt: nn(s.month.prompt), completion: nn(s.month.completion), total: nn(s.month.total), byProvider: s.month.byProvider || {} },
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
