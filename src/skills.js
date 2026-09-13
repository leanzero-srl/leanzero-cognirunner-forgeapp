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
 */

/**
 * Skill repository — reusable, admin/editor-authored "skill packs" injected
 * into the AI code-generation and fix prompts.
 *
 * Storage layout (mirrors the doc repository pattern in src/index.js):
 *   - skill_repo_index      → array of index rows (metadata only, no content)
 *   - skill_repo:{id}       → full record ({ ...indexRow, instructions, examples })
 *   - skill_repo_seed_meta  → { seedVersion } for the builtin-skill seeder
 *
 * Builtin skills are seeded lazily from src/shared/builtin-skills.js and are
 * never deleted — "deleting" one flips enabled:false so a reseed cannot
 * resurrect it.
 */

// `storage` was deprecated from @forge/api — this project uses @forge/kvs
// (same import discipline as src/index.js).
import { kvs as storage } from "@forge/kvs";
import { SKILL_SEED_VERSION, BUILTIN_SKILLS } from "./shared/builtin-skills.js";
// Shared fence-defang helper — skill content is interpolated inside <<<SKILLS>>>.
import { defangFence } from "./memories.js";
import { KNOWLEDGE_BUDGET_BYTES } from "./shared/registry-limits.js";

export const SKILL_INDEX_KEY = "skill_repo_index";
export const SKILL_PREFIX = "skill_repo:";
export const SKILL_SEED_META_KEY = "skill_repo_seed_meta";

/** Fixed category taxonomy — must match the UI badge map exactly. */
export const SKILL_CATEGORIES = [
  "Jira API",
  "External / Webhooks",
  "Fields & Data",
  "ADF & Formatting",
  "Workflow Patterns",
  "Other",
];

// === Field caps (enforced on every save) ====================================
const NAME_MAX = 80;
const DESCRIPTION_MAX = 300;
const TAGS_MAX = 10;
const TAG_LEN_MAX = 30;
const INSTRUCTIONS_MAX = 24000;
const EXAMPLES_MAX = 16000;
const RECORD_MAX_CHARS = 45000; // total serialized record must stay under this
const MAX_CUSTOM_SKILLS = 100;  // non-builtin index rows

/**
 * Lazily seed the builtin skills. One KVS read per cold container; a
 * module-level flag skips repeat checks in a warm one. Reseeding (version
 * bump) upserts by stable id and NEVER re-enables a row an admin disabled.
 */
let _skillsSeeded = false;
export const seedBuiltinSkills = async () => {
  if (_skillsSeeded) return;
  try {
    const meta = await storage.get(SKILL_SEED_META_KEY);
    if ((meta?.seedVersion || 0) >= SKILL_SEED_VERSION) {
      _skillsSeeded = true;
      return;
    }
    const index = (await storage.get(SKILL_INDEX_KEY)) || [];
    const now = new Date().toISOString();
    for (const skill of BUILTIN_SKILLS) {
      const existing = index.find((s) => s.id === skill.id);
      const instructions = String(skill.instructions || "");
      const examples = String(skill.examples || "");
      const row = {
        id: skill.id,
        name: skill.name,
        category: SKILL_CATEGORIES.includes(skill.category) ? skill.category : "Other",
        description: skill.description || "",
        tags: Array.isArray(skill.tags) ? skill.tags : [],
        operationTypes: Array.isArray(skill.operationTypes) ? skill.operationTypes : [],
        builtin: true,
        // Respect an admin's removal — a reseed must never re-enable the row.
        enabled: existing ? existing.enabled !== false : true,
        contentLength: instructions.length + examples.length,
        createdBy: null,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };
      await storage.set(`${SKILL_PREFIX}${skill.id}`, { ...row, instructions, examples });
      const pos = index.findIndex((s) => s.id === skill.id);
      if (pos >= 0) index[pos] = row;
      else index.unshift(row);
    }
    await storage.set(SKILL_INDEX_KEY, index);
    await storage.set(SKILL_SEED_META_KEY, { seedVersion: SKILL_SEED_VERSION });
    _skillsSeeded = true;
  } catch (error) {
    console.error("Failed to seed builtin skills:", error);
  }
};

