/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Offline guard for the FORGE LLM MODEL POLICY seam (editions 1.3).
//
// Forge LLM tokens are billed to the VENDOR, so "which model may this tenant run" is a
// pricing boundary, not a preference. Until 1.3 it was an arity-1 regex
// (`isForgeLlmModelAllowed = (id) => /haiku/i.test(id)`) copied across four enforcement
// sites; it now lives once in src/shared/edition.js. This test exists to keep it that way:
// a future "just let sonnet through here" edit at one call site has to delete an assertion.
//
// src/index.js and src/async-handler.js cannot be imported offline (@forge/* at load), so
// this source-parses them — the project pattern (async-handler-helpers.test.mjs).
// Auto-discovered by run-offline.mjs. Run: node scripts/forge-llm-policy.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { FORGE_LLM_DEFAULT, FORGE_LLM_FRONTIER, FORGE_LLM_MODELS } from "../../src/shared/edition.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const indexSrc = readFileSync(path.join(here, "../../src/index.js"), "utf8");
// The async consumer — F-089 asserts it imports the clamp rather than owning a copy.
const asyncSrc = readFileSync(path.join(here, "../../src/async-handler.js"), "utf8");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

// Strip line comments so "the old regex is mentioned in a comment" never satisfies a
// "the rule still exists" assertion, and never trips a "the rule is gone" one.
const codeOnly = indexSrc.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

