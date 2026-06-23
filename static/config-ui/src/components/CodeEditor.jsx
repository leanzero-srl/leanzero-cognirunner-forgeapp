/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import React, { useMemo, useState, useEffect } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { createTheme } from "@uiw/codemirror-themes";
import { tags as t } from "@lezer/highlight";
import { autocompletion } from "@codemirror/autocomplete";
import { buildCompletionSource } from "./editor/sandboxCompletions";
import { sandboxHover } from "./editor/sandboxHover";
import { buildSandboxLinter } from "./editor/sandboxLint";

// === Themes ===

const leanzeroDark = createTheme({
  theme: "dark",
  settings: {
    background: "#0A0A0F",
    foreground: "#F5F5F7",
    caret: "#3b82f6",
    selection: "#3b82f626",
    selectionMatch: "#3b82f615",
    lineHighlight: "#1e1e2e",
    gutterBackground: "#0A0A0F",
    gutterForeground: "#71717a",
    gutterActiveForeground: "#A0A0B0",
    gutterBorder: "1px solid #374151",
    fontFamily: "SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace",
  },
  styles: [
    { tag: t.comment, color: "#71717a", fontStyle: "italic" },
    { tag: t.variableName, color: "#F5F5F7" },
    { tag: [t.string, t.special(t.brace)], color: "#98c379" },
    { tag: t.number, color: "#d19a66" },
    { tag: t.bool, color: "#d19a66" },
    { tag: t.null, color: "#d19a66" },
    { tag: t.keyword, color: "#c678dd" },
    { tag: t.operator, color: "#A0A0B0" },
    { tag: t.className, color: "#e5c07b" },
    { tag: t.definition(t.typeName), color: "#e5c07b" },
    { tag: t.typeName, color: "#e5c07b" },
    { tag: t.propertyName, color: "#61afef" },
    { tag: t.function(t.variableName), color: "#61afef" },
    { tag: t.definition(t.variableName), color: "#e06c75" },
  ],
});

const leanzeroLight = createTheme({
  theme: "light",
  settings: {
    background: "#f8fafc",
    foreground: "#0f172a",
    caret: "#2563eb",
    selection: "#2563eb20",
    selectionMatch: "#2563eb10",
    lineHighlight: "#f1f5f9",
    gutterBackground: "#f8fafc",
    gutterForeground: "#94a3b8",
    gutterActiveForeground: "#64748b",
    gutterBorder: "1px solid #cbd5e1",
    fontFamily: "SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace",
  },
  styles: [
    { tag: t.comment, color: "#94a3b8", fontStyle: "italic" },
    { tag: t.variableName, color: "#0f172a" },
    { tag: [t.string, t.special(t.brace)], color: "#0a3069" },
    { tag: t.number, color: "#0550ae" },
    { tag: t.bool, color: "#0550ae" },
    { tag: t.null, color: "#0550ae" },
    { tag: t.keyword, color: "#8250df" },
    { tag: t.operator, color: "#64748b" },
    { tag: t.className, color: "#953800" },
    { tag: t.definition(t.typeName), color: "#953800" },
    { tag: t.typeName, color: "#953800" },
    { tag: t.propertyName, color: "#0550ae" },
    { tag: t.function(t.variableName), color: "#6639ba" },
    { tag: t.definition(t.variableName), color: "#953800" },
  ],
});

// === Component ===

// Stable default identities so the extensions useMemo doesn't rebuild on
// every render when a caller omits these props.
const NO_FIELDS = [];
const NO_VARS = [];

export default function CodeEditor({ value, onChange, customFields = NO_FIELDS, priorVariables = NO_VARS }) {
  const extensions = useMemo(() => [
    javascript(),
    autocompletion({
      override: [buildCompletionSource({ customFields, priorVariables })],
      defaultKeymap: true,
      activateOnTyping: true,
    }),
    sandboxHover,
    ...buildSandboxLinter({ priorVariables }),
  ], [customFields, priorVariables]);

  // Detect Jira theme mode
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const check = () => {
      setIsDark(document.documentElement.getAttribute("data-color-mode") === "dark");
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-color-mode"] });
    return () => observer.disconnect();
  }, []);

  return (
    <CodeMirror
      value={value || ""}
      onChange={onChange}
      theme={isDark ? leanzeroDark : leanzeroLight}
      extensions={extensions}
      height="auto"
      minHeight="200px"
      maxHeight="600px"
      basicSetup={{
        lineNumbers: true,
        highlightActiveLineGutter: true,
        highlightActiveLine: true,
        foldGutter: true,
        bracketMatching: true,
        closeBrackets: true,
        indentOnInput: true,
        tabSize: 2,
        autocompletion: false, // We provide our own
        searchKeymap: true,
        highlightSelectionMatches: true,
        highlightSpecialChars: true,
        history: true,
        drawSelection: true,
        dropCursor: true,
        allowMultipleSelections: true,
        rectangularSelection: true,
        completionKeymap: true,
        foldKeymap: true,
        historyKeymap: true,
        defaultKeymap: true,
      }}
    />
  );
}
