/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useDraft from "./useDraft";
import DraftResumeCard from "./DraftResumeCard";
import { DRAFT_FORM_IDS } from "../../../../src/shared/draft-state.js";
import CustomSelect from "./CustomSelect";
import EventPicker from "./EventPicker";
import AgentConfig, { agentNeedsGitConnection } from "./AgentConfig";
import FunctionBuilder from "./FunctionBuilder";
import IssuePicker from "./IssuePicker";
import { ModeSwitch, ChipsInput, ProjectPicker, RunStat, RunResultView, RecentLogs } from "./RuleEditorBits";
import { showToast } from "./toast";
import { confirmDialog } from "../confirmDialog";
import { getEvent, eventLabel, filtersForEvents, EVENT_CATEGORIES, requiresRepoFilter, isGitEvent } from "../../../../src/shared/jira-events.js";
import { DEFAULT_AGENT_ACTIONS, DEFAULT_AGENT_ROUNDS } from "../../../../src/shared/agent-actions.js";
import { PREMADE_LISTENERS, premadeRequiresCapability, getAgentlessEngine } from "../../../../src/shared/premade-rules-catalog.js";
import { agentCapabilityCopy } from "../../../../src/shared/edition.js";
import {
  useAgentCapability, CAPABILITY_UNKNOWN_TITLE, CAPABILITY_UNKNOWN_TEXT,
  CAPABILITY_CHECKING_TITLE, CAPABILITY_RETRY_LABEL,
} from "./capability";

/* F-486 - THE CATALOGUE'S `requiresCapability` FINALLY HAS A READER HERE.
   `src/shared/premade-rules-catalog.js` declares what an instance must be able to DO
   before a premade listener can run (today: "git", the Coder toolset). Nothing in this
   tab ever asked, so on a Standard + Forge LLM site the button opened the editor, the
   admin picked repositories and wrote instructions, and the refusal arrived at SAVE -
   after all of the work. The question is the catalogue's, asked once here, and answered
   by the ONE capability read (`useAgentCapability`, byte-identical in three apps).
   An agentless row (`agentlessTaskType`) that declares NO capability is untouched: the
   deterministic engine needs no Coder, so gating it would remove a starter that works.
   F-489 - the READING of that declaration now lives beside the catalogue itself
   (`premadeRequiresCapability`), because the wizard and config-ui asked the same question
   by comparing to the literal "git" and would have waved a second capability straight
   through to a refused Save. Three askers, one answer. */
const premadeNeedsCapability = (p) => premadeRequiresCapability(p);

