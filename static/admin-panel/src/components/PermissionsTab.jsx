/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import CustomSelect from "./CustomSelect";
import { showToast } from "./toast";
import { confirmDialog } from "../confirmDialog";

const ROLE_OPTIONS = [
  { value: "viewer", label: "Viewer" },
  { value: "editor", label: "Editor" },
  { value: "admin", label: "Admin" },
];

const SCOPE_OPTIONS = [
  { value: "own", label: "Own Rules" },
  { value: "all", label: "All Rules" },
];

const ROLE_DESCRIPTIONS = {
  viewer: "Can view rules and logs",
  editor: "Can edit, disable, and manage rules and docs",
  admin: "Full access including permissions and settings",
};

const scopeLabel = (role, scope) => {
  if (role === "admin") return "All rules (always)";
  return scope === "all" ? "All rules" : "Own rules only";
};

export default function PermissionsTab({ invoke }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchedEmpty, setSearchedEmpty] = useState(false);
  const [adding, setAdding] = useState(null);
  const [addRole, setAddRole] = useState("viewer");
  const [addScope, setAddScope] = useState("own");
  const [removing, setRemoving] = useState(null);
  const [changingRole, setChangingRole] = useState(null);
  // accountId of a just-added user — drives the one-shot .flash-success on its card
  const [flashId, setFlashId] = useState(null);
  const [error, setError] = useState(null);
  const searchTimer = useRef(null);
  // Monotonic token — a slow older search response must never overwrite the
  // results of a newer one.
  const searchTokenRef = useRef(0);

  const loadUsers = useCallback(async () => {
    try {
      const result = await invoke("getAppAdmins");
      if (result.success) {
        setUsers(result.admins || []);
        setLoadError(false);
      } else {
        setLoadError(true);
      }
    } catch (e) {
      console.error("Failed to load users:", e);
      setLoadError(true);
    }
    setLoading(false);
  }, [invoke]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  // Pending debounce must not fire into an unmounted component.
  useEffect(() => () => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
  }, []);

  const doSearch = async (query) => {
    const token = ++searchTokenRef.current;
    if (!query || query.length < 2) {
      setSearchResults([]);
      setSearchedEmpty(false);
      setSearching(false);
      return;
    }
    // Clear stale results immediately — they must not stay clickable while
    // the new search is in flight.
    setSearchResults([]);
    setSearchedEmpty(false);
    setSearching(true);
    try {
      const result = await invoke("searchUsers", { query });
      if (token !== searchTokenRef.current) return; // stale response
      if (result.success) {
        const found = result.users || [];
        setSearchResults(found);
        setSearchedEmpty(found.length === 0);
      }
    } catch (e) {
      if (token !== searchTokenRef.current) return;
      console.error("User search failed:", e);
    }
    if (token === searchTokenRef.current) setSearching(false);
  };

  const handleSearchChange = (e) => {
    const val = e.target.value;
    setSearchQuery(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => doSearch(val), 400);
  };

  const handleAdd = async (user) => {
    setAdding(user.accountId);
    setError(null);
    try {
      const effectiveScope = addRole === "admin" ? "all" : addScope;
      const result = await invoke("addAppAdmin", { accountId: user.accountId, displayName: user.displayName, role: addRole, scope: effectiveScope });
      if (result.success) {
        setUsers([...users, { accountId: user.accountId, displayName: user.displayName, avatarUrl: user.avatarUrl, role: addRole, scope: effectiveScope }]);
        setSearchQuery("");
        setSearchResults([]);
        setSearchedEmpty(false);
        setFlashId(user.accountId);
        showToast("Admin added");
      } else {
        showToast(result.error || "Failed to add user", "error");
      }
    } catch (e) { showToast("Failed to add user: " + e.message, "error"); }
    setAdding(null);
  };

  const handleRemove = async (accountId) => {
    if (removing) return;
    if (!(await confirmDialog("This user will lose CogniRunner access.", { title: "Remove user access?", confirmLabel: "Remove" }))) return;
    setRemoving(accountId);
    setError(null);
    try {
      const result = await invoke("removeAppAdmin", { accountId });
      if (result.success) {
        setUsers(users.filter((a) => (typeof a === "string" ? a : a.accountId) !== accountId));
      } else {
        showToast(result.error || "Failed to remove user", "error");
      }
    } catch (e) { showToast("Failed to remove user: " + e.message, "error"); }
    setRemoving(null);
  };

  const handleRoleChange = async (accountId, newRole, newScope) => {
    if (changingRole) return;
    const effectiveScope = newRole === "admin" ? "all" : (newScope || "own");
    // Optimistic: the select reflects the choice immediately. On failure revert
    // ONLY this user's role/scope — restoring a whole-list snapshot would wipe
    // users added/removed concurrently.
    const uid = (u) => (typeof u === "string" ? u : u.accountId);
    const target = users.find((u) => uid(u) === accountId);
    const prevRole = target && typeof target !== "string" ? target.role : undefined;
    const prevScope = target && typeof target !== "string" ? target.scope : undefined;
    setUsers((cur) => cur.map((u) => (uid(u) === accountId ? { ...u, role: newRole, scope: effectiveScope } : u)));
    const revert = () => setUsers((cur) => cur.map((u) => (uid(u) === accountId ? { ...u, role: prevRole, scope: prevScope } : u)));
    setChangingRole(accountId);
    setError(null);
    try {
      const result = await invoke("updateUserRole", { accountId, role: newRole, scope: effectiveScope });
      if (!result.success) {
        revert();
        showToast(result.error || "Failed to update role", "error");
      }
    } catch (e) {
      revert();
      showToast("Failed to update role: " + e.message, "error");
    }
    setChangingRole(null);
  };

  const getInitials = (name) => {
    if (!name) return "?";
    const parts = name.split(" ").filter(Boolean);
    return parts.length > 1
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : name.substring(0, 2).toUpperCase();
  };

  const isAlreadyAdded = (accountId) =>
    users.some((a) => (typeof a === "string" ? a : a.accountId) === accountId);

  const getRoleBadgeClass = (role) => {
    if (role === "admin") return "type-condition";
    if (role === "editor") return "type-postfunction";
    return "type-validator";
  };

  return (
    <div className="perm-tab">
      <div className="perm-header">
        <div className="perm-header-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 00-3-3.87" />
            <path d="M16 3.13a4 4 0 010 7.75" />
          </svg>
        </div>
        <div>
          <h3 className="perm-title">User Permissions</h3>
          <p className="perm-subtitle">
            Manage who can access CogniRunner and what they can do.
            Jira site administrators always have admin access.
          </p>
        </div>
      </div>

      {error && (
        <div className="alert alert-error" style={{ marginBottom: "12px" }}>
          <span>{error}</span>
          <button className="alert-dismiss" onClick={() => setError(null)}>&times;</button>
        </div>
      )}

      {/* Role legend */}
      <div style={{ display: "flex", gap: "16px", marginBottom: "12px", flexWrap: "wrap" }}>
        {ROLE_OPTIONS.map((r) => (
          <div key={r.value} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "var(--text-secondary)" }}>
            <span className={`type-badge ${getRoleBadgeClass(r.value)}`} style={{ fontSize: "9px" }}>{r.label}</span>
            <span>{ROLE_DESCRIPTIONS[r.value]}</span>
          </div>
        ))}
      </div>

      {/* Search to add */}
      <div className="perm-search-wrap">
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <div className="perm-search-input-wrap" style={{ flex: 1 }}>
            <svg className="perm-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              className="perm-search-input"
              value={searchQuery}
              onChange={handleSearchChange}
              placeholder="Search by name to add a user..."
            />
            {searching && <span className="spin-ring spin-ring-sm" />}
            {searchQuery && !searching && (
              <button className="perm-search-clear" onClick={() => { searchTokenRef.current++; setSearchQuery(""); setSearchResults([]); setSearchedEmpty(false); }}>&times;</button>
            )}
          </div>
          <div style={{ width: "110px" }}>
            <CustomSelect
              value={addRole}
              onChange={(v) => { setAddRole(v); if (v === "admin") setAddScope("all"); }}
              options={ROLE_OPTIONS}
            />
          </div>
          {addRole !== "admin" && (
            <div style={{ width: "120px" }}>
              <CustomSelect
                value={addScope}
                onChange={setAddScope}
                options={SCOPE_OPTIONS}
              />
            </div>
          )}
        </div>

        {/* Search results */}
        {searchResults.length > 0 && (
          <div className="perm-search-results">
            {searchResults.map((user) => {
              const already = isAlreadyAdded(user.accountId);
              const isAdding = adding === user.accountId;
              return (
                <div
                  key={user.accountId}
                  className={`perm-search-item ${already ? "perm-search-disabled" : ""} ${isAdding ? "perm-search-adding" : ""}`}
                  onClick={() => { if (!already && !isAdding) handleAdd(user); }}
                >
                  {user.avatarUrl ? (
                    <img className="perm-avatar" src={user.avatarUrl} alt="" />
                  ) : (
                    <span className="perm-avatar-placeholder">{getInitials(user.displayName)}</span>
                  )}
                  <span className="perm-search-name">{user.displayName}</span>
                  {already && <span className="perm-search-badge">Already added</span>}
                  {isAdding && (
                    <span className="perm-search-badge" style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                      <span className="spin-ring spin-ring-sm" />
                      Adding as {addRole}
                    </span>
                  )}
                  {!already && !isAdding && (
                    <span style={{ marginLeft: "auto", fontSize: "11px", color: "var(--text-muted)" }}>Add as {addRole}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Completed search with zero matches — say so instead of staying silent */}
        {searchedEmpty && !searching && (
          <div className="anim-fade" style={{ padding: "8px 4px", fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)" }}>
            No users found for &ldquo;{searchQuery}&rdquo;
          </div>
        )}
      </div>

      {/* Current users list */}
      <div className="perm-list stagger">
        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {[1, 2, 3].map((i) => (
              <div key={i} className="perm-admin-card">
                <div className="perm-admin-info">
                  <div className="sk" style={{ width: 36, height: 36, borderRadius: "50%", flexShrink: 0 }} />
                  <div>
                    <div className="sk sk-text" style={{ width: 120, height: 13, marginBottom: 4 }} />
                    <div className="sk sk-text" style={{ width: 80, height: 10 }} />
                  </div>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <div className="sk sk-block" style={{ width: 100, height: 32, borderRadius: 10 }} />
                  <div className="sk sk-block" style={{ width: 60, height: 32, borderRadius: 10 }} />
                </div>
              </div>
            ))}
          </div>
        ) : loadError ? (
          <div className="load-error">
            <span>Couldn't load users.</span>
            <button className="btn-retry" onClick={() => { setLoading(true); setLoadError(false); loadUsers(); }}>Retry</button>
          </div>
        ) : users.length === 0 ? (
          <div className="perm-empty">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
              <circle cx="9" cy="7" r="4" />
            </svg>
            <span>No users added yet. Search above to add one.</span>
          </div>
        ) : (
          users.map((user) => {
            const id = typeof user === "string" ? user : user.accountId;
            const name = typeof user === "string" ? user : user.displayName;
            const avatar = typeof user === "object" ? user.avatarUrl : null;
            const role = typeof user === "object" ? (user.role || "admin") : "admin";
            const scope = typeof user === "object" ? (user.scope || "all") : "all";
            const isRemoving = removing === id;
            const isChanging = changingRole === id;
            return (
              <div key={id} className={`perm-admin-card${flashId === id ? " flash-success" : ""}`}>
                <div className="perm-admin-info">
                  {avatar ? (
                    <img className="perm-avatar" src={avatar} alt="" />
                  ) : (
                    <span className="perm-avatar-placeholder">{getInitials(name)}</span>
                  )}
                  <div>
                    <div className="perm-admin-name">{name}</div>
                    <div className="perm-admin-role">{scopeLabel(role, scope)}</div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <div style={{ width: "100px" }}>
                    <CustomSelect
                      value={role}
                      onChange={(newRole) => handleRoleChange(id, newRole, newRole === "admin" ? "all" : scope)}
                      options={ROLE_OPTIONS}
                      disabled={isChanging}
                    />
                  </div>
                  {role !== "admin" && (
                    <div className="anim-rise" style={{ width: "120px" }}>
                      <CustomSelect
                        value={scope}
                        onChange={(newScope) => handleRoleChange(id, role, newScope)}
                        options={SCOPE_OPTIONS}
                        disabled={isChanging}
                      />
                    </div>
                  )}
                  <button
                    className={`perm-remove-btn${isRemoving ? " is-busy" : ""}`}
                    onClick={() => handleRemove(id)}
                    disabled={isRemoving}
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
