/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * THE KNOWLEDGE TAB (1.4 commit 14b) — the baked field-guide packs and their switches.
 *
 * This is the only surface on which an admin can see what platform knowledge the app is
 * carrying and switch a pack off. It is a thin renderer over ONE resolver pair:
 *
 *   getKnowledgePacks()      viewer floor  -> { packs[], settings, budgets, versions }
 *   saveKnowledgeSettings()  admin         -> { settings, packs[] }
 *
 * THREE THINGS THIS TAB DELIBERATELY DOES NOT DO.
 *
 * 1. It never renders a pack's TEXT. The backend has no resolver for it and must not grow
 *    one: the corpus is 582 KB and the human-review artefact for its content is
 *    knowledge/MANIFEST.md, reviewed before a bake is committed. A "read the pack" button
 *    would move a review gate into a runtime feature.
 *
 * 2. It never computes the pack list itself. `saveKnowledgeSettings` returns the packs the
 *    backend ACTUALLY stored, and this tab re-renders from that return rather than from
 *    the optimistic state it sent. That is the whole reason the resolver answers with
 *    `packs[]` at all — a UI that trusted its own optimistic list would keep showing a
 *    switch for a pack id the backend's clamp had dropped.
 *
 * 3. It never invents a role. The switch exists for an admin; a viewer sees the SAME state,
 *    rendered as a solid on/off pill with no control. A disabled switch would read as "try
 *    again later" when the answer is "not you" — the F-224 shape.
 *
 * THE HUE. Amber (#b45309 light / #f59e0b dark) — the agents hue from the project map.
 * The field guide is the knowledge layer the AGENTS read, which is why it borrows their
 * colour rather than minting a sixth one: docs are blue, skills purple, memories teal, and
 * a fourth knowledge hue with no relationship to anything would just be decoration. Both
 * themes are defined in App.js injectStyles(); there is no faded tint and no left rail.
 *
 * NO BAKE DATE. The plan's provenance line asked for "source, licence, baked <date>" and
 * the generated index carries no date — `KNOWLEDGE_CONTENT_VERSION` is the corpus
 * fingerprint and is what actually answers "did the text change?". The version line at the
 * foot prints it rather than this tab inventing a date from the build clock, which would be
 * a number that looks like provenance and is not.
 */

import React, { useState, useEffect, useCallback } from "react";
import { showToast } from "./toast";
import {
  isPermissionRefusal, permissionRefusalText,
  isUpgradeRequired, upgradeRequiredText, UPGRADE_REQUIRED_HEADLINE,
} from "./refusal";

/** Who each byte budget is spent on, in the order an admin meets them. */
const AUDIENCE_LABEL = {
  codegen: "Code generation",
  fix: "AI fix",
  validator: "Validators and conditions",
  agent: "Listener and job agents",
  va: "Virtual administrators",
  coder: "The Coder",
  review: "AI review",
};
const AUDIENCE_ORDER = ["codegen", "fix", "validator", "agent", "va", "coder", "review"];

/**
 * Bytes as an admin reads them. Whole KB above 1 KB, because nobody switches a pack off to
 * recover 300 bytes; raw bytes below it, because "0 KB" would make a real cost read as free
 * — the same rule MemoriesAdminTab's fmtBytes follows, and for the same reason.
 */
const fmtBytes = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return "—";
  return v < 1024 ? `${Math.round(v)} bytes` : `${Math.round(v / 1024)} KB`;
};

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export default function KnowledgeTab({ invoke, isAdmin }) {
  const [packs, setPacks] = useState([]);
  const [budgets, setBudgets] = useState(null);
  const [versions, setVersions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  /* The two refusal families kept APART, exactly as MemoriesAdminTab keeps them (F-296):
     a role answer and a billing answer have different remedies, and a branch that reads
     one state for both will eventually offer "ask an admin" to a tenant who needs to buy
     an edition. */
  const [accessRefusal, setAccessRefusal] = useState(null);
  const [upgradeRefusal, setUpgradeRefusal] = useState(null);
  /* Which pack id is mid-save. Drives the row spinner AND blocks a second click, so two
     switches cannot race one another into a stale `disabled` list. */
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    setAccessRefusal(null);
    setUpgradeRefusal(null);
    try {
      const res = await invoke("getKnowledgePacks");
      if (res && res.success) {
        setPacks(Array.isArray(res.packs) ? res.packs : []);
        setBudgets(res.budgets || null);
        setVersions({ knowledge: res.knowledgeVersion, content: res.contentVersion });
      } else if (isUpgradeRequired(res)) {
        setUpgradeRefusal(res);
      } else if (isPermissionRefusal(res)) {
        setAccessRefusal(res);
      } else {
        setLoadError(true);
      }
    } catch (e) {
      /* A REJECTED invoke is transport, never an answer. It takes the retry arm; a refusal
         never does, because re-asking the identical question gets the identical no. */
      setLoadError(true);
    }
    setLoading(false);
  }, [invoke]);

  useEffect(() => { load(); }, [load]);

  /**
   * Flip one pack. The payload is the WHOLE disabled list, not a delta, because that is
   * the shape the resolver clamps and stores; and the state that lands on screen is the
   * `packs[]` the backend returned, not the list this function computed.
   */
  const togglePack = async (pack) => {
    if (!isAdmin || savingId) return;
    setError("");
    setSavingId(pack.id);
    const disabled = packs.filter((p) => (p.id === pack.id ? p.enabled : !p.enabled)).map((p) => p.id);
    try {
      const res = await invoke("saveKnowledgeSettings", { disabled });
      if (res && res.success) {
        setPacks(Array.isArray(res.packs) ? res.packs : []);
        showToast(pack.enabled ? `${pack.title} switched off` : `${pack.title} switched on`);
      } else if (isPermissionRefusal(res)) {
        setError(permissionRefusalText(res, "the knowledge packs"));
      } else {
        setError((res && res.error) || "Couldn't save the pack switches.");
      }
    } catch (e) {
      setError("Couldn't reach CogniRunner to save the pack switches. Try again.");
    }
    setSavingId(null);
  };

  if (loading) {
    return (
      <div className="kn-tab">
        <div className="card kn-loading"><span className="spin-ring" /> <span>Reading the knowledge packs…</span></div>
      </div>
    );
  }

  if (upgradeRefusal) {
    return (
      <div className="kn-tab">
        <div className="card kn-refusal" role="status">
          <strong className="kn-refusal-head">{UPGRADE_REQUIRED_HEADLINE}</strong>
          <span className="kn-refusal-text">{upgradeRequiredText(upgradeRefusal)}</span>
        </div>
      </div>
    );
  }

  if (accessRefusal) {
    return (
      <div className="kn-tab">
        <div className="card kn-refusal" role="status">
          <strong className="kn-refusal-head">You can't see the knowledge packs</strong>
          <span className="kn-refusal-text">{permissionRefusalText(accessRefusal, "the knowledge packs")}</span>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="kn-tab">
        <div className="card kn-refusal kn-refusal-fault" role="alert">
          <strong className="kn-refusal-head">Couldn't load the knowledge packs</strong>
          <span className="kn-refusal-text">Something went wrong reaching CogniRunner.</span>
          <button type="button" className="btn-small" onClick={load}>Retry</button>
        </div>
      </div>
    );
  }

  const onCount = packs.filter((p) => p.enabled).length;
  const onBytes = packs.reduce((sum, p) => sum + (p.enabled ? Number(p.bytes) || 0 : 0), 0);
  const onSections = packs.reduce((sum, p) => sum + (p.enabled ? Number(p.sections) || 0 : 0), 0);

  return (
    <div className="kn-tab">
      {error && <div className="kn-error" role="alert">{error}</div>}

      <div className="card kn-summary anim-rise">
        <span className="kn-summary-eyebrow">§ WHAT THE MODELS ARE READING</span>
        <span className="kn-summary-line">
          <strong className="kn-summary-num">{onCount}</strong> of {plural(packs.length, "pack", "packs")} on,
          carrying <strong className="kn-summary-num">{onSections}</strong> sections
          ({fmtBytes(onBytes)}). Only the sections that score against a prompt are ever sent, up to the byte budget below.
        </span>
        {!isAdmin && (
          <span className="kn-summary-note">
            A CogniRunner admin can switch a pack off under Permissions.
          </span>
        )}
      </div>

      <div className="kn-packs">
        {packs.map((pack) => (
          <div className={`card kn-pack anim-rise${pack.enabled ? "" : " is-off"}`} key={pack.id}>
            <div className="kn-pack-head">
              <span className="kn-pack-title">{pack.title}</span>
              {isAdmin ? (
                <button
                  type="button"
                  role="switch"
                  aria-checked={pack.enabled ? "true" : "false"}
                  aria-label={`${pack.title}, ${pack.enabled ? "on" : "off"}`}
                  className={`kn-switch${pack.enabled ? " is-on" : ""}`}
                  disabled={savingId !== null}
                  onClick={() => togglePack(pack)}
                >
                  <span className="kn-switch-knob" aria-hidden="true" />
                  <span className="kn-switch-text">{pack.enabled ? "On" : "Off"}</span>
                  {savingId === pack.id && <span className="spin-ring spin-ring-sm" />}
                </button>
              ) : (
                <span className={`kn-state${pack.enabled ? " is-on" : ""}`}>{pack.enabled ? "On" : "Off"}</span>
              )}
            </div>
            <div className="kn-pack-facts">
              <span className="kn-pack-fact">{plural(Number(pack.sections) || 0, "section", "sections")}</span>
              <span className="kn-pack-fact">{fmtBytes(pack.bytes)}</span>
              {(pack.pinned || []).length > 0 && (
                <span className="kn-pack-fact kn-pack-pinned">
                  {plural(pack.pinned.length, "pinned section", "pinned sections")}
                </span>
              )}
            </div>
            {/* Provenance comes from the backend as already-joined "source, licence" lines,
                one per distinct source in the pack. Printed verbatim: re-splitting and
                re-joining them here would be a second formatter for a string that has one
                author (describeKnowledgePacks, src/kn-packs.js). */}
            {(pack.provenance || []).length > 0 && (
              <div className="kn-pack-prov">
                {pack.provenance.map((line, i) => (
                  <span className="kn-prov-line" key={i}>{line}</span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {budgets && (
        <div className="card kn-budgets anim-rise">
          <span className="kn-budgets-head">What a field guide costs, per surface</span>
          <span className="kn-budgets-sub">
            The ceiling on how many bytes of pack text one prompt may carry. A surface never spends
            more than this, whatever is switched on.
          </span>
          <table className="kn-budget-table">
            <thead>
              <tr><th scope="col">Surface</th><th scope="col">Budget per prompt</th></tr>
            </thead>
            <tbody>
              {AUDIENCE_ORDER.filter((a) => budgets[a] !== undefined).map((a) => (
                <tr key={a}>
                  <td>{AUDIENCE_LABEL[a] || a}</td>
                  <td className="kn-budget-num">{fmtBytes(budgets[a])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {versions && (
        <p className="kn-version-line">
          Knowledge engine <strong>{versions.knowledge}</strong> · corpus <strong>{versions.content}</strong>
        </p>
      )}
    </div>
  );
}
