/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import React, { useState } from "react";
import { invoke } from "@forge/bridge";
import Tooltip from "./Tooltip";
import CustomSelect from "./CustomSelect";
import IssuePicker from "./IssuePicker";

export default function CommentConfig({
  fieldId,
  setFieldId,
  fields,
  loadingFields,
  errorFields,
  commentPrompt,
  setCommentPrompt,
}) {
  const [showTest, setShowTest] = useState(false);
  const [testIssue, setTestIssue] = useState("");
  const [testRunning, setTestRunning] = useState(false);
  const [issueValid, setIssueValid] = useState(null);
  const [testResult, setTestResult] = useState(null);

  const handleTest = async () => {
    setTestRunning(true);
    setTestResult(null);
    try {
      const result = await invoke("testCommentPostFunction", {
        issueKey: testIssue.trim(),
        fieldId: fieldId || "description",
        commentPrompt,
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
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <strong>How it works</strong>
        </div>
        <ol className="pf-how-steps">
          <li><strong>Read</strong> — AI reads the source field</li>
          <li><strong>Draft</strong> — AI writes a comment from your instructions</li>
          <li>The comment is posted on the issue automatically after the transition</li>
        </ol>
      </div>

      <div className="form-group">
        <label className="label">
          Source Field
          <Tooltip text="The field the AI reads to write the comment. Defaults to Description." />
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
          Comment instructions <span className="required">*</span>
          <Tooltip text="What the AI should write in the comment. e.g. 'Summarize the change and flag any blockers in 1-2 sentences.'" />
        </label>
        <textarea
          value={commentPrompt || ""}
          onChange={(e) => setCommentPrompt(e.target.value)}
          placeholder={'Example: "Post a brief status update summarizing what changed and what is next."'}
          className={`textarea ${!commentPrompt || !commentPrompt.trim() ? "input-error" : ""}`}
          rows={4}
        />
      </div>

      <div className="semantic-test-section">
        <button className="btn-semantic-test-toggle" onClick={() => setShowTest(!showTest)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          <span>{showTest ? "Hide Test" : "Test Run"}</span>
          <Tooltip text="Drafts the comment from a real issue — it does NOT post anything. Completely safe." />
        </button>

        {showTest && (
          <div className="semantic-test-panel">
            <div className="semantic-test-header">
              <span className="test-panel-badge">Dry run — nothing is posted</span>
            </div>
            <div className="form-group" style={{ margin: "10px 0 8px" }}>
              <label className="label" style={{ fontSize: "11px", marginBottom: "4px" }}>Test against issue</label>
              <div className="test-target-row">
                <IssuePicker value={testIssue} onChange={setTestIssue} onValidationChange={setIssueValid} />
                <button className="btn-run-test" onClick={handleTest} disabled={testRunning || !testIssue.trim() || !(commentPrompt || "").trim() || !issueValid?.valid}>
                  {testRunning ? "Running..." : "Run Test"}
                </button>
              </div>
            </div>

            {testResult && (
              <div className={`semantic-test-result ${testResult.success ? "st-update" : "st-error"}`}>
                <div className="st-result-header">
                  {testResult.success
                    ? <span className="test-badge test-badge-pass">{testResult.decision || "COMMENT"}</span>
                    : <span className="test-badge test-badge-fail">ERROR</span>}
                  <span className="test-result-meta">{testResult.executionTimeMs ? `${testResult.executionTimeMs}ms` : ""}</span>
                  <button className="test-dismiss" onClick={() => setTestResult(null)}>&times;</button>
                </div>
                {testResult.error && <div className="st-section"><strong>Error:</strong> {testResult.error}</div>}
                {testResult.proposedValue !== undefined && (
                  <div className="st-section">
                    <div className="st-section-label">Drafted comment</div>
                    <pre className="st-value st-proposed">{typeof testResult.proposedValue === "string" ? testResult.proposedValue : JSON.stringify(testResult.proposedValue, null, 2)}</pre>
                    <p className="hint" style={{ margin: "4px 0 0" }}>This was NOT posted. Dry run only.</p>
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
