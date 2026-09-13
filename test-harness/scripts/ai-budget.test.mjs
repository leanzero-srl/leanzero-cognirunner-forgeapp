/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Offline unit test for src/shared/ai-budget.js — the budget-aware queue maths.
// No live Forge. Run: node ai-budget.test.mjs
import { readFileSync } from "node:fs";
import {
  minuteKey, effectiveBudget, estimateTokensFromText, estimateTaskTokens, budgetDecision,
  inlineShouldQueue, describeBudgetWait, MAX_BUDGET_DEFERRALS, MAX_BUDGET_DEFER_DELAY_S, AI_BUDGET_DEFAULT_TPM,
  GITREVIEW_DIFF_CAP_BYTES, TOKEN_SPENDING_TASK_TYPES, MODE_DECIDED_TASK_TYPES, NON_AI_TASK_TYPES,
} from "../../src/shared/ai-budget.js";
const { DIFF_MAX_TOTAL_BYTES } = await import("../../src/git-providers.js");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

// --- keys / defaults ---
ok(minuteKey(60000) === 1 && minuteKey(119999) === 1 && minuteKey(120000) === 2, "minuteKey floors to the minute");
ok(effectiveBudget("atlassian", null) === AI_BUDGET_DEFAULT_TPM.atlassian, "atlassian default 35k");
ok(effectiveBudget("openai", null) === 0, "BYOK default off");
ok(effectiveBudget("atlassian", { tokensPerMinute: { atlassian: 0 } }) === 0, "explicit 0 disables");
ok(effectiveBudget("openai", { tokensPerMinute: { openai: 12000.7 } }) === 12000, "explicit value floors");
ok(effectiveBudget("atlassian", { tokensPerMinute: { atlassian: -5 } }) === 0, "negative clamps to 0");

// --- estimates ---
ok(estimateTokensFromText("abcdefgh") === 2, "4 chars per token");
ok(estimateTaskTokens("postfunction", { config: { type: "postfunction-semantic", prompt: "x".repeat(400) } }) > 1500, "PF estimate adds output allowance");
ok(estimateTaskTokens("postfunction", { config: { type: "postfunction-generate-doc" } }) >= 4000, "doc-gen is heavier");
ok(estimateTaskTokens("postfunction", {}, 800) === 880, "learned cost wins, +10%");
ok(estimateTaskTokens("codegen", {}) === 6000 && estimateTaskTokens("unknown", {}) === 2000, "fixed task estimates");

// --- 1.4 estimates (git review, coder, verification agenda) ---
// F-323 — an UNKNOWN diff size is priced at the CAP the engine truncates to, not at
// the flat minimum: under-reserving the app's most expensive task is what breaches the
// provider's per-minute ceiling and lands the 429 on a user-facing validator.
ok(estimateTaskTokens("gitreview", {}) === Math.ceil(GITREVIEW_DIFF_CAP_BYTES / 4) + 4000, "gitreview with no diffBytes assumes the diff CAP");
ok(GITREVIEW_DIFF_CAP_BYTES === DIFF_MAX_TOTAL_BYTES, "…and that cap is the SAME number as the engine's DIFF_MAX_TOTAL_BYTES (lockstep, not a copy)");
ok(estimateTaskTokens("gitreview", { diffBytes: 4096 }) === 1024 + 4000, "a small known diff is priced small");
ok(estimateTaskTokens("gitreview", { diffBytes: 10 * 1024 * 1024 }) === Math.ceil(GITREVIEW_DIFF_CAP_BYTES / 4) + 4000, "a huge diff is priced at the cap, never above it");
ok(estimateTaskTokens("gitreview", { diffBytes: 60 * 1024 }) === Math.ceil(60 * 1024 / 4) + 4000,
  "gitreview scales with the diff at 4 bytes/token on top of the flat cost");
ok(estimateTaskTokens("gitreview", { diffBytes: "not a number" }) === Math.ceil(GITREVIEW_DIFF_CAP_BYTES / 4) + 4000, "a non-numeric diffBytes falls back to the cap, not to zero");

