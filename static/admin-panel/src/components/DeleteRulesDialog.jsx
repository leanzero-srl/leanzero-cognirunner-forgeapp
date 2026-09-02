/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Confirm dialog for deleting one or more rules.
 *
 * The important product decision lives here: there are TWO meanings of "delete"
 * and picking the wrong one silently leaves a rule running.
 *
 *   Delete everywhere        — removes it from the Jira transition AND the list.
 *                              The rule stops running. This is the default.
 *   Remove from this list    — registry row only. The rule STAYS on the
 *                              transition and keeps executing, and you lose the
 *                              ability to disable or explain it from here.
 *
 * The second option also silently RE-ENABLES a disabled rule, because the
 * `disabled` flag lives only on the registry row. That trap is called out
 * explicitly rather than left for the user to discover.
 *
 * Structure mirrors RulePortabilityDialog (.pf-modal-overlay > .pf-modal).
 */

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

// Modals render in a PORTAL to <body>, never in place.
//
// `position: fixed` is resolved against the nearest ancestor that has a transform,
// filter or backdrop-filter — not against the viewport. The admin panel's `.section`
// wrapper animates in, and while that animation runs (and, before the keyframe was
// corrected, forever after) it carries a transform, which made it the containing
// block for this overlay. `inset: 0` then resolved to a 76,000px-tall section and
// the dialog opened thousands of pixels above whatever the user was looking at.
//
// Portalling to <body> removes the dependency entirely: no app container can be an
// ancestor, so no future layout or animation change can capture the overlay again.
// This is the same reason CustomSelect portals its dropdown panel.


const typeLabel = (t) =>
  t === "postfunction-semantic" ? "PF: Semantic"
    : t === "postfunction-static" ? "PF: Static"
      : String(t || "").startsWith("postfunction") ? "PF"
        : t || "rule";

const badgeClass = (t) =>
  t === "postfunction-static" ? "type-pf-static"
    : String(t || "").startsWith("postfunction") ? "type-postfunction"
      : `type-${t}`;

// Reasons a rule can't be found on its workflow, in the user's language.
const NOT_LOCATABLE = {
  "no-workflow": "no workflow recorded for this rule",
  "workflow-not-found": "its workflow couldn't be read (unpublished changes?)",
  "transition-not-found": "its transition no longer exists",
  "ambiguous": "more than one identical rule on that transition",
  "not-found": "already gone from the workflow",
  "read-failed": "its workflow couldn't be read",
};

const MAX_LISTED = 10;

