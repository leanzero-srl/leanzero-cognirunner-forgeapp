<!--
 CogniRunner - AI-powered workflow validation for Jira
 Copyright (C) 2025 LeanZero
 SPDX-License-Identifier: Apache-2.0
-->

# Git integration

How CogniRunner talks to GitHub and Bitbucket Cloud: the connections that hold a
credential, the webhook that turns a repository event into a listener run, the nine git
events, the PR-review engine, the git validators and conditions, the pipeline setup, and
the security model under all of it. The Coder itself (the in-issue chat and the Coder
post-function) is in [`CODER.md`](CODER.md).

Every host call the app makes to a git provider goes through one module,
`src/git-providers.js` (one interface, two adapters). Every credential goes through one
module, `src/git-connections.js`. Both are read for this page; where the two disagree with
the text below, the code wins.

---

## Contents

1. [Connections](#1-connections)
2. [The webhook](#2-the-webhook)
3. [The nine git events](#3-the-nine-git-events)
4. [The PR-review listener](#4-the-pr-review-listener)
5. [Git validators](#5-git-validators)
6. [Git conditions](#6-git-conditions)
7. [Pipeline setup](#7-pipeline-setup)
8. [Rotation](#8-rotation)
9. [Security model](#9-security-model)
10. [Testing](#10-testing)

---

## 1. Connections

A connection is one credential for one host, plus the list of repositories anything
running under it may touch. Admins manage them in the admin panel's **Code** tab; every
resolver behind it is admin-only (`listGitConnections`, `saveGitConnection`,
`testGitConnection`, `setGitRepoAllowlist`, `deleteGitConnection`, `rotateGitCredential`).

| | GitHub | Bitbucket Cloud |
|---|---|---|
| `kind` | `github` | `bitbucket` |
| Credential | a personal access token (classic or fine-grained) | an app password, plus the account **email** that owns it |
| Repository id | `owner/name` | `workspace/slug` |
| Webhook signature header | `x-hub-signature-256` | `x-hub-signature` (the same `sha256=` construction) |
| Build state | check runs (`git:check_run:completed`) | commit statuses (`git:pipeline:completed`) |
| Review-thread resolution | not readable over REST (reported as unknown) | readable |

Repository ids are normalised to lower-case `owner/name` (`normalizeRepoId`,
`src/shared/git-ids.js`) everywhere they are compared.

**Saving.** `saveGitConnection` validates the input, checks the cap, calls the host's
`whoami` with the supplied credential, and only then writes: the secret under its own key,
then the row, then the index. A credential the host rejects is refused and never stored.
The row records the login the credential answered with and the capability flags the
token itself reports. On GitHub a classic token's OAuth scopes yield
`canCreateRepos` / `canWebhooks` / `canPipelines`; a fine-grained PAT sends no scopes and
every flag is `null`, which means "not known until you try", never "no".

**Caps.** 25 connections per site; 200 repositories per allow-list; 80-character label;
4,096-character token.

**Testing a connection.** `testGitConnection` calls `whoami` live and records the verdict
on the row. A credential the host rejects sets `status: "auth_dead"` with a reason and a
timestamp; a network fault is reported as transient and does not touch the status. Any
later provider call that answers `auth_dead` (from an agent action, a PR review, a
validator) marks the row the same way, and a later successful test clears it. Re-saving
the connection with a working token also clears it.

**The allow-list** (`isRepoAllowed`) fails closed: an absent, malformed or empty list allows
nothing. It is edited by an admin resolver only. The workflow editor floor sees each
connection as `{ id, kind, label, repos }` (`editorConnectionView`, via `getRuleLists`), so
a rule's repository picker narrows to the chosen connection; the credential's health and
its identity are admin facts and stay behind `listGitConnections`.

**What a connection read returns.** `publicConnection` builds the shape field by field:
`id`, `kind`, `label`, `host`, `owner`, `createdBy`, `createdAt`, `updatedAt`, `hasToken`
(a boolean), `status`, `authDeadAt`, `authDeadReason`, `lastCheckedAt`, `login`, `repos`,
`capabilities`. There is no token field.

**Storage.**

| Key | Holds |
|---|---|
| `git_conn_index` | the list of connection ids |
| `git_conn:<id>` | the row (never a token) |
| `git_conn_secret:<id>` | the credential; read by two internal functions, never by a resolver |
| `git_hook_secret:<connId>:<repo>` | the per-repository webhook signing secret |
| `COGNIRUNNER_FORGE_IDENTITY` | the customer's Atlassian deploy identity (write-only) |
| `git_rotate:<target>` | the rotation lock |
| `git_delivery:<connId>:<deliveryId>` | the 24 h webhook delivery claim |
| `git_pipeline:<connId>:<repo>` | the pipeline setup record |

**The Forge deploy identity** (`saveForgeIdentity`, `clearForgeIdentity`,
`getForgeIdentityStatus`) is the customer's own Atlassian email and API token, handed to
the pipeline of §7. It is stored only with an explicit `consent: true` from the admin
ticking the consent sentence in the Code tab; the accountId that consented and the moment
are recorded. There is no reveal path. The status shape is `{ hasIdentity, email, consent,
rotation, createdAt, updatedAt }`.

## 2. The webhook

The production endpoint is the web trigger `git-webhook` (`index.gitWebhook`). It verifies
and enqueues, and does nothing else: no provider call, no model call, no rule read, so the
answer lands inside the 10 s window GitHub gives a delivery. The dev-only
`git-webhook-probe` trigger is a different, unauthenticated endpoint and is never used in
production.

### Routing

The registered hook URL carries the route in its query string:

```
POST <web trigger URL of git-webhook>?conn=<connectionId>&repo=<owner/name>
```

The handler resolves `conn` to a connection row, checks `repo` is on that connection's
allow-list, and reads the per-repository secret `git_hook_secret:<connId>:<repo>`. An
unknown connection, a repository off the allow-list and a missing secret all answer the
same `404` with no body detail, so the endpoint is not an oracle for connection ids. A
storage fault while looking the route up answers `503` (fail closed; the provider retries).

### The signature

The delivery is verified over the **raw body** with the per-repository secret:
`sha256=` + HMAC-SHA256 hex, compared with `timingSafeEqual`. GitHub's
`x-hub-signature-256` wins when present; otherwise `x-hub-signature` is accepted only when
it is a `sha256=` value (GitHub's own `x-hub-signature` is sha1 and is never accepted).
A missing, malformed or wrong signature answers `401`, nothing is enqueued, no claim is
taken, and the log line never carries the body or the signature. This construction was
verified against a real GitHub delivery (an 8,008-byte body, valid).

### Events and answers

The provider is read from the event header (`x-github-event` or Bitbucket's `x-event-key`)
and must match the connection's `kind`. The payload's repository must match the signed
route: a valid signature for repository A carrying repository B's payload is dropped. The
provider event is mapped to one of the nine catalogue ids (§3); anything else is
acknowledged and ignored, because a non-2xx would make the provider retry it forever and
eventually disable the hook.

| Answer | When |
|---|---|
| `405 { ok:false }` | anything but POST |
| `404 { ok:false }` | unknown connection, repository not allow-listed, or no secret |
| `503 { ok:false }` | a storage fault during routing, or the delivery claim could not be written |
| `401 { ok:false }` | no signature, a non-sha256 signature, or a mismatch |
| `202 { ok:true, ignored:"unrecognised-provider" }` | the event header names a different host than the connection |
| `202 { ok:true, ignored:"repo-mismatch" }` | the payload's repository is not the signed one |
| `202 { ok:true, ignored:"unsupported-event", event }` | a provider event the catalogue does not model |
| `202 { ok:true, duplicate:true }` | a delivery id already claimed in the last 24 h (a provider Redeliver, a retry) |
| `500 { ok:false }` | the claim was taken but the queue push failed; the claim is released so the retry runs |
| `202 { ok:true, accepted:true, eventType, taskId }` | enqueued |

The delivery id comes from `x-github-delivery` (GitHub) or `x-request-uuid` /
`x-hook-uuid` (Bitbucket); without one, a hash of the body stands in. The claim
`git_delivery:<connId>:<deliveryId>` is written `FAIL_IF_EXISTS` **before** the enqueue.
The event is pushed to `async-ai-queue` as task type `git-event` with concurrency two per
connection, so a push storm cannot occupy every queue slot the app shares. A `git-event`
task calls no model and is never paced by the token budget; every model call happens in the
listener or review task it enqueues in turn. The consumer retries a dispatch that throws up
to four times and then logs the delivery as dropped, naming the connection and the id.

### The envelope

Whatever the provider sent, the listener sees one shape, clamped server-side, with the raw
payload capped at 8 KB:

```
{ eventType, source:"git", connectionId, repoId:"owner/name", deliveryId,
  actor:{login,id}, pullRequest?:{number,title,state,merged,draft,headSha,
  headRef,baseRef,url,author:{login}}, review?, comment?, push?, check?,
  issueKeys?:[] }
```

`issueKeys` are the Jira keys found in the branch name, the pull request title and the
commit subjects. They are advisory: anybody who can name a branch can put any key there.
They label the run and key the per-issue brake; nothing grants access or writes to an
issue on their strength.

### Provisioning the secret

The per-repository secret is created by `ensureHookSecret` (create-if-absent, 32 random
bytes as hex) and rotated by `rotateGitHookSecret`, which is the ONE home of rotation
(F-483 deleted a callerless second implementation, `rotateHookSecret`, that replaced the
stored secret without ever telling the provider). Both are reachable from the admin
resolvers behind the Code tab (F-460): "Set up webhook" registers the hook on the provider
and "Rotate secret" runs the pending-slot → provider PATCH → promote order (F-481). It is
no longer a Known limitation in the release notes.

## 3. The nine git events

Git events are rows of the one event catalogue (`src/shared/jira-events.js`) with
`source: "git"`. They have no Forge trigger, are never project-scoped (a repository is not
a Jira project), and every one of them **requires** a `filters.repos` allow-list on the
listener: there is no "all repositories" listener, and a save without it is refused with
"filters.repos is required for git events (…)". The picker shows them as the **Git**
category.

| Event id | Fires when | Payload hint |
|---|---|---|
| `git:pull_request:opened` | a pull request was opened | `event.pullRequest {number,title,headSha,headRef,baseRef,url,author}`, `event.repoId`, `event.actor.login` |
| `git:pull_request:synchronize` | new commits were pushed to an open pull request (high volume) | `event.pullRequest` (headSha is the new head) |
| `git:pull_request:closed` | a pull request was closed without merging | `event.pullRequest {number,state:'closed',merged:false}` |
| `git:pull_request:merged` | a pull request was merged | `event.pullRequest {number,merged:true,mergeCommitSha}` |
| `git:pull_request_review:submitted` | a review was submitted | `event.review {id,state:'approved'\|'changes_requested'\|'commented',body,author}` |
| `git:issue_comment:created` | a comment was added on a pull request (high volume; issue comments not attached to a PR are not forwarded) | `event.comment {id,body,author,url}`, `event.pullRequest {number}` |
| `git:push` | commits were pushed to a branch (high volume) | `event.push {ref,before,after,forced,commits:[{id,message,author}]}` |
| `git:check_run:completed` | a GitHub check run finished | `event.check {name,status,conclusion,headSha,url}` |
| `git:pipeline:completed` | a Bitbucket pipeline (commit status) finished | `event.check {name,status,conclusion,headSha,url}` |

Provider mapping, from `mapGitEvent`: GitHub `pull_request` with action `opened` /
`synchronize` / `closed` (a close with `merged: true` is filed as merged),
`pull_request_review` `submitted`, `issue_comment` `created` on a pull request, `push`,
`check_run` `completed`. Bitbucket `pullrequest:created` / `updated` / `fulfilled` /
`rejected` / `comment_created` / `approved`, `repo:push`, `repo:commit_status_updated`.

**What a git-triggered listener gets.** The same filters, the same AI condition, the same
brakes as any listener (30 runs per object and 120 per listener in five minutes; a loop on
one pull request is capped like an issue). The event summary the model reads is fenced and
defanged, because every string in it (a title, a branch name, a commit subject, a review
body) was chosen by whoever can push to the repository. `Ignore events caused by this app`
is honoured for git too, with a different predicate: the actor is compared with the
connection's own login (the cached `whoami`), not with Forge's self-generated flag.

**The advisory issue property.** For every issue key a delivery names, and only where an
enabled, non-simulation listener would accept that delivery for that repository, the
consumer writes `cognirunner.git` on the issue: `{ version:1, repos:{ "<owner/name>":
{ pr:{number,…}, … } }, updatedAt }`, bounded to five repositories and 2 KB. It is
**advisory**: anyone who can write issue properties can forge it, deliveries arrive out of
order, and it is the last state the app saw. The conditions of §6 read it as a hint; the
validators of §5 use it only to find the pull request number and verify everything live.

**Over the Rules REST API** `GET ?resource=events` returns every row with `source`
(`"jira"` or `"git"`) and `repos: true` on the rows that require the allow-list. A listener
on a git event:

```json
{
  "name": "Note merged PRs", "events": ["git:pull_request:merged"],
  "filters": { "repos": ["acme/widgets"] },
  "ignoreSelf": true,
  "mode": "agent",
  "agent": { "instructions": "A pull request was merged. If the delivery names an issue key, read that issue and add a short comment naming the pull request. Do nothing else.", "allowedActions": ["get_issue", "add_comment"], "maxRounds": 3 }
}
```

## 4. The PR-review listener

A listener on `git:pull_request:opened` / `git:pull_request:synchronize` can run the
deterministic review engine (`src/git-review.js`) instead of an agent turn: set
`agentlessTaskType: "gitreview"` on the listener. The catalogue carries the seed as the
premade listener **Review every opened PR** (`PREMADE_LISTENERS` in
`src/shared/premade-rules-catalog.js`): agent mode, `ignoreSelf`, an empty `filters.repos`
the admin must fill, `agentlessTaskType: "gitreview"`, and an agent that may only
`get_pull_request` (the engine posts the review itself, under its own brakes, so a
comment write is deliberately not on the agent's list). There is no one-click picker for it
in the Listeners tab yet; push the shape over the Rules REST API.

What the engine guarantees, all in code:

- **One review per revision.** The claim `git_review:<connId>:<repo>:<pr>:<headSha>`
  (24 h) is taken before the model call and fails closed: no claim, no review, and a
  redelivered event answers `skipped: "already-reviewed"`. A new push is a new head SHA
  and a new review. The claim is released if nothing was posted, and kept after the first
  successful post whatever happens next.
- **Bounded input.** The diff is capped at 60 KB in total and 16 KB per file (the same
  numbers the adapter applies), the truncation is stated in the prompt, and the whole diff
  goes inside a fence (`<<<PR_DIFF … PR_DIFF>>>`) after `defangFence`. A file whose patch
  the host withheld (binary, oversized) is reported as withheld, not as empty.
- **Clamped output.** The verdict is one of `approve` / `request_changes` / `comment`;
  at most 20 findings; summary 2 KB; message 1 KB; path 200 characters; line an integer or
  null; severity one of `blocker` / `major` / `minor` / `nit`. Anything else is dropped.
- **A verdict is not an action.** The engine posts the verdict as comment text unless the
  listener carries `gitReview.allowVerdictActions: true` **and** the rule was saved by an
  admin (`savedByRole`, stamped at save time and re-checked by the engine). A REST token
  carries no role, so a rule pushed over the API can never arm a verdict action.
- **Write brakes.** One general comment and at most 10 inline comments per run; at most 6
  reviews per repository per hour. Simulation takes neither the per-PR claim nor a rate
  slot.
- **Outcome.** Every run writes a listener execution-log entry; a model failure ends as
  `ERROR`, never as "reviewed, no findings".

## 5. Git validators

Four premade validators, category **Git**, executed by `runGitValidator` in
`src/premade-rules.js`. Unlike every other premade rule they make an outbound provider call
inside the transition, bounded to 8 s (`GIT_VALIDATOR_BUDGET_MS`) so the rest of the
25 s validator budget is kept.

| `ruleType` | Blocks unless |
|---|---|
| `git-build-passed` | the build on the pull request's head commit has passed (`success`); `failed`, `running`, `pending` block |
| `git-pr-approved` | the pull request has an approval and no outstanding "changes requested" |
| `git-pr-comments-resolved` | no review comment is unresolved; GitHub cannot report resolution over REST, and that unknown follows Strict |
| `git-pr-merged` | the pull request is merged, read live |

The configuration is the git parameter group: `connectionId` and `repo` (both picked from
lists in the editor; the repository list narrows to the connection's allow-list), `prMatch`
and `strict`, plus the usual `errorMessage`.

**Finding the pull request.** The `cognirunner.git` property nominates a candidate number
for the rule's repository; nothing else is read from it. The **live** pull request must then
name the issue key, or it is no candidate at all: with `prMatch: "branch"` the source branch
must carry the key; with `"property"` or `"both"` (the default) the branch or the title may.
The match is word-bounded and case-insensitive (`T-1` matches `feature/T-1-thing` and not
`T-12`). An unbound candidate is "no pull request found". There is no discovery by listing,
so an issue whose repository has no property entry has no candidate.

**Fail open or closed.** Verbatim from the table beside `runGitValidator`:

```
situation                          strict:false          strict:true
---------------------------------- --------------------- ---------------------
config not finished (no connection  ALLOW                 ALLOW
  id / no repo)                     (the rule isn't built yet — same as every
                                     other premade rule's malformed-config path)
connection id names no row          BLOCK                 BLOCK   <- fail CLOSED
repo not on the allow-list          BLOCK                 BLOCK   <- fail CLOSED
no pull request found               ALLOW                 BLOCK
dead token (auth_dead)              ALLOW + banner        BLOCK (names the
                                                           connection, never
                                                           the token)
network error / timeout / 429       ALLOW + banner        BLOCK
determinate negative (not merged,
  not approved, build failed,
  unresolved comment)               BLOCK                 BLOCK
unknown (no checks at all, thread
  resolution unreadable on GitHub)  ALLOW                 BLOCK
```

The two fail-closed rows are a misconfigured gate (a deleted connection, a repository the
connection may not read), and they block whatever `strict` says; a transport fault is a
correct rule in an unreachable world, which is what `strict` is for. When the check is
allowed for one of the open reasons, the execution log records it (`why`:
`not-configured`, `no-pull-request`, `pr-unbound`, `no-head-sha`, `no-checks`,
`resolution-unknown`, `auth-dead`, `provider-unavailable`, `provider-timeout`).

## 6. Git conditions

Three premade conditions with the same keys, `git-pr-merged`, `git-pr-approved`,
`git-build-passed`, are a different engine: null-guarded branches of the one
`jira:workflowCondition` expression in `manifest.yml`, reading the advisory
`cognirunner.git` property for the chosen `repo`. A missing property, a missing repository
entry or a missing flag evaluates true, so a condition hides a transition only on a
known-negative state (`merged: false`, `approved: false`, or a build whose recorded state
matches `failure|failed|timed_out|cancelled|canceled|action_required|startup_failure|stale|stopped`).
It never blocks on a missing property, and it never verifies live. To actually block,
use the validator of the same name.

## 7. Pipeline setup

A Forge app cannot deploy a Forge app, so CogniRunner can install a deploy pipeline into a
customer's repository that deploys the customer's own app under the Forge deploy identity
of §1. Setup is an **admin resolver, never an agent action** (the constant
`CONNECTION_SECURITY_MODEL.pipelineSetupIsAdminResolver` is asserted by the setup code, and
no git action id maps to it). No UI calls the three resolvers yet; they are documented
here for what they do.

`setupGitPipeline` (admin) takes `{ connectionId, repo, manifestYaml, site, product?,
branch?, scaffoldVars?, developerSpaceId?, appId? }`, validates everything before any side effect,
takes a ten-minute claim, and queues a `gitpipeline` task on `async-ai-queue`. The refusals,
each with a machine `code`: `not_found`, `auth_dead`, `not_allowed` (with
`hint: "add-repo-to-allowlist"`), `identity_required` and `consent_required` (with
`hint: "configure-forge-identity"`), `manifest_required`, `scope_not_allowed` (with the
`scopes` refused), `lock_mismatch` (with `added` / `removed`), `invalid_developer_space`,
`invalid_app_id`, `already_running`, `queue`.

**The developer space (F-527).** `forge register` asks for a Developer Space and `-y` does
not answer that question, so a runner with no space id sits on a prompt it cannot render
and dies (`Prompts can not be meaningfully rendered in non-TTY environments`, 41s, live
2026-09-13). `--personal` is not an escape either: a space that disallows personal apps
refuses it outright. The bootstrap therefore runs `forge register -y -s
"$FORGE_DEVELOPER_SPACE" "$FORGE_APP_NAME"` with no `--personal`, reading the id from the
repository variable `FORGE_DEVELOPER_SPACE` through the job's `env:` block (never a `${{ }}`
expression inside `run:`, which is textual substitution into a shell script).
`setupGitPipeline` collects the id as the optional `developerSpaceId` — validated against
`^[0-9a-f-]{36}$` because it becomes a shell word, refused as `invalid_developer_space` when
it is present and malformed — and writes it as the repository variable
`FORGE_DEVELOPER_SPACE` next to `FORGE_SITE`, in the step `var:FORGE_DEVELOPER_SPACE`. The
step exists only on runs that supplied one: a step stamped "done" for a variable nobody
asked for would be a lie in the only record an admin can read. When the variable is absent
and the app is not yet registered, the bootstrap fails loud naming the variable rather than
prompting.

**The permission lock.** The manifest's `permissions:` block is rendered into
`.cognirunner/forge-permissions.lock` and committed with the pipeline; its hash (over the
permission lines only, so a re-render is byte-stable) is recorded on the row. A later setup
whose manifest renders a different lock is refused by scope name before anything is
written, and the pipeline's own `check-permissions-lock.js` enforces the same rule on the
runner at install time. A lock may only carry scopes from the allow-list, verbatim from
`PIPELINE_ALLOWED_SCOPES` in `src/git-pipeline.js`:

```
storage:app
read:me
read:account
read:jira-user
read:jira-work
write:jira-work
read:project:jira
read:issue:jira
write:issue:jira
read:field:jira
read:workflow:jira
write:workflow:jira
read:issue-details:jira
read:servicedesk-request
read:jira-work:confluence
read:confluence-content.all
read:confluence-space.summary
read:page:confluence
read:space:confluence
manage:jira-configuration
```

Anything granting app or site administration, any act-as-user variant and any scope that
can mint or read credentials is deliberately absent; widening the list is a security
decision.

**The app id: who registers and who stores (F-528).** The runner token can never store
`FORGE_APP_ID`. Repository variables are an `administration` resource, and `GITHUB_TOKEN`
cannot hold it with or without `actions: write` — probed live 2026-09-13, HTTP 403
"Resource not accessible by integration" on `POST /repos/:o/:r/actions/variables`, with a
PAT accepting the identical call on the identical repository seconds later. The scaffold no
longer pretends otherwise: `actions: write` and the `gh variable set` attempt are gone, the
bootstrap step registers only when `FORGE_APP_ID` is absent **and** `FORGE_DEVELOPER_SPACE`
is present, and on a successful register it prints
`::notice::Registered app id <ari>. … set the repository variable FORGE_APP_ID …` — the
product cannot read the runner's output, so a human has to carry the id across. The admin
pastes it back into CogniRunner, which holds a credential that CAN write variables and
stores it in the `var:FORGE_APP_ID` step; from then on the bootstrap step never runs. The
id is accepted as `ari:cloud:ecosystem::app/<uuid>` or as the bare uuid and always stored
as the full ARI, because `.cognirunner/inject-app-id.js` refuses anything else; a malformed
one is refused as `invalid_app_id` before any side effect. **What is true, and what the
scaffold comments now say:** until the variable exists, every run registers again — the
bootstrap is not "at most once" by itself, it is "at most once once a human has stored the
id".

**Drift on the runner: which class produces which outcome (F-529).** The pipeline's own
`check-permissions-lock.js` compares the working-copy manifest's `permissions:` block
against the committed lock and classifies any difference, because the two classes cannot
share an outcome:

| drift | what changed | what the pipeline does |
|---|---|---|
| `none` | nothing | `locked=true`, exit 0 — deploy, then install |
| `scopes` | a scope was added or removed | `::error::permission lock: DRIFT (scopes) - added …, removed …`, **exit 1 at the lock step**. Nothing is deployed and nothing is installed |
| `other` | a non-scope permissions line (`content:` / `styles:`) | `locked=false`, exit 0 — **deployed, NOT installed**, with the warning step |
| `missing` | no lock committed | `locked=false`, exit 0 — deployed, NOT installed |

The `scopes` class exits at the lock step deliberately. `forge deploy --non-interactive`
refuses a scope widening on its own with `MAJOR_VERSION_RULE` ("The deploy failed due to 1
approval requested"), so before this the job died at the Deploy step with Forge's message
about approvals while the lock's correct verdict, computed one step earlier, was thrown
away with the job — a red run for the right reason, stated wrongly, and the "deployed, NOT
installed" warning step was unreachable for the only drift the lock exists to catch
(observed live 2026-09-13, run 34768718033). The lock step is rendered before the Deploy
step on both hosts; on Bitbucket the checker's exit code is honoured with
`|| { cat .lock-result; exit 1; }`, because the `;` that used to separate them swallowed
it. The install remains the human consent gate for the `other` / `missing` classes; a scope
change must be re-approved in CogniRunner — which rewrites the lock — before the pipeline
deploys at all. `--approve MAJOR_VERSION_RULE` is deliberately never added: it would deploy
a wider-scoped version off a drifted manifest, which is the opposite of the lock's purpose.

The scope-vs-structure rule (`scopeOfLockLine` in `src/git-pipeline.js`) is restated inside
the generated checker because that file is standalone in a customer's repository and can
import nothing; `git-scaffolds.test.mjs` holds the two regex literals byte-equal so the two
homes cannot drift apart.

**Installing dependencies (F-530).** Both pipelines run `npm install --no-audit --no-fund`,
not `npm ci`. `npm ci` refuses to run without a lockfile (`npm error code EUSAGE`) and the
scaffold ships none — live, Bitbucket run #1 of the offshoot died on that line before
`forge register` was ever reached, while the README the same scaffold commits said
`npm install`. A generated lockfile is not an option here: it is a resolved dependency graph
with integrity hashes for the whole transitive tree, and `git-scaffolds.js` is a
dependency-free list of string arrays that cannot produce a true one. The invariant is held
in `git-scaffolds.test.mjs`: no rendered file may say `npm ci` unless that scaffold's file
list actually contains a lockfile.

**The steps.** The consumer runs a fixed chain and records every step on the row before
the next one starts, so a chain that dies reports `status: "partial"` with the step that
failed, never "installed": on Bitbucket `enable-pipelines`, then `secret:FORGE_EMAIL`,
`secret:FORGE_API_TOKEN`, `var:FORGE_SITE`, `var:FORGE_PRODUCT`, `var:FORGE_ENV`
(`development`; installs are development-only and the rendered workflow enforces it),
then the optional `var:FORGE_DEVELOPER_SPACE` and `var:FORGE_APP_ID` when the request
carried them (in that order), then `commit-scaffold`, which commits the `forge-pipeline` scaffold
(`.github/workflows/forge-deploy.yml`, `bitbucket-pipelines.yml`,
`.cognirunner/inject-app-id.js`, `.cognirunner/check-permissions-lock.js`) plus the lock
in one commit. The identity's token is read once, handed to `setSecret`, and never appears
on the row, in a return value or in a log line.

`getGitPipelineStatus` (editor floor) returns the row through an allow-list
(`publicPipelineRow`) plus a best-effort live read of the last deploy run.
`triggerGitDeploy` (admin) starts a run on an already-installed pipeline for an
allow-listed repository and requires `confirm: true` in the payload; an absent flag is
refused with `code: "confirmation_required"`.

**Proven end to end, 2026-09-13** (dev 25.8.0 -> `leanzero-srl/cognirunner-forge-offshoot`,
wolfaenpak). Through the Code tab: a GitHub connection, the Forge deploy identity behind the
consent screen, and "Set up pipeline" -> all six steps done, secrets `FORGE_EMAIL` /
`FORGE_API_TOKEN` and variables `FORGE_SITE` / `FORGE_PRODUCT` / `FORGE_ENV=development`
created at the provider, scaffold + lock committed in one commit (`2d0e088e`), the row
`installed`. A green pipeline run then deployed the app (`permission lock: OK (7 lines)`,
`locked=true`) and installed it on the site; a second run reused the app id with Bootstrap
skipped. Four defects were found; F-527, F-528 and F-529 are closed above and F-526 remains
open:

- **F-526** — the Code tab sends no `scaffoldVars`, so the installed workflow always renders
  with the `forge-pipeline` defaults (`FORGE_APP_NAME: Forge app`, `working-directory:
  static/app`). Any repository whose Custom UI is elsewhere gets a pipeline that cannot
  build, and the row still reports `installed`.
- **F-527** — FIXED. The bootstrap's `forge register -y --personal "$FORGE_APP_NAME"` could
  not run headless: the CLI prompts for a Developer Space in a non-TTY, and `--personal` is
  refused by a space that disallows personal apps. The scaffold now passes
  `-s "$FORGE_DEVELOPER_SPACE"` and no `--personal`, `setupGitPipeline` collects
  `developerSpaceId`, and an absent variable fails the step with a one-line instruction
  naming it. See "The developer space" above.
- **F-528** — FIXED. `GITHUB_TOKEN` with `actions: write` CANNOT create a repository
  variable (HTTP 403, "Resource not accessible by integration"); repository variables are an
  `administration` resource. The scaffold no longer attempts it or carries the permission:
  it prints a `::notice::` naming the variable, and `setupGitPipeline` takes the optional
  `appId` and stores it. See "The app id" above.
- **F-529** — FIXED. When the drift was a widened SCOPE, `forge deploy --non-interactive`
  refused first with `MAJOR_VERSION_RULE`, so the job failed before the "deployed, NOT
  installed" warning could render and the admin read Forge's reason instead of the lock's.
  The checker now classifies the drift and exits 1 at the lock step for the `scopes` class;
  the warning path belongs to `other` / `missing` alone. See the drift table above.

## 8. Rotation

A credential is never replaced inside a resolver. `rotateGitCredential` (admin) takes
`{ target, token, email? }` where `target` is `{ kind:"connection", id }` or
`{ kind:"forge-identity" }`, checks the token's length, and queues a `gitcredrotate` task
with concurrency one per target. The consumer:

- takes a per-target lock (`git_rotate:<target>`, released on every exit; a conflict
  answers `busy` and writes nothing);
- refuses a delivery already applied (`duplicate`) and a request older than the rotation
  already stored (`stale`), ordered by the moment the admin asked, never by the consumer's
  clock;
- for a **connection**, verifies the new credential with `whoami` before it replaces the
  old one; a rejected replacement leaves the old one untouched;
- for the **Forge identity**, replaces the token **without** verifying it. Proving an
  Atlassian API token needs a call to `*.atlassian.net`, which is not in the app's egress,
  so a mistyped token is stored and surfaces on the next deploy. The original consent record
  is kept verbatim and who rotated is recorded separately under `rotation`.

Per-repository webhook secrets rotate through `rotateGitHookSecret`, the single rotate
path (F-483), driven by the `rotateGitHookSecret` admin resolver; see §2.

## 9. Security model

Stated in code as `CONNECTION_SECURITY_MODEL` in `src/git-connections.js` and enforced by
the modules named:

| Rule | Where |
|---|---|
| Pipeline setup is an admin resolver, never an agent action | `git-pipeline.js` asserts `pipelineSetupIsAdminResolver`; no `git` action maps to it |
| An agent may only touch a repository on its connection's allow-list | `providerForConnection` refuses; `git-actions.js` checks before any provider call |
| The allow-list is edited by an admin resolver only | `setGitRepoAllowlist` |
| Tokens are write-only; nothing reads one back | `publicConnection`, `forgeIdentityStatus`, `publicWhoami` are field allow-lists; the offline suite scans every resolver return |
| Rotation happens on the queue, never in a resolver | `requestCredentialRotation` / `applyCredentialRotation` |
| A dead credential is loud | `markAuthDead`, the banner, the validators' Strict column |
| Every git host call is a backend `fetch` | manifest `external.fetch.backend` lists `api.github.com`, `api.bitbucket.org` and `bitbucket.org` (a redirect target for Bitbucket's diff and src endpoints); nothing is mirrored into `client` |
| Writes are never retried | `git-providers.js`: a retried POST is a duplicate PR, comment or commit; reads retry once on a transport fault or a 429/5xx |
| 10 s per call, 20 s per logical operation | `GIT_CALL_TIMEOUT_MS`, `GIT_OPERATION_BUDGET_MS` |
| Secrets never appear in an error | every message goes through `redactSecrets` before it leaves the adapter; auth headers are built last and never attached to an error |
| Provider text is bounded, not sanitised | titles, bodies, comments, paths and diffs are size-capped by the adapter; every caller that puts them in a prompt fences and defangs them itself |

**What is never stored:** a token in a connection row; a token in any resolver return, log
line or error message; a webhook body or signature in a log line.

**What fails closed:** a credential that cannot be read (never "no restriction"); an
allow-list that cannot be read (never "everything"); a webhook delivery that cannot be
verified or whose claim cannot be written; a PR review that cannot take its claim; a
pipeline setup whose lock differs from the recorded one; a rule pointing at a deleted
connection or a repository it may not read (both validator columns). The one deliberately
open surface is the git validator on a transport fault with Strict off, because the app's
validator contract is fail-open and the rule there is correct.

## 10. Testing

Offline (`cd test-harness && npm run test:offline` runs every `scripts/*.test.mjs`):

```
scripts/git-providers.test.mjs        every adapter method on mocked fetch: status mapping, auth_dead, no write retries, timeouts, diff caps
scripts/git-connections.test.mjs      save / test / delete / rotation, and the deep scan for planted secrets in every resolver return
scripts/git-webhook.test.mjs          routing, the signature, every documented answer, the delivery claim
scripts/git-review.test.mjs           one review per head SHA, the fence, the clamps, the brakes
scripts/git-pipeline.test.mjs         the lock, the scope allow-list, refusal before any side effect, partial status
scripts/git-scaffolds.test.mjs        the rendered file trees and the lock builder
scripts/git-sealed-box.test.mjs       the GitHub Actions secret sealing
scripts/git-manifest-egress.test.mjs  manifest egress equals GIT_PROVIDER_HOSTS, in order
scripts/git-condition-expression.test.mjs  the manifest expression's git branches
scripts/premade-git-validators.test.mjs    the strict table, row by row
```

Live, against a dev site with `HARNESS_SECRET`: `scripts/git-inbound-live.mjs` plants a
tokenless stand-in connection and a hook secret through the dev hook and drives the
production `git-webhook` trigger with self-signed deliveries (202 accept, 202 duplicate,
401 unsigned, 401 bad signature, 404 unknown route, 405 on GET), without touching a
provider; `scripts/git-dispatch-drop-live.mjs` proves the retry-and-drop contract;
`scripts/git-validator-live.mjs` and `scripts/git-condition-live.mjs` drive the validators
and the condition branches through real transitions.
