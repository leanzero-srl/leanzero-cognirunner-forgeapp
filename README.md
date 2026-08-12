# CogniRunner

**AI-powered workflow automation for Jira -- validators, conditions, and post-functions.**

Part of the [LeanZero](https://leanzero.net) ecosystem.

**[Live on the Atlassian Marketplace](https://marketplace.atlassian.com/apps/298437877/cognirunner?hosting=cloud&tab=overview)** -- install it directly into your Jira Cloud instance.

CogniRunner is the **first open-source Atlassian Forge app**, licensed under [Apache-2.0](LICENSE). It brings semantic intelligence to Jira workflows -- what was previously impossible to assess (the actual meaning of a text field, the content of an attached document, the quality of a description) is now child's play. Write a plain-English prompt, pick a field, and CogniRunner handles the rest.

---

## Table of Contents

- [Why CogniRunner Exists](#why-cognirunner-exists)
- [Features](#features)
  - [Core Validation](#core-validation)
  - [Workflow Post-Functions](#workflow-post-functions)
  - [Agentic Validation](#agentic-validation)
  - [Multi-Provider AI (BYOK)](#multi-provider-ai-byok)
  - [Administration & Permissions](#administration--permissions)
  - [Add Rule Wizard](#add-rule-wizard)
  - [Supported Field Types](#supported-field-types)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
- [Development](#development)
- [Configuration Reference](#configuration-reference)
- [Attaching rules over the REST API](docs/REST-API-RULES.md)
- [Known Limitations](#known-limitations)
- [Permissions & Security](#permissions--security)
- [Contributing](#contributing)
- [License](#license)

---

## Why CogniRunner Exists

Jira's built-in workflow validators are limited to structural checks: "field is required", "field matches regex", "field is not empty". They can't understand **meaning**.

CogniRunner changes that. It adds a **semantic layer** to Jira workflows by sending field content to an AI model and evaluating it against natural-language criteria. This means you can now enforce things like:

- "The description must contain steps to reproduce, expected behavior, and actual behavior"
- "Acceptance criteria must be in Given/When/Then format"
- "The attached design mockup must be a UI screenshot, not a stock photo"
- "This field must not contain profanity, PII, or placeholder text like 'TBD'"
- "Check if a similar or duplicate issue already exists in the project"
- "After transition to Done, summarize the description into the Release Notes field"

None of this was possible before. CogniRunner makes it trivial.

### Quick Start

Configuration takes 30 seconds:

1. Pick a field from a dropdown
2. Write what "valid" means in plain English
3. Done

No regex, no scripting, no ScriptRunner. The field selector is context-aware -- it resolves the project's screen scheme and shows only the fields that are actually available for that transition.

---

## Features

### Core Validation

**Workflow Validators** block a transition if a field's content doesn't pass AI validation. The user sees a clear error message with the AI's reasoning.

**Workflow Conditions** hide a transition entirely if the field doesn't meet criteria. Unlike validators, the transition button is simply not visible -- no error message needed.

**Attachment Validation** goes beyond "file exists" checks. CogniRunner downloads attached files and sends them directly to the AI for content-aware analysis:

| File Type | What CogniRunner Can Validate |
|-----------|------------------------------|
| **Images** (PNG, JPEG, GIF, WebP) | "Is this a UI screenshot?" / "Does this mockup show the correct layout?" |
| **PDFs** | "Does this contract contain the required clauses?" |
| **Word docs** (DOCX, DOC, RTF, ODT) | "Is this spec document complete?" |
| **Excel** (XLSX, XLS, CSV, TSV) | "Does this data meet the expected schema?" |
| **PowerPoint** (PPTX, PPT) | "Does this presentation cover all required topics?" |

**Smart Field Selector** resolves the project's issue type screen scheme chain (Project -> Issue Type Screen Scheme -> Screen Scheme -> Screen -> Tabs -> Fields) to show only the fields that are actually present on the transition screen. No more scrolling through hundreds of irrelevant fields.

### Workflow Post-Functions

CogniRunner adds two types of workflow post-functions that execute **after** a transition completes successfully:

#### Semantic Post-Functions

AI evaluates a condition on one field and modifies a target field based on natural-language instructions. The AI reads the source field, decides whether the condition is met, and if so, generates a new value for the target field.

**Examples:**
- "After transition to Done, summarize the description into the 'Release Notes' field"
- "When moving to Code Review, extract the acceptance criteria into a checklist"
- "On every transition, append the current timestamp and status change to an audit trail field"

**Pre-flight safety checks:**
- Verifies the target field is editable on the issue via the `editmeta` API before calling the AI
- Auto-formats AI-generated values to match the field schema (select fields get `{value: "..."}`, numbers get converted, etc.)
- Parses exact Jira error messages on failure and provides field-type-specific fix guidance

#### Static Post-Functions

Chain multiple operations with AI-generated JavaScript code. The AI generates the code once during setup -- after that, the code runs on every transition with **zero AI cost**.

**Function Builder features:**
- Chain up to 50 operation steps with variable passing between them
- Each step can reference results from previous steps using `${variableName}` syntax
- Operation types:
  - **JQL Search** -- search for related issues
  - **Jira REST API** -- call any Jira endpoint (GET, POST, PUT, DELETE, PATCH)
  - **External API** -- call webhooks or external services
  - **Confluence API** -- read/write Confluence pages
  - **Debug Log** -- log messages for troubleshooting
- AI-powered code generation with comprehensive Jira API reference baked into the prompt
- CodeMirror 6 editor with syntax highlighting, `api.*` autocompletion, and LeanZero dark theme
- Test Run with real Jira data (reads are real, writes are simulated)
- AI Review for configuration analysis and optimization suggestions
- Exponential backoff with jitter option per step (up to 3 retries)

**Sandboxed execution environment provides:**
- `api.getIssue(key)` -- fetch issue data
- `api.updateIssue(key, fields)` -- update fields
- `api.searchJql(jql)` -- execute JQL searches
- `api.transitionIssue(key, transitionId)` -- trigger transitions
- `api.log(...args)` -- debug logging
- `api.context.issueKey` -- current issue

### Agentic Validation

CogniRunner doesn't just evaluate text in isolation -- it can **autonomously search your Jira project** to make context-aware decisions. This is powered by an agentic loop where the AI model can call tools, analyze results, and iterate before rendering a final verdict.

**How it works:**

1. The AI receives the field content and your validation prompt
2. If the prompt involves cross-issue concerns (duplicates, similarity, prior work), the AI autonomously constructs JQL queries and searches your Jira project
3. It analyzes the search results, compares field values, and may refine its search with additional queries (up to 3 tool-call rounds)
4. Once it has enough context, it renders a pass/fail judgment with reasoning

**Activation modes:**
- **Auto-detect (default)** -- CogniRunner analyzes your prompt for keywords like "duplicate", "similar issues", "already exists", "cross-reference", etc. If detected, tools are enabled automatically.
- **Always enabled** -- Force agentic mode on every validation.
- **Always disabled** -- Pure text validation only, no JQL searches.

**Safety:**
- 22-second timeout budget (Forge validators have a 25-second limit). If time runs out, the transition is allowed (fail-open).
- Maximum 3 tool-call rounds per validation to bound latency.
- JQL searches are automatically scoped to the current project.
- Calibrated to minimize false rejections: partial topic overlap is not grounds for blocking.

### Multi-Provider AI (BYOK)

CogniRunner supports **four AI providers** via Bring Your Own Key. Each provider has its own key slot in storage -- switching providers never deletes your existing keys.

| Provider | Default Model | Auth | Endpoint |
|----------|--------------|------|----------|
| **OpenAI** | `gpt-5.4-mini` | `Authorization: Bearer` | `api.openai.com/v1` |
| **Azure OpenAI** _(mostly untested)_ | `gpt-5.4-mini` | `api-key` header | Custom: `{resource}.openai.azure.com/openai/v1` |
| **OpenRouter** | `openai/gpt-4o-mini` | `Authorization: Bearer` + attribution headers | `openrouter.ai/api/v1` |
| **Anthropic** | `claude-haiku-4-5` | `x-api-key` + `anthropic-version` | `api.anthropic.com/v1` |

**How it works:**
1. **Bring your own key (BYOK)** -- each admin supplies their own key for the active provider in the Settings tab. There is **no factory / out-of-the-box key**: the app ships with no embedded API key, so AI features require either a BYOK key or the zero-key **Atlassian Forge LLM** provider.
2. **Model selection** -- providing a BYOK key unlocks model selection from the provider's model list.
3. **Provider switching** -- select a new provider, click "Switch Provider". Your previous provider's key is preserved per-provider.
4. **Remove key** -- deletes the active provider's key (nothing to fall back to). Other providers' keys are untouched.

The app includes a **unified AI adapter** (`callAIChat`) that normalizes between OpenAI-compatible APIs and the Anthropic Messages API. Tool calling, multimodal content (images, PDFs), and response parsing are handled transparently -- all callers use the same OpenAI message format.

### Administration & Permissions

#### Admin Dashboard

Accessible via **Apps > CogniRunner** in the Jira sidebar. Four tabs:

| Tab | Purpose |
|-----|---------|
| **Rules** | All configured validators, conditions, and post-functions across all workflows. Type filter (All/Validators/Conditions/Post Functions) + ownership filter (All Rules/My Rules). Enable/disable toggles per rule. |
| **Documentation** | Shared document library. Upload API docs, JSON schemas, business rules, or code snippets. Attach them to any rule so the AI has context during validation. Auto-format for JSON, XML, YAML, JavaScript. |
| **Permissions** | Add users with roles (Viewer/Editor/Admin) and scope (Own Rules/All Rules). Search Jira users by name. Role dropdown + scope dropdown per user. Last admin protection. |
| **Settings** | AI provider configuration. Provider selector with official brand icons (OpenAI, Azure, Anthropic, OpenRouter). API key management with per-provider storage. Model selection dropdown. |

#### Execution Logs

Each log entry shows:
- **Status badge** -- PASS / ERR / SKIP
- **Type badge** -- Validator (blue) / Condition (green) / PF: Semantic (purple) / PF: Static (purple)
- **Rule name** -- workflow + transition (e.g., "WFH Workflow_v2 / Estimating -> Ready for estimating")
- **Issue key** + timestamp + execution duration
- **AI reasoning** and decision
- **Edit Rule button** -- opens the workflow editor (for editors/admins)
- **Execution trace** -- collapsible detailed log
- **Recommendations** -- AI-generated fix suggestions for failures

#### Permission Model

| Role | Scope | Can See Rules | Can Edit Rules | Permissions | Settings |
|------|-------|--------------|----------------|-------------|----------|
| **Viewer** | Own | Own rules only | No | No | No |
| **Viewer** | All | All rules | No | No | No |
| **Editor** | Own | All rules | Own rules only | No | No |
| **Editor** | All | All rules | All rules | No | No |
| **Admin** | (always all) | All rules | All rules | Yes | Yes |

- Jira site administrators always have Admin access
- First user is automatically bootstrapped as Admin
- Last admin cannot be removed or demoted

### Add Rule Wizard

Editors and admins can create new rules directly from the admin panel -- no need to access the Jira workflow editor. The wizard:

1. **Select Project** -- shows all accessible projects with their actual Jira icons
2. **Select Workflow** -- lists only workflows assigned to the selected project (resolved via workflow scheme API)
3. **Select Transition** -- shows all transitions with from/to status names and existing CogniRunner rule indicators
4. **Select Rule Type** -- Validator, Condition, Semantic Post Function, or Static Post Function
5. **Configure** -- the same form fields as the workflow editor config UI:
   - Validators/Conditions: field selector, prompt, JQL toggle, test run
   - Semantic PF: condition prompt, action prompt, target field, test run
   - Static PF: multi-step function builder with code generation, operation types, variable chaining, test run

The rule is registered in CogniRunner's config registry AND **programmatically injected into the Jira workflow transition** via the `POST /rest/api/3/workflows/update` API. The environment ID is obtained automatically via `getAppContext()`.

### Supported Field Types

CogniRunner can validate virtually any Jira field type. The field extraction engine (`extractFieldDisplayValue`) handles:

| Category | Field Types |
|----------|-------------|
| **Text** | Summary, single-line text, multi-line text |
| **Rich Text** | Description, Environment, any ADF field (full Atlassian Document Format parsing including mentions, dates, status lozenges, inline cards, emojis, and nested block structures) |
| **Select** | Single select, radio buttons, priority, status, resolution, issue type |
| **Multi-Select** | Multi-select, checkboxes, labels, components, fix versions, affected versions |
| **Users** | Assignee, reporter, single/multi user picker, single/multi group picker |
| **Dates** | Date picker, date-time picker, due date, created, updated |
| **Numeric** | Number fields, time tracking (original/remaining/spent) |
| **Links** | URL fields, issue links (with summary), parent issue |
| **Complex** | Cascading select, sprint, project picker, security level |
| **Attachments** | Images (PNG, JPEG, GIF, WebP), PDFs, Word docs (DOCX/DOC/RTF/ODT), Excel (XLSX/XLS/CSV/TSV), PowerPoint (PPTX/PPT) |
| **Third-Party** | Checklist for Jira (Okapya), Xray Manual Test Steps, Jira Assets/Insight, ScriptRunner fields, Tempo accounts, Elements Connect |

Any field type not explicitly handled gets a best-effort extraction (readable key-value pairs or JSON fallback).

---

## Architecture

```
CogniRunner/
├── manifest.yml                  # Forge app definition (modules, permissions, resources)
├── src/
│   ├── index.js                  # Main backend (~4500 lines: resolvers, validation, post-functions,
│   │                             #   AI adapter, permissions, wizard resolvers, workflow injection)
│   └── async-handler.js          # Async event consumer for long-running AI tasks (120s timeout)
├── static/
│   ├── icons/icon.svg            # App icon (shown in Jira sidebar)
│   ├── config-ui/                # React app: configure validators/conditions/post-functions
│   │   ├── src/
│   │   │   ├── App.js            # Main form (~2800 lines: field selector, prompts, type detection)
│   │   │   └── components/       # CustomSelect, CodeEditor, FunctionBuilder, FunctionBlock,
│   │   │                         #   SemanticConfig, IssuePicker, DocRepository, ReviewPanel,
│   │   │                         #   AILoadingState, Tooltip, Skeleton
│   │   ├── public/index.html     # HTML template with pre-JS skeleton styles
│   │   └── build/                # Webpack output (committed, deployed by Forge)
│   ├── config-view/              # React app: read-only config summary + execution logs
│   │   ├── src/App.js            # Config display, logs viewer, disable/enable toggle
│   │   └── build/
│   └── admin-panel/              # React app: admin dashboard
│       ├── src/
│       │   ├── App.js            # Tab bar, rules table, logs, injectStyles (~1400 lines)
│       │   └── components/       # TabBar, OpenAIConfig, PermissionsTab, DocsTab,
│       │                         #   SettingsOpenAITab, AddRuleWizard, CustomSelect, Tooltip, Skeleton
│       └── build/
├── LICENSE                       # Apache-2.0
├── NOTICE                        # Trademark + attribution
└── README.md
```

### Backend (`src/index.js`)

Single file containing all server-side logic:

| Component | Purpose |
|-----------|---------|
| **`validate()`** | Workflow validator/condition handler. Extracts field value, routes to standard or agentic AI validation, returns pass/fail. |
| **`executePostFunction()`** | Post-function handler. Routes to semantic or static execution. Always returns `{ result: true }` (never blocks). |
| **`callAIChat()`** | Unified AI adapter. Normalizes between OpenAI/Azure/OpenRouter (pass-through) and Anthropic (full request/response translation). |
| **`callAnthropicChat()`** | Anthropic translation layer. Extracts system prompt, converts images/docs/tools/tool-results between formats. |
| **`callOpenAI()`** | Standard single-turn validation. Field content + prompt -> `{ isValid, reason }`. |
| **`callOpenAIWithTools()`** | Agentic multi-turn validation with tool-calling loop (up to 3 rounds, 22s budget). |
| **`executeSemanticPostFunction()`** | AI condition check + field update with editmeta pre-flight, auto-formatting, and error parsing. |
| **`executeStaticPostFunction()`** | Sandboxed JavaScript execution with API surface. |
| **`TOOL_REGISTRY`** | Extensible registry mapping tool names to function definitions and executors. |
| **`extractFieldDisplayValue()`** | Converts any Jira field type to plain text for AI consumption. |
| **`getScreenFields()`** | Walks the Jira screen scheme chain to resolve available fields. |
| **`getUserPermissions()`** | Returns `{ role, scope }` with KVS lookup + Jira admin group fallback. |
| **`canActOnConfig()`** | Scope-aware permission check (editors with "own" scope restricted to their rules). |
| **`injectWorkflowRule()`** | Programmatically adds Forge rules to workflow transitions via REST API. |
| **`getAppContext()`** | Gets environment ID for extension ARI construction. |

### Backend (`src/async-handler.js`)

Async event consumer for long-running AI tasks:
- Receives tasks via `@forge/events` Queue (pushed by resolvers)
- Executes with 120s timeout (vs 25s resolver limit)
- Stores results in KVS keyed by `taskId`
- Frontend polls `getAsyncTaskResult` resolver for completion
- Currently handles AI Review tasks

### Frontend (3 React Apps)

Each is a React 18 app bundled with Webpack + Babel, running as Forge Custom UI inside Jira's sandboxed iframe:

| App | Module | Purpose |
|-----|--------|---------|
| `config-ui` | Create/Edit view for validators, conditions, post-functions | Full configuration form: module type detection, field selector with screen resolution, prompt editors, JQL toggle, document library, AI review, test run with issue picker, function builder with code generation |
| `config-view` | Read-only Summary view | Config summary, execution logs with traces and recommendations, enable/disable toggle, license status |
| `admin-panel` | `jira:globalPage` + `jira:adminPage` | Dashboard with 4 tabs (Rules, Documentation, Permissions, Settings), Add Rule wizard, execution logs, type/ownership filters |

**Design system:**
- LeanZero design tokens (blue primary `#2563eb`, rounded corners, gradient accents)
- Full dark mode support via CSS custom properties and `data-color-mode` attribute
- Skeleton loading animations with theme-neutral defaults (prevents flash before theme loads)
- Portal-rendered tooltips (escape `overflow:hidden` containers)
- Smooth entrance animations (sections, cards, alerts, dropdowns, success states)
- Interactive feedback (button press scale, card hover shadows, focus glow rings)

### Data Flow

**Standard validation:**
```
User configures rule in Jira Workflow Editor (or Admin Panel wizard)
  -> config-ui saves config as JSON string via workflowRules.onConfigure()
  -> Forge stores config in the workflow rule
  -> On each transition, Forge calls validate()
  -> validate() extracts field value from issue (modifiedFields or REST API)
  -> Calls AI provider via callAIChat() with field content + prompt
  -> Returns { result: true/false, errorMessage }
  -> Jira blocks or allows the transition
  -> Execution log stored in KVS
```

**Semantic post-function:**
```
Transition completes successfully
  -> Forge calls executePostFunction()
  -> Reads source field via getFieldValue()
  -> Fetches context documents from KVS
  -> Checks target field editability via GET /rest/api/3/issue/{key}/editmeta
  -> Calls AI with condition + action prompts
  -> If decision is UPDATE:
     -> Auto-formats value via formatValueForField() (select, number, labels, etc.)
     -> PUTs updated value to PUT /rest/api/3/issue/{key}
     -> Parses exact Jira error on failure (400/403/404)
  -> Execution trace + recommendation stored in log
```

**Agentic validation:**
```
validate() detects tool-requiring prompt (or manual override)
  -> Calls callOpenAIWithTools() with field content, prompt, issue context
  -> AI analyzes prompt and decides whether to search Jira
  -> Round 1: AI calls search_jira_issues tool with JQL
     -> CogniRunner executes JQL against Jira REST API
     -> Returns up to 10 issues with key, summary, status, field content
  -> AI analyzes results, may refine search (up to 3 rounds)
  -> AI renders final { isValid, reason } verdict
  -> Tool metadata (queries, rounds, results) stored in log
  -> 22-second deadline enforced throughout
```

**Add Rule wizard (programmatic injection):**
```
Admin/Editor clicks "+ Add Rule" in admin panel
  -> Step 1: listProjects -> select project
  -> Step 2: getProjectWorkflows (via workflow scheme resolution) -> select workflow
  -> Step 3: getWorkflowTransitions -> select transition
  -> Step 4: select rule type
  -> Step 5: configure (same fields as config-ui)
  -> On save:
     1. registerConfig/registerPostFunction -> saves config to KVS
     2. injectWorkflowRule -> GET workflow, add Forge rule to transition, POST update
     -> Uses getAppContext().environmentAri.environmentId for extension ARI
```

---

## Getting Started

### Prerequisites

- **Node.js 22+** (Forge runtime is `nodejs22.x`)
- **Atlassian Forge CLI** (`npm install -g @forge/cli`)
- **An Atlassian Cloud developer site** ([get one free](https://developer.atlassian.com/platform/forge/getting-started/))
- **An AI API key** from any supported provider (OpenAI, Azure OpenAI, OpenRouter, or Anthropic)

### Setup

#### 1. Clone and install

```bash
git clone https://github.com/mperdum/leanzero-cognirunner-forgeapp.git
cd CogniRunner
npm install
cd static/config-ui && npm install && cd ../..
cd static/config-view && npm install && cd ../..
cd static/admin-panel && npm install && cd ../..
```

#### 2. Register a new Forge app

```bash
forge register
```

This updates `app.id` in `manifest.yml` with your own app ID.

#### 3. Set environment variables

```bash
forge variables set OPENAI_API_KEY your-api-key
forge variables set OPENAI_MODEL gpt-5.4-mini    # optional, this is the default
```

Or skip this if you plan to use BYOK keys exclusively (configured in the Settings tab after install).

#### 4. Build the frontends

```bash
cd static/config-ui && npm run build && cd ../..
cd static/config-view && npm run build && cd ../..
cd static/admin-panel && npm run build && cd ../..
```

#### 5. Deploy and install

```bash
forge deploy
forge install    # Select your Jira site when prompted
```

If you see "new scopes or egress URLs detected", run:
```bash
forge install --upgrade
```

#### 6. Use it

**From the Jira Workflow Editor:**
1. Go to **Project Settings > Workflows**
2. Edit a workflow transition
3. Add a **Validator**, **Condition**, or **Post Function** and select a CogniRunner module
4. Configure the rule: pick fields, write prompts, build functions
5. Publish the workflow

**From the Admin Panel:**
1. Go to **Apps > CogniRunner** in the Jira sidebar
2. Click **+ Add Rule** to create rules without accessing the workflow editor
3. Manage permissions, documentation, and AI provider settings

---

## Development

```bash
# Run Forge tunnel for live backend reloading
forge tunnel

# Watch mode for frontend changes (in separate terminals)
cd static/config-ui && npm run start
cd static/config-view && npm run start
cd static/admin-panel && npm run start

# Lint
npm run lint

# Check logs
forge logs
```

**Important notes:**
- The `build/` directories are committed because Forge deploys them directly. After changing frontend source, **always rebuild** before deploying.
- After changing `manifest.yml`, you must run `forge deploy` (tunnel doesn't pick up manifest changes).
- After adding new scopes or egress URLs, run `forge install --upgrade` on your target site.

---

## Configuration Reference

### Environment Variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `OPENAI_API_KEY` | No | -- | **Removed — no factory key.** The app ships with no embedded API key; admins supply their own BYOK key, or use the zero-key Atlassian Forge LLM provider. |
| `OPENAI_MODEL` | No | `gpt-5.4-mini` | Optional default model name for OpenAI/Azure when a BYOK key is active and no model is saved. Provider-specific defaults apply otherwise (e.g., `claude-haiku-4-5` for Anthropic). |
| `VALIDATE_FIELD_ID` | No | `description` | Fallback field ID if not configured in UI. |
| `VALIDATION_PROMPT` | No | *(generic quality check)* | Fallback prompt if not configured in UI. |

Set via `forge variables set KEY value`.

### Forge Modules

| Module | Key | Type | Purpose |
|--------|-----|------|---------|
| Validator | `ai-text-field-validator` | `jira:workflowValidator` | Blocks transition based on AI validation |
| Condition | `ai-text-field-condition` | `jira:workflowCondition` | Hides a transition unless the issue qualifies (deterministic, no AI — Jira evaluates it as a Jira expression) |
| Semantic PF | `ai-semantic-post-function` | `jira:workflowPostFunction` | AI-powered field updates after transition |
| Static PF | `ai-static-post-function` | `jira:workflowPostFunction` | Code execution after transition |
| Admin Panel | `cognirunner-global-page` | `jira:globalPage` | Apps sidebar dashboard |
| Admin Settings | `cognirunner-admin-settings` | `jira:adminPage` | Jira admin settings page |
| Async Consumer | `async-ai-consumer` | `consumer` | Long-running AI tasks (120s timeout) |

### KVS Storage Keys

| Key Pattern | Purpose |
|-------------|---------|
| `validation_logs` | Last 50 execution log entries (FIFO) |
| `config_registry` | Array of all registered rule configs |
| `app_admins` | User permissions: `[{ accountId, role, scope }]` |
| `COGNIRUNNER_AI_PROVIDER` | Active provider name (`openai`, `azure`, `openrouter`, `anthropic`) |
| `COGNIRUNNER_AI_BASE_URL` | Custom endpoint URL (Azure) |
| `COGNIRUNNER_KEY_{provider}` | Per-provider API key |
| `COGNIRUNNER_MODEL_{provider}` | Per-provider model selection |
| `doc_repo_index` | Document library index |
| `doc_content:{id}` | Individual document content |
| `async_task:{taskId}` | Async task results (temporary) |

---

## Automating rule creation

Rules are ordinary Forge workflow rules, so you can attach them with Jira's own workflow
REST API instead of the admin panel — for bulk provisioning across projects, migrating
between sites, or keeping rules in version control.

**[docs/REST-API-RULES.md](docs/REST-API-RULES.md)** documents the exact payloads: how to
discover your install's extension ARI, the rule object, which slot each rule type goes in,
the config schema per type, and a runnable worked example.

One thing that page stresses and is worth repeating here: a REST-attached rule **runs
immediately but is invisible to the admin panel** until you claim it via Rules →
**Scan workflows** → **Register all**, and it needs a stable `id` inside its config or it
can never be disabled from the UI.

---

## Known Limitations

| Limitation | Details | Workaround |
|-----------|---------|------------|
| **CSS triple-definition** | Styles are defined in 3 places per UI app (CSS file, HTML `<style>`, `injectStyles()` in JS) due to Forge iframe CSP quirks. | Intentional pattern -- keeps styles reliable across all loading scenarios. |
| **No i18n** | All strings are hardcoded in English. | Planned for future release. |
| **Attachment validation on CREATE** | Jira doesn't expose attachments in `modifiedFields` during issue creation. | Attachments can only be validated on edit/transition screens. |
| **50-log limit** | Execution logs capped at 50 entries in Forge Storage (FIFO). | Oldest entries are automatically removed. |
| **Agentic latency** | Multi-turn validation with JQL searches takes 5-20 seconds. | 22-second timeout ensures transitions aren't blocked indefinitely. Auto-detect mode avoids agentic flow when not needed. |
| **Post-function fail-open** | Post-functions always return `{ result: true }`. | By design -- post-functions run after transition success and cannot roll back. Errors are logged. |
| **Anthropic document attachments** | PDF/DOCX support depends on Anthropic model capabilities. | Images work reliably across all providers. |
| **Workflow injection** | Attaching rules over REST needs the app's per-install extension ARI. | Ask Jira for it: `GET /rest/api/3/workflows/capabilities?projectId=&issueTypeId=` lists CogniRunner's modules with their ARIs, so no existing rule is required. See [docs/REST-API-RULES.md](docs/REST-API-RULES.md). |
| **REST-attached rules are unmanaged until claimed** | A rule attached outside the admin panel runs immediately but has no registry row, so it can't be disabled or seen in the Rules tab. | Rules tab → **Scan workflows** → **Register all**. Embed a stable `id` in the rule's config or it can be claimed but still not disabled — see [docs/REST-API-RULES.md](docs/REST-API-RULES.md). |

---

## Permissions & Security

### Forge Scopes

| Scope | Purpose |
|-------|---------|
| `read:jira-work` | Read issue fields, execute JQL searches |
| `write:jira-work` | Update issue fields (post-functions) |
| `read:jira-user` | Resolve user information for field extraction |
| `read:workflow:jira` | Read workflow definitions for orphan cleanup |
| `write:workflow:jira` | Programmatic workflow rule injection |
| `read:project:jira` | Resolve project context for screen-based field filtering |
| `manage:jira-configuration` | Admin group membership checks, field metadata |
| `storage:app` | Persist logs, configs, BYOK keys, permissions |
| `read:issue-type-screen-scheme:jira` | Screen-based field resolution |
| `read:screen-scheme:jira` | Screen-based field resolution |
| `read:screen-tab:jira` | Screen-based field resolution |
| `read:screenable-field:jira` | Screen-based field resolution |

### External Network Access

| Domain | Direction | Purpose |
|--------|-----------|---------|
| `api.openai.com` | Backend + Client | OpenAI API calls |
| `*.openai.azure.com` | Backend + Client | Azure OpenAI Service (customer endpoints) |
| `openrouter.ai` | Backend + Client | OpenRouter aggregator API |
| `api.anthropic.com` | Backend + Client | Anthropic Messages API |
| `*.atlassian.net` | Images (CSP) | Project avatars and Jira icons |

### Data Handling

- **API keys** are stored in Forge KVS (encrypted at rest by Atlassian). Keys are never sent to the frontend -- only a masked indicator is shown.
- **Issue data** is sent to the configured AI provider for validation/processing. No data is stored by CogniRunner beyond the 50-entry execution log.
- **Execution logs** contain truncated field values (max 300 chars), prompts (max 200 chars), and AI reasoning. Logs can be cleared from the admin panel.
- **Post-function code** is stored as part of the rule config in KVS. It runs in a sandboxed `new Function()` context with a controlled API surface.

---

## Contributing

Contributions are welcome and encouraged. This is the first open-source Forge app -- help set the standard.

1. Fork the repository
2. Create a feature branch (`feature/your-feature-name`)
3. Make your changes
4. Rebuild any modified frontends (`npm run build`)
5. Test via `forge tunnel` or `forge deploy` on a development site
6. Submit a pull request

By contributing, you agree that your contributions will be licensed under Apache-2.0.

**Please note:** The "CogniRunner" name and branding are trademarked. See [NOTICE](NOTICE) for details. Derivative works must use a different name.

---

## Pricing Philosophy

CogniRunner's Marketplace listing will never have a per-user license cost that exceeds its own runtime costs. The minimal licensing fee exists solely to cover infrastructure -- API hosting, Forge compute, and maintenance time. If it could be free without the author paying out of pocket, it would be. The open-source license ensures that if you want to self-host or run your own fork, you absolutely can.

---

## License

Copyright (C) 2025 LeanZero

Licensed under the Apache License, Version 2.0. You may obtain a copy at http://www.apache.org/licenses/LICENSE-2.0.

See [LICENSE](LICENSE) for the full text.

### What Apache-2.0 means for you

- **You can** use, modify, and distribute this software freely, including inside your own Forge apps
- **You must** keep the copyright notices and the NOTICE file intact in redistributions
- **You cannot** use the "CogniRunner" name/branding for derivative works (see [NOTICE](NOTICE))

CogniRunner was originally released under AGPL-3.0 and moved to Apache-2.0 so it can actually be reused in Forge apps, since Atlassian forbids copyleft licenses on the platform. The permissive license lets the community learn from, build on, and ship the code.

### Trademark

"CogniRunner" is a trademark of LeanZero. The name and branding are **not** covered by the Apache-2.0 license. If you fork this project, you must use a different name and branding. See [NOTICE](NOTICE) for full details.

---

Part of [LeanZero](https://leanzero.net) by Mihai Perdum.
