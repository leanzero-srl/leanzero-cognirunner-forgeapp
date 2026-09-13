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
 *  5. THE PER-REPO CONTROLS (F-460 / F-461) ARE SETUP, NEVER EXECUTION. Registering a
 *     webhook, rotating its secret, installing a pipeline and starting a deploy are ADMIN
 *     RESOLVERS; no agent reaches them. The webhook SECRET has no render path here at all,
 *     for the same reason a token has none: the UI is told a hook EXISTS and when it was
 *     made, which is a fact, never a value.
 *
 *  6. THE PIPELINE ROW IS THE BACKEND'S, READ AND NEVER DERIVED. Status, step names and
 *     step states are rendered from `getGitPipelineStatus` exactly as src/git-pipeline.js
 *     wrote them; the step list is `pipelineStepNames(kind)` and is not retyped here. A
 *     refusal is rendered from its `code` and its NAMED scopes (`lock_mismatch` prints the
 *     added and removed scopes by name, `scope_not_allowed` prints the refused ones), never
 *     from a sentence match.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import CustomSelect from "./CustomSelect";
import { showToast } from "./toast";
import { confirmDialog } from "../confirmDialog";
import {
  isPermissionRefusal, permissionRefusalText,
  isUpgradeRequired, upgradeRequiredText, UPGRADE_REQUIRED_HEADLINE,
} from "./refusal";
import { agentCapabilityCopy } from "../../../../src/shared/edition.js";
import {
  GIT_PROVIDER_KINDS, gitProviderKindMeta, parseRepoList, formatRepoList,
  APP_ID_ARI_PREFIX, normalizeDeveloperSpaceId, normalizeForgeAppId,
} from "../../../../src/shared/git-ids.js";
import { SCAFFOLDS, scaffoldVarError, SCAFFOLD_VAR_LABELS, scaffoldHasCustomUi } from "../../../../src/shared/git-scaffolds.js";

const KIND_OPTIONS = GIT_PROVIDER_KINDS.map((k) => ({ value: k, label: gitProviderKindMeta(k).label }));

/* =========================================================================
 * F-526 - THE SCAFFOLD VARIABLES THE PIPELINE IS RENDERED WITH.
 *
 * The backend has accepted `scaffoldVars` since the resolver was written, and this
 * screen is the only surface a human can reach; it used to send nothing, so every
 * pipeline the product installed was rendered with the `forge-pipeline` DEFAULTS:
 * an app called "Forge app" building a folder called `static/app`. A repository
 * whose Custom UI lives anywhere else got a workflow that cannot even start its
 * build step, and the setup was still recorded as installed.
 *
 * THE DEFAULTS ARE READ FROM THE SCAFFOLD, never retyped here. A second copy of
 * "static/app" in this file is the next version of this finding.
 * ========================================================================= */
const PIPELINE_SCAFFOLD_ID = "forge-pipeline";
const PIPELINE_VAR_DEFAULTS = (SCAFFOLDS[PIPELINE_SCAFFOLD_ID] || {}).vars || {};
const DEFAULT_APP_NAME = PIPELINE_VAR_DEFAULTS.APP_NAME || "";
const DEFAULT_UI_DIR = PIPELINE_VAR_DEFAULTS.UI_DIR || "";

/* =========================================================================
 * F-548 - THE SCAFFOLD VALIDATOR IS IMPORTED, NOT RETYPED.
 *
 * This file used to carry its own copy of the renderer's character set and its own
 * traversal check. F-541 gave that rule one home in src/shared/git-scaffolds.js and
 * pointed the backend at it; this screen now calls the same `scaffoldVarError` with the
 * same `SCAFFOLD_VAR_LABELS`, so a value the form accepts and the renderer then throws
 * on cannot exist, and a wording change reaches both sides at once.
 *
 * THE TWO FORGE IDS ARE A DIFFERENT RULE. They are not scaffold variables; they are
 * repository variables. Their shapes used to be RETYPED here, justified by "that module
 * imports @forge/kvs and can never be pulled into a browser bundle" — true of
 * src/git-pipeline.js and beside the point: `src/shared/git-ids.js` is dependency-free,
 * this file already imports it, and so does git-pipeline.js. F-557 gave them one home
 * there; this screen imports the same normalisers and only supplies the SENTENCES.
 *
 * The BACKEND stays the gate: anything this form lets through is still refused with
 * `invalid_developer_space` / `invalid_app_id`, and those refusals are rendered on the
 * field they belong to rather than as a nameless setup failure.
 * ========================================================================= */

/** Both ids are OPTIONAL, so empty is usable. null when usable, else the sentence.
 *  `false` is the shared normaliser's "present and malformed". */
function developerSpaceError(raw) {
  return normalizeDeveloperSpaceId(raw) === false
    ? "A developer space id is 36 characters of hex and dashes."
    : null;
}

function forgeAppIdError(raw) {
  return normalizeForgeAppId(raw) === false
    ? `An app id is ${APP_ID_ARI_PREFIX} followed by a uuid, or the bare uuid.`
    : null;
}

/** Which FIELD a backend refusal belongs to, told by its machine code and never by a
 *  sentence match. `invalid_scaffold_var` names its own variable, so it is read. */
