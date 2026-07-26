/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * API reference panel rendered from the shared sandbox API spec instead of
 * hardcoded JSX, so it never drifts from the backend's actual API surface.
 * Reuses the existing api-ref-* classes — zero new CSS.
 */

import React from "react";
import {
  SANDBOX_API_METHODS,
  FIELD_TYPE_TABLE,
  JQL_REFERENCE,
} from "../../../../../src/shared/sandbox-api-spec.js";

// Renders a spec string with `backtick` segments as <code> elements.
const renderInline = (text) => {
  const parts = String(text || "").split("`");
  return parts.map((part, i) =>
    i % 2 === 1 ? <code key={i}>{part}</code> : <React.Fragment key={i}>{part}</React.Fragment>,
  );
};

export default function ApiReferencePanel() {
  return (
    <div className="api-ref-panel">
      <div className="api-ref-title">Sandbox API</div>
      <div className="api-ref-grid">
        {SANDBOX_API_METHODS.map((m) => (
          <div key={m.name} className="api-ref-item">
            <code>{m.signature}</code>
            <span>Returns: <code>{m.returns}</code> — {m.summary}</span>
          </div>
        ))}
      </div>

      <div className="api-ref-title" style={{ marginTop: "12px" }}>Field Update Formats</div>
      <div className="api-ref-grid">
        {FIELD_TYPE_TABLE.map((row) => (
          <div key={row.fieldType} className="api-ref-item">
            <code>{row.fieldType}</code>
            <span>{renderInline(row.write)}</span>
          </div>
        ))}
      </div>

      <div className="api-ref-title" style={{ marginTop: "12px" }}>JQL Quick Reference</div>
      <div className="api-ref-grid">
        {JQL_REFERENCE.map((row) => (
          <div key={row.code} className="api-ref-item">
            <code>{row.code}</code>
            <span>{row.doc}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
