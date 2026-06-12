/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import CustomSelect from "./CustomSelect";
import { showToast } from "./toast";

const CATEGORIES = [
  "API Documentation", "Field Mappings", "JSON Schemas",
  "Business Rules", "Code Snippets", "General",
];

export default function DocsTab({ invoke, isAdmin, accountId }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState(isAdmin ? "all" : "mine");
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newCategory, setNewCategory] = useState("General");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [error, setError] = useState(null);
  const [expandedDoc, setExpandedDoc] = useState(null);
  const [expandedContent, setExpandedContent] = useState(null);
  const [expandedError, setExpandedError] = useState(null);
  const [loadingExpanded, setLoadingExpanded] = useState(false);
  // Tracks whether the first load has succeeded — later loads (filter change,
  // post-save/delete re-fetch) keep the list visible under a frosted veil.
  const hasLoadedRef = useRef(false);
  // Mirrors expandedDoc for in-flight getContextDocContent calls — a response
  // for a doc the user has since collapsed/switched away from is discarded.
  const expandedDocRef = useRef(null);
  // Monotonic token — a slow older load (rapid All/My Documents flips) must
  // never overwrite a newer filter's rows or clear its loading/refreshing
  // flags early. Only the latest call owns the state.
  const loadDocsToken = useRef(0);

  const loadDocs = useCallback(async () => {
    const token = ++loadDocsToken.current;
    if (hasLoadedRef.current) setRefreshing(true);
    try {
      const result = await invoke("getContextDocs", { filter });
      if (token !== loadDocsToken.current) return; // stale response
      if (result.success) {
        setDocs(result.docs || []);
        setLoadError(false);
        hasLoadedRef.current = true;
      } else if (!hasLoadedRef.current) {
        setLoadError(true);
      } else {
        showToast(result.error || "Couldn't refresh documents", "error");
      }
    } catch (e) {
      if (token !== loadDocsToken.current) return;
      console.error("Failed to load docs:", e);
      if (!hasLoadedRef.current) setLoadError(true);
      else showToast("Couldn't refresh documents", "error");
    }
    setLoading(false);
    setRefreshing(false);
  }, [invoke, filter]);

  useEffect(() => { loadDocs(); }, [loadDocs]);

  const handleSave = async () => {
    if (!newTitle.trim() || !newContent.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const result = await invoke("saveContextDoc", {
        title: newTitle.trim(),
        content: newContent.trim(),
        category: newCategory,
      });
      if (result.success) {
        setNewTitle(""); setNewContent(""); setNewCategory("General"); setShowAdd(false);
        await loadDocs();
        showToast("Document saved");
      } else {
        setError(result.error);
      }
    } catch (e) {
      setError(e.message);
    }
    setSaving(false);
  };

  const handleDelete = async (id) => {
    if (deletingId) return;
    if (!window.confirm("Delete this document permanently? This cannot be undone.")) return;
    setDeletingId(id);
    try {
      const result = await invoke("deleteContextDoc", { id });
      if (result && result.success === false) {
        showToast(result.error || "Failed to delete document", "error");
      } else {
        await loadDocs();
        showToast("Document deleted");
      }
    } catch (e) {
      showToast("Failed to delete document: " + e.message, "error");
    }
    setDeletingId(null);
  };

  const fetchExpandedContent = async (id) => {
    setExpandedContent(null);
    setExpandedError(null);
    setLoadingExpanded(true);
    try {
      const result = await invoke("getContextDocContent", { id });
      // Stale response — the user expanded another doc (or collapsed this one)
      // while the fetch was in flight. The newer call owns the state.
      if (expandedDocRef.current !== id) return;
      if (result.success) setExpandedContent(result.doc.content);
      else setExpandedError(result.error || "Couldn't load this document's content.");
    } catch (e) {
      if (expandedDocRef.current !== id) return;
      setExpandedError("Couldn't load this document's content.");
    } finally {
      // Only the call that still owns the expansion clears the loading flag.
      if (expandedDocRef.current === id) setLoadingExpanded(false);
    }
  };

  const handleExpand = (id) => {
    if (expandedDoc === id) {
      setExpandedDoc(null);
      expandedDocRef.current = null;
      setLoadingExpanded(false);
      return;
    }
    setExpandedDoc(id);
    expandedDocRef.current = id;
    fetchExpandedContent(id);
  };

  const formatSize = (len) => len < 1024 ? `${len} B` : `${(len / 1024).toFixed(1)} KB`;

  /** Detect content type and auto-format/indent. */
  const autoFormat = (text) => {
    if (!text || !text.trim()) return text;
    const trimmed = text.trim();

    // JSON
    try {
      const parsed = JSON.parse(trimmed);
      return JSON.stringify(parsed, null, 2);
    } catch { /* not JSON */ }

    // XML / HTML
    if (/^<[\s\S]*>$/m.test(trimmed)) {
      try {
        let indent = 0;
        return trimmed
          .replace(/>\s*</g, ">\n<")
          .split("\n")
          .map((line) => {
            const ln = line.trim();
            if (!ln) return "";
            if (ln.startsWith("</")) indent = Math.max(0, indent - 1);
            const out = "  ".repeat(indent) + ln;
            if (ln.startsWith("<") && !ln.startsWith("</") && !ln.endsWith("/>") && !ln.includes("</")) indent++;
            return out;
          })
          .join("\n");
      } catch { /* fall through */ }
    }

    // YAML — basic reindent (normalize to 2 spaces)
    if (/^[\w-]+\s*:/m.test(trimmed) && !trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      return trimmed.replace(/\t/g, "  ");
    }

    // JavaScript / code — normalize indentation to 2 spaces
    if (/(?:function\s|const\s|let\s|var\s|=>|import\s|export\s)/m.test(trimmed)) {
      return trimmed
        .split("\n")
        .map((line) => {
          const stripped = line.replace(/^\t+/, (tabs) => "  ".repeat(tabs.length));
          return stripped;
        })
        .join("\n");
    }

    return text;
  };

  return (
    <div className="docs-tab">
      <div className="section-header">
        <span className="section-title">Documentation Library</span>
        <div className="section-actions">
          {isAdmin && (
            <div style={{ width: "160px" }}>
              <CustomSelect
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "all", label: "All Documents" },
                  { value: "mine", label: "My Documents" },
                ]}
              />
            </div>
          )}
          <button className="btn-small" onClick={() => { setShowAdd(!showAdd); setError(null); }}>
            {showAdd ? "Cancel" : "+ Add Document"}
          </button>
        </div>
      </div>

      {showAdd && (
        <div className="card anim-rise" style={{ marginBottom: "12px", padding: "16px" }}>
          {error && <div style={{ color: "var(--error-color)", fontSize: "12px", marginBottom: "8px" }}>{error}</div>}
          <input
            type="text"
            className="doc-input"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Document title"
            style={{ marginBottom: "8px", width: "100%", padding: "8px", border: "1px solid var(--border-color)", borderRadius: "4px", background: "var(--input-bg)", color: "var(--text-color)", fontSize: "13px" }}
          />
          <div style={{ marginBottom: "8px", width: "220px" }}>
            <CustomSelect
              value={newCategory}
              onChange={setNewCategory}
              options={CATEGORIES.map((c) => ({ value: c, label: c }))}
              placeholder="Category..."
            />
          </div>
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="Paste documentation, JSON schemas, API specs..."
            rows={8}
            style={{ width: "100%", padding: "8px", border: "1px solid var(--border-color)", borderRadius: "4px", background: "var(--input-bg)", color: "var(--text-color)", fontSize: "12px", fontFamily: "SFMono-Regular, Consolas, monospace", resize: "vertical" }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "8px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{newContent.length > 0 ? formatSize(newContent.length) : ""}</span>
              {newContent.trim() && (
                <button
                  className="btn-small"
                  onClick={() => setNewContent(autoFormat(newContent))}
                  style={{ fontSize: "10px", padding: "3px 8px" }}
                  title="Auto-format and indent content (JSON, XML, YAML, JavaScript)"
                >
                  Format
                </button>
              )}
            </div>
            <button className={`btn-small${saving ? " is-busy busy-solid" : ""}`} onClick={handleSave} disabled={saving || !newTitle.trim() || !newContent.trim()} style={{ background: "var(--primary-color)", color: "white", border: "none" }}>
              Save
            </button>
          </div>
        </div>
      )}

      <div className="card veil-host">
        {refreshing && (
          <div className="veil"><span className="spin-ring" /><span className="veil-label">Refreshing…</span></div>
        )}
        {loading ? (
          <div style={{ padding: "14px" }}>
            {[1, 2, 3].map((i) => (
              <div key={i} style={{ display: "flex", gap: "16px", alignItems: "center", padding: "10px 0", borderBottom: i < 3 ? "1px solid var(--border-color)" : "none" }}>
                <div className="sk sk-text" style={{ width: 120, height: 13 }} />
                <div className="sk sk-text" style={{ width: 70, height: 16, borderRadius: 4 }} />
                <div className="sk sk-text" style={{ width: 50, height: 11 }} />
                <div className="sk sk-text" style={{ width: 80, height: 11 }} />
                <div style={{ marginLeft: "auto", display: "flex", gap: "6px" }}>
                  <div className="sk sk-block" style={{ width: 44, height: 28, borderRadius: 10 }} />
                  <div className="sk sk-block" style={{ width: 52, height: 28, borderRadius: 10 }} />
                </div>
              </div>
            ))}
          </div>
        ) : loadError ? (
          <div style={{ padding: "14px" }}>
            <div className="load-error">
              <span>Couldn't load the documentation library.</span>
              <button className="btn-retry" onClick={() => { setLoading(true); setLoadError(false); loadDocs(); }}>Retry</button>
            </div>
          </div>
        ) : docs.length === 0 ? (
          <div className="empty-state">
            {filter === "mine" ? "You haven't added any documents yet." : "No documents in the library yet."}
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Category</th>
                <th>Size</th>
                <th>Created</th>
                {isAdmin && <th>Owner</th>}
                <th></th>
              </tr>
            </thead>
            <tbody className="stagger">
              {docs.map((doc) => {
                const canDelete = isAdmin || doc.createdBy === accountId;
                return (
                  <React.Fragment key={doc.id}>
                    <tr>
                      <td style={{ fontWeight: "500" }}>{doc.title}</td>
                      <td><span className="type-badge type-validator">{doc.category}</span></td>
                      <td><span className="timestamp">{formatSize(doc.contentLength)}</span></td>
                      <td><span className="timestamp">{new Date(doc.createdAt).toLocaleDateString()}</span></td>
                      {isAdmin && <td><span className="timestamp">{doc.createdBy === accountId ? "You" : (doc.createdBy || "—")}</span></td>}
                      <td>
                        <div className="row-actions">
                          <button className="btn-small" onClick={() => handleExpand(doc.id)}>
                            {expandedDoc === doc.id ? "Hide" : "View"}
                          </button>
                          {canDelete && (
                            <button
                              className={`btn-small btn-danger${deletingId === doc.id ? " is-busy" : ""}`}
                              onClick={() => handleDelete(doc.id)}
                              disabled={deletingId === doc.id}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expandedDoc === doc.id && (
                      <tr>
                        <td colSpan={isAdmin ? 6 : 5} style={{ padding: "0 14px 14px" }}>
                          {loadingExpanded ? (
                            <div style={{ padding: "10px", background: "var(--code-bg)", borderRadius: "6px" }}>
                              <div className="sk sk-text" style={{ width: "85%", height: 11, marginBottom: 6 }} />
                              <div className="sk sk-text" style={{ width: "70%", height: 11, marginBottom: 6 }} />
                              <div className="sk sk-text" style={{ width: "60%", height: 11 }} />
                            </div>
                          ) : expandedError ? (
                            <div className="load-error anim-rise">
                              <span>{expandedError}</span>
                              <button className="btn-retry" onClick={() => fetchExpandedContent(doc.id)}>Retry</button>
                            </div>
                          ) : (
                            <pre className="anim-rise" style={{ margin: 0, padding: "10px", background: "var(--code-bg)", borderRadius: "6px", fontSize: "11px", fontFamily: "SFMono-Regular, Consolas, monospace", maxHeight: "300px", overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--text-secondary)", lineHeight: 1.5 }}>
                              {autoFormat(expandedContent || "")}
                            </pre>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
