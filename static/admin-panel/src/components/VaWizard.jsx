/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * THE SETUP INTERVIEW, RENDERED (release 1.5, commit 5c).
 *
 * This component is the wizard's FACE and none of its brain. Every question, every option
 * list, every refusal sentence and the whole step order come from `src/shared/va-wizard.js`
 * through one resolver (`vaWizardStep`, behind `va-client.js`); this file turns a turn into
 * chips, prose and buttons, and hands the admin's pick straight back. It holds no answers of
 * its own beyond the draft of the step currently on screen, so a reload resumes from the
 * server's `va_wizard:{accountId}` state rather than from anything cached here.
 *
 * WHY IT MUST NOT DECIDE. The wizard's other participant is a model. If this file chose a
 * control by the `field` string, or offered an option the turn did not carry, a model that
 * returned an unexpected `field` would move the UI - which is exactly the remote-execution
 * surface the state machine was written to prevent. The switch below is keyed on `stepId`,
 * which the machine authors, and the OPTIONS always come from `turn.options` / `turn.extras`.
 * A step id this build does not know renders its `ask` with a plain text box and nothing else.
 *
 * FAIL CLOSED INTO THE FORM. `turn.fallbackToForm` means the record could not be validated
 * into existence; the admin is handed to `VaEditor.jsx` holding everything already answered
 * (`turn.record`, or the last good `turn.preview`). Nothing is lost and nothing is widened.
 *
 * THE VOICE SAMPLE IS THE POST GATE'S OWN CODE. `turn.sample` came from `renderVoiceSamples`,
 * which calls `lintVoice` - the same function gate 9 calls on a real message. The blocks are
 * rendered BY RULE NAME because "that would not be allowed" without the rule is unactionable,
 * and a sample that could not be linted renders labelled rather than blocking setup.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { showToast } from "./toast";
import { ChipPicker, ChipRadio, DeskQueuePicker, PowerPicker, GuardrailPicker, PostWindowPicker, ZonePicker, NoteList, TextListInput } from "./VaPickers";
import SaveNotes, { collectSaveNotes } from "./VaSaveNotes";
import {
  VA_DEFAULTS, VA_SUGGESTED_POST_WINDOW, VA_COPY,
  resolveDefaultTimeZone, viewerTimeZone,
} from "../../../../src/shared/va-config.js";
import { renderReviewSummary } from "../../../../src/shared/va-wizard.js";

const arr = (v) => (Array.isArray(v) ? v : []);

