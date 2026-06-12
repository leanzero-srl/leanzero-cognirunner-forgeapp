/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import React, { useState, useEffect, useRef } from "react";
import { invoke } from "@forge/bridge";
import Tooltip from "./Tooltip";
import CustomSelect from "./CustomSelect";
import IssuePicker from "./IssuePicker";
import DocRepository from "./DocRepository";
import ReviewPanel from "./ReviewPanel";
import AILoadingState from "./AILoadingState";

export default function SemanticConfig({
  conditionPrompt,
  setConditionPrompt,
  actionPrompt,
  setActionPrompt,
  actionFieldId,
  setActionFieldId,
  fieldId,
  setFieldId,
  fields,
  loadingFields,
  errorFields,
  selectedDocIds,
  onDocSelectionChange,
  crossCheckClaims,
  setCrossCheckClaims,
}) {
  const [showTest, setShowTest] = useState(false);
  const [testIssue, setTestIssue] = useState("");
  const [testRunning, setTestRunning] = useState(false);
  const [issueValid, setIssueValid] = useState(null); // null | { valid: true } | { valid: false }
  const [testResult, setTestResult] = useState(null);
  // Required-field error styling is gated on blur — a pristine form must not
  // open covered in red.
  const [conditionTouched, setConditionTouched] = useState(false);

  // A dry-run result describes the prompts/fields it was run with — once any
  // of those change, the old result is misleading. Clear it AND invalidate
  // any run still in flight.
  const testSeq = useRef(0);
  useEffect(() => {
    testSeq.current++;
    setTestResult(null);
  }, [conditionPrompt, actionPrompt, fieldId, actionFieldId]);

  const handleTest = async () => {
    const seq = ++testSeq.current;
    setTestRunning(true);
    setTestResult(null);
    let result;
    try {
      result = await invoke("testSemanticPostFunction", {
        issueKey: testIssue.trim(),
        fieldId: fieldId || "description",
        conditionPrompt,
        actionPrompt,
        actionFieldId,
        selectedDocIds: selectedDocIds || [],
        crossCheckClaims: !!crossCheckClaims,
      });
    } catch (e) {
      result = { success: false, error: e.message, logs: [] };
    }
    setTestRunning(false);
    // Discard a result the user has already invalidated by editing the config.
    if (seq === testSeq.current) setTestResult(result);
  };

  return (
    <div className="semantic-config">
      <div className="pf-how-it-works">
        <div className="pf-how-header">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <strong>How it works</strong>
        </div>
        <ol className="pf-how-steps">
          <li><strong>Condition</strong> — AI checks if this rule should fire</li>
          <li><strong>Action</strong> — If yes, AI generates a new value for the target field</li>
          <li>The target field is updated automatically after each transition</li>
        </ol>
      </div>

      <div className="form-group">
        <label className="label">
          Source Field
          <Tooltip text="The field the AI reads to evaluate the condition. Defaults to Description if not set. Pick the field that contains the content the AI should reason about." />
        </label>
        {loadingFields ? (
          <div className="sk sk-block" style={{ height: 42 }} />
        ) : errorFields || !setFieldId ? (
          <input
            type="text"
            value={fieldId || ""}
            onChange={(e) => setFieldId && setFieldId(e.target.value)}
            placeholder="description"
            className="input"
          />
        ) : (
          <CustomSelect
            value={fieldId || "description"}
            onChange={setFieldId}
            placeholder="Source field..."
            searchable
            searchPlaceholder="Search fields..."
            options={fields.map((f) => ({
              value: f.id,
              label: f.name,
              meta: f.id,
              type: f.type?.replace(/^(System|Custom) \(|\)$/g, ""),
              custom: f.custom,
            }))}
            groups={[
              { label: "System Fields", filter: (o) => !o.custom },
              { label: "Custom Fields", filter: (o) => !!o.custom },
            ]}
          />
        )}
        <p className="hint">
          The AI reads this field's value when evaluating the condition. Defaults to Description.
        </p>
      </div>

      <div className="form-group">
        <label className="label">
          Condition <span className="required">*</span>
          <Tooltip text="The AI reads the issue's source field and evaluates this condition. If the condition is met, the action runs. If not, the post-function is skipped." />
        </label>
        <textarea
          value={conditionPrompt}
          onChange={(e) => setConditionPrompt(e.target.value)}
          onBlur={() => setConditionTouched(true)}
          placeholder={'Example: "Run when the description mentions a bug or defect"'}
          className={`textarea ${conditionTouched && !conditionPrompt.trim() ? "input-error" : ""}`}
          rows={4}
        />
      </div>

      <div className="form-group">
        <label className="label">
          Action
          <Tooltip text="When the condition passes, the AI generates a new value for the target field based on this instruction. Leave empty to use a generic summarization." />
        </label>
        <textarea
          value={actionPrompt}
          onChange={(e) => setActionPrompt(e.target.value)}
          placeholder={'Example: "Summarize the issue into 2-3 bullet points"'}
          className="textarea"
          rows={5}
        />
      </div>

      <div className="form-group">
        <label className="label">
          Target Field <span className="required">*</span>
          <Tooltip text="The field that will be updated with the AI-generated value. Works best with text fields (Summary, Description, custom text fields)." />
        </label>
        {loadingFields ? (
          <div className="sk sk-block" style={{ height: 42 }} />
        ) : errorFields ? (
          <>
            <input
              type="text"
              value={actionFieldId}
              onChange={(e) => setActionFieldId(e.target.value)}
              placeholder="e.g., summary, customfield_10001"
              className="input"
            />
            <p className="hint" style={{ color: "var(--error-color)" }}>
              Could not load fields. Enter field ID manually.
            </p>
          </>
        ) : (
          <CustomSelect
            value={actionFieldId}
            onChange={setActionFieldId}
            placeholder="Select a field..."
            searchable
            searchPlaceholder="Search fields..."
            error={!actionFieldId}
            options={fields.map((f) => ({
              value: f.id,
              label: f.name,
              meta: f.id,
              type: f.type?.replace(/^(System|Custom) \(|\)$/g, ""),
              custom: f.custom,
            }))}
            groups={[
              { label: "System Fields", filter: (o) => !o.custom },
              { label: "Custom Fields", filter: (o) => !!o.custom },
            ]}
          />
        )}
        <p className="hint">
          The AI will update this field when the condition is met. All system and custom fields are available. Works best with text-based fields.
        </p>
      </div>

      {/* Cross-check claims (fact-check MCP) */}
      <div className="form-group">
        <label className="label">
          Cross-check claims
          <Tooltip text="When on, CogniRunner fact-checks the source field's factual claims against the live web (via the doc-processor + web-search MCPs) and feeds the cited evidence into the AI's decision. Requires both the doc-reader and web-search MCPs enabled in Settings. Best-effort with a 12s timeout — it never blocks the transition." />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px" }}>
          <input
            type="checkbox"
            checked={!!crossCheckClaims}
            onChange={(e) => setCrossCheckClaims && setCrossCheckClaims(e.target.checked)}
          />
          Verify the source field&apos;s claims against the web before deciding
        </label>
        <p className="hint">
          Adds fenced fact-check evidence (claims + sources) to the AI prompt. Requires the doc-reader and web-search MCPs (Settings → MCP Integrations).
        </p>
      </div>

      {/* Documentation Library */}
      <DocRepository
        selectedDocs={selectedDocIds || []}
        onSelectionChange={onDocSelectionChange}
      />

      {/* AI Review */}
      <ReviewPanel
        configType="postfunction-semantic"
        config={{ fieldId, conditionPrompt, actionPrompt, actionFieldId, selectedDocIds, crossCheckClaims }}
      />

      {/* Test Panel */}
      <div className="semantic-test-section">
        <button
          className="btn-semantic-test-toggle"
          onClick={() => setShowTest(!showTest)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          <span>{showTest ? "Hide Test" : "Test Run"}</span>
          <Tooltip text="Test your semantic post-function against a real issue. The AI evaluates the condition and generates a proposed value — but does NOT write it back. Completely safe." />
        </button>

        {showTest && (
          <div className="semantic-test-panel">
            <div className="semantic-test-header">
              <span className="test-panel-badge">Dry run — the target field will NOT be updated</span>
            </div>

            <div className="form-group" style={{ margin: "10px 0 8px" }}>
              <label className="label" style={{ fontSize: "11px", marginBottom: "4px" }}>
                Test against issue
              </label>
              <div className="test-target-row">
                <IssuePicker value={testIssue} onChange={setTestIssue} onValidationChange={setIssueValid} />
                <button
                  className={`btn-run-test${testRunning ? " is-busy busy-solid" : ""}`}
                  onClick={handleTest}
                  disabled={testRunning || !testIssue.trim() || !conditionPrompt.trim() || !issueValid?.valid}
                >
                  Run Test
                </button>
              </div>
            </div>

            {testRunning && <AILoadingState type="test" />}

            {/* Result */}
            {testResult && (
              <div className={`semantic-test-result anim-rise ${testResult.success ? (testResult.decision === "UPDATE" ? "st-update" : "st-skip") : "st-error"}`}>
                <div className="st-result-header">
                  {testResult.success ? (
                    <span className={`test-badge ${testResult.decision === "UPDATE" ? "test-badge-pass" : "test-badge-skip"}`}>
                      {testResult.decision}
                    </span>
                  ) : (
                    <span className="test-badge test-badge-fail">ERROR</span>
                  )}
                  <span className="test-result-meta">
                    {testResult.issueKey && `${testResult.issueKey}`}
                    {testResult.executionTimeMs ? ` — ${testResult.executionTimeMs}ms` : ""}
                    {testResult.tokensUsed ? ` — ${testResult.tokensUsed} tokens` : ""}
                  </span>
                  <button className="test-dismiss" onClick={() => setTestResult(null)}>&times;</button>
                </div>

                {testResult.error && (
                  <div className="st-section"><strong>Error:</strong> {testResult.error}</div>
                )}

                {testResult.reason && (
                  <div className="st-section">
                    <div className="st-section-label">AI Reasoning</div>
                    <div className="st-reason">{testResult.reason}</div>
                  </div>
                )}

                {testResult.sourceValue && (
                  <div className="st-section">
                    <div className="st-section-label">Source Field ({testResult.sourceField})</div>
                    <pre className="st-value">{testResult.sourceValue}</pre>
                  </div>
                )}

                {testResult.decision === "UPDATE" && testResult.proposedValue !== undefined && (
                  <div className="st-section">
                    <div className="st-section-label">Proposed Value for {testResult.targetField}</div>
                    <pre className="st-value st-proposed">{typeof testResult.proposedValue === "string" ? testResult.proposedValue : JSON.stringify(testResult.proposedValue, null, 2)}</pre>
                    <p className="hint" style={{ margin: "4px 0 0" }}>This value was NOT written. Dry run only.</p>
                  </div>
                )}

                {testResult.logs && testResult.logs.length > 0 && (
                  <div className="st-section">
                    <div className="st-section-label">Execution Log</div>
                    {testResult.logs.map((log, i) => (
                      <div key={i} className="test-log-line"><code>{log}</code></div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
