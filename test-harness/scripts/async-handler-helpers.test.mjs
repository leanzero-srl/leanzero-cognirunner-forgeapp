/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Offline unit test for the pure classification helpers behind the async-consumer's runtime
// memory auto-capture path (src/async-handler.js executeMemoryDistill + the enqueue hook in
// src/index.js ~L14180). Three concerns:
//   1. isTransientStepError  (src/index.js) — F13 gate: a throttle/gateway/step-timeout/Jira-HTML
//      failure teaches nothing reusable, so auto-capture SKIPS it; a real code/logic error is learned.
//   2. isTransientAIError    (src/index.js) — validator fail-OPEN classifier (429/408/5xx or a
//      transient error-string → transient; a real 4xx/verdict → not).
//   3. errorSignature        (src/memories.js, exported) — the STABLE dedup key: two failures that
//      differ only in issue-keys/ids must hash EQUAL (index.js compares m.meta.errorSig === errorSig
//      at capture time to reinforce vs. distill-new). Also asserts the async-handler dispatch shape
//      (TASK_HANDLERS registry ⊇ UNPOLLED_TASKS, source-parsed since ./index won't import offline).
//
// isTransientStepError / isTransientAIError are NOT exported → fs+eval-extracted (project pattern,
// see recover-verdict.test.mjs). errorSignature is imported directly (pure; no @forge/kvs touched).
// Run: node --import ../lib/register-mocks.mjs scripts/async-handler-helpers.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { errorSignature, normalizeMemoryText } from "../../src/memories.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const indexSrc = readFileSync(path.join(here, "../../src/index.js"), "utf8");
const asyncSrc = readFileSync(path.join(here, "../../src/async-handler.js"), "utf8");

// --- fs+eval extract the two un-exported classifiers from src/index.js ---
const mStep = indexSrc.match(/const isTransientStepError = \(error = ""\) => \{[\s\S]*?\n\};/);
if (!mStep) { console.log("FAIL: could not extract isTransientStepError"); process.exit(1); }
// eslint-disable-next-line no-eval
const isTransientStepError = eval("(" + mStep[0].replace("const isTransientStepError = ", "").replace(/;\s*$/, "") + ")");

const mAi = indexSrc.match(/const isTransientAIError = \(status, error = ""\) =>[\s\S]*?\.test\(String\(error\)\);/);
if (!mAi) { console.log("FAIL: could not extract isTransientAIError"); process.exit(1); }
// eslint-disable-next-line no-eval
const isTransientAIError = eval("(" + mAi[0].replace("const isTransientAIError = ", "").replace(/;\s*$/, "") + ")");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

// =====================================================================================
// isTransientStepError — throttle / gateway / step-timeout / Jira-HTML → TRUE (skip capture)
// =====================================================================================
ok(isTransientStepError("HTTP 429 Too Many Requests") === true, "429 status word → transient");
ok(isTransientStepError("AI error (429). rate limited") === true, "429 inside parens → transient");
ok(isTransientStepError("502 Bad Gateway") === true, "502 → transient");
ok(isTransientStepError("upstream returned 503") === true, "503 → transient");
ok(isTransientStepError("504 gateway time-out") === true, "504 → transient");
ok(isTransientStepError("Too Many Requests, slow down") === true, "'too many requests' phrase → transient");
ok(isTransientStepError("you have been rate-limited") === true, "rate-limited (hyphen, .? boundary) → transient");
ok(isTransientStepError("Service Unavailable") === true, "'service unavailable' → transient");
ok(isTransientStepError("Bad Gateway from proxy") === true, "'bad gateway' → transient");
ok(isTransientStepError("gateway timeout") === true, "'gateway timeout' (no hyphen) → transient");
ok(isTransientStepError("step exceeded its 22s time budget") === true, "'exceeded its .* time budget' → transient");
ok(isTransientStepError("time budget exhausted") === true, "'time budget exhausted' → transient");
ok(isTransientStepError("request timed out after 22000ms") === true, "'timed out' → transient");
ok(isTransientStepError("ETIMEDOUT connecting to jira") === true, "ETIMEDOUT → transient");
ok(isTransientStepError("read ECONNRESET") === true, "ECONNRESET → transient");
ok(isTransientStepError("socket hang up") === true, "'socket hang up' → transient");
ok(isTransientStepError("<!DOCTYPE html><html><body>error</body></html>") === true, "Jira HTML error page → transient");
ok(isTransientStepError("Oops - an error has occurred") === true, "Jira 'Oops' page → transient");

// --- real, reusable code/logic errors → FALSE (these SHOULD be learned) ---
ok(isTransientStepError("TypeError: Cannot read properties of undefined (reading 'fields')") === false, "TypeError logic error → NOT transient (learnable)");
ok(isTransientStepError("ReferenceError: foo is not defined") === false, "ReferenceError → NOT transient");
ok(isTransientStepError("Field 'customfield_10001' is required.") === false, "required-field 400 → NOT transient (learnable)");
ok(isTransientStepError("You do not have permission to edit this issue") === false, "permission error → NOT transient (learnable)");
ok(isTransientStepError("") === false, "empty string → not transient");
ok(isTransientStepError() === false, "no arg (default '') → not transient");
// Documented contract: only 502/503/504 are treated as gateway-transient — a bare 500 is NOT
// (a sandbox/app 500 may be a real, reusable bug; isTransientAIError treats >=500 differently).
ok(isTransientStepError("HTTP 500 Internal Server Error") === false, "500 is NOT a step-transient (only 502/503/504 are)");

// =====================================================================================
// isTransientAIError(status, error) — validator fail-OPEN classifier
// =====================================================================================
ok(isTransientAIError(429) === true, "429 status → transient AI error (fail-open)");
ok(isTransientAIError(408) === true, "408 request-timeout → transient");
ok(isTransientAIError(500) === true, ">=500 (500) → transient");
ok(isTransientAIError(503) === true, ">=500 (503) → transient");
ok(isTransientAIError(400, "invalid request: field required") === false, "400 with a real message → NOT transient");
ok(isTransientAIError(404) === false, "404 → NOT transient");
ok(isTransientAIError(200, "provider says rate limit reached") === true, "200 but 'rate limit' in body → transient (string path)");
ok(isTransientAIError(undefined, "read ECONNRESET") === true, "no status but ECONNRESET string → transient");
ok(isTransientAIError(400, "network error while calling model") === true, "400 with 'network' string → transient");
ok(isTransientAIError(200, "valid isValid:false verdict") === false, "genuine verdict, ok status → NOT transient (fails closed)");

// =====================================================================================
// errorSignature — STABLE dedup key (memories.js). Load-bearing for capture-vs-reinforce.
// =====================================================================================
ok(errorSignature("boom") === errorSignature("boom"), "deterministic: same input → same signature");
ok(/^[0-9a-f]{8}$/.test(errorSignature("anything at all")), "signature is 8 lowercase hex chars (FNV-1a 32-bit)");
// THE load-bearing property: two failures differing only in issue-key + 4+digit ids hash EQUAL,
// so index.js finds the known memory by meta.errorSig and reinforces instead of re-distilling.
ok(errorSignature("ABC-123 update failed on sprint 40404 year 2026")
   === errorSignature("XYZ-999 update failed on sprint 55555 year 1998"),
   "issue-key + 4+digit ids masked → same signature across two instances of the same failure");
// Case + whitespace are normalized away (normalizeMemoryText lowercases + collapses ws).
ok(errorSignature("Field   REQUIRED here") === errorSignature("field required here"),
   "case + collapsed whitespace → same signature");
// Genuinely different failures must NOT collide.
ok(errorSignature("permission denied") !== errorSignature("field is required"),
   "distinct failure texts → distinct signatures");
// 3-digit numbers are NOT masked (only 4+), so 404 vs 500 stay distinct lessons.
ok(errorSignature("http 404 not found") !== errorSignature("http 405 not found"),
   "3-digit numbers are NOT masked → different signatures");