const newStep = () => ({ id: `fn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: "", conditionPrompt: "", operationType: "work_item_query", operationPrompt: "", endpoint: "", method: "GET", variableName: "result1", code: "", includeBackoff: false });
const emptyDraft = () => ({
  id: null, name: "", description: "", enabled: true, events: [],
  // `repos` is the git allow-list for this listener. There is NO "all repositories"
  // listener (src/listeners.js refuses one), so an empty array is a rule that cannot save
  // once a git event is picked - which is what the EventPicker field and validateDraft say.
  filters: { projectKeys: [], issueTypes: [], jql: "", changedFields: [], commentPattern: "", repos: [] },
  ignoreSelf: true, aiCondition: "", mode: "script",
  agent: { instructions: "", allowedActions: DEFAULT_AGENT_ACTIONS, maxRounds: DEFAULT_AGENT_ROUNDS },
  simulationMode: false, suppressNotifications: false,
});
const hueOf = (cat) => (EVENT_CATEGORIES.find((c) => c.id === cat) || {}).hue || "#475569";

/* F-243 — `roleUnknown` threads the "Jira could not be asked" third answer down the
   FunctionBuilder → KnowledgePanel → MemoriesTab chain this tab embeds. It is NOT an
   input to `canEdit`, which stays false either way: it only decides whether the note in
   place of the memory add form makes a claim about this reader or names the outage. */
export default function ListenersTab({ invoke, isAdmin, userRole, siteUrl, router, roleUnknown = false, accountId = null }) {
  const canEdit = isAdmin || userRole === "editor" || userRole === "admin";
  /* Ask ONLY when a row on offer needs an answer: a tab whose premades are all agentless
     must not provoke a capability read it has no use for. */
  const capabilityMatters = canEdit && PREMADE_LISTENERS.some(premadeNeedsCapability);
  const { status: capStatus, verdict: capVerdict, retry: retryCapability } = useAgentCapability(invoke, capabilityMatters);
  /* The gate direction (LAW 3): anything that is not an ENABLED verdict blocks. "Checking"
     and "could not check" are not a yes, so they block too - but each says its own thing,
     because claiming the Coder is OFF when the question never got an answer is exactly the
     F-436 defect. Returns null when the row may be opened. */
  const premadeBlock = (p) => {
    if (!premadeNeedsCapability(p)) return null;
    if (capStatus === "loading") return { kind: "checking", title: CAPABILITY_CHECKING_TITLE, text: "One moment - this starter cannot be opened until the check answers." };
    if (capStatus === "unknown") return { kind: "unknown", title: CAPABILITY_UNKNOWN_TITLE, text: CAPABILITY_UNKNOWN_TEXT };
    if (capVerdict && capVerdict.enabled === true) return null;
    const copy = agentCapabilityCopy(capVerdict ? capVerdict.reason : "unknown");
    return { kind: "off", title: copy.title, text: copy.remedy };
  };
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [expandedLogs, setExpandedLogs] = useState({ loading: false, logs: [] });
  // editor
  const [draft, setDraft] = useState(null);
  const [functions, setFunctions] = useState([newStep()]);
  const [saving, setSaving] = useState(false);
  const [testKey, setTestKey] = useState("");
  const [testEvent, setTestEvent] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [sample, setSample] = useState(null);
  const [sampleLoading, setSampleLoading] = useState(false);
  /* F-462 - the backend's `unknown-skill` refusal, handed to AgentConfig so it renders
     beside the picker that produced it. Held by REASON, never by matching the sentence. */
  const [knowledgeRefusal, setKnowledgeRefusal] = useState(null);
  /* F-917 - THE REPOSITORIES THE INSTANCE ALLOWS, for the EventPicker's repo control.
     Read from `getRuleLists` (`lists.gitconnections`), NOT `listGitConnections`: the
     latter is requireAdmin, and a workflow EDITOR may open this editor. The editor-floor
     projection (`editorConnectionView`, src/git-connections.js) carries exactly
     {id, kind, label, repos[]} - no credential state, no token - which is all a picker
     needs. `connsKnown` is kept apart from the list: a read that never answered must not
     be rendered as "this instance allows no repositories". */
  const [gitConns, setGitConns] = useState([]);
  const [gitConnsKnown, setGitConnsKnown] = useState(false);
  useEffect(() => {
    let live = true;
    invoke("getRuleLists")
      .then((r) => {
        if (!live) return;
        const rows = r && r.success && r.lists && Array.isArray(r.lists.gitconnections) ? r.lists.gitconnections : null;
        if (rows) { setGitConns(rows); setGitConnsKnown(true); }
        // A refusal or a failure is NOT an answer about the instance: leave it unknown.
      })
      .catch(() => {});
    return () => { live = false; };
  }, [invoke]);
  const loadToken = useRef(0);
  const editorToken = useRef(0);
  const expandToken = useRef(0);
  useEffect(() => () => { editorToken.current += 1; expandToken.current += 1; }, []);

  const load = useCallback(async () => {
    const token = ++loadToken.current;
    try {
      const r = await invoke("getListeners");
      if (token !== loadToken.current) return;
      if (r.success) { setRows(r.listeners || []); setLoadError(null); } else setLoadError(r.error || "Could not load listeners");
    } catch (e) { if (token === loadToken.current) setLoadError(e.message); }
    if (token === loadToken.current) setLoading(false);
  }, [invoke]);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => `${r.name} ${(r.events || []).map(eventLabel).join(" ")} ${(r.projectKeys || []).join(" ")} ${r.mode}`.toLowerCase().includes(q));
  }, [rows, search]);

  // ── list actions ──
  const toggleEnabled = async (row) => {
    setBusyId(row.id);
    try {
      const r = await invoke("setListenerEnabled", { id: row.id, enabled: !(row.enabled !== false) });
      if (r.success) { showToast(r.listener.enabled ? "Listener enabled" : "Listener disabled"); await load(); } else showToast(r.error || "Update failed", "error");
    } catch (e) { showToast(e.message, "error"); }
    setBusyId(null);
  };
  const remove = async (row) => {
    const yes = await confirmDialog(`Delete listener "${row.name}"? Its execution logs stay; the rule stops firing immediately.`, { title: "Delete listener", confirmLabel: "Delete" });
    if (!yes) return;
    setBusyId(row.id);
    try { const r = await invoke("deleteListener", { id: row.id }); if (r.success) { showToast("Listener deleted"); if (expandedId === row.id) setExpandedId(null); await load(); } else showToast(r.error || "Delete failed", "error"); } catch (e) { showToast(e.message, "error"); }
    setBusyId(null);
  };
  const expand = async (row) => {
    const token = ++expandToken.current;
    if (expandedId === row.id) { setExpandedId(null); return; }
    setExpandedId(row.id);
    setExpandedLogs({ loading: true, logs: [] });
    try { const r = await invoke("getLogs", { ruleId: row.id }); if (token === expandToken.current) setExpandedLogs({ loading: false, logs: (r && r.logs) || [] }); } catch { if (token === expandToken.current) setExpandedLogs({ loading: false, logs: [] }); }
  };

  // ── editor ──
  // Responses, especially minted IDs, belong to the editor session that requested them.
  const resetEditor = () => { editorToken.current += 1; setSaving(false); setTesting(false); setSampleLoading(false); setBusyId(null); return editorToken.current; };
  const openNew = () => { resetEditor(); setDraft(emptyDraft()); setFunctions([newStep()]); setTestResult(null); setTestKey(""); setTestEvent(""); setSample(null); setKnowledgeRefusal(null); };
  /* F-462 - PREMADE LISTENERS. The row's `seed` is a listener DRAFT, not a saved rule: it
     opens the ordinary editor pre-filled and goes out through the ordinary saveListener
     path, so every invariant that path enforces still applies. `filters.repos` is seeded
     EMPTY on purpose (src/shared/premade-rules-catalog.js) and `validateDraft` below
     refuses the save until the admin names the repositories, which is the one decision
     nobody can make for them. `agentlessTaskType` rides the draft because it is what
     dispatches the deterministic PR-review engine on an instance with no agent. */
  const openPremade = (premade) => {
    resetEditor();
    const seed = (premade && premade.seed) || {};
    setDraft({
      ...emptyDraft(),
      ...seed,
      events: Array.isArray(premade.events) ? premade.events.slice() : [],
      filters: { ...emptyDraft().filters, ...(seed.filters || {}) },
      agent: { ...emptyDraft().agent, ...(seed.agent || {}) },
      premadeKey: premade.key,
    });
    setFunctions([newStep()]);
    setTestResult(null); setTestKey(""); setTestEvent((premade.events || [])[0] || ""); setSample(null); setKnowledgeRefusal(null);
  };
  const openEdit = async (row) => {
    const token = resetEditor();
    setBusyId(row.id);
    try {
      const r = await invoke("getListener", { id: row.id });
      if (token !== editorToken.current) return;
      if (!r.success) { showToast(r.error || "Could not open listener", "error"); setBusyId(null); return; }
      const l = r.listener;
      setDraft({ ...emptyDraft(), ...l, filters: { ...emptyDraft().filters, ...(l.filters || {}) }, agent: { ...emptyDraft().agent, ...(l.agent || {}) } });
      setFunctions(Array.isArray(l.functions) && l.functions.length ? l.functions : [newStep()]);
      setTestResult(null); setTestKey(""); setTestEvent((l.events || [])[0] || ""); setSample(null); setKnowledgeRefusal(null);
    } catch (e) { if (token === editorToken.current) showToast(e.message, "error"); }
    if (token === editorToken.current) setBusyId(null);
  };
  const closeEditor = () => { resetEditor(); setDraft(null); setKnowledgeRefusal(null); load(); };
  const patch = (p) => setDraft((d) => ({ ...d, ...p }));
  const patchFilters = (p) => setDraft((d) => ({ ...d, filters: { ...d.filters, ...p } }));
  const buildPayload = () => ({ ...draft, functions: draft.mode === "script" ? functions : [] });
  // F-902 - does the DELIVERY supply the connection? Only a git-sourced event does.
  const gitBound = !!(draft && (draft.events || []).some((id) => isGitEvent(id)));
  /* F-917 - THE ENGINE, READ FROM THE ROW. `agentlessTaskType` is what the dispatcher
     routes on (`enqueueForListener`, src/listeners.js), so it is what the EDITOR must
     branch on too - not `premadeKey`, which a SAVED rule does not carry. When the row
     names an engine this listener is not an AI agent at all: there are no instructions to
     write, no actions to allow and, for an engine whose connection arrives with the
     delivery, no connection to choose. Rendering AgentConfig here was the F-917 defect -
     an instruction box the engine never reads over an action grid it never calls, which
     an admin answered either by ticking git actions (arming writes the engine's brakes do
     not cover) or by concluding the starter could not read the pull request. */
  const engine = draft ? getAgentlessEngine(draft.agentlessTaskType) : null;
  const gitConnOwed = !!(draft && draft.mode === "agent" && !engine && agentNeedsGitConnection(draft.agent, gitBound));
  const validateDraft = () => {
    if (!draft.name.trim()) return "Give the listener a name.";
    if (!draft.events.length) return "Pick at least one event.";
    // Mirrors src/listeners.js' refusal, so the admin reads it before the save round trip
    // rather than as a backend error. The BACKEND stays the gate; this is only the notice.
    if (draft.events.some((id) => requiresRepoFilter(id)) && !(draft.filters.repos || []).length) {
      return "Git events run per repository. List at least one repository as owner/name.";
    }
    if (draft.mode === "script" && !functions.some((f) => (f.code || "").trim())) return "Add at least one code step with code (describe it and click Generate).";
    // F-917 - an ENGINE row has no instructions to check: they belong to the agent turn it
    // replaces. Demanding them would refuse a starter that is already complete.
    if (draft.mode === "agent" && !engine && !draft.agent.instructions.trim()) return "Write instructions for the AI agent.";
    /* F-902 - a listener bound to a GIT event is exempt: the webhook delivery carries the
       connection and it wins over the rule's (src/agent-executors.js). Any other listener
       armed with a git action owes the name of the account it acts as. */
    if (draft.mode === "agent" && !engine && agentNeedsGitConnection(draft.agent, gitBound)) {
      return "Choose the Git connection this listener acts as.";
    }
    return null;
  };
  /* -- F-990 - AN UNFINISHED LISTENER, AND ONLY AN UNFINISHED ONE ----------------
     This editor's own state is already called `draft`, so the hook is `lstDraft`; the two
     words mean different things and the collision is worth naming rather than tidying
     away. What is persisted is the editor row plus its code steps, which together are
     everything the admin typed.

     ENABLED ONLY WHILE THE ROW HAS NO ID. Once it is saved there is a record behind the
     form: nothing is lost by a reload, and restoring a week-old copy over a row someone
     else has since edited would revert their change silently. AgentConfig is a controlled
     child of this row, so its answers ride along inside `draft.agent` with no wiring of
     its own. Test state, the sample payload and the in-flight flags stay out - they
     describe a run that has finished. */
  const lstDraftState = useMemo(() => (draft ? { row: draft, functions } : null), [draft, functions]);
  const lstDraft = useDraft(DRAFT_FORM_IDS.LISTENER_EDITOR, accountId, lstDraftState, !!draft && !draft.id);
  const restoreLstDraft = () => {
    const d = lstDraft.restore();
    if (!d) return;
    if (d.row) setDraft((prev) => (prev ? { ...prev, ...d.row } : prev));
    if (Array.isArray(d.functions) && d.functions.length) setFunctions(d.functions);
  };

  const save = async (andClose = false) => {
    const err = validateDraft();
    if (err) { showToast(err, "error"); return null; }
    const token = editorToken.current;
    setSaving(true); setKnowledgeRefusal(null);
    try {
      const r = await invoke("saveListener", { listener: buildPayload() });
      if (token !== editorToken.current) return null;
      if (r.success) { lstDraft.clear(); setDraft((d) => ({ ...d, id: r.listener.id, stats: r.listener.stats })); showToast("Listener saved"); if (andClose) closeEditor(); return r.listener; }
      if (r.reason === "unknown-skill") setKnowledgeRefusal(r.error || "A bound skill does not exist on this instance.");
      showToast(r.error || "Save failed", "error");
    } catch (e) { if (token === editorToken.current) showToast(e.message, "error"); }
    finally { if (token === editorToken.current) setSaving(false); }
    return null;
  };
  const runTest = async () => {
    const err = validateDraft();
    if (err) { showToast(err, "error"); return; }
    const token = editorToken.current;
    setTesting(true); setTestResult(null);
    try {
      const r = await invoke("testListener", { listener: buildPayload(), issueKey: testHasIssue ? testKey.trim() || null : null, eventType: testEvent || draft.events[0] });
      if (token !== editorToken.current) return;
      if (r.success) {
        setTestResult(r.result);
        // An unsaved draft gets its id minted by the test run; adopt it so the later Save
        // keeps the same identity and the test entry shows up in this listener's log history.
        if (!draft.id && r.result && r.result.ruleId) setDraft((d) => d && !d.id ? { ...d, id: r.result.ruleId } : d);
      } else setTestResult({ isValid: false, reason: r.error || "Test failed" });
    } catch (e) { if (token === editorToken.current) setTestResult({ isValid: false, reason: e.message }); }
    if (token === editorToken.current) setTesting(false);
  };
  const loadSample = async () => {
    const ev = testEvent || draft.events[0];
    if (!ev) return;
    const token = editorToken.current;
    setSampleLoading(true);
    try { const r = await invoke("getEventSample", { eventType: ev }); if (token === editorToken.current) setSample(r.success ? (r.sample || { none: true, eventType: ev }) : { none: true, eventType: ev }); } catch { if (token === editorToken.current) setSample({ none: true, eventType: ev }); }
    if (token === editorToken.current) setSampleLoading(false);
  };

  const relevantFilters = draft ? filtersForEvents(draft.events) : [];
  const activeTestEvent = testEvent || draft?.events[0] || null;
  const activeSample = sample?.eventType === activeTestEvent ? sample : null;
  const testMeta = getEvent(activeTestEvent);
  const testHasIssue = !!(testMeta && (testMeta.issueBound || testMeta.issueIdOnly));
  const testEventOptions = draft ? draft.events.map((id) => ({ value: id, label: eventLabel(id) })) : [];
  const testContext = draft ? { runtime: "listener", eventType: activeTestEvent, event: activeSample?.payload || { eventType: activeTestEvent, _note: "synthetic, no captured payload yet" } } : null;
  const codegenContext = draft ? { runtime: "listener", eventTypes: draft.events } : null;

  // ─────────────────────────── editor view ───────────────────────────
  if (draft) {
    return (
      <div className="section lst-editor anim-rise">
        <div className="section-header">
          <span className="section-title">{draft.id ? "Edit listener" : "New listener"}</span>
          <div className="section-actions">
            <button type="button" className="btn-small" onClick={closeEditor}>← Back to listeners</button>
            <button type="button" className="btn-small btn-edit" onClick={() => save(false)} disabled={saving || testing || !canEdit || gitConnOwed}>{saving ? "Saving…" : "Save"}</button>
            <button type="button" className="btn-small btn-solid" onClick={() => save(true)} disabled={saving || testing || !canEdit || gitConnOwed}>Save &amp; close</button>
          </div>
        </div>
        <div className="card lst-card">
          {lstDraft.hasDraft && (
            <DraftResumeCard
              savedAt={lstDraft.savedAt}
              what="an unfinished listener"
              onContinue={restoreLstDraft}
              onDiscard={lstDraft.discard}
            />
          )}
          <div className="lst-grid">
            <div className="form-group">
              <label className="label" htmlFor="lst-name">Name</label>
              <input id="lst-name" type="text" className="lst-input" value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder="e.g. Escalate customer complaints" maxLength={120} />
            </div>
            <div className="form-group">
              <label className="label" htmlFor="lst-desc">Description (optional)</label>
              <input id="lst-desc" type="text" className="lst-input" value={draft.description} onChange={(e) => patch({ description: e.target.value })} placeholder="What this listener is for" maxLength={2000} />
            </div>
          </div>

          <div className="form-group">
            <span className="label">When these Jira events fire</span>
            <EventPicker value={draft.events} onChange={(events) => { patch({ events }); if (!events.includes(testEvent)) setTestEvent(events[0] || ""); }} repos={draft.filters.repos} onReposChange={(repos) => patchFilters({ repos })} connections={gitConns} connectionsKnown={gitConnsKnown} />
          </div>

          <div className="form-group">
            <span className="label">Only when…</span>
            <div className="lst-filters">
              <div className="lst-filter">
                <span className="lst-filter-label">Projects</span>
                <ProjectPicker invoke={invoke} value={draft.filters.projectKeys} onChange={(projectKeys) => patchFilters({ projectKeys })} />
              </div>
              {relevantFilters.includes("issueTypes") && (
                <div className="lst-filter">
                  <span className="lst-filter-label">Issue types</span>
                  <ChipsInput value={draft.filters.issueTypes} onChange={(issueTypes) => patchFilters({ issueTypes })} placeholder="Any issue type, type a name and press Enter (e.g. Bug)" />
                </div>
              )}
              {relevantFilters.includes("changedFields") && (
                <div className="lst-filter">
                  <span className="lst-filter-label">Changed fields</span>
                  <ChipsInput value={draft.filters.changedFields} onChange={(changedFields) => patchFilters({ changedFields })} placeholder="Any field, e.g. priority, status, customfield_10010" />
                  <span className="hint">Applies to "Issue updated" only: fire when at least one of these fields is in the changelog.</span>
                </div>
              )}
              {relevantFilters.includes("commentPattern") && (
                <div className="lst-filter">
                  <span className="lst-filter-label">Comment matches (regex)</span>
                  <input type="text" className="lst-input" value={draft.filters.commentPattern} onChange={(e) => patchFilters({ commentPattern: e.target.value })} placeholder="e.g. urgent|asap|escalat" spellCheck={false} />
                </div>
              )}
              {relevantFilters.includes("jql") && (
                <div className="lst-filter">
                  <span className="lst-filter-label">Issue matches JQL</span>
                  <input type="text" className="lst-input" value={draft.filters.jql} onChange={(e) => patchFilters({ jql: e.target.value })} placeholder='e.g. priority in (High, Highest) AND labels != ignore' spellCheck={false} />
                </div>
              )}
              <label className="lst-check">
                <input type="checkbox" checked={draft.ignoreSelf !== false} onChange={(e) => patch({ ignoreSelf: e.target.checked })} />
                <span><strong>Ignore events caused by this app</strong>: prevents loops where a listener's own writes re-fire it (recommended).</span>
              </label>
            </div>
          </div>

          <div className="form-group">
            <label className="label" htmlFor="lst-aicond">AI condition (optional)</label>
            <input id="lst-aicond" type="text" className="lst-input" value={draft.aiCondition} onChange={(e) => patch({ aiCondition: e.target.value })} placeholder="e.g. the comment is a customer complaint or asks for an escalation" maxLength={1500} />
            <span className="hint">A plain-language gate the AI evaluates before running (one AI call per matching event). If the condition is not met or AI evaluation fails, the listener is skipped. Leave empty to run when the filters match.</span>
          </div>

          <div className="form-group">
            <span className="label">What happens</span>
            {/* F-917 - the MODE SWITCH is a choice between two things an admin writes. An
                engine row is neither, and offering "AI agent / Code steps" over a card that
                says "built-in engine" invites a click that silently discards the engine.
                The switch is hidden, the field is untouched, and clearing
                `agentlessTaskType` (the REST API) brings the agent editor back. */}
            {engine ? (
              <p className="hint">This starter runs a built-in engine. It costs one AI call per pull request and needs no instructions.</p>
            ) : (
              <>
                <p className="hint">Actions run as the CogniRunner app, using its Jira permissions.</p>
                <ModeSwitch runtime="listener" value={draft.mode} onChange={(mode) => patch({ mode })} />
              </>
            )}
          </div>
          {draft.mode === "script" ? (
            <div className="lst-builder">
              <FunctionBuilder functions={functions} setFunctions={setFunctions} codegenContext={codegenContext} testContext={testContext} reviewConfigType="postfunction-static" howItWorks={false} canEdit={canEdit} roleUnknown={roleUnknown} />
            </div>
          ) : engine ? (
            /* F-917 - THE ENGINE CARD, INSTEAD OF the agent editor. Not beside it: an
               instruction box and an action grid the engine never reads are not
               "extra options", they are two wrong answers to "how do I configure
               this?". The sentence, the brakes and where the connection comes from
               are all the catalogue's (AGENTLESS_ENGINES) - nothing is written here. */
            <div className="lst-engine" role="note">
              <div className="lst-engine-head">
                <span className="lst-engine-badge">BUILT-IN ENGINE</span>
                <span className="lst-engine-title">{engine.label}</span>
              </div>
              <p className="lst-engine-summary">{engine.summary}</p>
              {(engine.brakes || []).length > 0 && (
                <ul className="lst-engine-brakes">
                  {engine.brakes.map((b, i) => <li key={i}>{b}</li>)}
                </ul>
              )}
              {/* WHERE THE ACCOUNT COMES FROM, said once. For an engine fed by a git
                  webhook the delivery carries the connection (`params.connId =
                  ctx.connectionId`, enqueueGitReviewRun in src/listeners.js), so there
                  is nothing to choose and nothing to refuse the save over. */}
              <p className="lst-engine-conn">
                {engine.connection === "event"
                  ? "It acts as the Git connection whose webhook delivered the event, so there is no connection to choose here. Add the repositories above and the rule is complete."
                  : "It acts as the Git connection chosen on this rule."}
              </p>
            </div>
          ) : (
            <AgentConfig value={draft.agent} onChange={(agent) => patch({ agent })} runtime="listener" invoke={invoke} knowledgeRefusal={knowledgeRefusal} gitEventBound={gitBound} />
          )}

          <div className="lst-options">
            <label className="lst-check">
              <input type="checkbox" checked={draft.simulationMode} onChange={(e) => patch({ simulationMode: e.target.checked })} />
              <span><strong>Simulation mode</strong>: reads are live, writes are logged but never executed.</span>
            </label>
            <label className="lst-check">
              <input type="checkbox" checked={draft.suppressNotifications} onChange={(e) => patch({ suppressNotifications: e.target.checked })} />
              <span><strong>Suppress notifications</strong> on field updates (needs project admin; falls back to notifying).</span>
            </label>
            <label className="lst-check">
              <input type="checkbox" checked={draft.enabled !== false} onChange={(e) => patch({ enabled: e.target.checked })} />
              <span><strong>Enabled</strong></span>
            </label>
          </div>
        </div>

        <div className="card lst-card lst-test">
          <div className="lst-test-head">
            <span className="section-title">Test listener</span>
            <span className="hint">Tests the selected event data against filters, the AI condition and actions. Reads are live; writes are recorded. It does not trigger a real Jira event.</span>
          </div>
          <div className="lst-test-row">
            <div className="lst-test-field"><span className="label">Issue</span>{testHasIssue ? <IssuePicker value={testKey} onChange={setTestKey} /> : <span className="hint">{testMeta ? "This event has no current issue. The test uses a captured sample when available." : "Pick an event first."}</span>}</div>
            <div className="lst-test-field"><span className="label">Event</span><CustomSelect value={testEvent || draft.events[0] || ""} onChange={setTestEvent} options={testEventOptions} placeholder="Pick an event" ariaLabel="Test event" disabled={!draft.events.length} /></div>
            <div className="lst-test-actions">
              <button type="button" className="btn-small btn-solid" onClick={runTest} disabled={testing || saving || !draft.events.length}>{testing ? "Running…" : "▶ Run test"}</button>
              <button type="button" className="btn-small" onClick={loadSample} disabled={sampleLoading || !draft.events.length}>{sampleLoading ? "…" : "Show last real payload"}</button>
            </div>
          </div>
          {activeSample && (
            <div className="lst-sample">
              {activeSample.none ? <span className="hint">No payload captured yet for {eventLabel(activeSample.eventType)}, it appears here after the event fires once on this site (tests without an issue use a synthetic event until then).</span>
                : <><span className="hint">Captured {new Date(activeSample.capturedAt).toLocaleString()}, redacted sample of <code>api.context.event</code> for {eventLabel(activeSample.eventType)}:</span><pre className="runres-pre">{JSON.stringify(activeSample.payload, null, 2).slice(0, 12000)}</pre></>}
            </div>
          )}
          <RunResultView result={testResult} title="Test run (simulated)" />
        </div>
      </div>
    );
  }

  // ─────────────────────────── list view ───────────────────────────
  return (
    <div className="section">
      <div className="section-header">
        <span className="section-title">Listeners <span className="lst-count">{rows.length}</span></span>
        <div className="section-actions">
          <input type="text" className="list-search" placeholder="Search listeners…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search listeners" />
          <button type="button" className="btn-small" onClick={load}>Refresh</button>
          {canEdit && <button type="button" className="btn-small btn-solid" onClick={openNew}>+ Add Listener</button>}
        </div>
      </div>
      {loadError && <div className="alert alert-warning">{loadError}</div>}
      {/* F-462 - PREMADE LISTENERS, offered from the catalogue and never from a list kept
          here: src/shared/premade-rules-catalog.js is the one home, so a row added there
          appears here with no second edit. Each button opens the ordinary editor
          pre-filled; nothing is saved until the admin completes it and presses Save. */}
      {canEdit && PREMADE_LISTENERS.length > 0 && (
        <div className="lst-premade">
          <span className="lst-premade-label">Premade listeners</span>
          <div className="lst-premade-rows">
            {PREMADE_LISTENERS.map((p) => {
              /* F-486 - a blocked row renders DISABLED with the reason beside it, so the
                 answer arrives before the work instead of at Save. `disabled` is the
                 guarantee; the onClick guard is the second lock, because a disabled button
                 is a DOM state and the gate must not depend on one. The note is a SIBLING
                 of the button and never a child: the unknown arm carries a Retry button,
                 and a button inside a button is not something a browser will render. */
              const block = premadeBlock(p);
              return (
                <div className="lst-premade-cell" key={p.key}>
                  <button
                    type="button"
                    className={`lst-premade-btn${block ? " lst-premade-btn-blocked" : ""}`}
                    onClick={() => { if (!premadeBlock(p)) openPremade(p); }}
                    disabled={!!block}
                    title={block ? `${block.title}. ${block.text}` : p.help}
                  >
                    <span className="lst-premade-name">{p.label}</span>
                    <span className="lst-premade-help">{p.help}</span>
                  </button>
                  {block && (
                    <div
                      className={`cpf-cap lst-premade-cap ${block.kind === "off" ? "cpf-cap-off" : block.kind === "unknown" ? "cpf-cap-unknown" : "cpf-cap-checking"}`}
                      role={block.kind === "unknown" ? "alert" : "note"}
                    >
                      <span className="cpf-cap-title">{block.title}</span>
                      <span className="cpf-cap-text">{block.text}</span>
                      {block.kind === "unknown" && (
                        <span className="cpf-cap-actions">
                          <button type="button" className="cpf-cap-retry" onClick={retryCapability}>{CAPABILITY_RETRY_LABEL}</button>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="card lst-table-scroll" role="region" aria-label="Listeners table" tabIndex={0}>
        {loading ? (
          <div className="empty-state">Loading listeners…</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state lst-empty">
            <div className="lst-empty-title">{rows.length ? "No listener matches your search." : "No listeners yet."}</div>
            {!rows.length && <div>A listener reacts to Jira events (issue created, comment added, sprint started, version released, 68 events in all) and runs AI-generated code or an AI agent with the actions you allow.</div>}
            {!rows.length && canEdit && <button type="button" className="btn-small btn-solid" style={{ marginTop: 12 }} onClick={openNew}>+ Add your first listener</button>}
          </div>
        ) : (
          <table className="table lst-table">
            <thead><tr><th>Listener</th><th>Events</th><th>Scope</th><th>Mode</th><th>Last run</th><th></th></tr></thead>
            <tbody className="stagger">
              {filtered.map((row) => {
                const on = row.enabled !== false;
                const evs = row.events || [];
                const isOpen = expandedId === row.id;
                return (
                  <React.Fragment key={row.id}>
                    <tr className={on ? "" : "lst-row-off"}>
                      <td>
                        <button type="button" className="rule-expand-btn" onClick={() => expand(row)} aria-expanded={isOpen} title="Recent executions">{isOpen ? "▾" : "▸"}</button>
                        <span className="lst-name">{row.name}</span>
                        {!on && <span className="status-badge status-disabled">Disabled</span>}
                        {row.simulationMode && <span className="lst-sim">DRY-RUN</span>}
                        {row.hasAiCondition && <span className="lst-aic">AI GATE</span>}
                      </td>
                      <td>
                        <span className="lst-evs">
                          {evs.slice(0, 3).map((id) => { const e = getEvent(id); return <span key={id} className="evp-chip evp-chip-sm" style={{ background: hueOf(e ? e.category : "") }}>{eventLabel(id)}</span>; })}
                          {evs.length > 3 && <span className="lst-more">+{evs.length - 3}</span>}
                        </span>
                      </td>
                      <td className="lst-scope">{row.projectKeys && row.projectKeys.length ? row.projectKeys.join(", ") : "All projects"}</td>
                      <td><span className={`type-badge ${row.mode === "agent" ? "lst-mode-agent" : "lst-mode-script"}`}>{row.mode === "agent" ? "AI agent" : "Code"}</span></td>
                      <td><RunStat stats={row.stats} /></td>
                      <td className="row-actions">
                        {canEdit && <button type="button" className="btn-small btn-edit" onClick={() => openEdit(row)} disabled={busyId === row.id}>Edit</button>}
                        {canEdit && <button type="button" className="btn-small" onClick={() => toggleEnabled(row)} disabled={busyId === row.id}>{on ? "Disable" : "Enable"}</button>}
                        {canEdit && <button type="button" className="btn-small btn-danger" onClick={() => remove(row)} disabled={busyId === row.id}>Delete</button>}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="rule-accordion-row"><td colSpan={6} className="rule-accordion-cell"><div className="rule-accordion-inner anim-rise"><div className="rule-accordion-title">Recent executions</div><RecentLogs logs={expandedLogs.logs} loading={expandedLogs.loading} /></div></td></tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
