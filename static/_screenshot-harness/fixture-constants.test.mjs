/*
 * CogniRunner - AI-powered workflow validation for Jira
 * Copyright (C) 2025 LeanZero
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * F-600 - A FIXTURE THAT RESTATES A SHARED CONSTANT GOES STALE IN SILENCE.
 *
 * `bridge.js` pinned `scaffoldVersion: 1` while `src/shared/git-scaffolds.js` had moved
 * SCAFFOLD_VERSION to 2. Nothing failed. Every `__PIPE_SCENARIO__` arm simply became an
 * OUTDATED pipeline row - the product's FAILURE state - and kept passing, because no test
 * read `outdated` yet. The moment F-583 taught the Code tab to render that state, the
 * "healthy pipeline" arms would have been asserting against a row the product considers
 * broken, and the natural conclusion would have been that the new renderer was wrong.
 *
 * That is the general shape this file guards: a harness fixture that COPIES a value owned
 * by `src/shared/` describes a world that no longer exists, and it describes it
 * confidently. There is no way to detect "this literal equals some constant's OLD value"
 * in general, so we assert the specific shapes instead - the kinds of value the fixtures
 * were actually caught restating:
 *
 *   1. every `scaffoldVersion:` in a fixture is an expression, never a numeric literal
 *   2. every `edition:` / license `state:` value is one of EDITION_IDS
 *   3. every capability `reason:` is a key of AGENT_CAPABILITY_REASONS
 *   4. every knowledge pack id names a pack that exists in knowledge-titles.js
 *   5. every scaffold id names a scaffold that exists in git-scaffolds.js
 *   6. no Forge LLM / managed model id is spelled out where a constant exports it
 *
 * A source scan, not a browser test, for the same reason refusal-contract.test.mjs is one:
 * the defect passes at runtime. Both the correct and the stale build render something.
 *
 * Run: node fixture-constants.test.mjs
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EDITION_IDS, AGENT_CAPABILITY_REASONS,
  FORGE_LLM_DEFAULT, FORGE_LLM_FRONTIER, MANAGED_MODELS, MANAGED_DEFAULT_MODEL,
} from "../../src/shared/edition.js";
import { SCAFFOLD_VERSION, SCAFFOLDS } from "../../src/shared/git-scaffolds.js";
import { KNOWLEDGE_PACK_TITLES } from "../../src/shared/knowledge-titles.js";

const HERE = dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log("  ✓ " + msg); } else { fail++; console.log("  ✗ " + msg); } };

/* The FIXTURE modules - the mock-bridge surface the apps are rendered against. Test files
   (*.test.mjs) are deliberately NOT in scope: an assertion is allowed, and expected, to
   spell out the value it is asserting on. The rule is about the data the UI is fed. */
function fixtureFiles() {
  const out = [];
  const add = (p) => { if (existsSync(p)) out.push(p); };
  add(join(HERE, "bridge.js"));
  add(join(HERE, "jira-bridge.js"));
  const lib = join(HERE, "lib");
  if (existsSync(lib)) {
    for (const name of readdirSync(lib)) {
      const full = join(lib, name);
      if (!statSync(full).isDirectory() && /\.(js|mjs)$/.test(name)) out.push(full);
    }
  }
  return out;
}

