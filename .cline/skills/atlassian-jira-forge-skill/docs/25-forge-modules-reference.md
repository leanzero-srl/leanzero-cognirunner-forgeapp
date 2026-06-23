# Forge Modules Complete Reference

> Every Forge module type for Jira, Jira Software, and common platform modules. Use this to quickly find the right module, its properties, constraints, and events without web searches.

---

## Jira Modules

### Workflow Modules

| Module | Key | Purpose | Has UI? |
|--------|-----|---------|---------|
| **Workflow Validator** | `jira:workflowValidator` | Block transitions based on custom logic | Config UI only |
| **Workflow Condition** | `jira:workflowCondition` | Hide transitions based on custom logic | Config UI only |
| **Workflow Post Function** | `jira:workflowPostFunction` | Execute logic after transition completes | Config UI only |

**Common properties for all workflow modules:**
```yaml
jira:workflowValidator:
  - key: my-validator
    name: My Validator
    description: Validates field content
    function: validateFunction        # Backend handler
    resolver:
      function: resolver              # For Custom UI invoke() calls
    create:
      resource: config-ui-resource    # UI shown when creating rule
    edit:
      resource: config-ui-resource    # UI shown when editing rule
    view:
      resource: config-view-resource  # Read-only summary view
    projectTypes:
      - company-managed
      - team-managed
```

**Handler signatures:**
```javascript
// Validator/Condition
export const validate = async ({ issue, configuration, modifiedFields, context }) => {
  return { result: true };  // or { result: false, errorMessage: "..." }
};

// Post-Function
export const executePostFunction = async ({ issue, configuration, changelog, transition, context }) => {
  return { result: true };  // Always return true (can't block)
};
```

**Forge rule keys** (for programmatic injection):
- Validator: `forge:expression-validator`
- Condition: `forge:expression-condition`
- Post-Function: `forge:expression-post-function`

---

### Page Modules

| Module | Key | Purpose | Limit |
|--------|-----|---------|-------|
| **Global Page** | `jira:globalPage` | Full page in Apps sidebar | **1 per app** |
| **Admin Page** | `jira:adminPage` | Page in Jira admin settings | Multiple |
| **Project Page** | `jira:projectPage` | Page in project sidebar | Multiple |
| **Project Settings Page** | `jira:projectSettingsPage` | Page in project settings | Multiple |
| **Personal Settings Page** | `jira:personalSettingsPage` | User's personal settings | Multiple |

**jira:globalPage properties:**
```yaml
jira:globalPage:
  - key: my-app-page
    resource: main-resource
    title: My App
    icon: resource:icon-resource;icon.svg   # Shows in sidebar
    layout: native | basic | blank
    resolver:
      function: resolver
    pages:                # Sidebar subpages (can't combine with sections)
      - title: Dashboard
        route: dashboard
        icon: https://example.com/icon.png
      - title: Settings
        route: settings
    sections:             # Grouped sidebar (can't combine with pages)
      - header: Admin
        pages:
          - title: Users
            route: users
    displayConditions:
      ...
```

**CRITICAL:** Only **1** `jira:globalPage` per app. Multiple entries = deployment failure.

**Layout options:**
- `native` (default): Standard Jira page layout
- `basic`: Left margin with breadcrumbs (UI Kit)
- `blank`: Full customization (Custom UI)

---

### Issue View Modules

| Module | Key | Purpose |
|--------|-----|---------|
| **Issue Panel** | `jira:issuePanel` | Panel below issue details |
| **Issue Context** | `jira:issueContext` | Collapsible panel on right side |
| **Issue Glance** | `jira:issueGlance` | Toggleable content panel |
| **Issue Activity** | `jira:issueActivity` | Item in Activity tab |
| **Issue Action** | `jira:issueAction` | Menu item in More Actions (•••) |

**jira:issuePanel properties:**
```yaml
jira:issuePanel:
  - key: my-panel
    resource: main
    title: My Panel
    icon: resource:main;icons/panel.svg
    viewportSize: small | medium | large | xlarge  # Omit for auto-resize
    allowMultiple: false    # Max 5 if true
    resolver:
      function: resolver
```

**Extension context (available to all issue modules):**
```javascript
const context = await view.getContext();
// context.extension = {
//   issue: { id, key, type, typeId },
//   project: { id, key, type },
//   isNewToIssue: boolean,
//   type: "jira:issuePanel",
//   location: "https://site.atlassian.net/browse/PROJ-123"
// }
```

**Listen for issue changes:**
```javascript
import { events } from "@forge/bridge";
events.on("JIRA_ISSUE_CHANGED", (data) => {
  // data: { issueId, projectId, changes: [...] }
  // Delay: up to a few seconds after modification
});
```

---

### Navigation Action Modules

