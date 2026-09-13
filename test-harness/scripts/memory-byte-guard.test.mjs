/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Offline unit test for the memory SERIALIZED-BYTE CEILING and the meta clamp (src/memories.js)
// via the mock @forge/kvs (which now enforces the real 240 KiB platform value limit).
// Run: node --import ./lib/register-mocks.mjs scripts/memory-byte-guard.test.mjs
//
// F-183 — the merge/reinforce writes (distill `mergeWithId`, the dedup reinforce, the runtime
//   error-signature reinforce) called saveMemories(all) with no protectId, and F-178's
//   `if (protectId)` gate had removed the byte guard from that path: model-emitted merges grew
//   the single `pf_memories` value up to the platform cap, at which point KVS rejects it: measured
//   on the pre-fix module, the 76th full-length merge is REJECTED at 245 831 B and no growing write
//   ever succeeds again. (F-193: the 245 831 B is measured; the platform's error CODE is not —
//   the mock emits a ForgeKvsAPIError-shaped throw, see lib/mock-kvs.mjs.)
// F-184 — metadata-only edits (archive/restore, project clear) must never be refused by the byte
//   guard. Archive (-1 B) succeeded while Restore (+1 B) was refused: a one-way door.
// F-185 — `meta` reached the stored row unclamped from the runtime and the distill task; it is
//   clamped at the store, unknown keys dropped, and the store-full probe carries the worst case
//   of those clamps.
// F-191 — `meta.stepName` / `meta.ruleId` had zero readers in src/ and static/, so they are no
//   longer stored on the row (they stay memory_distill task params, which ARE read).
import storage from "../lib/mock-kvs.mjs";
import {
  saveMemories, saveMemoryCandidate, serializedBytes, clampMemoryMeta, META_LIMITS,
  wouldRefuseNewMemory, loadMemories, MEMORIES_KEY, MEMORY_MAX_SERIALIZED_BYTES, MEMORY_CONTENT_MAX,
} from "../../src/memories.js";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };
const load = () => storage.__raw(MEMORIES_KEY) || [];
const KVS_PLATFORM_CAP = 245760;

const row = (i, content, extra = {}) => ({
  id: `m${i}`, content, source: "user", projectKey: null, confidence: 1, reinforcements: 0,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", disabled: false, ...extra,
});

// Build a store of hand-authored (never evictable) CJK rows whose serialized size lands as close
// as possible to `targetBytes` from below.
const buildStore = (targetBytes, rowChars = MEMORY_CONTENT_MAX) => {
  const rows = [];
  for (let i = 0; i < 198; i++) rows.push(row(i, "漢".repeat(rowChars)));
  while (serializedBytes(rows) > targetBytes) rows.pop();
  // fine-tune with one ASCII filler row
  let filler = row("fill", "");
  rows.push(filler);
  while (serializedBytes(rows) < targetBytes) filler.content += "x";
  if (serializedBytes(rows) > targetBytes) filler.content = filler.content.slice(0, -1);
  return rows;
};

// ---------------------------------------------------------------------------
// F-183: 20 model-emitted merges from just under the guard never cross it, and
// a delete still works afterwards.
// ---------------------------------------------------------------------------
storage.__reset();
const MERGE_CHARS = 350;
const startBytes = MEMORY_MAX_SERIALIZED_BYTES - 400;
storage.__seed(MEMORIES_KEY, buildStore(startBytes, 320));
ok(serializedBytes(load()) < MEMORY_MAX_SERIALIZED_BYTES
  && serializedBytes(load()) > MEMORY_MAX_SERIALIZED_BYTES - 600, "store seeded just under the byte guard");

