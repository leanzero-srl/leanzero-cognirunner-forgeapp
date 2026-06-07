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

export default function ResearchConfig({
  fieldId,
  setFieldId,
  fields,
  loadingFields,
  errorFields,
  researchQuery,
  setResearchQuery,
  researchTitle,
  setResearchTitle,
  autoSelectResearchDoc,
  setAutoSelectResearchDoc,
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
      const result = await invoke("testResearchPostFunction", {
        issueKey: testIssue.trim(),
        fieldId: fieldId || "description",
        researchQuery,
        researchTitle,
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
          <li><strong>Research</strong> — runs a live web search via the web-search MCP</li>
          <li><strong>Save</strong> — stores the results as a reusable doc in your Documentation Library</li>
          <li>Other rules can then reference that doc as context</li>
        </ol>
        <p className="hint" style={{ margin: "6px 0 0" }}>
          Requires the <strong>web-search</strong> MCP (Settings → MCP Integrations). Saved docs appear under the <em>Research</em> category and are de-duplicated by title.
        </p>
      </div>

      <div className="form-group">
        <label className="label">
          Research query
          <Tooltip text="What to search for. Leave blank to research the source field's content. You can also reference the source field with ${field}, e.g. 'best practices for: ${field}'." />
        </label>
        <textarea
          value={researchQuery || ""}
          onChange={(e) => setResearchQuery(e.target.value)}
          placeholder={'Example: "competitive landscape for ${field}"  (blank = research the source field)'}
          className="textarea"
          rows={3}
        />
      </div>

      <div className="form-group">
        <label className="label">
          Source field
          <Tooltip text="Used when the query is blank or references ${field}. Defaults to Description." />
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
          Doc title <span className="hint" style={{ fontWeight: 400 }}>(optional)</span>
          <Tooltip text="Title for the saved research doc. Blank = use the query. Re-running with the same title updates the existing doc instead of creating a duplicate." />
        </label>
        <input type="text" value={researchTitle || ""} onChange={(e) => setResearchTitle(e.target.value)} placeholder="e.g. Market research" className="input" />
      </div>

      <div className="form-group">
        <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px" }}>
          <input type="checkbox" checked={!!autoSelectResearchDoc} onChange={(e) => setAutoSelectResearchDoc && setAutoSelectResearchDoc(e.target.checked)} />
          Auto-attach the saved doc to this rule as reference context
        </label>
      </div>

      <div className="semantic-test-section">
        <button className="btn-semantic-test-toggle" onClick={() => setShowTest(!showTest)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          <span>{showTest ? "Hide Test" : "Test Run"}</span>
          <Tooltip text="Runs the live web search and previews the result — it does NOT save anything to the library." />
        </button>

        {showTest && (
          <div className="semantic-test-panel">
            <div className="semantic-test-header">
              <span className="test-panel-badge">Dry run — nothing is saved to the library</span>
            </div>
            <div className="form-group" style={{ margin: "10px 0 8px" }}>
              <label className="label" style={{ fontSize: "11px", marginBottom: "4px" }}>Test against issue</label>
              <div className="test-target-row">
                <IssuePicker value={testIssue} onChange={setTestIssue} onValidationChange={setIssueValid} />
                <button className="btn-run-test" onClick={handleTest} disabled={testRunning || !testIssue.trim() || !issueValid?.valid}>
                  {testRunning ? "Running..." : "Run Test"}
                </button>
              </div>
            </div>

            {testResult && (
              <div className={`semantic-test-result ${testResult.success ? "st-update" : "st-error"}`}>
                <div className="st-result-header">
                  {testResult.success
                    ? <span className="test-badge test-badge-pass">{testResult.decision || "RESEARCH"}</span>
                    : <span className="test-badge test-badge-fail">ERROR</span>}
                  <span className="test-result-meta">{testResult.executionTimeMs ? `${testResult.executionTimeMs}ms` : ""}</span>
                  <button className="test-dismiss" onClick={() => setTestResult(null)}>&times;</button>
                </div>
                {testResult.error && <div className="st-section"><strong>Error:</strong> {testResult.error}</div>}
                {testResult.reason && (
                  <div className="st-section"><div className="st-section-label">Plan</div><div className="st-reason">{testResult.reason}</div></div>
                )}
                {testResult.proposedValue !== undefined && (
                  <div className="st-section">
                    <div className="st-section-label">Research preview{testResult.title ? ` — "${testResult.title}"` : ""}</div>
                    <pre className="st-value st-proposed">{typeof testResult.proposedValue === "string" ? testResult.proposedValue : JSON.stringify(testResult.proposedValue, null, 2)}</pre>
                    <p className="hint" style={{ margin: "4px 0 0" }}>This was NOT saved. Dry run only.</p>
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
