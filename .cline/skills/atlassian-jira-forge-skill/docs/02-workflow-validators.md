# Jira Workflow Validators

## Overview

The `jira:workflowValidator` module allows Forge apps to execute custom backend logic during a workflow transition. If the validator returns `{ result: false }`, the transition is **blocked** and the user sees an error message.

### When to use `jira:workflowValidator` vs Jira Expressions

| Feature | Jira Expressions | `jira:workflowValidator` |
|---------|-----------------|---------------------------|
| **Complexity** | Simple logic (field presence, length) | Complex logic (external API, KVS, AI) |
| **Execution** | Within Jira engine (fast) | As a Forge function (25s timeout) |
| **Manifest** | No declaration needed | Requires `manifest.yml` entry |
| **Configuration** | Direct in Workflow UI | Custom UI via Forge resources |

## Manifest Configuration

### Basic (no config UI)

```yaml
modules:
  jira:workflowValidator:
    - key: my-custom-validator
      name: My Custom Validator
      description: Validates data using external logic
      function: validateTransition

functions:
  - key: validateTransition
    handler: src/index.validateTransition
```

### With Configuration UI (create, edit, view)

```yaml
modules:
  jira:workflowValidator:
    - key: my-custom-validator
      name: My Custom Validator
      description: Validates data using external logic
      function: validateTransition
      resolver:
        function: resolver
      create:
        resource: config-ui-resource
      edit:
        resource: config-ui-resource
      view:
        resource: config-view-resource

functions:
  - key: validateTransition
    handler: src/index.validateTransition
  - key: resolver
    handler: src/index.handler

resources:
  - key: config-ui-resource
    path: static/config-ui/build
  - key: config-view-resource
    path: static/config-view/build
```

**Key points:**
- `create` and `edit` resources typically point to the same Custom UI app
- `view` resource is shown as a read-only summary in the workflow editor
- `resolver` provides backend API for the Custom UI via `invoke()` calls
- Both resources support `company-managed` and `team-managed` project types

## Function Payload

The validator function receives a **payload object** with the following structure:

```javascript
export const validateTransition = async (args) => {
  const {
    issue,           // The issue being transitioned
    configuration,   // JSON-parsed config from onConfigure callback
    modifiedFields,  // Fields changed on the transition screen
    context,         // Forge context (accountId, siteUrl, etc.)
  } = args;
  
  // ...validation logic...
  return { result: true };  // or { result: false, errorMessage: "..." }
};
```

### `issue` Object

```javascript
{
  id: "10001",           // Issue ID (numeric string)
  key: "PROJ-123",       // Issue key (null during CREATE transitions)
  fields: {
    summary: "Issue title",
    description: { type: "doc", version: 1, content: [...] },  // ADF format
    status: { name: "To Do", id: "10000" },
    issuetype: { name: "Bug", id: "10001" },
    priority: { name: "High", id: "1" },
    assignee: { displayName: "John", accountId: "5f..." } | null,
    reporter: { displayName: "Jane", accountId: "5f..." },
    labels: ["backend", "urgent"],
    components: [{ name: "API", id: "10000" }],
    project: { key: "PROJ", id: "10000" },
    customfield_10001: "custom value",  // Custom fields vary by type
    // ...all other fields on the issue
  }
}
```

**Important:** During issue CREATE transitions, `issue.key` is `null` and `issue.id` may not be set. Use `modifiedFields` for create-screen data.

### `modifiedFields` Object

Contains fields the user changed on the transition screen. Only fields visible on the transition screen appear here.

```javascript
{
  summary: "Updated title",
  description: { type: "doc", version: 1, content: [...] },
  customfield_10001: "new value",
  // Only fields the user modified — not all issue fields
}
```

**Common pattern:** Check `modifiedFields` first, fall back to `issue.fields`:
```javascript
const fieldValue = modifiedFields?.[fieldId] ?? issue.fields?.[fieldId];
```

### `configuration` Object

The JSON-parsed configuration object returned by the Custom UI's `onConfigure` callback. Structure is entirely app-defined.

```javascript
// Example: what your onConfigure callback returned as JSON string
{
  fieldId: "description",
  prompt: "Check for profanity",
  enableTools: true
}
```

## Configuration UI (Custom UI)

### How It Works

1. User adds the validator to a workflow transition
2. Jira opens the `create` resource (Custom UI iframe)
3. User fills in the form (e.g., select field, write prompt)
4. Custom UI registers `workflowRules.onConfigure()` callback
5. When user clicks "Save", Jira calls the callback
6. Callback returns a JSON string — Jira stores it as the rule's configuration
7. On subsequent edits, Jira opens the `edit` resource with the stored config

### Custom UI Implementation (React)