/**
 * Persist a skill (create or update). Clamps every field to its cap, rejects
 * records that would exceed the serialized-size guard, and caps the index at
 * MAX_CUSTOM_SKILLS non-builtin rows (builtins never count against the cap).
 *
 * @param {object} meta    { id?, name, category, description, tags, operationTypes, builtin?, enabled?, createdBy? }
 * @param {object} content { instructions, examples }
 * @returns {{ success: boolean, id?: string, row?: object, error?: string }}
 */
export const saveSkillInternal = async (meta = {}, content = {}) => {
  const name = String(meta.name || "").trim().substring(0, NAME_MAX);
  if (!name) return { success: false, error: "Skill name is required" };
  const instructions = String(content.instructions || "").substring(0, INSTRUCTIONS_MAX);
  if (!instructions.trim()) return { success: false, error: "Skill instructions are required" };
  const examples = String(content.examples || "").substring(0, EXAMPLES_MAX);
  const description = String(meta.description || "").trim().substring(0, DESCRIPTION_MAX);
  const category = SKILL_CATEGORIES.includes(meta.category) ? meta.category : "Other";
  const tags = (Array.isArray(meta.tags) ? meta.tags : [])
    .map((t) => String(t).trim().toLowerCase().substring(0, TAG_LEN_MAX))
    .filter(Boolean)
    .slice(0, TAGS_MAX);
  const operationTypes = (Array.isArray(meta.operationTypes) ? meta.operationTypes : [])
    .map((t) => String(t).trim().substring(0, 40))
    .filter(Boolean)
    .slice(0, 8);

  const index = (await storage.get(SKILL_INDEX_KEY)) || [];
  const id = meta.id || `skill_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const existing = index.find((s) => s.id === id);

  if (!existing && meta.builtin !== true) {
    const customCount = index.filter((s) => s.builtin !== true).length;
    if (customCount >= MAX_CUSTOM_SKILLS) {
      return {
        success: false,
        error: `Skill library is full (${MAX_CUSTOM_SKILLS} custom skills). Delete an unused skill before adding a new one.`,
      };
    }
  }

  const now = new Date().toISOString();
  const row = {
    id,
    name,
    category,
    description,
    tags,
    operationTypes,
    builtin: existing?.builtin === true || meta.builtin === true,
    enabled: meta.enabled !== undefined
      ? meta.enabled !== false
      : (existing ? existing.enabled !== false : true),
    contentLength: instructions.length + examples.length,
    createdBy: existing?.createdBy ?? meta.createdBy ?? null,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  const record = { ...row, instructions, examples };
  const serializedLength = JSON.stringify(record).length;
  if (serializedLength >= RECORD_MAX_CHARS) {
    return {
      success: false,
      error: `Skill is too large (${serializedLength} chars serialized, limit ${RECORD_MAX_CHARS}). Trim the instructions or examples.`,
    };
  }

  await storage.set(`${SKILL_PREFIX}${id}`, record);
  const pos = index.findIndex((s) => s.id === id);
  if (pos >= 0) index[pos] = row;
  else index.unshift(row);
  await storage.set(SKILL_INDEX_KEY, index);

  return { success: true, id, row };
};

/**
 * Remove a skill — THE ONLY writer of the skill index for deletes.
 *
 * F-590: the index used to be written from here AND from the `deleteSkill`
 * resolver in src/index.js, so the "builtins flip to disabled, never delete"
 * invariant this module documents lived in a second file that could drift
 * (and a counter-based skill epoch would have been wrong at the second home).
 * Permission gating stays with the caller — this is the store, not the policy.
 *
 * @param {string} id      skill id
 * @param {object} [opts]
 * @param {string|null} [opts.who] acting accountId, for error-log context only
 * @returns {Promise<{success: boolean, mode: "disabled"|"deleted", removed: number}>}
 */
export const deleteSkillRows = async (id, { who = null } = {}) => {
  const index = (await storage.get(SKILL_INDEX_KEY)) || [];
  const skill = index.find((s) => s.id === id);
  if (skill?.builtin === true) {
    // Builtins are shared, curated content: flip enabled:false so a future
    // seed-version bump cannot resurrect a row an admin turned off.
    const disabledRow = { ...skill, enabled: false, updatedAt: new Date().toISOString() };
    await storage.set(SKILL_INDEX_KEY, index.map((s) => (s.id === id ? disabledRow : s)));
    try {
      const record = await storage.get(`${SKILL_PREFIX}${id}`);
      if (record) await storage.set(`${SKILL_PREFIX}${id}`, { ...record, enabled: false });
    } catch (e) {
      console.error(`Failed to flag builtin skill record as disabled (actor ${who}):`, e);
    }
    return { success: true, mode: "disabled", removed: 0 };
  }
  await storage.delete(`${SKILL_PREFIX}${id}`);
  const next = index.filter((s) => s.id !== id);
  await storage.set(SKILL_INDEX_KEY, next);
  return { success: true, mode: "deleted", removed: index.length - next.length };
};

// === Auto-matching ===========================================================

// Common English + prompt-domain filler words that carry no matching signal.
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "do", "each",
  "for", "from", "get", "has", "have", "if", "in", "into", "is", "it", "its",
  "make", "new", "not", "of", "on", "or", "set", "should", "so", "that", "the",
  "their", "then", "there", "these", "this", "to", "use", "using", "want",
  "was", "we", "when", "where", "which", "will", "with", "you", "your",
]);

const tokenize = (text) => String(text || "")
  .toLowerCase()
  .split(/[^a-z0-9]+/)
  .filter((t) => t.length > 1 && !STOPWORDS.has(t));

/**
 * Score every enabled skill in the index against a prompt and return the best
 * matches. Pure function — the caller supplies the (already seeded) index.
 *
 * Scoring: +3 per tag whose tokens all appear in the prompt, +1 per distinct
 * name/description token found in the prompt, +2 when the skill declares the
 * step's operationType. Threshold: total >= 3.
 */
export const autoMatchSkills = (promptText, operationType, index, { max = 2, excludeIds = [] } = {}) => {
  const tokens = new Set(tokenize(promptText));
  if (tokens.size === 0) return [];
  const excluded = new Set(excludeIds);
  const scored = [];
  for (const skill of index || []) {
    if (!skill || skill.enabled === false || excluded.has(skill.id)) continue;
    let score = 0;
    for (const tag of skill.tags || []) {
      const tagTokens = tokenize(tag);
      if (tagTokens.length > 0 && tagTokens.every((t) => tokens.has(t))) score += 3;
    }
    const nameDescTokens = new Set(tokenize(`${skill.name || ""} ${skill.description || ""}`));
    for (const t of nameDescTokens) {
      if (tokens.has(t)) score += 1;
    }
    if (operationType && (skill.operationTypes || []).includes(operationType)) score += 2;
    if (score >= 3) scored.push({ skill, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, max).map((s) => s.skill);
};

/**
 * Load skill contents and concatenate them into one prompt block, hard-capped at
 * capBytes. Whole skills only — a skill whose block would cross the cap is SKIPPED and
 * the ones after it are still considered.
 *
 * THE DEFECT THIS FIXES (1.4 commit 13b). This loop used to `break` on the first skill
 * that did not fit. With one budget and one audience that read as "the cap is reached,
 * stop" — but it is not what the code did: the loop walks the CALLER'S PRIORITY ORDER,
 * so ONE oversized skill ranked first silently deleted every skill below it, including
 * ones that would have fit with room to spare. The bigger a skill an author wrote, the
 * more of everybody else's work it suppressed, and nothing anywhere said so.
 *
 * `continue` is the correct reading of "whole skills only": the cap is a per-block
 * budget, not a stop signal. Ordering is unchanged for everything that fits, so the
 * common case is byte-identical; only the suppression disappears. `skipped` is returned
 * so a caller can SAY that a skill was too big instead of leaving the author to wonder
 * why their skill never appears.
 *
 * Per-AUDIENCE budgets live in src/shared/registry-limits.js. The default here stays the
 * codegen number so every pre-1.4 caller is unchanged to the byte.
 */
export const fetchSkillsBlock = async (ids, { capBytes = KNOWLEDGE_BUDGET_BYTES.codegen.skills } = {}) => {
  const applied = [];
  const skipped = [];
  let text = "";
  if (!Array.isArray(ids) || ids.length === 0) return { text, applied, skipped };
  try {
    const records = await Promise.all(
      ids.slice(0, 8).map((id) => storage.get(`${SKILL_PREFIX}${id}`)),
    );
    for (const rec of records) {
      if (!rec || rec.enabled === false) continue;
      let block = `### Skill: ${defangFence(rec.name)}\n${defangFence(rec.instructions || "")}`;
      if (rec.examples && String(rec.examples).trim()) {
        block += `\n\nExample:\n${defangFence(rec.examples)}`;
      }
      const candidate = text ? `${text}\n\n${block}` : block;
      if (candidate.length > capBytes) { skipped.push({ id: rec.id, name: rec.name }); continue; }
      text = candidate;
      applied.push({ id: rec.id, name: rec.name });
    }
  } catch (error) {
    console.error("Failed to fetch skills block:", error);
  }
  return { text, applied, skipped };
};

