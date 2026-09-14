/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Offline unit test for scripts/run-offline.mjs — THE RUNNER THAT GATES EVERY OTHER SUITE.
// Run: node scripts/offline-runner.test.mjs
//
// The runner cannot be tested in place (it would recurse into itself and take minutes), so every
// case here builds a THROWAWAY HARNESS in the OS temp dir: a copy of the real runner next to two
// or three tiny fixture suites. Temp, not a subdirectory of the repo, on purpose — the F-808 case
// asserts behaviour when NO `node_modules` is reachable, and node's resolver walks parent
// directories, so a tmp tree inside this checkout would silently find the repo's install and the
// case would prove nothing. This is the same throwaway-copy shape F-731 used for the timeout.
//
// Covers:
//   F-808 — precondition: with the dependencies unreachable the runner refuses the WHOLE run
//           (exit 2, one sentence naming what is missing and both ways to fix it) and spawns NO
//           suite, instead of letting the two suites that reach into node_modules by path report
//           as product regressions.
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, existsSync, rmSync, symlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";

let pass = 0; let fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log("  FAIL:", msg); } };

const here = path.dirname(fileURLToPath(import.meta.url));
const REAL_RUNNER = path.join(here, "run-offline.mjs");
const REPO_ROOT = path.resolve(here, "..", "..");

/* Builds a throwaway harness that MIRRORS THE REAL LAYOUT — <tmp>/test-harness/scripts/ with the
   installs one level above at <tmp>/node_modules — because the two suites this precondition exists
   for reach two levels up into node_modules relative to their own file. Flattening the copy by one
   directory makes that path land somewhere else entirely and the fixture stops modelling them. */
const makeHarness = (fixtures) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "cr-offline-runner-"));
  const harness = path.join(root, "test-harness");
  mkdirSync(path.join(harness, "scripts"), { recursive: true });
  copyFileSync(REAL_RUNNER, path.join(harness, "scripts", "run-offline.mjs"));
  for (const [name, src] of Object.entries(fixtures)) writeFileSync(path.join(harness, "scripts", name), src, "utf8");
  return { root, harness };
};
const linkInstalls = ({ root, harness }) => {
  symlinkSync(path.join(REPO_ROOT, "node_modules"), path.join(root, "node_modules"));
  symlinkSync(path.join(REPO_ROOT, "test-harness", "node_modules"), path.join(harness, "node_modules"));
};
const runHarness = ({ harness }, env = {}) => spawnSync(process.execPath, [path.join(harness, "scripts", "run-offline.mjs")], {
  encoding: "utf8",
  cwd: harness,
  env: { ...process.env, ...env },
});
const cleanups = [];
const disposable = (h) => { cleanups.push(h.root); return h; };

// ── F-808: dependencies unreachable → refuse the run ────────────────────────────────────────────
{
  // Fixtures that ask for what the real rule-stats/memory-store-repair suites ask for: a bare
  // package and an explicit reach into ../../node_modules for an internal file.
  const h = disposable(makeHarness({
    "dep-path.test.mjs": `import { createRequire } from "node:module";\n`
      + `const require = createRequire(import.meta.url);\n`
      + `require("../../node_modules/@forge/kvs/out/transaction-api.js");\n`
      + `console.log("dep-path: 1 passed, 0 failed");\n`,
    "dep-pkg.test.mjs": `const { default: nacl } = await import("tweetnacl");\n`
      + `console.log("dep-pkg: 1 passed, 0 failed");\n`,
    "trivial.test.mjs": `console.log("SHOULD-NOT-RUN trivial: 1 passed, 0 failed");\n`,
  }));
  const r = runHarness(h);
  const out = (r.stdout || "") + (r.stderr || "");
  ok(r.status === 2, `no deps → exit 2 (got ${r.status})`);
  ok(/NOT RUN/.test(out), "no deps → says the run was NOT RUN");
  ok(/dependencies are not installed/i.test(out), "no deps → names the precondition, not a test failure");
  ok(out.includes("tweetnacl"), "no deps → names the missing package");
  ok(out.includes("@forge/kvs/out/transaction-api.js"), "no deps → names the missing node_modules file");
  ok(/npm ci/.test(out), "no deps → fix 1: npm ci");
  ok(/ln -s/.test(out), "no deps → fix 2: the worktree symlink recipe");
  ok(!out.includes("SHOULD-NOT-RUN"), "no deps → NO suite is spawned");
  ok(!/OFFLINE SUITE: (PASS|FAIL)/.test(out), "no deps → no PASS/FAIL verdict is printed at all");
  ok(!existsSync(path.join(h.harness, "results")), "no deps → nothing written to results/");
}

// ── F-808 control: with node_modules reachable the same harness runs its suites ─────────────────
{
  const h = disposable(makeHarness({
    "dep-path.test.mjs": `import { createRequire } from "node:module";\n`
      + `const require = createRequire(import.meta.url);\n`
      + `require("../../node_modules/@forge/kvs/out/transaction-api.js");\n`
      + `console.log("dep-path: 1 passed, 0 failed");\n`,
    "dep-pkg.test.mjs": `const { default: nacl } = await import("tweetnacl");\n`
      + `console.log("dep-pkg: 1 passed, 0 failed");\n`,
    "trivial.test.mjs": `console.log("trivial: 1 passed, 0 failed");\n`,
  }));
  // Link, don't copy: the point is only that the resolver can see the installs.
  linkInstalls(h);
  const r = runHarness(h);
  const out = (r.stdout || "") + (r.stderr || "");
  ok(r.status === 0, `deps present → exit 0 (got ${r.status}); out tail: ${out.slice(-300)}`);
  ok(/OFFLINE SUITE: PASS \(3\/3\)/.test(out), "deps present → all three fixture suites ran and passed");
  ok(!/NOT RUN/.test(out), "deps present → the precondition does not fire");
}

for (const root of cleanups) { try { rmSync(root, { recursive: true, force: true }); } catch { /* temp dir */ } }

console.log(`OFFLINE RUNNER: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
