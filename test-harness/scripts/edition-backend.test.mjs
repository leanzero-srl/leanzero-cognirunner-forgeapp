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
// EDITION_IDS is imported because the fs+eval-extracted helpers below reference it —
// the id string has ONE home and the extracted source must resolve it (F-098).
import { ADVANCED_FEATURES, EDITIONS, EDITION_IDS, resolveEdition, isFeatureAllowed } from "../../src/shared/edition.js";

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
// F-255: the refusal names its own family through a constant — pull it in so the
// extracted source still evaluates, and so a rename here is a test failure there.
const mReason = indexSrc.match(/export const EDITION_REFUSAL_REASON = "([^"]+)";/);
ok(!!mReason, "found EDITION_REFUSAL_REASON in src/index.js");
const EDITION_REFUSAL_REASON = mReason ? mReason[1] : null;
// eslint-disable-next-line no-eval
const upgradeRequired = eval(
  `const EDITION_REFUSAL_REASON = ${JSON.stringify(EDITION_REFUSAL_REASON)};\n(`
  + mUp[0].replace("export const upgradeRequired = ", "").replace(/;\s*$/, "") + ")");

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
  // F-255 — an edition denial must be SELF-CLASSIFYING. A consumer that branches on
  // `reason` (the F-242 contract) would otherwise file it as a fault and offer a
  // Retry that can never succeed; and it must NOT claim to be a permission refusal,
  // because no role grant clears it.
  ok(r.reason === "upgrade-required", `refusal carries reason:"upgrade-required" (got ${JSON.stringify(r.reason)})`);
  ok(r.reason !== "no-permission", "an edition denial is not a permission refusal");
  ok(r.needsRole === undefined && r.hint === undefined, "an edition denial names no role floor and no roster hint");
  ok(r.featureId === "coder", "the featureId still rides along for the upsell");
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
ok(/export const currentEdition = async \(context, options\)/.test(indexSrc), "currentEdition is exported, and takes the invocation context (F-101)");
ok(/export const requireAdvanced = async \(context, featureId\)/.test(indexSrc), "requireAdvanced is exported");
// F-101 — the edition consumers that DECIDE something (the Forge LLM write gates, the
// health check, the usage meter) all read the one ladder with their context.
for (const name of ["checkProviderHealth", "getOpenAIModels", "saveOpenAIModel", "getAgentModel", "saveAgentModel", "getOpenAIModelFromKVS"]) {
  const r = indexSrc.match(new RegExp('resolver\\.define\\("' + name + '",[\\s\\S]*?\\n\\}\\);'));
  ok(!!r, `found the ${name} resolver`);
  const rb = r ? r[0] : "";
  ok(/currentEdition\(context\)/.test(rb), `${name} reads the edition through currentEdition(context) — one ladder`);
  ok(!/editionFromInvocation\(/.test(rb), `${name} keeps no private invocation-only edition read`);
}
ok(/export const editionFromInvocation = \(license\)/.test(indexSrc), "editionFromInvocation is exported");
{
  const m = indexSrc.match(/export const currentEdition = async \(context, options\) => \{[\s\S]*?\n\};/);
  ok(!!m && /getAppContext\(\)/.test(m[0]), "currentEdition tries the live getAppContext() license first");
  ok(!!m && /EDITION_SNAPSHOT_KEY/.test(m[0]), "currentEdition falls back to the KVS snapshot");
  // F-082/F-087 — snapshot trust.
  const cur = m ? m[0] : "";
  ok(/"license" in ctx/.test(cur), "a live context that CARRIES the license key is the truth…");
  ok(/resolveEdition\(ctx\.license\)/.test(cur), "…including license:null, which resolves to Standard");
  ok(/if \(!sawContext\)/.test(cur), "the snapshot is read ONLY when no live license read was possible");
  ok(/snap\.active === true && snap\.edition === EDITION_IDS\.ADVANCED/.test(cur),
    "and only an ACTIVE advanced snapshot is honoured");
  ok(!/snap\.active \?\? null/.test(cur), "the old 'trust whatever the snapshot says' branch is gone");
  ok(/resolveEdition\(null\)/.test(cur), "currentEdition's last resort is Standard");
  // F-101 — ONE ladder. Rung 1 is the caller's own invocation license; the resolver
  // seams no longer keep a private editionFromInvocation() read that answers Standard
  // where this function would answer advanced (and vice versa).
  ok(/"license" in context/.test(cur) && /editionFromInvocation\(context\.license\)/.test(cur),
    "an invocation context with a license key is rung 1 — the same read the old call sites did inline");
  {
    const iCtx = cur.indexOf("\"license\" in context");
    const iMemo = cur.indexOf("_cachedEdition && Date.now()");
    ok(iCtx > 0 && iCtx < iMemo, "…and it is checked BEFORE the per-container memo, so a context is never served a stale edition");
  }
  ok(/_cachedEditionAt < PROVIDER_CACHE_TTL_MS/.test(cur), "currentEdition memoises on the same 30s window as the provider config");
}
// =====================================================================================
// F-108 — requireAdvanced uses THE ladder's top rung, EXECUTED. It used to test
// `context.license` by truthiness, so a context CARRYING license:null (an install with
// no licence) fell through to the KVS snapshot and could be gated as Coder for the
// snapshot's whole 2-day life — the lapsed-subscription hole F-082 closed everywhere
// else. Built from the REAL bodies of currentEdition + requireAdvanced.
// =====================================================================================
{
  const mCur = indexSrc.match(/export const currentEdition = async \(context, options\) => \{[\s\S]*?\n\};/);
  const mReq = indexSrc.match(/export const requireAdvanced = async \(context, featureId\) => \{[\s\S]*?\n\};/);
  ok(!!mCur && !!mReq, "found currentEdition + requireAdvanced for the executed gate test");
  const build = ({ snapshot, appCtx }) => new Function(
    "storage", "getAppContext", "editionFromInvocation", "resolveEdition", "isFeatureAllowed",
    "upgradeRequired", "EDITION_IDS", "EDITIONS", "EDITION_SNAPSHOT_KEY", "PROVIDER_CACHE_TTL_MS",
    "let _cachedEdition = null; let _cachedEditionAt = 0;\n" +
    (mCur ? mCur[0] : "").replace("export const", "const") + "\n" +
    (mReq ? mReq[0] : "").replace("export const", "const") + "\nreturn requireAdvanced;",
  )(
    { get: async () => snapshot },
    () => appCtx,
    (license) => resolveEdition(license), // the real resolver, minus the snapshot write
    resolveEdition, isFeatureAllowed, upgradeRequired, EDITION_IDS, EDITIONS, "SNAP", 30000,
  );
  const advancedSnapshot = { active: true, edition: EDITION_IDS.ADVANCED, at: Date.now() };
  const coderLicense = { isActive: true, capabilitySet: "capabilityAdvanced" };
  const feature = ADVANCED_FEATURES[0].id;

  // BLOCK — the invocation CARRIES license:null. That is an answer, not a missing read:
  // Standard, refused, even with an advanced snapshot sitting in KVS.
  {
    const requireAdvanced = build({ snapshot: advancedSnapshot, appCtx: {} });
    const r = await requireAdvanced({ license: null }, feature);
    ok(r.ok === false, "BLOCK: context {license:null} is refused even with an ADVANCED snapshot planted (F-108)");
    ok(r.refusal && r.refusal.success === false && r.refusal.upgradeRequired === true,
      "BLOCK: …and the refusal is the one upgradeRequired shape");
    ok(r.edition.edition === EDITION_IDS.STANDARD, "BLOCK: the resolved edition is Standard");
  }
  // ALLOW — a live Coder licence on the invocation passes without touching the snapshot.
  {
    const requireAdvanced = build({ snapshot: null, appCtx: {} });
    const r = await requireAdvanced({ license: coderLicense }, feature);
    ok(r.ok === true && r.edition.edition === EDITION_IDS.ADVANCED,
      "ALLOW: a live Coder licence on the invocation is rung 1");
  }
  // SNAPSHOT — only when the runtime could not see a licence AT ALL (no context, and
  // getAppContext carries no `license` key) is the snapshot consulted.
  {
    const requireAdvanced = build({ snapshot: advancedSnapshot, appCtx: {} });
    const r = await requireAdvanced(undefined, feature);
    ok(r.ok === true && r.edition.source === "snapshot",
      "SNAPSHOT: with no licence visible anywhere, an ACTIVE advanced snapshot still gates open");
  }
  // …and a live getAppContext() license:null beats that snapshot too — same rung, same rule.
  {
    const requireAdvanced = build({ snapshot: advancedSnapshot, appCtx: { license: null } });
    const r = await requireAdvanced(undefined, feature);
    ok(r.ok === false, "SNAPSHOT: a live getAppContext license:null still wins over the snapshot");
  }
  // The source keeps ONE top-rung test: no private truthiness check survives.
  ok(!/context && context\.license \? editionFromInvocation/.test(indexSrc),
    "requireAdvanced keeps no private `context.license ?` top rung");
  ok(/ed = await currentEdition\(context\);/.test(mReq ? mReq[0] : ""),
    "requireAdvanced reads THE ladder, fed its context");
}

{
  // F-111 — the consumer has NO edition ladder of its own any more. It had a copy
  // (currentEditionAsync + a retyped snapshot key) that drifted from this one; it now
  // calls src/index.js's currentEdition() with { fresh: true } so it keeps its
  // deliberate no-cache behaviour without a second implementation of the rule.
  const asyncCode = asyncSrc.replace(/\/\/[^\n]*/g, "");
  ok(!/currentEditionAsync/.test(asyncCode), "no second edition ladder in src/async-handler.js");
  ok(!/EDITION_SNAPSHOT_KEY/.test(asyncCode), "no retyped snapshot key in the consumer");
  const a = asyncSrc.match(/const currentEditionFresh = async \(\) => \{[\s\S]*?\n\};/);
  ok(!!a, "found the consumer's currentEditionFresh wrapper");
  const body = a ? a[0] : "";
  ok(/currentEdition\(undefined, \{ fresh: true \}\)/.test(body),
    "the consumer reads THE ladder, memo-free (one rule, two seams)");
  ok(/EDITION_IDS\.STANDARD/.test(body), "an edition fault in the consumer floors at Standard");
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
// 6. F-079/F-093 — WHERE the seat snapshot is triggered from. It is an ADMIN-PANEL
// concern, never an inference one.
//
// F-104: the SHAPE of maybeRefreshSeatSnapshot (and of the getProviderConfig memo's
// reads) has exactly ONE home — scripts/forge-llm-policy.test.mjs, which also EXECUTES
// the scan against a fake KVS + Jira. The identical regex block that used to sit here
// had already drifted from it (it blessed the zero write F-100 exploits), so it is
// deleted rather than kept in sync. Assert the scan's BEHAVIOUR there, its TRIGGER here.
// =====================================================================================
{
  // F-093: ONE trigger, and it is admin-gated. checkLicense is ungated and is called by
  // config-ui, config-view and the issue glance, so triggering the scan there put a
  // multi-page asApp() user-directory scan on any user's issue-view path.
  const usage = indexSrc.match(/resolver\.define\("getAiUsage",[\s\S]*?\n\}\);/);
  ok(!!usage && /await maybeRefreshSeatSnapshot\(\)/.test(usage[0]),
    "getAiUsage triggers the scan, AWAITING the start marker before it returns (F-102)");
  ok(!!usage && /requireAdmin\(context\.accountId\)/.test(usage[0]), "…and getAiUsage is admin-gated");
  const lic = indexSrc.match(/resolver\.define\("checkLicense",[\s\S]*?\n\}\);/);
  ok(!!lic && !/maybeRefreshSeatSnapshot/.test(lic[0]), "checkLicense does NOT trigger the scan (F-093)");
  ok((indexSrc.match(/\n\s*(?:try \{ )?await maybeRefreshSeatSnapshot\(\)/g) || []).length === 1,
    "exactly ONE call site starts the seat scan");
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
  // F-099 added the third condition: a FAULTED seat read also suppresses the block,
  // because a ceiling computed from a number nobody read is what says "Sonnet 5 paused".
  ok(/forgeLlm: \(showAllowance && seatRead\.ok\) \? forgeLlmAllowanceStatus\(state, allowanceUsdForSeats\(seats\)\) : null/.test(body),
    "…and forgeLlm is null when it does not apply or the seat read faulted, never a $0-of-$200 block");
  ok(/\(await currentEdition\(context\)\)\.edition/.test(body),
    "the edition comes from the ONE ladder, fed this invocation's context (F-101)");
  ok(!/editionFromInvocation\(context\?\.license\)/.test(body),
    "…not from a private invocation-only read that disagrees with callForgeLlmChat");
  ok(/\n      seats,/.test(body), "seats is still reported unconditionally");
  ok(!/edition === "advanced"/.test(body), "the id is not re-typed — EDITION_IDS is the one home");
}

console.log(`\nedition-backend: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
