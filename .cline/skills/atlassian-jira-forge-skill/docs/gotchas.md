# Forge Development Gotchas (Jira)

Hard-won lessons from building production Forge apps. Each gotcha includes the exact symptom, root cause, and verified fix. Organized by category for quick lookup.

---

## Development Environment

### Forge Tunnel & Manifest Changes
When you modify `manifest.yml` (adding scope, module, resource), the running `forge tunnel` will NOT pick up changes.
- **Fix:** Stop tunnel (`Ctrl+C`), run `forge deploy`, then restart `forge tunnel`.
- **After scope/egress changes:** Also run `forge install --upgrade` on target site.

### Authentication Context
- `api.asApp()`: App's own permissions. Use for validators, post-functions, background tasks.
- `api.asUser()`: Current user's permissions. Use for UI-driven actions.
- **Gotcha:** In workflow validators/conditions, ALWAYS use `api.asApp()`. The user's session context isn't reliably available during transition execution.

### Build Artifacts Must Be Committed
Forge deploys from `build/` directories directly. These MUST be committed to git.
- After changing frontend source → `npm run build` → commit `build/` → `forge deploy`
- Forgetting to rebuild = deploying stale code that doesn't match your source

---

## CSS & Styling in Custom UI

### Inline Styles Require Manifest Permission
```yaml
permissions:
  content:
    styles:
      - unsafe-inline
```
Without this, `document.createElement("style")` and any inline styles fail silently.

### CSS Variables Don't Work in Gradients (In Some Forge Contexts)
```css
/* BAD — may not render in Forge iframe */
background: linear-gradient(90deg, var(--color-1), var(--color-2));

/* GOOD — hardcode gradient colors */
background: linear-gradient(90deg, #1e1e2e 25%, #2a2a3a 50%, #1e1e2e 75%);
```

### Dark Theme Timing: data-color-mode Loads AFTER React
Jira sets `data-color-mode="dark"` on `<html>` via `view.theme.enable()` — but this happens AFTER your component mounts. For the first ~2 seconds, only `:root` (light) CSS applies.

**Fix:** Use theme-neutral defaults:
```css
/* Default: semi-transparent, works on both backgrounds */
.skeleton { background: rgba(128,128,128,0.12); }

/* Override once theme is known */
html[data-color-mode="light"] .skeleton { background: #e2e8f0; }
html[data-color-mode="dark"] .skeleton { background: #1e1e2e; }

/* System preference fallback (before data-color-mode loads) */
@media (prefers-color-scheme: dark) {
  .skeleton { background: #1e1e2e; }
}
```

### External Images Blocked by CSP
`<img src="https://site.atlassian.net/rest/api/3/universal_avatar/...">` fails silently.

**Fix:**
```yaml
permissions:
  external:
    images:
      - address: "*.atlassian.net"
```

### The Triple-Definition CSS Pattern
Styles must be defined in three places for reliability:
1. `public/index.html <style>` — pre-JS loading (spinner, skeleton)
2. `injectStyles()` in App.js — ALL critical styles (most reliable)
3. `styles.css` — reference only

**Why:** Forge iframe CSS loading is unpredictable. `injectStyles()` via `document.createElement("style")` is the only 100% reliable method.

---

## Workflow API

### Workflow Search: expand Parameters
```
WORKS:    expand=values.transitions
FAILS:    expand=values.statuses     (causes HTTP 400)
FAILS:    expand=statuses            (not a valid expand)
```

### Workflow Search: queryString is Partial Match
`queryString=WFH` matches "WFH Workflow_v2" AND "WFH-Payment". Always filter results:
```javascript
const workflow = data.values.find(w => w.name === exactName);
```

### Transition Status References: TWO Different Formats
The API returns status references in different fields depending on the workflow type:

**To status:**
```javascript
// Try these in order:
const toRef = t.toStatusReference           // New format
  || (typeof t.to === "string" ? t.to       // String reference
  : t.to?.statusReference)                   // Nested object
  || "";
```