// =====================================================================================
// 1. The old regex policy is GONE from the code (not merely unused)
// =====================================================================================
ok(!/const isForgeLlmModelAllowed\s*=/.test(codeOnly), "the arity-1 isForgeLlmModelAllowed is deleted");
ok(!/isForgeLlmModelAllowed\(/.test(codeOnly), "nothing calls isForgeLlmModelAllowed any more");
ok(!/FORGE_LLM_FALLBACK_MODELS/.test(codeOnly), "FORGE_LLM_FALLBACK_MODELS is deleted (the edition list IS the fallback)");
ok(!/\/haiku\/i/.test(codeOnly), "no /haiku/i regex survives anywhere in src/index.js");
ok(/from "\.\/shared\/edition\.js"/.test(indexSrc), "src/index.js imports the policy from the shared module");
for (const sym of ["FORGE_LLM_MODELS", "FORGE_LLM_FRONTIER", "FORGE_LLM_DEFAULT", "clampForgeLlmModel", "forgeLlmModelAllowedForEdition", "forgeLlmTier"]) {
  ok(new RegExp("\\b" + sym + "\\b").test(indexSrc), `src/index.js imports ${sym}`);
}
ok(!/FORGE_LLM_MODELS\s*=/.test(codeOnly), "src/index.js does not redefine FORGE_LLM_MODELS");

// =====================================================================================
// 2. The four enforcement sites go through the shared policy
// =====================================================================================
{
  // getOpenAIModels — never refuses, returns models + locked + edition
  // Bounded by the NEXT provider branch so an over-greedy slice cannot borrow
  // LM Studio's refusals and make this section pass for the wrong reason.
  const start = indexSrc.indexOf("forgeLlmListApi()");
  const end = indexSrc.indexOf("// LM Studio: auth is optional", start);
  ok(start > 0 && end > start, "found the Forge LLM branch of getOpenAIModels");
  const b = indexSrc.slice(indexSrc.lastIndexOf('if (provider === "atlassian") {', start), end);
  ok(/currentEdition\(\)/.test(b), "getOpenAIModels resolves the edition");
  ok(/FORGE_LLM_MODELS\[edition\]/.test(b), "getOpenAIModels intersects list() with the EDITION's list");
  ok(/locked/.test(b) && /FORGE_LLM_MODELS\.advanced\.filter/.test(b),
    "getOpenAIModels reports `locked` rows (a Standard site SEES Sonnet 5 / Opus 5 as locked)");
  ok(!/return \{ success: false/.test(b), "getOpenAIModels never refuses — browsing models on Standard is not an error");
  ok(/ids = \[\.\.\.allowed\]/.test(b), "when list() returns nothing usable, the edition list is the fallback");
}
{
  // saveOpenAIModel
  const i = codeOnly.indexOf('resolver.define("saveOpenAIModel"');
  ok(i > 0, "found saveOpenAIModel");
  const b = codeOnly.slice(i, i + 2200);
  ok(/forgeLlmModelAllowedForEdition\(edition, model\)/.test(b), "saveOpenAIModel checks the exact-id edition policy");
  ok(/FORGE_LLM_FRONTIER\.includes\(String\(model\)\)/.test(b) && /upgradeRequired\("forge-llm-frontier-models"\)/.test(b),
    "a frontier id on Standard returns the UPGRADE refusal, not a flat error");
  ok(/Model not offered on Atlassian \(Forge LLM\)\./.test(b), "a non-offered id gets a plain refusal on every edition");
}
{
  // getOpenAIModelFromKVS
  const i = codeOnly.indexOf('resolver.define("getOpenAIModelFromKVS"');
  ok(i > 0, "found getOpenAIModelFromKVS");
  const b = codeOnly.slice(i, i + 1400);
  ok(/clampForgeLlmModel\(edition, savedModel\)/.test(b), "getOpenAIModelFromKVS clamps the saved model by edition");
  // F-078: `clamped` needs a SAVED model — with nothing saved there is no downgrade to report.
  ok(/clamped: !!savedModel && savedModel !== effective/.test(b), "it reports `clamped` only when a SAVED model was downgraded");
  ok(/edition,/.test(b), "it returns the edition");
}
{
  // callForgeLlmChat — THE billing backstop
  const i = codeOnly.indexOf("const callForgeLlmChat = async");
  ok(i > 0, "found callForgeLlmChat");
  const b = codeOnly.slice(i, i + 2000);
  ok(/getProviderConfig\(\)/.test(b), "the adapter reads edition+allowance from the 30s provider memo");
  // F-089: the clamp ITSELF now lives in forgeLlmBillingClamp — ONE home shared with the
  // async consumer, which until 1.3 clamped by edition only. The adapter just feeds it.
  ok(/forgeLlmBillingClamp\(requested, \{ edition, allowance \}\)/.test(b),
    "the adapter applies the SHARED billing clamp (edition + allowance)");
  ok(/clampForgeLlmModel\(EDITION_IDS\.STANDARD, requested\)/.test(b),
    "any error resolving edition/allowance FAILS SOFT to the Standard clamp — never an exception into a transition");
  ok(!/await storage\.get\(providerModelSlot/.test(b), "the adapter adds NO new KVS read of its own inside the race");
}
{
  // The shared clamp — the ONE home for "may this vendor-billed model go out?".
  const m = codeOnly.match(/export const forgeLlmBillingClamp = async [\s\S]*?\n\};/);
  ok(!!m, "found forgeLlmBillingClamp");
  const b = m ? m[0] : "";
  ok(/allowance\.level === "hard"/.test(b) && new RegExp("model = FORGE_LLM_DEFAULT").test(b),
    "a HARD allowance forces FORGE_LLM_DEFAULT regardless of edition");
  ok(/clampForgeLlmModel\(edition \|\| EDITION_IDS\.STANDARD, requested\)/.test(b),
    "otherwise the EDITION decides, defaulting to Standard");
  ok(/noteForgeLlmClamp\(/.test(b), "an allowance-forced clamp is counted through the meter");
  ok(/console\.warn\(/.test(b), "the clamp logs one line");
  ok(/export const forgeLlmBillingClamp/.test(codeOnly) && /forgeLlmBillingClamp,/.test(asyncSrc || ""),
    "the async consumer imports the same function — no second formula (F-089)");
}
{
  // The effective model is returned so the meter costs what was billed
  const i = codeOnly.indexOf("const openAIData = {");
  const b = codeOnly.slice(i, i + 700);
  ok(/\n      model,/.test(b), "callForgeLlmChat returns the EFFECTIVE model in data.model");
}

// =====================================================================================
// 3. recordAiUsage carries the model and costs only the vendor-billed provider
// =====================================================================================
{
  const m = codeOnly.match(/export const recordAiUsage = async \(\{[\s\S]*?\n\};/);
  ok(!!m, "found recordAiUsage");
  const b = m ? m[0] : "";
  ok(/\{ provider, usageLike, model \}/.test(b), "recordAiUsage's signature gained `model`");
  ok(/provider === "atlassian"/.test(b), "only the atlassian provider is costed (BYOK spend is the customer's)");
  ok(/forgeLlmTier\(model\)/.test(b) && /forgeLlmCostUsd\(tier/.test(b), "tier + cost are derived from the model");
  ok(/bumpCounters\(state, \{ provider: provider \|\| "unknown", usage, nowMs: Date\.now\(\), model, tier, costUsd \}\)/.test(b),
    "the tier/cost are passed into bumpCounters");
  ok(/metering is best-effort/.test(indexSrc), "the fail-open comment on the meter is still there");
}
{
  const calls = codeOnly.split("\n").filter((l) => /await recordAiUsage\(\{/.test(l));
  ok(calls.length >= 4, `found ${calls.length} recordAiUsage call sites`);
  ok(calls.every((l) => /model:/.test(l)), "EVERY recordAiUsage call site passes a model");
  ok(calls.filter((l) => /data\.model/.test(l)).length === calls.length,
    "every site prefers the adapter's EFFECTIVE data.model over the configured one");
}

// =====================================================================================
// 4. Allowance + seats plumbing
// =====================================================================================
ok(/SEAT_SNAPSHOT_KEY = "COGNIRUNNER_SEAT_SNAPSHOT"/.test(codeOnly), "seat snapshot key");
ok(/SEAT_SCAN_MAX = 2000/.test(codeOnly), "the user scan stops at 2,000 (past that the allowance is at its ceiling)");
ok(/SEAT_SNAPSHOT_MAX_AGE_MS = 24 \* 60 \* 60 \* 1000/.test(codeOnly), "the seat count refreshes at most once a day");
ok(/rest\/api\/3\/users\/search/.test(codeOnly), "seats are counted from /rest/api/3/users/search (read:jira-user is held)");
{
  const m = codeOnly.match(/const maybeRefreshSeatSnapshot = \(\) => \{[\s\S]*?\n\};/);
  ok(!!m, "found maybeRefreshSeatSnapshot");
  const b = m ? m[0] : "";
  ok(!/^const maybeRefreshSeatSnapshot = async/.test(b), "the seat refresh is NOT async at the call site — nothing awaits it");
  ok(/u\.active === true && u\.accountType === "atlassian"/.test(b), "only active Atlassian accounts count as seats");
  // F-081: a failed page must WRITE a marker row, not just return — otherwise every cold
  // container restarts the scan.
  // F-092: and that marker must NOT blank a good count. It used to write {seats:null},
  // which dropped a 500-seat site to the 100-seat fallback ($800 → $200 allowance) and
  // pushed a paying tenant to level:"hard" for 24h. Failure now refreshes `at`, records
  // `error`, and carries the PREVIOUS count through.
  ok(/await write\(\{ seats: prevSeats, error: String\(resp\.status\) \}\)/.test(b),
    "a failed page writes a marker that PRESERVES the last good seat count");
  ok(/await write\(\{ seats: prevSeats, error: String\(\(e && e\.message\)/.test(b),
    "…and so does the outer catch");
  ok(!/seats: null, error/.test(b), "no failure path replaces a good count with null (F-092)");
  ok(/prevSeats = snap && Number\(snap\.seats\) > 0 \? Number\(snap\.seats\) : null;/.test(b),
    "the previous count is read from the snapshot before anything is written");
  // F-094: the scan is started from a resolver that has already RETURNED, so a frozen
  // container must not be able to leave NO row. The START marker is written first and
  // carries `at`, which is the arm the 24h throttle actually reads.
  {
    const iStart = b.indexOf("await write({ seats: prevSeats, pending: true })");
    const iScan = b.indexOf("api.asApp().requestJira");
    ok(iStart > 0, "a START marker { seats: <previous>, pending: true, at } is written");
    ok(iStart < iScan, "…BEFORE the first REST page, so a frozen container cannot re-run the scan");
  }
  // F-100: the SUCCESS arm is a money arm too. A non-array 200 body is a fault, and a
  // count of zero is impossible on a site that installed this app — neither may
  // overwrite a good count with something readSeatCount will read back as null.
  ok(/await write\(\{ seats: prevSeats, error: "non-array-page" \}\)/.test(b),
    "a 200 with a NON-ARRAY body is treated as a failure, preserving the last good count");
  ok(/await write\(seats > 0 \? \{ seats \} : \{ seats: prevSeats \?\? null, error: "empty-directory" \}\)/.test(b),
    "a completed scan writes its count, and a count of ZERO never overwrites a good one");
  ok(!/await write\(\{ seats \}\);/.test(b), "the unconditional zero-writing success arm is gone");
  // The throttle is keyed on `at`, and every write sets it.
  ok(/\{ \.\.\.row, at: Date\.now\(\) \}/.test(b), "every write stamps `at` — the cross-container throttle key");
  ok(/Date\.now\(\) - snap\.at < SEAT_SNAPSHOT_MAX_AGE_MS/.test(b), "…and the stored `at` is what BLOCKS a re-run inside 24h");
  // F-080: a SHORT page is normal (Jira caps maxResults); only an empty page ends the scan.
  ok(!/page\.length < SEAT_PAGE/.test(b), "a short page no longer truncates the scan");
}

// =====================================================================================
// F-092 / F-094 — the seat scan, EXECUTED. The source assertions above say what the code
// reads; these run it against a fake KVS + Jira and assert the two behaviours that cost
// money when they are wrong: the 24h throttle BLOCKS, and a failure never blanks a count.
// =====================================================================================
{
  const m = codeOnly.match(/const maybeRefreshSeatSnapshot = \(\) => \{[\s\S]*?\n\};/);
  const src = m ? m[0] : "";
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    "storage", "api", "route", "SEAT_SNAPSHOT_KEY", "SEAT_SNAPSHOT_MAX_AGE_MS",
    "SEAT_SCAN_MAX", "SEAT_PAGE", "SEAT_MAX_PAGES",
    "let _seatRefreshStartedAt = 0;\n" + src + "\nreturn maybeRefreshSeatSnapshot;",
  );
  const DAY = 24 * 60 * 60 * 1000;
  const settle = () => new Promise((r) => setTimeout(r, 20));
  const build = (row, pages) => {
    const state = { row, writes: [], rest: 0 };
    const storage = {
      get: async () => state.row,
      set: async (_k, v) => { state.row = v; state.writes.push(v); },
    };
    const api = { asApp: () => ({ requestJira: async () => {
      const p = pages[state.rest++];
      if (p && p.status) return { ok: false, status: p.status };
      return { ok: true, json: async () => (p || []) };
    } }) };
    const route = (strings, ...v) => strings.reduce((a, sPart, i) => a + sPart + (v[i] ?? ""), "");
    return { state, run: factory(storage, api, route, "K", DAY, 2000, 200, 10) };
  };
  const user = { active: true, accountType: "atlassian" };

  // BLOCK — a snapshot written 1h ago stops the scan dead: no REST call, no write.
  {
    const { state, run } = build({ seats: 500, at: Date.now() - 60 * 60 * 1000 }, [[user]]);
    run(); await settle();
    ok(state.rest === 0, "BLOCK: a snapshot inside 24h makes no REST call");
    ok(state.writes.length === 0, "BLOCK: …and writes nothing, so `at` is not pushed forward");
    ok(state.row.seats === 500, "BLOCK: the good count is untouched");
  }
  // ALLOW — a stale snapshot rescans: START marker first (carrying the old count), then the new one.
  {
    const { state, run } = build({ seats: 500, at: Date.now() - 2 * DAY }, [[user, user, user], []]);
    run(); await settle();
    ok(state.writes.length >= 2, "ALLOW: a stale snapshot rescans and writes");
    ok(state.writes[0].pending === true && state.writes[0].seats === 500,
      "ALLOW: the FIRST write is the start marker, carrying the previous count (F-094)");
    ok(typeof state.writes[0].at === "number", "ALLOW: the start marker stamps `at` — a frozen container cannot loop");
    ok(state.row.seats === 3 && !state.row.pending, "ALLOW: the completed scan replaces it with the new count");
  }
  // FAILURE — a 429 mid-scan keeps the count, records the error, refreshes `at`.
  {
    const { state, run } = build({ seats: 500, at: Date.now() - 2 * DAY }, [[user], { status: 429 }]);
    run(); await settle();
    ok(state.row.seats === 500, "FAILURE: a 429 does NOT blank the last good seat count (F-092)");
    ok(state.row.error === "429", "FAILURE: the error is recorded");
    ok(typeof state.row.at === "number", "FAILURE: `at` is refreshed so it cannot re-run for 24h");
  }
  // F-100 — a 200 with a NON-ARRAY body (an error envelope, a gateway page) must not
  // read as "zero seats". This is the reproduced case: {seats:500} must survive it.
  {
    const { state, run } = build({ seats: 500, at: Date.now() - 2 * DAY }, [{ errorMessages: ["nope"] }]);
    run(); await settle();
    ok(state.row.seats === 500, "NON-ARRAY 200: the 500-seat count survives (F-100)");
    ok(state.row.error === "non-array-page", "NON-ARRAY 200: the reason is recorded");
    ok(state.writes.length === 2, "NON-ARRAY 200: start marker + failure marker, no zero write");
  }
  // F-100 — an empty FIRST page is a directory we cannot see, not a zero-seat site.
  {
    const { state, run } = build({ seats: 500, at: Date.now() - 2 * DAY }, [[]]);
    run(); await settle();
    ok(state.row.seats === 500 && state.row.error === "empty-directory",
      "EMPTY directory: a zero count never overwrites a good one");
  }
  // FAILURE with no previous count — null is the honest answer, and the 100-seat fallback covers it.
  {
    const { state, run } = build(null, [{ status: 403 }]);
    run(); await settle();
    ok(state.row.seats === null && state.row.error === "403",
      "FAILURE with no prior count: seats stays null (nothing good was overwritten)");
  }
}
// =====================================================================================
// F-099 — the seat read's THREE outcomes, EXECUTED. A seat count decides the monthly
// allowance, so "the read faulted" must never become "the site has 100 seats": that
// turns a KVS wobble into level:"hard" and downgrades a paying tenant to Haiku.
// =====================================================================================
{
  const rs = codeOnly.match(/const readSeatCount = async \(\) => \{[\s\S]*?\n\};/);
  ok(!!rs, "found readSeatCount");
  const ra = indexSrc.match(/export const readForgeLlmAllowance = async \(\) => \{[\s\S]*?\n\};/);
  ok(!!ra, "found readForgeLlmAllowance");
  const build = (storage) => new Function(
    "storage", "SEAT_SNAPSHOT_KEY", "USAGE_KEY", "emptyState", "forgeLlmAllowanceStatus", "allowanceUsdForSeats",
    (rs ? rs[0] : "") + "\n" + (ra ? ra[0] : "").replace("export const", "const") +
    "\nreturn { readSeatCount, readForgeLlmAllowance };",
  )(storage, "SEATS", "USAGE", () => ({ empty: true }), (state, ceilingUsd) => ({ ceilingUsd, state }), (seats) => (seats > 0 ? seats * 2 : 200));

  // 1. A real snapshot → { ok:true, seats:n }
  {
    const { readSeatCount, readForgeLlmAllowance } = build({ get: async (k) => (k === "SEATS" ? { seats: 500 } : { spend: 1 }) });
    const r = await readSeatCount();
    ok(r.ok === true && r.seats === 500, "a snapshot with a count reads { ok:true, seats:500 }");
    const a = await readForgeLlmAllowance();
    ok(a && a.ceilingUsd === 1000, "…and the allowance is computed from THAT count");
  }
  // 2. No row ever written → { ok:true, seats:null } → the 100-seat fallback covers it
  {
    const { readSeatCount, readForgeLlmAllowance } = build({ get: async () => null });
    const r = await readSeatCount();
    ok(r.ok === true && r.seats === null, "a MISSING snapshot reads { ok:true, seats:null } — unknown, not faulted");
    const a = await readForgeLlmAllowance();
    ok(a && a.ceilingUsd === 200, "…and the 100-seat fallback still applies to an unscanned site");
  }
  // 3. The read FAULTED → { ok:false } → allowance null, never a computed ceiling
  {
    const { readSeatCount, readForgeLlmAllowance } = build({ get: async (k) => { if (k === "SEATS") throw new Error("kvs 429"); return { spend: 1 }; } });
    const r = await readSeatCount();
    ok(r.ok === false && r.seats === null, "a FAULTED seat read reads { ok:false } — distinguishable from 'no row'");
    const a = await readForgeLlmAllowance();
    ok(a === null, "…and readForgeLlmAllowance returns NULL on a faulted seat read (F-099: never 'hard')");
  }
  // 4. A faulted USAGE read is the same story — the doc comment promises null for both.
  {
    const { readForgeLlmAllowance } = build({ get: async (k) => { if (k === "USAGE") throw new Error("kvs 429"); return { seats: 500 }; } });
    ok((await readForgeLlmAllowance()) === null, "a faulted USAGE read also yields null, as the comment states");
  }
}
{
  const m = codeOnly.match(/const getProviderConfig = async \(\) => \{[\s\S]*?\n\};/);
  ok(!!m, "found getProviderConfig");
  const b = m ? m[0] : "";
  ok(/edition: _cachedEditionId, allowance: _cachedAllowance/.test(b), "the memo returns edition + allowance on the CACHED path too");
  ok(/if \(provider === "atlassian"\)/.test(b), "the extra reads only happen for the vendor-billed provider");
  ok(/forgeLlmAllowanceStatus\(stateRead\.state \|\| emptyState\(\), allowanceUsdForSeats\(seatRead\.seats\)\)/.test(b), "the allowance is computed at refresh time");
  // F-099: a FAULTED usage or seat read yields NO allowance. It must not be folded into
  // the 100-seat fallback — that computes a ceiling from a number nobody read.
  ok(/\(stateRead\.ok && seatRead\.ok\)/.test(b) && /: null;/.test(b),
    "a faulted usage/seat read leaves the allowance null, never a computed ceiling");
  // F-079/F-093: the seat SCAN no longer rides the transition path — it is triggered from
  // ONE admin-gated resolver (getAiUsage) only.
  ok(!/maybeRefreshSeatSnapshot/.test(b), "the provider memo never starts a seat scan");
  ok(/Promise\.all\(\[/.test(b), "the memo's three Forge-LLM reads go out in parallel");
  ok(/_cachedAllowance = null;/.test(b), "every failure path leaves the allowance null (no ceiling known → never 'hard')");
  // F-096: the memo is stamped fresh only AFTER every read resolved. Stamping first meant
  // a throwing read returned the fail-open answer while the cache kept serving the
  // PREVIOUS edition/allowance for 30s — two answers from one memo.
  {
    const iReads = b.indexOf("Promise.all([");
    const iStamp = b.indexOf("_cachedProviderChecked = true;");
    ok(iStamp > iReads && iReads > 0, "the memo is marked fresh AFTER the Forge LLM reads, not before");
    ok(b.indexOf("_cachedEditionId = editionId;") < iStamp, "…and the cached edition is written before the stamp");
    const cat = b.slice(b.indexOf("} catch (error) {"));
    ok(/_cachedEditionId = EDITION_IDS\.STANDARD;/.test(cat) && /_cachedAllowance = null;/.test(cat),
      "the fail-open path writes the fail-open values into the cache — it never leaves a stale 'advanced' behind");
    ok(!/_cachedProviderChecked = true;/.test(cat), "…and does not mark the memo fresh, so the next call retries");
  }
}
{
  const i = codeOnly.indexOf('resolver.define("getAiUsage"');
  const b = codeOnly.slice(i, i + 900);
  // F-091: the block is emitted only for the vendor-billed provider ON Coder; otherwise null.
  ok(/forgeLlm: \(showAllowance && seatRead\.ok\) \? forgeLlmAllowanceStatus\(state, allowanceUsdForSeats\(seats\)\) : null/.test(b),
    "getAiUsage reports the allowance status where it applies, and null where it does not");
  ok(/seats,/.test(b), "getAiUsage reports the seat count");
  // F-099: a faulted seat read is not 100 seats — no seat count and no allowance block.
  ok(/const seats = seatRead\.ok \? seatRead\.seats : null;/.test(b),
    "…and a FAULTED seat read reports null seats rather than the fallback");
}
{
  const i = codeOnly.indexOf('resolver.define("checkProviderHealth"');
  const b = codeOnly.slice(i, i + 1800);
  ok(/const model = \(result && result\.data && result\.data\.model\) \|\| configuredModel;/.test(b),
    "checkProviderHealth reports the EFFECTIVE (clamped) model");
  // F-086: `clamped` is an EDITION verdict, never a compare against the id the provider echoed.
  ok(/clampForgeLlmModel\(edition, configuredModel\) !== configuredModel/.test(b),
    "and says when the EDITION refuses the configured model");
  ok(!/clamped: model !== configuredModel/.test(b), "the provider-echo comparison is gone");
}

// =====================================================================================
// 5. The agent model slot
// =====================================================================================
ok(/const providerAgentModelSlot = \(provider\) => `COGNIRUNNER_AGENT_MODEL_\$\{provider\}`;/.test(codeOnly),
  "providerAgentModelSlot = COGNIRUNNER_AGENT_MODEL_{provider}");
ok(/export const getAgentModel = async \(\)/.test(codeOnly), "getAgentModel is exported as a backend function");
{
  const i = codeOnly.indexOf('resolver.define("saveAgentModel"');
  ok(i > 0, "found the saveAgentModel resolver");
  const b = codeOnly.slice(i, i + 1800);
  ok(/requireAdmin\(context\.accountId\)/.test(b), "saveAgentModel is admin-gated");
  ok(/FORGE_LLM_FRONTIER\.includes\(clean\)/.test(b), "on Forge LLM only the frontier ids are accepted");
  ok(/upgradeRequired\("forge-llm-frontier-models"\)/.test(b), "a Standard tenant gets the upgrade refusal");
  // F-084: the 120-char cap moved into normalizeModelId (src/shared/edition.js), shared
  // with saveOpenAIModel — one home for what a legal model id is.
  ok(/normalizeModelId\(payload && payload\.model\)/.test(b), "model ids are normalised server-side by the shared normaliser");
}
{
  const i = codeOnly.indexOf('resolver.define("getAgentModel"');
  ok(i > 0, "found the getAgentModel resolver");
  const b = codeOnly.slice(i, i + 1200);
  ok(/frontierOnly: provider === "atlassian"/.test(b), "getAgentModel flags frontierOnly for Forge LLM");
  ok(/edition/.test(b), "getAgentModel returns the edition");
}
ok(FORGE_LLM_FRONTIER.length === 2 && !FORGE_LLM_FRONTIER.includes(FORGE_LLM_DEFAULT),
  "the default (Haiku) is NOT a frontier model — it can never drive an agent");
ok(FORGE_LLM_MODELS.standard.length === 1, "Standard still offers exactly one Forge LLM model");

console.log(`\nforge-llm-policy: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
