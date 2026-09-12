#!/usr/bin/env node
/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */
// Renders a scaffold from src/shared/git-scaffolds.js into a directory, or checks
// that a directory still matches it (parity — the offshoot must never drift from
// the single source). Usage:
//   node scripts/render-scaffold.mjs <kind> <targetDir> [--check] [--var KEY=VALUE ...]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const { renderScaffold, buildPermissionLock } = await import(path.join(here, "..", "..", "src", "shared", "git-scaffolds.js"));

const [kind, target, ...rest] = process.argv.slice(2);
if (!kind || !target) { console.error("usage: render-scaffold.mjs <kind> <targetDir> [--check] [--var K=V]"); process.exit(2); }
const check = rest.includes("--check");
const vars = {};
for (let i = 0; i < rest.length; i++) if (rest[i] === "--var" && rest[i + 1]) { const [k, ...v] = rest[i + 1].split("="); vars[k] = v.join("="); }

const files = renderScaffold(kind, vars);
let drift = 0;
for (const f of files) {
  const p = path.join(target, f.path);
  if (check) {
    const cur = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
    if (cur !== f.content) { drift++; console.log("DRIFT " + f.path + (cur === null ? " (missing)" : "")); }
  } else {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, f.content);
    console.log("wrote " + f.path);
  }
}
// The permission lock is derived from the rendered manifest (only for app scaffolds).
const manifest = files.find((f) => f.path === "manifest.yml");
if (manifest && !check) {
  const lockPath = path.join(target, ".cognirunner", "forge-permissions.lock");
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify(buildPermissionLock(manifest.content, { source: "render-scaffold" }), null, 2) + "\n");
  console.log("wrote .cognirunner/forge-permissions.lock");
}
if (check) { console.log(drift ? `${drift} file(s) drifted` : "scaffold parity OK"); process.exit(drift ? 1 : 0); }
