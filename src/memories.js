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
 *     disabled: boolean, meta?: { errorSig }, createdBy? }
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
  MEMORY_PLATFORM_MAX_SERIALIZED_BYTES,
  memoryCapRefusalMessage,
  memoryPlatformCapMessage,
  memoryWriteFaultMessage,
} from "./shared/registry-limits.js";

export {
  MAX_MEMORIES, MEMORY_CONTENT_MAX, MEMORY_MAX_SERIALIZED_BYTES,
  MEMORY_PLATFORM_MAX_SERIALIZED_BYTES, memoryCapRefusalMessage, memoryPlatformCapMessage,
  memoryWriteFaultMessage,
};

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
/**
 * Clamp a memory row's `meta` — the ONE home (F-185/F-191).
 *
 * `meta` arrives from the runtime (index.js's auto-capture) and from the async distill
 * task, and reached the stored row unclamped: a 4 000-character step name rode into the
 * single `pf_memories` value and counted against the byte guard as if it were a lesson.
 * Unknown keys are DROPPED rather than clamped — a meta key nothing reads is pure weight
 * in the store.
 *
 * F-191 applies that same rule to the keys this clamp used to exempt. Only `errorSig` has
 * a reader (the reinforce lookup in index.js — `memories.find(m => m.meta?.errorSig === …)`).
 * `ruleId` and `stepName` had NONE: no resolver, no prompt block, no column in any of the
 * four apps read them, and they cost up to 140 chars — ~420 B of CJK per auto-captured row,
 * ~84 KB across a 200-row store — inside the one value a byte guard is defending. They also
 * made the store-full probe heavier, so the banner went up earlier to protect metadata
 * nothing displays. They remain QUEUE PARAMS of the memory_distill task, where they are
 * read: `stepName` feeds the distill prompt and its dedup tokens, and both name the rule
 * and step in the "lesson NOT stored" warn. They are simply not stored on the row.
 * (Rows written before this keep their old keys until they are next rewritten; nothing
 * reads them, so nothing changes but their weight.)
 *
 * Limits are CHARACTER clamps (like MEMORY_CONTENT_MAX); the byte guard is what decides
 * whether the row fits, and the store-full probe below is built from the worst case of
 * exactly these numbers.
 */
export const META_LIMITS = { errorSig: 16 };
export const clampMemoryMeta = (meta) => {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const out = {};
  for (const [key, max] of Object.entries(META_LIMITS)) {
    const raw = meta[key];
    if (raw === undefined || raw === null || raw === "") continue;
    out[key] = String(raw).substring(0, max);
  }
  return Object.keys(out).length ? out : null;
};

const HYPOTHETICAL_PROBE_ID = "__memory_store_full_probe__";
/*
 * F-180 — the probe must be the WORST CASE a real newcomer can be, because the
 * guard it is probing counts UTF-8 BYTES while MEMORY_CONTENT_MAX is a CHARACTER
 * cap. An ASCII probe was ~400 B where a real maximum-length lesson in CJK or
 * emoji is 1200-1600 B, so the probe was byte-OPTIMISTIC: on a multibyte store
 * sitting just under the guard it answered "a lesson would fit",
 * refreshMemoryStoreFull cleared the marker, and the very next capture was
 * refused — the banner flapped with traffic while nothing was being learned.
 * (Measured at the time of filing: 168 rows of 400 CJK chars = 229 043 B cleared
 * the marker, and the next real newcomer was refused with reason "bytes".)
 *
 * The probe is MEMORY_CONTENT_MAX emoji — 1602 serialized bytes, i.e. the
 * MEMORY_CONTENT_MAX * 4 worst case — plus a representative `meta` (an
 * auto-captured row always carries an errorSig). That is deliberately
 * HEAVIER than any row that can actually be stored: `substring(0, MEMORY_CONTENT_MAX)`
 * clamps UTF-16 code units, so the true maximum is 400 CJK chars ~= 1200 B (an emoji
 * costs two code units, so only 200 of them survive the clamp). Erring heavy is the
 * safe direction — the worst it does is hold the banner up while a slightly smaller
 * lesson would still have fitted; erring light reinstates F-170, a green banner over
 * an instance that is silently discarding everything it learns.
 */
