---
name: atlassian-jira-forge-skill
description: Builds Atlassian Jira Forge apps. Use when creating workflow validators, conditions, post-functions, custom fields, issue panels, global pages, admin pages, dashboard gadgets, triggers, scheduled tasks, or any Forge module for Jira. Covers Jira REST API v3 endpoints, manifest.yml configuration, permissions/scopes, Custom UI (React in sandboxed iframe), dark theme handling, CSS animations, multi-provider AI integration, role-based permissions, KVS storage patterns, async events (Queue/Consumer), workflow rule injection, and 40+ Jira event types. Includes production-tested gotchas, real-world patterns, and 29 Forge module type references.
---

# Atlassian Jira Forge Development

This skill provides documentation for building Forge apps that extend Jira.

## When to Use This Skill

**Use this skill when:**
- You are developing apps specifically for **Jira Cloud**.
- You need to extend Jira functionality using the Forge platform.
- You are working with Jira-specific modules (validators, conditions, post-functions).

**Do NOT use this skill when:**
- You are developing for **Confluence Cloud** (use `atlassian-confluence-forge-skill` instead).
- You are building apps for Atlassian Connect or other platforms.
- You need to perform complex Confluence content management.

It covers:
- Creating workflow validators (validate fields before transition completes)
- Creating workflow conditions (control transition visibility)
- Creating workflow post-functions (execute logic after transition)
- Building custom UIs for workflow rule configuration
- Making Jira REST API calls from a Forge app
- Setting up scheduled triggers and automation actions
- Configuring dashboard widgets or Bitbucket merge checks

## Quick Reference

| Task | Module Type |
|------|-------------|
| Validate fields before transition | `jira:workflowValidator` |
| Control transition visibility | `jira:workflowCondition` |
| Execute logic after transition | `jira:workflowPostFunction` |
| Custom configuration UI | Custom React UI with @forge/bridge |
| Run scheduled tasks | `scheduledTrigger` |
| Create automation actions | `action` |

---

## Core Concepts

Forge is Atlassian's serverless platform for building apps that extend Jira, Confluence, Bitbucket, and Jira Service Management.

### Key Components

- **Module**: A capability declared in manifest.yml
- **Function**: Code executed when a module triggers
- **Resource**: Static assets for Custom UI
- **Resolver**: Bridge between frontend UI and backend functions

### Context Object

Every function receives payload and context:

```javascript
export const handler = async (payload, context) => {
  console.log(context.installContext);
  console.log(context.accountId);
  return { result: true };
};
```

---

## Quick Comparison: Validators vs Conditions vs Post Functions

| Aspect | Validator | Condition | Post Function |
|--------|-----------|-----------|---------------|
| When runs | Before transition completes | Before UI renders | After transition completes |
| Purpose | Validate data before completion | Hide/show transitions in UI | Execute logic after success |
| Failure behavior | Transition blocked, error shown | Transition hidden from user | Error logged, workflow continues |

---

## Module Configuration Examples

### Workflow Validator (Function-based)

```yaml
modules:
  jira:workflowValidator:
    - key: my-validator
      name: My Validator
      description: Validates issue fields
      function: validateContent
      
      create:
        resource: config-ui
```

```javascript
export const validateContent = async (args) => {
  const { issue, configuration } = args;
  
  if (isValid) {
    return { result: true };
  } else {
    return { 
      result: false, 
      errorMessage: "Validation failed" 
    };
  }
};
```

### Workflow Condition

```yaml
modules:
  jira:workflowCondition:
    - key: my-condition
      name: My Condition
      description: Controls visibility
      function: checkLicense
      
      create:
        resource: config-ui
```

```javascript
export const checkLicense = async (args) => {
  return { result: context.license?.isActive };
};
```

### Post Function

```yaml
modules:
  jira:workflowPostFunction:
    - key: my-post-function
      name: My Post Function
      description: Executes after transition
      function: enhanceSummary
      
      create:
        resource: config-ui
```

---

## Common Patterns

See [Problem Patterns](docs/problem-patterns.md) for:

