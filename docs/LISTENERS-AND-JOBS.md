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
| Trigger | One or more of the **68 Jira product events** Forge exposes (issues, comments, worklogs, attachments, links, projects, versions, components, sprints, boards, users, custom fields, issue types, filters, configuration, JSM request types) | A **cron** expression (5-field, IANA time zone). Presets from every-5-minutes to monthly. Effective granularity is the platform tick: 5 minutes |
| Current issue | The event's issue (or `null` for non-issue events) | Each issue of an optional **JQL scope** (escalation-style), or `null` when unscoped |
| Filters | Projects, issue types, JQL (issue must match), changed fields (`updated:issue`), comment regex (comment events), *ignore self-generated events* (loop guard, default on) | Scope JQL + max issues (≤100) |
| AI gate | **AI condition** — a plain-language yes/no the model evaluates before the run (fails closed) | — |
| What runs | **Code steps** (describe → AI generates → test → fix; same sandbox `api.*` as static post-functions) **or** an **AI agent** (plain-language instructions + an allow-list of actions) | same |
| Budget | 120 s on the async consumer (the 25 s trigger only matches + queues) | 120 s per run, shared across scoped issues |
| Safety | Simulation mode, kill switch, per-issue (30 / 5 min) and per-listener (120 / 5 min) brakes, at-least-once execution claims, `ignoreSelf`, notification suppression | Simulation mode, kill switch, idempotent per-minute claims (duplicate ticks never double-run) |

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
project id (versions, links) get the key resolved so project filters apply. When a listener is
subscribed, the event also leaves a **last-seen payload sample** (per event type, 7-day TTL,
rich-text bodies redacted) that the editor shows next to the code steps ("Show last real
payload") — the exact shape of `api.context.event`.

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

## Rules REST API

A Forge web trigger (`rules-api`). Mint a bearer token in **Settings → API access** (admin
only; only the SHA-256 hash is stored, the plaintext is shown once). Send it as
`Authorization: Bearer cgr_…` (or `X-Api-Key`).

| Method | Query | Body | Result |
|---|---|---|---|
| GET | `?resource=events` / `?resource=actions` | — | catalogues |
| GET | `?resource=listeners` / `&id=` | — | slim list / full record |
| POST | `?resource=listeners` | one config or an array (≤100) | created/upserted (201 / 200 / 207) |
| PUT | `?resource=listeners&id=` | partial config (`filters`, `agent`, `schedule`, `scope` merge) | updated |
| DELETE | `?resource=listeners&id=` | — | deleted |
| POST | `?resource=listeners&id=&action=enable\|disable\|test` | test: `{ issueKey, eventType, event? }` | state / simulated run |
| GET/POST/PUT/DELETE | `?resource=jobs…` | same shapes | same |
| POST | `?resource=jobs&id=&action=run\|preview` | preview: `{ cron, timeZone, count }` | `202 { taskId }` / next runs |
| GET | `?resource=tasks&id=<taskId>` | — | queued-run status + result |
| GET | `?resource=logs[&ruleId=]` | — | execution logs (newest first) |
| GET | `?resource=samples&eventType=` | — | last captured payload |
| GET | `?resource=whoami` | — | token identity |

Listener config (script mode):

```json
{
  "name": "Label new bugs", "events": ["avi:jira:created:issue"],
  "filters": { "projectKeys": ["LZPT"], "issueTypes": ["Bug"], "jql": "", "changedFields": [], "commentPattern": "" },
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
  "scope": { "jql": "project = LZPT AND status = \"In Progress\" AND updated <= -7d", "maxIssues": 25 },
  "mode": "agent",
  "agent": { "instructions": "Ask the assignee for a status update in a short comment and add the label stale.", "allowedActions": ["get_issue", "add_comment", "add_labels"], "maxRounds": 4 }
}
```

Validation errors come back as `400 { "error": "…" }` with the same messages the admin UI
shows. Rows created through the API carry `createdBy: "api:<tokenId>"`.

## Storage

| Key | Purpose |
|---|---|
| `listener_index` / `listener:{id}` | slim rows (identity, events, project keys) / full config incl. code (cap 200, ≤200 KB each; index ≤200 KB) |
| `listener_stats` / `job_stats` | run statistics, one map per family (id → counts, last run) — written only by the consumers, never the index or the records (no lost-update race with saves) |
| `job_index` / `job:{id}` / `job_sched` | slim rows / full config / the scheduler's own bookkeeping (id → `lastCheckedAt`; the tick is its single writer) |
| `job_claim:{id}:{minute}` · `lst_exec:{taskId}` · `job_exec:{job}:{minute\|manual:task}` | idempotency claims: due-minute claim at the tick, execution claims in the consumer (at-least-once delivery), 2 h TTL |
| `lst_brake:{issue}:{bucket}` / `lst_brake:L:{listener}:{bucket}` | 5-minute loop (30/issue) / cost (120/listener) brakes (15 min TTL) |
| `event_sample:{eventType}` | last-seen payload SHAPE (7-day TTL, ≤20 KB) — captured only when a listener subscribes, with descriptions / comment bodies / rich-text fields redacted; editor-gated |
| `api_tokens` | hashed REST tokens (≤25 live) |
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
- The trigger's listener index is cached for 30 s per warm container: a freshly saved
  listener can take up to 30 s to start matching.
- Listeners and jobs run **as the app** (`asApp`); there is no "run as user".

## Testing

```bash
cd test-harness
npm run test:rules-offline     # cron (50) · event catalogue ⇄ manifest lockstep (362) · engines (60)
npm run test:listeners-e2e     # LIVE: pushes listeners over REST, fires ~55 events, asserts runs + side effects
npm run test:jobs-e2e          # LIVE: run-now (agent, scoped), real 5-minute tick, lifecycle round-trips
# isolated UI (mock bridge): cd static/admin-panel && npx webpack --config webpack.screenshot.js --mode production
node static/_screenshot-harness/listeners-jobs.test.mjs --shots
```

The live scripts discover the REST URL and mint a token through the dev-only
`harness-test-state` hook (`TESTSTATE_URL` + `HARNESS_SECRET` in `test-harness/.env`), or
use `RULES_API_URL` + `RULES_API_TOKEN` directly.
