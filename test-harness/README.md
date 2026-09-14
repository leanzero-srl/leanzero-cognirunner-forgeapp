<!--
 CogniRunner - AI-powered workflow validation for Jira
 Copyright (C) 2025 LeanZero
 SPDX-License-Identifier: Apache-2.0
-->

# CogniRunner — At-Scale Runtime Test Harness

Real, automated, black-box testing of CogniRunner's **runtime** surface — AI validators, conditions, semantic & static post-functions — driven through the **actual Jira workflow engine** against a live Cloud instance. It fabricates an isolated project + diverse field set + a large adversarial issue corpus, attaches a diverse rule set programmatically via the workflow REST API, fires transitions at scale, and scores outcomes black-box.

This complements (does not replace) the app's in-UI dry-run testers: it exercises the real `validate` / `executePostFunction` code paths the way Jira invokes them.

## Why black-box / REST

- Forge **validators** are enforced on the REST transition path (a failed validation returns HTTP 4xx with the AI's reason in `errorMessages`).
- Rules are attached with `POST /rest/api/3/workflows/update` — the exact rule shape (`ruleKey` + `parameters.key` ARI + stringified `config`) was captured live and lives in `lib/workflow.mjs`.
- REST-attached rules run with **no KVS registry entry** (the app fails open when absent), and inline static-PF code runs without code offload.
- Note: **conditions are NOT evaluated on the REST path**, and **provider config / the app's `test*` resolvers are admin-UI-only** (not REST) — see FINDINGS.md F3 and the report's caveats.

## Setup

```bash
cd test-harness
cp .env.example .env           # fill in JIRA_BASE_URL, JIRA_ADMIN_EMAIL, JIRA_API_TOKEN
npm install                    # only needed for the (optional) Playwright specs
```

`.env` is gitignored. **The Jira API token is a secret** — it is never committed or logged. Rotate it after use if it was shared.

## Pipeline

```bash
npm run probe          # smoke-test auth + confirm the app's forge rules are attachable
npm run setup          # create COGTEST project + discover workflow/hub status
node scripts/setup-fields.mjs   # create + wire the COGTEST_* custom fields
node scripts/setup-fields-all.mjs  # create ALL 20 Atlassian custom field types
npm run attach         # attach the full rule set (idempotent) as self-loop transitions
npm run seed           # seed the adversarial corpus (COGTEST_ISSUE_COUNT controls volume)
npm run run            # fire every (rule x issue) case, score black-box -> results/run-results.json
npm run bulk           # bulk-transition stress test (BULK_CONCURRENCY controls load)
npm run field-matrix   # write+read EVERY field type; verify via changelog + cogni-debug property
npm run report         # aggregate -> results/report.md + results/report.html
CONFIRM=1 npm run teardown      # delete project + COGTEST_* fields when done
```

`SMOKE=1 npm run run` fires one case per rule (fast sanity check).
`HARNESS_VERBOSE=1` logs all Jira calls.

## Premade rules & recipes (non-AI)

CogniRunner ships **premade** (deterministic, no-AI) validators/conditions and **post-function recipes**. These have offline unit tests — no Jira, no provider, no deploy needed — plus a live E2E for the validator path.

```bash
npm run test:offline        # parity + executor (69 assertions) + recipes (174 checks)
npm run test:premade        # executor: every premade validator/condition + edge cases
npm run test:recipes        # every recipe: build() output parses, uses only real api.*, escapes params
npm run test:parity         # catalog ⇄ executor lockstep lint
npm run test:premade-e2e    # LIVE: attach premade validators, fire transitions, assert BLOCK/ALLOW
```

- **Every `scripts/*.test.mjs` must pass on its own** — `node scripts/<suite>.test.mjs`, no `--import` flag. `run-offline.mjs` launches suites exactly that way, so "green in the runner" and "green standalone" are one statement. A suite that touches a `src/` module which imports `@forge/*` puts `import "../lib/ensure-mocks.mjs";` **above every `src/` import**: the mock is an ESM resolve hook, and a hook registered in a module body is too late for that file's own *static* imports, which are resolved during linking (F-467).
- `OFFLINE_SHUFFLE=1 node scripts/run-offline.mjs` runs the suites in a seeded random order and prints the seed; replay a red run with `OFFLINE_SHUFFLE=1 OFFLINE_SHUFFLE_SEED=<seed>`. Use it to surface order dependence between suites (shared temp files, fixtures one suite writes and another reads).
- `test:offline` imports `src/premade-rules.js` directly with an **injected field reader** (`opts.readField`), so it covers all 22 wired rules + fail-OPEN / CREATE / array / date / ADF edge cases without a live instance.
- `test:premade-e2e` needs the **deployed app** (with the premade branch in `validate()`) + a testbed (`npm run setup`). Premade validators are deterministic, so this works **with no AI provider configured** (unlike `gate-verify.mjs`). Conditions are exercised by `reg-conditions-enforce.mjs` instead — Jira evaluates them itself as the manifest expression, on every surface including REST (the old "not enforced over REST" belief was disproved; see FINDINGS F3).
- Recipe code runs in the static-PF sandbox; the offline test compiles each recipe's generated JS (parse-only) and asserts it uses only documented `api.*` methods and safely escapes interpolated params.

## Layout

| Path | Purpose |
|---|---|
| `lib/jira.mjs` | REST client: auth, 429/5xx backoff, concurrency limiter |
| `lib/workflow.mjs` | The attach engine — confirmed rule + self-loop shapes, `workflows/update` |
| `lib/state.mjs` | Shared run-state in `results/testbed.json` |
| `fixtures/corpus.mjs` | Adversarial issue corpus (injection, fence, unicode, ADF, agentic webs, …) |
| `fixtures/rules.mjs` | The 20 rules under test + per-class expected outcomes + assertions |
| `scripts/*` | setup / setup-fields / attach / seed / run / report / teardown / scan-existing-rules |
| `lib/rules-api.mjs` | Client for the Rules REST API web trigger (URL/token discovered + minted via the dev test-state hook) |
| `lib/mock-forge-api.mjs` | Offline stand-in for `@forge/api` + `@forge/events` (recording mock; used with `register-mocks.mjs`) |
| `scripts/cron.test.mjs`, `jira-events.test.mjs`, `listeners.test.mjs` | Offline tests: cron engine · 68-event catalogue ⇄ manifest lockstep · listener/job engines |
| `scripts/listeners-e2e.mjs`, `jobs-e2e.mjs` | LIVE: push listeners/jobs over REST, fire ~55 Jira events / the real 5-minute tick, assert runs + side effects |
| `scripts/listeners-agent-probe.mjs`, `resolvers-live.mjs` | LIVE: focused script/agent/version listener probe (~2 min); the admin-panel RESOLVER layer driven through the dev-gated `invokeResolver` hook (permission gates, draft test, run-now polling, tokens) |
| `results/` | run-results.json, report.md/html (gitignored) |
| `FINDINGS.md` | Severity-ranked hardening findings + proposed fixes |

## Listeners & Scheduled Jobs

```bash
npm run test:rules-offline    # cron (85) · event catalogue ⇄ manifest (376) · engines — no Jira needed
npm run test:listeners-e2e    # LIVE: REST-pushes a catch-all + targeted listeners, fires ~55 events, asserts runs/side effects, prints coverage
npm run test:jobs-e2e         # LIVE: run-now (scoped AI agent), the real scheduler tick (≤12 min wait), lifecycle round-trips
npm run probe:listeners       # LIVE, ~2 min: one script + one AI-agent + one version listener
npm run test:resolvers-live   # LIVE: the admin resolvers (getListeners/saveListener/testListener/runScheduledJobNow/tokens…) via the dev hook
node scripts/perm-discriminator-live.mjs   # LIVE (Playwright, admin profile): the Permissions picker discriminator — email when Jira returns one, account-id chip always, on BOTH the search row and the roster card; grants {editor,own} through the real UI and restores app_admins with a byte compare. `--editor=<accountId>` picks the target.
npm run test:jsm-assets       # LIVE: JSM request-type events, a real portal request, INTERNAL notes (script + AI agent), Assets workspace/schema/objects/field
npm run test:jsm-import       # LIVE: the rule importer end-to-end on a JSM company-managed workflow (commit → attach → fire → portable-JSON round-trip)
node scripts/harness-fault-expiry-live.mjs  # LIVE: fault-row TTL, the sweep, the user-search route seam. ARMS REAL FAULTS — read the blast radius below. Defaults to staging.
```

### ⚠️ Blast radius: drivers that arm faults on a shared tenant

`harness-fault-expiry-live.mjs` is not a passive reader. To prove that a fault window
really ends, it has to open one — on whichever tenant it is pointed at, where anybody
else using the site sees the result:

- **Provider key reads refuse** for about 5 seconds per arming (`armKeyReadFault`, the
  `openai` slot). An admin on **Settings → Providers** sees *"Couldn't read key status"*,
  and a "test key" click answers a planted refusal. The real risk is not the 5 seconds —
  it is that they read it as a bad credential and **rotate a working key**.
- **User search answers 429** for about 5 seconds per arming (`armJiraFault` on
  `/rest/api/3/user/search`). The Permissions tab's people picker shows a throttling
  notice and finds nobody, so a rule author mid-edit sees an empty search.

Both levers are disarmed in a `finally` on every path including the throw, and each row
carries its own 5 s TTL. Neither survives the driver — **unless the process is killed**,
in which case the only remaining bound is the 300 s family ceiling.

Because of that, the driver **defaults to `--env=staging`**. Running it against the shared
dev tenant is a deliberate act and requires the acknowledgement flag:

```bash
node scripts/harness-fault-expiry-live.mjs                            # staging, the default
node scripts/harness-fault-expiry-live.mjs --env=dev --i-know-dev-is-shared
```

Nothing in the evidence file or the terminal would ever tell the admin who just rotated a
good key that a harness lever was live at that moment. Schedule the run, or tell whoever is
on the tenant — do not let them discover it afterwards.

**The rule is on the directory, not on that one file (F-686).** That acknowledgement used to
live inline in `harness-fault-expiry-live.mjs` and guarded only it, while three siblings
armed the very same levers on the very same tenant: `key-status-fault-live.mjs` and
`key-status-fault-ui-live.mjs` had nothing but `--env=dev` (and the UI one held the key-read
refusal for **240 s** — since cut to 60 s, because its journey reads the card exactly once),
and `user-search-fault-live.mjs` had no `--env` at all, dev being its only mode. The refusal
now has one home, `lib/shared-env-guard.mjs`, exporting `requireEnvAck(argv, { faults, mutates,
maxSeconds, defaultEnv })`: it refuses `dev` without `--i-know-dev-is-shared` while naming
the harm of the faults *that driver* arms and its own longest TTL. It checks argv **before**
it reads `.env`, so the refusal is not a courtesy reserved for machines that are already
configured. Every driver that arms a fault goes through it — including
`git-dispatch-drop-live.mjs` and `git-rotation-window-live.mjs`, which are dev-only by
construction and therefore always require the flag — and
`scripts/evidence-redaction.test.mjs` enforces it on the directory: any `*-live.mjs` that
calls `arm{KeyRead,Jira,GitDispatch,HookPromote}Fault` and does not call `requireEnvAck`
fails `npm run test:offline`, and so does one that calls it with an empty `faults: []`.

**`--env` is a closed set, and the environment table has one home (F-698, F-699).** The
guard used to fork once, on `=== "dev"`, and accept every other string in silence — so
`--env=production`, `--env=prod`, `--env=Dev` and `--env=devv` all ran against **staging**
and then wrote the string they were given into `results/*/evidence.json` as the environment
the run had used. `--env` now has to name a key of the frozen `ENVS` table, case-sensitively;
anything else exits 2 listing the legal values, and `production` gets its own sentence
(there is no production trigger in this directory and there will not be one). A legal
environment whose URL variable is unset exits 2 too, naming the variable, instead of
becoming an `undefined` that turns every hook call into an opaque fetch error.

That table — `{ urlVar, forgeEnvId }` per environment — is the **only** place either fact
lives. Seventeen drivers used to retype the env→URL ternary and **five of them had it
inverted** (`ENV_NAME === "staging" ? STAGING : TESTSTATE_URL`), so an unrecognised `--env`
there resolved to the **shared dev tenant**; the env→Forge-env-id fork sat byte-copied in
eighteen more, which is eighteen hand-edits the day staging is redeployed. Drivers now take
what they need from the one table:

| need | use |
|---|---|
| one environment, settled and guarded | `requireEnvAck(argv, { faults: [], mutates: [], defaultEnv })` → `{ envName, hookUrl, envId }` |
| the Forge env id alone (dev-only Playwright script, no web trigger, no `.env`) | `forgeEnvId("dev")` |
| both environments in one run (`probes-1.5-live.mjs`) | `hookUrlFor(name)` / `hookUrlVar(name)` |
| a dev-only driver with no `--env` at all | `declareMutations([...])` — the blast-radius half alone (F-733) |

`evidence-redaction.test.mjs` §4f fails any `*-live.mjs` whose **code** reads
`STAGING_TESTSTATE_URL` or retypes an environment id UUID, and §4f-1 widens the **env-id**
half to every `lib/*.mjs` and every `scripts/*.mjs` (F-715: the dev id had a second home in
`lib/workflow.mjs`, imported by 58 scripts; this rule used to live in
`live-driver-scope.test.mjs` as RULE 3 and was folded here by F-718, because a rule about
second homes is the last one that should have two). Docblock prose naming the
variable an operator must set is exempt — the discriminator is a read, not a mention.
`TESTSTATE_URL` on its own is fine: a dev-only driver naming the only environment it has is
not deciding a mapping.

**Can the driver even be loaded?** `node --check` exits 0 on an undeclared identifier — it is
a parser, and a ReferenceError is a runtime error — so the F-699 conversion shipped eight
drivers that died on the first line of module evaluation while every text rule read straight
past them. `scripts/live-driver-scope.test.mjs` is the **one home** of that scope check
(F-728: `evidence-redaction.test.mjs` carried a second copy as §4f-2, and that copy *retyped*
the guard's export list while the original parsed it — so adding an export turned one rule red
and left the other green about the same file). Its RULE 1 catches a guard export used and
never imported, RULE 2 an unbound `SCREAMING_SNAKE` name, and **RULE 2b** (F-729) the guard's
own **lowercase** result fields — `envName`, `hookUrl`, `envId`, parsed out of the CONTRACT
docblock that publishes them — because a driver that copies that docblock and drops a field
was invisible to both of the others, measured.

Both suites read source through `lib/js-source-scan.mjs`, which **masks** comments, strings,
template text and regex literals to spaces of the *same length* (`${…}` holes are kept — an
interpolated identifier is a real read). The length is what lets `callArgs` balance parens on
the mask and slice the original, so a `)` inside a FAIL message no longer truncates that
call's own arguments (F-730: it made the leak-artefact rule go **red on a correct driver**,
and an unmatched `(` re-opened the unbounded window F-716 had just closed).

