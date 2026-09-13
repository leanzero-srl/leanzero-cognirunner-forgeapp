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
import { kvs as storage } from "@forge/kvs";
/*
 * F-175 — the memory caps and the pure refusal sentence live in
 * src/shared/registry-limits.js (the one home for limits, dependency-free) so
 * that surfaces which cannot import THIS module — it loads @forge/kvs — can
 * still derive them instead of retyping the number and the sentence. They are
 * re-exported below, so `import { MAX_MEMORIES, ... } from "./memories.js"`
 * keeps working everywhere it already appears.
 */
import {
  MAX_MEMORIES,
  MEMORY_CONTENT_MAX,
  MEMORY_MAX_SERIALIZED_BYTES,
  memoryCapRefusalMessage,
} from "./shared/registry-limits.js";

export { MAX_MEMORIES, MEMORY_CONTENT_MAX, MEMORY_MAX_SERIALIZED_BYTES, memoryCapRefusalMessage };

export const MEMORIES_KEY = "pf_memories";
export const MEMORY_SETTINGS_KEY = "COGNIRUNNER_MEMORY_SETTINGS";
/**
 * F-167 — the ONE marker that says "this instance has stopped learning".
 * Written whenever a candidate is REFUSED by the cap/byte guard (see
 * saveMemoryCandidate), cleared by the next successful store/merge or by any
 * save that leaves the store under the cap (a delete/edit in the Memories tab).
 * Shape: { at: ISO string, reason: "cap"|"bytes", source: "user"|"test"|"fix" }.
 * Read it with readMemoryStoreFull(); the admin resolvers surface it so the
 * Memories tab can show a banner instead of the instance silently discarding
 * every novel lesson behind a healthy-looking 200-row list.
 */
export const MEMORY_STORE_FULL_KEY = "COGNIRUNNER_MEMORY_STORE_FULL";

/**
 * Defang prompt-fence tokens in untrusted content before it is interpolated
 * inside a <<<FENCE ... FENCE>>> block. Collapses any run of 3+ angle brackets
 * to 2 so injected text can never open or close a literal fence. Shared by
 * every prompt-fence interpolation site (index.js, skills.js, async-handler.js).
 */
export const defangFence = (s) => String(s ?? "").replace(/<<<+/g, "<<").replace(/>>>+/g, ">>");

const utf8Len = (s) => { try { return new TextEncoder().encode(s).length; } catch (e) { return String(s).length * 4; } };
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

/**
 * Read the store-full marker (F-167). Returns null when the instance is learning
 * normally. Never throws — a marker we cannot read must not break a memory read.
 */
export const readMemoryStoreFull = async () => {
  try {
    const row = await storage.get(MEMORY_STORE_FULL_KEY);
    if (row && typeof row === "object" && row.at) {
      return { at: String(row.at), reason: String(row.reason || "cap"), source: row.source || null };
    }
  } catch (error) {
    console.error("Failed to read the memory store-full marker:", error);
  }
  return null;
};

/** Raise the store-full marker. Best-effort: never fails a caller's own answer. */
const markMemoryStoreFull = async (reason, source) => {
  try {
    await storage.set(MEMORY_STORE_FULL_KEY, { at: new Date().toISOString(), reason, source: source || null });
  } catch (error) {
    console.error("Failed to write the memory store-full marker:", error);
  }
};

/**
 * Is the store STILL full? (F-170/F-171 — the ONE predicate.)
 *
 * The marker means "a novel lesson would be refused right now". The only honest way
 * to answer that is to ask the admission rule itself: build a hypothetical AUTO-sourced
 * newcomer of the maximum allowed length and run the real `pruneForSave` dry-run over
 * `[newcomer, ...arr]`. It stays raised iff that newcomer could not be kept — i.e. there
 * is no evictable row (non-archived AUTO rows only — see pruneOne) AND either the item cap
 * or the serialized-byte guard is hit.
 *
 * This replaces two PROXIES that disagreed with the rule that raises the marker:
 * `out.length < MAX_MEMORIES` (blind to the byte arm: shortening one row of an over-size
 * store cleared the banner while every capture was still being discarded, and an edit that
 * merely archived a row left it raised) and an unconditional clear on every reinforce (a
 * reinforce writes no new row, so a store with nothing evictable is exactly as full as it
 * was one line earlier).
 */
