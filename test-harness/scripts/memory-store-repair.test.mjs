/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Offline unit test for REPAIRING a memory store that is at or over its limits, driven through
// the real resolvers in src/index.js with the mock @forge/kvs (which enforces the real 240 KiB
// platform value limit).
//
// F-188 — a DELETE THAT WROTE NOTHING WAS REPORTED AS SUCCESS. `loadMemories` is fail-open
//   (a KVS read fault logs and answers `[]`), and saveMemories used that answer as the PRIOR
//   for its byte-growth decision: with a 2-byte prior every stored row looks like an insertion,
//   so the "rows this save ADDS" arm refused the write — and `deleteMemory` never inspected the
//   return value, so the admin was told the delete worked. Two halves: the write path must not
//   treat a faulted read as an empty store, and every resolver must honour `{ refused: true }`.
// F-189 — a store already OVER the 240 KiB platform cap (legacy 1.2.0 instances) could not be
//   repaired at all: a single-row delete still writes an oversized array and KVS rejects it, and
//   the admin got a raw platform byte string. The write is now refused BEFORE it is handed to
//   KVS, with reason "platform-cap" and the deficit in bytes; deleteMemory takes a LIST so enough
//   rows can go in one write; getMemoryStoreStats reports the size against both ceilings.
// F-193 — the mock's oversize throw mirrors @forge/kvs's real ForgeKvsAPIError shape instead of
//   inventing a name and a code that the platform never emits.
import "../lib/register-mocks-index.mjs";
import storage, { KVS_PLATFORM_MAX_VALUE_BYTES, KVS_STORAGE_LIMIT_CODE } from "../lib/mock-kvs.mjs";
import { readFileSync } from "node:fs";
import {
  MEMORIES_KEY, MEMORY_MAX_SERIALIZED_BYTES, MEMORY_PLATFORM_MAX_SERIALIZED_BYTES,
  MEMORY_CONTENT_MAX, serializedBytes, memoryStoreStats, saveMemories,
  memoryWriteFaultMessage, memoryPlatformCapMessage,
} from "../../src/memories.js";
const { handler } = await import("../../src/index.js");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const ADMIN = "acct-admin";
const load = () => storage.__raw(MEMORIES_KEY) || [];
const call = (functionKey, payload = {}, accountId = ADMIN) =>
  handler({ call: { functionKey, payload } }, { principal: { accountId } });

const row = (i, content, extra = {}) => ({
  id: `m${i}`, content, source: "user", projectKey: null, confidence: 1, reinforcements: 0,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", disabled: false, ...extra,
});

// A store of hand-authored (never evictable) CJK rows sized as close to `targetBytes` as possible.
const buildStore = (targetBytes, rowChars = MEMORY_CONTENT_MAX) => {
  const rows = [];
  for (let i = 0; i < 198; i++) rows.push(row(i, "漢".repeat(rowChars)));
  while (serializedBytes(rows) > targetBytes) rows.pop();
  const filler = row("fill", "");
  rows.push(filler);
  while (serializedBytes(rows) < targetBytes) filler.content += "x";
  if (serializedBytes(rows) > targetBytes) filler.content = filler.content.slice(0, -1);
  return rows;
};

const reset = (seed) => {
  storage.__reset();
  storage.__seed("app_admins", [{ accountId: ADMIN, displayName: "Admin", role: "admin", scope: "all" }]);
  storage.__seed(MEMORIES_KEY, seed);
};

// Fault the Nth read of `pf_memories` only — the resolver's own load must still succeed, or the
// test would prove nothing but "Memory not found".
const realGet = storage.get.bind(storage);
const faultNthMemoryRead = (n) => {
  let seen = 0;
  storage.get = async (key) => {
    if (key === MEMORIES_KEY && ++seen === n) {
      const e = new Error("simulated transient KVS read failure");
      e.code = "INTERNAL_SERVER_ERROR";
      throw e;
    }
    return realGet(key);
  };
  return () => { storage.get = realGet; };
};

