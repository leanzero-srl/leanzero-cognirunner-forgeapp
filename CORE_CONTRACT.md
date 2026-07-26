# CORE_CONTRACT.md — CogniRunner invariants

Guardrail document for automated/autonomous changes. **Every future diff MUST preserve everything
in section 1, and MUST perform the paired ritual in section 2 when it touches a listed surface.**
When a diff cannot satisfy this contract, it must stop and ask a human instead of proceeding.

Verified against: `src/index.js` (~13.7k lines), `src/async-handler.js`, `src/skills.js`,
`src/memories.js`, `src/shared/sandbox-api-spec.js`, `manifest.yml` (2026-07-05).

---

## 1. MUST NOT change

### 1.1 Sandbox API surface (spec-locked)

- The static-PF sandbox API surface is EXACTLY the members defined in
  `SANDBOX_API_METHODS` in `src/shared/sandbox-api-spec.js` — the original core six
  (`api.getIssue` / `api.updateIssue` / `api.searchJql` / `api.transitionIssue` / `api.log` /
  `api.context`) plus the documented extended methods (`createIssue`, `cloneIssue`, `editIssue`,
  `addLabels`/`removeLabels`, `addComment`, `transitionByName`, `transitionSubtasks`,
  `transitionParent`, `forceStatus`, `setAssignee`, `addWorklog`, `createIssueLink`,
  `addWatcher`/`removeWatcher`, `addVote`, `setProperty`/`getProperty`, `addRemoteLink`,
  `sendNotification`, `moveToSprint`/`moveToBacklog`, `rankIssue`, `createVersion`,
  `createComponent`).
- `createApi()` (`src/index.js` ~12398) and the spec file MUST stay in lockstep. Any change to one
  requires the same-diff change to the other. **Never** re-hardcode API docs, completions, lint
  allowlists, or prompt text at a consumption site — codegen/fix system prompts, CodeMirror
  completions, hover docs, lint (`KNOWN_API_MEMBERS`, derived — never hand-edit), and the API
  Reference panel ALL derive from the spec.
- `src/shared/*` modules stay dependency-free (no `@forge/*`, no react, no node built-ins) — they
  bundle into the backend AND all three frontends.
- Sandbox execution invariants: ~22s budget (`PF_BUDGET_MS = 22000`); simulation mode
  (`config.simulationMode === true`) intercepts ALL writes (logged + recorded in `changes`, never
  executed); kill-switch cancel token gates every non-GET write through `retryingRequestJira`
  (`searchJql` deliberately bypasses it — a read over POST); `api.log` capped at 5000 entries.

### 1.2 Workflow module contracts (Forge platform shapes)

- `validate(args)` receives `{ issue, configuration, modifiedFields, context }` and returns
  `{ result: boolean, errorMessage?: string }`. Nothing else. Conditions use the same function;
  a condition invocation is detected via `context.extension.type` containing "Condition".
- On issue CREATE the platform passes `issue.key = null` — field values MUST come from
  `modifiedFields` (always check `modifiedFields` first, then REST fetch). Field extraction goes
  through `extractFieldDisplayValue()` (handles ADF internally).
- Fail-open is the law for runtime rules: inactive license → `{ result: true }`; disabled rule →
  `{ result: true }`; premade-rule executor bugs → fail-open (never trap/hide a transition).
  Rule-disable matching is by rule IDENTITY (ruleId → workflow+transition → fieldId+prompt),
  never fieldId alone, and a post-function registry row must never mute a validator (and vice
  versa).
- `executePostFunction` ALWAYS returns `{ result: true }` — post-functions never block a
  transition; every skip path writes a `postfunction-skipped` log entry. Invocation dedup
  (`claimPfInvocation`) runs before queue push and brake counting (platform delivers
  at-least-once, ~1s twins).

### 1.3 Config storage flow + pf_code offload

- config-ui `workflowRules.onConfigure()` returns the config as a JSON string → backend receives
  it in `args.configuration` (parse, tolerate string) → config-view reads it from
  `view.getContext().extension`.
