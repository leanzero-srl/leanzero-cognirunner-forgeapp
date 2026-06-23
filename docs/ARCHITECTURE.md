# CogniRunner Architecture

> This document is designed for AI models and developers who need to understand the codebase quickly. It maps every file, function, resolver, component, and data flow so you can navigate the code without reading all 11,000+ lines.

---

## Codebase Overview

| Metric | Value |
|--------|-------|
| **Total source lines** | ~11,000 |
| **Backend** | 2 files (5,238 lines) |
| **Frontend** | 3 React apps (5,821 lines + 21 components) |
| **Resolvers** | 47 named resolver functions |
| **Exported handlers** | 3 (`validate`, `executePostFunction`, `handler`) |
| **Runtime** | Node.js 22 on Atlassian Forge |
| **Frontend framework** | React 18 + Webpack + Babel (Custom UI) |

---

## File Map

```
CogniRunner/
├── manifest.yml                          # Forge app definition
│                                         #   7 modules, 4 resources, 12 scopes, 4 AI provider domains
│
├── src/
│   ├── index.js                          # 4,981 lines — ALL backend logic
│   │   ├── Lines 1-37: Imports + constants (APP_ID, keys)
│   │   ├── Lines 38-112: Permission system (getUserPermissions, requireRole, canActOnConfig)
│   │   ├── Lines 113-173: Logging (storeLog, MAX_LOGS=50)
│   │   ├── Lines 174-560: Core resolvers (checkLicense, getLogs, clearLogs, registerConfig,
│   │   │                   removeConfig, disableRule, enableRule, getConfigs, getRuleStatus)
│   │   ├── Lines 561-1000: Field resolution (getScreenFields, getFields, formatField)
│   │   ├── Lines 1000-1230: Add Rule wizard resolvers (listProjects, getProjectWorkflows,
│   │   │                     getWorkflowTransitions)
│   │   ├── Lines 1230-1500: Workflow injection (RULE_KEY_MAP, discoverEnvironmentId,
│   │   │                     injectWorkflowRule)
│   │   ├── Lines 1500-1700: Permission/admin resolvers (checkIsAdmin, getAppAdmins,
│   │   │                     addAppAdmin, updateUserRole, removeAppAdmin, searchUsers)
│   │   ├── Lines 1700-1900: BYOK resolvers (saveOpenAIKey, getOpenAIKey, removeOpenAIKey,
│   │   │                     saveProvider, getProvider, getOpenAIModels, saveOpenAIModel)
│   │   ├── Lines 1900-2200: Post-function config resolvers (registerPostFunction,
│   │   │                     removePostFunction, disable/enablePostFunction)
│   │   ├── Lines 2200-2500: Document library resolvers (saveContextDoc, getContextDocs,
│   │   │                     deleteContextDoc, getContextDocContent)
│   │   ├── Lines 2500-2700: AI interaction resolvers (suggestEndpoint, generatePostFunctionCode,
│   │   │                     reviewConfig, testValidation, testSemanticPostFunction, testPostFunction)
│   │   ├── Lines 2700-2900: Provider infrastructure (PROVIDERS, getProviderConfig, getOpenAIKey,
│   │   │                     getOpenAIModel, providerKeySlot, providerModelSlot)
│   │   ├── Lines 2900-3200: AI adapter (callAIChat, callAnthropicChat, convertContentBlock,
│   │   │                     buildModelParams)
│   │   ├── Lines 3200-3600: Field extraction (extractFieldDisplayValue, extractTextFromADF,
│   │   │                     getFieldValue, formatValueForField, buildAttachmentContentParts)
│   │   ├── Lines 3600-3800: Agentic infrastructure (TOOL_REGISTRY, executeJqlSearch,
│   │   │                     promptRequiresTools, callOpenAI, callOpenAIWithTools)
│   │   ├── Lines 3800-4200: Semantic post-function (executeSemanticPostFunction with editmeta
│   │   │                     pre-flight, auto-formatting, error parsing)
│   │   ├── Lines 4200-4500: Static post-function (executeStaticPostFunction,
│   │   │                     executeStaticCodeSandbox with API surface)
│   │   └── Lines 4500-4981: Exported handlers (validate, executePostFunction with license
│   │                         check, config parsing, logging)
│   │
│   └── async-handler.js                  # 257 lines — async event consumer
│       ├── Lines 1-70: Imports, key/model helpers, provider config (mirrors index.js)
│       ├── Lines 70-160: callAIChatSimple (Anthropic + OpenAI-compatible)
│       └── Lines 160-257: Event handler, task routing, KVS result storage
│
├── static/
│   ├── icons/icon.svg                    # App icon (blue gradient knot, 128x128 viewBox)
│   │
│   ├── config-ui/                        # React app: rule configuration (create/edit mode)
│   │   ├── src/
│   │   │   ├── index.js                  # React root mount
│   │   │   ├── App.js                    # 2,829 lines — main configuration form
│   │   │   │   ├── Module type detection (validator vs condition vs post-function)
│   │   │   │   ├── Module-level refs (onConfigure closure pattern)
│   │   │   │   ├── Field selector with screen-based resolution
│   │   │   │   ├── Prompt editor
│   │   │   │   ├── JQL/agentic toggle
│   │   │   │   ├── Post-function type selector (semantic/static)
│   │   │   │   ├── Provider detection for cost notice
│   │   │   │   └── injectStyles() — ALL CSS (~800 lines)
│   │   │   ├── styles.css                # Minimal (mostly superseded by injectStyles)
│   │   │   ├── data/
│   │   │   │   └── jira-endpoints.js     # 45+ Jira REST API endpoint definitions
│   │   │   └── components/
│   │   │       ├── CustomSelect.jsx      # Viewport-aware dropdown with flip-up, search, groups
│   │   │       ├── CodeEditor.jsx        # CodeMirror 6 with LeanZero themes + api.* autocompletion
│   │   │       ├── FunctionBuilder.jsx   # Container for static PF steps (max 50)
│   │   │       ├── FunctionBlock.jsx     # Individual step: prompt, operation type, endpoint picker,
│   │   │       │                         #   code gen, test run, doc attachment
│   │   │       ├── SemanticConfig.jsx    # Semantic PF form: condition, action, target field, test
│   │   │       ├── IssuePicker.jsx       # Type-ahead issue search with direct GET validation
│   │   │       ├── DocRepository.jsx     # Document library with categories, selection, validation
│   │   │       ├── ReviewPanel.jsx       # Async AI review with polling and AILoadingState
│   │   │       ├── AILoadingState.jsx    # Animated loading with cycling contextual messages
│   │   │       ├── Tooltip.jsx           # Portal-rendered tooltips (escape overflow:hidden)
│   │   │       ├── Skeleton.jsx          # Shimmer loading placeholders
│   │   │       └── CustomSelect.jsx      # Shared dropdown component
│   │   ├── public/index.html             # HTML template with pre-JS skeleton + theme CSS
│   │   ├── webpack.config.js             # Webpack bundling config
│   │   └── build/                        # COMMITTED — deployed by Forge
│   │
│   ├── config-view/                      # React app: read-only summary + execution logs
│   │   ├── src/
│   │   │   ├── index.js
│   │   │   └── App.js                    # 1,070 lines — config display + logs
│   │   │       ├── Config loading from extension context (4 fallback locations)
│   │   │       ├── Rule status detection (getRuleStatus with 4 matching strategies)
│   │   │       ├── Enable/disable toggle (routes to correct resolver by type)
│   │   │       ├── Execution logs with traces, recommendations, tool metadata
│   │   │       └── injectStyles()
│   │   └── build/
│   │
│   └── admin-panel/                      # React app: admin dashboard
│       ├── src/
│       │   ├── index.js
│       │   ├── App.js                    # 1,922 lines — tab bar, rules table, logs
│       │   │   ├── Tab system (Rules, Documentation, Permissions, Settings)
│       │   │   ├── Rules table with type/ownership filters
│       │   │   ├── Execution logs with rule identity + Edit button
│       │   │   ├── Role detection + scope-based UI gating
│       │   │   └── injectStyles() — ALL CSS (~1,200 lines of CSS)
│       │   └── components/
│       │       ├── AddRuleWizard.jsx      # 5-step wizard: project → workflow → transition → type → config
│       │       ├── OpenAIConfig.jsx       # Provider selector, key management, model dropdown
│       │       ├── PermissionsTab.jsx     # Role/scope management, user search, last-admin protection
│       │       ├── DocsTab.jsx            # Document library with auto-format (JSON, XML, YAML, JS)
│       │       ├── SettingsOpenAITab.jsx  # Wrapper for OpenAIConfig
│       │       ├── TabBar.jsx             # Tab navigation with adminOnly gating
│       │       ├── CustomSelect.jsx       # Shared dropdown (with icon support)
│       │       ├── Tooltip.jsx            # Portal tooltips
│       │       └── Skeleton.jsx           # Loading placeholders
│       └── build/
│
├── docs/                                 # This documentation
├── LICENSE                               # AGPL-3.0
├── NOTICE                                # Trademark
└── README.md                             # User/developer guide
```

