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

import React, { useEffect, useState } from "react";
import { invoke, view } from "@forge/bridge";
import { resolveEdition, EDITION_IDS } from "../../../src/shared/edition.js";
import CoderPanel from "./components/CoderPanel.jsx";

// Component CSS lives here (injectStyles is the live source; public/index.html carries only the
// token bootstrap). Solid saturated status hues + white text, glyph+label badges (status is never
// colour-alone), no left accent rails, dark-mode overrides for every hue.
const injectStyles = () => {
  if (typeof document === "undefined" || document.getElementById("cogni-glance-styles")) return;
  const el = document.createElement("style");
  el.id = "cogni-glance-styles";
  el.textContent = `
    .glance { font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: var(--text-color); padding: 4px 2px; }
    .glance-head { display: flex; align-items: center; gap: 7px; font-weight: 700; font-size: 12px; letter-spacing: 0.02em; color: var(--text-secondary); text-transform: uppercase; margin-bottom: 10px; }
    .glance-mark { width: 16px; height: 16px; border-radius: 4px; background: var(--primary-color); display: inline-flex; align-items: center; justify-content: center; color: #fff; font-size: 10px; font-weight: 800; }
    .glance-list { display: flex; flex-direction: column; gap: 8px; }
    .glance-item { border: 1px solid var(--border-color); border-radius: 8px; background: var(--card-bg); padding: 9px 11px; opacity: 0; transform: translateY(4px); animation: glanceRise 0.28s ease forwards; }
    .glance-item:nth-child(2) { animation-delay: 0.04s; } .glance-item:nth-child(3) { animation-delay: 0.08s; }
    .glance-item:nth-child(4) { animation-delay: 0.12s; } .glance-item:nth-child(5) { animation-delay: 0.16s; }
    .glance-item:nth-child(n+6) { animation-delay: 0.2s; }
    @keyframes glanceRise { to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { .glance-item { animation: none; opacity: 1; transform: none; } }
    .glance-item-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .glance-badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; color: #fff; white-space: nowrap; }
    .glance-badge .g-glyph { font-size: 11px; line-height: 1; }
    .g-ok { background: #16a34a; } .g-block { background: #dc2626; } .g-skip { background: #475569; } .g-hide { background: #64748b; }
    html[data-color-mode="dark"] .g-ok { background: #22c55e; } html[data-color-mode="dark"] .g-block { background: #ef4444; }
    html[data-color-mode="dark"] .g-skip { background: #64748b; } html[data-color-mode="dark"] .g-hide { background: #94a3b8; color: #0b1220; }
    .glance-kind { font-size: 10px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-muted); }
    .glance-label { font-weight: 600; color: var(--text-color); margin-left: auto; font-size: 12px; text-align: right; }
    .glance-reason { margin-top: 5px; color: var(--text-secondary); font-size: 12px; word-break: break-word; }
    .glance-time { margin-top: 4px; color: var(--text-muted); font-size: 11px; }
    .glance-empty { color: var(--text-secondary); font-size: 12px; padding: 10px 2px; }
    .glance-spinner { width: 18px; height: 18px; border: 2px solid var(--border-color); border-top-color: var(--primary-color); border-radius: 50%; animation: glanceSpin 0.7s linear infinite; margin: 12px auto; }
    @keyframes glanceSpin { to { transform: rotate(360deg); } }
    .glance-err { color: var(--error-color); font-size: 12px; padding: 8px 2px; }
    /* Edition chip (1.3) — solid saturated fill, white text, dark override per hue. */
    .edition-chip { display: inline-flex; align-items: center; margin-left: auto; padding: 2px 7px; border-radius: 5px; font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #fff; white-space: nowrap; }
    .edition-chip.edition-advanced { background: #c2410c; }
    .edition-chip.edition-standard { background: #475569; }
    html[data-color-mode="dark"] .edition-chip.edition-advanced { background: #f97316; color: #2a1602; }
    html[data-color-mode="dark"] .edition-chip.edition-standard { background: #64748b; }
    /* =====================================================================
       THE CODER PANEL (1.4 commit 9b) - jira:issuePanel "coder-panel".
       Replaces the F-294 placeholder card. Design mandate, checked by
       coder-panel.test.mjs in BOTH themes: solid saturated hues with white
       text on every chip and filled button, 600-700 weight for emphasis,
       FULL borders only (no left accent rail anywhere), no low-alpha tints
       as accents, and a dark override for every hue that appears here.
       Hues: agents #b45309 / dark #f59e0b (the Coder itself and its consent
       chip), git #a21caf / dark #c026d3 (the model the connection runs on),
       slate #475569 / #64748b for the neutral "off" statement, red #dc2626 /
       #ef4444 for a named failure.
       ===================================================================== */
    .coder { display: flex; flex-direction: column; gap: 10px; }

    /* -- the capability card: the first thing answered, always rendered -- */
    .coder-cap { border: 1px solid var(--border-color); border-radius: 8px; background: var(--card-bg); padding: 11px 12px; }
    .coder-cap-loading { display: flex; align-items: center; gap: 8px; }
    .coder-cap-title { margin: 8px 0 0; font-size: 13px; font-weight: 700; color: var(--text-color); }
    .coder-cap-loading .coder-cap-title { margin: 0; }
    .coder-cap-remedy { margin: 6px 0 0; font-size: 12px; font-weight: 500; color: var(--text-secondary); }
    .coder-cap-link { margin: 8px 0 0; font-size: 11px; font-weight: 700; letter-spacing: 0.02em; color: var(--text-muted); }
    .coder-cap-facts { margin: 8px 0 0; display: flex; flex-wrap: wrap; gap: 6px; }
    .coder-fact { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 5px; font-size: 11px; font-weight: 700; color: #fff; background: #475569; }
    .coder-fact-model { background: #a21caf; }
    html[data-color-mode="dark"] .coder-fact { background: #64748b; }
    html[data-color-mode="dark"] .coder-fact-model { background: #c026d3; }

    .coder-chip { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 5px; font-size: 10px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: #fff; }
    .coder-chip-on { background: #b45309; }
    .coder-chip-off { background: #475569; }
    .coder-chip-consent { background: #b45309; }
    html[data-color-mode="dark"] .coder-chip-on, html[data-color-mode="dark"] .coder-chip-consent { background: #f59e0b; color: #2a1602; }
    html[data-color-mode="dark"] .coder-chip-off { background: #64748b; }

    /* -- the transcript. Model text is PLAIN paragraphs (CoderPanel rule 2) -- */
    .coder-thread { display: flex; flex-direction: column; gap: 8px; max-height: 360px; overflow-y: auto; }
    .coder-msg { border: 1px solid var(--border-color); border-radius: 8px; background: var(--card-bg); padding: 8px 10px; }
    .coder-msg-who { font-size: 10px; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-muted); margin-bottom: 4px; }
    .coder-msg-user .coder-msg-who { color: #2563eb; }
    .coder-msg-decision .coder-msg-who { color: #b45309; }
    html[data-color-mode="dark"] .coder-msg-user .coder-msg-who { color: #3b82f6; }
    html[data-color-mode="dark"] .coder-msg-decision .coder-msg-who { color: #f59e0b; }
    .coder-msg-p { margin: 0 0 6px; font-size: 12.5px; color: var(--text-color); white-space: pre-wrap; word-break: break-word; }
    .coder-msg-p:last-child { margin-bottom: 0; }

    /* -- F-368: the conversations bar. Chips for the threads this browser has opened,
          and the button that mints a new one. The CURRENT chip is the solid agents hue
          with white text; the rest carry a full 1px border, never a left rail and never
          a tinted fill. -- */
    .coder-threads { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .coder-thread-list { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .coder-thread-chip { font: inherit; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 999px; cursor: pointer; border: 1px solid var(--border-color); background: var(--card-bg); color: var(--text-secondary); }
    .coder-thread-chip:hover:not(:disabled) { border-color: var(--text-secondary); }
    .coder-thread-chip.is-current { background: #b45309; border-color: #b45309; color: #fff; }
    html[data-color-mode="dark"] .coder-thread-chip.is-current { background: #f59e0b; border-color: #f59e0b; color: #2a1602; }
    .coder-thread-chip:disabled { cursor: default; color: var(--text-muted); }
    .coder-thread-chip.is-current:disabled { color: #fff; }
    html[data-color-mode="dark"] .coder-thread-chip.is-current:disabled { color: #2a1602; }
    .coder-newconv { margin-left: auto; font: inherit; font-size: 11.5px; font-weight: 700; padding: 5px 11px; border-radius: 6px; cursor: pointer; border: 1px solid var(--border-color); background: var(--card-bg); color: var(--text-color); }
    .coder-newconv:hover:not(:disabled) { border-color: var(--text-secondary); }
    .coder-newconv:disabled { cursor: default; color: var(--text-muted); }

    /* -- the consent chip row: the action, its preview, three answers -- */
    .coder-consent { border: 1px solid var(--border-color); border-radius: 8px; background: var(--card-bg); padding: 10px 11px; }
    .coder-consent-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .coder-consent-action { font-size: 12.5px; font-weight: 700; color: var(--text-color); word-break: break-all; }
    .coder-consent-args { margin: 7px 0 0; font-size: 12px; font-weight: 500; color: var(--text-secondary); word-break: break-word; }
    .coder-consent-btns { margin-top: 9px; display: flex; gap: 6px; flex-wrap: wrap; }
    .coder-change { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }

    /* -- buttons: solid fill + white text on the affirmative, full border on the rest -- */
    .coder-btn { font: inherit; font-size: 12px; font-weight: 700; padding: 6px 12px; border-radius: 6px; cursor: pointer; border: 1px solid var(--border-color); background: var(--card-bg); color: var(--text-color); }
    /* A disabled button is a SOLID neutral, never a faded copy of the live one. Dimming
       with opacity is the washed-out accent the design mandate forbids, and it is also
       what coder-panel.test.mjs's faded-accent scan reads as a violation - correctly, since
       a 55%-alpha burnt orange is exactly the tint the rule exists to keep out. */
    .coder-btn:disabled { cursor: default; color: var(--text-muted); background: var(--code-bg); border-color: var(--border-color); }
    .coder-btn-go:disabled { background: #475569; border-color: #475569; color: #fff; }
    html[data-color-mode="dark"] .coder-btn-go:disabled { background: #64748b; border-color: #64748b; color: #fff; }
    .coder-btn-go { background: #b45309; border-color: #b45309; color: #fff; }
    html[data-color-mode="dark"] .coder-btn-go { background: #f59e0b; border-color: #f59e0b; color: #2a1602; }
    .coder-btn-alt:hover:not(:disabled) { border-color: var(--text-secondary); }

    /* -- the finished turn: the reply, then what it actually did -- */
    .coder-outcome { border: 1px solid var(--border-color); border-radius: 8px; background: var(--card-bg); padding: 10px 11px; }
    .coder-actions { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
    .coder-action { display: flex; align-items: center; gap: 7px; font-size: 11.5px; }
    .coder-action-dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; }
    .coder-action-ok { background: #16a34a; }
    .coder-action-bad { background: #dc2626; }
    html[data-color-mode="dark"] .coder-action-ok { background: #22c55e; }
    html[data-color-mode="dark"] .coder-action-bad { background: #ef4444; }
    .coder-action-name { font-weight: 700; color: var(--text-color); word-break: break-all; }
    .coder-action-verdict { font-weight: 700; color: var(--text-secondary); text-transform: uppercase; font-size: 10px; letter-spacing: 0.05em; }
    .coder-action-ms { margin-left: auto; color: var(--text-muted); font-size: 11px; }
    .coder-outcome-foot { margin: 9px 0 0; font-size: 11px; font-weight: 600; color: var(--text-muted); }

    /* -- a failure is NAMED, in solid red with white text; never a tint -- */
    .coder-error { border-radius: 8px; background: #dc2626; color: #fff; font-size: 12px; font-weight: 600; padding: 9px 11px; word-break: break-word; }
    html[data-color-mode="dark"] .coder-error { background: #ef4444; color: #2a0404; }

    /* -- the composer -- */
    .coder-composer { display: flex; flex-direction: column; gap: 7px; border-radius: 8px; }
    .coder-input { font: inherit; font-size: 12.5px; width: 100%; box-sizing: border-box; resize: vertical; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--card-bg); color: var(--text-color); }
    .coder-input:focus { outline: none; border-color: var(--primary-color); }
    .coder-composer-row { display: flex; align-items: center; gap: 8px; }
    .coder-composer-row .coder-btn-go { margin-left: auto; }
    .coder-picker { position: relative; }
    /* F-371: why the Dry run switch is not a choice any more. A plain sentence in the
       app's own secondary text, never a tinted callout and never a rail. */
    .coder-lock-note { margin: 0; font-size: 11.5px; font-weight: 600; color: var(--text-secondary); }
    /* The Dry run switch: a real control, never a native checkbox. Solid when on. */
    .coder-toggle { display: inline-flex; align-items: center; gap: 7px; font: inherit; font-size: 12px; font-weight: 700; color: var(--text-secondary); background: none; border: none; padding: 0; cursor: pointer; }
    .coder-toggle-box { width: 30px; height: 17px; border-radius: 999px; background: #475569; position: relative; transition: background 140ms ease; }
    .coder-toggle-box::after { content: ""; position: absolute; top: 2px; left: 2px; width: 13px; height: 13px; border-radius: 50%; background: #fff; transition: transform 140ms ease; }
    .coder-toggle-on .coder-toggle-box { background: #b45309; }
    .coder-toggle-on .coder-toggle-box::after { transform: translateX(13px); }
    .coder-toggle-on { color: var(--text-color); }
    html[data-color-mode="dark"] .coder-toggle-box { background: #64748b; }
    html[data-color-mode="dark"] .coder-toggle-on .coder-toggle-box { background: #f59e0b; }
    .coder-toggle:disabled { cursor: default; color: var(--text-muted); }
    .coder-toggle:disabled .coder-toggle-box { background: var(--border-color); }

    /* =====================================================================
       MLS (Motion & Loading System) subset - the shared contract, same class
       names and same values as config-ui / config-view / admin-panel. Only
       what this app renders: .is-busy (+.busy-solid), .spin-ring,
       .veil/.veil-host, .anim-rise. Every keyframe ends at transform: none.
       ===================================================================== */
    :root { --ease-out: cubic-bezier(0.22, 1, 0.36, 1); --dur-fast: 140ms; --dur-med: 260ms; --frost-bg: rgba(255, 255, 255, 0.6); }
    html[data-color-mode="dark"] { --frost-bg: rgba(8, 8, 14, 0.55); }
    @keyframes mlsSpin { to { transform: rotate(360deg); } }
    @keyframes mlsFadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes mlsRiseIn { from { opacity: 0; transform: translateY(7px); } to { opacity: 1; transform: none; } }
    .is-busy { position: relative; color: transparent !important; pointer-events: none; text-shadow: none !important; }
    .is-busy::after { content: ""; position: absolute; width: 14px; height: 14px; top: 50%; left: 50%; margin: -7px 0 0 -7px; border-radius: 50%; border: 2px solid rgba(100, 116, 139, 0.3); border-top-color: var(--primary-color); animation: mlsSpin 0.7s linear infinite; }
    .busy-solid.is-busy::after { border-color: rgba(255, 255, 255, 0.4); border-top-color: #ffffff; }
    .spin-ring { width: 16px; height: 16px; flex: 0 0 auto; border-radius: 50%; border: 2px solid rgba(100, 116, 139, 0.3); border-top-color: var(--primary-color); animation: mlsSpin 0.7s linear infinite; display: inline-block; }
    .veil-host { position: relative; }
    .veil { position: absolute; inset: 0; z-index: 6; display: flex; align-items: center; justify-content: center; gap: 9px; background: var(--frost-bg); -webkit-backdrop-filter: blur(10px) saturate(160%); backdrop-filter: blur(10px) saturate(160%); border-radius: inherit; animation: mlsFadeIn var(--dur-fast) var(--ease-out) both; }
    .veil-label { font-size: 12.5px; font-weight: 700; color: var(--text-color); }
    .anim-rise { animation: mlsRiseIn var(--dur-med) var(--ease-out) both; }
    @media (prefers-reduced-motion: reduce) { .is-busy::after, .spin-ring { animation-duration: 0.01ms; } .veil, .anim-rise { animation: none; opacity: 1; transform: none; } }

    /* The custom dropdown, copied from admin-panel's injectStyles so CustomSelect
       renders identically here. It is a deliberately DIVERGED component (CLAUDE.md),
       so this app carries its own copy of both the component and its CSS. */
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
    /* Edition-locked model rows + their "Coder" badge. Solid burnt orange, white
       text; the locked row keeps a SOLID secondary text colour (never opacity /
       a faded wash) so it stays legible while reading as unavailable. */
    .dib-edition { background: #c2410c; }
    html[data-color-mode="dark"] .dib-edition { background: #f97316; color: #2a1602; }
    .dropdown-item.dropdown-item-locked {
      cursor: not-allowed;
      color: var(--text-secondary);
      background: transparent;
    }
    .dropdown-item.dropdown-item-locked:hover { background: transparent; }
    .dropdown-item.dropdown-item-locked .dropdown-item-name { color: var(--text-secondary); }
    .dropdown-item.dropdown-item-locked .dropdown-item-meta { color: var(--text-muted); }
    .dropdown-empty { padding: 16px 12px; text-align: center; color: var(--text-muted); font-size: 13px; }

  `;
  document.head.appendChild(el);
};

