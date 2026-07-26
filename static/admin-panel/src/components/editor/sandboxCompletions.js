/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * CodeMirror completion source for the static post-function sandbox editor.
 * All api.* completions derive from the shared sandbox API spec so the editor
 * never drifts from the backend's actual API surface.
 */

import { snippetCompletion } from "@codemirror/autocomplete";
import {
  SANDBOX_API_METHODS,
  ISSUE_FIELD_COMPLETIONS,
  WRITE_FORMATS_BY_CUSTOM_TYPE,
  WRITE_FORMATS_BY_SYSTEM_FIELD,
  SNIPPETS,
} from "../../../../../src/shared/sandbox-api-spec.js";

// api.* completions generated from the spec (plus the issueKey accessor).
const API_COMPLETIONS = [
  ...SANDBOX_API_METHODS.map((m) => ({
    label: `api.${m.name}`,
    type: m.name === "context" ? "variable" : "function",
    detail: m.detail,
    info: m.summary,
  })),
  {
    label: "api.context.issueKey",
    type: "property",
    detail: "string",
    info: "The key of the issue being transitioned (e.g., 'PROJ-123').",
  },
];

// Snippet completions. SNIPPETS.insert is already in CodeMirror snippet
// syntax (#{n:label} placeholders), so it can be passed through verbatim.
const SNIPPET_COMPLETIONS = SNIPPETS.map((s) =>
  snippetCompletion(s.insert, {
    label: s.name,
    detail: s.label,
    info: s.info,
    type: "text",
  }),
);

const writeFormatFor = (field) => {
  const customKey = field.schema?.custom?.split(":").pop();
  return (
    (customKey && WRITE_FORMATS_BY_CUSTOM_TYPE[customKey]) ||
    WRITE_FORMATS_BY_SYSTEM_FIELD[field.id] ||
    "depends on field type"
  );
};

/**
 * Builds the completion source used via autocompletion({ override: [...] }).
 *
 * @param {Object} opts
 * @param {Array}  opts.customFields    - rows from the getFields resolver
 *                                        ({ id, name, type, custom, schema })
 * @param {Array}  opts.priorVariables  - variable names from prior steps
 */
export function buildCompletionSource({ customFields = [], priorVariables = [] } = {}) {
  const customFieldCompletions = customFields
    .filter((f) => f && f.id)
    .map((f) => ({
      label: `issue.fields.${f.id}`,
      type: "property",
      detail: `${f.name} - ${f.type}`,
      info: `Write format: ${writeFormatFor(f)}`,
      _fieldName: (f.name || "").toLowerCase(),
    }));

  const priorVarCompletions = priorVariables
    .filter(Boolean)
    .map((name) => ({
      label: name,
      type: "variable",
      detail: "prior step result",
      info: `Result of a previous step. Reference it as \${${name}} or directly as ${name}.`,
    }));

  return function sandboxCompletions(context) {
    const word = context.matchBefore(/[\w.]*$/);
    if (!word || (word.from === word.to && !context.explicit)) return null;

    const text = word.text.toLowerCase();

    // Multi-word phrase (e.g. "story po") for matching field display names.
    const phrase = context.matchBefore(/[\w.]+(?: +[\w.]+){1,3}$/);
    if (phrase && phrase.text.includes(" ")) {
      const tokens = phrase.text.toLowerCase().split(/\s+/).filter(Boolean);
      const nameMatches = customFieldCompletions.filter((c) =>
        tokens.every((tk) => c._fieldName.includes(tk)),
      );
      if (nameMatches.length > 0) {
        return { from: phrase.from, options: nameMatches, filter: false };
      }
    }

    const completions = [];

    // API methods — match while typing "a"/"ap"/"api."… or any substring.
    for (const c of API_COMPLETIONS) {
      if (
        c.label.toLowerCase().includes(text) ||
        (text && "api.".startsWith(text))
      ) {
        completions.push(c);
      }
    }

    // Issue fields (when typing issue.fields or similar)
    if (text.includes("issue") || text.includes("fields") || text.includes(".fields")) {
      for (const c of ISSUE_FIELD_COMPLETIONS) {
        if (c.label.toLowerCase().includes(text) || text.length < 3) {
          completions.push(c);
        }
      }
      for (const c of customFieldCompletions) {
        if (c.label.toLowerCase().includes(text) || text.length < 3) {
          completions.push(c);
        }
      }
    } else if (text.length >= 2) {
      // Custom-field matching on id ("customfield_100…") or display name ("story…")
      for (const c of customFieldCompletions) {
        if (c.label.toLowerCase().includes(text) || c._fieldName.includes(text)) {
          completions.push(c);
        }
      }
    }

    // Snippets — by snippet name or ADF-related triggers
    const adfTrigger =
      text.includes("doc") || text.includes("adf") ||
      text.includes("paragraph") || text.includes("type");
    for (const c of SNIPPET_COMPLETIONS) {
      if (c.label.toLowerCase().startsWith(text) || (adfTrigger && c.label.startsWith("adf"))) {
        completions.push(c);
      }
    }

    // Prior-step variables
    for (const c of priorVarCompletions) {
      if (c.label.toLowerCase().includes(text)) {
        completions.push(c);
      }
    }

    if (completions.length === 0) return null;

    // No validFor: this source does its own substring matching, so every
    // keystroke must re-query it instead of letting CodeMirror filter the
    // previous result set in place.
    return {
      from: word.from,
      options: completions,
      filter: false,
    };
  };
}
