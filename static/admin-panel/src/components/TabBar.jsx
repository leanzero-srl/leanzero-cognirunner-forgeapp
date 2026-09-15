/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";

export default function TabBar({ tabs, activeTab, onTabChange, isAdmin }) {
  const visible = tabs.filter((t) => !t.adminOnly || isAdmin);
  /* F-957 - render one nowrap <div className="tab-group"> per declared group, in the
     order the tabs are declared. The strip wraps BETWEEN groups, so a narrow window
     never clips a label and never re-shuffles individual tabs. A tab with no group gets
     its own group, which degrades to the old per-tab behaviour rather than to a crash. */
  const groups = [];
  visible.forEach((t, i) => {
    const key = t.group || `solo-${t.key}-${i}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(t);
    else groups.push({ key, items: [t] });
  });
  return (
    <div className="tab-bar">
      {groups.map((g) => (
        <div className="tab-group" key={g.key} data-group={g.key}>
          {g.items.map((t) => (
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
      ))}
    </div>
  );
}
