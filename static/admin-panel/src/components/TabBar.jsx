/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import React from "react";

export default function TabBar({ tabs, activeTab, onTabChange, isAdmin }) {
  return (
    <div className="tab-bar">
      {tabs
        .filter((t) => !t.adminOnly || isAdmin)
        .map((t) => (
          <button
            key={t.key}
            className={`tab-btn ${activeTab === t.key ? "tab-active" : ""}`}
            onClick={() => onTabChange(t.key)}
          >
            {t.icon && <span className="tab-icon">{t.icon}</span>}
            {t.label}
          </button>
        ))}
    </div>
  );
}
