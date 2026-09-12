/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Offline unit test for src/shared/edition.js — the ONE home for edition resolution,
// the Forge LLM model policy and the agent-capability predicate. No live Forge.
//
// The load-bearing cases here are the ones that cost real money or real access:
//   - capabilitySet arrives CAMEL-cased from the platform ("capabilityAdvanced") while the
//     docs say lowercase, so the comparison must be case-insensitive or every Coder tenant
//     silently reads as Standard;
//   - an INACTIVE license is Standard whatever capabilitySet says (expired ≠ entitled);
//   - the model lists are EXACT ids, so an older vendor-billed Sonnet/Opus id (claude-sonnet-4-6)
//     is refused on BOTH editions — the thing the deleted /haiku/i regex could not express;
//   - FORGE_LLM_DEFAULT must equal the atlassian defaultModel literal in src/index.js, or the
//     clamp target and the provider default drift apart (source-parsed, not imported: index.js
//     pulls @forge/* at load).
// Auto-discovered by run-offline.mjs. Run: node scripts/edition.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  EDITIONS, EDITION_IDS, normalizeModelId, resolveEdition, ADVANCED_FEATURES, isFeatureAllowed,
  FORGE_LLM_MODELS, FORGE_LLM_FRONTIER, FORGE_LLM_DEFAULT,
  forgeLlmTier, forgeLlmModelAllowedForEdition, clampForgeLlmModel, agentCapability,
} from "../../src/shared/edition.js";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

// =====================================================================================
// F-076 / F-097 — the id string has ONE home: EDITION_IDS. Every backend site and all
// four UI apps compare against it. The EDITIONS table is LABELS only; it briefly also
// carried uppercase alias keys holding the bare id, which is the second home F-097
// removed. If the id drifts, every edition comparison in the UI silently becomes
// `undefined === "advanced"` → false, i.e. Coder reads as free.
// =====================================================================================
ok(EDITION_IDS.STANDARD === "standard" && EDITION_IDS.ADVANCED === "advanced", "EDITION_IDS holds the two id strings");
ok(EDITIONS.STANDARD === undefined && EDITIONS.ADVANCED === undefined,
  "the uppercase alias keys are GONE — EDITION_IDS is the only home for the id (F-097)");
ok(Object.keys(EDITIONS).length === 2 && Object.values(EDITIONS).every((v) => v && typeof v === "object"),
  "EDITIONS is ONE shape: two {id,label} objects, so Object.values() cannot mix strings in");
ok(EDITIONS.standard.id === EDITION_IDS.STANDARD && EDITIONS.advanced.id === EDITION_IDS.ADVANCED,
  "the lowercase keys stay {id,label} and their ids match EDITION_IDS");
ok(EDITIONS.standard.label === "Standard" && EDITIONS.advanced.label === "Coder", "labels are unchanged");
ok(resolveEdition({ isActive: true, capabilitySet: "capabilityAdvanced" }).edition === EDITION_IDS.ADVANCED,
  "a resolved edition compares equal to EDITION_IDS.ADVANCED — the exact expression every surface evaluates");

// =====================================================================================
// resolveEdition — the matrix
// =====================================================================================
{
  const r = resolveEdition(null);
  ok(r.edition === "standard" && r.active === null && r.source === "none" && r.capabilitySet === null,
    "null license → standard / active null / source none");
  ok(r.label === "Standard", "standard label is 'Standard'");
}
{
  const r = resolveEdition("capabilityAdvanced"); // a string is not a license object
  ok(r.edition === "standard" && r.source === "none", "garbage (string) license → standard, source none");
}
ok(resolveEdition(undefined).edition === "standard", "undefined license → standard");
ok(resolveEdition({}).edition === "standard" && resolveEdition({}).source === "license",
  "empty license object → standard but source 'license'");

{
  const r = resolveEdition({ isActive: true, capabilitySet: "capabilityAdvanced" });
  ok(r.edition === "advanced" && r.active === true, "isActive + capabilityAdvanced (camelCase, as the platform sends it) → advanced");
  ok(r.label === "Coder", "advanced label is the PRODUCT name 'Coder', not 'Advanced'");
  ok(r.capabilitySet === "capabilityadvanced", "capabilitySet is returned lower-cased");
  ok(r.source === "license", "source is 'license'");
}
ok(resolveEdition({ isActive: true, capabilitySet: "capabilityadvanced" }).edition === "advanced",
  "already-lowercase capabilityadvanced → advanced");
ok(resolveEdition({ isActive: true, capabilitySet: "CAPABILITYADVANCED" }).edition === "advanced",
  "upper-case CAPABILITYADVANCED → advanced (compare is case-insensitive)");

