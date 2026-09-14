/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import CustomSelect from "./CustomSelect";
import { showToast } from "./toast";
import { isPermissionRefusal, permissionRefusalText } from "./refusal";
import { confirmDialog } from "../confirmDialog";
import { DEFAULT_ROSTER_SCOPE, VALID_ROLES, VALID_SCOPES } from "../../../../src/shared/roster-roles.js";

/* F-844 — the VALUES come from the shared vocabulary; only the LABELS are local. These
   dropdowns used to re-type `"viewer"/"editor"/"admin"` and `"own"/"all"` verbatim — a
   third copy of an enum the resolvers clamp against. A panel offering a value the
   backend rejects (or silently omitting one it accepts) is a divergence nobody sees
   until a grant fails. Order is the shared array's order: widest reach LAST. A value
   with no label falls back to the raw value rather than rendering blank, so adding a
   role in `src/shared/roster-roles.js` surfaces here immediately instead of vanishing. */
const ROLE_LABELS = { viewer: "Viewer", editor: "Editor", admin: "Admin" };
const SCOPE_LABELS = { own: "Own Rules", all: "All Rules" };

const ROLE_OPTIONS = VALID_ROLES.map((value) => ({ value, label: ROLE_LABELS[value] || value }));

const SCOPE_OPTIONS = VALID_SCOPES.map((value) => ({ value, label: SCOPE_LABELS[value] || value }));

const ROLE_DESCRIPTIONS = {
  viewer: "Can view rules and logs",
  editor: "Can edit, disable, and manage rules and docs",
  admin: "Full access including permissions and settings",
};

const scopeLabel = (role, scope) => {
  if (role === "admin") return "All rules (always)";
  return scope === "all" ? "All rules" : "Own rules only";
};

/* F-645 — a display name is NOT an identity. wolfaenpak holds three accounts whose
   displayName is exactly "Mihai Perdum", the search returns them in an order that is not
   stable between loads, and the roster card that follows a grant reads the same for all
   three. Live, that granted editor to the wrong account twice, and only a KVS read of
   `app_admins` revealed which one. Both surfaces must therefore carry a DISCRIMINATOR
   that differs per account, never a decoration.

   F-647 — the first cut made the two kinds MUTUALLY EXCLUSIVE and put them in different
   namespaces: an email row showed the email and suppressed the account id entirely (not
   in the chip, not in the `title`, not even carried on the returned object), while a
   roster card could only ever show the id segment. So the moment the backend started
   passing an email through (0811b8a), an admin who picked a row BY EMAIL had no mapping
   from that email to either uuid chip on the roster — the F-645 incident verbatim, with
   the "right answer" branch as the enabling condition.

   The rule now, and it is ONE rule for both surfaces:
   - the email is shown WHEN PRESENT (it is the thing an admin can check against the
     person they meant), and
   - the account id's LAST segment is shown ALWAYS, in a solid mono chip, so the same
     string appears on the search row and on the roster card and the two can be matched
     by eye. (Jira ids are `557058:<uuid>`; the prefix is the shared directory id and
     discriminates nothing.)
   - the full id is the `title` on the CHIP (the part that shows only a segment), and the
     email span's `title` is its OWN full address.

   F-651 — that last line used to read "the FULL id is the title on both parts ... so
   nothing is truncated away silently", and it was false about the one part that actually
   truncates. The email is the only shrinkable child of the row, so it is the only thing
   that can ellipsise, and its tooltip carried the account id - the very string the chip
   beside it already prints in full. A pair of namesakes at `+contractor2024` and
   `+contractor2025` therefore rendered identical visible text with no way to recover the
   difference. Now: the email's title is the email, and the CSS never ellipsises it at all
   - it wraps. On the roster card the email gets its own line; in the search dropdown it
   stays beside the chip but wraps to a second line at narrow widths. The chip is still
   `flex: 0 0 auto`, so it is the last thing that would ever give way.
   `handleAdd` therefore passes `emailAddress` through to `addAppAdmin` and carries it on
   the optimistic roster row, which is what lets the card repeat the email the admin
   clicked. */
