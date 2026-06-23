# Real-World Patterns: Forge Implementation Issues & Solutions

> This document aggregates **real problems from Atlassian Community, GitHub issues, and production Forge apps** with verified solutions. Structured for AI models to match user symptoms → solutions quickly.

---

## Table of Contents

1. [CSP & Custom UI Errors](#csp--custom-ui-errors)
2. [Rate Limiting (429 Errors)](#rate-limiting-429-errors)
3. [Storage/KVS Issues](#storagelvs-issues)
4. [Tunnel & Connection Problems](#tunnel--connection-problems)
5. [Migration from Connect to Forge](#migration-from-connect-to-forge)
6. [Performance Optimization](#performance-optimization)
7. [Third-Party Integrations](#third-party-integrations)
8. [Workflow API Patterns](#workflow-api-patterns)

---

## CSP & Custom UI Errors

### Problem: "Refused to load the script" - Content-Security-Policy Errors

**Symptoms:**
```
Refused to load the script 'https://cdn.example.com/react.production.min.js' 
because it violates the following Content Security Policy directive...
```

**Root Cause:**
External CDNs must be explicitly whitelisted in `manifest.yml` under `permissions.content.csp`. Forge blocks all external resources by default for security.

**Solution Code:**
```yaml
permissions:
  content:
    csp:
      scripts:
        - 'https://cdn.example.com'
        - 'https://www.googletagmanager.com'
      styles:
        - 'https://fonts.googleapis.com'
```

**From Community Thread:** When using React from CDN for Custom UI, the CSP must include both the script source AND any inline scripts/styles if not using external files.

---

### Problem: Inline Styles Not Working in Custom UI

**Symptoms:**
- Styled components or inline styles don't apply
- Console shows "inline style blocked by CSP"

**Root Cause:**
By default, `unsafe-inline` is NOT allowed for styles. Must be explicitly permitted.

**Solution Code:**
```yaml
permissions:
  content:
    styles:
      - "unsafe-inline"  # Allow inline styles
```

**Note from Production Apps:** Your CogniRunner app uses this pattern successfully. This is required for React apps using styled-components or emotion.

---

### Problem: Custom UI Components Not Rendering After Deploy

**Symptoms:**
- Blank page in Jira
- No console errors visible
- Previously working deployment suddenly shows nothing

**Root Cause:**
Manifest changes require full redeploy, not just hot reload. The `forge tunnel` command may cache old configuration.

**Workaround:**
```bash
# Instead of just:
forge tunnel

# Use:
forge deploy --verbose && forge tunnel
```

---

### Problem: Resource Path Not Found in Config UI

**Symptoms:**
```
Error: Resource 'config-ui' not found
```

**Root Cause:**
Path to React build folder is incorrect or doesn't exist. Common during development when `npm run build` hasn't been run.

**Solution Code:**
```yaml
resources:
  - key: config-ui-resource
    path: static/config-ui/build  # Must point to actual build output
    
# Verify directory exists before deploying
ls -la static/config-ui/build/
```

---

## Rate Limiting (429 Errors)

### Problem: "429 Too Many Requests" on Bulk Operations

**Symptoms:**
- Processing >50 issues in scheduled trigger fails with 429
- Webhook-style sync hits rate limits after ~10 API calls/second

**Root Cause:**
Forge has default rate limit of ~5 requests/second per app. Exceeding this triggers 429 responses from Jira API.

**Solution Code (Rate Limit Helper):**
```javascript
import api, { route } from "@forge/api";

let requestTimestamps = [];
const MAX_REQUESTS_PER_SECOND = 5;

async function rateLimitedRequest(endpoint, options = {}) {
  const now = Date.now();
  
  // Remove old timestamps (older than 1 second)
  requestTimestamps = requestTimestamps.filter(ts => now - ts < 1000);
  
  // Wait if we've made too many requests in the last second
  while (requestTimestamps.length >= MAX_REQUESTS_PER_SECOND) {
    const oldestRequest = Math.min(...requestTimestamps);
    const waitTime = 1000 - (now - oldestRequest);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  
  requestTimestamps.push(now);
  return api.asApp().requestJira(route`${endpoint}`, options);
}
```

**Solution Code (Batching):**
```javascript
// Process in batches with delays between them
for (let i = 0; i < issues.length; i += batchSize) {
  const batch = issues.slice(i, i + batchSize);
  
  for (const issue of batch) {
    await rateLimitedRequest(`/rest/api/3/issue/${issue.key}`);
  }
  
  // Wait between batches
  if (i + batchSize < issues.length) {
    await new Promise(r => setTimeout(r, 1000));
  }
}
```

---

### Problem: Points Quota Exceeded on Scheduled Triggers

**Symptoms:**
- Scheduled trigger fails mid-execution
- Error mentions "points quota" or "execution time limit"
- 25-second timeout on validators

**Root Cause:**
Forge has execution time limits:
- Validators/Conditions: ~25 seconds max
- Background functions: ~60 seconds max
- Each API call costs points; exceeding budget terminates execution

**Solution Code (Timeout Budget):**
```javascript
// In your validator, track deadline upfront
const DEADLINE = Date.now() + 22000; // Leave 3s buffer from 25s limit

async function longRunningTask(items) {
  for (const item of items) {
    if (Date.now() >= DEADLINE) {
      console.log("Approaching timeout, failing open");
      return { result: true }; // Fail open before hard cutoff
    }
    await processItem(item);
  }
}
```

**From CogniRunner Pattern:** Use deadline checks BEFORE making expensive operations:
```javascript
const deadline = useTools ? Date.now() + AGENTIC_TIMEOUT_MS : 0;

if (Date.now() >= deadline) {
  return { isValid: true, reason: "Validation timed out. Transition allowed." }; // Fail open!
}
```

---

## Storage/KVS Issues

### Problem: Storage API Not Returning Expected Data

**Symptoms:**
- `storage.get()` returns undefined
- Previously stored data disappears after redeploy
- KVS operations seem to have no effect

**Root Cause:**
1. Storage keys must be consistent across deployments
2. Storage is app-scoped but NOT user-scoped - all users share same storage
3. During development, `forge dev` may use different storage namespace than production

**Solution Code (Safe Storage Access):**
```javascript
const CONFIG_REGISTRY_KEY = "config_registry";

async function getConfigs(defaultValue = []) {
  try {
    const stored = await storage.get(CONFIG_REGISTRY_KEY);
    return stored || defaultValue; // Always provide fallback
  } catch (error) {
    console.error("Storage read error:", error);
    return defaultValue;
  }
}

async function setConfigs(configs) {
  try {
    await storage.set(CONFIG_REGISTRY_KEY, configs);
    return true;
  } catch (error) {
    console.error("Storage write error:", error);
    return false; // Don't throw - fail gracefully
  }
}
```

**Best Practice from GitHub Issues:** Always wrap storage operations in try/catch and provide sensible defaults. Never let storage errors crash your function.

---

### Problem: Orphaned Configuration Entries Accumulating in Storage

**Symptoms:**
- Config list grows indefinitely
- Deleted workflows still show in UI
- Storage size keeps increasing

**Root Cause:**
When users delete validators/conditions from Jira workflow, the app's storage entries aren't automatically cleaned up. Over time, orphaned configs accumulate.

**Solution Code (Auto-Cleanup on Read):**
```javascript
async function fetchWorkflowTransitions(workflowName) {
  const response = await api.asApp().requestJira(
    route`/rest/api/3/workflows/search?queryString=${workflowName}&expand=values.transitions`
  );
  
  if (!response.ok) return { transitionRules: null, error: "API failed" };
  
  const data = await response.json();
  const transitionRules = new Map();
  
  for (const wf of data.values || []) {
    if (wf.name !== workflowName) continue;
    
    for (const t of wf.transitions || []) {
      transitionRules.set(String(t.id), {
        validators: t.validators || [],
        conditions: (t.conditions?.conditions || t.conditions || [])
      });
    }
  }
  
  return { transitionRules, error: null };
}

// In getConfigs - check if rule still exists on workflow
const hasOurRule = ruleList.some((r) =>
  r.parameters?.key && r.parameters.key.includes(APP_ID)
);

if (!hasOurRule) {
  // Transition no longer has our rule - it's orphaned
  removed.push(config);
}
```

**From CogniRunner:** Your app implements this exact pattern with `fetchWorkflowTransitions` and orphan detection. This is the correct approach!

---

## Tunnel & Connection Problems

### Problem: `forge tunnel` Won't Connect After Manifest Changes

**Symptoms:**
- `forge tunnel` starts but shows errors immediately
- Error: "Function not found" after adding new module
- Previously working tunnel fails after manifest edit

**Root Cause:**
Manifest changes (new modules, renamed functions) require full redeploy. `forge tunnel` only watches source code, NOT manifest.yml.

**Workaround:**
```bash
# Always redeploy when manifest changes:
forge deploy --verbose && forge tunnel

# Check for function name mismatches:
grep -n "function:" manifest.yml
grep -n "export const" src/index.js
```

---

### Problem: Local Development Can't Access Jira API

**Symptoms:**
- Works in production but fails locally with `forge dev` or `forge tunnel`
- 401 Unauthorized on all Jira API calls
- Context object returns null/undefined

**Root Cause:**
Forge's local development mode needs proper authentication context. The `@forge/api` client uses different auth flow than production.

**Solution Code:**
```javascript
// Always use .asApp() for system-to-Jira calls (no user context needed)
const response = await api.asApp().requestJira(
  route`/rest/api/3/issue/${issueKey}`
);

// Use .asUser() only when you need current user's permissions
const userResponse = await api.asUser({ 
  issueKey, 
  accountId: context.accountId 
}).requestJira(...);
```

**Note:** In validators/conditions, you ALWAYS use `.asApp()` because the call happens in workflow context, not user context.

---

## Migration from Connect to Forge

### Problem: Add-on Key Mismatch After Migration

**Symptoms:**
- Old Connect addon data not found
- User preferences lost after migration
- Database entries orphaned

**Root Cause:**
Connect apps use `key` field for identification. Forge apps use UUID (app.id in manifest). These don't match automatically.

**Solution Pattern:**
```yaml
# In manifest.yml, preserve old key as reference:
app:
  id: ari:cloud:ecosystem::app/YOUR-OLD-ADDON-KEY
  
# Then migrate data using the old key mapping:
const OLD_ADDON_KEY = "com.example.my-addon";
const NEW_APP_ID = "36415848-6868-4697-9554-3c3ad87b8da9";

async function migrateUserData() {
  // Find data keyed by old addon key and re-key it
}
```

**From Community:** There's no automatic migration path. You must:
1. Export data from Connect app (via admin API or database)
2. Import to Forge KVS with new keys
3. Provide user notification about data migration

---

### Problem: Webhook Endpoints Don't Work in Forge

**Symptoms:**
- Connect app used webhookUrl for external notifications
- Forge has no equivalent `webhookUrl` configuration
- Can't receive push notifications from external systems

**Root Cause:**
Forge doesn't support inbound webhooks like Connect did. External systems must poll or use scheduled triggers.

**Workaround Pattern (Polling with KVS):**
```javascript
const LAST_SYNC_KEY = "last-sync-timestamp";

async function getLastSyncTime() {
  return JSON.parse(await storage.get(LAST_SYNC_KEY)) || Date.now();
}

export const syncFromExternalSystem = async () => {
  const since = await getLastSyncTime();
  
  // Fetch changes since last sync
  const response = await api.asApp().requestJira(
    route`/rest/api/3/search`,
    {
      method: 'POST',
      body: JSON.stringify({
        jql: `updated >= "${new Date(since).toISOString()}"`,
        maxResults: 50
      })
    }
  );
  
  // Process changes...
  
  // Update sync timestamp
  await storage.set(LAST_SYNC_KEY, JSON.stringify(Date.now()));
};
```

**Scheduled Trigger:**
```yaml
modules:
  scheduledTrigger:
    - key: sync-external
      function: syncFromExternalSystem
      schedule:
        period: minute  # Check every minute
```

---

## Performance Optimization

### Problem: Slow Custom UI Load Times (>3 seconds)

**Symptoms:**
- Users complain about slow panel/condition loading
- Jira shows "Loading..." spinner for extended time
- Console shows long network requests to /bridge

**Root Cause:**
1. Resolver calls happen on every component mount
2. Large data fetched upfront instead of lazy-loaded
3. No caching of API responses

**Solution Code (Caching Pattern):**
```javascript
// Memoize expensive lookups
const fieldCache = new Map();

async function getFields(projectId) {
  const cacheKey = `${projectId}`;
  
  if (fieldCache.has(cacheKey)) {
    return fieldCache.get(cacheKey);
  }
  
  const fields = await fetchFieldsFromJira(projectId);
  fieldCache.set(cacheKey, fields);
  
  // Clear cache after 5 minutes
  setTimeout(() => fieldCache.delete(cacheKey), 5 * 60 * 1000);
  
  return fields;
}
```

**Solution Code (Lazy Loading):**
```javascript
// In React component - load data only when needed:
export const Configure = () => {
  const [fields, setFields] = useState(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  
  // Don't fetch on mount - wait for user interaction
  const handleOpen = async () => {
    if (hasLoaded) return;
    
    const fields = await getScreenFields();
    setFields(fields);
    setHasLoaded(true);
  };
  
  return (
    <Modal onOpen={handleOpen}>
      {/* ... */}
    </Modal>
  );
};
```

---

### Problem: Large Attachment Downloads Exhaust Memory

**Symptoms:**
- Function crashes with "memory limit exceeded"
- Processing attachments >10MB fails consistently
- Cloud functions terminate mid-execution

**Root Cause:**
Forge has memory limits (~512MB). Downloading large files as base64 consumes significant memory.

**Solution Code (Size Budgets):**
```javascript
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10MB per file
const MAX_TOTAL_ATTACHMENT_SIZE = 20 * 1024 * 1024; // 20MB total

async function processAttachments(attachments) {
  let remainingBudget = MAX_TOTAL_ATTACHMENT_SIZE;
  const toDownload = [];
  
  for (const att of attachments) {
    if (!att.size || att.size > MAX_ATTACHMENT_SIZE) continue;
    
    const mime = (att.mimeType || "").toLowerCase();
    if (!FILE_MIME_TYPES.has(mime)) continue;
    
    if (att.size > remainingBudget) {
      console.log(`Skipped ${att.filename}: exceeds budget`);
      continue;
    }
    
    remainingBudget -= att.size;
    toDownload.push(att);
  }
  
  // Download only what fits in budget
  return Promise.all(toDownload.map(downloadAttachment));
}
```

**From CogniRunner:** Your app implements this exact pattern with `MAX_ATTACHMENT_SIZE` and `MAX_TOTAL_ATTACHMENT_SIZE`. Excellent!

---

## Third-Party Integrations

### Problem: OpenAI API Calls Fail Due to Network Restrictions

**Symptoms:**
```
Error calling OpenAI: fetch failed
Network request blocked
```

**Root Cause:**
Forge requires explicit whitelisting of external domains in `manifest.yml` under `permissions.external.fetch`.

**Solution Code:**
```yaml
permissions:
  scopes:
    - read:jira-work
  external:
    fetch:
      client:          # For Custom UI (React)
        - address: https://api.openai.com
      backend:         # For Lambda functions
        - address: https://api.openai.com
```

**Important:** Both `client` AND `backend` must be listed if you make calls from both frontend and backend.

---

### Problem: External API Authentication in Background Functions

**Symptoms:**
- Can't pass user credentials to external service
- OAuth flow fails because no browser context available
- API key stored insecurely in code

**Root Cause:**
Background functions run without user session. Must use app-level credentials or store user tokens securely.

**Solution Code (Environment Variables):**
```javascript
// In manifest.yml:
app:
  runtime:
    name: nodejs22.x
  
# Set environment variables via forge CLI:
# forge deploy --env OPENAI_API_KEY="sk-..."

// In code:
const getOpenAIKey = () => {
  return process.env.OPENAI_API_KEY;
};

if (!getOpenAIKey()) {
  console.error("API key not configured - check environment variables");
}
```

**Best Practice from GitHub:** Never hardcode API keys. Use `process.env` and set via `forge deploy --env`.

---

### Problem: Slack/Teams Notifications Not Sending

**Symptoms:**
- Integration works in local test but fails in production
- Webhook responses show 401 or 403 errors
- External service rejects Forge's user agent

**Root Cause:**
1. Missing external fetch permission for webhook domain
2. Slack/Teams may require specific headers or payload format
3. Some services block requests from cloud providers

**Solution Code (Slack Integration):**
```yaml
permissions:
  external:
    fetch:
      backend:
        - address: https://hooks.slack.com
        - address: https://slack.com
```

```javascript
async function sendToSlack(message) {
  try {
    const response = await api.asApp().requestJira(
      route`https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXX`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: message,
          blocks: [/* Slack Block Kit */]
        })
      }
    );
    
    if (!response.ok) {
      console.error("Slack webhook failed:", await response.text());
    }
  } catch (error) {
    console.error("Failed to send Slack notification:", error);
    // Don't throw - let main function continue
  }
}
```

---

## Workflow API Patterns

### Problem: Can't Determine Which Field Changed on Transition

**Symptoms:**
- Validator fires but can't tell which field was modified
- Need to validate only changed fields, not all configured fields

**Solution Code (modifiedFields):**
```javascript
export const validate = async (args) => {
  const { issue, configuration, modifiedFields } = args;
  
  // modifiedFields contains ONLY fields changed on this transition
  if (!modifiedFields[configuration.fieldId]) {
    console.log("Configured field was not modified - skipping validation");
    return { result: true }; // Skip if field unchanged
  }
  
  const fieldValue = modifiedFields[configuration.fieldId];
  // ... validate only changed field
};
```

**Note:** `modifiedFields` is available for UPDATE transitions. For CREATE transitions, issue.key will be null and you must use `modifiedFields`.

---

### Problem: Need to Get Field Options (Select List Values) Dynamically

**Symptoms:**
- Can't populate dropdown with field options from Jira schema
- Static options become stale when admin adds new choices

**Solution Code (Field Schema Lookup):**
```javascript
async function getFieldOptions(fieldId) {
  const response = await api.asApp().requestJira(
    route`/rest/api/3/field/${fieldId}/options`,
    { headers: { Accept: "application/json" } }
  );
  
  if (!response.ok) return [];
  
  const data = await response.json();
  return (data.values || []).map(opt => ({
    label: opt.value,
    value: opt.id
  }));
}

// Usage in config UI:
const options = await getFieldOptions(configuration.fieldId);
```

---

### Problem: Workflow Rules Need to Survive Workflow Changes

**Symptoms:**
- User deletes validator from workflow, re-adds it later
- App shows duplicate rules or stale configurations
- Workflow transition ID changes after workflow edit

**Root Cause:**
Jira regenerates workflow IDs when workflows are edited. Apps that store only `workflowId + transitionId` lose association.

**Solution Pattern (Match by Multiple Keys):**
```javascript
// In CogniRunner pattern - use multiple matching strategies:

// Strategy 1: Match by stable rule ID
let existingIndex = configs.findIndex((c) => c.id === id);

// Strategy 2: Fall back to workflow context (same transition = same rule)
if (existingIndex < 0 && workflowData.workflowName && workflowData.transitionId) {
  existingIndex = configs.findIndex((c) =>
    c.workflow?.workflowName === workflowData.workflowName
    && String(c.workflow?.transitionId) === String(workflowData.transitionId)
  );
}

// Strategy 3: During getConfigs, verify rule still exists on transition
const hasOurRule = ruleList.some((r) =>
  r.parameters?.key && r.parameters.key.includes(APP_ID)
);
```

**From CogniRunner:** Your app implements all three strategies. This is the most robust approach!

---

### Problem: Screen-Specific Field Filtering Not Working

**Symptoms:**
- Config UI shows ALL Jira fields, including ones not on screen
- Users can select fields they shouldn't be able to configure
- Fields appear/disappear unpredictably between projects

**Root Cause:**
Field availability depends on:
1. Project's screen scheme configuration
2. Issue type → screen mapping
3. Operation type (create vs edit vs view)

**Solution Code (Full Screen Resolution Chain):**
```javascript
async function getScreenFields(projectId, workflowId, transitionId) {
  const isCreateTransition = String(transitionId) === "1";
  
  // Step 1: Resolve project from workflow if needed
  if (!projectId && workflowId) {
    projectId = (await fetchProjectsForWorkflow(workflowId))?.[0];
  }
  
  // Step 2: Get issue type screen scheme for project
  const itsScheme = await api.asApp().requestJira(
    route`/rest/api/3/issuetypescreenscheme/project?projectId=${projectId}`
  );
  
  // Step 3: Get default mapping (issueType → screenScheme)
  const mappings = await api.asApp().requestJira(
    route`/rest/api/3/issuetypescreenscheme/mapping?issueTypeScreenSchemeId=${itsScheme.id}`
  );
  const defaultMapping = mappings.values.find(m => m.issueTypeId === "default");
  
  // Step 4: Get screen scheme (operation → screen ID)
  const screenScheme = await api.asApp().requestJira(
    route`/rest/api/3/screenscheme?id=${defaultMapping.screenSchemeId}`
  );
  
  // Step 5: Pick correct screen based on operation type
  const screenId = isCreateTransition 
    ? (screenScheme.screens.create || screenScheme.screens.default)
    : (screenScheme.screens.edit || screenScheme.screens.default);
  
  // Step 6: Get fields from that screen's tabs
  const tabFields = await api.asApp().requestJira(
    route`/rest/api/3/screens/${screenId}/tabs/*/fields`
  );
  
  return filterToScreenOnly(tabFields, isCreateTransition);
}
```

**From CogniRunner:** Your `getScreenFields` resolver implements the complete chain. This is production-grade!

---

## Appendix: Common Scopes Reference

| Purpose | Required Scope |
|---------|---------------|
| Read issue data | `read:jira-work` |
| Read workflow info | `read:workflow:jira` |
| Read project info | `read:project:jira` |
| Storage operations | `storage:app` |
| Read screen schemes | `read:screenable-field:jira`, `read:screen-tab:jira` |
| Issue type schemes | `read:issue-type-screen-scheme:jira` |

---

## Appendix: Error Message Quick Reference

| Error Message | Likely Cause | Solution |
|--------------|--------------|----------|
| "Refused to load script" | CSP violation | Add domain to `permissions.content.csp.scripts` |
| "429 Too Many Requests" | Rate limit exceeded | Implement rate limiting helper + batching |
| "Function not found" | Manifest/code mismatch | Redeploy after manifest changes; verify function names |
| "Permission denied" | Missing scope | Add required scope to `permissions.scopes` |
| "Resource not found" | Build folder missing | Run `npm run build` before deploy |
| "Storage read error" | KVS access issue | Wrap in try/catch, provide defaults |

---

## Appendix: From CogniRunner - Clever Patterns Worth Reusing

### 1. Agentic Validation with Tool Triggers

Detect when user's prompt implies need for JQL search tools:
```javascript
const TOOL_TRIGGER_PATTERN = /\b(duplicat(?:e[ds]?|ion)|already\s+(?:exists?|reported|created|filed|logged)|previously\s+(?:reported|created|filed|logged)|existing\s+(?:issues?|tickets?|bugs?|stor(?:y|ies)|tasks?)|redundan(?:t|cy)\s+(?:issues?|tickets?|bugs?|entries?)|identical\s+(?:issues?|tickets?|bugs?)|(?:similar|resembl(?:es?|ing))\s+(?:issues?|tickets?|bugs?|stor(?:y|ies)|tasks?|entries?)|no\s+duplicat|(?:search|query|check)\s+jira|find\s+(?:related|matching|existing)\s+(?:issues?|tickets?|bugs?|stor(?:y|ies)|tasks?)|cross[- ]?reference|compare\s+(?:against|with)\s+(?:existing|other|jira))\b/i;

const promptRequiresTools = (prompt) => TOOL_TRIGGER_PATTERN.test(prompt);
```

### 2. Timeout Budget Management

Leave buffer before hard limit:
```javascript
const AGENTIC_TIMEOUT_MS = 22000; // Leave 3s buffer from 25s limit
const deadline = Date.now() + AGENTIC_TIMEOUT_MS;

if (Date.now() >= deadline) {
  return { isValid: true, reason: "Timed out. Fail open." };
}
```

### 3. Field Value Extraction for All Types

Handle complex Jira field structures:
```javascript
const extractFieldDisplayValue = (value) => {
  if (!value) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  
  // ADF content
  if (value.type === "doc" && value.content) return extractTextFromADF(value);
  
  // User fields
  if (value.displayName) return value.displayName;
  
  // Select fields
  if (value.name) return value.name;
  if (value.value) return value.value;
  
  // Arrays (multi-select, components, versions)
  if (Array.isArray(value)) {
    return value.map(extractFieldDisplayValue).filter(v => v).join(", ");
  }
  
  // Fallback: JSON stringify complex objects
  try { return JSON.stringify(value); } catch { return "[Complex]"; }
};
```

---

## How to Use This Document (for AI Models)

1. **Match symptoms first** - User describes an error? Find the matching "Symptoms" section
2. **Provide solution code** - Copy-paste ready fixes are included for each pattern
3. **Reference from CogniRunner** - Your app demonstrates many of these patterns in production
4. **Fail open philosophy** - Always recommend graceful degradation over hard failures

---

## CSS Animations in Forge Custom UI

### Animation Catalog (Production-Tested)

Use these exact durations and easings — they're calibrated for Forge iframe rendering:

| Animation | Keyframes | Duration | Easing | Use Case |
|---|---|---|---|---|
| **skShimmer** | `background-position: 200% 0 → -200% 0` | 1.5s | ease-in-out infinite | Skeleton loading |
| **sectionFadeIn** | `opacity: 0→1, translateY: 8px→0` | 0.3s | ease both | Section/panel entrance |
| **alertSlideIn** | `opacity: 0→1, translateY: -6px→0` | 0.25s | ease both | Alert notifications |
| **dropdownSlideIn** | `opacity: 0→1, translateY: -4px→0` | 0.15s | ease | Dropdown open |
| **tabContentFade** | `opacity: 0→1` | 0.2s | ease both | Tab switching |
| **successPop** | `opacity: 0→1, scale: 0.9→1` | 0.4s | cubic-bezier(0.34,1.56,0.64,1) | Success state |
| **successCheckmark** | `scale: 0.5→1.1→1, rotate: -20→5→0` | 0.5s | ease (0.2s delay) | Checkmark icon |
| **tooltipFadeIn** | `opacity: 0→1, translate: 4px→0` | 0.15s | ease | Tooltip entrance |

### Timing Guidelines

```
Instant feedback (hover, press):     0.1-0.15s ease
Small reveals (dropdown, tooltip):   0.15-0.2s ease
Panel/section entrance:              0.25-0.3s ease both
Success/celebration:                 0.4-0.5s spring curve
Loading shimmer:                     1.5s ease-in-out infinite
```

### Interactive Feedback Patterns

```css
/* Card hover — subtle shadow lift */
.card {
  transition: box-shadow 0.25s ease, transform 0.25s ease;
}
.card:hover {
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
}

/* Button press — scale feedback */
.btn:active:not(:disabled) {
  transform: scale(0.96);
}

/* Dropdown chevron — rotation */
.dropdown-chevron {
  transition: transform 0.2s ease;
}
.dropdown-trigger.dropdown-open .dropdown-chevron {
  transform: rotate(180deg);
}

/* Focus ring — glow effect */
input:focus, textarea:focus {
  border-color: var(--primary-color);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
  outline: none;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}
```

### Skeleton Loading — Theme-Safe Pattern

**Critical:** Default skeleton colors must work BEFORE `data-color-mode` is set by Forge:

```css
/* 1. Default: transparent/neutral (works on any background) */
.sk {
  background: linear-gradient(90deg, rgba(128,128,128,0.1) 25%, rgba(128,128,128,0.18) 50%, rgba(128,128,128,0.1) 75%);
  background-size: 200% 100%;
  animation: skShimmer 1.5s ease-in-out infinite;
}

/* 2. Light theme (after data-color-mode is set) */
html[data-color-mode="light"] .sk {
  background: linear-gradient(90deg, #e2e8f0 25%, #f1f5f9 50%, #e2e8f0 75%);
}

/* 3. Dark theme */
html[data-color-mode="dark"] .sk {
  background: linear-gradient(90deg, #1e1e2e 25%, #2a2a3a 50%, #1e1e2e 75%);
}

/* 4. System preference fallback (before data-color-mode loads) */
@media (prefers-color-scheme: dark) {
  .sk { background: linear-gradient(90deg, #1e1e2e 25%, #2a2a3a 50%, #1e1e2e 75%); }
}
```

### Skeleton Shape Matching

Always match skeleton shapes to the content they replace:

```jsx
// BAD: generic rectangle
<div className="sk" style={{ height: 36 }} />

// GOOD: matches actual user card layout
<div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
  <div className="sk" style={{ width: 36, height: 36, borderRadius: "50%" }} />
  <div>
    <div className="sk sk-text" style={{ width: 120, height: 13, marginBottom: 4 }} />
    <div className="sk sk-text" style={{ width: 80, height: 10 }} />
  </div>
</div>
```

---

## Multi-Provider AI Adapter

### Provider Configuration Storage

```javascript
const PROVIDERS = {
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-5.4-mini" },
  azure: { label: "Azure OpenAI", baseUrl: null, defaultModel: "gpt-5.4-mini" },
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", defaultModel: "openai/gpt-4o-mini" },
  anthropic: { label: "Anthropic", baseUrl: "https://api.anthropic.com", defaultModel: "claude-haiku-4-5-20251001" },
};
```

### Per-Provider Auth Headers

```javascript
if (provider === "azure") {
  headers["api-key"] = apiKey;                    // Azure uses api-key header
} else if (provider === "anthropic") {
  headers["x-api-key"] = apiKey;                  // Anthropic uses x-api-key
  headers["anthropic-version"] = "2023-06-01";    // Required version header
} else {
  headers["Authorization"] = `Bearer ${apiKey}`;  // OpenAI, OpenRouter use Bearer
}

if (provider === "openrouter") {
  headers["HTTP-Referer"] = "https://yourapp.com";       // Required for OpenRouter
  headers["X-OpenRouter-Title"] = "Your App Name";       // Required for OpenRouter
}
```

### Per-Provider Key Storage (Never Delete on Switch)

```javascript
const providerKeySlot = (provider) => `MYAPP_KEY_${provider}`;
// MYAPP_KEY_openai, MYAPP_KEY_anthropic, etc.
// Switching providers only changes active provider — all keys preserved
```

---

## Role-Based Access Control

### Three-Tier Permission Model

```javascript
const getUserPermissions = async (accountId) => {
  // 1. Check app users list in KVS
  const appUsers = (await storage.get(APP_ADMINS_KEY)) || [];
  const entry = appUsers.find(u => u.accountId === accountId);
  if (entry) return { role: entry.role || "admin", scope: entry.scope || "all" };

  // 2. Bootstrap: first user becomes admin
  if (appUsers.length === 0) {
    await storage.set(APP_ADMINS_KEY, [{ accountId, role: "admin", scope: "all" }]);
    return { role: "admin", scope: "all" };
  }

  // 3. Check Jira admin group
  for (const group of ["jira-administrators", "site-admins"]) {
    const resp = await api.asApp().requestJira(
      route`/rest/api/3/group/member?groupname=${group}&maxResults=200`
    );
    if (resp.ok) {
      const data = await resp.json();
      if (data.values.some(u => u.accountId === accountId)) return { role: "admin", scope: "all" };
    }
  }
  return null;
};
```

---

## Workflow Rule Injection via REST API

### Getting Environment ID

```javascript
import { getAppContext } from "@forge/api";
const appCtx = getAppContext();
const envId = appCtx?.environmentAri?.environmentId;
```

### Extension ARI Format

```
ari:cloud:ecosystem::extension/{appId}/{envId}/static/{moduleKey}
```

### Rule Key Mapping

| Module Type | ruleKey |
|---|---|
| `jira:workflowValidator` | `forge:expression-validator` |
| `jira:workflowCondition` | `forge:expression-condition` |
| `jira:workflowPostFunction` | `forge:expression-post-function` |

---

*Document compiled from: Atlassian Community Forums, GitHub Issues, and production analysis of leanzero-srl/leanzero-cognirunner-forgeapp (v14.x).*