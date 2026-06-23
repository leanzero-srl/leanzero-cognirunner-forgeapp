/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import React, { useState, useEffect, useRef } from "react";
import OpenAIConfig from "./OpenAIConfig";

export default function SettingsTab({ invoke }) {
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(null);
  const searchTimer = useRef(null);

  useEffect(() => {
    const load = async () => {
      try {
        const result = await invoke("getAppAdmins");
        if (result.success) setAdmins(result.admins || []);
      } catch (e) {
        console.error("Failed to load admins:", e);
      }
      setLoading(false);
    };
    load();
  }, [invoke]);

  const doSearch = async (query) => {
    if (!query || query.length < 2) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const result = await invoke("searchUsers", { query });
      if (result.success) setSearchResults(result.users || []);
    } catch (e) {
      console.error("User search failed:", e);
    }
    setSearching(false);
  };

  const handleSearchChange = (e) => {
    const val = e.target.value;
    setSearchQuery(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => doSearch(val), 400);
  };

  const handleAdd = async (user) => {
    setAdding(user.accountId);
    try {
      const result = await invoke("addAppAdmin", {
        accountId: user.accountId,
        displayName: user.displayName,
      });
      if (result.success) {
        setAdmins([...admins, { accountId: user.accountId, displayName: user.displayName }]);
        setSearchQuery("");
        setSearchResults([]);
      }
    } catch (e) {
      console.error("Failed to add admin:", e);
    }
    setAdding(null);
  };

  const handleRemove = async (accountId) => {
    try {
      const result = await invoke("removeAppAdmin", { accountId });
      if (result.success) {
        setAdmins(admins.filter((a) => (typeof a === "string" ? a : a.accountId) !== accountId));
      }
    } catch (e) {
      console.error("Failed to remove admin:", e);
    }
  };

  return (
    <div className="settings-tab">
      <OpenAIConfig invoke={invoke} />

      <div className="section">
        <div className="section-header">
          <span className="section-title">App Administrators</span>
        </div>
        <p style={{ fontSize: "12px", color: "var(--text-secondary)", margin: "0 0 12px" }}>
          App admins can manage settings, view all rules and documents, and add other admins.
          Jira site administrators always have admin access.
        </p>

        <div className="card">
          {loading ? (
            <div className="empty-state">Loading...</div>
          ) : admins.length === 0 ? (
            <div className="empty-state">
              No app admins configured. Only Jira site administrators can access settings.
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>User</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {admins.map((admin) => {
                  const id = typeof admin === "string" ? admin : admin.accountId;
                  const name = typeof admin === "string" ? admin : admin.displayName;
                  return (
                    <tr key={id}>
                      <td style={{ fontWeight: "500" }}>{name}</td>
                      <td>
                        <button className="btn-small btn-danger" onClick={() => handleRemove(id)}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Add admin search */}
        <div style={{ marginTop: "12px" }}>
          <input
            type="text"
            value={searchQuery}
            onChange={handleSearchChange}
            placeholder="Search users to add as app admin..."
            style={{ width: "100%", padding: "8px 12px", border: "1px solid var(--border-color)", borderRadius: "4px", background: "var(--input-bg)", color: "var(--text-color)", fontSize: "13px" }}
          />
          {searching && <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: "4px 0" }}>Searching...</p>}
          {searchResults.length > 0 && (
            <div className="card" style={{ marginTop: "4px" }}>
              {searchResults.map((user) => {
                const isAlreadyAdmin = admins.some((a) =>
                  (typeof a === "string" ? a : a.accountId) === user.accountId,
                );
                return (
                  <div key={user.accountId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px", borderBottom: "1px solid var(--border-color)" }}>
                    <span style={{ fontSize: "13px" }}>{user.displayName}</span>
                    {isAlreadyAdmin ? (
                      <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>Already admin</span>
                    ) : (
                      <button
                        className="btn-small"
                        onClick={() => handleAdd(user)}
                        disabled={adding === user.accountId}
                        style={{ background: "var(--primary-color)", color: "white", border: "none" }}
                      >
                        {adding === user.accountId ? "Adding..." : "Add"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