const accountDiscriminator = (row) => {
  if (!row) return null;
  const rawEmail = typeof row === "object" ? row.emailAddress : null;
  const email = typeof rawEmail === "string" && rawEmail.trim() ? rawEmail.trim() : null;
  const rawId = typeof row === "string" ? row : row.accountId;
  const fullId = typeof rawId === "string" && rawId.trim() ? rawId.trim() : null;
  let seg = null;
  if (fullId) {
    const colon = fullId.lastIndexOf(":");
    seg = (colon >= 0 ? fullId.slice(colon + 1) : fullId) || fullId;
  }
  if (!email && !seg) return null;
  return { email, seg, fullId };
};

/* One renderer, both surfaces — a second copy is how the two namespaces diverged in the
   first place. Email first (human-checkable), id chip always (the cross-surface key). */
function AccountIdent({ disc, variant }) {
  if (!disc) return null;
  /* "card" stacks the two parts so the email owns a full line and can never be cut; the
     search dropdown keeps them side by side (the row is a click target and a two-line
     entry there costs list density), and lets the email wrap instead. */
  const stacked = variant === "card";
  return (
    <div className={`perm-ident-row${stacked ? " perm-ident-row-stacked" : ""}`}>
      {disc.email && (
        <span className="perm-ident perm-ident-email" title={disc.email}>
          {disc.email}
        </span>
      )}
      {disc.seg && (
        <span className="perm-ident perm-ident-id" title={disc.fullId || disc.seg}>
          {disc.seg}
        </span>
      )}
    </div>
  );
}