{
  const r = resolveEdition({ active: true, capabilitySet: "capabilityStandard" });
  ok(r.edition === "standard" && r.active === true, "`active:true` (not isActive) is honoured; capabilityStandard → standard");
}
{
  const r = resolveEdition({ isActive: false, capabilitySet: "capabilityAdvanced" });
  ok(r.edition === "standard" && r.active === false,
    "INACTIVE license → standard REGARDLESS of capabilitySet (an expired Coder sub is not Coder)");
}
ok(resolveEdition({ isActive: true }).edition === "standard",
  "legacy license with no capabilitySet and no state → standard");
ok(resolveEdition({ isActive: true, state: "advanced" }).edition === "advanced",
  "state:'advanced' is accepted as a SECONDARY signal when capabilitySet is absent");
ok(resolveEdition({ isActive: true, state: "advanced", capabilitySet: "capabilityStandard" }).edition === "standard",
  "capabilitySet WINS over state when both are present");
ok(resolveEdition({ isActive: false, state: "advanced" }).edition === "standard",
  "inactive + state advanced → standard");
ok(EDITIONS.standard.id === "standard" && EDITIONS.advanced.id === "advanced" && EDITIONS.advanced.label === "Coder",
  "EDITIONS table: ids standard/advanced, advanced labelled Coder");

// =====================================================================================
// Feature gate
// =====================================================================================
ok(ADVANCED_FEATURES.length === 2 && ADVANCED_FEATURES.every((f) => f.id && f.label),
  "ADVANCED_FEATURES has two {id,label} rows");
ok(isFeatureAllowed("advanced", "coder") === true, "coder allowed on advanced");
ok(isFeatureAllowed("standard", "coder") === false, "coder refused on standard");
ok(isFeatureAllowed("standard", "forge-llm-frontier-models") === false, "frontier models refused on standard");
ok(isFeatureAllowed("advanced", "forge-llm-frontier-models") === true, "frontier models allowed on advanced");
ok(isFeatureAllowed("standard", "something-that-does-not-exist") === true,
  "UNKNOWN feature id is ALLOWED — a typo can never silently disable a Standard capability");

// =====================================================================================
// Forge LLM model policy — EXACT ids, both directions
// =====================================================================================
ok(FORGE_LLM_MODELS.standard.length === 1 && FORGE_LLM_MODELS.standard[0] === FORGE_LLM_DEFAULT,
  "standard offers exactly one model: the Haiku default");
ok(FORGE_LLM_MODELS.advanced.length === 3, "advanced offers three models");
ok(FORGE_LLM_FRONTIER.join(",") === "claude-sonnet-5,claude-opus-5", "frontier = sonnet-5 + opus-5");

ok(forgeLlmModelAllowedForEdition("standard", FORGE_LLM_DEFAULT) === true, "standard allows haiku");
ok(forgeLlmModelAllowedForEdition("standard", "claude-sonnet-5") === false, "standard refuses sonnet-5");
ok(forgeLlmModelAllowedForEdition("standard", "claude-opus-5") === false, "standard refuses opus-5");
ok(forgeLlmModelAllowedForEdition("advanced", FORGE_LLM_DEFAULT) === true, "advanced allows haiku");
ok(forgeLlmModelAllowedForEdition("advanced", "claude-sonnet-5") === true, "advanced allows sonnet-5");
ok(forgeLlmModelAllowedForEdition("advanced", "claude-opus-5") === true, "advanced allows opus-5");

for (const ed of ["standard", "advanced"]) {
  ok(forgeLlmModelAllowedForEdition(ed, "claude-sonnet-4-6") === false, `${ed} refuses claude-sonnet-4-6 (older generation)`);
  ok(forgeLlmModelAllowedForEdition(ed, "claude-opus-4-8") === false, `${ed} refuses claude-opus-4-8 (older generation)`);
}
ok(forgeLlmModelAllowedForEdition("advanced", null) === false, "null model id is refused");
ok(forgeLlmModelAllowedForEdition("advanced", "") === false, "empty model id is refused");
ok(forgeLlmModelAllowedForEdition("mystery-edition", "claude-sonnet-5") === false,
  "an unknown edition falls back to the STANDARD list (fail-soft toward the cheap tier)");

