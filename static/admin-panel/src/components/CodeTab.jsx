/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * THE CODE TAB (1.4 commit 6) - Coder status, Git connections, Forge deploy identity.
 *
 * WHAT IT MAY NOT DO, and why each rule is here:
 *
 *  1. It never DERIVES the Coder verdict. `getAgentCapability` answers it from the one
 *     predicate (agentCapability, src/shared/edition.js) fed by the one fact-reader that
 *     the save-time and run-time action gates also use. A tab that inferred "Coder" from
 *     the edition would be wrong for three of the five reasons and would be the copy
 *     nobody updates.
 *
 *  2. It FAILS TO THE RESTRICTIVE SIDE. A capability read that errors renders the OFF
 *     card with "could not check", never an enabled control whose every write the
 *     backend refuses (F-233).
 *
 *  3. It tells a REFUSAL apart from an OUTAGE, through `isPermissionRefusal` /
 *     `isUpgradeRequired` - never a sentence regex (F-242/F-255). All eight resolvers
 *     behind this tab are `requireAdmin`, so an editor opening it gets the plain
 *     access-note with no Retry: a retry re-asks a settled question.
 *
 *  4. NO TOKEN IS EVER ECHOED. `publicConnection` has no token field at all, so the
 *     form's token input is write-only by construction: it starts empty, it is cleared
 *     after every write, and a stored credential is shown as "SET", a fact, never a
 *     value. Same for the Forge identity: `getForgeIdentityStatus` returns booleans and
 *     an email.
 *
 *  5. Pipeline setup is NOT here. It is commit 7 and it is an admin resolver over
 *     src/shared/git-scaffolds.js; a placeholder that looked like a control would invite
 *     a click that cannot work.
 */

import React, { useCallback, useEffect, useState } from "react";
import CustomSelect from "./CustomSelect";
import { showToast } from "./toast";
import { confirmDialog } from "../confirmDialog";
import {
  isPermissionRefusal, permissionRefusalText,
  isUpgradeRequired, upgradeRequiredText, UPGRADE_REQUIRED_HEADLINE,
} from "./refusal";
import { agentCapabilityCopy } from "../../../../src/shared/edition.js";
import { GIT_PROVIDER_KINDS, gitProviderKindMeta, parseRepoList, formatRepoList } from "../../../../src/shared/git-ids.js";

const KIND_OPTIONS = GIT_PROVIDER_KINDS.map((k) => ({ value: k, label: gitProviderKindMeta(k).label }));

/** The one sentence an admin must agree to before a deploy credential is stored.
 *  The BACKEND is the gate (saveForgeIdentity refuses without `consent: true`); this is
 *  the words for the box that produces the flag. It exports no sentence of its own, so
 *  the wording lives here, once, next to the only control that sends the flag. */
const IDENTITY_CONSENT = "I am handing CogniRunner an Atlassian API token that will deploy Forge apps as me, from pipelines in my repositories, without asking again.";

const KindChip = ({ kind }) => (
  <span className={`code-kind code-kind-${gitProviderKindMeta(kind).id}`}>{gitProviderKindMeta(kind).label}</span>
);