export default function PermissionsTab({ invoke }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchedEmpty, setSearchedEmpty] = useState(false);
  /* F-259 — the search read only `if (result.success)` and had NO else at all, so every
     non-success answer was swallowed in silence: the spinner stopped, the box stayed empty,
     and the admin was left to conclude that nobody on the site matches their own name. The
     refusal case is the one that hurts — `searchUsers` gates on admin, so the person most
     likely to see this is someone who has just been demoted, and the app's answer was to
     imply the user directory is empty. Holds the result (for `needsRole`) or a plain string
     for a genuine failure; both render in the same slot, and both are better than nothing. */
  const [searchRefusal, setSearchRefusal] = useState(null);
  const [searchError, setSearchError] = useState(null);
  const [adding, setAdding] = useState(null);
  const [addRole, setAddRole] = useState("viewer");
  // F-843 — the Add form seeds the scope from the one home, not a re-typed literal.
  const [addScope, setAddScope] = useState(DEFAULT_ROSTER_SCOPE);
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
      // F-259 — clearing the box clears the message with it.
      setSearchRefusal(null);
      setSearchError(null);
      setSearching(false);
      return;
    }
    // Clear stale results immediately — they must not stay clickable while
    // the new search is in flight.
    setSearchResults([]);
    setSearchedEmpty(false);
    // F-259 — a message from the PREVIOUS query must not outlive it either.
    setSearchRefusal(null);
    setSearchError(null);
    setSearching(true);
    try {
      const result = await invoke("searchUsers", { query });
      if (token !== searchTokenRef.current) return; // stale response
      if (result.success) {
        const found = result.users || [];
        setSearchResults(found);
        setSearchedEmpty(found.length === 0);
      } else if (isPermissionRefusal(result)) {
        /* F-259 — a refusal, told as one. Results are already cleared above, which matters
           here beyond tidiness: a stale row left under this note would be a user this admin
           can no longer act on, rendered next to a sentence saying they have no access. */
        setSearchRefusal(result);
      } else {
        // Answered, and it was a real failure — say what the backend said rather than
        // leaving the admin with an empty box and no reason.
        setSearchError(result.error || "User search failed.");
      }
    } catch (e) {
      if (token !== searchTokenRef.current) return;
      console.error("User search failed:", e);
      // A THROW is transport, never a refusal — but it must still not be silent.
      setSearchError("User search failed.");
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
      /* F-647 — the email rides the grant. Without it the roster card can only ever show a
         uuid segment, so an admin who picked the row BY EMAIL has nothing to match it
         against. The optimistic row carries it too: the card must read the same on this
         render as it will after the next getAppAdmins. */
      const emailAddress = typeof user.emailAddress === "string" && user.emailAddress.trim() ? user.emailAddress.trim() : undefined;
      const result = await invoke("addAppAdmin", { accountId: user.accountId, displayName: user.displayName, role: addRole, scope: effectiveScope, emailAddress });
      if (result.success) {
        setUsers([...users, { accountId: user.accountId, displayName: user.displayName, avatarUrl: user.avatarUrl, role: addRole, scope: effectiveScope, ...(emailAddress ? { emailAddress } : {}) }]);
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
    const effectiveScope = newRole === "admin" ? "all" : (newScope || DEFAULT_ROSTER_SCOPE);
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
              <button className="perm-search-clear" onClick={() => { searchTokenRef.current++; setSearchQuery(""); setSearchResults([]); setSearchedEmpty(false); setSearchRefusal(null); setSearchError(null); }}>&times;</button>
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
            {/* F-645 — the order is exactly as `searchUsers` returned it. Sorting here
                would be a second, quieter version of the same bug: the row an admin
                clicked would move under a rule they cannot see. The fix is to make the
                rows TELLABLE APART, not to pick an order for them. */}
            {searchResults.map((user) => {
              const already = isAlreadyAdded(user.accountId);
              const isAdding = adding === user.accountId;
              const disc = accountDiscriminator(user);
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
                  <div className="perm-search-ident">
                    <span className="perm-search-name">{user.displayName}</span>
                    <AccountIdent disc={disc} />
                  </div>
                  {already &&<span className="perm-search-badge">Already added</span>}
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

        {/* F-259 — the refusal, in the same slot the results would have filled. Slate
            .access-note, no Retry (the gate will answer the same way), and it names the
            level and who grants it. Checked BEFORE the "no users found" arm below, which
            would otherwise be an outright false claim about the directory. */}
        {searchRefusal && !searching && (
          <div className="access-note anim-fade" role="note" style={{ padding: "8px 4px" }}>
            {permissionRefusalText(searchRefusal, "users")}
          </div>
        )}

        {/* F-259 — a genuine failure, also no longer silent. Distinct from the refusal
            above on purpose: this one IS retryable (the admin can simply type again), so it
            does not borrow the refusal's "ask an admin" ending. */}
        {searchError && !searching && !searchRefusal && (
          <div className="anim-fade" style={{ padding: "8px 4px", fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)" }}>
            {searchError}
          </div>
        )}

        {/* Completed search with zero matches — say so instead of staying silent */}
        {searchedEmpty && !searching && !searchRefusal && !searchError && (
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
            /* F-843 — the scope-less roster row reads the SAME here as the backend
               enforces it. This line carried a private `|| "all"` while
               `getUserPermissions` (post F-840) grants such a row `own`, so the card
               announced "All rules" over an editor who in fact reached only their own.
               The default now comes from src/shared/roster-roles.js, the one home.

               The two branches that are NOT the default, and why they stay:
               - `role === "admin"` is "all" BY CONSTRUCTION (both write paths force it,
                 and scopeLabel says "always"), so an admin row never consults the
                 default even when its stored scope is missing; and
               - a LEGACY row (a bare account-id string) reads as role "admin" above,
                 and therefore as scope "all" here — F-840 deliberately did not narrow
                 those, and neither does this. */
            const scope = typeof user === "object"
              ? (user.scope || (role === "admin" ? "all" : DEFAULT_ROSTER_SCOPE))
              : "all";
            const isRemoving = removing === id;
            const isChanging = changingRole === id;
            /* F-645 — the roster is the ONLY place an admin can verify a grant landed
               where they meant it, and the only place Remove is armed. Two cards reading
               "Mihai Perdum / Own rules only" made that button a coin flip, so the
               discriminator belongs here at least as much as on the search. F-647 — and it
               is the SAME discriminator the search row showed: the email when the grant
               carried one, and always the id segment matching the chip that was clicked. */
            const disc = accountDiscriminator(user);
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
                    <AccountIdent disc={disc} variant="card" />
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
