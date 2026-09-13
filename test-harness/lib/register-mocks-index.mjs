/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Preload shim for scripts that import src/index.js itself. Same @forge/* mocks as
// register-mocks.mjs, plus the extensionless relative specifiers the Forge bundler
// accepts but node ESM does not (src/index.js does `export ... from "./test-hook"`).
import { register } from "node:module";

// F-467: tells lib/ensure-mocks.mjs the hook is already installed, so a suite launched with
// `--import` (run-offline.mjs, package.json scripts) does not respawn itself.
process.env.CR_MOCKS_ACTIVE = "1";
register("./index-loader.mjs", import.meta.url);
