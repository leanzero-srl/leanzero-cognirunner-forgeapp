/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// ONE home for the per-provider KVS slot NAMES and the provider id list.
//
// They used to live as private consts inside src/index.js, which made them
// unreachable from anything that cannot pull in the Forge runtime (the dev-gated
// test hook, the offline harness). The second copy that would have been typed out
// there is exactly the "N copies of one rule that disagree" defect this repo keeps
// paying for — so the names live here, dependency-free, and index.js imports them.
//
// PROVIDER_IDS must stay in lockstep with the keys of index.js's PROVIDERS map
// (which carries the per-provider CONFIG — labels, base URLs, default models — and
// is not duplicated here). An offline test asserts the two agree.
export const PROVIDER_IDS = ["openai", "azure", "openrouter", "anthropic", "lmstudio", "atlassian", "bedrock"];

export const providerKeySlot = (provider) => `COGNIRUNNER_KEY_${provider}`;
export const providerModelSlot = (provider) => `COGNIRUNNER_MODEL_${provider}`;
// The model an AGENT surface uses (Coder chat, PR review, the Virtual Administrator),
// kept apart from the rule/validator model.
export const providerAgentModelSlot = (provider) => `COGNIRUNNER_AGENT_MODEL_${provider}`;
// Per-provider base URL — so switching to a provider restores its saved URL
// instead of re-prompting (LM Studio / Azure carry a custom endpoint).
export const providerBaseUrlSlot = (provider) => `COGNIRUNNER_BASEURL_${provider}`;

// Every slot a harness may plant a fault in for one provider.
export const providerSlotsFor = (provider) => [
  providerKeySlot(provider), providerModelSlot(provider),
  providerAgentModelSlot(provider), providerBaseUrlSlot(provider),
];
