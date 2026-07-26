/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { invoke } from "@forge/bridge";
import Tooltip from "./Tooltip";
import CustomSelect from "./CustomSelect";
import IssuePicker from "./IssuePicker";
import AILoadingState from "./AILoadingState";

export default function LinkConfig({
  fieldId,
  setFieldId,
  fields,
  loadingFields,
  errorFields,
  linkPrompt,
  setLinkPrompt,
  linkTypeName,
  setLinkTypeName,
  maxLinks,
  setMaxLinks,
}) {
  const [showTest, setShowTest] = useState(false);
  const [testIssue, setTestIssue] = useState("");
  const [testRunning, setTestRunning] = useState(false);
  const [issueValid, setIssueValid] = useState(null);
  const [testResult, setTestResult] = useState(null);
  // Required-field error styling is gated on blur — a pristine form must not
  // open covered in red.
  const [promptTouched, setPromptTouched] = useState(false);

  const handleTest = async () => {
    setTestRunning(true);
    setTestResult(null);
    try {
      const result = await invoke("testLinkPostFunction", {
        issueKey: testIssue.trim(),
        fieldId: fieldId || "description",
        linkPrompt,
        maxLinks,
      });
      setTestResult(result);
    } catch (e) {
      setTestResult({ success: false, error: e.message, logs: [] });
    }
    setTestRunning(false);
  };

  return (
    <div className="semantic-config">
      <div className="pf-how-it-works">
        <div className="pf-how-header">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
          <strong>How it works</strong>
        </div>
        <ol className="pf-how-steps">
          <li><strong>Search</strong> — a project-scoped text search finds candidate issues (already-linked ones excluded)</li>
          <li><strong>Select</strong> — AI conservatively picks the genuinely related ones per your criteria (only from the candidates — it can never invent issue keys)</li>
          <li>Issue links of your chosen type are created automatically after the transition</li>
        </ol>
      </div>

      <div className="form-group">
        <label className="label">
          Source Field
          <Tooltip text="The field whose content the AI compares against candidates. Defaults to Description." />
        </label>
        {loadingFields ? (
          <div className="sk sk-block" style={{ height: 42 }} />
        ) : errorFields || !setFieldId ? (
          <input type="text" value={fieldId || ""} onChange={(e) => setFieldId && setFieldId(e.target.value)} placeholder="description" className="input" />
        ) : (
          <CustomSelect
            value={fieldId || "description"}
            onChange={setFieldId}
            placeholder="Source field..."
            searchable
            searchPlaceholder="Search fields..."
            options={fields.map((f) => ({ value: f.id, label: f.name, meta: f.id, type: f.type?.replace(/^(System|Custom) \(|\)$/g, ""), custom: f.custom }))}
            groups={[
              { label: "System Fields", filter: (o) => !o.custom },
              { label: "Custom Fields", filter: (o) => !!o.custom },
            ]}
          />
        )}
      </div>

      <div className="form-group">
        <label className="label">
          Relation criteria <span className="required">*</span>
          <Tooltip text="When should two issues be linked? Be specific — the AI is instructed to be conservative. e.g. 'Link issues describing the same login failure or sharing the same root cause.'" />
        </label>
        <textarea
          value={linkPrompt || ""}
          onChange={(e) => setLinkPrompt(e.target.value)}
          onBlur={() => setPromptTouched(true)}
          placeholder={'Example: "Link issues that report the same defect or are clearly blocked by this work. Same feature area alone is not enough."'}
          className={`textarea ${promptTouched && (!linkPrompt || !linkPrompt.trim()) ? "input-error" : ""}`}
          rows={4}
        />
      </div>

      <div className="form-group" style={{ display: "flex", gap: "12px" }}>
        <div style={{ flex: 1 }}>
          <label className="label">
            Link type
            <Tooltip text="The Jira issue link type name (e.g. Relates, Blocks, Duplicate). Falls back to 'Relates' if the name doesn't exist on this site." />
          </label>
          <input
            type="text"
            value={linkTypeName || ""}
            onChange={(e) => setLinkTypeName(e.target.value)}
            placeholder="Relates"
            className="input"
          />
        </div>
        <div style={{ width: "140px" }}>
          <label className="label">
            Max links
            <Tooltip text="Upper bound on links created per transition (1-5)." />
          </label>
          <CustomSelect
            value={String(maxLinks || 3)}
            onChange={(v) => setMaxLinks(Number(v))}
            options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))}
          />
        </div>
      </div>

      <div className="semantic-test-section">
        <button className="btn-semantic-test-toggle" onClick={() => setShowTest(!showTest)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          <span>{showTest ? "Hide Test" : "Test Run"}</span>
          <Tooltip text="Runs the candidate search + AI selection on a real issue — it creates NO links. Completely safe." />
        </button>

        {showTest && (
          <div className="semantic-test-panel">
            <div className="semantic-test-header">
              <span className="test-panel-badge">Dry run — no links are created</span>
            </div>
            <div className="form-group" style={{ margin: "10px 0 8px" }}>
              <label className="label" style={{ fontSize: "11px", marginBottom: "4px" }}>Test against issue</label>
              <div className="test-target-row">
                <IssuePicker value={testIssue} onChange={setTestIssue} onValidationChange={setIssueValid} />
                <button className={`btn-run-test${testRunning ? " is-busy busy-solid" : ""}`} onClick={handleTest} disabled={testRunning || !testIssue.trim() || !(linkPrompt || "").trim() || !issueValid?.valid}>
                  Run Test
                </button>
              </div>
            </div>

            {testRunning && <AILoadingState type="test" />}

            {testResult && (
              <div className={`semantic-test-result anim-rise ${testResult.success ? "st-update" : "st-error"}`}>
                <div className="st-result-header">
                  {testResult.success
                    ? <span className="test-badge test-badge-pass">{testResult.decision || "LINK"}</span>
                    : <span className="test-badge test-badge-fail">ERROR</span>}
                  <span className="test-result-meta">{testResult.executionTimeMs ? `${testResult.executionTimeMs}ms` : ""}</span>
                  <button className="test-dismiss" onClick={() => setTestResult(null)}>&times;</button>
                </div>
                {testResult.error && <div className="st-section"><strong>Error:</strong> {testResult.error}</div>}
                {testResult.proposedValue !== undefined && (
                  <div className="st-section">
                    <div className="st-section-label">Proposed links</div>
                    <pre className="st-value st-proposed">{testResult.proposedValue}</pre>
                    <p className="hint" style={{ margin: "4px 0 0" }}>No links were created. Dry run only.</p>
                  </div>
                )}
                {testResult.logs && testResult.logs.length > 0 && (
                  <div className="st-section">
                    <div className="st-section-label">Execution Log</div>
                    {testResult.logs.map((log, i) => (<div key={i} className="test-log-line"><code>{log}</code></div>))}
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
