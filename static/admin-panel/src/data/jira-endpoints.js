/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * Re-export shim. The endpoint catalog moved to src/shared/jira-endpoints.js
 * (repo root) so the backend AI prompts and the frontend picker share one
 * source of truth. Webpack follows the relative import outside the app root.
 */

export { default, ENDPOINT_CATEGORIES, buildEndpointPromptBlock } from "../../../../src/shared/jira-endpoints.js";
