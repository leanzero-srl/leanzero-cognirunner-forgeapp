/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Memories admin tab. Full management of AI memories: quick-add, inline edit,
 * archive/restore, delete, plus the admin-only auto-learning and prompt
 * injection settings. The config-ui Knowledge panel shows a compact recent
 * view; this tab is the complete table.
 */

import React, { useState, useEffect, useCallback } from "react";

const SOURCE_CLASS = {
  user: "memories-admin-src-user",
  test: "memories-admin-src-test",
  fix: "memories-admin-src-fix",
};

export default function MemoriesAdminTab({ invoke, isAdmin }) {
  const [memories, setMemories] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [newContent, setNewContent] = useState("");
  const [adding, setAdding] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editContent, setEditContent] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [error, setError] = useState(null);

  const loadMemories = useCallback(async () => {
    try {
      const result = await invoke("getMemories");
      if (result.success) {
        setMemories(result.memories || []);
        setSettings(result.settings || null);
      }
    } catch (e) {
      console.error("Failed to load memories:", e);
    }
    setLoading(false);
  }, [invoke]);

  useEffect(() => { loadMemories(); }, [loadMemories]);

  const handleToggleSetting = async (key) => {
    if (!isAdmin || !settings || savingSettings) return;
    setSavingSettings(true);
    setError(null);
    try {
      const result = await invoke("saveMemorySettings", { [key]: !settings[key] });
      if (result.success === false) {
        setError(result.error || "Failed to save settings.");
      } else {
        setSettings((prev) => ({ ...prev, [key]: !prev[key] }));
      }
    } catch (e) {
      setError(e.message);
    }
    setSavingSettings(false);
  };

  const handleAdd = async () => {
    const content = newContent.trim();
    if (!content || adding) return;
    setAdding(true);
    setError(null);
    try {
      const result = await invoke("addMemory", { content, source: "user" });
      if (result.success) {
        setNewContent("");
        await loadMemories();
      } else {
        setError(result.error || "Failed to add memory.");
      }
    } catch (e) {
      setError(e.message);
    }
    setAdding(false);
  };

  const startEdit = (mem) => {
    setEditingId(mem.id);
    setEditContent(mem.content);
  };

  const saveEdit = async () => {
    const content = editContent.trim();
    if (!content || savingEdit) return;
    setSavingEdit(true);
    setError(null);
    try {
      const result = await invoke("updateMemory", { id: editingId, content });
      if (result.success === false) {
        setError(result.error || "Failed to update memory.");
      } else {
        setEditingId(null);
        setEditContent("");
        await loadMemories();
      }
    } catch (e) {
      setError(e.message);
    }
    setSavingEdit(false);
  };

  const handleArchive = async (mem) => {
    setError(null);
    try {
      await invoke("updateMemory", { id: mem.id, disabled: !mem.disabled });
      await loadMemories();
    } catch (e) {
      setError(e.message);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this memory permanently? This cannot be undone.")) return;
    setError(null);
    try {
      await invoke("deleteMemory", { id });
      await loadMemories();
    } catch (e) {
      setError(e.message);
    }
  };

  const byNewest = (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  const active = memories.filter((m) => !m.disabled).sort(byNewest);
  const archived = memories.filter((m) => m.disabled).sort(byNewest);
  const colCount = 5;

  const renderRow = (mem) => (
    <tr key={mem.id} className={mem.disabled ? "memories-admin-archived-row" : undefined}>
      <td style={{ wordBreak: "break-word" }}>
        {editingId === mem.id ? (
          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            <input
              type="text"
              className="memories-admin-edit-input"
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveEdit();
                if (e.key === "Escape") { setEditingId(null); setEditContent(""); }
              }}
              autoFocus
            />
            <button
              className="btn-small"
              onClick={saveEdit}
              disabled={savingEdit || !editContent.trim()}
              style={{ background: "#0d9488", color: "#ffffff", border: "none", fontWeight: 700 }}
            >
              {savingEdit ? "Saving..." : "Save"}
            </button>
            <button className="btn-small" onClick={() => { setEditingId(null); setEditContent(""); }}>
              Cancel
            </button>
          </div>
        ) : (
          <span style={{ fontWeight: 500 }}>{mem.content}</span>
        )}
      </td>
      <td>
        <span className={`memories-admin-source-badge ${SOURCE_CLASS[mem.source] || "memories-admin-src-user"}`}>
          {mem.source || "user"}
        </span>
      </td>
      <td><span className="timestamp">{mem.projectKey || "Global"}</span></td>
      <td>
        <span className="timestamp">
          {mem.createdAt ? new Date(mem.createdAt).toLocaleDateString() : "—"}
        </span>
        {mem.reinforcements > 0 && (
          <span className="memories-admin-reinforced">Reinforced x{mem.reinforcements}</span>
        )}
      </td>
      <td>
        {isAdmin && (
          <div className="row-actions">
            {editingId !== mem.id && (
              <button className="btn-small" onClick={() => startEdit(mem)}>Edit</button>
            )}
            <button className="btn-small" onClick={() => handleArchive(mem)}>
              {mem.disabled ? "Restore" : "Archive"}
            </button>
            <button className="btn-small btn-danger" onClick={() => handleDelete(mem.id)}>Delete</button>
          </div>
        )}
      </td>
    </tr>
  );

  return (
    <div className="memories-admin-tab">
      <div className="section-header">
        <span className="section-title">Memories</span>
      </div>
      <div className="memories-admin-explainer">
        Memories are short facts the AI has learned about this Jira instance. They are injected into every code generation.
      </div>

      {error && (
        <div style={{ color: "var(--error-color)", fontSize: "12px", fontWeight: 600, marginBottom: "10px" }}>
          {error}
        </div>
      )}

      {isAdmin && settings && (
        <div className="card memories-admin-toggles">
          <div className="memories-admin-toggle-row">
            <input
              type="checkbox"
              id="mem-auto-capture"
              checked={!!settings.autoCapture}
              disabled={savingSettings}
              onChange={() => handleToggleSetting("autoCapture")}
            />
            <div>
              <label className="memories-admin-toggle-label" htmlFor="mem-auto-capture">
                Learn from production failures
              </label>
              <div className="memories-admin-toggle-copy">
                When enabled, CogniRunner distills one short memory per novel post-function failure
                (one small AI call per new failure type, never on repeats). Off by default.
              </div>
            </div>
          </div>
          <div className="memories-admin-toggle-row">
            <input
              type="checkbox"
              id="mem-injection"
              checked={!!settings.injection}
              disabled={savingSettings}
              onChange={() => handleToggleSetting("injection")}
            />
            <div>
              <label className="memories-admin-toggle-label" htmlFor="mem-injection">
                Inject memories into AI prompts
              </label>
              <div className="memories-admin-toggle-copy">
                When enabled, active memories are included in every AI code generation and fix.
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="memories-admin-add">
        <input
          type="text"
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
          placeholder="Remember this about your Jira instance..."
        />
        <button className="btn-add-memory" onClick={handleAdd} disabled={adding || !newContent.trim()}>
          {adding ? "Saving..." : "Add Memory"}
        </button>
      </div>

      <div className="card">
        {loading ? (
          <div style={{ padding: "14px" }}>
            {[1, 2, 3].map((i) => (
              <div key={i} style={{ display: "flex", gap: "16px", alignItems: "center", padding: "10px 0", borderBottom: i < 3 ? "1px solid var(--border-color)" : "none" }}>
                <div className="sk sk-text" style={{ width: 220, height: 13 }} />
                <div className="sk sk-text" style={{ width: 50, height: 16, borderRadius: 10 }} />
                <div className="sk sk-text" style={{ width: 50, height: 11 }} />
                <div className="sk sk-text" style={{ width: 70, height: 11 }} />
              </div>
            ))}
          </div>
        ) : memories.length === 0 ? (
          <div className="empty-state">
            <div className="memories-admin-empty-title">No memories yet</div>
            Memories are created when you add them manually above, when you accept an AI fix,
            or automatically when learning from production failures is enabled.
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Memory</th>
                <th>Source</th>
                <th>Project</th>
                <th>Learned</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {active.map(renderRow)}
              {archived.length > 0 && (
                <tr className="memories-admin-divider">
                  <td colSpan={colCount}>
                    <span className="memories-admin-archived-badge">Archived</span>
                  </td>
                </tr>
              )}
              {archived.map(renderRow)}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
