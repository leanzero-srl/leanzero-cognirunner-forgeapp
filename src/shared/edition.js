/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * EDITION AND CAPABILITY — the ONE home for "which CogniRunner is this tenant on".
 *
 * CogniRunner ships two Marketplace editions: Standard (id "standard") and
 * Advanced, whose product name is "Coder" (id "advanced"). The platform tells us
 * which one is installed through the license object; the LABEL the user sees is
 * "Coder", the Marketplace edition TYPE is Advanced, and the internal id stays
 * "advanced" so it matches the platform vocabulary. Do not collapse the three.
 *
 * Where the license comes from differs per runtime and NOWHERE else:
 *   - workflow validate() / executePostFunction(): args.context.license
 *   - resolvers:                                   context.license
 *   - webtriggers / the async consumer:            getAppContext().license
 * Everything downstream of that read goes through resolveEdition() here.
 *
 * VERIFIED 2026-09-12 on a live install: `capabilitySet` arrives CAMEL-CASED as
 * "capabilityAdvanced" (the Forge docs say lowercase "capability_advanced"-style
 * ids), alongside `state:"advanced"`, `active`, `isActive`, `type` and
 * `billingPeriod`. So the comparison here is case-insensitive, and `state` is
 * accepted only as a SECONDARY signal when capabilitySet is absent — a tenant
 * that sends both must be judged on capabilitySet. An install with no license
 * flag at all carries `license: null`.
 *
 * FAIL-OPEN / FAIL-SOFT, on purpose: anything unrecognised resolves to STANDARD
 * with `active: null` (unknown), never to advanced and never to an exception.
 * The product decision is that a broken license read degrades the tenant to the
 * free capability set; it must never block a workflow transition. If you change
 * that, change this comment too.
 *
 * Dependency-free — this module bundles into the Forge backend AND the admin panel.
 */

/**
 * The two edition IDS — the ONE home for the string every comparison uses.
 * Import these, never retype "advanced" at a call site.
 */
export const EDITION_IDS = { STANDARD: "standard", ADVANCED: "advanced" };

/**
 * The two editions, keyed BY ID. `label` is what a human sees; `id` is what code
 * compares — and comparisons use EDITION_IDS above, never a key of this table.
 *
 * ONE shape, on purpose (F-097). The uppercase `EDITIONS.STANDARD`/`EDITIONS.ADVANCED`
 * aliases that briefly lived here held the bare id STRING alongside these OBJECTS, so
 * `Object.values(EDITIONS)` yielded two objects and two strings, and the id had two
 * homes. Every app surface reads EDITION_IDS; this table is only for LABELS
 * (EDITIONS[ed].label is how the UI and checkLicense render the name). Do not add a
 * second key shape back.
 */
export const EDITIONS = {
  standard: { id: EDITION_IDS.STANDARD, label: "Standard" },
  advanced: { id: EDITION_IDS.ADVANCED, label: "Coder" },
};

/**
 * The ONE normaliser for a model id that arrives from a client (saveOpenAIModel,
 * saveAgentModel). A model id is a short printable token: trim it, drop control
 * characters, cap at 120 chars. Returns "" for anything that is not a usable string,
 * so a caller can simply refuse a falsy result.
 *
 * Clamped SERVER-SIDE after reading, like every other string this app stores — and in
 * one place, because the two save resolvers had two different ideas of what a legal
 * model id was (one trimmed, the other length-checked).
 */
export const normalizeModelId = (s) => {
  if (typeof s !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, 120);
};

const ADVANCED_CAPABILITY_SET = "capabilityadvanced";

const lower = (v) => (typeof v === "string" && v ? v.toLowerCase() : null);

/**
 * Resolve a raw platform license object to an edition.
 *
 * @param {object|null} license - context.license / getAppContext().license
 * @returns {{ active: true|false|null, edition: "standard"|"advanced", label: string,
 *             capabilitySet: string|null, source: "license"|"none" }}
 *   active null  = no license object at all (development / unlisted install)
 *   active false = a license exists and is explicitly inactive → STANDARD, whatever
 *                  capabilitySet says (an expired Coder subscription is not Coder)
 */
export const resolveEdition = (license) => {
  if (!license || typeof license !== "object") {
    return { active: null, edition: EDITION_IDS.STANDARD, label: EDITIONS.standard.label, capabilitySet: null, source: "none" };
  }
  const capabilitySet = lower(license.capabilitySet);
  const active = license.isActive === true || license.active === true
    ? true
    : (license.isActive === false || license.active === false ? false : null);

  let edition = EDITION_IDS.STANDARD;
  if (active === true) {
    if (capabilitySet) {
      // capabilitySet is authoritative when present — "capabilityStandard" means
      // standard even if some other field looks advanced.
      if (capabilitySet === ADVANCED_CAPABILITY_SET) edition = EDITION_IDS.ADVANCED;
    } else if (lower(license.state) === EDITION_IDS.ADVANCED) {
      // Secondary signal ONLY. Legacy installs send no capabilitySet at all.
      edition = EDITION_IDS.ADVANCED;
    }
  }
  return { active, edition, label: EDITIONS[edition].label, capabilitySet, source: "license" };
};