- Static-PF step details (code, `selectedDocIds`, `selectedSkillIds`, `generationMeta`) ride
  `config.functions[]`. When serialized functions exceed `PF_FUNCTIONS_OFFLOAD_BYTES = 24576`
  (24KB; workflow-config ceiling is 32768), code is offloaded to `pf_code:{id}:{hash}` and the
  slim config keeps only `functionsMeta` (id/name/operationType/variableName) + `codeRef`.
- **`functionsMeta` is NEVER the source of step details.** Post-offload, the `pf_code` bundle is
  the single source of truth. Inline `config.functions` ALWAYS wins over `codeRef` when both
  exist (legacy configs execute byte-for-byte). Missing/invalid bundle = fail-closed for the rule
  (execute nothing, log loudly), fail-open for the transition.

### 1.4 Prompt security model

- All untrusted content — field values, user docs, generated code, test logs, memories — is
  injected ONLY inside `<<<MARKER ... MARKER>>>` fences (`SOURCE_FIELD`, `REFERENCE_DOCS`,
  `STEP_CODE`, `TEST_LOGS`, `LEARNED_MEMORIES`) with a guard sentence in the system prompt, and
  is ALWAYS passed through `defangFence()` (`src/memories.js`: collapses `<<<+`→`<<`, `>>>+`→`>>`)
  so it can never contain literal fence tokens. New injection sites MUST follow the same pattern.
- Skills (`<<<SKILLS>>>`) are trusted-but-bounded: they may steer style/approach but can never
  override the output format or expand the sandbox API.
- Model output is NEVER trusted: parse via `parseAIJson` (tolerant salvage/repair chain — it may
  only RECOVER, never fabricate a verdict from JSON truncated before its value), then clamp every
  field server-side after parsing (length caps, enum checks, type coercion).

### 1.5 Provider dispatch + models

- `callAIChat` (`src/index.js` ~7680) is the single multi-provider choke point: `anthropic`,
  `bedrock`, `atlassian` (Forge LLM via `@forge/llm`), `lmstudio` (native path when toolless,
  OpenAI-compat with tools; `lmAcquireWorker` acquire/release is the LM Studio dispatch choke
  point), and OpenAI-compatible (`openai`, `azure`, `openrouter`). New providers go through this
  function — never a parallel call path.
- Provider/key/model/registry config in `index.js` is TTL-cached at 30s (`REGISTRY_CACHE_TTL_MS`,
  `PROVIDER_CACHE_TTL_MS`). The async consumer (`src/async-handler.js`) is DELIBERATELY uncached
  (different warm container; a stale credential is binary-wrong). Do not add caching there.
- LM Studio routing rule: codegen/fix/distill resolvers detect `provider === "lmstudio"` and
  queue async instead of running inline (25s sync resolver cap vs slow self-hosted models);
  frontends poll.
- **Default model fallback is `gpt-5.4-mini` — NEVER `gpt-4o-mini`**, anywhere (code, prompts,
  mocks, docs).

### 1.6 Async task contract

- Queue: `async-ai-queue` → consumer `async-ai-consumer` → handler in `src/async-handler.js`,
  `timeoutSeconds: 120`. Task registry is `TASK_HANDLERS`: `review`, `postfunction`, `codegen`,
  `fixcode`, `skilldistill`, `memory_distill`. Unpolled types (`postfunction`, `memory_distill`)
  are in `UNPOLLED_TASKS` and must not write `async_task:*` status rows.
- Polled results flow through `getAsyncTaskResult` (deletes the row on poll); frontends poll every
  3s, max 40 tries (= 120s; pattern in `ReviewPanel.jsx` / `FunctionBlock.jsx`). Long async flows
  guard against stale results via the generation-token ref pattern — keep it.
- Job rows are TTL-bound: active 2h (`JOB_TTL_ACTIVE`), terminal 20min (`JOB_TTL_DONE`). Cancel
  (`isJobCancelled`) must keep gating queued jobs before execution AND at write boundaries.

