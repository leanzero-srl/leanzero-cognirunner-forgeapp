/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import React, { useState, useEffect, useRef } from "react";
import TabBar from "./components/TabBar";
import DocsTab from "./components/DocsTab";
import SkillsAdminTab from "./components/SkillsAdminTab";
import MemoriesAdminTab from "./components/MemoriesAdminTab";
import PermissionsTab from "./components/PermissionsTab";
import SettingsOpenAITab from "./components/SettingsOpenAITab";
import CustomSelect from "./components/CustomSelect";
import { findRule as findPremadeRule } from "../../../src/shared/premade-rules-catalog.js";
import { buildFactsText, ruleKindEnum } from "../../../src/shared/explain-facts.js";
import AddRuleWizard from "./components/AddRuleWizard";
import Tooltip from "./components/Tooltip";
import { showToast } from "./components/toast";
import { confirmDialog } from "./confirmDialog";

const injectStyles = () => {
  if (document.getElementById("app-styles")) return;

  const style = document.createElement("style");
  style.id = "app-styles";
  style.textContent = `
    :root {
      --bg-color: transparent;
      --text-color: #0f172a;
      --text-secondary: #64748b;
      --text-muted: #94a3b8;
      --primary-color: #2563eb;
      --error-color: #dc2626;
      --success-color: #16a34a;
      --border-color: #cbd5e1;
      --card-bg: #ffffff;
      --input-bg: #f8fafc;
      --code-bg: #f1f5f9;
      --icon-bg: #dbeafe;
      --hover-bg: #f1f5f9;
    }

    html[data-color-mode="dark"] {
      --bg-color: transparent;
      --text-color: #F5F5F7;
      --text-secondary: #A0A0B0;
      --text-muted: #71717a;
      --primary-color: #3b82f6;
      --error-color: #ef4444;
      --success-color: #22c55e;
      --border-color: #374151;
      --card-bg: #13131A;
      --input-bg: #0A0A0F;
      --code-bg: #0A0A0F;
      --icon-bg: #1e3a5f;
      --hover-bg: #1f1f2e;
    }

    *, *::before, *::after { box-sizing: border-box; }

    html, body {
      margin: 0;
      padding: 0;
      font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: var(--bg-color);
      color: var(--text-color);
      font-size: 14px;
      line-height: 1.5;
    }

    .container { padding: 24px; max-width: 960px; margin: 0 auto; }

    .header {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 24px;
    }

    .icon-wrapper {
      padding: 10px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      background-color: var(--icon-bg);
      color: var(--primary-color);
    }

    .title {
      margin: 0 0 4px 0;
      font-size: 20px;
      font-weight: 600;
      line-height: 1.25;
      color: var(--text-color);
    }

    .subtitle {
      margin: 0;
      font-size: 13px;
      line-height: 1.4;
      color: var(--text-secondary);
    }

    .license-banner {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 10px 14px;
      border-radius: 4px;
      font-size: 13px;
      margin-bottom: 20px;
      border: 1px solid;
    }

    .license-active {
      background: rgba(22, 163, 106, 0.1);
      border-color: var(--success-color);
      color: var(--success-color);
    }

    .license-inactive {
      background: rgba(220, 38, 38, 0.1);
      border-color: var(--error-color);
      color: var(--error-color);
    }

    .section {
      margin-bottom: 24px;
    }

    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }

    .section-title {
      font-weight: 600;
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-secondary);
    }

    .section-actions {
      display: flex;
      gap: 8px;
    }

    .btn-small {
      padding: 6px 12px;
      font-size: 12px;
      border: 1px solid var(--border-color);
      border-radius: 4px;
      background: var(--card-bg);
      color: var(--text-color);
      cursor: pointer;
    }

    .btn-small:hover:not(:disabled) { background: var(--hover-bg); }
    .btn-small:disabled { opacity: 0.6; cursor: default; }

    .btn-danger {
      color: var(--error-color);
      border-color: var(--error-color);
    }

    .btn-danger:hover {
      background: rgba(220, 38, 38, 0.1);
    }

    .card {
      border: 1px solid var(--border-color);
      border-radius: 8px;
      background-color: var(--card-bg);
    }

    .table {
      width: 100%;
      border-collapse: collapse;
    }

    .table th {
      text-align: left;
      padding: 10px 14px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
      background: var(--code-bg);
      border-bottom: 1px solid var(--border-color);
    }

    .table td {
      padding: 10px 14px;
      font-size: 13px;
      border-bottom: 1px solid var(--border-color);
      vertical-align: top;
    }

    .table tr:last-child td { border-bottom: none; }
    .table tr:hover td { background: var(--hover-bg); }

    .workflow-info {
      font-size: 12px;
      line-height: 1.4;
    }

    .workflow-name {
      font-weight: 600;
      color: var(--text-color);
    }

    .transition-info {
      color: var(--text-muted);
      font-size: 11px;
      margin-top: 2px;
    }

    .no-workflow-info {
      color: var(--text-muted);
      font-size: 11px;
      font-style: italic;
    }

    .btn-edit {
      color: var(--primary-color);
      border-color: var(--primary-color);
    }

    .btn-edit:hover {
      background: rgba(37, 99, 235, 0.1);
    }

    .row-actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }

    /* Per-rule "Explain this rule" in the Rules table — solid accent button, an
       independent full-width explanation row with an inset card. Admin tokens only
       (each has a dark variant), so both themes are covered. No left rail/faded tint. */
    .rule-explain-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      color: #ffffff;
      background: var(--primary-color);
      border-color: var(--primary-color);
    }
    .rule-explain-btn:hover:not(:disabled) { opacity: 0.9; }
    .rule-explain-row td { padding: 0 12px 10px; }
    .rule-explain-card {
      padding: 10px 12px;
      background: var(--code-bg);
      border: 1px solid var(--border-color);
      border-radius: 10px;
    }
    .rule-explain-eyebrow {
      font-family: SFMono-Regular, Consolas, monospace;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      color: var(--primary-color);
      margin-bottom: 5px;
    }
    .rule-explain-text {
      font-size: 13px;
      line-height: 1.5;
      color: var(--text-color);
    }
    .rule-explain-note {
      font-size: 12px;
      line-height: 1.5;
      color: var(--text-secondary);
    }

    /* Per-tab intro banner — one plain "what this is" line so the concept-heavy
       admin panel reads clearly. Inset card + mono eyebrow; no left rail, no faded tint. */
    .tab-intro {
      display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap;
      padding: 10px 14px; margin: 14px 0 2px;
      background: var(--code-bg); border: 1px solid var(--border-color); border-radius: 8px;
    }
    .tab-intro-eyebrow {
      font-family: SFMono-Regular, Consolas, monospace; font-size: 10px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.14em; color: var(--primary-color); flex-shrink: 0;
    }
    .tab-intro-what { font-size: 12.5px; line-height: 1.5; color: var(--text-secondary); }

    .row-disabled td {
      opacity: 0.55;
    }

    .row-disabled td:last-child {
      opacity: 1;
    }

    .status-badge {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 9px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-left: 6px;
      vertical-align: middle;
    }

    .status-disabled {
      background: rgba(220, 38, 38, 0.1);
      color: var(--error-color);
    }

    .btn-enable {
      color: var(--success-color);
      border-color: var(--success-color);
    }

    .btn-enable:hover {
      background: rgba(22, 163, 106, 0.1);
    }

    .type-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 3px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    /* Solid hue-coded fills (white text) matching the execution-log badge
       system: validator blue, condition purple, PF semantic teal, PF static
       slate. One shade lighter in dark mode. */
    .type-validator { background: #2563eb; color: #ffffff; }
    .type-condition { background: #7c3aed; color: #ffffff; }
    .type-postfunction { background: #0d9488; color: #ffffff; }
    .type-pf-static { background: #475569; color: #ffffff; }
    html[data-color-mode="dark"] .type-validator { background: #3b82f6; }
    html[data-color-mode="dark"] .type-condition { background: #8b5cf6; }
    html[data-color-mode="dark"] .type-postfunction { background: #14b8a6; }
    html[data-color-mode="dark"] .type-pf-static { background: #64748b; }

    .field-id {
      font-family: SFMono-Regular, Consolas, monospace;
      font-size: 12px;
      padding: 2px 6px;
      border-radius: 3px;
      background: var(--code-bg);
      color: var(--primary-color);
    }

    .prompt-text {
      color: var(--text-color);
      word-break: break-word;
    }

    .timestamp {
      font-size: 11px;
      color: var(--text-muted);
      white-space: nowrap;
    }

    .empty-state {
      padding: 32px;
      text-align: center;
      color: var(--text-muted);
      font-size: 13px;
    }

    .log-entry {
      padding: 12px 14px;
      border-bottom: 1px solid var(--border-color);
      font-size: 12px;
    }

    .log-entry:last-child { border-bottom: none; }

    .log-header {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 6px;
    }

    .log-status {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 46px;
      padding: 2px 8px;
      border-radius: 6px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.6px;
      text-transform: uppercase;
      color: #ffffff;
      flex-shrink: 0;
    }

    .log-status.valid { background: #16a34a; }
    .log-status.invalid { background: #dc2626; }
    .log-status.skip { background: #475569; }
    html[data-color-mode="dark"] .log-status.valid { background: #22c55e; }
    html[data-color-mode="dark"] .log-status.invalid { background: #ef4444; }
    html[data-color-mode="dark"] .log-status.skip { background: #64748b; }

    /* Hue-coded solid type badges — logs context only
       (the rules table keeps its own .type-badge styling) */
    .log-type-badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      border-radius: 6px;
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      color: #ffffff;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .lt-validator { background: #2563eb; }
    .lt-condition { background: #7c3aed; }
    .lt-pf, .lt-pf-semantic { background: #0d9488; }
    .lt-pf-static { background: #475569; }
    html[data-color-mode="dark"] .lt-validator { background: #3b82f6; }
    html[data-color-mode="dark"] .lt-condition { background: #8b5cf6; }
    html[data-color-mode="dark"] .lt-pf, html[data-color-mode="dark"] .lt-pf-semantic { background: #14b8a6; }
    html[data-color-mode="dark"] .lt-pf-static { background: #64748b; }

    .log-issue {
      font-family: SFMono-Regular, Consolas, monospace;
      font-size: 12px;
      font-weight: 600;
      color: var(--primary-color);
    }

    .log-meta {
      margin-left: auto;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
    }

    .log-ms {
      font-family: SFMono-Regular, Consolas, monospace;
      font-size: 10px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      padding: 1px 6px;
      border-radius: 4px;
      background: var(--code-bg);
      color: var(--text-secondary);
    }

    .log-time {
      color: var(--text-muted);
      font-size: 10px;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
    }

    .log-details {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px 16px;
      margin: 2px 0;
      color: var(--text-secondary);
    }

    .log-kv {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .log-kv-label {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: var(--text-muted);
    }

    .log-section-label {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: var(--text-muted);
      margin: 8px 0 3px;
    }

    .log-reason {
      padding: 8px 10px;
      background: var(--code-bg);
      border-radius: 8px;
      color: var(--text-color);
      font-size: 12px;
      line-height: 1.5;
    }

    .log-foot {
      margin-top: 6px;
      font-size: 10px;
      font-variant-numeric: tabular-nums;
      color: var(--text-muted);
    }

    .logs-list {
      max-height: 400px;
      overflow-y: auto;
      border-radius: inherit;
    }
    /* Paginated logs (Logs tab): no inner scroll — the page bounds the height,
       and the pagination control pages through the 50-entry window. */
    .logs-list-paged { border-radius: inherit; }
    .logs-pagination {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 14px;
      padding: 10px 14px;
      border-top: 1px solid var(--border-color);
    }
    .logs-pagination-info {
      font-size: 12px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      color: var(--text-secondary);
      min-width: 90px;
      text-align: center;
    }
    /* Inline free-text filter for the Rules table + Execution Logs lists. */
    .list-search {
      width: 200px;
      padding: 6px 10px;
      border: 1px solid var(--border-color);
      border-radius: 6px;
      background: var(--input-bg);
      color: var(--text-color);
      font-size: 13px;
    }
    .list-search::placeholder { color: var(--text-muted); }
    .list-search:focus { outline: none; border-color: var(--primary-color); }

    /* === Active Jobs (queued + ongoing async work) === */
    .jobs-list { max-height: 420px; overflow-y: auto; border-radius: inherit; }
    .job-entry {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border-bottom: 1px solid var(--border-color);
    }
    .job-entry:last-child { border-bottom: none; }
    .job-status {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.5px;
      color: #fff;
      padding: 2px 8px;
      border-radius: 5px;
      white-space: nowrap;
    }
    .job-status.queued { background: #0891b2; }
    .job-status.running { background: #06b6d4; }
    .job-status.done { background: #16a34a; }
    .job-status.error { background: #dc2626; }
    .job-status.cancelled { background: #475569; }
    .job-status.stalled { background: #d97706; }
    html[data-color-mode="dark"] .job-status.queued { background: #22d3ee; color: #06283d; }
    html[data-color-mode="dark"] .job-status.running { background: #22d3ee; color: #06283d; }
    html[data-color-mode="dark"] .job-status.done { background: #22c55e; }
    html[data-color-mode="dark"] .job-status.error { background: #ef4444; }
    html[data-color-mode="dark"] .job-status.cancelled { background: #64748b; }
    html[data-color-mode="dark"] .job-status.stalled { background: #f59e0b; color: #2a1602; }
    .job-type-badge {
      font-size: 10px;
      font-weight: 700;
      color: #fff;
      background: #0d9488;
      padding: 2px 8px;
      border-radius: 5px;
      white-space: nowrap;
    }
    html[data-color-mode="dark"] .job-type-badge { background: #14b8a6; }
    .job-rule {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-color);
      max-width: 280px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .job-issue {
      font-family: SFMono-Regular, Consolas, monospace;
      font-size: 12px;
      font-weight: 600;
      color: var(--primary-color);
    }
    .job-provider {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #fff;
      background: #475569;
      padding: 1px 7px;
      border-radius: 4px;
    }
    html[data-color-mode="dark"] .job-provider { background: #64748b; }
    .job-time {
      font-size: 10px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      color: var(--text-muted);
      margin-left: auto;
      white-space: nowrap;
    }
    .job-error { font-size: 11px; color: #dc2626; font-weight: 600; width: 100%; }
    html[data-color-mode="dark"] .job-error { color: #f87171; }
    .job-stop { font-size: 10px; padding: 2px 8px; }
    .job-count-chip {
      display: inline-block;
      margin-left: 8px;
      min-width: 18px;
      text-align: center;
      font-size: 11px;
      font-weight: 700;
      color: #fff;
      background: #06b6d4;
      padding: 1px 7px;
      border-radius: 10px;
      vertical-align: middle;
    }
    html[data-color-mode="dark"] .job-count-chip { background: #22d3ee; color: #06283d; }

    /* Per-rule job chips on a rule row */
    .rule-job-chip {
      display: inline-block;
      margin-left: 6px;
      font-size: 10px;
      font-weight: 700;
      color: #fff;
      padding: 1px 7px;
      border-radius: 9px;
      white-space: nowrap;
    }
    .rule-job-chip.running { background: #06b6d4; }
    .rule-job-chip.queued { background: #0891b2; }
    html[data-color-mode="dark"] .rule-job-chip.running { background: #22d3ee; color: #06283d; }
    html[data-color-mode="dark"] .rule-job-chip.queued { background: #22d3ee; color: #06283d; }

    /* Per-rule expand caret + accordion panel */
    .rule-expand-btn {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--text-muted);
      padding: 2px 6px;
      font-size: 12px;
      display: inline-flex;
      align-items: center;
      transition: transform var(--dur-fast, 140ms) ease;
    }
    .rule-expand-btn.open { transform: rotate(90deg); color: var(--primary-color); }
    .rule-accordion-cell { padding: 0 !important; background: var(--code-bg); }
    .rule-accordion-inner { padding: 12px 16px; }
    .rule-accordion-title {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: var(--text-muted);
      margin: 0 0 8px;
    }

    /* Designed empty state for the logs card */
    .logs-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      padding: 36px 20px;
      text-align: center;
    }
    .logs-empty-icon {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: #2563eb;
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 6px;
    }
    html[data-color-mode="dark"] .logs-empty-icon { background: #3b82f6; }
    .logs-empty-title {
      font-size: 14px;
      font-weight: 700;
      color: var(--text-color);
    }
    .logs-empty-caption {
      font-size: 12px;
      color: var(--text-secondary);
    }

    .loading-spinner {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 40px;
    }

    .spinner {
      width: 32px;
      height: 32px;
      border: 3px solid var(--border-color);
      border-top-color: var(--primary-color);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    .loading-text {
      margin-top: 12px;
      font-size: 13px;
      color: var(--text-secondary);
    }

    .alert {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 10px 14px;
      border-radius: 4px;
      font-size: 13px;
      margin-bottom: 16px;
      border: 1px solid;
    }

    .alert-error {
      background: rgba(222, 53, 11, 0.08);
      border-color: var(--error-color);
      color: var(--error-color);
    }

    .alert-success {
      background: rgba(0, 102, 68, 0.08);
      border-color: var(--success-color);
      color: var(--success-color);
    }

    .alert-warning {
      background: rgba(255, 153, 31, 0.08);
      border-color: #FF991F;
      color: #FF991F;
    }

    html[data-color-mode="dark"] .alert-warning {
      color: #F5CD47;
      border-color: #F5CD47;
    }

    .alert-dismiss {
      margin-left: auto;
      background: none;
      border: none;
      color: inherit;
      cursor: pointer;
      font-size: 16px;
      line-height: 1;
      padding: 0 2px;
      opacity: 0.7;
    }

    .alert-dismiss:hover { opacity: 1; }

    @keyframes spin { to { transform: rotate(360deg); } }

    /* Skeleton shimmer — hardcoded colors for reliable dark mode */
    .sk {
      background: linear-gradient(90deg, rgba(128,128,128,0.1) 25%, rgba(128,128,128,0.18) 50%, rgba(128,128,128,0.1) 75%);
      background-size: 200% 100%;
      animation: skShimmer 1.5s ease-in-out infinite;
      border-radius: 4px;
    }
    html[data-color-mode="light"] .sk {
      background: linear-gradient(90deg, #e2e8f0 25%, #f1f5f9 50%, #e2e8f0 75%);
      background-size: 200% 100%;
    }
    html[data-color-mode="dark"] .sk {
      background: linear-gradient(90deg, #1e1e2e 25%, #2a2a3a 50%, #1e1e2e 75%);
      background-size: 200% 100%;
    }
    @media (prefers-color-scheme: dark) {
      .sk { background: linear-gradient(90deg, #1e1e2e 25%, #2a2a3a 50%, #1e1e2e 75%); background-size: 200% 100%; }
    }
    @keyframes skShimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    .sk-text { border-radius: 6px; }
    .sk-block { border-radius: 8px; }

    /* Permissions tab */
    .perm-tab { }

    .perm-header {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 20px;
    }

    .perm-header-icon {
      padding: 10px;
      border-radius: 12px;
      background: linear-gradient(135deg, var(--icon-bg), rgba(37, 99, 235, 0.12));
      color: var(--primary-color);
      flex-shrink: 0;
      display: flex;
      box-shadow: 0 0 12px rgba(37, 99, 235, 0.1);
    }

    .perm-title {
      margin: 0 0 4px;
      font-size: 16px;
      font-weight: 600;
      color: var(--text-color);
    }

    .perm-subtitle {
      margin: 0;
      font-size: 12px;
      color: var(--text-secondary);
      line-height: 1.5;
    }

    /* Search input */
    .perm-search-wrap {
      position: relative;
      margin-bottom: 16px;
    }

    .perm-search-input-wrap {
      display: flex;
      align-items: center;
      border: 2px solid var(--border-color);
      border-radius: 10px;
      background: var(--input-bg);
      padding: 0 12px;
      transition: all 0.2s ease;
    }
    .perm-search-input-wrap:focus-within {
      border-color: var(--primary-color);
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
    }

    .perm-search-icon { color: var(--text-muted); flex-shrink: 0; }

    .perm-search-input {
      flex: 1;
      border: none;
      background: transparent;
      color: var(--text-color);
      font-size: 13px;
      padding: 10px 10px;
      outline: none;
      font-family: inherit;
    }
    .perm-search-input::placeholder { color: var(--text-muted); }

    .perm-search-loading { font-size: 11px; color: var(--text-muted); white-space: nowrap; }

    .perm-search-clear {
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 18px;
      padding: 0 2px;
      line-height: 1;
    }
    .perm-search-clear:hover { color: var(--text-color); }

    /* Search results dropdown */
    .perm-search-results {
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      right: 0;
      z-index: 50;
      background: var(--card-bg);
      border: 1px solid rgba(37, 99, 235, 0.2);
      border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.12);
      overflow: hidden;
    }
    html[data-color-mode="dark"] .perm-search-results {
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    }

    .perm-search-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      cursor: pointer;
      transition: all 0.15s ease;
      border-bottom: 1px solid var(--border-color);
    }
    .perm-search-item:last-child { border-bottom: none; }
    .perm-search-item:hover { background: var(--code-bg); }
    .perm-search-item:active { background: rgba(37, 99, 235, 0.08); }
    .perm-search-disabled { opacity: 0.5; cursor: default; }
    .perm-search-disabled:hover { background: transparent; }
    .perm-search-adding { opacity: 0.7; cursor: wait; }

    .perm-search-name {
      flex: 1;
      font-size: 13px;
      font-weight: 500;
      color: var(--text-color);
    }

    .perm-search-badge {
      font-size: 10px;
      color: var(--text-muted);
      font-style: italic;
    }

    .perm-search-add-icon {
      color: var(--primary-color);
      opacity: 0;
      transition: opacity 0.15s ease;
    }
    .perm-search-item:hover .perm-search-add-icon { opacity: 1; }

    /* Avatar */
    .perm-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      object-fit: cover;
      flex-shrink: 0;
    }

    .perm-avatar-placeholder {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: linear-gradient(135deg, var(--primary-color), #1d4ed8);
      color: white;
      font-size: 12px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    /* Admin list */
    .perm-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .perm-empty {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 32px;
      color: var(--text-muted);
      font-size: 13px;
      border: 2px dashed var(--border-color);
      border-radius: 12px;
    }

    .perm-admin-card {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border: 1px solid var(--border-color);
      border-radius: 10px;
      background: var(--card-bg);
      transition: all 0.2s ease;
    }
    .perm-admin-card:hover {
      border-color: rgba(37, 99, 235, 0.2);
      box-shadow: 0 2px 8px rgba(0,0,0,0.04);
    }

    .perm-admin-info {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .perm-admin-name {
      font-size: 14px;
      font-weight: 500;
      color: var(--text-color);
    }

    .perm-admin-role {
      font-size: 11px;
      color: var(--text-muted);
    }

    .perm-remove-btn {
      padding: 5px 12px;
      font-size: 11px;
      font-weight: 500;
      border: 1px solid var(--error-color);
      border-radius: 6px;
      background: transparent;
      color: var(--error-color);
      cursor: pointer;
      transition: all 0.2s ease;
      opacity: 0;
    }
    .perm-admin-card:hover .perm-remove-btn { opacity: 1; }
    .perm-remove-btn:hover {
      background: rgba(220, 38, 38, 0.08);
      box-shadow: 0 2px 6px rgba(220, 38, 38, 0.15);
    }
    .perm-remove-btn:disabled { opacity: 0.5; cursor: default; }

    /* Tab bar */
    .tab-bar {
      display: flex;
      gap: 0;
      margin-bottom: 20px;
      border-bottom: 2px solid var(--border-color);
    }

    .tab-btn {
      padding: 10px 20px;
      font-size: 13px;
      font-weight: 500;
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      margin-bottom: -2px;
      color: var(--text-secondary);
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .tab-btn:hover { color: var(--text-color); }

    .tab-active {
      color: var(--primary-color);
      border-bottom-color: var(--primary-color);
      font-weight: 600;
    }

    /* Custom dropdown */
    .dropdown { position: relative; }

    .dropdown-trigger {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 14px;
      font-size: 13px;
      border: 1px solid var(--border-color);
      border-radius: 10px;
      background-color: var(--input-bg);
      color: var(--text-color);
      cursor: pointer;
      outline: none;
      text-align: left;
      font-family: inherit;
      transition: all 0.2s ease;
    }
    .dropdown-trigger:hover {
      border-color: rgba(37, 99, 235, 0.4);
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.08);
    }
    .dropdown-trigger.dropdown-open {
      border-color: var(--primary-color);
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
    }
    .dropdown-trigger.dropdown-error { border-color: var(--error-color); box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.1); }
    .dropdown-trigger.dropdown-disabled { opacity: 0.5; cursor: default; pointer-events: none; }
    .dropdown-placeholder { color: var(--text-muted); }
    .dropdown-chevron {
      display: flex; color: var(--text-muted);
      transition: transform 0.2s ease;
    }
    .dropdown-trigger.dropdown-open .dropdown-chevron { transform: rotate(180deg); }

    .dropdown-panel {
      position: absolute;
      top: calc(100% + 6px);
      left: 0;
      right: 0;
      z-index: 50;
      max-height: 280px;
      display: flex;
      flex-direction: column;
      background-color: var(--card-bg);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(255, 255, 255, 0.04);
      overflow: hidden;
      animation: dropdownSlideIn 0.15s ease;
    }
    @keyframes dropdownSlideIn {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    html[data-color-mode="dark"] .dropdown-panel {
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.06);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
    }

    .dropdown-panel-up {
      top: auto;
      bottom: calc(100% + 6px);
      animation-name: dropdownSlideInUp;
    }
    @keyframes dropdownSlideInUp {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .dropdown-search {
      padding: 8px;
      border-bottom: 1px solid var(--border-color);
      flex-shrink: 0;
    }
    .dropdown-search input {
      width: 100%;
      padding: 8px 10px;
      font-size: 13px;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      background-color: var(--input-bg);
      color: var(--text-color);
      outline: none;
      font-family: inherit;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .dropdown-search input:focus {
      border-color: var(--primary-color);
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
    }
    .dropdown-search input::placeholder { color: var(--text-muted); }

    .dropdown-list {
      overflow-y: auto;
      flex: 1;
      padding: 4px;
    }

    .dropdown-group-label {
      padding: 6px 10px 4px;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: var(--text-muted);
      position: sticky;
      top: 0;
      background-color: var(--card-bg);
    }

    .dropdown-item {
      padding: 8px 10px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      border-radius: 8px;
      margin: 1px 0;
      transition: all 0.12s ease;
      position: relative;
    }
    .dropdown-item:hover, .dropdown-item.dropdown-highlighted {
      background-color: var(--hover-bg);
    }
    .dropdown-item.dropdown-selected {
      background-color: var(--primary-color);
      color: #ffffff;
    }
    .dropdown-item.dropdown-selected::after {
      content: '';
      position: absolute;
      right: 10px;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background-color: #ffffff;
    }
    .dropdown-item-icon { display: inline-flex; align-items: center; flex-shrink: 0; line-height: 0; }
    .dropdown-item-icon svg { width: 16px; height: 16px; }
    .dropdown-item-name { font-size: 13px; color: var(--text-color); flex-shrink: 0; }
    .dropdown-item.dropdown-selected .dropdown-item-name { color: #ffffff; font-weight: 500; }
    .dropdown-item-meta {
      font-size: 11px;
      color: var(--text-muted);
      font-family: SFMono-Regular, Consolas, monospace;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dropdown-item-type {
      margin-left: auto;
      flex-shrink: 0;
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 4px;
      background-color: var(--code-bg);
      color: var(--text-muted);
    }
    .dropdown-item.dropdown-selected .dropdown-item-type { background-color: rgba(37, 99, 235, 0.06); }
    /* Solid saturated state/capability badges in option rows (LM Studio model
       picker). No faded tints — white text on saturated fills per the mandate. */
    .dropdown-item-badge {
      flex-shrink: 0;
      margin-left: 4px;
      font-size: 10px;
      font-weight: 700;
      padding: 1px 7px;
      border-radius: 5px;
      color: #fff;
      white-space: nowrap;
    }
    .dropdown-item-badge:first-of-type ~ .dropdown-item-badge { margin-left: 4px; }
    .dib-loaded { background: #16a34a; }
    .dib-cold { background: #475569; }
    .dib-info { background: #0d9488; }
    .dib-device { background: #334155; }
    html[data-color-mode="dark"] .dib-loaded { background: #22c55e; color: #052e16; }
    html[data-color-mode="dark"] .dib-cold { background: #64748b; }
    html[data-color-mode="dark"] .dib-info { background: #14b8a6; color: #042f2a; }
    html[data-color-mode="dark"] .dib-device { background: #475569; }
    .dropdown-empty { padding: 16px 12px; text-align: center; color: var(--text-muted); font-size: 13px; }

    /* === Tooltip === */
    .tooltip-wrap {
      position: relative;
      display: inline-flex;
      align-items: center;
      margin-left: 6px;
      vertical-align: middle;
    }
    .tooltip-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: var(--primary-color);
      color: #fff;
      font-size: 9px;
      font-weight: 700;
      cursor: help;
      line-height: 1;
      opacity: 0.7;
      transition: opacity 0.15s ease;
    }
    .tooltip-wrap:hover .tooltip-icon { opacity: 1; }
    .tooltip-portal {
      position: absolute;
      transform: translateX(-50%);
      z-index: 99999;
      padding: 9px 12px;
      border-radius: 9px;
      background: #0f172a;
      color: #f1f5f9;
      font-size: 12.5px;
      font-weight: 400;
      font-style: normal;
      line-height: 1.5;
      letter-spacing: normal;
      text-transform: none;
      white-space: normal;
      width: max-content;
      max-width: min(300px, calc(100vw - 32px));
      pointer-events: none;
      box-shadow: 0 10px 28px -6px rgba(15, 23, 42, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.10);
      animation: tooltipFadeIn 0.15s ease;
    }
    html[data-color-mode="dark"] .tooltip-portal {
      background: #1e293b;
      color: #f1f5f9;
      box-shadow: 0 12px 32px -6px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.12);
    }
    .tooltip-portal::after {
      content: '';
      position: absolute;
      left: 50%;
      transform: translateX(-50%);
      border: 6px solid transparent;
    }
    .tooltip-bottom::after { bottom: 100%; border-bottom-color: #0f172a; }
    html[data-color-mode="dark"] .tooltip-bottom::after { border-bottom-color: #1e293b; }
    .tooltip-top::after { top: 100%; border-top-color: #0f172a; }
    html[data-color-mode="dark"] .tooltip-top::after { border-top-color: #1e293b; }
    @keyframes tooltipFadeIn {
      from { opacity: 0; transform: translateX(-50%) translateY(4px); }
      to { opacity: 1; transform: translateX(-50%) translateY(0); }
    }
    .tooltip-top.tooltip-portal { animation-name: tooltipFadeInUp; }
    @keyframes tooltipFadeInUp {
      from { opacity: 0; transform: translateX(-50%) translateY(-4px); }
      to { opacity: 1; transform: translateX(-50%) translateY(0); }
    }

    /* === Add Rule Wizard === */
    .wizard { margin-bottom: 16px; }
    .wizard-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 16px 20px; border-bottom: 1px solid var(--border-color);
    }
    .wizard-header-left { display: flex; align-items: center; gap: 12px; }
    .wizard-icon {
      width: 36px; height: 36px; border-radius: 10px; display: flex; align-items: center; justify-content: center;
      background: linear-gradient(135deg, var(--icon-bg), rgba(37, 99, 235, 0.12));
    }
    .wizard-title { font-size: 15px; font-weight: 700; margin: 0; }
    .wizard-subtitle { font-size: 11px; color: var(--text-muted); margin: 2px 0 0 0; }
    .wizard-body { padding: 16px 20px; }
    .wizard-breadcrumb {
      display: flex; gap: 12px; margin-bottom: 16px; font-size: 12px; color: var(--text-secondary);
      padding: 8px 0; border-bottom: 1px solid var(--border-color);
    }
    .wizard-breadcrumb span { transition: color 0.15s ease; }
    .wizard-breadcrumb .wiz-step-done { cursor: pointer; color: var(--primary-color); }
    .wizard-breadcrumb .wiz-step-done:hover { text-decoration: underline; }
    .wizard-breadcrumb .wiz-step-active { font-weight: 700; color: var(--text-color); }
    .wizard-breadcrumb .wiz-step-future { opacity: 0.4; }
    .wizard-breadcrumb .wiz-sep { opacity: 0.3; }
    .wiz-section { margin-bottom: 14px; }
    .wiz-label {
      display: block; font-size: 12px; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px;
    }
    .wiz-label .wiz-req { color: var(--error-color); }
    .wiz-hint { margin: 4px 0 0 0; font-size: 11px; color: var(--text-muted); }
    .wiz-selected {
      display: flex; align-items: center; gap: 8px; font-size: 12px;
    }
    .wiz-change {
      font-size: 10px; padding: 2px 8px; border: 1px solid var(--border-color); border-radius: 4px;
      background: var(--input-bg); color: var(--text-secondary); cursor: pointer; transition: all 0.15s ease;
    }
    .wiz-change:hover { border-color: var(--primary-color); color: var(--primary-color); }
    .wiz-pick-btn {
      display: flex; align-items: center; justify-content: space-between; width: 100%;
      padding: 10px 14px; border: 1px solid var(--border-color); border-radius: 8px;
      background: var(--input-bg); color: var(--text-color); cursor: pointer;
      transition: all 0.15s ease; font-size: 13px; text-align: left;
    }
    .wiz-pick-btn:hover { border-color: var(--primary-color); background: var(--hover-bg); }
    .wiz-pick-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 6px; }
    .wiz-pick-list { display: flex; flex-direction: column; gap: 6px; }
    .wiz-pick-name { font-weight: 600; }
    .wiz-pick-meta { font-size: 11px; color: var(--text-muted); }
    .wiz-pick-chevron { opacity: 0.4; }
    .wiz-status-pill {
      display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 500;
    }
    .wiz-status-from { background: rgba(100,116,139,0.1); color: var(--text-secondary); }
    .wiz-status-to { background: rgba(37,99,235,0.1); color: var(--primary-color); }
    .wiz-status-initial { background: rgba(22,163,106,0.1); color: var(--success-color); }
    .wiz-cogni-badge {
      font-size: 9px; padding: 2px 6px; border-radius: 4px; font-weight: 600;
      background: rgba(37,99,235,0.12); color: var(--primary-color); letter-spacing: 0.3px;
    }
    .wiz-type-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .wiz-type-card {
      display: flex; flex-direction: column; align-items: flex-start; gap: 6px;
      padding: 14px 16px; border: 1px solid var(--border-color); border-radius: 8px;
      background: var(--input-bg); color: var(--text-color); cursor: pointer;
      transition: all 0.15s ease; text-align: left;
    }
    .wiz-type-card:hover { border-color: var(--primary-color); background: var(--hover-bg); }
    .wiz-type-desc { font-size: 12px; color: var(--text-secondary); line-height: 1.3; }
    .wiz-info-banner {
      display: flex; align-items: flex-start; gap: 10px; padding: 10px 14px; margin-bottom: 14px;
      border-radius: 8px; border: 1px solid var(--border-color); background: var(--input-bg);
    }
    .wiz-info-banner ol { margin: 0; padding-left: 18px; font-size: 12px; color: var(--text-secondary); line-height: 1.6; }
    .wiz-textarea {
      width: 100%; font-size: 13px; padding: 8px 12px; border: 1px solid var(--border-color);
      border-radius: 8px; background: var(--input-bg); color: var(--text-color);
      resize: vertical; font-family: inherit; line-height: 1.5;
    }
    .wiz-textarea:focus { outline: none; border-color: var(--primary-color); box-shadow: 0 0 0 3px rgba(37,99,235,0.1); }
    .wiz-textarea.wiz-error { border-color: var(--error-color); }
    .wiz-textarea.wiz-error:focus { box-shadow: 0 0 0 3px rgba(220,38,38,0.1); }
    .wiz-input {
      padding: 8px 12px; border: 1px solid var(--border-color); border-radius: 8px;
      background: var(--input-bg); color: var(--text-color); font-size: 13px;
    }
    .wiz-input:focus { outline: none; border-color: var(--primary-color); box-shadow: 0 0 0 3px rgba(37,99,235,0.1); }
    .wiz-input-mono { font-family: SFMono-Regular, Consolas, monospace; }
    .wiz-code-editor {
      width: 100%; padding: 10px 12px; border: 1px solid var(--border-color); border-radius: 8px;
      background: var(--code-bg); color: var(--text-color); font-size: 12px; line-height: 1.5;
      font-family: SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace;
      resize: vertical; tab-size: 2;
    }
    .wiz-code-editor:focus { outline: none; border-color: var(--primary-color); box-shadow: 0 0 0 3px rgba(37,99,235,0.1); }
    .wiz-step-card {
      margin-bottom: 12px; border: 1px solid var(--border-color); border-radius: 8px;
      background: var(--card-bg); overflow: visible;
    }
    .wiz-step-header {
      display: flex; align-items: center; gap: 8px; padding: 10px 14px;
      border-bottom: 1px solid var(--border-color);
    }
    .wiz-step-badge {
      font-size: 11px; font-weight: 700; color: var(--primary-color);
      background: rgba(37,99,235,0.1); padding: 2px 8px; border-radius: 4px;
    }
    .wiz-step-name {
      flex: 1; padding: 4px 8px; border: 1px solid transparent; border-radius: 4px;
      background: transparent; color: var(--text-color); font-size: 13px; font-weight: 600;
    }
    .wiz-step-name:focus { border-color: var(--border-color); background: var(--input-bg); outline: none; }
    .wiz-step-remove { background: none; border: none; color: var(--error-color); cursor: pointer; font-size: 16px; padding: 2px 6px; }
    .wiz-step-body { padding: 12px 14px; }
    .wiz-prior-vars {
      margin-bottom: 10px; padding: 6px 10px; border-radius: 6px;
      background: rgba(37,99,235,0.04); border: 1px solid rgba(37,99,235,0.1);
    }
    .wiz-prior-var {
      font-size: 11px; padding: 2px 6px; border-radius: 3px;
      background: var(--code-bg); color: var(--primary-color);
    }
    .wiz-test-result {
      margin-top: 8px; padding: 10px 12px; border-radius: 8px;
    }
    .wiz-test-pass { border: 2px solid var(--success-color); background: var(--card-bg); box-shadow: 0 4px 12px -4px rgba(22, 163, 106, 0.35); }
    .wiz-test-fail { border: 2px solid var(--error-color); background: var(--card-bg); box-shadow: 0 4px 12px -4px rgba(220, 38, 38, 0.35); }
    .wiz-test-skip { border: 1px solid var(--primary-color); background: rgba(37,99,235,0.06); }
    .wiz-test-header { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
    .wiz-test-dismiss { margin-left: auto; background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 16px; }
    .wiz-test-section { margin-bottom: 6px; }
    .wiz-test-label { font-weight: 600; font-size: 10px; color: var(--text-muted); text-transform: uppercase; }
    .wiz-test-value {
      margin: 2px 0 0 0; font-size: 11px; padding: 6px 8px; background: var(--code-bg);
      border-radius: 4px; white-space: pre-wrap; word-break: break-word; max-height: 100px; overflow: auto;
    }
    .wiz-test-log { font-size: 11px; font-family: SFMono-Regular, Consolas, monospace; color: var(--text-secondary); padding: 1px 0; }
    .wiz-rec {
      margin-top: 6px; padding: 8px 10px; border-radius: 6px; border: 2px solid var(--primary-color);
      background: var(--card-bg); box-shadow: 0 4px 12px -4px rgba(37, 99, 235, 0.35);
      font-size: 11px; white-space: pre-line;
    }
    .wiz-footer {
      display: flex; justify-content: space-between; align-items: center;
      padding: 12px 20px; border-top: 1px solid var(--border-color);
    }
    .wiz-footer-hint { font-size: 11px; color: var(--text-muted); }
    .wiz-footer-actions { display: flex; gap: 8px; }
    .wiz-success {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      padding: 32px 20px; text-align: center;
    }
    .wiz-success-icon {
      width: 48px; height: 48px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
      background: rgba(22,163,106,0.1); margin-bottom: 12px;
    }
    .wiz-success-title { font-size: 16px; font-weight: 700; margin-bottom: 4px; }
    .wiz-success-text { font-size: 13px; color: var(--text-secondary); margin-bottom: 16px; }
    .wiz-add-step-btn {
      width: 100%; padding: 8px; margin-bottom: 14px; border: 1px dashed var(--border-color);
      border-radius: 8px; background: transparent; color: var(--text-secondary);
      cursor: pointer; font-size: 12px; transition: all 0.15s ease;
    }
    .wiz-add-step-btn:hover { border-color: var(--primary-color); color: var(--primary-color); background: rgba(37,99,235,0.04); }
    .wiz-add-step-btn:disabled { opacity: 0.4; cursor: default; }
    .wiz-divider { border-top: 1px solid var(--border-color); padding-top: 12px; margin-bottom: 14px; }

    /* === Global Animations & Transitions === */

    /* Section entrance — staggered fade-in + slide up */
    .section { animation: sectionFadeIn 0.3s ease both; }
    @keyframes sectionFadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* Card hover — subtle lift + deeper shadow */
    .card {
      transition: box-shadow 0.25s ease, transform 0.25s ease, border-color 0.25s ease;
    }
    .card:hover {
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
    }
    html[data-color-mode="dark"] .card:hover {
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    }

    /* Alert slide-in */
    .alert { animation: alertSlideIn 0.25s ease both; }
    @keyframes alertSlideIn {
      from { opacity: 0; transform: translateY(-6px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* Button press feedback */
    .btn-small {
      transition: all 0.15s ease;
    }
    .btn-small:active:not(:disabled) {
      transform: scale(0.96);
    }

    /* Table row hover */
    .table tbody tr {
      transition: background-color 0.15s ease;
    }
    .table tbody tr:hover {
      background-color: var(--hover-bg);
    }

    /* Tab content fade */
    .docs-tab, .perm-tab {
      animation: tabContentFade 0.2s ease both;
    }
    @keyframes tabContentFade {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    /* Tab bar indicator */
    .tab-bar button {
      transition: color 0.2s ease, border-color 0.2s ease;
    }

    /* Wizard card entrance */
    .wizard {
      animation: wizardSlideIn 0.3s ease both;
    }
    @keyframes wizardSlideIn {
      from { opacity: 0; transform: translateY(-10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* Wizard step card entrance */
    .wiz-step-card {
      animation: stepCardFadeIn 0.2s ease both;
    }
    @keyframes stepCardFadeIn {
      from { opacity: 0; transform: scale(0.98); }
      to { opacity: 1; transform: scale(1); }
    }

    /* Wizard pick buttons */
    .wiz-pick-btn {
      transition: all 0.2s ease;
    }
    .wiz-pick-btn:active {
      transform: scale(0.98);
    }

    /* Wizard type cards */
    .wiz-type-card {
      transition: all 0.2s ease;
    }
    .wiz-type-card:active {
      transform: scale(0.97);
    }

    /* Wizard success entrance */
    .wiz-success {
      animation: successPop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both;
    }
    @keyframes successPop {
      from { opacity: 0; transform: scale(0.9); }
      to { opacity: 1; transform: scale(1); }
    }
    .wiz-success-icon {
      animation: successCheckmark 0.5s ease 0.2s both;
    }
    @keyframes successCheckmark {
      0% { opacity: 0; transform: scale(0.5) rotate(-20deg); }
      60% { transform: scale(1.1) rotate(5deg); }
      100% { opacity: 1; transform: scale(1) rotate(0); }
    }

    /* Test result entrance */
    .wiz-test-result {
      animation: testResultSlide 0.2s ease both;
    }
    @keyframes testResultSlide {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* Log entry entrance — subtle stagger effect */
    .log-entry {
      animation: logEntryFade 0.2s ease both;
      transition: background-color 0.15s ease;
    }
    .log-entry:hover {
      background-color: var(--hover-bg);
    }
    @keyframes logEntryFade {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    /* Rule status banner animation */
    .rule-status-banner, .status-disabled-banner, .status-active-banner {
      animation: bannerSlideIn 0.3s ease both;
    }
    @keyframes bannerSlideIn {
      from { opacity: 0; transform: translateX(-8px); }
      to { opacity: 1; transform: translateX(0); }
    }

    /* Permission card entrance */
    .perm-admin-card {
      transition: background-color 0.15s ease, box-shadow 0.15s ease;
    }
    .perm-admin-card:hover {
      background-color: var(--hover-bg);
    }

    /* Search results dropdown */
    .perm-search-results {
      animation: dropdownSlideIn 0.15s ease both;
    }

    /* Badge pulse for important states */
    .type-badge {
      transition: all 0.15s ease;
    }

    /* Focus ring animation for inputs/textareas */
    .wiz-textarea, .wiz-input, .perm-search-input {
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
    }

    /* Smooth icon transitions */
    svg {
      transition: color 0.15s ease;
    }

    /* Empty state fade */
    .empty-state {
      animation: sectionFadeIn 0.3s ease both;
    }

    /* Skeleton breathing */
    .sk {
      animation: skShimmer 1.5s ease-in-out infinite;
    }

    /* === Memories admin tab === */
    .memories-admin-tab {
      animation: tabContentFade 0.2s ease both;
    }

    .memories-admin-explainer {
      margin: 4px 0 14px;
      font-size: 12px;
      color: var(--text-secondary);
    }

    .memories-admin-toggles {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 14px 16px;
      margin-bottom: 14px;
    }

    .memories-admin-toggle-row {
      display: flex;
      align-items: flex-start;
      gap: 10px;
    }
    .memories-admin-toggle-row input[type="checkbox"] {
      margin: 2px 0 0;
      width: 16px;
      height: 16px;
      flex-shrink: 0;
      accent-color: #0d9488;
      cursor: pointer;
    }
    .memories-admin-toggle-row input[type="checkbox"]:disabled { cursor: default; }

    .memories-admin-toggle-label {
      font-size: 13px;
      font-weight: 700;
      color: var(--text-color);
      cursor: pointer;
    }

    .memories-admin-toggle-copy {
      margin-top: 2px;
      font-size: 12px;
      color: var(--text-secondary);
    }

    .memories-admin-add {
      display: flex;
      gap: 8px;
      margin-bottom: 14px;
    }
    .memories-admin-add input {
      flex: 1;
      padding: 8px 10px;
      border: 1px solid var(--border-color);
      border-radius: 6px;
      background: var(--input-bg);
      color: var(--text-color);
      font-size: 13px;
    }

    .btn-add-memory {
      padding: 8px 16px;
      font-size: 12px;
      font-weight: 700;
      border: none;
      border-radius: 6px;
      background: #0d9488;
      color: #ffffff;
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .btn-add-memory:hover:not(:disabled) { opacity: 0.85; }
    .btn-add-memory:disabled { opacity: 0.5; cursor: default; }

    .memories-admin-source-badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: 700;
      color: #ffffff;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      white-space: nowrap;
    }
    .memories-admin-src-user { background: #2563eb; }
    .memories-admin-src-test { background: #d97706; }
    .memories-admin-src-fix { background: #16a34a; }

    .memories-admin-divider td {
      padding: 8px 14px;
      background: var(--code-bg);
    }
    .memories-admin-archived-badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: 700;
      background: #475569;
      color: #ffffff;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .memories-admin-archived-row td { color: var(--text-muted); }

    .memories-admin-reinforced {
      margin-left: 6px;
      font-size: 10px;
      font-weight: 700;
      color: #0d9488;
      white-space: nowrap;
    }

    .memories-admin-edit-input {
      width: 100%;
      padding: 6px 8px;
      border: 2px solid #0d9488;
      border-radius: 6px;
      background: var(--input-bg);
      color: var(--text-color);
      font-size: 12px;
      font-family: inherit;
    }

    .memories-admin-empty-title {
      font-size: 14px;
      font-weight: 700;
      color: var(--text-color);
      margin-bottom: 6px;
    }

    html[data-color-mode="dark"] .memories-admin-toggle-row input[type="checkbox"] { accent-color: #14b8a6; }
    html[data-color-mode="dark"] .btn-add-memory { background: #14b8a6; }
    html[data-color-mode="dark"] .memories-admin-src-user { background: #3b82f6; }
    html[data-color-mode="dark"] .memories-admin-src-test { background: #f59e0b; }
    html[data-color-mode="dark"] .memories-admin-src-fix { background: #22c55e; }
    html[data-color-mode="dark"] .memories-admin-archived-badge { background: #64748b; }
    html[data-color-mode="dark"] .memories-admin-reinforced { color: #14b8a6; }
    html[data-color-mode="dark"] .memories-admin-edit-input { border-color: #14b8a6; }

    /* === Skills admin tab === */
    .skills-admin-tab {
      animation: tabContentFade 0.2s ease both;
    }

    .skills-admin-explainer {
      margin: 4px 0 14px;
      font-size: 12px;
      color: var(--text-secondary);
    }

    .btn-add-skill {
      padding: 8px 16px;
      font-size: 12px;
      font-weight: 700;
      border: none;
      border-radius: 6px;
      background: #7c3aed;
      color: #ffffff;
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .btn-add-skill:hover:not(:disabled) { opacity: 0.85; }
    .btn-add-skill:disabled { opacity: 0.5; cursor: default; }

    .skills-admin-desc {
      display: inline-block;
      max-width: 320px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      vertical-align: middle;
      font-size: 12px;
      color: var(--text-secondary);
    }

    .skills-admin-divider td {
      padding: 8px 14px;
      background: var(--code-bg);
    }
    .skills-admin-disabled-badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: 700;
      background: #475569;
      color: #ffffff;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .skills-admin-disabled-row td { color: var(--text-muted); }

    .skills-admin-empty-title {
      font-size: 14px;
      font-weight: 700;
      color: var(--text-color);
      margin-bottom: 6px;
    }

    html[data-color-mode="dark"] .btn-add-skill { background: #8b5cf6; }
    html[data-color-mode="dark"] .skills-admin-disabled-badge { background: #64748b; }

    /* ============================================================
       Motion & Loading System (MLS) — shared contract, keep in sync
       across config-ui / admin-panel / config-view injectStyles().
       Classes: .is-busy (+.busy-solid), .veil/.veil-host/.veil-fixed,
       .spin-ring, .status-dot(-checking)/.status-settle, .anim-rise,
       .anim-fade, .anim-pop, .stagger, .flash-success, .load-error,
       .btn-retry, .mls-toast, .reveal
       ============================================================ */
    :root {
      --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
      --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
      --dur-fast: 140ms;
      --dur-med: 260ms;
      --dur-slow: 420ms;
      --frost-bg: rgba(255, 255, 255, 0.6);
    }
    html[data-color-mode="dark"] { --frost-bg: rgba(8, 8, 14, 0.55); }

    @keyframes mlsSpin { to { transform: rotate(360deg); } }
    @keyframes mlsFadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes mlsRiseIn { from { opacity: 0; transform: translateY(7px); } to { opacity: 1; transform: none; } }
    @keyframes mlsPopIn { from { opacity: 0; transform: scale(0.92); } to { opacity: 1; transform: none; } }
    @keyframes mlsDotPing {
      0% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.55); }
      70% { box-shadow: 0 0 0 6px rgba(59, 130, 246, 0); }
      100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); }
    }
    @keyframes mlsFlash {
      0% { background-color: rgba(22, 163, 74, 0.35); }
      100% { background-color: transparent; }
    }
    @keyframes mlsToastIn { from { opacity: 0; transform: translate(-50%, 14px) scale(0.95); } to { opacity: 1; transform: translate(-50%, 0) scale(1); } }
    @keyframes mlsToastOut { to { opacity: 0; transform: translate(-50%, 10px) scale(0.97); } }

    /* Busy buttons: keep the ORIGINAL static label in the JSX (it goes
       transparent, preserving width — no layout shift), add .is-busy while
       the call is in flight, plus .busy-solid on solid/filled buttons so
       the spinner is white. */
    .is-busy { position: relative; color: transparent !important; pointer-events: none; text-shadow: none !important; }
    .is-busy::after {
      content: "";
      position: absolute;
      width: 14px; height: 14px;
      top: 50%; left: 50%;
      margin: -7px 0 0 -7px;
      border-radius: 50%;
      border: 2px solid rgba(100, 116, 139, 0.3);
      border-top-color: var(--primary-color);
      animation: mlsSpin 0.7s linear infinite;
    }
    .busy-solid.is-busy::after { border-color: rgba(255, 255, 255, 0.4); border-top-color: #ffffff; }

    .spin-ring {
      width: 16px; height: 16px; flex: 0 0 auto;
      border-radius: 50%;
      border: 2px solid rgba(100, 116, 139, 0.3);
      border-top-color: var(--primary-color);
      animation: mlsSpin 0.7s linear infinite;
      display: inline-block;
    }
    .spin-ring-sm { width: 12px; height: 12px; }

    /* Frosted recalculation veil: parent gets .veil-host, overlay shows
       while stale-but-visible content is being refreshed underneath. */
    .veil-host { position: relative; }
    .veil {
      position: absolute; inset: 0; z-index: 6;
      display: flex; align-items: center; justify-content: center; gap: 9px;
      background: var(--frost-bg);
      -webkit-backdrop-filter: blur(10px) saturate(160%);
      backdrop-filter: blur(10px) saturate(160%);
      border-radius: inherit;
      animation: mlsFadeIn var(--dur-fast) var(--ease-out) both;
    }
    .veil-fixed { position: fixed; z-index: 999; }
    .veil-label { font-size: 12.5px; font-weight: 700; color: var(--text-color); }

    .status-dot { transition: background-color var(--dur-med) ease; }
    .status-dot-checking { background: var(--primary-color) !important; animation: mlsDotPing 1.2s ease-in-out infinite; }
    .status-settle { animation: mlsPopIn 0.3s var(--ease-spring) both; }

    .anim-rise { animation: mlsRiseIn var(--dur-med) var(--ease-out) both; }
    .anim-fade { animation: mlsFadeIn var(--dur-med) var(--ease-out) both; }
    .anim-pop { animation: mlsPopIn var(--dur-med) var(--ease-spring) both; }

    .stagger > * { animation: mlsRiseIn var(--dur-med) var(--ease-out) both; }
    .stagger > *:nth-child(1) { animation-delay: 0ms; }
    .stagger > *:nth-child(2) { animation-delay: 35ms; }
    .stagger > *:nth-child(3) { animation-delay: 70ms; }
    .stagger > *:nth-child(4) { animation-delay: 105ms; }
    .stagger > *:nth-child(5) { animation-delay: 140ms; }
    .stagger > *:nth-child(6) { animation-delay: 175ms; }
    .stagger > *:nth-child(7) { animation-delay: 210ms; }
    .stagger > *:nth-child(8) { animation-delay: 245ms; }
    .stagger > *:nth-child(9) { animation-delay: 280ms; }
    .stagger > *:nth-child(10) { animation-delay: 315ms; }
    .stagger > *:nth-child(n+11) { animation-delay: 350ms; }

    .flash-success { animation: mlsFlash 1.2s ease-out both; }

    .load-error {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 14px;
      font-size: 12.5px; font-weight: 600;
      color: #ffffff;
      background: var(--error-color);
      border-radius: 8px;
      animation: mlsRiseIn var(--dur-med) var(--ease-out) both;
    }
    .load-error span { flex: 1; }
    .btn-retry {
      background: #ffffff; color: var(--error-color);
      border: none; border-radius: 6px;
      font-weight: 700; font-size: 12px;
      padding: 4px 12px; cursor: pointer;
      flex: 0 0 auto;
    }
    .btn-retry:hover { opacity: 0.9; }

    .cr-confirm-overlay {
      position: fixed; inset: 0; z-index: 10000; display: flex; align-items: center; justify-content: center;
      background: rgba(15, 23, 42, 0.55); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px);
      animation: crConfirmFade 0.12s ease;
    }
    @keyframes crConfirmFade { from { opacity: 0; } to { opacity: 1; } }
    .cr-confirm {
      width: min(460px, 92vw); background: #ffffff; color: #0f172a; border: 1px solid #e2e8f0;
      border-radius: 12px; padding: 20px 22px; box-shadow: 0 18px 50px rgba(15, 23, 42, 0.35);
    }
    html[data-color-mode="dark"] .cr-confirm { background: #1e293b; color: #e2e8f0; border-color: #334155; }
    .cr-confirm-title { font-size: 15px; font-weight: 700; margin-bottom: 8px; }
    .cr-confirm-msg { font-size: 13px; line-height: 1.5; color: #475569; white-space: pre-wrap; }
    html[data-color-mode="dark"] .cr-confirm-msg { color: #94a3b8; }
    .cr-confirm-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
    .mls-toast {
      position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%);
      z-index: 9999;
      display: flex; align-items: center; gap: 8px;
      padding: 10px 18px;
      border-radius: 999px;
      background: var(--success-color);
      color: #ffffff; font-size: 12.5px; font-weight: 700;
      font-family: inherit;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.28);
      animation: mlsToastIn 0.32s var(--ease-spring) both;
      pointer-events: none;
      white-space: nowrap;
      max-width: 90vw;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .mls-toast-error { background: var(--error-color); }
    .mls-toast-leaving { animation: mlsToastOut 0.26s ease-in both; }

    /* Animated expand/collapse for always-mounted sections. */
    .reveal { display: grid; grid-template-rows: 0fr; transition: grid-template-rows var(--dur-med) var(--ease-out); }
    .reveal-open { grid-template-rows: 1fr; }
    .reveal > * { overflow: hidden; min-height: 0; }
    /* Once the expand transition settles, lift the clip so absolutely-
       positioned dropdowns inside the revealed body aren't cut off. */
    .reveal-settled > * { overflow: visible; }

    button:active:not(:disabled):not(.is-busy) { transform: scale(0.97); }

    /* ===================================================================
       LeanZero design refresh — ports the leanzero.* website look (blue/cyan/
       purple accent system, focus rings, text selection, soft depth + hover
       glow, vivid header tile) into the app. Additive layer: reuses the
       existing tokens (--primary-color, --hover-bg, --ease-out, --dur-*) and
       the MLS classes. Owner UI mandate honored — NO left accent rails, solid
       saturated colors (no faded tints), every hue has a dark-mode value, and
       motion is gentle + respects prefers-reduced-motion (guard below). No
       transform on CONTAINER cards (it would trap CustomSelect dropdowns in a
       new stacking context — the documented MLS gotcha); transforms only on
       leaf controls (buttons, chips).
       =================================================================== */
    :root {
      --lz-ease: cubic-bezier(0.22, 1, 0.36, 1);
      --lz-cyan: #0891b2;
      --lz-purple: #7c3aed;
      --lz-ring: 0 0 0 3px rgba(37, 99, 235, 0.32);
      --lz-card-shadow: 0 1px 2px rgba(18, 42, 66, 0.06), 0 5px 16px -8px rgba(18, 42, 66, 0.14);
      --lz-card-shadow-hover: 0 12px 30px -12px rgba(29, 78, 216, 0.28), 0 3px 10px rgba(18, 42, 66, 0.10);
      --lz-glow: 0 8px 22px -6px rgba(37, 99, 235, 0.42);
      --lz-sel-bg: rgba(37, 99, 235, 0.26);
      --lz-sel-fg: #0f172a;
    }
    html[data-color-mode="dark"] {
      --lz-cyan: #22d3ee;
      --lz-purple: #a855f7;
      --lz-ring: 0 0 0 3px rgba(96, 165, 250, 0.45);
      --lz-card-shadow: 0 1px 2px rgba(0, 0, 0, 0.5), 0 6px 20px -10px rgba(0, 0, 0, 0.55);
      --lz-card-shadow-hover: 0 0 26px rgba(59, 130, 246, 0.30), 0 8px 24px -10px rgba(0, 0, 0, 0.55);
      --lz-glow: 0 0 24px rgba(59, 130, 246, 0.42);
      --lz-sel-bg: rgba(96, 165, 250, 0.42);
      --lz-sel-fg: #f8fafc;
    }

    ::selection { background: var(--lz-sel-bg); color: var(--lz-sel-fg); }

    button:not(.tab-btn):focus-visible, a:focus-visible, input:focus-visible, textarea:focus-visible,
    select:focus-visible, [tabindex]:focus-visible, .dropdown-trigger:focus-visible {
      outline: none; box-shadow: var(--lz-ring);
    }

    /* The 'html ' prefix raises specificity to (0,1,1) so these win over
       admin-panel's injectCopiedComponentStyles (which loads AFTER injectStyles
       and otherwise reverts .card/.icon-wrapper/.title) — keeps all three apps
       visually consistent. Harmless higher-than-needed specificity elsewhere. */
    html .card {
      box-shadow: var(--lz-card-shadow);
      transition: box-shadow var(--dur-med) var(--lz-ease), border-color var(--dur-fast) ease;
    }
    .card:hover { box-shadow: var(--lz-card-shadow-hover); border-color: rgba(37, 99, 235, 0.35); }
    html[data-color-mode="dark"] .card:hover { border-color: rgba(96, 165, 250, 0.40); }

    html .icon-wrapper {
      background: linear-gradient(135deg, #2563eb, #1d4ed8);
      color: #ffffff;
      box-shadow: 0 6px 18px -6px rgba(37, 99, 235, 0.55);
    }
    html[data-color-mode="dark"] .icon-wrapper {
      background: linear-gradient(135deg, #3b82f6, #2563eb);
      box-shadow: 0 0 20px rgba(59, 130, 246, 0.40);
    }

    html .title { letter-spacing: -0.02em; font-weight: 700; }

    .btn-small {
      transition: background var(--dur-fast) ease, box-shadow var(--dur-fast) ease,
                  transform var(--dur-fast) var(--lz-ease), border-color var(--dur-fast) ease;
    }
    .btn-small:hover:not(:disabled) { transform: translateY(-1px); }
    .btn-edit:hover:not(:disabled) { box-shadow: 0 4px 14px -4px rgba(37, 99, 235, 0.45); border-color: var(--primary-color); }
    .btn-danger:hover:not(:disabled) { box-shadow: 0 4px 14px -4px rgba(220, 38, 38, 0.40); }

    input:focus, textarea:focus, select:focus {
      border-color: var(--primary-color); box-shadow: var(--lz-ring); outline: none;
    }

    .dropdown-item { transition: background var(--dur-fast) ease, color var(--dur-fast) ease; }

    /* Tabs — clean, UNDERLINE-only states. No filled hover background and no
       focus box: both render as ugly rounded blobs on a tab row (the negative
       margin-bottom + rounded fill never align with the bar). Instead: hover just
       lightens the label, keyboard focus shows an accent underline (the natural
       tab affordance, via the already-present transparent 2px border-bottom — so
       nothing shifts), and the active tab keeps its blue underline + bold + a soft
       glow and never washes to grey on hover. */
    .tab-btn { transition: color var(--dur-fast) ease, border-color var(--dur-fast) ease; }
    .tab-btn.tab-active:hover { color: var(--primary-color); }
    .tab-btn:focus-visible { outline: none; border-bottom-color: var(--primary-color); }
    .tab-active { text-shadow: 0 0 12px rgba(37, 99, 235, 0.28); }
    html[data-color-mode="dark"] .tab-active { text-shadow: 0 0 14px rgba(96, 165, 250, 0.45); }

    .dib-loaded { box-shadow: 0 1px 6px -1px rgba(22, 163, 74, 0.5); }
    html[data-color-mode="dark"] .dib-loaded { box-shadow: 0 1px 8px -1px rgba(34, 197, 94, 0.55); }

    .mcp-tool-chip { transition: transform var(--dur-fast) var(--lz-ease), box-shadow var(--dur-fast) ease; }
    .mcp-tool-chip:hover { transform: translateY(-1px); box-shadow: 0 3px 10px -3px rgba(37, 99, 235, 0.5); }

    .section { margin-bottom: 28px; }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
      }
    }
  `;
  document.head.appendChild(style);
};

