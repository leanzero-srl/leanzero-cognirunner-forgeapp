/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
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
import { logSourceOf, SOURCE_LABEL, FLAG_LABEL, isSkippedLog } from "../../../src/shared/log-flags.js";
import AddRuleWizard from "./components/AddRuleWizard";
import Tooltip from "./components/Tooltip";
import RulePortabilityDialog from "./components/RulePortabilityDialog";
import ListenersTab from "./components/ListenersTab";
import JobsTab from "./components/JobsTab";
import DeleteRulesDialog from "./components/DeleteRulesDialog";
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
      /* Canonical LeanZero design tokens (unified with config-view) — mandate hue map,
         radius ladder, blue-black card shadows. Additive; existing vars unchanged. */
      --accent: #2563eb; --accent-deep: #1d4ed8;
      --accent-docs: #2563eb; --accent-skills: #7c3aed; --accent-memories: #0d9488;
      --accent-test: #d97706; --accent-fix: #16a34a; --accent-slate: #475569;
      --accent-cyan: #0891b2; --accent-indigo: #4f46e5;
      --r-sm: 6px; --r-md: 8px; --r-lg: 12px; --r-pill: 999px;
      --shadow-card: 0 1px 2px rgba(18,42,66,0.06), 0 5px 16px -8px rgba(18,42,66,0.14);
      --shadow-card-hover: 0 12px 30px -12px rgba(29,78,216,0.28), 0 3px 10px rgba(18,42,66,0.10);
      --glow: 0 8px 22px -6px rgba(37,99,235,0.42);
    }

    html[data-color-mode="dark"] {
      --bg-color: transparent;
      --accent: #3b82f6; --accent-deep: #3b82f6;
      --accent-docs: #3b82f6; --accent-skills: #8b5cf6; --accent-memories: #14b8a6;
      --accent-test: #f59e0b; --accent-fix: #22c55e; --accent-slate: #64748b;
      --accent-cyan: #22d3ee; --accent-indigo: #6366f1;
      --shadow-card: 0 1px 2px rgba(0,0,0,0.4), 0 5px 16px -8px rgba(0,0,0,0.6);
      --shadow-card-hover: 0 12px 30px -12px rgba(0,0,0,0.7), 0 3px 10px rgba(0,0,0,0.5);
      --glow: 0 8px 22px -6px rgba(59,130,246,0.5);
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

    /* Accessible banner idiom (matches config-view): neutral card + 2px hue border + hue
       shadow, not a faded tint fill. */
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

    .section {
      margin-bottom: 24px;
    }

    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
      /* Wrap the action controls below the title on narrow widths (e.g. a 1024px
         screen with Jira's sidebar) instead of forcing horizontal PAGE scroll that
         pushes primary actions off-screen. No-op when everything fits. */
      flex-wrap: wrap;
      gap: 8px 12px;
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
      flex-wrap: wrap;
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
    /* Re-keyed tab panel entrance — a light fade-up replays on each tab switch. MLS-compliant:
       ends at transform:none, disabled under prefers-reduced-motion. */
    .tab-panel { animation: tabPanelFadeUp 0.26s cubic-bezier(0.22, 1, 0.36, 1); }
    @keyframes tabPanelFadeUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { .tab-panel { animation: none; } }
    .tab-intro-eyebrow {
      font-family: SFMono-Regular, Consolas, monospace; font-size: 10px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.14em; color: var(--primary-color); flex-shrink: 0;
    }
    .tab-intro-what { font-size: 12.5px; line-height: 1.5; color: var(--text-secondary); }
    .tab-intro-terms { display: inline-flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .term-chip {
      display: inline-block; padding: 1px 9px; border-radius: 999px;
      font-size: 11px; font-weight: 600; color: var(--primary-color);
      border: 1px dashed var(--primary-color); cursor: help; white-space: nowrap;
      transition: background 0.15s ease, color 0.15s ease;
    }
    .term-chip:hover { background: var(--primary-color); color: #ffffff; }

    /* AI usage meter — bold saturated numbers, solid cyan provider bars. Inset card,
       no left rail, no faded tint. Meter hue is distinct from docs/skills/memories. */
    .usage-card {
      margin-bottom: 20px; padding: 14px 16px;
      background: var(--code-bg); border: 1px solid var(--border-color); border-radius: 10px;
    }
    .usage-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; gap: 10px; flex-wrap: wrap; }
    .usage-eyebrow {
      font-family: SFMono-Regular, Consolas, monospace; font-size: 10px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.14em; color: #0891b2;
    }
    html[data-color-mode="dark"] .usage-eyebrow { color: #22d3ee; }
    .usage-reset-confirm { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-secondary); }
    .usage-stats { display: flex; gap: 28px; flex-wrap: wrap; margin-bottom: 14px; }
    .usage-stat { display: flex; flex-direction: column; }
    .usage-num { font-size: 22px; font-weight: 800; letter-spacing: -0.02em; color: var(--text-color); font-variant-numeric: tabular-nums; }
    .usage-lbl { font-size: 11px; color: var(--text-secondary); margin-top: 2px; }
    .usage-providers { display: flex; flex-direction: column; gap: 6px; margin-bottom: 10px; }
    .usage-prov-row { display: grid; grid-template-columns: 92px 1fr auto; align-items: center; gap: 10px; font-size: 11px; }
    .usage-prov-name { font-weight: 600; color: var(--text-color); text-transform: capitalize; }
    .usage-prov-bar { height: 8px; background: var(--border-color); border-radius: 999px; overflow: hidden; }
    .usage-prov-fill { display: block; height: 100%; background: #0891b2; border-radius: 999px; }
    html[data-color-mode="dark"] .usage-prov-fill { background: #22d3ee; }
    .usage-prov-val { color: var(--text-secondary); white-space: nowrap; font-variant-numeric: tabular-nums; }
    .usage-foot { font-size: 11px; color: var(--text-muted); font-style: italic; }

    /* Rule export / import dialog — solid status chips, canonical tokens, no left rail. */
    .pf-modal-overlay {
      position: fixed; inset: 0; z-index: 9998; background: rgba(15, 23, 42, 0.55);
      display: flex; align-items: flex-start; justify-content: center; padding: 48px 16px; overflow-y: auto;
    }
    /* Base panel for EVERY .pf-modal — port-dialog AND del-dialog. This was
       scoped to .pf-modal.port-dialog only, so the delete dialog (pf-modal
       del-dialog) rendered as unstyled text floating over the backdrop. */
    .pf-modal {
      background: var(--card-bg); border: 1px solid var(--border-color);
      border-radius: var(--r-lg, 12px); box-shadow: var(--shadow-card-hover); width: 100%; max-width: 640px; padding: 20px;
    }
    .port-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
    .port-tabs { display: flex; gap: 10px; margin-bottom: 16px; border-bottom: 1px solid var(--border-color); }
    .port-tab { background: none; border: none; padding: 8px 4px; margin-bottom: -1px; font-size: 13px; font-weight: 600; color: var(--text-secondary); cursor: pointer; border-bottom: 2px solid transparent; }
    .port-tab.is-active { color: var(--primary-color); border-bottom-color: var(--primary-color); }
    .port-hint { font-size: 12.5px; color: var(--text-secondary); line-height: 1.5; margin: 0 0 12px; }
    .port-selectall { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; margin-bottom: 8px; cursor: pointer; }
    .port-rulelist { max-height: 280px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: var(--r-md, 8px); }
    .port-ruleitem { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-bottom: 1px solid var(--border-color); font-size: 13px; cursor: pointer; }
    .port-ruleitem:last-child { border-bottom: none; }
    .port-rulename { flex: 1; color: var(--text-color); }
    .port-ruletype { font-size: 11px; color: var(--text-muted); }
    .port-empty { padding: 16px; text-align: center; color: var(--text-muted); font-size: 13px; }
    .port-actions { margin-top: 14px; display: flex; justify-content: flex-end; }
    /* File picker: our button + our label, never the browser's localized chrome.
       The real <input type="file"> stays in the DOM (it is what opens the OS file
       dialog) but is clipped to nothing rather than display:none, so it remains
       programmatically clickable in every browser. */
    .port-file { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; font-size: 12px; }
    .port-file-input { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0; }
    .port-file-name { color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .port-textarea { width: 100%; box-sizing: border-box; font-family: SFMono-Regular, Consolas, monospace; font-size: 12px; padding: 10px; border: 1px solid var(--border-color); border-radius: var(--r-md, 8px); background: var(--input-bg); color: var(--text-color); resize: vertical; }
    .port-plan { margin-top: 16px; }
    .port-plan-head { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary); margin-bottom: 8px; }
    .port-plan-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--border-color); font-size: 13px; flex-wrap: wrap; }
    .port-plan-name { flex: 1; font-weight: 600; color: var(--text-color); }
    .port-plan-type { font-size: 11px; color: var(--text-muted); }
    .port-plan-note { flex-basis: 100%; font-size: 11px; color: #d97706; }
    html[data-color-mode="dark"] .port-plan-note { color: #f59e0b; }
    .port-status { display: inline-flex; padding: 2px 8px; border-radius: var(--r-sm, 6px); font-size: 9px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; color: #fff; white-space: nowrap; }
    .port-status-ready { background: #16a34a; }
    .port-status-committed { background: #16a34a; }
    .port-status-needs-rebind { background: #d97706; color: #2a1602; }
    .port-status-conflict { background: #4f46e5; }
    .port-status-invalid { background: #dc2626; }
    .port-status-error { background: #dc2626; }
    html[data-color-mode="dark"] .port-status-ready,
    html[data-color-mode="dark"] .port-status-committed { background: #22c55e; }
    html[data-color-mode="dark"] .port-status-needs-rebind { background: #f59e0b; color: #2a1602; }
    html[data-color-mode="dark"] .port-status-conflict { background: #6366f1; }
    html[data-color-mode="dark"] .port-status-invalid,
    html[data-color-mode="dark"] .port-status-error { background: #ef4444; }
    .port-target { margin: 4px 0 14px; }
    .port-target-lbl { display: block; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary); margin-bottom: 6px; }
    .port-target-picks { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
    .port-commit-note { margin-top: 14px; padding: 10px 12px; background: var(--code-bg); border: 1px solid var(--border-color); border-radius: var(--r-md, 8px); font-size: 12px; color: var(--text-secondary); line-height: 1.5; }

    /* --- Rule deletion + registry pressure ------------------------------- */
    .rule-select-th { width: 30px; }
    .rule-select-cell input[type="checkbox"],
    .rule-select-th input[type="checkbox"] { width: 16px; height: 16px; accent-color: var(--primary-color); cursor: pointer; }
    .rule-select-cell input:disabled { cursor: default; opacity: 0.45; }
    /* Selection bar + table head both stick to the top of the Forge iframe's own
       scroll (the iframe scrolls internally; the parent Jira page does not). The
       bar is ABOVE the head in the DOM, so it takes top:0 and the head sits at the
       bar's height — otherwise the two overlap the moment a row is selected. */
    /* Fixed height, not padding: the table head below sticks at exactly this offset,
       and a derived height would drift the moment the bar's contents change. One
       token feeds both rules so they can never disagree. */
    :root { --rules-bulkbar-h: 52px; }
    .rules-bulkbar {
      position: sticky; top: 0; z-index: 3;
      height: var(--rules-bulkbar-h); box-sizing: border-box;
      display: flex; align-items: center; gap: 10px; padding: 0 14px;
      border-bottom: 1px solid var(--border-color);
      background: var(--code-bg); font-size: 12px; font-weight: 700; color: var(--text-color);
    }
    .rules-table thead th {
      position: sticky; top: 0; z-index: 2;
      background: var(--code-bg);
      /* A sticky <th> keeps its own background but LOSES the table's collapsed
         border, so the header runs into the first row without this. */
      box-shadow: inset 0 -1px 0 var(--border-color);
    }
    .rules-bulkbar ~ .rules-table thead th { top: var(--rules-bulkbar-h); }
    /* Idle state: the bar still occupies its full height (so selecting never resizes
       it) but reads as a quiet caption rather than an action bar. */
    .rules-bulkbar-idle { font-weight: 600; color: var(--text-secondary); }

    .rules-pagination {
      display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
      padding: 12px 14px; border-top: 1px solid var(--border-color);
    }
    .rules-pagesize { display: flex; align-items: center; gap: 6px; }
    .rules-pagesize-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary); margin-right: 2px; }
    .rules-pagesize-btn {
      min-width: 34px; padding: 4px 9px; border: 1px solid var(--border-color); border-radius: var(--r-sm, 6px);
      background: var(--card-bg); color: var(--text-secondary);
      font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer;
      transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
    }
    .rules-pagesize-btn:hover { background: var(--hover-bg); color: var(--text-color); }
    .rules-pagesize-btn.is-active { background: var(--primary-color); border-color: var(--primary-color); color: #ffffff; }
    .rules-pagesize-btn:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; }
    .rules-pager { display: flex; align-items: center; gap: 10px; }
    .rules-pagination-info { font-size: 12px; color: var(--text-secondary); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .rules-pagination-page { color: var(--text-muted); }
    .del-dialog { max-width: 620px; }
    .del-option { display: block; padding: 12px 14px; margin-top: 12px; border: 1px solid var(--border-color); border-radius: var(--r-md, 8px); cursor: pointer; }
    .del-option.is-active { border-color: #dc2626; box-shadow: inset 0 0 0 1px #dc2626; }
    .del-option[aria-disabled="true"] { opacity: 0.55; cursor: default; }
    .del-option-title { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; color: var(--text-color); }
    .del-radio { font-size: 13px; color: #dc2626; }
    .del-option-copy { font-size: 12px; color: var(--text-secondary); line-height: 1.5; margin-top: 4px; }
    .del-warn { font-size: 12px; font-weight: 700; color: #d97706; margin-top: 8px; line-height: 1.45; }
    .del-flag { font-size: 11px; font-weight: 700; color: #d97706; white-space: nowrap; }
    .del-progress { flex: 1; font-size: 12px; color: var(--text-secondary); }
    .del-results { margin-top: 12px; border: 1px solid var(--border-color); border-radius: var(--r-md, 8px); max-height: 140px; overflow-y: auto; }
    .del-result-row { display: flex; align-items: center; gap: 10px; padding: 7px 12px; border-bottom: 1px solid var(--border-color); font-size: 12px; }
    .del-result-row:last-child { border-bottom: none; }
    .del-result-msg { color: var(--text-secondary); }
    .port-actions { gap: 8px; align-items: center; }
    .owner-chip { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 700; color: #fff; background: #475569; }
    .owner-you { font-size: 12px; font-weight: 700; color: var(--primary-color); }
    .owner-name { font-size: 12px; color: var(--text-secondary); }
    /* A claimed rule is attributed but not authored — same weight as a name, with a
       help cursor because the distinction needs the tooltip to land. */
    .owner-claimed { cursor: help; }
    .transition-name { font-size: 12px; font-weight: 600; color: var(--text-color); }
    .reg-meter { margin-bottom: 12px; }
    .reg-meter-label { font-size: 12px; color: var(--text-secondary); margin-bottom: 5px; }
    .reg-meter-label strong { color: var(--text-color); font-weight: 700; }
    .reg-meter-bytes { color: var(--text-muted); }
    .reg-meter-flag { margin-left: 8px; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 700; color: #fff; background: #dc2626; }
    .reg-meter-bar { height: 8px; background: var(--border-color); border-radius: 999px; overflow: hidden; }
    .reg-meter-hint { margin-top: 6px; font-size: 12px; line-height: 1.5; color: var(--text-secondary); }
    .api-ari { font-size: 11px; word-break: break-all; display: inline-block; max-width: 460px; }
    .api-info-lead { font-size: 12.5px; line-height: 1.55; color: var(--text-secondary); padding: 10px 12px; border: 1px solid var(--border-color); border-radius: var(--r-md, 8px); background: var(--code-bg); }
    .api-info-lead strong { color: var(--text-color); font-weight: 700; }
    .api-info-warn { margin-top: 14px; padding: 12px 14px; border: 1px solid #d97706; border-radius: var(--r-md, 8px); font-size: 12.5px; color: var(--text-secondary); }
    .api-info-warn strong { color: var(--text-color); font-weight: 700; }
    html[data-color-mode="dark"] .api-info-warn { border-color: #f59e0b; }
    .reg-meter-hint strong { color: var(--text-color); font-weight: 700; }
    .reg-meter-fill { height: 100%; background: #16a34a; border-radius: 999px; transition: width 0.3s ease; }
    .reg-warn .reg-meter-fill { background: #d97706; }
    .reg-full .reg-meter-fill { background: #dc2626; }
    html[data-color-mode="dark"] .del-warn,
    html[data-color-mode="dark"] .del-flag { color: #f59e0b; }
    html[data-color-mode="dark"] .del-option.is-active { border-color: #ef4444; box-shadow: inset 0 0 0 1px #ef4444; }
    html[data-color-mode="dark"] .del-radio { color: #ef4444; }
    html[data-color-mode="dark"] .owner-chip { background: #64748b; }
    html[data-color-mode="dark"] .reg-meter-fill { background: #22c55e; }
    html[data-color-mode="dark"] .reg-warn .reg-meter-fill { background: #f59e0b; }
    html[data-color-mode="dark"] .reg-full .reg-meter-fill,
    html[data-color-mode="dark"] .reg-meter-flag { background: #ef4444; }

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

    /* Vivid status cards — each log entry's border + hue shadow encode pass/fail/skip
       at a glance (matches config-view). Dark keeps the hue border (functional color). */
    .log-entry {
      padding: 12px 14px;
      background: var(--card-bg);
      border: 2px solid var(--border-color);
      border-radius: 8px;
      box-shadow: 0 1px 2px rgba(18, 42, 66, 0.06), 0 4px 14px -8px rgba(18, 42, 66, 0.12);
      font-size: 12px;
      transition: box-shadow 0.2s ease;
    }
    .log-entry:hover { box-shadow: 0 8px 22px -10px rgba(29, 78, 216, 0.25); }
    .log-entry.cv-log-pass { border-color: #16a34a; box-shadow: 0 4px 14px -6px rgba(22, 163, 74, 0.30); }
    .log-entry.cv-log-fail { border-color: #dc2626; box-shadow: 0 4px 14px -6px rgba(220, 38, 38, 0.30); }
    .log-entry.cv-log-skip { border-color: #475569; box-shadow: 0 4px 14px -6px rgba(71, 85, 105, 0.26); }
    html[data-color-mode="dark"] .log-entry {
      border-width: 1px;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.5), 0 6px 20px -12px rgba(0, 0, 0, 0.5);
    }
    html[data-color-mode="dark"] .log-entry.cv-log-pass { border-color: #22c55e; }
    html[data-color-mode="dark"] .log-entry.cv-log-fail { border-color: #ef4444; }
    html[data-color-mode="dark"] .log-entry.cv-log-skip { border-color: #64748b; }

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
    /* Execution-log source + honesty flag chips — solid saturated fills, white text,
       same idiom as .log-type-badge. Source = where it ran; flags = honest truths. */
    .log-src, .log-flag {
      display: inline-flex; align-items: center; padding: 2px 7px; border-radius: 6px;
      font-size: 9px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase;
      color: #ffffff; white-space: nowrap; flex-shrink: 0;
    }
    .log-src-runtime { background: #475569; }
    .log-src-async   { background: #4f46e5; }
    /* amber/orange/cyan need dark ink for WCAG AA — white fails on these hues at 9px
       (same decision the repo already made for .job-status.* dark below). */
    .log-src-test    { background: #d97706; color: #2a1602; }
    .log-flag-simulated      { background: #0891b2; color: #04141d; }
    .log-flag-transientError { background: #dc2626; }
    .log-flag-capped         { background: #ea580c; color: #2a1602; }
    html[data-color-mode="dark"] .log-src-runtime { background: #64748b; }
    html[data-color-mode="dark"] .log-src-async   { background: #6366f1; }
    html[data-color-mode="dark"] .log-src-test    { background: #f59e0b; color: #2a1602; }
    html[data-color-mode="dark"] .log-flag-simulated      { background: #22d3ee; color: #04141d; }
    html[data-color-mode="dark"] .log-flag-transientError { background: #ef4444; }
    html[data-color-mode="dark"] .log-flag-capped         { background: #fb923c; color: #2a1602; }
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
    /* Clickable issue key — jump to the Jira issue a log fired on (debug-from-log).
       An inline link affordance (bottom underline on hover), never a left rail/tint. */
    .log-issue-link {
      background: none;
      border: none;
      border-bottom: 1px solid transparent;
      padding: 0;
      cursor: pointer;
      transition: border-color 0.15s ease, opacity 0.15s ease;
    }
    .log-issue-link:hover { border-bottom-color: var(--primary-color); opacity: 0.85; }
    .log-issue-link:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; border-radius: 2px; }

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
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 8px;
    }
    /* Paginated logs (Logs tab): no inner scroll — the page bounds the height,
       and the pagination control pages through the 50-entry window. */
    .logs-list-paged { display: flex; flex-direction: column; gap: 8px; padding: 8px; }
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
    .job-status.queued { background: #0891b2; color: #04141d; }
    .job-status.running { background: #06b6d4; color: #04141d; }
    .job-status.done { background: #16a34a; }
    .job-status.error { background: #dc2626; }
    .job-status.cancelled { background: #475569; }
    .job-status.stalled { background: #d97706; color: #2a1602; }
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
      color: #04141d;
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
    .rule-job-chip.running { background: #06b6d4; color: #04141d; }
    .rule-job-chip.queued { background: #0891b2; color: #04141d; }
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

    /* Accessible alert idiom (mirrors config-view): neutral card + 2px hue border + hue
       shadow; no pastel/ADG washes. error/success here are overridden by the copied-component
       block below but kept on-palette so injection order can never resurface a faded tint.
       .alert-warning is the LIVE warning (not in the copied block) — documented amber, ink text. */
    .alert-error {
      background: var(--card-bg);
      border-color: var(--error-color);
      border-width: 2px;
      color: var(--error-color);
      box-shadow: 0 4px 12px -4px rgba(220, 38, 38, 0.35);
    }

    .alert-success {
      background: var(--card-bg);
      border-color: var(--success-color);
      border-width: 2px;
      color: var(--text-color);
      box-shadow: 0 4px 12px -4px rgba(22, 163, 106, 0.35);
    }

    .alert-warning {
      background: var(--card-bg);
      border-color: #d97706;
      border-width: 2px;
      color: var(--text-color);
      box-shadow: 0 4px 12px -4px rgba(217, 119, 6, 0.32);
    }

    html[data-color-mode="dark"] .alert-warning {
      border-color: #f59e0b;
      box-shadow: 0 4px 12px -4px rgba(245, 158, 11, 0.32);
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
      flex-wrap: wrap;
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

    /* Searchable select = COMBOBOX: while the menu is open the trigger IS the search
       box. There used to be a second search input inside the panel, so a field
       rendered as two identical-looking bars stacked on each other and only the
       lower one accepted typing. The wrapper keeps every .dropdown-trigger visual;
       the input inside is chrome-free so it reads as one control, not a field
       nested inside a field. */
    .dropdown-trigger.dropdown-combobox { cursor: text; display: flex; align-items: center; }
    .dropdown-combobox-input {
      flex: 1 1 auto; min-width: 0; width: 100%;
      border: 0; outline: none; padding: 0; margin: 0;
      background: transparent; color: var(--text-color);
      font: inherit; line-height: inherit;
    }
    .dropdown-combobox-input::placeholder { color: var(--text-muted); }
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
      to { opacity: 1; transform: none; }
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
      to { opacity: 1; transform: none; }
    }


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
    /* Keyboard focus indicator — the trigger is now focusable (a11y). */
    .tooltip-wrap:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; border-radius: 4px; }
    .tooltip-wrap:focus-visible .tooltip-icon { opacity: 1; }
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
    /* The wizard is a MODAL now (see WizardShell in AddRuleWizard.jsx), so it gets
       the shared .pf-modal panel. It is wider than the delete/export dialogs
       because step 5 hosts full rule-config forms, and it scrolls inside itself —
       the Forge iframe viewport is only ~770px tall. */
    .wiz-overlay { padding: 32px 16px; }
    .wizard.wiz-dialog { margin-bottom: 0; }
    .pf-modal.wiz-dialog {
      max-width: 960px; padding: 0; overflow: hidden;
      display: flex; flex-direction: column;
      max-height: calc(100vh - 64px);
    }
    .wiz-dialog .wizard-header { flex: 0 0 auto; }
    .wiz-dialog .wizard-body { flex: 1 1 auto; overflow-y: auto; }
    .wiz-dialog .wiz-footer { flex: 0 0 auto; }
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
    .wiz-status-from { background: var(--input-bg); color: var(--text-secondary); border: 1px solid var(--border-color); }
    .wiz-status-to { background: var(--primary-color); color: #fff; }
    .wiz-status-initial { background: var(--success-color); color: #fff; }
    .wiz-cogni-badge {
      font-size: 9px; padding: 2px 6px; border-radius: 4px; font-weight: 600;
      background: var(--primary-color); color: #fff; letter-spacing: 0.3px;
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
      font-size: 11px; font-weight: 700; color: #fff;
      background: var(--primary-color); padding: 2px 8px; border-radius: 4px;
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
      background: var(--input-bg); border: 1px solid var(--border-color);
    }
    .wiz-prior-var {
      font-size: 11px; padding: 2px 6px; border-radius: 3px;
      background: var(--code-bg); color: var(--text-color);
    }
    .wiz-test-result {
      margin-top: 8px; padding: 10px 12px; border-radius: 8px;
    }
    .wiz-test-pass { border: 2px solid var(--success-color); background: var(--card-bg); box-shadow: 0 4px 12px -4px rgba(22, 163, 106, 0.35); }
    .wiz-test-fail { border: 2px solid var(--error-color); background: var(--card-bg); box-shadow: 0 4px 12px -4px rgba(220, 38, 38, 0.35); }
    .wiz-test-skip { border: 2px solid #475569; background: var(--card-bg); }
    html[data-color-mode="dark"] .wiz-test-skip { border-color: #64748b; }
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
      background: var(--success-color); margin-bottom: 12px;
    }
    .wiz-success-title { font-size: 16px; font-weight: 700; margin-bottom: 4px; }
    .wiz-success-text { font-size: 13px; color: var(--text-secondary); margin-bottom: 16px; }
    .wiz-add-step-btn {
      width: 100%; padding: 8px; margin-bottom: 14px; border: 1px dashed var(--border-color);
      border-radius: 8px; background: transparent; color: var(--text-secondary);
      cursor: pointer; font-size: 12px; transition: all 0.15s ease;
    }
    .wiz-add-step-btn:hover { border-color: var(--primary-color); color: var(--primary-color); background: var(--hover-bg); }
    .wiz-add-step-btn:disabled { opacity: 0.4; cursor: default; }
    .wiz-divider { border-top: 1px solid var(--border-color); padding-top: 12px; margin-bottom: 14px; }

    /* === Global Animations & Transitions === */

    /* Section entrance — staggered fade-in + slide up */
    .section { animation: sectionFadeIn 0.3s ease both; }
    @keyframes sectionFadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: none; }
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
      to { opacity: 1; transform: none; }
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
      to { opacity: 1; transform: none; }
    }

    /* Wizard step card entrance */
    .wiz-step-card {
      animation: stepCardFadeIn 0.2s ease both;
    }
    @keyframes stepCardFadeIn {
      from { opacity: 0; transform: scale(0.98); }
      to { opacity: 1; transform: none; }
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
      to { opacity: 1; transform: none; }
    }
    .wiz-success-icon {
      animation: successCheckmark 0.5s ease 0.2s both;
    }
    @keyframes successCheckmark {
      0% { opacity: 0; transform: scale(0.5) rotate(-20deg); }
      60% { transform: scale(1.1) rotate(5deg); }
      100% { opacity: 1; transform: none; }
    }

    /* Test result entrance */
    .wiz-test-result {
      animation: testResultSlide 0.2s ease both;
    }
    @keyframes testResultSlide {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: none; }
    }

    /* Log entry entrance — subtle fade (the card border/shadow is defined above). */
    .log-entry {
      animation: logEntryFade 0.2s ease both;
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
      to { opacity: 1; transform: none; }
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

    /* Two-gate narration — where memories actually go given the current toggle state.
       Solid hue border + solid eyebrow chip (white text), never a left rail / faded tint. */
    .mem-gate-banner {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 10px 14px;
      margin-bottom: 4px;
      border: 2px solid var(--mem-gate-hue);
      border-radius: 8px;
      background: var(--card-bg);
    }
    .mem-gate-eyebrow {
      align-self: flex-start;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.5px;
      color: #ffffff;
      background: var(--mem-gate-hue);
      padding: 2px 8px;
      border-radius: 10px;
    }
    .mem-gate-label { font-size: 13px; font-weight: 700; color: var(--text-color); }
    .mem-gate-text { font-size: 12px; color: var(--text-secondary); }
    .mem-gate-both { --mem-gate-hue: #0d9488; }
    .mem-gate-design { --mem-gate-hue: #d97706; }
    .mem-gate-off { --mem-gate-hue: #475569; }
    html[data-color-mode="dark"] .mem-gate-both { --mem-gate-hue: #14b8a6; }
    html[data-color-mode="dark"] .mem-gate-design { --mem-gate-hue: #f59e0b; }
    html[data-color-mode="dark"] .mem-gate-off { --mem-gate-hue: #64748b; }

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
    .memories-admin-src-test { background: #d97706; color: #2a1602; }
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
    html[data-color-mode="dark"] .memories-admin-src-test { background: #f59e0b; color: #2a1602; }
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
      --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
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
  
    /* === Listeners · Scheduled Jobs · API access (solid hues: listeners #ea580c, jobs #0891b2, agent #7c3aed, script #475569) === */
    .btn-solid { background: var(--primary-color); color: #fff; border-color: var(--primary-color); font-weight: 600; }
    .btn-solid:hover { filter: brightness(1.08); color: #fff; }
    .btn-solid:disabled { opacity: 0.6; }
    .lst-count { display: inline-block; margin-left: 8px; padding: 1px 8px; border-radius: 999px; background: #ea580c; color: #fff; font-size: 11px; font-weight: 700; vertical-align: middle; }
    .lst-editor .card.lst-card { padding: 20px; margin-bottom: 16px; }
    .lst-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    @media (max-width: 900px) { .lst-grid { grid-template-columns: 1fr; } }
    .lst-input { width: 100%; box-sizing: border-box; padding: 9px 12px; border: 1px solid var(--border-color); border-radius: var(--r-md, 8px); background: var(--input-bg); color: var(--text-color); font-size: 13px; }
    .lst-input:focus { outline: none; border-color: var(--primary-color); box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.25); }
    .lst-filters { display: flex; flex-direction: column; gap: 14px; padding: 14px; border: 1px solid var(--border-color); border-radius: var(--r-md, 8px); background: var(--card-bg); }
    .lst-filter { display: flex; flex-direction: column; gap: 6px; }
    .lst-filter-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-secondary); }
    .lst-check { display: flex; align-items: flex-start; gap: 10px; font-size: 13px; color: var(--text-color); cursor: pointer; }
    .lst-check input { margin-top: 3px; width: 16px; height: 16px; flex-shrink: 0; }
    .lst-options { display: flex; flex-direction: column; gap: 10px; margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--border-color); }
    .lst-builder { margin-top: 4px; }
    .lst-test-head { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
    .lst-test-row { display: flex; flex-wrap: wrap; gap: 14px; align-items: flex-end; }
    .lst-test-field { flex: 1 1 220px; min-width: 200px; }
    .lst-test-actions { display: flex; gap: 8px; }
    .lst-sample { margin-top: 12px; }
    .lst-empty { padding: 40px 24px; }
    .lst-empty-title { font-size: 15px; font-weight: 700; color: var(--text-color); margin-bottom: 8px; }
    .lst-table-scroll { overflow-x: auto; }
    .lst-table td { vertical-align: middle; }
    .lst-row-off .lst-name { color: var(--text-muted); }
    .lst-name { font-weight: 600; margin-right: 8px; }
    .lst-sim, .lst-aic { display: inline-block; margin-left: 6px; padding: 2px 6px; border-radius: 3px; font-size: 9px; font-weight: 700; color: #fff; letter-spacing: 0.04em; }
    .lst-sim { background: #d97706; }
    .lst-aic { background: #7c3aed; }
    .lst-evs { display: inline-flex; flex-wrap: wrap; gap: 4px; align-items: center; }
    .lst-more { font-size: 11px; font-weight: 700; color: var(--text-secondary); }
    .lst-scope { font-size: 12px; color: var(--text-secondary); }
    .type-badge.lst-mode-agent { background: #7c3aed; color: #fff; }
    .type-badge.lst-mode-script { background: #475569; color: #fff; }
    .job-scope { display: flex; gap: 12px; align-items: flex-end; }
    .job-scope .lst-input { flex: 1; }
    .job-scope-max { display: flex; flex-direction: column; gap: 4px; }
    .job-sched { display: flex; flex-direction: column; gap: 2px; }
    .job-sched-desc { font-weight: 600; }
    .job-sched-zone { font-size: 11px; color: var(--text-secondary); }
    /* log badges */
    .log-type-badge.lt-listener { background: #ea580c; color: #fff; }
    .log-type-badge.lt-job { background: #0891b2; color: #fff; }
    .log-lines { margin-top: 8px; font-size: 12px; }
    .log-lines summary { cursor: pointer; font-weight: 600; color: var(--text-secondary); }
    .log-lines-pre { margin: 6px 0 0; padding: 10px; border-radius: var(--r-md, 8px); background: #0f172a; color: #e2e8f0; font-size: 11px; line-height: 1.45; max-height: 320px; overflow: auto; white-space: pre-wrap; word-break: break-word; }
    /* mode switch */
    .mode-switch { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    @media (max-width: 700px) { .mode-switch { grid-template-columns: 1fr; } }
    .mode-btn { display: flex; flex-direction: column; gap: 4px; padding: 14px 16px; border: 2px solid var(--border-color); border-radius: var(--r-md, 8px); background: var(--card-bg); color: var(--text-color); text-align: left; cursor: pointer; transition: border-color 0.15s, background 0.15s; }
    .mode-btn-title { font-size: 14px; font-weight: 700; }
    .mode-btn-sub { font-size: 12px; color: var(--text-secondary); line-height: 1.4; }
    .mode-btn.mode-script.on { border-color: #475569; background: #475569; color: #fff; }
    .mode-btn.mode-agent.on { border-color: #7c3aed; background: #7c3aed; color: #fff; }
    .mode-btn.on .mode-btn-sub { color: rgba(255, 255, 255, 0.85); }
    /* chips */
    .chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 6px 8px; min-height: 38px; box-sizing: border-box; border: 1px solid var(--border-color); border-radius: var(--r-md, 8px); background: var(--input-bg); }
    .chips-chip { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 999px; background: #475569; color: #fff; font-size: 12px; font-weight: 600; }
    .chips-chip-project { background: #16a34a; }
    .chips-x { border: none; background: transparent; color: inherit; font-size: 14px; line-height: 1; cursor: pointer; padding: 0 2px; }
    .chips-input { flex: 1; min-width: 140px; border: none; background: transparent; color: var(--text-color); font-size: 13px; outline: none; }
    .chips-none { font-size: 12px; color: var(--text-muted); }
    .projpick { display: flex; flex-direction: column; gap: 8px; }
    .projpick-add { max-width: 420px; }
    /* run stats + results */
    .runstat { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); }
    .runstat-never { color: var(--text-muted); }
    .runstat-dot { width: 9px; height: 9px; border-radius: 50%; background: #64748b; }
    .runstat-ok .runstat-dot { background: #16a34a; }
    .runstat-err .runstat-dot { background: #dc2626; }
    .runstat-skip .runstat-dot { background: #d97706; }
    .runres { margin-top: 14px; padding: 14px; border: 1px solid var(--border-color); border-radius: var(--r-md, 8px); background: var(--card-bg); }
    .runres-head { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
    .runres-badge { padding: 3px 9px; border-radius: 4px; font-size: 11px; font-weight: 800; letter-spacing: 0.05em; color: #fff; }
    .runres-badge.ok { background: #16a34a; }
    .runres-badge.skip { background: #d97706; }
    .runres-badge.err { background: #dc2626; }
    .runres-title { font-weight: 600; font-size: 13px; }
    .runres-ms { font-size: 11px; color: var(--text-secondary); padding: 2px 6px; border-radius: 3px; border: 1px solid var(--border-color); }
    .runres-reason { margin-top: 8px; font-size: 13px; line-height: 1.5; }
    .runres-gate, .runres-rec { margin-top: 6px; font-size: 12px; color: var(--text-secondary); }
    .runres-issues, .runres-tools { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
    .runres-issue, .runres-tool { padding: 2px 7px; border-radius: 3px; font-size: 11px; font-weight: 700; color: #fff; background: #16a34a; }
    .runres-issue.err, .runres-tool.err { background: #dc2626; }
    .runres-tool { background: #7c3aed; }
    .runres-details { margin-top: 8px; font-size: 12px; }
    .runres-details summary { cursor: pointer; font-weight: 600; color: var(--text-secondary); }
    .runres-changes { margin: 6px 0 0; padding-left: 18px; }
    .runres-pre { margin: 6px 0 0; padding: 10px; border-radius: var(--r-md, 8px); background: #0f172a; color: #e2e8f0; font-size: 11px; line-height: 1.45; max-height: 360px; overflow: auto; white-space: pre-wrap; word-break: break-word; }
    .recent-logs { display: flex; flex-direction: column; }
    .recent-logs .runres { margin-top: 8px; }
    /* event picker */
    .evp-selected { display: flex; flex-wrap: wrap; gap: 6px; min-height: 30px; margin-bottom: 8px; }
    .evp-none { font-size: 12px; color: var(--text-muted); }
    .evp-chip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 999px; color: #fff; font-size: 12px; font-weight: 600; }
    .evp-chip-sm { padding: 1px 7px; font-size: 11px; }
    .evp-chip-vol { padding: 0 5px; border-radius: 3px; background: #dc2626; font-size: 9px; font-weight: 800; letter-spacing: 0.04em; }
    .evp-chip-x { border: none; background: transparent; color: #fff; font-size: 14px; line-height: 1; cursor: pointer; padding: 0; }
    .evp-search { width: 100%; box-sizing: border-box; padding: 8px 12px; border: 1px solid var(--border-color); border-radius: var(--r-md, 8px); background: var(--input-bg); color: var(--text-color); font-size: 13px; margin-bottom: 8px; }
    .evp-groups { border: 1px solid var(--border-color); border-radius: var(--r-md, 8px); overflow: hidden; max-height: 440px; overflow-y: auto; }
    .evp-group + .evp-group { border-top: 1px solid var(--border-color); }
    .evp-group-head { display: flex; align-items: center; justify-content: space-between; padding: 0 10px 0 0; background: var(--card-bg); }
    .evp-group-toggle { flex: 1; display: flex; align-items: center; gap: 8px; padding: 9px 12px; border: none; background: transparent; color: var(--text-color); font-size: 13px; font-weight: 700; cursor: pointer; text-align: left; }
    .evp-group-dot { width: 10px; height: 10px; border-radius: 3px; }
    .evp-group-count { margin-left: auto; font-size: 11px; font-weight: 700; color: var(--text-secondary); }
    .evp-caret { display: inline-block; transition: transform 0.15s; color: var(--text-muted); }
    .evp-caret.open { transform: rotate(180deg); }
    .evp-group-actions { display: flex; gap: 6px; }
    .evp-link { border: none; background: transparent; color: var(--primary-color); font-size: 11px; font-weight: 700; cursor: pointer; padding: 2px 4px; }
    .evp-rows { display: flex; flex-direction: column; }
    .evp-row { display: grid; grid-template-columns: 22px 1fr auto auto; gap: 10px; align-items: center; padding: 7px 12px; cursor: pointer; border-top: 1px solid var(--border-color); }
    .evp-row.on { background: rgba(37, 99, 235, 0.08); }
    .evp-row input { width: 15px; height: 15px; margin: 0; }
    .evp-row-main { display: flex; flex-direction: column; }
    .evp-row-label { font-size: 13px; font-weight: 600; }
    .evp-row-desc { font-size: 11px; color: var(--text-secondary); }
    .evp-vol { padding: 2px 6px; border-radius: 3px; background: #dc2626; color: #fff; font-size: 9px; font-weight: 800; letter-spacing: 0.04em; }
    .evp-row-id { font-size: 10px; color: var(--text-muted); }
    @media (max-width: 760px) { .evp-row { grid-template-columns: 22px 1fr; } .evp-row-id, .evp-vol { display: none; } }
    /* schedule picker */
    .schp-row { display: flex; flex-wrap: wrap; gap: 14px; align-items: flex-end; }
    .schp-field { display: flex; flex-direction: column; gap: 4px; }
    .schp-preset { min-width: 200px; }
    .schp-zone { min-width: 240px; flex: 1; }
    .schp-num { width: 64px; padding: 8px 10px; border: 1px solid var(--border-color); border-radius: var(--r-md, 8px); background: var(--input-bg); color: var(--text-color); font-size: 13px; }
    .schp-time { display: inline-flex; align-items: center; gap: 4px; }
    .schp-colon { font-weight: 700; }
    .schp-days { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
    .schp-day { padding: 6px 12px; border: 2px solid var(--border-color); border-radius: 999px; background: var(--card-bg); color: var(--text-color); font-size: 12px; font-weight: 700; cursor: pointer; }
    .schp-day.on { background: #0891b2; border-color: #0891b2; color: #fff; }
    .schp-custom { margin-top: 10px; }
    .schp-cron { width: 100%; box-sizing: border-box; padding: 9px 12px; border: 1px solid var(--border-color); border-radius: var(--r-md, 8px); background: var(--input-bg); color: var(--text-color); font-family: SFMono-Regular, Consolas, monospace; font-size: 13px; }
    .schp-cron.invalid { border-color: #dc2626; }
    .schp-preview { margin-top: 12px; padding: 12px 14px; border-radius: var(--r-md, 8px); background: #0891b2; color: #fff; }
    .schp-preview-error { background: #dc2626; }
    .schp-preview-head { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; font-weight: 700; font-size: 14px; }
    .schp-preview-cron { padding: 2px 6px; border-radius: 3px; background: rgba(0, 0, 0, 0.25); font-size: 12px; }
    .schp-preview-runs { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; align-items: center; }
    .schp-preview-label { font-size: 12px; font-weight: 600; opacity: 0.9; }
    .schp-preview-run { padding: 2px 8px; border-radius: 999px; background: rgba(255, 255, 255, 0.2); font-size: 12px; font-weight: 600; }
    /* agent config */
    .agc-textarea { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid var(--border-color); border-radius: var(--r-md, 8px); background: var(--input-bg); color: var(--text-color); font-size: 13px; line-height: 1.5; resize: vertical; }
    .agc-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    @media (max-width: 800px) { .agc-actions { grid-template-columns: 1fr; } }
    .agc-col { border: 1px solid var(--border-color); border-radius: var(--r-md, 8px); overflow: hidden; }
    .agc-col-head { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--card-bg); font-size: 12px; color: var(--text-secondary); font-weight: 600; }
    .agc-kind { padding: 2px 7px; border-radius: 3px; color: #fff; font-size: 10px; font-weight: 800; letter-spacing: 0.05em; }
    .agc-kind-read { background: #16a34a; }
    .agc-kind-write { background: #ea580c; }
    .agc-action { display: grid; grid-template-columns: 20px 1fr; gap: 10px; align-items: flex-start; padding: 8px 12px; border-top: 1px solid var(--border-color); cursor: pointer; }
    .agc-action.on { background: rgba(124, 58, 237, 0.1); }
    .agc-action input { margin-top: 2px; }
    .agc-action-main { display: flex; flex-direction: column; }
    .agc-action-label { font-size: 13px; font-weight: 600; }
    .agc-action-desc { font-size: 11px; color: var(--text-secondary); line-height: 1.4; }
    .agc-rounds { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .agc-rounds .label { margin: 0; }
    /* API access */
    .apx { padding: 20px; margin-top: 20px; }
    .apx-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
    .apx-title { font-size: 15px; font-weight: 700; }
    .apx-sub { font-size: 12px; color: var(--text-secondary); margin-top: 4px; line-height: 1.45; }
    .apx-badge { padding: 3px 8px; border-radius: 4px; background: #be123c; color: #fff; font-size: 10px; font-weight: 800; letter-spacing: 0.05em; flex-shrink: 0; }
    .apx-url { margin-bottom: 14px; }
    .apx-url-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .apx-code { padding: 6px 10px; border-radius: var(--r-md, 8px); background: #0f172a; color: #e2e8f0; font-size: 12px; word-break: break-all; }
    .apx-secret { background: #7c3aed; color: #fff; font-weight: 700; }
    .apx-new { display: flex; gap: 8px; margin-bottom: 12px; }
    .apx-input { flex: 1; max-width: 360px; padding: 8px 12px; border: 1px solid var(--border-color); border-radius: var(--r-md, 8px); background: var(--input-bg); color: var(--text-color); font-size: 13px; }
    .apx-fresh { padding: 12px 14px; border-radius: var(--r-md, 8px); background: #16a34a; color: #fff; margin-bottom: 12px; }
    .apx-fresh-title { font-weight: 700; margin-bottom: 8px; }
    .apx-fresh .btn-small { background: #fff; color: #0f172a; border-color: #fff; }
    .apx-table { margin-top: 8px; }
    .apx-examples { margin-top: 14px; font-size: 12px; }
    .apx-examples summary { cursor: pointer; font-weight: 700; color: var(--text-secondary); }
    .apx-pre { margin: 8px 0 0; padding: 12px; border-radius: var(--r-md, 8px); background: #0f172a; color: #e2e8f0; font-size: 11px; line-height: 1.5; overflow: auto; white-space: pre; }
    /* dark mode — one shade lighter per hue */
    html[data-color-mode="dark"] .lst-count { background: #f97316; }
    html[data-color-mode="dark"] .lst-sim { background: #f59e0b; }
    html[data-color-mode="dark"] .lst-aic, html[data-color-mode="dark"] .type-badge.lst-mode-agent, html[data-color-mode="dark"] .mode-btn.mode-agent.on, html[data-color-mode="dark"] .runres-tool, html[data-color-mode="dark"] .apx-secret { background: #8b5cf6; border-color: #8b5cf6; }
    html[data-color-mode="dark"] .type-badge.lst-mode-script, html[data-color-mode="dark"] .mode-btn.mode-script.on, html[data-color-mode="dark"] .chips-chip { background: #64748b; border-color: #64748b; }
    html[data-color-mode="dark"] .chips-chip-project, html[data-color-mode="dark"] .runstat-ok .runstat-dot, html[data-color-mode="dark"] .runres-badge.ok, html[data-color-mode="dark"] .runres-issue, html[data-color-mode="dark"] .agc-kind-read, html[data-color-mode="dark"] .apx-fresh { background: #22c55e; }
    html[data-color-mode="dark"] .runres-badge.err, html[data-color-mode="dark"] .runres-issue.err, html[data-color-mode="dark"] .runres-tool.err, html[data-color-mode="dark"] .evp-vol, html[data-color-mode="dark"] .evp-chip-vol, html[data-color-mode="dark"] .schp-preview.schp-preview-error { background: #ef4444; }
    html[data-color-mode="dark"] .runres-badge.skip, html[data-color-mode="dark"] .runstat-skip .runstat-dot { background: #f59e0b; }
    html[data-color-mode="dark"] .log-type-badge.lt-listener, html[data-color-mode="dark"] .agc-kind-write { background: #f97316; }
    html[data-color-mode="dark"] .log-type-badge.lt-job, html[data-color-mode="dark"] .schp-day.on, html[data-color-mode="dark"] .schp-preview { background: #06b6d4; border-color: #06b6d4; }
    html[data-color-mode="dark"] .apx-badge { background: #e11d48; }
    html[data-color-mode="dark"] .evp-row.on { background: rgba(59, 130, 246, 0.18); }
    html[data-color-mode="dark"] .agc-action.on { background: rgba(139, 92, 246, 0.2); }
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

    /* Searchable select = COMBOBOX: while the menu is open the trigger IS the search
       box. There used to be a second search input inside the panel, so a field
       rendered as two identical-looking bars stacked on each other and only the
       lower one accepted typing. The wrapper keeps every .dropdown-trigger visual;
       the input inside is chrome-free so it reads as one control, not a field
       nested inside a field. */
    .dropdown-trigger.dropdown-combobox { cursor: text; display: flex; align-items: center; }
    .dropdown-combobox-input {
      flex: 1 1 auto; min-width: 0; width: 100%;
      border: 0; outline: none; padding: 0; margin: 0;
      background: transparent; color: var(--text-color);
      font: inherit; line-height: inherit;
    }
    .dropdown-combobox-input::placeholder { color: var(--text-muted); }

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

    /* Accessible alert idiom (mirrors config-view): neutral card + 2px hue border + hue
       shadow. Green/amber fail WCAG as text, so success/warning body text is --text-color;
       error keeps red text (passes). No pastel washes. */
    .alert-error {
      background: var(--card-bg);
      border-color: var(--error-color);
      border-width: 2px;
      color: var(--error-color);
      box-shadow: 0 4px 12px -4px rgba(220, 38, 38, 0.35);
    }

    .alert-success {
      background: var(--card-bg);
      border-color: var(--success-color);
      border-width: 2px;
      color: var(--text-color);
      box-shadow: 0 4px 12px -4px rgba(22, 163, 106, 0.35);
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
    /* Keyboard focus indicator — the trigger is now focusable (a11y). */
    .tooltip-wrap:focus-visible { outline: 2px solid var(--primary-color); outline-offset: 2px; border-radius: 4px; }
    .tooltip-wrap:focus-visible .tooltip-icon { opacity: 1; }

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

    /* Tested-state chip on a static-PF step — solid hue, white text, no rail/tint. */
    .pf-test-chip {
      font-size: 10px;
      font-weight: 700;
      padding: 1px 8px;
      border-radius: 10px;
      color: #ffffff;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .pf-test-pass { background: #16a34a; }
    .pf-test-stale { background: #d97706; color: #2a1602; }
    .pf-test-untested { background: #475569; }
    html[data-color-mode="dark"] .pf-test-pass { background: #22c55e; }
    html[data-color-mode="dark"] .pf-test-stale { background: #f59e0b; color: #2a1602; }
    html[data-color-mode="dark"] .pf-test-untested { background: #64748b; }

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
      color: var(--text-secondary);
      background: var(--input-bg);
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
      to { opacity: 1; transform: none; }
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
      to { opacity: 1; transform: none; }
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
    .review-item-warning { background: #d97706; color: #2a1602; }
    html[data-color-mode="dark"] .review-item-warning { background: #f59e0b; color: #2a1602; }
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

    /* Solid status headers (matches .test-result-header). Skip = primary blue, not slate:
       the .test-badge-skip inside is slate #475569 and would vanish on a slate header. */
    .st-update .st-result-header { background: var(--success-color); color: #ffffff; }
    .st-skip .st-result-header { background: var(--primary-color); color: #ffffff; }
    .st-error .st-result-header { background: var(--error-color); color: #ffffff; }
    .st-update .st-result-header .test-result-meta,
    .st-skip .st-result-header .test-result-meta,
    .st-error .st-result-header .test-result-meta,
    .st-update .st-result-header .test-dismiss,
    .st-skip .st-result-header .test-dismiss,
    .st-error .st-result-header .test-dismiss { color: rgba(255, 255, 255, 0.9); }

    .test-badge-skip {
      background: #475569;
      color: #ffffff;
    }
    html[data-color-mode="dark"] .test-badge-skip { background: #64748b; }

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
    .skill-cat-adf { background: #d97706; color: #2a1602; }
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
    .memory-src-test { background: #d97706; color: #2a1602; }
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
    html[data-color-mode="dark"] .skill-cat-adf { background: #f59e0b; color: #2a1602; }
    html[data-color-mode="dark"] .skill-cat-workflow { background: #22c55e; }
    html[data-color-mode="dark"] .skill-cat-other { background: #64748b; }
    html[data-color-mode="dark"] .skill-auto-chip { background: #8b5cf6; }
    html[data-color-mode="dark"] .btn-save-skill { background: #8b5cf6; }
    html[data-color-mode="dark"] .builtin-badge { background: #64748b; }
    html[data-color-mode="dark"] .memory-src-user { background: #3b82f6; }
    html[data-color-mode="dark"] .memory-src-test { background: #f59e0b; color: #2a1602; }
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
      color: #2a1602;
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
    html[data-color-mode="dark"] .truncation-warning { background: #f59e0b; color: #2a1602; }

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
    /* Active-provider connection HealthChip verdicts — solid hue, white text, no rail/tint. */
    .hc-chip {
      font-size: 10px;
      font-weight: 700;
      padding: 2px 9px;
      border-radius: 10px;
      color: #ffffff;
      white-space: nowrap;
    }
    .hc-ok { background: #16a34a; }
    .hc-warn { background: #d97706; color: #2a1602; }
    .hc-err { background: #dc2626; }
    html[data-color-mode="dark"] .hc-ok { background: #22c55e; }
    html[data-color-mode="dark"] .hc-warn { background: #f59e0b; color: #2a1602; }
    html[data-color-mode="dark"] .hc-err { background: #ef4444; }
    .hc-hint { font-size: 11px; color: var(--text-secondary); }

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
      background: #d97706; color: #2a1602; font-weight: 600; font-size: 12.5px;
      padding: 9px 12px; border-radius: 8px; margin-bottom: 16px; line-height: 1.45;
    }
    html[data-color-mode="dark"] .pr-note { background: #f59e0b; color: #2a1602; }
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
    .recipe-note { background: #d97706; color: #2a1602; font-weight: 600; font-size: 12px; padding: 8px 10px; border-radius: 6px; margin-bottom: 10px; }
    html[data-color-mode="dark"] .recipe-note { background: #f59e0b; color: #2a1602; }
    .gen-meta-chip.gmc-recipe { background: #4f46e5; color: #fff; }
    html[data-color-mode="dark"] .gen-meta-chip.gmc-recipe { background: #6366f1; }
  `;
  document.head.appendChild(style);
};


let invoke;
let router;

const TABS = [
  { key: "rules", label: "Rules" },
  { key: "listeners", label: "Listeners" },
  { key: "jobs", label: "Scheduled Jobs" },
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
  // One glossary chip per rule type the table can show. The banner names all three,
  // so all three need an explanation — it previously defined only "post-function".
  // The condition chip must stay consistent in SUBSTANCE with config-ui's condition
  // callout (App.js ~3617): both say Jira evaluates conditions itself, so they use
  // the non-AI rule types only. The phrasings differ (this is a one-line chip, that
  // is a full callout) — keep the claim aligned, not the words.
  rules: { eyebrow: "RULES", what: "Every AI validator, condition, and post-function you've configured, across all workflows — toggle, edit, delete, or explain any rule from here.",
    terms: [
      { label: "validator", def: "A rule that runs when someone tries to complete a transition. It can block the transition and show your message. Validators are enforced everywhere — the issue view, REST, automation and bulk changes." },
      { label: "condition", def: "A rule that hides a transition when its criteria aren't met. Forge conditions are evaluated by Jira itself rather than by an AI model, so conditions use the non-AI rule types only." },
      { label: "post-function", def: "A rule that runs AFTER a transition completes — it writes a field with AI, posts a comment, or runs saved sandboxed JavaScript." },
    ] },
  listeners: { eyebrow: "LISTENERS", what: "Rules that react to Jira events — issue created, comment added, sprint started, version released, 68 events in all — with AI-generated code or an AI agent. No workflow transition needed.",
    terms: [
      { label: "AI condition", def: "A plain-language gate (\"the comment is a customer complaint\") the AI evaluates before the listener runs — one cheap classification call." },
      { label: "AI agent", def: "The no-code mode: you write instructions, tick the actions the agent may take, and the AI decides and acts through those actions only." },
    ] },
  jobs: { eyebrow: "SCHEDULED JOBS", what: "Rules that run on a cron schedule — every 5 minutes up to monthly, in any time zone — once, or per issue of a JQL scope (escalation-style). Same code steps or AI agent as listeners.",
    terms: [{ label: "scope", def: "A JQL query the job runs against; each matching issue becomes the current issue for its own run, sharing the ~100 s budget." }] },
  logs: { eyebrow: "EXECUTION LOGS", what: "A running history of what your rules did on real transitions: pass or fail, the AI's reasoning, and any changes a post-function made." },
  docs: { eyebrow: "DOCUMENTATION", what: "Reference docs the AI reads when it generates code and validates fields. Add your own API notes or conventions; the built-in guides come seeded.",
    terms: [{ label: "provenance", def: "The record of exactly which docs, skills, and memories the AI drew on when it generated a step's code — shown as chips on each rule." }] },
  skills: { eyebrow: "SKILLS", what: "Reusable instruction packs the AI applies when generating post-function code — auto-matched by keyword, or picked per step.",
    terms: [{ label: "auto-match", def: "On top of any skills you pick, the AI automatically applies up to 2 whose keywords match your step's description." }] },
  memories: { eyebrow: "MEMORIES", what: "Short facts this instance has learned from fixes and your corrections. They sharpen future AI output; runtime use is opt-in (per-transition token cost).",
    terms: [
      { label: "distill", def: "When a production failure is new, the AI writes a short (≤400-char) lesson from it and saves it as a memory — no repeat AI cost for known errors." },
      { label: "runtime injection", def: "Feeding memories into live validators and post-functions on every transition. Opt-in, because it adds tokens to each run." },
    ] },
  permissions: { eyebrow: "PERMISSIONS", what: "Who can create and edit CogniRunner rules on this site. App admins manage the roster; editors manage rules." },
  settings: { eyebrow: "SETTINGS", what: "Your AI provider, API key, and model, plus the MCP tools the agent can call. Keys are stored in Forge storage, never in environment variables.",
    terms: [
      { label: "MCP", def: "Model Context Protocol — external tool servers (web search, library docs, doc-reader) that CogniRunner lets the AI agent call mid-run." },
      { label: "agentic", def: "When a validator lets the AI run tools (JQL search, web search) to gather evidence before it decides pass or fail." },
    ] },
};

// Execution Logs page size (logs are capped at 50 server-side, so this paginates
// the recent window client-side).
const LOGS_PAGE_SIZE = 10;

// Configured Rules page sizes. The registry holds up to 500 rules and every row is
// tall (four stacked actions), so rendering them all made a 76,000px page that was
// impossible to navigate — and any layout change above the table yanked the rows
// out from under the cursor. Fixed choices only, per the owner's spec.
const RULES_PAGE_SIZES = [10, 20];
const RULES_PAGE_SIZE_DEFAULT = 10;

// Newest first. A rule you just created or edited must be on page 1 — the sort key
// is the same `updatedAt` the Updated column shows, so the order is always
// explainable from what's on screen. createdAt is the fallback for legacy rows that
// predate updatedAt, and the id keeps the sort stable (never NaN-shuffled) when two
// rules share a timestamp, which bulk imports routinely produce.
const ruleSortTime = (c) => {
  // A registry row's timestamps are epoch-ms NUMBERS, not ISO strings —
  // slimRegistryRow rewrites them on write to halve the bytes at 500 rows (see
  // src/shared/registry-limits.js), and rows can hold either form mid-migration.
  // `Date.parse(1783000000000)` is NaN, which silently scored EVERY row -Infinity
  // and left the table in id order on the real site while the mock fixture's ISO
  // strings sorted fine. Mirror the backend's rowTimeMs: accept both.
  const raw = c?.updatedAt ?? c?.createdAt;
  const t = typeof raw === "number" ? raw : Date.parse(raw || "");
  return Number.isFinite(t) ? t : -Infinity;
};
const byNewestFirst = (a, b) => {
  const d = ruleSortTime(b) - ruleSortTime(a);
  return d !== 0 ? d : String(a.id).localeCompare(String(b.id));
};

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
  listener: "Listener", scheduledjob: "Scheduled Job",
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
  const [showPortability, setShowPortability] = useState(false);
  const [typeFilter, setTypeFilter] = useState("all");
  // Site-wide registry pressure {count, max, bytes, maxBytes, level} — deliberately
  // NOT narrowed by the "My Rules" filter: the cap is shared by everyone.
  const [registryMeter, setRegistryMeter] = useState(null);
  // Rules selected for bulk delete. Cleared on every refetch and on any filter
  // change, so a row that scrolled out of the current view can never be deleted.
  const [selectedRuleIds, setSelectedRuleIds] = useState(() => new Set());
  const [deleteTargetIds, setDeleteTargetIds] = useState(null);
  // Configured Rules pagination. Page is 0-based and is reset by every input that
  // changes WHICH rows exist (search, type filter, scope filter, page size, a
  // refetch) — landing on page 7 of a 2-page result shows an empty table.
  const [rulesPage, setRulesPage] = useState(0);
  const [rulesPageSize, setRulesPageSize] = useState(RULES_PAGE_SIZE_DEFAULT);
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
        setSelectedRuleIds(new Set());
        if (result.registry) setRegistryMeter(result.registry);
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
  // REST-automation reference: this install's extension ARIs and caps. Fetched
  // lazily on first open — most admins never need it.
  const [apiInfo, setApiInfo] = useState(null);
  const [apiInfoOpen, setApiInfoOpen] = useState(false);
  const [apiInfoLoading, setApiInfoLoading] = useState(false);
  const [apiInfoError, setApiInfoError] = useState(null);
  const [copiedAri, setCopiedAri] = useState(null);

  const fetchRuleApiInfo = async () => {
    if (!invoke) return;
    setApiInfoLoading(true);
    setApiInfoError(null);
    try {
      const r = await invoke("getRuleApiInfo");
      if (r && r.success) setApiInfo(r);
      else setApiInfoError(r?.error || "Couldn't read this installation's API details.");
    } catch (e) {
      setApiInfoError(e.message || "Couldn't read this installation's API details.");
    }
    setApiInfoLoading(false);
  };

  // An ARI is long and error-prone to retype, and mistyping one produces a rule
  // that attaches fine and never runs. Clipboard access can be denied inside the
  // Forge iframe, so fall back to selecting the text for a manual copy rather
  // than failing silently.
  const copyAri = async (ari) => {
    try {
      await navigator.clipboard.writeText(ari);
      setCopiedAri(ari);
      setTimeout(() => setCopiedAri((c) => (c === ari ? null : c)), 2000);
    } catch {
      const el = document.querySelector(`.api-ari[data-ari="${ari}"]`) || null;
      if (el && window.getSelection) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
      showToast("Couldn't reach the clipboard — the ARI is selected, press ⌘C / Ctrl+C", "error");
    }
  };
  // What the last "Register all" actually did, including how many it had to skip.
  const [registerOutcome, setRegisterOutcome] = useState(null);

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
    setRegisterOutcome(null);
    try {
      // Stamp this site's base URL onto each discovered rule so its stored config can build the
      // Edit deep-link (the backend scan can't know the site's URL; the frontend can).
      const rules = siteUrl ? discovered.map((d) => ({ ...d, siteUrl })) : discovered;
      // Chunked: one invoke per 50 rules keeps each call inside the 25s resolver
      // budget on a large instance. Stop the moment the registry reports it is
      // full — every further call would just be refused.
      const CHUNK = 50;
      const total = { added: 0, updated: 0, skipped: 0, skippedSize: 0 };
      let capped = false;
      for (let i = 0; i < rules.length && !capped; i += CHUNK) {
        const r = await invoke("registerDiscoveredRules", { rules: rules.slice(i, i + CHUNK) });
        if (!r || !r.success) throw new Error(r?.error || "register failed");
        total.added += r.added || 0;
        total.updated += r.updated || 0;
        total.skipped += r.skipped || 0;
        total.skippedSize += r.skippedSize || 0;
        if (r.capped) capped = true;
      }
      // Surface what actually happened. The old code discarded the whole result,
      // so a run that silently skipped hundreds of rules at the cap looked like a
      // clean success.
      setRegisterOutcome({ ...total, capped });
      await scanDiscoveredRules(); // now-registered rows drop out
      await fetchConfigs(true);    // refresh the managed list
    } catch (e) {
      console.error("registerDiscoveredRules failed:", e);
      setRegisterOutcome({ error: e.message || "Registering failed" });
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

  // Mirrors the backend's canDeleteConfig, which is deliberately NARROWER than the
  // enable/disable gate: an ownerless row (legacy, or claimed by a workflow scan)
  // is toggleable by a scope-"own" editor but is not theirs to destroy.
  const canDeleteRow = (config) =>
    userRole === "admin"
    || (userRole === "editor" && (userScope === "all" || (!!config.createdBy && config.createdBy === accountId)));

  const toggleRuleSelected = (id) => {
    setSelectedRuleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const onDeleteDone = ({ removed, failed }) => {
    setSelectedRuleIds(new Set());
    if (removed > 0) {
      showToast(`Deleted ${removed} rule${removed > 1 ? "s" : ""}${failed ? ` — ${failed} failed` : ""}`, failed ? "error" : "success");
    }
    fetchConfigs(true);
    // A list-only delete moves the rule into the "attached but not registered"
    // bucket, so the discovered panel has to be re-read to stay truthful.
    if (discovered !== null) scanDiscoveredRules();
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
    const typeBadge = logType === "listener" ? "Listener"
      : logType === "scheduledjob" ? "Scheduled Job"
      : logType.includes("postfunction-semantic") ? "PF: Semantic"
      : logType.includes("postfunction-static") ? "PF: Static"
      : logType.includes("postfunction") ? "Post Function"
      : logType === "condition" ? "Condition"
      : logType === "postfunction-cancelled" ? "Cancelled"
      : "Validator";
    const typeBadgeClass = logType === "listener" ? "lt-listener"
      : logType === "scheduledjob" ? "lt-job"
      : logType.includes("postfunction-semantic") ? "lt-pf-semantic"
      : logType.includes("postfunction-static") ? "lt-pf-static"
      : logType.includes("postfunction") ? "lt-pf"
      : logType === "condition" ? "lt-condition"
      : "lt-validator";
    const editUrl = log.ruleWorkflow?.workflowId && log.ruleWorkflow?.siteUrl
      ? `${log.ruleWorkflow.siteUrl}/jira/settings/issues/workflows/${log.ruleWorkflow.workflowId}`
      : null;
    return (
      <div key={log.id} className={`log-entry ${isSkippedLog(log) ? "cv-log-skip" : log.isValid ? "cv-log-pass" : "cv-log-fail"}`}>
        <div className="log-header">
          <span className={`log-status ${isSkippedLog(log) ? "skip" : log.isValid ? "valid" : "invalid"}`}>
            {isSkippedLog(log) ? "SKIP" : log.isValid ? "PASS" : "ERR"}
          </span>
          <span className={`log-type-badge ${typeBadgeClass}`}>{typeBadge}</span>
          <span className={`log-src log-src-${logSourceOf(log)}`}>{SOURCE_LABEL[logSourceOf(log)]}</span>
          {(log.flags || []).map((f) => FLAG_LABEL[f] ? (
            <span key={f} className={`log-flag log-flag-${f}`}>{FLAG_LABEL[f]}</span>
          ) : null)}
          {siteUrl && log.issueKey ? (
            <button
              type="button"
              className="log-issue log-issue-link"
              onClick={() => router && router.open(`${siteUrl}/browse/${log.issueKey}`)}
              title={`Open ${log.issueKey} in Jira`}
            >
              {log.issueKey}
            </button>
          ) : (
            <span className="log-issue">{log.issueKey}</span>
          )}
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
            <span className="log-kv-label">{logType === "listener" ? "Event" : logType === "scheduledjob" ? "Schedule" : "Field"}</span>
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
        {Array.isArray(log.logs) && log.logs.length > 0 && (
          <details className="log-lines">
            <summary>{log.logs.length} execution log line{log.logs.length === 1 ? "" : "s"}{Array.isArray(log.changes) && log.changes.length ? ` · ${log.changes.length} change${log.changes.length === 1 ? "" : "s"}` : ""}</summary>
            <pre className="log-lines-pre">{log.logs.join("\n")}</pre>
          </details>
        )}
        {log.tokens > 0 && (
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

        // One-shot UI-intent handoff: another surface (config-view) may have stashed a
        // "jump to this tab / rule" intent before navigating here. Consume it once and open
        // the right tab (pre-expanding that rule's logs). Best-effort — a miss just lands on
        // the default tab.
        try {
          const ui = await invoke("takeUiIntent");
          if (ui?.success && ui.intent?.tab) {
            setActiveTab(ui.intent.tab);
            if (ui.intent.ruleId && ui.intent.tab === "rules") toggleRuleExpand(ui.intent.ruleId);
          }
        } catch (e) { /* intent handoff is best-effort */ }
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

  // ONE reset for the Configured Rules page index, listing every input that can
  // change which rows exist. Scattering `setRulesPage(0)` across the individual
  // handlers is how a table ends up stranded on an empty page 7 after a search —
  // any new filter added here inherits the reset for free.
  useEffect(() => { setRulesPage(0); }, [rulesSearch, typeFilter, rulesFilter, rulesPageSize, configs]);

  // A selection must never outlive the rows it points at: you cannot bulk-delete a
  // rule you can no longer see. Paging made that reachable for the first time (select
  // on page 1, page forward, Delete), but the same hole already existed for the
  // client-side search and type filters — only a refetch used to clear the set. Same
  // dependency list as above plus the page index, so every way of changing what is on
  // screen drops the selection.
  useEffect(() => {
    setSelectedRuleIds(new Set());
  }, [rulesSearch, typeFilter, rulesFilter, rulesPageSize, rulesPage, configs]);

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

      {/* Re-keyed tab panel — a light fade-up replays on each tab switch (MLS: prefers-reduced-motion
          guarded, ends transform:none). Jobs-poll + log-pagination state lives in App, OUTSIDE this
          wrapper, so it is not remounted; the tab blocks below already mount/unmount by activeTab. */}
      <div className="tab-panel" key={activeTab}>

      {SURFACES[activeTab] && (
        <div className="tab-intro">
          <span className="tab-intro-eyebrow">§ {SURFACES[activeTab].eyebrow}</span>
          <span className="tab-intro-what">{SURFACES[activeTab].what}</span>
          {SURFACES[activeTab].terms && (
            <span className="tab-intro-terms">
              {SURFACES[activeTab].terms.map((t) => (
                <Tooltip key={t.label} text={t.def}>
                  <span className="term-chip">{t.label}</span>
                </Tooltip>
              ))}
            </span>
          )}
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
      {activeTab === "rules" && showPortability && (
        <RulePortabilityDialog rules={configs} onClose={() => setShowPortability(false)} />
      )}
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
              {" "}Attaching rules yourself over Jira's REST API is supported — see <strong>Automating rule creation</strong> below for this installation's ARIs and the payload shapes.
            </p>
          )}
          {discMeta && discMeta.error && (
            <p style={{ margin: 0, fontSize: "13px", color: "#dc2626", fontWeight: 600 }}>Scan failed: {discMeta.error}</p>
          )}
          {registerOutcome && (
            <div className={`alert ${registerOutcome.error || registerOutcome.capped ? "alert-error" : "alert-success"} anim-rise`} style={{ marginBottom: "10px" }}>
              <span>
                {registerOutcome.error
                  ? `Registering failed: ${registerOutcome.error}`
                  : `Registered ${registerOutcome.added}${registerOutcome.updated ? ` (${registerOutcome.updated} updated)` : ""}.`}
                {/* The old code discarded this result entirely, so a run that
                    silently skipped hundreds of rules at the cap looked clean. */}
                {(registerOutcome.skipped > 0 || registerOutcome.skippedSize > 0) && (
                  <> {registerOutcome.skipped + registerOutcome.skippedSize} skipped — the registry is full. Delete rules you no longer need, then run this again.</>
                )}
              </span>
            </div>
          )}
          {discovered && discMeta && !discMeta.error && (<>
            <p style={{ margin: "0 0 10px 0", fontSize: "13px", color: "var(--text-secondary)" }}>
              Scanned <strong>{discMeta.scannedWorkflows}</strong> workflow(s): <strong>{discMeta.totalCogniRules}</strong> CogniRunner rule(s) attached, <strong>{discMeta.registeredMatched}</strong> already registered, <strong style={{ color: discovered.length ? "#7c3aed" : "inherit" }}>{discovered.length}</strong> not registered{discMeta.truncated ? <strong style={{ color: "#dc2626" }}> — scan truncated, this instance has more workflows than one scan covers</strong> : ""}.
            </p>
            {discovered.length > 0 && (
              <p style={{ margin: "0 0 10px 0", fontSize: "12.5px", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                These rules <strong>run on every matching transition</strong> and can't be disabled from this panel until they're registered. A rule whose saved configuration carries no identity can't be disabled even then — the only way to stop it is to remove it from the workflow.
              </p>
            )}
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
                        <td style={{ padding: "6px 10px" }}>
                          {/* Name and status-edge are separate facts — showing the
                              transition name as the destination status is what
                              produced "Any → ZSCALE-pv12". */}
                          <div>{d.transitionName || d.transitionId || "—"}</div>
                          {(d.transitionFromName || d.transitionToName) && (
                            <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                              {d.transitionFromName || "Any"} &rarr; {d.transitionToName || "Any"}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "6px 10px" }}>
                          {d.fieldId || "—"}
                          {d.manageable === false && (
                            <span className="del-flag" style={{ marginLeft: "8px" }} title="This rule's saved configuration carries no identity, so registering it won't make it disableable. Re-save it from the workflow editor, or remove it from the workflow.">can't disable</span>
                          )}
                        </td>
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

      {/* Automating rule creation. The discovered-rules panel above tells admins
          that rules can be attached "outside this panel" — this is where that
          sentence stops being a dead end. The one input they genuinely cannot
          work out is the extension ARI, because the environment id inside it is
          per-installation; the app knows it, so it hands it over rather than
          sending them off to derive it. Collapsed by default: irrelevant to most
          admins, indispensable to the ones provisioning in bulk. */}
      {isAdmin && (
        <div className="section">
          <div className="section-header">
            <span className="section-title">Automating rule creation</span>
            <div className="section-actions">
              <button
                className={"btn-small" + (apiInfoLoading ? " is-busy" : "")}
                onClick={() => { const next = !apiInfoOpen; setApiInfoOpen(next); if (next && !apiInfo) fetchRuleApiInfo(); }}
                aria-expanded={apiInfoOpen}
              >
                {apiInfoOpen ? "Hide" : "Show REST API details"}
              </button>
            </div>
          </div>
          {apiInfoOpen && (
            <div className="card anim-rise" style={{ padding: "14px 16px" }}>
              <p style={{ margin: "0 0 12px", fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.55 }}>
                CogniRunner rules are ordinary Jira workflow rules, so you can attach them with Jira's own
                workflow REST API instead of this panel — for provisioning across many projects, migrating
                between sites, or keeping rules in version control. Read the workflow with{" "}
                <code className="field-id">GET /rest/api/3/workflows/search</code>, add the rule to the
                transition, and post it all back with{" "}
                <code className="field-id">POST /rest/api/3/workflows/update</code>.
              </p>

              {apiInfoError && <div className="alert alert-error" style={{ marginBottom: "12px" }}><span>{apiInfoError}</span></div>}

              {apiInfo && (<>
                <div className="api-info-lead">
                  Use these values for <strong>this</strong> installation. The environment id inside each ARI
                  is specific to it — a production and a development install have different ids and separate
                  storage, so never copy an ARI out of an example or another site.
                </div>
                <table className="table" style={{ marginTop: "10px" }}>
                  <thead>
                    <tr><th>Rule type</th><th>ruleKey</th><th>Goes in</th><th>parameters.key (ARI)</th><th></th></tr>
                  </thead>
                  <tbody>
                    {apiInfo.modules.map((m) => (
                      <tr key={m.ari}>
                        <td style={{ fontWeight: 600 }}>{m.label}</td>
                        <td><code className="field-id">{m.ruleKey}</code></td>
                        <td style={{ fontSize: "12px", color: "var(--text-secondary)" }}>{m.slot}</td>
                        <td><code className="api-ari" data-ari={m.ari}>{m.ari}</code></td>
                        <td>
                          <button className="btn-small" onClick={() => copyAri(m.ari)}>
                            {copiedAri === m.ari ? "Copied" : "Copy"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="api-info-warn">
                  <strong>Two things that catch people out.</strong>
                  <ol style={{ margin: "6px 0 0", paddingLeft: "18px", lineHeight: 1.6 }}>
                    <li>
                      A rule attached this way <strong>runs immediately, but is invisible here</strong> until you
                      claim it — come back and use <strong>Scan workflows → Register all</strong> above, or you
                      won't be able to disable it. For validators and post-functions, claiming also surfaces their
                      execution history; a condition is evaluated by Jira itself, so it has no execution history to
                      show — claiming a condition is purely about being able to manage and disable it.
                    </li>
                    <li>
                      Put a stable <code className="field-id">id</code> inside the rule's{" "}
                      <code className="field-id">config</code> (e.g. <code className="field-id">acme-dod-check-v1</code>).
                      It is optional to Jira and essential here: without it a rule can be claimed and{" "}
                      <strong>still never be disabled</strong>, because that embedded id is the identity the
                      runtime matches on. A stable value also makes re-running your script update the rule
                      instead of creating a second one.
                    </li>
                  </ol>
                </div>

                <p style={{ margin: "12px 0 0", fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.55 }}>
                  Limits: a rule's <code className="field-id">config</code> must stay under{" "}
                  <strong>{Math.round(apiInfo.limits.maxRuleConfigBytes / 1024)} KB</strong> (Jira's cap), and this
                  panel manages up to <strong>{apiInfo.limits.maxRegistryRows}</strong> rules —
                  see the meter below. Rules beyond that still run; they just can't be managed here.
                </p>
                <p style={{ margin: "8px 0 0", fontSize: "12px" }}>
                  <a href={apiInfo.docsUrl} target="_blank" rel="noopener noreferrer">
                    Full guide: payload shapes, the config schema per rule type, and a worked example →
                  </a>
                </p>
              </>)}

              {!apiInfo && !apiInfoError && (
                <div><div className="sk sk-text" style={{ width: "60%", height: 12, marginBottom: 8 }} /><div className="sk sk-block" style={{ width: "100%", height: 70 }} /></div>
              )}
            </div>
          )}
        </div>
      )}

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
            {/* The wizard is a modal with its own Cancel, so this stays a plain
                "open it" action — it used to flip to "Cancel" because the wizard
                was an inline panel this button toggled. */}
            {(userRole === "editor" || userRole === "admin") && (
              <button className="btn-small btn-edit" onClick={() => setShowAddWizard(true)}>
                + Add Rule
              </button>
            )}
            {(userRole === "editor" || userRole === "admin") && (
              <button className="btn-small" onClick={() => setShowPortability(true)} title="Export rules to a file, or preview an import">
                ⤓ Export / Import
              </button>
            )}
          </div>
        </div>

        {/* Registry pressure. The whole registry lives in ONE storage value, so the
            cap is shared site-wide — this reads the true totals even while the
            "My Rules" filter is narrowing the table below. */}
        {isAdmin && registryMeter && (() => {
          const kb = (b) => Math.round(b / 1000);
          // Measure against CAPACITY (what Jira can actually store), and report
          // REFUSAL as a state rather than a second maximum. Showing usage over
          // the refusal threshold read as "219 / 200 KB" — a bar past its own
          // maximum, which just looks broken.
          const overBytes = registryMeter.bytes > registryMeter.refuseAtBytes;
          const overRows = registryMeter.count >= registryMeter.max;
          const toFree = overBytes ? Math.ceil((registryMeter.bytes - registryMeter.refuseAtBytes) / (registryMeter.bytes / Math.max(1, registryMeter.count))) : 0;
          return (
            <Tooltip text={`Every rule on this site shares one storage entry. Jira caps that entry at ${kb(registryMeter.maxBytes)} KB, and CogniRunner stops accepting new rules above ${kb(registryMeter.refuseAtBytes)} KB (or ${registryMeter.max} rules) so there is always room to edit and delete the ones you have. Deleting rules is what reclaims space.`}>
              <div className={`reg-meter reg-${registryMeter.level}`}>
                <div className="reg-meter-label">
                  <strong>{registryMeter.count} / {registryMeter.max}</strong> rules
                  <span className="reg-meter-bytes"> · {kb(registryMeter.bytes)} KB of {kb(registryMeter.maxBytes)} KB</span>
                  {registryMeter.refusing && <span className="reg-meter-flag">new rules refused</span>}
                </div>
                <div className="reg-meter-bar">
                  <div className="reg-meter-fill" style={{ width: `${Math.max(2, Math.min(100, Math.round(registryMeter.pct * 100)))}%` }} />
                </div>
                {/* Say what to do, and how much of it. "Full" without a number
                    leaves the admin guessing how many rules to delete — and
                    deleting one is not enough when it's the bytes that bind. */}
                {registryMeter.refusing && (
                  <div className="reg-meter-hint">
                    {overBytes
                      ? <>Delete about <strong>{Math.max(1, toFree)}</strong> more rule{Math.max(1, toFree) === 1 ? "" : "s"} to get back under {kb(registryMeter.refuseAtBytes)} KB — size is what's binding here, so removing a single rule won't be enough.</>
                      : overRows
                        ? <>Delete at least one rule to get back under {registryMeter.max}.</>
                        : null}
                  </div>
                )}
              </div>
            </Tooltip>
          );
        })()}

        {deleteTargetIds && (
          <DeleteRulesDialog
            invoke={invoke}
            ids={deleteTargetIds}
            onClose={() => setDeleteTargetIds(null)}
            onDone={onDeleteDone}
          />
        )}

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
            // Sort AFTER filtering, on a copy — `configs` is React state and
            // Array.prototype.sort mutates in place.
            const filtered = (rulesQuery ? typed.filter((c) => ruleMatchesQuery(c, rulesQuery)) : typed)
              .slice()
              .sort(byNewestFirst);
            const canManageRules = userRole === "editor" || userRole === "admin";
            // Paging. `rulesPage` is reset by the effect above whenever the result
            // set changes, but clamp here too: a delete can shrink the list before
            // that effect runs, and an out-of-range page renders a blank table.
            const totalRulePages = Math.max(1, Math.ceil(filtered.length / rulesPageSize));
            const safeRulesPage = Math.min(rulesPage, totalRulePages - 1);
            const pageStart = safeRulesPage * rulesPageSize;
            const pageRows = filtered.slice(pageStart, pageStart + rulesPageSize);
            // Only rows that are BOTH visible under the current filter and deletable
            // by this user can be bulk-selected. "Visible" now means ON THIS PAGE —
            // select-all must never reach rows the user cannot see.
            const selectableShown = canManageRules ? pageRows.filter(canDeleteRow) : [];
            // One source for both spanning rows, so they can never drift apart as
            // columns come and go.
            const ruleColSpan = 6 + (canManageRules ? 1 : 0) + (isAdmin ? 1 : 0);
            return filtered.length === 0 ? (
            <div className="empty-state">
              {configs.length === 0
                ? "No rules configured yet. Add one from a workflow transition."
                : rulesQuery
                  ? `No rules match “${rulesSearch.trim()}”.`
                  : `No ${typeFilter === "postfunction" ? "post functions" : typeFilter + "s"} found.`}
            </div>
          ) : (
            <>
            {/* The table's own toolbar, DOCKED to the table it acts on.
                The selection count used to render above the whole section — hundreds
                of pixels from the rows it referred to, and only when something was
                selected, so ticking a checkbox INSERTED a bar and shoved every row
                down under the cursor. It now lives at the top of the table and is
                ALWAYS present at a fixed height: selecting swaps its contents, never
                its size, so the list underneath cannot move. Sticky, so it stays
                reachable while scrolling. */}
            <div className="rules-bulkbar">
              {selectedRuleIds.size > 0 ? (
                <>
                  <span>{selectedRuleIds.size} selected</span>
                  <button className="btn-small btn-danger" onClick={() => setDeleteTargetIds([...selectedRuleIds])}>
                    Delete…
                  </button>
                  <button className="btn-small" onClick={() => setSelectedRuleIds(new Set())}>Clear</button>
                </>
              ) : (
                <span className="rules-bulkbar-idle">
                  {filtered.length === configs.length
                    ? `${configs.length} rule${configs.length === 1 ? "" : "s"}`
                    : `${filtered.length} of ${configs.length} rules match`}
                </span>
              )}
            </div>
            <table className="table rules-table">
              <thead>
                <tr>
                  {canManageRules && (
                    <th className="rule-select-th">
                      <input
                        type="checkbox"
                        aria-label="Select all rules on this page"
                        checked={selectableShown.length > 0 && selectableShown.every((c) => selectedRuleIds.has(c.id))}
                        onChange={(e) => {
                          // Bound to the rows ON THIS PAGE — never to every rule in
                          // the registry, so a row you can't see can't be deleted.
                          setSelectedRuleIds(e.target.checked ? new Set(selectableShown.map((c) => c.id)) : new Set());
                        }}
                      />
                    </th>
                  )}
                  <th>Type</th>
                  <th>Workflow / Transition</th>
                  <th>Field</th>
                  <th>Prompt</th>
                  <th>Updated</th>
                  {isAdmin && <th>Owner</th>}
                  <th></th>
                </tr>
              </thead>
              <tbody className="stagger">
                {pageRows.map((config) => {
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
                      {canManageRules && (
                        <td className="rule-select-cell">
                          <input
                            type="checkbox"
                            aria-label={`Select rule ${config.id}`}
                            checked={selectedRuleIds.has(config.id)}
                            disabled={!canDeleteRow(config)}
                            title={canDeleteRow(config) ? "" : "You can only delete rules you created"}
                            onChange={() => toggleRuleSelected(config.id)}
                          />
                        </td>
                      )}
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
                            {/* The transition's NAME and the status edge it runs across
                                are different facts. Discovery used to store the name
                                where the destination status belongs, which rendered as
                                "Any → ZSCALE-pv12" for a Backlog → Backlog transition. */}
                            {wf.transitionName && (
                              <div className="transition-name">{wf.transitionName}</div>
                            )}
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
                      {isAdmin && (
                        <td>
                          {/* Show the most specific attribution the rule actually
                              carries. Every one of these facts was already stored;
                              the column just used to collapse all of them into
                              "Unowned", which read as "nobody knows" even for a rule
                              whose claimer we could name. Nothing here is invented —
                              a genuinely unattributed rule still says so. */}
                          {config.createdBy
                            ? (config.createdBy === accountId
                              ? <span className="owner-you">You</span>
                              : <span className="owner-name">{config.createdByName || config.createdBy}</span>)
                            : config.claimedBy
                              ? <span
                                  className="owner-name owner-claimed"
                                  title="Attached outside CogniRunner (a REST call, or an imported or copied workflow), so it has no author. This is who claimed it here with Scan workflows → Register all."
                                >
                                  Claimed by {config.claimedBy === accountId ? "you" : (config.claimedByName || config.claimedBy)}
                                </span>
                              : <span className="owner-chip" title="Attached outside CogniRunner, or created before rules recorded an author — not attributed to anyone">Unowned</span>}
                        </td>
                      )}
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
                            {canDeleteRow(config) && (
                              <button
                                className="btn-small btn-danger"
                                onClick={() => setDeleteTargetIds([config.id])}
                                title="Delete this rule"
                              >
                                Delete
                              </button>
                            )}
                          </>
                          )}
                        </div>
                      </td>
                    </tr>
                    {explain[config.id]?.open && (
                      <tr className="rule-explain-row">
                        <td className="rule-explain-cell" colSpan={ruleColSpan}>
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
                        <td className="rule-accordion-cell" colSpan={ruleColSpan}>
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
            {/* Pagination. Always rendered (even on a single page) so the row count
                and the per-page control never appear and disappear as you filter —
                that flicker is itself a layout jump. */}
            <div className="rules-pagination">
              <div className="rules-pagesize">
                <span className="rules-pagesize-label">Rows per page</span>
                {RULES_PAGE_SIZES.map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={"rules-pagesize-btn" + (rulesPageSize === n ? " is-active" : "")}
                    aria-pressed={rulesPageSize === n}
                    onClick={() => setRulesPageSize(n)}
                  >{n}</button>
                ))}
              </div>
              <div className="rules-pager">
                <button
                  className="btn-small"
                  onClick={() => setRulesPage(Math.max(0, safeRulesPage - 1))}
                  disabled={safeRulesPage === 0}
                >Previous</button>
                <span className="rules-pagination-info">
                  {pageStart + 1}–{Math.min(pageStart + rulesPageSize, filtered.length)} of {filtered.length}
                  <span className="rules-pagination-page"> · page {safeRulesPage + 1} of {totalRulePages}</span>
                </span>
                <button
                  className="btn-small"
                  onClick={() => setRulesPage(Math.min(totalRulePages - 1, safeRulesPage + 1))}
                  disabled={safeRulesPage >= totalRulePages - 1}
                >Next</button>
              </div>
            </div>
            </>
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
      {/* Listeners Tab — Jira product-event rules */}
      {activeTab === "listeners" && (
        <ListenersTab invoke={invoke} isAdmin={isAdmin} userRole={userRole} siteUrl={siteUrl} router={router} />
      )}

      {/* Scheduled Jobs Tab — cron rules */}
      {activeTab === "jobs" && (
        <JobsTab invoke={invoke} isAdmin={isAdmin} userRole={userRole} />
      )}

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
    </div>
  );
}

export default App;
