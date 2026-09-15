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
import { invoke, router, view } from "@forge/bridge";
import CustomSelect from "./CustomSelect.jsx";
import FieldGuideChip from "./FieldGuideChip.jsx";
import { agentCapabilityCopy } from "../../../../src/shared/edition.js";
/* F-961/F-962 - the Manage apps path is NOT retyped here either; it has one home. */
import { manageAppsUrl } from "../../../../src/shared/manage-apps.js";
/* F-915 - THE WORDS FOR AN ACTION, from the one home that owns the ids. This panel used to
   print `open_pull_request`, `sourceBranch`, `draft false` and "ended by final" to a
   developer who is being asked to authorise a write on their own repository. Every one of
   those is an identifier out of src/shared/agent-actions.js, and the fix is to read that
   file's own words rather than to grow a second vocabulary here. */
import {
  describeAgentAction, agentActionLabel, previewKeyLabel, agentEndingText, decisionRowSentence,
} from "../../../../src/shared/agent-actions.js";
import { isPermissionRefusal, isUpgradeRequired, permissionRefusalText, upgradeRequiredText, UPGRADE_REQUIRED_HEADLINE } from "../refusal.js";
// F-436 - the capability read with a retry ladder, and the ONE wording for a read that never
// came back. Byte-identical with config-ui/admin-panel's components/capability.js.
import {
  useAgentCapability, CAPABILITY_UNKNOWN_TITLE, CAPABILITY_UNKNOWN_TEXT,
  CAPABILITY_CHECKING_TITLE, CAPABILITY_RETRY_LABEL,
} from "../capability.js";

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

/* F-463 - THE SKILLS A CONVERSATION RUNS WITH.
   `startCoderTurn` takes `skillIds` (at most MAX_TURN_SKILLS, validated backend-side), and
   the choice belongs to the CONVERSATION, not to the panel: a skill picked for a Forge-app
   plan means nothing in the next conversation about a different repository. So the ids ride
   the SAME per-viewer localStorage rows the thread switcher already keeps, keyed by thread,
   and a new conversation starts with none. Nothing here is a record: the backend stores no
   selection, and a browser that cannot read its own storage simply starts empty every time,
   which is why every access is wrapped exactly as the rows above are. */