**The acknowledgement is drawn at MUTATES, not at ARMS (F-718).** It used to be drawn at
arming, and the line fell in a place nobody would have chosen: `plant-sweep-live.mjs`, which
writes inert ballast and arms nothing, demanded the flag, while `va-purge-on-delete-live.mjs`
deleted a virtual agent, `coder-pin-kept-live.mjs` rewrote `COGNIRUNNER_AI_PROVIDER` and
`knowledge-doors-editor-live.mjs` wrote skills into the shared store — all on `--env=dev`, in
silence. A fault is loud, short and disarmed in a `finally`; a mutation is quiet and
**outlives the process** — the deleted agent does not come back. So `requireEnvAck` now takes
`mutates: [...]` beside `faults: [...]`, from a closed vocabulary (`roster`, `skills`, `docs`,
`memories`, `providerSlot`, `agents`, `jobs`, `listeners`, `rules`, `issues`, `git`, `kvs`);
**either** array being non-empty makes `--env=dev` require `--i-know-dev-is-shared`, and the
refusal lists what would be touched, in this driver's own words. Both arrays are required —
`mutates: []` is a read-only driver's statement, not an omission, and a read-only driver runs
on dev with no ceremony, which is what keeps the refusal worth reading. `evidence-redaction.
test.mjs` §4g keeps the declaration honest in both directions: a driver that calls a mutator
(`kvSet`, `vaTombstone`, `saveScheduledJob`, `saveSkill`, `createApiToken`, a Jira
`POST`/`PUT`/`DELETE`, …) may not declare `mutates: []`, and one that declares a mutation it
never performs fails too, because a refusal nobody believes is one people learn to flag
through. Six drivers legitimately **default to dev** (`knowledge-doors-editor`,
`perm-namesake-ui`, `sandbox-confluence`, `va-capability-gate`, `va-rest-doors`, `va-shadow`)
and **all six mutate**, so all six ask for the flag there. `perm-namesake-ui` was listed here
as the one read-only exception until F-734: it GRANTS AN APP-ADMIN ROLE by clicking a row in
the Permissions tab, and the `app_admins` KVS diff that is the whole point of the driver only
passes because the grant is real. §4g never saw it because the write is a mouse event and §4g
is a token scan (F-737), so an honest-looking `mutates: []` sat on the one driver this
paragraph pointed at as safe.

