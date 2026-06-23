/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";

/**
 * Custom dropdown select matching the LeanZero design system.
 *
 * The open panel is rendered in a PORTAL to document.body with position:fixed and a
 * computed position, so it is never clipped by an ancestor's overflow, never drawn under
 * sibling cards (high z-index, body-level), and always scrolls long lists (max-height +
 * overflow-y). It flips above the trigger when there isn't room below, and repositions on
 * scroll/resize while open.
 *
 * Props:
 *   value, onChange(value), options ([{value,label,meta?,icon?,type?}] or strings),
 *   groups ([{label, filter}]), placeholder, searchable, searchPlaceholder, error, disabled
 */
export default function CustomSelect({
  value,
  onChange,
  options = [],
  groups,
  placeholder = "Select...",
  searchable,
  searchPlaceholder = "Search...",
  error,
  disabled,
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlighted, setHighlighted] = useState(-1);
  // Fixed-position coordinates for the portalled panel.
  const [coords, setCoords] = useState(null); // { left, width, top|bottom, maxHeight, flipUp }
  const wrapRef = useRef(null);
  const panelRef = useRef(null);
  const searchRef = useRef(null);
  const listRef = useRef(null);

  // Normalize options to { value, label, meta, group }
  const normalized = options.map((o) =>
    typeof o === "string" ? { value: o, label: o } : o,
  );

  const showSearch = searchable !== undefined ? searchable : normalized.length >= 10;

  // Filter by search
  const filtered = normalized.filter((o) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      o.label.toLowerCase().includes(q) ||
      o.value.toLowerCase().includes(q) ||
      (o.meta && o.meta.toLowerCase().includes(q))
    );
  });

  // Find selected option's label
  const selectedOpt = normalized.find((o) => o.value === value);

  // Measure the trigger, decide direction, and compute fixed coords for the portal panel.
  const measure = useCallback(() => {
    if (!wrapRef.current) return;
    const r = wrapRef.current.getBoundingClientRect();
    const PANEL_MAX = 300;
    const GAP = 4;
    const spaceBelow = window.innerHeight - r.bottom - 8;
    const spaceAbove = r.top - 8;
    const flipUp = spaceBelow < PANEL_MAX && spaceAbove > spaceBelow;
    setCoords({
      left: Math.round(r.left),
      width: Math.round(r.width),
      top: flipUp ? undefined : Math.round(r.bottom + GAP),
      bottom: flipUp ? Math.round(window.innerHeight - r.top + GAP) : undefined,
      maxHeight: Math.max(160, Math.min(PANEL_MAX, (flipUp ? spaceAbove : spaceBelow))),
      flipUp,
    });
  }, []);

  // Close on outside click — the panel is portalled OUT of wrapRef, so check it separately.
  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && wrapRef.current.contains(e.target)) return;
      if (panelRef.current && panelRef.current.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // On open: measure + focus search; keep the panel pinned to the trigger on scroll/resize.
  useEffect(() => {
    if (!open) return;
    measure();
    if (showSearch && searchRef.current) searchRef.current.focus();
    const reposition = () => measure();
    // capture:true so we also catch scrolling of inner scroll containers (cards/tab panes).
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, showSearch, measure]);

  // Reset highlight on search change
  useEffect(() => { setHighlighted(0); }, [search]);

  // Scroll highlighted into view
  useEffect(() => {
    if (!open || highlighted < 0) return;
    const item = listRef.current?.querySelector(`[data-idx="${highlighted}"]`);
    if (item) item.scrollIntoView({ block: "nearest" });
  }, [highlighted, open]);

  const handleKeyDown = (e) => {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((p) => Math.min(p + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((p) => Math.max(p - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlighted >= 0 && highlighted < filtered.length) {
        onChange(filtered[highlighted].value);
        setOpen(false);
        setSearch("");
      }
    }
  };

  const selectOption = (opt) => {
    onChange(opt.value);
    setOpen(false);
    setSearch("");
  };

  const renderItem = (opt, idx) => (
    <div
      key={opt.value}
      data-idx={idx}
      className={`dropdown-item${opt.value === value ? " dropdown-selected" : ""}${idx === highlighted ? " dropdown-highlighted" : ""}`}
      onClick={() => selectOption(opt)}
      onMouseEnter={() => setHighlighted(idx)}
    >
      {opt.icon && <span className="dropdown-item-icon" dangerouslySetInnerHTML={{ __html: opt.icon }} />}
      <span className="dropdown-item-name">{opt.label}</span>
      {opt.meta && <span className="dropdown-item-meta">{opt.meta}</span>}
      {Array.isArray(opt.badges) && opt.badges.map((b, bi) => (
        <span key={bi} className={`dropdown-item-badge dib-${b.tone || "neutral"}`}>{b.text}</span>
      ))}
      {opt.type && <span className="dropdown-item-type">{opt.type}</span>}
    </div>
  );

  const renderItems = () => {
    if (groups && groups.length > 0) {
      return groups.map((g) => {
        const groupItems = filtered.filter(g.filter);
        if (groupItems.length === 0) return null;
        return (
          <React.Fragment key={g.label}>
            <div className="dropdown-group-label">{g.label}</div>
            {groupItems.map((opt) => renderItem(opt, filtered.indexOf(opt)))}
          </React.Fragment>
        );
      });
    }
    return filtered.map((opt, i) => renderItem(opt, i));
  };

  // The open panel, portalled to <body> with fixed positioning (never clipped / under siblings).
  const panel = open && coords ? (
    <div
      className={`dropdown-panel${coords.flipUp ? " dropdown-panel-up" : ""}`}
      ref={panelRef}
      style={{
        position: "fixed",
        left: coords.left,
        right: "auto", // override the class's right:0 so left+width define the box
        width: coords.width,
        ...(coords.flipUp ? { bottom: coords.bottom } : { top: coords.top }),
        maxHeight: coords.maxHeight, // inner .dropdown-list (flex:1, overflow-y:auto) scrolls
        zIndex: 100000,
      }}
    >
      {showSearch && (
        <div className="dropdown-search">
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
          />
        </div>
      )}
      <div className="dropdown-list" ref={listRef}>
        {filtered.length === 0 ? (
          <div className="dropdown-empty">No results found</div>
        ) : (
          renderItems()
        )}
      </div>
    </div>
  ) : null;

  return (
    <div className="dropdown" ref={wrapRef} onKeyDown={handleKeyDown}>
      <button
        type="button"
        className={`dropdown-trigger${open ? " dropdown-open" : ""}${error ? " dropdown-error" : ""}${disabled ? " dropdown-disabled" : ""}`}
        onClick={() => { if (!disabled) { setOpen((o) => !o); setSearch(""); } }}
        disabled={disabled}
      >
        {selectedOpt ? (
          <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {selectedOpt.icon && <span className="dropdown-item-icon" dangerouslySetInnerHTML={{ __html: selectedOpt.icon }} />}
            {selectedOpt.label}
          </span>
        ) : (
          <span className="dropdown-placeholder">{placeholder}</span>
        )}
        <span className="dropdown-chevron">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </button>
      {typeof document !== "undefined" && createPortal(panel, document.body)}
    </div>
  );
}
