/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import React, { useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";

// Stable per-instance id for aria-describedby wiring (no Math.random / no useId
// dependency — a module counter is unique enough within a page).
let _ttSeq = 0;

/**
 * Tooltip rendered via portal at document.body level.
 * Escapes all parent overflow:hidden containers.
 * Auto-positions above or below based on viewport space.
 * Keyboard-accessible: the trigger is focusable and shows on focus as well as
 * hover, wires aria-describedby to the bubble, and dismisses on Escape (WCAG
 * 2.1.1 keyboard + 1.4.13 dismissible) — much instructional copy lives only here.
 */
export default function Tooltip({ text, children }) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const [placement, setPlacement] = useState("bottom");
  const triggerRef = useRef(null);
  const idRef = useRef(null);
  if (idRef.current === null) idRef.current = `cr-tip-${++_ttSeq}`;
  const tipId = idRef.current;

  const show = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const bubbleHeight = 120;
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;

    if (spaceBelow < bubbleHeight && spaceAbove > spaceBelow) {
      setPlacement("top");
      setCoords({
        top: rect.top + window.scrollY - 10,
        left: rect.left + rect.width / 2 + window.scrollX,
      });
    } else {
      setPlacement("bottom");
      setCoords({
        top: rect.bottom + window.scrollY + 10,
        left: rect.left + rect.width / 2 + window.scrollX,
      });
    }
    setVisible(true);
  }, []);

  const hide = useCallback(() => setVisible(false), []);

  return (
    <>
      <span
        className="tooltip-wrap"
        ref={triggerRef}
        tabIndex={0}
        aria-describedby={visible ? tipId : undefined}
        aria-label={children ? undefined : "More info"}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onKeyDown={(e) => { if (e.key === "Escape") hide(); }}
      >
        {children || (
          <span className="tooltip-icon">?</span>
        )}
      </span>
      {visible && createPortal(
        <span
          id={tipId}
          className={`tooltip-bubble tooltip-portal tooltip-${placement}`}
          role="tooltip"
          style={{
            top: `${coords.top}px`,
            left: `${coords.left}px`,
          }}
        >
          {text}
        </span>,
        document.body,
      )}
    </>
  );
}