| Module | Key | Location |
|--------|-----|----------|
| **Board Action** | `jira:boardAction` | Board view More Actions (•••) |
| **Backlog Action** | `jira:backlogAction` | Backlog view More Actions (•••) |
| **Sprint Action** | `jira:sprintAction` | Sprint card actions (•••) |
| **Issue Navigator Action** | `jira:issueNavigatorAction` | Issue navigator Apps menu |
| **Command Palette** | `jira:commandPalette` | Cmd+K command palette |

**Command palette example:**
```yaml
jira:command:
  - key: my-command
    title: Open My Dashboard
    shortcut: e e              # Keyboard shortcut
    icon: arrow-right
    target:
      page: my-global-page    # Navigate to global page
    keywords:
      - dashboard
      - my app
```

---

### Field Modules

| Module | Key | Purpose |
|--------|-----|---------|
| **Custom Field** | `jira:customField` | Create a locked custom field instance |
| **Custom Field Type** | `jira:customFieldType` | Create a reusable field type |

**Custom field data types:** `string`, `number`, `user`, `group`, `datetime`, `date`, `object`

**Custom field experiences (where the field renders):**
- `issue-view` — on the issue detail page
- `issue-create` — on the create issue dialog
- `issue-transition` — on the transition screen
- `portal-view` / `portal-request` — JSM portal

**Key constraints:**
- `collection: list` only supports `string`, `group`, `user` types
- `object` type requires `view.formatter.expression` for JQL search
- Max 100 values in collection fields
- Read-only fields not rendered on create/transition screens

---

### Other Jira Modules

| Module | Key | Purpose |
|--------|-----|---------|
| **Dashboard Gadget** | `jira:dashboardGadget` | Widget on Jira dashboards |
| **Dashboard Background Script** | `jira:dashboardBackgroundScript` | Invisible background processing on dashboards |
| **Issue View Background Script** | `jira:issueViewBackgroundScript` | Background processing on issue view |
| **Entity Property** | `jira:entityProperty` | Index custom properties for JQL search |
| **Global Permission** | `jira:globalPermission` | Custom global permission |
| **Project Permission** | `jira:projectPermission` | Custom project-level permission |
| **Time Tracking Provider** | `jira:timeTrackingProvider` | Custom work log experience |
| **UI Modifications** | `jira:uiModifications` | Modify Jira UI elements |
| **Action Validator** | `jira:actionValidator` | Validate specific Jira actions |
| **JQL Function** | `jql:function` | Custom JQL function |

---

## Common/Platform Modules

### Function
```yaml
function:
  - key: my-function
    handler: src/index.myHandler    # File path + export name
    timeoutSeconds: 25              # Default 25, max 900 for scheduled triggers
```

### Consumer (Async Queue)
```yaml
consumer:
  - key: my-consumer
    queue: my-queue-name
    function: my-handler-function

# Usage in resolver:
const { Queue } = await import("@forge/events");
const queue = new Queue({ key: "my-queue-name" });
await queue.push({ body: { taskType: "review", data: {...} } });
```

**Timeout:** Consumer functions get up to **120 seconds** (vs 25s for resolvers).
**Payload limit:** ~200KB per queue push.

### Scheduled Trigger
```yaml
scheduledTrigger:
  - key: my-trigger
    function: my-function
    interval: fiveMinute | hour | day | week
```

**Constraints:**
- Max **5** scheduled triggers per app
- Default timeout: 55s, max: 900s (15 minutes)
- No user principal context (runs as app)
- No retry on failure
- Initial ~5 minute delay after deployment

### Trigger (Event-Driven)
```yaml
trigger:
  - key: my-trigger
    function: my-handler
    events:
      - avi:jira:created:issue
      - avi:jira:updated:issue
    filter:
      ignoreSelf: true
      expression: "event.issue.fields?.project.key == 'PROJ'"
      onError: IGNORE_AND_LOG
```

**Event delivery delay:** Up to **3 minutes**.

### Web Trigger
```yaml
webtrigger:
  - key: my-webhook
    function: my-handler
```

Creates an HTTP endpoint that can be called externally. Get URL via:
```javascript
import { webTrigger } from "@forge/api";
const url = await webTrigger.getUrl("my-webhook");
```

### Other Platform Modules

| Module | Key | Purpose | Status |
|--------|-----|---------|--------|
| **SQL** | `sql` | Structured database storage | Preview |
| **Event** | `event` | Declare custom app events | Preview |
| **LLM** | `llm` | Large language model integration | — |
| **API Route** | `api-route` | Custom REST API endpoints | — |

---

## Jira Software Modules

| Module | Key | Purpose |
|--------|-----|---------|
| **Development Info** | `jira-software-development-info` | Send commit/branch data to Jira |
| **Feature Flag Info** | `jira-software-feature-flag-info` | Send feature flag status |
| **Deployment Info** | `jira-software-deployment-info` | Send deployment pipeline data |
| **Build Info** | `jira-software-build-info` | Send CI/CD build results |
| **Remote Link Info** | `jira-software-remote-link-info` | Manage external resource links |