// Component styles for the rule-creation components shared with config-ui
// (DocRepository, ReviewPanel, SemanticConfig, FunctionBuilder, FunctionBlock,
// CodeEditor, IssuePicker, AILoadingState). Injected as a SEPARATE style tag
// so it cascades AFTER admin-panel's own styles — for overlapping primitives
// (alert/card/dropdown/skeleton/tooltip) both stylesheets target the same
// CSS variables, so the visual result is consistent.
const injectCopiedComponentStyles = () => {
  if (document.getElementById("copied-component-styles")) return;
  const style = document.createElement("style");
  style.id = "copied-component-styles";
  style.textContent = `
    :root {
      --bg-color: transparent;
      --text-color: #0f172a;
      --text-secondary: #64748b;
      --text-muted: #94a3b8;
      --primary-color: #2563eb;
      --error-color: #dc2626;
      --success-color: #16a34a;
      --border-color: #cbd5e1;
      --card-bg: #ffffff;
      --input-bg: #f8fafc;
      --code-bg: #f1f5f9;
      --icon-bg: #dbeafe;
      --alert-error-bg: #fef2f2;
      --alert-error-border: #fecaca;
      --alert-success-bg: #f0fdf4;
      --alert-success-border: #bbf7d0;
      --button-disabled-bg: #93c5fd;
    }

    html[data-color-mode="dark"] {
      --bg-color: transparent;
      --text-color: #F5F5F7;
      --text-secondary: #A0A0B0;
      --text-muted: #71717a;
      --primary-color: #3b82f6;
      --error-color: #ef4444;
      --success-color: #22c55e;
      --border-color: #374151;
      --card-bg: #13131A;
      --input-bg: #0A0A0F;
      --code-bg: #0A0A0F;
      --icon-bg: #1e3a5f;
      --alert-error-bg: #450a0a;
      --alert-error-border: #7f1d1d;
      --alert-success-bg: #052e16;
      --alert-success-border: #166534;
      --button-disabled-bg: #1e3a5f;
    }

    *, *::before, *::after { box-sizing: border-box; }

    html, body {
      margin: 0;
      padding: 0;
      font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: var(--bg-color);
      color: var(--text-color);
      font-size: 14px;
      line-height: 1.5;
    }

    .container { padding: 20px; max-width: 100%; }

    .header {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 20px;
    }

    .icon-wrapper {
      padding: 12px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      background: linear-gradient(135deg, var(--icon-bg), rgba(37, 99, 235, 0.12));
      color: var(--primary-color);
      box-shadow: 0 0 16px rgba(37, 99, 235, 0.1);
    }

    .title {
      margin: 0 0 4px 0;
      font-size: 16px;
      font-weight: 600;
      line-height: 1.25;
      color: var(--text-color);
    }

    .subtitle {
      margin: 0;
      font-size: 13px;
      line-height: 1.4;
      color: var(--text-secondary);
    }

    .card {
      padding: 20px;
      border-radius: 12px;
      border: 1px solid var(--border-color);
      background-color: var(--card-bg);
      margin-bottom: 16px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.03);
      transition: box-shadow 0.3s ease;
    }

    .form-group { margin-bottom: 20px; }
    .form-group:last-child { margin-bottom: 0; }

    .label {
      display: block;
      margin-bottom: 6px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-secondary);
    }

    .required { color: var(--error-color); }

    .input, .textarea {
      width: 100%;
      padding: 10px 12px;
      font-size: 14px;
      border: 2px solid var(--border-color);
      border-radius: 8px;
      background-color: var(--input-bg);
      color: var(--text-color);
      outline: none;
      transition: all 0.2s ease;
    }

    .input:focus, .textarea:focus {
      border-color: var(--primary-color);
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
    }
    .input-error { border-color: var(--error-color) !important; }
    .input-error:focus { box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.1); }

    .textarea {
      resize: vertical;
      font-family: inherit;
      line-height: 1.5;
      min-height: 120px;
    }

    .input::placeholder, .textarea::placeholder { color: var(--text-muted); }

    .dropdown { position: relative; }

    .dropdown-trigger {
      width: 100%;
      padding: 10px 36px 10px 12px;
      font-size: 14px;
      border: 2px solid var(--border-color);
      border-radius: 8px;
      background-color: var(--input-bg);
      color: var(--text-color);
      outline: none;
      transition: all 0.2s ease;
      cursor: pointer;
      text-align: left;
      position: relative;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-family: inherit;
      line-height: 1.5;
    }

    .dropdown-trigger:hover { border-color: rgba(37, 99, 235, 0.4); }
    .dropdown-trigger:focus,
    .dropdown-trigger.dropdown-open {
      border-color: var(--primary-color);
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
    }
    .dropdown-trigger.dropdown-error { border-color: var(--error-color) !important; }

    .dropdown-trigger .dropdown-placeholder { color: var(--text-muted); }

    .dropdown-chevron {
      position: absolute;
      right: 12px;
      top: 50%;
      transform: translateY(-50%);
      pointer-events: none;
      color: var(--text-muted);
      transition: transform 0.15s ease;
    }

    .dropdown-open .dropdown-chevron { transform: translateY(-50%) rotate(180deg); }

    .dropdown-panel {
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      right: 0;
      z-index: 1000;
      background-color: var(--card-bg);
      border: 1px solid rgba(37, 99, 235, 0.2);
      border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.12);
      max-height: 320px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    html[data-color-mode="dark"] .dropdown-panel {
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    }

    .dropdown-panel-up {
      top: auto;
      bottom: calc(100% + 4px);
    }

    .dropdown-search {
      padding: 8px;
      border-bottom: 1px solid var(--border-color);
      flex-shrink: 0;
    }

    .dropdown-search input {
      width: 100%;
      padding: 8px 10px;
      font-size: 13px;
      border: 2px solid var(--border-color);
      border-radius: 3px;
      background-color: var(--input-bg);
      color: var(--text-color);
      outline: none;
      font-family: inherit;
    }

    .dropdown-search input:focus { border-color: var(--primary-color); }
    .dropdown-search input::placeholder { color: var(--text-muted); }

    .dropdown-list {
      overflow-y: auto;
      flex: 1;
    }

    .dropdown-group-label {
      padding: 6px 12px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
      background-color: var(--code-bg);
      position: sticky;
      top: 0;
    }

    .dropdown-item {
      padding: 8px 12px;
      cursor: pointer;
      display: flex;
      align-items: baseline;
      gap: 8px;
      transition: background-color 0.1s;
    }

    .dropdown-item:hover,
    .dropdown-item.dropdown-highlighted { background-color: var(--code-bg); }

    .dropdown-item.dropdown-selected {
      background: var(--primary-color);
    }
    .dropdown-item.dropdown-selected .dropdown-item-name,
    .dropdown-item.dropdown-selected .dropdown-item-meta {
      color: #ffffff;
    }

    .dropdown-item-name {
      font-size: 14px;
      color: var(--text-color);
      flex-shrink: 0;
    }

    .dropdown-item-meta {
      font-size: 11px;
      color: var(--text-muted);
      font-family: SFMono-Regular, Consolas, monospace;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .dropdown-item-type {
      margin-left: auto;
      flex-shrink: 0;
      font-size: 11px;
      padding: 1px 6px;
      border-radius: 3px;
      background-color: var(--code-bg);
      color: var(--text-muted);
    }

    .dropdown-item.dropdown-selected .dropdown-item-type {
      background-color: var(--card-bg);
    }

    .dropdown-empty {
      padding: 16px 12px;
      text-align: center;
      color: var(--text-muted);
      font-size: 13px;
    }

    .fields-loading {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      background-color: var(--input-bg);
      border: 2px solid var(--border-color);
      border-radius: 4px;
      color: var(--text-muted);
      font-size: 13px;
    }

    .fields-loading .spinner-small {
      width: 14px;
      height: 14px;
      border: 2px solid var(--border-color);
      border-top-color: var(--primary-color);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    .hint {
      margin: 8px 0 0 0;
      font-size: 12px;
      line-height: 1.4;
      color: var(--text-muted);
    }

    .hint code {
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 11px;
      font-family: SFMono-Regular, Consolas, monospace;
      background-color: var(--code-bg);
      color: var(--text-color);
    }

    .alert {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      border-radius: 10px;
      font-size: 13px;
      margin-bottom: 16px;
      border: 1px solid;
    }

    .alert-error {
      background-color: var(--alert-error-bg);
      border-color: var(--alert-error-border);
      color: var(--error-color);
    }

    .alert-success {
      background-color: var(--alert-success-bg);
      border-color: var(--alert-success-border);
      color: var(--success-color);
    }

    .actions { display: flex; justify-content: flex-start; }

    .button {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 20px;
      font-size: 14px;
      font-weight: 600;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.25s ease;
      background: linear-gradient(135deg, #2563eb, #1d4ed8);
      color: #FFFFFF;
      box-shadow: 0 2px 8px rgba(37, 99, 235, 0.25);
    }

    html[data-color-mode="dark"] .button {
      color: #FFFFFF;
      background: linear-gradient(135deg, #3b82f6, #2563eb);
    }
    .button:hover {
      box-shadow: 0 4px 16px rgba(37, 99, 235, 0.4);
      transform: translateY(-1px);
    }

    .button-disabled {
      cursor: not-allowed;
      opacity: 0.7;
      background-color: var(--button-disabled-bg);
    }

    html[data-color-mode="dark"] .button-disabled { color: var(--text-muted); }

    .loading-spinner {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 40px;
    }

    .spinner {
      width: 32px;
      height: 32px;
      border: 3px solid var(--border-color);
      border-top-color: var(--primary-color);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      box-shadow: 0 0 12px rgba(37, 99, 235, 0.2);
    }

    .loading-text {
      margin-top: 12px;
      font-size: 13px;
      color: var(--text-secondary);
    }

    @keyframes spin { to { transform: rotate(360deg); } }

    /* === Tooltip === */
    .tooltip-wrap {
      position: relative;
      display: inline-flex;
      align-items: center;
      margin-left: 6px;
      vertical-align: middle;
    }

    .tooltip-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: var(--primary-color);
      color: #fff;
      font-size: 9px;
      font-weight: 700;
      cursor: help;
      line-height: 1;
      opacity: 0.7;
      transition: opacity 0.15s ease;
    }

    .tooltip-wrap:hover .tooltip-icon { opacity: 1; }

    /* Portal-rendered tooltip (escapes overflow:hidden) */
    .tooltip-portal {
      position: absolute;
      transform: translateX(-50%);
      z-index: 99999;
      padding: 9px 12px;
      border-radius: 9px;
      background: #0f172a;
      color: #f1f5f9;
      font-size: 12.5px;
      font-weight: 400;
      font-style: normal;
      line-height: 1.5;
      letter-spacing: normal;
      text-transform: none;
      white-space: normal;
      width: max-content;
      max-width: min(300px, calc(100vw - 32px));
      pointer-events: none;
      box-shadow: 0 10px 28px -6px rgba(15, 23, 42, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.10);
      animation: tooltipFadeIn 0.15s ease;
    }

    html[data-color-mode="dark"] .tooltip-portal {
      background: #1e293b;
      color: #f1f5f9;
      box-shadow: 0 12px 32px -6px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.12);
    }

    /* Arrow */
    .tooltip-portal::after {
      content: '';
      position: absolute;
      left: 50%;
      transform: translateX(-50%);
      border: 6px solid transparent;
    }

    .tooltip-bottom::after {
      bottom: 100%;
      border-bottom-color: #0f172a;
    }
    html[data-color-mode="dark"] .tooltip-bottom::after { border-bottom-color: #1e293b; }

    .tooltip-top::after {
      top: 100%;
      border-top-color: #0f172a;
    }
    html[data-color-mode="dark"] .tooltip-top::after { border-top-color: #1e293b; }

    @keyframes tooltipFadeIn {
      from { opacity: 0; transform: translateX(-50%) translateY(4px); }
      to { opacity: 1; transform: translateX(-50%) translateY(0); }
    }

    .tooltip-top.tooltip-portal {
      animation-name: tooltipFadeInUp;
    }

    @keyframes tooltipFadeInUp {
      from { opacity: 0; transform: translateX(-50%) translateY(-4px); }
      to { opacity: 1; transform: translateX(-50%) translateY(0); }
    }

    /* === Post-function type selector cards === */
    .pf-type-selector {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 16px;
    }

    .pf-type-card {
      border: 2px solid var(--border-color);
      border-radius: 12px;
      padding: 16px;
      cursor: pointer;
      transition: all 0.3s ease;
      background: var(--card-bg);
    }

    .pf-type-card:hover {
      border-color: var(--primary-color);
      box-shadow: 0 0 0 1px var(--primary-color);
    }

    .pf-type-active {
      border-color: var(--primary-color);
      background: var(--card-bg);
      box-shadow: 0 0 0 1px var(--primary-color), 0 8px 28px -8px rgba(37, 99, 235, 0.45);
      animation: cardGlow 3s ease-in-out infinite;
    }

    @keyframes cardGlow {
      0%, 100% { box-shadow: 0 0 0 1px var(--primary-color), 0 8px 28px -8px rgba(37, 99, 235, 0.45); }
      50% { box-shadow: 0 0 0 1px var(--primary-color), 0 10px 32px -8px rgba(37, 99, 235, 0.6); }
    }

    .pf-type-header {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 6px;
      color: var(--text-color);
    }

    .pf-type-desc {
      margin: 0 0 8px 0;
      font-size: 12px;
      line-height: 1.4;
      color: var(--text-secondary);
    }

    .pf-type-tag {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .pf-tag-semantic {
      background: var(--error-color);
      color: #ffffff;
    }

    .pf-tag-static {
      background: var(--success-color);
      color: #ffffff;
    }

    /* === How it works banner === */
    .pf-how-it-works {
      background: var(--icon-bg);
      border-radius: 10px;
      padding: 14px 16px;
      margin-bottom: 16px;
      border: 2px solid var(--primary-color);
      box-shadow: 0 4px 12px -4px rgba(37, 99, 235, 0.35);
    }

    .pf-how-header {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 6px;
      font-size: 13px;
      color: var(--primary-color);
    }

    .pf-how-steps {
      margin: 0;
      padding-left: 20px;
      font-size: 12px;
      line-height: 1.6;
      color: var(--text-secondary);
    }

    .pf-how-steps strong {
      color: var(--text-color);
    }

    /* === Function builder === */
    .function-builder { padding: 16px; }

    .function-block {
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 12px;
      background: var(--input-bg);
      transition: all 0.3s ease;
      box-shadow: 0 1px 4px rgba(0,0,0,0.02);
    }

    .function-block:hover {
      border-color: var(--primary-color);
      box-shadow: 0 4px 16px -4px rgba(37, 99, 235, 0.35);
    }

    .function-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 14px;
    }

    .function-number {
      font-weight: 700;
      font-size: 13px;
      color: var(--primary-color);
      min-width: 24px;
    }

    .function-name-input {
      flex: 1;
      font-size: 13px;
    }

    .btn-remove {
      background: none;
      border: 1px solid var(--border-color);
      border-radius: 6px;
      color: var(--error-color);
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
      padding: 4px 8px;
      transition: all 0.2s ease;
    }
    .btn-remove:hover { background: rgba(220, 38, 38, 0.1); border-color: var(--error-color); }

    /* Generate button */
    .generate-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 14px;
    }

    .btn-generate {
      padding: 8px 18px;
      font-size: 13px;
      font-weight: 600;
      border: none;
      border-radius: 8px;
      background: linear-gradient(135deg, #2563eb, #1d4ed8);
      color: white;
      cursor: pointer;
      transition: all 0.25s ease;
      box-shadow: 0 2px 8px rgba(37, 99, 235, 0.3);
    }
    .btn-generate:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
    .btn-generate:disabled { opacity: 0.5; cursor: default; transform: none; }

    .btn-generate-secondary {
      background: transparent;
      color: var(--primary-color);
      border: 1px solid var(--primary-color);
      box-shadow: none;
    }
    .btn-generate-secondary:hover:not(:disabled) {
      background: var(--primary-color);
      color: #ffffff;
      box-shadow: 0 4px 12px -4px rgba(37, 99, 235, 0.45);
      transform: translateY(-1px);
    }

    .generate-hint {
      font-size: 12px;
      color: var(--text-muted);
      font-style: italic;
    }


    /* Advanced section */
    .advanced-section {
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--border-color);
    }

    .btn-advanced-toggle {
      background: none;
      border: 1px solid transparent;
      border-radius: 6px;
      color: var(--text-muted);
      font-size: 11px;
      cursor: pointer;
      padding: 4px 8px;
      display: flex;
      align-items: center;
      gap: 4px;
      transition: all 0.2s ease;
    }
    .btn-advanced-toggle:hover {
      color: var(--text-secondary);
      background: var(--code-bg);
      border-color: var(--border-color);
    }

    .toggle-chevron {
      display: inline-flex;
      transition: transform 0.2s ease;
    }
    .toggle-chevron.open { transform: rotate(180deg); }

    .advanced-options {
      padding-top: 10px;
    }

    .checkbox-label {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--text-secondary);
      cursor: pointer;
    }

    /* Add function button */
    .btn-add-function {
      width: 100%;
      padding: 14px;
      border: 2px dashed var(--border-color);
      border-radius: 12px;
      background: transparent;
      color: var(--text-secondary);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      margin-top: 8px;
      transition: all 0.3s ease;
    }
    .btn-add-function:hover:not(:disabled) {
      border-color: var(--primary-color);
      color: #ffffff;
      background: var(--primary-color);
      box-shadow: 0 4px 12px -4px rgba(37, 99, 235, 0.45);
    }
    .btn-add-function:disabled { opacity: 0.5; cursor: default; }

    /* Context textarea */
    .context-textarea {
      font-family: SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace;
      font-size: 12px;
      line-height: 1.5;
      background: var(--code-bg);
    }

    /* === Documentation Library === */
    .doc-repo {
      margin: 12px 0;
      border: 1px solid var(--border-color);
      border-radius: 10px;
      overflow: hidden;
      background: var(--card-bg);
      box-shadow: 0 1px 4px rgba(0,0,0,0.03);
    }

    .doc-repo-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 12px;
      background: var(--code-bg);
      border-bottom: 1px solid var(--border-color);
    }

    .doc-repo-title-row {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--text-color);
      font-size: 12px;
      font-weight: 600;
    }

    .doc-repo-title { text-transform: uppercase; letter-spacing: 0.3px; }

    .btn-add-doc {
      padding: 4px 10px;
      font-size: 11px;
      font-weight: 500;
      border: 1px solid var(--primary-color);
      border-radius: 6px;
      background: transparent;
      color: var(--primary-color);
      cursor: pointer;
      transition: all 0.25s ease;
    }
    .btn-add-doc:hover {
      background: rgba(37, 99, 235, 0.1);
      box-shadow: 0 2px 6px rgba(37, 99, 235, 0.12);
      transform: translateY(-1px);
    }

    .doc-add-form {
      padding: 12px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .doc-add-row { display: flex; gap: 8px; }
    .doc-category-select { width: 220px; font-size: 12px; }

    .doc-content-input {
      font-family: SFMono-Regular, Consolas, monospace;
      font-size: 12px;
      line-height: 1.5;
      background: var(--code-bg);
    }

    .doc-add-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .doc-size-hint { font-size: 11px; color: var(--text-muted); }

    .btn-save-doc {
      padding: 6px 14px;
      font-size: 12px;
      font-weight: 600;
      border: none;
      border-radius: 4px;
      background: var(--primary-color);
      color: white;
      cursor: pointer;
    }
    .btn-save-doc:hover:not(:disabled) { opacity: 0.85; }
    .btn-save-doc:disabled { opacity: 0.5; cursor: default; }

    .doc-error {
      padding: 6px 10px;
      border-radius: 4px;
      background: var(--error-color);
      color: #ffffff;
      font-size: 12px;
    }

    .doc-empty {
      padding: 16px 12px;
      text-align: center;
      color: var(--text-muted);
      font-size: 12px;
    }

    .doc-list { max-height: 280px; overflow-y: auto; }

    .doc-item {
      border-bottom: 1px solid var(--border-color);
      transition: background 0.1s ease;
    }
    .doc-item:last-child { border-bottom: none; }
    .doc-item:hover { background: var(--code-bg); }

    .doc-selected { background: var(--icon-bg); box-shadow: inset 0 0 0 2px var(--primary-color); }
    .doc-selected:hover { background: var(--icon-bg); }

    .doc-item-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
    }

    .doc-checkbox { display: flex; cursor: pointer; }
    .doc-checkbox input { cursor: pointer; }

    .doc-item-info {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 2px;
      cursor: pointer;
      min-width: 0;
    }

    .doc-item-title {
      font-size: 13px;
      font-weight: 500;
      color: var(--text-color);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .doc-item-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 11px;
      color: var(--text-muted);
    }

    .doc-category-badge {
      padding: 1px 6px;
      border-radius: 3px;
      background: var(--code-bg);
      font-size: 10px;
      font-weight: 500;
    }

    .doc-item-actions {
      display: flex;
      gap: 4px;
      flex-shrink: 0;
    }

    .doc-btn-preview, .doc-btn-delete {
      background: none;
      border: 1px solid var(--border-color);
      border-radius: 3px;
      padding: 2px 6px;
      font-size: 12px;
      cursor: pointer;
      color: var(--text-muted);
    }
    .doc-btn-preview:hover { border-color: var(--primary-color); color: var(--primary-color); }
    .doc-btn-delete:hover { border-color: var(--error-color); color: var(--error-color); }

    .doc-preview {
      padding: 8px 12px 8px 36px;
      border-top: 1px solid var(--border-color);
      background: var(--code-bg);
    }

    .doc-preview-content {
      margin: 0;
      font-family: SFMono-Regular, Consolas, monospace;
      font-size: 11px;
      line-height: 1.5;
      color: var(--text-secondary);
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 200px;
      overflow-y: auto;
    }

    .doc-validation {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      margin-top: 4px;
      border-radius: 4px;
      font-size: 12px;
      font-family: SFMono-Regular, Consolas, monospace;
    }

    .doc-validation-error {
      background: var(--error-color);
      color: #ffffff;
    }

    .doc-validation-ok {
      background: var(--success-color);
      color: #ffffff;
    }

    .doc-selection-info {
      padding: 8px 12px;
      font-size: 11px;
      color: var(--success-color);
      background: rgba(22, 163, 106, 0.06);
      border-top: 1px solid var(--border-color);
    }

    /* Prior step variables indicator */
    .prior-vars-bar {
      padding: 12px 14px;
      margin-bottom: 14px;
      border-radius: 10px;
      background: var(--card-bg);
      border: 2px solid var(--primary-color);
      box-shadow: 0 4px 12px -4px rgba(37, 99, 235, 0.35);
    }

    .prior-vars-header {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 8px;
      color: var(--primary-color);
    }

    .prior-vars-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      color: var(--primary-color);
    }

    .prior-vars-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .prior-var-item {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .prior-var-tag {
      padding: 3px 10px;
      border-radius: 4px;
      background: var(--primary-color);
      color: white;
      font-size: 12px;
      font-family: SFMono-Regular, Consolas, monospace;
      font-weight: 600;
      flex-shrink: 0;
    }

    .prior-var-desc {
      font-size: 11px;
      color: var(--text-secondary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .prior-vars-hint {
      margin: 6px 0 0 0;
      font-size: 10px;
      color: var(--text-muted);
      font-style: italic;
    }

    /* Auto-detected operation badge */
    .op-suggested-badge {
      display: inline-block;
      margin-left: 6px;
      padding: 1px 6px;
      border-radius: 3px;
      background: rgba(37, 99, 235, 0.1);
      color: var(--primary-color);
      font-size: 9px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      vertical-align: middle;
      animation: fadeInBadge 0.3s ease;
    }

    @keyframes fadeInBadge {
      from { opacity: 0; transform: scale(0.8); }
      to { opacity: 1; transform: scale(1); }
    }

    /* REST API section */
    .rest-api-section {
      display: flex;
      flex-direction: column;
      gap: 0;
    }

    .endpoint-assist-row {
      display: flex;
      gap: 8px;
    }

    .endpoint-suggestion {
      margin-top: 8px;
      padding: 10px 12px;
      border-radius: 8px;
      background: var(--card-bg);
      border: 2px solid var(--primary-color);
      box-shadow: 0 4px 12px -4px rgba(37, 99, 235, 0.35);
      font-size: 12px;
      line-height: 1.5;
    }

    .endpoint-suggestion-text {
      margin: 0;
      color: var(--text-color);
    }

    /* Operation-specific fields */
    .op-fields {
      display: grid;
      grid-template-columns: 1fr 2fr;
      gap: 12px;
    }

    /* Reliability section */
    .reliability-section {
      margin: 12px 0;
      padding: 10px 14px;
      border-radius: 10px;
      background: linear-gradient(135deg, var(--code-bg), rgba(37, 99, 235, 0.02));
      border: 1px solid var(--border-color);
      box-shadow: 0 1px 4px rgba(0,0,0,0.03);
    }

    .reliability-header {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 8px;
      color: var(--text-secondary);
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .reliability-title { color: var(--text-secondary); }

    .reliability-options {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    /* === CodeMirror overrides === */
    .cm-editor {
      border: 2px solid var(--border-color);
      border-radius: 10px;
      overflow: hidden;
      font-size: 13px;
    }

    .cm-editor.cm-focused { border-color: var(--primary-color); outline: none; }
    .cm-editor .cm-scroller { overflow: auto; }

    /* Autocomplete dropdown styling */
    .cm-tooltip-autocomplete {
      border: 1px solid var(--border-color) !important;
      border-radius: 6px !important;
      background: var(--card-bg) !important;
      box-shadow: 0 8px 24px rgba(0,0,0,0.15) !important;
      font-size: 12px !important;
    }

    html[data-color-mode="dark"] .cm-tooltip-autocomplete {
      box-shadow: 0 8px 24px rgba(0,0,0,0.4) !important;
    }

    .cm-tooltip-autocomplete > ul > li {
      padding: 4px 8px !important;
    }

    .cm-tooltip-autocomplete > ul > li[aria-selected] {
      background: var(--primary-color) !important;
      color: white !important;
    }

    .cm-completionLabel { font-family: SFMono-Regular, Consolas, monospace; }
    .cm-completionDetail { font-size: 10px; opacity: 0.7; margin-left: 8px; }

    /* Tooltip info panel */
    .cm-completionInfo {
      padding: 8px 12px !important;
      background: var(--card-bg) !important;
      border: 1px solid var(--border-color) !important;
      border-radius: 6px !important;
      font-size: 12px !important;
      color: var(--text-secondary) !important;
      max-width: 300px !important;
    }

    /* Search panel styling */
    .cm-search { background: var(--code-bg) !important; }
    .cm-search input { border-radius: 3px !important; }

    /* Code header with actions */
    .code-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }

    .code-header-actions {
      display: flex;
      gap: 6px;
    }

    .btn-api-ref,
    .btn-test-run {
      padding: 4px 10px;
      font-size: 11px;
      font-weight: 500;
      border: 1px solid var(--border-color);
      border-radius: 4px;
      background: var(--card-bg);
      color: var(--text-secondary);
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .btn-api-ref:hover { border-color: var(--primary-color); color: var(--primary-color); }

    .btn-test-run {
      border-color: var(--success-color);
      color: var(--success-color);
    }
    .btn-test-run:hover { background: var(--success-color); color: #ffffff; }
    .btn-test-run:disabled { opacity: 0.5; cursor: default; }

    /* API Reference panel */
    .api-ref-panel {
      margin-bottom: 10px;
      padding: 12px;
      border-radius: 6px;
      background: var(--input-bg);
      border: 1px solid var(--border-color);
    }

    .api-ref-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      color: var(--text-muted);
      margin-bottom: 8px;
    }

    .api-ref-grid {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .api-ref-item {
      display: flex;
      align-items: baseline;
      gap: 10px;
      font-size: 12px;
      line-height: 1.4;
    }

    .api-ref-item > code {
      flex-shrink: 0;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 11px;
      background: var(--code-bg);
      color: var(--primary-color);
      white-space: nowrap;
    }

    .api-ref-item > span {
      color: var(--text-secondary);
    }

    .api-ref-item > span code {
      padding: 1px 4px;
      border-radius: 2px;
      font-size: 10px;
      background: var(--code-bg);
      color: var(--text-color);
    }

    /* Test panel */
    .test-panel {
      margin-top: 10px;
      border: 2px solid var(--success-color);
      border-radius: 10px;
      overflow: hidden;
      background: var(--input-bg);
      box-shadow: 0 4px 12px -4px rgba(22, 163, 106, 0.35);
    }

    .test-panel-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 12px;
      background: var(--code-bg);
      border-bottom: 1px solid var(--border-color);
      color: var(--success-color);
      font-size: 12px;
      font-weight: 600;
    }

    .test-panel-title { color: var(--text-color); }

    .test-panel-badge {
      margin-left: auto;
      font-size: 10px;
      font-weight: 400;
      color: var(--text-muted);
      font-style: italic;
    }

    .test-panel-target { padding: 10px 12px; }

    .test-target-row {
      display: flex;
      gap: 8px;
    }

    .test-target-input {
      flex: 1;
      font-size: 12px;
      font-family: SFMono-Regular, Consolas, monospace;
    }

    /* === Issue Picker === */
    .issue-picker {
      position: relative;
      flex: 1;
    }

    .issue-picker-input-wrap {
      display: flex;
      align-items: center;
      border: 2px solid var(--border-color);
      border-radius: 8px;
      background: var(--input-bg);
      padding: 0 8px;
      transition: all 0.2s ease;
    }

    .issue-picker-input-wrap:focus-within {
      border-color: var(--primary-color);
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
    }

    .issue-picker-icon { color: var(--text-muted); flex-shrink: 0; }

    .issue-picker-input {
      flex: 1;
      border: none;
      background: transparent;
      color: var(--text-color);
      font-size: 12px;
      font-family: SFMono-Regular, Consolas, monospace;
      padding: 7px 8px;
      outline: none;
    }

    .issue-picker-input::placeholder { color: var(--text-muted); }

    .issue-picker-loading {
      font-size: 12px;
      color: var(--text-muted);
      animation: pulse 1s infinite;
    }

    @keyframes pulse { 50% { opacity: 0.3; } }

    .issue-picker-clear {
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 16px;
      padding: 0 2px;
      line-height: 1;
    }
    .issue-picker-clear:hover { color: var(--text-color); }

    .issue-picker-valid { border-color: var(--success-color); }
    .issue-picker-valid:focus-within { box-shadow: 0 0 0 3px rgba(22, 163, 106, 0.1); border-color: var(--success-color); }
    .issue-picker-invalid { border-color: var(--error-color); }
    .issue-picker-invalid:focus-within { box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.1); border-color: var(--error-color); }

    .issue-picker-validated {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      margin-top: 4px;
      border-radius: 6px;
      font-size: 11px;
    }

    .issue-picker-validated-ok {
      background: var(--success-color);
      color: #ffffff;
    }

    .issue-picker-validated-err {
      background: var(--error-color);
      color: #ffffff;
    }

    .issue-picker-validated strong { color: #ffffff; }
    .issue-picker-validated-summary {
      color: rgba(255, 255, 255, 0.85);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
    }
    .issue-picker-validated-status {
      padding: 1px 6px;
      border-radius: 3px;
      background: var(--code-bg);
      font-size: 10px;
      flex-shrink: 0;
    }
    .issue-picker-validated-ok .issue-picker-validated-status {
      background: #ffffff;
      color: var(--success-color);
    }
    .issue-picker-validated-err .issue-picker-validated-status {
      background: #ffffff;
      color: var(--error-color);
    }

    .issue-picker-dropdown {
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      right: 0;
      z-index: 100;
      background: var(--card-bg);
      border: 2px solid var(--primary-color);
      border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.15);
      max-height: 300px;
      overflow-y: auto;
    }

    html[data-color-mode="dark"] .issue-picker-dropdown {
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    }

    .issue-picker-item {
      padding: 8px 12px;
      cursor: pointer;
      border-bottom: 1px solid var(--border-color);
      transition: all 0.15s ease;
    }

    .issue-picker-item:last-child { border-bottom: none; }
    .issue-picker-item:hover,
    .issue-picker-highlighted { background: var(--code-bg); }

    .issue-picker-item-key {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
    }

    .issue-picker-type-icon { font-size: 14px; }

    .issue-picker-item-summary {
      font-size: 12px;
      color: var(--text-secondary);
      margin-top: 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .issue-picker-item-meta {
      display: flex;
      gap: 8px;
      margin-top: 3px;
      font-size: 10px;
    }

    .issue-picker-status {
      padding: 1px 6px;
      border-radius: 3px;
      background: var(--code-bg);
      color: var(--text-muted);
      font-weight: 500;
    }

    .issue-picker-priority {
      color: var(--text-muted);
    }

    .btn-run-test {
      padding: 6px 16px;
      font-size: 12px;
      font-weight: 600;
      border: none;
      border-radius: 8px;
      background: linear-gradient(135deg, var(--success-color), #15803d);
      color: white;
      cursor: pointer;
      transition: all 0.25s ease;
      white-space: nowrap;
      box-shadow: 0 2px 8px rgba(22, 163, 106, 0.25);
    }
    .btn-run-test:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(22, 163, 106, 0.35); }
    .btn-run-test:disabled { opacity: 0.5; cursor: default; }

    /* Test result */
    .test-result {
      margin-top: 10px;
      border-radius: 6px;
      border: 2px solid;
      overflow: hidden;
    }

    .test-pass { border-color: var(--success-color); }
    .test-fail { border-color: var(--error-color); }

    .test-result-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      font-size: 12px;
    }

    .test-pass .test-result-header { background: var(--success-color); color: #ffffff; }
    .test-fail .test-result-header { background: var(--error-color); color: #ffffff; }
    .test-pass .test-result-header .test-result-meta,
    .test-fail .test-result-header .test-result-meta,
    .test-pass .test-result-header .test-dismiss,
    .test-fail .test-result-header .test-dismiss { color: rgba(255, 255, 255, 0.9); }

    .test-badge {
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .test-badge-pass { background: #ffffff; color: var(--success-color); }
    .test-badge-fail { background: #ffffff; color: var(--error-color); }

    .test-result-meta { color: var(--text-muted); font-size: 11px; }
    .test-dismiss {
      margin-left: auto;
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 16px;
      padding: 0 2px;
    }

    .test-logs {
      padding: 8px 12px;
      border-top: 1px solid var(--border-color);
    }

    .test-logs-title {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      color: var(--text-muted);
      margin-bottom: 4px;
    }

    .test-log-line {
      font-size: 12px;
      line-height: 1.5;
      padding: 1px 0;
    }

    .test-log-line code {
      font-family: SFMono-Regular, Consolas, monospace;
      font-size: 11px;
      color: var(--text-color);
    }

    /* BYOK cost notice */
    .byok-cost-notice {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
      margin: 0;
      background: var(--error-color);
      color: #ffffff;
      font-size: 12px;
      font-weight: 600;
    }

    /* Skeleton loading — hardcoded colors to avoid CSS variable timing issues */
    .sk {
      background: linear-gradient(90deg, #cbd5e1 25%, #f1f5f9 50%, #cbd5e1 75%);
      background-size: 200% 100%;
      animation: skShimmer 1.5s ease-in-out infinite;
      border-radius: 4px;
    }

    html[data-color-mode="dark"] .sk {
      background: linear-gradient(90deg, #1e1e2e 25%, #2a2a3a 50%, #1e1e2e 75%);
      background-size: 200% 100%;
    }

    @keyframes skShimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    .sk-circle { border-radius: 50%; }
    .sk-text { border-radius: 6px; }
    .sk-block { border-radius: 8px; }

    .sk-form { margin-bottom: 0; }

    .sk-table { display: flex; flex-direction: column; gap: 12px; padding: 12px; }
    .sk-table-row { display: flex; gap: 16px; align-items: center; }

    .sk-card {
      padding: 16px;
      border: 1px solid var(--border-color);
      border-radius: 12px;
      background: var(--card-bg);
    }

    .sk-card-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 4px;
    }

    .sk-config { padding: 20px; }
    .sk-config-header { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
    .sk-config-cards { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; }
    .sk-config-form {
      padding: 20px;
      border: 1px solid var(--border-color);
      border-radius: 12px;
      background: var(--card-bg);
    }

    /* AI Loading State */
    .ai-loading {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 16px;
      border-radius: 10px;
      background: linear-gradient(135deg, rgba(37, 99, 235, 0.06), rgba(37, 99, 235, 0.02));
      border: 1px solid rgba(37, 99, 235, 0.15);
      margin-top: 10px;
    }

    .ai-loading-dots {
      display: flex;
      gap: 4px;
      flex-shrink: 0;
    }

    .ai-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--primary-color);
      animation: aiDotPulse 1.4s ease-in-out infinite;
    }

    .ai-dot:nth-child(2) { animation-delay: 0.2s; }
    .ai-dot:nth-child(3) { animation-delay: 0.4s; }

    @keyframes aiDotPulse {
      0%, 80%, 100% { opacity: 0.25; transform: scale(0.8); }
      40% { opacity: 1; transform: scale(1.1); }
    }

    .ai-loading-text {
      font-size: 13px;
      color: var(--primary-color);
      font-weight: 500;
      animation: aiTextFade 0.4s ease;
    }

    @keyframes aiTextFade {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* AI Review panel */
    .review-panel {
      margin: 12px 0;
    }

    .btn-review {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      font-size: 12px;
      font-weight: 600;
      border: 1px solid var(--primary-color);
      border-radius: 8px;
      background: transparent;
      color: var(--primary-color);
      cursor: pointer;
      transition: all 0.25s ease;
    }
    .btn-review:hover:not(:disabled) {
      background: linear-gradient(135deg, rgba(37, 99, 235, 0.08), transparent);
      box-shadow: 0 2px 8px rgba(37, 99, 235, 0.15);
      transform: translateY(-1px);
    }
    .btn-review:disabled { opacity: 0.5; cursor: default; }

    .review-result { margin-top: 10px; }

    .review-verdict {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 10px 14px;
      border-radius: 6px;
      border: 1px solid;
      font-size: 13px;
      line-height: 1.5;
    }

    .review-verdict-icon { flex-shrink: 0; font-size: 16px; }
    .review-verdict-text { flex: 1; }

    .review-items {
      margin-top: 8px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .review-item {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      padding: 6px 10px;
      border-radius: 4px;
      font-size: 12px;
      line-height: 1.5;
    }

    .review-item-icon { flex-shrink: 0; }

    .review-item-success { background: var(--success-color); color: #ffffff; }
    .review-item-warning { background: #d97706; color: #ffffff; }
    .review-item-error { background: var(--error-color); color: #ffffff; }
    .review-item-tip { background: var(--primary-color); color: #ffffff; }

    .review-meta {
      margin-top: 4px;
      font-size: 10px;
      color: var(--text-muted);
      text-align: right;
    }

    .validator-test-section {
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid var(--border-color);
    }

    .semantic-config { padding: 16px; }

    /* Semantic test panel */
    .semantic-test-section {
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid var(--border-color);
    }

    .btn-semantic-test-toggle {
      display: flex;
      align-items: center;
      gap: 6px;
      background: none;
      border: 1px solid var(--success-color);
      border-radius: 8px;
      padding: 8px 14px;
      color: var(--success-color);
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.25s ease;
    }
    .btn-semantic-test-toggle:hover {
      background: var(--success-color);
      color: #ffffff;
      box-shadow: 0 4px 12px -4px rgba(22, 163, 106, 0.45);
      transform: translateY(-1px);
    }

    .semantic-test-panel {
      margin-top: 10px;
      border: 2px solid var(--success-color);
      border-radius: 10px;
      overflow: hidden;
      background: var(--input-bg);
      box-shadow: 0 4px 12px -4px rgba(22, 163, 106, 0.35);
    }

    .semantic-test-header {
      padding: 8px 12px;
      background: var(--code-bg);
      border-bottom: 1px solid var(--border-color);
      font-size: 10px;
    }

    .semantic-test-result {
      border-top: 1px solid var(--border-color);
      overflow: hidden;
    }

    .st-update { border-color: var(--success-color); }
    .st-skip { border-color: var(--primary-color); }
    .st-error { border-color: var(--error-color); }

    .st-result-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      font-size: 12px;
    }

    .st-update .st-result-header { background: rgba(22, 163, 106, 0.06); }
    .st-skip .st-result-header { background: rgba(37, 99, 235, 0.06); }
    .st-error .st-result-header { background: rgba(220, 38, 38, 0.06); }

    .test-badge-skip {
      background: rgba(37, 99, 235, 0.15);
      color: var(--primary-color);
    }

    .st-section {
      padding: 8px 12px;
      border-top: 1px solid var(--border-color);
      font-size: 12px;
    }

    .st-section-label {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      color: var(--text-muted);
      margin-bottom: 4px;
    }

    .st-reason {
      color: var(--text-color);
      line-height: 1.5;
    }

    .st-value {
      margin: 0;
      padding: 8px 10px;
      background: var(--code-bg);
      border-radius: 4px;
      font-family: SFMono-Regular, Consolas, monospace;
      font-size: 11px;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
      color: var(--text-secondary);
      max-height: 200px;
      overflow-y: auto;
    }

    .st-proposed {
      color: var(--success-color);
      border: 1px solid rgba(22, 163, 106, 0.2);
    }

    /* === Knowledge panel (docs / skills / memories) === */
    .knowledge-panel {
      margin: 12px 0;
      border: 1px solid var(--border-color);
      border-radius: 10px;
      overflow: hidden;
      background: var(--card-bg);
      box-shadow: 0 1px 4px rgba(0,0,0,0.03);
    }

    .knowledge-summary {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      background: var(--code-bg);
      cursor: pointer;
      user-select: none;
    }

    .knowledge-title {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      color: var(--text-color);
    }

    .knowledge-summary-counts {
      font-size: 12px;
      font-weight: 700;
      color: var(--text-secondary);
    }
    .kc-docs { color: #2563eb; font-weight: 700; }
    .kc-skills { color: #7c3aed; font-weight: 700; }
    .kc-mem { color: #0d9488; font-weight: 700; }

    .knowledge-auto-chips { display: flex; gap: 6px; flex-wrap: wrap; }

    .knowledge-chevron {
      margin-left: auto;
      display: flex;
      align-items: center;
      color: var(--text-muted);
      transition: transform 0.2s ease;
    }
    .knowledge-chevron.open { transform: rotate(180deg); }

    .knowledge-tabs {
      display: flex;
      gap: 8px;
      padding: 10px 12px;
      border-top: 1px solid var(--border-color);
    }

    .knowledge-tab {
      padding: 5px 14px;
      font-size: 12px;
      font-weight: 700;
      border: 2px solid var(--border-color);
      border-radius: 8px;
      background: transparent;
      color: var(--text-secondary);
      cursor: pointer;
    }
    .knowledge-tab-docs.active { background: #2563eb; border-color: #2563eb; color: #ffffff; }
    .knowledge-tab-skills.active { background: #7c3aed; border-color: #7c3aed; color: #ffffff; }
    .knowledge-tab-memories.active { background: #0d9488; border-color: #0d9488; color: #ffffff; }

    .doc-repo-embedded { padding-bottom: 4px; }

    /* Skills */
    .skill-list { max-height: 320px; overflow-y: auto; }

    .skill-item {
      border-bottom: 1px solid var(--border-color);
      transition: background 0.1s ease;
    }
    .skill-item:last-child { border-bottom: none; }
    .skill-item:hover { background: var(--code-bg); }

    .skill-selected { background: var(--icon-bg); box-shadow: inset 0 0 0 2px #7c3aed; }
    .skill-selected:hover { background: var(--icon-bg); }

    .skill-item-title {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      font-weight: 600;
      color: var(--text-color);
      min-width: 0;
    }

    .skill-when {
      font-size: 11px;
      color: var(--text-secondary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .skill-cat-badge {
      padding: 1px 8px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: 700;
      color: #ffffff;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .skill-cat-jira { background: #2563eb; }
    .skill-cat-external { background: #7c3aed; }
    .skill-cat-fields { background: #0d9488; }
    .skill-cat-adf { background: #d97706; }
    .skill-cat-workflow { background: #16a34a; }
    .skill-cat-other { background: #475569; }

    .skill-auto-chip {
      padding: 1px 8px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: 700;
      background: #7c3aed;
      color: #ffffff;
      white-space: nowrap;
    }

    .btn-save-skill {
      padding: 5px 12px;
      font-size: 12px;
      font-weight: 700;
      border: none;
      border-radius: 6px;
      background: #7c3aed;
      color: #ffffff;
      cursor: pointer;
    }
    .btn-save-skill:hover { opacity: 0.85; }

    .builtin-badge {
      padding: 1px 6px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: 700;
      background: #475569;
      color: #ffffff;
      white-space: nowrap;
      flex-shrink: 0;
    }

    /* Memories */
    .memory-list { max-height: 280px; overflow-y: auto; }

    .memory-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--border-color);
    }
    .memory-item:last-child { border-bottom: none; }

    .memory-source-badge {
      padding: 1px 8px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: 700;
      color: #ffffff;
      text-transform: uppercase;
      flex-shrink: 0;
    }
    .memory-src-user { background: #2563eb; }
    .memory-src-test { background: #d97706; }
    .memory-src-fix { background: #16a34a; }

    .memory-quick-add {
      display: flex;
      gap: 8px;
      padding: 10px 12px;
    }
    .memory-quick-add .input { flex: 1; }

    .btn-remember {
      padding: 6px 14px;
      font-size: 12px;
      font-weight: 700;
      border: none;
      border-radius: 6px;
      background: #0d9488;
      color: #ffffff;
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .btn-remember:hover:not(:disabled) { opacity: 0.85; }
    .btn-remember:disabled { opacity: 0.5; cursor: default; }

    .memory-saved-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-top: 8px;
      padding: 4px 10px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 700;
      background: #0d9488;
      color: #ffffff;
    }

    /* Dark mode — one shade lighter per hue */
    html[data-color-mode="dark"] .kc-docs { color: #3b82f6; }
    html[data-color-mode="dark"] .kc-skills { color: #8b5cf6; }
    html[data-color-mode="dark"] .kc-mem { color: #14b8a6; }
    html[data-color-mode="dark"] .knowledge-tab-docs.active { background: #3b82f6; border-color: #3b82f6; }
    html[data-color-mode="dark"] .knowledge-tab-skills.active { background: #8b5cf6; border-color: #8b5cf6; }
    html[data-color-mode="dark"] .knowledge-tab-memories.active { background: #14b8a6; border-color: #14b8a6; }
    html[data-color-mode="dark"] .skill-selected { box-shadow: inset 0 0 0 2px #8b5cf6; }
    html[data-color-mode="dark"] .skill-cat-jira { background: #3b82f6; }
    html[data-color-mode="dark"] .skill-cat-external { background: #8b5cf6; }
    html[data-color-mode="dark"] .skill-cat-fields { background: #14b8a6; }
    html[data-color-mode="dark"] .skill-cat-adf { background: #f59e0b; }
    html[data-color-mode="dark"] .skill-cat-workflow { background: #22c55e; }
    html[data-color-mode="dark"] .skill-cat-other { background: #64748b; }
    html[data-color-mode="dark"] .skill-auto-chip { background: #8b5cf6; }
    html[data-color-mode="dark"] .btn-save-skill { background: #8b5cf6; }
    html[data-color-mode="dark"] .builtin-badge { background: #64748b; }
    html[data-color-mode="dark"] .memory-src-user { background: #3b82f6; }
    html[data-color-mode="dark"] .memory-src-test { background: #f59e0b; }
    html[data-color-mode="dark"] .memory-src-fix { background: #22c55e; }
    html[data-color-mode="dark"] .btn-remember { background: #14b8a6; }
    html[data-color-mode="dark"] .memory-saved-badge { background: #14b8a6; }

    /* === AI provenance, fix loop, and editor lint/hover === */
    .gen-meta-bar {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      margin: 6px 0;
    }

    .gen-meta-label {
      font-size: 11px;
      font-weight: 700;
      color: var(--text-muted);
      letter-spacing: 0.3px;
    }

    .gen-meta-chip {
      padding: 2px 10px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: 700;
      color: #ffffff;
      white-space: nowrap;
    }
    .gmc-docs { background: #2563eb; }
    .gmc-skill { background: #7c3aed; }
    .gmc-mem { background: #0d9488; }

    .truncation-warning {
      width: 100%;
      margin: 6px 0;
      padding: 8px 10px;
      border-radius: 6px;
      background: #d97706;
      color: #ffffff;
      font-size: 12px;
      font-weight: 600;
    }

    .btn-fix-ai {
      margin-left: 8px;
      padding: 3px 12px;
      font-size: 11px;
      font-weight: 700;
      border: none;
      border-radius: 6px;
      background: #ffffff;
      color: var(--error-color);
      cursor: pointer;
      white-space: nowrap;
    }
    .btn-fix-ai:hover:not(:disabled) { opacity: 0.85; }
    .btn-fix-ai:disabled { opacity: 0.5; cursor: default; }

    .fix-result {
      margin: 8px 0;
      padding: 10px 12px;
      border: 2px solid var(--border-color);
      border-radius: 10px;
      background: var(--card-bg);
    }
    .fix-result.fix-verified { border-color: var(--success-color); }

    .fix-undo-bar {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 13px;
    }
    .fix-undo-bar strong { font-weight: 700; }

    .fix-explanation {
      margin: 6px 0 0;
      font-size: 12px;
      color: var(--text-secondary);
    }

    .test-result-actions {
      display: flex;
      justify-content: flex-end;
      padding: 8px 12px;
      border-top: 1px solid var(--border-color);
    }

    /* Narrate dry-run: deterministic count chips + AI "what this would do" card.
       Solid saturated chips, white text; accent button; inset card. No left rail,
       no faded tint. The slate count chip carries an explicit dark override. */
    .ndr-chips {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      margin-bottom: 6px;
    }
    .ndr-count {
      padding: 2px 10px;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 700;
      color: #ffffff;
      background: #475569;
      white-space: nowrap;
    }
    html[data-color-mode="dark"] .ndr-count { background: #64748b; }
    .ndr-verb {
      padding: 2px 10px;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 700;
      color: #ffffff;
      background: var(--primary-color);
      white-space: nowrap;
    }
    .ndr { padding: 0 12px 10px; }
    .ndr-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 600;
      color: #ffffff;
      background: var(--primary-color);
      border: none;
      border-radius: 6px;
      cursor: pointer;
    }
    .ndr-btn:hover:not(:disabled) { opacity: 0.9; }
    .ndr-btn:disabled { opacity: 0.7; cursor: default; }
    .ndr-card {
      margin-bottom: 10px;
      padding: 10px 12px;
      background: var(--code-bg);
      border: 1px solid var(--border-color);
      border-radius: 10px;
    }
    .ndr-eyebrow {
      font-family: SFMono-Regular, Consolas, monospace;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      color: var(--primary-color);
      margin-bottom: 5px;
    }
    .ndr-summary {
      font-size: 13px;
      line-height: 1.5;
      color: var(--text-color);
    }
    .ndr-verify {
      margin: 8px 0 0;
      padding-left: 18px;
      font-size: 12px;
      line-height: 1.5;
      color: var(--text-secondary);
    }
    .ndr-verify li { margin: 2px 0; }
    .ndr-note {
      padding: 8px 0 0;
      font-size: 12px;
      line-height: 1.5;
      color: var(--text-secondary);
    }

    /* CodeMirror hover docs */
    .cm-api-hover {
      background: var(--card-bg);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      font-size: 12px;
      max-width: 360px;
      padding: 8px 10px;
      color: var(--text-color);
    }

    html[data-color-mode="dark"] .gmc-docs { background: #3b82f6; }
    html[data-color-mode="dark"] .gmc-skill { background: #8b5cf6; }
    html[data-color-mode="dark"] .gmc-mem { background: #14b8a6; }
    html[data-color-mode="dark"] .truncation-warning { background: #f59e0b; }

    /* F19 — AI provider unreachable banner (solid red, white text, no left rail) */
    .provider-down-banner {
      display: flex; align-items: flex-start; gap: 12px;
      background: #dc2626; color: #fff;
      border-radius: 10px; padding: 14px 16px; margin: 0 0 16px;
      box-shadow: 0 2px 10px rgba(220, 38, 38, 0.35);
    }
    .provider-down-banner > svg { flex: 0 0 auto; margin-top: 1px; color: #fff; }
    .provider-down-text { display: flex; flex-direction: column; gap: 4px; flex: 1 1 auto; min-width: 0; }
    .provider-down-text strong { font-weight: 700; font-size: 14px; color: #fff; }
    .provider-down-text span { font-size: 12.5px; line-height: 1.5; color: #fff; }
    .provider-down-recheck {
      flex: 0 0 auto; align-self: center;
      background: #fff; color: #b91c1c; border: none;
      font-weight: 700; font-size: 12px; padding: 7px 14px; border-radius: 6px; cursor: pointer;
    }
    .provider-down-recheck:hover { background: #f3f4f6; }
    .provider-down-recheck:disabled { opacity: 0.6; cursor: default; }
    html[data-color-mode="dark"] .provider-down-banner { background: #ef4444; }
    html[data-color-mode="dark"] .provider-down-recheck { color: #dc2626; }

    /* Live MCP tool chips (solid blue, white text — what an enabled MCP can actually use) */
    .mcp-tool-chip {
      display: inline-block; font-size: 10px; font-weight: 600; line-height: 1.5;
      padding: 2px 8px; border-radius: 10px; background: #2563eb; color: #fff;
      letter-spacing: 0.1px;
    }
    html[data-color-mode="dark"] .mcp-tool-chip { background: #3b82f6; }

    /* Premade (non-AI) rule editor — mirrors config-ui injectStyles() */
    .rulekind-toggle { display: flex; gap: 10px; }
    .rulekind-opt {
      flex: 1; text-align: left; cursor: pointer;
      display: flex; flex-direction: column; gap: 3px;
      padding: 10px 12px; border: 1px solid var(--border-color);
      border-radius: 8px; background: var(--input-bg); color: var(--text-color);
      transition: border-color .15s, background .15s;
    }
    .rulekind-opt:hover { border-color: var(--primary-color); }
    .rulekind-opt.active { background: var(--primary-color); border-color: var(--primary-color); color: #fff; }
    .rulekind-opt-title { font-weight: 700; font-size: 13px; }
    .rulekind-opt-sub { font-size: 11.5px; color: var(--text-secondary); }
    .rulekind-opt.active .rulekind-opt-sub { color: rgba(255,255,255,.85); }

    .pr-form { margin-top: 4px; }
    .pr-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .pr-opt { font-weight: 400; font-size: 11px; color: var(--text-muted); }
    .pr-mono { font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', monospace; font-size: 12.5px; }
    .pr-note {
      background: #b45309; color: #fff; font-weight: 600; font-size: 12.5px;
      padding: 9px 12px; border-radius: 8px; margin-bottom: 16px; line-height: 1.45;
    }
    html[data-color-mode="dark"] .pr-note { background: #d97706; }
    .pr-foot { font-style: italic; }

    /* NL-to-rule builder ("Build from a description") — solid accent button, inset
       result card. Existing tokens only (dark variants present); no left rail/tint. */
    .br-bar { margin-bottom: 14px; }
    .br-toggle {
      display: inline-flex; align-items: center; gap: 6px;
      background: none; border: none; padding: 4px 0; cursor: pointer;
      font-size: 12.5px; font-weight: 600; color: var(--primary-color);
    }
    .br-toggle-caret { display: inline-block; transition: transform 0.15s ease; font-size: 10px; }
    .br-toggle.open .br-toggle-caret { transform: rotate(90deg); }
    .br-toggle-hint { font-weight: 400; color: var(--text-muted); font-size: 11px; }
    .br-body { margin-top: 8px; }
    .br-input {
      width: 100%; box-sizing: border-box; resize: vertical;
      padding: 8px 10px; font-size: 13px; font-family: inherit;
      border: 1px solid var(--border-color); border-radius: 8px;
      background: var(--card-bg); color: var(--text-color); margin-bottom: 8px;
    }
    .br-input:focus { outline: none; border-color: var(--primary-color); }
    .br-btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 12px; font-size: 12px; font-weight: 600;
      color: #fff; background: var(--primary-color); border: none;
      border-radius: 6px; cursor: pointer;
    }
    .br-btn:hover:not(:disabled) { opacity: 0.9; }
    .br-btn:disabled { opacity: 0.6; cursor: default; }
    .br-card {
      margin-top: 10px; padding: 10px 12px;
      background: var(--code-bg); border: 1px solid var(--border-color); border-radius: 10px;
    }
    .br-eyebrow {
      font-family: 'SFMono-Regular', Consolas, monospace; font-size: 10px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.14em; color: var(--primary-color); margin-bottom: 5px;
    }
    .br-summary { font-size: 13px; line-height: 1.5; color: var(--text-color); }
    .br-applied { font-size: 12px; color: var(--text-secondary); margin-top: 6px; }
    .br-hint { font-size: 12px; color: #b45309; margin-top: 6px; font-weight: 600; }
    html[data-color-mode="dark"] .br-hint { color: #f59e0b; }
    .br-note { margin-top: 10px; font-size: 12px; line-height: 1.5; color: var(--text-secondary); }

    /* Premade recipe picker (FunctionBlock "Start from a recipe") */
    .recipe-bar { margin-bottom: 14px; border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden; }
    .recipe-bar-toggle {
      width: 100%; display: flex; align-items: center; gap: 8px; padding: 9px 12px;
      background: var(--input-bg); border: none; cursor: pointer; color: var(--text-color);
      font-weight: 600; font-size: 13px;
    }
    .recipe-bar-icon { color: var(--text-secondary); }
    .recipe-bar-sub { margin-left: auto; font-weight: 400; font-size: 11px; color: var(--text-muted); }
    .recipe-bar-body { padding: 12px; border-top: 1px solid var(--border-color); }
    .recipe-desc { margin: 0 0 12px 0; font-size: 12px; color: var(--text-secondary); }
    .recipe-note { background: #b45309; color: #fff; font-weight: 600; font-size: 12px; padding: 8px 10px; border-radius: 6px; margin-bottom: 10px; }
    html[data-color-mode="dark"] .recipe-note { background: #d97706; }
    .gen-meta-chip.gmc-recipe { background: #4f46e5; color: #fff; }
    html[data-color-mode="dark"] .gen-meta-chip.gmc-recipe { background: #6366f1; }
  `;
  document.head.appendChild(style);
};


