/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from "react";
import { AGENT_ACTIONS, DEFAULT_AGENT_ACTIONS, MAX_AGENT_ROUNDS, DEFAULT_AGENT_ROUNDS, agentActionNamespace } from "../../../../src/shared/agent-actions.js";
import { agentCapabilityCopy } from "../../../../src/shared/edition.js";
import { MAX_RULE_SKILL_IDS } from "../../../../src/shared/registry-limits.js";
import { ChipPicker } from "./VaPickers";
import { isPermissionRefusal, permissionRefusalText } from "./refusal";

// "AI agent" mode editor: plain-language instructions + the allow-list of actions
// the agent may take (one tool each; src/shared/agent-actions.js is the single source).
export default function AgentConfig({ value, onChange, runtime = "listener", scoped = false, disabled = false, invoke = null, knowledgeRefusal = null }) {
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
  /* F-462 - THE KNOWLEDGE BINDING (`agent.skillIds` / `agent.useMemories`, 1.4 commit 13b).
     The record has carried both fields since 1.4 and only the REST API could set them, so a
     skill written for an agent listener had no way into one from this panel.

     The skills list is READ, never assumed: `getSkills` is the same resolver the Skills tab
     uses and carries the same viewer floor, so a reader who may not see skills gets the
     refusal sentence instead of an empty picker claiming this instance has none. A THROW is
     transport and lands in the same "we could not ask" state - it must never be spelled
     "there are no skills", which would read as an answer about the instance. */
  const [skills, setSkills] = useState(null);   // null = not yet answered
  const [skillsNote, setSkillsNote] = useState(null);
  useEffect(() => {
    if (!invoke) { setSkills([]); return; }
    let live = true;
    invoke("getSkills")
      .then((r) => {
        if (!live) return;
        if (r && r.success) { setSkills(Array.isArray(r.skills) ? r.skills.filter((s) => s && s.enabled !== false) : []); setSkillsNote(null); }
        else if (isPermissionRefusal(r)) { setSkills([]); setSkillsNote(permissionRefusalText(r, "skills")); }
        else { setSkills([]); setSkillsNote((r && r.error) || "Skills could not be loaded, so none can be bound right now."); }
      })
      .catch(() => { if (live) { setSkills([]); setSkillsNote("Skills could not be loaded, so none can be bound right now."); } });
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
      {/* F-462 - Knowledge. Same cap the record enforces (MAX_RULE_SKILL_IDS, read from
          registry-limits so the number cannot drift), same ChipPicker the Virtual
          Administrator's "Skills it may use" row uses: a rule binds a VOICE, not a library. */}
      <div className="form-group agc-knowledge">
        <span className="label">Knowledge</span>
        <p className="hint">Bind up to {MAX_RULE_SKILL_IDS} skills the agent may apply on every run, and choose whether it reads this instance&apos;s memories. Both cost tokens on every round, so nothing is bound unless you say so.</p>
        {skills === null ? (
          <div className="hint">Loading skills…</div>
        ) : skillsNote ? (
          <div className="access-note" role="note">{skillsNote}</div>
        ) : (
          <ChipPicker
            options={skills.map((s) => ({ value: String(s.id), label: String(s.name || s.id) }))}
            values={Array.isArray(v.skillIds) ? v.skillIds : []}
            max={MAX_RULE_SKILL_IDS}
            ariaLabel="Skills this agent may use"
            disabled={disabled}
            onChange={(skillIds) => set({ skillIds })}
            empty="No skills on this instance yet. Write one in the Skills tab, then bind it here."
          />
        )}
        {/* THE REFUSAL, BY NAME. `assertKnownSkillIds` (src/listeners.js) refuses a save whose
            binding names a skill this instance does not have, and the id alone is not an
            answer an admin can act on: every bound skill is listed back with the name the
            picker knows, and the ones that are not in the list are marked NOT FOUND and can
            be dropped in one click. A binding that silently bound nothing is the defect the
            backend refusal exists to prevent - so the UI must not re-hide it. */}
        {knowledgeRefusal && (
          <div className="agc-knowledge-refusal" role="alert">
            <span className="agc-kr-title">Skill not found</span>
            <span className="agc-kr-text">{knowledgeRefusal}</span>
            <span className="agc-kr-list">
              {(Array.isArray(v.skillIds) ? v.skillIds : []).map((id) => {
                const known = (skills || []).find((s) => String(s.id) === String(id));
                return (
                  <span key={id} className={`agc-kr-chip ${known ? "" : "missing"}`}>
                    {known ? String(known.name || known.id) : id}
                    {!known && (
                      <>
                        <span className="agc-kr-flag">NOT FOUND</span>
                        <button type="button" className="agc-kr-drop" onClick={() => set({ skillIds: (v.skillIds || []).filter((x) => String(x) !== String(id)) })} disabled={disabled} aria-label={`Remove ${id}`}>×</button>
                      </>
                    )}
                  </span>
                );
              })}
            </span>
          </div>
        )}
        <label className="lst-check agc-memories">
          <input type="checkbox" checked={v.useMemories === true} onChange={(e) => set({ useMemories: e.target.checked })} disabled={disabled} />
          <span><strong>Use memories</strong>: the agent reads this instance&apos;s learned facts as advisory context on every round. Off by default.</span>
        </label>
      </div>
      <div className="form-group agc-rounds">
        <label className="label" htmlFor="agc-rounds">Max tool rounds</label>
        <input id="agc-rounds" type="number" min="1" max={MAX_AGENT_ROUNDS} value={v.maxRounds || DEFAULT_AGENT_ROUNDS} onChange={(e) => set({ maxRounds: Math.min(MAX_AGENT_ROUNDS, Math.max(1, parseInt(e.target.value, 10) || DEFAULT_AGENT_ROUNDS)) })} disabled={disabled} className="schp-num" />
        <span className="hint" style={{ marginLeft: 10 }}>Each round = one model call that may execute several actions. Caps cost and runtime (1–{MAX_AGENT_ROUNDS}).</span>
      </div>
    </div>
  );
}