- How to build dropdowns that fetch projects
- How to validate custom fields against external APIs
- How to sync Jira issues with external systems
- Handling rate limits and batching operations

## Available Scripts

Use these scripts to automate common Forge development workflows. They are located in the `scripts/` directory.

| Script | Description |
|--------|-------------|
| `validate-manifest.sh` | Validates `manifest.yml` for errors using `forge lint` |
| `deploy-and-install.sh` | Automates `forge deploy` followed by `forge install --upgrade` |
| `dev-setup.sh` | Starts the Forge development tunnel (supports `-e` for environment) |
| `preflight-check.sh` | Runs a comprehensive environment and manifest validation check |

### 🚀 Recommended Workflow: Plan-Validate-Execute

For high-stakes operations (like deployment or manifest changes), follow this pattern to minimize errors:

1.  **Plan**: Describe the intended changes or commands.
2.  **Validate**: Run `./scripts/preflight-check.sh` and `./scripts/validate-manifest.sh` to ensure the environment and configuration are correct.
3.  **Execute**: Perform the deployment or modification only after validation passes.

### Real-World Implementation Issues & Solutions

**New!** See [Real-World Patterns](docs/24-real-world-patterns.md) for:

- **CSP & Custom UI errors** - "Refused to load script" fixes, inline style workarounds
- **Rate limiting (429)** - Exponential backoff implementations, batching strategies  
- **Storage/KVS issues** - Orphan cleanup patterns, safe storage access with fallbacks
- **Tunnel problems** - Manifest change handling, local dev auth issues
- **Migration pitfalls** - Connect to Forge key mapping, webhook alternatives
- **Performance optimization** - Caching patterns, attachment size budgets
- **Third-party integrations** - OpenAI/Slack network restrictions, env var usage

> This document aggregates real problems from Atlassian Community, GitHub issues, and production Forge apps with verified solutions. Structured for AI models to match user symptoms → solutions quickly.

See [When to Use Which Module](docs/when-to-use-which.md) for choosing the right module type.

## Gotchas

For common pitfalls and environment-specific facts, see [Gotchas](docs/gotchas.md).

## Templates

Copy-paste templates are available in `templates/`:

### Workflow Modules
| Template | Description |
|----------|-------------|
| `validator.yml` | Workflow validator boilerplate with configuration UI example |
| `condition.yml` | Workflow condition boilerplate for visibility control |
| `post-function.yml` | Post function boilerplate for post-transition logic |
| `complex-validator.yml` | Multi-rule validator with dynamic configuration UI |

### Triggers & Events
| Template | Description |
|----------|-------------|
| `scheduled-trigger.yml` | Scheduled trigger (hourly, daily, weekly) for background tasks |
| `webhook-handler.yml` | Event-based handler for Jira events (created, updated, deleted) |
| `trigger-with-filter.yml` | Trigger with advanced event filtering |

### Automation & Actions
| Template | Description |
|----------|-------------|
| `automation-action.yml` | Custom automation action with configurable inputs |
| `bulk-operation.yml` | Bulk issue operations with rate limiting and batching |

### Storage & Configuration
| Template | Description |
|----------|-------------|
| `storage-kvs-example.yml` | Key-value storage patterns for configuration and state |

### UI Components
| Template | Description |
|----------|-------------|
| `ui-modifications.yml` | Custom UI modifications with React components |
| `dashboard-gadget.yml` | Dashboard widget template |

### Integrations
| Template | Description |
|----------|-------------|
| `bitbucket-merge-check.yml` | Bitbucket merge check for pull request validation |


---

## Failure Strategies

When an error occurs during execution, follow these patterns:

