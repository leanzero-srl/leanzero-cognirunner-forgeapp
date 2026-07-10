/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Learned memories — short, reusable lessons about THIS Jira instance
 * (field formats, missing options, permission quirks) injected as advisory
 * hints into AI code-generation / fix / review prompts.
 *
 * Storage: one KVS array under `pf_memories` (entries are small — a 350-char
 * lesson plus metadata), plus a tiny settings record. Auto-capture is OPT-IN
 * (default off); injection into prompts is ON by default.
 *
 * Memory entry shape:
 *   { id, content, source: "user"|"test"|"fix", projectKey: string|null,
 *     confidence: number, reinforcements: number, createdAt, updatedAt,
 *     disabled: boolean, meta?: { errorSig, ruleId, stepName }, createdBy? }
 */

// `storage` was deprecated from @forge/api — this project uses @forge/kvs
// (same import discipline as src/index.js).
import storage from "@forge/kvs";

export const MEMORIES_KEY = "pf_memories";
export const MEMORY_SETTINGS_KEY = "COGNIRUNNER_MEMORY_SETTINGS";

/**
 * Defang prompt-fence tokens in untrusted content before it is interpolated
 * inside a <<<FENCE ... FENCE>>> block. Collapses any run of 3+ angle brackets
 * to 2 so injected text can never open or close a literal fence. Shared by
 * every prompt-fence interpolation site (index.js, skills.js, async-handler.js).
 */
export const defangFence = (s) => String(s ?? "").replace(/<<<+/g, "<<").replace(/>>>+/g, ">>");

const MAX_MEMORIES = 200;
// Guard on real UTF-8 BYTES, not UTF-16 chars — the KVS value cap is 240KiB (245760
// bytes), and multibyte content (emoji, CJK) is up to ~3-4 bytes/char, so a char
// count would let a value blow past the byte cap and throw. Keep a safety margin.
const MAX_SERIALIZED_BYTES = 230000;
const utf8Len = (s) => { try { return new TextEncoder().encode(s).length; } catch (e) { return String(s).length * 4; } };
const MEMORY_CONTENT_MAX = 400;
const JACCARD_DEDUP_THRESHOLD = 0.85;

/**
 * Read the memory settings. Auto-capture defaults OFF (opt-in); prompt
 * injection into codegen/fix defaults ON; runtime injection (validators,
 * conditions, semantic post-functions) defaults OFF (opt-in — it adds a
 * token cost to every workflow transition that runs AI).
 */
export const getMemorySettings = async () => {
  try {
    const stored = await storage.get(MEMORY_SETTINGS_KEY);
    if (stored && typeof stored === "object") {
      return {
        autoCapture: stored.autoCapture === true,
        injection: stored.injection !== false,
        runtimeInjection: stored.runtimeInjection === true,
      };
    }
  } catch (error) {
    console.error("Failed to read memory settings:", error);
  }
  return { autoCapture: false, injection: true, runtimeInjection: false };
};

/** Merge a boolean patch into the stored settings. Returns the new settings. */
export const saveMemorySettingsInternal = async (patch = {}) => {
  const current = await getMemorySettings();
  const next = {
    autoCapture: patch.autoCapture !== undefined ? patch.autoCapture === true : current.autoCapture,
    injection: patch.injection !== undefined ? patch.injection !== false : current.injection,
    runtimeInjection: patch.runtimeInjection !== undefined ? patch.runtimeInjection === true : current.runtimeInjection,
  };
  await storage.set(MEMORY_SETTINGS_KEY, next);
  return next;
};

/**
 * Normalize memory/error text for comparison: mask issue keys (PROJ-123 →
 * ISSUE) BEFORE lowercasing, mask 4+ digit runs (ids, ports, years) as N,
 * collapse whitespace. Two failures that differ only in keys/ids normalize
 * to the same string.
 */
export const normalizeMemoryText = (s) => String(s || "")
  .replace(/\b[A-Z]+-[0-9]+\b/g, "ISSUE")
  .toLowerCase()
  .replace(/\d{4,}/g, "N")
  .replace(/\s+/g, " ")
  .trim();

/**
 * Stable non-crypto signature of an error message (FNV-1a 32-bit over the
 * normalized text, hex). Inline hash keeps this module free of node:crypto so
 * it stays portable across bundling targets.
 */
