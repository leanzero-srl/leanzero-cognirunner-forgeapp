/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@forge/kvs") return { url: new URL("./mock-kvs.mjs", import.meta.url).href, shortCircuit: true };
  if (specifier === "@forge/api" || specifier === "@forge/events") return { url: new URL("./mock-forge-api.mjs", import.meta.url).href, shortCircuit: true };
  if (specifier === "@forge/resolver") return { url: new URL("./mock-forge-resolver.mjs", import.meta.url).href, shortCircuit: true };
  if (specifier === "@forge/llm") return { url: new URL("./mock-forge-llm.mjs", import.meta.url).href, shortCircuit: true };
  try { return await nextResolve(specifier, context); } catch (e) {
    // Forge's bundler resolves extensionless relative imports; node ESM does not.
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + ".js", context);
    throw e;
  }
}
