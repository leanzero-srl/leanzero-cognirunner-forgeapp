/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { getAgentAction } from "./agent-actions.js";

// Scoped runs share a 24KB budget across all 100 possible issue summaries. Count
// serialized UTF-8 bytes (including JSON escaping), rather than JS characters.
export const SCOPED_AGENT_SUMMARY_BUDGET_BYTES = 24000;
const encodedLength = (text) => new TextEncoder().encode(JSON.stringify(text)).length;
const truncateSummary = (text, maxBytes) => {
  if (encodedLength(text) <= maxBytes) return text;
  const marker = "… [truncated]";
  let remaining = maxBytes - encodedLength(marker);
  let prefix = "";
  // for..of keeps astral characters intact; JSON quotes count only once.
  for (const char of text) {
    const size = encodedLength(char) - 2;
    if (size > remaining) break;
    prefix += char; remaining -= size;
  }
  return prefix + marker;
};

// Additive log/REST fields for one agent invocation. Scoped jobs retain these
// per issue; their aggregate reason is not an agent-generated summary.
export const agentResultFields = (result, { summaryMaxBytes = null } = {}) => ({
  agentOutcome: getAgentAction("finish").parameters.properties.outcome.enum.includes(result.outcome) ? result.outcome : "failed",
  agentSummary: typeof result.summary !== "string" ? "" : summaryMaxBytes == null
    ? result.summary.slice(0, 1200)
    : truncateSummary(result.summary.slice(0, 1200), summaryMaxBytes),
});
