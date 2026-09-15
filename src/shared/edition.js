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
  { id: "managed-cloud-ai", label: "CogniRunner Cloud AI - a LeanZero-managed engine, no key to paste" },
  { id: "coder", label: "the Coder toolset (in-issue coding chat, GitHub & Bitbucket, pipelines, Git-aware rules)" },
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
 * COGNIRUNNER CLOUD AI - the LeanZero-MANAGED engine (provider id "managed").
 *
 * ONE TABLE, here, because four surfaces ask the same question and none of them may
 * answer it themselves: the provider picker (which ids may be selected), the save
 * doors (saveOpenAIModel / saveAgentModel), the chat adapter's server-side clamp, and
 * the usage meter's tier costing.
 *
 * WHAT IT IS: a LeanZero-owned OPENROUTER key (owner's decision, 2026-09-14 - the
 * plan's 3.17 said Anthropic first-party; it is OpenRouter), riding the existing
 * OpenRouter adapter and the already-allowed `openrouter.ai` egress. The KEY itself
 * lives in an encrypted Forge environment variable and is read in exactly ONE place
 * (`readManagedKey` in src/index.js) - never in KVS, never in a resolver's answer,
 * never in a log line.
 *
 * WHOSE MONEY: LeanZero's, exactly like Forge LLM. So the same two gates apply and
 * they are the SAME gates, not twins - the edition must be Coder, and the month's
 * vendor allowance must not be exhausted (src/shared/usage-meter.js
 * vendorAllowanceStatus). Widening MANAGED_MODELS is a pricing decision.
 *
 * The ids are EXACT and namespaced the way OpenRouter names them ("anthropic/..."),
 * for the same reason FORGE_LLM_MODELS is exact-id: a substring policy cannot tell an
 * entitled generation from an unentitled one.
 */
export const MANAGED_PROVIDER_ID = "managed";
export const MANAGED_PROVIDER_LABEL = "CogniRunner Cloud AI";
export const MANAGED_DEFAULT_MODEL = "anthropic/claude-sonnet-5";
export const MANAGED_MODELS = [MANAGED_DEFAULT_MODEL, "anthropic/claude-opus-5"];

/** May this exact model id run on the managed engine? Exact-id, like Forge LLM. */
export const managedModelAllowed = (id) => MANAGED_MODELS.includes(String(id || ""));

/** Billing backstop: a refused id becomes Sonnet 5, never an error. */
export const clampManagedModel = (id) => (managedModelAllowed(id) ? String(id) : MANAGED_DEFAULT_MODEL);

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
/**
 * THE ONE SENTENCE per capability reason (1.4 commit 6).
 *
 * `agentCapability()` answers with a machine-readable `reason`; four surfaces then have
 * to say what that MEANS and what to do about it - the admin panel's Code tab status
 * card, the agent action checklist, the coder panel and the backend's own refusal.
 * Four renderers inventing four wordings is the defect this repo is named for, so the
 * words live here, next to the predicate that produces the code.
 *
 * Each row is { title, remedy, link }. `link` is a TAB KEY the app already has
 * ("settings"), or null when there is nowhere to send the reader - never a URL, because
 * the admin panel's tabs are not addressable and a fabricated link is worse than none.
 *
 * `agentActionRefusalText` in src/shared/agent-actions.js is the sibling for the
 * gate's per-ACTION codes (it also handles "missing-product:*", "external-trigger",
 * "needs-admin", which are not capability reasons at all). Keep the claims aligned;
 * do not merge the tables - one answers "why is Coder off", the other "why was THIS
 * action refused on THIS rule".
 */
export const AGENT_CAPABILITY_REASONS = {
  "needs-coder-edition": {
    title: "Coder is off - this site is on CogniRunner Standard",
    remedy: "The Coder toolset runs on CogniRunner Cloud AI and on Atlassian Forge LLM only for Coder sites. Upgrade the app's edition, or switch to any BYOK provider (OpenAI, Anthropic, Azure, OpenRouter, LM Studio) and it turns on immediately.",
    link: "settings",
  },
  "needs-frontier-model": {
    title: "Coder is off - the agent model is not a frontier model",
    remedy: "Haiku never drives an agent. Pick Claude Sonnet 5 or Opus 5 as the agent model in Settings, or switch to a BYOK provider.",
    link: "settings",
  },
  "allowance-exhausted": {
    title: "Coder is paused - this month's Forge LLM allowance is used up",
    remedy: "Switch to a BYOK provider to keep going, or wait for the allowance to reset. Nothing is lost; queued work resumes.",
    link: "settings",
  },
  byok: {
    title: "Coder is on",
    remedy: "This site pays for its own tokens, so the edition and the model are yours to choose.",
    link: null,
  },
  "forge-frontier": {
    title: "Coder is on",
    remedy: "Running on Atlassian Forge LLM with a frontier agent model.",
    link: null,
  },
  managed: {
    title: "Coder is on",
    remedy: "Running on CogniRunner Cloud AI - LeanZero manages the engine, so there is no key to paste and no provider bill of your own.",
    link: null,
  },
  /**
   * A VENDOR outage, not a tenant misconfiguration: the managed key is absent from this
   * deployment's environment. Nothing the admin can change will fix it, so the remedy
   * names the one thing they CAN do and does not pretend an upgrade or a setting helps.
   */
  /**
   * The KILL SWITCH (COGNIRUNNER_MANAGED_DISABLED=1). Distinct from key-missing on
   * purpose: this one is a DECISION LeanZero took, not a broken deployment, so the
   * wording does not imply something is faulty.
   */
  "managed-disabled": {
    title: "CogniRunner Cloud AI is turned off",
    remedy: "LeanZero has paused the managed engine for this deployment. Switch to Atlassian Forge LLM or any BYOK provider; nothing else about the app changes.",
    link: "settings",
  },
  "managed-key-missing": {
    title: "CogniRunner Cloud AI is unavailable",
    remedy: "The managed engine is not configured on this deployment. That is on LeanZero's side - switch to Atlassian Forge LLM or any BYOK provider to keep going.",
    link: "settings",
  },
  /**
   * NOT a reason agentCapability() can return. It is what a SURFACE uses when the
   * capability read itself failed - the UI fails to the restrictive side and must
   * still say something true, so "could not check" gets its own row rather than
   * borrowing a reason the backend never gave.
   */
  unknown: {
    title: "Coder status could not be checked",
    /* F-962 - ROLE-AWARE, because this row is read on the ISSUE PANEL as often as in the
       admin panel, and "check the app's provider settings" is an instruction most of that
       audience cannot carry out. A remedy addressed to the wrong reader is a dead end with
       a confident voice. The sentence now names both readers and what each of them can
       actually do next. */
    remedy: "The capability check did not answer. Controls stay disabled until it does - reload the page first. If it persists, a Jira admin can check the provider settings under Apps, CogniRunner; if you are not one, ask them to.",
    link: "settings",
  },
};

/** The row for a reason, degrading to `unknown` rather than guessing. */
export const agentCapabilityCopy = (reason) =>
  AGENT_CAPABILITY_REASONS[String(reason || "")] || AGENT_CAPABILITY_REASONS.unknown;

/*
 * F-556 - WHAT AN EXHAUSTED ALLOWANCE ACTUALLY DOES, PER ENGINE.
 *
 * One ceiling covers both vendor-billed engines (vendorAllowanceStatus sums them), but
 * hitting it does NOT mean the same thing on each side, and the admin panel used to
 * state only the Forge LLM outcome whichever engine was active:
 *
 *   atlassian -> forgeLlmBillingClamp DOWNGRADES. The frontier models pause and every
 *                rule keeps running on FORGE_LLM_DEFAULT (Haiku). Degraded, not stopped.
 *   managed   -> the adapter REFUSES before a model is even chosen, because every id in
 *                MANAGED_MODELS is frontier and there is no cheap tier to fall to. Every
 *                managed call returns `allowance-exhausted`: validators fail OPEN (so
 *                transitions pass unchecked), semantic post-functions and queued
 *                jobs/listeners/agent tasks refuse, and the Coder answers nothing.
 *
 * Telling a managed tenant "rules fall back to Claude Haiku" is the dangerous version of
 * this: it reads as "degraded", so the admin waits for the month to roll while the app
 * has silently stopped validating anything. The two sentences live HERE, with
 * AGENT_CAPABILITY_REASONS, because copy about what an engine does is one rule.
 *
 * Keyed on the ACTIVE engine (what is saved), never on a picker selection.
 */
/*
 * F-955 - "until next month" NAMES NO DATE, and the meter beside it named none either,
 * so an admin at 80% could not tell whether to wait a day or pay their way out. Both
 * maps now take the reset day and splice it in; `resetsOn` defaults to the old wording
 * so a caller that cannot compute a date still gets a true sentence rather than a hole.
 * The DATE itself is not computed here - the month boundary belongs to the meter that
 * owns the rollover (allowanceResetLabel, src/shared/usage-meter.js) and this file only
 * says the words around it.
 */
const ALLOWANCE_CONSEQUENCE = {
  [MANAGED_PROVIDER_ID]: (when) => `Allowance spent. ${MANAGED_PROVIDER_LABEL} has stopped until ${when}: rules that use AI are not validated, and queued jobs and agent tasks refuse. Switch to Atlassian Forge LLM or a BYOK provider to keep going.`,
  atlassian: (when) => `Allowance spent. Sonnet 5 and Opus 5 are paused until ${when}; rules keep running on Claude Haiku.`,
};

/*
 * THE SAME TWO OUTCOMES, STATED BEFORE THEY HAPPEN (F-955). The 80% note said only
 * "Most of this month's vendor allowance is used" - a warning with no consequence and no
 * deadline, which is a warning an admin cannot act on. These are deliberately the SAME
 * facts as ALLOWANCE_CONSEQUENCE above, in the future tense, and they live beside it so
 * the pair can never tell two different stories about one engine: on Forge LLM the app
 * DEGRADES to Haiku, on the managed engine it STOPS. That distinction is the whole
 * reason this block exists (see the comment above it) and it must survive into the
 * earlier warning, which is the one an admin can still do something about.
 */
const ALLOWANCE_APPROACHING = {
  [MANAGED_PROVIDER_ID]: (when) => `At 100% ${MANAGED_PROVIDER_LABEL} stops until ${when}: rules that use AI are not validated, and queued jobs and agent tasks refuse.`,
  atlassian: (when) => `At 100% rules fall back to Claude Haiku and agents pause until ${when}.`,
};

/**
 * The sentence for "the vendor allowance is spent", for the engine that is ACTIVE.
 * `null` for any engine the allowance cannot mean anything for (a BYOK tenant pays its
 * own bill and is never shown the meter), so a surface renders nothing rather than a
 * sentence that is true of someone else.
 */
export const allowanceConsequenceCopy = (activeProvider, resetsOn) => {
  const fn = ALLOWANCE_CONSEQUENCE[String(activeProvider || "")];
  return fn ? fn(resetsOn ? String(resetsOn) : "next month") : null;
};

/**
 * The same, for a tenant that is NEARLY there. Same null rule, same engines.
 */
export const allowanceApproachingCopy = (activeProvider, resetsOn) => {
  const fn = ALLOWANCE_APPROACHING[String(activeProvider || "")];
  return fn ? fn(resetsOn ? String(resetsOn) : "next month") : null;
};

export const agentCapability = ({ provider, edition, agentModel, allowanceLevel, managedKeyPresent } = {}) => {
  /*
   * THE MANAGED ENGINE IS NOT BYOK - it spends LeanZero's money, so it is gated like
   * Forge LLM and not like a customer's own key. Order is deliberate:
   *
   *   key absent  -> "managed-key-missing" FIRST, and only when a caller actually READ
   *                  the env var and found nothing (=== false; `undefined` means "not
   *                  asked" and falls through, which is what the plain
   *                  agentCapability({provider,edition}) shape relies on). A missing key
   *                  is a VENDOR outage that affects every tenant, so telling a Standard
   *                  tenant to upgrade would be a lie - upgrading would not turn it on.
   *   Standard    -> "needs-coder-edition". The managed engine is a Coder entitlement.
   *   allowance   -> "allowance-exhausted", the SAME hard cap Forge LLM hits, out of the
   *                  same maths (vendorAllowanceStatus, src/shared/usage-meter.js).
   *   otherwise   -> "managed".
   *
   * The MODEL is not checked here: unlike Forge LLM (where Haiku is selectable and must
   * never drive an agent), every id in MANAGED_MODELS is a frontier model and the
   * adapter clamps anything else to Sonnet 5 before the call goes out.
   */
  if (provider === MANAGED_PROVIDER_ID) {
    if (managedKeyPresent === false) return { enabled: false, reason: "managed-key-missing" };
    if (edition !== EDITION_IDS.ADVANCED) return { enabled: false, reason: "needs-coder-edition" };
    if (allowanceLevel === "hard") return { enabled: false, reason: "allowance-exhausted" };
    return { enabled: true, reason: "managed" };
  }
  if (provider !== "atlassian") return { enabled: true, reason: "byok" };
  if (edition !== EDITION_IDS.ADVANCED) return { enabled: false, reason: "needs-coder-edition" };
  if (!FORGE_LLM_FRONTIER.includes(String(agentModel || ""))) return { enabled: false, reason: "needs-frontier-model" };
  if (allowanceLevel === "hard") return { enabled: false, reason: "allowance-exhausted" };
  return { enabled: true, reason: "forge-frontier" };
};
