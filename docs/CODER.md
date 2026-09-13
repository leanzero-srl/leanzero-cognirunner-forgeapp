<!--
 CogniRunner - AI-powered workflow validation for Jira
 Copyright (C) 2025 LeanZero
 SPDX-License-Identifier: Apache-2.0
-->

# The Coder

The Coder is the agent half of the CogniRunner Coder edition: an in-issue coding chat, a
workflow post-function that hands a transition to that same engine, and the Git connection
layer both run on. This page describes what is on `main` and what a developer or an admin
sees. The Git side (connections in depth, the webhook, the nine git events, the PR-review
listener, the git validators and conditions, the pipeline setup) is in
[`GIT-INTEGRATION.md`](GIT-INTEGRATION.md). The 1.5 work (the Virtual Administrator and the
Confluence rules) is in progress and is not described here.

Everything below was read from the code, not from the plan. Where a claim names a file, the
file is the authority.

---

## Contents

1. [Editions and the capability rule](#1-editions-and-the-capability-rule)
2. [The Code tab](#2-the-code-tab)
3. [Connections and tokens](#3-connections-and-tokens)
4. [The issue panel](#4-the-issue-panel)
5. [The Coder post-function](#5-the-coder-post-function)
6. [What a turn writes on the issue](#6-what-a-turn-writes-on-the-issue)
7. [Knowledge the Coder reads](#7-knowledge-the-coder-reads)
8. [Limits and refusal reasons](#8-limits-and-refusal-reasons)
9. [What is vendor-billed on Forge LLM](#9-what-is-vendor-billed-on-forge-llm)
10. [Testing](#10-testing)

---

## 1. Editions and the capability rule

CogniRunner is sold as two Marketplace editions, decided in one module,
`src/shared/edition.js`. `Standard` is the app as it has always been. `Coder` is the
Marketplace *Advanced* edition (internal id `advanced`, `capabilitySet: capabilityAdvanced`).
The Coder feature list (`ADVANCED_FEATURES`) has two rows: the frontier Claude models on
Atlassian Forge LLM, and "the Coder toolset (in-issue coding chat, GitHub & Bitbucket,
pipelines, Git-aware rules)".

Whether the agent surfaces may run is answered by exactly one predicate,
`agentCapability({ provider, edition, agentModel, allowanceLevel })`, in that order:

| Situation | Verdict | `reason` |
|---|---|---|
| Any BYOK provider (OpenAI, Azure, OpenRouter, Anthropic, Bedrock, LM Studio) | enabled | `byok` |
| Forge LLM on Standard | refused | `needs-coder-edition` |
| Forge LLM, agent model not `claude-sonnet-5` / `claude-opus-5` | refused | `needs-frontier-model` |
| Forge LLM, monthly allowance at its hard cap | refused | `allowance-exhausted` |
| Forge LLM, Coder, frontier agent model, allowance not exhausted | enabled | `forge-frontier` |

So on a BYOK provider the Coder is on for every edition: the tenant pays its own tokens and
the app does not judge the model or the edition. Only the vendor-billed Forge LLM provider
is gated, and there it needs both the Coder edition and a frontier agent model (Haiku never
drives an agent).

The sentence for each reason lives next to the predicate (`AGENT_CAPABILITY_REASONS`), so
the admin panel's Code tab, the agent action checklist, the issue panel and the backend's
own refusal all say the same thing. There is one extra row, `unknown`, that the predicate
never returns: it is what a surface renders when the capability read itself failed
("Coder status could not be checked"). Every UI fails to the restrictive side: a read that
errors shows the off state, never an enabled control the backend would refuse.

The one door for a UI is the `getAgentCapability` resolver (viewer floor). It returns
`{ enabled, reason, provider, edition, agentModel, allowanceLevel }` from the same fact
reader the save-time and run-time action gates use (`agentGateFacts`). A provider that
could not be read is reported as `enabled: false, reason: "unknown"`; no frontend
re-derives the verdict from the edition.

Two refusals sit in front of every Coder resolver, and they are different shapes with
different remedies:

- `requireAdvanced(context, "coder")` answers "this site is not on the Coder edition" with
  the `upgradeRequired` shape: `{ success:false, upgradeRequired:true, featureId:"coder",
  edition, error }`.
- the capability verdict answers "the provider cannot drive an agent" with
  `{ success:false, agentDisabled:true, reason, error }`.

A frontend that knows neither shape still renders `error`.

## 2. The Code tab

Admin panel (Apps → CogniRunner) → **Code**. Every resolver behind it is `requireAdmin`; an
editor who opens it sees the access note and no controls. The tab shows three things.

**The Coder status card.** The `getAgentCapability` verdict rendered through the reason
table above, with the remedy sentence and, where there is one, a link to Settings.

**Git connections.** The list of connections (`listGitConnections`), each with its
provider kind, label, the login the credential answered with, its repository allow-list,
its status, and a red banner when the credential is dead. From here an admin can add a
connection (provider kind, label, token, the account email for Bitbucket, and the
repositories it may act on), **Test** it (`testGitConnection`: a live `whoami`, and the
verdict is recorded on the row), edit the allow-list (`setGitRepoAllowlist`), rotate its
token (`rotateGitCredential`, queued) and delete it (`deleteGitConnection`). The token
input is write-only: it starts empty, it is cleared after every write, and a stored
credential is shown as "SET", never as a value.

**The Forge deploy identity.** The customer's own Atlassian account email and API token,
used by the pipeline CogniRunner can install in a repository to deploy that customer's
Forge app. It is stored only when the admin ticks the consent sentence ("I am handing
CogniRunner an Atlassian API token that will deploy Forge apps as me, from pipelines in my
repositories, without asking again."); `saveForgeIdentity` refuses without
`consent: true`, and the accountId and the moment of consent are recorded with it.
`getForgeIdentityStatus` returns `{ hasIdentity, email, consent, rotation, createdAt,
updatedAt }` and nothing else. There is no read path for the token anywhere in the app.

Pipeline setup is not on this tab. It exists as admin resolvers (`setupGitPipeline`,
`getGitPipelineStatus`, `triggerGitDeploy`) and is described in
[`GIT-INTEGRATION.md`](GIT-INTEGRATION.md#7-pipeline-setup); no UI calls them yet.

## 3. Connections and tokens

A connection is one credential for one git host, with an admin-edited list of
repositories it may act on. The rules that matter for a developer using the Coder:

- The Coder can only touch a repository that appears on a connection's allow-list. An
  absent or empty allow-list allows nothing.
- The credential is verified with `whoami` before it is stored; a dead token is refused,
  never saved.
- Nobody, admin included, can read a stored token back. Every resolver return goes
  through an allow-list of fields (`publicConnection`), and the offline suite deep-scans
  every return for planted secrets.
- A credential that dies later is loud: any adapter call that answers `auth_dead` marks
  the row, the Code tab shows the banner, and the git validators' Strict option reads the
  same flag. A successful **Test** clears it.

The full model (caps, the storage keys, rotation, the security constants) is in
[`GIT-INTEGRATION.md`](GIT-INTEGRATION.md#1-connections).

## 4. The issue panel

The Coder is used from one place: the **CogniRunner Coder** issue panel
(`jira:issuePanel`, key `coder-panel`, in the `issue-glance` bundle). It talks to four
resolvers and nothing else:

| Resolver | Role | What it does |
|---|---|---|
| `getAgentCapability` | viewer | the verdict the card renders before anything is offered |
| `startCoderTurn` | editor | queues one turn on `long-queue`; returns `{ success, async:true, taskId, threadId }` |
| `getCoderThread` | editor, owner or admin | the thread record: `messages[]`, `turns`, `pendingTicketId` |
| `confirmCoderTicket` | editor, owner | answers a consent ticket and queues the resumed turn |

### The journey

1. **The capability card.** The panel asks `getAgentCapability` first. If the Coder is
   off, the card says why (the reason table in §1) and the composer is not offered. If the
   read did not answer, the card says "Coder status could not be checked" and offers a
   retry.
2. **The composer.** "Tell the Coder what to do on this issue", a **connection picker**
   ("Choose a connection"; editors see the connections' labels and repository lists through
   the editor view, never a credential's health), a **Dry run** toggle, and **Send**.
3. **A turn runs in the background.** `startCoderTurn` pushes a `coder` task to
   `long-queue`, the 900 s consumer, with concurrency keyed on the issue (limit 1). The
   panel polls `getAsyncTaskResult` every 3 s for up to 300 tries. A turn is up to eight
   rounds of the agent loop (`maxRounds` 1 to 8, default 6) inside an 840 s wall clock.
4. **The reply.** Assistant text is rendered as plain paragraphs. It is never HTML and
   never markdown: it is untrusted content that reached the panel through a fenced prompt.
5. **The consent chip.** Every repository write the Coder can make (`create_repo`,
   `create_branch`, `commit_files`, `open_pull_request`, `add_pr_comment`,
   `approve_pull_request`, `request_changes`, `trigger_deploy`) is a `confirm` action. When
   the model calls one, the turn stops, a `coder_ticket:<id>` row is written (24 h TTL),
   and the panel shows a chip naming the **action** and a **preview of its arguments**
   with three buttons: **Confirm**, **Change** (opens "What should change before it runs?"
   and **Send change**) and **Skip**. The preview is built from the action's own parameter
   schema, so every field the executor will act on is shown; long text inside an array
   item (a file's content) is replaced by its byte count. The ticket id is never shown.
6. **The decision.** `confirmCoderTicket` runs the confirmed step inline (one provider
   call inside the git executor's 10 s cap), records a `DECISION:` row in the thread
   ("the user CONFIRMED …", "the user SKIPPED …", "the user asked to CHANGE …"), and queues
   the follow-up turn on the same queue. A confirmed step also posts one "Coder step"
   comment on the issue (§6). Each ticket is answered exactly once
   (`coder_ticket_exec:<id>` claim); a second answer returns `duplicate: true`.
7. **Conversations.** A person's default thread on an issue is `p_<accountId suffix>`;
   **New conversation** mints a fresh `t_<timestamp>` thread. The switcher is a per-browser
   convenience (the backend lists nothing; it only reads a thread by id).

### Rules the engine enforces in code

- **One turn per issue.** `coder_exec:<issueKey>` is a `FAIL_IF_EXISTS` claim taken before
  anything is read or written and released on every exit. If it cannot be taken the turn
  does not run.
- **The thread has one owner.** A turn or a read on somebody else's thread is refused with
  the ownership refusal (`reason:"no-permission"`, `hint:"not-owner"`); an admin may read
  any thread.
- **Dry run is fixed by the first turn.** The thread row carries the `simulation` flag;
  a later turn asking for the opposite is refused with `reason:"simulation-locked"` rather
  than flipping the thread. The panel locks the toggle and says "This conversation runs as
  a dry run (or live run); start a new conversation to change it." In a dry run the git
  executor never builds a provider and never makes a call, and every workspace write
  answers `{ ok:true, simulated:true, would:{…} }`.
- **The resumed turn inherits the first.** `simulation`, `connectionId` and `maxRounds`
  are read from what the owner started the thread with, never from the confirm payload.
- **The gate runs again at confirm time.** Before a ticket is executed the action is
  re-checked against the instance's current capability and the confirming user's current
  role; a ticket that no longer passes is closed as refused, and nothing is performed.
- **Compaction, never truncation.** A thread is capped at 48 KB. When it grows past that,
  the first message, every `DECISION:` row and the most recent 12 messages are kept
  verbatim; everything else becomes one note naming how many messages were dropped and
  the issue keys and repositories they mentioned. Tool-call groups are kept or dropped
  whole.
- **The system prompt is a stable prefix** (PLAN → CONFIRM → EXECUTE, built from
  constants only), which is what makes prompt caching reachable on Anthropic (§9).

## 5. The Coder post-function

The premade post-function **Coder: build / open branch / open PR / fix / review**
(`postfunction-coder`, category Git) hands a transition to the same engine. It is always
queued and never runs inline: a coder job takes minutes and the workflow post-function
budget is 25 s, so the transition completes immediately and the Coder reports back on the
issue.

The rule's configuration is the git parameter group without `prMatch` (`connectionId`,
`repo`, `strict`), the **mode** picker, and an optional **instructions** box (up to 2048
characters, treated as untrusted text and fenced). The five modes, from
`CODER_PF_MODES` in `src/shared/premade-rules-catalog.js`:

| Mode | What the Coder is told | Actions it may hold |
|---|---|---|
| `build` | Read the issue, create a branch, commit the whole files it changed, open a pull request naming the issue key, post one comment. If the issue does not describe enough, say so and finish. | `get_issue`, `add_comment`, `create_branch`, `commit_files`, `open_pull_request`, `get_pull_request`, `get_build_state` |
| `open-branch` | Create one branch from the default branch whose name carries the issue key; write no code, open no pull request. | `get_issue`, `add_comment`, `create_branch` |
| `open-pr` | Find the branch that names the issue key, open a pull request into the default branch, commit nothing. | `get_issue`, `add_comment`, `open_pull_request`, `get_pull_request` |
| `fix` | Read the pull request and its build state, commit the smallest fix to the same branch, never to the default branch. If the build is passing, change nothing. | `get_issue`, `add_comment`, `get_pull_request`, `get_build_state`, `commit_files` |
| `review` | Leave one review comment on the pull request naming bugs, missing error handling, secrets and permission widening; never approve, never request changes. | `get_issue`, `add_comment`, `get_pull_request`, `get_build_state`, `add_pr_comment` |

A mode's action list is a ceiling, not a grant: it is intersected with the action gate's
verdict for the rule (§8). No mode names `approve_pull_request`, `request_changes` or
`trigger_deploy`, because those are `dangerous` and a post-function is an external,
headless trigger: the gate would drop them at run time whatever was saved.

**Headless means no tickets.** A post-function turn runs with `headless: true`. There is
nobody to answer a consent ticket, so a `confirm` action the gate allows executes directly,
and one the gate refused ends the turn with `endedBy:"halt"` and a `haltReason` naming the
action and the reason. A `confirm` action survives the gate on a headless surface only when
an **admin** saved the rule; the role is stamped on the registry row at save time.

**Fail open or closed, per cause.** A post-function runs after the transition, so it can
block nothing; "closed" means a red execution-log entry, "open" means a skip that says why.
The rule's `strict` flag chooses between them for environment problems only. Verbatim from
the table beside `enqueueCoderPostFunction` in `src/index.js`:

```
cause                                     strict OFF (default)     strict ON
───────────────────────────────────────── ──────────────────────── ─────────────────
git capability OFF on this instance        SKIP + the reason        ERROR + the reason
connection missing / token dead            SKIP + the reason        ERROR + the reason
repository not on the connection's list    SKIP + the reason        ERROR + the reason
mode unknown / not configured              ERROR                    ERROR
rule has no owner account                  ERROR                    ERROR
every WRITE action of the mode refused     ERROR                    ERROR
  because of the saver's ROLE (F-390)
queue push failed                          ERROR                    ERROR
```

The configuration rows (no mode, no owner) are answered before any instance fact is read.
A rule whose write actions were all refused because an editor saved it is reported at
enqueue, before a token is spent, with the hint to re-save it as an admin.

Each firing runs on its own thread, `pf_<ruleId>_<timestamp>`, so it never shares a record
with the panel conversation or with the previous firing. A rule in Simulation mode
simulates here too. A platform redelivery of the same queue event does nothing: the turn
also takes a 24 h completion claim on its event (`coder_pf_done:<taskId>`).

## 6. What a turn writes on the issue

One module, `src/coder-workspace.js`, writes everything a turn leaves on the issue, under a
short per-issue lock (`coder_ws:<issueKey>`, one minute, fail closed). The model's text is
plain text: it is turned into ADF paragraph by paragraph, never parsed as a document, and
clamped before the write.

- **The plan section.** On a thread's first turn the plan is written into the description
  between two visible marker paragraphs, `[CogniRunner plan]` and `[/CogniRunner plan]`,
  under a heading "CogniRunner plan". A later write replaces the section in place; text
  outside the markers is never touched; a missing or damaged marker pair means the section
  is appended. A plan line that would itself read as a marker is rewritten. Caps: 60 lines,
  12 KB.
- **One comment per confirmed step**, "Coder step: <action> confirmed", plus the
  repository, branch or pull request it produced as **remote links** with a deterministic
  `globalId`, so a re-run updates the link instead of adding a second one. A failed remote
  link does not fail the comment.
- **The Coder log**, one comment per thread titled "Coder log", edited in place after every
  round: the last 60 lines under 16 KB. Its comment id is kept in
  `coder_log:<issueKey>:<threadId>` (90 days); if the comment was deleted a new one is
  created.
- **The session artifact**, `coder-session-<n>.md` (`n` is the thread's turn count), the
  thread as plain markdown, attached only when the model called `finish`; a turn that
  stopped for a confirmation or ran out of rounds attaches nothing. It goes through the
  same extension allow-list and size cap the attachment-upload web trigger enforces.
  Markdown only; any other name or extension is refused.

A workspace write that fails is reported in the turn's result (`workspaceResults`) and
degrades the record; it never kills the turn, because the repository work already happened.
In a dry run nothing is written and each call answers what it would have done.

## 7. Knowledge the Coder reads

Trusted-but-bounded knowledge goes straight after the system prompt, inside its own fence,
with the `coderTurn` budget (16 KB of skills, 8 KB of memories).

- **Memories** are injected when the instance's memory injection setting (`injection`,
  Memories tab) is on, scoped to the issue's project.
- **Skills** are injected only when the queued task carries `skillIds`. Neither the issue
  panel nor the Coder post-function passes any today, so a Coder turn runs without bound
  skills. Listeners and jobs do bind skills; see
  [`LISTENERS-AND-JOBS.md`](LISTENERS-AND-JOBS.md#ai-agent-mode).

Both halves fail open: a skill that will not load or a memory store having a bad minute
leaves the turn running with less context, and the consumer log says so.

## 8. Limits and refusal reasons

Constants, all from `src/coder-engine.js` and `src/coder-workspace.js`:

| Limit | Value |
|---|---|
| Rounds per turn | 1 to 8, default 6 |
| Turn wall clock | 840 s (inside the 900 s consumer) |
| Per-issue turn claim | 20 minutes (derived from the consumer budget) |
| Thread size | 48 KB, then compaction keeping the 12 most recent messages |
| User message | 8,000 characters |
| Consent ticket | 24 h; arguments over 120 KB refuse the action |
| Plan section | 60 lines, 12 KB, 600 characters per line |
| Coder log comment | 60 lines, 16 KB |
| Step comment | 8 KB, 10 links |
| Commit through `commit_files` | 20 files, 200 KB in total, 64 KB per file (adapter caps) |
| Pull request body / PR comment (agent action) | 8 KB / 4 KB |
| Repositories created per run | 1 |

**Refusal shapes**, each with one home:

| Shape | Meaning |
|---|---|
| `{ upgradeRequired:true, featureId:"coder", edition }` | the site is not on the Coder edition (`requireAdvanced`) |
| `{ agentDisabled:true, reason }` | the provider cannot drive an agent; `reason` is a row of §1 |
| `{ reason:"no-permission", needsRole }` | the caller lacks the role (`hint:"ask-app-admin"`) |
| `{ reason:"no-permission", hint:"not-owner" }` | the thread or ticket belongs to someone else |
| `{ reason:"simulation-locked", simulation }` | a mid-thread dry-run flip was asked for |
| `{ reason:"action-not-allowed", refused:[{id, reason}] }` | an action the gate refuses; at save time (a rule) or at confirm time (a ticket) |
| `{ code:"awaiting_confirm" }` | the model asked for a second confirmation while one is pending |
| `{ code:"not_found" }` / `{ code:"not_confirmable" }` | the ticket expired or was answered, or names an action that is not a `confirm` action |

**Per-action reasons** come from the action gate (`normalizeAllowedActions`) and are
rendered by `agentActionRefusalText`:

| Code | What the operator is told |
|---|---|
| `capability-off:git`, `needs-coder-edition` | git actions need the Coder edition on Forge LLM, or any BYOK provider |
| `needs-frontier-model` | git actions on Forge LLM need a frontier agent model |
| `allowance-exhausted` | the Forge LLM allowance is exhausted, so git actions are paused |
| `missing-product:<id>` | this site does not have that product |
| `external-trigger` | an externally triggered rule may not hold an action that approves code, blocks a merge or deploys |
| `needs-admin` | this action writes to somebody's repository, so only an admin may save a rule that holds it |

The gate is one function with four inputs: the capability verdict, the site's products,
`triggerSource` (`"external"` for anything an outside event started: a webhook delivery, a
post-function) and `savedByRole`. Called without a context it evaluates against the most
restrictive one. Save time refuses loudly with the reason; run time drops the refused ids so
a permission change is not an outage.

## 9. What is vendor-billed on Forge LLM

Forge LLM tokens land on the vendor's bill, which is why the Coder edition exists. The
Coder spends tokens as the task type `coder`, listed in `TOKEN_SPENDING_TASK_TYPES`
(`src/shared/ai-budget.js`) beside `gitreview`; a webhook delivery (`git-event`), a
pipeline install (`gitpipeline`) and a credential rotation (`gitcredrotate`) call no model
and are priced at zero.

- A coder turn is estimated at **16,000 tokens** before it runs and is paced by the same
  tokens-per-minute budget queue every other queued AI task passes through (default 35,000
  TPM for Forge LLM, **Settings → AI token budget**). A PR review is estimated from the diff
  size, capped at the 60 KB diff cap, plus 4,000.
- The turn runs on the agent model (**Settings → Agent model**), which on Forge LLM must be
  `claude-sonnet-5` or `claude-opus-5`; Haiku is never used for an agent. Spend counts
  against the monthly allowance (`clamp(seats × $2.00, $40, $800)`); at the hard cap the
  capability reports `allowance-exhausted` and Coder turns are refused until the month
  rolls over, while saved rules keep running on Haiku.
- On a BYOK provider the tenant pays its own tokens and none of this applies.
- **Prompt caching on Anthropic.** The agent loop declares the leading messages present at
  entry (system prompt, knowledge, thread history) as a stable prefix, and the Anthropic
  adapter marks that prefix with `cache_control: { type: "ephemeral" }` (on the system block
  and on the last stable message), so each later round of a turn reads the prefix from the
  cache instead of re-billing it. One-shot callers (validators, semantic post-functions,
  codegen, fixes, reviews) send no cache markers. No other provider reads the flag. Details
  in [`AI-PROVIDERS.md`](AI-PROVIDERS.md#anthropic).

## 10. Testing

Offline, no Forge runtime (`cd test-harness && npm run test:offline` runs every
`scripts/*.test.mjs`):

```
scripts/coder-engine.test.mjs           turns, tickets, compaction, the headless halt, the arity of every clamp
scripts/coder-workspace.test.mjs        plan markers, in-place replacement, the log comment, the .md artifact
scripts/coder-resume-params.test.mjs    a resumed turn inherits simulation / connection / rounds
scripts/coder-hook-simulation.test.mjs  the dev hook may only drive a simulated thread
scripts/premade-coder-pf.test.mjs       the mode table, the strict table, the enqueue refusals
scripts/agent-actions-gate.test.mjs     a BLOCK and an ALLOW case per gate flag
scripts/git-actions.test.mjs            every git action's clamps and its simulation answer
```

Live, against a dev site with `HARNESS_SECRET` set: `scripts/premade-coder-pf.headless.mjs`
drives a headless post-function turn through the dev hook. The hook refuses to drive a live
(non-simulated) Coder thread and refuses to answer a ticket on one.
