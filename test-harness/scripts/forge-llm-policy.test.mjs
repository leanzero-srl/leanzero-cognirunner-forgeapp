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
// F-826 — the model chain itself. A pure, dependency-free shared module, so it is
// IMPORTED and EXECUTED here rather than source-parsed out of a backend file.
const { resolveModelForProvider: chain } = await import("../../src/shared/model-resolution.js");
const chainSrc = readFileSync(path.join(here, "../../src/shared/model-resolution.js"), "utf8");

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
  ok(/currentEdition\(context\)/.test(b), "getOpenAIModels resolves the edition through the one ladder (F-101)");
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
  // F-448 — the property is "the clamp is fed the requested model, the edition and the
  // allowance", not "allowance is the last key in the literal".
  {
    const args = (b.match(/forgeLlmBillingClamp\(([^)]*)\)/) || [, null])[1];
    ok(args !== null, "the adapter calls the SHARED billing clamp");
    ok(!!args && /\brequested\b/.test(args) && /\bedition\b/.test(args) && /\ballowance\b/.test(args),
      "the adapter applies the SHARED billing clamp (edition + allowance)");
  }
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
  // The costed set is now a LIST, not a literal: Forge LLM and the LeanZero-managed
  // engine are both vendor-billed and both are costed; BYOK spend stays the customer's.
  ok(/VENDOR_BILLED_PROVIDERS\.includes\(provider\)/.test(b), "only the VENDOR-BILLED providers are costed (BYOK spend is the customer's)");
  ok(/managedCostUsd\(/.test(b) && /forgeLlmCostUsd\(/.test(b), "each vendor-billed engine is costed by its own rate table");
  ok(/forgeLlmTier\(model\)/.test(b) && /forgeLlmCostUsd\(tier/.test(b), "tier + cost are derived from the model");
  // F-448 — assert what bumpCounters RECEIVES, key by key.
  {
    const args = (b.match(/bumpCounters\(state,\s*\{([^}]*)\}\)/) || [, null])[1];
    ok(args !== null, "the meter feeds bumpCounters an options literal");
    ok(!!args && /\bprovider:\s*provider \|\| "unknown"/.test(args) && /\busage\b/.test(args)
      && /\bnowMs:\s*Date\.now\(\)/.test(args) && /\bmodel\b/.test(args)
      && /\btier\b/.test(args) && /\bcostUsd\b/.test(args),
      "the tier/cost are passed into bumpCounters");
  }
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
// Moved here from edition-backend.test.mjs (F-104 — one home for the scan's shape).
ok(/SEAT_MAX_PAGES = 10/.test(codeOnly), "the page ceiling is 10");
ok(/SEAT_SNAPSHOT_MAX_AGE_MS = 24 \* 60 \* 60 \* 1000/.test(codeOnly), "the seat count refreshes at most once a day");
ok(/rest\/api\/3\/users\/search/.test(codeOnly), "seats are counted from /rest/api/3/users/search (read:jira-user is held)");
{
  const m = codeOnly.match(/const maybeRefreshSeatSnapshot = \(\) => \{[\s\S]*?\n\};/);
  ok(!!m, "found maybeRefreshSeatSnapshot");
  const b = m ? m[0] : "";
  // F-102: the caller awaits ONLY the start marker. The function is not `async` itself;
  // it RETURNS a promise that resolves once the marker is durable, and the multi-page
  // scan runs detached behind it — one KVS write on the resolver's clock, not ten pages.
  ok(!/^const maybeRefreshSeatSnapshot = async/.test(b), "the seat refresh is not an async function — it returns a promise");
  ok(/return Promise\.resolve\(\)\.then\(async \(\) => \{/.test(b), "…and that promise is returned, so the caller can await the marker");
  ok(/const scan = async \(\) => \{/.test(b) && /\n    scan\(\)\.catch\(/.test(b),
    "the PAGES run detached (scan() is not awaited) — the resolver never waits on the REST loop");
  {
    const iMarker = b.indexOf("await write({ seats: prevSeats, pending: true })");
    const iScanDef = b.indexOf("const scan = async");
    ok(iMarker > 0 && iMarker < iScanDef, "the marker is written before the detached scan is even defined");
  }
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
  // F-110: the snapshot READ has its own try, and a fault there writes NOTHING —
  // `prevSeats` is left undefined rather than defaulting to null, and no `at` is
  // stamped, so the next call rescans instead of sitting on an unread row for 24h.
  ok(/\n    let prevSeats;\n/.test(b), "prevSeats is declared WITHOUT a null default (a fault must be distinguishable)");
  ok(/console\.warn\("\[seats\] snapshot read failed[\s\S]*?\n      return false;/.test(b),
    "a faulted snapshot read logs and returns — it writes no row at all");
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
  // F-110 — the SNAPSHOT READ ITSELF faults. `prevSeats` used to be assigned on the
  // line AFTER that read, so the shared catch wrote {seats:null, at:now}: a good
  // 500-seat count became UNKNOWN (readSeatCount reports ok:true/seats:null, so F-099's
  // fault guard does not fire) → the 100-seat $200 ceiling → "hard" → every rule
  // clamped to Haiku, and the fresh `at` blocked any rescan for 24h. A faulted read
  // must now write NOTHING.
  {
    const state = { row: { seats: 500, at: Date.now() - 2 * DAY }, writes: [], rest: 0 };
    const storage = {
      get: async () => { throw new Error("kvs 429"); },
      set: async (_k, v) => { state.row = v; state.writes.push(v); },
    };
    const api = { asApp: () => ({ requestJira: async () => { state.rest++; return { ok: true, json: async () => [] }; } }) };
    const route = (strings, ...v) => strings.reduce((a, sPart, i) => a + sPart + (v[i] ?? ""), "");
    const run = factory(storage, api, route, "K", DAY, 2000, 200, 10);
    const out = await run(); await settle();
    ok(out === false, "READ FAULT: the refresh reports it did not run");
    ok(state.writes.length === 0, "READ FAULT: NO row is written — a fault never stamps `at` (F-110)");
    ok(state.row.seats === 500, "READ FAULT: the last good count survives untouched");
    ok(typeof state.row.at === "number" && Date.now() - state.row.at > DAY,
      "READ FAULT: `at` stays stale, so the next call rescans instead of waiting 24h");
    ok(state.rest === 0, "READ FAULT: no scan is started off a snapshot nobody could read");
  }
  // F-102 — what the caller awaits is the START MARKER, and only that. The returned
  // promise must be settled with the marker already written, while the pages are still
  // in flight: a container frozen at resolver return then still leaves a throttle row.
  {
    let release;
    const gate = new Promise((r) => { release = r; });
    const state = { row: { seats: 500, at: Date.now() - 2 * DAY }, writes: [], rest: 0 };
    const storage = {
      get: async () => state.row,
      set: async (_k, v) => { state.row = v; state.writes.push(v); },
    };
    const api = { asApp: () => ({ requestJira: async () => { state.rest++; await gate; return { ok: true, json: async () => [] }; } }) };
    const route = (strings, ...v) => strings.reduce((a, sPart, i) => a + sPart + (v[i] ?? ""), "");
    const run = factory(storage, api, route, "K", DAY, 2000, 200, 10);
    const started = await run();
    ok(started === true, "the returned promise resolves as soon as the scan is under way");
    ok(state.writes.length === 1 && state.writes[0].pending === true && typeof state.writes[0].at === "number",
      "AWAITED: the start marker is DURABLE before the caller continues (F-102)");
    release(); await settle();
    ok(state.rest === 1, "…and the REST pages ran AFTER the caller was already free");
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
  ok(/if \(VENDOR_BILLED_PROVIDERS\.includes\(provider\)\)/.test(b), "the extra reads only happen for the vendor-billed providers");
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
    // F-103: the PROVIDER half does NOT fail open to the vendor-billed provider. This is
    // the value callAIChatRaw dispatches on, so "atlassian" here routes a BYOK tenant's
    // call to the vendor's bill, clamped to Haiku so it even succeeds.
    ok(!/return \{ provider: "atlassian"/.test(cat), 'the fault path never names "atlassian" as the provider');
    ok(/const lastProvider = _cachedProvider \|\| null;/.test(cat) && /provider: lastProvider,/.test(cat),
      "on a fault the provider is the last one this container read, else null (no provider configured)");
  }
  // F-103: and `null` must really mean "no provider" downstream — no dispatch branch
  // matches it, and the key lookup refuses it rather than memoising a bogus slot miss.
  {
    const raw = codeOnly.match(/const callAIChatRaw = async \(opts\) => \{[\s\S]*?\n  const \{ provider, baseUrl \} = await getProviderConfig\(\);/);
    ok(!!raw, "callAIChatRaw dispatches on the provider from the memo");
    const key = codeOnly.match(/const getOpenAIKey = async \(\) => \{[\s\S]*?\n\};/);
    ok(!!key && /if \(!provider\) return null;/.test(key[0]),
      "getOpenAIKey returns no key for a null provider — callers then bail and validators fail OPEN");
    ok(!!key && key[0].indexOf("if (!provider) return null;") < key[0].lastIndexOf("_cachedKeyChecked = true;"),
      "…and it returns BEFORE the memo is stamped, so the miss is not served for 30s");
  }
  // F-112 — getOpenAIModel is the same seam and had NO null branch: it read
  // COGNIRUNNER_MODEL_null, then cached PROVIDERS[null]?.defaultModel || "gpt-5.4-mini"
  // into _cachedModel for the full 30s TTL. Calls correctly routed to Anthropic after
  // the fault cleared still carried an OpenAI model id → 400/404 → validators fail OPEN.
  // F-818 — the chain now has ONE home (`resolveModelForProvider`) and getOpenAIModel is
  // the active-provider reader over it, so the F-112 property is a property of BOTH: the
  // caller refuses a null provider before it calls the resolver, and the resolver refuses
  // one before it touches a slot. Assert the pair, and EXECUTE the pair together.
  {
    const mod = codeOnly.match(/const getOpenAIModel = async \(\) => \{[\s\S]*?\n\};/);
    ok(!!mod, "found getOpenAIModel");
    const mb = mod ? mod[0] : "";
    // F-826 — the chain is no longer IN src/index.js at all: it is a pure function in
    // src/shared/model-resolution.js (the async consumer is a different process and
    // cannot import index.js, which is how a THIRD copy got there). index.js keeps only
    // the BINDING. So the source assertions split: the binding is read here, the chain's
    // own guards are read at the one home, and the behaviour is EXECUTED against the
    // real shared function rather than an eval of an extracted body.
    const bind = codeOnly.match(/const resolveModelForProvider = async \(provider, \{[^}]*\} = \{\}\) => resolveModelChain\(\{[\s\S]*?\n\}\);/);
    ok(!!bind, "src/index.js binds the ONE model chain, src/shared/model-resolution.js (F-826)");
    const bb = bind ? bind[0] : "";
    ok(!/getProviderConfig\(/.test(bb),
      "…and the binding reads NO provider of its own — the provider is the ARGUMENT (F-811, now structural for all three readers)");
    ok(/readSlot: \(key\) => storage\.get\(key\)/.test(bb) && /onMigrate: \(key, value\) => migrateLegacyModelSlot\(key, value\)/.test(bb),
      "…and it supplies THIS process's storage reader and writer (src/shared may not import @forge/kvs)");
    // F-859 — the migration writer is CREATE-IF-ABSENT, not a bare set. A transition in a
    // warm container whose slot read already answered empty must never overwrite a model
    // an admin saved in the meantime.
    {
      const mig = codeOnly.match(/const migrateLegacyModelSlot = async \(key, value\) => \{[\s\S]*?\n\};/);
      ok(!!mig, "src/index.js owns the ONE legacy-model migration writer (F-859)");
      const mgb = mig ? mig[0] : "";
      ok(/keyPolicy: "FAIL_IF_EXISTS"/.test(mgb),
        "…and it writes ATOMICALLY (keyPolicy FAIL_IF_EXISTS), closing the race rather than narrowing it");
      ok(/isKeyConflict\(e\)/.test(mgb) && /storage\.get\(key\)/.test(mgb),
        "…and on conflict it re-reads and answers the value that actually won");
      ok(!/await storage\.set\(key, value\);/.test(codeOnly),
        "…and no unconditional set of a model slot survives anywhere in index.js");
      // EXECUTED: the losing writer must not clobber, and the chain must answer the WINNER.
      const build = (storage) => eval("((storage, isKeyConflict, console) => {"
        + mgb.replace("const migrateLegacyModelSlot =", "const f =") + " return f; })")(
        storage, (e) => e && e.code === "KEY_EXISTS", { log() {}, error() {} });
      {
        const store = new Map([["COGNIRUNNER_MODEL_openai", "gpt-5.4"]]);
        const storage = {
          get: async (k) => store.get(k) ?? null,
          set: async (k, v, o) => {
            if (o && o.keyPolicy === "FAIL_IF_EXISTS" && store.has(k)) { const e = new Error("exists"); e.code = "KEY_EXISTS"; throw e; }
            store.set(k, v);
          },
        };
        const won = await build(storage)("COGNIRUNNER_MODEL_openai", "gpt-4.1");
        ok(store.get("COGNIRUNNER_MODEL_openai") === "gpt-5.4",
          "EXECUTED (F-859): a slot populated between the chain's read and the migrate call is NOT overwritten");
        ok(won === "gpt-5.4", "EXECUTED (F-859): …and the writer reports the admin's saved model back");
        // …and the CHAIN answers that winner, not the legacy value it had already read.
        const slots = { COGNIRUNNER_KEY_openai: "sk-x", COGNIRUNNER_OPENAI_MODEL: "gpt-4.1" };
        let firstRead = true;
        const m = await chain({
          provider: "openai",
          readSlot: async (k) => {
            if (k === "COGNIRUNNER_MODEL_openai") {
              // The admin's save lands AFTER this first (empty) read — the exact race.
              if (firstRead) { firstRead = false; return null; }
              return store.get(k) ?? null;
            }
            return slots[k] ?? null;
          },
          migrate: true,
          onMigrate: (k, v) => build(storage)(k, v),
          log: { log() {}, error() {} },
        });
        ok(m === "gpt-5.4", `EXECUTED (F-859): the chain answers the winning slot value, not the legacy one (${m})`);
      }
      {
        // An empty slot still migrates — the feature must keep working.
        const store = new Map();
        const storage = { get: async (k) => store.get(k) ?? null, set: async (k, v) => { store.set(k, v); } };
        const won = await build(storage)("COGNIRUNNER_MODEL_openai", "legacy-model");
        ok(won === "legacy-model" && store.get("COGNIRUNNER_MODEL_openai") === "legacy-model",
          "EXECUTED (F-859): an absent slot is still migrated");
      }
    }
    ok(/providers: PROVIDERS/.test(bb), "…and this process's PROVIDERS table");
    // F-448 — the property is "EVERY provider read is followed by a refusal", not "there
    // are exactly two refusals". A third read added without a guard must fail this, and a
    // refactor to one read must not.
    {
      const reads = [...mb.matchAll(/const \{ provider \} = await getProviderConfig\(\);/g)].map((m) => m.index);
      ok(reads.length >= 1, `getOpenAIModel reads the provider ${reads.length} time(s)`);
      const guarded = reads.filter((i) => /^[\s\S]{0,900}?if \(!provider\) return null;/.test(mb.slice(i)));
      ok(guarded.length === reads.length,
        "EVERY provider read in getOpenAIModel is followed by a null-provider refusal (the tail read can fault on its own)");
    }
    const iFirst = mb.indexOf("if (!provider) return null;");
    ok(iFirst > 0 && iFirst < mb.indexOf("resolveModelForProvider(") && iFirst < mb.lastIndexOf("_cachedModel ="),
      "…and the refusal precedes the resolver call AND every memo write, so a null-provider fault is never cached for 30s");
    // The chain's OWN refusal, read at its one home: it precedes every slot read.
    ok(/if \(!provider \|\| typeof provider !== "string"\) return null;/.test(chainSrc),
      "the shared chain refuses a null/blank provider outright");
    const iRes = chainSrc.indexOf('if (!provider || typeof provider !== "string") return null;');
    ok(iRes > 0 && iRes < chainSrc.indexOf("readSlot(providerModelSlot(provider))") && iRes < chainSrc.indexOf("readSlot(providerAgentModelSlot(provider))"),
      "…and that refusal precedes every slot read, so the null-provider model slot is never asked for");
    ok(!/COGNIRUNNER_(KEY|MODEL|AGENT_MODEL)_\$\{/.test(chainSrc),
      "…and the chain derives its slot NAMES from src/shared/provider-slots.js rather than retyping them");
    // EXECUTED, BINDING + CHAIN TOGETHER: with a faulted provider read the model is null,
    // the memo stays empty, and — the part a source read cannot prove — storage is never
    // touched at all. The chain here is the REAL shared function, not an eval of a body.
    {
      let reads = 0;
      const storageStub = { get: async () => { reads++; return "should-never-be-read"; }, set: async () => { reads++; } };
      const fn = eval("(async (getProviderConfig, storage, resolveModelChain, PROVIDERS, console, process) => {"
        + "let _cachedModel = null, _cachedModelAt = 0; const _cacheFresh = () => Date.now() - _cachedModelAt < 30000;"
        + bb + "\n"
        + mb.replace("const getOpenAIModel = async () => {", "const f = async () => {").replace(/;\s*$/, "")
        + "; const out = await f(); return { out, _cachedModel }; })");
      const res2 = await fn(async () => ({ provider: null, baseUrl: null }), storageStub, chain,
        { openai: { defaultModel: "gpt-5.4-mini" } }, { error() {}, log() {} }, { env: {} });
      ok(res2.out === null, "EXECUTED: a null provider yields NO model");
      ok(res2._cachedModel === null, "EXECUTED: …and nothing is written to the 30s model memo");
      ok(reads === 0, "EXECUTED: …and NO slot is read or written at all (both guards, not just the outer one)");
    }
    // EXECUTED — THE PARITY THE TWO SYNC READERS OWE EACH OTHER (F-818). With the agent
    // slot empty, the ordinary reader and the agent reader must answer the SAME model for
    // every provider; that is the whole point of one home, and it is what silently stopped
    // being true while the chain had two.
    {
      const gam = codeOnly.match(/export const getAgentModelFor = async \(provider\) => [\s\S]*?;\n/);
      ok(!!gam, "found getAgentModelFor");
      const providers = { openai: { defaultModel: "gpt-5.4-mini" }, azure: { defaultModel: "gpt-5.4-mini" },
        anthropic: { defaultModel: "claude-sonnet-4-5" }, openrouter: { defaultModel: "or/x" },
        lmstudio: { defaultModel: "local-x" }, managed: { defaultModel: "anthropic/claude-sonnet-5" },
        atlassian: { defaultModel: "claude-haiku-4-5-20251001" } };
      const build = eval("((storage, resolveModelChain, PROVIDERS, console, process) => {"
        + "let _cachedModel = null, _cachedModelAt = 0; const _cacheFresh = () => Date.now() - _cachedModelAt < 30000;"
        + bb + "\n" + gam[0].replace("export const", "const") + "\n"
        + mb.replace("const getOpenAIModel = async () => {", "const getOpenAIModelFor = async (provider) => { _cachedModel = null;").replace("const { provider } = await getProviderConfig();", "")
        + "\n return { getAgentModelFor, getOpenAIModelFor }; })");
      for (const [slotValue, label] of [[null, "empty slots"], ["some-saved-model", "an ordinary saved model"], ["anthropic/claude-opus-5", "a vendor-prefixed id"]]) {
        const store = new Map();
        const storage2 = { get: async (k) => (slotValue && k.startsWith("COGNIRUNNER_MODEL_") ? slotValue : (store.get(k) ?? null)), set: async (k, v) => { store.set(k, v); } };
        const { getAgentModelFor: agentFn, getOpenAIModelFor: plainFn } = build(storage2, chain, providers, { error() {}, log() {} }, { env: {} });
        for (const p of Object.keys(providers)) {
          const a = await agentFn(p);
          const b = await plainFn(p);
          ok(String(a) === String(b), `EXECUTED PARITY (${label}): both readers answer the same model for ${p} (${a} vs ${b})`);
        }
      }
    }
  }
}
// =====================================================================================
// F-826 — THE PARITY THE TWO PROCESSES OWE EACH OTHER.
//
// The consumer's getOpenAIModel was the THIRD copy of the chain: its own default table,
// no legacy migration, NO Forge LLM resolution belt, and a tail that answered
// "gpt-5.4-mini" on a faulted read where the sync seam answered null. A queued
// codegen/fix/distill task could resolve a different model from the one the sync resolver
// would have used for the same instance. Both are now bindings of the same pure function,
// and the property is asserted by EXECUTING both over every provider × slot state.
//
// THE RECONCILED TAIL, pinned here: a NULL provider answers null in BOTH (F-112 — callers
// bail on the key); a FAULTED SLOT READ answers the provider's default model in BOTH, with
// the fault logged (CLAUDE.md's default-model fallback — a KVS blip must not take a working
// instance offline). The consumer used to conflate the two by wrapping its PROVIDER read in
// the same try/catch as its slot reads.
// =====================================================================================
{
  const bind = codeOnly.match(/const resolveModelForProvider = async \(provider, \{[^}]*\} = \{\}\) => resolveModelChain\(\{[\s\S]*?\n\}\);/);
  const cons = asyncSrc.match(/const getOpenAIModel = async \(providerOverride = null\) => \{[\s\S]*?\n\};/);
  ok(!!bind && !!cons, "found both bindings of the model chain");
  ok(!/const PROVIDER_DEFAULT_MODELS = \{/.test(asyncSrc),
    "the consumer keeps NO second default-model table (F-826)");
  const syncBind = eval("((storage, resolveModelChain, PROVIDERS, console, process) => { "
    + bind[0].replace("const resolveModelForProvider =", "const f =") + " return f; })");
  const consBind = eval("((storage, resolveModelChain, getProviderConfig, console, process) => { "
    + cons[0].replace("const getOpenAIModel =", "const f =") + " return f; })");
  const providers = { openai: { defaultModel: "gpt-5.4-mini" }, azure: { defaultModel: "gpt-5.4-mini" },
    anthropic: { defaultModel: "claude-haiku-4-5-20251001" }, openrouter: { defaultModel: "openai/gpt-5.4-mini" },
    lmstudio: { defaultModel: null }, bedrock: { defaultModel: "eu.anthropic.claude-sonnet-4-6" },
    managed: { defaultModel: "anthropic/claude-sonnet-5" }, atlassian: { defaultModel: FORGE_LLM_DEFAULT } };
  const states = [
    ["empty slots", () => null],
    ["an ordinary saved model", (k) => (k.startsWith("COGNIRUNNER_MODEL_") ? "some-saved-model" : null)],
    ["a vendor-prefixed id in the model slot", (k) => (k.startsWith("COGNIRUNNER_MODEL_") ? "anthropic/claude-opus-5" : null)],
    ["a frontier Forge id in the model slot", (k) => (k.startsWith("COGNIRUNNER_MODEL_") ? "claude-opus-5" : null)],
    ["a junk managed id", (k) => (k.startsWith("COGNIRUNNER_MODEL_") ? "openai/gpt-4o" : null)],
    ["an agent slot set (the ordinary path must ignore it)", (k) => (k.startsWith("COGNIRUNNER_AGENT_MODEL_") ? "agent-only-model" : null)],
    ["a legacy slot + a BYOK key (migration is the ACTIVE-provider path's alone)",
      (k) => (k === "COGNIRUNNER_OPENAI_MODEL" ? "legacy-model" : (k.startsWith("COGNIRUNNER_KEY_") ? "sk-x" : null))],
    ["a FAULTED slot read", () => { throw new Error("kvs blip"); }],
  ];
  const quiet = { error() {}, log() {} };
  for (const [label, get] of states) {
    for (const p of Object.keys(providers)) {
      const storage2 = { get: async (k) => get(k), set: async () => {} };
      // The sync binding as the queued path's equivalent: no migration write, ordinary
      // slot. (getOpenAIModel adds migrate:true; the consumer deliberately does not
      // migrate, so the comparable call is migrate:false on both.)
      const a = await syncBind(storage2, chain, providers, quiet, { env: {} })(p, {});
      const b = await consBind(storage2, chain, async () => ({ provider: p }), quiet, { env: {} })(p);
      ok(String(a) === String(b), `PROCESS PARITY (${label}): sync and consumer agree for ${p} (${a} vs ${b})`);
    }
  }
  // THE TAIL, both directions, pinned explicitly.
  {
    const faulted = { get: async () => { throw new Error("kvs blip"); }, set: async () => {} };
    const a = await syncBind(faulted, chain, providers, quiet, { env: {} })("anthropic", {});
    const b = await consBind(faulted, chain, async () => ({ provider: "anthropic" }), quiet, { env: {} })("anthropic");
    ok(a === "claude-haiku-4-5-20251001" && b === a,
      `a FAULTED SLOT read answers the provider's DEFAULT model in BOTH (${a} vs ${b}) — a KVS blip must not take a working instance offline`);
    let logged = 0;
    await chain({ provider: "anthropic", readSlot: async () => { throw new Error("blip"); }, log: { error() { logged++; }, log() {} } });
    ok(logged === 1, "…and the fault is LOGGED, not swallowed");
    // A faulted PROVIDER read is the OTHER case and answers null in both: the consumer used
    // to answer "gpt-5.4-mini" here because one try/catch covered both reads.
    const c = await consBind(faulted, chain, async () => { throw new Error("provider read blip"); }, quiet, { env: {} })(null);
    ok(c === null, `a FAULTED PROVIDER read answers NO model in the consumer too (got ${c}) — callers bail on the key (F-112)`);
    const d = await consBind(faulted, chain, async () => ({ provider: null }), quiet, { env: {} })(null);
    ok(d === null, "…and so does a provider read that simply names none");
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
// F-126 — the slot helpers moved to src/shared/provider-slots.js (ONE home, importable by
// the dev-gated test hook without pulling in the Forge runtime). Assert them THERE, and
// assert index.js no longer keeps a private copy.
{
  const slotsSrc = readFileSync(path.join(here, "../../src/shared/provider-slots.js"), "utf8");
  ok(/export const providerAgentModelSlot = \(provider\) => `COGNIRUNNER_AGENT_MODEL_\$\{provider\}`;/.test(slotsSrc),
    "providerAgentModelSlot = COGNIRUNNER_AGENT_MODEL_{provider}");
  ok(/export const providerKeySlot = \(provider\) => `COGNIRUNNER_KEY_\$\{provider\}`;/.test(slotsSrc),
    "providerKeySlot = COGNIRUNNER_KEY_{provider}");
  ok(!/const providerAgentModelSlot = /.test(codeOnly), "index.js keeps no second copy of the slot helpers");
  ok(/import \{ providerKeySlot, providerModelSlot, providerAgentModelSlot, providerBaseUrlSlot \} from "\.\/shared\/provider-slots\.js";/.test(codeOnly),
    "…it imports them from the shared module");
}
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
