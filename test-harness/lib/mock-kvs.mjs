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
/*
 * F-349 — THE KEY GRAMMAR. Forge KVS refuses a key that does not match its own pattern
 * with `ForgeKvsAPIError` code INVALID_KEY (observed live 2026-09-13, F-346: the per-repo
 * hook secret key embedded "owner/name" and could never be written, which killed the whole
 * inbound git path). The mock had NO key check, so five broken builders passed offline.
 * It enforces the platform pattern now, so a future builder that emits an illegal key
 * fails in the offline suite instead of on somebody's webhook.
 */
const KVS_KEY_PATTERN = /^(?!\s+$)[a-zA-Z0-9:._\s#-]+$/;
export const KVS_INVALID_KEY_CODE = "INVALID_KEY";
const enforceKey = (key, httpPath) => {
  if (typeof key === "string" && key.length > 0 && key.length <= 500 && KVS_KEY_PATTERN.test(key)) return;
  // Mirrors ForgeKvsAPIError exactly as the platform returned it (message included).
  const error = new Error(`Field 'key' must match pattern "^(?!\\s+$)[a-zA-Z0-9:._\\s-#]+$"`);
  error.name = "ForgeKvsError";
  error.code = KVS_INVALID_KEY_CODE;
  error.responseDetails = { status: 400, statusText: "Bad Request", traceId: "mock-trace", httpMethod: "POST", httpPath };
  error.context = { key: String(key) };
  throw error;
};

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

/*
 * A ONE-SHOT WRITE FAULT (F-197). Not every throw from `set` is the value being too big:
 * KVS can fault on a perfectly sized write (a 5xx, a trace-level blip), and the app's
 * answer for that case must be different from its answer for the size cap — so a suite
 * needs to produce a throw that is NOT the size check above. `__failNextSet` arms exactly
 * one, so it can never leak into a later assertion in the same file.
 */
let pendingSetFault = null;
// F-481 — a one-shot set fault aimed at a SPECIFIC write, `{ match, error }`.
let pendingSetFaultWhen = null;
// F-230 — the same one-shot device for READS. A permission lookup whose roster GET
// faults must be distinguishable from one that reads an empty roster, so a suite
// needs a get() that throws exactly once.
let pendingGetFault = null;
let pendingGetFaultWhen = null;
// F-676 - the cursor value (if any) that `query().cursor(x).getMany()` refuses.
let pendingCursorReject = null;
export const KVS_INVALID_CURSOR_CODE = "INVALID_CURSOR";

const storage = {
  async get(key) {
    enforceKey(key, "/api/v1/get");
    if (pendingGetFaultWhen && pendingGetFaultWhen.match(key)) {
      const fault = pendingGetFaultWhen.error;
      pendingGetFaultWhen = null;
      throw fault;
    }
    if (pendingGetFault) {
      const fault = pendingGetFault;
      pendingGetFault = null;
      throw fault;
    }
    return store.has(key) ? clone(store.get(key)) : undefined;
  },
  async set(key, value, options = {}) {
    enforceKey(key, "/api/v1/set");
    if (pendingSetFault) {
      const fault = pendingSetFault;
      pendingSetFault = null;
      throw fault;
    }
    // F-481 — the SELECTIVE half. A multi-step write path (store → provider → promote)
    // needs a fault on a LATER set, not the next one, and the steps share a key, so the
    // predicate sees the value too. One-shot for the same reason `__failNextSet` is.
    if (pendingSetFaultWhen && pendingSetFaultWhen.match(key, clone(value))) {
      const fault = pendingSetFaultWhen.error;
      pendingSetFaultWhen = null;
      throw fault;
    }
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
  async delete(key) { enforceKey(key, "/api/v1/delete"); store.delete(key); },
  query() {
    let prefix = ""; let cap = 10; let after = "";
    const query = {
      where(_field, condition) { prefix = condition.values[0]; return query; },
      limit(value) { cap = value; return query; },
      cursor(value) { after = value; return query; },
      async getMany() {
        /*
         * F-676 - A CURSOR KVS REFUSES. The mock's cursor is a plain key string and has
         * never rejected anything, so no offline suite could answer the question F-676
         * actually asks: what does a door do when `storage.query().cursor(x).getMany()`
         * THROWS on a malformed or foreign token? Armed via `__rejectCursor`, this is the
         * throw - shaped like ForgeKvsAPIError (name inherited from ForgeKvsError, a
         * body-supplied `code`, `responseDetails`, `context`) exactly like the size and
         * key-grammar refusals above. The CODE is a stand-in, not an observed one: what is
         * measured here is that a cursor CAN throw, never which code the platform emits -
         * so app code must treat any throw from the query as the same refusal.
         */
        if (pendingCursorReject !== null && after === pendingCursorReject) {
          const error = new Error(`Invalid cursor '${after}'`);
          error.name = "ForgeKvsError";
          error.code = KVS_INVALID_CURSOR_CODE;
          error.responseDetails = { status: 400, statusText: "Bad Request", traceId: "mock-trace", httpMethod: "POST", httpPath: "/api/v1/query" };
          error.context = { cursor: after };
          throw error;
        }
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
        for (const { key } of sets) enforceKey(key, "/api/v1/transact");
        for (const key of deletes) enforceKey(key, "/api/v1/transact");
        for (const { key, options } of sets) if (options?.keyPolicy === "FAIL_IF_EXISTS" && store.has(key)) throw new Error("Key already exists");
        for (const { key, value } of sets) enforceValueSize(key, value);
        for (const { key, value } of sets) store.set(key, clone(value));
        for (const key of deletes) store.delete(key);
      },
    };
    return transaction;
  },
  // test helpers (not part of the real API)
  __reset() { store.clear(); pendingSetFault = null; pendingSetFaultWhen = null; pendingGetFault = null; pendingGetFaultWhen = null; pendingCursorReject = null; },
  /*
   * Make ONE cursor value poison (F-676): every `getMany()` carrying it throws until the
   * arming is cleared with `__rejectCursor(null)`. Not one-shot, unlike the set/get faults:
   * a bad token is bad every time it is presented, which is the property a resume loop has
   * to survive, and a one-shot version would pass on the retry for the wrong reason.
   */
  __rejectCursor(value) { pendingCursorReject = typeof value === "string" && value ? value : null; },
  // Arm ONE throw from the next `set` — a transient fault, not the size ceiling.
  __failNextSet(error) {
    const fault = error instanceof Error ? error : new Error(String(error || "KVS write failed"));
    if (!error || !(error instanceof Error)) {
      fault.name = "ForgeKvsError";
      fault.code = "INTERNAL_SERVER_ERROR";
      fault.responseDetails = { status: 500, statusText: "Internal Server Error", traceId: "mock-trace", httpMethod: "POST", httpPath: "/api/v1/set" };
    }
    pendingSetFault = fault;
  },
  // Arm ONE throw from the next `set` whose key+value satisfy `match(key, value)` —
  // for write paths where the fault that matters is the SECOND write to one key (F-481).
  __failSetWhen(match, error) {
    const fault = error instanceof Error ? error : new Error(String(error || "KVS write failed"));
    if (!error || !(error instanceof Error)) {
      fault.name = "ForgeKvsError";
      fault.code = "INTERNAL_SERVER_ERROR";
      fault.responseDetails = { status: 500, statusText: "Internal Server Error", traceId: "mock-trace", httpMethod: "POST", httpPath: "/api/v1/set" };
    }
    pendingSetFaultWhen = { match, error: fault };
  },
  // Arm ONE throw from the next `get` — a transient read fault (F-230).
  __failNextGet(error) {
    const fault = error instanceof Error ? error : new Error(String(error || "KVS read failed"));
    if (!error || !(error instanceof Error)) {
      fault.name = "ForgeKvsError";
      fault.code = "INTERNAL_SERVER_ERROR";
      fault.responseDetails = { status: 500, statusText: "Internal Server Error", traceId: "mock-trace", httpMethod: "POST", httpPath: "/api/v1/get" };
    }
    pendingGetFault = fault;
  },
  // Arm ONE throw from the next `get` for a SPECIFIC key — the selective half of
  // `__failNextGet`, mirroring `__failSetWhen` (F-593). A read path that touches several
  // keys in order cannot use the unconditional form: the fault lands on whichever read
  // happens to be next, which is a different test from the one being written.
  __failGetWhen(match, error) {
    const fault = error instanceof Error ? error : new Error(String(error || "KVS read failed"));
    if (!error || !(error instanceof Error)) {
      fault.name = "ForgeKvsError";
      fault.code = "INTERNAL_SERVER_ERROR";
      fault.responseDetails = { status: 500, statusText: "Internal Server Error", traceId: "mock-trace", httpMethod: "POST", httpPath: "/api/v1/get" };
    }
    pendingGetFaultWhen = { match, error: fault };
  },
  __seed(key, value) { store.set(key, clone(value)); },
  __raw(key) { return store.get(key); },
};

// deep clone so a caller can't mutate stored state by reference (mirrors KVS serialize semantics)
function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

export { storage as kvs };
export default storage;