---

## Resolver Map

All 47 resolvers exposed via `resolver.getDefinitions()` in `src/index.js`. Grouped by domain:

### Validation & Rule Management

| Resolver | Min Role | Purpose |
|----------|----------|---------|
| `registerConfig` | — | Register/update a validator or condition config in KVS |
| `removeConfig` | editor* | Remove a config entry. *Editors with scope "own" limited to their rules |
| `disableRule` | editor* | Set `disabled: true` on a validator/condition (skipped at runtime) |
| `enableRule` | editor* | Re-enable a disabled rule |
| `getConfigs` | — | Get all configs with orphan cleanup (checks if rules still exist on workflows) |
| `getRuleStatus` | — | Check if a rule is enabled/disabled (4 matching strategies) |
| `registerPostFunction` | — | Register/update a post-function config |
| `removePostFunction` | editor* | Remove a post-function config |
| `disablePostFunction` | editor* | Disable a post-function |
| `enablePostFunction` | editor* | Re-enable a post-function |
| `getPostFunctionStatus` | — | Check post-function status |

### Field & Screen Resolution

| Resolver | Min Role | Purpose |
|----------|----------|---------|
| `getFields` | — | Get ALL Jira fields (system + custom) with formatted types |
| `getScreenFields` | — | Resolve screen-specific fields for a workflow transition |

