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

// F-419 — the identifier-leak TABLE has ONE home, and it is a dependency-free shared
// module, because a second caller is coming: the knowledge bake scans for the same
// identifiers the agent's web search does. A copy of the table is a second answer to "is a
// bare 24-hex string an account id?" — which is F-406, answered late once already.
{
  const leak = await import(pathToFileURL(path.join(sharedDir, "identifier-leak.js")).href);
  for (const name of ["IDENTIFIER_PATTERNS", "IDENTIFIER_KINDS", "NON_KEY_PREFIXES", "findIdentifierLeak", "matchesTenantIssueKey", "normalizeProjectKeys"]) {
    ok(typeof leak[name] !== "undefined", `identifier-leak.js exports ${name}`);
  }
  const toolSrc = readFileSync(path.join(sharedDir, "../web-search-tool.js"), "utf8");
  ok(/from\s+"\.\/shared\/identifier-leak\.js"/.test(toolSrc), "src/web-search-tool.js imports the table from that one home");
  ok(!/IDENTIFIER_PATTERNS = Object\.freeze/.test(toolSrc), "…and does not keep a copy of it");
  const indexSrc = readFileSync(path.join(sharedDir, "../index.js"), "utf8");
  ok(/from\s+"\.\/shared\/identifier-leak\.js"/.test(indexSrc), "src/index.js takes the project-key memo mechanics from there too");
}

// F-175 — the memory caps and the refusal sentence have ONE home, and it is the
// frontend-importable shared module. src/memories.js imports @forge/kvs at load, so a
// number declared there can only reach the screenshot-harness bridge / any UI by being
// RETYPED. Assert the shared module owns all three numbers and that memories.js declares
// none of them itself (it re-exports them instead).
const limitsSrc = readFileSync(path.join(sharedDir, "registry-limits.js"), "utf8");
const memoriesSrc = readFileSync(path.join(sharedDir, "../memories.js"), "utf8");
const limits = await import(pathToFileURL(path.join(sharedDir, "registry-limits.js")).href);
ok(limits.MAX_MEMORIES === 200 && limits.MEMORY_CONTENT_MAX === 400
  && limits.MEMORY_MAX_SERIALIZED_BYTES === 230000,
  "registry-limits.js owns the three memory-store numbers");
ok(typeof limits.memoryCapRefusalMessage === "function"
  && limits.memoryCapRefusalMessage("cap").includes(`(${limits.MAX_MEMORIES} max)`)
  && limits.memoryCapRefusalMessage("bytes") !== limits.memoryCapRefusalMessage("cap"),
  "memoryCapRefusalMessage is pure, shared, and interpolates MAX_MEMORIES");
for (const [name, value] of [["MAX_MEMORIES", 200], ["MEMORY_CONTENT_MAX", 400], ["MEMORY_MAX_SERIALIZED_BYTES", 230000]]) {
  ok(new RegExp(`(const|let|var)\\s+${name}\\s*=`).test(limitsSrc),
    `registry-limits.js declares ${name}`);
  ok(!new RegExp(`(const|let|var)\\s+${name}\\s*=`).test(memoriesSrc),
    `src/memories.js does NOT re-declare ${name}`);
  ok(!new RegExp(`=\\s*${value}\\b`).test(memoriesSrc),
    `src/memories.js does not retype the literal ${value}`);
}
ok(/from\s+"\.\/shared\/registry-limits\.js"/.test(memoriesSrc),
  "src/memories.js imports the memory limits from the shared module");

// 1.4 commit 14a — defangFence has ONE home and it is the shared module.
// It was declared in src/memories.js, which every fencing site imports it from. That file
// loads @forge/kvs, so src/shared/knowledge-select.js could not reach it without dragging
// the KVS client into three webpack bundles — and the alternative, a second copy of a
// four-character security rule, is this repo's signature defect. The declaration moved to
// src/shared/prompt-fencing.js and memories.js RE-EXPORTS it, so every existing importer
// is unchanged. Assert both halves: one declaration, and the re-export door still open.
const fencingSrc = readFileSync(path.join(sharedDir, "prompt-fencing.js"), "utf8");
const fencing = await import(pathToFileURL(path.join(sharedDir, "prompt-fencing.js")).href);
ok(typeof fencing.defangFence === "function", "src/shared/prompt-fencing.js exports defangFence");
ok(fencing.defangFence("<<<X and >>> out") === "<<X and >> out", "defangFence collapses 3+ angle brackets");
ok(/export const defangFence\s*=/.test(fencingSrc), "prompt-fencing.js DECLARES defangFence");
ok(!/export const defangFence\s*=/.test(memoriesSrc), "src/memories.js does NOT re-declare defangFence");
ok(/export \{ defangFence \} from "\.\/shared\/prompt-fencing\.js"/.test(memoriesSrc),
  "src/memories.js re-exports defangFence so every existing importer keeps working");
const memoriesMod = await import(pathToFileURL(path.join(sharedDir, "../memories.js")).href);
ok(memoriesMod.defangFence === fencing.defangFence,
  "the defangFence reached through memories.js IS the shared one (one home, two doors)");

// The field-guide selector must stay importable with NO baked packs on disk: they are
// generated later, and a shared module that static-imports a file which may not exist
// breaks the backend and all three webpack builds at once.
const select = await import(pathToFileURL(path.join(sharedDir, "knowledge-select.js")).href);
ok(typeof select.selectKnowledge === "function" && typeof select.buildFieldGuideBlock === "function",
  "knowledge-select.js exports selectKnowledge and buildFieldGuideBlock");
const selectSrc = readFileSync(path.join(sharedDir, "knowledge-select.js"), "utf8");
ok(!/from\s+["']\.\/knowledge-(index|packs)/.test(selectSrc),
  "knowledge-select.js does NOT static-import the generated index or packs");
ok(select.buildFieldGuideBlock([]).block === "", "an empty selection builds an empty block, not an empty fence");

console.log(`\nshared-imports: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
