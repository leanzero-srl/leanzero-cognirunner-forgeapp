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
import { getCatalog, findRule, COMPARE_OPS, EXPRESSION_BACKED_CONDITIONS, CONDITION_NOT_EXPRESSIBLE_REASON } from "../../../../src/shared/premade-rules-catalog.js";
import { redosRisk } from "../../../../src/shared/regex-safety.js";

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

  // Build the config object + validity from the current state.
  const fieldName = (fields.find((f) => f.id === fieldId) || {}).name || "";
  // conditionKind tells the manifest expression this config is one it should
  // evaluate. Without it the expression falls through to "allow" — which is what
  // keeps every pre-existing condition behaving exactly as before.
  const config = mode === "condition" ? { ruleType, conditionKind: "deterministic" } : { ruleType };
  if (p.field) {
    config.fieldId = fieldId;
    config.fieldName = fieldName;
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
  if (mode === "validator" && errorMessage.trim()) config.errorMessage = errorMessage.trim();

  // ReDoS guard: block saving a catastrophic-backtracking pattern (e.g. (a+)+) — it would hang the
  // 25s validator budget for every reporter at runtime.
  const regexRisk = p.regex && regex.trim() ? redosRisk(regex.trim()) : null;

  let valid = !!ruleType && !unavailable;
  if (p.field && !fieldId) valid = false;
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
          options={catalog.map((r) => ({
            value: r.key,
            label: r.label,
            meta: r.availability === "unavailable" ? "Use a Jira built-in" : undefined,
          }))}
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
          Compares a single value (case-insensitive). For a multi-value field like Labels, use “Field
          has a value” instead.
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
            options={fields.map((f) => ({ value: f.id, label: f.name, meta: f.id }))}
          />
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
          : "If the rule isn't met, the transition is blocked and your message is shown. If the check can't run, the transition is allowed (it never traps the issue). No AI is used."}
      </p>
    </div>
  );
}