- **Manifest/Module Errors**: If a module is not recognized, verify the `manifest.yml` against the [Advanced Documentation](#advanced-documentation) and ensure you are using the correct Jira module names (e.g., `jira:workflowValidator`).
- **Permission Denied (403)**: Check if the required OAuth scopes are defined in the `permissions.scopes` section of your `manifest.yml`. Refer to [07-permissions-scopes.md](docs/07-permissions-scopes.md).
- **API Errors (4xx/5xx)**: 
  - For 404 errors, verify the issue key or project ID exists.
  - For 429 (Rate Limit), implement exponential backoff.
- **Runtime Errors**: Use `forge logs` to inspect the error stack trace and ensure all required environment variables or dependencies are present.

## API Integration

Use `@forge/api` for REST calls:

```javascript
import api, { route } from '@forge/api';

// GET request
const response = await api.asApp().requestJira(route`/rest/api/3/issue/${key}`);
const data = await response.json();

// POST with body
await api.asApp().requestJira(route`/rest/api/3/issue`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ fields: { summary: "New" } })
});
```

See `docs/06-api-endpoints-enhanced.md` for all endpoints.

### asApp() vs asUser() — Critical Decision

Forge provides two execution contexts for Jira API calls:

**`api.asApp()`** — Executes as the app's service account (the "app user"):
- Has the permissions defined in `manifest.yml` scopes
- NOT limited by any individual user's permissions
- Required for: workflow post-functions, validators, background operations, scheduled triggers
- The app user appears in issue history as the actor (e.g., "CogniRunner updated this field")

**`api.asUser(accountId?)`** — Executes as a specific Jira user:
- Respects that user's project roles, permissions, and restrictions
- Requires `allowImpersonation: true` in manifest for explicit accountId
- If called without accountId, uses the current user's context
- Required when: you WANT to enforce user permissions (e.g., showing only issues the user can see)

#### When to Use Which

| Scenario | Use | Why |
|----------|-----|-----|
| **Workflow post-function** (update fields, transition issues) | `asApp()` | Normal users don't have workflow edit permissions. The post-function must act with app authority. |
| **Workflow validator** (read issue data for AI validation) | `asApp()` | Validators need consistent access regardless of who triggers the transition. |
| **Config UI** (fetch fields, screen schemes, metadata) | `asApp()` | Metadata lookups shouldn't depend on user permissions. |
| **Admin panel** (list users, check groups) | `asApp()` | Admin operations need system-level access. |
| **User-facing search** (show issues a user can see) | `asUser()` | Respects security — user only sees what they're allowed to. |
| **User-facing update** (user explicitly edits something) | `asUser()` | Audit trail shows the actual user, not the app. |

#### Post-Function Requirement: Always asApp()

**Post-functions MUST use `asApp()` for all operations.** Here's why:

1. Post-functions execute AFTER a transition succeeds
2. The triggering user may only have "Transition" permission, not "Edit" permission
3. The post-function needs to update fields, create comments, or transition other issues
4. These operations require higher permissions than the user has
5. Using `asUser()` would fail with 403 for users who can transition but not edit

```javascript
// CORRECT — post-function uses app permissions
const createApi = () => ({
  getIssue: async (key) => {
    const res = await api.asApp().requestJira(route`/rest/api/3/issue/${key}`);
    return res.json();
  },
  updateIssue: async (key, fields) => {
    await api.asApp().requestJira(route`/rest/api/3/issue/${key}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields }),
    });
  },
});

// WRONG — will fail for users without edit permissions
const badApi = () => ({
  updateIssue: async (key, fields) => {
    await api.asUser().requestJira(route`/rest/api/3/issue/${key}`, {
      method: "PUT",
      // ...
    }); // 403 Forbidden for most users
  },
});
```

#### Manifest Scopes Required

Both `asApp()` and `asUser()` are limited by the scopes in `manifest.yml`:

```yaml
permissions:
  scopes:
    - read:jira-work    # Read issues, fields, workflows
    - write:jira-work   # Create/update/delete issues (needed for post-functions)
    - read:jira-user    # Read user data (needed for admin group checks)