/**
 * What the Coder edition buys. Rendered in the admin panel's edition card and
 * echoed by checkLicense so the UI never hardcodes a second copy of this list.
 */
export const ADVANCED_FEATURES = [
  { id: "forge-llm-frontier-models", label: "Claude Sonnet 5 & Opus 5 on Atlassian Forge LLM" },
  { id: "coder", label: "Coder: in-issue coding chat, GitHub & Bitbucket, pipelines, Git-aware rules" },
];

const ADVANCED_FEATURE_IDS = ADVANCED_FEATURES.map((f) => f.id);

/**
 * Is `featureId` available on `edition`? An UNKNOWN feature id is ALLOWED — this
 * predicate only ever restricts the features it knows about, so a typo at a call
 * site can never silently disable a Standard capability.
 */
export const isFeatureAllowed = (edition, featureId) => {
  if (!ADVANCED_FEATURE_IDS.includes(featureId)) return true;
  return edition === EDITION_IDS.ADVANCED;
};

/*
 * FORGE LLM MODEL POLICY.
 *
 * Forge LLM tokens are billed to the VENDOR (LeanZero), not the tenant, so the
 * frontier models are what the Coder edition pays for. The lists below are
 * EXACT ids on purpose: an older Sonnet/Opus id (e.g. claude-sonnet-4-6) is
 * refused on EVERY edition, because "it has 'sonnet' in the name" was the old
 * regex policy and it could not tell a vendor-billed model generation apart.
 * Widening these lists is a pricing decision, not a bug fix.
 */
export const FORGE_LLM_DEFAULT = "claude-haiku-4-5-20251001";
export const FORGE_LLM_FRONTIER = ["claude-sonnet-5", "claude-opus-5"];
export const FORGE_LLM_MODELS = {
  standard: [FORGE_LLM_DEFAULT],
  advanced: [FORGE_LLM_DEFAULT, "claude-sonnet-5", "claude-opus-5"],
};

/**
 * Coarse family of a Forge LLM model id, for COSTING ONLY — never for access
 * control (that is forgeLlmModelAllowedForEdition, which is exact-id). Matches
 * both plain ids and the Bedrock-style `anthropic.claude-…-v1:0` forms that
 * list() has been seen to return.
 * @returns {"haiku"|"sonnet"|"opus"|null}
 */
export const forgeLlmTier = (id) => {
  const s = lower(id);
  if (!s) return null;
  if (s.includes("haiku")) return "haiku";
  if (s.includes("sonnet")) return "sonnet";
  if (s.includes("opus")) return "opus";
  return null;
};

/**
 * May this exact model id run on this edition?
 * NOTE the name: src/index.js already owned an arity-1 `isForgeLlmModelAllowed`
 * (the deleted /haiku/i regex). This one takes the edition and is the only
 * policy left — do not reintroduce the old name anywhere.
 */
export const forgeLlmModelAllowedForEdition = (edition, id) => {
  const list = FORGE_LLM_MODELS[edition] || FORGE_LLM_MODELS.standard;
  return list.includes(String(id || ""));
};

/** Billing backstop: a refused id becomes the default (Haiku), never an error. */
export const clampForgeLlmModel = (edition, id) =>
  (forgeLlmModelAllowedForEdition(edition, id) ? String(id) : FORGE_LLM_DEFAULT);

/**
 * The ONE predicate that gates every agent surface (Coder chat, PR review, the
 * Virtual Administrator). Order matters and is the owner's decision:
 *
 *   BYOK provider           → enabled. The tenant pays their own tokens and we do
 *                             not judge their model or their edition.
 *   Forge LLM + Standard    → refused: needs-coder-edition.
 *   Forge LLM + Haiku       → refused: needs-frontier-model. Haiku never drives an agent.
 *   Forge LLM + allowance   → refused: allowance-exhausted (hard cap reached this month).
 *   otherwise               → enabled: forge-frontier.
 *
 * Pure — the caller supplies the already-resolved edition, agent model and
 * allowance level, so this stays testable and free of I/O.
 */
export const agentCapability = ({ provider, edition, agentModel, allowanceLevel } = {}) => {
  if (provider !== "atlassian") return { enabled: true, reason: "byok" };
  if (edition !== EDITION_IDS.ADVANCED) return { enabled: false, reason: "needs-coder-edition" };
  if (!FORGE_LLM_FRONTIER.includes(String(agentModel || ""))) return { enabled: false, reason: "needs-frontier-model" };
  if (allowanceLevel === "hard") return { enabled: false, reason: "allowance-exhausted" };
  return { enabled: true, reason: "forge-frontier" };
};
