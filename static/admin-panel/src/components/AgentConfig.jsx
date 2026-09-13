/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from "react";
import { AGENT_ACTIONS, DEFAULT_AGENT_ACTIONS, MAX_AGENT_ROUNDS, DEFAULT_AGENT_ROUNDS, agentActionNamespace } from "../../../../src/shared/agent-actions.js";
import { agentCapabilityCopy } from "../../../../src/shared/edition.js";

// "AI agent" mode editor: plain-language instructions + the allow-list of actions
// the agent may take (one tool each; src/shared/agent-actions.js is the single source).
export default function AgentConfig({ value, onChange, runtime = "listener", scoped = false, disabled = false, invoke = null }) {
  /* 1.4 commit 6 - THE CODE COLUMN'S GATE.
     The verdict is READ, never derived. A frontend that inferred "Coder is on" from the
     edition would be wrong for three of the five reasons (a BYOK site is enabled on
     Standard, a Coder site on Haiku is not, a spent allowance pauses it), and the backend
     would then refuse every save the checklist had offered - the F-233 shape, a control
     whose refusal is told as an outage.
     Starts as `null` = NOT YET ANSWERED, and the column renders DISABLED in that state:
     failing to the restrictive side is the FRAME's decision for this surface, so a slow or
     broken read can never produce a tickable git action. */
  const [capability, setCapability] = useState(null);
  useEffect(() => {
    if (!invoke) { setCapability({ enabled: false, reason: "unknown" }); return; }
    let live = true;
    invoke("getAgentCapability")
      .then((r) => { if (live) setCapability(r && r.success ? r : { enabled: false, reason: "unknown" }); })
      // A THROW is transport. It is still "we do not know", which is still off.
      .catch(() => { if (live) setCapability({ enabled: false, reason: "unknown" }); });
    return () => { live = false; };
  }, [invoke]);
  const v = value || { instructions: "", allowedActions: DEFAULT_AGENT_ACTIONS, maxRounds: DEFAULT_AGENT_ROUNDS };
  const allowed = new Set(v.allowedActions || []);
  const set = (patch) => onChange({ ...v, ...patch });
  const toggle = (id) => {
    const next = new Set(allowed);
    if (next.has(id)) next.delete(id); else next.add(id);
    set({ allowedActions: AGENT_ACTIONS.filter((a) => a.kind !== "control" && next.has(a.id)).map((a) => a.id) });
  };
  const isJira = (a) => agentActionNamespace(a) === "jira";
  const reads = AGENT_ACTIONS.filter((a) => a.kind === "read" && isJira(a));
  const writes = AGENT_ACTIONS.filter((a) => a.kind === "write" && isJira(a));
  /* The CODE column is the `git` NAMESPACE, read from the catalogue - never a hardcoded
     id list here (src/shared/agent-actions.js is the one home, and a second list is how
     an action ships with a gate in one place and not the other). */
  const gitActions = AGENT_ACTIONS.filter((a) => agentActionNamespace(a) === "git");
  const gitReads = gitActions.filter((a) => a.kind === "read");
  const gitWrites = gitActions.filter((a) => a.kind === "write");
  const codeOn = !!(capability && capability.enabled);
  const codeCopy = agentCapabilityCopy(capability ? capability.reason : "unknown");
  const codeDisabled = disabled || !codeOn;

  /* `confirm` and `dangerous` are the catalogue's own flags and each gets ONE badge, so
     an admin ticking a box can see before saving why a headless rule may refuse it. The
     words are the gate's rules restated, not new policy. */
  const markers = (a) => (
    <>
      {a.confirm && <span className="agc-mark agc-mark-confirm" title="Writes to somebody's repository. Only an ADMIN may save a rule that holds it.">ADMIN ONLY</span>}
      {a.dangerous && <span className="agc-mark agc-mark-danger" title="Approves code, blocks a merge or ships to an environment. An externally triggered run never holds it.">DANGEROUS</span>}
    </>
  );
  const actionRow = (a, rowDisabled) => (
    <label key={a.id} className={`agc-action ${allowed.has(a.id) ? "on" : ""} ${rowDisabled ? "agc-action-off" : ""}`}>
      <input type="checkbox" checked={allowed.has(a.id)} onChange={() => toggle(a.id)} disabled={rowDisabled} />
      <span className="agc-action-main">
        <span className="agc-action-label">{a.label}{markers(a)}</span>
        <span className="agc-action-desc">{a.description}</span>
      </span>
    </label>
  );
  const placeholder = runtime === "job" && scoped
    ? "e.g. For the current issue, add a polite comment asking the assignee for an update and add the label stale. Skip it if it already has that label. The job selects each issue from the scope above."
    : runtime === "job"
    ? "e.g. Find issues in project PROJ that have been In Progress for more than 7 days without an update. For each one, add a polite comment asking the assignee for a status update and add the label 'stale'. Skip issues that already carry the label."
    : "e.g. When the comment reads like a customer complaint or an escalation request, add the label 'escalate', set priority to Highest if it is lower, and reply with a short acknowledgement comment. Otherwise do nothing.";

  return (
    <div className="agc">
      <div className="form-group">
        <label className="label" htmlFor="agc-instructions">Instructions for the AI agent</label>
        <textarea id="agc-instructions" className="agc-textarea" rows={6} value={v.instructions || ""} placeholder={placeholder} onChange={(e) => set({ instructions: e.target.value })} disabled={disabled} maxLength={6000} />
        <p className="hint">Write what should happen in plain language. The agent reads the {runtime === "job" ? (scoped ? "job context and the current issue" : "job context and the issues it finds") : "event and the issue"} as untrusted data and acts ONLY through the actions you allow below, then reports what it did in the execution log.</p>
      </div>
      <div className="form-group">
        <span className="label">Allowed actions</span>
        <div className="agc-actions">
          <div className="agc-col">
            <div className="agc-col-head"><span className="agc-kind agc-kind-read">READ</span> never changes Jira</div>
            {reads.map((a) => actionRow(a, disabled))}
          </div>
          <div className="agc-col">
            <div className="agc-col-head"><span className="agc-kind agc-kind-write">WRITE</span> changes Jira (simulation mode records instead)</div>
            {writes.map((a) => actionRow(a, disabled))}
          </div>
          {/* CODE - the git namespace. Present on every edition on purpose: hiding it
              would leave an admin with no way to learn the capability exists or why it is
              off, which is the question the status line answers in one sentence. */}
          <div className={`agc-col agc-col-code ${codeOn ? "" : "agc-col-locked"}`}>
            <div className="agc-col-head"><span className="agc-kind agc-kind-code">CODE</span> reads and writes your Git repositories</div>
            {!codeOn && (
              <div className="agc-locked" role="note">
                <span className="agc-locked-title">{codeCopy.title}</span>
                <span className="agc-locked-text">{codeCopy.remedy}</span>
              </div>
            )}
            {gitReads.map((a) => actionRow(a, codeDisabled))}
            {gitWrites.map((a) => actionRow(a, codeDisabled))}
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
