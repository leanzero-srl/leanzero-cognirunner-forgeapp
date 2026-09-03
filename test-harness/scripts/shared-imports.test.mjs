/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Offline gate for src/shared/ — every module there MUST actually load.
//
// Why this exists: `node --check` is the documented syntax gate, but package.json has no
// "type": "module", so --check parses these files as CommonJS-ish and RETURNS 0 on a file
// that cannot be imported as ESM. That is not hypothetical — a stray un-escaped backtick
// inside a promptDoc template literal in sandbox-api-spec.js passed `node --check` and only
// failed at import() with "Unexpected identifier 'api'". These files bundle into the Forge
// backend AND two webpack builds, so a module that does not load breaks codegen prompts,
// the CodeMirror completions/hover/lint and the API Reference panel at once.
//
// Asserts, for EVERY file in src/shared/: it import()s without throwing, it exports at least
// one binding, and it declares at least one `export` in source (a file that silently exports
// nothing is a copy/paste casualty, not a module). Auto-discovered by run-offline.mjs.
// Run: node --import ../lib/register-mocks.mjs scripts/shared-imports.test.mjs
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sharedDir = path.join(here, "../../src/shared");

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL:", m); } };

const files = readdirSync(sharedDir).filter((f) => f.endsWith(".js")).sort();
ok(files.length > 0, "src/shared/ contains modules to check");

for (const f of files) {
  const abs = path.join(sharedDir, f);
  let mod = null, err = null;
  try {
    mod = await import(pathToFileURL(abs).href);
  } catch (e) {
    err = e;
  }
  // The whole point: a parse/resolve error here is a broken bundle, whatever `node --check` said.
  ok(err === null, `src/shared/${f} import()s cleanly (${err ? err.message : "ok"})`);
  if (err) continue;

  const names = Object.keys(mod || {});
  ok(names.length > 0, `src/shared/${f} exports at least one binding`);
  // Source-level check too: a module whose exports were all commented out still "imports fine".
  const src = readFileSync(abs, "utf8");
  ok(/^\s*export\s/m.test(src), `src/shared/${f} declares at least one export in source`);
  // These modules bundle into two webpack builds AND the Forge backend, so they must stay
  // dependency-free — no @forge/*, no react, no node built-ins (see the header of
  // src/shared/sandbox-api-spec.js). A bare-specifier import is the tell.
  const badImport = (src.match(/^\s*import\s[^\n]*?from\s+["']([^"'.][^"']*)["']/m) || [])[1];
  ok(!badImport, `src/shared/${f} has no non-relative import (offender: ${badImport || "none"})`);
}

console.log(`\nshared-imports: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
