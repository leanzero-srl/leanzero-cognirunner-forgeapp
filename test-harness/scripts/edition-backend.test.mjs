/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Offline unit test for the EDITION seam inside src/index.js (1.3).
//
// src/index.js cannot be imported offline (it pulls @forge/llm, @forge/resolver and a
// dozen sibling modules at load), so this follows the project's source-parse +
// fs/eval-extract pattern (see async-handler-helpers.test.mjs, recover-verdict.test.mjs).
// It asserts the three things a later refactor could quietly break:
//   1. upgradeRequired() is a SUPERSET of the ONE refusal shape {success:false, error} —
//      a frontend that knows nothing about editions must still render `error`;
//   2. checkLicense keeps its isActive semantics (null when there is no license object,
//      false only when one exists and is inactive) AND emits the new edition fields;
//   3. the runtime gates (validate / executePostFunction) refresh the snapshot inside a
//      try/catch and do NOT let the edition read change their fail-open behaviour.
// Auto-discovered by run-offline.mjs. Run: node scripts/edition-backend.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ADVANCED_FEATURES, EDITIONS, resolveEdition, isFeatureAllowed } from "../../src/shared/edition.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const indexSrc = readFileSync(path.join(here, "../../src/index.js"), "utf8");
const asyncSrc = readFileSync(path.join(here, "../../src/async-handler.js"), "utf8");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

// =====================================================================================
// 1. upgradeRequired — the refusal shape
// =====================================================================================
const mUp = indexSrc.match(/export const upgradeRequired = \(featureId\) => \{[\s\S]*?\n\};/);
ok(!!mUp, "found upgradeRequired in src/index.js");
// eslint-disable-next-line no-eval
const upgradeRequired = eval("(" + mUp[0].replace("export const upgradeRequired = ", "").replace(/;\s*$/, "") + ")");

{
  const r = upgradeRequired("coder");
  ok(r.success === false, "refusal carries success:false (the ONE refusal shape)");
  ok(typeof r.error === "string" && r.error.length > 0, "refusal carries a human `error` string");
  ok(r.error.includes(EDITIONS.advanced.label), "the error names the product: Coder");
  ok(r.error.includes(ADVANCED_FEATURES.find((f) => f.id === "coder").label), "the error names the feature");
  ok(r.upgradeRequired === true && r.featureId === "coder" && r.edition === "standard",
    "the edition flags are ADDITIVE on top of {success,error}");
  const keys = Object.keys(r);
  ok(keys.includes("success") && keys.includes("error"), "superset of {success,error}, not a second refusal shape");
}
{
  const r = upgradeRequired("not-a-real-feature");
  ok(r.success === false && typeof r.error === "string", "an unknown feature id still produces a valid refusal");
  ok(r.error.startsWith("This feature"), "unknown feature id falls back to a generic label");
}

// =====================================================================================
// 2. checkLicense — isActive semantics preserved + edition fields added
// =====================================================================================
const mCl = indexSrc.match(/resolver\.define\("checkLicense",\s*\(\{ context \}\) => \{[\s\S]*?\n\}\);/);
ok(!!mCl, "found the checkLicense resolver");
{
  const body = mCl[0];
  ok(/editionFromInvocation\(context\?\.license\)/.test(body), "checkLicense resolves through editionFromInvocation (no second copy of the rule)");
  ok(/isActive:\s*context\?\.license\s*\?\s*context\.license\.isActive === true\s*:\s*null/.test(body),
    "isActive is still null with no license object and a strict === true otherwise");
  for (const f of ["edition", "label", "capabilitySet", "source", "features"]) {
    ok(new RegExp("\\b" + f + ":").test(body), `checkLicense emits ${f}`);
  }
  ok(/ADVANCED_FEATURES\.map/.test(body), "features are derived from ADVANCED_FEATURES, not re-listed");
}
// The shape the resolver produces, reconstructed from the shared module (the resolver's
// only non-shared input is context.license):
const shapeOf = (license) => {
  const ed = resolveEdition(license);
  return {
    isActive: license ? license.isActive === true : null,
    edition: ed.edition, label: ed.label, capabilitySet: ed.capabilitySet, source: ed.source,
    features: ADVANCED_FEATURES.map((f) => ({ ...f, allowed: isFeatureAllowed(ed.edition, f.id) })),
  };
};
ok(shapeOf(null).isActive === null, "no license → isActive null (unknown), unchanged from 1.2");
ok(shapeOf({ isActive: false }).isActive === false, "inactive license → isActive false, unchanged from 1.2");
ok(shapeOf({ isActive: true }).isActive === true && shapeOf({ isActive: true }).edition === "standard",
  "active legacy license → isActive true, edition standard");
{
  const adv = shapeOf({ isActive: true, capabilitySet: "capabilityAdvanced" });
  ok(adv.edition === "advanced" && adv.label === "Coder", "Coder tenant reports edition advanced / label Coder");
  ok(adv.features.every((f) => f.allowed === true), "every advanced feature is allowed on Coder");
}
ok(shapeOf({ isActive: true }).features.every((f) => f.allowed === false), "no advanced feature is allowed on Standard");
ok(shapeOf(null).features.length === ADVANCED_FEATURES.length, "features list is always emitted, even with no license");

