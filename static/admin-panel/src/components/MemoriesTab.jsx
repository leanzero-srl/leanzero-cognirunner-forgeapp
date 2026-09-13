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
    <div className="hard-stop memory-full-banner" role="alert">
      <span className="hard-stop-title memory-full-title">{title}</span>
      <span className="hard-stop-text memory-full-text">{body}</span>
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
  // F-201 — a `platform-cap` refusal is a WALL, not an error line. It means the store has
  // passed Jira's 240 KiB per-value ceiling and no write to it succeeds at all — including
  // the per-row Delete this tab offers, which still rewrites the whole oversized array. The
  // muted grey error line said that in the same voice as "content too long", next to the one
  // control that cannot resolve it, so it read as a retryable hiccup. Kept in its own state
  // (not `error`) so the two render differently and a later fix cannot collapse them.
  const [capRefusal, setCapRefusal] = useState(null);

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

  /**
   * F-201 — ONE home for the `platform-cap` refusal on THIS surface, because the backend
   * can answer it from both writes this tab makes (add and delete) and the remedy sentence
   * is identical for both.
   *
   * The backend's own sentence (memoryPlatformCapMessage) is rendered verbatim — it owns
   * the byte deficit, and retyping the number here would give it a second home. The line
   * after it is OURS, because it is about WHERE THE CONTROL IS: the backend's copy says
   * "the Memories tab", which is ambiguous between the two tabs that both carry that title,
   * and only the admin one has the multi-select bulk delete that can actually clear a
   * byte-capped store. This tab has a single-row Delete, which is refused by the same wall.
   *
   * Returns true when it consumed the result, so callers do not also set `error`.
   */
  const consumeCapRefusal = (result) => {
    if (!result || result.reason !== "platform-cap") return false;
    // F-207 — the wall and the grey `error` line are two severities of the SAME slot:
    // whatever the last write said. Leaving a stale grey line above a red wall shows the
    // reader two different accounts of one refusal, so consuming a wall clears the line.
    setError(null);
    setCapRefusal({ error: result.error, bytesOver: result.bytesOver });
    return true;
  };

  /* F-207 — a refusal wall describes the LAST write. Any write that LANDS falsifies it,
     so every success path clears both the wall and the grey error. Before this, only
     delete cleared the wall: an add that succeeded after the store had been repaired in
     the other tab left "no change can be saved" sitting over a memory that had just been
     saved — the screen contradicting itself, with the newer fact the invisible one. */
  const clearRefusals = () => { setCapRefusal(null); setError(null); };

  const handleAdd = async () => {
    const content = newContent.trim();
    if (!content || adding) return;
    setAdding(true);
    setError(null);
    try {
      const result = await invoke("addMemory", { content, source: "user" });
      if (result.success) {
        clearRefusals();
        setNewContent("");
        await refreshMemories();
        if (result.id) setNewMemoryId(result.id);
        showToast("Memory saved");
        if (onChanged) onChanged();
      } else if (!consumeCapRefusal(result)) {
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
        // A delete that lands is one of the things that can clear the wall, so drop it
        // here rather than waiting for the next write to rediscover it is gone.
        clearRefusals();
        await refreshMemories();
        if (onChanged) onChanged();
      } else if (!consumeCapRefusal(result)) {
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

      {/* F-201 — the capacity wall, rendered as the SAME solid red block the admin tab uses
          (F-189): #dc2626 fill, white text, 700 title, full border radius, no left rail and
          no tint — owner design law, dark override one shade lighter in injectStyles().
          It is deliberately not the grey `error` line below: a platform-cap refusal is not
          a retryable hiccup, it is the state in which every control on this tab is refused.
          First line is the BACKEND'S sentence verbatim (memoryPlatformCapMessage owns the
          byte deficit). Second line is ours, and F-208 turned it from an instruction into a
          STATEMENT because the admin panel's bulk delete was then admin-gated: telling a
          project editor to "open Apps → CogniRunner → Memories and delete several at once"
          was sending them to a control they would not be given.

          F-225 — that premise died with F-219, which moved the admin tab's select column,
          row actions and bulk-delete bar from `isAdmin` onto `canEdit`, because `deleteMemory`
          gates on requireRole(accountId, "editor") and always did. An editor reading this tab
          CAN go and clear the store, so the statement form now withholds the one instruction
          that would work, and "A Jira admin has to..." is additionally false for the reader
          who most needs it — an app-demoted site admin IS the Jira admin, so it sent them to
          themselves (the same defect F-219 fixed in the admin tab's own wall). Back to an
          instruction, with the roles that can actually follow it named in it. */}
      {capRefusal && (
        <div className="hard-stop memory-cap-refusal" role="alert">
          <span className="hard-stop-title memory-cap-refusal-title">Memory store is over Jira&apos;s storage limit</span>
          <span className="hard-stop-text memory-cap-refusal-text">
            {capRefusal.error || "The store is over the limit, so no change to it can be saved."}
          </span>
          <span className="hard-stop-text memory-cap-refusal-text">
            Open Apps → CogniRunner → Memories, select several memories and delete them
            together (editors and admins can).
          </span>
        </div>
      )}

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
