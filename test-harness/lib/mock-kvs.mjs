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
  async set(key, value) { store.set(key, clone(value)); return { key }; },
  async delete(key) { store.delete(key); },
  // test helpers (not part of the real API)
  __reset() { store.clear(); },
  __seed(key, value) { store.set(key, clone(value)); },
  __raw(key) { return store.get(key); },
};

// deep clone so a caller can't mutate stored state by reference (mirrors KVS serialize semantics)
function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

export default storage;