let mergeWriteThrew = null;
let appliedMerges = 0, repairedMerges = 0;
for (let i = 0; i < 20; i++) {
  // Exactly what async-handler's `mergeWithId` branch does: replace the row text with the
  // model's (longer) distilled lesson and bump the reinforcement counter, then saveMemories(all).
  const all = await loadMemories();
  const target = all[i];
  const before = target.content;
  target.reinforcements = (target.reinforcements || 0) + 1;
  target.content = "漢".repeat(MERGE_CHARS); // a full-length distilled lesson in CJK — GROWS the row
  target.updatedAt = new Date().toISOString();
  try {
    await saveMemories(all);
  } catch (error) { mergeWriteThrew = error; break; }
  if (load()[i].content === before) repairedMerges++; else appliedMerges++;
  ok(load()[i].reinforcements === 1, `merge ${i + 1}: the reinforcement was recorded`);
  ok(serializedBytes(load()) < KVS_PLATFORM_CAP, `merge ${i + 1}: store stays under the KVS platform cap`);
}
ok(mergeWriteThrew === null, `20 merges wrote without a KVS value-size rejection (${mergeWriteThrew?.message || "none"})`);
ok(serializedBytes(load()) < KVS_PLATFORM_CAP, "after 20 merges the store is still writable (under the platform cap)");
ok(appliedMerges > 0, `the merges that still fitted were applied in full (${appliedMerges})`);
ok(repairedMerges > 0, `the merges that would have crossed the guard kept the OLD text (${repairedMerges})`);
ok(load().filter((m) => m.reinforcements > 0).length === 20, "all 20 reinforcement counters survived, merged text dropped or not");
ok(serializedBytes(load()) < MEMORY_MAX_SERIALIZED_BYTES + 1200, "the store never ran away past the guard");

// ...and the runaway that F-183 actually produced: merging EVERY row to full length. Without the
// ceiling this walks the single `pf_memories` value up to the 240 KiB platform cap (measured on the
// pre-fix module: rejected at merge 76, 245 831 B) and no growing write works again.
let runawayThrew = null;
for (let i = 0; i < 198 && !runawayThrew; i++) {
  const all = await loadMemories();
  if (!all[i]) break;
  all[i].content = "漢".repeat(MEMORY_CONTENT_MAX);
  all[i].reinforcements = (all[i].reinforcements || 0) + 1;
  try { await saveMemories(all); } catch (error) { runawayThrew = error; }
}
ok(runawayThrew === null, `merging every row to full length never throws (${runawayThrew?.code || "no throw"})`);
ok(serializedBytes(load()) < KVS_PLATFORM_CAP, `the store is still under the platform cap after a full-store merge sweep (${serializedBytes(load())} B)`);

// the delete that repairs an over-full store must still work
const beforeDelete = load().length;
const afterDelete = load().filter((m) => m.id !== "m0");
let deleteThrew = null;
try { await saveMemories(afterDelete); } catch (error) { deleteThrew = error; }
ok(deleteThrew === null && load().length === beforeDelete - 1, "a delete still works after the merges (F-183's terminal symptom)");

// a merge that GROWS an over-guard store keeps the OLD text but records the reinforcement
storage.__reset();
storage.__seed(MEMORIES_KEY, buildStore(MEMORY_MAX_SERIALIZED_BYTES + 200));
const over = await loadMemories();
const oldText = over[0].content;
over[0].content = `${oldText}${"漢".repeat(50)}`;
over[0].reinforcements = 7;
await saveMemories(over);
ok(load()[0].content === oldText, "over the guard: the merged (longer) text is dropped, the stored text is kept");
ok(load()[0].reinforcements === 7, "over the guard: the reinforcement counter is still recorded");

// ---------------------------------------------------------------------------
// F-184: metadata-only edits are ALWAYS allowed; only content growth is refused.
// ---------------------------------------------------------------------------
storage.__reset();
storage.__seed(MEMORIES_KEY, buildStore(MEMORY_MAX_SERIALIZED_BYTES + 500));
ok(serializedBytes(load()) >= MEMORY_MAX_SERIALIZED_BYTES, "store seeded OVER the byte guard");

