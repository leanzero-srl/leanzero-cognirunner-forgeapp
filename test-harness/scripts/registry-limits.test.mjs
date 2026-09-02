/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// REGRESSION GUARD — finding F-CAP, plus the "no test at all" gap a coverage audit
// found on src/shared/registry-limits.js.
//
// The registry lives in ONE KVS value with a hard ~240KB platform ceiling. The caps
// are the only thing standing between a large instance and a corrupted registry, and
// they used to be duplicated as bare literals across six call sites in index.js —
// with the two byte thresholds silently disagreeing.
//
// This pins two things:
//   1. registryPressure()'s maths, including which constraint binds (rows vs bytes).
//   2. That every write path in src/index.js actually REFERENCES the shared constants
//      rather than re-hardcoding a number. That second half is what stops the
//      duplication from creeping back — a unit test of the module alone would pass
//      happily while index.js compared against a stale literal.
//
// Run: node scripts/registry-limits.test.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  REGISTRY_MAX_ROWS,
  REGISTRY_HARD_MAX_BYTES,
  REGISTRY_CREATE_MAX_BYTES,
  REGISTRY_CLAIM_MAX_BYTES,
  REGISTRY_FULL_MESSAGE,
  REGISTRY_SIZE_MESSAGE,
  REGISTRY_UPDATE_MAX_BYTES,
  REGISTRY_FUNCTIONS_OFFLOAD_BYTES,
  registryPressure,
  registrySerializedBytes,
  slimRegistryRow,
} from "../../src/shared/registry-limits.js";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

// ---- 1. the constants themselves --------------------------------------------------
ok(REGISTRY_MAX_ROWS === 500, `row cap is 500 (got ${REGISTRY_MAX_ROWS})`);
ok(REGISTRY_CREATE_MAX_BYTES < REGISTRY_CLAIM_MAX_BYTES,
  "creating a NEW rule must earn less headroom than claiming an already-running one");
ok(REGISTRY_CLAIM_MAX_BYTES < 240 * 1024,
  "both byte ceilings must stay under the 240KiB KVS value limit");
ok(REGISTRY_UPDATE_MAX_BYTES < 240 * 1024 && REGISTRY_UPDATE_MAX_BYTES > REGISTRY_CLAIM_MAX_BYTES,
  "the update ceiling sits between the claim ceiling and the hard cap (edits get the most headroom, but still stop before corruption)");
ok(REGISTRY_FUNCTIONS_OFFLOAD_BYTES < 24576,
  "the registry-copy PF offload threshold is far below the workflow-config offload (it's a storage saving, not a runtime change)");

// ---- 1b. registrySerializedBytes measures UTF-8 BYTES, not UTF-16 code units ------
// The 240KiB Forge ceiling is bytes. JSON.stringify(x).length counts code units,
// which under-reports non-ASCII — a guard on .length can pass a write the platform
// refuses. A row of multi-byte characters must cost MORE bytes than string length.
{
  const greek = [{ id: "g", prompt: "μμμμμμμμμμ" }]; // 10 chars, 2 bytes each in the value
  const bytes = registrySerializedBytes(greek);
  const codeUnits = JSON.stringify(greek).length;
  ok(bytes > codeUnits, `UTF-8 bytes (${bytes}) must exceed UTF-16 length (${codeUnits}) for multi-byte content`);
  ok(registrySerializedBytes(null) >= 0, "byte counter tolerates null without throwing");
  const circ = {}; circ.self = circ;
  ok(registrySerializedBytes([circ]) === 0, "byte counter never throws on unserialisable input");
  // The meter now measures in bytes too.
  ok(registryPressure(greek).bytes === bytes, "registryPressure's byte count uses the UTF-8 counter");
}

