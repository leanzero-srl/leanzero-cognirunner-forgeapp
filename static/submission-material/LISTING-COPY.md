# CogniRunner — Atlassian Marketplace Listing Copy

Paste-ready copy for the live listing. All copy reflects the `feature/byok-postfunctions`
release: multi-provider BYOK, post-functions, agentic validation. **Do not** add pricing
rationale or any "we undercut the market" framing anywhere public.

---

## App name (≤60)
CogniRunner

## App tagline (≤130 chars · no ending punctuation)
> AI workflow automation for Jira — AI validators and post-functions plus zero-cost conditions, with your own AI key or zero-key Forge LLM

*(119 chars. Alternates:*
- *"AI validators and post-functions for Jira — read meaning, validate, automate, with your own AI key" — 101*
- *"Bring AI to your Jira workflows — validators and post-functions that read meaning and act" — 89)*

## App summary (≤250 chars)
> Add AI validators and post-functions to Jira workflows, plus zero-cost conditions. CogniRunner reads the meaning of fields, attachments and issues, then validates, decides and acts. Bring your own AI key — or use the zero-key Atlassian Forge LLM.

*(231 chars. Alternate, ~245: "Add AI validators, conditions and post-functions to Jira. CogniRunner reads fields, attachments and related issues to validate, catch duplicates, and act on transitions. Bring your own AI key (OpenAI, Anthropic, Azure, Bedrock) or the zero-key Forge LLM.")*

---

## More details (More about this app)

*(≈940 chars — under the 1000 limit)*

**CogniRunner brings real AI understanding to Jira workflows.** Native validators only check structure; CogniRunner reads the meaning of fields, attachments and issues — then validates, decides and acts, all in plain English.

- Validators: block a transition, with the AI's reasoning shown. Conditions: hide a transition on a deterministic check — no AI, no per-transition cost.
- Post-functions: semantic (read a field, write another) and static (AI-written code that runs at zero AI cost); plus comments, sub-tasks and generate-and-attach DOCX/PDF/PPTX.
- Reads attachments (images, PDF, Office) and runs agentic JQL to catch duplicates.
- Bring your own AI: Anthropic, OpenAI, Azure, OpenRouter, Bedrock — or local LM Studio, or the zero-key Atlassian Forge LLM.
- MCP tools: context7 (live docs), web-search, doc-processor; CogniRunner brokers every call.
- Skills, Memories and a Documentation library ground every generation.
- Admin hub: roles & scopes, execution logs, Add Rule wizard.

Open source on Atlassian Forge (Apache-2.0).

---

## Highlights (exactly 3 — title ≤50 no ending punctuation · description ≤220 · caption ≤220)
Each block matches its image. Image: `marketplace-highlight-{n}.png` (1840×900) + `-cropped.png` (580×330).

**Highlight 1 — image "Catch what regex can't" (agentic validation log)**
- Title (36): Validate meaning, not just structure
- Description (195): CogniRunner reads the meaning of your fields, attachments and issues, then blocks a transition when content fails your plain-English rule — and searches your project with JQL to catch duplicates.
- Caption (194): An execution log showing CogniRunner block a transition: it matched the issue to PROJ-118, confirmed with three rounds of JQL, and stopped the duplicate — with the AI's reasoning and full trace.

**Highlight 2 — image "Your AI. Your key." (multi-provider settings)**
- Title (33): Your AI, your key — local or cloud
- Description (198): Bring your own key for OpenAI, Anthropic, Azure, OpenRouter or Bedrock — or run models locally with LM Studio, or use the zero-key Atlassian Forge LLM. Switching providers never loses your settings.
- Caption (200): The Settings screen with Anthropic connected and a model chosen. CogniRunner ships with no embedded key — connect any provider, point it at a local LM Studio, or pick the zero-key Atlassian Forge LLM.

**Highlight 3 — image "Automate after the transition" (post-function builder)**
- Title (29): Automate after the transition
- Description (214): After a transition, AI post-functions act: a semantic rule reads a field and writes another; a static rule runs AI-generated JavaScript at zero AI cost. Chain up to 50 steps — add comments, sub-tasks, or documents.
- Caption (171): The Function Builder: describe a step in plain English and CogniRunner generates the JavaScript — with a sandboxed Jira API, test runs, and variables chained across steps.

---

## What's new / Release notes

**Release summary (≤80 chars):**
> Post-functions, agentic validation, BYOK + local & Forge LLM, MCP tools

*(70 chars. Alternate: "AI post-functions, MCP tools, BYOK incl. local LM Studio & Forge LLM" — 67)*

**Release notes body:** *(≈830 chars — under the 1000 limit)*

A major update — from AI validation to a full AI automation platform.

- AI post-functions: semantic (read a field, decide, write another) and static (AI-written code that runs at zero AI cost). Plus comments, sub-tasks, and generate-and-attach DOCX/PDF/PPTX.
- Bring your own AI: Anthropic, OpenAI, Azure, OpenRouter, Bedrock — or local LM Studio, or the zero-key Atlassian Forge LLM. No embedded key.
- MCP tools: context7 (live docs), web-search, doc-processor — CogniRunner brokers every call.
- Agentic validation: autonomous JQL across the issue's project, plus attachment reading (images, PDF, Office).
- Skills, Memories and a Documentation library ground every generation.
- Admin hub: roles & scopes, execution logs with traces, Add Rule wizard.
- Hardened: sandboxed code, prompt-injection fencing, durable async jobs. Refreshed UI with dark mode.

---

## Asset manifest (upload these)

| Slot | File | Dimensions |
|---|---|---|
| App logo | `marketplace-logo-144.png` | 144×144 |
| Banner (hi-res) | `marketplace-banner-1120x548.png` | 1120×548 |
| Banner (standard) | `marketplace-banner-560x274.png` | 560×274 |
| Highlight 1 | `marketplace-highlight-1.png` (+ `-cropped`) | 1840×900 (+ 580×330) |
| Highlight 2 | `marketplace-highlight-2.png` (+ `-cropped`) | 1840×900 (+ 580×330) |
| Highlight 3 | `marketplace-highlight-3.png` (+ `-cropped`) | 1840×900 (+ 580×330) |
| Additional screenshots | `marketplace-screenshots/01..05-*.png` | 1840 wide |
| Demo video | upload `cognirunner-demo-90s.mp4` to YouTube, paste link | YouTube link |

**Accuracy guardrails for final edits:** say *multi-provider / BYOK*, never "Powered by OpenAI". Never state an API key env var is required (it's BYOK in Settings, or the zero-key Forge LLM). Azure is listed but lightly tested — don't over-promise it. Do not carry any pricing rationale into public copy.
