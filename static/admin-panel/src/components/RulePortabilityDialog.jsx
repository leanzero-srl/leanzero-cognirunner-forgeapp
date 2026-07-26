/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { invoke } from "@forge/bridge";
import CustomSelect from "./CustomSelect";

// Same-site rule export / import. Export downloads a self-contained JSON (no egress,
// no secrets). Import previews a dry-run plan (zero writes), then commits one rule at a
// time onto a chosen target transition via commitImport (re-validated server-side).
const STATUS_LABEL = { ready: "READY", "needs-rebind": "NEEDS REBIND", conflict: "CONFLICT", invalid: "INVALID", committed: "IMPORTED", error: "ERROR" };

export default function RulePortabilityDialog({ rules, onClose }) {
  const [mode, setMode] = useState("export");
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [importText, setImportText] = useState("");
  const [plan, setPlan] = useState(null);
  const [parsedRules, setParsedRules] = useState([]);
  // Target project → workflow → transition cascade for the commit step.
  const [projects, setProjects] = useState([]);
  const [tProject, setTProject] = useState("");
  const [workflows, setWorkflows] = useState([]);
  const [tWorkflow, setTWorkflow] = useState("");
  const [transitions, setTransitions] = useState([]);
  const [tTransition, setTTransition] = useState("");
  const [rowState, setRowState] = useState({}); // idx -> { status, msg }

  useEffect(() => {
    invoke("listProjects").then((r) => { if (r && r.success) setProjects(r.projects || []); }).catch(() => {});
  }, []);
  const onPickProject = async (key) => {
    setTProject(key); setTWorkflow(""); setWorkflows([]); setTransitions([]); setTTransition("");
    const p = projects.find((x) => x.key === key);
    const r = await invoke("getProjectWorkflows", { projectKey: key, projectId: p?.id }).catch(() => null);
    if (r && r.success) setWorkflows(r.workflows || []);
  };
  const onPickWorkflow = async (name) => {
    setTWorkflow(name); setTransitions([]); setTTransition("");
    const r = await invoke("getWorkflowTransitions", { workflowName: name }).catch(() => null);
    if (r && r.success) setTransitions(r.transitions || []);
  };

  const list = Array.isArray(rules) ? rules : [];
  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSelected = list.length > 0 && selected.size === list.length;

  const doExport = async () => {
    setBusy(true); setError(null); setNotice(null);
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
      if (res.skipped && res.skipped.length) setNotice(`Exported ${res.envelope.ruleCount} rule${res.envelope.ruleCount !== 1 ? "s" : ""}. Skipped ${res.skipped.length}: ${res.skipped.map((s) => s.reason).join(", ")}`);
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
    setBusy(true); setError(null); setNotice(null); setPlan(null); setRowState({});
    try {
      const res = await invoke("previewImport", { json: importText });
      if (!res || !res.success) { setError((res && res.error) || "Preview failed"); setBusy(false); return; }
      setPlan(res.plan || []);
      // Keep the parsed source rules aligned with the plan rows for the commit step.
      let parsed = []; try { parsed = (JSON.parse(importText).rules) || []; } catch (e) { /* preview already validated */ }
      setParsedRules(parsed);
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const commitRow = async (idx) => {
    if (!tWorkflow || !tTransition) { setError("Pick a target workflow and transition first."); return; }
    setRowState((s) => ({ ...s, [idx]: { status: "busy" } }));
    try {
      const res = await invoke("commitImport", { rule: parsedRules[idx], targetWorkflowName: tWorkflow, targetTransitionId: tTransition });
      if (res && res.success) setRowState((s) => ({ ...s, [idx]: { status: "committed", msg: "Imported" } }));
      else setRowState((s) => ({ ...s, [idx]: { status: res && res.status === "conflict" ? "conflict" : "error", msg: (res && res.error) || "Import failed" } }));
    } catch (e) { setRowState((s) => ({ ...s, [idx]: { status: "error", msg: e.message } })); }
  };

  const commitAllReady = async () => {
    setBusy(true); setError(null);
    for (let i = 0; i < (plan || []).length; i++) {
      if (plan[i].status === "ready" && rowState[i]?.status !== "committed") await commitRow(i);
    }
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
        {notice && <div className="alert alert-warning anim-rise" style={{ marginBottom: "12px" }}><span>{notice}</span></div>}

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
                {/* Target: where the ready rules get created. */}
                <div className="port-target">
                  <span className="port-target-lbl">Import into</span>
                  <div className="port-target-picks">
                    <CustomSelect value={tProject} onChange={onPickProject} placeholder="Project…"
                      options={projects.map((p) => ({ value: p.key, label: p.name || p.key }))} />
                    <CustomSelect value={tWorkflow} onChange={onPickWorkflow} placeholder="Workflow…" disabled={!tProject}
                      options={workflows.map((w) => ({ value: w.name, label: w.name }))} />
                    <CustomSelect value={tTransition} onChange={setTTransition} placeholder="Transition…" disabled={!tWorkflow}
                      options={transitions.map((t) => ({ value: String(t.id), label: t.name || t.toName || String(t.id) }))} />
                  </div>
                </div>
                {plan.map((row, i) => {
                  const rs = rowState[i];
                  const shown = rs && rs.status !== "busy" ? rs.status : row.status;
                  return (
                    <div className="port-plan-row" key={i}>
                      <span className={`port-status port-status-${shown}`}>{STATUS_LABEL[shown] || shown}</span>
                      <span className="port-plan-name">{row.ruleName}</span>
                      <span className="port-plan-type">{(row.type || "").replace("postfunction-", "PF: ")}</span>
                      {row.status === "ready" && (!rs || rs.status === "error" || rs.status === "conflict") && (
                        <button className={`btn-small${rs && rs.status === "busy" ? " is-busy" : ""}`} onClick={() => commitRow(i)} disabled={!tTransition || (rs && rs.status === "busy")}>Import</button>
                      )}
                      {(rs?.msg || (row.notes && row.notes.length > 0)) && <span className="port-plan-note">{rs?.msg || row.notes.join(" · ")}</span>}
                    </div>
                  );
                })}
                <div className="port-actions">
                  <button className={`btn-edit${busy ? " is-busy" : ""}`} onClick={commitAllReady} disabled={busy || !tTransition || !plan.some((r) => r.status === "ready")}>
                    Import all ready
                  </button>
                </div>
                <div className="port-commit-note">
                  Each rule is re-validated server-side and created with a fresh id. A transition already holding a rule of the same type is reported as a conflict, never overwritten.
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
