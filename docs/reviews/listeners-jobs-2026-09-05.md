# Listeners and scheduled jobs review — 5 September 2026

Follow-up: the scheduled fixes below are now implemented in [the remaining-fixes report](remaining-fixes-2026-09-05.md), covering development22.158.0 and the explicit external attachment verification blocker. This report retains the earlier22.153 evidence and scope.

Status: implemented and verified on wolfaenpak development **22.153.0**. Independent final six-lens review found zero new high-confidence defects. Production was not deployed.

Scope: next CogniRunner update, development deployment on wolfaenpak only. Preserve the existing code-step builder and AI agent mode. Evaluate novice/mid-level admin comprehension and actual runtime behavior, not counts alone.

## Product assessment

The trigger → filters/scope → action → results structure already fits the intended product. Code steps and runtime AI agents deserve to remain separate. A listener AI condition adds a useful semantic decision before deterministic code; the UI must distinguish its runtime AI usage from code generation. The main problem is trust in test results and context, rather than missing power or a need for a new builder.

Official comparison: ScriptRunner Cloud [listeners](https://docs.adaptavist.com/sr4jc/current/features/script-listeners) and [scheduled jobs](https://docs.adaptavist.com/sr4jc/latest/features/scheduled-jobs) use event/schedule selection, script context and execution results. CogniRunner already provides the equivalent foundations plus constrained runtime AI. ScriptRunner offers a run-as choice; CogniRunner currently runs as its app identity, which should be explained rather than implied to match the operator. Its schedule preview should communicate due times rather than promise exact starts.

## Confirmed before-fix failures

- Listener whole-rule tests bypassed static project/type/changed-field/comment filters and JQL. Live COGTEST-2697 test: positive AND wrong project/type/field/JQL all returned isValid=true, skipped=false and one simulated operation. No label was actually written (second REST read). Offline also proved the AI gate/action can be invoked despite static mismatch.
- Scoped job cancellation before work returned success=true and 2/2 processed OK with an empty issue outcome list. Cancellation after an earlier issue also overstated completion.
- Code-step tests with listener/job runtime and no selected issue invented MOCK-1. A no-current-issue addComment passed, although actual runtime correctly throws. Reduced mock API omitted valid runtime methods.
- Result cards and global Logs prioritized isValid=true over decision=SKIP, displaying PASS for filtered-out work.
- UTC is omitted by Intl.supportedValuesOf('timeZone'), leaving a saved UTC job's dropdown saying Select. Clearing custom cron substitutes the default in preview; changing time zone can replace the user's invalid expression with that default.
- Reused FunctionBlock copy refers to workflow transitions in listener/job editors. Runtime AI gate cost, app identity, and real run-now effects need accurate nearby wording.

## Additional verification and constraints

Existing UI harness 65/65 passed despite the failures above: interaction smoke alone is inadequate. Existing jobs live baseline 19/19 includes actual script and AI writes and a real scheduled tick. A due time of 09:20 UTC was processed near09:25 UTC by the platform tick, with about4.2s queue delay after enqueue.

The existing harness leaked API tokens per process until the cap of25 blocked tests. All25 were identified as old harness tokens and revoked; a second metadata read confirmed zero active. Tests use one temporary token and revoke it. COGTEST fixture deletion is denied to the API principal; LZPT and JT permit create/delete/administer. Future fixtures should use those beds. Do not report ignored403 cleanup responses as cleaned up.

## Additional defects caught by independent review

F-020: execution claims used a read followed by a write. Two consumers receiving the same task simultaneously both executed. The existing Forge conditional-write mechanism now owns listener, scheduled-job and tick claims through one dependency-free helper. Claim keys and two-hour TTLs remain the same. A duplicate is skipped; a genuine KVS infrastructure error retains the previous logged continue policy. This does not guarantee exactly-once execution across new event identities or storage outages.

F-021: a delayed test response for unsaved listener A could replace the ID of saved listener B opened in the meantime. Editor-session guards now cover test, save and load responses in both tabs, plus captured samples and recent-log requests. Listener save and whole-rule test cannot compete for a new ID. A running job still blocks another manual start, while its result/header cannot impersonate another job being edited.

## Verification results

- Offline suite37/37, including real shared-module import gate; runtime regression66/66; per-step production-sandbox probe51/51. Backend syntax and Forge lint passed. Three production UI builds passed; existing bundle-size warnings remain.
- UI117/117 light/dark edge journeys,177/177 broader editor journeys, and8/8 deferred-response race checks. Tests drive real bundled React with mocked bridge responses; they establish UI behavior, not Jira writes.
- Live22.152.0 review14/14: matching and mismatching project/type/changed-field/JQL filters, invalid JQL failure, saved UTC display, actual in-Jira code-step failure with no current issue, explicit-target method simulation, independent zero-write reads, cancelled scoped job after the first real write, SKIPPED accordion. LZPT273/274 and all associated rules removed, independently verified.
- Existing scheduler baseline19/19 includes a real five-minute tick and AI-agent writes. Final patched JSM/Assets suite27passed/0failed/2explicit skips. JT50 stored exact CRT71 workspace/global/object IDs, and a real listener copied an identical raw field value into an issue property. Internal script and AI notes were public:false, ordinary reply public:true; every expected comment appeared exactly once.
- Plans: disabled scoped job changed WFH36 Start date (customfield10015), actually mapped in plan1, from null to2026-09-07. Both independent Jira REST and actual Plans row showed the date. The same job restored null; selected Jira fields and the exact Plans row matched the baseline. Existing plan settings and pending draft were preserved.

## Remaining limits and named followups

- F-013 and the workflow-only mock API remain in the existing TICK2 sandbox batch. Listener/job code-step tests use production simulation, but simulation does not validate every Jira-side semantic constraint (e.g. an empty transition ID). The workflow mock has not been rewritten as part of this review.
- F-002/F-006 parked on platform evidence: REST cannot update a request type (405), and observed REST-created/deleted request types delivered neither a captured sample nor a listener run. UI-origin request-type delivery remains unverified. These two skips are not a claim that all68 events passed live.
- F-009/F-011 remain in the named TICK3 matcher/log-shape batch; F-014/F-018 in TICK4 seed/tool-schema batch. No proven new wrong-issue write was found by the independent review of prior F-004 changes.
- Harness lifecycle batch: token acquisition must be paired with finally-based revocation; cleanup must fail honestly on403. This review reclaimed25 explicitly harness-owned tokens and revoked its own temporary tokens. COGTEST2696/2697 remain because the API principal cannot delete there; later fixtures use LZPT/JT and were removed. Harness-owned Assets field configuration was intentionally retained for repeatable testing.
- Existing cold-start DEP0040 warnings and verbose orphan logs that reach Forge's100-line cap prevent calling the global runtime log stream clean. They did not correspond to failed listener/job actions in the independently checked runs. Track in a dependency/logging batch rather than changing dependencies during this feature review.


## Final live checks and receipts

On 22.153.0, concurrent consumer pairs with the same identity produced exactly one comment. Distinct manual task IDs produced two new comments. Different task IDs for the same scheduled minute produced one comment. Every replay produced no additional comments. Five actual KVS claim records were read independently. The probe invokes production consumers directly and deliberately does not claim to simulate Forge queue redelivery.

Actual AI semantic gate: LZPT-275 matched and received exactly one comment; LZPT-276 did not match and received none. Both whole-rule simulated tests and actual issue-update events agreed. No simulated comment reached Jira. Both issues and the listener were removed, independently read back as absent.

Genuine browser race: the harness held an actual successful GraphQL test response for unsaved listener A while opening saved listener B. After release, it renamed and saved B. Independent reads confirmed B's original ID, code, disabled state and exactly one tagged registry row. B was removed afterward. This was a real resolver response, not a mocked result.

The existing forge-live-harness browser walkthrough also passed on 22.153.0: `HEADLESS=1 npx playwright test scenarios/cognirunner/admin-ui-deep.spec.ts --project=chromium` (1 test, 10 recorded steps, 19 seconds; run20260905-131131). It opened Rules, Execution Logs, Documentation, Skills, Memories, Permissions and Settings. Explain returned text naming the Summary field; the captured accessibility tree confirms a real explanation, although this smoke assertion does not establish its semantic accuracy against every configured rule. Listeners and Jobs are covered by the targeted scripts above, not by this older walkthrough. The broad `npm run target` discovery command initially failed on an unrelated lz-ppm spec importing another test; the focused CogniRunner command avoided that discovery failure without changing another project's tests.

Durable evidence (test records; no bearer tokens): [runtime checks](evidence/2026-09-05/runtime-after.json), [atomic claim checks](evidence/2026-09-05/claims-live.json), [genuine browser race](evidence/2026-09-05/editor-race-live.json), [semantic gate](evidence/2026-09-05/semantic-listener-live.json), [Plans change and restore](evidence/2026-09-05/plans-live.json), [JSM/Assets second reads](evidence/2026-09-05/jsm-assets-second-read.json). Screenshots in the same directory show the actual step failure/simulation, SKIPPED result, Plans changed/restored rows and saved B editor.

## Reproduce

Use the existing test-harness/.env for wolfaenpak and the forge-live-harness saved browser session. Browser scripts reuse static/_screenshot-harness's Playwright dependency. Run from test-harness:

```sh
npm run test:offline
npm run test:rules-offline
node scripts/listeners-jobs-review-live.mjs
node scripts/semantic-listener-live.mjs
node scripts/claims-live.mjs
node scripts/editor-race-live.mjs
```

The four targeted live scripts assert the wolfaenpak hostname and clean their fixtures. They invoke the existing secret-gated live harness and the real app; claims-live uses the dedicated fixture-restricted probe. UI-only regression: build static/admin-panel with webpack.screenshot.js, then run static/_screenshot-harness/listeners-jobs.test.mjs and editor-races.test.mjs. Normal scheduled queue/tick and JSM suites remain npm run test:jobs-e2e and npm run test:jsm-assets; observe the token/COGTEST cleanup limitations above.

## Commit and finding map

- 90c3e6e: listener filters and selected issue context (F-022).
- f0bb3db: truthful scoped cancellation (F-023).
- 83f295a: production listener/job step simulation (F-017 and listener/job portion of F-008), editor identity (F-021), SKIP/schedule/context/sample UI (F-024–027), rebuilt bundles.
- 34ddcb0: atomic rule claims and bounded live probe (F-020).
- d5624c1: canonical Assets harness and exact-value proof (F-028).

Historical development ledger after this review: **18 fixed, 6 scheduled, 4 parked, 0 open** across 28 retained findings. The remaining scheduled items have named batches above; they are not represented as fixes. The previous F-004 adversarial-review debt is discharged, with no new targeting regression confirmed.
