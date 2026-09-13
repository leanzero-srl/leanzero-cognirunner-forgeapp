/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * THE CLASSIC FORM - THE SECOND DOOR ONTO ONE RECORD (release 1.5, commit 5c).
 *
 * An admin who does not want an interview fills this in instead. It is the same agent at the
 * end of it, and that is a code fact rather than a promise: the form collects the SAME
 * `answers` shape the wizard collects and hands it to the SAME `buildVaRecord` /
 * `normalizeVa` pair. It has no clamps, no defaults and no vocabulary of its own. If this
 * file ever grows one, the wizard and the form have started to build two different products,
 * and the byte-identity test in the shared module is what will say so.
 *
 * It is also where the wizard FAILS TO. `turn.fallbackToForm` hands us a partial record and
 * the refusals that stopped it; the admin lands here holding everything they already
 * answered, with the refusals rendered above the fields that caused them. Nothing is lost
 * and nothing is quietly widened.
 *
 * The pickers are `VaPickers.jsx`, shared with the wizard, and the options come from
 * `optionsForStep` - the same catalogue-derived function, so a project this app cannot see
 * is unpickable on both doors.
 */

import React, { useMemo, useState } from "react";
import SchedulePicker from "./SchedulePicker";
import { showToast } from "./toast";
import { ChipPicker, ChipRadio, DeskQueuePicker, PowerPicker, GuardrailPicker, PostWindowPicker, NoteList, TextListInput } from "./VaPickers";
import { buildVaRecord, catalogToCtx, optionsForStep, renderVoiceSamples, renderReviewSummary } from "../../../../src/shared/va-wizard.js";
import { normalizeVa, renderGuardrailSentences, VA_DEFAULTS, VA_CEILINGS, VA_PROJECTS_MAX, VA_MENTIONS_MAX, VA_SERVICE_DESKS_MAX, VA_QUEUES_PER_DESK_MAX, VA_JQL_MAX, VA_PERSONA_NAME_MAX, VA_MAX_SENTENCES_MIN, VA_MAX_SENTENCES_MAX, VA_LIMITS } from "../../../../src/shared/va-config.js";
import { cronToPreset } from "../../../../src/shared/cron.js";

const arr = (v) => (Array.isArray(v) ? v : []);

/** A saved record (or a wizard fallback) read back into the answers shape the form edits. */
const recordToAnswers = (va) => {
  const r = va || {};
  const p = r.persona || VA_DEFAULTS.persona;
  const s = r.scope || VA_DEFAULTS.scope;
  return {
    personaName: p.name || "",
    voice: { ...VA_DEFAULTS.persona.voice, ...(p.voice || {}) },
    signature: p.signature === true,
    intake: { ...VA_DEFAULTS.intake, ...(r.intake || {}) },
    readScope: { site: !!(s.read && s.read.site), projects: arr(s.read && s.read.projects) },
    writeScope: { projects: arr(s.write && s.write.projects) },
    cadence: { ...VA_DEFAULTS.cadence, ...(r.cadence || {}) },
    powers: { ...VA_DEFAULTS.powers, ...(r.powers || {}) },
    guardrails: { ...VA_DEFAULTS.guardrails, ...(r.guardrails || {}) },
  };
};