// =====================================================================================
// 3. Runtime gates keep failing OPEN; the snapshot refresh is guarded
// =====================================================================================
{
  // validate()
  const v = indexSrc.slice(indexSrc.indexOf("export const validate = async (args) => {"));
  const vHead = v.slice(0, 3000);
  ok(/try \{ editionFromInvocation\(license\); \} catch/.test(vHead),
    "validate() refreshes the edition snapshot inside a try/catch (never throws into a transition)");
  ok(vHead.indexOf("editionFromInvocation") < vHead.indexOf("if (license && license.isActive === false)"),
    "the snapshot refresh happens BEFORE the license gate, so an inactive tenant still records its edition");
  ok(/if \(license && license\.isActive === false\) \{[\s\S]{0,200}?return \{ result: true \};/.test(vHead),
    "validate() still FAILS OPEN on an inactive license (returns result:true)");
  ok(!/await editionFromInvocation/.test(vHead), "the refresh is never awaited in validate()");
}
{
  const p = indexSrc.slice(indexSrc.indexOf("// License check: skip silently if unlicensed"));
  const pHead = p.slice(0, 1200);
  ok(/try \{ editionFromInvocation\(license\); \} catch/.test(pHead),
    "executePostFunction() refreshes the edition snapshot inside a try/catch");
  ok(/return \{ result: true \};/.test(pHead), "executePostFunction() still returns result:true on an inactive license");
  ok(!/await editionFromInvocation/.test(pHead), "the refresh is never awaited in executePostFunction()");
}

// =====================================================================================
// 4. The snapshot + memo plumbing exists and is bounded
// =====================================================================================
ok(/export const EDITION_SNAPSHOT_KEY = "COGNIRUNNER_EDITION_SNAPSHOT";/.test(indexSrc), "snapshot key is exported for the sibling modules");
ok(/EDITION_SNAPSHOT_TTL = \{ ttl: \{ value: 2, unit: "DAYS" \} \}/.test(indexSrc), "snapshot carries a 2-DAY TTL (F-082: a lapsed subscription must not bill Opus for a week)");
ok(/EDITION_SNAPSHOT_MIN_INTERVAL_MS = 6 \* 60 \* 60 \* 1000/.test(indexSrc), "snapshot writes are throttled to once per 6h per container");
ok(/export const currentEdition = async \(\)/.test(indexSrc), "currentEdition is exported");
ok(/export const requireAdvanced = async \(context, featureId\)/.test(indexSrc), "requireAdvanced is exported");
ok(/export const editionFromInvocation = \(license\)/.test(indexSrc), "editionFromInvocation is exported");
{
  const m = indexSrc.match(/export const currentEdition = async \(\) => \{[\s\S]*?\n\};/);
  ok(!!m && /getAppContext\(\)/.test(m[0]), "currentEdition tries the live getAppContext() license first");
  ok(!!m && /EDITION_SNAPSHOT_KEY/.test(m[0]), "currentEdition falls back to the KVS snapshot");
  // F-082/F-087 — snapshot trust.
  const cur = m ? m[0] : "";
  ok(/"license" in ctx/.test(cur), "a live context that CARRIES the license key is the truth…");
  ok(/resolveEdition\(ctx\.license\)/.test(cur), "…including license:null, which resolves to Standard");
  ok(/if \(!sawContext\)/.test(cur), "the snapshot is read ONLY when no live license read was possible");
  ok(/snap\.active === true && snap\.edition === "advanced"/.test(cur),
    "and only an ACTIVE advanced snapshot is honoured");
  ok(!/snap\.active \?\? null/.test(cur), "the old 'trust whatever the snapshot says' branch is gone");
  ok(/resolveEdition\(null\)/.test(cur), "currentEdition's last resort is Standard");
  ok(/_cachedEditionAt < PROVIDER_CACHE_TTL_MS/.test(cur), "currentEdition memoises on the same 30s window as the provider config");
}
{
  const a = asyncSrc.match(/const currentEditionAsync = async \(\) => \{[\s\S]*?\n\};/);
  ok(!!a, "found currentEditionAsync in src/async-handler.js");
  const body = a ? a[0] : "";
  ok(/"license" in ctx/.test(body) && /resolveEdition\(ctx\.license\)\.edition/.test(body),
    "the consumer applies the SAME live-context-wins rule (one rule, two seams)");
  ok(/snap\.active === true && snap\.edition === "advanced"/.test(body),
    "the consumer honours only an ACTIVE advanced snapshot");
}

// =====================================================================================
// 5. F-078 — getOpenAIModelFromKVS reports `clamped` only when a SAVED model was refused.
// With nothing saved the effective model is simply the default, and claiming it was
// clamped makes the admin panel warn about a downgrade that never happened.
// =====================================================================================
{
  const m = indexSrc.match(/resolver\.define\("getOpenAIModelFromKVS",[\s\S]*?\n\}\);/);
  ok(!!m, "found the getOpenAIModelFromKVS resolver");
  const body = m ? m[0] : "";
  ok(/clamped:\s*!!savedModel && savedModel !== effective/.test(body),
    "clamped requires a saved model AND a difference");
  ok(!/clamped:\s*savedModel !== effective/.test(body), "the unguarded comparison is gone");
  const clamped = (savedModel, effective) => !!savedModel && savedModel !== effective;
  ok(clamped(null, "claude-haiku-4-5-20251001") === false, "nothing saved → not clamped");
  ok(clamped(undefined, "claude-haiku-4-5-20251001") === false, "undefined saved → not clamped");
  ok(clamped("claude-opus-5", "claude-haiku-4-5-20251001") === true, "a refused saved model → clamped");
  ok(clamped("claude-opus-5", "claude-opus-5") === false, "an allowed saved model → not clamped");
}

