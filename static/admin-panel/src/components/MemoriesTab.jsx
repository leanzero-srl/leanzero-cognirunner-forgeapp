/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Memories tab of the Knowledge panel. Memories are instance facts the AI
 * injects into every generation (field IDs, conventions, gotchas). Quick-add
 * plus the 5 most recent; full management lives in the admin panel.
 */

import React, { useState, useEffect, useCallback } from "react";
import { invoke } from "@forge/bridge";
import Tooltip from "./Tooltip";
import { showToast } from "./toast";

const SOURCE_CLASS = {
  user: "memory-src-user",
  test: "memory-src-test",
  fix: "memory-src-fix",
};

/**
 * F-179 — the ONE home for the store-full BANNER copy, in the UI layer.
 *
 * Why here and not in src/shared/registry-limits.js: that module is the
 * backend's single source for the CAP POLICY — the constants and the refusal
 * sentence the addMemory resolver returns. Banner copy is not policy, it is
 * this app's chrome, and it is rendered by exactly two React surfaces (the
 * config-ui Memories tab below, and the admin twin which imports
 * MemoryFullBanner from this file). Putting presentation text in the backend's
 * limits module would give the sentence a second owner; putting it in one
 * exported function here gives it one, on the side that renders it.
 *
 * The copy must match the EVICTION POLICY the backend actually implements
 * (F-176/F-177): the app evicts only NON-ARCHIVED auto-captured rows, so
 * hand-authored AND archived rows are never evicted — and archived rows still
 * occupy their slot and still count toward the cap. That makes archiving a
 * non-remedy for a full store, and DELETING the only escape valve. The old
 * wording said "Delete or merge memories", which named an action the app has
 * never offered (there is no merge control; `merged` is a dedup outcome of a
 * save, not something a user can do) and stayed silent about archived rows —
 * so the obvious recovery a user reaches for, archiving, frees nothing and the
 * banner never said so. "prune" went the same way: not a word any control in
 * this app uses.
 *
 * Deliberately NOT branched on `storeFull.reason`. The reason-aware sentence
 * is the backend's refusal (memoryCapRefusalMessage), which renders INLINE
 * under the add form the moment a save is refused. This banner answers a
 * different question — "why has the AI stopped learning, and what do I do" —
 * and the answer is the same for a row-cap and a byte-cap store: delete some.
 *
 * Returns { title, body } so the banner can weight the two spans differently
 * without either caller retyping a word of it.
 */
export function memoryStoreFullCopy(storeFull) {
  const at = storeFull && storeFull.at ? new Date(storeFull.at) : null;
  const when = at && !isNaN(at.getTime()) ? at.toLocaleDateString() : "recently";
  return {
    title: "Memory store is full",
    body: `New lessons are not being kept since ${when}. Archived memories still count toward the cap; delete some to resume learning.`,
  };
}

/**
 * F-167 — the store is FULL and the backend has stopped keeping new lessons.
 * `storeFull` ({ at, reason }) rides getMemorySettings, so it reaches every
 * surface that already reads settings. This is a hard stop, not a hint: solid
 * red, white text, no rail and no tint (owner design law), dark override in
 * injectStyles(). Exported so the admin tab renders the identical wording —
 * both surfaces take their words from memoryStoreFullCopy() above.
 */
export function MemoryFullBanner({ storeFull }) {
  if (!storeFull) return null;
  const { title, body } = memoryStoreFullCopy(storeFull);
  return (
    <div className="memory-full-banner" role="alert">
      <span className="memory-full-title">{title}</span>
      <span className="memory-full-text">{body}</span>
    </div>
  );
}