const MAX_TURN_SKILLS = 4;
const readThreadSkills = (issueKey, threadId) => {
  const row = readThreads(issueKey).find((r) => r.id === threadId);
  const ids = row && Array.isArray(row.skillIds) ? row.skillIds : [];
  return ids.filter((v) => typeof v === "string").slice(0, MAX_TURN_SKILLS);
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

/* F-371 - THE DRY RUN IS FIXED BY THE THREAD'S FIRST TURN (the F-360 engine half).
   coder-engine.js refuses a mid-thread flip with `reason:"simulation-locked"` rather than
   converting a simulated thread into a live-writing one, so the toggle stops being a
   choice the moment a conversation has a turn. ONE sentence says so, and it is used for
   BOTH the locked control and the refusal if one still arrives - a control that explains
   itself and a banner that contradicts it would be two answers to one question. */
const simulationLockText = (simulated) =>
  `This conversation runs as a ${simulated ? "dry run" : "live run"}; start a new conversation to change it.`;

/* F-970 - THE LOCKED RUN MODE IS A STATEMENT, NOT A DISABLED SWITCH.
   A switch that cannot be moved was carrying the most consequential fact this panel knows
   - whether the next turn writes for real - in its TRACK COLOUR, and the disabled styling
   out-specified the ON colour, so locked-dry and locked-live were the same grey pixel for
   pixel. Words, in a solid chip, say it instead. They are written in capitals here rather
   than uppercased in CSS so that the string in this file is the string on the screen.
   THIRD state, and it is not cosmetic: a locked thread whose record carries no boolean
   (a row written before the flag existed, or a partial read) used to fall through to the
   `false` default and ASSERT "live run" about a conversation nobody had asked. It says it
   does not know, and offers the read again. */
const RUN_MODE_DRY_TEXT = "DRY RUN, NOTHING IS WRITTEN";
const RUN_MODE_LIVE_TEXT = "LIVE RUN, WRITES ARE REAL";
const RUN_MODE_UNKNOWN_TEXT = "STATUS UNKNOWN";
const RUN_MODE_UNKNOWN_NOTE =
  "This conversation's record did not say whether it runs as a dry run or a live run, so the panel cannot tell you. Retry the read before you send a turn.";
const RUN_MODE_RETRY_LABEL = "Retry";
/* The one visible caption the connection control never had. F-970: the skills summary
   sits immediately above it, so "Skills none" was being read as this dropdown's label. */
const CONNECTION_LABEL = "Git connection";

/** Plain paragraphs. See rule 2 - this is the whole rendering of model text. */
const paragraphs = (text) => String(text || "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

const ROLE_LABEL = { user: "You", assistant: "Coder", system: "Coder" };

/* F-915 - the kinds `stepLinksFromResult` (src/coder-engine.js) can emit, in words. An
   unlisted kind renders as "Link" rather than as its own id: the kind is derived from an
   action id by a regex over there, so it is not a closed set this file can pin. */
const LINK_KIND_LABEL = { pr: "Pull request", branch: "Branch", repo: "Repository", deploy: "Deployment", commit: "Commit", link: "Link" };

/** A provider URL is untrusted input. Only http(s) may ever reach an href. */
const safeHttpUrl = (u) => (/^https?:\/\//i.test(String(u || "")) ? String(u) : "");

/* F-374 - THE CONSENT PREVIEW IS DATA, NOT A SENTENCE.
   `buildArgsPreview` (src/coder-engine.js) returns an OBJECT keyed by the action's own
   parameter schema, already clamped: scalars, arrays of scalars-or-flat-objects, and flat
   objects (`trigger_deploy.inputs`). Handing that to React as a child throws, and before
   the boundary landed it took the whole panel with it.

   It is rendered as a definition list, one row per LEAF, because the fields F-363 added are
   exactly the ones a sentence would have dropped: `private: false` decides whether a new
   repository is public, and `inputs.environment` decides which environment a deploy hits.
   So booleans and numbers are printed LITERALLY (`false` is a value, never an absence),
   nested objects are flattened onto their path, and only strings are clamped. */
const PREVIEW_VALUE_MAX = 300;
const PREVIEW_MAX_ROWS = 40;

export const previewRows = (preview) => {
  if (!preview || typeof preview !== "object" || Array.isArray(preview)) return [];
  const rows = [];
  const push = (key, value) => {
    if (rows.length >= PREVIEW_MAX_ROWS) return;
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      if (!value.length) { rows.push({ key, text: "(none)" }); return; }
      value.forEach((item, i) => push(`${key}[${i}]`, item));
      return;
    }
    if (typeof value === "object") {
      const entries = Object.entries(value);
      if (!entries.length) { rows.push({ key, text: "(none)" }); return; }
      for (const [k, v] of entries) push(`${key}.${k}`, v);
      return;
    }
    /* A value is never blanked: `false` and `0` are statements, not absences (F-374). What
       CHANGED in F-915 is only how a boolean is SPELT - "no" rather than "false" - because
       the row is read by a person deciding whether to authorise a write, and "no" is the
       same statement in their language. A number and a string are still printed exactly. */
    rows.push({
      key,
      text: typeof value === "boolean" ? (value ? "yes" : "no")
        : typeof value === "string" ? value.slice(0, PREVIEW_VALUE_MAX) : String(value),
    });
  };
  for (const [k, v] of Object.entries(preview)) push(k, v);
  return rows.slice(0, PREVIEW_MAX_ROWS);
};

/* The ticket outlived the page: the thread record keeps only `pendingTicketId`, so the
   arguments are genuinely gone. Say that plainly rather than render an empty preview that
   reads like "this action takes no arguments" - the user is being asked to authorise a
   write, and "I cannot show you what it does" is the honest answer. */
const noPreviewText = (action) =>
  `The details of this step were not kept when the page reloaded, so ${action ? `${action} ` : "it "}cannot be described here. Nothing has run. Skip it and ask again to see the full preview before confirming.`;

/* F-954 - WHAT THE DISABLED CONFIRM IS WAITING FOR.
   A control that is off without saying why is a dead end; this is the one sentence, used
   BOTH as the button's title and as the line under the row, so the two cannot drift. */
const CONFIRM_NEEDS_PREVIEW = "Confirm needs the full preview";

/* F-954 - THE REMEDY FOR A READER WHO CANNOT APPLY IT.
   The off card used to print "Apps > CogniRunner > Settings" as a breadcrumb at every
   reader of an ISSUE panel. Most of them are developers, not Jira admins, so the
   instruction named a page they cannot open and no one they could ask. */
const ASK_ADMIN_TEXT = "Ask your Jira admin to change the provider or the edition under Apps, CogniRunner.";

/* The Manage apps link is built by `manageAppsUrl` (src/shared/manage-apps.js) - the same
   one home AgentOffState.jsx uses. A relative href inside a Custom UI iframe points at the
   iframe's sandbox origin, so it is only ever rendered once `view.getContext()` has
   reported a real origin, which is exactly what that helper answers null for. */

/* F-954 - THE COMPOSER'S CONNECTION SENTENCES.
   `connectionId` started empty, rode the turn as `undefined` and Send was enabled on the
   draft alone, so a turn on a site with several connections landed on whichever one the
   engine defaults to - in somebody else's repository, with nothing on screen that had
   asked. Three states, three different truths:
     several, none chosen -> the turn is BLOCKED and the sentence asks for the pick;
     exactly one          -> it is pre-selected (a convenience, the F-902 rule: the record
                             still carries the name it acts as, and the runtime still has
                             no fallback of its own);
     none at all          -> Send STAYS ENABLED. A plan-only turn is legitimate: the
                             executors refuse the git actions themselves and say so
                             (src/agent-executors.js), so the panel must not refuse the
                             conversation - it must say what the turn cannot do. */
const CHOOSE_CONNECTION_TEXT = "Choose the Git connection this conversation acts as";
const NO_CONNECTION_TEXT = "No Git connection on this site; the Coder can plan but not push";

export default function CoderPanel({ issueKey, accountId }) {
  const [cap, setCap] = useState(null);            // the getAgentCapability answer
  const [capState, setCapState] = useState("loading"); // loading | ok | refused | upgrade | unknown
  const [refusal, setRefusal] = useState(null);    // the raw refusal body for the permission arm
  const [messages, setMessages] = useState([]);
  const [connections, setConnections] = useState([]);
  const [connectionId, setConnectionId] = useState("");
  // F-954 - did the connection list ANSWER? An empty list and an unread one are not the
  // same statement, and only one of them licenses a sentence about this site.
  const [connsAnswered, setConnsAnswered] = useState(false);
  const [simulation, setSimulation] = useState(false);
  /* F-970 - the thread is LOCKED but the record never said which way. Distinct from
     `simulation`, which always has a boolean and would otherwise let the `false` default
     be told as "live run". Only ever true alongside `simulationLocked`. */
  const [simUnknown, setSimUnknown] = useState(false);
  const [draft, setDraft] = useState("");
  const [running, setRunning] = useState(false);
  const [rounds, setRounds] = useState(0);
  const [ticket, setTicket] = useState(null);      // { id, action, argsPreview }
  const [changeOpen, setChangeOpen] = useState(false);
  const [changeText, setChangeText] = useState("");
  const [deciding, setDeciding] = useState("");    // which decision button is in flight
  const [outcome, setOutcome] = useState(null);    // the finished turn: { reply, actions, endedBy, rounds }
  /* F-915 - what the CONFIRMED step produced, as links. They arrive on the confirm answer
     (the engine builds them for the step comment it writes onto the issue) and NOT on the
     turn that resumes afterwards, so they are held beside the outcome rather than inside
     it: the resume's `applyResult` replaces the outcome wholesale and would drop them.
     Cleared whenever the conversation moves on, because a link to the last pull request
     under the NEXT turn's answer is a claim about work that turn did not do. */
  const [links, setLinks] = useState([]);
  const [error, setError] = useState("");
  /* F-954 - the SITE origin, for the one real href the off card offers. Absent until the
     context answers, and absent forever if it never does: a link built without it points
     at the iframe's own sandbox, which is a link to nowhere. */
  const [siteUrl, setSiteUrl] = useState("");

  const defaultThreadId = threadIdFor(accountId);
  const [threadId, setThreadId] = useState(defaultThreadId);
  const [knownThreads, setKnownThreads] = useState([]);
  /* F-463 - the skills offered, and the ones this conversation runs with. An unreadable or
     refused `getSkills` leaves `skills` empty, which renders NO picker: a control with
     nothing in it is a question the reader cannot answer. */
  const [skills, setSkills] = useState([]);
  const [skillIds, setSkillIds] = useState([]);
  const [skillsOpen, setSkillsOpen] = useState(false);
  /* F-371: how many turns the OPEN conversation has. Read off the thread record, because
     the record is what the engine locks the simulation flag against - not anything this
     panel remembers. 0 means the flag is still a choice. */
  const [turns, setTurns] = useState(0);
  /* The transcript is a scroll box (it has to be - a long thread would push the composer
     off an issue panel), so the NEWEST message is the one off-screen by default. Without
     this the answer to the turn you just took is the one thing you cannot see: caught in
     the commit's own screenshots, where the final reply sat below the fold of the box. */
  const threadRef = useRef(null);
  const mountedRef = useRef(true);
  const pollRef = useRef(null);
  // Rule 4: the token of the turn currently allowed to write state.
  const genRef = useRef(0);

  /* F-954 - the site origin, asked once. Wrapped, because a context read that throws must
     cost the panel a link and never the panel. */
  useEffect(() => {
    let live = true;
    Promise.resolve(view.getContext())
      .then((c) => { if (live && c && c.siteUrl) setSiteUrl(String(c.siteUrl).replace(/\/+$/, "")); })
      .catch(() => { /* no origin, no link: the sentence and the button stand alone */ });
    return () => { live = false; };
  }, []);

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
  /* F-436 - THE CAPABILITY READ, AND THE TWO THINGS "no answer" USED TO MEAN.
     This panel used to catch a transport failure and store `{enabled:false, reason:"unknown"}`
     as though the backend had said so, then render "Coder off" with no way back: a developer
     on a flaky connection was told their instance cannot run the Coder, for the life of the
     panel. The read now runs through ../capability.js, which retries transport (2/4/8 s) and
     reports "unknown" as its own state with a Retry button. The direction is unchanged - a
     panel that does not know is still not a panel that opens the composer. */
  const { status: capStatus, verdict: capVerdict, retry: retryCapability } = useAgentCapability(invoke, true);
  useEffect(() => {
    if (!mountedRef.current) return;
    if (capStatus === "loading") { setCap(null); setCapState("loading"); return; }
    if (capStatus === "unknown") { setCap(null); setCapState("unknown"); return; }
    const res = capVerdict;
    if (isUpgradeRequired(res)) { setRefusal(res); setCapState("upgrade"); return; }
    if (isPermissionRefusal(res)) { setRefusal(res); setCapState("refused"); return; }
    if (!res || res.success !== true) {
      // An answered "no" that is neither of the two refusal shapes: the restrictive side.
      setCap({ enabled: false, reason: "unknown" });
      setCapState("ok");
      return;
    }
    setCap(res);
    setCapState("ok");
  }, [capStatus, capVerdict]);

  /* F-368 split the mount read in two, because the THREAD can now change without the
     capability changing: switching conversations must re-read the transcript and nothing
     else. Both reads stay gated on an ENABLED capability, so a site with the Coder off
     still makes exactly ONE refused read and never asks for a thread it may not have. */
  const capEnabled = capState === "ok" && !!(cap && cap.enabled === true);

  /* F-970 split the body of the mount effect out so the run-mode UNKNOWN chip can ask the
     SAME question again rather than growing a second read of its own (one question, one
     home). `isCancelled` is the mount effect's teardown probe; a Retry click passes nothing
     and so is never cancelled, which is right - the reader asked for it. */
  const loadThread = useCallback(async (isCancelled) => {
    const dead = () => (isCancelled && isCancelled()) || !mountedRef.current;
    /* "not found" is the normal first-open answer, so it is NOT an error banner: an
       empty transcript is exactly what a developer who has never used the panel - or
       who has just started a new conversation - should see. Only a refusal is worth
       saying out loud. */
    try {
      const t = await invoke("getCoderThread", { issueKey, threadId });
      if (dead()) return;
      if (isPermissionRefusal(t)) { setRefusal(t); setCapState("refused"); return; }
      if (t && t.success && t.thread) {
        setMessages(Array.isArray(t.thread.messages) ? t.thread.messages : []);
        const stored = Number(t.thread.turns) || 0;
        setTurns(stored);
        /* Once the thread has a turn, the RECORD owns the flag. Showing the toggle in
           any other position would be the panel asserting something about writes that
           the engine has already decided otherwise. F-970: and when the record does NOT
           carry the flag, the panel says so instead of inheriting the `false` default,
           which reads as a promise that the next turn writes for real. */
        if (stored > 0) {
          if (typeof t.thread.simulation === "boolean") { setSimulation(t.thread.simulation); setSimUnknown(false); }
          else setSimUnknown(true);
        } else {
          setSimUnknown(false);
        }
        /* A ticket that outlived the page. The thread record keeps only the ID, so the
           action and its preview are genuinely unknown here - the chip says so rather
           than inventing a name for a write the user is being asked to authorise. */
        if (t.thread.pendingTicketId) setTicket({ id: t.thread.pendingTicketId, action: null, argsPreview: null });
      }
    } catch (e) { /* a thread we could not read is an empty thread, not a broken panel */ }
  }, [issueKey, threadId]);

  useEffect(() => {
    if (!capEnabled) return undefined;
    let cancelled = false;
    loadThread(() => cancelled);
    return () => { cancelled = true; };
  }, [capEnabled, loadThread]);

  /* Connections drive the picker, and ONLY the picker. Read once the capability is on and
     never per conversation: the list does not depend on which thread is open.

     F-369 - AN EDITOR MUST SEE THE PICKER TOO. `listGitConnections` is requireAdmin, so
     every non-admin developer was refused here and their turn silently took the engine's
     DEFAULT connection: with two connections configured, that is somebody's turn landing
     in the wrong repository with nothing on screen to choose. The admin read is still
     tried FIRST because it is richer (status, credential state); a PERMISSION REFUSAL is a
     settled answer, not an outage, and falls through to the editor-floor rows getRuleLists
     returns - `gitconnections: [{id, kind, label, repos[]}]`, which carry no status and no
     secret state. Anything else (an outage) leaves the picker absent, which is the same
     place the panel was before. */
  useEffect(() => {
    if (!capEnabled) return undefined;
    let cancelled = false;
    (async () => {
      let rows = null;
      try {
        const c = await invoke("listGitConnections");
        if (cancelled || !mountedRef.current) return;
        if (c && c.success && Array.isArray(c.connections)) rows = c.connections;
        else if (!isPermissionRefusal(c)) return; // an outage is not a reason to ask again
      } catch (e) { return; /* same: no picker */ }
      if (!rows) {
        try {
          const l = await invoke("getRuleLists");
          if (cancelled || !mountedRef.current) return;
          /* F-954 - a getRuleLists that did NOT succeed is not an empty instance either.
             It used to collapse to `[]`, which was harmless while the empty list only
             meant "no picker"; it is not harmless now that an empty list is also a
             SENTENCE about this site. No answer, no claim. */
          if (!(l && l.success && l.lists)) return;
          const flat = Array.isArray(l.lists.gitconnections) ? l.lists.gitconnections : [];
          rows = flat.map((o) => ({ id: o.id || o.value, label: o.label || o.id || o.value, kind: o.kind || null, repos: Array.isArray(o.repos) ? o.repos : [] }))
            .filter((o) => !!o.id);
        } catch (e) { return; }
      }
      if (cancelled || !mountedRef.current) return;
      setConnections(rows);
      /* F-954 - THE LIST WAS ANSWERED. Every arm above returns early on an OUTAGE, so
         reaching this line is the one proof that an empty `connections` means "this site
         has none" and not "the question never got through". The plan-only sentence below
         is a claim about the INSTANCE and may only be made from an answer: the F-436 rule,
         on a second read. An unanswered list leaves the composer exactly where it was. */
      setConnsAnswered(true);
      /* F-954 - THE SOLE CONNECTION IS PRE-SELECTED (the F-902 rule, on this surface).
         With exactly one there is nothing to choose between, so the panel chooses it and
         the turn CARRIES the name it acts as rather than travelling as `undefined` and
         landing on whatever the engine falls back to. Convenience in the composer only:
         the runtime still has no fallback of its own, and a viewer who somehow already
         holds a pick keeps it. */
      if (rows.length === 1 && rows[0] && rows[0].id) setConnectionId((v) => v || String(rows[0].id));
    })();
    return () => { cancelled = true; };
  }, [capEnabled]);

  /* F-463 - the skills list, read once the capability is on and never per conversation
     (the catalogue does not depend on which thread is open). `getSkills` sits behind the
     viewer floor and can answer "not you"; that is a SETTLED answer and leaves the panel
     exactly where it was before the picker existed - a composer with no skills control -
     rather than a refusal banner for something nobody asked for. Disabled builtins come
     back in the index and must not be offered. */
  useEffect(() => {
    if (!capEnabled) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const res = await invoke("getSkills");
        if (cancelled || !mountedRef.current) return;
        if (res && res.success && Array.isArray(res.skills)) {
          setSkills(res.skills.filter((sk) => sk && sk.id && sk.enabled !== false));
        }
      } catch (e) { /* no picker, same as a refusal */ }
    })();
    return () => { cancelled = true; };
  }, [capEnabled]);

  /* The conversation's own selection, restored when the thread changes (including the
     first render, where it restores what this browser had on the default thread). */
  useEffect(() => { setSkillIds(readThreadSkills(issueKey, threadId)); }, [issueKey, threadId]);

  /* ------------------------------------------------------------------- polling */
  const applyResult = useCallback((result) => {
    const r = result || {};
    setRounds(Number(r.rounds) || 0);
    if (r.duplicate === true) {
      /* F-911 - THE QUEUE DELIVERED THIS TURN TWICE and the consumer answered the second
         delivery without running anything. The FIRST delivery is the one that spoke, so
         there is no outcome to show and nothing failed: clear the card, say nothing, and
         let the thread re-read below put the real answer on screen. Treating this as an
         error would put a red failure over a turn that succeeded. */
      setTicket(null);
      setOutcome(null);
    } else if (r.awaiting === "confirm" && r.ticket && r.ticket.id) {
      setTicket({ id: r.ticket.id, action: r.ticket.action || null, argsPreview: r.ticket.argsPreview || null });
      setOutcome(null);
    } else if (r.reason === "simulation-locked") {
      /* The engine refused the flip instead of performing it. Say the SAME sentence the
         locked toggle says, and put the toggle back to what the thread actually runs as,
         so the panel is not left claiming a mode the conversation does not have. */
      setTicket(null);
      setOutcome(null);
      // F-970: the engine just NAMED the mode, so the unknown state is answered too.
      if (typeof r.simulation === "boolean") { setSimulation(r.simulation); setSimUnknown(false); }
      setTurns((n) => (n > 0 ? n : 1));
      setError(simulationLockText(typeof r.simulation === "boolean" ? r.simulation : simulation));
    } else {
      setTicket(null);
      setOutcome({
        reply: r.reply || "",
        actions: Array.isArray(r.actions) ? r.actions : [],
        endedBy: r.endedBy || "",
        rounds: Number(r.rounds) || 0,
        ok: r.success !== false,
        /* F-857 - WHAT THE TURN COULD NOT WRITE ONTO THE ISSUE. The engine's own summary
           line goes into the running Coder log, which is one of the write groups it
           reports, so when the LOG write is the one that failed the sentence dies with the
           turn. The record carries it (`workspaceSummary`) precisely so a surface that does
           not depend on that comment can say it, and this panel is that surface. The
           wording is the ENGINE'S, never re-composed here. */
        workspaceSummary: r.workspaceSummary ? String(r.workspaceSummary) : "",
        workspaceFailures: Number(r.workspaceFailures) || 0,
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
          setTurns(Number(t.thread.turns) || 0);
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
    setMessages([]); setTicket(null); setOutcome(null); setError(""); setRounds(0); setLinks([]);
    setChangeOpen(false); setChangeText("");
    // A fresh conversation is where the dry-run choice lives again (F-371).
    setTurns(0);
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

  /* F-463 - picking a skill. The cap is enforced HERE as well as in the resolver, because
     a control that lets you pick a fifth and then reports a refusal is a control that lied:
     the fifth chip is simply not selectable, and the note under the list says why. The
     selection is written back onto this thread's row in the same store the switcher uses;
     a row for the default thread is minted on first pick, because a viewer who has never
     started a second conversation has no row yet. */
  const toggleSkill = (id) => {
    const next = skillIds.includes(id)
      ? skillIds.filter((v) => v !== id)
      : (skillIds.length >= MAX_TURN_SKILLS ? skillIds : [...skillIds, id]);
    if (next === skillIds) return;
    setSkillIds(next);
    const rows = knownThreads.some((r) => r.id === threadId)
      ? knownThreads.map((r) => (r.id === threadId ? { ...r, skillIds: next } : r))
      : [{ id: threadId, at: null, skillIds: next }, ...knownThreads];
    const capped = rows.slice(0, THREAD_MEMORY_CAP);
    setKnownThreads(capped);
    writeThreads(issueKey, capped);
  };

  /* The names of the ids a turn was refused for. `unknown-skill` is a refusal about a
     SKILL, so it is told with the skill's NAME: an id on screen is the resolver's
     vocabulary and tells the reader nothing about which pick to drop. A skill the panel
     no longer knows (deleted while the conversation was open) is named as deleted, which
     is the honest answer and the reason the refusal arrived. */
  const skillNameFor = (id) => (skills.find((sk) => sk.id === id) || {}).name || "a skill that no longer exists";
  const unknownSkillText = (res) => {
    const listed = [res && res.unknownSkillIds, res && res.unknown].find((v) => Array.isArray(v) && v.length);
    const ids = listed || skillIds.filter((id) => !skills.some((sk) => sk.id === id));
    if (!ids.length) return String((res && res.error) || "One of the chosen skills could not be used. Pick them again and send.");
    const names = ids.map(skillNameFor);
    return `${names.join(", ")} could not be used: ${names.length === 1 ? "it is" : "they are"} no longer in this instance's skills. Drop ${names.length === 1 ? "it" : "them"} and send again.`;
  };

  /* --------------------------------------------------------------------- send */
  const send = async () => {
    const text = draft.trim();
    if (!text || running) return;
    /* F-954 - the same predicate the Send button is disabled by, asserted where the turn
       is actually started: a keyboard or a stale render must not post a turn that has not
       said which connection it acts as. A site with ONE connection has it pre-selected and
       a site with NONE is a plan-only turn, so neither is stopped here. */
    if (connections.length > 1 && !connectionId) return;
    const token = ++genRef.current;
    if (pollRef.current) clearTimeout(pollRef.current);
    setRunning(true); setError(""); setOutcome(null); setRounds(0); setLinks([]);
    // Show the user's own words immediately. The thread re-read after the turn replaces
    // this optimistic row with the stored one, so nothing is duplicated.
    setMessages((prev) => [...prev, { role: "user", content: text, at: new Date().toISOString() }]);
    setDraft("");
    try {
      const res = await invoke("startCoderTurn", {
        issueKey, message: text, threadId,
        simulation: simulation === true,
        connectionId: connectionId || undefined,
        // F-463 - only ever sent when the reader picked something, and never more than the
        // resolver accepts. An empty array would be a key nothing reads.
        skillIds: skillIds.length ? skillIds.slice(0, MAX_TURN_SKILLS) : undefined,
      });
      if (!mountedRef.current || genRef.current !== token) return;
      if (isUpgradeRequired(res)) { setRefusal(res); setCapState("upgrade"); setRunning(false); return; }
      if (isPermissionRefusal(res)) { setRefusal(res); setCapState("refused"); setRunning(false); return; }
      if (res && res.agentDisabled) { setCap({ enabled: false, reason: res.reason || "unknown" }); setRunning(false); return; }
      /* The engine answers this from the QUEUE (applyResult below), but the resolver may
         grow a synchronous arm for it, and a raw reason code on screen is the defect. */
      /* F-463 - the skills half of the refusal family. `unknown-skill` is a settled answer
         about the PICK, not an outage, so it names the skills rather than printing a
         reason code, and the message the reader typed is kept in the box (the composer
         cleared it optimistically) so sending again is one click, not a retype. */
      if (res && res.reason === "unknown-skill") {
        setError(unknownSkillText(res));
        setMessages((prev) => prev.filter((m, i) => !(i === prev.length - 1 && m.role === "user" && m.content === text)));
        setDraft(text);
        setRunning(false);
        return;
      }
      if (res && res.reason === "simulation-locked") {
        // F-970: the engine just NAMED the mode, so the unknown state is answered too.
        if (typeof res.simulation === "boolean") { setSimulation(res.simulation); setSimUnknown(false); }
        setTurns((n) => (n > 0 ? n : 1));
        setError(simulationLockText(typeof res.simulation === "boolean" ? res.simulation : simulation));
        setRunning(false);
        return;
      }
      if (res && res.success && res.async && res.taskId) {
        // The turn is recorded by the resolver before it is queued, so the conversation's
        // mode is settled from here on: lock the toggle now rather than after the poll.
        setTurns((n) => (n > 0 ? n : 1));
        pollTask(res.taskId, token);
        return;
      }
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
      /* F-915 - WHAT THE CONFIRMED STEP PRODUCED. Only ever present on a CONFIRM that
         actually ran. The LENGTHS are already the engine's (`cleanLinks` in
         src/coder-workspace.js clamps kind, title and url and caps the list at
         STEP_MAX_LINKS) and re-clamping them here would be a second set of numbers that
         can disagree with the first. The one thing this side must still assert is the
         SCHEME: a URL becomes an href, and `javascript:` in an href is a different class
         of problem from a long string. */
      setLinks(Array.isArray(res.links)
        ? res.links
          .map((l) => ({ kind: String((l && l.kind) || "link"), url: safeHttpUrl(l && l.url), title: String((l && l.title) || "") }))
          .filter((l) => l.url)
        : []);
      if (res.error) { setError(String(res.error)); return; } // recorded, but not resumed
      if (res.async && res.taskId) { setRunning(true); setOutcome(null); pollTask(res.taskId, token); }
    } catch (e) {
      if (!mountedRef.current || genRef.current !== token) return;
      setDeciding("");
      setError(String((e && e.message) || e));
    }
  };

  /* F-954 - THE OFF CARD'S TWO DOORS, and who may be shown them.
     `admin` is the role the capability resolver ALREADY computed to gate itself (it has to
     read the caller's role to answer at all), so nothing extra is asked here. It is
     deliberately read as `=== true`: an older backend that does not carry the flag, or a
     read that answered without it, is treated as NOT an admin, and the reader gets the
     sentence rather than a button that lands them on a page Jira will refuse. */
  const isAdmin = !!(cap && cap.admin === true);
  const manageUrl = manageAppsUrl(siteUrl);
  /* The Settings TAB is not addressable by URL (AGENT_CAPABILITY_REASONS.link says the
     same thing where it refuses to put one there), so the destination is the app's own
     page plus a one-shot intent saying which tab to land on - the handoff config-view's
     `openAdmin` already makes. Module navigation first; the deep link built from this
     module's own localId ARI is the fallback, so no id is hardcoded. */
  const openSettings = async () => {
    try { await invoke("setUiIntent", { tab: "settings" }); } catch (e) { /* best-effort tab hint */ }
    try { await router.navigate({ target: "module", moduleKey: "cognirunner-global-page" }); return; } catch (e) { /* fall through */ }
    try {
      const c = await view.getContext();
      const appId = (String(c && c.localId).match(/\/extension\/([^/]+)\//) || [])[1];
      if (appId && c && c.environmentId) await router.open(`/jira/apps/${appId}/${c.environmentId}`);
    } catch (e) { /* both paths unavailable: do nothing rather than open a dead page */ }
  };

  /* ------------------------------------------------------------------ rendering */
  /* F-954/F-962 - THE REMEDY, RENDERED THE SAME WAY BY EVERY ARM THAT HAS ONE.
     F-954 gave the off card two real doors for an admin and a sentence naming who to ask
     for everybody else. The `upgrade` and `refused` arms were written before it and still
     named "Apps, Manage apps" in prose with nothing to press - the dead end this component
     exists to remove, and the worse half of it, because those two arms are where a reader
     lands when something is actually blocked.
       admin      -> the app's own Settings page, and a REAL href to Jira's Manage apps
                     opened through router.open (a sandboxed iframe cannot be trusted to
                     follow target="_blank" on its own; the href stays readable and
                     copyable either way).
       not admin  -> the sentence that names what to ask for and who to ask. This panel's
                     audience is a DEVELOPER on an issue: a breadcrumb to a page they
                     cannot open is an instruction they can only fail.
     `refused` answers with no capability row at all, so isAdmin is false there and the
     reader gets the sentence - which is the truth: a permission refusal IS the answer
     "you are not the one who can change this". */
  const remedyDoors = () => (isAdmin ? (
    <div className="agent-off-actions coder-cap-links">
      <button type="button" className="agent-off-btn" onClick={openSettings}>Open CogniRunner Settings</button>
      {manageUrl && (
        <a
          className="agent-off-link"
          href={manageUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => { e.preventDefault(); try { router.open(manageUrl); } catch (err) { /* the href is still the destination */ } }}
        >
          Upgrade in Manage apps
        </a>
      )}
    </div>
  ) : (
    <p className="coder-cap-remedy coder-cap-ask">{ASK_ADMIN_TEXT}</p>
  ));

  if (capState === "loading") return <div className="coder-cap coder-cap-loading"><span className="spin-ring" /> <span className="coder-cap-title">{CAPABILITY_CHECKING_TITLE}</span></div>;

  /* F-436 - the read never came back. Slate, not the OFF amber, and it says what it knows:
     nothing. "Coder off" here would be a claim about the instance made from a dropped
     request - the exact sentence the finding is about. */
  if (capState === "unknown") {
    return (
      <div className="coder-cap coder-cap-unknown" role="alert">
        <span className="coder-chip coder-chip-unknown">No answer</span>
        <p className="coder-cap-title">{CAPABILITY_UNKNOWN_TITLE}</p>
        <p className="coder-cap-remedy">{CAPABILITY_UNKNOWN_TEXT}</p>
        <div className="coder-cap-actions">
          <button type="button" className="coder-btn coder-btn-go" onClick={retryCapability}>{CAPABILITY_RETRY_LABEL}</button>
        </div>
      </div>
    );
  }

  if (capState === "upgrade") {
    return (
      <div className="coder-cap coder-cap-off">
        <span className="coder-chip coder-chip-off">Coder off</span>
        <p className="coder-cap-title">{UPGRADE_REQUIRED_HEADLINE}</p>
        <p className="coder-cap-remedy">{upgradeRequiredText(refusal)}</p>
        {remedyDoors()}
      </div>
    );
  }

  if (capState === "refused") {
    return (
      <div className="coder-cap coder-cap-off">
        <span className="coder-chip coder-chip-off">No access</span>
        <p className="coder-cap-remedy">{permissionRefusalText(refusal, "the Coder")}</p>
        {remedyDoors()}
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
        {copy.link === "settings" && remedyDoors()}
      </div>
    );
  }

  const connOptions = connections.map((c) => ({ value: c.id, label: c.label || c.id, meta: c.kind }));
  const showPicker = connOptions.length > 1;
  /* F-954 - the turn is OWED a connection: there are several and none has been named. The
     answer is a DISABLED Send with the sentence beside it, not a refusal after the send. */
  const connectionOwed = showPicker && !connectionId;
  // ...and the site that simply has none. That is a PLAN-ONLY turn, which is legitimate:
  // the git executors refuse their own actions and say why, so Send stays available.
  const noConnections = connsAnswered && connOptions.length === 0;
  const busy = running || !!deciding;
  /* F-954 - IS THIS CONSENT CARD THE DEGRADED ONE? Computed ONCE, from the same two facts
     the preview itself renders from, so the buttons and the sentence above them can never
     disagree about whether the step can be described. A ticket that outlived the page has
     neither a sentence preview nor a single argument row. */
  const previewSentence = ticket && typeof ticket.argsPreview === "string" ? ticket.argsPreview.trim() : "";
  const ticketRows = previewSentence ? [] : previewRows(ticket && ticket.argsPreview);
  const degradedTicket = !!ticket && !previewSentence && ticketRows.length === 0;
  // F-371: one turn is all it takes; after that the engine owns the flag.
  const simulationLocked = turns > 0;
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
            /* F-915 - A DECISION ROW IS WRITTEN FOR THE MODEL AND WAS BEING SHOWN TO THE
               PERSON WHO MADE IT: "DECISION: the user CONFIRMED open_pull_request and it
               was performed." It stays exactly that on the wire - the next turn's prompt
               depends on it - and is re-told here through the one parser in
               src/shared/agent-actions.js. A row that parser does not recognise renders
               UNCHANGED: degrading to the engine's sentence is honest, inventing is not. */
            const said = decision ? decisionRowSentence(m.content) : "";
            return (
              <div className={`coder-msg coder-msg-${role} anim-rise`} key={i}>
                <div className="coder-msg-who">{decision ? "Decision" : (ROLE_LABEL[m.role] || "Coder")}</div>
                {said
                  ? <p className="coder-msg-p">{said}</p>
                  : paragraphs(m.content).map((p, j) => <p className="coder-msg-p" key={j}>{p}</p>)}
                {/* 1.4 commit 14b - what BAKED knowledge this turn was shown. The receipt
                    rides on the USER message, because that is the turn the engine stamped
                    (summarizeKnowledge, src/agent-runner.js) - the reply is the model's
                    answer to it, not a second injection. Absent on every turn that carried
                    no guide, so the chip is not a permanent row of "0". */}
                <FieldGuideChip sections={m.knowledge && m.knowledge.fieldGuideSections} />
              </div>
            );
          })}
        </div>
      )}

      {ticket && (
        <div className="coder-consent">
          <div className="coder-consent-head">
            <span className="coder-chip coder-chip-consent">Needs your OK</span>
            {/* F-915 - THE SENTENCE, not the id. `describeAgentAction` reads the action's
                own label and only the argument keys its schema declares, so what stands
                here is "Open a pull request on acme/web from proj-42-retry-guard into main
                (draft: no)" and never `open_pull_request`. A ticket that outlived the page
                has no arguments, and then the sentence is just the action's name, which is
                the whole truth available - the row under it says so in as many words. */}
            <span className="coder-consent-action">
              {ticket.action ? describeAgentAction(ticket.action, ticket.argsPreview) : "A step needs your OK"}
            </span>
          </div>
          {(() => {
            // F-374: an OBJECT preview becomes rows; a string one (or none) stays a sentence.
            // F-954: both facts are decided above, so the buttons read the same verdict.
            if (previewSentence) return <p className="coder-consent-args">{ticket.argsPreview}</p>;
            const rows = ticketRows;
            if (!rows.length) return <p className="coder-consent-args">{noPreviewText(ticket.action)}</p>;
            return (
              <dl className="coder-consent-args coder-args">
                {rows.map((r) => (
                  <div className="coder-arg-row" key={r.key}>
                    {/* The KEY is the action's schema name, which is the engine's word for
                        it; `previewKeyLabel` turns it into the reader's without losing the
                        path, so two nested leaves still read as two different rows. */}
                    <dt className="coder-arg-k">{previewKeyLabel(r.key)}</dt>
                    <dd className="coder-arg-v">{r.text}</dd>
                  </div>
                ))}
              </dl>
            );
          })()}
          {/* F-954 - THE DEGRADED CARD LEADS WITH THE ANSWER ITS OWN SENTENCE GIVES.
              `noPreviewText` above tells the reader that nothing has run and to SKIP and
              ask again, because the step's arguments did not survive the reload and
              nobody can see what the write would do. The row under it then offered
              Confirm first, solid, in the affirmative hue. A card whose words say "skip"
              and whose layout says "confirm" is the mislead: the reader who trusts the
              buttons authorises a write that nothing on screen can describe.
              So on the degraded card the PRIMARY is Skip, and Confirm is DISABLED with a
              sentence saying what it needs - a control that says what happens, rather
              than one that simply will not move. The full card is untouched. */}
          {degradedTicket ? (
            <>
              <div className="coder-consent-btns">
                <button type="button" className={`coder-btn coder-btn-go coder-consent-skip${deciding === "skip" ? " is-busy busy-solid" : ""}`} onClick={() => decide("skip")} disabled={busy}>Skip</button>
                <button type="button" className="coder-btn coder-btn-alt coder-consent-change" onClick={() => setChangeOpen((v) => !v)} disabled={busy}>Change</button>
                <button type="button" className="coder-btn coder-btn-alt coder-consent-confirm" disabled title={CONFIRM_NEEDS_PREVIEW}>Confirm</button>
              </div>
              <p className="coder-consent-why">{CONFIRM_NEEDS_PREVIEW}</p>
            </>
          ) : (
            <div className="coder-consent-btns">
              <button type="button" className={`coder-btn coder-btn-go coder-consent-confirm${deciding === "confirm" ? " is-busy busy-solid" : ""}`} onClick={() => decide("confirm")} disabled={busy}>Confirm</button>
              <button type="button" className="coder-btn coder-btn-alt coder-consent-change" onClick={() => setChangeOpen((v) => !v)} disabled={busy}>Change</button>
              <button type="button" className={`coder-btn coder-btn-alt coder-consent-skip${deciding === "skip" ? " is-busy" : ""}`} onClick={() => decide("skip")} disabled={busy}>Skip</button>
            </div>
          )}
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
                  <span className="coder-action-name">{agentActionLabel(a.name)}</span>
                  <span className="coder-action-verdict">{a.ok === false ? "failed" : "ok"}</span>
                  {Number.isFinite(Number(a.ms)) && <span className="coder-action-ms">{Number(a.ms)} ms</span>}
                </li>
              ))}
            </ul>
          )}
          {(outcome.workspaceSummary || outcome.workspaceFailures > 0) && (
            <p className="coder-workspace-bad" role="status">
              {outcome.workspaceSummary
                || `Workspace: ${outcome.workspaceFailures} write${outcome.workspaceFailures === 1 ? "" : "s"} did not land on this issue.`}
            </p>
          )}
          {/* F-915 - WHAT THE TURN PRODUCED, as a link the reader can follow.
              `confirmCoderTicket` already builds these for the step comment it writes onto
              the issue (`stepLinksFromResult`, src/coder-engine.js) out of the provider's
              own `url`; before this they never left the backend, so the panel's only word
              for a finished pull request was whatever sentence the model chose to type.
              Rendered with rel="noreferrer" and a real title, because the URL is the
              PROVIDER's and the title is attacker-authorable text on somebody's repo. */}
          {links.length > 0 && (
            <ul className="coder-links">
              {links.map((l, i) => (
                <li className="coder-link-row" key={i}>
                  <span className={`coder-link-kind coder-link-${l.kind || "link"}`}>{LINK_KIND_LABEL[l.kind] || "Link"}</span>
                  <a className="coder-link" href={l.url} target="_blank" rel="noreferrer noopener">{l.title || l.url}</a>
                </li>
              ))}
            </ul>
          )}
          <p className="coder-outcome-foot">
            {outcome.rounds ? `${outcome.rounds} round${outcome.rounds === 1 ? "" : "s"}` : "Finished"}
            {/* "ended by final" was the engine's field printed raw, and `final` is not even
                one of the loop's endings - the mock had invented it and nothing could tell.
                One word per real ending, from the one table; an ending with no word is left
                unsaid rather than printed as a token. */}
            {agentEndingText(outcome.endedBy) ? ` · ${agentEndingText(outcome.endedBy)}` : ""}
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
        {/* F-463 - THE SKILLS THIS CONVERSATION RUNS WITH.
            A hand-rolled multi-select: one solid chip per skill, pressed state carried by
            aria-pressed, never a native <select> and never a checkbox. It is COLLAPSED to a
            summary until asked for, because the composer is an issue-panel and a catalogue
            of skills would push the text box off it; the summary names the chosen ones, so
            the picks are readable without opening anything. No picker at all when the
            instance has no skills to offer or the read was refused. */}
        {skills.length > 0 && (
          <div className="coder-skills">
            <button
              type="button"
              className="coder-skills-toggle"
              aria-expanded={skillsOpen}
              onClick={() => setSkillsOpen((v) => !v)}
              disabled={busy}
            >
              Skills
              <span className="coder-skills-count">{skillIds.length ? `${skillIds.length} of ${MAX_TURN_SKILLS}` : "none"}</span>
            </button>
            {skillIds.length > 0 && (
              <div className="coder-skills-chosen">
                {skillIds.map((id) => (
                  <span className="coder-skill-chip is-on" key={id}>{skillNameFor(id)}</span>
                ))}
              </div>
            )}
            {skillsOpen && (
              <div className="coder-skill-list" role="group" aria-label="Skills for this conversation">
                {skills.map((sk) => {
                  const on = skillIds.includes(sk.id);
                  return (
                    <button
                      key={sk.id}
                      type="button"
                      className={`coder-skill-chip${on ? " is-on" : ""}`}
                      aria-pressed={on}
                      onClick={() => toggleSkill(sk.id)}
                      disabled={busy || (!on && skillIds.length >= MAX_TURN_SKILLS)}
                    >
                      {sk.name}
                    </button>
                  );
                })}
              </div>
            )}
            {skillsOpen && (
              <p className="coder-skills-note">
                {skillIds.length >= MAX_TURN_SKILLS
                  ? `That is the most a turn can carry: ${MAX_TURN_SKILLS} skills. Unpick one to choose another.`
                  : `Up to ${MAX_TURN_SKILLS} skills ride every turn in this conversation. Start a new conversation to pick a different set.`}
              </p>
            )}
          </div>
        )}
        {/* F-970 - a VISIBLE caption. The control had only an aria-label, and the skills
            summary directly above it ends in a chip reading "none", which a sighted reader
            takes for this dropdown's label. `htmlFor` is not available (CustomSelect is not
            a native control and owns no id), so the two are tied by proximity and by the
            aria-label carrying the same words. */}
        {showPicker && (
          <div className="coder-picker">
            <p className="coder-field-label">{CONNECTION_LABEL}</p>
            <CustomSelect
              value={connectionId}
              onChange={setConnectionId}
              options={connOptions}
              placeholder="Choose a connection"
              ariaLabel={CONNECTION_LABEL}
              disabled={busy}
            />
          </div>
        )}
        {/* F-954 - the two sentences the composer owes about the connection. The OWED one
            is a refusal and wears the app's solid red with white text; the PLAN-ONLY one
            is a statement of fact and stays the neutral secondary text, because nothing
            is wrong and nothing is blocked. */}
        {connectionOwed && <p className="coder-conn-owed" role="alert">{CHOOSE_CONNECTION_TEXT}</p>}
        {noConnections && <p className="coder-conn-note">{NO_CONNECTION_TEXT}</p>}
        <div className="coder-composer-row">
          {/* F-970 - LOCKED RENDERS NO SWITCH. A disabled control is an affordance that
              lies: it invites the click it will refuse, and its only remaining job was to
              carry the run mode in a track colour the disabled styling then erased. When
              the thread owns the flag the panel states it in words; when the record never
              said, it says THAT and offers the read again rather than defaulting to one of
              the two answers. "Dry run" is the word the owner uses for simulation
              everywhere else in the app, so the unlocked control keeps it. */}
          {simulationLocked ? (
            simUnknown ? (
              <div className="coder-runmode-row">
                <span className="coder-runmode coder-runmode-unknown" role="status">{RUN_MODE_UNKNOWN_TEXT}</span>
                <button type="button" className="coder-btn" onClick={() => loadThread()} disabled={busy}>{RUN_MODE_RETRY_LABEL}</button>
              </div>
            ) : (
              <span className={`coder-runmode ${simulation ? "coder-runmode-dry" : "coder-runmode-live"}`} role="status">
                {simulation ? RUN_MODE_DRY_TEXT : RUN_MODE_LIVE_TEXT}
              </span>
            )
          ) : (
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
          )}
          <button type="button" className={`coder-btn coder-btn-go${running ? " is-busy busy-solid" : ""}`} onClick={send} disabled={busy || !draft.trim() || connectionOwed}>Send</button>
        </div>

        {/* F-371: the locked state says WHY in the same words the refusal would, and names
            the way out, which is the button F-368 added right above the transcript.
            F-970: except when the mode is UNKNOWN - this sentence names one of the two
            modes, and printing it off the `false` default is precisely the false claim the
            unknown chip exists to stop. That arm gets its own sentence. */}
        {simulationLocked && !simUnknown && <p className="coder-lock-note">{simulationLockText(simulation)}</p>}
        {simulationLocked && simUnknown && <p className="coder-lock-note">{RUN_MODE_UNKNOWN_NOTE}</p>}

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