export default function VaWizard({ client, catalog = {}, onCreated, onFallback, onCancel }) {
  const [turn, setTurn] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState({});
  // The review step's LAST panel (F-538): what the save itself narrowed, which no turn of
  // the interview can know because it is computed by the resolver, not by `stepWizard`.
  // Same rendering the classic form uses, and it holds `onCreated` until it is dismissed.
  const [saveNotes, setSaveNotes] = useState(null);
  // Every turn carries a token: a slow answer that lands after a newer one must never
  // overwrite the newer turn (the generation-token pattern this app uses for async AI).
  const token = useRef(0);

  const send = useCallback(async (input) => {
    const mine = ++token.current;
    setBusy(true);
    const r = await client.wizardStep(input);
    if (mine !== token.current) return null;
    setBusy(false);
    if (!r.success || !r.turn) { setError(r.error || "The setup assistant could not be reached."); return null; }
    setError(null);
    setTurn(r.turn);
    setDraft({});
    return r.turn;
  }, [client]);

  useEffect(() => { send({}); }, [send]);

  // The create step's answer comes back with the normalized record on it. The SAVE is a
  // separate call on purpose: `stepWizard` is pure and stores nothing, so the record only
  // becomes an agent when `saveScheduledJob` says so.
  const answer = async (value) => {
    const t = await send({ answer: value });
    if (!t) return;
    if (t.fallbackToForm) {
      showToast("The interview could not finish. Your answers were carried into the form.", "error");
      onFallback(t.record || t.preview || null, arr(t.refused));
      return;
    }
    if (t.created && t.va) {
      const saved = await client.saveAgent(t.va);
      if (!saved.success) { showToast(saved.error || "The agent could not be saved", "error"); return; }
      showToast("Agent created");
      await client.wizardReset();
      const notes = collectSaveNotes(saved);
      if (notes.length) { setSaveNotes({ notes, job: saved.job || null }); return; }
      onCreated(saved.job || null);
    }
  };

  // THE REVIEW STEP'S LAST PANEL. The interview is over and the agent exists; the only
  // thing left to say is what the save narrowed on its way in. Starting over or going
  // back would both be lies about an agent that is already stored, so this arm renders
  // the notes and one dismissal, and nothing else.
  if (saveNotes) {
    return (
      <div className="section va-wizard anim-rise">
        <div className="section-header"><span className="section-title">Agent created</span></div>
        <div className="card va-card">
          <SaveNotes notes={saveNotes.notes} onDismiss={() => { const job = saveNotes.job; setSaveNotes(null); onCreated(job); }} dismissLabel="Got it, show me the agent" />
        </div>
      </div>
    );
  }

  const restart = async () => { await client.wizardReset(); token.current += 1; send({}); };

  if (error) {
    return (
      <div className="card va-card">
        <div className="alert alert-warning">{error}</div>
        <div className="va-actions"><button type="button" className="btn-small" onClick={() => send({})}>Try again</button><button type="button" className="btn-small" onClick={onCancel}>← Back to agents</button></div>
      </div>
    );
  }
  if (!turn) return <div className="card va-card"><div className="empty-state">Opening the setup interview…</div></div>;

  const ex = turn.extras || {};
  const opts = arr(turn.options);

  return (
    <div className="section va-wizard anim-rise">
      <div className="section-header">
        <span className="section-title">New virtual administrator</span>
        <div className="section-actions">
          <button type="button" className="btn-small" onClick={restart} disabled={busy}>Start over</button>
          <button type="button" className="btn-small" onClick={onCancel}>← Back to agents</button>
        </div>
      </div>

      <div className="card va-card">
        <div className="va-chat">
          {/* `prompt` is the assistant's prose for this turn; `ask` is the code-authored
              question, which is what the admin is actually answering. Both are rendered:
              the prose can be empty (no model turn yet) and the question never is. */}
          {turn.prompt && turn.prompt !== turn.ask && <p className="va-say">{turn.prompt}</p>}
          <p className="va-ask">{turn.ask}</p>
        </div>

        <NoteList items={arr(turn.refused)} kind="refusal" />
        <NoteList items={arr(turn.notes)} kind="note" />

        <div className="va-step" data-step={turn.stepId}>
          {renderStep({ turn, ex, opts, draft, setDraft, answer, busy, catalog })}
        </div>
      </div>
    </div>
  );
}

/* One arm per step id. The arms read `turn.options` / `turn.extras` and never build a list
   of their own - that is what makes "an option the catalogue does not carry cannot be
   picked" true on this side of the wire too. */
