/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * GENERATED — DO NOT EDIT.
 *
 * Field-guide pack "cognirunner-sandbox-traps" — 5 sections.
 *
 * Produced by scripts/bake-knowledge.mjs from the allow-list in knowledge/sources.json.
 * Edit the SOURCE and re-bake; an edit here is overwritten the next time anyone runs the
 * pipeline, and it would not carry the provenance or the leak scan that make this file
 * safe to ship. Dependency-free on purpose: this bundles into the Forge backend and the
 * webpack builds alike.
 *
 * The human-review artefact for this content is knowledge/MANIFEST.md.
 */

export const PACK_ID = "cognirunner-sandbox-traps";

export const SECTIONS = [
  {
    "id": "cognirunner-sandbox-traps/cognirunner-gotchas/4870432a/12-two-agents-one-working-tree-4",
    "pack": "cognirunner-sandbox-traps",
    "title": "12. Two agents, one working tree",
    "tags": [
      "sandbox",
      "trap",
      "post function",
      "cognirunner",
      "kvs",
      "resolver",
      "12.",
      "two",
      "agents",
      "one",
      "working",
      "tree",
      "http-404",
      "http-403",
      "api"
    ],
    "audience": [
      "codegen",
      "fix",
      "coder",
      "review"
    ],
    "provenance": {
      "source": "cognirunner-gotchas",
      "path": "~/Projects/CogniRunner/.claude/skills/cognirunner-development/references/GOTCHAS.md",
      "hash": "813bd11877c55a90",
      "licence": "ours (CogniRunner development skill)"
    },
    "bytes": 2296,
    "body": "**Symptom.** One surgeon committed to `main` while a second held uncommitted edits in the\nsame checkout.\n**Receipt.** 2026-09-04. No damage — territories were disjoint and the second surgeon\n*chose* not to commit — but nothing enforced either condition.\n**Fix.** Prime directive 1. Parallel surgeons get `isolation: \"worktree\"`, or they run in\nsequence, and the coordinator sequences the commits.\n\n## 13. Polling for a subagent costs a request per poll and tells you nothing\n**Receipt.** 2026-09-04. Roughly fifteen turns spent on `sleep` + `git diff --stat` loops.\n**Fix.** Prime directive 6. Completions arrive as notifications. When you need a specific\ncondition, put ONE blocking `until … do sleep N; done` in a backgrounded command.\n\n## 14. The dry-run tester is weaker than production, and says success anyway\n**Symptom.** Code passes Test Run and throws in production; or a null-issue job step passes\nTest Run because `api.context.issueKey` is pinned to `\"MOCK-1\"`.\n**Receipt.** 2026-09-04, F-008 and F-017. `testApi` exposes 16 of production's 32 members;\n`updateIssue`/`transitionIssue`/`editIssue` used to log `(\"undefined\", …) — DRY RUN` and\nreturn `{ success: true }` for calls that 404 in production.\n**Status.** Partly fixed by F-004 (the five key-optional methods and `forIssue` re-binding\nnow match production; `transitionByName` exists at all). The MOCK-1 pinning and the ~15\nmissing stubs are open. **`testListener` does NOT have the MOCK-1 hole** — proven live.\n\n## 15. The dev hook's invokeResolver allowlist decides what can be proven\n**Symptom.** The tester could not exercise `testPostFunction` live and had to characterise\nit offline with mocked `@forge/*`.\n**Root cause.** `src/test-hook.js` allowlists read-only + listener/job resolvers;\n`testPostFunction` is not among them, and a tester may not edit `src/`.\n**Fix.** When a leg is unprovable because of the allowlist, say so in UNPROVEN rather than\nsoftening the verdict — and consider whether the allowlist should grow in a separate cut.\n\n\n**Symptom.** Every live suite's cleanup logs `issue delete → 403` and fixture issues pile up.\n**Receipt.** F-019. Listeners and jobs clean up correctly; only issues leak.\nbulk-delete issues to tidy up** — the owner's standing rule is: clean RULES, not issues."
  },
  {
    "id": "cognirunner-sandbox-traps/cognirunner-gotchas/4870432a/17-an-assets-object-field-silently-stores-nothing-until-conf-5",
    "pack": "cognirunner-sandbox-traps",
    "title": "17. An Assets object field silently stores nothing until configured in the UI",
    "tags": [
      "sandbox",
      "trap",
      "post function",
      "cognirunner",
      "kvs",
      "resolver",
      "17.",
      "assets",
      "object",
      "field",
      "silently",
      "stores",
      "nothing",
      "until",
      "/rest/api/3/field/",
      "/rest/insight/1.0/",
      "/rest/servicedesk/cmdb/",
      "/rest/internal/2/",
      "/rest/servicedeskapi/servicedesk",
      "http-404",
      "http-429",
      "api",
      "asapp",
      "requestjira",
      "requestconfluence"
    ],
    "audience": [
      "codegen",
      "fix",
      "coder",
      "review"
    ],
    "provenance": {
      "source": "cognirunner-gotchas",
      "path": "~/Projects/CogniRunner/.claude/skills/cognirunner-development/references/GOTCHAS.md",
      "hash": "813bd11877c55a90",
      "licence": "ours (CogniRunner development skill)"
    },
    "bytes": 3191,
    "body": "**Symptom.** `PUT /issue/{key}` with `[{key:\"CRT-71\"}]` returns 204 and reads back `[]`.\n**Root cause.** The field has no object-schema/AQL configuration, and there is **no public\nREST endpoint** to set one (probed and 404: `/rest/api/3/field/{id}/context/{ctx}/\nconfiguration`, `/rest/insight/1.0/*`, `/rest/servicedesk/cmdb/*`, `/rest/internal/2/*`).\n**Receipt.** F-003. Blocks the live Assets extractor assert until a human configures it once.\n\n## 18. The sandbox cannot reach Assets, or any non-Jira REST\n**Root cause.** Step code gets `api` and nothing else — no `fetch`, no `asApp`, no generic\nREST method. Assets lives on `api.atlassian.com`, which is not in `external.fetch` and not\nreachable through `requestJira`.\n**Consequence.** CogniRunner can only ever read Assets as **issue field data**. Say so\nplainly when someone asks for Assets automation.\n\n## 19. Platform facts settled by the Coder plan Part 0 probes (2026-09-12)\nReceipts: `test-harness/scripts/_probe-git-condition.mjs`, the dev test hook's `probe` /\n`probeConfluence` / `probeServiceDesk` / `probeProperty` actions, KVS rows `probe:*` on dev + staging.\n\n- **`license.capabilitySet` is camelCase on the wire** (`\"capabilityAdvanced\"`), matching the\n  `@forge/api` type and NOT the docs (`capabilityadvanced`). The object also carries\n  `state: \"advanced\"`, `active`, `isActive`, `type`, `billingPeriod`. Compare case-insensitively.\n  It is present in **webtriggers AND the async consumer** via `getAppContext().license` — but only\n  when the install carries a license: a dev install without `--license` has the key with value\n  `null`. `forge install --upgrade --license advanced` on an already-current install does NOT apply\n  the flag (\"Site is already at the latest version\"); a fresh install (we used staging) does.\n- **Forge LLM's 50,000 tokens/minute cap is PER MODEL per installation**, and it refuses only once\n  the minute's usage already exceeds 50k (two 46.7k-token calls pass, the third gets the 429).\n  Sonnet 5 and Opus 5 counted independently in the same minute. A 46k-token call answers in ~2.4 s.\n  `estimateTokensFromText` (chars/4) under-counts filler text by ~2×.\n- **A Jira expression in the ONE condition module reads `issue.properties?.[\"cognirunner.git\"]`**:\n  six such conditions on six transitions evaluated correctly (missing → TRUE by our branch,\n  success → shown, failure → hidden). The ≤10-expensive-ops limit did not bite at 12 reads.\n- **Cross-product works from a Jira-triggered function**: with `app.compatibility.confluence.required:\n  false` and `forge install -p Confluence`, `asApp().requestConfluence('/wiki/api/v2/spaces')` → 200.\n  The scope change made the CLI prompt for the second install.\n- **JSM as the app**: `/rest/servicedeskapi/servicedesk`, `/servicedesk/{id}/queue` (each queue\n  carries its `jql`) and `/queue/{id}/issue` all 200 with `read:servicedesk-request`.\n- **A Forge webtrigger's `body` string is byte-identical to what GitHub signed**: HMAC-SHA256 over\n  `req.body` verified a real 8,008-byte `ping` delivery (`x-hub-signature-256`, VALID). Headers\n  arrive lower-cased in arrays; the Atlassian edge adds ~20 `atl-edge-*`/`x-b3-*` headers."
  },
  {
    "id": "cognirunner-sandbox-traps/cognirunner-gotchas/4870432a/4-a-silent-wrong-issue-write-hides-behind-a-type-check-that--2",
    "pack": "cognirunner-sandbox-traps",
    "title": "4. A silent wrong-issue WRITE hides behind a type check that looks defensive",
    "tags": [
      "sandbox",
      "trap",
      "post function",
      "cognirunner",
      "kvs",
      "resolver",
      "silent",
      "wrong",
      "issue",
      "write",
      "hides",
      "behind",
      "type",
      "check",
      "/rest/api/3/issue/createmeta/",
      "api"
    ],
    "audience": [
      "codegen",
      "fix",
      "coder",
      "review"
    ],
    "provenance": {
      "source": "cognirunner-gotchas",
      "path": "~/Projects/CogniRunner/.claude/skills/cognirunner-development/references/GOTCHAS.md",
      "hash": "813bd11877c55a90",
      "licence": "ours (CogniRunner development skill)"
    },
    "bytes": 2196,
    "body": "**Symptom.** An AI-agent run comments on the issue it was bound to instead of the one the\nmodel named, with nothing in the log saying an argument was discarded.\n**Root cause.** `keyOf` read `typeof args.issueKey === \"string\"` and fell back to the bound\nkey for anything else, so an object key was swallowed before any guard could see it.\n**Receipt.** 2026-09-04, F-015. Found by a surgeon **de-duplicating**, not by the review\nthat was hunting for defects. The severest finding of the session arrived as a side effect.\n**Fix.** Hand the raw value to the shared resolver and let its type guard throw. Note\nF-018: the tool schema declares `issueKey` as `{type:\"string\"}`, so the model's object is\ncoerced before the guard is reached — the guard is belt-and-braces on that path.\n\n## 5. mypermissions lies on JSM demo projects\n**Symptom.** A harness picks a service desk, reports `CREATE_ISSUES: true`, then dies on\nthe first create with *\"the target project doesn't exist or you don't have permission\"*.\n**Receipt.** 2026-09-03/04. Cost two failed E2E runs before the selector was changed.\n**Fix.** Gate on `GET /rest/api/3/issue/createmeta/{key}/issuetypes` — it lists only what\n\n## 6. Forge never delivers avi:jsm-entity::request-type over REST\n**Symptom.** A correctly subscribed listener records zero runs after a request-type create\n(201) and delete (204) by an agent+admin user.\n**Root cause.** Platform. Not the app — proven three ways.\n**Receipt.** 2026-09-03/04, F-006. (1) `manifest.yml:282-287` subscribes all three;\n(2) driving the real `listeners.js` offline with the documented payload ENQUEUES, with and\nwithout a project filter, zero REST calls; (3) a no-write catch-all over all 68 events with\n`ignoreSelf` OFF logged 50 runs across 7 event types in the window and no jsm-entity, and\n`?resource=samples` holds payloads for `created:issue` / `created:sprint` / `viewed:issue`\nand **nothing** for either jsm event.\n**The instrument to reuse:** `captureSample` runs BEFORE every filter, the candidate slice\nand the brakes. **No run AND no sample = the trigger was never invoked. No run WITH a\nsample = an app-side drop.** One REST call separates platform silence from an app bug."
  },
  {
    "id": "cognirunner-sandbox-traps/cognirunner-gotchas/4870432a/7-forge-logs-cannot-be-relied-on-for-a-specific-window-3",
    "pack": "cognirunner-sandbox-traps",
    "title": "7. forge logs cannot be relied on for a specific window",
    "tags": [
      "sandbox",
      "trap",
      "post function",
      "cognirunner",
      "kvs",
      "resolver",
      "forge",
      "logs",
      "cannot",
      "relied",
      "specific",
      "window",
      "http-404",
      "api"
    ],
    "audience": [
      "codegen",
      "fix",
      "coder",
      "review"
    ],
    "provenance": {
      "source": "cognirunner-gotchas",
      "path": "~/Projects/CogniRunner/.claude/skills/cognirunner-development/references/GOTCHAS.md",
      "hash": "813bd11877c55a90",
      "licence": "ours (CogniRunner development skill)"
    },
    "bytes": 2134,
    "body": "**Symptom.** `forge logs --since <ISO>` and `-n 300` both return windows that stop short of\nthe minutes you care about; `--since 45m` returned 23 lines spanning two minutes.\n**Receipt.** 2026-09-03. Cost ~20 minutes of trying to prove trap 6 from logs before the\nsample endpoint settled it in one call.\n**Fix.** Use logs for *what happened* (exceptions, stack traces), never as proof that\nsomething did NOT happen. For absence, use an in-app instrument that persists — the event\nsample, an issue property, the execution log.\n\n## 8. timeout does not exist on macOS\n**Symptom.** `timeout 100 forge logs … | grep …` prints nothing and looks like \"no matches\".\n**Receipt.** 2026-09-03. Produced two confident, meaningless empty results in a row.\n**Fix.** `gtimeout` (coreutils) or run it backgrounded and read the file. **A zero from an\ninstrument is not evidence until a positive control passes on the same object.**\n\n\n**Symptom.** Every `?what=` on the test-state web trigger returns `404 not found`, which\nlooks exactly like a stale or wrong URL.\n**Root cause.** Forge environment variables only reach the running code on the next\n`forge deploy`. The hook returns 404 whenever the secret is unset or mismatched.\n**Receipt.** 2026-09-03. Cost a round of URL re-discovery via `forge webtrigger list`\nbefore the cause was found.\n`forge deploy -e development`, then retry. Confirm with `curl` before blaming the harness.\n\n## 10. A catch-all listener with ignoreSelf: false that writes will spin\n**Symptom.** Designed, not suffered — caught in review before the probe ran.\n**Root cause.** A listener subscribed to `commented:issue` that posts a comment re-triggers\nitself; only the per-issue (30/5min) and per-listener (120/5min) brakes stop it.\n**Fix.** An observation-only catch-all uses `api.log(...)` and returns — the execution log\nIS the evidence. Never give a loop-guard-disabled listener a write.\n\n## 11. The listener index is cached 30 s per warm container\n**Symptom.** A freshly saved listener does not match the event you just fired.\n**Fix.** Wait ~35 s after saving before firing. Every live listener script does this."
  },
  {
    "id": "cognirunner-sandbox-traps/cognirunner-gotchas/4870432a/gotchas-traps-each-with-its-receipt-1",
    "pack": "cognirunner-sandbox-traps",
    "title": "GOTCHAS — traps, each with its receipt",
    "tags": [
      "sandbox",
      "trap",
      "post function",
      "cognirunner",
      "kvs",
      "resolver",
      "gotchas",
      "traps",
      "each",
      "its",
      "receipt",
      "/rest/api/3/issue/undefined",
      "http-404",
      "api"
    ],
    "audience": [
      "codegen",
      "fix",
      "coder",
      "review"
    ],
    "provenance": {
      "source": "cognirunner-gotchas",
      "path": "~/Projects/CogniRunner/.claude/skills/cognirunner-development/references/GOTCHAS.md",
      "hash": "813bd11877c55a90",
      "licence": "ours (CogniRunner development skill)"
    },
    "bytes": 2885,
    "body": "<!--\n CogniRunner - AI-powered workflow validation for Jira\n Copyright (C) 2025 LeanZero\n SPDX-License-Identifier: Apache-2.0\n-->\n\n# GOTCHAS — traps, each with its receipt\n\nSymptom → root cause → fix. A trap earns a number here only when it has actually cost\nsomething real: a wrong conclusion, a dead run, a wasted hour. **Never renumber** — the\nnumbers are cited from commit messages and ledger rows.\n\n---\n\n## 1. node --check is not a gate for src/shared/.js\n**Symptom.** A shared module passes the documented syntax gate and breaks every consumer\nat import time.\n**Root cause.** `package.json` has no `\"type\": \"module\"`, so `node --check` parses these\nfiles as CommonJS-ish and never evaluates the ES-module template literals. An un-escaped\nbacktick inside a `promptDoc` exits 0.\n**Receipt.** 2026-09-04, F-012. Deliberately re-injected to confirm: `node --check\nsrc/shared/sandbox-api-spec.js` exited **0** while the real `import()` threw `Unexpected\nidentifier 'REST'` on that file *and* on `builtin-docs.js`, which imports it.\n**Fix.** `test-harness/scripts/shared-imports.test.mjs` (inside `npm run test:offline`)\ndynamically imports every shared module. **Do NOT** \"fix\" this with `\"type\": \"module\"` —\nthat changes how the Forge bundler and three webpack builds read every file in the repo.\n\n## 2. api.getIssue() with no key → /rest/api/3/issue/undefined → 404\n**Symptom.** A listener/job step 404s and the error reads like a permissions or JSM problem.\n**Root cause.** Five sandbox methods took a mandatory key while all 22 issue-bound helpers\ndefaulted to the current issue, so the natural shape was the broken one.\n**Receipt.** 2026-09-04, F-004. Cost a false conclusion — *\"the rule importer is broken on\nJSM workflows\"* — that survived until `forge logs` was pulled. Fixed in `7d2a1d2`/`43be991`.\n**Fix.** `resolveIssueKey` + `normalizeKeyOptionalArgs` in `sandbox-api-spec.js`. **Pull the\nlogs before you name a cause.**\n\n## 3. \"Key optional\" without arity handling is a lie for every 2-argument method\n**Symptom.** Docs promise `api.updateIssue({fields})`; the object lands in the `key`\nparameter and the PUT body becomes `{ fields: undefined }`.\n**Root cause.** An optional FIRST parameter only works if omitting it shifts the rest.\n**Receipt.** 2026-09-04, caught in review of the F-004 cut before it shipped. The surgeon's\nown new `forIssue` promptDoc promised `api.forIssue(\"PROJ-1\").transitionByName(\"Done\")`,\nwhich under the un-shifted implementation binds `key=\"Done\"` — the *same* defect the\narchitect had just found in the OLD doc, re-introduced by the new one.\n**Fix.** Split by **ARITY**, never by matching a string against an issue-key regex: a\ntransition name, a label or a status can look like anything, and a wrong guess writes to\nthe wrong issue. **Re-read every `example` and `promptDoc` you touch against the FINAL\nimplementation.**"
  }
];

export default SECTIONS;