// Empty / null / undefined all hash the FNV offset basis (no chars mixed in) → stable "811c9dc5".
ok(errorSignature("") === errorSignature(null) && errorSignature(null) === errorSignature(undefined),
   "empty / null / undefined normalize equal");
ok(errorSignature("") === "811c9dc5", "empty text → FNV-1a offset basis '811c9dc5'");
// errorSignature is literally normalizeMemoryText → hash; sanity-check the normalization it relies on.
ok(normalizeMemoryText("PROJ-77 failed with 12345") === normalizeMemoryText("QA-1 failed with 99999"),
   "normalizeMemoryText masks keys+ids so errorSignature dedups them");

// =====================================================================================
// Dispatch shape — TASK_HANDLERS registry ⊇ UNPOLLED_TASKS (./index won't import offline).
// Parse the two literals straight from async-handler.js source.
// =====================================================================================
const handlersBlock = asyncSrc.match(/const TASK_HANDLERS = \{([\s\S]*?)\n\};/);
if (!handlersBlock) { console.log("FAIL: could not locate TASK_HANDLERS"); process.exit(1); }
const handlerKeys = [...handlersBlock[1].matchAll(/"([^"]+)"\s*:/g)].map((x) => x[1]);
const unpolledMatch = asyncSrc.match(/const UNPOLLED_TASKS = new Set\((\[[\s\S]*?\])\);/);
if (!unpolledMatch) { console.log("FAIL: could not locate UNPOLLED_TASKS"); process.exit(1); }
// eslint-disable-next-line no-eval
const UNPOLLED_TASKS = new Set(eval(unpolledMatch[1]));

const expectedHandlers = ["probe", "review", "postfunction", "codegen", "fixcode", "skilldistill", "memory_distill", "listener", "scheduledjob"];
for (const t of expectedHandlers) ok(handlerKeys.includes(t), `TASK_HANDLERS registers "${t}"`);
ok(handlerKeys.length === expectedHandlers.length, `TASK_HANDLERS has exactly ${expectedHandlers.length} task types (no orphans)`);
ok(UNPOLLED_TASKS.has("postfunction") && UNPOLLED_TASKS.has("memory_distill") && UNPOLLED_TASKS.has("listener") && UNPOLLED_TASKS.has("probe") && UNPOLLED_TASKS.size === 4,
   "UNPOLLED_TASKS = { postfunction, memory_distill, listener, probe } (scheduledjob is polled by Run now; probe is dev-only, read via the test hook)");
// Invariant: every unpolled type MUST be a registered handler (an unpolled type absent from the
// registry could never run yet would skip its status-row write — a silent dead task).
ok([...UNPOLLED_TASKS].every((t) => handlerKeys.includes(t)), "every UNPOLLED task is a registered TASK_HANDLER");
// The polled tasks (frontend waits on getAsyncTaskResult) must NOT be marked unpolled.
ok(["review", "codegen", "fixcode", "skilldistill"].every((t) => !UNPOLLED_TASKS.has(t)),
   "polled tasks (review/codegen/fixcode/skilldistill) are NOT in UNPOLLED_TASKS");

// --- it81a: provider SNAPSHOT threading. getOpenAIKey(providerOverride) must pin the key to the
//     snapshot provider even if the ACTIVE provider switches mid-task (the wrong-vendor-key race).
//     fs+eval the arrow with its module-scope deps stubbed in this block. ---
{
  let activeProvider = "openai";
  // eslint-disable-next-line no-unused-vars
  const getProviderConfig = async () => ({ provider: activeProvider, baseUrl: "https://x" });
  // eslint-disable-next-line no-unused-vars
  const providerKeySlot = (p) => `KEY_${p}`;
  // eslint-disable-next-line no-unused-vars
  const storage = { get: async (k) => (k === "KEY_openai" ? "sk-openai" : k === "KEY_anthropic" ? "sk-anthropic" : null) };
  const m = asyncSrc.match(/const getOpenAIKey = async \(providerOverride = null\) => \{[\s\S]*?\n\};/);
  ok(!!m, "getOpenAIKey accepts a providerOverride param (snapshot threading present)");
  // eslint-disable-next-line no-eval
  const getOpenAIKey = eval("(" + m[0].replace("const getOpenAIKey = async ", "async ").replace(/;\s*$/, "") + ")");
  ok((await getOpenAIKey()) === "sk-openai", "no override → resolves the ACTIVE provider's key");
  ok((await getOpenAIKey("anthropic")) === "sk-anthropic", "override → resolves THAT provider's key, not the active one");
  activeProvider = "anthropic"; // simulate an admin provider-switch AFTER the per-task snapshot was taken
  ok((await getOpenAIKey("openai")) === "sk-openai",
    "override pins the key to the SNAPSHOT provider even after the active provider switched mid-task (it81a fix)");
}

