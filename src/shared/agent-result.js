/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { getAgentAction } from "./agent-actions.js";

// Additive log/REST fields for one agent invocation. Scoped jobs retain these
// per issue; their aggregate reason is not an agent-generated summary.
export const agentResultFields = (result) => ({
  agentOutcome: getAgentAction("finish").parameters.properties.outcome.enum.includes(result.outcome) ? result.outcome : "failed",
  agentSummary: typeof result.summary === "string" ? result.summary.slice(0, 1200) : "",
});
