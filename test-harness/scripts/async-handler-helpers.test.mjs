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
  ok((body.match(/failOpen: true/g) || []).length === 2,
    "both non-ok returns (provider error + probe throw) carry failOpen:true");
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
  ok((asyncSrc.match(/error: NO_PROVIDER_ERROR \}/g) || []).length === 5,
    "the five no-provider bails still return the one shared message constant");
}

console.log(`\nasync-handler-helpers: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
