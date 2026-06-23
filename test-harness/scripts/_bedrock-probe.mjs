/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/*
 * AWS Bedrock probe — de-risks the Bedrock provider integration BEFORE deploying.
 * Standalone (no Jira harness needed). Validates, against the owner's real key:
 *   1. Control-plane listing (inference-profiles + foundation-models) — captures real
 *      model/profile ids and confirms the API key's IAM policy allows List*.
 *   2. A basic Converse chat round trip — confirms auth, region, endpoint, model id.
 *   3. A Converse tool-use round trip — confirms the toolConfig/toolUse/toolResult
 *      shapes our callBedrockChat translation depends on.
 *
 * Usage (key is a Bedrock API key = bearer token; NO SigV4):
 *   AWS_BEARER_TOKEN_BEDROCK=... BEDROCK_REGION=eu-west-2 node test-harness/scripts/_bedrock-probe.mjs
 * Optional: BEDROCK_MODEL=eu.anthropic.claude-sonnet-4-6  (else auto-picked from the list)
 */

const KEY = process.env.AWS_BEARER_TOKEN_BEDROCK || process.env.BEDROCK_API_KEY || "";
const REGION = (process.env.BEDROCK_REGION || "eu-west-2").trim().toLowerCase();
let MODEL = (process.env.BEDROCK_MODEL || "").trim();

if (!KEY) {
  console.error("Missing key. Set AWS_BEARER_TOKEN_BEDROCK (or BEDROCK_API_KEY).");
  process.exit(1);
}