### AI Interaction

| Resolver | Min Role | Purpose |
|----------|----------|---------|
| `testValidation` | — | Dry-run validation against a real issue |
| `testSemanticPostFunction` | — | Dry-run semantic PF with editmeta check |
| `testPostFunction` | — | Dry-run static PF code execution |
| `suggestEndpoint` | — | AI suggests Jira REST API endpoint for a description |
| `generatePostFunctionCode` | — | AI generates JavaScript code for a PF step |
| `reviewConfig` | — | Submit async AI review via Queue |
| `getAsyncTaskResult` | — | Poll for async task completion |
| `searchIssues` | — | Search issues via JQL (for IssuePicker) |
| `validateIssue` | — | Validate an issue key exists (direct GET) |

### BYOK & Provider

| Resolver | Min Role | Purpose |
|----------|----------|---------|
| `saveOpenAIKey` | admin | Save API key to per-provider KVS slot |
| `getOpenAIKey` | — | Check BYOK status (never returns actual key) |
| `removeOpenAIKey` | admin | Delete active provider's key |
| `saveProvider` | admin | Switch active AI provider |
| `getProvider` | — | Get current provider + available providers list |
| `getOpenAIModels` | — | Fetch model list from active provider |
| `saveOpenAIModel` | admin | Save model selection to per-provider slot |
| `getOpenAIModelFromKVS` | — | Get current model or factory default |

### Permissions

| Resolver | Min Role | Purpose |
|----------|----------|---------|
| `checkIsAdmin` | — | Returns `{ isAdmin, role, scope, accountId }` |
| `getAppAdmins` | admin | List all app users with roles |
| `addAppAdmin` | admin | Add user with role + scope |
| `updateUserRole` | admin | Change role/scope (last-admin protection) |
| `removeAppAdmin` | admin | Remove user (last-admin protection) |
| `searchUsers` | admin | Search Jira users by name for user picker |

### Add Rule Wizard

