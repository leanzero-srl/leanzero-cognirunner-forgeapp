/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * THE BACKEND DOOR TO THE FIELD GUIDE (1.4 commit 14b).
 *
 * `src/shared/knowledge-select.js` is the dependency-free SELECTOR: it scores sections,
 * honours the per-audience byte budgets from registry-limits.js and builds the fenced
 * block. It deliberately imports NOTHING generated and NOTHING from @forge — it bundles
 * into the webpack builds as well as the Forge backend, so it cannot touch KVS and it
 * cannot statically import 582 KB of packs.
 *
 * This module is the backend half that the selector is missing:
 *   1. it STATICALLY imports the nine generated packs and registers their sections and
 *      the baked pin map with the selector, once, at load;
 *   2. it owns the per-tenant on/off switch (`COGNIRUNNER_KNOWLEDGE_SETTINGS`) and
 *      subtracts the disabled packs BEFORE the selector ever sees them;
 *   3. it exposes the ONE call every prompt-building surface makes —
 *      `resolveFieldGuideBlock()` — so "how a field guide gets into a prompt" has a
 *      single home and a fix to it reaches codegen, fix, validators, the agent runner,
 *      the Coder engine and the PR reviewer at the same time.
 *
 * It does NOT re-declare `buildFieldGuideBlock`: that lives in the selector, beside the
 * marker and the guard sentence it has to agree with, and is re-exported here so a caller
 * has one import rather than two.
 *
 * Static imports, not `import()`: Forge's bundler resolves the whole graph ahead of time,
 * the packs are pure data with no side effects, and a lazily-loaded pack would make the
 * first prompt of every cold start slower than the ones after it — an unmeasurable
 * latency difference for a measurable loss of determinism. Plan §4b row 36 assumed the
 * bundle can carry ~600 KB of this; the emitted packs are 596,174 bytes.
 */

// `storage` was deprecated from @forge/api — this project uses @forge/kvs.
import { kvs as storage } from "@forge/kvs";

import {
  buildFieldGuideBlock,
  registerKnowledgePins,
  registerKnowledgeSections,
  selectKnowledge,
  KNOWLEDGE_VERSION,
  FIELD_GUIDE_MARKER,
  FIELD_GUIDE_GUARD_SENTENCE,
} from "./shared/knowledge-select.js";
import { fieldGuideBudget } from "./shared/registry-limits.js";
import { KNOWLEDGE_PACKS, KNOWLEDGE_PINS, KNOWLEDGE_CONTENT_VERSION } from "./shared/knowledge-index.js";

import { SECTIONS as ADMINISTRATOR_PRACTICE } from "./shared/knowledge-packs/administrator-practice.js";
import { SECTIONS as AUTOMATION_SEMANTICS } from "./shared/knowledge-packs/automation-semantics.js";
import { SECTIONS as COGNIRUNNER_SANDBOX_TRAPS } from "./shared/knowledge-packs/cognirunner-sandbox-traps.js";
import { SECTIONS as CONFLUENCE_REST_CORRECTNESS } from "./shared/knowledge-packs/confluence-rest-correctness.js";
import { SECTIONS as FORGE_APP_BUILDER } from "./shared/knowledge-packs/forge-app-builder.js";
import { SECTIONS as FORGE_PLATFORM_FACTS } from "./shared/knowledge-packs/forge-platform-facts.js";
import { SECTIONS as JIRA_REST_CORRECTNESS } from "./shared/knowledge-packs/jira-rest-correctness.js";
import { SECTIONS as JSM_CORRECTNESS } from "./shared/knowledge-packs/jsm-correctness.js";
import { SECTIONS as VOICE_RULES } from "./shared/knowledge-packs/voice-rules.js";

export {
  buildFieldGuideBlock,
  KNOWLEDGE_VERSION,
  KNOWLEDGE_CONTENT_VERSION,
  FIELD_GUIDE_MARKER,
  FIELD_GUIDE_GUARD_SENTENCE,
};