let invoke;
let router;

const TABS = [
  { key: "rules", label: "Rules" },
  { key: "logs", label: "Execution Logs" },
  { key: "docs", label: "Documentation" },
  { key: "skills", label: "Skills" },
  { key: "memories", label: "Memories" },
  { key: "permissions", label: "Permissions", adminOnly: true },
  { key: "settings", label: "Settings", adminOnly: true },
];

// One-line "what this is / when to use it" per tab — the single copy source so the
// concept-heavy admin panel stays coherent for non-technical admins.
const SURFACES = {
  rules: { eyebrow: "RULES", what: "Every AI validator, condition, and post-function you've configured, across all workflows — toggle, edit, or explain any rule from here." },
  logs: { eyebrow: "EXECUTION LOGS", what: "A running history of what your rules did on real transitions: pass or fail, the AI's reasoning, and any changes a post-function made." },
  docs: { eyebrow: "DOCUMENTATION", what: "Reference docs the AI reads when it generates code and validates fields. Add your own API notes or conventions; the built-in guides come seeded." },
  skills: { eyebrow: "SKILLS", what: "Reusable instruction packs the AI applies when generating post-function code — auto-matched by keyword, or picked per step." },
  memories: { eyebrow: "MEMORIES", what: "Short facts this instance has learned from fixes and your corrections. They sharpen future AI output; runtime use is opt-in (per-transition token cost)." },
  permissions: { eyebrow: "PERMISSIONS", what: "Who can create and edit CogniRunner rules on this site. App admins manage the roster; editors manage rules." },
  settings: { eyebrow: "SETTINGS", what: "Your AI provider, API key, and model, plus the MCP tools the agent can call. Keys are stored in Forge storage, never in environment variables." },
};

