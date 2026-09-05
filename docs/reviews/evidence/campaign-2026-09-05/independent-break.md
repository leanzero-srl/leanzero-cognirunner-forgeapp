# Campaign BREAK — runtime and UI, 2026-09-05

Scope: runtime source equivalent to 43fdfc6 (merged as 311ab5a); UI source through b12a8ab and rebuilt main screenshot app. Statistics mutation changes are EXCLUDED pending a final immutable commit. No production source, test-site records, deployments or tracked state were changed by this reviewer.

## Confirmed finding — replay harness only

FILE: test-harness/scripts/listeners-jobs-campaign.mjs:139 and :160 · Fresh-job replay accepts old Jira property values as evidence of the new manual and scheduled writes.
SCENARIO: original J02/J03/J06 property remains `{key: current issue, manual: false, scheduledFor: "2026-09-05T17:50:00.000Z"}`; freshJobs changes only rule IDs; subsequent execution does not update the property → manual `.key` check and scheduled `manual:false`/truthy scheduledFor checks both pass. The old J01 scheduled comment can also satisfy the global `some(manual:false)` predicate.
VERDICT: CONFIRMED, high confidence. Fix blast radius: replay readback assertions in this campaign script only; assert manual true/null and scheduledFor equal the captured current scheduled log, and inspect only newly created J01 audit comments.
REFUTATION ATTEMPTED: checked freshJobs for cleanup/reset of prior properties; none exists. Checked manual checks for manual/scheduledFor assertions; absent. Checked scheduled readbacks for equality to the current log; absent. Ran six stale-value controls from the prior campaign's actual schedule timestamp; all satisfy current predicates. Other terminal/log/count checks remain meaningful, so this finding concerns independent write proof, not an assertion that runtime writes failed.
STATUS: open; delivered to coordinator for canonical ledger append under its sole-writer ownership.

## Six-lens bounded result

Untrusted content: UI uses React text/title escaping; 100 scoped outcomes with HTML/fence-like text and long Unicode reasons render all keys/statuses/reasons without markup execution. Raw attachment payload is unchanged; authoritative outer context remains preferred. Learning excerpt is bounded and its existing defang path remains in place. No newly introduced injection path established.

Failing path: eight independent actual-handler/sandbox controls pass. First failure remains selected even when a later step reaches the total deadline; arbitrary thrown objects, a hostile Proxy and Symbol message return structured errors and preserve later simulated writes. Duplicate-name offloaded execution selects actual failing code; missing offload executes nothing. Author suite also passes 30 cases.

Blast radius: runtime changes affect error reporting/learning identity and attachment display/context facts. Existing step continuation, simulation and timeout decisions remain unchanged. Both listener/job adapters were traced. New internal excerpt is absent from persisted and console execution logs. No queue claims, permissions or execution brakes are changed in this reviewed diff.

Caps: failing code excerpt remains at most 1500 characters before enqueue; author duplicate/offload cases assert this bound. Existing error/recommendation limits in learning enqueue remain unchanged. UI exercised 100 issue outcomes. No changed model output cap or import path.

One-rule: first failure comes from a single first-failure trace and index. Both FunctionBuilder copies are byte-identical. Attachment hints share one definition. Saved perIssue outcomes and manual issues outcomes share the same renderer.

Boundary: no new async work, eval/new Function in Custom UI, shared dependency, manifest, scope or resolver permission change. Main's initially stale mock bundle failed both regressions, providing a useful negative witness; after coordinator rebuilt main, both pass. Actual live UI proof after deployment remains the tester's pending gate.

## Evidence

runtime.mjs / runtime.json / runtime.log: eight independent controls.
author-suite.log: 30 passing production-handler regression cases.
ui-main-history-fixed.log: 26 passing light/dark history assertions.
ui-main-width-fixed.log: 54 passing 624px frame assertions.
ui-adversarial.mjs / ui-adversarial.log: 38 passing assertions over 100 outcomes and hostile display text.
stale-replay-control.mjs / .json: six stale values accepted by existing campaign predicates.

Verdict: no confirmed remaining production defect within the reviewed runtime/UI changes; one confirmed campaign evidence gap requires correction. This does not approve pending statistics code or claim deployed live verification.

## Re-BREAK of F046 — 0df5298

The coordinator fixed the replay gap. Executed assertions extracted directly from the corrected script: all six stale prior property values are rejected at both manual and scheduled checks (12 negative controls), and all six fresh manual and fresh scheduled values are accepted (12 positive controls). Old/manual comment IDs are excluded while the fresh scheduled ID survives (2 controls). Total 26 controls pass. Inspected both AI label preflight resets and absent-label REST assertions. F046 is source-corrected; final live replay is still required. No remaining confirmed finding in this bounded runtime/UI/harness diff.

## Statistics BREAK — dd1d465 (unmerged)

