# FRAME — Release 1.4 "Coder", commits 1–7

Architect's FRAME (cr-architect). **No production code is proposed here.** This document
names, for each of the first seven commits of §6 "1.4", the single home of every new rule,
the existing homes it must reuse, the files and the surgeon who owns them, the manifest
debt, the probe dependencies, the fail-open/fail-closed decision per surface, the offline
suites that must exist before anything goes live, and the BREAK lenses to run.

Sources: the approved plan `~/.claude/plans/i-need-you-to-cached-sphinx.md` (§1 decisions,
§2.1–2.5, §3.3–3.9, §3.16, §3.17, §5, §5b/§5c, §6, §8) and
`.claude/skills/cognirunner-development/SKILL.md` (laws, roster, THE TICK).
Repo state read: `main` @ `7d4ab3c`.

---

## 0. What is already true in the tree (read, not assumed)

These are the load-bearing facts the plan is now older than. Every one was grepped.

| Fact | Where | Consequence for 1.4 |
|---|---|---|
| `agentCapability()` already exists and is the ONE agent gate | `src/shared/edition.js:190` (arg is `allowanceLevel`, **not** `allowance` as §3.1 writes it) | Commit 3 wires it. Do not re-spell the argument. |
| `requireAdvanced(context, featureId)` + `upgradeRequired(featureId)` are the ONE resolver refusal for a Coder-only feature | `src/index.js:668` / `:651` | §3.1's "`requireAgentCapability`" **does not exist**. It is the one genuinely new gate helper and it belongs beside these two, reusing `upgradeRequired`'s shape — never a new refusal object. |
| `permissionDenied` / `noPerm` / `needRole` / `notAuthorized` are the ONE permission refusal, carrying `reason:"no-permission"` (F-242) | `src/index.js:487-499` | Every new Code-tab / connection / pipeline resolver refuses through these. A hand-built `{success:false,error}` is a finding. |
| The edition ladder is ONE function with a `{fresh:true}` option for the consumer | `src/index.js:605 currentEdition` | The long consumer must call it with `{fresh:true}`, like `async-handler.js` does. No second ladder. |
| `PROVIDERS` has **seven** ids today incl. `bedrock` | `src/index.js:10086`; ids mirrored in `src/shared/provider-slots.js:20` | Adding `managed` touches BOTH, plus `METER_PROVIDERS` (`src/shared/usage-meter.js:22`). Three lists, one lockstep test already asserts two of them. |
| The agent-model slot already exists | `providerAgentModelSlot` (`provider-slots.js:25`), `getAgentModel()` (`index.js:11957`), resolvers `getAgentModel`/`saveAgentModel` (`index.js:5377`, `:5402`) | Commit 1 extends, never re-creates. |
| The token governor is shipped and live | pure maths `src/shared/ai-budget.js`; ledger `src/index.js:10661-10760` (`budgetBucketKey`, `bumpAiBudgetBucket`, `learnRuleCost`, `aiBudgetSnapshot`, `aiBudgetGate`); consumer gate `src/async-handler.js:1181-1265` | §3.17: **extend, never fork.** Any new surface is a queued task and inherits the gate. |
| `forgeLlmBillingClamp` is ONE home used by the sync adapter and the consumer | `src/index.js:10744`-ish (search "THE Forge LLM billing clamp") | The managed provider must NOT go through it (it is not vendor-Forge-billed); it goes through the monthly allowance only. Say so in the comment or the next reader will add a second clamp. |
| `AGENT_ACTIONS` is 14 actions, `normalizeAllowedActions(ids)` is **arity 1** | `src/shared/agent-actions.js:36,120` | §3.5 changes the arity to `(ids, ctx)`. GOTCHAS trap 3 (the arity gap) is exactly this shape — every call site must be grepped in the same commit. |
| `JIRA_EVENTS` rows have **no `source` field**, and `test-harness/scripts/jira-events.test.mjs` locks every id to a `trigger` in `manifest.yml` | `src/shared/jira-events.js:56-74`, `:76` | Git events have no Forge trigger. Commit 5 must teach the lockstep test to exempt `source:"git"` **in the same commit that adds the rows**, or the offline suite fails and someone "fixes" it by deleting the assertion. |
| Listener brakes exist; `ignoreSelf` + `selfGenerated` exist | `src/listeners.js:70-74, 136, 267, 325-330` | Git `ignoreSelf` is a DIFFERENT predicate (actor = our `whoami` login, not Forge's `selfGenerated`). Two ideas, one field name — name them apart. |
| `git-scaffolds.js` (751 lines, `SCAFFOLD_VERSION 1`, `renderScaffold`, `buildPermissionLock`) exists and is **imported by nothing in `src/`** | `src/shared/git-scaffolds.js`; consumer is `test-harness/scripts/render-scaffold.mjs --check` | Commit 7 is its first production consumer. The parity gate must keep running. |
| The webhook endpoint that exists is the **probe**, unauthenticated by design | `src/test-hook.js:410 gitWebhookProbe`, manifest webtrigger `git-webhook-probe` | The production webhook is a NEW webtrigger. Do not promote the probe — it stores no payload and has no per-repo secret path. |
| `manifest.yml` already carries `editionsEnabled: true`, `compatibility.confluence.required: false`, `read:servicedesk-request` and the three Confluence read scopes | `manifest.yml:457-464`, `:402-406` | §5c is stale: 1.3 commit 7 has landed. **1.4 needs no new scopes** for commits 1–7. |

---

## 1. The manifest debt — ONE major bump, listed once

Every item below is a manifest change, which means a major version and
`forge install --upgrade` on every site. **They are batched into a single commit** (call it
1.4 commit 2b, landing with commit 2, because the egress is what makes commit 1 testable
live). The coordinator, not a surgeon, decides when it is cut; the owner clicks the
upgrade.

1. **Egress, `external.fetch.backend` only** (the git calls are backend `fetch`, never from
   a Custom UI iframe — do not add these to `client`):
   - `https://api.github.com`
   - `https://api.bitbucket.org`
   - `https://bitbucket.org` — **conditional on probe (j)**. Bitbucket's `diff`/`src`
     endpoints are documented to 302 to a different host; if they do, this is required and
     if they do not, it must not be added. Fallback per §3.16(j) is to add it.
2. **Webtrigger `git-webhook` + `function gitWebhookFn`** (production; separate from the
   existing `git-webhook-probe`). 55 s budget, but the handler verifies and enqueues only.
3. **Consumer `long-consumer`** — `queue: long-queue`, `function: long-ai-handler`,
   `timeoutSeconds: 900` on the function entry. Needed by commit 8 (coder turns), declared
   now so the bump happens once.
4. **`jira:issuePanel coder-panel`** on the existing `issue-glance-resource` (fact 14 of
   §4b: one resource may back several modules). Needed by commit 9, declared now.

Nothing else. No scopes. No `client` egress. If a surgeon believes a fifth manifest change
is required, that is a STOP and a coordinator decision, not a diff.

---

## 2. Commit-by-commit FRAME

### Commit 1 — Providers (`managed` / "CogniRunner Cloud AI") + tests

**Cause being addressed:** the Coder edition promises frontier models, and Forge LLM
provably cannot carry an agent turn (probe (f): 50,000 tokens/minute **per model per
installation**, one coder round ≈ 40k). The engine therefore has to be a LeanZero-managed
Anthropic key, and a new provider id is the smallest correct shape because the Anthropic
adapter already exists.

**Single home of the new rule:** the provider id `managed` and its behaviour live in
`PROVIDERS` (`src/index.js:10086`) and `PROVIDER_IDS` (`src/shared/provider-slots.js:20`)
— the same two homes every other provider uses, kept in lockstep by the existing offline
assertion. The key itself lives in **one** place and is never a fourth home: an encrypted
Forge environment variable (`COGNIRUNNER_MANAGED_ANTHROPIC_KEY`), read only inside
`getOpenAIKey`'s `managed` arm. It is never written to KVS, never returned by a resolver,
never logged.

**Existing homes it must reuse, not duplicate:**
- `callAnthropicChat` (`index.js`, dispatched from `callAIChatRaw:10760`) — the managed arm
  sets `baseUrl`/auth and otherwise reuses it verbatim.
- `getProviderConfig()` 30 s memo — the edition/allowance read for the managed gate rides
  it; no new KVS read inside a transition race (§3.1).
- `recordAiUsage` (`index.js:10636`) → `usage-meter.js`. Add `managed` to `METER_PROVIDERS`.
  **Costing**: `forgeLlmCostUsd` is Forge-LLM-only by design; managed spend needs its own
  rate row in `usage-meter.js` — the SAME table module, a sibling constant, not a second
  costing module.
- `AI_PLATFORM_TPM` / `AI_BUDGET_DEFAULT_TPM` in `src/shared/ai-budget.js` gain a `managed`
  row. Probe (f) already forces `AI_PLATFORM_TPM.atlassian` to become **per model**; that
  reshape lands here, in the one governor, with the `managed` row, so the shape changes
  once.
- `agentCapability()` — unchanged. `provider !== "atlassian"` already returns
  `{enabled:true, reason:"byok"}`, which is the correct answer for `managed` too; the
  *offer* of the managed provider is edition-gated in the picker, not in the predicate.
- `forgeLlmBillingClamp` — explicitly NOT on this path. Add the sentence to its docblock.

**Files · surgeon:** `src/index.js` (PROVIDERS, key read, dispatch), `src/shared/provider-slots.js`,
`src/shared/usage-meter.js`, `src/shared/ai-budget.js` — **cr-backend-surgeon**, alone,
sequentially (all four are its territory and `index.js` is single-writer).

**Manifest:** none. `api.anthropic.com` is already allow-listed in both client and backend.

**Probe dependency:** **(g) managed key end to end — UNPROVEN, owner owes an Anthropic
key.** Per §3.16 the fallback is a shipped feature, not a dropped one: if (g) never lands,
**Coder ships BYOK-only** — the edition still sells frontier models for rules plus the
allowance, and the agent surfaces run on the tenant's own provider. Concretely, what ships
without (g): everything in commits 2–7 (they are provider-agnostic), plus the `managed`
row itself **not offered in the picker**. What must NOT be built before (g) returns:
`cache_control` prefix handling, the `managed` TPM numbers (they come from LeanZero's real
Anthropic tier), and the monthly-allowance meter's managed arm.

**Fail-open / fail-closed, per surface:**
- Provider read faults → `callAIChatRaw` already refuses with `ok:false` (F-115), which
  keeps validators failing **OPEN**. Unchanged — the managed arm must not throw.
- Missing/blank managed variable → treat as **provider misconfigured**, the same
  `ok:false` shape. A validator on `managed` then fails **OPEN**; a listener AI condition
  fails **CLOSED** (the run is skipped); a post-function step reports `status:"failed"`.
  Those three are `LAW 3` and none of them changes here.
- The key must never appear in an error string. A 401 from Anthropic renders as
  "CogniRunner Cloud AI is unavailable", never the upstream body.

**Offline suites required before live:**
`provider-lockstep` (extend the existing assertion: `PROVIDERS` keys ≡ `PROVIDER_IDS` ≡
`METER_PROVIDERS`) · `ai-budget.test.mjs` extended for the per-model `atlassian` bucket and
the `managed` row · a managed-adapter test on mocked fetch proving (i) no key → `ok:false`
and no throw, (ii) the key never appears in the returned error, (iii) usage is metered into
the minute bucket.

**BREAK lenses:** 2 (the failing path — every new refusal direction), 4 (caps/clamps —
the per-model TPM reshape is a clamp change), 5 (one-rule — three provider lists), 6 (the
boundary — `ai-budget.js` must stay dependency-free; it bundles into the admin panel).

---

### Commit 2 — Connections, Forge deploy identity, the security model, egress

**Cause:** a Git connection is a long-lived credential that both a human and a model can
reach. The red team's finding (§8) was that a pipeline setup driven by the model lets a
collaborator install arbitrary scopes. The cause is not "the model is dangerous"; it is
that **setup and execution were one surface**. They must be two.

**Single home of the new rules:**
- The provider interface and its adapters: **`src/git-providers.js`** (new) —
  `whoami … getPullRequestState, getBuildState, createWebhook, setSecret, setVariable,
  enablePipelines, triggerDeploy, getDeployStatus`, one `GitProviderError` with
  `auth_dead`, writes never retried, 10 s per call, diff caps. GitHub and Bitbucket
  differences live **inside the adapter**, never at a call site.
- Connection records, token storage, per-repo webhook secrets, rotation: KVS rows
  `git_conn:{id}` / `git_repo:{id}` with the key names declared in **one** place. Put the
  key-name builders in `src/shared/git-slots.js` for the same reason
  `provider-slots.js` exists (the test hook and the offline harness cannot import the Forge
  runtime).
- `COGNIRUNNER_FORGE_IDENTITY` — write-only, behind an admin consent screen, never echoed.

**Existing homes it must reuse:**
- `requireAdmin` + `noPerm(...,"admin")` for every connection/identity/pipeline resolver.
  **There is no second permission helper.** `canActOnConfig` / `requireRole("editor")` is
  the right gate for reading a connection's *status*, never for its token.
- `okOr(...)` wrapper used by the API-token resolvers (`index.js:10086` region) — same
  result shape.
- The rotation job goes on the **existing** `async-ai-queue` with an existing task type
  pattern, not a new consumer (§8: "rotation in a resolver" was the finding).
- The dead-credential banner is a **status field on the connection row** read by the UI —
  not a second error channel.

**Files · surgeon:** `src/git-providers.js`, `src/shared/git-slots.js` — **cr-backend-surgeon**.
The resolvers land in `src/index.js` — same surgeon, same commit, because two writers in
`index.js` is prime directive 1.

**Manifest:** the batched bump (§1 items 1 and, for scheduling convenience, 2–4).

**Probes:** (c) VERIFIED for GitHub 2026-09-12 (HMAC over the verbatim webtrigger body,
8,008 bytes, `timingSafeEqual` VALID). **(h) `forge register -y` headless and (i)
`GITHUB_TOKEN` setting repo variables are UNPROVEN — the owner owes a scoped Atlassian API
token; (j) Bitbucket is UNPROVEN — the owner owes a workspace + token.** What ships
without them: the whole connection layer, `Test` (`whoami` + capability probe), token
storage, rotation and the dead-credential banner — none of those depend on h/i/j. The
**GitHub adapter** ships; the **Bitbucket adapter is commit 15** and stays unbuilt until
(j) returns, exactly per the plan's sequencing rule ("no code is built on a PROBE row
before its verdict"). `bitbucket.org` is added to egress only if (j) says the redirect is
real.

**Fail-open / fail-closed:**
- A dead token is **loud, never silent**: `auth_dead` sets the connection status, raises
  the red banner and is the input to the validators' `strict` option (commit 10). §8's
  "dead token = gate silently gone" is the finding this closes.
- Credential reads that fault: refuse the operation (**fail CLOSED**) — a connection whose
  token cannot be read must never be treated as "no restriction".
- Pipeline setup refuses when the committed permission lock differs from the manifest
  being installed (**fail CLOSED**, and it is the whole point of the lock).
- Nothing here sits inside a workflow transition, so no fail-open contract moves.

**Offline suites:** `git-providers.test.mjs` on mocked fetch — every method's 200/401/403/
404/429/timeout mapping, `auth_dead` classification, "writes are never retried" asserted by
counting fetches, the 10 s per-call cap, diff caps. `git-slots.test.mjs` key-name lockstep.
A **secret-leak test**: force every error path and assert no token substring appears in any
returned message or `console` line.

**BREAK lenses:** all six, and this commit is the one where lens 2 and lens 4 matter most.
Specifically: can a 404 from a token that cannot see a repo be read as "the repo has no
webhook"? (The global CLAUDE.md rule — a negative that authorises action must be proven —
applies literally here.)

