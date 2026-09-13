/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from "react";
import { showToast } from "./toast";
import { confirmDialog } from "../confirmDialog";

/*
 * F-466 - TOKEN ROLES. `src/rules-api.js` has carried an optional `role` on a token row
 * since 1.5, but nothing could mint a narrower one: every token this panel created came
 * back role-less, and a role-less row reads as ADMIN server-side (deliberately - see the
 * comment on `tokenRole` there; narrowing it on upgrade would silently break live
 * integrations). So the editor/viewer floors on the REST API were unreachable from the
 * product. The picker below closes that: the mint payload carries `role`, and every row
 * shows the role it actually has.
 *
 * The copy is the CAPABILITY, not the name - an admin picking a token for a status
 * dashboard needs to read what it can do, not guess what "viewer" means here.
 */
const ROLES = [
  { id: "admin", label: "Admin", desc: "create and change rules, agents and settings" },
  { id: "editor", label: "Editor", desc: "create and change rules and agents, no settings" },
  { id: "viewer", label: "Viewer", desc: "read status, logs and agent receipts only" },
];
// A row minted before roles existed has no `role`; the backend reads that as admin, so we show admin.
const roleOf = (t) => (ROLES.some((r) => r.id === (t && t.role)) ? t.role : "admin");
const roleLabel = (id) => (ROLES.find((r) => r.id === id) || ROLES[0]).label;