const HYPOTHETICAL_PROBE_ID = "__memory_store_full_probe__";
export const wouldRefuseNewMemory = (arr) => {
  const now = new Date().toISOString();
  const probe = {
    id: HYPOTHETICAL_PROBE_ID,
    content: "x".repeat(MEMORY_CONTENT_MAX),
    source: "test",
    projectKey: null,
    confidence: 0.5,
    reinforcements: 0,
    createdAt: now,
    updatedAt: now,
    disabled: false,
  };
  const list = [probe, ...(Array.isArray(arr) ? arr : [])];
  return !pruneForSave(list, HYPOTHETICAL_PROBE_ID).protectedKept;
};

/**
 * Re-evaluate the marker after a write. Clears it when the store can accept a lesson
 * again; when it is still full the EXISTING row is left untouched (its `at`/`reason`/
 * `source` belong to the real refusal that raised it). Never raises — only a genuine
 * refusal in saveMemoryCandidate does that. Best-effort: never fails a caller's answer.
 */
const refreshMemoryStoreFull = async (arr) => {
  try {
    const existing = await storage.get(MEMORY_STORE_FULL_KEY);
    if (!existing) return;
    if (wouldRefuseNewMemory(arr)) return;
    await storage.delete(MEMORY_STORE_FULL_KEY);
  } catch (error) {
    console.error("Failed to refresh the memory store-full marker:", error);
  }
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

// Prune priority among AUTO-captured rows: lowest (confidence + 0.1 × min(
// reinforcements, 5)) first, oldest updatedAt as the tie-break. User-authored
// memories are never pruned at all (F-164 — see pruneOne).
const pruneScore = (m) => (Number(m.confidence) || 0) + 0.1 * Math.min(Number(m.reinforcements) || 0, 5);

/**
 * Choose ONE victim.
 *
 * THE EVICTION POLICY, ONE HOME (F-160 + F-164 + F-176/F-177):
 * **the app evicts only AUTO-captured (source "test"/"fix") rows that are NOT
 * archived. A hand-authored memory is never evicted, and an ARCHIVED memory is
 * never evicted either — archived rows keep their slot and count toward the cap.**
 * With no such row available there is NO victim and the caller is told (`blocked`);
 * for a new candidate that means refused with reason "cap"/"bytes" and a store left
 * byte-identical, and the human prunes in the Memories tab (memoryCapRefusalMessage
 * says exactly that). The ONE exception is the byte guard with nothing left but the
 * protected newcomer itself — it is then dropped (never a stored row).
 *
 * Why each half exists:
 * - F-160: an AUTO candidate may not evict a USER row (measured: a 1.0-confidence,
 *   5-reinforcement user row evicted by a 0.2-confidence fix row).
 * - F-164: nor may a USER add — at a full all-user store it silently destroyed the
 *   lowest-scoring hand-written memory, permanently, behind a "Memory saved" toast.
 *   A curated store is exactly the state the feature asks admins to build; it must
 *   not eat itself.
 * - F-176/F-177 REVERSE F-173, which had made archived rows the first eviction pool
 *   so that "Archive" would free capacity. Archive is this app's NON-DESTRUCTIVE
 *   action: it has a "Restore" twin, its toast is "Memory archived", and only Delete
 *   carries a "cannot be undone" confirm. Under F-173, background auto-capture
 *   permanently destroyed a deliberately archived hand-authored memory with no
 *   tombstone, no log and no undo — and the docblock above still promised the
 *   opposite. Archiving is now honest: it silences a memory, it never risks it, and
 *   it does not free a slot. Delete is the one way to make room.
 *
 * @returns {{ out: Array, victim: Object|null, blocked?: boolean }}
 */
const pruneOne = (arr, protectId = null) => {
  // The just-inserted row (protectId) is NEVER the victim while any other row
  // remains: F-159 — the new entry could be the lowest-scoring row and get evicted
  // by its own save, while saveMemoryCandidate still reported an id, so addMemory
  // answered success for a row that no longer existed.
  const eligible = protectId ? arr.filter((m) => m.id !== protectId) : arr;
  // F-164 + F-176/F-177: the victim pool is the NON-ARCHIVED AUTO rows. Full stop —
  // no hand-authored row (whatever its state) and no archived row (whatever its
  // source) is ever evicted by the app.
  const pool = eligible.filter((m) => m.source !== "user" && m.disabled !== true);
  let victim = null;
  for (const m of pool) {
    if (!victim
      || pruneScore(m) < pruneScore(victim)
      || (pruneScore(m) === pruneScore(victim)
        && String(m.updatedAt || "") < String(victim.updatedAt || ""))) {
      victim = m;
    }
  }
  if (!victim) {
    // Every remaining row is hand-authored or archived → nothing may be evicted. The caller
    // must reject the candidate and leave the store untouched.
    if (eligible.length > 0) return { out: arr, victim: null, blocked: true };
    // Nothing but the protected row is left: it is the only thing that can still go
    // (byte guard — a row that cannot fit even alone is never reported as stored).
    victim = arr.length > 0 ? arr[0] : null;
  }
  return { out: arr.filter((m) => m !== victim), victim };
};

/**
 * Apply the item cap and the serialized-size guard to an array WITHOUT writing.
 * `protectId` shields the just-added row from eviction until it is the only row
 * left (at which point, if it still cannot fit the byte guard, it is dropped and
 * `protectedKept` is false — the caller must then report stored:false).
 *
 * F-161: `reason` says WHY a protected row could not be kept — "cap" (the item cap,
 * reachable for ANY candidate since F-164) or "bytes" (the serialized-size guard).
 *
 * @returns {{ out: Array, evicted: string[], protectedKept: boolean, reason: string|null }}
 */
export const pruneForSave = (arr, protectId = null) => {
  let out = Array.isArray(arr) ? arr.slice() : [];
  const evicted = [];
  let reason = null;
  const dropProtected = (why) => {
    reason = why;
    out = out.filter((m) => m.id !== protectId);
  };
  // Returns true when no further eviction is possible and the loop must stop.
  const step = (why) => {
    const r = pruneOne(out, protectId);
    if (r.blocked) {
      // F-164: nothing but hand-authored rows left. If we are protecting a newcomer,
      // IT is what gives way (the caller then reports stored:false / reason). With no
      // newcomer to drop (a re-save of an oversized legacy store) there is simply
      // nothing this module is allowed to delete — stop rather than spin, and let the
      // KVS write surface any real size error instead of silently eating user data.
      if (protectId && out.some((m) => m.id === protectId)) { dropProtected(why); return false; }
      return true;
    }
    out = r.out;
    if (r.victim) {
      if (protectId && r.victim.id === protectId) reason = why;
      else evicted.push(r.victim.id);
    }
    return !r.victim;
  };
  while (out.length > MAX_MEMORIES) { if (step("cap")) break; }
  while (out.length > 0 && utf8Len(JSON.stringify(out)) >= MEMORY_MAX_SERIALIZED_BYTES) { if (step("bytes")) break; }
  const protectedKept = !protectId || out.some((m) => m.id === protectId);
  return { out, evicted, protectedKept, reason: protectedKept ? null : (reason || "cap") };
};

export const saveMemories = async (arr, { protectId = null } = {}) => {
  const { out, evicted, protectedKept, reason } = pruneForSave(arr, protectId);
  await storage.set(MEMORIES_KEY, out);
  // F-167/F-170/F-171: EVERY write re-evaluates the marker against the same admission
  // rule that raises it — never against a proxy like the row count. A delete, an
  // archive, a shortened row or a merge clears it only if a lesson would now be kept.
  await refreshMemoryStoreFull(out);
  return { memories: out, evicted, protectedKept, reason };
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
 * @returns {{ id: string|null, merged: boolean, stored: boolean, evicted: string[], reason?: string, error?: string }}
 *   stored:false means nothing was written: reason "cap" = the item cap with no
 *   AUTO row left to evict (hand-authored rows are never evicted — F-160/F-161/F-164),
 *   reason "bytes" = the serialized-size guard.
 */
export const saveMemoryCandidate = async ({ content, source = "user", projectKey = null, confidence = 1.0, meta = null, createdBy = null } = {}) => {
  const clean = String(content || "").trim().substring(0, MEMORY_CONTENT_MAX);
  if (!clean) return { id: null, merged: false, stored: false, reason: "empty", evicted: [], error: "Memory content is required" };

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
      // Scope WIDENS on merge, never narrows: if the candidate's project differs from the
      // matched memory's (either is global, or two different projects), the fact has now been
      // seen beyond one project → promote it to GLOBAL so it injects everywhere. This fixes the
      // old scope-blind behavior where a global candidate could be narrowed into a project-scoped
      // memory (lost globally) and a project-B fact merged into a project-A memory never reached
      // project B. Same-project re-adds keep their scope. (null = broadest.)
      const candScope = projectKey || null;
      if ((m.projectKey || null) !== candScope) m.projectKey = null;
      // A DELIBERATE user re-add of an ARCHIVED (disabled) memory means the user wants it active
      // again — re-enable it. Otherwise the re-add is a silent no-op: dedup merges into the disabled
      // row but it stays hidden from injection (buildMemoryBlock filters disabled). An AUTO (test/fix)
      // reinforce does NOT resurrect an admin's archive — only an explicit user action does.
      if (m.disabled && source === "user") m.disabled = false;
      // F-171: a reinforce writes NO new row, so it is not evidence that the store has
      // room. saveMemories re-evaluates the marker; it clears only if a newcomer would fit.
      const mergedSave = await saveMemories(memories);
      return { id: m.id, merged: true, stored: true, evicted: mergedSave.evicted };
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
  // F-159: the new row is protected from its own prune. If the store is genuinely
  // full of rows that fit better AND the newcomer cannot fit the byte guard even
  // alone, nothing is written and the caller is told it was NOT stored — never a
  // success answer for an id that vanished in the same call.
  // Decide BEFORE writing: a rejected newcomer must leave the store untouched
  // (no collateral eviction for a row we are not going to keep).
  // F-160/F-164: a candidate is rejected outright rather than evicting a hand-authored
  // memory — for an auto candidate AND for a user one.
  const dryRun = pruneForSave(memories, id);
  if (!dryRun.protectedKept) {
    const reason = dryRun.reason || "cap";
    // F-167: refusing a lesson is the moment the instance STOPS LEARNING. It used to
    // be disclosed only by a console.warn in an unpolled queue task, so an instance
    // could discard months of novel captures while the tab showed 200 healthy rows.
    // One durable marker, surfaced by getMemorySettings/getKnowledgeCounts.
    await markMemoryStoreFull(reason, source);
    return {
      id: null, merged: false, stored: false, reason, evicted: [],
      error: reason === "bytes"
        ? "Memory store is full (size limit reached)"
        : "Memory store is full",
    };
  }
  const saved = await saveMemories(memories, { protectId: id });
  return { id, merged: false, stored: true, evicted: saved.evicted };
};

/*
 * The ONE user-facing refusal sentence (F-174) now lives in
 * src/shared/registry-limits.js as memoryCapRefusalMessage and is re-exported
 * at the top of this file, so importing it from here still works (F-175).
 *
 * NOTE for UI territory: static/_screenshot-harness/bridge.js (~:973) still
 * retypes a paraphrase of the "cap" sentence. It can now import the builder
 * from src/shared/registry-limits.js — that module is dependency-free and
 * frontend-importable, which this one is not.
 */

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
    // capBytes is a BYTE budget — measure UTF-8 bytes (multibyte CJK/emoji count as
    // 3-4B each), not UTF-16 char length, so the block can't overshoot the intended
    // prompt budget. utf8Len is the same helper the hard KVS guard uses.
    if (utf8Len(candidate) > capBytes) break;
    text = candidate;
    count++;
  }
  return { text, count };
};
