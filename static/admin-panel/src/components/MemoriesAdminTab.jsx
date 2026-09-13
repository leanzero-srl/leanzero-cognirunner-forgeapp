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
 * Memories admin tab. Full management of AI memories: quick-add, inline edit,
 * archive/restore, delete, plus the admin-only auto-learning and prompt
 * injection settings. The config-ui Knowledge panel shows a compact recent
 * view; this tab is the complete table.
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { showToast } from "./toast";
import {
  isPermissionRefusal, permissionRefusalText,
  isUpgradeRequired, upgradeRequiredText, UPGRADE_REQUIRED_HEADLINE,
} from "./refusal";
import { confirmDialog } from "../confirmDialog";
// F-167 — one home for the "store is full" wording; MemoriesTab is the byte-identical
// copy shared with config-ui, so the admin tab and the Knowledge panel never drift.
import { MemoryFullBanner } from "./MemoriesTab";

const SOURCE_CLASS = {
  user: "memories-admin-src-user",
  test: "memories-admin-src-test",
  fix: "memories-admin-src-fix",
};

/**
 * F-189 — the memory store has a BYTE ceiling as well as a row cap, and until now
 * nothing in the UI could see it. `pf_memories` is a single KVS value against a hard
 * ~240KiB platform limit, with the app's own guard sitting below it; a store of 40
 * long memories can refuse a write while the row count reads "40 of 200", which from
 * the admin's chair looks like the app silently deciding not to learn.
 *
 * Rounded to whole KB because that is the unit the limits are expressed in and the
 * only unit an admin can act on — nobody deletes a memory to recover 300 bytes. Under
 * 1 KB we print bytes rather than "0 KB", which would make a real refusal read as no
 * overshoot at all (the shape that hides a bug rather than reporting one).
 */
function fmtBytes(n) {
  if (typeof n !== "number" || !isFinite(n) || n < 0) return null;
  return n < 1024 ? `${Math.round(n)} bytes` : `${Math.round(n / 1024)} KB`;
}

/**
 * F-234 — is this resolver result a PERMISSION REFUSAL rather than a failure?
 *
 * ⚠️ STRING CONTRACT, and a deliberately temporary one. The backend answers every
 * permission refusal through `noPerm(what)` (src/index.js:476), which returns
 * `{ success: false, error: "You don't have permission to <what>." }` — and carries NO
 * machine-readable marker. There is nothing else on the result to branch on, so this
 * matches the sentence, anchored on the stable "don't have permission" stem rather than
 * the full string (the trailing "<what>" differs per resolver: "read memories" here).
 *
 * The DURABLE fix is a structured `reason: "no-permission"` on `noPerm`, which would give
 * every frontend one flag to read instead of N copies of this regex. That is a backend
 * change and outside this cut's territory (static/ only) — it is recorded in the findings
 * ledger. If this ever stops matching, the failure mode is SAFE: the tab falls back to
 * the old "Couldn't load memories." + Retry, which is where it is today.
 *
 * Matching is apostrophe-tolerant because the sentence is retyped by humans and the
 * curly ’ is one autocorrect away from shipping.
 */
/* F-242 — the sentence regex is GONE.
   This helper used to be:
       return /do(?:n['’]t| not) have permission/i.test(String(result.error || ""));
   i.e. the app's permission model was a contract made of English prose. It broke in three
   ways at once. It was invisible — nothing in src/index.js marked those sentences as
   load-bearing, so any reword would have silently turned every refusal back into an
   "outage" with a Retry button. It was INCOMPLETE — the backend refuses in several voices,
   and "Editor access required" (dozens of call sites) never matched this pattern at all, so
   those refusals were already falling through to the failure arm. And it could not report
   WHICH role was wanted, because a regex over prose has no fields.
   F-242 replaced ~60 hand-built refusal literals with one builder that emits
   `reason: "no-permission"` and, where the gate knows it, `needsRole`. This file now reads
   the flag, and the sentence is built from `needsRole` by the shared helper rather than
   hand-typed here — which is also what lets the four other surfaces (F-244/F-245/F-247)
   say the same words without copying them. */

