<!--
 CogniRunner - AI-powered workflow validation for Jira
 Copyright (C) 2025 LeanZero
 SPDX-License-Identifier: Apache-2.0
-->

# CogniRunner — Release Notes

---

## 1.5, Virtual Administrator and Confluence (2026-09-13)

1.4 shipped an agent a person drives from inside an issue. 1.5 ships one that works alone:
a Virtual Administrator that sweeps a service desk queue on a schedule, stages a reply, and
sends it on a later tick only after eleven checks, plus a reach into Confluence for rules
and agents. Two reference pages carry the detail,
[`VIRTUAL-ADMINISTRATOR.md`](VIRTUAL-ADMINISTRATOR.md) and
[`CONFLUENCE.md`](CONFLUENCE.md); everything below was read from the code on `main`.

### The Virtual Administrator

A scheduled job with `mode: "va"`, not a new kind of rule: it lives in the job index, is
planned by the same 5-minute tick, and is reachable through the Agents tab and the Rules
REST API. The record (`src/shared/va-config.js`) carries a persona and a voice, a read scope
that may be site-wide and a write scope that never is, an intake of service desk queues, a
JQL filter and mentions, a cadence with a posting window, a closed list of powers, and the
guardrails the engine enforces. Every number is clamped toward the restrictive end and
every clamp is reported back; a site-wide write scope is refused outright.

Two doors build the same record: a setup interview whose field order is in code and whose
model only writes the sentence above the controls, and a classic form. Both go through one
save path that checks project keys, desks, queues, time zones and skills against what the
site has, executes a changed JQL dry inside the read scope before it becomes standing
intake, re-arms shadow mode on any configuration change, and derives the schedule from the
cadence.

### The two-phase day

A prepare tick sweeps at most 50 candidates (queues, then the scope-wrapped JQL, then
mentions), diffs them against a per-item ledger by an authorship-aware fingerprint, and fans
out at most `maxItemsPerTick` item turns; it calls no model. An item turn is one bounded
`runAgentLoop` on one issue, on the Agent model, behind a fail-closed `va_exec` claim taken
by the consumer. Speech is never direct: `stage_reply` writes a draft to the ledger, and a
separate post task delivers it only when the wall-clock floor holds (at least
`minPostGapMinutes` and a later tick than the one that staged it) and the gates pass in
order: paused / shadow / kill switch and the posting window, attempts, freshness (a human
spoke since: the draft is dropped and the item re-queued), other-writer quiet, anti-pile-up
(owed overrides), audience (public only to the reporter of a portal request, otherwise an
internal note), caps (hour, day, and a separate owed-per-hour cap; unknown counters block),
write scope from a read of the issue, the voice lint (no bullets, headings, bold, dashes,
disclaimers, banned openers, method leaks or sign-offs; a sentence cap, a word cap per
register and a burstiness rule), the fail-closed `va_post` claim, and a read-back that
verifies the comment's portal visibility and edits a wrong one to internal.

Shadow mode holds every draft until the agent has been watched for its own prepare ticks
(default 3); an admin can approve one draft out of shadow or reject it back to the queue,
and neither posts. Pause, run tick now and post now go through the same claims the
scheduler takes. Three consecutive failed ticks turn the Agents tab banner solid red from
the agent's own health counter. The capability rule is the one predicate every agent surface
asks, checked at the tick and again at the item turn; a refusal is written into the receipt
and the health row.

### Confluence

Three scopes join the manifest (`write:page:confluence`, `read:comment:confluence`,
`write:comment:confluence`), a major version; the app must also be installed on Confluence.
One client (`src/confluence-client.js`) with a closed error set, no retries on writes, a
10 s budget per operation, a version-checked update and 60 KB page clamps; one endpoint
catalogue shaped like the Jira one. The **Confluence validator** searches live on every
transition from a CQL template whose placeholders are substituted as quoted literals by one
escaper, or reads the top three pages and lets the validator engine judge them; an
unreachable Confluence allows unless Strict, a misconfigured rule blocks either way. The
**condition** is one more branch of the single manifest expression over the advisory
`cognirunner.confluence` property, missing means show. Two **post-functions**: a queued
page writer that authors from the issue, creates once and updates after, links the page and
records the property; and an inline, deterministic comment on the linked page. Five
**agent actions** (`confluence_search`, `confluence_get_page`, `confluence_create_page`,
`confluence_update_page`, `confluence_add_comment`): the model never writes CQL or storage
XHTML, every write is bounded by a per-agent space allow-list resolved from a read of the
page, and a site without the app on Confluence answers a named refusal, never an empty
result.