```

`asApp()` gets full access within these scopes. `asUser()` gets the intersection of these scopes AND the user's own Jira permissions.

#### Audit Trail Impact

- `asApp()` operations show the **app name** in issue history (e.g., "CogniRunner updated the Summary")
- `asUser()` operations show the **user's name** in issue history
- For post-functions, showing the app name is CORRECT — it makes clear the change was automated, not manual

---

## Permissions & Scopes

```yaml
permissions:
  scopes:
    - read:jira-work      # View issues
    - write:jira-work     # Create/update issues
    - read:workflow:jira  # Read workflows
    
  external:
    fetch:
      backend:
        - "api.openai.com"
```

See `docs/07-permissions-scopes.md` for complete scope list.

---

## CLI Commands

| Command | Purpose |
|---------|---------|
| `forge init` | Create new app |
| `forge deploy` | Deploy to development |
| `forge install --upgrade` | Install on site |
| `forge tunnel` | Local testing |
| `forge logs -n 50` | View logs |

See `docs/08-cli-commands.md` for full reference.

---

## Advanced Documentation

The `docs/` directory contains detailed documentation:

### Core Topics
| Topic | File |
|-------|------|
| Core Concepts | `01-core-concepts.md` |
| UI Modifications | `02-ui-modifications.md` |
| Workflow Validators | `02-workflow-validators.md` |
| Workflow Conditions | `03-workflow-conditions.md` |
| Workflow Post Functions | `04-workflow-post-functions.md` |

### Advanced Topics
| Topic | File |
|-------|------|
| Events & Payloads | `05-events-payloads.md` |
| API Endpoints | `06-api-endpoints-enhanced.md` |
| Permissions & Scopes | `07-permissions-scopes.md` |
| CLI Commands | `08-cli-commands.md` |
| Scheduled Triggers | `09-scheduled-triggers.md` |
| Automation Actions | `10-automation-actions.md` |
| Event Filters | `11-event-filters.md` |
| Dashboard Widgets | `12-dashboard-widgets.md` |
| Bitbucket Merge Checks | `13-merge-checks.md` |
| Confluence Content Properties | `14-content-properties.md` |
| Bridge API Reference | `15-bridge-api-reference.md` |
| Resolver Patterns | `16-resolver-patterns.md` |
| UI Kit Components | `17-ui-kit-components.md` |

### Custom UI Documentation (New)
| Topic | File |
|-------|------|
| Complete Custom UI Guide | `21-complete-custom-ui-guide.md` |
| Custom UI Troubleshooting | `18-custom-ui-troubleshooting.md` |
| Rate Limit Handling | `19-rate-limit-handling.md` |
| Performance Optimization | `20-performance-optimization.md` |

### Production Patterns & References
| Topic | File | When to Use |
|-------|------|-------------|
| **Real-World Patterns** | `24-real-world-patterns.md` | CSS animations, skeleton loading, multi-provider AI adapter, role-based permissions, workflow injection, manifest permissions |
| **Forge Modules Reference** | `25-forge-modules-reference.md` | Need to know ANY module type, its properties, events, or constraints. **29 Jira modules + 9 platform modules + 40+ event types** |
| **Gotchas** | `gotchas.md` | Hitting an error? Check here FIRST. Workflow API quirks, CSS timing, status references, field formats, provider auth headers |
| Problem Patterns | `problem-patterns.md` | Common code patterns with examples |
| Module Selection Guide | `when-to-use-which.md` | Choosing between validator vs condition vs post-function |

### Jira REST API
| Topic | File | When to Use |
|-------|------|-------------|
| API Endpoints (Enhanced) | `06-api-endpoints-enhanced.md` | REST API calls from Forge |
| Workflow Operations | `api/workflows.md` | Workflow search, update, transition rules, rule injection |
| Issues | `api/issues.md` | CRUD operations on issues |
| Projects | `api/projects.md` | Project listing, components, versions |
| Search & JQL | `api/search_and_jql.md` | JQL syntax, search API |
| Users | `api/users.md` | User lookup, search |
| Fields & Screens | `api/field_and_screen_management.md` | Field metadata, screen schemes |

### JSM & Other
| Topic | File |
|-------|------|
| JSM Extensions Guide | `22-jira-service-management.md` |

### Templates

All templates include:
- YAML manifest configuration with detailed comments
- JavaScript function handlers with working examples
- React UI components (where applicable)
- Required permissions/scopes section
- Testing instructions

See `templates/` directory for complete, ready-to-use code.

---

## Debugging & Troubleshooting

| Error | Solution |
|-------|----------|
| "Function not found" | Check function keys match manifest |
| "Permission denied" | Add required scope to permissions.scopes |

1. Use `console.log()` for debugging
2. View logs with `forge logs -n 50`
3. Test locally with `forge tunnel`

See `docs/advanced-troubleshooting.md` for detailed troubleshooting guide.

---

## CSS Animations & Styling in Forge Custom UI

Forge Custom UI runs in a sandboxed iframe. CSS animations, transitions, and modern styling work fully — but there are specific patterns and gotchas learned from production.

### Why Styles Must Be Injected at Runtime

Forge iframes have unpredictable CSS loading. External stylesheets and `<style>` blocks in `index.html` may not load before React hydrates. The reliable pattern is **triple-definition**:

1. `src/styles.css` — canonical source (fallback, may not load first)
2. `public/index.html` `<style>` block — prevents flash of unstyled content
3. `App.js` `injectStyles()` function — **the reliable one** that always works

```javascript
const injectStyles = () => {
  if (document.getElementById("app-styles")) return;
  const style = document.createElement("style");
  style.id = "app-styles";
  style.textContent = `/* all your CSS here */`;
  document.head.appendChild(style);
};

