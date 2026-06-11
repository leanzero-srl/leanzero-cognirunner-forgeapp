/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * Async event consumer for long-running AI tasks.
 * This handler runs with a 120s timeout (vs 25s for resolvers).
 *
 * Pattern:
 * 1. Resolver pushes task to queue with {taskType, taskId, params}
 * 2. This consumer executes the task
 * 3. Result is stored in KVS keyed by taskId
 * 4. Frontend polls the resolver for the result
 */

// `storage` was deprecated from @forge/api — migrated to @forge/kvs.
// Aliased back to `storage` so the existing call sites stay unchanged.
import storage from "@forge/kvs";
import api, { route, fetch } from "@forge/api";
// Atlassian-hosted Forge LLMs (Preview) — used when the active provider is "atlassian".
import { chat as forgeLlmChatApi } from "@forge/llm";
// Heavy post-functions (MCP-backed: generate-doc, research, fact-checked semantics)
// are queued by executePostFunction and run HERE under this consumer's 120s timeout —
// the inline jira:workflowPostFunction invocation is hard-capped at 25s by the platform.
import { dispatchPostFunction } from "./index";

const TASK_PREFIX = "async_task:";
const TASK_TTL_HOURS = 1; // Results expire after 1 hour

// Per-provider KVS key helpers (same scheme as index.js)
const providerKeySlot = (provider) => `COGNIRUNNER_KEY_${provider}`;
const providerModelSlot = (provider) => `COGNIRUNNER_MODEL_${provider}`;

// NO module-level key cache here. This consumer runs in a different warm container
// than the resolver that handles saveProvider, so a cached key can't be invalidated
// on provider switch — a stale key paired with a freshly-read provider sends the
// wrong credential (guaranteed wrong for the Forge LLM sentinel). One KVS read per
// queued task is cheap; correctness wins.
const getOpenAIKey = async () => {
  try {
    const { provider } = await getProviderConfig();
    // Forge LLM needs no API key — sentinel keeps `if (!apiKey)` call sites working.
    if (provider === "atlassian") return "atlassian-forge-llm";
    let byokKey = await storage.get(providerKeySlot(provider));
    // Legacy migration fallback
    if (!byokKey) {
      const legacy = await storage.get("COGNIRUNNER_OPENAI_API_KEY");
      if (legacy) { byokKey = legacy; }
    }
    if (byokKey) return byokKey;
  } catch (e) { /* fall through */ }
  return process.env.OPENAI_API_KEY;
};

const PROVIDER_DEFAULT_MODELS = {
  openrouter: "openai/gpt-5.4-mini",
  anthropic: "claude-haiku-4-5-20251001",
  atlassian: "claude-haiku-4-5-20251001",
  lmstudio: "gpt-5.4-mini", // placeholder — LM Studio admins always save a model
};

const getOpenAIModel = async () => {
  try {
    const { provider } = await getProviderConfig();
    // Read the saved model unconditionally — keyless providers (LM Studio, Forge LLM)
    // have no BYOK key, and gating on one made their saved model invisible here.
    const savedModel = await storage.get(providerModelSlot(provider));
    if (savedModel) return savedModel;
    // OPENAI_MODEL env var only makes sense for OpenAI-style factory deployments.
    if (process.env.OPENAI_MODEL && (provider === "openai" || provider === "azure")) {
      return process.env.OPENAI_MODEL;
    }
    if (PROVIDER_DEFAULT_MODELS[provider]) return PROVIDER_DEFAULT_MODELS[provider];
  } catch (e) { /* fall through */ }
  return process.env.OPENAI_MODEL || "gpt-5.4-mini";
};

const PROVIDERS = {
  openai: { baseUrl: "https://api.openai.com/v1" },
  azure: { baseUrl: null },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1" },
  anthropic: { baseUrl: "https://api.anthropic.com" },
  lmstudio: { baseUrl: null }, // user-supplied tunnel root (no /v1)
  atlassian: { baseUrl: null }, // Forge LLM — served by @forge/llm, no HTTP base URL
};

