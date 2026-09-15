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

import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@forge/bridge";
import CustomSelect from "./CustomSelect";
import { VA_POWER_COPY, VA_SUGGESTED_POST_WINDOW, vaFieldLabel } from "../../../../src/shared/va-config.js";
import { VA_DESK_QUEUES_UNREADABLE, vaWholeDeskSentence } from "../../../../src/shared/va-wizard.js";

const arr = (v) => (Array.isArray(v) ? v : []);

/** A multi-pick chip row. Solid fill when on, per the design rules - never a tint. */
export function ChipPicker({ options = [], values = [], onChange, max = null, capNoun = "", ariaLabel, disabled = false, empty = "Nothing to pick." }) {
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
      {/* F-969 - A COUNTER WITH NO NOUN COUNTS NOTHING. "0/50" beside a row of project
          chips was the only number on the step and it never said what it was a number of;
          `capNoun` is the SAME word the label above the row uses. */}
      {max != null && <span className="va-chip-cap">{on.size} of {max}{capNoun ? ` ${capNoun}` : ""}</span>}
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
export function DeskQueuePicker({ desks = [], value = [], onChange, maxDesks = 10, maxQueuesPerDesk = 20, disabled = false, onRetry = null, retrying = false }) {
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
            {/*
              F-964 - A DESK WHOSE QUEUE LIST COULD NOT BE READ SAYS SO, HERE, WHILE THE
              ANSWER CAN STILL BE CHANGED. A desk offered with no queues means "sweep the
              whole desk" (F-953), and an unreadable list looked exactly like an empty one.
              The sentence comes from its ONE home in va-wizard.js so the review card says
              the same words, and it is rendered whether or not the desk is ticked, because
              it is what the admin needs BEFORE ticking it. Solid red via --error-color, so
              it is the same red in both themes and no left rail is involved.
            */}
            {d.queuesUnreadable === true && (
              <p className="va-desk-unreadable" style={{ color: "var(--error-color)", fontWeight: 700, fontSize: "11.5px", lineHeight: 1.45, margin: "8px 0 0" }}>
                {VA_DESK_QUEUES_UNREADABLE}.
                {onRetry && (
                  <button type="button" className="va-chip" disabled={disabled || retrying} onClick={onRetry} style={{ marginLeft: "8px" }}>
                    {retrying ? "Trying again" : "Retry"}
                  </button>
                )}
              </p>
            )}
            {/*
              F-969 - THE WIDEST SCOPE THE WIZARD CAN PRODUCE, SAID OUT LOUD. A ticked desk
              with no queue sweeps the WHOLE desk - every queue it has now and every queue
              somebody adds next month - and that decision lived only in a comment in
              va-wizard.js. It is rendered the moment the desk is ticked and disappears the
              moment a queue narrows it, in the sentence the review card repeats. Not
              rendered when the queue list could not be READ: the red sentence above already
              says the same thing about a scope nobody chose, and two sentences for one
              condition read as two conditions.
            */}
            {row && arr(row.queueIds).length === 0 && d.queuesUnreadable !== true && (
              <p className="va-desk-whole">{vaWholeDeskSentence(d.label)}</p>
            )}
            {row && (
              <div className="va-desk-queues">
                <span className="label">Queues</span>
                <ChipPicker
                  options={arr(d.queues)} values={row.queueIds} max={maxQueuesPerDesk} capNoun="queues" disabled={disabled}
                  ariaLabel={`Queues of ${d.label}`} onChange={(queueIds) => setQueues(d.value, queueIds)}
                  /* The empty list must not claim there are no queues when nobody could
                     read the list - that is the F-964 confusion in its second home. */
                  empty={d.queuesUnreadable === true ? `${VA_DESK_QUEUES_UNREADABLE}.` : "This desk has no queue this app can see."}
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

/* One sentence per power, from the SHARED copy home (`VA_POWER_COPY`), because the review
   card has to name a power in the same words this control did - it used to print the
   record's own id ("Its powers are replyInternal."). The IDS come from `VA_POWERS`; a
   power with no row here still renders by its id rather than disappearing. */
const POWER_COPY = VA_POWER_COPY;

/**
 * The guardrail spinners. Each one publishes its OWN range from `VA_CEILINGS`, so a spinner
 * cannot offer a number the save path would clamp away - and the range is rendered next to
 * the box rather than discovered by being refused.
 */
export function GuardrailPicker({ ceilings = {}, value = {}, defaults = {}, onChange, projects = [], disabled = false }) {
  // F-916 - a spinner whose value goes NOWHERE is worse than no spinner. See
  // `DERIVED_GUARDRAILS` below.
  const keys = Object.keys(ceilings).filter((k) => !DERIVED_GUARDRAILS.includes(k));
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

/*
 * F-916 - THE BRAKE THAT WAS NOT A BRAKE. `VA_CEILINGS` carries `shadowUntilTick`, so this
 * picker rendered a spinner for it, and with no `GUARD_COPY` row its label came out as the
 * raw key: "SHADOWUNTILTICK".
 *
 * Giving it a label would have been the wrong fix. `shadowUntilTick` is NOT a guardrail: it
 * lives on `status`, it is DERIVED at creation from the Shadow ticks brake
 * (`buildVaRecord`, src/shared/va-wizard.js) and re-armed afterwards by the engine, which
 * is the only thing that knows the current tick index. `normalizeVa` builds `guardrails`
 * from a fixed key list, so anything this spinner wrote landed on `guardrails.shadowUntilTick`
 * and was dropped without a word. Its ceiling belongs in `VA_CEILINGS` (the save path reads
 * it for `status.shadowUntilTick`); its CONTROL does not exist, because the number an admin
 * sets is "Shadow ticks" and this one follows from it.
 */
const DERIVED_GUARDRAILS = ["shadowUntilTick"];

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
  // The blank-value fallback is the SUGGESTION (F-916), so a control handed an empty object
  // shows the working day rather than "00:00 to 23:59", which reads as a decision to let an
  // agent post at 3am on a Sunday.
  const from = value.from || VA_SUGGESTED_POST_WINDOW.from;
  const to = value.to || VA_SUGGESTED_POST_WINDOW.to;
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
        <input type="time" className="va-time" value={from} disabled={disabled} onChange={(e) => onChange({ ...value, from: e.target.value })} aria-label="Posting window start" />
        <span className="label">to</span>
        <input type="time" className="va-time" value={to} disabled={disabled} onChange={(e) => onChange({ ...value, to: e.target.value })} aria-label="Posting window end" />
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
          {/* F-916 - the FIELD, in the words the control above it uses. The save path
              refuses by record path because that is what a REST caller needs; a person
              reading a refusal needs the label on the box they filled in. One map
              (`vaFieldLabel`), and an unmapped path keeps its own name. */}
          {n.field && <span className="va-note-field" title={n.field}>{vaFieldLabel(n.field)}</span>}
          <span className="va-note-text">{n.reason || String(n)}</span>
        </div>
      ))}
    </div>
  );
}

