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
  getApiReferenceRows,
  FIELD_TYPE_TABLE,
  JQL_REFERENCE,
} from "../../../../../src/shared/sandbox-api-spec.js";

// One row per api.* member. A NAMESPACE row (api.confluence) carries its members
// as sub-rows so every member's signature and return shape is visible here, not
// just the namespace summary. The rows come from the one spec helper.
const API_ROWS = getApiReferenceRows();

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
        {API_ROWS.map(({ name, method, members }) =>
          members.length === 0 ? (
            <div key={name} className="api-ref-item">
              <code>{method.signature}</code>
              <span>Returns: <code>{method.returns}</code> — {method.summary}</span>
            </div>
          ) : (
            <div key={name} className="api-ref-ns">
              <div className="api-ref-ns-head">
                <span className="api-ref-ns-chip">api.{name}</span>
                <span className="api-ref-ns-count">{members.length} members</span>
              </div>
              <div className="api-ref-grid api-ref-ns-members">
                {members.map((mem) => (
                  <div key={mem.name} className="api-ref-item">
                    <code>{mem.signature}</code>
                    <span>Returns: <code>{mem.returns}</code> — {mem.summary}</span>
                  </div>
                ))}
              </div>
            </div>
          ),
        )}
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
