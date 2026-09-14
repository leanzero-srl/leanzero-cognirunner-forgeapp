/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * F-826 — THE ONE HOME OF THE MODEL-RESOLUTION CHAIN, for every process.
 *
 * F-818 unified the chain's TWO readers inside `src/index.js`. It could not reach the
 * THIRD: `src/async-handler.js` runs in a different process and cannot import index.js,
 * so the consumer kept its own copy — with its own default-model table, no legacy-slot
 * migration, no Forge LLM resolution belt, and a different answer on a faulted read.
 * A queued codegen/fix/distill task therefore resolved a different model from the one
 * the sync resolver would have picked for the SAME instance.
 *
 * The chain is now a PURE function here. `src/shared/*` may not import `@forge/kvs`
 * (it bundles into three webpack frontends as well as the backend), so the storage
 * reader, the writer and the environment are PARAMETERS. Each process binds them:
 * index.js with its 30 s-memoised seam, async-handler.js with its deliberately
 * uncached fresh read. Nothing else may differ.
 */

import { providerKeySlot, providerModelSlot, providerAgentModelSlot } from "./provider-slots.js";
import { FORGE_LLM_DEFAULT, FORGE_LLM_MODELS, MANAGED_PROVIDER_ID, MANAGED_DEFAULT_MODEL, clampManagedModel } from "./edition.js";

/**
 * The last resort when a provider names no default at all (LM Studio, whose admins
 * always save a model). CLAUDE.md pins this literal: NEVER "gpt-4o-mini".
 */
export const FALLBACK_DEFAULT_MODEL = "gpt-5.4-mini";

/**
 * THE ONE DEFAULT-MODEL TABLE. `PROVIDERS` in src/index.js carries the label and the
 * base URL — which the frontends and the consumer have no business importing — but its
 * `defaultModel` values now come from HERE, and so do the consumer's. There is no
 * second table to drift.
 *
 * `atlassian` and `managed` are IMPORTED from src/shared/edition.js rather than
 * re-typed: edition.js owns what those two engines are allowed to run, and a literal
 * here could drift from the clamp target.
 */
export const PROVIDER_DEFAULT_MODELS = {
  openai: "gpt-5.4-mini",
  azure: "gpt-5.4-mini",
  openrouter: "openai/gpt-5.4-mini",
  anthropic: "claude-haiku-4-5-20251001",
  // LM Studio serves whatever the admin loaded; there is no meaningful default, so the
  // chain falls through to FALLBACK_DEFAULT_MODEL and the admin's saved slot wins.
  lmstudio: null,
  atlassian: FORGE_LLM_DEFAULT,
  bedrock: "eu.anthropic.claude-sonnet-4-6",
  managed: MANAGED_DEFAULT_MODEL,
};

/** The providers for which the `OPENAI_MODEL` env var names a model that exists. */
const OPENAI_SHAPED = ["openai", "azure"];

