# CogniRunner Permissions & Access Control

> Complete reference for the role-based permission system, scope control, Jira admin detection, and how permissions are enforced across all 47 resolvers.

---

## Overview

CogniRunner has a three-tier permission model with scope control:

```
Role:  viewer → editor → admin
Scope: own | all
```

**Role** determines what actions are available. **Scope** determines which rules those actions apply to.

---

## Roles

### Viewer

**Can:** See rules and execution logs. View documentation.

**Cannot:** Edit, disable, enable, or delete any rules. Cannot access Settings or Permissions tabs.

| Scope | Effect |
|-------|--------|
| `own` | Only sees rules they created (filter defaults to "My Rules", "All Rules" dropdown hidden) |
| `all` | Sees all rules across all workflows (can toggle between "All Rules" and "My Rules") |

### Editor

**Can:** Everything a viewer can, plus: edit/disable/enable rules, clear logs, manage documents, create rules via Add Rule wizard, run tests and AI reviews.

**Cannot:** Access Settings tab (AI provider config), Permissions tab, or manage other users.

| Scope | Effect |
|-------|--------|
| `own` | Can only edit/disable/enable rules they created. Can see all rules but action buttons are hidden for others' rules. |
| `all` | Can edit/disable/enable any rule regardless of who created it. |

### Admin

**Can:** Everything. Full access to all tabs, all rules, all settings, all permissions.

**Scope:** Always `all` (forced). Cannot be set to `own`.

**Special powers:**
- Add/remove users with any role
- Change other users' roles and scopes
- Configure AI provider and API keys
- Access jira:adminPage module

---

## Storage

Users are stored in Forge KVS under the `app_admins` key:

```javascript
[
  {
    accountId: "5f1234567890abcdef",
    displayName: "Mihai Perdum",
    role: "admin",
    scope: "all",
    avatarUrl: "https://..."   // optional
  },
  {
    accountId: "5f0987654321fedcba",
    displayName: "Adrian",
    role: "viewer",
    scope: "own"
  }
]
```

**Legacy compatibility:** Entries without `role` default to `"admin"`. Entries without `scope` default to `"all"`.

---

## Resolution Flow

When a resolver needs to check permissions, it calls `getUserPermissions(accountId)`:

```
1. Check KVS app_admins list
   → Found entry? Return { role, scope }
   
2. Is the list empty? (Bootstrap)
   → Yes: Make this user admin, save to KVS
   → Return { role: "admin", scope: "all" }

3. Check Jira admin groups
   → Try: jira-administrators, site-admins, system-administrators
   → Member of any? Return { role: "admin", scope: "all" }

4. None matched
   → Return null (no access beyond public resolvers)
```

### Bootstrap

The first user to access CogniRunner is automatically bootstrapped as admin:

```javascript
if (appUsers.length === 0) {
  await storage.set(APP_ADMINS_KEY, [{
    accountId,
    displayName: "Auto (first user)",
    role: "admin",
    scope: "all"
  }]);
  return { role: "admin", scope: "all" };
}
```

### Jira Admin Detection

CogniRunner checks three Jira admin group names:

```javascript
const adminGroups = ["jira-administrators", "site-admins", "system-administrators"];
```

For each group, it calls `GET /rest/api/3/group/member?groupname={name}&maxResults=200` and checks if the user's `accountId` is in the list. This requires `manage:jira-configuration` scope.

**Jira site admins always get admin access**, even if they're not in the KVS app_admins list. This ensures the site admin can always recover access.

---

## Permission Checks in Resolvers

### requireRole(accountId, minRole)

Checks if the user's role level is at least the required level:

```javascript
const levels = { viewer: 1, editor: 2, admin: 3 };
return (levels[userRole] || 0) >= (levels[minRole] || 0);
```

Used for: Settings-related resolvers (admin), clear logs (editor), etc.

### canActOnConfig(accountId, config, minRole)

Checks both role AND scope:

