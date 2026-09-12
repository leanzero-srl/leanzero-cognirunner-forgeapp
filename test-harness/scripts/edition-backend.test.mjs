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
ok(/EDITION_SNAPSHOT_TTL = \{ ttl: \{ value: 7, unit: "DAYS" \} \}/.test(indexSrc), "snapshot carries a 7-DAY TTL (it is a cache, never an authority)");
ok(/EDITION_SNAPSHOT_MIN_INTERVAL_MS = 6 \* 60 \* 60 \* 1000/.test(indexSrc), "snapshot writes are throttled to once per 6h per container");
ok(/export const currentEdition = async \(\)/.test(indexSrc), "currentEdition is exported");
ok(/export const requireAdvanced = async \(context, featureId\)/.test(indexSrc), "requireAdvanced is exported");
ok(/export const editionFromInvocation = \(license\)/.test(indexSrc), "editionFromInvocation is exported");
{
  const m = indexSrc.match(/export const currentEdition = async \(\) => \{[\s\S]*?\n\};/);
  ok(!!m && /getAppContext\(\)\?\.license/.test(m[0]), "currentEdition tries getAppContext().license first");
  ok(!!m && /EDITION_SNAPSHOT_KEY/.test(m[0]), "currentEdition falls back to the KVS snapshot");
  ok(!!m && /resolveEdition\(null\)/.test(m[0]), "currentEdition's last resort is Standard");
  ok(!!m && /_cachedEditionAt < PROVIDER_CACHE_TTL_MS/.test(m[0]), "currentEdition memoises on the same 30s window as the provider config");
}

console.log(`\nedition-backend: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
