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

import React, { useEffect, useState } from "react";
import { invoke, view } from "@forge/bridge";

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

export default function App() {
  const [state, setState] = useState("loading"); // loading | ready | error | notVisible
  const [items, setItems] = useState([]);

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
        const issueKey = ctx?.extension?.issue?.key || ctx?.extension?.issueKey
          || ctx?.issue?.key || ctx?.issueKey || null;
        if (!issueKey) { if (!cancelled) setState("error"); return; }
        const res = await invoke("getIssueActivity", { issueKey });
        if (cancelled) return;
        if (res && res.success && Array.isArray(res.items)) {
          setItems(res.items);
          setState(res.notVisible ? "notVisible" : "ready");
        } else {
          setState("error");
        }
      } catch (e) {
        if (!cancelled) setState("error");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="glance">
      <div className="glance-head"><span className="glance-mark">CR</span> CogniRunner on this issue</div>
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