// ---------------------------------------------------------------------------
// F-188 (a) — a delete on an over-guard store whose PRIOR READ faults still writes.
// ---------------------------------------------------------------------------
{
  const store = buildStore(MEMORY_MAX_SERIALIZED_BYTES + 3000);
  ok(serializedBytes(store) >= MEMORY_MAX_SERIALIZED_BYTES,
    `the seeded store is over the ${MEMORY_MAX_SERIALIZED_BYTES}B guard (${serializedBytes(store)}B)`);

  // control: no fault — the delete works and shrinks the store.
  reset(store);
  const before = load().length;
  const clean = await call("deleteMemory", { id: "m0" });
  ok(clean.success === true, "control: a delete on an over-guard store succeeds");
  ok(load().length === before - 1, "control: the row is actually gone from KVS");

  // the defect: the second read of pf_memories (the one INSIDE saveMemories) faults.
  reset(store);
  const restore = faultNthMemoryRead(2);
  const faulted = await call("deleteMemory", { id: "m0" });
  restore();
  ok(faulted.success === true, `a delete survives a faulted prior read (got ${JSON.stringify({ success: faulted.success, reason: faulted.reason })})`);
  ok(load().length === before - 1 && !load().some((m) => m.id === "m0"),
    `the delete ACTUALLY WROTE — success is not reported for a store that still has the row (${load().length} rows)`);
}

// ---------------------------------------------------------------------------
// F-188 (b) — the same fault must not turn a metadata-only edit into a refusal.
// Restore (`disabled` true → false) costs +1 B; with `[]` standing in for the stored
// value it looked like 199 insertions and was refused — F-184's one-way door, reopened
// by a transient read fault.
// ---------------------------------------------------------------------------
{
  const store = buildStore(MEMORY_MAX_SERIALIZED_BYTES + 200);
  store[0].disabled = true;
  reset(store);
  const restoreGet = faultNthMemoryRead(2);
  const res = await call("updateMemory", { id: "m0", disabled: false });
  restoreGet();
  ok(res.success === true, `a metadata-only restore survives a faulted prior read (got ${JSON.stringify(res)})`);
  ok(load().find((m) => m.id === "m0").disabled === false, "the restore actually reached KVS");
}

// ---------------------------------------------------------------------------
// F-188 (c) — the guard itself is NOT weakened: a content edit that grows an
// over-guard store is still refused, and updateMemory still reports the refusal.
// ---------------------------------------------------------------------------
{
  const store = buildStore(MEMORY_MAX_SERIALIZED_BYTES + 200, 300);
  store[0].content = "短";
  reset(store);
  const before = JSON.stringify(load());
  const grow = await call("updateMemory", { id: "m0", content: "漢".repeat(MEMORY_CONTENT_MAX) });
  ok(grow.success === false && grow.stored === false && grow.reason === "bytes",
    `a growing content edit over the guard is refused (got ${JSON.stringify({ success: grow.success, reason: grow.reason })})`);
  ok(typeof grow.error === "string" && /Memories tab/.test(grow.error), `the refusal names where to act: "${grow.error}"`);
  ok(JSON.stringify(load()) === before, "the refused edit left the store byte-identical");
}

// ---------------------------------------------------------------------------
// F-193 — the mock's oversize throw must MIRROR the platform, not invent a shape.
// @forge/kvs throws ForgeKvsAPIError (a ForgeKvsError subclass that does not override
// `name`) carrying a body-supplied `code`, `responseDetails` and `context`. The mock used
// to throw a bare Error with an invented `VALUE_TOO_LARGE`, and that fiction was quoted as
// measured fact in three comments — the shape a real fix would then have been gated on.
// ---------------------------------------------------------------------------
{
  const errorsSrc = readFileSync(new URL("../../node_modules/@forge/kvs/out/errors.js", import.meta.url), "utf8");
  ok(/class ForgeKvsAPIError extends ForgeKvsError/.test(errorsSrc),
    "positive control: the installed @forge/kvs really does define ForgeKvsAPIError");
  ok(/this\.name = 'ForgeKvsError'/.test(errorsSrc),
    "positive control: ForgeKvsError sets name 'ForgeKvsError' and the API subclass does not override it");

  storage.__reset();
  let thrown = null;
  try {
    await storage.set("oversize_probe", "x".repeat(KVS_PLATFORM_MAX_VALUE_BYTES + 10));
  } catch (e) { thrown = e; }
  ok(thrown !== null, `a value over ${KVS_PLATFORM_MAX_VALUE_BYTES} B is rejected by the mock`);
  ok(thrown.name === "ForgeKvsError", `the throw carries the platform's error name (got ${thrown && thrown.name})`);
  ok(thrown.code === KVS_STORAGE_LIMIT_CODE, `the code is the SDK's storage-limit code, not an invented one (got ${thrown && thrown.code})`);
  ok(thrown.responseDetails && typeof thrown.responseDetails.status === "number" && thrown.context,
    "the throw carries responseDetails and context like ForgeKvsAPIError does");
  ok(storage.__raw("oversize_probe") === undefined, "the rejected value was never stored");
}

