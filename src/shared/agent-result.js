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

// Per-field limits alone cannot bound JSON: control characters and lone
// surrogates serialize to six-byte escapes. Bound the completed scoped payload,
// leaving 1KiB inside 220KiB for storeLog's id/timestamp and task status metadata.
export const SCOPED_JOB_PAYLOAD_MAX_BYTES = 220 * 1024;
export const boundScopedJobLog = (entry) => {
  const limit = SCOPED_JOB_PAYLOAD_MAX_BYTES - 1024;
  // This task-shaped envelope conservatively includes all log metadata; the real
  // consumer returns fewer fields and renames perIssue to issues.
  const fits = (log) => Math.max(encodedLength(log), encodedLength({ status: "done", result: { ...log, perIssue: undefined, issues: log.perIssue } })) <= limit;
  if (fits(entry)) return entry;
  const log = { ...entry, perIssue: entry.perIssue.map(row => ({ ...row })), logs: [...entry.logs] };
  const note = "[Display details truncated to fit stored result]";
  log.reason = `${log.reason} ${note}`;
  // Preserve every key/success/outcome. Reduce only display text, re-measuring
  // both persisted shapes after each pass rather than guessing an encoding ratio.
  for (const maxBytes of [240, 120, 60, 30]) {
    for (const row of log.perIssue) {
      for (const field of ["agentSummary", "reason"]) {
        if (typeof row[field] === "string") row[field] = truncateSummary(row[field], maxBytes);
      }
    }
    log.logs = log.logs.map(text => truncateSummary(String(text), maxBytes));
    if (fits(log)) return log;
  }
  // A script can also return enormous changed field values. Keep as many change
  // records as fit; explicitly disclose omitted display details, never issue outcomes.
  log.changes = [...(log.changes || [])];
  let omitted = 0;
  const noticeAt = log.logs.length;
  while (!fits(log) && log.changes.length) {
    log.changes.pop(); omitted++;
    log.logs[noticeAt] = `[truncated: ${omitted} change detail record(s) omitted; inspect Jira history for the writes]`;
  }
  return log;
};
