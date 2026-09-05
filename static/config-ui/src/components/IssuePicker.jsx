/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@forge/bridge";

export default function IssuePicker({ value, onChange, projectKey, onValidationChange }) {
  const [query, setQuery] = useState(value || "");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const [validated, setValidated] = useState(null); // null | { valid, summary } | { valid: false, error }
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const searchTimer = useRef(null);
  const validateTimer = useRef(null);
  // Request tokens — a slow older search/validate response must never
  // overwrite the state owned by a newer request (or newer input).
  const searchSeq = useRef(0);
  const validateSeq = useRef(0);

  // Invalidates everything in flight (typing, selecting, clearing).
  const cancelInFlight = () => {
    searchSeq.current++;
    validateSeq.current++;
    setLoading(false);
    setValidating(false);
  };

  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    // Dismiss after the target's click. Removing this dropdown on mousedown can
    // shrink a scrolled test panel and move Run Test away before mouseup.
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  const doSearch = useCallback(async (text) => {
    if (!text || text.length < 2) { setResults([]); setOpen(false); return; }
    const seq = ++searchSeq.current;
    setLoading(true);
    try {
      const result = await invoke("searchIssues", { query: text, projectKey });
      // Stale — a newer search (or selection/clear) owns the state now.
      if (seq !== searchSeq.current) return;
      if (result.success) {
        setResults(result.issues || []);
        setOpen(result.issues.length > 0);
        setHighlighted(0);
      }
    } catch (e) {
      if (seq !== searchSeq.current) return;
      console.error("Issue search failed:", e);
    }
    setLoading(false);
  }, [projectKey]);

  // Validate issue key by fetching directly — not via JQL search
  const validateKey = useCallback(async (key) => {
    if (!key || !/^[A-Z]+-\d+$/i.test(key.trim())) {
      validateSeq.current++; // anything in flight is for older input
      setValidating(false);
      setValidated(null);
      return;
    }
    const seq = ++validateSeq.current;
    setValidating(true);
    try {
      const result = await invoke("validateIssue", { issueKey: key.trim().toUpperCase() });
      // Stale — the user kept typing or picked a result; discard.
      if (seq !== validateSeq.current) return;
      if (result.success && result.valid) {
        const v = { valid: true, summary: result.summary, status: result.status, type: result.type };
        setValidated(v);
        if (onValidationChange) onValidationChange(v);
      } else {
        const v = { valid: false, error: `Issue ${key.trim().toUpperCase()} not found` };
        setValidated(v);
        if (onValidationChange) onValidationChange(v);
      }
    } catch {
      if (seq !== validateSeq.current) return;
      const v = { valid: false, error: "Could not verify issue" };
      setValidated(v);
      if (onValidationChange) onValidationChange(v);
    }
    setValidating(false);
  }, []);

  const handleInputChange = (e) => {
    const val = e.target.value;
    setQuery(val);
    onChange(val);
    setValidated(null);
    if (onValidationChange) onValidationChange(null);

    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (validateTimer.current) clearTimeout(validateTimer.current);
    cancelInFlight();

    searchTimer.current = setTimeout(() => doSearch(val), 400);
    validateTimer.current = setTimeout(() => validateKey(val), 800);
  };

  const selectIssue = (issue) => {
    // A pending debounce or in-flight request for the typed text must not
    // reopen the dropdown or clobber the picked issue.
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (validateTimer.current) clearTimeout(validateTimer.current);
    cancelInFlight();
    setQuery(issue.key);
    onChange(issue.key);
    setOpen(false);
    setResults([]);
    const v = { valid: true, summary: issue.summary, status: issue.status, type: issue.type };
    setValidated(v);
    if (onValidationChange) onValidationChange(v);
  };

  const handleKeyDown = (e) => {
    if (!open) return;
    if (e.key === "Escape") { setOpen(false); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlighted((p) => Math.min(p + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlighted((p) => Math.max(p - 1, 0)); }
    else if (e.key === "Enter" && highlighted >= 0 && highlighted < results.length) {
      e.preventDefault();
      selectIssue(results[highlighted]);
    }
  };

  return (
    <div className="issue-picker" ref={wrapRef}>
      <div className={`issue-picker-input-wrap ${validated?.valid === true ? "issue-picker-valid" : validated?.valid === false ? "issue-picker-invalid" : ""}`}>
        {validated?.valid === true ? (
          <svg className="issue-picker-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success-color)" strokeWidth="2">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        ) : validated?.valid === false ? (
          <svg className="issue-picker-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--error-color)" strokeWidth="2">
            <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        ) : (
          <svg className="issue-picker-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        )}
        <input
          ref={inputRef}
          type="text"
          className="issue-picker-input"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (results.length > 0) setOpen(true); }}
          placeholder="Search by key (PROJ-123) or summary text..."
        />
        {(loading || validating) && <span className="spin-ring spin-ring-sm" />}
        {query && !loading && !validating && (
          <button
            className="issue-picker-clear"
            onClick={() => {
              if (searchTimer.current) clearTimeout(searchTimer.current);
              if (validateTimer.current) clearTimeout(validateTimer.current);
              cancelInFlight();
              setQuery(""); onChange(""); setResults([]); setOpen(false); setValidated(null);
              if (onValidationChange) onValidationChange(null);
            }}
          >
            &times;
          </button>
        )}
      </div>

      {/* Validation feedback */}
      {validated?.valid === true && (
        <div className="issue-picker-validated issue-picker-validated-ok anim-pop">
          <span>{validated.type || "Issue"}</span>
          <strong>{query}</strong>
          <span className="issue-picker-validated-summary">{validated.summary}</span>
          {validated.status && <span className="issue-picker-validated-status">{validated.status}</span>}
        </div>
      )}
      {validated?.valid === false && (
        <div className="issue-picker-validated issue-picker-validated-err">
          {validated.error}
        </div>
      )}

      {open && results.length > 0 && (
        <div className="issue-picker-dropdown anim-fade">
          {results.map((issue, i) => (
            <div
              key={issue.key}
              className={`issue-picker-item ${i === highlighted ? "issue-picker-highlighted" : ""}`}
              onClick={() => selectIssue(issue)}
              onMouseEnter={() => setHighlighted(i)}
            >
              <div className="issue-picker-item-key">
                <strong>{issue.key}</strong>
              </div>
              <div className="issue-picker-item-summary">{issue.summary}</div>
              <div className="issue-picker-item-meta">
                <span className="issue-picker-status">{issue.status}</span>
                {issue.priority && <span className="issue-picker-priority">{issue.priority}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