// Execution Logs page size (logs are capped at 50 server-side, so this paginates
// the recent window client-side).
const LOGS_PAGE_SIZE = 10;

// Free-text filters (case-insensitive) for the Rules table and Execution Logs.
// q is expected pre-lowercased + trimmed by the caller.
const ruleMatchesQuery = (c, q) => {
  if (!q) return true;
  const wf = c.workflow || {};
  return [
    c.type, c.fieldId, c.actionFieldId, c.prompt, c.conditionPrompt, c.actionPrompt,
    wf.workflowName, wf.workflowId, wf.transitionFromName, wf.transitionToName,
  ].filter(Boolean).join(" ").toLowerCase().includes(q);
};
const logMatchesQuery = (l, q) => {
  if (!q) return true;
  return [
    l.issueKey, l.ruleName, l.fieldId, l.reason, l.type, l.decision, l.recommendation,
  ].filter(Boolean).join(" ").toLowerCase().includes(q);
};

// Map a task type to a short human label + the badge hue class used in the
// Active Jobs panel and per-rule chips.
const JOB_TYPE_LABEL = {
  review: "Review", codegen: "Codegen", fixcode: "Fix Code",
  skilldistill: "Skill", postfunction: "Post Function", memory_distill: "Memory",
};
const jobTypeLabel = (t) => JOB_TYPE_LABEL[t] || t || "Job";
// Human elapsed/queued/duration string for a job row.
const jobTimeText = (j) => {
  try {
    if (j.status === "queued" && j.enqueuedAt) {
      const s = Math.max(0, Math.round((Date.now() - Date.parse(j.enqueuedAt)) / 1000));
      return `waiting ${s}s`;
    }
    if (j.status === "running" && j.startedAt) {
      const s = Math.max(0, Math.round((Date.now() - Date.parse(j.startedAt)) / 1000));
      return `running ${s}s`;
    }
    if (typeof j.durationMs === "number") return `took ${Math.round(j.durationMs / 1000)}s`;
  } catch { /* ignore */ }
  return "";
};

