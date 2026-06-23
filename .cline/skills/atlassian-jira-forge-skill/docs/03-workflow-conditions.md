# Jira Workflow Conditions

## Overview

The `jira:workflowCondition` module allows Forge apps to control the **visibility** of workflow transitions. If the condition returns `{ result: false }`, the transition button is **hidden** from the user — they cannot see or click it.

**Key distinction from validators:** Conditions hide the transition entirely. Validators allow the user to try the transition but block it with an error message.

### When to use `jira:workflowCondition` vs Jira Expressions

| Feature | Jira Expressions | `jira:workflowCondition` |
|---------|-----------------|---------------------------|
| **Complexity** | Simple logic (group check, field presence) | Complex logic (external API, KVS, AI) |
| **Execution** | Within Jira engine (fast, no cold start) | As a Forge function (may have cold start) |
| **Manifest** | No declaration needed | Requires `manifest.yml` entry |
| **Configuration** | Direct in Workflow UI | Custom UI via Forge resources |

### Built-in Jira Expression Examples

For simple conditions, Jira expressions are sufficient and don't require a Forge module:

```javascript
// User must be in a group
user.inGroup('release-managers')

// Issue must be assigned
issue.assignee != null

// Only reporter can proceed
user.accountId == issue.reporter.accountId

// Priority must be High or Critical
issue.priority.name == "High" || issue.priority.name == "Critical"

// Project-specific
project.key == "PROJ"
```

## Manifest Configuration

### With Configuration UI

```yaml
modules:
  jira:workflowCondition:
    - key: my-custom-condition
      name: Custom Visibility Rule
      description: Controls transition visibility based on AI analysis
      function: checkCondition
      resolver:
        function: resolver
      create:
        resource: config-ui-resource
      edit:
        resource: config-ui-resource
      view:
        resource: config-view-resource

functions:
  - key: checkCondition
    handler: src/index.checkCondition
  - key: resolver
    handler: src/index.handler

resources:
  - key: config-ui-resource
    path: static/config-ui/build
  - key: config-view-resource
    path: static/config-view/build
```

## Function Payload

The condition function receives the **same payload structure** as validators:

```javascript
export const checkCondition = async (args) => {
  const {
    issue,           // The issue being viewed
    configuration,   // JSON-parsed config from onConfigure callback
    modifiedFields,  // May be empty for conditions (checked before transition screen)
    context,         // Forge context
  } = args;
  
  return { result: true };  // Show transition
  // or
  return { result: false }; // Hide transition
};
```

**Important differences from validators:**
- Conditions are evaluated **when the issue is viewed**, not when the user clicks transition
- They may be called frequently (every time the issue loads)
- Performance matters more — slow conditions delay the issue view
- `modifiedFields` is typically empty since the transition screen hasn't been shown yet

### `configuration` Object

Retrieved from context extension using the `conditionConfig` key:

```javascript
const config = ctx?.extension?.conditionConfig
  || ctx?.extension?.configuration
  || ctx?.extension?.config;
```

## Response Formats

| Scenario | Return Value | Result in Jira |
|----------|--------------|----------------|
| **Show transition** | `{ result: true }` | Transition button visible to user |
| **Hide transition** | `{ result: false }` | Transition button hidden — user cannot see it |

**Note:** Conditions do **not** support `errorMessage` — there's no message to show since the button is simply not rendered.

## Configuration UI

The Custom UI pattern is identical to validators. See [Workflow Validators — Configuration UI](./02-workflow-validators.md) for the full `workflowRules.onConfigure()` pattern.

The only difference is the context extension type:
```javascript
context.extension.type = "jira:workflowCondition"
// Config stored under conditionConfig
```

## Important Considerations

### 1. Performance Impact
- Conditions are evaluated on **every issue view** where the workflow applies
- Slow conditions (external API calls, complex logic) delay the issue rendering
- Consider caching results in Forge Storage if the condition rarely changes
- Aim for < 2 seconds response time

### 2. No Error Feedback
- If your condition function throws an error, behavior is undefined
- Best practice: fail-closed (hide transition) on error for security-sensitive conditions
- Best practice: fail-open (show transition) on error for non-critical conditions

### 3. Conditions vs Validators
- Use **conditions** to hide transitions that shouldn't be available at all
- Use **validators** to allow users to try but provide helpful error messages
- Example: "Only managers can approve" → condition (hide the button)
- Example: "Description must be at least 100 characters" → validator (show error)

### 4. No Event on Evaluation
- No Forge event fires when a condition is evaluated
- You cannot track "how many times was this transition hidden"
- For audit purposes, implement logging within the condition function itself

## Common Use Cases

1. **AI-based visibility**: Show transition only when AI analysis determines content is ready
2. **License gating**: Hide transitions when app license is inactive
3. **Role-based visibility**: Show transitions only for specific groups/roles
4. **Status prerequisites**: Hide transition until linked issues are resolved
5. **Time-based rules**: Show transition only during business hours or after a waiting period
6. **Feature flags**: Conditionally enable transitions based on admin configuration
