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
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here).filter((f) => f.endsWith(".test.mjs")).sort();

/* F-808 — DEPENDENCIES MISSING IS A PRECONDITION, NOT TWO RED SUITES.
   In a tree with no `node_modules` (the normal state of a fresh worktree — it is gitignored
   and nothing links it for you) `rule-stats.test.mjs` and `memory-store-repair.test.mjs`
   reach the INSTALLED @forge packages by path, so they failed with `Cannot find module
   '../../node_modules/@forge/kvs/out/transaction-api.js'` and a bare stack. The run then read
   `OFFLINE SUITE: FAIL (2/150)` — two named subjects, neither of which is the cause, and a
   surgeon can lose a cycle in the wrong file. (The @forge/* bare imports are served by the
   mock resolve hook, which is exactly why the failure looks like product code and not like a
   missing install.)

   So: resolve what the suites actually ask for BEFORE spawning any of them, and if anything
   is missing refuse the whole run with one sentence and exit 2 (distinct from 1 = a real
   test failure, so a caller can tell "not installed" from "regressed").

   The requirement list is DERIVED from the suites, never typed here: a new suite that imports
   a new package is covered the day it lands, and a suite that drops one stops demanding it. */
const externalPkgs = new Map();   // package name -> suite that wants it
const nodeModulePaths = new Map(); // resolved path -> suite that wants it
// Line-anchored on purpose: several suites carry JS source as FIXTURE STRINGS containing
// `import { chromium } from "playwright"`, and a free-floating regex would demand a package
// that no suite actually loads. A real import/require starts its line.
const STATEMENT_SPECIFIERS = [
  /^\s*import\s+[^;'"`]*?\bfrom\s*["']([^"']+)["']/,
  /^\s*import\s*["']([^"']+)["']/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+[\s\S]*?=\s*\(?\s*(?:await\s+)?(?:import|require)\s*\(\s*["']([^"']+)["']/,
  /^\s*(?:await\s+)?(?:import|require)\s*\(\s*["']([^"']+)["']/,
];
// A path that walks up into `node_modules/` is a deliberate reach for the INSTALLED package
// (internal files the public entrypoint does not export) and is checked as a file, wherever it
// appears — `require(...)`, `new URL(...)`, `readFileSync(...)`. It must be QUOTED and end in a
// file extension: suites also *write about* such paths in prose, and an elided one out of a
// comment would have this runner refusing the gate over a file nobody ever opens.
const NODE_MODULES_PATH = /["'`]((?:\.\.\/)+node_modules\/[^"'`\s)]*\.[a-z]{2,5})["'`]/g;
for (const f of files) {
  const src = readFileSync(path.join(here, f), "utf8");
  for (const line of src.split("\n")) {
    for (const re of STATEMENT_SPECIFIERS) {
      const m = line.match(re);
      if (!m) continue;
      const spec = m[1];
      if (/^(?:\.|\/|node:|data:|file:|https?:)/.test(spec)) break;
      const parts = spec.split("/");
      const pkg = spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
      if (!externalPkgs.has(pkg)) externalPkgs.set(pkg, f);
      break;
    }
  }
  for (const m of src.matchAll(NODE_MODULES_PATH)) {
    const abs = path.resolve(here, m[1]);
    if (!nodeModulePaths.has(abs)) nodeModulePaths.set(abs, f);
  }
}

const requireFromRunner = createRequire(import.meta.url);
const missing = [];
for (const [pkg, suite] of externalPkgs) {
  try { requireFromRunner.resolve(pkg); }
  catch { missing.push(`${pkg} (imported by ${suite})`); }
}
for (const [abs, suite] of nodeModulePaths) {
  if (!existsSync(abs)) missing.push(`${path.relative(path.join(here, ".."), abs)} (read by ${suite})`);
}
if (missing.length) {
  console.error(`OFFLINE SUITE: NOT RUN — dependencies are not installed: ${missing.join(", ")}. `
    + `Fix with \`npm ci\` in test-harness/ (and in the repo root, which is where @forge/* live), `
    + `or, in a worktree, link the main checkout's installs: `
    + `\`ln -s <main-checkout>/node_modules node_modules && ln -s <main-checkout>/test-harness/node_modules test-harness/node_modules\` `
    + `(remove those symlinks before committing).`);
  process.exit(2);
}

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

/* F-731 — A SUITE THAT NEVER RETURNS IS A FAILURE, NOT A GATE THAT WAITS FOREVER.
   `spawnSync` was given `{ encoding: "utf8" }` and nothing else, so it had NO timeout: a
   suite that stopped converging — a repair loop without a pass cap, a promise that never
   settles, a fixture waiting on a resource that is gone — hung this runner indefinitely.
   The deploy chains gate on `tail -n1` of this output, and a hang produces no last line at
   all: not a red gate, no gate. A bound turns that into an ordinary FAIL, named, with the
   time it burned, and the exit code every caller already reads.

   240 s is deliberately generous against the suites as they stand (the slowest measured
   here is roster-ui.test.mjs; F-731 also cut its real-timer cost down from ~124 s). This
   bound is a DEADLOCK DETECTOR, not a performance budget — a suite that is merely slow
   must not go red on a loaded machine. Raise or lower it per run with
   OFFLINE_SUITE_TIMEOUT_MS (which is also how the timeout path itself is exercised). */
const DEFAULT_SUITE_TIMEOUT_MS = 240000;
const rawTimeout = Number(process.env.OFFLINE_SUITE_TIMEOUT_MS);
const SUITE_TIMEOUT_MS = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : DEFAULT_SUITE_TIMEOUT_MS;
if (Number.isFinite(rawTimeout) && rawTimeout > 0 && rawTimeout !== DEFAULT_SUITE_TIMEOUT_MS) {
  console.log(`OFFLINE_SUITE_TIMEOUT_MS=${SUITE_TIMEOUT_MS} — per-suite timeout overridden (default ${DEFAULT_SUITE_TIMEOUT_MS}ms).`);
}

/* F-807 — A FAILING SUITE'S OUTPUT SURVIVES THE RUN.
   The console keeps the last 600 bytes, which is enough to recognise a failure you already
   understand and useless for one you do not: a roster-ui flake in pass 12 left nothing to
   read and could never be diagnosed. The full stdout+stderr of any suite that fails or times
   out is written here (results/ is gitignored) and the path is printed on the FAIL line. */
const logDir = path.join(here, "..", "results", "offline");
const writeFailureLog = (suite, out) => {
  try {
    mkdirSync(logDir, { recursive: true });
    const file = path.join(logDir, `${suite.replace(/\.test\.mjs$/, "")}.log`);
    writeFileSync(file, out, "utf8");
    return path.relative(path.join(here, ".."), file);
  } catch (e) {
    return `(could not write log: ${e.message})`;
  }
};

let failed = 0;
const failedSuites = [];
const rows = [];
for (const f of files) {
  const started = Date.now();
  /* SIGKILL, not the default SIGTERM: the thing being bounded is a process that is not
     making progress, and a handler-swallowed SIGTERM would leave the runner waiting on
     exactly the hang it is here to break. */
  const r = spawnSync(process.execPath, [path.join(here, f)], {
    encoding: "utf8",
    timeout: SUITE_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  const elapsedMs = Date.now() - started;
  /* Node reports the kill on `r.error.code === "ETIMEDOUT"`; `r.signal` is the signal we
     sent. Either alone is enough, and neither is trusted on its own — a suite may legitimately
     die of a signal for other reasons, which is still a failure, just a differently named one. */
  const timedOut = (r.error && r.error.code === "ETIMEDOUT") || (r.signal === "SIGKILL" && elapsedMs >= SUITE_TIMEOUT_MS);
  const out = (r.stdout || "") + (r.stderr || "");
  if (timedOut) {
    failed++;
    failedSuites.push(f);
    rows.push(`  ✗ ${f.padEnd(28)} TIMED OUT after ${(elapsedMs / 1000).toFixed(1)}s (limit ${(SUITE_TIMEOUT_MS / 1000).toFixed(1)}s) — killed. `
      + `The suite did not finish; raise OFFLINE_SUITE_TIMEOUT_MS only if it is genuinely slow rather than stuck. `
      + `Full output: ${writeFailureLog(f, out)}\n`
      + out.slice(-600));
    continue;
  }
  const summary = (out.match(/[^\n]*\b(\d+)\s*(?:passed|\/\d+ assertions passed|checks passed)[^\n]*/i) || [])[0]
    || (out.split("\n").filter(Boolean).pop() || "").trim();
  const okRun = r.status === 0;
  if (!okRun) { failed++; failedSuites.push(f); }
  rows.push(`  ${okRun ? "✓" : "✗"} ${f.padEnd(28)} ${okRun
    ? (summary || "").slice(0, 70)
    : `FAILED (exit ${r.status}) — full output: ${writeFailureLog(f, out)}\n${out.slice(-600)}`}`);
}

console.log(`\n=== Offline suite: ${files.length} test files ===`);
console.log(rows.join("\n"));
if (shuffling) console.log(`(shuffled order, SEED=${seed})`);
console.log(failed === 0 ? `\nOFFLINE SUITE: PASS (${files.length}/${files.length})` : `\nOFFLINE SUITE: FAIL (${failed}/${files.length} suites failed)`);
// Deploy chains gate on `tail -n1`: when anything failed the LAST line names the
// failing suites and nothing else, and the exit code is non-zero.
if (failed) console.log(`FAILING SUITES: ${failedSuites.join(" ")}`);
process.exit(failed ? 1 : 0);
