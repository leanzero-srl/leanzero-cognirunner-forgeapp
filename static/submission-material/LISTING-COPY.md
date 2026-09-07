# CogniRunner — Atlassian Marketplace Listing Copy

Paste-ready copy for the live listing, refreshed for **release 1.2.0** (Listeners, Scheduled Jobs,
AI agent mode, Rules REST API). **Do not** add pricing rationale or any "we undercut the market"
framing anywhere public. Provider order is always Anthropic first; conditions are never AI.

Every limited block sits between `<!-- block:name -->` / `<!-- /block -->` markers so its length can
be verified mechanically (code points, `len()`): `python3 static/submission-material/count-blocks.py`.

---

## App name (≤60)
CogniRunner

## App tagline (≤130 chars · no ending punctuation)
<!-- block:tagline -->
AI validators, listeners and scheduled jobs for Jira — your own AI key, local LM Studio or the zero-key Forge LLM
<!-- /block -->

*(113 chars. Alternates: "The AI workflow agent for Jira — validate on transition, react to 68 events, run on a schedule" — 92;
"AI validators, event listeners and cron jobs for Jira, with your own AI key or the zero-key Forge LLM" — 100)*

## App summary (≤250 chars)
<!-- block:summary -->
The AI workflow agent for Jira. Validators read meaning, listeners react to 68 Jira events, jobs run on cron, post-functions act after a transition — with your own AI key (Anthropic, OpenAI and more), local LM Studio, or the zero-key Forge LLM.
<!-- /block -->

*(244 chars)*

---

## More details (More about this app) (≤1000)

<!-- block:more -->
**CogniRunner is the AI workflow agent for Jira — three ways to run, one app.** Native rules check structure; CogniRunner reads the meaning of fields, attachments and issues, then validates, decides and acts.

- On a transition: AI validators block with the reasoning shown; agentic JQL catches duplicates; post-functions write fields, comments, sub-tasks and documents — or run AI-written code at zero AI cost.
- On an event: listeners react to 68 Jira, Software and JSM events, filtered by project, JQL or changed fields, gated by an AI condition, with loop brakes built in.
- On a schedule: cron jobs in any time zone, once or per issue of a JQL scope, with a per-issue run report.
- Conditions: deterministic, zero AI cost, enforced everywhere.
- Bring your own AI: Anthropic, OpenAI, Azure OpenAI, OpenRouter, Bedrock — or local LM Studio, or the zero-key Atlassian Forge LLM.
- Provision listeners and jobs over a REST API.

Open source on Atlassian Forge (Apache-2.0).
<!-- /block -->

---

## Highlights (exactly 3 — title ≤50 no ending punctuation · description ≤220 · caption ≤220)
Each block matches its image. Image: `marketplace-highlight-{n}.png` (1840×900) + `-cropped.png` (580×330).
Order changed 2026-09-07: the 1.2.0 listeners/jobs slide leads; the old "Automate after the transition"
slide is retired (its render config is kept as a comment in `render-hl-v2.mjs`).

**Highlight 1 — image "React to 68 Jira events — or run on a schedule" (Listeners tab, AI GATE row, PASS + SKIPPED executions)**
- Title:
<!-- block:h1_title -->
React to 68 Jira events, or run on a schedule
<!-- /block -->
- Description:
<!-- block:h1_desc -->
Listeners react to any of 68 Jira, Software and JSM events; scheduled jobs run on cron, once or per issue of a JQL scope. A plain-English AI condition gates each run; the work is code the AI wrote or an AI agent.
<!-- /block -->
- Caption:
<!-- block:h1_cap -->
The Listeners tab: an AI-gated listener on Issue created. One run passed the AI condition and edited plus commented TPP-1187; the next was skipped because the story was already complete — every run logged.
<!-- /block -->

**Highlight 2 — image "Catch what regex can't" (agentic validation log)**
- Title:
<!-- block:h2_title -->
Validate meaning, not just structure
<!-- /block -->
- Description:
<!-- block:h2_desc -->
CogniRunner reads the meaning of your fields, attachments and issues, then blocks a transition when content fails your plain-English rule — and searches your project with JQL to catch duplicates.
<!-- /block -->
- Caption:
<!-- block:h2_cap -->
An execution log showing CogniRunner block a transition: it matched the issue to PROJ-118, confirmed with three rounds of JQL, and stopped the duplicate — with the AI's reasoning and full trace.
<!-- /block -->