export default function MemoriesTab({ onChanged = null }) {
  const [memories, setMemories] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null); // mount-load failure — render retry, not "no memories"
  const [refreshing, setRefreshing] = useState(false); // non-initial reload — veil over the visible list
  const [newContent, setNewContent] = useState("");
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState(null); // row whose delete is in flight
  const [newMemoryId, setNewMemoryId] = useState(null); // freshly added row — flashes green
  const [error, setError] = useState(null);

  const loadMemories = useCallback(async () => {
    try {
      const result = await invoke("getMemories");
      if (result.success) {
        setMemories(result.memories || []);
        setSettings(result.settings || null);
        setLoadError(null);
      } else {
        setLoadError(result.error || "Failed to load memories.");
      }
    } catch (e) {
      console.error("Failed to load memories:", e);
      setLoadError(e.message || "Failed to load memories.");
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadMemories(); }, [loadMemories]);

  const retryLoad = () => {
    setLoading(true);
    setLoadError(null);
    loadMemories();
  };

  // Reload the list while keeping the current rows visible under a veil.
  const refreshMemories = async () => {
    setRefreshing(true);
    await loadMemories();
    setRefreshing(false);
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
        await refreshMemories();
        if (result.id) setNewMemoryId(result.id);
        showToast("Memory saved");
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
    if (deletingId) return; // one delete at a time — no double-fires
    setDeletingId(id);
    try {
      const result = await invoke("deleteMemory", { id });
      if (result.success) {
        await refreshMemories();
        if (onChanged) onChanged();
      } else {
        showToast(result.error || "Failed to delete memory.", "error");
      }
    } catch (e) {
      console.error("Failed to delete memory:", e);
      showToast("Failed to delete memory: " + e.message, "error");
    }
    setDeletingId(null);
  };

  const active = memories.filter((mem) => !mem.disabled);
  const recent = [...active]
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, 5);

  return (
    <div className="doc-repo-embedded">
      <div style={{ padding: "10px 12px 0", display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
        <span style={{ fontSize: "12px" }}>
          <span className="kc-mem">{loading || loadError ? "—" : active.length}</span>
          {" "}memories are injected into every generation
        </span>
        {settings && settings.autoCapture === false && (
          <Tooltip text="An admin can enable learning from production failures in the admin panel.">
            <span className="builtin-badge" style={{ cursor: "help" }}>Auto-learning off</span>
          </Tooltip>
        )}
      </div>

      {settings && settings.storeFull && (
        <div style={{ padding: "10px 12px 0" }}>
          <MemoryFullBanner storeFull={settings.storeFull} />
        </div>
      )}

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
          className={`btn-remember${adding ? " is-busy busy-solid" : ""}`}
          onClick={handleAdd}
          disabled={adding || !newContent.trim()}
        >
          Remember
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
      ) : loadError ? (
        <div className="load-error" style={{ margin: "10px 12px" }}>
          <span>Couldn&apos;t load memories.</span>
          <button className="btn-retry" onClick={retryLoad}>Retry</button>
        </div>
      ) : recent.length === 0 ? (
        <div className="doc-empty">
          No memories yet. Add facts about your Jira instance — field IDs, conventions, gotchas.
        </div>
      ) : (
        <div className="veil-host">
          {refreshing && (
            <div className="veil"><span className="spin-ring" /><span className="veil-label">Refreshing…</span></div>
          )}
          <div className="memory-list stagger">
            {recent.map((mem) => (
              <div key={mem.id} className={`memory-item${mem.id === newMemoryId ? " flash-success" : ""}`}>
                <span className={`memory-source-badge ${SOURCE_CLASS[mem.source] || "memory-src-user"}`}>
                  {mem.source || "user"}
                </span>
                <span style={{ flex: 1, fontSize: "12px", minWidth: 0, wordBreak: "break-word" }}>
                  {mem.content}
                </span>
                <button
                  className={`doc-btn-delete${deletingId === mem.id ? " is-busy" : ""}`}
                  onClick={() => handleDelete(mem.id)}
                  disabled={deletingId === mem.id}
                  title="Delete"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="doc-empty" style={{ textAlign: "left", padding: "10px 12px" }}>
        Manage all memories in the CogniRunner admin panel (Apps -&gt; CogniRunner).
      </div>
    </div>
  );
}
