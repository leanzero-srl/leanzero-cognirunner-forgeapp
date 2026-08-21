# AI COST CEILING — read this before touching anything AI in this app

**Status: open decision. Raised 2026-08-21. Not yet actioned.**

## The fact that drives everything below

Atlassian bills Forge LLM tokens to the **app vendor** — LeanZero — not to the
customer's org. This is documented, not inferred:

  https://developer.atlassian.com/platform/forge/runtime-reference/forge-llms-api-pricing/
  $0.10 per 1M input credits, $0.50 per 1M output credits, and **no free monthly
  quota** — every token is billed.

Do not confuse this with Rovo. Rovo AI usage IS billed to the customer org, so a
Rovo agent costs the vendor nothing. The Forge LLMs API is the opposite. That
distinction is almost certainly where the original mistake came from.

Any path in this app where the customer does NOT supply their own API key is a
path where **LeanZero pays for the customer's usage.**

## Why this is an OPPORTUNITY, not just a liability

Mihai's framing, 2026-08-21, and it is the right one:

> "In reality this is good because it opens up the conversation for tiered app
> selling like standard, advanced and whatever else where the only thing you get
> more is the AI ceiling being raised."

A vendor-billed token is a *metered cost per customer*. That is the cleanest
possible basis for tiering, because the thing being sold scales with the thing
being spent:

  Free / trial   — small monthly AI ceiling, enough to evaluate
  Standard       — a working ceiling for a normal team
  Advanced       — a much larger ceiling
  Enterprise     — highest ceiling, or bring-your-own-key and no ceiling at all

Bring-your-own-key becomes the honest top tier rather than a downgrade: the
customer takes the cost and gets no limit. Every tier boundary is then a real
number the app already has to track, not a marketing invention.

**None of this works until the ceiling is actually enforceable.** A tier is a
promise about a limit. Ship the enforcement first, then price it.

## What must be true before tiering can be sold

1. A ceiling that cannot be bypassed — checked immediately before the spend, not
   only when work is queued.
2. A GLOBAL ceiling per installation, not only a per-space one. A per-space limit
   multiplies by the number of spaces and is not a ceiling at all.
3. A non-zero default. Shipping `0 = unlimited` means enabling AI enables
   unlimited vendor-billed spend.
4. Usage visible in the admin UI, and ideally reportable to LeanZero. A cap
   nobody can see consumption against cannot be trusted or sold.
5. A defined behaviour at the ceiling — degrade to a warning, or hard-stop, per
   tier. Decide it deliberately.

## The three apps, and where each one stands

| App | Vendor-billed path | Ceiling today |
|---|---|---|
| Sentinel Vault | Forge LLM (semantic content validation) | Budget exists but LEAKS — see below |
| CogniRunner | Forge LLM "zero-key" provider option | **NONE.** BYO-key is the primary path, so exposure is limited to customers who pick Atlassian |
| LeanZero Management | Forge LLM in 3 features (JQL builder, plan reviewer, plan assessor) | **NONE** — and the app is currently free |

## In THIS repo (CogniRunner)

Evidence, all verified against source on 2026-08-21:

- `src/index.js:21` — "No API key and no egress — billing goes to the app vendor."
- `src/index.js:7962-7963`, `:7980`, `:8004`, `:3412` — four more comments saying
  the same. **CogniRunner's code has the billing model RIGHT.** The wrong
  sentence lives in Sentinel Vault's pricing ledger, not here.
- `isForgeLlmModelAllowed` clamps the Atlassian provider to Haiku
  (`src/index.js:3696`, `:3720`).

The gap:

- **There is no token budget in this app at all.** A search for
  `tokenBudget` / `monthlyBudget` / `token budget` across `src/` returns nothing.
  On the `atlassian` provider there is nothing between a customer and LeanZero's
  Forge bill except the Haiku clamp.

What limits the exposure: CogniRunner is primarily bring-your-own-key. Anthropic,
OpenAI, Azure OpenAI, OpenRouter, AWS Bedrock and local LM Studio are all
customer-paid. The Atlassian Forge LLM is the "zero-key" convenience option, so
only customers who choose that provider cost LeanZero anything.

That also makes CogniRunner the natural place to prove the tiering model: the
BYO-key path already exists as the uncapped top tier, so only the metered
zero-key path needs a ceiling built.

## Next actions, in order

1. **Decide the tier structure** — Mihai's call. What ceiling at each tier, and
   what happens when a customer hits it.
2. **Build the enforcement** — the five requirements above. This is code and can
   proceed in parallel with (1); the numbers become config.
3. **Correct Sentinel Vault's pricing ledger** so the false premise stops being
   cited by future work.
4. **Instrument usage** so real per-customer consumption informs where the tier
   boundaries actually go, rather than a guess.

## Provenance

Found 2026-08-21 while researching a Sentinel Vault article, by reading the app
source rather than the README. The billing direction was then confirmed against
Atlassian's own pricing documentation before anything was concluded. Nothing in
any of the three apps has been changed as a result — this file is a breadcrumb,
not a fix.