/*
 * F-969 - THE PEOPLE PICKER. "Pick up mentions of" used to be a text box asking for a raw
 * Atlassian account id: a 128-bit opaque string nobody has, nobody can check, and nobody
 * can tell apart from the next one. An admin who typed one wrong got no error - the id is
 * well-formed to everything downstream and the agent simply never picked up a mention.
 *
 * So it searches the DIRECTORY, the same `searchUsers` resolver the Permissions tab's add
 * box calls, and stores exactly what the record wants: account ids. The chips show NAMES.
 *
 * WHAT IT RENDERS, AND WHAT IT NEVER RENDERS. Names are fine - this is a picker, not an
 * audit trail, and the admin is choosing a colleague. E-MAIL ADDRESSES ARE NEVER RENDERED
 * here, even though `searchUsers` returns them for some rows: an intake list is not a
 * permission grant and nothing on this screen needs an address to be decided. Namesakes
 * (the wolfaenpak shape: three identical display names) are told apart by the LAST SEGMENT
 * of the account id, which is what the roster already does for a row with no address.
 *
 * A stored record carries ids only, so an id whose name this session never learned renders
 * as its own id rather than as a blank chip - the record is the truth, and a picker that
 * hid what it could not resolve would hide a mention that is still armed.
 */
const MENTION_SEARCH_MIN = 2;
const idTail = (accountId) => {
  const id = String(accountId || "");
  const seg = id.split("-").pop();
  return seg && seg !== id ? seg.slice(-6) : id.slice(-6);
};

