/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import React from "react";

/**
 * Skeleton loading placeholder with shimmer animation.
 *
 * Variants:
 *   "text"   — single line (default)
 *   "block"  — rectangular block (card, field area)
 *   "circle" — avatar placeholder
 *   "form"   — label + input skeleton
 *   "table"  — multi-row table skeleton
 *   "card"   — full card skeleton with header + lines
 */
export default function Skeleton({ variant = "text", rows = 3, width, height }) {
  if (variant === "circle") {
    return <div className="sk sk-circle" style={{ width: width || 32, height: height || 32 }} />;
  }

  if (variant === "text") {
    return <div className="sk sk-text" style={{ width: width || "100%", height: height || 14 }} />;
  }

  if (variant === "block") {
    return <div className="sk sk-block" style={{ width: width || "100%", height: height || 40 }} />;
  }

  if (variant === "form") {
    return (
      <div className="sk-form">
        <div className="sk sk-text" style={{ width: 80, height: 10, marginBottom: 8 }} />
        <div className="sk sk-block" style={{ width: "100%", height: 40 }} />
      </div>
    );
  }

  if (variant === "table") {
    return (
      <div className="sk-table">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="sk-table-row">
            <div className="sk sk-text" style={{ width: "25%", height: 12 }} />
            <div className="sk sk-text" style={{ width: "45%", height: 12 }} />
            <div className="sk sk-text" style={{ width: "20%", height: 12 }} />
          </div>
        ))}
      </div>
    );
  }

  if (variant === "card") {
    return (
      <div className="sk-card">
        <div className="sk-card-header">
          <div className="sk sk-circle" style={{ width: 36, height: 36 }} />
          <div style={{ flex: 1 }}>
            <div className="sk sk-text" style={{ width: "60%", height: 14, marginBottom: 6 }} />
            <div className="sk sk-text" style={{ width: "40%", height: 10 }} />
          </div>
        </div>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="sk sk-text" style={{ width: `${85 - i * 15}%`, height: 12, marginTop: 10 }} />
        ))}
      </div>
    );
  }

  return <div className="sk sk-text" />;
}

/**
 * Full-page loading skeleton matching config-ui layout.
 */
export function ConfigSkeleton() {
  return (
    <div className="sk-config">
      <div className="sk-config-header">
        <div className="sk sk-circle" style={{ width: 40, height: 40 }} />
        <div style={{ flex: 1 }}>
          <div className="sk sk-text" style={{ width: "50%", height: 16, marginBottom: 6 }} />
          <div className="sk sk-text" style={{ width: "70%", height: 12 }} />
        </div>
      </div>
      <div className="sk-config-cards">
        <div className="sk sk-block" style={{ height: 60, borderRadius: 10 }} />
        <div className="sk sk-block" style={{ height: 60, borderRadius: 10 }} />
      </div>
      <div className="sk-config-form">
        <Skeleton variant="form" />
        <div style={{ marginTop: 20 }}><Skeleton variant="form" /></div>
        <div style={{ marginTop: 20 }}><Skeleton variant="form" /></div>
      </div>
    </div>
  );
}