### Also

- `?resource=agents` on the Rules REST API, a view over `?resource=jobs` filtered to
  `mode: "va"` with the Agents tab's floors (editor for the overview, admin for drafts,
  effects, memory and every write); `?resource=jobs` refuses a VA row by name.
- Token roles on the REST surface (`viewer`, `editor`, `admin`) are minted in Settings and
  gate every resource through one predicate; an editor token acts as the account that
  minted it.
- `va-tick` joins the non-AI task types; `va-item` and `va-post` are paced by the token
  budget like every other queued AI task.
- Deleting an agent purges its index, health and memory rows and up to 200 item rows; the
  rest expires on the 90-day item TTL.

### Known limitations

- **Writes as the app user.** Everything the agent posts or changes is authored by the app's
  own account; the persona name is in the text, never the author.
- **No configuration writes**, by construction: there is no action for schemes, workflows,
  permissions, roles or fields, and `propose_change` is the only route.
- **Memory compaction is not scheduled.** `compactMemory` exists with its pinned-constraints
  guarantee, but no task calls it; a memory over the 8 KB cap is clamped, constraints kept.
- **The allowance arm** of the capability rule cannot fire on the VA path, because the
  monthly allowance is computed inside `src/index.js` and is not exported.
- **Confluence actions on listeners, jobs and the Coder** are refused at save time with
  `missing-product:confluence`; the Virtual Administrator's powers are the only way to hold
  them today.
- **No `api.confluence.*` in the sandbox.** The planned spec entry is not in the tree.
- **The not-installed response is uncaptured**; the client maps anything unrecognised to
  `confluence_unavailable`, which fails open with the reason.
- **The dev test hook cannot drive a tick**; the live proof reaches the same task bodies
  through allow-listed doors.

---

## 1.4 — Coder (2026-09-13)

1.3 sold the Coder edition; 1.4 ships the Coder. An engineer inside the Jira issue, a
workflow post-function that hands a transition to the same engine, and the Git layer both
run on: connections with write-only credentials, a signed webhook that turns repository
events into listener runs, a deterministic pull-request reviewer, and Git validators and
conditions. Two reference pages carry the detail, [`CODER.md`](CODER.md) and
[`GIT-INTEGRATION.md`](GIT-INTEGRATION.md); everything below was read from the code on
`main`. The 1.5 work (the Virtual Administrator, the Confluence rules) is in progress and
is not part of this entry.

### The capability rule

One predicate, `agentCapability` in `src/shared/edition.js`, decides whether any agent
surface may run. On a BYOK provider it is on for every edition. On Atlassian (Forge LLM)
it needs the Coder edition and a frontier agent model (Sonnet 5 or Opus 5; Haiku never
drives an agent), and it pauses at the monthly allowance's hard cap. The sentence for each
reason lives beside the predicate, so the Code tab, the action checklist, the issue panel
and the backend refusal all say the same thing; a capability read that fails renders the
off state, never an enabled control.

### The Coder in the issue