| Resolver | Min Role | Purpose |
|----------|----------|---------|
| `listProjects` | editor | List all Jira projects (with base64 avatar proxying) |
| `getProjectWorkflows` | editor | Resolve project's workflow scheme → list workflows |
| `getWorkflowTransitions` | editor | List transitions with status names + existing rule indicators |
| `injectWorkflowRule` | editor | Programmatically add Forge rule to workflow transition |

### Utility

| Resolver | Min Role | Purpose |
|----------|----------|---------|
| `checkLicense` | — | Return Marketplace license status |
| `getLogs` | — | Get execution logs (last 50) |
| `clearLogs` | editor | Delete all execution logs |
| `saveContextDoc` | — | Save document to library |
| `getContextDocs` | — | List documents (with ownership filter) |
| `getContextDocContent` | — | Get document content by ID |
| `deleteContextDoc` | editor* | Delete document |

---

## Exported Handlers

Three functions exported from `src/index.js`:

```javascript
export const validate = async (args) => { ... }          // Workflow validator/condition
export const executePostFunction = async (args) => { ... } // Workflow post-function
export const handler = resolver.getDefinitions();          // Resolver bridge for Custom UI
```

One function exported from `src/async-handler.js`:

```javascript
export const asyncHandler = async (event) => { ... }       // Queue consumer (120s timeout)
```

---

## Data Flow Diagrams

### 1. Standard Validation

```
Jira Workflow Transition
  │
  ├─ Forge calls validate(args)
  │   args = { issue, configuration, modifiedFields, context }
  │
  ├─ Parse configuration (JSON string from onConfigure)
  │
  ├─ Check license (skip if inactive → fail open)
  │
  ├─ Check if disabled in KVS (skip if disabled → fail open)
  │
  ├─ Extract field value
  │   ├─ Check modifiedFields first (transition screen data)
  │   └─ Fallback: GET /rest/api/3/issue/{key}?fields={fieldId}
  │
  ├─ Detect agentic mode (prompt keywords or manual override)
  │
  ├─ Call AI via callAIChat()
  │   ├─ Standard: single-turn → { isValid, reason }
  │   └─ Agentic: multi-turn loop with tool calls
  │       ├─ Round 1: AI calls search_jira_issues
  │       ├─ Execute JQL against Jira REST API
  │       ├─ Feed results back to AI
  │       └─ Repeat up to 3 rounds or 22s deadline
  │
  ├─ Store execution log in KVS
  │
  └─ Return { result: boolean, errorMessage?: string }
```

### 2. Post-Function Execution

```
Jira Workflow Transition Completes
  │
  ├─ Forge calls executePostFunction(args)
  │   Always returns { result: true } (never blocks)
  │
  ├─ Parse configuration
  ├─ Check license → skip silently if inactive
  ├─ Check disabled → skip silently if disabled
  │
  ├─ Route by config.type
  │   ├─ "postfunction-semantic":
  │   │   ├─ Parallel fetch: fieldValue + contextDocs + apiKey + model
  │   │   ├─ Check editmeta: is target field editable?
  │   │   │   └─ If not → log error + recommendation, skip
  │   │   ├─ Build prompts (short for "always run" conditions)
  │   │   ├─ Call AI → { decision: UPDATE|SKIP, value, reason }
  │   │   ├─ Auto-format value (select→{value}, number→Number, etc.)
  │   │   ├─ PUT /rest/api/3/issue/{key} with formatted value
  │   │   │   └─ Parse Jira error body on failure
  │   │   └─ Store trace + recommendation in log
  │   │
  │   └─ "postfunction-static":
  │       ├─ For each function block (sequential):
  │       │   ├─ Create sandboxed context with API surface
  │       │   ├─ Execute code via new Function()
  │       │   ├─ Capture return value as variable for next step
  │       │   └─ Collect logs and changes
  │       └─ Store results in log
  │
  └─ Store execution log in KVS
```

### 3. AI Provider Routing