// =====================================================================================
// 6. F-079/F-080/F-081 — the seat snapshot is an ADMIN-PANEL concern, never an
// inference one, it pages on an EMPTY page, and every outcome writes a row.
// =====================================================================================
{
  const m = indexSrc.match(/const maybeRefreshSeatSnapshot = \(\) => \{[\s\S]*?\n\};/);
  ok(!!m, "found maybeRefreshSeatSnapshot");
  const body = m ? m[0] : "";
  ok(!/page\.length < SEAT_PAGE/.test(body),
    "the `page.length < SEAT_PAGE` early break is gone (Jira caps maxResults; a short page is not the end)");
  ok(/SEAT_MAX_PAGES/.test(body) && /page\.length === 0\) break/.test(body),
    "paging stops on an EMPTY page or SEAT_MAX_PAGES");
  ok(/seats: null, error/.test(body), "a failed scan writes a {seats:null,error} marker row");
  ok(/await write\(\{ seats \}\)/.test(body), "a successful scan writes its count, including zero");
  ok(/SEAT_MAX_PAGES = 10/.test(indexSrc), "the page ceiling is 10");
  ok(/SEAT_SNAPSHOT_MAX_AGE_MS = 24 \* 60 \* 60 \* 1000/.test(indexSrc), "the throttle window is 24h");

  const gp = indexSrc.match(/const getProviderConfig = async \(\) => \{[\s\S]*?\n\};/);
  ok(!!gp, "found getProviderConfig");
  ok(gp && !/maybeRefreshSeatSnapshot/.test(gp[0]),
    "the provider memo NEVER starts a seat scan — that scan used to ride the transition path");
  ok(gp && /Promise\.all\(\[/.test(gp[0]) && /currentEdition\(\)/.test(gp[0]) && /storage\.get\(USAGE_KEY\)/.test(gp[0]) && /readSeatCount\(\)/.test(gp[0]),
    "the memo's three reads (edition, usage, seats) go out in parallel");
  ok(gp && /if \(provider === "atlassian"\) \{[\s\S]*?Promise\.all/.test(gp[0]),
    "those reads happen ONLY on the atlassian branch");

  const usage = indexSrc.match(/resolver\.define\("getAiUsage",[\s\S]*?\n\}\);/);
  ok(!!usage && /maybeRefreshSeatSnapshot\(\)/.test(usage[0]), "getAiUsage triggers the scan");
  const lic = indexSrc.match(/resolver\.define\("checkLicense",[\s\S]*?\n\}\);/);
  ok(!!lic && /maybeRefreshSeatSnapshot\(\)/.test(lic[0]), "checkLicense triggers the scan");
  ok(!!lic && /try \{ maybeRefreshSeatSnapshot\(\); \} catch/.test(lic[0]), "and it can never throw into the license read");
}

