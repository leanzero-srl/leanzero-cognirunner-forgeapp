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
14. [Listeners (Jira events)](#listeners-jira-events)
15. [Scheduled Jobs (cron)](#scheduled-jobs-cron)
16. [Rules REST API](#rules-rest-api)
17. [Editions: Standard and Coder](#editions-standard-and-coder)
18. [The Coder (1.4)](#the-coder-14)
19. [Git integration (1.4)](#git-integration-14)
20. [Virtual Administrators (1.5)](#virtual-administrators-15)
21. [Confluence (1.5)](#confluence-15)

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

A CogniRunner condition **hides** a transition unless the issue qualifies. The user cannot see or
click it, and there is no error message — that is a validator's job.

### Conditions never use AI — and never can

Jira does not call the app to evaluate a condition. It evaluates a **Jira expression** in its own
sandbox: no network access, no app storage, no `await`. An AI-powered condition is therefore
impossible on the Forge platform, permanently, for any vendor.

The upside is real: a condition costs **nothing** per transition, adds no latency, and cannot fail
open on a provider outage.

### Configuration

Pick a check from the catalog and fill in its parameters. There is no prompt. The checks:

| Check | Parameters |
|---|---|
| Field has a value / Field is empty | field |
| Field equals a value | field, value |
| Issue type is… | issue type |
| Issue is resolved / Resolution is… | (resolution) |
| Priority is… | priority |
| Parent issue status is… | status (top-level issues always pass) |
| Current user is the assignee / reporter | — |
| Git: the pull request is merged / is approved / the build has not failed | repository |

The three Git checks (1.4) read the advisory `cognirunner.git` issue property that the git
webhook listeners write. They hide the transition only on a known-negative state and evaluate
true on a missing property, so they never block on their own; the Git *validators* of the same
name verify live. See [`GIT-INTEGRATION.md`](GIT-INTEGRATION.md#6-git-conditions).

Checks that need related issues, attachments or group membership are greyed out: Jira's expression
sandbox cannot reach them. Use a validator for those.

> Note the last two. `current-user-is-assignee` / `-is-reporter` are marked *unavailable* for
> validators, because Forge does not pass the acting user to a validator function. A Jira expression
> **does** get the `user` binding — so those two work as conditions and only as conditions.

### Where a condition is enforced

Everywhere: the issue-view transition menu, REST, automation and bulk changes. A hidden transition
is rejected with a 4xx if something tries to fire it anyway.

*(An earlier version of this document, and harness finding F3, claimed conditions were "advisory UI
gating" that REST bypassed. That was wrong — see F3 in test-harness/FINDINGS.md. The app's own
manifest shipped a constant `expression: "true"`, so conditions passed everywhere and nothing was
ever really tested.)*

### When to Use Conditions vs Validators

| Scenario | Use |
|----------|-----|
| "Hide Approve unless the current user is the assignee" | Condition |
| "Hide Start Work until the issue has a fix version" | Condition |
| "Description must have acceptance criteria before moving to In Review" | Validator |
| "The summary must not contain profanity" | Validator |

**Rule of thumb:** deterministic and the user shouldn't even try → condition. Needs judgement about
free text, or the user deserves an explanation → validator.

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

---

## Listeners (Jira events)

### What It Does

A listener reacts to Jira **product events** instead of workflow transitions — all 68 events Forge exposes for Jira, Jira Software and JSM (see the event picker, grouped by Issues / Comments / Worklogs / Attachments / Issue links / Projects / Versions / Components / Sprints / Boards / Users / Custom fields / Issue types / Filters / Configuration / Service Management), and since 1.4 the **nine Git events** (pull request opened / updated / closed / merged, review submitted, PR comment added, branch pushed, check run completed, pipeline completed) delivered by the app's own webhook, which require a repository allow-list on the listener. When an event matches the listener's filters (project, issue type, JQL, changed fields, comment regex, repositories, ignore-self) and its optional **AI condition**, the listener runs either **code steps** (the same sandbox as static post-functions, bound to the event's issue, with `api.context.event` carrying the raw payload and `api.forIssue(key)` for other issues) or an **AI agent** (plain-language instructions + an allow-list of actions, which since 1.4 include the Git actions and web search). An agent rule can also bind up to four Skills and opt into Memories (`agent.skillIds`, `agent.useMemories`; REST fields, see [`LISTENERS-AND-JOBS.md`](LISTENERS-AND-JOBS.md#ai-agent-mode)).

### How to Configure

Admin panel → **Listeners** → *Add Listener*: name, events, filters, AI condition, mode (Code steps / AI agent), simulation mode, then **Test with an issue** (builds a synthetic event from a real issue and runs everything in simulation; "Show last real payload" reveals the exact `api.context.event` shape once the event has fired on the site). Or push the same JSON through the REST API.

### How It Works

`trigger` modules → `listeners.listenerTrigger` (25 s: cached index read, static filters, one JQL search, brakes, queue push) → `async-ai-queue` → `executeListenerTask` (120 s: deferred JQL, AI condition, run) → execution log (`type: "listener"`) + stats. Non-issue events carrying only an issue id (worklogs, links, attachments) are resolved to a key first.

### Pitfalls

- Events arrive asynchronously (seconds; up to ~3 minutes worst case). A listener is eventually consistent.
- `Issue viewed` fires on every issue view — the picker flags it HIGH VOLUME.
- A listener whose writes re-fire its own event loops unless *ignore self-generated events* stays on; per-issue (30 / 5 min) and per-listener (120 / 5 min) brakes are the backstop and are logged once per window.
- Listeners run as the app (`asApp`), never as the triggering user.

## Scheduled Jobs (cron)

### What It Does

A job runs on a **cron schedule** (5-field, IANA time zone; presets from every 5 minutes to monthly, including every 2 / 4 / 6 / 12 hours since 1.4; custom cron) — once per schedule, or **per issue of a JQL scope** (escalation-style, ≤100 issues per run) — executing code steps or an AI agent. "Run now" queues an immediate manual run and shows the result. Each run is capped by a **write brake** (`maxWritesPerRun`, default 200, at most 1,000): past it the remaining work is not done and the log says so.

### How It Works

A `scheduledTrigger` (`fiveMinute`) calls `scheduled-jobs.scheduledTick`, which plans the cron minutes that came due since each job's last check (≤1 hour replay, one run per tick), claims each due minute (idempotent against duplicate ticks) and queues the run. The consumer runs the job with a 105 s budget (inside the 120 s consumer cap) shared across scoped issues, logs `type: "scheduledjob"` (with `scheduledFor`, `manual`, `missed`) and updates stats (`nextRunAt`).

### Pitfalls

- Effective granularity is 5 minutes; `* * * * *` runs once per tick.
- Unscoped jobs have no current issue: use `api.searchJql()` + `api.forIssue(key)` (the code generator is told this).
- Keep runs idempotent (check for a marker before writing) — a retried or re-driven run must not duplicate comments.
- Two installation-wide brakes apply to every agent run, listener or job: at most 200 AI agent runs and 300 web searches per 5-minute window; a run past either is skipped or refused with a sentence naming the brake.

## Rules REST API

A bearer-token web trigger for pushing and driving listeners and jobs from CI, migration scripts or the test harness. Admins mint tokens in **Settings → API access** (only SHA-256 hashes are stored; the plaintext is shown once). Resources: `events`, `actions`, `listeners`, `jobs`, `tasks`, `logs`, `samples`, `whoami`; actions: `enable`, `disable`, `test` (listeners), `run`, `preview` (jobs). Validation errors mirror the UI (`400 { error }`). Full reference: [`LISTENERS-AND-JOBS.md`](LISTENERS-AND-JOBS.md).

## Editions: Standard and Coder

### What It Does

CogniRunner is sold as two Marketplace editions. **Standard** is the app as it has always been. **CogniRunner Coder** (the Marketplace *Advanced* edition, `capabilitySet: capabilityAdvanced`) unlocks **Claude Sonnet 5 and Claude Opus 5 on the Atlassian (Forge LLM) provider**; Standard stays on Claude Haiku there. Nothing is locked on a BYOK provider (OpenAI, Azure, OpenRouter, Anthropic, Bedrock, LM Studio) — you pay your own tokens, so every model your provider lists is available on either edition. The Coder feature list also names the in-issue coding chat, GitHub/Bitbucket, pipelines and Git-aware rules that the 1.4 / 1.5 releases build on this foundation.

### Where You See It

Admin panel → **Settings**, with the Atlassian (Forge LLM) provider selected:

- The provider status line says either **"Sonnet 5 and Opus 5 unlocked"** with the allowance percentage used, or **"Claude Sonnet 5 and Opus 5 are part of CogniRunner Coder — upgrade in Jira's Manage apps."**
- The model picker lists the models this edition may select first, then the Coder-only ids as **locked rows with a Coder badge** — a Standard site still sees what the upgrade buys. Saving a locked model returns an upgrade prompt, not a silent failure.
- If a saved model is outside the edition (a downgrade, or a model saved before 1.3) the panel says **"Saved model X is not available on this edition — using Claude Haiku."** — the backend serves Haiku for it.
- **Agent model** — a separate slot, "Used by Coder and Virtual Administrators. Validators and rules keep using the model above." On Forge LLM only Sonnet 5 / Opus 5 are offered (Haiku never drives an agent); on Standard they render locked. On BYOK providers it is a free-text model id.
- **Forge LLM allowance** meter (Coder): estimated spend this month against the tenant's allowance, with a warning at 80 % and, at 100 %, "Allowance spent — Sonnet 5 / Opus 5 paused until next month. Rules fall back to Claude Haiku."

### How It Works Internally

- `src/shared/edition.js` is the one home for the decision. `resolveEdition(license)` reads the platform license object (`context.license` in resolvers and workflow functions, `getAppContext().license` in the consumer and webtriggers). An active license with `capabilitySet: capabilityAdvanced` is Coder; an inactive license is Standard whatever its capability set; no license, or any error, is Standard. Fail-soft on purpose — an edition read can never block a transition.
- The Forge LLM model lists are exact ids (`claude-haiku-4-5-20251001` for Standard; plus `claude-sonnet-5`, `claude-opus-5` for Coder). `clampForgeLlmModel` is applied when listing, saving and loading the model **and** inside the chat adapters in both `src/index.js` and `src/async-handler.js`, so a stale saved model can never bill a frontier model.
- **Lapsed subscription:** the license is read live on every invocation that carries one, so the edition falls back to Standard on the next read. A 2-day KVS snapshot (`COGNIRUNNER_EDITION_SNAPSHOT`) is consulted only by a runtime whose context carries no license property at all, and only when it recorded an active Coder license.
- **Monthly allowance (Coder, Forge LLM only):** Forge LLM frontier tokens are billed to the vendor, so a Coder tenant gets `clamp(seats × $2.00, $40, $800)` per month. Seats are counted (active `atlassian`-type users, up to 2,000) when an admin opens the panel, at most once per 24 h; unknown → 100 seats. Spend is estimated per tier from assumed rates (Haiku $1/$5, Sonnet $3/$15, Opus $5/$25 per million input/output tokens — not published, not billed to anyone). **Soft** at 80 % warns; **hard** at 100 % drops every Forge LLM call to Haiku until the UTC month rolls over, and counts each forced downgrade. Details in [`AI-PROVIDERS.md`](AI-PROVIDERS.md#editions-and-the-forge-llm-model-policy-13).
- **Rate limit:** Forge LLM allows 50,000 tokens per minute per installation per model. Background work is paced by the token budget queue (default 35,000 TPM for Forge LLM; **Settings → AI token budget**), described in [`PROMPT-token-budget-queue.md`](PROMPT-token-budget-queue.md).
- `checkLicense` returns `{ isActive, edition, label, capabilitySet, source, features[] }`; `getAiUsage` returns `{ usage, seats, forgeLlm }`; `getAgentModel` / `saveAgentModel` read and write `COGNIRUNNER_AGENT_MODEL_{provider}`.

### Pitfalls

- A Coder-only id refused on Standard returns `{ success:false, upgradeRequired:true, featureId, edition:"standard", error }` — the one refusal shape; frontends that know nothing about editions still render `error`.
- The allowance meter is a best-effort under-count (no compare-and-set on the usage key); concurrent writers can only ever under-count.
- The seat scan is never triggered from an inference path — only from `checkLicense` / `getAiUsage`, i.e. an admin opening the panel. A site nobody administers for a while keeps its last count (or the 100-seat fallback).

## The Coder (1.4)

### What It Does

The Coder is an engineer inside a Jira issue. From the **CogniRunner Coder** issue panel a developer tells it what to do on the issue; it reads the issue, plans, and asks before every repository write (a branch, a commit, a pull request, a PR comment, an approval, a deploy) through a consent chip with **Confirm / Change / Skip**. The same engine runs headless as the premade post-function **Coder: build / open branch / open PR / fix / review**, where a transition hands the issue to one of five modes. Everything a turn does is written back onto the issue: a plan section in the description, one comment per confirmed step with the repository, branch and pull request as remote links, a running "Coder log" comment, and a `coder-session-<n>.md` transcript.

### Where You See It

- The issue panel (editor role and up; the thread belongs to the person who opened it).
- Admin panel → **Code**: the Coder status card, Git connections, the Forge deploy identity.
- Admin panel → **Settings**: the **Agent model** slot the Coder runs on.
- The workflow editor: the Coder post-function under the **Git** category.

### How It Works Internally

One predicate, `agentCapability` in `src/shared/edition.js`, decides whether the Coder may run: on any BYOK provider it is on for every edition; on Atlassian (Forge LLM) it needs the Coder edition and a frontier agent model (Sonnet 5 or Opus 5), and pauses at the monthly allowance's hard cap. A turn runs on the 900 s `long-consumer`, one turn per issue, up to eight rounds, and is paced by the token budget queue like every other queued AI task. Full reference: [`CODER.md`](CODER.md).

### Pitfalls

- A dry run is fixed by a conversation's first turn; start a new conversation to change it.
- A post-function turn has no one to answer a consent ticket: a write the gate allows executes, a write it refuses halts the turn and says why. Write actions survive on a headless rule only when an **admin** saved it.
- Skills are not bound on Coder turns today; memories are injected when the instance's memory injection setting is on.

## Git integration (1.4)

### What It Does

Admins connect GitHub or Bitbucket Cloud with a token that is verified before it is stored and can never be read back, and allow-list the repositories anything under that connection may touch. The app's webhook turns repository events into listener runs (nine Git events, always scoped to a repository allow-list); the deterministic PR-review engine reviews an opened or updated pull request once per revision; four **Git validators** block a transition until the linked pull request is merged, approved, its comments resolved or its build green, verified live; three **Git conditions** hide a transition on a known-negative state from the advisory `cognirunner.git` property.

### How to Configure

Admin panel → **Code** for connections and the deploy identity. The workflow editor's premade catalog, category **Git**, for validators, conditions and the Coder post-function: the connection and the repository are picked from lists, never typed, and the **Strict** checkbox decides whether an unreachable provider or a missing pull request blocks or allows. Git listeners take the repository allow-list in the event picker's Git category or as `filters.repos` over the Rules REST API.

### Pitfalls

- A rule pointing at a deleted connection, or at a repository the connection may not read, blocks whatever Strict says: a misconfigured gate must not pass silently.
- The `cognirunner.git` property is advisory and forgeable; only the validators verify live, and the live pull request must name the issue key in its branch or title.
- The per-repository webhook secret is not yet provisioned from the product; see the 1.4 release notes. Full reference: [`GIT-INTEGRATION.md`](GIT-INTEGRATION.md).

## Virtual Administrators (1.5)

### What It Does

A Virtual Administrator is an AI agent that works a queue of Jira issues on a schedule, without a person in the loop for every turn. It is a scheduled job with `mode: "va"`: on each tick it sweeps its intake (service desk queues, a JQL filter narrowed to its read scope, mentions of named people), decides what to do on each changed issue in one bounded agent turn, and **stages** a reply rather than posting it. A separate post phase delivers the draft on a later tick, after a wall-clock floor and eleven checks: paused / shadow / kill switch and the posting window, attempts, freshness, other-writer quiet, anti-pile-up, audience, caps, write scope, the voice lint, a fail-closed delivery claim, and a read-back of the posted comment's visibility. It never posts directly, never changes configuration (it can only propose), and never writes outside a named list of projects.

### Where You See It

Admin panel → **Agents**. Editors see the list, each agent's status, caps, health and tick receipts; admins also see the staged drafts (with **Approve / Reject** while the agent is in shadow mode), the verified effects and the memory, and hold create, edit, delete, **Pause / Resume**, **Run tick now** and **Post now**. Settings → **Agent model** is the model it runs on. The same record is reachable over the Rules REST API as `?resource=agents`.

### How to Configure

**+ New virtual administrator** starts a setup interview: name, voice (with a live sample checked by the same rules that check real messages), intake, read scope, write scope, cadence and posting window, powers, guardrails, review, create. The model only writes the sentence above the controls; every option comes from the site's own catalogue, so a project the app cannot see cannot be picked. **Use the form** fills the same record directly. Both go through one save path that checks the record against live data, executes a changed JQL dry before accepting it, and re-arms shadow mode on any change.

### How It Works Internally

`src/virtual-admin.js` is the engine (three tasks: `va-tick`, `va-item`, `va-post`), `src/va-ledger.js` the per-item state (one KVS row per item, fingerprints, claims, receipts, effects written only on read-back proof, caps, health, memory), `src/shared/va-config.js` the record and every clamp, `src/shared/voice-lint.js` the outward-text contract, `src/shared/va-wizard.js` the interview, `src/va-admin.js` the one home of every admin operation behind both the resolvers and REST. The capability rule (`agentCapability`) is asked at the tick and again at the item turn. Full reference: [`VIRTUAL-ADMINISTRATOR.md`](VIRTUAL-ADMINISTRATOR.md).

### Pitfalls

- A new or edited agent posts nothing until it has been watched for its own prepare ticks (default 3, `shadowTicks`); approve a draft in the drafts pane to send one out of shadow, through every other gate.
- It writes as the app user with the persona name in the text. An internal note is the JSM property `sd.public.comment = { internal: true }`; a portal reply is the absence of that property, and only to the reporter of a portal request.
- Caps block when their counters cannot be read; a red banner after three failed ticks is the agent's own counter, so read the tick receipts for the gate that refused.
- Deleting an agent purges its ledger in a bounded sweep; item rows it does not reach expire on their 90-day TTL.

## Confluence (1.5)

### What It Does

With the app also installed on Confluence, a workflow **validator** (`confluence-page-exists`) searches Confluence live on every transition from a CQL template with `{issueKey}`, `{summary}` and `{field:<id>}` placeholders, or in Semantic mode reads the top three matching pages and lets the AI judge them against a prompt; a **condition** (`confluence-page-linked`) shows a transition once CogniRunner has recorded a page for the issue; two **post-functions** create-or-update a page authored from the issue (queued) and comment on the linked page (inline, deterministic); and five **agent actions** let a Virtual Administrator search, read, create, update and comment on pages inside a per-agent space allow-list.

### How to Configure

The workflow editor's premade catalogue, category **Confluence**: pick the space from the space picker, write the query or the title and comment templates, and on the validator decide **Strict**, which says whether an unreachable Confluence blocks or allows. A rule with no space or no query blocks either way. For an agent, turn on `confluenceRead` or `confluenceWrite` in its powers and name the spaces it may write in.

### How It Works Internally

`src/confluence-client.js` is the only module that calls `requestConfluence`: a closed error set, no retries on writes, a 10 s budget per operation, a version-checked update, 60 KB page clamps, and a 5-minute memo of whether the app is installed on Confluence. `src/shared/confluence-endpoints.js` is the endpoint catalogue, `src/shared/confluence-rules.js` the one CQL escaper, the template renderers, the advisory property builder and the Markdown-to-storage converter, `src/confluence-actions.js` the agent executor. The manifest carries six Confluence scopes and the condition branch. Full reference: [`CONFLUENCE.md`](CONFLUENCE.md).

### Pitfalls

- Nothing works until `forge install -p Confluence` on the site and the major-version upgrade that adds the three write scopes; until then every Confluence rule fails open with the reason and a banner.
- The `cognirunner.confluence` property is advisory and forgeable: only the validator verifies live, and it never reads the property. A missing property shows the transition.
- Write `title ~ {summary}`, never `title ~ "{summary}"`: each placeholder expands to a complete quoted literal.
- A page update that hits a version conflict is abandoned, never retried; the other person's edit wins.
- The five Confluence agent actions are refused at save time on listeners, jobs and the Coder (`missing-product:confluence`); a Virtual Administrator's powers are the only way to hold them today.