**The dev-only drivers declare too (F-733).** §4g used to name its own gap: only a driver that
calls `requireEnvAck` could declare anything, and the 26 `*-live.mjs` that take no `--env` at
all could not — while several of them write hard (`perm-discriminator` grants and removes app
roles, `skills-knowledge-ui` writes skills into the shared store, `pipeline-scaffold` pushes a
deploy). Routing them through `requireEnvAck` is the wrong fix and F-699 already said why: it
would make a Playwright script that never opens a web trigger demand a `.env` and a
`TESTSTATE_URL` it has no use for. So the guard also exports **`declareMutations([...])`** —
the declaration half on its own, called at module top, same closed vocabulary, same sentences,
same exit code, **no environment resolved and no `.env` read**. There is nothing to choose:
dev is the only tenant these drivers have, so a non-empty set always asks for
`--i-know-dev-is-shared` and `declareMutations([])` runs with no ceremony. §4g reads the call
exactly as it reads `mutates:`, and now asserts that **every** `*-live.mjs` declares —
`guardedDrivers.length === liveFiles.length`.

Measured 2026-09-14 over all 26: 23 of 23 mutating drivers exit 2 with the refusal, and the 3
read-only ones (`campaign-history-ui`, `campaign-test-run-ui`, `campaign-ui`) run on to their
own fixtures. One limit, stated rather than implied: ESM evaluates imports before the module
body and `lib/jira.mjs` / `lib/rules-api.mjs` call `loadEnv()` at module scope, so on an
**unconfigured** machine 24 of the 26 print "Missing .env" before the refusal. The guarantee
that holds for all of them is that the refusal precedes every **network** call and every
browser — `loadEnv` reads a file, it does not touch a tenant.