---

### Commit 3 — Agent-action gating (`normalizeAllowedActions` grows a context)

**Cause:** the app has ONE execution surface for agents and it currently answers only
"is this a known action id?". 1.4 adds actions that require a capability (`git`), a product
(`confluence`), a confirmation, or that are outright `dangerous` — and the red team's
finding was that an **externally triggered** run (a webhook, a listener) must never hold a
dangerous action even when a rule was saved with it.

**Single home:** `src/shared/agent-actions.js`. The namespaces (`git`, `confluence`, `web`,
`ledger`), the per-action flags (`requiresCapability`, `requiresProduct`, `confirm`,
`dangerous`) and the gate `normalizeAllowedActions(ids, {capability, products,
triggerSource, savedByRole})` all live there, dependency-free. **The gate is one function.**
The executors are separate modules by namespace (`src/git-actions.js` in this release;
`confluence-actions.js`, `web-search-tool.js`, `va-ledger.js` are 1.4 commit 13 / 1.5) and
`src/agent-runner.js` delegates by namespace — it must not grow a switch over action ids.

**The arity trap, named:** `normalizeAllowedActions` is arity-1 today and is called from
`toolDefinitionsFor`, `hasWriteActions` (both in the same file), the admin UI, the REST
validator and `agent-runner.js`. GOTCHAS trap 3 is precisely "a signature changed and one
call site kept the old shape". **The commit must grep every call site and update them all,
and the offline suite must assert the gate is never callable without a context** (make the
second argument required, or default it to the most restrictive context, never to the most
permissive).

