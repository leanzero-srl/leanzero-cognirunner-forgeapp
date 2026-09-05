/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Include the real index.js resolver probe in run-offline's *.test.mjs discovery.
// Register its Forge-compatible loader before importing the resolver (no index stub).
import "../lib/register-mocks-index.mjs";
await import("./testpf-dryrun-probe.mjs");
