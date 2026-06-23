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
import DocRepository from "./DocRepository";
import AILoadingState from "./AILoadingState";

const FORMAT_OPTIONS = [
  { value: "pdf", label: "PDF (.pdf)" },
  { value: "doc", label: "Word (.docx)" },
  { value: "pptx", label: "PowerPoint (.pptx)" },
  { value: "excel", label: "Excel (.xlsx)" },
  { value: "markdown", label: "Markdown (.md)" },
];

export default function GenerateDocConfig({
  fieldId,
  setFieldId,
  fields,
  loadingFields,
  errorFields,
  docFormat,
  setDocFormat,
  contentPrompt,
  setContentPrompt,
  docTitlePrompt,
  setDocTitlePrompt,
  attachComment,
  setAttachComment,
  selectedDocIds,
  onDocSelectionChange,
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
      const result = await invoke("testGenerateDocPostFunction", {
        issueKey: testIssue.trim(),
        fieldId: fieldId || "description",
        contentPrompt,
        docTitlePrompt,
        docFormat: docFormat || "pdf",
        selectedDocIds: selectedDocIds || [],
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
          <li><strong>Read</strong> — AI reads the source field (and any reference docs)</li>
          <li><strong>Author</strong> — AI writes a document from your instructions</li>
          <li><strong>Attach</strong> — the file is generated and attached to the issue automatically</li>
        </ol>
        <p className="hint" style={{ margin: "6px 0 0" }}>
          Requires the <strong>doc-reader</strong> MCP (Settings → MCP Integrations). The generator is something ScriptRunner can&apos;t do — real PPTX / PDF / DOCX from natural-language instructions.
        </p>
      </div>

      <div className="form-group">
        <label className="label">
          Source Field
          <Tooltip text="The field whose content the AI uses as the basis for the document. Defaults to Description." />
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
          Document instructions <span className="required">*</span>
          <Tooltip text="What the AI should write. e.g. 'Create a one-page executive summary of this epic with goals, scope, and risks.'" />
        </label>
        <textarea
          value={contentPrompt}
          onChange={(e) => setContentPrompt(e.target.value)}
          onBlur={() => setPromptTouched(true)}
          placeholder={'Example: "Write a stakeholder summary: problem, proposed solution, timeline, and open risks."'}
          className={`textarea ${promptTouched && !contentPrompt.trim() ? "input-error" : ""}`}
          rows={5}
        />
      </div>

      <div className="form-group">
        <label className="label">
          Format
          <Tooltip text="The file type to generate. PowerPoint produces real editable slides; PDF/Word produce formatted documents; Excel a spreadsheet; Markdown a .md file." />
        </label>
        <CustomSelect
          value={docFormat || "pdf"}
          onChange={setDocFormat}
          placeholder="Choose a format..."
          options={FORMAT_OPTIONS}
        />
      </div>

      <div className="form-group">
        <label className="label">
          Title hint <span className="hint" style={{ fontWeight: 400 }}>(optional)</span>
          <Tooltip text="An optional hint for the document title. Leave blank to let the AI choose one." />
        </label>
        <input
          type="text"
          value={docTitlePrompt || ""}
          onChange={(e) => setDocTitlePrompt(e.target.value)}
          placeholder="e.g. Executive Summary"
          className="input"
        />
      </div>

      <div className="form-group">
        <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px" }}>
          <input type="checkbox" checked={!!attachComment} onChange={(e) => setAttachComment && setAttachComment(e.target.checked)} />
          Add a comment linking the generated attachment
        </label>
      </div>

      <DocRepository selectedDocs={selectedDocIds || []} onSelectionChange={onDocSelectionChange} />

      <div className="semantic-test-section">
        <button className="btn-semantic-test-toggle" onClick={() => setShowTest(!showTest)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          <span>{showTest ? "Hide Test" : "Test Run"}</span>
          <Tooltip text="Previews the document the AI would author from a real issue — it does NOT create or attach a file. Completely safe." />
        </button>

        {showTest && (
          <div className="semantic-test-panel">
            <div className="semantic-test-header">
              <span className="test-panel-badge">Dry run — no file is created or attached</span>
            </div>
            <div className="form-group" style={{ margin: "10px 0 8px" }}>
              <label className="label" style={{ fontSize: "11px", marginBottom: "4px" }}>Test against issue</label>
              <div className="test-target-row">
                <IssuePicker value={testIssue} onChange={setTestIssue} onValidationChange={setIssueValid} />
                <button className={`btn-run-test${testRunning ? " is-busy busy-solid" : ""}`} onClick={handleTest} disabled={testRunning || !testIssue.trim() || !contentPrompt.trim() || !issueValid?.valid}>
                  Run Test
                </button>
              </div>
            </div>

            {testRunning && <AILoadingState type="test" />}

            {testResult && (
              <div className={`semantic-test-result anim-rise ${testResult.success ? "st-update" : "st-error"}`}>
                <div className="st-result-header">
                  {testResult.success
                    ? <span className="test-badge test-badge-pass">{testResult.decision || "GENERATE"}</span>
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
                    <div className="st-section-label">Authored content{testResult.title ? ` — "${testResult.title}"` : ""}</div>
                    <pre className="st-value st-proposed">{typeof testResult.proposedValue === "string" ? testResult.proposedValue : JSON.stringify(testResult.proposedValue, null, 2)}</pre>
                    <p className="hint" style={{ margin: "4px 0 0" }}>This content was NOT written to a file. Dry run only.</p>
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
