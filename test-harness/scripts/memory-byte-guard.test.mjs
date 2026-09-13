/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Offline unit test for the memory SERIALIZED-BYTE CEILING (src/memories.js)
// via the mock @forge/kvs (which now enforces the real 240 KiB platform value limit).
// Run: node --import ./lib/register-mocks.mjs scripts/memory-byte-guard.test.mjs
//
// F-183 — the merge/reinforce writes (distill `mergeWithId`, the dedup reinforce, the runtime
//   error-signature reinforce) called saveMemories(all) with no protectId, and F-178's
//   `if (protectId)` gate had removed the byte guard from that path: model-emitted merges grew
//   the single `pf_memories` value up to the platform cap, at which point KVS rejects it: measured
//   on the pre-fix module, the 76th full-length merge throws VALUE_TOO_LARGE at 245 831 B and no
//   growing write ever succeeds again.
import storage from "../lib/mock-kvs.mjs";
import {
  saveMemories, serializedBytes, loadMemories,
  MEMORIES_KEY, MEMORY_MAX_SERIALIZED_BYTES, MEMORY_CONTENT_MAX,
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
ok(mergeWriteThrew === null, `20 merges wrote without a KVS VALUE_TOO_LARGE throw (${mergeWriteThrew?.message || "none"})`);
ok(serializedBytes(load()) < KVS_PLATFORM_CAP, "after 20 merges the store is still writable (under the platform cap)");
ok(appliedMerges > 0, `the merges that still fitted were applied in full (${appliedMerges})`);
ok(repairedMerges > 0, `the merges that would have crossed the guard kept the OLD text (${repairedMerges})`);
ok(load().filter((m) => m.reinforcements > 0).length === 20, "all 20 reinforcement counters survived, merged text dropped or not");
ok(serializedBytes(load()) < MEMORY_MAX_SERIALIZED_BYTES + 1200, "the store never ran away past the guard");

// ...and the runaway that F-183 actually produced: merging EVERY row to full length. Without the
// ceiling this walks the single `pf_memories` value up to the 240 KiB platform cap (measured on the
// pre-fix module: throws VALUE_TOO_LARGE at merge 76, 245 831 B) and no growing write works again.
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

console.log(`\nmemory-byte-guard: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
