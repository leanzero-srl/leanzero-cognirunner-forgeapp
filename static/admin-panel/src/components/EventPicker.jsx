/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from "react";
import CustomSelect from "./CustomSelect";
import { EVENT_CATEGORIES, JIRA_EVENTS, eventsByCategory, getEvent, requiresRepoFilter } from "../../../../src/shared/jira-events.js";
// F-310 - the repo-id canonical form, from the ONE home. Typing the normalisation here
// would give the picker a different answer from the allow-list and the webhook envelope,
// and the symptom would be a listener that looks configured and never fires.
import { parseRepoList, formatRepoList, isRepoIdShaped, normalizeRepoId } from "../../../../src/shared/git-ids.js";

/* Above this many offerings the repository picker grows a search box. A PRESENTATION
   threshold and nothing else - it is not a cap on anything, and it is named so the
   fixture-constants lint can tell it apart from a shared limit that happens to be 6. */
const REPO_SEARCH_FROM = 6;

// Grouped, searchable multi-select over the Jira event catalogue (single source:
// src/shared/jira-events.js). Selected events render as solid category-coloured
// chips; high-volume events carry a loud warning badge.
/* F-917 - REPOSITORIES ARE TYPED NO MORE (when they can be picked).
   The field used to be a free-text list, placeholder "owner/name, owner/other-repo", and
   a repository is not free text: `isRepoAllowed` (src/git-connections.js) FAILS CLOSED
   against the connection's own allow-list, so one typo produces a listener that saves,
   looks configured and never fires. The instance already KNOWS the answer - every
   connection carries its allow-list, and `getRuleLists` serves them at the editor floor
   as `lists.gitconnections` ({id, kind, label, repos[]}, `editorConnectionView`).

   `connections` is that list, `connectionsKnown` is whether the question was ANSWERED.
   The two are separate on purpose: an unanswered read must never be rendered as "this
   instance has no repositories", which is the proven-negative trap. Unanswered, or
   answered with nothing to offer, falls back to the typed field - so an editor is never
   left unable to name a repository. There is deliberately no "any repository" mode to
   detect: an empty allow-list allows NOTHING, by the predicate's own docblock.

   The SAVED SHAPE is unchanged: `onReposChange` still emits the same array of canonical
   repo ids `filters.repos` has always held, so `normalizeListener` sees no difference. */
