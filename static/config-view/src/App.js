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

import React, { useState, useEffect } from "react";

// Inject styles directly
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
      --code-bg: #f1f5f9;
      --success-color: #16a34a;
      --error-color: #dc2626;
      --border-color: #cbd5e1;
      --card-bg: #ffffff;
    }

    html[data-color-mode="dark"] {
      --bg-color: transparent;
      --text-color: #F5F5F7;
      --text-secondary: #A0A0B0;
      --text-muted: #71717a;
      --primary-color: #3b82f6;
      --code-bg: #0A0A0F;
      --success-color: #22c55e;
      --error-color: #ef4444;
      --border-color: #374151;
      --card-bg: #13131A;
    }

    *, *::before, *::after { box-sizing: border-box; }

    html, body {
      margin: 0;
      padding: 0;
      font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: var(--bg-color);
      color: var(--text-color);
      font-size: 13px;
      line-height: 1.4;
    }

    .container { padding: 8px 12px; }

    .empty {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--text-muted);
    }

    .config-item {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin-bottom: 6px;
    }

    .config-item:last-child { margin-bottom: 0; }

    .label {
      font-weight: 600;
      font-size: 12px;
      flex-shrink: 0;
      min-width: 50px;
      color: var(--text-secondary);
    }

    .value {
      padding: 2px 8px;
      border-radius: 3px;
      font-size: 12px;
      font-family: SFMono-Regular, Consolas, monospace;
      background-color: var(--code-bg);
      color: var(--primary-color);
    }

    .prompt-value {
      font-size: 12px;
      word-break: break-word;
      color: var(--text-color);
    }

    .loading-text {
      font-size: 12px;
      color: var(--text-muted);
    }

    .logs-section {
      margin-top: 16px;
      border-top: 1px solid var(--border-color);
      padding-top: 12px;
    }

    .logs-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }

    .logs-title {
      font-weight: 600;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-secondary);
    }

    .logs-actions {
      display: flex;
      gap: 8px;
    }

    .btn-small {
      padding: 4px 8px;
      font-size: 11px;
      border: 1px solid var(--border-color);
      border-radius: 3px;
      background: var(--card-bg);
      color: var(--text-color);
      cursor: pointer;
    }

    .btn-small:hover:not(:disabled) {
      background: var(--code-bg);
    }
    .btn-small:disabled { opacity: 0.6; cursor: default; }

    .logs-list {
      max-height: 300px;
      overflow-y: auto;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      background: var(--card-bg);
    }

    .log-entry {
      padding: 12px;
      border-bottom: 1px solid var(--border-color);
      font-size: 12px;
      transition: background-color 0.15s ease;
    }

    .log-entry:hover {
      background-color: var(--code-bg);
    }

    .log-entry:last-child {
      border-bottom: none;
    }

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

    .log-issue {
      font-family: SFMono-Regular, Consolas, monospace;
      font-size: 11px;
      font-weight: 600;
      color: var(--primary-color);
    }

    .log-details {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px 14px;
      margin-top: 4px;
      color: var(--text-secondary);
      font-size: 12px;
    }

    .log-details code {
      font-family: SFMono-Regular, Consolas, monospace;
      font-size: 11px;
      padding: 1px 5px;
      border-radius: 4px;
      background: var(--code-bg);
      color: var(--primary-color);
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

    .log-mode {
      font-size: 10px;
      color: var(--text-muted);
    }

    .log-docs-flag {
      font-size: 10px;
      font-weight: 600;
      color: var(--primary-color);
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

    .log-tools {
      margin-top: 6px;
      font-size: 10px;
      color: var(--text-muted);
    }

    /* Hue-coded solid type badges — shared hue map with the admin panel */
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

    .log-tools-badge {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.3px;
      background: var(--primary-color);
      color: #ffffff;
      margin-right: 6px;
    }

    html[data-color-mode="dark"] .log-tools-badge {
      background: var(--primary-color);
    }

    .log-queries {
      margin-top: 4px;
      padding: 6px 8px;
      background: var(--code-bg);
      border-radius: 8px;
      font-family: SFMono-Regular, Consolas, monospace;
      font-size: 10px;
      word-break: break-all;
      color: var(--text-secondary);
    }

    .log-recommendation {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      margin-top: 8px;
      padding: 8px 10px;
      border-radius: 8px;
      background: var(--card-bg);
      border: 2px solid var(--primary-color);
      box-shadow: 0 4px 12px -4px rgba(37, 99, 235, 0.35);
      font-size: 12px;
      line-height: 1.5;
      color: var(--text-color);
      white-space: pre-line;
    }

    .log-rec-icon { flex-shrink: 0; font-size: 13px; }

    .log-trace {
      margin-top: 8px;
    }

    .log-trace-toggle {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 10px;
      border: 1px solid var(--border-color);
      border-radius: 6px;
      background: var(--card-bg);
      color: var(--text-secondary);
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.3px;
      cursor: pointer;
      user-select: none;
      list-style: none;
    }
    .log-trace-toggle::-webkit-details-marker { display: none; }
    .log-trace-toggle::before {
      content: "\\25B8";
      font-size: 9px;
      line-height: 1;
      transition: transform 0.15s ease;
    }
    .log-trace[open] > .log-trace-toggle::before { transform: rotate(90deg); }
    .log-trace-toggle:hover {
      border-color: var(--primary-color);
      color: var(--text-color);
    }

    .log-trace-content {
      margin-top: 6px;
      padding: 8px 10px;
      background: var(--code-bg);
      border-radius: 8px;
      font-family: SFMono-Regular, Consolas, monospace;
      font-size: 11px;
      line-height: 1.6;
      max-height: 200px;
      overflow-y: auto;
    }

    .log-trace-line {
      color: var(--text-secondary);
      padding: 1px 0;
    }

    .log-trace-error {
      color: var(--error-color);
      font-weight: 600;
    }

    /* Designed empty state inside the logs list */
    .logs-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      padding: 28px 16px;
      text-align: center;
    }
    .logs-empty-icon {
      width: 36px;
      height: 36px;
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

    .no-logs {
      padding: 16px;
      text-align: center;
      color: var(--text-muted);
      font-size: 12px;
    }

    .license-banner {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 10px;
      border-radius: 4px;
      font-size: 11px;
      margin-bottom: 10px;
      border: 1px solid;
    }

    .license-active {
      background: var(--card-bg);
      border-color: var(--success-color);
      border-width: 2px;
      color: var(--success-color);
      box-shadow: 0 4px 12px -4px rgba(22, 163, 106, 0.35);
    }

    .license-inactive {
      background: var(--card-bg);
      border-color: var(--error-color);
      border-width: 2px;
      color: var(--error-color);
      box-shadow: 0 4px 12px -4px rgba(220, 38, 38, 0.35);
    }

    .rule-status-banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 8px 10px;
      border-radius: 4px;
      font-size: 11px;
      margin-bottom: 10px;
      border: 1px solid;
    }

    .status-disabled-banner {
      border-color: var(--error-color);
      border-width: 2px;
      background: var(--card-bg);
      color: var(--error-color);
      box-shadow: 0 4px 12px -4px rgba(220, 38, 38, 0.35);
    }

    .status-active-banner {
      border-color: var(--success-color);
      border-width: 2px;
      background: var(--card-bg);
      color: var(--success-color);
      box-shadow: 0 4px 12px -4px rgba(22, 163, 106, 0.35);
    }

    .rule-status-content {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .btn-enable {
      color: var(--success-color);
      border-color: var(--success-color);
      flex-shrink: 0;
    }

    .btn-enable:hover {
      background: var(--success-color);
      color: #ffffff;
    }

    .btn-danger {
      color: var(--error-color);
      border-color: var(--error-color);
      flex-shrink: 0;
    }

    .btn-danger:hover {
      background: var(--error-color);
      color: #ffffff;
    }

    .alert {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      padding: 8px 10px;
      border-radius: 4px;
      font-size: 11px;
      margin-bottom: 10px;
      border: 1px solid;
    }

    .alert-error {
      background: var(--card-bg);
      border-color: var(--error-color);
      border-width: 2px;
      color: var(--error-color);
      box-shadow: 0 4px 12px -4px rgba(220, 38, 38, 0.35);
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
      font-size: 14px;
      line-height: 1;
      padding: 0 2px;
      opacity: 0.7;
    }

    .alert-dismiss:hover { opacity: 1; }

    /* Generation provenance — what knowledge the AI used per step */
    .cv-gen-row {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      margin: 0 0 6px;
      padding-left: 12px;
    }

    .cv-gen-label {
      font-size: 10px;
      font-weight: 700;
      color: var(--text-muted);
      letter-spacing: 0.3px;
    }

    .cv-gen-chip {
      padding: 2px 10px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: 700;
      color: #ffffff;
      white-space: nowrap;
    }
    .cv-gen-docs { background: #2563eb; }
    .cv-gen-skill { background: #7c3aed; }
    .cv-gen-mem { background: #0d9488; }

    html[data-color-mode="dark"] .cv-gen-docs { background: #3b82f6; }
    html[data-color-mode="dark"] .cv-gen-skill { background: #8b5cf6; }
    html[data-color-mode="dark"] .cv-gen-mem { background: #14b8a6; }

    .sk {
      background: linear-gradient(90deg, #cbd5e1 25%, #f1f5f9 50%, #cbd5e1 75%);
      background-size: 200% 100%;
      animation: skShimmer 1.5s ease-in-out infinite;
      border-radius: 6px;
    }
    html[data-color-mode="dark"] .sk {
      background: linear-gradient(90deg, #1e1e2e 25%, #2a2a3a 50%, #1e1e2e 75%);
      background-size: 200% 100%;
    }
    @keyframes skShimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

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

    button:focus-visible, a:focus-visible, input:focus-visible, textarea:focus-visible,
    select:focus-visible, [tabindex]:focus-visible, .dropdown-trigger:focus-visible {
      outline: none; box-shadow: var(--lz-ring); border-radius: 6px;
    }

    .card {
      box-shadow: var(--lz-card-shadow);
      transition: box-shadow var(--dur-med) var(--lz-ease), border-color var(--dur-fast) ease;
    }
    .card:hover { box-shadow: var(--lz-card-shadow-hover); border-color: rgba(37, 99, 235, 0.35); }
    html[data-color-mode="dark"] .card:hover { border-color: rgba(96, 165, 250, 0.40); }

    .icon-wrapper {
      background: linear-gradient(135deg, #2563eb, #1d4ed8);
      color: #ffffff;
      box-shadow: 0 6px 18px -6px rgba(37, 99, 235, 0.55);
    }
    html[data-color-mode="dark"] .icon-wrapper {
      background: linear-gradient(135deg, #3b82f6, #2563eb);
      box-shadow: 0 0 20px rgba(59, 130, 246, 0.40);
    }

    .title { letter-spacing: -0.02em; font-weight: 700; }

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

    .tab-btn { transition: color var(--dur-fast) ease, border-color var(--dur-fast) ease, background var(--dur-fast) ease; }
    .tab-btn:hover:not(.tab-active) { background: var(--hover-bg); }

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

let invoke;

// Minimal DOM-based toast — config-view has no components/toast.js, so the
// helper lives here. Styling comes from the .mls-toast rules injected above.
const showToast = (message, kind) => {
  const el = document.createElement("div");
  el.className = "mls-toast" + (kind === "error" ? " mls-toast-error" : "");
  el.textContent = (kind === "error" ? "✕ " : "✓ ") + message;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add("mls-toast-leaving"), 2340);
  setTimeout(() => el.remove(), 2600);
};

function App() {
  const [config, setConfig] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [logsLoading, setLogsLoading] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [licenseActive, setLicenseActive] = useState(null);
  const [ruleDisabled, setRuleDisabled] = useState(null);
  const [ruleId, setRuleId] = useState(null);
  const [workflowContext, setWorkflowContext] = useState(null);
  const [toggling, setToggling] = useState(false);
  const [clearingLogs, setClearingLogs] = useState(false);
  const [logsLoadError, setLogsLoadError] = useState(false);
  // Entrance animation for the status banner: rises in on first resolve,
  // pops when handleToggleRule flips it (keyed remount re-triggers it).
  const [statusAnim, setStatusAnim] = useState("anim-rise");
  // True once getRuleStatus has completed (found or not) — keeps the banner
  // placeholder honest: it only shows while a check is genuinely in flight.
  const [statusChecked, setStatusChecked] = useState(false);

  const fetchLogs = async () => {
    if (!invoke) return;
    setLogsLoading(true);
    setLogsLoadError(false);
    try {
      const result = await invoke("getLogs");
      if (result.success) {
        let allLogs = result.logs || [];
        // Filter to only show logs for this specific rule
        if (config?.type?.includes("postfunction")) {
          // Post-function: match by type and action field
          const pfType = config.type;
          const actionField = config.actionFieldId || config.fieldId || "";
          allLogs = allLogs.filter((l) =>
            (l.type && l.type.includes("postfunction")) &&
            (l.fieldId === actionField || l.fieldId === "static-code" || pfType.includes("static"))
          );
        } else if (config?.fieldId) {
          // Validator/condition: match by field ID
          allLogs = allLogs.filter((l) => l.fieldId === config.fieldId && (!l.type || l.type === "validation"));
        }
        setLogs(allLogs);
      } else if (logs.length > 0) {
        // Refresh failed but entries are still on screen — keep them visible.
        showToast(result.error || "Couldn't refresh logs", "error");
      } else {
        setLogsLoadError(true);
      }
    } catch (e) {
      console.error("Failed to fetch logs:", e);
      if (logs.length > 0) showToast("Couldn't refresh logs", "error");
      else setLogsLoadError(true);
    }
    setLogsLoading(false);
  };

  const clearLogs = async () => {
    if (!invoke || clearingLogs) return;
    // The clearLogs resolver wipes execution logs globally, while this list
    // only shows the current rule's entries — warn before destroying data.
    if (!window.confirm("This clears execution logs for ALL rules on this site, not just this one. Continue?")) {
      return;
    }
    setClearingLogs(true);
    try {
      const result = await invoke("clearLogs");
      if (result?.success) {
        setLogs([]);
        showToast("Logs cleared");
      } else {
        showToast(result?.error || "Failed to clear logs", "error");
      }
    } catch (e) {
      console.error("Failed to clear logs:", e);
      showToast("Failed to clear logs", "error");
    }
    setClearingLogs(false);
  };

  const [toggleError, setToggleError] = useState(null);
  const [toggleWarning, setToggleWarning] = useState(null);

  const handleToggleRule = async () => {
    if (!invoke || !ruleId) return;
    setToggling(true);
    setToggleError(null);
    setToggleWarning(null);
    try {
      const isPF = config?.type?.includes("postfunction") || config?.conditionPrompt !== undefined;
      const action = ruleDisabled
        ? (isPF ? "enablePostFunction" : "enableRule")
        : (isPF ? "disablePostFunction" : "disableRule");
      const result = await invoke(action, { id: ruleId });
      if (result.success) {
        setStatusAnim("anim-pop");
        setRuleDisabled(result.disabled);
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
    setToggling(false);
  };

  const formatTime = (timestamp) => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleString();
    } catch {
      return timestamp;
    }
  };

  useEffect(() => {
    injectStyles();

    const init = async () => {
      try {
        const bridge = await import("@forge/bridge");
        invoke = bridge.invoke;

        // Enable theming for dark mode support
        if (bridge.view && bridge.view.theme && bridge.view.theme.enable) {
          await bridge.view.theme.enable();
        }

        const context = await bridge.view.getContext();
        console.log("config-view context:", JSON.stringify(context, null, 2));

        // Try all possible locations for the config per module type
        const possibleConfig =
          context?.extension?.postFunctionConfig ||
          context?.extension?.validatorConfig ||
          context?.extension?.conditionConfig ||
          context?.extension?.configuration ||
          context?.extension?.config;

        if (possibleConfig) {
          // Config is stored as JSON string, parse it
          if (typeof possibleConfig === "string") {
            try {
              setConfig(JSON.parse(possibleConfig));
            } catch {
              // Fallback if not valid JSON
            }
          } else {
            setConfig(possibleConfig);
          }
        }

        // Derive rule ID and workflow context (same pattern as config-ui)
        const ext = context?.extension || {};
        const derivedRuleId = ext.entryPoint || ext.key || null;
        if (derivedRuleId) {
          setRuleId(derivedRuleId);
        }

        // Capture workflow context for API lookups
        const wfCtx = {};
        if (ext.workflowId) wfCtx.workflowId = ext.workflowId;
        if (ext.workflowName) wfCtx.workflowName = ext.workflowName;
        if (ext.scopedProjectId) wfCtx.projectId = ext.scopedProjectId;
        if (ext.transitionContext) {
          wfCtx.transitionId = ext.transitionContext.id;
          wfCtx.transitionFromName = ext.transitionContext.from?.name;
          wfCtx.transitionToName = ext.transitionContext.to?.name;
        }
        if (context?.siteUrl) wfCtx.siteUrl = context.siteUrl;
        if (Object.keys(wfCtx).length > 0) {
          setWorkflowContext(wfCtx);
        }

        // Check license status from context
        const licenseStatus = context?.license?.active;
        if (licenseStatus !== undefined) {
          setLicenseActive(licenseStatus);
        }
      } catch (e) {
        console.log("Could not load config:", e);
      }

      // Also check license via resolver (more reliable for paid apps)
      try {
        const licenseResult = await invoke("checkLicense");
        if (licenseResult?.isActive !== undefined) {
          setLicenseActive(licenseResult.isActive);
        }
      } catch (e) {
        console.log("Could not check license:", e);
      }

      setLoading(false);
    };
    init();
  }, []);

  // Check rule disabled status using all available identifiers
  useEffect(() => {
    if (!invoke) return;
    // Need at least one identifier to look up
    if (!ruleId && !config?.fieldId) return;
    // The setRuleId(result.registryId) call below re-fires this effect with
    // the resolved id — skip the redundant second fetch once we have both.
    if (ruleDisabled !== null && ruleId) return;
    const checkStatus = async () => {
      try {
        const result = await invoke("getRuleStatus", {
          // The embedded config.id is the registry row's exact id (required for
          // instanced ::i-… ids, which the backend's context tier can't
          // reconstruct); ext.entryPoint gives "view", which tier-1 skips.
          id: config?.id || ruleId,
          fieldId: config?.fieldId,
          prompt: config?.prompt,
          conditionPrompt: config?.conditionPrompt,
          actionPrompt: config?.actionPrompt,
          type: config?.type,
          workflow: workflowContext,
        });
        if (result.found) {
          setRuleDisabled(result.disabled);
          // Always use the registryId from KVS — ext.entryPoint gives "view" which
          // doesn't match the actual KVS config id (registered by config-ui)
          if (result.registryId) {
            setRuleId(result.registryId);
          }
        }
      } catch (e) {
        console.log("Could not check rule status:", e);
      }
      setStatusChecked(true);
    };
    checkStatus();
  }, [ruleId, config, workflowContext]);

  if (loading) {
    // Approximate the final layout: status banner, config card, two text rows.
    return (
      <div className="container">
        <div className="sk" style={{ height: "38px", marginBottom: "10px" }} />
        <div className="sk" style={{ height: "120px", marginBottom: "12px" }} />
        <div className="sk" style={{ width: "60%", height: "12px", marginBottom: "8px" }} />
        <div className="sk" style={{ width: "40%", height: "12px" }} />
      </div>
    );
  }

  const statusBanner = ruleDisabled === true ? (
    <div key="status-disabled" className={`rule-status-banner status-disabled-banner ${statusAnim}`}>
      <div className="rule-status-content">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
        </svg>
        <span>This rule is <strong>disabled</strong>. It will not run on transitions.</span>
      </div>
      <button
        className={`btn-small btn-enable${toggling ? " is-busy" : ""}`}
        onClick={handleToggleRule}
        disabled={toggling}
      >
        Enable
      </button>
    </div>
  ) : ruleDisabled === false ? (
    <div key="status-active" className={`rule-status-banner status-active-banner ${statusAnim}`}>
      <div className="rule-status-content">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M20 6L9 17l-5-5" />
        </svg>
        <span>This rule is <strong>active</strong>.</span>
      </div>
      <button
        className={`btn-small btn-danger${toggling ? " is-busy" : ""}`}
        onClick={handleToggleRule}
        disabled={toggling}
      >
        Disable
      </button>
    </div>
  ) : config && !statusChecked && (ruleId || config.fieldId) ? (
    // Status check in flight — hold the banner's slot to avoid layout shift.
    <div className="sk" style={{ height: "38px", marginBottom: "10px" }} />
  ) : null;

  const licenseBanner = licenseActive === false ? (
    <div className="license-banner license-inactive anim-rise">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <span>License inactive — AI validation is disabled. Transitions will pass through without checks.</span>
    </div>
  ) : licenseActive === true ? (
    <div className="license-banner license-active anim-rise">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M20 6L9 17l-5-5" />
      </svg>
      <span>License active</span>
    </div>
  ) : null;

  const toggleAlerts = (
    <>
      {toggleError && (
        <div className="alert alert-error anim-rise">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>{toggleError}</span>
          <button className="alert-dismiss" onClick={() => setToggleError(null)}>&times;</button>
        </div>
      )}
      {toggleWarning && (
        <div className="alert alert-warning anim-rise">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span>{toggleWarning}</span>
          <button className="alert-dismiss" onClick={() => setToggleWarning(null)}>&times;</button>
        </div>
      )}
    </>
  );

  // First-load placeholder shared by both logs branches (mirrors two entries).
  const logsSkeleton = (
    <div style={{ padding: "12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
        <div className="sk" style={{ width: "40px", height: "14px" }} />
        <div className="sk" style={{ width: "60px", height: "14px" }} />
        <div className="sk" style={{ width: "120px", height: "12px" }} />
      </div>
      <div className="sk" style={{ width: "80%", height: "12px", marginBottom: "8px" }} />
      <div className="sk" style={{ width: "95%", height: "32px", marginBottom: "16px" }} />
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
        <div className="sk" style={{ width: "40px", height: "14px" }} />
        <div className="sk" style={{ width: "60px", height: "14px" }} />
        <div className="sk" style={{ width: "100px", height: "12px" }} />
      </div>
      <div className="sk" style={{ width: "70%", height: "12px", marginBottom: "8px" }} />
      <div className="sk" style={{ width: "85%", height: "32px" }} />
    </div>
  );

  // Failed mount-load of the logs list — never masquerade as "no logs yet".
  const logsLoadErrorBlock = (
    <div className="load-error">
      <span>Couldn't load logs.</span>
      <button className="btn-retry" onClick={fetchLogs}>Retry</button>
    </div>
  );

  // Frosted overlay while refreshing with entries still on screen.
  const logsRefreshVeil = logsLoading && logs.length > 0 ? (
    <div className="veil">
      <span className="spin-ring" />
      <span className="veil-label">Refreshing…</span>
    </div>
  ) : null;

  // Offloaded static rules carry a slim config — step names live in functionsMeta.
  const staticSteps = (config?.functions?.length ? config.functions : config?.functionsMeta) || [];

  // Check if config has any meaningful data (validator/condition OR post-function)
  const hasConfig = config && (
    config.fieldId || config.prompt ||
    config.conditionPrompt || config.actionPrompt ||
    config.type?.includes("postfunction") ||
    (config.functions && config.functions.length > 0)
  );

  if (!hasConfig) {
    return (
      <div className="container">
        {licenseBanner}
        {statusBanner}
        {toggleAlerts}
        <div className="empty">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>No configuration set</span>
        </div>

        {/* Still show logs section even without config */}
        <div className="logs-section">
          <div className="logs-header">
            <span className="logs-title">{config?.type?.includes("postfunction") ? "Execution Logs" : "Validation Logs"}</span>
            <div className="logs-actions">
              <button
                className="btn-small"
                onClick={() => {
                  setShowLogs(!showLogs);
                  if (!showLogs) fetchLogs();
                }}
              >
                {showLogs ? "Hide Logs" : "Show Logs"}
              </button>
              {showLogs && logs.length > 0 && (
                <button
                  className={`btn-small${clearingLogs ? " is-busy" : ""}`}
                  onClick={clearLogs}
                  disabled={clearingLogs}
                >
                  Clear
                </button>
              )}
              {showLogs && (
                <button
                  className={`btn-small${logsLoading ? " is-busy" : ""}`}
                  onClick={fetchLogs}
                  disabled={logsLoading}
                >
                  Refresh
                </button>
              )}
            </div>
          </div>

          {showLogs && (
            <div className="veil-host anim-rise">
              {logsRefreshVeil}
              <div className="logs-list stagger">
              {logsLoading && logs.length === 0 ? (
                logsSkeleton
              ) : logsLoadError && logs.length === 0 ? (
                logsLoadErrorBlock
              ) : logs.length === 0 ? (
                <div className="logs-empty">
                  <div className="logs-empty-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                      <rect x="8" y="2" width="8" height="4" rx="1" />
                      <polyline points="8 14 10 14 11 11.5 13 16.5 14 14 16 14" />
                    </svg>
                  </div>
                  <div className="logs-empty-title">No validation logs yet</div>
                  <div className="logs-empty-caption">Entries appear after this rule runs on a transition.</div>
                </div>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className="log-entry">
                    <div className="log-header">
                      <span
                        className={`log-status ${log.isValid ? "valid" : "invalid"}`}
                      >
                        {log.isValid ? "PASS" : "FAIL"}
                      </span>
                      <span className="log-issue">{log.issueKey}</span>
                      <span className="log-meta">
                        <span className="log-time">
                          {formatTime(log.timestamp)}
                        </span>
                      </span>
                    </div>
                    <div className="log-details">
                      <span className="log-kv">
                        <span className="log-kv-label">Field</span>
                        <code>{log.fieldId}</code>
                      </span>
                    </div>
                    {log.reason && (
                      <>
                        <div className="log-section-label">AI reason</div>
                        <div className="log-reason">{log.reason}</div>
                      </>
                    )}
                    {log.toolMeta?.toolsUsed && (
                      <div className="log-tools">
                        <span className="log-tools-badge">JQL</span>
                        {log.toolMeta.toolRounds} round{log.toolMeta.toolRounds !== 1 ? "s" : ""}, {log.toolMeta.totalResults} result{log.toolMeta.totalResults !== 1 ? "s" : ""}
                        {log.toolMeta.queries?.length > 0 && (
                          <div className="log-queries">
                            {log.toolMeta.queries.map((q, i) => <div key={i}>{q}</div>)}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      {licenseBanner}
      {statusBanner}
      {toggleAlerts}

      {/* Post-function: Semantic */}
      {config.type === "postfunction-semantic" && (
        <>
          <div className="config-item">
            <span className="label">Type:</span>
            <span className="prompt-value">Semantic Post Function</span>
          </div>
          {config.conditionPrompt && (
            <div className="config-item">
              <span className="label">Condition:</span>
              <span className="prompt-value">{config.conditionPrompt}</span>
            </div>
          )}
          {config.actionPrompt && (
            <div className="config-item">
              <span className="label">Action:</span>
              <span className="prompt-value">{config.actionPrompt}</span>
            </div>
          )}
          {config.actionFieldId && (
            <div className="config-item">
              <span className="label">Target:</span>
              <code className="value">{config.actionFieldId}</code>
            </div>
          )}
        </>
      )}

      {/* Post-function: Static */}
      {config.type === "postfunction-static" && (
        <>
          <div className="config-item">
            <span className="label">Type:</span>
            <span className="prompt-value">Static Post Function</span>
          </div>
          <div className="config-item">
            <span className="label">Steps:</span>
            <span className="prompt-value">{staticSteps.length} function block{staticSteps.length !== 1 ? "s" : ""}</span>
          </div>
          {staticSteps.map((fn, i) => {
            // Provenance only exists on full configs saved after the
            // knowledge upgrade; offloaded (codeRef) configs carry slim
            // functionsMeta without it — render nothing in that case.
            const meta = fn.generationMeta;
            const hasProvenance = !!meta && (
              meta.appliedDocs?.length > 0 ||
              meta.appliedSkills?.length > 0 ||
              meta.appliedMemories > 0
            );
            return (
              <React.Fragment key={i}>
                <div className="config-item" style={{ paddingLeft: "12px" }}>
                  <span className="label">#{i + 1}:</span>
                  <span className="prompt-value">
                    {fn.name || fn.operationPrompt?.substring(0, 80) || "(no description)"}
                  </span>
                </div>
                {hasProvenance && (
                  <div className="cv-gen-row">
                    <span className="cv-gen-label">GENERATED WITH</span>
                    {meta.appliedDocs?.length > 0 && (
                      <span className="cv-gen-chip cv-gen-docs">
                        {meta.appliedDocs.length} doc{meta.appliedDocs.length > 1 ? "s" : ""}
                      </span>
                    )}
                    {(meta.appliedSkills || []).map((s) => (
                      <span key={s.id || s.name} className="cv-gen-chip cv-gen-skill">
                        {s.auto ? "✨ " : ""}{s.name}
                      </span>
                    ))}
                    {meta.appliedMemories > 0 && (
                      <span className="cv-gen-chip cv-gen-mem">
                        {meta.appliedMemories} memor{meta.appliedMemories > 1 ? "ies" : "y"}
                      </span>
                    )}
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </>
      )}

      {/* Validator / Condition (original) */}
      {!config.type?.includes("postfunction") && (
        <>
          {config.fieldId && (
            <div className="config-item">
              <span className="label">Field:</span>
              <code className="value">{config.fieldId}</code>
            </div>
          )}
          {config.prompt && (
            <div className="config-item">
              <span className="label">Prompt:</span>
              <span className="prompt-value">
                {config.prompt.length > 100
                  ? config.prompt.substring(0, 100) + "..."
                  : config.prompt}
              </span>
            </div>
          )}
          {config.enableTools === true && (
            <div className="config-item">
              <span className="label">Tools:</span>
              <span className="prompt-value">JQL Search (always enabled)</span>
            </div>
          )}
          {config.enableTools === false && (
            <div className="config-item">
              <span className="label">Tools:</span>
              <span className="prompt-value">Disabled</span>
            </div>
          )}
        </>
      )}

      {/* Logs section */}
      <div className="logs-section">
        <div className="logs-header">
          <span className="logs-title">{config?.type?.includes("postfunction") ? "Execution Logs" : "Validation Logs"}</span>
          <div className="logs-actions">
            <button
              className="btn-small"
              onClick={() => {
                setShowLogs(!showLogs);
                if (!showLogs) fetchLogs();
              }}
            >
              {showLogs ? "Hide Logs" : "Show Logs"}
            </button>
            {showLogs && logs.length > 0 && (
              <button
                className={`btn-small${clearingLogs ? " is-busy" : ""}`}
                onClick={clearLogs}
                disabled={clearingLogs}
              >
                Clear
              </button>
            )}
            {showLogs && (
              <button
                className={`btn-small${logsLoading ? " is-busy" : ""}`}
                onClick={fetchLogs}
                disabled={logsLoading}
              >
                Refresh
              </button>
            )}
          </div>
        </div>

        {showLogs && (
          <div className="veil-host anim-rise">
            {logsRefreshVeil}
            <div className="logs-list stagger">
            {logsLoading && logs.length === 0 ? (
              logsSkeleton
            ) : logsLoadError && logs.length === 0 ? (
              logsLoadErrorBlock
            ) : logs.length === 0 ? (
              <div className="logs-empty">
                <div className="logs-empty-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                    <rect x="8" y="2" width="8" height="4" rx="1" />
                    <polyline points="8 14 10 14 11 11.5 13 16.5 14 14 16 14" />
                  </svg>
                </div>
                <div className="logs-empty-title">No validation logs yet</div>
                <div className="logs-empty-caption">Entries appear after this rule runs on a transition.</div>
              </div>
            ) : (
              logs.map((log) => (
                <div key={log.id} className="log-entry">
                  <div className="log-header">
                    <span className={`log-status ${log.isValid ? "valid" : "invalid"}`}>
                      {log.type === "postfunction-semantic" ? (log.isValid ? "OK" : "ERR")
                        : log.type === "postfunction-static" ? (log.isValid ? "OK" : "ERR")
                        : (log.isValid ? "PASS" : "FAIL")}
                    </span>
                    {log.type && log.type !== "validation" && (
                      <span className={`log-type-badge ${
                        log.type === "postfunction-semantic" ? "lt-pf-semantic"
                          : log.type === "postfunction-static" ? "lt-pf-static"
                          : log.type === "condition" ? "lt-condition"
                          : "lt-validator"
                      }`}>{log.type.replace("postfunction-", "PF: ")}</span>
                    )}
                    <span className="log-issue">{log.issueKey}</span>
                    <span className="log-meta">
                      {log.executionTimeMs ? (
                        <span className="log-ms">{log.executionTimeMs}ms</span>
                      ) : null}
                      <span className="log-time">{formatTime(log.timestamp)}</span>
                    </span>
                  </div>
                  {log.fieldId && log.fieldId !== "static-code" && (
                    <div className="log-details">
                      <span className="log-kv">
                        <span className="log-kv-label">Field</span>
                        <code>{log.fieldId}</code>
                      </span>
                      {log.mode && <span className="log-mode">({log.mode})</span>}
                      {log.docsUsed && <span className="log-docs-flag">+ docs</span>}
                    </div>
                  )}
                  {log.decision && (
                    <div className="log-details">
                      <span className="log-kv">
                        <span className="log-kv-label">Decision</span>
                        <strong>{log.decision}</strong>
                      </span>
                      {log.changes !== undefined && <span>{log.changes} change{log.changes !== 1 ? "s" : ""}</span>}
                      {log.steps && <span>{log.steps} step{log.steps !== 1 ? "s" : ""}</span>}
                    </div>
                  )}
                  {log.workflowName && (
                    <div className="log-details">
                      <span className="log-kv">
                        <span className="log-kv-label">Transition</span>
                        <span>{log.workflowName}{log.transitionName ? ` (${log.transitionName})` : ""}</span>
                      </span>
                    </div>
                  )}
                  {log.reason && (
                    <>
                      <div className="log-section-label">AI reason</div>
                      <div className="log-reason">{log.reason}</div>
                    </>
                  )}
                  {log.toolMeta?.toolsUsed && (
                    <div className="log-tools">
                      <span className="log-tools-badge">JQL</span>
                      {log.toolMeta.toolRounds} round{log.toolMeta.toolRounds !== 1 ? "s" : ""}, {log.toolMeta.totalResults} result{log.toolMeta.totalResults !== 1 ? "s" : ""}
                      {log.toolMeta.queries?.length > 0 && (
                        <div className="log-queries">
                          {log.toolMeta.queries.map((q, i) => <div key={i}>{q}</div>)}
                        </div>
                      )}
                    </div>
                  )}
                  {log.recommendation && (
                    <div className="log-recommendation">
                      <span className="log-rec-icon">💡</span>
                      <span>{log.recommendation}</span>
                    </div>
                  )}
                  {log.trace && Array.isArray(log.trace) && log.trace.length > 0 && (
                    <details className="log-trace">
                      <summary className="log-trace-toggle">Execution trace ({log.trace.length} entries)</summary>
                      <div className="log-trace-content anim-fade">
                        {log.trace.map((t, i) => (
                          <div key={i} className={`log-trace-line ${t.startsWith && t.startsWith("ERROR") ? "log-trace-error" : ""}`}>
                            {t}
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                  {log.aiTimeMs && (
                    <div className="log-foot">
                      AI: {log.aiTimeMs}ms{log.tokens ? ` · ${log.tokens} tokens` : ""}{log.docCount ? ` · ${log.docCount} doc(s)` : ""}
                    </div>
                  )}
                </div>
              ))
            )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
