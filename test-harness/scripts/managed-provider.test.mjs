/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Offline guard for the MANAGED ENGINE — "CogniRunner Cloud AI", provider id "managed"
// (plan §3.17, with the owner's 2026-09-14 decision that the LeanZero-managed key is an
// OPENROUTER key, not an Anthropic one).
//
// The managed engine is the only path in this app where LeanZero's OWN credential goes
// out on a tenant's behalf. Three things therefore have to be true forever, and each one
// has an assertion here rather than a comment:
//
//   1. THE KEY HAS ONE READER. `COGNIRUNNER_MANAGED_OPENROUTER_KEY` must appear in
//      exactly one function in src/. A second reader is how a resolver ends up returning
//      it, and no amount of care at the second site can be audited as cheaply as this
//      line can. The consumer gets it by IMPORT, never by a second env read.
//   2. NO RESOLVER RETURNS IT. Availability is a boolean plus a reason code — never a
//      prefix, a length or a mask, all of which are disclosure by instalments.
//   3. THE GATES ARE CHECKED BEFORE THE CALL, at BOTH seams. Queued work is the bulk of
//      the spend (F-089's lesson), so an edition/allowance check that lives only on the
//      synchronous path is no check at all.
//
// src/index.js and src/async-handler.js are mostly source-parsed here — the project's
// established pattern (see forge-llm-policy.test.mjs, async-handler-helpers.test.mjs) —
// and the pure modules are imported for real. F-544 added the third mode: where the claim
// is about what a resolver DOES rather than what it says, src/index.js is imported for
// real behind the @forge/* mocks (lib/register-mocks-index.mjs) and the resolver is
// CALLED. A source grep could not have caught F-544: it asserted a literal the file never
// contained, so it was green while the door it guarded was open.
// Auto-discovered by run-offline.mjs. Run: node scripts/managed-provider.test.mjs
import "../lib/register-mocks-index.mjs";
import kvs from "../lib/mock-kvs.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  agentCapability, agentCapabilityCopy, AGENT_CAPABILITY_REASONS, EDITION_IDS,
  MANAGED_PROVIDER_ID, MANAGED_PROVIDER_LABEL, MANAGED_DEFAULT_MODEL, MANAGED_MODELS,
  managedModelAllowed, clampManagedModel, ADVANCED_FEATURES, isFeatureAllowed,
} from "../../src/shared/edition.js";
import {
  METER_PROVIDERS, VENDOR_BILLED_PROVIDERS, MANAGED_USD_PER_M, managedCostUsd,
  normalizeUsage, emptyState, bumpCounters, summarizeState,
  vendorAllowanceStatus, forgeLlmAllowanceStatus, allowanceUsdForSeats,
} from "../../src/shared/usage-meter.js";
import { AI_PLATFORM_TPM, AI_BUDGET_DEFAULT_TPM, effectiveBudget } from "../../src/shared/ai-budget.js";
import { PROVIDER_IDS, providerKeySlot } from "../../src/shared/provider-slots.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(here, "../../src");
const indexSrc = readFileSync(path.join(srcDir, "index.js"), "utf8");
const asyncSrc = readFileSync(path.join(srcDir, "async-handler.js"), "utf8");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

// Strip full-line comments so a mention in prose can never satisfy — or trip — an
// assertion about the CODE.
const codeOnly = (s) => s.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
const indexCode = codeOnly(indexSrc);
const asyncCode = codeOnly(asyncSrc);

// =====================================================================================
// 1. The offer table — one home, exact ids
// =====================================================================================
ok(MANAGED_PROVIDER_ID === "managed", "the provider id is 'managed'");
ok(MANAGED_PROVIDER_LABEL === "CogniRunner Cloud AI", "the label a user sees is 'CogniRunner Cloud AI'");
ok(MANAGED_DEFAULT_MODEL === "anthropic/claude-sonnet-5", "Sonnet 5 is the DEFAULT");
ok(MANAGED_MODELS.length === 2 && MANAGED_MODELS.includes("anthropic/claude-opus-5"),
  "Opus 5 is the opt-in, and the offer is exactly two models");
