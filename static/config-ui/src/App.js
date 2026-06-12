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
import { invoke } from "@forge/bridge";
import SemanticConfig from "./components/SemanticConfig";
import FunctionBuilder from "./components/FunctionBuilder";
import CustomSelect from "./components/CustomSelect";
import IssuePicker from "./components/IssuePicker";
import DocRepository from "./components/DocRepository";
import ReviewPanel from "./components/ReviewPanel";
import { ConfigSkeleton } from "./components/Skeleton";

// Static-PF code offload: the workflow editor caps a rule's embedded config at
// ~32KB. Above the threshold the step code moves to app storage (KVS) and the
// rule config carries only a codeRef pointer. 4KB margin absorbs Forge-side
// wrapping/escaping; if even the slim config exceeds the second limit, the
// save is blocked with a hard error.
const CONFIG_OFFLOAD_THRESHOLD_BYTES = 28672;
const SLIM_CONFIG_MAX_BYTES = 30720;
const stepMeta = (fns) => (fns || []).map((f) => ({
  id: f.id, name: f.name, operationType: f.operationType, variableName: f.variableName,
}));

// Inject styles directly - more reliable in Forge iframe
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
      background: rgba(220, 38, 38, 0.1);
      color: var(--error-color);
    }

    .pf-tag-static {
      background: rgba(22, 163, 106, 0.1);
      color: var(--success-color);
    }

    /* === How it works banner === */
    .pf-how-it-works {
      background: linear-gradient(135deg, var(--icon-bg), rgba(37, 99, 235, 0.04));
      border-radius: 10px;
      padding: 14px 16px;
      margin-bottom: 16px;
      border: 1px solid rgba(37, 99, 235, 0.1);
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
      border-color: rgba(37, 99, 235, 0.3);
      box-shadow: 0 4px 16px rgba(37, 99, 235, 0.08);
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
      background: linear-gradient(135deg, var(--card-bg), rgba(37, 99, 235, 0.01));
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

// Import Forge bridge for workflow configuration
let workflowRules;
let view;

// Dynamic import for Forge bridges
const initBridges = async () => {
  try {
    const jiraBridge = await import("@forge/jira-bridge");
    workflowRules = jiraBridge.workflowRules;
  } catch (e) {
    console.log("jira-bridge not available:", e);
  }
  try {
    const bridge = await import("@forge/bridge");
    view = bridge.view;

    // Enable theming - this is the key to dark mode support!
    if (view && view.theme && view.theme.enable) {
      await view.theme.enable();
    }
  } catch (e) {
    console.log("bridge not available:", e);
  }
};

// We need refs to access current form state from the onConfigure callback
let currentFieldId = "";
let currentPrompt = "";
let currentEnableTools = null; // null = auto-detect, true = always on, false = always off
let currentContext = null;
// Post-function refs
let currentPostFunctionType = null; // null | "semantic" | "static"
let currentConditionPrompt = "";
let currentActionPrompt = "";
let currentActionFieldId = "";
let currentCrossCheckClaims = false;
let currentManagedConfig = null; // a generate-doc/research/comment config loaded on edit
let currentSimulationMode = false; // per-rule simulation flag (set by the admin wizard)
let currentSuppressNotifications = false; // per-rule notifyUsers=false flag (semantic + static)
let currentFunctions = [];
let currentValidatorDocIds = [];
// Stable rule id — loaded from existing config on edit so we don't generate a fresh one each time
// (avoids orphan registry rows when Forge context lacks workflowName/transitionId).
let currentExistingRuleId = null;
// True only when we LOADED an existing config that carried no id — i.e. an
// edit of a pre-id-embedding legacy rule. Only then may the backend's
// claim-by-context fallback adopt an existing registry row; for a brand-new
// rule that same fallback would hijack a sibling's row (rename its id to our
// fresh instanced id, stranding the sibling's disable state).
let currentIsLegacyEdit = false;

function App() {
  const [fieldId, setFieldId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [enableTools, setEnableTools] = useState(null); // null = auto, true = on, false = off
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fields, setFields] = useState([]);
  const [allFields, setAllFields] = useState([]);
  const [allFieldsLoading, setAllFieldsLoading] = useState(true);
  const [fieldsLoading, setFieldsLoading] = useState(true);
  const [fieldsError, setFieldsError] = useState(null);
  const [fieldsSource, setFieldsSource] = useState(null);
  const [isCreateTransition, setIsCreateTransition] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [dropdownSearch, setDropdownSearch] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const dropdownRef = useRef(null);
  const searchInputRef = useRef(null);
  const listRef = useRef(null);
  const [dropdownFlipUp, setDropdownFlipUp] = useState(false);

  // Validator test state
  const [validatorTestOpen, setValidatorTestOpen] = useState(false);
  const [validatorTestIssue, setValidatorTestIssue] = useState("");
  const [validatorTestRunning, setValidatorTestRunning] = useState(false);
  const [validatorTestResult, setValidatorTestResult] = useState(null);
  const [validatorIssueValid, setValidatorIssueValid] = useState(null);

  // Doc library for validators — persisted as selectedDocIds in config
  const [validatorDocIds, setValidatorDocIds] = useState([]);

  // BYOK state — used to show cost notice when user's own key is active
  const [isByok, setIsByok] = useState(false);
  const [providerLabel, setProviderLabel] = useState("AI");

  // Post-function state
  const [isPostFunction, setIsPostFunction] = useState(false);
  const [isCondition, setIsCondition] = useState(false);
  const [postFunctionType, setPostFunctionType] = useState(null); // null | "semantic" | "static"
  const [conditionPrompt, setConditionPrompt] = useState("");
  const [actionPrompt, setActionPrompt] = useState("");
  const [actionFieldId, setActionFieldId] = useState("");
  const [crossCheckClaims, setCrossCheckClaims] = useState(false);
  const [managedType, setManagedType] = useState(null); // generate-doc/research/comment → managed in admin panel
  const [simulationMode, setSimulationMode] = useState(false); // per-rule simulation flag (kept in sync with currentSimulationMode)
  const [suppressNotifications, setSuppressNotifications] = useState(false); // kept in sync with currentSuppressNotifications
  const [functions, setFunctions] = useState([{
    id: `func_${Date.now()}_initial`,
    name: "",
    conditionPrompt: "",
    operationType: "work_item_query",
    operationPrompt: "",
    endpoint: "",
    method: "GET",
    variableName: "result1",
    code: "",
    includeBackoff: false,
  }]);

  // Keep refs in sync with state
  useEffect(() => {
    currentFieldId = fieldId;
  }, [fieldId]);

  useEffect(() => {
    currentPrompt = prompt;
  }, [prompt]);

  useEffect(() => {
    currentEnableTools = enableTools;
  }, [enableTools]);

  // Post-function ref sync
  useEffect(() => { currentPostFunctionType = postFunctionType; }, [postFunctionType]);
  useEffect(() => { currentConditionPrompt = conditionPrompt; }, [conditionPrompt]);
  useEffect(() => { currentActionPrompt = actionPrompt; }, [actionPrompt]);
  useEffect(() => { currentActionFieldId = actionFieldId; }, [actionFieldId]);
  useEffect(() => { currentCrossCheckClaims = crossCheckClaims; }, [crossCheckClaims]);
  useEffect(() => { currentFunctions = functions; }, [functions]);
  useEffect(() => { currentValidatorDocIds = validatorDocIds; }, [validatorDocIds]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Focus search input and measure viewport when dropdown opens
  useEffect(() => {
    if (dropdownOpen) {
      if (searchInputRef.current) searchInputRef.current.focus();
      if (dropdownRef.current) {
        const rect = dropdownRef.current.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom - 8;
        const spaceAbove = rect.top - 8;
        setDropdownFlipUp(spaceBelow < 320 && spaceAbove > spaceBelow);
      }
    }
  }, [dropdownOpen]);

  // Reset highlight when search changes
  useEffect(() => {
    setHighlightedIndex(0);
  }, [dropdownSearch]);

  // Compute filtered + grouped fields for dropdown
  const filteredFields = fields.filter((f) => {
    if (!dropdownSearch) return true;
    const q = dropdownSearch.toLowerCase();
    return f.name.toLowerCase().includes(q)
      || f.id.toLowerCase().includes(q)
      || f.type.toLowerCase().includes(q);
  });
  const systemFields = filteredFields.filter((f) => !f.custom);
  const customFields = filteredFields.filter((f) => f.custom);
  // Flat list for keyboard navigation (group labels excluded)
  const flatFiltered = [...systemFields, ...customFields];

  const handleDropdownKeyDown = (e) => {
    if (!dropdownOpen) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        setDropdownOpen(true);
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setDropdownOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((prev) => Math.min(prev + 1, flatFiltered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlightedIndex >= 0 && highlightedIndex < flatFiltered.length) {
        setFieldId(flatFiltered[highlightedIndex].id);
        setDropdownOpen(false);
        setDropdownSearch("");
      }
    }
  };

  // Scroll highlighted item into view
  useEffect(() => {
    if (!dropdownOpen || highlightedIndex < 0) return;
    const item = listRef.current?.querySelector(`[data-index="${highlightedIndex}"]`);
    if (item) item.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex, dropdownOpen]);

  useEffect(() => {
    // Inject styles immediately
    injectStyles();

    const init = async () => {
      await initBridges();

      // Get context first — we need projectId and transitionContext for field filtering
      let existingFieldId = "";
      if (view) {
        try {
          const context = await view.getContext();
          currentContext = context;

          // Try all possible locations for the config per module type
          let config =
            context?.extension?.postFunctionConfig ||
            context?.extension?.validatorConfig ||
            context?.extension?.conditionConfig ||
            context?.extension?.configuration ||
            context?.extension?.config;

          // Config is stored as JSON string, parse it
          if (typeof config === "string") {
            try {
              config = JSON.parse(config);
            } catch {
              // Ignore parse errors
            }
          }

          // Detect module type
          const extType = context?.extension?.type;
          if (extType === "jira:workflowCondition") {
            setIsCondition(true);
          }
          if (extType === "jira:workflowPostFunction") {
            setIsPostFunction(true);
            // Determine sub-type. The Forge MODULE KEY is the ground truth — it tells
            // us which slot Jira actually wired the rule to. config.type can drift
            // (older saves had no type, or a stale fallback got persisted), so it's
            // only a last-resort fallback for rules where the extension key is
            // somehow unavailable.
            const extKey = context?.extension?.key || "";
            let pfType;
            if (extKey.includes("static")) {
              pfType = "static";
            } else if (extKey.includes("semantic")) {
              pfType = "semantic";
            } else if (config?.type?.includes("static")) {
              pfType = "static";
            } else if (config?.type?.includes("semantic")) {
              pfType = "semantic";
            } else {
              pfType = "semantic"; // absolute fallback
            }
            setPostFunctionType(pfType);
            currentPostFunctionType = pfType;
          }

          if (config) {
            existingFieldId = config.fieldId || "";
            setFieldId(existingFieldId);
            setPrompt(config.prompt || "");
            setEnableTools(config.enableTools ?? null);
            currentFieldId = existingFieldId;
            currentPrompt = config.prompt || "";
            currentEnableTools = config.enableTools ?? null;
            // Capture the existing rule id so re-saves stay correlated with the same registry row.
            // Without this, edits where Forge omits workflowName/transitionId would generate a
            // fresh Date.now() id every save and orphan the previous registry entry.
            if (config.id) currentExistingRuleId = config.id;
            else currentIsLegacyEdit = true; // existing rule, pre-id-embedding build

            // Safety: declarative action types created in the admin panel (generate-doc /
            // research / comment) reuse the semantic module but aren't editable here yet.
            // Capture them so onConfigure preserves them intact instead of clobbering.
            const MANAGED_PF_TYPES = ["postfunction-generate-doc", "postfunction-research", "postfunction-comment", "postfunction-subtask", "postfunction-link"];
            if (MANAGED_PF_TYPES.includes(config.type)) {
              currentManagedConfig = config;
              setManagedType(config.type);
            }

            // Load post-function-specific config
            if (config.conditionPrompt) {
              setConditionPrompt(config.conditionPrompt);
              currentConditionPrompt = config.conditionPrompt;
            }
            if (config.actionPrompt) {
              setActionPrompt(config.actionPrompt);
              currentActionPrompt = config.actionPrompt;
            }
            if (config.actionFieldId) {
              setActionFieldId(config.actionFieldId);
              currentActionFieldId = config.actionFieldId;
            }
            if (typeof config.crossCheckClaims === "boolean") {
              setCrossCheckClaims(config.crossCheckClaims);
              currentCrossCheckClaims = config.crossCheckClaims;
            }
            if (config.simulationMode === true) {
              currentSimulationMode = true;
              setSimulationMode(true);
            }
            if (config.suppressNotifications === true) {
              currentSuppressNotifications = true;
              setSuppressNotifications(true);
            }
            if (config.functions && Array.isArray(config.functions) && config.functions.length > 0) {
              setFunctions(config.functions);
              currentFunctions = config.functions;
            } else if (config.codeRef) {
              // Offloaded rule — hydrate the step code from app storage.
              const codeResult = await invoke("getPostFunctionCode", { codeRef: config.codeRef });
              if (codeResult?.success && Array.isArray(codeResult.functions) && codeResult.functions.length > 0) {
                setFunctions(codeResult.functions);
                currentFunctions = codeResult.functions;
              } else {
                setError("This rule's step code could not be loaded from app storage. Its steps are shown empty — re-add or regenerate the code, then Save to re-publish.");
              }
            }
            // Load saved doc IDs for validators/conditions
            if (config.selectedDocIds && Array.isArray(config.selectedDocIds)) {
              setValidatorDocIds(config.selectedDocIds);
              currentValidatorDocIds = config.selectedDocIds;
            }
          }
        } catch (e) {
          console.log("Could not load existing config:", e);
        }
      }

      // Fetch ALL fields — validators and post-functions can target any field
      try {
        const allResult = await invoke("getFields");
        if (allResult.success && allResult.fields?.length > 0) {
          let loadedFields = allResult.fields;

          // If editing an existing rule, ensure the configured field is in the list
          if (existingFieldId && !loadedFields.find((f) => f.id === existingFieldId)) {
            loadedFields = [
              ...loadedFields,
              { id: existingFieldId, name: `${existingFieldId}`, type: "Unknown", custom: false },
            ];
          }

          setFields(loadedFields);
          setFieldsSource("all");
        } else {
          setFieldsError("Failed to load fields");
        }
      } catch (e) {
        console.error("[CogniRunner] Field fetch error:", e);
        setFieldsError("Failed to load fields: " + e.message);
      } finally {
        setFieldsLoading(false);
      }

      // Load ALL fields for post-function target field selector
      // (not limited to transition screen — PFs can update any field)
      try {
        const allResult = await invoke("getFields");
        if (allResult.success) {
          setAllFields(allResult.fields || []);
        }
      } catch (e) {
        console.log("Could not load all fields:", e);
      }
      setAllFieldsLoading(false);

      // Register the onConfigure callback - this is called when user clicks Add/Update button
      // The callback should return the current form state as JSON string. Returning undefined
      // signals invalid; throwing surfaces a real error to Forge so the save is blocked.
      if (workflowRules) {
        try {
          await workflowRules.onConfigure(async () => {
            const ext = currentContext?.extension || {};
            const isPostFn = ext.type === "jira:workflowPostFunction";

            // Compute workflow context FIRST so we can embed it in the config returned to Forge.
            // (Previously this was computed only for the registry call, leaving config.workflow null
            // at runtime → admin panel logs couldn't show which workflow/transition fired.)
            const workflowContext = {};
            if (ext.workflowId) workflowContext.workflowId = ext.workflowId;
            if (ext.workflowName) workflowContext.workflowName = ext.workflowName;
            if (ext.scopedProjectId) workflowContext.projectId = ext.scopedProjectId;
            if (ext.transitionContext) {
              workflowContext.transitionId = ext.transitionContext.id;
              workflowContext.transitionFromName = ext.transitionContext.from?.name;
              workflowContext.transitionToName = ext.transitionContext.to?.name;
            }
            if (currentContext?.siteUrl) workflowContext.siteUrl = currentContext.siteUrl;

            // Resolve a stable ruleId. Order:
            // 1. Existing config.id (loaded on edit) — most stable across re-saves
            // 2. type::workflowName::transitionId — deterministic AND unique per rule
            //    type (legacy un-namespaced ids collided when a validator, condition,
            //    and post-function shared a transition — disabling one muted the others)
            // 3. ext.entryPoint / ext.key — Forge-provided per-instance identifier
            // 4. Date.now() — last resort; warn so we can spot bad embeds in field reports
            const idTypePrefix = isPostFn
              ? ((currentManagedConfig && currentManagedConfig.type)
                  || (currentPostFunctionType === "static" ? "postfunction-static" : "postfunction-semantic"))
              : (ext.type === "jira:workflowCondition" ? "condition" : "validator");
            let ruleId = currentExistingRuleId;
            if (!ruleId) {
              // Fresh mints carry a per-instance suffix: a purely deterministic
              // type::workflow::transition id collides when a SECOND same-type
              // rule is added to one transition — the two rules' registry row,
              // disable flag, and log identity would silently merge. Edits never
              // reach this branch (the embedded config's id always wins above),
              // so the suffix never churns on re-save. The backend detects the
              // "::i-" format and applies instance-accurate orphan cleanup.
              const instanceSuffix = `::i-${Math.random().toString(36).slice(2, 8).padEnd(6, "0")}`;
              if (workflowContext.workflowName && workflowContext.transitionId) {
                ruleId = `${idTypePrefix}::${workflowContext.workflowName}::${workflowContext.transitionId}${instanceSuffix}`;
              } else if (ext.entryPoint || ext.key) {
                ruleId = `${idTypePrefix}::${ext.entryPoint || ext.key}${instanceSuffix}`;
              } else {
                ruleId = Date.now().toString();
                console.warn("[CogniRunner] Falling back to timestamp ruleId — Forge context missing workflow/transition. Edits will create new registry entries.");
              }
            }

            // Build base config — id and workflow MUST be embedded so the runtime executor
            // can resolve them (disable check, log filtering, admin panel grouping).
            const config = {
              id: ruleId,
              workflow: workflowContext,
              fieldId: currentFieldId.trim(),
              prompt: currentPrompt.trim(),
            };

            // Preserve declarative action types created in the admin panel (generate-doc /
            // research / comment): config-ui doesn't render their editors yet, so re-saving
            // here must NOT downgrade them to a plain semantic rule. Return them intact.
            if (isPostFn && currentManagedConfig && currentManagedConfig.type) {
              const preserved = { ...currentManagedConfig, id: ruleId, workflow: workflowContext };
              // simulationMode follows the banner toggle, not the stored value.
              if (currentSimulationMode) preserved.simulationMode = true;
              else delete preserved.simulationMode;
              return preserved;
            }

            // Validate based on module type. Return undefined to signal "invalid" — Forge then
            // shows its built-in field-error UI and the save is blocked.
            if (isPostFn && currentPostFunctionType === "semantic") {
              if (!currentConditionPrompt.trim()) {
                console.warn("[CogniRunner] Save blocked: semantic PF requires a condition prompt");
                setError("Add a Condition before saving.");
                return undefined;
              }
              if (!currentActionFieldId || !currentActionFieldId.trim()) {
                console.warn("[CogniRunner] Save blocked: semantic PF requires a target field");
                setError("Pick a Target Field before saving.");
                return undefined;
              }
              if (!currentActionPrompt.trim()) {
                console.warn("[CogniRunner] Save blocked: semantic PF requires an action prompt");
                setError("Add an Action prompt before saving.");
                return undefined;
              }
              config.type = "postfunction-semantic";
              config.conditionPrompt = currentConditionPrompt.trim();
              config.actionPrompt = currentActionPrompt.trim();
              config.actionFieldId = currentActionFieldId;
              config.crossCheckClaims = currentCrossCheckClaims;
            } else if (isPostFn && currentPostFunctionType === "static") {
              const populatedSteps = (currentFunctions || []).filter(
                (fn) => fn && fn.code && fn.code.trim().length > 0
              );
              if (populatedSteps.length === 0) {
                console.warn("[CogniRunner] Save blocked: static PF needs at least one step with code");
                setError("Add at least one step with code before saving (use Generate Code if you only have a description).");
                return undefined;
              }
              config.type = "postfunction-static";
              config.functions = currentFunctions;
            } else {
              // Standard validator/condition
              if (!currentFieldId.trim() || !currentPrompt.trim()) return undefined;
              if (currentEnableTools !== null) {
                config.enableTools = currentEnableTools;
              }
            }

            // Save selected doc IDs for all module types (validators, conditions, semantic PFs)
            if (currentValidatorDocIds.length > 0) {
              config.selectedDocIds = currentValidatorDocIds;
            }

            // Preserve simulation mode across workflow-editor re-saves — the wizard
            // sets it; this editor has no toggle for it yet, so never drop it silently.
            if (isPostFn && currentSimulationMode) {
              config.simulationMode = true;
            }

            // Notification suppression — only meaningful for types that PUT issue fields.
            if (isPostFn && currentSuppressNotifications
                && (currentPostFunctionType === "semantic" || currentPostFunctionType === "static")) {
              config.suppressNotifications = true;
            }

            // Static-PF code offload: measure the FULL config as it would be
            // embedded in the workflow rule; above the threshold ask the backend
            // to store the step code in KVS and embed a slim pointer config
            // instead. If even the slim config is too big, block the save HERE —
            // before any backend write, so registry and workflow never diverge.
            let wantOffload = false;
            if (isPostFn && currentPostFunctionType === "static"
                && Array.isArray(config.functions) && config.functions.length > 0) {
              const fullBytes = new TextEncoder().encode(JSON.stringify(config)).length;
              if (fullBytes > CONFIG_OFFLOAD_THRESHOLD_BYTES) {
                const slimPreview = { ...config, functions: undefined,
                  functionsMeta: stepMeta(config.functions), codeRef: "x".repeat(200) };
                const slimBytes = new TextEncoder().encode(JSON.stringify(slimPreview)).length;
                if (slimBytes > SLIM_CONFIG_MAX_BYTES) {
                  const sizeKb = Math.ceil(slimBytes / 1024);
                  console.warn("[CogniRunner] Save blocked: rule config too large even after code offload");
                  setError(`This rule is too large to save. Jira limits each workflow rule's configuration to 32 KB, and this rule is ${sizeKb} KB even after moving step code to app storage. Remove or shorten some steps, or split them across two CogniRunner post-functions on this transition.`);
                  return undefined;
                }
                wantOffload = true;
              }
            }

            console.log("Saving configuration:", config);

            // Register in admin registry. CRITICAL: if the registry write fails, throw — partial
            // state (Forge has the config but the registry doesn't) silently breaks disable,
            // log filtering, and admin panel history. Better to fail the save than pretend success.
            let registryResult;
            try {
              if (isPostFn) {
                const moduleType = currentPostFunctionType === "static"
                  ? "postfunction-static" : "postfunction-semantic";
                registryResult = await invoke("registerPostFunction", {
                  id: ruleId,
                  type: moduleType,
                  fieldId: config.fieldId,
                  prompt: config.prompt,
                  conditionPrompt: config.conditionPrompt || "",
                  actionPrompt: config.actionPrompt || "",
                  actionFieldId: config.actionFieldId || "",
                  functions: currentFunctions,
                  workflow: workflowContext,
                  requestCodeOffload: wantOffload,
                  legacyUpgrade: currentIsLegacyEdit,
                });
              } else {
                const moduleType = ext.type === "jira:workflowCondition" ? "condition" : "validator";
                registryResult = await invoke("registerConfig", {
                  id: ruleId,
                  type: moduleType,
                  fieldId: config.fieldId,
                  prompt: config.prompt,
                  workflow: workflowContext,
                  legacyUpgrade: currentIsLegacyEdit,
                });
              }
            } catch (netErr) {
              console.error("[CogniRunner] Registry write failed (network/transport):", netErr);
              setError("Couldn't save: " + (netErr.message || "registry unreachable"));
              throw netErr;
            }

            if (registryResult && registryResult.success === false) {
              const msg = "Couldn't save: " + (registryResult.error || "registry rejected");
              console.error("[CogniRunner] Registry returned failure:", registryResult);
              setError(msg);
              throw new Error(msg);
            }

            // Swap to the slim pointer config — the backend stored the step code
            // in KVS and returned its exact key (never re-derived client-side).
            if (wantOffload && registryResult?.codeKey) {
              delete config.functions;
              config.codeRef = registryResult.codeKey;
              config.functionsMeta = stepMeta(currentFunctions);
            }

            // Track the id so a subsequent re-save in the same session reuses the same row.
            currentExistingRuleId = ruleId;
            return JSON.stringify(config);
          });
          console.log("onConfigure callback registered successfully");
        } catch (e) {
          console.error("Failed to register onConfigure:", e);
          setError("Failed to initialize configuration: " + e.message);
        }
      }

      // Check BYOK status and provider for cost notice
      try {
        const [keyStatus, providerResult] = await Promise.all([
          invoke("getOpenAIKey"),
          invoke("getProvider"),
        ]);
        if (keyStatus?.isByok) setIsByok(true);
        if (providerResult?.success) {
          const labels = { openai: "OpenAI", azure: "Azure OpenAI", openrouter: "OpenRouter", anthropic: "Anthropic" };
          setProviderLabel(labels[providerResult.provider] || providerResult.provider || "AI");
        }
      } catch (e) {
        // Ignore — defaults are fine
      }

      setLoading(false);
    };
    init();
  }, []);

  if (loading) {
    return <ConfigSkeleton />;
  }

  return (
    <div className="container">
      <div className="header">
        <div className="icon-wrapper">
          <svg width="20" height="20" viewBox="0 0 128 128" fill="none">
            <defs><linearGradient id="uiBg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#0065FF"/><stop offset="100%" stopColor="#4C9AFF"/></linearGradient></defs>
            <rect x="4" y="4" width="120" height="120" rx="24" ry="24" fill="url(#uiBg)"/>
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
          <h3 className="title">
            {isPostFunction ? "Post Function Configuration"
              : isCondition ? "AI Condition Configuration"
              : "AI Validator Configuration"}
          </h3>
          <p className="subtitle">
            {isPostFunction
              ? "The workflow AI agent for Jira - it builds, tests, fixes, and learns."
              : isCondition
                ? "Configure AI-powered condition for this workflow transition"
                : "Configure AI-powered field validation for this workflow transition"
            }
          </p>
        </div>
      </div>

      {/* Module type info banner for validators/conditions */}
      {!isPostFunction && (
        <div className="pf-type-card pf-type-active" style={{ marginBottom: "16px" }}>
          <div className="pf-type-header">
            {isCondition ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M8 12l2 2 4-4" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            )}
            <strong>{isCondition ? "Condition" : "Validator"}</strong>
            {isByok && <span className="pf-type-tag pf-tag-semantic" style={{ marginLeft: "auto" }}>AI cost per run</span>}
          </div>
          <p className="pf-type-desc" style={{ margin: 0 }}>
            {isCondition
              ? "Hides or shows the transition button based on AI evaluation. Does not block — just controls visibility."
              : "Blocks the transition if the AI determines the field content does not meet your criteria."
            }
          </p>
        </div>
      )}

      {/* Post-function type — LOCKED to whichever Forge module slot Jira wired
          this rule to. Used to be a clickable picker that let the user flip
          between Semantic and Static after creation, but the workflow XML's
          slot is fixed (it's the module key), so flipping the type in the form
          made the saved config drift from what the workflow editor labels the
          rule as. Type is now derived from extKey at load time and rendered
          read-only. To change a rule's type, delete it and re-add via the
          other slot in the workflow editor. */}
      {isPostFunction && (
        <div className="pf-type-selector">
          <div className="pf-type-card pf-type-active" style={{ cursor: "default" }}>
            <div className="pf-type-header">
              {postFunctionType === "semantic" ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="16 18 22 12 16 6" />
                  <polyline points="8 6 2 12 8 18" />
                </svg>
              )}
              <strong>{postFunctionType === "semantic" ? "Semantic Post Function" : "Static Post Function"}</strong>
            </div>
            <p className="pf-type-desc">
              {postFunctionType === "semantic"
                ? "AI runs on every transition to evaluate a condition and update a target field. Best for decisions requiring judgment."
                : "AI generates code once during setup. That code runs on every transition with zero AI cost at runtime."}
              {" "}This rule's type is determined by the workflow slot it's installed in — to switch types, remove this rule and add the other variant from the workflow editor.
            </p>
            {isByok && (
              <span className={`pf-type-tag ${postFunctionType === "semantic" ? "pf-tag-semantic" : "pf-tag-static"}`}>
                {postFunctionType === "semantic" ? "AI cost per run" : "No AI cost at runtime"}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Static post-function: FunctionBuilder (replaces the standard form) */}
      {isPostFunction && postFunctionType === "static" && (
        <div className="card">
          <FunctionBuilder functions={functions} setFunctions={setFunctions} />
        </div>
      )}

      {/* Simulation mode banner — visible whenever the flag is involved, for every
          PF type (incl. managed ones). This is the OFF-switch: the wizard can only
          turn simulation on at creation time. Module-level ref keeps the onConfigure
          closure in sync (house pattern). */}
      {isPostFunction && (simulationMode || currentSimulationMode) && (
        <div className="card" style={{ border: "2px solid #d97706", boxShadow: "0 4px 12px -4px rgba(217, 119, 6, 0.35)" }}>
          <div style={{ padding: "12px 16px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={simulationMode}
                onChange={(e) => { setSimulationMode(e.target.checked); currentSimulationMode = e.target.checked; }}
              />
              Simulation Mode {simulationMode ? "— ON (no writes are made)" : "— will be DISABLED on save"}
            </label>
            <p style={{ margin: "4px 0 0 22px", fontSize: "11px", color: "var(--text-secondary, #5e6c84)" }}>
              While ON, this rule runs its full AI evaluation on every transition and logs what it
              <strong> would</strong> do — without updating fields, posting comments, creating links/sub-tasks,
              or attaching documents. Untick and save to go live.
            </p>
          </div>
        </div>
      )}

      {/* Notification suppression — semantic + static only (the two types that PUT
          issue fields). Unlike simulationMode this editor offers the on-switch:
          these rule types are fully editable here, and a wizard-only flag would be
          unreachable for editor-created rules. Standard card, not the amber
          warning style. */}
      {isPostFunction && !managedType && (postFunctionType === "semantic" || postFunctionType === "static") && (
        <div className="card">
          <div style={{ padding: "12px 16px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={suppressNotifications}
                onChange={(e) => { setSuppressNotifications(e.target.checked); currentSuppressNotifications = e.target.checked; }}
              />
              Suppress notifications for this rule&apos;s field updates
            </label>
            <p style={{ margin: "4px 0 0 22px", fontSize: "11px", color: "var(--text-secondary, #5e6c84)" }}>
              Field updates made by this rule won&apos;t email watchers (Jira&apos;s notifyUsers=false).
              Suppression needs the app to have project admin permission — if Jira refuses, the update
              is retried with notifications on and the execution log notes it. Applies to field updates
              only: transitions, comments, sub-tasks, and links still notify as normal.
            </p>
          </div>
        </div>
      )}

      {/* Semantic post-function: condition/action prompts + field selector */}
      {isPostFunction && managedType && (
        <div className="card">
          <div style={{ padding: "16px" }}>
            <h3 style={{ margin: "0 0 6px", fontSize: "14px", fontWeight: 600 }}>
              {managedType === "postfunction-generate-doc" ? "Generate Document"
                : managedType === "postfunction-research" ? "Research & Save"
                : "Add Comment"} rule
            </h3>
            <p style={{ margin: 0, fontSize: "12px", color: "var(--text-secondary, #5e6c84)" }}>
              This action type is configured in the <strong>CogniRunner admin panel</strong> (Apps → CogniRunner). The workflow editor can&apos;t edit it yet — saving here preserves the rule unchanged. Open the admin panel to change its settings.
            </p>
          </div>
        </div>
      )}

      {isPostFunction && postFunctionType === "semantic" && !managedType && (
        <div className="card">
          {isByok && (
            <div className="byok-cost-notice">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>Uses your {providerLabel} API key. Each transition consumes tokens from your account.</span>
            </div>
          )}
          <SemanticConfig
            conditionPrompt={conditionPrompt}
            setConditionPrompt={setConditionPrompt}
            actionPrompt={actionPrompt}
            setActionPrompt={setActionPrompt}
            actionFieldId={actionFieldId}
            setActionFieldId={setActionFieldId}
            fieldId={fieldId}
            setFieldId={setFieldId}
            fields={allFields.length > 0 ? allFields : fields}
            loadingFields={allFieldsLoading && fieldsLoading}
            errorFields={fieldsError}
            selectedDocIds={validatorDocIds}
            onDocSelectionChange={(ids) => { setValidatorDocIds(ids); currentValidatorDocIds = ids; }}
            crossCheckClaims={crossCheckClaims}
            setCrossCheckClaims={(v) => { setCrossCheckClaims(v); currentCrossCheckClaims = v; }}
          />
        </div>
      )}

      {/* Standard validator/condition form */}
      {!isPostFunction && (
      <div className="card">
        {isByok && (
          <div className="byok-cost-notice">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>Uses your {providerLabel} API key. Each validation consumes tokens from your account.</span>
          </div>
        )}
        <div className="form-group">
          <label className="label">
            Field to Validate <span className="required">*</span>
          </label>
          {fieldsLoading ? (
            <div className="sk sk-block" style={{ height: 42 }} />
          ) : fieldsError ? (
            <>
              <input
                type="text"
                value={fieldId}
                onChange={(e) => setFieldId(e.target.value)}
                placeholder="e.g., summary, description, customfield_10001"
                className={`input ${error && !fieldId.trim() ? "input-error" : ""}`}
              />
              <p className="hint" style={{ color: "var(--error-color)" }}>
                Could not load fields: {fieldsError}. Enter field ID manually.
              </p>
            </>
          ) : (
            <div className="dropdown" ref={dropdownRef} onKeyDown={handleDropdownKeyDown}>
              <button
                type="button"
                className={`dropdown-trigger${dropdownOpen ? " dropdown-open" : ""}${error && !fieldId.trim() ? " dropdown-error" : ""}`}
                onClick={() => { setDropdownOpen((o) => !o); setDropdownSearch(""); }}
              >
                {fieldId && fields.find((f) => f.id === fieldId) ? (
                  <span>{fields.find((f) => f.id === fieldId).name}</span>
                ) : (
                  <span className="dropdown-placeholder">Select a field...</span>
                )}
                <span className="dropdown-chevron">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
                </span>
              </button>
              {dropdownOpen && (
                <div className={`dropdown-panel${dropdownFlipUp ? " dropdown-panel-up" : ""}`}>
                  <div className="dropdown-search">
                    <input
                      ref={searchInputRef}
                      type="text"
                      value={dropdownSearch}
                      onChange={(e) => setDropdownSearch(e.target.value)}
                      placeholder="Search fields..."
                    />
                  </div>
                  <div className="dropdown-list" ref={listRef}>
                    {flatFiltered.length === 0 ? (
                      <div className="dropdown-empty">No fields match your search</div>
                    ) : (
                      <>
                        {systemFields.length > 0 && (
                          <>
                            <div className="dropdown-group-label">System Fields</div>
                            {systemFields.map((f) => {
                              const idx = flatFiltered.indexOf(f);
                              return (
                                <div
                                  key={f.id}
                                  data-index={idx}
                                  className={`dropdown-item${f.id === fieldId ? " dropdown-selected" : ""}${idx === highlightedIndex ? " dropdown-highlighted" : ""}`}
                                  onClick={() => { setFieldId(f.id); setDropdownOpen(false); setDropdownSearch(""); }}
                                  onMouseEnter={() => setHighlightedIndex(idx)}
                                >
                                  <span className="dropdown-item-name">{f.name}</span>
                                  <span className="dropdown-item-meta">{f.id}</span>
                                  <span className="dropdown-item-type">{f.type.replace(/^System \(|\)$/g, "")}</span>
                                </div>
                              );
                            })}
                          </>
                        )}
                        {customFields.length > 0 && (
                          <>
                            <div className="dropdown-group-label">Custom Fields</div>
                            {customFields.map((f) => {
                              const idx = flatFiltered.indexOf(f);
                              return (
                                <div
                                  key={f.id}
                                  data-index={idx}
                                  className={`dropdown-item${f.id === fieldId ? " dropdown-selected" : ""}${idx === highlightedIndex ? " dropdown-highlighted" : ""}`}
                                  onClick={() => { setFieldId(f.id); setDropdownOpen(false); setDropdownSearch(""); }}
                                  onMouseEnter={() => setHighlightedIndex(idx)}
                                >
                                  <span className="dropdown-item-name">{f.name}</span>
                                  <span className="dropdown-item-meta">{f.id}</span>
                                  <span className="dropdown-item-type">{f.type.replace(/^Custom \(|\)$/g, "")}</span>
                                </div>
                              );
                            })}
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
          <p className="hint">
            Select the field whose value will be validated by AI on each transition. All system and custom fields are available.
          </p>
        </div>

        <div className="form-group">
          <label className="label">
            Validation Prompt <span className="required">*</span>
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe what makes the field value valid. Example: The description must include steps to reproduce, expected behavior, and actual behavior."
            className={`textarea ${error && !prompt.trim() ? "input-error" : ""}`}
            rows={5}
          />
          <p className="hint">
            Describe the validation criteria in natural language. The AI will
            evaluate if the field content meets these requirements.
          </p>
        </div>

        <div className="form-group">
          <label className="label">Jira Search (JQL)</label>
          <CustomSelect
            value={enableTools === null ? "auto" : enableTools ? "on" : "off"}
            onChange={(v) => setEnableTools(v === "auto" ? null : v === "on")}
            options={[
              { value: "auto", label: "Auto-detect from prompt" },
              { value: "on", label: "Always enabled" },
              { value: "off", label: "Always disabled" },
            ]}
          />
          <p className="hint">
            When enabled, the AI can search Jira for similar or related issues during
            validation (e.g. duplicate detection). Auto-detect activates this when your
            prompt mentions duplicates, similarity, or existing issues. Adds latency.
          </p>
        </div>

        {/* Documentation Library for validators */}
        <div className="form-group">
          <DocRepository
            selectedDocs={validatorDocIds}
            onSelectionChange={(ids) => { setValidatorDocIds(ids); currentValidatorDocIds = ids; }}
          />
        </div>

        {/* AI Review + Test */}
        <div className="validator-test-section">
          <ReviewPanel
            configType={isPostFunction ? undefined : "validator"}
            config={{ fieldId, prompt, enableTools, selectedDocIds: validatorDocIds }}
          />
        </div>
        <div className="validator-test-section">
          <button
            className="btn-semantic-test-toggle"
            onClick={() => setValidatorTestOpen(!validatorTestOpen)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            <span>{validatorTestOpen ? "Hide Test" : "Test Validation"}</span>
          </button>

          {validatorTestOpen && (
            <div className="semantic-test-panel" style={{ marginTop: "10px" }}>
              <div className="semantic-test-header">
                <span className="test-panel-badge">Dry run — no transition is blocked</span>
              </div>

              <div className="form-group" style={{ margin: "10px 12px 8px" }}>
                <label className="label" style={{ fontSize: "11px", marginBottom: "4px" }}>
                  Test against issue
                </label>
                <div className="test-target-row">
                  <IssuePicker value={validatorTestIssue} onChange={setValidatorTestIssue} onValidationChange={setValidatorIssueValid} />
                  <button
                    className="btn-run-test"
                    onClick={async () => {
                      setValidatorTestRunning(true);
                      setValidatorTestResult(null);
                      try {
                        const result = await invoke("testValidation", {
                          issueKey: validatorTestIssue.trim(),
                          fieldId: fieldId,
                          prompt: prompt,
                          enableTools: enableTools,
                          selectedDocIds: validatorDocIds,
                        });
                        setValidatorTestResult(result);
                      } catch (e) {
                        setValidatorTestResult({ success: false, error: e.message, logs: [] });
                      }
                      setValidatorTestRunning(false);
                    }}
                    disabled={validatorTestRunning || !validatorTestIssue.trim() || !fieldId.trim() || !prompt.trim() || !validatorIssueValid?.valid}
                  >
                    {validatorTestRunning ? "Running..." : "Run Test"}
                  </button>
                </div>
              </div>

              {validatorTestResult && (
                <div className={`semantic-test-result ${validatorTestResult.success ? (validatorTestResult.isValid ? "st-update" : "st-error") : "st-error"}`}>
                  <div className="st-result-header">
                    {validatorTestResult.success ? (
                      <span className={`test-badge ${validatorTestResult.isValid ? "test-badge-pass" : "test-badge-fail"}`}>
                        {validatorTestResult.isValid ? "PASS" : "FAIL"}
                      </span>
                    ) : (
                      <span className="test-badge test-badge-fail">ERROR</span>
                    )}
                    <span className="test-result-meta">
                      {validatorTestResult.issueKey}
                      {validatorTestResult.mode === "agentic" ? " (agentic)" : ""}
                      {validatorTestResult.executionTimeMs ? ` — ${validatorTestResult.executionTimeMs}ms` : ""}
                    </span>
                    <button className="test-dismiss" onClick={() => setValidatorTestResult(null)}>&times;</button>
                  </div>

                  {validatorTestResult.error && !validatorTestResult.success && (
                    <div className="st-section"><strong>Error:</strong> {validatorTestResult.error}</div>
                  )}

                  {validatorTestResult.reason && (
                    <div className="st-section">
                      <div className="st-section-label">AI Reasoning</div>
                      <div className="st-reason">{validatorTestResult.reason}</div>
                    </div>
                  )}

                  {validatorTestResult.fieldValue && (
                    <div className="st-section">
                      <div className="st-section-label">Field Value ({validatorTestResult.fieldId})</div>
                      <pre className="st-value">{validatorTestResult.fieldValue}</pre>
                    </div>
                  )}

                  {validatorTestResult.toolInfo && (
                    <div className="st-section">
                      <div className="st-section-label">JQL Search (Agentic)</div>
                      <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                        {validatorTestResult.toolInfo.toolRounds} round{validatorTestResult.toolInfo.toolRounds !== 1 ? "s" : ""}, {validatorTestResult.toolInfo.totalResults} result{validatorTestResult.toolInfo.totalResults !== 1 ? "s" : ""}
                      </div>
                      {validatorTestResult.toolInfo.queries?.map((q, i) => (
                        <div key={i} className="test-log-line" style={{ marginTop: "2px" }}><code>{q}</code></div>
                      ))}
                    </div>
                  )}

                  {validatorTestResult.logs && validatorTestResult.logs.length > 0 && (
                    <div className="st-section">
                      <div className="st-section-label">Execution Log</div>
                      {validatorTestResult.logs.map((log, i) => (
                        <div key={i} className="test-log-line"><code>{log}</code></div>
                      ))}
                    </div>
                  )}

                  {validatorTestResult.success && !validatorTestResult.isValid && (
                    <div className="st-section" style={{ fontSize: "12px", color: "var(--text-muted)", fontStyle: "italic" }}>
                      In production, this would block the transition with: "AI Validation failed: {validatorTestResult.reason}"
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      )}

      {error && (
        <div className="alert alert-error">
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
          <span>{error}</span>
        </div>
      )}

      {!isPostFunction && (!fieldId.trim() || !prompt.trim()) && (
        <div className="alert alert-error">
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
          <span>
            Please fill in both Field ID and Validation Prompt before clicking
            Add/Update.
          </span>
        </div>
      )}
    </div>
  );
}

export default App;
