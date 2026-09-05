/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { invoke } from "@forge/bridge";
import FunctionBlock from "./FunctionBlock";
import Tooltip from "./Tooltip";
import ReviewPanel from "./ReviewPanel";

const MAX_FUNCTIONS = 50;

let funcCounter = 1;

// Module-level cached promise — getFields is fetched at most once per page
// load no matter how many FunctionBuilder instances mount. A failure must
// NOT stay cached (it would kill field completions for the whole session),
// so the cache is cleared and the next mount retries.
let fieldsPromise = null;
function loadFields() {
  if (!fieldsPromise) {
    fieldsPromise = invoke("getFields")
      .then((result) => {
        if (!result || !result.success) fieldsPromise = null;
        return result;
      })
      .catch((e) => {
        fieldsPromise = null;
        throw e;
      });
  }
  return fieldsPromise;
}

function createEmptyFunction() {
  const num = funcCounter++;
  return {
    id: `func_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    name: "",
    conditionPrompt: "",
    operationType: "work_item_query",
    operationPrompt: "",
    endpoint: "",
    method: "GET",
    variableName: `result${num}`,
    code: "",
    includeBackoff: false,
  };
}

// codegenContext: extra fields spread into generate/fix payloads (runtime: "listener"|"job",
// eventTypes, schedule, scopeJql) so the AI knows which sandbox context the steps run in.
// testContext: spread into the dry-run's api.context (event, eventType, job facts).
// reviewConfigType: the AI-review flavour (defaults to the static post-function).
export default function FunctionBuilder({ functions, setFunctions, runAsync = false, setRunAsync, codegenContext = null, testContext = null, reviewConfigType = "postfunction-static", howItWorks = true }) {
  // Jira fields for editor completions (custom-field write formats etc.)
  const [fields, setFields] = useState([]);

  useEffect(() => {
    let cancelled = false;
    loadFields()
      .then((result) => {
        if (!cancelled && result && result.success) setFields(result.fields || []);
      })
      .catch(() => { /* completions degrade gracefully without fields */ });
    return () => { cancelled = true; };
  }, []);

  // Functional updates — async flows (generate/fix) call onUpdate from stale
  // closures, so updates must always be applied against the latest state.
  const addFunction = () => {
    setFunctions((prev) =>
      prev.length >= MAX_FUNCTIONS ? prev : [...prev, createEmptyFunction()],
    );
  };

  const removeFunction = (id) => {
    setFunctions((prev) =>
      prev.length <= 1 ? prev : prev.filter((f) => f.id !== id),
    );
  };

  const updateFunction = (id, updates) => {
    setFunctions((prev) => prev.map((f) => f.id === id ? { ...f, ...updates } : f));
  };

  return (
    <div className="function-builder">
      {/* How it works banner */}
      {howItWorks && <div className="pf-how-it-works">
        <div className="pf-how-header">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <strong>How it works</strong>
        </div>
        <ol className="pf-how-steps">
          <li><strong>Describe</strong> what each step should do in plain language</li>
          <li><strong>Generate</strong> — AI writes the JavaScript code for you</li>
          <li><strong>Test</strong> — dry-run safely against real data</li>
          <li><strong>Fix</strong> — one-click AI repair when a test fails</li>
          <li><strong>Learns</strong> — every fix becomes a memory that improves future generations</li>
        </ol>
      </div>}

      {functions.map((fn, i) => (
        <FunctionBlock
          key={fn.id}
          index={i}
          functionData={fn}
          priorSteps={functions.slice(0, i)}
          fields={fields}
          onUpdate={(updates) => updateFunction(fn.id, updates)}
          onRemove={removeFunction}
          isOnly={functions.length === 1}
          codegenContext={codegenContext}
          testContext={testContext}
        />
      ))}

      <button
        className="btn-add-function"
        onClick={addFunction}
        disabled={functions.length >= MAX_FUNCTIONS}
      >
        + Add Another Step
        {functions.length >= MAX_FUNCTIONS && " (max reached)"}
      </button>

      {functions.length > 1 && (
        <p className="hint" style={{ marginTop: "8px", textAlign: "center" }}>
          Steps run in order. If a step fails, later steps can still run; completed changes are not rolled back. The run is marked failed. Use{" "}
          <Tooltip text="Each step can store its return value in a named variable. Later steps can reference it using ${variableName} in their code.">
            <code style={{ cursor: "help" }}>{"${variableName}"}</code>
          </Tooltip>
          {" "}to pass results between steps.
        </p>
      )}

      {/* Run-in-background (async) option — for heavy multi-step / many-call logic */}
      {typeof setRunAsync === "function" && (
        <label style={{ display: "flex", alignItems: "flex-start", gap: "10px", marginTop: "14px", paddingTop: "14px", borderTop: "1px solid var(--border-color, #e2e8f0)", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={!!runAsync}
            onChange={(e) => setRunAsync(e.target.checked)}
            style={{ marginTop: "2px", width: "16px", height: "16px", flexShrink: 0 }}
          />
          <span>
            <span style={{ display: "block", fontSize: "13px", fontWeight: 600 }}>Run in the background (longer budget)</span>
            <span style={{ display: "block", fontSize: "12px", color: "var(--text-muted, #64748b)", marginTop: "3px" }}>
              <strong>Off</strong> (default): runs inline during the transition, bounded by Jira's hard ~25&nbsp;s post-function limit. <strong>On</strong>: runs on the async queue with up to ~110&nbsp;s — for heavy multi-step or many-call logic. The transition completes immediately and the steps finish a few seconds later (eventually consistent).
            </span>
          </span>
        </label>
      )}

      {/* AI Review for the entire static post-function */}
      <ReviewPanel
        configType={reviewConfigType}
        config={{ functions }}
      />
    </div>
  );
}
