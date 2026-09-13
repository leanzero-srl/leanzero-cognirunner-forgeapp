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
    /* F-294 placeholder card for the jira:issuePanel "coder-panel" module. Deliberately
       NOT the activity list: that surface belongs to the issueContext glance, and rendering
       it twice on one issue is what this card exists to stop. Full border, no left accent
       rail; the "1.4" badge reuses the SOLID Coder burnt orange (same hue as
       .edition-advanced, so no new hue and no new dark override to forget). */
    .coder-soon { border: 1px solid var(--border-color); border-radius: 8px; background: var(--card-bg); padding: 12px 13px; }
    .coder-soon-badge { display: inline-block; padding: 2px 8px; border-radius: 5px; background: #c2410c; color: #fff; font-size: 10px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; }
    html[data-color-mode="dark"] .coder-soon-badge { background: #f97316; color: #2a1602; }
    .coder-soon-lead { margin: 8px 0 0; font-size: 13px; font-weight: 600; color: var(--text-color); }
    .coder-soon-upgrade { margin: 10px 0 0; padding-top: 10px; border-top: 1px solid var(--border-color); font-size: 12px; font-weight: 600; color: var(--text-secondary); }
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
  /* F-294: true when this bundle is mounted as the `coder-panel` issuePanel rather than the
     issueContext glance. It renders a compact placeholder and fetches NO activity. */
  const [showUpgrade, setShowUpgrade] = useState(false);
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
          let edition_ = edp.edition;
          if (!cancelled) { setEdition(edition_); setState("coder"); }
          // checkLicense is authoritative and is a pure read of the invocation context
          // (no storage I/O server-side), so it stays. It is also the ONLY invoke this
          // branch makes on a Coder tenant.
          try {
            const lic = await invoke("checkLicense");
            if (!cancelled && lic?.edition) { edition_ = lic.edition; setEdition(lic.edition); }
          } catch (_) { /* unknown edition - chip stays as resolved from context */ }
          /* The upgrade sentence is for Standard tenants ON FORGE LLM only - a BYOK tenant
             buys nothing by upgrading (see agentCapability in src/shared/edition.js, where
             `provider !== "atlassian"` is enabled outright). getProvider is therefore only
             called when the tenant is Standard; a Coder tenant issues no second invoke. */
          if (edition_ !== EDITION_IDS.ADVANCED) {
            try {
              const pv = await invoke("getProvider");
              if (!cancelled && pv?.provider === "atlassian") setShowUpgrade(true);
            } catch (_) { /* provider unknown - say nothing rather than guess an upsell */ }
          }
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
      {/* F-294: the Coder panel is a placeholder card only - never the activity list. */}
      {coder && (
        <div className="coder-soon">
          <span className="coder-soon-badge">1.4</span>
          <p className="coder-soon-lead">CogniRunner Coder arrives in 1.4 &mdash; in-issue coding chat, GitHub &amp; Bitbucket, PR review.</p>
          {showUpgrade && (
            <p className="coder-soon-upgrade">On Forge LLM the agent model is part of CogniRunner Coder &mdash; upgrade in Jira&apos;s Manage apps, or point CogniRunner at your own provider key.</p>
          )}
        </div>
      )}
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