const editWith = async (mutate) => {
  const all = await loadMemories();
  const priorBytes = serializedBytes(all);
  mutate(all[0]);
  all[0].updatedAt = new Date().toISOString();
  return saveMemories(all, { refuseIfOverBytes: true, priorBytes });
};

// the measured cost of an updatedAt re-stamp is ZERO (fixed-length ISO), not "+4 bytes"
const stampProbe = await loadMemories();
const stampBefore = serializedBytes(stampProbe);
stampProbe[0].updatedAt = new Date().toISOString();
ok(serializedBytes(stampProbe) - stampBefore === 0, "an updatedAt re-stamp costs exactly 0 bytes (the docblock said +4)");

const archived = await editWith((m) => { m.disabled = true; });
ok(archived.refused !== true && load()[0].disabled === true, "ARCHIVE (metadata only) is allowed on an over-guard store");
const restored = await editWith((m) => { m.disabled = false; });
ok(restored.refused !== true && load()[0].disabled === false, "RESTORE (metadata only, +1 byte) is allowed too — the one-way door is closed");
const scoped = await editWith((m) => { m.projectKey = null; });
ok(scoped.refused !== true, "a projectKey clear is allowed on an over-guard store");

const textBefore = load()[0].content;
const grown = await editWith((m) => { m.content = `${m.content}MORE`.substring(0, MEMORY_CONTENT_MAX + 4); });
ok(grown.refused === true && grown.reason === "bytes", "CONTENT growth on an over-guard store is refused");
ok(load()[0].content === textBefore, "the refused content edit left the store untouched");
const shrunk = await editWith((m) => { m.content = m.content.substring(0, 100); });
ok(shrunk.refused !== true && load()[0].content.length === 100, "CONTENT shrink is allowed — the recovery path out of an over-size store");

// ---------------------------------------------------------------------------
// F-185: meta is clamped at the store; unknown keys are dropped.
// F-191: `ruleId`/`stepName` ARE unknown keys now — they had no reader anywhere in src/ or
// static/, so they are not stored at all (they remain memory_distill task params).
// ---------------------------------------------------------------------------
storage.__reset();
storage.__seed(MEMORIES_KEY, []);
const withMeta = await saveMemoryCandidate({
  content: "the Rollback field is a select, not text",
  source: "test",
  confidence: 0.6,
  meta: {
    errorSig: "a".repeat(50), ruleId: "b".repeat(500), stepName: "c".repeat(4000),
    payload: "z".repeat(5000), nested: { big: "y".repeat(5000) },
  },
});
ok(withMeta.stored === true, "the metered candidate stored");
const meta = load()[0].meta;
ok(meta.errorSig.length === META_LIMITS.errorSig, `meta.errorSig clamped to ${META_LIMITS.errorSig} chars`);
ok(!("stepName" in meta) && !("ruleId" in meta),
  `F-191: an unread meta key is not stored at all (got ${JSON.stringify(Object.keys(meta))})`);
ok(!("payload" in meta) && !("nested" in meta), "unknown meta keys are dropped, not clamped");
ok(Object.keys(META_LIMITS).length === 1 && META_LIMITS.errorSig,
  "errorSig — the one meta key with a reader — is the whole clamp");
ok(clampMemoryMeta(null) === null && clampMemoryMeta({}) === null && clampMemoryMeta("x") === null,
  "clampMemoryMeta returns null for absent/empty/non-object meta");

// the store-full probe COUNTS the meta: a store with room for the probe's content but not for
// content + worst-case meta must still answer "a lesson would be refused".
const probeContentBytes = new TextEncoder().encode(JSON.stringify("\u{1F600}".repeat(MEMORY_CONTENT_MAX))).length;
const tight = buildStore(MEMORY_MAX_SERIALIZED_BYTES - probeContentBytes - 300);
ok(wouldRefuseNewMemory(tight) === true,
  "the store-full probe includes its worst-case meta (a content-only probe would have fitted)");
ok(wouldRefuseNewMemory([]) === false, "an empty store accepts a lesson");

console.log(`\nmemory-byte-guard: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
