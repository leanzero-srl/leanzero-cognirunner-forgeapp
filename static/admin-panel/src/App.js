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
import TabBar from "./components/TabBar";
import DocsTab from "./components/DocsTab";
import PermissionsTab from "./components/PermissionsTab";
import SettingsOpenAITab from "./components/SettingsOpenAITab";
import CustomSelect from "./components/CustomSelect";
import AddRuleWizard from "./components/AddRuleWizard";

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
    }

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

    .type-validator {
      background: rgba(37, 99, 235, 0.1);
      color: var(--primary-color);
    }

    .type-condition {
      background: rgba(22, 163, 106, 0.1);
      color: var(--success-color);
    }

    .type-postfunction {
      background: rgba(168, 85, 247, 0.1);
      color: #a855f7;
    }
    html[data-color-mode="dark"] .type-postfunction {
      background: rgba(168, 85, 247, 0.15);
      color: #c084fc;
    }

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
      padding: 8px 14px;
      border-bottom: 1px solid var(--border-color);
      font-size: 12px;
    }

    .log-entry:last-child { border-bottom: none; }

    .log-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
    }

    .log-status {
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
    }

    .log-status.valid {
      background: rgba(22, 163, 106, 0.1);
      color: var(--success-color);
    }

    .log-status.invalid {
      background: rgba(220, 38, 38, 0.1);
      color: var(--error-color);
    }

    .log-time {
      color: var(--text-muted);
      font-size: 10px;
    }

    .log-issue {
      font-weight: 600;
      color: var(--primary-color);
    }

    .log-details { color: var(--text-secondary); }

    .log-reason {
      margin-top: 4px;
      padding: 4px 8px;
      background: var(--code-bg);
      border-radius: 3px;
      color: var(--text-color);
    }

    .logs-list {
      max-height: 400px;
      overflow-y: auto;
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
      padding: 10px 14px;
      border-radius: 8px;
      background: #0f172a;
      color: #e2e8f0;
      font-size: 12px;
      font-weight: 400;
      font-style: normal;
      line-height: 1.5;
      letter-spacing: normal;
      text-transform: none;
      white-space: normal;
      width: 320px;
      max-width: calc(100vw - 32px);
      pointer-events: none;
      box-shadow: 0 8px 24px rgba(0,0,0,0.25), 0 0 0 1px rgba(255,255,255,0.06);
      animation: tooltipFadeIn 0.15s ease;
    }
    html[data-color-mode="dark"] .tooltip-portal {
      background: #1e293b;
      color: #e2e8f0;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08);
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
    .wiz-test-pass { border: 1px solid var(--success-color); background: rgba(22,163,106,0.06); }
    .wiz-test-fail { border: 1px solid var(--error-color); background: rgba(220,38,38,0.06); }
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
      padding: 10px 14px;
      border-radius: 8px;
      background: #0f172a;
      color: #e2e8f0;
      font-size: 12px;
      font-weight: 400;
      font-style: normal;
      line-height: 1.5;
      letter-spacing: normal;
      text-transform: none;
      white-space: normal;
      width: 280px;
      max-width: calc(100vw - 32px);
      pointer-events: none;
      box-shadow: 0 8px 24px rgba(0,0,0,0.25), 0 0 0 1px rgba(255,255,255,0.06);
      animation: tooltipFadeIn 0.15s ease;
    }

    html[data-color-mode="dark"] .tooltip-portal {
      background: #1e293b;
      color: #e2e8f0;
      box-shadow: 0 8px 24px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08);
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
  `;
  document.head.appendChild(style);
};


let invoke;
let router;

const TABS = [
  { key: "rules", label: "Rules" },
  { key: "docs", label: "Documentation" },
  { key: "permissions", label: "Permissions", adminOnly: true },
  { key: "settings", label: "Settings", adminOnly: true },
];

function App() {
  const [configs, setConfigs] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [logsLoading, setLogsLoading] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [licenseActive, setLicenseActive] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userRole, setUserRole] = useState(null); // "viewer" | "editor" | "admin" | null
  const [userScope, setUserScope] = useState(null); // "own" | "all" | null
  const [accountId, setAccountId] = useState(null);
  const [activeTab, setActiveTab] = useState("rules");
  const [rulesFilter, setRulesFilter] = useState("all");
  const [showAddWizard, setShowAddWizard] = useState(false);
  const [typeFilter, setTypeFilter] = useState("all");

  const fetchConfigs = async (showLoading = false, filterOverride) => {
    if (!invoke) return;
    if (showLoading) setRefreshingConfigs(true);
    try {
      const result = await invoke("getConfigs", { filter: filterOverride || rulesFilter });
      if (result.success) {
        setConfigs(result.configs || []);
        if (result.removedCount > 0) {
          setRemovedCount(result.removedCount);
        }
      }
    } catch (e) {
      console.error("Failed to fetch configs:", e);
    }
    if (showLoading) setRefreshingConfigs(false);
  };

  const fetchLogs = async () => {
    if (!invoke) return;
    setLogsLoading(true);
    try {
      const result = await invoke("getLogs");
      if (result.success) {
        setLogs(result.logs || []);
      }
    } catch (e) {
      console.error("Failed to fetch logs:", e);
    }
    setLogsLoading(false);
  };

  const clearLogs = async () => {
    if (!invoke) return;
    setClearingLogs(true);
    try {
      await invoke("clearLogs");
      setLogs([]);
    } catch (e) {
      console.error("Failed to clear logs:", e);
    }
    setClearingLogs(false);
  };

  const [removedCount, setRemovedCount] = useState(0);
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
    };
    init();
  }, []);

  // Re-fetch configs when filter changes
  useEffect(() => {
    if (!loading && invoke) fetchConfigs();
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

      <TabBar tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab} isAdmin={isAdmin} />

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
      <div className="section">
        <div className="section-header">
          <span className="section-title">Configured Rules</span>
          <div className="section-actions">
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
            <button className="btn-small" onClick={() => fetchConfigs(true)} disabled={refreshingConfigs}>
              {refreshingConfigs ? "Refreshing..." : "Refresh"}
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

        <div className="card">
          {refreshingConfigs ? (
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
            const filtered = typeFilter === "all" ? configs
              : typeFilter === "postfunction" ? configs.filter((c) => c.type && c.type.startsWith("postfunction"))
              : configs.filter((c) => c.type === typeFilter);
            return filtered.length === 0 ? (
            <div className="empty-state">
              {configs.length === 0
                ? "No rules configured yet. Add one from a workflow transition."
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
              <tbody>
                {filtered.map((config) => {
                  const wf = config.workflow || {};
                  const hasWorkflow = wf.workflowName || wf.workflowId;
                  const editUrl = wf.workflowId && wf.siteUrl
                    ? `${wf.siteUrl}/jira/settings/issues/workflows/${wf.workflowId}`
                    : null;
                  const isDisabled = config.disabled === true;

                  return (
                    <tr key={config.id} className={isDisabled ? "row-disabled" : ""}>
                      <td>
                        <span className={`type-badge type-${config.type?.startsWith("postfunction") ? "postfunction" : config.type}`}>
                          {config.type === "postfunction-semantic" ? "PF: Semantic"
                            : config.type === "postfunction-static" ? "PF: Static"
                            : config.type}
                        </span>
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
                          {config.type && config.type.startsWith("postfunction")
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
                        {(userRole === "editor" || userRole === "admin") && (
                        <div className="row-actions">
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
                            className={`btn-small ${isDisabled ? "btn-enable" : "btn-danger"}`}
                            onClick={() => toggleRule(config.id, isDisabled)}
                            disabled={toggling === config.id}
                            title={isDisabled ? "Re-enable rule in workflow" : "Disable rule in workflow"}
                          >
                            {toggling === config.id
                              ? (isDisabled ? "Enabling..." : "Disabling...")
                              : (isDisabled ? "Enable" : "Disable")}
                          </button>
                        </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ); })()}
        </div>
      </div>

      {/* Execution Logs Section */}
      <div className="section">
        <div className="section-header">
          <span className="section-title">Execution Logs</span>
          <div className="section-actions">
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
              <button className="btn-small btn-danger" onClick={clearLogs} disabled={clearingLogs}>
                {clearingLogs ? "Clearing..." : "Clear All"}
              </button>
            )}
            {showLogs && (
              <button className="btn-small" onClick={fetchLogs} disabled={logsLoading}>
                {logsLoading ? "Refreshing..." : "Refresh"}
              </button>
            )}
          </div>
        </div>

        {showLogs && (
          <div className="card">
            {logsLoading ? (
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
              <div className="empty-state">No execution logs yet</div>
            ) : (
              <div className="logs-list">
                {logs.map((log) => {
                  const logType = log.type || "validation";
                  const typeBadge = logType.includes("postfunction-semantic") ? "PF: Semantic"
                    : logType.includes("postfunction-static") ? "PF: Static"
                    : logType.includes("postfunction") ? "Post Function"
                    : logType === "condition" ? "Condition"
                    : "Validator";
                  const typeBadgeClass = logType.includes("postfunction") ? "type-postfunction"
                    : logType === "condition" ? "type-condition"
                    : "type-validator";
                  const editUrl = log.ruleWorkflow?.workflowId && log.ruleWorkflow?.siteUrl
                    ? `${log.ruleWorkflow.siteUrl}/jira/settings/issues/workflows/${log.ruleWorkflow.workflowId}`
                    : null;

                  return (
                    <div key={log.id} className="log-entry">
                      <div className="log-header">
                        <span className={`log-status ${log.isValid ? "valid" : "invalid"}`}>
                          {log.isValid ? "PASS" : (log.decision === "SKIP" ? "SKIP" : "ERR")}
                        </span>
                        <span className={`type-badge ${typeBadgeClass}`} style={{ fontSize: "9px" }}>{typeBadge}</span>
                        <span className="log-issue">{log.issueKey}</span>
                        <span className="log-time">
                          {formatTime(log.timestamp)}
                          {log.executionTimeMs ? ` · ${log.executionTimeMs}ms` : ""}
                        </span>
                        {(userRole === "editor" || userRole === "admin") && editUrl && (
                          <button
                            className="btn-small btn-edit"
                            style={{ fontSize: "10px", padding: "2px 6px", marginLeft: "auto" }}
                            onClick={() => router && router.open(editUrl)}
                            title="Edit this rule in workflow editor"
                          >
                            Edit Rule
                          </button>
                        )}
                      </div>
                      {log.ruleName && (
                        <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "2px" }}>
                          Rule: {log.ruleName}
                        </div>
                      )}
                      <div className="log-details">
                        Field: <code className="field-id">{log.fieldId}</code>
                        {log.decision && <span style={{ marginLeft: "8px" }}>Decision: <strong>{log.decision}</strong></span>}
                      </div>
                      <div className="log-reason">{log.reason}</div>
                      {log.tokens && (
                        <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "2px" }}>
                          AI: {log.aiTimeMs || log.executionTimeMs}ms · {log.tokens} tokens
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
      </>)}

      {/* Documentation Tab */}
      {activeTab === "docs" && (
        <DocsTab invoke={invoke} isAdmin={isAdmin} accountId={accountId} />
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
