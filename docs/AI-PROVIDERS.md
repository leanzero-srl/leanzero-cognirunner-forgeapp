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
HTTP-Referer: https://leanzero.atlascrafted.com
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