// Relative time from an ISO timestamp (browser clock — fine here, this is not a workflow script).
const relTime = (iso) => {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 30) return `${d}d ago`;
  return new Date(t).toLocaleDateString();
};

// Humanise the internal activity kind for the category eyebrow (never show the raw enum).
const KIND_LABEL = {
  validator: "Validator",
  condition: "Condition",
  "post-function": "Post-function",
  postfunction: "Post-function",
  skipped: "Skipped",
};
const kindLabel = (k) => KIND_LABEL[k] || (k ? k.charAt(0).toUpperCase() + k.slice(1) : "");

// Map a shaped activity item to its status badge (glyph + label + solid hue).
const badgeFor = (it) => {
  if (it.kind === "skipped") return { cls: "g-skip", glyph: "⊘", text: it.decision || "Skipped" };
  if (it.kind === "condition") return it.verdictOk
    ? { cls: "g-ok", glyph: "✓", text: it.decision || "Transition shown" }
    : { cls: "g-hide", glyph: "◐", text: it.decision || "Transition hidden" };
  // validator / post-function
  return it.verdictOk
    ? { cls: "g-ok", glyph: "✓", text: it.decision || "OK" }
    : { cls: "g-block", glyph: "✕", text: it.decision || "Blocked" };
};

/*
 * F-294 - WHICH MODULE is this bundle rendering in?
 *
 * manifest.yml points BOTH `jira:issueContext cognirunner-issue-glance` and
 * `jira:issuePanel coder-panel` at the same issue-glance-resource (one resource may back
 * several modules). Without this discriminator the panel rendered the whole glance a
 * second time on every issue: a duplicate activity list plus a duplicate
 * getIssueActivity round-trip per issue view.
 *
 * `moduleKey` is a TOP-LEVEL field of the bridge FullContext (@forge/bridge types.d.ts) -
 * NOT `extension.moduleKey`. The extra reads below are belt-and-braces for older bridge
 * payload shapes, in descending order of how well-specified they are:
 *   ctx.moduleKey            - the documented field
 *   ctx.extension.moduleKey  - defensive; some payloads have mirrored it
 *   ctx.extension.key        - the module key as the mock and the workflow surfaces carry it
 *   ctx.localId              - `ari:cloud:ecosystem::extension/{appId}/{envId}/static/{moduleKey}`
 */