export function PeoplePicker({ values = [], onChange, max = 10, disabled = false, ariaLabel = "People to watch for", names = {}, onSearch = null }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState(null);
  // Names learned this session, so a chip added a moment ago keeps reading as a person.
  const [known, setKnown] = useState(() => ({ ...names }));
  const timer = useRef(null);
  // Every search carries a token: a slow answer must never overwrite a newer one, and a
  // stale row left clickable is a person the admin did not search for.
  const token = useRef(0);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const search = async (q) => {
    const mine = ++token.current;
    setResults([]); setMessage(null);
    if (q.trim().length < MENTION_SEARCH_MIN) { setSearching(false); return; }
    setSearching(true);
    const run = onSearch || ((text) => invoke("searchUsers", { query: text }));
    let r;
    try { r = await run(q.trim()); } catch (e) { r = { success: false, error: "User search failed." }; }
    if (mine !== token.current) return;
    setSearching(false);
    if (!r || r.success !== true) { setMessage((r && r.error) || "User search failed."); return; }
    const found = arr(r.users);
    setResults(found);
    if (!found.length) setMessage("Nobody in this directory matches that.");
  };

  const onQuery = (v) => {
    setQuery(v);
    if (timer.current) clearTimeout(timer.current);
    if (!v.trim()) { token.current += 1; setResults([]); setMessage(null); setSearching(false); return; }
    timer.current = setTimeout(() => search(v), 250);
  };

  const add = (user) => {
    const id = String(user.accountId || "");
    if (!id || arr(values).includes(id) || arr(values).length >= max) return;
    setKnown((k) => ({ ...k, [id]: String(user.displayName || id) }));
    onChange([...arr(values), id]);
    token.current += 1;
    setQuery(""); setResults([]); setMessage(null);
  };

  const full = arr(values).length >= max;
  return (
    <div className="va-people">
      <div className="va-people-search">
        <input
          type="text" className="lst-input" value={query} disabled={disabled || full}
          placeholder={full ? `That is the ${max} this agent may watch.` : "Search people by name"}
          aria-label={ariaLabel} onChange={(e) => onQuery(e.target.value)}
        />
        {searching && <span className="spin-ring spin-ring-sm" />}
      </div>
      {!!results.length && (
        <div className="va-people-results">
          {results.map((u) => {
            const already = arr(values).includes(String(u.accountId));
            return (
              <button
                type="button" key={u.accountId} className="va-people-row" disabled={disabled || already}
                onClick={() => add(u)}
              >
                <span className="va-people-name">{u.displayName || u.accountId}</span>
                {/* The namesake discriminator. NEVER the address. */}
                <span className="va-people-tail">…{idTail(u.accountId)}</span>
                {already && <span className="va-people-already">Already on the list</span>}
              </button>
            );
          })}
        </div>
      )}
      {message && !results.length && <p className="hint va-people-note">{message}</p>}
      {!!arr(values).length && (
        <div className="va-chips">
          {arr(values).map((id) => (
            <button type="button" key={id} className="va-chip on" disabled={disabled} onClick={() => onChange(values.filter((x) => x !== id))} title="Remove">
              {known[id] || id} ×
            </button>
          ))}
        </div>
      )}
      <span className="va-chip-cap">{arr(values).length} of {max} people</span>
    </div>
  );
}
