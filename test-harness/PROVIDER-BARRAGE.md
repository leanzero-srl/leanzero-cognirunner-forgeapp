# Provider Barrage — single-provider, full-coverage runbook

Run the **entire** advertised CogniRunner surface against **one AI provider at a time**, in
conjunction with the owner. There is **no programmatic provider switch** (the active provider
is admin-only, `COGNIRUNNER_AI_PROVIDER`, no REST path), so every provider runs as an
owner-in-the-loop handshake: **the owner switches the provider in admin → Settings and states
which one is now active; the agent never assumes.**

Target: project **COGTEST** on `wolfaenpak.atlassian.net` (`results/testbed.json` holds
`customFields`, `ruleTransitions`, `issues`, `hubStatusRef`). **Assessment axes:** `forge logs`
+ issue changelog + the `cogni-debug` issue property — **not** the UI. The Jira token lives in
the gitignored `test-harness/.env`.

**Baseline to beat (no regression):** ~**766–770 / 782**. Expected misses only: the agentic
GATE-STORY strictness and the injection-embedded-in-a-real-task nuance.

> **Denominator note (2026-08-12).** The old baseline listed a third expected miss, "F3 — conditions
> not enforced on the REST path". F3 was re-diagnosed: conditions ARE enforced, and the app's own
> conditions now work (see `reg-conditions-enforce.mjs`). The 2-case condition study is no longer an
> expected miss. Historic rows in FINDINGS.md were scored against the OLD denominator of 782 WITH
> that miss allowed — do not compare a new row to them without saying which denominator it used. Current matrix: OpenRouter/`gemma-4-31b` 766, Anthropic/
`claude-haiku-4-5` 766, Forge LLM/Haiku 766, **OpenAI 770 (strongest)**, LM Studio 69/76.

---

## Two ways to run

### A) Agent-driven (full barrage, recommended)
The owner switches the provider, then pastes the **kickoff prompt** below into a session that has
the harness + project memory. The agent runs steps 0–5 and records the matrix row. This keeps the
agent in the loop for the per-provider risk watch (Step 4) and the scoring/recording (Step 5).

### B) Wrapper script (steps 0–2 in one command)
After switching the provider in admin, from `test-harness/`:

```bash
node scripts/barrage.mjs
```

It waits for the provider cache, then chains: reset-to-hub → provider smoke → the ~782-case suite
→ live MCP e2e → Research & Document, streaming each step and printing a consolidated summary
(suite score by study + MCP verdicts). It does **not** switch providers, run the risk watch, record
the FINDINGS row, or commit — those stay agent/owner-driven (the row must be tagged with the
owner-stated provider + model).

Env knobs: `BARRAGE_WAIT=35` (cache wait), `BARRAGE_SKIP_MCP=1` (skip 2a/2b if MCPs aren't
configured), `BARRAGE_SMOKE=1` (one case/rule — fast health check, not a scoring run),
`RUN_CONCURRENCY=3` (passed through).

---

## Kickoff prompt (paste into the session; fill the two brackets)