/** The KVS key holding the per-tenant pack switches. */
export const KNOWLEDGE_SETTINGS_KEY = "COGNIRUNNER_KNOWLEDGE_SETTINGS";

/**
 * Every baked section, in pack order. Flat on purpose: the selector scores across packs,
 * and the pack is only ever a grouping for the Knowledge tab and the on/off switch.
 */
export const ALL_SECTIONS = Object.freeze([
  ...ADMINISTRATOR_PRACTICE,
  ...AUTOMATION_SEMANTICS,
  ...COGNIRUNNER_SANDBOX_TRAPS,
  ...CONFLUENCE_REST_CORRECTNESS,
  ...FORGE_APP_BUILDER,
  ...FORGE_PLATFORM_FACTS,
  ...JIRA_REST_CORRECTNESS,
  ...JSM_CORRECTNESS,
  ...VOICE_RULES,
]);

/** The pack ids that actually exist. A setting naming anything else is dropped. */
export const KNOWN_PACK_IDS = Object.freeze(KNOWLEDGE_PACKS.map((p) => p.id));

/**
 * Register with the selector, once, at module load. The selector treats an unregistered
 * corpus as "nothing to inject" — a degraded prompt, never a broken one — so this is the
 * only thing that turns the packs from bytes in the bundle into text in a prompt.
 */
registerKnowledgeSections(ALL_SECTIONS);
registerKnowledgePins(KNOWLEDGE_PINS);

/* ------------------------------------------------------------------ *
 * Settings.
 * ------------------------------------------------------------------ */

/**
 * A 30 s TTL cache, matching the provider/model config cache in index.js.
 *
 * Without it every validator transition, every agent round and every Coder turn pays a
 * KVS read to learn a list that changes when an admin clicks a switch. `saveKnowledgeSettings`
 * invalidates it in-process; another instance picks the change up within the TTL.
 */
const SETTINGS_TTL_MS = 30_000;
let settingsCache = null;
let settingsCachedAt = 0;

/** Coerce anything KVS hands back into the settings shape. Unknown pack ids are dropped. */
const normalizeSettings = (raw) => {
  const list = Array.isArray(raw?.disabled) ? raw.disabled : [];
  const disabled = [];
  for (const entry of list) {
    const id = typeof entry === "string" ? entry.trim() : "";
    if (!id || !KNOWN_PACK_IDS.includes(id) || disabled.includes(id)) continue;
    disabled.push(id);
  }
  return { disabled };
};

/** Reset the in-process cache. Exported for the tests; called by the saver. */
export const invalidateKnowledgeSettingsCache = () => {
  settingsCache = null;
  settingsCachedAt = 0;
};

/**
 * Read the pack switches.
 *
 * On a KVS error this returns the LAST KNOWN settings when the cache holds any, and
 * `{ disabled: [] }` otherwise. It does not fail closed to "inject nothing": the field
 * guide is background knowledge and a storage blip must not silently strip every prompt
 * in the installation of the facts it was built around. It does not invent a disable
 * either — an admin's opt-out is honoured for as long as we can still remember it.
 */
export const getKnowledgeSettings = async () => {
  const now = Date.now();
  if (settingsCache && now - settingsCachedAt < SETTINGS_TTL_MS) return settingsCache;
  try {
    const stored = await storage.get(KNOWLEDGE_SETTINGS_KEY);
    settingsCache = normalizeSettings(stored && typeof stored === "object" ? stored : null);
    settingsCachedAt = now;
    return settingsCache;
  } catch (error) {
    console.error("Failed to read knowledge settings:", error);
    return settingsCache || { disabled: [] };
  }
};

/**
 * Write the pack switches. The caller's list is clamped HERE, after parsing and before
 * the side effect: unknown ids, duplicates and non-strings never reach storage, so the
 * stored value can only ever name packs that exist.
 */