ok(MANAGED_MODELS[0] === MANAGED_DEFAULT_MODEL, "the default is first in the offer");
ok(MANAGED_MODELS.every((id) => /^anthropic\//.test(id)),
  "the ids are OpenRouter-NAMESPACED — the engine is OpenRouter, not the Anthropic first-party API");
// Exact-id policy, in both directions, for the same reason FORGE_LLM_MODELS is exact:
// a substring rule cannot tell an entitled generation from an unentitled one.
ok(managedModelAllowed("anthropic/claude-sonnet-5") === true, "the default id is allowed");
ok(managedModelAllowed("anthropic/claude-opus-5") === true, "the opt-in id is allowed");
ok(managedModelAllowed("anthropic/claude-sonnet-4-6") === false, "an OLDER Sonnet is refused (exact ids, not a family match)");
ok(managedModelAllowed("claude-sonnet-5") === false, "the un-namespaced id is refused — it is not what OpenRouter routes");
ok(managedModelAllowed("openai/gpt-5.4") === false, "another vendor's id is refused");
ok(managedModelAllowed("") === false && managedModelAllowed(null) === false && managedModelAllowed(undefined) === false,
  "empty / null / undefined are refused");
// The clamp is a BILLING BACKSTOP: it never throws, it lands on the cheapest offered model.
ok(clampManagedModel("anthropic/claude-opus-5") === "anthropic/claude-opus-5", "an allowed id survives the clamp");
ok(clampManagedModel("anthropic/claude-opus-9") === MANAGED_DEFAULT_MODEL, "an unknown id clamps to Sonnet 5");
ok(clampManagedModel(null) === MANAGED_DEFAULT_MODEL, "null clamps to Sonnet 5 rather than throwing");
ok(clampManagedModel({ evil: true }) === MANAGED_DEFAULT_MODEL, "a non-string clamps to Sonnet 5");

// The engine is a CODER entitlement, expressed as a feature row so checkLicense and the
// upgrade refusal both name it without a second list.
ok(ADVANCED_FEATURES.some((f) => f.id === "managed-cloud-ai"), "the managed engine is an ADVANCED_FEATURES row");
ok(isFeatureAllowed(EDITION_IDS.ADVANCED, "managed-cloud-ai") === true, "the feature is allowed on Coder");
ok(isFeatureAllowed(EDITION_IDS.STANDARD, "managed-cloud-ai") === false, "the feature is refused on Standard");

// =====================================================================================
// 2. agentCapability — the edition table (THE gate the whole offer rests on)
// =====================================================================================
{
  const std = agentCapability({ provider: MANAGED_PROVIDER_ID, edition: EDITION_IDS.STANDARD });
  ok(std.enabled === false && std.reason === "needs-coder-edition",
    "STANDARD is REFUSED with needs-coder-edition");
  const adv = agentCapability({ provider: MANAGED_PROVIDER_ID, edition: EDITION_IDS.ADVANCED });
  ok(adv.enabled === true && adv.reason === "managed", "ADVANCED is ALLOWED with reason 'managed'");
  // The managed engine must never be mistaken for BYOK: BYOK is "not our money, not our
  // business", and that answer on this provider would hand LeanZero's key to a Standard
  // tenant with no gate at all.
  ok(adv.reason !== "byok" && std.reason !== "byok", "the managed engine is NEVER answered as byok");
  // An unknown/absent edition is Standard's answer, not advanced's — a failed edition read
  // must not buy the vendor's engine.
  ok(agentCapability({ provider: MANAGED_PROVIDER_ID }).reason === "needs-coder-edition",
    "no edition supplied → refused (a failed read never grants the vendor's engine)");
  ok(agentCapability({ provider: MANAGED_PROVIDER_ID, edition: "advanced " }).reason === "needs-coder-edition",
    "a near-miss edition string is refused — the comparison is exact");
}
// The key-missing refusal, and the deliberate `undefined` fall-through that lets the
// plain agentCapability({provider, edition}) shape keep working.
{
  const missing = agentCapability({ provider: MANAGED_PROVIDER_ID, edition: EDITION_IDS.ADVANCED, managedKeyPresent: false });
  ok(missing.enabled === false && missing.reason === "managed-key-missing",
    "key absent → refused, LOUDLY, with reason managed-key-missing");
  ok(agentCapability({ provider: MANAGED_PROVIDER_ID, edition: EDITION_IDS.STANDARD, managedKeyPresent: false }).reason === "managed-key-missing",
    "key absent WINS over the edition — a vendor outage is not fixed by upgrading, so we do not say it is");
  ok(agentCapability({ provider: MANAGED_PROVIDER_ID, edition: EDITION_IDS.ADVANCED, managedKeyPresent: undefined }).reason === "managed",
    "managedKeyPresent UNDEFINED means 'not asked' and falls through — every existing caller keeps its answer");
  ok(agentCapability({ provider: MANAGED_PROVIDER_ID, edition: EDITION_IDS.ADVANCED, managedKeyPresent: true }).reason === "managed",
    "key present → enabled");
}
// The allowance arm — the SAME hard cap Forge LLM hits.
{
  const hard = agentCapability({ provider: MANAGED_PROVIDER_ID, edition: EDITION_IDS.ADVANCED, allowanceLevel: "hard", managedKeyPresent: true });
  ok(hard.enabled === false && hard.reason === "allowance-exhausted",
    "a HARD allowance PAUSES the managed engine with the same reason code Forge LLM uses");
  ok(agentCapability({ provider: MANAGED_PROVIDER_ID, edition: EDITION_IDS.ADVANCED, allowanceLevel: "soft", managedKeyPresent: true }).enabled === true,
    "a SOFT allowance (80%) warns but does not pause");
  ok(agentCapability({ provider: MANAGED_PROVIDER_ID, edition: EDITION_IDS.ADVANCED, allowanceLevel: null, managedKeyPresent: true }).enabled === true,
    "an UNKNOWN allowance never pauses — 'no ceiling known' is not 'exhausted'");
}
// Nothing about the other providers moved.
ok(agentCapability({ provider: "openai" }).reason === "byok", "a BYOK provider is still byok");
ok(agentCapability({ provider: "atlassian", edition: EDITION_IDS.STANDARD }).reason === "needs-coder-edition", "Forge LLM on Standard is unchanged");
ok(agentCapability({ provider: "atlassian", edition: EDITION_IDS.ADVANCED, agentModel: "claude-sonnet-5" }).reason === "forge-frontier", "Forge LLM frontier is unchanged");

// Every reason the predicate can emit has a SENTENCE — the four surfaces must not invent
// their own wording (the defect this repo is named for).
for (const r of ["managed", "managed-key-missing", "managed-disabled"]) {
  ok(!!AGENT_CAPABILITY_REASONS[r], `AGENT_CAPABILITY_REASONS has a row for "${r}"`);
  const copy = agentCapabilityCopy(r);
  ok(copy && copy.title && copy.remedy && copy !== AGENT_CAPABILITY_REASONS.unknown,
    `agentCapabilityCopy("${r}") is a real row, not the unknown fallback`);
}
ok(agentCapabilityCopy("managed-key-missing").remedy.includes("LeanZero"),
  "the key-missing remedy says WHOSE problem it is, so nobody hunts a setting that does not exist");

// =====================================================================================
// 3. THE KEY HAS EXACTLY ONE READER  ← the assertion this file exists for
// =====================================================================================
{
  const ENV = "COGNIRUNNER_MANAGED_OPENROUTER_KEY";
  // Counted in CODE (full-line comments stripped): a doc comment that EXPLAINS the
  // variable is not a reader, but a commented-out second reader would still be one line
  // of code away, so the count is over every backend module, not just index.js.
  const files = ["index.js", "async-handler.js", "skills.js", "memories.js", "agent-runner.js", "coder-engine.js",
    "listeners.js", "scheduled-jobs.js", "rules-api.js", "virtual-admin.js", "va-admin.js", "git-connections.js"];
  let total = 0;
  const named = [];
  for (const f of files) {
    let src = "";
    try { src = readFileSync(path.join(srcDir, f), "utf8"); } catch (e) { continue; }
    const n = (codeOnly(src).match(new RegExp(ENV, "g")) || []).length;
    total += n;
    if (n > 0) named.push(`${f}:${n}`);
  }
  // ONE: the declaration of the constant. The reader uses the constant, and nothing else
  // in the backend ever spells the variable out.
  ok(total === 1, `the env var name appears ONCE in backend CODE (found ${total} in ${named.join(", ") || "nothing"}) — one reader, by construction`);
  ok(named.length === 1 && named[0].startsWith("index.js"), "…and that one occurrence is in src/index.js");
  ok(/const MANAGED_KEY_ENV = "COGNIRUNNER_MANAGED_OPENROUTER_KEY";/.test(indexSrc),
    "…as the single named constant the reader dereferences");
  ok(!new RegExp(ENV).test(asyncSrc),
    "the async consumer NEVER reads the env var itself — it imports managedKeyForConsumer");
  ok(/managedKeyForConsumer/.test(asyncSrc), "…and it does import it");
  // A shared module bundles into three webpack builds; an env read there is a build-time
  // inlining risk, i.e. the key shipped to a browser.
  for (const f of ["edition.js", "usage-meter.js", "ai-budget.js", "provider-slots.js", "agent-actions.js"]) {
    const s = readFileSync(path.join(srcDir, "shared", f), "utf8");
    // The REAL property: a shared module must not read the environment AT ALL. These
    // bundle into three webpack builds, where an env read can be inlined at build time —
    // i.e. the credential shipped to a browser. (edition.js NAMES the kill switch in a
    // doc comment, which is prose about a reason code, not a read.)
    ok(!new RegExp(ENV).test(s), `src/shared/${f} never names the KEY env var`);
    ok(!/process\.env/.test(codeOnly(s)), `src/shared/${f} reads no environment variable at all`);
  }
}
{
  // The reader itself: the kill switch is checked FIRST, and the result is trimmed.
  const m = indexSrc.match(/const readManagedKey = \(\) => \{[\s\S]*?\n\};/);
  ok(!!m, "found readManagedKey");
  const b = m ? m[0] : "";
  ok(/MANAGED_DISABLED_ENV/.test(b), "the KILL SWITCH is consulted inside the reader, so nothing can route around it");
  ok(b.indexOf("MANAGED_DISABLED_ENV") < b.indexOf("MANAGED_KEY_ENV"),
    "the kill switch is checked BEFORE the key — a killed deployment answers null even with a valid key");
  ok(/\.trim\(\)/.test(b), "the value is trimmed (a stray newline in a Forge variable is otherwise a 401)");
  ok(/return key \|\| null/.test(b), "an empty value is null, never the empty string");
  ok(!/console\.(log|warn|error)/.test(b), "the reader logs NOTHING — a log line is a leak");
}
{
  // The status accessor: reason codes only.
  const m = indexSrc.match(/export const managedCloudStatus = \(\) => \{[\s\S]*?\n\};/);
  ok(!!m, "found managedCloudStatus");
  const b = m ? m[0] : "";
  ok(/available: true, reason: "managed"/.test(b), "available → { available:true, reason:'managed' }");
  ok(/reason: "managed-key-missing"/.test(b), "no key → reason managed-key-missing");
  ok(/reason: "managed-disabled"/.test(b), "the kill switch has its OWN reason, distinct from a broken deployment");
  ok(!/key\b.*slice|substring|length/.test(b), "it returns no prefix, no length, no mask — a boolean and a code");
}

// =====================================================================================
// 4. NO RESOLVER RETURNS THE KEY
// =====================================================================================
{
  // Every resolver body in index.js, checked for the two accessors that hold the secret.
  const bodies = indexSrc.match(/resolver\.define\("[^"]+",[\s\S]*?\n\}\);/g) || [];
  ok(bodies.length > 20, `found ${bodies.length} resolver bodies to audit`);
  const offenders = [];
  for (const b of bodies) {
    const name = (b.match(/resolver\.define\("([^"]+)"/) || [, "?"])[1];
    if (/readManagedKey\s*\(/.test(b) || /managedKeyForConsumer\s*\(/.test(b)) offenders.push(name);
  }
  ok(offenders.length === 0, `NO resolver calls a managed-key accessor (offenders: ${offenders.join(", ") || "none"})`);
  // getProvider is the one that reports availability — assert the SHAPE it reports.
  const gp = (indexSrc.match(/resolver\.define\("getProvider",[\s\S]*?\n\}\);/) || [, ""])[0] || "";
  ok(/managedCloudStatus\(\)/.test(gp), "getProvider asks managedCloudStatus (the safe accessor)");
  ok(/managedAvailable: managed\.available/.test(gp), "getProvider reports managedAvailable as a BOOLEAN");
  ok(/managedReason: managed\.reason/.test(gp), "…and a reason code, so the picker can say WHY the row is dark");
  ok(!/readManagedKey/.test(gp), "getProvider never touches the raw reader");
}
{
  // The managed engine has no KVS key slot in use, and nothing writes one.
  ok(PROVIDER_IDS.includes("managed"), "PROVIDER_IDS carries 'managed' (it IS a provider id)");
  ok(providerKeySlot("managed") === "COGNIRUNNER_KEY_managed", "the slot NAME exists for uniformity…");
  // F-544 — what stood here was `ok(!/storage\.set\(providerKeySlot\("managed"\)/…)`:
  // a grep for a literal src/index.js has never contained. The write is
  // `storage.set(providerKeySlot(provider), key)` with `provider` taken from the PAYLOAD,
  // so the pattern could not match whether the door was open or shut — and it was open.
  // The invariant is BEHAVIOURAL, so it is proved by calling the door and counting the
  // writes the mock store actually receives.
  const { handler } = await import("../../src/index.js");
  const ADMIN = "acct-managed-admin";
  await kvs.set("app_admins", [{ accountId: ADMIN, role: "admin", scope: "all" }]);
  const call = (functionKey, payload = {}) =>
    handler({ call: { functionKey, payload }, context: {} }, { principal: { accountId: ADMIN } });

  // Count every write aimed at the managed slot, so a write-then-delete cannot pass either.
  const slot = providerKeySlot("managed");
  const realSet = kvs.set.bind(kvs);
  let managedWrites = 0;
  kvs.set = async (key, value, options) => { if (key === slot) managedWrites++; return realSet(key, value, options); };
  let saved, status;
  try {
    saved = await call("saveOpenAIKey", { provider: "managed", key: "sk-or-v1-000000000000000000000000" });
    status = await call("getOpenAIKey", { provider: "managed" });
  } finally {
    kvs.set = realSet;
  }
  ok(saved && saved.success === false,
    `saveOpenAIKey REFUSES provider "managed" at the door (got ${JSON.stringify(saved).slice(0, 200)})`);
  ok(saved && saved.reason === "managed-has-no-key",
    "…with a reason code, so the panel can say WHY instead of guessing from prose");
  ok(managedWrites === 0, `…and the KVS slot is never written (writes seen: ${managedWrites})`);
  ok(kvs.__raw(slot) === undefined, "…so COGNIRUNNER_KEY_managed stays empty — the credential is never in KVS");
  ok(status && status.success === true && status.hasKey === false && status.isByok === false && status.managed === true,
    `getOpenAIKey answers hasKey:false, isByok:false, managed:true (got ${JSON.stringify(status).slice(0, 200)})`);
}

// =====================================================================================
// 5. The gates run BEFORE the call, at BOTH seams
// =====================================================================================
{
  // The synchronous adapter.
  const i = indexCode.indexOf("const callAIChatRaw = async (opts) => {");
  ok(i > 0, "found callAIChatRaw");
  const b = indexCode.slice(i, i + 6000);
  const gate = b.indexOf("managedCloudStatus()");
  const fetchAt = b.indexOf("await fetch(");
  ok(gate > 0, "callAIChatRaw gates the managed engine");
  ok(fetchAt > 0 && gate < fetchAt, "the gate is BEFORE the request goes out, not after");
  ok(/needs-coder-edition/.test(b), "the adapter refuses a non-Coder tenant (a DOWNGRADE keeps the saved provider — F-089)");
  ok(/allowance-exhausted/.test(b), "the adapter refuses on an exhausted allowance");
  ok(/return \{ ok: false/.test(b.slice(gate, gate + 1200)),
    "a refusal is ok:false, never a throw — a validator on this provider still fails OPEN (LAW 3)");
  ok(/outboundKey = readManagedKey\(\)/.test(b),
    "the credential is TAKEN from the reader, never accepted from the caller's apiKey");
  ok(/model = clampManagedModel\(requestedModel\)/.test(b), "the model is clamped SERVER-SIDE before the call");
  ok(/PROVIDER_OPENROUTER_BASE_URL\}\/chat\/completions/.test(b),
    "the managed endpoint is PINNED — the admin's COGNIRUNNER_AI_BASE_URL cannot redirect LeanZero's key");
}
{
  // The async consumer — the seam that spends the most.
  const i = asyncCode.indexOf("const callAIChatSimpleRaw = async");
  ok(i > 0, "found callAIChatSimpleRaw");
  const b = asyncCode.slice(i, i + 7000);
  const gate = b.indexOf("managedCloudStatus()");
  ok(gate > 0, "the consumer gates the managed engine too (queued work is the bulk of the spend — F-089)");
  ok(/needs-coder-edition/.test(b) && /allowance-exhausted/.test(b), "…with the same two refusals");
  ok(/currentEditionFresh\(\)/.test(b.slice(gate, gate + 1500)),
    "the consumer reads the edition FRESH — it caches nothing, and a memo here would outlive a downgrade");
  ok(/readForgeLlmAllowance\(\)/.test(b.slice(gate, gate + 1500)),
    "…and the allowance fresh, from the same one home");
  ok(/baseUrl = PROVIDER_OPENROUTER_BASE_URL/.test(b), "the consumer pins the endpoint to the same literal");
  ok(/model = clampManagedModel\(model\)/.test(b), "…and applies the same model clamp");
  ok(/managedKey = managedKeyForConsumer\(\)/.test(b), "…and takes the credential from the imported reader");
}

// =====================================================================================
// 6. Prompt caching — cache_control on anthropic/* ONLY, and the usage that comes back
// =====================================================================================
{
  const m = indexSrc.match(/const markOpenRouterCacheBreakpoints = \(messages, prefixCount, turnCount\) => \{[\s\S]*?\n\};/);
  ok(!!m, "found markOpenRouterCacheBreakpoints");
  const mb = indexSrc.match(/const markCacheBreakpoint = \(msg\) => \{[\s\S]*?\n\};/);
  ok(!!mb, "found markCacheBreakpoint");
  // F-641: the placement rule lives in ONE helper both adapters read. Pull it in with the
  // marker, or this test would be exercising a copy of a rule that has a single home.
  const mi = indexSrc.match(/const cacheBreakpointIndices = \(\{ messages, boundaries[\s\S]*?\n\};/);
  ok(!!mi, "found cacheBreakpointIndices (the ONE placement helper)");
  // F-643: markability has ONE definition, shared by the placement helper and the emitter.
  const mp = indexSrc.match(/const canCarryCacheBreakpoint = \(msg\) => \{[\s\S]*?\n\};/);
  ok(!!mp, "found canCarryCacheBreakpoint (the ONE markability predicate)");
  const pred = "const canCarryCacheBreakpoint = " + mp[0].replace("const canCarryCacheBreakpoint = ", "").replace(/;\s*$/, "") + ";\n";
  // eslint-disable-next-line no-eval
  const markCacheBreakpoint = eval("(function(){ " + pred + "return " + mb[0].replace("const markCacheBreakpoint = ", "").replace(/;\s*$/, "") + "; })()");
  // eslint-disable-next-line no-eval
  const markRaw = eval(
    "(function(){ " + pred
    + "const markCacheBreakpoint = " + mb[0].replace("const markCacheBreakpoint = ", "").replace(/;\s*$/, "") + ";\n"
    + "const cacheBreakpointIndices = " + mi[0].replace("const cacheBreakpointIndices = ", "").replace(/;\s*$/, "") + ";\n"
    + "return " + m[0].replace("const markOpenRouterCacheBreakpoints = ", "").replace(/;\s*$/, "") + "; })()");
  // The marker now returns { messages, marks } — the COUNT rides out so a zero-cache-read
  // turn can name "no mark was emitted" as its cause (F-643). Most cases here read the array.
  const mark = (...a) => markRaw(...a).messages;

  const sys = { role: "system", content: "RULES" };
  const u1 = { role: "user", content: "one" };
  const u2 = { role: "user", content: "two" };
  const msgs = [sys, u1, u2];

  const out = mark(msgs, 2);
  ok(out !== msgs, "a NEW array comes back");
  ok(msgs[0].content === "RULES" && typeof msgs[0].content === "string",
    "the CALLER's messages are never mutated — the same array is re-sent every round and markers must not compound");
  ok(Array.isArray(out[0].content) && out[0].content[0].cache_control.type === "ephemeral",
    "the system message carries an ephemeral cache_control breakpoint");
  ok(Array.isArray(out[1].content) && out[1].content[0].cache_control.type === "ephemeral",
    "the last message of the declared prefix carries one too");
  ok(out[2] === u2, "nothing OUTSIDE the declared prefix is marked (volatile content must stay uncached)");
  // At most two breakpoints; OpenRouter's documented limit is four.
  ok(out.filter((mm) => Array.isArray(mm.content) && mm.content.some((p) => p && p.cache_control)).length <= 2,
    "at most TWO breakpoints are emitted (OpenRouter allows four; the rest stay in reserve)");
  // Degenerate inputs never throw and never corrupt the conversation.
  ok(mark([], 3).length === 0, "an empty array is returned untouched");
  ok(mark(msgs, 0) === msgs, "prefixCount 0 → the array is returned AS IS (opt-in, off by default)");
  ok(mark(msgs, 99).length === 3, "an over-declared prefix is clamped to the array length, never an index error");
  const toolOnly = markCacheBreakpoint({ role: "assistant", content: null, tool_calls: [{ id: "1" }] });
  ok(toolOnly.content === null, "a tool-call-only assistant turn is left ALONE — there is nothing to cache");
  const parts = markCacheBreakpoint({ role: "user", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] });
  ok(parts.content[0].cache_control === undefined && parts.content[1].cache_control.type === "ephemeral",
    "with parts content, only the LAST block carries the marker");

  /* F-641 - the SECOND boundary. `prefixCount` is the cross-turn span (the end of the
   * stored history); `turnCount` is everything seeded for this turn's rounds. Declaring
   * only the first moved the within-turn mark off the user's turn, so rounds 2..N of the
   * same turn re-billed the fenced issue context at full price - and on a FIRST turn,
   * where the cross-turn prefix is the system messages alone, there was no within-turn
   * mark left anywhere. */
  const markedAt = (arr) => arr
    .map((mm, i) => (Array.isArray(mm.content) && mm.content.some((pp) => pp && pp.cache_control) ? i : -1))
    .filter((i) => i >= 0);
  {
    const sys2 = { role: "system", content: "knowledge" };
    const hist = { role: "assistant", content: "turn 1 answer" };
    const add = { role: "system", content: "added this turn" };
    const turn = { role: "user", content: "turn 2 words" };
    const full = [sys, u1, hist, add, turn];
    const out2 = mark(full, 3, 5);
    ok(JSON.stringify(markedAt(out2)) === "[0,2,4]",
      `THE FINDING: the system mark, the CROSS-TURN mark at the end of the history and the WITHIN-TURN mark on this turn's words, got ${JSON.stringify(markedAt(out2))}`);
    ok(markedAt(out2).length <= 4, "still inside OpenRouter's cap of four breakpoints");
    // Turn 1: no history, so the cross-turn prefix is system messages only and the user
    // turn is the ONLY message a within-turn mark can sit on.
    const first = [sys, sys2, turn];
    ok(JSON.stringify(markedAt(mark(first, 2, 3))) === "[1,2]",
      `turn 1 keeps a mark on the user's turn as well as on the system prefix, got ${JSON.stringify(markedAt(mark(first, 2, 3)))}`);
    // A caller that declares one boundary emits exactly what it emitted before F-641.
    ok(JSON.stringify(markedAt(mark(full, 3))) === JSON.stringify(markedAt(mark(full, 3, 3))),
      "one declared boundary == two coinciding boundaries == the pre-F-641 placement");
    ok(JSON.stringify(markedAt(mark(msgs, 2))) === "[0,1]", "and the original two-message case is untouched");

    /* F-643 - an EMPTY assistant turn at the tail of the stored history cannot carry a
     * marker, and the emitter used to DROP the cross-turn mark rather than walk back to a
     * message that can. Before the cut this array marked [1,4] - index 3, the declared
     * cross-turn boundary, went out with no breakpoint at all and every later turn of the
     * thread re-billed the whole history. */
    const empty = { role: "assistant", content: "" };
    const withEmptyTail = [sys, u1, empty, turn];
    const outEmpty = markRaw(withEmptyTail, 3, 4);
    ok(JSON.stringify(markedAt(outEmpty.messages)) === "[0,1,3]",
      `THE FINDING: the cross-turn mark walks back onto the last markable message, got ${JSON.stringify(markedAt(outEmpty.messages))}`);
    ok(outEmpty.marks === 3, `the emitted-mark count rides out with the array, got ${outEmpty.marks}`);
    ok(outEmpty.messages[2] === empty, "the empty turn itself is left exactly as it was");
    // Control: the same array with prose in the assistant turn marks the tail itself.
    ok(JSON.stringify(markedAt(mark([sys, u1, { role: "assistant", content: "answer" }, turn], 3, 4))) === "[0,2,3]",
      "control: a non-empty tail keeps the cross-turn mark on itself");
    ok(markRaw([sys], 0).marks === 0, "an opt-out caller reports 0 emitted marks");
  }
}
{
  // The call site: anthropic/* only, openrouter + managed only, opt-in only.
  const i = indexCode.indexOf("markOpenRouterCacheBreakpoints(outboundMessages");
  ok(i > 0, "the adapter calls the marker");
  const cond = indexCode.slice(Math.max(0, i - 400), i);
  ok(/\^anthropic\\\//.test(cond), "cache_control is applied ONLY to anthropic/* model ids");
  ok(/provider === "openrouter"/.test(cond) && /MANAGED_PROVIDER_ID/.test(cond),
    "…on the OpenRouter adapter and its managed twin — one rule, both");
  ok(/Number\(cachePrefix\) > 0/.test(cond), "…and ONLY when the caller opted in with cachePrefix");
  const body = indexCode.slice(i, i + 400);
  ok(/requestBody = \{ model/.test(body), "the marking happens BEFORE the body is built");
}
{
  // The usage that comes back. OpenRouter's field names, confirmed against
  // https://openrouter.ai/docs/features/prompt-caching (read 2026-09-13):
  //   usage.prompt_tokens_details.cached_tokens      — read from cache
  //   usage.prompt_tokens_details.cache_write_tokens — written to cache
  // Both are SUBSETS of prompt_tokens (the OpenAI semantics).
  const u = normalizeUsage({
    prompt_tokens: 10000, completion_tokens: 500, total_tokens: 10500,
    prompt_tokens_details: { cached_tokens: 7000, cache_write_tokens: 1200 },
  });
  ok(u.cacheRead === 7000, "an OpenRouter cache READ is recorded (prompt_tokens_details.cached_tokens)");
  ok(u.cacheCreation === 1200, "an OpenRouter cache WRITE is recorded (prompt_tokens_details.cache_write_tokens)");
  ok(u.prompt === 10000, "…and the PACED figure (prompt) is untouched — the counters are subsets, not additions");
  ok(u.total === 10500, "the total is the reported total");
}

// =====================================================================================
// 7. A MOCKED OpenRouter round trip — the whole managed path, end to end
// =====================================================================================
{
  // A response exactly shaped like OpenRouter's, with cache activity, flowing through the
  // two pure stages the backend uses: normalizeUsage → bumpCounters. This is the property
  // "a cached managed call is metered, costed and counted", asserted on real numbers.
  const openRouterResponse = {
    id: "gen-abc",
    model: "anthropic/claude-sonnet-5",
    choices: [{ index: 0, message: { role: "assistant", content: "{\"ok\":true}" }, finish_reason: "stop" }],
    usage: {
      prompt_tokens: 20000,
      completion_tokens: 1500,
      total_tokens: 21500,
      prompt_tokens_details: { cached_tokens: 14000, cache_write_tokens: 0 },
      cache_discount: 0.0187,
    },
  };
  const usage = normalizeUsage(openRouterResponse.usage);
  ok(usage.cacheRead === 14000, "round trip: the cached tokens are read off the response");
  const cost = managedCostUsd("sonnet", usage.prompt, usage.completion, usage.cacheRead, usage.cacheCreation);
  // 6000 full @ $2/M + 14000 read @ $0.2/M + 1500 out @ $10/M = 0.012 + 0.0028 + 0.015
  ok(Math.abs(cost - 0.0298) < 1e-9, `round trip: the cache-aware cost is $0.0298 (got ${cost})`);
  // And the same call priced as though nothing were cached, to prove caching is the lever:
  const uncached = managedCostUsd("sonnet", usage.prompt, usage.completion, 0, 0);
  ok(uncached > cost, "a cached call costs LESS than the same call uncached (the whole point of §3.17's prompt caching)");

  const state = bumpCounters(emptyState(), {
    provider: "managed", usage, nowMs: Date.UTC(2026, 8, 13), model: openRouterResponse.model,
  });
  const s = summarizeState(state, Date.UTC(2026, 8, 13));
  ok(s.month.byProvider.managed.calls === 1, "round trip: the call lands under byProvider.managed");
  ok(s.month.managed.byTier.sonnet.calls === 1, "round trip: …and in month.managed's SONNET tier");
  ok(s.month.managed.byTier.sonnet.prompt === 20000, "round trip: the tier carries the prompt tokens");
  ok(Math.abs(s.month.managed.estUsd - cost) < 1e-9, "round trip: month.managed.estUsd holds the cache-aware cost");
  ok(s.month.cacheReadTokens === 14000, "round trip: the month's cache-read counter moved");
  ok(s.month.forgeLlm.estUsd === 0, "round trip: the Forge LLM bucket is UNTOUCHED — the two engines stay distinguishable");
}

// =====================================================================================
// 8. The usage meter rows and the ONE allowance
// =====================================================================================
ok(METER_PROVIDERS.includes("managed"), "'managed' is a metered provider (byProvider is a CLAMPED set — an absent id becomes 'other')");
ok(VENDOR_BILLED_PROVIDERS.length === 2 && VENDOR_BILLED_PROVIDERS.includes("atlassian") && VENDOR_BILLED_PROVIDERS.includes("managed"),
  "VENDOR_BILLED_PROVIDERS is exactly { atlassian, managed } — the two engines on LeanZero's bill");
ok(!VENDOR_BILLED_PROVIDERS.includes("openrouter"),
  "BYOK OpenRouter is NOT vendor-billed — the same endpoint, a different wallet");
ok(MANAGED_USD_PER_M.sonnet.in === 2 && MANAGED_USD_PER_M.sonnet.out === 10, "Sonnet 5 is rated $2/$10 per 1M (plan §3.17)");
ok(MANAGED_USD_PER_M.opus.in === 5 && MANAGED_USD_PER_M.opus.out === 25, "Opus 5 is rated $5/$25 per 1M");
ok(managedCostUsd("not-a-tier", 1e6, 1e6) === 0, "an unknown tier costs 0 — never a guess upward");
{
  // The cache counters are SUBSETS: a call that is 100% cache-read must not be priced as
  // if it were also 100% full-rate input.
  const allCached = managedCostUsd("sonnet", 1000, 0, 1000, 0);
  ok(Math.abs(allCached - (1000 * 0.1 * 2) / 1e6) < 1e-12,
    "a fully-cached prompt is priced at the 0.1x read rate ONLY — no double count");
  const overClaimed = managedCostUsd("sonnet", 100, 0, 9999, 0);
  ok(overClaimed <= managedCostUsd("sonnet", 100, 0, 0, 0),
    "a cache counter LARGER than prompt_tokens is clamped, never negative full-rate input");
}
{
  // ONE allowance over BOTH engines. Spending it twice is the defect this guards.
  const now = Date.UTC(2026, 8, 13);
  let st = emptyState();
  st = bumpCounters(st, { provider: "atlassian", usage: normalizeUsage({ prompt_tokens: 1e6, completion_tokens: 0 }), nowMs: now, model: "claude-sonnet-5" });
  st = bumpCounters(st, { provider: "managed", usage: normalizeUsage({ prompt_tokens: 1e6, completion_tokens: 0 }), nowMs: now, model: "anthropic/claude-sonnet-5" });
  const v = vendorAllowanceStatus(st, 10, now);
  // Forge LLM sonnet in = $3/M, managed sonnet in = $2/M → $5 of a $10 allowance.
  ok(Math.abs(v.estUsd - 5) < 1e-9, `the allowance counts BOTH engines' spend (got ${v.estUsd})`);
  ok(Math.abs(v.byEngine.forgeLlm - 3) < 1e-9 && Math.abs(v.byEngine.managed - 2) < 1e-9,
    "…and still reports them apart in byEngine, so a panel can say where the money went");
  ok(Math.abs(v.pct - 0.5) < 1e-9 && v.level === "ok", "50% of the allowance is 'ok'");
  ok(vendorAllowanceStatus(st, 6, now).level === "soft", "past 80% it is 'soft'");
  ok(vendorAllowanceStatus(st, 5, now).level === "hard", "at 100% it is 'hard' — which pauses the agent surfaces");
  ok(vendorAllowanceStatus(st, 0, now).level === "ok" && vendorAllowanceStatus(st, null, now).level === "ok",
    "an UNKNOWN allowance is never 'hard' — a ceiling nobody read must not pause the product");
  ok(forgeLlmAllowanceStatus === vendorAllowanceStatus,
    "forgeLlmAllowanceStatus IS vendorAllowanceStatus — an alias, not a second maths (one home)");
  ok(Math.abs(allowanceUsdForSeats(50) - 100) < 1e-9, "the seat-scaled allowance is unchanged by any of this");
}

// =====================================================================================
// 9. The token budget rows
// =====================================================================================
ok(AI_PLATFORM_TPM.managed === 200000, "the managed platform ceiling is the 200k placeholder (set after probe (g))");
ok(AI_BUDGET_DEFAULT_TPM.managed === 140000, "the default queue budget leaves the same 30% validator headroom Forge LLM keeps");
ok(AI_BUDGET_DEFAULT_TPM.managed < AI_PLATFORM_TPM.managed,
  "the QUEUE budget is strictly under the PLATFORM ceiling — that gap IS the validator headroom");
ok(AI_PLATFORM_TPM.atlassian === 50000 && AI_BUDGET_DEFAULT_TPM.atlassian === 35000, "the Forge LLM rows are untouched");
ok(effectiveBudget("managed", null) === 140000, "with no admin setting, managed paces at the default");
ok(effectiveBudget("managed", { tokensPerMinute: { managed: 0 } }) === 0, "an explicit 0 turns pacing OFF, as for every provider");
ok(effectiveBudget("managed", { tokensPerMinute: { managed: 1000 } }) === 1000, "an explicit value wins");
ok(effectiveBudget("openai", null) === 0, "BYOK still defaults to no budget");
// The comment that says the 200k is provisional must survive — a number with no
// provenance is the thing that gets 'cleaned up' into a wrong one.
ok(/probe \(g\)/.test(readFileSync(path.join(srcDir, "shared/ai-budget.js"), "utf8")),
  "the ai-budget row still names the probe its number is waiting on");

// =====================================================================================
// 10. The save doors
// =====================================================================================
{
  const sp = (indexSrc.match(/resolver\.define\("saveProvider",[\s\S]*?\n\}\);/) || [, ""])[0] || "";
  ok(/provider === MANAGED_PROVIDER_ID/.test(sp), "saveProvider has a managed arm");
  ok(/managedCloudStatus\(\)/.test(sp), "…which refuses when the deployment has no managed engine");
  ok(/upgradeRequired\("managed-cloud-ai"\)/.test(sp), "…and returns the UPGRADE refusal on Standard, not a flat error");
  const gate = sp.indexOf("provider === MANAGED_PROVIDER_ID");
  const write = sp.indexOf('storage.set("COGNIRUNNER_AI_PROVIDER"');
  ok(gate > 0 && write > 0 && gate < write,
    "the gates are checked BEFORE the activation write — a refused save must not leave 'managed' active");
}
{
  const sm = (indexSrc.match(/resolver\.define\("saveOpenAIModel",[\s\S]*?\n\}\);/) || [, ""])[0] || "";
  ok(/provider !== MANAGED_PROVIDER_ID/.test(sm),
    "saveOpenAIModel exempts managed from the 'requires an API key' check (its key is never in KVS)");
  ok(/managedModelAllowed\(model\)/.test(sm), "…and refuses a model outside the offer");
  ok(/upgradeRequired\("managed-cloud-ai"\)/.test(sm), "…and refuses a Standard tenant with the upgrade shape");
  const sa = (indexSrc.match(/resolver\.define\("saveAgentModel",[\s\S]*?\n\}\);/) || [, ""])[0] || "";
  ok(/managedModelAllowed\(clean\)/.test(sa), "saveAgentModel refuses an agent model outside the offer");
  ok(/upgradeRequired\("managed-cloud-ai"\)/.test(sa), "…and refuses a Standard tenant");
}
{
  // The gate facts always carry the boolean, so the ONE predicate can tell the two
  // refusals apart wherever it runs.
  const gf = (indexSrc.match(/const agentGateFacts = async \(context, \{ fresh = false \} = \{\}\) => \{[\s\S]*?\n\};/) || [, ""])[0] || "";
  ok(/managedKeyPresent: managedCloudStatus\(\)\.available/.test(gf),
    "agentGateFacts supplies managedKeyPresent as a BOOLEAN from the safe accessor");
  ok(/VENDOR_BILLED_PROVIDERS\.includes\(facts\.provider\)/.test(gf),
    "the fresh allowance read covers BOTH vendor-billed engines, not just Forge LLM");
  // F-811 — THE MODEL IS THE FACT SET'S OWN. `getAgentModel()` resolved a provider of its
  // own through the 30 s memo, so a fact set could carry `atlassian` with the managed
  // engine's Sonnet id (or the reverse) and two doors then disagreed about one instance.
  ok(/getAgentModelFor\(facts\.provider\)/.test(gf),
    "agentGateFacts resolves the agent model FOR THE PROVIDER IT JUST READ, not for the memo's");
  const gam = (indexSrc.match(/export const getAgentModelFor = async \(provider\) => \{[\s\S]*?\n\};/) || [, ""])[0] || "";
  ok(gam.length > 0, "found getAgentModelFor");
  ok(!/getProviderConfig\(/.test(gam),
    "…and it reads NO provider of its own — the provider is the ARGUMENT, which is the whole fix");
  // It is a SECOND reader of the model slot, so it must share the POLICY: a managed slot
  // holding anything outside the offer is clamped server-side here too, or the agent path
  // would be the one place a junk id could name a model we never agreed to bill for.
  ok(/clampManagedModel\(model\)/.test(gam),
    "…and it applies the SAME managed clamp, from the same one home in src/shared/edition.js");
}

console.log(`managed-provider: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