```
callAIChat({ apiKey, model, messages, tools, tool_choice })
  │
  ├─ getProviderConfig() → { provider, baseUrl }
  │   (cached in-memory after first call)
  │
  ├─ if provider === "anthropic":
  │   └─ callAnthropicChat()
  │       ├─ Extract system messages → top-level "system" field
  │       ├─ Convert image_url → { type: "image", source: { type: "base64" } }
  │       ├─ Convert file → { type: "document", source: { type: "base64" } }
  │       ├─ Unwrap tools: { type: "function", function: {...} } → { name, input_schema }
  │       ├─ Convert tool results: role:"tool" → role:"user" with tool_result blocks
  │       ├─ POST /v1/messages with x-api-key + anthropic-version headers
  │       └─ Translate response back to OpenAI format
  │
  └─ else (OpenAI, Azure, OpenRouter):
      ├─ Build headers:
      │   ├─ Azure: api-key header
      │   ├─ OpenRouter: Bearer + HTTP-Referer + X-OpenRouter-Title
      │   └─ OpenAI: Bearer
      ├─ POST {baseUrl}/chat/completions
      └─ Return { ok, status, data } in OpenAI format
```

### 4. Permission Check Flow

```
Request arrives at resolver
  │
  ├─ getUserPermissions(accountId)
  │   ├─ 1. Check KVS app_admins list
  │   │   └─ If found → return { role, scope }
  │   ├─ 2. Bootstrap: if list empty → first user becomes admin
  │   └─ 3. Check Jira admin groups (jira-administrators, site-admins)
  │       └─ If member → return { role: "admin", scope: "all" }
  │
  ├─ requireRole(accountId, "editor")
  │   └─ levels: viewer=1, editor=2, admin=3
  │       return userLevel >= requiredLevel
  │
  └─ canActOnConfig(accountId, config, "editor")
      ├─ Check role level ≥ required
      ├─ If admin or scope="all" → allow
      └─ If scope="own" → only if config.createdBy === accountId
```

---

## Key Design Decisions

### Why a Single Backend File?

The entire backend is in `src/index.js` (~5,000 lines). This is intentional:

1. **Forge deployment constraint** — Forge bundles and deploys a single function entry point. Module splitting is possible but adds complexity with imports.
2. **In-memory caching** — Provider config, API keys, and models are cached in module-level variables. These caches persist across invocations within the same Forge function instance. Multiple files would need shared cache management.
3. **Resolver registration** — All 47 resolvers must be registered on the same `Resolver` instance that's exported as `handler`. A single file keeps this simple.

### Why CSS Injection (injectStyles)?

Forge Custom UI runs in a sandboxed iframe with strict CSP. External stylesheets can fail to load. The `injectStyles()` pattern:

1. Creates a `<style>` element via JavaScript
2. Appends it to `<head>` in `useEffect` (before first render)
3. Uses `id="app-styles"` guard to prevent duplicates
4. Requires `permissions.content.styles: ["unsafe-inline"]` in manifest

This is more reliable than `<link>` stylesheet loading in Forge iframes.

### Why Module-Level Refs for onConfigure?

The `workflowRules.onConfigure()` callback captures a closure at registration time. React state updates after registration aren't visible to the callback. Solution:

```javascript
// Module-level refs (outside component)
let currentFieldId = "";
let currentPrompt = "";

function App() {
  const [fieldId, setFieldId] = useState("");
  
  useEffect(() => {
    workflowRules.onConfigure(() => {
      // This closure sees module-level refs, NOT React state
      return JSON.stringify({ fieldId: currentFieldId, prompt: currentPrompt });
    });
  }, []);
  
  // Keep refs in sync
  useEffect(() => { currentFieldId = fieldId; }, [fieldId]);
}
```

### Why Per-Provider Key Storage?

Previous design stored one key in `COGNIRUNNER_OPENAI_API_KEY`. Switching providers deleted it. Users lost their keys.

New design: `COGNIRUNNER_KEY_{provider}` (e.g., `COGNIRUNNER_KEY_openai`, `COGNIRUNNER_KEY_anthropic`). Switching providers only changes the active provider pointer. All keys are preserved.

### Why Fail-Open for Validators?

CogniRunner validators default to allowing transitions on error:
- AI timeout → allow transition
- API key missing → allow transition  
- Network error → allow transition

