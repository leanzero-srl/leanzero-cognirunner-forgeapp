/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Runs the ENTIRE offline unit suite: auto-discovers every scripts/*.test.mjs and runs each with the
// mock @forge/kvs loader (harmless for pure tests, required for storage-path tests). Auto-discovery means
// a new *.test.mjs is included the moment it lands — no more orphaned tests. Exits non-zero if any suite
// fails. Run: node scripts/run-offline.mjs   (or `npm run test:offline`).
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const loader = path.join(here, "../lib/register-mocks.mjs");
const files = readdirSync(here).filter((f) => f.endsWith(".test.mjs")).sort();

let failed = 0;
const rows = [];
for (const f of files) {
  const r = spawnSync(process.execPath, ["--import", loader, path.join(here, f)], { encoding: "utf8" });
  const out = (r.stdout || "") + (r.stderr || "");
  const summary = (out.match(/[^\n]*\b(\d+)\s*(?:passed|\/\d+ assertions passed|checks passed)[^\n]*/i) || [])[0]
    || (out.split("\n").filter(Boolean).pop() || "").trim();
  const okRun = r.status === 0;
  if (!okRun) failed++;
  rows.push(`  ${okRun ? "✓" : "✗"} ${f.padEnd(28)} ${okRun ? (summary || "").slice(0, 70) : "FAILED (exit " + r.status + ")\n" + out.slice(-600)}`);
}

console.log(`\n=== Offline suite: ${files.length} test files ===`);
console.log(rows.join("\n"));
console.log(failed === 0 ? `\nOFFLINE SUITE: PASS (${files.length}/${files.length})` : `\nOFFLINE SUITE: FAIL (${failed}/${files.length} suites failed)`);
process.exit(failed ? 1 : 0);