```javascript
import { invoke, view } from "@forge/bridge";
import { workflowRules } from "@forge/jira-bridge";

// Module-level refs — required because onConfigure captures closure at registration
let currentFieldId = "";
let currentPrompt = "";

function App() {
  const [fieldId, setFieldId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [context, setContext] = useState(null);

  useEffect(() => {
    // Enable dark theme support
    view.theme.enable();
    
    // Load context (includes existing configuration for edit mode)
    view.getContext().then((ctx) => {
      setContext(ctx);
      // Load existing config on edit
      const config = ctx?.extension?.validatorConfig
        || ctx?.extension?.conditionConfig
        || ctx?.extension?.configuration
        || ctx?.extension?.config;
      if (config) {
        try {
          const parsed = typeof config === "string" ? JSON.parse(config) : config;
          setFieldId(parsed.fieldId || "");
          setPrompt(parsed.prompt || "");
          currentFieldId = parsed.fieldId || "";
          currentPrompt = parsed.prompt || "";
        } catch (e) { /* ignore parse errors */ }
      }
    });

    // Register the save callback — MUST be done once, early
    workflowRules.onConfigure(() => {
      // Return JSON string — Jira stores this as the rule's configuration
      return JSON.stringify({
        fieldId: currentFieldId,
        prompt: currentPrompt,
      });
    });
  }, []);

  // Keep module-level refs in sync with React state
  useEffect(() => { currentFieldId = fieldId; }, [fieldId]);
  useEffect(() => { currentPrompt = prompt; }, [prompt]);

  return (
    <div>
      <select value={fieldId} onChange={(e) => setFieldId(e.target.value)}>
        <option value="">Select field...</option>
        {/* Populate from resolver */}
      </select>
      <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} />
    </div>
  );
}
```

### Why Module-Level Refs Are Required

The `workflowRules.onConfigure()` callback captures a closure at registration time. If you only use React state, the callback will see stale values. The pattern is:

1. Register `onConfigure` once in `useEffect([], ...)`
2. Use module-level variables (`let currentFieldId = ""`) alongside React state
3. Sync them via `useEffect` hooks whenever state changes
4. The callback reads from module-level refs, not React state

### Config Retrieval (Multiple Fallback Locations)

The stored config appears in different locations depending on the module type:

```javascript
const config = context?.extension?.validatorConfig     // Validator modules
  || context?.extension?.conditionConfig               // Condition modules
  || context?.extension?.postFunctionConfig             // Post-function modules
  || context?.extension?.configuration                  // Generic fallback
  || context?.extension?.config;                        // Older API
```

### Context Extension Object

```javascript
context.extension = {
  type: "jira:workflowValidator",     // Module type
  key: "my-custom-validator",         // Module key from manifest
  validatorConfig: "...",             // Stored JSON string (for validators)
  // Workflow context (when available)
  workflow: {
    workflowId: "uuid",
    workflowName: "My Workflow",
    transitionId: "11",
    transitionName: "Start Progress",
    transitionFromName: "To Do",
    transitionToName: "In Progress",
  }
}
```

## Response Formats

| Scenario | Return Value | Result in Jira |
|----------|--------------|----------------|
| **Allow** | `{ result: true }` | Transition proceeds |
| **Block (with message)** | `{ result: false, errorMessage: "..." }` | Transition blocked; user sees message |
| **Block (no message)** | `{ result: false }` | Transition blocked; default error |

**Note:** Use `errorMessage` (not `message`) for the user-facing error text.

## Important Considerations

### 1. Timeout Limits
- Forge validators have a **25-second timeout** (Forge resolver limit)
- Implement a deadline pattern: `const deadline = Date.now() + 22000;` and bail out before timeout
- If timeout hits, Jira may show a generic error or allow the transition

### 2. Issue CREATE Transitions
- `issue.key` is `null` — no issue exists yet
- `issue.fields` may be sparse — rely on `modifiedFields` for create-screen data
- Some fields like `created`, `updated`, `status` don't exist yet

### 3. Fail-Open vs Fail-Closed
- **Fail-open** (`return { result: true }`): On error, allow transition. Best for non-critical validators.
- **Fail-closed** (`return { result: false }`): On error, block transition. Use for compliance-critical rules.
- Always log errors regardless of fail strategy.

### 4. Permissions
- Use `api.asApp()` for all Jira API calls within validators
- The transitioning user may not have permissions for the API calls your validator needs
- `api.asUser()` respects the user's permissions and may fail unexpectedly

### 5. No Retry on Failure
- If the validator function throws an unhandled exception, the transition may be blocked with a generic Forge error
- Always wrap logic in try/catch

## Common Use Cases

1. **AI-powered validation**: Send field content to an AI service for quality/compliance checking
2. **Duplicate detection**: Search for similar issues via JQL before allowing creation
3. **External system sync**: Verify state matches an external CRM/ERP
4. **Dynamic business rules**: Fetch rules from Forge Storage (KVS) for admin-configurable validation
5. **Attachment validation**: Check that required documents are attached before transition
6. **Cross-field validation**: Ensure multiple fields meet interdependent rules
