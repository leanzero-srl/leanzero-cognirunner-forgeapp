/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// ESM resolve-hook that maps `@forge/kvs` → the in-memory mock so storage-calling src modules run offline.
// Register it before importing any such module: `node --import ./lib/register-mocks.mjs <test>.mjs`.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@forge/kvs") {
    return { url: new URL("./mock-kvs.mjs", import.meta.url).href, shortCircuit: true };
  }
  // @forge/api + @forge/events → one recording mock (src/listeners.js, src/scheduled-jobs.js
  // import them at top level; the mock never reaches the network).
  if (specifier === "@forge/api" || specifier === "@forge/events") {
    return { url: new URL("./mock-forge-api.mjs", import.meta.url).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