const getProviderConfig = async () => {
  try {
    const provider = (await storage.get("COGNIRUNNER_AI_PROVIDER")) || "openai";
    const customUrl = await storage.get("COGNIRUNNER_AI_BASE_URL");
    const baseUrl = customUrl || (PROVIDERS[provider] && PROVIDERS[provider].baseUrl) || PROVIDERS.openai.baseUrl;
    return { provider, baseUrl };
  } catch (e) {
    return { provider: "openai", baseUrl: PROVIDERS.openai.baseUrl };
  }
};

/**
 * Simple AI chat call with Anthropic support (no tools/attachments needed here).
 *
 * @param {object} opts
 * @param {boolean} [opts.jsonMode] — for OpenAI/Azure/LM Studio, sends
 *   `response_format: { type: "json_object" }` to constrain output. Silently
 *   skipped for providers that don't support it (Anthropic uses its system
 *   prompt; OpenRouter passes through and not all upstream models accept it).
 */
// Send a one-shot request to LM Studio's NATIVE /api/v1/chat endpoint.
// Mirror of callLmStudioNative in src/index.js but specialized for the simple
// system+user shape callAIChatSimple uses (no multimodal, no tools possible).
// Always preferred for LM Studio since callAIChatSimple never sends tools.
const callLmStudioNativeSimple = async ({ apiKey, model, systemPrompt, userMessage, jsonMode, baseUrl }) => {
  let prompt = systemPrompt || "";
  if (jsonMode) {
    prompt = (prompt ? prompt + "\n\n" : "")
      + "Respond with ONLY a valid JSON object. No markdown fences, no surrounding prose, no explanation outside the JSON.";
  }

  const body = {
    model,
    input: userMessage,
    store: false,
    reasoning: "off",
  };
  if (prompt) body.system_prompt = prompt;

  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const url = `${baseUrl}/api/v1/chat`;
  let response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  // Retry without `reasoning` if the model rejects it (per LM Studio docs).
  if (response.status === 400) {
    const errText = await response.text().catch(() => "");
    if (/reasoning/i.test(errText)) {
      delete body.reasoning;
      response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    } else {
      return { ok: false, status: 400, error: errText };
    }
  }
  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    return { ok: false, status: response.status, error: errBody };
  }

  const native = await response.json();
  const blocks = Array.isArray(native.output) ? native.output : [];
  const messageBlocks = blocks.filter((b) => b?.type === "message" && typeof b.content === "string");
  const reasoningBlocks = blocks.filter((b) => b?.type === "reasoning" && typeof b.content === "string");
  let content = messageBlocks.map((b) => b.content).join("");
  if (!content && reasoningBlocks.length > 0) {
    content = reasoningBlocks.map((b) => b.content).join("");
  }
  const stats = native.stats || {};
  const tokens = (stats.input_tokens || 0) + (stats.total_output_tokens || stats.output_tokens || 0);
  return { ok: true, content, tokens };
};