const PROBE_CONTENT = "\u{1F600}".repeat(MEMORY_CONTENT_MAX);
/*
 * F-185 — the probe's `meta` is the WORST CASE the meta clamp can produce, for the same
 * reason PROBE_CONTENT is: the guard counts UTF-8 bytes while META_LIMITS are character
 * clamps. Emoji at the full limit is deliberately heavier than any row that can actually
 * be stored (`substring` clamps UTF-16 code units, so a real maximum meta is ~3 B/char
 * CJK, e.g. 48 B for a 16-char errorSig, against 64 B here). Erring heavy holds the
 * banner up a little early; erring light is F-170 again — a green banner over an instance
 * that is silently discarding everything it learns.
 */
const PROBE_META = Object.fromEntries(
  Object.entries(META_LIMITS).map(([key, max]) => [key, "\u{1F600}".repeat(max)]),
);
/**
 * THE ADMISSION ANSWER — one function, used by the probe AND by the real save (F-198).
 *
 * "Would this array be admitted, and if not, WHICH ceiling is the caller against?"
 * `protectId` is the row being admitted (a real newcomer, or the hypothetical probe).
 *
 * F-198: the probe used to ask `pruneForSave` alone, which knows only the 230 000 B
 * admission guard — while merges, edits and deletes are refused by saveMemories at the
 * 245 760 B PLATFORM ceiling. On a store that had walked past the platform limit the two
 * disagreed about the WHY: the marker said "bytes", whose remedy is "shorten or delete a
 * memory", on a store where deleting ONE memory still writes an oversized array and is
 * refused as well. The remedy there is a BULK delete, and the reason code that carries it
 * is "platform-cap" — so the reason is decided HERE, by the same function both paths use,
 * and no surface has to infer it from a byte count of its own.
 *
 * Order matters: `pruneForSave` already clamps its output to the 230 000 B guard, so a
 * KEPT row can never be over the platform ceiling — the platform question is only asked
 * on the refusal path, about the stored array as it stands.
 *
 * @returns {{ refused: boolean, reason: "cap"|"bytes"|"platform-cap"|null, bytesOver: number }}
 */
export const memoryAdmission = (arr, protectId = null) => {
  const list = Array.isArray(arr) ? arr : [];
  const dry = pruneForSave(list, protectId);
  if (dry.protectedKept) return { refused: false, reason: null, bytesOver: 0 };
  // The stored array WITHOUT the row we were trying to admit — that is what KVS holds,
  // and what every other write (a delete, an archive, a reinforce) has to write back.
  const stored = protectId ? list.filter((m) => m.id !== protectId) : list;
  const overPlatform = serializedBytes(stored) - MEMORY_PLATFORM_MAX_SERIALIZED_BYTES;
  if (overPlatform > 0) return { refused: true, reason: "platform-cap", bytesOver: overPlatform };
  return { refused: true, reason: dry.reason || "cap", bytesOver: 0 };
};

/** The hypothetical newcomer the probe admits — worst case content AND meta. */
const hypotheticalProbeRow = () => {
  const now = new Date().toISOString();
  return {
    id: HYPOTHETICAL_PROBE_ID,
    content: PROBE_CONTENT,
    source: "test",
    projectKey: null,
    confidence: 0.5,
    reinforcements: 0,
    createdAt: now,
    updatedAt: now,
    disabled: false,
    meta: PROBE_META,
  };
};

/**
 * WHY a novel lesson would be refused right now — "cap", "bytes", "platform-cap", or
 * null when the instance is still learning. This is the reason the store-full marker
 * carries, so the banner's remedy matches the refusal the next capture will actually hit.
 */
export const memoryStoreFullReason = (arr) => memoryAdmission(
  [hypotheticalProbeRow(), ...(Array.isArray(arr) ? arr : [])],
  HYPOTHETICAL_PROBE_ID,
).reason;

export const wouldRefuseNewMemory = (arr) => memoryStoreFullReason(arr) !== null;

