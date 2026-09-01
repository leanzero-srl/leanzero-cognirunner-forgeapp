/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { AGENT_ACTIONS, DEFAULT_AGENT_ACTIONS, MAX_AGENT_ROUNDS, DEFAULT_AGENT_ROUNDS } from "../../../../src/shared/agent-actions.js";

// "AI agent" mode editor: plain-language instructions + the allow-list of actions
// the agent may take (one tool each; src/shared/agent-actions.js is the single source).
export default function AgentConfig({ value, onChange, runtime = "listener", disabled = false }) {
  const v = value || { instructions: "", allowedActions: DEFAULT_AGENT_ACTIONS, maxRounds: DEFAULT_AGENT_ROUNDS };
  const allowed = new Set(v.allowedActions || []);
  const set = (patch) => onChange({ ...v, ...patch });
  const toggle = (id) => {
    const next = new Set(allowed);
    if (next.has(id)) next.delete(id); else next.add(id);
    set({ allowedActions: AGENT_ACTIONS.filter((a) => a.kind !== "control" && next.has(a.id)).map((a) => a.id) });
  };
  const reads = AGENT_ACTIONS.filter((a) => a.kind === "read");
  const writes = AGENT_ACTIONS.filter((a) => a.kind === "write");
  const placeholder = runtime === "job"
    ? "e.g. Find issues in project LZPT that have been In Progress for more than 7 days without an update. For each one, add a polite comment asking the assignee for a status update and add the label 'stale'. Skip issues that already carry the label."
    : "e.g. When the comment reads like a customer complaint or an escalation request, add the label 'escalate', set priority to Highest if it is lower, and reply with a short acknowledgement comment. Otherwise do nothing.";

  return (
    <div className="agc">
      <div className="form-group">
        <label className="label" htmlFor="agc-instructions">Instructions for the AI agent</label>
        <textarea id="agc-instructions" className="agc-textarea" rows={6} value={v.instructions || ""} placeholder={placeholder} onChange={(e) => set({ instructions: e.target.value })} disabled={disabled} maxLength={6000} />
        <p className="hint">Write what should happen in plain language. The agent reads the {runtime === "job" ? "job context and the issues it finds" : "event and the issue"} as untrusted data and acts ONLY through the actions you allow below, then reports what it did in the execution log.</p>
      </div>
      <div className="form-group">
        <span className="label">Allowed actions</span>
        <div className="agc-actions">
          <div className="agc-col">
            <div className="agc-col-head"><span className="agc-kind agc-kind-read">READ</span> never changes Jira</div>
            {reads.map((a) => (
              <label key={a.id} className={`agc-action ${allowed.has(a.id) ? "on" : ""}`}>
                <input type="checkbox" checked={allowed.has(a.id)} onChange={() => toggle(a.id)} disabled={disabled} />
                <span className="agc-action-main"><span className="agc-action-label">{a.label}</span><span className="agc-action-desc">{a.description}</span></span>
              </label>
            ))}
          </div>
          <div className="agc-col">
            <div className="agc-col-head"><span className="agc-kind agc-kind-write">WRITE</span> changes Jira (simulation mode records instead)</div>
            {writes.map((a) => (
              <label key={a.id} className={`agc-action ${allowed.has(a.id) ? "on" : ""}`}>
                <input type="checkbox" checked={allowed.has(a.id)} onChange={() => toggle(a.id)} disabled={disabled} />
                <span className="agc-action-main"><span className="agc-action-label">{a.label}</span><span className="agc-action-desc">{a.description}</span></span>
              </label>
            ))}
          </div>
        </div>
        <p className="hint"><strong>Finish</strong> is always available: the agent ends every run with a one-line summary that lands in the execution log.</p>
      </div>
      <div className="form-group agc-rounds">
        <label className="label" htmlFor="agc-rounds">Max tool rounds</label>
        <input id="agc-rounds" type="number" min="1" max={MAX_AGENT_ROUNDS} value={v.maxRounds || DEFAULT_AGENT_ROUNDS} onChange={(e) => set({ maxRounds: Math.min(MAX_AGENT_ROUNDS, Math.max(1, parseInt(e.target.value, 10) || DEFAULT_AGENT_ROUNDS)) })} disabled={disabled} className="schp-num" />
        <span className="hint" style={{ marginLeft: 10 }}>Each round = one model call that may execute several actions. Caps cost and runtime (1–{MAX_AGENT_ROUNDS}).</span>
      </div>
    </div>
  );
}
