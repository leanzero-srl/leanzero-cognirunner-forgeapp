# CogniRunner Features — Detailed Guide

> Complete feature documentation for users, administrators, and developers. Each section explains what the feature does, how to configure it, how it works internally, and common pitfalls.

---

## Table of Contents

1. [Workflow Validators](#workflow-validators)
2. [Workflow Conditions](#workflow-conditions)
3. [Semantic Post-Functions](#semantic-post-functions)
4. [Static Post-Functions](#static-post-functions)
5. [Agentic Validation (JQL Search)](#agentic-validation)
6. [Attachment Validation](#attachment-validation)
7. [Field Editability Pre-Flight](#field-editability-pre-flight)
8. [Documentation Library](#documentation-library)
9. [AI Review](#ai-review)
10. [Test Run / Dry Run](#test-run--dry-run)
11. [Execution Logs](#execution-logs)
12. [Add Rule Wizard](#add-rule-wizard)
13. [Enable / Disable Rules](#enable--disable-rules)

---

## Workflow Validators

### What It Does

A CogniRunner validator runs **before** a workflow transition completes. If the AI determines the field content doesn't meet the criteria, the transition is **blocked** and the user sees an error message with the AI's reasoning.

### Configuration

1. **Field to Validate** — select from a dropdown of all system and custom fields. The dropdown is context-aware: it resolves the project's screen scheme chain to show only fields on the relevant transition screen.
2. **Validation Prompt** — describe what "valid" means in plain English. Example: *"The description must contain steps to reproduce, expected behavior, and actual behavior."*
3. **Jira Search (JQL)** — controls agentic mode:
   - **Auto-detect** (default): CogniRunner analyzes your prompt for keywords like "duplicate", "similar", "already exists". If detected, JQL search tools are enabled.
   - **Always enabled**: Every validation runs with JQL search capability.
   - **Always disabled**: Pure text validation, no Jira searches.

### How It Works Internally

```
validate(args) is called by Forge
  → Parse configuration from JSON string
  → Check license (skip if inactive)
  → Check if rule is disabled in KVS (skip if disabled)
  → Extract field value from modifiedFields or REST API
  → Detect if agentic mode needed
  → Call AI provider via callAIChat()
  → AI returns { isValid: boolean, reason: string }
  → If invalid → return { result: false, errorMessage: reason }
  → If valid → return { result: true }
  → Store execution log
```

### Error Handling

- **AI timeout** → fail open (allow transition)
- **API key missing** → fail open with console warning
- **Network error** → fail open
- **Invalid JSON from AI** → fail open

### Common Pitfalls

- **Prompt too vague**: "Check if the description is good" → AI doesn't know what "good" means. Be specific: "Description must contain at least 3 sentences and mention the affected component."
- **Field not on screen**: If the field isn't on the transition screen, `modifiedFields` won't contain it. CogniRunner falls back to fetching via REST API, but on CREATE transitions (no issue key), this fallback isn't available.

---

## Workflow Conditions

### What It Does

A CogniRunner condition controls **visibility** of a transition. If the AI determines the criteria isn't met, the transition button is **hidden** — the user cannot see or click it. Unlike validators, there's no error message.

### Configuration

Identical to validators (same field selector, prompt, JQL toggle). The only difference is behavioral: conditions hide the button, validators show an error.

### When to Use Conditions vs Validators

| Scenario | Use |
|----------|-----|
| "Only managers should see the Approve transition" | Condition |
| "Description must have acceptance criteria before moving to In Review" | Validator |
| "Hide the Done transition until all subtasks are resolved" | Condition |
| "The summary must not contain profanity" | Validator |

**Rule of thumb:** If the user shouldn't even try → condition. If the user can try but should get feedback → validator.

### Performance Note

Conditions are evaluated **every time the issue is viewed** (to determine button visibility). Slow conditions delay issue rendering. Keep prompts simple for conditions — save complex agentic searches for validators.

---

## Semantic Post-Functions

### What It Does

After a transition completes, the AI reads a source field, evaluates a condition, and if met, generates a new value for a target field. The target field is then updated automatically.

### Configuration

1. **Condition** (required) — when should this post-function run? Examples:
   - "Run every time" (always-run fast path — shorter AI prompt)
   - "Run when the description mentions a bug or defect"
   - "Only when the priority is High or Critical"
2. **Action** (optional) — what should the AI generate? Examples:
   - "Summarize the issue into 2-3 bullet points"
   - "Append a review checklist to the existing content"
   - Leave empty for generic summarization
3. **Target Field** (required) — which field to update with the AI-generated value

### How It Works Internally

```
executePostFunction() is called by Forge (after transition)
  → Parse configuration
  → Parallel fetch: source field value + context docs + API key + model
  → Check target field editability via GET /rest/api/3/issue/{key}/editmeta
    → If not editable → log error + recommendation, skip
  → Build prompts (short version for "always run" conditions)
  → Call AI → { decision: "UPDATE"|"SKIP", value: "...", reason: "..." }
  → If UPDATE:
    → Auto-format value via formatValueForField()
      → Select fields: "High" → { value: "High" }
      → Multi-select: "A, B" → [{ value: "A" }, { value: "B" }]
      → Numbers: "42" → 42
    → PUT /rest/api/3/issue/{key} with formatted value
    → On failure: parse exact Jira error body for actionable guidance
  → Store execution trace + recommendation in log
```

### Pre-Flight Safety

Before calling the AI, CogniRunner checks if the target field can actually be edited on the issue:

1. Calls `GET /rest/api/3/issue/{key}/editmeta`
2. Checks if `actionFieldId` exists in the editable fields
3. If not editable → stops immediately with clear error:
   - Lists why it might not be editable (not on edit screen, read-only, wrong issue type)
   - Lists the fields that ARE editable (first 15)
   - Suggests changing the target field

### Auto-Formatting

The AI generates plain text, but Jira fields expect specific formats:

| Field Schema Type | AI Output | Auto-Formatted |
|---|---|---|
| `option` (select) | `"High"` | `{ value: "High" }` |
| `array` of `option` (multi-select) | `"A, B, C"` | `[{ value: "A" }, { value: "B" }, { value: "C" }]` |
| `array` of `string` (labels) | `"bug, urgent"` | `["bug", "urgent"]` |
| `number` | `"42"` | `42` |
| `string` (text) | `"Hello"` | `"Hello"` (no change) |

### Error Messages

When a field update fails (HTTP 400), CogniRunner:
1. Parses the actual Jira error body (`errors` and `errorMessages`)
2. Shows the verbatim Jira error in the execution trace
3. Provides field-type-specific fix guidance

---

## Static Post-Functions

### What It Does

Chain multiple operations with AI-generated JavaScript code. The AI generates code once during setup. After that, the code runs on every transition with **zero AI cost**.

### Function Builder

Each static post-function can have up to 50 steps. Each step has:

1. **Name** (optional) — human-readable label
2. **Description** — "What should this step do?" in plain English
3. **Operation Type** — determines code generation context:
   - **JQL Search** — generates `api.searchJql()` code
   - **Jira REST API** — generates `api.getIssue()` / `api.updateIssue()` code with endpoint picker
   - **External API** — generates fetch code for external webhooks
   - **Confluence API** — generates Confluence page operations
   - **Debug Log** — generates `api.log()` code
4. **Operation-specific fields**:
   - Jira REST API: HTTP method + endpoint path
   - External API: URL
   - Confluence: operation type + space key
5. **Result Variable** — name for this step's return value (e.g., `result1`)
6. **Backoff toggle** — exponential backoff with jitter (up to 3 retries)
7. **Generate Code** button — calls AI to generate JavaScript
8. **Code editor** — view and edit the generated code

### Variable Chaining

Steps can reference results from previous steps using `${variableName}`:

```
Step 1: "Find all issues with same summary"
  → variableName: duplicates
  → Code: const results = await api.searchJql("...");

Step 2: "Add comment to each duplicate"
  → Can reference ${duplicates} from step 1
  → Code: for (const issue of duplicates) { ... }
```

### Sandbox API Surface

Generated code runs in a sandboxed `new Function()` context with these APIs:

| Method | Description | Returns |
|--------|-------------|---------|
| `api.getIssue(key)` | GET issue via REST API | Full issue object with `fields.*` |
| `api.updateIssue(key, fields)` | PUT issue fields | `{ success: true }` |
| `api.searchJql(jql)` | POST JQL search | `{ issues: [...], total: N }` |
| `api.transitionIssue(key, transitionId)` | POST transition | `{ success: true }` |
| `api.log(...args)` | Debug logging | void |
| `api.context.issueKey` | Current issue key | string |

### Test Run Behavior

- **Reads are real** — `getIssue` and `searchJql` hit the live Jira API
- **Writes are simulated** — `updateIssue` and `transitionIssue` log the operation but don't execute
- Results show: execution logs, simulated changes, timing

---

## Agentic Validation

### What It Does

When enabled, the AI can autonomously search your Jira project during validation. It constructs JQL queries, analyzes results, and iterates before making a decision.

### Tool Registry

Currently one tool: `search_jira_issues`

```javascript
{
  name: "search_jira_issues",
  description: "Search Jira issues via JQL. Returns up to 10 issues with key, summary, 
                status, priority, issue type, and the validated field content (500 chars).",
  parameters: {
    jql: "JQL query string with operators, functions, and field references"
  }
}
```

### Multi-Turn Loop

```
Round 1:
  AI: "I need to check for duplicates. Let me search."
  AI calls: search_jira_issues({ jql: 'project = PROJ AND summary ~ "login error"' })
  CogniRunner: executes JQL, returns 3 issues

Round 2:
  AI: "Found 3 matches. Let me check if any are truly duplicates."
  AI calls: search_jira_issues({ jql: 'project = PROJ AND description ~ "timeout on login page"' })
  CogniRunner: executes JQL, returns 1 issue

Round 3:
  AI: "PROJ-45 describes the exact same problem."
  AI returns: { isValid: false, reason: "Potential duplicate of PROJ-45: both describe..." }
```

### Safety Controls

| Control | Value | Purpose |
|---------|-------|---------|
| Max tool rounds | 3 | Bound latency |
| Timeout budget | 22 seconds | Leave 3s buffer from Forge's 25s limit |
| Project scoping | Automatic | JQL always scoped to current project |
| Fail-open | On timeout or max rounds | Never block indefinitely |

### Auto-Detection

CogniRunner analyzes the prompt for these patterns:

```regex
/duplicat|already\s+exists|previously\s+reported|existing\s+issues|
redundant|identical|similar\s+issues|search\s+jira|find\s+related|
cross[- ]?reference|compare\s+against/i
```

If matched → agentic mode activates automatically.

---

## Attachment Validation

### Supported File Types

| Category | MIME Types | Max Size |
|----------|-----------|----------|
| **Images** | PNG, JPEG, GIF, WebP | 10 MB per file |
| **PDFs** | application/pdf | 10 MB per file |
| **Word** | DOCX, DOC, RTF, ODT | 10 MB per file |
| **Excel** | XLSX, XLS, CSV, TSV | 10 MB per file |
| **PowerPoint** | PPTX, PPT | 10 MB per file |

**Total budget:** 20 MB across all attachments per validation.

### How It Works

1. CogniRunner downloads each attachment via Jira REST API
2. Images are converted to OpenAI vision format (`image_url` with base64 data URI) or Anthropic `image` format
3. Documents are converted to OpenAI `file` format or Anthropic `document` format
4. Attachments are sent alongside the text prompt as multimodal content
5. AI analyzes both the text content and the attached files

### Limitation

Attachments are **not available during CREATE transitions**. Jira doesn't expose attachments in `modifiedFields` during issue creation (the issue doesn't exist yet). Attachment validation is automatically skipped on create.

---

## Field Editability Pre-Flight

### What It Does

Before calling the AI for a semantic post-function (both test runs and real executions), CogniRunner checks whether the target field can actually be edited on the issue.

### How It Works

1. Calls `GET /rest/api/3/issue/{key}/editmeta`
2. The response contains a `fields` object with all editable fields and their schemas
3. If the target field isn't in the editable fields → immediate error with:
   - Reason why it might not be editable
   - List of fields that ARE editable (first 15)
   - Suggestion to change the target field

### What It Also Does

If the field IS editable, the pre-flight check also:
- Logs the field's schema type (text, option, number, etc.)
- Logs allowed values for select fields
- Validates proposed values against the schema during test runs

---

## Documentation Library

### What It Does

Upload reference documents (API specs, JSON schemas, business rules, code snippets) that the AI can use as context during validation and post-function execution.

### How It Works

1. Documents are stored in Forge KVS with a content key (`doc_content:{id}`)
2. An index (`doc_repo_index`) tracks metadata: title, category, size, owner
3. When a rule has `selectedDocIds`, the content is fetched and appended to the AI prompt
4. Max 30,000 characters of document content per AI call

### Categories

- API Documentation
- Field Mappings
- JSON Schemas
- Business Rules
- Code Snippets
- General

### Auto-Format

The docs tab auto-detects content type and formats it:
- **JSON** → pretty-print with 2-space indent
- **XML/HTML** → indent nested elements
- **YAML** → normalize tabs to 2 spaces
- **JavaScript** → convert tabs to 2 spaces

---

## AI Review

### What It Does

Analyzes a rule's configuration and provides actionable feedback: what's good, what might break, and how to fix it.

### How It Works

1. Frontend calls `reviewConfig` resolver
2. Resolver pushes task to `@forge/events` Queue (avoiding 25s resolver timeout)
3. Async consumer (`async-handler.js`) picks up task with 120s timeout
4. AI analyzes the config and returns structured feedback:
   ```json
   {
     "verdict": "good" | "needs_attention" | "has_issues",
     "summary": "One short sentence",
     "items": [
       { "type": "success", "message": "..." },
       { "type": "warning", "message": "Problem. Fix: solution." },
       { "type": "error", "message": "..." },
       { "type": "tip", "message": "..." }
     ]
   }
   ```
5. Frontend polls `getAsyncTaskResult` every 3 seconds until result arrives

### Rules

- Maximum 4 items total
- First item is always `success` summarizing what the config does
- Every `warning` must include a fix in the same message
- No warnings about AI costs or "runs on every transition"

---

## Test Run / Dry Run

### What It Does

Tests a rule against a real Jira issue without executing any writes.

### Three Test Types

| Test | Resolver | What's Real | What's Simulated |
|------|----------|-------------|------------------|
| **Validator test** | `testValidation` | Issue fetch, field extraction, AI call | Nothing — it's read-only |
| **Semantic PF test** | `testSemanticPostFunction` | Issue fetch, editmeta check, AI call | Field update (shows proposed value) |
| **Static PF test** | `testPostFunction` | `getIssue`, `searchJql` | `updateIssue`, `transitionIssue` |

### Semantic PF Test Results

```
Decision: UPDATE
Issue: PROJ-123
Execution time: 1956ms
Tokens: 614

AI Reasoning: "The condition is met because..."

Source Field (description):
"Current field value preview..."

Proposed Value for customfield_10050:
"AI-generated value that would be written..."
(DRY RUN — field was NOT updated)

Execution Log:
- Reading field "description" from PROJ-123
- Target field "customfield_10050" is editable (type: string)
- Calling AI (model: gpt-5.4-nano)...
- AI responded in 1477ms (614 tokens)
- Decision: UPDATE — reason text
```

---

## Execution Logs

### What's Stored

Last 50 entries (FIFO), each containing:

| Field | Description |
|-------|-------------|
| `type` | validator, condition, postfunction-semantic, postfunction-static, postfunction-error |
| `issueKey` | e.g., PROJ-123 |
| `fieldId` | The field that was validated or updated |
| `isValid` | Pass/fail |
| `reason` | AI reasoning or error description |
| `executionTimeMs` | Total execution time |
| `ruleId` | KVS config ID for the rule |
| `ruleName` | "WorkflowName / From → To" |
| `trace` | Array of step-by-step execution entries |
| `recommendation` | AI-generated fix suggestion (on failure) |
| `toolMeta` | JQL queries, rounds, result count (agentic only) |
| `tokens` | AI token usage |

### Where They're Shown

1. **Config-view** — filtered to the specific rule being viewed
2. **Admin panel** — all logs across all rules, with type filter and rule identity

---

## Add Rule Wizard

### What It Does

Allows editors and admins to create rules directly from the CogniRunner admin panel without needing access to the Jira workflow editor.

### 5-Step Flow

1. **Project** — grid of all Jira projects with actual project icons (loaded via CSP-allowed image URLs)
2. **Workflow** — lists only workflows assigned to the selected project (resolved via GET workflow scheme → GET scheme details → search workflow names)
3. **Transition** — all transitions with from/to status names (resolved via GET /rest/api/3/status) and existing CogniRunner rule indicators
4. **Rule Type** — Validator, Condition, Semantic PF, Static PF (2x2 card grid)
5. **Configure** — full config form matching the workflow editor UI per type

### Programmatic Injection

After saving, the wizard:
1. Registers the config in KVS (`registerConfig` or `registerPostFunction`)
2. Injects the rule into the actual Jira workflow via `POST /rest/api/3/workflows/update`
   - Gets environment ID from `getAppContext().environmentAri.environmentId`
   - Builds extension ARI: `ari:cloud:ecosystem::extension/{appId}/{envId}/static/{moduleKey}`
   - GETs the full workflow definition (all statuses + all transitions)
   - Adds the Forge rule to the target transition's rules array
   - POSTs the entire workflow back (full replacement, not patch)

### Navigation

Breadcrumb steps are clickable to go back. Clicking a completed step resets downstream selections.

### Success State

After creation, shows a success panel with checkmark animation, summary of what was created, and "Done" / "Add Another Rule" buttons.

---

## Enable / Disable Rules

### What It Does

Toggle individual rules on/off without removing them from the workflow. Disabled rules are skipped at runtime (fail-open).

### Where

1. **Admin panel** — Disable/Enable button per rule in the rules table
2. **Config-view** — status banner with toggle button (shown in workflow editor summary view)

### How It Works

1. `disableRule` / `enableRule` resolver sets `disabled: true/false` on the KVS config entry
2. At runtime, `validate()` and `executePostFunction()` check:
   ```javascript
   const match = configs.find(c => c.id === ruleId);
   if (match?.disabled) {
     console.log(`Rule "${ruleId}" is disabled — skipping`);
     return { result: true }; // Fail open
   }
   ```
3. Config-view detects rule type and routes to correct resolver:
   - Validators/conditions → `disableRule` / `enableRule`
   - Post-functions → `disablePostFunction` / `enablePostFunction`
