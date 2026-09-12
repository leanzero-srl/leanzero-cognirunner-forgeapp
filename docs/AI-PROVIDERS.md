# CogniRunner AI Provider Integration Guide

> How CogniRunner connects to OpenAI, Azure OpenAI, OpenRouter, Anthropic, and AWS Bedrock. Covers authentication, request/response translation, per-provider key storage, and the unified adapter layer. (LM Studio and Atlassian Forge LLM are additional providers configured the same way.)

---

## Provider Comparison

| | OpenAI | Azure OpenAI | OpenRouter | Anthropic |
|---|---|---|---|---|
| **Base URL** | `api.openai.com/v1` | `{resource}.openai.azure.com/openai/v1` | `openrouter.ai/api/v1` | `api.anthropic.com` |
| **Chat endpoint** | `/chat/completions` | `/chat/completions` | `/chat/completions` | `/v1/messages` |
| **Models endpoint** | `/models` | `/models` | `/models` | `/v1/models` |
| **Auth header** | `Authorization: Bearer` | `api-key: KEY` | `Authorization: Bearer` | `x-api-key: KEY` |
| **Extra headers** | — | — | `HTTP-Referer` + `X-OpenRouter-Title` | `anthropic-version: 2023-06-01` |
| **System prompt** | `{role: "system"}` in messages | Same as OpenAI | Same as OpenAI | Top-level `system` field |
| **max_tokens** | Optional | Optional | Optional | **Required** |
| **Request body** | OpenAI standard | Identical to OpenAI | Identical to OpenAI | Different (Messages API) |
| **Response body** | `choices[0].message.content` | Same | Same | `content[].text` |
| **Tool calling** | `tools` + `tool_calls` | Same | Same | `tools` + `tool_use` content blocks |
| **Image format** | `{type: "image_url"}` | Same | Same | `{type: "image", source: {type: "base64"}}` |
| **Default model** | `gpt-5.4-mini` | `gpt-5.4-mini` | `openai/gpt-4o-mini` | `claude-haiku-4-5-20251001` |

---

## Architecture: The Unified Adapter

All AI calls in CogniRunner go through `callAIChat()`. Callers always use OpenAI message format. The adapter handles translation internally.

```
Caller (any resolver/handler)
  │
  └─ callAIChat({ apiKey, model, messages, tools, tool_choice })
      │
      ├─ getProviderConfig() → { provider, baseUrl }
      │
      ├─ provider === "anthropic"?
      │   └─ callAnthropicChat() → translates request/response
      │
      ├─ provider === "bedrock"?
      │   └─ callBedrockChat() → translates to/from the Converse API
      │
      └─ else (OpenAI, Azure, OpenRouter)
          └─ Direct POST to {baseUrl}/chat/completions
              with provider-specific headers
```

### Why a Unified Adapter?

1. **47 resolvers** call AI — changing each one for a new provider would be error-prone
2. **Agentic loop** has multi-turn tool calling — format differences multiply across rounds
3. **Response normalization** — callers always parse `data.choices[0].message.content`, regardless of provider

---

## Provider-Specific Details

### OpenAI

**Auth:** `Authorization: Bearer sk-...`

**No special handling needed.** This is the native format — all other providers are translated to/from this format.

**Model listing filter:** `gpt-5|o3-|o4-` prefix (latest models only)

### Azure OpenAI (v1 API)

> **Mostly untested.** Azure rides the same OpenAI-compatible code path as OpenAI (only the auth header and base URL differ), so OpenAI hardening covers it — but there is no live Azure deployment in the test harness, so treat its end-to-end behavior as unverified.