/* Comments are prose ABOUT the constants and routinely quote their values - the F-583 note
   in PIPE_ROW says "hardcoded to 1" on purpose. Scanning them would turn the honest
   explanation of a past bug into a failure, so they are stripped before every scan. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, p1) => p1 + " ");
}

const files = fixtureFiles();
const sources = files.map((f) => ({ file: relative(HERE, f), code: stripComments(readFileSync(f, "utf8")) }));

console.log("F-600 fixture-constants — " + files.length + " fixture module(s)");

ok(sources.some((s) => s.file === "bridge.js"), "bridge.js is in scope");

/* ---- 1. scaffoldVersion is never a literal ---------------------------------- */
{
  const bad = [];
  let anyFound = false;
  for (const { file, code } of sources) {
    for (const m of code.matchAll(/scaffoldVersion\s*:\s*([^,\n}]+)/g)) {
      anyFound = true;
      const value = m[1].trim();
      if (/^-?\d+$/.test(value)) bad.push(`${file}: scaffoldVersion: ${value}`);
    }
  }
  ok(anyFound, "a scaffoldVersion fixture exists to check (the F-600 site)");
  ok(bad.length === 0, "no fixture pins scaffoldVersion to a numeric literal" + (bad.length ? " — " + bad.join("; ") : ""));

  /* And the value the fixtures actually serve is the CURRENT one: the PIPE_ROW default
     parameter must be SCAFFOLD_VERSION itself, which is the exact thing that broke. */
  const bridge = sources.find((s) => s.file === "bridge.js").code;
  ok(/PIPE_ROW\s*=\s*\([^)]*storedScaffoldVersion\s*=\s*SCAFFOLD_VERSION/.test(bridge),
    "PIPE_ROW defaults its stored scaffold version to the imported SCAFFOLD_VERSION (= " + SCAFFOLD_VERSION + ")");
}

/* ---- 2. edition ids ---------------------------------------------------------- */
{
  const allowed = new Set(Object.values(EDITION_IDS));
  const bad = [];
  for (const { file, code } of sources) {
    for (const m of code.matchAll(/\bedition\s*:\s*"([^"]*)"/g)) {
      if (!allowed.has(m[1])) bad.push(`${file}: edition: "${m[1]}"`);
    }
  }
  ok(bad.length === 0, "every literal `edition:` value is one of EDITION_IDS" + (bad.length ? " — " + bad.join("; ") : ""));

  /* Stronger: the fixtures should not spell the ids at all where the constant exists.
     "standard"/"advanced" appear in other vocabularies (a validation `mode`), so this is
     scoped to the two keys that genuinely carry an edition id. */
  const spelled = [];
  for (const { file, code } of sources) {
    for (const m of code.matchAll(/\b(?:edition|state)\s*:\s*"(standard|advanced)"/g)) {
      spelled.push(`${file}: ${m[0]}`);
    }
  }
  ok(spelled.length === 0, "no fixture spells an edition id where EDITION_IDS exports it" + (spelled.length ? " — " + spelled.join("; ") : ""));
}

/* ---- 3. capability reasons --------------------------------------------------- */
{
  const keys = new Set(Object.keys(AGENT_CAPABILITY_REASONS));
  ok(keys.size > 0, "AGENT_CAPABILITY_REASONS is non-empty (" + keys.size + " reason(s))");

  /* Every argument handed to the CAP_REASON() guard is a real key. The guard also throws
     at load, but a source scan names the offender without running a browser. */
  const badArg = [];
  let capUses = 0;
  for (const { file, code } of sources) {
    for (const m of code.matchAll(/CAP_REASON\(\s*"([^"]*)"\s*\)/g)) {
      capUses++;
      if (!keys.has(m[1])) badArg.push(`${file}: CAP_REASON("${m[1]}")`);
    }
  }
  ok(capUses > 0, "the fixtures route capability reasons through CAP_REASON (" + capUses + " use(s))");
  ok(badArg.length === 0, "every CAP_REASON() argument is a key of AGENT_CAPABILITY_REASONS" + (badArg.length ? " — " + badArg.join("; ") : ""));

  /* And no capability reason is served as a bare string: a `reason:` whose value happens
     to be one of the keys must have gone through the guard. Runtime `reason:` values that
     are English prose or another vocabulary (`compaction:*`, `no-permission`) are not
     capability reasons and are left alone. */
  const bare = [];
  for (const { file, code } of sources) {
    for (const m of code.matchAll(/\breason\s*:\s*"([^"]*)"/g)) {
      if (keys.has(m[1])) bare.push(`${file}: reason: "${m[1]}"`);
    }
  }
  ok(bare.length === 0, "no fixture serves a capability reason as a bare string literal" + (bare.length ? " — " + bare.join("; ") : ""));
}

