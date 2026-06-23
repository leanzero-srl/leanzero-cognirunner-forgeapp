# Workflow Operations

This module provides comprehensive technical documentation for managing Jira workflows, including workflow configurations, statuses, transitions, transition rules (validators, conditions, post-functions), and their associations with issue types via workflow schemes.

## Overview

Workflows define the lifecycle of issues in Jira. A workflow is a collection of **Statuses** (representing states like "To Do" or "Done") and **Transitions** (the paths that allow moving an issue from one status to another). Each transition can have **rules** attached: conditions (visibility), validators (blocking), and post-functions (after-transition actions).

### Key Concepts

| Concept | Description |
| :--- | :--- |
| **Status** | A specific state in a workflow. Each status has an ID, name, and can have properties (e.g., `jira.issue.editable`). |
| **Transition** | The action that moves an issue from a source status to a target status. |
| **Transition Rule** | Logic attached to a transition: **conditions** control visibility, **validators** block transitions, **post-functions** run after completion. |
| **Workflow Scope** | Workflows can be `GLOBAL` (company-managed) or `PROJECT` (team-managed). |
| **Workflow Scheme** | A mapping that determines which workflow is used for which issue types within a project. |

### Required Forge Scopes

| Scope | Capability |
| :--- | :--- |
| `read:jira-work` | View workflows, statuses, and transitions. |
| `write:jira-work` | Create, update, or delete workflows and schemes. |
| `write:workflow:jira` | Required specifically for updating workflow transitions and rules. |
| `manage:jira-configuration` | Required for administrative changes to global workflows and schemes. |

---

## Core Workflow Operations

### Search Workflows

Returns a paginated list of workflows. Use `expand=values.transitions` to include transition details including rules.

**Endpoint:** `GET /rest/api/3/workflows/search`

**Query Parameters:**

| Name | Type | Description |
| :--- | :--- | :--- |
| `startAt` | `integer` | Page offset. Default: `0`. |
| `maxResults` | `integer` | Max items per page. Default: `50`. |
| `expand` | `string` | Comma-separated list of expansions. **Important:** Use `values.transitions` to get transition rules. |
| `queryString` | `string` | Partial match for workflow name. |
| `scope` | `string` | `GLOBAL` or `PROJECT`. |
| `isActive` | `boolean` | Filter by active/inactive status. |

**Response Example (200 OK) — with `expand=values.transitions`:**

```json
{
  "total": 1,
  "values": [
    {
      "id": "b9ff2384-d3b6-4d4e-9509-3ee19f607168",
      "name": "Software Development Workflow",
      "version": {
        "id": "c44b423d-1234-5678-abcd-ef0123456789",
        "versionNumber": 3
      },
      "statuses": [
        { "id": "10001", "name": "To Do", "statusReference": "uuid-1" },
        { "id": "10002", "name": "In Progress", "statusReference": "uuid-2" }
      ],
      "transitions": [
        {
          "id": "11",
          "name": "Start Progress",
          "type": "DIRECTED",
          "from": [{ "statusReference": "uuid-1" }],
          "to": { "statusReference": "uuid-2" },
          "rules": {
            "conditions": [],
            "validators": [
              {
                "ruleKey": "system:validate-field-value",
                "parameters": {
                  "ruleType": "fieldRequired",
                  "fieldsRequired": "assignee"
                }
              }
            ],
            "postFunctions": [
              {
                "ruleKey": "system:update-issue-status",
                "parameters": {}
              }
            ]
          }
        }
      ],
      "operations": { "canEdit": true, "canDelete": true }
    }
  ]
}
```

---

### Transition Rules Structure

Each transition in a workflow can have three types of rules:

| Rule Type | Array Key | Purpose | Blocks Transition? |
| :--- | :--- | :--- | :--- |
| **Condition** | `rules.conditions` | Controls whether the transition button is visible to the user | No (hides button) |
| **Validator** | `rules.validators` | Validates data before the transition executes | Yes (blocks with error) |
| **Post-Function** | `rules.postFunctions` | Executes logic after the transition completes | No (runs after success) |

**Rule Entry Format:**

```json
{
  "ruleKey": "system:validate-field-value",
  "parameters": {
    "key1": "value1",
    "key2": "value2"
  }
}
```

#### System Rule Keys

| ruleKey | Type | Description |
| :--- | :--- | :--- |
| `system:validate-field-value` | Validator | Checks field is required/has specific value |
| `system:check-permission-validator` | Validator | Checks user has specific permission |
| `system:update-issue-status` | Post-Function | Updates the issue status (always present) |
| `system:fire-issue-event` | Post-Function | Fires workflow event notification |