/**
 * F-578 — THE EPOCH OF A GIVEN SET OF SKILLS, for the Coder's per-thread knowledge pin.
 *
 * The Coder pins the RENDERED skills block on a thread for up to 90 days (F-574). A skill
 * that is EDITED or DELETED after that must stop reaching the model, exactly as a deleted
 * memory must: the pin stores this token and `buildCoderKnowledge` (src/async-handler.js)
 * replays the pinned bytes only while it still matches.
 *
 * DERIVED, not counted, and that is a deliberate difference from `memoryEpoch`. The memory
 * store has ONE writer (`saveMemories`), so a counter there cannot be forgotten. The skill
 * index does NOT: `saveSkillInternal` and `seedBuiltinSkills` write it here, and
 * `deleteSkill`/`saveSkill` write it again in src/index.js. A counter would need a bump at
 * four call sites and would be wrong the first time a fifth was added — so the epoch is
 * READ from the index instead, in this one function, and every writer is covered by
 * construction because every writer must leave the index consistent.
 *
 * SCOPED TO THE PINNED IDS, because a thread's prefix only carries those: adding an
 * unrelated skill to the library must not move a cached prefix. An id missing from the
 * index renders as "gone", which is itself a change.
 *
 * FAIL-OPEN: an unreadable index returns null, and a null epoch is treated by the caller as
 * "cannot tell" → replay. A storage hiccup must never move a prompt prefix.
 *
 * @param {string[]} ids
 * @returns {Promise<string|null>}
 */
