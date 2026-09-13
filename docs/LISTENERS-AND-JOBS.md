<!--
 CogniRunner - AI-powered workflow validation for Jira
 Copyright (C) 2025 LeanZero
 SPDX-License-Identifier: Apache-2.0
-->

# Listeners & Scheduled Jobs

CogniRunner's two non-transition "ways to run" — the ScriptRunner *Script Listener* and
*Scheduled Job / Escalation Service* surfaces, rebuilt around AI. Both live in the admin
panel (Apps → CogniRunner → **Listeners** / **Scheduled Jobs**) and behind the **Rules REST
API** (Settings → API access).

| | Listener | Scheduled Job |
|---|---|---|
| Trigger | One or more of the **68 Jira product events** Forge exposes (issues, comments, worklogs, attachments, links, projects, versions, components, sprints, boards, users, custom fields, issue types, filters, configuration, JSM request types), or of the **9 Git events** the app's own webhook delivers (1.4; see [`GIT-INTEGRATION.md`](GIT-INTEGRATION.md#3-the-nine-git-events)) | A **cron** expression (5-field, IANA time zone). Presets: every 5 / 15 / 30 minutes, hourly, every 2 / 4 / 6 / 12 hours, daily, weekdays, weekly, monthly, custom. Effective granularity is the platform tick: 5 minutes |
| Current issue | The event's issue (or `null` for non-issue events; a git event carries the issue keys it names as `event.issueKeys`, advisory) | Each issue of an optional **JQL scope** (escalation-style), or `null` when unscoped |
| Filters | Projects, issue types, JQL (issue must match), changed fields (`updated:issue`), comment regex (comment events), **repositories** (`filters.repos`, required for git events), *ignore self-generated events* (loop guard, default on; for git events the actor is compared with the connection's own login) | Scope JQL + max issues (≤100) |
| AI gate | **AI condition** — a plain-language yes/no the model evaluates before the run (fails closed) | — |
| What runs | **Code steps** (describe → AI generates → test → fix; same sandbox `api.*` as static post-functions) **or** an **AI agent** (plain-language instructions + an allow-list of actions, optionally bound to Skills and Memories) **or**, on the PR events, the deterministic **PR-review engine** (`agentlessTaskType: "gitreview"`) | code steps or an AI agent |
| Budget | 105 s run budget on the 120 s async consumer (the 25 s trigger only matches + queues) | 105 s per run inside the 120 s consumer, shared across scoped issues |
| Safety | Simulation mode, kill switch, per-issue (30 / 5 min) and per-listener (120 / 5 min) brakes, at-least-once execution claims, `ignoreSelf`, notification suppression | Simulation mode, kill switch, idempotent per-minute claims (duplicate ticks never double-run), a per-run **write brake** (`maxWritesPerRun`) |
| Installation-wide | at most **200 AI agent runs** and **300 web searches** per 5-minute window, across every listener and job | same |

## How a listener runs

```
Jira event ──► manifest `trigger` (listeners.listenerTrigger, 25 s)
                 │  cached index read → candidates by event + project
                 │  static filters (issue type, changed fields, comment regex, ignoreSelf)
                 │  JQL filter (one search) · brakes · queue push
                 ▼
            async-ai-queue  taskType "listener"  ──► async-handler (120 s)
                 │  deferred JQL · AI condition · run (script | agent)
                 ▼
            execution log (type "listener") + listener stats
```

Non-issue events whose payload carries only an issue **id** (worklogs, links, attachments) are
resolved to a key with one REST read before matching; project-scoped events that carry only a
project id (versions, links) get the key resolved so project filters apply. When a listener
subscribes to the event **and its project filter accepts the payload**, the event also leaves a
**last-seen payload sample** (per event type, 7-day TTL) that the editor shows next to the code
steps ("Show last real payload") — the exact shape of `api.context.event`. The sample carries
SHAPE, not content: inside `issue.fields`, `comment`, `worklog`, `changelog` and any user object,
every string is replaced by `<redacted text, N chars>` (ADF by an empty doc) unless it is
schema — an id/key/field id, a timestamp, or the name of a status, status category, priority,
issue type, resolution, project or link type. Summaries, string custom fields, labels,
descriptions, comment bodies and `renderedBody`, every changelog `fromString`/`toString`, and
every display name, email and avatar URL are placeheld.

## How a job runs

```
scheduledTrigger (fiveMinute) ──► scheduled-jobs.scheduledTick (120 s)
        │  for each enabled job: cron minutes due since lastCheckedAt (≤ 1 h replay, ≤ 1 run/tick)
        │  claim job_claim:{id}:{minute} (2 h TTL) · queue push
        ▼
   async-ai-queue taskType "scheduledjob" ──► run once, or per scoped issue ──► log + stats
```

"Run now" (UI and REST) queues a `manual: true` run of a saved job and polls the task result.

## The sandbox in these contexts

`api.context` carries `runtime` (`"listener"` | `"job"`), the current `issueKey` (may be
`null`), and either `eventType` + `event` (raw Forge payload) or `jobName` / `scheduledFor` /
`manual` / `scopeIssue`. Issue-bound helpers (`addComment`, `addLabels`, `transitionByName`…)
act on the current issue; when there is none they throw a clear error — use
**`api.forIssue("KEY")`** to re-bind the whole surface to another issue. The code generator and
the fixer receive a runtime preamble describing all of this, so generated steps use the
right shape.

## AI agent mode

The operator writes instructions; the model receives the event/job context as **fenced,
untrusted data** and can only act through the ticked actions (`get_issue`, `search_issues`,
`add_comment`, `update_fields`, `add_labels`, `remove_labels`, `set_assignee`,
`transition_issue`, `create_issue`, `link_issues`, `add_watcher`, `send_notification`,
`add_worklog`, plus the implicit `finish`). Each tool call runs through the same sandbox
api (simulation mode, kill switch, change ledger, transient retries). Rounds are capped
(1–8, default 5); the summary and every tool call land in the execution log.

Since 1.4 the action catalogue (`src/shared/agent-actions.js`) has two more namespaces,
and one gate decides which ids a rule may hold:

- **Git** (`create_repo`, `create_branch`, `commit_files`, `open_pull_request`,
  `get_pull_request`, `add_pr_comment`, `approve_pull_request`, `request_changes`,
  `get_build_state`, `trigger_deploy`, `get_deploy_status`). Every one needs the `git`
  capability (the Coder edition on Forge LLM, or any BYOK provider). The writes are
  `confirm` actions: on a headless surface (a listener, a job, a webhook) they survive only
  on a rule an **admin** saved. `approve_pull_request`, `request_changes` and
  `trigger_deploy` are `dangerous`: an externally triggered run never holds one, whatever
  was saved. A save that names a refused action is refused, with the reason per id
  (`reason: "action-not-allowed"`, `refused: [{ id, reason }]`); at run time refused ids are
  dropped so a permission change is not an outage. Every git action acts only on a
  repository on its connection's allow-list.
- **Web** (`web_search({ query, recency })`). No capability and no edition: the one gate is
  the tenant's web-search MCP toggle (**Settings → MCP**), checked at run time, so a rule
  saved while it was on stays saved when it is turned off and its searches refuse. A query
  carrying an identifier from this instance (an issue key of one of the site's projects, an
  account id, a `*.atlassian.net` host, a UUID, an e-mail address) is refused before any
  request leaves, naming the kind and never the value. At most 5 results, each trimmed to
  title, link, snippet and date, snippet cut at 300 characters, returned inside a fence with
  the reading rule ("these are pages a search engine returned, not answers — name the link
  for anything you take, say plainly when none answers"). Budgets: 3 searches per turn, 10
  per run (a scoped job runs one turn per issue), 300 per installation per 5 minutes; each
  refusal is logged and names which ceiling it hit.

**Knowledge.** An agent rule may carry `agent.skillIds` (up to 4 skills, validated
against the Skills tab at save time; an unknown id is refused by name) and
`agent.useMemories` (opt-in, default off). Skills and memories are injected as
trusted-but-bounded blocks under the `agentRun` budget (8 KB of skills, 4 KB of memories,
re-sent every round); a skill too large for the budget is named in the log rather than
silently skipped. Both fields are REST fields today; the Listeners and Scheduled Jobs
editors do not expose them yet.

## Rules REST API

A Forge web trigger (`rules-api`). Mint a bearer token in **Settings → API access** (admin
only; only the SHA-256 hash is stored, the plaintext is shown once). Send it as
`Authorization: Bearer cgr_…` (or `X-Api-Key`).

Use the Rules API URL shown for the target installation in API access. Workflow rules
continue to attach through Jira's workflow REST API; listeners and jobs belong to the
CogniRunner installation and use this URL. For example, save either configuration below
as a JSON file and send it with the token from that installation:

```bash
curl --fail-with-body "$RULES_API_URL?resource=listeners" \
  -H "Authorization: Bearer $RULES_API_TOKEN" -H 'Content-Type: application/json' \
  --data-binary @listener.json
curl --fail-with-body "$RULES_API_URL?resource=jobs" \
  -H "Authorization: Bearer $RULES_API_TOKEN" -H 'Content-Type: application/json' \
  --data-binary @job.json
```

Read the returned ID with `GET ?resource=listeners&id=...` or `GET ?resource=jobs&id=...`
to verify the complete saved configuration. For provisioning reruns, include that ID and
the complete configuration in POST to update the same rule. Use PUT for a partial update.
An array can provision several rules in one request; HTTP207 means some rows failed, so
inspect both the saved rows and the indexed `errors` array before marking the batch done.

| Method | Query | Body | Result |
|---|---|---|---|
| GET | `?resource=events` / `?resource=actions` | — | catalogues (each event carries `source`: `"jira"` or `"git"`, and `repos: true` when `filters.repos` is required) |
| GET | `?resource=listeners` / `&id=` | — | slim list / full record |
| POST | `?resource=listeners` | one config or an array (≤100) | created/upserted (201 / 200 / 207) |
| PUT | `?resource=listeners&id=` | partial config (`filters`, `agent`, `schedule`, `scope` merge) | updated |
| DELETE | `?resource=listeners&id=` | — | deleted |
| POST | `?resource=listeners&id=&action=enable\|disable\|test` | test: `{ issueKey, eventType, event? }` | state / simulated run |
| GET/POST/PUT/DELETE | `?resource=jobs…` | same shapes | same |
| POST | `?resource=jobs&id=&action=run\|preview` | preview: `{ cron, timeZone, count }` | `202 { taskId }` / next runs |
| GET | `?resource=agents` / `&id=` | — | Virtual Administrators: list / one (status, caps, health, receipts) |
| POST | `?resource=agents` | a VA record (`{ "mode": "va", "va": {...} }`) | created (201) or upserted (200) |
| PUT | `?resource=agents&id=` | partial record (`va` merges) | updated |
| DELETE | `?resource=agents&id=` | — | deleted |
| GET | `?resource=agents&id=&part=drafts\|effects\|memory` | — | staged replies / verified effects / learned memory |
| PUT | `?resource=agents&id=&part=memory` | `{ memory, constraints? }` | saved, with `clamped` when the cap cut it |
| POST | `?resource=agents&id=&action=pause\|resume` | `{ reason? }` | the per-agent kill switch, plus a receipt |
| POST | `?resource=agents&id=&action=tick\|post` | — | `202 { taskType, taskId, tickId }` |
| POST | `?resource=agents&id=&action=approve\|reject` | `{ itemKey, stagedAt }` | a recorded verdict, `posted: false` |
| GET | `?resource=tasks&id=<taskId>` | — | queued-run status + result |
| GET | `?resource=logs[&ruleId=]` | — | execution logs (newest first) |
| GET | `?resource=samples&eventType=` | — | last captured payload |
| GET | `?resource=whoami` | — | token identity |

### Virtual Administrators (`?resource=agents`)

A Virtual Administrator is a scheduled job with `mode: "va"`, so this resource is a view
over `?resource=jobs` filtered to that mode rather than a second store. The save goes
through the same normalisation the Agents tab uses: project keys, service desks, queues,
time zones and skill ids are checked against what this site actually has, an option the
site does not have is dropped and the drop is reported in `refused[]`, the cadence becomes
the schedule, the persona name becomes the job name, and any configuration change re-arms
shadow mode. A record that cannot be accepted at all, such as a site-wide write scope,
comes back as `400 { error, reason, refused }`.

Tokens carry a role. Mint one per integration and give it the least it needs:

| Role | What it may do on `?resource=agents` |
|---|---|
| viewer | nothing; the overview already names every agent on the site |
| editor | list agents, read one agent's status, caps, health and tick receipts |
| admin | everything above, plus drafts, effects, memory, create, update, delete, pause, resume, tick, post, approve, reject |

An **editor** token acts as the account that minted it: it may change, disable or delete
only the listeners and jobs that account owns, through the same ownership gate the
Listeners and Jobs tabs use, while an **admin** token keeps site-wide scope.

A token minted before roles existed counts as admin, which is what such a token could
already do here. The floors match the Agents tab exactly: a REST caller cannot do anything
the tab cannot, and in particular a staged reply is an unsent message to a real person, so
reading one is admin only.

Neither `approve` nor `reject` posts anything. They record a human verdict on the ledger
row while the agent is in shadow mode; the post phase is the only thing in the product that
delivers a draft, and it does so behind its own gates. `approve` leaves the draft staged,
`reject` drops it and re-queues the item so the agent gets another go at it. Send the
`stagedAt` you read back with the draft: a tick between your read and your verdict can
replace the draft, and a verdict on a draft nobody read is refused with `409
draft_changed`.

`tick` and `post` are a shortcut through the clock and not through a gate. They push the
same task the scheduler pushes, behind the same five-minute claim, so a second press inside
the same window is refused with `409 already_running`, and so is a press that collides with
the scheduler's own firing. A paused or disabled agent refuses both by name.

Refusals on this resource use the shape the rest of the surface uses: `error` is the
sentence the Agents tab shows, `reason` is the machine-readable half to branch on, and a
permission refusal adds `needsRole` and `hint`. The statuses are meaningful: 400 for a body
to fix, 403 for a role, 404 for an agent that is not there or a job that is not an agent,
409 for a state that refuses (paused, live, already running, superseded draft), 502 for a
read or write this app could not complete. "There are no drafts" and "I could not read the
drafts" never arrive as the same answer.

The setup interview is not on this surface. It holds server-side state keyed by an account,
and a token is not an account. The record it produces is exactly what `POST
?resource=agents` takes, so nothing it configures is out of reach.

```bash
curl --fail-with-body "$RULES_API_URL?resource=agents&id=$AGENT&part=drafts" \
  -H "Authorization: Bearer $RULES_API_TOKEN"
curl --fail-with-body -X POST \
  "$RULES_API_URL?resource=agents&id=$AGENT&action=reject" \
  -H "Authorization: Bearer $RULES_API_TOKEN" -H 'Content-Type: application/json' \
  --data '{"itemKey":"SUP-14","stagedAt":"2026-09-13T09:05:00.000Z","reason":"too formal"}'
```

Listener config (script mode):

```json
{
  "name": "Label new bugs", "events": ["avi:jira:created:issue"],
  "filters": { "projectKeys": ["PROJ"], "issueTypes": ["Bug"], "jql": "", "changedFields": [], "commentPattern": "" },
  "ignoreSelf": true, "aiCondition": "",
  "mode": "script",
  "functions": [{ "name": "label", "code": "await api.addLabels(\"triage\");" }],
  "simulationMode": false, "suppressNotifications": false, "enabled": true
}
```

Job config (AI agent, scoped):

```json
{
  "name": "Nudge stale work", "schedule": { "cron": "0 9 * * 1-5", "timeZone": "Europe/Zurich" },
  "scope": { "jql": "project = PROJ AND status = \"In Progress\" AND updated <= -7d", "maxIssues": 25 },
  "mode": "agent",
  "agent": { "instructions": "Ask the assignee for a status update in a short comment and add the label stale.", "allowedActions": ["get_issue", "add_comment", "add_labels"], "maxRounds": 4, "skillIds": ["skill_status_voice"], "useMemories": true },
  "maxWritesPerRun": 50
}
```

Listener config on a git event (the repository allow-list is required):

```json
{
  "name": "Note merged PRs", "events": ["git:pull_request:merged"],
  "filters": { "repos": ["acme/widgets"] },
  "ignoreSelf": true,
  "mode": "agent",
  "agent": { "instructions": "A pull request was merged. If the delivery names an issue key, read that issue and add a short comment naming the pull request. Do nothing else.", "allowedActions": ["get_issue", "add_comment"], "maxRounds": 3 }
}
```

Validation errors come back as `400 { "error": "…" }` with the same messages the admin UI
shows. A refusal that has a machine-readable cause carries it in the same fields the
resolvers use: `reason` (for example `"action-not-allowed"`, `"unknown-skill"`,
`"no-permission"`), `needsRole` (the role the caller would need), `hint` (the remedy the
UI renders, `"ask-app-admin"` or `"not-owner"`) and, for a refused action list,
`refused: [{ id, reason }]`. A REST token carries no role, so every save through this
surface is recorded as `savedByRole: "editor"`: a rule pushed over the API can never hold
an admin-only power such as a PR verdict action or a headless git write. Rows created by an admin
token carry `createdBy: "api:<tokenId>"`; rows created by an editor token carry the
account that minted the token, which is the account its ownership is judged against.

## Storage

| Key | Purpose |
|---|---|
| `listener_index` / `listener:{id}` | slim rows (identity, events, project keys) / full config incl. code (cap 200, ≤200 KB each; index ≤200 KB) |
| `listener_stats` / `job_stats` | run statistics, one map per family (id → counts, last run) — short serialized accounting tasks update these maps; rule executions remain parallel |
| `job_index` / `job:{id}` / `job_sched` | slim rows / full config / the scheduler's own bookkeeping (id → `lastCheckedAt`; the tick is its single writer) |
| `job_claim:{id}:{minute}` · `lst_exec:{taskId}` · `job_exec:{job}:{minute\|manual:task}` | idempotency claims: due-minute claim at the tick, execution claims in the consumer (at-least-once delivery), 2 h TTL |
| `lst_brake:{issue}:{bucket}` / `lst_brake:L:{listener}:{bucket}` | 5-minute loop (30/issue) / cost (120/listener) brakes (15 min TTL) |
| `git_delivery:{conn}:{deliveryId}` · `git_review:{conn}:{repo}:{pr}:{sha}` · `git_review_rate:…` | webhook delivery claims (24 h), one-review-per-revision claims (24 h), the 6-per-repo-per-hour review slots |
| issue property `cognirunner.git` | the advisory last-seen git state per repository (≤5 repositories, ≤2 KB), written by the git-event consumer, read by the git conditions |
| `event_sample:{eventType}` | last-seen payload SHAPE (7-day TTL, ≤20 KB) — captured only for an event an enabled listener subscribes to AND whose project passes that listener's project filter; all free text and identity placeheld (see "How a listener runs"); editor-gated |
| `api_tokens` · `api_token_revoked:{id}` | hashed REST tokens (≤25 live) · one tombstone per revoked token — checked after a hash match, so no stale write of the token array can resurrect a revoked token |
| `log_entry:*` (`type: "listener"` / `"scheduledjob"`) | execution history, shared with the Logs tab and the issue glance |

## Limits & caveats

- **Event latency**: Forge delivers product events up to ~3 minutes after the action; runs
  are queued, so a listener is *eventually consistent* (seconds, typically).
- **`avi:jira:viewed:issue`** fires on every issue view — every view invokes the app even
  when no listener uses it (one cached KVS read). The picker flags it HIGH VOLUME.
- **User events** need real user provisioning; **`avi:jira:failed:expression`** needs a
  failing workflow expression; **`avi:jira:deleted:field`** only follows a trash + permanent
  delete. The live harness reports which events it could fire (`npm run test:listeners-e2e`).
- **Scheduler granularity** is the 5-minute tick: `* * * * *` runs once per tick. A job that
  missed ticks (outage) replays at most one hour and one run.
- **Daylight saving** follows Vixie cron. A schedule with an explicit minute AND hour
  (`0 2 * * *`) is anchored to the local clock: each local time fires exactly once — the
  repeated hour of a fall-back does not run it twice, and a time inside a spring-forward gap
  runs once at the first instant after the gap (02:00 → 03:00 local). A schedule whose minute
  or hour is `*`-based (`*/15 * * * *`, `0 * * * *`) is anchored to elapsed time and keeps its
  rhythm: it fires in BOTH 02:00 hours of a fall-back.
- The trigger's listener index is cached for 30 s per warm container: a freshly saved
  listener can take up to 30 s to start matching.
- Listeners and jobs run **as the app** (`asApp`); there is no "run as user".
- **Job write brake.** A scoped job that changes more than `maxWritesPerRun` issues (default
  200, ceiling 1,000, 0 allowed) stops there; the rest of the scope is not done and the log
  says "Write brake: this run reached its limit…". Raise the number, narrow the scope JQL, or
  split the job.
- **Agent-run and web-search brakes.** The whole installation may start at most 200 AI agent
  runs and make at most 300 web searches per 5-minute bucket. Past either, the run is skipped
  (or the search refused) with a sentence naming the brake; it exists to make a runaway
  visible, not to size normal traffic.
- **Multi-hour cadences** fire at fixed hours (`*/4` is 00, 04, 08, 12, 16, 20 local), which
  is why only 2, 4, 6 and 12 are offered: a cadence that does not divide 24 would have a
  short gap at midnight, and `*/5` in the hour field stays "Custom".
- Statistics can appear shortly after the execution log while its accounting task runs.
  Clearing history preserves run counts; it does not reset them. Retry receipts are
  internal bookkeeping and do not appear as executions.

## Testing

```bash
cd test-harness
npm run test:rules-offline     # cron (85) · event catalogue ⇄ manifest lockstep (376) · engines (116 + 74 + 156 + 25)
npm run test:listeners-e2e     # LIVE: pushes listeners over REST, fires ~55 events, asserts runs + side effects
npm run test:jobs-e2e          # LIVE: run-now (agent, scoped), real 5-minute tick, lifecycle round-trips
npm run test:jsm-assets        # LIVE: the 3 jsm-entity request-type events, a portal request, INTERNAL
                               #   notes (script + AI agent), and the JSM Premium Assets chain
npm run test:offline           # every scripts/*.test.mjs, incl. agent-actions-gate, web-search-tool,
                               #   git-webhook, git-review and the git validators (1.4)
node scripts/web-search-live.mjs   # LIVE: an admin-saved agent listener searches and refuses a leaking query
# isolated UI (mock bridge): cd static/admin-panel && npx webpack --config webpack.screenshot.js --mode production
node static/_screenshot-harness/listeners-jobs.test.mjs --shots
```

The live scripts discover the REST URL and mint a token through the dev-only
`harness-test-state` hook (`TESTSTATE_URL` + `HARNESS_SECRET` in `test-harness/.env`), or
use `RULES_API_URL` + `RULES_API_TOKEN` directly.