// ---------------------------------------------------------------------------
// F-189 — the over-platform-cap store, and the only repair that works on it.
// ---------------------------------------------------------------------------
{
  // 198 hand-authored 400-char CJK rows: the shape the ledger measured at 275 111 B.
  const huge = [];
  for (let i = 0; i < 198; i++) huge.push(row(i, "漢".repeat(MEMORY_CONTENT_MAX)));
  ok(serializedBytes(huge) > MEMORY_PLATFORM_MAX_SERIALIZED_BYTES,
    `the legacy store is over the ${MEMORY_PLATFORM_MAX_SERIALIZED_BYTES}B platform cap (${serializedBytes(huge)}B)`);

  // (c) the size is visible BEFORE anything is attempted.
  reset(huge);
  const stats = await call("getMemoryStoreStats");
  ok(stats.success === true && stats.bytes === serializedBytes(huge), `getMemoryStoreStats reports the measured size (${stats.bytes}B)`);
  ok(stats.guardBytes === MEMORY_MAX_SERIALIZED_BYTES && stats.platformBytes === MEMORY_PLATFORM_MAX_SERIALIZED_BYTES,
    "it reports BOTH ceilings, so no surface retypes either");
  ok(stats.overPlatform === true && stats.bytesOverPlatform === serializedBytes(huge) - MEMORY_PLATFORM_MAX_SERIALIZED_BYTES,
    `it names the deficit (${stats.bytesOverPlatform}B over)`);
  const pure = memoryStoreStats(huge);
  ok(Object.keys(pure).every((k) => JSON.stringify(stats[k]) === JSON.stringify(pure[k])),
    "every number the resolver reports comes from the pure memoryStoreStats helper");

  // (b) a single-row delete is REFUSED with a sentence, never a raw platform byte string.
  const oneRow = await call("deleteMemory", { id: "m0" });
  ok(oneRow.success === false && oneRow.reason === "platform-cap",
    `a one-row delete on an over-cap store is refused with reason "platform-cap" (got ${JSON.stringify({ success: oneRow.success, reason: oneRow.reason })})`);
  ok(typeof oneRow.bytesOver === "number" && oneRow.bytesOver > 0, `the refusal carries the deficit (${oneRow.bytesOver}B)`);
  ok(/storage limit/.test(oneRow.error) && new RegExp(String(oneRow.bytesOver)).test(oneRow.error),
    `the refusal is a sentence naming the bytes that must go: "${oneRow.error}"`);
  ok(!/over the \d+ byte limit/.test(oneRow.error), "the raw platform byte string never reaches the admin");
  ok(load().length === 198, "the refused delete left the store untouched");

  // (a) the BULK delete is the repair: enough rows in ONE write.
  const bulk = await call("deleteMemory", { ids: ["m0", "m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9", "m10", "m11", "m12", "m13", "m14", "m15", "m16", "m17", "m18", "m19", "m20", "m21", "m22", "m23", "m24", "m25", "m26", "m27", "m28", "m29", "m30", "m31", "m32", "m33", "m34", "m35", "m36", "m37", "m38", "m39"] });
  ok(bulk.success === true, `a bulk delete of 40 rows repairs the store (got ${JSON.stringify({ success: bulk.success, reason: bulk.reason, error: bulk.error })})`);
  ok(bulk.deleted.length === 40 && load().length === 158, `40 rows are gone in one write (${load().length} left)`);
  const after = await call("getMemoryStoreStats");
  ok(after.overPlatform === false, `the repaired store is under the platform cap (${after.bytes}B)`);

  // and a single-row delete works again from there — the store is genuinely repaired.
  const nowOne = await call("deleteMemory", { id: "m40" });
  ok(nowOne.success === true && load().length === 157, "a one-row delete works again once the store is back under the cap");

  // ids that no longer exist do not turn away a delete that still has real work.
  const mixed = await call("deleteMemory", { ids: ["m41", "does-not-exist"] });
  ok(mixed.success === true && mixed.deleted.length === 1 && mixed.notFound.length === 1,
    `a partially-stale id list still deletes what is there (${JSON.stringify({ deleted: mixed.deleted, notFound: mixed.notFound })})`);
  const none = await call("deleteMemory", { ids: ["nope-1", "nope-2"] });
  ok(none.success === false && none.error === "Memory not found", "an all-stale id list is still Memory not found");
  const empty = await call("deleteMemory", {});
  ok(empty.success === false && /required/.test(empty.error), "a delete with neither id nor ids is refused");
}