```javascript
const canActOnConfig = async (accountId, config, minRole) => {
  const perms = await getUserPermissions(accountId);
  if (!perms) return false;
  
  // Check role level
  if (roleLevel(perms.role) < roleLevel(minRole)) return false;
  
  // Admin or scope "all" → always allowed
  if (perms.role === "admin" || perms.scope === "all") return true;
  
  // Scope "own" → only if they created it (or no owner recorded)
  return !config.createdBy || config.createdBy === accountId;
};
```

Used for: disableRule, enableRule, removeConfig, removePostFunction, deleteContextDoc.

### requireAdmin(accountId)

Shorthand for `requireRole(accountId, "admin")`. Used for: all settings/permissions resolvers.

---

## Resolver Permission Matrix

| Resolver | Check | Notes |
|----------|-------|-------|
| `saveOpenAIKey` | `requireAdmin` | Only admins configure AI |
| `removeOpenAIKey` | `requireAdmin` | |
| `saveProvider` | `requireAdmin` | |
| `saveOpenAIModel` | `requireAdmin` | |
| `getAppAdmins` | `requireAdmin` | |
| `addAppAdmin` | `requireAdmin` | |
| `updateUserRole` | `requireAdmin` | Last admin protection |
| `removeAppAdmin` | `requireAdmin` | Last admin protection |
| `searchUsers` | `requireAdmin` | |
| `clearLogs` | `requireRole("editor")` | |
| `removeConfig` | `canActOnConfig("editor")` | Scope-aware |
| `disableRule` | `canActOnConfig("editor")` | Scope-aware |
| `enableRule` | `canActOnConfig("editor")` | Scope-aware |
| `removePostFunction` | `canActOnConfig("editor")` | Scope-aware |
| `disablePostFunction` | `canActOnConfig("editor")` | Scope-aware |
| `enablePostFunction` | `canActOnConfig("editor")` | Scope-aware |
| `deleteContextDoc` | `canActOnConfig("editor")` | Scope-aware |
| `listProjects` | `requireRole("editor")` | Add Rule wizard |
| `getProjectWorkflows` | `requireRole("editor")` | Add Rule wizard |
| `getWorkflowTransitions` | `requireRole("editor")` | Add Rule wizard |
| `injectWorkflowRule` | `requireRole("editor")` | Add Rule wizard |
| All other resolvers | No check | Public (read-only) |

---

## Frontend Gating

### Tab Visibility

```javascript
const TABS = [
  { key: "rules", label: "Rules" },           // Always visible
  { key: "docs", label: "Documentation" },      // Always visible
  { key: "permissions", label: "Permissions", adminOnly: true },
  { key: "settings", label: "Settings", adminOnly: true },
];
```

### Button Visibility

- **"+ Add Rule" button**: visible for `editor` and `admin` only
- **Edit/Disable buttons** in rules table: visible for `editor` and `admin` only
- **"All Rules / My Rules" dropdown**: visible only for users with `scope: "all"`
- **"Edit Rule" button** in execution logs: visible for `editor` and `admin` only

### Default Filter

- Users with `scope: "all"` → default to "All Rules"
- Users with `scope: "own"` → default to "My Rules" (dropdown hidden)
- Users with no role → default to "My Rules"

---

## Safety Guards

### Last Admin Protection

Cannot remove or demote the last admin:

```javascript
if (role !== "admin") {
  const adminCount = users.filter(u => u.role === "admin").length;
  if (adminCount <= 1 && currentUser.role === "admin") {
    return { success: false, error: "Cannot demote the last admin" };
  }
}
```

Same check for `removeAppAdmin`:

```javascript
if (targetRole === "admin" && adminCount <= 1) {
  return { success: false, error: "Cannot remove the last admin" };
}
```

### Jira Admin Override

Jira site administrators always have admin access, even if not in the KVS list. This provides a recovery path if all app admins are removed.

### jira:adminPage Module

The `jira:adminPage` module (`cognirunner-admin-settings`) is only accessible from Jira's admin settings. Forge guarantees only site admins can reach it. When accessed via this module, `isAdmin` is always `true` regardless of KVS state.