const RUNTIME = `https://bedrock-runtime.${REGION}.amazonaws.com`;
const CONTROL = `https://bedrock.${REGION}.amazonaws.com`;
const authHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` };

const short = (s, n = 600) => (typeof s === "string" ? s : JSON.stringify(s)).replace(/\s+/g, " ").slice(0, n);

async function getJson(url) {
  const r = await fetch(url, { method: "GET", headers: authHeaders });
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, ok: r.ok, body };
}

async function converse(payload, modelId) {
  // Model id goes in the path LITERALLY — Bedrock ids contain ':' (e.g. …-v1:0) and
  // encodeURIComponent turns ':' into %3A, which the path router 404s on.
  const url = `${RUNTIME}/model/${modelId}/converse`;
  const r = await fetch(url, { method: "POST", headers: authHeaders, body: JSON.stringify(payload) });
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, ok: r.ok, body };
}

console.log(`\n=== AWS Bedrock probe — region ${REGION} ===`);
console.log(`runtime: ${RUNTIME}`);
console.log(`control: ${CONTROL}\n`);

// ---- Step 1: control-plane listing -----------------------------------------
console.log("--- Step 1: model listing (control plane) ---");
let profileIds = [];
const prof = await getJson(`${CONTROL}/inference-profiles?maxResults=1000`);
console.log(`GET /inference-profiles → HTTP ${prof.status}`);
if (prof.ok && prof.body && Array.isArray(prof.body.inferenceProfileSummaries)) {
  profileIds = prof.body.inferenceProfileSummaries.map((p) => p.inferenceProfileId).filter(Boolean);
  console.log(`  ${profileIds.length} inference profiles. Anthropic ones:`);
  profileIds.filter((id) => /anthropic/i.test(id)).slice(0, 12).forEach((id) => console.log(`    ${id}`));
} else {
  console.log(`  list unavailable → ${short(prof.body)}`);
}

let onDemandIds = [];
const fnd = await getJson(`${CONTROL}/foundation-models?byOutputModality=TEXT`);
console.log(`GET /foundation-models → HTTP ${fnd.status}`);
if (fnd.ok && fnd.body && Array.isArray(fnd.body.modelSummaries)) {
  onDemandIds = fnd.body.modelSummaries
    .filter((m) => !Array.isArray(m.inferenceTypesSupported) || m.inferenceTypesSupported.includes("ON_DEMAND"))
    .map((m) => m.modelId);
  console.log(`  ${fnd.body.modelSummaries.length} foundation models (${onDemandIds.length} on-demand). Anthropic on-demand:`);
  onDemandIds.filter((id) => /anthropic/i.test(id)).slice(0, 8).forEach((id) => console.log(`    ${id}`));
} else {
  console.log(`  list unavailable → ${short(fnd.body)}`);
}

// All invokable ids (profiles preferred), and the non-Anthropic subset.
const allIds = [...profileIds, ...onDemandIds];
const nonAnthropic = allIds.filter((id) => !/anthropic/i.test(id));
console.log("\nNon-Anthropic candidates (usable WITHOUT the Anthropic use-case form):");
nonAnthropic.filter((id) => /nova|llama|mistral|titan/i.test(id)).slice(0, 12).forEach((id) => console.log(`    ${id}`));

// For the live chat/tool test, prefer a NON-Anthropic model so the Anthropic use-case gate
// doesn't mask whether the Converse wire format + our translation actually work. Order:
// explicit env > Nova > any non-Anthropic > Anthropic profile > documented default.
if (!MODEL) {
  MODEL = nonAnthropic.find((id) => /nova/i.test(id))
    || nonAnthropic.find((id) => /llama|mistral|titan/i.test(id))
    || nonAnthropic[0]
    || profileIds.find((id) => /anthropic.*claude/i.test(id))
    || "eu.anthropic.claude-sonnet-4-6";
}
console.log(`\nUsing model: ${MODEL}\n`);

// ---- Step 2: basic chat ----------------------------------------------------
console.log("--- Step 2: basic Converse chat ---");
const chat = await converse({
  messages: [{ role: "user", content: [{ text: "Reply with the single word: OK" }] }],
  inferenceConfig: { maxTokens: 64 },
}, MODEL);
console.log(`POST /converse → HTTP ${chat.status}`);
if (chat.ok) {
  const txt = (chat.body.output?.message?.content || []).filter((b) => typeof b.text === "string").map((b) => b.text).join("");
  console.log(`  PASS — stopReason=${chat.body.stopReason} usage=${JSON.stringify(chat.body.usage)}`);
  console.log(`  text: ${short(txt, 120)}`);
} else {
  console.log(`  FAIL → ${short(chat.body)}`);
}

// ---- Step 3: tool-use round trip ------------------------------------------
console.log("\n--- Step 3: Converse tool-use round trip ---");
const toolConfig = {
  tools: [{
    toolSpec: {
      name: "get_weather",
      description: "Get the current weather for a city.",
      inputSchema: { json: { type: "object", properties: { city: { type: "string", description: "City name" } }, required: ["city"] } },
    },
  }],
};
const turn1 = await converse({
  messages: [{ role: "user", content: [{ text: "What's the weather in London right now? Use the get_weather tool." }] }],
  inferenceConfig: { maxTokens: 512 },
  toolConfig,
}, MODEL);
console.log(`turn 1 POST /converse → HTTP ${turn1.status} stopReason=${turn1.ok ? turn1.body.stopReason : "-"}`);
if (!turn1.ok) {
  console.log(`  FAIL (tool request) → ${short(turn1.body)}`);
} else {
  const assistantMsg = turn1.body.output?.message;
  const toolUse = (assistantMsg?.content || []).find((b) => b.toolUse)?.toolUse;
  if (!toolUse) {
    console.log(`  NOTE — model did not emit a toolUse block (stopReason=${turn1.body.stopReason}). Some models won't tool-call on this prompt; the translation still works if Step 2 passed.`);
  } else {
    console.log(`  toolUse: id=${toolUse.toolUseId} name=${toolUse.name} input=${JSON.stringify(toolUse.input)}`);
    const turn2 = await converse({
      messages: [
        { role: "user", content: [{ text: "What's the weather in London right now? Use the get_weather tool." }] },
        assistantMsg, // echo the assistant turn (must include the toolUse block)
        { role: "user", content: [{ toolResult: { toolUseId: toolUse.toolUseId, content: [{ json: { city: "London", tempC: 14, summary: "cloudy" } }], status: "success" } }] },
      ],
      inferenceConfig: { maxTokens: 512 },
      toolConfig,
    }, MODEL);
    console.log(`turn 2 POST /converse → HTTP ${turn2.status} stopReason=${turn2.ok ? turn2.body.stopReason : "-"}`);
    if (turn2.ok) {
      const txt = (turn2.body.output?.message?.content || []).filter((b) => typeof b.text === "string").map((b) => b.text).join("");
      console.log(`  PASS — final text: ${short(txt, 200)}`);
    } else {
      console.log(`  FAIL (tool result) → ${short(turn2.body)}`);
    }
  }
}

console.log("\n=== probe complete ===");