const REFUSAL_FIELD = { invalid_developer_space: "developerSpaceId", invalid_app_id: "appId" };
function refusalField(err) {
  if (!err || !err.code) return null;
  if (err.code === "invalid_scaffold_var") return err.variable || null;
  return REFUSAL_FIELD[err.code] || null;
}

/** The app's name as the pasted manifest states it, or "" when it does not say.
 *  Only the `app:` block is read, and only its `name:` key. */
function appNameFromManifest(yaml) {
  const lines = String(yaml || "").split(/\r?\n/);
  let inApp = false;
  for (const line of lines) {
    if (/^app:\s*$/.test(line)) { inApp = true; continue; }
    if (inApp) {
      if (/^\S/.test(line)) break;                       // the app block ended
      const m = line.match(/^\s+name:\s*(.+?)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, "").trim();
    }
  }
  return "";
}

/** The one sentence an admin must agree to before a deploy credential is stored.
 *  The BACKEND is the gate (saveForgeIdentity refuses without `consent: true`); this is
 *  the words for the box that produces the flag. It exports no sentence of its own, so
 *  the wording lives here, once, next to the only control that sends the flag. */
const IDENTITY_CONSENT = "I am handing CogniRunner an Atlassian API token that will deploy Forge apps as me, from pipelines in my repositories, without asking again.";

const KindChip = ({ kind }) => (
  <span className={`code-kind code-kind-${gitProviderKindMeta(kind).id}`}>{gitProviderKindMeta(kind).label}</span>
);

/* =========================================================================
 * PER-REPO SETUP (F-460 webhook, F-461 pipeline)
 *
 * Both live on the REPOSITORY, not on the connection, because both are per-repo
 * facts in the backend: the hook record is keyed by repo id on the connection row,
 * and the pipeline row is `git_pipeline:<connId>:<repoId>`. One control per fact.
 * ========================================================================= */

/** Every refusal these resolvers can answer with, said in the admin's words.
 *  It is keyed by the backend's machine `code` and NOT by its sentence: matching a
 *  sentence is the defect F-242 closed, and the two codes that carry NAMES
 *  (lock_mismatch, scope_not_allowed) are rendered from their arrays, not from here. */
const PIPELINE_CODE_COPY = {
  not_found: "That git connection no longer exists.",
  auth_dead: "This connection's credential is dead, so nothing can be installed until it is replaced.",
  not_allowed: "That repository is not on this connection's allow-list. Add it to the allowed repositories first.",
  identity_required: "A Forge deploy identity is needed before a pipeline can deploy your app.",
  consent_required: "The stored deploy identity has no recorded consent. Store it again and tick the consent box.",
  manifest_required: "Paste the app's manifest.yml. The permission lock is built from it, so there is nothing to install without it.",
  already_running: "A setup for this repository is already running. Watch it below.",
  queue: "The setup could not be queued. Nothing was written to the repository.",
  security_model: "Pipeline setup is refused by the app's own security model check.",
  not_installed: "There is no installed pipeline for this repository yet.",
  confirmation_required: "A deploy needs an explicit confirmation.",
};

const PIPE_STATUS_LABEL = { queued: "QUEUED", running: "RUNNING", installed: "INSTALLED", partial: "PARTIAL" };
const STEP_STATUS_LABEL = { pending: "waiting", running: "running", done: "done", failed: "failed" };

const POLL_MS = 5000;
/* 10 minutes at 5s. A setup that has not moved by then will not move inside this
   screen's lifetime, and a poll that never stops is a tab that heats a laptop for an
   hour. The card says it stopped watching rather than pretending it still is. */
const POLL_MAX = 120;

/** The refusal body, rendered. Scopes are printed BY NAME, which is the whole point of
 *  the lock: "the permissions changed" is not an answer an admin can act on. */
function PipelineError({ err, onNeedIdentity }) {
  if (!err) return null;
  const code = err.code || "";
  let body = null;
  if (code === "lock_mismatch") {
    const added = Array.isArray(err.added) ? err.added : [];
    const removed = Array.isArray(err.removed) ? err.removed : [];
    body = (
      <>
        <span className="code-pipe-err-title">The committed lock differs</span>
        <span className="code-pipe-err-text">
          This manifest asks for different permissions than the lock already committed to the repository. Re-approve them before the pipeline is reinstalled.
        </span>
        <span className="code-lock-diff">
          {added.map((sc) => <span key={`a-${sc}`} className="code-diff code-diff-add">+{sc}</span>)}
          {removed.map((sc) => <span key={`r-${sc}`} className="code-diff code-diff-rem">&minus;{sc}</span>)}
          {added.length === 0 && removed.length === 0 && (
            <span className="code-diff code-diff-rem">the permissions block changed</span>
          )}
        </span>
      </>
    );
  } else if (code === "scope_not_allowed") {
    const scopes = Array.isArray(err.scopes) ? err.scopes : [];
    body = (
      <>
        <span className="code-pipe-err-title">CogniRunner will not install a pipeline for these scopes</span>
        <span className="code-lock-diff">
          {scopes.map((sc) => <span key={sc} className="code-diff code-diff-rem">{sc}</span>)}
        </span>
        <span className="code-pipe-err-text">Remove them from the manifest, or deploy this app by hand.</span>
      </>
    );
  } else {
    body = (
      <>
        <span className="code-pipe-err-title">This setup was refused</span>
        <span className="code-pipe-err-text">{PIPELINE_CODE_COPY[code] || err.error || "The setup could not be started."}</span>
      </>
    );
  }
  const needsIdentity = code === "identity_required" || code === "consent_required";
  return (
    <div className="code-pipe-err" role="alert">
      {body}
      {needsIdentity && (
        /* The remedy is a card on this same screen, so the refusal takes the reader to
           it instead of naming it and leaving them to hunt for it. */
        <button className="code-pipe-goto" onClick={onNeedIdentity}>Go to the deploy identity</button>
      )}
    </div>
  );
}