export const errorSignature = (msg) => {
  const norm = normalizeMemoryText(msg);
  let h = 0x811c9dc5;
  for (let i = 0; i < norm.length; i++) {
    h ^= norm.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
};

export const loadMemories = async () => {
  try {
    const stored = await storage.get(MEMORIES_KEY);
    return Array.isArray(stored) ? stored : [];
  } catch (error) {
    console.error("Failed to load memories:", error);
    return [];
  }
};

// Prune priority: lowest (confidence + 0.1 × min(reinforcements, 5)) first,
// oldest updatedAt as the tie-break. User-authored memories are only pruned
// once no auto-captured (test/fix) memories remain.
const pruneScore = (m) => (Number(m.confidence) || 0) + 0.1 * Math.min(Number(m.reinforcements) || 0, 5);

const pruneOne = (arr) => {
  const autoPool = arr.filter((m) => m.source !== "user");
  const pool = autoPool.length > 0 ? autoPool : arr;
  let victim = null;
  for (const m of pool) {
    if (!victim
      || pruneScore(m) < pruneScore(victim)
      || (pruneScore(m) === pruneScore(victim)
        && String(m.updatedAt || "") < String(victim.updatedAt || ""))) {
      victim = m;
    }
  }
  return arr.filter((m) => m !== victim);
};

/**
 * Persist the memories array, pruning on overflow (item cap + serialized-size
 * guard). Returns the array actually written.
 */
export const saveMemories = async (arr) => {
  let out = Array.isArray(arr) ? arr.slice() : [];
  while (out.length > MAX_MEMORIES) out = pruneOne(out);
  while (out.length > 0 && utf8Len(JSON.stringify(out)) >= MAX_SERIALIZED_BYTES) out = pruneOne(out);
  await storage.set(MEMORIES_KEY, out);
  return out;
};

const tokenSet = (s) => new Set(
  normalizeMemoryText(s).split(/[^a-z0-9]+/).filter(Boolean),
);

const jaccard = (a, b) => {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) {
    if (b.has(t)) intersection++;
  }
  return intersection / (a.size + b.size - intersection);
};

/**
 * Add a memory with dedup: an exact normalized match OR token-Jaccard >= 0.85
 * against an existing memory reinforces it (reinforcements++, confidence =
 * max, updatedAt = now) instead of creating a near-duplicate.
 *
 * @returns {{ id: string|null, merged: boolean, error?: string }}
 */
export const saveMemoryCandidate = async ({ content, source = "user", projectKey = null, confidence = 1.0, meta = null, createdBy = null } = {}) => {
  const clean = String(content || "").trim().substring(0, MEMORY_CONTENT_MAX);
  if (!clean) return { id: null, merged: false, error: "Memory content is required" };

  const memories = await loadMemories();
  const norm = normalizeMemoryText(clean);
  const candidateTokens = tokenSet(clean);
  const now = new Date().toISOString();

  for (const m of memories) {
    const sameText = normalizeMemoryText(m.content) === norm
      || jaccard(candidateTokens, tokenSet(m.content)) >= JACCARD_DEDUP_THRESHOLD;
    if (sameText) {
      m.reinforcements = (Number(m.reinforcements) || 0) + 1;
      m.confidence = Math.max(Number(m.confidence) || 0, Number(confidence) || 0);
      m.updatedAt = now;
      // A DELIBERATE user re-add of an ARCHIVED (disabled) memory means the user wants it active
      // again — re-enable it. Otherwise the re-add is a silent no-op: dedup merges into the disabled
      // row but it stays hidden from injection (buildMemoryBlock filters disabled). An AUTO (test/fix)
      // reinforce does NOT resurrect an admin's archive — only an explicit user action does.
      if (m.disabled && source === "user") m.disabled = false;
      await saveMemories(memories);
      return { id: m.id, merged: true };
    }
  }

  const id = `mem_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const entry = {
    id,
    content: clean,
    source,
    projectKey: projectKey || null,
    confidence: Number(confidence) || 0,
    reinforcements: 0,
    createdAt: now,
    updatedAt: now,
    disabled: false,
  };
  if (meta) entry.meta = meta;
  if (createdBy) entry.createdBy = createdBy;
  memories.unshift(entry);
  await saveMemories(memories);
  return { id, merged: false };
};

/**
 * Build the "- [source] content" lines block for prompt injection.
 * Eligible: not disabled AND (unscoped OR scoped to the given project).
 * Order: project-scoped first, then unscoped; within each group confidence
 * desc, reinforcements desc, updatedAt desc. Whole lines only up to capBytes.
 *
 * @returns {{ text: string, count: number }}
 */
export const buildMemoryBlock = async ({ projectKey = null, capBytes = 8192 } = {}) => {
  const memories = await loadMemories();
  const eligible = memories
    .filter((m) => !m.disabled && (!m.projectKey || m.projectKey === projectKey))
    .sort((a, b) => {
      const aScoped = a.projectKey ? 0 : 1;
      const bScoped = b.projectKey ? 0 : 1;
      if (aScoped !== bScoped) return aScoped - bScoped;
      const dc = (Number(b.confidence) || 0) - (Number(a.confidence) || 0);
      if (dc !== 0) return dc;
      const dr = (Number(b.reinforcements) || 0) - (Number(a.reinforcements) || 0);
      if (dr !== 0) return dr;
      return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
    });

  let text = "";
  let count = 0;
  for (const m of eligible) {
    const line = `- [${m.source || "user"}] ${defangFence(m.content)}`;
    const candidate = text ? `${text}\n${line}` : line;
    if (candidate.length > capBytes) break;
    text = candidate;
    count++;
  }
  return { text, count };
};