**`--envid` may not re-decide the row (F-732).** F-714 fixed the hook-half/browser-half split
in one driver and left it available **by flag** in eight siblings: `--envid` took a raw
environment id that overrode the settled row, so `--env=staging --envid=<dev id>` armed a
fault on staging for 240 s and pointed Playwright at the **dev** admin page, where nothing was
armed — the driver then fails with "the notice never appeared" and `ev.env` records
`"staging"` for a run whose UI half was dev. §4f forbids retyping an id **in a file**; an id
typed on the **command line** is the same decision made outside the one home, and the
shared-dev ack cannot cover it because that keys off `--env`. `requireEnvAck` now refuses any
`--envid` that is not `forgeEnvId(envName)`, naming the environment that id belongs to; the
eight drivers keep the flag for the one meaning it can honestly have. `va-shadow-door-live.mjs`
is deliberately two-environment and its override is now `--staging-envid`.
`scripts/shared-env-guard.test.mjs` drives both refusals as refusals — in a child process,
because they `process.exit(2)` — and asserts each arrives **without** an env file, which is
what keeps the "refuse before `loadEnv`" ordering honest.

### The read ceiling on `?what=kvs`, and the stash door (F-769)

The dev hook's `?what=kvs` read stays **unrestricted in which rows it may reach** — that is a
read, and a harness that can only look where it already expected to look finds nothing. What
it may **say** about a credential row is what changed: a credential-family key
(`COGNIRUNNER_KEY_*`, the legacy OpenAI slot, the Forge identity, the doc-processor and
web-search remotes, `git_conn_secret:*`, `git_hook_secret:*`, `webtrigger_url:*`,
`att_token:*`, `upload_token:*`, `probe:webhook:secret`, `harness_stash:*`, plus a name
catch-all) now answers `{key, present, fingerprint, masked: true}` and **never `value`** —
it used to hand back the tenant's BYOK key in plain text, and `lib/redact.mjs` masks nothing
there because a bare provider key has no `sk-`/`ghp_` prefix and the field is called `value`,
so it landed in a committed evidence file verbatim. Every other key is untouched and still
returns its value. A driver therefore asks `present` for PRESENT/EMPTY and compares
`fingerprint` (an HMAC-SHA256 keyed from `HARNESS_SECRET`, truncated to 16 hex — so it is
comparable **only within one installation and only while that secret is unchanged**; rotate
the secret and two identical rows answer different fingerprints, which is why a fingerprint
carried out of an old evidence file must never be compared against a later run's) for
identity, through the one home,
`lib/key-slot-witness.mjs` — never `.value`, which after the ceiling is `undefined` and turns
a before/after check into `EMPTY === EMPTY`, a green assertion that can no longer fail. A
driver that must **replace** a credential and put the tenant's own back uses the **`kvStash`
/ `kvRestore`** pair instead of snapshot-and-replay: `kvStash` copies the row to
`harness_stash:{id}` server-side and answers `{stashed, stashId, present, fingerprint}`,
`kvRestore` writes it back by that opaque id and answers `{restored, key, present,
fingerprint}`, the value never crosses the wire in either direction, the stash is TTL-bound
and single-use, it is bound by the same write allow-list as `kvSet` (so `git_conn_secret:*`
and `git_hook_secret:*` stay unstashable, exactly as they are unplantable), and a stash taken
of an absent row **deletes** the key on restore rather than writing `null`. Restoring through
`kvSet` instead would write `undefined` over a working credential — strictly worse than the
leak the ceiling closed, which is why §4i of `evidence-redaction.test.mjs` refuses a driver
that plants a credential without the stash, and refuses one that reads `.value` off a
credential answer.

### Git drivers: the webtrigger URL, and the state file (F-764)

Two things make the git drivers look broken on a machine that is otherwise configured, and
neither is a defect. Both cost the tester a session before they were written down.

**`GIT_WEBHOOK_URL` is minted by hand, once per environment.** It is not the test-state
trigger and it is not derivable from it — it is the app's own `git-webhook` web trigger, the
url GitHub posts deliveries to. Without it `git-webhook-setup-live.mjs` and
`git-rotation-window-live.mjs` exit 2 immediately. Mint it with:

```bash
forge webtrigger create -f git-webhook -e development     # then: --help for the non-interactive flags
```

**Treat the result as a secret and never print it.** Its path token is unguessable and is the
only thing between the open internet and the app's inbound delivery path. HMAC verification
means a leaked url cannot forge a *delivery*, which is why the dev hook masks rather than
refuses (`listGitWebhooks` returns `urlMasked{host, conn, repo, fingerprint}` and no `url` at
all), but a url pasted into a terminal, a commit or an evidence file has been published.
It goes in `test-harness/.env` as `GIT_WEBHOOK_URL=…` and nowhere else — `.env` is
git-ignored, and `evidence-redaction.test.mjs` is what keeps it out of the artefacts. The
same applies to `forge webtrigger list`: read it, do not paste it.

**`results/git-webhook-setup/state.json` outlives the objects it names.** It is written by
`git-webhook-setup-live.mjs setup` and carries `conn1` / `hook1` / `label1` — the connection
and GitHub hook that `git-rotation-window-live.mjs` **borrows**. Its lifecycle:

| step | what happens to the file |
|---|---|
| `git-webhook-setup-live.mjs setup` | written — the fixture now exists |
| `... rotate` / `... listener` / `... pr` … | updated in place after each phase |
| `git-rotation-window-live.mjs <window\|fault>` | **read only** — this driver owns nothing, and its `finally` proves it did not break what it borrowed |
| `git-webhook-setup-live.mjs cleanup` | the objects are deleted and **the file is left behind**, now naming things that are gone |

That last row is the trap. The rotation driver used to trust the file on `existsSync` alone
and opened with `FAIL the connection row has no webhook record for <repo>` — which reads as a
product defect and is in fact stale harness bookkeeping. It now does **one liveness read of
the connection through the hook before any phase runs**: if `listGitConnections` no longer has
`conn1`, the file is **renamed aside** to `state.stale-<timestamp>.json` (renamed, not deleted
— it is the evidence of which id went missing) and the driver stops with a sentence saying so
and telling you to re-run `setup` then `rotate`. If `listGitConnections` cannot be read *at
all*, the file is left exactly as it is: an unreachable hook is not evidence of a missing
connection, and a guess in that direction would throw away a good fixture over a blip.

### JSM & Assets prerequisites

`test:jsm-assets` needs the API user to be a **service-desk agent AND project admin**
on the JSM project (both scripts pick a project via `/issue/createmeta` — `mypermissions`
lies on demo service projects). Grant it once:

```
POST /rest/api/3/project/<JSMKEY>/role/<roleId>   { "user": ["<accountId>"] }
# roles: "Service Desk Team" and "Administrators"
```

Two things REST cannot do, and the scripts report them as explicit SKIPs rather than
silent gaps: there is **no REST update for a request type** (`PUT` → 405, so
`avi:jsm-entity:updated:request-type` is UI-only), and an **Assets object custom field
cannot be given its object-schema/AQL configuration over any public REST API** — without
that configuration a write returns 204 and stores nothing. Configure it once in
Settings → Issues → Custom fields → Configure → Assets, then re-run for the live read.

`.env` needs `TESTSTATE_URL` + `HARNESS_SECRET` (and `HARNESS_ADMIN_ACCOUNT_ID`, the admin the hook acts as, for `git-inbound-live.mjs`) (the dev-only test-state web trigger; the scripts discover the `rules-api` URL and mint a token through it) or `RULES_API_URL` + `RULES_API_TOKEN` directly. Both scripts clean up after themselves (`KEEP=1` to keep the data). The listeners E2E lists, per run, which of the 68 events it could not fire (user events, issue viewed, failed expression, permanent field deletion) — see `docs/LISTENERS-AND-JOBS.md`.

## Scope this run

- Provider: **Forge LLM** (zero-key; confirmed active via `forge logs`). The provider matrix is built but dormant — drop a BYOK key in `.env` to extend.
- Playwright specs for the admin/UI-only flows are **not included** in this run: they require an authenticated browser session (the REST token can't drive the Forge Custom UI iframe; the account is SSO). The black-box REST layer delivers the headline results without them.