export default function EventPicker({ value = [], onChange, disabled = false, repos = null, onReposChange = null, connections = null, connectionsKnown = false }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(() => new Set(["issue", "comment"]));
  /* The repos field is edited as RAW TEXT and canonicalised on BLUR, never on every
     keystroke: lower-casing mid-word moves the caret and fights the typist, and a
     half-typed "acme/" is not yet a mistake. One normalisation, one moment, one home. */
  const [repoText, setRepoText] = useState(() => formatRepoList(repos));
  const [repoTouched, setRepoTouched] = useState(false);
  useEffect(() => {
    // Follow the saved value when the editor loads a different rule, but never
    // overwrite what the user is currently typing.
    if (!repoTouched) setRepoText(formatRepoList(repos));
  }, [repos, repoTouched]);
  const selected = useMemo(() => new Set(value), [value]);
  const groups = useMemo(() => eventsByCategory(), []);
  const q = query.trim().toLowerCase();

  const toggle = (id) => {
    if (disabled) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange(JIRA_EVENTS.filter((e) => next.has(e.id)).map((e) => e.id));
  };
  const toggleGroup = (cat) => {
    const next = new Set(open);
    if (next.has(cat)) next.delete(cat); else next.add(cat);
    setOpen(next);
  };
  const selectAllIn = (cat, on) => {
    if (disabled) return;
    const ids = JIRA_EVENTS.filter((e) => e.category === cat).map((e) => e.id);
    const next = new Set(selected);
    for (const id of ids) { if (on) next.add(id); else next.delete(id); }
    onChange(JIRA_EVENTS.filter((e) => next.has(e.id)).map((e) => e.id));
  };
  const hueOf = (cat) => (EVENT_CATEGORIES.find((c) => c.id === cat) || {}).hue || "#475569";

  /* A git event NAMES a repository, and there is no "all repositories" listener: the
     catalogue says so per row (`repos: true` -> requiresRepoFilter), so the field appears
     exactly when the selection makes it required, and nothing here hardcodes a git id. */
  const needsRepos = value.some((id) => requiresRepoFilter(id));
  const parsedRepos = parseRepoList(repoText);
  const badRepos = parsedRepos.filter((r) => !isRepoIdShaped(r));
  const commitRepos = () => {
    setRepoTouched(false);
    const next = parseRepoList(repoText);
    setRepoText(formatRepoList(next));
    if (onReposChange) onReposChange(next);
  };

  /* F-917 - what the instance ALLOWS, canonicalised through the one normaliser so a
     connection row written as "Acme/Web" and a rule written as "acme/web" are the same
     repository here, exactly as they are at the gate. `ownerOf` is only a tooltip: which
     connection offers it. */
  const chosen = useMemo(() => (Array.isArray(repos) ? repos : []).map((r) => normalizeRepoId(r)).filter(Boolean), [repos]);
  const connRows = useMemo(() => (Array.isArray(connections) ? connections : []), [connections]);
  const allowedPairs = useMemo(() => {
    const out = [];
    const seen = new Set();
    for (const c of connRows) {
      for (const raw of (c && c.repos) || []) {
        const id = normalizeRepoId(raw);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push({ id, conn: String((c && c.label) || (c && c.id) || "") });
      }
    }
    return out;
  }, [connRows]);
  const allowedSet = useMemo(() => new Set(allowedPairs.map((x) => x.id)), [allowedPairs]);
  const ownerOf = useMemo(() => new Map(allowedPairs.map((x) => [x.id, x.conn])), [allowedPairs]);
  /* The PICKER is offered only when there is something real to pick. Anything else -
     the read never answered, or every allow-list is empty - falls back to the typed
     field, because an editor who cannot name a repository cannot save the rule at all. */
  const canPick = allowedPairs.length > 0;
  const addOptions = useMemo(
    () => allowedPairs.filter((x) => !chosen.includes(x.id)).map((x) => ({ value: x.id, label: x.id, meta: x.conn })),
    [allowedPairs, chosen],
  );
  // One group per connection, so an editor can see WHOSE allow-list offers a repository.
  const connGroups = useMemo(() => {
    const labels = [...new Set(allowedPairs.map((x) => x.conn))].filter(Boolean);
    if (labels.length < 2) return undefined;
    return labels.map((l) => ({ label: l, filter: (o) => o.meta === l }));
  }, [allowedPairs]);
  const addRepo = (id) => {
    const next = normalizeRepoId(id);
    if (!next || !onReposChange || chosen.includes(next)) return;
    onReposChange([...chosen, next]);
  };
  const removeRepo = (id) => { if (onReposChange) onReposChange(chosen.filter((r) => r !== id)); };

  return (
    <div className={`evp ${disabled ? "evp-disabled" : ""}`}>
      <div className="evp-selected">
        {value.length === 0 && <span className="evp-none">No events selected, pick at least one below.</span>}
        {value.map((id) => {
          const e = getEvent(id);
          return (
            <span key={id} className="evp-chip" style={{ background: hueOf(e ? e.category : "") }} title={e ? e.description : id}>
              {e ? e.label : id}
              {e && e.volume === "high" && <span className="evp-chip-vol">HIGH VOLUME</span>}
              {!disabled && <button type="button" className="evp-chip-x" aria-label={`Remove ${e ? e.label : id}`} onClick={() => toggle(id)}>×</button>}
            </span>
          );
        })}
      </div>
      {needsRepos && (
        <div className="evp-repos">
          <label className="evp-repos-label" htmlFor={canPick ? "evp-repos-add" : "evp-repos-input"}>
            <span className="evp-repos-dot" style={{ background: hueOf("git") }} />
            Repositories (required for Git events)
          </label>
          {canPick ? (
            <div className="evp-repopick">
              <div className="evp-repopick-chips">
                {chosen.length === 0 && <span className="evp-repopick-none">None yet. Pick the repositories this listener runs for.</span>}
                {chosen.map((r) => {
                  /* A repository that is on the RULE but on no connection's allow-list is
                     marked, not hidden: hiding it would delete a decision somebody made,
                     and leaving it unmarked would hide a rule that can never fire. */
                  const unallowed = !allowedSet.has(r);
                  return (
                    <span key={r} className={`evp-repo-chip${unallowed ? " is-unallowed" : ""}`} title={unallowed ? "No connection on this instance is allowed to read this repository, so the listener will never run for it." : (ownerOf.get(r) || "")}>
                      {r}
                      {unallowed && <span className="evp-repo-chip-flag">NOT ON A CONNECTION</span>}
                      {!disabled && onReposChange && <button type="button" className="evp-repo-chip-x" aria-label={`Remove ${r}`} onClick={() => removeRepo(r)}>×</button>}
                    </span>
                  );
                })}
              </div>
              <div className="evp-repopick-add">
                <CustomSelect
                  value=""
                  onChange={addRepo}
                  options={addOptions}
                  groups={connGroups}
                  searchable={addOptions.length > REPO_SEARCH_FROM}
                  searchPlaceholder="Search repositories…"
                  placeholder={addOptions.length ? "Add a repository…" : "Every allowed repository is already listed"}
                  ariaLabel="Add a repository this listener runs for"
                  disabled={disabled || !onReposChange || !addOptions.length}
                />
              </div>
              <p className="evp-repos-hint">
                Only the repositories your Git connections are allowed to read are offered, because a listener never runs for any other. A Git listener runs only for the repositories listed here.
              </p>
            </div>
          ) : (
            <>
              <input
                id="evp-repos-input"
                className={`evp-repos-input ${badRepos.length ? "invalid" : ""}`}
                type="text"
                placeholder="owner/name, owner/other-repo"
                value={repoText}
                onChange={(e) => { setRepoTouched(true); setRepoText(e.target.value); }}
                onBlur={commitRepos}
                disabled={disabled || !onReposChange}
              />
              <p className="evp-repos-hint">
                {connectionsKnown
                  ? "No Git connection on this instance allows a repository yet, so there is nothing to pick from. Add the allow-list under Code in Settings, or type the repositories here."
                  : "Comma separated, one entry per repository, written as owner/name (GitHub) or workspace/slug (Bitbucket). Lower cased when you leave the field."}
                {" "}A Git listener runs only for the repositories listed here.
              </p>
              {badRepos.length > 0 && (
                <p className="evp-repos-bad">Not in owner/name form: {badRepos.join(", ")}</p>
              )}
            </>
          )}
        </div>
      )}
      <input
        className="evp-search"
        type="text"
        placeholder="Search events (e.g. comment, sprint, version)…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search events"
        disabled={disabled}
      />
      <div className="evp-groups">
        {groups.map((g) => {
          const rows = q ? g.events.filter((e) => `${e.label} ${e.id} ${e.description}`.toLowerCase().includes(q)) : g.events;
          if (!rows.length) return null;
          const isOpen = q ? true : open.has(g.id);
          const count = g.events.filter((e) => selected.has(e.id)).length;
          return (
            <div key={g.id} className="evp-group">
              <div className="evp-group-head">
                <button type="button" className="evp-group-toggle" onClick={() => toggleGroup(g.id)} aria-expanded={isOpen}>
                  <span className="evp-group-dot" style={{ background: g.hue }} />
                  <span className="evp-group-label">{g.label}</span>
                  <span className="evp-group-count">{count}/{g.events.length}</span>
                  <span className={`evp-caret ${isOpen ? "open" : ""}`}>▾</span>
                </button>
                {!disabled && (
                  <span className="evp-group-actions">
                    <button type="button" className="evp-link" onClick={() => selectAllIn(g.id, true)}>all</button>
                    <button type="button" className="evp-link" onClick={() => selectAllIn(g.id, false)}>none</button>
                  </span>
                )}
              </div>
              {isOpen && (
                <div className="evp-rows">
                  {rows.map((e) => (
                    <label key={e.id} className={`evp-row ${selected.has(e.id) ? "on" : ""}`} title={e.id}>
                      <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggle(e.id)} disabled={disabled} />
                      <span className="evp-row-main">
                        <span className="evp-row-label">{e.label}</span>
                        <span className="evp-row-desc">{e.description}</span>
                      </span>
                      {e.volume === "high" && <span className="evp-vol">HIGH VOLUME</span>}
                      <code className="evp-row-id">{e.id}</code>
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