/**
 * Re-evaluate the marker after a write. Clears it when the store can accept a lesson
 * again; when it is still full the EXISTING row is left untouched (its `at`/`reason`/
 * `source` belong to the real refusal that raised it). Never raises — only a genuine
 * refusal in saveMemoryCandidate does that. Best-effort: never fails a caller's answer.
 *
 * F-198: "still full" is `memoryStoreFullReason`, which is `memoryAdmission` — the same
 * answer the write path acts on, platform ceiling included. A store between the guard and
 * the platform limit clears only when a lesson would be kept; a store OVER the platform
 * limit cannot be written to at all, so no write reaches here until a bulk delete brings
 * it back under, which is exactly when the marker goes.
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

/**
 * Read the store, SAYING whether the read faulted (F-188).
 *
 * `loadMemories` is deliberately fail-OPEN: a KVS blip must never take a prompt block
 * or a resolver down, so it logs and answers `[]`. That is right for a READER and wrong
 * for anything that makes a WRITE DECISION by comparing "what is stored" with "what we
 * are about to store": with `[]` standing in for an unread store, `prior` is 2 bytes and
 * every row looks brand-new, so saveMemories classified an ordinary delete as a store
 * full of insertions and refused it. This variant is for the write path; every read-only
 * caller keeps `loadMemories` and its fail-open behaviour.
 */
export const loadMemoriesResult = async () => {
  try {
    const stored = await storage.get(MEMORIES_KEY);
    return { memories: Array.isArray(stored) ? stored : [], faulted: false };
  } catch (error) {
    console.error("Failed to load memories:", error);
    return { memories: [], faulted: true };
  }
};

export const loadMemories = async () => (await loadMemoriesResult()).memories;

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
 * byte-identical, and the human DELETES in the Memories tab — which is what
 * memoryCapRefusalMessage actually says ("delete some in the Memories tab to make room").
 * F-194: this docblock still claimed the sentence said "prune". No control in this app
 * prunes anything, the builder has not used the word since F-174, and the scan added to
 * keep it retired walked only static/ — so the BACKEND copy, sitting on the function that
 * owns the policy, was the one place a maintainer could still copy it from. The ONE
 * exception is the byte guard with nothing left but the
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
  // F-178: eviction exists to make room for a NEWCOMER. With no protected row there is
  // no newcomer, so there is nothing to make room FOR — an edit, a delete, an archive or
  // a reinforce must never cost another row its life. (Before this, an edit on an
  // over-size store evicted, often FUTILELY: the loop breaks as soon as pruneOne reports
  // `blocked`, so it destroyed a row, stayed over the guard, and wrote the oversized value
  // anyway while updateMemory answered success and dropped `evicted` on the floor.)
  if (protectId) {
    while (out.length > MAX_MEMORIES) { if (step("cap")) break; }
    while (out.length > 0 && utf8Len(JSON.stringify(out)) >= MEMORY_MAX_SERIALIZED_BYTES) { if (step("bytes")) break; }
  }
  const protectedKept = !protectId || out.some((m) => m.id === protectId);
  return { out, evicted, protectedKept, reason: protectedKept ? null : (reason || "cap") };
};

/**
 * What the store currently WEIGHS, against both ceilings (F-189). Pure — the resolver
 * reads the array and calls this, so no surface has to retype either number or work out
 * the deficit for itself.
 */
export const memoryStoreStats = (arr) => {
  const bytes = serializedBytes(arr);
  return {
    rows: Array.isArray(arr) ? arr.length : 0,
    bytes,
    guardBytes: MEMORY_MAX_SERIALIZED_BYTES,
    platformBytes: MEMORY_PLATFORM_MAX_SERIALIZED_BYTES,
    overGuard: bytes >= MEMORY_MAX_SERIALIZED_BYTES,
    overPlatform: bytes > MEMORY_PLATFORM_MAX_SERIALIZED_BYTES,
    bytesOverPlatform: Math.max(0, bytes - MEMORY_PLATFORM_MAX_SERIALIZED_BYTES),
  };
};

/** Serialized UTF-8 size of a memory array — the quantity the byte guard measures. */
export const serializedBytes = (arr) => utf8Len(JSON.stringify(Array.isArray(arr) ? arr : []));

