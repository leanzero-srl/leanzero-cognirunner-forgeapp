# FRAME — Release 1.5 "Virtual Administrator + Confluence"

Architect's FRAME (cr-architect). **No production code is proposed here.** This document
states 1.5 as a cause, names the ONE home of every new rule, names every existing home it
must reuse rather than copy (with `file:line`), the manifest delta, the commit list re-cut
against the code, the probes still open, the gates as code-level predicates with their test
names, the long-horizon laws as mechanisms, and what the breaker attacks first.

Sources: the approved plan `~/.claude/plans/i-need-you-to-cached-sphinx.md`
(§2.6–2.9, §3.10–3.17, §4/§4b rows 18–24, 31, 34, 38b, §5b, §6 "1.5", §7, §8 "Open for the
breaker"), `docs/FRAME-1.4-coder.md` (shape and conventions),
`.claude/skills/cognirunner-development/SKILL.md` (laws, roster, THE TICK) and its
machine-local `state/FINDINGS-LEDGER.md`. Repo state read: `main` @ `3db6638`.

Every line-pointer below was grepped on that commit. Per the 1.4 FRAME's own correction:
**grep the symbol, not the line** — `src/index.js` is 19,707 lines and drifts every commit.

---

## 0. What is already true in the tree (read, not assumed)

The plan is older than the code in eight load-bearing places. Each was grepped.

| Fact | Where | Consequence for 1.5 |
|---|---|---|
| **`requiresProduct` already exists**, and the `confluence` and `ledger` namespaces are already declared `reserved: true` with their executor module names | `src/shared/agent-actions.js:127-140` (`AGENT_NAMESPACES`) | §3.5's namespace work is **done**. 1.5 fills `confluence` and `ledger` with action rows and writes the two executors the table already names (`confluence-actions`, `va-ledger`). It must NOT re-declare the namespaces. |
| **`normalizeAllowedActions` is dual-arity by design**: `(ids)` → array, `(ids, opts)` → `{allowed, refused}` | `src/shared/agent-actions.js:284-301` | The VA save path calls the 2-arg form with `{capability, products, triggerSource, savedByRole}`. Adding a third shape is the GOTCHAS trap-3 arity gap repeating. |
| **Three Confluence scopes and the optional-product compatibility are already in the manifest** | `manifest.yml:489-491` (`read:space:confluence`, `read:page:confluence`, `search:confluence`), `:559-563` (`compatibility.jira.required:true`, `confluence.required:false`), `:488` (`read:servicedesk-request`) | The manifest delta is **three scopes, not eight** (§3 below). The plan's "verify `compatibility.confluence.required:false` already present?" — **yes, present.** |
| **The `long-consumer` exists and the budget gate is already ONE function both entry points call** | `manifest.yml:367-369`, `:434-436` (`timeoutSeconds: 900`); `src/async-handler.js:1621 runGatedTask`, `:1629 deferQueueKey`, `:1862 longQueue`, `:1386 LONG_QUEUE_ONLY_TASKS`, `:1394 LONG_QUEUE_EVENTS` | §3.17(3)'s "extract the gate" is **done**. A VA tick/item that needs 900 s joins `LONG_QUEUE_ONLY_TASKS`; it does not get a third consumer and it does not get a second gate. |
| **`va-item` (8000) and `va-post` (200) already have `estimateTaskTokens` rows and are already in `TOKEN_SPENDING_TASK_TYPES`** | `src/shared/ai-budget.js:97-99`, `:148-152` | 1.5 adds **`va-tick` only**, and it belongs in `NON_AI_TASK_TYPES` (`:101`) — a sweep calls no model. Putting `va-tick` in the spending list would reserve tokens a tick never spends and starve real work. |
| **Job brakes, the tenant-wide agent-run brake and the cadence presets all landed in 1.4 commit 13d** | `src/shared/registry-limits.js:389-405` (`JOB_*_MAX_WRITES_PER_RUN`, `AGENT_RUN_BRAKE_MAX_PER_BUCKET`, `brakeRefusalText`); `src/listeners.js:576 takeAgentRunSlot`; `src/shared/cron.js:312 SCHEDULE_PRESETS`, `:356 presetToCron`, `:389 cronToPreset` | §3.10 is shipped. VA caps are a **different** brake (per agent, per hour/day, owed-uncapped) and belong beside these, in the same file, never as literals in `virtual-admin.js`. |
| **`mode` on a scheduled job is a two-value field today** | `src/scheduled-jobs.js:94` `const mode = src.mode === "agent" ? "agent" : "script"` | `mode:"va"` is a **one-line-looking change with a wide blast radius**: `:110` (`mode === "script"` requires functions), `:115`, `:137 toIndexRow`, `:352`/`:371` in `runJob`, plus every UI that renders a mode. Grep `mode ===` across `src/` and `static/` in the same cut. |
| **The sandbox API spec is a FLAT array keyed by `name`**, and the editor lint's allow-list is `SANDBOX_API_METHODS.map(m => m.name)` | `src/shared/sandbox-api-spec.js:53`, `:475 KNOWN_API_MEMBERS` | §3.12's "ONE spec entry `confluence`" cannot be a flat method row: `api.confluence.searchCql` is a **dotted member**. This is the single sharpest design decision in the Confluence half — see §2 "The nested-namespace decision". |
| **`sd.public.comment`'s documented shape in this app is `{ internal: true }`, not `false`** | `src/shared/sandbox-api-spec.js:279` | The plan's §3.11 step 3 writes "internal note via `sd.public.comment=false`". The app's own spec says the property value is `{internal:true}`. One of the two is wrong; the code is the authority and the plan text must not be transcribed. Probe P3 below. |
| **Nothing named `va*`, `voice-lint`, `confluence-client` or `confluence-actions` exists in `src/`** | `grep -rln "virtual-admin\|va_item\|voice-lint" src/ static/` → empty; `grep -rn "requestConfluence" src/` → only `src/test-hook.js:147` (the probe-d harness call) | 1.5 is genuinely new code, not a refactor. The only Confluence reach proven in the tree is the probe. |

**Ledger state read:** the next free finding id is **F-409** (`F-408` is the last row).
Open 1.4 rows that 1.5 **inherits and must not widen**: F-395 / F-400 / F-406 (web-search
identifier leaks), F-396 (the tenant agent brake is wired at the job run site only, not the
listener one), F-402 / F-403 (the write brake counts only Jira sandbox mutations), F-404
(knowledge never reaches the Coder), F-405 (the oversized-skill notice is unreachable),
F-407 (the search budget is per issue, not per run), F-408 (memories labelled trusted).
**Every one of these is on a path the Virtual Administrator will use.** They are named
per-commit below.

---

## 1. The cause, and where each rule will live

**Cause (one sentence).** CogniRunner can already *run* an agent, but it has no way for an
agent to work a queue over days without re-deciding from scratch each time, no place to
record what it did or what it may say, and no reach into Confluence — so 1.5 adds the three
missing state layers (a per-item ledger with fingerprints, a deterministic voice contract, a
two-phase speech clock) and one new product surface, and every one of them has exactly one
home or it becomes this repo's signature defect at ledger scale.

| Rule | THE ONE HOME | What makes a re-split impossible |
|---|---|---|
| VA record shape, every clamp, the gate constants, `normalizeVa` | **`src/shared/va-config.js`** (new, dependency-free) | It bundles into the backend AND the admin panel, so the wizard and the engine cannot disagree about a cap. `scripts/shared-imports.test.mjs` is the import gate (`node --check` is **not** a gate for `src/shared/*.js`). |
| Outward-text rules (block list, burstiness, sentence caps, banned openers) | **`src/shared/voice-lint.js`** (new, dependency-free), data tables imported from the `voice-rules` pack | The post gate and the wizard's live voice sample call the SAME function. A lint fixture corpus (human samples pass, AI samples fail) fails the offline run if either drifts. |
| Ledger rows, claims, fingerprints, effects, memory compaction | **`src/va-ledger.js`** (new; the name `agent-actions.js:140` already reserves) | Every key is built by a builder in this file, and every builder goes through `safeKeyPart` + `assertKvsKey` (`src/shared/kvs-keys.js:16`, `:64`) — F-346's trap. `test-harness/scripts/kvs-key-shapes.test.mjs` exercises them with hostile fixtures. |
| Sweep, diff, fan-out, item turn, post phase, tick receipts | **`src/virtual-admin.js`** (new) | It is a *caller*: the tick planner, the claims, the brakes and `runAgentLoop` all stay where they are. A rule that appears here and also in `scheduled-jobs.js` is a finding. |
| Confluence REST, error mapping, `confluence_unavailable` | **`src/confluence-client.js`** (new) + **`src/shared/confluence-endpoints.js`** (new, shaped like `src/shared/jira-endpoints.js:1`) | ONE client; the sandbox, the actions, the validator and the post-functions all call it. Nothing else calls `requestConfluence` — a second call site is a finding. |
| Confluence agent actions | **`src/confluence-actions.js`** (new — the name `agent-actions.js:129` already reserves), rows in `src/shared/agent-actions.js` | The namespace table already routes by `executor`; `agent-runner.js` delegates by namespace and must not grow an id switch. |
| `api.confluence.*` sandbox docs | **ONE entry in `src/shared/sandbox-api-spec.js`** | The spec drives the codegen prompt, completions, hover, lint and the API-reference panel. Re-hardcoding docs at a consumption site is the defect `sandbox-api-spec.js` exists to prevent. |
| `confluence-page-exists` validator, the condition branch, the two post-functions | **`src/shared/premade-rules-catalog.js`** (rows) + the executor, kept honest by `npm run test:parity` | The catalog/executor parity lint already exists because this exact rule split once. The condition is a **branch of the ONE expression** in `manifest.yml:25-60`, never a new module. |
| Wizard interview state machine | **`src/shared/va-wizard.js`** (new, dependency-free) | The field order, the option sources and the validation live once; the UI renders, it does not decide. |
| Agents tab | `static/admin-panel/src/components/` | Not duplicated into config-ui — it is admin-only. Any component it shares joins the `diff -q` list explicitly or not at all. |

---

## 2. Existing homes 1.5 must REUSE, not duplicate

Each of these is a place where a second copy would be the release's defect.

| Reuse | `file:line` | The rule |
|---|---|---|
| Tick planner + the 5-minute scheduler | `src/scheduled-jobs.js:243 planTick`, `:260 scheduledTick`, `manifest.yml:356-359` (`fiveMinute`) | A VA is a job with `mode:"va"`. **No second scheduled trigger.** Both the PREPARE and the POST phase are driven by this one planner. |
| Tick claim | `src/scheduled-jobs.js:295` (`job_claim:{id}:{fireIdentity}`) | The VA tick claim IS this claim. `va_exec` / `va_post` are *additional*, narrower claims — not replacements. |
| Job record, index, enable/disable, run-now, REST | `:80 normalizeJob`, `:137 toIndexRow`, `:159 listJobs`, `:178 saveJob`, `:225 enqueueJobRun`, `src/rules-api.js:293` (`?resource=jobs`) | `normalizeVa` is called *from inside* `normalizeJob`'s `mode:"va"` arm. A parallel `saveVa` store is the split. |
| Job write brake + the tenant agent brake | `src/shared/registry-limits.js:389-405`, `src/listeners.js:576 takeAgentRunSlot`, `src/scheduled-jobs.js:357-393` | VA caps are new *numbers in the same file*. **F-402/F-403 are open here** — the counter is Jira-sandbox-only, so a VA that only comments would under-count today. |
| The agent loop | `src/agent-runner.js:239 runAgentLoop`, `:417 createAgentActionDispatcher`, `:386 assertAgentActionAllowed` (the ONE allow-list check, F-359) | A VA item turn is a `runAgentLoop` caller with its own executors, exactly as `src/coder-engine.js:67` imports them. No second loop. |
| Knowledge injection | `src/agent-runner.js:184 buildKnowledgeMessages`, `src/listeners.js:322 buildAgentKnowledge`, `src/shared/registry-limits.js:339 KNOWLEDGE_BUDGET_BYTES`, `:354 MAX_RULE_SKILL_IDS` | The VA item turn calls `buildAgentKnowledge` with its own audience. **F-404 and F-405 are open on this exact seam** — the coder never receives it, and the skipped-skill notice is unreachable. 1.5 must pass `log` and must prove the thread-through with a test, or it ships the same silence. |
| Fence defanging | `src/memories.js:80 defangFence` | Every tool result, page body, comment body and ledger note is fenced through this. `runAgentLoop:333,345` already does it at the loop boundary — the VA executors must not double-defang or skip it. |
| KVS key builders | `src/shared/kvs-keys.js:16 safeKeyPart`, `:64 assertKvsKey`, `:53 KVS_KEY_PATTERN` | **F-346.** An issue key is safe; a page title, a space name, a queue name and a persona name are NOT. Every VA and Confluence key part goes through the builder. |
| Claims | `src/shared/execution-claim.js:12 claimRuleExecution(..., {failClosed})` | `va_post` is `failClosed:true` (a double public reply is worse than a missed one). `va_exec` is `failClosed:true` too — a double item turn spends tokens twice. Say which, in a comment, next to each. |
| Refusal vocabulary | `src/index.js:504 requireRole`, `:647 requireAdmin`, `:683 permissionDenied`, `:693 noPerm`, `:867 upgradeRequired`, `:897 requireAdvanced` | Every new VA/Confluence resolver refuses through these three shapes. A hand-built `{success:false,error}` is a finding (F-242). |
| The ONE condition expression | `manifest.yml:25-60` | `confluence-page-linked` is a null-guarded branch: missing property → **TRUE**. Default-TRUE is load-bearing and documented in the manifest comment. |
| PF routing | `src/index.js:18790 isHeavyPf`, `:19268 resolvePfType`, `:19296 dispatchPostFunction`, `:3650 RULE_KEY_MAP` | `postfunction-confluence-page` gets **explicit** rows in all three, never an inline branch (the §8 finding "PF inline" is exactly this). `postfunction-confluence-comment` is inline and deterministic — say why in the comment. |
| The one budget gate | `src/async-handler.js:1621 runGatedTask`, `:1349 TASK_HANDLERS`, `:1386 LONG_QUEUE_ONLY_TASKS`; `src/shared/ai-budget.js:97-101`, `:111 estimateTaskTokens` | New task handlers are rows in `TASK_HANDLERS`. Fan-out pushes carry `concurrency: {key:"ai-budget", limit:2}` from the first push (the read-modify-write is not atomic — §4b row 38b). |
| The long consumer | `manifest.yml:434-436`, `src/async-handler.js:1862` | A VA item with Confluence/git/web powers joins `LONG_QUEUE_ONLY_TASKS`; a plain item stays on the 120 s consumer. **Decide per task type at the producer, not at the handler.** |
| Untrusted-content convention | `CLAUDE.md` "AI prompt security"; `src/agent-runner.js:613` (`<<<CONTEXT … CONTEXT>>>`) | A Confluence page body, a JSM customer comment and a queue name are all untrusted. **F-408 is open on the trust label of the block that sits above the fence.** |
| The JSM internal-note shape | `src/shared/sandbox-api-spec.js:279` (`properties: [{key:"sd.public.comment", value:{internal:true}}]`) | The audience gate uses THIS shape, not the plan's `sd.public.comment=false`. |

**The nested-namespace decision (flagged as the Confluence half's sharpest).**
`SANDBOX_API_METHODS` is flat and `KNOWN_API_MEMBERS` is a list of bare names, so
`api.confluence.searchCql` is not expressible today. Three options, and the architect's
position: **add one spec row named `confluence` whose shape carries a `members[]` array**,
and teach the four derivations (`KNOWN_API_MEMBERS`, completions, hover, the reference
panel) to expand a row with `members` — four small edits in the one module, versus a second
flat row per method (which pollutes `getApiMethodNames()` and every prompt) or a flat
`api.confluenceSearch(...)` naming (which contradicts the plan and the actions namespace).
**This is the decision I am least confident about** (§8).

---

## 3. Manifest delta

`manifest.yml` on `3db6638` **already carries**: `read:servicedesk-request` (:488),
`read:space:confluence` (:489), `read:page:confluence` (:490), `search:confluence` (:491),
`compatibility.jira.required:true` / `confluence.required:false` (:559-563), the
`long-consumer` on `long-queue` at `timeoutSeconds:900` (:367-369, :434-436), and the
`fiveMinute` scheduled trigger (:356-359).

**The delta is exactly three scopes:**

1. `write:page:confluence`
2. `read:comment:confluence`
3. `write:comment:confluence`

Nothing else. **No new module.** No new consumer (the long one exists). No new trigger (the
5-minute planner exists). No new egress (Confluence is reached through `requestConfluence`,
not `fetch`). No `client` egress.

**Is it a major version? YES.** Scope additions require user re-consent, which means a major
bump and `forge install --upgrade` on every site — plus `--approve MAJOR_VERSION_RULE` on
every deploy (the 1.4 egress bump already put the app on that footing). Per the skill, a
manifest change is a **hard stop for the tick and a coordinator/owner decision** — it is not
a surgeon's diff. **One bump, cut once, with commit 6.** If a surgeon believes a fourth
manifest change is needed, that is a STOP.

---

## 4. The commit list for 1.5, re-cut against the code

Plan §6's nine steps, with what the tree has already absorbed. **Step 0 (FRAME + BREAK) is
this document plus the breaker running in parallel** (§8).

### Commit 1 — `va-config.js` + `voice-lint.js` + tests · **cr-rules-surgeon**

**Files:** `src/shared/va-config.js` (new), `src/shared/voice-lint.js` (new),
`src/shared/registry-limits.js` (the VA cap numbers, beside the job/agent brakes),
`test-harness/scripts/va-config.test.mjs`, `voice-lint.test.mjs`, and an entry in
`scripts/shared-imports.test.mjs` for both new modules.

**Contracts.** `normalizeVa(input, {existing, savedByRole})` → the §3.11 record, **every
number clamped server-side after parsing** (Law 2) and `scope.write.site` **refused**, not
silenced. Caps live in `registry-limits.js` as named constants with a `brakeRefusalText`
sibling so the refusal sentence has one home. `voiceLint(text, {register, maxSentences})` →
`{ok, blocks:[{rule, detail}], warnings:[]}` — pure, no I/O, no regex over a user-supplied
pattern (`src/shared/regex-safety.js` is the guard if one ever appears).

**Folded design findings.** `owedUncapped` is **not a field** — `owedPerHour` (default 12)
is, and anti-pile-up applies to owed items after N owed replies on one issue (F-412).
`maxBulkTargets` is **not a field** — `maxWritesPerRun` is the one write vocabulary (F-425).
Voice rules have ONE home: the `voice-rules` pack DATA tables; `voice-lint.js` **reads**
them, and the persona prompt and the wizard sample are **rendered from the same tables**,
never re-authored as prose (F-420). Test: `voice.one_home.ALLOW_render_matches_lint_table`.

**Fail contract (Law 3).** `normalizeVa` fails **CLOSED**: an unparseable or over-cap field
is a refused save with a named reason, never a silent clamp to the permissive end.
`voiceLint` fails **CLOSED** on the post path (a lint that throws blocks the post) and
**OPEN** in the wizard preview (a sample that cannot be linted still renders, labelled).
Write both sentences next to the code.

**Tests:** BLOCK + ALLOW per lint rule; the human-corpus fixtures pass and the AI-shaped
fixtures fail; `normalizeVa` refuses site-wide writes; every clamp asserted at both ends.
**Calibrate on human corpora, never on the agent's own output** (§4b row 34).

### Commit 2 — `va-ledger.js` (rows, claims, fingerprints, effects, compaction) · **cr-rules-surgeon**

**Files:** `src/va-ledger.js`, `test-harness/scripts/va-ledger.test.mjs`, and the new key
builders added to `test-harness/scripts/kvs-key-shapes.test.mjs`.

**KVS contract — every key through the shared builders** (`safeKeyPart` + `assertKvsKey`):
`va_item:{agent}:{issueKey}` · `va_memory:{agent}` · `va_tick:{agent}:{tickId}` (7-day TTL) ·
`va_effect:{agent}:{invTs}` (30-day TTL) · `va_caps:{agent}:{hourBucket|dayBucket}` (TTL) ·
claims `va_exec:{agent}:{key}:{tickId}` and `va_post:{agent}:{key}:{stagedAt}`.
**One row per key — never an array** (the `pf_memories` single-array store is why: see the
memory-store policy in the skill, and every `saveMemories` caller must read its refusal).
`history` ≤ 10 entries, `notes` ≤ 600 chars, clamped by `va-config.js`'s constants.

**Fail contract.** Both claims `failClosed: true` — a storage fault means **no turn and no
post**. `isKeyConflict` (`kvs-keys.js:23`) is the ONLY predicate allowed to read a conflict
as "already claimed"; a 429 is an infrastructure fault, not a duplicate.

**Row lifecycle (F-413).** `va_item` rows carry a **90-day TTL refreshed on touch** and a
**per-agent row cap with LRU parking**; `attempts` is a first-class field (F-414).
Tests: `ledger.ttl.REFRESH_on_touch` · `ledger.cap.PARK_lru_over_cap` ·
`ledger.attempts.PARK_at_three`.

**Health (F-426).** `va_health:{agent}` is its own row holding the consecutive-failed-tick
counter; the red banner reads it. **Never reconstructed by `query()` over `va_tick:*`** —
that scan is eventually consistent and TTL-bounded, which is exactly how a banner silently
stops appearing. Tests: `health.BLOCK_banner_absent_on_two` · `health.ALLOW_banner_on_three`
· `health.RESET_on_successful_tick`.

**Memory (F-423).** `memory_note` content is **defanged and clamped at WRITE time**, not at
injection. `va_memory` is injected inside an **ADVISORY fence** (the F-408 rule), never as
operator knowledge. Compaction preserves a pinned `constraints[]` list **verbatim by code** —
the summariser may rewrite prose, it may not touch the pinned list.
Tests: `memory.write.CLAMP_and_defang` · `memory.inject.ADVISORY_fence` ·
`memory.compact.PRESERVE_pinned_constraints_verbatim`.

**Effects are written on read-back only** — the row is created after a second REST read
confirms the comment id / property / field value, never after "a call that could mutate was
made" (§3.14 law 6; Law 4's "verify the write through a second REST read").

**Memory compaction** at 6 KB → one Haiku-class summarisation call, cap 8 KB, decisions and
keys preserved verbatim. It is a **queued** task so it inherits the gate.

### Commit 3 — `virtual-admin.js` engine · **cr-rules-surgeon**

**Files:** `src/virtual-admin.js`, `src/scheduled-jobs.js` (the `mode:"va"` arm and every
`mode ===` site), `src/async-handler.js` (three `TASK_HANDLERS` rows),
`src/shared/ai-budget.js` (`va-tick` into `NON_AI_TASK_TYPES` — `va-item`/`va-post` already
have rows).

**The field guide is selected ONCE per agent/tick (F-417)**, from the agent's CONFIG text —
never per item from the item's volatile text. That is what makes the cached prefix stable
across rounds and across items; per-item volatile text stays last. A design that scores the
guide against the volatile text trips its own "cache read was zero" defect detector.
Tests: `prefix.ALLOW_stable_across_items` · `prefix.BLOCK_reselect_per_item`.

**The post phase is its own task (F-421).** `va-post` is enqueued by the planner as a task
with **its own tick receipt row** — it is not a side-errand of the prepare tick and it does
not ride the prepare tick's receipt. The planner's scan for eligible staged rows is bounded
and recorded like any other tick. Tests: `planner.postphase.ALLOW_receipt_written` ·
`planner.postphase.BLOCK_unbounded_scan`.

**The `va_exec` claim is taken by the CONSUMER (F-422)**, at the start of the item task,
FAIL_IF_EXISTS + `failClosed`, and **released on throw before any side effect** — the same
shape `git_delivery` settled on after F-335/F-367. The producer does not claim. Say which
side owns it in a comment, because F-139 already paid for this exact ambiguity on
`job_claim`. Tests: `claim.exec.BLOCK_second_consumer` · `claim.exec.ALLOW_retry_after_throw`.

**Task types:** `va-tick` (sweep/diff/fan-out — **no model call**, so `NON_AI_TASK_TYPES`),
`va-item` (8000, exists), `va-post` (200, exists). An item with Confluence/git/web powers is
pushed to `long-queue` and named in `LONG_QUEUE_ONLY_TASKS`; a plain item stays on the 120 s
consumer. **Fan-out carries `concurrency:{key:"ai-budget", limit:2}` from the first push.**

**Fail contract.** A tick that cannot claim → **no run, and a tick receipt saying so**
(§3.14 law 8: every quiet failure is loud somewhere). A model failure inside an item →
the item stays `queued` with its reason in `history`, **never** `done`. An item turn that
ends with no tool call ends cleanly (§3.14 law 10). The post phase is fail-CLOSED at every
gate (§6). Three consecutive failed ticks → a solid red banner (Law 6: solid, not a tint).

**Inherited open findings that must be closed or explicitly carried here:** F-396 (wire
`takeAgentRunSlot` where the VA run happens, not only at the job site), F-402/F-403 (the
write counter must count what a VA actually does — comments, transitions, field edits — or
its `maxWritesPerRun` is decorative).

### Commit 4 — ledger/ask/propose/stage actions + JSM queue intake + scope-wrapped JQL · **cr-rules-surgeon**

**Files:** `src/shared/agent-actions.js` (rows in the **existing** `ledger` namespace),
`src/va-ledger.js` (the executors), `src/virtual-admin.js` (intake).

**Actions:** `stage_reply`, `ask_human`, `propose_change`, `ledger_note`, `memory_note`.
**Speech is never direct** — there is no `post_comment` action in the VA's tool list, at all.
`propose_change` **never executes**; it files an approval-inbox issue. Configuration writes
(schemes, workflows, permissions, roles, fields) are not in the surface, which is a code
guarantee, not a prompt sentence (Law 2).

**Write scope is a CODE gate in two places, one home (F-410/F-411).**
`assertWriteScope(issueKey, writeScope)` lives in `src/shared/va-config.js` and is used by
**the VA post phase, the coder headless PF and listener agent runs alike**.
`normalizeAllowedActions` and `createAgentActionDispatcher` gain a `writeScope:{projects[]}`
context, and **every write action resolves its target issue's project from a read** before
acting — never from the model's argument. `mentionsOf` intake is bounded to the **read**
scope and **can never widen the write scope**.
Tests: `writescope.BLOCK_dispatcher_outside_scope` · `writescope.BLOCK_create_issue_foreign_project`
· `writescope.BLOCK_mentions_widening_write` · `writescope.ALLOW_in_scope_transition`.

**Scope-wrapped JQL:** the operator JQL is wrapped `(<jql>) AND project in (<read scope>)`.
**This is the escape the breaker attacks first** — a trailing `ORDER BY`, an unbalanced
quote, or a comment sequence can break the wrapper. The wrapper must be built from a
*validated project list* and the operator clause must be parenthesised and length-capped in
`va-config.js`; the honest test is a hostile-JQL fixture set.

**Fail contract.** A queue read that 404s → the intake source is reported dead in the tick
receipt and the tick **continues with the remaining sources** (a dead queue must not silence
the whole agent); a scope read that faults → **fail CLOSED**, no candidates, because an
unbounded sweep is the blast radius this gate exists for.

### Commit 5 — `va-wizard.js` + Agents tab · **cr-rules-surgeon** (state machine) then **cr-ui-surgeon** (tab), sequenced

**Files:** `src/shared/va-wizard.js`, resolvers in `src/index.js` (**cr-backend-surgeon**,
a third sequenced cut — two writers in `index.js` is prime directive 1),
`static/admin-panel/src/components/{AgentsTab,VaWizard,VaEditor}.jsx`, both style injectors.

**The model returns `{say, ask, field, options?, done}` and code validates every value
against real data before it lands** — projects from `/project/search`, desks and queues from
`servicedeskapi`, time zones from the Intl list, cadence from `SCHEDULE_PRESETS`
(`cron.js:312`). **Wizard JSON is untrusted model output**: parse with `parseAIJson`, clamp
server-side after parsing, and never let a `field` name select a code path by string.

**Two more validated fields (F-424).** `jql` is validated by a **dry `search` against the
read scope, bounded to 1 result** — a JQL that cannot be executed never becomes standing
intake. The persona name is **length- and charset-clamped** before it is rendered into any
outward message. Tests: `wizard.jql.BLOCK_unexecutable` · `wizard.jql.BLOCK_outside_read_scope`
· `wizard.persona.BLOCK_illegal_charset` · `wizard.persona.ALLOW_clamped_name`.
The wizard renders `maxWritesPerRun`, not `maxBulkTargets` (F-425).

**Fail contract.** The wizard fails **CLOSED** into the classic form: any state it cannot
validate drops to `VaEditor.jsx` with what it had. Wizard state in `va_wizard:{accountId}`
so a closed tab resumes. **Law 6 applies literally:** no native `<select>`, no
`window.confirm`, no left rails, no faded tints; every new hue (agents `#b45309`/`#f59e0b`)
needs a dark override and a `css-parity` row. Every `.jsx` imports React (classic runtime).

### Commit 6 — Confluence client + catalogue + sandbox entry + actions + **the manifest bump** · **cr-backend-surgeon**, with the sandbox entry to **cr-sandbox-surgeon**

**Files:** `src/confluence-client.js`, `src/shared/confluence-endpoints.js`,
`src/confluence-actions.js`, `src/shared/agent-actions.js` (rows in the existing
`confluence` namespace), `src/shared/sandbox-api-spec.js` (**one** entry), `src/index.js`
(`createApi`'s `api.confluence`), `manifest.yml` (the three scopes — **coordinator cuts
this, owner clicks the upgrade**).

**Contract.** ONE error code `confluence_unavailable` when the app is not installed on
Confluence, plus `auth` / `not_found` mapping. Page bodies ≤ 60 KB, fenced and defanged.
`updatePage` is **version-checked** (a blind update is a lost-edit bug). Simulation
intercepts every write (`createApi`'s existing simulation ledger is the one home).

**The validator degradation table (F-416) — write it as a table, not as prose:**

| cause | non-strict | strict |
|---|---|---|
| `confluence_unavailable` | **OPEN**, reason in the log row + banner | **BLOCK**, message names the cause |
| `auth` (scope/consent fault) | **OPEN**, banner | **BLOCK**, message names the cause |
| network / timeout | **OPEN** | **BLOCK**, message names the cause |
| **misconfig** (no space, no template, unparseable CQL) | **BLOCK** | **BLOCK** |

Misconfiguration blocks **regardless of strict** — the F-362 class: a rule that cannot
express what it is checking must not read as a pass. Tests: `confluence.degrade.<cause>.OPEN_non_strict`
· `.BLOCK_strict` · `confluence.degrade.misconfig.BLOCK_both`.

**Fail contract (Law 3, per surface).** Validator on an unavailable Confluence → fails
**OPEN** with the reason in the log row and a banner in the UI. Listener AI condition that
depends on a Confluence read → **CLOSED**. Post-function step → `status:"failed"`, never a
silent success. Agent action → a named refusal the model can read, never an empty result
(an empty result reads as "the page does not exist", which is the proven-negative trap).

### Commit 7 — Confluence validator + condition branch + two post-functions · **cr-backend-surgeon**

**Files:** `src/shared/premade-rules-catalog.js` (rows; the git validators at `:227-263`
are the shape to follow, incl. `network:true`), the executor, `manifest.yml`'s condition
expression (**a branch, and only if the branch is genuinely needed — if it is, that is a
FOURTH manifest change and therefore a coordinator STOP, folded into commit 6's bump**),
`src/index.js` (`RULE_KEY_MAP`, `isHeavyPf`, `resolvePfType`, `dispatchPostFunction` rows).

**Contract.** `validate()` returns **exactly `{result, errorMessage?}`** — F-384: Jira 400s
on any extra key and the user is blocked with nothing logged. Diagnostics ride the execution
log row only. `network:true` validators run under `raceDeadline` (`src/index.js:1178`), ≤ 8 s,
**fail OPEN** on timeout with the reason. The `cognirunner.confluence` property is
**advisory** — forgeable; the validator verifies live. Write that sentence next to the write
and next to every reader. `npm run test:parity` is the gate that keeps the catalog and the
executor agreeing.

### Commit 8 — REST resources for agents (`?resource=agents`) · **cr-rules-surgeon**

**Files:** `src/rules-api.js` (the switch at `:286`, the route doc-block at `:30-45`, and the
`default:` resource list at `:310` — **all three, or the 404 lies**).

**Contract.** `GET ?resource=agents[&id=]`, `POST/PUT/DELETE`, `POST …&action=pause|resume|tick|post`.
The token identity model and `publicRow` are unchanged. **A VA is a job**, so this resource
is a view over `?resource=jobs` filtered to `mode:"va"` — not a second store.

**Fail contract.** Unknown action → 400 with the list; a token without the role → the
existing refusal; **`tick` and `post` are writes** and must take the same claims the
scheduler takes, or the REST path becomes the bypass of the whole two-phase design.

### Commit 9 — docs · **cr-architect / whoever ships**

`docs/VIRTUAL-ADMINISTRATOR.md`, `docs/CONFLUENCE.md`, FEATURES, REST-API-RULES,
LISTENERS-AND-JOBS, RELEASE-NOTES, plus GOTCHAS + the skill changelog. Numbers drift fast —
quote the constants from `registry-limits.js`, never retype them.

---

## 5. Probes still open before code, each with its fallback

| # | Probe | Why it cannot be answered from the tree | Fallback that is itself a shipped feature |
|---|---|---|---|
| **P1** | **(F-415) JSM public comment as the app user** (§4b row 24, ASSUMED) — does a comment posted by the app's user appear on the portal, and **what is the exact property shape**? The app's own spec says `sd.public.comment: {internal:true}` (`sandbox-api-spec.js:279`); the plan says `sd.public.comment=false`. | Nothing in `src/` posts a portal-public comment today; the JSM surface is three request-type events and the internal flag. | **Internal notes only.** `replyPublic` is offered but saves refused with "public portal replies are not available on this site" until proven. The VA is still useful: internal notes, assign, transition, approval inbox. Run it on JT with `npm run test:jsm-assets` as the bed. |
| **P2** | **Confluence not-installed error text** (§4b row 19 names this as the remaining half of probe d). | The tree only has the *success* path (`test-hook.js:147` → 200 after `forge install -p Confluence`). | Map **anything** that is not a recognised auth/not-found/2xx to `confluence_unavailable` and show the install link. Being over-broad fails OPEN, which is the correct direction for a validator; refine when the text is captured. |
| **P3** | **`requestConfluence` from the CONSUMER** (probe d proved it from a **webtrigger**). A VA item and a queued Confluence post-function both run in the consumer. | Different runtime, different context; row 19's evidence does not cover it. | If it fails in the consumer, Confluence effects run **inline** in the post-function (deterministic comment PF already is) and the VA's Confluence powers are hidden with the reason. Cheap to settle: one line in the existing dev hook, driven from the consumer. |
| **P4** | **`servicedeskapi` from the LONG consumer.** Probe (e) proved desks/queues/queue-issues `asApp()` — from the probe surface. | Same class as P3; the sweep runs in a consumer. | **JQL intake only** (§3.16 row (e)'s fallback, already the plan's): each queue carries its own `jql`, read once at save time by the wizard (a resolver, where the call IS proven) and stored on the record. This is strictly more robust than a live queue read and should arguably be the design regardless. |

**Sequencing rule (§3.16), restated:** no code is built on a PROBE row before its verdict.
P1 blocks only the `replyPublic` audience arm; P2/P3 block only the Confluence half's error
semantics; P4 blocks only the queue-intake arm. **Commits 1–3 and 5 depend on none of them**
and should be cut first.

---

## 6. The two-phase speech contract and every §3.11 step-3 gate as a predicate

**The wall-clock floor is code, not a prompt.** A draft staged at `stagedAt` is eligible only
when `now - stagedAt >= minPostGapMinutes * 60_000` **and** the post phase runs on a *later*
scheduler tick than the one that staged it (`stagedTickId !== currentTickId`). Two
conditions, deliberately: the clock alone can be satisfied inside one long tick, and the tick
id alone can be satisfied by two ticks 30 seconds apart after a missed run.
Test names: `post.floor.BLOCK_same_tick` · `post.floor.BLOCK_inside_gap` ·
`post.floor.ALLOW_later_tick_past_gap`.

Gates in order — each a code check, each with a BLOCK and an ALLOW test. **Any gate failure
is written to `history` with its reason; nothing is silently swallowed.**

| # | Predicate | BLOCK test | ALLOW test |
|---|---|---|---|
| 1 | `!agent.status.paused && tickIndex >= status.shadowUntilTick && !killSwitchActive` | `gate.paused.BLOCK` · `gate.shadow.BLOCK_within_shadow_ticks` · `gate.killswitch.BLOCK` | `gate.shadow.ALLOW_after_shadow_ticks` |
| 2 | **freshness** — re-read the thread; `latestHumanCommentId === staged.baseline.lastCommentId` | `gate.freshness.BLOCK_new_human_comment` (draft dropped, item re-queued — **not** discarded) | `gate.freshness.ALLOW_unchanged_thread` |
| 3 | **other-writer quiet** — `now - lastNonUsWriteAt >= otherWriterQuietMinutes` | `gate.quiet.BLOCK_recent_other_writer` | `gate.quiet.ALLOW_past_quiet_window` |
| 4 | **anti-pile-up** — `!(weSpokeLastWithin(antiPileUpDays) && item.state !== "owed")` | `gate.pileup.BLOCK_we_spoke_last` | `gate.pileup.ALLOW_owed_overrides` |
| 5 | **audience (F-415)** — decided from the **request type + reporter BEFORE the post**, never inferred after. Public requires `powers.replyPublic && P1 && addresseeIsReporter`; the post goes through the **JSM comment API with `public:false` as the default**, `public:true` only when this gate says customer | `gate.audience.BLOCK_public_without_power` · `gate.audience.BLOCK_public_to_non_reporter` · `gate.audience.BLOCK_unknown_request_type` | `gate.audience.ALLOW_internal_default` · `gate.audience.ALLOW_public_to_reporter` |
| 6 | **caps (F-412)** — `capsThisHour < capsPerHour && capsToday < capsPerDay`; an owed item uses its OWN cap `owedPerHour` (default 12). **`owedUncapped` does not exist as a config option.** | `gate.caps.BLOCK_hour_exceeded` · `gate.caps.BLOCK_day_exceeded` · `gate.caps.BLOCK_owed_hour_exceeded` | `gate.caps.ALLOW_owed_within_owed_cap` |
| 7 | **write scope (F-410/F-411)** — `assertWriteScope(targetIssueKey, writeScope)`: the target issue's project is **resolved from a read**, never taken from the model's argument | `gate.scope.BLOCK_outside_write_scope` · `gate.scope.BLOCK_site_wide_write_refused_at_save` · `gate.scope.BLOCK_unresolvable_project` | `gate.scope.ALLOW_in_scope` |
| 8 | **write budget (F-425)** — `writesThisRun < maxWritesPerRun`. **ONE vocabulary**: `maxBulkTargets` is dropped; the VA record and the wizard use `maxWritesPerRun`, the field `scheduled-jobs.js:357` already clamps | `gate.writes.BLOCK_run_budget_exhausted` | `gate.writes.ALLOW_within_run_budget` |
| 9 | **voice lint** — `voiceLint(body, persona.voice).ok` | `gate.voice.BLOCK_bullet` · `BLOCK_em_dash` · `BLOCK_as_an_ai` · `BLOCK_banned_opener` · `BLOCK_method_leak` · `BLOCK_signoff` · `BLOCK_over_max_sentences` · `BLOCK_no_short_sentence` | `gate.voice.ALLOW_human_corpus_sample` |
| 10 | **post claim** — `claimRuleExecution(va_post:{agent}:{key}:{stagedAt}, failClosed:true)` | `gate.claim.BLOCK_redelivery_second_post` · `gate.claim.BLOCK_storage_fault` | `gate.claim.ALLOW_first_delivery` |
| 11 | **read-back (F-415)** — comment id present AND `jsdPublic` equals what gate 5 decided. **A mismatch is not a log line:** the comment is immediately **edited to internal** and an **ERROR receipt** is written. Never a silent success | `gate.readback.BLOCK_no_comment_id` (no effects row; item stays `staged`) · `gate.readback.BLOCK_jsdPublic_mismatch_edits_to_internal` | `gate.readback.ALLOW_verified` |

**Item-level gate, before any of these (F-414):** `item.attempts < 3`. A turn that stages
nothing (`endedBy:"prose"`) or a draft the lint rejects increments `attempts`; at 3 the item
**parks** with a receipt reason and stops consuming ticks.
Tests: `item.attempts.BLOCK_parked_at_three` · `item.attempts.ALLOW_second_attempt` ·
`item.attempts.INCREMENT_on_lint_reject` · `item.attempts.INCREMENT_on_staged_nothing`.

Gates 1–9 run **before** the write; 10 immediately before; 11 after. **The claim must come
after the cheap gates and before the write** — the gate-before-ticket lesson (F-359) is the
same shape, and the cap-before-side-effect rule (breaker lens 4) is the reason.

**Configuration writes have no gate because they have no path.** There is no action for
them. That is the guarantee (Law 2); a gate would imply a route.

---

## 7. §3.14's ten long-horizon laws → concrete mechanisms

| Law | Mechanism in 1.5 | Where it is proven |
|---|---|---|
| 1. No state in a conversation | Every task reads `va_item:*` / `va_memory` / `va_tick` at entry and writes back at exit; the model's context is rebuilt each turn from rows | `va-ledger.test.mjs` state machine; a "killed after the model call" fixture loses ≤ 1 item |
| 2. Bounded units | `maxRounds ≤ 8` (`agent-runner.js MAX_AGENT_ROUNDS`), `maxItemsPerTick ≤ 5`, tool results ≤ 12 KB (`agent-runner.js:109 TOOL_RESULT_MAX_CHARS`), page ≤ 60 KB, `compactIssue` (`agent-runner.js:41`), knowledge budgets (`registry-limits.js:339`) | offline clamp tests at both ends |
| 3. Claims before side effects | `job_claim` (`scheduled-jobs.js:295`) → `va_exec` → `va_post`, all FAIL_IF_EXISTS with TTL, posting fail-closed | gate 10's two BLOCK tests |
| 4. Fingerprints, not memory | `va_item.fingerprint` = `{updated, lastCommentId, lastCommentAuthor}` compared against a **fresh** read every sweep | `fingerprint-diff.test.mjs`: unchanged → skip, each field changed → candidate |
| 5. Two-phase speech with a wall-clock floor | §6's double condition (`stagedTickId` + `minPostGapMinutes`) | the three `post.floor.*` tests |
| 6. Effects recorded on read-back | `va_effect:{agent}:{invTs}` written **only** after gate 11 | gate 11 BLOCK test asserts **no** effects row |
| 7. Memory compacted, not truncated | 6 KB trigger → summarisation task → 8 KB cap. **A pinned `constraints[]` list is preserved verbatim BY CODE, not by prompt (F-423)**; `memory_note` is defanged + clamped at write time and the memory is injected in an ADVISORY fence | `memory.compact.PRESERVE_pinned_constraints_verbatim` — the pinned list is compared byte-for-byte, so the property is enforced, not sampled |
| 8. Every quiet failure is loud | `va_tick` **and** `va-post` receipts with `skipped[]+reasons` (F-421), `va_health:{agent}` as the banner's own counter (F-426), per-item `history[≤10]` + `attempts` (F-414), a solid red banner on `auth_dead` / model unreachable / 3 consecutive failed ticks, "last ran / next run" always rendered | a receipt test per skip reason; a UI case per banner |
| 9. Kill switches at three levels | tenant cancel epoch (existing) · per-agent `status.paused` · `shadowUntilTick` | `gate.killswitch.BLOCK`, `gate.paused.BLOCK`, `gate.shadow.BLOCK` |
| 10. Provider-agnostic long turns | `long-queue` / `long-consumer` (`manifest.yml:434-436`) via `LONG_QUEUE_ONLY_TASKS`; a turn where the model never calls a tool ends cleanly with the ledger written | a "model returns prose, no tool call" fixture ends `queued`, not `failed`, and writes a receipt |

---

## 8. What the breaker must attack first

The breaker runs in parallel with this FRAME over the plan text and **files from F-409**
(the ledger's last row is F-408). Reserve **F-409..F-439** for it so two appenders cannot
collide (the 1.2.0 lesson). Ranked, hardest first:

1. **The post gate's ORDER and its bypasses.** Can `run tick now` / `post now` (REST commit 8
   or the Agents tab) reach a post without gates 1–9? Can shadow mode be left early by an
   edit that resets `shadowUntilTick`? Does a config change re-arm shadow, as §3.11 promises?
2. **Scope-wrapped JQL escapes.** `ORDER BY`, an unbalanced quote, a trailing operator, a
   `project in (...)` the operator wrote themselves, a 10 KB clause. The wrapper is a string
   concatenation around untrusted operator text — this is the injection surface of the intake.
3. **JSM audience leaks.** The internal-note property shape (P1) is the only thing standing
   between an internal note and a customer-visible portal comment. What happens when the
   property write succeeds and the comment write succeeds but the read-back shows the wrong
   visibility? (Gate 11 must catch it — prove it does, and prove the comment is *not* deleted
   and re-posted, which would be a second visible event.)
4. **Ledger row growth and the KVS write rate.** 50 candidates swept, 5 items, 11 gates, an
   effects row and a receipt — count the KVS writes per tick against 4000/min/installation
   and against the 240 KiB/value ceiling on `va_memory` and `va_item.history`.
5. **Wizard JSON trust.** A model that returns a `field` the state machine does not know, an
   `options` array of 10,000, a project key that is a KVS key part, a persona name carrying
   `<<<`. Does anything reach KVS or a prompt without clamping after parsing?
6. **`confluence_unavailable` semantics.** Can "not installed" be confused with "the page does
   not exist" or "you cannot see it"? (The global rule: *a negative that authorises action
   must be proven*. A 404 from Confluence is not proof a page is absent.)
7. **Web-search identifier refusal coverage on the VA path.** F-395, F-400 and F-406 are
   **open and confirmed**; a VA with `webSearch` on inherits all three. Does a customer's
   issue key reach the search engine from a VA turn today?
8. **Memory compaction losing constraints.** The summariser is a model; the promise is
   "decisions verbatim". What does a 6 KB memory of 40 one-line decisions compact into?
9. **The `mode:"va"` blast radius.** Every `mode === "script"` / `=== "agent"` site that now
   sees a third value — does any of them fall through to the script arm and try to run
   `functions`?
10. **Knowledge and brake inheritance.** F-404 (knowledge never threaded), F-405 (silent
    skill skip), F-396 (brake not wired at every run site), F-402/F-403 (the write counter is
    Jira-only) all sit on the VA's path. Do they widen?

Also in scope from §8 "Open for the breaker" but **not 1.5 code** (the knowledge bake is 1.4
commit 14): leak-scanner blind spots, pack text as an injection vector, the Forge MCP terms,
licence attribution in the shipped bundle. File them against the bake, not against the VA.

---

## 8b. Design findings (F-410..F-426) → mechanism → owning commit

Filed by the 1.5 design breaker against the plan text, folded above as first-class
mechanisms. Every row has a BLOCK/ALLOW test name in the section named.

| F-id | Mechanism | Owning commit |
|---|---|---|
| F-410 | `scope.write` becomes gate 7, a code check; site-wide write refused at save; intake bounded to the read scope | 1 (`normalizeVa`) + 3 (gate) |
| F-411 | `assertWriteScope` — ONE home in `va-config.js`, used by the VA, the coder headless PF and listener agent runs; `writeScope:{projects[]}` context on `normalizeAllowedActions` / `createAgentActionDispatcher`; every write resolves its target's project from a READ | 4 (with the dispatcher half sequenced to **cr-rules-surgeon**) |
| F-412 | `owedUncapped` dropped; `owedPerHour` (default 12); anti-pile-up applies to owed items after N owed replies on one issue | 1 (shape) + 3 (gate 6) |
| F-413 | `va_item` 90-day TTL refreshed on touch + per-agent row cap with LRU parking | 2 |
| F-414 | `attempts` on every item (staged-nothing, lint-rejected); parks at 3 with a receipt reason | 2 (field) + 3 (the item-level gate) |
| F-415 | Audience decided from request type + reporter BEFORE the post; JSM comment API with `public:false` default; read-back verifies `jsdPublic`; mismatch → edit to internal + ERROR receipt | 3 (gates 5 and 11); probe **P1** |
| F-416 | Confluence validator degradation table (unavailable/auth/network → open unless strict; misconfig → block regardless) | 7 (table lives with the validator), client mapping in 6 |
| F-417 | The field guide is selected **ONCE per agent/tick** from the agent's config text, not per item, so the cached prefix is stable across rounds and items; per-item volatile text stays last | 3 (the item turn's prompt assembly) |
| F-418 | The bake **FAILS when `knowledge/denylist.local` is absent** | 1.4 commit 14 (the bake) — **not 1.5 code**, carried here so it is not lost |
| F-419 | The scanner reuses the runtime leak table, extracted to `src/shared/identifier-leak.js` — ONE home, so bare 24-hex ids are covered in the bake and at runtime (closes F-406's class in both) | 1.4 commit 14 + the F-406 fix, cut together |
| F-420 | Voice rules have ONE home: the `voice-rules` pack DATA tables. `voice-lint.js` reads them; the persona prompt and the wizard sample are RENDERED from them | 1 |
| F-421 | The post phase is its own `va-post` task enqueued by the planner, with its own tick receipt | 3 |
| F-422 | `va_exec` taken by the **CONSUMER** at the start of the item, FAIL_IF_EXISTS + failClosed, released on throw before side effects (the `git_delivery` shape after F-335/F-367) | 3 |
| F-423 | `memory_note` defanged + clamped at write time; `va_memory` injected in an ADVISORY fence (F-408 rule); compaction preserves pinned `constraints[]` verbatim **by code** | 2 |
| F-424 | Wizard validates `jql` by a dry `search` against the read scope bounded to 1 result; persona name length/charset clamped | 5 |
| F-425 | `maxBulkTargets` dropped; the VA record and the wizard use `maxWritesPerRun` — one brake vocabulary | 1 (shape) + 3 (gate 8) + 5 (wizard) |
| F-426 | `va_health:{agent}` is the banner's own counter row; never reconstructed by `query()` over TTL'd receipts | 2 (row) + 3 (writer) |

**Two rows are not 1.5 code.** F-418 and F-419 belong to the knowledge bake (1.4 commit 14);
they are listed so the bake's surgeon inherits them rather than rediscovering them.

---

## 9. Confidence, by section

- **§0 (what is true in the tree) — HIGH.** Every row grepped on `3db6638`. The two that
  would most change the plan if wrong are the manifest scopes (read directly from
  `manifest.yml:488-491`, `:559-563`) and the already-reserved namespaces
  (`agent-actions.js:127-140`).
- **§1–§2 (homes and reuse) — HIGH**, with one exception: **the nested `api.confluence.*`
  spec shape — MEDIUM.** `SANDBOX_API_METHODS` is flat and four derivations read `name`
  directly; I am confident a `members[]` row is the right shape and NOT confident it is a
  small change. **What would settle it:** the sandbox surgeon reading all four derivation
  sites (`KNOWN_API_MEMBERS`, completions, hover, the API-reference panel) end to end and
  saying whether expansion is four edits or fourteen.
- **§3 (manifest delta) — HIGH** on the three scopes and on "major version". **MEDIUM** on
  whether the condition branch (commit 7) needs a manifest edit at all: the expression lives
  in `manifest.yml`, so **any** branch is a manifest change and therefore a coordinator
  decision. It must be folded into commit 6's single bump or the release takes two.
- **§4 (commit list) — HIGH** on files, contracts and surgeons. **MEDIUM** on commit 3's size:
  `mode:"va"` touches `scheduled-jobs.js`, `async-handler.js`, `ai-budget.js` and three UI
  apps, and I may be under-counting the `mode ===` sites in `static/`.
- **§5 (probes) — HIGH** that the four are genuinely open and that each fallback is a shipped
  feature rather than a gap. **P4's fallback (JQL-from-the-queue read at save time) is
  arguably better than the probed design** and I flag it as a recommendation, not a fallback.
- **§6 (gates) — HIGH** on the predicates and the BLOCK/ALLOW naming. **MEDIUM on gate 5**:
  it depends on P1, and the plan's `sd.public.comment=false` contradicts the app's own spec
  at `sandbox-api-spec.js:279`. **Do not transcribe the plan here — probe it.**
- **§7 (long-horizon laws) — HIGH** on mechanisms 1–6 and 9–10. **LOW on 7 (compaction).**
  "Preserve decisions verbatim" is a judgement asked of a model and enforced by nothing in
  code; a fixture test proves one case, not the property. This is the part of 1.5 I am least
  confident will behave as promised, and the honest mitigation is that the memory is
  admin-editable and capped, not that the compaction is correct.
- **§8b (the seventeen design findings) — HIGH** that each is now a mechanism with a test
  name rather than an invariant in prose. **MEDIUM on F-411's blast radius**: giving
  `createAgentActionDispatcher` a `writeScope` context touches the coder headless PF and
  listener agent runs as well as the VA, which is three callers and the arity trap
  (GOTCHAS 3) all over again — grep every call site in the same cut, and make the context
  required or default it to the most restrictive value, never the most permissive.
- **§8 (breaker targets) — HIGH** on the ranking. Items 1, 2 and 3 are where an actual
  customer-visible incident lives; 4 is where a silent platform limit lives.