const callAIChatSimple = async ({ apiKey, model, systemPrompt, userMessage, jsonMode }) => {
  const { provider, baseUrl } = await getProviderConfig();

  // Atlassian-hosted Forge LLM — chat() is OpenAI-chat-completions-shaped.
  // No response_format: JSON mode is enforced via the system message.
  if (provider === "atlassian") {
    try {
      let sys = systemPrompt || "";
      if (jsonMode) {
        sys += (sys ? "\n\n" : "")
          + "Respond with ONLY a valid JSON object. No markdown fences, no surrounding prose.";
      }
      const messages = [];
      if (sys) messages.push({ role: "system", content: sys });
      messages.push({ role: "user", content: userMessage });
      const response = await forgeLlmChatApi({ model, messages, max_completion_tokens: 4096 });
      const message = response?.choices?.[0]?.message || {};
      let content = message.content;
      if (Array.isArray(content)) {
        content = content.filter((p) => p?.type === "text").map((p) => p.text || "").join("");
      }
      const tokens = response?.usage?.total_tokens
        || ((response?.usage?.input_tokens || 0) + (response?.usage?.output_tokens || 0));
      return { ok: true, content, tokens };
    } catch (err) {
      // ForgeLlmAPIError carries top-level .status/.message (no .context property)
      const detail = err?.message || String(err);
      return { ok: false, status: err?.status || 500, error: String(detail).substring(0, 300) };
    }
  }

  if (provider === "anthropic") {
    const response = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      }),
    });
    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      return { ok: false, status: response.status, error: errBody };
    }
    const data = await response.json();
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    const tokens = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0);
    return { ok: true, content: text, tokens };
  }

  // LM Studio: route to native /api/v1/chat (this resolver never sends tools, so the
  // native endpoint is always available — gives us real reasoning control).
  if (provider === "lmstudio") {
    return callLmStudioNativeSimple({ apiKey, model, systemPrompt, userMessage, jsonMode, baseUrl });
  }

  // OpenAI-compatible (OpenAI, Azure, OpenRouter)
  const openaiHeaders = { "Content-Type": "application/json" };
  if (provider === "azure") {
    openaiHeaders["api-key"] = apiKey;
  } else {
    openaiHeaders["Authorization"] = `Bearer ${apiKey}`;
  }
  if (provider === "openrouter") {
    openaiHeaders["HTTP-Referer"] = "https://leanzero.atlascrafted.com";
    openaiHeaders["X-Title"] = "CogniRunner";
  }
  // OpenAI/Azure/OpenRouter all expect baseUrl ending in /v1 (PROVIDERS already
  // configured that way). LM Studio is handled by the native path above.
  const requestBody = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
  };
  // Constrain to JSON on providers that reliably honor response_format.
  // Skip for openrouter (passes through; many upstream models reject the field).
  if (jsonMode && (provider === "openai" || provider === "azure")) {
    requestBody.response_format = {
      type: "json_schema",
      json_schema: {
        name: "response",
        strict: false,
        schema: { type: "object" },
      },
    };
  }
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: openaiHeaders,
    body: JSON.stringify(requestBody),
  });
  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    return { ok: false, status: response.status, error: errBody };
  }
  const data = await response.json();
  // Reasoning-model fallback (Qwen3 / DeepSeek-R1 / etc. on LM Studio):
  // these models sometimes emit the whole answer into reasoning_content and leave
  // content empty. Use reasoning_content as a fallback so callers don't see "Empty
  // response from AI" when the model actually responded.
  const msg = data.choices?.[0]?.message;
  let content = msg?.content;
  if ((!content || !content.trim()) && typeof msg?.reasoning_content === "string" && msg.reasoning_content.trim()) {
    content = msg.reasoning_content;
  }
  return { ok: true, content, tokens: data.usage?.total_tokens };
};

/**
 * Execute an AI review of a configuration.
 */
