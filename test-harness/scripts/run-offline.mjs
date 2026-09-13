/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Runs the ENTIRE offline unit suite: auto-discovers every scripts/*.test.mjs and runs each in its own
// process. Auto-discovery means a new *.test.mjs is included the moment it lands — no more orphaned
// tests. Exits non-zero if any suite fails. Run: node scripts/run-offline.mjs   (or `npm run test:offline`).
//
// F-467 — THE RUNNER LAUNCHES A SUITE EXACTLY THE WAY A HUMAN DOES: plain `node <suite>`, no
// `--import` loader. It used to pass `--import ../lib/register-mocks.mjs`, which registered the
// @forge/* mock resolve hook before anything resolved and so silently carried suites that never
// arranged their own mocks. Those suites were green here and RED standalone (a surgeon running the
// one suite for their change read a false failure). Suites now self-arrange via
// lib/ensure-mocks.mjs, so "green in the runner" and "green on its own" are the same statement —
// and a new suite that forgets the bootstrap fails HERE, loudly, instead of being masked.
//
// OFFLINE_SHUFFLE=1 runs the discovered suites in a seeded random order and prints the seed, so an
// order dependence between suites (shared temp files, a fixture one suite writes and another reads)
// surfaces instead of hiding behind the alphabet. Reproduce a red run with
// OFFLINE_SHUFFLE=1 OFFLINE_SHUFFLE_SEED=<seed>.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here).filter((f) => f.endsWith(".test.mjs")).sort();

// Deterministic PRNG (mulberry32) so a printed seed replays the exact order.
const mulberry32 = (a) => () => {
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const shuffling = process.env.OFFLINE_SHUFFLE === "1";
const seed = Number(process.env.OFFLINE_SHUFFLE_SEED) || ((Math.random() * 0xffffffff) >>> 0);
if (shuffling) {
  const rnd = mulberry32(seed);
  for (let i = files.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [files[i], files[j]] = [files[j], files[i]];
  }
  console.log(`OFFLINE_SHUFFLE=1 — suite order is randomised. SEED=${seed}`);
  console.log(`  replay: OFFLINE_SHUFFLE=1 OFFLINE_SHUFFLE_SEED=${seed} node scripts/run-offline.mjs`);
}

let failed = 0;
const failedSuites = [];
const rows = [];
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(here, f)], { encoding: "utf8" });
  const out = (r.stdout || "") + (r.stderr || "");
  const summary = (out.match(/[^\n]*\b(\d+)\s*(?:passed|\/\d+ assertions passed|checks passed)[^\n]*/i) || [])[0]
    || (out.split("\n").filter(Boolean).pop() || "").trim();
  const okRun = r.status === 0;
  if (!okRun) { failed++; failedSuites.push(f); }
  rows.push(`  ${okRun ? "✓" : "✗"} ${f.padEnd(28)} ${okRun ? (summary || "").slice(0, 70) : "FAILED (exit " + r.status + ")\n" + out.slice(-600)}`);
}

console.log(`\n=== Offline suite: ${files.length} test files ===`);
console.log(rows.join("\n"));
if (shuffling) console.log(`(shuffled order, SEED=${seed})`);
console.log(failed === 0 ? `\nOFFLINE SUITE: PASS (${files.length}/${files.length})` : `\nOFFLINE SUITE: FAIL (${failed}/${files.length} suites failed)`);
// Deploy chains gate on `tail -n1`: when anything failed the LAST line names the
// failing suites and nothing else, and the exit code is non-zero.
if (failed) console.log(`FAILING SUITES: ${failedSuites.join(" ")}`);
process.exit(failed ? 1 : 0);