// ---------------------------------------------------------------------------
// F-189 — the same gate as before the change: no editor role, no delete.
// ---------------------------------------------------------------------------
{
  reset([row(0, "a lesson"), row(1, "another lesson")]);
  const denied = await call("deleteMemory", { ids: ["m0", "m1"] }, "acct-nobody");
  ok(denied.success === false && /access required/i.test(denied.error), "the bulk form is behind the same role gate");
  ok(load().length === 2, "the denied bulk delete wrote nothing");
}

// ---------------------------------------------------------------------------
// F-197 — a THROW from the write is not the platform cap.
//
// The size is measured against MEMORY_PLATFORM_MAX_SERIALIZED_BYTES before the `set`, and
// that measurement owns the "platform-cap" answer and its deficit. Any throw AFTER that
// check passed used to be mapped to "platform-cap" with `bytesOver = Math.max(1, bytes -
// ceiling)` — always the fabricated floor of 1 — so a transient KVS fault on a 1.4 KB
// store told the admin it was "1 byte over Jira's 245760-byte storage limit" and to
// bulk-delete memories. Wrong diagnosis, wrong action, and it hid the retry that works.
// ---------------------------------------------------------------------------
{
  reset([row(0, "a lesson"), row(1, "another lesson")]);
  const small = load();
  const bytes = serializedBytes(small);
  ok(bytes > 0 && bytes < 2000, `the faulting write is ~${bytes}B — far under both ceilings`);
  storage.__failNextSet();
  const faulted = await saveMemories(small);
  ok(faulted.refused === true, "a throw from storage.set is still answered, never rethrown at the caller");
  ok(faulted.reason === "write-fault", `…with reason "write-fault", not "platform-cap" (got ${JSON.stringify(faulted.reason)})`);
  ok(faulted.bytesOver === undefined, "and NO fabricated byte deficit");
  ok(typeof faulted.error === "string" && faulted.error.length > 0, "the platform's own message is carried for the log");

  // the sentence the admin sees: an action they can take, and no number that means nothing
  reset([row(0, "a lesson"), row(1, "another lesson")]);
  storage.__failNextSet();
  const del = await call("deleteMemory", { id: "m0" });
  ok(del.success === false && del.reason === "write-fault", `a faulted delete is reported as a delete that did NOT happen (got ${JSON.stringify({ success: del.success, reason: del.reason })})`);
  ok(del.error === memoryWriteFaultMessage(), `the sentence is the shared write-fault one: "${del.error}"`);
  ok(!/\d/.test(del.error), "it names no byte count — nothing is over any limit");
  ok(del.error !== memoryPlatformCapMessage(1), "and it is NOT the bulk-delete advice the old code gave");
  ok(load().length === 2, "the store is untouched by the faulted write");
  const retried = await call("deleteMemory", { id: "m0" });
  ok(retried.success === true && load().length === 1, "the retry the sentence recommends actually works");
}

console.log(`\nmemory-store-repair: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
