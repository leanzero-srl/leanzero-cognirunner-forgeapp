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
register("./index-loader.mjs", import.meta.url);