```
PROVIDER BARRAGE — single provider, full coverage. Run in conjunction with me (the owner):
I switch the active provider in the admin panel; you run the suite and score it. There is NO
programmatic provider switch — never assume which provider is active; I tell you, each time.

ACTIVE PROVIDER (I just set this in admin → Settings):
  Provider: [e.g. OpenAI]
  Model:    [e.g. gpt-5.4-mini]

Target: project COGTEST on wolfaenpak.atlassian.net (testbed.json holds customFields,
ruleTransitions, issues, hubStatusRef). Assess via forge logs + issue changelog + the
cogni-debug issue property — NOT the UI. The Jira token is in the gitignored test-harness/.env.

=== STEP 0 — handshake & pre-flight ===
- Wait ~35s before the first AI call (the provider config is 30s TTL-cached; a switch needs
  to clear). Confirm forge logs access and note the deployed app version.
- node scripts/reset-to-hub.mjs   (lifecycle waves march the corpus off-hub and silently
  invalidate the self-loop suite — the tell is a BLOCKED with no "AI Validation failed:" reason).
- node scripts/_smoke-provider.mjs   -> confirm the provider is LIVE and producing REAL verdicts
  (control-good -> ALLOWED, gibberish -> BLOCKED with a coherent reason). If it 404/401/403s, STOP
  — the provider is misconfigured (fails CLOSED, F19); tell me what to fix before continuing.

=== STEP 1 — the comprehensive suite (~782 cases, 11 studies) ===
node scripts/run-transitions.mjs   (RUN_CONCURRENCY=3 default; writes results/run-results.json)
This exercises EVERY advertised capability for the active provider:
  • validators  — naive / hardened / quality / rich-quality / PII / number-threshold / label-policy
  • conditions  — deterministic, enforced on every surface incl. REST (F3 re-diagnosed; NOT an expected miss)
  • agentic validators (JQL tool-calling) — dup-check + release-gate (highest provider risk: tool-call
    shape differs per provider; F1 was exactly this on Forge LLM)
  • semantic PFs — text / select / number / date / mismatch / off-screen / simulation
  • static PFs   — tag / sync-loop / escape / jql-cap / async-hang / update-field
  • actions (the ~30-method sandbox API) — number / date / select / labels / user / read-compute /
    conditional / multi-step / jql-write / transition / comment / worklog / watcher / link / etc.
  • PF flavors   — comment / subtask / link (+ gendoc/research/research-doc covered in Step 2)
  • knowledge    — builtin-doc injection (docsUsed flag)
  • policy/PII   — block PII, allow clean
  • injection (~710) + robustness (decoration / homoglyph / RTL / zero-width)
Report per-study scores. BASELINE to beat (no regression): ~766–770/782. Expected misses only:
the agentic GATE-STORY strictness and the injection-embedded-in-a-real-task nuance. (Conditions are
no longer an expected miss — F3 was re-diagnosed; they enforce on the REST path.)
Any NEW failure class -> investigate; if it implicates validator framing, STOP + flag (danger zone),
do not auto-fix.

=== STEP 2 — live MCP + document flavors (all 3 MCPs are on :443) ===
- node scripts/mcp-live-e2e.mjs       -> gendoc (a real file MUST attach), research, knowledge.
  Confirm "[mcp-bridge] exposed 14 hosted MCP tool(s)" and 0 tools/list failures in forge logs.
- node scripts/research-doc-test.mjs  -> the "Research & Document" flavor: web-search + context7
  -> authored brief -> ATTACHED .md. Verify the attachment lands.

=== STEP 3 — auto-capture (only if I've turned autoCapture ON in admin → Memories) ===
node scripts/async-flood.mjs   -> distinct non-transient failures distill; transient (503) skips
(F13); repeat errorSig reinforces (no new distill). Assess by decoding memdistill_<ms> task ids
in forge logs.

=== STEP 4 — provider-specific risk watch (assert these for THIS provider) ===
  • OpenAI/Azure -> /chat/completions + json_schema response_format; gpt-5/o-series path; parseAIJson.
  • Anthropic    -> /v1/messages + tool_use blocks, no response_format (JSON via system prompt).
  • Forge LLM    -> tool arguments sent as a STRING (F1), text-only.
  • LM Studio    -> native /api/v1/chat, slow -> async-queued, file-block stripping, local-MCP flag.
  • OpenRouter   -> attribution headers.
JSON-mode parsing and the agentic tool rounds are the likeliest break points — assert both.

=== STEP 5 — record & reset ===
- node scripts/reset-to-hub.mjs (and CLEAN=1 on any script that seeded temp issues).
- Add this provider's row to test-harness/FINDINGS.md (Total + per-study + agentic + AI-errors),
  tagged with the provider/model I stated, cross-checked against forge logs. Commit + push as
  leanzero.srl (branch feature/byok-postfunctions); never credit Claude; commit source + any rebuilt
  bundles together.

GUARDRAILS: never assume the active provider — I state it. Pause between providers; don't batch the
matrix unattended. Flag confidence, not effort. ASK before manifest/scope/AI-prompt changes.
When done, tell me to switch to the next provider and we repeat.
```

---

## Scripts this runbook drives

| Script | Step | What it proves |
|--------|------|----------------|
| `reset-to-hub.mjs` | 0, 5 | corpus back on the hub status (self-loops only exist there) |
| `_smoke-provider.mjs` | 0 | provider is live + producing real verdicts (good→ALLOW, gibberish→BLOCK) |
| `run-transitions.mjs` | 1 | the ~782-case, 11-study suite — every rule type / action / field / knowledge / policy / injection |
| `mcp-live-e2e.mjs` | 2 | live doc-reader/docWriter + research + knowledge on :443 (real attachment) |
| `research-doc-test.mjs` | 2 | the Research & Document flavor (web + context7 → authored brief → attach) |
| `async-flood.mjs` | 3 | runtime memory auto-capture (distinct→distill, transient→skip, repeat→reinforce) — needs `autoCapture` ON |
| `field-matrix.mjs` | extra | the 19-custom-field-type write/changelog/read matrix |
| `barrage.mjs` | 0–2 | wrapper that chains the above and summarizes |

Provider switching is admin-only and not REST-driveable — each provider is an owner handshake.
