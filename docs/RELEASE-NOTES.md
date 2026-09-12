<!--
 CogniRunner - AI-powered workflow validation for Jira
 Copyright (C) 2025 LeanZero
 SPDX-License-Identifier: Apache-2.0
-->

# CogniRunner — Release Notes

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