export const saveKnowledgeSettings = async (patch = {}) => {
  const next = normalizeSettings(patch);
  await storage.set(KNOWLEDGE_SETTINGS_KEY, next);
  settingsCache = next;
  settingsCachedAt = Date.now();
  return next;
};

/* ------------------------------------------------------------------ *
 * Selection.
 * ------------------------------------------------------------------ */

/**
 * The sections a tenant is willing to be shown, given its disabled packs.
 * Synchronous and pure so the tests can exercise the filter without KVS.
 */
export const sectionsForSettings = (settings) => {
  const disabled = normalizeSettings(settings).disabled;
  if (!disabled.length) return ALL_SECTIONS;
  return ALL_SECTIONS.filter((s) => !disabled.includes(s.pack));
};

/**
 * Select the field-guide sections for one audience, minus the disabled packs.
 *
 * `maxBytes` may only ever LOWER the audience's budget — the clamp is the selector's and
 * it is deliberate: a caller cannot talk its way past the ceiling registry-limits sets
 * for who is reading. Passing nothing gets the audience's full budget.
 */
export const selectFieldGuide = async ({ audience = "review", text = "", operationType, hints, maxBytes } = {}) => {
  const settings = await getKnowledgeSettings();
  return selectKnowledge({
    audience,
    text,
    operationType,
    hints,
    maxBytes,
    sections: sectionsForSettings(settings),
  });
};

/**
 * THE call every prompt-building surface makes. Select, then build the one fenced block.
 *
 * Returns `{ block, sectionIds, bytes, budget, skipped }`. `block` is "" when nothing was
 * selected — an empty fence still spends tokens and still advertises a knowledge layer
 * the model can ask to be filled, so there is no such thing as an empty field guide.
 * `sectionIds` is what rides into `generationMeta.fieldGuide`, the turn record's
 * `knowledge.fieldGuideSections` and the run row, so a wrong answer can be traced to the
 * text that caused it.
 */
export const resolveFieldGuideBlock = async (options = {}) => {
  const picked = await selectFieldGuide(options);
  const built = buildFieldGuideBlock(picked.sections);
  return {
    block: built.block,
    sectionIds: built.sectionIds,
    bytes: picked.bytes,
    budget: picked.budget,
    skipped: picked.skipped,
    knowledgeVersion: KNOWLEDGE_VERSION,
    contentVersion: KNOWLEDGE_CONTENT_VERSION,
  };
};

/* ------------------------------------------------------------------ *
 * The Knowledge tab's view.
 * ------------------------------------------------------------------ */

/**
 * The packs as the admin UI shows them: id, title, section count, bytes, provenance and
 * whether the tenant has it on. Bodies are never included — the tab costs kilobytes.
 *
 * Provenance is summarised from the sections' own provenance rather than restated here,
 * so it cannot drift from what was actually baked.
 */
export const describeKnowledgePacks = (settings) => {
  const disabled = normalizeSettings(settings).disabled;
  return KNOWLEDGE_PACKS.map((pack) => {
    const sources = [];
    for (const s of ALL_SECTIONS) {
      if (s.pack !== pack.id) continue;
      const p = s.provenance || {};
      const line = [p.source, p.licence].filter(Boolean).join(", ");
      if (line && !sources.includes(line)) sources.push(line);
    }
    return {
      id: pack.id,
      title: pack.title,
      sections: pack.sections,
      bytes: pack.bytes,
      pinned: Array.isArray(pack.pinned) ? pack.pinned.slice() : [],
      provenance: sources,
      enabled: !disabled.includes(pack.id),
    };
  });
};

/** The audience -> byte-budget table, for the tab's "what it costs" line. */
export const knowledgeAudienceBudgets = () => ({
  codegen: fieldGuideBudget("codegen"),
  fix: fieldGuideBudget("fix"),
  validator: fieldGuideBudget("validator"),
  agent: fieldGuideBudget("agent"),
  va: fieldGuideBudget("va"),
  coder: fieldGuideBudget("coder"),
  review: fieldGuideBudget("review"),
});
