/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * ONE shared guard for every mock-bridge suite: the `build-shot/` bundle a suite
 * serves must be NEWER than the sources that produce it.
 *
 * Why this exists (F-125): every suite used to serve `build-shot/` and only check
 * that index.html EXISTS. `build-shot/` is gitignored, so it is whatever the last
 * person happened to build — a "147 passed" was once scored against a bundle built
 * 28 minutes before the fix under test; rebuilt, the same suite was 135/12. A suite
 * that green-lights a stale bundle is worse than no suite, because it reads
 * authoritative. `edition-chip` was worse still: it SKIPPED on a missing build-shot
 * and reported 0/0 as a pass.
 *
 * So: compare the newest mtime across everything webpack.screenshot.js actually
 * consumes with the recorded build time, and rebuild when stale. A missing build-shot
 * is never a skip — it is a build. A missing webpack.screenshot.js is a loud failure,
 * never a silent pass.
 *
 * TRAP, paid for during F-125: do NOT use `build-shot/index.html`'s mtime as the
 * build time. Webpack's `output.compareBeforeEmit` (default true) skips writing an
 * output file whose bytes are unchanged, so index.html keeps its ORIGINAL mtime
 * across rebuilds — a src touch would then make every later run rebuild forever.
 * We write our own stamp instead. `clean: true` deletes it with the rest of
 * build-shot, so a hand-run webpack costs exactly one extra rebuild, never a stale
 * pass.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HARNESS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATIC = path.resolve(HARNESS, "..");
const REPO = path.resolve(STATIC, "..");

/* Directories that are OUTPUTS or deps, never inputs — walking them would either
   make a tree look newer than itself (build-shot) or take forever (node_modules). */
const SKIP_DIRS = new Set(["node_modules", "build", "build-shot", ".git", "out", "clips"]);

function newestMtimeUnder(target) {
  let st;
  try { st = fs.statSync(target); } catch { return 0; }
  if (!st.isDirectory()) return st.mtimeMs;
  let newest = 0;
  const stack = [target];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) stack.push(path.join(dir, e.name)); continue; }
      try {
        const m = fs.statSync(path.join(dir, e.name)).mtimeMs;
        if (m > newest) newest = m;
      } catch { /* raced away mid-walk — cannot be the input that matters */ }
    }
  }
  return newest;
}

/* Everything the screenshot bundle is built FROM. `src/shared/**` is in here because
   the apps import it across the repo root (`../../../../src/shared/...`), and the
   harness bridge mocks are in here because webpack.screenshot.js ALIASES @forge/bridge
   to them — edit bridge.js and a stale bundle still answers with the old mock. */
function inputsFor(appDir) {
  return [
    path.join(appDir, "src"),
    path.join(appDir, "public"),
    path.join(appDir, "package.json"),
    path.join(appDir, "webpack.config.js"),
    path.join(appDir, "webpack.screenshot.js"),
    path.join(REPO, "src", "shared"),
    path.join(HARNESS, "bridge.js"),
    path.join(HARNESS, "jira-bridge.js"),
  ];
}

/* When this build-shot was built, per OUR stamp. 0 means "unknown or absent" — which
   always means rebuild, because an unstamped bundle is one we cannot vouch for. */
function readStamp(stampFile, indexFile) {
  if (!fs.existsSync(indexFile)) return 0;
  try {
    const v = JSON.parse(fs.readFileSync(stampFile, "utf8")).builtAt;
    return Number.isFinite(v) ? v : 0;
  } catch { return 0; }
}

const settled = new Map(); // appDir -> build-shot root, so N calls in one process build once

/**
 * Guarantee `<app>/build-shot/` is present and newer than its sources, building it
 * when it is not. Returns the absolute build-shot root to serve.
 *
 * @param {string} app  app name ("admin-panel") or an absolute app directory.
 * @returns {string}    absolute path to `<app>/build-shot`
 */
export function ensureFreshBuildShot(app) {
  const appDir = path.isAbsolute(app) ? app : path.join(STATIC, app);
  if (settled.has(appDir)) return settled.get(appDir);
  const name = path.basename(appDir);

  const config = path.join(appDir, "webpack.screenshot.js");
  if (!fs.existsSync(config)) {
    throw new Error(
      `[build-shot] ${name}: no webpack.screenshot.js at ${config}. ` +
      "The mock-bridge harness cannot build this app — restore the config; do NOT skip the suite."
    );
  }

  const shotRoot = path.join(appDir, "build-shot");
  const index = path.join(shotRoot, "index.html");
  const stamp = path.join(shotRoot, ".build-shot-stamp.json");
  const built = readStamp(stamp, index);
  const newest = inputsFor(appDir).reduce((m, p) => Math.max(m, newestMtimeUnder(p)), 0);

  if (built === 0 || built < newest) {
    const why = built === 0 ? "no build-shot" : `stale by ${Math.round((newest - built) / 1000)}s`;
    console.log(`[build-shot] ${name}: ${why} — rebuilding (webpack.screenshot.js)…`);
    const t0 = Date.now();
    const r = spawnSync("npx", ["webpack", "--config", "webpack.screenshot.js", "--mode", "production"], {
      cwd: appDir, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8",
    });
    if (r.error) throw new Error(`[build-shot] ${name}: could not run webpack — ${r.error.message}`);
    if (r.status !== 0) {
      const tail = `${r.stdout || ""}${r.stderr || ""}`.trim().split("\n").slice(-30).join("\n");
      throw new Error(`[build-shot] ${name}: webpack.screenshot.js build FAILED (exit ${r.status})\n${tail}`);
    }
    if (!fs.existsSync(index)) {
      throw new Error(`[build-shot] ${name}: build reported success but ${index} is missing`);
    }
    /* t0, not Date.now(): a source edited WHILE webpack ran may not be in this bundle,
       so the next run must still see it as stale. */
    fs.writeFileSync(stamp, JSON.stringify({ builtAt: t0, builtAtIso: new Date(t0).toISOString() }));
    console.log(`[build-shot] ${name}: rebuilt in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }

  settled.set(appDir, shotRoot);
  return shotRoot;
}

export default ensureFreshBuildShot;
