/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Hover documentation for the sandbox api.* members, derived from the shared
 * sandbox API spec. DOM is built exclusively with document.createElement —
 * no innerHTML — to stay CSP-safe inside the Forge iframe.
 */

import { hoverTooltip } from "@codemirror/view";
import { SANDBOX_API_METHODS } from "../../../../../src/shared/sandbox-api-spec.js";

const MONO = "SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace";

const buildTooltipDom = (method) => {
  const dom = document.createElement("div");
  dom.className = "cm-api-hover";

  const sig = document.createElement("div");
  sig.style.fontFamily = MONO;
  sig.style.fontWeight = "700";
  sig.style.fontSize = "12px";
  sig.textContent = method.signature;
  dom.appendChild(sig);

  const returns = document.createElement("div");
  returns.style.fontFamily = MONO;
  returns.style.fontSize = "11px";
  returns.style.opacity = "0.85";
  returns.textContent = `Returns: ${method.returns}`;
  dom.appendChild(returns);

  const summary = document.createElement("p");
  summary.style.margin = "6px 0 0";
  summary.style.fontSize = "12px";
  summary.textContent = method.summary;
  dom.appendChild(summary);

  if (method.example) {
    const pre = document.createElement("pre");
    pre.style.margin = "6px 0 0";
    pre.style.padding = "6px 8px";
    pre.style.fontFamily = MONO;
    pre.style.fontSize = "11px";
    pre.style.whiteSpace = "pre-wrap";
    pre.style.wordBreak = "break-word";
    pre.style.borderRadius = "4px";
    pre.style.background = "var(--code-bg)";
    pre.textContent = method.example;
    dom.appendChild(pre);
  }

  return dom;
};

export const sandboxHover = hoverTooltip((view, pos) => {
  const line = view.state.doc.lineAt(pos);
  const text = line.text;
  let start = pos - line.from;
  let end = start;

  // Walk back/forward over word chars and dots to capture the dotted token.
  while (start > 0 && /[\w.]/.test(text[start - 1])) start--;
  while (end < text.length && /[\w.]/.test(text[end])) end++;
  if (start === end) return null;

  const token = text.slice(start, end);
  const match = token.match(/\bapi\.(\w+)/);
  if (!match) return null;

  const method = SANDBOX_API_METHODS.find((m) => m.name === match[1]);
  if (!method) return null;

  return {
    pos: line.from + start,
    end: line.from + end,
    above: true,
    create: () => ({ dom: buildTooltipDom(method) }),
  };
});
