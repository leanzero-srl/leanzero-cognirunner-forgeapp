/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import React, { useState, useEffect, useCallback } from "react";
import { invoke } from "@forge/bridge";
import { javascriptLanguage } from "@codemirror/lang-javascript";
import Tooltip from "./Tooltip";
import CustomSelect from "./CustomSelect";

// CSP-safe JavaScript syntax check: parse with Lezer (no eval / new Function,
// which the Forge iframe CSP blocks) and look for error nodes in the tree.
const checkJsSyntax = (content) => {
  const tree = javascriptLanguage.parser.parse(content);
  let errorAt = -1;
  tree.iterate({
    enter: (node) => {
      if (errorAt >= 0) return false;
      if (node.type.isError) {
        errorAt = node.from;
        return false;
      }
      return undefined;
    },
  });
  if (errorAt < 0) return { ok: true };
  const line = content.slice(0, errorAt).split("\n").length;
  return { ok: false, line };
};

const CATEGORIES = [
  "API Documentation",
  "Field Mappings",
  "JSON Schemas",
  "Business Rules",
  "Code Snippets",
  "General",
];

export default function DocRepository({ selectedDocs, onSelectionChange, embedded = false, onChanged = null }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newCategory, setNewCategory] = useState("General");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [validationMsg, setValidationMsg] = useState(null); // { type: "error"|"ok", msg }
  const [expandedDoc, setExpandedDoc] = useState(null);
  const [expandedContent, setExpandedContent] = useState("");
  const [loadingContent, setLoadingContent] = useState(false);

  const loadDocs = useCallback(async () => {
    try {
      const result = await invoke("getContextDocs");
      if (result.success) setDocs(result.docs || []);
    } catch (e) {
      console.error("Failed to load docs:", e);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadDocs(); }, [loadDocs]);

  // Validate content based on category
  const validateContent = useCallback((content, category) => {
    if (!content.trim()) {
      setValidationMsg(null);
      return true;
    }

    if (category === "JSON Schemas" || category === "Field Mappings") {
      try {
        const parsed = JSON.parse(content);
        const type = Array.isArray(parsed) ? "array" : typeof parsed;
        const count = Array.isArray(parsed)
          ? `${parsed.length} items`
          : type === "object"
            ? `${Object.keys(parsed).length} keys`
            : type;
        setValidationMsg({ type: "ok", msg: `Valid JSON (${count})` });
        return true;
      } catch (e) {
        const match = e.message.match(/position (\d+)/);
        const pos = match ? ` at position ${match[1]}` : "";
        setValidationMsg({ type: "error", msg: `Invalid JSON${pos}: ${e.message.split(" at ")[0]}` });
        return false;
      }
    }

    if (category === "Code Snippets") {
      const result = checkJsSyntax(content);
      if (result.ok) {
        setValidationMsg({ type: "ok", msg: "Valid JavaScript syntax" });
        return true;
      }
      setValidationMsg({ type: "error", msg: `JS syntax error near line ${result.line}` });
      return false;
    }

    // No validation for other categories
    setValidationMsg(null);
    return true;
  }, []);

  // Re-validate when content or category changes
  useEffect(() => {
    if (newContent.trim()) {
      validateContent(newContent, newCategory);
    } else {
      setValidationMsg(null);
    }
  }, [newContent, newCategory, validateContent]);

  const handleSave = async () => {
    if (!newTitle.trim() || !newContent.trim()) {
      setError("Title and content are required");
      return;
    }
    // Block save on validation errors
    if (!validateContent(newContent, newCategory)) {
      setError("Fix validation errors before saving");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await invoke("saveContextDoc", {
        title: newTitle.trim(),
        content: newContent.trim(),
        category: newCategory,
      });
      if (result.success) {
        setNewTitle("");
        setNewContent("");
        setNewCategory("General");
        setShowAdd(false);
        await loadDocs();
        if (onChanged) onChanged();
      } else {
        setError(result.error || "Failed to save");
      }
    } catch (e) {
      setError("Failed to save: " + e.message);
    }
    setSaving(false);
  };

  const handleDelete = async (id) => {
    try {
      await invoke("deleteContextDoc", { id });
      // Remove from selection if selected
      if (selectedDocs.includes(id)) {
        onSelectionChange(selectedDocs.filter((d) => d !== id));
      }
      await loadDocs();
      if (onChanged) onChanged();
    } catch (e) {
      console.error("Failed to delete:", e);
    }
  };

  const handleExpand = async (id) => {
    if (expandedDoc === id) {
      setExpandedDoc(null);
      return;
    }
    setExpandedDoc(id);
    setLoadingContent(true);
    try {
      const result = await invoke("getContextDocContent", { id });
      if (result.success) {
        setExpandedContent(result.doc.content);
      }
    } catch (e) {
      setExpandedContent("Failed to load content");
    }
    setLoadingContent(false);
  };

  const toggleDocSelection = (id) => {
    if (selectedDocs.includes(id)) {
      onSelectionChange(selectedDocs.filter((d) => d !== id));
    } else {
      onSelectionChange([...selectedDocs, id]);
    }
  };

  const formatSize = (len) => {
    if (len < 1024) return `${len} B`;
    return `${(len / 1024).toFixed(1)} KB`;
  };

  // Hide rows the backend disabled (e.g. soft-deleted builtins)
  const visibleDocs = docs.filter((d) => !d.disabled);

  return (
    <div className={embedded ? "doc-repo-embedded" : "doc-repo"}>
      {embedded ? (
        // Parent (Knowledge panel) provides the chrome — just a slim toolbar.
        <div className="doc-add-actions" style={{ padding: "8px 12px 0" }}>
          <span className="doc-size-hint">
            Reference documents the AI uses as context when generating code
          </span>
          <button className="btn-add-doc" onClick={() => setShowAdd(!showAdd)}>
            {showAdd ? "Cancel" : "+ Add Document"}
          </button>
        </div>
      ) : (
        <div className="doc-repo-header">
          <div className="doc-repo-title-row">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
            </svg>
            <span className="doc-repo-title">Documentation Library</span>
            <Tooltip text="Shared reference documents available to all users. Select documents to include as context when generating code — the AI uses them to produce more accurate results." />
          </div>
          <button className="btn-add-doc" onClick={() => setShowAdd(!showAdd)}>
            {showAdd ? "Cancel" : "+ Add Document"}
          </button>
        </div>
      )}

      {/* Add new document form */}
      {showAdd && (
        <div className="doc-add-form">
          {error && (
            <div className="doc-error">{error}</div>
          )}
          <input
            type="text"
            className="input"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Document title (e.g., 'Sprint Field API', 'Webhook Payload Schema')"
          />
          <div className="doc-add-row">
            <div className="doc-category-select">
              <CustomSelect
                value={newCategory}
                onChange={setNewCategory}
                options={CATEGORIES.map((c) => ({ value: c, label: c }))}
                placeholder="Category..."
              />
            </div>
          </div>
          <textarea
            className={`textarea doc-content-input ${validationMsg?.type === "error" ? "input-error" : ""}`}
            rows={10}
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder={"Paste documentation, JSON schemas, API specs, field mappings, or any reference material.\n\nExamples:\n- REST API endpoint docs with request/response formats\n- Custom field IDs and their meanings\n- Business rules for automation logic\n- JSON payload structures"}
          />
          {validationMsg && (
            <div className={`doc-validation ${validationMsg.type === "error" ? "doc-validation-error" : "doc-validation-ok"}`}>
              {validationMsg.type === "error" ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              )}
              <span>{validationMsg.msg}</span>
            </div>
          )}
          <div className="doc-add-actions">
            <span className="doc-size-hint">
              {newContent.length > 0 ? formatSize(newContent.length) : ""}{newContent.length > 200000 ? " (too large)" : ""}
            </span>
            <button
              className="btn-save-doc"
              onClick={handleSave}
              disabled={saving || !newTitle.trim() || !newContent.trim() || newContent.length > 200000 || validationMsg?.type === "error"}
            >
              {saving ? "Saving..." : "Save to Library"}
            </button>
          </div>
        </div>
      )}

      {/* Document list */}
      {loading ? (
        <div style={{ padding: "12px" }}>
          <div className="sk sk-text" style={{ width: "60%", height: 12, marginBottom: 8 }} />
          <div className="sk sk-text" style={{ width: "40%", height: 12 }} />
        </div>
      ) : visibleDocs.length === 0 ? (
        <div className="doc-empty">
          No documents yet. Add API docs, schemas, or field mappings to help AI generate better code.
        </div>
      ) : (
        <div className="doc-list">
          {visibleDocs.map((doc) => {
            const isSelected = selectedDocs.includes(doc.id);
            const isExpanded = expandedDoc === doc.id;
            return (
              <div key={doc.id} className={`doc-item ${isSelected ? "doc-selected" : ""}`}>
                <div className="doc-item-row">
                  <label className="doc-checkbox">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleDocSelection(doc.id)}
                    />
                  </label>
                  <div className="doc-item-info" onClick={() => toggleDocSelection(doc.id)}>
                    <span className="doc-item-title">{doc.title}</span>
                    <span className="doc-item-meta">
                      <span className="doc-category-badge">{doc.category}</span>
                      {doc.builtin && <span className="builtin-badge">BUILT-IN</span>}
                      <span>{formatSize(doc.contentLength)}</span>
                    </span>
                  </div>
                  <div className="doc-item-actions">
                    <button
                      className="doc-btn-preview"
                      onClick={() => handleExpand(doc.id)}
                      title="Preview"
                    >
                      {isExpanded ? "▲" : "▼"}
                    </button>
                    <button
                      className="doc-btn-delete"
                      onClick={() => handleDelete(doc.id)}
                      title={doc.builtin ? "Disable" : "Delete"}
                    >
                      &times;
                    </button>
                  </div>
                </div>
                {isExpanded && (
                  <div className="doc-preview">
                    {loadingContent ? "Loading..." : (
                      <pre className="doc-preview-content">{expandedContent}</pre>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {selectedDocs.length > 0 && (
        <div className="doc-selection-info">
          {selectedDocs.length} document{selectedDocs.length > 1 ? "s" : ""} selected — will be included as context for code generation
        </div>
      )}
    </div>
  );
}