#### Forge App Rule Keys

Forge apps use special `ruleKey` prefixes:

| Module Type | ruleKey |
| :--- | :--- |
| `jira:workflowValidator` | `forge:expression-validator` |
| `jira:workflowCondition` | `forge:expression-condition` |
| `jira:workflowPostFunction` | `forge:expression-post-function` |

**Forge Rule Parameters:**

```json
{
  "ruleKey": "forge:expression-validator",
  "parameters": {
    "key": "ari:cloud:ecosystem::extension/{appId}/{environmentId}/static/{moduleKey}",
    "config": "{\"fieldId\":\"description\",\"prompt\":\"Validate this\"}",
    "id": "a865ddf6-bb3f-4a7b-9540-c2f8b3f9f6c2",
    "disabled": "false"
  }
}
```

| Parameter | Description |
| :--- | :--- |
| `key` | Extension ARI — uniquely identifies the Forge app module. Format: `ari:cloud:ecosystem::extension/{appId}/{envId}/static/{moduleKey}` |
| `config` | JSON-stringified configuration object (what the `onConfigure` callback returns from Custom UI) |
| `id` | UUID identifying this specific rule instance |
| `disabled` | String `"true"` or `"false"` — whether the rule is bypassed |

---

### Update Workflow

Updates an existing workflow configuration including its transitions and rules. **This is a full replacement** — you must send the entire workflow definition (all statuses, all transitions) when updating.

**Endpoint:** `POST /rest/api/3/workflows/update`

**Request Body Parameters:**

| Name | Type | Description |
| :--- | :--- | :--- |
| `statuses` | `array[object]` | Complete list of statuses in the workflow. |
| `workflows` | `array[object]` | Array of workflow objects to update (usually one). |
| `workflows[].id` | `string` | **Required.** The workflow UUID from search. |
| `workflows[].version` | `object` | **Required.** Current version `{ id, versionNumber }` — must match. Stale version = 409 conflict. |
| `workflows[].statuses` | `array[object]` | All status references in the workflow. |
| `workflows[].transitions` | `array[object]` | All transitions including their rules. |

**Example: Adding a Forge Validator to a Transition**

```json
{
  "statuses": [
    { "id": "10012", "name": "To Do", "statusCategory": "TODO", "statusReference": "uuid-1" },
    { "id": "10013", "name": "Done", "statusCategory": "DONE", "statusReference": "uuid-2" }
  ],
  "workflows": [{
    "id": "b9ff2384-...",
    "version": {
      "id": "c44b423d-...",
      "versionNumber": 3
    },
    "statuses": [
      { "statusReference": "uuid-1" },
      { "statusReference": "uuid-2" }
    ],
    "transitions": [{
      "id": "11",
      "name": "Start Progress",
      "type": "DIRECTED",
      "to": { "statusReference": "uuid-2" },
      "rules": {
        "conditions": [],
        "validators": [
          {
            "ruleKey": "forge:expression-validator",
            "parameters": {
              "key": "ari:cloud:ecosystem::extension/{appId}/{envId}/static/my-validator",
              "config": "{}",
              "id": "new-uuid-here",
              "disabled": "false"
            }
          }
        ],
        "postFunctions": [
          { "ruleKey": "system:update-issue-status", "parameters": {} }
        ]
      }
    }]
  }]
}
```

**Important Considerations:**

- **Full replacement**: You cannot just add a single rule. You must GET the workflow, modify it, then POST the entire definition back.
- **Version conflicts**: The `version.id` and `versionNumber` must match the current workflow version. Use GET first to obtain the latest.
- **"Update in progress" errors (409)**: May occur if another editing session is active or a draft exists.
- **System post-functions**: The `system:update-issue-status` post-function should always be included — removing it breaks transitions.

**Error Responses:**

| Status | Description |
| :--- | :--- |
| `400` | Invalid payload — check ruleKey format and parameters structure. |
| `403` | Insufficient permissions — need `write:workflow:jira` or `manage:jira-configuration`. |
| `409` | Conflict — another workflow update is in progress, or version mismatch. |

---

### Get Single Workflow

Retrieves detailed configuration for a specific workflow.

**Endpoint:** `GET /rest/api/3/workflow/{workflowId}`

**Response Example (200 OK):**