// =====================================================================================
// 7. F-086 — checkProviderHealth's `clamped` is an EDITION verdict, not a string compare
// against whatever model id the provider echoed back.
// =====================================================================================
{
  const m = indexSrc.match(/resolver\.define\("checkProviderHealth",[\s\S]*?\n\}\);/);
  ok(!!m, "found checkProviderHealth");
  const body = m ? m[0] : "";
  ok(!/clamped: model !== configuredModel/.test(body),
    "the echo comparison is gone (a dated/aliased provider id is not a clamp)");
  ok(/if \(provider === "atlassian"\)/.test(body) && /clampForgeLlmModel\(edition, configuredModel\) !== configuredModel/.test(body),
    "clamped comes from the edition policy, on the atlassian branch only");
  ok(/let clamped = false;/.test(body), "every other provider reports clamped:false");
}

// =====================================================================================
// 8. F-091 — getAiUsage emits the Forge LLM allowance block ONLY where it can apply:
// the vendor-billed provider AND the edition that entitles the models it meters.
// A Standard / BYOK tenant was shown "$0 of $200" and a "Sonnet 5 / Opus 5 paused"
// notice for models it can never run. `seats` stays unconditional.
// =====================================================================================
{
  const m = indexSrc.match(/resolver\.define\("getAiUsage",[\s\S]*?\n\}\);/);
  ok(!!m, "found getAiUsage");
  const body = m ? m[0] : "";
  ok(/requireAdmin\(context\.accountId\)/.test(body), "getAiUsage is admin-gated (it triggers the seat scan)");
  ok(/const showAllowance = provider === "atlassian" && edition === EDITION_IDS\.ADVANCED;/.test(body),
    "the allowance gate is provider AND edition — both, in one expression");
  ok(/forgeLlm: showAllowance \? forgeLlmAllowanceStatus\(state, allowanceUsdForSeats\(seats\)\) : null/.test(body),
    "…and forgeLlm is null when it does not apply, never a $0-of-$200 block");
  ok(/editionFromInvocation\(context\?\.license\)\.edition/.test(body),
    "the edition comes from THIS invocation's licence, not the snapshot-backed memo");
  ok(/\n      seats,/.test(body), "seats is still reported unconditionally");
  ok(!/edition === "advanced"/.test(body), "the id is not re-typed — EDITION_IDS is the one home");
}

console.log(`\nedition-backend: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
