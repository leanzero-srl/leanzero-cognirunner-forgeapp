/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from "react";
import { showToast } from "./toast";
import { confirmDialog } from "../confirmDialog";

// Settings → API access: the Rules REST API endpoint URL + bearer tokens (admin only).
// Tokens are shown ONCE at creation; only hashes are stored server-side.
export default function ApiAccessPanel({ invoke }) {
  const [tokens, setTokens] = useState([]);
  const [url, setUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
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
      const r = await invoke("createApiToken", { name: name.trim() || "API token" });
      if (r.success) { setFresh({ token: r.token, row: r.row }); setName(""); showToast("Token created — copy it now, it will not be shown again"); await load(); } else showToast(r.error || "Could not create token", "error");
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
      <div className="apx-new">
        <input type="text" className="apx-input" placeholder="Token name (e.g. CI pipeline)" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label="Token name" />
        <button type="button" className="btn-small btn-edit apx-create" onClick={create} disabled={creating}>{creating ? "Creating…" : "+ Create token"}</button>
      </div>
      {fresh && (
        <div className="apx-fresh">
          <div className="apx-fresh-title">New token "{fresh.row.name}" — copy it now. It will not be shown again.</div>
          <div className="apx-url-row"><code className="apx-code apx-secret">{fresh.token}</code><button type="button" className="btn-small" onClick={() => copy(fresh.token)}>Copy</button><button type="button" className="btn-small" onClick={() => setFresh(null)}>Dismiss</button></div>
        </div>
      )}
      <table className="table apx-table">
        <thead><tr><th>Name</th><th>Prefix</th><th>Created</th><th>Last used</th><th></th></tr></thead>
        <tbody>
          {live.length === 0 && <tr><td colSpan={5} className="empty-state">{loading ? "Loading…" : "No tokens yet."}</td></tr>}
          {live.map((t) => (
            <tr key={t.id}>
              <td>{t.name}</td>
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
    "filters": { "projectKeys": ["LZPT"], "issueTypes": ["Bug"] },
    "functions": [{ "name": "label", "code": "await api.addLabels(\\"triage\\");" }]
  }'

# create a scheduled job (AI agent, per-issue scope) and run it now
curl -s -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \\
  "${url}?resource=jobs" -d '{
    "name": "Nudge stale work", "schedule": { "cron": "0 9 * * 1-5", "timeZone": "Europe/Zurich" },
    "scope": { "jql": "project = LZPT AND status = \\"In Progress\\" AND updated <= -7d", "maxIssues": 25 },
    "mode": "agent", "agent": { "instructions": "Ask the assignee for an update in a short comment.", "allowedActions": ["get_issue", "add_comment"] }
  }'
curl -s -X POST -H "Authorization: Bearer <token>" "${url}?resource=jobs&id=<jobId>&action=run"

# other resources: events · actions · logs · samples · tasks · whoami`}</pre>
        </details>
      )}
    </div>
  );
}