/**
 * Write the store — and the ONE home of the serialized-byte ceiling (F-183/F-184).
 *
 * `protectId` — a just-inserted newcomer: the prune runs and may evict (non-archived
 * AUTO rows only, see pruneOne) and, as a last resort, drops the newcomer itself.
 *
 * No `protectId` (an edit / delete / archive / reinforce / merge) — F-178: NOTHING is
 * evicted. The byte ceiling is nevertheless enforced HERE, on EVERY write, because this
 * is the only place every write passes through. F-183: three writes reached KVS with no
 * guard at all (the distill `mergeWithId` merge, the dedup reinforce, the runtime
 * error-signature reinforce); each of them can REPLACE a row's text with model-emitted
 * content, so an instance parked just under the guard walked the value up to the 245 760 B
 * platform cap, at which point KVS rejects the write outright. MEASURED on the pre-fix
 * module (test-harness/scripts/memory-byte-guard.test.mjs, whose mock now enforces the real
 * platform limit): starting 400 B under the guard, the 76th full-length merge is REJECTED BY
 * KVS at 245 831 B — the byte figure is what was measured; the platform's error CODE for it is
 * not (F-193), so nothing here may be gated on one — and from there every write that does not SHRINK the store
 * fails the same way — the reinforce path itself can no longer record anything, and an
 * addMemory or a growing edit only ever returns an error. (F-189 CORRECTS what stood here:
 * "a delete still gets through" is true only BELOW the platform cap. On a store already over
 * it, the one-row delete writes an array that is still oversized and is rejected too — which
 * is why the platform ceiling is now checked before the write, answered as a refusal naming
 * the deficit, and why deleteMemory takes a LIST of ids so enough rows can go in one write.)
 *
 * The rule, in order:
 *  - Under the guard → write, whatever the caller is doing.
 *  - At/over the guard but NOT growing (a delete, an archive, a shortened row) → write.
 *    Shrinking is the only repair an admin has short of deleting, and a delete must
 *    never be the write that throws.
 *  - At/over the guard AND growing — only CONTENT growth is the problem:
 *      · default path (merge/reinforce, unsupervised): the longer text is DROPPED and
 *        the OLD stored text kept, while the reinforcement counter and the `updatedAt`
 *        stamp survive. Refusing outright would lose the reinforcement; accepting grew
 *        the value past the platform cap.
 *      · `refuseIfOverBytes: true` (updateMemory — a human editing one row): the edit is
 *        REFUSED, `{ refused: true, reason: "bytes" }`, store untouched. Silently keeping
 *        the old text under a "saved" toast would lie to the person who typed the new one.
 *  - METADATA-only edits (`disabled` toggles, a `projectKey` clear) are ALWAYS allowed,
 *    over the guard or not. F-184: the previous docblock claimed an `updatedAt` re-stamp
 *    costs "+4 bytes" — measured, it costs exactly 0 (a fixed-length ISO stamp), and the
 *    real deltas are Archive (`"disabled":false` → `true`) −1 B and Restore +1 B. That
 *    asymmetry built a ONE-WAY DOOR on an over-guard store: Archive succeeded and Restore
 *    was refused. Metadata edits cannot materially grow the store, so they never refuse.
 *
 * `priorBytes` is an optimisation only: when the caller already measured the store it is
 * used, otherwise the stored value is re-read (once, and only when over the guard).
 */
