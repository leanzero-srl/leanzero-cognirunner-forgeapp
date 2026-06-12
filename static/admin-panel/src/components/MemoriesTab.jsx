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
 * Memories tab of the Knowledge panel. Memories are instance facts the AI
 * injects into every generation (field IDs, conventions, gotchas). Quick-add
 * plus the 5 most recent; full management lives in the admin panel.
 */

import React, { useState, useEffect, useCallback } from "react";
import { invoke } from "@forge/bridge";
import Tooltip from "./Tooltip";

const SOURCE_CLASS = {
  user: "memory-src-user",
  test: "memory-src-test",
  fix: "memory-src-fix",
};

export default function MemoriesTab({ onChanged = null }) {
  const [memories, setMemories] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [newContent, setNewContent] = useState("");
  const [adding, setAdding] = useState(false);
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
  }, []);

  useEffect(() => { loadMemories(); }, [loadMemories]);

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
        if (onChanged) onChanged();
      } else {
        setError(result.error || "Failed to add memory.");
      }
    } catch (e) {
      console.error("Failed to add memory:", e);
      setError("Failed to add memory: " + e.message);
    }
    setAdding(false);
  };

  const handleDelete = async (id) => {
    setError(null);
    try {
      const result = await invoke("deleteMemory", { id });
      if (result.success) {
        await loadMemories();
        if (onChanged) onChanged();
      } else {
        setError(result.error || "Failed to delete memory.");
      }
    } catch (e) {
      console.error("Failed to delete memory:", e);
      setError("Failed to delete memory: " + e.message);
    }
  };

  const active = memories.filter((mem) => !mem.disabled);
  const recent = [...active]
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, 5);

  return (
    <div className="doc-repo-embedded">
      <div style={{ padding: "10px 12px 0", display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
        <span style={{ fontSize: "12px" }}>
          <span className="kc-mem">{loading ? "—" : active.length}</span>
          {" "}memories are injected into every generation
        </span>
        {settings && settings.autoCapture === false && (
          <Tooltip text="An admin can enable learning from production failures in the admin panel.">
            <span className="builtin-badge" style={{ cursor: "help" }}>Auto-learning off</span>
          </Tooltip>
        )}
      </div>

      <div className="memory-quick-add">
        <input
          type="text"
          className="input"
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
          placeholder="Remember this about your Jira instance..."
        />
        <button
          className="btn-remember"
          onClick={handleAdd}
          disabled={adding || !newContent.trim()}
        >
          {adding ? "Saving..." : "Remember"}
        </button>
      </div>

      {error && (
        <div style={{ color: "var(--error-color)", fontSize: "12px", fontWeight: 600, padding: "6px 12px 0" }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ padding: "12px" }}>
          <div className="sk sk-text" style={{ width: "60%", height: 12, marginBottom: 8 }} />
          <div className="sk sk-text" style={{ width: "40%", height: 12 }} />
        </div>
      ) : recent.length === 0 ? (
        <div className="doc-empty">
          No memories yet. Add facts about your Jira instance — field IDs, conventions, gotchas.
        </div>
      ) : (
        <div className="memory-list">
          {recent.map((mem) => (
            <div key={mem.id} className="memory-item">
              <span className={`memory-source-badge ${SOURCE_CLASS[mem.source] || "memory-src-user"}`}>
                {mem.source || "user"}
              </span>
              <span style={{ flex: 1, fontSize: "12px", minWidth: 0, wordBreak: "break-word" }}>
                {mem.content}
              </span>
              <button
                className="doc-btn-delete"
                onClick={() => handleDelete(mem.id)}
                title="Delete"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="doc-empty" style={{ textAlign: "left", padding: "10px 12px" }}>
        Manage all memories in the CogniRunner admin panel (Apps -&gt; CogniRunner).
      </div>
    </div>
  );
}
