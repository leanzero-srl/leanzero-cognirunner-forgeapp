/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * THE CODER PANEL (1.4 commit 9b) - `jira:issuePanel coder-panel`, plan section 2.4.
 *
 * It is the ONLY surface a developer uses the Coder from, and it owns exactly four
 * backend doors, all of them contracts frozen by commit 8 (src/index.js, src/coder-engine.js):
 *
 *   getAgentCapability  -> { enabled, reason, provider, edition, agentModel }
 *   startCoderTurn      -> { success, async: true, taskId, threadId }   (LONG queue, 900 s)
 *   getCoderThread      -> { thread: { messages[], turns, pendingTicketId? } }
 *   confirmCoderTicket  -> { ..., async: true, taskId } | { duplicate: true }
 *
 * FOUR RULES THIS FILE IS BUILT AROUND
 *
 * 1. THE CAPABILITY IS ANSWERED BEFORE ANYTHING IS OFFERED. A composer that posts into a
 *    capability the site does not have is a refusal told as an outage (the F-233 shape).
 *    The card renders the reason and the remedy from `agentCapabilityCopy` in
 *    src/shared/edition.js - the ONE table the Code tab and the action checklist already
 *    read, so no third set of words for the same product statement.
 *
 * 2. THE MODEL'S TEXT IS TEXT. Assistant replies are rendered as plain paragraphs, split on
 *    blank lines. Never HTML, never markdown, never dangerouslySetInnerHTML: the reply is
 *    untrusted content that reached us through a fenced prompt, and the one thing that must
 *    stay true of it is that it cannot render anything.
 *
 * 3. THE TICKET ID IS NEVER SHOWN. A consent chip names the ACTION and its argument preview;
 *    the id lives in state and travels back on the button press. It is a capability handle,
 *    not user-facing copy, and rendering it invites someone to read one out of a screenshot.
 *
 * 4. A STALE RESULT NEVER LANDS. Every turn takes a generation token (the FunctionBlock
 *    pattern); a poll whose token is no longer current drops its answer on the floor rather
 *    than painting a previous turn's reply over a newer one. A 900 s turn is long enough for
 *    a second one to be started over it, so this is a real race, not a theoretical one.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@forge/bridge";
import CustomSelect from "./CustomSelect.jsx";
import { agentCapabilityCopy } from "../../../../src/shared/edition.js";
import { isPermissionRefusal, isUpgradeRequired, permissionRefusalText, upgradeRequiredText, UPGRADE_REQUIRED_HEADLINE } from "../refusal.js";

/* A coder turn runs on the 900 s long consumer, so the poll budget is 300 tries at 3 s
   (= 900 s) rather than the 40 the 120 s consumer's surfaces use. Same cadence, same
   resolver, a budget that matches the queue the task actually sits on. */
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_TRIES = 300;

/* One thread PER PERSON per issue, and a stable id so a reload finds it again. The engine
   keys threads by issueKey + threadId and the resolver refuses a turn on somebody else's
   thread, so folding the account id in is what stops two developers on one issue colliding
   on a shared id and being told "not yours" for a thread they never opened. */
const threadIdFor = (accountId) => `p_${String(accountId || "anon").replace(/[^a-zA-Z0-9]/g, "").slice(-12) || "anon"}`;

/* F-368 - A SECOND CONVERSATION, AND A WAY BACK TO THE FIRST.
   The stable id above stays the DEFAULT, so a reload still lands on the thread you were
   in. What it must not be is the only thread a person can ever have on an issue: a fresh
   plan should not inherit the old one's history and its compaction pins, and before this
   there was no affordance to start one.

   The switcher is a PER-VIEWER CONVENIENCE, not a record. The backend exposes
   getCoderThread({issueKey, threadId}) and nothing that LISTS threads, so the only ids a
   panel can offer are the ones this browser has opened. They live in localStorage keyed by
   issue; a viewer with nothing stored sees exactly the default thread and no list, and an
   id whose thread no longer exists simply reads back empty. Every access is wrapped,
   because a Custom UI iframe in a locked-down browser can throw on the first touch of
   localStorage, and a storage fault must never take the panel with it. */