The **CogniRunner Coder** issue panel: tell the Coder what to do on the issue, pick a
connection, choose a dry run or a live run (fixed by the conversation's first turn), and
send. A turn runs on a new 900 s consumer, one turn per issue, up to eight rounds. Every
repository write is a consent chip naming the action and a preview of its arguments, with
**Confirm / Change / Skip**; the decision is recorded in the thread verbatim and survives
compaction. Each turn writes back onto the issue: a plan section in the description
between visible markers, one comment per confirmed step with the repository, branch and
pull request as remote links, a running "Coder log" comment edited in place, and a
`coder-session-<n>.md` transcript.

### The Coder post-function

The premade post-function **Coder: build / open branch / open PR / fix / review** hands a
transition to the engine in one of five modes, each with a fixed instruction and a ceiling
on the actions it may hold. It is always queued, never inline. Headless means no consent
tickets: a write the gate allows executes, one it refuses halts the turn and says why, and
write actions survive only on a rule an admin saved. A `strict` flag chooses whether an
environment problem (capability off, dead token, repository not allow-listed) is logged as
a skip or an error; a misconfigured rule is an error either way.

### Git connections, the webhook, the events

Admins connect GitHub or Bitbucket Cloud in the new **Code** tab. A token is verified with
`whoami` before it is stored, is never returned by any resolver, and every connection
carries an admin-edited repository allow-list that fails closed when empty. A dead
credential is loud: the row is marked, the tab shows a banner, and the validators' Strict
option reads the same flag. Rotation is a queued task, never a resolver.

The production webhook (`git-webhook`) routes on `?conn=&repo=`, verifies a SHA-256 HMAC
over the raw body with a per-repository secret, answers inside GitHub's 10 s window, claims
every delivery id for 24 h before it enqueues, and refuses everything else with the
documented 401 / 404 / 503 / 202 answers. Nine Git events join the one event catalogue
(pull request opened / updated / closed / merged, review submitted, PR comment added,
branch pushed, check run completed, pipeline completed); every one requires a repository
allow-list on the listener, and `ignoreSelf` compares the actor with the connection's own
login. The consumer writes the advisory `cognirunner.git` issue property for the issue keys
a delivery names.

### PR review, validators, conditions

A listener on the PR events can run the deterministic review engine
(`agentlessTaskType: "gitreview"`): one review per head SHA, the diff capped and fenced,
the model's findings clamped in code, at most one general and ten inline comments per run
and six reviews per repository per hour, and a verdict posted as text unless an admin-saved
rule allows the action. Four Git validators (build passed, PR approved, comments resolved,
PR merged) verify live on every transition; the property only nominates the pull request,
and the live pull request must name the issue key. Three Git conditions hide a transition
on a known-negative recorded state and never block on a missing property.

### Agents

The action catalogue gains the `git` and `web` namespaces behind one gate with four inputs
(capability, products, trigger source, the saver's role). `web_search` refuses any query
that carries an identifier from the instance, returns at most five fenced results with a
reading rule, and is budgeted per turn (3), per run (10) and per installation (300 per
5 minutes). Listener and job agents can bind up to four Skills and opt into Memories
(`agent.skillIds`, `agent.useMemories`); scheduled jobs gain a per-run write brake
(`maxWritesPerRun`, default 200) and four multi-hour cadence presets; the installation
gains an agent-run brake (200 per 5 minutes). Refusals over the Rules REST API carry the
same `reason` / `needsRole` / `hint` / `refused[]` fields the resolvers return.

### Providers

The Anthropic adapter marks a caller-declared stable prefix with `cache_control` so an
agent turn's later rounds read the system prompt, the tool definitions and the thread
history from the cache; one-shot callers are unchanged. The token budget queue prices a
Coder turn at 16,000 tokens and a PR review from its diff size, so both are paced like every
other queued AI task on Forge LLM.

### Also

- The manifest grows one issue panel (`coder-panel`, on the existing issue-glance bundle),
  one web trigger (`git-webhook`), one consumer (`long-consumer`, 900 s) and backend-only
  egress to `api.github.com`, `api.bitbucket.org` and `bitbucket.org`. No new scopes.
- Pipeline setup exists as admin resolvers (`setupGitPipeline`, `getGitPipelineStatus`,
  `triggerGitDeploy`) with a permission lock and a fixed scope allow-list; see the
  limitations below.

### Known limitations

- **Bitbucket adapter unproven.** The Bitbucket Cloud adapter, its webhook mapping and its
  review path are written and covered by the mocked-fetch suite, but have not been run
  against a real workspace. On GitHub the webhook signature construction was verified
  against a real delivery and the inbound path was proven live with self-signed deliveries;
  the adapters themselves are proven on mocked fetch.
- **Webhook secret provisioning.** The per-repository signing secret is minted by
  `ensureHookSecret`, which no admin resolver or Code tab control calls yet, and the
  adapters' `createWebhook` is not called from the product. A real repository cannot be
  wired to the production webhook from the app; the live proof used the dev harness to
  plant the secret.
- **Managed key not shipped.** There is no vendor-managed Anthropic provider; the Coder
  runs on the tenant's own BYOK key or on Forge LLM under the edition rule above.
- **Pipeline run unproven.** The pipeline setup chain and the rendered workflows have not
  been exercised against a real Atlassian API token; the Forge deploy identity's token is
  stored without verification (the app has no egress to `*.atlassian.net`), so a mistyped
  token surfaces on the first deploy.
- **Knowledge packs not yet shipped.** The field-guide selector (`src/shared/knowledge-select.js`)
  and its per-audience budgets are in the tree, but no packs are baked and nothing injects
  a field guide into a prompt.
- **No one-click premade listener.** The "Review every opened PR" seed exists in the
  catalogue, but the Listeners tab does not offer it; push the shape over the Rules REST
  API.
- **Skills and memories on rules are REST-only fields.** The Listeners and Scheduled Jobs
  editors do not expose `agent.skillIds`, `agent.useMemories` or `maxWritesPerRun` yet.
  Coder turns bind no skills (nothing passes `skillIds` to them).
- **GitHub review-thread resolution** is not readable over REST, so `git-pr-comments-resolved`
  reports it as unknown on GitHub (Strict decides).

---

## 1.3.0 — Editions (2026-09-12)

CogniRunner is now sold as two Marketplace editions. **Standard** is the app you already
have. **CogniRunner Coder** — the Marketplace *Advanced* edition — unlocks the frontier
Claude models on the zero-key Atlassian (Forge LLM) provider and lays the foundation the
1.4 and 1.5 agent features (Coder chat, PR review, the Virtual Administrator) will build on.
Every decision below lives in one module, `src/shared/edition.js`, and was verified against
a live install.

### Claude Sonnet 5 and Opus 5 on Forge LLM, for Coder

On the Atlassian (Forge LLM) provider the Standard edition runs Claude Haiku
(`claude-haiku-4-5-20251001`). Coder adds `claude-sonnet-5` and `claude-opus-5`. The model
lists are exact ids — an older Sonnet or Opus id is refused on every edition — and the same
clamp is applied when a model is listed, saved and loaded, and again inside the chat
adapters of both the synchronous backend and the async consumer, so a stale or downgraded
configuration can never bill a frontier model.

**Nothing changes on BYOK providers.** OpenAI, Azure, OpenRouter, Anthropic, Bedrock and
LM Studio are billed to you, so every model your provider lists stays available on either
edition.

In **Settings**, a Standard site still sees Sonnet 5 and Opus 5 in the Forge LLM model
picker, as locked rows with a **Coder** badge, and saving one returns an upgrade prompt that
points at Jira's Manage apps. If a saved model falls outside the edition, the panel says so
and names the model that is actually being served (Haiku).

### A monthly allowance for vendor-billed models

Forge LLM tokens are billed to the vendor, so a Coder tenant gets a monthly allowance that
scales with the seats it pays for: `clamp(seats × $2.00, $40, $800)`. Seats are counted from
the site's active Atlassian-account users when an admin opens the panel (at most once a day,
never from a transition); when the count is unknown the allowance is computed for 100 seats.
Spend is estimated per model tier from assumed per-million-token rates — Atlassian has not
published Forge LLM pass-through rates and the Claude 5-series list prices were not public
at ship time, so the numbers drive the meter only and nobody is billed from them.

The **Forge LLM allowance** meter in Settings shows estimated spend against the allowance.
At 80 % it warns. At 100 % every Forge LLM call runs on Claude Haiku until the month rolls
over — saved rules keep running, on the default model — and each forced downgrade is
counted so the panel can show why. An unknown allowance never pauses anything.

### A separate agent model

Each provider now has an **Agent model** slot next to the rule model, for the agent surfaces
1.4 and 1.5 introduce. A tenant can run a hundred validators on Haiku and its one agent turn
on a frontier model. On Forge LLM the slot is frontier-only — Sonnet 5 or Opus 5, on Coder;
Haiku never drives an agent — while BYOK providers accept any model id. Model ids from both
save resolvers go through one server-side normaliser.

### Lapsed subscriptions fall back to Standard

The edition is read live from the platform license on every invocation that carries one, so
an expired Coder subscription is Standard on the next read. Only a runtime whose context has
no license at all (the async consumer, a webtrigger) reads a snapshot — written by the paths
that do see the license, expiring after two days, and honoured only when it recorded an
active Coder license. Two days is the longest a lapsed subscription can keep a frontier
model authorised on such a runtime.

### Also

- **Forge LLM rate limit.** The platform caps 50,000 tokens per minute per installation per
  model. Background AI work (queued post-functions, listeners, jobs, code generation, fixes,
  reviews, distillation) is paced by a tokens-per-minute budget queue — 35,000 by default for
  Forge LLM, set under **Settings → AI token budget** — so a burst never turns into HTTP 429
  for a user-facing validator. Design notes: `docs/PROMPT-token-budget-queue.md`.
- `checkLicense` now also returns the edition, its label, the capability set, where it was
  read from, and the Coder feature list with a per-feature `allowed` flag. `isActive` is
  unchanged.
- `checkProviderHealth` reports the model the adapter actually used and whether it was
  clamped, computed from the edition policy rather than from what the provider echoed.
- The UI apps compare editions through one shared id table (`EDITION_IDS`), so a
  comparison can no longer silently be false; the allowance meter refreshes live.
- Four UI bundles are shipped: the config editor, the read-only view, the admin panel and
  the issue-glance panel.

### For anyone reading the docs

`docs/AI-PROVIDERS.md` → *Editions and the Forge LLM model policy* is the technical
reference (resolution rules, every enforcement seam, the allowance maths, the agent slot);
`docs/FEATURES.md` section 17 covers what an admin sees; the README's *Editions* and
*Pricing* sections are the short version.

---

## 1.2.0 — Listeners, Scheduled Jobs, and a Rules REST API

Until now CogniRunner could only run when an issue crossed a workflow transition. This
release adds the two other "ways to run" that Jira automation has always needed — react
to an **event**, or run on a **schedule** — and a REST API to provision both from CI or a
migration script. Everything below was exercised against a live Jira, with the receipts
committed under `docs/reviews/`.

### Listeners: react to any of 68 Jira product events

A listener picks one or more Jira, Jira Software or JSM events (issue created/updated,
comments, worklogs, attachments, links, versions, components, sprints, boards, users,
fields, filters, configuration, request types) and filters them by project, issue type,
JQL, changed fields or a comment regex. An optional plain-language **AI condition** gates
the run and fails closed. What runs is either **code steps** — the same sandbox `api.*` as
static post-functions, bound to the event's issue — or an **AI agent** given instructions
and an allow-list of actions.

Listeners are protected against the classic automation loop: *ignore self-generated
events* is on by default, and per-issue and per-listener brakes cap runs within a
five-minute window. Every accepted event is claimed at-least-once so a redelivered event
never runs twice. **Test with an issue** builds a synthetic event from a real issue and
runs the whole thing in simulation; once the event has fired for real, the last payload
can be inspected — with any capability tokens removed from what is stored and shown.

### Scheduled Jobs: cron, with an optional JQL scope

A job runs on a five-field cron expression in an IANA time zone, either once with no
current issue, or once **per issue** of a JQL scope (capped at 100), the way an escalation
service does. Jobs run manually or on the platform's five-minute tick; duplicate ticks are
idempotent per minute and can never double-run a job. Scoped runs record a per-issue
outcome that the history view now shows in full.

### The Rules REST API

Mint a bearer token in **Settings → API access** (admin only; only the hash is stored) and
push listeners and jobs as JSON: single objects, arrays of up to 100, partial updates,
enable/disable, test, run, and read-back of logs, samples and catalogues. Partial batch
failures return HTTP 207 with the index of every rejected row. Rows created this way are
tagged with the token that made them. Workflow rules still attach through Jira's own
workflow API, as documented in `docs/REST-API-RULES.md`.

### Also

- Run and error counters are now accounted through serialized receipts, so concurrent
  runs can no longer lose or double-count a result, and deleting a rule clears its
  statistics atomically.
- A step that throws a string, a number or `null` is reported as the failure it is
  instead of aborting the steps after it, and **Fix with AI** learns from the step that
  actually failed.
- Key-optional sandbox methods default to the current issue; an explicitly empty issue
  key throws instead of silently writing to the bound issue.
- Simulated `createIssue` and `cloneIssue` return distinct Jira-shaped identities that
  later steps can use; a simulated read never reaches Jira.
- Workflow **Test Run** uses the same simulation as listener and job tests.
- Attachment read and upload capabilities are claimed atomically, so a replayed link
  can never be used twice.
- A generated document is only reported as *attached* when Jira returned a concrete
  attachment id.
- The admin panel stays usable at Jira's narrowest iframe width; nothing overflows and
  every action stays reachable.
- `@forge/api` 7.2 and `@forge/events` 2.1.7.

### Video tutorials

Seven short walkthroughs, one per feature, plus a five-minute compilation:
[7 AI workflow features in 5 minutes](https://youtu.be/oxtNm9gNKYQ) ·
[the complete walkthrough](https://youtu.be/CNvAvb-f5f4) ·
[AI validator: require any field](https://youtu.be/aEhHZvUd1ms) ·
[Given-When-Then acceptance criteria](https://youtu.be/FB1uED9Ih18) ·
[condition: hide a transition](https://youtu.be/qU_JHctH8xk) ·
[condition + PDF post-function](https://youtu.be/ZWIyl4D8KeA) ·
[generate a PDF from an issue](https://youtu.be/8kJeXSGUQHk) ·
[listener: auto-triage new issues](https://youtu.be/heK5P7EaQMg) ·
[scheduled job: flag unassigned tickets](https://youtu.be/nmqIE56EM_k).

### For anyone reading the docs

`docs/LISTENERS-AND-JOBS.md` is the guide; `docs/FEATURES.md` sections 14 and 15 cover
the admin panel surface. The roadmap's "deferred" note on listeners and jobs is closed.

---

## 1.1.0 — Rule management, and conditions that actually work

This release is about **control**. CogniRunner could already attach far more rules
to Jira than it could administer, and once you crossed that line there was no way
back: the registry filled up, the panel told you to delete rules it had no button
for, and new rules silently failed to save. At the same time, conditions — a rule
type shipped since the first version — had never done anything at all.

Both are fixed, and every fix is pinned by a test that runs against a real Jira.

### You can now delete a rule, and deleting it means it stops running

The Rules tab has per-row **Delete** and multi-select bulk delete. Until now
`removeConfig` and `removePostFunction` existed in the backend with **no caller
anywhere in the UI** — and even if you reached them, they only deleted the registry
row. The rule stayed attached to its transition and kept executing, now with no
interface left to disable it.

Delete now offers two clearly-labelled outcomes, and does not quietly pick for you:

- **Delete everywhere** (the default) removes the rule from the Jira workflow
  transition, so it stops running.
- **Remove from this list only** says plainly that the rule *keeps running* and
  that you lose the ability to disable, view or explain it.

The dialog also warns before the trap: because a rule's disabled flag lives on the
registry row, removing only that row **re-enables a disabled rule**. It tells you
how many of your selected rules that applies to.

A dry run behind the dialog reports, per rule, whether it can actually be located
on its workflow ("already gone", "more than one identical rule on that transition"),
and flags when a workflow is shared by several projects.

### The registry stops being a dead end

- A usage meter on the Rules tab shows real pressure (`487 / 500 rules · 190 KB of 246 KB`),
  measured in bytes against the registry's true capacity and computed site-wide
  rather than from whatever your current filter shows.
- **Import** now checks the cap. It previously had no check at all, so at the limit
  it would attach a live workflow rule and then fail to register it — creating
  exactly the unmanageable rule this release exists to eliminate.
- **Register all** reports what it did. It used to discard its own result, so a run
  that silently skipped hundreds of rules at the cap looked like a clean success. It
  now batches, reports skips, and stops early rather than burning calls that can only
  be refused.
- The "registry is full" message finally names a control that exists.

### "My Rules" only shows rules you made

Two things put other people's rules in your list: ownerless rows matched *every*
user, and **Register all** stamped whoever clicked it as the author of every rule it
claimed. Claiming a rule is not authoring it — claimed rules are now recorded as
unowned, with a separate audit trail of who claimed them, and a one-time repair
un-attributes rules that were already mis-stamped. Admins get an Owner column with
an explicit **Unowned** chip, so it is visible *why* a rule is or isn't yours.

### Rules show the transition they're really on

A rule discovered by a workflow scan displayed as `Any status → ZSCALE-pv12` —
the transition's **name** was being rendered where its destination **status**
belongs. Rules now show the transition name and the real status edge separately
(`ZSCALE-pv12 · Backlog → Backlog`).

### A claimed post-function can finally be disabled

Registering a discovered post-function produced a row with a Disable button that
did nothing: the row was keyed by one identity and the runtime looked it up by
another, so the two never met. They meet now — carefully, because this sits on the
path every transition takes. A disabled rule's siblings on the same transition keep
running, and a post-function can never mute a validator.

### Conditions now work — and never use AI

CogniRunner conditions have never gated anything. The module shipped with a fixed
`expression: "true"`, alongside a `function:` key that is not part of Jira's
condition module at all and was silently ignored — which is why the app's own
documentation, and our test suite, believed a lambda was involved.

Two consequences, both now settled by testing rather than assumption:

**An AI condition is impossible.** Jira evaluates a condition itself, as a Jira
expression, in a sandbox with no network access. No app can call a model from one.
That is permanent, and it is not a CogniRunner limitation.

**A deterministic condition works everywhere.** Conditions are back in the Add Rule
wizard, offering ten checks — issue type, whether the issue is resolved, its
resolution, its priority, the parent's status, whether the current user is the
assignee or reporter, and three field checks on **custom fields**: has a value, is
empty, equals a value (case-insensitive; text, URL, date, number, select and radio
fields — multi-value fields support has/empty). Two things worth knowing about the
field checks: a field hidden by a field configuration reads as empty, and an empty
field never hides an equals check (combine it with "Field has a value" if it
should). They cost nothing per
transition, add no latency, cannot fail open on a provider outage, and are enforced
on every surface: the issue view, REST, automation and bulk changes.

> The last two are worth calling out: "current user is the assignee/reporter" cannot
> be done as a *validator*, because Forge withholds the acting user from a validator
> function. Jira's expression engine provides it — so those rules work as conditions
> and only as conditions.

**The three field checks shipped the careful way.** They were originally withdrawn:
Jira's expression engine names and types issue fields differently from the field
picker, and a mismatch would **hide** a transition rather than show it — failing
closed, in a product whose whole runtime law is to fail open. They now ship for
**custom fields of verified kinds only**, after a 41-case live probe pinned the
semantics per field kind: the expression only ever reads a field through a
`customfield_`-guarded accessor (so the naming mismatch is structurally impossible),
every typed comparison runs only for the field kind it was proven on, and anything
unrecognised still falls open. System fields stay excluded until each is verified
individually.

Existing conditions are untouched: anything the new logic doesn't recognise is
allowed through, exactly as before. Opening an old condition shows the AI prompt it
was saved with, explains that it never ran, and lets you convert it.

### Also

- Disabling a condition now really disables it. Jira cannot read app storage, so the
  flag is written into the workflow rule itself; if that write fails, the rule is not
  marked disabled — a half-applied disable is worse than a refused one.
- Deleting a rule can no longer detach a *different* rule that another registry row
  owns.
- Adding a rule from the wizard records the workflow rule's identity, so a later
  delete targets exactly that rule instead of inferring which one you meant.
- Every workflow write (add and remove) retries on a version conflict instead of
  failing when someone else edits the workflow at the same time.
- The Rules tab explains all three rule types, not just post-functions.
- A Forge log line that dumped up to 500 account IDs on every Rules-tab load is gone.

### For anyone reading the docs

Harness finding **F3** ("Forge conditions are not enforced on the REST transition
path") was **wrong**, and the claim had spread to roughly sixteen places. Jira does
enforce conditions over REST. The observations behind F3 were real; the explanation
was not — our own manifest was the cause. F3 is now marked re-diagnosed with the
evidence that disproves it, and the docs, listing copy and barrage baseline have been
corrected to tell one story.

### Testing

A new regression gate runs before the main suite and covers each defect above with a
guard named for the finding it defends. It refuses to report a skip as a pass.

| Guard | Proves |
|---|---|
| `reg-delete-detaches` | delete removes the rule from the workflow and the blocked transition then succeeds |
| `reg-conditions-enforce` | every condition type, both directions, on the listing **and** over REST |
| `reg-pf-disable` | a disabled post-function skips while its sibling and a validator keep working |
| `reg-global-validator-e2e` | a validator on `Any status → X` blocks a Spanish summary — the originally reported bug |
| `configs-filter` / `registry-limits` | ownership filtering and the registry caps |

`reg-global-validator-e2e` asserts the execution log, not just the HTTP status: a
validator that fails open lets a transition through exactly like a pass does, so the
verdict must be a genuine AI decision and its reason must not look like an outage.

This release also came out of an adversarial review that raised 22 findings and
confirmed 7 after independent refutation. Five of them were the field-based
condition mistake above — caught before release, not after.