### 1.7 KVS keys + caps (do not rename, do not exceed)

| Key(s) | Contract |
|---|---|
| registry + `pf_code:{id}:{hash}` | Rule configs; offload per §1.3 |
| `validation_logs` + per-entry keys | Execution history |
| `doc_repo_index`, `doc_repo:{id}`, `doc_repo_seed_meta` | Builtins eviction-exempt; disable is admin-only; delete flips builtin → disabled (reseed never resurrects) |
| `skill_repo_index`, `skill_repo:{id}`, `skill_repo_seed_meta` | Cap 100 custom skills; record ≤45,000 chars serialized (instructions ≤24,000, examples ≤16,000); builtins exempt from cap |
| `pf_memories` (single array) | Cap 200 items / 200,000 chars serialized; content ≤400 chars; Jaccard 0.85 dedup-reinforce |
| `COGNIRUNNER_MEMORY_SETTINGS` | Defaults `{ autoCapture: false, injection: true, runtimeInjection: false }` — autoCapture and runtimeInjection are OPT-IN, default OFF; do not flip defaults |
| `COGNIRUNNER_AI_PROVIDER`, `COGNIRUNNER_KEY_{provider}`, `COGNIRUNNER_MODEL_{provider}` | BYOK slots — admin panel only, never env vars |
| `async_task:{id}`, `pf_exec:{id}` | TTL-bound, poll-deleted |

- Hard platform limits: 240KiB per KVS value; 25s sync resolver cap; 120s consumer cap;
  22s PF budget. Prompt injection caps: skills block ≤24,576 bytes, memory block ≤8,192 bytes.

### 1.8 Frontend conventions

- **Component duplication (config-ui ↔ admin-panel).** Byte-identical copies:
  `FunctionBlock.jsx`, `FunctionBuilder.jsx`, `CodeEditor.jsx`, `DocRepository.jsx`,
  `AILoadingState.jsx`, `KnowledgePanel.jsx`, `SkillsTab.jsx`, `SkillEditor.jsx`,
  `MemoriesTab.jsx`, `components/editor/*`. Deliberately DIVERGED (never blind-copy):
  `CustomSelect.jsx`, `Tooltip.jsx`, `ReviewPanel.jsx`, `IssuePicker.jsx`, `Skeleton.jsx`.
  Shared components stay self-contained (no imports from App.js).
- **CSS reality.** `App.js injectStyles()` is the LIVE CSS source in each app (`styles.css` is a
  convention mirror, not imported); `public/index.html` holds only the pre-mount bootstrap subset;
  admin-panel additionally has `injectCopiedComponentStyles()` mirroring config-ui component CSS.
- **Module-level state refs in config-ui** exist because `onConfigure` captures its closure at
  registration — kept in sync via `useEffect`. **Do not refactor away.**
- **MLS motion contract:** all new UI uses the shared loading/animation classes (`.is-busy`,
  `.veil`, `.stagger`, …); every keyframe animation must END on `transform: none`.
- **CSP:** no `eval` / `new Function()` in iframe code (no `scripts: unsafe-eval` in manifest) —
  client-side JS syntax checks use Lezer parsing.

### 1.9 Design mandates (owner law)

- NEVER left accent rails / `border-left` colored stripes on any component.
- NEVER faded / low-alpha tints as accents — solid, saturated hues with white text on
  chips/badges/buttons; bold 600–700 typography for emphasis.
- Hue map is fixed: docs `#2563eb`, skills `#7c3aed`, memories `#0d9488`; memory sources user
  `#2563eb` / test `#d97706` / fix `#16a34a`; neutral slate `#475569`. Dark variants one shade
  lighter (`#3b82f6 #8b5cf6 #14b8a6 #f59e0b #22c55e #64748b`). **Every new hue ships with a
  dark-mode override in the same diff.**
- NEVER native browser UI primitives: no `window.alert/confirm/prompt`, no native `<select>` —
  always the app's custom dialogs/dropdowns.