export const saveMemories = async (arr, { protectId = null, refuseIfOverBytes = false, priorBytes = null } = {}) => {
  const { out: pruned, evicted, protectedKept, reason } = pruneForSave(arr, protectId);
  let out = pruned;
  if (!protectId && serializedBytes(out) >= MEMORY_MAX_SERIALIZED_BYTES) {
    const read = await loadMemoriesResult();
    const stored = read.memories;
    // F-188: a FAULTED read is not an empty store. Comparing against the 2 bytes of `[]`
    // makes every row look like an insertion, which turned a delete — the one repair an
    // admin has — into a `{ refused: true, reason: "bytes" }` that the resolver then
    // reported as success. With no trustworthy prior there is nothing to compare, so the
    // growth analysis is SKIPPED and the write goes ahead as a plain write of known size;
    // the platform ceiling below still refuses anything KVS would reject outright.
    if (read.faulted) {
      console.warn(`memories: could not read the stored value to classify this ${out.length}-row write (${serializedBytes(out)}B) — the byte-growth check is skipped for it`);
    } else {
      const prior = priorBytes === null || priorBytes === undefined ? serializedBytes(stored) : priorBytes;
      if (serializedBytes(out) > prior) {
        // Growing an already-over-guard store. Isolate the CONTENT growth: any row whose
        // text got longer than the text currently in KVS.
        const byId = new Map(stored.map((m) => [m.id, m]));
        const grew = [];
        const repaired = out.map((m) => {
          const old = byId.get(m.id);
          if (!old || old.content === m.content) return m;
          if (utf8Len(String(m.content ?? "")) <= utf8Len(String(old.content ?? ""))) return m;
          grew.push(m.id);
          return { ...m, content: old.content };
        });
        if (grew.length && refuseIfOverBytes) return { memories: null, refused: true, reason: "bytes", evicted: [] };
        if (grew.length) {
          console.warn(`memories: at the ${MEMORY_MAX_SERIALIZED_BYTES}B guard — kept the stored text for ${grew.length} row(s) (${grew.join(", ")}); the reinforcement was still recorded`);
          out = repaired;
        }
        // Growth that the revert cannot undo — rows this save ADDS. There is no old text to
        // fall back to, so the write is refused outright rather than handed to KVS, which
        // rejects anything over 245 760 B anyway (and leaves the caller with an exception
        // instead of an answer).
        if (out.some((m) => !byId.has(m.id)) && serializedBytes(out) > prior) {
          return { memories: null, refused: true, reason: "bytes", evicted: [] };
        }
        // Whatever delta is left is metadata (F-184) — always allowed.
      }
    }
  }
  /*
   * F-189 — the PLATFORM ceiling, which is not our guard.
   *
   * Every write above this line was decided against MEMORY_MAX_SERIALIZED_BYTES, the
   * guard with a safety margin. A store can nevertheless already be OVER the 245 760 B
   * platform limit: any instance that ran the pre-F-183 merge/reinforce path walked its
   * value past it, and for those the F-183 docblock's "a delete still gets through" is
   * simply false — a delete SHRINKS, so it skips the guard branch entirely, and then KVS
   * rejects the still-oversized array and the resolver hands the admin a raw platform
   * byte string. Measured on 198 hand-authored 400-char CJK rows (275 111 B): the
   * one-row delete write was 273 723 B and threw.
   *
   * So the size is checked HERE, before the write, and answered as a refusal that names
   * the deficit — the admin needs to know it must delete in BULK (deleteMemory takes
   * `ids`), not one row at a time. The write is still wrapped: the code the platform
   * returns for an oversize value is not something this repo has measured (F-193), so
   * nothing is gated on it — any throw from the write becomes the same refusal, with the
   * size we measured ourselves.
   */
  const outBytes = serializedBytes(out);
  if (outBytes > MEMORY_PLATFORM_MAX_SERIALIZED_BYTES) {
    const bytesOver = outBytes - MEMORY_PLATFORM_MAX_SERIALIZED_BYTES;
    console.warn(`memories: refusing a ${outBytes}B write — ${bytesOver}B over the ${MEMORY_PLATFORM_MAX_SERIALIZED_BYTES}B platform limit; the store needs a bulk delete`);
    return { memories: null, refused: true, reason: "platform-cap", bytesOver, evicted: [] };
  }
  try {
    await storage.set(MEMORIES_KEY, out);
  } catch (error) {
    /*
     * F-197 — a throw HERE is not the platform cap, and must not be dressed as one.
     *
     * The size was measured against MEMORY_PLATFORM_MAX_SERIALIZED_BYTES immediately
     * above and this write PASSED that check, so `outBytes` is at or under the ceiling
     * by our own measurement. The previous code mapped every throw to
     * reason "platform-cap" with `bytesOver = Math.max(1, outBytes - ceiling)` — a
     * number that, on a passing pre-check, is always the fabricated floor of 1, so a
     * transient KVS fault on a 1.4 KB write told the admin the store was "1 byte over
     * Jira's 245760-byte storage limit" and to bulk-delete memories. That is advice for
     * a problem the store does not have, and it hides the real one: the write faulted
     * and should be retried.
     *
     * "platform-cap" is therefore reported in exactly ONE place — the pre-measurement
     * above, which owns the deficit number. Anything the platform throws after a
     * passing pre-check is a "write-fault": the error's own message, and NO byte
     * number, because we do not have one that means anything.
     */
    console.error(`Failed to write the memory store (${outBytes}B):`, error);
    return {
      memories: null, refused: true, reason: "write-fault",
      error: String(error?.message || error), evicted: [],
    };
  }
  // F-167/F-170/F-171: EVERY write re-evaluates the marker against the same admission
  // rule that raises it — never against a proxy like the row count. A delete, an
  // archive, a shortened row or a merge clears it only if a lesson would now be kept.
  await refreshMemoryStoreFull(out);
  return { memories: out, evicted, protectedKept, reason, refused: false };
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
 * @returns {{ id: string|null, merged: boolean, stored: boolean, evicted: string[], reason?: string, bytesOver?: number, error?: string }}
 *   stored:false means nothing was written: reason "cap" = the item cap with no
 *   AUTO row left to evict (hand-authored rows are never evicted — F-160/F-161/F-164),
 *   reason "bytes" = the serialized-size guard, reason "platform-cap" = the store is
 *   already over Jira's own value limit (`bytesOver` says by how much), reason
 *   "write-fault" = KVS threw on a write our measurement said would fit (F-197).
 *   F-196: `stored` is derived from what saveMemories ANSWERED, on BOTH arms — a merge
 *   that could not be written comes back `{ merged: true, stored: false }` with a real
 *   id, a refused new row comes back `{ id: null, stored: false }`, and no caller is
 *   ever handed an id for a row that was not persisted.
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
      // F-196: a refusal is a write that DID NOT HAPPEN. The reinforcement, the widened
      // scope and the un-archive above live only in the in-memory array; reporting
      // `stored: true` for them told every caller the lesson had been recorded when the
      // store still holds the old row. `merged` stays true — the candidate WAS matched to
      // an existing memory, so there is a real id to name — but `stored` is false and the
      // reason (and any deficit) rides along for the caller's sentence.
      if (mergedSave.refused) {
        return {
          id: m.id, merged: true, stored: false, reason: mergedSave.reason || "bytes",
          ...(mergedSave.bytesOver === undefined ? {} : { bytesOver: mergedSave.bytesOver }),
          evicted: [], error: mergedSave.error || undefined,
        };
      }
      return { id: m.id, merged: true, stored: true, evicted: mergedSave.evicted || [] };
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
  // F-185: meta is clamped HERE, at the store, so every caller (runtime auto-capture,
  // the async distill task) gets the same ceiling without retyping it.
  const cleanMeta = clampMemoryMeta(meta);
  if (cleanMeta) entry.meta = cleanMeta;
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
  // F-198: the same admission function the probe asks, so the reason the refusal reports
  // and the reason the marker carries can never disagree.
  const dryRun = memoryAdmission(memories, id);
  if (dryRun.refused) {
    const reason = dryRun.reason;
    // F-167: refusing a lesson is the moment the instance STOPS LEARNING. It used to
    // be disclosed only by a console.warn in an unpolled queue task, so an instance
    // could discard months of novel captures while the tab showed 200 healthy rows.
    // One durable marker, surfaced by getMemorySettings/getKnowledgeCounts.
    await markMemoryStoreFull(reason, source);
    return {
      id: null, merged: false, stored: false, reason, evicted: [],
      ...(reason === "platform-cap" ? { bytesOver: dryRun.bytesOver } : {}),
      error: reason === "platform-cap"
        ? memoryPlatformCapMessage(dryRun.bytesOver)
        : (reason === "bytes"
          ? "Memory store is full (size limit reached)"
          : "Memory store is full"),
    };
  }
  const saved = await saveMemories(memories, { protectId: id });
  // F-196: same rule for the new row — `stored: true` used to be hard-coded here, so a
  // write the store refused (platform cap) or the platform faulted on was answered with
  // an id that exists NOWHERE, and addMemory reported "Memory saved" for it. The id is
  // dropped with the write it belonged to.
  if (saved.refused) {
    return {
      id: null, merged: false, stored: false, reason: saved.reason || "bytes",
      ...(saved.bytesOver === undefined ? {} : { bytesOver: saved.bytesOver }),
      evicted: [], error: saved.error || undefined,
    };
  }
  return { id, merged: false, stored: true, evicted: saved.evicted || [] };
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