/* F-219 — the UI gate MATCHES THE BACKEND GATE, and nothing else.
   `addMemory`/`updateMemory`/`deleteMemory` all gate on `requireRole(accountId, "editor")`
   (src/index.js:7262/7312/7349). `saveMemorySettings` gates on `requireAdmin` (:7491).
   So the row actions (Edit / Archive / Delete), the select column and the bulk-delete bar
   belong to `canEdit`, and only the settings toggles below belong to `isAdmin`.

   This was not a cosmetic mismatch. Until F-213 the admin page forced `isAdmin = true`, so
   a site admin always had the delete controls and the `isAdmin` gate was never load-bearing.
   F-213 correctly deleted that override — and in doing so made an app-demoted site admin
   land here as an editor with the platform-cap wall and NOT ONE control able to clear it.
   Bulk delete is the only write that can shrink an over-cap store below 240 KiB (a one-row
   delete is refused by the same platform guard, F-188/F-209), so the single repair for the
   store existed nowhere any editor could reach. */
export default function MemoriesAdminTab({ invoke, isAdmin, userRole }) {
  // Admin implies edit; `userRole` is the resolver's answer (checkIsAdmin), passed down from
  // App.js exactly as ListenersTab/JobsTab already receive it. No new resolver, no second
  // authority on role — F-213's law is that `checkIsAdmin` is the only one.
  const canEdit = !!isAdmin || userRole === "editor" || userRole === "admin";
  const [memories, setMemories] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  /* F-234 — an ACCESS REFUSAL is not a load failure, and must not be told as one.
     F-228 put a VIEWER FLOOR on `getMemories` (src/index.js:7341): a user who is not on
     the CogniRunner roster and is not a Jira admin gets `{ success: false }` back. That
     landed in the same `loadError` slot as a network fault, so the tab said "Couldn't
     load memories." next to a Retry button — an outage told as the cause, and a remedy
     that re-asks the identical question and gets the identical no, forever. It is the
     same defect class F-230 fixed for `checkIsAdmin`: never render a refusal as a fault.
     Kept in its OWN state, not a flavour of `loadError`, so the two cannot be collapsed
     back together by a later edit. */
  /* F-242 — holds the REFUSAL RESULT, not a boolean. The note is built from the gate's
     own `needsRole`, so the level can no longer drift from what the backend asked for. */
  const [accessRefusal, setAccessRefusal] = useState(null);
  /* F-296 — the EDITION twin, which this tab never grew. F-255 made the two refusal
     families distinguishable and F-273 gave the rule-editor surfaces an arm for the second
     one; the admin tab kept only the permission arm, so an `upgrade-required` answer
     matched neither the success arm nor isPermissionRefusal and fell straight through to
     `loadError` — "Couldn't load memories." plus a Retry, shown to a tenant whose only
     remedy is to buy an edition. Its OWN state, deliberately: every other branch that
     reads `accessRefusal` (the add-form note, the bulk bar) would otherwise start treating
     a billing answer as a role answer. */
  const [upgradeRefusal, setUpgradeRefusal] = useState(null);
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
  // F-189 — a `platform-cap` refusal is NOT the same outcome as `error`, so it does not
  // share that state. `error` is a muted line ("couldn't save that"); this is a capacity
  // wall that stays until the admin frees room, names how far over the store is, and
  // points at the only control that fixes it. Holds the whole refusal ({ bytesOver, error }).
  const [capRefusal, setCapRefusal] = useState(null);
  // F-189 — what the store WEIGHS, from the dedicated `getMemoryStoreStats` resolver:
  // { rows, bytes, guardBytes, platformBytes, overGuard, overPlatform, storeFull }.
  // Its own call, not a field on getKnowledgeCounts: the counts resolver answers the
  // knowledge CHIP (docs/skills/memories totals) and is called from surfaces that have
  // no business measuring the store. Null until loaded, and null-tolerant forever after —
  // a backend that cannot answer must render the tab exactly as before, never
  // "Store: undefined". The booleans are the BACKEND'S verdict, deliberately: comparing
  // bytes to guardBytes here would be a second copy of the threshold rule.
  const [stats, setStats] = useState(null);
  // F-189 — ids ticked for bulk delete. A Set, not an array: rows toggle one at a time
  // and the row renderer asks "am I selected?" once per row on every keystroke elsewhere.
  const [selected, setSelected] = useState(() => new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const hasLoadedRef = useRef(false);

  const loadMemories = useCallback(async () => {
    try {
      const result = await invoke("getMemories");
      if (result.success) {
        const rows = result.memories || [];
        setMemories(rows);
        setSettings(result.settings || null);
        // F-189 — drop ticks for rows that are no longer there. Without this a bulk
        // delete leaves its own ids selected, so the button keeps offering to delete
        // memories that are already gone and the (n) never returns to zero.
        setSelected((prev) => {
          if (prev.size === 0) return prev;
          const live = new Set(rows.map((m) => m.id));
          const next = new Set();
          prev.forEach((id) => { if (live.has(id)) next.add(id); });
          return next.size === prev.size ? prev : next;
        });
        setLoadError(false);
        setAccessRefusal(null);
        setUpgradeRefusal(null);
        hasLoadedRef.current = true;
      } else if (isPermissionRefusal(result)) {
        /* A refusal is AUTHORITATIVE and is recorded even if a previous load succeeded:
           a role revoked mid-session is a real state, and the honest thing to show is
           "you no longer have access", not the stale table plus a silent failure. */
        setAccessRefusal(result);
        setUpgradeRefusal(null);
        setLoadError(false);
      } else if (isUpgradeRequired(result)) {
        /* F-296 — checked alongside its twin so neither can reach the fault arm. */
        setUpgradeRefusal(result);
        setAccessRefusal(null);
        setLoadError(false);
      } else if (!hasLoadedRef.current) {
        setLoadError(true);
      }
    } catch (e) {
      /* A THROW is a transport fault, never a refusal — the resolver answers refusals
         with a resolved `{ success: false }`. So this arm must not set accessRefusal. */
      console.error("Failed to load memories:", e);
      if (!hasLoadedRef.current) setLoadError(true);
    }
    // F-189 — byte stats are a SEPARATE, best-effort call, deliberately not awaited
    // inside the try above: an older backend with no getMemoryStoreStats resolver (or a
    // failing one) must never turn the memories table into a load error. The table is
    // the point of the tab; the size line is an extra.
    try {
      const st = await invoke("getMemoryStoreStats");
      setStats(st && st.success ? st : null);
    } catch (e) {
      /* stats are an extra, never a gate on the tab rendering */
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

  /**
   * F-189 — ONE home for the `platform-cap` refusal, because the backend can answer it
   * on ANY write (add, edit, and anything added later), not just the add form. Routing
   * it through each caller's `setError` would have buried a capacity wall in the same
   * muted grey line used for "that text is too long", on a tab where the remedy — bulk
   * delete — is three inches away and invisible unless something points at it.
   *
   * Returns true when it consumed the result, so callers stop and do not ALSO set the
   * generic error. Deliberately keyed on `reason`, not on a substring of `error`: the
   * sentence is the backend's to change, the reason code is the contract.
   */
  /**
   * F-215 — a refusal describes the LAST write, so a write that LANDS falsifies it. Every
   * successful path on this tab drops both the red capacity wall and the grey error line,
   * which is the same rule the rule-editor Memories tab already follows (F-207). Before
   * this, add and bulk delete cleared the wall and edit, archive/restore and the per-row
   * delete did not — so an admin could free enough bytes, watch the write succeed, and
   * still be told by a stale red block that nothing can be saved.
   */
  const clearRefusals = () => { setCapRefusal(null); setError(null); };

  const consumeCapRefusal = (result) => {
    if (!result || result.reason !== "platform-cap") return false;
    setCapRefusal(result);
    setError(null);
    // Refresh the size line with it — the numbers that explain the refusal are the ones
    // an admin needs on screen at exactly this moment.
    invoke("getMemoryStoreStats").then((st) => setStats(st && st.success ? st : null)).catch(() => {});
    return true;
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
        clearRefusals();
        await loadMemories();
        showToast("Memory added");
      } else if (!consumeCapRefusal(result)) {
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
        // F-189 — an EDIT can push the store over the byte guard just as an add can
        // (a 40-char memory rewritten to 400), and it lands here, not in handleAdd.
        if (!consumeCapRefusal(result)) setError(result.error || "Failed to update memory.");
      } else {
        clearRefusals();
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
        clearRefusals();
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
        // F-214 — a DELETE is a write, and `pf_memories` is ONE KVS value, so a one-row
        // delete rewrites an array that may STILL be over the platform ceiling and is
        // refused by exactly the guard an add is (src/index.js deleteMemory honours
        // saveMemories' `{ refused: true }`). Routing that through a toast alone put the
        // single state this tab exists to repair into a banner that fades in four seconds,
        // and left whatever deficit a PREVIOUS refusal had printed sitting on screen —
        // stale numbers describing a different attempt. The wall is the primary surface
        // and it is replaced, not appended to; the toast stays as the secondary,
        // "something just happened here" signal.
        consumeCapRefusal(result);
        showToast(result.error || "Failed to delete memory", "error");
      } else {
        clearRefusals();
        await loadMemories();
        showToast("Memory deleted");
      }
    } catch (e) {
      showToast("Failed to delete memory: " + e.message, "error");
    }
    setWorking(null);
  };

  const toggleSelected = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  /**
   * F-189 — bulk delete. Deleting is the ONLY way out of a full store (the app evicts
   * nothing an admin wrote, and archiving frees no capacity — F-176/F-182), so clearing
   * a byte-capped store one confirm dialog at a time was the difference between a
   * recoverable state and an abandoned one.
   *
   * Sends ONE `deleteMemory({ ids })` call rather than N single-id calls: `pf_memories`
   * is a single KVS value, so N calls are N read-modify-writes racing each other, and a
   * partial failure halfway through leaves the admin unable to tell what went.
   */
  const handleDeleteSelected = async () => {
    const ids = Array.from(selected);
    if (!ids.length || bulkDeleting || working) return;
    const n = ids.length;
    if (!(await confirmDialog(
      `This permanently deletes ${n} ${n === 1 ? "memory" : "memories"} and cannot be undone.`,
      { title: `Delete ${n} selected ${n === 1 ? "memory" : "memories"}?`, confirmLabel: "Delete" },
    ))) return;
    setBulkDeleting(true);
    setError(null);
    try {
      const result = await invoke("deleteMemory", { ids });
      if (result && result.success === false) {
        // F-214 — the bulk delete is the REPAIR path, so it is the path most likely to be
        // refused: an admin selects three rows, frees less than the deficit, and the store
        // is still oversized. That answer has to land on the wall with the NEW, smaller
        // deficit, because "how much more do I have to delete" is the only question left
        // on this screen — and the old wall's number would otherwise still read the
        // original overshoot. Selection is deliberately NOT cleared: nothing was deleted,
        // and the admin's next move is to tick more rows, not to start again.
        consumeCapRefusal(result);
        showToast(result.error || "Failed to delete memories", "error");
      } else {
        // A successful delete is the one thing that can clear a capacity wall, so drop
        // it here rather than waiting for the admin's next write to discover it is gone.
        clearRefusals();
        setSelected(new Set());
        await loadMemories();
        // F-202 — `deleted` is an ARRAY of the ids that were actually present and went
        // (src/index.js deleteMemory: `wanted.filter((x) => present.has(x))`), never a
        // number. The old `typeof result.deleted === "number"` arm was dead in production
        // and alive only under the screenshot mock, so the toast always reported `n` — the
        // count the admin TICKED — which is wrong precisely when it matters: a stale list.
        // `notFound` carries the rows that were already gone; saying so is the only thing
        // that explains why 5 ticks removed 3 rows.
        const removedIds = result && Array.isArray(result.deleted) ? result.deleted : null;
        const removed = removedIds ? removedIds.length : n;
        const missing = result && Array.isArray(result.notFound) ? result.notFound.length : 0;
        showToast(
          `${removed} ${removed === 1 ? "memory" : "memories"} deleted`
          + (missing ? ` — ${missing} ${missing === 1 ? "was" : "were"} already gone` : ""),
        );
      }
    } catch (e) {
      showToast("Failed to delete memories: " + e.message, "error");
    }
    setBulkDeleting(false);
  };

  const byNewest = (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  const active = memories.filter((m) => !m.disabled).sort(byNewest);
  const archived = memories.filter((m) => m.disabled).sort(byNewest);
  // F-189 — the select column only exists where there ARE row actions, so the archived
  // divider's colSpan has to move with it. F-219 — that condition is `canEdit`, not
  // `isAdmin`: an editor has every one of those row actions on the backend.
  const colCount = canEdit ? 6 : 5;

  const renderRow = (mem) => (
    <tr key={mem.id} className={mem.disabled ? "memories-admin-archived-row" : undefined}>
      {canEdit && (
        <td className="memories-admin-selcell">
          <input
            type="checkbox"
            className="memories-admin-select"
            checked={selected.has(mem.id)}
            disabled={bulkDeleting}
            onChange={() => toggleSelected(mem.id)}
            aria-label={`Select memory: ${mem.content}`}
          />
        </td>
      )}
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
        {canEdit && (
          <div className="row-actions">
            {editingId !== mem.id && (
              <button className="btn-small" onClick={() => startEdit(mem)} disabled={!!working}>Edit</button>
            )}
            {/* F-182 — Archive is a PROMPT control, not a capacity control, and the button
                alone reads like the polite way to clean up a full store. It is not: the app
                evicts only non-archived auto-captured rows, so an archived memory keeps its
                slot and still counts toward the cap. Say so on the affordance itself, where
                the wrong instinct is acted on, rather than only in the store-full banner. */}
            <button
              className={`btn-small${working === `archive:${mem.id}` ? " is-busy" : ""}`}
              onClick={() => handleArchive(mem)}
              disabled={!!working}
              title={mem.disabled
                ? "Put this memory back into prompts."
                : "Archived memories stay out of prompts but still count toward the cap."}
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

      {settings && settings.storeFull && <MemoryFullBanner storeFull={settings.storeFull} />}

      {/* F-189 — the SIZE of the store, in the unit the guard is actually expressed in.
          The row count has always been visible and the byte total never was, which made a
          byte-guard refusal unreadable: "40 of 200 memories" next to a store that will not
          accept another word. Rendered only when the backend sends the numbers, so an older
          backend keeps the old tab exactly; red once past the guard, because at that point
          it has stopped being a statistic and become the reason nothing is being learned. */}
      {(() => {
        const b = stats && typeof stats.bytes === "number" ? stats.bytes : null;
        const guard = stats && typeof stats.guardBytes === "number" ? stats.guardBytes : null;
        const plat = stats && typeof stats.platformBytes === "number" ? stats.platformBytes : null;
        if (b === null || guard === null) return null;
        // The BACKEND'S verdicts, never a threshold recomputed here — `>=` vs `>` differ
        // between the two ceilings (memoryStoreStats), and a second copy of that rule is
        // exactly the N-disagreeing-copies defect this repo keeps paying for.
        const over = !!stats.overGuard;
        const overPlat = !!stats.overPlatform;
        return (
          <div
            className={`memories-admin-stats${over ? " memories-admin-stats-over" : ""}`}
            role="status"
          >
            Store: {fmtBytes(b)} of {fmtBytes(guard)} guard
            {plat !== null ? ` (platform limit ${fmtBytes(plat)})` : ""}
            {/* Past the PLATFORM ceiling the store cannot take any write at all — not even
                a single-row delete, which still rewrites the whole oversized array. That is
                a different and worse state than "over the guard", and saying so here is the
                only way an admin understands why one-at-a-time deleting does nothing. */}
            {overPlat && (
              <span className="memories-admin-stats-note">
                {" "}— over Jira's storage limit: nothing can be saved until enough memories
                are deleted together.
              </span>
            )}
          </div>
        );
      })()}

      {/* F-189 — a `platform-cap` refusal. Solid red, white text, full border, no rail and
          no tint (owner design law), dark override in injectStyles().
          The sentence is the BACKEND'S, verbatim — memoryPlatformCapMessage(bytesOver) in
          src/shared/registry-limits.js, the same one-home rule F-181/F-190 established for
          the other two refusals. It already names the deficit in bytes and says the store
          cannot take even a one-row delete, which is the whole reason this state needs its
          own wording. Retyping it here would put the number in two places and let them
          disagree, which is this repo's signature defect.
          The second line is OURS to add, because it is about THIS SCREEN's controls: the
          resolver cannot know the tab has a "Delete selected" button.

          F-200 — and it must be branched, because that button is not always there. The Add
          Memory form below is a write control too (an editor is allowed to add — `addMemory`
          gates on requireRole(editor), not admin), and `capRefusal` is raised from `handleAdd`
          and `saveEdit`. So a project editor on an over-platform store is the exact person
          most likely to see this wall. Naming a control that is not rendered for the reader
          is an instruction they cannot follow.

          F-224 — the add form is now `canEdit`-gated like everything else, so BOTH refusal
          paths (`handleAdd`, `saveEdit`) are behind `canEdit` and a viewer can no longer
          raise this wall at all. The non-editor arm below is therefore currently unreachable.
          It is kept, not deleted: it is the correct sentence if any future load-time or
          push-driven refusal reaches a viewer, and the cost of keeping it is one string. A
          viewer's live signal that the store is stuck is the `memories-admin-stats` line,
          which is load-driven and role-independent.

          F-219 — but the branch is `canEdit`, NOT `isAdmin`, and the non-remedy arm no longer
          says "a Jira admin". Both were wrong for the same reason: the controls this wall
          points at are backed by `deleteMemory`, which gates on requireRole("editor"). An
          editor HAS them now, so the editor/admin arm gets the remedy. And the referral arm
          must name the role that can actually act — "a Jira admin" was not merely imprecise,
          it was false in the one case that matters: an app-demoted SITE admin reading this
          wall IS the Jira admin, so the old sentence sent them to themselves. */}
      {capRefusal && (
        <div className="hard-stop memories-admin-capwall" role="alert">
          <span className="hard-stop-title memories-admin-capwall-title">Memory store is over Jira's storage limit</span>
          <span className="hard-stop-text memories-admin-capwall-text">
            {capRefusal.error
              || (fmtBytes(capRefusal.bytesOver)
                ? `The store is ${fmtBytes(capRefusal.bytesOver)} over the limit, so no change to it can be saved.`
                : "The store is over the limit, so no change to it can be saved.")}
          </span>
          <span className="hard-stop-text memories-admin-capwall-text">
            {canEdit
              ? "Select the memories to remove and delete them together. Archiving does not free capacity, and deleting them one at a time will not work."
              : "An editor or admin has to delete memories in this tab before anything can be saved."}
          </span>
        </div>
      )}

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

      {/* F-224 — the add form is a WRITE, and `addMemory` gates on requireRole(accountId,
          "editor") exactly like update and delete (src/index.js:7262). F-219 moved every
          other control on this tab onto `canEdit` and left this one rendered for everyone,
          so a viewer still got a text box and a solid teal "Add Memory" button that the
          backend was always going to refuse. That is the worst shape a permission error can
          take: the UI invites the write, the user composes the sentence they want the AI to
          learn, and the refusal arrives only after they commit to it.
          The non-editor arm is a plain slate note, not a disabled control — a greyed-out
          form still reads as "try again later" when the answer is "not you, ever". */}
      {/* F-296 — an EDITION denial hides the form for an admin too. `canEdit` answers "is
          your ROLE enough"; it cannot answer "does this site's plan include the store", so
          on a Standard tenant a CogniRunner admin got a live Add Memory box stacked above
          an upgrade note — the same invite-then-refuse shape F-224 removed for viewers. */}
      {canEdit && !upgradeRefusal ? (
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
      ) : (accessRefusal || upgradeRefusal) ? null : (
        /* F-243 — TWO notes for one reader. When the read itself was refused, the table
           below already says "You need CogniRunner viewer access to see memories. Ask a
           CogniRunner admin under Permissions." — the complete answer, with the remedy and
           its owner. Stacking "Editors and admins can add memories." above it added a
           second, weaker sentence about a control that is not the reader's problem yet:
           they cannot SEE the store, so telling them who may WRITE to it answers a
           question they have not reached. One refusal, one note — and the one that is
           actionable. Nothing is hidden: the surviving note is the stronger of the two. */
        <div className="memories-admin-add-note">Editors and admins can add memories.</div>
      )}

      {/* F-189 — the bulk-delete bar. Only rendered once something is ticked: an always-on
          "Delete selected (0)" is a dead control that trains the eye to ignore the row the
          real one will appear in. The count is IN the label because this button is the one
          irreversible action on the tab and the confirm dialog should never be the first
          place the admin learns how many rows they picked. */}
      {canEdit && selected.size > 0 && (
        <div className="memories-admin-bulkbar">
          <span className="memories-admin-bulkcount">
            {selected.size} selected
          </span>
          <button
            className={`memories-admin-bulkdelete${bulkDeleting ? " is-busy busy-solid" : ""}`}
            onClick={handleDeleteSelected}
            disabled={bulkDeleting || !!working}
          >
            Delete selected ({selected.size})
          </button>
          <button
            className="btn-small"
            onClick={() => setSelected(new Set())}
            disabled={bulkDeleting}
          >
            Clear selection
          </button>
        </div>
      )}

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
        ) : accessRefusal ? (
          /* F-234 — a REFUSAL, told as one. No Retry: the button would re-ask the same
             question and get the same no, and a control that cannot succeed is worse than
             no control — it keeps the reader trying instead of telling them who to ask.
             Names the remedy and WHO owns it (a CogniRunner admin, under Permissions),
             which is the only thing this reader can act on. Plain slate note, not the red
             hard-stop grammar: nothing is broken and nothing was lost. */
          <div style={{ padding: "14px" }}>
            <div className="memories-admin-denied" role="note">
              {/* F-242 — the LEVEL comes from the gate now (`needsRole`), not from a
                  hand-typed "viewer" that happened to be right for this one resolver. Same
                  sentence when the gate says viewer, so no copy change ships with this. */}
              {permissionRefusalText(accessRefusal, "memories")}
            </div>
          </div>
        ) : upgradeRefusal ? (
          /* F-296 — the EDITION note. Also BEFORE loadError, and carrying no Retry for a
             sharper version of the same reason the refusal above carries none: no number of
             re-asks changes which edition the site is on. Solid orange .upgrade-note — a
             third voice, distinct from the slate refusal (nobody can grant you this) and
             the red hard-stop (something is wrong), because this is the app's one "no" that
             is a PURCHASE decision. */
          <div style={{ padding: "14px" }}>
            <div className="upgrade-note" role="note">
              <span className="upgrade-note-title">{UPGRADE_REQUIRED_HEADLINE}</span>
              <span className="upgrade-note-text">{upgradeRequiredText(upgradeRefusal)}</span>
            </div>
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
                {canEdit && <th className="memories-admin-selcell"></th>}
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
                    {/* F-182 — the section header is where an admin counts up what they have
                        "cleaned up". Without this they read a long archived list as recovered
                        headroom and cannot understand why the store is still refusing. */}
                    <span className="memories-admin-archived-hint">
                      Archived memories stay out of prompts but still count toward the cap.
                    </span>
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
