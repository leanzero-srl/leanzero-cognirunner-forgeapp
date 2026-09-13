/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * WHAT THE SAVE ITSELF NARROWED, SAID OUT LOUD (F-538).
 *
 * `normalizeVa` runs in the browser on every keystroke and the form renders its
 * `refused[]` as a live preview. That preview can never carry the notes a SAVE produces,
 * because those come from things only the backend can see: the agent's own tick counter
 * (`shadow-watch-unknown`), a catalogue source that failed to load (`catalogue.<name>`),
 * and the re-arm `rearmShadow` applied after the door had already answered. The resolver
 * returns them on a SUCCESSFUL save - `refused` (src/index.js) and `vaRefused` on the
 * saved job row (src/scheduled-jobs.js) - and both doors used to throw them away, so a
 * field the save narrowed stayed a field the operator still believed they set.
 *
 * ONE RENDERING, TWO DOORS. The classic form and the wizard's review step both use this
 * file and neither authors a sentence, a colour or a dismissal rule of its own. It is a
 * helper plus a component rather than a hook, so a third door (the REST surface's future
 * confirmation screen) can reuse it without inheriting any state.
 *
 * IT NEVER PRINTS A VALUE. The field path is a CONFIGURATION FIELD NAME, which is safe
 * to show and is the only thing that makes a note actionable; the sentence comes from the
 * backend, which already clamps and quotes what it echoes. An unknown `reason` prints as
 * its raw id here for the same reason - it is a field-level id, not an engine error.
 */

import React from "react";

const arr = (v) => (Array.isArray(v) ? v : []);

/*
 * THE ONE SENTENCE MAP. Most rows already carry a full sentence in `reason` (every
 * `report()` in va-config.js and every `refusal()` in va-wizard.js authors prose). The
 * ids are the exception, and they live here so the backend can add one without the UI
 * having to grow a second vocabulary for it.
 */
export const SAVE_NOTE_SENTENCES = {
  "shadow-watch-unknown": "This agent's own tick counter could not be read, so its shadow-mode watch was left exactly as it was rather than being recalculated. Nothing about shadow mode changed with this save.",
  "catalogue-unchecked": "This site's catalogue could not be read, so that part of the configuration was accepted without being checked against live data.",
  invalid: "This part of the configuration was not accepted as written and was narrowed by the save.",
};

/* House style: no em dashes in anything this app renders. The backend authors prose with
   them, and normalising HERE is what keeps the rule enforceable at one place rather than
   depending on every sentence author remembering it. */
const noDashes = (s) => String(s).replace(/\s*[—–]\s*/g, ", ").replace(/\s+,/g, ",").replace(/,\s*,/g, ",");

/** A row to the sentence to print. Prose wins; an id falls back to the map, then to itself. */
export const saveNoteSentence = (row) => {
  const r = row && typeof row === "object" ? row : { reason: String(row || "") };
  const raw = String(r.reason || "").trim();
  if (raw && /\s/.test(raw)) return noDashes(raw);
  const id = raw || String(r.note || "").trim();
  return noDashes(SAVE_NOTE_SENTENCES[id] || id || "This field was narrowed by the save.");
};

/**
 * Every note a SUCCESSFUL save answered with, from both of the places the backend puts
 * them, deduplicated on field + sentence (the resolver's `refused` and the job row's
 * `vaRefused` legitimately overlap when the second pass repeats a first-pass clamp).
 */
export const collectSaveNotes = (answer) => {
  const a = answer && typeof answer === "object" ? answer : {};
  const job = a.job && typeof a.job === "object" ? a.job : {};
  const rows = [...arr(a.refused), ...arr(a.vaRefused), ...arr(job.refused), ...arr(job.vaRefused)];
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    if (!row) continue;
    const field = String((row && row.field) || "").trim();
    const text = saveNoteSentence(row);
    const key = `${field} ${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ field, text });
  }
  return out;
};

/**
 * The notes, and the dismissal that keeps the door open until they have been read. A
 * toast would be wrong here: it disappears on its own, and the whole defect this fixes is
 * an operator who was told nothing.
 */
export default function SaveNotes({ notes = [], onDismiss, dismissLabel = "Got it" }) {
  const items = arr(notes);
  if (!items.length) return null;
  return (
    <div className="va-save-notes" role="alert" aria-label="What this save changed">
      <div className="va-save-notes-head">
        <span className="va-save-notes-title">{items.length === 1 ? "The save narrowed one field" : `The save narrowed ${items.length} fields`}</span>
        {onDismiss && <button type="button" className="va-save-notes-dismiss" onClick={onDismiss}>{dismissLabel}</button>}
      </div>
      {items.map((n, i) => (
        <div className="va-save-note" key={`${n.field || "x"}-${i}`}>
          {n.field && <span className="va-save-note-field">{n.field}</span>}
          <span className="va-save-note-text">{n.text}</span>
        </div>
      ))}
    </div>
  );
}