**Reuses:** `AGENT_ACTIONS`' existing `kind` (read/write/control) and
`normalizeAgentIssueReferences` — the new flags are orthogonal to `kind`, not a replacement
for it. `agentCapability()` supplies `capability`. `requireAdvanced`/`upgradeRequired`
supply the SAVE-time refusal; **the same refusal sentence, not a new one.**

**F-088 is consumed here.** The 1.3 ledger scheduled F-088 ("`requireAdvanced` /
`agentCapability` / `getAgentModel` have no call sites — dead until 1.4") into exactly this
commit. It closes when `agentCapability` gates a save and a run, and `getAgentModel` feeds
a real turn.

**Files · surgeon:** `src/shared/agent-actions.js`, `src/agent-runner.js`, `src/git-actions.js`
— **cr-rules-surgeon** (its declared territory). The save-time gate in `src/index.js` and
`src/rules-api.js` — **cr-backend-surgeon**, in a second, sequenced cut. The two halves
share a contract (the exact field names of the context object and of the refusal); per the
skill's own trap, **the coordinator hands both surgeons the identical field list or runs
them in sequence.**

**Manifest:** none.

**Probes:** none blocking. (g) affects which provider drives the run, not the gate.

**Fail-open / fail-closed — this is the sharpest one in the release:**
- **Save time fails CLOSED**: a rule saved with a capability-off action is REFUSED with a
  reason, not silently stripped. A silent strip is how a user believes a gate exists.
- **Run time fails CLOSED**: `triggerSource` external → `dangerous` actions are dropped
  from the tool list before the model ever sees them; headless `confirm` actions require an
  admin-saved rule. Dropping is correct at run time because the alternative (refusing the
  whole run) turns a permission change into an outage.
- A listener **AI condition** upstream of any of this still fails CLOSED (Law 3), unchanged.
- Simulation mode is honoured by every namespace executor — a write in simulation is
  recorded, never performed. That is a guarantee, so it lives in code, in the executor, not
  in a prompt (Law 2).

**Offline suites:** `agent-actions-gate.test.mjs` — a BLOCK and an ALLOW case for **each**
flag (capability, product, confirm, dangerous, triggerSource, savedByRole); the arity guard
(no-context call is refused or maximally restrictive); `toolDefinitionsFor` never emits a
gated tool; `agent-reference.test.mjs` (existing) extended so the tool list and the docs
stay in lockstep.

**BREAK lenses:** 3 (blast radius — can an external trigger reach a write?), 2, 4, 5.

---

### Commit 4 — PR review engine (`src/git-review.js`)

**Cause:** a review is an at-least-once queued job that costs money and posts a public
comment. Without a claim taken **before** the model call, a redelivered queue event reviews
and comments twice.

**Single home:** `src/git-review.js` — the claim, the diff fetch + cap, the fence, the
clamps and the "skipped: already reviewed" report.

**Reuses:**
- `claimRuleExecution` (`src/shared/execution-claim.js`), used **fail-closed** here —
  opposite to the listener default. Its `failClosed` parameter already exists; this is the
  caller's choice, and the choice must be written in a comment next to it.
- `defangFence` (`src/memories.js`) + the `<<<MARKER>>>` convention for the diff. A diff is
  untrusted content — it is attacker-authored by definition on a public repo.
- The token governor: the review is a **queued task**, so `estimateTaskTokens` gains a
  `gitreview` case in `src/shared/ai-budget.js` and the run inherits the consumer gate.
  No second pacing mechanism.
- `parseAIJson` + server-side clamping after parsing (Law 2) for every model-emitted value
  (line numbers, severity, comment bodies).

**Files · surgeon:** `src/git-review.js`, `src/shared/ai-budget.js` (one case),
`src/async-handler.js` (one `TASK_HANDLERS` row) — **cr-sandbox-surgeon** owns
`async-handler.js` AI tasks; the review engine itself is closest to its territory. One
surgeon, one cut.

**Manifest:** none (the `long-consumer` is declared in the batched bump but a review fits
the 120 s consumer; put it there and say why).

**Probes:** (j) for Bitbucket inline comments — UNPROVEN. Ships without it: the **GitHub**
review with inline comments. Bitbucket reviews are commit 15; if (j) says inline `to` is
rejected, the documented fallback is a general comment carrying "(near line N)".

**Fail-open / fail-closed:** **CLOSED, everywhere.** No claim → no review. Claim storage
faults → no review (this is the inverse of `claimListenerRun`'s fail-open, and it is
deliberate: a duplicate public comment on a customer's PR is worse than a missing one). A
model failure ends the task with `status:"failed"` and a ledger row — **never** a "reviewed,
no findings" result, which is the post-function contract restated (a failed step must never
read as success).

**Offline suites:** `git-review.test.mjs` — redelivery of the same event produces exactly
one comment and one "skipped: already reviewed"; a 60 KB / 16 KB-per-file diff is truncated
with the truncation stated in the prompt; a diff containing a literal `<<<` fence token
cannot break out (defang); every model-emitted number is clamped; `auth_dead` mid-review
ends as `failed`, not `done`.

**BREAK lenses:** 1 (untrusted content — the diff), 2, 3 (how many comments can one
redelivery storm post?), 4.

---

### Commit 5 — Git events → webhook → queue → `cognirunner.git` property

**Cause:** a second event catalogue is the exact defect this repo is named for. The red
team already found it ("second event catalogue breaks project filters"). Git events must be
rows in the ONE catalogue, with the fields that make the existing project filter honest.

**Single home:** `src/shared/jira-events.js` — new rows carrying `source:"git"`,
`projectScoped:false` and a required `repos` selector. The catalogue's `E()` helper gains
`source` (defaulting to `"jira"`) so no existing row changes meaning.

**The lockstep test is part of this commit, not after it.**
`test-harness/scripts/jira-events.test.mjs` asserts every `EVENT_IDS` entry appears under a
manifest `trigger`. Git events have no trigger. The test must learn: *`source:"git"` rows
are exempt from the manifest lockstep and must instead appear in the webhook's own event
map.* Without that edit in the same commit, the suite fails and the next person deletes an
assertion.

**Reuses:**
- The webhook handler **verifies and enqueues, and does nothing else** (GitHub abandons a
  delivery at 10 s; the webtrigger has 55 s, which is irrelevant because the work is
  queued). HMAC verification mirrors `src/test-hook.js:410`'s proven construction —
  the *proof* is reused, the code is new and per-repo-secret-keyed.
- `ignoreSelf` via cached `whoami`. Name it apart from Forge's `selfGenerated`
  (`listeners.js:267`) — two different self-detections; one field name for both would be a
  new instance of the signature defect.
- The listener brakes (`BRAKE_MAX_PER_ISSUE 30` / `BRAKE_MAX_PER_LISTENER 120`,
  `listeners.js:73-74`) apply unchanged to a git-triggered listener run.
- The issue property `cognirunner.git` is written with the existing `api.setProperty` path.
- The premade listener "Review every opened PR" is a row in
  `src/shared/premade-rules-catalog.js`, and `npm run test:parity` is the gate that keeps
  the catalog and the executor agreeing.

**The property is ADVISORY.** It is forgeable by anyone with Browse + the app's write path;
validators verify live (commit 10). Write that sentence next to the property write and next
to every reader.

**Files · surgeon:** `src/shared/jira-events.js`, `src/listeners.js`,
`src/shared/premade-rules-catalog.js`, the new webhook handler (new file, e.g.
`src/git-webhook.js`), `test-harness/scripts/jira-events.test.mjs` —
**cr-rules-surgeon**.

**Manifest:** the batched bump, item 2 (`git-webhook` webtrigger + function).

**Probes:** (c) **VERIFIED** for GitHub. For Bitbucket, §4b calls it the same construction
but Part 0b re-checks — so the Bitbucket webhook path is commit 15. Ships without (j):
GitHub events end to end.

**Fail-open / fail-closed:** the webhook **fails CLOSED on verification** — a bad or
missing signature is a 401 and nothing is enqueued, no ledger row, no log line carrying the
body. A verified delivery whose enqueue fails returns non-2xx so the provider retries.
Downstream, a git-triggered listener run's AI condition fails **CLOSED** like every other
listener (Law 3). The property write failing is best-effort and **must not** fail the run —
it is advisory.

**Offline suites:** `git-events.test.mjs` — catalogue/manifest lockstep with the `source`
exemption; a wrong signature is refused; a replayed delivery id is deduplicated;
`ignoreSelf` drops our own bot's push; the `repos` selector is required and a row without
it is refused at save. Plus the existing `test:parity` for the premade listener.

**BREAK lenses:** 1 (webhook payloads are untrusted, attacker-shaped), 2, 3 (a push storm;
can a git event trigger a listener whose action pushes?), 5 (the catalogue).

---

### Commit 6 — Code tab, `AgentConfig`, `EventPicker`

**Cause:** three UI apps, and several components are byte-identical copies between
`config-ui` and `admin-panel` by contract. Every 1.4 UI rule (is Coder on? why not? which
provider? which model?) has exactly one correct answer and four places that could render
it differently.

**Single home:** the *answer* is backend-side — one resolver (`getAgentCapability` or the
existing `checkLicense`, extended) returning `{enabled, reason, provider, edition,
agentModel}` straight from `agentCapability()`. **The UI never re-derives the predicate**,
and it never derives a permission from the module type (the F-210/F-213 lesson, already in
the skill). The *sentence* for each `reason` (`needs-coder-edition`,
`needs-frontier-model`, `allowance-exhausted`, `byok`, `forge-frontier`) lives in one
map — put it in `src/shared/edition.js` beside the predicate so backend and all three
frontends read the same words.

**Reuses:** `CustomSelect` (deliberately diverged — **never blind-copy**), the app's own
dialog primitive, `injectStyles()` in each `App.js` as the live CSS source,
`injectCopiedComponentStyles()` in admin-panel. `EventPicker.jsx` renders the git category
from `EVENT_CATEGORIES` — it must not hardcode a git row.

**Files · surgeon:** `static/admin-panel/src/components/{CodeTab,AgentConfig,EventPicker}.jsx`,
`static/config-ui/src/components/...`, both `App.js` style injectors —
**cr-ui-surgeon**, alone. `AgentConfig.jsx` and `EventPicker.jsx` are on the `diff -q` list;
`PremadeRuleForm.jsx` joins it in this release (§3.13). Copy → `diff -q` → rebuild BOTH
apps → commit bundles with source.

**Manifest:** none (the issuePanel is in the batched bump for commit 9).

**Probes:** none. The tab renders the (g) fallback correctly by construction because it
renders whatever `agentCapability` answers.

**Fail-open / fail-closed:** the UI **fails to the restrictive side**: if the capability
resolver errors, the Code tab shows the disabled state with "could not check" — never an
enabled control whose every write the backend refuses (F-233's lesson: a write control the
backend refuses is a defect, and a refusal told as an outage is a second one). The refusal
sentence comes from the backend's `reason`, so the UI cannot invent a different story.

**Offline suites:** `css-parity.test.mjs` (exists) extended for the new hues — git
`#a21caf`/`#c026d3`, with a dark override for each; `diff -q` on every duplicated
component as a scripted check, not a habit; a screenshot/visual-harness case for each of
the four capability states (Standard+Forge LLM, Coder+Haiku, Coder+Sonnet 5, Standard+BYOK)
— and remember a suite reporting 0/0 has SKIPPED, not passed.

**BREAK lenses:** 5 (duplication drift), 6 (no `eval`/`new Function` in the iframe; every
`.jsx` with JSX imports React — classic runtime), plus Law 6 (no rails, no faded tints, no
native controls).

---

### Commit 7 — Scaffolds + pipeline setup

**Cause:** a Forge app cannot deploy a Forge app, so CogniRunner installs a pipeline in the
customer's repo under a customer-supplied Forge identity. The red-team finding is that this
lets a collaborator install arbitrary scopes — so the rule is **the pipeline refuses to
install when the manifest's permissions differ from the committed lock**, and setup is an
**admin resolver, never an agent action**.

**Single home:** `src/shared/git-scaffolds.js` — already written, already dependency-free,
already YAML-as-line-arrays (never template literals), already with `buildPermissionLock`.
This commit makes `src/index.js` its first production consumer. The parity gate
`test-harness/scripts/render-scaffold.mjs --check` stays in the offline run.

**Reuses:** `requireAdmin` + `noPerm` for the setup resolver; the connection layer from
commit 2 for `setSecret` / `setVariable` / `enablePipelines`; the agent-action gate from
commit 3 to guarantee **no agent action can call pipeline setup** — the agent may only
*trigger* an allow-listed repo's existing pipeline.

**Files · surgeon:** `src/index.js` (the admin resolvers, the consent screen's backend
half), `src/shared/git-scaffolds.js` (only if a scaffold needs a field) —
**cr-backend-surgeon**. The consent screen UI is **cr-ui-surgeon**, sequenced after.

**Manifest:** none beyond the batched bump.

**Probes:** **(h) `forge register -y` headless — UNPROVEN. (i) `GITHUB_TOKEN` sets repo
variables — UNPROVEN.** Both wait on the owner's scoped Atlassian API token. §3.16 says
what ships without them, and it is a feature, not a gap: the pipeline ships with a
documented **"register locally once"** step shown in the Code tab (fallback for h), and the
app id stored as a **secret** instead of a variable (fallback for i). Build the scaffold
and the setup flow to that fallback shape now; if (h)/(i) come back yes, the zero-touch path
is a later, smaller cut. **Do not build the zero-touch path first.**

**Fail-open / fail-closed:** **CLOSED at every step.** Permission-lock mismatch → refuse and
say which permission differs. Identity missing or unreadable → refuse. Development-only
installs are enforced in the rendered workflow, not asked of the user. A partially
completed setup must be reported as partial with the exact step that failed — never as
"pipeline ready".

**Offline suites:** `render-scaffold.mjs --check` (exists, keep it in `test:offline`);
`permission-lock.test.mjs` — a manifest with an added scope fails the lock, an identical
manifest passes, a reordered-but-equivalent manifest passes (or is refused deliberately —
decide and test the decision); `pipeline-setup.test.mjs` on mocked fetch proving the
refusal happens **before** any secret is written (the `commitImportCore` lesson: a refused
operation must leave nothing live).

**BREAK lenses:** 2, 3, 4 (the cap-before-side-effect rule), and lens 1 on the scaffold
variables — a repo name is user-supplied text that ends up inside YAML.

---

## 3. What 1.4 must consume from the 1.3 ledger

| Row | 1.3 status | What 1.4 owes it |
|---|---|---|
| **F-088** — `requireAdvanced` / `agentCapability` / `getAgentModel` have no call sites | **scheduled into 1.4 commit 3** | Commit 3 is the named mechanism. It closes when the gate refuses a save AND drops a tool at run time, both with tests. If commit 3 lands without wiring `getAgentModel` into a real turn, F-088 stays open and must be re-stated, not quietly marked fixed. |
| **F-095** — four edition WRITE gates read the snapshot-backed `currentEdition()` instead of the invocation's own licence | **parked**: needs a lapsed-subscription probe nobody can stage on demand; exposure bounded by the 2-day snapshot TTL | 1.4 **must not widen it**. Every NEW gate (managed-provider offer, Code tab, pipeline setup, agent save) uses `requireAdvanced(context, …)` — the invocation-first ladder — so the parked set does not grow. Re-probe trigger stays: the first real lapse, or proof that `forge install --license standard` over an advanced install flips the resolver context. |
| **F-239** — `bootstrapFirstAdmin`'s read-modify-write is not serialised | **parked**: needs a KVS transaction the platform does not offer | 1.4 adds admin-gated resolvers (connections, identity, pipeline) that all run **after** the roster exists, so they inherit the window but do not widen it. The rule 1.4 must honour: **no new surface may call `checkIsAdmin` as a side-effectful probe.** |
| **F-251** — the workflow editor can now reach the first-admin bootstrap | **parked**, pending a product call by the owner alongside F-241 | The **Code tab and the issue panel are two more new surfaces that will call an admin check.** If they call `checkIsAdmin`, they inherit the roster write. The FRAME's position: commit 6 should use a **read-only** admin check for rendering, which is also the fix F-251 names. That makes 1.4 the release that closes F-251 rather than the one that triples it. |

---

## 4. Cross-cutting contract for all seven commits

- **One governor.** Every new AI surface is a queued task and passes through
  `aiBudgetGate` (`src/index.js:10748`) and the consumer gate
  (`src/async-handler.js:1181`). When the 900 s `long-consumer` arrives, the gate is
  **extracted into one function both consumer entry points call** — the second consumer
  differs only by `timeoutSeconds`. A second copy of the gate is the 2026-09-12 finding
  repeating itself.
- **Fan-out carries `concurrency: {key:"ai-budget", limit:2}` from the first push**, because
  the bucket's read-modify-write is not atomic.
- **One refusal shape.** `permissionDenied`/`noPerm` for permissions (with
  `reason:"no-permission"`); `upgradeRequired` for edition; `{agentDisabled:true, reason}`
  for capability. Three shapes, each with one home, and a frontend that knows none of them
  still renders `error`.
- **`node --check` is not a gate for `src/shared/*.js`** — `scripts/shared-imports.test.mjs`
  is. Every new shared module must appear in it.
- **The tester is a writer of the tree.** While cr-tester holds the checkout for
  `forge deploy`, surgeons run in a worktree or afterwards.
- **BREAK is mandatory** on every commit here: all seven touch writes, fences, secrets,
  webhooks, queues or permissions.

---

## 5. The three highest-risk decisions the coordinator must make before the first cut

**1. Does 1.4 build the managed provider at all, or ship BYOK-only?**
Probe (g) is UNPROVEN and blocked on an owner-supplied Anthropic key. Commit 1 is the only
one of the seven that depends on it. The plan's own sequencing rule forbids building on a
PROBE row before its verdict. The choice is: hold commit 1 and start at commit 2 (every
other commit is provider-agnostic), or build commit 1 to the BYOK-only fallback and add the
managed arm later. **Lowest-risk reading of the plan: start at commit 2, and let commit 1
land when the key does.** This is a scheduling decision with a real cost either way and it
is not a surgeon's to make.

**2. When is the single manifest bump cut, and who clicks the upgrade?**
Four manifest changes (egress ×2–3, `git-webhook`, `long-consumer`, `coder-panel`) must be
one major version and one `forge install --upgrade`. Cutting it early means commits 8–9 do
not force a second bump; cutting it early also means declaring an issuePanel and a consumer
that no code yet backs, on every installed site. The `bitbucket.org` egress line depends on
probe (j), which is UNPROVEN — so either the bump waits for (j), or `bitbucket.org` is
omitted now and (j) coming back "yes" forces a **second** major bump. I flag this as the
decision I am least confident about, because both branches have a cost the plan does not
price.

**3. Does commit 6 close F-251, or inherit it?**
The Code tab and (later) the issue panel are two new surfaces that need an admin answer.
`checkIsAdmin` today can WRITE the admin roster through `bootstrapFirstAdmin`. Deciding now
that rendering uses a **read-only** admin check turns F-251 from a parked row into a closed
one and stops the pattern spreading to two more apps; deciding later means three surfaces
share a parked defect. It is a product call (the owner's, per the F-251 row) and it must be
made before the UI surgeon starts, not after.

---

## 6. Where I am least confident

- **The `bitbucket.org` egress question** (decision 3 above) — I could not settle it from
  the code or the docs; only probe (j) settles it, and it is owner-blocked.
- **Whether `estimateTaskTokens` can usefully estimate a coder turn or a PR review.** The
  learned per-rule cost (`ai_cost:<ruleId>`) works because a rule is repetitive; a coder
  turn is not. The plan says key it per agent too. I believe the first estimate will be
  badly wrong and the governor will either over-defer or overshoot the minute. What would
  settle it: one live coder-shaped turn's measured token count on staging, which is (g)-blocked.
- **The `source:"git"` exemption in the event-catalogue lockstep test.** I am confident it is
  needed; I am not confident the test's current structure makes the exemption expressible
  without weakening the Jira assertion. The surgeon should read
  `test-harness/scripts/jira-events.test.mjs` in full before touching `jira-events.js`.