/* ---- 4. knowledge pack ids --------------------------------------------------- */
{
  const packs = new Set(Object.keys(KNOWLEDGE_PACK_TITLES));
  ok(packs.size > 0, "KNOWLEDGE_PACK_TITLES is non-empty (" + packs.size + " pack(s))");

  /* Three shapes carry a pack id in the fixtures: a `pack:`/`packId:` field, a comparison
     against one, and the leading segment of a chunk key ("<pack>/<pack>/<ver>/<chunk>").
     A pack id that no longer exists renders a Knowledge row for nothing. */
  const bad = [];
  let seen = 0;
  const looksLikePackId = (v) => /^[a-z][a-z0-9-]{3,}$/.test(v);
  for (const { file, code } of sources) {
    for (const m of code.matchAll(/\b(?:pack|packId)\s*(?::|===|==)\s*"([^"]*)"/g)) {
      seen++;
      if (!packs.has(m[1])) bad.push(`${file}: pack "${m[1]}"`);
    }
    for (const m of code.matchAll(/"([a-z0-9-]+)\/\1\/\d+\/[^"]*"/g)) {
      seen++;
      if (!packs.has(m[1])) bad.push(`${file}: chunk key for pack "${m[1]}"`);
    }
    const off = code.match(/__KNOWLEDGE_OFF__\s*=\s*\[([^\]]*)\]/);
    if (off) {
      for (const m of off[1].matchAll(/"([^"]*)"/g)) {
        if (!looksLikePackId(m[1])) continue;
        seen++;
        if (!packs.has(m[1])) bad.push(`${file}: __KNOWLEDGE_OFF__ "${m[1]}"`);
      }
    }
  }
  ok(seen > 0, "the fixtures name at least one knowledge pack (" + seen + " reference(s))");
  ok(bad.length === 0, "every pack id in the fixtures exists in knowledge-titles.js" + (bad.length ? " — " + bad.join("; ") : ""));
}

/* ---- 5. scaffold ids --------------------------------------------------------- */
{
  const ids = new Set(Object.keys(SCAFFOLDS));
  const bad = [];
  let seen = 0;
  for (const { file, code } of sources) {
    for (const m of code.matchAll(/\bscaffold\s*(?::|===|==)\s*"([^"]*)"/g)) {
      seen++;
      if (!ids.has(m[1])) bad.push(`${file}: scaffold "${m[1]}"`);
    }
  }
  ok(seen > 0, "the fixtures name at least one scaffold (" + seen + " reference(s))");
  ok(bad.length === 0, "every scaffold id in the fixtures exists in git-scaffolds.js" + (bad.length ? " — " + bad.join("; ") : ""));
}

/* ---- 6. model ids ------------------------------------------------------------ */
{
  /* The Forge LLM default and frontier ids, and the managed ids, are EXPORTED. A fixture
     that types one of them out drifts the day the policy moves - which is the same failure
     as the scaffold version, with a model name instead of a number. The BYOK catalogues
     (a provider's own model list) are a different vocabulary and are not in scope; a value
     is flagged only when it is exactly a Forge LLM / managed constant. */
  const owned = new Map();
  owned.set(FORGE_LLM_DEFAULT, "FORGE_LLM_DEFAULT");
  FORGE_LLM_FRONTIER.forEach((id, i) => owned.set(id, `FORGE_LLM_FRONTIER[${i}]`));
  MANAGED_MODELS.forEach((id, i) => owned.set(id, id === MANAGED_DEFAULT_MODEL ? "MANAGED_DEFAULT_MODEL" : `MANAGED_MODELS[${i}]`));

  const bad = [];
  for (const { file, code } of sources) {
    for (const m of code.matchAll(/\b(?:model|agentModel|savedModel|modelUsed)\s*:\s*"([^"]*)"/g)) {
      if (owned.has(m[1])) bad.push(`${file}: ${m[0]} — use ${owned.get(m[1])}`);
    }
  }
  ok(bad.length === 0, "no fixture spells out a model id that edition.js exports" + (bad.length ? " — " + bad.join("; ") : ""));
}

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