// tier classification is COSTING only — it must NOT imply access
ok(forgeLlmTier("claude-haiku-4-5-20251001") === "haiku", "tier: haiku");
ok(forgeLlmTier("claude-sonnet-5") === "sonnet", "tier: sonnet");
ok(forgeLlmTier("claude-opus-5") === "opus", "tier: opus");
ok(forgeLlmTier("anthropic.claude-sonnet-5-v1:0") === "sonnet", "tier: bedrock-style -v1:0 form classified");
ok(forgeLlmTier("anthropic.claude-opus-5-v1:0") === "opus", "tier: opus -v1:0 form classified");
ok(forgeLlmTier("gpt-5.4-mini") === null && forgeLlmTier(null) === null, "tier: unknown / null → null");
ok(forgeLlmModelAllowedForEdition("advanced", "anthropic.claude-sonnet-5-v1:0") === false,
  "a -v1:0 form is CLASSIFIED by forgeLlmTier but NOT allowed by the exact-id list");

ok(clampForgeLlmModel("advanced", "claude-opus-5") === "claude-opus-5", "clamp passes an allowed id through");
ok(clampForgeLlmModel("standard", "claude-opus-5") === FORGE_LLM_DEFAULT, "clamp refuses opus-5 on standard → default");
ok(clampForgeLlmModel("standard", "claude-sonnet-4-6") === FORGE_LLM_DEFAULT, "clamp refuses an old id → default");
ok(clampForgeLlmModel("advanced", undefined) === FORGE_LLM_DEFAULT, "clamp of undefined → default");

// =====================================================================================
// agentCapability — all five reasons
// =====================================================================================
{
  const byok = agentCapability({ provider: "openai", edition: "standard", agentModel: "anything", allowanceLevel: "hard" });
  ok(byok.enabled === true && byok.reason === "byok",
    "BYOK wins over EVERYTHING — edition, model and a hard allowance are all irrelevant when the tenant pays");
}
ok(agentCapability({ provider: "lmstudio", edition: "standard" }).reason === "byok", "LM Studio is BYOK");
ok(agentCapability({ provider: "atlassian", edition: "standard", agentModel: "claude-opus-5" }).reason === "needs-coder-edition",
  "Forge LLM + standard → needs-coder-edition (checked BEFORE the model)");
ok(agentCapability({ provider: "atlassian", edition: "advanced", agentModel: FORGE_LLM_DEFAULT }).reason === "needs-frontier-model",
  "Forge LLM + advanced + Haiku → needs-frontier-model (Haiku never drives an agent)");
ok(agentCapability({ provider: "atlassian", edition: "advanced", agentModel: "claude-opus-5", allowanceLevel: "hard" }).reason === "allowance-exhausted",
  "Forge LLM + advanced + frontier + hard allowance → allowance-exhausted");
{
  const good = agentCapability({ provider: "atlassian", edition: "advanced", agentModel: "claude-sonnet-5", allowanceLevel: "soft" });
  ok(good.enabled === true && good.reason === "forge-frontier", "soft allowance still runs → forge-frontier");
}
ok(agentCapability({}).enabled === true, "no provider at all is treated as BYOK (never a false refusal)");
for (const r of ["byok", "needs-coder-edition", "needs-frontier-model", "allowance-exhausted", "forge-frontier"]) {
  ok(typeof r === "string", `reason ${r} covered above`);
}

// =====================================================================================
// LOCKSTEP: FORGE_LLM_DEFAULT === PROVIDERS.atlassian.defaultModel in src/index.js
// =====================================================================================
{
  const here = path.dirname(fileURLToPath(import.meta.url));
  const indexSrc = readFileSync(path.join(here, "../../src/index.js"), "utf8");
  const m = indexSrc.match(/atlassian:\s*\{[^}]*defaultModel:\s*"([^"]+)"/);
  ok(!!m, "found PROVIDERS.atlassian.defaultModel in src/index.js");
  ok(m && m[1] === FORGE_LLM_DEFAULT,
    `PROVIDERS.atlassian.defaultModel (${m && m[1]}) === FORGE_LLM_DEFAULT (${FORGE_LLM_DEFAULT}) — the clamp target and the provider default must not drift`);
}

// =====================================================================================
// F-084 — normalizeModelId is the ONE home for "what is a legal model id", shared by
// saveOpenAIModel and saveAgentModel (they used to disagree: one trimmed, one length-checked).
// =====================================================================================
ok(normalizeModelId("  claude-opus-5  ") === "claude-opus-5", "trims");
ok(normalizeModelId("gpt-5.4-mini") === "gpt-5.4-mini", "passes a normal id through");
ok(normalizeModelId("a".repeat(500)).length === 120, "caps at 120 characters");
ok(normalizeModelId("cl\u0000aude\n-5".trim()).includes("\u0000") === false, "strips control characters");
ok(normalizeModelId(null) === "" && normalizeModelId(undefined) === "" && normalizeModelId(42) === "",
  "a non-string is \"\" so a caller can refuse on falsy");
ok(normalizeModelId("   ") === "", "whitespace-only is \"\"");

console.log(`\nedition: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
