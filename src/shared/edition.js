/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * Edition + capability — ONE home for "which edition is this tenant on".
 *
 * Dependency-free on purpose: this module bundles into the Forge backend AND into all
 * four Custom UI apps (admin-panel, config-ui, config-view, issue-glance), so it must
 * not import anything.
 *
 * NOTE (1.3 UI cut): this is the minimal surface the UI builds against. The backend
 * cut on main owns the authoritative version (it adds clampForgeLlmModel /
 * agentCapability); the merge keeps the backend's file. Keep the exports below
 * identical in name and shape.
 */

export const EDITIONS = {
  STANDARD: "standard",
  ADVANCED: "advanced",
};

const LABELS = {
  standard: "Standard",
  advanced: "Coder",
};

/** Marketplace capability set that means "CogniRunner Coder". Compared lower-cased. */
const ADVANCED_CAPABILITY = "capabilityadvanced";

/**
 * Features that only the Coder edition unlocks on Forge LLM. `id` is what a refusing
 * resolver returns as `featureId`; `label` is what the UI shows.
 */
export const ADVANCED_FEATURES = [
  { id: "frontierModels", label: "Claude Sonnet 5 and Opus 5 on Forge LLM" },
  { id: "agentModel", label: "Agent model selection" },
  { id: "coder", label: "Coder (in-issue coding, Git, PR review)" },
  { id: "virtualAdmin", label: "Virtual Administrators" },
];

/** Forge LLM models selectable per edition. Haiku is the default on both. */
export const FORGE_LLM_MODELS = {
  standard: ["claude-haiku-4-5-20251001"],
  advanced: ["claude-haiku-4-5-20251001", "claude-sonnet-5", "claude-opus-5"],
};

/** The vendor-billed models the Coder edition buys. Agents require one of these. */
export const FORGE_LLM_FRONTIER = ["claude-sonnet-5", "claude-opus-5"];

export const FORGE_LLM_DEFAULT = "claude-haiku-4-5-20251001";

/**
 * Resolve the edition from a Forge license object (`context.license` in a Custom UI,
 * `getAppContext().license` in a backend runtime), or null when none is available.
 *
 * Shapes seen in the wild: { active, isActive, capabilitySet, state, ... }. An explicit
 * `isActive === false` / `active === false` means "not licensed" → Standard, active false.
 * A missing license is NOT "inactive" — it is simply unknown (active: null) so the UI can
 * hide the chip instead of claiming Standard.
 */
export function resolveEdition(license) {
  if (!license || typeof license !== "object") {
    return {
      active: null,
      edition: EDITIONS.STANDARD,
      label: LABELS.standard,
      capabilitySet: null,
      source: "none",
    };
  }

  let active = null;
  if (typeof license.isActive === "boolean") active = license.isActive;
  else if (typeof license.active === "boolean") active = license.active;

  const capabilitySet =
    typeof license.capabilitySet === "string" ? license.capabilitySet : null;
  const state = typeof license.state === "string" ? license.state : null;

  let edition = EDITIONS.STANDARD;
  if (active !== false) {
    const cap = (capabilitySet || "").toLowerCase();
    if (cap === ADVANCED_CAPABILITY) edition = EDITIONS.ADVANCED;
    else if (!capabilitySet && (state || "").toLowerCase() === EDITIONS.ADVANCED) {
      edition = EDITIONS.ADVANCED;
    }
  }

  return {
    active,
    edition,
    label: LABELS[edition],
    capabilitySet,
    source: "license",
  };
}

/** Is an advanced feature allowed on this edition? Unknown ids are treated as allowed. */
export function isFeatureAllowed(edition, id) {
  if (!ADVANCED_FEATURES.some((f) => f.id === id)) return true;
  return edition === EDITIONS.ADVANCED;
}

/** Label for an edition id (defensive against unknown values). */
export function editionLabel(edition) {
  return LABELS[edition] || LABELS.standard;
}