### 1.10 Platform, security, process

- **`manifest.yml` is FROZEN** — modules, scopes, egress addresses (`api.openai.com`,
  `*.openai.azure.com`, `openrouter.ai`, `api.anthropic.com`, `*.amazonaws.com`, `*.ts.net`,
  `mcp.context7.com`), permissions — without explicit human approval BEFORE the diff.
- Every mutating resolver is permission-gated (`requireRole(accountId, "editor")` /
  `requireAdmin` / `canActOnConfig`). New resolvers MUST gate; never remove a gate.
- Every new `.js`/`.css` file starts with the Apache-2.0 header (full header for
  substantial logic, short SPDX header for small files). Never remove an existing header.
- `build/` directories are committed and deployed directly. NEVER read, cat, grep, or diff
  anything under `build/`, `build-shot/`, or `node_modules` (minified bundles overflow context) —
  use pathspecs excluding them.
- `npm run lint` is broken — syntax-check backend files with `node --check`.
- Git identity: commit as `leanzero.srl`; never credit Claude in commits.
- AI system prompts, response formats, storage key names, and env var names change only with
  explicit human approval (danger zone).

---

## 2. Change requires

| If a diff touches… | It MUST also… |
|---|---|
| `createApi()` sandbox surface | Update `SANDBOX_API_METHODS` (incl. `promptDoc`) in `src/shared/sandbox-api-spec.js` in the SAME diff; rebuild all three UI apps; never hand-edit `KNOWN_API_MEMBERS` (derived) |
| `manifest.yml` (anything) | STOP — explicit human approval first; then `forge deploy` (+ `forge install --upgrade` if modules/scopes changed) |
| A byte-identical duplicated component (§1.8 list) | Edit in config-ui, copy to admin-panel, prove with `diff -q`, rebuild BOTH apps |
| Component CSS | Update `App.js injectStyles()` (live), mirror in `src/styles.css`, and sync admin-panel `injectCopiedComponentStyles()` |
| Any new accent color | Add the dark-mode override for that hue in the same diff |
| Any backend `.js` file | `node --check` every touched file (index.js, async-handler.js, skills.js, memories.js, shared/*) |
| Any frontend `src/` file | `npm run build` in that app; commit rebuilt content-hashed bundles (old-hash deletions + additions together) with the source |
| AI system prompts / response formats / parse shapes | Explicit human approval; preserve fence + defang + parseAIJson + server-side clamp chain |
| Storage keys, env var names, caps/TTLs | Explicit human approval; stay under 240KiB/value; keep prune/eviction exemptions for builtins |
| New async task type | Register in `TASK_HANDLERS`; add to `UNPOLLED_TASKS` if nothing polls it; TTL-bound rows; respect cancel token |
| New AI provider | Route through `callAIChat` only; egress needs manifest approval; mirror provider resolution in async-handler WITHOUT caching; set a default model (never `gpt-4o-mini`) |
| New source file | Apache-2.0 header as the very first content |
| Deploy-affecting change | `forge lint` → `forge deploy` (dev); verify rule edit, generate→test→fix loop, admin tabs, light AND dark themes |

---

## 3. Quick self-check before any commit

1. Sandbox spec and `createApi()` still in lockstep? Consumption sites still derive from the spec?
2. Validator returns `{ result, errorMessage? }`? CREATE (null `issue.key`) path uses `modifiedFields`? Fail-open preserved?
3. Untrusted content fenced + defanged? Model output parsed with `parseAIJson` + clamped?
4. `functionsMeta` still never read for step details? Offload threshold untouched?
5. Duplicated components byte-identical (`diff -q`)? Both apps rebuilt? CSS synced in all three places?
6. No left rails, no faded tints, no native UI primitives, dark override per new hue, MLS classes used?
7. `node --check` clean on all touched backend files? Bundles rebuilt + committed? manifest untouched (or human-approved)?
8. Apache-2.0 headers on new files? Fallback model `gpt-5.4-mini`?
