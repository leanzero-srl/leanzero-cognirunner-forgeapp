/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * THE VIRTUAL ADMINISTRATOR'S INPUT PRIMITIVES (release 1.5, commit 5c).
 *
 * The wizard and the classic form ask the SAME questions, so they render them with the same
 * controls: one home for the chips, the desk/queue tree, the power switches, the guardrail
 * spinners and the posting window. Two copies would drift into two different products
 * wearing one name, and the wizard's whole claim is that it builds the same record the form
 * builds.
 *
 * WHERE A CATALOGUE EXISTS, THERE IS NO FREE TEXT. Projects, desks, queues, time zones,
 * cadences, registers and powers all arrive as `options` from `va-wizard.js`
 * (`optionsForStep`, derived from the site's own catalogue) and are rendered as chips or as
 * `CustomSelect`. No native `<select>`, no typed project key where a list exists - a value
 * that is not in the catalogue cannot be picked, which is the UI half of "a hallucinated
 * project key never reaches a record".
 *
 * These components DECIDE NOTHING. They emit the value the admin picked; every bound, every
 * refusal and every clamp belongs to `va-wizard.js` / `va-config.js`, and a control that
 * silently trimmed an answer here would hide the refusal the admin needs to read.
 */

import React, { useState } from "react";
import CustomSelect from "./CustomSelect";

const arr = (v) => (Array.isArray(v) ? v : []);

/** A multi-pick chip row. Solid fill when on, per the design rules - never a tint. */
export function ChipPicker({ options = [], values = [], onChange, max = null, ariaLabel, disabled = false, empty = "Nothing to pick." }) {
  const on = new Set(arr(values).map(String));
  const toggle = (v) => {
    const next = new Set(on);
    if (next.has(v)) next.delete(v);
    else {
      // The cap is REPORTED by refusing the click, never by silently dropping the oldest:
      // an admin who cannot tell which of their picks survived cannot fix it.
      if (max != null && next.size >= max) return;
      next.add(v);
    }
    onChange(options.map((o) => String(o.value)).filter((v2) => next.has(v2)));
  };
  if (!options.length) return <p className="hint va-empty">{empty}</p>;
  return (
    <div className="va-chips" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          type="button" key={o.value} disabled={disabled}
          className={`va-chip ${on.has(String(o.value)) ? "on" : ""}`}
          aria-pressed={on.has(String(o.value))}
          onClick={() => toggle(String(o.value))}
        >{o.label}</button>
      ))}
      {max != null && <span className="va-chip-cap">{on.size}/{max}</span>}
    </div>
  );
}

/** A single-pick chip row (registers, cadences short lists). */
export function ChipRadio({ options = [], value, onChange, ariaLabel, disabled = false }) {
  return (
    <div className="va-chips" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          type="button" key={o.value} disabled={disabled}
          className={`va-chip ${String(value) === String(o.value) ? "on" : ""}`}
          aria-pressed={String(value) === String(o.value)}
          onClick={() => onChange(o.value)}
        >{o.label}</button>
      ))}
    </div>
  );
}

/**
 * The service desk / queue tree. The record carries IDS ONLY
 * (`[{serviceDeskId, queueIds}]`) - the queue's own JQL is read at save time by the
 * resolver, so nothing here copies a query string onto the record.
 */
