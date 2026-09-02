/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// REGRESSION GATE — the guards for bugs that have already shipped once.
//
// Every entry names the finding it defends. A guard with no finding is just a test;
// a guard WITH one is a promise that a specific defect cannot come back silently.
//
// Ordered cheapest-first so a broken build fails in seconds rather than minutes:
// offline unit checks, then live Jira, then the one suite that spends real AI calls.
//
// Env:
//   TESTSTATE_URL + HARNESS_SECRET   required by the live registry guards
//   REG_SKIP_AI=1                    skip the AI-spending suite
//   REG_OFFLINE=1                    offline guards only (no Jira, no credentials)
//
// Run: node scripts/regression.mjs      (or: npm run reg)

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { loadEnv } from "../lib/env.mjs";

// Load .env HERE, not just in the child scripts. The skip decision below reads
// TESTSTATE_URL/HARNESS_SECRET; if the gate itself didn't load .env, a fresh
// shell would compute HAVE_HOOK=false and SILENTLY SKIP the three live guards
// while the children (which do load .env) would have run — a skip masquerading
// as coverage. loadEnv only fills vars the shell didn't already set.
try { loadEnv(); } catch { /* offline runs have no .env; REG_OFFLINE handles that */ }

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.join(HERE, "../results");
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

const OFFLINE_ONLY = process.env.REG_OFFLINE === "1";
const SKIP_AI = process.env.REG_SKIP_AI === "1";
const HAVE_HOOK = !!(process.env.TESTSTATE_URL && process.env.HARNESS_SECRET);

const GUARDS = [
  {
    id: "F-OWN", kind: "offline", script: "configs-filter.test.mjs",
    what: '"My Rules" listed rules the user never created (ownerless rows matched everyone)',
  },
  {
    id: "F-CAP", kind: "offline", script: "registry-limits.test.mjs",
    what: "registry caps were bare literals duplicated across six call sites, and commitImportCore had no cap check at all",
  },
  {
    id: "F-PFDIS", kind: "live", script: "reg-pf-disable.mjs", needsHook: true,
    what: "a claimed post-function could not be disabled; and the fix must not mute its siblings or a validator on the same transition",
  },
  {
    id: "F-DEL", kind: "live", script: "reg-delete-detaches.mjs", needsHook: true,
    what: "deleting a rule only removed its registry row; the rule stayed on the transition and kept running",
  },
  {
    id: "F3", kind: "live", script: "reg-conditions-enforce.mjs",
    what: "conditions gated nothing (manifest shipped a constant expression), and were wrongly believed to be un-enforceable over REST",
  },
  {
    id: "F-REST", kind: "live", script: "reg-rest-guide.mjs",
    what: "docs/REST-API-RULES.md is a promise: the documented attach payloads must keep working (the app or Jira could drift from the page)",
  },
  {
    id: "F-GLOBAL", kind: "ai", script: "reg-global-validator-e2e.mjs", needsHook: true,
    what: "a validator on an 'Any status → X' GLOBAL transition must really block (the owner's reported case)",
  },
];

const results = [];
for (const g of GUARDS) {
  // A skip is either DELIBERATE (an explicit REG_OFFLINE/REG_SKIP_AI flag the
  // operator chose) or FORCED (missing credentials — coverage the operator
  // presumably wanted but the environment couldn't provide). They must not read
  // alike: a forced skip in an otherwise-complete run is a coverage hole, and
  // the exit code below refuses to call it success.
  const skip =
    (OFFLINE_ONLY && g.kind !== "offline") ? { why: "REG_OFFLINE=1", deliberate: true }
      : (SKIP_AI && g.kind === "ai") ? { why: "REG_SKIP_AI=1", deliberate: true }
        : (g.needsHook && !HAVE_HOOK) ? { why: "TESTSTATE_URL/HARNESS_SECRET not set", deliberate: false }
          : null;

  if (skip) {
    console.log(`\n${bold(`--- ${g.id} — SKIPPED`)} (${skip.why})`);
    results.push({ guard: g.id, findingId: g.id, script: g.script, status: "skipped", detail: skip.why, deliberate: skip.deliberate, defends: g.what });
    continue;
  }

  console.log(`\n${bold(`=== ${g.id} — ${g.script} ===`)}\n    defends: ${g.what}`);
  const r = spawnSync("node", [path.join(HERE, g.script)], { stdio: "inherit", env: process.env });
  const code = r.status == null ? -1 : r.status;
  results.push({
    guard: g.id, findingId: g.id, script: g.script,
    status: code === 0 ? "pass" : "fail",
    detail: code === 0 ? "" : `exited ${code}`,
    defends: g.what,
  });
}

try { mkdirSync(RESULTS, { recursive: true }); } catch { /* already there */ }

const failed = results.filter((r) => r.status === "fail");
const skipped = results.filter((r) => r.status === "skipped");
const forcedSkips = skipped.filter((r) => r.deliberate !== true);
console.log(`\n${bold("=== REGRESSION GATE ===")}`);
for (const r of results) {
  const mark = r.status === "pass" ? "✓" : r.status === "fail" ? "✗" : "–";
  console.log(`  ${mark} ${r.guard.padEnd(9)} ${r.script}${r.detail ? `  (${r.detail})` : ""}`);
}
console.log(`\n${failed.length ? bold("FAIL") : forcedSkips.length ? bold("INCOMPLETE") : "PASS"}: ${results.length - failed.length - skipped.length} passed, ${failed.length} failed, ${skipped.length} skipped`);
if (forcedSkips.length) {
  console.log(`  ${forcedSkips.length} guard(s) could not run for lack of credentials — this is NOT a pass. Set TESTSTATE_URL + HARNESS_SECRET (or REG_OFFLINE=1 to run offline deliberately).`);
}
writeFileSync(path.join(RESULTS, "regression.json"),
  JSON.stringify({ results, summary: { passed: results.length - failed.length - skipped.length, failed: failed.length, skipped: skipped.length, forcedSkips: forcedSkips.length } }, null, 2));
// Distinct exit codes so machine consumers (barrage) can't read a skip as a pass:
//   0 = every applicable guard passed          (real green)
//   1 = a guard FAILED                          (regression)
//   2 = a guard was FORCED to skip (no creds)   (incomplete — not success)
// A DELIBERATE skip (REG_OFFLINE / REG_SKIP_AI) is the operator's own choice and
// still exits 0, because they asked for a narrower run on purpose.
process.exit(failed.length ? 1 : forcedSkips.length ? 2 : 0);