```json
{
  "id": "b9ff2384-d3b6-4d4e-9509-3ee19f607168",
  "name": "Software Development Workflow",
  "version": {
    "id": "c44b423d-...",
    "versionNumber": 3
  },
  "statuses": [
    {
      "id": "10001",
      "name": "To Do",
      "properties": { "jira.issue.editable": true }
    }
  ],
  "transitions": [
    {
      "id": "11",
      "name": "Start Progress",
      "type": "directed",
      "from": ["10001"],
      "to": "10002"
    }
  ],
  "operations": {
    "canEdit": true,
    "canDelete": true
  }
}
```

---

### Delete Workflow

Removes a workflow.

**Endpoint:** `DELETE /rest/api/3/workflows/{workflowId}`

**Error Responses:**

| Status | Description |
| :--- | :--- |
| `403` | Insufficient permissions. |
| `409` | Workflow is currently in use by a scheme. |

---

## Workflow Transition Rule Config API

This separate API allows Forge apps to **read and update the configuration** of rules that were already added by the app. It cannot add new rules — only modify existing ones.

**Endpoint:** `GET /rest/api/3/workflow/rule/config`

**Query Parameters:**

| Name | Type | Description |
| :--- | :--- | :--- |
| `workflowsWithRule` | `string[]` | Workflow IDs to query. |
| `types` | `string[]` | Rule types: `postfunction`, `validator`, `condition`. |

**Note:** This API only returns rules created by the calling app. It uses app-scoped filtering automatically.

---

## Workflow Schemes & Mappings

Workflow schemes act as the glue between workflows and projects.

### Get Workflow Scheme

**Endpoint:** `GET /rest/api/3/workflowscheme/{id}`

**Response Example:**

```json
{
  "id": "scheme-123",
  "name": "Standard Software Scheme",
  "issueTypeMappings": [
    {
      "issueTypeId": "10001",
      "workflowId": "b9ff2384-d3b6-4d4e-9509-3ee19f607168"
    }
  ]
}
```

### Update Scheme Mappings

Update which workflows are assigned to which issue types within a scheme.

**Endpoint:** `PUT /rest/api/3/workflowscheme/update/mappings`

**Request Body Example:**

```json
{
  "workflowSchemeId": "scheme-123",
  "mappings": [
    {
      "issueTypeId": "10001",
      "workflowId": "new-workflow-id-456"
    }
  ]
}
```

### Switch Workflow Scheme for Project

Assign a new workflow scheme to a specific project.

**Endpoint:** `POST /rest/api/3/workflowscheme/project/switch`

**Request Body Example:**

```json
{
  "projectId": "proj-789",
  "workflowSchemeId": "new-scheme-id"
}
```

---

## Technical Implementation Notes

### Transition Types

| Type | Description |
| :--- | :--- |
| `initial` | A transition that leads from no state to the first status of a workflow. |
| `directed` | A transition from a specific source status to a target status. |
| `global` | A transition that can be triggered from any status in the workflow. |

### Company-Managed vs Team-Managed

| Aspect | Company-Managed (Global) | Team-Managed (Project) |
| :--- | :--- | :--- |
| **Scope** | Shared across projects | Per-project |
| **Editing** | Admin-level permissions needed | Project admin can edit |
| **Draft Mode** | v3 API abstracts versioning | No draft concept — changes immediate |
| **Workflow Schemes** | Used to map workflows to issue types | Implicit — one workflow per project |

### Forge Implementation Strategy

| Scenario | Recommended Method | Reason |
| :--- | :--- | :--- |
| **Workflow Discovery** | `api.asApp().requestJira(...)` | App needs to see all workflows regardless of user permissions. |
| **Rule Inspection** | `GET /rest/api/3/workflows/search?expand=values.transitions` | Include transitions to see rules. |
| **Automated Setup** | `POST /rest/api/3/workflows/update` | Full replacement with version control. Use `api.asApp()`. |
| **Config Updates** | `GET /rest/api/3/workflow/rule/config` | Only updates config of app's own existing rules. |

### Common Pitfalls

1. **Missing system post-functions**: Always include `system:update-issue-status` in post-functions when updating transitions.
2. **Stale version**: Always GET the latest workflow before updating — version mismatch causes 409.
3. **Partial updates not supported**: You must send all statuses and all transitions, not just the changed ones.
4. **Environment ID discovery**: The `{envId}` in extension ARIs can be found by inspecting existing Forge rules on a transition via the search API.
5. **Rule ordering**: Post-functions execute in array order. System post-functions (status update) should typically be first.
