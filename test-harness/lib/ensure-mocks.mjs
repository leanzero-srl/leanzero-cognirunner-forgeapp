/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// F-467 — MAKES A SUITE SELF-ARRANGING, SO IT PASSES STANDALONE AND INSIDE THE RUNNER ALIKE.
//
// The @forge/* mocks are installed by an ESM *resolve hook* (lib/forge-kvs-loader.mjs,
// lib/index-loader.mjs). A resolve hook only applies to modules resolved AFTER `register()`
// runs — and a suite's own static `import ... from "../../src/memories.js"` is resolved during
// the linking phase, i.e. BEFORE any module body (including register-mocks*.mjs) executes.
// So `import "../lib/register-mocks.mjs"` at the top of a suite does NOT mock a statically
// imported src module: that module binds the REAL @forge/kvs, whose first call dies with
// `global.__forge_fetch__ is not a function` ("Memory not found", `bulk.deleted` undefined).
//
// The failure was invisible because run-offline.mjs launched every suite with
// `node --import lib/register-mocks.mjs`, which registers the hook before ANY resolution.
// Green in the runner, red when a surgeon ran the one suite for their change (F-467).
//
// The fix is to remove the difference between the two launches rather than to document it:
// a suite that imports this module re-executes itself once, with the loader pre-registered,
// whenever it was started without one. `node scripts/<suite>.test.mjs`,
// `node --import ./lib/register-mocks.mjs scripts/<suite>.test.mjs` and run-offline.mjs then
// all run the SAME child process. Import it FIRST, before any src/ import.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Set by register-mocks.mjs / register-mocks-index.mjs, so a `--import`ed launch (and the child
// this module spawns) is recognised as already-mocked and never respawns.
if (process.env.CR_MOCKS_ACTIVE !== "1") {
  // index-loader is a strict superset of forge-kvs-loader (@forge/kvs + @forge/api + @forge/events,
  // plus @forge/resolver, @forge/llm and the extensionless relative specifiers the Forge bundler
  // accepts but node ESM does not), so one registrar serves every suite.
  const loader = fileURLToPath(new URL("./register-mocks-index.mjs", import.meta.url));
  const r = spawnSync(process.execPath, ["--import", loader, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, CR_MOCKS_ACTIVE: "1" },
  });
  process.exit(r.status === null ? 1 : r.status);
}
