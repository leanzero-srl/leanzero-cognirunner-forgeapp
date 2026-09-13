/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Prompt-fence primitives. ONE HOME for `defangFence`.
 *
 * It lived in `src/memories.js`, which was the right home while only the backend fenced
 * anything: every interpolation site (index.js, skills.js, async-handler.js, the agent
 * and git engines) imports it from there. But `src/memories.js` imports `@forge/kvs` at
 * load, so nothing in `src/shared/` — which bundles into the Forge backend AND the webpack
 * builds — can import it without dragging the KVS client into a browser bundle. The
 * alternative was a second copy of a four-character security rule, which is this repo's
 * signature defect (registry-limits.js exists because six call sites each kept their own
 * copy of a cap).
 *
 * So the declaration moved HERE and `src/memories.js` re-exports it. Every existing
 * importer keeps working unchanged, and `src/shared/knowledge-select.js` can defang the
 * field-guide block with the same function the memory block uses.
 */

/**
 * Defang prompt-fence tokens in untrusted content before it is interpolated inside a
 * <<<FENCE ... FENCE>>> block. Collapses any run of 3+ angle brackets to 2, so injected
 * text can never open or close a literal fence.
 */
export const defangFence = (s) => String(s ?? "").replace(/<<<+/g, "<<").replace(/>>>+/g, ">>");