// Settings → API access: the Rules REST API endpoint URL + bearer tokens (admin only).
// Tokens are shown ONCE at creation; only hashes are stored server-side.
export default function ApiAccessPanel({ invoke }) {
  const [tokens, setTokens] = useState([]);
  const [url, setUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [role, setRole] = useState("admin");
  const [creating, setCreating] = useState(false);
  const [fresh, setFresh] = useState(null); // { token, row }
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await invoke("getApiTokens");
      if (r.success) { setTokens(r.tokens || []); setUrl(r.url || null); setError(null); } else setError(r.error || "Could not load API tokens");
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, [invoke]);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    setCreating(true);
    try {
      const label = name.trim() || "API token";
      // `name` is this app's existing field; `label` rides along so the payload satisfies the
      // documented createApiToken({ label, role }) contract under either spelling.
      const r = await invoke("createApiToken", { name: label, label, role });
      // Echo the requested role if the backend row does not carry one back, so the
      // "shown once" banner never claims Admin for a token the admin asked to narrow.
      if (r.success) { setFresh({ token: r.token, row: { ...(r.row || {}), role: (r.row && r.row.role) || role } }); setName(""); showToast("Token created — copy it now, it will not be shown again"); await load(); } else showToast(r.error || "Could not create token", "error");
    } catch (e) { showToast(e.message, "error"); }
    setCreating(false);
  };
  const revoke = async (t) => {
    const yes = await confirmDialog(`Revoke "${t.name}" (${t.prefix}…)? Scripts using it will get 401 immediately.`, { title: "Revoke API token", confirmLabel: "Revoke" });
    if (!yes) return;
    setBusyId(t.id);
    try { const r = await invoke("revokeApiToken", { id: t.id }); if (r.success) { showToast("Token revoked"); await load(); } else showToast(r.error || "Could not revoke", "error"); } catch (e) { showToast(e.message, "error"); }
    setBusyId(null);
  };
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); showToast("Copied"); } catch { showToast("Copy failed — select and copy manually", "error"); } };
  const live = tokens.filter((t) => !t.revokedAt);
  const curl = url ? `curl -s -H "Authorization: Bearer <token>" "${url}?resource=listeners"` : "";

  return (
    <div className="card apx">
      <div className="apx-head">
        <div>
          <div className="apx-title">API access — Listeners &amp; Scheduled Jobs REST API</div>
          <div className="apx-sub">Push, list, run and test listeners and scheduled jobs from CI, migration scripts or the test harness. Bearer tokens; only hashes are stored.</div>
        </div>
        <span className="apx-badge">ADMIN</span>
      </div>
      {error && <div className="alert alert-warning">{error}</div>}
      <div className="apx-url">
        <span className="label">Endpoint</span>
        {url ? (<span className="apx-url-row"><code className="apx-code">{url}</code><button type="button" className="btn-small" onClick={() => copy(url)}>Copy</button></span>) : <span className="hint">{loading ? "Loading…" : "URL not available yet — deploy the app and reload."}</span>}
      </div>
      <div className="apx-roles-block">
        <span className="label">What this token may do</span>
        <div className="apx-roles" role="radiogroup" aria-label="Token role">
          {ROLES.map((r) => (
            <button key={r.id} type="button" role="radio" aria-checked={role === r.id} className={`apx-role-btn apx-role-${r.id} ${role === r.id ? "on" : ""}`} onClick={() => setRole(r.id)} disabled={creating}>
              <span className="apx-role-title">{r.label}</span>
              <span className="apx-role-desc">{r.desc}</span>
            </button>
          ))}
        </div>
        <div className="hint apx-roles-note">Tokens created before roles existed act as Admin.</div>
      </div>
      <div className="apx-new">
        <input type="text" className="apx-input" placeholder="Token name (e.g. CI pipeline)" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label="Token name" />
        <button type="button" className="btn-small btn-edit apx-create" onClick={create} disabled={creating}>{creating ? "Creating…" : "+ Create token"}</button>
      </div>
      {fresh && (
        <div className="apx-fresh">
          <div className="apx-fresh-title">New token "{fresh.row.name}" ({roleLabel(roleOf(fresh.row))}) — copy it now. It will not be shown again.</div>
          <div className="apx-url-row"><code className="apx-code apx-secret">{fresh.token}</code><button type="button" className="btn-small" onClick={() => copy(fresh.token)}>Copy</button><button type="button" className="btn-small" onClick={() => setFresh(null)}>Dismiss</button></div>
        </div>
      )}
      <table className="table apx-table">
        <thead><tr><th>Name</th><th>Role</th><th>Prefix</th><th>Created</th><th>Last used</th><th></th></tr></thead>
        <tbody>
          {live.length === 0 && <tr><td colSpan={6} className="empty-state">{loading ? "Loading…" : "No tokens yet."}</td></tr>}
          {live.map((t) => (
            <tr key={t.id}>
              <td>{t.name}</td>
              <td><span className={`apx-role-chip apx-role-${roleOf(t)}`}>{roleLabel(roleOf(t))}</span></td>
              <td><code>{t.prefix}…</code></td>
              <td className="timestamp">{t.createdAt ? new Date(t.createdAt).toLocaleString() : "—"}</td>
              <td className="timestamp">{t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : "never"}</td>
              <td className="row-actions"><button type="button" className="btn-small btn-danger" onClick={() => revoke(t)} disabled={busyId === t.id}>{busyId === t.id ? "…" : "Revoke"}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {url && (
        <details className="apx-examples">
          <summary>Examples</summary>
          <pre className="apx-pre">{`# list listeners
${curl}

# create a listener (script mode)
curl -s -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \\
  "${url}?resource=listeners" -d '{
    "name": "Label new bugs", "events": ["avi:jira:created:issue"],
    "filters": { "projectKeys": ["PROJ"], "issueTypes": ["Bug"] },
    "functions": [{ "name": "label", "code": "await api.addLabels(\\"triage\\");" }]
  }'

# create a scheduled job (AI agent, per-issue scope) and run it now
curl -s -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \\
  "${url}?resource=jobs" -d '{
    "name": "Nudge stale work", "schedule": { "cron": "0 9 * * 1-5", "timeZone": "Europe/Zurich" },
    "scope": { "jql": "project = PROJ AND status = \\"In Progress\\" AND updated <= -7d", "maxIssues": 25 },
    "mode": "agent", "agent": { "instructions": "Ask the assignee for an update in a short comment.", "allowedActions": ["get_issue", "add_comment"] }
  }'
curl -s -X POST -H "Authorization: Bearer <token>" "${url}?resource=jobs&id=<jobId>&action=run"

# other resources: events · actions · logs · samples · tasks · whoami`}</pre>
        </details>
      )}
    </div>
  );
}
