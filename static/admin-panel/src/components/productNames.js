/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * PRODUCT NAMES - the ONE map from an internal id to the name a human bought (F-914).
 *
 * The status cards printed the ids: "EDITION advanced", "PROVIDER atlassian", and usage
 * rows that read "Openai" because the raw id met a CSS `text-transform: capitalize`.
 * "advanced" is a Marketplace edition TYPE, not a product; the product is called Coder,
 * and src/shared/edition.js has said so all along in EDITIONS[id].label. A screen that
 * prints the id teaches the reader a vocabulary that appears nowhere in the Marketplace
 * listing, the invoice or the support conversation.
 *
 * WHY THE LABELS LIVE HERE AND NOT IN OpenAIConfig.jsx: the Code tab needs the same two
 * answers, and the provider labels were embedded in that file's PROVIDER_OPTIONS table
 * alongside its icons. Two screens, one rule, so the rule moved out and PROVIDER_OPTIONS
 * now reads its labels from here. The EDITION labels are NOT re-typed at all - they are
 * read from src/shared/edition.js, which owns them for the backend too.
 *
 * MODEL IDS ARE LEFT ALONE, on purpose. There is no map of friendly model names anywhere
 * in this repo, and inventing one here would be a second home for a vendor's naming that
 * changes without us: `claude-sonnet-5` is what the admin picked, what the backend clamps
 * against and what a support answer will quote. An id the reader chose is not jargon; an
 * id they never saw ("advanced") is.
 */

import {
  EDITIONS, MANAGED_PROVIDER_ID, MANAGED_PROVIDER_LABEL,
  HAIKU_AGENT_LIMIT_SENTENCE,
} from "../../../../src/shared/edition.js";

/**
 * Provider id -> the name on the vendor's own product. Keyed by the id the backend
 * stores, so a row that arrives from getAiUsage, getAgentCapability or the provider
 * picker all resolve through the same table.
 */
export const PROVIDER_LABELS = {
  openai: "OpenAI",
  azure: "Azure OpenAI",
  openrouter: "OpenRouter",
  anthropic: "Anthropic",
  lmstudio: "LM Studio",
  atlassian: "Atlassian (Forge LLM)",
  bedrock: "AWS Bedrock",
  [MANAGED_PROVIDER_ID]: MANAGED_PROVIDER_LABEL,
};

/**
 * The product name for a provider id. An UNKNOWN id is returned unchanged rather than
 * hidden or renamed: a new engine that has not reached this table must still be
 * identifiable on a usage row, and a wrong name is worse than a raw one.
 */
export const providerLabel = (id) => PROVIDER_LABELS[String(id || "")] || String(id || "");

/**
 * The product name for an edition id ("advanced" -> "Coder"), from edition.js's own
 * table. An unknown id falls back to itself for the same reason as above.
 */
export const editionLabel = (id) => {
  const row = EDITIONS[String(id || "")];
  return row ? row.label : String(id || "");
};

/**
 * THE HAIKU-ON-BYOK SENTENCE, verified against agentCapability() in src/shared/edition.js
 * before it was written: `if (provider !== "atlassian") return { enabled: true, ... }` -
 * the model is NOT judged on a BYOK provider, so Haiku really does drive an agent there.
 * The refusal is Forge LLM's alone, and saying otherwise would send an admin chasing a
 * model change that changes nothing.
 *
 * F-971 - THE SCOPE CLAUSE IS NOW IMPORTED, NOT RE-TYPED. This sentence used to state
 * the Forge-LLM-only limit in its own words while AGENT_CAPABILITY_REASONS in edition.js
 * stated the opposite ("Haiku never drives an agent", unqualified). Two homes, one
 * claim, and they had already drifted into contradicting each other on two screens of
 * the same app. edition.js owns the claim because it owns the predicate that enforces
 * it; this sentence composes it and adds only the BYOK half, which is this file's own
 * product-facing framing.
 */
export const HAIKU_ON_BYOK_SENTENCE =
  `${HAIKU_AGENT_LIMIT_SENTENCE} On your own provider key, Coder and Virtual Administrators run on the agent model you choose, Haiku included.`;

/** Does this id name a Haiku-class model? Display only, never access control. */
export const looksLikeHaiku = (id) => /haiku/i.test(String(id || ""));
