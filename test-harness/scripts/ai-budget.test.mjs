/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Offline unit test for src/shared/ai-budget.js — the budget-aware queue maths.
// No live Forge. Run: node ai-budget.test.mjs
import {
  minuteKey, effectiveBudget, estimateTokensFromText, estimateTaskTokens, budgetDecision,
  inlineShouldQueue, describeBudgetWait, MAX_BUDGET_DEFERRALS, AI_BUDGET_DEFAULT_TPM,
} from "../../src/shared/ai-budget.js";

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
ok(budgetDecision({ budget: 35000, used: 35000, estimate: 100, nowMs: t }).delaySeconds <= 900, "delay never exceeds the platform max");

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
