/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * PremadeRuleForm — the catalog-driven config form for premade (non-AI) workflow
 * validators/conditions. Picks a rule type from the shared catalog, renders the
 * inputs that rule needs, and reports the assembled config + validity to the
 * parent via `onChange(config, valid)`.
 *
 * Self-contained (no imports from App.js) so it can be byte-copied to
 * static/admin-panel/src/components/. Imports only React, @forge/bridge,
 * CustomSelect, and the shared catalog. REST-backed picker lists are fetched
 * once via the getRuleLists resolver.
 *
 * Props:
 *   mode      "validator" | "condition" — which catalog half to show.
 *   fields    [{ id, name, ... }] — the issue fields (loaded by the parent).
 *   initial   the saved premade config to hydrate on edit (or null for new).
 *   onChange  (config, valid) => void — config is { ruleType, ...params }.
 */
import React, { useState, useEffect, useRef } from "react";
import { invoke } from "@forge/bridge";
import CustomSelect from "./CustomSelect";
import { getCatalog, findRule, COMPARE_OPS, EXPRESSION_BACKED_CONDITIONS, CONDITION_NOT_EXPRESSIBLE_REASON, conditionFieldSupport } from "../../../../src/shared/premade-rules-catalog.js";
import { redosRisk } from "../../../../src/shared/regex-safety.js";
import { gitProviderKindMeta, normalizeRepoId } from "../../../../src/shared/git-ids.js";
import { isPermissionRefusal } from "./refusal";

// The three `prMatch` ids are the executor's vocabulary, not this form's — runGitValidator
// (src/premade-rules.js) reads exactly "property" | "branch" | "both" and treats anything
// else as "both". The labels say what each one MEANS at a transition, because the ids are
// only meaningful next to the cognirunner.git property they index.
const PR_MATCH_OPTIONS = [
  { value: "property", label: "Linked by CogniRunner", hint: "Accept the pull request CogniRunner recorded for this issue." },
  { value: "branch", label: "Branch names the issue", hint: "Only accept it if the live source branch contains the issue key." },
  { value: "both", label: "Either", hint: "Accept either of the two. The widest match, and the default." },
];

