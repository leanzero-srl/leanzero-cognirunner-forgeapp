# CogniRunner — Atlassian Marketplace Listing Copy

Paste-ready copy for the live listing. All copy reflects the `feature/byok-postfunctions`
release: multi-provider BYOK, post-functions, agentic validation. **Do not** add pricing
rationale or any "we undercut the market" framing anywhere public.

---

## App name (≤60)
CogniRunner

## App tagline (≤130 chars · no ending punctuation)
> AI validators and post-functions for Jira, plus zero-cost deterministic conditions — your own AI key or the zero-key Forge LLM

*(126 chars — the previous tagline was actually 136 and OVER the limit despite claiming 119; always verify with len(). Alternates:*
- *"AI validators and post-functions for Jira — read meaning, validate, automate, with your own AI key" — 98*
- *"Bring AI to your Jira workflows — validators and post-functions that read meaning and act" — 89)*

## App summary (≤250 chars)
> Add AI validators and post-functions to Jira workflows, plus zero-cost conditions. CogniRunner reads the meaning of fields, attachments and issues, then validates, decides and acts. Bring your own AI key — or use the zero-key Atlassian Forge LLM.

*(231 chars. Alternate, ~245: "Add AI validators, conditions and post-functions to Jira. CogniRunner reads fields, attachments and related issues to validate, catch duplicates, and act on transitions. Bring your own AI key (OpenAI, Anthropic, Azure, Bedrock) or the zero-key Forge LLM.")*

---

## More details (More about this app)

*(996 chars — under the 1000 limit; verify with len() after edits)*

**CogniRunner brings real AI understanding to Jira workflows — and keeps the deterministic parts free.** Native validators only check structure; CogniRunner reads the meaning of fields, attachments and issues, then validates, decides and acts, in plain English.

- Validators: block a transition with the AI's reasoning shown; agentic JQL catches duplicates; reads attachments too.
- Conditions: deterministic, zero AI cost, enforced everywhere — ten checks incl. custom-field has-value / empty / equals.
- ~27 premade no-AI rules: required fields, regex, lengths, dates — instant.
- Post-functions: semantic (read a field, write another) and static (AI-written code, zero AI at runtime); comments, sub-tasks, documents.
- Bring your own AI: Anthropic, OpenAI, Azure OpenAI, OpenRouter, Bedrock — or local LM Studio, or the zero-key Atlassian Forge LLM.
- Manage it all: registry meter, owners, delete that detaches, import/export, REST provisioning.

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
- Description (198): Bring your own key for Anthropic, OpenAI, Azure, OpenRouter or Bedrock — or run models locally with LM Studio, or use the zero-key Atlassian Forge LLM. Switching providers never loses your settings.
- Caption (200): The Settings screen with Anthropic connected and a model chosen. CogniRunner ships with no embedded key — connect any provider, point it at a local LM Studio, or pick the zero-key Atlassian Forge LLM.

**Highlight 3 — image "Automate after the transition" (post-function builder)**
- Title (29): Automate after the transition
- Description (214): After a transition, AI post-functions act: a semantic rule reads a field and writes another; a static rule runs AI-generated JavaScript at zero AI cost. Chain up to 50 steps — add comments, sub-tasks, or documents.
- Caption (171): The Function Builder: describe a step in plain English and CogniRunner generates the JavaScript — with a sandboxed Jira API, test runs, and variables chained across steps.

---

## What's new / Release notes (1.1.x)

**Release summary (≤80 chars):**
> Real deterministic conditions, rule delete + registry tools, REST provisioning

*(78 chars. Alternate: "Conditions that really gate, rule management, REST rule provisioning" — 68)*

**Release notes body:** *(995 chars — under the 1000 limit; verify with len() after edits)*

Workflow conditions, rebuilt honestly — plus real rule management.

- Conditions now genuinely gate transitions. They are deterministic — zero AI, zero per-transition cost — evaluated by Jira itself and enforced everywhere: the issue view, REST, automation and bulk changes.
- Ten checks: issue type, resolved, resolution, priority, parent status, current user is assignee/reporter, and three custom-field checks — has a value, is empty, equals (case-insensitive) — each verified live per field kind. Opening an old condition shows what it saved and lets you convert it.
- Delete that means it: per-row and bulk delete detach the rule from the workflow, with a preview that predicts what will happen first.
- Provision rules over Jira's own REST API: the Rules tab shows this installation's ARIs, payload shapes and caps, with a full worked guide.
- A byte-accurate registry meter, honest ownership (an unowned rule is nobody's), import cap checks, and Register-all that reports what it skipped.

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
| Additional screenshots | `marketplace-screenshots/01..05-*.png` (01 refreshed 2026-08-13: meter, Owner column, Delete, REST panel) | 1840 wide |
| Demo video | upload `cognirunner-demo-90s.mp4` to YouTube, paste link | YouTube link |

**Accuracy guardrails for final edits:** say *multi-provider / BYOK*, never "Powered by OpenAI". Never state an API key env var is required (it's BYOK in Settings, or the zero-key Forge LLM). Azure is listed but lightly tested — don't over-promise it. Do not carry any pricing rationale into public copy. **Conditions are deterministic — never call them AI-powered**, and never claim condition runs appear in execution logs (Jira evaluates them itself). Field conditions are custom-fields-only; equals covers text/URL/date/number/select/radio — don't promise system fields or multi-value equals. License is Apache-2.0; GitHub org is leanzero-srl.