FILE: src/rule-stats.js:94 + src/index.js:1034 · Clearing a newly counted receipt during an ambiguous initial log write permits that same completion to count twice.
SCENARIO: storeLog's first set commits then reports TIMEOUT; before the retry, actual clearLogs queues clearAfterApply, and the stats consumer atomically increments once and deletes the receipt; the writer retries its FAIL_IF_EXISTS set against the now-missing key, recreates the unapplied receipt, and the next consumer increments again → one run produces runCount=2.
VERDICT: CONFIRMED. High confidence in failure; correction must retain deduplication evidence across the original writer retry, including repeated Clear Logs, within existing receipt/log lifecycle.
REFUTATION ATTEMPTED: FAIL_IF_EXISTS and applied-marker protection work only when the receipt survives. Actual storeLog/clearLogs/consumer fault-injection witness proves physical deletion defeats both. No fabricated stats mutation or direct map overwrite in witness.
STATUS: open, delivered to coordinator for canonical ledger allocation and correction.
EVIDENCE: stats-clear-ambiguous.mjs / .json / .log. After clear runCount=1, receipt=null; after retry runCount=2.

FILE: src/listeners.js:234 + src/scheduled-jobs.js:182 · A failed new cleanup-receipt write reports deletion failure after the rule has already been deleted.
SCENARIO: only storage.set of statsOnly cleanup receipt returns 429; actual deleteListener/deleteScheduledJob resolvers return success:false while the corresponding config is null and index is empty. The previous counter remains with no durable receipt to recover cleanup. Public REST awaits the same delete method and maps its throw to failure.
VERDICT: CONFIRMED, high confidence; blast radius is receipt persistence and result ordering in both deletion paths. Does not justify changing rule execution or general registry architecture.
REFUTATION ATTEMPTED: traced both actual UI resolvers, independently reread config/index/stats, and checked a repeated delete cannot recover the missing receipt because get returns no rule. Prior stats cleanup caught its own failure; this added receipt write introduced the false deletion outcome.
STATUS: open, delivered to coordinator for canonical ledger allocation and correction.
EVIDENCE: stats-delete-failure.mjs / .json / .log, covering both families.

Other stats observations were refuted or bounded: family-specific queue concurrency annotations exist on ordinary, recovery and clear pushes; atomic map/applied transaction uses the installed SDK fourth-argument TTL signature; only the consumer writes stats maps; applied/missing receipts do not independently recount; generation comparisons preserve unrelated/new rows; pending pruning is skipped; no historical reconstruction occurs. Final statistics verdict is BLOCKED by the two confirmed scenarios above; reassess the corrected immutable commit.

FILE: src/index.js:1272 · Clear Logs now sends one awaited queue request per run receipt and can exceed the synchronous resolver budget with 100 receipts.
SCENARIO: 100 pending listener run receipts, each otherwise-successful Queue.push response takes 300ms → actual clearLogs resolver remains unfinished at 25,001ms with 83 requests initiated; Forge's 25s resolver budget expires before completion. Ordinary log clearing previously used batchDelete for these entries.
VERDICT: CONFIRMED, high confidence. Exact correction scope is clear/recovery receipt enqueue batching (≤50 events per push) with unchanged per-family concurrency keys and receipt semantics.
REFUTATION ATTEMPTED: checked for batch push, asynchronous resolver routing, bounded per-invocation clear queue size, and an existing queue helper batching this path; none applies. Executed actual resolver with mocked only queue response latency; no errors, SDK retries or slow storage were required.
STATUS: open, delivered to coordinator for canonical ledger allocation and correction.
EVIDENCE: stats-clear-budget.mjs / .json / .log.

## Final statistics re-BREAK — 00f5c25

All three confirmed statistics defects are source-corrected and independently rechecked. The original ambiguous-write/clear witness now returns runCount=1 before and after retry, retaining only hidden id/kind/applied evidence. The same 100-receipt/300ms successful queue response scenario now finishes in 605ms with exactly two pushes. A transaction-targeted 429 witness on each delete resolver returns failure while preserving the rule, index membership and prior counter. The author's actual-engine/consumer suite independently reruns at 25 passed, 0 failed.

Reviewed the complete immutable chain 248f99c, dd1d465, dfdae84, 4eb260a, 00f5c25 under all six lenses. Receipt batching retains each family's concurrency key/limit, and delete transactions stage only index membership, config deletion and the cleanup receipt; map writes remain exclusively serialized. Repeated clearing retains dedup evidence. The helper is backend-only; no shared frontend dependency, new permission/scope, manifest, execution API, prompt contract or historical backfill was added.

Final bounded verdict: no remaining confirmed defect in the reviewed runtime, UI, campaign readback assertions and statistics changes. Proceed to development deployment and actual concurrent listener/job execution plus UI verification. This offline/source review does not itself establish Forge's live queue behavior, deployed UI freshness, or historical counter reconstruction (the latter is deliberately not performed).

Final evidence: stats-clear-ambiguous-fixed.json/log, stats-clear-budget-fixed.json/log, stats-delete-failure-fixed.mjs/json/log, stats-author-final.log. Negative witnesses remain in their original logs and *-before.json files. No repository source or tracked state was modified by this reviewer; coordinator owns canonical ledger integration for the four delivered findings.