---

## Jira Event Types (for Triggers)

### Issue Events
| Event | When |
|-------|------|
| `avi:jira:created:issue` | Issue created |
| `avi:jira:updated:issue` | Any field changed |
| `avi:jira:deleted:issue` | Issue deleted |
| `avi:jira:assigned:issue` | Assignee changed |
| `avi:jira:viewed:issue` | Issue viewed |
| `avi:jira:mentioned:issue` | User mentioned in description |

### Comment Events
| Event | When |
|-------|------|
| `avi:jira:commented:issue` | Comment added/edited |
| `avi:jira:mentioned:comment` | User mentioned in comment |
| `avi:jira:deleted:comment` | Comment deleted |

### Issue Link Events
| Event | When |
|-------|------|
| `avi:jira:created:issuelink` | Link created |
| `avi:jira:deleted:issuelink` | Link deleted |

### Worklog Events
| Event | When |
|-------|------|
| `avi:jira:created:worklog` | Time logged |
| `avi:jira:updated:worklog` | Worklog edited |
| `avi:jira:deleted:worklog` | Worklog deleted |

### Version Events
| Event | When |
|-------|------|
| `avi:jira:created:version` | Version created |
| `avi:jira:updated:version` | Version modified |
| `avi:jira:deleted:version` | Version deleted |
| `avi:jira:released:version` | Version released |
| `avi:jira:unreleased:version` | Version unreleased |
| `avi:jira:archived:version` | Version archived |
| `avi:jira:unarchived:version` | Version unarchived |
| `avi:jira:moved:version` | Version reordered |
| `avi:jira:merged:version` | Version merged |

### Issue Type Events
| Event | When |
|-------|------|
| `avi:jira:created:issuetype` | Issue type created |
| `avi:jira:updated:issuetype` | Issue type modified |
| `avi:jira:deleted:issuetype` | Issue type deleted |

### Custom Field Events
| Event | When |
|-------|------|
| `avi:jira:created:field` | Field created |
| `avi:jira:updated:field` | Field modified |
| `avi:jira:trashed:field` | Field trashed |
| `avi:jira:restored:field` | Field restored |
| `avi:jira:deleted:field` | Field permanently deleted |
| `avi:jira:created:field:context` | Field context created |
| `avi:jira:updated:field:context` | Field context modified |
| `avi:jira:deleted:field:context` | Field context deleted |
| `avi:jira:updated:field:context:configuration` | Field context config changed |

### Workflow Events
| Event | When |
|-------|------|
| `avi:jira:failed:expression` | Jira expression evaluation failed |

### Event Payload Common Fields
All events include: `timestamp`, optional `webhookTraceValue`

### Event Filtering
```yaml
filter:
  ignoreSelf: true                              # Skip events from your own app
  expression: "event.issue.fields?.project.key == 'PROJ'"  # Jira expression
  onError: IGNORE_AND_LOG | IGNORE | RECEIVE_AND_LOG | RECEIVE
```

---

## Manifest Quick Reference

### Minimal Manifest Template
```yaml
modules:
  jira:globalPage:
    - key: my-app
      resource: main
      title: My App
      icon: resource:icon-resource;icon.svg
      resolver:
        function: resolver

  function:
    - key: resolver
      handler: src/index.handler

resources:
  - key: main
    path: static/frontend/build
  - key: icon-resource
    path: static/icons

permissions:
  content:
    styles:
      - unsafe-inline
  scopes:
    - read:jira-work
    - storage:app
  external:
    images:
      - address: "*.atlassian.net"

app:
  runtime:
    name: nodejs22.x
  id: ari:cloud:ecosystem::app/YOUR-APP-ID
```

### Scope Reference

| Scope | Grants |
|-------|--------|
| `read:jira-work` | Read issues, fields, JQL search |
| `write:jira-work` | Create/update/delete issues |
| `read:jira-user` | Read user profiles |
| `read:workflow:jira` | Read workflow definitions |
| `write:workflow:jira` | Modify workflows (add rules) |
| `read:project:jira` | Read project info |
| `manage:jira-configuration` | Admin-level config access |
| `storage:app` | Forge KVS read/write |
| `read:issue-type-screen-scheme:jira` | Screen scheme resolution |
| `read:screen-scheme:jira` | Screen scheme details |
| `read:screen-tab:jira` | Screen tab fields |
| `read:screenable-field:jira` | Field screen mapping |

### External Permissions
```yaml
permissions:
  content:
    styles: [unsafe-inline]     # For injectStyles() pattern
  external:
    images:
      - address: "*.atlassian.net"   # Jira avatars in Custom UI iframe
    fetch:
      client:
        - address: https://api.example.com
      backend:
        - address: https://api.example.com
```
