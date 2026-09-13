/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// In-memory stand-in for @forge/kvs so storage-calling src modules (memories.js, skills.js, …) run in
// offline unit tests. The default export mirrors the subset the app uses (get/set/delete). Tests import
// THIS module directly to seed/reset the store; src modules get the SAME instance via forge-kvs-loader.mjs
// (both resolve to this file URL → node caches one instance → shared state).
const store = new Map();

/*
 * The REAL platform limit: KVS refuses a value over 240 KiB. The mock enforces it so that
 * a suite can prove the app's own byte guard (MEMORY_MAX_SERIALIZED_BYTES = 230 000) is
 * what keeps `pf_memories` writable — F-183 was "the store grows past the platform cap and
 * then EVERY write, including the delete that would repair it, throws", which a mock with
 * no ceiling cannot show.
 *
 * F-193 — the ERROR SHAPE, and what is and is not measured here. @forge/kvs never throws a
 * bare `Error`: an API failure arrives as `ForgeKvsAPIError` (a `ForgeKvsError` subclass —
 * and note the subclass does NOT override `name`, so `error.name` reads "ForgeKvsError")
 * carrying `code` from the response body, plus `responseDetails` and `context`
 * (node_modules/@forge/kvs/out/errors.js). The mock previously threw a plain Error with an
 * INVENTED code, `VALUE_TOO_LARGE`, and three comments went on to quote that fiction as
 * measured fact — which is exactly how a real fix gets gated on a code the platform never
 * emits, passing offline and never firing on Forge.
 *
 * What IS measured here: the BYTE THRESHOLD (245 760) and the fact that a write over it
 * fails. What is NOT: the exact `code` an oversize single `set` returns. `STORAGE_LIMIT_EXCEEDED`
 * is the storage-limit code the SDK's own test fixtures use
 * (out/__test__/index.test.js), not a code observed from a live oversize set. So app code must
 * never depend on the code alone — src/memories.js refuses an over-cap write BEFORE handing it
 * to KVS, and treats any throw from the write as the same refusal.
 */
const KVS_MAX_VALUE_BYTES = 245760;
export const KVS_PLATFORM_MAX_VALUE_BYTES = KVS_MAX_VALUE_BYTES;
export const KVS_STORAGE_LIMIT_CODE = "STORAGE_LIMIT_EXCEEDED";
const enforceValueSize = (key, value) => {
  if (value === undefined) return;
  const bytes = new TextEncoder().encode(JSON.stringify(value) ?? "").length;
  if (bytes > KVS_MAX_VALUE_BYTES) {
    const error = new Error(`Value for key ${key} is ${bytes} bytes, over the ${KVS_MAX_VALUE_BYTES} byte limit`);
    // Mirrors ForgeKvsAPIError: name inherited from ForgeKvsError, a body-supplied code,
    // responseDetails and context. Not an instance of the real class (importing @forge/kvs
    // into the mock that replaces it would be circular) — a structural stand-in.
    error.name = "ForgeKvsError";
    error.code = KVS_STORAGE_LIMIT_CODE;
    error.responseDetails = { status: 400, statusText: "Bad Request", traceId: "mock-trace", httpMethod: "POST", httpPath: "/api/v1/set", responseBodyLength: 0 };
    error.context = { key, bytes, limit: KVS_MAX_VALUE_BYTES };
    throw error;
  }
};

const storage = {
  async get(key) { return store.has(key) ? clone(store.get(key)) : undefined; },
  async set(key, value, options = {}) {
    // Conditional writes must be atomic even when callers await them concurrently.
    // Otherwise the mock hides the exact duplicate-delivery race these claims guard.
    if (options.keyPolicy === "FAIL_IF_EXISTS" && store.has(key)) {
      const error = new Error("Key already exists");
      error.code = "KEY_ALREADY_EXISTS";
      throw error;
    }
    enforceValueSize(key, value);
    store.set(key, clone(value)); return { key };
  },
  async delete(key) { store.delete(key); },
  query() {
    let prefix = ""; let cap = 10; let after = "";
    const query = {
      where(_field, condition) { prefix = condition.values[0]; return query; },
      limit(value) { cap = value; return query; },
      cursor(value) { after = value; return query; },
      async getMany() {
        const keys = [...store.keys()].filter(key => key.startsWith(prefix) && key > after).sort();
        const page = keys.slice(0, cap);
        return { results: page.map(key => ({ key, value: clone(store.get(key)) })), nextCursor: keys.length > cap ? page.at(-1) : undefined };
      },
    };
    return query;
  },
  async batchDelete(rows) { for (const { key } of rows) store.delete(key); },
  transact() {
    const sets = []; const deletes = [];
    const transaction = {
      set(key, value, entity, options) { sets.push({ key, value, entity, options }); return transaction; },
      delete(key) { deletes.push(key); return transaction; },
      async execute() {
        // No await between mutations: all-or-nothing visibility to other calls.
        for (const { key, options } of sets) if (options?.keyPolicy === "FAIL_IF_EXISTS" && store.has(key)) throw new Error("Key already exists");
        for (const { key, value } of sets) enforceValueSize(key, value);
        for (const { key, value } of sets) store.set(key, clone(value));
        for (const key of deletes) store.delete(key);
      },
    };
    return transaction;
  },
  // test helpers (not part of the real API)
  __reset() { store.clear(); },
  __seed(key, value) { store.set(key, clone(value)); },
  __raw(key) { return store.get(key); },
};

// deep clone so a caller can't mutate stored state by reference (mirrors KVS serialize semantics)
function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

export { storage as kvs };
export default storage;
