<!--
 CogniRunner - AI-powered workflow validation for Jira
 Copyright (C) 2025 LeanZero
 SPDX-License-Identifier: Apache-2.0
-->

# The Virtual Administrator

A Virtual Administrator is an AI agent that works a queue of Jira issues on a schedule,
over days, without a person in the loop for every turn. It sweeps its intake, decides what
to do on each issue, stages a reply, and sends that reply on a later tick only after a fixed
series of checks. It writes as the app, with a persona name in the text. This page describes
what is on `main` in release 1.5: the record, the two doors that create one, the two-phase
day, every post gate in order, shadow mode, the ledger, the caps, the capability rule and the
REST resource. The Confluence half of 1.5 (the rules, the agent actions and the client) is in
[`CONFLUENCE.md`](CONFLUENCE.md).

Everything below was read from the code. Where a claim names a file, the file is the
authority; where the 1.5 FRAME (`docs/FRAME-1.5-va-confluence.md`) and the code disagree, the
code wins and the difference is called out.

---

## Contents

1. [What it is, and what it is not](#1-what-it-is-and-what-it-is-not)
2. [Where you see it](#2-where-you-see-it)
3. [The record](#3-the-record)
4. [Creating one: the wizard, the form, REST](#4-creating-one-the-wizard-the-form-rest)
5. [The two-phase day](#5-the-two-phase-day)
6. [What an agent can do: powers and tools](#6-what-an-agent-can-do-powers-and-tools)
7. [The post gates, in order](#7-the-post-gates-in-order)
8. [Shadow mode, approve and reject](#8-shadow-mode-approve-and-reject)
9. [Pause, run now, kill switch](#9-pause-run-now-kill-switch)
10. [The ledger](#10-the-ledger)
11. [Memory and compaction](#11-memory-and-compaction)
12. [Limits](#12-limits)
13. [The capability requirement](#13-the-capability-requirement)
14. [The REST resource](#14-the-rest-resource)
15. [Known limits](#15-known-limits)
16. [Testing](#16-testing)

---

## 1. What it is, and what it is not

A Virtual Administrator is **a scheduled job with `mode: "va"`** (`src/scheduled-jobs.js`,
`normalizeJob`). It is not a new kind of rule and it has no store of its own: it lives in the
job index, is planned by the same 5-minute tick as every other job, takes the same tick
claim, and is reachable through the same "Run now" and the Rules REST API. The `va` block on
the job row carries everything that makes it an agent, and `normalizeVa` in
`src/shared/va-config.js` is the one normaliser for that block, called from inside
`normalizeJob`. `isVaJob(job)` in `src/virtual-admin.js` is the one predicate for "is this a
Virtual Administrator": it requires both the mode and the block, so a job whose mode says
`va` with no block runs as nothing.

Three things it never does, and each is a code fact rather than a prompt sentence:

- **It never posts directly.** There is no `add_comment` or `post_comment` in its tool list.
  Speech goes through `stage_reply`, which writes a ledger row, and the post phase, which is
  not a tool and is not reachable from a tool call, is the only thing that delivers it
  (`src/va-ledger-actions.js`, `src/virtual-admin.js` `freeActionsFor`).
- **It never changes configuration.** There is no action for schemes, workflows,
  permissions, roles or fields anywhere in the action catalogue. `propose_change` files a
  proposal for a human; it is the only route, not the approved one
  (`src/shared/agent-actions.js`, the `ledger` namespace).
- **It never writes site-wide.** `scope.write.site` is refused at save time with a thrown
  error, and every Jira write at run time resolves the target issue's project from a read
  and checks it against the write list (`assertWriteScope`, gate 8).

## 2. Where you see it

Admin panel, the **Agents** tab. An editor sees the list, each agent's status, caps, health
and tick receipts; an admin also sees the staged drafts, the effects and the memory, and
holds every write (create, edit, delete, pause, resume, run now, approve, reject). The tab's
own line for it: "Virtual administrators: agents that work a service desk queue on a
schedule, stage a reply, and send it on a later tick only after eleven checks. Every one
starts in shadow mode, where it stages and posts nothing." (`static/admin-panel/src/App.js`).

The tab has two ways to create an agent, **+ New virtual administrator** (the wizard) and
**Use the form** (the classic form), and an open agent has four panes: drafts, effects, tick
receipts and memory. A solid red banner appears when the agent's own health counter reaches
the threshold (section 10).

The agent runs on the **Agent model** slot in Settings, not the rules model
(`DEFAULT_DEPS.runLoop` in `src/virtual-admin.js` calls `getAgentModel()`), and only when
the capability rule allows an agent at all (section 13).

## 3. The record

The `va` block, as `normalizeVa` returns it. Defaults are `VA_DEFAULTS` in
`src/shared/va-config.js`; the least-privileged agent that is still valid.

| Field | Default | What it means |
|---|---|---|
| `persona.name` | required | Printed in every message. Letters, digits, space, apostrophe, hyphen and dot only; at most 40 characters. Anything else is stripped and the reduction is reported. |
| `persona.voice.register` | `plain` | One of `terse`, `plain`, `warm`. Sets the word cap the voice lint enforces (45 / 80 / 120 words). |
| `persona.voice.maxSentences` | 3 | 1 to 6. Over it, the voice lint blocks. |
| `persona.voice.language` | `auto` | One of `auto`, `en`, `de`. |
| `persona.voice.greeting`, `persona.signature` | false | Booleans. |
| `scope.read` | `{ site: false, projects: [] }` | Read may be site-wide. |
| `scope.write` | `{ projects: [] }` | Never site-wide; `site: true` throws. A write project outside the read scope is dropped and reported. |
| `intake.serviceDesks` | `[]` | `[{ serviceDeskId, queueIds: [] }]`, at most 10 desks and 20 queues each, checked against the site's desks and queues. |
| `intake.jql` | `""` | Text only here, at most 2000 characters. It is executed dry by the save path before it becomes standing intake (section 4). |
| `intake.mentionsOf` | `[]` | Up to 10 account ids whose mentions the agent picks up. |
| `intake.owedFirst` | true | |
| `cadence.preset`, `cadence.cron`, `cadence.timeZone` | `every30`, `*/30 * * * *`, `UTC` | The presets and the cron maths are `src/shared/cron.js`'s. The cadence **is** the job schedule; a schedule supplied beside it is ignored (`prepareVaSave`). |
| `cadence.postWindow` | every day, `00:00` to `23:59` | Days 0 to 6 (0 is Sunday) and a `from`/`to` in `HH:MM`. No days listed means no restriction, not never. A window whose `to` is before its `from` wraps past midnight. |
| `powers.*` | all false except `replyInternal` | The closed list: `replyPublic`, `replyInternal`, `assign`, `transition`, `editFields`, `confluenceRead`, `confluenceWrite`, `git`, `webSearch`. An unknown key is refused by name. |
| `powers.skillIds` | `[]` | At most 4 skills, checked against the skill index. |
| `powers.confluenceSpaces` | `[]` | The Confluence **write** allow-list, at most 20 space keys. Empty means no Confluence writes, even with `confluenceWrite` on; the save reports that clamp rather than refusing. |
| `guardrails.*` | see section 12 | The brakes. Every number is clamped toward the restrictive end; a blank or unparseable value becomes the default, never the maximum. |
| `guardrails.approvalProjectKey` | `""` | Where `ask_human` and `propose_change` file issues. Empty means proposals become internal notes. |
| `status.paused` | false | The per-agent kill switch. |
| `status.shadowUntilTick` | `guardrails.shadowTicks` | A tick index; the agent posts nothing until its own prepare-tick count reaches it (section 8). |

Two fields from the plan do not exist and are refused by name so an operator learns they
are gone: `guardrails.owedUncapped` (owed replies have their own cap, `owedPerHour`) and
`guardrails.maxBulkTargets` (the one write brake is `maxWritesPerRun`).

`normalizeVa` fails closed. A structural refusal (no name, a site-wide write, an invalid or
absent custom cron) throws, so the record never lands. Everything else is clamped and every
clamp is returned in `refused[]` with the field and a sentence the UI shows verbatim.

A `PUT` on the REST resource merges the `va` block recursively (`mergeVaPatch`): a rename does
not resume a paused agent or reset a guardrail. Arrays replace, never concatenate, so
sending `[]` can mean "none".

## 4. Creating one: the wizard, the form, REST

Both doors build the same record and hand it to the same save path.

**The wizard** (`src/shared/va-wizard.js`, rendered by `VaWizard.jsx`) is a pure state
machine with the field order in code: `persona_name`, `persona_voice`, `intake`,
`read_scope`, `write_scope`, `cadence`, `powers`, `guardrails`, `review`, `create`. A model
takes part, and its one job is the sentence above the controls (`say`). Its `ask` is
ignored in favour of the code-authored question, its `options` are ignored in favour of
options derived from the live catalogue (projects, desks and queues, time zones, skills,
presets), its `done` is ignored unless the machine is already on the create step, and a
`field` that does not name the current step is refused. A hallucinated project key cannot be
offered, so it cannot be picked. The interview is fully usable with no model at all: a
missing key, a non-JSON reply or an empty `say` falls back to the step's own question.

The voice step renders sample messages through `lintVoice`, the same function post gate 9
runs on a real message, and shows the blocks by rule name. That preview fails open on
purpose (a sample that cannot be linted still renders, labelled); the post gate fails closed.

Wizard state lives at `va_wizard:{accountId}` for 7 days, one interview per admin, so a
closed tab resumes and a second tab resumes the first rather than forking it. The state is
never accepted back from the browser. The wizard fails closed into the form: a record
`normalizeVa` refuses comes back with `fallbackToForm: true` and the partial record, and the
admin lands in the classic form holding everything they answered.

**The classic form** (`VaEditor.jsx`) collects the same answers with the same pickers
(`VaPickers.jsx`) and previews the save path's own answer on every keystroke by running
`normalizeVa` against the same catalogue. Where a catalogue exists there is no free text.

**The save path** is `prepareVaSave` in `src/va-admin.js`, and both the resolver and the
REST resource go through it:

1. The live catalogue is built (`buildCatalogue`: projects, service desks and queues, time
   zones, skills; each source fails soft and says so) and `normalizeVa` runs against it. A
   source that could not be read is reported beside the save as accepted without a check.
2. **The dry search.** When the JQL changed, it is wrapped in the read scope by the engine's
   own `wrapScopedJql` and executed once, bounded to one result. A JQL that Jira refuses is
   refused with the Jira error class named and the JQL never echoed; a transport fault
   accepts the filter with a note. The same check runs on the wizard's intake step before
   the answer is written.
3. **Shadow re-arm.** Any configuration change sets `status.shadowUntilTick` to
   `max(current, currentTickIndex + shadowTicks)`, so an edit can only lengthen a watch and
   `shadowTicks: 0` still means no shadow. Pause and resume do not go through this path and
   never re-arm.
4. The schedule and the job name are derived from the record (the cadence, the persona
   name).

`saveJob` then normalises again without the catalogue, which is idempotent.

## 5. The two-phase day

Three task types, and why they are three (`src/virtual-admin.js`, `src/async-handler.js`):

| Task | Phase | Model call | Queue |
|---|---|---|---|
| `va-tick` | PREPARE: sweep the intake, diff against the ledger, fan out at most `maxItemsPerTick` item tasks, write a receipt | none (in `NON_AI_TASK_TYPES`, priced at zero) | `async-ai-queue` |
| `va-item` | one bounded turn on one issue | yes (estimated at 8000 tokens, paced by the token budget) | `async-ai-queue`, or `long-queue` (900 s) when the agent holds a Confluence, git or web power (`itemQueueFor`, decided at the producer) |
| `va-post` | POST: the gates, then at most one comment per staged row; its own receipt | none (200 tokens reserved) | `async-ai-queue` |

**The scheduler** (`src/scheduled-jobs.js`) treats a due Virtual Administrator as a
`va-tick` rather than a script run (`enqueueJobRun`), and on every 5-minute tick also
enqueues one `va-post` per enabled agent behind a per-minute claim
(`job_claim:{id}:post:{bucket}`). The tick identity is the 5-minute bucket of the firing,
not the instant.

**The prepare tick.** A paused agent writes a receipt saying so and does no work. The
capability gate runs before anything else (section 13). The app's own account id is read
once per tick so the sweep can tell its own comments from a human's. The sweep reads three
sources in order, queues, then the operator JQL, then mentions, under one shared budget of 50
candidates; a queue that cannot be read is a dead source named in the receipt and the tick
continues, while a JQL that cannot be bounded or executed produces no candidates from that
source, said out loud. The operator's JQL is wrapped as
`(<clause>) AND project in (<read scope>) ORDER BY updated DESC`; a trailing `ORDER BY` is
stripped, and an unbalanced quote or parenthesis, a non-trailing `ORDER BY`, a trailing
operator or an over-long clause is refused by name (`wrapScopedJql`). Mentions are searched
through the same wrapper and can never widen the write scope.

`diffCandidates` in `src/va-ledger.js` then decides what this tick spends money on, in
this order: `owed` (a human replied to us), `mention`, `new`, `stale` (a changed fingerprint,
or a `waiting_on_human` row past its `dueAt`). Parked, already-staged, unchanged and
still-waiting rows are skipped with a reason; everything past the per-tick budget is
deferred. Each selected row is moved to `queued` before the push, and one `va-item` task is
pushed per row with the platform concurrency key `{ key: "ai-budget", limit: 2 }`.

**The item turn.** The consumer takes the `va_exec` claim first (fail-closed, released on a
throw before any side effect, not released on success). The capability gate runs again,
because a queued message can be delivered minutes later across a licence change. A parked
row, or one at the attempts cap, costs nothing. The prompt's stable prefix is the persona,
the guardrail sentences rendered from the record (`renderGuardrailSentences`, the same text
the wizard's review card shows), the knowledge block (skills, through `buildAgentKnowledge`
with `useMemories: false`) and the agent memory in an advisory fence; the issue and its
ledger view go last, in an untrusted fence. The loop is `runAgentLoop`, up to 8 rounds,
with the agent model. A turn that stages nothing, asks nobody, proposes nothing and changes
nothing counts as an attempt; at 3 the item parks.

**The wall-clock floor.** A staged draft is eligible for posting only when both hold
(`postFloorOk`): `now - stagedAt >= minPostGapMinutes` **and** the post phase runs on a
different tick id than the one that staged it. The clock alone can be satisfied inside one
long tick; the tick id alone can be satisfied by two ticks thirty seconds apart after a
missed run. `minPostGapMinutes` has a floor of 5 as well as a ceiling, so it cannot be set
to zero.

## 6. What an agent can do: powers and tools

The powers are the gate. A VA carries no `agent.allowedActions` list; `toolActionsFor(va)`
turns its powers into the tool list, and the turn passes it `pregated: true` so nothing
re-decides it. The catalogue's `confirm` flag is deliberately not applied to a VA turn: a VA
never opens a consent ticket, the operator who ticked the power is the confirmation, and an
action the powers do not allow is simply absent (and refused by `assertAgentActionAllowed`
if the model invents it).

| Power | Tools it adds |
|---|---|
| (always) | `get_issue`, `search_issues`; the ledger actions `ask_human`, `propose_change`, `ledger_note`, `memory_note`; `finish` |
| `replyInternal` or `replyPublic` | `stage_reply` (which audience a draft ends up with is a later gate) |
| `assign` | `set_assignee` |
| `transition` | `transition_issue` |
| `editFields` | `update_fields`, `add_labels`, `remove_labels` |
| `confluenceRead` | `confluence_search`, `confluence_get_page` |
| `confluenceWrite` (implies read) | plus `confluence_create_page`, `confluence_update_page`, `confluence_add_comment`, bounded by `powers.confluenceSpaces` |
| `git` | reads only: `get_pull_request`, `get_build_state`, `get_deploy_status` |
| `webSearch` | `web_search`, with a per-run search budget and the tenant's MCP toggle |

`add_comment` is deliberately absent and the offline suite asserts its absence by name.

Every Jira write goes through one dispatcher with `maxWrites` set from
`guardrails.maxWritesPerRun` and `writeScope` from `vaWriteScope(va)`; an empty write list
means no writes. `ask_human` and `propose_change` create their inbox issues through a second
dispatcher over the same session, allowing only `create_issue` and targeting
`guardrails.approvalProjectKey` from the record, never from a model argument; at most 2 inbox
issues per turn, summary and description clamped and defanged. Without an approval project
they are recorded as internal notes on the item instead.

The ledger actions are `kind: "read"`: a staged reply changes nothing outside the app, so
it does not spend the write brake.

## 7. The post gates, in order

`runVaPost` in `src/virtual-admin.js`. Gates 1 to 9 run before the write, 10 immediately
before it, 11 after. Every refusal is recorded: in the receipt's `skipped[]` with its
reason, and on the item's `history` where the row is touched. The claim is tenth and not
first so a draft the freshness gate dropped can be retried under its own identity, and the
caps slot is spent before the write, never after, because a counter that fails to increment
lets the whole allowance be spent twice.

| # | Gate | What it refuses |
|---|---|---|
| 1 | Paused, shadow, kill switch (`gatePausedShadow`), once per run | `paused` and `kill_switch` stop the whole pass. `shadow` does not: it is decided per draft, and an admin-approved draft leaves shadow (section 8). The shadow count is the agent's own prepare-tick count from `va_health`; a health read that fails keeps the agent in shadow. The post window (`inPostWindow`) is checked here too: outside the window's days or hours the pass ends, and an unreadable time zone counts as outside. |
| 2 | Attempts (`gateAttempts`) | A parked row, or `attempts >= 3`. |
| floor | The double wall-clock floor (`postFloorOk`) | Same tick as the one that staged it, or inside `minPostGapMinutes`. |
| 3 | Freshness (`gateFreshness`) | The last comment by somebody other than the app is not the draft's baseline. The draft is dropped and the item re-queued, not discarded, and it counts as an attempt. |
| 4 | Other-writer quiet (`gateQuiet`) | Somebody else wrote on the issue inside `otherWriterQuietMinutes`. |
| 5 | Anti-pile-up (`gatePileUp`) | We spoke last within `antiPileUpDays` and nobody is waiting on us. An `owed` row overrides it. An unknown app identity blocks. |
| 6 | Audience (`decideAudience`, the same function that staged it) | A draft written for the customer that may no longer go to one is dropped and re-queued for a rewrite. Public requires all four: `replyPublic` on, the draft asked for public, the issue has a readable request type, and the addressee is the reporter. Every other path downgrades to internal. |
| 7 | Caps (`capsAllow`, then `bumpCaps`) | The day cap, the hour cap, or for an owed reply its own hourly cap. Unknown counters block: a read fault or a write fault on the bump refuses the post. The slot is spent here, before the write. |
| 8 | Write scope (`assertWriteScope`) | The target issue's project, read from the issue, is not in `scope.write.projects`. An unresolvable project is a refusal, not a pass. |
| 9 | Voice lint (`gateVoice`, fail closed) | Any block from `lintVoice` (section 7a). The draft is dropped, the item re-queued and an attempt counted. A lint that throws blocks. |
| 10 | The post claim (`va_post:{agent}:{key}:{stagedAt}`, fail closed) | A second delivery of the same draft, or a storage fault. |
| write | `addComment` as the app, `sd.public.comment = { internal: true }` unless gate 6 said public | On a failure the claim is not released and the row stays `staged` for a human. |
| 11 | Read-back (`verifyPostedComment`) | No comment id; or a second REST read shows `jsdPublic` different from what gate 6 decided. A public comment that should have been internal is immediately edited to internal (the property is put, never delete and re-post) and an error receipt is written. |

The item becomes `posted` whatever the read-back said, because a comment exists; the
mismatch lives in the history, the receipt's error and the effects row's summary. The
fingerprint stored is the post-write one, so the next sweep does not see the agent's own
comment as a change. An effects row is written only when the read-back proof binds the
effect (section 10).

Where the FRAME and the code differ: the FRAME's table numbers a "write budget" gate 8
(`writesThisRun < maxWritesPerRun`). The post phase has no such gate, because a post is not a
dispatcher write; the write brake applies inside the item turn, on the dispatcher. The code's
gate list is the one above, with attempts as gate 2.

### 7a. The voice lint

`lintVoice(text, voice)` in `src/shared/voice-lint.js` is a shape check, not a content
filter, and the words it matches live in `src/shared/voice-rules-data.js`. It never returns
the author's text; a block carries the rule id, a 1-based sentence index and, for a table
match, the table phrase.

Blocks: `empty`, `markdown_bullet`, `markdown_heading`, `markdown_bold`,
`markdown_backtick`, `em_dash` (em dash, en dash or a spaced `--`), `ai_disclaimer`,
`banned_opener` (only at the start of the first sentence), `method_leak`, `sign_off` (last
sentence or a line of its own), `over_max_sentences`, `long_sentence` (over 45 words),
`no_short_sentence` (3 or more sentences and none of 8 words or fewer), `register_word_cap`
(45 / 80 / 120 words for terse / plain / warm).

Warnings, recorded and never blocking: `exclamations` (more than 1), `question_pile` (more
than 2), `emoji`, `repeated_sentence_opener`.

## 8. Shadow mode, approve and reject

A new or reconfigured agent runs, stages and shows its drafts, and posts nothing until it
has been watched for `shadowTicks` of its own prepare ticks (default 3, at most 50). The
count is the number of prepare receipts the agent has written, failed ones included, and it
lives on the `va_health` row; paused ticks and capability refusals do not count as watched.
`shadowStateOf` is the one comparison, reached by gate 1 and by the Agents tab's LIVE /
SHADOW badge alike.

While in shadow, the drafts pane carries **Approve** and **Reject**:

- **Approve** stamps `approvedBy` and `approvedAt` on the draft itself (only `approveDraft`
  in `src/va-admin.js` can write those fields; no model action can). The post phase then
  lets that one draft out of shadow, and every other gate still applies to it: a fresher
  comment, a cap, the write scope or the voice lint can still refuse it. Approval answers
  "may this agent speak yet", not "is this still the right reply".
- **Reject** drops the draft and re-queues the item (`staged` to `queued`), the ledger's own
  drop move, so the agent gets another go.

Both require the `stagedAt` read back with the draft: a tick between the read and the click
can replace the draft, and a verdict on a draft nobody read is refused with `draft_changed`.
Outside shadow both are refused with `not_in_shadow`. Neither posts anything.

## 9. Pause, run now, kill switch

Three levels (`src/va-admin.js`, `src/virtual-admin.js`):

- **Pause / Resume** writes `status.paused` on the job row and a receipt. A paused agent
  sweeps nothing and posts nothing. Pausing never re-arms shadow, and a paused tick does not
  count as a watched one.
- **Run tick now / Post now** push the same task body the planner pushes, onto the same
  queue, behind the same 5-minute claim (`job_claim:{id}:tick|post:{bucket}`), so the engine
  cannot tell a manual run from a scheduled one and no manual path reaches a post without the
  gates. A second press in the same 5-minute window is refused with `already_running`; a
  disabled or paused agent is refused by name.
- **The tenant kill switch** is the existing job cancel epoch, read at gate 1 as
  `va:{jobId}`.

Deleting the agent is the job delete; see `purgeAgent` in section 15.

## 10. The ledger

`src/va-ledger.js` is the agent's whole memory between ticks. Every key is built in
`src/shared/va-keys.js` through `safeKeyPart` and `assertKvsKey`; every cap comes from
`VA_LIMITS`. One row per key, never an array.

| Key | Holds | TTL |
|---|---|---|
| `va_item:{agent}:{issueKey}` | one item: `state`, `fingerprint`, `staged`, `dueAt`, `attempts`, `history` (last 10), `notes` (600 chars), `touchedAt` | 90 days, refreshed on every touch |
| `va_index:{agent}` | the LRU-ordered list of live item ids, at most 400, and a parked counter | 90 days |
| `va_memory:{agent}` | prose plus pinned `constraints[]` | none |
| `va_tick:{agent}:{prepare\|post}-{tickId}` | a receipt per phase: candidates, staged, `skipped[{key, reason, gate?}]` (at most 50), next run, error | 7 days |
| `va_effect:{agent}:{invTs}` | one verified effect, newest first | 30 days |
| `va_caps:{agent}:{h\|d\|oh}:{bucket}` | the hour, day and owed-hour counters | 2 days |
| `va_health:{agent}` | `consecutiveFailures`, `prepareTicks`, `lastTickAt`, `lastOkAt`, `lastReason` | 90 days, refreshed on every tick |
| `va_wizard:{accountId}` | a half-finished interview | 7 days |
| `va_exec:{agent}:{key}:{tickId}`, `va_post:{agent}:{key}:{stagedAt}` | the two claims, both fail-closed | 2 days |

**States** (`VA_STATES`): `seen`, `queued`, `staged`, `posted`, `waiting_on_human`, `owed`,
`done`, `parked`. The legal moves are the `VA_TRANSITIONS` table; an illegal move is refused
and writes nothing. `staged` to `queued` is the freshness drop; anything to `parked` is
always legal.

**Fingerprints** are `{ updated, lastCommentId, lastCommentAuthor, status }` plus an FNV-1a
hash, and they are authorship-aware: comments by the app itself are skipped, so the agent's
own reply is not a change and the stage baseline and the freshness gate read one definition
of "the thread moved".

**The index** is bounded twice, by 400 entries and by 60 KB, and evicts by state before
recency: `seen`, `done` and `parked` rows first, then `posted`, and never `queued`, `staged`,
`waiting_on_human` or `owed`. When only obligations remain, the insert is refused by name
rather than a promise dropped; the row is still written, and the receipt names it.

**Attempts** park an item at 3: a turn that produced nothing, a draft the voice lint
rejected, and a draft dropped by the freshness gate each count.

**Effects** are written only on a read-back proof that binds the effect: `source: "rest"`, a
parseable `verifiedAt`, an observed value, and identifiers that match the effect's target
(the issue key always, plus the comment id for a comment). A proof about one issue cannot
verify an effect on another, and an unrecognised effect kind is refused.

**Caps** are fixed clock buckets, read then bumped. An owed reply bumps the owed-hour and the
day counter but not the general hour counter. Unlike the listener brake, unknown counters
block.

**Health** is the banner's own counter, never reconstructed from receipts. A successful tick
resets it; three consecutive failed ticks turn the Agents tab banner solid red
(`VA_HEALTH_BANNER_FAILED_TICKS`).

## 11. Memory and compaction

The agent's memory is one row: free prose plus a pinned `constraints[]` list (at most 20, 300
characters each). `memory_note` writes prose; `memory_note` with `constraint: true` writes
`proposed constraint: ...` into the prose and tells the model so. Only a person promotes a
line into `constraints[]`, through the Agents tab's memory editor (`saveMemory`), so a model
cannot issue itself a standing order. The memory is injected in an advisory fence
(`<<<AGENT_MEMORY ... AGENT_MEMORY>>>`), labelled as the agent's own notes and never as
operator instruction, and it is defanged and clamped at write time, not at injection.

The cap is 8192 bytes measured on the stored JSON envelope (`memoryBytes`); over it the prose
is clamped and the pinned constraints are kept whole. `compactMemory` exists with the
promised property (the summariser only ever rewrites prose; the constraints are carried
across byte for byte and a `constraints` field in the summariser's output is ignored) and a
6144-byte trigger.

Where the FRAME and the code differ: the FRAME describes compaction as a queued
summarisation task. In the tree nothing calls `compactMemory`; no task handler and no tick
schedules it. Today a memory over the cap is clamped by `writeMemory`, constraints intact,
and the honest mitigation is that the memory is admin-editable and capped.

## 12. Limits

The numbers below are `VA_LIMITS` and `VA_CEILINGS` (`src/shared/va-config.js`), whose
literals live in `src/shared/registry-limits.js` beside the job and agent brakes, and the
shape bounds declared in `va-config.js` itself. Quote the constants; do not retype them.

| Setting | Default | Range | Constant |
|---|---|---|---|
| Posts per hour | 6 | 0 to 60 | `VA_CAPS_PER_HOUR_*` |
| Posts per day | 40 | 0 to 400 | `VA_CAPS_PER_DAY_*` |
| Owed replies per hour | 12 | 0 to 60 | `VA_OWED_PER_HOUR_*` |
| Items per tick | 5 | 1 to 20 | `VA_MAX_ITEMS_PER_TICK_*` |
| Candidates per sweep | 50 | fixed | `VA_MAX_CANDIDATES_PER_TICK` |
| Shadow ticks | 3 | 0 to 50 | `VA_SHADOW_TICKS_*` |
| Minimum post gap, minutes | 15 | 5 to 1440 | `VA_MIN_POST_GAP_MINUTES_*` |
| Anti-pile-up, days | 4 | 0 to 30 | `VA_ANTI_PILE_UP_DAYS_*` |
| Other-writer quiet, minutes | 15 | 0 to 1440 | `VA_OTHER_WRITER_QUIET_MINUTES_*` |
| Writes per run | 200 | 0 to 1000 | `JOB_*_MAX_WRITES_PER_RUN` (the job brake; one vocabulary) |
| Attempts before parking | 3 | fixed | `VA_ITEM_ATTEMPTS_MAX` |
| Item rows per agent | 400 | fixed | `VA_ITEM_ROW_CAP` |
| Item row TTL, days | 90 | fixed | `VA_ITEM_TTL_DAYS` |
| Tick receipt TTL, days | 7 | fixed | `VA_TICK_TTL_DAYS` |
| Effects row TTL, days | 30 | fixed | `VA_EFFECT_TTL_DAYS` |
| Wizard state TTL, days | 7 | fixed | `VA_WIZARD_TTL_DAYS` |
| History entries per item | 10 | fixed | `VA_HISTORY_MAX` |
| Notes per item, characters | 600 | fixed | `VA_NOTES_MAX_CHARS` |
| Staged draft body, characters | 2000 | fixed | `VA_STAGED_BODY_MAX_CHARS` |
| Pinned constraints | 20, 300 chars each | fixed | `VA_CONSTRAINTS_MAX`, `VA_CONSTRAINT_MAX_CHARS` |
| Memory compaction trigger / cap, bytes | 6144 / 8192 | fixed | `VA_MEMORY_COMPACT_BYTES`, `VA_MEMORY_MAX_BYTES` |
| Failed ticks before the banner | 3 | fixed | `VA_HEALTH_BANNER_FAILED_TICKS` |
| Skills per agent | 4 | fixed | `MAX_RULE_SKILL_IDS` |
| Persona name, characters | 40 | fixed | `VA_PERSONA_NAME_MAX` |
| Sentences per message | 3 | 1 to 6 | `VA_MAX_SENTENCES_*` |
| JQL, characters | 2000 | fixed | `VA_JQL_MAX` |
| Mentions, service desks, queues per desk, projects, Confluence spaces | 10, 10, 20, 50, 20 | fixed | `VA_MENTIONS_MAX`, `VA_SERVICE_DESKS_MAX`, `VA_QUEUES_PER_DESK_MAX`, `VA_PROJECTS_MAX`, `VA_CONFLUENCE_SPACES_MAX` |
| Agent rounds per item turn | 5 (`agent.maxRounds`) | at most 8 | `runVaItem` |
| Item turn budget | 100 s | fixed | `DEFAULT_DEPS.turnBudgetMs` |

The refusal sentence for each brake has one home, `vaRefusalText` in `registry-limits.js`.

## 13. The capability requirement

A Virtual Administrator is an agent surface, and the same predicate every other agent
surface asks decides whether it may run: `agentCapability` in `src/shared/edition.js`. The
prepare tick asks it before any work, and the item turn asks it again before the model is
called (`DEFAULT_DEPS.capability`, `src/virtual-admin.js`). A refusal is loud in both places
an admin looks: the receipt names the gate (`gate: "capability"`) and the reason, and the
health counter takes a failure so the banner appears. A refused tick does not count as a
watched one, so it does not burn shadow mode.

The exact reasons, in the order the predicate tests them:

| Situation | Verdict | `reason` |
|---|---|---|
| The provider could not be read, or any fact read threw | refused | `unknown` |
| Any BYOK provider (OpenAI, Azure, OpenRouter, Anthropic, Bedrock, LM Studio) | enabled | `byok` |
| Atlassian (Forge LLM) on the Standard edition | refused | `needs-coder-edition` |
| Forge LLM, agent model not `claude-sonnet-5` or `claude-opus-5` | refused | `needs-frontier-model` |
| Forge LLM, monthly allowance at its hard cap | refused | `allowance-exhausted` |
| Forge LLM, Coder edition, frontier agent model, allowance not exhausted | enabled | `forge-frontier` |

One stated gap: the VA's capability read does not read `allowanceLevel`, because the monthly
Forge LLM allowance is computed inside `src/index.js` and is not exported. So the
`allowance-exhausted` arm cannot fire on this surface; the edition, provider and
frontier-model arms all do. Closing it means exporting the facts assembler from `index.js`.

## 14. The REST resource

`?resource=agents` on the Rules REST API (`src/rules-api.js`, `handleAgents`) is the second
skin over `src/va-admin.js`; the Agents tab's resolvers are the first. It is a view over
`?resource=jobs` filtered to `mode: "va"`, not a second store, and `?resource=jobs` refuses a
VA row by name (`is_a_virtual_administrator`, 404) and hides them from its list.

| Method and query | Floor | Result |
|---|---|---|
| `GET ?resource=agents` | editor | list (the overview allow-list: no draft body, no instructions) |
| `GET ?resource=agents&id=` | editor | status: last tick, staged count, items by state, next tick, next post window, shadow, paused, health, caps, receipts |
| `POST ?resource=agents` | admin | create, or upsert when `id` is given; 201 / 200, with `refused[]` |
| `PUT ?resource=agents&id=` | admin | recursive `va` merge, then the same save path |
| `DELETE ?resource=agents&id=` | admin | the job delete, then `purgeAgent` |
| `GET ?resource=agents&id=&part=drafts\|effects\|memory` | admin | staged replies in full, verified effects, the memory |
| `PUT ?resource=agents&id=&part=memory` | admin | `{ memory, constraints? }`, `clamped` reported |
| `POST ?resource=agents&id=&action=pause\|resume` | admin | `{ reason? }`; a receipt is written |
| `POST ?resource=agents&id=&action=tick\|post` | admin | `202 { taskType, taskId, tickId }` behind the 5-minute claim |
| `POST ?resource=agents&id=&action=approve\|reject` | admin | `{ itemKey, stagedAt, reason? }`; `posted: false` |

The floors are the resolvers' floors, so a token cannot do anything the tab cannot: editor
for the overview, admin for anything that reads what the agent is about to say or changes it.
A token minted before roles existed is admin. Refusals carry `error`, `reason`, and for a
role `needsRole` and `hint`; the statuses are 400 for a body to fix, 403 for a role, 404 for
an agent that is not there, 409 for a state that refuses (`not_in_shadow`, `no_staged_draft`,
`draft_changed`, `agent_disabled`, `agent_paused`, `already_running`), 502 for a read or
write the app could not complete. The wizard is not on this surface: its state is keyed by an
account, and a token is not an account. Examples and the wider surface are in
[`LISTENERS-AND-JOBS.md`](LISTENERS-AND-JOBS.md#virtual-administrators-resourceagents).

## 15. Known limits

- **It writes as the app user.** Comments, transitions, field edits, inbox issues and
  Confluence pages are authored by the app's own account, with the persona name in the text
  and never as the author. The identity is read from `/rest/api/3/myself` and memoised for 5
  minutes; when it cannot be read, the prepare tick records `self_unknown`, the item turn
  refuses, and the post pass ends with a receipt, because no gate could tell the agent's
  comments from a human's.
- **No configuration writes, by construction.** There is no action for schemes, workflows,
  permissions, roles or fields, and `powers` refuses any unknown key by name.
- **Internal note shape.** An internal note is the JSM comment property
  `sd.public.comment = { internal: true }`; a portal-visible comment is the absence of the
  property. The plan text said `sd.public.comment=false`; the code and the app's own sandbox
  spec are the authority.
- **`purgeAgent` is bounded.** Deleting an agent drops the index, the health row and the
  memory first, then at most 200 item rows (`VA_PURGE_ITEM_BUDGET`); what it does not reach
  expires on the 90-day item TTL, and it never sweeps `va_tick:*` or `va_effect:*`, which
  carry their own TTLs. The purge is fail-soft and logged; a delete is never refused because
  a counter row would not go.
- **`va_memory` has no TTL**, deliberately: it is written only when the agent learns
  something, and its bounded end is the purge.
- **Compaction is not scheduled** (section 11).
- **The allowance arm of the capability rule cannot fire here** (section 13).
- **Confluence agent actions elsewhere.** The five `confluence_*` actions carry
  `requiresProduct: "confluence"`, and the listener, job and Coder save paths build their
  gate context with the default product list (`["jira"]`), so on those surfaces the actions
  are refused at save time with `missing-product:confluence`. Today the Virtual
  Administrator's powers are the only way to hold them.
- **Memories are not injected.** The knowledge block is built with `useMemories: false`;
  skills are, up to 4.
- **The dev test hook cannot drive a tick.** `invokeResolver` in `src/test-hook.js`
  deliberately excludes `runVaTickNow`, `runVaPostNow`, `pauseVa`, `resumeVa` and
  `vaCatalog`; the live proof script reaches the same task bodies through allow-listed doors.
- The tick receipt's `skipped[]` is capped at 50 entries and the Agents tab reads at most 20
  receipts, 50 effects and a 60-row item scan (`VA_ADMIN_*` in `src/va-admin.js`).

## 16. Testing

Offline, no Forge runtime (auto-discovered by `npm run test:offline` in `test-harness/`):
`va-config.test.mjs` (every clamp at both ends, the site-wide write refusal, the two dropped
fields), `voice-lint.test.mjs` (a BLOCK and an ALLOW per rule, human samples pass, generated
samples fail), `va-ledger.test.mjs` (the state machine, TTL refresh, LRU parking by state,
attempts, fingerprints, claims, effects binding, caps, health, purge, memory), `va-wizard.test.mjs`
(the field order, model JSON trust, byte-identity of the two doors), `va-admin.test.mjs`
(save path, dry search, shadow re-arm, approve and reject, run now), `va-agent-deps.test.mjs`
(the real dispatcher with the real deps), `rules-api-agents.test.mjs` (floors, statuses, the
same body through both doors stores an identical record), and `kvs-key-shapes.test.mjs` for
every key builder.

Live: `test-harness/scripts/va-shadow-live.mjs` creates one agent on a service desk, runs its
prepare tick, reads the staged drafts, runs the post phase, and proves with a second REST
read of every issue's comment list, before and after, that nothing was posted in shadow;
then it pauses the agent, re-ticks to prove attempts do not move, and deletes what it made.