// ---- 1c. slimRegistryRow: drop empties/defaults, epoch timestamps, no siteUrl -----
{
  const fat = {
    id: "x", type: "validator", fieldId: "", prompt: "hi", ruleKind: "ai",
    disabled: false, discovered: false, selectedDocIds: [],
    createdAt: "2026-04-13T17:28:48.846Z", updatedAt: "2026-04-13T17:28:48.846Z",
    workflow: { workflowName: "W", transitionId: "11", siteUrl: "https://x.atlassian.net", transitionFromName: "" },
    createdBy: "acct-1",
  };
  const slim = slimRegistryRow(fat);
  ok(!("fieldId" in slim), "empty-string fields are dropped");
  ok(!("ruleKind" in slim), "ruleKind:ai (the default) is dropped");
  ok(!("disabled" in slim) && !("discovered" in slim), "false flags are dropped");
  ok(!("selectedDocIds" in slim), "empty arrays are dropped");
  ok(typeof slim.createdAt === "number" && slim.createdAt === Date.parse(fat.createdAt), "timestamps become epoch-ms");
  ok(!("siteUrl" in slim.workflow), "workflow.siteUrl is dropped (identical on every row)");
  ok(!("transitionFromName" in slim.workflow), "empty workflow sub-fields are dropped");
  ok(slim.id === "x" && slim.type === "validator" && slim.prompt === "hi" && slim.createdBy === "acct-1",
    "load-bearing fields survive");
  ok(registrySerializedBytes([slim]) < registrySerializedBytes([fat]), "the slim row is smaller");

  // Idempotent — slimming a slim row changes nothing.
  ok(JSON.stringify(slimRegistryRow(slim)) === JSON.stringify(slim), "slimRegistryRow is idempotent");

  // functions:[] survives ONLY next to a codeRef (there it is the offload signal).
  const offloaded = slimRegistryRow({ id: "y", type: "postfunction-static", functions: [], codeRef: "pf_code:y:abc" });
  ok(Array.isArray(offloaded.functions) && offloaded.functions.length === 0, "functions:[] is kept when codeRef is present");
  const noCode = slimRegistryRow({ id: "z", type: "validator", functions: [] });
  ok(!("functions" in noCode), "functions:[] is dropped when there is no codeRef");

  // The ownership invariant is enforced on EVERY write, not just the one-shot repair:
  // a discovered row's createdBy is moved to claimedBy and nulled (then dropped as a
  // null value), so authorship can never re-attach even after a racing clobber.
  const claimed = slimRegistryRow({ id: "d", type: "validator", discovered: true, createdBy: "admin-who-clicked" });
  ok(!claimed.createdBy && claimed.claimedBy === "admin-who-clicked",
    "a discovered row can never carry authorship — claim is moved to claimedBy at write time");
}
// The message has to name the escape route, because for a long time it named one
// that did not exist ("remove unused rules from the admin panel" — there was no
// remove control).
ok(/delete/i.test(REGISTRY_FULL_MESSAGE) && /rules tab/i.test(REGISTRY_FULL_MESSAGE),
  "the full-registry message must point at the Rules tab's Delete");
ok(/delete/i.test(REGISTRY_SIZE_MESSAGE), "the size message must point at deleting rules");
ok(REGISTRY_FULL_MESSAGE.includes(String(REGISTRY_MAX_ROWS)),
  "the message must quote the actual cap, not a stale hardcoded number");

// ---- 2. registryPressure maths ----------------------------------------------------
{
  const empty = registryPressure([]);
  ok(empty.count === 0 && empty.level === "ok", "empty registry is ok");

  const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: `r${i}` }));
  const half = registryPressure(rows(250));
  ok(half.count === 250 && half.level === "ok", `250/500 is ok (got ${half.level})`);

  const warn = registryPressure({ count: 360, bytes: 0 });
  ok(warn.level === "warn", `72% of rows is warn (got ${warn.level})`);

  const full = registryPressure({ count: 480, bytes: 0 });
  ok(full.level === "full", `96% of rows is full (got ${full.level})`);

  // The BINDING constraint must win. A post-function row is ~1KB, so a PF-heavy
  // install hits the byte ceiling long before the row cap — if pressure reported
  // rows only, the meter would read green right up to a refused save.
  const byBytes = registryPressure({ count: 40, bytes: REGISTRY_CREATE_MAX_BYTES + 1 });
  ok(byBytes.level === "full", `bytes must drive the level when they bind (got ${byBytes.level})`);
  ok(byBytes.refusing === true, "past the create threshold, the meter must report that new rules are refused");
  ok(byBytes.pct >= byBytes.rowPct, "pct is the max of the row and byte fractions");

  // THE BUG THIS PINS: the meter used to measure bytes against the CREATE
  // REFUSAL threshold and print it as the maximum, so a real instance rendered
  // "219 / 200 KB" — a usage bar past its own ceiling, which reads as broken.
  // Usage must be measured against CAPACITY, which usage cannot exceed.
  ok(REGISTRY_HARD_MAX_BYTES > REGISTRY_CREATE_MAX_BYTES,
    "capacity must exceed the refusal threshold, or there is no room left to edit and delete existing rules");
  const real = registryPressure({ count: 498, bytes: 219040 }); // measured on a live instance
  ok(real.maxBytes === REGISTRY_HARD_MAX_BYTES, "the meter's denominator is CAPACITY, not the refusal threshold");
  ok(real.bytes <= real.maxBytes, "usage must never exceed the number shown as the maximum");
  ok(real.bytePct <= 1, `bytePct must not exceed 1 (got ${real.bytePct.toFixed(3)})`);
  ok(real.refusing === true, "a real at-the-limit instance must be reported as refusing new rules");
  ok(real.refuseAtBytes === REGISTRY_CREATE_MAX_BYTES, "the refusal point is exposed separately so the UI can explain it");

  // Row cap alone must also trip "refusing", even with plenty of bytes spare.
  const byRows = registryPressure({ count: REGISTRY_MAX_ROWS, bytes: 1000 });
  ok(byRows.refusing === true, "hitting the row cap refuses new rules even when bytes are fine");

  // Must never throw on a read path.
  const circular = {}; circular.self = circular;
  ok(registryPressure([circular]).bytes === 0, "an unserialisable registry yields 0 bytes rather than throwing");
  ok(registryPressure(null).count === 0, "null input is tolerated");
  ok(registryPressure(undefined).level === "ok", "undefined input is tolerated");
}

