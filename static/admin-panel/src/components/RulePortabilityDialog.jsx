/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import React, { useState } from "react";
import { invoke } from "@forge/bridge";

// Same-site rule export / import. Export downloads a self-contained JSON (no egress,
// no secrets). Import previews a dry-run plan (zero writes). The COMMIT step is gated
// pending a live cross-workflow smoke — the button says so plainly rather than pretend.
const STATUS_LABEL = { ready: "READY", "needs-rebind": "NEEDS REBIND", conflict: "CONFLICT", invalid: "INVALID" };

export default function RulePortabilityDialog({ rules, onClose }) {
  const [mode, setMode] = useState("export");
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [importText, setImportText] = useState("");
  const [plan, setPlan] = useState(null);

  const list = Array.isArray(rules) ? rules : [];
  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSelected = list.length > 0 && selected.size === list.length;

  const doExport = async () => {
    setBusy(true); setError(null);
    try {
      const ids = [...selected];
      const res = await invoke("exportRules", { ids });
      if (!res || !res.success) { setError((res && res.error) || "Export failed"); setBusy(false); return; }
      const blob = new Blob([JSON.stringify(res.envelope, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `cognirunner-rules-${res.envelope.ruleCount}.json`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      if (res.skipped && res.skipped.length) setError(`Exported ${res.envelope.ruleCount}. Skipped ${res.skipped.length}: ${res.skipped.map((s) => s.reason).join(", ")}`);
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const onFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setImportText(String(reader.result || ""));
    reader.readAsText(f);
  };

  const doPreview = async () => {
    setBusy(true); setError(null); setPlan(null);
    try {
      const res = await invoke("previewImport", { json: importText });
      if (!res || !res.success) { setError((res && res.error) || "Preview failed"); setBusy(false); return; }
      setPlan(res.plan || []);
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  return (
    <div className="pf-modal-overlay" onClick={onClose}>
      <div className="pf-modal port-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="port-head">
          <span className="section-title">Export / Import Rules</span>
          <button className="alert-dismiss" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <div className="port-tabs">
          <button className={`port-tab${mode === "export" ? " is-active" : ""}`} onClick={() => setMode("export")}>Export</button>
          <button className={`port-tab${mode === "import" ? " is-active" : ""}`} onClick={() => setMode("import")}>Import</button>
        </div>

        {error && <div className="alert alert-error anim-rise" style={{ marginBottom: "12px" }}><span>{error}</span></div>}

        {mode === "export" && (
          <div className="port-body">
            <p className="port-hint">Select rules to download as a self-contained JSON file (no API keys or account data are included). Import it into another workflow on this site.</p>
            <label className="port-selectall">
              <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(list.map((r) => r.id)))} />
              <span>Select all ({list.length})</span>
            </label>
            <div className="port-rulelist">
              {list.map((r) => (
                <label className="port-ruleitem" key={r.id}>
                  <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                  <span className="port-rulename">{r.name || r.ruleName || r.id}</span>
                  <span className="port-ruletype">{(r.type || "").replace("postfunction-", "PF: ")}</span>
                </label>
              ))}
              {!list.length && <div className="port-empty">No rules configured yet.</div>}
            </div>
            <div className="port-actions">
              <button className={`btn-edit${busy ? " is-busy" : ""}`} onClick={doExport} disabled={busy || selected.size === 0}>
                Export {selected.size > 0 ? `${selected.size} rule${selected.size > 1 ? "s" : ""}` : ""}
              </button>
            </div>
          </div>
        )}

        {mode === "import" && (
          <div className="port-body">
            <p className="port-hint">Paste or upload a rules export. You'll see a dry-run preview with per-rule match-by-value status before anything is created.</p>
            <input type="file" accept="application/json,.json" onChange={onFile} className="port-file" />
            <textarea className="port-textarea" value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="…or paste the exported JSON here" rows={6} />
            <div className="port-actions">
              <button className={`btn-edit${busy ? " is-busy" : ""}`} onClick={doPreview} disabled={busy || !importText.trim()}>Preview import</button>
            </div>
            {plan && (
              <div className="port-plan">
                <div className="port-plan-head">Import plan ({plan.length} rule{plan.length !== 1 ? "s" : ""})</div>
                {plan.map((row, i) => (
                  <div className="port-plan-row" key={i}>
                    <span className={`port-status port-status-${row.status}`}>{STATUS_LABEL[row.status] || row.status}</span>
                    <span className="port-plan-name">{row.ruleName}</span>
                    <span className="port-plan-type">{(row.type || "").replace("postfunction-", "PF: ")}</span>
                    {row.notes && row.notes.length > 0 && <span className="port-plan-note">{row.notes.join(" · ")}</span>}
                  </div>
                ))}
                <div className="port-commit-note">
                  Creating the imported rules on a target transition is the next step — it's gated on a short live verification with the maintainer, so the one-click commit isn't enabled here yet.
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
