/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SchedulePicker from "./SchedulePicker";
import AgentConfig from "./AgentConfig";
import FunctionBuilder from "./FunctionBuilder";
import { ModeSwitch, RunStat, RunResultView, RecentLogs } from "./RuleEditorBits";
import { showToast } from "./toast";
import { confirmDialog } from "../confirmDialog";
import { describeCron, validateCron } from "../../../../src/shared/cron.js";
import { DEFAULT_AGENT_ACTIONS, DEFAULT_AGENT_ROUNDS } from "../../../../src/shared/agent-actions.js";

const newStep = () => ({ id: `fn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: "", conditionPrompt: "", operationType: "work_item_query", operationPrompt: "", endpoint: "", method: "GET", variableName: "result1", code: "", includeBackoff: false });
const guessZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } };
const emptyDraft = () => ({
  id: null, name: "", description: "", enabled: true,
  schedule: { cron: "0 9 * * 1-5", timeZone: guessZone() },
  scope: { jql: "", maxIssues: 50 }, mode: "script",
  agent: { instructions: "", allowedActions: DEFAULT_AGENT_ACTIONS, maxRounds: DEFAULT_AGENT_ROUNDS },
  simulationMode: false, suppressNotifications: false,
});
const fmtTime = (iso) => { try { return new Date(iso).toLocaleString(); } catch { return iso || "—"; } };

export default function JobsTab({ invoke, isAdmin, userRole }) {
  const canEdit = isAdmin || userRole === "editor" || userRole === "admin";
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [expandedLogs, setExpandedLogs] = useState({ loading: false, logs: [] });
  const [draft, setDraft] = useState(null);
  const [functions, setFunctions] = useState([newStep()]);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(null); // { id, taskId, status }
  const [runResult, setRunResult] = useState(null);
  const loadToken = useRef(0);
  const pollRef = useRef(0);

  const load = useCallback(async () => {
    const token = ++loadToken.current;
    try {
      const r = await invoke("getScheduledJobs");
      if (token !== loadToken.current) return;
      if (r.success) { setRows(r.jobs || []); setLoadError(null); } else setLoadError(r.error || "Could not load scheduled jobs");
    } catch (e) { if (token === loadToken.current) setLoadError(e.message); }
    if (token === loadToken.current) setLoading(false);
  }, [invoke]);
  useEffect(() => { load(); return () => { pollRef.current += 1; }; }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => `${r.name} ${r.schedule ? describeCron(r.schedule.cron) : ""} ${r.mode}`.toLowerCase().includes(q));
  }, [rows, search]);

  const toggleEnabled = async (row) => {
    setBusyId(row.id);
    try { const r = await invoke("setScheduledJobEnabled", { id: row.id, enabled: !(row.enabled !== false) }); if (r.success) { showToast(r.job.enabled ? "Job enabled" : "Job disabled"); await load(); } else showToast(r.error || "Update failed", "error"); } catch (e) { showToast(e.message, "error"); }
    setBusyId(null);
  };
  const remove = async (row) => {
    const yes = await confirmDialog(`Delete scheduled job "${row.name}"? It will not run again; its execution logs stay.`, { title: "Delete scheduled job", confirmLabel: "Delete" });
    if (!yes) return;
    setBusyId(row.id);
    try { const r = await invoke("deleteScheduledJob", { id: row.id }); if (r.success) { showToast("Job deleted"); if (expandedId === row.id) setExpandedId(null); await load(); } else showToast(r.error || "Delete failed", "error"); } catch (e) { showToast(e.message, "error"); }
    setBusyId(null);
  };
  const expand = async (row) => {
    if (expandedId === row.id) { setExpandedId(null); return; }
    setExpandedId(row.id);
    setExpandedLogs({ loading: true, logs: [] });
    try { const r = await invoke("getLogs", { ruleId: row.id }); setExpandedLogs({ loading: false, logs: (r && r.logs) || [] }); } catch { setExpandedLogs({ loading: false, logs: [] }); }
  };

  // Run now: queue a manual run of a SAVED job and poll every 3s (≤40 tries) —
  // the same getAsyncTaskResult contract FunctionBlock uses for LM Studio codegen.
  const runNow = async (id) => {
    const token = ++pollRef.current;
    setRunning({ id, status: "queuing" }); setRunResult(null);
    try {
      const r = await invoke("runScheduledJobNow", { id });
      if (!r.success) { showToast(r.error || "Could not start the job", "error"); setRunning(null); return; }
      setRunning({ id, taskId: r.taskId, status: "queued" });
      for (let i = 0; i < 40; i++) {
        await new Promise((res) => setTimeout(res, 3000));
        if (token !== pollRef.current) return;
        const p = await invoke("getAsyncTaskResult", { taskId: r.taskId });
        if (!p.success) continue;
        if (p.status === "done") { setRunResult({ ...(p.result || {}), isValid: p.result ? p.result.success !== false : true }); setRunning(null); showToast("Run finished"); load(); return; }
        if (p.status === "error") { setRunResult({ isValid: false, reason: p.error || "Run failed" }); setRunning(null); load(); return; }
        setRunning({ id, taskId: r.taskId, status: p.status === "processing" ? "running" : "queued" });
      }
      setRunResult({ isValid: false, reason: "Timed out waiting for the run (2 min). Check the Execution Logs tab — the run may still complete." });
      setRunning(null);
    } catch (e) { showToast(e.message, "error"); setRunning(null); }
  };

  // editor
  const openNew = () => { setDraft(emptyDraft()); setFunctions([newStep()]); setRunResult(null); };
  const openEdit = async (row) => {
    setBusyId(row.id);
    try {
      const r = await invoke("getScheduledJob", { id: row.id });
      if (!r.success) { showToast(r.error || "Could not open job", "error"); setBusyId(null); return; }
      const j = r.job;
      setDraft({ ...emptyDraft(), ...j, schedule: { ...emptyDraft().schedule, ...(j.schedule || {}) }, scope: j.scope ? { maxIssues: 50, ...j.scope } : { jql: "", maxIssues: 50 }, agent: { ...emptyDraft().agent, ...(j.agent || {}) } });
      setFunctions(Array.isArray(j.functions) && j.functions.length ? j.functions : [newStep()]);
      setRunResult(null);
    } catch (e) { showToast(e.message, "error"); }
    setBusyId(null);
  };
  const closeEditor = () => { setDraft(null); load(); };
  const patch = (p) => setDraft((d) => ({ ...d, ...p }));
  const buildPayload = () => ({ ...draft, scope: draft.scope && draft.scope.jql && draft.scope.jql.trim() ? draft.scope : null, functions: draft.mode === "script" ? functions : [] });
  const validateDraft = () => {
    if (!draft.name.trim()) return "Give the job a name.";
    const v = validateCron(draft.schedule.cron);
    if (!v.ok) return `Fix the schedule: ${v.error}`;
    if (draft.mode === "script" && !functions.some((f) => (f.code || "").trim())) return "Add at least one code step with code (describe it and click Generate).";
    if (draft.mode === "agent" && !draft.agent.instructions.trim()) return "Write instructions for the AI agent.";
    return null;
  };
  const save = async (andClose = false) => {
    const err = validateDraft();
    if (err) { showToast(err, "error"); return null; }
    setSaving(true);
    try {
      const r = await invoke("saveScheduledJob", { job: buildPayload() });
      if (r.success) { setDraft((d) => ({ ...d, id: r.job.id, stats: r.job.stats })); showToast("Job saved"); if (andClose) closeEditor(); return r.job; }
      showToast(r.error || "Save failed", "error");
    } catch (e) { showToast(e.message, "error"); }
    finally { setSaving(false); }
    return null;
  };
  const saveAndRun = async () => { const j = await save(false); if (j) runNow(j.id); };

  const scoped = draft && draft.scope && draft.scope.jql && draft.scope.jql.trim();
  const codegenContext = draft ? { runtime: "job", schedule: draft.schedule, scopeJql: scoped ? draft.scope.jql : null } : null;
  const testContext = draft ? { runtime: "job", jobName: draft.name, scheduledFor: new Date().toISOString(), manual: true, schedule: draft.schedule } : null;

  if (draft) {
    return (
      <div className="section lst-editor anim-rise">
        <div className="section-header">
          <span className="section-title">{draft.id ? "Edit scheduled job" : "New scheduled job"}</span>
          <div className="section-actions">
            <button type="button" className="btn-small" onClick={closeEditor}>← Back to jobs</button>
            <button type="button" className="btn-small" onClick={saveAndRun} disabled={saving || !!running || !canEdit}>{running ? `Running (${running.status})…` : "Save & run now"}</button>
            <button type="button" className="btn-small btn-edit" onClick={() => save(false)} disabled={saving || !canEdit}>{saving ? "Saving…" : "Save"}</button>
            <button type="button" className="btn-small btn-solid" onClick={() => save(true)} disabled={saving || !canEdit}>Save &amp; close</button>
          </div>
        </div>
        <div className="card lst-card">
          <div className="lst-grid">
            <div className="form-group">
              <label className="label" htmlFor="job-name">Name</label>
              <input id="job-name" type="text" className="lst-input" value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder="e.g. Nudge stale In Progress issues" maxLength={120} />
            </div>
            <div className="form-group">
              <label className="label" htmlFor="job-desc">Description (optional)</label>
              <input id="job-desc" type="text" className="lst-input" value={draft.description} onChange={(e) => patch({ description: e.target.value })} placeholder="What this job is for" maxLength={2000} />
            </div>
          </div>
          <div className="form-group">
            <span className="label">Schedule</span>
            <SchedulePicker value={draft.schedule} onChange={(schedule) => patch({ schedule })} />
          </div>
          <div className="form-group">
            <span className="label">Scope (optional) — run once per issue matching this JQL</span>
            <div className="job-scope">
              <input type="text" className="lst-input" value={draft.scope.jql} onChange={(e) => patch({ scope: { ...draft.scope, jql: e.target.value } })} placeholder='e.g. project = LZPT AND status = "In Progress" AND updated <= -7d' spellCheck={false} />
              <span className="job-scope-max"><span className="label">Max issues</span><input type="number" min="1" max="100" className="schp-num" value={draft.scope.maxIssues} onChange={(e) => patch({ scope: { ...draft.scope, maxIssues: Math.min(100, Math.max(1, parseInt(e.target.value, 10) || 50)) } })} /></span>
            </div>
            <span className="hint">{scoped ? "Escalation-style: each matching issue becomes the current issue (api.context.issueKey) for its own run, sharing the ~100 s budget." : "Leave empty to run the steps once per schedule with no current issue (use api.searchJql / api.forIssue)."}</span>
          </div>
          <div className="form-group">
            <span className="label">What happens</span>
            <ModeSwitch value={draft.mode} onChange={(mode) => patch({ mode })} />
          </div>
          {draft.mode === "script" ? (
            <div className="lst-builder">
              <FunctionBuilder functions={functions} setFunctions={setFunctions} codegenContext={codegenContext} testContext={testContext} reviewConfigType="postfunction-static" howItWorks={false} />
            </div>
          ) : (
            <AgentConfig value={draft.agent} onChange={(agent) => patch({ agent })} runtime="job" />
          )}
          <div className="lst-options">
            <label className="lst-check"><input type="checkbox" checked={draft.simulationMode} onChange={(e) => patch({ simulationMode: e.target.checked })} /><span><strong>Simulation mode</strong> — reads are live, writes are logged but never executed.</span></label>
            <label className="lst-check"><input type="checkbox" checked={draft.suppressNotifications} onChange={(e) => patch({ suppressNotifications: e.target.checked })} /><span><strong>Suppress notifications</strong> on field updates (needs project admin; falls back to notifying).</span></label>
            <label className="lst-check"><input type="checkbox" checked={draft.enabled !== false} onChange={(e) => patch({ enabled: e.target.checked })} /><span><strong>Enabled</strong> — runs on schedule. Disabled jobs can still be run manually.</span></label>
          </div>
        </div>
        {(running || runResult) && (
          <div className="card lst-card lst-test">
            <div className="lst-test-head"><span className="section-title">Manual run</span>{running && <span className="hint">Queued on the background worker — {running.status}… (polling)</span>}</div>
            <RunResultView result={runResult} title="Run now" />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="section">
      <div className="section-header">
        <span className="section-title">Scheduled Jobs <span className="lst-count">{rows.length}</span></span>
        <div className="section-actions">
          <input type="text" className="list-search" placeholder="Search jobs…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search jobs" />
          <button type="button" className="btn-small" onClick={load}>Refresh</button>
          {canEdit && <button type="button" className="btn-small btn-solid" onClick={openNew}>+ Add Job</button>}
        </div>
      </div>
      {loadError && <div className="alert alert-warning">{loadError}</div>}
      {runResult && !draft && <div className="card lst-card lst-test"><RunResultView result={runResult} title="Run now" /></div>}
      <div className="card">
        {loading ? (
          <div className="empty-state">Loading scheduled jobs…</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state lst-empty">
            <div className="lst-empty-title">{rows.length ? "No job matches your search." : "No scheduled jobs yet."}</div>
            {!rows.length && <div>A scheduled job runs on a cron schedule (every 5 minutes up to monthly, in any time zone) — once, or per issue of a JQL scope — executing AI-generated code or an AI agent.</div>}
            {!rows.length && canEdit && <button type="button" className="btn-small btn-solid" style={{ marginTop: 12 }} onClick={openNew}>+ Add your first job</button>}
          </div>
        ) : (
          <table className="table lst-table">
            <thead><tr><th>Job</th><th>Schedule</th><th>Scope</th><th>Mode</th><th>Last run</th><th></th></tr></thead>
            <tbody className="stagger">
              {filtered.map((row) => {
                const on = row.enabled !== false;
                const isOpen = expandedId === row.id;
                const isRunning = running && running.id === row.id;
                return (
                  <React.Fragment key={row.id}>
                    <tr className={on ? "" : "lst-row-off"}>
                      <td>
                        <button type="button" className="rule-expand-btn" onClick={() => expand(row)} aria-expanded={isOpen} title="Recent executions">{isOpen ? "▾" : "▸"}</button>
                        <span className="lst-name">{row.name}</span>
                        {!on && <span className="status-badge status-disabled">Disabled</span>}
                        {row.simulationMode && <span className="lst-sim">DRY-RUN</span>}
                        {isRunning && <span className="rule-job-chip running">{running.status}</span>}
                      </td>
                      <td className="job-sched">
                        <span className="job-sched-desc">{row.schedule ? describeCron(row.schedule.cron) : "—"}</span>
                        <span className="job-sched-zone">{row.schedule ? row.schedule.timeZone : ""}{row.stats && row.stats.nextRunAt && on ? ` · next ${fmtTime(row.stats.nextRunAt)}` : ""}</span>
                      </td>
                      <td className="lst-scope">{row.scoped ? "Per JQL issue" : "Once"}</td>
                      <td><span className={`type-badge ${row.mode === "agent" ? "lst-mode-agent" : "lst-mode-script"}`}>{row.mode === "agent" ? "AI agent" : "Code"}</span></td>
                      <td><RunStat stats={row.stats} /></td>
                      <td className="row-actions">
                        {canEdit && <button type="button" className="btn-small btn-solid" onClick={() => runNow(row.id)} disabled={!!running || busyId === row.id}>▶ Run now</button>}
                        {canEdit && <button type="button" className="btn-small btn-edit" onClick={() => openEdit(row)} disabled={busyId === row.id}>Edit</button>}
                        {canEdit && <button type="button" className="btn-small" onClick={() => toggleEnabled(row)} disabled={busyId === row.id}>{on ? "Disable" : "Enable"}</button>}
                        {canEdit && <button type="button" className="btn-small btn-danger" onClick={() => remove(row)} disabled={busyId === row.id}>Delete</button>}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="rule-accordion-row"><td colSpan={6} className="rule-accordion-cell"><div className="rule-accordion-inner anim-rise"><div className="rule-accordion-title">Recent executions</div><RecentLogs logs={expandedLogs.logs} loading={expandedLogs.loading} /></div></td></tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