export function DeskQueuePicker({ desks = [], value = [], onChange, maxDesks = 10, maxQueuesPerDesk = 20, disabled = false }) {
  const rows = arr(value);
  const rowFor = (id) => rows.find((r) => String(r.serviceDeskId) === String(id)) || null;
  const toggleDesk = (id) => {
    if (rowFor(id)) onChange(rows.filter((r) => String(r.serviceDeskId) !== String(id)));
    else if (rows.length < maxDesks) onChange([...rows, { serviceDeskId: String(id), queueIds: [] }]);
  };
  const setQueues = (id, queueIds) => onChange(rows.map((r) => (String(r.serviceDeskId) === String(id) ? { ...r, queueIds } : r)));
  if (!desks.length) return <p className="hint va-empty">This site has no service desk this app can see, so queues cannot be an intake source. A JQL filter or a mention list still can.</p>;
  return (
    <div className="va-desks">
      {desks.map((d) => {
        const row = rowFor(d.value);
        return (
          <div className={`va-desk ${row ? "on" : ""}`} key={d.value}>
            <label className="va-desk-head">
              <input type="checkbox" checked={!!row} onChange={() => toggleDesk(d.value)} disabled={disabled} />
              <span className="va-desk-name">{d.label}</span>
            </label>
            {row && (
              <div className="va-desk-queues">
                <span className="label">Queues</span>
                <ChipPicker
                  options={arr(d.queues)} values={row.queueIds} max={maxQueuesPerDesk} disabled={disabled}
                  ariaLabel={`Queues of ${d.label}`} onChange={(queueIds) => setQueues(d.value, queueIds)}
                  empty="This desk has no queue this app can see."
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** The power switches. Everything is OFF unless it is turned on, which is the record's default. */
export function PowerPicker({ powers = [], value = {}, onChange, disabled = false }) {
  return (
    <div className="va-powers">
      {powers.map((p) => {
        const id = typeof p === "string" ? p : p.value;
        const label = typeof p === "string" ? p : p.label;
        return (
          <label className={`va-power ${value[id] ? "on" : ""}`} key={id}>
            <input type="checkbox" checked={!!value[id]} disabled={disabled} onChange={(e) => onChange({ ...value, [id]: e.target.checked })} />
            <span className="va-power-label">{POWER_COPY[id] ? POWER_COPY[id].label : label}</span>
            {POWER_COPY[id] && <span className="va-power-desc">{POWER_COPY[id].desc}</span>}
          </label>
        );
      })}
      <p className="hint va-powers-note">There is no power for configuration changes. Schemes, workflows, permissions, roles and fields have no action at all, so the agent can only propose them and a human decides.</p>
    </div>
  );
}

/* One sentence per power, in the words the guardrail block uses. The IDS come from
   `VA_POWERS` - this table only supplies copy, so a power added there without copy still
   renders (by its id) rather than disappearing. */
const POWER_COPY = {
  replyPublic: { label: "Reply to the customer", desc: "Answers in the portal, and only when the person being answered is the request's reporter." },
  replyInternal: { label: "Reply internally", desc: "Writes an internal note on the issue. Customers never see it." },
  assign: { label: "Assign", desc: "Sets the assignee of an issue inside the write scope." },
  transition: { label: "Transition", desc: "Moves an issue through its workflow inside the write scope." },
  editFields: { label: "Edit fields", desc: "Changes ordinary issue fields inside the write scope. Never configuration." },
  confluenceRead: { label: "Read Confluence", desc: "Reads pages so an answer can quote your documentation." },
  confluenceWrite: { label: "Write Confluence", desc: "Creates or updates a page. Updates are version checked." },
  git: { label: "Git", desc: "Reads repositories and opens pull requests through a configured connection." },
  webSearch: { label: "Web search", desc: "Looks something up on the public web before answering." },
};

/**
 * The guardrail spinners. Each one publishes its OWN range from `VA_CEILINGS`, so a spinner
 * cannot offer a number the save path would clamp away - and the range is rendered next to
 * the box rather than discovered by being refused.
 */
export function GuardrailPicker({ ceilings = {}, value = {}, defaults = {}, onChange, projects = [], disabled = false }) {
  const keys = Object.keys(ceilings);
  const num = (k, raw) => {
    const t = String(raw).trim();
    // An emptied box is not a value: it keeps the last committed number rather than
    // emitting 0 (Number("") === 0), which is how a cleared spinner used to silently
    // disable a brake.
    if (t === "") return;
    const n = Number(t);
    if (!Number.isFinite(n)) return;
    onChange({ ...value, [k]: Math.trunc(n) });
  };
  return (
    <div className="va-guards">
      {keys.map((k) => (
        <div className="va-guard" key={k}>
          <label className="label" htmlFor={`va-g-${k}`}>{GUARD_COPY[k] ? GUARD_COPY[k].label : k}</label>
          <input
            id={`va-g-${k}`} type="number" className="schp-num" disabled={disabled}
            min={ceilings[k].min} max={ceilings[k].max}
            value={value[k] === undefined ? (defaults[k] === undefined ? ceilings[k].min : defaults[k]) : value[k]}
            onChange={(e) => num(k, e.target.value)}
          />
          <span className="va-guard-range">{ceilings[k].min} to {ceilings[k].max}</span>
          {GUARD_COPY[k] && <span className="va-guard-desc">{GUARD_COPY[k].desc}</span>}
        </div>
      ))}
      <div className="va-guard va-guard-wide">
        <span className="label">Approval inbox</span>
        <ChipRadio
          ariaLabel="Approval project" disabled={disabled}
          options={[{ value: "", label: "None - ask on the issue" }, ...projects]}
          value={value.approvalProjectKey === undefined ? "" : value.approvalProjectKey}
          onChange={(v) => onChange({ ...value, approvalProjectKey: v })}
        />
        <span className="va-guard-desc">Where anything that needs a human decision goes. With no inbox set it goes to the issue as an internal note.</span>
      </div>
    </div>
  );
}

const GUARD_COPY = {
  capsPerHour: { label: "Messages per hour", desc: "How often it may speak at all." },
  capsPerDay: { label: "Messages per day", desc: "The daily ceiling on top of the hourly one." },
  owedPerHour: { label: "Owed replies per hour", desc: "Its own cap for replies a human is actually waiting on." },
  maxItemsPerTick: { label: "Items per tick", desc: "How much work one run picks up." },
  shadowTicks: { label: "Shadow ticks", desc: "How many runs it stages without posting, so you can read its drafts first." },
  minPostGapMinutes: { label: "Minimum post gap (minutes)", desc: "A staged reply waits at least this long, and for a later tick than the one that wrote it." },
  antiPileUpDays: { label: "Anti pile-up (days)", desc: "If it already spoke last on an issue within this window it stays quiet, unless a human is waiting." },
  otherWriterQuietMinutes: { label: "Other writer quiet (minutes)", desc: "If somebody else wrote on the issue this recently, it stays quiet." },
  maxWritesPerRun: { label: "Changes per run", desc: "The hard ceiling on how many issues one run may change." },
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The posting window: which days, and between which hours a staged reply may go out. */
export function PostWindowPicker({ value = {}, onChange, disabled = false }) {
  const days = arr(value.days);
  const toggle = (d) => {
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d];
    onChange({ ...value, days: next.sort((a, b) => a - b) });
  };
  return (
    <div className="va-window">
      <div className="va-chips" role="group" aria-label="Posting days">
        {DAY_LABELS.map((lbl, i) => (
          <button type="button" key={lbl} disabled={disabled} className={`va-chip ${days.includes(i) ? "on" : ""}`} aria-pressed={days.includes(i)} onClick={() => toggle(i)}>{lbl}</button>
        ))}
      </div>
      <div className="va-window-times">
        <span className="label">From</span>
        <input type="time" className="va-time" value={value.from || "00:00"} disabled={disabled} onChange={(e) => onChange({ ...value, from: e.target.value })} aria-label="Posting window start" />
        <span className="label">to</span>
        <input type="time" className="va-time" value={value.to || "23:59"} disabled={disabled} onChange={(e) => onChange({ ...value, to: e.target.value })} aria-label="Posting window end" />
      </div>
    </div>
  );
}

/** A time zone pick. `CustomSelect`, searchable - never a native select. */
export function ZonePicker({ zones = [], value, onChange, disabled = false }) {
  const list = zones.length ? zones : ["UTC"];
  return <CustomSelect value={value || "UTC"} onChange={onChange} options={list} searchable searchPlaceholder="Search zones…" ariaLabel="Time zone" disabled={disabled} />;
}

/**
 * The refusals and the notes, as SOLID blocks. A refusal is red and names the field; a note
 * is slate and reports something that was changed rather than rejected. Neither is a tint
 * and neither is a rail: they are filled blocks with white text, because an admin who cannot
 * see why an answer did not land will type it again.
 */
export function NoteList({ items = [], kind = "note" }) {
  if (!arr(items).length) return null;
  return (
    <div className={`va-notes va-notes-${kind}`} role={kind === "refusal" ? "alert" : "note"}>
      {items.map((n, i) => (
        <div className="va-note" key={`${n.field || "x"}-${i}`}>
          {n.field && <span className="va-note-field">{n.field}</span>}
          <span className="va-note-text">{n.reason || String(n)}</span>
        </div>
      ))}
    </div>
  );
}

/** A free-text list (mention account ids). Typed, because there is no catalogue for it. */
export function TextListInput({ values = [], onChange, placeholder, max = 10, disabled = false, ariaLabel }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (!v || arr(values).includes(v) || arr(values).length >= max) return;
    onChange([...arr(values), v]); setDraft("");
  };
  return (
    <div className="va-textlist">
      <div className="va-textlist-row">
        <input
          type="text" className="lst-input" value={draft} placeholder={placeholder} disabled={disabled} aria-label={ariaLabel}
          onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
        />
        <button type="button" className="btn-small" onClick={add} disabled={disabled || !draft.trim()}>Add</button>
      </div>
      {!!arr(values).length && (
        <div className="va-chips">
          {arr(values).map((v) => (
            <button type="button" key={v} className="va-chip on" disabled={disabled} onClick={() => onChange(values.filter((x) => x !== v))} title="Remove">{v} ×</button>
          ))}
        </div>
      )}
    </div>
  );
}