export default function PremadeRuleForm({ mode = "validator", fields = [], initial, onChange }) {
  const catalog = getCatalog(mode);

  const [ruleType, setRuleType] = useState("");
  const [fieldId, setFieldId] = useState("");
  const [regex, setRegex] = useState("");
  const [allowedValues, setAllowedValues] = useState("");
  const [op, setOp] = useState("eq");
  const [compareValue, setCompareValue] = useState("");
  const [value, setValue] = useState("");
  const [pickerValue, setPickerValue] = useState(""); // backs a `picker` param
  const [minLen, setMinLen] = useState("");
  const [maxLen, setMaxLen] = useState("");
  const [dateMode, setDateMode] = useState("future");
  const [days, setDays] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [lists, setLists] = useState({});
  const [listsError, setListsError] = useState(false); // fetch failure — kept distinct from a genuinely-empty list
  /* ---- the GIT param group (F-350) ----------------------------------------------
     FOUR keys, exactly as the catalogue docblock declares: connectionId, repo,
     prMatch, strict. The Strict helper text below is the fail-open/fail-closed table
     beside runGitValidator (src/premade-rules.js) put into words, and it describes the
     only two rows `strict` actually flips: provider unreachable, and a dead credential.
     The two rows that fail CLOSED whatever strict says — a connection id naming no row,
     and a repo that is not on that connection's allow-list — are MISCONFIGURATION, which
     is why both are picked from a list here and never typed. */
  const [connectionId, setConnectionId] = useState("");
  const [repo, setRepo] = useState("");
  const [prMatch, setPrMatch] = useState("both");
  const [strict, setStrict] = useState(false);
  /* Rich connection rows (kind, status, per-connection repo allow-list) from
     `listGitConnections`. That resolver is requireAdmin, so a workflow EDITOR gets a
     permission REFUSAL — not an outage, and not something to retry. In that case the
     form falls back to the editor-visible flat lists getRuleLists already returns
     (`gitconnections` / `gitrepos`), which carry no credential status and whose repos
     are the UNION across every connection. `gitNarrowed` is false there, and the form
     says so rather than implying a repo is allowed when only the backend knows.
     null = not fetched yet. */
  const [gitRows, setGitRows] = useState(null);
  const [gitNarrowed, setGitNarrowed] = useState(true);
  const [gitRefused, setGitRefused] = useState(false);
  const hydratedRef = useRef(false);
  // NL-to-rule builder ("Build from a description"), collapsed by default.
  const [brOpen, setBrOpen] = useState(false);
  const [nlText, setNlText] = useState("");
  const [buildState, setBuildState] = useState("idle"); // idle | loading | done | degraded | error
  const [buildExplanation, setBuildExplanation] = useState("");
  const [buildReason, setBuildReason] = useState("");
  const [buildUnresolved, setBuildUnresolved] = useState([]);

  // Fetch REST-backed picker lists once (issue types / statuses / resolutions / link types / priorities).
  // A fetch failure is kept distinct from a genuinely-empty list so the picker can offer Retry
  // instead of silently reading as "None available" (which would look like the list has no options).
  const loadLists = () => {
    setListsError(false);
    invoke("getRuleLists")
      .then((res) => { if (res?.success) setLists(res.lists || {}); else setListsError(true); })
      .catch(() => setListsError(true));
  };
  useEffect(() => { loadLists(); }, []);

  // The rich git rows, fetched once. A permission refusal is a SETTLED answer (the
  // reader is not a CogniRunner admin) and leaves gitRows as an empty array so the
  // fallback below takes over; any other failure does the same, because a git rule
  // with no pickable connection is unfinished config, which the executor ALLOWS.
  const gitLoadedRef = useRef(false);
  const loadGitConnections = () => {
    if (gitLoadedRef.current) return;
    gitLoadedRef.current = true;
    invoke("listGitConnections")
      .then((res) => {
        if (res?.success && Array.isArray(res.connections)) { setGitRows(res.connections); setGitNarrowed(true); }
        // A refusal and an outage both land here; neither can narrow a repo list, and
        // isPermissionRefusal is what tells them apart for the note the picker shows.
        else { setGitRows([]); setGitNarrowed(false); setGitRefused(isPermissionRefusal(res)); }
      })
      .catch(() => { setGitRows([]); setGitNarrowed(false); });
  };

  // Hydrate from a saved config exactly once (on edit).
  useEffect(() => {
    if (hydratedRef.current || !initial) return;
    hydratedRef.current = true;
    const rt = initial.ruleType || "";
    setRuleType(rt);
    setFieldId(initial.fieldId || "");
    setRegex(initial.regex || "");
    setAllowedValues(initial.allowedValues || "");
    setOp(initial.op || "eq");
    setCompareValue(initial.compareValue || "");
    setValue(initial.value || "");
    const pk = findRule(mode, rt)?.params?.picker?.key;
    setPickerValue(pk ? initial[pk] || "" : "");
    setMinLen(initial.min != null ? String(initial.min) : "");
    setMaxLen(initial.max != null ? String(initial.max) : "");
    setDateMode(initial.mode || "future");
    setDays(initial.days != null ? String(initial.days) : "");
    setConnectionId(initial.connectionId || "");
    setRepo(initial.repo || "");
    setPrMatch(initial.prMatch === "property" || initial.prMatch === "branch" ? initial.prMatch : "both");
    setStrict(initial.strict === true);
    setErrorMessage(initial.errorMessage || "");
  }, [initial, mode]);

  const rule = findRule(mode, ruleType);
  const p = rule?.params || {};
  // A condition is evaluated by Jira as a Jira expression, not by our backend, so
  // only the types the manifest expression implements are real. Offering any other
  // one would silently allow every transition.
  const notExpressible = mode === "condition" && !!ruleType && !EXPRESSION_BACKED_CONDITIONS.includes(ruleType);
  const unavailable = rule?.availability === "unavailable" || notExpressible;
  const unavailableWhy = notExpressible ? CONDITION_NOT_EXPRESSIBLE_REASON : rule?.unavailableReason;

  // Field-based CONDITION types: the expression can only evaluate custom fields
  // of a live-probed kind (see CONDITION_FIELD_KINDS). Resolve the picked field's
  // support ONCE here — it drives the config keys (exprProp/exprKind), the
  // refusal note, and validity. conditionFieldSupport is the single source.
  const isFieldCondition = mode === "condition"
    && (ruleType === "field-has-value" || ruleType === "field-empty" || ruleType === "field-equals");
  const pickedField = p.field ? fields.find((f) => f.id === fieldId) : null;
  const fieldSupport = isFieldCondition && pickedField
    ? conditionFieldSupport(pickedField, ruleType)
    : null;

  // Build the config object + validity from the current state.
  const fieldName = (pickedField || fields.find((f) => f.id === fieldId) || {}).name || "";
  // conditionKind tells the manifest expression this config is one it should
  // evaluate. Without it the expression falls through to "allow" — which is what
  // keeps every pre-existing condition behaving exactly as before.
  const config = mode === "condition" ? { ruleType, conditionKind: "deterministic" } : { ruleType };
  if (p.field) {
    config.fieldId = fieldId;
    config.fieldName = fieldName;
  }
  if (fieldSupport && fieldSupport.exprProp) {
    // The expression only ever indexes `issue` with exprProp, only ever runs the
    // typed comparison exprKind names, and falls open without both — so these
    // keys ARE the safety contract, resolved at save time from the field schema.
    config.exprProp = fieldSupport.exprProp;
    config.exprKind = fieldSupport.exprKind;
    // Number equals compares typed (expression == is strict): carry the value as
    // a real JSON number too. The expression ignores a non-finite/absent one.
    if (ruleType === "field-equals" && fieldSupport.exprKind === "num" && value.trim() !== "" && Number.isFinite(Number(value))) {
      config.valueNum = Number(value);
    }
  }
  if (p.regex) config.regex = regex.trim();
  if (p.allowed) config.allowedValues = allowedValues.trim();
  if (p.opValue) {
    config.op = op;
    config.compareValue = compareValue.trim();
  }
  if (p.value) config.value = value.trim();
  // Set the picker key ONLY when chosen — an optional picker (link type) left blank must OMIT the key
  // so the executor's "any" branch (config.x == null) fires (an empty string would not equal null).
  if (p.picker && pickerValue.trim()) config[p.picker.key] = pickerValue.trim();
  if (p.lengthBounds) {
    if (minLen.trim() !== "") config.min = Number(minLen);
    if (maxLen.trim() !== "") config.max = Number(maxLen);
  }
  if (p.dateRel) {
    config.mode = dateMode;
    if (dateMode === "within" && days.trim() !== "") config.days = Number(days);
  }
  if (p.git) {
    config.connectionId = connectionId;
    // normalizeRepoId is the SINGLE way a repo id is written down (src/shared/git-ids.js).
    // The picker already offers normalised values; running it here means a hydrated legacy
    // value or an AI draft cannot save a differently-cased id that isRepoAllowed would
    // then reject — which fails CLOSED and would read as "this rule is broken".
    config.repo = normalizeRepoId(repo);
    config.prMatch = prMatch;
    config.strict = strict === true;
  }
  if (mode === "validator" && errorMessage.trim()) config.errorMessage = errorMessage.trim();

  // ReDoS guard: block saving a catastrophic-backtracking pattern (e.g. (a+)+) — it would hang the
  // 25s validator budget for every reporter at runtime.
  const regexRisk = p.regex && regex.trim() ? redosRisk(regex.trim()) : null;

  let valid = !!ruleType && !unavailable;
  if (p.field && !fieldId) valid = false;
  // A field condition may only save with a supported field resolved: no
  // exprProp/exprKind means the expression would fall open — a rule that saves
  // but never gates is exactly the fiction this feature replaced.
  if (isFieldCondition && fieldId && (!fieldSupport || fieldSupport.unsupported)) valid = false;
  // Number equals must carry a real number.
  if (isFieldCondition && ruleType === "field-equals" && fieldSupport?.exprKind === "num"
      && value.trim() !== "" && !Number.isFinite(Number(value))) valid = false;
  if (p.regex && !regex.trim()) valid = false;
  if (regexRisk) valid = false;
  if (p.allowed && !allowedValues.trim()) valid = false;
  if (p.opValue && !compareValue.trim()) valid = false;
  if (p.value && !value.trim()) valid = false;
  if (p.picker && !p.picker.optional && !pickerValue.trim()) valid = false;
  if (p.lengthBounds && minLen.trim() === "" && maxLen.trim() === "") valid = false; // need at least one bound
  // Both bounds present but inverted (min > max) matches NOTHING at runtime → the validator
  // would block EVERY value on every transition. Refuse to save it (a common transposed-numbers slip).
  const boundsInverted = p.lengthBounds && minLen.trim() !== "" && maxLen.trim() !== "" && Number(minLen) > Number(maxLen);
  if (boundsInverted) valid = false;
  if (p.dateRel && dateMode === "within" && !(Number(days) > 0)) valid = false; // within needs a positive day count
  // Both git keys are required. Without them runGitValidator returns allow("not-configured")
  // — a gate that saves and then permits everything, which is the fiction F-350 is about.
  if (p.git && (!connectionId.trim() || !normalizeRepoId(repo))) valid = false;

  /* ---- git derived values ---------------------------------------------------------
     One place decides what rows the two pickers see. `gitRows` (admin, rich) wins; the
     fallback is built from the flat lists getRuleLists already returns to editors. The
     fallback's repos are the UNION across connections, so it cannot narrow — which is
     exactly what `gitNarrowed:false` says to the reader below. */
  // Fetched only once a git rule is actually picked — a non-admin opening any other
  // premade rule must never see a permission refusal it did not provoke.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (p.git) loadGitConnections(); }, [!!p.git]);
  const gitConnections = (gitRows && gitRows.length) || gitNarrowed
    ? (gitRows || [])
    : (lists.gitconnections || []).map((o) => ({ id: o.value, label: o.label, kind: null, status: "ok", repos: [] }));
  const gitConn = gitConnections.find((c) => c.id === connectionId) || null;
  const gitConnDead = !!gitConn && gitConn.status === "auth_dead";
  // The repo allow-list of the CHOSEN connection. Nothing is offered before a connection
  // is chosen: a repository is only meaningful inside one, and the executor fails CLOSED
  // on a repo that connection may not read.
  const gitRepoOptions = gitNarrowed
    ? (gitConn ? (gitConn.repos || []) : [])
    : (connectionId ? (lists.gitrepos || []).map((o) => o.value) : []);

  // Report up whenever config/valid actually change. Use a ref for onChange so the
  // effect doesn't loop on the parent's inline callback identity.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const configKey = JSON.stringify({ config, valid });
  useEffect(() => {
    onChangeRef.current?.(config, valid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configKey]);

  // Switching the rule type clears params that don't apply (the error message persists — it's a
  // validator-wide message, not rule-specific).
  const onRuleType = (v) => {
    setRuleType(v);
    setFieldId("");
    setRegex("");
    setAllowedValues("");
    setOp("eq");
    setCompareValue("");
    setValue("");
    setPickerValue("");
    setMinLen("");
    setMaxLen("");
    setDateMode("future");
    setDays("");
    setConnectionId("");
    setRepo("");
    setPrMatch("both");
    // Strict resets to OFF, never carried across rule types: arming the fail-CLOSED
    // behaviour on a transition is always an explicit choice (build-rule.js says the
    // same about the AI draft).
    setStrict(false);
  };

  // Apply a validated AI draft to the form via the setters (never saves). Numerics
  // are String()-coerced to match the string-typed state (min/max/days render via
  // .trim()) — mirrors the hydrate effect; a number here would crash the render.
  const applyDraft = (built) => {
    setRuleType(built.ruleType || "");
    setFieldId(built.fieldId || "");
    setRegex(built.regex || "");
    setAllowedValues(built.allowedValues || "");
    setOp(built.op || "eq");
    setCompareValue(built.compareValue || "");
    setValue(built.value || "");
    setPickerValue(built.pickerValue || "");
    setMinLen(built.min != null ? String(built.min) : "");
    setMaxLen(built.max != null ? String(built.max) : "");
    setDateMode(built.dateMode || "future");
    setDays(built.days != null ? String(built.days) : "");
    // The git group: validateBuiltRule only ever emits a connectionId/repo the CALLER
    // supplied, and leaves anything it could not resolve in `unresolved` for the human —
    // so an unresolved one must land as "" (an empty picker the user must fill), never
    // as a half-real value.
    setConnectionId(built.connectionId || "");
    setRepo(built.repo || "");
    setPrMatch(built.prMatch === "property" || built.prMatch === "branch" ? built.prMatch : "both");
    setStrict(built.strict === true);
    // errorMessage persists (validator-wide) — not cleared.
  };

  // One AI call per explicit Build click. Grounds the AI on exactly the field/list
  // options the user's own dropdowns show, so it can only reference real values.
  const runBuild = async () => {
    if (buildState === "loading" || nlText.trim().length < 5) return;
    setBuildState("loading");
    setBuildExplanation("");
    setBuildUnresolved([]);
    try {
      const result = await invoke("buildRule", {
        mode,
        description: nlText,
        fields: fields.map((f) => ({ id: f.id, name: f.name })),
        lists,
      });
      if (result && result.degraded) {
        setBuildReason(result.reason || "error");
        setBuildState("degraded");
      } else if (result && result.success && result.built) {
        applyDraft(result.built);
        setBuildExplanation(result.explanation || "");
        setBuildUnresolved(Array.isArray(result.unresolved) ? result.unresolved : []);
        setBuildState("done");
      } else {
        setBuildReason((result && result.error) || "");
        setBuildState("error");
      }
    } catch (e) {
      console.error("Build rule failed:", e);
      setBuildState("error");
    }
  };

  return (
    <div className="pr-form">
      {/* Build from a description (NL-to-rule) — collapsed by default; applies a
          reviewable draft to the form below, never saves. */}
      <div className="br-bar">
        <button type="button" className={`br-toggle${brOpen ? " open" : ""}`} onClick={() => setBrOpen((o) => !o)}>
          <span className="br-toggle-caret">▸</span> Build from a description
          <span className="br-toggle-hint">let AI pick the rule for you</span>
        </button>
        {brOpen && (
          <div className="br-body">
            <textarea
              className="br-input"
              value={nlText}
              onChange={(e) => setNlText(e.target.value)}
              placeholder="Describe the rule in plain English, e.g. “require the Rollback Plan field to be filled in”…"
              rows={2}
            />
            <button
              type="button"
              className={`br-btn${buildState === "loading" ? " is-busy busy-solid" : ""}`}
              onClick={runBuild}
              disabled={buildState === "loading" || nlText.trim().length < 5}
            >
              ✦ Build rule
            </button>
            {buildState === "done" && (
              <div className="br-card">
                <div className="br-eyebrow">§ WHAT I BUILT</div>
                {buildExplanation && <div className="br-summary">{buildExplanation}</div>}
                <div className="br-applied">Applied below — review and save.</div>
                {buildUnresolved.length > 0 && (
                  <div className="br-hint">Still needs: {buildUnresolved.join(", ")}.</div>
                )}
              </div>
            )}
            {buildState === "degraded" && (
              <div className="br-note">
                {buildReason === "lmstudio"
                  ? "Rule-building isn't available with the self-hosted LM Studio provider — switch to a hosted provider in CogniRunner Settings."
                  : buildReason === "timeout"
                  ? "The AI provider didn't respond in time — try again in a moment."
                  : "Couldn't build a rule right now — try again in a moment."}
              </div>
            )}
            {buildState === "error" && (
              <div className="br-note">{buildReason || "Couldn't match a premade rule to that description — try rephrasing."}</div>
            )}
          </div>
        )}
      </div>

      <div className="form-group">
        <label className="label">Rule <span className="required">*</span></label>
        <CustomSelect
          value={ruleType}
          onChange={onRuleType}
          searchable
          placeholder="Choose a premade rule…"
          options={catalog.map((r) => {
            // Tell the story IN the dropdown, not only after selection: any type
            // the manifest expression can't evaluate — anything needing related-
            // issue / attachment / group data — is annotated as unavailable right
            // here, so the picker never presents an option that silently won't
            // save. (The field-based trio now ships — its support is per FIELD,
            // annotated in the field picker below instead.)
            let meta = r.availability === "unavailable" ? "Use a Jira built-in" : undefined;
            if (mode === "condition" && !EXPRESSION_BACKED_CONDITIONS.includes(r.key)) {
              meta = "Not available as a condition";
            }
            return { value: r.key, label: r.label, meta };
          })}
        />
        {rule && !unavailable && <p className="hint">{rule.help}</p>}
      </div>

      {unavailable && (
        <div className="pr-note">{unavailableWhy}</div>
      )}

      {!unavailable && mode === "validator" && ruleType === "field-changed" && (
        <div className="pr-note">
          The field must be on this transition's screen. If it isn't, the transition is blocked for
          everyone — choose a field shown on the transition screen.
        </div>
      )}
      {!unavailable && mode === "validator" && ruleType === "comment-required" && (
        <div className="pr-note">
          The Comment field must be on this transition's screen, or no comment can be entered and it
          blocks for everyone.
        </div>
      )}
      {!unavailable && mode === "condition" && ruleType === "field-equals" && (
        <p className="hint">
          For a multi-value field like Labels, use “Field has a value” instead.
        </p>
      )}

      {!unavailable && p.field && (
        <div className="form-group">
          <label className="label">Field <span className="required">*</span></label>
          <CustomSelect
            value={fieldId}
            onChange={setFieldId}
            searchable
            placeholder="Choose a field…"
            options={fields.map((f) => {
              // Field conditions support only custom fields of live-verified
              // kinds — say so on the option itself, not after selection.
              let meta = f.id;
              if (isFieldCondition && conditionFieldSupport(f, ruleType).unsupported) {
                meta = "Not supported for conditions";
              }
              return { value: f.id, label: f.name, meta };
            })}
          />
          {fieldSupport?.unsupported && (
            <div className="pr-note">{fieldSupport.unsupported}</div>
          )}
        </div>
      )}

      {!unavailable && p.regex && (
        <div className="form-group">
          <label className="label">Pattern (regular expression) <span className="required">*</span></label>
          <input
            className="input pr-mono"
            placeholder="e.g. ^[A-Z]{2,4}-\d+$"
            value={regex}
            onChange={(e) => setRegex(e.target.value)}
          />
          {regexRisk && (
            <div style={{ marginTop: "6px", fontSize: "12px", fontWeight: 600, color: "var(--error-color)" }}>
              {regexRisk}
            </div>
          )}
        </div>
      )}

      {!unavailable && p.allowed && (
        <div className="form-group">
          <label className="label">
            Allowed values <span className="pr-opt">comma-separated</span> <span className="required">*</span>
          </label>
          <input
            className="input"
            placeholder="e.g. Approved, Signed off, Released"
            value={allowedValues}
            onChange={(e) => setAllowedValues(e.target.value)}
          />
        </div>
      )}

      {!unavailable && p.opValue && (
        <div className="pr-row2">
          <div className="form-group">
            <label className="label">Operator</label>
            <CustomSelect value={op} onChange={setOp} options={COMPARE_OPS} />
          </div>
          <div className="form-group">
            <label className="label">Value <span className="required">*</span></label>
            <input className="input" placeholder="e.g. 1" value={compareValue} onChange={(e) => setCompareValue(e.target.value)} />
          </div>
        </div>
      )}

      {!unavailable && p.value && (
        <div className="form-group">
          <label className="label">Value <span className="pr-opt">case-insensitive</span> <span className="required">*</span></label>
          <input className="input" placeholder="e.g. Approved" value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
      )}

      {!unavailable && p.lengthBounds && (
        <>
          <div className="pr-row2">
            <div className="form-group">
              <label className="label">Min <span className="pr-opt">optional</span></label>
              <input className={`input ${boundsInverted ? "input-error" : ""}`} type="number" min="0" placeholder="e.g. 10" value={minLen} onChange={(e) => setMinLen(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="label">Max <span className="pr-opt">optional</span></label>
              <input className={`input ${boundsInverted ? "input-error" : ""}`} type="number" min="0" placeholder="e.g. 255" value={maxLen} onChange={(e) => setMaxLen(e.target.value)} />
            </div>
          </div>
          {boundsInverted && <div className="br-hint">Min must not be greater than Max — a rule with Min above Max matches nothing and would block every transition.</div>}
        </>
      )}

      {!unavailable && p.dateRel && (
        <>
          <div className="pr-row2">
            <div className="form-group">
              <label className="label">Must be</label>
              <CustomSelect
                value={dateMode}
                onChange={setDateMode}
                options={[
                  { value: "future", label: "in the future" },
                  { value: "within", label: "within N days" },
                ]}
              />
            </div>
            {dateMode === "within" && (
              <div className="form-group">
                <label className="label">Days from today <span className="required">*</span></label>
                <input className="input" type="number" min="1" placeholder="e.g. 30" value={days} onChange={(e) => setDays(e.target.value)} />
              </div>
            )}
          </div>
          <p className="hint">Pick a date or date-time field above. Times are compared in UTC by calendar day.</p>
        </>
      )}

      {!unavailable && p.picker && (() => {
        const opts = lists[p.picker.source] || [];
        // A saved value missing from the freshly-fetched list (perms/pagination) would render as the
        // placeholder — keep it visible + selected so an edit doesn't look blank or lose the value.
        const shown = pickerValue && !opts.some((o) => o.value === pickerValue)
          ? [{ value: pickerValue, label: `${pickerValue} (saved)` }, ...opts]
          : opts;
        return (
          <div className="form-group">
            <label className="label">
              {p.picker.label} {p.picker.optional ? <span className="pr-opt">optional</span> : <span className="required">*</span>}
            </label>
            <CustomSelect
              value={pickerValue}
              onChange={setPickerValue}
              searchable
              options={shown}
              placeholder={listsError ? "Couldn't load options — Retry below" : (!opts.length ? "None available — check your permissions" : p.picker.ph)}
            />
            {listsError && (
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "6px", fontSize: "12px", color: "var(--error-color)" }}>
                <span>Couldn't load these options.</span>
                <button type="button" className="btn-retry" onClick={loadLists}>Retry</button>
              </div>
            )}
          </div>
        );
      })()}

      {/* ---- the GIT param group (F-350) ------------------------------------------
          Connection → repository → what counts as "the" pull request → strict. Both
          identifiers are PICKED, never typed, because the two ways they can be wrong
          (a connection that no longer exists, a repo off its allow-list) fail CLOSED
          at the transition whatever `strict` says. No native select, no rail, no tint:
          solid chips, a solid segmented control, and a solid red block for a dead
          credential — the same treatment the admin Code tab gives it. */}
      {!unavailable && p.git && (
        <>
          <div className="form-group">
            <label className="label">Git connection <span className="required">*</span></label>
            <CustomSelect
              value={connectionId}
              onChange={(v) => { setConnectionId(v); setRepo(""); }}
              searchable
              placeholder={gitConnections.length ? "Choose a git connection…" : "No git connections — an admin adds them in CogniRunner Settings → Code"}
              options={gitConnections.map((c) => ({
                value: c.id,
                label: c.label || c.id,
                // CustomSelect renders text, not markup, so the KIND rides the option as
                // `type` and the solid chip is drawn for the CHOSEN row below. Widening
                // CustomSelect to take JSX would fork a deliberately-diverged component.
                type: c.kind ? gitProviderKindMeta(c.kind).label : undefined,
                meta: c.status === "auth_dead" ? "credential dead" : undefined,
              }))}
            />
            {gitConn && (
              <div className="pr-git-chosen">
                {gitConn.kind && (
                  <span className={`pr-git-kind pr-git-kind-${gitProviderKindMeta(gitConn.kind).id}`}>
                    {gitProviderKindMeta(gitConn.kind).label}
                  </span>
                )}
                <span className="pr-git-chosen-label">{gitConn.label || gitConn.id}</span>
              </div>
            )}
            {gitConnDead && (
              /* Solid red, white text, loud — a dead credential means every rule on this
                 connection has silently stopped, which must never be whispered. Same words
                 and same weights as the Code tab's `.code-dead`; a separate class because
                 this component is byte-copied into admin-panel, where `.code-dead` already
                 has its own home in injectStyles() and a second copy would be one rule in
                 two places. */
              <div className="pr-git-dead" role="alert">
                <span className="pr-git-dead-title">This credential is dead</span>
                <span className="pr-git-dead-text">
                  {gitConn.authDeadReason || "The provider rejected it."} This rule cannot check anything until an admin replaces the credential in Settings → Code.
                </span>
              </div>
            )}
          </div>

          <div className="form-group">
            <label className="label">Repository <span className="required">*</span></label>
            <CustomSelect
              value={repo}
              onChange={setRepo}
              searchable
              placeholder={
                !connectionId ? "Choose a connection first…"
                  : gitRepoOptions.length ? "Choose a repository…"
                  : "This connection allows no repositories"
              }
              options={gitRepoOptions.map((r) => ({ value: r, label: r }))}
            />
            {connectionId && !gitNarrowed && (
              <p className="hint">
                {gitRefused
                  ? "You are not a CogniRunner admin, so this list is every repository across all connections rather than just this one's."
                  : "The per-connection repository list could not be read, so this list is every repository across all connections."}
                {" "}If the repository is not on this connection's allow-list, the transition is blocked until an admin adds it.
              </p>
            )}
          </div>

          <div className="form-group">
            <label className="label">Which pull request counts</label>
            <div className="pr-seg" role="radiogroup" aria-label="Which pull request counts">
              {PR_MATCH_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={prMatch === o.value}
                  className={`pr-seg-btn${prMatch === o.value ? " active" : ""}`}
                  onClick={() => setPrMatch(o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <p className="hint">{(PR_MATCH_OPTIONS.find((o) => o.value === prMatch) || PR_MATCH_OPTIONS[2]).hint}</p>
          </div>

          <div className="form-group">
            <label className="pr-git-toggle-row">
              <input type="checkbox" checked={strict} onChange={(e) => setStrict(e.target.checked)} />
              <span className="pr-git-toggle-label">Strict</span>
            </label>
            <p className="hint">
              {strict
                ? "If GitHub or Bitbucket cannot be reached, the transition is blocked until the connection works again."
                : "If GitHub or Bitbucket cannot be reached, the transition is allowed and a banner shows why."}
            </p>
          </div>
        </>
      )}

      {!unavailable && mode === "validator" && (
        <div className="form-group">
          <label className="label">Error message <span className="pr-opt">shown to the user if blocked</span></label>
          <input
            className="input"
            placeholder={`Default: “${fieldName || "This field"} …”`}
            value={errorMessage}
            onChange={(e) => setErrorMessage(e.target.value)}
          />
        </div>
      )}

      {!unavailable && !valid && ruleType && <p className="hint">Fill in the rule's details to finish.</p>}

      <p className="hint pr-foot">
        {mode === "condition"
          ? "If the rule isn't met, the transition is hidden (no message). If the check can't run, the transition is shown (it never silently hides one). No AI is used."
          : p.git && strict
          // Strict is the admin opting OUT of the app-wide fail-OPEN contract for this one
          // rule, so the footer must stop promising the opposite (it is the sentence a
          // reader trusts when the gate starts refusing during an outage).
          ? "If the rule isn't met, the transition is blocked and your message is shown. Strict is on, so the transition is also blocked while the provider can't be reached. No AI is used."
          : "If the rule isn't met, the transition is blocked and your message is shown. If the check can't run, the transition is allowed (it never traps the issue). No AI is used."}
      </p>
    </div>
  );
}