// ---- 3. the call sites must USE the shared constants ------------------------------
{
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(path.join(here, "../../src/index.js"), "utf8");

  ok(/import\s*\{[^}]*REGISTRY_MAX_ROWS[^}]*\}\s*from\s*"\.\/shared\/registry-limits\.js"/s.test(src),
    "index.js imports the shared limits module");

  // Every guard must compare against the constant. A bare `>= 500` anywhere in a
  // registry guard is the duplication this module exists to kill.
  const capGuards = src.match(/configs\.length\s*>=\s*[A-Z_0-9]+/g) || [];
  ok(capGuards.length >= 3, `expected at least 3 row-cap guards, found ${capGuards.length}`);
  ok(capGuards.every((g) => g.includes("REGISTRY_MAX_ROWS")),
    `every row-cap guard must use REGISTRY_MAX_ROWS — found: ${capGuards.join(", ")}`);

  const literalCap = src.match(/configs\.length\s*>=\s*\d+/g) || [];
  ok(literalCap.length === 0, `no registry guard may hardcode a row count — found: ${literalCap.join(", ")}`);

  const literalBytes = src.match(/JSON\.stringify\(\s*(?:configs|pre)\s*\)\.length\s*>\s*\d+/g) || [];
  ok(literalBytes.length === 0, `no registry guard may hardcode a byte ceiling — found: ${literalBytes.join(", ")}`);

  // Byte guards must measure UTF-8 bytes (registrySerializedBytes), not .length —
  // the whole point of 1b. A lingering JSON.stringify(configs).length > CONST guard
  // would under-measure non-ASCII and pass a write the platform refuses.
  const charLenGuards = src.match(/JSON\.stringify\(\s*(?:configs|pre|predicted)\s*\)\.length\s*>\s*REGISTRY_/g) || [];
  ok(charLenGuards.length === 0, `registry byte guards must use registrySerializedBytes, not .length — found: ${charLenGuards.join(", ")}`);
  ok(/registrySerializedBytes/.test(src), "index.js uses the shared UTF-8 byte counter for registry size guards");

  // The UPDATE branches were entirely unguarded (both create checks gate on the row
  // being NEW). An edit could grow a row from the refusal line to the ceiling. Both
  // register* resolvers must now reference the update ceiling.
  ok((src.match(/REGISTRY_UPDATE_MAX_BYTES/g) || []).length >= 2,
    "both registerConfig and registerPostFunction update branches must guard growth against REGISTRY_UPDATE_MAX_BYTES");

  // saveRegistry must slim on the way in — the single choke point that converges the
  // stored shape without a per-row migration sweep.
  ok(/const saveRegistry\s*=\s*async[^;]*slimRegistryRow/s.test(src) || /saveRegistry[\s\S]{0,200}map\(slimRegistryRow\)/.test(src),
    "saveRegistry slims every row on write");

  // commitImportCore had NO cap check at all: at the cap it attached a live workflow
  // rule and then failed to register it, manufacturing an unmanageable rule. The
  // guard must sit BEFORE the inject, not before the registry push.
  const importCore = src.slice(src.indexOf("commitImportCore"));
  const guardIdx = importCore.indexOf("REGISTRY_MAX_ROWS");
  const injectIdx = importCore.indexOf("injectWorkflowRuleCore({ workflowName: targetWorkflowName");
  ok(guardIdx > -1, "commitImportCore checks the row cap");
  ok(guardIdx > -1 && injectIdx > -1 && guardIdx < injectIdx,
    "commitImportCore's cap check must run BEFORE the workflow inject, or a refused import still leaves a live rule");
}

console.log(`\nregistry-limits: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
