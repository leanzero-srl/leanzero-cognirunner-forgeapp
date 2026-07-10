/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// ESM resolve-hook that maps `@forge/kvs` → the in-memory mock so storage-calling src modules run offline.
// Register it before importing any such module: `node --import ./lib/register-mocks.mjs <test>.mjs`.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@forge/kvs") {
    return { url: new URL("./mock-kvs.mjs", import.meta.url).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