const moduleKeyOf = (ctx) => {
  const direct = ctx?.moduleKey || ctx?.extension?.moduleKey || ctx?.extension?.key;
  if (direct) return String(direct);
  const ari = String(ctx?.localId || "");
  const tail = ari.split("/").pop();
  return ari && tail ? tail : "";
};

/*
 * Is this the Coder panel? Two INDEPENDENT signals, either of which is sufficient, so a
 * bridge that drops one still routes correctly:
 *   - the module key is literally "coder-panel"
 *   - the extension type is `jira:issuePanel` - and coder-panel is the ONLY issuePanel
 *     module this app declares, so the type alone identifies it. If a second issuePanel
 *     is ever added, this fallback must become key-only.
 * Getting this WRONG in the safe direction (false negative) restores the duplicate; wrong
 * in the unsafe direction would hide the real glance, so the key check is listed first and
 * the type check is scoped to a module set of exactly one.
 */
const CODER_PANEL_KEY = "coder-panel";
const isCoderPanelCtx = (ctx) =>
  moduleKeyOf(ctx) === CODER_PANEL_KEY || ctx?.extension?.type === "jira:issuePanel";

export default function App() {
  const [state, setState] = useState("loading"); // loading | ready | error | notVisible | coder
  const [items, setItems] = useState([]);
  /* F-294: set when this bundle is mounted as the `coder-panel` issuePanel rather than the
     issueContext glance. It carries what the Coder panel needs and NOTHING the glance uses;
     the activity list is never fetched on this path. */
  const [coderCtx, setCoderCtx] = useState(null);
  /* Edition chip state. There is no license BANNER on the glance, so the only thing
     this surface ever needed was the edition — and `edition` fails soft to Standard,
     which is the truthful answer for an install with no license object. The
     licenseActive state that used to gate the chip is gone with F-106: it was never
     read for anything else, and keeping it invited the gate back. */
  const [edition, setEdition] = useState(EDITION_IDS.STANDARD);

  useEffect(() => {
    injectStyles();
    let cancelled = false;
    (async () => {
      try {
        await view.theme.enable();
      } catch (e) {
        // theming best-effort — if it fails, honour the OS scheme so a dark Jira
        // doesn't render a light card on dark chrome (index.html tokens default to light).
        try {
          const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
          document.documentElement.setAttribute("data-color-mode", prefersDark ? "dark" : "light");
        } catch (_) { /* no matchMedia — CSS prefers-color-scheme fallback still applies */ }
      }
      try {
        const ctx = await view.getContext();

        /* F-294 - the Coder panel branch. Resolve the edition (and only the edition) and
           STOP: no issue key is needed, no getIssueActivity is issued, and the activity
           list never mounts. Everything below this block is the issueContext glance. */
        if (isCoderPanelCtx(ctx)) {
          const edp = resolveEdition(ctx?.license);
          if (!cancelled) {
            setEdition(edp.edition);
            setCoderCtx({
              issueKey: ctx?.extension?.issue?.key || ctx?.extension?.issueKey || ctx?.issue?.key || ctx?.issueKey || null,
              accountId: ctx?.accountId || null,
            });
            setState("coder");
          }
          /* checkLicense is authoritative and is a pure read of the invocation context (no
             storage I/O server-side), so it stays: it is the CHIP's answer. It is NOT the
             Coder's - the panel asks `getAgentCapability`, because the edition is only one
             of the four things that decide whether the Coder can run, and a surface that
             guessed from the edition alone would tell a Forge LLM tenant on a non-frontier
             model that the Coder is on. One question, one answer, one home. */
          try {
            const lic = await invoke("checkLicense");
            if (!cancelled && lic?.edition) setEdition(lic.edition);
          } catch (_) { /* unknown edition - chip stays as resolved from context */ }
          return;
        }

        const issueKey = ctx?.extension?.issue?.key || ctx?.extension?.issueKey
          || ctx?.issue?.key || ctx?.issueKey || null;
        if (!issueKey) { if (!cancelled) setState("error"); return; }
        const ed = resolveEdition(ctx?.license);
        if (!cancelled) setEdition(ed.edition);

        const res = await invoke("getIssueActivity", { issueKey });
        if (cancelled) return;
        if (res && res.success && Array.isArray(res.items)) {
          setItems(res.items);
          setState(res.notVisible ? "notVisible" : "ready");
        } else {
          setState("error");
        }

        // checkLicense is authoritative for paid apps; a failure just leaves the
        // context-derived value (or hides the chip) — it never fails the panel.
        try {
          const lic = await invoke("checkLicense");
          if (!cancelled) {
            if (lic?.edition) setEdition(lic.edition);
          }
        } catch (_) { /* unknown edition — chip stays as-is */ }
      } catch (e) {
        if (!cancelled) setState("error");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const coder = state === "coder";

  return (
    <div className="glance">
      <div className="glance-head">
        <span className="glance-mark">CR</span> {coder ? "CogniRunner Coder" : "CogniRunner on this issue"}
        {/* F-106: gated on the EDITION, not on licenseActive — an install with no
            license object reports isActive:null and edition:"standard", and used to
            show no chip at all. `edition` is always a real id, so it reads STANDARD. */}
        {edition && (
          <span className={`edition-chip edition-${edition === EDITION_IDS.ADVANCED ? "advanced" : "standard"}`}>
            {edition === EDITION_IDS.ADVANCED ? "Coder" : "Standard"}
          </span>
        )}
      </div>
      {/* F-294 still holds: on this path the bundle renders the CODER and never the activity
          list, and issues no getIssueActivity. 1.4 commit 9b replaced the placeholder card
          with the real panel. */}
      {coder && <CoderPanel issueKey={coderCtx?.issueKey || null} accountId={coderCtx?.accountId || null} />}
      {state === "loading" && <div className="glance-spinner" aria-label="Loading activity" />}
      {state === "error" && <div className="glance-err">Couldn't load activity. Try reloading the issue.</div>}
      {(state === "ready" || state === "notVisible") && items.length === 0 && (
        <div className="glance-empty">No CogniRunner activity recorded on this issue yet. Validators, conditions and post-functions that run on this issue's transitions will appear here.</div>
      )}
      {(state === "ready" || state === "notVisible") && items.length > 0 && (
        <div className="glance-list">
          {items.map((it, i) => {
            const b = badgeFor(it);
            return (
              <div className="glance-item" key={i}>
                <div className="glance-item-top">
                  <span className={`glance-badge ${b.cls}`}><span className="g-glyph" aria-hidden="true">{b.glyph}</span>{b.text}</span>
                  <span className="glance-kind">{kindLabel(it.kind)}</span>
                  <span className="glance-label">{it.label}</span>
                </div>
                {it.reason && <div className="glance-reason">{it.reason}</div>}
                {it.timestamp && <div className="glance-time">{relTime(it.timestamp)}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
