# Jira Workflow Post Functions

## Overview

The `jira:workflowPostFunction` module allows Forge apps to execute custom logic **after** a workflow transition completes successfully. Unlike validators, post-functions cannot block the transition — it has already happened. They are used for side effects like updating fields, syncing data, creating linked issues, or sending notifications.

### Key Differences from Validators

| Aspect | Validator | Post-Function |
|--------|-----------|---------------|
| **When** | Before transition | After transition |
| **Can block?** | Yes | No |
| **Timeout** | 25s (resolver limit) | 25s (resolver limit) |
| **User sees** | Error message if blocked | Nothing (runs in background) |
| **Rollback** | Transition doesn't happen | Transition already done — no rollback |

## Manifest Configuration

### Basic

```yaml
modules:
  jira:workflowPostFunction:
    - key: my-post-function
      name: Post-Transition Sync
      description: Syncs issue data after transition
      function: executePostFunction

functions:
  - key: executePostFunction
    handler: src/index.executePostFunction
```

### With Configuration UI

```yaml
modules:
  jira:workflowPostFunction:
    - key: my-post-function
      name: Post-Transition Sync
      description: Syncs issue data after transition
      function: executePostFunction
      resolver:
        function: resolver
      create:
        resource: config-ui-resource
      edit:
        resource: config-ui-resource
      view:
        resource: config-view-resource

functions:
  - key: executePostFunction
    handler: src/index.executePostFunction
  - key: resolver
    handler: src/index.handler

resources:
  - key: config-ui-resource
    path: static/config-ui/build
  - key: config-view-resource
    path: static/config-view/build
```

## Function Payload

```javascript
export const executePostFunction = async (args) => {
  const {
    issue,           // The issue that was transitioned
    configuration,   // JSON-parsed config from onConfigure callback
    changelog,       // Changes made during the transition
    transition,      // The transition that fired
    workflow,        // Workflow metadata
    context,         // Forge context
  } = args;
  
  // Post-functions should always return { result: true }
  // Returning false does NOT block the transition (it already happened)
  return { result: true };
};
```

### `issue` Object

Same structure as validators — see [Workflow Validators](./02-workflow-validators.md) for full field reference.

**Key difference:** `issue.key` is always available (the issue exists by this point). Fields reflect the state **after** the transition, including status changes.

### `changelog` Object

Contains the changes that occurred during the transition:

```javascript
{
  items: [
    {
      field: "status",
      fieldtype: "jira",
      from: "10000",
      fromString: "To Do",
      to: "10001",
      toString: "In Progress"
    },
    {
      field: "assignee",
      fieldtype: "jira",
      from: null,
      fromString: null,
      to: "5f...",
      toString: "John Doe"
    }
  ]
}
```

### `transition` Object

```javascript
{
  transitionId: 11,
  transitionName: "Start Progress",
  from_status: "To Do",
  to_status: "In Progress"
}
```

### `configuration` Object

Same as validators — the JSON-parsed output from `onConfigure`. Structure is app-defined.

For post-functions with `postFunctionConfig` key:
```javascript
const config = context?.extension?.postFunctionConfig
  || context?.extension?.configuration
  || context?.extension?.config;
```

## Configuration UI

The configuration UI pattern is identical to validators. See [Workflow Validators — Configuration UI](./02-workflow-validators.md) for the full `workflowRules.onConfigure()` pattern.

**Key difference for post-functions:** The context extension type is `"jira:workflowPostFunction"` and config may be stored under `postFunctionConfig`:

```javascript
const config = ctx?.extension?.postFunctionConfig
  || ctx?.extension?.configuration;

// Detect module type
const moduleType = ctx?.extension?.type;  // "jira:workflowPostFunction"
const moduleKey = ctx?.extension?.key;     // "my-post-function"
```

## Response Handling

Post-functions run **after** the transition is complete:

1. The transition has already succeeded
2. The user has already seen the success — they're on the next screen
3. Your function runs asynchronously from the user's perspective
4. **Errors cannot block or roll back the transition**
5. Always return `{ result: true }` — the return value is largely ignored

### Error Strategy

Since you can't block or roll back, focus on resilience:

```javascript
export const executePostFunction = async (args) => {
  try {
    // Your logic here
    await updateExternalSystem(args.issue);
  } catch (error) {
    console.error("Post-function failed:", error);
    // Log to Forge Storage for admin visibility
    await storeErrorLog(error, args.issue.key);
    // Consider: retry queue, notification, etc.
  }
  return { result: true };
};
```

## Practical Patterns

### Update a Field After Transition

```javascript
export const executePostFunction = async (args) => {
  const { issue } = args;
  
  // Set a custom field to the current timestamp
  await api.asApp().requestJira(
    route`/rest/api/3/issue/${issue.key}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: { customfield_10050: new Date().toISOString() }
      }),
    }
  );
  
  return { result: true };
};
```

### Create a Linked Sub-Task

```javascript
export const executePostFunction = async (args) => {
  const { issue } = args;
  
  const newIssue = await api.asApp().requestJira(
    route`/rest/api/3/issue`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: {
          project: { key: issue.fields.project.key },
          parent: { key: issue.key },
          summary: `Review: ${issue.fields.summary}`,
          issuetype: { name: "Sub-task" },
        }
      }),
    }
  );
  
  return { result: true };
};
```

### Add a Comment with ADF

```javascript
const comment = {
  body: {
    type: "doc",
    version: 1,
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Automatically transitioned by " },
          { type: "text", text: "CogniRunner", marks: [{ type: "strong" }] },
          { type: "text", text: ` at ${new Date().toISOString()}` },
        ]
      }
    ]
  }
};

await api.asApp().requestJira(
  route`/rest/api/3/issue/${issue.key}/comment`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(comment),
  }
);
```

## Important Considerations

### 1. Timeout Limits
- Same 25s limit as validators
- For long-running tasks, use **@forge/events** Queue/Consumer pattern:
  - Resolver pushes task to queue (fast, under 25s)
  - Consumer handles it with 120s timeout
  - Frontend polls for results

### 2. Field Update Gotchas
- Use `api.asApp()` for all API calls — the user's session may have ended
- **Read-only fields** (status, created, updated) cannot be PUT — use transitions for status
- **ADF fields** (description, comment body) require Atlassian Document Format, not plain strings
- **Select fields** require `{ value: "Option" }` or `{ id: "10001" }`, not plain strings
- **User fields** require `{ accountId: "..." }`, never username or email

### 3. Multiple Post-Functions
- Multiple post-functions on the same transition execute **sequentially** in array order
- System post-functions (`system:update-issue-status`) should be first
- Your custom post-functions run after system ones
- One failing post-function does NOT prevent others from running

### 4. No Retry Built-In
- Forge does not retry failed post-functions automatically
- Implement your own retry logic if needed (with backoff)
- Consider idempotency — the same post-function may be called multiple times in edge cases

## Common Use Cases

1. **AI-powered field updates**: Analyze field content and update target fields with AI-generated values
2. **Code execution**: Run custom JavaScript in a sandbox to perform complex calculations
3. **External sync**: Push issue data to Slack, Teams, CRM, or other external systems
4. **Auto-assignment**: Reassign the issue based on custom rules after transition
5. **Cascading updates**: Update parent issues, linked issues, or sub-tasks
6. **Audit logging**: Store transition history in Forge Storage for custom reporting
7. **SLA tracking**: Record transition timestamps for SLA compliance monitoring