**From statuses (can be multiple):**
```javascript
// New format: links array
if (t.links?.length > 0) {
  fromRefs = t.links.map(l => l.fromStatusReference);
}
// Old format: from array
else if (Array.isArray(t.from)) {
  fromRefs = t.from.map(f => typeof f === "string" ? f : f.statusReference);
}
```

**GLOBAL transitions:** No `links` and no `from` → display as "Any status"
**INITIAL transitions:** `type === "INITIAL"` → display as "Create"

### Status Names Must Be Fetched Separately
The workflow search API returns status REFERENCES (UUIDs), not names. You must call:
```javascript
const statusResp = await api.asApp().requestJira(route`/rest/api/3/status`);
const allStatuses = await statusResp.json();
// Returns: [{ id: "10001", name: "To Do", statusCategory: {...} }, ...]
```
Build a lookup map: `statusReference → name`

### Workflow Scheme Resolution: 3 API Calls Required
To get workflows for a specific project:
```
1. GET /rest/api/3/workflowscheme/project?projectId={id}
   → { values: [{ workflowScheme: { id: 12345 } }] }

2. GET /rest/api/3/workflowscheme/{schemeId}
   → { defaultWorkflow: "jira", issueTypeMappings: { "10001": "My Workflow" } }

3. For each workflow name:
   GET /rest/api/3/workflows/search?queryString={name}&expand=values.transitions
```

### Workflow Update is Full Replacement
`POST /rest/api/3/workflows/update` requires the ENTIRE workflow definition:
- All statuses (with statusReference)
- All transitions (with all their rules)
- Workflow version object: `{ id, versionNumber }` — must match current

You CANNOT patch a single transition. You must GET → modify in memory → POST entire workflow.

**Gotcha:** Omitting `system:update-issue-status` from postFunctions breaks the transition.

### Forge Rule Keys in Workflow Rules
```
Validator:      ruleKey = "forge:expression-validator"
Condition:      ruleKey = "forge:expression-condition"
Post-Function:  ruleKey = "forge:expression-post-function"
```

Extension ARI format:
```
ari:cloud:ecosystem::extension/{appId}/{envId}/static/{moduleKey}
```

Get `envId` via:
```javascript
import { getAppContext } from "@forge/api";
const { environmentAri } = getAppContext();
const envId = environmentAri.environmentId;
```

---

## Field & Issue API

### EditMeta for Field Editability
Before updating a field, check if it's editable:
```javascript
const resp = await api.asApp().requestJira(
  route`/rest/api/3/issue/${key}/editmeta`
);
const editableFields = (await resp.json()).fields;
if (!editableFields[fieldId]) {
  // Field is NOT editable — don't attempt update
}
```

**EditMeta returns:**
- Field schema (type, items, custom)
- Allowed values (for select fields)
- Required flag

### Field Value Formats for PUT
| Field Type | API Format |
|---|---|
| Text (summary) | `{ summary: "plain string" }` |
| Rich text (description) | `{ description: { type: "doc", version: 1, content: [...] } }` — ADF format |
| Single select | `{ priority: { name: "High" } }` or `{ priority: { id: "1" } }` |
| Multi-select | `{ components: [{ id: "10001" }, { id: "10002" }] }` |
| Labels | `{ labels: ["bug", "urgent"] }` — array of strings, OVERWRITES all |
| User | `{ assignee: { accountId: "5f..." } }` — never username |
| Date | `{ duedate: "2025-12-31" }` — ISO date string |
| Number | `{ customfield_10050: 42 }` — actual number, not string |

### modifiedFields on CREATE Transitions
During issue creation, `issue.key` is `null` and `issue.id` may not be set. Only `modifiedFields` contains the create-screen data. Never call REST API with null key.

### Attachment Limitation on CREATE
Jira doesn't expose attachments in `modifiedFields` during creation. The issue doesn't exist yet → no attachments to fetch. Skip attachment validation on create.

---

## Config Storage & Retrieval