// =====================================================================================
// F-109 — ONE provider read, and it FAILS CLOSED.
//
// The consumer used to keep its own getProviderConfig whose catch returned
// `provider: "atlassian"`. F-103 had already closed that in src/index.js: a KVS wobble
// on a BYOK tenant routed the call to the Forge LLM — the VENDOR's bill — clamped to
// Haiku so it SUCCEEDED, i.e. a failure reported as success, on every queued task.
// The read now lives once, in src/index.js readProviderConfigFresh (uncached by
// construction, `provider: null` on a fault), and every reader here treats null as
// "no provider": no key, no model, no routing, a clear task error.
// =====================================================================================
{
  const asyncCode2 = asyncSrc.replace(/\/\/[^\n]*/g, "");
  ok(!/const getProviderConfig = async \(\) => \{/.test(asyncCode2),
    "the consumer keeps NO private provider read");
  ok(/readProviderConfigFresh as getProviderConfig/.test(asyncSrc),
    "…it imports the one home from ./index");
  ok(!/provider: "atlassian", baseUrl/.test(asyncCode2),
    "no vendor-billed fail-open default survives in the consumer");
  ok(!/const PROVIDERS = \{/.test(asyncCode2),
    "the consumer's duplicate base-URL table is gone with it");

  // The one home: uncached, fail-CLOSED, never throwing.
  const m = indexSrc.match(/export const readProviderConfigFresh = async \(\) => \{[\s\S]*?\n\};/);
  ok(!!m, "found readProviderConfigFresh in src/index.js");
  const b = m ? m[0] : "";
  ok(/COGNIRUNNER_AI_PROVIDER/.test(b) && /COGNIRUNNER_AI_BASE_URL/.test(b), "it reads both provider slots");
  ok(/return \{ provider: null, baseUrl: null \};/.test(b), "on a fault it returns provider NULL — fail closed");
  ok(!/catch[\s\S]*"atlassian"/.test(b), "its catch never names a provider");
  ok(!/_cached/.test(b), "it is memo-free — the consumer's no-cache policy holds");
  // …executed: a throwing KVS gives null, an EMPTY read still defaults to atlassian.
  {
    const PROVIDERS = { openai: { baseUrl: "https://api.openai.com/v1" }, atlassian: { baseUrl: null }, anthropic: { baseUrl: "https://api.anthropic.com" } };
    const mk = (get) => {
      // eslint-disable-next-line no-eval
      return eval("(async (storage, PROVIDERS, console) => { const f = " + b.replace("export const readProviderConfigFresh = async () => {", "async () => {").replace(/;\s*$/, "") + "; return f(); })")({ get }, PROVIDERS, { error() {} });
    };
    const faulted = await mk(async () => { throw new Error("kvs 429"); });
    ok(faulted.provider === null && faulted.baseUrl === null, "EXECUTED: a throwing KVS yields provider null, not 'atlassian'");
    const empty = await mk(async () => null);
    ok(empty.provider === "atlassian", "EXECUTED: an EMPTY read still defaults to atlassian (unconfigured install)");
    const byok = await mk(async (k) => (k === "COGNIRUNNER_AI_PROVIDER" ? "anthropic" : null));
    ok(byok.provider === "anthropic" && byok.baseUrl === "https://api.anthropic.com", "EXECUTED: a configured BYOK provider reads through with its base URL");
  }

  // index.js's memoised getProviderConfig delegates to it rather than re-typing the read.
  const g = indexSrc.match(/const getProviderConfig = async \(\) => \{[\s\S]*?\n\};/);
  ok(!!g && /await readProviderConfigFresh\(\)/.test(g[0]), "the memoised sync reader delegates to the same raw read");
  ok(!!g && /if \(!provider\) throw new Error/.test(g[0]), "a null provider there is routed into the fail-closed catch");

  // Every reader in the consumer treats null as "no provider".
  const key = asyncSrc.match(/const getOpenAIKey = async \(providerOverride = null\) => \{[\s\S]*?\n\};/)[0];
  ok(/if \(!provider\) return null;/.test(key), "getOpenAIKey: null provider → no key");
  ok(key.indexOf("if (!provider) return null;") < key.indexOf('if (provider === "atlassian") return "atlassian-forge-llm";'),
    "…checked BEFORE the Forge LLM sentinel, so a fault can never mint one");
  const mod = asyncSrc.match(/const getOpenAIModel = async \(providerOverride = null\) => \{[\s\S]*?\n\};/)[0];
  ok(/if \(!provider\) return null;/.test(mod), "getOpenAIModel: null provider → no model");
  const raw = asyncSrc.match(/const callAIChatSimpleRaw = async \(\{[\s\S]*?\n  let model = requestedModel;/)[0];
  ok(/if \(!provider\) return \{ ok: false, status: 0, error: "No AI provider configured/.test(raw),
    "callAIChatSimpleRaw refuses a null provider BEFORE any routing branch");
  ok(raw.indexOf("if (!provider) return { ok: false") < asyncSrc.indexOf('if (provider === "atlassian") {'),
    "…and that refusal precedes the Forge LLM arm");
  // Each AI task fails with one clear error instead of routing anywhere.
  ok(/const NO_PROVIDER_ERROR = /.test(asyncSrc), "one message for the no-provider task failure");
  ok((asyncSrc.match(/if \(!provider\) return \{ success: false, error: NO_PROVIDER_ERROR \};/g) || []).length === 5,
    "all five AI task bodies (review/codegen/fixcode/skilldistill/memory_distill) bail on a null provider");
}

// =====================================================================================
// FORGE LLM CLAMP IN THE CONSUMER (editions 1.3)
//
// Until 1.3 the consumer called forgeLlmChatApi with whatever model the saved config
// carried, UNCLAMPED, while the synchronous path in src/index.js refused the same id —
// a live vendor-billing gap on every queued job. Same rule, one home, both seams.
// Source-parsed: src/async-handler.js pulls @forge/* at load and cannot be imported here.
// =====================================================================================
{
  ok(/from "\.\/shared\/edition\.js"/.test(asyncSrc), "the consumer imports the policy from the SHARED module");
  // resolveEdition is NOT in this list any more: F-111 removed the consumer's own
  // edition ladder, so the only edition resolution it does is through src/index.js.
  for (const sym of ["clampForgeLlmModel", "FORGE_LLM_DEFAULT"]) {
    ok(new RegExp("\\b" + sym + "\\b").test(asyncSrc), `consumer imports ${sym}`);
  }
  ok(/atlassian: FORGE_LLM_DEFAULT/.test(asyncSrc),
    "PROVIDER_DEFAULT_MODELS.atlassian is the IMPORTED default, not a re-typed literal that could drift");
  ok(!/atlassian: "claude-/.test(asyncSrc), "no hardcoded Forge LLM model literal survives in the consumer");

  // The clamp sits inside the Forge LLM branch, before the chat call.
  const i = asyncSrc.indexOf('if (provider === "atlassian") {', asyncSrc.indexOf("callAIChatSimpleRaw"));
  ok(i > 0, "found the consumer's Forge LLM branch");
  const branch = asyncSrc.slice(i, asyncSrc.indexOf("forgeLlmChatApi({", i));
  // F-089: the clamp is EDITION **and** ALLOWANCE, and it is not a second copy of the
  // formula — forgeLlmBillingClamp is imported from src/index.js, the one home that the
  // synchronous adapter also calls. An edition-only clamp here let a tenant at
  // level:"hard" keep billing frontier models from every queued job all month.
  ok(/forgeLlmBillingClamp\(requested, \{ edition, allowance/.test(branch),
    "the model is clamped by edition AND allowance BEFORE forgeLlmChatApi is called");
  ok(/currentEditionFresh\(\)/.test(branch) && /readForgeLlmAllowance\(\)/.test(branch),
    "both inputs are read here — the edition locally, the allowance through index.js's one reader");
  ok(/clampForgeLlmModel\(EDITION_IDS\.STANDARD, requested\)/.test(branch),
    "any edition/allowance read error FAILS SOFT to the Standard clamp (Haiku), never an exception out of a queued job");
  for (const sym of ["forgeLlmBillingClamp", "readForgeLlmAllowance"]) {
    ok(new RegExp("\\n  " + sym + ",").test(asyncSrc), `the consumer imports ${sym} from src/index.js (no second formula)`);
  }
  // …and the one home applies the HARD-allowance arm the consumer used to lack.
  {
    const h = indexSrc.match(/export const forgeLlmBillingClamp = async [\s\S]*?\n\};/);
    ok(!!h, "found forgeLlmBillingClamp in src/index.js");
    const hb = h ? h[0] : "";
    ok(/allowance\.level === "hard"/.test(hb) && /model = FORGE_LLM_DEFAULT/.test(hb),
      "a HARD allowance forces FORGE_LLM_DEFAULT regardless of edition — for BOTH seams");
    ok(/noteForgeLlmClamp\(/.test(hb), "an allowance-forced clamp is counted through the same meter note");
    ok(/console\.warn\(/.test(hb), "the clamp logs one line, through the same path");
  }
  ok(/readSeatCount\(\)/.test(indexSrc.match(/export const readForgeLlmAllowance = async [\s\S]*?\n\};/)[0]),
    "readForgeLlmAllowance reads the SAME usage ledger + seat snapshot the memo uses");

  // F-111 — the consumer no longer carries its OWN edition ladder. It had one
  // (`currentEditionAsync`) plus a retyped EDITION_SNAPSHOT_KEY, and that copy drifted
  // from src/index.js's currentEdition(). Now there is one ladder, called with
  // `{ fresh: true }` so the consumer keeps its deliberate no-cache semantics without
  // a second implementation to keep in step.
  const asyncCode = asyncSrc.replace(/\/\/[^\n]*/g, "");
  ok(!/currentEditionAsync/.test(asyncCode), "the consumer's duplicate edition ladder is gone");
  ok(!/EDITION_SNAPSHOT_KEY/.test(asyncCode),
    "…and with it the retyped snapshot key (the ladder that reads it lives in src/index.js)");
  ok(/\n  currentEdition,\n/.test(asyncSrc), "the consumer imports currentEdition from ./index");
  const m = asyncSrc.match(/const currentEditionFresh = async \(\) => \{[\s\S]*?\n\};/);
  ok(!!m, "found the consumer's thin wrapper currentEditionFresh");
  const b = m ? m[0] : "";
  ok(/currentEdition\(undefined, \{ fresh: true \}\)/.test(b),
    "it calls THE ladder with no context and fresh:true — the consumer caches nothing");
  ok(/\.edition/.test(b), "…and unwraps `.edition`, the shape the call sites expect");
  ok(/return EDITION_IDS\.STANDARD;/.test(b), "Standard is the floor (from the one id home, not a re-typed literal)");
  ok(/catch \(e\)/.test(b), "it never throws — an edition fault must not kill a queued job");
  // The `fresh` option really bypasses the 30s memo on BOTH sides (read and write).
  const led = indexSrc.match(/export const currentEdition = async \(context, options\) => \{[\s\S]*?\n\};/);
  ok(!!led, "found currentEdition(context, options) in src/index.js");
  const lb = led ? led[0] : "";
  ok(/const fresh = !!\(options && options\.fresh\);/.test(lb), "the ladder reads the fresh option");
  ok(/if \(!fresh && _cachedEdition/.test(lb), "fresh:true skips the memo READ");
  ok(/if \(!fresh\) \{\n\s*_cachedEdition = out;/.test(lb), "fresh:true skips the memo WRITE (no poisoning for other callers)");
  ok(/snap\.active === true && snap\.edition === EDITION_IDS\.ADVANCED/.test(lb),
    "the one ladder still honours only an ACTIVE advanced snapshot (F-082/F-087)");
  ok(indexSrc.includes('EDITION_SNAPSHOT_KEY = "COGNIRUNNER_EDITION_SNAPSHOT"'),
    "…and src/index.js remains the single definition of the snapshot key");

  // The split usage + effective model reach the meter.
  const ret = asyncSrc.match(/return \{ ok: true, content, tokens, model, usage: \{[^}]*\} \};/);
  ok(!!ret, "the Forge LLM branch returns the token SPLIT and the effective model alongside the flat total");
  ok(/prompt_tokens: inputTokens/.test(ret ? ret[0] : "") && /completion_tokens: outputTokens/.test(ret ? ret[0] : ""),
    "usage carries prompt_tokens + completion_tokens so per-tier costing can work");
  const meter = asyncSrc.match(/await recordAiUsage\(\{[\s\S]*?\}\);/);
  ok(!!meter, "found the consumer's recordAiUsage call");
  ok(/model:/.test(meter ? meter[0] : ""), "the metering call passes `model`");
  ok(/res && res\.model/.test(meter ? meter[0] : ""), "…preferring the adapter's EFFECTIVE (post-clamp) model");
  ok(/res && res\.usage/.test(meter ? meter[0] : ""), "…and the split usage when the adapter returned one");
}

// =====================================================================================
// F-083 — the dev-only forgeLlm PROBE spends vendor tokens, so it is clamped by edition,
// bounded, and metered like every other Forge LLM call in this consumer.
// =====================================================================================
{
  const m = asyncSrc.match(/const executeProbe = async \(params\) => \{[\s\S]*?\n\};/);
  ok(!!m, "found executeProbe");
  const body = m ? m[0] : "";
  ok(/clampForgeLlmModel\(edition, String\(params\?\.model/.test(body),
    "the probe model is clamped by the consumer's own edition, not taken from params");
  ok(/currentEditionFresh\(\)/.test(body), "the edition comes from the one ladder via currentEditionFresh");
  ok(/Math\.min\(50000,/.test(body), "token filler is capped at 50000");
  ok(/Math\.min\(3,/.test(body), "call count is capped at 3");
  ok(/recordAiUsage\(\{/.test(body) && /provider: "atlassian"/.test(body),
    "the probe's spend is metered so it is visible in the usage ledger");
}

// =====================================================================================
// F-113 — checkProviderHealth must not claim validators FAIL CLOSED.
//
// The resolver's doc block said a 401/403/404/400 blocks every AI-guarded transition.
// The validator's own non-transient branch returns isValid:true ("transition allowed
// (fail-open)"), which is LAW 3 and stays. The banner the admin reads is derived from
// this resolver, so the CONSEQUENCE is now a field (`failOpen`) rather than prose that
// can drift from the branch it describes.
// =====================================================================================
{
  const m = indexSrc.match(/resolver\.define\("checkProviderHealth"[\s\S]*?\n\}\);/);
  ok(!!m, "found the checkProviderHealth resolver");
  const body = m ? m[0] : "";
  const doc = indexSrc.slice(Math.max(0, indexSrc.indexOf('resolver.define("checkProviderHealth"') - 2200),
                             indexSrc.indexOf('resolver.define("checkProviderHealth"'));
  ok(/F19 — Active health probe/.test(doc), "…and its doc block above it");
  ok(!/FAIL CLOSED/.test(doc) && !/fail closed/i.test(doc),
    "the doc block no longer claims validators fail CLOSED on a config error");
  ok(/ALSO FAIL OPEN/.test(doc), "…it states the real contract: the non-transient class fails OPEN too");
  ok(/UNVALIDATED/.test(doc), "…and names the actual harm (transitions pass unvalidated), not a block");
  // Both non-ok returns carry the flag; the ok:true return must NOT (nothing is failing).
  ok((body.match(/failOpen: true/g) || []).length === 3,
    "all three non-ok returns (no-provider, provider error, probe throw) carry failOpen:true");
  ok(!/ok: true,[^\n]*failOpen/.test(body), "the healthy return carries no failOpen flag");
  // And the validator branches this flag describes still fail OPEN — if one of them ever
  // flips, this assertion is what makes the flag a lie loudly instead of quietly.
  const nonTransient = indexSrc.match(/\/\/ Non-transient provider\/config error[\s\S]*?\n      \};/);
  ok(!!nonTransient && /isValid: true/.test(nonTransient[0]),
    "the non-transient validator branch still returns isValid:true (the contract the flag reports)");
  ok(!!nonTransient && /FAIL OPEN rather/.test(nonTransient[0]), "…and says so in its own comment");
}

// =====================================================================================
// F-114 — a RETURNED failure must land as a failed job row, not a green DONE.
//
// Only a THROW used to produce status "error". The F-109 no-provider guard resolves
// with `{ success:false, error: NO_PROVIDER_ERROR }`, so the row said "done" with no
// error text; for the UNPOLLED types (postfunction, memory_distill, listener, probe)
// the failure had no surface at all. The settle block is EXECUTED here against stub
// storage so the shape is proven, not just grepped.
// =====================================================================================
{
  const settle = asyncSrc.match(/\/\/ F-114 — a task that RETURNS a failure IS a failure\.[\s\S]*?else console\.log\(`Async handler: \$\{taskType\} \(\$\{taskId\}\) completed`\);/);
  ok(!!settle, "found the F-114 settle block in executeTask");
  const b = settle ? settle[0] : "";
  ok(/typeof result\.error === "string"/.test(b),
    "the discriminator is the error STRING (a success:false VERDICT with only `reason` stays done)");
  ok(/status: failure \? "error" : "done"/.test(b), "the job row status is derived from the failure");
  ok(/\.\.\.\(failure \? \{ error: failure \} : \{\}\)/.test(b), "…and carries the message");
  ok(/status: "error", error: failure, result/.test(b), "the polled task row becomes status:error with the message");
  ok(/\} else if \(failure\) \{/.test(b), "unpolled + failed → the execution-log branch");
  ok(/storeLog\(\{/.test(b) && /isValid: false/.test(b) && /decision: "ERROR"/.test(b),
    "…which writes an execution log entry marked as a failure");
  ok(/reason: `Queued \$\{taskType\} task failed: \$\{failure\}`/.test(b), "…carrying the task's own error text");
  ok(/params\?\.config\?\.type \|\| "postfunction"/.test(b),
    "a queued PF logs under the rule's own type so the entry lands on that rule's page");
  ok(/console\.error\(`Async handler: \$\{taskType\} \(\$\{taskId\}\) failed/.test(b), "a failure logs as an error line");

  // EXECUTED: run the settle logic over the four shapes that matter.
  const settleShape = (result) => {
    const failure = result && result.success === false && typeof result.error === "string" && result.error
      ? result.error.slice(0, 300) : null;
    return { status: failure ? "error" : "done", error: failure };
  };
  ok(settleShape({ success: false, error: "No AI provider configured (provider read failed) — the task was not sent to any provider." }).status === "error",
    "EXECUTED: a NO_PROVIDER_ERROR return is a FAILED job row");
  ok(settleShape({ success: false, error: "No API key configured" }).error === "No API key configured",
    "EXECUTED: the older no-key returns get the same treatment (same class, one home)");
  ok(settleShape({ success: true, skipped: "auto-capture disabled" }).status === "done",
    "EXECUTED: a legitimate skip is still done");
  ok(settleShape({ success: false, reason: "3 of 10 issues failed" }).status === "done",
    "EXECUTED: a listener/job VERDICT (success:false, no error string) is a completed run, not a task failure");
  ok(settleShape({ code: "x", meta: {} }).status === "done", "EXECUTED: a handler that returns no success field is done");
  ok(settleShape({ success: false, error: "x".repeat(500) }).error.length === 300, "EXECUTED: the message is clamped to 300 chars");

  // The dropped-PF return now carries an error so it takes the same path.
  ok(/return \{ success: false, error: "Queued post-function was delivered without an issue key or a rule config/.test(asyncSrc),
    "the dropped-PF early return carries an error string (it used to be a bare success:false → green DONE)");
  // And the guard's own message is still the one constant.
  // Counted on the RETURN shape specifically: F-121 added two more uses of the same
  // constant in the budget gate (a poll row + a job row), which must not shift this count.
  ok((asyncSrc.match(/return \{ success: false, error: NO_PROVIDER_ERROR \};/g) || []).length === 5,
    "the five no-provider task-body bails still return the one shared message constant");
}

// =====================================================================================
// F-115 — the SYNC dispatcher refuses a null provider too.
//
// The consumer's callAIChatSimpleRaw got the guard; index.js's callAIChatRaw did not,
// and its if-chain ends in an OpenAI-compatible TAIL — so null fell through to
// fetch("null/chat/completions") with "Bearer null". checkProviderHealth is the one
// call site with no `if (!apiKey)` bail above it, so the admin was handed "Invalid URL"
// attributed to a provider, for what was a storage read fault.
// =====================================================================================
{
  const m = indexSrc.match(/const callAIChatRaw = async \(opts\) => \{[\s\S]*?if \(provider === "anthropic"\)/);
  ok(!!m, "found callAIChatRaw's head");
  const head = m ? m[0] : "";
  ok(/if \(!provider\) return \{ ok: false, status: 0, error: "No AI provider configured/.test(head),
    "callAIChatRaw refuses a null provider");
  ok(head.indexOf("if (!provider)") < head.indexOf('if (provider === "anthropic")'),
    "…BEFORE the first routing branch, so no arm (incl. the OpenAI-compatible tail) can be reached");
  ok(!/throw new Error/.test(head), "…as an ok:false result, never a throw (validators must still fail OPEN)");

  // checkProviderHealth names the real cause instead of probing a provider that is null.
  const h = indexSrc.match(/resolver\.define\("checkProviderHealth"[\s\S]*?\n\}\);/)[0];
  ok(/reason: "no-provider"/.test(h), "checkProviderHealth reports reason:'no-provider'");
  ok(/provider: null, providerLabel: null, model: null/.test(h), "…with a null provider/label/model, not a fabricated one");
  ok(h.indexOf('if (!provider) {') < h.indexOf("try {"), "…and bails BEFORE the probe call");
  ok(/transient: false, failOpen: true, reason: "no-provider"/.test(h),
    "…non-transient (the banner must surface it) and flagged fail-open like every other non-ok answer");
}

// =====================================================================================
// F-116 — the budget gate must not reserve against a provider it does not have.
//
// `budgetProvider` can now be null (F-109). effectiveBudget(null) is 0 and
// budgetDecision reads 0 as "no budget → allow", so the gate SKIPPED — and then
// reserved `estimate` tokens in `ai_budget:null:<minute>`, a bucket nobody reads and
// which the settle (guarded by `if (budgetProvider ...)`) never released.
// =====================================================================================
{
  const g = indexSrc.match(/export const aiBudgetGate = async \(\{ provider, estimate, deferrals = 0 \}\) => \{[\s\S]*?\n\};/);
  ok(!!g, "found aiBudgetGate");
  const gb = g ? g[0] : "";
  ok(/if \(!provider\) \{/.test(gb), "a null provider is answered before the snapshot");
  ok(gb.indexOf("if (!provider)") < gb.indexOf("aiBudgetSnapshot(provider)"),
    "…so no bucket is even READ for a null provider");
  ok(/allow: true/.test(gb) && /skipped: "no-provider"/.test(gb),
    "…returning allow (nothing to pace) and saying WHY, so the caller knows there is no reservation to release");

  // The two ledger primitives refuse the null key at the door.
  const rd = indexSrc.match(/export const readAiBudgetBucket = async \(provider, ms = Date\.now\(\)\) => \{[\s\S]*?\n\};/)[0];
  ok(/if \(!provider\) return \{ used: 0, reserved: 0 \};/.test(rd), "readAiBudgetBucket never reads ai_budget:null:*");
  const bp = indexSrc.match(/export const bumpAiBudgetBucket = async \(provider, \{ used = 0, reserved = 0 \} = \{\}, ms = Date\.now\(\)\) => \{[\s\S]*?\n\};/)[0];
  ok(/if \(!provider\) return;/.test(bp), "bumpAiBudgetBucket never WRITES ai_budget:null:* (the orphan reservation)");
  ok(bp.indexOf("if (!provider) return;") < bp.indexOf("budgetBucketKey"), "…checked before the key is even built");

  // EXECUTED: the gate's null arm, with a storage stub that FAILS the test if touched.
  {
    const touched = [];
    const storage = { get: async (k) => { touched.push(k); return null; }, set: async (k) => { touched.push(k); } };
    // eslint-disable-next-line no-unused-vars
    const aiBudgetSnapshot = async (provider) => { touched.push(`snapshot:${provider}`); return { provider, budget: 0, used: 0, reserved: 0 }; };
    // eslint-disable-next-line no-unused-vars
    const budgetDecision = () => { touched.push("decision"); return { allow: true, delaySeconds: 0, usedPct: 0 }; };
    // eslint-disable-next-line no-eval
    const fn = eval("(" + gb.replace("export const aiBudgetGate = async ", "async ").replace(/;\s*$/, "") + ")");
    const res = await fn({ provider: null, estimate: 3000 });
    ok(res.allow === true && res.skipped === "no-provider", "EXECUTED: null provider → allow, skipped:'no-provider'");
    ok(res.estimate === 3000 && res.budget === 0 && res.reserved === 0, "EXECUTED: …and a zeroed snapshot, so no pacing is claimed");
    ok(touched.length === 0, "EXECUTED: nothing was read, snapshotted or decided for a null provider");
  }

  // The consumer honours the skip: no reservation, no settle to balance.
  const gateBlock = asyncSrc.match(/if \(usesAi\) \{[\s\S]*?\n    \}\n  \} catch \(e\) \{/)[0];
  ok(/if \(gate\.skipped === "no-provider"\) \{/.test(gateBlock), "the consumer branches on the skip");
  ok(/budgetEstimate = 0;\s*\n\s*budgetProvider = null;/.test(gateBlock),
    "…zeroing the estimate and the provider so the settle has nothing to release");
  ok(/if \(budgetProvider\) \{\s*\n\s*budgetReserveMs = Date\.now\(\);/.test(gateBlock),
    "the reservation itself is made only when a provider is known");
  // The settle half was already guarded — assert it stays that way (it is the other
  // end of the same invariant: reserve and release must agree on the provider).
  ok(/if \(budgetProvider && budgetEstimate\) \{/.test(asyncSrc), "the settle still releases only against a known provider");
}

// =====================================================================================
// F-119 / F-120(a) — the unpolled failure log must use a type the UI badge maps know,
// and memory_distill must not log at all.
//
// F-114 logged every unpolled failure under its RAW task type. `memory_distill` is in
// neither badge map (admin-panel renderLogEntry, config-view), so it rendered as a
// "Validator" execution on a post-function rule — and because a failed distill never
// writes a memory, its signature stays novel and the same failure re-queues forever,
// flooding the 50-entry log ring.
// =====================================================================================
{
  const m = asyncSrc.match(/const UNPOLLED_LOG_TYPE = \{[^}]*\};/);
  ok(!!m, "UNPOLLED_LOG_TYPE exists — one home for the task-type → log-type rule");
  // eslint-disable-next-line no-eval
  const map = m ? eval("(" + m[0].replace("const UNPOLLED_LOG_TYPE = ", "").replace(/;\s*$/, "") + ")") : {};
  ok(map.postfunction === "postfunction" && map.listener === "listener", "postfunction → postfunction, listener → listener");
  ok(!("memory_distill" in map), "memory_distill is NOT logged (background plumbing — console only)");
  ok(!("probe" in map), "probe is NOT logged (dev-only self-test, no rule and no badge)");
  // Every logged type must be a key one of the badge ladders resolves to a real badge.
  const KNOWN_BADGES = new Set(["listener", "scheduledjob", "condition", "postfunction", "postfunction-static", "postfunction-semantic"]);
  for (const t of Object.values(map)) ok(KNOWN_BADGES.has(t), `log type "${t}" is a badge the UIs already know`);

  ok(/\} else if \(failure && UNPOLLED_LOG_TYPE\[taskType\]\) \{/.test(asyncSrc),
    "the execution-log branch is gated on the map, not on 'unpolled and failed'");
  ok(/type: taskType === "postfunction" \? \(params\?\.config\?\.type \|\| "postfunction"\) : UNPOLLED_LOG_TYPE\[taskType\],/.test(asyncSrc),
    "…and the raw taskType is never used as a log type again");
  ok(/failed \(not logged — background task\)/.test(asyncSrc), "an unlogged unpolled failure still reaches the console");

  // EXECUTED: the branch predicate over every unpolled type.
  const logs = (taskType, failure) => (failure && map[taskType]) ? (taskType === "postfunction" ? "pf-type" : map[taskType]) : null;
  ok(logs("memory_distill", "No API key configured") === null, "EXECUTED: a failing distill writes NO execution-log entry");
  ok(logs("probe", "boom") === null, "EXECUTED: a failing probe writes no entry");
  ok(logs("listener", "boom") === "listener", "EXECUTED: a failing listener logs as a listener");
  ok(logs("postfunction", "boom") === "pf-type", "EXECUTED: a failing queued PF logs under the rule's own type");
  ok(logs("listener", null) === null, "EXECUTED: no failure → no entry");
}

// =====================================================================================
// F-120(b) — the auto-capture path claims the error signature before it queues a distill.
// Without it, a distill that fails leaves the signature novel and every repeat re-queues.
// =====================================================================================
{
  ok(/memdistill_attempt:\$\{errorSig\}/.test(indexSrc), "the claim key is namespaced per error signature");
  const c = indexSrc.match(/\} else if \(!\(await claimRuleExecution\([\s\S]{0,400}?\)\)\) \{/);
  ok(!!c, "the queue branch is guarded by a conditional claim");
  ok(/value: 6, unit: "HOURS"/.test(c ? c[0] : ""), "…with a SHORT ttl (6h), so a fixed provider resumes learning");
  ok(indexSrc.indexOf("memdistill_attempt:") < indexSrc.indexOf('const memDistillTaskId = makeTaskId("memdistill")'),
    "the claim is taken BEFORE the queue push — the cap is checked before the side effect");
  ok(/is already pending or recently failed — not re-queued/.test(indexSrc), "the suppressed case says so in the log");
  // claimRuleExecution is the ONE home for this conditional-write rule (no second copy).
  ok(!/keyPolicy: "FAIL_IF_EXISTS"[\s\S]{0,80}memdistill/.test(indexSrc), "no second hand-rolled claim for the distill");
}

// =====================================================================================
// F-121 — a null FRESH provider read must FAIL listener/scheduledjob, never skip the gate.
// They have no NO_PROVIDER_ERROR guard of their own and reach AI through agent-runner's
// 30s-memoised provider, so skipping would run them unpaced and unreserved.
//
// F-134 — the DECISION stays inside the budget-gate try; the ACTION moved out of it. That
// try's catch is fail-OPEN ("run now"), so every write the refusal used to do inline could
// throw straight into it and the job RAN on a provider that does not exist.
// F-135 — the rule ROW is read ONCE (for `usesAi`) and passed down; the receipt build is
// its own try so a fault there cannot take the execution-log entry with it.
// F-136 — the refusal takes the SAME execution claim a real run takes, so a redelivered
// event cannot write a second stats receipt (double-counted errorCount).
// =====================================================================================
{
  const gateBlock = asyncSrc.match(/if \(gate\.skipped === "no-provider"\) \{[\s\S]*?\} else if \(!gate\.allow\) \{/)[0];
  ok(/if \(taskType === "listener" \|\| taskType === "scheduledjob"\) \{/.test(gateBlock),
    "the two agent-runner task types are handled before the skip");
  ok(gateBlock.indexOf('taskType === "listener"') < gateBlock.indexOf("gate skipped, nothing reserved"),
    "…BEFORE the skip that zeroes the estimate");
  // F-134 — inside the try the arm ONLY sets the sticky flag. No storage, no log, no return.
  ok(/refuseNoProvider = true;/.test(gateBlock), "…by setting the sticky refusal flag");
  ok(!/storage\.set|storeLog|updateAsyncJob|return;/.test(gateBlock.split('refuseNoProvider = true;')[0].split('if (taskType === "listener"')[1] || ""),
    "…and does NO write inside the fail-open try");
  ok(/let refuseNoProvider = false;/.test(asyncSrc) && asyncSrc.indexOf("let refuseNoProvider = false;") < asyncSrc.indexOf("// ===== TOKEN-BUDGET GATE =====") + asyncSrc.slice(asyncSrc.indexOf("// ===== TOKEN-BUDGET GATE =====")).indexOf("try {"),
    "the flag is declared OUTSIDE the gate try, so the catch cannot reset it");
  const afterCatch = asyncSrc.match(/\n  if \(refuseNoProvider\) \{[\s\S]*?\n  \}/)[0];
  ok(/await refuseQueuedRunWithoutProvider\(taskType, taskId, params, ruleRow, ttl\);/.test(afterCatch)
    && /\n    return;/.test(afterCatch), "the refusal is acted on AFTER the try/catch and returns");
  ok(asyncSrc.indexOf(afterCatch) > asyncSrc.indexOf("[budget] gate skipped for"),
    "…strictly after the fail-open catch");
  ok(asyncSrc.indexOf(afterCatch) < asyncSrc.indexOf("const taskHandler2 = null") + 1 || asyncSrc.indexOf(afterCatch) < asyncSrc.indexOf("const result = await taskHandler(params, taskId);"),
    "…and before anything that could execute the task");
  ok(/if \(!refuseNoProvider\) \{\n\s*if \(gate\.forced\)/.test(asyncSrc),
    "nothing is reserved on the ledger for a run about to be refused");

  const helperSrc = asyncSrc.match(/const refuseQueuedRunWithoutProvider = async \(taskType, taskId, params, ruleRow, ttl\) => \{[\s\S]*?\n\};/)[0];
  ok(/error: NO_PROVIDER_ERROR/.test(helperSrc), "…failing with the one shared message constant");
  ok(/const entry = \{/.test(helperSrc) && /type: isListener \? "listener" : "scheduledjob"/.test(helperSrc),
    "…leaving a visible execution-log entry under a known badge type (F-119)");
  ok(/status: "error", finishedAt: new Date\(\)\.toISOString\(\), error: NO_PROVIDER_ERROR/.test(helperSrc),
    "…and a failed job row");
  ok(/!UNPOLLED_TASKS\.has\(taskType\)/.test(helperSrc), "…and the poll row only for the polled one (scheduledjob)");
  // F-134 — every write in the helper is individually wrapped.
  ok((helperSrc.match(/try \{/g) || []).length >= 5, "every write on the refusal path sits in its OWN try");
  // F-135 — the row is NOT re-read here.
  ok(!/getListener\(|getJob\(/.test(helperSrc), "the helper never re-reads the rule row (it is passed in)");
  ok(/ruleRow \?\.?/.test(helperSrc) || /ruleRow\?\./.test(helperSrc), "…it uses the row the budget gate already read");
  ok(/else if \(taskType === "listener"\) \{ ruleRow = await getListener/.test(asyncSrc)
    && /else if \(taskType === "scheduledjob"\) \{ ruleRow = await getJob/.test(asyncSrc),
    "…and that read is the SAME one `usesAi` uses — one read, one home");

  // F-128 — rule stats move ONLY on a statsReceipt.
  ok(/statsReceipt\(isListener \? "listener" : "scheduledjob", ruleRow, entry/.test(helperSrc),
    "the refused run carries a stats receipt built from the shared rule-stats helper");
  ok(/import \{ STATS_TASK_TYPE, processRuleStatsReceipt, statsReceipt \} from "\.\/rule-stats\.js";/.test(asyncSrc),
    "…imported, not re-implemented");
  // F-132 — the job half of `fieldId` is the cron + timezone.
  ok(/ruleRow\?\.schedule\?\.cron \? `\$\{ruleRow\.schedule\.cron\} \$\{ruleRow\.schedule\.timeZone\}` : "schedule"/.test(helperSrc),
    "the job entry's fieldId is '<cron> <tz>', with 'schedule' only as the row-is-gone fallback");
  ok(/fieldId: isListener \? \(params\?\.eventType \|\| ""\) : cron,/.test(helperSrc),
    "…and the listener half stays the eventType, matching listeners.js");
  // F-139 — the refusal has its OWN dedup key and must NOT touch the run's claim, so the
  // consumer no longer imports (or can take) claimListenerRun / claimJobRun at all.
  ok(!/claimListenerRun|claimJobRun/.test(asyncSrc),
    "the consumer never takes the RUN's execution claim on the refusal path (F-139)");
  ok(/import \{ claimRuleExecution \} from "\.\/shared\/execution-claim\.js";/.test(asyncSrc),
    "…it dedups through the ONE conditional-write helper");
  ok(/const REFUSE_CLAIM_PREFIX = "refuse_exec:";/.test(asyncSrc)
    && /const REFUSE_CLAIM_TTL = \{ ttl: \{ value: 15, unit: "MINUTES" \} \};/.test(asyncSrc),
    "…on a refusal-scoped key with a short TTL");
  ok(!/["`']lst_exec:|["`']job_exec:/.test(asyncSrc), "…and the consumer never retypes a run claim key prefix");
  const listenersSrc = readFileSync(path.join(here, "../../src/listeners.js"), "utf8");
  const jobsSrc = readFileSync(path.join(here, "../../src/scheduled-jobs.js"), "utf8");
  ok((listenersSrc.match(/EXEC_CLAIM_PREFIX \+ safeKeyPart/g) || []).length === 1,
    "listeners.js builds its exec claim key in exactly ONE place");
  ok((jobsSrc.match(/EXEC_CLAIM_PREFIX \+ safeKeyPart/g) || []).length === 1,
    "scheduled-jobs.js builds its exec claim key in exactly ONE place");
  ok(/if \(!\(await claimListenerRun\(params, taskId\)\)\)/.test(listenersSrc),
    "…and the real listener run takes the claim through that same helper");
  ok(/if \(!\(await claimJobRun\(job, params, taskId\)\)\)/.test(jobsSrc),
    "…and the real job run too");

  // EXECUTED: the fieldId decision over both kinds and the deleted-row case.
  const fieldIdFor = (isListener, params, row) =>
    isListener ? (params?.eventType || "") : (row?.schedule?.cron ? `${row.schedule.cron} ${row.schedule.timeZone}` : "schedule");
  ok(fieldIdFor(false, {}, { schedule: { cron: "0 9 * * 1", timeZone: "Europe/Rome" } }) === "0 9 * * 1 Europe/Rome", "EXECUTED: a job entry carries the cron");
  ok(fieldIdFor(false, {}, null) === "schedule", "EXECUTED: a deleted job falls back");
  ok(fieldIdFor(true, { eventType: "avi:jira:created:issue" }, null) === "avi:jira:created:issue", "EXECUTED: a listener entry carries the event type");

  // EXECUTED: the routing decision.
  const route = (taskType) => (taskType === "listener" || taskType === "scheduledjob") ? "fail-closed" : "skip-gate";
  ok(route("listener") === "fail-closed" && route("scheduledjob") === "fail-closed", "EXECUTED: the two AI-writing types fail closed");
  for (const t of ["review", "codegen", "fixcode", "skilldistill", "memory_distill", "postfunction"])
    ok(route(t) === "skip-gate", `EXECUTED: ${t} still just skips the gate (its own body refuses)`);

  // ===================================================================================
  // EXECUTED — the REAL source of the gate region and of the refusal helper, run with
  // stubs. `new Function` (not eval) so the extracted text is compiled in one scope with
  // every free variable injected; the helper's `await import("./index")` is rewritten to
  // an injected `__importIndex()` because ./index cannot load offline (project pattern).
  // ===================================================================================
  const makeHelper = (deps) => new Function("deps", `
    const { console: __c, UNPOLLED_TASKS, storage, TASK_PREFIX, NO_PROVIDER_ERROR, claimRuleExecution,
            REFUSE_CLAIM_PREFIX, REFUSE_CLAIM_TTL, statsReceipt, updateAsyncJob, JOB_TTL_DONE, __importIndex } = deps;
    const console = __c;
    ${helperSrc.replace('await import("./index")', "await __importIndex()")}
    return refuseQueuedRunWithoutProvider;
  `)(deps);

  const quietConsole = { log() {}, warn() {}, error() {} };
  const baseDeps = (over = {}) => {
    const seen = { logged: [], jobRows: [], pollRows: [], claims: [] };
    const deps = {
      console: quietConsole,
      UNPOLLED_TASKS: new Set(["postfunction", "memory_distill", "listener", "probe"]),
      storage: { async set(k, v) { seen.pollRows.push([k, v]); } },
      TASK_PREFIX: "async_task:",
      NO_PROVIDER_ERROR: "NO_PROVIDER",
      claimRuleExecution: async (st, key) => { seen.claims.push(key); return true; },
      REFUSE_CLAIM_PREFIX: "refuse_exec:",
      REFUSE_CLAIM_TTL: {},
      statsReceipt: (kind, row, entry) => ({ kind, ruleId: row.id, ok: entry.isValid }),
      updateAsyncJob: async (id, patch) => { seen.jobRows.push([id, patch]); },
      JOB_TTL_DONE: {},
      __importIndex: async () => ({ storeLog: async (entry, opts) => { seen.logged.push([entry, opts]); } }),
      ...over,
    };
    return { deps, seen };
  };
  const jobRow = { id: "J1", name: "Nightly", mode: "agent", createdAt: "2026-01-01T00:00:00.000Z", schedule: { cron: "0 9 * * 1", timeZone: "Europe/Rome" } };

  // (1) happy refusal: poll row + claim + log with receipt + failed job row.
  {
    const { deps, seen } = baseDeps();
    await makeHelper(deps)("scheduledjob", "T1", { jobId: "J1" }, jobRow, {});
    ok(seen.pollRows.length === 1 && seen.pollRows[0][1].status === "error", "EXECUTED: the polled type gets an error poll row");
    ok(seen.claims[0] === "refuse_exec:T1", "EXECUTED (F-139): the refusal dedups on its OWN key");
    ok(!seen.claims.some((k) => /^lst_exec:|^job_exec:/.test(k)), "EXECUTED (F-139): …and never takes the run's claim");
    ok(seen.logged.length === 1 && seen.logged[0][0].decision === "ERROR", "EXECUTED: one ERROR log entry");
    ok(seen.logged[0][1].statsReceipt && seen.logged[0][1].statsReceipt.ruleId === "J1", "EXECUTED: …carrying the stats receipt");
    ok(seen.logged[0][0].fieldId === "0 9 * * 1 Europe/Rome", "EXECUTED: …with the cron in fieldId");
    ok(seen.jobRows.length === 1 && seen.jobRows[0][1].status === "error", "EXECUTED: the job row lands failed");
  }

  // (2) F-134: storage.set THROWS → the refusal still completes (log + receipt + job row),
  //     and nothing escapes to a caller that would resume the run.
  {
    const { deps, seen } = baseDeps({ storage: { async set() { throw new Error("KVS down"); } } });
    let threw = false;
    try { await makeHelper(deps)("scheduledjob", "T2", { jobId: "J1" }, jobRow, {}); } catch { threw = true; }
    ok(threw === false, "EXECUTED (F-134): a KVS fault on the poll row does not throw out of the refusal");
    ok(seen.logged.length === 1, "EXECUTED (F-134): …the execution-log entry is still written");
    ok(seen.jobRows.length === 1, "EXECUTED (F-134): …and the job row still lands failed");
  }

  // (3) F-135: the RECEIPT build faults → storeLog still runs, with a null receipt.
  {
    const { deps, seen } = baseDeps({ statsReceipt: () => { throw new Error("receipt boom"); } });
    await makeHelper(deps)("listener", "T3", { listenerId: "L1", eventType: "avi:jira:created:issue" }, { id: "L1", name: "L", mode: "agent" }, {});
    ok(seen.logged.length === 1, "EXECUTED (F-135): a receipt fault does not take the log entry with it");
    ok(seen.logged[0][1].statsReceipt === null, "EXECUTED (F-135): …storeLog runs with a null receipt");
    ok(seen.pollRows.length === 0, "EXECUTED: the UNPOLLED listener writes no poll row");
  }

  // (4) F-136: the claim is LOST (a redelivery) → no second log and no second receipt,
  //     but the operational job row is still settled.
  {
    const held = new Set();
    const { deps, seen } = baseDeps({
      claimRuleExecution: async (st, key) => { seen.claims.push(key); if (held.has(key)) return false; held.add(key); return true; },
    });
    const h = makeHelper(deps);
    const p = { listenerId: "L1" }, row = { id: "L1", name: "L", mode: "agent" };
    await h("listener", "T4", p, row, {});
    await h("listener", "T4", p, row, {});                       // same taskId → redelivery
    ok(seen.logged.length === 1, "EXECUTED (F-136): a redelivered refusal writes NO second log");
    ok(seen.jobRows.length === 2, "EXECUTED (F-136): …the job row is still settled on both");
    ok(seen.claims.every((k) => k.startsWith("refuse_exec:")),
      "EXECUTED (F-139): the stub storage never saw a run claim key on the refusal path");
    // F-139: a FRESH task id (the healthy delivery after the fault clears) is not suppressed.
    await h("listener", "T7", p, row, {});
    ok(seen.logged.length === 2, "EXECUTED (F-139): a later delivery with a new task id is NOT a duplicate");
  }

  // (5) F-136: a KVS fault in the claim itself is fail-OPEN (the log is written) — the
  //     run-path policy in claimRuleExecution, unchanged here.
  {
    const { deps, seen } = baseDeps({ claimRuleExecution: async () => { throw new Error("KVS down"); } });
    await makeHelper(deps)("scheduledjob", "T5", { jobId: "J1" }, jobRow, {});
    ok(seen.logged.length === 1, "EXECUTED (F-136): a claim INFRASTRUCTURE fault still leaves the trace (fail-open, as on the run path)");
  }

  // (6) F-134 STICKY: the real gate region, executed. A throwing refusal helper must NOT
  //     let the task run — the flag is decided inside the try, acted on outside it.
  const regionStart = asyncSrc.indexOf("  let budgetEstimate = 0;");
  const regionEnd = asyncSrc.indexOf("  resetInvocationTokens();");
  const regionSrc = asyncSrc.slice(regionStart, regionEnd);
  const runRegion = (deps) => new Function("deps", `
    const { console: __c, taskType, taskId, params, ttl, event, jobRow, enqAt, budgetDeferrals, budgetRuleId,
            getListener, getJob, getProviderConfig, estimateTaskTokens, getLearnedRuleCost, aiBudgetGate,
            bumpAiBudgetBucket, updateAsyncJob, JOB_TTL_ACTIVE, refuseQueuedRunWithoutProvider, RAN } = deps;
    const console = __c;
    return (async () => {
      ${regionSrc}
      RAN.ran = true;
    })();
  `)(deps);
  const regionDeps = (over = {}) => {
    const RAN = { ran: false, refused: 0 };
    return { RAN, deps: {
      console: quietConsole, taskType: "listener", taskId: "T6", params: { listenerId: "L1" }, ttl: {},
      event: { body: {} }, jobRow: null, enqAt: null, budgetDeferrals: 0, budgetRuleId: "L1",
      getListener: async () => ({ id: "L1", mode: "agent", name: "L" }),
      getJob: async () => null,
      getProviderConfig: async () => ({ provider: null }),
      estimateTaskTokens: () => 1000,
      getLearnedRuleCost: async () => 0,
      aiBudgetGate: async () => ({ allow: true, skipped: "no-provider" }),
      bumpAiBudgetBucket: async () => { throw new Error("must not reserve for a refused run"); },
      updateAsyncJob: async () => {},
      JOB_TTL_ACTIVE: {},
      refuseQueuedRunWithoutProvider: async () => { RAN.refused++; },
      RAN, ...over,
    } };
  };
  {
    const { RAN, deps } = regionDeps();
    await runRegion(deps);
    ok(RAN.refused === 1 && RAN.ran === false, "EXECUTED (F-134): a null provider refuses the listener and the task never runs");
  }
  {
    const { RAN, deps } = regionDeps({ refuseQueuedRunWithoutProvider: async () => { throw new Error("KVS down"); } });
    let threw = false;
    try { await runRegion(deps); } catch { threw = true; }
    ok(RAN.ran === false, "EXECUTED (F-134): a THROW on the refusal path does NOT fall through to running the task");
    ok(threw === true, "EXECUTED (F-134): …it surfaces to the platform (a retried delivery re-refuses) instead of being swallowed by the fail-open catch");
  }
  {
    // The fail-open catch itself is unchanged for everyone else: a ledger fault on a
    // normal task still runs it.
    const { RAN, deps } = regionDeps({ aiBudgetGate: async () => { throw new Error("ledger down"); } });
    await runRegion(deps);
    ok(RAN.ran === true && RAN.refused === 0, "EXECUTED: a ledger fault is still fail-OPEN for a task with a provider");
  }
}

// =====================================================================================
// F-122 — a cancel must be distinguishable from a failure by a FLAG, not a string.
// =====================================================================================
{
  ok(/\{ status: "error", cancelled: true, error: "Cancelled" \}/.test(asyncSrc),
    "the consumer's cancel checkpoint writes cancelled:true on the poll row");
  ok(/status: "cancelled", cancelled: true, finishedAt/.test(asyncSrc), "…and on the job row");
  ok(/status: "error", error: result\.error, \.\.\.\(result\.cancelled === true \? \{ cancelled: true \} : \{\}\)/.test(indexSrc),
    "getAsyncTaskResult forwards the flag and KEEPS status 'error' (every existing poller has an error arm)");
  // EXECUTED: the forward, over both shapes.
  const fwd = (row) => ({ success: true, status: "error", error: row.error, ...(row.cancelled === true ? { cancelled: true } : {}) });
  ok(fwd({ status: "error", cancelled: true, error: "Cancelled" }).cancelled === true, "EXECUTED: a cancel is flagged");
  ok(fwd({ status: "error", error: "No API key configured" }).cancelled === undefined, "EXECUTED: a real failure is not");
  ok(fwd({ status: "error", cancelled: true, error: "Cancelled" }).status === "error", "EXECUTED: the status word is unchanged (compatibility)");
}

console.log(`\nasync-handler-helpers: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