Rationale: A false rejection (blocking a legitimate transition) is worse than a missed validation. Users seeing "AI Validation Error: timeout" on every transition would make the app unusable. Fail-open with logging lets admins detect issues without blocking work.

---

## Config Storage Schema

### Rule Config Entry (KVS: `config_registry`)

```javascript
{
  id: "WorkflowName::transitionId",      // Unique identifier
  type: "validator" | "condition" | "postfunction-semantic" | "postfunction-static",
  fieldId: "description",                 // Source field
  prompt: "Validation criteria...",       // For validators/conditions
  conditionPrompt: "Run every time",      // For semantic PF
  actionPrompt: "Summarize into...",      // For semantic PF
  actionFieldId: "customfield_10050",     // Target field for semantic PF
  functions: [{ ... }],                   // Steps for static PF
  enableTools: null | true | false,       // JQL toggle
  selectedDocIds: ["doc-id-1"],           // Attached documents
  workflow: {
    workflowName: "Software Simplified Workflow",
    workflowId: "uuid",
    transitionId: "11",
    transitionName: "Start Progress",
    transitionFromName: "To Do",
    transitionToName: "In Progress",
    projectKey: "PROJ",
    siteUrl: "https://site.atlassian.net",
  },
  disabled: false,
  createdBy: "accountId",
  createdAt: "2025-01-15T10:30:00.000Z",
  updatedAt: "2025-01-16T14:20:00.000Z",
}
```

### Execution Log Entry (KVS: `validation_logs`)

```javascript
{
  id: "1705334400000",                    // timestamp-based ID
  timestamp: "2025-01-15T12:00:00.000Z",
  type: "validator" | "condition" | "postfunction-semantic" | "postfunction-static" | "postfunction-error",
  issueKey: "PROJ-123",
  fieldId: "description",
  isValid: true,                          // Pass/fail
  reason: "AI reasoning text",
  executionTimeMs: 1956,
  // Validator-specific:
  mode: "standard" | "agentic",
  fieldValue: "First 300 chars...",
  prompt: "First 200 chars...",
  toolMeta: { toolsUsed: true, toolRounds: 2, queries: ["..."], totalResults: 5 },
  // Post-function-specific:
  decision: "UPDATE" | "SKIP",
  aiTimeMs: 1477,
  tokens: 614,
  trace: ["Step 1...", "Step 2..."],
  recommendation: "Fix suggestion...",
  // Rule identity:
  ruleId: "WorkflowName::transitionId",
  ruleName: "Workflow / From → To",
  ruleWorkflow: { workflowId, siteUrl, ... },
}
```

---

## Component Dependency Graph

```
admin-panel/App.js
  ├── TabBar
  ├── AddRuleWizard ── CustomSelect
  ├── DocsTab ── CustomSelect
  ├── PermissionsTab ── CustomSelect
  ├── SettingsOpenAITab
  │   └── OpenAIConfig ── CustomSelect, Tooltip
  └── CustomSelect (shared)

config-ui/App.js
  ├── CustomSelect (field selector, JQL toggle)
  ├── SemanticConfig
  │   ├── CustomSelect, Tooltip, IssuePicker
  │   ├── DocRepository
  │   └── ReviewPanel ── AILoadingState
  ├── FunctionBuilder
  │   ├── FunctionBlock
  │   │   ├── CustomSelect, Tooltip, IssuePicker
  │   │   ├── CodeEditor (CodeMirror 6)
  │   │   └── DocRepository
  │   └── ReviewPanel
  ├── DocRepository
  ├── ReviewPanel ── AILoadingState
  ├── IssuePicker
  └── Tooltip

config-view/App.js
  └── (no sub-components — self-contained)
```

---

## Testing Strategy

No automated test framework. Testing is done via:

1. **`forge tunnel`** — live backend reloading for resolver testing
2. **`npm run start`** — webpack dev server for frontend hot reload
3. **Test Run buttons** — built into config-ui and admin panel:
   - `testValidation` — dry-run validator against real issue
   - `testSemanticPostFunction` — dry-run semantic PF (reads real, writes skipped)
   - `testPostFunction` — dry-run static PF (reads real, writes simulated)
4. **`forge logs`** — runtime log inspection
5. **Manual testing** on development Jira site
