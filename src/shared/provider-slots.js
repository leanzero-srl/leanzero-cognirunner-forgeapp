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
// "managed" is CogniRunner Cloud AI - the LeanZero-managed OpenRouter engine. It is
// listed here because it IS a provider id (PROVIDERS, the active-provider slot, the
// model/agent-model slots all carry it), but it has NO key slot in use: its credential
// is an encrypted Forge env var read in one place (readManagedKey, src/index.js), never
// KVS. `providerKeySlot("managed")` therefore only ever reads an empty slot - harmless,
// and deliberately not special-cased, so a stray write can never become a live key.
//
// F-555 - "can never become a live key" is a claim about the READ, not about the door, and
// it is worth being exact about which is which. The DOOR is open: `saveOpenAIKey`
// (src/index.js) rejects "atlassian" by name but has no such arm for "managed", so an admin
// can write a string into COGNIRUNNER_KEY_managed. What makes that inert is the read side -
// key resolution short-circuits on `provider === MANAGED_PROVIDER_ID` and returns
// `readManagedKey()` (the env var) BEFORE any slot lookup, so the slot has no reader on the
// inference path. `getOpenAIKey`'s managed arm likewise reports `hasKey: false, isByok: false,
// managed: true, noKeyNeeded: true` from the provider id rather than from the slot, so a
// planted value cannot even make the panel CLAIM the engine is BYOK-configured. If either of
// those two short-circuits is ever removed, the missing door in `saveOpenAIKey` becomes the
// bug this paragraph exists to point at.
export const PROVIDER_IDS = ["openai", "azure", "openrouter", "anthropic", "lmstudio", "atlassian", "bedrock", "managed"];

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
