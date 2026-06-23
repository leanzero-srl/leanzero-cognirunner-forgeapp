/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import React, { useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";

/**
 * Tooltip rendered via portal at document.body level.
 * Escapes all parent overflow:hidden containers.
 * Auto-positions above or below based on viewport space.
 */
export default function Tooltip({ text, children }) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const [placement, setPlacement] = useState("bottom");
  const triggerRef = useRef(null);

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
        onMouseEnter={show}
        onMouseLeave={hide}
      >
        {children || (
          <span className="tooltip-icon" aria-label="More info">?</span>
        )}
      </span>
      {visible && createPortal(
        <span
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