const THREAD_MEMORY_CAP = 8;
const threadsKey = (issueKey) => `cognirunner.coder.threads.${issueKey || "none"}`;
const readThreads = (issueKey) => {
  try {
    const raw = window.localStorage.getItem(threadsKey(issueKey));
    const parsed = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((r) => r && typeof r.id === "string").slice(0, THREAD_MEMORY_CAP);
  } catch (e) { return []; }
};
const writeThreads = (issueKey, rows) => {
  try { window.localStorage.setItem(threadsKey(issueKey), JSON.stringify(rows.slice(0, THREAD_MEMORY_CAP))); } catch (e) { /* the switcher is a convenience; losing it is not a failure */ }
};
/* The label is the only place a thread id influences copy, and it never PRINTS the id: a
   minted id carries its own timestamp, so the chip can say when the conversation started,
   and the default one is simply the first. */
const threadLabel = (id, defaultId) => {
  if (id === defaultId) return "First conversation";
  const ms = Number(String(id).replace(/^t_/, ""));
  if (!Number.isFinite(ms) || ms <= 0) return "Conversation";
  const d = new Date(ms);
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
};

/** Plain paragraphs. See rule 2 - this is the whole rendering of model text. */
const paragraphs = (text) => String(text || "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

const ROLE_LABEL = { user: "You", assistant: "Coder", system: "Coder" };

export default function CoderPanel({ issueKey, accountId }) {
  const [cap, setCap] = useState(null);            // the getAgentCapability answer
  const [capState, setCapState] = useState("loading"); // loading | ok | refused | upgrade | error
  const [refusal, setRefusal] = useState(null);    // the raw refusal body for the permission arm
  const [messages, setMessages] = useState([]);
  const [connections, setConnections] = useState([]);
  const [connectionId, setConnectionId] = useState("");
  const [simulation, setSimulation] = useState(false);
  const [draft, setDraft] = useState("");
  const [running, setRunning] = useState(false);
  const [rounds, setRounds] = useState(0);
  const [ticket, setTicket] = useState(null);      // { id, action, argsPreview }
  const [changeOpen, setChangeOpen] = useState(false);
  const [changeText, setChangeText] = useState("");
  const [deciding, setDeciding] = useState("");    // which decision button is in flight
  const [outcome, setOutcome] = useState(null);    // the finished turn: { reply, actions, endedBy, rounds }
  const [error, setError] = useState("");

  const defaultThreadId = threadIdFor(accountId);
  const [threadId, setThreadId] = useState(defaultThreadId);
  const [knownThreads, setKnownThreads] = useState([]);
  /* The transcript is a scroll box (it has to be - a long thread would push the composer
     off an issue panel), so the NEWEST message is the one off-screen by default. Without
     this the answer to the turn you just took is the one thing you cannot see: caught in
     the commit's own screenshots, where the final reply sat below the fold of the box. */
  const threadRef = useRef(null);
  const mountedRef = useRef(true);
  const pollRef = useRef(null);
  // Rule 4: the token of the turn currently allowed to write state.
  const genRef = useRef(0);

  // F-368: the remembered ids, read once per issue. Nothing stored is the normal first
  // open, and it renders as no list at all rather than an empty control.
  useEffect(() => { setKnownThreads(readThreads(issueKey)); }, [issueKey]);

  useEffect(() => () => {
    mountedRef.current = false;
    if (pollRef.current) clearTimeout(pollRef.current);
  }, []);

  // Keep the newest message in view. `scrollTop = scrollHeight` rather than
  // scrollIntoView, which would scroll the whole ISSUE under the panel.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  /* ---------------------------------------------------------------- mount reads */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await invoke("getAgentCapability");
        if (cancelled || !mountedRef.current) return;
        if (isUpgradeRequired(res)) { setRefusal(res); setCapState("upgrade"); return; }
        if (isPermissionRefusal(res)) { setRefusal(res); setCapState("refused"); return; }
        if (!res || res.success !== true) {
          // The restrictive side: a read that did not answer is "off", never "on".
          setCap({ enabled: false, reason: "unknown" });
          setCapState("ok");
          return;
        }
        setCap(res);
        setCapState("ok");
      } catch (e) {
        if (!cancelled && mountedRef.current) { setCap({ enabled: false, reason: "unknown" }); setCapState("ok"); }
      }
    })();
    return () => { cancelled = true; };
  }, [issueKey]);

  /* F-368 split the mount read in two, because the THREAD can now change without the
     capability changing: switching conversations must re-read the transcript and nothing
     else. Both reads stay gated on an ENABLED capability, so a site with the Coder off
     still makes exactly ONE refused read and never asks for a thread it may not have. */
  const capEnabled = capState === "ok" && !!(cap && cap.enabled === true);

  useEffect(() => {
    if (!capEnabled) return undefined;
    let cancelled = false;
    (async () => {
      /* "not found" is the normal first-open answer, so it is NOT an error banner: an
         empty transcript is exactly what a developer who has never used the panel - or
         who has just started a new conversation - should see. Only a refusal is worth
         saying out loud. */
      try {
        const t = await invoke("getCoderThread", { issueKey, threadId });
        if (cancelled || !mountedRef.current) return;
        if (isPermissionRefusal(t)) { setRefusal(t); setCapState("refused"); return; }
        if (t && t.success && t.thread) {
          setMessages(Array.isArray(t.thread.messages) ? t.thread.messages : []);
          /* A ticket that outlived the page. The thread record keeps only the ID, so the
             action and its preview are genuinely unknown here - the chip says so rather
             than inventing a name for a write the user is being asked to authorise. */
          if (t.thread.pendingTicketId) setTicket({ id: t.thread.pendingTicketId, action: null, argsPreview: null });
        }
      } catch (e) { /* a thread we could not read is an empty thread, not a broken panel */ }
    })();
    return () => { cancelled = true; };
  }, [issueKey, threadId, capEnabled]);

  /* Connections drive the picker, and ONLY the picker. Read once the capability is on and
     never per conversation: the list does not depend on which thread is open. */
  useEffect(() => {
    if (!capEnabled) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const c = await invoke("listGitConnections");
        if (cancelled || !mountedRef.current) return;
        if (c && c.success && Array.isArray(c.connections)) setConnections(c.connections);
      } catch (e) { /* no picker */ }
    })();
    return () => { cancelled = true; };
  }, [capEnabled]);

  /* ------------------------------------------------------------------- polling */
  const applyResult = useCallback((result) => {
    const r = result || {};
    setRounds(Number(r.rounds) || 0);
    if (r.awaiting === "confirm" && r.ticket && r.ticket.id) {
      setTicket({ id: r.ticket.id, action: r.ticket.action || null, argsPreview: r.ticket.argsPreview || null });
      setOutcome(null);
    } else {
      setTicket(null);
      setOutcome({
        reply: r.reply || "",
        actions: Array.isArray(r.actions) ? r.actions : [],
        endedBy: r.endedBy || "",
        rounds: Number(r.rounds) || 0,
        ok: r.success !== false,
      });
      if (r.error) setError(String(r.error));
    }
    /* The thread is the record; re-read it so the transcript shows what the turn added.
       When it comes back, the reply is ALREADY in the transcript, so the outcome card drops
       its own copy - one reply on screen, never two. The card keeps the reply only when the
       re-read failed, which is the one case where dropping it would lose the answer. */
    invoke("getCoderThread", { issueKey, threadId })
      .then((t) => {
        if (!mountedRef.current) return;
        if (t && t.success && t.thread && Array.isArray(t.thread.messages)) {
          setMessages(t.thread.messages);
          setOutcome((o) => (o ? { ...o, reply: "" } : o));
        }
      })
      .catch(() => { /* the reply on the outcome card is still the answer */ });
  }, [issueKey, threadId]);

  const pollTask = useCallback((taskId, token) => {
    let attempts = 0;
    const tick = async () => {
      attempts++;
      try {
        const res = await invoke("getAsyncTaskResult", { taskId });
        if (!mountedRef.current || genRef.current !== token) return; // rule 4
        if (res && res.success) {
          if (res.status === "done") { applyResult(res.result); setRunning(false); return; }
          // A cancel is an operator action, not a failure verdict (the F-129 contract).
          if (res.cancelled === true) { setError("The turn was cancelled."); setRunning(false); return; }
          if (res.status === "error") { setError(String(res.error || "The Coder turn failed.")); setRunning(false); return; }
          if (attempts < POLL_MAX_TRIES) { pollRef.current = setTimeout(tick, POLL_INTERVAL_MS); return; }
          setError("The Coder turn is taking longer than its 15 minute budget. Reload the panel to see where it got to.");
          setRunning(false);
          return;
        }
        setError(String((res && res.error) || "The Coder status could not be read."));
        setRunning(false);
      } catch (e) {
        if (!mountedRef.current || genRef.current !== token) return;
        setError(String((e && e.message) || e));
        setRunning(false);
      }
    };
    tick();
  }, [applyResult]);

  /* ------------------------------------------------------------- F-368 threads */
  /* A switch DROPS the turn in flight exactly the way a new turn does: the generation
     token moves, so a poll that lands afterwards writes nothing into a conversation it
     does not belong to (rule 4, now ACROSS threads as well as within one). */
  const switchThread = (id) => {
    if (running || deciding || !id || id === threadId) return;
    genRef.current++;
    if (pollRef.current) clearTimeout(pollRef.current);
    setThreadId(id);
    setMessages([]); setTicket(null); setOutcome(null); setError(""); setRounds(0);
    setChangeOpen(false); setChangeText("");
  };

  const startNewConversation = () => {
    if (running || deciding) return;
    const id = `t_${Date.now()}`;
    /* The DEFAULT thread is remembered at the same moment, so the first conversation
       stays reachable after the switch that would otherwise hide it. */
    const rows = [{ id, at: new Date().toISOString() }, ...knownThreads.filter((r) => r.id !== id)];
    if (!rows.some((r) => r.id === defaultThreadId)) rows.push({ id: defaultThreadId, at: null });
    const capped = rows.slice(0, THREAD_MEMORY_CAP);
    setKnownThreads(capped);
    writeThreads(issueKey, capped);
    switchThread(id);
  };

  /* --------------------------------------------------------------------- send */
  const send = async () => {
    const text = draft.trim();
    if (!text || running) return;
    const token = ++genRef.current;
    if (pollRef.current) clearTimeout(pollRef.current);
    setRunning(true); setError(""); setOutcome(null); setRounds(0);
    // Show the user's own words immediately. The thread re-read after the turn replaces
    // this optimistic row with the stored one, so nothing is duplicated.
    setMessages((prev) => [...prev, { role: "user", content: text, at: new Date().toISOString() }]);
    setDraft("");
    try {
      const res = await invoke("startCoderTurn", {
        issueKey, message: text, threadId,
        simulation: simulation === true,
        connectionId: connectionId || undefined,
      });
      if (!mountedRef.current || genRef.current !== token) return;
      if (isUpgradeRequired(res)) { setRefusal(res); setCapState("upgrade"); setRunning(false); return; }
      if (isPermissionRefusal(res)) { setRefusal(res); setCapState("refused"); setRunning(false); return; }
      if (res && res.agentDisabled) { setCap({ enabled: false, reason: res.reason || "unknown" }); setRunning(false); return; }
      if (res && res.success && res.async && res.taskId) { pollTask(res.taskId, token); return; }
      setError(String((res && res.error) || "The Coder turn could not be started."));
      setRunning(false);
    } catch (e) {
      if (!mountedRef.current || genRef.current !== token) return;
      setError(String((e && e.message) || e));
      setRunning(false);
    }
  };

  /* ------------------------------------------------------------------ decision */
  const decide = async (decision) => {
    if (!ticket || deciding) return;
    if (decision === "change" && !changeText.trim()) return;
    const token = ++genRef.current;
    if (pollRef.current) clearTimeout(pollRef.current);
    setDeciding(decision); setError("");
    try {
      const res = await invoke("confirmCoderTicket", {
        ticketId: ticket.id, decision,
        change: decision === "change" ? changeText.trim() : undefined,
      });
      if (!mountedRef.current || genRef.current !== token) return;
      setDeciding("");
      if (isPermissionRefusal(res)) { setRefusal(res); setCapState("refused"); return; }
      if (res && res.duplicate) {
        // Answered already, on another tab or another click. Say so and clear the chip.
        setTicket(null); setChangeOpen(false); setChangeText("");
        setError("That confirmation had already been answered.");
        return;
      }
      if (!res || res.success !== true) { setError(String((res && res.error) || "The decision could not be recorded.")); return; }
      setTicket(null); setChangeOpen(false); setChangeText("");
      if (res.error) { setError(String(res.error)); return; } // recorded, but not resumed
      if (res.async && res.taskId) { setRunning(true); setOutcome(null); pollTask(res.taskId, token); }
    } catch (e) {
      if (!mountedRef.current || genRef.current !== token) return;
      setDeciding("");
      setError(String((e && e.message) || e));
    }
  };

  /* ------------------------------------------------------------------ rendering */
  if (capState === "loading") return <div className="coder-cap coder-cap-loading"><span className="spin-ring" /> <span className="coder-cap-title">Checking the Coder</span></div>;

  if (capState === "upgrade") {
    return (
      <div className="coder-cap coder-cap-off">
        <span className="coder-chip coder-chip-off">Coder off</span>
        <p className="coder-cap-title">{UPGRADE_REQUIRED_HEADLINE}</p>
        <p className="coder-cap-remedy">{upgradeRequiredText(refusal)}</p>
      </div>
    );
  }

  if (capState === "refused") {
    return (
      <div className="coder-cap coder-cap-off">
        <span className="coder-chip coder-chip-off">No access</span>
        <p className="coder-cap-remedy">{permissionRefusalText(refusal, "the Coder")}</p>
      </div>
    );
  }

  const enabled = !!(cap && cap.enabled);
  const copy = agentCapabilityCopy(cap && cap.reason);

  if (!enabled) {
    return (
      <div className="coder-cap coder-cap-off">
        <span className="coder-chip coder-chip-off">Coder off</span>
        <p className="coder-cap-title">{copy.title}</p>
        <p className="coder-cap-remedy">{copy.remedy}</p>
        {copy.link === "settings" && (
          <p className="coder-cap-link">Apps &rsaquo; CogniRunner &rsaquo; Settings</p>
        )}
      </div>
    );
  }

  const connOptions = connections.map((c) => ({ value: c.id, label: c.label || c.id, meta: c.kind }));
  const showPicker = connOptions.length > 1;
  const busy = running || !!deciding;
  /* The chips: the threads this browser remembers, plus the one on screen and the default,
     newest first. Ids are never printed - threadLabel turns each one into a date or into
     "First conversation". */
  const threadChips = (() => {
    const ids = [];
    for (const r of knownThreads) if (r && r.id && !ids.includes(r.id)) ids.push(r.id);
    if (!ids.includes(threadId)) ids.unshift(threadId);
    if (!ids.includes(defaultThreadId)) ids.push(defaultThreadId);
    return ids.slice(0, THREAD_MEMORY_CAP);
  })();

  return (
    <div className="coder">
      <div className="coder-cap coder-cap-on">
        <span className="coder-chip coder-chip-on">Coder on</span>
        <p className="coder-cap-title">{copy.title}</p>
        <p className="coder-cap-facts">
          <span className="coder-fact">{cap.provider || "provider unknown"}</span>
          {cap.agentModel && <span className="coder-fact coder-fact-model">{cap.agentModel}</span>}
        </p>
      </div>

      {/* F-368: the conversations bar. The LIST appears only when there is more than one
          thread to choose between; a switcher with a single entry is a control whose only
          value is the one already in force. */}
      <div className="coder-threads">
        {threadChips.length > 1 && (
          <div className="coder-thread-list" role="group" aria-label="Conversations on this issue">
            {threadChips.map((id) => (
              <button
                key={id}
                type="button"
                className={`coder-thread-chip${id === threadId ? " is-current" : ""}`}
                aria-pressed={id === threadId}
                onClick={() => switchThread(id)}
                disabled={busy}
              >
                {threadLabel(id, defaultThreadId)}
              </button>
            ))}
          </div>
        )}
        <button type="button" className="coder-newconv" onClick={startNewConversation} disabled={busy}>Start a new conversation</button>
      </div>

      {messages.length > 0 && (
        <div className="coder-thread" ref={threadRef}>
          {messages.map((m, i) => {
            const decision = m.kind === "decision";
            const role = decision ? "decision" : (m.role === "user" ? "user" : "assistant");
            return (
              <div className={`coder-msg coder-msg-${role} anim-rise`} key={i}>
                <div className="coder-msg-who">{decision ? "Decision" : (ROLE_LABEL[m.role] || "Coder")}</div>
                {paragraphs(m.content).map((p, j) => <p className="coder-msg-p" key={j}>{p}</p>)}
              </div>
            );
          })}
        </div>
      )}

      {ticket && (
        <div className="coder-consent">
          <div className="coder-consent-head">
            <span className="coder-chip coder-chip-consent">Needs your OK</span>
            <span className="coder-consent-action">{ticket.action || "a step"}</span>
          </div>
          <p className="coder-consent-args">{ticket.argsPreview || "The Coder is waiting for your answer before it writes anything."}</p>
          <div className="coder-consent-btns">
            <button type="button" className={`coder-btn coder-btn-go${deciding === "confirm" ? " is-busy busy-solid" : ""}`} onClick={() => decide("confirm")} disabled={busy}>Confirm</button>
            <button type="button" className="coder-btn coder-btn-alt" onClick={() => setChangeOpen((v) => !v)} disabled={busy}>Change</button>
            <button type="button" className={`coder-btn coder-btn-alt${deciding === "skip" ? " is-busy" : ""}`} onClick={() => decide("skip")} disabled={busy}>Skip</button>
          </div>
          {changeOpen && (
            <div className="coder-change">
              <textarea
                className="coder-input"
                rows={2}
                value={changeText}
                onChange={(e) => setChangeText(e.target.value)}
                placeholder="What should change before it runs?"
                aria-label="What should change before this step runs"
              />
              <button type="button" className={`coder-btn coder-btn-go${deciding === "change" ? " is-busy busy-solid" : ""}`} onClick={() => decide("change")} disabled={busy || !changeText.trim()}>Send change</button>
            </div>
          )}
        </div>
      )}

      {outcome && !ticket && (
        <div className="coder-outcome anim-rise">
          {paragraphs(outcome.reply).map((p, i) => <p className="coder-msg-p" key={i}>{p}</p>)}
          {outcome.actions.length > 0 && (
            <ul className="coder-actions">
              {outcome.actions.map((a, i) => (
                <li className="coder-action" key={i}>
                  <span className={`coder-action-dot ${a.ok === false ? "coder-action-bad" : "coder-action-ok"}`} aria-hidden="true" />
                  <span className="coder-action-name">{a.name}</span>
                  <span className="coder-action-verdict">{a.ok === false ? "failed" : "ok"}</span>
                  {Number.isFinite(Number(a.ms)) && <span className="coder-action-ms">{Number(a.ms)} ms</span>}
                </li>
              ))}
            </ul>
          )}
          <p className="coder-outcome-foot">
            {outcome.rounds ? `${outcome.rounds} round${outcome.rounds === 1 ? "" : "s"}` : "Finished"}
            {outcome.endedBy ? ` · ended by ${outcome.endedBy}` : ""}
          </p>
        </div>
      )}

      {error && <div className="coder-error" role="alert">{error}</div>}

      <div className={`coder-composer${running ? " veil-host" : ""}`}>
        <textarea
          className="coder-input"
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Tell the Coder what to do on this issue"
          aria-label="Message for the Coder"
          disabled={busy}
        />
        {showPicker && (
          <div className="coder-picker">
            <CustomSelect
              value={connectionId}
              onChange={setConnectionId}
              options={connOptions}
              placeholder="Choose a connection"
              ariaLabel="Git connection"
              disabled={busy}
            />
          </div>
        )}
        <div className="coder-composer-row">
          {/* "Dry run" is the word the owner uses for simulation everywhere else in the app. */}
          <button
            type="button"
            className={`coder-toggle${simulation ? " coder-toggle-on" : ""}`}
            role="switch"
            aria-checked={simulation}
            onClick={() => setSimulation((v) => !v)}
            disabled={busy}
          >
            <span className="coder-toggle-box" aria-hidden="true" />
            Dry run
          </button>
          <button type="button" className={`coder-btn coder-btn-go${running ? " is-busy busy-solid" : ""}`} onClick={send} disabled={busy || !draft.trim()}>Send</button>
        </div>

        {running && (
          <div className="veil">
            <span className="spin-ring" />
            <span className="veil-label">{rounds ? `Working, round ${rounds}` : "Working"}</span>
          </div>
        )}
      </div>
    </div>
  );
}