// Call immediately in useEffect
useEffect(() => { injectStyles(); }, []);
```

**This is the ONLY method that reliably applies styles in Forge iframes.** The `styles.css` import may be stripped or delayed by the Forge runtime.

### Dark Mode Support

Forge sets `data-color-mode="dark"` on `<html>`. Use CSS custom properties:

```css
:root {
  --bg-color: transparent;  /* MUST be transparent — Forge controls the bg */
  --text-color: #0f172a;
  --primary-color: #2563eb;
  --card-bg: #ffffff;
}

html[data-color-mode="dark"] {
  --text-color: #F5F5F7;
  --primary-color: #3b82f6;
  --card-bg: #13131A;
}
```

Enable theme detection via bridge:
```javascript
import { view } from "@forge/bridge";
if (view?.theme?.enable) await view.theme.enable();
```

### Animations That Work in Forge Iframes

All standard CSS animations work. Tested patterns:

**1. Keyframe animations** — work fully:
```css
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes cardGlow {
  0%, 100% { box-shadow: 0 0 20px rgba(37, 99, 235, 0.15); }
  50% { box-shadow: 0 0 28px rgba(37, 99, 235, 0.25); }
}
@keyframes pulse { 50% { opacity: 0.3; } }
```

**2. Transitions** — work fully, use for hover/focus:
```css
.card {
  transition: all 0.3s ease;
  box-shadow: 0 1px 4px rgba(0,0,0,0.03);
}
.card:hover {
  box-shadow: 0 8px 24px rgba(37, 99, 235, 0.12);
  transform: translateY(-1px);  /* lift effect */
}
```

**3. Focus glow rings** — modern focus indication:
```css
.input:focus {
  border-color: var(--primary-color);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
}
```

**4. Gradient backgrounds** — work for buttons and cards:
```css
.button {
  background: linear-gradient(135deg, #2563eb, #1d4ed8);
  box-shadow: 0 2px 8px rgba(37, 99, 235, 0.25);
}
.button:hover {
  box-shadow: 0 4px 16px rgba(37, 99, 235, 0.4);
  transform: translateY(-1px);
}
```

**5. Breathing glow** — signals active/selected state:
```css
.active-card {
  animation: cardGlow 3s ease-in-out infinite;
}
```

### What Does NOT Work / Gotchas

1. **`backdrop-filter: blur()`** — does not work in Forge iframes (security restriction). Use solid/semi-transparent backgrounds instead.

2. **`overflow: hidden` on parent containers clips child elements** — tooltips, dropdowns, and popovers get clipped. Solution: use `ReactDOM.createPortal(element, document.body)` to render them at body level:
```javascript
import { createPortal } from "react-dom";

// Render tooltip outside the clipping container
{visible && createPortal(
  <div className="tooltip" style={{ position: "absolute", top, left }}>
    {text}
  </div>,
  document.body,
)}
```

3. **`position: fixed`** — works but positions relative to the iframe, not the Jira page. Use `position: absolute` with calculated coords from `getBoundingClientRect()` instead.

4. **Font loading** — external font URLs (Google Fonts etc.) must be whitelisted in manifest.yml CSP:
```yaml
permissions:
  content:
    styles:
      - "unsafe-inline"
    csp:
      style-src:
        - "https://fonts.googleapis.com"
```
Or just use system fonts: `font-family: 'Inter', system-ui, -apple-system, sans-serif;`

5. **CSS custom properties** — work perfectly. This is the recommended approach for theming. Do NOT use CSS-in-JS libraries (they add bundle weight in the iframe).

6. **`@import` in CSS** — unreliable in Forge. Inline everything via `injectStyles()`.

### Dropdown Viewport Awareness

Dropdowns must not overflow the iframe. Measure available space and flip:

```javascript
const triggerRect = wrapRef.current.getBoundingClientRect();
const spaceBelow = window.innerHeight - triggerRect.bottom - 8;
const spaceAbove = triggerRect.top - 8;

if (spaceBelow < panelHeight && spaceAbove > spaceBelow) {
  setFlipUp(true);  // Open upward
}
```

```css
.dropdown-panel { top: calc(100% + 4px); }
.dropdown-panel-up { top: auto; bottom: calc(100% + 4px); }
```

### Tooltip Pattern (Portal-Based)

Tooltips must escape `overflow: hidden` containers. Use portal rendering with calculated position:

```javascript
const show = () => {
  const rect = triggerRef.current.getBoundingClientRect();
  setCoords({
    top: rect.bottom + window.scrollY + 10,
    left: rect.left + rect.width / 2 + window.scrollX,
  });
  setVisible(true);
};

return (
  <>
    <span ref={triggerRef} onMouseEnter={show} onMouseLeave={hide}>?</span>
    {visible && createPortal(
      <span className="tooltip" style={{
        position: "absolute",
        top: `${coords.top}px`,
        left: `${coords.left}px`,
        transform: "translateX(-50%)",
        zIndex: 99999,
      }}>
        {text}
      </span>,
      document.body,
    )}
  </>
);
```

### CodeMirror in Forge Iframes

CodeMirror 6 (`@uiw/react-codemirror`) works in Forge Custom UI. Install:
```
npm install @uiw/react-codemirror @codemirror/lang-javascript @uiw/codemirror-themes @lezer/highlight
```

Custom theme:
```javascript
import { createTheme } from "@uiw/codemirror-themes";
import { tags as t } from "@lezer/highlight";

const myTheme = createTheme({
  theme: "dark",
  settings: {
    background: "#0A0A0F",
    foreground: "#F5F5F7",
    caret: "#3b82f6",
    selection: "#3b82f626",
    gutterBackground: "#0A0A0F",
    gutterForeground: "#71717a",
  },
  styles: [
    { tag: t.keyword, color: "#c678dd" },
    { tag: t.string, color: "#98c379" },
    { tag: t.comment, color: "#71717a", fontStyle: "italic" },
    { tag: t.propertyName, color: "#61afef" },
  ],
});
```

Auto-detect Forge dark mode for CodeMirror:
```javascript
const [isDark, setIsDark] = useState(false);
useEffect(() => {
  const check = () => {
    setIsDark(document.documentElement.getAttribute("data-color-mode") === "dark");
  };
  check();
  const observer = new MutationObserver(check);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-color-mode"],
  });
  return () => observer.disconnect();
}, []);

// Use: theme={isDark ? darkTheme : lightTheme}
```

### manifest.yml CSP for Styles

Required for inline styles to work:
```yaml
permissions:
  content:
    styles:
      - "unsafe-inline"
```

Without this, `injectStyles()` will be blocked by CSP.