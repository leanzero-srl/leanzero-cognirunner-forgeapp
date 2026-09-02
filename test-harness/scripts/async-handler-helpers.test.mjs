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

const expectedHandlers = ["review", "postfunction", "codegen", "fixcode", "skilldistill", "memory_distill", "listener", "scheduledjob"];
for (const t of expectedHandlers) ok(handlerKeys.includes(t), `TASK_HANDLERS registers "${t}"`);
ok(handlerKeys.length === expectedHandlers.length, `TASK_HANDLERS has exactly ${expectedHandlers.length} task types (no orphans)`);
ok(UNPOLLED_TASKS.has("postfunction") && UNPOLLED_TASKS.has("memory_distill") && UNPOLLED_TASKS.has("listener") && UNPOLLED_TASKS.size === 3,
   "UNPOLLED_TASKS = { postfunction, memory_distill, listener } (scheduledjob is polled by Run now)");
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

console.log(`\nasync-handler-helpers: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
