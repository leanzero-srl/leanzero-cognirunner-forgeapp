/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from "react";
import { EVENT_CATEGORIES, JIRA_EVENTS, eventsByCategory, getEvent } from "../../../../src/shared/jira-events.js";

// Grouped, searchable multi-select over the Jira event catalogue (single source:
// src/shared/jira-events.js). Selected events render as solid category-coloured
// chips; high-volume events carry a loud warning badge.
export default function EventPicker({ value = [], onChange, disabled = false }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(() => new Set(["issue", "comment"]));
  const selected = useMemo(() => new Set(value), [value]);
  const groups = useMemo(() => eventsByCategory(), []);
  const q = query.trim().toLowerCase();

  const toggle = (id) => {
    if (disabled) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange(JIRA_EVENTS.filter((e) => next.has(e.id)).map((e) => e.id));
  };
  const toggleGroup = (cat) => {
    const next = new Set(open);
    if (next.has(cat)) next.delete(cat); else next.add(cat);
    setOpen(next);
  };
  const selectAllIn = (cat, on) => {
    if (disabled) return;
    const ids = JIRA_EVENTS.filter((e) => e.category === cat).map((e) => e.id);
    const next = new Set(selected);
    for (const id of ids) { if (on) next.add(id); else next.delete(id); }
    onChange(JIRA_EVENTS.filter((e) => next.has(e.id)).map((e) => e.id));
  };
  const hueOf = (cat) => (EVENT_CATEGORIES.find((c) => c.id === cat) || {}).hue || "#475569";

  return (
    <div className={`evp ${disabled ? "evp-disabled" : ""}`}>
      <div className="evp-selected">
        {value.length === 0 && <span className="evp-none">No events selected — pick at least one below.</span>}
        {value.map((id) => {
          const e = getEvent(id);
          return (
            <span key={id} className="evp-chip" style={{ background: hueOf(e ? e.category : "") }} title={e ? e.description : id}>
              {e ? e.label : id}
              {e && e.volume === "high" && <span className="evp-chip-vol">HIGH VOLUME</span>}
              {!disabled && <button type="button" className="evp-chip-x" aria-label={`Remove ${e ? e.label : id}`} onClick={() => toggle(id)}>×</button>}
            </span>
          );
        })}
      </div>
      <input
        className="evp-search"
        type="text"
        placeholder="Search events (e.g. comment, sprint, version)…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search events"
        disabled={disabled}
      />
      <div className="evp-groups">
        {groups.map((g) => {
          const rows = q ? g.events.filter((e) => `${e.label} ${e.id} ${e.description}`.toLowerCase().includes(q)) : g.events;
          if (!rows.length) return null;
          const isOpen = q ? true : open.has(g.id);
          const count = g.events.filter((e) => selected.has(e.id)).length;
          return (
            <div key={g.id} className="evp-group">
              <div className="evp-group-head">
                <button type="button" className="evp-group-toggle" onClick={() => toggleGroup(g.id)} aria-expanded={isOpen}>
                  <span className="evp-group-dot" style={{ background: g.hue }} />
                  <span className="evp-group-label">{g.label}</span>
                  <span className="evp-group-count">{count}/{g.events.length}</span>
                  <span className={`evp-caret ${isOpen ? "open" : ""}`}>▾</span>
                </button>
                {!disabled && (
                  <span className="evp-group-actions">
                    <button type="button" className="evp-link" onClick={() => selectAllIn(g.id, true)}>all</button>
                    <button type="button" className="evp-link" onClick={() => selectAllIn(g.id, false)}>none</button>
                  </span>
                )}
              </div>
              {isOpen && (
                <div className="evp-rows">
                  {rows.map((e) => (
                    <label key={e.id} className={`evp-row ${selected.has(e.id) ? "on" : ""}`} title={e.id}>
                      <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggle(e.id)} disabled={disabled} />
                      <span className="evp-row-main">
                        <span className="evp-row-label">{e.label}</span>
                        <span className="evp-row-desc">{e.description}</span>
                      </span>
                      {e.volume === "high" && <span className="evp-vol">HIGH VOLUME</span>}
                      <code className="evp-row-id">{e.id}</code>
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
