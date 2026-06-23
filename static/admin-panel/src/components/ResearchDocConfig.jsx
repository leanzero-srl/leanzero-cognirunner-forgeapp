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
import AILoadingState from "./AILoadingState";

// A research brief is prose — offer the document-style formats, not slides/spreadsheets.
const FORMAT_OPTIONS = [
  { value: "markdown", label: "Markdown (.md)" },
  { value: "pdf", label: "PDF (.pdf)" },
  { value: "doc", label: "Word (.docx)" },
];

export default function ResearchDocConfig({
  fieldId,
  setFieldId,
  fields,
  loadingFields,
  errorFields,
  researchSources,
  setResearchSources,
  libraryName,
  setLibraryName,
  researchQuery,
  setResearchQuery,
  researchTitle,
  setResearchTitle,
  docFormat,
  setDocFormat,
  contentPrompt,
  setContentPrompt,
  attachComment,
  setAttachComment,
  alsoSaveToLibrary,
  setAlsoSaveToLibrary,
}) {
  const [showTest, setShowTest] = useState(false);
  const [testIssue, setTestIssue] = useState("");
  const [testRunning, setTestRunning] = useState(false);
  const [issueValid, setIssueValid] = useState(null);
  const [testResult, setTestResult] = useState(null);

  const sources = Array.isArray(researchSources) && researchSources.length ? researchSources : ["web"];
  const useWeb = sources.includes("web");
  const useContext7 = sources.includes("context7");

  const toggleSource = (key) => {
    const set = new Set(sources);
    if (set.has(key)) set.delete(key); else set.add(key);
    // Never let the user clear BOTH — keep at least web on.
    const next = [...set];
    setResearchSources(next.length ? next : ["web"]);
  };

  const handleTest = async () => {
    setTestRunning(true);
    setTestResult(null);
    try {
      const result = await invoke("testResearchDocPostFunction", {
        issueKey: testIssue.trim(),
        fieldId: fieldId || "description",
        researchQuery,
        researchTitle,
        researchSources: sources,
        libraryName,
        contentPrompt,
        docFormat: docFormat || "markdown",
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
          <li><strong>Research</strong> — gathers evidence from the web and/or library docs (context7)</li>
          <li><strong>Author</strong> — AI writes a concise, sourced briefing from that evidence</li>
          <li><strong>Attach</strong> — the brief is generated and attached to the issue automatically</li>
        </ol>
        <p className="hint" style={{ margin: "6px 0 0" }}>
          Requires the <strong>doc-reader</strong> MCP (to create + attach), plus <strong>web-search</strong> and/or <strong>context7</strong> for the sources you pick (Settings → MCP Integrations).
        </p>
      </div>

      <div className="form-group">
        <label className="label">
          Research sources <span className="required">*</span>
          <Tooltip text="Where to gather evidence. Web search needs the web-search MCP (+ a Serper key); Library docs uses context7 to pull a framework/SDK's official docs. You can use both." />
        </label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", marginTop: "2px" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px" }}>
            <input type="checkbox" checked={useWeb} onChange={() => toggleSource("web")} />
            Web search
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px" }}>
            <input type="checkbox" checked={useContext7} onChange={() => toggleSource("context7")} />
            Library / framework docs (context7)
          </label>
        </div>
      </div>

      {useContext7 && (
        <div className="form-group">
          <label className="label">
            Library hint <span className="hint" style={{ fontWeight: 400 }}>(optional)</span>
            <Tooltip text="The library/framework/SDK whose docs to pull, e.g. 'react', 'express', 'stripe'. Blank = inferred from the research query." />
          </label>
          <input type="text" value={libraryName || ""} onChange={(e) => setLibraryName(e.target.value)} placeholder="e.g. express" className="input" />
        </div>
      )}

      <div className="form-group">
        <label className="label">
          Research query
          <Tooltip text="What to research. Leave blank to research the source field's content. You can reference the source field with ${field}, e.g. 'mitigations for: ${field}'." />
        </label>
        <textarea
          value={researchQuery || ""}
          onChange={(e) => setResearchQuery(e.target.value)}
          placeholder={'Example: "error-handling best practices for ${field}"  (blank = research the source field)'}
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
          Briefing instructions <span className="hint" style={{ fontWeight: 400 }}>(optional)</span>
          <Tooltip text="Optional steer for how the brief is written, e.g. 'Focus on security implications and give a checklist.' Blank = a clear, sourced summary." />
        </label>
        <textarea
          value={contentPrompt || ""}
          onChange={(e) => setContentPrompt(e.target.value)}
          placeholder={'Example: "Summarize for an engineer: key practices, pitfalls, and a short checklist."'}
          className="textarea"
          rows={3}
        />
      </div>

      <div className="form-group">
        <label className="label">
          Document title <span className="hint" style={{ fontWeight: 400 }}>(optional)</span>
          <Tooltip text="Title hint for the attached brief. Blank = the AI chooses one from the query." />
        </label>
        <input type="text" value={researchTitle || ""} onChange={(e) => setResearchTitle(e.target.value)} placeholder="e.g. Error-handling brief" className="input" />
      </div>

      <div className="form-group">
        <label className="label">
          Format
          <Tooltip text="The file type for the attached brief. Markdown is lightest; PDF is print-ready; Word is editable." />
        </label>
        <CustomSelect
          value={docFormat || "markdown"}
          onChange={setDocFormat}
          placeholder="Choose a format..."
          options={FORMAT_OPTIONS}
        />
      </div>

      <div className="form-group">
        <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px" }}>
          <input type="checkbox" checked={!!attachComment} onChange={(e) => setAttachComment && setAttachComment(e.target.checked)} />
          Add a comment linking the attached brief
        </label>
      </div>

      <div className="form-group">
        <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "13px" }}>
          <input type="checkbox" checked={!!alsoSaveToLibrary} onChange={(e) => setAlsoSaveToLibrary && setAlsoSaveToLibrary(e.target.checked)} />
          Also keep a copy in the Documentation Library
        </label>
      </div>

      <div className="semantic-test-section">
        <button className="btn-semantic-test-toggle" onClick={() => setShowTest(!showTest)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          <span>{showTest ? "Hide Test" : "Test Run"}</span>
          <Tooltip text="Researches and previews the brief the AI would write — it does NOT create or attach a file." />
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
                <button className={`btn-run-test${testRunning ? " is-busy busy-solid" : ""}`} onClick={handleTest} disabled={testRunning || !testIssue.trim() || !issueValid?.valid}>
                  Run Test
                </button>
              </div>
            </div>

            {testRunning && <AILoadingState type="test" />}

            {testResult && (
              <div className={`semantic-test-result anim-rise ${testResult.success ? "st-update" : "st-error"}`}>
                <div className="st-result-header">
                  {testResult.success
                    ? <span className="test-badge test-badge-pass">{testResult.decision || "RESEARCH_DOC"}</span>
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
                    <div className="st-section-label">Brief preview{testResult.title ? ` — "${testResult.title}"` : ""}</div>
                    <pre className="st-value st-proposed">{typeof testResult.proposedValue === "string" ? testResult.proposedValue : JSON.stringify(testResult.proposedValue, null, 2)}</pre>
                    <p className="hint" style={{ margin: "4px 0 0" }}>This was NOT written to a file. Dry run only.</p>
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