/** The pipeline half of a repo row: the installed state, the step chain of a run in
 *  flight, the setup form when there is no row yet, and the deploy trigger. */
function PipelineCard({ invoke, conn, repoId, onNeedIdentity }) {
  const [row, setRow] = useState(null);
  const [deploy, setDeploy] = useState(null);
  const [deployError, setDeployError] = useState(null);
  const [reading, setReading] = useState(true);
  const [readFailed, setReadFailed] = useState(false);
  const [refusal, setRefusal] = useState(null);   // a role / edition refusal on the READ
  const [err, setErr] = useState(null);           // a setup or deploy refusal body
  const [manifestYaml, setManifestYaml] = useState("");
  const [site, setSite] = useState("");
  const [product, setProduct] = useState("Jira");
  const [branch, setBranch] = useState("");
  /* F-526: the two scaffold variables, seeded from the scaffold's own defaults so the
     form never shows a blank where the renderer would use a value. */
  const [appName, setAppName] = useState(DEFAULT_APP_NAME);
  const [uiDir, setUiDir] = useState(DEFAULT_UI_DIR);
  /* F-548: the two OPTIONAL repository variables the headless bootstrap needs. Both
     start empty, because empty is the honest default: no developer space means the
     pipeline registers wherever the identity's default is, and no app id means the
     pipeline registers the app itself on its first run. */
  const [developerSpaceId, setDeveloperSpaceId] = useState("");
  const [appId, setAppId] = useState("");
  /* A refusal the BACKEND raised against one named field, so it can be shown under that
     field instead of as a nameless "this setup was refused". Cleared the moment the
     reader edits anything, because a stale refusal about a value that no longer exists
     is worse than none. */
  const [fieldRefusal, setFieldRefusal] = useState(null);
  /* Once the admin has typed a name, the manifest stops overwriting it. A prefill that
     keeps winning is a field the reader cannot correct. */
  const appNameTouched = useRef(false);
  const [busy, setBusy] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [run, setRun] = useState(null);
  const [stalled, setStalled] = useState(false);

  /* THE STALE GUARD. Every read carries the token it was started under; a poll that
     lands after the card was pointed at another repo, or after it unmounted, answers
     a question nobody asked and must not paint. */
  const tokenRef = useRef(0);
  const timerRef = useRef(null);
  const readRef = useRef(null);

  readRef.current = async (token, tries) => {
    let r = null;
    try {
      r = await invoke("getGitPipelineStatus", { connectionId: conn.id, repo: repoId });
    } catch (e) {
      r = null;
    }
    if (tokenRef.current !== token) return;
    setReading(false);
    if (r && r.success) {
      setReadFailed(false); setRefusal(null);
      setRow(r.status || null);
      setDeploy(r.deploy || null);
      setDeployError(r.deployError || null);
      const st = r.status && r.status.status;
      if (st === "queued" || st === "running") {
        if (tries < POLL_MAX) {
          timerRef.current = setTimeout(() => { if (tokenRef.current === token) readRef.current(token, tries + 1); }, POLL_MS);
        } else {
          setStalled(true);
        }
      }
    } else if (isPermissionRefusal(r) || isUpgradeRequired(r)) {
      setRefusal(r);
    } else {
      setReadFailed(true);
    }
  };

  useEffect(() => {
    const token = ++tokenRef.current;
    setReading(true); setStalled(false);
    readRef.current(token, 0);
    return () => {
      tokenRef.current += 1;
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    };
  }, [conn.id, repoId]);

  /* F-604 - PREFILL THE FORM FROM THE ROW, ONCE PER REPO.

     F-583 admits an INSTALLED-but-outdated pipeline to this form, and the form's fields
     start at the scaffold's DEFAULTS. Following the amber banner therefore re-installed the
     pipeline with APP_NAME/UI_DIR defaults and dropped the developer space and app id the
     repository was set up with: the remedy for stale bytes broke the build folder and the
     app registration in the same commit. The row is the record of what is installed
     (publicPipelineRow carries scaffoldVars, developerSpaceId, appId and branch), so a
     re-setup starts from it.

     SEEDED ONCE, per repo. The card polls every 5 seconds; a seed that ran on every read
     would overwrite whatever the admin is typing. The manifest is deliberately NOT seeded -
     the row stores a lock hash, never the manifest, and the paste is what proves the
     permissions again. */
  const seededRef = useRef(null);
  useEffect(() => { seededRef.current = null; }, [conn.id, repoId]);
  useEffect(() => {
    if (!row || seededRef.current === repoId) return;
    seededRef.current = repoId;
    const vars = row.scaffoldVars || {};
    if (vars.APP_NAME) { appNameTouched.current = true; setAppName(vars.APP_NAME); }
    if (vars.UI_DIR) setUiDir(vars.UI_DIR);
    if (row.developerSpaceId) setDeveloperSpaceId(row.developerSpaceId);
    if (row.appId) setAppId(row.appId);
    if (row.branch) setBranch(row.branch);
  }, [row, repoId]);

  const restartPolling = () => {
    const token = ++tokenRef.current;
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    setStalled(false);
    timerRef.current = setTimeout(() => { if (tokenRef.current === token) readRef.current(token, 1); }, POLL_MS);
  };

  /* The manifest is the one place the app's real name is written down, so pasting it
     answers the question instead of asking it. It only ever fills an untouched field. */
  const onManifestChange = (text) => {
    setManifestYaml(text);
    if (appNameTouched.current) return;
    const fromManifest = appNameFromManifest(text);
    if (fromManifest) setAppName(fromManifest);
  };

  /* F-541/F-548: the ONE validator, called with the scaffold's own variable names and
     its own labels. Nothing about the rule is restated on this screen. */
  const appNameErr = scaffoldVarError("APP_NAME", appName, SCAFFOLD_VAR_LABELS.APP_NAME);
  const uiDirErr = scaffoldVarError("UI_DIR", uiDir, SCAFFOLD_VAR_LABELS.UI_DIR);
  const spaceErr = developerSpaceError(developerSpaceId);
  const appIdErr = forgeAppIdError(appId);
  const varsOk = !appNameErr && !uiDirErr && !spaceErr && !appIdErr;
  /* The backend's refusal, shown under the field it named, and only while that field
     still holds the value it was raised about. */
  const serverErrFor = (field) => (fieldRefusal && fieldRefusal.field === field ? fieldRefusal.message : null);
  const hasCustomUi = scaffoldHasCustomUi({ UI_DIR: uiDir });

  const handleSetup = async () => {
    if (busy || !varsOk) return;
    setBusy(true); setErr(null); setFieldRefusal(null);
    try {
      const r = await invoke("setupGitPipeline", {
        connectionId: conn.id, repo: repoId,
        manifestYaml, site: site.trim(), product,
        branch: branch.trim() || undefined,
        /* F-526: the whole point. These are the scaffold's variable NAMES
           (src/shared/git-scaffolds.js), and the backend passes them straight to
           renderScaffold, which ignores any key the scaffold does not declare. */
        scaffoldVars: { APP_NAME: appName.trim(), UI_DIR: uiDir.trim() },
        /* F-548: both are optional, and an EMPTY one is sent as absent rather than as
           an empty string, because the backend reads "present and malformed" as a
           refusal and "absent" as "do not write this repository variable at all". */
        /* F-604: with a row on screen the form was PREFILLED from it, so an emptied field
           is an explicit clear and is sent as the empty string; the backend reads a key it
           was not sent as "keep what the row holds". With no row there is nothing to keep
           and the F-548 shape is unchanged. */
        developerSpaceId: row ? developerSpaceId.trim() : (developerSpaceId.trim() || undefined),
        appId: row ? appId.trim() : (appId.trim() || undefined),
      });
      if (r && r.success) {
        setRow(r.status || null);
        showToast("Pipeline setup queued");
        restartPolling();
      } else if (isPermissionRefusal(r) || isUpgradeRequired(r)) {
        setRefusal(r);
      } else {
        const field = refusalField(r);
        if (field) setFieldRefusal({ field, message: (r && r.error) || "That value was refused." });
        else setErr(r || { error: "The setup could not be started." });
      }
    } catch (e) {
      setErr({ error: "Could not reach the app to start this setup." });
    }
    setBusy(false);
  };

  const handleDeploy = async () => {
    if (deploying) return;
    if (!(await confirmDialog(
      `This starts a real deploy of your Forge app from ${repoId}, under the stored Atlassian deploy identity. It runs in your repository's CI and it cannot be called back.`,
      { title: "Start a deploy?", confirmLabel: "Start deploy" }))) return;
    setDeploying(true); setErr(null);
    try {
      const r = await invoke("triggerGitDeploy", {
        connectionId: conn.id, repo: repoId, confirm: true,
        ref: branch.trim() || undefined,
      });
      if (r && r.success) {
        setRun(r.run || null);
        showToast("Deploy started");
        restartPolling();
      } else if (isPermissionRefusal(r) || isUpgradeRequired(r)) {
        setRefusal(r);
      } else {
        setErr(r || { error: "The deploy could not be started." });
      }
    } catch (e) {
      setErr({ error: "Could not reach the app to start this deploy." });
    }
    setDeploying(false);
  };

  if (refusal) {
    return (
      <div className="code-pipe">
        <div className="access-note" role="note">
          {isPermissionRefusal(refusal)
            ? permissionRefusalText(refusal, "the deploy pipeline")
            : `${UPGRADE_REQUIRED_HEADLINE} ${upgradeRequiredText(refusal)}`}
        </div>
      </div>
    );
  }

  if (reading) {
    return (
      <div className="code-pipe">
        <div className="sk sk-text" style={{ width: 180, height: 13 }} />
      </div>
    );
  }

  const status = (row && row.status) || null;
  const live = status === "queued" || status === "running";
  /* F-583 - the row is OUTDATED when the scaffold committed to the repository is older
     than the one this build installs. `outdated`/`outdatedReason`/`currentScaffoldVersion`
     are DERIVED by publicPipelineRow (F-579) against the shipped SCAFFOLD_VERSION, so the
     tab needs no migration and no version arithmetic of its own - it renders the answer.
     Never shown for a run still in flight: a queued or running setup is ABOUT to write the
     current scaffold, so calling it outdated would be stale by the time it is read. */
  const outdated = !!(row && row.outdated) && !live;
  const fromVersion = Number(row && row.scaffoldVersion) >= 1 ? Math.floor(Number(row.scaffoldVersion)) : 1;
  const toVersion = row && row.currentScaffoldVersion != null ? row.currentScaffoldVersion : null;
  const lastRun = run || (row && row.lastRun) || null;
  const latest = deploy && deploy.latest ? deploy.latest : null;

  return (
    <div className="code-pipe">
      <div className="code-pipe-head">
        <span className="code-pipe-title">Deploy pipeline</span>
        {/* F-583 - OUTDATED WINS OVER INSTALLED. The bug was that a repo stuck on the
            broken scaffold reported status "installed", steps 6/6 and a green badge:
            byte-for-byte what a healthy install reports, while every dispatch 422s. The
            green badge is the single most load-bearing thing on this screen, so the state
            that contradicts it has to TAKE ITS PLACE rather than sit underneath it. */}
        <span className={`code-pipe-status ${outdated ? "code-pipe-outdated" : `code-pipe-${status || "none"}`}`}>
          {outdated ? "PIPELINE OUTDATED" : status ? PIPE_STATUS_LABEL[status] || String(status).toUpperCase() : "NOT SET UP"}
        </span>
        {row && row.installedAt && (
          <span className="code-fact"><span className="code-fact-k">Installed</span><span className="code-fact-v">{new Date(row.installedAt).toLocaleString()}</span></span>
        )}
        {row && row.branch && (
          <span className="code-fact"><span className="code-fact-k">Branch</span><span className="code-fact-v">{row.branch}</span></span>
        )}
        {/* F-548: what this pipeline was actually installed WITH, read from the row
            (publicPipelineRow exposes both) and never from the form, which the reader
            may have reopened and changed since. */}
        {row && row.developerSpaceId && (
          <span className="code-fact"><span className="code-fact-k">Developer space</span><span className="code-fact-v">{row.developerSpaceId}</span></span>
        )}
        {row && row.appId && (
          <span className="code-fact"><span className="code-fact-k">App id</span><span className="code-fact-v">{row.appId}</span></span>
        )}
        {/* F-602 - AN OUTDATED PIPELINE MUST NOT OFFER THE ACTION THAT CANNOT WORK.
            The gate used to read `status` alone, which is still "installed" on an outdated
            row, so the card said the committed workflow is invalid YAML and that GitHub
            answers every dispatch with 422 - and then put a primary-styled button next to
            that sentence whose only outcome IS the 422. A reader presses what is in front
            of them rather than scrolling to a form. The remedy for this state is "Set up
            pipeline" below, and it is the only control the state should leave standing.
            Disabling was the weaker option: a greyed button still reads as "the right
            action, temporarily unavailable" and invites a wait rather than the re-setup. */}
        {status === "installed" && !outdated && (
          <button className="btn-primary btn-small code-pipe-deploy" disabled={deploying} onClick={handleDeploy}>
            {deploying ? "Starting…" : "Trigger deploy"}
          </button>
        )}
      </div>

      {outdated && (
        /* The REASON is the scaffold changelog line for the version this repo is stuck on,
           rendered VERBATIM: the tab does not know what changed between two scaffolds and
           must not paraphrase a fix it cannot see. The version pair is the fact that makes
           the sentence actionable, and the remedy is the setup form below, which this state
           also unlocks - re-running setup is the only way to replace the committed file. */
        <div className="code-pipe-outdated-box" role="alert">
          <span className="code-pipe-err-title">Pipeline outdated</span>
          <span className="code-pipe-err-text">{row.outdatedReason}</span>
          {toVersion != null && (
            <span className="code-pipe-outdated-ver">Installed scaffold v{fromVersion} to v{toVersion}</span>
          )}
          <span className="code-pipe-err-text">Use "Set up pipeline" below to commit the current workflow to this repository.</span>
        </div>
      )}

      {readFailed && (
        <div className="load-error">
          <span>Couldn't read the pipeline status.</span>
          <button className="btn-retry" onClick={() => { const t = ++tokenRef.current; setReading(true); readRef.current(t, 0); }}>Retry</button>
        </div>
      )}

      {row && Array.isArray(row.steps) && row.steps.length > 0 && (
        /* The step chain is the BACKEND's list, in its order, with its own states. A
           partial setup is the case this exists for: it names the step that failed. */
        <div className="code-steps">
          {row.steps.map((st) => (
            <div key={st.name} className={`code-step code-step-${st.status || "pending"}`}>
              <span className="code-step-state">{STEP_STATUS_LABEL[st.status] || st.status}</span>
              <span className="code-step-name">{st.name}</span>
              {st.error && <span className="code-step-err">{st.error}</span>}
            </div>
          ))}
        </div>
      )}

      {status === "partial" && row && row.failedStep && (
        <div className="code-pipe-warn" role="alert">
          <span className="code-pipe-err-title">This setup stopped at {row.failedStep}</span>
          <span className="code-pipe-err-text">Everything before it is done. Fix the cause and set it up again.</span>
        </div>
      )}

      {live && !stalled && <p className="hint code-pipe-live">Running. This re-reads the status every 5 seconds.</p>}
      {live && stalled && (
        <div className="code-pipe-warn" role="alert">
          <span className="code-pipe-err-title">Still not finished after 10 minutes</span>
          <span className="code-pipe-err-text">This screen stopped watching. Reopen the pipeline to read the status again.</span>
        </div>
      )}

      {row && Array.isArray(row.lockScopes) && row.lockScopes.length > 0 && (
        <div className="code-lock">
          <span className="code-lock-title">Locked scopes</span>
          <span className="code-lock-diff">
            {row.lockScopes.map((sc) => <span key={sc} className="code-diff code-diff-lock">{sc}</span>)}
          </span>
        </div>
      )}

      {lastRun && (
        <div className="code-run">
          <span className="code-run-title">Last deploy</span>
          <span className="code-fact"><span className="code-fact-k">Ref</span><span className="code-fact-v">{lastRun.ref || "unknown"}</span></span>
          {lastRun.workflow && <span className="code-fact"><span className="code-fact-k">Workflow</span><span className="code-fact-v">{lastRun.workflow}</span></span>}
          {lastRun.id && <span className="code-fact"><span className="code-fact-k">Run</span><span className="code-fact-v">{String(lastRun.id)}</span></span>}
          {lastRun.at && <span className="code-fact"><span className="code-fact-k">Started</span><span className="code-fact-v">{new Date(lastRun.at).toLocaleString()}</span></span>}
          {latest && <span className={`code-run-state code-run-${latest.state || "pending"}`}>{latest.state || "pending"}</span>}
          {latest && latest.url && (
            <a className="code-run-link" href={latest.url} target="_blank" rel="noopener noreferrer">Open the run</a>
          )}
          {!latest && !deployError && (
            /* GitHub answers a dispatch with 204 and no id, so a run that has just been
               asked for has no link yet. Saying so beats rendering a dead link. */
            <span className="code-run-note">The provider has not reported a run for it yet.</span>
          )}
          {deployError && <span className="code-run-note">The run list could not be read: {deployError}</span>}
        </div>
      )}

      <PipelineError err={err} onNeedIdentity={onNeedIdentity} />

      {/* F-583 - an OUTDATED row reaches the form even though it IS installed. Without this
          the Code tab named a fault and offered no way to act on it: the form was gated on
          `status !== "installed"`, which is exactly the state an outdated pipeline is in. */}
      {!live && (status !== "installed" || outdated) && (
        <div className="code-pipe-form">
          <p className="hint" style={{ marginTop: 0 }}>
            CogniRunner commits a deploy workflow to this repository, stores the deploy identity as CI secrets, and locks the app's permissions to the manifest you paste here. The lock is what refuses a later manifest that quietly asks for more.
          </p>
          <div className="form-group">
            <label className="label" htmlFor={`pipe-manifest-${conn.id}-${repoId}`}>manifest.yml</label>
            <textarea id={`pipe-manifest-${conn.id}-${repoId}`} className="code-textarea" rows={7}
              value={manifestYaml} spellCheck={false}
              placeholder="Paste the app's manifest.yml here"
              onChange={(e) => onManifestChange(e.target.value)} />
            {/* PASTE ONLY, and deliberately: a native file control is browser chrome the
                app cannot style, which is the same rule that keeps native selects and
                confirms out of every screen here. */}
            <p className="hint">Copy the manifest.yml from the repository root. Only its permissions block is read, and it is what the lock is built from.</p>
          </div>
          <div className="code-pipe-fields">
            <div className="form-group">
              <label className="label" htmlFor={`pipe-site-${conn.id}-${repoId}`}>Atlassian site</label>
              <input id={`pipe-site-${conn.id}-${repoId}`} className="code-input" type="text" value={site}
                placeholder="your-site.atlassian.net" onChange={(e) => setSite(e.target.value)} />
            </div>
            <div className="form-group" style={{ maxWidth: 200 }}>
              <span className="label">Product</span>
              {/* The app's own dropdown. There is no native select anywhere in this app. */}
              <CustomSelect value={product} onChange={setProduct}
                options={[{ value: "Jira", label: "Jira" }, { value: "Confluence", label: "Confluence" }]} />
            </div>
            <div className="form-group" style={{ maxWidth: 220 }}>
              <label className="label" htmlFor={`pipe-branch-${conn.id}-${repoId}`}>Branch</label>
              <input id={`pipe-branch-${conn.id}-${repoId}`} className="code-input" type="text" value={branch}
                placeholder="the repository's default branch" onChange={(e) => setBranch(e.target.value)} />
            </div>
          </div>
          {/* F-526: the two values the workflow is RENDERED with. Before this they were
              never asked for and the scaffold's defaults shipped to every repository. */}
          <div className="code-pipe-fields">
            <div className="form-group">
              <label className="label" htmlFor={`pipe-appname-${conn.id}-${repoId}`}>App name</label>
              <input id={`pipe-appname-${conn.id}-${repoId}`} className="code-input" type="text" value={appName}
                /* No maxLength: a value silently clipped at 80 is a pipeline rendered
                   with a name its author did not write. The rule is said out loud. */
                placeholder={DEFAULT_APP_NAME}
                onChange={(e) => { appNameTouched.current = true; setFieldRefusal(null); setAppName(e.target.value); }} />
              <p className="hint">The workflow registers the app under this name the first time it runs. It is filled in from the manifest you paste above when that manifest names the app.</p>
              {(appNameErr || serverErrFor("APP_NAME")) && <p className="code-field-err" role="alert">{appNameErr || serverErrFor("APP_NAME")}</p>}
            </div>
            <div className="form-group">
              <label className="label" htmlFor={`pipe-uidir-${conn.id}-${repoId}`}>Custom UI folder</label>
              <input id={`pipe-uidir-${conn.id}-${repoId}`} className="code-input" type="text" value={uiDir}
                placeholder={DEFAULT_UI_DIR}
                onChange={(e) => { setFieldRefusal(null); setUiDir(e.target.value); }} />
              <p className="hint">The folder that holds the Custom UI's package.json, relative to the repository root. Type "none" for a backend only app that has no Custom UI to build.</p>
              {(uiDirErr || serverErrFor("UI_DIR")) && <p className="code-field-err" role="alert">{uiDirErr || serverErrFor("UI_DIR")}</p>}
            </div>
          </div>
          {/* F-548: the two values the HEADLESS bootstrap needs. Without the first, the
              very first run of a fresh pipeline stops at "forge register" asking a
              question nobody can answer in CI; without the second, it registers again
              every run. Both are optional and both are refused by the backend when they
              are present and malformed, so a typo is caught here and there. */}
          <div className="code-pipe-fields">
            <div className="form-group">
              <label className="label" htmlFor={`pipe-space-${conn.id}-${repoId}`}>Forge developer space id</label>
              <input id={`pipe-space-${conn.id}-${repoId}`} className="code-input" type="text" value={developerSpaceId}
                placeholder="optional"
                onChange={(e) => { setFieldRefusal(null); setDeveloperSpaceId(e.target.value); }} />
              <p className="hint">The developer space the pipeline registers the app in; find it in developer.atlassian.com.</p>
              {(spaceErr || serverErrFor("developerSpaceId")) && <p className="code-field-err" role="alert">{spaceErr || serverErrFor("developerSpaceId")}</p>}
            </div>
            <div className="form-group">
              <label className="label" htmlFor={`pipe-appid-${conn.id}-${repoId}`}>Forge app id</label>
              <input id={`pipe-appid-${conn.id}-${repoId}`} className="code-input" type="text" value={appId}
                placeholder="optional"
                onChange={(e) => { setFieldRefusal(null); setAppId(e.target.value); }} />
              <p className="hint">Paste the app id if the app is already registered; the pipeline then never registers.</p>
              {(appIdErr || serverErrFor("appId")) && <p className="code-field-err" role="alert">{appIdErr || serverErrFor("appId")}</p>}
            </div>
          </div>
          {/* The REVIEW: the values as the committed workflow will carry them, read back
              before anything is written. A setup is ~15 writes to someone's repository
              and there is no undo, so the last thing before the button is the truth. */}
          <div className="code-pipe-review">
            <span className="code-pipe-review-title">This pipeline will be written with</span>
            <span className="code-fact"><span className="code-fact-k">FORGE_APP_NAME</span><span className="code-fact-v code-pipe-review-v">{appName.trim() || DEFAULT_APP_NAME}</span></span>
            <span className="code-fact"><span className="code-fact-k">working-directory</span><span className="code-fact-v code-pipe-review-v">{hasCustomUi ? (uiDir.trim() || DEFAULT_UI_DIR) : "no build step"}</span></span>
            {/* F-548: the two repository variables, shown only when there is something
                to show. A row of empty values reads as a value of empty string. */}
            {developerSpaceId.trim() && (
              <span className="code-fact"><span className="code-fact-k">FORGE_DEVELOPER_SPACE</span><span className="code-fact-v code-pipe-review-v">{developerSpaceId.trim().toLowerCase()}</span></span>
            )}
            {appId.trim() && (
              <span className="code-fact"><span className="code-fact-k">FORGE_APP_ID</span><span className="code-fact-v code-pipe-review-v">{appId.trim().toLowerCase()}</span></span>
            )}
          </div>
          {!hasCustomUi && (
            /* F-540 made the build step CONDITIONAL in the scaffold itself, so the old
               warning here (that the step is always committed and will fail on a folder
               called "none") stopped being true the moment that shipped. The predicate
               is the scaffold's own, so this sentence cannot drift from what is written. */
            <p className="hint code-pipe-ui-note">With "none" the deploy workflow omits the Custom UI build step, so nothing is built and nothing points at a folder that is not there.</p>
          )}
          <div className="code-form-actions">
            <button className="btn-primary btn-small" disabled={busy || !manifestYaml.trim() || !site.trim() || !varsOk} onClick={handleSetup}>
              {busy ? "Queueing…" : status === "partial" ? "Set up again" : "Set up pipeline"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** One allow-listed repository: its webhook state and its pipeline. */
function RepoRow({ invoke, conn, repoId, onChanged, onNeedIdentity }) {
  const hook = (conn.webhooks && conn.webhooks[repoId]) || null;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);       // a refusal or a fault, said plainly
  const [rotatedAt, setRotatedAt] = useState(null);
  const [openPipe, setOpenPipe] = useState(false);

  const say = (r, fallback) => {
    if (isPermissionRefusal(r)) return permissionRefusalText(r, "webhooks");
    if (isUpgradeRequired(r)) return `${UPGRADE_REQUIRED_HEADLINE} ${upgradeRequiredText(r)}`;
    return (r && r.error) || fallback;
  };

  const handleSetupHook = async () => {
    if (busy) return;
    setBusy(true); setNote(null);
    try {
      const r = await invoke("setupGitWebhook", { connectionId: conn.id, repo: repoId });
      if (r && r.success) {
        /* The secret is minted by the backend and is NEVER returned, so there is nothing
           here to show and nothing to leak. That the hook exists is the whole answer. */
        showToast("Webhook registered");
        await onChanged();
      } else {
        setNote(say(r, "The webhook could not be registered."));
      }
    } catch (e) {
      setNote("Could not reach the app to register this webhook.");
    }
    setBusy(false);
  };

  const handleRotateSecret = async () => {
    if (busy) return;
    if (!(await confirmDialog(
      `Deliveries signed with the old secret stop being accepted the moment this finishes. Rules listening to ${repoId} keep working, because CogniRunner updates the hook at the provider too.`,
      { title: "Rotate this webhook secret?", confirmLabel: "Rotate" }))) return;
    setBusy(true); setNote(null);
    try {
      const r = await invoke("rotateGitWebhookSecret", { connectionId: conn.id, repo: repoId });
      if (r && r.success) {
        setRotatedAt(r.rotatedAt || new Date().toISOString());
        showToast("Webhook secret rotated");
        await onChanged();
      } else {
        const msg = say(r, "The secret could not be rotated.");
        setNote(msg);
        /* F-481: a half-finished rotation is not a plain "no" - it changes the state of
           the hook, so it is said out loud AND the list is re-read, which is what raises
           the red banner with the "Set up webhook" remedy. */
        if (r && r.code === "rotation-failed") {
          showToast(msg, "error");
          await onChanged();
        }
      }
    } catch (e) {
      setNote("Could not reach the app to rotate this secret.");
    }
    setBusy(false);
  };

  const rotated = rotatedAt || (hook && hook.rotatedAt) || null;
  /* F-481: the backend records a rotation that started and did not finish as
     hookState "rotation-failed" on the hook itself. The provider may now hold a secret
     CogniRunner does not, so deliveries can be refused and the only honest remedy is to
     register the hook again. It is said in full, in red, with the action attached. */
  const rotationBroken = !!(hook && hook.hookState === "rotation-failed");

  return (
    <div className="code-repo-row">
      <div className="code-repo-head">
        <span className="code-repo">{repoId}</span>
        <span className={`code-hook ${hook ? "set" : "unset"}`}>
          {hook ? `WEBHOOK SET ${new Date(hook.createdAt).toLocaleDateString()}` : "NO WEBHOOK"}
        </span>
        {rotated && (
          <span className="code-fact"><span className="code-fact-k">Secret rotated</span><span className="code-fact-v">{new Date(rotated).toLocaleString()}</span></span>
        )}
        <div className="code-repo-actions">
          {hook
            ? <button className="btn-secondary btn-small" disabled={busy} onClick={handleRotateSecret}>{busy ? "Working…" : "Rotate secret"}</button>
            : <button className="btn-secondary btn-small" disabled={busy} onClick={handleSetupHook}>{busy ? "Registering…" : "Set up webhook"}</button>}
          <button className="btn-secondary btn-small" onClick={() => setOpenPipe((v) => !v)}>
            {openPipe ? "Hide pipeline" : "Pipeline"}
          </button>
        </div>
      </div>
      {rotationBroken && (
        <div className="code-hook-broken" role="alert">
          <span className="code-hook-broken-title">LAST SECRET ROTATION DID NOT FINISH</span>
          <span className="code-hook-broken-text">
            The secret was not fully replaced, so deliveries from {repoId} may be refused until the webhook is set up again.
          </span>
          <button className="code-hook-broken-action" disabled={busy} onClick={handleSetupHook}>
            {busy ? "Registering…" : "Set up webhook"}
          </button>
        </div>
      )}
      {!hook && (
        <p className="hint code-hook-hint">Nothing in this repository reaches CogniRunner until a webhook is registered. The secret is minted here and never shown, to anyone.</p>
      )}
      {note && <div className="code-hook-note" role="alert">{note}</div>}
      {openPipe && <PipelineCard invoke={invoke} conn={conn} repoId={repoId} onNeedIdentity={onNeedIdentity} />}
    </div>
  );
}

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

  /* A pipeline refused for `identity_required` / `consent_required` is refused by a card
     that is already on this screen, so the refusal SCROLLS to it and opens its form. */
  const identityRef = useRef(null);
  const goToIdentity = useCallback(() => {
    setShowIdentity(true);
    if (identityRef.current && identityRef.current.scrollIntoView) {
      identityRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, []);

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

                  {/* ONE ROW PER ALLOW-LISTED REPO. The allow-list is the boundary the
                      whole feature rests on, so the webhook and the pipeline hang off the
                      repository they act on and nowhere else. */}
                  <div className="code-conn-repos">
                    {c.repos.length === 0
                      ? <span className="code-repo-none">No repositories allowed. An agent can do nothing with this connection.</span>
                      : c.repos.map((r) => (
                          <RepoRow key={r} invoke={invoke} conn={c} repoId={r}
                            onChanged={load} onNeedIdentity={goToIdentity} />
                        ))}
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
      <div className="card code-card" ref={identityRef}>
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
