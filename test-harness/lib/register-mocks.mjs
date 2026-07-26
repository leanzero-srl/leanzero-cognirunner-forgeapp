/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Preload shim: registers the @forge/kvs → mock resolve hook. Use via
//   node --import ./lib/register-mocks.mjs scripts/<suite>.test.mjs
import { register } from "node:module";
register("./forge-kvs-loader.mjs", import.meta.url);