const executeReview = async (params) => {
  const { configType, config } = params;
  const apiKey = await getOpenAIKey();
  if (!apiKey) return { success: false, error: "No API key configured" };
  const model = await getOpenAIModel();

  let configDescription = "";

  if (configType === "validator" || configType === "condition") {
    configDescription = `## Validator / Condition Configuration
- **Field to validate:** ${config.fieldId || "(not set)"}
- **Validation prompt:** ${config.prompt || "(empty)"}
- **JQL Search (agentic mode):** ${config.enableTools === true ? "Always enabled" : config.enableTools === false ? "Disabled" : "Auto-detect from prompt"}
- **Context documents attached:** ${config.selectedDocIds?.length || 0}

This runs on EVERY workflow transition where it's configured. Each run costs one OpenAI API call.`;
  } else if (configType === "postfunction-semantic") {
    configDescription = `## Semantic Post-Function Configuration
- **Source field:** ${config.fieldId || "description"}
- **Condition prompt:** ${config.conditionPrompt || "(empty)"}
- **Action prompt:** ${config.actionPrompt || "(empty)"}
- **Target field to update:** ${config.actionFieldId || "(not set)"}
- **Context documents attached:** ${config.selectedDocIds?.length || 0}

This runs on EVERY workflow transition. Each run costs one OpenAI API call.`;
  } else if (configType === "postfunction-static") {
    const fns = config.functions || [];
    const fnDescriptions = fns.map((fn, i) => {
      const name = fn.name || `Step ${i + 1}`;
      const hasCode = fn.code && fn.code.trim().length > 0;
      return `### Step ${i + 1}: ${name}
- Operation type: ${fn.operationType || "not set"}
- Description: ${fn.operationPrompt || "(empty)"}
- Has code: ${hasCode ? "Yes" : "No"}
- Backoff enabled: ${fn.includeBackoff ? "Yes" : "No"}
${hasCode ? `- Code:\n\`\`\`javascript\n${fn.code.substring(0, 2000)}\n\`\`\`` : ""}`;
    }).join("\n\n");

    configDescription = `## Static Post-Function Configuration
- **Number of steps:** ${fns.length}

This runs on EVERY workflow transition. The code runs directly — NO AI cost at runtime.

${fnDescriptions}`;
  }

  const systemPrompt = `You review CogniRunner workflow automation configs. Be concise, helpful, and actionable.

RULES:
- Maximum 4 items total.
- First item should ALWAYS be type "success" summarizing what the config does. One sentence.
- Only add warnings for REAL problems: logical errors, missing fields, potential data issues.
- Do NOT warn about AI/API costs — the user already knows.
- Do NOT warn about "runs on every transition" — that's by design.
- Every "warning" MUST include a workaround in the same message. Format: "[Problem]. Fix: [solution]."
- "error" = will break. "warning" = risk with fix. "tip" = optional improvement with how-to.
- Keep messages concise but include the fix. Max 150 chars per item.
- Do NOT repeat the same concern.

Respond with ONLY valid JSON:
{"verdict":"good|needs_attention|has_issues","summary":"One short sentence","items":[{"type":"success|error|warning|tip","message":"Feedback with fix if warning"}]}`;

  const result = await callAIChatSimple({
    apiKey, model, systemPrompt,
    userMessage: `Review this configuration:\n\n${configDescription}`,
    jsonMode: true,
  });

  if (!result.ok) {
    return { success: false, error: `AI review failed (HTTP ${result.status}). ${(result.error || "").substring(0, 100)}` };
  }

  if (!result.content) return { success: false, error: "Empty response from AI" };

  // Tolerant JSON parse: handles ```json, ```js, plain ```, and prose wrapping.
  let parsed = null;
  let cleaned = String(result.content).trim()
    .replace(/^```(?:json|javascript|js)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
  if (!cleaned.startsWith("{") && !cleaned.startsWith("[")) {
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      cleaned = cleaned.substring(firstBrace, lastBrace + 1);
    }
  }
  try { parsed = JSON.parse(cleaned); } catch { /* fall through */ }

  if (!parsed) {
    // Graceful fallback — never crash. Surface the raw AI text in the summary so the user
    // still sees something useful instead of a hard error.
    return {
      success: true,
      review: {
        verdict: "good",
        summary: String(result.content).substring(0, 200) || "Could not parse review response.",
        items: [],
      },
      tokens: result.tokens,
    };
  }

  // Validate shape — clamp to known values so the frontend's VERDICT_STYLES lookup works.
  const allowedVerdicts = new Set(["good", "needs_attention", "has_issues"]);
  if (!allowedVerdicts.has(parsed.verdict)) parsed.verdict = "good";
  if (typeof parsed.summary !== "string") parsed.summary = "Review complete.";
  if (!Array.isArray(parsed.items)) parsed.items = [];
  const allowedTypes = new Set(["success", "error", "warning", "tip"]);
  parsed.items = parsed.items
    .filter((item) => item && typeof item.message === "string")
    .map((item) => ({
      type: allowedTypes.has(item.type) ? item.type : "tip",
      message: String(item.message).substring(0, 300),
    }))
    .slice(0, 6); // hard cap

  return { success: true, review: parsed, tokens: result.tokens };
};

/**
 * Run a queued post-function with the long budget. dispatchPostFunction routes to
 * the per-type executor and writes the result log itself — nothing polls this task,
 * so the generic async_task status bookkeeping is skipped for it (see handler()).
 */
const executeQueuedPostFunction = async (params, taskId) => {
  // enqueuedAt: producer timestamp for queue-delay attribution in the log
  // (events from old builds lack it — delay fields are simply omitted).
  const { issueKey, config, extensionKey, enqueuedAt } = params || {};
  if (!issueKey || !config) {
    console.error("Queued post-function missing issueKey/config — dropping");
    return { success: false };
  }
  // Idempotency: Forge async events are delivered at-least-once (platform-level
  // failures — timeouts, OOM — are redelivered automatically; app-level throws are
  // not, but we never rely on that). Claim this task atomically BEFORE executing —
  // a redelivery then skips instead of double-posting comments / re-attaching
  // documents. Claim-first means a crash mid-execution is NOT retried with side
  // effects intact; for fail-open automations, duplicates are the worse failure.
  if (taskId) {
    try {
      await storage.set(`pf_exec:${taskId}`, { issueKey, claimedAt: new Date().toISOString() }, {
        keyPolicy: "FAIL_IF_EXISTS",
        ttl: { value: 6, unit: "HOURS" },
      });
    } catch (e) {
      const isConflict = e?.code === "KEY_ALREADY_EXISTS"
        || e?.responseDetails?.status === 409
        || /already\s*exist/i.test(String(e?.message));
      if (isConflict) {
        console.log(`[pf] duplicate delivery of ${taskId} — already executed/executing, skipping`);
        return { success: true, deduped: true };
      }
      // Claim infrastructure failed for another reason — execute anyway (fail-open).
      console.warn("[pf] dedup claim errored (continuing):", e?.message);
    }
  }
  // 110s budget under the consumer's 120s platform timeout.
  await dispatchPostFunction(issueKey, config, extensionKey || null, Date.now() + 110000, { enqueuedAt });
  return { success: true };
};

// === Task registry — add new async task types here ===
const TASK_HANDLERS = {
  "review": executeReview,
  "postfunction": executeQueuedPostFunction,
};

// Task types with no poller — skip async_task:* status rows (they'd never be
// cleaned up: getAsyncTaskResult deletes rows only when something polls them).
const UNPOLLED_TASKS = new Set(["postfunction"]);

/**
 * Main async event handler. Routes to the correct task handler.
 */
export async function handler(event) {
  const { taskType, taskId, params } = event.body || {};

  if (!taskType || !taskId) {
    console.error("Async handler: missing taskType or taskId");
    return;
  }

  console.log(`Async handler: executing ${taskType} (${taskId})`);

  const taskHandler = TASK_HANDLERS[taskType];
  if (!taskHandler) {
    await storage.set(`${TASK_PREFIX}${taskId}`, { status: "error", error: `Unknown task type: ${taskType}` });
    return;
  }

  const polled = !UNPOLLED_TASKS.has(taskType);
  try {
    // Mark as processing (only for tasks something will poll)
    if (polled) await storage.set(`${TASK_PREFIX}${taskId}`, { status: "processing" });

    // Execute the task (taskId lets idempotent handlers claim their execution)
    const result = await taskHandler(params, taskId);

    // Store result
    if (polled) await storage.set(`${TASK_PREFIX}${taskId}`, { status: "done", result });
    console.log(`Async handler: ${taskType} (${taskId}) completed`);
  } catch (error) {
    console.error(`Async handler error (${taskType}):`, error);
    if (polled) await storage.set(`${TASK_PREFIX}${taskId}`, { status: "error", error: error.message });
  }
}
