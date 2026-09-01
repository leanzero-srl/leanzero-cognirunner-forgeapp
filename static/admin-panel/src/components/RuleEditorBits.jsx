/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from "react";
import CustomSelect from "./CustomSelect";

// Small building blocks shared by ListenersTab and JobsTab.

/** Two big solid buttons: Code steps | AI agent. */
export function ModeSwitch({ value, onChange, disabled = false }) {
  return (
    <div className="mode-switch" role="radiogroup" aria-label="Execution mode">
      <button type="button" role="radio" aria-checked={value === "script"} className={`mode-btn mode-script ${value === "script" ? "on" : ""}`} onClick={() => onChange("script")} disabled={disabled}>
        <span className="mode-btn-title">Code steps</span>
        <span className="mode-btn-sub">Describe → AI generates JavaScript → test → fix. Deterministic at runtime, no AI cost per run.</span>
      </button>
      <button type="button" role="radio" aria-checked={value === "agent"} className={`mode-btn mode-agent ${value === "agent" ? "on" : ""}`} onClick={() => onChange("agent")} disabled={disabled}>
        <span className="mode-btn-title">AI agent</span>
        <span className="mode-btn-sub">Plain-language instructions; the AI reads the context and acts through the actions you allow. AI cost per run.</span>
      </button>
    </div>
  );
}

/** Free-text chips (Enter / comma adds). */
export function ChipsInput({ value = [], onChange, placeholder, disabled = false, transform = (s) => s, ariaLabel }) {
  const [text, setText] = useState("");
  const add = (raw) => {
    const parts = String(raw).split(/[,\n]/).map((s) => transform(s.trim())).filter(Boolean);
    if (!parts.length) return;
    const next = [...value];
    for (const p of parts) if (!next.includes(p)) next.push(p);
    onChange(next);
    setText("");
  };
  return (
    <div className={`chips ${disabled ? "chips-disabled" : ""}`}>
      {value.map((v) => (
        <span key={v} className="chips-chip">{v}{!disabled && <button type="button" className="chips-x" aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))}>×</button>}</span>
      ))}
      <input
        type="text" className="chips-input" value={text} placeholder={value.length ? "" : placeholder} disabled={disabled} aria-label={ariaLabel || placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(text); } else if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1)); }}
        onBlur={() => { if (text.trim()) add(text); }}
      />
    </div>
  );
}