/**
 * Resolve the model a NAMED provider would actually run.
 *
 * agent slot (agent readers only) → ordinary model slot → legacy slot (migrating
 * readers only) → `OPENAI_MODEL` env var (OpenAI-shaped providers only) →
 * the provider's default → FALLBACK_DEFAULT_MODEL.
 *
 * @param {object} o
 * @param {string|null} o.provider        The provider id. NEVER read from anywhere in
 *   here — that is F-811's fix, and it is structural for all three readers.
 * @param {(key:string)=>Promise<any>} o.readSlot  Reads one KVS key.
 * @param {object} [o.env]                `process.env`-shaped.
 * @param {object} [o.providers]          Default models: either `{id: "model"}` or
 *   `{id: {defaultModel}}`. Defaults to PROVIDER_DEFAULT_MODELS.
 * @param {boolean} [o.agentSlot]         Consult the AGENT model slot first. Agent surfaces only — the ordinary path must never serve the agent's pick
 *   to a validator.
 * @param {boolean} [o.migrate]           Perform the one-time legacy-slot WRITE.
 *   ACTIVE-provider path only: it must not plant a model in a slot nobody asked about.
 * @param {(key:string, value:any)=>Promise<any>} [o.onMigrate]  The writer. Without it
 *   the legacy slot is still READ and honoured, but nothing is written.
 * @param {object} [o.log]                `{error, log}`; a faulted read is LOGGED.
 * @returns {Promise<string|null>} the model id, or null for a null/blank provider.
 *
 * THE POLICIES ARE THE SHARED ONES (src/shared/edition.js), applied AFTER the read and
 * HERE rather than at a call site, because they belong to EVERY reader:
 *
 *  - `clampManagedModel` on the managed engine: a slot outside the offer resolves to
 *    Sonnet 5 rather than being billed to LeanZero. A billing backstop is not an agent
 *    concern, and it is not a sync-process concern either.
 *  - THE ATLASSIAN BELT on Forge LLM: a slot written while another provider was active
 *    can hold that vendor's id (`anthropic/claude-opus-5`). It is a RESOLUTION belt,
 *    never access control — `agentCapability` still refuses Haiku for agents, and the
 *    EDITION clamp (`clampForgeLlmModel`) still runs at dispatch, where Standard vs
 *    Coder is known. NOT a prefix strip: the exact-id policy in edition.js is a pricing
 *    decision, so "anthropic/claude-opus-5" does not become "claude-opus-5".
 *
 * THE FAULTED-READ TAIL (F-826's reconciliation — ONE behaviour, both processes):
 *   - A NULL/blank PROVIDER answers `null`, before any slot is touched, in BOTH. F-112:
 *     `COGNIRUNNER_MODEL_null` is not a slot, and a default cached over a provider fault
 *     would send an OpenAI id to another vendor for the whole memo TTL. Callers bail on
 *     the null.
 *   - A FAULTED SLOT READ answers the PROVIDER'S DEFAULT MODEL, with the fault logged,
 *     in BOTH. Answering null there would take a working instance offline over a KVS
 *     blip, and CLAUDE.md's default-model fallback is exactly this case.
 *   The consumer's old tail conflated the two: its outer try/catch wrapped the PROVIDER
 *   read as well, so a faulted provider read answered "gpt-5.4-mini" where the sync seam
 *   answered null. Splitting them is what makes one behaviour possible.
 */
export const resolveModelForProvider = async ({
  provider,
  readSlot,
  env = {},
  providers = PROVIDER_DEFAULT_MODELS,
  agentSlot = false,
  migrate = false,
  onMigrate = null,
  log = console,
} = {}) => {
  // F-112 — refuse BEFORE any slot read, and before any memo write upstream.
  if (!provider || typeof provider !== "string") return null;

  let model = null;
  try {
    if (agentSlot) {
      const savedAgent = await readSlot(providerAgentModelSlot(provider));
      if (savedAgent) model = String(savedAgent);
    }
    if (!model) {
      // Read the saved per-provider model UNCONDITIONALLY. Gating this on a BYOK key
      // broke keyless providers: LM Studio (auth optional) and Forge LLM (no key at
      // all) would silently ignore the admin's saved model and fall through to a
      // default that does not exist there. The slot is cleared when reverting to
      // factory (removeOpenAIKey deletes it), so reading it is always safe.
      const saved = await readSlot(providerModelSlot(provider));
      if (saved) model = String(saved);
    }
    if (!model && migrate) {
      // The legacy slot is only meaningful where a BYOK key exists.
      const byokKey = await readSlot(providerKeySlot(provider));
      if (byokKey) {
        const legacy = await readSlot("COGNIRUNNER_OPENAI_MODEL");
        if (legacy) {
          if (onMigrate) {
            await onMigrate(providerModelSlot(provider), legacy);
            if (log && log.log) log.log(`Migrated legacy model to ${providerModelSlot(provider)}`);
          }
          model = String(legacy);
        }
      }
    }
    if (model && provider === MANAGED_PROVIDER_ID) model = clampManagedModel(model);
  } catch (error) {
    // Restrictive: an unread slot falls through to the env var / provider default
    // rather than answering null, which would take a working instance offline over a
    // read blip. LOGGED — a silent fallback is how the two seams drifted apart.
    if (log && log.error) log.error("Error reading model from storage:", error);
    model = null;
  }

  // The OPENAI_MODEL env var names an OpenAI model — applying it to Anthropic, LM
  // Studio or Forge LLM would 404 at inference time.
  if (!model && env.OPENAI_MODEL && OPENAI_SHAPED.includes(provider)) model = env.OPENAI_MODEL;
  if (!model) {
    const entry = providers && providers[provider];
    const fromTable = entry && typeof entry === "object" ? entry.defaultModel : entry;
    model = fromTable || FALLBACK_DEFAULT_MODEL;
  }
  // THE ATLASSIAN BELT — last, so it also covers a saved slot, the env var and a default.
  if (provider === "atlassian" && !FORGE_LLM_MODELS.advanced.includes(String(model))) return FORGE_LLM_DEFAULT;
  return model;
};