export default function DeleteRulesDialog({ invoke, ids, onClose, onDone }) {
  const [mode, setMode] = useState("everywhere"); // "everywhere" | "list-only"
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const r = await invoke("previewRuleDeletion", { ids });
        if (!live) return;
        if (r && r.success) setPreview(r);
        else setError(r?.error || "Couldn't check these rules.");
      } catch (e) {
        if (live) setError(e.message || "Couldn't check these rules.");
      }
      if (live) setLoading(false);
    })();
    return () => { live = false; };
  }, [invoke, ids]);

  // Esc closes, matching the rest of the app's dialogs.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const items = preview?.items || [];
  const disabledCount = items.filter((i) => i.disabled).length;
  const unlocatable = items.filter((i) => !i.locatable);
  const everythingUnlocatable = items.length > 0 && unlocatable.length === items.length;
  const sharedWorkflows = Object.entries(preview?.projectCounts || {}).filter(([, n]) => n > 1);

  // Detaching talks to Jira, so it goes in small batches; a registry-only delete
  // is pure storage and can take far more per call. Both caps mirror the backend.
  const CHUNK = mode === "everywhere" ? 10 : 100;

  const run = async () => {
    setBusy(true); setError(null);
    const all = [];
    try {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        setProgress(`Deleting ${Math.min(i + slice.length, ids.length)} of ${ids.length}…`);
        const r = await invoke("deleteRules", { ids: slice, detach: mode === "everywhere" });
        if (!r || r.success === false) throw new Error(r?.error || "Delete failed");
        all.push(...(r.results || []));
      }
      setResults(all);
      const failed = all.filter((r) => !r.ok);
      if (onDone) onDone({ results: all, removed: all.filter((r) => r.ok).length, failed: failed.length });
      // Clean sweep — nothing more to show, so get out of the user's way.
      if (!failed.length) onClose();
    } catch (e) {
      setError(e.message || "Delete failed");
    }
    setProgress(null);
    setBusy(false);
  };

  const n = ids.length;

  return createPortal(
    <div className="pf-modal-overlay" onClick={() => !busy && onClose()}>
      <div className="pf-modal del-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Delete ${n} rule${n > 1 ? "s" : ""}`}>
        <div className="port-head">
          <span className="section-title">Delete {n} rule{n > 1 ? "s" : ""}?</span>
          <button className="alert-dismiss" onClick={onClose} aria-label="Close" disabled={busy}>&times;</button>
        </div>

        {error && <div className="alert alert-error anim-rise" style={{ marginBottom: "12px" }}><span>{error}</span></div>}

        {loading ? (
          <div style={{ padding: "10px 0" }}>
            <div className="sk sk-text" style={{ width: "70%", height: 12, marginBottom: 8 }} />
            <div className="sk sk-block" style={{ width: "100%", height: 60 }} />
          </div>
        ) : (
          <>
            <div className="port-rulelist" style={{ maxHeight: "160px" }}>
              {items.slice(0, MAX_LISTED).map((it) => (
                <div className="port-ruleitem" key={it.id}>
                  <span className={`type-badge ${badgeClass(it.type)}`} style={{ fontSize: "9px" }}>{typeLabel(it.type)}</span>
                  <span className="port-rulename">
                    {it.workflowName || "—"}
                    {it.transitionName ? ` · ${it.transitionName}` : ""}
                    {it.transitionFromName || it.transitionToName
                      ? ` (${it.transitionFromName || "Any"} → ${it.transitionToName || "Any"})`
                      : ""}
                  </span>
                  {!it.locatable && (
                    <span className="del-flag">{NOT_LOCATABLE[it.reason] || "can't be located"}</span>
                  )}
                </div>
              ))}
              {items.length > MAX_LISTED && (
                <div className="port-empty">…and {items.length - MAX_LISTED} more</div>
              )}
              {!items.length && <div className="port-empty">These rules are no longer in the registry.</div>}
            </div>

            <div
              className={`del-option${mode === "everywhere" ? " is-active" : ""}`}
              aria-disabled={everythingUnlocatable ? "true" : "false"}
              role="button"
              tabIndex={0}
              onClick={() => !everythingUnlocatable && setMode("everywhere")}
              onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !everythingUnlocatable) { e.preventDefault(); setMode("everywhere"); } }}
            >
              <div className="del-option-title">
                <span className="del-radio" aria-hidden="true">{mode === "everywhere" ? "●" : "○"}</span>
                Delete everywhere
              </div>
              <div className="del-option-copy">
                Removes the rule from its Jira workflow transition so it stops running, and removes it
                from this list. This edits your workflow and can't be undone.
              </div>
              {everythingUnlocatable && (
                <div className="del-warn">
                  Not available: none of these rules could be located on their workflow
                  {unlocatable[0]?.reason ? ` — ${NOT_LOCATABLE[unlocatable[0].reason] || unlocatable[0].reason}` : ""}.
                </div>
              )}
              {!everythingUnlocatable && unlocatable.length > 0 && (
                <div className="del-warn">
                  {unlocatable.length} of these can't be located on their workflow and will only be
                  removed from this list.
                </div>
              )}
              {sharedWorkflows.length > 0 && (
                <div className="del-warn">
                  {sharedWorkflows.map(([name, count]) => `“${name}” is used by ${count} projects`).join("; ")}.
                </div>
              )}
            </div>

            <div
              className={`del-option${mode === "list-only" ? " is-active" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => setMode("list-only")}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setMode("list-only"); } }}
            >
              <div className="del-option-title">
                <span className="del-radio" aria-hidden="true">{mode === "list-only" ? "●" : "○"}</span>
                Remove from this list only
              </div>
              <div className="del-option-copy">
                The rule stays attached to the workflow and <strong>keeps running</strong> on every
                transition. You lose the ability to disable, view or explain it here.
              </div>
              {disabledCount > 0 && (
                <div className="del-warn">
                  {disabledCount} of these {disabledCount === 1 ? "rule is" : "rules are"} currently
                  disabled. Removing only the list entry will start {disabledCount === 1 ? "it" : "them"} running again.
                </div>
              )}
            </div>

            {results && results.some((r) => !r.ok) && (
              <div className="del-results">
                {results.filter((r) => !r.ok).map((r) => (
                  <div className="del-result-row" key={r.id}>
                    <span className="port-status-error">failed</span>
                    <span className="del-result-msg">{r.message || r.reason}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="port-actions">
              {progress && <span className="del-progress">{progress}</span>}
              <button className="btn-small" onClick={onClose} disabled={busy}>Cancel</button>
              <button
                className={`btn-danger${busy ? " is-busy" : ""}`}
                onClick={run}
                disabled={busy || !items.length}
              >
                {mode === "everywhere" ? `Delete ${n} everywhere` : `Remove ${n} from list`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