export const skillEpochFor = async (ids) => {
  const list = (Array.isArray(ids) ? ids : []).map(String).slice(0, 40);
  if (!list.length) return "";
  let index;
  try { index = await storage.get(SKILL_INDEX_KEY); } catch (error) {
    console.warn("skills: could not read the index for the skill epoch:", error && error.message);
    return null;
  }
  if (!Array.isArray(index)) return null;
  const byId = new Map(index.filter((s) => s && s.id).map((s) => [String(s.id), s]));
  return list
    .slice()
    .sort()
    .map((id) => {
      const row = byId.get(id);
      if (!row) return `${id}:gone`;
      return `${id}:${row.enabled === false ? "off" : "on"}:${String(row.updatedAt || "")}`;
    })
    .join("|");
};

/**
 * Which of `ids` exist in the skill index. Used by the rule savers (listeners,
 * scheduled jobs) to refuse a `skillIds` binding that names a skill nobody has — a
 * rule that silently binds nothing is a rule whose author believes it has a voice it
 * does not have. Returns { known, unknown }. Never throws: an index read failure
 * reports everything as known, because a storage hiccup must not block a save.
 */
export const partitionKnownSkillIds = async (ids) => {
  const list = (Array.isArray(ids) ? ids : []).map(String);
  if (!list.length) return { known: [], unknown: [] };
  let index = [];
  try { index = (await storage.get(SKILL_INDEX_KEY)) || []; } catch { return { known: list, unknown: [] }; }
  if (!Array.isArray(index)) return { known: list, unknown: [] };
  const have = new Set(index.map((s) => s && s.id));
  return { known: list.filter((id) => have.has(id)), unknown: list.filter((id) => !have.has(id)) };
};