function renderStep({ turn, ex, opts, draft, setDraft, answer, busy, catalog }) {
  /* The answers ALREADY ACCEPTED by the machine, used only to pre-fill the controls of the
     step on screen. They are the machine's own state rather than anything this file
     remembers, which is what lets a step the admin came back to (review → "go back to the
     voice") show what they chose rather than an empty box. */
  const ans = (turn.state && turn.state.answers) || {};
  const d = (k, fallback) => (draft[k] === undefined ? fallback : draft[k]);
  const set = (k, v) => setDraft((s) => ({ ...s, [k]: v }));
  const Next = ({ value, label = "Continue", disabled = false, cls = "btn-solid" }) => (
    <button type="button" className={`btn-small ${cls}`} disabled={busy || disabled} onClick={() => answer(value)}>{busy ? "Working…" : label}</button>
  );

  switch (turn.stepId) {
    case "persona_name": {
      const name = d("name", ans.personaName || "");
      return (
        <>
          <input
            type="text" className="lst-input va-name" autoFocus value={name} maxLength={ex.maxChars || 40}
            placeholder="e.g. Nadia" aria-label="Agent name" onChange={(e) => set("name", e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) answer(name); }}
          />
          <span className="hint">Up to {ex.maxChars} characters. Letters, digits, spaces, apostrophes, hyphens and dots.</span>
          <div className="va-actions"><Next value={name} disabled={!name.trim()} /></div>
        </>
      );
    }

    case "persona_voice": {
      const sample = turn.sample || {};
      // The controls show the record's OWN defaults until the admin changes them (one home,
      // VA_DEFAULTS), so an admin who just presses Continue gets the agent the summary
      // describes rather than an empty voice block.
      const voice = d("voice", ans.voice || { ...VA_DEFAULTS.persona.voice });
      const patch = (p) => set("voice", { ...voice, ...p });
      return (
        <>
          <div className="form-group">
            <span className="label">Register</span>
            <ChipRadio options={opts} value={voice.register} onChange={(register) => patch({ register })} ariaLabel="Register" disabled={busy} />
          </div>
          <div className="form-group va-voice-row">
            <span className="label">Sentences per reply</span>
            <input
              type="number" className="schp-num" min={ex.minSentences} max={ex.maxSentences} aria-label="Sentences per reply"
              value={voice.maxSentences === undefined ? "" : voice.maxSentences} disabled={busy}
              onChange={(e) => patch({ maxSentences: e.target.value === "" ? undefined : Number(e.target.value) })}
            />
            <span className="va-guard-range">{ex.minSentences} to {ex.maxSentences}</span>
            <label className="lst-check"><input type="checkbox" checked={!!voice.greeting} disabled={busy} onChange={(e) => patch({ greeting: e.target.checked })} /><span>Open with a greeting</span></label>
            <label className="lst-check"><input type="checkbox" checked={draft.signature === undefined ? !!ans.signature : draft.signature} disabled={busy} onChange={(e) => set("signature", e.target.checked)} /><span>Sign with the agent's name</span></label>
          </div>
          {arr(ex.languages).length > 1 && (
            <div className="form-group">
              <span className="label">Language</span>
              <ChipRadio options={ex.languages.map((l) => ({ value: l, label: l }))} value={voice.language || "auto"} onChange={(language) => patch({ language })} ariaLabel="Language" disabled={busy} />
            </div>
          )}

          <div className="va-sample">
            <div className="va-sample-head">
              <span className="label">How it will sound</span>
              {sample.unchecked
                ? <span className="va-sample-flag va-sample-unchecked">NOT CHECKED</span>
                : <span className={`va-sample-flag ${sample.ok ? "va-sample-ok" : "va-sample-bad"}`}>{sample.ok ? "PASSES THE RULES" : "BLOCKED"}</span>}
            </div>
            {arr(sample.replies).map((r) => (
              <div className={`va-reply ${r.ok ? "" : "va-reply-bad"}`} key={r.kind}>
                <span className="va-reply-kind">{r.kind === "public" ? "To the customer" : "Internal note"}</span>
                <span className="va-reply-text">{r.text}</span>
              </div>
            ))}
            {/* BY RULE NAME. The gate names the rule it enforced; a sample that only said
                "not allowed" would teach an admin nothing they can act on. */}
            {arr(sample.blocks).map((b, i) => (
              <div className="va-sample-block" key={`${b.rule || b}-${i}`}><span className="va-sample-rule">{b.rule || "rule"}</span><span>{b.message || String(b)}</span></div>
            ))}
            {arr(sample.warnings).map((w, i) => <div className="va-sample-warn" key={i}>{w.message || String(w)}</div>)}
            <div className="va-chips va-sample-chips" role="group" aria-label="Sample adjustments">
              {arr(sample.chips).map((c) => (
                <button type="button" key={c} className="va-chip va-chip-act" disabled={busy} onClick={() => answer({ chip: c })}>{CHIP_LABEL[c] || c}</button>
              ))}
            </div>
            <span className="hint">The sample is checked by the same rules that check every real message this agent writes.</span>
          </div>

          <div className="va-actions">
            <Next value={{ ...voice, ...(draft.signature === undefined ? {} : { signature: draft.signature }) }} label="Use this voice" />
          </div>
        </>
      );
    }

    case "intake": {
      const desks = d("serviceDesks", (ans.intake && ans.intake.serviceDesks) || []);
      const jql = d("jql", (ans.intake && ans.intake.jql) || "");
      const mentions = d("mentionsOf", (ans.intake && ans.intake.mentionsOf) || []);
      const owedFirst = d("owedFirst", ans.intake ? ans.intake.owedFirst !== false : true);
      return (
        <>
          <div className="form-group">
            <span className="label">Service desk queues</span>
            <DeskQueuePicker desks={opts} value={desks} onChange={(v) => set("serviceDesks", v)} maxDesks={ex.maxDesks} maxQueuesPerDesk={ex.maxQueuesPerDesk} disabled={busy} />
          </div>
          <div className="form-group">
            <span className="label">JQL filter (optional)</span>
            <input type="text" className="lst-input" value={jql} spellCheck={false} disabled={busy} maxLength={ex.maxJqlChars}
              placeholder='e.g. project = PROJ AND status = "Waiting for support"' aria-label="JQL filter" onChange={(e) => set("jql", e.target.value)} />
            <span className="hint">Run against Jira once before the agent is created. A filter that cannot run is not accepted as standing intake.</span>
          </div>
          <div className="form-group">
            <span className="label">Pick up mentions of</span>
            <TextListInput values={mentions} onChange={(v) => set("mentionsOf", v)} max={ex.maxMentions} placeholder="Atlassian account id" ariaLabel="Mention account id" disabled={busy} />
          </div>
          <label className="lst-check"><input type="checkbox" checked={owedFirst} disabled={busy} onChange={(e) => set("owedFirst", e.target.checked)} /><span><strong>Answer people who are waiting first</strong></span></label>
          <div className="va-actions"><Next value={{ serviceDesks: desks, jql, mentionsOf: mentions, owedFirst }} /></div>
        </>
      );
    }

    case "read_scope": {
      const site = d("site", !!(ans.readScope && ans.readScope.site));
      const projects = d("projects", (ans.readScope && ans.readScope.projects) || []);
      return (
        <>
          <label className="lst-check"><input type="checkbox" checked={site} disabled={busy} onChange={(e) => set("site", e.target.checked)} /><span><strong>Every project this app can see</strong></span></label>
          {!site && <ChipPicker options={opts} values={projects} max={ex.maxProjects} onChange={(v) => set("projects", v)} ariaLabel="Readable projects" disabled={busy} empty="This app can see no project, so there is nothing to read." />}
          <div className="va-actions"><Next value={{ site, projects }} disabled={!site && !projects.length} /></div>
        </>
      );
    }

    case "write_scope": {
      const projects = d("projects", (ans.writeScope && ans.writeScope.projects) || []);
      return (
        <>
          <ChipPicker options={opts} values={projects} max={ex.maxProjects} onChange={(v) => set("projects", v)} ariaLabel="Writable projects" disabled={busy} />
          <p className="hint">Leave this empty and the agent reads, stages replies and proposes changes without touching anything. There is no site-wide option: an agent writes inside a named list of projects or nowhere.</p>
          <div className="va-actions">
            <Next value={{ projects }} label={projects.length ? "Continue" : "Continue with no write access"} />
          </div>
        </>
      );
    }

    case "cadence": {
      const preset = d("preset", (ans.cadence && ans.cadence.preset) || "");
      /*
       * F-916 - THE DEFAULTS USED TO LIE. The zone was `arr(ex.timeZones)[0]`, which on an
       * alphabetical IANA list is "Africa/Abidjan"; the posting window was Sun-Sat
       * 00:00-23:59. Neither was a choice, and the review card stated both as if they were.
       * Both now come from the ONE home (`va-config.js`), which the classic form reads too:
       * the viewer's own zone if the site offers it, and the working week.
       */
      const timeZone = d("timeZone", (ans.cadence && ans.cadence.timeZone) || defaultZone(ex));
      const hour = d("hour", 9);
      const minute = d("minute", 0);
      const postWindow = d("postWindow", (ans.cadence && ans.cadence.postWindow) || suggestedWindow(ex));
      const needsTime = ["daily", "weekdays", "weekly", "monthly"].includes(preset);
      const needsMinute = ["hourly", "every2h", "every4h", "every6h", "every12h"].includes(preset);
      return (
        <>
          <div className="form-group">
            <span className="label">Runs</span>
            <ChipRadio options={opts.filter((o) => o.value !== "custom")} value={preset} onChange={(v) => set("preset", v)} ariaLabel="Cadence" disabled={busy} />
            {/* F-916 - the cadence is how often it LOOKS, never how fast it answers. The
                fast chips read as a promise of a reply in five minutes; the two-phase floor
                means the earliest a draft can go out is the next run after the wall-clock
                gap. Said here, where the chips are, rather than discovered later. */}
            <span className="hint va-cadence-note">{ex.stagingNote || VA_COPY.cadenceStagingNote}</span>
          </div>
          {(needsTime || needsMinute) && (
            <div className="form-group va-voice-row">
              <span className="label">{needsTime ? "At time" : "At minute"}</span>
              {needsTime && <input type="number" className="schp-num" min="0" max="23" value={hour} aria-label="Hour" disabled={busy} onChange={(e) => set("hour", Number(e.target.value))} />}
              <input type="number" className="schp-num" min="0" max="59" value={minute} aria-label="Minute" disabled={busy} onChange={(e) => set("minute", Number(e.target.value))} />
            </div>
          )}
          <div className="form-group">
            <span className="label">Time zone</span>
            <ZonePicker zones={arr(ex.timeZones)} value={timeZone} onChange={(v) => set("timeZone", v)} disabled={busy} />
          </div>
          <div className="form-group">
            <span className="label">It may post</span>
            <PostWindowPicker value={postWindow} onChange={(v) => set("postWindow", v)} disabled={busy} />
          </div>
          <div className="va-actions"><Next value={{ preset, timeZone, hour, minute, postWindow }} disabled={!preset} /></div>
        </>
      );
    }

    case "powers": {
      const powers = d("powers", ans.powers || {});
      const skillIds = d("skillIds", (ans.powers && ans.powers.skillIds) || []);
      return (
        <>
          <PowerPicker powers={opts} value={powers} onChange={(v) => set("powers", v)} disabled={busy} />
          {arr(ex.skills).length > 0 && (
            <div className="form-group">
              <span className="label">Skills it may use</span>
              <ChipPicker options={ex.skills} values={skillIds} max={ex.maxSkills} onChange={(v) => set("skillIds", v)} ariaLabel="Skills" disabled={busy} />
            </div>
          )}
          <div className="va-actions"><Next value={{ ...powers, skillIds }} /></div>
        </>
      );
    }

    case "guardrails": {
      const g = d("guardrails", ans.guardrails || ex.defaults || {});
      return (
        <>
          <GuardrailPicker ceilings={ex.ceilings || {}} defaults={ex.defaults || {}} value={g} projects={arr(ex.projects)} onChange={(v) => set("guardrails", v)} disabled={busy} />
          <div className="va-actions"><Next value={g} label="Set the brakes" /></div>
        </>
      );
    }

    case "review": {
      /*
       * F-916 - THE SUMMARY IS RENDERED HERE, from the turn's own normalised record, so the
       * "(default)" markers can be measured against the defaults THIS BROWSER seeded the
       * controls with. The machine renders the same sentences with the same function; it
       * simply has no viewer to resolve a zone against, so its markers would call a zone a
       * default only when it happened to be UTC. `turn.summary` is the fallback for a turn
       * that carries no preview (a record the save path refused).
       */
      const summary = turn.preview
        ? renderReviewSummary(turn.preview, {
          projects: arr(catalog && catalog.projects),
          defaultTimeZone: defaultZone(ex),
          defaultPostWindow: suggestedWindow(ex),
        })
        : arr(turn.summary);
      return (
        <>
          <div className="va-review">
            <div className="va-review-block">
              <span className="label">What this agent is</span>
              {summary.map((s, i) => <p className="va-sentence" key={i}>{s}</p>)}
            </div>
            <div className="va-review-block">
              <span className="label">What it is told, word for word</span>
              {arr(turn.guardrailSentences).map((s, i) => <p className="va-sentence" key={i}>{s}</p>)}
            </div>
          </div>
          {/* THE CREATE BUTTON LIVES HERE (F-916). There used to be one more screen after
              this one that asked "Ready to create it?" over no new information, so the admin
              confirmed the same decision twice and only the second click did anything. */}
          <p className="hint">It starts in shadow mode: it drafts replies for you to read and posts nothing until the shadow ticks are used up.</p>
          <div className="va-actions">
            <Next value={{ confirm: true }} label="Create the agent" />
            {arr(turn.options).length > 0 && (
              <span className="va-back">
                <span className="hint">Go back to</span>
                {arr(turn.options).map((o) => (
                  <button type="button" key={o.value} className="btn-small" disabled={busy} onClick={() => answer({ back: o.value })}>{STEP_LABEL[o.value] || o.label}</button>
                ))}
              </span>
            )}
          </div>
        </>
      );
    }

    /* Not reachable from the review card any more (its confirm creates in the same turn),
       and kept as the arm for a RESUMED interview stored on this step by an older build. */
    case "create":
      return (
        <>
          <p className="hint">It starts in shadow mode: it drafts replies for you to read and posts nothing until the shadow ticks are used up.</p>
          <div className="va-actions"><Next value={{ confirm: true }} label="Create the agent" /></div>
        </>
      );

    default:
      return (
        <>
          <input type="text" className="lst-input" value={d("raw", "")} aria-label={turn.field || "answer"} disabled={busy} onChange={(e) => set("raw", e.target.value)} />
          <div className="va-actions"><Next value={d("raw", "")} /></div>
        </>
      );
  }
}

/* WHAT A NEW AGENT STARTS WITH, resolved once per render from the one home (F-916). The
   zone needs a VIEWER, which only this side has - the machine runs on a Forge node whose
   own zone is UTC - so the turn carries the site's zone LIST and the resolution happens
   here, against it. */
const defaultZone = (ex) => resolveDefaultTimeZone(viewerTimeZone(), null, arr(ex && ex.timeZones));
const suggestedWindow = (ex) => {
  const w = (ex && ex.suggestedPostWindow) || VA_SUGGESTED_POST_WINDOW;
  return { days: [...arr(w.days)], from: w.from, to: w.to };
};

const CHIP_LABEL = { keep: "Keep", shorter: "Shorter", warmer: "Warmer", terser: "Terser" };
const STEP_LABEL = {
  persona_name: "the name", persona_voice: "the voice", intake: "the intake", read_scope: "what it reads",
  write_scope: "what it may change", cadence: "the cadence", powers: "the powers", guardrails: "the brakes",
};