/** Project multi-picker backed by the listProjects resolver (chips + searchable dropdown). */
export function ProjectPicker({ invoke, value = [], onChange, disabled = false }) {
  const [projects, setProjects] = useState([]);
  useEffect(() => {
    let cancelled = false;
    invoke("listProjects").then((r) => {
      if (cancelled) return;
      const rows = (r && (r.projects || r.values)) || [];
      setProjects(rows.map((p) => ({ key: p.key, name: p.name })).filter((p) => p.key));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [invoke]);
  const options = useMemo(() => projects.filter((p) => !value.includes(p.key)).map((p) => ({ value: p.key, label: `${p.key} — ${p.name}` })), [projects, value]);
  return (
    <div className="projpick">
      <div className="chips">
        {value.length === 0 && <span className="chips-none">All projects</span>}
        {value.map((k) => <span key={k} className="chips-chip chips-chip-project">{k}{!disabled && <button type="button" className="chips-x" aria-label={`Remove ${k}`} onClick={() => onChange(value.filter((x) => x !== k))}>×</button>}</span>)}
      </div>
      <div className="projpick-add">
        <CustomSelect value="" onChange={(k) => { if (k && !value.includes(k)) onChange([...value, k]); }} options={options} placeholder={projects.length ? "Add a project…" : "Loading projects…"} searchable searchPlaceholder="Search projects…" ariaLabel="Add project filter" disabled={disabled || !projects.length} />
      </div>
    </div>
  );
}

const fmtTime = (iso) => { try { return new Date(iso).toLocaleString(); } catch { return iso; } };

/** Status dot + last-run text for list rows. */
export function RunStat({ stats }) {
  const s = stats || {};
  if (!s.lastRunAt) return <span className="runstat runstat-never">never ran</span>;
  const cls = s.lastStatus === "ok" ? "ok" : s.lastStatus === "error" ? "err" : "skip";
  return (
    <span className={`runstat runstat-${cls}`} title={s.lastError || ""}>
      <span className="runstat-dot" />
      {fmtTime(s.lastRunAt)} · {s.runCount || 0} run{(s.runCount || 0) === 1 ? "" : "s"}{s.errorCount ? ` · ${s.errorCount} err` : ""}
    </span>
  );
}

/** Result of a test run / run-now: verdict, reason, tool calls, changes, log lines. */
export function RunResultView({ result, title = "Result" }) {
  if (!result) return null;
  const ok = result.isValid === true || result.success === true;
  const skipped = result.skipped === true || result.decision === "SKIP";
  return (
    <div className={`runres ${ok ? "runres-ok" : skipped ? "runres-skip" : "runres-err"}`}>
      <div className="runres-head">
        <span className={`runres-badge ${ok ? "ok" : skipped ? "skip" : "err"}`}>{ok ? "PASS" : skipped ? "SKIPPED" : "FAILED"}</span>
        <span className="runres-title">{title}</span>
        {typeof result.executionTimeMs === "number" && <span className="runres-ms">{result.executionTimeMs} ms</span>}
        {result.tokens > 0 && <span className="runres-ms">{result.tokens} tokens</span>}
        {result.eventUsed && <span className="runres-ms">event: {result.eventUsed}</span>}
      </div>
      {result.reason && <div className="runres-reason">{result.reason}</div>}
      {result.gate && <div className="runres-gate">AI condition: <strong>{result.gate.match ? "met" : "not met"}</strong> — {result.gate.reason}</div>}
      {result.recommendation && <div className="runres-rec">{result.recommendation}</div>}
      {Array.isArray(result.issues) && result.issues.length > 0 && (
        <div className="runres-issues">{result.issues.map((i) => <span key={i.key} className={`runres-issue ${i.success ? "ok" : "err"}`} title={i.reason}>{i.key}</span>)}</div>
      )}
      {Array.isArray(result.toolCalls) && result.toolCalls.length > 0 && (
        <div className="runres-tools">{result.toolCalls.map((t, i) => <span key={i} className={`runres-tool ${t.ok ? "" : "err"}`}>{t.name}</span>)}</div>
      )}
      {Array.isArray(result.changes) && result.changes.length > 0 && (
        <details className="runres-details" open>
          <summary>{result.changes.length} change{result.changes.length === 1 ? "" : "s"}{result.changes.some((c) => c.simulated) ? " (simulated — nothing written)" : ""}</summary>
          <ul className="runres-changes">{result.changes.map((c, i) => <li key={i}><code>{c.action}</code> {c.key || c.issue || c.from || ""} {c.fields ? JSON.stringify(c.fields).slice(0, 160) : c.name || c.transitionId || c.accountId || ""}</li>)}</ul>
        </details>
      )}
      {Array.isArray(result.logs) && result.logs.length > 0 && (
        <details className="runres-details">
          <summary>{result.logs.length} log line{result.logs.length === 1 ? "" : "s"}</summary>
          <pre className="runres-pre">{result.logs.join("\n")}</pre>
        </details>
      )}
    </div>
  );
}

/** Compact recent-logs list for one rule (Listeners / Jobs tabs). */
export function RecentLogs({ logs, loading }) {
  if (loading) return <div className="hint">Loading logs…</div>;
  if (!logs || !logs.length) return <div className="hint">No executions logged yet.</div>;
  return (
    <div className="recent-logs">
      {logs.map((l) => (
        <RunResultView key={l.id} result={l} title={`${l.eventType || l.fieldId || ""} · ${l.issueKey || ""} · ${fmtTime(l.timestamp)}`} />
      ))}
    </div>
  );
}
