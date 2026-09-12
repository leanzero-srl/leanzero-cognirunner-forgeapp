# Prompt: add a tokens-per-minute budget queue to a Forge chat app

Copy everything below the line into the chat app's Claude Code session. It describes the design
CogniRunner shipped on 2026-09-12 (commits 91a6163 and 85e7618) so the same engine can be built
there without re-deriving it.

---

I want background AI work in this app paced by a tokens-per-minute budget so a burst never runs the
provider into HTTP 429 and never makes a user-facing call fail. Not retries. A queue of jobs with a
budget, drained slower when the budget is tight. The app keeps doing its purpose, just slower.

Reference implementation to mirror: CogniRunner, files `src/shared/ai-budget.js` (pure maths),
`src/index.js` (ledger + gate helpers + admin resolvers, search for "AI TOKEN BUDGET"),
`src/async-handler.js` (the consumer gate, search for "TOKEN-BUDGET GATE"). Read them first.

Facts you must respect:

1. Forge LLM allows 50,000 tokens per minute per installation and returns
   `429 Forge LLM token usage limit exceeded ... has reached its limit of 50000 tokens for model ...`
   with no Retry-After. The window is per minute, so waiting for the next minute boundary is the
   correct recovery. BYOK providers have their own limits; the budget is per provider.
2. Forge async events: `queue.push({ body, delayInSeconds, concurrency: { key, limit } })`.
   delayInSeconds max is 900. Platform retries via InvocationError are capped at four, so do NOT use
   FUNCTION_RETRY_REQUEST for pacing. Re-push a fresh event instead and carry your own counters in
   the event params.
3. KVS read-modify-write is not atomic. Two consumers can both pass the gate. Keep the default
   budget well under the platform limit and cap concurrency on the re-pushed events.

Build these pieces:

A. `src/shared/ai-budget.js`, dependency-free, unit-tested offline:
   - `AI_PLATFORM_TPM = { atlassian: 50000 }`, `AI_BUDGET_DEFAULT_TPM = { atlassian: 35000 }`
     (0 for BYOK unless the admin sets one), `INLINE_QUEUE_THRESHOLD = 0.6`,
     `BUDGET_WAIT_HORIZON_MS = 60 min`, `MAX_BUDGET_DEFERRALS = 60`.
   - `minuteKey(ms)`, `effectiveBudget(provider, settings)`, `estimateTokensFromText` (chars/4),
     `estimateTaskTokens(taskType, params, learnedCost)` generous on output,
     `budgetDecision({ used, reserved, estimate, budget, nowMs, deferrals })` returning
     `{ allow, delaySeconds }` where delaySeconds lands just past the next minute boundary plus a
     jitter that widens with each deferral (so a backlog does not stampede the boundary), an
     oversized task runs on an empty minute, and the deferral cap forces a run.
   - `inlineShouldQueue({ used, reserved, budget })` for the synchronous valve.

B. The ledger in the backend:
   - KVS key per provider and minute: `ai_budget:<provider>:<minute>` holding `{ used, reserved }`,
     TTL 5 minutes. Feed `used` from the SAME place every AI call already reports usage to the
     meter, so synchronous user calls count too and background work backs off while users are busy.
   - `reserved` is bumped with the estimate when a task passes the gate and released after it runs.
     Release into the SAME minute bucket the reservation was taken from (remember the timestamp),
     or a task that crosses a boundary leaks its reservation.
   - Per-rule learned cost: after a run, store the tokens metered during that invocation under
     `ai_cost:<ruleId>` (7 day TTL) and use it as the next estimate. Track "tokens in this
     invocation" with a module-level counter reset before each task.
   - Settings key `COGNIRUNNER_AI_BUDGET`-style: `{ tokensPerMinute: { [provider]: n } }`,
     30 second cached read. Admin resolvers `getAiBudget` (effective budget, current minute used
     and reserved, platform limit, default) and `saveAiBudget` (blank = default, 0 = off, clamped
     to the platform limit).

C. The gate at the top of the queue consumer, after the cancel and staleness checks and before the
   job row flips to running:
   - Decide whether the task uses AI at all. Tasks that run no model are never gated.
   - Estimate, then `budgetDecision`. If not allowed: re-push the same event body with
     `params.enqueuedAt = now`, `params.firstEnqueuedAt` preserved from the first enqueue,
     `params.budgetDeferrals + 1`, `delayInSeconds` from the decision, and
     `concurrency: { key: "ai-budget", limit: 2 }`. Update the job row to status queued with a
     `budgetWait: { until, deferrals, firstEnqueuedAt, used, budget, estimate, provider }` and
     return without running. Log one line: deferred, seconds, minute at used/budget, needs estimate.
   - If allowed: reserve, reset the invocation counter, run, release, learn the cost.
   - Any failure inside the gate runs the task. The gate must never block the queue.
   - Staleness: a budget-deferred event is judged on the 60 minute horizon from firstEnqueuedAt,
     not on the normal dropped-event window, because slow is the point.

D. The synchronous valve: where a light AI job runs inline today, check the ledger first. If the
   current minute is past 60 percent of the budget, push it to the queue instead so the gate paces
   it. Below the threshold the fast path is unchanged.

E. Any sweeper or reaper that re-drives or expires queued rows must skip rows with `budgetWait`
   inside the horizon, because their delayed event is alive and a re-push would double-deliver.

F. UI: a Settings card "AI token budget (tokens per minute)" with the live minute meter
   (used plus reserved over budget), placeholder showing the default, blank = default, 0 = off,
   and the platform limit in the help text. Jobs view: a solid-colour TOKEN BUDGET status with
   "next slot in Ns (wait N)". No left accent rails, no faded tints, no native dialogs.

Verify before you call it done: offline test on the maths; a live run with the budget set very low
(for example 4,000) where you read the consumer logs and see "deferred ... minute at X/4000", every
deferred task eventually completing, zero expired and zero forced; then restore the default and
confirm the fast path is unchanged. Report the exact counts.
