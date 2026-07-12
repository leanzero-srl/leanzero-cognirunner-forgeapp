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

import React, { useState, useEffect, useCallback, useRef } from "react";
import { showToast } from "./toast";
import { confirmDialog } from "../confirmDialog";

const SOURCE_CLASS = {
  user: "memories-admin-src-user",
  test: "memories-admin-src-test",
  fix: "memories-admin-src-fix",
};

export default function MemoriesAdminTab({ invoke, isAdmin }) {
  const [memories, setMemories] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [newContent, setNewContent] = useState("");
  const [adding, setAdding] = useState(false);
  // Which settings key is mid-save (toggles are optimistic — this only drives
  // the small spinner next to the row and the concurrent-edit guard).
  const [savingSettingKey, setSavingSettingKey] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editContent, setEditContent] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  // "archive:<id>" | "delete:<id>" — drives the .is-busy spinner on the
  // clicked row button and disables the rest while the call is in flight.
  const [working, setWorking] = useState(null);
  const [error, setError] = useState(null);
  const hasLoadedRef = useRef(false);

  const loadMemories = useCallback(async () => {
    try {
      const result = await invoke("getMemories");
      if (result.success) {
        setMemories(result.memories || []);
        setSettings(result.settings || null);
        setLoadError(false);
        hasLoadedRef.current = true;
      } else if (!hasLoadedRef.current) {
        setLoadError(true);
      }
    } catch (e) {
      console.error("Failed to load memories:", e);
      if (!hasLoadedRef.current) setLoadError(true);
    }
    setLoading(false);
  }, [invoke]);

  useEffect(() => { loadMemories(); }, [loadMemories]);

  const handleToggleSetting = async (key) => {
    if (!isAdmin || !settings || savingSettingKey) return;
    // Optimistic: flip immediately, revert on failure (same pattern as the
    // MCP toggles in OpenAIConfig). All writes are functional updates touching
    // ONLY the toggled key — a concurrent loadMemories (archive/delete/add)
    // may replace the settings object mid-save, and a whole-object restore
    // would clobber it.
    const prevValue = settings[key];
    const nextValue = !prevValue;
    setSettings((s) => ({ ...s, [key]: nextValue }));
    setSavingSettingKey(key);
    setError(null);
    try {
      const result = await invoke("saveMemorySettings", { [key]: nextValue });
      if (result.success === false) {
        setSettings((s) => ({ ...s, [key]: prevValue }));
        showToast(result.error || "Failed to save settings", "error");
      } else {
        // Re-assert the saved value — a stale getMemories response landing
        // mid-save can otherwise durably show the OLD value.
        setSettings((s) => ({ ...s, [key]: nextValue }));
      }
    } catch (e) {
      setSettings((s) => ({ ...s, [key]: prevValue }));
      showToast("Failed to save settings: " + e.message, "error");
    }
    setSavingSettingKey(null);
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
        showToast("Memory added");
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
    if (working) return;
    setWorking(`archive:${mem.id}`);
    setError(null);
    try {
      const result = await invoke("updateMemory", { id: mem.id, disabled: !mem.disabled });
      if (result && result.success === false) {
        showToast(result.error || "Failed to update memory", "error");
      } else {
        await loadMemories();
        showToast(mem.disabled ? "Memory restored" : "Memory archived");
      }
    } catch (e) {
      showToast("Failed to update memory: " + e.message, "error");
    }
    setWorking(null);
  };

  const handleDelete = async (id) => {
    if (working) return;
    if (!(await confirmDialog("This permanently deletes the memory and cannot be undone.", { title: "Delete this memory?", confirmLabel: "Delete" }))) return;
    setWorking(`delete:${id}`);
    setError(null);
    try {
      const result = await invoke("deleteMemory", { id });
      if (result && result.success === false) {
        showToast(result.error || "Failed to delete memory", "error");
      } else {
        await loadMemories();
        showToast("Memory deleted");
      }
    } catch (e) {
      showToast("Failed to delete memory: " + e.message, "error");
    }
    setWorking(null);
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
              className={`btn-small${savingEdit ? " is-busy busy-solid" : ""}`}
              onClick={saveEdit}
              disabled={savingEdit || !editContent.trim()}
              style={{ background: "#0d9488", color: "#ffffff", border: "none", fontWeight: 700 }}
            >
              Save
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
              <button className="btn-small" onClick={() => startEdit(mem)} disabled={!!working}>Edit</button>
            )}
            <button
              className={`btn-small${working === `archive:${mem.id}` ? " is-busy" : ""}`}
              onClick={() => handleArchive(mem)}
              disabled={!!working}
            >
              {mem.disabled ? "Restore" : "Archive"}
            </button>
            <button
              className={`btn-small btn-danger${working === `delete:${mem.id}` ? " is-busy" : ""}`}
              onClick={() => handleDelete(mem.id)}
              disabled={!!working}
            >
              Delete
            </button>
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
        <div className="card memories-admin-toggles anim-rise">
          {(() => {
            // Narrate the two-gate chain, accurate to the backend (index.js:863): memories reach RUNTIME
            // (validators/conditions/semantic PFs) only when BOTH "Inject into AI" (master) AND runtime
            // injection are ON; design-time codegen/fix is gated on the master alone.
            const inj = !!settings.injection;
            const rt = !!settings.runtimeInjection;
            const state = !inj ? "off" : (rt ? "both" : "design");
            const COPY = {
              off: { cls: "mem-gate-off", label: "Memories aren’t being used anywhere",
                text: rt
                  ? "“Inject memories into AI prompts” is off, so no memories reach any AI path — runtime injection below has no effect until you turn it on."
                  : "“Inject memories into AI prompts” is off — turn it on to feed active memories into every AI code generation and fix." },
              design: { cls: "mem-gate-design", label: "Memories improve code generation only",
                text: "They are NOT used at runtime — validators, conditions, and semantic post-functions run without them. Turn on runtime injection below to also use memories on live transitions (adds tokens per run)." },
              both: { cls: "mem-gate-both", label: "Memories are active everywhere",
                text: "Included in every AI code generation and fix, AND in validators, conditions, and semantic post-functions on every live transition." },
            }[state];
            return (
              <div className={`mem-gate-banner ${COPY.cls}`} role="status">
                <span className="mem-gate-eyebrow">§ WHERE MEMORIES GO</span>
                <span className="mem-gate-label">{COPY.label}</span>
                <span className="mem-gate-text">{COPY.text}</span>
              </div>
            );
          })()}
          <div className="memories-admin-toggle-row">
            <input
              type="checkbox"
              id="mem-auto-capture"
              checked={!!settings.autoCapture}
              disabled={savingSettingKey !== null}
              onChange={() => handleToggleSetting("autoCapture")}
            />
            <div>
              <label className="memories-admin-toggle-label" htmlFor="mem-auto-capture">
                Learn from production failures
                {savingSettingKey === "autoCapture" && (
                  <span className="spin-ring spin-ring-sm" style={{ marginLeft: "8px", verticalAlign: "-2px" }} />
                )}
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
              disabled={savingSettingKey !== null}
              onChange={() => handleToggleSetting("injection")}
            />
            <div>
              <label className="memories-admin-toggle-label" htmlFor="mem-injection">
                Inject memories into AI prompts
                {savingSettingKey === "injection" && (
                  <span className="spin-ring spin-ring-sm" style={{ marginLeft: "8px", verticalAlign: "-2px" }} />
                )}
              </label>
              <div className="memories-admin-toggle-copy">
                When enabled, active memories are included in every AI code generation and fix.
              </div>
            </div>
          </div>
          <div className="memories-admin-toggle-row">
            <input
              type="checkbox"
              id="mem-runtime-injection"
              checked={!!settings.runtimeInjection}
              disabled={savingSettingKey !== null}
              onChange={() => handleToggleSetting("runtimeInjection")}
            />
            <div>
              <label className="memories-admin-toggle-label" htmlFor="mem-runtime-injection">
                Use memories in validators & semantic post-functions (runtime)
                {savingSettingKey === "runtimeInjection" && (
                  <span className="spin-ring spin-ring-sm" style={{ marginLeft: "8px", verticalAlign: "-2px" }} />
                )}
              </label>
              <div className="memories-admin-toggle-copy">
                When enabled, project-scoped memories are added to every validator, condition,
                and semantic post-function AI call. This adds a small token cost to every
                workflow transition that runs AI. Off by default.
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
        <button className={`btn-add-memory${adding ? " is-busy busy-solid" : ""}`} onClick={handleAdd} disabled={adding || !newContent.trim()}>
          Add Memory
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
        ) : loadError ? (
          <div style={{ padding: "14px" }}>
            <div className="load-error">
              <span>Couldn't load memories.</span>
              <button className="btn-retry" onClick={() => { setLoading(true); setLoadError(false); loadMemories(); }}>Retry</button>
            </div>
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
            <tbody className="stagger">
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
