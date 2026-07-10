/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/*
 * Dependency-free helpers for the "narrate dry-run" assist. Imported by the
 * backend resolver (clampNarrateLine), the config-ui / admin-panel FunctionBlock
 * (buildDryRunFacts, countChangeVerbs, CHANGE_VERB_LABEL), AND an offline Node
 * unit test — so the risk-bearing verb-coverage + output-sanitization logic is
 * verifiable without a live Forge site. Keep this file dependency-free (it bundles
 * into both backend and frontends, same rule as the other src/shared/* modules).
 */

// Human labels for the change actions testPostFunction's testApi actually records.
// Any action NOT listed here still gets described via the generic fallback in
// buildDryRunFacts and counted generically in countChangeVerbs — so no staged
// write is ever invisible, even if the recorded set grows.
export const CHANGE_VERB_LABEL = {
  updateIssue: "Update fields",
  editIssue: "Edit fields",
  transitionIssue: "Transition",
  addLabels: "Add labels",
  removeLabels: "Remove labels",
  addComment: "Add comment",
  createIssueLink: "Link issue",
  createIssue: "Create issue",
  cloneIssue: "Clone issue",
  setProperty: "Set property",
};

// Truncate/normalize one value for inclusion in the facts blob.
const truncVal = (v, n) => {
  const max = n || 140;
  let s = typeof v === "string" ? v : (() => { try { return JSON.stringify(v); } catch { return String(v); } })();
  s = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
};

// changes[] (from testPostFunction) -> a bounded, one-line-per-change plain-text
// descriptor. Value-truncated, capped at 40 changes and 4000 chars so a giant
// description ADF never reaches the prompt or the cache key. A generic fallback
// describes any action not explicitly templated (never drops a recorded write).
export const buildDryRunFacts = (changes) => {
  const arr = Array.isArray(changes) ? changes.slice(0, 40) : [];
  const lines = arr.map((c) => {
    const a = c && c.action ? String(c.action) : "change";
    switch (a) {
      case "updateIssue": return `Update ${c.key || "the issue"} fields: ${truncVal(c.fields)}`;
      case "editIssue": return `Edit ${c.key || "the issue"}: ${truncVal(c.update)}`;
      case "transitionIssue": return `Transition ${c.key || "the issue"} (transition id ${truncVal(c.transitionId, 40)})`;
      case "addLabels": return `Add labels to ${c.key || "the issue"}: ${truncVal(c.labels)}`;
      case "removeLabels": return `Remove labels from ${c.key || "the issue"}: ${truncVal(c.labels)}`;
      case "addComment": return `Add a comment to ${c.key || "the issue"}`;
      case "createIssueLink": return `Link ${c.from || "the issue"} to ${c.to || "another issue"} (${truncVal(c.type, 40)})`;
      case "createIssue": return `Create a new issue: ${truncVal(c.fields)}`;
      case "cloneIssue": return `Clone the issue${c.overrides ? " with overrides: " + truncVal(c.overrides) : ""}`;
      case "setProperty": return `Set property "${truncVal(c.propKey, 60)}" on ${c.key || "the issue"}`;
      default: {
        const rest = Object.keys(c || {})
          .filter((k) => k !== "action")
          .map((k) => `${k}=${truncVal(c[k], 60)}`)
          .join(", ");
        return `${a}${rest ? " (" + rest + ")" : ""}`;
      }
    }
  });
  return lines.join("\n").slice(0, 4000);
};

// Deterministic per-verb counts for the client-side chips (the AUTHORITATIVE source
// of what will change — the AI summary is descriptive, these are the truth).
export const countChangeVerbs = (changes) => {
  const counts = {};
  const arr = Array.isArray(changes) ? changes : [];
  for (const c of arr) {
    const a = c && c.action ? String(c.action) : "change";
    counts[a] = (counts[a] || 0) + 1;
  }
  return counts;
};

// Sanitize one model-produced string: strip code fences, stray fence tokens,
// markdown emphasis/heading/quote/list markers, collapse whitespace, dequote, and
// hard-clamp. Non-strings become "" (never surfaces "[object Object]"). Output is
// never trusted — this runs server-side after parseAIJson.
export const clampNarrateLine = (raw, max) => {
  if (typeof raw !== "string") return "";
  const cap = max || 360;
  let s = raw
    .replace(/```[a-z]*\n?|```/gi, " ")
    .replace(/<<<|>>>/g, " ")
    .replace(/[*_`#>~]+/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .trim();
  if (s.length > cap) s = s.slice(0, cap - 1).trimEnd() + "…";
  return s;
};