**Auth:** `api-key: KEY` (NOT `Authorization: Bearer` — that's for Entra ID tokens only)

**Base URL:** User must provide. Format: `https://{resource-name}.openai.azure.com/openai/v1`

**Key difference:** The `model` field in the request body is the **deployment name**, not the model name. Users set this up in Azure AI Studio.

**No api-version parameter** needed for v1 API (GA since August 2025).

**Model listing:** No filter — shows all available deployments.

### OpenRouter

**Auth:** `Authorization: Bearer sk-or-...`

**Required attribution headers:**
```
HTTP-Referer: https://leanzero.net
X-OpenRouter-Title: CogniRunner
```

Without these, requests may be rejected or throttled.

**Model listing:** No filter — the full OpenRouter catalogue (300+ models from many vendors: minimax, mistral, qwen, deepseek, …) is exposed; the picker has client-side search.

**Model ID format:** `provider/model-name` (e.g., `openai/gpt-4o`, `anthropic/claude-3.5-sonnet`)

### Anthropic

**Auth:** `x-api-key: sk-ant-...` + `anthropic-version: 2023-06-01`

**Endpoint:** `POST {baseUrl}/v1/messages` (NOT `/chat/completions`)

**Required field:** `max_tokens: 4096` (request fails without it)

**Translation layer handles:**

| OpenAI Format | Anthropic Format |
|---|---|
| `{role: "system", content: "..."}` in messages | Top-level `system: "..."` field |
| `{type: "image_url", image_url: {url: "data:...;base64,..."}}` | `{type: "image", source: {type: "base64", media_type: "...", data: "..."}}` |
| `{type: "file", file: {file_data: "data:...;base64,..."}}` | `{type: "document", source: {type: "base64", media_type: "...", data: "..."}}` |
| `tools: [{type: "function", function: {name, parameters}}]` | `tools: [{name, input_schema}]` |
| `tool_choice: "auto"` | `tool_choice: {type: "auto"}` |
| `{role: "tool", tool_call_id: "...", content: "..."}` | `{role: "user", content: [{type: "tool_result", tool_use_id: "..."}]}` |
| Response: `choices[0].message.content` | Response: `content[].text` (concatenated) |
| Response: `tool_calls[].function.arguments` (string) | Response: `content[].tool_use.input` (object) |
| `finish_reason: "stop"` | `stop_reason: "end_turn"` |
| `finish_reason: "tool_calls"` | `stop_reason: "tool_use"` |
| `usage.total_tokens` | Computed: `input_tokens + output_tokens` |

### AWS Bedrock

**Auth:** `Authorization: Bearer <bedrock-api-key>` — the Bedrock API key is a plain bearer token; **no AWS SigV4 signing** is performed (or needed) in the Forge sandbox.

**Endpoint:** `POST {baseUrl}/model/{modelId}/converse` — the unified **Converse API**, which works across all Bedrock models (Claude, Nova, Llama, …). `baseUrl` is `https://bedrock-runtime.<region>.amazonaws.com`, built from the admin-selected region and stored in the per-provider base-URL slot (no separate region key). The model id is URL-encoded into the path.

**Region & inference profiles:** Endpoints are region-specific. Many models cannot be invoked by their bare model id and require a **cross-region inference-profile id** — `eu.anthropic.…` in EU regions (e.g. eu-west-2), `us.anthropic.…` in US regions. The model picker lists profile ids; admins can also free-text any id.

**Anthropic use-case form:** Anthropic-on-Bedrock invocations `403` for first-time customers until a one-per-account *"use case details"* form is submitted in the AWS console (Bedrock → Model catalog). The admin panel surfaces this with an acknowledgment checkbox (`COGNIRUNNER_BEDROCK_ACK`) that gates the model picker — a UX gate only; it does not change auth.

**Required field:** `inferenceConfig.maxTokens: 4096`. **JSON mode:** no native `response_format` — enforced via the system prompt (same as Anthropic).

**Translation layer (`callBedrockChat`) handles:**

| OpenAI Format | Bedrock Converse Format |
|---|---|
| `{role: "system", content: "..."}` in messages | Top-level `system: [{text: "..."}]` array |
| `{role: "user", content: "..."}` | `content: [{text: "..."}]` (always an array of typed blocks) |
| `{type: "image_url", image_url: {url: "data:image/...;base64,..."}}` | `{image: {format, source: {bytes: "<base64>"}}}` |
| `{type: "file", file: {file_data: "data:...;base64,..."}}` | `{document: {format, name, source: {bytes: "<base64>"}}}` |
| `tools: [{type: "function", function: {name, parameters}}]` | `toolConfig.tools: [{toolSpec: {name, description, inputSchema: {json}}}]` |
| `tool_choice: "required"` | `toolConfig.toolChoice: {any: {}}` (auto/none omitted — not all models accept it) |
| `{role: "tool", tool_call_id, content}` | `{role: "user", content: [{toolResult: {toolUseId, content, status}}]}` |
| Response: `choices[0].message.content` | Response: `output.message.content[].text` (concatenated) |
| Response: `tool_calls[].function.arguments` (string) | Response: `output.message.content[].toolUse.input` (object) |
| `finish_reason: "tool_calls"` | `stopReason: "tool_use"` |
| `usage.total_tokens` | `usage.totalTokens` (or `inputTokens + outputTokens`) |

**Egress:** `*.amazonaws.com` — Forge egress wildcards are leftmost-only (no mid-segment `*`) and a single `*` matches nested subdomains, so one entry covers both `bedrock-runtime.<region>` (inference) and `bedrock.<region>` (control-plane model listing) across every region.

---

## Editions and the Forge LLM model policy (1.3)

CogniRunner ships as two Marketplace editions. The platform tells the app which one is installed through the license object it hands every invocation, and the decision is made in exactly one module: `src/shared/edition.js`.

| Edition | Marketplace edition type | Internal id | Forge LLM models |
|---|---|---|---|
| **Standard** | standard | `standard` | `claude-haiku-4-5-20251001` |
| **CogniRunner Coder** | Advanced (`capabilitySet: capabilityAdvanced`) | `advanced` | Haiku **plus** `claude-sonnet-5`, `claude-opus-5` |

**Only the Atlassian (Forge LLM) provider is edition-gated.** On every BYOK provider (OpenAI, Azure, OpenRouter, Anthropic, Bedrock, LM Studio) the tenant pays for its own tokens and CogniRunner locks nothing — any model the provider lists can be selected on either edition. Forge LLM tokens are billed to the vendor (LeanZero), which is why the frontier models are what the Coder edition pays for.

### How the edition is resolved

`resolveEdition(license)` reads the platform license object. Where that object comes from is the only thing that differs per runtime, and every read funnels into the same function:

| Runtime | Source |
|---|---|
| `validate()` / `executePostFunction()` | `args.context.license` |
| Resolvers (`checkLicense`, `getOpenAIModels`, `saveOpenAIModel`, `getAgentModel`, `saveAgentModel`, …) | `context.license` |
| Webtriggers and the async consumer | `getAppContext().license` |

Rules, in order:

1. No license object at all (development / unlisted install) → **Standard**, `active: null`.
2. A license that is explicitly inactive (`isActive`/`active === false`) → **Standard**, whatever `capabilitySet` says. An expired Coder subscription is not Coder.
3. An active license with `capabilitySet` → `capabilityAdvanced` (compared case-insensitively; a live install sends the camel-cased form) means **Coder**; anything else means Standard. `capabilitySet` is authoritative when present.
4. An active license with no `capabilitySet` → `state: "advanced"` is accepted as a secondary signal only (legacy installs).
5. Anything unrecognised, and any exception during the read → **Standard**. The module is fail-soft by design: a broken license read degrades the tenant to the free capability set and never blocks a workflow transition.

**Lapsed subscriptions.** The edition is read live on every invocation that carries a license, so a lapsed Coder subscription falls back to Standard on the next read. The only place a snapshot is used is a runtime whose context carries **no `license` property at all** (the consumer / a webtrigger): those read `COGNIRUNNER_EDITION_SNAPSHOT`, which the invocation paths write (throttled to once per 6 h per container, fire-and-forget) with a **2-day TTL**, and accept it only when it recorded an *active advanced* license. If a live context does carry the key — even as `license: null` — that read wins over the snapshot. Two days is therefore the longest a lapsed Coder subscription can keep authorising vendor-billed frontier models on a runtime that cannot see the license itself.

### Where the policy is enforced

The Forge LLM lists are exact model ids, not name patterns — an older Sonnet/Opus id (e.g. `claude-sonnet-4-6`) is refused on every edition. The same `clampForgeLlmModel(edition, id)` runs at every seam, so a stale saved model can never bill a larger model:

| Seam | Behaviour |
|---|---|
| `getOpenAIModels` (Forge LLM) | Returns `models` (selectable on this edition) plus `locked` (Coder-only ids). Never refuses — a Standard admin browsing models is not an error; the panel renders the locked ids as rows with a **Coder** badge. |
| `saveOpenAIModel` (Forge LLM) | A frontier id on Standard returns `{ success:false, upgradeRequired:true, featureId:"forge-llm-frontier-models", edition:"standard", error }`; any other unlisted id is "not offered on Atlassian (Forge LLM)". |
| `getOpenAIModelFromKVS` (Forge LLM) | Serves the *effective* model: a saved model the edition no longer entitles (a downgrade, or one saved before the policy) is clamped to Haiku and reported with `clamped: true` + `savedModel`, so the panel says "Saved model X is not available on this edition — using Claude Haiku." |
| `callForgeLlmChat` (`src/index.js`) | The billing backstop for synchronous calls: clamps to the edition **and** to the monthly allowance (below). Fail-soft — an error resolving either leaves the model at Haiku; the call still goes out. |
| `callAIChatSimple` (`src/async-handler.js`) | The same edition clamp for queued work (codegen, fix, review, listeners, jobs). The consumer reads the edition through the same trust rule (live context first, snapshot only when the context carries no license). |
| `checkProviderHealth` | Reports the *effective* model and a `clamped` flag computed from the edition policy, never from what the provider echoed back. |

Editions are exposed to the frontends by `checkLicense`, which returns `{ isActive, edition, label, capabilitySet, source, features[] }` — `features` is `ADVANCED_FEATURES` with an `allowed` flag per feature, so the admin panel never keeps a second copy of the list. `isActive` is unchanged from earlier releases: `null` when there is no license property, `false` only when a license exists and is inactive.

### The agent model slot

1.3 adds a second model slot per provider, `COGNIRUNNER_AGENT_MODEL_{provider}`, read by `getAgentModel` and written by `saveAgentModel` (admin only). It is the model the upcoming agent surfaces — Coder chat, PR review, the Virtual Administrator (1.4 / 1.5) — will run on, kept apart from the rule/validator model so a tenant can run a hundred validators on Haiku and one agent turn on a frontier model.

- On Forge LLM the agent slot is **frontier-only**: `saveAgentModel` accepts only `claude-sonnet-5` / `claude-opus-5`. On Standard the refusal is the `upgradeRequired` shape; on Coder a non-frontier id is refused with "Agents on Atlassian (Forge LLM) run on Claude Sonnet 5 or Opus 5 only." Haiku never drives an agent at any edition. `getAgentModel` returns `frontierOnly: true` for this provider so the panel offers only those two ids.
- On BYOK providers any model id the customer names is accepted.
- When nothing is saved, `getAgentModel` falls back to the active provider's rule model (or the provider default).
- `agentCapability({ provider, edition, agentModel, allowanceLevel })` in `edition.js` is the single predicate every agent surface will gate on: BYOK → enabled (`byok`); Forge LLM on Standard → `needs-coder-edition`; Forge LLM with a non-frontier agent model → `needs-frontier-model`; Forge LLM with the monthly allowance at its hard cap → `allowance-exhausted`; otherwise `forge-frontier`.
- Model ids from either save resolver pass through one normaliser (`normalizeModelId`: trim, strip control characters, cap at 120 chars, server-side).

### Monthly Forge LLM allowance (Coder)

Because Forge LLM frontier tokens land on the vendor's bill, a Coder tenant gets a monthly allowance that scales with the seats it pays for. The maths lives in `src/shared/usage-meter.js`:

```
allowance = clamp(seats × $2.00, $40, $800) per month
```

- **Seats.** There is no seat API, so `maybeRefreshSeatSnapshot` counts active users with `accountType: "atlassian"` via `GET /rest/api/3/users/search` (pages of 200, at most 10 pages / 2,000 users — past that the allowance is at its ceiling anyway) and stores `COGNIRUNNER_SEAT_SNAPSHOT`. The scan is triggered only from the admin panel resolvers (`checkLicense` and `getAiUsage`, i.e. when an admin opens the panel), is throttled to once per 24 h, and never runs from an inference path. Every outcome writes a row — a count, a zero, or `seats: null` plus the error. When the seat count is unknown the allowance is computed for **100 seats** ($200), never for "unlimited".
- **Spend.** The usage meter records every Forge LLM call by tier (haiku / sonnet / opus) with prompt and completion tokens and an estimated USD cost from `FORGE_LLM_USD_PER_M` — `haiku $1 in / $5 out`, `sonnet $3 / $15`, `opus $5 / $25` per million tokens. **These rates are assumed, not published**: Atlassian has not published Forge LLM pass-through rates and the Claude 5-series list prices were not public at ship time. They drive the meter and the panel's "estimated spend" line only; nobody is billed from them. BYOK spend is deliberately not costed. The meter itself is a best-effort under-count (re-read-and-add on one KVS key, no CAS).
- **Levels.** `forgeLlmAllowanceStatus` returns `{ estUsd, allowanceUsd, pct, level }` with `level` **ok** below 80 %, **soft** at ≥ 80 %, **hard** at ≥ 100 %. An unknown or non-positive allowance is treated as `ok` — an unknown allowance must never pause the product.
- **Soft (80 %).** The admin panel's allowance meter turns to the warning state and says "Most of this month's Forge LLM allowance is used." Nothing changes at runtime.
- **Hard (100 %).** `callForgeLlmChat` drops **every** Forge LLM call to Haiku for the rest of the month — saved rules keep running, on `claude-haiku-4-5-20251001` — and counts each forced downgrade in `forgeLlm.clampedCalls` so the panel can show why. The panel reads "Allowance spent — Sonnet 5 / Opus 5 paused until next month. Rules fall back to Claude Haiku." Agent surfaces report `allowance-exhausted`. The allowance clamp is applied in `src/index.js`; the async consumer's clamp is edition-only.
- **Reset.** The meter is keyed by UTC month; a read across the boundary shows the new month at zero without a write, so the allowance resets with the calendar month.
- The edition and allowance ride the existing 30 s provider-config memo, so no extra KVS read lands inside a transition's deadline race.

`getAiUsage` (admin only) returns `{ usage, seats, forgeLlm }` where `forgeLlm` is the allowance status above; the admin panel polls it for the meter.

### Forge LLM rate limit and the token budget queue

Forge LLM caps **50,000 tokens per minute per installation, per model** (`AI_PLATFORM_TPM` in `src/shared/ai-budget.js`; verified 2026-09-12 — Sonnet 5, Opus 5 and Haiku are counted independently). CogniRunner paces background AI work (queued post-functions, listeners, jobs, codegen, fix, review, distillation) against a per-provider tokens-per-minute budget — default **35,000** for Forge LLM, none for BYOK unless set — so a burst never runs the installation into HTTP 429 and never makes a user-facing validator fail. The budget is deliberately one installation-wide bucket rather than one per model: the conservative reading can only slow the app down, never overrun the platform. The admin sets it under **Settings → AI token budget (tokens per minute)**. The design is written up in [`PROMPT-token-budget-queue.md`](PROMPT-token-budget-queue.md).

---

## Per-Provider Key Storage

### Storage Scheme

Each provider has its own KVS slot. Switching providers never deletes another provider's key.

```
COGNIRUNNER_AI_PROVIDER     → "anthropic"              (active provider)
COGNIRUNNER_AI_BASE_URL     → "https://api.anthropic.com"  (active base URL)
COGNIRUNNER_KEY_openai      → "sk-..."                 (OpenAI key — preserved)
COGNIRUNNER_KEY_anthropic   → "sk-ant-..."             (Anthropic key — active)
COGNIRUNNER_KEY_azure       → "abc123..."              (Azure key — preserved)
COGNIRUNNER_MODEL_openai    → "gpt-5.4-mini"           (OpenAI model — preserved)
COGNIRUNNER_MODEL_anthropic → "claude-haiku-4-5-20251001"  (Anthropic model — active)
COGNIRUNNER_AGENT_MODEL_atlassian → "claude-sonnet-5"   (agent model slot, 1.3 — frontier-only on Forge LLM)
COGNIRUNNER_EDITION_SNAPSHOT → { edition, capabilitySet, active, at }  (2-day TTL; read only where the runtime has no license)
COGNIRUNNER_SEAT_SNAPSHOT   → { seats, at }              (24h; drives the Coder Forge LLM allowance)
COGNIRUNNER_KEY_bedrock     → "bedrock-api-key"        (Bedrock bearer token — preserved)
COGNIRUNNER_BASEURL_bedrock → "https://bedrock-runtime.eu-west-2.amazonaws.com"  (region carrier)
COGNIRUNNER_BEDROCK_ACK     → true                     (Anthropic use-case acknowledgment)
```

### Key Retrieval with Migration

```javascript
const getOpenAIKey = async () => {
  const { provider } = await getProviderConfig();
  
  // 1. Try per-provider slot
  let key = await storage.get(`COGNIRUNNER_KEY_${provider}`);
  
  // 2. Legacy migration (one-time)
  if (!key) {
    const legacyKey = await storage.get("COGNIRUNNER_OPENAI_API_KEY");
    if (legacyKey) {
      await storage.set(`COGNIRUNNER_KEY_${provider}`, legacyKey);
      key = legacyKey;
    }
  }
  
  // BYOK only — no factory / out-of-the-box key fallback. Returns null when the
  // active BYOK provider has no key (callers bail). Forge LLM uses a sentinel.
  return key || null;
};
```

### In-Memory Caching

```javascript
let _cachedKey = null;
let _cachedKeyChecked = false;

// First call: reads from KVS (slow)
// Subsequent calls: returns cached value (instant)
// Cache invalidated when: saving new key, removing key, switching provider
```

---

## Model Listing

Each provider has a different model listing approach:

| Provider | Endpoint | Filter | Notes |
|---|---|---|---|
| OpenAI | `GET /v1/models` | `gpt-5\|o3-\|o4-` | Latest models only |
| Azure | `GET /openai/v1/models` | No filter | Shows all deployments |
| OpenRouter | `GET /api/v1/models` | None | Full catalogue (300+ models) |
| Anthropic | `GET /v1/models` | `claude-` prefix | All Claude models |
| Bedrock | `GET /foundation-models` + `/inference-profiles` (control plane `bedrock.<region>`) | none | Merges on-demand model ids + invokable inference-profile ids; fails soft → free-text fallback |

**Max models returned:** 50 for OpenAI/Azure/Anthropic; 1000 for OpenRouter (its catalogue is large and the picker has client-side search).

---

## Adding a New Provider

To add a new OpenAI-compatible provider:

1. Add to `PROVIDERS` constant in `src/index.js`:
   ```javascript
   newprovider: { label: "New Provider", baseUrl: "https://api.newprovider.com/v1", defaultModel: "model-name" }
   ```

2. Add domain to `manifest.yml`:
   ```yaml
   external:
     fetch:
       client:
         - address: https://api.newprovider.com
       backend:
         - address: https://api.newprovider.com
   ```

3. Add any provider-specific headers in `callAIChat()`:
   ```javascript
   if (provider === "newprovider") {
     headers["X-Custom-Header"] = "value";
   }
   ```

4. Add model listing filter if needed:
   ```javascript
   } else if (provider === "newprovider") {
     chatModels = chatModels.filter(id => /^wanted-prefix/.test(id));
   }
   ```

5. Update admin panel `PROVIDER_OPTIONS` and `PROVIDER_HELP` in `OpenAIConfig.jsx`

6. Add provider validation in `saveProvider` resolver (if needed)

For **non-OpenAI-compatible providers** (like Anthropic or AWS Bedrock), you'd need to add a translation layer similar to `callAnthropicChat()` / `callBedrockChat()`. Such providers must ALSO be mirrored in `src/async-handler.js` (the `PROVIDERS` map, `PROVIDER_DEFAULT_MODELS`, and a branch in `callAIChatSimple`) — the async queue consumer reads provider config uncached and has its own simplified chat path, so a provider added only in `index.js` will fail on queued/background tasks.