**Highlight 3 — image "Your AI. Your key." (multi-provider settings)**
- Title:
<!-- block:h3_title -->
Your AI, your key — local or cloud
<!-- /block -->
- Description:
<!-- block:h3_desc -->
Bring your own key for Anthropic, OpenAI, Azure, OpenRouter or Bedrock — or run models locally with LM Studio, or use the zero-key Atlassian Forge LLM. Switching providers never loses your settings.
<!-- /block -->
- Caption:
<!-- block:h3_cap -->
The Settings screen with Anthropic connected and a model chosen. CogniRunner ships with no embedded key — connect any provider, point it at a local LM Studio, or pick the zero-key Atlassian Forge LLM.
<!-- /block -->

---

## What's new / Release notes (1.2.0)

**Release summary (≤80 chars):**
<!-- block:rel_summary -->
Listeners for 68 Jira events, cron scheduled jobs, AI agent mode, Rules REST API
<!-- /block -->

*(80 chars — at the limit. Alternate: "Listeners, scheduled jobs, AI agent mode and a Rules REST API" — 61)*

**Release notes body (≤1000):**
<!-- block:rel_notes -->
Listeners, Scheduled Jobs and a Rules REST API — two new ways to run, no transition needed.

- Listeners react to any of 68 Jira, Jira Software and JSM events, filtered by project, issue type, JQL, changed fields or a comment regex. An optional plain-English AI condition gates the run and fails closed. What runs is code steps (the same sandbox as static post-functions) or an AI agent with an allow-list of actions. Self-generated events are ignored by default, brakes stop loops, a redelivered event never runs twice, and you can test with a real issue in simulation.
- Scheduled jobs run on five-field cron in any IANA time zone — once, or per issue of a JQL scope — with a per-issue outcome in the history view.
- Rules REST API: mint a bearer token in Settings → API access and push listeners and jobs as JSON — single, batches of 100, partial updates, enable, test, run, logs.
- Also: serialized run counters, honest reporting of thrown non-Errors, atomic attachment capabilities.
<!-- /block -->

Previous release notes (1.1.x) live in `docs/RELEASE-NOTES.md`.

---

## Asset manifest (upload these)

| Slot | File | Dimensions |
|---|---|---|
| App logo | `marketplace-logo-144.png` | 144×144 |
| Banner (hi-res) | `marketplace-banner-1120x548.png` (v3 2026-09-07: navy + wedge, "Validate / React / Schedule", tilted listeners window) | 1120×548 |
| Banner (standard) | `marketplace-banner-560x274.png` | 560×274 |
| Highlight 1 | `marketplace-highlight-1.png` (+ `-cropped`) — listeners & scheduled jobs | 1840×900 (+ 580×330) |
| Highlight 2 | `marketplace-highlight-2.png` (+ `-cropped`) — agentic validation | 1840×900 (+ 580×330) |
| Highlight 3 | `marketplace-highlight-3.png` (+ `-cropped`) — bring your own AI | 1840×900 (+ 580×330) |
| Additional screenshots | `marketplace-screenshots/01-rules-dashboard.png`, `02-listeners.png`, `03-scheduled-jobs-run-report.png`, `04-agentic-validation-log.png`, `05-api-access.png` | 1840 wide |
| Demo video | YouTube link (the 5:19 `yt-compilation` when uploaded; `cognirunner-demo-90s.mp4` remains the older master) | YouTube link |

Website companions (same visual language, produced 2026-09-07): `LeanZero-website/public/assets/cognirunner/cr-og-1200x630.png`
(Open Graph) and `cr-hero-strip-1920x640.png` (in-page hero strip: listener row, run report, validator toast).

**Accuracy guardrails for final edits:** say *multi-provider / BYOK*, never "Powered by OpenAI"; Anthropic is
always named first. Never state an API key env var is required (it's BYOK in Settings, or the zero-key Forge LLM).
Azure is listed but lightly tested — don't over-promise it. Do not carry any pricing rationale into public copy.
**Conditions are deterministic — never call them AI-powered**, and never claim condition runs appear in execution
logs (Jira evaluates them itself). The "68 events" figure is the shared catalogue in `src/shared/jira-events.js`.
The Rules REST API provisions listeners and jobs; workflow rules still attach through Jira's own workflow API
(`docs/REST-API-RULES.md`). License is Apache-2.0; GitHub org is leanzero-srl.
