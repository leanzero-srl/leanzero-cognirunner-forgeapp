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

export default storage;
