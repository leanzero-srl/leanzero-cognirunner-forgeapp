/* CogniRunner - Copyright (C) 2025 LeanZero. SPDX-License-Identifier: AGPL-3.0-or-later */
// Inspect actual tool trace strings, not JSON.stringify(trace), which escapes
// the argument quotes a second time. Prose from the model is not guard evidence.
export function objectKeyVerdict(task, log, boundLabels, otherLabels, label) {
  const lines = [];
  const visit = value => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value.logs)) lines.push(...value.logs.filter(v => typeof v === "string"));
    for (const child of Object.values(value)) if (child && typeof child === "object") visit(child);
  };
  visit(task); visit(log);
  const attempts = lines.filter(line => /tool(?: ERROR)? add_labels\(/.test(line) && /"issueKey":\s*\{/.test(line));
  const rejected = attempts.some(line => /tool ERROR add_labels\(/.test(line) && /issueKey must be (?:an issue key|a string)/.test(line));
  const wrote = boundLabels.includes(label) || otherLabels.includes(label);
  return { emittedObject: attempts.length > 0, rejected, wrote, verdict: wrote ? "FAILED" : rejected ? "PROVEN" : "INCONCLUSIVE" };
}