function App() {
  const [configs, setConfigs] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [logsLoading, setLogsLoading] = useState(false);
  const [showLogs, setShowLogs] = useState(true);
  const [logsPage, setLogsPage] = useState(0);
  const [logsSearch, setLogsSearch] = useState("");
  const [rulesSearch, setRulesSearch] = useState("");
  const [licenseActive, setLicenseActive] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userRole, setUserRole] = useState(null); // "viewer" | "editor" | "admin" | null
  const [userScope, setUserScope] = useState(null); // "own" | "all" | null
  const [accountId, setAccountId] = useState(null);
  const [activeTab, setActiveTab] = useState("rules");
  const [rulesFilter, setRulesFilter] = useState("all");
  const [showAddWizard, setShowAddWizard] = useState(false);
  const [typeFilter, setTypeFilter] = useState("all");
  // Monotonic token — a slow older fetch (e.g. rapid All/My Rules flips) must
  // never overwrite a newer call's rows or drop its refresh veil early.
  const configsFetchToken = useRef(0);

  const fetchConfigs = async (showLoading = false, filterOverride) => {
    if (!invoke) return;
    const token = ++configsFetchToken.current;
    if (showLoading) setRefreshingConfigs(true);
    try {
      const result = await invoke("getConfigs", { filter: filterOverride || rulesFilter });
      if (token !== configsFetchToken.current) return; // stale response
      if (result.success) {
        setConfigs(result.configs || []);
        if (result.removedCount > 0) {
          setRemovedCount(result.removedCount);
        }
      }
    } catch (e) {
      if (token !== configsFetchToken.current) return;
      console.error("Failed to fetch configs:", e);
    }
    // Only the latest call owns the veil — a stale call clearing it would end
    // the in-flight indicator while the newer fetch is still running.
    if (showLoading && token === configsFetchToken.current) setRefreshingConfigs(false);
  };

  // --- Workstream R: discover CogniRunner rules ATTACHED to workflows but not in
  // the registry (REST automation, imported/copied workflows, failed register).
  // They execute at runtime but never appear under Configured Rules until claimed.
  const [discovered, setDiscovered] = useState(null); // null = not yet scanned
  const [discMeta, setDiscMeta] = useState(null);
  // This site's base URL (from the Forge context) — used to build the "Edit" deep-link to the
  // Jira workflow editor for rules whose stored config has no siteUrl (e.g. discovered rules).
  const [siteUrl, setSiteUrl] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [registeringDisc, setRegisteringDisc] = useState(false);

  const scanDiscoveredRules = async () => {
    if (!invoke) return;
    setDiscovering(true);
    try {
      const r = await invoke("discoverWorkflowRules");
      if (r && r.success) {
        setDiscovered(r.discovered || []);
        setDiscMeta({ scannedWorkflows: r.scannedWorkflows, totalCogniRules: r.totalCogniRules, registeredMatched: r.registeredMatched, truncated: r.truncated });
      } else {
        setDiscovered([]);
        setDiscMeta({ error: (r && r.error) || "Scan failed" });
      }
    } catch (e) {
      setDiscovered([]);
      setDiscMeta({ error: e.message });
    }
    setDiscovering(false);
  };

  // F19 — active AI-provider health probe driving the "provider unreachable" banner.
  const checkProviderHealth = async () => {
    if (!invoke) return;
    setHealthChecking(true);
    try {
      const r = await invoke("checkProviderHealth");
      setProviderHealth(r && r.success ? r : null);
    } catch (e) {
      // Probe itself failed (e.g. resolver timeout on a very slow self-hosted model) —
      // treat as unknown rather than alarming; the banner only fires on a clear config error.
      setProviderHealth(null);
    }
    setHealthChecking(false);
  };

  const registerAllDiscovered = async () => {
    if (!invoke || !discovered || !discovered.length) return;
    setRegisteringDisc(true);
    try {
      // Stamp this site's base URL onto each discovered rule so its stored config can build the
      // Edit deep-link (the backend scan can't know the site's URL; the frontend can).
      const rules = siteUrl ? discovered.map((d) => ({ ...d, siteUrl })) : discovered;
      const r = await invoke("registerDiscoveredRules", { rules });
      if (r && r.success) {
        await scanDiscoveredRules(); // now-registered rows drop out
        await fetchConfigs(true);    // refresh the managed list
      }
    } catch (e) {
      console.error("registerDiscoveredRules failed:", e);
    }
    setRegisteringDisc(false);
  };

  const fetchLogs = async () => {
    if (!invoke) return;
    setLogsLoading(true);
    try {
      const result = await invoke("getLogs");
      if (result.success) {
        setLogs(result.logs || []);
        setLogsPage(0); // newest page after a (re)fetch
      }
    } catch (e) {
      console.error("Failed to fetch logs:", e);
    }
    setLogsLoading(false);
  };

  const clearLogs = async () => {
    if (!invoke) return;
    // Destructive and unrecoverable — never fire on a stray click.
    if (!(await confirmDialog("This permanently deletes every execution log entry and cannot be undone.", { title: "Clear all execution logs?", confirmLabel: "Clear all", danger: true }))) return;
    setClearingLogs(true);
    try {
      const result = await invoke("clearLogs");
      if (result && result.success === false) {
        showToast(result.error || "Failed to clear logs", "error");
      } else {
        setLogs([]);
        showToast("Logs cleared");
      }
    } catch (e) {
      console.error("Failed to clear logs:", e);
      showToast("Failed to clear logs: " + e.message, "error");
    }
    setClearingLogs(false);
  };

  const [removedCount, setRemovedCount] = useState(0);
  const [providerHealth, setProviderHealth] = useState(null); // { ok, transient, providerLabel, model, status, message }
  const [healthChecking, setHealthChecking] = useState(false);
  const [refreshingConfigs, setRefreshingConfigs] = useState(false);
  const [clearingLogs, setClearingLogs] = useState(false);
  const [toggling, setToggling] = useState(null);
  const [toggleError, setToggleError] = useState(null);
  const [toggleWarning, setToggleWarning] = useState(null);

  const toggleRule = async (id, currentlyDisabled) => {
    if (!invoke) return;
    setToggling(id);
    setToggleError(null);
    setToggleWarning(null);
    try {
      const action = currentlyDisabled ? "enableRule" : "disableRule";
      const result = await invoke(action, { id });
      if (result.success) {
        setConfigs((prev) =>
          prev.map((c) =>
            c.id === id ? { ...c, disabled: result.disabled, updatedAt: new Date().toISOString() } : c
          )
        );
        if (result.warning) {
          setToggleWarning(result.warning);
        }
      } else {
        setToggleError(result.error || "Failed to update rule. Please try again.");
      }
    } catch (e) {
      console.error("Failed to toggle rule:", e);
      setToggleError("Failed to communicate with the server. Please try again.");
    }
    setToggling(null);
  };

  const formatTime = (timestamp) => {
    try {
      return new Date(timestamp).toLocaleString();
    } catch {
      return timestamp;
    }
  };

  // === Async jobs (queued + ongoing) — operational view in the Logs tab and
  // per-rule chips in the Rules tab. Polls getAsyncJobs while either tab is open
  // (tight cadence when work is active, relaxed when idle); stops on other tabs.
  const [jobs, setJobs] = useState({ queued: [], running: [], recent: [] });
  const [jobsLoading, setJobsLoading] = useState(false);
  const [killingAll, setKillingAll] = useState(false);
  const jobsRef = useRef({ queued: [], running: [], recent: [] });
  const jobsPollRef = useRef(null);

  const fetchJobs = async (silent = false) => {
    if (!invoke) return;
    if (!silent) setJobsLoading(true);
    try {
      const r = await invoke("getAsyncJobs");
      if (r && r.success) {
        const next = r.jobs || { queued: [], running: [], recent: [] };
        jobsRef.current = next;
        setJobs(next);
      }
    } catch (e) {
      console.error("Failed to fetch jobs:", e);
    }
    if (!silent) setJobsLoading(false);
  };

  const cancelJob = async (taskId) => {
    if (!invoke) return;
    try {
      const r = await invoke("cancelJob", { taskId });
      if (r && r.success) { showToast("Job stopped"); fetchJobs(true); }
      else showToast((r && r.error) || "Failed to stop job", "error");
    } catch (e) { showToast("Failed to stop job: " + e.message, "error"); }
  };

  const cancelAllQueued = async () => {
    if (!invoke) return;
    // Destructive — confirm. Honest about the guarantee: queued jobs die outright,
    // running jobs are stopped before any further Jira write (the in-flight AI
    // call may finish but makes no change).
    if (!(await confirmDialog("Queued jobs are cancelled outright. Jobs already running are stopped before any further Jira changes are made (an in-flight AI call may finish but will not write anything).", { title: "Stop all queued and running jobs?", confirmLabel: "Stop all", danger: true }))) return;
    setKillingAll(true);
    try {
      const r = await invoke("cancelAllQueuedJobs");
      if (r && r.success) { showToast(`Stopped ${r.cancelled || 0} job(s)`); fetchJobs(true); }
      else showToast((r && r.error) || "Failed to stop jobs", "error");
    } catch (e) { showToast("Failed to stop jobs: " + e.message, "error"); }
    setKillingAll(false);
  };

  // Poll while the Logs or Rules tab is open; tighten when active, relax when idle.
  useEffect(() => {
    const watch = activeTab === "logs" || activeTab === "rules";
    if (!watch) { if (jobsPollRef.current) clearTimeout(jobsPollRef.current); return; }
    let stopped = false;
    const tick = async () => {
      await fetchJobs(true);
      if (stopped) return;
      const j = jobsRef.current;
      const active = (j.queued?.length || 0) + (j.running?.length || 0);
      jobsPollRef.current = setTimeout(tick, active > 0 ? 3500 : 10000);
    };
    tick();
    return () => { stopped = true; if (jobsPollRef.current) clearTimeout(jobsPollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Execution Logs are expanded by default — auto-load them when the Logs tab
  // opens (fresh data each visit, same as clicking Refresh).
  useEffect(() => {
    if (activeTab === "logs" && showLogs) fetchLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const canKill = userRole === "editor" || userRole === "admin";
  const logsQuery = logsSearch.trim().toLowerCase();
  const filteredLogs = logsQuery ? logs.filter((l) => logMatchesQuery(l, logsQuery)) : logs;
  const totalLogPages = Math.max(1, Math.ceil(filteredLogs.length / LOGS_PAGE_SIZE));

  // Group active (queued + running) jobs by ruleId for the per-rule chips.
  const jobsByRule = {};
  for (const j of [...(jobs.running || []), ...(jobs.queued || [])]) {
    if (!j.ruleId) continue;
    (jobsByRule[j.ruleId] = jobsByRule[j.ruleId] || []).push(j);
  }

  // One job row, shared by the Active Jobs panel and the per-rule accordion.
  const renderJobRow = (j) => {
    const statusClass = j.stalled ? "stalled" : j.status;
    const statusLabel = j.stalled ? "STALLED"
      : j.status === "queued" ? "QUEUED"
      : j.status === "running" ? "RUNNING"
      : j.status === "done" ? "DONE"
      : j.status === "error" ? "ERROR"
      : j.status === "cancelled" ? "CANCELLED" : String(j.status || "").toUpperCase();
    const active = j.status === "queued" || j.status === "running";
    return (
      <div key={j.taskId} className="job-entry">
        <span className={`job-status ${statusClass}`}>
          {j.status === "running" && !j.stalled && <span className="status-dot-checking" />}
          {statusLabel}
        </span>
        <span className="job-type-badge">{jobTypeLabel(j.taskType)}</span>
        {j.ruleName && <span className="job-rule" title={j.ruleName}>{j.ruleName}</span>}
        {j.issueKey && <span className="job-issue">{j.issueKey}</span>}
        {j.provider && <span className="job-provider">{j.provider}</span>}
        <span className="job-time">{jobTimeText(j)}</span>
        {j.status === "error" && j.error && <span className="job-error" title={j.error}>{j.error}</span>}
        {canKill && active && (
          <button className="btn-small btn-danger job-stop" onClick={() => cancelJob(j.taskId)} title="Stop this job">
            Stop
          </button>
        )}
      </div>
    );
  };

  // One execution-log entry, shared by the global Logs list and the per-rule
  // accordion. Extracted so both render identically.
  const renderLogEntry = (log) => {
    const logType = log.type || "validation";
    const typeBadge = logType.includes("postfunction-semantic") ? "PF: Semantic"
      : logType.includes("postfunction-static") ? "PF: Static"
      : logType.includes("postfunction") ? "Post Function"
      : logType === "condition" ? "Condition"
      : logType === "postfunction-cancelled" ? "Cancelled"
      : "Validator";
    const typeBadgeClass = logType.includes("postfunction-semantic") ? "lt-pf-semantic"
      : logType.includes("postfunction-static") ? "lt-pf-static"
      : logType.includes("postfunction") ? "lt-pf"
      : logType === "condition" ? "lt-condition"
      : "lt-validator";
    const editUrl = log.ruleWorkflow?.workflowId && log.ruleWorkflow?.siteUrl
      ? `${log.ruleWorkflow.siteUrl}/jira/settings/issues/workflows/${log.ruleWorkflow.workflowId}`
      : null;
    return (
      <div key={log.id} className="log-entry">
        <div className="log-header">
          <span className={`log-status ${log.isValid ? "valid" : (log.decision === "SKIP" ? "skip" : "invalid")}`}>
            {log.isValid ? "PASS" : (log.decision === "SKIP" ? "SKIP" : "ERR")}
          </span>
          <span className={`log-type-badge ${typeBadgeClass}`}>{typeBadge}</span>
          <span className="log-issue">{log.issueKey}</span>
          <span className="log-meta">
            {log.executionTimeMs ? <span className="log-ms">{log.executionTimeMs}ms</span> : null}
            <span className="log-time">
              {formatTime(log.timestamp)}
              {log.queueDelayMs >= 60000 ? ` · waited ${Math.round(log.queueDelayMs / 60000)} min in queue` : ""}
            </span>
          </span>
          {(userRole === "editor" || userRole === "admin") && editUrl && (
            <button
              className="btn-small btn-edit"
              style={{ fontSize: "10px", padding: "2px 6px" }}
              onClick={() => router && router.open(editUrl)}
              title="Edit this rule in workflow editor"
            >
              Edit Rule
            </button>
          )}
        </div>
        {log.ruleName && (
          <div className="log-details">
            <span className="log-kv">
              <span className="log-kv-label">Rule</span>
              <span>{log.ruleName}</span>
            </span>
          </div>
        )}
        <div className="log-details">
          <span className="log-kv">
            <span className="log-kv-label">Field</span>
            <code className="field-id">{log.fieldId}</code>
          </span>
          {log.decision && (
            <span className="log-kv">
              <span className="log-kv-label">Decision</span>
              <strong>{log.decision}</strong>
            </span>
          )}
        </div>
        {log.reason && (
          <>
            <div className="log-section-label">AI reason</div>
            <div className="log-reason">{log.reason}</div>
          </>
        )}
        {log.tokens && (
          <div className="log-foot">
            AI: {log.aiTimeMs || log.executionTimeMs}ms · {log.tokens} tokens
          </div>
        )}
      </div>
    );
  };

  // Per-rule execution-log accordion state.
  const [expandedRuleId, setExpandedRuleId] = useState(null);
  const [ruleLogs, setRuleLogs] = useState({}); // { [ruleId]: log[] }
  const [ruleLogsLoading, setRuleLogsLoading] = useState(false);
  // Per-rule "Explain this rule" state, keyed by config.id so rows explain
  // independently: { [id]: { open, status: idle|loading|done|degraded|error, text, reason } }
  const [explain, setExplain] = useState({});

  const toggleRuleExpand = async (ruleId) => {
    if (expandedRuleId === ruleId) { setExpandedRuleId(null); return; }
    setExpandedRuleId(ruleId);
    if (!ruleLogs[ruleId] && invoke) {
      setRuleLogsLoading(true);
      try {
        const r = await invoke("getLogs", { ruleId });
        if (r && r.success) setRuleLogs((prev) => ({ ...prev, [ruleId]: r.logs || [] }));
      } catch (e) { console.error("Failed to fetch rule logs:", e); }
      setRuleLogsLoading(false);
    }
  };

  // App-authored monumental label per kind (the resolver defangs + clamps to 60).
  const explainLabelFor = (kind) => {
    if (kind === "semantic-pf") return "AI Semantic Post-Function";
    if (kind === "static-pf") return "AI Static Post-Function";
    if (kind === "premade-condition" || kind === "premade-validator" || kind === "premade") return "Premade rule";
    return kind === "condition" ? "AI Condition" : "AI Validator";
  };

  // One explainRule call per rule, on explicit click. Registry config.type is
  // explicit (condition/validator/postfunction-*) so the kind is unambiguous.
  const runExplainFor = async (config) => {
    const id = config.id;
    if (explain[id] && explain[id].status === "loading") return;
    setExplain((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), open: true, status: "loading" } }));
    try {
      const kind = ruleKindEnum(config, config.type, config.type === "condition");
      const factsText = buildFactsText(config, config.functions?.length ? config.functions : (config.functionsMeta || []));
      const result = await invoke("explainRule", { kind, ruleTypeLabel: explainLabelFor(kind), factsText });
      // degraded and success co-occur on the resolver's timeout/error path — test degraded FIRST.
      if (result && result.degraded) {
        setExplain((prev) => ({ ...prev, [id]: { open: true, status: "degraded", reason: result.reason || "error" } }));
      } else if (result && result.success && result.explanation) {
        setExplain((prev) => ({ ...prev, [id]: { open: true, status: "done", text: result.explanation } }));
      } else {
        setExplain((prev) => ({ ...prev, [id]: { open: true, status: "error" } }));
      }
    } catch (e) {
      console.error("Explain rule failed:", e);
      setExplain((prev) => ({ ...prev, [id]: { open: true, status: "error" } }));
    }
  };

  // Toggle the explanation row; fetch only the first time it's opened (cached after).
  const toggleExplain = (config) => {
    const id = config.id;
    const cur = explain[id];
    if (cur && cur.open) {
      setExplain((prev) => ({ ...prev, [id]: { ...prev[id], open: false } }));
    } else if (cur && (cur.status === "done" || (cur.status === "degraded" && cur.reason === "lmstudio"))) {
      // Re-show only the PERMANENT results without a refetch; timeout/error degrades
      // fall through so a click retries them (once the 2-min negative cache expires).
      setExplain((prev) => ({ ...prev, [id]: { ...prev[id], open: true } }));
    } else {
      runExplainFor(config);
    }
  };

  useEffect(() => {
    injectStyles();
    injectCopiedComponentStyles();

    const init = async () => {
      try {
        const bridge = await import("@forge/bridge");
        invoke = bridge.invoke;
        router = bridge.router;

        if (bridge.view && bridge.view.theme && bridge.view.theme.enable) {
          await bridge.view.theme.enable();
        }

        // Check license
        const context = await bridge.view.getContext();
        if (context?.siteUrl) setSiteUrl(String(context.siteUrl).replace(/\/+$/, ""));
        const ctxLicense = context?.license?.active;
        if (ctxLicense !== undefined) {
          setLicenseActive(ctxLicense);
        }

        try {
          const licenseResult = await invoke("checkLicense");
          if (licenseResult?.isActive !== undefined) {
            setLicenseActive(licenseResult.isActive);
          }
        } catch (e) {
          console.log("Could not check license:", e);
        }
        // Detect if accessed from jira:adminPage (auto-admin)
        const moduleType = context?.extension?.type;
        if (moduleType === "jira:adminPage") {
          setIsAdmin(true);
        }
      } catch (e) {
        console.log("Bridge not available:", e);
      }

      // Check role BEFORE fetching configs
      let userIsAdmin = false;
      let detectedRole = null;
      let detectedScope = null;

      try {
        const adminResult = await invoke("checkIsAdmin");
        if (adminResult.success) {
          if (adminResult.isAdmin) userIsAdmin = true;
          detectedRole = adminResult.role;
          detectedScope = adminResult.scope;
          setAccountId(adminResult.accountId);
        }
      } catch (e) {
        console.log("Could not check role:", e);
      }

      // jira:adminPage always grants admin
      if (isAdmin) { userIsAdmin = true; detectedRole = "admin"; detectedScope = "all"; }
      setIsAdmin((prev) => prev || userIsAdmin);
      setUserRole(detectedRole);
      setUserScope(detectedScope);

      // Determine filter based on role + scope
      const defaultFilter = (detectedScope === "all" || detectedRole === "admin") ? "all" : "mine";
      setRulesFilter(defaultFilter);
      await fetchConfigs(false, defaultFilter);
      setLoading(false);
      // F19 — probe the active provider once admin is established (admin-gated resolver).
      if (userIsAdmin) checkProviderHealth();
    };
    init();
  }, []);

  // Re-fetch configs when filter changes
  useEffect(() => {
    // showLoading=true: a filter change is user-triggered — without it the
    // stale rows for the OLD filter sit on screen with zero signal until the
    // fetch resolves (the veil over the table is the in-flight indicator).
    if (!loading && invoke) fetchConfigs(true);
  }, [rulesFilter]);

  if (loading) {
    return (
      <div className="container" style={{ padding: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "24px" }}>
          <div className="sk" style={{ width: 40, height: 40, borderRadius: "50%" }} />
          <div style={{ flex: 1 }}>
            <div className="sk sk-text" style={{ width: "40%", height: 16, marginBottom: 6 }} />
            <div className="sk sk-text" style={{ width: "65%", height: 12 }} />
          </div>
        </div>
        <div style={{ display: "flex", gap: "0", marginBottom: "20px", borderBottom: "2px solid var(--border-color)", paddingBottom: "0" }}>
          <div className="sk sk-text" style={{ width: 60, height: 14, margin: "10px 20px 12px 0" }} />
          <div className="sk sk-text" style={{ width: 100, height: 14, margin: "10px 20px 12px 0" }} />
          <div className="sk sk-text" style={{ width: 80, height: 14, margin: "10px 20px 12px 0" }} />
        </div>
        <div className="sk sk-block" style={{ height: 200, borderRadius: 12 }} />
      </div>
    );
  }

  const licenseBanner = licenseActive === false ? (
    <div className="license-banner license-inactive">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <span>License inactive — AI validation is disabled. Transitions will pass through without checks.</span>
    </div>
  ) : licenseActive === true ? (
    <div className="license-banner license-active">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M20 6L9 17l-5-5" />
      </svg>
      <span>License active</span>
    </div>
  ) : null;

  return (
    <div className="container">
      <div className="header">
        <div className="icon-wrapper">
          <svg width="24" height="24" viewBox="0 0 128 128" fill="none">
            <defs><linearGradient id="adminBg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#0065FF"/><stop offset="100%" stopColor="#4C9AFF"/></linearGradient></defs>
            <rect x="4" y="4" width="120" height="120" rx="24" ry="24" fill="url(#adminBg)"/>
            <path d="M44 42C44 34 52 28 58 28C62 28 64 30 64 34L64 64" stroke="white" strokeWidth="5" strokeLinecap="round"/>
            <path d="M38 52C32 52 28 58 28 64C28 72 34 78 42 78L64 78" stroke="white" strokeWidth="5" strokeLinecap="round"/>
            <path d="M48 36C48 36 42 42 42 50" stroke="white" strokeWidth="4" strokeLinecap="round"/>
            <path d="M84 42C84 34 76 28 70 28C66 28 64 30 64 34" stroke="white" strokeWidth="5" strokeLinecap="round"/>
            <path d="M90 52C96 52 100 58 100 64C100 72 94 78 86 78L64 78" stroke="white" strokeWidth="5" strokeLinecap="round"/>
            <path d="M80 36C80 36 86 42 86 50" stroke="white" strokeWidth="4" strokeLinecap="round"/>
            <circle cx="44" cy="50" r="3.5" fill="white" opacity="0.9"/><circle cx="84" cy="50" r="3.5" fill="white" opacity="0.9"/><circle cx="64" cy="34" r="3.5" fill="white" opacity="0.9"/><circle cx="42" cy="78" r="3.5" fill="white" opacity="0.9"/><circle cx="86" cy="78" r="3.5" fill="white" opacity="0.9"/>
            <circle cx="64" cy="58" r="10" stroke="white" strokeWidth="4" fill="none"/><circle cx="64" cy="58" r="4" fill="white"/>
            <path d="M56 92L72 92L72 86L88 96L72 106L72 100L56 100Z" fill="white" opacity="0.95"/>
          </svg>
        </div>
        <div>
          <h2 className="title">CogniRunner Admin</h2>
          <p className="subtitle">Overview of all AI validators and conditions configured across your workflows</p>
        </div>
      </div>

      {licenseBanner}

      {/* F19 — a misconfigured/unreachable provider returns a persistent config error
          (401/403/404). Validators & conditions FAIL CLOSED on it, so every AI-guarded
          transition silently blocks. Surface that loudly so the admin knows WHY nothing
          is transitioning. Transient (429/5xx/timeout) outages fail OPEN — not shown. */}
      {providerHealth && providerHealth.ok === false && !providerHealth.transient && (
        <div className="provider-down-banner" role="alert">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <div className="provider-down-text">
            <strong>AI provider unreachable — workflow validations are blocking every transition.</strong>
            <span>
              {providerHealth.providerLabel}
              {providerHealth.model ? ` (${providerHealth.model})` : ""} returned{" "}
              {providerHealth.status ? `HTTP ${providerHealth.status}` : "an error"}. Validators and
              conditions fail closed on a configuration error, so any transition guarded by an AI rule
              is blocked until you fix the key, base URL, or model in Settings.
              {providerHealth.message ? ` — ${providerHealth.message}` : ""}
            </span>
          </div>
          <button className="provider-down-recheck" onClick={checkProviderHealth} disabled={healthChecking}>
            {healthChecking ? "Checking…" : "Re-check"}
          </button>
        </div>
      )}

      <TabBar tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} isAdmin={isAdmin} />

      {SURFACES[activeTab] && (
        <div className="tab-intro">
          <span className="tab-intro-eyebrow">§ {SURFACES[activeTab].eyebrow}</span>
          <span className="tab-intro-what">{SURFACES[activeTab].what}</span>
        </div>
      )}

      {toggleError && (
        <div className="alert alert-error">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{toggleError}</span>
          <button className="alert-dismiss" onClick={() => setToggleError(null)}>&times;</button>
        </div>
      )}

      {toggleWarning && (
        <div className="alert alert-warning">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span>{toggleWarning}</span>
          <button className="alert-dismiss" onClick={() => setToggleWarning(null)}>&times;</button>
        </div>
      )}

      {removedCount > 0 && (
        <div className="alert alert-warning">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
          </svg>
          <span>Cleaned up {removedCount} orphaned rule{removedCount > 1 ? "s" : ""} no longer present in any workflow.</span>
          <button className="alert-dismiss" onClick={() => setRemovedCount(0)}>&times;</button>
        </div>
      )}

      {/* Configured Rules Section */}
      {activeTab === "rules" && (<>
      {/* Workstream R: rules attached to workflows but not in the registry —
          they execute on transitions but won't appear under Configured Rules
          until claimed. Surfacing them closes the discoverability gap. */}
      <div className="section">
        <div className="section-header">
          <span className="section-title">Attached rules not in registry</span>
          <div className="section-actions">
            <button className={"btn-small" + (discovering ? " is-busy" : "")} onClick={scanDiscoveredRules} disabled={discovering}>
              {discovering ? "Scanning…" : "Scan workflows"}
            </button>
            {discovered && discovered.length > 0 && (userRole === "editor" || userRole === "admin") && (
              <button className={"btn-small btn-edit" + (registeringDisc ? " is-busy" : "")} onClick={registerAllDiscovered} disabled={registeringDisc}>
                {registeringDisc ? "Registering…" : `Register all (${discovered.length})`}
              </button>
            )}
          </div>
        </div>
        <div className="card" style={{ padding: "14px 16px" }}>
          {discovered === null && (
            <p style={{ margin: 0, fontSize: "13px", color: "var(--text-secondary)" }}>
              CogniRunner rules can be attached to workflows outside this panel (REST automation, imported or copied workflows, or a rule whose registration didn't complete). They run on transitions but won't show under <strong>Configured Rules</strong> until claimed. Click <strong>Scan workflows</strong> to find them.
            </p>
          )}
          {discMeta && discMeta.error && (
            <p style={{ margin: 0, fontSize: "13px", color: "#dc2626", fontWeight: 600 }}>Scan failed: {discMeta.error}</p>
          )}
          {discovered && discMeta && !discMeta.error && (<>
            <p style={{ margin: "0 0 10px 0", fontSize: "13px", color: "var(--text-secondary)" }}>
              Scanned <strong>{discMeta.scannedWorkflows}</strong> workflow(s): <strong>{discMeta.totalCogniRules}</strong> CogniRunner rule(s) attached, <strong>{discMeta.registeredMatched}</strong> already registered, <strong style={{ color: discovered.length ? "#7c3aed" : "inherit" }}>{discovered.length}</strong> not registered{discMeta.truncated ? " — scan truncated (large instance)" : ""}.
            </p>
            {discovered.length === 0 ? (
              <p style={{ margin: 0, fontSize: "13px", color: "var(--text-secondary)" }}>Every attached rule is registered. ✓</p>
            ) : (
              <div style={{ maxHeight: "260px", overflowY: "auto", border: "1px solid var(--border-color, #e2e8f0)", borderRadius: "6px" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: "var(--text-secondary)" }}>
                      <th style={{ padding: "6px 10px" }}>Type</th>
                      <th style={{ padding: "6px 10px" }}>Workflow</th>
                      <th style={{ padding: "6px 10px" }}>Transition</th>
                      <th style={{ padding: "6px 10px" }}>Field</th>
                    </tr>
                  </thead>
                  <tbody>
                    {discovered.slice(0, 200).map((d, i) => (
                      <tr key={d.instanceId || i} style={{ borderTop: "1px solid var(--border-color, #e2e8f0)" }}>
                        <td style={{ padding: "6px 10px" }}>
                          <span style={{ background: "#7c3aed", color: "#fff", fontWeight: 600, fontSize: "11px", padding: "2px 8px", borderRadius: "10px", whiteSpace: "nowrap" }}>{d.type}</span>
                        </td>
                        <td style={{ padding: "6px 10px" }}>{d.workflowName}</td>
                        <td style={{ padding: "6px 10px" }}>{d.transitionName || d.transitionId || "—"}</td>
                        <td style={{ padding: "6px 10px" }}>{d.fieldId || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {discovered.length > 200 && (
                  <p style={{ margin: 0, padding: "6px 10px", fontSize: "12px", color: "var(--text-secondary)" }}>…and {discovered.length - 200} more.</p>
                )}
              </div>
            )}
          </>)}
        </div>
      </div>

      <div className="section">
        <div className="section-header">
          <span className="section-title">Configured Rules</span>
          <div className="section-actions">
            <input
              type="text"
              className="list-search"
              value={rulesSearch}
              onChange={(e) => setRulesSearch(e.target.value)}
              placeholder="Search rules…"
              aria-label="Search rules"
            />
            <div style={{ width: "160px" }}>
              <CustomSelect
                value={typeFilter}
                onChange={(v) => setTypeFilter(v)}
                options={[
                  { value: "all", label: "All Types" },
                  { value: "validator", label: "Validators" },
                  { value: "condition", label: "Conditions" },
                  { value: "postfunction", label: "Post Functions" },
                ]}
              />
            </div>
            {userScope === "all" && (
              <div style={{ width: "140px" }}>
                <CustomSelect
                  value={rulesFilter}
                  onChange={(v) => setRulesFilter(v)}
                  options={[
                    { value: "all", label: "All Rules" },
                    { value: "mine", label: "My Rules" },
                  ]}
                />
              </div>
            )}
            <button className={"btn-small" + (refreshingConfigs ? " is-busy" : "")} onClick={() => fetchConfigs(true)} disabled={refreshingConfigs}>
              Refresh
            </button>
            {(userRole === "editor" || userRole === "admin") && (
              <button className="btn-small btn-edit" onClick={() => setShowAddWizard(!showAddWizard)}>
                {showAddWizard ? "Cancel" : "+ Add Rule"}
              </button>
            )}
          </div>
        </div>

        {showAddWizard && (
          <AddRuleWizard
            invoke={invoke}
            onClose={() => setShowAddWizard(false)}
            onCreated={() => fetchConfigs(true)}
          />
        )}

        <div className="card veil-host">
          {/* Refresh/filter-change keeps the rows visible under a frosted veil —
              swapping in a fixed-height skeleton made the table collapse and
              re-expand on every refresh. Skeleton only when there is nothing
              to show underneath yet. */}
          {refreshingConfigs && configs.length > 0 && (
            <div className="veil">
              <span className="spin-ring" />
              <span className="veil-label">Refreshing rules…</span>
            </div>
          )}
          {(refreshingConfigs && configs.length === 0) ? (
            <div style={{ padding: "14px" }}>
              {[1, 2, 3].map((i) => (
                <div key={i} style={{ display: "flex", gap: "16px", alignItems: "center", padding: "10px 0", borderBottom: i < 3 ? "1px solid var(--border-color)" : "none" }}>
                  <div className="sk sk-text" style={{ width: 80, height: 16 }} />
                  <div className="sk sk-text" style={{ width: 140, height: 14 }} />
                  <div className="sk sk-text" style={{ width: 70, height: 14 }} />
                  <div className="sk sk-text" style={{ width: 160, height: 14, flex: 1 }} />
                  <div className="sk sk-text" style={{ width: 110, height: 12 }} />
                  <div style={{ display: "flex", gap: "6px" }}>
                    <div className="sk sk-block" style={{ width: 44, height: 28 }} />
                    <div className="sk sk-block" style={{ width: 56, height: 28 }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (() => {
            const typed = typeFilter === "all" ? configs
              : typeFilter === "postfunction" ? configs.filter((c) => c.type && c.type.startsWith("postfunction"))
              : configs.filter((c) => c.type === typeFilter);
            const rulesQuery = rulesSearch.trim().toLowerCase();
            const filtered = rulesQuery ? typed.filter((c) => ruleMatchesQuery(c, rulesQuery)) : typed;
            return filtered.length === 0 ? (
            <div className="empty-state">
              {configs.length === 0
                ? "No rules configured yet. Add one from a workflow transition."
                : rulesQuery
                  ? `No rules match “${rulesSearch.trim()}”.`
                  : `No ${typeFilter === "postfunction" ? "post functions" : typeFilter + "s"} found.`}
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Workflow / Transition</th>
                  <th>Field</th>
                  <th>Prompt</th>
                  <th>Updated</th>
                  <th></th>
                </tr>
              </thead>
              <tbody className="stagger">
                {filtered.map((config) => {
                  const wf = config.workflow || {};
                  const hasWorkflow = wf.workflowName || wf.workflowId;
                  // Fall back to this site's base URL (from context) when the rule's stored
                  // config has no siteUrl — e.g. discovered rules, which only need workflowId.
                  const ruleSiteUrl = wf.siteUrl || siteUrl;
                  const editUrl = wf.workflowId && ruleSiteUrl
                    ? `${ruleSiteUrl}/jira/settings/issues/workflows/${wf.workflowId}`
                    : null;
                  const isDisabled = config.disabled === true;
                  const ruleJobs = jobsByRule[config.id] || [];
                  const runningCount = ruleJobs.filter((j) => j.status === "running").length;
                  const queuedCount = ruleJobs.filter((j) => j.status === "queued").length;
                  const isExpanded = expandedRuleId === config.id;

                  return (
                    <React.Fragment key={config.id}>
                    <tr className={isDisabled ? "row-disabled" : ""}>
                      <td>
                        <button
                          className={"rule-expand-btn" + (isExpanded ? " open" : "")}
                          onClick={() => toggleRuleExpand(config.id)}
                          title={isExpanded ? "Hide execution history" : "Show execution history & jobs"}
                          aria-label="Toggle rule details"
                        >▶</button>
                        <span className={`type-badge ${config.type === "postfunction-static" ? "type-pf-static" : config.type?.startsWith("postfunction") ? "type-postfunction" : `type-${config.type}`}`}>
                          {config.type === "postfunction-semantic" ? "PF: Semantic"
                            : config.type === "postfunction-static" ? "PF: Static"
                            : config.type}
                        </span>
                        {config.ruleKind === "premade" && (
                          <span style={{ display: "inline-block", marginLeft: "6px", fontSize: "10px", fontWeight: 700, padding: "2px 7px", borderRadius: "10px", background: "#475569", color: "#fff" }}>Premade</span>
                        )}
                        {runningCount > 0 && <span className="rule-job-chip running">{runningCount} running</span>}
                        {queuedCount > 0 && <span className="rule-job-chip queued">{queuedCount} queued</span>}
                        {isDisabled && (
                          <span className="status-badge status-disabled">Disabled</span>
                        )}
                      </td>
                      <td>
                        {hasWorkflow ? (
                          <div className="workflow-info">
                            <div className="workflow-name">
                              {wf.workflowName || wf.workflowId}
                            </div>
                            {(wf.transitionFromName || wf.transitionToName) && (
                              <div className="transition-info">
                                {wf.transitionFromName || "Any"} &rarr; {wf.transitionToName || "Any"}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="no-workflow-info">
                            Re-save rule to capture workflow info
                          </span>
                        )}
                      </td>
                      <td>
                        {config.type && config.type.startsWith("postfunction")
                          ? <code className="field-id">{config.actionFieldId || config.fieldId || "—"}</code>
                          : <code className="field-id">{config.fieldId}</code>
                        }
                      </td>
                      <td>
                        <span className="prompt-text">
                          {config.ruleKind === "premade"
                            ? ((findPremadeRule("validator", config.premadeRuleType) || findPremadeRule("condition", config.premadeRuleType) || {}).label || config.premadeRuleType || "Premade rule")
                            : config.type && config.type.startsWith("postfunction")
                            ? (() => {
                                const text = config.conditionPrompt || config.actionPrompt || config.prompt || "";
                                return text.length > 80 ? text.substring(0, 80) + "..." : text;
                              })()
                            : config.prompt && config.prompt.length > 80
                              ? config.prompt.substring(0, 80) + "..."
                              : config.prompt}
                        </span>
                      </td>
                      <td><span className="timestamp">{formatTime(config.updatedAt)}</span></td>
                      <td>
                        <div className="row-actions">
                          {/* Explain is ungated (matches the resolver) so viewers can use it too. */}
                          <button
                            className={`btn-small rule-explain-btn${explain[config.id]?.status === "loading" ? " is-busy busy-solid" : ""}`}
                            onClick={() => toggleExplain(config)}
                            disabled={explain[config.id]?.status === "loading"}
                            title="Explain this rule in plain English"
                          >
                            ✦ Explain
                          </button>
                          {(userRole === "editor" || userRole === "admin") && (
                          <>
                            {editUrl && (
                              <button
                                className="btn-small btn-edit"
                                onClick={() => router && router.open(editUrl)}
                                title="Open workflow editor"
                              >
                                Edit
                              </button>
                            )}
                            <button
                              className={`btn-small ${isDisabled ? "btn-enable" : "btn-danger"}${toggling === config.id ? " is-busy" : ""}`}
                              onClick={() => toggleRule(config.id, isDisabled)}
                              disabled={toggling === config.id}
                              title={isDisabled ? "Re-enable rule in workflow" : "Disable rule in workflow"}
                            >
                              {isDisabled ? "Enable" : "Disable"}
                            </button>
                          </>
                          )}
                        </div>
                      </td>
                    </tr>
                    {explain[config.id]?.open && (
                      <tr className="rule-explain-row">
                        <td className="rule-explain-cell" colSpan={6}>
                          {explain[config.id].status === "done" ? (
                            <div className="rule-explain-card anim-rise">
                              <div className="rule-explain-eyebrow">§ IN PLAIN ENGLISH</div>
                              <div className="rule-explain-text">{explain[config.id].text}</div>
                            </div>
                          ) : explain[config.id].status === "degraded" ? (
                            <div className="rule-explain-note">
                              {explain[config.id].reason === "lmstudio"
                                ? "Plain-English explanations aren't available with the self-hosted LM Studio provider — switch to a hosted provider in Settings."
                                : explain[config.id].reason === "timeout"
                                ? "The AI provider didn't respond in time — try again in a moment."
                                : "Couldn't generate an explanation right now — try again in a moment."}
                            </div>
                          ) : explain[config.id].status === "error" ? (
                            <div className="rule-explain-note">Couldn't generate an explanation.</div>
                          ) : (
                            <div className="rule-explain-note">Generating…</div>
                          )}
                        </td>
                      </tr>
                    )}
                    {isExpanded && (
                      <tr className="rule-accordion-row">
                        <td className="rule-accordion-cell" colSpan={6}>
                          <div className="rule-accordion-inner anim-rise">
                            {ruleJobs.length > 0 && (
                              <>
                                <div className="rule-accordion-title">Active jobs for this rule</div>
                                <div className="jobs-list">{ruleJobs.map((j) => renderJobRow(j))}</div>
                              </>
                            )}
                            <div className="rule-accordion-title" style={{ marginTop: ruleJobs.length > 0 ? "14px" : 0 }}>Execution history</div>
                            {ruleLogsLoading && !ruleLogs[config.id] ? (
                              <div style={{ padding: "8px 0" }}>
                                <div className="sk sk-text" style={{ width: "80%", height: 12, marginBottom: 8 }} />
                                <div className="sk sk-block" style={{ width: "90%", height: 24 }} />
                              </div>
                            ) : (ruleLogs[config.id] && ruleLogs[config.id].length > 0) ? (
                              <div className="logs-list">{ruleLogs[config.id].map((log) => renderLogEntry(log))}</div>
                            ) : (
                              <div className="logs-empty-caption" style={{ padding: "6px 0" }}>No execution logs yet for this rule.</div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          ); })()}
        </div>
      </div>

      </>)}

      {/* Execution Logs Tab — global log stream + the Active Jobs panel (queued
          and ongoing async work) + the kill switch. Moved out of the Rules tab. */}
      {activeTab === "logs" && (<>
        {/* Active Jobs panel */}
        <div className="section">
          <div className="section-header">
            <span className="section-title">
              Active Jobs
              {(jobs.queued.length + jobs.running.length) > 0 && (
                <span className="job-count-chip">{jobs.queued.length + jobs.running.length}</span>
              )}
              <Tooltip text="Queued + running async AI jobs (LM Studio post-functions, code-gen, reviews). Validators & conditions run synchronously and never appear here. When a job finishes it drops to “Recently completed” under Execution Logs and clears automatically after ~20 minutes." />
            </span>
            <div className="section-actions">
              <button className={"btn-small" + (jobsLoading ? " is-busy" : "")} onClick={() => fetchJobs()} disabled={jobsLoading}>
                Refresh
              </button>
              {canKill && (jobs.queued.length + jobs.running.length) > 0 && (
                <button className={"btn-small btn-danger" + (killingAll ? " is-busy" : "")} onClick={cancelAllQueued} disabled={killingAll}>
                  Kill All
                </button>
              )}
            </div>
          </div>
          <div className="card veil-host anim-rise">
            {jobsLoading && (jobs.running.length + jobs.queued.length) > 0 && (
              <div className="veil"><span className="spin-ring" /><span className="veil-label">Refreshing jobs…</span></div>
            )}
            {(jobs.running.length + jobs.queued.length) === 0 ? (
              <div className="logs-empty">
                <div className="logs-empty-title">No active jobs</div>
                <div className="logs-empty-caption">Queued and running async AI jobs (LM Studio post-functions, code-gen, reviews) appear here while they run. Validators &amp; conditions run synchronously and don't queue; finished jobs move to “Recently completed” under Execution Logs.</div>
              </div>
            ) : (
              <div className="jobs-list stagger">
                {jobs.running.map((j) => renderJobRow(j))}
                {jobs.queued.map((j) => renderJobRow(j))}
              </div>
            )}
          </div>
        </div>

        {/* Execution Logs Section */}
        <div className="section">
          <div className="section-header">
            <span className="section-title">Execution Logs</span>
            <div className="section-actions">
              {showLogs && (
                <input
                  type="text"
                  className="list-search"
                  value={logsSearch}
                  onChange={(e) => { setLogsSearch(e.target.value); setLogsPage(0); }}
                  placeholder="Search logs…"
                  aria-label="Search execution logs"
                />
              )}
              <button
                className="btn-small"
                onClick={() => {
                  setShowLogs(!showLogs);
                  if (!showLogs) fetchLogs();
                }}
                disabled={logsLoading && !showLogs}
              >
                {showLogs ? "Hide Logs" : "Show Logs"}
              </button>
              {showLogs && logs.length > 0 && canKill && (
                <button className={"btn-small btn-danger" + (clearingLogs ? " is-busy" : "")} onClick={clearLogs} disabled={clearingLogs}>
                  Clear All
                </button>
              )}
              {showLogs && (
                <button className={"btn-small" + (logsLoading ? " is-busy" : "")} onClick={fetchLogs} disabled={logsLoading}>
                  Refresh
                </button>
              )}
            </div>
          </div>

          {jobs.recent.length > 0 && (
            <div className="card anim-rise" style={{ marginBottom: 10, padding: "10px 12px" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                Recently completed jobs
                <Tooltip text="Async jobs that have finished. They stay here for reference and clear automatically after ~20 minutes." />
              </div>
              <div className="jobs-list">{jobs.recent.map((j) => renderJobRow(j))}</div>
            </div>
          )}

          {showLogs && (
            <div className="card veil-host anim-rise">
              {logsLoading && logs.length > 0 && (
                <div className="veil">
                  <span className="spin-ring" />
                  <span className="veil-label">Refreshing logs…</span>
                </div>
              )}
              {(logsLoading && logs.length === 0) ? (
                <div style={{ padding: "14px" }}>
                  <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
                    <div className="sk sk-text" style={{ width: 40, height: 14 }} />
                    <div className="sk sk-text" style={{ width: 60, height: 14 }} />
                    <div className="sk sk-text" style={{ width: 120, height: 12 }} />
                  </div>
                  <div className="sk sk-text" style={{ width: "90%", height: 12, marginBottom: 8 }} />
                  <div className="sk sk-block" style={{ width: "95%", height: 28, marginBottom: 16 }} />
                </div>
              ) : logs.length === 0 ? (
                <div className="logs-empty">
                  <div className="logs-empty-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                      <rect x="8" y="2" width="8" height="4" rx="1" />
                      <polyline points="8 14 10 14 11 11.5 13 16.5 14 14 14" />
                    </svg>
                  </div>
                  <div className="logs-empty-title">No execution logs yet</div>
                  <div className="logs-empty-caption">Runs of your validators, conditions, and post functions will show up here.</div>
                </div>
              ) : filteredLogs.length === 0 ? (
                <div className="logs-empty">
                  <div className="logs-empty-title">No matching logs</div>
                  <div className="logs-empty-caption">No execution logs match “{logsSearch.trim()}”.</div>
                </div>
              ) : (
                <>
                  <div className="logs-list-paged stagger">
                    {filteredLogs.slice(logsPage * LOGS_PAGE_SIZE, (logsPage + 1) * LOGS_PAGE_SIZE).map((log) => renderLogEntry(log))}
                  </div>
                  {filteredLogs.length > LOGS_PAGE_SIZE && (
                    <div className="logs-pagination">
                      <button
                        className="btn-small"
                        onClick={() => setLogsPage((p) => Math.max(0, p - 1))}
                        disabled={logsPage === 0}
                      >
                        ‹ Prev
                      </button>
                      <span className="logs-pagination-info">
                        {logsPage * LOGS_PAGE_SIZE + 1}–{Math.min((logsPage + 1) * LOGS_PAGE_SIZE, filteredLogs.length)} of {filteredLogs.length}
                      </span>
                      <button
                        className="btn-small"
                        onClick={() => setLogsPage((p) => Math.min(totalLogPages - 1, p + 1))}
                        disabled={logsPage >= totalLogPages - 1}
                      >
                        Next ›
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </>)}

      {/* Documentation Tab */}
      {activeTab === "docs" && (
        <DocsTab invoke={invoke} isAdmin={isAdmin} accountId={accountId} />
      )}

      {/* Skills Tab */}
      {activeTab === "skills" && (
        <SkillsAdminTab invoke={invoke} isAdmin={isAdmin} accountId={accountId} />
      )}

      {/* Memories Tab */}
      {activeTab === "memories" && (
        <MemoriesAdminTab invoke={invoke} isAdmin={isAdmin} accountId={accountId} />
      )}

      {/* Permissions Tab (admin only) — app admin management */}
      {activeTab === "permissions" && isAdmin && (
        <PermissionsTab invoke={invoke} />
      )}

      {/* Settings Tab (admin only) — BYOK / OpenAI config */}
      {activeTab === "settings" && isAdmin && (
        <SettingsOpenAITab invoke={invoke} />
      )}
    </div>
  );
}

export default App;
