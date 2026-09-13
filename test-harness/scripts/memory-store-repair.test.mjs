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
import "../lib/register-mocks-index.mjs";
import storage from "../lib/mock-kvs.mjs";
import { MEMORIES_KEY, MEMORY_MAX_SERIALIZED_BYTES, MEMORY_CONTENT_MAX, serializedBytes } from "../../src/memories.js";
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

console.log(`\nmemory-store-repair: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
