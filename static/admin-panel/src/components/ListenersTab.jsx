/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CustomSelect from "./CustomSelect";
import EventPicker from "./EventPicker";
import AgentConfig from "./AgentConfig";
import FunctionBuilder from "./FunctionBuilder";
import IssuePicker from "./IssuePicker";
import { ModeSwitch, ChipsInput, ProjectPicker, RunStat, RunResultView, RecentLogs } from "./RuleEditorBits";
import { showToast } from "./toast";
import { confirmDialog } from "../confirmDialog";
import { getEvent, eventLabel, filtersForEvents, EVENT_CATEGORIES } from "../../../../src/shared/jira-events.js";
import { DEFAULT_AGENT_ACTIONS, DEFAULT_AGENT_ROUNDS } from "../../../../src/shared/agent-actions.js";

const newStep = () => ({ id: `fn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: "", conditionPrompt: "", operationType: "work_item_query", operationPrompt: "", endpoint: "", method: "GET", variableName: "result1", code: "", includeBackoff: false });
const emptyDraft = () => ({
  id: null, name: "", description: "", enabled: true, events: [],
  filters: { projectKeys: [], issueTypes: [], jql: "", changedFields: [], commentPattern: "" },
  ignoreSelf: true, aiCondition: "", mode: "script",
  agent: { instructions: "", allowedActions: DEFAULT_AGENT_ACTIONS, maxRounds: DEFAULT_AGENT_ROUNDS },
  simulationMode: false, suppressNotifications: false,
});
const hueOf = (cat) => (EVENT_CATEGORIES.find((c) => c.id === cat) || {}).hue || "#475569";

export default function ListenersTab({ invoke, isAdmin, userRole, siteUrl, router }) {
  const canEdit = isAdmin || userRole === "editor" || userRole === "admin";
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [expandedLogs, setExpandedLogs] = useState({ loading: false, logs: [] });
  // editor
  const [draft, setDraft] = useState(null);
  const [functions, setFunctions] = useState([newStep()]);
  const [saving, setSaving] = useState(false);
  const [testKey, setTestKey] = useState("");
  const [testEvent, setTestEvent] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [sample, setSample] = useState(null);
  const [sampleLoading, setSampleLoading] = useState(false);
  const loadToken = useRef(0);

  const load = useCallback(async () => {
    const token = ++loadToken.current;
    try {
      const r = await invoke("getListeners");
      if (token !== loadToken.current) return;
      if (r.success) { setRows(r.listeners || []); setLoadError(null); } else setLoadError(r.error || "Could not load listeners");
    } catch (e) { if (token === loadToken.current) setLoadError(e.message); }
    if (token === loadToken.current) setLoading(false);
  }, [invoke]);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => `${r.name} ${(r.events || []).map(eventLabel).join(" ")} ${(r.projectKeys || []).join(" ")} ${r.mode}`.toLowerCase().includes(q));
  }, [rows, search]);

  // ── list actions ──
  const toggleEnabled = async (row) => {
    setBusyId(row.id);
    try {
      const r = await invoke("setListenerEnabled", { id: row.id, enabled: !(row.enabled !== false) });
      if (r.success) { showToast(r.listener.enabled ? "Listener enabled" : "Listener disabled"); await load(); } else showToast(r.error || "Update failed", "error");
    } catch (e) { showToast(e.message, "error"); }
    setBusyId(null);
  };
  const remove = async (row) => {
    const yes = await confirmDialog(`Delete listener "${row.name}"? Its execution logs stay; the rule stops firing immediately.`, { title: "Delete listener", confirmLabel: "Delete" });
    if (!yes) return;
    setBusyId(row.id);
    try { const r = await invoke("deleteListener", { id: row.id }); if (r.success) { showToast("Listener deleted"); if (expandedId === row.id) setExpandedId(null); await load(); } else showToast(r.error || "Delete failed", "error"); } catch (e) { showToast(e.message, "error"); }
    setBusyId(null);
  };
  const expand = async (row) => {
    if (expandedId === row.id) { setExpandedId(null); return; }
    setExpandedId(row.id);
    setExpandedLogs({ loading: true, logs: [] });
    try { const r = await invoke("getLogs", { ruleId: row.id }); setExpandedLogs({ loading: false, logs: (r && r.logs) || [] }); } catch { setExpandedLogs({ loading: false, logs: [] }); }
  };

  // ── editor ──
  const openNew = () => { setDraft(emptyDraft()); setFunctions([newStep()]); setTestResult(null); setTestKey(""); setTestEvent(""); setSample(null); };
  const openEdit = async (row) => {
    setBusyId(row.id);
    try {
      const r = await invoke("getListener", { id: row.id });
      if (!r.success) { showToast(r.error || "Could not open listener", "error"); setBusyId(null); return; }
      const l = r.listener;
      setDraft({ ...emptyDraft(), ...l, filters: { ...emptyDraft().filters, ...(l.filters || {}) }, agent: { ...emptyDraft().agent, ...(l.agent || {}) } });
      setFunctions(Array.isArray(l.functions) && l.functions.length ? l.functions : [newStep()]);
      setTestResult(null); setTestKey(""); setTestEvent((l.events || [])[0] || ""); setSample(null);
    } catch (e) { showToast(e.message, "error"); }
    setBusyId(null);
  };
  const closeEditor = () => { setDraft(null); load(); };
  const patch = (p) => setDraft((d) => ({ ...d, ...p }));
  const patchFilters = (p) => setDraft((d) => ({ ...d, filters: { ...d.filters, ...p } }));
  const buildPayload = () => ({ ...draft, functions: draft.mode === "script" ? functions : [] });
  const validateDraft = () => {
    if (!draft.name.trim()) return "Give the listener a name.";
    if (!draft.events.length) return "Pick at least one event.";
    if (draft.mode === "script" && !functions.some((f) => (f.code || "").trim())) return "Add at least one code step with code (describe it and click Generate).";
    if (draft.mode === "agent" && !draft.agent.instructions.trim()) return "Write instructions for the AI agent.";
    return null;
  };
  const save = async (andClose = false) => {
    const err = validateDraft();
    if (err) { showToast(err, "error"); return null; }
    setSaving(true);
    try {
      const r = await invoke("saveListener", { listener: buildPayload() });
      if (r.success) { setDraft((d) => ({ ...d, id: r.listener.id, stats: r.listener.stats })); showToast("Listener saved"); if (andClose) closeEditor(); return r.listener; }
      showToast(r.error || "Save failed", "error");
    } catch (e) { showToast(e.message, "error"); }
    finally { setSaving(false); }
    return null;
  };
  const runTest = async () => {
    const err = validateDraft();
    if (err) { showToast(err, "error"); return; }
    setTesting(true); setTestResult(null);
    try {
      const r = await invoke("testListener", { listener: buildPayload(), issueKey: testKey.trim() || null, eventType: testEvent || draft.events[0] });
      if (r.success) {
        setTestResult(r.result);
        // An unsaved draft gets its id minted by the test run; adopt it so the later Save
        // keeps the same identity and the test entry shows up in this listener's log history.
        if (!draft.id && r.result && r.result.ruleId) patch({ id: r.result.ruleId });
      } else setTestResult({ isValid: false, reason: r.error || "Test failed" });
    } catch (e) { setTestResult({ isValid: false, reason: e.message }); }
    setTesting(false);
  };
  const loadSample = async () => {
    const ev = testEvent || draft.events[0];
    if (!ev) return;
    setSampleLoading(true);
    try { const r = await invoke("getEventSample", { eventType: ev }); setSample(r.success ? (r.sample || { none: true, eventType: ev }) : { none: true, eventType: ev }); } catch { setSample({ none: true, eventType: ev }); }
    setSampleLoading(false);
  };

  const relevantFilters = draft ? filtersForEvents(draft.events) : [];
  const testEventOptions = draft ? draft.events.map((id) => ({ value: id, label: eventLabel(id) })) : [];
  const testContext = draft ? { runtime: "listener", eventType: testEvent || draft.events[0] || null, event: sample && sample.payload ? sample.payload : { eventType: testEvent || draft.events[0] || null, _note: "synthetic — no captured payload yet" } } : null;
  const codegenContext = draft ? { runtime: "listener", eventTypes: draft.events } : null;

  // ─────────────────────────── editor view ───────────────────────────
  if (draft) {
    return (
      <div className="section lst-editor anim-rise">
        <div className="section-header">
          <span className="section-title">{draft.id ? "Edit listener" : "New listener"}</span>
          <div className="section-actions">
            <button type="button" className="btn-small" onClick={closeEditor}>← Back to listeners</button>
            <button type="button" className="btn-small btn-edit" onClick={() => save(false)} disabled={saving || !canEdit}>{saving ? "Saving…" : "Save"}</button>
            <button type="button" className="btn-small btn-solid" onClick={() => save(true)} disabled={saving || !canEdit}>Save &amp; close</button>
          </div>
        </div>
        <div className="card lst-card">
          <div className="lst-grid">
            <div className="form-group">
              <label className="label" htmlFor="lst-name">Name</label>
              <input id="lst-name" type="text" className="lst-input" value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder="e.g. Escalate customer complaints" maxLength={120} />
            </div>
            <div className="form-group">
              <label className="label" htmlFor="lst-desc">Description (optional)</label>
              <input id="lst-desc" type="text" className="lst-input" value={draft.description} onChange={(e) => patch({ description: e.target.value })} placeholder="What this listener is for" maxLength={2000} />
            </div>
          </div>

          <div className="form-group">
            <span className="label">When these Jira events fire</span>
            <EventPicker value={draft.events} onChange={(events) => { patch({ events }); if (!events.includes(testEvent)) setTestEvent(events[0] || ""); }} />
          </div>

          <div className="form-group">
            <span className="label">Only when…</span>
            <div className="lst-filters">
              <div className="lst-filter">
                <span className="lst-filter-label">Projects</span>
                <ProjectPicker invoke={invoke} value={draft.filters.projectKeys} onChange={(projectKeys) => patchFilters({ projectKeys })} />
              </div>
              {relevantFilters.includes("issueTypes") && (
                <div className="lst-filter">
                  <span className="lst-filter-label">Issue types</span>
                  <ChipsInput value={draft.filters.issueTypes} onChange={(issueTypes) => patchFilters({ issueTypes })} placeholder="Any issue type — type a name and press Enter (e.g. Bug)" />
                </div>
              )}
              {relevantFilters.includes("changedFields") && (
                <div className="lst-filter">
                  <span className="lst-filter-label">Changed fields</span>
                  <ChipsInput value={draft.filters.changedFields} onChange={(changedFields) => patchFilters({ changedFields })} placeholder="Any field — e.g. priority, status, customfield_10010" />
                  <span className="hint">Applies to "Issue updated" only: fire when at least one of these fields is in the changelog.</span>
                </div>
              )}
              {relevantFilters.includes("commentPattern") && (
                <div className="lst-filter">
                  <span className="lst-filter-label">Comment matches (regex)</span>
                  <input type="text" className="lst-input" value={draft.filters.commentPattern} onChange={(e) => patchFilters({ commentPattern: e.target.value })} placeholder="e.g. urgent|asap|escalat" spellCheck={false} />
                </div>
              )}
              {relevantFilters.includes("jql") && (
                <div className="lst-filter">
                  <span className="lst-filter-label">Issue matches JQL</span>
                  <input type="text" className="lst-input" value={draft.filters.jql} onChange={(e) => patchFilters({ jql: e.target.value })} placeholder='e.g. priority in (High, Highest) AND labels != ignore' spellCheck={false} />
                </div>
              )}
              <label className="lst-check">
                <input type="checkbox" checked={draft.ignoreSelf !== false} onChange={(e) => patch({ ignoreSelf: e.target.checked })} />
                <span><strong>Ignore events caused by this app</strong> — prevents loops where a listener's own writes re-fire it (recommended).</span>
              </label>
            </div>
          </div>

          <div className="form-group">
            <label className="label" htmlFor="lst-aicond">AI condition (optional)</label>
            <input id="lst-aicond" type="text" className="lst-input" value={draft.aiCondition} onChange={(e) => patch({ aiCondition: e.target.value })} placeholder="e.g. the comment is a customer complaint or asks for an escalation" maxLength={1500} />
            <span className="hint">A plain-language gate the AI evaluates before running (one cheap classification call). Leave empty to always run when the filters match.</span>
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
            <AgentConfig value={draft.agent} onChange={(agent) => patch({ agent })} runtime="listener" />
          )}

          <div className="lst-options">
            <label className="lst-check">
              <input type="checkbox" checked={draft.simulationMode} onChange={(e) => patch({ simulationMode: e.target.checked })} />
              <span><strong>Simulation mode</strong> — reads are live, writes are logged but never executed.</span>
            </label>
            <label className="lst-check">
              <input type="checkbox" checked={draft.suppressNotifications} onChange={(e) => patch({ suppressNotifications: e.target.checked })} />
              <span><strong>Suppress notifications</strong> on field updates (needs project admin; falls back to notifying).</span>
            </label>
            <label className="lst-check">
              <input type="checkbox" checked={draft.enabled !== false} onChange={(e) => patch({ enabled: e.target.checked })} />
              <span><strong>Enabled</strong></span>
            </label>
          </div>
        </div>

        <div className="card lst-card lst-test">
          <div className="lst-test-head">
            <span className="section-title">Test with an issue</span>
            <span className="hint">Builds a synthetic event from a real issue and runs the whole listener in simulation — filters, AI condition, then the code steps or agent. Nothing is written.</span>
          </div>
          <div className="lst-test-row">
            <div className="lst-test-field"><span className="label">Issue</span><IssuePicker value={testKey} onChange={setTestKey} /></div>
            <div className="lst-test-field"><span className="label">Event</span><CustomSelect value={testEvent || draft.events[0] || ""} onChange={setTestEvent} options={testEventOptions} placeholder="Pick an event" ariaLabel="Test event" disabled={!draft.events.length} /></div>
            <div className="lst-test-actions">
              <button type="button" className="btn-small btn-solid" onClick={runTest} disabled={testing || !draft.events.length}>{testing ? "Running…" : "▶ Run test"}</button>
              <button type="button" className="btn-small" onClick={loadSample} disabled={sampleLoading || !draft.events.length}>{sampleLoading ? "…" : "Show last real payload"}</button>
            </div>
          </div>
          {sample && (
            <div className="lst-sample">
              {sample.none ? <span className="hint">No payload captured yet for {eventLabel(sample.eventType)} — it appears here after the event fires once on this site (the editor's test uses a synthetic event until then).</span>
                : <><span className="hint">Captured {new Date(sample.capturedAt).toLocaleString()} — this is what <code>api.context.event</code> looks like for {eventLabel(sample.eventType)}:</span><pre className="runres-pre">{JSON.stringify(sample.payload, null, 2).slice(0, 12000)}</pre></>}
            </div>
          )}
          <RunResultView result={testResult} title="Test run (simulated)" />
        </div>
      </div>
    );
  }

  // ─────────────────────────── list view ───────────────────────────
  return (
    <div className="section">
      <div className="section-header">
        <span className="section-title">Listeners <span className="lst-count">{rows.length}</span></span>
        <div className="section-actions">
          <input type="text" className="list-search" placeholder="Search listeners…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search listeners" />
          <button type="button" className="btn-small" onClick={load}>Refresh</button>
          {canEdit && <button type="button" className="btn-small btn-solid" onClick={openNew}>+ Add Listener</button>}
        </div>
      </div>
      {loadError && <div className="alert alert-warning">{loadError}</div>}
      <div className="card">
        {loading ? (
          <div className="empty-state">Loading listeners…</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state lst-empty">
            <div className="lst-empty-title">{rows.length ? "No listener matches your search." : "No listeners yet."}</div>
            {!rows.length && <div>A listener reacts to Jira events — issue created, comment added, sprint started, version released, 68 events in all — and runs AI-generated code or an AI agent with the actions you allow.</div>}
            {!rows.length && canEdit && <button type="button" className="btn-small btn-solid" style={{ marginTop: 12 }} onClick={openNew}>+ Add your first listener</button>}
          </div>
        ) : (
          <table className="table lst-table">
            <thead><tr><th>Listener</th><th>Events</th><th>Scope</th><th>Mode</th><th>Last run</th><th></th></tr></thead>
            <tbody className="stagger">
              {filtered.map((row) => {
                const on = row.enabled !== false;
                const evs = row.events || [];
                const isOpen = expandedId === row.id;
                return (
                  <React.Fragment key={row.id}>
                    <tr className={on ? "" : "lst-row-off"}>
                      <td>
                        <button type="button" className="rule-expand-btn" onClick={() => expand(row)} aria-expanded={isOpen} title="Recent executions">{isOpen ? "▾" : "▸"}</button>
                        <span className="lst-name">{row.name}</span>
                        {!on && <span className="status-badge status-disabled">Disabled</span>}
                        {row.simulationMode && <span className="lst-sim">DRY-RUN</span>}
                        {row.hasAiCondition && <span className="lst-aic">AI GATE</span>}
                      </td>
                      <td>
                        <span className="lst-evs">
                          {evs.slice(0, 3).map((id) => { const e = getEvent(id); return <span key={id} className="evp-chip evp-chip-sm" style={{ background: hueOf(e ? e.category : "") }}>{eventLabel(id)}</span>; })}
                          {evs.length > 3 && <span className="lst-more">+{evs.length - 3}</span>}
                        </span>
                      </td>
                      <td className="lst-scope">{row.projectKeys && row.projectKeys.length ? row.projectKeys.join(", ") : "All projects"}</td>
                      <td><span className={`type-badge ${row.mode === "agent" ? "lst-mode-agent" : "lst-mode-script"}`}>{row.mode === "agent" ? "AI agent" : "Code"}</span></td>
                      <td><RunStat stats={row.stats} /></td>
                      <td className="row-actions">
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
