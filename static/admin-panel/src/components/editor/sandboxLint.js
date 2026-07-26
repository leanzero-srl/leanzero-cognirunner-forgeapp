/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * CSP-safe lint rules for the sandbox code editor. Everything is static
 * analysis (Lezer syntax tree + regex over the raw document) — no eval,
 * no new Function. Diagnostics:
 *   (a) Lezer syntax error nodes
 *   (b) api.<member> not in the sandbox API surface
 *   (c) ${name} references to prior-step variables that don't exist
 *   (d) Jira labels containing whitespace
 *   (e) `.total` access on api.searchJql results (no total in the response)
 */

import { linter, lintGutter } from "@codemirror/lint";
import { syntaxTree } from "@codemirror/language";
import { KNOWN_API_MEMBERS } from "../../../../../src/shared/sandbox-api-spec.js";

export function buildSandboxLinter({ priorVariables = [] } = {}) {
  const priorSet = new Set(priorVariables.filter(Boolean));

  const lintSource = (view) => {
    const diagnostics = [];
    const doc = view.state.doc.toString();

    // (a) Syntax errors from the Lezer tree. Skip zero-width error nodes
    // (typical while the user is mid-typing at the end of the doc) and
    // dedupe adjacent/overlapping ones.
    let lastErrorEnd = -1;
    syntaxTree(view.state).iterate({
      enter: (node) => {
        if (!node.type.isError) return;
        if (node.from >= node.to) return; // zero-width — likely mid-typing
        if (node.from <= lastErrorEnd + 1) {
          lastErrorEnd = Math.max(lastErrorEnd, node.to);
          return;
        }
        lastErrorEnd = node.to;
        diagnostics.push({
          from: node.from,
          to: node.to,
          severity: "error",
          message: "Syntax error",
        });
      },
    });

    // (b) Unknown api.* members
    const apiRe = /\bapi\.(\w+)/g;
    let m;
    while ((m = apiRe.exec(doc)) !== null) {
      if (!KNOWN_API_MEMBERS.includes(m[1])) {
        diagnostics.push({
          from: m.index,
          to: m.index + m[0].length,
          severity: "error",
          message: `api.${m[1]} is not available in the sandbox. Available members: ${KNOWN_API_MEMBERS.join(", ")}`,
        });
      }
    }

    // (c) ${name} placeholders referencing unknown prior-step variables
    const placeholderRe = /\$\{(\w+)\}/g;
    while ((m = placeholderRe.exec(doc)) !== null) {
      const name = m[1];
      if (priorSet.has(name)) continue;
      const declaredRe = new RegExp(`\\b(?:const|let|var|function)\\s+${name}\\b`);
      if (declaredRe.test(doc)) continue;
      // Also accept function/arrow/catch params and destructured bindings —
      // "(name", ", name", "{ name" on the left, or "name =>", "name,",
      // "name)" on the right — so callback params don't warn.
      const paramLeadRe = new RegExp("(?:\\(|,|\\{)\\s*" + name + "\\b");
      const paramTailRe = new RegExp("\\b" + name + "\\s*(?:=>|,|\\))");
      if (paramLeadRe.test(doc) || paramTailRe.test(doc)) continue;
      diagnostics.push({
        from: m.index,
        to: m.index + m[0].length,
        severity: "warning",
        message: `References a prior-step variable that doesn't exist: ${name}`,
      });
    }

    // (d) Jira labels must not contain whitespace
    const labelsRe = /labels\s*:\s*\[([^\]]*)\]/g;
    while ((m = labelsRe.exec(doc)) !== null) {
      const inner = m[1];
      const strRe = /"([^"]*)"|'([^']*)'/g;
      let s;
      let flagged = false;
      while (!flagged && (s = strRe.exec(inner)) !== null) {
        const val = s[1] !== undefined ? s[1] : s[2];
        if (/\s/.test(val)) flagged = true;
      }
      if (flagged) {
        diagnostics.push({
          from: m.index,
          to: m.index + m[0].length,
          severity: "warning",
          message: 'Jira labels cannot contain spaces — use hyphens ("needs-review", not "needs review").',
        });
      }
    }

    // (e) `.total` on a variable assigned from await api.searchJql
    const searchVarRe = /(?:const|let|var)\s+(\w+)\s*=\s*await\s+api\.searchJql\b/g;
    const searchVars = [];
    while ((m = searchVarRe.exec(doc)) !== null) searchVars.push(m[1]);
    for (const name of searchVars) {
      const totalRe = new RegExp(`\\b${name}\\.total\\b`, "g");
      while ((m = totalRe.exec(doc)) !== null) {
        diagnostics.push({
          from: m.index,
          to: m.index + m[0].length,
          severity: "warning",
          message: `searchJql returns no total - use ${name}.issues.length`,
        });
      }
    }

    diagnostics.sort((a, b) => a.from - b.from);
    return diagnostics;
  };

  return [linter(lintSource), lintGutter()];
}
