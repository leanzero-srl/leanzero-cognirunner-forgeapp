/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * THE AGENTS TAB (release 1.5, commit 5c).
 *
 * One tab, three jobs: create an agent (the chat wizard, or the classic form), see what each
 * one is doing, and stop it. Everything it reads goes through `va-client.js`, so this file
 * names no resolver.
 *
 * WHAT IT REFUSES TO GUESS. Every number on the status card is READ from `getVaStatus` -
 * last tick, staged count, next tick, next posting window, shadow, paused, health. None of
 * it is reconstructed here from receipts, and none of it is inferred from the record: the
 * health banner in particular is the engine's own counter (`va_health:{agent}`), because a
 * banner rebuilt by counting TTL'd receipt rows goes quietly green when the rows age out -
 * which is the moment it most needs to be red. A status that has not answered yet renders as
 * "not known yet", never as zero.
 *
 * QUIET FAILURE IS THE ENEMY. A tick that skipped every item still writes a receipt saying
 * which gate stopped it, and this tab renders those reasons BY GATE NAME. "Nothing happened"
 * with no cause is the shape that makes an admin distrust the whole feature, so a receipt
 * with `skipped[]` is rendered as sentences, not as a count.
 *
 * SHADOW MODE IS A DIFFERENT PRODUCT. While an agent is inside its shadow ticks the drafts
 * table is the main surface and carries Approve / Reject; once it is live the same table is
 * a read-only record of what is staged. The buttons are absent rather than disabled when
 * they cannot apply, because a disabled Approve reads like a permission problem.
 *
 * THE DELETED AGENTS ARE PART OF THIS TAB (F-608). A delete that catches a turn mid-flight
 * leaves real writes on real issues and no agent card to report them, so the list is
 * followed by a SITE-WIDE section reading `getVaRecentPurges`. It is absent when there is
 * nothing to say, and a storage fault makes it appear in red rather than disappear: an
 * unreadable store is not evidence that nothing happened.
 *
 * Law 6 throughout: solid fills, no rails, no tints, the app's own `confirmDialog` and
 * `CustomSelect`, and the agents hue (#b45309 light / #f59e0b dark with the app's dark ink).
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import VaWizard from "./VaWizard";
import VaEditor from "./VaEditor";
import { showToast } from "./toast";
import { confirmDialog } from "../confirmDialog";
import { createVaClient } from "../va-client";
import { isPermissionRefusal, isUpgradeRequired, permissionRefusalText } from "./refusal";
import { VA_LIMITS } from "../../../../src/shared/va-config.js";
import { agentCapabilityCopy } from "../../../../src/shared/edition.js";

const arr = (v) => (Array.isArray(v) ? v : []);
const fmt = (iso, tz) => { if (!iso) return null; try { return new Date(iso).toLocaleString(undefined, tz ? { timeZone: tz } : undefined); } catch { return String(iso); } };
/* A missing timestamp is "not known yet" and never "never" - the two are different claims
   and only the engine can tell them apart. */
const when = (iso, tz) => fmt(iso, tz) || "not known yet";

/* The eleven post gates, by the name the receipt carries. The engine writes the gate id;
   this table turns it into the sentence an admin can act on. An id with no copy renders as
   itself rather than disappearing, so a gate added to the engine is visible here the day it
   ships even before it is described. */
const GATE_COPY = {
  paused: "It is paused.",
  shadow: "It is still inside its shadow ticks, so the reply was staged and not sent.",
  killswitch: "The kill switch is on, so nothing ran.",
  freshness: "Somebody replied on the issue after the draft was written, so the draft was dropped and the item went back in the queue.",
  quiet: "Somebody else wrote on the issue inside the quiet window.",
  pileup: "It spoke last on that issue recently and nobody is waiting on it.",
  audience: "The reply would have gone to the wrong audience, so it was not sent.",
  caps: "It has used its message cap for this hour or day.",
  scope: "The target issue is outside the projects this agent may change.",
  writes: "This run has used its change budget.",
  voice: "The draft broke one of the writing rules.",
  claim: "Another delivery already had this item.",
  readback: "The posted comment could not be verified, so it was made internal and reported as an error.",
  attempts: "The item failed its attempts limit and was parked.",
  /* F-501 - the agent-capability gate (F-482). This one sentence is NOT a constant: the
     receipt carries a `reason` ("needs-coder-edition", "needs-frontier-model",
     "allowance-exhausted", ...) and the ONE home for those words is agentCapabilityCopy()
     in src/shared/edition.js - the same rows the Code tab and the Coder panel render. So a
     row may be a FUNCTION of the skip, and gateCopy() calls it rather than this file
     re-typing a sentence that would then drift from the other two surfaces. */
  capability: (s) => agentCapabilityCopy(s && s.reason),
  /* F-577 - THE PURGE THAT CAUGHT A TURN MID-FLIGHT, which is the one purge that is not
     harmless. The tombstone is read AFTER the loop has run, so the writes the turn had
     already made are on the issue and no ledger row survives to record them. This is the
     only skip an administrator must ACT on, so it is a copy row and renders solid red.
     The count is the engine's `changes`; when the engine does not name one the sentence
     says so rather than inventing a number. */
  "agent-purged-after-writes": (s) => ({
    title: "This agent was deleted while a turn was running",
    remedy: purgedWritesRemedy(s),
  }),
};
/* Kept out of the row above so the "how many" rule is one function, not an expression
   inside a map. A count is printed ONLY when the engine sent a positive whole number. */
function purgedWritesRemedy(s) {
  const raw = s && typeof s === "object" ? s.changes : null;
  const n = Math.trunc(Number(raw));
  if (Number.isFinite(n) && n > 0) {
    return `${n} earlier write${n === 1 ? "" : "s"} stayed on the issue, so check its history.`;
  }
  return "Earlier writes from that turn stayed on the issue, so check its history.";
}
/* ── F-614: A STATE THE AGENT IS IN, NOT A GATE ON A RECEIPT. ──────────────────
   `purge-settling` lived in GATE_COPY, keyed on a skip row, and that row can never exist.
   The engine arm that produces this wait is RECEIPT-FREE ON PURPOSE (src/virtual-admin.js:
   the receipt is a ledger write and the standing tombstone is what refuses ledger writes),
   and ReceiptsPane renders skips off RECORDED receipts only. So the sentence written for
   exactly this moment could not reach a screen, and a re-created agent showed the admin
   nothing at all while it waited.

   It is moved, not copied: a gate id that cannot arrive is dead copy wherever it sits. The
   carrier is now `status.settling` ({since, until, reason}) from src/va-admin.js, which
   READS the tombstone rather than writing under it, and this map is what turns that state
   into a sentence. Anything else keyed on a STATE rather than on a receipt belongs here
   too, so the distinction stays visible: GATE_COPY answers "why did this tick skip that
   item"; STATUS_COPY answers "what is this agent doing right now". */
const STATUS_COPY = {
  "purge-settling": "It is waiting for the deleted agent's last turns to finish before it starts.",
};
/* The one-line state shown on the card and in the Ticks pane header. `until` may be absent
   (an undated tombstone), and then the line says the state WITHOUT a time rather than
   inventing one or going silent. The clock is the engine's own window: src/va-admin.js
   derives `until` from VA_PURGE_SETTLE_MS, the same constant the clear refuses on. */
export function settlingLine(settling, tz) {
  if (!settling || typeof settling !== "object") return null;
  const at = settling.until ? fmt(settling.until, tz) : null;
  /* HH:MM, not the whole stamp: this is a wait of minutes and the date adds nothing. The
     locale string is cut at its time part only when one can be found; otherwise the full
     rendered stamp stands, which is still true. */
  const hhmm = at ? (at.match(/\d{1,2}:\d{2}/) || [null])[0] : null;
  const title = at
    ? `Deletion settling until ${hhmm || at}, ticks are skipped`
    : "Deletion is still settling, ticks are skipped";
  return { title, text: STATUS_COPY["purge-settling"] };
}

/* A gate resolves to EITHER a flat sentence (the eleven post gates) or a copy row
   { title, remedy, link } that renders as its own solid-red state. An id with no copy at
   all still renders as itself. */
const gateCopy = (g) => {
  const id = String((g && (g.gate || g.reason)) || g || "");
  const row = GATE_COPY[id];
  if (typeof row === "function") return { copy: row(g) };
  /* F-577 - A SKIP MAY CARRY A REASON THAT IS NOT A GATE. `agent-purged` arrives on a skip
     row with no gate at all (src/virtual-admin.js post arm), and before this it fell all
     the way to the echo below and printed the bare id at the administrator. So an id this
     table does not own is offered to the reason copy that DOES own it before anything is
     echoed. The echo stays for a genuinely unknown id, which is the point of it: a gate
     added to the engine is visible here the day it ships. */
  if (!row) {
    const viaReason = reasonCopy(g);
    if (viaReason && viaReason !== UNKNOWN_REASON && viaReason !== UNKNOWN_COMPACTION) return { sentence: viaReason };
  }
  return { sentence: row || String((g && (g.reason || g.gate)) || g) };
};
const gateSentence = (g) => gateCopy(g).sentence || "";

/* ── F-554: THE MODE OF AN AGENT IS THREE-STATE, NOT TWO. ──────────────────────
   `status` starts null and the card renders immediately, so for one round trip per agent
   the tab used to read `status && status.shadow` as falsy and paint the head badge LIVE
   and the Mode line "live". That is a POSITIVE claim about the one control standing
   between a virtual administrator and a real customer, made from an answer nobody has
   received. It was observed on staging against an agent that was genuinely in shadow with
   500 ticks left, while "Last tick" in the same block honestly read "not known yet".

   So the mode is derived the way F-436 derives the Coder capability read: the two states
   of the READ are kept apart from the two verdicts.

     loading — the status fetch has not answered. Neutral SLATE chip, Mode "checking".
     unknown — the read FAILED and there is no prior answer. Solid RED chip, Mode "not
               known", and the error block above the stats carries the Retry. Never LIVE:
               an unanswered question is not a "yes, it is posting to customers".
     shadow / live — a LOADED status. Only here may the tab make a claim, and `shadow`
               being null now means "the engine said it is live", not "nobody asked".

   ONE helper, every site: the head badge, the Mode stat, and the drafts pane's
   Approve / Reject column all call this, so the three cannot disagree about what is known.
   A read that fails AFTER a good answer keeps the last answer (the stats do the same) and
   the failure is reported by the error block - a card is not blanked for a dropped poll.

   Approve / Reject are ABSENT in both unknown states, which is the same direction the old
   code happened to take: they may only be offered once the engine has said "shadow". */
export const AGENT_MODE_LOADING = { id: "loading", badge: "LOADING", cls: "va-badge-loading", stat: "checking" };
export const AGENT_MODE_UNKNOWN = { id: "unknown", badge: "UNKNOWN", cls: "va-badge-unknown", stat: "not known" };
export function agentMode(status, statusError) {
  if (!status) return statusError ? AGENT_MODE_UNKNOWN : AGENT_MODE_LOADING;
  const shadow = status.shadow;
  if (shadow) {
    const left = shadow.ticksLeft;
    return { id: "shadow", badge: "SHADOW", cls: "va-badge-shadow", shadow, stat: `shadow, ${left != null ? `${left} tick${left === 1 ? "" : "s"} left` : "staging only"}` };
  }
  return { id: "live", badge: "LIVE", cls: "va-badge-live", shadow: null, stat: "live" };
}

/* ── F-511: the memory-compaction line on a tick receipt. ──────────────────────
   The engine records compaction in TWO places and the tab used to read neither, so a
   notebook that was over budget, or a summarisation being bought and wasted every five
   minutes, left no trace on the one surface an administrator reads (F-506/F-507):

     `receipt.compacted = {before, after, reason?, fellBack?}` - a turn actually RAN.
     a skip row `{itemKey: "(memory)", gate: "compaction", reason: "compaction:<why>"}`
     - it did not run, or it ran and did not converge.

   The reason string arrives PREFIXED (`compaction:did-not-converge`) because the engine
   namespaces it when it pushes the skip, so the prefix is stripped before the lookup
   rather than being typed into the keys - the keys are the engine's own reason ids.

   TONE IS READ OFF THE `gate` FIELD, never off the reason, for the same reason F-510
   rewrote `ok`: the field is the engine's statement that it REFUSED. A gated row, and a
   fallback, are solid red. The BACKOFF row carries no gate on purpose - those ticks are
   the engine deliberately not paying for a call it knows is dead, and painting six hours
   of them red would bury the banner the original failure already raised - so it renders
   as a solid slate state instead. No rail, no tint, either way. */
/* F-518 - THE MAP COVERS EVERY ID THE ENGINE PUSHES, and `agents-tab.test.mjs` reads
   `src/virtual-admin.js` to prove it still does. The map knew 3 of the ~8 reasons
   `runVaCompaction` can return, so the newest failure modes spoke to the admin in an
   engine id, and `compaction_failed:` carried a raw exception message (provider or KVS
   text, whatever threw) into admin copy.

   Two rules follow from that and neither is negotiable:
   - the keys are BASE ids only. Several reasons carry a `:detail` suffix the engine adds
     for the log (`pinned_dropped:2`, `not_claimed:storage_fault`, `compaction_failed:<80
     chars of an exception>`); the suffix is cut before the lookup and NEVER reaches the
     sentence, because none of it was written for a human to read.
   - the fallback for a genuinely unknown id says so in plain words and prints NOTHING
     from the engine. A new id added to the engine shows an honest blank rather than
     leaking whatever string was in it, and the source assertion in the test fails the
     run so it does not stay blank. */
const COMPACTION_COPY = {
  "summariser-failed": "The summariser did not answer, so the notes were cut instead of summarised and the memory is still over budget.",
  "did-not-converge": "A summarisation was paid for and the memory is still over its byte budget.",
  "compaction-backoff": "Compaction is paused for six hours after a failed compaction.",
  "compaction-backoff-write-failed": "The pause could not be recorded, so the next tick will try the summariser again.",
  "memory_read_failed": "The agent's notes could not be read this tick, so nothing was summarised and the notes are untouched.",
  "under_threshold": "The notes were under their size budget, so nothing needed summarising.",
  "not_claimed": "Another delivery of this tick was already summarising the notes, so this one left them alone.",
  "compaction_produced_nothing": "The summariser came back with nothing to store, so the notes were left exactly as they were.",
  "pinned_dropped": "The proposed summary had lost a pinned instruction, so it was thrown away and the previous notes still stand.",
  "compaction_failed": "Memory compaction stopped on an unexpected error and the previous notes are untouched.",
  /* F-564 - the purge tombstone (F-553, src/va-ledger.js). Every site that reads it is
     receipt-free on purpose, so this sentence is the answer for the one case where a row
     survives the delete: a neutral statement, not a failure, which is why it renders on
     the slate "paused" tone rather than the red gate one. F-577 split it in two: this one
     is the ENTRY check, where the turn had not begun and nothing can have been written. */
  "agent-purged": "This agent was deleted before the turn started, so nothing was written.",
  /* F-577 - THE SAME TOMBSTONE READ ONE ROUND LATER, where "nothing was written" is FALSE.
     The row above used to carry that promise for both paths: the entry checks, where it is
     true, and the write-seam check at the end of an item turn, where the loop has already
     put comments, transitions and pages into Jira and Confluence and only the LEDGER write
     was skipped. The engine now separates them, so the sentences separate too. No count
     here on purpose: this is the flat form the health banner reads, and the banner has no
     skip object to take a number from. The receipt's own row (GATE_COPY above) names it. */
  "agent-purged-after-writes": "This agent was deleted while a turn was running, and the writes that turn had already made stayed on the issue.",
};
const UNKNOWN_COMPACTION = "Memory compaction reported an unrecognised result.";
/* The BASE id: the engine's `compaction:` namespace prefix off the front, and any
   `:detail` the engine appended off the back. */
const compactionReason = (s) => String((s && (s.reason || s.gate)) || "").replace(/^compaction:/, "").split(":")[0];
/* A skip the engine namespaced `compaction:` is one of ours whether or not it also carries
   the gate; an id with no copy still renders a sentence rather than disappearing. */
const isCompactionSkip = (s) => !!s && (s.gate === "compaction" || /^compaction:/.test(String((s && (s.reason || s.gate)) || "")));
/* ── F-524: ONE reason-to-sentence helper, for every surface that shows an engine reason.
   The engine writes the same reason string into TWO places: the skip row on a receipt
   (`reason: "compaction:<id>[:detail]"`) and, durably, the health row the "This agent is
   not working" banner reads (`health.lastReason`, src/va-ledger.js). F-518 gave the
   receipt a copy map and left the banner printing the string raw — including the prepare
   catch arm's 300-character slice of whatever exception was thrown (provider or KVS text).

   So the mapping lives here, once, and BOTH callers go through it:
   - `compaction:` namespace off the front, any `:detail` off the back, look up the base id;
   - `capability:<id>` resolves through agentCapabilityCopy() in src/shared/edition.js —
     the one home for those words (F-501);
   - a bare post-gate id resolves through GATE_COPY;
   - anything else — an unknown id, an exception message, an empty string — returns the
     neutral sentence. NOTHING from the engine is ever echoed: an id is not copy and an
     exception message is not for an administrator. This does NOT depend on the engine
     storing base ids only; a `:detail`, a prefix or free text all land on a sentence.

   `compaction: true` says the caller already knows the row is a compaction row (the skip
   carries `gate: "compaction"`), so an unrecognised id there gets the compaction-specific
   unknown sentence rather than the generic one. */
const UNKNOWN_REASON = "Its ticks are failing for a reason this panel does not recognise. The tick receipts below carry the detail.";
/* F-535 - the ids that reach the HEALTH row and nowhere else. `recordTickHealth` is called
   from five places in src/virtual-admin.js: the paused arm and the post arm write no
   reason at all, the capability gate writes `capability:<id>`, the compaction gate writes
   `compaction:<id>` (or the bare backoff-write id), and the tick's TWO catch arms write
   `tick:prepare_failed:<exception>` / `tick:post_failed:<exception>`. Those last two were
   introduced by F-524 to keep the exception out of the admin's copy, and they landed with
   no sentence here, so the banner said only that the panel did not recognise the reason -
   for the one case where it knows exactly what happened.

   Keyed on the BASE id, `namespace:id`, which is what src/va-ledger.js `splitHealthReason`
   stores: the exception is filed as `lastDetail` and is never projected to this tab.
   `unknown` is that same helper's fallback for a reason that is prose rather than an id, so
   it resolves to the neutral sentence deliberately rather than by falling off the end. */
const HEALTH_COPY = {
  "tick:prepare_failed": "The last tick stopped on an unexpected error before any work was queued, so nothing was picked up on that run.",
  "tick:post_failed": "The last tick stopped on an unexpected error while it was posting, so some staged replies may not have been sent.",
  unknown: UNKNOWN_REASON,
};
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const reasonCopy = (reason, opts) => {
  const raw = String((reason && typeof reason === "object" ? reason.reason || reason.gate : reason) || "").trim();
  if (!raw) return "";
  const base = raw.replace(/^compaction:/, "").split(":")[0];
  if ((opts && opts.compaction) || /^compaction:/.test(raw) || has(COMPACTION_COPY, base)) {
    return COMPACTION_COPY[base] || UNKNOWN_COMPACTION;
  }
  /* The health ids are TWO segments, so they are looked up before the one-segment maps
     below: `tick` on its own is not a reason anything writes. */
  const segs = raw.split(":").map((x) => x.trim());
  const pair = segs.slice(0, 2).join(":");
  if (has(HEALTH_COPY, pair)) return HEALTH_COPY[pair];
  if (has(HEALTH_COPY, segs[0])) return HEALTH_COPY[segs[0]];
  if (/^capability:/.test(raw)) {
    const row = agentCapabilityCopy(raw.split(":")[1] || "unknown") || null;
    if (row && row.title) return row.remedy ? `${row.title}. ${row.remedy}` : row.title;
    return UNKNOWN_REASON;
  }
  const row = has(GATE_COPY, base) ? GATE_COPY[base] : null;
  return typeof row === "string" ? row : UNKNOWN_REASON;
};
/* ── F-608: THE DELETE THAT CAUGHT A TURN MID-FLIGHT, read site-wide. ──────────
   F-577 wrote the copy for this and F-595 proved the copy could never fire: the agent is
   GONE, so there is no card to hang it on and no receipt to carry it. `getVaRecentPurges`
   is the read door onto the tombstones that recorded what the dying turn had already
   written, and the section below is the only place in the product those writes are named.

   THE TWO NON-ANSWERS ARE DIFFERENT AND ARE RENDERED DIFFERENTLY, because the backend
   deliberately keeps them apart (src/va-admin.js):

     reason "scan_unavailable" / "scan_failed" - the STORE could not be read. The list on
       screen is not the answer, so it renders a solid red notice. It must never render as
       an empty state: "no agent wrote while it was being deleted" is the one sentence this
       panel must not say falsely, and a storage fault is not evidence for it.
     reason "no-permission" / "upgrade-required" - a REFUSAL, not a fault (this read is
       admin-floored, the agent list is not, so an editor sees the tab and not this). The
       backend's sentence names the remedy and its owner, so it is rendered AS GIVEN rather
       than re-typed here. F-621: this block used to say a refusal arrives with a NULL
       reason. It does not, and never did - `permissionDenied` stamps one - which is how a
       non-admin came to be shown a storage fault. The refusal is identified by
       `isPermissionRefusal` / `isUpgradeRequired`, never by the absence of a reason.

   The sentences for the two faults are copy, not the store's own words: `VA_ADMIN_REFUSALS`
   says "Stored history could not be read", which is true of six other reads and tells an
   admin nothing about what this panel is now unable to promise. An unrecognised reason
   lands on the neutral sentence and never echoes the id. */
const PURGE_FAULT_COPY = {
  scan_unavailable: "The record of deleted agents cannot be read on this runtime, so an agent may have written during a delete without appearing here.",
  scan_failed: "The record of deleted agents could not be read, so an agent may have written during a delete without appearing here.",
};
const UNKNOWN_PURGE_FAULT = "The record of deleted agents could not be read, so an agent may have written during a delete without appearing here.";
const purgeFaultCopy = (reason) => {
  const id = String(reason || "");
  return has(PURGE_FAULT_COPY, id) ? PURGE_FAULT_COPY[id] : UNKNOWN_PURGE_FAULT;
};
/* A count is printed only when the engine sent a positive whole number, the same rule
   `purgedWritesRemedy` above holds for the receipt row. */
const writeCountLabel = (n) => {
  const v = Math.trunc(Number(n));
  if (!Number.isFinite(v) || v <= 0) return "writes stayed on the issues";
  return `${v} write${v === 1 ? "" : "s"} stayed`;
};

const bytesOf = (n) => String(Math.max(0, Math.trunc(Number(n) || 0)));

/* Every compaction statement on one receipt, in the order an admin reads them. A fallback
   is named ONCE even though the engine writes it both as `compacted.fellBack` and as a
   gated skip carrying the same reason. */
function compactionRows(r) {
  const out = [];
  const c = r && r.compacted && typeof r.compacted === "object" ? r.compacted : null;
  const skips = arr(r && r.skipped).filter(isCompactionSkip);
  const gated = skips.some((s) => s.gate === "compaction");
  const fellBack = !!(c && c.fellBack === true);
  if (c && !fellBack && !gated) {
    out.push({ tone: "ok", title: `Memory compacted ${bytesOf(c.before)} to ${bytesOf(c.after)} bytes` });
  }
  if (fellBack) out.push({ tone: "bad", title: "Memory compaction failed", text: reasonCopy(compactionReason(c) || "summariser-failed", { compaction: true }) });
  for (const s of skips) {
    const reason = compactionReason(s);
    if (fellBack && reason === "summariser-failed") continue;
    const isGate = s.gate === "compaction";
    out.push({ tone: isGate ? "bad" : "muted", title: isGate ? "Memory compaction failed" : "Memory compaction paused", text: reasonCopy(reason, { compaction: true }) });
  }
  return out;
}

export default function AgentsTab({ invoke, isAdmin, userRole, roleUnknown = false }) {
  const canEdit = isAdmin || userRole === "editor" || userRole === "admin";
  const client = useRef(createVaClient(invoke)).current;

  const [view, setView] = useState("list"); // list | wizard | form
  const [formSeed, setFormSeed] = useState({ initial: null, refusals: [] });
  const [agents, setAgents] = useState([]);
  const [catalog, setCatalog] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [refused, setRefused] = useState(null);
  const [openId, setOpenId] = useState(null);
  const loadToken = useRef(0);

  const load = useCallback(async () => {
    const mine = ++loadToken.current;
    setLoading(true);
    const r = await client.listAgents();
    if (mine !== loadToken.current) return;
    setLoading(false);
    if (r.success) { setAgents(arr(r.agents)); setLoadError(null); setRefused(null); return; }
    // A REFUSAL names a remedy and its owner; an OUTAGE names a fault and offers a retry.
    // They are different sentences with different controls (refusal.js is the one test).
    if (isPermissionRefusal(r)) { setRefused(permissionRefusalText(r, "the virtual administrators")); setAgents([]); return; }
    setLoadError(r.error || "Could not load the agents.");
  }, [client]);

  useEffect(() => { load(); return () => { loadToken.current += 1; }; }, [load]);
  useEffect(() => { let live = true; client.catalog().then((r) => { if (live && r.success) setCatalog(r.catalog || {}); }); return () => { live = false; }; }, [client]);

  const afterSave = (job) => { setView("list"); setOpenId((job && job.id) || null); load(); };

  if (view === "wizard") {
    return (
      <VaWizard
        client={client}
        onCreated={afterSave}
        onFallback={(record, refusals) => { setFormSeed({ initial: record, refusals: arr(refusals) }); setView("form"); }}
        onCancel={() => setView("list")}
      />
    );
  }
  if (view === "form") {
    return <VaEditor client={client} catalog={catalog} initial={formSeed.initial} initialRefusals={formSeed.refusals} onSaved={afterSave} onCancel={() => { setFormSeed({ initial: null, refusals: [] }); setView("list"); }} />;
  }

  return (
    <div className="section">
      <div className="section-header">
        <span className="section-title">Agents <span className="lst-count">{agents.length}</span></span>
        <div className="section-actions">
          <button type="button" className="btn-small" onClick={load}>Refresh</button>
          {canEdit && <button type="button" className="btn-small" onClick={() => { setFormSeed({ initial: null, refusals: [] }); setView("form"); }}>Use the form</button>}
          {canEdit && <button type="button" className="btn-small btn-solid va-new" onClick={() => setView("wizard")}>+ New virtual administrator</button>}
        </div>
      </div>
      <p className="hint">A virtual administrator works a queue on a schedule: it reads, it stages a reply, and a later tick sends it after eleven checks. It starts in shadow mode, where it stages and posts nothing.</p>

      {refused && <div className="alert alert-warning va-refused">{refused}</div>}
      {loadError && <div className="alert alert-warning">{loadError} <button type="button" className="btn-small" onClick={load}>Retry</button></div>}

      {loading ? (
        <div className="card"><div className="empty-state">Loading agents…</div></div>
      ) : agents.length === 0 && !refused ? (
        <div className="card"><div className="empty-state lst-empty">
          <div className="lst-empty-title">No virtual administrator yet.</div>
          <div>Answer nine questions and it exists: who it is, how it sounds, where it looks for work, what it may read, what it may change, when it runs, what it is allowed to do, and the brakes.</div>
          {canEdit && <button type="button" className="btn-small btn-solid" style={{ marginTop: 12 }} onClick={() => setView("wizard")}>+ Create your first one</button>}
        </div></div>
      ) : (
        <div className="va-list stagger">
          {agents.map((agent) => (
            <AgentCard
              key={agent.id} agent={agent} client={client} canEdit={canEdit} roleUnknown={roleUnknown}
              open={openId === agent.id} onToggle={() => setOpenId(openId === agent.id ? null : agent.id)} onChanged={load}
            />
          ))}
        </div>
      )}

      <PurgesSection client={client} />
    </div>
  );
}

/* ── One agent: the status card, and everything it can be expanded into ───────── */

function AgentCard({ agent, client, canEdit, open, onToggle, onChanged }) {
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [pane, setPane] = useState("drafts");
  const token = useRef(0);
  const va = agent.va || {};
  const tz = (va.cadence && va.cadence.timeZone) || "UTC";

  const refresh = useCallback(async () => {
    const mine = ++token.current;
    const r = await client.status(agent.id);
    if (mine !== token.current) return;
    if (r.success) { setStatus(r); setStatusError(null); } else setStatusError(r.error || "The status could not be read.");
  }, [client, agent.id]);
  useEffect(() => { refresh(); return () => { token.current += 1; }; }, [refresh]);

  const act = async (name, fn, confirmText) => {
    if (confirmText) {
      const yes = await confirmDialog(confirmText, { title: name, confirmLabel: name });
      if (!yes) return;
    }
    setBusy(name);
    const r = await fn();
    setBusy(null);
    if (r.success) { showToast(`${name}: done`); refresh(); onChanged(); }
    else showToast(r.error || `${name} failed`, "error");
  };

  const paused = status ? status.paused === true : va.status && va.status.paused === true;
  /* F-554 - ONE helper for every mode claim on this card; see agentMode() above. */
  const mode = agentMode(status, statusError);
  const health = (status && status.health) || null;
  /* The banner is the engine's own counter and its own threshold (VA_LIMITS), never a
     number retyped here. Solid red, because a dead credential or an unreachable model is
     not a hint - the agent is doing nothing and somebody has to know. */
  const healthBad = !!(health && (health.ok === false || (health.failedTicks || 0) >= VA_LIMITS.healthBannerFailedTicks));
  /* F-614 - a STATE, read from the tombstone by the status projection. Null until the
     status lands and null whenever no tombstone stands, so the card is unchanged for
     every agent that was not just re-created. */
  const settling = settlingLine(status && status.settling, tz);

  return (
    <div className={`card va-agent ${paused ? "va-agent-paused" : ""}`}>
      <div className="va-agent-head">
        <button type="button" className="rule-expand-btn" onClick={onToggle} aria-expanded={open} title="Details">{open ? "▾" : "▸"}</button>
        <span className="va-agent-name">{(va.persona && va.persona.name) || agent.name || "Unnamed agent"}</span>
        <span className={`va-badge ${mode.cls}`} data-mode={mode.id}>{mode.badge}</span>
        {paused && <span className="va-badge va-badge-paused">PAUSED</span>}
        <span className="va-agent-spacer" />
        {canEdit && <button type="button" className="btn-small" disabled={!!busy} onClick={() => act(paused ? "Resume" : "Pause", () => (paused ? client.resume(agent.id) : client.pause(agent.id)), paused ? null : `Pause ${(va.persona && va.persona.name) || "this agent"}? It stops staging and stops posting until you resume it. Anything already staged stays staged.`)}>{paused ? "Resume" : "Pause"}</button>}
        {canEdit && <button type="button" className="btn-small" disabled={!!busy} onClick={() => act("Run tick now", () => client.runTickNow(agent.id), "Run a tick now? It will sweep its intake and stage work, using this run's own budget.")}>▶ Run tick now</button>}
        {canEdit && <button type="button" className="btn-small btn-solid" disabled={!!busy} onClick={() => act("Post now", () => client.runPostNow(agent.id), "Post now? Staged replies that pass every check go out to real people immediately.")}>Post now</button>}
      </div>

      {healthBad && (
        <div className="va-health" role="alert">
          <span className="va-health-title">This agent is not working</span>
          <span className="va-health-text">{reasonCopy(health.reason) || `Its last ${health.failedTicks || VA_LIMITS.healthBannerFailedTicks} ticks failed.`}</span>
        </div>
      )}
      {statusError && <div className="alert alert-warning">{statusError} <button type="button" className="btn-small" onClick={refresh}>Retry</button></div>}

      {/* F-614 - the re-created agent's settle window. Solid amber, because this is a WAIT
          and not a failure: the red health banner means somebody must act, this means
          nobody need do anything for a few minutes. It sits above the stats, where "Last
          tick" would otherwise be the only thing on screen and would read as silence. */}
      {settling && (
        <div className="va-settling" role="status">
          <span className="va-settling-title">{settling.title}</span>
          <span className="va-settling-text">{settling.text}</span>
        </div>
      )}

      <div className="va-stats">
        <Stat label="Last tick" value={when(status && status.lastTick, tz)} />
        <Stat label="Staged" value={status && status.staged != null ? String(status.staged) : "not known yet"} />
        <Stat label="Next tick" value={when(status && status.nextTick, tz)} />
        <Stat label="Next posting window" value={status && status.nextPostWindow ? (status.nextPostWindow.from ? `${fmt(status.nextPostWindow.from, tz)} to ${fmt(status.nextPostWindow.to, tz) || "…"}` : String(status.nextPostWindow)) : "not known yet"} />
        <Stat label="Mode" value={mode.stat} />
      </div>

      {open && (
        <div className="va-detail anim-rise">
          <div className="va-panes" role="tablist" aria-label="Agent detail">
            {PANES.map((p) => (
              <button type="button" key={p.id} role="tab" aria-selected={pane === p.id} className={`va-pane-btn ${pane === p.id ? "on" : ""}`} onClick={() => setPane(p.id)}>{p.label}</button>
            ))}
          </div>
          {pane === "drafts" && <DraftsPane client={client} agent={agent} shadow={mode.id === "shadow"} canEdit={canEdit} onChanged={() => { refresh(); onChanged(); }} />}
          {pane === "effects" && <EffectsPane client={client} agent={agent} tz={tz} />}
          {pane === "receipts" && <ReceiptsPane receipts={arr(status && status.receipts)} tz={tz} settling={settling} />}
          {pane === "memory" && <MemoryPane client={client} agent={agent} canEdit={canEdit} />}
          {pane === "caps" && <CapsPane va={va} />}
        </div>
      )}
    </div>
  );
}

const PANES = [
  { id: "drafts", label: "Staged replies" },
  { id: "effects", label: "What it did" },
  { id: "receipts", label: "Ticks" },
  { id: "memory", label: "Memory" },
  { id: "caps", label: "Brakes" },
];

function Stat({ label, value }) {
  return <span className="va-stat"><span className="va-stat-label">{label}</span><span className="va-stat-value">{value}</span></span>;
}

/* ── Staged drafts. In shadow mode they carry Approve / Reject. ───────────────── */

function DraftsPane({ client, agent, shadow, canEdit, onChanged }) {
  const [rows, setRows] = useState(null);
  const [busyKey, setBusyKey] = useState(null);
  const token = useRef(0);
  const load = useCallback(async () => {
    const mine = ++token.current;
    const r = await client.drafts(agent.id);
    if (mine !== token.current) return;
    setRows(r.success ? arr(r.drafts) : []);
  }, [client, agent.id]);
  useEffect(() => { load(); return () => { token.current += 1; }; }, [load]);

  const decide = async (row, approve) => {
    const label = approve ? "Approve" : "Reject";
    const yes = await confirmDialog(
      approve
        ? `Approve this reply for ${row.itemKey}? It goes out on the next tick, after the same checks every reply gets.`
        : `Reject this reply for ${row.itemKey}? The draft is dropped and the item goes back in the queue.`,
      { title: `${label} staged reply`, confirmLabel: label },
    );
    if (!yes) return;
    setBusyKey(row.itemKey);
    const r = approve ? await client.approveDraft(agent.id, row) : await client.rejectDraft(agent.id, row);
    setBusyKey(null);
    if (r.success) { showToast(`${label}d`); load(); onChanged(); } else showToast(r.error || `${label} failed`, "error");
  };

  if (rows === null) return <div className="empty-state">Loading staged replies…</div>;
  if (!rows.length) return <div className="empty-state">Nothing is staged right now.</div>;
  return (
    <table className="table va-table">
      <thead><tr><th>Issue</th><th>Audience</th><th>Draft</th><th>Attempts</th>{shadow && canEdit && <th></th>}</tr></thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.itemKey}-${row.stagedAt}`}>
            <td className="va-td-key">{row.itemKey}</td>
            <td><span className={`va-badge ${row.audience === "public" ? "va-badge-public" : "va-badge-internal"}`}>{row.audience === "public" ? "CUSTOMER" : "INTERNAL"}</span></td>
            <td className="va-td-body">{row.body}</td>
            <td>{row.attempts == null ? "—" : `${row.attempts}/${VA_LIMITS.attemptsCap}`}</td>
            {shadow && canEdit && (
              <td className="row-actions">
                <button type="button" className="btn-small btn-solid" disabled={busyKey === row.itemKey} onClick={() => decide(row, true)}>Approve</button>
                <button type="button" className="btn-small btn-danger" disabled={busyKey === row.itemKey} onClick={() => decide(row, false)}>Reject</button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ── The effects ledger and the item table (one read). ────────────────────────── */

function EffectsPane({ client, agent, tz }) {
  const [data, setData] = useState(null);
  const token = useRef(0);
  useEffect(() => {
    const mine = ++token.current;
    client.effects(agent.id).then((r) => { if (mine === token.current) setData(r.success ? r : { effects: [], items: [] }); });
    return () => { token.current += 1; };
  }, [client, agent.id]);
  if (!data) return <div className="empty-state">Loading…</div>;
  const effects = arr(data.effects);
  const items = arr(data.items);
  return (
    <>
      <span className="label">Every change it made</span>
      {effects.length === 0 ? <div className="empty-state">It has changed nothing yet.</div> : (
        <table className="table va-table">
          <thead><tr><th>When</th><th>Issue</th><th>What</th><th>Verified</th></tr></thead>
          <tbody>
            {effects.map((e, i) => (
              <tr key={`${e.at}-${i}`}>
                <td>{when(e.at, tz)}</td>
                <td className="va-td-key">{e.issueKey || "—"}</td>
                <td>{e.action}{e.detail ? `, ${e.detail}` : ""}</td>
                <td>{e.verified ? <span className="va-badge va-badge-ok">READ BACK</span> : <span className="va-badge va-badge-bad">NOT VERIFIED</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <span className="label va-label-gap">Items it is carrying</span>
      {items.length === 0 ? <div className="empty-state">No item yet.</div> : (
        <table className="table va-table">
          <thead><tr><th>Issue</th><th>State</th><th>Attempts</th><th>Last seen</th></tr></thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.key}>
                <td className="va-td-key">{it.key}</td>
                <td><span className={`va-badge va-state-${it.state}`}>{String(it.state || "").replace(/_/g, " ").toUpperCase()}</span></td>
                <td>{it.attempts == null ? "—" : `${it.attempts}/${VA_LIMITS.attemptsCap}`}</td>
                <td>{when(it.at, tz)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

/* ── Tick receipts: every skip, by the gate that made it. ─────────────────────── */

/* The rows a receipt has to explain.

   F-516 - A GATE ONLY EVER ARRIVES INSIDE `skipped[]`. This function used to carry a
   second branch that synthesised a row from a TOP-LEVEL `r.gate`/`r.reason`, "which is
   what the engine passes through untouched". It is not: `publicReceipt` (src/va-admin.js)
   builds its answer as an explicit object literal and neither key is in it, at any arm -
   the gate is projected onto the skip rows and nowhere else. So the branch could not fire,
   no fixture ever reached it, and it invited exactly the mistake F-515 is removing, which
   is code reading a `gate` off the receipt as if the receipt had a verdict of its own. The
   verdict is `ok`; the gate belongs to the skip.

   An ok:false tick with an empty `skipped[]` does NOT go silent without it: the FAILED
   badge and the `error` line are both rendered from the receipt itself in ReceiptsPane. */
function skipRows(r) {
  /* The compaction rows have their own renderer (F-511) and would otherwise print here as
     a raw `compaction:did-not-converge` id with no sentence. */
  return arr(r.skipped).filter((s) => !isCompactionSkip(s));
}

function ReceiptsPane({ receipts, tz, settling = null }) {
  /* F-614 - THE PANE HEADER, and the reason it is here as well as on the card. A settling
     agent records NO receipt, so this pane's honest answer is "nothing new" - and an admin
     who opened it because the agent looks dead would read that as the failure. The state
     is stated where the absence is, including on the empty pane, which is the case a
     freshly re-created agent actually hits. */
  const head = settling ? (
    <div className="va-settling va-settling-pane" role="status">
      <span className="va-settling-title">{settling.title}</span>
      <span className="va-settling-text">{settling.text}</span>
    </div>
  ) : null;
  if (!receipts.length) return <div className="va-receipts">{head}<div className="empty-state">No tick has been recorded yet.</div></div>;
  return (
    <div className="va-receipts">
      {head}
      {receipts.map((r, i) => (
        <div className={`va-receipt ${r.ok === false ? "va-receipt-bad" : ""}`} key={`${r.at}-${i}`}>
          <div className="va-receipt-head">
            <span className="va-receipt-kind">{r.phase === "post" ? "POST" : "PREPARE"}</span>
            <span className="va-receipt-at">{when(r.at, tz)}</span>
            <span className="va-receipt-counts">{r.swept != null ? `${r.swept} swept` : ""}{r.worked != null ? ` · ${r.worked} worked` : ""}{r.posted != null ? ` · ${r.posted} posted` : ""}</span>
            {r.ok === false && <span className="va-receipt-failed">FAILED</span>}
          </div>
          {compactionRows(r).map((c, j) => (
            <div className={`va-receipt-compact${c.tone === "bad" ? " va-receipt-compact-bad" : ""}${c.tone === "muted" ? " va-receipt-compact-muted" : ""}`} key={`c${j}`}>
              <span className="va-receipt-compact-title">{c.title}</span>
              {c.text && <span className="va-receipt-compact-text">{c.text}</span>}
            </div>
          ))}
          {skipRows(r).map((s, j) => {
            const c = gateCopy(s);
            if (!c.copy) {
              return <div className="va-receipt-skip" key={j}><span className="va-receipt-gate">{s.gate || s.reason || "gate"}</span><span>{c.sentence}{s.itemKey ? ` (${s.itemKey})` : ""}</span></div>;
            }
            return (
              <div className="va-receipt-cap" key={j}>
                <span className="va-receipt-cap-title">{c.copy.title}{s.itemKey ? ` (${s.itemKey})` : ""}</span>
                <span className="va-receipt-cap-text">{c.copy.remedy}</span>
                {c.copy.link === "settings" && (
                  <span className="va-receipt-cap-link">Open the Settings tab to change the provider, the edition or the agent model.</span>
                )}
              </div>
            );
          })}
          {r.error && <div className="va-receipt-error">{r.error}</div>}
        </div>
      ))}
    </div>
  );
}

/* ── F-608: the agents that wrote while they were being deleted (site-wide). ─── */

/* It is ABSENT, not empty, when there is nothing to say. Every other pane on this tab
   belongs to an agent and is reached deliberately; this one sits under the list and would
   otherwise be a permanent "nothing happened" box on a healthy site - the exact shape that
   trains an admin to stop reading it. An empty answer from this resolver is trustworthy
   (only tombstones with landed writes are returned), so silence is the honest rendering
   and the two failures above are the only reasons it appears with no rows. */
function PurgesSection({ client }) {
  const [answer, setAnswer] = useState(null);
  const [fault, setFault] = useState(null);
  const [openKey, setOpenKey] = useState(null);
  const token = useRef(0);
  useEffect(() => {
    const mine = ++token.current;
    client.recentPurges().then((r) => {
      if (mine !== token.current) return;
      if (r && r.success) { setAnswer({ purges: arr(r.purges), truncated: r.truncated === true }); setFault(null); return; }
      setAnswer({ purges: [], truncated: false });
      /* F-621 - REFUSAL FIRST, and by the SAME PREDICATE the agent list uses at the top of
         this file. The comment that stood here said "a null reason is the permission
         refusal", and the test below it (`r.reason ? fault : refusal`) was built on that
         belief. It was never true: `permissionDenied` in src/index.js always stamps
         `reason: "no-permission"`, so `getVaRecentPurges`'s `noPerm(...)` carried a named
         reason and landed in the FAULT arm - a non-admin was told the store is broken, in
         solid red, with the backend's own remedy sentence dropped on the floor. An edition
         denial (`reason: "upgrade-required"`) took the same wrong arm.

         So this no longer re-states the discrimination in its own words. `isPermissionRefusal`
         / `isUpgradeRequired` in refusal.js are the ONE test for "the backend refused this
         reader" and they are asked FIRST; only what is left over is a store fault. That
         ordering matters: a fault is the fallback, so a reason nobody has taught this panel
         about still raises the incomplete-list notice rather than being silently swallowed as
         a refusal with no sentence - "no agent wrote while it was being deleted" stays the
         one thing this panel will not say falsely. */
      setFault(isPermissionRefusal(r) || isUpgradeRequired(r)
        ? { kind: "refusal", text: (r && r.error) || "" }
        : { kind: "fault", text: purgeFaultCopy(r && r.reason) });
    });
    return () => { token.current += 1; };
  }, [client]);

  if (!answer) return null;
  const rows = arr(answer.purges);
  if (!rows.length && !(fault && fault.text)) return null;
  return (
    <div className="card va-purges">
      <span className="label">Recently deleted agents that wrote during deletion</span>
      <p className="hint">Deleting an agent stops it, but a turn already running can have put a comment or a transition on an issue before it read the delete. Those writes stay. They are listed here for three days so somebody can undo them.</p>
      {fault && fault.kind === "fault" && fault.text && (
        <div className="va-purge-fault" role="alert">
          <span className="va-purge-fault-title">This list is not the whole answer</span>
          <span className="va-purge-fault-text">{fault.text}</span>
        </div>
      )}
      {fault && fault.kind === "refusal" && fault.text && (
        <div className="alert alert-warning va-refused">{fault.text}</div>
      )}
      {rows.map((p, i) => {
        const key = `${p.agent || "agent"}-${p.purgedAt || ""}-${i}`;
        const open = openKey === key;
        const turns = arr(p.turns);
        return (
          <div className="va-purge" key={key}>
            <button type="button" className="va-purge-head" aria-expanded={open} onClick={() => setOpenKey(open ? null : key)}>
              <span className="va-purge-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
              <span className="va-purge-name">{p.agent || "An agent with no name on its record"}</span>
              <span className="va-purge-at">deleted {when(p.purgedAt)}</span>
              <span className="va-purge-count">{writeCountLabel(p.writeCount)}</span>
            </button>
            {open && (
              <div className="va-purge-turns anim-rise">
                {turns.length === 0 ? (
                  <div className="va-purge-turn"><span className="va-purge-key">The turns behind this count were not recorded.</span></div>
                ) : turns.map((t, j) => (
                  <div className="va-purge-turn" key={j}>
                    <span className="va-purge-key">{t.issueKey || "no issue named"}</span>
                    <span className="va-purge-when">{when(t.at)}</span>
                    <span className="va-purge-writes">
                      {arr(t.writes).map((w, k) => <span className="va-purge-write" key={k}>{w}</span>)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {answer.truncated === true && rows.length > 0 && (
        <p className="hint va-purge-more">Older deletions are not shown. This list is the most recent ones.</p>
      )}
    </div>
  );
}

/* ── The agent's memory: free text under a byte cap, plus pinned constraints. ─── */

function MemoryPane({ client, agent, canEdit }) {
  const [text, setText] = useState(null);
  const [constraints, setConstraints] = useState([]);
  const [cap, setCap] = useState(VA_LIMITS.memoryCapBytes);
  const [saving, setSaving] = useState(false);
  const token = useRef(0);
  useEffect(() => {
    const mine = ++token.current;
    client.getMemory(agent.id).then((r) => {
      if (mine !== token.current) return;
      setText(r.success ? (r.memory || "") : "");
      setConstraints(arr(r.constraints));
      if (r.capBytes) setCap(r.capBytes);
    });
    return () => { token.current += 1; };
  }, [client, agent.id]);

  if (text === null) return <div className="empty-state">Loading memory…</div>;
  // The counter is BYTES, because the cap is bytes: a character count would promise room a
  // multi-byte character does not have.
  const bytes = new TextEncoder().encode(text).length;
  const over = bytes > cap;
  const save = async () => {
    setSaving(true);
    const r = await client.saveMemory(agent.id, text, constraints);
    setSaving(false);
    if (r.success) showToast("Memory saved"); else showToast(r.error || "The memory could not be saved", "error");
  };
  return (
    <>
      {constraints.length > 0 && (
        <div className="va-constraints">
          <span className="label">Pinned constraints</span>
          <p className="hint">These are never compacted away and the agent is told them on every turn.</p>
          {constraints.map((c, i) => <div className="va-constraint" key={i}>{typeof c === "string" ? c : c.text}</div>)}
        </div>
      )}
      <span className="label va-label-gap">What it has learned</span>
      <textarea className="va-memory" rows={10} value={text} disabled={!canEdit} onChange={(e) => setText(e.target.value)} aria-label="Agent memory" />
      <div className="va-memory-foot">
        <span className={`va-memory-count ${over ? "va-memory-over" : ""}`}>{bytes} / {cap} bytes</span>
        {canEdit && <button type="button" className="btn-small btn-solid" disabled={saving || over} onClick={save}>{saving ? "Saving…" : "Save memory"}</button>}
      </div>
      {over && <div className="va-health" role="alert"><span className="va-health-title">Too long to store</span><span className="va-health-text">Take {bytes - cap} bytes out and it will save.</span></div>}
    </>
  );
}

/* ── The brakes, as the engine holds them. ────────────────────────────────────── */

function CapsPane({ va }) {
  const g = va.guardrails || {};
  const rows = [
    ["Messages per hour", g.capsPerHour], ["Messages per day", g.capsPerDay], ["Owed replies per hour", g.owedPerHour],
    ["Items per tick", g.maxItemsPerTick], ["Changes per run", g.maxWritesPerRun], ["Shadow ticks", g.shadowTicks],
    ["Minimum post gap (minutes)", g.minPostGapMinutes], ["Anti pile-up (days)", g.antiPileUpDays],
    ["Other writer quiet (minutes)", g.otherWriterQuietMinutes], ["Approval inbox", g.approvalProjectKey || "the issue itself"],
    ["Attempts before an item parks", VA_LIMITS.attemptsCap],
  ];
  return (
    <table className="table va-table">
      <thead><tr><th>Brake</th><th>Set to</th></tr></thead>
      <tbody>{rows.map(([k, v]) => <tr key={k}><td>{k}</td><td className="va-td-num">{v == null ? "—" : String(v)}</td></tr>)}</tbody>
    </table>
  );
}