// F-325 — the three lists partition every task type the consumer can route, and the
// consumer's AI_TASK_TYPES is DERIVED from the first one.
{
  const asyncSrc = readFileSync(new URL("../../src/async-handler.js", import.meta.url), "utf8");
  ok(/export const AI_TASK_TYPES = new Set\(TOKEN_SPENDING_TASK_TYPES\)/.test(asyncSrc),
    "AI_TASK_TYPES is derived from ai-budget's list, never retyped");
  const handlers = (asyncSrc.match(/const TASK_HANDLERS = \{[\s\S]*?\n\};/) || [""])[0];
  const keys = [...handlers.matchAll(/"([a-z_-]+)":/g)].map((m) => m[1]);
  const known = new Set([...TOKEN_SPENDING_TASK_TYPES, ...MODE_DECIDED_TASK_TYPES, ...NON_AI_TASK_TYPES]);
  for (const k of keys) ok(known.has(k), `task type "${k}" is classified as spending / mode-decided / non-AI`);
  for (const t of TOKEN_SPENDING_TASK_TYPES) ok(estimateTaskTokens(t, {}) > 0, `a spending task type (${t}) has a real estimate`);
  // `probe` and `gitcredrotate` fall through to the estimator's default; they are never
  // gated (they are not in AI_TASK_TYPES), so the default is harmless — what matters is
  // that neither is classified as spending.
  for (const t of NON_AI_TASK_TYPES) ok(!TOKEN_SPENDING_TASK_TYPES.includes(t), `a non-AI task type (${t}) is not priced as spending`);
  ok(estimateTaskTokens("git-event", {}) === 0, "a git delivery is explicitly priced at zero");
  const overlap = TOKEN_SPENDING_TASK_TYPES.filter((t) => MODE_DECIDED_TASK_TYPES.includes(t) || NON_AI_TASK_TYPES.includes(t));
  ok(overlap.length === 0, "the three lists do not overlap — one task type, one answer");
}
ok(estimateTaskTokens("gitreview", { diffBytes: 60 * 1024 }, 900) === 990, "a learned cost still wins for gitreview");
ok(estimateTaskTokens("coder", {}) === 16000, "a coder turn is the most expensive queued task");
ok(estimateTaskTokens("va-item", {}) === 8000, "a verification-agenda item is one bounded call");
ok(estimateTaskTokens("va-post", {}) === 200, "posting a verification result is almost free");
ok(estimateTaskTokens("git-event", { repoId: "o/r", payload: "x".repeat(10000) }) === 0,
  "git-event estimates ZERO however big the delivery is — it calls no model");

// The estimate is only half the statement: the consumer must also never GATE a
// git-event. The other half is asserted in async-handler-helpers.test.mjs over the
// real AI_TASK_TYPES set; this line is the pointer to it so neither can be changed alone.
{
  const src = readFileSync(new URL("../../src/async-handler.js", import.meta.url), "utf8");
  // F-325 — the set is DERIVED from ai-budget's list now, so the question is asked of
  // that list (the one home) and of the derivation in the consumer.
  ok(/export const AI_TASK_TYPES = new Set\(TOKEN_SPENDING_TASK_TYPES\)/.test(src), "AI_TASK_TYPES is derived from the ONE list");
  ok(!TOKEN_SPENDING_TASK_TYPES.includes("git-event"), "git-event is NOT a spending task type — never gated");
  ok(TOKEN_SPENDING_TASK_TYPES.includes("gitreview"), "gitreview IS a spending task type — always gated");
}

// --- decisions ---
const t = Date.UTC(2026, 8, 12, 10, 0, 20); // :20 into the minute
ok(budgetDecision({ budget: 0, used: 99999, estimate: 5000, nowMs: t }).allow === true, "no budget → always allow");
ok(budgetDecision({ budget: 35000, used: 10000, reserved: 5000, estimate: 2000, nowMs: t }).allow === true, "fits → allow");
const d = budgetDecision({ budget: 35000, used: 30000, reserved: 4000, estimate: 2000, nowMs: t, jitter: 0 });
ok(d.allow === false && d.delaySeconds === 41, `over → defer to just past the boundary (got ${d.delaySeconds})`);
const d2 = budgetDecision({ budget: 35000, used: 30000, reserved: 4000, estimate: 2000, nowMs: t, jitter: 0.999, deferrals: 20 });
ok(d2.allow === false && d2.delaySeconds > d.delaySeconds && d2.delaySeconds <= 41 + 30, "later deferrals spread wider");
ok(budgetDecision({ budget: 35000, used: 0, reserved: 0, estimate: 50000, nowMs: t }).oversized === true, "oversized task runs on an empty minute");
ok(budgetDecision({ budget: 35000, used: 100, reserved: 0, estimate: 50000, nowMs: t }).allow === false, "oversized task waits for an empty minute");
ok(budgetDecision({ budget: 35000, used: 35000, estimate: 100, nowMs: t, deferrals: MAX_BUDGET_DEFERRALS }).forced === true, "deferral cap forces a run");
ok(budgetDecision({ budget: 35000, used: 35000, estimate: 100, nowMs: t }).delaySeconds <= MAX_BUDGET_DEFER_DELAY_S, "delay never exceeds the platform max");

// --- inline valve ---
ok(inlineShouldQueue({ budget: 35000, used: 20000, reserved: 1000 }) === true, "60% used → queue inline PFs");
ok(inlineShouldQueue({ budget: 35000, used: 10000, reserved: 1000 }) === false, "below threshold → inline");
ok(inlineShouldQueue({ budget: 0, used: 10 }) === false, "no budget → never routes");

// --- UI text ---
ok(describeBudgetWait({ until: new Date(t + 30000).toISOString() }, t) === "next slot in 30s", "wait text");
ok(describeBudgetWait({ until: new Date(t - 1000).toISOString() }, t) === "slot due", "past due text");
ok(describeBudgetWait(null) === "", "no wait → empty");

console.log(`ai-budget: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
