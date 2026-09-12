/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Offline guard for the FORGE LLM MODEL POLICY seam (editions 1.3).
//
// Forge LLM tokens are billed to the VENDOR, so "which model may this tenant run" is a
// pricing boundary, not a preference. Until 1.3 it was an arity-1 regex
// (`isForgeLlmModelAllowed = (id) => /haiku/i.test(id)`) copied across four enforcement
// sites; it now lives once in src/shared/edition.js. This test exists to keep it that way:
// a future "just let sonnet through here" edit at one call site has to delete an assertion.
//
// src/index.js and src/async-handler.js cannot be imported offline (@forge/* at load), so
// this source-parses them — the project pattern (async-handler-helpers.test.mjs).
// Auto-discovered by run-offline.mjs. Run: node scripts/forge-llm-policy.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { FORGE_LLM_DEFAULT, FORGE_LLM_FRONTIER, FORGE_LLM_MODELS } from "../../src/shared/edition.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const indexSrc = readFileSync(path.join(here, "../../src/index.js"), "utf8");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

// Strip line comments so "the old regex is mentioned in a comment" never satisfies a
// "the rule still exists" assertion, and never trips a "the rule is gone" one.
const codeOnly = indexSrc.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

// =====================================================================================
// 1. The old regex policy is GONE from the code (not merely unused)
// =====================================================================================
ok(!/const isForgeLlmModelAllowed\s*=/.test(codeOnly), "the arity-1 isForgeLlmModelAllowed is deleted");
ok(!/isForgeLlmModelAllowed\(/.test(codeOnly), "nothing calls isForgeLlmModelAllowed any more");
ok(!/FORGE_LLM_FALLBACK_MODELS/.test(codeOnly), "FORGE_LLM_FALLBACK_MODELS is deleted (the edition list IS the fallback)");
ok(!/\/haiku\/i/.test(codeOnly), "no /haiku/i regex survives anywhere in src/index.js");
ok(/from "\.\/shared\/edition\.js"/.test(indexSrc), "src/index.js imports the policy from the shared module");
for (const sym of ["FORGE_LLM_MODELS", "FORGE_LLM_FRONTIER", "FORGE_LLM_DEFAULT", "clampForgeLlmModel", "forgeLlmModelAllowedForEdition", "forgeLlmTier"]) {
  ok(new RegExp("\\b" + sym + "\\b").test(indexSrc), `src/index.js imports ${sym}`);
}
ok(!/FORGE_LLM_MODELS\s*=/.test(codeOnly), "src/index.js does not redefine FORGE_LLM_MODELS");

// =====================================================================================
// 2. The four enforcement sites go through the shared policy
// =====================================================================================
{
  // getOpenAIModels — never refuses, returns models + locked + edition
  // Bounded by the NEXT provider branch so an over-greedy slice cannot borrow
  // LM Studio's refusals and make this section pass for the wrong reason.
  const start = indexSrc.indexOf("forgeLlmListApi()");
  const end = indexSrc.indexOf("// LM Studio: auth is optional", start);
  ok(start > 0 && end > start, "found the Forge LLM branch of getOpenAIModels");
  const b = indexSrc.slice(indexSrc.lastIndexOf('if (provider === "atlassian") {', start), end);
  ok(/currentEdition\(\)/.test(b), "getOpenAIModels resolves the edition");
  ok(/FORGE_LLM_MODELS\[edition\]/.test(b), "getOpenAIModels intersects list() with the EDITION's list");
  ok(/locked/.test(b) && /FORGE_LLM_MODELS\.advanced\.filter/.test(b),
    "getOpenAIModels reports `locked` rows (a Standard site SEES Sonnet 5 / Opus 5 as locked)");
  ok(!/return \{ success: false/.test(b), "getOpenAIModels never refuses — browsing models on Standard is not an error");
  ok(/ids = \[\.\.\.allowed\]/.test(b), "when list() returns nothing usable, the edition list is the fallback");
}
{
  // saveOpenAIModel
  const i = codeOnly.indexOf('resolver.define("saveOpenAIModel"');
  ok(i > 0, "found saveOpenAIModel");
  const b = codeOnly.slice(i, i + 2200);
  ok(/forgeLlmModelAllowedForEdition\(edition, model\)/.test(b), "saveOpenAIModel checks the exact-id edition policy");
  ok(/FORGE_LLM_FRONTIER\.includes\(String\(model\)\)/.test(b) && /upgradeRequired\("forge-llm-frontier-models"\)/.test(b),
    "a frontier id on Standard returns the UPGRADE refusal, not a flat error");
  ok(/Model not offered on Atlassian \(Forge LLM\)\./.test(b), "a non-offered id gets a plain refusal on every edition");
}
{
  // getOpenAIModelFromKVS
  const i = codeOnly.indexOf('resolver.define("getOpenAIModelFromKVS"');
  ok(i > 0, "found getOpenAIModelFromKVS");
  const b = codeOnly.slice(i, i + 1400);
  ok(/clampForgeLlmModel\(edition, savedModel\)/.test(b), "getOpenAIModelFromKVS clamps the saved model by edition");
  // F-078: `clamped` needs a SAVED model — with nothing saved there is no downgrade to report.
  ok(/clamped: !!savedModel && savedModel !== effective/.test(b), "it reports `clamped` only when a SAVED model was downgraded");
  ok(/edition,/.test(b), "it returns the edition");
}
{
  // callForgeLlmChat — THE billing backstop
  const i = codeOnly.indexOf("const callForgeLlmChat = async");
  ok(i > 0, "found callForgeLlmChat");
  const b = codeOnly.slice(i, i + 2000);
  ok(/getProviderConfig\(\)/.test(b), "the adapter reads edition+allowance from the 30s provider memo");
  ok(/clampForgeLlmModel\(/.test(b), "the adapter clamps by edition");
  ok(/allowance\.level === "hard"/.test(b) && new RegExp("model = FORGE_LLM_DEFAULT").test(b),
    "a HARD allowance forces FORGE_LLM_DEFAULT regardless of edition");
  ok(/noteForgeLlmClamp\(/.test(b), "an allowance-forced clamp is counted through the meter");
  ok(/console\.warn\(/.test(b), "the clamp logs one line");
  ok(/clampForgeLlmModel\("standard"/.test(b),
    "any error resolving edition/allowance FAILS SOFT to the Standard clamp — never an exception into a transition");
  ok(!/await storage\.get\(providerModelSlot/.test(b), "the adapter adds NO new KVS read of its own inside the race");
}
{
  // The effective model is returned so the meter costs what was billed
  const i = codeOnly.indexOf("const openAIData = {");
  const b = codeOnly.slice(i, i + 700);
  ok(/\n      model,/.test(b), "callForgeLlmChat returns the EFFECTIVE model in data.model");
}

// =====================================================================================
// 3. recordAiUsage carries the model and costs only the vendor-billed provider
// =====================================================================================
{
  const m = codeOnly.match(/export const recordAiUsage = async \(\{[\s\S]*?\n\};/);
  ok(!!m, "found recordAiUsage");
  const b = m ? m[0] : "";
  ok(/\{ provider, usageLike, model \}/.test(b), "recordAiUsage's signature gained `model`");
  ok(/provider === "atlassian"/.test(b), "only the atlassian provider is costed (BYOK spend is the customer's)");
  ok(/forgeLlmTier\(model\)/.test(b) && /forgeLlmCostUsd\(tier/.test(b), "tier + cost are derived from the model");
  ok(/bumpCounters\(state, \{ provider: provider \|\| "unknown", usage, nowMs: Date\.now\(\), model, tier, costUsd \}\)/.test(b),
    "the tier/cost are passed into bumpCounters");
  ok(/metering is best-effort/.test(indexSrc), "the fail-open comment on the meter is still there");
}
{
  const calls = codeOnly.split("\n").filter((l) => /await recordAiUsage\(\{/.test(l));
  ok(calls.length >= 4, `found ${calls.length} recordAiUsage call sites`);
  ok(calls.every((l) => /model:/.test(l)), "EVERY recordAiUsage call site passes a model");
  ok(calls.filter((l) => /data\.model/.test(l)).length === calls.length,
    "every site prefers the adapter's EFFECTIVE data.model over the configured one");
}

// =====================================================================================
// 4. Allowance + seats plumbing
// =====================================================================================
ok(/SEAT_SNAPSHOT_KEY = "COGNIRUNNER_SEAT_SNAPSHOT"/.test(codeOnly), "seat snapshot key");
ok(/SEAT_SCAN_MAX = 2000/.test(codeOnly), "the user scan stops at 2,000 (past that the allowance is at its ceiling)");
ok(/SEAT_SNAPSHOT_MAX_AGE_MS = 24 \* 60 \* 60 \* 1000/.test(codeOnly), "the seat count refreshes at most once a day");
ok(/rest\/api\/3\/users\/search/.test(codeOnly), "seats are counted from /rest/api/3/users/search (read:jira-user is held)");
{
  const m = codeOnly.match(/const maybeRefreshSeatSnapshot = \(\) => \{[\s\S]*?\n\};/);
  ok(!!m, "found maybeRefreshSeatSnapshot");
  const b = m ? m[0] : "";
  ok(!/^const maybeRefreshSeatSnapshot = async/.test(b), "the seat refresh is NOT async at the call site — nothing awaits it");
  ok(/u\.active === true && u\.accountType === "atlassian"/.test(b), "only active Atlassian accounts count as seats");
  // F-081: a failed page must WRITE a marker row, not just return — otherwise every cold
  // container restarts the scan. The count itself is still never overwritten with a wrong number.
  ok(/seats: null, error/.test(b), "a failed page writes a {seats:null,error} marker so it cannot re-run for 24h");
  ok(/await write\(\{ seats \}\)/.test(b), "a completed scan writes its count");
  // F-080: a SHORT page is normal (Jira caps maxResults); only an empty page ends the scan.
  ok(!/page\.length < SEAT_PAGE/.test(b), "a short page no longer truncates the scan");
}
{
  const m = codeOnly.match(/const getProviderConfig = async \(\) => \{[\s\S]*?\n\};/);
  ok(!!m, "found getProviderConfig");
  const b = m ? m[0] : "";
  ok(/edition: _cachedEditionId, allowance: _cachedAllowance/.test(b), "the memo returns edition + allowance on the CACHED path too");
  ok(/if \(provider === "atlassian"\)/.test(b), "the extra reads only happen for the vendor-billed provider");
  ok(/forgeLlmAllowanceStatus\(stateRes \|\| emptyState\(\), allowanceUsdForSeats\(seatsRes\)\)/.test(b), "the allowance is computed at refresh time");
  // F-079: the seat SCAN no longer rides the transition path — it is triggered from the
  // admin-panel resolvers (getAiUsage / checkLicense) only.
  ok(!/maybeRefreshSeatSnapshot/.test(b), "the provider memo never starts a seat scan");
  ok(/Promise\.all\(\[/.test(b), "the memo's three Forge-LLM reads go out in parallel");
  ok(/_cachedAllowance = null;/.test(b), "every failure path leaves the allowance null (no ceiling known → never 'hard')");
}
{
  const i = codeOnly.indexOf('resolver.define("getAiUsage"');
  const b = codeOnly.slice(i, i + 900);
  ok(/forgeLlm: forgeLlmAllowanceStatus\(state, allowanceUsdForSeats\(seats\)\)/.test(b), "getAiUsage reports the allowance status");
  ok(/seats,/.test(b), "getAiUsage reports the seat count");
}
{
  const i = codeOnly.indexOf('resolver.define("checkProviderHealth"');
  const b = codeOnly.slice(i, i + 1800);
  ok(/const model = \(result && result\.data && result\.data\.model\) \|\| configuredModel;/.test(b),
    "checkProviderHealth reports the EFFECTIVE (clamped) model");
  // F-086: `clamped` is an EDITION verdict, never a compare against the id the provider echoed.
  ok(/clampForgeLlmModel\(edition, configuredModel\) !== configuredModel/.test(b),
    "and says when the EDITION refuses the configured model");
  ok(!/clamped: model !== configuredModel/.test(b), "the provider-echo comparison is gone");
}

// =====================================================================================
// 5. The agent model slot
// =====================================================================================
ok(/const providerAgentModelSlot = \(provider\) => `COGNIRUNNER_AGENT_MODEL_\$\{provider\}`;/.test(codeOnly),
  "providerAgentModelSlot = COGNIRUNNER_AGENT_MODEL_{provider}");
ok(/export const getAgentModel = async \(\)/.test(codeOnly), "getAgentModel is exported as a backend function");
{
  const i = codeOnly.indexOf('resolver.define("saveAgentModel"');
  ok(i > 0, "found the saveAgentModel resolver");
  const b = codeOnly.slice(i, i + 1800);
  ok(/requireAdmin\(context\.accountId\)/.test(b), "saveAgentModel is admin-gated");
  ok(/FORGE_LLM_FRONTIER\.includes\(clean\)/.test(b), "on Forge LLM only the frontier ids are accepted");
  ok(/upgradeRequired\("forge-llm-frontier-models"\)/.test(b), "a Standard tenant gets the upgrade refusal");
  // F-084: the 120-char cap moved into normalizeModelId (src/shared/edition.js), shared
  // with saveOpenAIModel — one home for what a legal model id is.
  ok(/normalizeModelId\(payload && payload\.model\)/.test(b), "model ids are normalised server-side by the shared normaliser");
}
{
  const i = codeOnly.indexOf('resolver.define("getAgentModel"');
  ok(i > 0, "found the getAgentModel resolver");
  const b = codeOnly.slice(i, i + 1200);
  ok(/frontierOnly: provider === "atlassian"/.test(b), "getAgentModel flags frontierOnly for Forge LLM");
  ok(/edition/.test(b), "getAgentModel returns the edition");
}
ok(FORGE_LLM_FRONTIER.length === 2 && !FORGE_LLM_FRONTIER.includes(FORGE_LLM_DEFAULT),
  "the default (Haiku) is NOT a frontier model — it can never drive an agent");
ok(FORGE_LLM_MODELS.standard.length === 1, "Standard still offers exactly one Forge LLM model");

console.log(`\nforge-llm-policy: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