export default function VaEditor({ client, catalog = {}, initial = null, initialRefusals = [], onSaved, onCancel }) {
  const [a, setA] = useState(() => recordToAnswers(initial));
  const [saving, setSaving] = useState(false);
  const set = (patch) => setA((s) => ({ ...s, ...patch }));

  const state = useMemo(() => ({ catalog, answers: a }), [catalog, a]);
  const projectOpts = useMemo(() => optionsForStep("read_scope", state), [state]);
  const deskOpts = useMemo(() => optionsForStep("intake", state), [state]);
  const registerOpts = useMemo(() => optionsForStep("persona_voice", state), [state]);
  const powerOpts = useMemo(() => optionsForStep("powers", state), [state]);
  const skillOpts = useMemo(() => arr(catalog.skillIndex).map((s) => (s && s.id ? { value: String(s.id), label: String(s.name || s.id) } : { value: String(s), label: String(s) })), [catalog]);

  // The PREVIEW is the save path's own answer, computed on every keystroke: the same
  // `normalizeVa` the resolver will run, with the same catalogue context. What it refuses
  // here it refuses there, so the form cannot offer a record the backend will reject.
  const preview = useMemo(() => {
    try {
      const { va, refused } = normalizeVa(buildVaRecord({ answers: a }), catalogToCtx(catalog));
      return { va, refused, error: null };
    } catch (e) {
      return { va: null, refused: [], error: (e && e.message) || String(e) };
    }
  }, [a, catalog]);

  const sample = useMemo(() => {
    try { return renderVoiceSamples(a.voice, { name: a.personaName, signature: a.signature }); }
    catch { return { ok: false, unchecked: true, replies: [], blocks: [], warnings: [] }; }
  }, [a.voice, a.personaName, a.signature]);

  const save = async () => {
    if (!preview.va) { showToast(preview.error || "This agent cannot be saved yet.", "error"); return; }
    setSaving(true);
    const r = await client.saveAgent(preview.va);
    setSaving(false);
    if (r.success) { showToast(initial ? "Agent saved" : "Agent created"); onSaved(r.job || null); }
    else showToast(r.error || "Save failed", "error");
  };

  // The cadence rides `SchedulePicker`, which speaks cron, and the record keeps the preset
  // it was built from. `cronToPreset` is the one translator - the form never authors cron.
  const schedule = { cron: a.cadence.cron || VA_DEFAULTS.cadence.cron, timeZone: a.cadence.timeZone || "UTC" };
  const onSchedule = (next) => set({ cadence: { ...a.cadence, cron: next.cron, timeZone: next.timeZone, preset: cronToPreset(next.cron).preset } });

  return (
    <div className="section va-editor anim-rise">
      <div className="section-header">
        <span className="section-title">{initial ? "Edit virtual administrator" : "New virtual administrator"}</span>
        <div className="section-actions">
          <button type="button" className="btn-small" onClick={onCancel}>← Back to agents</button>
          <button type="button" className="btn-small btn-solid" onClick={save} disabled={saving || !preview.va}>{saving ? "Saving…" : "Save agent"}</button>
        </div>
      </div>

      <NoteList items={arr(initialRefusals)} kind="refusal" />
      {preview.error && <div className="alert alert-warning va-hardstop">{preview.error}</div>}

      <div className="card va-card">
        <div className="form-group">
          <label className="label" htmlFor="va-name">Name</label>
          <input id="va-name" type="text" className="lst-input va-name" value={a.personaName} maxLength={VA_PERSONA_NAME_MAX} placeholder="e.g. Nadia" onChange={(e) => set({ personaName: e.target.value })} />
          <span className="hint">Printed in every message this agent writes. Up to {VA_PERSONA_NAME_MAX} characters.</span>
        </div>

        <div className="form-group">
          <span className="label">Register</span>
          <ChipRadio options={registerOpts} value={a.voice.register} onChange={(register) => set({ voice: { ...a.voice, register } })} ariaLabel="Register" />
        </div>
        <div className="form-group va-voice-row">
          <span className="label">Sentences per reply</span>
          <input type="number" className="schp-num" min={VA_MAX_SENTENCES_MIN} max={VA_MAX_SENTENCES_MAX} value={a.voice.maxSentences} aria-label="Sentences per reply" onChange={(e) => set({ voice: { ...a.voice, maxSentences: Number(e.target.value) } })} />
          <span className="va-guard-range">{VA_MAX_SENTENCES_MIN} to {VA_MAX_SENTENCES_MAX}</span>
          <label className="lst-check"><input type="checkbox" checked={!!a.voice.greeting} onChange={(e) => set({ voice: { ...a.voice, greeting: e.target.checked } })} /><span>Open with a greeting</span></label>
          <label className="lst-check"><input type="checkbox" checked={!!a.signature} onChange={(e) => set({ signature: e.target.checked })} /><span>Sign with the agent's name</span></label>
        </div>
        <div className="va-sample">
          <div className="va-sample-head">
            <span className="label">How it will sound</span>
            <span className={`va-sample-flag ${sample.unchecked ? "va-sample-unchecked" : sample.ok ? "va-sample-ok" : "va-sample-bad"}`}>{sample.unchecked ? "NOT CHECKED" : sample.ok ? "PASSES THE RULES" : "BLOCKED"}</span>
          </div>
          {arr(sample.replies).map((r) => (
            <div className={`va-reply ${r.ok ? "" : "va-reply-bad"}`} key={r.kind}><span className="va-reply-kind">{r.kind === "public" ? "To the customer" : "Internal note"}</span><span className="va-reply-text">{r.text}</span></div>
          ))}
          {arr(sample.blocks).map((b, i) => <div className="va-sample-block" key={i}><span className="va-sample-rule">{b.rule || "rule"}</span><span>{b.message || String(b)}</span></div>)}
        </div>

        <div className="form-group">
          <span className="label">Service desk queues</span>
          <DeskQueuePicker desks={deskOpts} value={arr(a.intake.serviceDesks)} maxDesks={VA_SERVICE_DESKS_MAX} maxQueuesPerDesk={VA_QUEUES_PER_DESK_MAX} onChange={(serviceDesks) => set({ intake: { ...a.intake, serviceDesks } })} />
        </div>
        <div className="form-group">
          <label className="label" htmlFor="va-jql">JQL filter (optional)</label>
          <input id="va-jql" type="text" className="lst-input" value={a.intake.jql || ""} maxLength={VA_JQL_MAX} spellCheck={false} placeholder='e.g. project = PROJ AND status = "Waiting for support"' onChange={(e) => set({ intake: { ...a.intake, jql: e.target.value } })} />
          <span className="hint">Run against Jira once when the agent is saved. A filter that cannot run is not accepted.</span>
        </div>
        <div className="form-group">
          <span className="label">Pick up mentions of</span>
          <TextListInput values={arr(a.intake.mentionsOf)} max={VA_MENTIONS_MAX} placeholder="Atlassian account id" ariaLabel="Mention account id" onChange={(mentionsOf) => set({ intake: { ...a.intake, mentionsOf } })} />
        </div>
        <label className="lst-check"><input type="checkbox" checked={a.intake.owedFirst !== false} onChange={(e) => set({ intake: { ...a.intake, owedFirst: e.target.checked } })} /><span><strong>Answer people who are waiting first</strong></span></label>

        <div className="form-group">
          <span className="label">Projects it may read</span>
          <label className="lst-check"><input type="checkbox" checked={!!a.readScope.site} onChange={(e) => set({ readScope: { ...a.readScope, site: e.target.checked } })} /><span><strong>Every project this app can see</strong></span></label>
          {!a.readScope.site && <ChipPicker options={projectOpts} values={a.readScope.projects} max={VA_PROJECTS_MAX} ariaLabel="Readable projects" onChange={(projects) => set({ readScope: { ...a.readScope, projects } })} />}
        </div>
        <div className="form-group">
          <span className="label">Projects it may change</span>
          <ChipPicker options={projectOpts} values={a.writeScope.projects} max={VA_PROJECTS_MAX} ariaLabel="Writable projects" onChange={(projects) => set({ writeScope: { projects } })} />
          <span className="hint">Empty means it changes nothing. There is no site-wide write: an agent writes inside a named list of projects or nowhere.</span>
        </div>

        <div className="form-group">
          <span className="label">Cadence</span>
          <SchedulePicker value={schedule} onChange={onSchedule} />
        </div>
        <div className="form-group">
          <span className="label">It may post</span>
          <PostWindowPicker value={a.cadence.postWindow || VA_DEFAULTS.cadence.postWindow} onChange={(postWindow) => set({ cadence: { ...a.cadence, postWindow } })} />
        </div>

        <div className="form-group">
          <span className="label">Powers</span>
          <PowerPicker powers={powerOpts} value={a.powers} onChange={(powers) => set({ powers: { ...powers, skillIds: arr(a.powers.skillIds) } })} />
        </div>
        {skillOpts.length > 0 && (
          <div className="form-group">
            <span className="label">Skills it may use</span>
            <ChipPicker options={skillOpts} values={arr(a.powers.skillIds)} max={VA_LIMITS.skillIds} ariaLabel="Skills" onChange={(skillIds) => set({ powers: { ...a.powers, skillIds } })} />
          </div>
        )}

        <div className="form-group">
          <span className="label">Brakes</span>
          <GuardrailPicker ceilings={VA_CEILINGS} defaults={VA_DEFAULTS.guardrails} value={a.guardrails} projects={projectOpts} onChange={(guardrails) => set({ guardrails })} />
        </div>

        {preview.va && (
          <div className="va-review">
            <div className="va-review-block">
              <span className="label">What this agent is</span>
              {renderReviewSummary(preview.va).map((s, i) => <p className="va-sentence" key={i}>{s}</p>)}
            </div>
            <div className="va-review-block">
              <span className="label">What it is told, word for word</span>
              {renderGuardrailSentences(preview.va).map((s, i) => <p className="va-sentence" key={i}>{s}</p>)}
            </div>
          </div>
        )}
        <NoteList items={arr(preview.refused)} kind="note" />
      </div>
    </div>
  );
}