### Four Fallback Locations for Config
Jira stores workflow rule config under different keys per module type:
```javascript
const config = context?.extension?.postFunctionConfig     // Post-functions
  || context?.extension?.validatorConfig                   // Validators
  || context?.extension?.conditionConfig                   // Conditions
  || context?.extension?.configuration                     // Generic fallback
  || context?.extension?.config;                           // Oldest API
```
Always check ALL of these. Config is a JSON string — parse with try/catch.

### The onConfigure Closure Problem
`workflowRules.onConfigure()` captures a closure at registration time. React state updates AFTER registration are invisible to the callback.

**Fix:** Module-level variables synced via useEffect:
```javascript
let currentFieldId = "";  // Outside component

function App() {
  const [fieldId, setFieldId] = useState("");
  
  useEffect(() => {
    workflowRules.onConfigure(() => {
      return JSON.stringify({ fieldId: currentFieldId });  // Reads module ref
    });
  }, []);  // Register ONCE
  
  useEffect(() => { currentFieldId = fieldId; }, [fieldId]);  // Sync on every change
}
```

### Module Type Detection
```javascript
const extType = context?.extension?.type;
// "jira:workflowValidator" | "jira:workflowCondition" | "jira:workflowPostFunction"

// For post-functions, determine sub-type:
const extKey = context?.extension?.key || "";
const isStatic = config?.type?.includes("static") || extKey.includes("static");
const isSemantic = config?.type?.includes("semantic") || extKey.includes("semantic");
```

---

## Forge Events (Async Queue)

### Queue Payload Size Limit
`@forge/events` Queue.push() has a ~200KB payload limit. Large configs (static PFs with generated code) can exceed it.

**Fix:** Trim payloads before pushing:
```javascript
const trimmedConfig = { ...config };
if (trimmedConfig.functions) {
  trimmedConfig.functions = trimmedConfig.functions.map(f => ({
    ...f,
    code: f.code?.substring(0, 3000),
    operationPrompt: f.operationPrompt?.substring(0, 500),
  }));
}
await queue.push({ body: { taskType: "review", params: { config: trimmedConfig } } });
```

### Consumer Timeout: 120s vs 25s
Resolvers timeout at 25 seconds. Queue consumers (`consumer` module) timeout at 120 seconds. Use the queue for any AI operation that might take >20 seconds.

---

## Forge Storage (KVS)

### In-Memory Caching Pattern
KVS reads are slow (~50-100ms each). Cache frequently-read values:
```javascript
let _cachedKey = null;
let _cachedKeyChecked = false;

const getKey = async () => {
  if (_cachedKeyChecked) return _cachedKey || process.env.FALLBACK;
  const key = await storage.get("KEY");
  _cachedKeyChecked = true;
  _cachedKey = key;
  return key || process.env.FALLBACK;
};
```
**Invalidate cache** when the value changes (save/remove operations).

### Legacy Migration Pattern
When changing storage key format, migrate on first read:
```javascript
let value = await storage.get(newKey);
if (!value) {
  const legacy = await storage.get(oldKey);
  if (legacy) {
    await storage.set(newKey, legacy);
    value = legacy;
    console.log(`Migrated ${oldKey} to ${newKey}`);
  }
}
```

---

## Multi-Provider AI

### Azure OpenAI: api-key Header, NOT Bearer
```javascript
// WRONG — this is for Entra ID tokens only
headers["Authorization"] = `Bearer ${apiKey}`;

// CORRECT — for API key authentication
headers["api-key"] = apiKey;
```

### OpenRouter: Required Attribution Headers
```javascript
headers["HTTP-Referer"] = "https://yourapp.com";      // Required
headers["X-OpenRouter-Title"] = "Your App Name";       // Required
```
Without these, requests may be rejected or throttled.

### Anthropic: max_tokens is Required
```javascript
// WRONG — request fails
{ model, messages }

// CORRECT
{ model, messages, max_tokens: 4096 }
```

### Anthropic: System Prompt is NOT a Message
```javascript
// WRONG
messages: [{ role: "system", content: "..." }, { role: "user", content: "..." }]

// CORRECT
system: "...",
messages: [{ role: "user", content: "..." }]
```
