/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

// AI TOKEN BUDGET — the pure maths behind the budget-aware queue.
//
// Forge LLM allows 50,000 tokens per minute per installation (Sept 2026 limits
// page). A burst of post-functions, listeners and jobs can spend that in seconds,
// after which every call — including a user-facing validator — gets a 429 and
// fails open. The owner's rule (2026-09-12): the app keeps doing its purpose,
// just SLOWER. Background AI work is drained from the queue at a tokens-per-minute
// pace; synchronous validators keep the headroom above the queue budget.
//
// This module is dependency-free (bundles into the backend AND the admin panel).
// The KVS ledger lives in src/index.js; the consumer gate in src/async-handler.js.

/**
 * Platform ceilings we must stay under (tokens per minute, per installation).
 *
 * VERIFIED 2026-09-12: Forge LLM's 50,000 tokens/min cap is PER MODEL per
 * installation — Sonnet 5 and Opus 5 are counted independently of Haiku and of
 * each other. The pacing below is deliberately still applied to the INSTALLATION
 * as a whole (one number, one bucket): the conservative reading can only ever
 * slow the app down, never overrun the platform, and splitting the ledger by
 * model would change how every existing bucket key is read. When the queue grows
 * a per-model bucket, this flag is the thing that says it is allowed to.
 */
export const AI_PLATFORM_TPM = { atlassian: 50000 };
/** The cap above is per model, not per installation-wide token spend. */
export const AI_PLATFORM_TPM_PER_MODEL = true;

/** Default queue budgets when the admin has not set one. 0 = no budget (BYOK). */
export const AI_BUDGET_DEFAULT_TPM = { atlassian: 35000 };

/** Share of the minute budget above which INLINE post-functions route to the queue. */
export const INLINE_QUEUE_THRESHOLD = 0.6;

/** Budget-deferred jobs get this long (from first enqueue) before they are abandoned. */
export const BUDGET_WAIT_HORIZON_MS = 60 * 60 * 1000;

/** Never defer a job more than this many times — after that it runs regardless. */
export const MAX_BUDGET_DEFERRALS = 60;

/** Minute bucket id for a timestamp. */
export const minuteKey = (ms) => Math.floor(ms / 60000);

/** Effective budget for a provider: explicit admin value wins (0 = off), else the default. */
export const effectiveBudget = (provider, settings) => {
  const map = (settings && settings.tokensPerMinute) || {};
  const v = map[provider];
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, Math.floor(v));
  return AI_BUDGET_DEFAULT_TPM[provider] || 0;
};

/** ~4 chars per token is the usual English/JSON ratio; good enough for a gate. */
export const estimateTokensFromText = (text) => Math.ceil(String(text || "").length / 4);

/**
 * Rough cost of a queued task BEFORE it runs. Deliberately generous on output so
 * a run never blows the window because the estimate was optimistic. A learned
 * per-rule cost (from a previous run) overrides this.
 */
export const estimateTaskTokens = (taskType, params, learned) => {
  if (typeof learned === "number" && learned > 0) return Math.round(learned * 1.1);
  const p = params || {};
  switch (taskType) {
    case "postfunction": {
      const cfg = p.config || {};
      const prompt = estimateTokensFromText(JSON.stringify(cfg));
      const heavy = /generate-doc|research/.test(String(cfg.type || ""));
      return prompt + (heavy ? 4000 : 1500);
    }
    case "listener":
    case "scheduledjob":
      return estimateTokensFromText(JSON.stringify(p)) + 2500;
    case "codegen":
    case "fixcode":
      return 6000;
    case "review":
      return 4000;
    case "skilldistill":
    case "memory_distill":
      return 3000;
    default:
      return 2000;
  }
};

/**
 * Decide whether a task may run in the current minute.
 * used     = actual tokens recorded in this minute's bucket
 * reserved = estimates of tasks currently running in this minute
 * Returns { allow, delaySeconds, usedPct }. delaySeconds lands the re-pushed
 * event just after the next minute boundary, jittered so a backlog spreads.
 */
export const budgetDecision = ({ used = 0, reserved = 0, estimate = 0, budget = 0, nowMs = Date.now(), deferrals = 0, jitter = Math.random() }) => {
  const usedPct = budget > 0 ? (used + reserved) / budget : 0;
  if (!(budget > 0)) return { allow: true, delaySeconds: 0, usedPct };
  if (deferrals >= MAX_BUDGET_DEFERRALS) return { allow: true, delaySeconds: 0, usedPct, forced: true };
  if (used + reserved + estimate <= budget) return { allow: true, delaySeconds: 0, usedPct };
  // A single task larger than the whole budget can never fit — let it through on an
  // EMPTY minute rather than deferring forever.
  if (estimate > budget && used + reserved === 0) return { allow: true, delaySeconds: 0, usedPct, oversized: true };
  const toBoundary = 60 - Math.floor((nowMs % 60000) / 1000);
  // Later deferrals spread wider (up to +30s) so a deep backlog does not stampede
  // the boundary and re-defer en masse.
  const spread = Math.min(30, 5 + deferrals * 2);
  const delaySeconds = Math.max(2, toBoundary + 1 + Math.floor(jitter * spread));
  return { allow: false, delaySeconds: Math.min(900, delaySeconds), usedPct };
};

/** Should an inline (synchronous) post-function be routed to the queue instead? */
export const inlineShouldQueue = ({ used = 0, reserved = 0, budget = 0, threshold = INLINE_QUEUE_THRESHOLD }) =>
  budget > 0 && (used + reserved) >= budget * threshold;

/** Human line for the Jobs tab. */
export const describeBudgetWait = (wait, nowMs = Date.now()) => {
  if (!wait || !wait.until) return "";
  const s = Math.max(0, Math.round((Date.parse(wait.until) - nowMs) / 1000));
  return s > 0 ? `next slot in ${s}s` : "slot due";
};
