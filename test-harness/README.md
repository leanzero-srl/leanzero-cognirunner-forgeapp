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

- `test:offline` imports `src/premade-rules.js` directly with an **injected field reader** (`opts.readField`), so it covers all 22 wired rules + fail-OPEN / CREATE / array / date / ADF edge cases without a live instance.
- `test:premade-e2e` needs the **deployed app** (with the premade branch in `validate()`) + a testbed (`npm run setup`). Premade validators are deterministic, so this works **with no AI provider configured** (unlike `gate-verify.mjs`). Conditions are **not** exercised here — Jira doesn't evaluate conditions on the REST transition path (see "Why black-box"); their logic is covered by the offline executor test.
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
| `results/` | run-results.json, report.md/html (gitignored) |
| `FINDINGS.md` | Severity-ranked hardening findings + proposed fixes |

## Scope this run

- Provider: **Forge LLM** (zero-key; confirmed active via `forge logs`). The provider matrix is built but dormant — drop a BYOK key in `.env` to extend.
- Playwright specs for the admin/UI-only flows are **not included** in this run: they require an authenticated browser session (the REST token can't drive the Forge Custom UI iframe; the account is SSO). The black-box REST layer delivers the headline results without them.
