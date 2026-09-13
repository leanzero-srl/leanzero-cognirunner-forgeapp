/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Preload shim: registers the @forge/kvs → mock resolve hook. Use via
//   node --import ./lib/register-mocks.mjs scripts/<suite>.test.mjs
import { register } from "node:module";

// F-467: tells lib/ensure-mocks.mjs the hook is already installed, so a suite launched with
// `--import` (run-offline.mjs, package.json scripts) does not respawn itself.
process.env.CR_MOCKS_ACTIVE = "1";
register("./forge-kvs-loader.mjs", import.meta.url);
