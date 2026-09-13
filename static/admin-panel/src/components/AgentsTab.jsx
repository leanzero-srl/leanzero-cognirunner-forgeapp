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
 * Law 6 throughout: solid fills, no rails, no tints, the app's own `confirmDialog` and
 * `CustomSelect`, and the agents hue (#b45309 light / #f59e0b dark with the app's dark ink).
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import VaWizard from "./VaWizard";
import VaEditor from "./VaEditor";
import { showToast } from "./toast";
import { confirmDialog } from "../confirmDialog";
import { createVaClient } from "../va-client";
import { isPermissionRefusal, permissionRefusalText } from "./refusal";
import { VA_LIMITS } from "../../../../src/shared/va-config.js";

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
};
const gateSentence = (g) => GATE_COPY[String(g && (g.gate || g.reason || g))] || String((g && (g.reason || g.gate)) || g);

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
  const shadow = status && status.shadow;
  const health = (status && status.health) || null;
  /* The banner is the engine's own counter and its own threshold (VA_LIMITS), never a
     number retyped here. Solid red, because a dead credential or an unreachable model is
     not a hint - the agent is doing nothing and somebody has to know. */
  const healthBad = !!(health && (health.ok === false || (health.failedTicks || 0) >= VA_LIMITS.healthBannerFailedTicks));

  return (
    <div className={`card va-agent ${paused ? "va-agent-paused" : ""}`}>
      <div className="va-agent-head">
        <button type="button" className="rule-expand-btn" onClick={onToggle} aria-expanded={open} title="Details">{open ? "▾" : "▸"}</button>
        <span className="va-agent-name">{(va.persona && va.persona.name) || agent.name || "Unnamed agent"}</span>
        {shadow ? <span className="va-badge va-badge-shadow">SHADOW</span> : <span className="va-badge va-badge-live">LIVE</span>}
        {paused && <span className="va-badge va-badge-paused">PAUSED</span>}
        <span className="va-agent-spacer" />
        {canEdit && <button type="button" className="btn-small" disabled={!!busy} onClick={() => act(paused ? "Resume" : "Pause", () => (paused ? client.resume(agent.id) : client.pause(agent.id)), paused ? null : `Pause ${(va.persona && va.persona.name) || "this agent"}? It stops staging and stops posting until you resume it. Anything already staged stays staged.`)}>{paused ? "Resume" : "Pause"}</button>}
        {canEdit && <button type="button" className="btn-small" disabled={!!busy} onClick={() => act("Run tick now", () => client.runTickNow(agent.id), "Run a tick now? It will sweep its intake and stage work, using this run's own budget.")}>▶ Run tick now</button>}
        {canEdit && <button type="button" className="btn-small btn-solid" disabled={!!busy} onClick={() => act("Post now", () => client.runPostNow(agent.id), "Post now? Staged replies that pass every check go out to real people immediately.")}>Post now</button>}
      </div>

      {healthBad && (
        <div className="va-health" role="alert">
          <span className="va-health-title">This agent is not working</span>
          <span className="va-health-text">{health.reason || `Its last ${health.failedTicks || VA_LIMITS.healthBannerFailedTicks} ticks failed.`}</span>
        </div>
      )}
      {statusError && <div className="alert alert-warning">{statusError} <button type="button" className="btn-small" onClick={refresh}>Retry</button></div>}

      <div className="va-stats">
        <Stat label="Last tick" value={when(status && status.lastTick, tz)} />
        <Stat label="Staged" value={status && status.staged != null ? String(status.staged) : "not known yet"} />
        <Stat label="Next tick" value={when(status && status.nextTick, tz)} />
        <Stat label="Next posting window" value={status && status.nextPostWindow ? (status.nextPostWindow.from ? `${fmt(status.nextPostWindow.from, tz)} to ${fmt(status.nextPostWindow.to, tz) || "…"}` : String(status.nextPostWindow)) : "not known yet"} />
        <Stat label="Mode" value={shadow ? `shadow, ${shadow.ticksLeft != null ? `${shadow.ticksLeft} tick${shadow.ticksLeft === 1 ? "" : "s"} left` : "staging only"}` : "live"} />
      </div>

      {open && (
        <div className="va-detail anim-rise">
          <div className="va-panes" role="tablist" aria-label="Agent detail">
            {PANES.map((p) => (
              <button type="button" key={p.id} role="tab" aria-selected={pane === p.id} className={`va-pane-btn ${pane === p.id ? "on" : ""}`} onClick={() => setPane(p.id)}>{p.label}</button>
            ))}
          </div>
          {pane === "drafts" && <DraftsPane client={client} agent={agent} shadow={!!shadow} canEdit={canEdit} onChanged={() => { refresh(); onChanged(); }} />}
          {pane === "effects" && <EffectsPane client={client} agent={agent} tz={tz} />}
          {pane === "receipts" && <ReceiptsPane receipts={arr(status && status.receipts)} tz={tz} />}
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
                <td>{e.action}{e.detail ? ` — ${e.detail}` : ""}</td>
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

function ReceiptsPane({ receipts, tz }) {
  if (!receipts.length) return <div className="empty-state">No tick has been recorded yet.</div>;
  return (
    <div className="va-receipts">
      {receipts.map((r, i) => (
        <div className={`va-receipt ${r.ok === false ? "va-receipt-bad" : ""}`} key={`${r.at}-${i}`}>
          <div className="va-receipt-head">
            <span className="va-receipt-kind">{r.phase === "post" ? "POST" : "PREPARE"}</span>
            <span className="va-receipt-at">{when(r.at, tz)}</span>
            <span className="va-receipt-counts">{r.swept != null ? `${r.swept} swept` : ""}{r.worked != null ? ` · ${r.worked} worked` : ""}{r.posted != null ? ` · ${r.posted} posted` : ""}</span>
          </div>
          {arr(r.skipped).map((s, j) => (
            <div className="va-receipt-skip" key={j}><span className="va-receipt-gate">{s.gate || s.reason || "gate"}</span><span>{gateSentence(s)}{s.itemKey ? ` (${s.itemKey})` : ""}</span></div>
          ))}
          {r.error && <div className="va-receipt-error">{r.error}</div>}
        </div>
      ))}
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