export default function CodeTab({ invoke }) {
  const [capability, setCapability] = useState(null);
  const [connections, setConnections] = useState([]);
  const [identity, setIdentity] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  /* Two refusal arms, never one slot holding both (F-255): a role refusal sends the
     reader to a CogniRunner admin, an edition denial sends the SITE to an upgrade, and
     merging them would route a billing answer to the Permissions tab. */
  const [accessRefusal, setAccessRefusal] = useState(null);
  const [upgradeRefusal, setUpgradeRefusal] = useState(null);

  // add / edit form
  const [showAdd, setShowAdd] = useState(false);
  const [kind, setKind] = useState("github");
  const [label, setLabel] = useState("");
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [repos, setRepos] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const [testingId, setTestingId] = useState(null);
  const [whoami, setWhoami] = useState({});   // id -> { whoami, capabilities } or { error }
  const [deletingId, setDeletingId] = useState(null);

  // rotation
  const [rotateId, setRotateId] = useState(null);
  const [rotateToken, setRotateToken] = useState("");
  const [rotateEmail, setRotateEmail] = useState("");
  const [rotating, setRotating] = useState(false);

  // forge identity
  const [showIdentity, setShowIdentity] = useState(false);
  const [identityEmail, setIdentityEmail] = useState("");
  const [identityToken, setIdentityToken] = useState("");
  const [identityConsent, setIdentityConsent] = useState(false);
  const [identitySaving, setIdentitySaving] = useState(false);
  const [identityError, setIdentityError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cap, conns, ident] = await Promise.all([
        invoke("getAgentCapability").catch(() => null),
        invoke("listGitConnections"),
        invoke("getForgeIdentityStatus").catch(() => null),
      ]);
      /* The capability read is the FIRST thing to fail to the restrictive side: a null
         answer, a thrown call, or a `success:false` all become "unknown", which the copy
         map renders as "could not be checked" with the controls off. */
      setCapability(cap && cap.success ? cap : { enabled: false, reason: "unknown" });
      if (conns && conns.success) {
        setConnections(conns.connections || []);
        setAccessRefusal(null); setUpgradeRefusal(null); setLoadError(false);
      } else if (isPermissionRefusal(conns)) {
        setAccessRefusal(conns); setUpgradeRefusal(null); setLoadError(false);
      } else if (isUpgradeRequired(conns)) {
        setUpgradeRefusal(conns); setAccessRefusal(null); setLoadError(false);
      } else {
        setLoadError(true);
      }
      setIdentity(ident && ident.success ? ident.status : null);
    } catch (e) {
      // A THROW is transport, never a refusal - the resolver answers a refusal with a
      // RESOLVED body. This arm must not set either refusal state.
      setLoadError(true);
      setCapability({ enabled: false, reason: "unknown" });
    }
    setLoading(false);
  }, [invoke]);

  useEffect(() => { load(); }, [load]);

  const capCopy = agentCapabilityCopy(capability ? capability.reason : "unknown");
  const capOn = !!(capability && capability.enabled);

  const resetForm = () => {
    setKind("github"); setLabel(""); setToken(""); setEmail(""); setRepos("");
    setFormError(null);
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true); setFormError(null);
    try {
      const r = await invoke("saveGitConnection", {
        kind, label: label.trim(), token, email: email.trim() || undefined,
        repos: parseRepoList(repos),
      });
      if (r && r.success) {
        // The token leaves state the moment the write returns. Nothing reads it back.
        setShowAdd(false); resetForm();
        showToast("Connection saved");
        await load();
      } else {
        setFormError((r && r.error) || "Could not save this connection.");
      }
    } catch (e) {
      setFormError("Could not reach the app to save this connection.");
    }
    setSaving(false);
  };

  const handleTest = async (id) => {
    setTestingId(id);
    try {
      const r = await invoke("testGitConnection", { id });
      /* The result is rendered from the fields the resolver actually returns
         (whoami: kind/login/name/scopes, capabilities: three tri-state flags whose
         null means NOT KNOWN, never "no"). A transient fault is said as one, and it
         deliberately does not raise the dead-credential banner - only `auth_dead` does. */
      setWhoami((w) => ({ ...w, [id]: r && r.success ? r : { error: (r && r.error) || "The check failed.", transient: !!(r && r.transient) } }));
      await load();
    } catch (e) {
      setWhoami((w) => ({ ...w, [id]: { error: "Could not reach the app to run this check.", transient: true } }));
    }
    setTestingId(null);
  };

  const handleDelete = async (row) => {
    if (deletingId) return;
    if (!(await confirmDialog(
      `This deletes the connection "${row.label}", its stored credential and every webhook secret for its repositories. Rules that name those repositories stop running.`,
      { title: "Delete this connection?", confirmLabel: "Delete" }))) return;
    setDeletingId(row.id);
    try {
      const r = await invoke("deleteGitConnection", { id: row.id });
      if (r && r.success) { showToast("Connection deleted"); await load(); }
      else showToast((r && r.error) || "Could not delete this connection.", "error");
    } catch (e) {
      showToast("Could not delete this connection.", "error");
    }
    setDeletingId(null);
  };

  const handleRotate = async (row) => {
    if (rotating) return;
    setRotating(true);
    try {
      const r = await invoke("rotateGitCredential", {
        target: { kind: "connection", id: row.id },
        token: rotateToken,
        email: rotateEmail.trim() || undefined,
      });
      if (r && r.success) {
        setRotateId(null); setRotateToken(""); setRotateEmail("");
        // QUEUED, not done: the sentence must not claim the credential has changed yet.
        showToast("Replacement queued. The new credential is checked before it replaces the old one.");
      } else {
        showToast((r && r.error) || "Could not queue the replacement.", "error");
      }
    } catch (e) {
      showToast("Could not queue the replacement.", "error");
    }
    setRotating(false);
  };

  const handleSaveIdentity = async () => {
    if (identitySaving) return;
    setIdentitySaving(true); setIdentityError(null);
    try {
      const r = await invoke("saveForgeIdentity", {
        email: identityEmail.trim(), token: identityToken, consent: identityConsent === true,
      });
      if (r && r.success) {
        setIdentityToken(""); setIdentityConsent(false); setShowIdentity(false);
        setIdentity(r.status);
        showToast("Deploy identity stored");
      } else {
        setIdentityError((r && r.error) || "Could not store the deploy identity.");
      }
    } catch (e) {
      setIdentityError("Could not reach the app to store the deploy identity.");
    }
    setIdentitySaving(false);
  };

  const handleClearIdentity = async () => {
    if (!(await confirmDialog(
      "Pipelines that deploy your Forge app will stop working until a new identity is stored.",
      { title: "Remove the deploy identity?", confirmLabel: "Remove" }))) return;
    try {
      const r = await invoke("clearForgeIdentity");
      if (r && r.success) { setIdentity(r.status); showToast("Deploy identity removed"); }
      else showToast((r && r.error) || "Could not remove the deploy identity.", "error");
    } catch (e) {
      showToast("Could not remove the deploy identity.", "error");
    }
  };

  /* ---------- render ---------- */

  if (loading) {
    return (
      <div className="code-tab">
        <div className="card" style={{ padding: 18 }}>
          <div className="sk sk-text" style={{ width: 220, height: 15, marginBottom: 10 }} />
          <div className="sk sk-block" style={{ width: "100%", height: 74, borderRadius: 10 }} />
        </div>
      </div>
    );
  }

  if (accessRefusal) {
    return (
      <div className="code-tab">
        <div className="card" style={{ padding: 14 }}>
          {/* No Retry, on purpose: the button re-asks the same question and gets the same
              no, and a control that cannot succeed keeps the reader pressing it instead of
              learning who to ask. */}
          <div className="access-note" role="note">
            {permissionRefusalText(accessRefusal, "Git connections")}
          </div>
        </div>
      </div>
    );
  }

  if (upgradeRefusal) {
    return (
      <div className="code-tab">
        <div className="card" style={{ padding: 14 }}>
          <div className="upgrade-note" role="note">
            <span className="upgrade-note-title">{UPGRADE_REQUIRED_HEADLINE}</span>
            <span className="upgrade-note-text">{upgradeRequiredText(upgradeRefusal)}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="code-tab">
      {/* ── STATUS ─────────────────────────────────────────────────────────── */}
      <div className={`card code-status ${capOn ? "code-status-on" : "code-status-off"}`}>
        <div className="code-status-head">
          <span className="code-status-badge">{capOn ? "CODER IS ON" : "CODER IS OFF"}</span>
          <span className="code-status-title">{capCopy.title}</span>
        </div>
        <p className="code-status-text">{capCopy.remedy}</p>
        {capability && (
          <div className="code-facts">
            <span className="code-fact"><span className="code-fact-k">Provider</span><span className="code-fact-v">{capability.provider || "not set"}</span></span>
            <span className="code-fact"><span className="code-fact-k">Edition</span><span className="code-fact-v">{capability.edition || "unknown"}</span></span>
            <span className="code-fact"><span className="code-fact-k">Agent model</span><span className="code-fact-v">{capability.agentModel || "not set"}</span></span>
          </div>
        )}
        {capCopy.link === "settings" && (
          <p className="code-status-link">Open the <strong>Settings</strong> tab to change the provider, the edition or the agent model.</p>
        )}
      </div>

      {/* ── CONNECTIONS ────────────────────────────────────────────────────── */}
      <div className="card code-card">
        <div className="section-header">
          <span className="section-title">Git connections</span>
          <div className="section-actions">
            <button className="btn-secondary btn-small" onClick={() => { setShowAdd((v) => !v); setFormError(null); }}>
              {showAdd ? "Cancel" : "+ Add connection"}
            </button>
          </div>
        </div>

        {showAdd && (
          <div className="code-form">
            <div className="form-group" style={{ maxWidth: 220 }}>
              <span className="label">Provider</span>
              {/* The app's own dropdown. There is no native select anywhere in this app. */}
              <CustomSelect value={kind} onChange={setKind} options={KIND_OPTIONS} />
            </div>
            <div className="form-group">
              <label className="label" htmlFor="code-label">Label</label>
              <input id="code-label" className="code-input" type="text" value={label} maxLength={80}
                placeholder="e.g. Acme engineering" onChange={(e) => setLabel(e.target.value)} />
            </div>
            {kind === "bitbucket" && (
              <div className="form-group">
                <label className="label" htmlFor="code-email">Atlassian account email</label>
                <input id="code-email" className="code-input" type="text" value={email}
                  placeholder="you@example.com" onChange={(e) => setEmail(e.target.value)} />
              </div>
            )}
            <div className="form-group">
              <label className="label" htmlFor="code-token">
                {kind === "bitbucket" ? "App password" : "Access token"}
              </label>
              {/* WRITE ONLY. It starts empty every time and is cleared after the write;
                  nothing in the app reads a stored credential back. */}
              <input id="code-token" className="code-input" type="password" value={token} autoComplete="off"
                placeholder="Pasted once. It is never shown again." onChange={(e) => setToken(e.target.value)} />
              <p className="hint">The credential is checked against the provider before it is stored, so a dead token is refused here rather than becoming a connection that was born broken.</p>
            </div>
            <div className="form-group">
              <label className="label" htmlFor="code-repos">Allowed repositories</label>
              <input id="code-repos" className="code-input" type="text" value={repos}
                placeholder="owner/name, owner/other-repo"
                onChange={(e) => setRepos(e.target.value)}
                onBlur={() => setRepos(formatRepoList(parseRepoList(repos)))} />
              <p className="hint">An agent may only ever act on a repository listed here. Nothing listed means nothing allowed, on purpose.</p>
            </div>
            {formError && <div className="code-form-error" role="alert">{formError}</div>}
            <div className="code-form-actions">
              <button className="btn-primary btn-small" disabled={saving || !label.trim() || !token} onClick={handleSave}>
                {saving ? "Checking the credential…" : "Save connection"}
              </button>
            </div>
          </div>
        )}

        {loadError ? (
          <div style={{ padding: 14 }}>
            <div className="load-error">
              <span>Couldn't load Git connections.</span>
              <button className="btn-retry" onClick={load}>Retry</button>
            </div>
          </div>
        ) : connections.length === 0 ? (
          <div className="empty-state">No Git connections yet. Add one to let rules read and write your repositories.</div>
        ) : (
          <div className="code-conns">
            {connections.map((c) => {
              const dead = c.status === "auth_dead";
              const who = whoami[c.id];
              return (
                <div key={c.id} className="code-conn">
                  <div className="code-conn-head">
                    <KindChip kind={c.kind} />
                    <span className="code-conn-label">{c.label}</span>
                    {c.login && <span className="code-conn-login">@{c.login}</span>}
                    <span className={`code-conn-token ${c.hasToken ? "set" : "missing"}`}>
                      {c.hasToken ? "•••• SET" : "NO CREDENTIAL"}
                    </span>
                    <div className="code-conn-actions">
                      <button className="btn-secondary btn-small" disabled={testingId === c.id} onClick={() => handleTest(c.id)}>
                        {testingId === c.id ? "Checking…" : "Test"}
                      </button>
                      <button className="btn-secondary btn-small" onClick={() => { setRotateId(rotateId === c.id ? null : c.id); setRotateToken(""); setRotateEmail(""); }}>
                        Replace credential
                      </button>
                      <button className="btn-danger btn-small" disabled={deletingId === c.id} onClick={() => handleDelete(c)}>
                        {deletingId === c.id ? "Deleting…" : "Delete"}
                      </button>
                    </div>
                  </div>

                  {dead && (
                    /* Solid red, white text, loud. A dead credential means every rule on
                       this connection has silently stopped, which must never be whispered. */
                    <div className="code-dead" role="alert">
                      <span className="code-dead-title">This credential is dead</span>
                      <span className="code-dead-text">
                        {c.authDeadReason || "The provider rejected it."} Rules using this connection are not running. Replace the credential to restore them.
                      </span>
                    </div>
                  )}

                  <div className="code-conn-repos">
                    {c.repos.length === 0
                      ? <span className="code-repo-none">No repositories allowed. An agent can do nothing with this connection.</span>
                      : c.repos.map((r) => <span key={r} className="code-repo">{r}</span>)}
                  </div>

                  {who && (
                    <div className={`code-who ${who.error ? "code-who-err" : ""}`}>
                      {who.error ? (
                        <span>{who.error}{who.transient ? " This looks transient; the stored credential was left alone." : ""}</span>
                      ) : (
                        <>
                          <span className="code-who-row"><span className="code-fact-k">Account</span><span className="code-fact-v">{(who.whoami && who.whoami.login) || "unknown"}</span></span>
                          {who.whoami && who.whoami.name && <span className="code-who-row"><span className="code-fact-k">Name</span><span className="code-fact-v">{who.whoami.name}</span></span>}
                          <span className="code-who-row"><span className="code-fact-k">Scopes</span><span className="code-fact-v">{who.whoami && who.whoami.scopes && who.whoami.scopes.length ? who.whoami.scopes.join(", ") : "not reported"}</span></span>
                          {who.capabilities && (
                            <span className="code-who-caps">
                              {[["canCreateRepos", "create repos"], ["canWebhooks", "webhooks"], ["canPipelines", "pipelines"]].map(([k, lbl]) => {
                                const v = who.capabilities[k];
                                /* null is NOT KNOWN, never "no" - a fine-grained PAT does not
                                   report its scopes, and reading absence as a refusal would
                                   deny a capability the token actually has. */
                                const cls = v === true ? "yes" : v === false ? "no" : "unknown";
                                return <span key={k} className={`code-cap code-cap-${cls}`}>{lbl}: {v === true ? "yes" : v === false ? "no" : "not known"}</span>;
                              })}
                            </span>
                          )}
                          {who.capabilities && who.capabilities.reason && <span className="code-who-note">{who.capabilities.reason}</span>}
                        </>
                      )}
                    </div>
                  )}

                  {rotateId === c.id && (
                    <div className="code-rotate">
                      <p className="hint">
                        The replacement is queued, checked against the provider, and only then does it replace the stored credential. Nothing is lost if the new one is wrong.
                      </p>
                      {c.kind === "bitbucket" && (
                        <input className="code-input" type="text" value={rotateEmail} placeholder="Atlassian account email"
                          onChange={(e) => setRotateEmail(e.target.value)} />
                      )}
                      <input className="code-input" type="password" value={rotateToken} autoComplete="off"
                        placeholder={c.kind === "bitbucket" ? "New app password" : "New access token"}
                        onChange={(e) => setRotateToken(e.target.value)} />
                      <div className="code-form-actions">
                        <button className="btn-primary btn-small" disabled={rotating || !rotateToken} onClick={() => handleRotate(c)}>
                          {rotating ? "Queueing…" : "Queue replacement"}
                        </button>
                        <button className="btn-secondary btn-small" onClick={() => { setRotateId(null); setRotateToken(""); setRotateEmail(""); }}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── FORGE DEPLOY IDENTITY ──────────────────────────────────────────── */}
      <div className="card code-card">
        <div className="section-header">
          <span className="section-title">Forge deploy identity</span>
          <div className="section-actions">
            {identity && identity.hasIdentity
              ? <button className="btn-danger btn-small" onClick={handleClearIdentity}>Remove</button>
              : <button className="btn-secondary btn-small" onClick={() => setShowIdentity((v) => !v)}>{showIdentity ? "Cancel" : "Set up"}</button>}
          </div>
        </div>
        <p className="hint" style={{ marginTop: 0 }}>
          A Forge app cannot deploy a Forge app, so the pipeline CogniRunner installs in your repository deploys yours under an Atlassian API token you supply. It is stored write only: there is no reveal path in this app, for anyone, including you.
        </p>

        {identity && identity.hasIdentity ? (
          <div className="code-identity">
            <span className="code-identity-set">IDENTITY SET</span>
            <span className="code-fact"><span className="code-fact-k">Account</span><span className="code-fact-v">{identity.email || "unknown"}</span></span>
            {identity.consent && identity.consent.at && (
              <span className="code-fact"><span className="code-fact-k">Consented</span><span className="code-fact-v">{new Date(identity.consent.at).toLocaleString()}</span></span>
            )}
            {identity.rotation && identity.rotation.at && (
              /* Two different facts, shown apart (F-303): who agreed to store an identity,
                 and who last replaced its token. A rotation never re-stamps the consent. */
              <span className="code-fact"><span className="code-fact-k">Token replaced</span><span className="code-fact-v">{new Date(identity.rotation.at).toLocaleString()}</span></span>
            )}
          </div>
        ) : showIdentity ? (
          <div className="code-form">
            <div className="form-group">
              <label className="label" htmlFor="code-id-email">Atlassian account email</label>
              <input id="code-id-email" className="code-input" type="text" value={identityEmail}
                placeholder="you@example.com" onChange={(e) => setIdentityEmail(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="label" htmlFor="code-id-token">Atlassian API token</label>
              <input id="code-id-token" className="code-input" type="password" value={identityToken} autoComplete="off"
                placeholder="Pasted once. It is never shown again." onChange={(e) => setIdentityToken(e.target.value)} />
            </div>
            {/* THE CONSENT SCREEN. The backend refuses without an explicit `consent: true`
                and records who agreed and when, so this box is the only thing that can
                produce that flag. It is never pre-ticked. */}
            <label className="code-consent">
              <input type="checkbox" checked={identityConsent} onChange={(e) => setIdentityConsent(e.target.checked)} />
              <span>{IDENTITY_CONSENT}</span>
            </label>
            {identityError && <div className="code-form-error" role="alert">{identityError}</div>}
            <div className="code-form-actions">
              <button className="btn-primary btn-small"
                disabled={identitySaving || !identityConsent || !identityEmail.trim() || !identityToken}
                onClick={handleSaveIdentity}>
                {identitySaving ? "Storing…" : "Store deploy identity"}
              </button>
            </div>
          </div>
        ) : (
          <div className="empty-state">No deploy identity stored. Pipelines that deploy a Forge app need one.</div>
        )}
      </div>
    </div>
  );
}
